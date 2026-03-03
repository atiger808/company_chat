# -*- coding: utf-8 -*-
# @File   :serializers.py
# @Time   :2026/2/3 15:14
# @Author :admin


# chat/serializers.py
from rest_framework import serializers
from django.db.models import Q, Count
from django.utils import timezone
from .models import ChatRoom, Message, FileUpload, MessageReadStatus, MessageDeleteStatus, ChatRoomDeleteStatus
from accounts.models import CustomUser
from accounts.serializers import UserListSerializer
from loguru import logger



class ChatRoomSerializer(serializers.ModelSerializer):
    """聊天室序列化器"""
    members = UserListSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    creator_info = UserListSerializer(source='creator', read_only=True)

    class Meta:
        model = ChatRoom
        fields = [
            'id', 'name', 'room_type', 'members', 'display_name',
            'last_message', 'unread_count', 'is_pinned', 'is_muted',
            'creator', 'creator_info', 'created_at', 'updated_at',
            'is_deleted', 'deleted_at'
        ]

    def get_display_name(self, obj):
        user = self.context['request'].user
        if obj.room_type == 'private':
            other_members = obj.members.exclude(id=user.id)
            if other_members.exists():
                return other_members.first().real_name or other_members.first().username
            return '未知用户'

        return obj.name or '未命名群聊'

    def get_last_message(self, obj):
        """获取最后一条消息"""
        try:
            logger.info(f"Getting last message for room: {obj.id}")
            request = self.context.get('request')
            if not request or not hasattr(request, 'user'):
                logger.warning("Request or user not found in context.")
                return None
            
            user = request.user
            
            # 优化查询：使用 select_related 预加载关联数据，减少数据库查询次数
            last_msg = Message.objects.select_related('sender', 'file').filter(
                chat_room=obj,  # 修复：使用 obj 而不是 self
                is_deleted=False,
            ).exclude(
                id__in=MessageDeleteStatus.objects.filter(
                    is_deleted=True, 
                    user=user
                ).values_list('message_id', flat=True)  # 优化：只获取 ID 列表
            ).order_by('-timestamp').first()
            
            logger.info(f"Last message result: {last_msg}")
            if last_msg:
                return MessageSerializer(last_msg, context=self.context).data
            return None
        except Exception as e:
            logger.error(f"Error in get_last_message: {e}")
            return None



    def get_unread_count(self, obj):
        try:
            request = self.context.get('request')
            if not request or not hasattr(request, 'user'):
                logger.warning("Request or user not found in context.")
                return 0
            user = request.user

            unread = Message.objects.select_related('sender', 'file').filter(
                chat_room=obj,  # 修复：使用 obj 而不是 self
                is_deleted=False,
            ).exclude(
                id__in=MessageDeleteStatus.objects.filter(
                    is_deleted=True,
                    user=user
                ).values_list('message_id', flat=True)  # 优化：只获取 ID 列表
            ).exclude(
                id__in=MessageReadStatus.objects.filter(
                    user=user
                ).values_list('message_id', flat=True)
            ).count()

            # unread = Message.objects.filter(
            #     chat_room=obj,
            #     chat_room__members=user,
            #     is_deleted=False
            # ).exclude(
            #     read_statuses__user=user
            # ).count()

            logger.info(f"room: {obj.id} Unread count result: {unread}")
            return unread
        except Exception as e:
            logger.error(f"Error in get_unread_count: {e}")
            return 0  # 返回默认值，避免服务崩溃


