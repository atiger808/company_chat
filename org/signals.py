# org/signals.py - 部门群自动同步
from django.db.models.signals import post_save, m2m_changed
from django.dispatch import receiver
from accounts.models import Department


@receiver(post_save, sender=Department)
def create_department_group(sender, instance, created, **kwargs):
    """部门创建时自动创建群聊（企业隔离）"""
    if created and instance.auto_create_group and instance.tenant:
        from chat.models import ChatRoom
        from accounts.models import CustomUser

        creator = instance.manager or instance.tenant.owner
        if not creator:
            return

        group = ChatRoom.objects.create(
            room_type='group',
            name=f'{instance.name}部门群',
            creator=creator,
        )
        members = instance.get_all_members()
        if members:
            group.members.add(*list(members))
            group.save()

        instance.department_group = group
        instance.save(update_fields=['department_group'])

        from .models import OrgChangeLog
        OrgChangeLog.objects.create(
            tenant=instance.tenant,
            action='create_dept',
            department=instance,
            operator=creator,
            detail={'name': instance.name, 'auto_created_group': group.id}
        )


@receiver(m2m_changed, sender=Department.deputy_managers.through)
def sync_deputy_to_dept_group(sender, instance, action, pk_set, **kwargs):
    """部门副负责人变更时同步到部门群"""
    if action in ('post_add', 'post_remove') and instance.department_group and instance.auto_sync_members:
        group = instance.department_group
        if action == 'post_add':
            from accounts.models import CustomUser
            users = CustomUser.objects.filter(id__in=pk_set)
            group.members.add(*list(users))
        elif action == 'post_remove':
            group.members.remove(*pk_set)
