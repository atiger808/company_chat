# -*- coding: utf-8 -*-
"""PaddleOCR 票据识别工具

使用 PaddleOCR（paddlepaddle）本地识别发票票据文字，
解析出票据代码、发票号码、开票金额、开票日期、开票主体等核心数据。
兼容 PaddleOCR 2.x / 3.x API：
  2.x: PaddleOCR(use_angle_cls=True, lang='ch', show_log=False) + ocr(img, cls=True)
  3.x: PaddleOCR(lang='ch') + predict(img)（返回 OCRResult，含 rec_texts）
未安装时抛出异常，由上层返回友好提示（前端可回退到手动填写）。
"""
import os
import tempfile
import threading

from loguru import logger

_ocr_lock = threading.Lock()
_paddle_ocr = None
_paddle_major = None


def _get_paddle_major():
    global _paddle_major
    if _paddle_major is None:
        try:
            import paddleocr
            _paddle_major = int(str(paddleocr.__version__).split('.')[0])
        except Exception:
            _paddle_major = 2
    return _paddle_major


def _build_ocr_with_fallback(paddleocr_cls, kwargs):
    """带参数兼容回退地创建 PaddleOCR 实例：个别版本不接受部分参数时逐个降级"""
    ordered_keys = (
        'text_det_limit_type', 'text_det_limit_side_len', 'enable_mkldnn',
        'use_doc_orientation_classify', 'use_doc_unwarping', 'use_textline_orientation',
    )
    try:
        return paddleocr_cls(**kwargs)
    except TypeError:
        pass
    current = dict(kwargs)
    for key in ordered_keys:
        if key in current:
            candidate = dict(current)
            candidate.pop(key)
            try:
                return paddleocr_cls(**candidate)
            except TypeError:
                continue
    # 最后兜底：仅 lang
    return paddleocr_cls(lang='ch')


def _get_ocr():
    global _paddle_ocr
    if _paddle_ocr is None:
        with _ocr_lock:
            if _paddle_ocr is None:
                try:
                    from paddleocr import PaddleOCR
                except ImportError:
                    raise RuntimeError('服务器未安装 paddleocr，请先执行 pip install paddleocr 或改用百度OCR')
                # 跳过每次初始化时的模型源连通性检查，避免额外网络耗时
                os.environ.setdefault('PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK', 'True')
                if _get_paddle_major() >= 3:
                    # PaddleOCR 3.x：不再支持 use_angle_cls / show_log，使用统一 API
                    kwargs = dict(
                        lang='ch',
                        use_doc_orientation_classify=False,
                        use_doc_unwarping=False,
                        use_textline_orientation=False,
                        # 限制检测图最大边长，避免高分辨率发票图片 OOM
                        text_det_limit_type='max',
                        text_det_limit_side_len=960,
                    )
                    # PaddlePaddle 3.3.0+ 存在 oneDNN/PIR 兼容性 bug（CPU 推理报
                    # ConvertPirAttribute2RuntimeAttribute not support），需关闭 MKLDNN。
                    # 注意 FLAGS_use_mkldnn=0 环境变量对 PaddleX 无效，必须显式传参。
                    try:
                        import paddle
                        ver = tuple(int(x) for x in str(paddle.__version__).split('.')[:2])
                    except Exception:
                        ver = (3, 3)
                    if ver >= (3, 3):
                        kwargs['enable_mkldnn'] = False
                    _paddle_ocr = _build_ocr_with_fallback(PaddleOCR, kwargs)
                else:
                    _paddle_ocr = PaddleOCR(use_angle_cls=True, lang='ch', show_log=False)
    return _paddle_ocr


def _extract_words(result):
    """兼容 PaddleOCR 2.x / 3.x 的返回结构，提取文本行"""
    words = []
    seen = set()

    def collect(node):
        if node is None:
            return
        nid = id(node)
        if nid in seen:
            return
        seen.add(nid)
        if isinstance(node, dict) or hasattr(node, 'get'):
            local = []
            try:
                for key in ('rec_texts', 'text'):
                    vals = node.get(key)
                    if vals is not None:
                        if isinstance(vals, str):
                            if vals.strip():
                                local.append(vals.strip())
                        else:
                            for t in vals:
                                if t is not None and str(t).strip():
                                    local.append(str(t).strip())
            except Exception:
                pass
            if local:
                words.extend(local)
                return
            # 递归查找包装结构（如 OCRResult 的 {res: {rec_texts: ...}}）
            if isinstance(node, dict):
                for v in node.values():
                    collect(v)
            return
        if isinstance(node, (list, tuple)):
            for item in node:
                collect(item)
        elif isinstance(node, str):
            t = node.strip()
            if t:
                words.append(t)

    collect(result)
    # 2.x 兜底：[[box, (text, conf)], ...] 结构
    if not words and isinstance(result, list):
        for item in result:
            if (isinstance(item, (list, tuple)) and len(item) >= 2
                    and isinstance(item[1], (list, tuple)) and item[1]):
                t = item[1][0]
                if isinstance(t, str) and t.strip():
                    words.append(t.strip())
    return words


