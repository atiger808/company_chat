# org/filters.py - 多租户 DRF 过滤器
from rest_framework.filters import BaseFilterBackend


class TenantFilterBackend(BaseFilterBackend):
    """DRF 过滤器：自动按当前企业过滤数据"""

    def filter_queryset(self, request, queryset, view):
        tenant = getattr(request, 'tenant', None)
        model_has_tenant = hasattr(queryset.model, 'tenant')

        # 模型没有 tenant 字段 → 不隔离，直接返回
        if not model_has_tenant:
            return queryset

        # if tenant is None:
        #     return queryset.none()

        if tenant is None:
            return queryset  # ← 无企业时返回 ALL 数据
            # return queryset.none()   # ← 注释掉了

        if request.user.is_superuser:
            return queryset  # ← 超管绕过隔离


        return queryset.filter(tenant=tenant)
