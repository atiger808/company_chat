# -*- coding: utf-8 -*-
# @File   :routing.py
# @Time   :2026/2/3 15:14
# @Author :admin


from django.urls import re_path
from . import consumers
websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<room_name>\w+)/$', consumers.ChatConsumer.as_asgi()),
    re_path(r'ws/notifications/$', consumers.NotificationConsumer.as_asgi()),
]

# # chat/routing.py
# from django.urls import re_path
# from .consumers import ChatConsumer  # 延迟导入
#
# websocket_urlpatterns = [
#     re_path(r'ws/chat/(?P<room_name>\w+)/$', ChatConsumer.as_asgi()),
# ]


