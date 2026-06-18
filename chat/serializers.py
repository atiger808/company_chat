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
from accounts.serializers import UserListSerializer, DepartmentSerializer
from loguru import logger



class ChatRoomSerializer(serializers.ModelSerializer):
    """聊天室序列化器"""
    members = UserListSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    creator_info = UserListSerializer(source='creator', read_only=True)

    has_unread_mention = serializers.SerializerMethodField()

    has_mention_all = serializers.SerializerMethodField()

    class Meta:
        model = ChatRoom
        fields = [
            'id', 'name', 'room_type', 'members', 'display_name',
            'last_message', 'unread_count', 'is_pinned', 'is_muted',
            'creator', 'creator_info', 'created_at', 'updated_at',
            'is_deleted', 'deleted_at', 'has_unread_mention', 'has_mention_all',
        ]

    def get_display_name(self, obj):
        user = self.context['request'].user
        if obj.room_type == 'private':
            other_members = obj.members.exclude(id=user.id)
            if other_members.exists():
                return ' - '.join([m.real_name or m.username for m in other_members])
            return '未命名群聊'

        return obj.name or '未命名群聊'

    def get_last_message(self, obj):
        """🔧 优先使用预取的缓存数据，实现毫秒级响应"""
        # 1. 优先读取视图层批量预取的数据
        if hasattr(obj, '_cached_last_message') and obj._cached_last_message:
            msg = obj._cached_last_message
            # logger.info(f"Hit cache for {obj.id} last msg: {msg}")
            # 返回序列化后的数据
            return MessageSerializer(msg, context=self.context).data

        # 2. 降级方案（仅当缓存未命中时执行，如单独获取详情时）
        try:
            request = self.context.get('request')
            if not request or not hasattr(request, 'user'):
                return None
            user = request.user
            date_joined = user.date_joined

            last_msg = Message.objects.select_related('sender', 'file').filter(
                chat_room=obj, is_deleted=False,
                timestamp__gte=date_joined
            ).exclude(
                id__in=MessageDeleteStatus.objects.filter(is_deleted=True, user=user).values_list('message_id',
                                                                                                  flat=True)
            ).order_by('-timestamp').first()

            if last_msg:
                return MessageSerializer(last_msg, context=self.context).data
            return None
        except Exception as e:
            logger.error(f"Error in get_last_message fallback: {e}")
            return None


    def get_unread_count(self, obj):
        # 注意：unread_count 的计算依赖当前用户的已读状态，批量优化较复杂，
        # 但由于列表加载瓶颈主要在 last_message，优化后整体响应应已达标。
        try:
            request = self.context.get('request')
            if not request or not hasattr(request, 'user'):
                return 0
            user = request.user
            date_joined = user.date_joined

            # 优化：使用 exists/count 组合查询，减少内存占用
            unread = Message.objects.filter(
                chat_room=obj, is_deleted=False,
                timestamp__gte=date_joined
            ).exclude(
                sender=user
            ).exclude(
                id__in=MessageDeleteStatus.objects.filter(is_deleted=True, user=user).values_list('message_id',
                                                                                                  flat=True)
            ).exclude(
                id__in=MessageReadStatus.objects.filter(user=user).values_list('message_id', flat=True)
            ).count()

            return unread
        except Exception as e:
            logger.error(f"Error in get_unread_count: {e}")
            return 0


    def get_has_unread_mention(self, obj):
        """获取是否有未读的@消息"""
        try:
            request = self.context.get('request')
            if not request or not hasattr(request, 'user'):
                logger.warning("Request or user not found in context.")
                return False

            user = request.user
            date_joined = user.date_joined

            # 构建已删除消息的ID子查询
            deleted_message_ids = MessageDeleteStatus.objects.filter(
                is_deleted=True,
                user=user
            ).values_list('message_id', flat=True)

            # 构建已读消息的ID子查询
            read_message_ids = MessageReadStatus.objects.filter(
                user=user
            ).values_list('message_id', flat=True)

            # 查询是否存在符合条件的未读@消息
            has_unread_mention = Message.objects.filter(
                chat_room=obj,
                is_deleted=False,
                timestamp__gte=date_joined,
                mentioned_users=user
            ).exclude(
                id__in=deleted_message_ids
            ).exclude(
                id__in=read_message_ids
            ).exists()
            
            return has_unread_mention
        except Exception as e:
            logger.error(f"Error in get_has_unread_mention: {e}")
            return False

    def get_has_mention_all(self, obj):
        """获取是否有未读的@全体消息"""
        try:
            request = self.context.get('request')
            if not request or not hasattr(request, 'user'):
                logger.warning("Request or user not found in context.")
                return False
            user = request.user
            date_joined = user.date_joined
            return Message.objects.filter(
                chat_room=obj,
                is_deleted=False,
                timestamp__gte=date_joined,
                mentioned_all=True
            ).exclude(
                sender=user
            ).exclude(
                id__in=MessageDeleteStatus.objects.filter(
                    is_deleted=True,
                    user=user
                ).values_list('message_id', flat=True)
            ).exclude(
                id__in=MessageReadStatus.objects.filter(
                    user=user
                ).values_list('message_id', flat=True)
            ).exists()
        except Exception as e:
            logger.error(f"Error in get_has_mention_all: {e}")
            return False


