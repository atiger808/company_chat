from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework import serializers
from django.db.models import Q, Count, Sum
from django.utils import timezone
from django.db import models, transaction
from django.conf import settings
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from loguru import logger
import os
import uuid

from .models import AttendanceRecord, ApprovalRequest, ApprovalLog, ApprovalNode, ApprovalAssignee, WorkNotification
from .serializers import (
    AttendanceRecordSerializer,
    AttendanceClockSerializer,
    ApprovalRequestSerializer,
    ApprovalListSerializer,
    ApprovalCreateSerializer,
    ApprovalActionSerializer,
    ApprovalLogSerializer,
)
from utils.encrypt_aes import encrypt_data


def send_work_notification(user_id, title, content, notification_type='system', related_url='', extra_data=None):
    """创建工作通知并通过WebSocket实时推送"""
    from accounts.models import CustomUser
    try:
        user = CustomUser.objects.get(id=user_id)
        note = WorkNotification.objects.create(
            recipient=user,
            notification_type=notification_type,
            title=title,
            content=content,
            related_url=related_url,
            extra_data=extra_data or {},
        )
        # WebSocket实时推送
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'user_{user_id}_notifications',
            {
                'type': 'work.notification',
                'event_type': 'new',
                'notification': {
                    'id': note.id,
                    'type': notification_type,
                    'title': title,
                    'content': content,
                    'related_url': related_url,
                    'created_at': note.created_at.isoformat() if note.created_at else '',
                }
            }
        )
        return note
    except CustomUser.DoesNotExist:
        return None


