# cloud/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from .websocket_utils import CollabMessageBroadcaster
from .models import CloudFile, FileCollaboration, DocumentCollaboration, DocumentChatMessage
from django.utils import timezone
from datetime import timedelta
from loguru import logger

class DocumentCollabConsumer(AsyncWebsocketConsumer):
    """文档协同编辑 WebSocket Consumer"""

    room_group_name = None
    file_id = None
    user = None

    async def connect(self):
        """建立连接"""
        self.file_id = self.scope['url_route']['kwargs']['file_id']
        self.user = self.scope['user']


        if not self.user or not self.user.is_authenticated:
            logger.warning(f'未认证用户尝试连接 WebSocket: {self.scope}')
            await self.close(code=4000)
            return

        if self.user.is_anonymous:
            logger.warning("Anonymous user attempting WebSocket connection")
            await self.close()
            return

        # 验证访问权限
        if not await self._check_access_permission():
            await self.close()
            return

        # 接受连接
        await self.accept()

        # 添加到协同组
        await self.channel_layer.group_add(
            f'doc_collab_{self.file_id}',
            self.channel_name
        )

        # 记录用户加入协同
        collab = await self._record_collab_status('editing')

        # 🔧 关键修复：广播用户加入消息 (与前端 user_joined 对齐)
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=self.file_id,
            message_type='user_joined',  # 🔧 前端期望的消息类型
            data={
                'user': {
                    'id': str(self.user.id),
                    'username': self.user.username,
                    'real_name': getattr(self.user, 'real_name', self.user.username),
                    'email': getattr(self.user, 'email', ''),
                    'avatar': self.user.get_avatar_url() if hasattr(self.user, 'get_avatar_url') else getattr(self.user, 'avatar_url', '/static/images/default-avatar.png'),
                    'department': getattr(self.user, 'department_info', {}).get('name') if hasattr(self.user, 'department_info') else None,
                    'position': getattr(self.user, 'position', ''),
                },
                'timestamp': timezone.now().isoformat(),
                'status': 'editing',
            },
            exclude_user_id=str(self.user.id),  # 不广播给自己
        )

        # 发送连接确认给当前用户
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'data': {
                'user_id': str(self.user.id),
                'file_id': self.file_id,
                'message': '协同连接已建立'
            },
            'timestamp': timezone.now().isoformat()
        }))

    async def disconnect(self, close_code):
        """断开连接"""

        # 🔧 关键修复：仅在用户认证时记录协作状态
        if self.scope.get("user") and self.scope["user"].is_authenticated:

            # 🔧 关键修复：广播用户离开消息 (与前端 user_left 对齐)
            await CollabMessageBroadcaster.abroadcast_collab_message(
                file_id=self.file_id,
                message_type='user_left',  # 🔧 前端期望的消息类型
                data={
                    'userId': str(self.user.id),  # 🔧 前端期望的字段名
                    'userName': getattr(self.user, 'real_name', self.user.username),
                    'timestamp': timezone.now().isoformat(),
                    'reason': 'disconnect' if close_code == 1000 else 'timeout',
                },
                exclude_user_id=None,  # 广播给所有人包括自己（用于清理）
            )

            # 记录用户离开状态
            await self._record_collab_status('closed')

            # 从协同组移除
            await self.channel_layer.group_discard(
                f'doc_collab_{self.file_id}',
                self.channel_name
            )

    async def receive(self, text_data):
        """接收前端发送的协同消息"""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            payload = data.get('data', {})

            # 🔧 根据前端发送的消息类型处理
            if message_type == 'user_typing':
                await self._handle_user_typing(payload)
            elif message_type == 'cursor_update':
                await self._handle_cursor_update(payload)
            elif message_type == 'selection_update':
                await self._handle_selection_update(payload)
            elif message_type == 'chat_message':
                await self._handle_chat_message(payload)
            elif message_type == 'heartbeat':
                await self._handle_heartbeat(payload)
            elif message_type == 'document_saved':
                await self._handle_document_saved(payload)
            elif message_type == 'version_created':
                await self._handle_version_created(payload)

        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({
                'type': 'error',
                'data': {'code': 'invalid_json', 'message': 'Invalid JSON format'},
                'timestamp': timezone.now().isoformat()
            }))

    # 🔧 关键修复：方法名必须与 broadcast_collab_message 中的 'type' 字段匹配
    async def collab_message(self, event):
        """处理广播的协同消息 (Channels 要求的方法名)"""
        # 排除发送者自己
        if event.get('exclude_user_id') == str(self.user.id):
            return

        # 🔧 构建与前端期望完全对齐的消息格式
        message_data = {
            'type': event['message_type'],  # 🔧 前端 switch 判断的字段
            'data': {
                **event.get('data', {}),
                # 🔧 确保发送者信息字段名与前端期望一致
                'userId': event.get('sender_id'),
                'userName': event.get('sender_username') or event.get('sender_real_name'),
                'avatar': event.get('sender_avatar'),
            },
            'timestamp': event.get('timestamp', timezone.now().isoformat()),
        }

        # 🔧 特殊处理：chat_message 需要额外字段
        if event['message_type'] == 'chat_message':
            message_data['data'].update({
                'messageId': event.get('data', {}).get('message_id'),
                'mentionUsers': event.get('data', {}).get('mentions', []),
                'isSystem': event.get('data', {}).get('is_system', False),
            })

        await self.send(text_data=json.dumps(message_data))


    # ==================== 消息处理逻辑 ====================

    async def _handle_user_typing(self, payload):
        """处理用户输入状态"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=self.file_id,
            message_type='user_typing',
            data={
                'userId': str(self.user.id),  # 🔧 前端期望的字段名
                'userName': getattr(self.user, 'real_name', self.user.username),
                'isTyping': payload.get('is_typing', False),  # 🔧 驼峰命名
                'cursorPosition': payload.get('cursor_position'),
            },
            exclude_user_id=str(self.user.id),
            sender_id=str(self.user.id),
            sender_username=self.user.username,
            sender_real_name=getattr(self.user, 'real_name', self.user.username),
            sender_avatar=getattr(self.user, 'avatar_url', None),
        )

    async def _handle_cursor_update(self, payload):
        """处理光标位置更新"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=self.file_id,
            message_type='cursor_update',
            data={
                'userId': str(self.user.id),
                'userName': getattr(self.user, 'real_name', self.user.username),
                'position': payload.get('cursor'),  # 🔧 前端期望的字段名
                'viewport': payload.get('viewport'),
                'color': payload.get('color', self._get_user_color(str(self.user.id))),
            },
            exclude_user_id=str(self.user.id),
            sender_id=str(self.user.id),
            sender_username=self.user.username,
            sender_real_name=getattr(self.user, 'real_name', self.user.username),
            sender_avatar=getattr(self.user, 'avatar_url', None),
        )

    async def _handle_selection_update(self, payload):
        """处理选区更新"""
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=self.file_id,
            message_type='selection_update',
            data={
                'userId': str(self.user.id),
                'userName': getattr(self.user, 'real_name', self.user.username),
                'selection': payload.get('selection'),
                'color': payload.get('highlight_color', '#409EFF'),
            },
            exclude_user_id=str(self.user.id),
            sender_id=str(self.user.id),
            sender_username=self.user.username,
            sender_real_name=getattr(self.user, 'real_name', self.user.username),
            sender_avatar=getattr(self.user, 'avatar_url', None),
        )

    async def _handle_chat_message(self, payload):
        """处理协同聊天消息"""
        # 保存聊天消息到数据库
        message = await DocumentChatMessage.objects.acreate(
            file_id=self.file_id,
            user=self.user,
            content=payload.get('content', ''),
            reply_to_id=payload.get('reply_to_id'),
        )

        # 🔧 解析@提及的用户
        mentions = payload.get('mentions', [])

        # 广播聊天消息
        await CollabMessageBroadcaster.abroadcast_collab_message(
            file_id=self.file_id,
            message_type='chat_message',
            data={
                'messageId': str(message.id),  # 🔧 前端期望的字段名
                'userId': str(self.user.id),
                'userName': getattr(self.user, 'real_name', self.user.username),
                'avatar': self.user.get_avatar_url() if hasattr(self.user, 'get_avatar_url') else getattr(self.user, 'avatar_url', '/static/images/default-avatar.png'),
                'content': message.content,
                'timestamp': timezone.now().isoformat(),
                'mentionUsers': mentions,  # 🔧 前端期望的字段名
                'isSystem': False,
            },
            exclude_user_id=None,  # 聊天消息广播给所有人
            sender_id=str(self.user.id),
            sender_username=self.user.username,
            sender_real_name=getattr(self.user, 'real_name', self.user.username),
            sender_avatar=getattr(self.user, 'avatar_url', None),
        )

    async def _handle_heartbeat(self, payload):
        """处理心跳保活"""
        # 更新最后活动时间
        await self._record_collab_status('editing')

        # 回复心跳确认
        await self.send(text_data=json.dumps({
            'type': 'heartbeat',  # 🔧 前端期望的消息类型
            'data': {
                'timestamp': timezone.now().isoformat(),
                'onlineUsers': await self._get_online_users_count(),  # 🔧 驼峰命名
            },
            'timestamp': timezone.now().isoformat()
        }))

    async def _handle_document_saved(self, payload):
        """处理文档保存通知（通常由后端保存逻辑触发）"""
        # 此消息通常由后端保存逻辑主动广播，而非前端发送
        # 如果前端发送，可能是确认保存完成
        pass

    async def _handle_version_created(self, payload):
        """处理版本创建通知"""
        # 此消息由后端版本创建逻辑主动广播
        pass



    # ==================== 辅助方法 ====================

    async def _check_access_permission(self):
        """检查用户是否有权限访问文档"""
        try:
            file_obj = await CloudFile.objects.select_related('owner').aget(id=self.file_id)

            if file_obj.owner == self.user or self.user.is_superuser:
                return True

            has_collab = await FileCollaboration.objects.filter(
                file=file_obj,
                user=self.user,
                is_active=True
            ).aexists()

            return has_collab
        except CloudFile.DoesNotExist:
            return False


    async def _record_collab_status(self, status: str):
        """记录协同编辑状态"""
        # 🔧 关键修复：跳过匿名用户
        if not self.scope["user"] or not self.scope["user"].is_authenticated:
            logger.debug(f"Anonymous user disconnected, skip recording status: {status}")
            return None

        try:
            collab, _ = await DocumentCollaboration.objects.aupdate_or_create(
                file_id=self.file_id,
                user=self.scope["user"],  # ✅ 此时已确保是认证用户
                defaults={
                    'status': status,
                    'last_activity': timezone.now(),
                }
            )
            if status == 'closed':
                collab.left_at = timezone.now()
                await collab.asave(update_fields=['left_at'])
            return collab

        except Exception as e:
            logger.error(f"Failed to record collaboration status: {e}", exc_info=True)

        return None

    async def _get_online_users_count(self):
        """获取当前在线协作者数量"""
        return await DocumentCollaboration.objects.filter(
            file_id=self.file_id,
            status__in=['editing', 'viewing'],
            last_activity__gt=timezone.now() - timedelta(minutes=5)
        ).acount()

    def _get_user_color(self, user_id):
        """生成用户专属颜色（与前端 getUserColor 逻辑一致）"""
        hash_val = 0
        for char in user_id:
            hash_val = ord(char) + ((hash_val << 5) - hash_val)
        hue = abs(hash_val) % 360
        return f'hsl({hue}, 75%, 55%)'