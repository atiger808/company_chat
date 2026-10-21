# -*- coding: utf-8 -*-
# @File   :tasks.py
# @Time   :2026/4/13 14:22
# @Author :admin

from company_chat.celery_app import app
import json
import time
from loguru import logger
from .utils import schedule_message

# 添加一个简单的测试任务
@app.task
def chat_task():
    logger.info("Starting chat_task task...")
    try:
        schedule_message()
        logger.info("chat_task task completed successfully!")
        return "Success"
    except Exception as e:
        logger.info(f"chat_task task failed: {str(e)}")
        raise



def _iter_card_message_batches(message_type, batch_size):
    """按主键分页读取卡片消息，避免一次性把大量卡片内容载入内存。"""
    from .models import Message

    last_id = 0
    while True:
        rows = list(
            Message.objects.filter(
                message_type=message_type, is_deleted=False, id__gt=last_id
            ).only('id', 'content').order_by('id')[:batch_size]
        )
        if not rows:
            break
        last_id = rows[-1].id
        yield rows


def _load_card_payload(message):
    """解析卡片消息的 JSON 内容，非法内容返回 None。"""
    if not message.content:
        return None
    try:
        data = json.loads(message.content)
    except (TypeError, ValueError):
        logger.debug(f'sync_chat_card_status: 消息 {message.id} 的卡片内容不是合法 JSON，已跳过')
        return None
    return data if isinstance(data, dict) else None


def _to_int(value):
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


@app.task
def sync_chat_card_status_task(batch_size=500):
    """定时同步聊天卡片消息里的审批/任务状态。

    审批卡片/任务卡片的 content 是创建时的 JSON 快照，审批或任务后续状态变化后
    卡片内展示的状态会过期。本任务批量比对真实状态，仅回写发生变化的卡片内容。
    审批卡片同步 status 和 status_display；任务卡片同步 status。
    """
    from .models import Message
    from oa.models import ApprovalRequest
    from tasks.models import Task

    approval_labels = dict(ApprovalRequest.STATUS_CHOICES)
    approval_checked = approval_updated = 0
    task_checked = task_updated = 0

    # 审批卡片：已通过的卡片是终态，无需再监测
    for batch in _iter_card_message_batches('approval_card', batch_size):
        parsed = []
        approval_ids = set()
        for message in batch:
            data = _load_card_payload(message)
            if not data or data.get('status') == 'approved':
                continue
            approval_id = _to_int(data.get('approval_id'))
            if approval_id is None:
                continue
            parsed.append((message, data, approval_id))
            approval_ids.add(approval_id)
        if not parsed:
            continue

        statuses = dict(
            ApprovalRequest.objects.filter(id__in=approval_ids).values_list('id', 'status')
        )
        dirty = []
        for message, data, approval_id in parsed:
            approval_checked += 1
            status = statuses.get(approval_id)
            if not status or status == data.get('status'):
                continue
            data['status'] = status
            data['status_display'] = approval_labels.get(status, status)
            message.content = json.dumps(data, ensure_ascii=False)
            dirty.append(message)
        if dirty:
            Message.objects.bulk_update(dirty, ['content'])
            approval_updated += len(dirty)

    # 任务卡片：同步所有与真实状态不一致的卡片（含已完成/已归档的修正）
    for batch in _iter_card_message_batches('task_card', batch_size):
        parsed = []
        task_ids = set()
        for message in batch:
            data = _load_card_payload(message)
            if not data:
                continue
            task_id = _to_int(data.get('id'))
            if task_id is None:
                continue
            parsed.append((message, data, task_id))
            task_ids.add(task_id)
        if not parsed:
            continue

        statuses = dict(Task.objects.filter(id__in=task_ids).values_list('id', 'status'))
        dirty = []
        for message, data, task_id in parsed:
            task_checked += 1
            status = statuses.get(task_id)
            if not status or status == data.get('status'):
                continue
            data['status'] = status
            message.content = json.dumps(data, ensure_ascii=False)
            dirty.append(message)
        if dirty:
            Message.objects.bulk_update(dirty, ['content'])
            task_updated += len(dirty)

    result = {
        'approval_checked': approval_checked,
        'approval_updated': approval_updated,
        'task_checked': task_checked,
        'task_updated': task_updated,
    }
    if approval_updated or task_updated:
        logger.info(f'sync_chat_card_status_task {result}')
    else:
        logger.debug(f'sync_chat_card_status_task {result}')
    return result


@app.task(bind=True, max_retries=2, default_retry_delay=10)
def send_push_task(self, user_id, payload, ttl=0, urgent=False):
    """异步发送 Web Push 给用户的所有订阅（离线设备）。

    并发发送：同一用户常有多台设备/浏览器订阅（日志里曾出现 14 个订阅），
    串行逐个发每个要 1~2 秒，会导致明显延迟；改为线程池并发，把总耗时降到单次请求水平。
    """
    from .push_utils import send_push
    from .models import PushSubscription
    from concurrent.futures import ThreadPoolExecutor

    subs = list(PushSubscription.objects.filter(user_id=user_id))
    sub_count = len(subs)
    if not subs:
        logger.info(f'send_push_task user={user_id} subs=0 sent=0')
        return 0

    workers = min(10, sub_count)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(lambda s: send_push(s, payload, ttl=ttl, urgent=urgent), subs))
    sent = sum(1 for r in results if r)
    logger.info(f'send_push_task user={user_id} subs={sub_count} sent={sent} urgent={urgent} workers={workers}')
    return sent
