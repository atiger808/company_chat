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

# 瀑布流展示页面：与智能体设置保持同一套页面清单，仅勾选页面展示
WATERFALL_PAGE_OPTIONS = [
    {'key': 'chat', 'label': '企业聊天室'},
    {'key': 'admin', 'label': '管理控制台'},
    {'key': 'cloud', 'label': '企业网盘'},
    {'key': 'cloud_settings', 'label': '网盘系统配置'},
    {'key': 'cloud_editor', 'label': '文档编辑器'},
    {'key': 'oa_approval', 'label': 'OA 审批'},
    {'key': 'oa_subsidy', 'label': '普惠补贴'},
    {'key': 'oa_subsidy_verify', 'label': '财务核验'},
    {'key': 'oa_subsidy_pay', 'label': '财务支付'},
    {'key': 'oa_attendance', 'label': '考勤打卡'},
    {'key': 'oa_announcements', 'label': '集团公告'},
    {'key': 'work_calendar', 'label': '工作日历'},
    {'key': 'work_summary', 'label': '每日工作总结'},
    {'key': 'tasks', 'label': '任务中心'},
    {'key': 'org', 'label': '组织架构'},
    {'key': 'knowledge', 'label': '企业知识库'},
    {'key': 'other', 'label': '其他页面'},
]
WATERFALL_PAGE_KEYS = [item['key'] for item in WATERFALL_PAGE_OPTIONS]
WATERFALL_DEFAULT_PAGES = {
    key: key in {'chat', 'tasks', 'oa_approval', 'work_calendar'}
    for key in WATERFALL_PAGE_KEYS
}

# 瀑布流待办类型：仅开启的类型会出现在「待办工作」区
TODO_TYPE_OPTIONS = [
    {'key': 'approval', 'label': '待处理审批'},
    {'key': 'task', 'label': '待处理任务 / 群工单'},
    {'key': 'subsidy_apply', 'label': '待核验发票'},
    {'key': 'subsidy_withdraw', 'label': '待支付提现'},
]
TODO_TYPE_KEYS = [item['key'] for item in TODO_TYPE_OPTIONS]
TODO_TYPE_DEFAULTS = {
    'approval': True,
    'task': True,
    'subsidy_apply': False,
    'subsidy_withdraw': False,
}

DEFAULT_TIMEOUT_CONFIG = {
    'approval_enabled': False,
    'approval_hours': 24,
    'task_enabled': False,
    'task_hours': 24,
    'invoice_enabled': False,
    'invoice_hours': 24,
    'withdraw_enabled': False,
    'withdraw_hours': 24,
    'window_start': '09:00',
    'window_end': '18:00',
    'interval_hours': 4,
    'waterfall_enabled': False,
    # 瀑布流展示页面（总开关 waterfall_enabled 打开后，仅下列页面展示）
    'waterfall_pages': dict(WATERFALL_DEFAULT_PAGES),
    # 瀑布流「待办工作」类型开关
    'todo_types': dict(TODO_TYPE_DEFAULTS),
    'last_sent_at': '',
}

BOOL_FIELDS = ('approval_enabled', 'task_enabled', 'invoice_enabled',
               'withdraw_enabled', 'waterfall_enabled')
HOUR_FIELDS = {'approval_hours': 720, 'task_hours': 720,
               'invoice_hours': 720, 'withdraw_hours': 720,
               'interval_hours': 24}


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
    pages = cfg.get('waterfall_pages')
    if not isinstance(pages, dict):
        pages = {}
    # 兼容旧配置：原页面键 approval 迁移为 oa_approval
    if 'approval' in pages and 'oa_approval' not in pages:
        pages['oa_approval'] = pages['approval']
    cfg['waterfall_pages'] = {
        key: bool(pages.get(key, WATERFALL_DEFAULT_PAGES[key]))
        for key in WATERFALL_PAGE_KEYS
    }
    todo_types = cfg.get('todo_types')
    if not isinstance(todo_types, dict):
        todo_types = {}
    cfg['todo_types'] = {
        key: bool(todo_types.get(key, TODO_TYPE_DEFAULTS[key]))
        for key in TODO_TYPE_KEYS
    }
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
    if isinstance(payload.get('waterfall_pages'), dict):
        pages = cfg.get('waterfall_pages') or {}
        for key in WATERFALL_PAGE_KEYS:
            if key in payload['waterfall_pages']:
                pages[key] = bool(payload['waterfall_pages'][key])
        cfg['waterfall_pages'] = pages
    if isinstance(payload.get('todo_types'), dict):
        todo_types = cfg.get('todo_types') or {}
        for key in TODO_TYPE_KEYS:
            if key in payload['todo_types']:
                todo_types[key] = bool(payload['todo_types'][key])
        cfg['todo_types'] = todo_types
    if tenant:
        SystemConfigManager.set_config(
            _key(tenant.id), json.dumps(cfg, ensure_ascii=False), user=user)
    return cfg


