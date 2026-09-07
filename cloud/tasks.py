# -*- coding: utf-8 -*-
"""企业网盘异步任务：Excel 兼容格式清洗（LibreOffice 后台转换）"""
import time

from company_chat.celery_app import app
from django.core.cache import cache
from loguru import logger

from utils.office_clean import (
    clean_cloud_xlsx, lock_key, set_state, state_key, is_spreadsheet,
)


@app.task(bind=True, max_retries=1, default_retry_delay=5)
def clean_xlsx_async(self, file_id, force=False):
    """在后台用 LibreOffice 把 WPS/新版 Excel“单元格内图片”私有格式清洗为标准 xlsx。

    - 轻量检测到私有图片公式时才真正调用 LibreOffice（普通干净文件秒回 skip）；
    - 用缓存锁保证同一文件不会并发重复清洗；
    - 转换失败只记录状态，不影响原文件与业务流程。
    """
    fid = str(file_id)
    lock = cache.add(lock_key(fid), 1, 60 * 15)  # 15 分钟锁
    if not lock:
        logger.info(f'表格清洗任务已在执行，跳过重复投递: {fid}')
        return {'scheduled': False, 'reason': 'already_running'}
    try:
        from .models import CloudFile
        cf = CloudFile.objects.filter(id=fid, deleted_at__isnull=True).first()
        if not cf:
            return {'ok': False, 'reason': 'file_not_found'}
        if not is_spreadsheet(cf.name or cf.original_name or ''):
            set_state(fid, state='skip', reason='not_spreadsheet')
            return {'ok': False, 'reason': 'not_spreadsheet'}

        started = time.time()
        ok, status = clean_cloud_xlsx(cf, force=bool(force))
        status = status or {}
        logger.info(f'表格清洗完成: file={fid} ok={ok} state={status.get("state")} 耗时={time.time()-started:.1f}s')
        # 清理状态锁
        cache.delete(lock_key(fid))
        return {'ok': ok, 'state': status.get('state'), 'detail': status}
    except Exception as e:
        logger.error(f'表格清洗任务异常: file={fid} err={e}', exc_info=True)
        try:
            set_state(fid, state='error', reason=str(e)[:200])
        except Exception:
            pass
        cache.delete(lock_key(fid))
        return {'ok': False, 'reason': str(e)}
