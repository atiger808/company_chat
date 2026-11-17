# -*- coding: utf-8 -*-
"""工作日历 · 审批/任务超时提醒配置与定时发送。

配置存放在 SystemConfig（按企业分键），无需新增数据表/迁移。
"""
import json
from datetime import datetime, time, timedelta

from django.utils import timezone
from loguru import logger

from utils.utils import SystemConfigManager

KEY_PREFIX = 'workcalendar.timeout_reminder.'

DEFAULT_TIMEOUT_CONFIG = {
    'approval_enabled': False,
    'approval_hours': 24,
    'task_enabled': False,
    'task_hours': 24,
    'window_start': '09:00',
    'window_end': '18:00',
    'interval_hours': 4,
    'waterfall_enabled': False,
    'last_sent_at': '',
}

BOOL_FIELDS = ('approval_enabled', 'task_enabled', 'waterfall_enabled')
HOUR_FIELDS = {'approval_hours': 720, 'task_hours': 720, 'interval_hours': 24}


def _key(tenant_id):
    return f'{KEY_PREFIX}{tenant_id}'


def _parse_hhmm(value, fallback):
    try:
        parts = str(value).split(':')
        return time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError, TypeError):
        return _parse_hhmm(fallback, '00:00') if fallback != '00:00' else time(0, 0)


def get_timeout_config(tenant):
    """读取企业的超时提醒/瀑布流配置（未配置时返回默认值）。"""
    cfg = dict(DEFAULT_TIMEOUT_CONFIG)
    if not tenant:
        return cfg
    raw = SystemConfigManager.get_config(_key(tenant.id), None)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    data = raw if isinstance(raw, dict) else {}
    for key in DEFAULT_TIMEOUT_CONFIG:
        if key in data:
            cfg[key] = data[key]
    for key in HOUR_FIELDS:
        try:
            cfg[key] = max(1, min(HOUR_FIELDS[key], int(cfg[key])))
        except (TypeError, ValueError):
            cfg[key] = DEFAULT_TIMEOUT_CONFIG[key]
    for key in BOOL_FIELDS:
        cfg[key] = bool(cfg[key])
    return cfg


def save_timeout_config(tenant, payload, user=None):
    """保存配置（保留 last_sent_at 等运行状态）。"""
    cfg = get_timeout_config(tenant)
    payload = payload if isinstance(payload, dict) else {}
    for key in BOOL_FIELDS:
        if key in payload:
            cfg[key] = bool(payload[key])
    for key in HOUR_FIELDS:
        if key in payload:
            try:
                cfg[key] = max(1, min(HOUR_FIELDS[key], int(payload[key])))
            except (TypeError, ValueError):
                pass
    for key in ('window_start', 'window_end'):
        if key in payload:
            cfg[key] = _parse_hhmm(payload[key], DEFAULT_TIMEOUT_CONFIG[key]).strftime('%H:%M')
    if tenant:
        SystemConfigManager.set_config(
            _key(tenant.id), json.dumps(cfg, ensure_ascii=False), user=user)
    return cfg


def is_waterfall_enabled(tenant):
    return bool(get_timeout_config(tenant).get('waterfall_enabled'))


def _in_window(cfg, now_time):
    start = _parse_hhmm(cfg.get('window_start'), '09:00')
    end = _parse_hhmm(cfg.get('window_end'), '18:00')
    if start <= end:
        return start <= now_time <= end
    # 跨午夜：20:00 ~ 08:00
    return now_time >= start or now_time <= end


def _parse_last_sent(cfg):
    raw = cfg.get('last_sent_at') or ''
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw))
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt
    except Exception:
        return None


def _persist(tenant, cfg):
    if not tenant:
        return
    SystemConfigManager.set_config(_key(tenant.id), json.dumps(cfg, ensure_ascii=False))


def _collect_approval_overdue(tenant, hours):
    """审批人待处理且到达超过阈值：{user_id: {'user': u, 'titles': [...]}}"""
    from django.db.models import F, Q
    from .models import ApprovalAssignee

    cutoff = timezone.now() - timedelta(hours=hours)
    qs = (ApprovalAssignee.objects
          .filter(status='pending',
                  node__request__status='pending',
                  node__request__tenant=tenant,
                  user__is_active=True,
                  created_at__lte=cutoff)
          .filter(Q(node__request__approval_mode='parallel') |
                  Q(node__order=F('node__request__current_node_order')))
          .select_related('user', 'node__request'))
    grouped = {}
    for assignee in qs:
        user = assignee.user
        item = grouped.setdefault(user.id, {'user': user, 'titles': [], 'count': 0})
        item['count'] += 1
        if len(item['titles']) < 3:
            item['titles'].append(assignee.node.request.title or ('审批#' + str(assignee.node.request.id)))
    return grouped


def _stage_reached_at(stage, wo_stages):
    if stage.started_at:
        return stage.started_at
    prev_done = [s.completed_at for s in wo_stages
                 if s.order < stage.order and s.completed_at]
    if prev_done:
        return max(prev_done)
    return stage.work_order.created_at


