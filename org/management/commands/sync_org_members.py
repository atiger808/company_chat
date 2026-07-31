# org/management/commands/sync_org_members.py
"""
管理命令：将企业成员同步到部门中
用法：
  python manage.py sync_org_members                      # 所有企业
  python manage.py sync_org_members --tenant=<tenant_id>  # 指定企业
  python manage.py sync_org_members --tenant=<tenant_id> --department=<dept_id>  # 指定部门
"""
from django.core.management.base import BaseCommand, CommandParser
from accounts.models import Tenant, TenantMembership
from org.models import UserDepartment
from django.db.models import Q


class Command(BaseCommand):
    help = '将已有企业的成员同步到 UserDepartment，使其在组织架构中可见'

    def add_arguments(self, parser: CommandParser):
        parser.add_argument('--tenant', type=int, help='指定企业ID，不传则处理所有企业')
        parser.add_argument('--department', type=int, help='指定部门ID（需同时指定 --tenant）')

    def handle(self, *args, **options):
        tenant_id = options.get('tenant')
        dept_id = options.get('department')

        tenants = Tenant.objects.filter(is_active=True)
        if tenant_id:
            tenants = tenants.filter(id=tenant_id)

        for tenant in tenants:
            self.stdout.write(f'\n=== 处理企业: {tenant.name} (ID={tenant.id}) ===')
            members = TenantMembership.objects.filter(tenant=tenant, is_active=True).select_related('user')

            if dept_id:
                from accounts.models import Department
                try:
                    dept = Department.objects.get(id=dept_id, tenant=tenant)
                except Department.DoesNotExist:
                    self.stderr.write(f'  部门 ID={dept_id} 不存在或不属于该企业')
                    continue
                depts = [dept]
            else:
                from accounts.models import Department
                depts = Department.objects.filter(tenant=tenant, is_active=True)

            if not depts:
                self.stdout.write(f'  企业「{tenant.name}」暂无部门，跳过')
                continue

            for dept in depts:
                synced = 0
                for m in members:
                    _, created = UserDepartment.objects.get_or_create(
                        user=m.user,
                        department=dept,
                        defaults={'is_primary': not UserDepartment.objects.filter(user=m.user).exists()}
                    )
                    if created:
                        synced += 1
                self.stdout.write(f'  部门「{dept.name}」: 同步 {synced} 名成员')

        self.stdout.write(self.style.SUCCESS('\n同步完成'))
