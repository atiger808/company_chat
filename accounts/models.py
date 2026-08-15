# accounts/models.py
from email.policy import default

from django.db import models
from django.db.models.signals import post_save
from django.contrib.auth.models import AbstractUser, Group, Permission
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed # 修复：添加信号导入
from django.core.validators import FileExtensionValidator, RegexValidator
from django.dispatch import receiver
from django.utils import timezone
from django.conf import settings
import secrets
import hashlib

# from .managers import TenantManager


def get_request_ip(request):
    """
    获取请求IP
    :param request:
    :return:
    """
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[-1].strip()
        return ip
    ip = request.META.get('REMOTE_ADDR', '') or getattr(request, 'request_ip', None)
    return ip or 'unknown'


class Tenant(models.Model):
    """企业/租户模型（多租户隔离的核心）"""

    TENANT_TYPE_CHOICES = [
        ('group', '集团'),
        ('company', '公司'),
        ('branch', '分公司'),
        ('virtual', '虚拟组织'),
    ]

    name = models.CharField(max_length=200, verbose_name='企业名称')
    short_name = models.CharField(max_length=50, blank=True, verbose_name='企业简称')
    code = models.CharField(max_length=50, unique=True, verbose_name='企业编码')
    logo = models.ImageField(upload_to='tenants/logos/', blank=True, verbose_name='企业Logo')

    parent = models.ForeignKey('self', null=True, blank=True,
                               on_delete=models.SET_NULL,
                               related_name='sub_tenants',
                               verbose_name='上级企业/集团')
    tenant_type = models.CharField(max_length=20, choices=TENANT_TYPE_CHOICES,
                                   default='company', verbose_name='企业类型')
    level = models.IntegerField(default=1, verbose_name='层级')

    industry = models.CharField(max_length=100, blank=True, verbose_name='所属行业')
    scale = models.CharField(max_length=50, blank=True, verbose_name='企业规模')
    address = models.CharField(max_length=500, blank=True, verbose_name='企业地址')
    contact_phone = models.CharField(max_length=20, blank=True, verbose_name='联系电话')
    website = models.URLField(blank=True, verbose_name='企业官网')
    description = models.TextField(blank=True, verbose_name='企业简介')

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='owned_tenants',
        verbose_name='企业所有者'
    )

    max_users = models.IntegerField(default=100, verbose_name='最大用户数')
    max_storage_gb = models.IntegerField(default=10, verbose_name='最大存储空间(GB)')
    features = models.JSONField(default=dict, blank=True, verbose_name='功能开关')
    custom_domain = models.CharField(max_length=200, blank=True, verbose_name='自定义域名')

    is_active = models.BooleanField(default=True, verbose_name='是否启用')
    is_verified = models.BooleanField(default=False, verbose_name='是否已认证')

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '企业/租户'
        verbose_name_plural = '企业/租户'
        ordering = ['name']
        indexes = [
            models.Index(fields=['code']),
            models.Index(fields=['parent', 'is_active']),
            models.Index(fields=['tenant_type']),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.parent:
            self.level = self.parent.level + 1
        else:
            self.level = 1
        super().save(*args, **kwargs)

    def get_all_sub_tenant_ids(self):
        ids = [self.id]
        for sub in self.sub_tenants.filter(is_active=True):
            ids.extend(sub.get_all_sub_tenant_ids())
        return ids

    def get_root_tenant(self):
        current = self
        while current.parent:
            current = current.parent
        return current


class TenantMembership(models.Model):
    """用户-企业关联表（一个用户可属于多个企业）"""

    ROLE_CHOICES = [
        ('owner', '企业所有者'),
        ('admin', '企业管理员'),
        ('dept_admin', '部门管理员'),
        ('member', '普通成员'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='tenant_memberships',
        verbose_name='用户'
    )
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.CASCADE,
        related_name='memberships',
        verbose_name='企业'
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES,
                            default='member', verbose_name='企业角色')

    nickname = models.CharField(max_length=100, blank=True, verbose_name='企业内昵称')
    employee_id = models.CharField(max_length=50, blank=True, verbose_name='工号')

    is_active = models.BooleanField(default=True, verbose_name='是否激活')
    is_default = models.BooleanField(default=False, verbose_name='是否默认企业')

    joined_at = models.DateTimeField(auto_now_add=True, verbose_name='加入时间')
    left_at = models.DateTimeField(null=True, blank=True, verbose_name='离开时间')

    class Meta:
        unique_together = ('user', 'tenant')
        verbose_name = '用户企业关联'
        verbose_name_plural = '用户企业关联'
        ordering = ['-joined_at']
        indexes = [
            models.Index(fields=['user', 'is_active']),
            models.Index(fields=['tenant', 'role']),
        ]

    def __str__(self):
        return f'{self.user.username} @ {self.tenant.name} ({self.get_role_display()})'


class Department(models.Model):
    """部门模型（企业级增强版 - 多租户）"""

    # ===== 多租户核心字段 =====
    tenant = models.ForeignKey(
        'Tenant',
        on_delete=models.CASCADE,
        related_name='departments',
        verbose_name='所属企业',
        null=True, blank=True,  # 兼容旧数据
    )

    name = models.CharField(max_length=100, verbose_name='部门名称')
    code = models.CharField(max_length=50, default='', blank=True, verbose_name='部门编码')
    parent = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        verbose_name='上级部门', related_name='children'
    )
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        verbose_name='部门负责人',
        related_name='managed_departments'
    )

    # ===== 新增：层级与排序 =====
    level = models.IntegerField(default=1, verbose_name='层级')
    sort_order = models.IntegerField(default=0, verbose_name='排序号')
    full_path = models.CharField(max_length=500, blank=True, verbose_name='完整路径',
                                 help_text='如：公司/技术部/后端组')

    # ===== 新增：部门属性 =====
    description = models.TextField(blank=True, verbose_name='部门描述')
    department_type = models.CharField(
        max_length=20,
        choices=[
            ('company', '公司'),
            ('department', '部门'),
            ('group', '小组'),
            ('virtual', '虚拟组织')
        ],
        default='department',
        verbose_name='部门类型'
    )

    # ===== 新增：副负责人 =====
    deputy_managers = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='deputy_managed_departments',
        blank=True,
        verbose_name='副负责人'
    )

    # ===== 新增：可见性控制 =====
    visibility = models.CharField(
        max_length=20,
        choices=[
            ('public', '全企业可见'),
            ('department', '仅本部门及子部门可见'),
            ('custom', '自定义可见范围'),
            ('hidden', '隐藏部门')
        ],
        default='public',
        verbose_name='可见范围'
    )
    visible_departments = models.ManyToManyField(
        'self',
        symmetrical=False,
        related_name='visible_by',
        blank=True,
        verbose_name='可见部门列表'
    )

    # ===== 新增：部门群关联 =====
    department_group = models.OneToOneField(
        'chat.ChatRoom',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='department',
        verbose_name='部门群聊'
    )

    # ===== 新增：自动同步 =====
    auto_create_group = models.BooleanField(default=True, verbose_name='自动创建部门群')
    auto_sync_members = models.BooleanField(default=True, verbose_name='自动同步成员到群')

    # ===== 新增：标签 =====
    tags = models.JSONField(default=list, blank=True, verbose_name='部门标签')

    # ===== 部门转子公司 =====
    converted_tenant = models.ForeignKey(
        'Tenant', on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='converted_from_departments',
        verbose_name='转换后的企业'
    )

    is_active = models.BooleanField(default=True, verbose_name='是否启用')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '部门'
        verbose_name_plural = '部门'
        ordering = ['sort_order', 'name']
        indexes = [
            models.Index(fields=['tenant', 'parent', 'is_active']),
            models.Index(fields=['tenant', 'code']),
            models.Index(fields=['tenant', 'level']),
        ]
        unique_together = ('tenant', 'name', 'parent')

    def __str__(self):
        if self.tenant:
            return f'[{self.tenant.short_name or self.tenant.name}] {self.name}'
        return self.name

    def save(self, *args, **kwargs):
        # 自动计算层级和路径
        if self.parent:
            self.level = self.parent.level + 1
            self.full_path = f'{self.parent.full_path}/{self.name}'
        else:
            self.level = 1
            self.full_path = self.name
        super().save(*args, **kwargs)

    def get_all_members(self):
        """获取部门所有成员（仅限本企业）"""
        from org.models import UserDepartment
        user_ids = UserDepartment.objects.filter(
            department=self
        ).values_list('user_id', flat=True)
        from django.conf import settings
        user_model = settings.AUTH_USER_MODEL
        from django.apps import apps
        return apps.get_model(settings.AUTH_USER_MODEL).objects.filter(id__in=user_ids)

    def get_ancestor_ids(self):
        """获取所有祖先部门ID"""
        ids = []
        current = self.parent
        while current:
            ids.append(current.id)
            current = current.parent
        return ids

    def get_descendant_ids(self):
        """获取所有子孙部门ID"""
        ids = []
        children = Department.objects.filter(parent=self)
        for child in children:
            ids.append(child.id)
            ids.extend(child.get_descendant_ids())
        return ids

    def get_member_count(self):
        """获取部门成员数量"""
        from org.models import UserDepartment
        return UserDepartment.objects.filter(department=self).count()


