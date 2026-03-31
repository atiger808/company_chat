# -*- coding: utf-8 -*-
# @File   :consumers.py
# @Time   :2026/2/3 15:13
# @Author :admin

import json
import asyncio
from datetime import timedelta
from django.conf import settings
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from django.db import connection, close_old_connections, transaction
from django.db.models import Q, Count
from asgiref.sync import sync_to_async
from loguru import logger

from accounts.models import CustomUser
from chat.models import ChatRoom, Message, FileUpload, MessageReadStatus, MessageDeleteStatus, ChatRoomDeleteStatus, UserOnlineStatus
from cloud.models import CloudFile, FileCollaboration


class ChatConsumer(AsyncWebsocketConsumer):
    """聊天WebSocket消费者"""

    async def connect(self):
        """建立 WebSocket 连接"""
        try:
            # 1. 清理旧的数据库连接
            await sync_to_async(close_old_connections)()

            self.user = self.scope['user']

            # 2. 认证检查
            if not self.user or not self.user.is_authenticated or self.user.is_anonymous:
                logger.warning(f"未认证用户尝试连接 WebSocket: {self.scope.get('client')}")
                await self.close(code=4000)
                return

            # 3. 获取房间信息
            self.room_name = str(self.scope['url_route']['kwargs']['room_name'])
            self.room_group_name = f'chat_{self.room_name}'

            # 4. 权限验证
            if not await self.is_user_in_room(self.room_name):
                logger.warning(f"用户 {self.user.username} 无权访问房间 {self.room_name}")
                await self.close(code=4003)
                return

            # 5. 初始化任务列表
            self.tasks = []
            self.heartbeat_task = None

            # 6. 加入频道组
            await self.channel_layer.group_add(self.room_group_name, self.channel_name)
            await self.accept()

            logger.info(f"WebSocket 连接成功：用户={self.user.username}, 房间={self.room_name}")

            # 7. 更新在线状态并广播
            await self.update_and_broadcast_online_status(True)

            # 8. 启动心跳任务 (防移动端锁屏断开)
            self.heartbeat_task = asyncio.create_task(self.send_heartbeat())
            self.tasks.append(self.heartbeat_task)

            # 9. 发送初始在线用户列表
            await self.send_online_users()

        except Exception as e:
            logger.error(f"WebSocket 连接异常：{e}", exc_info=True)
            await self.close()

    async def disconnect(self, close_code):
        """断开 WebSocket 连接"""
        try:
            logger.info(f"WebSocket 断开：用户={getattr(self.user, 'username', 'unknown')}, 代码={close_code}")

            # 1. 取消所有后台任务
            await self.cancel_all_tasks()

            # 2. 离开频道组
            if hasattr(self, 'room_group_name'):
                await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

            # 3. 更新离线状态并广播
            if hasattr(self, 'user') and self.user and not self.user.is_anonymous:
                await self.update_and_broadcast_online_status(False)

        except Exception as e:
            logger.error(f"WebSocket 断开异常：{e}", exc_info=True)
        finally:
            # 4. 确保关闭数据库连接
            await self.close_database_connections()

    async def receive(self, text_data):
        """接收客户端消息"""
        if not hasattr(self, 'user') or self.user.is_anonymous:
            await self.close()
            return

        try:
            # 清理旧连接
            await sync_to_async(close_old_connections)()

            data = json.loads(text_data)
            message_type = data.get('type', 'chat_message')

            if message_type == 'chat_message':
                await self.handle_chat_message(data)
            elif message_type == 'typing':
                await self.handle_typing(data)
            elif message_type == 'read_message':
                await self.handle_read_message(data)
            else:
                logger.warning(f"未知消息类型：{message_type}")

        except json.JSONDecodeError:
            logger.error("无效的 JSON 数据")
        except Exception as e:
            logger.error(f"接收消息处理异常：{e}", exc_info=True)

    async def send_heartbeat(self):
        """心跳任务：每 30 秒发送一次心跳"""
        try:
            while True:
                await asyncio.sleep(30)
                try:
                    await self.send(text_data=json.dumps({
                        'type': 'heartbeat',
                        'timestamp': timezone.now().isoformat()
                    }))
                except Exception:
                    # 发送失败通常意味着连接已断开
                    break
        except asyncio.CancelledError:
            logger.debug(f"心跳任务已取消：用户={self.user.username}")
            raise
        except Exception as e:
            logger.error(f"心跳任务异常：{e}", exc_info=True)

    async def cancel_all_tasks(self):
        """取消所有后台任务"""
        if hasattr(self, 'heartbeat_task') and not self.heartbeat_task.done():
            self.heartbeat_task.cancel()
            try:
                await self.heartbeat_task
            except asyncio.CancelledError:
                pass

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
        """关闭数据库连接"""
        try:
            await sync_to_async(lambda: connection.close())()
        except Exception:
            pass
        finally:
            await sync_to_async(close_old_connections)()


    async def update_and_broadcast_online_status_v1(self, is_online):
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

    async def update_and_broadcast_online_status(self, is_online):
        """更新在线状态并广播给相关用户"""
        if not hasattr(self, 'user') or not self.user or self.user.is_anonymous:
            return

        # 1. 更新数据库
        await self.update_user_online_status(is_online)

        # 2. 获取用户所在的所有聊天室 (优化：只获取 ID)
        chat_rooms = await database_sync_to_async(
            lambda: list(ChatRoom.objects.filter(members=self.user).values_list('id', flat=True))
        )()

        # 3. 广播状态 (优化：批量获取成员，减少循环中的查询)
        # 注意：这里为了简化逻辑保留循环，但在高并发场景下可进一步优化为批量推送
        for room_id in chat_rooms:
            # 获取该房间其他成员的 ID
            members = await database_sync_to_async(
                lambda rid: list(ChatRoom.objects.filter(id=rid).values_list('members__id', flat=True).exclude(
                    members__id=self.user.id))
            )(room_id)

            if not members:
                continue

            # 构建通知数据
            notification_data = {
                'type': 'user_online_status',
                'user_id': self.user.id,
                'username': self.user.username,
                'real_name': getattr(self.user, 'real_name', ''),
                'avatar_url': self.user.avatar.url if getattr(self.user, 'avatar', None) else None,
                'is_online': is_online,
                'last_seen': timezone.now().isoformat() if not is_online else None,
                'chat_room_id': room_id
            }

            # 发送给每个成员的通知组
            for member_id in members:
                group_name = f'user_{member_id}_notifications'
                await self.channel_layer.group_send(group_name, notification_data)



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


    async def handle_chat_message_v1(self, data):
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

        if not message:
            await self.send_error("消息保存失败")
            return

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

        #  🔧 关键修复 7: 发送未读数更新给接收方
        # 获取聊天室所有成员（排除发送者）
        # chat_room = await database_sync_to_async(lambda: message.chat_room)()
        # members = await database_sync_to_async(
        #     lambda: list(chat_room.members.filter(id=self.user.id).values_list('id', flat=True))
        # )()
        #
        # for member_id in members:
        #     # 获取该成员的未读消息数
        #     unread_count = await self.get_unread_count(chat_room.id, member_id)
        #     # 发送未读数更新
        #     await self.send_unread_count_update(message.chat_room.id, unread_count)



    async def handle_chat_message(self, data):
        """处理聊天消息"""
        content = data.get('content', '')
        message_type = data.get('message_type', 'text')
        file_id = data.get('file_id')
        temp_id = data.get('temp_id')

        # 获取目标房间 ID (支持转发场景)
        target_room_id = data.get('chat_room')

        if target_room_id:
            target_room_id = str(target_room_id)
            # 验证权限
            if not await self.is_user_in_room(target_room_id):
                await self.send_error("没有权限发送到该聊天室")
                return
            room_name = target_room_id
            room_group_name = f'chat_{room_name}'
        else:
            room_name = self.room_name
            room_group_name = self.room_group_name

        # 提取引用信息
        quote_data = {
            'quote_message_id': data.get('quote_message_id'),
            'quote_content': data.get('quote_content'),
            'quote_sender': data.get('quote_sender'),
            'quote_sender_id': data.get('quote_sender_id'),
            'quote_timestamp': data.get('quote_timestamp'),
            'quote_message_type': data.get('quote_message_type')
        }

        # 保存消息
        message = await self.save_message(
            content, message_type, file_id, room_name, **quote_data
        )

        if not message:
            await self.send_error("消息保存失败")
            return

        logger.debug(f"消息保存成功：ID={message.id}, 房间={room_name}")

        # 构建发送者信息
        sender_info = {
            'id': self.user.id,
            'username': self.user.username,
            'email': self.user.email,
            'real_name': getattr(self.user, 'real_name', ''),
            'avatar': self.user.avatar.url if getattr(self.user, 'avatar', None) else None,
            'is_active': self.user.is_active,
            'is_online': getattr(self.user, 'is_online', False),
        }

        # 构建消息负载
        message_payload = {
            'type': 'chat_message',
            'chat_room': message.chat_room_id,
            'message_id': str(message.id),
            'is_read': message.is_read,
            'sender': sender_info,
            'sender_id': self.user.id,
            'sender_name': self.user.username,
            'content': content,
            'message_type': message_type,
            'file_info': message.get_file_info() if file_id else None,
            'timestamp': message.timestamp.isoformat(),
            'temp_id': temp_id,
            'voice_duration': getattr(message, 'voice_duration', None),
            **{k: v for k, v in {
                'quote_message_id': message.quote_message_id,
                'quote_content': message.quote_content,
                'quote_sender': message.quote_sender,
                'quote_sender_id': message.quote_sender_id,
                'quote_timestamp': message.quote_timestamp.isoformat() if message.quote_timestamp else None,
                'quote_message_type': message.quote_message_type,
            }.items() if v is not None}
        }

        # 1. 广播到房间组
        await self.channel_layer.group_send(room_group_name, message_payload)

        # 2. 发送全局通知 (优化：异步处理，不阻塞主流程)
        asyncio.create_task(self.send_global_notification_async(message_payload.copy()))

        # 3. 更新未读数
        unread_count = await self.get_unread_count(message.chat_room.id, self.user.id)
        await self.send_unread_count_update(message.chat_room.id, unread_count)
        # await self.update_unread_counts_async(message.chat_room.id)


    async def send_global_notification_async(self, payload):
        """异步发送全局通知"""
        chat_room_id = payload.get('chat_room')
        if not chat_room_id:
            return

        try:
            # 获取房间成员 ID (排除自己)
            member_ids = await database_sync_to_async(
                lambda cid: list(ChatRoom.objects.filter(id=cid).values_list('members__id', flat=True).exclude(
                    members__id=self.user.id))
            )(chat_room_id)

            for member_id in member_ids:
                await self.channel_layer.group_send(
                    f'user_{member_id}_notifications',
                    {'type': 'new_message', **payload}
                )
        except Exception as e:
            logger.error(f"发送全局通知失败：{e}")

    async def update_unread_counts_async(self, chat_room_id):
        """异步更新未读消息数"""
        try:
            member_ids = await database_sync_to_async(
                lambda cid: list(ChatRoom.objects.filter(id=cid).values_list('members__id', flat=True).exclude(
                    members__id=self.user.id))
            )(chat_room_id)

            for member_id in member_ids:
                count = await self.get_unread_count(chat_room_id, member_id)
                await self.channel_layer.group_send(
                    f'user_{member_id}_notifications',
                    {
                        'type': 'unread_count_update',
                        'chat_room_id': chat_room_id,
                        'unread_count': count
                    }
                )
        except Exception as e:
            logger.error(f"更新未读数失败：{e}")


    async def handle_typing(self, data):
        """处理输入状态"""
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
        message_ids = data.get('message_ids', [])
        if not message_ids:
            return

        # 批量标记已读 (优化)
        for mid in message_ids:
            await self.mark_message_as_read(mid)



    # 新增：处理消息事件（包括撤销）
    async def chat_message(self, event):
        """接收聊天消息事件并转发给前端"""
        # 撤销消息处理保持不变
        if event.get('message') and event['message'].get('type') == 'message_revoked':
            msg = event['message']
            await self.send(text_data=json.dumps({
                'type': 'message_revoked',
                'message_id': msg['id'],
                'revoked_at': msg['revoked_at'],
                'sender_id': msg['sender_id'],
                'chat_room_id': msg.get('chat_room_id'),
                'sender_name': msg.get('sender_name'),
                'room_type': msg.get('room_type'),
            }))
        else:
            await self.send(text_data=json.dumps({
                'type': 'chat_message',
                **{k: v for k, v in event.items() if k != 'type'}
            }))

            # # 🔧 关键修复：转发所有引用字段给前端
            # await self.send(text_data=json.dumps({
            #     'type': 'chat_message',
            #     'chat_room': event['chat_room'],
            #     'message_id': event['message_id'],
            #     'is_read': event['is_read'],
            #     'sender': event['sender'],
            #     'sender_id': event['sender_id'],
            #     'sender_name': event['sender_name'],
            #     'content': event['content'],
            #     'message_type': event['message_type'],
            #     'file_info': event.get('file_info'),
            #     'timestamp': event['timestamp'],
            #     'temp_id': event.get('temp_id'),
            #     # 🔧 必须转发引用字段
            #     'quote_message_id': event.get('quote_message_id'),
            #     'quote_content': event.get('quote_content'),
            #     'quote_sender': event.get('quote_sender'),
            #     'quote_sender_id': event.get('quote_sender_id'),
            #     'quote_timestamp': event.get('quote_timestamp'),
            #     'quote_message_type': event.get('quote_message_type'),
            # }))


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

    async def send_error(self, message):
        """发送错误消息"""
        await self.send(text_data=json.dumps({
            'type': 'error',
            'message': message
        }))

    @database_sync_to_async
    def save_message_v1(self, content, message_type, file_id=None,
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
    def save_message(self, content, message_type, file_id, room_name, **quote_kwargs):
        """保存消息到数据库 (同步操作)"""
        try:
            with transaction.atomic():
                chat_room = ChatRoom.objects.select_for_update().get(id=room_name)

                # 恢复软删除状态
                ChatRoomDeleteStatus.objects.filter(
                    chat_room_id=room_name, is_deleted=True
                ).update(is_deleted=False)

                message = Message.objects.create(
                    chat_room=chat_room,
                    sender=self.user,
                    content=content,
                    message_type=message_type
                )

                # 处理引用
                if quote_kwargs.get('quote_message_id'):
                    try:
                        message.quote_message_id = quote_kwargs['quote_message_id']
                    except Message.DoesNotExist:
                        pass

                for key in ['quote_content', 'quote_sender', 'quote_message_type']:
                    val = quote_kwargs.get(key)
                    if val:
                        setattr(message, key, str(val)[:500] if key == 'quote_content' else str(val)[:100])

                if quote_kwargs.get('quote_sender_id'):
                    message.quote_sender_id = int(quote_kwargs['quote_sender_id'])

                if quote_kwargs.get('quote_timestamp'):
                    ts = quote_kwargs['quote_timestamp']
                    if isinstance(ts, str):
                        ts = ts.replace('Z', '+00:00')
                    try:
                        message.quote_timestamp = timezone.datetime.fromisoformat(ts)
                    except ValueError:
                        message.quote_timestamp = timezone.now()

                # 处理文件
                if file_id:
                    try:
                        message.file_id = file_id
                    except FileUpload.DoesNotExist:
                        logger.warning(f"文件不存在：{file_id}")

                # 更新房间时间戳
                chat_room.updated_at = timezone.now()
                chat_room.save(update_fields=['updated_at'])

                # 保存所有字段
                message.save()
                return message
        except Exception as e:
            logger.error(f"保存消息失败：{e}", exc_info=True)
            return None

    @database_sync_to_async
    def is_user_in_room(self, room_id):
        """验证用户是否在房间中"""
        try:
            return ChatRoom.objects.filter(
                id=room_id, members__id=self.user.id
            ).exists()
        except Exception as e:
            logger.error(f"验证房间权限失败：{e}")
            return False

    @database_sync_to_async
    def update_user_online_status(self, is_online):
        """更新用户在线状态"""
        try:
            self.user.update_online_status(is_online)
            status, _ = UserOnlineStatus.objects.update_or_create(
                user=self.user,
                defaults={
                    'is_online': is_online,
                    'last_seen': timezone.now() if not is_online else None
                }
            )
        except Exception as e:
            logger.error(f"更新在线状态失败：{e}")

    @database_sync_to_async
    def mark_message_as_read(self, message_id):
        """标记消息为已读"""
        try:
            message = Message.objects.filter(id=message_id, chat_room__members__id=self.user.id).first()
            if message:
                MessageReadStatus.objects.get_or_create(message=message, user=self.user)
        except Exception as e:
            logger.error(f"标记已读失败：{e}")

    @database_sync_to_async
    def send_online_users_v1(self):
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


    @database_sync_to_async
    def send_online_users(self):
        """发送在线用户列表"""
        try:
            # chat_room = ChatRoom.objects.prefetch_related('members__is_online').get(id=self.room_name)
            chat_room = ChatRoom.objects.get(id=self.room_name)
            # 优化：直接使用在线状态字段
            online_users = [
                {
                    'id': str(u.id),
                    'username': u.username,
                    'avatar': u.avatar.url if getattr(u, 'avatar', None) else None
                }
                for u in chat_room.members.all()
                if getattr(u, 'is_online', False)
            ]

            asyncio.create_task(self.send(text_data=json.dumps({
                'type': 'online_users',
                'users': online_users
            })))
        except Exception as e:
            logger.error(f"发送在线用户列表失败：{e}")


    @database_sync_to_async
    def get_unread_count(self, chat_room_id, user_id):
        """获取指定聊天室的未读消息数"""
        logger.info(f"获取用户 {user_id} 在聊天室 {chat_room_id} 的未读消息数")
        try:
            # 验证聊天室是否存在且用户是成员
            chat_room = ChatRoom.objects.get(id=chat_room_id, members__id=user_id)

            # 获取未读消息数
            unread_count = Message.objects.select_related('sender', 'file').filter(
                chat_room=chat_room,
                is_deleted=False,
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

            logger.info(f"用户 {user_id} 在聊天室 {chat_room_id} 的未读消息数: {unread_count}")
            return unread_count

        except ChatRoom.DoesNotExist:
            logger.warning(f"聊天室 {chat_room_id} 不存在或用户 {user_id} 不是成员")
            return 0
        except Exception as e:
            logger.error(f"获取未读消息数失败: {e}")
            return 0

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
        try:
            self.user = self.scope['user']
            if not self.user or not self.user.is_authenticated:
                await self.close()
                return

            self.group_name = f'user_{self.user.id}_notifications'
            await self.channel_layer.group_add(self.group_name, self.channel_name)
            await self.accept()
            logger.info(f"通知 WebSocket 连接成功：用户={self.user.username}")
        except Exception as e:
            logger.error(f"通知 WebSocket 连接异常：{e}")
            await self.close()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        logger.info(f"通知 WebSocket 断开：用户={getattr(self.user, 'username', 'unknown')}")

    async def receive(self, text_data):
        pass  # 通知消费者通常只接收

    async def new_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'new_message',
            **{k: v for k, v in event.items() if k != 'type'}
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
