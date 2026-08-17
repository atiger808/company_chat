from rest_framework import serializers
from .models import (
    AttendanceRecord, ApprovalRequest, ApprovalLog, ApprovalNode,
    ApprovalAssignee, ApprovalCarbonCopy, ApprovalDeptConfig,
    AttendanceConfig, SubsidyApplication, SubsidyPayment, SubsidyConfig,
    SubsidyWallet, SubsidyWithdrawal,
)
from .type_utils import resolve_approval_type


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
            'bd09_latitude', 'bd09_longitude', 'ip_address', 'user_agent',
        ]
        read_only_fields = ['user', 'clock_time']

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username

    def get_avatar_url(self, obj):
        return obj.user.get_avatar_url() if hasattr(obj.user, 'get_avatar_url') else ''

    def get_department_name(self, obj):
        try:
            from org.models import UserDepartment
            ud = UserDepartment.objects.filter(user=obj.user, is_primary=True).select_related('department').first()
            if ud and ud.department:
                return ud.department.name
        except Exception:
            pass
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
    ip_address = serializers.CharField(required=False, allow_blank=True, max_length=50)
    user_agent = serializers.CharField(required=False, allow_blank=True)


class ApprovalAssigneeSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_avatar = serializers.SerializerMethodField()
    user_position = serializers.SerializerMethodField()
    user_department = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalAssignee
        fields = ['id', 'user', 'user_name', 'user_avatar', 'user_position', 'user_department', 'status', 'status_display', 'comment', 'operated_at']

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username

    def get_user_avatar(self, obj):
        return obj.user.get_avatar_url() if hasattr(obj.user, 'get_avatar_url') else ''

    def get_user_position(self, obj):
        return obj.user.position or ''

    def get_user_department(self, obj):
        if obj.user and hasattr(obj.user, 'department') and obj.user.department:
            return obj.user.department.name
        from org.models import UserDepartment
        dept = UserDepartment.objects.filter(user=obj.user).select_related('department').first()
        return dept.department.name if dept else ''

    def get_status_display(self, obj):
        return obj.get_status_display()


class ApprovalNodeSerializer(serializers.ModelSerializer):
    node_type_display = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    user_position = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    final_approver_source_label = serializers.SerializerMethodField()
    assignees = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalNode
        fields = [
            'id', 'node_type', 'node_type_display',
            'user', 'user_name', 'user_position', 'department', 'department_name',
            'order', 'is_final_approver', 'final_approver_source', 'final_approver_source_label',
            'assignees',
        ]

    def get_node_type_display(self, obj):
        return obj.get_node_type_display()

    def get_final_approver_source_label(self, obj):
        """根据固化的配置来源 + 审批所属企业生成展示文案"""
        if obj.final_approver_source == 'sub':
            return '子公司自定义配置'
        if obj.final_approver_source == 'default':
            try:
                t = obj.request.tenant
                if t and t.parent:
                    return '集团默认配置'
                cfg_tenant = t.parent if t and t.parent else t
                if cfg_tenant and cfg_tenant.sub_tenants.exists():
                    return '集团默认配置'
            except Exception:
                pass
            return '默认配置'
        return ''

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username if obj.user else ''

    def get_user_position(self, obj):
        return obj.user.position if obj.user and hasattr(obj.user, 'position') else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_assignees(self, obj):
        qs = obj.assignees.select_related('user').all()
        return ApprovalAssigneeSerializer(qs, many=True).data


