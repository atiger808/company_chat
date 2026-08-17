# -*- coding: utf-8 -*-
"""百度OCR票据识别工具

调用百度通用文字识别(高精度版)接口识别发票票据，
解析出票据代码、开票金额、开票日期、开票主体等核心数据。
接口凭证通过 settings.BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY 配置，
未配置时抛出异常，由上层返回友好提示（前端可回退到手动填写）。
"""
import base64
import re
from loguru import logger
import requests

OCR_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
OCR_RECOGNIZE_URL = 'https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic'

# 金额格式：整数或两位小数
_AMOUNT_RE = re.compile(r'(?:￥|¥)?\s*(\d{1,10}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,10}(?:\.\d{1,2})?)\s*元?')
# 日期格式：2023年05月12日 / 2023-05-12 / 2023.05.12
_DATE_RE = re.compile(r'(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?')
# 发票号码 / 代码
_INV_NUMBER_RE = re.compile(r'发票号码\s*[:：]?\s*([A-Za-z0-9\-]{8,})')
_INV_CODE_RE = re.compile(r'(?:发票代码|票据代码|代码)\s*[:：]?\s*([A-Za-z0-9\-]{8,})')
_INV_NUM_RE = re.compile(r'\b(\d{8,20})\b')


def _get_access_token(api_key, secret_key):
    params = {
        'grant_type': 'client_credentials',
        'client_id': api_key,
        'client_secret': secret_key,
    }
    resp = requests.get(OCR_TOKEN_URL, params=params, timeout=10)
    data = resp.json()
    token = data.get('access_token')
    if not token:
        raise RuntimeError('获取百度OCR access_token 失败: %s' % data.get('error_description', data))
    return token


def recognize_invoice(image_data, api_key=None, secret_key=None):
    """识别发票图片/PDF二进制，返回解析字段 dict，解析失败返回 None"""
    from django.conf import settings
    import os
    api_key = api_key or getattr(settings, 'BAIDU_OCR_API_KEY', '') or os.environ.get('BAIDU_OCR_API_KEY', '')
    secret_key = secret_key or getattr(settings, 'BAIDU_OCR_SECRET_KEY', '') or os.environ.get('BAIDU_OCR_SECRET_KEY',
                                                                                               '')
    if not api_key or not secret_key:
        raise RuntimeError('未配置百度OCR API Key / Secret Key')
    token = _get_access_token(api_key, secret_key)
    url = '%s?access_token=%s' % (OCR_RECOGNIZE_URL, token)
    body = {'image': base64.b64encode(image_data).decode('utf-8')}
    resp = requests.post(url, headers={'Content-Type': 'application/x-www-form-urlencoded'}, data=body, timeout=30)
    data = resp.json()
    logger.info(f"baidu_ocr_data: {data}")
    if data.get('error_code'):
        raise RuntimeError('百度OCR返回错误: %s %s' % (data.get('error_code'), data.get('error_msg')))
    words = []
    for item in data.get('words_result', []) or []:
        w = (item.get('words') or '').strip()
        if w:
            words.append(w)
    if not words:
        return None
    result = _parse_invoice(words)
    # 保存调用百度接口识别返回的原始 JSON，便于后续追溯/复用
    result['raw_data'] = data
    return result


def _clean(text):
    return re.sub(r'\s+', '', text) if text else ''


def _normalize_date(value):
    """将 2023年05月12日 / 2023-05-12 等统一为 2023-05-12"""
    if not value:
        return ''
    m = _DATE_RE.search(str(value))
    if m:
        return '%s-%s-%s' % (m.group(1), m.group(2).zfill(2), m.group(3).zfill(2))
    return str(value).strip()


