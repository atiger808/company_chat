# -*- coding: utf-8 -*-
# @File   :utils.py
# @Time   :2026/4/13 14:22
# @Author :admin

from .models import Message, SystemConfig
from django.utils import timezone
from django.db import close_old_connections
from django.conf import settings

from datetime import datetime, timedelta
import os
from loguru import logger


def schedule_message():
    """
    :return:
    """
    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    close_old_connections()

    message_retention_days = SystemConfig.objects.filter(key='chat.message_retention_days').first()
    if message_retention_days:
        last_days = message_retention_days.value
        last_days = int(last_days)
    else:
        last_days = settings.KEEP_DAYS

    if last_days <= 0:
        return

    last_days_start = today_start - timedelta(days=last_days)

    all_message = Message.objects.filter(timestamp__lt=last_days_start)

    logger.info(f'last_days_start: {last_days_start} last_days: {last_days} count: {all_message.count()}')

    for message in all_message:
        try:
            file_obj = message.file
            if file_obj:
                file = file_obj.file
                file_path = file.path if file else None
                if file_path and os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        # pass
                    except Exception as e:
                        logger.error(f'error: {e}')

                mp3_file = file_obj.mp3_file
                mp3_file_path = mp3_file.path if mp3_file else None
                if mp3_file_path and os.path.exists(mp3_file_path):
                    try:
                        os.remove(mp3_file_path)
                        # pass
                    except Exception as e:
                        logger.error(f'error: {e}')
                try:
                    file_obj.delete()
                except Exception as e:
                    logger.error(f'error: {e}')
            message.delete()
        except Exception as e:
            logger.error(f'error: {e}')

