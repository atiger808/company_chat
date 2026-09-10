# -*- coding: utf-8 -*-
"""物资需求单 / 物资领用单 业务逻辑（单据号生成、业务记录建改、防超领台账）。

审批仍是工作流外壳（ApprovalRequest），物资业务数据落在规范化表：
  MaterialRequirement(+Item) / MaterialRequisition(+Item) / MaterialItem / DocumentSequence
"""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from .models import (
    DocumentSequence,
    MaterialItem,
    MaterialRequirement,
    MaterialRequirementItem,
    MaterialRequisition,
    MaterialRequisitionItem,
    MaterialStockIn,
    MaterialStockInItem,
    MaterialStockLog,
)

# 单据类型 → 单号前缀
DOC_PREFIX = {
    'material_requirement': 'XQ',  # 需求单
    'material_requisition': 'LY',  # 领用单
    'material_stock_in': 'RU',  # 入库单
}


def generate_document_no(tenant, doc_type):
    """生成单据号：前缀 + 年月 + 4位序号，select_for_update 原子自增保证并发唯一"""
    if not tenant:
        return None
    now = timezone.localtime()
    date_key = now.strftime('%Y%m')
    prefix = DOC_PREFIX.get(doc_type, (doc_type[:2] or 'DOC').upper())
    with transaction.atomic():
        seq_obj, _ = DocumentSequence.objects.select_for_update().get_or_create(
            tenant=tenant, doc_type=doc_type, date_key=date_key, defaults={'seq': 0},
        )
        seq_obj.seq += 1
        seq_obj.save(update_fields=['seq'])
        seq = seq_obj.seq
    return f'{prefix}{date_key}{seq:04d}'


def _num(v):
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal('0')


def _parse_items(items):
    """解析 struct_table 明细行（过滤数量 <=0 的行），返回规范化 dict 列表"""
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        qty = _num(it.get('quantity'))
        if qty <= 0:
            continue
        price = it.get('price')
        out.append({
            'item_name': str(it.get('item_name') or '').strip(),
            'spec': str(it.get('spec') or '').strip(),
            'unit': str(it.get('unit') or '').strip(),
            'price': _num(price) if price not in (None, '', 0) else None,
            'quantity': qty,
            'remark': str(it.get('remark') or '').strip(),
        })
    return out


def ensure_item_master(tenant, item_name, spec='', unit=''):
    """按 (名称+规格) 唯一匹配物品库主数据；缺失时自动建档，便于审批流水/重建流水能挂到物品行。"""
    try:
        qs = MaterialItem.objects.filter(tenant=tenant, is_active=True)
        cand = list(qs.filter(name=item_name, spec=spec or '')[:2])
        if len(cand) == 1:
            return cand[0]
        if not cand:
            fallback = list(qs.filter(name=item_name)[:2])
            if len(fallback) == 1:
                return fallback[0]
        return MaterialItem.objects.create(tenant=tenant, name=item_name, spec=spec or '', unit=unit or '')
    except Exception:
        return None


def write_stock_log(tenant, *, item_name, spec='', delta, ref_type, ref_id=None,
                    doc_no='', operator=None, note=''):
    """写一条物资库存流水：delta 入库为正、出库为负。物品库物品缺失时自动建档挂靠。"""
    item = ensure_item_master(tenant, item_name, spec)
    MaterialStockLog.objects.create(
        tenant=tenant, item=item, item_name=item_name, spec=spec or '',
        delta=delta, ref_type=ref_type, ref_id=ref_id,
        doc_no=doc_no or '', operator=operator, note=note or '',
    )


