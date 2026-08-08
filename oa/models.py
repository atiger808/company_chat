from django.db import models
from django.conf import settings
from accounts.models import Department


class AttendanceRecord(models.Model):
    """打卡记录"""

    CLOCK_TYPE_CHOICES = [
        ('clock_in', '上班打卡'),
        ('clock_out', '下班打卡'),
    ]
    STATUS_CHOICES = [
        ('normal', '正常'),
        ('late', '迟到'),
        ('early_leave', '早退'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='attendance_records',
        verbose_name='用户'
    )
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                                null=True, blank=True, related_name='attendance_records',
                                verbose_name='所属企业')
    clock_type = models.CharField(
        max_length=20,
        choices=CLOCK_TYPE_CHOICES,
        verbose_name='打卡类型'
    )
    clock_time = models.DateTimeField(auto_now_add=True, verbose_name='打卡时间')
    date = models.DateField(verbose_name='打卡日期', db_index=True)
    latitude = models.FloatField(null=True, blank=True, verbose_name='纬度')
    longitude = models.FloatField(null=True, blank=True, verbose_name='经度')
    location = models.CharField(max_length=255, blank=True, default='', verbose_name='打卡位置')
    # 反向地理编码结果
    reverse_geocoding = models.JSONField(null=True, blank=True, verbose_name='反地理编码结果')
    device = models.CharField(max_length=255, blank=True, default='', verbose_name='打卡设备')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='normal',
        verbose_name='打卡状态'
    )
    remark = models.TextField(blank=True, default='', verbose_name='备注')
    # BD09坐标（百度地图）
    bd09_latitude = models.FloatField(null=True, blank=True, verbose_name='BD09纬度')
    bd09_longitude = models.FloatField(null=True, blank=True, verbose_name='BD09经度')
    ip_address = models.CharField(max_length=50, blank=True, default='', verbose_name='IP地址')
    user_agent = models.TextField(blank=True, default='', verbose_name='User-Agent')

    class Meta:
        ordering = ['-clock_time']
        verbose_name = '打卡记录'
        verbose_name_plural = '打卡记录'
        indexes = [
            models.Index(fields=['user', 'date']),
            models.Index(fields=['date']),
        ]

    def __str__(self):
        return f'{self.user} {self.get_clock_type_display()} {self.date}'


class ApprovalType(models.Model):
    """审批类型（内置 + 企业自定义），自定义类型通过 form_schema 定义动态表单字段"""
    FIELD_TYPES = [
        ('text', '单行文本'),
        ('textarea', '多行文本'),
        ('number', '数字'),
        ('date', '日期'),
        ('datetime', '日期时间'),
        ('amount', '金额'),
        ('select', '下拉选择'),
        ('radio', '单选'),
        ('checkbox', '多选'),
        ('attachment', '附件'),
        ('department', '部门选择'),
        ('user', '成员选择'),
    ]

    code = models.CharField(max_length=40, verbose_name='类型编码')
    name = models.CharField(max_length=50, verbose_name='类型名称')
    icon = models.CharField(max_length=50, default='fa-file-lines', verbose_name='图标')
    color = models.CharField(max_length=20, default='#409EFF', verbose_name='颜色')
    description = models.TextField(blank=True, default='', verbose_name='说明')
    enabled = models.BooleanField(default=True, verbose_name='是否启用')
    is_builtin = models.BooleanField(default=False, verbose_name='是否内置')
    tenant = models.ForeignKey(
        'accounts.Tenant',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='approval_types',
        verbose_name='所属企业（null=全局内置）'
    )
    form_schema = models.JSONField(default=list, blank=True, verbose_name='表单字段定义')
    sort_order = models.IntegerField(default=0, verbose_name='排序')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        unique_together = [('tenant', 'code')]
        ordering = ['sort_order', 'id']
        verbose_name = '审批类型'
        verbose_name_plural = '审批类型'

    def __str__(self):
        return self.name


