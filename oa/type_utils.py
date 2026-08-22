# -*- coding: utf-8 -*-
"""OA 审批类型解析与表单数据校验（供 views / serializers 复用，避免循环导入）"""
from .models import ApprovalType, ApprovalRequest

# 内置审批类型（ensure_builtin_types 播种到 ApprovalType）
BUILTIN_TYPES = [
    {'code': 'leave', 'name': '请假', 'icon': 'fa-calendar-check', 'color': '#409EFF', 'desc': ''},
    {'code': 'overtime', 'name': '加班', 'icon': 'fa-clock', 'color': '#e6a23c', 'desc': ''},
    {'code': 'expense', 'name': '报销', 'icon': 'fa-file-invoice-dollar', 'color': '#67c23a', 'desc': ''},
    {'code': 'trip', 'name': '出差', 'icon': 'fa-plane', 'color': '#9b59b6', 'desc': ''},
    {'code': 'purchase', 'name': '采购', 'icon': 'fa-cart-plus', 'color': '#f56c6c', 'desc': ''},
    {'code': 'recruit', 'name': '招聘需求', 'icon': 'fa-user-plus', 'color': '#e6a23c', 'desc': ''},
    {'code': 'other', 'name': '其他', 'icon': 'fa-file-lines', 'color': '#909399', 'desc': ''},
    # 物资需求单：分公司负责人 → 集团采购部；采购入库后可被领用
    {'code': 'material_requirement', 'name': '物资需求单', 'icon': 'fa-box-open', 'color': '#16a085',
     'desc': '分公司物资需求，采购入库后生成可领用额度',
     'form_schema': [
         {'key': 'branch_dept', 'label': '分公司', 'type': 'department', 'required': True, 'scope': 'company'},
         {'key': 'amount', 'label': '预估金额', 'type': 'amount', 'required': True},
         {'key': 'purpose', 'label': '用途', 'type': 'textarea', 'required': True},
         {'key': 'items', 'label': '物资明细', 'type': 'struct_table', 'required': True,
          'columns': [
              {'key': 'item_name', 'label': '物品名称', 'type': 'item'},
              {'key': 'spec', 'label': '规格型号', 'type': 'text'},
              {'key': 'unit', 'label': '单位', 'type': 'text'},
              {'key': 'price', 'label': '单价', 'type': 'amount'},
              {'key': 'quantity', 'label': '数量', 'type': 'number'},
              {'key': 'remark', 'label': '备注', 'type': 'text'},
          ]},
     ]},
    # 物资领用单：关联需求单自动带出明细（只读锁定），产品金额=需求单预估金额，经集团物资部审核后领用
    {'code': 'material_requisition', 'name': '物资领用单', 'icon': 'fa-box', 'color': '#e6a23c',
     'desc': '关联需求单自动同步物品数量，审核通过后领料',
     'form_schema': [
         {'key': 'link_req', 'label': '关联需求单', 'type': 'link_requisition', 'required': True, 'target': 'items'},
         {'key': 'amount', 'label': '产品金额', 'type': 'amount', 'required': True, 'readonly': True},
         {'key': 'items', 'label': '领用明细', 'type': 'struct_table', 'required': True, 'readonly': True,
          'columns': [
              {'key': 'item_name', 'label': '物品名称', 'type': 'item'},
              {'key': 'spec', 'label': '规格型号', 'type': 'text'},
              {'key': 'unit', 'label': '单位', 'type': 'text'},
              {'key': 'price', 'label': '单价', 'type': 'amount'},
              {'key': 'quantity', 'label': '数量', 'type': 'number'},
              {'key': 'remark', 'label': '备注', 'type': 'text'},
          ]},
         {'key': 'purpose', 'label': '用途', 'type': 'textarea', 'required': True},
     ]},
]


def ensure_builtin_types():
    """确保内置审批类型存在（幂等，首次访问自动播种）；表未迁移时静默跳过"""
    try:
        for t in BUILTIN_TYPES:
            defaults = {
                'name': t['name'], 'icon': t['icon'], 'color': t['color'],
                'description': t['desc'], 'is_builtin': True, 'enabled': True,
                'sort_order': 0,
                'form_schema': t.get('form_schema', []),
            }
            obj, created = ApprovalType.objects.get_or_create(
                tenant=None, code=t['code'], defaults=defaults,
            )
            # 已存在的内置类型：同步 form_schema（内置类型表单锁定，企业侧仅可开关启用）
            if not created and obj.is_builtin and t.get('form_schema') and obj.form_schema != t['form_schema']:
                obj.form_schema = t['form_schema']
                obj.save(update_fields=['form_schema'])
    except Exception:
        pass


def resolve_approval_type(code, tenant):
    """按 (tenant, code) 优先、全局 (None, code) 兜底解析审批类型。

    表未迁移/数据库异常时降级返回 None，避免审批列表/详情/配置序列化整体 500。
    """
    if not code:
        return None
    try:
        qs = ApprovalType.objects.filter(code=code, enabled=True)
        if tenant:
            t = qs.filter(tenant=tenant).first()
            if t:
                return t
        return qs.filter(tenant__isnull=True).first()
    except Exception:
        return None


def collect_form_data(validated_data, form_data=None, approval_type=None):
    """把内置类型的 legacy 字段镜像进 form_data，统一阈值/详情取值"""
    form_data = dict(form_data or {})
    if approval_type in ('leave', 'overtime', 'trip'):
        if validated_data.get('duration') is not None:
            form_data['duration'] = float(validated_data['duration'])
    if approval_type in ('expense', 'purchase'):
        if validated_data.get('amount') is not None:
            form_data['amount'] = float(validated_data['amount'])
    if approval_type == 'expense':
        if validated_data.get('expense_type'):
            form_data['expense_type'] = validated_data['expense_type']
        if validated_data.get('expense_date'):
            form_data['expense_date'] = str(validated_data['expense_date'])
    if approval_type == 'recruit':
        rd = validated_data.get('recruit_data') or {}
        if rd:
            form_data['recruit_data'] = rd
            hc = rd.get('headcount')
            if hc:
                try:
                    form_data['headcount'] = float(hc)
                except (ValueError, TypeError):
                    pass
    return form_data


def validate_form_data(schema, form_data):
    """按 schema 校验 form_data：必填、类型、选项合法性。返回错误 dict 或 None"""
    if not schema:
        return None
    errors = {}
    for f in schema:
        key = f.get('key')
        if not key:
            continue
        required = bool(f.get('required'))
        value = form_data.get(key)
        ftype = f.get('type')
        if required and value in (None, '', [], {}):
            errors[key] = f'{f.get("label") or key}为必填项'
            continue
        if value in (None, ''):
            continue
        if ftype == 'expense_type':
            valid_keys = [c[0] for c in ApprovalRequest.EXPENSE_TYPE_CHOICES]
            if str(value) not in valid_keys:
                errors[key] = f'{f.get("label") or key}的费用类型不在可选范围内'
        elif ftype == 'struct_table':
            if not isinstance(value, list):
                errors[key] = f'{f.get("label") or key}明细格式错误'
        if ftype in ('select', 'radio', 'checkbox'):
            options = [str(o.get('value')) if isinstance(o, dict) else str(o) for o in (f.get('options') or [])]
            vals = value if isinstance(value, list) else [value]
            for v in vals:
                if str(v) not in options:
                    errors[key] = f'{f.get("label") or key}的值不在可选范围内'
                    break
    return errors or None
