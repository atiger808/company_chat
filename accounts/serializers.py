# -*- coding: utf-8 -*-
# @File   :serializers.py
# @Time   :2026/2/3 15:15
# @Author :admin

# accounts/serializers.py
from rest_framework import serializers
from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils.translation import gettext_lazy as _
from django.utils import timezone
from django.conf import settings

from .models import CustomUser
from rest_framework_simplejwt.tokens import RefreshToken
from .models import CustomUser, Department, ConsultationRequest
from utils.encrypt_aes import encrypt_data, decrypt_data
from utils.utils import SystemConfigManager

from loguru import logger
import re
import os

class DepartmentSerializer(serializers.ModelSerializer):
    """部门序列化器"""
    class Meta:
        model = Department
        fields = ['id', 'name', 'parent']


class UserSerializer(serializers.ModelSerializer):
    """用户序列化器 - 用于展示用户信息"""

    # 只读字段
    is_online = serializers.BooleanField(read_only=True)
    last_seen = serializers.DateTimeField(read_only=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            'id',
            'real_name',
            'email',
            'username',
            'email',
            'phone',
            'department',
            'position',
            'avatar',
            'avatar_url',
            'gender',
            'bio',
            'is_online',
            'last_seen',
            'date_joined',
            'last_login',
            'active_tenant'
        ]
        read_only_fields = ['id', 'date_joined', 'last_login', 'is_online', 'last_seen']
        extra_kwargs = {
            'email': {'required': True},
            'username': {'required': True},
        }

    def get_avatar_url(self, obj):
        """获取头像的完整URL"""
        request = self.context.get('request')
        if obj.avatar and hasattr(obj.avatar, 'url'):
            return os.path.join(settings.BASE_URL, obj.avatar.url.strip('/'))
            # if request is not None:
            #     return request.build_absolute_uri(obj.avatar.url)
            # return obj.avatar.url
        return '/static/images/default-avatar.png'

    def validate_email(self, value):
        """验证邮箱格式和唯一性"""
        # 检查邮箱是否已被其他用户使用
        user_id = self.instance.id if self.instance else None
        if CustomUser.objects.filter(email=value).exclude(id=user_id).exists():
            raise serializers.ValidationError("该邮箱已被其他用户使用")
        return value

    def validate_phone(self, value):
        """验证手机号格式"""
        if value:
            # 简单的手机号格式验证（可以根据需要调整）
            if not value.isdigit():
                raise serializers.ValidationError("手机号必须为数字")
            if len(value) != 11:
                raise serializers.ValidationError("手机号长度必须为11位")
        return value

    def update(self, instance, validated_data):
        """更新用户信息"""
        # 移除不能直接更新的字段
        validated_data.pop('is_online', None)
        validated_data.pop('last_seen', None)

        # 更新头像
        if 'avatar' in validated_data:
            avatar = validated_data.pop('avatar')
            if avatar:
                # 生成唯一的文件名
                import os
                from datetime import datetime
                ext = os.path.splitext(avatar.name)[1]
                avatar.name = f"{instance.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
                instance.avatar = avatar

        # 更新其他字段
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        instance.save()
        return instance



# 在 serializers.py 中添加

