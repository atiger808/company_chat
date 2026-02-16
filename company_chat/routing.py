# -*- coding: utf-8 -*-
# @File   :routing.py
# @Time   :2026/2/3 14:43
# @Author :admin


# company_chat/routing.py
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import chat.routing

application = ProtocolTypeRouter({
    "websocket": AuthMiddlewareStack(
        URLRouter(
            chat.routing.websocket_urlpatterns
        )
    ),
})