from django.contrib import admin
from .models import AttendanceRecord, ApprovalRequest, ApprovalLog, ApprovalNode, ApprovalAssignee, WorkNotification


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ['user', 'clock_type', 'clock_time', 'date', 'status', 'location']
    list_filter = ['clock_type', 'status', 'date']
    search_fields = ['user__username', 'user__real_name', 'location']


@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ['applicant', 'title', 'approval_type', 'status', 'sign_type', 'approval_mode', 'created_at']
    list_filter = ['status', 'approval_type', 'sign_type', 'approval_mode']
    search_fields = ['title', 'applicant__username', 'applicant__real_name']


@admin.register(ApprovalLog)
class ApprovalLogAdmin(admin.ModelAdmin):
    list_display = ['request', 'operator', 'action', 'created_at']


@admin.register(ApprovalNode)
class ApprovalNodeAdmin(admin.ModelAdmin):
    list_display = ['request', 'node_type', 'user', 'department', 'order']


@admin.register(ApprovalAssignee)
class ApprovalAssigneeAdmin(admin.ModelAdmin):
    list_display = ['node', 'user', 'status', 'operated_at']
    list_filter = ['status']


@admin.register(WorkNotification)
class WorkNotificationAdmin(admin.ModelAdmin):
    list_display = ['recipient', 'notification_type', 'title', 'is_read', 'created_at']
    list_filter = ['notification_type', 'is_read']
    search_fields = ['title', 'content', 'recipient__username']
