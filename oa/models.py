from datetime import time
from decimal import Decimal
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
    # 补卡时间：迟到/早退补卡修正为正常、或漏卡补录时记录（用于审计）
    makeup_at = models.DateTimeField(null=True, blank=True, verbose_name='补卡时间')
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
        ('expense_type', '费用类型选择'),
        ('struct_table', '结构化数据明细'),
        ('payment_method', '收款方式'),
        ('link_requisition', '关联需求单'),
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
        ('office', '办公费'),
        ('meals', '业务招待费'),
        ('transport', '交通费'),
        ('communication', '通讯费'),
        ('equipment', '设备采购'),
        ('training', '培训费'),
        ('welfare', '员工福利费'),
        ('professional_service', '专业服务费'),
        ('advertising', '广告宣传费'),
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
    # 关联审批（自关联，用于串联采购→报销等审批链路）
    related_approvals = models.ManyToManyField(
        'self', blank=True, symmetrical=False,
        related_name='linked_by', verbose_name='关联审批')
    # 内置类型结构化数据
    purchase_items = models.JSONField(default=list, blank=True, verbose_name='采购物项')
    expense_items = models.JSONField(default=list, blank=True, verbose_name='报销项目')
    leave_type = models.CharField(max_length=30, blank=True, default='', verbose_name='请假类型')
    trip_data = models.JSONField(default=dict, blank=True, verbose_name='出差信息')
    # 付款方式：{type:'default'|'custom', payee_name, bank_card, alipay_account, wechat_account, alipay_qr, wechat_qr}
    # default=使用用户默认收款账号（CustomUser），提交时快照；custom=用户自定义收款方式
    payment_method = models.JSONField(null=True, blank=True, default=dict, verbose_name='付款方式')
    # 票据回传：最终审批通过后，申请人在时限内回传的付款凭证/票据
    receipts = models.JSONField(default=list, blank=True, verbose_name='回传票据')
    receipt_deadline = models.DateTimeField(null=True, blank=True, verbose_name='回传截止时间')
    # 驳回后重新提交的起始节点（被驳回时记录，重新提交/撤回时清空；兼容驳回→存草稿→再提交路径）
    resume_node_order = models.IntegerField(null=True, blank=True, verbose_name='驳回后重新提交的起始节点')
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
        ('receipt_return', '票据回传'),
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
        ('subsidy', '补贴通知'),
        ('subsidy_apply', '补贴申领待核验'),
        ('subsidy_result', '补贴申领核验结果'),
        ('subsidy_withdraw', '补贴提现待支付'),
        ('subsidy_withdraw_result', '补贴提现结果'),
        ('daily', '每日通知'),
        ('work_summary', '每日工作总结'),
        ('hr', '人事通知'),
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
        max_length=40,
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
    # 票据回传时限（小时）：最终审批通过后申请人在该时限内回传付款凭证/票据；0 表示不允许回传
    receipt_return_hours = models.IntegerField(default=24, verbose_name='票据回传时限(小时)',
                                              help_text='最终审批通过后申请人可在该时限内回传凭证；0 表示不允许回传')
    # 票据回传开关：关闭时发起人与最后审批人均不可使用票据回传，审批人通过时审批弹窗不显示"通知发起人回传票据"
    enable_receipt_return = models.BooleanField(default=False, verbose_name='开启票据回传',
                                               help_text='开启后发起人与最后审批人可使用票据回传，审批人通过时可通知发起人回传票据')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        unique_together = ('tenant', 'approval_type', 'sub_tenant')
        verbose_name = '审批类型配置'
        verbose_name_plural = '审批类型配置'
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.approval_type} 配置'


class CustomPaymentMethod(models.Model):
    """用户自定义收款方式库（记忆功能：保存用户填过的自定义收款方式，便于下次复用）"""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='custom_payment_methods', verbose_name='用户')
    payee_name = models.CharField(max_length=50, blank=True, default='', verbose_name='收款人姓名')
    bank_card = models.CharField(max_length=40, blank=True, default='', verbose_name='银行卡号')
    bank_name = models.CharField(max_length=200, blank=True, default='', verbose_name='开户银行')
    bank_address = models.CharField(max_length=300, blank=True, default='', verbose_name='开户银行地址')
    alipay_account = models.CharField(max_length=100, blank=True, default='', verbose_name='支付宝账号')
    wechat_account = models.CharField(max_length=100, blank=True, default='', verbose_name='微信账号')
    alipay_qr = models.CharField(max_length=500, blank=True, default='', verbose_name='支付宝收款码')
    wechat_qr = models.CharField(max_length=500, blank=True, default='', verbose_name='微信收款码')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        ordering = ['-updated_at']
        verbose_name = '自定义收款方式'
        verbose_name_plural = '自定义收款方式'

    def __str__(self):
        return f'{self.user} 自定义收款方式'


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
    # 每月补卡次数（0=禁用补卡）
    makeup_allowance = models.PositiveIntegerField(default=3, verbose_name='每月补卡次数(0=禁用补卡)')
    # 下班卡最多可重复打卡次数（防误打，以最后一次为准，至少为1）
    clock_out_limit = models.PositiveIntegerField(default=3, verbose_name='下班卡最多打卡次数(至少1)')
    # 班次类型：白班 / 夜班（夜班下班打卡在次日凌晨）
    SHIFT_TYPE_CHOICES = [
        ('day', '白班'),
        ('night', '夜班'),
    ]
    shift_type = models.CharField(max_length=10, choices=SHIFT_TYPE_CHOICES, default='day', verbose_name='班次类型')
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


