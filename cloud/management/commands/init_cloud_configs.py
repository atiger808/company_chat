# cloud/management/commands/init_cloud_configs.py

from django.core.management.base import BaseCommand
from cloud.models import CloudSystemConfig


class Command(BaseCommand):
    help = '初始化企业网盘系统配置'

    def handle(self, *args, **options):
        from cloud.views import CloudSystemSettingsViewSet

        viewset = CloudSystemSettingsViewSet()
        configs = viewset.PREDEFINED_CONFIGS

        created_count = 0
        updated_count = 0

        for key, config_data in configs.items():
            obj, created = CloudSystemConfig.objects.update_or_create(
                key=key,
                defaults={
                    'name': config_data['name'],
                    'value': config_data['default'],
                    'value_type': config_data['value_type'],
                    'category': config_data['category'],
                    'description': config_data.get('description', ''),
                    'default_value': config_data['default'],
                    'is_public': config_data.get('is_public', False),
                    'is_editable': config_data.get('is_editable', True),
                }
            )

            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'✓ 创建配置：{key}'))
            else:
                updated_count += 1
                self.stdout.write(f'  更新配置：{key}')

        self.stdout.write(self.style.SUCCESS(f'\n初始化完成：创建 {created_count} 个，更新 {updated_count} 个'))