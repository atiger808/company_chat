"""
ASGI config for company_chat project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/4.2/howto/deployment/asgi/
"""

# company_chat/asgi.py
import os
import django
from django.core.asgi import get_asgi_application

# 必须在导入任何 Django 模型之前设置 Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'company_chat.settings')
django.setup()

# 现在可以安全地导入 Channels 和其他模块
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from chat.middleware import TokenAuthMiddleware  # 导入自定义中间件
import chat.routing

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": TokenAuthMiddleware( # 使用自定义中间件
        URLRouter(
            chat.routing.websocket_urlpatterns
        )
    ),
})