class ApprovalRequest(models.Model):
    """审批请求"""

    # 内置审批类型编码（ensure_builtin_types 会自动播种到 ApprovalType）
    BUILTIN_TYPE_CHOICES = [
        ('leave', '请假'),
        ('overtime', '加班'),
        ('expense', '报销'),
        ('trip', '出差'),
        ('purchase', '采购'),
        ('recruit', '招聘需求'),
        ('other', '其他'),
    ]
    STATUS_CHOICES = [
        ('draft', '草稿'),
        ('pending', '待审批'),
        ('approved', '已通过'),
        ('rejected', '已驳回'),
        ('deferred', '暂缓'),
        ('processing', '办理中'),
        ('cancelled', '已撤回'),
    ]
    EXPENSE_TYPE_CHOICES = [
        ('travel', '差旅费'),
        ('office', '办公用品'),
        ('meals', '餐饮费'),
        ('transport', '交通费'),
        ('communication', '通讯费'),
        ('equipment', '设备采购'),
        ('training', '培训费'),
        ('other_expense', '其他'),
    ]

    applicant = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='approval_requests',
        verbose_name='申请人'
    )
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                                null=True, blank=True, related_name='approval_requests',
                                verbose_name='所属企业')
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approval_requests',
        verbose_name='所属部门'
    )
    approval_type = models.CharField(
        max_length=40,
        verbose_name='审批类型',
        help_text='对应 ApprovalType.code（内置 + 企业自定义）'
    )
    # 自定义审批类型动态表单数据（key 与 ApprovalType.form_schema 字段 key 对应）
    form_data = models.JSONField(default=dict, blank=True, verbose_name='动态表单数据')
    title = models.CharField(max_length=200, verbose_name='审批标题')
    content = models.TextField(blank=True, default='', verbose_name='审批内容')
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending',
        db_index=True,
        verbose_name='审批状态'
    )
    start_date = models.DateField(null=True, blank=True, verbose_name='开始日期')
    end_date = models.DateField(null=True, blank=True, verbose_name='结束日期')
    duration = models.FloatField(null=True, blank=True, verbose_name='天数')
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        null=True, blank=True,
        verbose_name='金额'
    )
    # 报销相关字段
    expense_type = models.CharField(
        max_length=30,
        choices=EXPENSE_TYPE_CHOICES,
        null=True, blank=True,
        verbose_name='费用类型'
    )
    expense_date = models.DateField(null=True, blank=True, verbose_name='费用发生日期')
    # 招聘需求结构化数据
    recruit_data = models.JSONField(null=True, blank=True, default=dict, verbose_name='招聘需求数据')
    # 附件
    attachments = models.JSONField(null=True, blank=True, default=list, verbose_name='附件')
    sign_type = models.CharField(
        max_length=20,
        choices=[('countersign', '会签'), ('orsign', '或签')],
        default='orsign',
        verbose_name='审批方式'
    )
    approval_mode = models.CharField(
        max_length=20,
        choices=[('sequential', '顺序审批'), ('parallel', '并行审批')],
        default='parallel',
        verbose_name='审批模式'
    )
    current_node_order = models.IntegerField(default=0, verbose_name='当前节点序号')
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approval_tasks',
        verbose_name='审批人'
    )
    approver_comment = models.TextField(blank=True, default='', verbose_name='审批意见')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        ordering = ['-updated_at']
        verbose_name = '审批请求'
        verbose_name_plural = '审批请求'

    def __str__(self):
        return f'{self.applicant} {self.approval_type} {self.title}'


class ApprovalLog(models.Model):
    """审批操作日志"""

    ACTION_CHOICES = [
        ('approve', '通过'),
        ('reject', '驳回'),
        ('deferred', '暂缓'),
        ('processing', '正在办理'),
        ('resubmit', '重新提交'),
        ('cancel', '撤回'),
    ]

    request = models.ForeignKey(
        ApprovalRequest,
        on_delete=models.CASCADE,
        related_name='logs',
        verbose_name='审批请求'
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='approval_logs',
        verbose_name='操作人'
    )
    action = models.CharField(
        max_length=20,
        choices=ACTION_CHOICES,
        verbose_name='操作'
    )
    comment = models.TextField(blank=True, default='', verbose_name='操作意见')
    attachments = models.JSONField(null=True, blank=True, default=list, verbose_name='附件')
    signature = models.TextField(blank=True, default='', verbose_name='手写签名',
                                 help_text='审批人手写签名的base64图片数据')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='操作时间')

    class Meta:
        ordering = ['-created_at']
        verbose_name = '审批日志'
        verbose_name_plural = '审批日志'

    def __str__(self):
        return f'{self.operator} {self.get_action_display()} {self.request}'