def ensure_material_requirement(approval, form_data):
    """按审批 form_data 创建/更新物资需求单业务记录；返回 (record, error)"""
    from accounts.models import Department
    branch_dept_id = form_data.get('branch_dept')
    purpose = str(form_data.get('purpose') or '')
    items = _parse_items(form_data.get('items'))
    if not branch_dept_id:
        return None, '请选择分公司'
    if not items:
        return None, '请至少填写一行物资明细'
    try:
        branch_dept = Department.objects.get(id=int(branch_dept_id))
    except (ValueError, TypeError, Department.DoesNotExist):
        return None, '分公司不存在'

    rec = MaterialRequirement.objects.filter(request=approval).first()
    if rec:
        rec.branch_dept = branch_dept
        rec.purpose = purpose
        rec.save(update_fields=['branch_dept', 'purpose', 'updated_at'])
    else:
        doc_no = generate_document_no(approval.tenant, 'material_requirement') or f'XQ{approval.id}'
        rec = MaterialRequirement.objects.create(
            request=approval, tenant=approval.tenant, doc_no=doc_no,
            branch_dept=branch_dept, purpose=purpose, status='pending',
            created_by=approval.applicant,
        )
    rec.items.all().delete()
    for it in items:
        ensure_item_master(approval.tenant, it['item_name'], it['spec'], it['unit'])
        MaterialRequirementItem.objects.create(requirement=rec, **it)
    if 'doc_no' not in form_data:
        form_data['doc_no'] = rec.doc_no
    return rec, None


def _resolve_link(form_data):
    link = form_data.get('link_req') or {}
    if isinstance(link, dict):
        return link.get('requirement_id') or link.get('id')
    return link


def ensure_material_requisition(approval, form_data):
    """按审批 form_data 创建/更新物资领用单业务记录并校验（关联需求单+防超领）"""
    req_id = _resolve_link(form_data)
    purpose = str(form_data.get('purpose') or '')
    items = _parse_items(form_data.get('items'))
    if not req_id:
        return None, '请选择关联需求单'
    try:
        requirement = MaterialRequirement.objects.select_related('tenant').get(id=int(req_id))
    except (ValueError, TypeError, MaterialRequirement.DoesNotExist):
        return None, '关联需求单不存在'
    if requirement.status != 'stocked':
        return None, '该需求单尚未入库，暂不可领用'
    if not items:
        return None, '领用明细为空'
    req_items = {i.item_name: i for i in requirement.items.all()}
    for it in items:
        ri = req_items.get(it['item_name'])
        if not ri:
            return None, f'物品「{it["item_name"]}」不在需求单明细中'
        remaining = ri.quantity - ri.requisitioned_quantity
        if it['quantity'] > remaining:
            return None, f'物品「{it["item_name"]}」领用数量({it["quantity"]})超出剩余可领数量({remaining})'
    # 产品金额 = 关联需求单的预估金额（后端强一致，不信任前端传入值）
    from .models import ApprovalRequest
    req_amount = None
    if requirement.request_id:
        _req = ApprovalRequest.objects.filter(id=requirement.request_id).first()
        if _req:
            if _req.amount:
                req_amount = _req.amount
            elif _req.form_data.get('amount'):
                req_amount = _num(_req.form_data.get('amount'))
    if req_amount is not None:
        form_data['amount'] = str(req_amount)

    rec = MaterialRequisition.objects.filter(request=approval).first()
    if rec:
        rec.requirement = requirement
        rec.requirement_doc_no = requirement.doc_no
        rec.branch_dept = approval.department
        rec.purpose = purpose
        rec.status = 'pending'
        rec.save(update_fields=['requirement', 'requirement_doc_no', 'branch_dept', 'purpose', 'status', 'updated_at'])
    else:
        doc_no = generate_document_no(approval.tenant, 'material_requisition') or f'LY{approval.id}'
        rec = MaterialRequisition.objects.create(
            request=approval, tenant=approval.tenant, doc_no=doc_no,
            requirement=requirement, requirement_doc_no=requirement.doc_no,
            branch_dept=approval.department, purpose=purpose, status='pending',
            created_by=approval.applicant,
        )
    rec.items.all().delete()
    for it in items:
        MaterialRequisitionItem.objects.create(requisition=rec, **it)
    if 'doc_no' not in form_data:
        form_data['doc_no'] = rec.doc_no
    if 'requirement_doc_no' not in form_data:
        form_data['requirement_doc_no'] = requirement.doc_no
    return rec, None


