# -*- coding: utf-8 -*-
# @File   :utils.py
# @Time   :2026/4/13 14:22
# @Author :admin

from .models import Message
from django.utils import timezone
from django.db import close_old_connections
from django.conf import settings

from datetime import datetime, timedelta
import os
from loguru import logger


def schedule_message():
    """
    删除超过15天的聊天消息，包括文件消息
    :return:
    """
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    last_15_day_start = today_start - timedelta(days=settings.KEEP_DAYS)
    close_old_connections()
    all_message = Message.objects.filter(timestamp__lt=last_15_day_start)
    for message in all_message:
        try:
            file_obj = message.file
            file = file_obj.file
            file_path = file.path if file else None
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    logger.error(f'error: {e}')

            mp3_file = file_obj.mp3_file
            mp3_file_path = mp3_file.path if mp3_file else None
            if mp3_file_path and os.path.exists(mp3_file_path):
                try:
                    os.remove(mp3_file_path)
                except Exception as e:
                    logger.error(f'error: {e}')
            if file_obj:
                file_obj.delete()
            message.delete()
        except Exception as e:
            logger.error(f'error: {e}')