class AdminUserCreateSerializer(serializers.ModelSerializer):
    """管理员创建用户序列化器"""
    password = serializers.CharField(write_only=True, required=True, min_length=6)
    password_confirm = serializers.CharField(write_only=True, required=True, min_length=6)
    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(),
        required=False,
        allow_null=True
    )


    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'password', 'password_confirm', 'real_name', 'gender', 'email', 'phone',
            'department', 'position', 'user_type'
        ]
        extra_kwargs = {
            'username': {'required': True},
            'password': {'required': True},
        }

    def validate_username(self, value):
        if len(value) < 3:
            raise serializers.ValidationError("用户名长度不能少于3个字符")
        if not re.match(r'^[a-zA-Z0-9_-]+$', value):
            raise serializers.ValidationError("用户名只能包含字母、数字、下划线或减号")
        if len(value) > 20:
            raise serializers.ValidationError("用户名长度不能超过20个字符")
        if CustomUser.objects.filter(username=value).exists():
            raise serializers.ValidationError("该用户名已被使用")
        return value

    def validate_password(self, value):
        if not value:
            raise serializers.ValidationError("密码不能为空")
        if len(value) < 6:
            raise serializers.ValidationError("密码长度不能少于6个字符")
        return value

    def validate_password_confirm(self, value):
        if value != self.initial_data.get('password'):
            raise serializers.ValidationError("两次输入的密码不一致")
        return value

    def validate_real_name(self, value):
        if value and len(str(value))>5:
            raise serializers.ValidationError("真实姓名长度不能超过5个字符")
        return value

    def validate_phone(self, value):
        if value:
            if not value.isdigit():
                raise serializers.ValidationError("手机号必须为数字")
            if len(value) != 11:
                raise serializers.ValidationError("手机号长度必须为11位")
            if CustomUser.objects.filter(phone=value).exists():
                raise serializers.ValidationError("该手机号已被其他用户使用")
        return value

    def validate_email(self, value):
        if value:
            pattern = r'^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$'
            if not re.match(pattern, value):
                raise serializers.ValidationError("邮箱格式不正确")
            if CustomUser.objects.filter(email=value).exists():
                raise serializers.ValidationError("该邮箱已被其他用户使用")
        return value

    def validate_real_name(self, value):
        if value and len(str(value))>5:
            raise serializers.ValidationError("真实姓名长度不能超过5个字符")
        return value

    def create(self, validated_data):
        # 创建用户
        user = CustomUser.objects.create_user(
            username=validated_data['username'],
            password=validated_data['password'],
            gender=validated_data.get('gender', ''),
            real_name=validated_data.get('real_name', ''),
            email=validated_data.get('email', ''),
            phone=validated_data.get('phone', ''),
            department=validated_data.get('department'),
            position=validated_data.get('position', ''),
            user_type=validated_data.get('user_type', 'normal')
        )
        return user

# 在 serializers.py 中修改 AdminProfileUpdateSerializer

class AdminProfileUpdateSerializer(serializers.ModelSerializer):
    """管理员资料更新序列化器（可修改部门和职位）"""
    # 明确指定 department 字段为 PrimaryKeyRelatedField
    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(),
        required=False,
        allow_null=True
    )

    class Meta:
        model = CustomUser
        fields = ['real_name', 'email', 'phone', 'department', 'position', 'gender', 'bio', 'avatar', 'user_type']

    def validate_phone(self, value):
        if value and not value.isdigit():
            raise serializers.ValidationError("手机号必须为数字")
        if value and len(value) != 11:
            raise serializers.ValidationError("手机号长度必须为11位")
        # 检查手机号是否被其他用户使用
        user = self.instance
        if value and user and user.phone != value and CustomUser.objects.filter(phone=value).exists():
            raise serializers.ValidationError("该手机号已被其他用户使用")
        return value

    def validate_email(self, value):
        pattern = r'^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$'
        if value and not re.match(pattern, value):
            raise serializers.ValidationError("邮箱格式不正确")
        # 检查邮箱是否被其他用户使用
        user = self.instance
        if user and user.email != value and CustomUser.objects.filter(email=value).exists():
            raise serializers.ValidationError("该邮箱已被其他用户使用")
        return value

    def validate_real_name(self, value):
        if value and len(str(value)) > 5:
            raise serializers.ValidationError("真实姓名长度不能超过5个字符")
        return value

    def validate_position(self, value):
        if value and len(value) > 30:
            raise serializers.ValidationError("职位长度不能超过30字符")
        return value



# class UserListSerializer(serializers.ModelSerializer):
#     """用户列表序列化器"""
#     avatar_url = serializers.SerializerMethodField()
#     online_status = serializers.SerializerMethodField()
#     department_name = serializers.CharField(source='department.name', read_only=True)
#
#     class Meta:
#         model = CustomUser
#         fields = [
#             'id', 'username', 'real_name', 'email' , 'avatar_url', 'department_name', 'position',
#             'online_status', 'is_active', 'user_type'
#         ]
#
#     def get_avatar_url(self, obj):
#         request = self.context.get('request')
#         if obj.avatar and hasattr(obj.avatar, 'url'):
#             return os.path.join(settings.BASE_URL, obj.avatar.url.strip('/'))
#             # if request:
#             #     return request.build_absolute_uri(obj.avatar.url)
#             # return obj.avatar.url
#
#         return '/static/images/default-avatar.png'
#
#     def get_online_status(self, obj):
#         return {
#             'is_online': obj.is_online,
#             'last_seen': obj.last_seen.isoformat() if obj.last_seen else None
#         }