class AttendanceViewSet(viewsets.ViewSet):
    """考勤打卡视图集"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """打卡记录列表（分页+搜索）"""
        user = request.user
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        search = request.query_params.get('search', '').strip()
        status_filter = request.query_params.get('status', '').strip()

        if user.user_type in ['super_admin', 'admin']:
            qs = AttendanceRecord.objects.select_related('user__department').all()
        else:
            qs = AttendanceRecord.objects.select_related('user__department').filter(user=user)

        if status_filter:
            qs = qs.filter(status=status_filter)

        if search:
            qs = qs.filter(
                Q(user__username__icontains=search) |
                Q(user__real_name__icontains=search) |
                Q(location__icontains=search) |
                Q(date__icontains=search)
            )

        qs = qs.order_by('-clock_time')
        total = qs.count()
        total_pages = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        items = qs[start:start + page_size]

        results = AttendanceRecordSerializer(items, many=True, context={'request': request}).data

        return Response({'encrypt': True, 'data': encrypt_data({
            'results': results,
            'count': total,
            'page': page,
            'page_size': page_size,
            'total_pages': total_pages,
        })})

    def retrieve(self, request, pk=None):
        try:
            record = AttendanceRecord.objects.select_related('user__department').get(id=pk)
            if request.user.user_type not in ['super_admin', 'admin'] and record.user != request.user:
                return Response({'error': '无权查看'}, status=403)
            data = AttendanceRecordSerializer(record, context={'request': request}).data
            return Response({'encrypt': True, 'data': encrypt_data(data)})
        except AttendanceRecord.DoesNotExist:
            return Response({'error': '记录不存在'}, status=404)

    @action(detail=False, methods=['post'])
    def clock_in(self, request):
        serializer = AttendanceClockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        now = timezone.localtime(timezone.now())
        today = now.date()
        existing = AttendanceRecord.objects.filter(user=request.user, date=today, clock_type='clock_in').first()
        if existing:
            data = AttendanceRecordSerializer(existing, context={'request': request}).data
            return Response({'encrypt': True, 'data': encrypt_data(data)})
        deadline = now.replace(hour=9, minute=0, second=0, microsecond=0)
        status_val = 'late' if now > deadline else 'normal'
        logger.info(f'{request.user} 上班打卡 now: {now} deadline: {deadline} status: {status_val}')
        record = AttendanceRecord.objects.create(
            user=request.user, clock_type='clock_in', date=today,
            latitude=serializer.validated_data.get('latitude'),
            longitude=serializer.validated_data.get('longitude'),
            location=serializer.validated_data.get('location', ''),
            device=serializer.validated_data.get('device', ''),
            status=status_val, remark=serializer.validated_data.get('remark', ''),
            reverse_geocoding=serializer.validated_data.get('reverse_geocoding'),
        )
        location_text = serializer.validated_data.get('location', '')
        logger.info(f'{request.user} 上班打卡 {today} status={status_val}')
        # 通知用户本人
        status_text = '迟到' if status_val == 'late' else '正常'
        loc = f' 位置：{location_text}' if location_text else ''
        send_work_notification(
            user_id=request.user.id,
            title='上班打卡成功',
            content=f'今日上班打卡 {status_text}{loc}',
            notification_type='attendance',
            related_url='/oa/attendance/',
            extra_data={'status': status_val, 'date': str(today)},
        )
        # 管理员上班打卡通知
        if status_val == 'late':
            from accounts.models import CustomUser
            admins = CustomUser.objects.filter(
                Q(user_type='super_admin') | Q(user_type='admin')
            ).exclude(id=request.user.id)
            for admin in admins:
                send_work_notification(
                    user_id=admin.id,
                    title='迟到提醒',
                    content=f'{request.user.real_name or request.user.username} 今日上班打卡迟到',
                    notification_type='attendance',
                    related_url='/oa/attendance/',
                    extra_data={'user_id': request.user.id, 'status': 'late', 'date': str(today)},
                )
        data = AttendanceRecordSerializer(record, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201)

    @action(detail=False, methods=['post'])
    def clock_out(self, request):
        serializer = AttendanceClockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        now = timezone.localtime(timezone.now())
        today = now.date()
        existing = AttendanceRecord.objects.filter(user=request.user, date=today, clock_type='clock_out').first()
        if existing:
            data = AttendanceRecordSerializer(existing, context={'request': request}).data
            return Response({'encrypt': True, 'data': encrypt_data(data)})
        clock_in_record = AttendanceRecord.objects.filter(user=request.user, date=today, clock_type='clock_in').first()
        if not clock_in_record:
            return Response({'error': '请先上班打卡'}, status=400)
        deadline = now.replace(hour=18, minute=0, second=0, microsecond=0)
        status_val = 'early_leave' if now < deadline else 'normal'
        logger.info(f'{request.user} 下班打卡 now: {now} deadline: {deadline} status: {status_val}')
        record = AttendanceRecord.objects.create(
            user=request.user, clock_type='clock_out', date=today,
            latitude=serializer.validated_data.get('latitude'),
            longitude=serializer.validated_data.get('longitude'),
            location=serializer.validated_data.get('location', ''),
            device=serializer.validated_data.get('device', ''),
            status=status_val, remark=serializer.validated_data.get('remark', ''),
            reverse_geocoding=serializer.validated_data.get('reverse_geocoding'),
        )
        logger.info(f'{request.user} 下班打卡 {today} status={status_val}')
        location_text = serializer.validated_data.get('location', '')
        status_text = '早退' if status_val == 'early_leave' else '正常'
        loc = f' 位置：{location_text}' if location_text else ''
        send_work_notification(
            user_id=request.user.id,
            title='下班打卡成功',
            content=f'今日下班打卡 {status_text}{loc}',
            notification_type='attendance',
            related_url='/oa/attendance/',
            extra_data={'status': status_val, 'date': str(today)},
        )
        data = AttendanceRecordSerializer(record, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201)

    @action(detail=False, methods=['get'])
    def today(self, request):
        today = timezone.now().date()
        records = AttendanceRecord.objects.filter(user=request.user, date=today).order_by('clock_time')
        clock_in = records.filter(clock_type='clock_in').first()
        clock_out = records.filter(clock_type='clock_out').first()
        return Response({'encrypt': True, 'data': encrypt_data({
            'date': today.isoformat(),
            'clock_in': AttendanceRecordSerializer(clock_in, context={'request': request}).data if clock_in else None,
            'clock_out': AttendanceRecordSerializer(clock_out, context={'request': request}).data if clock_out else None,
            'has_clock_in': clock_in is not None,
            'has_clock_out': clock_out is not None,
        })})

    @action(detail=False, methods=['get'])
    def statistics(self, request):
        now = timezone.now()
        year = int(request.query_params.get('year', now.year))
        month = int(request.query_params.get('month', now.month))
        qs = AttendanceRecord.objects.filter(user=request.user, date__year=year, date__month=month)
        return Response({'encrypt': True, 'data': encrypt_data({
            'year': year, 'month': month,
            'total_days': qs.values('date').distinct().count(),
            'late_count': qs.filter(status='late').count(),
            'early_leave_count': qs.filter(status='early_leave').count(),
            'clock_in_count': qs.filter(clock_type='clock_in').count(),
            'clock_out_count': qs.filter(clock_type='clock_out').count(),
        })})


class ApprovalViewSet(viewsets.ViewSet):
    """OA审批视图集"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        user = request.user
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        search = request.query_params.get('search', '').strip()
        status_filter = request.query_params.get('status', '').strip()
        type_filter = request.query_params.get('type', '').strip()

        if user.user_type in ['super_admin', 'admin']:
            qs = ApprovalRequest.objects.select_related('applicant', 'department').all()
        else:
            qs = ApprovalRequest.objects.select_related('applicant', 'department').filter(applicant=user)

        if status_filter:
            qs = qs.filter(status=status_filter)
        if type_filter:
            qs = qs.filter(approval_type=type_filter)
        if search:
            qs = qs.filter(
                Q(title__icontains=search) |
                Q(applicant__username__icontains=search) |
                Q(applicant__real_name__icontains=search)
            )

        qs = qs.order_by('-created_at')
        total = qs.count()
        total_pages = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        items = qs[start:start + page_size]
        results = ApprovalListSerializer(items, many=True, context={'request': request}).data

        return Response({'encrypt': True, 'data': encrypt_data({
            'results': results, 'count': total, 'page': page,
            'page_size': page_size, 'total_pages': total_pages,
        })})

    def retrieve(self, request, pk=None):
        try:
            approval = ApprovalRequest.objects.select_related(
                'applicant', 'approver', 'department'
            ).prefetch_related('logs__operator', 'approval_nodes__assignees__user').get(id=pk)
            if request.user.user_type not in ['super_admin', 'admin'] and approval.applicant != request.user:
                return Response({'error': '无权查看'}, status=403)
            data = ApprovalRequestSerializer(approval, context={'request': request}).data
            return Response({'encrypt': True, 'data': encrypt_data(data)})
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)

    def create(self, request):
        serializer = ApprovalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # 审批人不能为空
        approver_nodes = serializer.validated_data.get('approver_nodes', [])
        if not approver_nodes:
            return Response({'error': '请至少添加一个审批人或审批部门'}, status=400)

        # 所属部门
        department_id = serializer.validated_data.get('department_id')
        from accounts.models import Department
        department = None
        if department_id:
            try:
                department = Department.objects.get(id=department_id)
            except Department.DoesNotExist:
                department = request.user.department
        else:
            department = request.user.department

        with transaction.atomic():
            approval = ApprovalRequest.objects.create(
                applicant=request.user,
                department=department,
                approval_type=serializer.validated_data['approval_type'],
                title=serializer.validated_data['title'],
                content=serializer.validated_data.get('content', ''),
                start_date=serializer.validated_data.get('start_date'),
                end_date=serializer.validated_data.get('end_date'),
                duration=serializer.validated_data.get('duration'),
                amount=serializer.validated_data.get('amount'),
                expense_type=serializer.validated_data.get('expense_type', ''),
                expense_date=serializer.validated_data.get('expense_date'),
                attachments=serializer.validated_data.get('attachments', []),
                sign_type=serializer.validated_data.get('sign_type', 'orsign'),
                approval_mode=serializer.validated_data.get('approval_mode', 'parallel'),
            )
            from accounts.models import CustomUser, Department

            if approver_nodes:
                for idx, node_data in enumerate(approver_nodes):
                    node_type = node_data.get('type', 'user')
                    node = ApprovalNode.objects.create(
                        request=approval,
                        node_type=node_type,
                        order=idx,
                    )
                    if node_type == 'user':
                        user_id = node_data.get('id')
                        try:
                            u = CustomUser.objects.get(id=user_id)
                            node.user = u
                            node.save()
                            ApprovalAssignee.objects.create(node=node, user=u)
                        except CustomUser.DoesNotExist:
                            pass
                    elif node_type == 'department':
                        dept_id = node_data.get('id')
                        try:
                            dept = Department.objects.get(id=dept_id)
                            node.department = dept
                            node.save()
                            # 获取部门下所有管理员/超级管理员
                            dept_admins = CustomUser.objects.filter(
                                department=dept,
                                user_type__in=['super_admin', 'admin']
                            ).exclude(id=request.user.id)
                            for au in dept_admins:
                                ApprovalAssignee.objects.create(node=node, user=au)
                        except Department.DoesNotExist:
                            pass
            else:
                # 默认：自动分配第一个管理员
                admin = CustomUser.objects.filter(
                    Q(user_type='super_admin') | Q(user_type='admin')
                ).exclude(id=request.user.id).first()
                if admin:
                    node = ApprovalNode.objects.create(
                        request=approval, node_type='user',
                        user=admin, order=0,
                    )
                    ApprovalAssignee.objects.create(node=node, user=admin)

            # 如果是顺序审批，只激活第一个节点
            if approval.approval_mode == 'sequential':
                approval.current_node_order = 0
                approval.save()

        # 通知审批人
        from accounts.models import CustomUser
        assignees = ApprovalAssignee.objects.filter(
            node__request=approval, status='pending'
        ).select_related('user')
        for asgn in assignees:
            send_work_notification(
                user_id=asgn.user.id,
                title='审批待处理',
                content=f'{request.user.real_name or request.user.username} 提交了{approval.get_approval_type_display()}申请：“{approval.title}”',
                notification_type='approval',
                related_url='/oa/approval/',
                extra_data={'approval_id': approval.id, 'action': 'pending'},
            )

        logger.info(f'{request.user} 提交审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201)

    def _check_user_can_approve(self, approval, user):
        """检查用户是否有权限审批当前节点"""
        if approval.approval_mode == 'sequential':
            nodes = approval.approval_nodes.filter(order=approval.current_node_order)
        else:
            nodes = approval.approval_nodes.all()
        return ApprovalAssignee.objects.filter(
            node__in=nodes, user=user, status='pending'
        ).exists()

    def _process_node_approval(self, approval, node, action, user, comment):
        """处理单个节点的审批"""
        now = timezone.now()
        assignees = node.assignees.filter(user=user)
        if not assignees.exists():
            return False
        assignee = assignees.first()
        if assignee.status != 'pending':
            return False

        assignee.status = 'approved' if action == 'approve' else 'rejected'
        assignee.comment = comment
        assignee.operated_at = now
        assignee.save()

        # 记录日志
        ApprovalLog.objects.create(
            request=approval, operator=user,
            action=action, comment=comment,
        )

        return True

    def _check_node_completed(self, node):
        """检查节点是否已完成审批"""
        total = node.assignees.count()
        approved = node.assignees.filter(status='approved').count()
        rejected = node.assignees.filter(status='rejected').count()

        if node.request.sign_type == 'orsign':
            # 或签：任一通过=节点通过，任一驳回=整体驳回
            if approved > 0:
                return True, 'approved'
            if rejected > 0:
                return True, 'rejected'
            return False, None
        else:
            # 会签：全部通过=节点通过，任一驳回=整体驳回
            if rejected > 0:
                return True, 'rejected'
            if approved >= total:
                return True, 'approved'
            return False, None

    def _finalize_approval(self, approval):
        """完成审批：更新整体状态"""
        now = timezone.now()
        all_approved = True
        all_rejected = False

        for node in approval.approval_nodes.all():
            completed, result = self._check_node_completed(node)
            if result == 'rejected':
                all_rejected = True
                all_approved = False
                break
            if result != 'approved':
                all_approved = False

        if all_rejected:
            approval.status = 'rejected'
            approval.save()
            return True

        if all_approved:
            approval.status = 'approved'
            approval.save()
            return True

        return False

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        try:
            approval = ApprovalRequest.objects.select_related('applicant').prefetch_related(
                'approval_nodes__assignees'
            ).get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)

        if approval.status != 'pending':
            return Response({'error': '该审批已处理'}, status=400)

        if not self._check_user_can_approve(approval, request.user):
            return Response({'error': '您不在当前审批节点中'}, status=403)

        serializer = ApprovalActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data.get('comment', '')

        with transaction.atomic():
            if approval.approval_mode == 'sequential':
                nodes = approval.approval_nodes.filter(order=approval.current_node_order)
            else:
                nodes = approval.approval_nodes.all()

            processed = False
            for node in nodes:
                if self._process_node_approval(approval, node, 'approve', request.user, comment):
                    processed = True
                    break

            if not processed:
                return Response({'error': '您已审批过，无需重复操作'}, status=400)

            # 检查当前节点是否完成
            for node in nodes:
                completed, result = self._check_node_completed(node)
                if completed and approval.approval_mode == 'sequential':
                    # 顺序审批：进入下一节点
                    next_order = approval.current_node_order + 1
                    if approval.approval_nodes.filter(order=next_order).exists():
                        approval.current_node_order = next_order
                        approval.save()
                    else:
                        # 没有下一节点，完成审批
                        self._finalize_approval(approval)
                    break

            if approval.status == 'pending':
                self._finalize_approval(approval)

        # 通知申请人
        timestamp = timezone.now().strftime('%m-%d %H:%M')
        if approval.status == 'approved':
            send_work_notification(
                user_id=approval.applicant.id,
                title='审批已通过',
                content=f'您的{approval.get_approval_type_display()}申请“{approval.title}”已通过 [{timestamp}]',
                notification_type='approval',
                related_url='/oa/approval/',
                extra_data={'approval_id': approval.id, 'action': 'approved'},
            )
        # 通知下一节点审批人（顺序审批）
        if approval.status == 'pending' and approval.approval_mode == 'sequential':
            next_order = approval.current_node_order
            next_assignees = ApprovalAssignee.objects.filter(
                node__request=approval, node__order=next_order, status='pending'
            ).select_related('user')
            for asgn in next_assignees:
                send_work_notification(
                    user_id=asgn.user.id,
                    title='审批待处理',
                    content=f'有新的审批需要您处理：“{approval.title}”',
                    notification_type='approval',
                    related_url='/oa/approval/',
                    extra_data={'approval_id': approval.id, 'action': 'pending'},
                )

        logger.info(f'{request.user} 通过审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        try:
            approval = ApprovalRequest.objects.select_related('applicant').prefetch_related(
                'approval_nodes__assignees'
            ).get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)

        if approval.status != 'pending':
            return Response({'error': '该审批已处理'}, status=400)

        if not self._check_user_can_approve(approval, request.user):
            return Response({'error': '您不在当前审批节点中'}, status=403)

        serializer = ApprovalActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data.get('comment', '')

        with transaction.atomic():
            if approval.approval_mode == 'sequential':
                nodes = approval.approval_nodes.filter(order=approval.current_node_order)
            else:
                nodes = approval.approval_nodes.all()

            processed = False
            for node in nodes:
                if self._process_node_approval(approval, node, 'reject', request.user, comment):
                    processed = True
                    break

            if not processed:
                return Response({'error': '您已审批过，无需重复操作'}, status=400)

            # 任何人驳回，整体驳回
            approval.status = 'rejected'
            approval.save()

        # 通知申请人
        timestamp = timezone.now().strftime('%m-%d %H:%M')
        send_work_notification(
            user_id=approval.applicant.id,
            title='审批已驳回',
            content=f'您的{approval.get_approval_type_display()}申请“{approval.title}”已被驳回 [{timestamp}]' + (f' 原因：{comment}' if comment else ''),
            notification_type='approval',
            related_url='/oa/approval/',
            extra_data={'approval_id': approval.id, 'action': 'rejected', 'comment': comment},
        )

        logger.info(f'{request.user} 驳回审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)})

    @action(detail=False, methods=['get'])
    def admins(self, request):
        """获取可选的审批人列表"""
        from accounts.models import CustomUser
        admins_qs = CustomUser.objects.filter(
            Q(user_type='super_admin') | Q(user_type='admin')
        ).exclude(id=request.user.id).select_related('department').values(
            'id', 'username', 'real_name', 'department__name'
        )
        results = []
        for a in admins_qs:
            dept_name = a.get('department__name') or ''
            label = a['real_name'] or a['username']
            if dept_name:
                label += f' ({dept_name})'
            results.append({'id': a['id'], 'name': label, 'department': dept_name})
        return Response({'results': results})

    @action(detail=False, methods=['get'])
    def departments(self, request):
        """获取可选部门列表（仅含管理员以上的部门）"""
        from accounts.models import CustomUser, Department
        dept_ids = CustomUser.objects.filter(
            Q(user_type='super_admin') | Q(user_type='admin')
        ).exclude(id=request.user.id).values_list('department_id', flat=True).distinct()
        depts = Department.objects.filter(id__in=dept_ids).values('id', 'name')
        return Response({'results': list(depts)})

    @action(detail=False, methods=['get'])
    def all_departments(self, request):
        """获取所有部门列表（用于表单选择）"""
        from accounts.models import Department
        depts = Department.objects.all().values('id', 'name')
        return Response({'results': list(depts)})

    @action(detail=False, methods=['get'])
    def geocode(self, request):
        """反向地理编码（百度地图API）"""
        lat = request.query_params.get('lat')
        lng = request.query_params.get('lng')
        if not lat or not lng:
            return Response({'error': '缺少经纬度参数'}, status=400)
        try:
            from utils.reverse_geocoding_to_city import baidu_geocoding
            ak = getattr(settings, 'BAIDU_MAP_SERVER_AK', '')
            if not ak:
                return Response({'error': '百度地图AK未配置'}, status=500)
            result = baidu_geocoding(float(lat), float(lng), ak, coordtype='wgs84ll')
            if result and result.get('status') == 0:
                data = result['result']
                formatted_poi = data.get('formatted_address_poi', '')
                formatted = data.get('formatted_address', '')
                comp = data.get('addressComponent', {})
                province = comp.get('province', '')
                city = comp.get('city', '')
                district = comp.get('district', '')
                street = comp.get('street', '')
                sematic = data.get('sematic_description', '')
                location_name = formatted_poi or formatted or sematic or f'{province}{city}{district}{street}'
                return Response({
                    'location': location_name,
                    'province': province, 'city': city,
                    'district': district, 'street': street,
                    'lng': lng, 'lat': lat,
                    'reverse_geocoding': result
                })
            err_msg = result.get('msg', '地理编码失败') if result else '请求百度地图API失败'
            return Response({'error': err_msg}, status=502)
        except Exception as e:
            logger.error(f'反向地理编码异常: {e}')
            return Response({'error': str(e)}, status=500)

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    def upload_attachment(self, request):
        """上传审批附件"""
        file = request.FILES.get('file')
        if not file:
            return Response({'error': '请选择文件'}, status=400)
        if file.size > 10 * 1024 * 1024:
            return Response({'error': '文件大小不能超过10MB'}, status=400)
        ext = os.path.splitext(file.name)[1].lower()
        allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.mp4', '.avi', '.mov', '.mp3', '.wav']
        if ext not in allowed:
            return Response({'error': '不支持的文件格式'}, status=400)
        from django.core.files.storage import default_storage
        filename = f'approval_attachments/{uuid.uuid4().hex}{ext}'
        saved_path = default_storage.save(filename, file)
        file_url = settings.MEDIA_URL + saved_path
        logger.info(f'{request.user} 上传审批附件 {file.name}')
        return Response({'url': file_url, 'name': file.name})

    @action(detail=False, methods=['get'])
    def my_pending(self, request):
        """获取当前用户待审批的列表"""
        assignee_ids = ApprovalAssignee.objects.filter(
            user=request.user, status='pending'
        ).values_list('node__request_id', flat=True).distinct()
        qs = ApprovalRequest.objects.filter(
            id__in=assignee_ids, status='pending'
        ).select_related('applicant').order_by('-created_at')
        results = ApprovalListSerializer(qs, many=True, context={'request': request}).data
        return Response({'results': results, 'count': len(results)})


class WorkNotificationViewSet(viewsets.ViewSet):
    """工作通知视图集"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """通知列表（分页）"""
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        qs = WorkNotification.objects.filter(recipient=request.user)
        total = qs.count()
        total_pages = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        items = qs[start:start + page_size]
        results = [{
            'id': n.id, 'type': n.notification_type,
            'title': n.title, 'content': n.content,
            'related_url': n.related_url,
            'is_read': n.is_read,
            'created_at': n.created_at.isoformat() if n.created_at else '',
            'extra_data': n.extra_data,
        } for n in items]
        return Response({'results': results, 'count': total, 'page': page, 'total_pages': total_pages})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """未读通知数"""
        count = WorkNotification.objects.filter(recipient=request.user, is_read=False).count()
        return Response({'count': count})

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """标记单条通知为已读"""
        try:
            note = WorkNotification.objects.get(id=pk, recipient=request.user)
            note.is_read = True
            note.save()
            return Response({'message': 'ok'})
        except WorkNotification.DoesNotExist:
            return Response({'error': '通知不存在'}, status=404)

    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """标记所有通知为已读"""
        WorkNotification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return Response({'message': 'ok'})