def recognize_vat_invoice(image_data, api_key=None, secret_key=None):
    """百度增值税发票识别（结构化返回发票号码/代码/金额/日期/销售方等）"""
    from django.conf import settings
    import os
    api_key = api_key or getattr(settings, 'BAIDU_OCR_API_KEY', '') or os.environ.get('BAIDU_OCR_API_KEY', '')
    secret_key = secret_key or getattr(settings, 'BAIDU_OCR_SECRET_KEY', '') or os.environ.get('BAIDU_OCR_SECRET_KEY',
                                                                                               '')
    if not api_key or not secret_key:
        raise RuntimeError('未配置百度OCR API Key / Secret Key')
    token = _get_access_token(api_key, secret_key)
    url = 'https://aip.baidubce.com/rest/2.0/ocr/v1/vat_invoice?access_token=%s' % token
    body = {'image': base64.b64encode(image_data).decode('utf-8'), 'accurate': 'true'}
    resp = requests.post(url, headers={'Content-Type': 'application/x-www-form-urlencoded'}, data=body, timeout=30)
    data = resp.json()
    logger.info(f"baidu_vat_invoice_data: {data}")
    if data.get('error_code'):
        raise RuntimeError('百度增值税发票识别返回错误: %s %s' % (data.get('error_code'), data.get('error_msg')))
    wr = data.get('words_result') or {}
    if isinstance(wr, dict):
        fields = wr
    else:
        # 兼容部分接口按列表返回 name/value 的结构
        fields = {}
        for item in wr:
            if isinstance(item, dict):
                key = item.get('name') or item.get('key') or ''
                val = item.get('value') or ''
                if key:
                    fields[key] = val

    def _pick(*keys):
        """取值兼容纯字符串与 'word' 列表（如 CommodityTaxRate=[{'row':'1','word':'13%'}]）"""
        for k in keys:
            v = fields.get(k)
            if v is None:
                continue
            if isinstance(v, list):
                if not v:
                    continue
                first = v[0]
                if isinstance(first, dict):
                    w = first.get('word') or first.get('value') or ''
                else:
                    w = first
                if w:
                    return str(w).strip()
                continue
            if str(v).strip():
                return str(v).strip()
        return ''

    invoice_type = _pick('InvoiceType', 'invoice_type', '发票类型')
    if invoice_type:
        invoice_type = _detect_invoice_type(invoice_type)
    seller_name = _pick('SellerName', 'seller_name', '销售方名称')
    result = _normalize_result({
        'invoice_type': invoice_type,
        'invoice_number': _pick('InvoiceNum', 'invoice_number', '发票号码'),
        'invoice_code': _pick('InvoiceCode', 'invoice_code', '发票代码'),
        'invoice_amount': _pick('AmountInFiguers', 'amount_in_figures', 'AmountInFigure', '价税合计', 'invoice_amount'),
        'invoice_date': _normalize_date(_pick('InvoiceDate', 'invoice_date', '开票日期')),
        'invoice_issuer': seller_name,
        'buyer_name': _pick('PurchaserName', 'purchaser_name', '购买方名称'),
        'buyer_tax_no': _pick('PurchaserRegisterNum', 'purchaser_register_num', '购买方纳税人识别号'),
        'seller_name': seller_name,
        'seller_tax_no': _pick('SellerRegisterNum', 'seller_register_num', '销售方纳税人识别号'),
        'tax_rate': _pick('TaxRate', 'tax_rate', '税率', 'CommodityTaxRate'),
        'drawer': _pick('Drawer', 'NoteDrawer', 'drawer', '开票人'),
    })
    # 保存调用百度接口识别返回的原始 JSON，便于后续追溯/复用
    result['raw_data'] = data
    return result


