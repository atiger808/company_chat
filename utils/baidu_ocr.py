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
    secret_key = secret_key or getattr(settings, 'BAIDU_OCR_SECRET_KEY', '') or os.environ.get('BAIDU_OCR_SECRET_KEY', '')
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
    return _parse_invoice(words)


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
    secret_key = secret_key or getattr(settings, 'BAIDU_OCR_SECRET_KEY', '') or os.environ.get('BAIDU_OCR_SECRET_KEY', '')
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

    def _g(*keys):
        for k in keys:
            v = fields.get(k)
            if v:
                return str(v)
        return ''

    invoice_type = _g('InvoiceType', 'invoice_type', '发票类型')
    if invoice_type:
        invoice_type = _detect_invoice_type(invoice_type)
    seller_name = _g('SellerName', 'seller_name', '销售方名称')
    return _normalize_result({
        'invoice_type': invoice_type,
        'invoice_number': _g('InvoiceNum', 'invoice_number', '发票号码'),
        'invoice_code': _g('InvoiceCode', 'invoice_code', '发票代码'),
        'invoice_amount': _g('AmountInFiguers', 'amount_in_figures', 'AmountInFigure', '价税合计', 'invoice_amount'),
        'invoice_date': _normalize_date(_g('InvoiceDate', 'invoice_date', '开票日期')),
        'invoice_issuer': seller_name,
        'buyer_name': _g('PurchaserName', 'purchaser_name', '购买方名称'),
        'buyer_tax_no': _g('PurchaserRegisterNum', 'purchaser_register_num', '购买方纳税人识别号'),
        'seller_name': seller_name,
        'seller_tax_no': _g('SellerRegisterNum', 'seller_register_num', '销售方纳税人识别号'),
        'tax_rate': _g('TaxRate', 'tax_rate', '税率'),
        'drawer': _g('Drawer', 'drawer', '开票人'),
    })