class UserAttendanceConfig(models.Model):
    """个人考勤配置：针对个别成员的班次/打卡时间覆盖（如部门内个别成员单独上夜班）。
    解析优先级最高：个人配置 > 部门配置 > 子公司配置 > 企业默认 > 父级回溯。
    """
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                related_name='attendance_config', verbose_name='成员')
    shift_type = models.CharField(max_length=10, choices=AttendanceConfig.SHIFT_TYPE_CHOICES,
                                  default='day', verbose_name='班次类型')
    clock_in_enabled = models.BooleanField(default=True, verbose_name='启用上班打卡')
    clock_in_time = models.TimeField(null=True, blank=True, verbose_name='上班打卡截止时间')
    clock_out_enabled = models.BooleanField(default=True, verbose_name='启用下班打卡')
    clock_out_time = models.TimeField(null=True, blank=True, verbose_name='下班打卡开始时间')
    makeup_allowance = models.PositiveIntegerField(default=3, verbose_name='每月补卡次数(0=禁用补卡)')
    clock_out_limit = models.PositiveIntegerField(default=3, verbose_name='下班卡最多打卡次数(至少1)')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '个人考勤配置'
        verbose_name_plural = '个人考勤配置'

    def __str__(self):
        return f'{self.user} - {self.get_shift_type_display()}'


class SubsidyApplication(models.Model):
    """员工消费普惠补贴申领单"""
    INVOICE_TYPE_CHOICES = [
        ('special', '增值税专用发票'),
        ('ordinary', '增值税普通发票'),
    ]
    STATUS_CHOICES = [
        ('pending', '待核验'),
        ('approved', '已通过'),
        ('rejected', '已驳回'),
    ]

    applicant = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='subsidy_applications', verbose_name='申请人')
    tenant = models.ForeignKey(
        'accounts.Tenant', on_delete=models.CASCADE, null=True, blank=True,
        related_name='subsidy_applications', verbose_name='所属企业')
    application_no = models.CharField(max_length=40, unique=True, verbose_name='申领编号')
    invoice_number = models.CharField(max_length=64, unique=True, null=True, blank=True, verbose_name='发票号码')
    invoice_type = models.CharField(max_length=20, choices=INVOICE_TYPE_CHOICES, verbose_name='发票类型')
    invoice_code = models.CharField(max_length=100, blank=True, default='', verbose_name='票据代码')
    invoice_amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name='开票金额(含税)')
    invoice_date = models.DateField(null=True, blank=True, verbose_name='开票日期')
    tax_rate = models.CharField(max_length=20, blank=True, default='', verbose_name='税率')
    invoice_issuer = models.CharField(max_length=200, blank=True, default='', verbose_name='开票主体')
    invoice_file = models.CharField(max_length=500, blank=True, default='', verbose_name='票据文件')
    invoice_original_name = models.CharField(max_length=300, blank=True, default='', verbose_name='票据文件名')
    invoice_image = models.CharField(max_length=500, blank=True, default='', verbose_name='票据图片(PDF转PNG)')
    buyer_name = models.CharField(max_length=200, blank=True, default='', verbose_name='购买方名称')
    buyer_tax_no = models.CharField(max_length=40, blank=True, default='', verbose_name='购买方纳税人识别号')
    seller_name = models.CharField(max_length=200, blank=True, default='', verbose_name='销售方名称')
    seller_tax_no = models.CharField(max_length=40, blank=True, default='', verbose_name='销售方纳税人识别号')
    drawer = models.CharField(max_length=50, blank=True, default='', verbose_name='开票人')
    # 调用百度OCR识别返回的原始JSON（words_result 等），便于后续追溯/复用
    ocr_raw_data = models.JSONField(null=True, blank=True, default=dict, verbose_name='OCR识别原始返回')
    payment_voucher = models.CharField(max_length=500, blank=True, default='', verbose_name='支付凭证(付款截图)')
    payment_voucher_name = models.CharField(max_length=300, blank=True, default='', verbose_name='支付凭证文件名')
    payment_proof = models.CharField(max_length=500, blank=True, default='', verbose_name='支付截图(申请人)')
    payment_proof_name = models.CharField(max_length=300, blank=True, default='', verbose_name='支付截图文件名')
    subsidy_rate = models.DecimalField(max_digits=5, decimal_places=4, verbose_name='补贴比例')
    subsidy_amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name='补贴金额')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True, verbose_name='核验状态')
    reject_reason = models.TextField(blank=True, default='', verbose_name='驳回原因')
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='verified_subsidy_applications', verbose_name='核验人')
    verified_at = models.DateTimeField(null=True, blank=True, verbose_name='核验时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='申请时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        ordering = ['-updated_at']
        verbose_name = '普惠补贴申领'
        verbose_name_plural = '普惠补贴申领'

    def __str__(self):
        return f'{self.application_no} - {self.applicant}'


class SubsidyPayment(models.Model):
    """补贴发放记录（财务支付人员支付提现时生成，为实际资金支出流水）"""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='subsidy_payments', verbose_name='员工')
    tenant = models.ForeignKey(
        'accounts.Tenant', on_delete=models.CASCADE, null=True, blank=True,
        related_name='subsidy_payments', verbose_name='所属企业')
    application = models.ForeignKey(
        SubsidyApplication, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payments', verbose_name='对应申领')
    withdrawal = models.OneToOneField(
        'SubsidyWithdrawal', on_delete=models.CASCADE, null=True, blank=True,
        related_name='payment', verbose_name='对应提现')
    amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name='发放金额')
    note = models.CharField(max_length=300, blank=True, default='', verbose_name='备注')
    paid_at = models.DateTimeField(auto_now_add=True, verbose_name='发放时间')

    class Meta:
        ordering = ['-paid_at']
        verbose_name = '补贴发放记录'
        verbose_name_plural = '补贴发放记录'

    def __str__(self):
        return f'{self.user} - {self.amount}'


