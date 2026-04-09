# cloud/websocket_utils.py
import json
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync, sync_to_async
from django.utils import timezone
from django.conf import settings


class CollabMessageBroadcaster:
    """协同编辑消息广播器"""

    @staticmethod
    async def abroadcast_collab_message(
            file_id=None,
            message_type=None,
            data=None,
            exclude_user_id=None,
            sender_id=None,
            sender_username=None,
            sender_avatar=None,
            sender_real_name=None,
            **kwargs
    ):
        """
        🔧 异步版本：广播协同消息给文档的所有协作者

        :param file_id: 文档 ID (UUID)
        :param message_type: 消息类型 (与前端 handleCollabMessage 对齐)
                           - user_joined: 用户加入
                           - user_left: 用户离开
                           - collab_status_update: 协同状态更新
                           - cursor_update: 光标更新
                           - selection_update: 选区更新
                           - user_typing: 输入状态
                           - chat_message: 聊天消息
                           - document_saved: 文档保存
                           - version_created: 版本创建
                           - error: 错误消息
                           - heartbeat: 心跳保活
        :param data: 消息数据字典
        :param exclude_user_id: 排除的用户 ID (字符串)
        :param sender_id: 发送者用户 ID
        :param sender_username: 发送者用户名
        :param sender_avatar: 发送者头像 URL
        :param sender_real_name: 发送者真实姓名
        :param kwargs: 其他扩展参数
        """
        if not settings.CHANNELS_ENABLED:
            return

        channel_layer = get_channel_layer()

        # 🔧 构建与前端期望完全对齐的广播消息
        broadcast_data = {
            'type': 'collab_message',  # 🔧 Channels Consumer 中处理的方法名
            'message_type': message_type,  # 🔧 前端 switch 判断的字段
            'file_id': str(file_id),
            'data': data,
            'exclude_user_id': str(exclude_user_id) if exclude_user_id else None,
            # 🔧 发送者信息（用于前端显示）
            'sender_id': str(sender_id) if sender_id else None,
            'sender_username': sender_username,
            'sender_avatar': sender_avatar,
            'sender_real_name': sender_real_name,
            'timestamp': timezone.now().isoformat(),
            **kwargs
        }

        # 🔧 发送到文档专属的 channel group
        await channel_layer.group_send(
            f'doc_collab_{file_id}',
            broadcast_data
        )

    @staticmethod
    def broadcast_collab_message(
            file_id,
            message_type,
            data,
            exclude_user_id=None,
            sender_id=None,
            sender_username=None,
            sender_avatar=None,
            sender_real_name=None,
            **kwargs
    ):
        """
        🔧 同步版本：广播协同消息（用于同步上下文调用）
        参数同上
        """
        return async_to_sync(CollabMessageBroadcaster.abroadcast_collab_message)(
            file_id=file_id,
            message_type=message_type,
            data=data,
            exclude_user_id=exclude_user_id,
            sender_id=sender_id,
            sender_username=sender_username,
            sender_avatar=sender_avatar,
            sender_real_name=sender_real_name,
            **kwargs
        )

    @staticmethod
    async def aadd_user_to_collab_group(file_id, channel_name):
        """异步：添加用户到文档协同组"""
        channel_layer = get_channel_layer()
        await channel_layer.group_add(
            f'doc_collab_{file_id}',
            channel_name
        )

    @staticmethod
    def add_user_to_collab_group(file_id, channel_name):
        """同步：添加用户到文档协同组"""
        return async_to_sync(CollabMessageBroadcaster.aadd_user_to_collab_group)(
            file_id, channel_name
        )

    @staticmethod
    async def aremove_user_from_collab_group(file_id, channel_name):
        """异步：从文档协同组移除用户"""
        channel_layer = get_channel_layer()
        await channel_layer.group_discard(
            f'doc_collab_{file_id}',
            channel_name
        )

    @staticmethod
    def remove_user_from_collab_group(file_id, channel_name):
        """同步：从文档协同组移除用户"""
        return async_to_sync(CollabMessageBroadcaster.aremove_user_from_collab_group)(
            file_id, channel_name
        )

    # ==================== 便捷广播方法 ====================

    @staticmethod
    async def broadcast_user_joined(file_id, user, exclude_user_id=None):
        """广播用户加入消息"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=file_id,
            message_type='user_joined',
            data={
                'user': {
                    'id': str(user.id),
                    'username': user.username,
                    'real_name': getattr(user, 'real_name', user.username),
                    'avatar': getattr(user, 'avatar_url', '/static/images/default-avatar.png'),
                },
                'timestamp': timezone.now().isoformat(),
                'status': 'editing',
            },
            exclude_user_id=exclude_user_id,
            sender_id=str(user.id),
            sender_username=user.username,
            sender_real_name=getattr(user, 'real_name', user.username),
            sender_avatar=getattr(user, 'avatar_url', None),
        )

    @staticmethod
    async def broadcast_user_left(file_id, user, reason='disconnect'):
        """广播用户离开消息"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=file_id,
            message_type='user_left',
            data={
                'userId': str(user.id),
                'userName': getattr(user, 'real_name', user.username),
                'timestamp': timezone.now().isoformat(),
                'reason': reason,
            },
            exclude_user_id=None,  # 广播给所有人
        )

    @staticmethod
    async def broadcast_collab_status(file_id, user, status, exclude_user_id=None):
        """广播协同状态更新"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=file_id,
            message_type='collab_status_update',
            data={
                'userId': str(user.id),
                'status': status,
                'last_activity': timezone.now().isoformat(),
            },
            exclude_user_id=exclude_user_id,
            sender_id=str(user.id),
            sender_username=user.username,
            sender_real_name=getattr(user, 'real_name', user.username),
        )

    @staticmethod
    async def broadcast_document_saved(file_id, version_number, saved_by_user):
        """广播文档保存成功"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=file_id,
            message_type='document_saved',
            data={
                'versionNumber': version_number,  # 🔧 驼峰命名
                'savedBy': getattr(saved_by_user, 'username', 'system'),
                'timestamp': timezone.now().isoformat(),
            },
            exclude_user_id=None,
        )

    @staticmethod
    async def broadcast_version_created(file_id, version_number, created_by_user, comment=''):
        """广播新版本创建"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=file_id,
            message_type='version_created',
            data={
                'versionNumber': version_number,
                'createdBy': getattr(created_by_user, 'username', 'system'),
                'timestamp': timezone.now().isoformat(),
                'comment': comment,
            },
            exclude_user_id=None,
        )

    @staticmethod
    async def broadcast_error(file_id, error_code, message, detail=None, target_user_id=None):
        """广播错误消息"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=file_id,
            message_type='error',
            data={
                'code': error_code,
                'message': message,
                'detail': detail,
                'timestamp': timezone.now().isoformat(),
            },
            exclude_user_id=target_user_id,  # 可指定目标用户
        )