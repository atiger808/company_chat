from django.apps import AppConfig


class CloudConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'cloud'

    def ready(self):
        # 注意：默认不对上传表格自动转换，保留原始文件。
        # 仅在用户点击「转换为兼容格式」时通过 convert_compatible 接口生成 compat_file。
        pass