class CustomUser(AbstractUser):
    """扩展用户模型 - 企业级安全增强版"""

    USER_TYPE_CHOICES = (
        ('super_admin', '超级管理员'),
        ('admin', '管理员'),
        ('normal', '普通用户'),
        ('visitor', '访客'),  # 🔧 新增：访客类型
        # ('user', '普通用户'),
    )

    GENDER_CHOICES = (
        ('male', '男'),
        ('female', '女'),
        ('other', '其他'),
    )

    # 基本信息
    email = models.EmailField(unique=True, verbose_name='邮箱')
    # 🔧 手机号验证器（中国大陆）
    phone = models.CharField(
        max_length=20,
        blank=True,
        null=True,
        verbose_name='手机号',
        validators=[RegexValidator(
            regex=r'^1[3-9]\d{9}$',
            message='请输入有效的中国大陆手机号'
        )]
    )
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
        validators=[FileExtensionValidator(allowed_extensions=['jpg', 'jpeg', 'png', 'gif', 'webp'])]
    )
    gender = models.CharField(
        max_length=10,
        choices=GENDER_CHOICES,
        blank=True,
        null=True,
        verbose_name='性别'
    )
    bio = models.TextField(max_length=500, blank=True, null=True, verbose_name='个人简介')

    # ============ 收款账号（普惠补贴发放用） ============
    payee_name = models.CharField(max_length=50, blank=True, default='', verbose_name='收款人真实姓名')
    bank_card = models.CharField(max_length=40, blank=True, default='', verbose_name='银行卡号')
    alipay_account = models.CharField(max_length=100, blank=True, default='', verbose_name='支付宝账号')
    wechat_account = models.CharField(max_length=100, blank=True, default='', verbose_name='微信账号')
    alipay_qr = models.CharField(max_length=500, blank=True, default='', verbose_name='支付宝收款码')
    wechat_qr = models.CharField(max_length=500, blank=True, default='', verbose_name='微信收款码')

    # 在线状态
    is_online = models.BooleanField(default=False, verbose_name='在线状态')
    last_seen = models.DateTimeField(null=True, blank=True, verbose_name='最后在线时间')

    # 启用禁用 ==================== 账户状态 ====================
    is_active = models.BooleanField(default=True, verbose_name='是否启用')

    # 🔐 登录安全相关（新增）
    login_attempts = models.IntegerField(default=0, verbose_name="登录失败次数")
    last_failed_login = models.DateTimeField(null=True, blank=True, verbose_name="最后登录失败时间")

    # 🔑 密码重置相关（新增）
    password_reset_token = models.CharField(
        max_length=255,
        null=True,
        blank=True,
        verbose_name="密码重置令牌"
    )
    password_reset_token_expires = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="令牌过期时间"
    )

    # 🔧 密码审计相关（新增）
    last_password_change = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="上次密码修改时间"
    )

    # ✉️ 邮箱/手机验证（新增）
    email_verified = models.BooleanField(default=False, verbose_name="邮箱已验证")
    email_verified_at = models.DateTimeField(null=True, blank=True, verbose_name="邮箱验证时间")
    phone_verified = models.BooleanField(default=False, verbose_name="手机已验证")
    phone_verified_at = models.DateTimeField(null=True, blank=True, verbose_name="手机验证时间")



    # 修复：为 groups 和 user_permissions 添加 related_name 避免反向关系冲突
    #  ==================== 权限相关 ====================
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

    # ==================== 好友关系 ====================
    # 好友关系（多对多）
    friends = models.ManyToManyField(
        'self',
        symmetrical=False,
        blank=True,
        related_name='friend_of',
        verbose_name='好友列表'
    )

    # ===== 多租户字段 =====
    active_tenant = models.ForeignKey(
        Tenant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='active_users',
        verbose_name='当前激活企业'
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
        return f'{self.username}({self.real_name or "未设置"})'

    def __repr__(self):
        return f'<CustomUser: {self.id} {self.username}>'

    # ==================== 登录安全方法 ====================

    def increment_login_attempts(self):
        """增加登录失败次数"""
        self.login_attempts = models.F('login_attempts') + 1
        self.last_failed_login = timezone.now()
        self.save(update_fields=['login_attempts', 'last_failed_login'])
        # 🔧 刷新实例以获取最新值
        self.refresh_from_db(fields=['login_attempts'])

    def reset_login_attempts(self):
        """重置登录失败次数"""
        if self.login_attempts > 0:
            self.login_attempts = 0
            self.last_failed_login = None
            self.save(update_fields=['login_attempts', 'last_failed_login'])

    def is_locked_out(self, max_attempts=None, lockout_minutes=None):
        """
        检查账户是否被锁定

        Args:
            max_attempts: 最大尝试次数（默认从配置读取）
            lockout_minutes: 锁定分钟数（默认从配置读取）

        Returns:
            bool: 是否被锁定
        """
        # ✅ 在方法内部按需导入（Django 模型加载完成后才执行）
        from utils.utils import SystemConfigManager
        # 从配置读取策略
        if max_attempts is None:
            max_attempts = SystemConfigManager.get_config('security.login_max_attempts', 5)
        if lockout_minutes is None:
            lockout_minutes = SystemConfigManager.get_config('security.login_lockout_minutes', 15)

        if self.login_attempts >= max_attempts and self.last_failed_login:
            lockout_end = self.last_failed_login + timezone.timedelta(minutes=lockout_minutes)
            return timezone.now() < lockout_end
        return False

    def get_lockout_remaining_seconds(self, lockout_minutes=None):
        """获取账户锁定剩余秒数"""
        # ✅ 在方法内部按需导入（Django 模型加载完成后才执行）
        from utils.utils import SystemConfigManager
        if lockout_minutes is None:
            lockout_minutes = SystemConfigManager.get_config('security.login_lockout_minutes', 15)

        if self.last_failed_login and self.is_locked_out(lockout_minutes=lockout_minutes):
            lockout_end = self.last_failed_login + timezone.timedelta(minutes=lockout_minutes)
            return int((lockout_end - timezone.now()).total_seconds())
        return 0

    # ==================== 密码重置方法 ====================

    def generate_password_reset_token(self, expires_hours=1, expires_minutes=20):
        """
        生成密码重置令牌

        Args:
            expires_hours: 令牌有效期（小时）

        Returns:
            str: 重置令牌
        """
        # 生成64位安全随机令牌（32字节 = 64字符base64url）
        self.password_reset_token = secrets.token_urlsafe(32)
        self.password_reset_token_expires = timezone.now() + timezone.timedelta(hours=expires_hours)
        # self.password_reset_token_expires = timezone.now() + timezone.timedelta(minutes=expires_minutes)

        self.save(update_fields=['password_reset_token', 'password_reset_token_expires'])
        return self.password_reset_token

    def verify_password_reset_token(self, token):
        """
        验证密码重置令牌

        Args:
            token: 待验证的令牌

        Returns:
            bool: 是否有效
        """
        if not self.password_reset_token or not self.password_reset_token_expires:
            return False

        # 🔧 使用恒定时间比较防止时序攻击
        is_valid = secrets.compare_digest(self.password_reset_token, token)
        is_not_expired = timezone.now() < self.password_reset_token_expires

        return is_valid and is_not_expired

    def clear_password_reset_token(self):
        """清除重置令牌（一次性使用）"""
        if self.password_reset_token:
            self.password_reset_token = None
            self.password_reset_token_expires = None
            self.save(update_fields=['password_reset_token', 'password_reset_token_expires'])

    # ==================== 密码管理方法 ====================

    def set_password(self, raw_password):
        """
        重写 set_password：自动记录修改时间、清理重置令牌、重置登录失败计数
        ⚠️ 注意：此处不调用 self.save()，遵循 Django 规范（由调用方统一 save）
        """
        super().set_password(raw_password)  # 完成密码哈希赋值
        self.last_password_change = timezone.now()
        self.clear_password_reset_token()   # 一次性令牌立即失效
        self.reset_login_attempts()         # 重置登录失败计数

    def check_password(self, raw_password):
        """重写 check_password 以记录成功登录"""
        result = super().check_password(raw_password)
        if result:
            # 密码正确时重置失败计数
            self.reset_login_attempts()
        return result



    # ==================== 在线状态方法 ====================

    def update_online_status(self, is_online=True):
        """更新在线状态（原子操作）"""
        update_fields = ['is_online']
        self.is_online = is_online

        if not is_online:
            self.last_seen = timezone.now()
            update_fields.append('last_seen')

        # 🔧 使用 update() 避免触发 save() 信号循环
        CustomUser.objects.filter(pk=self.pk).update(**{
            field: getattr(self, field) for field in update_fields
        })
        # 刷新本地实例
        for field in update_fields:
            setattr(self, field, getattr(self, field))

    # ==================== 权限检查方法 ====================

    def can_edit_department_position(self, editor_user):
        """检查是否可以编辑部门和职位"""
        return editor_user.user_type in ['super_admin', 'admin']

    def is_super_admin(self):
        """是否为超级管理员"""
        return self.user_type == 'super_admin'

    def is_admin_or_higher(self):
        """是否为管理员或更高权限"""
        return self.user_type in ['super_admin', 'admin']

    def can_manage_users(self):
        """是否可以管理用户"""
        return self.is_admin_or_higher()


    # ==================== 多租户方法 ====================

    def get_tenants(self):
        """获取用户所属的所有企业"""
        return Tenant.objects.filter(
            memberships__user=self,
            memberships__is_active=True
        )

    def get_active_tenant(self):
        """获取当前激活的企业"""
        if self.active_tenant:
            return self.active_tenant
        default_membership = self.tenant_memberships.filter(
            is_active=True, is_default=True
        ).first()
        if default_membership:
            return default_membership.tenant
        first_membership = self.tenant_memberships.filter(is_active=True).first()
        return first_membership.tenant if first_membership else None

    def get_tenant_role(self, tenant=None):
        """获取在指定企业中的角色"""
        tenant = tenant or self.get_active_tenant()
        if not tenant:
            return None
        membership = self.tenant_memberships.filter(tenant=tenant).first()
        return membership.role if membership else None

    def is_tenant_admin(self, tenant=None):
        """检查是否是企业管理员"""
        role = self.get_tenant_role(tenant)
        return role in ['owner', 'admin']

    def is_tenant_owner(self, tenant=None):
        """检查是否是企业所有者"""
        return self.get_tenant_role(tenant) == 'owner'

    def get_primary_department(self, tenant=None):
        """获取在指定企业中的主部门"""
        tenant = tenant or self.get_active_tenant()
        try:
            from org.models import UserDepartment
            primary_rel = UserDepartment.objects.filter(
                user=self,
                is_primary=True,
                department__tenant=tenant
            ).first()
            if primary_rel:
                return primary_rel.department
        except Exception:
            pass
        return self.department

    def get_all_departments(self, tenant=None):
        """获取在指定企业中的所有部门"""
        tenant = tenant or self.get_active_tenant()
        try:
            from org.models import UserDepartment
            dept_ids = UserDepartment.objects.filter(
                user=self,
                department__tenant=tenant
            ).values_list('department_id', flat=True)
            return Department.objects.filter(id__in=dept_ids)
        except Exception:
            return Department.objects.none()

    def switch_tenant(self, tenant_id):
        """切换激活企业"""
        tenant = Tenant.objects.get(id=tenant_id)
        if not self.tenant_memberships.filter(tenant=tenant, is_active=True).exists():
            raise PermissionError('您不属于该企业')
        self.active_tenant = tenant
        self.save(update_fields=['active_tenant'])
        return tenant

    # ==================== 工具方法 ====================

    def get_full_name(self):
        """返回用户全名（部门 + 职位 + 真实姓名）"""
        parts = []
        if self.department:
            parts.append(self.department.name)
        if self.position:
            parts.append(self.position)
        if self.real_name:
            parts.append(self.real_name)
        return ' - '.join(parts) if parts else self.username

    def get_avatar_url(self):
        """获取头像URL（带CDN支持）"""
        if self.avatar and hasattr(self.avatar, 'url'):
            url = self.avatar.url
            # 🔧 支持CDN配置
            cdn_base = getattr(settings, 'CDN_BASE_URL', None)
            if cdn_base and url.startswith('/'):
                return f'{cdn_base.rstrip("/")}{url}'
            return url
        return '/static/images/default-avatar.png'

    def get_display_info(self):
        """获取用户显示信息（用于聊天列表等）"""
        return {
            'id': self.id,
            'username': self.username,
            'real_name': self.real_name,
            'avatar_url': self.get_avatar_url(),
            'department': self.department.name if self.department else None,
            'position': self.position,
            'is_online': self.is_online,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
            'user_type': self.user_type,
        }

    # ==================== 信号处理（类方法） ====================
    #
    # @classmethod
    # def on_user_logged_in(cls, sender, request, user, **kwargs):
    #     """用户登录信号处理"""
    #     if isinstance(user, CustomUser):
    #         user.update_online_status(True)
    #         # 🔧 记录登录日志（如果存在登录日志模型）
    #         # from accounts.models import LoginLog
    #         # LoginLog.objects.create(user=user, ip=request.META.get('REMOTE_ADDR'))
    #
    # @classmethod
    # def on_user_logged_out(cls, sender, request, user, **kwargs):
    #     """用户登出信号处理"""
    #     if isinstance(user, CustomUser):
    #         user.update_online_status(False)
    #
    # @classmethod
    # def on_password_changed(cls, sender, user, **kwargs):
    #     """密码修改信号处理"""
    #     if isinstance(user, CustomUser):
    #         user.last_password_change = timezone.now()
    #         user.clear_password_reset_token()
    #         user.save(update_fields=['last_password_change'])




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
            ip_address=get_request_ip(request),
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
            ip_address=get_request_ip(request),
            description=f"用户 {user.username} 登出系统"
        )


