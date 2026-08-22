# -*- coding: utf-8 -*-
"""发票二维码扫描工具

从票据图片中解码二维码（优先 OpenCV，其次 pyzbar），
并从二维码原文中尽力解析发票号码/金额/开票日期等字段。

注意：本模块顶层不导入第三方库，cv2 / pyzbar 均采用惰性导入，
避免服务器缺少对应依赖时导致整个模块导入失败。
"""
import re
import io


def _decode_cv2(image_data):
    """OpenCV QRCodeDetector 解码（opencv-contrib-python 自带）

    对原图、放大图、灰度/对比度增强、CLAHE 增强多版本分别检测，
    提升小二维码、低对比度、模糊发票的识别率。
    """
    try:
        import cv2
        import numpy as np
    except Exception:
        return []
    try:
        arr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return []
        det = cv2.QRCodeDetector()

        def _try(im, use_multi=True):
            found = []
            try:
                data, _, _ = det.detectAndDecode(im)
                if data and data.strip():
                    found.append(data.strip())
            except Exception:
                pass
            if use_multi:
                try:
                    ok, decoded, _, _ = det.detectAndDecodeMulti(im)
                    if ok:
                        for d in decoded or []:
                            if d and d.strip() and d.strip() not in found:
                                found.append(d.strip())
                except Exception:
                    pass
            return found

        results = []
        # 1) 原图
        results.extend(_try(img))
        # 2) 放大 2x / 3x（小二维码更容易被检测到）
        for scale in (2, 3):
            try:
                big = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                results.extend(_try(big, use_multi=(scale == 2)))
            except Exception:
                pass
        # 3) 灰度 + 线性对比度增强
        try:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            contrast = cv2.convertScaleAbs(gray, alpha=1.6, beta=0)
            results.extend(_try(cv2.cvtColor(contrast, cv2.COLOR_GRAY2BGR)))
        except Exception:
            pass
        # 4) CLAHE 自适应直方图均衡（改善光照不均）
        try:
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            enh = clahe.apply(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
            results.extend(_try(cv2.cvtColor(enh, cv2.COLOR_GRAY2BGR)))
        except Exception:
            pass

        # 去重保序
        seen = set()
        out = []
        for r in results:
            if r and r not in seen:
                seen.add(r)
                out.append(r)
        return out
    except Exception:
        return []


def _decode_pyzbar(image_data):
    """pyzbar 解码（若已安装）；对小图先放大再解码"""
    try:
        from pyzbar.pyzbar import decode
        from PIL import Image
    except Exception:
        return []
    try:
        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        w, h = img.size
        variants = [img]
        # 图像较小时放大，提升小二维码识别率
        if min(w, h) < 900:
            variants.append(img.resize((w * 2, h * 2), Image.LANCZOS))
            variants.append(img.resize((w * 3, h * 3), Image.LANCZOS))
        results = []
        for v in variants:
            for obj in decode(v):
                data = obj.data.decode('utf-8', errors='ignore').strip()
                if data and data not in results:
                    results.append(data)
            if results:
                break
        return results
    except Exception:
        return []


def scan_qr_strings(image_data):
    """返回二维码原文列表；优先 OpenCV，其次 pyzbar"""
    results = _decode_cv2(image_data)
    if not results:
        results = _decode_pyzbar(image_data)
    return results


_QR_NUMBER_RE = re.compile(r'(?:发票号码|号码)\s*[:：]?\s*(\d{8,20})')
_QR_AMOUNT_RE = re.compile(
    r'(?:价税合计|小写|金额|开票金额)\s*[:：]?\s*[¥￥]?\s*'
    r'(\d{1,10}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,10}(?:\.\d{1,2})?)')
_QR_DATE_RE = re.compile(r'(?:开票日期|日期)\s*[:：]?\s*(\d{4})[-年./]?(\d{1,2})[-月./]?(\d{1,2})')
_QR_VERIFY_RE = re.compile(r'(?:校验码|效验码)\s*[:：]?\s*([0-9A-Za-z]{4,})')
_QR_PLAIN_NUM = re.compile(r'\b(\d{8,20})\b')
_DATE_RE = re.compile(r'(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?')

def _parse_csv_qr_fields(qr_string):
    """解析增值税电子发票二维码的逗号分隔格式：
    '01,31,,发票号码(约20位),开票金额,开票日期(YYYYMMDD),,校验码'
    先定位发票号码（全数字、长度12-25，排除8位日期与短代码），
    其后依次为金额、日期，再往后（可能隔空位）为校验码。
    """
    parts = [p.strip() for p in qr_string.split(',')]
    fields = {}
    num_idx = -1
    for i, p in enumerate(parts):
        if p.isdigit() and 12 <= len(p) <= 25:
            num_idx = i
            break
    if num_idx == -1:
        return fields
    fields['invoice_number'] = parts[num_idx]
    # 紧接着的是开票金额
    if num_idx + 1 < len(parts):
        amt = parts[num_idx + 1].replace('¥', '').replace('￥', '').replace(',', '')
        if re.match(r'^\d+(\.\d{1,2})?$', amt):
            fields['invoice_amount'] = amt
    # 再接着是开票日期（YYYYMMDD）
    if num_idx + 2 < len(parts):
        d = parts[num_idx + 2]
        if re.match(r'^\d{8}$', d):
            fields['invoice_date'] = '%s-%s-%s' % (d[0:4], d[4:6], d[6:8])
        elif re.match(r'^\d{4}[-年./]\d{1,2}[-月./]\d{1,2}[-日./]$', d):
            m = _DATE_RE.match(d)
            if m:
                fields['invoice_date'] = '%s-%s-%s' % (m.group(1), m.group(2).zfill(2), m.group(3).zfill(2))
    # 校验码：日期之后（可能隔一个空位）的第一个非空段
    for k in range(num_idx + 3, len(parts)):
        if parts[k]:
            fields['verify_code'] = parts[k]
            break
    return fields


def _parse_label_qr_fields(qr_string):
    """解析带标签的文本格式（发票号码:xxx, 金额:xxx, ...）"""
    fields = {}
    m = _QR_NUMBER_RE.search(qr_string)
    if m:
        fields['invoice_number'] = m.group(1)
    m = _QR_VERIFY_RE.search(qr_string)
    if m:
        fields['verify_code'] = m.group(1)
    m = _QR_AMOUNT_RE.search(qr_string)
    if m:
        fields['invoice_amount'] = m.group(1).replace(',', '')
    m = _QR_DATE_RE.search(qr_string)
    if m:
        fields['invoice_date'] = '%s-%s-%s' % (m.group(1), m.group(2).zfill(2), m.group(3).zfill(2))
    # 兜底：若未解析出发票号码，取最长的一串纯数字作为候选
    if not fields.get('invoice_number'):
        nums = sorted(set(_QR_PLAIN_NUM.findall(qr_string)), key=lambda x: len(x), reverse=True)
        if nums:
            fields['invoice_number'] = nums[0]
    return fields


def parse_qr_fields(qr_string):
    """从二维码原文中尽力解析发票字段；二维码格式多样，解析不到则留空

    优先解析逗号分隔格式（01,31,,发票号码,金额,日期,,校验码），
    未命中再回退到带标签的文本格式。
    """
    if not qr_string:
        return {}
    fields = _parse_csv_qr_fields(qr_string)
    if not fields.get('invoice_number'):
        fields = _parse_label_qr_fields(qr_string)
    return fields


if __name__ == '__main__':
    image_path = r'G:\Users\zy\Pictures\test\8af264f4728e4288a86d02f2edb17cf9.png'

    image_path = r'G:\Users\zy\Pictures\test\46ba563076864f9c93ab906c8ced8a73.png'
    image_path = r'G:\Users\zy\Pictures\test\fce30c8a-0a9f-44a4-b787-57f0b7922a19.png'
    image_path = r'G:\Users\zy\Pictures\test\9bd15cd6-0e1e-4f44-850b-8281f82c8837.png'

    image_path = r'G:\Users\zy\Pictures\test\46ba563076864f9c93ab906c8ced8a73.png'

    image_path = r'G:\Users\zy\Pictures\test\53ad8b88f12446ddacb86dd6f95a7bce.png'
    # image_path = r'G:\Users\zy\Pictures\my\b71243910f8c4705b5fa1117d99c985b.jpeg'
    image_data = open(image_path, 'rb').read()
    qr_strings = scan_qr_strings(image_data)
    print(qr_strings)
    if qr_strings:
        parsed = parse_qr_fields(qr_strings[0])
        print(parsed)