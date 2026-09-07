# -*- coding: utf-8 -*-
# utils/office_clean.py
"""
Excel(WPS/新版 Excel)「单元格内图片」兼容清洗工具
==================================================
背景：WPS / 新版 Microsoft Excel 会把图片嵌入单元格，并写入私有公式（如
`=DISPIMG("ID_xxx",1)`）。OnlyOffice 在线编辑无法解析这类厂商私有格式，
导致用户在网盘上传含此类图片的 .xlsx 后，在线打开图片位置显示为公式字符串。

方案：文件上传后（或用户手动触发「转换为兼容格式」）在后台异步用 LibreOffice
命令行将文件「清洗并另存」为标准 OpenXML(xlsx)。LibreOffice 转换时会把这类
私有结构降级/转换为 OnlyOffice 可识别的标准格式。

说明：
- 仅在检测到私有图片公式（DISPIMG 等）时才真正调用 LibreOffice，普通干净表格
  只做一次轻量 zip 扫描即跳过，避免无谓开销。
- 清洗由 Celery 异步执行（cloud.tasks.clean_xlsx_async），避免大文件(上万图片)
  转换阻塞 Web 上传请求。
- 服务器需安装 LibreOffice/soffice，可通过环境变量 LIBREOFFICE_BIN 指定路径，
  否则自动探测 libreoffice / soffice。
"""
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile

from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from loguru import logger

SPREADSHEET_EXTS = {'.xlsx', '.xlsm', '.xls'}

# 私有“单元格内图片”公式特征（大小写不敏感，WPS 与新版 Excel 通用）
_PRIVATE_PATTERN = re.compile(r'(?:DISPIMG|_xlfn\.DISPIMG|WEBSERVICE\(|_xlfn\._xlws\.)', re.IGNORECASE)
# 需要扫描的 zip 内部 xml（工作簿/工作表/共享字符串，公式通常落在这里）
_ZIP_SCAN_MEMBERS = ('xl/worksheets/', 'xl/sharedStrings.xml', 'xl/workbook.xml')


def state_key(file_id):
    return f'office_clean:state:{file_id}'


def lock_key(file_id):
    return f'office_clean:lock:{file_id}'


def get_state(file_id):
    val = cache.get(state_key(str(file_id)))
    return val if isinstance(val, dict) else {'state': 'unknown'}


def set_state(file_id, **kw):
    data = {'state': 'pending', 'ts': int(time.time())}
    data.update(kw)
    cache.set(state_key(str(file_id)), data, 60 * 60 * 24 * 30)  # 30 天
    return data


def is_spreadsheet(filename):
    ext = os.path.splitext(filename or '')[1].lower()
    return ext in SPREADSHEET_EXTS


def _is_ooxml(filename):
    return os.path.splitext(filename or '')[1].lower() in ('.xlsx', '.xlsm')


def has_private_picture_formula(path):
    """轻量扫描 xlsx/xlsm 内部 sheet xml，判断是否含 DISPIMG 等私有图片公式。
    仅对 zip(OOXML) 生效；旧 .xls 二进制直接返回 True 交给 LibreOffice 兜底。"""
    if not path or not os.path.exists(path):
        return False
    try:
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if not name.lower().startswith(_ZIP_SCAN_MEMBERS):
                    continue
                try:
                    chunk = zf.read(name)
                except Exception:
                    continue
                if isinstance(chunk, bytes):
                    # zip 内 utf-8 / utf-16 混存，先按字节找 ASCII 特征
                    if b'DISPIMG' in chunk.upper():
                        return True
                text = chunk.decode('utf-8', 'ignore') if isinstance(chunk, bytes) else str(chunk)
                if _PRIVATE_PATTERN.search(text):
                    return True
    except zipfile.BadZipFile:
        # 不是 zip(如旧 xls)：交给 LibreOffice 转换尝试
        return True
    except Exception as e:
        logger.warning(f'扫描表格私有图片公式失败: {e}')
        return True
    return False


# 单元格含 DISPIMG 等私有公式 → 把整个 <c> 置空（保留列/行坐标与样式），
# 保证 OnlyOffice 不再把公式当文本显示（LibreOffice 并不认识 DISPIMG，重存常会原样保留）
_DISPIMG_CELL_RE = re.compile(
    r'(<c\b[^>]*>)(?:(?!</c\b).)*?DISPIMG(?:(?!</c\b).)*?</c>',
    re.IGNORECASE | re.DOTALL,
)


