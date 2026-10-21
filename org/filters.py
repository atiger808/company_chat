# org/filters.py - 多租户 DRF 过滤器
from django.core.cache import cache
from django.db.models import Q
from rest_framework.filters import BaseFilterBackend
from loguru import logger

# 全局配置键：企业/租户数据是否隔离
#   true  = 完整隔离（按账号当前企业过滤数据；未归属企业的账号看不到带 tenant 的数据）
#   false = 关闭隔离（保持历史行为：能解析到企业时按企业过滤，否则共享）
ISOLATION_CONFIG_KEY = 'security.tenant_data_isolation'
ISOLATION_CACHE_KEY = 'tenant_data_isolation'

# 历史数据（tenant 为空）无法直接按企业过滤时，尝试用「创建人/归属人」推断其所属企业
_LEGACY_OWNER_FIELDS = ('creator', 'created_by', 'owner', 'user', 'sender', 'applicant')


def is_tenant_isolation_enabled():
    """是否开启企业/租户数据隔离（默认关闭）。

    读取顺序：缓存 → SystemConfig → 默认 False。
    缓存/表未迁移等异常一律降级为默认关闭，避免影响现有业务。
    """
    try:
        cached = cache.get(ISOLATION_CACHE_KEY)
        if cached is not None:
            return bool(cached)
    except Exception:
        pass

    enabled = False
    try:
        from chat.models import SystemConfig
        enabled = bool(SystemConfig.get_config(ISOLATION_CONFIG_KEY, default=False))
    except Exception:
        enabled = False

    try:
        cache.set(ISOLATION_CACHE_KEY, enabled, 300)
    except Exception:
        pass
    return enabled


def clear_tenant_isolation_cache():
    """配置变更后清除缓存，让隔离开关立即生效。"""
    try:
        cache.delete(ISOLATION_CACHE_KEY)
    except Exception:
        pass


def resolve_tenant_for_request(request):
    """解析当前请求对应的企业/租户。

    背景：JWT 认证由 DRF 在视图阶段完成，而 Django 中间件（TenantMiddleware）
    执行时 request.user 仍为匿名，因此 API 请求的 request.tenant 通常为空。
    这里在认证完成后（过滤器执行时）重新解析：
      1) request 上已解析/已设置过 → 直接复用；
      2) X-Tenant-Id 请求头（前端切换企业时携带）且用户属于该企业 → 使用；
      3) 用户当前激活企业（切换企业接口会更新 user.active_tenant）。
    """
    if getattr(request, '_tenant_resolved', False):
        return getattr(request, 'tenant', None)

    tenant = getattr(request, 'tenant', None)
    if tenant is not None:
        try:
            request._tenant_resolved = True
        except Exception:
            pass
        return tenant

    user = getattr(request, 'user', None)
    if not user or not getattr(user, 'is_authenticated', False):
        try:
            request._tenant_resolved = True
        except Exception:
            pass
        return None

    tenant_id = None
    try:
        tenant_id = request.headers.get('X-Tenant-Id')
    except Exception:
        tenant_id = None

    if tenant_id:
        try:
            from accounts.models import Tenant
            candidate = Tenant.objects.filter(id=tenant_id, is_active=True).first()
            if candidate and user.tenant_memberships.filter(
                    tenant=candidate, is_active=True).exists():
                try:
                    request.tenant = candidate
                    request._tenant_resolved = True
                except Exception:
                    pass
                return candidate
        except Exception:
            pass

    try:
        tenant = user.get_active_tenant()
    except Exception:
        tenant = None

    try:
        request.tenant = tenant
        request._tenant_resolved = True
    except Exception:
        pass
    return tenant


def _legacy_tenant_q(model, tenant):
    """为 tenant 为空的历史数据构造「按创建人所属企业归属」的查询条件。

    多租户改造前创建的数据没有写 tenant 字段；开启隔离后如果只按 tenant 过滤，
    这些老数据会全部消失。这里按创建人/归属人当前所属企业兜底归属，保证老数据可见。
    """
    for name in _LEGACY_OWNER_FIELDS:
        try:
            field = model._meta.get_field(name)
        except Exception:
            continue
        if not getattr(field, 'is_relation', False):
            continue
        related = getattr(field, 'related_model', None)
        if related is None or related._meta.label_lower != 'accounts.customuser':
            continue
        return Q(**{
            name + '__tenant_memberships__tenant': tenant,
            name + '__tenant_memberships__is_active': True,
        })
    return None


class TenantFilterBackend(BaseFilterBackend):
    """DRF 过滤器：自动按当前企业过滤数据

    规则：
      - 模型没有 tenant 字段 → 不隔离
      - 超级管理员（is_superuser）→ 不隔离，可查看全部
      - 数据隔离开关关闭（默认）→ 保持历史行为：能解析到企业时按企业过滤，否则共享
      - 数据隔离开关开启：
          · 解析当前账号的企业（中间件失效时从登录用户/切换企业信息补齐）
          · 未归属企业 → 空集（完整隔离）
          · 已归属企业 → 按企业过滤；tenant 为空的历史数据按创建人所属企业兜底归属
    """

    def filter_queryset(self, request, queryset, view):
        # 模型没有 tenant 字段 → 不隔离
        if not hasattr(queryset.model, 'tenant'):
            return queryset

        # 超级管理员可查看全部（保持既有行为，且不受隔离开关影响）
        if getattr(request.user, 'is_superuser', False):
            return queryset

        if not is_tenant_isolation_enabled():
            # 关闭隔离：沿用历史行为（中间件能解析到企业时仍按企业过滤；解析不到则共享）
            tenant = getattr(request, 'tenant', None)
            return queryset.filter(tenant=tenant) if tenant is not None else queryset

        # 开启隔离：从认证后的用户/切换企业信息中解析当前企业
        tenant = resolve_tenant_for_request(request)
        if tenant is None:
            logger.info(f'user: {request.user} --> 未归属企业的历史账号, 已开启数据隔离 ')
            return queryset.none()

        # 按当前企业过滤；历史数据 tenant 为空时按创建人所属企业兜底归属
        legacy_q = _legacy_tenant_q(queryset.model, tenant)
        if legacy_q is not None:
            return queryset.filter(
                Q(tenant=tenant) | (Q(tenant__isnull=True) & legacy_q)
            ).distinct()
        return queryset.filter(tenant=tenant)
