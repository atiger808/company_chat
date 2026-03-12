from django.contrib import admin

from .models import CustomUser, Department, LoginLog, OperationLog

@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'real_name', 'position', 'phone', 'email', 'is_online', 'last_seen', 'is_active')
    list_per_page = 20

@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'created_at')
    list_per_page = 20



class CustomLoginLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'ip', 'agent', 'browser', 'os', 'login_type', 'create_time')
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