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

from .models import AttendanceRecord, ApprovalRequest, ApprovalType, ApprovalLog, ApprovalNode, ApprovalAssignee, WorkNotification, ApprovalCarbonCopy, ApprovalDeptConfig, AttendanceConfig
from .type_utils import ensure_builtin_types, resolve_approval_type, collect_form_data, validate_form_data


def _approval_type_label(approval):
    """审批类型展示名（动态类型表解析，兼容历史数据）"""
    t = resolve_approval_type(approval.approval_type, approval.tenant)
    return t.name if t else approval.approval_type


def _threshold_field_label(config):
    """阈值字段展示名：内置字段走映射，自定义类型回退到 schema 字段 label"""
    if not config or not config.threshold_field:
        return ''
    field_map = dict(ApprovalDeptConfig.THRESHOLD_FIELD_CHOICES)
    if config.threshold_field in field_map:
        return field_map[config.threshold_field]
    t = resolve_approval_type(config.approval_type, config.tenant)
    if t:
        for f in (t.form_schema or []):
            if f.get('key') == config.threshold_field:
                return f.get('label') or config.threshold_field
    return config.threshold_field
from .serializers import (
    AttendanceRecordSerializer,
    AttendanceClockSerializer,
    ApprovalRequestSerializer,
    ApprovalListSerializer,
    ApprovalCreateSerializer,
    ApprovalActionSerializer,
    ApprovalDraftSerializer,
    ApprovalLogSerializer,
)
from utils.encrypt_aes import encrypt_data
from utils.request_util import get_request_ip


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
                    'avatar_url': user.get_avatar_url() if hasattr(user, 'get_avatar_url') else '',
                    'created_at': note.created_at.isoformat() if note.created_at else '',
                }
            }
        )
        # Web Push：无论在线与否都推送，保证回到主屏幕 / 锁屏 / 关闭 App 时也能收到工作通知。
        # urgent=True → urgency=high：即时送达，避免 iOS 批量延迟。
        try:
            from django.conf import settings as dj_settings
            if dj_settings.PUSH_ENABLED:
                from chat.push_utils import build_work_push_payload
                from chat.tasks import send_push_task
                send_push_task.delay(user_id, build_work_push_payload(note, related_url), ttl=43200, urgent=True)
        except Exception as e:
            logger.warning(f'Web Push 工作通知失败: {e}')
        return note
    except CustomUser.DoesNotExist:
        logger.error(f'用户{user_id}不存在')
        return None
    except Exception as e:
        logger.error(f'创建工作通知失败: {e}')
        return None


