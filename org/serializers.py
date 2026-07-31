# org/serializers.py
from rest_framework import serializers
from accounts.models import Tenant, Department, TenantMembership, CustomUser
from .models import UserDepartment, ReportRelation, OrgChangeLog


class TenantSerializer(serializers.ModelSerializer):
    """企业/租户序列化器"""
    owner_name = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = '__all__'
        read_only_fields = ['level', 'created_at', 'updated_at']

    def get_owner_name(self, obj):
        return obj.owner.real_name or obj.owner.username if obj.owner else ''

    def get_member_count(self, obj):
        return obj.memberships.filter(is_active=True).count()

    def get_role(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            membership = obj.memberships.filter(user=request.user).first()
            return membership.role if membership else None
        return None

    def get_is_current(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            active = request.user.get_active_tenant()
            return active is not None and active.id == obj.id
        return False


class TenantCreateSerializer(serializers.ModelSerializer):
    """创建企业序列化器"""

    class Meta:
        model = Tenant
        fields = ['name', 'short_name', 'code', 'industry', 'scale', 'address',
                  'contact_phone', 'website', 'description', 'tenant_type', 'parent']


class TenantMembershipSerializer(serializers.ModelSerializer):
    """用户企业关联序列化器"""
    user_name = serializers.SerializerMethodField()
    tenant_name = serializers.SerializerMethodField()

    class Meta:
        model = TenantMembership
        fields = '__all__'

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username

    def get_tenant_name(self, obj):
        return obj.tenant.name


class DepartmentTreeSerializer(serializers.ModelSerializer):
    """部门树序列化器（带层级、负责人信息、集团企业信息）"""
    parent_name = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    manager_info = serializers.SerializerMethodField()
    deputy_managers_info = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()
    tenant_name = serializers.SerializerMethodField()
    converted_tenant_name = serializers.SerializerMethodField()

    class Meta:
        model = Department
        fields = '__all__'
        read_only_fields = ['level', 'full_path', 'created_at', 'updated_at', 'tenant']

    def get_parent_name(self, obj):
        return obj.parent.name if obj.parent else ''

    def get_manager_name(self, obj):
        return obj.manager.real_name or obj.manager.username if obj.manager else ''

    def get_manager_info(self, obj):
        if not obj.manager:
            return None
        return {
            'id': obj.manager.id, 'username': obj.manager.username,
            'real_name': obj.manager.real_name or '',
            'avatar': obj.manager.get_avatar_url(),
            'position': obj.manager.position or '',
        }

    def get_deputy_managers_info(self, obj):
        return [{
            'id': du.id, 'username': du.username,
            'real_name': du.real_name or '',
            'avatar': du.get_avatar_url(),
            'position': du.position or '',
        } for du in obj.deputy_managers.all()]

    def get_member_count(self, obj):
        return obj.get_member_count()

    def get_children_count(self, obj):
        return obj.children.filter(is_active=True).count()

    def get_tenant_name(self, obj):
        if obj.tenant:
            return obj.tenant.short_name or obj.tenant.name
        return ''

    def get_converted_tenant_name(self, obj):
        if obj.converted_tenant:
            return obj.converted_tenant.short_name or obj.converted_tenant.name
        return ''


class DepartmentCreateSerializer(serializers.ModelSerializer):
    """创建/更新部门序列化器"""
    parent = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(), required=False, allow_null=True)
    manager = serializers.PrimaryKeyRelatedField(
        queryset=CustomUser.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Department
        fields = ['name', 'code', 'parent', 'description', 'department_type',
                  'sort_order', 'manager', 'visibility', 'auto_create_group',
                  'auto_sync_members', 'tags']

    def validate_name(self, value):
        """检查同一企业同一父部门下已启用部门名称唯一"""
        request = self.context.get('request')
        tenant = getattr(request, 'tenant', None)
        parent_id = self.initial_data.get('parent') or getattr(self.instance, 'parent_id', None)
        if tenant and value:
            qs = Department.objects.filter(tenant=tenant, name=value, parent_id=parent_id, is_active=True)
            if self.instance:
                qs = qs.exclude(id=self.instance.id)
            if qs.exists():
                raise serializers.ValidationError({'error': '同一企业下同级部门名称不能重复'})
        return value

    def validate_parent(self, value):
        """防止将部门设置到自身或子部门下，且必须属于同一企业"""
        if value:
            # 检查父部门是否属于同一企业
            request = self.context.get('request')
            tenant = getattr(request, 'tenant', None)
            if tenant and value.tenant_id != tenant.id:
                raise serializers.ValidationError({'error': '上级部门必须属于同一企业'})
            if self.instance and value.id == self.instance.id:
                raise serializers.ValidationError({'error': '不能将部门自身设为上级部门'})
            if self.instance and self.instance.id in value.get_ancestor_ids():
                raise serializers.ValidationError({'error': '不能将部门设置到子部门下'})
        return value

    def validate_manager(self, value):
        """检查负责人是否在当前企业的成员中"""
        if value:
            request = self.context.get('request')
            tenant = getattr(request, 'tenant', None)
            if tenant and hasattr(value, 'tenant_memberships'):
                if not value.tenant_memberships.filter(tenant=tenant, is_active=True).exists():
                    raise serializers.ValidationError({'error': '负责人必须是当前企业的成员'})
        return value


class UserDepartmentSerializer(serializers.ModelSerializer):
    """员工部门关联序列化器"""
    user_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = UserDepartment
        fields = '__all__'

    def get_user_name(self, obj):
        return obj.user.real_name or obj.user.username

    def get_department_name(self, obj):
        return obj.department.name


class UserSimpleSerializer(serializers.ModelSerializer):
    """用户简要信息序列化器"""

    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'real_name', 'avatar', 'email', 'phone', 'position']


class OrgChartSerializer(serializers.Serializer):
    """组织架构图数据序列化器"""
    id = serializers.IntegerField()
    name = serializers.CharField()
    code = serializers.CharField(required=False)
    manager = serializers.CharField(required=False, allow_null=True)
    member_count = serializers.IntegerField(default=0)
    children = serializers.ListField(default=[])


class ReportRelationSerializer(serializers.ModelSerializer):
    """汇报关系序列化器"""

    class Meta:
        model = ReportRelation
        fields = '__all__'


class OrgChangeLogSerializer(serializers.ModelSerializer):
    """变更日志序列化器"""
    operator_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = OrgChangeLog
        fields = '__all__'

    def get_operator_name(self, obj):
        return obj.operator.real_name or obj.operator.username if obj.operator else ''

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ''
