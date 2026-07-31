# accounts/managers.py - 多租户隔离 Manager

from django.db import models


class TenantQuerySet(models.QuerySet):
    """自动过滤当前企业数据的 QuerySet"""

    def for_tenant(self, tenant):
        """按企业过滤"""
        if tenant is None:
            return self.none()
        return self.filter(tenant=tenant)

    def for_user(self, user):
        """按用户当前激活企业过滤"""
        tenant = user.get_active_tenant()
        return self.for_tenant(tenant)


class TenantManager(models.Manager):
    """自动隔离的 Manager"""

    def get_queryset(self):
        return TenantQuerySet(self.model, using=self._db)

    def for_tenant(self, tenant):
        return self.get_queryset().for_tenant(tenant)

    def for_user(self, user):
        return self.get_queryset().for_user(user)