class AttendanceViewSet(viewsets.ViewSet):
    """考勤打卡视图集"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """打卡记录列表（分页+搜索，企业隔离）"""
        user = request.user
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        search = request.query_params.get('search', '').strip()
        status_filter = request.query_params.get('status', '').strip()

        if user.user_type in ['super_admin', 'admin']:
            qs = AttendanceRecord.objects.select_related('user__department').all()
            # 企业隔离：非超管只能看自己企业的记录
            if user.user_type != 'super_admin' and tenant:
                qs = qs.filter(tenant=tenant)

            filter_tenant_id = request.query_params.get('tenant_id', '').strip()
            if filter_tenant_id:
                qs = qs.filter(tenant_id=filter_tenant_id)
            filter_org_dept_id = request.query_params.get('org_dept_id', '').strip()
            if filter_org_dept_id:
                qs = qs.filter(user__department_relations__department_id=filter_org_dept_id)
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
                return Response({'error': '暂无查看权限'}, status=403)
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
        # 检查考勤配置（含用户主部门）
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        from org.models import UserDepartment
        primary_dept = UserDepartment.objects.filter(user=request.user, is_primary=True).select_related('department').first()
        dept_id = primary_dept.department_id if primary_dept else None
        config = self._get_attendance_config(tenant, dept_id)
        if config and not config.clock_in_enabled:
            return Response({'error': '该时段无需打卡（已配置为不打卡）', 'skip': True}, status=200)

        existing = AttendanceRecord.objects.filter(user=request.user, date=today, clock_type='clock_in').first()
        if existing:
            data = AttendanceRecordSerializer(existing, context={'request': request}).data
            return Response({'encrypt': True, 'data': encrypt_data(data)})
        # 使用配置时间或默认 9:00
        if config and config.clock_in_time:
            deadline = now.replace(hour=config.clock_in_time.hour, minute=config.clock_in_time.minute, second=0, microsecond=0)
        else:
            deadline = now.replace(hour=9, minute=0, second=0, microsecond=0)
        status_val = 'late' if now > deadline else 'normal'
        logger.info(f'{request.user} 上班打卡 now: {now} deadline: {deadline} status: {status_val}')
        record = AttendanceRecord.objects.create(
            user=request.user, clock_type='clock_in', date=today,
            tenant=getattr(request, 'tenant', None) or request.user.get_active_tenant(),
            latitude=serializer.validated_data.get('latitude'),
            longitude=serializer.validated_data.get('longitude'),
            location=serializer.validated_data.get('location', ''),
            device=serializer.validated_data.get('device', ''),
            status=status_val, remark=serializer.validated_data.get('remark', ''),
            reverse_geocoding=serializer.validated_data.get('reverse_geocoding'),
            ip_address=serializer.validated_data.get('ip_address', '') or get_request_ip(request),
            user_agent=serializer.validated_data.get('user_agent', '') or request.META.get('HTTP_USER_AGENT', ''),
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
        # 管理员上班打卡通知 - 通知部门负责人和所属企业超级管理员
        if status_val == 'late':
            tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
            if tenant:
                from accounts.models import CustomUser
                notified_ids = set()
                try:
                    from org.models import UserDepartment
                    dept_rels = UserDepartment.objects.filter(user=request.user).select_related('department__manager')
                    for ud_rel in dept_rels:
                        mgr = ud_rel.department.manager
                        if mgr and mgr.id not in notified_ids and mgr.id != request.user.id:
                            notified_ids.add(mgr.id)
                            send_work_notification(
                                user_id=mgr.id,
                                title='迟到提醒',
                                content=f'{request.user.real_name or request.user.username} 今日上班打卡迟到',
                                notification_type='attendance',
                                related_url='/oa/attendance/',
                                extra_data={'user_id': request.user.id, 'status': 'late', 'date': str(today)},
                            )
                except Exception:
                    pass
                admins = CustomUser.objects.filter(
                    Q(user_type='super_admin') & Q(tenant=tenant)
                ).exclude(id=request.user.id)
                for admin in admins:
                    if admin.id not in notified_ids:
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
        # 检查考勤配置（含用户主部门）
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        from org.models import UserDepartment
        primary_dept = UserDepartment.objects.filter(user=request.user, is_primary=True).select_related('department').first()
        dept_id = primary_dept.department_id if primary_dept else None
        config = self._get_attendance_config(tenant, dept_id)
        if config and not config.clock_out_enabled:
            return Response({'error': '该时段无需打卡（已配置为不打卡）', 'skip': True}, status=200)

        existing = AttendanceRecord.objects.filter(user=request.user, date=today, clock_type='clock_out').first()
        if existing:
            data = AttendanceRecordSerializer(existing, context={'request': request}).data
            return Response({'encrypt': True, 'data': encrypt_data(data)})
        # 查找最近一次上班打卡（支持跨夜班次）
        from datetime import timedelta as td
        clock_in_record = AttendanceRecord.objects.filter(
            user=request.user, clock_type='clock_in'
        ).order_by('-clock_time').first()
        if not clock_in_record or (clock_in_record.date < today - td(days=1)):
            return Response({'error': '请先上班打卡'}, status=400)
        # 使用配置时间或默认 18:00
        if config and config.clock_out_time:
            deadline = now.replace(hour=config.clock_out_time.hour, minute=config.clock_out_time.minute, second=0, microsecond=0)
        else:
            deadline = now.replace(hour=18, minute=0, second=0, microsecond=0)
        status_val = 'early_leave' if now < deadline else 'normal'
        logger.info(f'{request.user} 下班打卡 now: {now} deadline: {deadline} status: {status_val}')
        record = AttendanceRecord.objects.create(
            user=request.user, clock_type='clock_out', date=today,
            tenant=getattr(request, 'tenant', None) or request.user.get_active_tenant(),
            latitude=serializer.validated_data.get('latitude'),
            longitude=serializer.validated_data.get('longitude'),
            location=serializer.validated_data.get('location', ''),
            device=serializer.validated_data.get('device', ''),
            status=status_val, remark=serializer.validated_data.get('remark', ''),
            reverse_geocoding=serializer.validated_data.get('reverse_geocoding'),
            ip_address=serializer.validated_data.get('ip_address', '') or get_request_ip(request),
            user_agent=serializer.validated_data.get('user_agent', '') or request.META.get('HTTP_USER_AGENT', ''),
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

    @action(detail=True, methods=['get'])
    def convert_coords(self, request, pk=None):
        """获取打卡记录的BD09坐标（用于百度地图），如需转换则调用百度坐标转换接口"""
        try:
            record = AttendanceRecord.objects.get(id=pk)
            if request.user.user_type not in ['super_admin', 'admin'] and record.user != request.user:
                return Response({'error': '暂无查看权限'}, status=403)

            # 如果已有BD09坐标，直接返回
            if record.bd09_latitude is not None and record.bd09_longitude is not None:
                return Response({
                    'bd09_latitude': record.bd09_latitude,
                    'bd09_longitude': record.bd09_longitude,
                    'source': 'cache',
                })

            # 没有GPS坐标则无法转换
            if record.latitude is None or record.longitude is None:
                return Response({'error': '无位置信息'}, status=400)

            from utils.reverse_geocoding_to_city import baidu_convert_WGS84ToBD09
            ak = getattr(settings, 'BAIDU_MAP_SERVER_AK', '')
            if not ak:
                return Response({'error': '百度地图AK未配置'}, status=500)

            result = baidu_convert_WGS84ToBD09(record.longitude, record.latitude, ak)
            if result and result.get('status') == 0:
                coords = result['result'][0]
                bd09_lng = coords['x']
                bd09_lat = coords['y']
                # 保存到记录
                record.bd09_longitude = bd09_lng
                record.bd09_latitude = bd09_lat
                record.save(update_fields=['bd09_longitude', 'bd09_latitude'])
                return Response({
                    'bd09_latitude': bd09_lat,
                    'bd09_longitude': bd09_lng,
                    'source': 'converted',
                })
            return Response({'error': '坐标转换失败'}, status=502)
        except AttendanceRecord.DoesNotExist:
            return Response({'error': '记录不存在'}, status=404)
        except Exception as e:
            logger.error(f'坐标转换异常: {e}')
            return Response({'error': str(e)}, status=500)

    @action(detail=False, methods=['get'])
    def export(self, request):
        from django.http import HttpResponse
        from urllib.parse import quote
        import csv
        user = request.user
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        qs = AttendanceRecord.objects.select_related('user__department').all()
        if user.user_type not in ['super_admin', 'admin']:
            qs = qs.filter(user=user)
            if tenant:
                qs = qs.filter(tenant=tenant)

        # Filter by selected record IDs
        record_ids_str = request.query_params.get('record_ids', '').strip()
        if record_ids_str:
            ids = [int(x) for x in record_ids_str.split(',') if x.strip().isdigit()]
            if ids:
                qs = qs.filter(id__in=ids)
        qs = qs.order_by('-clock_time')[:10000]
        # Determine fields to export
        fields_param = request.query_params.get('fields', '').strip()
        field_map = {
            'user_name': lambda r: r.user.real_name or r.user.username,
            'department_name': lambda r: r.user.department.name if r.user.department else '',
            'date': lambda r: str(r.date),
            'clock_type_display': lambda r: r.get_clock_type_display(),
            'clock_time': lambda r: r.clock_time.strftime('%Y-%m-%d %H:%M:%S') if r.clock_time else '',
            'status': lambda r: {'normal': '正常', 'late': '迟到', 'early_leave': '早退'}.get(r.status, r.status),
            'location': lambda r: r.location or '',
            'device': lambda r: r.device or '',
        }
        field_labels = {
            'user_name': '用户', 'department_name': '部门', 'date': '日期',
            'clock_type_display': '打卡类型', 'clock_time': '打卡时间', 'status': '状态',
            'location': '位置', 'device': '设备',
        }

        if fields_param:
            selected_fields = [f.strip() for f in fields_param.split(',') if f.strip() in field_map]
        else:
            selected_fields = list(field_map.keys())
        # Generate filename with datetime
        now_dt = timezone.localtime(timezone.now())
        date_str = now_dt.strftime('%Y%m%d_%H%M%S')
        filename = f'考勤记录_{date_str}.csv'
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f"attachment; filename*=UTF-8''{quote(filename)}"
        writer = csv.writer(response)
        writer.writerow([field_labels.get(f, f) for f in selected_fields])
        for r in qs:
            try:
                row = [field_map[f](r) for f in selected_fields]
                logger.info(f'row: {row}')
                writer.writerow(row)
            except Exception as e:
                logger.error(f'导出行数据异常: {e}, record={r.id}')
                continue
        return response

    @action(detail=False, methods=['get'])
    def calendar_stats(self, request):
        """日历统计：按月返回每日打卡状态"""
        now = timezone.localtime(timezone.now())
        year = int(request.query_params.get('year', now.year))
        month = int(request.query_params.get('month', now.month))
        import calendar as cal_mod
        _, days_in_month = cal_mod.monthrange(year, month)
        from datetime import date, timedelta
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        records = AttendanceRecord.objects.filter(
            user=request.user,
            date__year=year, date__month=month
        ).order_by('date', 'clock_time')
        daily = {}
        for r in records:
            d_str = r.date.isoformat()
            if d_str not in daily:
                daily[d_str] = {'date': d_str, 'clock_in': None, 'clock_out': None, 'status': []}
            entry = daily[d_str]
            if r.clock_type == 'clock_in':
                entry['clock_in'] = {
                    'time': timezone.localtime(r.clock_time).strftime('%H:%M') if r.clock_time else '',
                    'status': r.status, 'location': r.location or '',
                }
            elif r.clock_type == 'clock_out':
                entry['clock_out'] = {
                    'time': timezone.localtime(r.clock_time).strftime('%H:%M') if r.clock_time else '',
                    'status': r.status, 'location': r.location or '',
                }
        # 构建每日状态
        result = []
        for d in range(1, days_in_month + 1):
            dt = date(year, month, d)
            d_str = dt.isoformat()
            today = now.date()
            entry = daily.get(d_str, {'date': d_str, 'clock_in': None, 'clock_out': None})
            ci = entry.get('clock_in')
            co = entry.get('clock_out')
            day_status = 'normal'
            day_label = '正常'
            if dt > today:
                day_status = 'future'
                day_label = '未到'
            elif ci and co:
                if ci['status'] == 'late' or co['status'] == 'early_leave':
                    day_status = 'late'
                    day_label = '异常'
                    if ci['status'] == 'late' and co['status'] == 'early_leave':
                        day_label = '迟到+早退'
                    elif ci['status'] == 'late':
                        day_label = '迟到'
                    elif co['status'] == 'early_leave':
                        day_label = '早退'
                else:
                    day_status = 'normal'
                    day_label = '正常'
            elif ci and not co:
                day_status = 'miss_clock'
                day_label = '缺卡'
            elif not ci and dt < today:
                day_status = 'absent'
                day_label = '缺勤'
            else:
                day_status = 'none'
                day_label = ''
            entry['day_status'] = day_status
            entry['day_label'] = day_label
            result.append(entry)
        # 统计汇总
        summary = {
            'total': days_in_month,
            'normal': sum(1 for e in result if e['day_status'] == 'normal'),
            'late': sum(1 for e in result if e['day_status'] == 'late'),
            'miss_clock': sum(1 for e in result if e['day_status'] == 'miss_clock'),
            'absent': sum(1 for e in result if e['day_status'] == 'absent'),
            'future': sum(1 for e in result if e['day_status'] == 'future'),
        }
        return Response({'encrypt': True, 'data': encrypt_data({
            'year': year, 'month': month, 'days': result, 'summary': summary,
        })})

    @action(detail=False, methods=['get'])
    def calendar_day_detail(self, request):
        """日历日期详情：返回该日打卡记录及加班审批信息"""
        date_str = request.query_params.get('date', '')
        if not date_str:
            return Response({'error': '缺少日期参数'}, status=400)
        from datetime import date as dt_date
        try:
            target_date = dt_date.fromisoformat(date_str)
        except ValueError:
            return Response({'error': '日期格式错误'}, status=400)
        records = AttendanceRecord.objects.filter(
            user=request.user, date=target_date
        ).order_by('clock_time')
        clock_in = None
        clock_out = None
        for r in records:
            if r.clock_type == 'clock_in':
                clock_in = AttendanceRecordSerializer(r, context={'request': request}).data
            elif r.clock_type == 'clock_out':
                clock_out = AttendanceRecordSerializer(r, context={'request': request}).data
        # 查找该日的加班审批（加班类型，日期覆盖该日）
        overtime_info = None
        try:
            overtime_reqs = ApprovalRequest.objects.filter(
                applicant=request.user,
                approval_type='overtime',
                status='approved',
                start_date__lte=target_date,
                end_date__gte=target_date,
            )
            for req in overtime_reqs:
                overtime_info = {
                    'id': req.id,
                    'title': req.title,
                    'duration': float(req.duration) if req.duration else 0,
                    'content': req.content or '',
                    'status': req.status,
                }
                break
        except Exception:
            pass
        result = {
            'date': date_str,
            'clock_in': clock_in,
            'clock_out': clock_out,
            'overtime': overtime_info,
        }
        return Response({'encrypt': True, 'data': encrypt_data(result)})

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

    # ──────── 考勤配置 ────────

    def _get_attendance_config(self, tenant, department_id=None):
        """按优先级获取考勤配置：部门配置 > 子企业配置 > 企业默认 > 父级回溯"""
        if not tenant:
            return None
        # 1. 部门级配置
        if department_id:
            try:
                return AttendanceConfig.objects.get(tenant=tenant, department_id=department_id)
            except AttendanceConfig.DoesNotExist:
                pass
        # 2. 子企业专属配置（配置在 parent tenant 上，sub_tenant=当前企业）
        if tenant.parent:
            try:
                return AttendanceConfig.objects.get(
                    tenant=tenant.parent, sub_tenant=tenant, department__isnull=True)
            except AttendanceConfig.DoesNotExist:
                pass
        # 3. 当前企业默认配置
        try:
            return AttendanceConfig.objects.get(
                tenant=tenant, sub_tenant__isnull=True, department__isnull=True)
        except AttendanceConfig.DoesNotExist:
            pass
        # 4. 父级集团回溯
        if tenant.parent:
            parent = self._get_parent_tenant(tenant)
            if parent:
                return self._get_attendance_config(parent)
        return None

    def _get_parent_tenant(self, tenant):
        return tenant.parent if tenant.parent else None

    @action(detail=False, methods=['get'])
    def attendance_configs(self, request):
        """获取考勤配置列表 + 子公司列表"""
        from .serializers import AttendanceConfigSerializer
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        if not tenant:
            return Response({'results': [], 'sub_tenants': []})
        from django.db.models import Q
        query = Q(tenant=tenant)
        try:
            sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
            if sub_ids:
                query |= Q(tenant_id__in=sub_ids)
        except Exception:
            pass
        configs = AttendanceConfig.objects.filter(query).select_related('department', 'sub_tenant')
        data = AttendanceConfigSerializer(configs, many=True).data
        extra = {'sub_tenants': list(tenant.sub_tenants.filter(is_active=True).values(
            'id', 'name', 'short_name', 'tenant_type'))} if hasattr(tenant, 'sub_tenants') else {'sub_tenants': []}
        return Response({'results': data, **extra})

    @action(detail=False, methods=['post'])
    def save_attendance_config(self, request):
        """保存考勤配置"""
        if request.user.user_type not in ('super_admin', 'admin'):
            return Response({'error': '仅企业超级管理员或管理员可操作'}, status=403)
        from accounts.models import Department, Tenant
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        if not tenant:
            return Response({'error': '未找到所属企业'}, status=400)
        sub_tenant_id = request.data.get('sub_tenant_id')
        sub_tenant_obj = None
        if sub_tenant_id:
            try:
                sub_tenant_obj = Tenant.objects.get(id=int(sub_tenant_id))
                if sub_tenant_obj.parent_id != tenant.id:
                    return Response({'error': '指定的子公司不属于当前企业集团'}, status=400)
            except (ValueError, Tenant.DoesNotExist):
                return Response({'error': '子公司不存在'}, status=400)
        department_id = request.data.get('department_id')
        dept = None
        if department_id:
            try:
                dept = Department.objects.get(id=int(department_id), tenant=tenant)
            except (ValueError, Department.DoesNotExist):
                return Response({'error': '部门不存在'}, status=400)
        from .serializers import AttendanceConfigSerializer
        clock_in_time = request.data.get('clock_in_time')
        clock_out_time = request.data.get('clock_out_time')
        from datetime import time as dt_time
        if clock_in_time:
            try:
                parts = clock_in_time.split(':')
                clock_in_time = dt_time(int(parts[0]), int(parts[1]), 0)
            except (ValueError, IndexError):
                return Response({'error': '上班打卡时间格式错误，请使用 HH:MM 格式'}, status=400)
        if clock_out_time:
            try:
                parts = clock_out_time.split(':')
                clock_out_time = dt_time(int(parts[0]), int(parts[1]), 0)
            except (ValueError, IndexError):
                return Response({'error': '下班打卡时间格式错误，请使用 HH:MM 格式'}, status=400)
        defaults = {
            'clock_in_enabled': request.data.get('clock_in_enabled', True),
            'clock_in_time': clock_in_time,
            'clock_out_enabled': request.data.get('clock_out_enabled', True),
            'clock_out_time': clock_out_time,
        }
        try:
            config, created = AttendanceConfig.objects.update_or_create(
                tenant=tenant,
                sub_tenant=sub_tenant_obj,
                department=dept,
                defaults=defaults,
            )
            data = AttendanceConfigSerializer(config).data
            return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201 if created else 200)
        except Exception as e:
            logger.error(f'保存考勤配置失败: {e}')
            return Response({'error': f'保存配置失败: {str(e)}'}, status=400)

    @action(detail=True, methods=['delete'])
    def delete_attendance_config(self, request, pk=None):
        """删除考勤配置"""
        if request.user.user_type != 'super_admin':
            return Response({'error': '仅超级管理员可操作'}, status=403)
        try:
            config = AttendanceConfig.objects.get(id=pk)
            config.delete()
            return Response({'message': 'ok'})
        except AttendanceConfig.DoesNotExist:
            return Response({'error': '配置不存在'}, status=404)

    @action(detail=False, methods=['get'])
    def resolve_my_config(self, request):
        """获取当前用户的考勤配置（按优先级解析）"""
        from org.models import UserDepartment
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        primary_dept = UserDepartment.objects.filter(user=request.user, is_primary=True).select_related('department').first()
        dept_id = primary_dept.department_id if primary_dept else None
        config = self._get_attendance_config(tenant, dept_id)
        # 返回配置和当前企业的默认时间
        result = {
            'config': config,
            'default_clock_in_time': '09:00',
            'default_clock_out_time': '18:00',
        }
        if config:
            from .serializers import AttendanceConfigSerializer
            result['config'] = AttendanceConfigSerializer(config).data
        return Response({'encrypt': True, 'data': encrypt_data(result)})


class ApprovalTypeViewSet(viewsets.ViewSet):
    """审批类型管理（内置 + 企业自定义）"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """返回当前企业可用审批类型：全局内置 + 当前企业自定义（含 form_schema）。

        ?scope=manage：类型管理用，包含未启用的自定义类型（保证可重新编辑/启用）。
        默认仅返回启用类型（供新建审批选择）。
        """
        ensure_builtin_types()
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        scope = request.query_params.get('scope', '')
        if scope == 'manage':
            # 类型管理：内置 + 当前企业全部自定义（含未启用）
            qs = ApprovalType.objects.all()
            if tenant:
                qs = qs.filter(Q(tenant=tenant) | Q(tenant__isnull=True)).order_by('-tenant_id', 'sort_order', 'id')
            else:
                qs = qs.filter(tenant__isnull=True).order_by('sort_order', 'id')
        else:
            qs = ApprovalType.objects.filter(enabled=True)
            if tenant:
                qs = qs.filter(Q(tenant=tenant) | Q(tenant__isnull=True)).order_by('-tenant_id', 'sort_order', 'id')
            else:
                qs = qs.filter(tenant__isnull=True).order_by('sort_order', 'id')
        data = [{
            'id': t.id,
            'code': t.code,
            'name': t.name,
            'icon': t.icon,
            'color': t.color,
            'description': t.description or '',
            'is_builtin': t.is_builtin,
            'form_schema': t.form_schema or [],
            'sort_order': t.sort_order,
            'enabled': t.enabled,
        } for t in qs]
        return Response({'results': data, 'count': len(data)})

    @staticmethod
    def _validate_schema(schema):
        """校验 form_schema 结构，返回错误字符串或 None"""
        if not isinstance(schema, list):
            return '表单字段定义必须为数组'
        seen_keys = set()
        for f in schema:
            if not isinstance(f, dict):
                return '字段定义格式错误'
            if not f.get('key') or not f.get('label'):
                return '每个字段必须包含 key 和 label'
            if f['key'] in seen_keys:
                return f'字段编码(key)「{f["key"]}」存在重复'
            seen_keys.add(f['key'])
            ftype = f.get('type')
            if ftype not in dict(ApprovalType.FIELD_TYPES):
                return f'字段类型 {ftype} 不支持'
            if ftype in ('select', 'radio', 'checkbox') and not f.get('options'):
                return f'字段 {f.get("label")} 需要配置选项'
        return None

    @staticmethod
    def _normalize_schema(schema):
        """规范 form_schema：options 统一为数组，补齐 required/placeholder 等默认值"""
        if not isinstance(schema, list):
            return schema
        for f in schema:
            if not isinstance(f, dict):
                continue
            opts = f.get('options')
            if isinstance(opts, str):
                f['options'] = [s.strip() for s in opts.replace('，', ',').split(',') if s.strip()]
            if not isinstance(f.get('options'), list):
                f['options'] = []
            f.setdefault('required', False)
            f.setdefault('placeholder', '')
        return schema

    @staticmethod
    def _admin(request):
        return request.user.user_type in ('super_admin', 'admin')

    def create(self, request):
        if not self._admin(request):
            return Response({'error': '仅企业超级管理员或管理员可操作'}, status=403)
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        if not tenant:
            return Response({'error': '未找到所属企业'}, status=400)
        code = (request.data.get('code') or '').strip()
        name = (request.data.get('name') or '').strip()
        if not code or not name:
            return Response({'error': '类型编码和名称不能为空'}, status=400)
        if ApprovalType.objects.filter(tenant=tenant, code=code).exists():
            return Response({'error': '该企业下已存在此编码的审批类型'}, status=400)
        schema = self._normalize_schema(request.data.get('form_schema', []) or [])
        err = self._validate_schema(schema)
        if err:
            return Response({'error': err}, status=400)
        t = ApprovalType.objects.create(
            tenant=tenant, code=code, name=name,
            icon=(request.data.get('icon') or 'fa-file-lines'),
            color=(request.data.get('color') or '#409EFF'),
            description=(request.data.get('description') or ''),
            enabled=bool(request.data.get('enabled', True)),
            form_schema=schema,
            sort_order=int(request.data.get('sort_order') or 0),
        )
        return Response({'message': '创建成功', 'code': t.code}, status=201)

    def update(self, request, pk=None):
        if not self._admin(request):
            return Response({'error': '仅企业超级管理员或管理员可操作'}, status=403)
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        try:
            t = ApprovalType.objects.get(pk=pk)
        except ApprovalType.DoesNotExist:
            return Response({'error': '类型不存在'}, status=404)
        if t.is_builtin or (tenant and t.tenant_id != tenant.id):
            return Response({'error': '无权限修改该类型'}, status=403)
        if 'code' in request.data and (request.data.get('code') or '').strip() != t.code:
            new_code = (request.data.get('code') or '').strip()
            if ApprovalType.objects.filter(tenant=t.tenant_id, code=new_code).exclude(pk=t.pk).exists():
                return Response({'error': '该编码已存在'}, status=400)
            t.code = new_code
        if 'name' in request.data and (request.data.get('name') or '').strip():
            t.name = request.data['name'].strip()
        if 'icon' in request.data:
            t.icon = request.data.get('icon') or t.icon
        if 'color' in request.data:
            t.color = request.data.get('color') or t.color
        if 'description' in request.data:
            t.description = request.data.get('description') or ''
        if 'enabled' in request.data:
            t.enabled = bool(request.data.get('enabled'))
        if 'form_schema' in request.data:
            schema = self._normalize_schema(request.data.get('form_schema') or [])
            err = self._validate_schema(schema)
            if err:
                return Response({'error': err}, status=400)
            t.form_schema = schema
        t.save()
        return Response({'message': '更新成功'})

    def destroy(self, request, pk=None):
        if not self._admin(request):
            return Response({'error': '仅企业超级管理员或管理员可操作'}, status=403)
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        try:
            t = ApprovalType.objects.get(pk=pk)
        except ApprovalType.DoesNotExist:
            return Response({'error': '类型不存在'}, status=404)
        if t.is_builtin or (tenant and t.tenant_id != tenant.id):
            return Response({'error': '内置类型不可删除或无权限'}, status=403)
        t.delete()
        return Response({'message': '删除成功'})


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
            tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
            if tenant:
                # 集团企业：包含子企业审批
                tenant_ids = [tenant.id]
                try:
                    sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
                    if user.user_type == 'super_admin' and sub_ids:
                        tenant_ids.extend(sub_ids)
                except Exception:
                    pass
                qs = qs.filter(tenant_id__in=tenant_ids)

        else:
            # 申请人自己的审批
            my_approval_ids = ApprovalRequest.objects.filter(applicant=user).values_list('id', flat=True)
            # 审批节点已到达的审批人对应的审批（并行审批全部节点，顺序审批仅当前节点）
            active_assignee_ids = ApprovalAssignee.objects.filter(
                user=user
            ).exclude(
                node__request__applicant=user
            ).filter(
                Q(node__request__approval_mode='parallel') |
                Q(
                    node__request__approval_mode='sequential',
                    node__order=models.F('node__request__current_node_order')
                )
            ).values_list('node__request_id', flat=True).distinct()

            # 抄送人看到的审批
            cc_ids = ApprovalCarbonCopy.objects.filter(
                cc_user=user
            ).values_list('request_id', flat=True).distinct()
            # 抄送部门负责人/副负责人看到的审批
            cc_dept_ids = []
            try:
                from org.models import UserDepartment
                user_dept_ids = list(UserDepartment.objects.filter(user=user).values_list('department_id', flat=True))
                # Also include departments where user is manager or deputy manager
                from accounts.models import Department
                managed_dept_ids = list(Department.objects.filter(
                    Q(manager=user) | Q(deputy_managers=user)
                ).values_list('id', flat=True))
                all_dept_ids = list(set(user_dept_ids + managed_dept_ids))
                if all_dept_ids:
                    cc_dept_ids = list(ApprovalCarbonCopy.objects.filter(
                        cc_department_id__in=all_dept_ids
                    ).values_list('request_id', flat=True).distinct())
            except Exception:
                pass

            qs = ApprovalRequest.objects.select_related('applicant', 'department').filter(
                Q(id__in=my_approval_ids) | Q(id__in=active_assignee_ids) |
                Q(id__in=cc_ids) | Q(id__in=cc_dept_ids)
            )

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

        qs = qs.order_by('-updated_at')
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
            # 允许：超级管理员、申请人、当前审批节点到达的审批人、抄送人查看
            is_cc = approval.carbon_copies.filter(
                Q(cc_user=request.user) | Q(cc_department__manager=request.user) | Q(cc_department__deputy_managers=request.user)
            ).exists()
            can_view = (
                request.user.user_type in ['super_admin', 'admin']
                or approval.applicant == request.user
                or self._check_user_can_view(approval, request.user)
                or is_cc
            )
            if not can_view:
                return Response({'error': '暂无查看权限'}, status=403)
            data = ApprovalRequestSerializer(approval, context={'request': request}).data
            # 查询该审批类型是否需要手写签名：以审批所属企业为准（审批在哪家企业发起，
            # 就应用该企业的配置，子公司专属配置优先于集团默认配置）。
            try:
                tenant = approval.tenant or getattr(request, 'tenant', None) or request.user.get_active_tenant()
                config = self._get_config_for_tenant(tenant, approval.approval_type) if tenant else None
                data['require_signature'] = bool(config and config.require_signature)
            except Exception as e:
                logger.warning(f'解析审批签名配置失败: {e}')
                data['require_signature'] = False

            # 标注最终审批人的配置来源（优先使用节点固化的来源；历史数据缺失时实时解析兜底）
            try:
                tenant = approval.tenant or getattr(request, 'tenant', None) or request.user.get_active_tenant()
                _, fa_source, fa_source_label = self._resolve_final_approver(tenant, approval.approval_type)
                if fa_source:
                    for n in (data.get('approval_nodes') or []):
                        if n.get('is_final_approver') and not n.get('final_approver_source'):
                            n['final_approver_source'] = fa_source
                            n['final_approver_source_label'] = fa_source_label
            except Exception as e:
                logger.warning(f'标注最终审批人配置来源失败: {e}')

            return Response({'encrypt': True, 'data': encrypt_data(data)})
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)

    def create(self, request):
        serializer = ApprovalCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)

        approval_type = serializer.validated_data['approval_type']
        department_id = serializer.validated_data.get('department_id')
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()

        # 统一 form_data：内置类型镜像 legacy 字段，自定义类型按 schema 校验
        form_data = collect_form_data(
            serializer.validated_data,
            serializer.validated_data.get('form_data') or {},
            approval_type,
        )
        type_obj = resolve_approval_type(approval_type, tenant)
        if type_obj and not type_obj.is_builtin:
            verr = validate_form_data(type_obj.form_schema or [], form_data)
            if verr:
                return Response({'error': '表单校验失败', 'fields': verr}, status=400)

        # 审批人自动根据所选部门和审批类型生成
        approver_nodes = serializer.validated_data.get('approver_nodes', [])
        if not approver_nodes:
            threshold_values = self._gather_threshold_values(serializer.validated_data, form_data)
            approver_nodes = self._auto_determine_approvers(
                request.user, tenant,
                approval_type=approval_type,
                department_id=department_id,
                threshold_values=threshold_values or None,
            )

        # 所属部门
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
                tenant=getattr(request, 'tenant', None) or request.user.get_active_tenant(),
                department=department,
                approval_type=approval_type,
                title=serializer.validated_data['title'],
                content=serializer.validated_data.get('content', ''),
                start_date=serializer.validated_data.get('start_date'),
                end_date=serializer.validated_data.get('end_date'),
                duration=serializer.validated_data.get('duration'),
                amount=serializer.validated_data.get('amount'),
                expense_type=serializer.validated_data.get('expense_type', ''),
                expense_date=serializer.validated_data.get('expense_date'),
                attachments=serializer.validated_data.get('attachments', []),
                recruit_data=serializer.validated_data.get('recruit_data', {}),
                form_data=form_data,
                sign_type=serializer.validated_data.get('sign_type', 'countersign'),
                approval_mode=serializer.validated_data.get('approval_mode', 'sequential'),
            )
            from accounts.models import CustomUser, Department

            # 创建发起人节点（order 0，展示用）
            ApprovalNode.objects.create(
                request=approval, node_type='initiator',
                user=request.user, order=0,
            )

            if approver_nodes:
                for idx, node_data in enumerate(approver_nodes):
                    node_type = node_data.get('type', 'user')
                    node = ApprovalNode.objects.create(
                        request=approval,
                        node_type=node_type,
                        order=idx + 1,
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
                        user=admin, order=1,
                    )
                    ApprovalAssignee.objects.create(node=node, user=admin)

            # 若配置了最终审批人，标记对应节点
            self._mark_final_approver_node(approval, request)

            # 如果是顺序审批，只激活第一个审批人节点（order=1跳过发起人节点）
            if approval.approval_mode == 'sequential':
                approval.current_node_order = 1
                approval.save()

        # 通知审批人（顺序审批仅通知第一个节点）
        from accounts.models import CustomUser
        assignee_qs = ApprovalAssignee.objects.filter(node__request=approval, status='pending')
        if approval.approval_mode == 'sequential':
            first_node = approval.approval_nodes.filter(order=1).first()
            assignee_qs = assignee_qs.filter(node=first_node) if first_node else assignee_qs.none()
        for asgn in assignee_qs.select_related('user'):
            send_work_notification(
                user_id=asgn.user.id,
                title='审批待处理',
                content=f'{request.user.real_name or request.user.username} 提交了{_approval_type_label(approval)}申请：“{approval.title}”',
                notification_type='approval',
                related_url='/oa/approval/',
                extra_data={'approval_id': approval.id, 'action': 'pending'},
            )

        # 处理抄送（用户+部门）
        cc_user_ids = serializer.validated_data.get('cc_users', [])
        cc_dept_ids = serializer.validated_data.get('cc_departments', [])
        self._create_cc_records(approval, request, cc_user_ids, cc_dept_ids)

        # 加载默认配置中的抄送
        if request.tenant and approval.approval_type:
            try:
                config = ApprovalDeptConfig.objects.get(tenant=request.tenant, approval_type=approval.approval_type, sub_tenant__isnull=True)
                if config.cc_users:
                    self._create_cc_records(approval, request, config.cc_users, [])
                if config.cc_departments:
                    self._create_cc_records(approval, request, [], config.cc_departments)
            except ApprovalDeptConfig.DoesNotExist:
                pass

        logger.info(f'{request.user} 提交审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201)

    def _get_level_approvers(self, dept, user, seen_ids):
        """获取部门级别的审批人：先副负责人，后主负责人"""
        result = []
        # Deputy managers first (from Department.deputy_managers M2M)
        for dm in dept.deputy_managers.all():
            if dm.id not in seen_ids and dm.id != user.id and dm.is_active:
                seen_ids.add(dm.id)
                result.append({
                    'type': 'user', 'id': dm.id,
                    'label': f'{dm.real_name or dm.username}（副负责人）',
                    'user_position': dm.position or '副负责人',
                })
        # Primary manager (from Department.manager FK)
        if dept.manager and dept.manager.id not in seen_ids and dept.manager.id != user.id and dept.manager.is_active:
            seen_ids.add(dept.manager.id)
            result.append({
                'type': 'user', 'id': dept.manager.id,
                'label': f'{dept.manager.real_name or dept.manager.username}（负责人）',
                'user_position': dept.manager.position or '负责人',
            })

        if not result:
            # Fallback: use UserDepartment records when Department.manager/deputy_managers not set
            try:
                from org.models import UserDepartment
                uds = UserDepartment.objects.filter(department=dept).select_related('user').order_by('-is_primary', 'id')
                for ud in uds:
                    if ud.user.id not in seen_ids and ud.user.id != user.id and ud.user.is_active:
                        seen_ids.add(ud.user.id)
                        label = ud.user.real_name or ud.user.username
                        pos = ud.position or ud.user.position or ''
                        if pos:
                            label += f'（{pos}）'
                        result.append({
                            'type': 'user', 'id': ud.user.id,
                            'label': label,
                            'user_position': pos,
                        })
                        break
            except Exception:
                pass

        if not result:
            # Final fallback: use CustomUser.department FK (accounts.models)
            try:
                from accounts.models import CustomUser
                users = CustomUser.objects.filter(department=dept, is_active=True).order_by('id')
                for u in users:
                    if u.id not in seen_ids and u.id != user.id and u.is_active:
                        seen_ids.add(u.id)
                        label = u.real_name or u.username
                        pos = u.position or ''
                        if pos:
                            label += f'（{pos}）'
                        result.append({
                            'type': 'user', 'id': u.id,
                            'label': label,
                            'user_position': pos,
                        })
                        break
            except Exception:
                pass

        return result

    def _get_parent_tenant(self, tenant):
        """获取上级集团企业"""
        if not tenant:
            return None
        return tenant.parent if tenant.parent else None

    def _get_root_tenant(self, tenant):
        """获取根集团企业"""
        if not tenant:
            return None
        return tenant.get_root_tenant()

    def _get_final_approval_dept(self, tenant, approval_type, traverse_parent=True):
        """获取指定审批类型的最终审批部门（支持向上级集团查找）"""
        if not tenant or not approval_type:
            return None
        # 当前企业配置
        try:
            config = ApprovalDeptConfig.objects.get(tenant=tenant, approval_type=approval_type, sub_tenant__isnull=True)
            return config.department
        except ApprovalDeptConfig.DoesNotExist:
            pass
        # 上级集团配置兜底
        if traverse_parent:
            parent = self._get_parent_tenant(tenant)
            if parent:
                return self._get_final_approval_dept(parent, approval_type, traverse_parent=True)
        return None

    def _final_approver_source_label(self, config):
        """最终审批人配置来源展示文案"""
        if config and config.sub_tenant_id:
            return '子公司自定义配置'
        try:
            if config and config.tenant and config.tenant.sub_tenants.exists():
                return '集团默认配置'
        except Exception:
            pass
        return '默认配置'

    def _resolve_final_approver(self, tenant, approval_type):
        """解析配置的最终审批人及其来源（允许置空）

        返回 (user, source, source_label)：
        source ∈ ('sub' 子公司自定义配置, 'default' 集团/企业默认配置, None)
        优先级：集团子公司自定义配置 > 集团默认配置；
        子公司配置存在但未设置最终审批人时，回退到集团默认配置的最终审批人。
        """
        if not tenant or not approval_type:
            return None, None, ''
        config = self._get_config_for_tenant(tenant, approval_type)
        if not config:
            return None, None, ''
        if config.final_approver_id:
            source = 'sub' if config.sub_tenant_id else 'default'
            return config.final_approver, source, self._final_approver_source_label(config)
        # 子公司专属配置未设置最终审批人：回退到集团默认配置
        if config.sub_tenant_id:
            default_config = ApprovalDeptConfig.objects.filter(
                tenant=config.tenant_id,
                approval_type=approval_type,
                sub_tenant__isnull=True
            ).order_by('-updated_at').first()
            if default_config and default_config.final_approver_id:
                return default_config.final_approver, 'default', self._final_approver_source_label(default_config)
        return None, None, ''

    def _get_final_approver(self, tenant, approval_type):
        """获取配置的最终审批人（允许置空）"""
        user, _, _ = self._resolve_final_approver(tenant, approval_type)
        return user

    def _mark_final_approver_node(self, approval, request):
        """若该审批类型配置了最终审批人，则将对应审批节点标记为最终审批人（供前端流程标识），并固化配置来源"""
        try:
            tenant = approval.tenant or getattr(request, 'tenant', None) or request.user.get_active_tenant()
            final_user, final_source, _ = self._resolve_final_approver(tenant, approval.approval_type)
            if not final_user:
                return
            match = approval.approval_nodes.filter(
                user=final_user, node_type='user'
            ).order_by('-order').first()
            if match:
                match.is_final_approver = True
                match.final_approver_source = final_source or ''
                match.save(update_fields=['is_final_approver', 'final_approver_source'])
        except Exception as e:
            logger.warning(f'标记最终审批人节点失败: {e}')

    def _get_config_for_tenant(self, tenant, approval_type, traverse_parent=True):
        """获取审批配置，支持子企业专属配置和向父级集团回溯

        优先级：
        1. 子企业专属配置（集团配置中 sub_tenant=当前企业）
        2. 当前企业的默认配置（或集团的默认配置）
        3. 向父级集团回溯查找
        """
        if not tenant or not approval_type:
            return None
        # 确定配置所属的 tenant（子企业配置存在集团上，公司配置存在自己上）
        config_tenant = tenant.parent if tenant.parent else tenant

        # 第1优先：子企业专属配置（集团配置中 sub_tenant=当前企业）
        sub_config = ApprovalDeptConfig.objects.filter(
            tenant=config_tenant,
            approval_type=approval_type,
            sub_tenant=tenant if tenant.parent else None,
        ).order_by('-updated_at').first()
        if sub_config:
            return sub_config

        # 第2优先：当前 tenant 的默认配置（无 sub_tenant）
        default_config = ApprovalDeptConfig.objects.filter(
            tenant=config_tenant,
            approval_type=approval_type,
            sub_tenant__isnull=True
        ).order_by('-updated_at').first()
        if default_config:
            return default_config

        # 第3优先：向父级集团回溯
        if traverse_parent:
            parent = self._get_parent_tenant(tenant)
            if parent:
                return self._get_config_for_tenant(parent, approval_type, traverse_parent=True)

        return None

    def _fallback_approvers(self, user, tenant):
        """兜底：查找企业管理员（支持向父级集团回溯）"""
        from accounts.models import CustomUser
        from django.db.models import Q

        def _find_admins(t):
            if not t:
                return []
            qs = CustomUser.objects.filter(
                Q(user_type='super_admin') | Q(user_type='admin')
            ).exclude(id=user.id)
            qs = qs.filter(
                tenant_memberships__tenant=t,
                tenant_memberships__is_active=True
            )
            return list(qs.distinct()[:3])

        result = []
        seen = set()
        # 当前企业
        admins = _find_admins(tenant)
        for admin in admins:
            if admin.id not in seen:
                seen.add(admin.id)
                result.append({
                    'type': 'user', 'id': admin.id,
                    'label': admin.real_name or admin.username,
                    'user_position': admin.position or '',
                })
        # 父级集团兜底
        if not result:
            parent = self._get_parent_tenant(tenant)
            if parent:
                parent_admins = _find_admins(parent)
                for admin in parent_admins:
                    if admin.id not in seen:
                        seen.add(admin.id)
                        result.append({
                            'type': 'user', 'id': admin.id,
                            'label': f'{admin.real_name or admin.username}（集团）',
                            'user_position': admin.position or '',
                        })
        return result

    def _gather_threshold_values(self, validated_data, form_data=None):
        """收集用于阈值判断的数字字段：form_data（自定义/镜像）+ legacy（内置兜底）"""
        threshold_values = {}
        fd = form_data or {}
        for k, v in fd.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                try:
                    threshold_values[k] = float(v)
                except (ValueError, TypeError):
                    pass
        duration = validated_data.get('duration')
        if duration:
            try:
                threshold_values['duration'] = float(duration)
            except (ValueError, TypeError):
                pass
        amount = validated_data.get('amount')
        if amount:
            try:
                threshold_values['amount'] = float(amount)
            except (ValueError, TypeError):
                pass
        recruit_data = validated_data.get('recruit_data', {})
        if recruit_data and isinstance(recruit_data, dict):
            hc = recruit_data.get('headcount', 0)
            if hc:
                try:
                    threshold_values['headcount'] = float(hc)
                except (ValueError, TypeError):
                    pass
        return threshold_values if threshold_values else None

    def _create_cc_records(self, approval, request, user_ids=None, dept_ids=None):
        """创建抄送记录（支持抄送用户和部门，部门抄送自动通知部门负责人；幂等去重）"""
        user_ids = user_ids or []
        dept_ids = dept_ids or []
        from accounts.models import CustomUser, Department

        # 抄送用户（get_or_create 去重，避免同一抄送人重复创建/重复通知）
        seen_users = set()
        if user_ids:
            cc_users = CustomUser.objects.filter(id__in=user_ids, is_active=True).exclude(id=request.user.id)
            for cc_user in cc_users:
                if cc_user.id in seen_users:
                    continue
                seen_users.add(cc_user.id)
                _, created = ApprovalCarbonCopy.objects.get_or_create(
                    request=approval, cc_type='user', cc_user=cc_user,
                    defaults={'cc_department': None},
                )
                if not created:
                    continue
                send_work_notification(
                    user_id=cc_user.id,
                    title='审批抄送通知',
                    content=f'{request.user.real_name or request.user.username} 提交了{_approval_type_label(approval)}申请：“{approval.title}”，请知悉',
                    notification_type='approval',
                    related_url='/oa/approval/',
                    extra_data={'approval_id': approval.id, 'action': 'cc'},
                )

        # 抄送部门：通知该部门的主负责人和副负责人（get_or_create 去重）
        seen_depts = set()
        if dept_ids:
            depts = Department.objects.filter(id__in=dept_ids, is_active=True)
            for dept in depts:
                if dept.id in seen_depts:
                    continue
                seen_depts.add(dept.id)
                _, created = ApprovalCarbonCopy.objects.get_or_create(
                    request=approval, cc_type='department', cc_department=dept,
                    defaults={'cc_user': None},
                )
                if not created:
                    continue
                # 通知部门负责人
                if dept.manager and dept.manager.id != request.user.id:
                    send_work_notification(
                        user_id=dept.manager.id,
                        title='审批抄送通知',
                        content=f'{request.user.real_name or request.user.username} 提交了{_approval_type_label(approval)}申请：“{approval.title}”（抄送部门：{dept.name}），请知悉',
                        notification_type='approval',
                        related_url='/oa/approval/',
                        extra_data={'approval_id': approval.id, 'action': 'cc'},
                    )
                # 通知副负责人
                for dm in dept.deputy_managers.all():
                    if dm.id != request.user.id:
                        send_work_notification(
                            user_id=dm.id,
                            title='审批抄送通知',
                            content=f'{request.user.real_name or request.user.username} 提交了{_approval_type_label(approval)}申请：“{approval.title}”（抄送部门：{dept.name}），请知悉',
                            notification_type='approval',
                            related_url='/oa/approval/',
                            extra_data={'approval_id': approval.id, 'action': 'cc'},
                        )

    def _auto_determine_approvers(self, user, tenant, approval_type=None, department_id=None,
                                   threshold_values=None):
        """根据所选部门自动确定审批人链（三级审批 + 阈值超额审批）

        规则：
        1. 第一级：申请人所选部门的负责人（先副负责人，后主负责人）
        2. 第二级：申请人所选部门的上一级部门负责人
        3. 第三级：超级管理员设置的指定最终审批部门负责人
        4. 若配置了阈值且超过阈值，则增加一级阈值超额审批部门
        如果某一级没有负责人，则跳过该级到下一级

        threshold_values: dict with keys 'duration', 'amount', 'headcount'
        """
        from accounts.models import Department, CustomUser
        from org.models import UserDepartment

        if not department_id:
            return self._fallback_approvers(user, tenant)

        # Load config for this type (支持向父级集团回溯查找配置)
        config = self._get_config_for_tenant(tenant, approval_type)

        try:
            selected_dept = Department.objects.get(id=department_id, tenant=tenant)
        except Department.DoesNotExist:
            logger.error(f'Department not found for id {department_id} and tenant {tenant}')
            return self._fallback_approvers(user, tenant)

        all_approvers = []
        seen_ids = set()

        # Level 1: Selected department's heads (deputy first, then manager)
        level1 = self._get_level_approvers(selected_dept, user, seen_ids)
        all_approvers.extend(level1)

        # Level 2: Parent department's heads (only if level 1 has someone)
        if selected_dept.parent:
            level2 = self._get_level_approvers(selected_dept.parent, user, seen_ids)
            all_approvers.extend(level2)
        elif not level1:
            # Selected dept has no approvers and no parent, try siblings or tenant admin
            pass

        # If still no approvers after checking selected + parent, walk up chain
        if not all_approvers:
            current = selected_dept.parent
            while current:
                level = self._get_level_approvers(current, user, seen_ids)
                if level:
                    all_approvers.extend(level)
                    break
                current = current.parent

        # Level 3: Use configured approver_users if set, otherwise use final approval dept's manager/deputy
        if config and config.approver_users:
            cfg_users = CustomUser.objects.filter(id__in=config.approver_users, is_active=True)
            for u in cfg_users:
                if u.id not in seen_ids and u.id != user.id:
                    seen_ids.add(u.id)
                    all_approvers.append({
                        'type': 'user', 'id': u.id,
                        'label': f'{u.real_name or u.username}',
                        'user_position': u.position or '',
                    })
        else:
            final_dept = self._get_final_approval_dept(tenant, approval_type)
            if final_dept:
                level3 = self._get_level_approvers(final_dept, user, seen_ids)
                all_approvers.extend(level3)

        if not all_approvers:
            # Final attempt: try final approval dept directly
            if not config or not config.approver_users:
                final_dept = self._get_final_approval_dept(tenant, approval_type)
                if final_dept:
                    level3 = self._get_level_approvers(final_dept, user, seen_ids)
                    all_approvers.extend(level3)

        # Level 4: Threshold exceeded — check sub-tenant config first, then group config
        threshold_dept = None
        if config and config.threshold_enabled and config.threshold_value is not None:
            threshold_val = None
            if threshold_values:
                tv_field = config.threshold_field
                if tv_field in threshold_values:
                    threshold_val = threshold_values[tv_field]
            if threshold_val is not None:
                try:
                    threshold_val = float(threshold_val)
                except (ValueError, TypeError):
                    threshold_val = None
            if threshold_val is not None and threshold_val > config.threshold_value:
                threshold_dept = config.threshold_department
        # 如果子企业配置没有启用阈值，尝试集团默认配置
        if not threshold_dept and config and config.approver_users is not None:
            try:
                fallback_config = ApprovalDeptConfig.objects.get(
                    tenant=tenant if not tenant.parent else tenant.parent,
                    approval_type=approval_type,
                    sub_tenant__isnull=True
                )
                if fallback_config and fallback_config.threshold_enabled and fallback_config.threshold_value is not None:
                    threshold_val = None
                    if threshold_values:
                        tv_field = fallback_config.threshold_field
                        if tv_field in threshold_values:
                            threshold_val = threshold_values[tv_field]
                    if threshold_val is not None:
                        try:
                            threshold_val = float(threshold_val)
                        except (ValueError, TypeError):
                            threshold_val = None
                    if threshold_val is not None and threshold_val > fallback_config.threshold_value:
                        threshold_dept = fallback_config.threshold_department
            except ApprovalDeptConfig.DoesNotExist:
                pass
        if threshold_dept:
            level4 = self._get_level_approvers(threshold_dept, user, seen_ids)
            if level4:
                for l in level4:
                    l['_threshold_level'] = True
                all_approvers.extend(level4)

        # Level 5: 最终审批人（配置里指定，追加到审批链最后一级；子公司配置 > 集团默认配置）
        final_approver, final_source, final_source_label = self._resolve_final_approver(tenant, approval_type)
        if final_approver:
            if final_approver.id not in seen_ids and final_approver.id != user.id and final_approver.is_active:
                seen_ids.add(final_approver.id)
                all_approvers.append({
                    'type': 'user', 'id': final_approver.id,
                    'label': f'{final_approver.real_name or final_approver.username}',
                    'user_position': final_approver.position or '',
                    '_final_approver': True,
                    '_final_approver_source': final_source,
                    '_final_approver_source_label': final_source_label,
                })

        if not all_approvers:
            return self._fallback_approvers(user, tenant)

        return all_approvers

    def _check_user_can_approve(self, approval, user):
        """检查用户是否有权限审批当前节点（待审批/暂缓/办理中均可操作）"""
        if approval.approval_mode == 'sequential':
            nodes = approval.approval_nodes.filter(order=approval.current_node_order)
        else:
            nodes = approval.approval_nodes.all()
        return ApprovalAssignee.objects.filter(
            node__in=nodes, user=user, status__in=('pending', 'deferred', 'processing')
        ).exists()

    def _check_user_can_view(self, approval, user):
        """检查用户是否有权限查看审批（不限制审批状态）"""
        if approval.approval_mode == 'sequential':
            nodes = approval.approval_nodes.filter(order=approval.current_node_order)
        else:
            nodes = approval.approval_nodes.all()
        return ApprovalAssignee.objects.filter(
            node__in=nodes, user=user
        ).exists()

    def _process_node_approval(self, approval, node, action, user, comment, attachments=None, signature=''):
        """处理单个节点的审批（支持通过/驳回/暂缓/办理中，可附带手写签名）"""
        now = timezone.now()
        assignees = node.assignees.filter(user=user)
        if not assignees.exists():
            return False
        assignee = assignees.first()
        # 可操作状态：pending(待审批), deferred(暂缓), processing(办理中)
        if assignee.status not in ('pending', 'deferred', 'processing'):
            return False
        # 只有通过/驳回真正改变节点完成状态
        if action in ('approve', 'reject'):
            assignee.status = 'approved' if action == 'approve' else 'rejected'
        elif action == 'deferred':
            assignee.status = 'deferred'
        elif action == 'processing':
            assignee.status = 'processing'
        else:
            return False
        assignee.comment = comment or ''
        assignee.operated_at = now
        assignee.save()

        # 记录日志（附带手写签名）
        ApprovalLog.objects.create(
            request=approval, operator=user,
            action=action, comment=comment or '',
            attachments=attachments or [],
            signature=signature or '',
        )

        return True

    def _check_node_completed(self, node):
        """检查节点是否已完成审批"""
        total = node.assignees.count()
        approved = node.assignees.filter(status='approved').count()
        rejected = node.assignees.filter(status='rejected').count()

        # 如果没有审批人（如部门无管理员），自动跳过该节点
        if total == 0:
            return True, 'approved'

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

        if approval.status not in ('pending', 'deferred', 'processing'):
            return Response({'error': '该审批已处理'}, status=400)

        can_approve = self._check_user_can_approve(approval, request.user)
        if not can_approve:
            return Response({'error': '您不在当前审批节点中'}, status=403)

        serializer = ApprovalActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data.get('comment', '')
        attachments = serializer.validated_data.get('attachments', [])
        signature = serializer.validated_data.get('signature', '')

        with transaction.atomic():
            if approval.approval_mode == 'sequential':
                nodes = approval.approval_nodes.filter(order=approval.current_node_order)
            else:
                nodes = approval.approval_nodes.all()

            processed = False
            for node in nodes:
                if self._process_node_approval(approval, node, 'approve', request.user, comment, attachments, signature):
                    processed = True
                    break

            if not processed:
                return Response({'error': '您已审批过，无需重复操作'}, status=400)

            # 检查当前节点是否完成
            all_finished = True
            for node in nodes:
                completed, result = self._check_node_completed(node)
                if not completed:
                    all_finished = False
                if completed and approval.approval_mode == 'sequential':
                    # 顺序审批：进入下一节点
                    next_order = approval.current_node_order + 1
                    if approval.approval_nodes.filter(order=next_order).exists():
                        approval.current_node_order = next_order
                        approval.save()
                    break

            if all_finished:
                # 所有相关节点完成：调用收尾逻辑（通过/驳回/仍有未完成节点则保持待审批）
                finished = self._finalize_approval(approval)
                if not finished:
                    # 节点完成但整体审批未完成（如还有后续节点/并行未完成）→ 恢复待审批
                    if approval.status in ('deferred', 'processing'):
                        approval.status = 'pending'
                        approval.save(update_fields=['status'])
            else:
                # 当前节点通过但还有待审批的节点/审批人 → 恢复待审批
                if approval.status in ('deferred', 'processing'):
                    approval.status = 'pending'
                    approval.save(update_fields=['status'])

        # 通知申请人
        timestamp = timezone.now().strftime('%m-%d %H:%M')
        if approval.status == 'approved':
            send_work_notification(
                user_id=approval.applicant.id,
                title='审批已通过',
                content=f'您的{_approval_type_label(approval)}申请“{approval.title}”已通过 [{timestamp}]',
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

        if approval.status not in ('pending', 'deferred', 'processing'):
            return Response({'error': '该审批已处理'}, status=400)


        can_approve = self._check_user_can_approve(approval, request.user)
        if not can_approve:
            return Response({'error': '您不在当前审批节点中'}, status=403)

        serializer = ApprovalActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data.get('comment', '')
        attachments = serializer.validated_data.get('attachments', [])
        signature = serializer.validated_data.get('signature', '')

        with transaction.atomic():
            if approval.approval_mode == 'sequential':
                nodes = approval.approval_nodes.filter(order=approval.current_node_order)
            else:
                nodes = approval.approval_nodes.all()

            processed = False
            for node in nodes:
                if self._process_node_approval(approval, node, 'reject', request.user, comment, attachments, signature):
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
            content=f'您的{_approval_type_label(approval)}申请“{approval.title}”已被驳回 [{timestamp}]' + (f' 原因：{comment}' if comment else ''),
            notification_type='approval',
            related_url='/oa/approval/',
            extra_data={'approval_id': approval.id, 'action': 'rejected', 'comment': comment},
        )

        logger.info(f'{request.user} 驳回审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)})

    @action(detail=True, methods=['post'])
    def deferred(self, request, pk=None):
        """暂缓审批"""
        return self._handle_status_action(request, pk, 'deferred', '暂缓')

    @action(detail=True, methods=['post'])
    def processing(self, request, pk=None):
        """正在办理"""
        return self._handle_status_action(request, pk, 'processing', '办理中')

    def _handle_status_action(self, request, pk, action, action_label):
        """处理暂缓/办理中等中间状态操作"""
        try:
            approval = ApprovalRequest.objects.select_related('applicant').prefetch_related(
                'approval_nodes__assignees'
            ).get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)

        can_approve = self._check_user_can_approve(approval, request.user)
        if not can_approve:
            return Response({'error': '您不在当前审批节点中'}, status=403)

        serializer = ApprovalActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.validated_data.get('comment', '')
        attachments = serializer.validated_data.get('attachments', [])
        signature = serializer.validated_data.get('signature', '')

        with transaction.atomic():
            if approval.approval_mode == 'sequential':
                nodes = approval.approval_nodes.filter(order=approval.current_node_order)
            else:
                nodes = approval.approval_nodes.all()

            processed = False
            for node in nodes:
                if self._process_node_approval(approval, node, action, request.user, comment, attachments, signature):
                    processed = True
                    break

            if not processed:
                return Response({'error': '操作失败，当前状态不允许此操作'}, status=400)

            # 更新审批整体状态为暂缓/办理中
            if action in ('deferred', 'processing'):
                approval.status = action
                approval.save(update_fields=['status'])

        # 通知申请人
        timestamp = timezone.now().strftime('%m-%d %H:%M')
        status_info = {
            'deferred': '暂缓（审批人稍后会继续处理）',
            'processing': '正在办理中',
        }
        send_work_notification(
            user_id=approval.applicant.id,
            title=f'审批{action_label}',
            content=f'您的{_approval_type_label(approval)}申请“{approval.title}”已被审批人{action_label} [{timestamp}]' + (f' 意见：{comment}' if comment else ''),
            notification_type='approval',
            related_url='/oa/approval/',
            extra_data={'approval_id': approval.id, 'action': action, 'comment': comment},
        )

        logger.info(f'{request.user} {action_label}审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)})

    @action(detail=False, methods=['post'])
    def draft(self, request):
        """保存审批草稿"""
        serializer = ApprovalDraftSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        from accounts.models import Department
        department_id = serializer.validated_data.get('department_id')
        approval_type = serializer.validated_data.get('approval_type', 'other')
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        form_data = collect_form_data(serializer.validated_data,
                                      serializer.validated_data.get('form_data') or {},
                                      approval_type)
        department = None
        if department_id:
            try:
                department = Department.objects.get(id=department_id)
            except Department.DoesNotExist:
                department = request.user.department
        else:
            department = request.user.department
        approval = ApprovalRequest.objects.create(
            applicant=request.user,
            tenant=tenant,
            status='draft',
            department=department,
            approval_type=approval_type,
            title=serializer.validated_data.get('title', '未命名草稿'),
            content=serializer.validated_data.get('content', ''),
            start_date=serializer.validated_data.get('start_date'),
            end_date=serializer.validated_data.get('end_date'),
            duration=serializer.validated_data.get('duration'),
            amount=serializer.validated_data.get('amount'),
            expense_type=serializer.validated_data.get('expense_type', ''),
            expense_date=serializer.validated_data.get('expense_date'),
            attachments=serializer.validated_data.get('attachments', []),
            recruit_data=serializer.validated_data.get('recruit_data', {}),
            form_data=form_data,
            sign_type=serializer.validated_data.get('sign_type', 'countersign'),
            approval_mode=serializer.validated_data.get('approval_mode', 'sequential'),
        )
        # 保存审批人节点（草稿也保留配置）
        approver_nodes = serializer.validated_data.get('approver_nodes', [])
        if not approver_nodes:
            approver_nodes = self._auto_determine_approvers(
                request.user, tenant,
                approval_type=approval_type,
                department_id=serializer.validated_data.get('department_id'),
                threshold_values=self._gather_threshold_values(serializer.validated_data, form_data),
            )
        from accounts.models import CustomUser, Department
        # 创建发起人节点
        ApprovalNode.objects.create(
            request=approval, node_type='initiator',
            user=request.user, order=0,
        )
        for idx, node_data in enumerate(approver_nodes):
            node_type = node_data.get('type', 'user')
            node = ApprovalNode.objects.create(
                request=approval, node_type=node_type, order=idx + 1,
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
                    dept_admins = CustomUser.objects.filter(
                        department=dept,
                        user_type__in=['super_admin', 'admin']
                    ).exclude(id=request.user.id)
                    for au in dept_admins:
                        ApprovalAssignee.objects.create(node=node, user=au)
                except Department.DoesNotExist:
                    pass
        # 若配置了最终审批人，标记对应节点
        self._mark_final_approver_node(approval, request)
        # 草稿也保存抄送人
        cc_user_ids = serializer.validated_data.get('cc_users', [])
        cc_dept_ids = serializer.validated_data.get('cc_departments', [])
        self._create_cc_records(approval, request, cc_user_ids, cc_dept_ids)

        logger.info(f'{request.user} 保存审批草稿 {approval.id}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """撤销待审批的申请"""
        try:
            approval = ApprovalRequest.objects.get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)
        if approval.status != 'pending':
            return Response({'error': '仅待审批的申请可以撤销'}, status=400)
        if approval.applicant != request.user:
            return Response({'error': '只能撤销自己的申请'}, status=403)
        approval.status = 'cancelled'
        approval.save(update_fields=['status'])
        logger.info(f'{request.user} 撤销审批 {approval.title}')
        # 记录撤销日志
        ApprovalLog.objects.create(
            request=approval,
            operator=request.user,
            action='cancel',
            comment='已撤回审批申请',
        )
        # 通知审批人
        assignees = ApprovalAssignee.objects.filter(
            node__request=approval, status='pending'
        ).select_related('user')
        for asgn in assignees:
            send_work_notification(
                user_id=asgn.user.id,
                title='审批已撤销',
                content=f'{request.user.real_name or request.user.username} 撤销了审批申请“{approval.title}”',
                notification_type='approval',
                related_url='/oa/approval/',
                extra_data={'approval_id': approval.id, 'action': 'cancelled'},
            )
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)})

    @action(detail=True, methods=['post'])
    def re_edit(self, request, pk=None):
        """重新编辑已撤回或已驳回的审批"""
        try:
            approval = ApprovalRequest.objects.get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)
        if approval.status not in ('cancelled', 'rejected', 'draft'):
            return Response({'error': '仅草稿、已撤回或已驳回的审批可以重新编辑'}, status=400)
        if approval.applicant != request.user:
            return Response({'error': '只能编辑自己的审批'}, status=403)
        serializer = ApprovalDraftSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        # 更新字段
        from accounts.models import Department
        department_id = serializer.validated_data.get('department_id')
        if department_id:
            try:
                approval.department = Department.objects.get(id=department_id)
            except Department.DoesNotExist:
                pass
        for field in ['approval_type', 'title', 'content', 'start_date', 'end_date',
                      'duration', 'amount', 'expense_type', 'expense_date',
                      'sign_type', 'approval_mode']:
            val = serializer.validated_data.get(field)
            if val is not None:
                setattr(approval, field, val)
        if serializer.validated_data.get('attachments') is not None:
            approval.attachments = serializer.validated_data['attachments']
        if serializer.validated_data.get('recruit_data') is not None:
            approval.recruit_data = serializer.validated_data['recruit_data']
        form_data = collect_form_data(serializer.validated_data,
                                      serializer.validated_data.get('form_data') or {},
                                      approval.approval_type)
        approval.form_data = form_data
        approval.status = 'pending'
        approval.save()
        # 重建审批人节点（根据所选部门自动生成）
        approver_nodes = serializer.validated_data.get('approver_nodes', [])
        if not approver_nodes:
            approver_nodes = self._auto_determine_approvers(
                request.user, request.tenant or request.user.get_active_tenant(),
                approval_type=approval.approval_type,
                department_id=department_id or getattr(approval.department, 'id', None),
                threshold_values=self._gather_threshold_values(serializer.validated_data, form_data),
            )
        from oa.models import ApprovalAssignee
        ApprovalAssignee.objects.filter(node__request=approval).delete()
        approval.approval_nodes.all().delete()
        from accounts.models import CustomUser
        # 创建发起人节点
        ApprovalNode.objects.create(
            request=approval, node_type='initiator',
            user=request.user, order=0,
        )
        for idx, node_data in enumerate(approver_nodes):
            node_type = node_data.get('type', 'user')
            node = ApprovalNode.objects.create(
                request=approval, node_type=node_type, order=idx + 1,
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
                    dept_admins = CustomUser.objects.filter(
                        department=dept,
                        user_type__in=['super_admin', 'admin']
                    ).exclude(id=request.user.id)
                    for au in dept_admins:
                        ApprovalAssignee.objects.create(node=node, user=au)
                except Department.DoesNotExist:
                    pass
        # 若配置了最终审批人，标记对应节点
        self._mark_final_approver_node(approval, request)
        # 顺序审批重置到第一个节点
        if approval.approval_mode == 'sequential':
            approval.current_node_order = 1
            approval.save()

        # 记录重新提交的审批日志
        ApprovalLog.objects.create(
            request=approval,
            operator=request.user,
            action='resubmit',
            comment='重新提交审批申请',
        )

        # 通知审批人（顺序审批仅通知第一个节点）
        from accounts.models import CustomUser, Department
        assignee_qs = ApprovalAssignee.objects.filter(node__request=approval, status='pending')
        if approval.approval_mode == 'sequential':
            first_node = approval.approval_nodes.filter(order=1).first()
            assignee_qs = assignee_qs.filter(node=first_node) if first_node else assignee_qs.none()
        for asgn in assignee_qs.select_related('user'):
            send_work_notification(
                user_id=asgn.user.id,
                title='审批待处理',
                content=f'{request.user.real_name or request.user.username} 提交了{_approval_type_label(approval)}申请：“{approval.title}”',
                notification_type='approval',
                related_url='/oa/approval/',
                extra_data={'approval_id': approval.id, 'action': 'pending'},
            )

        # 更新抄送人
        approval.carbon_copies.all().delete()
        cc_user_ids = serializer.validated_data.get('cc_users', [])
        cc_dept_ids = serializer.validated_data.get('cc_departments', [])
        self._create_cc_records(approval, request, cc_user_ids, cc_dept_ids)

        logger.info(f'{request.user} 重新编辑审批 {approval.title}')
        data = ApprovalRequestSerializer(approval, context={'request': request}).data
        return Response({'encrypt': True, 'data': encrypt_data(data)})

    @action(detail=False, methods=['get'])
    def drafts(self, request):
        """获取当前用户的草稿列表"""
        qs = ApprovalRequest.objects.filter(applicant=request.user, status='draft').order_by('-created_at')
        results = ApprovalListSerializer(qs, many=True, context={'request': request}).data
        return Response({'results': results})

    @action(detail=True, methods=['delete'])
    def delete_draft(self, request, pk=None):
        """删除草稿"""
        try:
            approval = ApprovalRequest.objects.get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '审批不存在'}, status=404)
        if approval.status not in ('draft', 'cancelled'):
            return Response({'error': '仅草稿和已撤回的审批可以删除'}, status=400)
        if approval.applicant != request.user:
            return Response({'error': '只能删除自己的草稿'}, status=403)
        approval.delete()
        logger.info(f'{request.user} 删除草稿 {pk}')
        return Response({'message': 'ok'})

    @action(detail=True, methods=['post'])
    def update_draft(self, request, pk=None):
        """更新已有草稿（保持ID不变）"""
        try:
            approval = ApprovalRequest.objects.get(id=pk)
        except ApprovalRequest.DoesNotExist:
            return Response({'error': '草稿不存在'}, status=404)
        if approval.status not in ('draft', 'cancelled', 'rejected'):
            return Response({'error': '仅草稿、已撤回或已驳回的审批可以更新'}, status=400)
        if approval.applicant != request.user:
            return Response({'error': '只能更新自己的草稿'}, status=403)
        serializer = ApprovalDraftSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        from accounts.models import Department, CustomUser
        department_id = serializer.validated_data.get('department_id')
        if department_id:
            try:
                approval.department = Department.objects.get(id=department_id)
            except Department.DoesNotExist:
                pass
        else:
            approval.department = request.user.department
        for field in ['approval_type', 'title', 'content', 'start_date', 'end_date',
                      'duration', 'amount', 'expense_type', 'expense_date',
                      'sign_type', 'approval_mode']:
            val = serializer.validated_data.get(field)
            if val is not None:
                setattr(approval, field, val)
        if serializer.validated_data.get('recruit_data') is not None:
            approval.recruit_data = serializer.validated_data['recruit_data']
        if serializer.validated_data.get('attachments') is not None:
            approval.attachments = serializer.validated_data['attachments']
        form_data = collect_form_data(serializer.validated_data,
                                      serializer.validated_data.get('form_data') or {},
                                      approval.approval_type)
        approval.form_data = form_data
        # 重新编辑时保存为草稿
        if approval.status in ('cancelled', 'rejected'):
            approval.status = 'draft'
        approval.save()
        approver_nodes = serializer.validated_data.get('approver_nodes', [])
        if not approver_nodes:
            approver_nodes = self._auto_determine_approvers(
                request.user, request.tenant or request.user.get_active_tenant(),
                approval_type=approval.approval_type,
                department_id=department_id or getattr(approval.department, 'id', None),
                threshold_values=self._gather_threshold_values(serializer.validated_data, form_data),
            )
        from oa.models import ApprovalAssignee
        ApprovalAssignee.objects.filter(node__request=approval).delete()
        approval.approval_nodes.all().delete()
        # 创建发起人节点
        ApprovalNode.objects.create(
            request=approval, node_type='initiator',
            user=request.user, order=0,
        )
        for idx, node_data in enumerate(approver_nodes):
            node_type = node_data.get('type', 'user')
            node = ApprovalNode.objects.create(
                request=approval, node_type=node_type, order=idx + 1,
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
                    dept_admins = CustomUser.objects.filter(
                        department=dept,
                        user_type__in=['super_admin', 'admin']
                    ).exclude(id=request.user.id)
                    for au in dept_admins:
                        ApprovalAssignee.objects.create(node=node, user=au)
                except Department.DoesNotExist:
                    pass
        # 若配置了最终审批人，标记对应节点
        self._mark_final_approver_node(approval, request)
        # 顺序审批重置到第一个节点
        if approval.approval_mode == 'sequential':
            approval.current_node_order = 1
            approval.save()
        # 更新抄送人
        approval.carbon_copies.all().delete()
        cc_user_ids = serializer.validated_data.get('cc_users', [])
        cc_dept_ids = serializer.validated_data.get('cc_departments', [])
        self._create_cc_records(approval, request, cc_user_ids, cc_dept_ids)
        logger.info(f'{request.user} 更新草稿 {approval.id}')
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
    def org_departments(self, request):
        """获取组织架构部门（链式结构）。

        ?scope=all：返回当前用户所属的所有企业下的所有部门（供自定义类型"部门"字段选择）。
        默认：当前企业（集团管理员额外含子企业部门）。
        """
        from accounts.models import Department, Tenant
        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            tenant = request.user.get_active_tenant()
        user = request.user
        scope = request.query_params.get('scope', '')
        if scope == 'all':
            # 当前用户所属的所有企业（多企业隔离原则：只取用户所属企业的部门）
            tenant_ids = list(Tenant.objects.filter(
                memberships__user=user, memberships__is_active=True
            ).distinct().values_list('id', flat=True))
            if not tenant_ids and tenant:
                tenant_ids = [tenant.id]
        else:
            tenant_ids = [tenant.id] if tenant else []
            try:
                sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
                if user.user_type in ('super_admin', 'admin') and sub_ids:
                    tenant_ids.extend(sub_ids)
            except Exception:
                pass
        if not tenant_ids:
            return Response({'results': []})
        depts = Department.objects.filter(tenant_id__in=tenant_ids, is_active=True).values(
            'id', 'name', 'parent_id', 'full_path', 'tenant_id')
        dept_list = list(depts)
        # 多企业时用企业名作前缀，便于区分
        tenant_names = {}
        if len(tenant_ids) > 1:
            for t in Tenant.objects.filter(id__in=tenant_ids):
                tenant_names[t.id] = t.short_name or t.name
            for d in dept_list:
                tn = tenant_names.get(d['tenant_id'], '')
                if tn:
                    d['name'] = f'[{tn}] {d["name"]}'
                    d['_tenant_name'] = tn
        # 管理员可看全部，普通用户只看自己的部门
        if user.user_type not in ['super_admin', 'admin'] and dept_list:
            from org.models import UserDepartment
            user_dept_ids = list(UserDepartment.objects.filter(user=user).values_list('department_id', flat=True))
            if user_dept_ids:
                dept_list = [d for d in dept_list if d['id'] in user_dept_ids]
        return Response({'results': dept_list})

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
        if file.size > 500 * 1024 * 1024:
            return Response({'error': '文件大小不能超过500MB'}, status=400)
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
    def approval_chain(self, request):
        """获取当前用户的审批链预览（根据所选部门和审批类型动态生成）"""


        department_id = request.query_params.get('department_id', '').strip()
        approval_type = request.query_params.get('approval_type', '').strip()
        if department_id:
            try:
                department_id = int(department_id)
            except ValueError:
                department_id = None

        # Read threshold values from query params for preview
        threshold_values = {}
        for key in ('duration', 'amount', 'headcount'):
            val = request.query_params.get(key, '').strip()
            if val:
                try:
                    threshold_values[key] = float(val)
                except ValueError:
                    pass
        # 自定义类型：接收 form_data JSON，收集数字字段用于阈值预览
        fd_raw = request.query_params.get('form_data', '')
        if fd_raw:
            try:
                import json as _json
                fd = _json.loads(fd_raw)
                if isinstance(fd, dict):
                    for k, v in fd.items():
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            threshold_values[str(k)] = float(v)
            except Exception:
                pass

        chain = self._auto_determine_approvers(
            request.user, request.user.get_active_tenant(),
            approval_type=approval_type or None,
            department_id=department_id,
            threshold_values=threshold_values if threshold_values else None,
        )

        # 添加级别标记用于前端展示
        from accounts.models import Department
        result = []
        level = 1
        dept_map = {}
        if department_id:
            try:
                sel_dept = Department.objects.get(id=department_id)
                dept_map['selected'] = sel_dept.name
                if sel_dept.parent:
                    dept_map['parent'] = sel_dept.parent.name
            except Department.DoesNotExist:
                pass
        tenant = request.tenant or request.user.get_active_tenant()
        final_dept = self._get_final_approval_dept(tenant, approval_type or None)
        if final_dept:
            dept_map['final'] = final_dept.name

        # 阈值审批部门信息（支持集团回溯）
        if approval_type:
            config = self._get_config_for_tenant(tenant, approval_type)
            if config and config.threshold_enabled and config.threshold_department:
                dept_map['threshold'] = config.threshold_department.name
                dept_map['threshold_field'] = _threshold_field_label(config)
                dept_map['threshold_value'] = config.threshold_value
            # 是否要求手写签名
            dept_map['require_signature'] = bool(config and config.require_signature)

        # 集团企业信息
        if tenant and tenant.parent:
            dept_map['group_tenant'] = tenant.parent.name
            dept_map['group_tenant_id'] = tenant.parent.id

        for item in chain:
            is_threshold = item.pop('_threshold_level', False)
            is_final_approver = item.pop('_final_approver', False)
            final_source = item.pop('_final_approver_source', '')
            final_source_label = item.pop('_final_approver_source_label', '')
            if is_final_approver:
                level_label = '最终审批人'
            elif is_threshold:
                level_label = '阈值审批'
            else:
                level_label = f'第{level}级'
            result.append({
                **item,
                'level': level,
                'level_label': level_label,
                'is_final_approver': is_final_approver,
                'final_approver_source': final_source,
                'final_approver_source_label': final_source_label,
            })
            level += 1
        # 添加部门信息
        return Response({'results': result, 'count': len(result), 'departments': dept_map})

    @action(detail=False, methods=['get'])
    def dept_configs(self, request):
        """获取当前企业的最终审批部门配置列表（集团可查看子企业配置及子公司列表）"""
        from .serializers import ApprovalDeptConfigSerializer
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        if not tenant:
            return Response({'results': []})
        # 集团企业：查看当前企业+子企业配置
        query = Q(tenant=tenant)
        try:
            sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
            if sub_ids:
                query |= Q(tenant_id__in=sub_ids)
        except Exception:
            pass
        configs = ApprovalDeptConfig.objects.filter(query).select_related('department', 'sub_tenant')
        data = ApprovalDeptConfigSerializer(configs, many=True).data
        # 附加子企业列表，方便集团配置选择
        extra = {}
        try:
            sub_tenants = tenant.sub_tenants.filter(is_active=True).values('id', 'name', 'short_name', 'tenant_type')
            extra['sub_tenants'] = list(sub_tenants)
        except Exception:
            extra['sub_tenants'] = []
        return Response({'results': data, **extra})

    @action(detail=False, methods=['post'])
    def save_dept_config(self, request):
        """保存审批类型配置（企业超管/管理员用）"""
        user_type = request.user.user_type
        if user_type not in ('super_admin', 'admin'):
            return Response({'error': '仅企业超级管理员或管理员可操作'}, status=403)
        approval_type = request.data.get('approval_type', '').strip()
        if not approval_type:
            return Response({'error': '缺少审批类型参数'}, status=400)
        department_id = request.data.get('department_id')
        cc_departments = request.data.get('cc_departments', [])
        cc_users = request.data.get('cc_users', [])
        approver_users = request.data.get('approver_users', [])
        from accounts.models import Department, CustomUser, Tenant
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        if not tenant:
            return Response({'error': '未找到所属企业'}, status=400)
        # 配置归属企业：子企业配置统一存放到集团（与 _get_config_for_tenant 的 config_tenant 逻辑一致）
        config_tenant = tenant.parent if tenant.parent else tenant

        # 验证部门存在且属于该企业
        dept = None
        if department_id:
            try:
                dept = Department.objects.get(id=department_id, tenant=tenant)
            except Department.DoesNotExist:
                return Response({'error': '最终审批部门不存在'}, status=400)

        # 验证抄送部门、抄送人、审批人都是当前企业成员
        if cc_departments:
            valid_depts = Department.objects.filter(id__in=cc_departments, tenant=tenant)
            cc_departments = list(valid_depts.values_list('id', flat=True))
        if cc_users:
            valid_users = CustomUser.objects.filter(
                id__in=cc_users, tenant_memberships__tenant=tenant,
                tenant_memberships__is_active=True
            ).distinct()
            cc_users = list(valid_users.values_list('id', flat=True))
        if approver_users:
            valid_approvers = CustomUser.objects.filter(
                id__in=approver_users, tenant_memberships__tenant=tenant,
                tenant_memberships__is_active=True
            ).distinct()
            approver_users = list(valid_approvers.values_list('id', flat=True))

        # 最终审批人（可选，允许置空；必须是当前企业成员）
        final_approver_id = request.data.get('final_approver')
        final_approver_obj = None
        if final_approver_id:
            final_approver_obj = CustomUser.objects.filter(
                id=final_approver_id, is_active=True,
                tenant_memberships__tenant=tenant,
                tenant_memberships__is_active=True
            ).first()
            if not final_approver_obj:
                return Response({'error': '最终审批人必须是当前企业成员'}, status=400)

        # Sub-tenant config (集团模式下为子公司配置，存放到集团 config_tenant 下)
        sub_tenant_id = request.data.get('sub_tenant_id')
        sub_tenant_obj = None
        if sub_tenant_id:
            try:
                sub_tenant_obj = Tenant.objects.get(id=int(sub_tenant_id))
                if sub_tenant_obj.parent_id != config_tenant.id:
                    return Response({'error': '指定的子公司不属于当前企业集团'}, status=400)
            except (ValueError, Tenant.DoesNotExist):
                return Response({'error': '子公司不存在'}, status=400)

        # Threshold fields
        threshold_enabled = request.data.get('threshold_enabled', False)
        threshold_field = request.data.get('threshold_field', '')
        threshold_value = request.data.get('threshold_value')
        threshold_department_id = request.data.get('threshold_department_id')
        threshold_dept = None
        if threshold_department_id:
            try:
                threshold_dept = Department.objects.get(id=threshold_department_id, tenant=tenant)
            except Department.DoesNotExist:
                pass

        defaults = {}
        if dept:
            defaults['department'] = dept
        else:
            defaults['department'] = None
        defaults['cc_departments'] = cc_departments
        defaults['cc_users'] = cc_users
        defaults['approver_users'] = approver_users
        defaults['final_approver'] = final_approver_obj
        sign_type = request.data.get('sign_type', '').strip()
        if sign_type in ('countersign', 'orsign'):
            defaults['default_sign_type'] = sign_type
        approval_mode = request.data.get('approval_mode', '').strip()
        if approval_mode in ('sequential', 'parallel'):
            defaults['default_approval_mode'] = approval_mode
        defaults['threshold_enabled'] = bool(threshold_enabled)
        defaults['threshold_field'] = threshold_field
        if threshold_value is not None:
            try:
                defaults['threshold_value'] = float(threshold_value)
            except (ValueError, TypeError):
                pass
        if threshold_dept:
            defaults['threshold_department'] = threshold_dept
        else:
            defaults['threshold_department'] = None
        # 手写签名开关
        if 'require_signature' in request.data:
            defaults['require_signature'] = bool(request.data.get('require_signature'))

        try:
            config, created = ApprovalDeptConfig.objects.update_or_create(
                tenant=config_tenant,
                approval_type=approval_type,
                sub_tenant=sub_tenant_obj,
                defaults=defaults,
            )
        except Exception as e:
            logger.error(f'保存审批配置失败: {e}')
            return Response({'error': f'保存配置失败: {str(e)}'}, status=400)

        from .serializers import ApprovalDeptConfigSerializer
        data = ApprovalDeptConfigSerializer(config).data
        return Response({'encrypt': True, 'data': encrypt_data(data)}, status=201 if created else 200)

    @action(detail=True, methods=['delete'])
    def delete_dept_config(self, request, pk=None):
        """删除最终审批部门配置"""
        if request.user.user_type != 'super_admin':
            return Response({'error': '仅超级管理员可操作'}, status=403)
        try:
            config = ApprovalDeptConfig.objects.get(id=pk)
            config.delete()
            return Response({'message': 'ok'})
        except ApprovalDeptConfig.DoesNotExist:
            return Response({'error': '配置不存在'}, status=404)

    @action(detail=False, methods=['get'])
    def search_cc_users(self, request):
        """搜索可抄送的用户（当前企业成员）"""
        from accounts.models import CustomUser
        from django.db.models import Q
        keyword = request.query_params.get('search', '').strip()
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        qs = CustomUser.objects.filter(is_active=True).exclude(id=request.user.id)
        if tenant:
            qs = qs.filter(tenant_memberships__tenant=tenant, tenant_memberships__is_active=True)
        if keyword:
            qs = qs.filter(
                Q(real_name__icontains=keyword) | Q(username__icontains=keyword)
            )
        qs = qs.distinct()[:20]
        results = [{
            'id': u.id,
            'name': u.real_name or u.username,
            'avatar': u.get_avatar_url() if hasattr(u, 'get_avatar_url') else '',
            'position': u.position or '',
        } for u in qs]
        return Response({'results': results})

    @action(detail=False, methods=['get'])
    def search_cc_departments(self, request):
        """搜索可抄送的部门（当前企业部门）"""
        from accounts.models import Department
        from django.db.models import Q
        keyword = request.query_params.get('search', '').strip()
        tenant = getattr(request, 'tenant', None) or request.user.get_active_tenant()
        qs = Department.objects.filter(tenant=tenant, is_active=True)
        if keyword:
            qs = qs.filter(name__icontains=keyword)
        qs = qs.order_by('name')[:20]
        results = [{
            'id': d.id,
            'name': d.name,
            'manager_name': d.manager.real_name or d.manager.username if d.manager else '',
        } for d in qs]
        return Response({'results': results})

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
        read_filter = request.query_params.get('read_filter', '').strip()
        qs = WorkNotification.objects.filter(recipient=request.user)
        if read_filter == 'unread':
            qs = qs.filter(is_read=False)
        elif read_filter == 'read':
            qs = qs.filter(is_read=True)
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