class SubsidyWithdrawal(models.Model):
    """提现申请（用户从钱包提现，待支付/已支付/已驳回）"""
    STATUS_CHOICES = [
        ('pending', '待支付'),
        ('paid', '已支付'),
        ('rejected', '已驳回'),
    ]
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='subsidy_withdrawals', verbose_name='提现人')
    tenant = models.ForeignKey(
        'accounts.Tenant', on_delete=models.CASCADE, null=True, blank=True,
        related_name='subsidy_withdrawals', verbose_name='所属企业')
    amount = models.DecimalField(max_digits=12, decimal_places=2, verbose_name='提现金额')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_index=True, verbose_name='状态')
    reject_reason = models.TextField(blank=True, default='', verbose_name='驳回原因')
    payment_voucher = models.CharField(max_length=500, blank=True, default='', verbose_name='支付凭证(付款截图)')
    payment_voucher_name = models.CharField(max_length=300, blank=True, default='', verbose_name='支付凭证文件名')
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='paid_subsidy_withdrawals', verbose_name='支付人员')
    paid_at = models.DateTimeField(null=True, blank=True, verbose_name='支付时间')
    requested_at = models.DateTimeField(auto_now_add=True, verbose_name='申请时间')
    note = models.CharField(max_length=300, blank=True, default='', verbose_name='备注')

    class Meta:
        ordering = ['-requested_at']
        verbose_name = '补贴提现申请'
        verbose_name_plural = '补贴提现申请'

    def __str__(self):
        return f'{self.user} - {self.amount} ({self.get_status_display()})'


class SubsidyWallet(models.Model):
    """用户钱包（每企业一个），核验通过入账、提现扣减/驳回返还"""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
        related_name='subsidy_wallets', verbose_name='用户')
    tenant = models.ForeignKey(
        'accounts.Tenant', on_delete=models.CASCADE, null=True, blank=True,
        related_name='subsidy_wallets', verbose_name='所属企业')
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), verbose_name='可用余额')
    total_in = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), verbose_name='累计入账')
    total_out = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'), verbose_name='累计提现')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        unique_together = ('user', 'tenant')
        verbose_name = '用户钱包'
        verbose_name_plural = '用户钱包'

    def __str__(self):
        return f'{self.user} - {self.balance}'