def verify_vat_invoice(api_key=None, secret_key=None,
                       invoice_code='', invoice_num='', invoice_date='',
                       invoice_type='', check_code='', total_amount=''):
    """百度增值税发票验真（参数化接口 vat_invoice_verification）。

    参考 百度增值税发票验真接口文档：以发票代码/号码/开票日期/种类 + 校验码/金额
    与税务系统交叉核验。返回 dict: {'result': 'pass'|'fail'|'error', 'message': str, 'data': {接口原始字段}}
      - pass: VerifyResult=0001（查验成功发票一致）且发票未作废/未红冲（InvalidSign=N）
      - fail: VerifyResult=0006/0009/1005/1006（发票信息不一致/发票不存在/查询不规范/查验异常）
              或发票已作废/红冲（InvalidSign=Y/H/BH/QH）
      - error: 其他错误码（0002 超当天查验次数/1014 当天不能查验/1015 超5年/1021 网络超时/
               9999 查验失败/1008 字段不能为空/1009 参数长度/1020 无查验权限/0005 请求不合法等）
    未配置百度 key / 网络异常时抛 RuntimeError，由上层返回友好提示。
    """
    from django.conf import settings
    import os
    api_key = api_key or getattr(settings, 'BAIDU_OCR_API_KEY', '') or os.environ.get('BAIDU_OCR_API_KEY', '')
    secret_key = secret_key or getattr(settings, 'BAIDU_OCR_SECRET_KEY', '') or os.environ.get('BAIDU_OCR_SECRET_KEY',
                                                                                               '')
    if not api_key or not secret_key:
        raise RuntimeError('未配置百度OCR API Key / Secret Key')
    token = _get_access_token(api_key, secret_key)
    url = 'https://aip.baidubce.com/rest/2.0/ocr/v1/vat_invoice_verification?access_token=%s' % token
    body = {
        'invoice_code': str(invoice_code or '').strip(),
        'invoice_num': str(invoice_num or '').strip(),
        # 开票日期统一为 YYYYMMDD
        'invoice_date': re.sub(r'[-/.]', '', str(invoice_date or '').strip()),
        'invoice_type': str(invoice_type or '').strip(),
        'check_code': str(check_code or '').strip()[-6:],
        'total_amount': str(total_amount or '').strip(),
    }
    try:
        resp = requests.post(url, headers={'Content-Type': 'application/x-www-form-urlencoded'},
                             data=body, timeout=30)
        data = resp.json()
    except Exception as e:
        raise RuntimeError('百度发票验真请求失败: %s' % e)
    logger.info(f"baidu_vat_invoice_verification_data: {data}")
    if data.get('error_code'):
        raise RuntimeError('百度发票验真返回错误: %s %s' % (data.get('error_code'), data.get('error_msg')))

    # 结果字段兼容顶层与 words_result 内（成功示例在 words_result 内，失败示例在顶层）
    def _pick_resp(*keys):
        for k in keys:
            v = data.get(k)
            if v not in (None, ''):
                return v
            wr = data.get('words_result')
            if isinstance(wr, dict):
                v2 = wr.get(k)
                if v2 not in (None, ''):
                    return v2
        return ''

    vr = str(_pick_resp('VerifyResult', 'verification_result', 'verify_result') or '').strip()
    vm = str(_pick_resp('VerifyMessage', 'verification_message', 'verify_message') or '').strip()
    inv_sign = str(_pick_resp('InvalidSign') or '').strip()

    # 发票状态：N=未作废；Y=已作废；H=已冲红；BH=部分红冲；QH=全额红冲
    status_bad = inv_sign in ('Y', 'H', 'BH', 'QH')
    message = vm or vr or '验真无明确结果'

    if vr == '0001':
        # 查验成功发票一致，但需确认发票状态未被作废/红冲
        if status_bad:
            result = 'fail'
            message = f'发票已作废/红冲（{inv_sign}），不予通过' if not message else f'{message}（发票状态：{inv_sign}，已作废/红冲）'
        else:
            result = 'pass'
    elif vr in ('0006', '0009', '1005', '1006'):
        # 发票信息不一致 / 发票不存在 / 查询发票不规范 / 查验异常 → 认定为不真实/异常
        result = 'fail'
    else:
        # 0002/1014/1015/1021/9999/1008/1009/1020/0005 等 → 无法查验/参数/权限问题
        result = 'error'
        if not message:
            message = '无法查验该发票'
    return {'result': result, 'message': str(message)[:500], 'data': data}


_TAX_NO_RE = re.compile(r'纳税人识别号\s*[:：]?\s*([0-9A-Za-z]{14,22})')
_DRAWER_RE = re.compile(r'开票人\s*[:：]?\s*([^\s,，;；]{1,20})')
_TAX_RATE_RE = re.compile(r'-?\d+(?:\.\d+)?%')


