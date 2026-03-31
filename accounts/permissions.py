# accounts/permissions.py

from rest_framework import permissions


class IsSuperAdmin(permissions.BasePermission):
    """超级管理员权限：只能由 is_superuser=True 的用户访问"""

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and request.user.is_superuser

    def has_object_permission(self, request, view, obj):
        return request.user.is_superuser


class IsAdminOrSuperAdmin(permissions.BasePermission):
    """管理员或超级管理员权限：普通管理员和超级管理员都可访问"""

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and (
                request.user.is_superuser or request.user.user_type in ['admin', 'super_admin']
        )

    def has_object_permission(self, request, view, obj):
        # 普通管理员只能管理同部门或下级部门的用户
        if request.user.is_superuser:
            return True
        # if hasattr(obj, 'department') and request.user.department:
        #     return obj.department_id == request.user.department_id
        return False


class IsAdminUserManagement(permissions.BasePermission):
    """用户管理专用权限：普通管理员可管理用户，但不能管理超级管理员"""

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and (
                request.user.is_superuser or request.user.user_type in ['admin', 'super_admin']
        )

    def has_object_permission(self, request, view, obj):
        # 不能管理超级管理员
        if obj.is_superuser:
            return False

        # 普通管理员只能管理同部门用户
        # if not request.user.is_superuser and hasattr(obj, 'department'):
        #     return obj.department_id == request.user.department_id

        return True

    