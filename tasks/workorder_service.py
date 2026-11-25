# -*- coding: utf-8 -*-
"""群工单（群待办）状态机与服务层。"""
import json
from urllib.parse import urlparse

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import PermissionDenied, ValidationError
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from accounts.models import CustomUser, Department, TenantMembership
from chat.models import ChatRoom, ChatRoomUserState, Message
from utils.utils import SystemConfigManager
from .models import WorkOrder, WorkOrderStage, WorkOrderComment

STATUS_TEXT = dict(WorkOrder.STATUS_CHOICES)
URGENCY_TEXT = dict(WorkOrder.URGENCY_CHOICES)
STAGE_STATUS_TEXT = dict(WorkOrderStage.STATUS_CHOICES)

# ==================== 群待办发起权限配置 ====================
# 存放于 SystemConfig 的 JSON 配置（无需新增数据表/迁移）。
WORKORDER_PERM_CONFIG_KEY = 'workorder.create_permissions'
WORKORDER_PERMISSION_OPTIONS = [
    {'key': 'group_owner', 'label': '群主', 'group': 'group_role'},
    {'key': 'group_admin', 'label': '群管理员', 'group': 'group_role'},
    {'key': 'group_member', 'label': '群成员', 'group': 'group_role'},
    {'key': 'user_type_normal', 'label': '普通用户', 'group': 'user_type'},
    {'key': 'user_type_admin', 'label': '管理员', 'group': 'user_type'},
    {'key': 'user_type_super_admin', 'label': '超级管理员', 'group': 'user_type'},
    {'key': 'dept_head', 'label': '所属企业部门负责人', 'group': 'dept_role'},
    {'key': 'enterprise_member', 'label': '普通成员', 'group': 'enterprise_role'},
    {'key': 'enterprise_dept_admin', 'label': '部门管理员', 'group': 'enterprise_role'},
    {'key': 'enterprise_admin', 'label': '企业管理员', 'group': 'enterprise_role'},
    {'key': 'enterprise_owner', 'label': '企业所有者', 'group': 'enterprise_role'},
]
WORKORDER_PERM_KEYS = [item['key'] for item in WORKORDER_PERMISSION_OPTIONS]
DEFAULT_WORKORDER_PERMISSIONS = {
    key: key in {'group_owner', 'group_admin', 'user_type_super_admin', 'dept_head'}
    for key in WORKORDER_PERM_KEYS
}


def get_workorder_create_permissions():
    """读取群待办发起权限配置；未配置时返回默认值。"""
    raw = SystemConfigManager.get_config(WORKORDER_PERM_CONFIG_KEY, None)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}
    data = raw if isinstance(raw, dict) else {}
    return {
        key: (bool(data[key]) if key in data else DEFAULT_WORKORDER_PERMISSIONS[key])
        for key in WORKORDER_PERM_KEYS
    }


def save_workorder_create_permissions(data, user=None):
    """保存权限配置（全部键补齐为布尔值）。"""
    data = data if isinstance(data, dict) else {}
    cfg = {key: bool(data.get(key)) for key in WORKORDER_PERM_KEYS}
    SystemConfigManager.set_config(
        WORKORDER_PERM_CONFIG_KEY,
        json.dumps(cfg, ensure_ascii=False),
        user=user,
    )
    return cfg


def workorder_permission_payload():
    return {
        'permissions': get_workorder_create_permissions(),
        'options': WORKORDER_PERMISSION_OPTIONS,
        'defaults': DEFAULT_WORKORDER_PERMISSIONS,
    }


def _permission_tenant(room, user):
    tenant = getattr(room, 'tenant', None) if room else None
    if tenant is None and user is not None:
        try:
            tenant = user.get_active_tenant()
        except Exception:
            tenant = None
    return tenant


def can_create_work_order(user, room):
    """判断用户是否具备在当前群发起群待办的权限（按管理控制台开关，任一命中即可）。"""
    if not room or not user or not getattr(user, 'is_authenticated', False):
        return False
    cfg = get_workorder_create_permissions()
    if not any(cfg.values()):
        return False

    # 群内身份
    if cfg['group_owner'] and room.creator_id == user.id:
        return True
    if cfg['group_admin'] and ChatRoomUserState.objects.filter(
        chat_room_id=room.id, user_id=user.id, is_group_admin=True
    ).exists():
        return True
    if cfg['group_member'] and _room_member(room, user):
        return True

    # 用户类型
    user_type = getattr(user, 'user_type', '') or 'normal'
    if cfg.get('user_type_' + user_type):
        return True

    tenant = _permission_tenant(room, user)
    if tenant is not None:
        # 所属企业部门负责人（正/副负责人）
        if cfg['dept_head'] and Department.objects.filter(tenant=tenant).filter(
            Q(manager=user) | Q(deputy_managers=user)
        ).exists():
            return True
        # 企业角色
        role = TenantMembership.objects.filter(
            user=user, tenant=tenant, is_active=True
        ).values_list('role', flat=True).first()
        if role and cfg.get('enterprise_' + role):
            return True

    return False


