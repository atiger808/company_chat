# -*- coding: utf-8 -*-
# @File   :consumers.py
# @Time   :2026/2/3 15:13
# @Author :admin


# chat/consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from django.contrib.auth import get_user_model
from asgiref.sync import sync_to_async
from django.db import connection, close_old_connections
from accounts.models import CustomUser
from chat.models import ChatRoom, Message, FileUpload, MessageReadStatus, MessageDeleteStatus, ChatRoomDeleteStatus, UserOnlineStatus
from cloud.models import CloudFile, FileCollaboration

from django.conf import settings
import json
import asyncio
# import logging
# logger = logging.getLogger(__name__)
from loguru import logger


class ChatConsumer(AsyncWebsocketConsumer):
    """聊天WebSocket消费者"""

    # 在 ChatConsumer 类中添加
    async def update_and_broadcast_online_status(self, is_online):
        """更新用户在线状态并广播（优化版）"""
        if not hasattr(self, 'user') or self.user.is_anonymous:
            return


        # 更新数据库状态
        await self.update_user_online_status(is_online)

        # 获取当前用户所在的所有聊天室
        chat_rooms = await database_sync_to_async(
            lambda: list(ChatRoom.objects.filter(members=self.user))
        )()

        # 广播状态变化给所有相关聊天室
        for chat_room in chat_rooms:
            # 获取聊天室其他成员
            members = await database_sync_to_async(
                lambda: list(chat_room.members.exclude(id=self.user.id))
            )()

            for member in members:
                group_name = f'user_{member.id}_notifications'
                await self.channel_layer.group_send(
                    group_name,
                    {
                        'type': 'user_online_status',
                        'user_id': self.user.id,
                        'username': self.user.username,
                        'real_name': self.user.real_name,
                        'avatar_url': self.user.avatar.url if self.user.avatar else None,
                        'is_online': is_online,
                        'last_seen': timezone.now().isoformat() if not is_online else None,
                        'chat_room_id': chat_room.id  # 通知发生在哪个聊天室
                    }
                )

    # 修改 connect 方法
    async def connect(self):
        """建立连接"""
        try:
            logger.info(f"WebSocket connection attempt from {self.scope.get('client')}")

            # 🔧 关键修复1: 清理旧连接
            await sync_to_async(close_old_connections)()

            self.user = self.scope['user']
            if not self.user or not self.user.is_authenticated:
                logger.warning(f'未认证用户尝试连接 WebSocket: {self.scope}')
                await self.close(code=4000)
                return

            self.room_group_name = None

            if self.user.is_anonymous:
                logger.warning("Anonymous user attempting WebSocket connection")
                await self.close()
                return

            # 获取房间名
            self.room_name = self.scope['url_route']['kwargs']['room_name']
            self.room_group_name = f'chat_{self.room_name}'

            # 🔧 关键修复：初始化任务列表
            self.tasks = []
            self.heartbeat_task = None



            # 验证用户权限
            if not await self.is_user_in_room(self.room_name):
                logger.warning(f"User {self.user.username} not authorized for room {self.room_name}")
                await self.close()
                return

            # 🔧 关键修复：连接时更新并广播在线状态
            await self.update_and_broadcast_online_status(True)

            # 加入房间组
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()
            logger.info(f"WebSocket connection accepted for user {self.user.username} in room {self.room_name}")

            # 🔧 关键修复：移动端锁屏保活
            # 启动心跳任务（每30秒发送一次）发送心跳消息防止连接断开
            self.heartbeat_task = asyncio.create_task(self.send_heartbeat())
            self.tasks.append(self.heartbeat_task)

            # 发送在线用户列表
            await self.send_online_users()
        except Exception as e:
            logger.error(f"Error during WebSocket connection: {e}")
            await self.close()

    async def send_heartbeat(self):
        """每30秒发送一次心跳，防止移动端锁屏断开连接"""
        try:
            while True:
                await asyncio.sleep(30)  # 每 30 秒发送一次心跳
                try:
                    await self.send(text_data=json.dumps({
                        'type': 'heartbeat',
                        'timestamp': timezone.now().isoformat()
                    }))
                except Exception as e:
                    logger.warning(f'心跳发送失败：{e}')
                    break
        except asyncio.CancelledError:
            # 🔧 关键修复：正确处理任务取消
            logger.info(f'心跳任务已取消：user={self.user.username}')
            raise
        except Exception as e:
            logger.error(f'心跳任务异常：{e}', exc_info=True)

    # 修改 disconnect 方法
    async def disconnect(self, close_code):
        """断开连接"""
        try:
            logger.info(
                f"WebSocket disconnected for user {getattr(self.user, 'username', 'unknown')} with code {close_code}")

            # # 取消心跳任务
            # if hasattr(self, 'heartbeat_task'):
            #     self.heartbeat_task.cancel()

            # # 离开房间组
            # if self.room_group_name:
            #     await self.channel_layer.group_discard(
            #         self.room_group_name,
            #         self.channel_name
            #     )

            # # 🔧 关键修复：断开时更新并广播离线状态
            # if hasattr(self, 'user') and not self.user.is_anonymous:
            #     await self.update_and_broadcast_online_status(False)

            # 🔧 关键修复 1：取消所有后台任务
            await self.cancel_all_tasks()

            # 🔧 关键修复 2：从聊天室组移除
            if hasattr(self, 'room_group_name'):
                try:
                    await self.channel_layer.group_discard(
                        self.room_group_name,
                        self.channel_name
                    )
                except Exception as e:
                    logger.error(f'从组移除失败：{e}')

            # 🔧 关键修复 3：更新用户在线状态
            if hasattr(self, 'user') and not self.user.is_anonymous:
                await self.update_and_broadcast_online_status(False)


            # 🔧 关键修复 4：关闭数据库连接（如果使用同步 ORM）
            await self.close_database_connections()

        except Exception as e:
            logger.error(f'disconnect 异常：{e}', exc_info=True)
        finally:
            # 🔧 关键修复 5：确保连接关闭
            try:
                # 🔧 关键修复6: 清理旧连接
                await sync_to_async(close_old_connections)()
            except Exception:
                pass





    async def receive(self, text_data):
        """接收消息"""
        if self.user.is_anonymous:
            await self.close()
            return

        try:
            # 🔧 关键修复9: 清理旧连接
            await sync_to_async(close_old_connections)()

            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type', 'chat_message')

            logger.info(
                f"Received message message_type: {message_type} from {self.user} - {self.user.username}: {text_data_json}")

            if message_type == 'chat_message':
                await self.handle_chat_message(text_data_json)
            elif message_type == 'typing':
                await self.handle_typing(text_data_json)
            elif message_type == 'read_message':
                await self.handle_read_message(text_data_json)
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
            return


    async def cancel_all_tasks(self):
        """🔧 取消所有后台任务"""
        # 取消心跳任务

        if hasattr(self, 'heartbeat_task'):
            self.heartbeat_task.cancel()
            try:
                await self.heartbeat_task
            except asyncio.CancelledError:
                pass

        # if self.heartbeat_task and not self.heartbeat_task.done():
        #     self.heartbeat_task.cancel()
        #     try:
        #         await self.heartbeat_task
        #     except asyncio.CancelledError:
        #         pass

        # 取消其他任务
        if hasattr(self, 'tasks'):
            for task in self.tasks:
                if not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass

            self.tasks.clear()

    async def close_database_connections(self):
        """🔧 关键修复7: 正确关闭数据库连接（使用 sync_to_async）"""
        try:
            # 使用 sync_to_async 确保在正确线程中执行
            await sync_to_async(lambda: connection.close())()
        except Exception as e:
            logger.warning(f'关闭数据库连接失败：{e}')
        finally:
            # 清理旧连接
            await sync_to_async(close_old_connections)()


    async def send_unread_count_update(self, chat_room_id, unread_count):
        """发送未读消息数更新"""
        await self.channel_layer.group_send(
            f'user_{self.user.id}_notifications',
            {
                'type': 'unread_count_update',
                'chat_room_id': chat_room_id,
                'unread_count': unread_count
            }
        )

    async def handle_chat_message(self, data):
        """处理聊天消息"""

        if self.user.is_anonymous:
            return

        # 🔧 关键修复 1: 清理旧连接
        await sync_to_async(close_old_connections)()


        content = data.get('content', '')
        message_type = data.get('message_type', 'text')
        file_id = data.get('file_id', None)
        temp_id = data.get('temp_id')

        # 🔧 关键修复 2: 获取 chat_room 参数（前端传递的目标聊天室）
        target_room_id = data.get('chat_room')

        # 🔧 关键修复 3: 验证 chat_room 参数
        if target_room_id:
            # 验证用户是否有权限发送到该聊天室
            if not await self.is_user_in_room(str(target_room_id)):
                logger.warning(f"User {self.user.username} not authorized to send to room {target_room_id}")
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': '没有权限发送到该聊天室'
                }))
                return
            # 使用目标聊天室的 room_name
            room_name = str(target_room_id)
            room_group_name = f'chat_{room_name}'
        else:
            # 默认使用当前连接的聊天室
            room_name = self.room_name
            room_group_name = self.room_group_name

        # 🔧 新增：获取引用字段
        quote_message_id = data.get('quote_message_id')
        quote_content = data.get('quote_content')
        quote_sender = data.get('quote_sender')
        quote_sender_id = data.get('quote_sender_id')
        quote_timestamp = data.get('quote_timestamp')
        quote_message_type = data.get('quote_message_type')

        # 🔧 关键修复 4: 保存消息时使用正确的 room_name
        message = await self.save_message(
            content,
            message_type,
            file_id=file_id,
            room_name=room_name,  # 🔧 传递正确的 room_name
            quote_message_id=quote_message_id,
            quote_content=quote_content,
            quote_sender=quote_sender,
            quote_sender_id=quote_sender_id,
            quote_timestamp=quote_timestamp,
            quote_message_type=quote_message_type
        )
        logger.info(
            f'user: {self.user} file_id: {file_id} message_type: {message_type} '
            f'content: {content} temp_id: {temp_id} target_room: {room_name}'
        )

        sender = {
            'id': self.user.id,
            'username': self.user.username,
            'email': self.user.email,
            'real_name': self.user.real_name,
            'avatar': self.user.avatar.url if self.user.avatar else None,
            'is_active': self.user.is_active,
            'is_online': self.user.is_online,
        }

        # 🔧 关键修复 5: 广播消息到正确的聊天室组
        await self.channel_layer.group_send(
            room_group_name,  # 🔧 使用目标聊天室的组名
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
                'temp_id': temp_id,
                # 🔧 完整广播引用字段（接收端需要这些字段渲染引用内容）
                'quote_message_id': message.quote_message_id,
                'quote_content': message.quote_content,
                'quote_sender': message.quote_sender,
                'quote_sender_id': message.quote_sender_id,
                'quote_timestamp': message.quote_timestamp.isoformat() if message.quote_timestamp else None,
                'quote_message_type': message.quote_message_type,
                # 🔧 广播语音精确时长
                'voice_duration': message.voice_duration if hasattr(message, 'voice_duration') else None,
            }
        )

        # 🔧 关键修复 6: 发送全局通知时使用正确的 chat_room
        await self.send_global_notification({
            'type': 'new_message',
            'chat_room': message.chat_room.id,  # 🔧 使用消息实际的聊天室 ID
            'content': content,
            'sender': sender,
            'sender_name': self.user.username,
            'sender_id': self.user.id,
            'message_type': message_type,
            'file_info': message.get_file_info() if file_id else None,
            'timestamp': message.timestamp.isoformat(),
            'temp_id': temp_id,
            # 🔧 全局通知也包含引用字段
            'quote_message_id': message.quote_message_id,
            'quote_content': message.quote_content,
            'quote_sender': message.quote_sender,
            'quote_sender_id': message.quote_sender_id,
            'quote_timestamp': message.quote_timestamp.isoformat() if message.quote_timestamp else None,
            'quote_message_type': message.quote_message_type,
            # 🔧 广播语音精确时长
            'voice_duration': message.voice_duration if hasattr(message, 'voice_duration') else None,
        })

        unread_count = await self.get_unread_count(message.chat_room.id, self.user.id)
        # 发送未读数更新
        await self.send_unread_count_update(message.chat_room.id, unread_count)

        # #  🔧 关键修复 7: 发送未读数更新给接收方
        # # 获取聊天室所有成员（排除发送者）
        # chat_room = await database_sync_to_async(lambda: message.chat_room)()
        # members = await database_sync_to_async(
        #     lambda: list(chat_room.members.exclude(id=self.user.id).values_list('id', flat=True))
        # )()
        #
        # for member_id in members:
        #     # 获取该成员的未读消息数
        #     unread_count = await self.get_unread_count(chat_room.id, member_id)
        #     # 发送未读数更新
        #     await self.send_unread_count_update(message.chat_room.id, unread_count)


    @database_sync_to_async
    def get_unread_count(self, chat_room_id, user_id):
        """获取指定聊天室的未读消息数（排除自己发送的消息）"""
        logger.info(f"获取用户 {user_id} 在聊天室 {chat_room_id} 的未读消息数")
        try:
            # 验证聊天室是否存在且用户是成员
            chat_room = ChatRoom.objects.get(id=chat_room_id, members__id=user_id)

            # 获取未读消息数
            unread_count = Message.objects.select_related('sender', 'file').filter(
                chat_room=chat_room,
                is_deleted=False,
            ).exclude(
                sender__id=user_id  # 🔧 关键优化：排除用户自己发送的消息
            ).exclude(
                id__in=MessageDeleteStatus.objects.filter(
                    is_deleted=True,
                    user__id=user_id
                ).values_list('message_id', flat=True)  # 优化：只获取 ID 列表
            ).exclude(
                id__in=MessageReadStatus.objects.filter(
                    user__id=user_id
                ).values_list('message_id', flat=True)
            ).count()

            logger.info(f"用户 {user_id} 在聊天室 {chat_room_id} 的未读消息数：{unread_count}")
            return unread_count

        except ChatRoom.DoesNotExist:
            logger.warning(f"聊天室 {chat_room_id} 不存在或用户 {user_id} 不是成员")
            return 0
        except Exception as e:
            logger.error(f"获取未读消息数失败：{e}")
            return 0





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
                'chat_room_id': self.room_name,
            }
        )

    async def handle_read_message(self, data):
        """处理消息已读"""
        if self.user.is_anonymous:
            return

        message_ids = data.get('message_ids', [])

        for message_id in message_ids:
            await self.mark_message_as_read(message_id)

    # 新增：处理消息事件（包括撤销）
    async def chat_message(self, event):
        """接收聊天消息事件并转发给前端"""
        # 撤销消息处理保持不变
        if event.get('message') and event['message'].get('type') == 'message_revoked':
            message = event['message']
            await self.send(text_data=json.dumps({
                'type': 'message_revoked',
                'message_id': message['id'],
                'revoked_at': message['revoked_at'],
                'sender_id': message['sender_id'],
                'chat_room_id': message.get('chat_room_id'),
                'sender_name': message.get('sender_name'),
                'room_type': message.get('room_type'),
            }))
        else:
            # 🔧 关键修复：转发所有引用字段给前端
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
                'temp_id': event.get('temp_id'),
                # 🔧 必须转发引用字段
                'quote_message_id': event.get('quote_message_id'),
                'quote_content': event.get('quote_content'),
                'quote_sender': event.get('quote_sender'),
                'quote_sender_id': event.get('quote_sender_id'),
                'quote_timestamp': event.get('quote_timestamp'),
                'quote_message_type': event.get('quote_message_type'),
            }))

    async def user_typing(self, event):
        """接收用户输入状态事件"""
        logger.info(f"用户 {event['user_id']} 输入状态: {event['is_typing']} room_name: {self.room_name} 在聊天室 {event}")
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'is_typing': event['is_typing'],
            'chat_room_id': event.get('chat_room_id') or self.room_name,
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
    def save_message(self, content, message_type, file_id=None,
                     room_name=None,  # 🔧 新增参数
                     quote_message_id=None, quote_content=None,
                     quote_sender=None, quote_sender_id=None,
                     quote_timestamp=None, quote_message_type=None):

        # 🔧 关键修复：使用传入的 room_name 或默认的 self.room_name
        target_room_name = room_name if room_name else self.room_name
        logger.info(f'room_name: {target_room_name} file_id: {file_id} content: {content}')

        chat_room = ChatRoom.objects.get(id=target_room_name)

        # 批量恢复聊天室删除状态
        try:
            ChatRoomDeleteStatus.objects.filter(
                chat_room_id=target_room_name,
                is_deleted=True
            ).update(is_deleted=False)
        except Exception as e:
            logger.error(f"Error restoring ChatRoomDeleteStatus: {e}")

        # 创建消息
        message = Message.objects.create(
            chat_room=chat_room,
            sender=self.user,
            content=content,
            message_type=message_type
        )

        # 🔧 保存引用字段
        if quote_message_id:
            try:
                quote_message = Message.objects.get(id=quote_message_id)
                message.quote_message = quote_message
            except Message.DoesNotExist:
                pass

        if quote_content:
            message.quote_content = quote_content[:500]

        if quote_sender:
            message.quote_sender = quote_sender[:100]

        if quote_sender_id:
            message.quote_sender_id = int(quote_sender_id)

        if quote_timestamp:
            try:
                if isinstance(quote_timestamp, str):
                    message.quote_timestamp = timezone.datetime.fromisoformat(quote_timestamp.replace('Z', '+00:00'))
                else:
                    message.quote_timestamp = quote_timestamp
            except:
                message.quote_timestamp = timezone.now()

        if quote_message_type:
            message.quote_message_type = quote_message_type

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
        message.save()  # 保存所有字段
        return message

    @database_sync_to_async
    def is_user_in_room(self, room_id):
        """验证用户是否在房间中（支持转发验证）"""
        try:
            chat_room = ChatRoom.objects.get(id=room_id)
            # 🔧 关键修复：验证用户是否是聊天室成员
            return chat_room.members.filter(id=self.user.id).exists()
        except ChatRoom.DoesNotExist:
            logger.warning(f"ChatRoom {room_id} does not exist")
            return False
        except Exception as e:
            logger.error(f"Error checking room membership: {e}")
            return False

    @database_sync_to_async
    def can_send_to_room(self, room_id):
        """
        🔧 新增：验证用户是否有权限发送到指定聊天室
        支持：文件所有者、协作者、聊天室成员
        """
        try:
            # 1. 检查是否是聊天室成员
            chat_room = ChatRoom.objects.get(id=room_id)
            if chat_room.members.filter(id=self.user.id).exists():
                return True

            # 2. 检查是否是文件协作者（用于文件转发场景）
            # 注意：这里需要根据业务逻辑调整
            # if FileCollaboration.objects.filter(
            #     file_id=file_id,
            #     user=self.user,
            #     is_active=True
            # ).exists():
            #     return True

            return False
        except Exception as e:
            logger.error(f"Error checking send permission: {e}")
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
        # 🔧 关键修复：从 notification_data 获取正确的 chat_room
        chat_room_id = notification_data.get('chat_room')
        if not chat_room_id:
            logger.warning("send_global_notification: chat_room not found in notification_data")
            return

        try:
            chat_room = await database_sync_to_async(ChatRoom.objects.get)(id=chat_room_id)

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
        except ChatRoom.DoesNotExist:
            logger.warning(f"ChatRoom {chat_room_id} not found for global notification")
        except Exception as e:
            logger.error(f"Error sending global notification: {e}")


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



    # 在 NotificationConsumer 类中添加
    async def user_online_status(self, event):
        """用户在线状态变化"""
        await self.send(text_data=json.dumps({
            'type': 'user_online_status',
            'user_id': event['user_id'],
            'username': event.get('username'),
            'real_name': event.get('real_name'),
            'avatar_url': event.get('avatar_url'),
            'is_online': event['is_online'],
            'last_seen': event.get('last_seen'),
            'chat_room_id': event.get('chat_room_id')  # 可用于更新特定聊天室的状态
        }))
