# org/permissions.py - 组织架构企业级权限控制（完善版）
from rest_framework import permissions


class OrgPermission(permissions.BasePermission):
    """组织架构企业级权限控制（按角色分级）"""

    # 任意登录用户可访问的只读操作（含切换企业）
    READONLY_ACTIONS = {
        'list', 'retrieve', 'members', 'org_chart', 'search',
        'search_tenant_members', 'search_all_users', 'path',
        'stats', 'departments', 'subordinates', 'switch',
    }

    # 部门管理员可执行的操作（仅限管辖部门）
    DEPT_ADMIN_ACTIONS = READONLY_ACTIONS | {
        'update', 'partial_update', 'create', 'destroy',
        'move', 'sort', 'set_leaders', 'set_deputies',
        'add_members', 'remove_members', 'sync_all_members',
        'rebuild_report_relations',
    }

    # TenantViewSet 中不依赖 tenant 的操作
    # switch/retrieve 的 get_object 由 get_queryset 自动限制为用户自己的企业
    _bootstrap_actions = {'list', 'create', 'retrieve', 'switch'}
    _bootstrap_views = {'TenantViewSet'}

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False

        # switch 动作：任何已登录用户都可以切换到自己所属的企业
        # TenantViewSet.get_queryset() 已按 memberships__user 过滤，绝对安全
        if view.action == 'switch':
            return True

        tenant = getattr(request, 'tenant', None)
        if not tenant:
            active = user.get_active_tenant()
            if active:
                request.tenant = active
                _set_thread_tenant(active)
                tenant = active
            else:
                return False

        if not user.tenant_memberships.filter(tenant=tenant, is_active=True).exists():
            return False

        role = user.get_tenant_role(tenant)

        # 企业所有者/管理员：全部权限
        if role in ('owner', 'admin'):
            return True

        # 部门管理员：可在管辖部门内执行管理操作
        if role == 'dept_admin':
            managed_ids = []
            for dept in user.managed_departments.filter(tenant=tenant):
                managed_ids.append(dept.id)
                managed_ids.extend(dept.get_descendant_ids())
            request._managed_dept_ids = list(set(managed_ids))
            return view.action in self.DEPT_ADMIN_ACTIONS

        # 普通成员：只读 + 切换企业
        return view.action in self.READONLY_ACTIONS

    def has_object_permission(self, request, view, obj):
        """对象级权限检查"""
        user = request.user
        if not user.is_authenticated:
            return False

        # switch 动作：get_object 由 get_queryset 保证安全，无需额外检查
        if view.action == 'switch':
            return True

        tenant = getattr(request, 'tenant', None)
        if not tenant:
            return False

        role = user.get_tenant_role(tenant)

        # owner/admin 可以操作任何对象
        if role in ('owner', 'admin'):
            return True

        # 只读操作一律放行
        if view.action in self.READONLY_ACTIONS:
            return True

        # 部门管理员：只能操作管辖内的部门
        if role == 'dept_admin':
            managed_ids = getattr(request, '_managed_dept_ids', [])
            dept_id = getattr(obj, 'id', None) or getattr(obj, 'department_id', None)
            if dept_id and dept_id in managed_ids:
                return True
            if hasattr(obj, 'tenant') and hasattr(obj, 'parent'):
                cur = obj
                while cur:
                    if cur.id in managed_ids:
                        return True
                    cur = cur.parent
            return False

        # 普通成员：检查是否是部门负责人/副负责人
        if hasattr(obj, 'manager') and obj.manager == user:
            return True
        if hasattr(obj, 'deputy_managers'):
            try:
                if user in obj.deputy_managers.all():
                    return view.action in ('update', 'partial_update', 'add_members', 'remove_members')
            except Exception:
                pass

        return False


def _set_thread_tenant(tenant):
    """设置线程级 tenant"""
    from accounts.middleware import set_current_tenant
    set_current_tenant(tenant)