# 信号处理器：创建用户时确保头像字段有默认值
@receiver(post_save, sender=CustomUser)
def ensure_user_avatar(sender, instance, created, **kwargs):
    if created and not instance.avatar:
        instance.avatar = 'avatars/default-avatar.png'
        instance.save(update_fields=['avatar'])






class CoreModel(models.Model):
    """
    核心标准抽象模型模型,可直接继承使用
    增加审计字段, 覆盖字段时, 字段名称请勿修改, 必须统一审计字段名称
    """
    id = models.BigAutoField(primary_key=True, help_text="Id", verbose_name="Id")
    description = models.CharField(max_length=255, verbose_name="描述", null=True, blank=True, help_text="描述")
    creator = models.ForeignKey(to=CustomUser, related_query_name='creator_query', null=True,
                                verbose_name='创建人', help_text="创建人", on_delete=models.SET_NULL,
                                db_constraint=False, db_index=True)
    modifier = models.CharField(max_length=255, null=True, blank=True, help_text="修改人", verbose_name="修改人")
    dept_belong_id = models.CharField(max_length=255, help_text="数据归属部门", null=True, blank=True,
                                      verbose_name="数据归属部门")
    update_time = models.DateTimeField(auto_now=True, null=True, blank=True, help_text="修改时间",
                                           verbose_name="修改时间", db_index=True)
    create_time = models.DateTimeField(auto_now_add=True, null=True, blank=True, help_text="创建时间",
                                           verbose_name="创建时间", db_index=True)

    class Meta:
        abstract = True
        verbose_name = '核心模型'
        verbose_name_plural = verbose_name