class SubsidyInvoiceVerifyRecord(models.Model):
    """发票验真记录（按发票文件 MD5 去重，防止重复验真）"""
    RESULT_CHOICES = [
        ('pass', '验真通过'),
        ('fail', '验真失败'),
        ('error', '验真异常'),
    ]
    application = models.ForeignKey(
        SubsidyApplication, on_delete=models.CASCADE,
        related_name='invoice_verify_records', verbose_name='对应申领')
    invoice_md5 = models.CharField(max_length=64, db_index=True, verbose_name='发票文件MD5')
    result = models.CharField(max_length=20, choices=RESULT_CHOICES, verbose_name='验真结果')
    message = models.TextField(blank=True, default='', verbose_name='验真信息')
    verify_data = models.JSONField(default=dict, blank=True, verbose_name='验真返回数据')
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='subsidy_invoice_verify_records', verbose_name='验真操作人')
    verified_at = models.DateTimeField(auto_now_add=True, verbose_name='验真时间')

    class Meta:
        ordering = ['-verified_at']
        verbose_name = '发票验真记录'
        verbose_name_plural = '发票验真记录'

    def __str__(self):
        return f'{self.invoice_md5[:10]} - {self.get_result_display()}'


class SubsidyConfig(models.Model):
    """普惠补贴配置（多层级：集团默认 → 子公司 → 部门）"""
    tenant = models.ForeignKey(
        'accounts.Tenant', on_delete=models.CASCADE,
        related_name='subsidy_configs', verbose_name='所属企业')
    sub_tenant = models.ForeignKey(
        'accounts.Tenant', on_delete=models.CASCADE, null=True, blank=True,
        related_name='sub_subsidy_configs', verbose_name='子公司')
    department = models.ForeignKey(
        'accounts.Department', on_delete=models.CASCADE, null=True, blank=True,
        related_name='subsidy_configs', verbose_name='部门')
    enabled = models.BooleanField(default=True, verbose_name='是否开启普惠补贴')
    special_rate = models.DecimalField(max_digits=6, decimal_places=5, default=Decimal('0.0100'), verbose_name='专用发票补贴比例')
    ordinary_rate = models.DecimalField(max_digits=6, decimal_places=5, default=Decimal('0.0050'), verbose_name='普通发票补贴比例')
    max_invoices = models.PositiveIntegerField(default=10, verbose_name='一次上传最大票据数量')
    show_invoice_header = models.BooleanField(default=False, verbose_name='是否显示发票抬头信息')
    tax_rate_threshold = models.DecimalField(max_digits=6, decimal_places=5, default=Decimal('0.0600'), verbose_name='税率阈值(识别税率≥此阈值判定为专用发票)')
    verifiers = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True,
        related_name='subsidy_verifier_configs', verbose_name='财务核验人员')
    min_withdraw_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal('0.00'),
        verbose_name='提现最小额度')
    payment_staff = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True,
        related_name='subsidy_payment_configs', verbose_name='财务支付人员')
    default_ocr_version = models.CharField(
        max_length=20, default='paddle', verbose_name='默认OCR识别版本',
        help_text='未配置时默认使用 PaddleOCR 本地识别')
    # 发票识别结果缓存时间（秒），默认 7 天（604800）
    ocr_cache_ttl = models.IntegerField(default=604800, verbose_name='发票识别缓存时间(秒)',
                                       help_text='发票OCR识别结果的缓存时长，默认 7 天（604800 秒）')
    invoice_verify_enabled = models.BooleanField(default=False, verbose_name='开启发票验真')
    # 发票抬头配置（供员工开票参考）
    invoice_header_name = models.CharField(max_length=200, blank=True, default='', verbose_name='发票抬头名称')
    invoice_header_tax_no = models.CharField(max_length=50, blank=True, default='', verbose_name='发票抬头税号')
    invoice_header_address = models.CharField(max_length=300, blank=True, default='', verbose_name='发票抬头地址')
    invoice_header_phone = models.CharField(max_length=50, blank=True, default='', verbose_name='发票抬头电话')
    invoice_header_bank = models.CharField(max_length=100, blank=True, default='', verbose_name='发票抬头开户行')
    invoice_header_bank_account = models.CharField(max_length=100, blank=True, default='', verbose_name='发票抬头开户账号')
    invoice_header_bank_name = models.CharField(max_length=100, blank=True, default='', verbose_name='发票抬头开户银行')
    company_name = models.CharField(max_length=200, blank=True, default='', verbose_name='企业主体名称')
    company_tax_no = models.CharField(max_length=50, blank=True, default='', verbose_name='纳税人识别号')
    # 发票抬头各字段显示开关（JSON：key→bool），配合 show_invoice_header 总开关使用
    invoice_header_show = models.JSONField(default=dict, blank=True, verbose_name='发票抬头字段显示开关')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        unique_together = ('tenant', 'sub_tenant', 'department')
        ordering = ['-id', '-updated_at']
        verbose_name = '普惠补贴配置'
        verbose_name_plural = '普惠补贴配置'

    def __str__(self):
        parts = [self.tenant.short_name or self.tenant.name]
        if self.sub_tenant:
            parts.append(f'子公司:{self.sub_tenant.short_name or self.sub_tenant.name}')
        if self.department:
            parts.append(f'部门:{self.department.name}')
        return ' - '.join(parts)