def verify_vat_invoice(image_data, api_key=None, secret_key=None):
    """百度增值税发票验真。

    参考 https://cloud.baidu.com/doc/OCR/s/cklbnrnwe
    返回 dict: {'result': 'pass'|'fail'|'error', 'message': str, 'data': {接口原始字段}}
    未配置百度 key / 网络异常时抛 RuntimeError，由上层返回友好提示。
    """
    from django.conf import settings
    import os
    api_key = api_key or getattr(settings, 'BAIDU_OCR_API_KEY', '') or os.environ.get('BAIDU_OCR_API_KEY', '')
    secret_key = secret_key or getattr(settings, 'BAIDU_OCR_SECRET_KEY', '') or os.environ.get('BAIDU_OCR_SECRET_KEY', '')
    if not api_key or not secret_key:
        raise RuntimeError('未配置百度OCR API Key / Secret Key')
    token = _get_access_token(api_key, secret_key)
    url = 'https://aip.baidubce.com/rest/2.0/ocr/v1/vat_invoice_verify?access_token=%s' % token
    body = {'image': base64.b64encode(image_data).decode('utf-8')}
    try:
        resp = requests.post(url, headers={'Content-Type': 'application/x-www-form-urlencoded'},
                             data=body, timeout=30)
        data = resp.json()
    except Exception as e:
        raise RuntimeError('百度发票验真请求失败: %s' % e)
    logger.info(f"baidu_vat_invoice_verify_data: {data}")
    if data.get('error_code'):
        raise RuntimeError('百度发票验真返回错误: %s %s' % (data.get('error_code'), data.get('error_msg')))

    # 验真结果字段（不同版本返回 verification_result / words_result.verification_result 等）
    vr = data.get('verification_result') or ''
    vm = data.get('verification_message') or ''
    wr = data.get('words_result') or {}
    if isinstance(wr, dict):
        if not vr:
            vr = wr.get('verification_result') or wr.get('verify_result') or ''
        if not vm:
            vm = wr.get('verification_message') or wr.get('verify_message') or ''
    elif isinstance(wr, list):
        for item in wr:
            if isinstance(item, dict):
                if not vr:
                    vr = item.get('verification_result') or item.get('verify_result') or ''
                if not vm:
                    vm = item.get('verification_message') or item.get('verify_message') or ''
    if not vr:
        vr = str(data.get('result') or '') or str(vm or '')

    vv = str(vr or '').strip()
    # 判定：包含“真”视为通过；包含“假”/“不通过”视为失败
    if '真' in vv or '真实' in vv or vv.lower() == 'pass' or vv == '1':
        result = 'pass'
    elif '假' in vv or '不通过' in vv or vv.lower() == 'fail' or vv == '0':
        result = 'fail'
    else:
        result = 'error'
    message = str(vm or vv or '验真无明确结果')[:500]
    return {'result': result, 'message': message, 'data': data}


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
        'tax_rate':'', 'drawer': '',
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
    words_1 = ['电子发票（增值税专用发票）', '发票号码：26332000004914581131', '成品油', '国家税务总局', '开票日期：2026年06月10日', '浙江省税务局', '下载次数：1', '购买方信息', '销售方信息', '名称：义乌市声澜科技有限责任公司', '名称：义乌市第二石油有限公司', '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91330782147634358J', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*汽油*95号车用汽油(VIA)95', '升', '56.4971751412429', '7.8318584070796', '442.48', '13%', '57.52', '合', '计', '¥442.48', '¥57.52', '价税合计（大写）', '伍佰圆整', '(小写)¥500.00', '备注', '开票人：吴三英']

    words = ['电子发票（普通发票）', '发票号码：26937000000075790598', '开票日期：2026年07月04日', '浙江省税务局', '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：宁波奉宁苏宁电子商务有限公司', '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91330283MA2AGE8B6B', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*家用厨房电器具*尚朋堂 SR22AC', '件', '1', '311.5044247787611', '311.50', '13%', '40.50', '电磁炉家用新款智能超薄', '小型高端大功率爆炒菜火', '锅电热锅烹饪机快速SR', '*家用厨房电器具*尚朋堂', '-1.77', '13%', '-0.23', '电磁炉家用新款智能超薄', '小型高端大功率爆炒菜火', '锅电热锅烹饪机快速SR', '合', '计', '¥309.73', '¥40.27', '价税合计（大写）', '叁佰伍拾圆整', '(小写)¥350.00', 'BH99679978;; 872A; 210100033798171367; 2026-06-24 14:55:03,', '备注', '开票人：沈亚会']


    words = ['电子发票（普通发票）', '发票号码：26332000006730436686', '国家税务总局', '英', '开票日期：2026年08月04日', '浙江省税务局', '下载次数：1', '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：义乌市慧籽电子商务有限公司', '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91330782MAKD6JWY1W', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*家用美容保健电器*吹风', '352.4191419141914', '157.26', '1%', '1.57', '机', '合', '计', '¥157.26', '¥1.57', '价税合计（大写）', '壹佰伍拾捌圆捌角叁分', '(小写) ¥158.83', '备注', '开票人：傅晓飞']

    words = ['电子发票（晋通发票）', '发票号码：26117000001140279758', '开票日期：2026年08月11日', '北京市税务局', '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：北京我遥我控科技有限公司', '统一社会信用代码/纳税人识别号：91330782MAEKK29W4R', '统一社会信用代码/纳税人识别号：91110116055565228Q', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*生产生活服务*代订机票', '/', '/', '1', '4113.21', '4113.21', '6%', '246.79', '款', '合', '计', '¥4113.21', '¥246.79', '价税合计（大写）', '肆仟叁佰陆拾圆整', '（小写）¥4360.00', '备注', '开票人：孟浩伟']

    # words = ['16:03', '5G', '高德地图', '电子发票（普通发票）', '1/1', '发票号码：', '26347000000197747618', '旅客运输服务', '开票日期', '2026年08月11日', '安徽省税务局', '购买方信息', '销售方信息', '岳众同臻信息服务（义乌市）有限公司', '名称：', '统一社会信用代码/纳税人识别号：', '91330782MA8GUGDY4Q', '统一社会信用代码/纳税人识别号：', '91340207MAD5LN9F2T', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*交通运输服务*客运服务费', '无', '次', '6.85', '6.85', '0.21', '¥6.85', '计', '¥0.21', '出行人', '有效身份证件号', '出行日期', '出发地', '到达地', '等级', '交通工具类型', '价税合计（大写）', '柒元陆分', '(小写) ￥ 7.06', '备注', '开票人：朱浪博', '<', '-cn-beijing.aliyuncs.com']


    words = ['电子发票（普通发票）', '发票号码：25322000000517532898', 'W', '8', '开票日期：2025年11月04日', '江苏省税务局', '下载次数：1', '购买方信息', '名称：义乌市声澜科技有限责任公司', '销售方信息', '名称：无锡双吉锅业有限公司', '统一社会信用代码/纳税人识别号：', '统一社会信用代码/纳税人识别号：913202065580753519', '项目名称', '规格型号', '单位', '数量', '单价', '金额', '税率/征收率', '税额', '*金属制品*铁锅', '个', '1 295.530973451327', '295.53', '13%', '38.42', '合', '计', '¥295.53', '¥38.42', '价税合计（大写）', '叁佰叁拾叁圆玖角伍分', '(小写) ¥333.95', '备注', '开票人：胡玉婷']


    # r = _parse_invoice(words_1)
    # print(r)
    # print('*'*30)

    r = _parse_invoice(words)
    print(r)

    # image_path = r'G:\Users\zy\Pictures\70b88ee0f0eb4b0784ea6d98ddf6bccc.png'
    # image_path = r'G:\Users\zy\Pictures\ce8c58b0339a4d0c99d38a2233ee5423.png'
    # image_path = r'G:\Users\zy\Pictures\微信图片_20260812193658_12_867.jpg'
    # image_path = r'G:\Users\zy\Pictures\d110ec6c332546abbf834ed397864d42.png'
    # image_path = r'G:\Users\zy\Pictures\微信图片_20260812193634_11_867.jpg'
    # image_path = r'G:\Users\zy\Pictures\微信图片_20260811175502_92_41.jpg'
    # image_path = r'G:\Users\zy\Pictures\8af264f4728e4288a86d02f2edb17cf9.png'
    #
    # image_path = r'G:\Users\zy\Pictures\46ba563076864f9c93ab906c8ced8a73.png'
    # # image_path = r'G:\Users\zy\Pictures\9bd15cd6-0e1e-4f44-850b-8281f82c8837.png'

    # image_path = r'G:\Users\zy\Pictures\test\24b88e47ab774873beeca94bcc3b3fd3.png'
    # r = scan_qr_code(image_path)



    # print(r)
    # print('*'*30)
    # r = multi_angle_decode(image_path)
    # print(r)
    # print('*' * 30)
    # r = clahe_enhanced_decode(image_path)
    # print(r)
    # print('*' * 30)