def _extract_tax_no(seg):
    m = _TAX_NO_RE.findall(seg)
    return m


def _extract_party(seg):
    """从一段紧凑文本（购买方/销售方区块）中提取 名称 与 纳税人识别号"""
    name = ''
    m = re.search(r'名称\s*[:：]?\s*(.*?)(?=纳税人识别号|$)', seg)
    if m:
        name = m.group(1).strip(' ：:　\n\r\t')
        # 名称后紧跟的常见分隔符处截断
        name = re.split(r'(?:纳税人识别号|\d{6,}|发票号码|地址|开户行|电话|销售方|购买方)', name)[0].strip(' ：:　')
    tax = ''
    m = _TAX_NO_RE.search(seg)
    if m:
        tax = m.group(1)
    return name, tax


def _ectract_tax_rate(words):
    index = 0
    for seg in words:
        if '税率/征收率' in seg or '税率' in seg or '征收率' in seg:
            index = words.index(seg)
            break
    for seg in words[index:]:
        m = _TAX_RATE_RE.search(seg)
        if m:
            return m.group(0)
    return ''


def _detect_invoice_type(text):
    """从文本中检测发票类型：special 专用发票 / ordinary 普通发票 / unsupported 其他类型 / 未知空"""
    if not text:
        return ''
    if '专用发票' in text or '增值税专用' in text or '电子发票（专用' in text:
        return 'special'
    if '普通发票' in text or '增值税普通' in text or '电子发票（普通' in text or '晋通发票' in text or '电子发票（晋通' in text:
        return 'ordinary'
    # 非增值税发票的常见类型关键词（在确认不是专用/普通后才判断）
    unsupported = ('定额发票', '通用机打发票', '火车票', '出租车', '客运发票', '通行费', '过路过桥', '收据', '银行回单')
    if any(k in text for k in unsupported):
        return 'unsupported'
    return ''


def _normalize_result(result):
    """统一识别结果字段，保证各识别引擎返回一致的键集合"""
    base = {
        'invoice_type': '', 'invoice_number': '', 'invoice_code': '',
        'invoice_amount': '', 'invoice_date': '', 'invoice_issuer': '',
        'buyer_name': '', 'buyer_tax_no': '', 'seller_name': '', 'seller_tax_no': '',
        'tax_rate': '', 'drawer': '',
    }
    base.update({k: (v or '') for k, v in (result or {}).items()})
    if not base['invoice_issuer'] and base['seller_name']:
        base['invoice_issuer'] = base['seller_name']
    if not base['invoice_type']:
        base['invoice_type'] = _detect_invoice_type(base.get('invoice_issuer', '') + ' ' +
                                                    base.get('buyer_name', '') + ' ' + base.get('seller_name', ''))
    return base