class LoginLog(CoreModel):
    LOGIN_TYPE_CHOICES = ((1, "普通登录"), (2, "扫码登录"), (3, "邮箱登录"))

    id = models.BigAutoField(primary_key=True, help_text="Id", verbose_name="Id")
    description = models.CharField(max_length=255, verbose_name="描述", null=True, blank=True, help_text="描述")
    creator = models.ForeignKey(to=CustomUser, related_query_name='creator_query', null=True,
                                verbose_name='创建人', help_text="创建人", on_delete=models.SET_NULL,
                                db_constraint=False, db_index=True)



    username = models.CharField(max_length=32, verbose_name="登录用户名", null=True, blank=True, help_text="登录用户名", db_index=True)
    ip = models.CharField(max_length=50, verbose_name="登录ip", null=True, blank=True, help_text="登录ip", db_index=True)
    agent = models.TextField(verbose_name="agent信息", null=True, blank=True, help_text="agent信息")
    browser = models.CharField(max_length=200, verbose_name="浏览器名", null=True, blank=True, help_text="浏览器名", db_index=True)
    os = models.CharField(max_length=200, verbose_name="操作系统", null=True, blank=True, help_text="操作系统", db_index=True)
    continent = models.CharField(max_length=50, verbose_name="州", null=True, blank=True, help_text="洲", db_index=True)
    country = models.CharField(max_length=50, verbose_name="国家", null=True, blank=True, help_text="国家", db_index=True)
    province = models.CharField(max_length=50, verbose_name="省份", null=True, blank=True, help_text="省份", db_index=True)
    city = models.CharField(max_length=50, verbose_name="城市", null=True, blank=True, help_text="城市", db_index=True)
    district = models.CharField(max_length=50, verbose_name="县区", null=True, blank=True, help_text="县区", db_index=True)
    isp = models.CharField(max_length=50, verbose_name="运营商", null=True, blank=True, help_text="运营商", db_index=True)
    area_code = models.CharField(max_length=50, verbose_name="区域代码", null=True, blank=True, help_text="区域代码", db_index=True)
    country_english = models.CharField(max_length=50, verbose_name="英文全称", null=True, blank=True,
                                       help_text="英文全称", db_index=True)
    country_code = models.CharField(max_length=50, verbose_name="简称", null=True, blank=True, help_text="简称", db_index=True)
    longitude = models.CharField(max_length=50, verbose_name="经度", null=True, blank=True, help_text="经度")
    latitude = models.CharField(max_length=50, verbose_name="纬度", null=True, blank=True, help_text="纬度")
    login_type = models.IntegerField(default=1, choices=LOGIN_TYPE_CHOICES, verbose_name="登录类型",
                                     help_text="登录类型", db_index=True)

    class Meta:
        db_table = "login_log"
        verbose_name = "登录日志"
        verbose_name_plural = verbose_name
        ordering = ("-create_time",)
        indexes = [
            models.Index(fields=['create_time']),
            models.Index(fields=['creator', 'create_time']),
            models.Index(fields=['username', 'create_time']),
            models.Index(fields=['ip', 'create_time']),
            models.Index(fields=['os', 'create_time']),
            models.Index(fields=['country', 'province', 'city']),
            models.Index(fields=['login_type', 'create_time']),
            # 复合索引优化常见查询
            models.Index(fields=['creator', 'create_time', 'username']),
            models.Index(fields=['ip', 'create_time', 'username']),
        ]


