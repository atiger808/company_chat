from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import Task, TaskComment
from chat.models import Message
from .serializers import TaskSerializer, TaskCommentSerializer
import json
from django.utils import timezone


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = Task.objects.filter(
            Q(creator=user) | Q(assignee=user)
        ).distinct().select_related('creator', 'assignee', 'related_chat_room')

        # 🔧 关键修复：处理查询参数
        params = self.request.query_params

        # 1. 按执行人过滤
        assignee_id = params.get('assignee_id')
        if assignee_id:
            queryset = queryset.filter(assignee_id=assignee_id)

        # 2. 按创建者过滤
        creator_id = params.get('creator')
        if creator_id:
            queryset = queryset.filter(creator_id=creator_id)


        # 3. 按截止日期过滤（今日到期）
        due_date = params.get('due_date__date')
        if due_date:
            try:
                from datetime import datetime
                target_date = datetime.strptime(due_date, '%Y-%m-%d').date()
                # 过滤截止日期在当天的任务
                queryset = queryset.filter(
                    due_date__date=target_date
                )
            except ValueError:
                pass

        # 4. 按状态过滤
        status_filter = params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        # 5. 搜索过滤（可选）
        search = params.get('search')
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(description__icontains=search)
            )

        return queryset.order_by('-priority', '-updated_at')

    def perform_create(self, serializer):
        task = serializer.save()
        # 发送系统消息到关联聊天室
        self._send_task_card_message(task, 'created')
        # 如果有执行人，且不是自己，发送 WebSocket 通知
        if task.assignee and task.assignee != self.request.user:
            self._notify_user(task.assignee.id, task, 'assigned')

    @action(detail=True, methods=['post'])
    def change_status(self, request, pk=None):
        """
        更新任务状态与排序（看板拖拽核心）
        更新任务状态并广播到聊天室
        """
        task = self.get_object()
        new_status = request.data.get('status', task.status)
        new_order = request.data.get('order', task.order)
        if new_status in dict(Task.STATUS_CHOICES):
            task.status = new_status
            task.order = new_order
            task.save()



            # 发送状态变更系统消息
            self._send_task_card_message(task, 'status_changed')
            # 🔧 核心：如果任务关联了聊天室，通过 WebSocket 广播状态变更
            self._send_task_update_message(task, 'status_changed', request)
            self._notify_task_participants(task, 'status_changed')
            return Response({'status': 'success', 'new_status': new_status})

        return Response({'error': '无效的状态'}, status=400)


    @action(detail=True, methods=['post'])
    def add_comment(self, request, pk=None):
        task = self.get_object()
        content = request.data.get('content')
        if not content: return Response({'error': '内容不能为空'}, status=400)

        comment = TaskComment.objects.create(task=task, user=request.user, content=content)
        self._notify_task_participants(task, 'new_comment', comment)
        return Response(TaskCommentSerializer(comment).data, status=201)

    def _create_work_notification(self, user_id, task, event_type):
        """创建 WorkNotification 记录（懒导入避免循环依赖）"""
        from oa.models import WorkNotification
        from accounts.models import CustomUser
        status_map = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成'}
        try:
            user = CustomUser.objects.get(id=user_id)
            if event_type == 'assigned':
                title = '新任务分配'
                content = f'{task.creator.real_name or task.creator.username} 给您分配了任务：“{task.title}”'
            elif event_type == 'status_changed':
                title = '任务状态更新'
                content = f'任务“{task.title}”状态变更为：{status_map.get(task.status, task.status)}'
            elif event_type == 'new_comment':
                title = '任务新评论'
                content = f'任务“{task.title}”有新评论'
            else:
                title = '任务通知'
                content = f'任务“{task.title}”有更新'
            WorkNotification.objects.create(
                recipient=user,
                notification_type='task',
                title=title,
                content=content,
                related_url='/tasks/',
                extra_data={'task_id': task.id, 'event_type': event_type},
            )
        except CustomUser.DoesNotExist:
            pass

    def _notify_user(self, user_id, task, event_type):
        """发送 WebSocket 通知到用户的全局通道"""
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'user_{user_id}_notifications',
            {
                'type': 'task.notification',
                'event_type': event_type,
                'task': TaskSerializer(task).data
            }
        )
        # 同时创建工作通知记录
        self._create_work_notification(user_id, task, event_type)

    def _notify_task_participants(self, task, event_type, extra_data=None):
        """通知所有相关人员"""
        user_ids = {task.creator.id}
        if task.assignee: user_ids.add(task.assignee.id)

        for uid in user_ids:
            self._notify_user(uid, task, event_type)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """获取各分类任务数量"""
        user = request.user
        base_qs = Task.objects.filter(Q(creator=user) | Q(assignee=user))

        stats = {
            'my': base_qs.filter(assignee=user).count(),
            'created': base_qs.filter(creator=user).count(),
            'today': base_qs.filter(due_date__date=timezone.now().date()).count(),
            'done': base_qs.filter(status='done').count()
        }
        return Response(stats)

    def _send_task_card_message(self, task, event_type):
        """发送任务卡片系统消息到关联聊天室"""
        if not task.related_chat_room:
            return

        # 构建卡片数据
        # card_data = {
        #     'task_id': task.id,
        #     'title': task.title,
        #     'status': task.status,
        #     'priority': task.priority,
        #     'assignee_name': task.assignee.real_name if task.assignee else '未指派',
        #     'event_type': event_type,
        #     'creator_name': task.creator.real_name or task.creator.username
        # }

        card_data = TaskSerializer(task).data.copy()

        # 根据事件类型生成消息内容
        if event_type == 'created':
            content_text = f"📋 {task.creator.real_name or task.creator.username} 创建了任务: {task.title}"
        else:
            status_map = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成'}
            content_text = f"✅ 任务状态已更新为: {status_map.get(task.status, task.status)}"

        # 创建系统消息
        message = Message.objects.create(
            chat_room=task.related_chat_room,
            sender=task.creator,
            content=json.dumps(card_data, ensure_ascii=False),
            message_type='task_card'
        )

        # 通过 WebSocket 广播
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{task.related_chat_room.id}',
            {
                'type': 'chat_message',
                'chat_room': task.related_chat_room.id,
                'message_id': str(message.id),
                'sender': {
                    'id': task.creator.id,
                    'username': task.creator.username,
                    'real_name': task.creator.real_name,
                    'avatar': task.creator.avatar.url if task.creator.avatar else None
                },
                'sender_id': task.creator.id,
                'content': content_text,
                'message_type': 'task_card',
                'timestamp': message.timestamp.isoformat(),
                'task_data': card_data
            }
        )


    def _send_task_update_message(self, task, event_type, request):
        """发送任务更新系统消息到关联聊天室"""
        if not task.related_chat_room:
            return

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'chat_{task.related_chat_room.id}',  # 推送到对应的聊天室组
            {
                'type': 'task.update',  # ✅ 对应 consumer 中的 task_update 方法
                'event': event_type,
                'task': TaskSerializer(task, context={'request': request}).data
            }
        )