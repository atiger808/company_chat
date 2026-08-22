# -*- coding: utf-8 -*-
# utils/avatar_utils.py
# 头像压缩工具：保留原图，对前端渲染用的头像做缩放/压缩，保证小尺寸快速加载
import io
import os

from django.core.files.base import ContentFile
from loguru import logger
from PIL import Image, ImageOps

MAX_DIM = 512       # 最长边像素（超过则缩放到该尺寸）
JPEG_QUALITY = 82   # JPEG 压缩质量
PNG_FORMATS = ('PNG', 'GIF', 'WEBP')  # 带透明度的格式，保留为 PNG


def compress_avatar(uploaded_file, max_dim=MAX_DIM, quality=JPEG_QUALITY):
    """压缩/缩放头像，返回压缩后的 ContentFile；失败返回 None（调用方回退原样保存）"""
    try:
        img = Image.open(uploaded_file)
        # 🔧 按 EXIF 方向矫正后再压缩：手机拍摄的竖图常带 Orientation 标签，
        # Pillow 默认不自动应用，直接缩放/保存会导致头像旋转 90°。
        img = ImageOps.exif_transpose(img)
        fmt = (img.format or 'JPEG').upper()
        if img.width > max_dim or img.height > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        out = io.BytesIO()
        if fmt in PNG_FORMATS:
            img.save(out, format='PNG', optimize=True)
            out_ext = '.png'
        else:
            img.convert('RGB').save(out, format='JPEG', quality=quality, optimize=True)
            out_ext = '.jpg'
        out.seek(0)
        base = os.path.splitext(os.path.basename(uploaded_file.name or 'avatar'))[0] or 'avatar'
        return ContentFile(out.read(), name=base + out_ext)
    except Exception as e:
        logger.warning(f'压缩头像失败: {e}')
        return None
