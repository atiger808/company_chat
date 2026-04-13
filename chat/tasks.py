# -*- coding: utf-8 -*-
# @File   :tasks.py
# @Time   :2025/6/2 11:07
# @Author :admin

from company_chat.celery_app import app
import time
from loguru import logger


# 添加一个简单的测试任务
@app.task
def chat_task():
    logger.info("Starting chat_task task...")
    try:
        logger.info("chat_task task completed successfully!")
        return "Success"
    except Exception as e:
        logger.info(f"chat_task task failed: {str(e)}")
        raise

