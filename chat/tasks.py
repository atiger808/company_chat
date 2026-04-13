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
        # schedule_message()
        logger.info("chat_task task completed successfully!")
        return "Success"
    except Exception as e:
        logger.info(f"chat_task task failed: {str(e)}")
        raise

