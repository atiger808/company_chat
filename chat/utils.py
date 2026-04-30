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
    清理超过保留天数的消息及其关联文件
    :return:
    """
    close_old_connections()

    # 获取消息保留天数配置
    try:
        config = SystemConfig.objects.filter(key='chat.message_retention_days').first()
        if config and config.value:
            last_days = int(config.value)
        else:
            last_days = settings.KEEP_DAYS
    except Exception as e:
        logger.error(f"获取消息保留天数配置失败: {e}")
        return

    if last_days <= 0:
        logger.info("消息保留天数小于等于0，跳过清理")
        return

    # 计算截止时间
    now = datetime.now()
    # today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = now
    cutoff_time = today_start - timedelta(days=last_days)

    # 查询需要清理的消息
    messages_to_delete = Message.objects.filter(timestamp__lt=cutoff_time)
    total_count = messages_to_delete.count()

    if total_count == 0:
        logger.info(f"无过期消息需要清理 (截止于: {cutoff_time})")
        return

    logger.info(f"开始清理过期消息 | 截止时间: {cutoff_time} | 保留天数: {last_days} | 总数: {total_count}")

    success_count = 0
    fail_count = 0

    for message in messages_to_delete:
        try:
            # 清理关联的文件对象
            file_obj = getattr(message, 'file', None)
            if file_obj:
                _delete_file_safe(file_obj.file)
                _delete_file_safe(file_obj.mp3_file)
                
                try:
                    file_obj.delete()
                except Exception as e:
                    logger.warning(f"删除文件记录失败 (ID: {file_obj.id}): {e}")

            # 删除消息本身
            message.delete()
            success_count += 1
        except Exception as e:
            logger.error(f"删除消息失败 (ID: {message.id}): {e}")
            fail_count += 1

    logger.info(f"清理完成 | 成功: {success_count} | 失败: {fail_count} | 总数: {total_count}")


def _delete_file_safe(file_field):
    """
    安全地删除物理文件
    :param file_field: Django FileField 实例
    """
    if not file_field:
        return
    
    try:
        file_path = file_field.path
        if file_path and os.path.exists(file_path):
            os.remove(file_path)
    except Exception as e:
        logger.error(f"删除物理文件失败: {e}")

