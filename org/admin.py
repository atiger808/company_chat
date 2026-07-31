# org/admin.py
from django.contrib import admin
from .models import UserDepartment, ReportRelation, OrgChangeLog


@admin.register(UserDepartment)
class UserDepartmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'department', 'is_primary', 'position', 'join_date')
    list_filter = ('is_primary',)
    search_fields = ('user__username', 'department__name', 'position')
    list_per_page = 20


@admin.register(ReportRelation)
class ReportRelationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'supervisor', 'department', 'is_direct')
    list_filter = ('is_direct',)
    search_fields = ('user__username', 'supervisor__username')
    list_per_page = 20


@admin.register(OrgChangeLog)
class OrgChangeLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'action', 'department', 'operator', 'created_at')
    list_filter = ('action',)
    search_fields = ('department__name', 'operator__username')
    list_per_page = 20