class MessageSerializer(serializers.ModelSerializer):
    """消息序列化器"""
    sender = UserListSerializer(read_only=True)
    file_info = serializers.SerializerMethodField() # 自动从 FileUpload 获取
    is_read = serializers.SerializerMethodField()

    # 🔧 新增：云盘文件 ID（如果该消息文件已存在于当前用户的云盘中，且为文档类型）
    cloud_file_id = serializers.SerializerMethodField()

    file_id = serializers.IntegerField(write_only=True, required=False)  # ✅ 明确接收 file_id

    # 🔧 新增：引用消息字段
    quote_info = serializers.SerializerMethodField()
    quote_file_info = serializers.SerializerMethodField()
    # 🔧 新增：语音精确时长字段
    voice_duration = serializers.FloatField(read_only=True)

    # 🔧 新增：序列化提及的用户列表（仅读）
    mentioned_users = UserListSerializer(many=True, read_only=True)

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
            'file_id',
            # 🔧 引用字段 - 扁平化字段（前端直接使用）
            'quote_message', 'quote_content', 'quote_sender', 'quote_sender_id',
            'quote_timestamp', 'quote_message_type',
            # 🔧 嵌套字段（保留兼容性）
            'quote_info', 'quote_file_info',
            # 🔧 添加语音时长字段
            'voice_duration', 'mentioned_users', 'mentioned_all',  # 🔧 加入列表
            'call_duration', 'call_type', 'call_status',
            'cloud_file_id',  # 🔧 新增字段
        ]
        read_only_fields = ['id', 'timestamp', 'is_read', 'is_deleted', 'deleted_at', 'sender', 'sender_id', 'sender_name', 'voice_duration', 'mentioned_users', 'mentioned_all']

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
        if obj.message_type in ['text', 'image', 'file', 'video', 'voice', 'emoji', 'call_audio', 'call_video']:
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
        return MessageReadStatus.objects.filter(
            message=obj, user=user
        ).exists()


    # 🔧 优化：序列化引用信息（嵌套格式，保留兼容性）
    def get_quote_info(self, obj):
        if obj.quote_message_id:
            return {
                'id': obj.quote_message_id,
                'content': obj.quote_content,
                'call_duration': obj.quote_message.call_duration,
                'sender': obj.quote_sender,
                'sender_id': obj.quote_sender_id,
                'timestamp': obj.quote_timestamp.isoformat() if obj.quote_timestamp else None,
                'message_type': obj.quote_message_type,
                'file_info': obj.get_quote_file_info() if hasattr(obj, 'get_quote_file_info') else None
            }
        return None


    def get_quote_file_info(self, obj):
        """🔧 关键修复：获取被引用消息的文件信息"""
        if obj.quote_message_id:
            try:
                return obj.quote_message.get_file_info()
            except Exception as e:
                logger.error(f"Error getting quote file info: {e}")
                return None
        return None

    def get_cloud_file_id(self, obj):
        """
        🔧 检查当前消息的文件是否已存在于当前用户的云盘中。
        如果存在且为可在线编辑的文档类型，返回云盘文件 ID，否则返回 None。
        """
        # 1. 必须有物理文件且计算过 MD5
        if not obj.file or not obj.file.md5:
            return None

        user = self.context.get('request').user
        if not user or not user.is_authenticated:
            return None

        file_md5 = obj.file.md5

        # 2. 优先从 context 中获取批量预取的字典（解决 N+1 查询问题，性能极佳）
        cloud_file_map = self.context.get('cloud_file_map', {})
        if cloud_file_map:
            cloud_file_id = cloud_file_map.get(file_md5)
        else:
            # 3. 降级方案：单条查询（仅在未传入 cloud_file_map 时触发）
            from cloud.models import CloudFile
            cloud_file = CloudFile.objects.filter(
                owner=user,
                md5=file_md5,
                deleted_at__isnull=True
            ).first()
            cloud_file_id = cloud_file.id if cloud_file else None

        if not cloud_file_id:
            return None

        # 4. 判断是否为 OnlyOffice 支持的文档类型（只有文档才需要“在线编辑”按钮）
        file_name = obj.file.filename or ''
        ext = file_name.split('.')[-1].lower() if '.' in file_name else ''

        # OnlyOffice 支持在线编辑的格式
        doc_extensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'csv']

        if ext in doc_extensions:
            return str(cloud_file_id)

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

                # 🔧 关键修复：如果quote_content等字段为空，从原消息中提取
                if not quote_content:
                    message.quote_content = quote_message.content[:500] if quote_message.content else ''

                if not quote_sender:
                    message.quote_sender = quote_message.sender.real_name or quote_message.sender.username if quote_message.sender else '未知用户'

                if not quote_sender_id:
                    message.quote_sender_id = quote_message.sender.id if quote_message.sender else None

                if not quote_timestamp:
                    message.quote_timestamp = quote_message.timestamp

                if not quote_message_type:
                    message.quote_message_type = quote_message.message_type
            except Message.DoesNotExist:
                logger.warning(f"Quote message {quote_message_id} does not exist")
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


class MemberListSerializer(serializers.ModelSerializer):
    """成员列表序列化器（用于聊天室历史）"""
    avatar_url = serializers.SerializerMethodField()
    department_info = DepartmentSerializer(source='department', read_only=True)
    last_seen = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = [
            'id', 'username', 'real_name', 'avatar_url',
            'department_info', 'position', 'is_online', 'last_seen'
        ]

    def get_avatar_url(self, obj):
        """安全获取头像 URL"""
        if hasattr(obj, 'get_avatar_url') and callable(getattr(obj, 'get_avatar_url')):
            return obj.get_avatar_url()
        elif hasattr(obj, 'avatar_url'):
            return obj.avatar_url
        elif hasattr(obj, 'avatar') and obj.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.avatar.url)
        return None


    def get_last_seen(self, obj):
        """安全处理 last_seen 日期"""
        if hasattr(obj, 'last_seen') and obj.last_seen:
            try:
                return obj.last_seen.isoformat()
            except (AttributeError, ValueError):
                return None
        return None
