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
    MaterialRequirement,
    MaterialRequirementItem,
    MaterialRequisition,
    MaterialRequisitionItem,
)

# 单据类型 → 单号前缀
DOC_PREFIX = {
    'material_requirement': 'XQ',  # 需求单
    'material_requisition': 'LY',  # 领用单
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


def ensure_material_record(approval, form_data):
    """统一入口：按审批类型建/改物资业务记录；返回 (record, error)"""
    if approval.approval_type == 'material_requirement':
        return ensure_material_requirement(approval, form_data)
    if approval.approval_type == 'material_requisition':
        return ensure_material_requisition(approval, form_data)
    return None, None


def write_requisition_ledger(requisition):
    """领用单审批通过后回写需求单明细的已领用数量（事务内锁行，防超领）"""
    if not requisition or not requisition.requirement:
        return
    with transaction.atomic():
        req_items = {i.item_name: i for i in
                     requisition.requirement.items.select_for_update().all()}
        for it in requisition.items.all():
            ri = req_items.get(it.item_name)
            if ri:
                ri.requisitioned_quantity += it.quantity
                ri.save(update_fields=['requisitioned_quantity'])
