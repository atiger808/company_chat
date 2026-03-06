# chat/views.py
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Count
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone

from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.db import transaction
from django.conf import settings
from django.http import JsonResponse
import os
import subprocess
import shutil
import hashlib

from .models import ChatRoom, Message, MessageReadStatus, MessageDeleteStatus, ChatRoomDeleteStatus, FileUpload
from .serializers import ChatRoomSerializer, MessageSerializer
from accounts.views import IsAdminOrSuperAdmin
from loguru import logger


def get_version(request):
    """
    获取应用版本信息
    返回格式:
    {
        "app_version": "2.3.1",          # 应用业务版本
        "static_version": "20260304-1",  # 静态资源版本（CSS/JS）
        "build_time": "2026-03-04T10:30:00Z",
        "force_update": false,           # 是否强制更新
        "update_message": "修复语音消息播放问题"  # 更新说明
    }
    """
    # 从环境变量或 settings 获取版本
    app_version = os.environ.get('APP_VERSION', getattr(settings, 'APP_VERSION', '1.0.0'))
    static_version = os.environ.get('STATIC_VERSION', getattr(settings, 'STATIC_VERSION', app_version))
    build_time = os.environ.get('BUILD_TIME', getattr(settings, 'BUILD_TIME'))


    # 检查是否需要强制更新（可通过环境变量配置）
    force_update = os.environ.get('FORCE_UPDATE', 'false').lower() == 'true'

    # 更新说明（可从文件读取）
    update_message = ""
    update_msg_file = os.path.join(settings.BASE_DIR, 'VERSION_MESSAGE.txt')
    if os.path.exists(update_msg_file):
        with open(update_msg_file, 'r', encoding='utf-8') as f:
            update_message = f.read().strip()

    logger.info(f"get_version: app_version={app_version}, static_version={static_version}, build_time={build_time}, force_update={force_update}, update_message={update_message}")
    return JsonResponse({
        'app_version': app_version,
        'static_version': static_version,
        'build_time': build_time,
        'force_update': force_update,
        'update_message': update_message,
        'environment': settings.ENVIRONMENT if hasattr(settings, 'ENVIRONMENT') else 'production'
    })