class ApprovalRequestSerializer(serializers.ModelSerializer):
    applicant_name = serializers.SerializerMethodField()
    applicant_avatar = serializers.SerializerMethodField()
    applicant_position = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    approval_type_display = serializers.SerializerMethodField()
    approval_type_name = serializers.SerializerMethodField()
    approval_type_icon = serializers.SerializerMethodField()
    approval_type_color = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    expense_type_display = serializers.SerializerMethodField()
    sign_type_display = serializers.SerializerMethodField()
    approval_mode_display = serializers.SerializerMethodField()
    form_data_display = serializers.SerializerMethodField()
    logs = serializers.SerializerMethodField()
    approval_nodes = serializers.SerializerMethodField()
    cc_users = serializers.SerializerMethodField()
    related_approvals = serializers.SerializerMethodField()
    related_approval_list = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            'id', 'applicant', 'applicant_name', 'applicant_avatar', 'applicant_position',
            'department', 'department_name',
            'approval_type', 'approval_type_display',
            'approval_type_name', 'approval_type_icon', 'approval_type_color',
            'title', 'content', 'status', 'status_display',
            'start_date', 'end_date', 'duration', 'amount',
            'expense_type', 'expense_type_display', 'expense_date',
            'recruit_data', 'form_data', 'form_data_display',
            'attachments', 'sign_type', 'sign_type_display',
            'approval_mode', 'approval_mode_display', 'current_node_order',
            'approver', 'approver_name', 'approver_comment',
            'related_approvals', 'related_approval_list',
            'purchase_items', 'expense_items', 'leave_type', 'trip_data',
            'created_at', 'updated_at', 'logs', 'approval_nodes', 'cc_users',
        ]
        read_only_fields = [
            'applicant', 'status', 'approver', 'approver_comment',
            'created_at', 'updated_at', 'logs', 'approval_nodes',
        ]

    def get_applicant_name(self, obj):
        return obj.applicant.real_name or obj.applicant.username

    def get_applicant_avatar(self, obj):
        return obj.applicant.get_avatar_url() if hasattr(obj.applicant, 'get_avatar_url') else ''

    def get_applicant_position(self, obj):
        return obj.applicant.position if hasattr(obj.applicant, 'position') and obj.applicant.position else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_approval_type_display(self, obj):
        return self.get_approval_type_name(obj)

    def get_approval_type_name(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.name if t else obj.approval_type

    def get_approval_type_icon(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.icon if t else 'fa-file-lines'

    def get_approval_type_color(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.color if t else '#409EFF'

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

    def get_form_data_display(self, obj):
        """把 form_data 中的部门ID/成员等解析为可读文本，供详情「表单详情」渲染"""
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        schema = (t.form_schema or []) if t else []
        if not schema:
            return {}
        fd = obj.form_data or {}
        result = {}
        from accounts.models import Department
        for f in schema:
            key = f.get('key')
            if not key or key not in fd:
                continue
            val = fd[key]
            if val in (None, ''):
                continue
            ftype = f.get('type')
            if ftype == 'department':
                dept = Department.objects.filter(id=val).first()
                result[key] = dept.name if dept else str(val)
            elif ftype == 'user':
                if isinstance(val, list):
                    result[key] = ', '.join([str(u.get('name') if isinstance(u, dict) else u) for u in val])
                elif isinstance(val, dict):
                    result[key] = str(val.get('name', val))
            elif ftype in ('select', 'radio') and isinstance(val, str):
                opt = next((o for o in (f.get('options') or [])
                            if str(o.get('value') if isinstance(o, dict) else o) == val), None)
                if opt:
                    result[key] = opt.get('label') if isinstance(opt, dict) and opt.get('label') else opt
            elif ftype == 'checkbox' and isinstance(val, list):
                labels = []
                for x in val:
                    o = next((oo for oo in (f.get('options') or [])
                              if str(oo.get('value') if isinstance(oo, dict) else oo) == str(x)), None)
                    labels.append(o.get('label') if isinstance(o, dict) and o.get('label') else (o if o else str(x)))
                result[key] = ', '.join(labels)
            elif ftype == 'expense_type' and isinstance(val, str):
                result[key] = dict(ApprovalRequest.EXPENSE_TYPE_CHOICES).get(val, val)
        return result

    def get_cc_users(self, obj):
        ccs = obj.carbon_copies.select_related('cc_user', 'cc_department').all()
        defAv = '/static/images/default-avatar.png'
        result = []
        seen = set()
        for cc in ccs:
            if cc.cc_type == 'user' and cc.cc_user:
                key = ('user', cc.cc_user.id)
                if key in seen:
                    continue
                seen.add(key)
                result.append({
                    'id': cc.cc_user.id,
                    'name': cc.cc_user.real_name or cc.cc_user.username,
                    'avatar': cc.cc_user.get_avatar_url() if hasattr(cc.cc_user, 'get_avatar_url') else defAv,
                    'cc_type': 'user',
                })
            elif cc.cc_type == 'department' and cc.cc_department:
                key = ('department', cc.cc_department.id)
                if key in seen:
                    continue
                seen.add(key)
                # 部门抄送时显示部门信息，并附带部门负责人
                mgr_name = ''
                mgr_avatar = defAv
                if cc.cc_department.manager:
                    mgr_name = cc.cc_department.manager.real_name or cc.cc_department.manager.username
                    mgr_avatar = cc.cc_department.manager.get_avatar_url() if hasattr(cc.cc_department.manager, 'get_avatar_url') else defAv
                result.append({
                    'id': cc.cc_department.id,
                    'name': cc.cc_department.name,
                    'avatar': mgr_avatar,
                    'cc_type': 'department',
                    'manager_name': mgr_name,
                    'department_id': cc.cc_department.id,
                })
        return result

    def get_related_approvals(self, obj):
        return list(obj.related_approvals.values_list('id', flat=True))

    def get_related_approval_list(self, obj):
        out = []
        for r in obj.related_approvals.all()[:50]:
            t = resolve_approval_type(r.approval_type, r.tenant)
            out.append({
                'id': r.id,
                'title': r.title,
                'approval_type': r.approval_type,
                'approval_type_display': t.name if t else r.approval_type,
                'status': r.status,
                'status_display': r.get_status_display(),
                'amount': float(r.amount) if r.amount else None,
                'created_at': r.created_at.isoformat() if r.created_at else '',
            })
        return out

    def get_logs(self, obj):
        logs = list(obj.logs.select_related('operator').all())
        serialized = ApprovalLogSerializer(logs, many=True).data
        # 将发起人作为第一条记录
        applicant = obj.applicant
        serialized.append({
            'id': 0,
            'operator': applicant.id,
            'operator_name': applicant.real_name or applicant.username,
                'operator_position': applicant.position or '',
            'action': 'submit',
            'action_display': '提交审批',
            'comment': '发起审批申请',
            'created_at': obj.created_at.isoformat() if obj.created_at else '',
        })
        # 按操作时间正序排列（时间线顺序）
        serialized.sort(key=lambda x: x.get('created_at', ''))
        return serialized

    def get_approval_nodes(self, obj):
        nodes = list(obj.approval_nodes.prefetch_related('assignees__user').order_by('order', 'id'))
        serialized = ApprovalNodeSerializer(nodes, many=True).data
        # 将发起人作为第一个节点
        applicant = obj.applicant
        serialized.insert(0, {
            'id': 0,
            'node_type': 'initiator',
            'node_type_display': '发起人',
            'user': applicant.id,
            'user_name': applicant.real_name or applicant.username,
            'user_position': applicant.position or '',
            'department': None,
            'department_name': '',
            'order': -1,
            'is_final_approver': False,
            'final_approver_source': '',
            'final_approver_source_label': '',
            'assignees': [{
                'id': 0,
                'user': applicant.id,
                'user_name': applicant.real_name or applicant.username,
                'user_avatar': applicant.get_avatar_url() if hasattr(applicant, 'get_avatar_url') else '',
                'user_position': applicant.position or '',
                'status': 'approved',
                'status_display': '已发起',
                'comment': '',
                'operated_at': obj.created_at.isoformat() if obj.created_at else None,
            }]
        })
        return serialized


class ApprovalListSerializer(serializers.ModelSerializer):
    applicant_name = serializers.SerializerMethodField()
    applicant_avatar = serializers.SerializerMethodField()
    applicant_position = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    approval_type_display = serializers.SerializerMethodField()
    approval_type_icon = serializers.SerializerMethodField()
    approval_type_color = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            'id', 'applicant', 'applicant_name', 'applicant_avatar', 'applicant_position',
            'department', 'department_name',
            'approval_type', 'approval_type_display',
            'approval_type_icon', 'approval_type_color',
            'title', 'status', 'status_display',
            'amount', 'created_at', 'updated_at',
        ]

    def get_applicant_name(self, obj):
        return obj.applicant.real_name or obj.applicant.username

    def get_applicant_avatar(self, obj):
        return obj.applicant.get_avatar_url() if hasattr(obj.applicant, 'get_avatar_url') else ''

    def get_applicant_position(self, obj):
        return obj.applicant.position if hasattr(obj.applicant, 'position') and obj.applicant.position else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_approval_type_display(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.name if t else obj.approval_type

    def get_approval_type_icon(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.icon if t else 'fa-file-lines'

    def get_approval_type_color(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.color if t else '#409EFF'

    def get_status_display(self, obj):
        return obj.get_status_display()


class ApprovalLogSerializer(serializers.ModelSerializer):
    operator_name = serializers.SerializerMethodField()
    operator_position = serializers.SerializerMethodField()
    operator_department = serializers.SerializerMethodField()
    action_display = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalLog
        fields = ['id', 'operator', 'operator_name', 'operator_position', 'operator_department', 'action', 'action_display', 'comment', 'attachments', 'signature', 'created_at']

    def get_operator_name(self, obj):
        return obj.operator.real_name or obj.operator.username if obj.operator else ''

    def get_operator_position(self, obj):
        return obj.operator.position if obj.operator and hasattr(obj.operator, 'position') else ''

    def get_operator_department(self, obj):
        if not obj.operator:
            return ''
        if hasattr(obj.operator, 'department') and obj.operator.department:
            return obj.operator.department.name
        from org.models import UserDepartment
        dept = UserDepartment.objects.filter(user=obj.operator).select_related('department').first()
        return dept.department.name if dept else ''

    def get_action_display(self, obj):
        return obj.get_action_display()


class ApprovalCreateSerializer(serializers.Serializer):
    approval_type = serializers.CharField(max_length=40)
    title = serializers.CharField(max_length=200)
    content = serializers.CharField(required=False, allow_blank=True)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    duration = serializers.FloatField(required=False, allow_null=True)
    amount = serializers.DecimalField(required=False, allow_null=True, max_digits=12, decimal_places=2)
    expense_type = serializers.ChoiceField(choices=ApprovalRequest.EXPENSE_TYPE_CHOICES, required=False, allow_blank=True)
    expense_date = serializers.DateField(required=False, allow_null=True)
    attachments = serializers.JSONField(required=False, default=list)
    recruit_data = serializers.JSONField(required=False, default=dict)
    form_data = serializers.JSONField(required=False, default=dict)
    sign_type = serializers.ChoiceField(choices=[('countersign', '会签'), ('orsign', '或签')], required=False, default='countersign')
    approval_mode = serializers.ChoiceField(choices=[('sequential', '顺序审批'), ('parallel', '并行审批')], required=False, default='sequential')
    approver_nodes = serializers.ListField(child=serializers.DictField(), required=False, default=[])
    cc_users = serializers.ListField(child=serializers.IntegerField(), required=False, default=[])
    cc_departments = serializers.ListField(child=serializers.IntegerField(), required=False, default=[])
    related_approvals = serializers.ListField(child=serializers.IntegerField(), required=False, default=[])
    purchase_items = serializers.JSONField(required=False, default=list)
    expense_items = serializers.JSONField(required=False, default=list)
    leave_type = serializers.CharField(required=False, allow_blank=True, default='')
    trip_data = serializers.JSONField(required=False, default=dict)

    def validate_approval_type(self, value):
        request = self.context.get('request') if hasattr(self, 'context') else None
        # 与 create/draft 保存逻辑保持一致：request.tenant 优先，兜底 get_active_tenant
        tenant = None
        if request:
            tenant = getattr(request, 'tenant', None) or getattr(request.user, 'get_active_tenant', lambda: None)()
        t = resolve_approval_type(value, tenant)
        if not t:
            raise serializers.ValidationError('审批类型不存在或未启用')
        return value


class ApprovalActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    attachments = serializers.JSONField(required=False, default=list)
    signature = serializers.CharField(required=False, allow_blank=True)


class ApprovalDraftSerializer(serializers.Serializer):
    """存草稿/重新编辑 序列化器"""
    approval_type = serializers.CharField(max_length=40, required=False)
    title = serializers.CharField(max_length=200, required=False)
    content = serializers.CharField(required=False, allow_blank=True)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    end_date = serializers.DateField(required=False, allow_null=True)
    duration = serializers.FloatField(required=False, allow_null=True)
    amount = serializers.DecimalField(required=False, allow_null=True, max_digits=12, decimal_places=2)
    expense_type = serializers.ChoiceField(choices=ApprovalRequest.EXPENSE_TYPE_CHOICES, required=False, allow_blank=True)
    expense_date = serializers.DateField(required=False, allow_null=True)
    attachments = serializers.JSONField(required=False, default=list)
    recruit_data = serializers.JSONField(required=False, default=dict)
    form_data = serializers.JSONField(required=False, default=dict)
    sign_type = serializers.ChoiceField(choices=[('countersign', '会签'), ('orsign', '或签')], required=False, default='countersign')
    approval_mode = serializers.ChoiceField(choices=[('sequential', '顺序审批'), ('parallel', '并行审批')], required=False, default='sequential')
    approver_nodes = serializers.ListField(child=serializers.DictField(), required=False, default=[])
    cc_users = serializers.ListField(child=serializers.IntegerField(), required=False, default=[])
    cc_departments = serializers.ListField(child=serializers.IntegerField(), required=False, default=[])
    related_approvals = serializers.ListField(child=serializers.IntegerField(), required=False, default=[])
    purchase_items = serializers.JSONField(required=False, default=list)
    expense_items = serializers.JSONField(required=False, default=list)
    leave_type = serializers.CharField(required=False, allow_blank=True, default='')
    trip_data = serializers.JSONField(required=False, default=dict)

    def validate_approval_type(self, value):
        request = self.context.get('request') if hasattr(self, 'context') else None
        # 与 create/draft 保存逻辑保持一致：request.tenant 优先，兜底 get_active_tenant
        tenant = None
        if request:
            tenant = getattr(request, 'tenant', None) or getattr(request.user, 'get_active_tenant', lambda: None)()
        t = resolve_approval_type(value, tenant)
        if not t:
            raise serializers.ValidationError('审批类型不存在或未启用')
        return value


class ApprovalCarbonCopySerializer(serializers.ModelSerializer):
    """审批抄送序列化器（支持用户和部门）"""
    user_name = serializers.SerializerMethodField()
    user_avatar = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalCarbonCopy
        fields = ['id', 'cc_type', 'cc_user', 'user_name', 'user_avatar', 'cc_department', 'department_name', 'created_at']

    def get_user_name(self, obj):
        if obj.cc_type == 'user' and obj.cc_user:
            return obj.cc_user.real_name or obj.cc_user.username
        return ''

    def get_user_avatar(self, obj):
        if obj.cc_type == 'user' and obj.cc_user:
            return obj.cc_user.get_avatar_url() if hasattr(obj.cc_user, 'get_avatar_url') else ''
        return ''

    def get_department_name(self, obj):
        if obj.cc_type == 'department' and obj.cc_department:
            return obj.cc_department.name
        return ''


class ApprovalDeptConfigSerializer(serializers.ModelSerializer):
    """审批类型配置序列化器（最终部门、抄送部门、抄送人、审批人、阈值审批、子公司）"""
    department_name = serializers.SerializerMethodField()
    approval_type_display = serializers.SerializerMethodField()
    cc_department_details = serializers.SerializerMethodField()
    cc_user_details = serializers.SerializerMethodField()
    approver_user_details = serializers.SerializerMethodField()
    final_approver_details = serializers.SerializerMethodField()
    threshold_department_name = serializers.SerializerMethodField()
    threshold_field_display = serializers.SerializerMethodField()
    sub_tenant_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalDeptConfig
        fields = [
            'id', 'tenant', 'sub_tenant', 'sub_tenant_name',
            'approval_type', 'approval_type_display',
            'default_sign_type', 'default_approval_mode',
            'department', 'department_name',
            'cc_departments', 'cc_department_details',
            'cc_users', 'cc_user_details',
            'approver_users', 'approver_user_details',
            'final_approver', 'final_approver_details',
            'threshold_enabled', 'threshold_field', 'threshold_field_display',
            'threshold_value', 'threshold_department', 'threshold_department_name',
            'require_signature',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['tenant', 'created_at', 'updated_at']

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_approval_type_display(self, obj):
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        return t.name if t else obj.approval_type

    def get_cc_department_details(self, obj):
        if not obj.cc_departments:
            return []
        from accounts.models import Department
        depts = Department.objects.filter(id__in=obj.cc_departments)
        return [{'id': d.id, 'name': d.name} for d in depts]

    def get_cc_user_details(self, obj):
        if not obj.cc_users:
            return []
        from accounts.models import CustomUser
        users = CustomUser.objects.filter(id__in=obj.cc_users)
        defAv = '/static/images/default-avatar.png'
        return [{
            'id': u.id,
            'name': u.real_name or u.username,
            'avatar': u.get_avatar_url() if hasattr(u, 'get_avatar_url') else defAv,
        } for u in users]

    def get_approver_user_details(self, obj):
        if not obj.approver_users:
            return []
        from accounts.models import CustomUser
        users = CustomUser.objects.filter(id__in=obj.approver_users)
        return [{
            'id': u.id,
            'name': u.real_name or u.username,
            'position': u.position or '',
        } for u in users]

    def get_final_approver_details(self, obj):
        if not obj.final_approver:
            return None
        u = obj.final_approver
        return {
            'id': u.id,
            'name': u.real_name or u.username,
            'position': u.position or '',
        }

    def get_threshold_department_name(self, obj):
        return obj.threshold_department.name if obj.threshold_department else ''

    def get_sub_tenant_name(self, obj):
        if obj.sub_tenant:
            return obj.sub_tenant.short_name or obj.sub_tenant.name
        return ''

    def get_threshold_field_display(self, obj):
        if not obj.threshold_field:
            return ''
        field_map = dict(ApprovalDeptConfig.THRESHOLD_FIELD_CHOICES)
        if obj.threshold_field in field_map:
            return field_map[obj.threshold_field]
        # 自定义类型：回退到 form_schema 中该字段的 label
        t = resolve_approval_type(obj.approval_type, obj.tenant)
        if t:
            for f in (t.form_schema or []):
                if f.get('key') == obj.threshold_field:
                    return f.get('label') or obj.threshold_field
        return obj.threshold_field


class AttendanceConfigSerializer(serializers.ModelSerializer):
    """考勤配置序列化器"""
    sub_tenant_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    department_path = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceConfig
        fields = [
            'id', 'tenant', 'sub_tenant', 'sub_tenant_name',
            'department', 'department_name', 'department_path',
            'clock_in_enabled', 'clock_in_time',
            'clock_out_enabled', 'clock_out_time',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['tenant', 'created_at', 'updated_at']

    def get_sub_tenant_name(self, obj):
        if obj.sub_tenant:
            return obj.sub_tenant.short_name or obj.sub_tenant.name
        return ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_department_path(self, obj):
        if obj.department and obj.department.full_path:
            return obj.department.full_path
        return obj.department.name if obj.department else ''


class SubsidyConfigSerializer(serializers.ModelSerializer):
    """普惠补贴配置序列化器"""
    sub_tenant_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    department_path = serializers.SerializerMethodField()
    verifier_ids = serializers.SerializerMethodField()
    verifiers = serializers.SerializerMethodField()
    payment_staff_ids = serializers.SerializerMethodField()
    payment_staff = serializers.SerializerMethodField()

    class Meta:
        model = SubsidyConfig
        fields = [
            'id', 'tenant', 'sub_tenant', 'sub_tenant_name',
            'department', 'department_name', 'department_path',
            'enabled', 'special_rate', 'ordinary_rate', 'max_invoices',
            'show_invoice_header', 'tax_rate_threshold',
            'min_withdraw_amount', 'default_ocr_version', 'invoice_verify_enabled',
            'invoice_header_name', 'invoice_header_tax_no', 'invoice_header_address',
            'invoice_header_phone', 'invoice_header_bank', 'invoice_header_bank_account',
            'invoice_header_bank_name', 'company_name', 'company_tax_no',
            'invoice_header_show',
            'verifier_ids', 'verifiers', 'payment_staff_ids', 'payment_staff',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['tenant', 'created_at', 'updated_at']

    def get_sub_tenant_name(self, obj):
        return obj.sub_tenant.short_name or obj.sub_tenant.name if obj.sub_tenant else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''

    def get_department_path(self, obj):
        if obj.department and obj.department.full_path:
            return obj.department.full_path
        return obj.department.name if obj.department else ''

    def get_verifier_ids(self, obj):
        return list(obj.verifiers.values_list('id', flat=True))

    def get_verifiers(self, obj):
        return [{
            'id': u.id,
            'name': u.real_name or u.username,
            'avatar': u.get_avatar_url() if hasattr(u, 'get_avatar_url') else '',
            'position': u.position or '',
        } for u in obj.verifiers.all()]

    def get_payment_staff_ids(self, obj):
        return list(obj.payment_staff.values_list('id', flat=True))

    def get_payment_staff(self, obj):
        return [{
            'id': u.id,
            'name': u.real_name or u.username,
            'avatar': u.get_avatar_url() if hasattr(u, 'get_avatar_url') else '',
            'position': u.position or '',
        } for u in obj.payment_staff.all()]


class SubsidyApplicationSerializer(serializers.ModelSerializer):
    invoice_type_display = serializers.SerializerMethodField()
    status_display = serializers.SerializerMethodField()
    applicant_name = serializers.SerializerMethodField()
    applicant_avatar = serializers.SerializerMethodField()
    verified_by_name = serializers.SerializerMethodField()
    verified_by_avatar = serializers.SerializerMethodField()
    applicant_payment = serializers.SerializerMethodField()
    applicant_department = serializers.SerializerMethodField()
    applicant_position = serializers.SerializerMethodField()
    invoice_verify_status = serializers.SerializerMethodField()

    class Meta:
        model = SubsidyApplication
        fields = [
            'id', 'application_no', 'applicant', 'applicant_name', 'applicant_avatar',
            'invoice_number', 'invoice_type', 'invoice_type_display',
            'invoice_code', 'invoice_amount', 'invoice_date', 'tax_rate', 'invoice_issuer',
            'invoice_file', 'invoice_original_name', 'invoice_image',
            'buyer_name', 'buyer_tax_no', 'seller_name', 'seller_tax_no', 'drawer',
            'ocr_raw_data',
            'payment_voucher', 'payment_voucher_name',
            'payment_proof', 'payment_proof_name',
            'subsidy_rate', 'subsidy_amount', 'status', 'status_display',
            'reject_reason', 'verified_by', 'verified_by_name', 'verified_by_avatar', 'verified_at',
            'applicant_payment', 'applicant_department', 'applicant_position',
            'invoice_verify_status',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'application_no', 'subsidy_rate', 'subsidy_amount', 'status',
            'reject_reason', 'verified_by', 'verified_at', 'created_at', 'updated_at',
            'invoice_image',
        ]
        extra_kwargs = {
            'invoice_number': {'required': True, 'allow_blank': False},
        }

    def get_invoice_type_display(self, obj):
        return obj.get_invoice_type_display()

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_applicant_name(self, obj):
        return obj.applicant.real_name or obj.applicant.username if obj.applicant else ''

    def get_applicant_avatar(self, obj):
        return obj.applicant.get_avatar_url() if hasattr(obj.applicant, 'get_avatar_url') else ''

    def get_verified_by_name(self, obj):
        return obj.verified_by.real_name or obj.verified_by.username if obj.verified_by else ''

    def get_verified_by_avatar(self, obj):
        return obj.verified_by.get_avatar_url() if obj.verified_by and hasattr(obj.verified_by, 'get_avatar_url') else ''

    def get_applicant_payment(self, obj):
        u = obj.applicant
        if not u:
            return {}
        return {
            'payee_name': u.payee_name or '',
            'bank_card': u.bank_card or '',
            'alipay_account': u.alipay_account or '',
            'wechat_account': u.wechat_account or '',
            'alipay_qr': u.alipay_qr or '',
            'wechat_qr': u.wechat_qr or '',
        }

    def get_applicant_department(self, obj):
        u = obj.applicant
        if not u:
            return ''
        try:
            from org.models import UserDepartment
            rec = UserDepartment.objects.filter(user=u, is_primary=True).select_related('department').first()
            if rec and rec.department:
                return rec.department.name
        except Exception:
            pass
        return u.department.name if u.department else ''

    def get_applicant_position(self, obj):
        return obj.applicant.position if obj.applicant and obj.applicant.position else ''

    def get_invoice_verify_status(self, obj):
        rec = obj.invoice_verify_records.first()
        if not rec:
            return None
        return {
            'result': rec.result,
            'result_display': rec.get_result_display(),
            'message': rec.message,
            'verified_at': rec.verified_at.isoformat() if rec.verified_at else '',
        }


class SubsidyPaymentSerializer(serializers.ModelSerializer):
    application_no = serializers.SerializerMethodField()
    invoice_type_display = serializers.SerializerMethodField()

    class Meta:
        model = SubsidyPayment
        fields = ['id', 'application', 'application_no', 'invoice_type_display', 'amount', 'note', 'paid_at']

    def get_application_no(self, obj):
        if obj.application:
            return obj.application.application_no
        if obj.withdrawal:
            return f'提现 #{obj.withdrawal.id}'
        return ''

    def get_invoice_type_display(self, obj):
        return obj.application.get_invoice_type_display() if obj.application else ''


class SubsidyWalletSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubsidyWallet
        fields = ['id', 'balance', 'total_in', 'total_out', 'updated_at']


class SubsidyWithdrawalSerializer(serializers.ModelSerializer):
    status_display = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    user_avatar = serializers.SerializerMethodField()
    user_department = serializers.SerializerMethodField()
    user_position = serializers.SerializerMethodField()
    payment = serializers.SerializerMethodField()
    remaining_balance = serializers.SerializerMethodField()
    applicant_payment = serializers.SerializerMethodField()
    paid_by_name = serializers.SerializerMethodField()
    paid_by_avatar = serializers.SerializerMethodField()

    class Meta:
        model = SubsidyWithdrawal
        fields = [
            'id', 'user', 'user_name', 'user_avatar', 'user_department', 'user_position',
            'amount', 'status', 'status_display', 'reject_reason',
            'payment_voucher', 'payment_voucher_name',
            'paid_by', 'paid_by_name', 'paid_by_avatar', 'paid_at', 'requested_at', 'note',
            'payment', 'remaining_balance', 'applicant_payment',
        ]
        read_only_fields = fields

    def get_status_display(self, obj):
        return obj.get_status_display()

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username if obj.user else ''

    def get_user_avatar(self, obj):
        return obj.user.get_avatar_url() if obj.user and hasattr(obj.user, 'get_avatar_url') else ''

    def get_user_department(self, obj):
        u = obj.user
        if not u:
            return ''
        try:
            from org.models import UserDepartment
            rec = UserDepartment.objects.filter(user=u, is_primary=True).select_related('department').first()
            if rec and rec.department:
                return rec.department.name
        except Exception:
            pass
        return u.department.name if u.department else ''

    def get_user_position(self, obj):
        return obj.user.position if obj.user and obj.user.position else ''

    def get_payment(self, obj):
        p = getattr(obj, 'payment', None)
        if not p:
            return None
        return {'id': p.id, 'amount': float(p.amount), 'paid_at': p.paid_at.isoformat() if p.paid_at else ''}

    def get_paid_by_name(self, obj):
        return obj.paid_by.real_name or obj.paid_by.username if obj.paid_by else ''

    def get_paid_by_avatar(self, obj):
        return obj.paid_by.get_avatar_url() if obj.paid_by and hasattr(obj.paid_by, 'get_avatar_url') else ''

    def get_remaining_balance(self, obj):
        try:
            w = SubsidyWallet.objects.filter(user=obj.user, tenant=obj.tenant).first()
            return float(w.balance) if w else 0
        except Exception:
            return 0

    def get_applicant_payment(self, obj):
        u = obj.user
        if not u:
            return {}
        return {
            'payee_name': u.payee_name or '',
            'bank_card': u.bank_card or '',
            'alipay_account': u.alipay_account or '',
            'wechat_account': u.wechat_account or '',
            'alipay_qr': u.alipay_qr or '',
            'wechat_qr': u.wechat_qr or '',
        }
