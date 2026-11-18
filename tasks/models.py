from django.db import models
from django.conf import settings
from chat.models import ChatRoom, Message


class Task(models.Model):
    STATUS_CHOICES = [
        ('todo', '待处理'), ('in_progress', '进行中'),
        ('done', '已完成'), ('archived', '已归档')
    ]
    PRIORITY_CHOICES = [
        ('low', '低'), ('medium', '中'), ('high', '高'), ('urgent', '紧急')
    ]

    title = models.CharField(max_length=200, verbose_name="任务标题")
    description = models.TextField(blank=True, null=True, verbose_name="任务描述")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo', db_index=True, verbose_name='任务状态')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium', verbose_name='紧急等级')

    # 人员关联
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_tasks',
                                verbose_name="创建者")
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name='assigned_tasks', verbose_name="执行人")

    # 时间与排序 (看板拖拽权重)
    due_date = models.DateTimeField(null=True, blank=True, verbose_name="截止日期")
    order = models.FloatField(default=0, verbose_name="看板排序权重")

    # 关联上下文 (聊天室消息转任务)
    related_chat_room = models.ForeignKey(ChatRoom, on_delete=models.SET_NULL, related_name='task', null=True, blank=True,
                                          verbose_name="来源聊天室")
    related_message = models.ForeignKey(Message, on_delete=models.SET_NULL, related_name='task', null=True, blank=True,
                                        verbose_name="来源消息")

    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               null=True, blank=True, related_name='tasks',
                               verbose_name="所属企业")

    # 子任务支持
    parent_task = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='subtasks',
                                    verbose_name="父任务")

    # 任务附件（图片/视频/文件；文件可在详情中保存到网盘）
    attachments = models.JSONField(default=list, blank=True, verbose_name="附件")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', 'order']
        verbose_name = "任务"
        verbose_name_plural = "任务"

    def __str__(self):
        return self.title


class TaskComment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    content = models.TextField(blank=True, default='')
    attachments = models.JSONField(default=list, blank=True, verbose_name='附件')
    created_at = models.DateTimeField(auto_now_add=True)