class DailyDigestConfig(models.Model):
    """每日工作汇总通知配置（每个企业一条）"""
    tenant = models.OneToOneField(
        'accounts.Tenant', on_delete=models.CASCADE,
        related_name='daily_digest_config', verbose_name='所属企业')
    enabled = models.BooleanField(default=False, verbose_name='是否开启每日通知')
    send_time = models.TimeField(default=time(9, 0), verbose_name='每日发送时间')
    auto_send = models.BooleanField(default=False, verbose_name='自动发送（否=手动发送）')
    last_sent_date = models.DateField(null=True, blank=True, verbose_name='最后发送日期')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '每日通知配置'
        verbose_name_plural = '每日通知配置'

    def __str__(self):
        return f'{self.tenant} 每日通知配置'


class MaterialItem(models.Model):
    """物资物品库：统一物品主数据（名称/规格/单位/分类/参考价）"""
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               related_name='material_items', verbose_name='所属企业')
    name = models.CharField(max_length=100, verbose_name='物品名称')
    spec = models.CharField(max_length=100, blank=True, default='', verbose_name='规格型号')
    unit = models.CharField(max_length=20, blank=True, default='', verbose_name='单位')
    category = models.CharField(max_length=50, blank=True, default='', verbose_name='分类')
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name='参考单价')
    is_active = models.BooleanField(default=True, verbose_name='是否启用')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='material_items_created',
                                   verbose_name='创建人')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '物资物品库'
        verbose_name_plural = '物资物品库'
        ordering = ['name', 'id']

    def __str__(self):
        return f'{self.name}{(" " + self.spec) if self.spec else ""}'


class MaterialRequirement(models.Model):
    """物资需求单（业务数据，审批通过后进入采购/入库流转）"""
    STATUS_CHOICES = [
        ('pending', '待审批'),
        ('approved', '已通过(待采购)'),
        ('purchasing', '采购中'),
        ('stocked', '已入库(可领用)'),
    ]
    request = models.OneToOneField(ApprovalRequest, on_delete=models.CASCADE,
                                   related_name='material_requirement', verbose_name='关联审批单')
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               null=True, blank=True, related_name='material_requirements',
                               verbose_name='所属企业')
    doc_no = models.CharField(max_length=40, unique=True, verbose_name='需求单号')
    branch_dept = models.ForeignKey(Department, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='material_requirements',
                                    verbose_name='分公司')
    purpose = models.TextField(blank=True, default='', verbose_name='用途')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='状态')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='material_requirements_created',
                                   verbose_name='申请人')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '物资需求单'
        verbose_name_plural = '物资需求单'

    def __str__(self):
        return self.doc_no


class MaterialRequirementItem(models.Model):
    """物资需求单明细"""
    requirement = models.ForeignKey(MaterialRequirement, on_delete=models.CASCADE,
                                    related_name='items', verbose_name='需求单')
    item_name = models.CharField(max_length=100, verbose_name='物品名称')
    spec = models.CharField(max_length=100, blank=True, default='', verbose_name='规格型号')
    unit = models.CharField(max_length=20, blank=True, default='', verbose_name='单位')
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name='单价')
    quantity = models.DecimalField(max_digits=12, decimal_places=2, verbose_name='数量')
    remark = models.CharField(max_length=200, blank=True, default='', verbose_name='备注')
    requisitioned_quantity = models.DecimalField(max_digits=12, decimal_places=2, default=0,
                                                 verbose_name='已领用数量')

    class Meta:
        verbose_name = '物资需求单明细'
        verbose_name_plural = '物资需求单明细'