class ChatRoomViewSet(viewsets.ModelViewSet):
    """聊天室视图集"""
    serializer_class = ChatRoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """只返回用户参与且未删除的聊天室"""
        user = self.request.user
        # 获取用户参与的所有聊天室
        all_rooms = ChatRoom.objects.filter(members=user)

        # 过滤已删除的聊天室
        filtered_rooms = []
        for room in all_rooms:
            if room.room_type == 'private':
                # 私聊：检查用户个人删除状态
                try:
                    status_obj = ChatRoomDeleteStatus.objects.get(chat_room=room, user=user)
                    if not status_obj.is_deleted:
                        filtered_rooms.append(room)
                except ChatRoomDeleteStatus.DoesNotExist:
                    filtered_rooms.append(room)
            else:
                # 群聊：检查全局删除状态
                try:
                    status_obj = ChatRoomDeleteStatus.objects.get(chat_room=room, user=user)
                    if not status_obj.is_deleted:
                        filtered_rooms.append(room)
                except ChatRoomDeleteStatus.DoesNotExist:
                    filtered_rooms.append(room)

        return filtered_rooms

    @action(detail=True, methods=['delete'])
    def soft_delete(self, request, pk=None):
        """软删除聊天室"""
        try:
            chat_room = ChatRoom.objects.get(pk=pk, members=request.user)
            logger.info(f"User {request.user} soft deleted chat room {chat_room}. room_type: {chat_room.room_type}")
            obj, created = ChatRoomDeleteStatus.objects.get_or_create(chat_room=chat_room, user=request.user)
            logger.info(f"obj {obj} created {created}")
            if not obj.is_deleted:
                obj.is_deleted = True
                obj.deleted_at = timezone.now()
                obj.save()

            # 使用MessageDeleteStatus 删除该聊天室里的所有消息
            all_messages = Message.objects.filter(chat_room=chat_room)
            for message in all_messages:
                try:
                    obj, created = MessageDeleteStatus.objects.get_or_create(message=message, user=request.user)
                    if not obj.is_deleted:
                        obj.is_deleted = True
                        obj.deleted_at = timezone.now()
                        obj.save()
                except MessageDeleteStatus.DoesNotExist:
                    MessageDeleteStatus.objects.create(message=message, user=request.user, is_deleted=True,
                                                       deleted_at=timezone.now())
            return Response({'message': '聊天室已移除'})

        except ChatRoom.DoesNotExist:
            logger.error(f"ChatRoom with ID {pk} does not exist.")
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['delete'])
    def dismiss_chat(self, request, pk=None):
        """解散群聊"""
        try:
            chat_room = ChatRoom.objects.get(pk=pk)
            if chat_room.creator != request.user:
                return Response({'error': '只有群主才能解散群聊'}, status=status.HTTP_403_FORBIDDEN)
            chat_room.delete()
            return Response({'message': '群聊已解散'})
        except ChatRoom.DoesNotExist:
            logger.error(f"ChatRoom with ID {pk} does not exist.")
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['put'])
    def update_group(self, request, pk=None):
        """更新群聊信息"""
        try:
            chat_room = ChatRoom.objects.get(pk=pk)
        except ChatRoom.DoesNotExist:
            logger.error(f"ChatRoom with ID {pk} does not exist.")
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

        if chat_room.room_type != 'group':
            return Response({'error': '只能更新群聊信息'}, status=status.HTTP_400_BAD_REQUEST)

        if chat_room.creator != request.user:
            return Response({'error': '只有群主才能修改群聊信息'}, status=status.HTTP_403_FORBIDDEN)

        # 更新群聊名称
        name = request.data.get('name')
        if name is not None:
            if len(name) < 2 or len(name) > 50:
                return Response({'error': '群聊名称长度必须在2-50个字符之间'}, status=status.HTTP_400_BAD_REQUEST)
            # 如果名称已存在，则返回错误
            if name != chat_room.name and ChatRoom.objects.filter(name=name).exists():
                return Response({'error': '群聊名称已存在'}, status=status.HTTP_400_BAD_REQUEST)
            chat_room.name = name

        # 更新成员
        member_ids = request.data.get('member_ids')
        if member_ids is not None:
            if not isinstance(member_ids, list):
                return Response({'error': 'member_ids 必须是数组'}, status=status.HTTP_400_BAD_REQUEST)

            # 验证成员ID
            valid_member_ids = []
            for mid in member_ids:
                try:
                    valid_member_ids.append(int(mid))
                except (ValueError, TypeError):
                    continue

            if len(valid_member_ids) < 2:
                return Response({'error': '群聊至少需要2个成员'}, status=status.HTTP_400_BAD_REQUEST)

            # 清除现有成员（保留创建者）
            chat_room.members.clear()
            chat_room.members.add(request.user)  # 添加创建者
            chat_room.members.add(*valid_member_ids)

        chat_room.save()
        serializer = self.get_serializer(chat_room)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        """创建聊天室（支持私聊唯一性检查）"""

        room_type = request.data.get('room_type', 'private')
        member_ids = request.data.get('member_ids', [])
        logger.info(f"Creating chat room with type: {room_type}")
        logger.info(f"Member IDs: {member_ids}")

        # 调试：检查用户认证状态
        logger.info(f"Request user: {request.user}")
        logger.info(f"User is authenticated: {request.user.is_authenticated}")
        logger.info(f"User type: {type(request.user)}")

        # 确保用户已认证
        if not request.user.is_authenticated or isinstance(request.user, AnonymousUser):
            return Response(
                {'error': '用户未认证'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        # 验证 member_ids 格式
        if not isinstance(member_ids, list):
            member_ids = []

        # 过滤掉无效的 member_id
        valid_member_ids = []
        for mid in member_ids:
            if mid is not None and str(mid).strip():
                try:
                    valid_member_ids.append(int(str(mid).strip()))
                except (ValueError, TypeError):
                    continue

        # 私聊只能有2个成员（包括创建者）
        if room_type == 'private':
            if len(valid_member_ids) != 1:
                return Response(
                    {'error': '私聊只能有2个成员'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            # 检查是否已存在相同的私聊
            other_user_id = valid_member_ids[0]
            existing_room = ChatRoom.objects.filter(
                room_type='private',
                members=request.user
            ).filter(
                members__id=other_user_id
            ).first()

            if existing_room:

                obj = ChatRoomDeleteStatus.objects.filter(chat_room=existing_room, user=request.user).first()
                if obj and obj.is_deleted:
                    # 恢复已删除的私聊
                    obj.is_deleted = False
                    obj.deleted_at = None
                    obj.save()

                # 返回已存在的私聊
                serializer = self.get_serializer(existing_room)
                return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            name = request.data.get('name', '')
            if not name:
                return Response(
                    {'error': '群聊名称不能为空'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if ChatRoom.objects.filter(name=name).exists():
                return Response(
                    {'error': '群聊名称已存在'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        try:
            # 创建聊天室 - 必须设置 creator
            chat_room = ChatRoom.objects.create(
                room_type=room_type,
                name=request.data.get('name', ''),
                creator=request.user  # ← 关键修复：设置 creator
            )

            # 添加成员（包括创建者）
            chat_room.members.add(request.user)

            # 添加其他成员
            if valid_member_ids:
                try:
                    chat_room.members.add(*valid_member_ids)
                except Exception as e:
                    # 如果添加成员失败，删除聊天室并返回错误
                    chat_room.delete()
                    return Response(
                        {'error': f'添加成员失败: {str(e)}'},
                        status=status.HTTP_400_BAD_REQUEST
                    )

            serializer = self.get_serializer(chat_room)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {'error': f'创建聊天室失败: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        """添加成员"""
        try:
            chat_room = ChatRoom.objects.get(pk=pk)
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

        if chat_room.room_type != 'group':
            return Response({'error': '只能向群聊添加成员'}, status=status.HTTP_400_BAD_REQUEST)

        if chat_room.creator != request.user:
            return Response({'error': '只有群主才能添加成员'}, status=status.HTTP_403_FORBIDDEN)

        member_id = request.data.get('member_id')

        if not member_id:
            return Response(
                {'error': '缺少member_id'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            chat_room.members.add(member_id)
            return Response({'status': 'success'})
        except Exception as e:
            return Response(
                {'error': f'添加成员失败: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        """移除成员"""
        try:
            chat_room = ChatRoom.objects.get(pk=pk)
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

        if chat_room.room_type != 'group':
            return Response({'error': '只能从群聊移除成员'}, status=status.HTTP_400_BAD_REQUEST)

        if chat_room.creator != request.user:
            return Response({'error': '只有群主才能移除成员'}, status=status.HTTP_403_FORBIDDEN)

        member_id = request.data.get('member_id')

        if not member_id:
            return Response(
                {'error': '缺少member_id'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # 不能移除自己
            if int(member_id) == request.user.id:
                return Response({'error': '不能移除自己'}, status=status.HTTP_400_BAD_REQUEST)

            chat_room.members.remove(member_id)
            return Response({'status': 'success'})
        except Exception as e:
            return Response(
                {'error': f'移除成员失败: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=True, methods=['post'])
    def pin_chat(self, request, pk=None):
        """置顶聊天"""
        try:
            logger.info(f'{request.user} 置顶聊天 {pk}')
            chat_room = ChatRoom.objects.get(id=pk, members=request.user)

            if not chat_room.members.filter(id=request.user.id).exists():
                return Response({'error': '你没有权限置顶此聊天'}, status=status.HTTP_403_FORBIDDEN)

            chat_room.is_pinned = not chat_room.is_pinned
            chat_room.save()
            return Response({'is_pinned': chat_room.is_pinned})
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'])
    def mute_chat(self, request, pk=None):
        """消息免打扰"""
        try:
            chat_room = ChatRoom.objects.get(id=pk, members=request.user)
            if not chat_room.members.filter(id=request.user.id).exists():
                return Response({'error': '你没有权限操作此聊天'}, status=status.HTTP_403_FORBIDDEN)
            chat_room.is_muted = not chat_room.is_muted
            chat_room.save()
            return Response({'is_muted': chat_room.is_muted})
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['delete'])
    def clear_history(self, request, pk=None):
        """清空聊天记录"""
        logger.info(f'{request.user} 清空聊天记录 {pk}')
        chat_room = self.get_object()
        logger.info(f'{request.user} 清空聊天记录 {pk} {chat_room.messages.count()}')

        # 软删除
        chat_room.messages.filter(is_deleted=False).update(is_deleted=True)
        MessageReadStatus.objects.filter(message__chat_room=chat_room).delete()
        Message.objects.filter(chat_room=chat_room).update(is_deleted=True)

        # chat_room.messages.all().delete()

        return Response({'message': '聊天记录已清空'})

    @action(detail=False, methods=['get'])
    def search_chats(self, request):
        """
        搜索聊天（支持按聊天室名称、成员信息搜索）
        """
        query = request.query_params.get('q', '').strip()

        if not query:
            return Response([])

        # 获取用户参与的所有聊天室（QuerySet）
        all_rooms = ChatRoom.objects.filter(members=request.user)

        # 用Python过滤已删除的聊天室（与get_queryset逻辑一致）
        filtered_room_ids = []
        for room in all_rooms:
            if room.room_type == 'private':
                # 私聊：检查用户个人删除状态
                try:
                    status_obj = ChatRoomDeleteStatus.objects.get(chat_room=room, user=request.user)
                    if not status_obj.is_deleted:
                        filtered_room_ids.append(room.id)
                except ChatRoomDeleteStatus.DoesNotExist:
                    filtered_room_ids.append(room.id)
            else:
                # 群聊：检查全局删除状态
                if not room.is_deleted:
                    filtered_room_ids.append(room.id)

        # 用过滤后的ID列表构建新的QuerySet
        user_rooms = ChatRoom.objects.filter(id__in=filtered_room_ids)

        # 按多个维度搜索：聊天室名称、成员用户名/真实姓名
        # 注意：移除 last_message__content（ChatRoom模型无此字段）
        queryset = user_rooms.filter(
            Q(name__icontains=query) |  # 群聊名称
            Q(members__username__icontains=query) |  # 成员用户名
            Q(members__real_name__icontains=query)  # 成员真实姓名
        ).distinct().order_by('-updated_at')

        # 分页处理
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def search(self, request):
        """
        搜索群组（仅搜索群聊，支持按群组名称、成员信息搜索）
        """
        query = request.query_params.get('q', '').strip()

        if not query:
            return Response([])

        # 获取用户参与的所有群聊（QuerySet）
        all_rooms = ChatRoom.objects.filter(members=request.user, room_type='group')

        # 过滤已删除的群聊
        filtered_room_ids = []
        for room in all_rooms:
            if not room.is_deleted:
                filtered_room_ids.append(room.id)

        # 用过滤后的ID列表构建新的QuerySet
        user_rooms = ChatRoom.objects.filter(id__in=filtered_room_ids)

        # 按群组名称、成员信息搜索
        queryset = user_rooms.filter(
            Q(name__icontains=query) |  # 群组名称
            Q(members__username__icontains=query) |  # 成员用户名
            Q(members__real_name__icontains=query) |  # 成员真实姓名
            Q(members__department__name__icontains=query) |  # 成员部门
            Q(members__position__icontains=query)  # 成员职位
        ).distinct().order_by('-updated_at')

        # 分页处理
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        """获取单个聊天室详情"""
        try:
            pk = kwargs['pk']
            logger.info(f'{request.user} pk: {pk}')
            instance = ChatRoom.objects.get(id=pk)
            logger.info(f'{request.user} 获取聊天室详情 {instance}')
            # 确保用户是该聊天室成员
            if not instance.members.filter(id=request.user.id).exists():
                return Response({'error': '无权访问该聊天室'}, status=status.HTTP_403_FORBIDDEN)

            serializer = self.get_serializer(instance)
            return Response(serializer.data)
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"获取聊天室详情失败: {e}")
            return Response({'error': '服务器内部错误'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class MessagePagination(PageNumberPagination):
    """消息分页器 - 支持无限滚动"""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200



class MessageViewSet(viewsets.ModelViewSet):
    """消息视图集"""
    queryset = Message.objects.select_related('sender', 'chat_room', 'file', 'quote_message')
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = MessagePagination  # 启用分页

    def get_queryset(self):
        # 获取查询参数
        chat_room_id = self.request.query_params.get('chat_room_id')
        before_id = self.request.query_params.get('before_id')  # 加载更早的消息
        after_id = self.request.query_params.get('after_id')  # 加载更新的消息

        # 构建基础查询集
        if chat_room_id:
            queryset = Message.objects.filter(
                chat_room_id=chat_room_id,
                chat_room__members=self.request.user,
                is_deleted=False
            )
        else:
            queryset = Message.objects.filter(
                chat_room__members=self.request.user,
                is_deleted=False
            )

        # 🔧 优化：使用数据库查询过滤已删除的消息，避免Python循环
        from django.db.models import Subquery, OuterRef

        deleted_message_ids = MessageDeleteStatus.objects.filter(
            user=self.request.user,
            is_deleted=True,
            message=OuterRef('pk')
        ).values('message')

        queryset = queryset.exclude(id__in=Subquery(deleted_message_ids))

        # 🔧 支持 before_id 参数（加载更早的消息）
        if before_id:
            try:
                before_message = Message.objects.get(id=before_id)
                queryset = queryset.filter(timestamp__lt=before_message.timestamp)
            except Message.DoesNotExist:
                pass

        # 🔧 支持 after_id 参数（加载更新的消息）
        if after_id:
            try:
                after_message = Message.objects.get(id=after_id)
                queryset = queryset.filter(timestamp__gt=after_message.timestamp)
            except Message.DoesNotExist:
                pass

        # 按时间倒序（最新消息在前）
        queryset = queryset.order_by('-timestamp')

        return queryset.select_related('sender', 'chat_room', 'file', 'quote_message')


    def perform_create(self, serializer):
        # 获取当前用户作为 sender
        sender = self.request.user
        if not sender.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)

        # 构造数据字典
        data = serializer.validated_data
        data['sender'] = sender  # 显式设置 sender

        # 创建消息实例
        message = Message.objects.create(**data)

        # 🔧 保存引用字段
        quote_message_id = data.get('quote_message_id')
        quote_content = data.get('quote_content')
        quote_sender = data.get('quote_sender')
        quote_sender_id = data.get('quote_sender_id')
        quote_timestamp = data.get('quote_timestamp')
        quote_message_type = data.get('quote_message_type')

        # 保存引用字段
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
            try:
                message.quote_sender_id = int(quote_sender_id)
            except (ValueError, TypeError):
                pass

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

        # 如果有 file_id，关联 FileUpload
        message_type = data.get('message_type')
        file_id = data.get('file_id')  # 新增：从前端接收 file_id
        if file_id and message_type in ['image', 'file', 'video', 'voice']:
            try:
                file_upload = FileUpload.objects.get(id=file_id)
                message.file = file_upload
                message.save(update_fields=['file'])
            except FileUpload.DoesNotExist:
                pass

        # 更新聊天室时间戳
        message.chat_room.updated_at = timezone.now()
        message.chat_room.save(update_fields=['updated_at'])

        # 保存所有字段（包括引用字段）
        message.save()

        serializer.instance = message
        return message


    @action(detail=True, methods=['delete'])
    def soft_delete(self, request, pk=None):
        """软删除消息"""
        message = self.get_object()

        # 只有发送者或聊天室创建者可以删除消息
        if message.sender != request.user and message.chat_room.creator != request.user:
            return Response({'error': '无权限删除此消息'}, status=status.HTTP_403_FORBIDDEN)

        message.soft_delete()
        return Response({'message': '消息已删除'})

    @action(detail=False, methods=['delete'])
    def clear_history(self, request):
        """清空聊天记录"""
        chat_room_id = request.data.get('chat_room_id')
        if not chat_room_id:
            return Response({'error': '缺少 chat_room_id'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            chat_room = ChatRoom.objects.get(id=chat_room_id, members=request.user)

            # 使用 MessageDeleteStatus
            all_messages = Message.objects.filter(chat_room=chat_room, chat_room__members=request.user)

            result = 0
            for message in all_messages:
                try:
                    obj, created = MessageDeleteStatus.objects.get_or_create(message=message, user=request.user)
                    if not obj.is_deleted:
                        obj.is_deleted = True
                        obj.deleted_at = timezone.now()
                        obj.save()
                        result += 1
                except MessageDeleteStatus.DoesNotExist:
                    MessageDeleteStatus.objects.create(message=message, user=request.user, is_deleted=True,
                                                       deleted_at=timezone.now())
                    result += 1

            logger.info(f'{request.user} 聊天记录已清空 {chat_room_id} {result}')

            return Response({'message': '聊天记录已清空'})
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """获取未读消息数"""
        chat_room_id = request.query_params.get('chat_room_id')
        logger.info(f"{request.user} chat_room_id: {chat_room_id} 获取未读消息数")

        if chat_room_id:
            if not ChatRoom.objects.filter(id=chat_room_id, members=request.user).exists():
                return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

            count = Message.objects.filter(
                chat_room_id=chat_room_id,
                chat_room__members=request.user,
                is_deleted=False
            ).exclude(
                read_statuses__user=request.user
            ).count()
        else:
            count = Message.objects.filter(
                chat_room__members=request.user,
                is_deleted=False
            ).exclude(
                read_statuses__user=request.user
            ).count()

        logger.info(f"chat_room_id: {chat_room_id} count: {count}")

        return Response({'chat_room_id': chat_room_id, 'unread_count': count})


    @action(detail=False, methods=['post'])
    def mark_as_read(self, request):
        """批量标记消息为已读"""
        message_ids = request.data.get('message_ids', [])
        chat_room_id = request.data.get('chat_room_id')


        if not chat_room_id:
            return Response({'error': '缺少 chat_room_id'}, status=status.HTTP_400_BAD_REQUEST)

        # 获取聊天室实例
        try:
            chat_room = ChatRoom.objects.get(id=chat_room_id, members=request.user)
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)


        # 遍历消息 ID 并标记为已读 使用 MessageReadStatus
        for msg_id in message_ids:
            try:
                message = Message.objects.get(id=msg_id, chat_room=chat_room)
                # ✅ 确保传递 message 字段
                MessageReadStatus.objects.get_or_create(
                    message=message,
                    user=request.user
                )
            except Message.DoesNotExist:
                logger.info(f"message {msg_id} 不存在")
                continue
        return Response({'status': 'success'})

    @action(detail=False, methods=['post'])
    def revoke(self, request, pk=None):
        """撤销消息（10分钟内）"""
        try:
            logger.info(f"{request.user} 撤销消息pk: {pk}")
            message = Message.objects.get(id=pk)

            logger.info(f"{request.user} 撤销消息 {message}")
            logger.info(f"{request.user} 撤销消息id: {message.id}")

            # 检查是否是发送者
            if message.sender != request.user:
                return Response({'error': '无权限撤销此消息'}, status=status.HTTP_403_FORBIDDEN)

            # 检查是否在10分钟内
            time_diff = timezone.now() - message.timestamp
            if time_diff.total_seconds() > 600:  # 10分钟
                return Response({'error': '消息已超过可撤销时间（10分钟）'}, status=status.HTTP_400_BAD_REQUEST)

            # 撤销消息（软删除）
            message.is_deleted = True
            message.deleted_at = timezone.now()
            message.content = '[消息已撤销]'
            message.save(update_fields=['is_deleted', 'deleted_at', 'content'])

            # 🔧 关键修复16: 更新聊天室最后一条消息
            chat_room = message.chat_room
            chat_room.updated_at = timezone.now()
            chat_room.save(update_fields=['updated_at'])

            # 🔧 关键修复17: 通过WebSocket通知聊天室其他成员
            if chat_room:
                from channels.layers import get_channel_layer
                from asgiref.sync import async_to_sync

                channel_layer = get_channel_layer()
                async_to_sync(channel_layer.group_send)(
                    f'chat_{chat_room.id}',
                    {
                        'type': 'chat_message',
                        'message': {
                            'type': 'message_revoked',
                            'id': message.id,
                            'message_id': message.id,
                            'revoked_at': message.deleted_at.isoformat(),
                            'sender_id': message.sender.id,
                            'sender_name': message.sender.real_name or message.sender.username,
                            'chat_room_id': chat_room.id, # 🔧 新增：包含聊天室ID
                            'room_type': chat_room.room_type,
                            'content': '[消息已撤销]',
                            # 🔧 广播引用字段（如果存在）
                            'quote_message_id': message.quote_message_id,
                            'quote_content': message.quote_content,
                            'quote_sender': message.quote_sender,
                            'quote_sender_id': message.quote_sender_id,
                            'quote_timestamp': message.quote_timestamp.isoformat() if message.quote_timestamp else None,
                            'quote_message_type': message.quote_message_type,
                        }
                    }
                )

                # 🔧 关键修复19: 同时发送全局通知（更新聊天列表）
                async_to_sync(channel_layer.group_send)(
                    f'user_{request.user.id}_notifications',
                    {
                        'type': 'room_updated',
                        'room_id': chat_room.id,
                        'room': ChatRoomSerializer(chat_room, context={'request': request}).data
                    }
                )

                # 通知其他成员
                for member in chat_room.members.exclude(id=request.user.id):
                    async_to_sync(channel_layer.group_send)(
                        f'user_{member.id}_notifications',
                        {
                            'type': 'room_updated',
                            'room_id': chat_room.id,
                            'room': ChatRoomSerializer(chat_room, context={'request': request}).data
                        }
                    )

            return Response({
                'message': '消息已撤销',
                'message_id': message.id,
                'revoked_at': message.deleted_at.isoformat()
            })

        except Message.DoesNotExist:
            logger.info(f"message {pk} 不存在")
            return Response({'error': '消息不存在'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error: {e}")
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class FileUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        file = request.FILES.get('file')
        if not file:
            return Response({'error': '没有文件'}, status=status.HTTP_400_BAD_REQUEST)

        # 检查文件大小
        if file.size == 0:
            return Response({'error': '上传的文件大小为 0'}, status=status.HTTP_400_BAD_REQUEST)

        # 缓存文件内容
        file_content = file.read()
        logger.info(f"File content length: {len(file_content)}")

        # 计算文件MD5
        md5_hash = hashlib.md5()
        md5_hash.update(file_content)
        file_md5 = md5_hash.hexdigest()

        # 检查是否已存在相同文件
        try:
            existing_file = FileUpload.objects.get(md5=file_md5)
            logger.info(f"文件MD5已存在: {file_md5}, 复用现有文件")

            return Response({
                'file_url': existing_file.file.url,
                'filename': existing_file.filename,
                'size': existing_file.size,
                'md5': existing_file.md5,
                'exists': True,
                'mime_type': existing_file.mime_type,
                'file_id': existing_file.id,  # 返回 FileUpload ID
                'id': existing_file.id,  # 返回 FileUpload ID
                # 🔧 返回MP3 URL（如果存在）
                'mp3_url': existing_file.get_mp3_url() if existing_file.mp3_status == 'completed' else None,
                'mp3_status': existing_file.mp3_status,
                'duration': existing_file.duration,  # 🔧 返回精确时长
                'is_ios_compatible': existing_file.mp3_status == 'completed' and bool(existing_file.mp3_file)
            })
        except FileUpload.DoesNotExist:
            pass


        # 保存新文件
        filename = f"{request.user.id}_{timezone.now().strftime('%Y%m%d%H%M%S')}_{file.name}"
        file_path = default_storage.save(f'chat/uploads/{filename}', ContentFile(file_content))
        file_url = default_storage.url(file_path)

        # 创建 FileUpload 记录
        file_upload = FileUpload.objects.create(
            md5=file_md5,
            file=file_path,
            filename=file.name,
            size=file.size,
            mime_type=file.content_type or '',
            uploaded_by=request.user,
            # 🔧 关键修复：根据文件类型设置初始转码状态
            mp3_status='pending' if self.is_audio_file(file.content_type or '') else 'completed'
        )

        # 🔧 关键修复2: 如果是语音消息，根据设备类型决定转码策略, 关键修复：如果是语音消息，尝试转码为MP3（iOS兼容）
        if file_upload.get_file_type() == 'voice' or self.is_audio_file(file.content_type or ''):
            duration = self.extract_audio_duration(file_upload.file.path)
            if duration:
                file_upload.duration = duration
                file_upload.save(update_fields=['duration'])
                logger.info(f"file_upload {file_upload.id} 提取音频时长: {duration}秒")

            # 标记为转码中
            file_upload.mp3_status = 'converting'
            file_upload.save(update_fields=['mp3_status'])

            # 在事务提交后触发异步转码
            # transaction.on_commit(lambda: self.trigger_async_conversion(file_upload))

            if self.is_ios_request(request) or self.is_android_request(request):
                # iOS设备：同步转码（用户需要立即播放）
                logger.info(f"iOS设备: 同步转码")
                self.convert_to_mp3(file_upload, file_content)
            else:
                # 非iOS设备：异步转码（提高响应速度）
                logger.info(f"非iOS设备: 异步转码")
                transaction.on_commit(lambda: self.async_convert_to_mp3(file_upload, file_content))

        return Response({
            'file_url': file_url,
            'filename': file.name,
            'size': file.size,
            'md5': file_md5,
            'exists': False,
            'mime_type': file.content_type or '',
            'file_id': file_upload.id,
            'id': file_upload.id,
            'mp3_url': file_upload.get_mp3_url() if file_upload.mp3_status == 'completed' else None,
            'mp3_status': file_upload.mp3_status,
            'duration': file_upload.duration,  # 🔧 返回精确时长
            'is_ios_compatible': file_upload.mp3_status == 'completed' and bool(file_upload.mp3_file)
        })

    def is_audio_file(self, mime_type):
        """判断是否为音频文件"""
        mime_type = mime_type.lower()
        audio_extensions = ('.webm', '.ogg', '.m4a', '.mp3', '.wav', '.aac', '.flac')
        return mime_type.startswith('audio/') or any(mime_type.endswith(ext) for ext in audio_extensions)

    def extract_audio_duration(self, file_path):
        """使用 ffprobe 提取音频时长（秒）"""
        try:
            # 检查 ffprobe 是否可用
            if not shutil.which('ffprobe'):
                logger.warning("ffprobe not found, skipping duration extraction")
                return None

            # 使用 ffprobe 获取音频时长
            result = subprocess.run([
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                file_path
            ], capture_output=True, text=True, timeout=10)

            if result.returncode == 0 and result.stdout.strip():
                duration = float(result.stdout.strip())
                # 限制时长在 1-60 秒之间（语音消息限制）
                return max(1.0, min(60.0, duration))
            else:
                logger.warning(f"ffprobe failed for {file_path}: {result.stderr}")
                return None

        except (subprocess.TimeoutExpired, subprocess.CalledProcessError, ValueError, Exception) as e:
            logger.error(f"提取音频时长失败: {file_path}, error: {str(e)}")
            return None


    def is_ios_request(self, request):
        """检测请求是否来自iOS设备"""
        user_agent = request.META.get('HTTP_USER_AGENT', '').lower()
        return 'iphone' in user_agent or 'ipad' in user_agent or 'ipod' in user_agent

    def is_android_request(self, request):
        """检测请求是否来自Android设备"""
        user_agent = request.META.get('HTTP_USER_AGENT', '').lower()
        return 'android' in user_agent or 'mobile' in user_agent

    def trigger_async_conversion(self, file_upload):
        """触发异步转码（在独立线程中执行）"""
        import threading

        def convert_in_thread():
            try:
                logger.info(f"开始异步转码文件: {file_upload.id}")
                success = self.convert_to_mp3_sync(file_upload)

                if success and file_upload.mp3_file:
                    logger.info(f"文件 {file_upload.id} 转码成功")
                else:
                    logger.error(f"文件 {file_upload.id} 转码失败")

            except Exception as e:
                logger.error(f"异步转码异常: {file_upload.id}, error: {str(e)}", exc_info=True)
            finally:
                # 确保状态被更新（即使失败）
                file_upload.refresh_from_db()
                if file_upload.mp3_status == 'converting':
                    file_upload.mp3_status = 'failed' if not file_upload.mp3_file else 'completed'
                    file_upload.save(update_fields=['mp3_status'])

        # 在独立线程中执行转码（避免阻塞 Django worker）
        thread = threading.Thread(target=convert_in_thread, daemon=True)
        thread.start()

    def convert_to_mp3_sync(self, file_upload):
        """同步转码为 MP3 格式（在独立线程中调用）"""
        import shutil
        import subprocess
        import os
        from django.core.files.base import ContentFile

        try:
            # 检查 ffmpeg 是否可用
            if not shutil.which('ffmpeg'):
                logger.warning("ffmpeg not found, skipping MP3 conversion")
                return False

            # 获取原始文件路径
            original_path = file_upload.file.path

            # 准备输出路径
            mp3_filename = f"{os.path.splitext(file_upload.filename)[0]}.mp3"
            mp3_dir = os.path.join(settings.MEDIA_ROOT, 'chat', 'uploads', 'mp3')
            os.makedirs(mp3_dir, exist_ok=True)
            mp3_path = os.path.join(mp3_dir,
                                    f"{file_upload.uploaded_by.id}_{timezone.now().strftime('%Y%m%d%H%M%S')}_{mp3_filename}")

            # 使用 ffmpeg 转码（优化参数，iOS 兼容）
            subprocess.run([
                'ffmpeg', '-y', '-i', original_path,
                '-acodec', 'libmp3lame',
                '-ab', '128k',
                '-ar', '44100',  # iOS 推荐采样率
                '-ac', '2',  # 双声道
                mp3_path
            ], check=True, capture_output=True, timeout=30)

            # 保存 MP3 文件到模型
            with open(mp3_path, 'rb') as f:
                relative_path = os.path.relpath(mp3_path, settings.MEDIA_ROOT)
                file_upload.mp3_file.name = relative_path
                file_upload.mp3_status = 'completed'
                file_upload.save(update_fields=['mp3_file', 'mp3_status'])

            logger.info(f"成功转码语音文件 {file_upload.id} 为 MP3: {mp3_path}")
            return True

        except subprocess.TimeoutExpired:
            logger.error(f"转码超时: {file_upload.id}")
        except subprocess.CalledProcessError as e:
            logger.error(f"转码失败: {file_upload.id}, stderr: {e.stderr.decode()[:200]}")
        except FileNotFoundError:
            logger.warning("ffmpeg 未安装，跳过转码")
        except Exception as e:
            logger.error(f"转码异常: {file_upload.id}, error: {str(e)}", exc_info=True)
        finally:
            # 清理临时文件
            if 'mp3_path' in locals() and os.path.exists(mp3_path):
                try:
                    pass
                    # os.remove(mp3_path)
                except:
                    pass

        return False

    def ensure_mp3_conversion(self, file_upload):
        """确保语音文件已转码为MP3（如果尚未转码）"""
        if not file_upload.mp3_converted and file_upload.get_file_type() == 'voice':
            self.convert_to_mp3(file_upload)

    def convert_to_mp3(self, file_upload, file_content=None):
        """同步转码为MP3格式（iOS兼容）"""
        try:
            # 检查ffmpeg是否可用
            if not shutil.which('ffmpeg'):
                logger.warning("ffmpeg not found, skipping MP3 conversion")
                return

            # 获取原始文件路径
            if file_content:
                # 从内存转码（避免二次读取磁盘）
                temp_input = os.path.join('/tmp', f'temp_{file_upload.id}.webm')
                with open(temp_input, 'wb') as f:
                    f.write(file_content)
                input_path = temp_input
                cleanup_input = True
            else:
                input_path = file_upload.file.path
                cleanup_input = False

            # 准备输出路径
            mp3_filename = f"{os.path.splitext(file_upload.filename)[0]}.mp3"
            mp3_dir = os.path.join(settings.MEDIA_ROOT, 'chat', 'uploads', 'mp3')
            os.makedirs(mp3_dir, exist_ok=True)
            mp3_path = os.path.join(mp3_dir,
                                    f"{file_upload.uploaded_by.id}_{timezone.now().strftime('%Y%m%d%H%M%S')}_{mp3_filename}")

            # 使用ffmpeg转码（优化参数，iOS兼容）
            p = subprocess.run([
                'ffmpeg', '-y', '-i', input_path,
                '-acodec', 'libmp3lame',
                '-ab', '128k',
                '-ar', '44100',  # iOS 推荐采样率
                '-ac', '2',  # 双声道
                mp3_path
            ], check=True, capture_output=True, timeout=60)

            logger.info(f"转码输出: {p.stdout.decode()}")

            # 保存MP3文件到模型
            with open(mp3_path, 'rb') as f:
                relative_path = os.path.relpath(mp3_path, settings.MEDIA_ROOT)
                file_upload.mp3_file.name = relative_path

                file_upload.mp3_status = 'completed'
                file_upload.mp3_converted = True
                file_upload.save(update_fields=['mp3_file', 'mp3_converted', 'mp3_status'])

            logger.info(f"成功转码语音文件 {file_upload.id} input_path: {input_path}")
            logger.info(f"成功转码语音文件 {file_upload.id} 为MP3: {mp3_path}")
            logger.info(f"成功转码语音文件 {file_upload.id} 为MP3: {os.path.exists(mp3_path)}")

            # 清理临时文件
            if cleanup_input and os.path.exists(input_path):
                os.remove(input_path)
            # if os.path.exists(mp3_path):
            #     os.remove(mp3_path)

        except subprocess.TimeoutExpired:
            logger.error(f"转码超时: {file_upload.id}")
        except subprocess.CalledProcessError as e:
            logger.error(f"转码失败: {file_upload.id}, stderr: {e.stderr.decode()[:200]}")
        except FileNotFoundError:
            logger.warning("ffmpeg 未安装，跳过转码")
        except Exception as e:
            logger.error(f"转码异常: {file_upload.id}, error: {str(e)}", exc_info=True)
        finally:
            # 确保状态及时更新，即使是失败

            if file_upload.mp3_status == 'converting':
                if not file_upload.mp3_file:
                    file_upload.mp3_converted = False
                    file_upload.mp3_status = 'failed'
                    logger.info(f"转码失败: {file_upload.id}")
                else:
                    file_upload.mp3_converted = True
                    file_upload.mp3_status = 'completed'
                    logger.info(f"转码成功: {file_upload.id}")
                file_upload.save(update_fields=['mp3_converted', 'mp3_status'])

            # 确保清理临时文件
            if 'input_path' in locals() and cleanup_input and os.path.exists(input_path):
                try:
                    os.remove(input_path)
                except:
                    pass
            # if 'mp3_path' in locals() and os.path.exists(mp3_path):
            #     try:
            #         os.remove(mp3_path)
            #     except:
            #         pass

    def async_convert_to_mp3(self, file_upload, file_content=None):
        """异步转码（在事务提交后执行）"""
        # 简单实现：直接调用（生产环境建议使用Celery）
        self.convert_to_mp3(file_upload, file_content)


# chat/views.py - 新增视图

class AudioFormatView(APIView):
    """按需提供音频格式转换"""
    permission_classes = [permissions.IsAuthenticated]


    def get(self, request, file_id):
        try:
            format = request.query_params.get('format', '')
            logger.info(f"Getting audio format for file: {file_id} format: {format}")
            format = format or 'mp3'

            # 🔧 关键修复1: 验证 file_id 是整数
            try:
                file_id = int(file_id)
            except (ValueError, TypeError):
                return Response({'error': '无效的文件ID'}, status=status.HTTP_400_BAD_REQUEST)

            # 检查请求的格式
            if format != 'mp3':
                return Response({'error': '仅支持 MP3 格式转换'}, status=status.HTTP_400_BAD_REQUEST)

            # 获取文件记录
            try:
                file_upload = FileUpload.objects.get(id=file_id)
            except FileUpload.DoesNotExist:
                logger.error(f"文件不存在或无权限: {file_id}, user: {request.user.id}")
                return Response({'error': '文件不存在或无访问权限'}, status=status.HTTP_404_NOT_FOUND)

            logger.info(f"File found: {file_upload} file_upload.mp3_file: {file_upload.mp3_file}")
            logger.info(f"File found: {file_upload} file_upload.mp3_converted: {file_upload.mp3_converted}")

            # 检查是否为音频文件
            if file_upload.get_file_type() != 'voice':
                return Response({'error': '非音频文件'}, status=status.HTTP_400_BAD_REQUEST)

            # 🔧 关键修复3: 检查转码状态
            if file_upload.mp3_status == 'completed' and file_upload.mp3_file:
                logger.info(f"文件 {file_id} 已有 MP3 格式: {file_upload.mp3_file.url}")
                return Response({
                    'url': file_upload.get_mp3_url(),
                    'is_ready': True,
                    'mime_type': 'audio/mpeg',
                    'status': 'completed'
                })

            # 🔧 关键修复4: 如果是 pending 状态，触发转码
            if file_upload.mp3_status == 'pending':
                # 标记为转码中
                file_upload.mp3_status = 'converting'
                file_upload.save(update_fields=['mp3_status'])

                # 触发异步转码
                transaction.on_commit(lambda: self.trigger_async_conversion(file_upload))

                logger.info(f"已触发文件 {file_id} 的异步转码")
                return Response({
                    'url': file_upload.get_file_url(),
                    'is_ready': False,
                    'converting': True,
                    'status': 'converting',
                    'message': '音频格式转换已启动，请稍后重试'
                }, status=status.HTTP_202_ACCEPTED)

            # 🔧 关键修复5: 如果是 converting 状态，返回转码中
            if file_upload.mp3_status == 'converting':
                logger.info(f"文件 {file_id} 正在转码中")
                return Response({
                    'url': file_upload.get_file_url(),
                    'is_ready': False,
                    'converting': True,
                    'status': 'converting',
                    'message': '音频格式转换中，请稍后重试'
                }, status=status.HTTP_202_ACCEPTED)

            # 转码失败
            if file_upload.mp3_status == 'failed':
                logger.warning(f"文件 {file_id} 转码失败")
                return Response({
                    'error': '音频转码失败，请重试或联系管理员',
                    'url': file_upload.get_file_url(),
                    'status': 'failed'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


            # 默认情况（不应发生）
            return Response({
                'url': file_upload.get_file_url(),
                'is_ready': True,
                'status': 'unknown'
            })


        except FileUpload.DoesNotExist:
            logger.error(f"文件不存在: {file_id}")
            return Response({'error': '文件不存在'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"音频格式请求失败: {e}")
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def trigger_async_conversion(self, file_upload):
        """复用 FileUploadView 的异步转码方法"""
        from .views import FileUploadView
        view = FileUploadView()
        view.trigger_async_conversion(file_upload)



    def convert_to_mp3_sync(self, file_upload):
        """同步转码为 MP3 格式"""
        try:
            # 检查 ffmpeg 是否可用
            if not shutil.which('ffmpeg'):
                logger.warning("ffmpeg not found, skipping MP3 conversion")
                return False

            # 获取原始文件路径
            original_path = file_upload.file.path

            # 准备输出路径
            mp3_filename = f"{os.path.splitext(file_upload.filename)[0]}.mp3"
            mp3_dir = os.path.join(settings.MEDIA_ROOT, 'chat', 'uploads', 'mp3')
            os.makedirs(mp3_dir, exist_ok=True)
            mp3_path = os.path.join(mp3_dir,
                                    f"{file_upload.uploaded_by.id}_{timezone.now().strftime('%Y%m%d%H%M%S')}_{mp3_filename}")

            # 标记为转码中（避免重复转码）
            file_upload.mp3_converted = None
            file_upload.save(update_fields=['mp3_converted'])

            # 使用 ffmpeg 转码
            subprocess.run([
                'ffmpeg', '-y', '-i', original_path,
                '-acodec', 'libmp3lame',
                '-ab', '128k',
                '-ar', '44100',
                '-ac', '2',
                mp3_path
            ], check=True, capture_output=True, timeout=60)

            # 保存 MP3 文件到模型
            with open(mp3_path, 'rb') as f:
                relative_path = os.path.relpath(mp3_path, settings.MEDIA_ROOT)
                file_upload.mp3_file.name = relative_path
                file_upload.mp3_converted = True
                file_upload.save(update_fields=['mp3_file', 'mp3_converted'])

            logger.info(f"成功转码语音文件 {file_upload.id} 为 MP3")
            return True

        except subprocess.TimeoutExpired:
            logger.error(f"转码超时: {file_upload.id}")
        except subprocess.CalledProcessError as e:
            logger.error(f"转码失败: {file_upload.id}, stderr: {e.stderr.decode()[:200]}")
        except FileNotFoundError:
            logger.warning(f"转码失败: {file_upload.id} ffmpeg 未安装，跳过转码")
        except Exception as e:
            logger.error(f"转码异常: {file_upload.id}, error: {str(e)}", exc_info=True)
        finally:
            # 清理临时文件
            if 'mp3_path' in locals() and os.path.exists(mp3_path):
                try:
                    pass
                    # os.remove(mp3_path)
                except:
                    pass

        # 转码失败，标记为不可用
        if file_upload.mp3_converted is None:
            file_upload.mp3_converted = False
            file_upload.save(update_fields=['mp3_converted'])
        return False


    def convert_to_mp3(self, file_upload):
        """同步转码为MP3格式"""
        try:
            # 检查ffmpeg是否可用
            if not shutil.which('ffmpeg'):
                logger.warning("ffmpeg not found, skipping MP3 conversion")
                return

            # 获取原始文件路径
            original_path = file_upload.file.path
            mp3_filename = f"{os.path.splitext(file_upload.filename)[0]}.mp3"
            mp3_dir = os.path.join(settings.MEDIA_ROOT, 'chat', 'uploads', 'mp3')
            os.makedirs(mp3_dir, exist_ok=True)
            mp3_path = os.path.join(mp3_dir,
                                    f"{file_upload.uploaded_by.id}_{timezone.now().strftime('%Y%m%d%H%M%S')}_{mp3_filename}")

            # 使用ffmpeg转码（优化参数）
            subprocess.run([
                'ffmpeg', '-y', '-i', original_path,
                '-acodec', 'libmp3lame',
                '-ab', '128k',
                '-ar', '44100',  # iOS 推荐采样率
                '-ac', '2',  # 双声道
                mp3_path
            ], check=True, capture_output=True, timeout=30)

            # 保存MP3文件到模型
            with open(mp3_path, 'rb') as f:
                relative_path = os.path.relpath(mp3_path, settings.MEDIA_ROOT)
                file_upload.mp3_file.name = relative_path
                file_upload.mp3_converted = True
                file_upload.save(update_fields=['mp3_file', 'mp3_converted'])

            logger.info(f"成功转码语音文件 {file_upload.id} 为MP3: {mp3_path}")

        except subprocess.TimeoutExpired:
            logger.error(f"转码超时: {file_upload.id}")
        except subprocess.CalledProcessError as e:
            logger.error(f"转码失败: {file_upload.id}, stderr: {e.stderr.decode()[:200]}")
        except FileNotFoundError:
            logger.warning("ffmpeg 未安装，跳过转码")
        except Exception as e:
            logger.error(f"转码异常: {file_upload.id}, error: {str(e)}", exc_info=True)
        finally:
            # 清理临时文件（如果存在）
            if 'mp3_path' in locals() and os.path.exists(mp3_path):
                try:
                    os.remove(mp3_path)
                except:
                    pass

    def async_convert_to_mp3(self, file_upload):
        """异步转码（在事务提交后执行）"""
        # 简单实现：直接调用（生产环境建议使用Celery）
        self.convert_to_mp3(file_upload)


class ChatRoomAdminViewSet(viewsets.ModelViewSet):
    """聊天室管理视图集（管理员专用）"""
    queryset = ChatRoom.objects.all()
    serializer_class = ChatRoomSerializer
    permission_classes = [IsAdminOrSuperAdmin]

    def get_queryset(self):
        queryset = super().get_queryset()

        # 支持搜索
        search = self.request.query_params.get('search', '')
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(members__username__icontains=search) |
                Q(members__real_name__icontains=search)
            ).distinct()

        # 支持按类型过滤
        room_type = self.request.query_params.get('room_type', '')
        if room_type:
            queryset = queryset.filter(room_type=room_type)

        return queryset.order_by('-updated_at')

    @action(detail=True, methods=['post'])
    def force_delete(self, request, pk=None):
        """强制删除聊天室（管理员专用）"""
        chat_room = self.get_object()

        # 记录删除操作
        logger.info(f"Admin {request.user.username} force deleted chat room {chat_room.id}")

        chat_room.delete()

        return Response({'message': '聊天室已删除'})

    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """获取聊天室统计信息"""
        total_rooms = self.queryset.count()
        private_rooms = self.queryset.filter(room_type='private').count()
        group_rooms = self.queryset.filter(room_type='group').count()

        # 获取最近活跃的聊天室
        from django.db.models import Count
        active_rooms = self.queryset.annotate(
            message_count=Count('messages')
        ).filter(
            message_count__gt=0
        ).order_by('-message_count')[:10]

        active_data = [{
            'id': room.id,
            'name': room.name or '私聊',
            'type': room.room_type,
            'member_count': room.members.count(),
            'message_count': room.message_count,
        } for room in active_rooms]

        return Response({
            'total_rooms': total_rooms,
            'private_rooms': private_rooms,
            'group_rooms': group_rooms,
            'active_rooms': active_data,
        })
