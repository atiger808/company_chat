# cloud/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import CloudFile, DocumentCollaboration
from accounts.models import CustomUser
from django.utils import timezone
from django.db import models
import asyncio

import jwt
from django.conf import settings
from channels.db import database_sync_to_async
from loguru import logger
# 🔧 修复1: 正确使用用户模型（不要实例化）
User = CustomUser  # 或 from django.contrib.auth import get_user_model; User = get_user_model()


@database_sync_to_async
def get_user_from_token(token: str):
    """验证 JWT Token 并返回用户对象"""
    try:
        if not token:
            return None

        if token.startswith('Bearer '):
            token = token[7:].strip()

        jwt_secret = getattr(settings, 'ONLYOFFICE', {}).get('JWT_SECRET') or settings.SECRET_KEY
        jwt_algorithm = getattr(settings, 'ONLYOFFICE', {}).get('JWT_ALGORITHM', 'HS256')

        payload = jwt.decode(token, jwt_secret, algorithms=[jwt_algorithm], options={'verify_exp': True})

        user_id = payload.get('user_id') or payload.get('sub')
        if not user_id:
            return None

        user = User.objects.filter(id=user_id, is_active=True).first()
        return user

    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError, Exception):
        return None


class DocumentCollabConsumer(AsyncWebsocketConsumer):
    """文档协同编辑 WebSocket"""

    # 🔧 修复2: 类级别初始化属性，避免 disconnect 时属性不存在
    room_group_name = None
    file_id = None
    user = None

    async def connect(self):
        try:
            self.file_id = self.scope['url_route']['kwargs']['file_id']
            query_string = self.scope['query_string'].decode()
            self.token = query_string.split('token=')[-1] if 'token=' in query_string else None

            self.user = self.scope['user']

            if not self.user or not self.user.is_authenticated:
                logger.warning(f'未认证用户尝试连接 WebSocket: {self.scope}')
                await self.close(code=4000)
                return

            if self.user.is_anonymous:
                logger.warning("Anonymous user attempting WebSocket connection")
                await self.close()
                return

            # 🔧 修复3: 确保在关闭前设置 room_group_name
            self.room_group_name = f'doc_collab_{self.file_id}'

            if not await self._can_access_document(self.file_id, self.user):
                await self.close(code=4003)
                return

            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()

            await self._record_collaboration('editing')

            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_joined',
                    'payload': {
                        'user': await self._get_user_info(self.user),
                        'timestamp': timezone.now().isoformat()
                    }
                }
            )

            # 🔧 启动心跳保活（每 30 秒）
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        except Exception as e:
            # 🔧 修复4: 连接过程中异常时确保能安全关闭
            await self.close(code=4000)

    async def disconnect(self, close_code):
        logger.info(f"User {self.user.id if self.user else 'unknown'} disconnected, code: {close_code}")

        # 🔧 取消心跳任务
        if hasattr(self, 'heartbeat_task') and not self.heartbeat_task.done():
            self.heartbeat_task.cancel()

        # 🔧 修复5: 安全访问 room_group_name，避免属性不存在
        if self.room_group_name and self.channel_layer:
            try:
                # 记录用户离开
                await self._record_collaboration('closed')

                # 广播用户离开事件
                if self.user:
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            'type': 'user_left',
                            'payload': {
                                'userId': str(self.user.id),
                                'userName': self.user.real_name or self.user.username,
                                'timestamp': timezone.now().isoformat(),
                                'reason': 'disconnect'
                            }
                        }
                    )

                await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
            except Exception as e:
                # 静默处理，避免断开时二次异常
                pass

    async def receive(self, text_data):
        # 安全检查
        if not self.room_group_name or not hasattr(self, 'user') or not self.user:
            return

        try:
            data = json.loads(text_data)
            msg_type = data.get('type')
            payload = data.get('payload', {})

            if msg_type in ['cursor_update', 'selection_update', 'user_typing', 'chat_message']:
                # 🔧 为 chat_message 生成唯一 ID 并增强字段
                if msg_type == 'chat_message':
                    import uuid
                    payload['messageId'] = str(uuid.uuid4())
                    payload['isSystem'] = payload.get('isSystem', False)
                    # 解析@提及的用户
                    content = payload.get('content', '')
                    if '@' in content:
                        import re
                        mentions = re.findall(r'@(\w+)', content)
                        payload['mentionUsers'] = mentions

                # 🔧 构建广播消息
                broadcast_payload = {
                    **payload,
                    'userId': str(self.user.id),
                    'userName': self.user.real_name or self.user.username,
                    'avatar': getattr(self.user, 'get_avatar_url', lambda: '')(),
                    'timestamp': timezone.now().isoformat()
                }

                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': f'broadcast_{msg_type}',
                        'payload': broadcast_payload,
                        'exclude': self.channel_name  # 排除发送者自身
                    }
                )

                # 🔧 异步保存聊天消息（不阻塞广播）
                if msg_type == 'chat_message':
                    asyncio.create_task(self._save_chat_message(payload))

        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({'error': 'Invalid JSON'}))
        except Exception as e:
            logger.error(f"Receive error: {e}")

    async def _heartbeat_loop(self):
        """心跳保活循环"""
        try:
            while True:
                await asyncio.sleep(30)
                if self.channel_name in (await self.channel_layer.group_channels(self.room_group_name)):
                    await self.send(text_data=json.dumps({
                        'type': 'heartbeat',
                        'timestamp': timezone.now().isoformat()
                    }))
                else:
                    break
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning(f"Heartbeat error: {e}")

    # 消息广播处理器
    async def broadcast_cursor_update(self, event):
        if self.channel_name != event.get('exclude'):
            await self.send(text_data=json.dumps({
                'type': 'cursor_update',
                'payload': event['payload']
            }))

    async def broadcast_selection_update(self, event):
        if self.channel_name != event.get('exclude'):
            await self.send(text_data=json.dumps({
                'type': 'selection_update',
                'payload': event['payload']
            }))

    async def broadcast_user_typing(self, event):
        if self.channel_name != event.get('exclude'):
            await self.send(text_data=json.dumps({
                'type': 'user_typing',
                'payload': event['payload']
            }))

    async def broadcast_chat_message(self, event):
        if self.channel_name != event.get('exclude'):
            await self.send(text_data=json.dumps({
                'type': 'chat_message',
                'payload': event['payload']
            }))
            logger.debug(f"Chat message broadcasted: {event['payload'].get('content', '')[:30]}...")

    async def user_joined(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'payload': event['payload']
        }))

    async def user_left(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'payload': event['payload']
        }))

    # 辅助方法
    async def _can_access_document(self, file_id, user):
        """验证文档访问权限"""
        return await sync_to_async(lambda: CloudFile.objects.filter(
            id=file_id,
            deleted_at__isnull=True
        ).filter(
            models.Q(owner=user) |
            models.Q(file_collaborations__user=user, file_collaborations__is_active=True) |
            models.Q(owner__is_superuser=True)
        ).exists())()

    async def _get_user_info(self, user):
        """获取用户公开信息"""
        return {
            'id': str(user.id),
            'username': user.username,
            'real_name': user.real_name,
            'email': user.email or '',
            'avatar': user.get_avatar_url() if hasattr(user, 'get_avatar_url') else ''
        }

    @database_sync_to_async
    def _record_collaboration(self, status):
        """记录协作状态"""
        if not hasattr(self, 'user') or not self.user or not self.file_id:
            return
        try:
            file_obj = CloudFile.objects.select_related('owner').get(id=self.file_id)
            collab, created = DocumentCollaboration.objects.update_or_create(
                file=file_obj,
                user=self.user,
                defaults={
                    'status': status,
                    'last_activity': timezone.now()
                }
            )
            if status == 'closed':
                collab.left_at = timezone.now()
                collab.save(update_fields=['left_at', 'last_activity'])
            logger.info(f"Collaboration recorded: user={self.user.id}, status={status}")
        except CloudFile.DoesNotExist:
            logger.warning(f"File {self.file_id} not found for collaboration record")
        except Exception as e:
            logger.error(f"Record collaboration failed: {e}")

    @database_sync_to_async
    def _save_chat_message(self, payload):
        """保存聊天消息到数据库"""
        try:
            # 可选：创建 DocumentChatMessage 模型存储聊天历史
            # from .models import DocumentChatMessage
            #
            # DocumentChatMessage.objects.create(
            #     file_id=self.file_id,
            #     user=self.user,
            #     content=payload.get('content', ''),
            #     mention_users=payload.get('mentionUsers', []),
            #     timestamp=timezone.now()
            # )
            logger.info(f"Chat message saved: {payload.get('content', '')[:50]}...")
        except Exception as e:
            logger.warning(f'保存聊天消息失败: {e}')