from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'

    verbose_name = '用户管理'

    # def ready(self):
    #     # 🔧 注册用户模型信号
    #     from .models import CustomUser
    #     CustomUser.connect_signals()