class WorkOrder(models.Model):
    """群工单 / 群待办：专项群内的多环节闭环工单。"""

    STATUS_CHOICES = [
        ('pending', '待启动'),
        ('processing', '处理中'),
        ('pending_verify', '待核验'),
        ('done', '已闭环'),
        ('cancelled', '已取消'),
    ]
    URGENCY_CHOICES = [
        ('low', '低'),
        ('medium', '中'),
        ('high', '高'),
        ('urgent', '紧急'),
    ]
    LAST_ACTION_CHOICES = [
        ('created', '已创建'),
        ('started', '已开始'),
        ('submitted', '已提交'),
        ('rejected', '已退回'),
        ('verified', '已核验'),
        ('cancelled', '已取消'),
        ('comment', '进度更新'),
        ('reassigned', '已改派'),
        ('ding', '已催办'),
    ]

    order_no = models.CharField(max_length=64, verbose_name='工单编号')
    title = models.CharField(max_length=200, verbose_name='工单标题')
    description = models.TextField(blank=True, default='', verbose_name='问题描述')
    urgency = models.CharField(max_length=20, choices=URGENCY_CHOICES, default='medium',
                               db_index=True, verbose_name='紧急等级')
    solution_template = models.TextField(blank=True, default='', verbose_name='解决方案模板')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending',
                              db_index=True, verbose_name='工单状态')

    chat_room = models.ForeignKey(ChatRoom, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='work_orders', verbose_name='所属群聊')
    tenant = models.ForeignKey('accounts.Tenant', on_delete=models.CASCADE,
                               related_name='work_orders', verbose_name='所属企业')
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                related_name='created_work_orders', verbose_name='发起人')
    creator_name = models.CharField(max_length=100, blank=True, default='', verbose_name='发起人姓名')
    verifier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True,
                                 related_name='verifying_work_orders', verbose_name='核验人')
    verifier_name = models.CharField(max_length=100, blank=True, default='', verbose_name='核验人姓名')

    current_stage_order = models.PositiveIntegerField(default=1, verbose_name='当前环节序号')
    sync_notify = models.BooleanField(default=True, verbose_name='群内同步通知')
    ding = models.BooleanField(default=False, verbose_name='DING 提醒')
    card_message = models.ForeignKey('chat.Message', on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='work_order_card', verbose_name='卡片消息')

    last_action = models.CharField(max_length=20, choices=LAST_ACTION_CHOICES, default='created',
                                   verbose_name='最近操作')
    last_action_at = models.DateTimeField(null=True, blank=True, verbose_name='最近操作时间')
    closed_at = models.DateTimeField(null=True, blank=True, verbose_name='闭环时间')
    archived_at = models.DateTimeField(null=True, blank=True, verbose_name='归档时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        ordering = ['-last_action_at', '-updated_at']
        verbose_name = '群工单'
        verbose_name_plural = '群工单'
        constraints = [
            models.UniqueConstraint(fields=['tenant', 'order_no'], name='uniq_workorder_tenant_no'),
        ]
        indexes = [
            models.Index(fields=['tenant', 'status', '-created_at']),
            models.Index(fields=['chat_room', 'status']),
            models.Index(fields=['creator', '-created_at']),
            models.Index(fields=['verifier', '-created_at']),
        ]

    def __str__(self):
        return f'{self.order_no} {self.title}'


class WorkOrderStage(models.Model):
    """工单环节：按 order 串行推进，一个环节一个执行人。"""

    STATUS_CHOICES = [
        ('pending', '待处理'),
        ('processing', '处理中'),
        ('done', '已完成'),
    ]

    work_order = models.ForeignKey(WorkOrder, on_delete=models.CASCADE, related_name='stages',
                                   verbose_name='所属工单')
    order = models.PositiveIntegerField(default=1, verbose_name='环节序号')
    name = models.CharField(max_length=100, verbose_name='环节名称')
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name='work_order_stages', verbose_name='环节执行人')
    assignee_name = models.CharField(max_length=100, blank=True, default='', verbose_name='执行人姓名')
    deadline = models.DateTimeField(null=True, blank=True, verbose_name='截止时间')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending',
                              db_index=True, verbose_name='环节状态')
    started_at = models.DateTimeField(null=True, blank=True, verbose_name='开始时间')
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name='完成时间')
    deliverable = models.JSONField(default=list, blank=True, verbose_name='交付成果')
    remark = models.TextField(blank=True, default='', verbose_name='备注')

    class Meta:
        ordering = ['order']
        verbose_name = '工单环节'
        verbose_name_plural = '工单环节'
        constraints = [
            models.UniqueConstraint(fields=['work_order', 'order'], name='uniq_workorder_stage_order'),
        ]
        indexes = [
            models.Index(fields=['assignee', 'status']),
            models.Index(fields=['work_order', 'status']),
        ]

    def __str__(self):
        return f'{self.work_order.order_no} - {self.order}.{self.name}'


class WorkOrderComment(models.Model):
    """工单评论/进度记录/核验审计。"""

    ACTION_CHOICES = [
        ('comment', '评论'),
        ('progress', '进度更新'),
        ('start', '开始处理'),
        ('submit', '提交环节'),
        ('verify', '核验通过'),
        ('reject', '驳回退回'),
        ('return', '退回处理'),
        ('system', '系统记录'),
        ('ding', 'DING 催办'),
    ]

    work_order = models.ForeignKey(WorkOrder, on_delete=models.CASCADE, related_name='comments',
                                   verbose_name='所属工单')
    stage = models.ForeignKey(WorkOrderStage, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='comments', verbose_name='所属环节')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name='work_order_comments', verbose_name='操作人')
    user_name = models.CharField(max_length=100, blank=True, default='', verbose_name='操作人姓名')
    action_type = models.CharField(max_length=20, choices=ACTION_CHOICES, default='comment',
                                   verbose_name='操作类型')
    content = models.TextField(blank=True, default='', verbose_name='内容')
    attachments = models.JSONField(default=list, blank=True, verbose_name='附件')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        ordering = ['created_at']
        verbose_name = '工单评论'
        verbose_name_plural = '工单评论'
        indexes = [
            models.Index(fields=['work_order', '-created_at']),
        ]

    def __str__(self):
        return f'{self.work_order.order_no} {self.action_type}'