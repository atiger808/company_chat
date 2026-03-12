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
from channels.security.websocket import AllowedHostsOriginValidator
from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from chat.middleware import TokenAuthMiddleware  # 导入自定义中间件
import chat.routing


# application = ProtocolTypeRouter({
#     "http": get_asgi_application(),
#     "websocket": TokenAuthMiddleware( # 使用自定义中间件
#         URLRouter(
#             chat.routing.websocket_urlpatterns
#         )
#     ),
# })


# 🔧 关键修复 1: 添加超时配置
class TimeoutMiddleware:
    """WebSocket 超时中间件"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'websocket':
            # 添加超时配置到 scope
            scope['websocket_timeout'] = 60  # 60 秒超时
        return await self.app(scope, receive, send)


# 🔧 关键修复 2: 正确的中间件顺序
application = ProtocolTypeRouter({
    # HTTP 请求
    "http": get_asgi_application(),

    # WebSocket 连接
    "websocket": TimeoutMiddleware(  # 最外层：超时控制
        AllowedHostsOriginValidator(  # 安全验证：允许的主机
            TokenAuthMiddleware(  # 自定义 Token 认证中间件
                URLRouter(  # URL 路由
                    chat.routing.websocket_urlpatterns
                )
            )
        )
    ),
})
