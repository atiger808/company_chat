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
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo', db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')

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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', '-updated_at']
        verbose_name = "任务"
        verbose_name_plural = "任务"

    def __str__(self):
        return self.title


class TaskComment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)