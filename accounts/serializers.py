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
from .models import CustomUser, Department
from loguru import logger
import re
import os

class DepartmentSerializer(serializers.ModelSerializer):
    """部门序列化器"""
    class Meta:
        model = Department
        fields = ['id', 'name', 'parent']


class UserDetailSerializer(serializers.ModelSerializer):
    """用户详细信息序列化器"""
    department_info = DepartmentSerializer(source='department', read_only=True)
    avatar_url = serializers.SerializerMethodField()
    online_status = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'email', 'phone', 'real_name', 'department', 'department_info',
            'position', 'avatar', 'avatar_url', 'gender', 'bio', 'user_type',
            'is_online', 'last_seen', 'date_joined', 'last_login', 'online_status', 'is_active',
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
        if user.phone != value and CustomUser.objects.filter(phone=value).exists():
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
            'username', 'password', 'password_confirm', 'real_name', 'gender', 'email', 'phone',
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
        if user and user.phone != value and CustomUser.objects.filter(phone=value).exists():
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



class UserListSerializer(serializers.ModelSerializer):
    """用户列表序列化器"""
    avatar_url = serializers.SerializerMethodField()
    online_status = serializers.SerializerMethodField()
    department_name = serializers.CharField(source='department.name', read_only=True)

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'real_name', 'email' , 'avatar_url', 'department_name', 'position',
            'online_status', 'is_active', 'user_type'
        ]

    def get_avatar_url(self, obj):
        request = self.context.get('request')
        if obj.avatar and hasattr(obj.avatar, 'url'):
            return os.path.join(settings.BASE_URL, obj.avatar.url.strip('/'))
            # if request:
            #     return request.build_absolute_uri(obj.avatar.url)
            # return obj.avatar.url

        return '/static/images/default-avatar.png'

    def get_online_status(self, obj):
        return {
            'is_online': obj.is_online,
            'last_seen': obj.last_seen.isoformat() if obj.last_seen else None
        }


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
            'last_login'
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
            if CustomUser.objects.filter(phone=value).exists():
                raise serializers.ValidationError("该手机号已被其他用户使用")
        return value

    def validate(self, data):
        """验证密码一致性"""
        if data['password'] != data['password_confirm']:
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
        """验证登录信息"""
        username = data.get('username')
        password = data.get('password')

        logger.info(f"用户 {username} 尝试登录")
        logger.info(f"用户 {username} 登录密码：{password}")

        # 尝试用用户名或邮箱登录
        user = None
        if '@' in username:
            # 可能是邮箱
            try:
                user_obj = CustomUser.objects.get(email=username)
                username = user_obj.username
            except CustomUser.DoesNotExist:
                pass


        # 认证用户
        user = authenticate(username=username, password=password)
        logger.info(f"用户 {username} 准备登录")
        if user is None:
            raise serializers.ValidationError({
                'non_field_errors': ["用户名或密码错误"]
            })

        if not user.is_active:
            raise serializers.ValidationError({
                'non_field_errors': ["账户已被禁用，请联系管理员"]
            })

        # 更新用户在线状态
        user.update_online_status(True)

        # 更新用户最后登录时间
        user.last_login = timezone.now()
        user.save()


        # 生成 JWT token
        refresh = RefreshToken.for_user(user)

        data['user'] = user
        data['refresh'] = str(refresh)
        data['access'] = str(refresh.access_token)

        return data


class ChangePasswordSerializer(serializers.Serializer):
    """修改密码序列化器"""

    old_password = serializers.CharField(
        required=True,
        style={'input_type': 'password'},
        help_text="当前密码"
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
        """验证密码"""
        if data['new_password'] != data['new_password_confirm']:
            raise serializers.ValidationError({
                'new_password_confirm': "两次输入的新密码不一致"
            })

        # 验证旧密码
        user = self.context['request'].user
        if not user.check_password(data['old_password']):
            raise serializers.ValidationError({
                'old_password': "当前密码错误"
            })

        # 检查新密码是否与旧密码相同
        if user.check_password(data['new_password']):
            raise serializers.ValidationError({
                'new_password': "新密码不能与当前密码相同"
            })

        return data

    def save(self):
        """保存新密码"""
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save()
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