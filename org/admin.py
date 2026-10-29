# org/admin.py
from django.contrib import admin
from .models import UserDepartment, ReportRelation, OrgChangeLog


@admin.register(UserDepartment)
class UserDepartmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'department', 'is_primary', 'position', 'join_date')
    list_filter = ('is_primary',)
    search_fields = ('user__username', 'user__real_name', 'department__name', 'position')
    list_per_page = 20


@admin.register(ReportRelation)
class ReportRelationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'tenant', 'supervisor', 'department', 'is_direct')
    list_filter = ('is_direct', 'tenant')
    search_fields = ('user__username', 'user__real_name', 'supervisor__username', 'supervisor__real_name')
    list_per_page = 20


@admin.register(OrgChangeLog)
class OrgChangeLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'action', 'tenant', 'department', 'operator', 'created_at')
    list_filter = ('action', 'tenant')
    search_fields = ('department__name', 'operator__username', 'operator__real_name')
    list_per_page = 20
