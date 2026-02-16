# -*- coding: utf-8 -*-
# @File   :consumers.py
# @Time   :2026/2/3 15:13
# @Author :admin


# chat/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from .models import ChatRoom, Message, MessageReadStatus
from django.conf import settings
import logging
# logger = logging.getLogger(__name__)
from loguru import logger

class ChatConsumer(AsyncWebsocketConsumer):
    """聊天WebSocket消费者"""

    async def connect(self):
        """建立连接"""
        try:
            logger.info(f"WebSocket connection attempt from {self.scope.get('client')}")
            self.user = self.scope['user']
            self.room_group_name = None

            if self.user.is_anonymous:
                logger.warning("Anonymous user attempting WebSocket connection")
                await self.close()
                return

            # 获取房间名
            self.room_name = self.scope['url_route']['kwargs']['room_name']
            self.room_group_name = f'chat_{self.room_name}'

            # 验证用户权限
            if not await self.is_user_in_room(self.room_name):
                logger.warning(f"User {self.user.username} not authorized for room {self.room_name}")
                await self.close()
                return

            # 更新用户在线状态
            await self.update_user_online_status(True)

            # 加入房间组
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()
            logger.info(f"WebSocket connection accepted for user {self.user.username} in room {self.room_name}")

            # 发送在线用户列表
            await self.send_online_users()
        except Exception as e:
            logger.error(f"Error during WebSocket connection: {e}")
            await self.close()


    async def disconnect(self, close_code):
        logger.info(
            f"WebSocket disconnected for user {getattr(self.user, 'username', 'unknown')} with code {close_code}")

        """断开连接"""
        # 离开房间组
        # 只有在 room_group_name 存在时才离开房间组
        if self.room_group_name:
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

        # 更新用户在线状态（只有认证用户才更新）
        if hasattr(self, 'user') and not self.user.is_anonymous:
            await self.update_user_online_status(False)



    async def receive(self, text_data):
        """接收消息"""
        if self.user.is_anonymous:
            await self.close()
            return

        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type', 'chat_message')

            logger.info(f"Received message message_type: {message_type} from {self.user} - {self.user.username}: {text_data_json}")

            if message_type == 'chat_message':
                await self.handle_chat_message(text_data_json)
            elif message_type == 'typing':
                await self.handle_typing(text_data_json)
            elif message_type == 'read_message':
                await self.handle_read_message(text_data_json)
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
            return

    async def handle_chat_message(self, data):
        """处理聊天消息"""

        if self.user.is_anonymous:
            return

        content = data.get('content', '')
        message_type = data.get('message_type', 'text')
        file_id = data.get('file_id', None)  # 新增：支持 file_id

        # 保存消息到数据库
        message = await self.save_message(content, message_type, file_id=file_id)

        logger.info(f'user: {self.user} file_id: {file_id} message_type: {message_type} content: {content}')
        sender = {
            'id': self.user.id,
            'username': self.user.username,
            'email': self.user.email,
            'real_name': self.user.real_name,
            'avatar': self.user.avatar.url if self.user.avatar else None,
            'is_active': self.user.is_active,
            'is_online': self.user.is_online,
        }

        # 发送消息到房间组
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'chat_room': message.chat_room.id,
                'message_id': str(message.id),
                'is_read': message.is_read,
                'sender': sender,
                'sender_id': self.user.id,
                'sender_name': self.user.username,
                'content': content,
                'message_type': message_type,
                'file_info': message.get_file_info() if file_id else None,
                'timestamp': message.timestamp.isoformat(),
            }
        )

        # 同时发送全局通知（给聊天室所有成员）
        await self.send_global_notification({
            'type': 'new_message',
            'chat_room': message.chat_room.id,
            'content': content,
            'sender': sender,
            'sender_name': self.user.username,
            'sender_id': self.user.id,
            'message_type': message_type,
            'file_info': message.get_file_info() if file_id else None,
            'timestamp': message.timestamp.isoformat(),
        })

    async def handle_typing(self, data):
        """处理输入状态"""
        if self.user.is_anonymous:
            return

        is_typing = data.get('is_typing', False)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_typing',
                'user_id': str(self.user.id),
                'user_name': self.user.username,
                'is_typing': is_typing,
            }
        )

    async def handle_read_message(self, data):
        """处理消息已读"""
        if self.user.is_anonymous:
            return

        message_ids = data.get('message_ids', [])

        for message_id in message_ids:
            await self.mark_message_as_read(message_id)

    async def chat_message(self, event):
        """接收聊天消息事件"""
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'chat_room': event['chat_room'],
            'message_id': event['message_id'],
            'is_read': event['is_read'],
            'sender': event['sender'],
            'sender_id': event['sender_id'],
            'sender_name': event['sender_name'],
            'content': event['content'],
            'message_type': event['message_type'],
            'file_info': event.get('file_info'),
            'timestamp': event['timestamp'],
        }))

    async def user_typing(self, event):
        """接收用户输入状态事件"""
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'is_typing': event['is_typing'],
        }))

    async def user_joined(self, event):
        """用户加入通知"""
        await self.send(text_data=json.dumps({
            'type': 'user_joined',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
        }))

    async def user_left(self, event):
        """用户离开通知"""
        await self.send(text_data=json.dumps({
            'type': 'user_left',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
        }))

    @database_sync_to_async
    def save_message(self, content, message_type, file_id=None):
        from chat.models import ChatRoom, Message, FileUpload
        logger.info(f'room_name: {self.room_name} file_id: {file_id} content: {content}')
        chat_room = ChatRoom.objects.get(id=self.room_name)

        # 创建消息
        message = Message.objects.create(
            chat_room=chat_room,
            sender=self.user,
            content=content,
            message_type=message_type
        )

        # 如果提供了 file_id，则关联 FileUpload
        if file_id:
            try:
                file_upload = FileUpload.objects.get(id=file_id)
                message.file = file_upload
                message.save(update_fields=['file'])
            except FileUpload.DoesNotExist:
                logger.warning(f"FileUpload with ID {file_id} does not exist.")

        # 更新聊天室时间戳
        message.chat_room.updated_at = timezone.now()
        message.chat_room.save(update_fields=['updated_at'])

        return message

    @database_sync_to_async
    def is_user_in_room(self, room_id):
        """验证用户是否在房间中"""
        try:
            chat_room = ChatRoom.objects.get(id=room_id)
            return chat_room.members.filter(id=self.user.id).exists()
        except ChatRoom.DoesNotExist:
            return False

    @database_sync_to_async
    def update_user_online_status(self, is_online):
        """更新用户在线状态"""
        self.user.update_online_status(is_online)
        from chat.models import UserOnlineStatus
        online_status, created = UserOnlineStatus.objects.get_or_create(user=self.user)
        online_status.is_online = is_online
        if is_online:
            online_status.last_seen = timezone.now()
        online_status.save()

    @database_sync_to_async
    def mark_message_as_read(self, message_id):
        """标记消息为已读"""
        try:
            message = Message.objects.get(id=message_id)
            MessageReadStatus.objects.get_or_create(
                message=message,
                user=self.user
            )
            logger.info(f"Message {message_id} marked as read by user {self.user.username}")
        except Message.DoesNotExist:
            logger.warning(f"Message with ID {message_id} does not exist.")

    @database_sync_to_async
    def send_online_users(self):
        """发送在线用户列表"""
        chat_room = ChatRoom.objects.get(id=self.room_name)
        online_users = chat_room.members.filter(is_online=True)
        # online_users = chat_room.members.filter(online_status__is_online=True).select_related('online_status')

        users_data = [{
            'id': str(user.id),
            'username': user.username,
            'avatar': user.avatar.url if user.avatar else None
        } for user in online_users]

        return users_data

    async def send_global_notification(self, notification_data):
        """发送全局通知给聊天室所有成员"""
        chat_room = await database_sync_to_async(ChatRoom.objects.get)(id=self.room_name)

        # 获取聊天室所有成员
        members = await database_sync_to_async(list)(chat_room.members.all())

        for member in members:
            if member.id == self.user.id:
                continue  # 跳过发送者

            # 发送通知到用户的全局通知组
            group_name = f'user_{member.id}_notifications'
            await self.channel_layer.group_send(
                group_name,
                notification_data
            )