def _is_pdf(data):
    """判断二进制是否为 PDF 文件"""
    if not data:
        return False
    head = data[:8].lstrip(b'\x00\xff\xfe\xef\xbb\xbf ')
    return head.startswith(b'%PDF')


def _pdf_to_images(image_data, max_pages=5, zoom=2.0):
    """将 PDF 二进制渲染为图片列表（numpy BGR 数组，适配 PaddleOCR/OpenCV）

    依次尝试 PyMuPDF(fitz) / pypdfium2 / pdf2image，均不可用则抛错。
    """
    import numpy as np

    # 方式一：PyMuPDF（推荐，单包、无系统依赖）
    try:
        import fitz
        doc = fitz.open(stream=image_data, filetype='pdf')
        images = []
        for i in range(min(doc.page_count, max_pages)):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            if pix.n >= 3:
                img = img[:, :, :3][:, :, ::-1]  # RGB -> BGR
            images.append(np.ascontiguousarray(img))
        doc.close()
        if images:
            return images
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f'PyMuPDF 渲染 PDF 失败: {e}')

    # 方式二：pypdfium2（纯 wheel，无系统依赖）
    try:
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(image_data)
        images = []
        for i in range(min(len(pdf), max_pages)):
            page = pdf[i]
            pil = page.render(scale=zoom).to_pil()
            arr = np.array(pil)
            if arr.ndim == 3:
                arr = arr[:, :, ::-1]  # RGB -> BGR
            images.append(np.ascontiguousarray(arr))
        pdf.close()
        if images:
            return images
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f'pypdfium2 渲染 PDF 失败: {e}')

    # 方式三：pdf2image（需系统安装 poppler）
    try:
        from pdf2image import convert_from_bytes
        imgs = convert_from_bytes(image_data)
        images = []
        for pil in imgs[:max_pages]:
            arr = np.array(pil)
            if arr.ndim == 3:
                arr = arr[:, :, ::-1]
            images.append(np.ascontiguousarray(arr))
        if images:
            return images
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f'pdf2image 渲染 PDF 失败: {e}')

    raise RuntimeError('无法解析 PDF：服务器未安装 PyMuPDF/pypdfium2/pdf2image，请安装其一（推荐 PyMuPDF）或改用图片识别')


def recognize_paddle(image_data):
    """PaddleOCR 识别发票（支持图片/PDF），PDF 先转图片再识别，返回解析字段 dict，失败返回 None"""
    from .baidu_ocr import _parse_invoice
    if not image_data:
        return None
    ocr = _get_ocr()
    tmp_path = None
    try:
        # PDF：先转图片再逐页识别
        if _is_pdf(image_data):
            images = _pdf_to_images(image_data)
            words = []
            for img in images:
                if _get_paddle_major() >= 3:
                    result = ocr.predict(img)
                else:
                    result = ocr.ocr(img, cls=True)
                words.extend(_extract_words(result))
            logger.info(f"paddle_ocr_pdf_pages: {len(images)} words: {len(words)}")
            if not words:
                return None
            return _parse_invoice(words)

        # 图片：写临时文件识别
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            tmp.write(image_data)
            tmp.flush()
            tmp_path = tmp.name
        if _get_paddle_major() >= 3:
            result = ocr.predict(tmp_path)
        else:
            result = ocr.ocr(tmp_path, cls=True)
        words = _extract_words(result)
        logger.info(f"paddle_ocr_words_count: {len(words)} words：{words}")
        if not words:
            return None
        return _parse_invoice(words)
    except RuntimeError:
        raise
    except Exception as e:
        logger.warning(f'PaddleOCR 识别失败: {e}')
        raise
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


