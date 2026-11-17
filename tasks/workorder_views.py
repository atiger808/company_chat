# -*- coding: utf-8 -*-
"""群工单 API。"""
from io import BytesIO

from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from chat.models import ChatRoom
from org.filters import resolve_tenant_for_request
from .models import WorkOrder
from .workorder_serializers import (
    WorkOrderCommentSerializer,
    WorkOrderListSerializer,
    WorkOrderSerializer,
)
from .workorder_service import (
    add_comment,
    build_permissions,
    can_create_work_order,
    cancel_work_order,
    change_verifier,
    create_work_order,
    current_stage,
    reassign_stage,
    save_workorder_create_permissions,
    send_ding,
    start_stage,
    submit_stage,
    update_work_order,
    verify_work_order,
    workorder_permission_payload,
)


class WorkOrderViewSet(viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WorkOrderSerializer

    def get_queryset(self):
        return self._base_qs()

    def _base_qs(self):
        qs = (WorkOrder.objects.select_related('chat_room', 'creator', 'verifier', 'tenant')
              .prefetch_related('stages'))
        return self.filter_queryset(qs)

    def _apply_list_filters(self, qs, params=None):
        request = self.request
        if params is None:
            params = request.query_params
        status_val = params.get('status')
        if status_val:
            qs = qs.filter(status=status_val)
        urgency = params.get('urgency')
        if urgency:
            qs = qs.filter(urgency=urgency)
        archived = params.get('archived')
        if archived in ('1', 'true', 'True'):
            qs = qs.filter(archived_at__isnull=False)
        elif archived in ('0', 'false', 'False'):
            qs = qs.filter(archived_at__isnull=True)
        keyword = (params.get('search') or '').strip()
        if keyword:
            qs = qs.filter(
                Q(order_no__icontains=keyword) |
                Q(title__icontains=keyword) |
                Q(description__icontains=keyword)
            )
        room_id = params.get('room_id')
        if room_id:
            try:
                room_id = int(room_id)
            except (TypeError, ValueError):
                room_id = 0
            room = ChatRoom.objects.filter(id=room_id, members=request.user).first()
            if not room:
                raise PermissionDenied('您不在该群聊中')
            return qs.filter(chat_room_id=room.id)
        if not request.user.is_superuser:
            qs = qs.filter(
                Q(creator=request.user) |
                Q(verifier=request.user) |
                Q(stages__assignee=request.user)
            ).distinct()
        return qs

    def _get_visible(self, pk):
        try:
            wo = self._base_qs().get(pk=pk)
        except WorkOrder.DoesNotExist:
            raise PermissionDenied('工单不存在或无权查看')
        if not build_permissions(wo, self.request.user).get('can_view'):
            raise PermissionDenied('无权查看该工单')
        return wo

    def _full(self, wo):
        return WorkOrderSerializer(wo, context={'request': self.request}).data

    def list(self, request):
        qs = self._apply_list_filters(self._base_qs()).order_by('-created_at')
        page = self.paginate_queryset(qs)
        if page is not None:
            data = WorkOrderListSerializer(page, many=True, context={'request': request}).data
            return self.get_paginated_response(data)
        data = WorkOrderListSerializer(qs, many=True, context={'request': request}).data
        return Response(data)

    def retrieve(self, request, pk=None):
        return Response(self._full(self._get_visible(pk)))

    def create(self, request):
        wo = create_work_order(request.user, request.data, tenant=resolve_tenant_for_request(request))
        return Response(self._full(wo), status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        self._get_visible(pk)
        wo = update_work_order(int(pk), request.user, request.data)
        return Response(self._full(wo))

    @action(detail=True, methods=['post'], url_path='stage-action')
    def stage_action(self, request, pk=None):
        self._get_visible(pk)
        payload = request.data or {}
        action_name = (payload.get('action') or '').strip()
        stage_id = payload.get('stage_id')
        if not stage_id:
            return Response({'error': '缺少 stage_id'}, status=status.HTTP_400_BAD_REQUEST)
        if action_name == 'start':
            wo = start_stage(int(pk), int(stage_id), request.user, payload)
        elif action_name == 'submit':
            wo = submit_stage(int(pk), int(stage_id), request.user, payload)
        else:
            return Response({'error': 'action 必须为 start 或 submit'}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self._full(wo))

    @action(detail=True, methods=['post'])
    def comments(self, request, pk=None):
        self._get_visible(pk)
        comment = add_comment(int(pk), request.user, request.data or {})
        return Response(WorkOrderCommentSerializer(comment, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        self._get_visible(pk)
        wo = verify_work_order(int(pk), request.user, request.data or {})
        return Response(self._full(wo))

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        self._get_visible(pk)
        wo = cancel_work_order(int(pk), request.user, request.data or {})
        return Response(self._full(wo))

    @action(detail=True, methods=['post'], url_path='change-verifier')
    def change_verifier(self, request, pk=None):
        self._get_visible(pk)
        wo = change_verifier(int(pk), request.user, request.data or {})
        return Response(self._full(wo))

    @action(detail=True, methods=['post'], url_path=r'stages/(?P<stage_id>\d+)/reassign')
    def reassign_stage(self, request, pk=None, stage_id=None):
        self._get_visible(pk)
        wo = reassign_stage(int(pk), int(stage_id), request.user, request.data or {})
        return Response(self._full(wo))

    @action(detail=True, methods=['post'])
    def ding(self, request, pk=None):
        self._get_visible(pk)
        wo = send_ding(int(pk), request.user)
        return Response(self._full(wo))

    @action(detail=False, methods=['get'])
    def stats(self, request):
        user = request.user
        base = self._base_qs()
        active = (base.filter(status__in=['pending', 'processing'], stages__assignee=user)
                  .distinct().prefetch_related('stages'))
        my_stage = 0
        for wo in active:
            stage = current_stage(wo)
            if stage and stage.assignee_id == user.id:
                my_stage += 1
        data = {
            'my_stage': my_stage,
            'pending_verify': base.filter(status='pending_verify', verifier=user).count(),
            'created': base.filter(creator=user).count(),
            'done': (base.filter(Q(creator=user) | Q(verifier=user) | Q(stages__assignee=user),
                                 status='done').distinct().count()),
        }
        return Response(data)

    @action(detail=False, methods=['get', 'post'], url_path='permission-config')
    def permission_config(self, request):
        """群待办发起权限配置：所有登录用户可读，仅超级管理员可保存。"""
        if request.method == 'POST':
            user_type = getattr(request.user, 'user_type', '')
            if user_type != 'super_admin' and not request.user.is_superuser:
                return Response({'error': '仅超级管理员可配置群待办权限'},
                                status=status.HTTP_403_FORBIDDEN)
            payload = request.data or {}
            save_workorder_create_permissions(payload.get('permissions') or {}, user=request.user)
        return Response(workorder_permission_payload())

    @action(detail=False, methods=['get'], url_path='can-create')
    def can_create(self, request):
        """当前用户能否在指定群发起群待办（前端据此隐藏/拦截入口）。"""
        try:
            room_id = int(request.query_params.get('room_id') or 0)
        except (TypeError, ValueError):
            room_id = 0
        room = ChatRoom.objects.filter(id=room_id, members=request.user).first()
        if not room or room.room_type != 'group':
            return Response({'allowed': False, 'reason': '仅群聊支持发起群待办'})
        allowed = can_create_work_order(request.user, room)
        return Response({
            'allowed': allowed,
            'reason': '' if allowed else '您没有发起群待办的权限，请联系管理员在管理控制台配置',
        })

    @action(detail=False, methods=['get', 'post'])
    def export(self, request):
        """群工单导出 Excel（默认 xlsx，支持本地下载/由前端保存到网盘）。"""
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter
        except ImportError:
            return Response({'error': '服务器缺少 openpyxl 依赖，请联系管理员安装'}, status=500)

        params = {}
        try:
            params.update({k: v for k, v in request.query_params.items()})
        except Exception:
            pass
        if request.method == 'POST':
            try:
                params.update({k: v for k, v in request.data.items()})
            except Exception:
                pass

        qs = (self._apply_list_filters(self._base_qs(), params)
              .order_by('-created_at')[:5000])
        rows = []
        for wo in qs:
            stage = current_stage(wo)
            stages = list(wo.stages.all())
            done = len([s for s in stages if s.status == 'done'])
            rows.append([
                wo.order_no,
                wo.title,
                wo.get_status_display(),
                wo.get_urgency_display(),
                f'{done}/{len(stages)}',
                stage.name if stage else '',
                stage.assignee_name if stage else '',
                timezone.localtime(stage.deadline).strftime('%Y-%m-%d %H:%M') if stage and stage.deadline else '',
                wo.creator_name,
                wo.verifier_name,
                timezone.localtime(wo.created_at).strftime('%Y-%m-%d %H:%M') if wo.created_at else '',
                timezone.localtime(wo.closed_at).strftime('%Y-%m-%d %H:%M') if wo.closed_at else '',
                wo.get_last_action_display(),
            ])

        try:
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = '群工单'
            headers = ['工单编号', '工单标题', '状态', '紧急度', '进度', '当前环节',
                       '当前执行人', '环节截止时间', '发起人', '核验人', '创建时间', '闭环时间', '最近操作']
            header_fill = PatternFill('solid', fgColor='00A1FF')
            header_font = Font(color='FFFFFF', bold=True)
            thin = Side(style='thin', color='D9D9D9')
            border = Border(left=thin, right=thin, top=thin, bottom=thin)
            ws.append(headers)
            for col in range(1, len(headers) + 1):
                cell = ws.cell(row=1, column=col)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal='center', vertical='center')
                cell.border = border
            for row in rows:
                ws.append(row)
            for col, width in enumerate([22, 36, 12, 10, 10, 20, 16, 18, 14, 14, 18, 18, 14], start=1):
                ws.column_dimensions[get_column_letter(col)].width = width
            output = BytesIO()
            wb.save(output)
            output.seek(0)
        except Exception as e:
            return Response({'error': f'导出失败: {str(e)}'}, status=500)

        now = timezone.localtime(timezone.now())
        filename = '群工单_%s.xlsx' % now.strftime('%Y%m%d_%H%M')
        return FileResponse(
            output,
            as_attachment=True,
            filename=filename,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