class MaterialRequisition(models.Model):
    """物资领用单：关联需求单，审核通过后领料"""
    STATUS_CHOICES = [
        ('pending', '待审批'),
        ('approved', '已通过(可领用)'),
        ('rejected', '已驳回'),
    ]
    request = models.OneToOneField(ApprovalRequest, on_delete=models.CASCADE,
                                   related_name='material_requisition', verbose_name='关联审批单')
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               null=True, blank=True, related_name='material_requisitions',
                               verbose_name='所属企业')
    doc_no = models.CharField(max_length=40, unique=True, verbose_name='领用单号')
    requirement = models.ForeignKey(MaterialRequirement, on_delete=models.CASCADE,
                                    null=True, blank=True, related_name='requisitions',
                                    verbose_name='关联需求单')
    requirement_doc_no = models.CharField(max_length=40, blank=True, default='', verbose_name='关联需求单号(快照)')
    branch_dept = models.ForeignKey(Department, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='material_requisitions',
                                    verbose_name='领用部门')
    purpose = models.TextField(blank=True, default='', verbose_name='用途')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='状态')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='material_requisitions_created',
                                   verbose_name='申请人')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '物资领用单'
        verbose_name_plural = '物资领用单'

    def __str__(self):
        return self.doc_no


class MaterialRequisitionItem(models.Model):
    """物资领用单明细（从需求单自动带出，快照）"""
    requisition = models.ForeignKey(MaterialRequisition, on_delete=models.CASCADE,
                                    related_name='items', verbose_name='领用单')
    item_name = models.CharField(max_length=100, verbose_name='物品名称')
    spec = models.CharField(max_length=100, blank=True, default='', verbose_name='规格型号')
    unit = models.CharField(max_length=20, blank=True, default='', verbose_name='单位')
    price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True, verbose_name='单价')
    quantity = models.DecimalField(max_digits=12, decimal_places=2, verbose_name='数量')
    remark = models.CharField(max_length=200, blank=True, default='', verbose_name='备注')

    class Meta:
        verbose_name = '物资领用单明细'
        verbose_name_plural = '物资领用单明细'


class DocumentSequence(models.Model):
    """单据号序号（按 企业+单据类型+日期键 原子自增，保证并发唯一）"""
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               related_name='doc_sequences', verbose_name='所属企业')
    doc_type = models.CharField(max_length=40, verbose_name='单据类型')
    date_key = models.CharField(max_length=20, verbose_name='日期键(如 202608)')
    seq = models.PositiveIntegerField(default=0, verbose_name='当前序号')

    class Meta:
        unique_together = ('tenant', 'doc_type', 'date_key')
        verbose_name = '单据号序号'
        verbose_name_plural = '单据号序号'


class WatermarkConfig(models.Model):
    """企业水印配置（每企业一条，超管在管理控制台维护；隐性水印含用户信息便于溯源）"""
    POSITION_CHOICES = [
        ('tile', '整页平铺'),
        ('center', '居中'),
        ('top_left', '左上角'),
        ('top_right', '右上角'),
        ('bottom_left', '左下角'),
        ('bottom_right', '右下角'),
    ]
    SHAPE_CHOICES = [
        ('text', '纯文字'),
        ('stamp', '印章(圆角边框)'),
    ]
    tenant = models.OneToOneField('accounts.Tenant', on_delete=models.CASCADE,
                                  related_name='watermark_config', verbose_name='所属企业')
    enabled = models.BooleanField(default=True, verbose_name='全局开启水印')
    company_name = models.CharField(max_length=100, default='义乌吉通集团', verbose_name='公司名称')
    text = models.CharField(max_length=300, blank=True, default='', verbose_name='附加水印文字')
    font_size = models.IntegerField(default=16, verbose_name='字体大小')
    font_color = models.CharField(max_length=20, default='#000000', verbose_name='字体颜色')
    font_style = models.CharField(max_length=20, default='normal', verbose_name='字体样式')  # normal/bold/italic
    rotation = models.IntegerField(default=-30, verbose_name='旋转角度')
    opacity = models.FloatField(default=0.08, verbose_name='水印透明度')
    position = models.CharField(max_length=20, choices=POSITION_CHOICES, default='tile', verbose_name='水印位置')
    shape = models.CharField(max_length=20, choices=SHAPE_CHOICES, default='text', verbose_name='水印形状')
    hidden_enabled = models.BooleanField(default=True, verbose_name='开启隐性水印')
    hidden_opacity = models.FloatField(default=0.04, verbose_name='隐性水印透明度')
    print_enabled = models.BooleanField(default=True, verbose_name='打印时添加水印')
    # 每个页面的水印开关 {page_key: bool}
    page_enabled = models.JSONField(default=dict, verbose_name='页面水印开关')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '企业水印配置'
        verbose_name_plural = '企业水印配置'

    def __str__(self):
        return f'{self.tenant} 水印配置'


