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


class ApprovalRequest(models.Model):
    """审批请求"""

    APPROVAL_TYPE_CHOICES = [
        ('leave', '请假'),
        ('overtime', '加班'),
        ('expense', '报销'),
        ('trip', '出差'),
        ('purchase', '采购'),
        ('other', '其他'),
    ]
    STATUS_CHOICES = [
        ('pending', '待审批'),
        ('approved', '已通过'),
        ('rejected', '已驳回'),
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
    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='approval_requests',
        verbose_name='所属部门'
    )
    approval_type = models.CharField(
        max_length=20,
        choices=APPROVAL_TYPE_CHOICES,
        verbose_name='审批类型'
    )
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
        ordering = ['-created_at']
        verbose_name = '审批请求'
        verbose_name_plural = '审批请求'

    def __str__(self):
        return f'{self.applicant} {self.get_approval_type_display()} {self.title}'


class ApprovalLog(models.Model):
    """审批操作日志"""

    ACTION_CHOICES = [
        ('approve', '通过'),
        ('reject', '驳回'),
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
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='操作时间')

    class Meta:
        ordering = ['created_at']
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
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        ordering = ['order', 'id']
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
        ordering = ['id']
        verbose_name = '审批人'
        verbose_name_plural = '审批人'

    def __str__(self):
        return f'{self.user} - {self.get_status_display()}'
