# cloud/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/cloud/collab/(?P<file_id>[^/]+)/$', consumers.DocumentCollabConsumer.as_asgi()),
]

# websocket_urlpatterns = [
#     # OnlyOffice 文档编辑回调
#     re_path(r'ws/cloud/documents/(?P<file_id>[^/]+)/callback/$', consumers.DocumentCallbackConsumer.as_asgi()),
#
#     # 协同编辑状态同步
#     re_path(r'ws/cloud/documents/(?P<file_id>[^/]+)/collab/$', consumers.CollabConsumer.as_asgi()),
#
#     # 文件操作实时通知
#     re_path(r'ws/cloud/files/(?P<file_id>[^/]+)/notify/$', consumers.FileNotifyConsumer.as_asgi()),
# ]