def _collect_task_overdue(tenant, hours):
    """任务/群工单执行人超时未处理：{user_id: {'user': u, 'task_count': n, 'wo_count': m, 'titles': []}}"""
    from django.db.models import F
    from tasks.models import Task, WorkOrderStage

    cutoff = timezone.now() - timedelta(hours=hours)
    grouped = {}

    tasks = (Task.objects
             .filter(assignee__isnull=False, assignee__is_active=True,
                     status__in=['todo', 'in_progress'], tenant=tenant,
                     created_at__lte=cutoff)
             .select_related('assignee'))
    for task in tasks:
        item = grouped.setdefault(task.assignee_id, {
            'user': task.assignee, 'task_count': 0, 'wo_count': 0, 'titles': []})
        item['task_count'] += 1
        if len(item['titles']) < 3:
            item['titles'].append('任务：' + (task.title or ('#' + str(task.id))))

    stages = (WorkOrderStage.objects
              .filter(assignee__isnull=False, assignee__is_active=True,
                      status__in=['pending', 'processing'],
                      work_order__status__in=['pending', 'processing'],
                      work_order__tenant=tenant,
                      work_order__current_stage_order=F('order'))
              .select_related('assignee', 'work_order')
              .prefetch_related('work_order__stages'))
    for stage in stages:
        reached = _stage_reached_at(stage, list(stage.work_order.stages.all()))
        if reached > cutoff:
            continue
        item = grouped.setdefault(stage.assignee_id, {
            'user': stage.assignee, 'task_count': 0, 'wo_count': 0, 'titles': []})
        item['wo_count'] += 1
        if len(item['titles']) < 3:
            item['titles'].append(
                '群工单：' + (stage.work_order.order_no or '') + ' ' +
                (stage.work_order.title or '') + '（' + (stage.name or '') + '）')
    return grouped


def _send_for_tenant(tenant, cfg):
    from .views import send_work_notification

    sent = 0
    if cfg.get('approval_enabled'):
        hours = cfg.get('approval_hours', 24)
        for user_id, item in _collect_approval_overdue(tenant, hours).items():
            user = item['user']
            name = getattr(user, 'real_name', '') or getattr(user, 'username', '') or ''
            titles = '；'.join(item['titles'])
            content = (f'{name}，您有 {item["count"]} 个审批已超过 {hours} 小时未处理'
                       + (f'：{titles}' if titles else '') + '。请及时处理。')
            send_work_notification(
                user_id=user_id, title='审批超时提醒', content=content,
                notification_type='approval', related_url='/oa/approval/',
                extra_data={'timeout_reminder': True, 'count': item['count'], 'threshold_hours': hours},
                tenant=tenant)
            sent += 1

    if cfg.get('task_enabled'):
        hours = cfg.get('task_hours', 24)
        for user_id, item in _collect_task_overdue(tenant, hours).items():
            user = item['user']
            name = getattr(user, 'real_name', '') or getattr(user, 'username', '') or ''
            parts = []
            if item['task_count']:
                parts.append(f'{item["task_count"]} 个任务')
            if item['wo_count']:
                parts.append(f'{item["wo_count"]} 个群工单环节')
            titles = '；'.join(item['titles'])
            content = (f'{name}，您有 ' + '、'.join(parts) + f' 已超过 {hours} 小时未处理'
                       + (f'：{titles}' if titles else '') + '。请及时处理。')
            send_work_notification(
                user_id=user_id, title='任务/群工单超时提醒', content=content,
                notification_type='task', related_url='/tasks/',
                extra_data={'timeout_reminder': True, 'task_count': item['task_count'],
                            'work_order_count': item['wo_count'], 'threshold_hours': hours},
                tenant=tenant)
            sent += 1
    return sent


def send_timeout_reminders():
    """定时任务入口：按各企业配置发送审批/任务超时提醒。"""
    from accounts.models import Tenant
    from chat.models import SystemConfig

    now = timezone.localtime()
    now_time = now.time()
    total = 0
    tenant_ids = []
    for key in SystemConfig.objects.filter(key__startswith=KEY_PREFIX).values_list('key', flat=True):
        suffix = key[len(KEY_PREFIX):]
        if suffix.isdigit():
            tenant_ids.append(int(suffix))

    for tenant in Tenant.objects.filter(id__in=tenant_ids, is_active=True):
        cfg = get_timeout_config(tenant)
        if not (cfg['approval_enabled'] or cfg['task_enabled']):
            continue
        if not _in_window(cfg, now_time):
            continue
        last = _parse_last_sent(cfg)
        if last and now < last + timedelta(hours=cfg['interval_hours']):
            continue
        try:
            total += _send_for_tenant(tenant, cfg)
        except Exception as e:
            logger.warning(f'企业 {tenant.id} 超时提醒发送失败: {e}')
        cfg['last_sent_at'] = now.isoformat()
        _persist(tenant, cfg)

    if total:
        logger.info(f'超时提醒发送完成，共 {total} 条')
    return total
