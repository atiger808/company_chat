# -*- coding: utf-8 -*-
# @File   :tasks.py
# @Time   :2026/4/13 14:22
# @Author :admin

from company_chat.celery_app import app
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