def display_name(user):
    if not user:
        return ''
    return getattr(user, 'real_name', None) or getattr(user, 'username', '') or ''


def user_brief(user):
    if not user:
        return None
    avatar = ''
    try:
        avatar = user.get_avatar_url() if hasattr(user, 'get_avatar_url') else (
            user.avatar.url if getattr(user, 'avatar', None) else '')
    except Exception:
        avatar = ''
    return {
        'id': user.id,
        'username': getattr(user, 'username', ''),
        'real_name': display_name(user),
        'avatar_url': avatar,
    }


def _room_member(room, user):
    return bool(room and user and getattr(user, 'is_authenticated', False)
                and room.members.filter(id=user.id).exists())


def is_participant(wo, user):
    if not wo or not user or not getattr(user, 'is_authenticated', False):
        return False
    if wo.creator_id == user.id or wo.verifier_id == user.id:
        return True
    return any(s.assignee_id == user.id for s in wo.stages.all())


def current_stage(wo):
    stages = list(wo.stages.all())
    for stage in stages:
        if stage.status in ('pending', 'processing'):
            return stage
    return stages[-1] if stages else None


def _tenant_required(wo=None, tenant=None):
    t = tenant or (wo.tenant if wo else None)
    if not t:
        raise ValidationError('群聊未归属企业，无法创建工单')
    return t


def _parse_dt(value):
    if not value:
        return None
    dt = parse_datetime(str(value))
    if dt and timezone.is_naive(dt):
        dt = timezone.make_aware(dt)
    return dt


def _next_order_no(tenant):
    prefix = 'GD-' + timezone.localdate().strftime('%Y%m%d') + '-'
    last = (WorkOrder.objects.filter(tenant=tenant, order_no__startswith=prefix)
            .order_by('-order_no').values_list('order_no', flat=True).first())
    seq = 1
    if last:
        try:
            seq = int(str(last).rsplit('-', 1)[-1]) + 1
        except (TypeError, ValueError):
            seq = 1
    return f'{prefix}{seq:03d}'


def normalize_attachments(items, user):
    """把前端附件（FileUpload id 或 URL）转成可持久化的快照。

    上传接口按 MD5 去重，同一文件可能复用其他用户创建的 FileUpload 记录，
    因此这里与聊天/任务附件保持一致：只要拿到有效 FileUpload ID 即可引用。
    """
    from chat.models import FileUpload
    out = []
    for item in (items or [])[:30]:
        if not isinstance(item, dict):
            continue
        fid = item.get('file_id') or item.get('id')
        if fid:
            try:
                f = FileUpload.objects.get(id=fid)
            except FileUpload.DoesNotExist:
                continue
            out.append({
                'file_id': f.id,
                'url': f.file.url if f.file else '',
                'name': f.filename,
                'size': f.size or 0,
                'mime': f.mime_type or '',
            })
            continue
        url = (item.get('url') or '').strip()
        if not url:
            continue
        parsed = urlparse(url)
        if parsed.scheme and parsed.scheme not in ('http', 'https'):
            continue
        out.append({
            'file_id': None,
            'url': url,
            'name': item.get('name') or '',
            'size': item.get('size') or 0,
            'mime': item.get('mime') or '',
        })
    return out


def build_card_data(wo):
    stages = list(wo.stages.all())
    total = len(stages)
    done = len([s for s in stages if s.status == 'done'])
    cur = next((s for s in stages if s.status in ('pending', 'processing')), None)
    if cur is None and stages:
        cur = stages[-1]
    return {
        'work_order_id': wo.id,
        'order_no': wo.order_no,
        'title': wo.title,
        'status': wo.status,
        'status_display': STATUS_TEXT.get(wo.status, wo.status),
        'urgency': wo.urgency,
        'urgency_display': URGENCY_TEXT.get(wo.urgency, wo.urgency),
        'progress': {'done': done, 'total': total},
        'current_stage': ({
            'id': cur.id,
            'order': cur.order,
            'name': cur.name,
            'assignee_id': cur.assignee_id,
            'assignee_name': cur.assignee_name,
            'deadline': cur.deadline.isoformat() if cur.deadline else '',
            'status': cur.status,
            'status_display': STAGE_STATUS_TEXT.get(cur.status, cur.status),
        } if cur else None),
        'room_id': wo.chat_room_id,
        'tenant_name': wo.tenant.name if wo.tenant else '',
        'creator_name': wo.creator_name,
        'verifier_name': wo.verifier_name,
        'last_action': wo.last_action,
        'last_action_display': wo.get_last_action_display(),
        'last_action_at': wo.last_action_at.isoformat() if wo.last_action_at else '',
        'sync_notify': wo.sync_notify,
        'ding': wo.ding,
        'created_at': wo.created_at.isoformat() if wo.created_at else '',
        'updated_at': wo.updated_at.isoformat() if wo.updated_at else '',
        'closed_at': wo.closed_at.isoformat() if wo.closed_at else '',
    }