class PrintLog(models.Model):
    """打印操作留痕：记录用户何时在哪个页面打印了什么，便于打印统计与打印权限分配"""
    tenant = models.ForeignKey('accounts.Tenant', null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='print_logs', verbose_name='所属企业')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='print_logs', verbose_name='操作人')
    page = models.CharField(max_length=50, default='other', verbose_name='打印页面')  # approval/attendance/subsidy/subsidy_verify/subsidy_pay
    target_type = models.CharField(max_length=50, blank=True, default='', verbose_name='对象类型')
    target_id = models.CharField(max_length=100, blank=True, default='', verbose_name='对象ID')
    count = models.IntegerField(default=0, verbose_name='打印条数')
    ip = models.CharField(max_length=50, blank=True, default='', verbose_name='IP地址')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='打印时间')

    class Meta:
        ordering = ['-created_at']
        verbose_name = '打印记录'
        verbose_name_plural = '打印记录'

    def __str__(self):
        return f'{self.user} {self.page} 打印 {self.created_at:%Y-%m-%d %H:%M}'


class DailyWorkSummary(models.Model):
    """每日工作总结：员工上传当日工作数据（图片/文档/表格）+ 总结文字，
    系统按职位调用大模型进行分析推理，结果流式写入 analysis_result。"""
    STATUS_CHOICES = [
        ('pending', '待分析'),
        ('analyzing', '分析中'),
        ('done', '已完成'),
        ('failed', '分析失败'),
        ('disabled', '已停用'),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                             related_name='daily_work_summaries', verbose_name='员工')
    tenant = models.ForeignKey('accounts.Tenant', null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='daily_work_summaries', verbose_name='所属企业')
    summary_date = models.DateField(verbose_name='工作总结日期')
    content = models.TextField(blank=True, default='', verbose_name='工作总结内容')
    position = models.CharField(max_length=100, blank=True, default='', verbose_name='职位快照')
    # 上传的工作数据文件 [{name, url, type, size}]
    files = models.JSONField(default=list, verbose_name='工作数据文件')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='分析状态')
    analysis_result = models.TextField(blank=True, default='', verbose_name='大模型分析结果')
    prompt_text = models.TextField(blank=True, default='', verbose_name='喂给大模型的提示词')
    error_message = models.TextField(blank=True, default='', verbose_name='错误信息')
    analyzed_at = models.DateTimeField(null=True, blank=True, verbose_name='分析完成时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        ordering = ['-summary_date', '-created_at']
        verbose_name = '每日工作总结'
        verbose_name_plural = '每日工作总结'
        indexes = [
            models.Index(fields=['user', 'summary_date']),
            models.Index(fields=['tenant', 'summary_date']),
        ]

    def __str__(self):
        return f'{self.user} {self.summary_date} 每日总结'


class WorkSummaryRangeAnalysis(models.Model):
    """指定员工、指定日期范围内每日工作总结的批量大模型分析（供部门负责人/超管进行阶段复盘）"""
    STATUS_CHOICES = [
        ('pending', '待分析'),
        ('analyzing', '分析中'),
        ('done', '已完成'),
        ('failed', '分析失败'),
        ('disabled', '已停用'),
    ]
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                  related_name='work_summary_range_analyses', verbose_name='发起人')
    target_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                    related_name='work_summary_range_analyzed', verbose_name='被分析员工')
    tenant = models.ForeignKey('accounts.Tenant', null=True, blank=True, on_delete=models.SET_NULL,
                               related_name='work_summary_range_analyses', verbose_name='所属企业')
    date_from = models.DateField(verbose_name='开始日期')
    date_to = models.DateField(verbose_name='结束日期')
    summary_count = models.IntegerField(default=0, verbose_name='纳入分析的总结条数')
    prompt_text = models.TextField(blank=True, default='', verbose_name='喂给大模型的提示词')
    analysis_result = models.TextField(blank=True, default='', verbose_name='大模型分析结果')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', verbose_name='分析状态')
    error_message = models.TextField(blank=True, default='', verbose_name='错误信息')
    analyzed_at = models.DateTimeField(null=True, blank=True, verbose_name='分析完成时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        ordering = ['-created_at']
        verbose_name = '每日工作总结范围分析'
        verbose_name_plural = '每日工作总结范围分析'

    def __str__(self):
        return f'{self.target_user} {self.date_from}~{self.date_to} 范围分析'


class WorkSummaryConfig(models.Model):
    """每日工作总结大模型配置（每企业一条，超管维护）：启用开关 + 调用的火山方舟大模型ID + 风险管控"""
    SCOPE_CHOICES = [
        ('all', '全员'),
        ('positions', '指定职位'),
        ('departments', '指定部门'),
        ('users', '指定用户'),
    ]
    tenant = models.OneToOneField('accounts.Tenant', on_delete=models.CASCADE,
                                  related_name='work_summary_config', verbose_name='所属企业')
    enabled = models.BooleanField(default=True, verbose_name='启用模型分析')
    # 留空则用系统默认 ARK_MODEL；可填预设模型或自定义模型ID
    model_id = models.CharField(max_length=100, blank=True, default='', verbose_name='调用的大模型ID')
    # —— 第三方依赖风险管控：每日调用量 / 成本阈值 ——
    limit_enabled = models.BooleanField(default=False, verbose_name='启用每日调用限额')
    daily_call_limit = models.PositiveIntegerField(default=0, verbose_name='每日分析次数上限(0=不限)')
    daily_cost_limit = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'),
                                           verbose_name='每日费用上限(元,0=不限)')
    cost_per_1k_tokens = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0.002'),
                                             verbose_name='每千token估算成本(元)')
    today_call_count = models.PositiveIntegerField(default=0, verbose_name='今日已分析次数')
    today_cost = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('0'),
                                     verbose_name='今日已消耗估算费用(元)')
    today_date = models.DateField(null=True, blank=True, verbose_name='计数日期')
    limit_notified = models.BooleanField(default=False, verbose_name='已达上限是否已通知')
    near_limit_notified = models.BooleanField(default=False, verbose_name='接近上限是否已通知')
    # —— 内部数据合规：提交给大模型前做敏感信息脱敏 ——
    mask_sensitive = models.BooleanField(default=True, verbose_name='提交分析前脱敏敏感信息')
    # —— 上线灰度试点：限定 AI 分析开放范围 ——
    scope_type = models.CharField(max_length=20, choices=SCOPE_CHOICES, default='all', verbose_name='分析开放范围')
    scope_value = models.JSONField(default=list, verbose_name='范围值(职位名列表/部门ID列表/用户ID列表)')
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='work_summary_config_updates', verbose_name='最后配置人')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '每日总结大模型配置'
        verbose_name_plural = '每日总结大模型配置'

    def __str__(self):
        return f'{self.tenant} 每日总结模型配置(启用={self.enabled}, 模型={self.model_id or "默认"})'

    @classmethod
    def get_config(cls, tenant):
        cfg, _ = cls.objects.get_or_create(tenant=tenant, defaults={})
        return cfg

    def effective_model(self):
        return self.model_id.strip() or (getattr(settings, 'ARK_MODEL', '') or 'doubao-seed-1-6-250615')

    def ensure_today(self):
        """按天重置今日调用计数（跨天自动清零）"""
        from datetime import date as dt_date
        today = dt_date.today()
        if self.today_date != today:
            self.today_date = today
            self.today_call_count = 0
            self.today_cost = Decimal('0')
            self.limit_notified = False
            self.near_limit_notified = False
            self.save(update_fields=['today_date', 'today_call_count', 'today_cost',
                                     'limit_notified', 'near_limit_notified'])

    def limit_reached(self):
        """今日调用量/成本是否已达上限"""
        self.ensure_today()
        if not self.limit_enabled:
            return False
        if self.daily_call_limit and self.today_call_count >= self.daily_call_limit:
            return True
        if self.daily_cost_limit and self.today_cost >= self.daily_cost_limit:
            return True
        return False

    def in_scope(self, user):
        """灰度试点：该用户是否在 AI 分析开放范围内"""
        if (self.scope_type or 'all') == 'all':
            return True
        scope = list(self.scope_value or [])
        if not scope:
            return True
        st = self.scope_type
        try:
            if st == 'positions':
                return (getattr(user, 'position', '') or '').strip() in scope
            if st == 'users':
                return user.id in scope
            if st == 'departments':
                from org.models import UserDepartment
                from accounts.models import Department
                my_dept_ids = set(UserDepartment.objects.filter(user=user).values_list('department_id', flat=True))
                scope_ids = set(scope)
                if my_dept_ids & scope_ids:
                    return True
                # 命中上级部门也放行（父部门范围覆盖其子部门）
                seen = set()
                for did in my_dept_ids:
                    cur = Department.objects.filter(id=did).first()
                    while cur and cur.parent_id and cur.id not in seen:
                        seen.add(cur.id)
                        if cur.parent_id in scope_ids:
                            return True
                        cur = cur.parent
                return False
        except Exception:
            pass
        return True


# 默认所有页面开启水印（首次创建时播种）
DEFAULT_WATERMARK_PAGES = [
    'chat', 'admin', 'cloud', 'cloud_settings', 'cloud_editor',
    'oa_approval', 'oa_subsidy', 'oa_subsidy_verify', 'oa_subsidy_pay',
    'oa_attendance', 'work_calendar', 'work_summary', 'tasks', 'org', 'other',
]