class RegisterSerializer(serializers.ModelSerializer):
    """用户注册序列化器"""

    username = serializers.CharField(
        required=True,
        help_text="用户名"
    )

    password = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'},
        validators=[validate_password],
        help_text="密码必须至少8位，包含数字和字母"
    )
    password_confirm = serializers.CharField(
        write_only=True,
        required=True,
        style={'input_type': 'password'},
        help_text="确认密码"
    )
    email = serializers.EmailField(
        required=True,
        help_text="邮箱地址"
    )

    phone = serializers.CharField(
        required=False,
        help_text="手机号"
    )


    # 移除 department 字段，注册时不设置部门
    department = None  # 不允许注册时设置部门

    class Meta:
        model = CustomUser
        fields = [
            'username',
            'email',
            'password',
            'password_confirm',
            'phone',
            'position',
            'gender'
            # 注意：不包含 department
        ]
        extra_kwargs = {
            'username': {
                'required': True,
                'help_text': "用户名，3-20个字符，只能包含字母、数字、下划线"
            },
            'phone': {'required': False},
            'position': {'required': False},
            'gender': {'required': False},
        }

    def validate_username(self, value):
        if len(value) < 3:
            raise serializers.ValidationError("用户名长度不能少于3个字符")
        if not re.match(r'^[a-zA-Z0-9_-]+$', value):
            raise serializers.ValidationError("用户名只能包含字母、数字、下划线或减号")
        if len(value) > 20:
            raise serializers.ValidationError("用户名长度不能超过20个字符")
        if CustomUser.objects.filter(username=value).exists():
            raise serializers.ValidationError("该用户名已被使用")
        return value


    def validate_email(self, value):
        """验证邮箱"""
        pattern = r'^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$'
        if not re.match(pattern, value):
            raise serializers.ValidationError("邮箱格式不正确")
        if CustomUser.objects.filter(email=value).exists():
            raise serializers.ValidationError("该邮箱已被注册")
        return value

    def validate_phone(self, value):
        """验证手机号"""
        if value:
            # 简单的手机号格式验证（可以根据需要调整）
            if not value.isdigit():
                raise serializers.ValidationError("手机号必须为数字")
            if len(value) != 11:
                raise serializers.ValidationError("手机号长度必须为11位")
            # 如果手机号已被其他用户使用:
            if value and CustomUser.objects.filter(phone=value).exists():
                raise serializers.ValidationError("该手机号已被其他用户使用")
        return value

    def validate(self, data):
        """验证密码一致性"""

        password = data.get('password')
        password_confirm = data.get('password_confirm')

        if not password or not password_confirm:
            raise serializers.ValidationError({
                'password': "密码不能为空",
                'password_confirm': "确认密码不能为空"
            })

        # 🔧 从配置读取密码策略
        password_min_length = SystemConfigManager.get_config('security.password_min_length', 8)
        password_require_special = SystemConfigManager.get_config('security.password_require_special', True)

        password = decrypt_data(password)
        password_confirm = decrypt_data(password_confirm)

        if len(password) < password_min_length:
            raise serializers.ValidationError("密码长度不能少于{}个字符".format(password_min_length))

        if password_require_special:
            import re
            if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
                raise serializers.ValidationError({
                    'password': '密码必须包含特殊字符'
                })

        if password != password_confirm:
            raise serializers.ValidationError({
                'password_confirm': "两次输入的密码不一致"
            })
        return data

    def create(self, validated_data):
        """创建用户"""
        # 移除确认密码字段
        validated_data.pop('password_confirm')

        # 确保不设置 department
        validated_data.pop('department', None)

        # 创建用户
        user = CustomUser.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            phone=validated_data.get('phone', ''),
            position=validated_data.get('position', ''),
            gender=validated_data.get('gender', ''),
            is_active=True
        )

        return user


