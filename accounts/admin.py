from django.contrib import admin

from .models import CustomUser, Department

@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = ('id', 'username', 'real_name', 'position', 'phone', 'email', 'is_online', 'last_seen', 'is_active')
    list_per_page = 20

@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'created_at')
    list_per_page = 20

