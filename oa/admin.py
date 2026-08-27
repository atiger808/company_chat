from django.contrib import admin
from .models import (
    AttendanceRecord, AttendanceConfig,
    UserAttendanceConfig,
    ApprovalRequest, ApprovalLog,
    ApprovalNode, ApprovalAssignee, WorkNotification,
    ApprovalCarbonCopy, ApprovalDeptConfig,
    CustomPaymentMethod,
    ApprovalType, SubsidyApplication,
    SubsidyPayment, SubsidyConfig,
    SubsidyWithdrawal, SubsidyWallet,
    SubsidyInvoiceVerifyRecord,
    DailyDigestConfig,
    MaterialItem,
    MaterialRequirement, MaterialRequirementItem,
    MaterialRequisition, MaterialRequisitionItem,
    DocumentSequence, WatermarkConfig, PrintLog,
    DailyWorkSummary, WorkSummaryRangeAnalysis,
    WorkSummaryConfig,
)


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'clock_type', 'clock_time', 'date', 'status', 'location']
    list_filter = ['clock_type', 'status', 'date']
    search_fields = ['id', 'user__username', 'user__real_name', 'location']
    list_per_page = 20

@admin.register(AttendanceConfig)
class AttendanceConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'sub_tenant', 'department', 'shift_type', 'makeup_allowance', 'clock_out_limit', 'clock_in_enabled', 'clock_in_time', 'clock_out_enabled', 'clock_out_time', 'updated_at', 'created_at']
    list_filter = ['clock_in_enabled', 'clock_out_enabled', 'shift_type']
    search_fields = ['id', 'tenant__name', 'sub_tenant__name', 'department__name']
    list_per_page = 20

@admin.register(UserAttendanceConfig)
class UserAttendanceConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'shift_type', 'makeup_allowance', 'clock_out_limit', 'clock_in_enabled', 'clock_in_time', 'clock_out_enabled', 'clock_out_time', 'updated_at', 'created_at']
    list_filter = ['clock_in_enabled', 'clock_out_enabled', 'shift_type']
    search_fields = ['id', 'user__username', 'user__real_name']
    list_per_page = 20


@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ['id', 'applicant', 'title', 'approval_type', 'status', 'receipt_deadline', 'sign_type', 'approval_mode', 'updated_at',
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
    list_display = ['id', 'recipient', 'notification_type', 'title', 'content', 'is_read', 'created_at']
    list_filter = ['notification_type', 'is_read']
    search_fields = ['title', 'content', 'recipient__username']
    list_per_page = 20


@admin.register(ApprovalCarbonCopy)
class ApprovalCarbonCopyAdmin(admin.ModelAdmin):
    list_display = ['id', 'request', 'cc_type', 'cc_user', 'cc_department', 'created_at']
    list_filter = ['cc_type']


@admin.register(ApprovalDeptConfig)
class ApprovalDeptConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'sub_tenant', 'approval_type', 'enable_receipt_return', 'require_signature', 'final_approver',
                    'threshold_enabled', 'threshold_field', 'department', 'updated_at', 'created_at']
    list_filter = ['approval_type', 'enable_receipt_return', 'require_signature', 'threshold_enabled', 'threshold_field']
    search_fields = ['tenant__name', 'department__name']
    list_per_page = 20



@admin.register(CustomPaymentMethod)
class CustomPaymentMethodAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'payee_name', 'bank_name', 'updated_at', 'created_at']
    search_fields = ['user__username', 'user__real_name',  'payee_name', 'bank_name', 'bank_card', 'alipay_account', 'wechat_account']
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


@admin.register(MaterialItem)
class MaterialItemAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'name', 'spec', 'unit', 'category', 'price', 'is_active', 'created_by', 'updated_at']
    list_filter = ['is_active', 'category']
    search_fields = ['name', 'spec', 'category', 'tenant__name']
    list_per_page = 20