def card_preview(card):
    cur = card.get('current_stage') or {}
    progress = card.get('progress') or {}
    text = f"🧾 工单 {card.get('order_no')}「{card.get('title')}」 · {card.get('status_display')} {progress.get('done', 0)}/{progress.get('total', 0)}"
    if card.get('status') in ('processing', 'pending') and cur.get('name'):
        text += f" · {cur.get('name')}（{cur.get('assignee_name') or '未指派'}）"
    return text


def build_permissions(wo, user):
    room_member = _room_member(wo.chat_room, user)
    participant = is_participant(wo, user)
    supers = bool(getattr(user, 'is_superuser', False))
    cur = current_stage(wo)
    closed = wo.status in ('done', 'cancelled')
    return {
        'can_view': participant or room_member or supers,
        'can_comment': (participant or supers) and not closed,
        'can_start': (not closed and cur and cur.status == 'pending'
                      and (cur.assignee_id == user.id or supers)),
        'can_submit': (not closed and cur and cur.status == 'processing'
                       and (cur.assignee_id == user.id or supers)),
        'can_verify': wo.status == 'pending_verify' and (wo.verifier_id == user.id or supers),
        'can_cancel': wo.creator_id == user.id and not closed,
        'can_change_verifier': wo.creator_id == user.id and not closed,
        'can_reassign': (wo.creator_id == user.id or wo.verifier_id == user.id or supers) and not closed,
        'can_ding': (wo.creator_id == user.id or wo.verifier_id == user.id or supers) and not closed,
        'can_edit': wo.creator_id == user.id and wo.status in ('pending', 'processing'),
    }


# ==================== 广播 / 通知 ====================

def _broadcast_message(wo, message, card_data=None, content_text=None):
    room = wo.chat_room
    if not room:
        return
    sender = message.sender or wo.creator
    payload = {
        'chat_room': room.id,
        'message_id': str(message.id),
        'sender': user_brief(sender),
        'sender_id': sender.id if sender else None,
        'sender_name': display_name(sender),
        'content': content_text or message.content or '',
        'message_type': message.message_type,
        'file_info': None,
        'mentioned_users': [],
        'mentioned_all': False,
        'timestamp': message.timestamp.isoformat() if message.timestamp else timezone.now().isoformat(),
        'work_order_data': card_data,
    }
    layer = get_channel_layer()
    async_to_sync(layer.group_send)(f'chat_{room.id}', dict(payload, type='chat_message'))
    member_ids = list(room.members.values_list('id', flat=True))
    for uid in member_ids:
        async_to_sync(layer.group_send)(
            f'user_{uid}_notifications', dict(payload, type='new_message'))


def _broadcast_update(wo_id):
    wo = WorkOrder.objects.select_related('chat_room', 'creator', 'verifier').prefetch_related('stages').get(id=wo_id)
    card = build_card_data(wo)
    if wo.card_message_id:
        Message.objects.filter(id=wo.card_message_id).update(content=json.dumps(card, ensure_ascii=False))
    room = wo.chat_room
    if not room:
        return
    layer = get_channel_layer()
    async_to_sync(layer.group_send)(
        f'chat_{room.id}', {'type': 'work_order.update', 'work_order': card})
    participant_ids = set(wo.stages.values_list('assignee_id', flat=True))
    participant_ids.add(wo.creator_id)
    participant_ids.add(wo.verifier_id)
    participant_ids.discard(None)
    for uid in participant_ids:
        async_to_sync(layer.group_send)(
            f'user_{uid}_notifications', {'type': 'work_order.update', 'work_order': card})


def _send_group_notice(wo, text, sender):
    room = wo.chat_room
    if not room:
        return None
    # 通知消息内容保存为 JSON，便于前端在气泡尾部挂「查看工单详情」入口；
    # 兼容旧数据：旧通知是纯文本，前端读取失败时按纯文本展示。
    notice = {'kind': 'notice', 'text': text, 'work_order_id': wo.id}
    msg = Message.objects.create(
        chat_room=room, sender=sender or wo.creator,
        content=json.dumps(notice, ensure_ascii=False),
        message_type='work_order_notice')
    ChatRoom.objects.filter(id=room.id).update(updated_at=timezone.now())
    transaction.on_commit(lambda: _broadcast_message(wo, msg, card_data=notice, content_text=text))
    return msg


def _notify(wo, user, title, content, ding=False, action=''):
    if not user:
        return
    from oa.views import send_work_notification
    send_work_notification(
        user.id, title, content, notification_type='workorder',
        related_url=f'/tasks/?work_order_id={wo.id}',
        extra_data={
            'work_order_id': wo.id,
            'room_id': wo.chat_room_id,
            'ding': bool(ding),
            'action': action,
        },
        tenant=wo.tenant,
    )


def _notify_stage_assignee(wo, stage, title, content, action='stage'):
    if not stage or not stage.assignee_id:
        return
    prefix = '【DING】' if wo.ding else ''
    _notify(wo, stage.assignee, prefix + title, content, ding=wo.ding, action=action)


