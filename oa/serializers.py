from rest_framework import serializers
from .models import AttendanceRecord, ApprovalRequest, ApprovalLog, ApprovalNode, ApprovalAssignee


class AttendanceRecordSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    clock_type_display = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = [
            'id', 'user', 'user_name', 'avatar_url', 'department_name',
            'clock_type', 'clock_type_display',
            'clock_time', 'date', 'latitude', 'longitude', 'location',
            'device', 'status', 'status_display', 'remark', 'reverse_geocoding',
        ]
        read_only_fields = ['user', 'clock_time']

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username

    def get_avatar_url(self, obj):
        return obj.user.get_avatar_url() if hasattr(obj.user, 'get_avatar_url') else ''

    def get_department_name(self, obj):
        return obj.user.department.name if obj.user.department else ''

    def get_clock_type_display(self, obj):
        return obj.get_clock_type_display()

    def get_status_display(self, obj):
        return obj.get_status_display()


class AttendanceClockSerializer(serializers.Serializer):
    latitude = serializers.FloatField(required=False, allow_null=True)
    longitude = serializers.FloatField(required=False, allow_null=True)
    location = serializers.CharField(required=False, allow_blank=True, max_length=255)
    device = serializers.CharField(required=False, allow_blank=True, max_length=255)
    remark = serializers.CharField(required=False, allow_blank=True, max_length=500)
    reverse_geocoding = serializers.JSONField(required=False, allow_null=True)


class ApprovalAssigneeSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_avatar = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalAssignee
        fields = ['id', 'user', 'user_name', 'user_avatar', 'status', 'status_display', 'comment', 'operated_at']

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username

    def get_user_avatar(self, obj):
        return obj.user.get_avatar_url() if hasattr(obj.user, 'get_avatar_url') else ''

    def get_status_display(self, obj):
        return obj.get_status_display()


class ApprovalNodeSerializer(serializers.ModelSerializer):
    node_type_display = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    assignees = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalNode
        fields = [
            'id', 'node_type', 'node_type_display',
            'user', 'user_name', 'department', 'department_name',
            'order', 'assignees',
        ]

    def get_node_type_display(self, obj):
        return obj.get_node_type_display()

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username if obj.user else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_assignees(self, obj):
        qs = obj.assignees.select_related('user').all()
        return ApprovalAssigneeSerializer(qs, many=True).data


class ApprovalRequestSerializer(serializers.ModelSerializer):
    applicant_name = serializers.SerializerMethodField()
    applicant_avatar = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    approval_type_display = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    expense_type_display = serializers.SerializerMethodField()
    sign_type_display = serializers.SerializerMethodField()
    approval_mode_display = serializers.SerializerMethodField()
    logs = serializers.SerializerMethodField()
    approval_nodes = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            'id', 'applicant', 'applicant_name', 'applicant_avatar',
            'department', 'department_name',
            'approval_type', 'approval_type_display',
            'title', 'content', 'status', 'status_display',
            'start_date', 'end_date', 'duration', 'amount',
            'expense_type', 'expense_type_display', 'expense_date',
            'attachments', 'sign_type', 'sign_type_display',
            'approval_mode', 'approval_mode_display', 'current_node_order',
            'approver', 'approver_name', 'approver_comment',
            'created_at', 'updated_at', 'logs', 'approval_nodes',
        ]
        read_only_fields = [
            'applicant', 'status', 'approver', 'approver_comment',
            'created_at', 'updated_at', 'logs', 'approval_nodes',
        ]

    def get_applicant_name(self, obj):
        return obj.applicant.real_name or obj.applicant.username

    def get_applicant_avatar(self, obj):
        return obj.applicant.get_avatar_url() if hasattr(obj.applicant, 'get_avatar_url') else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_approval_type_display(self, obj):
        return obj.get_approval_type_display()

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_approver_name(self, obj):
        return obj.approver.real_name if obj.approver else ''

    def get_expense_type_display(self, obj):
        return obj.get_expense_type_display() if obj.expense_type else ''

    def get_sign_type_display(self, obj):
        return obj.get_sign_type_display()

    def get_approval_mode_display(self, obj):
        return obj.get_approval_mode_display()

    def get_logs(self, obj):
        logs = obj.logs.select_related('operator').all()
        return ApprovalLogSerializer(logs, many=True).data

    def get_approval_nodes(self, obj):
        nodes = obj.approval_nodes.prefetch_related('assignees__user').all()
        return ApprovalNodeSerializer(nodes, many=True).data


class ApprovalListSerializer(serializers.ModelSerializer):
    applicant_name = serializers.SerializerMethodField()
    applicant_avatar = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    approval_type_display = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            'id', 'applicant', 'applicant_name', 'applicant_avatar',
            'department', 'department_name',
            'approval_type', 'approval_type_display',
            'title', 'status', 'status_display',
            'amount', 'created_at', 'updated_at',
        ]

    def get_applicant_name(self, obj):
        return obj.applicant.real_name or obj.applicant.username

    def get_applicant_avatar(self, obj):
        return obj.applicant.get_avatar_url() if hasattr(obj.applicant, 'get_avatar_url') else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_approval_type_display(self, obj):
        return obj.get_approval_type_display()

    def get_status_display(self, obj):
        return obj.get_status_display()


class ApprovalLogSerializer(serializers.ModelSerializer):
    operator_name = serializers.SerializerMethodField()
    action_display = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalLog
        fields = ['id', 'operator', 'operator_name', 'action', 'action_display', 'comment', 'created_at']

    def get_operator_name(self, obj):
        return obj.operator.real_name or obj.operator.username if obj.operator else ''

    def get_action_display(self, obj):
        return obj.get_action_display()


class ApprovalCreateSerializer(serializers.Serializer):
    approval_type = serializers.ChoiceField(choices=ApprovalRequest.APPROVAL_TYPE_CHOICES)
    title = serializers.CharField(max_length=200)
    content = serializers.CharField(required=False, allow_blank=True)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    duration = serializers.FloatField(required=False, allow_null=True)
    amount = serializers.DecimalField(required=False, allow_null=True, max_digits=12, decimal_places=2)
    expense_type = serializers.ChoiceField(choices=ApprovalRequest.EXPENSE_TYPE_CHOICES, required=False, allow_blank=True)
    expense_date = serializers.DateField(required=False, allow_null=True)
    attachments = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    sign_type = serializers.ChoiceField(choices=[('countersign', '会签'), ('orsign', '或签')], required=False, default='orsign')
    approval_mode = serializers.ChoiceField(choices=[('sequential', '顺序审批'), ('parallel', '并行审批')], required=False, default='parallel')
    approver_nodes = serializers.ListField(child=serializers.DictField(), required=False, default=[])


class ApprovalActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=500)