class LoginSerializer(serializers.Serializer):
    """用户登录序列化器"""

    username = serializers.CharField(
        required=True,
        help_text="用户名或邮箱"
    )
    password = serializers.CharField(
        required=True,
        style={'input_type': 'password'},
        help_text="密码"
    )
    remember_me = serializers.BooleanField(
        required=False,
        default=False,
        help_text="记住我"
    )

    def validate(self, data):
        """验证登录信息 - 增加锁定策略"""
        username = data.get('username')
        password = data.get('password')

        # 解密密码（如果前端加密传输）
        if password:
            try:
                password = decrypt_data(password)
            except:
                logger.warning(f"用户 {username} 密码解密失败：{password}")
                raise serializers.ValidationError("密码解析失败")
                # pass  # 解密失败按原密码处理

        # 🔧 从配置读取锁定策略
        login_max_attempts = SystemConfigManager.get_config('security.login_max_attempts', 5)
        login_lockout_minutes = SystemConfigManager.get_config('security.login_lockout_minutes', 15)

        logger.info(f"用户 {username} 尝试登录")

        # 1️⃣ 查找用户（支持用户名或邮箱）
        user = None
        if '@' in username:
            user = CustomUser.objects.filter(email=username).first()
        if not user:
            user = CustomUser.objects.filter(username=username).first()

        # 2️⃣ 用户不存在时，统一返回错误（避免枚举攻击）
        if not user:
            # 记录失败尝试（可选：记录IP用于风控）
            logger.warning(f"登录失败：用户 {username} 不存在")
            raise serializers.ValidationError({
                'non_field_errors': ["用户名或密码错误"]
            })

        # 3️⃣ 检查账户是否被锁定
        if user.is_locked_out(login_max_attempts, login_lockout_minutes):
            # 计算剩余锁定时间
            from datetime import timedelta
            lockout_end = user.last_failed_login + timedelta(minutes=login_lockout_minutes)
            remaining_seconds = int((lockout_end - timezone.now()).total_seconds())

            logger.warning(f"账户锁定：{user.username}, 剩余 {remaining_seconds} 秒")
            raise serializers.ValidationError({
                'non_field_errors': [f"账户已锁定，请{remaining_seconds // 60}分钟{remaining_seconds % 60}秒后再试"]
            })

        # 4️⃣ 验证密码
        if not user.check_password(password):
            # 记录失败次数
            user.increment_login_attempts()
            logger.warning(f"密码错误：{user.username}, 失败次数：{user.login_attempts}")

            # 如果达到最大尝试次数，记录警告
            if user.login_attempts >= login_max_attempts:
                logger.warning(f"账户 {user.username} 因多次失败被锁定 {login_lockout_minutes} 分钟")

            raise serializers.ValidationError({
                'non_field_errors': ["用户名或密码错误"]
            })

        # 5️⃣ 检查账户状态
        if not user.is_active:
            logger.warning(f"账户禁用：{user.username}")
            raise serializers.ValidationError({
                'non_field_errors': ["账户已被禁用，请联系管理员"]
            })

        # ✅ 登录成功：重置失败计数 + 更新状态
        user.reset_login_attempts()
        user.update_online_status(True)
        user.last_login = timezone.now()
        user.save(update_fields=['last_login'])

        # 生成 JWT token
        refresh = RefreshToken.for_user(user)

        data['user'] = user
        data['refresh'] = str(refresh)
        data['access'] = str(refresh.access_token)

        logger.info(f"登录成功：{user.username}")
        return data



