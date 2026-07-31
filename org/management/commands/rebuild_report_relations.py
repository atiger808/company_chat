# org/management/commands/rebuild_report_relations.py
"""
管理命令：根据企业组织架构自动重建汇报关系
汇报关系规则（钉钉模式）：
1. 部门负责人 → 部门内所有成员
2. 上级部门负责人 → 下级部门负责人
3. 无负责人的部门自动归属最近的有负责人的上级部门

用法：
  python manage.py rebuild_report_relations                    # 全部企业
  python manage.py rebuild_report_relations --tenant=1          # 指定企业
  python manage.py rebuild_report_relations --tenant=1 --dry-run  # 预览
"""
from django.core.management.base import BaseCommand, CommandParser
from accounts.models import Tenant
from org.views import rebuild_report_relations


class Command(BaseCommand):
    help = '根据组织架构自动重建汇报关系'

    def add_arguments(self, parser: CommandParser):
        parser.add_argument('--tenant', type=int, help='企业ID，不传则处理所有企业')
        parser.add_argument('--dry-run', action='store_true', help='仅预览，不实际执行')

    def handle(self, *args, **options):
        tenant_id = options.get('tenant')
        dry_run = options.get('dry-run')

        tenants = Tenant.objects.filter(is_active=True)
        if tenant_id:
            tenants = tenants.filter(id=tenant_id)

        for tenant in tenants:
            self.stdout.write(f'\n=== 企业: {tenant.name} (ID={tenant.id}) ===')
            if dry_run:
                from org.models import ReportRelation
                existing = ReportRelation.objects.filter(tenant=tenant).count()
                self.stdout.write(f'  当前汇报关系记录数: {existing}')
                self.stdout.write(self.style.WARNING('  DRY RUN 模式，未实际执行'))
            else:
                count = rebuild_report_relations(tenant)
                self.stdout.write(self.style.SUCCESS(f'  汇报关系重建完成，共创建 {count} 条记录'))

        self.stdout.write(self.style.SUCCESS('\n全部完成'))