def _parse_invoice(words):
    """从OCR文本行中解析发票核心字段（增值税发票版式）"""
    full_text = ''.join(words)
    compact = _clean(full_text)
    result = {
        'invoice_type': '', 'invoice_number': '', 'invoice_code': '',
        'invoice_amount': '', 'invoice_date': '', 'invoice_issuer': '',
        'buyer_name': '', 'buyer_tax_no': '', 'seller_name': '', 'seller_tax_no': '',
        'tax_rate': '', 'drawer': '',
    }

    # 发票类型
    result['invoice_type'] = _detect_invoice_type(full_text)

    # 税率
    result['tax_rate'] = _ectract_tax_rate(words)

    # 开票人
    m = _DRAWER_RE.search(full_text)
    if m:
        drawer = m.group(1).strip(' ：:　').strip().strip('<')
        if '<' in drawer:
            drawer = drawer.split('<')[0]
        result['drawer'] = drawer

    # 发票号码
    m = _INV_NUMBER_RE.search(full_text)
    if m:
        result['invoice_number'] = m.group(1)
    # 发票代码 / 票据代码
    m = _INV_CODE_RE.search(full_text)
    if m:
        result['invoice_code'] = m.group(1)
    elif not result['invoice_number']:
        # 兜底：取文本中最长的一串纯数字（代码通常为12/20位）
        nums = sorted(set(_INV_NUM_RE.findall(full_text)), key=lambda x: len(x), reverse=True)
        if nums:
            result['invoice_code'] = nums[0]

    # 开票日期
    m = _DATE_RE.search(full_text)
    if m:
        result['invoice_date'] = '%s-%s-%s' % (m.group(1), m.group(2).zfill(2), m.group(3).zfill(2))

    # 开票金额：优先取「价税合计/小写」后的金额，其次全文第一个两位小数金额
    amount = ''
    for kw in ('价税合计', '价税合计(大写)', '小写'):
        idx = compact.find(kw)
        if idx >= 0:
            seg = compact[idx + len(kw):idx + len(kw) + 30]
            m = _AMOUNT_RE.search(seg)
            if m:
                amount = m.group(1).replace(',', '')
                break
    if not amount:
        m = _AMOUNT_RE.search(full_text)
        if m and m.group(1).replace(',', ''):
            amount = m.group(1).replace(',', '')
    result['invoice_amount'] = amount

    # 购买方 / 销售方信息
    buyer_seg = ''
    seller_seg = ''
    if '购买方' in compact and '销售方' in compact:
        # buyer_seg = compact.split('购买方', 1)[1].split('销售方', 1)[0]
        buyer_seg = compact.split('购买方', 1)[1]
        seller_seg = compact.split('销售方', 1)[1]
    elif '购买方' in compact:
        buyer_seg = compact.split('购买方', 1)[1]
    elif '销售方' in compact:
        seller_seg = compact.split('销售方', 1)[1]
    if buyer_seg:
        buyer_name, result['buyer_tax_no'] = _extract_party(buyer_seg)
        if '名称：' in buyer_name:
            buyer_name = buyer_name.split('名称：')[0].strip(' :：\n\r\t')
        buyer_name = buyer_name.replace('统一社会信用代码', '').strip('/')
        result['buyer_name'] = buyer_name
    if seller_seg:
        seller_name, result['seller_tax_no'] = _extract_party(seller_seg)
        if '名称：' in seller_name:
            seller_name = seller_name.split('名称：')[1].strip(' :：\n\r\t')
        seller_name = seller_name.replace('统一社会信用代码', '').strip('/')
        result['seller_name'] = seller_name
    m = _extract_tax_no(compact)
    if m:
        result['buyer_tax_no'] = m[0]
        result['seller_tax_no'] = m[-1]

    # 开票主体（销售方名称）
    result['invoice_issuer'] = result['seller_name'] or ''
    if not result['invoice_issuer']:
        for kw in ('销售方名称', '销 售 方', '销售方'):
            idx = full_text.find(kw)
            if idx >= 0:
                seg = full_text[idx + len(kw):idx + len(kw) + 40]
                seg = re.split(r'[\n\r]+', seg)[0].strip(' :：\n\r\t')
                if seg and len(seg) <= 40:
                    result['invoice_issuer'] = seg
                    break
    return result


def scan_qr_code(image_path):
    """解码图片中的二维码（pyzbar + PIL；若服务器缺少 zbar 原生库则返回空，不影响 OCR 主流程）"""
    try:
        from pyzbar.pyzbar import decode
        from PIL import Image
    except Exception:
        return []
    try:
        image = Image.open(image_path)
        decoded_objects = decode(image)
        return [obj.data.decode('utf-8', errors='ignore') for obj in decoded_objects]
    except Exception:
        return []