class OperationLog(CoreModel):
    request_modular = models.CharField(max_length=64, verbose_name="请求模块", null=True, blank=True,
                                       help_text="请求模块", db_index=True)
    request_path = models.CharField(max_length=400, verbose_name="请求地址", null=True, blank=True,
                                    help_text="请求地址")
    request_body = models.TextField(verbose_name="请求参数", null=True, blank=True, help_text="请求参数")
    request_method = models.CharField(max_length=8, verbose_name="请求方式", null=True, blank=True,
                                      help_text="请求方式", db_index=True)
    request_msg = models.TextField(verbose_name="操作说明", null=True, blank=True, help_text="操作说明")
    request_ip = models.CharField(max_length=50, verbose_name="请求ip地址", null=True, blank=True,
                                  help_text="请求ip地址", db_index=True)
    request_browser = models.CharField(max_length=64, verbose_name="请求浏览器", null=True, blank=True,
                                       help_text="请求浏览器", db_index=True)
    response_code = models.CharField(max_length=64, verbose_name="响应状态码", null=True, blank=True,
                                     help_text="响应状态码", db_index=True)
    request_os = models.CharField(max_length=64, verbose_name="操作系统", null=True, blank=True, help_text="操作系统", db_index=True)
    json_result = models.TextField(verbose_name="返回信息", null=True, blank=True, help_text="返回信息")
    status = models.BooleanField(default=False, verbose_name="响应状态", help_text="响应状态", db_index=True)

    class Meta:
        db_table = "operation_log"
        verbose_name = "操作日志"
        verbose_name_plural = verbose_name
        ordering = ("-create_time",)
        indexes = [
            models.Index(fields=['create_time']),
            models.Index(fields=['creator', 'create_time']),
            models.Index(fields=['status', 'create_time']),
            models.Index(fields=['request_modular', 'create_time']),
            models.Index(fields=['creator', 'status']),
            # 复合索引优化常见查询
            models.Index(fields=['creator', 'create_time', 'status']),
        ]



