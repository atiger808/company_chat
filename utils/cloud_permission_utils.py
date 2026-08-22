# -*- coding: utf-8 -*-
# utils/cloud_permission_utils.py
# 企业操作权限（允许打印/允许文件下载/允许公开分享）生效逻辑：
#   全局配置存 CloudSystemConfig(key=cloud_operation_permissions)；
#   用户自定义配置存 UserCloudOperationPermission；用户配置存在且启用时覆盖全局。
import json

GLOBAL_PERM_KEY = 'cloud_operation_permissions'
DEFAULT_OPERATION_PERMISSIONS = {
    'allow_print': False,          # 允许打印（默认关闭，需管理员开启）
    'allow_download': True,        # 允许文件下载
    'allow_public_share': True,    # 允许公开分享
}
GLOBAL_PERM_NAME = '企业操作权限'
GLOBAL_PERM_DESC = '允许打印/允许文件下载/允许公开分享 全局开关'


def get_global_operation_permissions(tenant):
    """读取全局操作权限配置（不存在时播种默认值），返回 dict"""
    from cloud.models import CloudSystemConfig
    cfg, _ = CloudSystemConfig.objects.get_or_create(
        tenant=tenant, key=GLOBAL_PERM_KEY,
        defaults={
            'name': GLOBAL_PERM_NAME,
            'value': json.dumps(DEFAULT_OPERATION_PERMISSIONS, ensure_ascii=False),
            'value_type': 'json',
            'category': 'system',
            'is_editable': True,
            'description': GLOBAL_PERM_DESC,
        })
    try:
        val = json.loads(cfg.value or '{}')
    except (ValueError, TypeError):
        val = {}
    out = dict(DEFAULT_OPERATION_PERMISSIONS)
    if isinstance(val, dict):
        out.update({k: v for k, v in val.items() if k in DEFAULT_OPERATION_PERMISSIONS})
    return out


def save_global_operation_permissions(tenant, permissions):
    """保存全局操作权限配置，返回保存后的 dict"""
    from cloud.models import CloudSystemConfig
    cfg, _ = CloudSystemConfig.objects.get_or_create(
        tenant=tenant, key=GLOBAL_PERM_KEY,
        defaults={
            'name': GLOBAL_PERM_NAME,
            'value': json.dumps(DEFAULT_OPERATION_PERMISSIONS, ensure_ascii=False),
            'value_type': 'json',
            'category': 'system',
            'is_editable': True,
            'description': GLOBAL_PERM_DESC,
        })
    clean = {k: bool(permissions.get(k, DEFAULT_OPERATION_PERMISSIONS[k]))
             for k in DEFAULT_OPERATION_PERMISSIONS}
    cfg.value = json.dumps(clean, ensure_ascii=False)
    cfg.save(update_fields=['value'])
    return clean


def get_effective_operation_permission(user, perm, tenant=None):
    """计算某用户某项操作权限的生效值（用户自定义配置覆盖全局）"""
    if perm not in DEFAULT_OPERATION_PERMISSIONS:
        return False
    try:
        from cloud.models import UserCloudOperationPermission
        perm_record = UserCloudOperationPermission.objects.filter(user=user, is_active=True).first()
    except Exception:
        perm_record = None
    if perm_record is not None:
        return bool(getattr(perm_record, perm, DEFAULT_OPERATION_PERMISSIONS[perm]))
    global_perms = get_global_operation_permissions(tenant)
    return bool(global_perms.get(perm, DEFAULT_OPERATION_PERMISSIONS[perm]))