def _notify_progress(wo_id, actor_id, text, has_attachments=False):
    """进度更新后通知发起人/核验人/当前执行人（排除本人），含 Web Push。"""
    wo = (WorkOrder.objects.select_related('creator', 'verifier', 'chat_room')
          .prefetch_related('stages').filter(id=wo_id).first())
    if not wo:
        return
    cur = current_stage(wo)
    recipients = {wo.creator_id, wo.verifier_id}
    if cur and cur.assignee_id:
        recipients.add(cur.assignee_id)
    recipients.discard(None)
    recipients.discard(actor_id)
    actor = CustomUser.objects.filter(id=actor_id).first()
    actor_name = display_name(actor) if actor else '相关成员'
    snippet = (text or '').strip()
    if not snippet:
        snippet = '上传了新的附件交付' if has_attachments else '更新了进度'
    if len(snippet) > 60:
        snippet = snippet[:60] + '…'
    for uid in recipients:
        target = CustomUser.objects.filter(id=uid, is_active=True).first()
        if not target:
            continue
        _notify(wo, target, f'工单进度更新：{wo.title}',
                f'{actor_name} 更新了工单 {wo.order_no} 进度：{snippet}', action='progress')


def _notify_cancelled(wo_id, actor_id, reason=''):
    """工单取消后通知相关人（排除操作人）。"""
    wo = (WorkOrder.objects.select_related('creator', 'verifier', 'chat_room')
          .prefetch_related('stages').filter(id=wo_id).first())
    if not wo:
        return
    recipients = set(wo.stages.values_list('assignee_id', flat=True))
    recipients.update({wo.creator_id, wo.verifier_id})
    recipients.discard(None)
    recipients.discard(actor_id)
    content = f'工单 {wo.order_no} 已被取消。'
    if reason:
        content += f'原因：{reason}'
    for uid in recipients:
        target = CustomUser.objects.filter(id=uid, is_active=True).first()
        if not target:
            continue
        _notify(wo, target, f'工单已取消：{wo.title}', content, action='cancelled')


def _after_created(wo_id, message_id):
    wo = WorkOrder.objects.select_related('chat_room', 'creator', 'verifier').prefetch_related('stages').get(id=wo_id)
    msg = Message.objects.get(id=message_id)
    card = build_card_data(wo)
    _broadcast_message(wo, msg, card_data=card, content_text=card_preview(card))
    cur = current_stage(wo)
    if cur and cur.assignee_id:
        deadline = cur.deadline.strftime('%Y-%m-%d %H:%M') if cur.deadline else '未设置'
        _notify_stage_assignee(
            wo, cur, f'新工单待处理：{wo.title}',
            f'工单 {wo.order_no} 已发起，当前环节「{cur.name}」由您处理，截止 {deadline}。',
            action='created')


# ==================== 创建 ====================

def _normalize_stages(payload, room):
    raw = payload.get('stages') or []
    if not isinstance(raw, list) or not raw:
        raise ValidationError('请至少配置一个环节')
    member_ids = set(room.members.values_list('id', flat=True))
    stages = []
    prev_deadline = None
    for idx, item in enumerate(raw, 1):
        if not isinstance(item, dict):
            raise ValidationError('环节格式不正确')
        name = (item.get('name') or '').strip()
        if not name:
            raise ValidationError(f'第 {idx} 个环节名称不能为空')
        try:
            assignee_id = int(item.get('assignee_id') or item.get('assignee') or 0)
        except (TypeError, ValueError):
            assignee_id = 0
        if assignee_id not in member_ids:
            raise ValidationError(f'第 {idx} 个环节执行人必须是当前群成员')
        deadline = _parse_dt(item.get('deadline'))
        if deadline and prev_deadline and deadline < prev_deadline:
            raise ValidationError('环节截止时间必须按顺序递增')
        if deadline:
            prev_deadline = deadline
        stages.append({
            'order': idx,
            'name': name,
            'assignee_id': assignee_id,
            'deadline': deadline,
        })
    return stages


