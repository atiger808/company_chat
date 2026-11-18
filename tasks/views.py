from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
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

    def _active_tenant(self):
        request = getattr(self, 'request', None)
        if request is None:
            return None
        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            try:
                tenant = request.user.get_active_tenant()
            except Exception:
                tenant = None
        return tenant

    def _scope_tasks(self, user):
        """当前用户可见任务：按企业隔离；历史无企业任务默认归入当前企业。

        任务表已有 tenant 字段；旧任务创建时未写入企业，这里在读取时一次性
        归属到用户当前企业，避免历史任务在任务中心消失。
        """
        # 超级管理员可查看所有任务；普通用户按企业隔离且仅看与自己相关的任务
        if getattr(user, 'is_superuser', False) or getattr(user, 'user_type', '') == 'super_admin':
            return Task.objects.all()
        base = Task.objects.filter(Q(creator=user) | Q(assignee=user))
        tenant = self._active_tenant()
        if tenant is not None:
            base.filter(tenant__isnull=True).update(tenant=tenant)
            base = base.filter(tenant=tenant)
        return base

    def get_queryset(self):
        user = self.request.user
        queryset = self._scope_tasks(user).distinct().select_related(
            'creator', 'assignee', 'related_chat_room', 'tenant')

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
                Q(title__icontains=search) | Q(description__icontains=search) |
                Q(creator__username__icontains=search) | Q(creator__real_name__icontains=search)
            )

        # 6. 紧急等级过滤（全部不传）
        priority = params.get('priority')
        if priority and priority in dict(Task.PRIORITY_CHOICES):
            queryset = queryset.filter(priority=priority)

        return queryset.order_by('-updated_at', '-priority')

    def _ensure_creator(self, task):
        if task.creator_id != self.request.user.id:
            raise PermissionDenied('只有任务创建人可以修改任务基本信息')

    def _ensure_participant(self, task):
        if task.creator_id != self.request.user.id and task.assignee_id != self.request.user.id:
            raise PermissionDenied('只有任务创建人或执行人可以执行该操作')

    @staticmethod
    def _clean_attachments(raw, folder_name='文档（来自任务）'):
        cleaned = []
        if not isinstance(raw, list):
            return cleaned
        for item in raw[:20]:
            if not isinstance(item, dict):
                continue
            url = str(item.get('url') or '').strip()
            file_id = item.get('file_id')
            if not url and not file_id:
                continue
            cleaned.append({
                'file_id': file_id,
                'url': url,
                'name': str(item.get('name') or '附件')[:255],
                'size': item.get('size') or 0,
                'mime': str(item.get('mime') or item.get('mime_type') or '')[:100],
                'folder_name': str(item.get('folder_name') or folder_name)[:100],
            })
        return cleaned

    def perform_create(self, serializer):
        task = serializer.save()
        tenant = self._active_tenant()
        if tenant is not None and not task.tenant_id:
            task.tenant = tenant
            task.save(update_fields=['tenant'])
        # 发送系统消息到关联聊天室
        self._send_task_card_message(task, 'created')
        # 如果有执行人，且不是自己，发送 WebSocket 通知
        if task.assignee and task.assignee != self.request.user:
            self._notify_user(task.assignee.id, task, 'assigned')

    def perform_update(self, serializer):
        """任务编辑：同步群内任务通知，并在执行人变化时通知新执行人。"""
        task = serializer.instance
        self._ensure_creator(task)
        before = {
            'status': task.status,
            'title': task.title,
            'description': task.description,
            'priority': task.priority,
            'due_date': task.due_date,
            'assignee_id': task.assignee_id,
        }
        task = serializer.save()
        tenant = self._active_tenant()
        if tenant is not None and not task.tenant_id:
            task.tenant = tenant
            task.save(update_fields=['tenant'])
        labels = {
            'status': '状态', 'title': '标题',
            'priority': '优先级', 'due_date': '截止时间', 'assignee_id': '执行人',
        }
        changes = [label for field, label in labels.items()
                   if before[field] != getattr(task, field)]
        if changes:
            event = 'status_changed' if '状态' in changes else 'updated'
            self._send_task_card_message(task, event, changes=changes)
            self._send_task_update_message(task, event, self.request)
            if '状态' in changes:
                self._notify_task_participants(task, 'status_changed')
        if before['assignee_id'] != task.assignee_id and task.assignee \
                and task.assignee != self.request.user:
            self._notify_user(task.assignee.id, task, 'assigned')

    def perform_destroy(self, instance):
        if instance.creator_id != self.request.user.id:
            raise PermissionDenied('只有任务创建人可以删除任务')
        instance.delete()

    @action(detail=True, methods=['post'])
    def change_status(self, request, pk=None):
        """
        更新任务状态与排序（看板拖拽核心）
        更新任务状态并广播到聊天室
        """
        task = self.get_object()
        self._ensure_participant(task)
        new_status = request.data.get('status', task.status)
        new_order = request.data.get('order', task.order)
        if new_status in dict(Task.STATUS_CHOICES):
            task.status = new_status
            task.order = new_order
            tenant = self._active_tenant()
            if tenant is not None and not task.tenant_id:
                task.tenant = tenant
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
        self._ensure_participant(task)
        content = (request.data.get('content') or '').strip()
        attachments = self._clean_attachments(request.data.get('attachments'))
        if not content and not attachments:
            return Response({'error': '评论内容或附件不能为空'}, status=400)

        comment = TaskComment.objects.create(
            task=task, user=request.user, content=content, attachments=attachments)
        self._notify_task_participants(task, 'new_comment', comment)
        return Response(
            TaskCommentSerializer(comment, context={'request': request}).data, status=201)

    @action(detail=True, methods=['post'])
    def attachments(self, request, pk=None):
        """更新任务附件（仅任务创建人）；执行人请在评论中上传附件。"""
        task = self.get_object()
        self._ensure_creator(task)
        raw = request.data.get('attachments')
        if not isinstance(raw, list):
            return Response({'error': '附件格式错误'}, status=400)
        task.attachments = self._clean_attachments(raw)
        task.save(update_fields=['attachments'])
        self._send_task_update_message(task, 'updated', request)
        return Response(TaskSerializer(task, context={'request': request}).data)

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
                tenant=task.tenant,
                notification_type='task',
                title=title,
                content=content,
                related_url=f'/tasks/?task_id={task.id}',
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
        base_qs = self._scope_tasks(user)

        stats = {
            'all': base_qs.count(),
            'my': base_qs.filter(assignee=user).count(),
            'created': base_qs.filter(creator=user).count(),
            'today': base_qs.filter(due_date__date=timezone.now().date()).count(),
            'done': base_qs.filter(status='done').count()
        }
        return Response(stats)

    def _send_task_card_message(self, task, event_type, changes=None):
        """发送任务卡片/任务更新通知到关联聊天室（参考群工单的群内同步）。"""
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

        card_data = TaskSerializer(task, context={'request': self.request}).data.copy()

        # 根据事件类型生成消息内容
        status_map = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成',
                      'archived': '已归档'}
        if event_type == 'created':
            content_text = f"📋 {task.creator.real_name or task.creator.username} 创建了任务: {task.title}"
        elif event_type == 'status_changed':
            content_text = f"✅ 任务「{task.title}」状态更新为: {status_map.get(task.status, task.status)}"
        else:
            changed = '、'.join(changes or []) or '内容'
            content_text = f"✏️ 任务「{task.title}」已更新：{changed}"

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