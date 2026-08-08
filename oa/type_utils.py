# -*- coding: utf-8 -*-
"""OA 审批类型解析与表单数据校验（供 views / serializers 复用，避免循环导入）"""
from .models import ApprovalType

# 内置审批类型（ensure_builtin_types 播种到 ApprovalType）
BUILTIN_TYPES = [
    {'code': 'leave', 'name': '请假', 'icon': 'fa-calendar-check', 'color': '#409EFF', 'desc': ''},
    {'code': 'overtime', 'name': '加班', 'icon': 'fa-clock', 'color': '#e6a23c', 'desc': ''},
    {'code': 'expense', 'name': '报销', 'icon': 'fa-file-invoice-dollar', 'color': '#67c23a', 'desc': ''},
    {'code': 'trip', 'name': '出差', 'icon': 'fa-plane', 'color': '#9b59b6', 'desc': ''},
    {'code': 'purchase', 'name': '采购', 'icon': 'fa-cart-plus', 'color': '#f56c6c', 'desc': ''},
    {'code': 'recruit', 'name': '招聘需求', 'icon': 'fa-user-plus', 'color': '#e6a23c', 'desc': ''},
    {'code': 'other', 'name': '其他', 'icon': 'fa-file-lines', 'color': '#909399', 'desc': ''},
]


def ensure_builtin_types():
    """确保内置审批类型存在（幂等，首次访问自动播种）；表未迁移时静默跳过"""
    try:
        for t in BUILTIN_TYPES:
            ApprovalType.objects.get_or_create(
                tenant=None, code=t['code'],
                defaults={
                    'name': t['name'], 'icon': t['icon'], 'color': t['color'],
                    'description': t['desc'], 'is_builtin': True, 'enabled': True,
                    'sort_order': 0,
                }
            )
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
        if ftype in ('select', 'radio', 'checkbox'):
            options = [str(o.get('value')) if isinstance(o, dict) else str(o) for o in (f.get('options') or [])]
            vals = value if isinstance(value, list) else [value]
            for v in vals:
                if str(v) not in options:
                    errors[key] = f'{f.get("label") or key}的值不在可选范围内'
                    break
    return errors or None