def create_work_order(user, payload, tenant=None):
    try:
        room_id = int(payload.get('chat_room_id') or payload.get('chat_room') or 0)
    except (TypeError, ValueError):
        room_id = 0
    if not room_id:
        raise ValidationError('缺少 chat_room_id')
    try:
        room = ChatRoom.objects.get(id=room_id)
    except ChatRoom.DoesNotExist:
        raise ValidationError('聊天室不存在')
    if room.room_type != 'group':
        raise ValidationError('群工单只能在群聊中发起')
    if not _room_member(room, user):
        raise PermissionDenied('您不在该群聊中，无法发起工单')
    if not can_create_work_order(user, room):
        raise PermissionDenied('您没有发起群待办的权限，请联系管理员在管理控制台配置')
    tenant = _tenant_required(tenant=room.tenant or tenant)

    title = (payload.get('title') or '').strip()
    if not title:
        raise ValidationError('请输入工单标题')
    if len(title) > 200:
        raise ValidationError('工单标题不能超过 200 字')
    urgency = payload.get('urgency') or 'medium'
    if urgency not in URGENCY_TEXT:
        raise ValidationError('紧急等级不正确')
    description = (payload.get('description') or '').strip()
    solution_template = (payload.get('solution_template') or '').strip()
    stages_data = _normalize_stages(payload, room)

    member_ids = set(room.members.values_list('id', flat=True))
    try:
        verifier_id = int(payload.get('verifier_id') or user.id)
    except (TypeError, ValueError):
        verifier_id = user.id
    if verifier_id not in member_ids:
        raise ValidationError('核验人必须是当前群成员')
    try:
        verifier = CustomUser.objects.get(id=verifier_id, is_active=True)
    except CustomUser.DoesNotExist:
        raise ValidationError('核验人不存在或已禁用')

    provided_no = (payload.get('order_no') or '').strip()
    if provided_no and len(provided_no) > 64:
        raise ValidationError('工单编号不能超过 64 个字符')

    last_error = None
    for attempt in range(6):
        try:
            with transaction.atomic():
                order_no = provided_no or _next_order_no(tenant)
                wo = WorkOrder.objects.create(
                    order_no=order_no,
                    title=title,
                    description=description,
                    urgency=urgency,
                    solution_template=solution_template,
                    status='pending',
                    chat_room=room,
                    tenant=tenant,
                    creator=user,
                    creator_name=display_name(user),
                    verifier=verifier,
                    verifier_name=display_name(verifier),
                    current_stage_order=1,
                    sync_notify=bool(payload.get('sync_notify', True)),
                    ding=bool(payload.get('ding', False)),
                    last_action='created',
                    last_action_at=timezone.now(),
                )
                for st in stages_data:
                    WorkOrderStage.objects.create(
                        work_order=wo, order=st['order'], name=st['name'],
                        assignee_id=st['assignee_id'],
                        assignee_name=display_name(CustomUser.objects.filter(id=st['assignee_id']).first()),
                        deadline=st['deadline'], status='pending')
                WorkOrderComment.objects.create(
                    work_order=wo, user=user, user_name=display_name(user),
                    action_type='system',
                    content=f'工单已创建，共 {len(stages_data)} 个环节。')
                wo.refresh_from_db()
                card = build_card_data(wo)
                card_msg = Message.objects.create(
                    chat_room=room, sender=user,
                    content=json.dumps(card, ensure_ascii=False),
                    message_type='work_order_card')
                wo.card_message = card_msg
                wo.save(update_fields=['card_message'])
                ChatRoom.objects.filter(id=room.id).update(updated_at=timezone.now())
                wo_id, msg_id = wo.id, card_msg.id
                transaction.on_commit(lambda: _after_created(wo_id, msg_id))
                return wo
        except IntegrityError as e:
            last_error = e
            if provided_no:
                raise ValidationError('工单编号已存在，请更换')
            if attempt >= 5:
                break
    raise ValidationError('工单编号生成冲突，请稍后重试')


# ==================== 环节操作 ====================

def _locked_wo(wo_id):
    # 注意：chat_room / creator / verifier 均为可空外键，select_for_update 不能再 select_related，
    # 否则 PostgreSQL 会报 "FOR UPDATE cannot be applied to the nullable side of an outer join"。
    # 这里只锁 WorkOrder 主表，关联对象按需懒加载。
    try:
        return (WorkOrder.objects.select_for_update()
                .prefetch_related('stages').get(id=wo_id))
    except WorkOrder.DoesNotExist:
        raise ValidationError('工单不存在')


def _assert_active(wo):
    if wo.status in ('done', 'cancelled'):
        raise ValidationError('工单已闭环/取消，不能继续操作')


def start_stage(wo_id, stage_id, user, payload=None):
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        _assert_active(wo)
        try:
            stage = wo.stages.select_for_update().get(id=stage_id)
        except WorkOrderStage.DoesNotExist:
            raise ValidationError('环节不存在')
        cur = current_stage(wo)
        if not cur or cur.id != stage.id:
            raise ValidationError('只能操作当前环节')
        if stage.assignee_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有当前环节执行人可以开始处理')
        if stage.status != 'pending':
            raise ValidationError('该环节已开始或已完成')
        stage.status = 'processing'
        stage.started_at = timezone.now()
        stage.save(update_fields=['status', 'started_at'])
        wo.status = 'processing'
        wo.current_stage_order = stage.order
        wo.last_action = 'started'
        wo.last_action_at = timezone.now()
        wo.save(update_fields=['status', 'current_stage_order', 'last_action', 'last_action_at'])
        WorkOrderComment.objects.create(
            work_order=wo, stage=stage, user=user, user_name=display_name(user),
            action_type='start', content='开始处理本环节。')
        transaction.on_commit(lambda: _broadcast_update(wo_id))
    return _fresh(wo_id)


