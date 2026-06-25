# cloud/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/cloud/collab/(?P<file_id>[^/]+)/$', consumers.DocumentCollabConsumer.as_asgi()),
]
