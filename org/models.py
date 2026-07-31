# org/models.py - 组织架构辅助模型（全部企业隔离）
from django.db import models
from django.conf import settings


class UserDepartment(models.Model):
    """员工-部门关联表（企业隔离）"""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='department_relations',
        verbose_name='员工'
    )
    department = models.ForeignKey(
        'accounts.Department',
        on_delete=models.CASCADE,
        related_name='user_relations',
        verbose_name='部门'
    )
    is_primary = models.BooleanField(default=False, verbose_name='是否主部门')
    position = models.CharField(max_length=100, blank=True, verbose_name='部门内职位')
    join_date = models.DateField(auto_now_add=True, verbose_name='加入日期')

    class Meta:
        unique_together = ('user', 'department')
        verbose_name = '员工部门关联'
        verbose_name_plural = '员工部门关联'

    def __str__(self):
        return f'{self.user.username} - {self.department.name}'


class ReportRelation(models.Model):
    """汇报关系模型（企业隔离）"""
    tenant = models.ForeignKey(
        'accounts.Tenant',
        on_delete=models.CASCADE,
        related_name='report_relations',
        verbose_name='所属企业'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='report_to_relations',
        verbose_name='汇报人'
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='subordinates',
        verbose_name='直属上级'
    )
    is_direct = models.BooleanField(default=True, verbose_name='是否直接汇报')
    department = models.ForeignKey(
        'accounts.Department',
        on_delete=models.CASCADE,
        verbose_name='所属部门'
    )

    class Meta:
        unique_together = ('user', 'department')
        verbose_name = '汇报关系'
        verbose_name_plural = '汇报关系'


class OrgChangeLog(models.Model):
    """组织架构变更日志（企业隔离）"""
    ACTION_CHOICES = [
        ('create_dept', '创建部门'),
        ('update_dept', '修改部门'),
        ('delete_dept', '删除部门'),
        ('move_dept', '移动部门'),
        ('add_member', '添加成员'),
        ('remove_member', '移除成员'),
        ('set_leader', '设置负责人'),
        ('switch_tenant', '切换企业'),
    ]

    tenant = models.ForeignKey(
        'accounts.Tenant',
        on_delete=models.CASCADE,
        related_name='org_change_logs',
        verbose_name='所属企业'
    )
    action = models.CharField(max_length=20, choices=ACTION_CHOICES, verbose_name='操作类型')
    department = models.ForeignKey(
        'accounts.Department',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='change_logs',
        verbose_name='相关部门'
    )
    operator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name='操作人'
    )
    detail = models.JSONField(default=dict, verbose_name='变更详情')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = '组织变更日志'
        verbose_name_plural = '组织变更日志'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['tenant', 'created_at']),
            models.Index(fields=['tenant', 'action']),
        ]

    def __str__(self):
        return f'{self.get_action_display()} - {self.department}'
