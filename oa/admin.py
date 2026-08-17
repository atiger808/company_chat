from django.contrib import admin
from .models import (
    AttendanceRecord, ApprovalRequest, ApprovalLog,
    ApprovalNode, ApprovalAssignee, WorkNotification,
    ApprovalCarbonCopy, ApprovalDeptConfig,
    ApprovalType, SubsidyApplication,
    SubsidyPayment, SubsidyConfig,
    SubsidyWithdrawal, SubsidyWallet,
    SubsidyInvoiceVerifyRecord,
    DailyDigestConfig,

)


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'clock_type', 'clock_time', 'date', 'status', 'location']
    list_filter = ['clock_type', 'status', 'date']
    search_fields = ['id', 'user__username', 'user__real_name', 'location']
    list_per_page = 20


@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'applicant', 'title', 'approval_type', 'status', 'sign_type', 'approval_mode', 'updated_at',
                    'created_at']
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
    list_display = ['id', 'tenant', 'sub_tenant', 'approval_type', 'require_signature', 'final_approver',
                    'threshold_enabled', 'threshold_field', 'department', 'updated_at', 'created_at']
    list_filter = ['approval_type', 'require_signature', 'threshold_enabled', 'threshold_field']
    search_fields = ['tenant__name', 'department__name']
    list_per_page = 20



@admin.register(ApprovalType)
class ApprovalTypeAdmin(admin.ModelAdmin):
    list_display = ['id', 'code', 'name', 'icon', 'color', 'enabled', 'is_builtin', 'sort_order', 'updated_at', 'created_at']
    list_filter = ['enabled', 'is_builtin']
    search_fields = ['code', 'name', 'tenant__name']
    list_per_page = 20


@admin.register(SubsidyApplication)
class SubsidyApplicationAdmin(admin.ModelAdmin):
    list_display = ['id', 'applicant', 'tenant', 'invoice_type', 'tax_rate', 'invoice_number', 'invoice_original_name', 'buyer_name', 'seller_name', 'invoice_date', 'invoice_amount', 'verified_at', 'verified_by', 'updated_at', 'created_at']
    list_filter = ['status', 'invoice_type', 'tax_rate']
    search_fields = ['application_no', 'invoice_number', 'buyer_name', 'seller_name', 'invoice_code', 'invoice_original_name', 'applicant__username', 'applicant__real_name', 'tenant__name']
    list_per_page = 20


@admin.register(SubsidyPayment)
class SubsidyPaymentAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'tenant', 'amount', 'paid_at']
    search_fields = ['user__username', 'user__real_name', 'tenant__name', 'note']
    list_per_page = 20

@admin.register(SubsidyConfig)
class SubsidyConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'sub_tenant', 'department', 'enabled', 'special_rate', 'ordinary_rate', 'tax_rate_threshold', 'updated_at', 'created_at']
    list_filter = ['enabled', ]
    search_fields = ['verifiers__username', 'verifiers__real_name', 'tenant__name']
    list_per_page = 20

@admin.register(SubsidyWithdrawal)
class SubsidyWithdrawalAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'tenant', 'amount', 'status', 'paid_at', 'requested_at']
    list_filter = ['status', ]
    search_fields = ['user__username', 'user__real_name', 'tenant__name', 'note']
    list_per_page = 20

@admin.register(SubsidyWallet)
class SubsidyWalletAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'tenant', 'balance', 'total_in', 'total_out', 'updated_at', 'created_at']
    search_fields = ['user__username', 'user__real_name', 'tenant__name']
    list_per_page = 20

@admin.register(SubsidyInvoiceVerifyRecord)
class SubsidyInvoiceVerifyRecordAdmin(admin.ModelAdmin):
    list_display = ['id', 'invoice_md5', 'result', 'message', 'verified_by', 'verified_at']
    search_fields = ['id', 'invoice_md5', 'result', 'message', 'verified_by__username', 'verified_by__real_name']
    list_filter = ['result']
    list_per_page = 20

@admin.register(DailyDigestConfig)
class DailyDigestConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'enabled', 'auto_send', 'send_time', 'last_sent_date', 'updated_at']
    search_fields = ['id', 'tenant__name']
    list_filter = ['enabled', 'auto_send']
    list_per_page = 20