def strip_dispimg_formulas(xlsx_bytes):
    """直接对 OOXML(xlsx) 做 XML 级 DISPIMG 公式清除。

    适用于 LibreOffice 转换后仍残留 =DISPIMG(...) 的情况：
    把含 DISPIMG 的 <c> 单元格整体置空（坐标/样式保留），OnlyOffice 不再显示该公式串。
    返回 (清洗后的字节, 是否有改动)。
    """
    try:
        import io as _io
        with zipfile.ZipFile(_io.BytesIO(xlsx_bytes)) as zf:
            entries = {}
            for n in zf.namelist():
                entries[n] = zf.read(n)
    except Exception as e:
        logger.warning(f'解包 xlsx 失败(跳过 DISPIMG 清除): {e}')
        return xlsx_bytes, False

    changed = False

    def _blank_cell(m):
        # '<c r="A1" s="1" t="str">...' → '<c r="A1" s="1" />'（保留坐标/样式）
        return m.group(1)[:-1] + '/>'

    for name, data in list(entries.items()):
        if not (name.lower().startswith('xl/worksheets/') and name.lower().endswith('.xml')):
            continue
        text = data.decode('utf-8', 'ignore')
        new_text, n = _DISPIMG_CELL_RE.subn(_blank_cell, text)
        if n:
            changed = True
            entries[name] = new_text.encode('utf-8')
            logger.info(f'DISPIMG 公式清除: {name} 命中 {n} 个单元格')

    if not changed:
        return xlsx_bytes, False

    buf = _io.BytesIO()
    try:
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zo:
            for name, data in entries.items():
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                zo.writestr(info, data)
    except Exception as e:
        logger.warning(f'重打包 xlsx 失败(保留原文件): {e}')
        return xlsx_bytes, False
    return buf.getvalue(), True


def libreoffice_available():
    return bool(_find_libreoffice_bin())


def _find_libreoffice_bin():
    configured = getattr(settings, 'LIBREOFFICE_BIN', '') or ''
    candidates = [configured] if configured else []
    candidates += ['libreoffice', 'soffice']
    for name in candidates:
        if os.path.isabs(name) and os.path.exists(name):
            return name
        found = shutil.which(name)
        if found:
            return found
    return ''


def libreoffice_convert_to_xlsx(src_path, out_dir, timeout=None):
    """调用 LibreOffice 无头将文件转为标准 xlsx，返回输出文件绝对路径；失败返回 None。"""
    bin_path = _find_libreoffice_bin()
    if not bin_path:
        raise RuntimeError('未找到 LibreOffice/soffice，请安装或配置 LIBREOFFICE_BIN')
    if timeout is None:
        timeout = getattr(settings, 'OFFICE_CONVERT_TIMEOUT', 1800)
    # 避免用户配置文件干扰转换
    profile_dir = tempfile.mkdtemp(prefix='lo_profile_')
    cmd = [
        bin_path, '--headless', '--norestore', '--nologo', '--invisible',
        '-env:UserInstallation=file://' + profile_dir.replace(os.sep, '/'),
        '--convert-to', 'xlsx:Calc MS Excel 2007 XML',
        '--outdir', out_dir, src_path,
    ]
    try:
        logger.info(f'LibreOffice 清洗开始: {os.path.basename(src_path)}')
        proc = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, cwd=out_dir,
        )
        if proc.returncode != 0:
            logger.warning(f'LibreOffice 转换失败 rc={proc.returncode} stderr={proc.stderr[:500]}')
            return None
        base = os.path.splitext(os.path.basename(src_path))[0]
        out_candidate = os.path.join(out_dir, base + '.xlsx')
        if not os.path.exists(out_candidate):
            # LO 可能保留原扩展名输出（xlsm → xlsm）
            out_candidate = os.path.join(out_dir, os.path.basename(src_path))
        return out_candidate if os.path.exists(out_candidate) else None
    except subprocess.TimeoutExpired:
        logger.warning('LibreOffice 转换超时')
        return None
    except Exception as e:
        logger.warning(f'LibreOffice 执行异常: {e}')
        return None
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)


