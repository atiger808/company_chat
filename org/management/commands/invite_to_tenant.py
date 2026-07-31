# org/management/commands/invite_to_tenant.py
"""
管理命令：将系统中已有用户（包括不在企业中的）批量邀请到指定企业。

用法：
  python manage.py invite_to_tenant --tenant=1                # 将全部用户邀请到企业 1
  python manage.py invite_to_tenant --tenant=1 --users=3,5,7  # 邀请指定用户到企业 1
  python manage.py invite_to_tenant --tenant=1 --role=admin    # 指定角色（默认 member）
  python manage.py invite_to_tenant --tenant=1 --dry-run       # 查看会邀请哪些人，不实际执行
"""
from django.core.management.base import BaseCommand, CommandParser
from accounts.models import Tenant, TenantMembership, CustomUser


class Command(BaseCommand):
    help = '将已有用户批量邀请到指定企业（自动创建 TenantMembership）'

    def add_arguments(self, parser: CommandParser):
        parser.add_argument('--tenant', type=int, required=True, help='企业ID')
        parser.add_argument('--users', type=str, help='用户ID列表，逗号分隔，不传则邀请所有不在企业中的用户')
        parser.add_argument('--role', type=str, default='member', help='企业角色（默认 member）')
        parser.add_argument('--dry-run', action='store_true', help='仅预览，不实际执行')

    def handle(self, *args, **options):
        tenant_id = options['tenant']
        role = options['role']
        dry_run = options['dry_run']
        user_ids_input = options.get('users')

        try:
            tenant = Tenant.objects.get(id=tenant_id, is_active=True)
        except Tenant.DoesNotExist:
            self.stderr.write(f'企业 ID={tenant_id} 不存在或未激活')
            return

        existing = set(TenantMembership.objects.filter(
            tenant=tenant, is_active=True
        ).values_list('user_id', flat=True))

        if user_ids_input:
            ids = [int(x.strip()) for x in user_ids_input.split(',') if x.strip()]
            users = CustomUser.objects.filter(id__in=ids)
        else:
            users = CustomUser.objects.filter(is_active=True).exclude(id__in=existing)

        to_invite = [u for u in users if u.id not in existing]

        self.stdout.write(f'\n=== 企业: {tenant.name} (ID={tenant.id}) ===')
        self.stdout.write(f'现有成员: {len(existing)} 人')
        self.stdout.write(f'待邀请: {len(to_invite)} 人')
        self.stdout.write(f'角色: {role}')

        if not to_invite:
            self.stdout.write(self.style.SUCCESS('没有需要邀请的用户'))
            return

        self.stdout.write('\n待邀请用户列表:')
        for u in to_invite:
            self.stdout.write(f'  [{u.id}] {u.username} ({u.real_name or "-"}) <{u.email or "-"}>')

        if dry_run:
            self.stdout.write(self.style.WARNING('\nDRY RUN 模式，未实际执行'))
            return

        invited = 0
        for u in to_invite:
            TenantMembership.objects.get_or_create(
                user=u, tenant=tenant,
                defaults={'role': role, 'is_active': True}
            )
            invited += 1

        self.stdout.write(self.style.SUCCESS(f'\n成功邀请 {invited} 名用户加入企业「{tenant.name}」'))
        self.stdout.write(self.style.SUCCESS('现在可以在组织架构页面中将这些用户分配到具体部门'))