def submit_stage(wo_id, stage_id, user, payload=None):
    payload = payload or {}
    attachments = normalize_attachments(payload.get('attachments'), user)
    content = (payload.get('comment') or payload.get('content') or '').strip()
    if not content and not attachments:
        raise ValidationError('请填写进度说明或上传交付成果')
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        _assert_active(wo)
        try:
            stage = wo.stages.select_for_update().get(id=stage_id)
        except WorkOrderStage.DoesNotExist:
            raise ValidationError('环节不存在')
        cur = current_stage(wo)
        if not cur or cur.id != stage.id:
            raise ValidationError('只能提交当前环节')
        if stage.assignee_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有当前环节执行人可以提交')
        if stage.status != 'processing':
            raise ValidationError('请先点击「开始处理」再提交')
        stage.status = 'done'
        stage.completed_at = timezone.now()
        stage.deliverable = attachments
        stage.remark = content
        stage.save(update_fields=['status', 'completed_at', 'deliverable', 'remark'])
        WorkOrderComment.objects.create(
            work_order=wo, stage=stage, user=user, user_name=display_name(user),
            action_type='submit', content=content or '提交本环节', attachments=attachments)
        nxt = wo.stages.filter(order__gt=stage.order).order_by('order').first()
        now = timezone.now()
        if nxt:
            wo.status = 'processing'
            wo.current_stage_order = nxt.order
        else:
            wo.status = 'pending_verify'
            wo.current_stage_order = stage.order
        wo.last_action = 'submitted'
        wo.last_action_at = now
        wo.save(update_fields=['status', 'current_stage_order', 'last_action', 'last_action_at'])
        wo_id_local, next_id, verifier_id = wo.id, (nxt.id if nxt else None), wo.verifier_id
        sync_notify = wo.sync_notify
        if sync_notify:
            _send_group_notice(
                wo, f'🧾 工单 {wo.order_no}「{wo.title}」环节「{stage.name}」已提交，进度 {stage.order}/{wo.stages.count()}。',
                user)
        transaction.on_commit(lambda: _broadcast_update(wo_id_local))
        transaction.on_commit(lambda: _after_stage_submitted(wo_id_local, next_id, verifier_id))
    return _fresh(wo_id)


def _after_stage_submitted(wo_id, next_stage_id, verifier_id):
    wo = WorkOrder.objects.select_related('chat_room', 'creator', 'verifier').prefetch_related('stages').get(id=wo_id)
    if next_stage_id:
        stage = wo.stages.filter(id=next_stage_id).first()
        if stage and stage.assignee_id:
            deadline = stage.deadline.strftime('%Y-%m-%d %H:%M') if stage.deadline else '未设置'
            _notify_stage_assignee(
                wo, stage, f'工单环节待处理：{wo.title}',
                f'工单 {wo.order_no} 的上一环节已完成，当前环节「{stage.name}」由您处理，截止 {deadline}。',
                action='stage_ready')
    else:
        verifier = wo.verifier
        if verifier:
            _notify(wo, verifier, f'工单待核验：{wo.title}',
                    f'工单 {wo.order_no} 的所有环节已完成，请核验交付成果。', action='pending_verify')


def update_work_order(wo_id, user, payload=None):
    """发起人修改标题/描述/紧急度/方案模板等基础信息（不改阶段结构）。"""
    payload = payload or {}
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        if wo.creator_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有发起人可以修改工单')
        if wo.status not in ('pending', 'processing'):
            raise ValidationError('当前状态不能修改工单')
        changed = []
        if 'title' in payload:
            title = (payload.get('title') or '').strip()
            if not title:
                raise ValidationError('工单标题不能为空')
            wo.title = title[:200]
            changed.append('title')
        if 'description' in payload:
            wo.description = (payload.get('description') or '').strip()
            changed.append('description')
        if 'urgency' in payload:
            urgency = payload.get('urgency') or 'medium'
            if urgency not in URGENCY_TEXT:
                raise ValidationError('紧急等级不正确')
            wo.urgency = urgency
            changed.append('urgency')
        if 'solution_template' in payload:
            wo.solution_template = (payload.get('solution_template') or '').strip()
            changed.append('solution_template')
        if 'sync_notify' in payload:
            wo.sync_notify = bool(payload.get('sync_notify'))
            changed.append('sync_notify')
        if 'ding' in payload:
            wo.ding = bool(payload.get('ding'))
            changed.append('ding')
        if changed:
            wo.last_action = 'comment'
            wo.last_action_at = timezone.now()
            changed += ['last_action', 'last_action_at']
            wo.save(update_fields=changed)
            WorkOrderComment.objects.create(
                work_order=wo, user=user, user_name=display_name(user),
                action_type='system', content='工单基础信息已更新。')
            transaction.on_commit(lambda: _broadcast_update(wo_id))
    return _fresh(wo_id)


def add_comment(wo_id, user, payload=None):
    payload = payload or {}
    attachments = normalize_attachments(payload.get('attachments'), user)
    content = (payload.get('content') or payload.get('comment') or '').strip()
    if not content and not attachments:
        raise ValidationError('请输入评论内容或上传附件')
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        if not is_participant(wo, user) and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有发起人、核验人或环节执行人可以更新进度')
        _assert_active(wo)
        stage = None
        stage_id = payload.get('stage_id')
        if stage_id:
            stage = wo.stages.filter(id=stage_id).first()
        comment = WorkOrderComment.objects.create(
            work_order=wo, stage=stage, user=user, user_name=display_name(user),
            action_type='progress', content=content, attachments=attachments)
        wo.last_action = 'comment'
        wo.last_action_at = timezone.now()
        wo.save(update_fields=['last_action', 'last_action_at'])
        transaction.on_commit(lambda: _broadcast_update(wo_id))
        actor_id = user.id
        progress_text = content
        has_attachments = bool(attachments)
        transaction.on_commit(
            lambda: _notify_progress(wo_id, actor_id, progress_text, has_attachments))
    return comment