class UserDetailSerializer(serializers.ModelSerializer):
    """用户详细信息序列化器"""
    # department_info = DepartmentSerializer(source='department', read_only=True)
    department_info = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    online_status = serializers.SerializerMethodField()
    tenant_info = serializers.SerializerMethodField()

    org_departments = serializers.SerializerMethodField()
    supervisor = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'email', 'phone', 'real_name', 'department', 'department_info',
            'position', 'avatar', 'avatar_url', 'gender', 'bio', 'user_type',
            'is_online', 'last_seen', 'date_joined', 'last_login', 'online_status', 'is_active',
            'tenant_info', 'org_departments', 'supervisor',
        ]
        read_only_fields = ['id', 'date_joined', 'last_login', 'user_type', 'username']  # 添加 username 为只读

    def get_avatar_url(self, obj):
        request = self.context.get('request')
        if obj.avatar and hasattr(obj.avatar, 'url'):
            return os.path.join(settings.BASE_URL, obj.avatar.url.strip('/'))
        return '/static/images/default-avatar.png'

    def get_online_status(self, obj):
        return {
            'is_online': obj.is_online,
            'last_seen': obj.last_seen.isoformat() if obj.last_seen else None
        }

    def get_department_info(self, obj):
        """获取用户部门信息（优先组织架构部门，降级为旧版 department）"""
        # 降级：返回组织架构主部门
        try:
            from org.models import UserDepartment
            primary = UserDepartment.objects.filter(
                user=obj, is_primary=True
            ).select_related('department').first()
            if primary:
                return {
                    'id': primary.department.id,
                    'name': primary.department.name,
                    'type': 'org',
                    'position': primary.position,
                }
        except Exception:
            pass

        if obj.department:
            return {
                'id': obj.department.id,
                'name': obj.department.name,
                'type': 'legacy',
            }

        return None


    def get_org_departments(self, obj):
        """获取用户在组织架构中的部门信息"""
        try:
            from org.models import UserDepartment
            rels = UserDepartment.objects.filter(user=obj).select_related('department')
            return [{
                'id': r.department.id,
                'name': r.department.name,
                'full_path': r.department.full_path or r.department.name,
                'position': r.position,
                'is_primary': r.is_primary,
            } for r in rels if r.department.is_active]
        except Exception:
            return []

    def get_supervisor(self, obj):
        """获取用户的直属主管信息"""
        try:
            from org.models import ReportRelation
            rel = ReportRelation.objects.filter(
                user=obj, is_direct=True
            ).select_related('supervisor').first()
            if rel and rel.supervisor:
                return {
                    'id': rel.supervisor.id,
                    'username': rel.supervisor.username,
                    'real_name': rel.supervisor.real_name or '',
                    'avatar': rel.supervisor.get_avatar_url(),
                    'position': rel.supervisor.position or '',
                }
        except Exception:
            pass
        return None

    def get_tenant_info(self, obj):
        try:
            from accounts.models import TenantMembership
            # 优先使用 active_tenant
            if obj.active_tenant_id:
                membership = TenantMembership.objects.filter(
                    user=obj, tenant_id=obj.active_tenant_id, is_active=True
                ).select_related('tenant').first()
                if membership:
                    return {
                        'id': membership.tenant.id,
                        'name': membership.tenant.name,
                        'short_name': membership.tenant.short_name or '',
                        'role': membership.role,
                    }
            # 降级：返回第一个激活的成员关系
            membership = TenantMembership.objects.filter(
                user=obj, is_active=True
            ).select_related('tenant').first()
            if membership:
                return {
                    'id': membership.tenant.id,
                    'name': membership.tenant.name,
                    'short_name': membership.tenant.short_name or '',
                    'role': membership.role,
                }
        except Exception:
            pass
        return None