def ensure_material_stock_in(approval, form_data):
    """按审批 form_data 创建/更新物资入库单（关联需求单、分批实收）；返回 (record, error)"""
    from datetime import date as dt_date
    from django.utils import timezone
    req_id = _resolve_link(form_data)
    warehouse = str(form_data.get('warehouse') or '').strip()
    stock_date = (form_data.get('stock_date') or '').strip()
    remark = str(form_data.get('remark') or '').strip()
    actual_amount = None
    raw_amount = form_data.get('actual_amount')
    if raw_amount not in (None, ''):
        try:
            actual_amount = Decimal(str(raw_amount))
        except (InvalidOperation, ValueError, TypeError):
            actual_amount = None
    items = _parse_items(form_data.get('items'))
    if not req_id:
        return None, '请选择关联需求单'
    try:
        requirement = MaterialRequirement.objects.select_related('request').get(id=int(req_id))
    except (ValueError, TypeError, MaterialRequirement.DoesNotExist):
        return None, '关联需求单不存在'
    if not requirement.request or requirement.request.status != 'approved':
        return None, '需求单尚未审批通过，暂不可入库'
    if not items:
        return None, '请至少填写一行实收明细'
    # 🔧 防重复：同一需求单若已有「进行中」的物资入库单审批（待审批/暂缓/办理中），不允许再发起新入库单，
    # 避免同一需求单重复走入库审批；分批入库需等前一张入库单审批结束（通过/驳回）后再发起
    dup = MaterialStockIn.objects.filter(requirement=requirement) \
        .exclude(request=approval) \
        .filter(status='pending',
                request__status__in=['pending', 'deferred', 'processing']) \
        .order_by('-created_at').first()
    if dup:
        return None, f'需求单 {requirement.doc_no} 已有进行中的物资入库单（{dup.doc_no}），请等待其审批结束后再发起分批入库'
    req_items = {i.item_name: i for i in requirement.items.all()}
    for it in items:
        ri = req_items.get(it['item_name'])
        if not ri:
            return None, f'物品「{it["item_name"]}」不在需求单明细中'
        remaining = ri.quantity - ri.received_quantity
        if remaining <= 0:
            return None, f'物品「{it["item_name"]}」已全部入库，无需再入库'
        if it['quantity'] > remaining:
            return None, f'物品「{it["item_name"]}」本次入库({it["quantity"]})超出待收数量({remaining})'
    date_val = None
    if stock_date:
        try:
            date_val = dt_date.fromisoformat(str(stock_date))
        except (ValueError, TypeError):
            date_val = None
    if date_val is None:
        date_val = timezone.localdate()

    rec = MaterialStockIn.objects.filter(request=approval).first()
    if rec:
        rec.requirement = requirement
        rec.requirement_doc_no = requirement.doc_no
        rec.warehouse = warehouse
        rec.stock_date = date_val
        rec.actual_amount = actual_amount
        rec.remark = remark
        rec.save(update_fields=['requirement', 'requirement_doc_no', 'warehouse', 'stock_date',
                                'actual_amount', 'remark', 'updated_at'])
    else:
        doc_no = generate_document_no(approval.tenant, 'material_stock_in') or f'RU{approval.id}'
        rec = MaterialStockIn.objects.create(
            request=approval, tenant=approval.tenant, doc_no=doc_no,
            requirement=requirement, requirement_doc_no=requirement.doc_no,
            warehouse=warehouse, stock_date=date_val, actual_amount=actual_amount,
            remark=remark, status='pending',
            created_by=approval.applicant,
        )
    rec.items.all().delete()
    for it in items:
        MaterialStockInItem.objects.create(
            stock_in=rec, item_name=it['item_name'], spec=it['spec'],
            unit=it['unit'], quantity=it['quantity'])
    if 'doc_no' not in form_data:
        form_data['doc_no'] = rec.doc_no
    if 'requirement_doc_no' not in form_data:
        form_data['requirement_doc_no'] = requirement.doc_no
    return rec, None