# ==================== 核验 / 取消 / 改派 / DING ====================

def verify_work_order(wo_id, user, payload=None):
    payload = payload or {}
    result = (payload.get('result') or '').strip()
    if result not in ('pass', 'reject'):
        raise ValidationError('核验结论必须为 pass 或 reject')
    comment_text = (payload.get('comment') or '').strip()
    attachments = normalize_attachments(payload.get('attachments'), user)
    if result == 'reject' and not comment_text:
        raise ValidationError('驳回时必须填写退回原因')
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        if wo.verifier_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有核验人可以核验工单')
        if wo.status != 'pending_verify':
            raise ValidationError('当前工单不在待核验状态')
        now = timezone.now()
        if result == 'pass':
            wo.status = 'done'
            wo.last_action = 'verified'
            wo.last_action_at = now
            wo.closed_at = now
            wo.archived_at = now
            wo.save(update_fields=['status', 'last_action', 'last_action_at', 'closed_at', 'archived_at'])
            WorkOrderComment.objects.create(
                work_order=wo, user=user, user_name=display_name(user),
                action_type='verify', content=comment_text or '核验通过，工单闭环。', attachments=attachments)
            _send_group_notice(
                wo, f'✅ 工单 {wo.order_no}「{wo.title}」已核验通过并闭环。', user)
            transaction.on_commit(lambda: _broadcast_update(wo_id))
            transaction.on_commit(lambda: _after_verified(wo_id, True, comment_text))
            return _fresh(wo_id)

        # 驳回：回到最后一个已完成环节继续处理
        last_done = wo.stages.filter(status='done').order_by('-order').first()
        if last_done:
            last_done.status = 'processing'
            last_done.completed_at = None
            last_done.save(update_fields=['status', 'completed_at'])
            wo.current_stage_order = last_done.order
        wo.status = 'processing'
        wo.last_action = 'rejected'
        wo.last_action_at = now
        wo.save(update_fields=['status', 'current_stage_order', 'last_action', 'last_action_at'])
        WorkOrderComment.objects.create(
            work_order=wo, stage=last_done, user=user, user_name=display_name(user),
            action_type='reject', content=comment_text, attachments=attachments)
        if wo.sync_notify:
            _send_group_notice(
                wo, f'↩️ 工单 {wo.order_no}「{wo.title}」核验未通过，已退回继续处理：{comment_text}', user)
        transaction.on_commit(lambda: _broadcast_update(wo_id))
        transaction.on_commit(lambda: _after_verified(wo_id, False, comment_text))
    return _fresh(wo_id)


def _after_verified(wo_id, passed, comment_text):
    wo = WorkOrder.objects.select_related('chat_room', 'creator', 'verifier').prefetch_related('stages').get(id=wo_id)
    recipients = set(wo.stages.values_list('assignee_id', flat=True))
    recipients.add(wo.creator_id)
    recipients.discard(None)
    if passed:
        for uid in recipients:
            if uid == wo.verifier_id:
                continue
            try:
                target = CustomUser.objects.get(id=uid)
            except CustomUser.DoesNotExist:
                continue
            _notify(wo, target, f'工单已闭环：{wo.title}',
                    f'工单 {wo.order_no} 已核验通过并归档到任务中心。', action='closed')
    else:
        stage = wo.stages.filter(order=wo.current_stage_order).first()
        notified = set()
        if stage and stage.assignee_id:
            _notify_stage_assignee(
                wo, stage, f'工单被退回：{wo.title}',
                f'工单 {wo.order_no} 核验未通过，退回原因：{comment_text}。请继续处理环节「{stage.name}」。',
                action='rejected')
            notified.add(stage.assignee_id)
        if wo.creator_id and wo.creator_id != wo.verifier_id and wo.creator_id not in notified:
            _notify(wo, wo.creator, f'工单被退回：{wo.title}',
                    f'工单 {wo.order_no} 核验未通过，已退回环节继续处理。原因：{comment_text}',
                    action='rejected')


def cancel_work_order(wo_id, user, payload=None):
    payload = payload or {}
    reason = (payload.get('reason') or payload.get('comment') or '').strip()
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        if wo.creator_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有发起人可以取消工单')
        _assert_active(wo)
        wo.status = 'cancelled'
        wo.last_action = 'cancelled'
        wo.last_action_at = timezone.now()
        wo.save(update_fields=['status', 'last_action', 'last_action_at'])
        WorkOrderComment.objects.create(
            work_order=wo, user=user, user_name=display_name(user),
            action_type='system', content='工单已取消。' + (f'原因：{reason}' if reason else ''))
        _send_group_notice(wo, f'⛔ 工单 {wo.order_no}「{wo.title}」已取消。', user)
        transaction.on_commit(lambda: _broadcast_update(wo_id))
        actor_id = user.id
        transaction.on_commit(lambda: _notify_cancelled(wo_id, actor_id, reason))
    return _fresh(wo_id)