class UserProfileUpdateSerializer(serializers.ModelSerializer):
    """用户资料更新序列化器"""


    class Meta:
        model = CustomUser
        fields = ['real_name', 'email', 'phone', 'gender', 'bio', 'avatar']


    def validate_phone(self, value):
        if value and not value.isdigit():
            raise serializers.ValidationError("手机号必须为数字")
        if value and len(value) != 11:
            raise serializers.ValidationError("手机号长度必须为11位")

        # 如果手机号已存在，则不允许修改
        user = self.instance
        if value and user.phone != value and CustomUser.objects.filter(phone=value).exists():
            raise serializers.ValidationError("该手机号已被其他用户使用")

        return value

    def validate_email(self, value):
        pattern = r'^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$'
        if value and not re.match(pattern, value):
            raise serializers.ValidationError("邮箱格式不正确")

        # 如果邮箱已存在，则不允许修改
        user = self.instance
        if user.email != value and CustomUser.objects.filter(email=value).exists():
            raise serializers.ValidationError("该邮箱已被其他用户使用")

        return value

    def validate_real_name(self, value):
        if value and len(str(value))>5:
            raise serializers.ValidationError("真实姓名长度不能超过5个字符")
        return value


    # def update(self, instance, validated_data):
    #     """更新用户资料"""
    #     # 处理头像上传
    #     if 'avatar' in validated_data:
    #         avatar = validated_data.pop('avatar')
    #         if avatar:
    #             import os
    #             from datetime import datetime
    #             ext = os.path.splitext(avatar.name)[1]
    #             avatar.name = f"{instance.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
    #             instance.avatar = avatar
    #
    #     # 更新其他字段
    #     for attr, value in validated_data.items():
    #         setattr(instance, attr, value)
    #
    #     instance.save()
    #     return instance


class AvatarUploadSerializer(serializers.Serializer):
    """头像上传序列化器"""

    avatar = serializers.ImageField(
        required=True,
        help_text="头像图片"
    )

    def validate_avatar(self, value):
        """验证头像"""
        # 验证文件大小（最大2MB）
        if value.size > 2 * 1024 * 1024:
            raise serializers.ValidationError("头像大小不能超过2MB")

        # 验证文件类型
        valid_extensions = ['.jpg', '.jpeg', '.png', '.gif']
        ext = value.name.lower().split('.')[-1]
        if f'.{ext}' not in valid_extensions:
            raise serializers.ValidationError("只支持 JPG、PNG、GIF 格式的图片")

        return value

    def save(self):
        """保存头像"""
        user = self.context['request'].user
        avatar = self.validated_data['avatar']

        # 生成唯一文件名
        import os
        from datetime import datetime
        ext = os.path.splitext(avatar.name)[1]
        avatar.name = f"{user.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"

        # 删除旧头像
        if user.avatar and user.avatar.name != 'default-avatar.png':
            if os.path.exists(user.avatar.path):
                os.remove(user.avatar.path)

        user.avatar = avatar
        user.save()
        return user


class UserListSerializer(serializers.ModelSerializer):
    """用户列表序列化器（精简版，用于通讯录）"""

    department_info = DepartmentSerializer(source='department', read_only=True)

    avatar_url = serializers.SerializerMethodField()
    online_status = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            'id',
            'username',
            'real_name',
            'phone',
            'email',
            'avatar_url',
            'department',
            'department_info',
            'position',
            'online_status'
        ]

    def get_avatar_url(self, obj):
        """获取头像URL"""
        request = self.context.get('request')
        if obj.avatar and hasattr(obj.avatar, 'url'):
            return os.path.join(settings.BASE_URL, obj.avatar.url.strip('/'))
            # if request is not None:
            #     return request.build_absolute_uri(obj.avatar.url)
            # return obj.avatar.url
        # 返回默认头像或首字母头像
        return '/static/images/default_avatar.png'

    def get_online_status(self, obj):
        """获取在线状态"""
        return {
            'is_online': obj.is_online,
            'last_seen': obj.last_seen.isoformat() if obj.last_seen else None
        }


# accounts/serializers.py