class WorkNotification(models.Model):
    """工作通知"""

    NOTIFICATION_TYPES = [
        ('approval', '审批通知'),
        ('attendance', '考勤通知'),
        ('task', '任务通知'),
        ('collab', '协作通知'),
        ('system', '系统通知'),
    ]

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
        verbose_name='接收人',
        db_index=True,
    )
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                                null=True, blank=True, related_name='notifications',
                                verbose_name='所属企业')
    notification_type = models.CharField(
        max_length=20,
        choices=NOTIFICATION_TYPES,
        verbose_name='通知类型',
    )
    title = models.CharField(max_length=200, verbose_name='通知标题')
    content = models.TextField(blank=True, default='', verbose_name='通知内容')
    related_url = models.CharField(max_length=500, blank=True, default='', verbose_name='相关链接')
    is_read = models.BooleanField(default=False, verbose_name='是否已读', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    extra_data = models.JSONField(null=True, blank=True, verbose_name='扩展数据')

    class Meta:
        ordering = ['-created_at']
        verbose_name = '工作通知'
        verbose_name_plural = '工作通知'
        indexes = [
            models.Index(fields=['recipient', 'is_read']),
            models.Index(fields=['recipient', '-created_at']),
        ]

    def __str__(self):
        return f'{self.recipient} {self.title}'


class ApprovalCarbonCopy(models.Model):
    """审批抄送（支持抄送用户和部门）"""
    CC_TYPE_CHOICES = [
        ('user', '用户'),
        ('department', '部门'),
    ]

    request = models.ForeignKey(
        ApprovalRequest,
        on_delete=models.CASCADE,
        related_name='carbon_copies',
        verbose_name='审批请求'
    )
    cc_type = models.CharField(
        max_length=20,
        choices=CC_TYPE_CHOICES,
        default='user',
        verbose_name='抄送类型'
    )
    cc_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='approval_ccs',
        verbose_name='抄送人'
    )
    cc_department = models.ForeignKey(
        Department,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='approval_ccs',
        verbose_name='抄送部门'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '审批抄送'
        verbose_name_plural = '审批抄送'

    def __str__(self):
        if self.cc_type == 'department' and self.cc_department:
            return f'部门:{self.cc_department.name} 抄送 {self.request}'
        if self.cc_user:
            return f'{self.cc_user} 抄送 {self.request}'
        return f'抄送 {self.request}'


class ApprovalDeptConfig(models.Model):
    """审批类型配置（超级管理员为每种审批类型设置最终审批部门、抄送部门、抄送人、审批人等）"""
    tenant = models.ForeignKey(
        'accounts.Tenant',
        on_delete=models.CASCADE,
        related_name='approval_dept_configs',
        verbose_name='所属企业'
    )
    approval_type = models.CharField(
        max_length=40,
        verbose_name='审批类型',
        help_text='对应 ApprovalType.code（内置 + 企业自定义）'
    )
    # 默认审批方式
    default_sign_type = models.CharField(
        max_length=20,
        choices=[('countersign', '会签'), ('orsign', '或签')],
        default='countersign',
        verbose_name='默认审批方式'
    )
    # 默认审批模式
    default_approval_mode = models.CharField(
        max_length=20,
        choices=[('sequential', '顺序审批'), ('parallel', '并行审批')],
        default='sequential',
        verbose_name='默认审批模式'
    )
    # 子公司专属配置（null=集团默认配置，非空=该子公司的专属配置）
    sub_tenant = models.ForeignKey(
        'accounts.Tenant',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='sub_approval_dept_configs',
        verbose_name='子公司'
    )
    # 最终审批部门
    department = models.ForeignKey(
        'accounts.Department',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        verbose_name='最终审批部门'
    )
    # 默认抄送部门列表
    cc_departments = models.JSONField(default=list, blank=True, verbose_name='默认抄送部门ID列表')
    # 默认抄送人列表
    cc_users = models.JSONField(default=list, blank=True, verbose_name='默认抄送人ID列表')
    # 默认审批人列表（如设置，则覆盖自动审批链）
    approver_users = models.JSONField(default=list, blank=True, verbose_name='默认审批人ID列表')
    # 阈值审批配置：超过阈值后增加一个最终审批部门
    THRESHOLD_FIELD_CHOICES = [
        ('duration', '天数/时长'),
        ('amount', '金额'),
        ('headcount', '招聘人数'),
    ]
    threshold_enabled = models.BooleanField(default=False, verbose_name='启用阈值审批')
    threshold_field = models.CharField(max_length=40, blank=True, default='',
        verbose_name='阈值字段',
        help_text='内置类型为 duration/amount/headcount；自定义类型为 form_schema 中数字字段的 key')
    threshold_value = models.FloatField(null=True, blank=True, verbose_name='阈值')
    threshold_department = models.ForeignKey(
        'accounts.Department',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='threshold_approval_configs',
        verbose_name='阈值超额后最终审批部门'
    )
    # 最终审批人（可选，追加到自动审批链最后一级；允许置空）
    final_approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approval_final_approver_configs',
        verbose_name='最终审批人',
        help_text='在自动审批链基础上追加一个最终审批人'
    )
    # 是否要求审批人手写签名
    require_signature = models.BooleanField(default=False, verbose_name='开启手写签名',
                                           help_text='开启后审批人点击通过时需手写签名')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        unique_together = ('tenant', 'approval_type', 'sub_tenant')
        verbose_name = '审批类型配置'
        verbose_name_plural = '审批类型配置'
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.approval_type} 配置'