@admin.register(MaterialRequirement)
class MaterialRequirementAdmin(admin.ModelAdmin):
    list_display = ['id', 'doc_no', 'tenant', 'branch_dept', 'purpose', 'status', 'created_by', 'created_at', 'updated_at']
    list_filter = ['status']
    search_fields = ['doc_no', 'purpose', 'tenant__name', 'branch_dept__name', 'created_by__username', 'created_by__real_name']
    list_per_page = 20


@admin.register(MaterialRequirementItem)
class MaterialRequirementItemAdmin(admin.ModelAdmin):
    list_display = ['id', 'requirement', 'item_name', 'spec', 'unit', 'quantity', 'requisitioned_quantity', 'remark']
    search_fields = ['item_name', 'spec', 'requirement__doc_no']
    list_per_page = 20


@admin.register(MaterialRequisition)
class MaterialRequisitionAdmin(admin.ModelAdmin):
    list_display = ['id', 'doc_no', 'tenant', 'requirement', 'requirement_doc_no', 'branch_dept', 'status', 'created_by', 'created_at', 'updated_at']
    list_filter = ['status']
    search_fields = ['doc_no', 'requirement_doc_no', 'tenant__name', 'created_by__username', 'created_by__real_name']
    list_per_page = 20


@admin.register(MaterialRequisitionItem)
class MaterialRequisitionItemAdmin(admin.ModelAdmin):
    list_display = ['id', 'requisition', 'item_name', 'spec', 'unit', 'quantity', 'remark']
    search_fields = ['item_name', 'spec', 'requisition__doc_no']
    list_per_page = 20


@admin.register(DocumentSequence)
class DocumentSequenceAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'doc_type', 'date_key', 'seq']
    search_fields = ['tenant__name', 'doc_type', 'date_key']
    list_filter = ['doc_type']
    list_per_page = 20


@admin.register(WatermarkConfig)
class WatermarkConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'company_name', 'text', 'font_size', 'font_color', 'font_style', 'rotation', 'opacity', 'position', 'updated_at']
    search_fields = ['id', 'tenant__name', 'company_name', 'text']
    list_filter = ['enabled', 'position', 'shape', 'hidden_enabled', 'page_enabled']
    list_per_page = 20


@admin.register(PrintLog)
class PrintLogAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'page', 'target_type', 'target_id', 'count', 'ip', 'created_at']
    search_fields = ['id', 'user__username', 'user__real_name', 'page', 'target_type', 'target_id', 'ip']
    list_filter = ['page', 'target_type', 'created_at']
    date_hierarchy = 'created_at'
    list_per_page = 20



@admin.register(DailyWorkSummary)
class DailyWorkSummaryAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'tenant', 'summary_date', 'status', 'position', 'analyzed_at', 'updated_at', 'created_at']
    search_fields = ['id', 'user__username', 'user__real_name', 'tenant__name', 'content']
    list_filter = ['status', 'position']
    list_per_page = 20


@admin.register(WorkSummaryRangeAnalysis)
class WorkSummaryRangeAnalysisAdmin(admin.ModelAdmin):
    list_display = ['id', 'requester', 'target_user', 'tenant', 'status', 'analyzed_at', 'updated_at', 'created_at']
    search_fields = ['id', 'requester__username', 'requester__real_name', 'tenant__name', 'target_user__username', 'target_user__real_name']
    list_filter = ['status',]
    list_per_page = 20


@admin.register(WorkSummaryConfig)
class WorkSummaryConfigAdmin(admin.ModelAdmin):
    list_display = ['id', 'tenant', 'tenant', 'updated_by', 'model_id', 'enabled', 'limit_enabled', 'limit_notified', 'near_limit_notified', 'today_call_count', 'today_cost', 'updated_at']
    search_fields = ['id', 'updated_by__username', 'updated_by__real_name', 'tenant__name']
    list_filter = ['enabled', 'scope_type', 'limit_enabled', 'near_limit_notified', 'limit_notified']
    list_per_page = 20