def save_compat_copy(cloud_file, new_bytes):
    """把清洗后的兼容字节另存为 CloudFile.compat_file（原始文件 file 保持不变）。"""
    if not cloud_file or not new_bytes:
        return False
    try:
        base = (cloud_file.name or cloud_file.original_name or 'file')
        stem = os.path.splitext(base)[0]
        cloud_file.compat_file.save(f'{stem}__compat.xlsx', ContentFile(new_bytes), save=False)
        cloud_file.compat_ready = True
        cloud_file.save(update_fields=['compat_file', 'compat_ready', 'updated_at'])
        return True
    except Exception as e:
        logger.error(f'保存兼容副本失败: {e}')
        return False


def _produce_compat_bytes(src_path, force):
    """生成兼容 xlsx 字节：LibreOffice 转换 + DISPIMG XML 清除双保险；
    返回 (bytes | None, detail dict)。"""
    import os as _os
    detail = {'lo_available': libreoffice_available()}
    out_dir = tempfile.mkdtemp(prefix='office_clean_')
    try:
        produced = libreoffice_convert_to_xlsx(src_path, out_dir) if libreoffice_available() else None
        if produced and _os.path.exists(produced):
            with open(produced, 'rb') as f:
                data = f.read()
            detail['mode'] = 'libreoffice'
            data, stripped = strip_dispimg_formulas(data)
            detail['dispimg_stripped'] = stripped
            if len(data) < 512:
                detail['reason'] = 'output_too_small'
                return None, detail
            return data, detail

        # LibreOffice 缺失/失败：仅手动强制时才退化为 XML 级 DISPIMG 清除副本
        if force:
            with open(src_path, 'rb') as f:
                orig = f.read()
            data, stripped = strip_dispimg_formulas(orig)
            if stripped and len(data) >= 512:
                detail['mode'] = 'strip_only'
                return data, detail
        detail['reason'] = 'libreoffice_no_output'
        return None, detail
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


def clean_cloud_xlsx(cloud_file, force=False):
    """仅为 CloudFile 生成/刷新兼容副本 compat_file，原始 file 始终保持不变。
    返回 (success, status_dict)。"""
    fid = str(cloud_file.id)
    name = cloud_file.name or cloud_file.original_name or ''
    if not is_spreadsheet(name):
        return False, set_state(fid, state='skip', reason='not_spreadsheet')
    if not cloud_file.file or not cloud_file.file.name:
        return False, set_state(fid, state='skip', reason='no_file_stored')
    src = cloud_file.file.path
    if not src or not os.path.exists(src):
        return False, set_state(fid, state='error', reason='file_missing')

    new_bytes, detail = _produce_compat_bytes(src, force=bool(force))
    if new_bytes is None:
        return False, set_state(
            fid, state='error_nofile',
            reason=detail.get('reason', 'produce_failed'),
            **{k: v for k, v in detail.items() if k != 'reason'})

    before = 0
    try:
        if cloud_file.compat_file and cloud_file.compat_file.name:
            before = cloud_file.compat_file.size or 0
    except Exception:
        before = 0
    ok = save_compat_copy(cloud_file, new_bytes)
    if ok:
        detail['compat_before_size'] = before
        detail['compat_after_size'] = len(new_bytes)
        return True, set_state(fid, state='done', size=len(new_bytes), **detail)
    return False, set_state(fid, state='error', reason='write_compat_failed', **detail)


def schedule_clean(file_id, force=False):
    """投递 Celery 异步清洗任务（尽力而为，broker 不可用也不阻断业务）。"""
    fid = str(file_id)
    # 清洗任务进行中（持锁）则不再重复投递
    if cache.get(lock_key(fid)):
        return {'scheduled': False, 'state': 'running'}
    # 已清洗/无需清洗的文件：不重复投递
    if not force:
        cur = get_state(fid)
        if cur.get('state') in ('done', 'skip'):
            return {'scheduled': False, 'state': cur.get('state')}
    set_state(fid, state='pending', force=bool(force))
    try:
        from cloud.tasks import clean_xlsx_async
        clean_xlsx_async.delay(fid, force=bool(force))
        return {'scheduled': True, 'state': 'pending'}
    except Exception as e:
        logger.warning(f'投递表格清洗任务失败(broker 不可用?): {e}')
        set_state(fid, state='error_unavailable', reason=str(e)[:200])
        return {'scheduled': False, 'state': 'error_unavailable', 'error': str(e)}