class ApprovalNode(models.Model):
    """审批节点（一个审批请求可以有多个审批节点）"""
    NODE_TYPE_CHOICES = [
        ('user', '指定用户'),
        ('department', '指定部门'),
    ]

    request = models.ForeignKey(
        ApprovalRequest,
        on_delete=models.CASCADE,
        related_name='approval_nodes',
        verbose_name='审批请求'
    )
    node_type = models.CharField(
        max_length=20,
        choices=NODE_TYPE_CHOICES,
        verbose_name='节点类型'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approval_node_users',
        verbose_name='审批用户'
    )
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approval_node_departments',
        verbose_name='审批部门'
    )
    order = models.IntegerField(default=0, verbose_name='排序')

    is_final_approver = models.BooleanField(
        default=False,
        verbose_name='是否最终审批人',
        help_text='由审批类型配置的最终审批人生成的节点'
    )
    final_approver_source = models.CharField(
        max_length=20, blank=True, default='',
        verbose_name='最终审批人配置来源',
        help_text="'sub'=子公司自定义配置，'default'=集团/企业默认配置"
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        ordering = ['-order', '-id']
        verbose_name = '审批节点'
        verbose_name_plural = '审批节点'

    def __str__(self):
        if self.node_type == 'user' and self.user:
            return f'用户:{self.user.username}'
        if self.node_type == 'department' and self.department:
            return f'部门:{self.department.name}'
        return f'节点:{self.id}'


class ApprovalAssignee(models.Model):
    """审批人（每个审批节点下具体的审批人及审批状态）"""
    STATUS_CHOICES = [
        ('pending', '待审批'),
        ('approved', '已通过'),
        ('rejected', '已驳回'),
        ('deferred', '暂缓'),
        ('processing', '办理中'),
    ]

    node = models.ForeignKey(
        ApprovalNode,
        on_delete=models.CASCADE,
        related_name='assignees',
        verbose_name='审批节点'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='approval_assignees',
        verbose_name='审批人'
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending',
        verbose_name='审批状态'
    )
    comment = models.TextField(blank=True, default='', verbose_name='审批意见')
    operated_at = models.DateTimeField(null=True, blank=True, verbose_name='操作时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        ordering = ['-id']
        verbose_name = '审批人'
        verbose_name_plural = '审批人'

    def __str__(self):
        return f'{self.user} - {self.get_status_display()}'


class AttendanceConfig(models.Model):
    """考勤配置（支持多层级：集团默认 → 子公司 → 部门）"""
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               related_name='attendance_configs', verbose_name='所属企业')
    sub_tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                                   null=True, blank=True,
                                   related_name='sub_attendance_configs', verbose_name='子公司')
    department = models.ForeignKey('accounts.Department', on_delete=models.CASCADE,
                                   null=True, blank=True,
                                   related_name='attendance_configs', verbose_name='部门')
    clock_in_enabled = models.BooleanField(default=True, verbose_name='启用上班打卡')
    clock_in_time = models.TimeField(null=True, blank=True, verbose_name='上班打卡截止时间')
    clock_out_enabled = models.BooleanField(default=True, verbose_name='启用下班打卡')
    clock_out_time = models.TimeField(null=True, blank=True, verbose_name='下班打卡开始时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        unique_together = ('tenant', 'sub_tenant', 'department')
        verbose_name = '考勤配置'
        verbose_name_plural = '考勤配置'

    def __str__(self):
        parts = [self.tenant.short_name or self.tenant.name]
        if self.sub_tenant:
            parts.append(f'子公司:{self.sub_tenant.short_name or self.sub_tenant.name}')
        if self.department:
            parts.append(f'部门:{self.department.name}')
        return ' - '.join(parts)
