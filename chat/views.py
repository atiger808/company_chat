# chat/views.py
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q, Count
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone

from django.http import JsonResponse
from django.views.decorators.http import require_GET
import hashlib

from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
import os

from .models import ChatRoom, Message, MessageReadStatus, MessageDeleteStatus, ChatRoomDeleteStatus, FileUpload
from .serializers import ChatRoomSerializer, MessageSerializer
from accounts.views import IsAdminOrSuperAdmin
from loguru import logger


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
                if not room.is_deleted:
                    filtered_rooms.append(room)

        return filtered_rooms

    @action(detail=True, methods=['delete'])
    def soft_delete(self, request, pk=None):
        """软删除聊天室"""
        try:
            chat_room = ChatRoom.objects.get(pk=pk, members=request.user)
            logger.info(f"User {request.user} soft deleted chat room {chat_room}. room_type: {chat_room.room_type}")
            # 如果是私聊，只对当前用户隐藏
            if chat_room.room_type == 'private':

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

                return Response({'message': '私聊已从您的列表中移除'})
            else:
                # 如果是群主，则软删除
                if request.user == chat_room.creator:
                    obj, created = ChatRoomDeleteStatus.objects.get_or_create(chat_room=chat_room, user=request.user)
                    logger.info(f"obj {obj} created {created}")
                    if not obj.is_deleted:
                        obj.is_deleted = True
                        obj.deleted_at = timezone.now()
                        obj.save()
                    return Response({'message': '群聊已删除'})
                else:
                    return Response({'message': '只有群主才能删除群聊'})

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


class MessageViewSet(viewsets.ModelViewSet):
    """消息视图集"""
    serializer_class = MessageSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        chat_room_id = self.request.query_params.get('chat_room_id')
        if chat_room_id:
            all_messages = Message.objects.filter(
                chat_room_id=chat_room_id,
                chat_room__members=self.request.user,
                is_deleted=False
            ).order_by('-timestamp')
        else:
            all_messages = Message.objects.filter(
                chat_room__members=self.request.user,
                is_deleted=False
            ).order_by('-timestamp')

        # 过滤已删除的消息
        filtered_messages = []
        for message in all_messages:
            status_obj = MessageDeleteStatus.objects.filter(message=message, user=self.request.user).first()
            if not status_obj:
                filtered_messages.append(message)
            else:
                if not status_obj.is_deleted:
                    filtered_messages.append(message)

        return filtered_messages

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

    # chat/views.py - MessageViewSet

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
        serializer.instance = message

        message_type = data.get('message_type')
        file_url = data.get('file_url')
        file_id = data.get('file_id')  # 新增：从前端接收 file_id

        # 如果有 file_id，关联 FileUpload
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

        return message

    @action(detail=False, methods=['post'])
    def mark_as_read(self, request):
        """批量标记消息为已读"""
        message_ids = request.data.get('message_ids', [])
        chat_room_id = request.data.get('chat_room_id')

        logger.info(f"message_ids: {message_ids}")
        logger.info(f"chat_room_id: {chat_room_id}")

        if not chat_room_id:
            return Response({'error': '缺少 chat_room_id'}, status=status.HTTP_400_BAD_REQUEST)

        # 获取聊天室实例
        try:
            chat_room = ChatRoom.objects.get(id=chat_room_id, members=request.user)
        except ChatRoom.DoesNotExist:
            return Response({'error': '聊天室不存在'}, status=status.HTTP_404_NOT_FOUND)

        logger.info(f"chat_room: {chat_room}")
        logger.info(f"chat_room.room_type: {chat_room.room_type}")
        logger.info(f"chat_room.id: {chat_room.id}")
        logger.info(f"chat_room type: {type(chat_room)}")

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


class FileUploadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        file = request.FILES.get('file')
        if not file:
            return Response({'error': '没有文件'}, status=400)

        # 检查文件大小
        if file.size == 0:
            return Response({'error': '上传的文件大小为 0'}, status=400)

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
                'id': existing_file.id  # 返回 FileUpload ID
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
            uploaded_by=request.user
        )

        return Response({
            'file_url': file_url,
            'filename': file.name,
            'size': file.size,
            'md5': file_md5,
            'exists': False,
            'mime_type': file.content_type or '',
            'file_id': file_upload.id,  # 返回 FileUpload ID
            'id': file_upload.id  # 返回 FileUpload ID
        })


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