def multi_angle_decode(image_path):
    try:
        from pyzbar.pyzbar import decode
        from PIL import Image
        import cv2
        import numpy as np
    except Exception:
        return []

    img = cv2.imread(image_path)
    if img is None:
        return None

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 简单的全局二值化用于旋转尝试，或者复用上面的 adaptiveThreshold
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 尝试 0, 90, 180, 270 度
    for angle in [0, 90, 180, 270]:
        if angle == 0:
            rotated_img = binary
        else:
            # np.rot90 逆时针旋转，k=1 为90度
            rotated_img = np.rot90(binary, k=angle // 90)

        decoded = decode(rotated_img)
        print(decoded)
        if decoded:
            return decoded[0].data.decode('utf-8')

    return None


def clahe_enhanced_decode(image_path):
    try:
        from pyzbar.pyzbar import decode
        from PIL import Image
        import cv2
    except Exception:
        return []

    img = cv2.imread(image_path)
    if img is None:
        return None

    # 转换到 LAB 色彩空间，只处理 L 通道（亮度）
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # 创建 CLAHE 对象
    # clipLimit: 对比度限制，典型值 2.0-3.0
    # tileGridSize: 网格大小，典型值 8x8
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)

    # 合并通道并转回 BGR
    limg = cv2.merge((cl, a, b))
    enhanced_img = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)

    # 转为灰度并二值化
    gray = cv2.cvtColor(enhanced_img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    decoded = decode(binary)
    print(decoded)
    if decoded:
        return decoded[0].data.decode('utf-8')
    return None


if __name__ == '__main__':
    words_1 = ['电子发票（增值税专用发票）', '发票号码：26332000004914581131', '成品油', '国家税务总局',
               '开票日期：2026年06月10日', '浙江省税务局', '下载次数：1', '购买方信息', '销售方信息',
               '名称：义乌市声澜科技有限责任公司', '名称：义乌市第二石油有限公司',
               '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91330782147634358J',
               '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额',
               '*汽油*95号车用汽油(VIA)95', '升', '56.4971751412429', '7.8318584070796', '442.48', '13%', '57.52', '合',
               '计', '¥442.48', '¥57.52', '价税合计（大写）', '伍佰圆整', '(小写)¥500.00', '备注', '开票人：吴三英']

    words = ['电子发票（普通发票）', '发票号码：26937000000075790598', '开票日期：2026年07月04日', '浙江省税务局',
             '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：宁波奉宁苏宁电子商务有限公司',
             '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91330283MA2AGE8B6B',
             '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额',
             '*家用厨房电器具*尚朋堂 SR22AC', '件', '1', '311.5044247787611', '311.50', '13%', '40.50',
             '电磁炉家用新款智能超薄', '小型高端大功率爆炒菜火', '锅电热锅烹饪机快速SR', '*家用厨房电器具*尚朋堂',
             '-1.77', '13%', '-0.23', '电磁炉家用新款智能超薄', '小型高端大功率爆炒菜火', '锅电热锅烹饪机快速SR', '合',
             '计', '¥309.73', '¥40.27', '价税合计（大写）', '叁佰伍拾圆整', '(小写)¥350.00',
             'BH99679978;; 872A; 210100033798171367; 2026-06-24 14:55:03,', '备注', '开票人：沈亚会']

    words = ['电子发票（普通发票）', '发票号码：26332000006730436686', '国家税务总局', '英', '开票日期：2026年08月04日',
             '浙江省税务局', '下载次数：1', '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息',
             '名称：义乌市慧籽电子商务有限公司', '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R',
             '统一社会信用代码/纳税人识别号：91330782MAKD6JWY1W', '项目名称', '规格型号', '单位', '数量', '单价', '金额',
             '税率/征收率', '税额', '*家用美容保健电器*吹风', '352.4191419141914', '157.26', '1%', '1.57', '机', '合',
             '计', '¥157.26', '¥1.57', '价税合计（大写）', '壹佰伍拾捌圆捌角叁分', '(小写) ¥158.83', '备注',
             '开票人：傅晓飞']

    words = ['电子发票（晋通发票）', '发票号码：26117000001140279758', '开票日期：2026年08月11日', '北京市税务局',
             '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：北京我遥我控科技有限公司',
             '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91110116055565228Q',
             '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*生产生活服务*代订机票',
             '/', '/', '1', '4113.21', '4113.21', '6%', '246.79', '款', '合', '计', '¥4113.21', '¥246.79',
             '价税合计（大写）', '肆仟叁佰陆拾圆整', '（小写）¥4360.00', '备注', '开票人：孟浩伟']

    # words = ['16:03', '5G', '高德地图', '电子发票（普通发票）', '1/1', '发票号码：', '26347000000197747618', '旅客运输服务', '开票日期', '2026年08月11日', '安徽省税务局', '购买方信息', '销售方信息', '岳众同臻信息服务（义乌市）有限公司', '名称：', '统一社会信用代码/纳税人识别号：', '91330782MA8GUGDY4Q', '统一社会信用代码/纳税人识别号：', '91340207MAD5LN9F2T', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*交通运输服务*客运服务费', '无', '次', '6.85', '6.85', '0.21', '¥6.85', '计', '¥0.21', '出行人', '有效身份证件号', '出行日期', '出发地', '到达地', '等级', '交通工具类型', '价税合计（大写）', '柒元陆分', '(小写) ￥ 7.06', '备注', '开票人：朱浪博', '<', '-cn-beijing.aliyuncs.com']

    words = ['电子发票（普通发票）', '发票号码：25322000000517532898', 'W', '8', '开票日期：2025年11月04日', '江苏省税务局',
             '下载次数：1', '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：无锡双吉锅业有限公司',
             '统一社会信用代码/纳税人识别号：', '统一社会信用代码/纳税人识别号：913202065580753519', '项目名称',
             '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*金属制品*铁锅', '个',
             '1 295.530973451327', '295.53', '13%', '38.42', '合', '计', '¥295.53', '¥38.42', '价税合计（大写）',
             '叁佰叁拾叁圆玖角伍分', '(小写) ¥333.95', '备注', '开票人：胡玉婷']

    # r = _parse_invoice(words_1)
    # print(r)
    # print('*'*30)

    r = _parse_invoice(words)
    print(r)

    data = {'words_result': {'PurchaserAddress': '', 'PurchaserBank': '', 'Password': '', 'CommodityVehicleType': [],
                             'SellerRegisterNum': '91330901MA28KDTFX3', 'SellerBank': '',
                             'CommodityNum': [{'row': '1', 'word': '1'}],
                             'CommodityAmount': [{'row': '1', 'word': '596.23'}], 'InvoiceType': '电子发票(普通发票)',
                             'AmountInWords': '陆佰叁拾贰圆整', 'TotalTax': '35.77', 'MachineCode': '', 'City': '',
                             'InvoiceNumDigit': '', 'Checker': '', 'InvoiceCode': '', 'SellerAddress': '',
                             'CommodityPrice': [{'row': '1', 'word': '596.23'}], 'NoteDrawer': '魏薇', 'Province': '',
                             'InvoiceNum': '26332000007038384901', 'CommodityTaxRate': [{'row': '1', 'word': '6%'}],
                             'ServiceType': '餐饮', 'InvoiceDate': '2026年08月16日', 'CommodityEndDate': [],
                             'PurchaserRegisterNum': '91330782MAEKK29W4R', 'CommodityStartDate': [],
                             'TotalAmount': '596.23', 'SheetNum': '', 'CommodityPlateNum': [],
                             'PurchaserName': '义乌市声澜科技有限责任公司',
                             'SellerName': '舟山市高佳庄餐饮管理有限公司长峙岛香樟店',
                             'InvoiceNumConfirm': '26332000007038384901', 'Agent': '否', 'InvoiceTag': '其他',
                             'CommodityUnit': [], 'CheckCode': '', 'InvoiceTypeOrg': '电子发票(普通发票)',
                             'Remarks': '', 'Payee': '', 'CommodityTax': [{'row': '1', 'word': '35.77'}],
                             'AmountInFiguers': '632.00',
                             'CommodityName': [{'row': '1', 'word': '*生产生活服务*餐饮服务'}], 'CommodityType': [],
                             'OnlinePay': '', 'PassengerName': [], 'PassengerIdNum': [], 'PassengerDate': [],
                             'PassengerDeparture': [], 'PassengerArrival': [], 'PassengerClass': [],
                             'PassengerVehicleType': [], 'TransportType': [], 'TransportPlateNum': [],
                             'TransportDeparture': [], 'TransportArrival': [], 'TransportCargoInfo': []},
            'words_result_num': 61, 'log_id': 2089249828719692928}

    result = {'invoice_type': 'ordinary', 'invoice_number': '26332000007038384901', 'invoice_code': '',
              'invoice_amount': '632.00', 'invoice_date': '2026-08-16',
              'invoice_issuer': '舟山市高佳庄餐饮管理有限公司长峙岛香樟店', 'buyer_name': '义乌市声澜科技有限责任公司',
              'buyer_tax_no': '91330782MAEKK29W4R', 'seller_name': '舟山市高佳庄餐饮管理有限公司长峙岛香樟店',
              'seller_tax_no': '91330901MA28KDTFX3', 'tax_rate': '', 'drawer': ''}

    data = {'words_result': {'PurchaserAddress': '', 'PurchaserBank': '', 'Password': '', 'CommodityVehicleType': [],
                             'SellerRegisterNum': '91330100396319295P', 'SellerBank': '',
                             'CommodityNum': [{'row': '1', 'word': '1.0000000000000'}],
                             'CommodityAmount': [{'row': '1', 'word': '2653.10'}], 'InvoiceType': '电子发票(专用发票)',
                             'AmountInWords': '贰仟玖佰玖拾捌圆整', 'TotalTax': '344.90', 'MachineCode': '', 'City': '',
                             'InvoiceNumDigit': '', 'Checker': '', 'InvoiceCode': '', 'SellerAddress': '',
                             'CommodityPrice': [{'row': '1', 'word': '2653.1000000000000'}], 'NoteDrawer': '陈叶芳',
                             'Province': '', 'InvoiceNum': '26337000000695148096',
                             'CommodityTaxRate': [{'row': '1', 'word': '13%'}], 'ServiceType': '电器设备',
                             'InvoiceDate': '2026年08月15日', 'CommodityEndDate': [],
                             'PurchaserRegisterNum': '91330782MAEKK29W4R', 'CommodityStartDate': [],
                             'TotalAmount': '2653.10', 'SheetNum': '', 'CommodityPlateNum': [],
                             'PurchaserName': '义乌市声澜科技有限责任公司',
                             'SellerName': '特斯拉汽车销售服务（杭州）有限公司',
                             'InvoiceNumConfirm': '26337000000695148096', 'Agent': '否', 'InvoiceTag': '其他',
                             'CommodityUnit': [{'row': '1', 'word': '个'}], 'CheckCode': '',
                             'InvoiceTypeOrg': '电子发票(增值税专用发票)', 'Remarks': 'SV18EE209E', 'Payee': '',
                             'CommodityTax': [{'row': '1', 'word': '344.90'}], 'AmountInFiguers': '2998.00',
                             'CommodityName': [{'row': '1', 'word': '*交通运输设备*精品销售-3M膜'}],
                             'CommodityType': [{'row': '1', 'word': '2122248-00-A'}], 'OnlinePay': '',
                             'PassengerName': [], 'PassengerIdNum': [], 'PassengerDate': [], 'PassengerDeparture': [],
                             'PassengerArrival': [], 'PassengerClass': [], 'PassengerVehicleType': [],
                             'TransportType': [], 'TransportPlateNum': [], 'TransportDeparture': [],
                             'TransportArrival': [], 'TransportCargoInfo': []}, 'words_result_num': 61,
            'log_id': 2089253337708488078}

    result = {'invoice_type': 'special', 'invoice_number': '26337000000695148096', 'invoice_code': '',
              'invoice_amount': '2998.00', 'invoice_date': '2026-08-15',
              'invoice_issuer': '特斯拉汽车销售服务（杭州）有限公司', 'buyer_name': '义乌市声澜科技有限责任公司',
              'buyer_tax_no': '91330782MAEKK29W4R', 'seller_name': '特斯拉汽车销售服务（杭州）有限公司',
              'seller_tax_no': '91330100396319295P', 'tax_rate': '', 'drawer': ''}