class ConsultationRequest(models.Model):
    DEMAND_TYPE_CHOICES = [
        ('private', '私有化部署'),
        ('saas', 'SaaS 云端订阅'),
        ('custom', '深度定制开发'),
        ('poc', '申请免费 POC 测试环境'),
    ]

    STATUS_CHOICES = [
        ('pending', '待处理'),
        ('contacted', '已联系'),
        ('closed', '已关闭'),
    ]

    company_name = models.CharField(max_length=200, verbose_name="公司名称")
    contact_name = models.CharField(max_length=100, verbose_name="联系人姓名")
    email = models.EmailField(verbose_name="企业邮箱")
    phone = models.CharField(max_length=20, verbose_name="联系电话")
    demand_type = models.CharField(max_length=20, choices=DEMAND_TYPE_CHOICES, default='private',
                                   verbose_name="期望部署方式")
    message = models.TextField(blank=True, null=True, verbose_name="需求描述")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name="处理状态")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="提交时间")
    handled_at = models.DateTimeField(null=True, blank=True, verbose_name="处理时间")
    admin_notes = models.TextField(blank=True, null=True, verbose_name="管理员备注")

    class Meta:
        verbose_name = "咨询请求"
        verbose_name_plural = "咨询请求"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.company_name} - {self.contact_name} ({self.get_demand_type_display()})"


    def get_demand_type_display(self):
        return dict(self.DEMAND_TYPE_CHOICES).get(self.demand_type, '未知')