class ChangePasswordSerializer(serializers.Serializer):
    """修改密码序列化器 - 完善版"""

    old_password = serializers.CharField(
        required=True, style={'input_type': 'password'}, help_text="当前密码"
    )
    new_password = serializers.CharField(
        required=True, style={'input_type': 'password'},
        validators=[validate_password], help_text="新密码"
    )
    new_password_confirm = serializers.CharField(
        required=True, style={'input_type': 'password'}, help_text="确认新密码"
    )

    def validate(self, data):
        """增强验证逻辑"""
        user = self.context['request'].user

        # 解密
        old_password = data['old_password']
        new_password = data['new_password']
        new_password_confirm = data['new_password_confirm']

        try:
            data['old_password'] = decrypt_data(old_password)
            data['new_password'] = decrypt_data(new_password)
            data['new_password_confirm'] = decrypt_data(new_password_confirm)
        except Exception as e:
            logger.error(f"修改密码失败 - 解密失败: {e}")


        # 1️⃣ 验证两次新密码一致
        if data['new_password'] != data['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': "两次输入的新密码不一致"
            })

        # 2️⃣ 验证旧密码正确
        if not user.check_password(data['old_password']):
            # 记录失败尝试（防止暴力破解）
            logger.warning(f"修改密码失败 - 旧密码错误: {user.username}")
            raise serializers.ValidationError({
                'old_password': "当前密码错误"
            })

        # 3️⃣ 新密码不能与旧密码相同
        if user.check_password(data['new_password']):
            raise serializers.ValidationError({
                'new_password': "新密码不能与当前密码相同"
            })

        # 4️⃣ 🔧 从配置读取密码策略并验证
        password_min_length = SystemConfigManager.get_config('security.password_min_length', 8)
        password_require_special = SystemConfigManager.get_config('security.password_require_special', True)

        if len(data['new_password']) < password_min_length:
            raise serializers.ValidationError({
                'new_password': f'密码长度至少{password_min_length}位'
            })

        if password_require_special:
            import re
            if not re.search(r'[!@#$%^&*(),.?":{}|<>]', data['new_password']):
                raise serializers.ValidationError({
                    'new_password': '密码必须包含特殊字符'
                })

        # 5️⃣ 可选：检查密码历史（防止重复使用最近用过的密码）
        # 如需实现，可添加 PasswordHistory 模型记录

        return data

    def save(self, **kwargs):
        """保存新密码"""
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save()

        # 🔧 关键：修改密码后使其他设备登录失效（可选）
        # 方案1：更新 user.password 会自动使旧 token 失效（如果 token 包含 password hash）
        # 方案2：记录密码修改时间，在 token 验证时检查

        logger.info(f"用户 {user.username} 成功修改密码")
        return user


class PasswordResetRequestSerializer(serializers.Serializer):
    """密码重置请求序列化器"""

    email = serializers.EmailField(
        required=True,
        help_text="注册时使用的邮箱"
    )

    def validate_email(self, value):
        """验证邮箱是否存在"""
        if not CustomUser.objects.filter(email=value).exists():
            raise serializers.ValidationError("该邮箱未注册")
        return value


class PasswordResetConfirmSerializer(serializers.Serializer):
    """密码重置确认序列化器"""

    token = serializers.CharField(
        required=True,
        help_text="重置令牌"
    )
    new_password = serializers.CharField(
        required=True,
        style={'input_type': 'password'},
        validators=[validate_password],
        help_text="新密码"
    )
    new_password_confirm = serializers.CharField(
        required=True,
        style={'input_type': 'password'},
        help_text="确认新密码"
    )

    def validate(self, data):
        """验证数据"""
        if data['new_password'] != data['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': "两次输入的密码不一致"
            })
        return data





class TokenResponseSerializer(serializers.Serializer):
    """Token响应序列化器（用于API文档）"""

    refresh = serializers.CharField(help_text="刷新令牌")
    access = serializers.CharField(help_text="访问令牌")
    user = UserSerializer(help_text="用户信息")


class UserSearchSerializer(serializers.Serializer):
    """用户搜索序列化器"""

    query = serializers.CharField(
        required=True,
        max_length=100,
        help_text="搜索关键词（用户名、邮箱、部门、职位）"
    )
    limit = serializers.IntegerField(
        required=False,
        default=20,
        min_value=1,
        max_value=100,
        help_text="返回结果数量限制"
    )



class ConsultationRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConsultationRequest
        fields = ['company_name', 'contact_name', 'email', 'phone', 'demand_type', 'message']

    def validate_phone(self, value):
        """验证手机号格式 (11位数字)"""
        if value and not re.match(r'^1[3-9]\d{9}$', value):
            raise serializers.ValidationError("请输入有效的11位手机号码")
        return value

    def validate_email(self, value):
        """验证企业邮箱格式"""
        if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', value):
            raise serializers.ValidationError("请输入有效的邮箱地址")
        return value.lower().strip()

    def validate_company_name(self, value):
        return value.strip()

    def validate_contact_name(self, value):
        return value.strip()