class NotificationConsumer(AsyncWebsocketConsumer):
    """全局通知WebSocket消费者"""

    async def connect(self):
        """建立连接"""
        try:
            logger.info(f"Notification WebSocket connection attempt from {self.scope.get('client')}")
            self.user = self.scope['user']

            if self.user.is_anonymous:
                logger.warning("Anonymous user attempting notification WebSocket connection")
                await self.close()
                return

            # 用户专属通知组
            self.group_name = f'user_{self.user.id}_notifications'

            # 加入通知组
            await self.channel_layer.group_add(self.group_name, self.channel_name)
            await self.accept()
            logger.info(f"Notification WebSocket connection accepted for user {self.user.username}")

        except Exception as e:
            logger.error(f"Error during notification WebSocket connection: {e}")
            await self.close()

    async def disconnect(self, close_code):
        """断开连接"""
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

        logger.info(f"Notification WebSocket disconnected for user {getattr(self.user, 'username', 'unknown')}")

    async def receive(self, text_data):
        """接收消息（通知消费者通常只接收不发送）"""
        pass

    async def new_message(self, event):
        """新消息通知"""
        await self.send(text_data=json.dumps({
            'type': 'new_message',
            'chat_room': event['chat_room'],
            'content': event['content'],
            'sender': event['sender'],
            'sender_name': event['sender_name'],
            'sender_id': event['sender_id'],
            'message_type': event.get('message_type', 'text'),
            'file_info': event.get('file_info'),
            'timestamp': event['timestamp'],
        }))

    async def unread_count_update(self, event):
        """未读消息数更新"""
        await self.send(text_data=json.dumps({
            'type': 'unread_count_update',
            'chat_room_id': event['chat_room_id'],
            'unread_count': event['unread_count'],
        }))

    async def room_updated(self, event):
        """聊天室更新通知"""
        await self.send(text_data=json.dumps({
            'type': 'room_updated',
            'room_id': event['room_id'],
            'room': event['room'],
        }))

    async def user_online_status(self, event):
        """用户在线状态变化"""
        await self.send(text_data=json.dumps({
            'type': 'user_online_status',
            'user_id': event['user_id'],
            'is_online': event['is_online'],
        }))






