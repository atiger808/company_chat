# accounts/models.py
from email.policy import default

from django.db import models
from django.contrib.auth.models import AbstractUser, Group, Permission
from django.contrib.auth.signals import user_logged_in, user_logged_out  # 修复：添加信号导入
from django.dispatch import receiver
from django.utils import timezone
from django.db.models.signals import post_save
from django.core.validators import FileExtensionValidator


class Department(models.Model):
    """部门模型"""
    name = models.CharField(max_length=100, unique=True, verbose_name='部门名称')
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, verbose_name='上级部门')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '部门'
        verbose_name_plural = '部门'
        ordering = ['name']

    def __str__(self):
        return self.name


class CustomUser(AbstractUser):
    """扩展用户模型"""

    USER_TYPE_CHOICES = (
        ('super_admin', '超级管理员'),
        ('admin', '管理员'),
        ('normal', '普通用户'),
    )

    GENDER_CHOICES = (
        ('male', '男'),
        ('female', '女'),
        ('other', '其他'),
    )

    # 基本信息
    email = models.EmailField(unique=True, verbose_name='邮箱')
    phone = models.CharField(max_length=20, blank=True, null=True, verbose_name='手机号')
    real_name = models.CharField(max_length=100, blank=True, null=True, default='', verbose_name='真实姓名')

    # 工作信息
    department = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='部门')
    position = models.CharField(max_length=100, blank=True, null=True, verbose_name='职位')
    user_type = models.CharField(max_length=20, choices=USER_TYPE_CHOICES, default='normal', verbose_name='用户类型')

    # 个人资料
    avatar = models.ImageField(
        upload_to='avatars/',
        default='avatars/default-avatar.png',
        blank=True,
        null=True,
        verbose_name='头像',
        validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'gif'])]
    )
    gender = models.CharField(
        max_length=10,
        choices=GENDER_CHOICES,
        blank=True,
        null=True,
        verbose_name='性别'
    )
    bio = models.TextField(max_length=500, blank=True, null=True, verbose_name='个人简介')

    # 在线状态
    is_online = models.BooleanField(default=False, verbose_name='在线状态')
    last_seen = models.DateTimeField(null=True, blank=True, verbose_name='最后在线时间')

    # 启用禁用
    is_active = models.BooleanField(default=True, verbose_name='是否启用')

    # 修复：为 groups 和 user_permissions 添加 related_name 避免反向关系冲突
    # 权限相关
    groups = models.ManyToManyField(
        Group,
        verbose_name='用户组',
        blank=True,
        help_text='用户所属的组',
        related_name='customuser_set',  # 关键修复：避免与 auth.User.groups 冲突
        related_query_name='customuser'
    )

    user_permissions = models.ManyToManyField(
        Permission,
        verbose_name='用户权限',
        blank=True,
        help_text='用户特定的权限',
        related_name='customuser_set',  # 关键修复：避免与 auth.User.user_permissions 冲突
        related_query_name='customuser'
    )

    # 好友关系（多对多）
    friends = models.ManyToManyField(
        'self',
        symmetrical=False,
        blank=True,
        related_name='friend_of',
        verbose_name='好友列表'
    )

    class Meta:
        verbose_name = '用户'
        verbose_name_plural = '用户'
        ordering = ['-date_joined']
        # 添加搜索索引
        indexes = [
            models.Index(fields=['username']),
            models.Index(fields=['real_name']),
            models.Index(fields=['email']),
            models.Index(fields=['is_online', 'last_login', 'is_active']),
        ]

    def __str__(self):
        return f'{self.username}({self.real_name})'

    def update_online_status(self, is_online=True):
        """更新在线状态"""
        self.is_online = is_online
        if not is_online:
            self.last_seen = timezone.now()
        self.save(update_fields=['is_online', 'last_seen'])

    def can_edit_department_position(self, editor_user):
        """检查是否可以编辑部门和职位"""
        return editor_user.user_type in ['super_admin', 'admin']

    def get_full_name(self):
        """返回用户全名"""
        full_name = f"{self.department or ''} {self.position or ''}".strip()
        return full_name if full_name else self.username

    def get_avatar_url(self):
        """获取头像URL"""
        if self.avatar and hasattr(self.avatar, 'url'):
            return self.avatar.url
        return '/static/images/default-avatar.png'


class UserActivity(models.Model):
    """用户活动记录"""

    ACTION_CHOICES = (
        ('login', '登录'),
        ('logout', '登出'),
        ('message', '发送消息'),
        ('file_upload', '上传文件'),
        ('room_create', '创建聊天室'),
        ('room_join', '加入聊天室'),
        ('room_leave', '离开聊天室'),
    )

    user = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name='activities',
        verbose_name='用户'
    )
    action = models.CharField(
        max_length=50,
        choices=ACTION_CHOICES,
        verbose_name='操作类型'
    )
    description = models.TextField(blank=True, null=True, verbose_name='描述')
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name='IP地址')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '用户活动'
        verbose_name_plural = '用户活动'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.get_action_display()} - {self.created_at.strftime('%Y-%m-%d %H:%M:%S')}"


# 信号处理器：用户登录时更新在线状态
@receiver(user_logged_in)
def update_user_login_status(sender, request, user, **kwargs):
    if hasattr(user, 'update_online_status'):
        user.update_online_status(True)

        # 记录登录活动
        UserActivity.objects.create(
            user=user,
            action='login',
            ip_address=request.META.get('REMOTE_ADDR'),
            description=f"用户 {user.username} 登录系统"
        )


# 信号处理器：用户登出时更新在线状态
@receiver(user_logged_out)
def update_user_logout_status(sender, request, user, **kwargs):
    if user and hasattr(user, 'update_online_status'):
        user.update_online_status(False)

        # 记录登出活动
        UserActivity.objects.create(
            user=user,
            action='logout',
            ip_address=request.META.get('REMOTE_ADDR'),
            description=f"用户 {user.username} 登出系统"
        )


# 信号处理器：创建用户时确保头像字段有默认值
@receiver(post_save, sender=CustomUser)
def ensure_user_avatar(sender, instance, created, **kwargs):
    if created and not instance.avatar:
        instance.avatar = 'avatars/default-avatar.png'
        instance.save(update_fields=['avatar'])