def is_waterfall_enabled(tenant):
    return bool(get_timeout_config(tenant).get('waterfall_enabled'))


def get_waterfall_config(tenant):
    """瀑布流展示配置：总开关 + 页面开关 + 待办类型开关（管理控制台/前端共用）。"""
    cfg = get_timeout_config(tenant)
    return {
        'enabled': bool(cfg.get('waterfall_enabled')),
        'pages': {key: bool(cfg['waterfall_pages'].get(key)) for key in WATERFALL_PAGE_KEYS},
        'options': WATERFALL_PAGE_OPTIONS,
        'todo_types': {key: bool(cfg['todo_types'].get(key)) for key in TODO_TYPE_KEYS},
        'todo_options': TODO_TYPE_OPTIONS,
    }


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


def _recently_sent(user_id, title, notification_type, minutes=10):
    """同一接收人短时间内是否已发送相同标题的提醒（防止重复任务并发导致双发）。"""
    from .models import WorkNotification
    return WorkNotification.objects.filter(
        recipient_id=user_id,
        notification_type=notification_type,
        title=title,
        created_at__gte=timezone.now() - timedelta(minutes=minutes),
    ).exists()


def _fmt_overdue(delta):
    """把超时时长格式化为「2天3小时 / 5小时 / 30分钟」。"""
    try:
        minutes = max(0, int(delta.total_seconds() // 60))
    except Exception:
        return ''
    days, rem = divmod(minutes, 1440)
    hours, mins = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f'{days}天')
    if hours:
        parts.append(f'{hours}小时')
    if not days and not hours:
        parts.append(f'{mins}分钟' if mins else '不到1分钟')
    return ''.join(parts)


def _collect_approval_overdue(tenant, hours):
    """审批人待处理且到达超过阈值：{user_id: {'user': u, 'titles': [...]}}"""
    from django.db.models import F, Q
    from .models import ApprovalAssignee

    now = timezone.now()
    cutoff = now - timedelta(hours=hours)
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
            title = assignee.node.request.title or ('审批#' + str(assignee.node.request.id))
            overdue = _fmt_overdue(now - assignee.created_at) if assignee.created_at else ''
            item['titles'].append(title + (f'（已超时 {overdue}）' if overdue else ''))
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

    now = timezone.now()
    cutoff = now - timedelta(hours=hours)
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
            overdue = _fmt_overdue(now - task.created_at) if task.created_at else ''
            item['titles'].append('任务：' + (task.title or ('#' + str(task.id)))
                                  + (f'（已超时 {overdue}）' if overdue else ''))

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
            overdue = _fmt_overdue(now - reached) if reached else ''
            item['titles'].append(
                '群工单：' + (stage.work_order.order_no or '') + ' ' +
                (stage.work_order.title or '') + '（' + (stage.name or '') + '）'
                + (f'（已超时 {overdue}）' if overdue else ''))
    return grouped


def _tenant_scope_ids(tenant):
    ids = [tenant.id]
    try:
        ids.extend(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
    except Exception:
        pass
    return ids


def _subsidy_staff_users(tenant, field):
    """配置的财务核验/支付人员 + 企业超级管理员；field 为 verifiers / payment_staff。"""
    from django.db.models import Q
    from accounts.models import CustomUser
    from .models import SubsidyConfig

    ids = _tenant_scope_ids(tenant)
    users = {}
    try:
        configs = SubsidyConfig.objects.filter(
            Q(tenant_id__in=ids) | Q(sub_tenant_id__in=ids)
        ).prefetch_related(field)
        for cfg in configs:
            for u in getattr(cfg, field).all():
                if getattr(u, 'is_active', True):
                    users[u.id] = u
    except Exception as e:
        logger.warning(f'读取补贴人员配置失败({field}): {e}')
    try:
        supers = (CustomUser.objects
                  .filter(user_type='super_admin', is_active=True,
                          tenant_memberships__tenant_id__in=ids,
                          tenant_memberships__is_active=True)
                  .distinct())
        for u in supers:
            users[u.id] = u
    except Exception:
        pass
    return list(users.values())


def _user_display(user):
    return getattr(user, 'real_name', '') or getattr(user, 'username', '') or ''


def _send_invoice_reminders(tenant, hours):
    """待核验发票超时：提醒配置的财务核验人员。"""
    from .models import SubsidyApplication
    from .views import send_work_notification

    now = timezone.now()
    cutoff = now - timedelta(hours=hours)
    apps = list(SubsidyApplication.objects.filter(
        status='pending', tenant_id__in=_tenant_scope_ids(tenant),
        created_at__lte=cutoff, applicant__is_active=True,
    ).select_related('applicant').order_by('created_at'))
    if not apps:
        return 0
    recipients = _subsidy_staff_users(tenant, 'verifiers')
    if not recipients:
        return 0
    titles = []
    for app in apps[:3]:
        overdue = _fmt_overdue(now - app.created_at) if app.created_at else ''
        titles.append(
            f'{app.application_no or ("申领#" + str(app.id))}'
            f'（{_user_display(app.applicant)}，¥{app.invoice_amount}'
            + (f'，已超时 {overdue}' if overdue else '') + '）')
    content = (f'您有 {len(apps)} 张补贴发票待核验，已超过 {hours} 小时未处理'
               + (f'：{"；".join(titles)}' if titles else '') + '。请及时核验。')
    sent = 0
    for user in recipients:
        if _recently_sent(user.id, '补贴核验超时提醒', 'subsidy_apply'):
            continue
        send_work_notification(
            user_id=user.id, title='补贴核验超时提醒', content=content,
            notification_type='subsidy_apply',
            related_url=f'/oa/subsidy-verify/?application_id={apps[0].id}',
            extra_data={'timeout_reminder': True, 'kind': 'invoice',
                        'count': len(apps), 'threshold_hours': hours,
                        'application_id': apps[0].id},
            tenant=tenant)
        sent += 1
    return sent


def _send_withdraw_reminders(tenant, hours):
    """待支付提现超时：提醒配置的财务支付人员。"""
    from .models import SubsidyWithdrawal
    from .views import send_work_notification

    now = timezone.now()
    cutoff = now - timedelta(hours=hours)
    rows = list(SubsidyWithdrawal.objects.filter(
        status='pending', tenant_id__in=_tenant_scope_ids(tenant),
        requested_at__lte=cutoff, user__is_active=True,
    ).select_related('user').order_by('requested_at'))
    if not rows:
        return 0
    recipients = _subsidy_staff_users(tenant, 'payment_staff')
    if not recipients:
        return 0
    titles = []
    for wd in rows[:3]:
        overdue = _fmt_overdue(now - wd.requested_at) if wd.requested_at else ''
        titles.append(
            f'{_user_display(wd.user)} ¥{wd.amount}'
            + (f'（已超时 {overdue}）' if overdue else ''))
    content = (f'您有 {len(rows)} 笔提现待支付，已超过 {hours} 小时未处理'
               + (f'：{"；".join(titles)}' if titles else '') + '。请及时支付。')
    sent = 0
    for user in recipients:
        if _recently_sent(user.id, '提现支付超时提醒', 'subsidy_withdraw'):
            continue
        send_work_notification(
            user_id=user.id, title='提现支付超时提醒', content=content,
            notification_type='subsidy_withdraw',
            related_url=f'/oa/subsidy-pay/?withdrawal_id={rows[0].id}',
            extra_data={'timeout_reminder': True, 'kind': 'withdraw',
                        'count': len(rows), 'threshold_hours': hours,
                        'withdrawal_id': rows[0].id},
            tenant=tenant)
        sent += 1
    return sent


def _send_for_tenant(tenant, cfg):
    from .views import send_work_notification

    sent = 0
    if cfg.get('approval_enabled'):
        hours = cfg.get('approval_hours', 24)
        for user_id, item in _collect_approval_overdue(tenant, hours).items():
            if _recently_sent(user_id, '审批超时提醒', 'approval'):
                continue
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
            if _recently_sent(user_id, '任务/群工单超时提醒', 'task'):
                continue
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

    if cfg.get('invoice_enabled'):
        sent += _send_invoice_reminders(tenant, cfg.get('invoice_hours', 24))

    if cfg.get('withdraw_enabled'):
        sent += _send_withdraw_reminders(tenant, cfg.get('withdraw_hours', 24))
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
        if not (cfg['approval_enabled'] or cfg['task_enabled']
                or cfg['invoice_enabled'] or cfg['withdraw_enabled']):
            continue
        if not _in_window(cfg, now_time):
            continue
        last = _parse_last_sent(cfg)
        if last and now < last + timedelta(hours=cfg['interval_hours']):
            continue
        # 防止多个 beat/worker 同时执行同一企业的提醒导致重复发送
        from django.core.cache import cache
        lock_key = f'{KEY_PREFIX}lock.{tenant.id}'
        try:
            if not cache.add(lock_key, '1', timeout=1800):
                continue
        except Exception:
            pass
        try:
            total += _send_for_tenant(tenant, cfg)
        except Exception as e:
            logger.warning(f'企业 {tenant.id} 超时提醒发送失败: {e}')
        cfg['last_sent_at'] = now.isoformat()
        _persist(tenant, cfg)
        try:
            cache.delete(lock_key)
        except Exception:
            pass

    if total:
        logger.info(f'超时提醒发送完成，共 {total} 条')
    return total
