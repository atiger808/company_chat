# -*- coding: utf-8 -*-
# @File   :consumers_encrypt.py
# @Time   :2026/6/10 11:20
# @Author :admin


# chat/consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from django.contrib.auth import get_user_model
from asgiref.sync import sync_to_async
from django.db import connection, close_old_connections
from accounts.models import CustomUser
from chat.models import ChatRoom, Message, FileUpload, MessageReadStatus, MessageDeleteStatus, ChatRoomDeleteStatus, \
    UserOnlineStatus
from cloud.models import CloudFile, FileCollaboration
from utils.encrypt_aes import encrypt_data, decrypt_data

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
            except Exception as e:
                logger.error(f'关闭数据库连接异常：{e}')

    async def send_encrypt(self, data):
        encrypt_str = encrypt_data(json.dumps(data, ensure_ascii=False), mode='aes')
        await self.send(text_data=json.dumps({'data': encrypt_str, 'encrypt': True}))


    async def receive(self, text_data):
        """接收消息"""
        if self.user.is_anonymous:
            await self.close()
            return

        try:
            # 🔧 关键修复9: 清理旧连接
            await sync_to_async(close_old_connections)()

            packet = json.loads(text_data)
            if 'data' in packet:
                decrypted = decrypt_data(packet['data'], mode='aes')
                data_json = json.loads(decrypted)
            else:
                data_json = packet

            msg_type = data_json.get('type', 'chat_message')
            logger.info(
                f"Received msg msg_type: {msg_type} from {self.user} - {self.user.username}: {data_json}")

            if msg_type == 'chat_message':
                await self.handle_chat_message(data_json)
            elif msg_type == 'typing':
                await self.handle_typing(data_json)
            elif msg_type == 'read_message':
                await self.handle_read_message(data_json)
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
            return
        except Exception as e:
            logger.error(f"WebSocket receive error: {e}")

    async def cancel_all_tasks(self):
        """🔧 取消所有后台任务"""
        # 取消心跳任务（heartbeat_task 可能为 None：连接在心跳启动前就失败时）

        if hasattr(self, 'heartbeat_task') and self.heartbeat_task:
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
                if not task.done() and hasattr(task, 'cancel'):
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

        mentioned_user_ids = data.get('mentioned_users', [])
        if isinstance(mentioned_user_ids, str):
            try:
                mentioned_user_ids = json.loads(mentioned_user_ids)
            except:
                mentioned_user_ids = []

        mentioned_all = data.get('mentioned_all', False)

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
            quote_message_type=quote_message_type,
            mentioned_user_ids=mentioned_user_ids,  # 🔧 传入
            mentioned_all=mentioned_all  # 🔧 传入
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
                'mentioned_users': mentioned_user_ids,
                'mentioned_all': message.mentioned_all,
                'is_mention_all': '@所有人' in content,  # 或判断 mentioned_users 是否覆盖全员
                'temp_id': temp_id,
                # 🔧 完整广播引用字段（接收端需要这些字段渲染引用内容）
                'quote_message_id': message.quote_message_id,
                'quote_content': message.quote_content,
                'quote_sender': message.quote_sender,
                'quote_sender_id': message.quote_sender_id,
                'quote_timestamp': message.quote_timestamp.isoformat() if message.quote_timestamp else None,
                'quote_message_type': message.quote_message_type,
                'quote_file_info': data.get('quote_file_info'),  # 🔧 新增
                # 🔧 广播语音精确时长
                'voice_duration': message.voice_duration if hasattr(message, 'voice_duration') else None,
                'call_duration': message.call_duration if hasattr(message,
                                                                  'call_duration') and message.call_type else None,
            }
        )

        # 🔧 关键修复 6: 发送全局通知时使用正确的 chat_room
        await self.send_global_notification({
            'type': 'new_message',
            'chat_room': message.chat_room.id,  # 🔧 使用消息实际的聊天室 ID
            'message_id': message.id,
            'content': content,
            'sender': sender,
            'sender_name': self.user.username,
            'sender_id': self.user.id,
            'message_type': message_type,
            'mentioned_users': mentioned_user_ids,
            'mentioned_all': message.mentioned_all,
            'is_mention_all': '@所有人' in content,  # 或判断 mentioned_users 是否覆盖全员
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
            'quote_file_info': data.get('quote_file_info'),  # 🔧 新增
            # 🔧 广播语音精确时长
            'voice_duration': message.voice_duration if hasattr(message, 'voice_duration') else None,
            'call_duration': message.call_duration if hasattr(message, 'call_duration') and message.call_type else None,
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
            await self.send_encrypt({
                'type': 'message_revoked',
                'message_id': message['id'],
                'revoked_at': message['revoked_at'],
                'sender_id': message['sender_id'],
                'chat_room_id': message.get('chat_room_id'),
                'sender_name': message.get('sender_name'),
                'room_type': message.get('room_type'),
            })
        else:
            # 🔧 关键修复：转发所有引用字段给前端
            await self.send_encrypt({
                'type': 'chat_message',
                'chat_room': event.get('chat_room'),
                'message_id': event.get('message_id'),
                'is_read': event.get('is_read'),
                'sender': event.get('sender'),
                'sender_id': event.get('sender_id'),
                'sender_name': event.get('sender_name'),
                'content': event.get('content'),
                'message_type': event.get('message_type'),
                'file_info': event.get('file_info'),
                'timestamp': event.get('timestamp'),
                'temp_id': event.get('temp_id'),
                # 🔧 必须转发引用字段
                'quote_message_id': event.get('quote_message_id'),
                'quote_content': event.get('quote_content'),
                'quote_sender': event.get('quote_sender'),
                'quote_sender_id': event.get('quote_sender_id'),
                'quote_timestamp': event.get('quote_timestamp'),
                'quote_message_type': event.get('quote_message_type'),
                'quote_file_info': event.get('quote_file_info'),  # 🔧 新增
                'call_duration': event.get('call_duration'),
                'task_data': event.get('task_data'),
            })

    # 👇 新增：处理任务更新事件
    async def task_update(self, event):
        """
        接收任务更新事件并转发给前端（加密传输）
        对应 tasks/views.py 中 channel_layer.group_send 的 type: 'task.update'
        """
        await self.send_encrypt({
            'type': 'task.update',
            'event': event.get('event'),
            'task': event.get('task')
        })

    async def user_typing(self, event):
        """接收用户输入状态事件"""
        logger.info(
            f"用户 {event['user_id']} 输入状态: {event['is_typing']} room_name: {self.room_name} 在聊天室 {event}")
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
                     quote_timestamp=None, quote_message_type=None,
                     mentioned_user_ids=None, mentioned_all=False):

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
            mentioned_all=mentioned_all,
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
            message.quote_content = quote_content[:]

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

        # 🔧 新增：保存@提及用户（严格校验：必须是当前聊天室成员）
        if mentioned_user_ids and isinstance(mentioned_user_ids, list):
            # 过滤出有效的、且属于该聊天室的用户ID
            valid_users = chat_room.members.filter(id__in=mentioned_user_ids)
            message.mentioned_users.set(valid_users)
            logger.info(f"Message {message.id} mentioned users: {list(valid_users.values_list('id', flat=True))}")

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

            from django.conf import settings as dj_settings
            push_enabled = dj_settings.PUSH_ENABLED
            # 推送载荷只需构建一次（发送者固定）
            push_payload = None
            if push_enabled:
                from .push_utils import build_chat_push_payload
                try:
                    push_payload = await database_sync_to_async(
                        lambda: build_chat_push_payload(notification_data, self.user)
                    )()
                except Exception as e:
                    logger.warning(f"构建推送载荷失败: {e}")
                    push_payload = None

            for member in members:
                if member.id == self.user.id:
                    continue  # 跳过发送者

                # 发送通知到用户的全局通知组（页面在线时即时展示）
                group_name = f'user_{member.id}_notifications'
                await self.channel_layer.group_send(
                    group_name,
                    notification_data
                )
                # 一律异步发送 Web Push：只要 PUSH_ENABLED，目标用户的每个设备订阅都会收到推送，
                # 无论其是否在线/后台/锁屏/回到主屏幕。SW 收到推送后一律展示系统通知（不去重）。
                # urgent=True → urgency=high（APNs priority 10）：即时送达，避免 iOS 低功耗/省电模式批量延迟推送。
                if push_enabled and push_payload:
                    try:
                        from .tasks import send_push_task
                        send_push_task.delay(member.id, push_payload, ttl=43200, urgent=True)
                    except Exception as e:
                        logger.warning(f"推送聊天通知失败 user={member.id}: {e}")
        except ChatRoom.DoesNotExist:
            logger.warning(f"ChatRoom {chat_room_id} not found for global notification")
        except Exception as e:
            logger.error(f"Error sending global notification: {e}")


# chat/consumers.py

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

            # 🔧 补发待接听的来电：用户后台/锁屏期间错过了 call_offer，
            # 重新打开 App 连上本 WS 后把保存的来电 offer 发给前端，弹出接听提示框。
            try:
                from django.core.cache import cache
                pending = cache.get(f'pending_call_{self.user.id}')
                if pending:
                    cache.delete(f'pending_call_{self.user.id}')
                    await self.send(text_data=json.dumps(pending))
                    logger.info(f"📞 补发待接听来电 user={self.user.id}")
            except Exception as e:
                logger.warning(f"补发待接听来电失败: {e}")

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
        try:
            data = json.loads(text_data)
            # 🔧 前端打开/回到前台时主动查询待接听来电
            if data.get('type') == 'check_pending_call':
                from django.core.cache import cache
                pending = cache.get(f'pending_call_{self.user.id}')
                if pending:
                    cache.delete(f'pending_call_{self.user.id}')
                    await self.send(text_data=json.dumps(pending))
                    logger.info(f"📞 查询待接听来电成功 user={self.user.id}")
        except Exception:
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
            'mentioned_users': event.get('mentioned_users', []),
            'mentioned_all': event.get('mentioned_all', False),
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

    async def call_offer(self, event):
        """处理来电邀请信令"""
        await self.send(text_data=json.dumps({
            'type': 'call_offer',
            'data': event.get('data', {}),
            'from_user': event.get('from_user'),
            'room_id': event.get('room_id'),
            'media_type': event.get('media_type', 'audio'),
        }))

    async def collaboration_invite(self, event):
        """处理协作邀请通知（来自云盘文档）"""
        await self.send(text_data=json.dumps({
            'type': 'collaboration_invite',
            'file_id': event['file_id'],
            'file_name': event['file_name'],
            'mime_type': event.get('mime_type', ''),
            'icon_class': event.get('icon_class', 'fa-file'),
            'inviter_id': event['inviter_id'],
            'inviter_username': event['inviter_username'],
            'inviter_real_name': event.get('inviter_real_name', event['inviter_username']),
            'inviter_avatar': event.get('inviter_avatar', ''),
            'permission': event['permission'],
            'permission_display': event.get('permission_display', event['permission']),
            'editor_url': event.get('editor_url', ''),
            'timestamp': event['timestamp'],
        }))

    async def call_end(self, event):
        """处理挂断信令（转发给前端）"""
        try:
            from_user_id = event.get('from_user_id')

            # 🔧 关键修复1：避免处理自己发送的消息（防止死循环）
            if from_user_id == self.user.id:
                logger.debug(f"⏭️ 忽略自己发送的 call_end: user={self.user.id}")
                return

            # 🔧 关键修复2：如果消息已经被 CallConsumer 处理过，不再重复转发
            if event.get('_processed_by_call_consumer'):
                logger.debug(f"⏭️ 消息已被 CallConsumer 处理，跳过: user={self.user.id}")
                return

            logger.info(f"🔚 NotificationConsumer 转发 call_end: user={self.user.id}, from={from_user_id}")
            await self.send(text_data=json.dumps({
                'type': 'call_end',
                'from_user_id': from_user_id,
                'room_id': event.get('room_id'),
                'data': event.get('data', {}),
                'reason': event.get('reason', 'ended'),
            }))
        except Exception as e:
            logger.error(f"call_end forward failed: {e}")

    async def call_reject(self, event):
        """处理拒绝信令（转发给前端）"""
        try:
            await self.send(text_data=json.dumps({
                'type': 'call_reject',
                'from_user_id': event.get('from_user_id'),
                'room_id': event.get('room_id'),
            }))
        except Exception as e:
            logger.error(f"call_reject forward failed: {e}")

    async def ice_candidate(self, event):
        """处理 ICE candidate 信令（转发给前端）"""
        try:
            candidate = event.get('candidate')
            if not candidate:
                logger.warning(f"⚠️ ice_candidate 事件中缺少 candidate 数据: {event}")
                return

            await self.send(text_data=json.dumps({
                'type': 'ice_candidate',
                'candidate': candidate,
                'from_user_id': event.get('from_user_id'),
            }))
        except Exception as e:
            logger.error(f"ice_candidate forward failed: {e}", exc_info=True)

    async def call_answer(self, event):
        """处理接听信令（转发给前端）- 通知组回退"""
        try:
            await self.send(text_data=json.dumps({
                'type': 'call_answer',
                'data': event.get('data', {}),
                'from_user_id': event.get('from_user_id'),
                'room_id': event.get('room_id'),
                'valid': event.get('valid', True),
            }))
        except Exception as e:
            logger.error(f"call_answer forward failed in NotificationConsumer: {e}")

    async def call_missed(self, event):
        """处理未接听信令（转发给前端）- 通知组回退"""
        try:
            await self.send(text_data=json.dumps({
                'type': 'call_missed',
                'from_user_id': event.get('from_user_id'),
            }))
        except Exception as e:
            logger.error(f"call_missed forward failed in NotificationConsumer: {e}")

    async def task_notification(self, event):
        """处理任务通知消息"""
        await self.send(text_data=json.dumps({
            'type': 'task.notification',
            'event_type': event.get('event_type'),
            'task': event.get('task')
        }))

    async def work_notification(self, event):
        """处理工作通知消息（审批、考勤等）"""
        await self.send(text_data=json.dumps({
            'type': 'work.notification',
            'event_type': event.get('event_type'),
            'notification': event.get('notification'),
        }))


# chat/consumers.py - 添加 CallConsumer 类

class CallConsumer(AsyncWebsocketConsumer):
    """通话信令 WebSocket 消费者"""

    async def connect(self):
        """建立通话信令连接"""
        try:
            logger.info(f"CallConsumer connect attempt: {self.scope}")
            await sync_to_async(close_old_connections)()

            self.user = self.scope['user']
            if not self.user or not self.user.is_authenticated:
                await self.close(code=4001)
                return

            self.room_id = self.scope['url_route']['kwargs'].get('room_id')
            if not self.room_id:
                await self.close(code=4002)
                return

            # 验证 room_id 格式
            try:
                room_id_int = int(self.room_id) if isinstance(self.room_id,
                                                              str) and self.room_id.isdigit() else self.room_id
            except (ValueError, TypeError):
                await self.close(code=4002)
                return

            # 验证用户权限
            if not await self.is_user_in_room(room_id_int):
                await self.send(text_data=json.dumps({
                    'type': 'error', 'message': '无权访问该通话', 'code': 4003
                }))
                await self.close(code=4003)
                return

            # 🔧 关键修复1: 加入通话信令组（每个用户独立的通话组）
            self.call_group_name = f'call_{self.user.id}'
            await self.channel_layer.group_add(self.call_group_name, self.channel_name)

            # 🔧 关键修复2: 【恢复】也加入用户通知组，确保能收到通话信令
            # 注意：虽然会收到聊天消息，但 CallConsumer 只处理通话相关的消息类型
            self.notification_group_name = f'user_{self.user.id}_notifications'
            await self.channel_layer.group_add(self.notification_group_name, self.channel_name)

            await self.accept()
            logger.info(f"✅ CallConsumer 连接成功: user={self.user.username}, room={self.room_id}")

        except Exception as e:
            logger.error(f"CallConsumer connect error: {e}", exc_info=True)
            await self.close(code=4000)

    async def disconnect(self, close_code):
        """断开连接"""
        try:
            # 离开通话信令组
            if hasattr(self, 'call_group_name'):
                await self.channel_layer.group_discard(self.call_group_name, self.channel_name)

            # 🔧 关键修复: 【恢复】也离开用户通知组
            if hasattr(self, 'notification_group_name'):
                await self.channel_layer.group_discard(self.notification_group_name, self.channel_name)

            logger.info(f"CallConsumer disconnected: user={getattr(self.user, 'username', 'unknown')}")
        except Exception as e:
            logger.error(f"CallConsumer disconnect error: {e}")

    async def receive(self, text_data):
        """接收信令消息"""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            logger.info(f"📨 收到信令: type={message_type}, from={self.user.id}")

            if message_type == 'call_offer':
                await self.handle_call_offer(data)
            elif message_type == 'call_answer':
                await self.handle_call_answer(data)
            elif message_type == 'call_end':
                await self.handle_call_end(data)
            elif message_type == 'ice_candidate':
                await self.handle_ice_candidate(data)
            elif message_type == 'call_reject':
                await self.handle_call_reject(data)
            elif message_type == 'call_missed':  # 🔧 新增：处理未接听信令
                await self.handle_call_missed(data)
            # 🔧 关键修复：忽略非通话相关的消息（如 new_message, heartbeat 等）
            # CallConsumer 只处理通话信令，其他消息由 NotificationConsumer 处理

        except json.JSONDecodeError:
            logger.error("Invalid JSON in CallConsumer")
        except Exception as e:
            logger.error(f"CallConsumer receive error: {e}", exc_info=True)

    # 🔧 修复 call_answer 事件处理器 - 确保正确传递 SDP 数据
    async def call_answer(self, event):
        """处理接听信令（转发给前端）"""
        try:
            data_payload = event.get('data', {})

            # 🔧 关键修复：确保 SDP 数据完整
            sdp_data = data_payload.get('sdp') if isinstance(data_payload, dict) else None
            sdp_type = data_payload.get('type') if isinstance(data_payload, dict) else None

            # 如果 SDP 数据无效，记录日志但不发送错误数据
            if not sdp_data or not sdp_type:
                logger.warning(f"⚠️ Invalid SDP in call_answer: sdp_type={sdp_type}, has_sdp={bool(sdp_data)}")
                # 仍发送信令，但标记为无效，让前端处理降级
                await self.send(text_data=json.dumps({
                    'type': 'call_answer',
                    'data': {
                        'sdp': sdp_data,
                        'type': sdp_type,
                    },
                    'from_user_id': event.get('from_user_id'),
                    'room_id': event.get('room_id'),
                    'valid': bool(sdp_data and sdp_type),  # 🔧 新增：标记数据是否有效
                }))
                return

            await self.send(text_data=json.dumps({
                'type': 'call_answer',
                'data': {
                    'sdp': sdp_data,
                    'type': sdp_type,  # 'answer'
                },
                'from_user_id': event.get('from_user_id'),
                'room_id': event.get('room_id'),
                'valid': True,
            }))
        except Exception as e:
            logger.error(f"❌ call_answer send failed: {e}", exc_info=True)
            # 发送错误通知
            await self.send(text_data=json.dumps({
                'type': 'call_error',
                'message': '接听信令处理失败',
                'error': str(e),
            }))

    # 🔧 同样修复 call_offer 事件处理器
    async def call_offer(self, event):
        """处理来电邀请信令（转发给前端）"""
        try:
            data_payload = event.get('data', {})
            sdp_data = data_payload.get('sdp') if isinstance(data_payload, dict) else None
            sdp_type = data_payload.get('type') if isinstance(data_payload, dict) else None

            await self.send(text_data=json.dumps({
                'type': 'call_offer',
                'data': {
                    'sdp': sdp_data,
                    'type': sdp_type,  # 'offer'
                },
                'from_user': {
                    'id': event.get('from_user_id'),
                    'username': event.get('from_username'),
                    'real_name': event.get('from_real_name'),
                    'avatar_url': event.get('from_avatar_url'),
                },
                'room_id': event.get('room_id'),
                'media_type': event.get('media_type', 'audio'),
                'valid': bool(sdp_data and sdp_type),  # 🔧 标记数据有效性
            }))
        except Exception as e:
            logger.error(f"❌ call_offer send failed: {e}", exc_info=True)

    async def call_end(self, event):
        """处理挂断信令（转发给前端）"""
        try:
            from_user_id = event.get('from_user_id')
            room_id = event.get('room_id')

            # 🔧 关键修复1：避免处理自己发送的消息（防止死循环）
            if from_user_id == self.user.id:
                logger.debug(f"⏭️ CallConsumer 忽略自己发送的 call_end: user={self.user.id}")
                return

            # 🔧 关键修复2：如果消息已经被处理过，不再重复转发
            if event.get('_processed_by_call_consumer'):
                logger.debug(f"⏭️ CallConsumer 跳过已处理的消息: user={self.user.id}")
                return

            logger.info(f"📤 CallConsumer 转发 call_end 到前端: user={self.user.id}, from={from_user_id}")

            # 🔧 关键修复3：直接发送给前端，不再通过 group_send
            await self.send(text_data=json.dumps({
                'type': 'call_end',
                'from_user_id': from_user_id,
                'room_id': room_id,
                'data': event.get('data', {}),
                'reason': event.get('reason', 'ended'),
            }))

            logger.info(f"✅ call_end 已发送给前端 user={self.user.id}")

        except Exception as e:
            logger.error(f"❌ call_end send failed: {e}", exc_info=True)

    async def ice_candidate(self, event):
        """处理 ICE candidate 信令（转发给前端）"""
        try:
            candidate = event.get('candidate')
            if not candidate:
                logger.warning(f"⚠️ ice_candidate 事件中缺少 candidate 数据: {event}")
                return

            await self.send(text_data=json.dumps({
                'type': 'ice_candidate',
                'candidate': candidate,  # 🔧 直接传递 candidate 对象
                'from_user_id': event.get('from_user_id'),
            }))
        except Exception as e:
            logger.error(f"ice_candidate send failed: {e}", exc_info=True)

    async def call_reject(self, event):
        """处理拒绝信令（转发给前端）"""
        try:
            await self.send(text_data=json.dumps({
                'type': 'call_reject',
                'from_user_id': event.get('from_user_id'),
            }))
        except Exception as e:
            logger.error(f"call_reject send failed: {e}")

    async def call_missed(self, event):  # 🔧 新增：处理未接听信令
        """处理未接听信令（转发给前端）"""
        try:
            await self.send(text_data=json.dumps({
                'type': 'call_missed',
                'from_user_id': event.get('from_user_id'),
            }))
        except Exception as e:
            logger.error(f"call_missed send failed: {e}")

    async def new_message(self, event):
        """🔧 新增：处理新消息事件（避免报错）"""
        # CallConsumer 不需要处理普通消息，直接忽略
        # 这些消息应该由 NotificationConsumer 处理
        logger.debug(f"⏭️ CallConsumer 忽略 new_message 事件")
        pass

    async def user_online_status(self, event):
        """🔧 新增：处理用户在线状态事件（避免报错）"""
        # CallConsumer 不需要处理在线状态，直接忽略
        # 这些消息应该由 NotificationConsumer 处理
        logger.debug(f"⏭️ CallConsumer 忽略 user_online_status 事件")
        pass

    # ============ 信令转发逻辑 ============

    async def handle_call_offer(self, data):
        """转发来电邀请给目标用户"""
        target_id = data.get('to')
        if not target_id or target_id == self.user.id:
            return

        # 🔧 关键修复：同时发送到通话信令组和通知组，确保用户能收到来电
        call_group = f'call_{target_id}'
        notification_group = f'user_{target_id}_notifications'

        logger.info(f"📤 转发 call_offer 到组: {call_group} 和 {notification_group}, to: {target_id}")

        message_data = {
            'type': 'call_offer',
            'data': data,
            'from_user_id': self.user.id,
            'from_username': self.user.username,
            'from_real_name': self.user.real_name,
            'from_avatar_url': self.user.avatar.url if self.user.avatar else None,
            'from_user': {
                'id': self.user.id,
                'username': self.user.username,
                'real_name': self.user.real_name,
                'avatar_url': self.user.avatar.url if self.user.avatar else None,
            },
            'room_id': self.room_id,
            'media_type': data.get('media_type', 'audio'),
            '_from_call_consumer': True,  # 🔧 新增：标记来源，用于前端去重
        }

        # 🔧 发送到通话信令组
        await self.channel_layer.group_send(call_group, message_data)
        logger.info(f"✅ call_offer 已发送到通话组 {call_group}")

        # 🔧 发送到通知组（用于来电提醒，即使 callWs 未连接也能收到）
        await self.channel_layer.group_send(notification_group, message_data)
        logger.info(f"✅ call_offer 已发送到通知组 {notification_group}")

        # 🔧 保存待接听的来电（限时 90 秒），用户后台/锁屏期间 WS 断开时，
        # 重新打开 App 连上通知 WS 后会补发该来电，从而弹出接听提示框。
        try:
            from django.core.cache import cache
            cache.set(f'pending_call_{target_id}', message_data, timeout=90)
        except Exception as e:
            logger.warning(f'保存待接听来电失败: {e}')

        # 🔧 发送 Web Push 来电提醒（后台/锁屏也能收到，即使 WS 断开）
        if settings.PUSH_ENABLED:
            try:
                from .push_utils import build_call_push_payload
                from .tasks import send_push_task
                media_type = data.get('media_type', 'audio')
                payload = await database_sync_to_async(
                    lambda: build_call_push_payload(self.room_id, self.user, media_type)
                )()
                try:
                    target_int = int(target_id)
                except (TypeError, ValueError):
                    target_int = target_id
                send_push_task.delay(target_int, payload, ttl=120, urgent=True)
                logger.info(f"📞 已发送来电 Web Push to user={target_int}, media_type={media_type}")
            except Exception as e:
                logger.warning(f"来电 Web Push 失败 user={target_id}: {e}")

    async def handle_call_answer(self, data):
        target_id = data.get('to')
        if not target_id or target_id == self.user.id:
            return

        # 🔧 确保 data 中包含完整的 SDP 对象
        sdp_payload = data.get('sdp')
        if not sdp_payload or not isinstance(sdp_payload, dict):
            logger.error(f"❌ Invalid SDP payload: {sdp_payload}")
            return

        # 🔧 关键修复：同时发送到通话信令组和通知组
        call_group = f'call_{target_id}'
        notification_group = f'user_{target_id}_notifications'

        message_data = {
            'type': 'call_answer',
            'data': {
                'type': sdp_payload.get('type'),  # 必须是 'answer'
                'sdp': sdp_payload.get('sdp'),  # SDP 字符串
            },
            'from_user_id': self.user.id,
            'room_id': data.get('room_id'),
        }

        await self.channel_layer.group_send(call_group, message_data)
        await self.channel_layer.group_send(notification_group, message_data)

    async def handle_call_end_v1(self, data):
        """转发挂断信令（修复版）"""
        target_id = data.get('to')
        if not target_id or target_id == self.user.id:
            logger.error(f"❌ 无效的 target_id: {target_id}")
            return

        logger.info(f"📤 转发 call_end 信令: from={self.user.id} to={target_id}")

        # 🔧 关键修复：转发到目标用户的专属通话信令组
        await self.channel_layer.group_send(
            f'call_{target_id}',  # ✅ 必须是 call_{user_id}，与 connect 中注册的组一致
            {
                'type': 'call_end',  # ✅ 必须与前端事件处理器方法名一致
                'from_user_id': self.user.id,
                'room_id': self.room_id,
            }
        )
        logger.info(f"✅ call_end 已转发给用户 {target_id}")

    async def handle_call_end(self, data):
        """转发挂断信令"""
        room_id = data.get('room_id')
        from_user_id = data.get('from_user_id') or self.user.id
        duration = data.get('duration', 0)
        media_type = data.get('media_type', 'audio')
        reason = data.get('reason', 'ended')

        if not room_id:
            logger.error(f"❌ call_end 缺少 room_id: {data}")
            return

        # 🔧 关键修复：记录通话时长信息，用于调试
        logger.info(
            f"📤 转发 call_end 信令: from={from_user_id}, room={room_id}, duration={duration}s, media_type={media_type}, reason={reason}")

        try:
            from chat.models import ChatRoom
            chat_room = await database_sync_to_async(ChatRoom.objects.get)(id=room_id)
            members = await database_sync_to_async(list)(chat_room.members.exclude(id=from_user_id))

            # 🔧 关键修复：创建通话记录消息（使用实际的发起方）
            await self.create_call_record_message(
                room_id=room_id,
                from_user_id=from_user_id,  # 🔧 确保使用正确的发起方 ID
                duration=duration,
                media_type=media_type,
                reason=reason
            )

            for member in members:
                # 🔧 关键修复：同时发送到通话信令组和通知组
                call_group = f'call_{member.id}'
                notification_group = f'user_{member.id}_notifications'

                message_data = {
                    'type': 'call_end',
                    'from_user_id': from_user_id,
                    'room_id': room_id,
                    'reason': data.get('reason', 'ended'),
                    'data': data.get('data', {})
                }

                await self.channel_layer.group_send(call_group, message_data)
                await self.channel_layer.group_send(notification_group, message_data)
                logger.info(f"✅ call_end 已发送到 {call_group} 和 {notification_group}")

                # 🔧 通话已结束，清除该成员的待接听来电，避免重复弹出
                try:
                    from django.core.cache import cache
                    cache.delete(f'pending_call_{member.id}')
                except Exception:
                    pass

        except Exception as e:
            logger.error(f"❌ 转发 call_end 失败: {e}", exc_info=True)

    async def handle_ice_candidate(self, data):
        """转发 ICE candidate"""
        target_id = data.get('to')
        if not target_id or target_id == self.user.id:
            # 🔧 优化日志：只在debug级别记录，避免刷屏
            logger.debug(f"⏭️ 忽略无效的 ICE candidate 转发: target_id={target_id}, from={self.user.id}")
            return

        # 🔧 关键修复：提取 candidate 数据
        candidate = data.get('candidate')
        if not candidate:
            logger.warning(f"⚠️ ICE candidate 数据缺失: {data}")
            return

        logger.info(
            f"📤 转发 ICE candidate: from={self.user.id} to={target_id}, type={candidate.get('type', 'unknown')}")

        # 🔧 关键修复：同时发送到通话信令组和通知组
        call_group = f'call_{target_id}'
        notification_group = f'user_{target_id}_notifications'

        message_data = {
            'type': 'ice_candidate',
            'candidate': candidate,  # 🔧 直接传递 candidate 对象
            'from_user_id': self.user.id,
        }

        await self.channel_layer.group_send(call_group, message_data)
        await self.channel_layer.group_send(notification_group, message_data)
        logger.info(f"✅ ICE candidate 已转发给用户 {target_id}（通话组+通知组）")

    async def handle_call_reject(self, data):
        """转发拒绝信令（修复版）"""
        target_id = data.get('to')
        from_user_id = data.get('from_user_id') or self.user.id
        room_id = data.get('room_id') or self.room_id
        media_type = data.get('media_type', 'audio')  # 🔧 提取media_type

        if not target_id or target_id == self.user.id:
            return

        logger.info(
            f"📤 转发 call_reject 信令: from={from_user_id} to={target_id}, room={room_id}, media_type={media_type}")

        # 🔧 关键修复：创建通话记录消息（已拒绝）- 使用实际的发起方
        await self.create_call_record_message(
            room_id=room_id,
            from_user_id=from_user_id,  # 🔧 确保使用正确的发起方 ID
            duration=0,  # 拒绝时时长为0
            media_type=media_type,  # 🔧 使用实际的media_type
            reason='rejected'
        )

        # 🔧 关键修复：同时发送到通话信令组和通知组
        call_group = f'call_{target_id}'
        notification_group = f'user_{target_id}_notifications'

        message_data = {
            'type': 'call_reject',
            'from_user_id': from_user_id,
            'room_id': room_id,
        }

        await self.channel_layer.group_send(call_group, message_data)
        await self.channel_layer.group_send(notification_group, message_data)
        try:
            from django.core.cache import cache
            cache.delete(f'pending_call_{target_id}')
        except Exception:
            pass

    async def handle_call_missed(self, data):  # 🔧 新增：处理未接听信令
        """转发未接听信令"""
        target_id = data.get('to')
        from_user_id = data.get('from_user_id') or self.user.id
        room_id = data.get('room_id') or self.room_id
        media_type = data.get('media_type', 'audio')  # 🔧 提取media_type

        if not target_id or target_id == self.user.id:
            return

        logger.info(
            f"📤 转发 call_missed 信令: from={from_user_id} to={target_id}, room={room_id}, media_type={media_type}")

        # 🔧 关键修复：创建通话记录消息（未接听）- 使用实际的发起方
        await self.create_call_record_message(
            room_id=room_id,
            from_user_id=from_user_id,  # 🔧 确保使用正确的发起方 ID
            duration=0,  # 未接听时时长为0
            media_type=media_type,  # 🔧 使用实际的media_type
            reason='missed'
        )

        # 🔧 关键修复：同时发送到通话信令组和通知组
        call_group = f'call_{target_id}'
        notification_group = f'user_{target_id}_notifications'

        message_data = {
            'type': 'call_missed',
            'from_user_id': from_user_id,
            'room_id': room_id,
        }

        await self.channel_layer.group_send(call_group, message_data)
        await self.channel_layer.group_send(notification_group, message_data)
        try:
            from django.core.cache import cache
            cache.delete(f'pending_call_{target_id}')
        except Exception:
            pass

    async def create_call_record_message(self, room_id, from_user_id, duration=0, media_type='audio', reason='ended'):
        """🔧 新增：创建通话记录消息（只创建一条）"""
        try:
            from chat.models import ChatRoom, Message
            from django.contrib.auth import get_user_model

            User = get_user_model()

            # 🔧 关键修复：记录接收到的参数
            logger.info(
                f"📞 创建通话记录: room={room_id}, from={from_user_id}, duration={duration}s, media_type={media_type}, reason={reason}")

            # 获取聊天室
            chat_room = await database_sync_to_async(ChatRoom.objects.get)(id=room_id)

            # 确定通话状态
            if reason == 'rejected':
                call_status = 'rejected'
            elif reason == 'missed':
                call_status = 'missed'
            elif reason == 'cancelled':
                call_status = 'cancelled'
            else:
                call_status = 'completed'

            # 确定消息类型
            message_type = 'call_video' if media_type == 'video' else 'call_audio'

            # 🔧 关键修复：只创建一条通话记录消息（而不是为每个成员创建）
            # 构建消息内容（类似微信的显示格式）
            if call_status == 'completed':
                # 已完成的通话，显示时长
                minutes = duration // 60
                seconds = duration % 60
                if minutes > 0:
                    content = f"{'视频通话' if media_type == 'video' else '语音通话'} {minutes}:{seconds:02d}"
                else:
                    content = f"{'视频通话' if media_type == 'video' else '语音通话'} {seconds}秒"
            elif call_status == 'missed':
                content = f"未接听{'视频通话' if media_type == 'video' else '语音通话'}"
            elif call_status == 'rejected':
                content = f"已拒绝{'视频通话' if media_type == 'video' else '语音通话'}"
            elif call_status == 'cancelled':
                content = f"已取消{'视频通话' if media_type == 'video' else '语音通话'}"
            else:
                content = f"{'视频通话' if media_type == 'video' else '语音通话'}"

            # 🔧 创建单条消息记录
            message = await database_sync_to_async(Message.objects.create)(
                chat_room=chat_room,
                sender_id=from_user_id,  # 使用发起通话的用户作为发送者
                content=content,
                message_type=message_type,
                call_duration=duration if call_status == 'completed' else 0,
                call_type=media_type,
                call_status=call_status
            )

            message.chat_room.updated_at = timezone.now()
            await database_sync_to_async(message.chat_room.save)()
            await database_sync_to_async(message.save)()

            logger.info(
                f"✅ 通话记录消息已创建: message_id={message.id}, room={room_id}, status={call_status}, duration={message.call_duration}s")

            # 广播消息到聊天室
            sender = await database_sync_to_async(User.objects.get)(id=from_user_id)
            await self.channel_layer.group_send(
                f'chat_{room_id}',
                {
                    'type': 'chat_message',
                    'chat_room': room_id,
                    'message_id': str(message.id),
                    'is_read': False,
                    'sender': {
                        'id': sender.id,
                        'username': sender.username,
                        'email': sender.email,
                        'real_name': sender.real_name,
                        'avatar': sender.avatar.url if sender.avatar else None,
                        'is_active': sender.is_active,
                        'is_online': sender.is_online,
                    },
                    'sender_id': from_user_id,
                    'sender_name': sender.username,
                    'content': content,
                    'message_type': message_type,
                    'file_info': None,
                    'timestamp': message.timestamp.isoformat(),
                    'mentioned_users': [],
                    'mentioned_all': False,
                    'is_mention_all': False,
                    'temp_id': None,
                    'quote_message_id': None,
                    'quote_content': None,
                    'quote_sender': None,
                    'quote_sender_id': None,
                    'quote_timestamp': None,
                    'quote_message_type': None,
                    'quote_file_info': None,
                    'voice_duration': None,
                    # 🔧 新增：通话相关字段
                    'call_duration': message.call_duration,
                    'call_type': message.call_type,
                    'call_status': message.call_status,
                }
            )

            # 发送全局通知
            await self.send_global_notification_for_call(
                room_id=room_id,
                message=message,
                sender=sender,
                content=content,
                message_type=message_type
            )

        except Exception as e:
            logger.error(f"❌ 创建通话记录消息失败: {e}", exc_info=True)

    async def send_global_notification_for_call(self, room_id, message, sender, content, message_type):
        """🔧 新增：发送通话记录的全局通知"""
        try:
            from chat.models import ChatRoom

            chat_room = await database_sync_to_async(ChatRoom.objects.get)(id=room_id)
            members = await database_sync_to_async(list)(chat_room.members.exclude(id=sender.id))

            from django.conf import settings as dj_settings
            push_enabled = dj_settings.PUSH_ENABLED
            push_payload = None
            if push_enabled:
                from .push_utils import build_chat_push_payload
                nd = {
                    'type': 'new_message',
                    'chat_room': room_id,
                    'message_id': message.id,
                    'content': content,
                    'message_type': message_type,
                    'call_status': message.call_status,
                }
                try:
                    push_payload = await database_sync_to_async(
                        lambda: build_chat_push_payload(nd, sender)
                    )()
                except Exception as e:
                    logger.warning(f"构建通话推送载荷失败: {e}")
                    push_payload = None
            urgent = push_enabled and message.call_status == 'missed'

            for member in members:
                group_name = f'user_{member.id}_notifications'
                await self.channel_layer.group_send(
                    group_name,
                    {
                        'type': 'new_message',
                        'chat_room': room_id,
                        'message_id': message.id,
                        'content': content,
                        'sender': {
                            'id': sender.id,
                            'username': sender.username,
                            'email': sender.email,
                            'real_name': sender.real_name,
                            'avatar': sender.avatar.url if sender.avatar else None,
                        },
                        'sender_name': sender.username,
                        'sender_id': sender.id,
                        'message_type': message_type,
                        'file_info': None,
                        'mentioned_users': [],
                        'mentioned_all': False,
                        'is_mention_all': False,
                        'timestamp': message.timestamp.isoformat(),
                        'temp_id': None,
                        'quote_message_id': None,
                        'quote_content': None,
                        'quote_sender': None,
                        'quote_sender_id': None,
                        'quote_timestamp': None,
                        'quote_message_type': None,
                        'quote_file_info': None,
                        'voice_duration': None,
                        # 🔧 新增：通话相关字段
                        'call_duration': message.call_duration,
                        'call_type': message.call_type,
                        'call_status': message.call_status,
                    }
                )
                # 🔧 通话通知同样走 Web Push（未接听置为高优）
                if push_enabled and push_payload:
                    try:
                        from .tasks import send_push_task
                        send_push_task.delay(member.id, push_payload, ttl=43200, urgent=urgent)
                    except Exception as e:
                        logger.warning(f"推送通话通知失败 user={member.id}: {e}")
        except Exception as e:
            logger.error(f"❌ 发送通话记录全局通知失败: {e}", exc_info=True)

    @database_sync_to_async
    def is_user_in_room(self, room_id):
        """验证用户是否在聊天室中（增强容错）"""
        try:
            # 🔧 关键修复：确保 room_id 是整数
            if isinstance(room_id, str) and room_id.isdigit():
                room_id = int(room_id)
            elif isinstance(room_id, str):
                logger.warning(f"Invalid room_id format: {room_id}")
                return False

            chat_room = ChatRoom.objects.get(id=room_id)
            return chat_room.members.filter(id=self.user.id).exists()
        except ChatRoom.DoesNotExist:
            logger.warning(f"ChatRoom {room_id} does not exist")
            return False
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid room_id type: {room_id}, error: {e}")
            return False
        except Exception as e:
            logger.error(f"Error checking room membership: {e}")
            return False