# -*- coding: utf-8 -*-
"""cloud 应用信号：上传的表格(xlsx/xlsm)自动投递 LibreOffice 兼容清洗任务"""
from loguru import logger


def auto_schedule_spreadsheet_clean(sender, instance, created, **kwargs):
    """CloudFile 保存后若已落盘且为表格，则后台自动检测/清洗私有图片公式。

    - 文件字节真正写盘（file.save(save=True) 触发的 update）后才调度；
    - 转换完成/无需转换后状态落缓存，后续保存（含 OnlyOffice 自动保存）秒跳过；
    - 正在清洗时（持锁）不会重复投递。
    """
    try:
        if getattr(instance, '_no_autoclean', False):
            return
        if not instance.file or not instance.file.name:
            return
        name = instance.name or instance.original_name or ''
        ext = name.lower().rsplit('.', 1)[-1] if '.' in name else ''
        if ext not in ('xlsx', 'xlsm', 'xls'):
            return
        from utils.office_clean import schedule_clean
        schedule_clean(str(instance.id), force=False)
    except Exception as e:
        logger.debug(f'自动投递表格清洗跳过: {e}')