def change_verifier(wo_id, user, payload=None):
    payload = payload or {}
    try:
        verifier_id = int(payload.get('verifier_id') or 0)
    except (TypeError, ValueError):
        verifier_id = 0
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        if wo.creator_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有发起人可以更换核验人')
        _assert_active(wo)
        if not wo.chat_room or not wo.chat_room.members.filter(id=verifier_id).exists():
            raise ValidationError('核验人必须是当前群成员')
        try:
            verifier = CustomUser.objects.get(id=verifier_id, is_active=True)
        except CustomUser.DoesNotExist:
            raise ValidationError('核验人不存在或已禁用')
        wo.verifier = verifier
        wo.verifier_name = display_name(verifier)
        wo.last_action = 'comment'
        wo.last_action_at = timezone.now()
        wo.save(update_fields=['verifier', 'verifier_name', 'last_action', 'last_action_at'])
        WorkOrderComment.objects.create(
            work_order=wo, user=user, user_name=display_name(user),
            action_type='system', content=f'核验人已更换为 {display_name(verifier)}。')
        transaction.on_commit(lambda: _broadcast_update(wo_id))
        transaction.on_commit(lambda: _notify(wo, verifier, f'工单核验人变更：{wo.title}',
                                              f'工单 {wo.order_no} 已指定您为核验人。', action='verifier_changed'))
    return _fresh(wo_id)


def reassign_stage(wo_id, stage_id, user, payload=None):
    payload = payload or {}
    try:
        assignee_id = int(payload.get('assignee_id') or 0)
    except (TypeError, ValueError):
        assignee_id = 0
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        if wo.creator_id != user.id and wo.verifier_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有发起人/核验人可以改派环节执行人')
        _assert_active(wo)
        try:
            stage = wo.stages.select_for_update().get(id=stage_id)
        except WorkOrderStage.DoesNotExist:
            raise ValidationError('环节不存在')
        if stage.status == 'done':
            raise ValidationError('已完成环节不能改派')
        if not wo.chat_room or not wo.chat_room.members.filter(id=assignee_id).exists():
            raise ValidationError('执行人必须是当前群成员')
        try:
            assignee = CustomUser.objects.get(id=assignee_id, is_active=True)
        except CustomUser.DoesNotExist:
            raise ValidationError('执行人不存在或已禁用')
        stage.assignee = assignee
        stage.assignee_name = display_name(assignee)
        stage.save(update_fields=['assignee', 'assignee_name'])
        wo.last_action = 'reassigned'
        wo.last_action_at = timezone.now()
        wo.save(update_fields=['last_action', 'last_action_at'])
        WorkOrderComment.objects.create(
            work_order=wo, stage=stage, user=user, user_name=display_name(user),
            action_type='system', content=f'环节「{stage.name}」执行人已改派为 {display_name(assignee)}。')
        transaction.on_commit(lambda: _broadcast_update(wo_id))
        transaction.on_commit(lambda: _notify_stage_assignee(
            wo, stage, f'工单环节已改派：{wo.title}',
            f'工单 {wo.order_no} 的环节「{stage.name}」已改派给您处理。', action='reassigned'))
    return _fresh(wo_id)


def send_ding(wo_id, user):
    with transaction.atomic():
        wo = _locked_wo(wo_id)
        _assert_active(wo)
        if wo.creator_id != user.id and wo.verifier_id != user.id and not getattr(user, 'is_superuser', False):
            raise PermissionDenied('只有发起人/核验人可以催办')
        if wo.status == 'pending_verify':
            target = wo.verifier
        else:
            stage = current_stage(wo)
            target = stage.assignee if stage else None
        if not target or target.id == user.id:
            raise ValidationError('当前没有可催办的处理人')
        WorkOrderComment.objects.create(
            work_order=wo, user=user, user_name=display_name(user),
            action_type='ding', content=f'已向 {display_name(target)} 发送 DING 催办。')
        wo.last_action = 'ding'
        wo.last_action_at = timezone.now()
        wo.save(update_fields=['last_action', 'last_action_at'])
        target_id = target.id
        transaction.on_commit(lambda: _broadcast_update(wo_id))
        transaction.on_commit(lambda: _notify(
            wo, CustomUser.objects.filter(id=target_id).first(),
            f'【DING】工单催办：{wo.title}',
            f'工单 {wo.order_no} 发起人提醒您尽快处理当前节点。', ding=True, action='ding'))
    return _fresh(wo_id)


def _fresh(wo_id):
    return (WorkOrder.objects.select_related('chat_room', 'creator', 'verifier')
            .prefetch_related('stages', 'comments__user', 'comments__stage')
            .get(id=wo_id))
