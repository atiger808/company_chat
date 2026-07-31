from django.contrib import admin

from .models import CustomUser, Department, LoginLog, OperationLog, ConsultationRequest, UserActivity, Tenant, TenantMembership

@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'short_name', 'code', 'tenant_type', 'owner', 'is_active', 'is_verified', 'created_at')
    list_filter = ('tenant_type', 'is_active')
    search_fields = ('name', 'code', 'short_name')
    list_per_page = 20

@admin.register(TenantMembership)
class TenantMembershipAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'tenant', 'role', 'is_active', 'is_default', 'joined_at')
    list_filter = ('role', 'is_active')
    search_fields = ('user__username', 'tenant__name', 'employee_id')
    list_per_page = 20

@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'real_name', 'gender', 'position', 'phone', 'email', 'is_online', 'is_active', 'last_seen', 'date_joined')
    list_filter = ('is_active', 'is_online', 'gender', 'user_type')
    search_fields = ('username', 'real_name', 'phone', 'email')
    list_per_page = 20

@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'code', 'tenant_name', 'parent_name', 'manager_name', 'member_count', 'is_active', 'updated_at')
    list_filter = ('is_active', 'tenant')
    search_fields = ('name', 'code', 'full_path', 'tenant__name')
    list_per_page = 20

    def tenant_name(self, obj):
        return obj.tenant.short_name or obj.tenant.name if obj.tenant else '-'
    tenant_name.short_description = '所属企业'
    tenant_name.admin_order_field = 'tenant__name'

    def parent_name(self, obj):
        return obj.parent.name if obj.parent else '-'
    parent_name.short_description = '上级部门'
    parent_name.admin_order_field = 'parent__name'

    def manager_name(self, obj):
        return obj.manager.real_name or obj.manager.username if obj.manager else '-'
    manager_name.short_description = '负责人'

    def member_count(self, obj):
        return obj.get_member_count()
    member_count.short_description = '成员数'


@admin.register(UserActivity)
class UserActivityAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'action', 'description', 'ip_address', 'created_at')
    list_filter = ['action']
    search_fields = ('description', 'ip_address', 'id')
    list_per_page = 20


@admin.register(ConsultationRequest)
class ConsultationRequestAdmin(admin.ModelAdmin):
    list_display = ('id', 'company_name', 'contact_name', 'phone', 'email', 'demand_type', 'message', 'status', 'created_at')
    list_filter = ('status', 'demand_type')
    search_fields = ('company_name', 'contact_name', 'phone', 'email', 'message')
    list_per_page = 20



class CustomLoginLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'ip', 'city', 'district', 'agent', 'browser', 'os', 'create_time')
    list_filter = ['login_type', 'os', 'browser']
    search_fields = ('username', 'ip')
    list_per_page = 20


class CustomOperationLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'request_modular', 'creator', 'request_path', 'request_method', 'request_ip', 'request_browser', 'response_code', 'request_os', 'status', 'create_time')
    list_filter = ['request_os', 'request_method', 'status', 'response_code', 'request_browser']
    search_fields = ('request_path', 'request_ip', 'request_modular')
    list_per_page = 20





admin.site.register(LoginLog,  CustomLoginLogAdmin)
admin.site.register(OperationLog, CustomOperationLogAdmin)