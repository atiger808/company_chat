from django.apps import AppConfig


class OrgConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'org'
    verbose_name = '组织架构'

    def ready(self):
        import org.signals  # noqa
