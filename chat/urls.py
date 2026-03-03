# -*- coding: utf-8 -*-
# @File   :urls.py
# @Time   :2026/2/3 15:14
# @Author :admin


# chat/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ChatRoomViewSet,
    MessageViewSet,
    FileUploadView,
    ChatRoomAdminViewSet,
)

router = DefaultRouter()
router.register(r'rooms', ChatRoomViewSet, basename='chatroom')
router.register(r'messages', MessageViewSet, basename='message')
router.register(r'admin/rooms', ChatRoomAdminViewSet, basename='admin-rooms')

urlpatterns = [
    path('', include(router.urls)),

    # 聊天室相关操作
    # path('rooms/<int:pk>/clear_history/', ChatRoomViewSet.as_view({'delete': 'clear_history'}), name='clear-history'),

    # 软删除聊天
    path('rooms/<int:pk>/soft_delete/', ChatRoomViewSet.as_view({'delete': 'soft_delete'}),
         name='chatroom-soft-delete'),

    # 解散群聊
    path('rooms/<int:pk>/dismiss_chat/', ChatRoomViewSet.as_view({'delete': 'dismiss_chat'}), name='chatroom-dismiss-chat'),

    path('rooms/<int:pk>/update_group/', ChatRoomViewSet.as_view({'put': 'update_group'}), name='chatroom-update-group'),
    path('rooms/<int:pk>/add_member/', ChatRoomViewSet.as_view({'post': 'add_member'}), name='chatroom-add-member'),
    path('rooms/<int:pk>/remove_member/', ChatRoomViewSet.as_view({'post': 'remove_member'}), name='chatroom-remove-member'),
    path('rooms/<int:pk>/pin_chat/', ChatRoomViewSet.as_view({'post': 'pin_chat'}), name='pin-chat'),
    path('rooms/<int:pk>/mute_chat/', ChatRoomViewSet.as_view({'post': 'mute_chat'}), name='mute-chat'),
    path('rooms/search_chats/', ChatRoomViewSet.as_view({'get': 'search_chats'}), name='search-chats'),

    # 消息相关操作
    path('messages/mark_as_read/', MessageViewSet.as_view({'post': 'mark_as_read'}), name='mark-as-read'),
    path('messages/<int:pk>/soft_delete/', MessageViewSet.as_view({'delete': 'soft_delete'}), name='message-soft-delete'),
    path('messages/clear_history/', MessageViewSet.as_view({'delete': 'clear_history'}), name='clear-history'),
    path('messages/unread_count/', MessageViewSet.as_view({'get': 'unread_count'}), name='unread-count'),

    # 确保撤销接口已注册
    path('messages/<int:pk>/revoke/', MessageViewSet.as_view({'post': 'revoke'}), name='message-revoke'),

    # 文件上传
    path('upload/', FileUploadView.as_view(), name='file-upload'),

    # 聊天室管理
    path('admin/rooms/<int:pk>/force-delete/', ChatRoomAdminViewSet.as_view({'post': 'force_delete'}), name='admin-force-delete'),
    path('admin/rooms/statistics/', ChatRoomAdminViewSet.as_view({'get': 'statistics'}), name='admin-room-statistics'),

]
