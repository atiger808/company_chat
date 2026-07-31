from django.contrib import admin
from .models import AttendanceRecord, ApprovalRequest, ApprovalLog, ApprovalNode, ApprovalAssignee, WorkNotification, ApprovalCarbonCopy, ApprovalDeptConfig


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'clock_type', 'clock_time', 'date', 'status', 'location']
    list_filter = ['clock_type', 'status', 'date']
    search_fields = ['id', 'user__username', 'user__real_name', 'location']
    list_per_page = 20


@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'applicant', 'title', 'approval_type', 'status', 'sign_type', 'approval_mode', 'updated_at', 'created_at']
    list_filter = ['status', 'approval_type', 'sign_type', 'approval_mode']
    search_fields = ['id', 'title', 'applicant__username', 'applicant__real_name']
    list_per_page = 20


@admin.register(ApprovalLog)
class ApprovalLogAdmin(admin.ModelAdmin):
    list_display = ['id', 'request', 'operator', 'action', 'created_at']
    list_filter = ['action']
    search_fields = ['request__title', 'operator__username', 'operator__real_name']
    list_per_page = 20


@admin.register(ApprovalNode)
class ApprovalNodeAdmin(admin.ModelAdmin):
    list_display = ['id', 'request', 'node_type', 'user', 'department', 'order']
    list_filter = ['node_type']
    search_fields = ['request__title', 'user__username', 'user__real_name', 'department__name']
    list_per_page = 20


@admin.register(ApprovalAssignee)
class ApprovalAssigneeAdmin(admin.ModelAdmin):
    list_display = ['id', 'node', 'user', 'status', 'operated_at']
    list_filter = ['status']
    search_fields = ['user__username', 'user__real_name']
    list_per_page = 20


@admin.register(WorkNotification)
class WorkNotificationAdmin(admin.ModelAdmin):
    list_display = ['id', 'recipient', 'notification_type', 'title', 'is_read', 'created_at']
    list_filter = ['notification_type', 'is_read']
    search_fields = ['title', 'content', 'recipient__username']
    list_per_page = 20


@admin.register(ApprovalCarbonCopy)
class ApprovalCarbonCopyAdmin(admin.ModelAdmin):
    list_display = ['id', 'request', 'cc_type', 'cc_user', 'cc_department', 'created_at']
    list_filter = ['cc_type']


@admin.register(ApprovalDeptConfig)
class ApprovalDeptConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'approval_type', 'require_signature', 'threshold_enabled', 'threshold_field', 'department', 'updated_at', 'created_at']
    list_filter = ['approval_type', 'require_signature', 'threshold_enabled', 'threshold_field']
    search_fields = ['tenant__name', 'department__name']
    list_per_page = 20