def apply_stock_in(rec):
    """入库单审批通过后执行：需求单明细 received_quantity 累加 + 写入库流水 + 更新需求单状态（事务内行锁）。
    需求单全部收完 → stocked(可领用)；否则 → purchasing(采购中/部分入库)。"""
    if not rec or not rec.requirement:
        return
    with transaction.atomic():
        req_items = {i.item_name: i for i in
                     MaterialRequirementItem.objects.filter(requirement=rec.requirement)
                     .select_for_update().all()}
        applied = 0
        for it in rec.items.all():
            ri = req_items.get(it.item_name)
            if not ri:
                continue
            remaining = ri.quantity - ri.received_quantity
            add = min(it.quantity, remaining)
            if add <= 0:
                continue
            ri.received_quantity = ri.received_quantity + add
            ri.save(update_fields=['received_quantity'])
            write_stock_log(rec.tenant, item_name=ri.item_name, spec=ri.spec, delta=add,
                            ref_type='stock_in', ref_id=rec.id, doc_no=rec.doc_no,
                            operator=getattr(rec, 'created_by', None), note=f'入库单 {rec.doc_no}')
            applied += 1
        if not applied:
            return
        full = all((i.quantity - i.received_quantity) <= 0 for i in req_items.values())
        rec.requirement.status = 'stocked' if full else 'purchasing'
        rec.requirement.save(update_fields=['status', 'updated_at'])


def rebuild_ledger(tenant):
    """历史库存数据一次性落流水（物品库“重建库存流水”用）：清空本企业流水后，
    由旧的已入库需求单(整单+) 与已通过领用单(−) 重建；同步历史需求单明细 received_quantity。"""
    if not tenant:
        return 0
    MaterialStockLog.objects.filter(tenant=tenant).delete()
    n = 0
    for r in MaterialRequirement.objects.filter(tenant=tenant, status='stocked').prefetch_related('items'):
        for i in r.items.all():
            if i.received_quantity != i.quantity:
                i.received_quantity = i.quantity
                i.save(update_fields=['received_quantity'])
            write_stock_log(tenant, item_name=i.item_name, spec=i.spec, delta=i.quantity,
                            ref_type='requirement', ref_id=r.id, doc_no=r.doc_no,
                            note=f'历史整单入库 {r.doc_no}')
            n += 1
    for q in MaterialRequisition.objects.filter(tenant=tenant, status='approved').prefetch_related('items'):
        for it in q.items.all():
            write_stock_log(tenant, item_name=it.item_name, spec=it.spec, delta=-it.quantity,
                            ref_type='requisition', ref_id=q.id, doc_no=q.doc_no,
                            note=f'历史领用 {q.doc_no}')
            n += 1
    return n


def ensure_material_record(approval, form_data):
    """统一入口：按审批类型建/改物资业务记录；返回 (record, error)"""
    if approval.approval_type == 'material_requirement':
        return ensure_material_requirement(approval, form_data)
    if approval.approval_type == 'material_requisition':
        return ensure_material_requisition(approval, form_data)
    if approval.approval_type == 'material_stock_in':
        return ensure_material_stock_in(approval, form_data)
    return None, None


def write_requisition_ledger(requisition):
    """领用单审批通过后回写需求单明细的已领用数量并写库存出库流水（事务内锁行，防超领）"""
    if not requisition or not requisition.requirement:
        return
    with transaction.atomic():
        req_items = {i.item_name: i for i in
                     requisition.requirement.items.select_for_update().all()}
        for it in requisition.items.all():
            ri = req_items.get(it.item_name)
            if ri:
                take = min(it.quantity, ri.quantity - ri.requisitioned_quantity)
                if take <= 0:
                    continue
                ri.requisitioned_quantity += take
                ri.save(update_fields=['requisitioned_quantity'])
                write_stock_log(requisition.tenant, item_name=ri.item_name, spec=ri.spec,
                                delta=-take, ref_type='requisition', ref_id=requisition.id,
                                doc_no=requisition.doc_no,
                                operator=getattr(requisition, 'created_by', None),
                                note=f'领用单 {requisition.doc_no}')