class MessageSerializer(serializers.ModelSerializer):
    """消息序列化器"""
    sender = UserListSerializer(read_only=True)
    file_info = serializers.SerializerMethodField() # 自动从 FileUpload 获取
    is_read = serializers.SerializerMethodField()

    file_id = serializers.IntegerField(write_only=True, required=False)  # ✅ 明确接收 file_id

    # 🔧 新增：引用消息字段
    quote_info = serializers.SerializerMethodField()

    def create(self, validated_data):
        file_id = validated_data.pop('file_id', None)
        message = Message.objects.create(**validated_data)
        if file_id:
            try:
                file_upload = FileUpload.objects.get(id=file_id)
                message.file = file_upload
                message.save()
            except FileUpload.DoesNotExist:
                pass
        return message

    class Meta:
        model = Message
        fields = [
            'id', 'chat_room', 'sender', 'content', 'message_type',
            'file_info', 'is_read', 'timestamp', 'is_deleted', 'deleted_at',
            'file_id',  # ✅ 添加到 fields 列表中
            # 🔧 引用字段
            'quote_message', 'quote_content', 'quote_sender', 'quote_sender_id',
            'quote_timestamp', 'quote_message_type', 'quote_info',
        ]
        read_only_fields = ['sender', 'timestamp', 'is_deleted', 'deleted_at']

    def get_file_info(self, obj):


        # 1. 优先调用模型原方法
        info = obj.get_file_info()
        if info is not None:
            return info

        # 2. 兜底：尝试从 message.content 或其他字段推断（可选）
        # 但更常见的是：前端传了 file_url，但模型没存到 file 字段
        # → 我们假设：如果 message_type 是 media 类型，且 obj.file_url 存在（需在 view 中注入）
        # 但 Django ORM 默认没有 file_url 字段 → 所以我们在 view 创建消息时，应将 file_url 写入 file 字段？不现实。

        # ✅ 最佳实践：在 API 创建消息时，强制要求上传文件（走 upload 接口），或
        # 在 serializers 中支持接收 file_url 并生成虚拟 file_info

        # 由于当前架构已用 file_url 字段（见 API 发送逻辑），我们在此做兼容：
        # 检查是否有额外属性（比如 view 中动态加的）
        if hasattr(obj, 'extra_file_info') and obj.extra_file_info:
            return obj.extra_file_info

        # 3. 最终兜底：如果 message_type 是媒体类型，但无 file_info，返回最小结构
        if obj.message_type in ['text', 'image', 'file', 'video', 'voice', 'emoji']:
            # 尝试从 content 中提取（不推荐，仅应急）
            # 或返回空结构，避免前端崩溃
            return {
                'url': '',
                'name': '未知文件',
                'size': 0,
                'type': obj.message_type,
                'mime_type': obj.get_mime_type(),
            }

        return None

    def get_is_read(self, obj):
        user = self.context['request'].user
        if obj.chat_room.room_type == 'group':
            return MessageReadStatus.objects.filter(
                message=obj, user=user
            ).exists()
        return obj.is_read

    # 🔧 新增：序列化引用信息
    def get_quote_info(self, obj):
        if obj.quote_message_id:
            return {
                'id': obj.quote_message_id,
                'content': obj.quote_content,
                'sender': obj.quote_sender,
                'sender_id': obj.quote_sender_id,
                'timestamp': obj.quote_timestamp.isoformat() if obj.quote_timestamp else None,
                'message_type': obj.quote_message_type
            }
        return None

    def create(self, validated_data):
        # 🔧 保存引用字段
        quote_message_id = self.context['request'].data.get('quote_message_id')
        quote_content = self.context['request'].data.get('quote_content')
        quote_sender = self.context['request'].data.get('quote_sender')
        quote_sender_id = self.context['request'].data.get('quote_sender_id')
        quote_timestamp = self.context['request'].data.get('quote_timestamp')
        quote_message_type = self.context['request'].data.get('quote_message_type')

        message = Message.objects.create(**validated_data)

        # 保存引用信息
        if quote_message_id:
            try:
                quote_message = Message.objects.get(id=quote_message_id)
                message.quote_message = quote_message
            except Message.DoesNotExist:
                pass

        if quote_content:
            message.quote_content = quote_content[:500]  # 限制长度

        if quote_sender:
            message.quote_sender = quote_sender[:100]

        if quote_sender_id:
            message.quote_sender_id = int(quote_sender_id)

        if quote_timestamp:
            try:
                message.quote_timestamp = timezone.datetime.fromisoformat(quote_timestamp.replace('Z', '+00:00'))
            except:
                message.quote_timestamp = timezone.now()

        if quote_message_type:
            message.quote_message_type = quote_message_type

        message.save()

        return message




