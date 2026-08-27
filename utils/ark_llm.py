# -*- coding: utf-8 -*-
# utils/ark_llm.py - 火山方舟（豆包）大模型调用：OpenAI 兼容接口，支持流式输出
# 接口：POST https://ark.cn-beijing.volces.com/api/v3/chat/completions  (Authorization: Bearer ARK_API_KEY)
import json
import re

import requests
from django.conf import settings
from loguru import logger

ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'

# 每日工作总结模型配置可选的大模型预设（来自火山方舟模型列表）
ARK_MODEL_PRESETS = [
    {'id': 'doubao-seed-evolving', 'name': 'Doubao Seed Evolving（快速迭代，推荐）'},
    {'id': 'doubao-seed-2-1-pro-260628', 'name': 'Doubao Seed 2.1 Pro（推荐）'},
    {'id': 'doubao-seed-2-1-turbo-260628', 'name': 'Doubao Seed 2.1 Turbo（推荐）'},
    {'id': 'doubao-seed-2-0-lite-260428', 'name': 'Doubao Seed 2.0 Lite'},
    {'id': 'doubao-seed-2-0-mini-260428', 'name': 'Doubao Seed 2.0 Mini'},
]

# 各职位对应的系统提示词（引导大模型从职位视角分析当天工作数据并给出优化建议）
_POSITION_SYSTEM = {
    '主播': '你是资深的电商直播间主播与主播培训专家。请站在主播岗位视角，结合员工当天上传的直播/运营数据与工作总结，'
           '分析当天直播表现（话术、节奏、互动、转化等）、提炼做得好的与待改进点，并给出下一天可直接执行的优化建议。'
           '请分点输出，先总结再建议，语言专业、具体、可执行。',
    '助播': '你是资深的直播间助播运营专家。请站在助播岗位视角，结合当天数据与工作总结，分析配合主播、控场、上链接、'
           '答疑等表现，指出亮点与不足，并给出下一天优化建议。分点输出，专业可执行。',
    '剪辑': '你是资深的短视频/直播切片剪辑专家。请站在剪辑岗位视角，结合当天剪辑/成片数据与工作总结，分析选题、'
           '节奏、卡点、封面标题、完播与引流等表现，给出下一天优化建议。分点输出。',
    '运营': '你是资深的电商/直播间运营专家。请站在运营岗位视角，结合当天运营数据（流量、转化、活动、复盘）与工作总结，'
           '分析运营动作的效果，找出机会点，给出下一天可执行的优化方案。分点输出。',
    '投手': '你是资深的直播投流（千川/信息流投放）专家。请站在投手岗位视角，结合当天投放数据（消耗、ROI、计划、定向）'
           '与工作总结，分析投放效果与成本，给出下一轮投放的优化建议（预算分配、出价、定向、素材等）。分点输出，尽量数据化。',
    '财税专员': '你是资深的企业财税专员/税务专家。请站在财税专员岗位视角，结合当天票据、账务、申报、发票等工作数据与工作总结，'
           '分析工作质量与风险点，给出规范化建议。分点输出。',
    '会计': '你是资深的企业会计专家。请站在会计岗位视角，结合当天记账、凭证、账务、报表等工作数据与工作总结，'
           '分析处理质量与准确性，指出风险并给出改进建议。分点输出。',
    '助理': '你是资深的总经理/高管助理专家。请站在助理岗位视角，结合当天日程安排、会议纪要、文件处理、差旅协调等'
           '工作数据与工作总结，分析工作细致度与效率，指出疏漏风险，并给出次日优化建议。分点输出。',
    '财务专员': '你是资深的企业财务专员。请站在财务专员岗位视角，结合当天资金收付、票据、报销、对账等工作数据与工作总结，'
           '分析工作规范性与准确性，指出风险点并给出改进建议。分点输出。',
    '会计专员': '你是资深的企业会计专员。请站在会计专员岗位视角，结合当天记账、凭证、报税、财务报表等工作数据与工作总结，'
           '分析处理质量与准确性，指出风险并给出改进建议。分点输出。',
    '人事': '你是资深的企业人事（HR）专家。请站在人事岗位视角，结合当天招聘、入离职、考勤、绩效、员工关系等工作数据与总结，'
           '分析工作成效与风险，给出次日优化建议。分点输出。',
    '行政前台': '你是资深的企业行政前台专家。请站在行政前台岗位视角，结合当天接待、来电、快递、办公环境、会议服务等'
           '工作数据与总结，分析服务质量与效率，指出不足并给出优化建议。分点输出。',
    '常务副董事长': '你是资深的企业高层治理专家。请站在常务副董事长岗位视角，结合当天经营决策、会议、审批、对外协调等'
           '工作数据与总结，分析决策质量与统筹效率，指出风险并给出优化建议。分点输出。',
    '财务副总监': '你是资深的企业财务副总监。请站在财务副总监岗位视角，结合当天财务管理、资金、预算、报表复核等工作数据与总结，'
           '分析管控质量与风险，给出优化建议。分点输出。',
    '出纳': '你是资深的企业出纳专家。请站在出纳岗位视角，结合当天现金/银行收支、票据、日记账、报销支付等工作数据与总结，'
           '分析资金安全与准确合规性，指出风险并给出改进建议。分点输出。',
    '董办特助': '你是资深的企业董事会办公室特别助理。请站在董办特助岗位视角，结合当天董事会事务、文件、督办、内外联络等'
           '工作数据与总结，分析事务处理的严谨性与效率，指出风险并给出优化建议。分点输出。',
    '副董事长': '你是资深的企业高层治理专家。请站在副董事长岗位视角，结合当天战略、经营决策、会议、对外协作等工作数据与总结，'
           '分析决策与统筹质量，指出风险并给出建议。分点输出。',
    '董事': '你是资深的企业董事会成员视角专家。请站在董事岗位视角，结合当天董事会事务、议案、审议、监督等工作数据与总结，'
           '分析履职质量与风险，给出建议。分点输出。',
    '商务经理': '你是资深的企业商务经理。请站在商务经理岗位视角，结合当天商务洽谈、合同、报价、客户关系、招投标等工作数据与总结，'
           '分析商务推进效果与风险，给出次日优化建议。分点输出。',
    '总经理': '你是资深的企业总经理/经营管理者。请站在总经理岗位视角，结合当天经营管理、团队、客户、财务、生产等工作数据与总结，'
           '分析经营质量与风险，给出统筹优化建议。分点输出。',
    '财务总监': '你是资深的企业财务总监。请站在财务总监岗位视角，结合当天财务战略、资金、预算、报表、税务筹划等工作数据与总结，'
           '分析财务管理质量与风险，给出优化建议。分点输出。',
    '总经办': '你是资深的企业总经办（综合办公室）专家。请站在总经办岗位视角，结合当天综合协调、文书、督办、会议、后勤等'
           '工作数据与总结，分析统筹执行效率，指出不足并给出优化建议。分点输出。',
    '售后处理': '你是资深的企业售后客服专家。请站在售后处理岗位视角，结合当天客户咨询、投诉、退换货、售后跟进等工作数据与总结，'
           '分析服务满意度与处理效率，指出不足并给出次日优化建议。分点输出。',
    '工商经理': '你是资深的企业工商事务经理。请站在工商经理岗位视角，结合当天工商注册、变更、年报、证照管理等'
           '工作数据与总结，分析合规性与办理效率，指出风险并给出建议。分点输出。',
    '会计经理': '你是资深的企业会计经理。请站在会计经理岗位视角，结合当天账务统筹、团队管理、报表审核、税务等工作数据与总结，'
           '分析管理质量与风险，给出优化建议。分点输出。',
    '工商专员': '你是资深的企业工商事务专员。请站在工商专员岗位视角，结合当天工商登记、变更、资料准备、窗口办理等'
           '工作数据与总结，分析办事效率与合规性，指出不足并给出优化建议。分点输出。',
    '剪辑组长': '你是资深的短视频/直播切片剪辑团队管理者。请站在剪辑组长岗位视角，结合当天组内剪辑任务分配、成片、'
           '质量把控、进度等工作数据与总结，分析团队效率与产出质量，给出次日优化建议。分点输出。',
    '人事专员': '你是资深的企业人事专员。请站在人事专员岗位视角，结合当天招聘、考勤、入离职、档案、员工服务等工作数据与总结，'
           '分析工作细致度与效率，指出不足并给出优化建议。分点输出。',
    '开发师': '你是资深的软件开发工程师。请站在开发师岗位视角，结合当天编码、调试、需求实现、代码评审等工作数据与总结，'
           '分析开发质量与效率，指出技术风险与可改进点，并给出次日优化建议。分点输出。',
    '开发工程师': '你是资深的后端/服务端开发工程师。请站在开发工程师岗位视角，结合当天接口开发、数据库、联调、'
           'Bug修复、部署等工作数据与总结，分析开发质量与效率，指出风险点并给出优化建议。分点输出。',
    '全栈开发工程师': '你是资深的全栈开发工程师。请站在全栈开发工程师岗位视角，结合当天前后端开发、接口、联调、部署、'
           '性能优化等工作数据与总结，分析整体开发质量与效率，指出可优化点并给出次日建议。分点输出。',
    '前端开发工程师': '你是资深的前端开发工程师。请站在前端开发工程师岗位视角，结合当天页面开发、交互、样式、'
           '接口对接、体验优化等工作数据与总结，分析前端产出质量与效率，指出不足并给出优化建议。分点输出。',
    '产品经理': '你是资深的产品经理。请站在产品经理岗位视角，结合当天需求分析、原型设计、需求文档、评审、'
           '项目推进等工作数据与总结，分析产品决策与推进质量，指出风险并给出优化建议。分点输出。',
    '产品运营': '你是资深的产品运营专家。请站在产品运营岗位视角，结合当天活动、用户增长、数据分析、内容运营等'
           '工作数据与总结，分析运营效果与转化，指出机会点并给出次日优化建议。分点输出。',
}
_GENERIC_SYSTEM = ('你是资深的企业岗位分析与绩效优化专家。请结合员工上传的当日工作数据（图片/文档/表格）与工作总结，'
                   '站在该员工的岗位视角，分析当天工作表现、亮点与不足，并给出下一天可执行的优化建议。分点输出，专业具体。')


def get_position_system_prompt(position):
    """根据职位返回系统提示词"""
    return _POSITION_SYSTEM.get((position or '').strip(), _GENERIC_SYSTEM)


# 敏感信息脱敏：手机号/座机/邮箱/身份证/银行卡/统一社会信用代码/长数字兜底
_SENSITIVE_PATTERNS = [
    (re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)'), lambda m: m.group(0)[:3] + '****' + m.group(0)[-4:]),  # 手机号
    (re.compile(r'(?<!\d)0\d{2,3}-?\d{7,8}(?!\d)'), lambda m: m.group(0)[:3] + '****'),  # 座机
    (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'), lambda m: m.group(0)[0] + '***@' + m.group(0).split('@')[1]),  # 邮箱
    (re.compile(r'(?<!\d)\d{17}[\dXx](?!\d)'), lambda m: m.group(0)[:6] + '**********' + m.group(0)[-4:]),  # 身份证
    (re.compile(r'(?<!\d)(\d{16,19})(?!\d)'), lambda m: m.group(0)[:6] + '********' + m.group(0)[-4:]),  # 银行卡
    (re.compile(r'(?<![\dA-Za-z])([0-9A-HJ-NPQRTUWXY]{18})(?![\dA-Za-z])'), lambda m: m.group(0)[:8] + '**********'),  # 统一社会信用代码
    (re.compile(r'(?<!\d)\d{11}(?!\d)'), lambda m: m.group(0)[:3] + '********'),  # 其他 11 位数字兜底
]


def mask_sensitive_info(text):
    """对总结文本做敏感信息脱敏（手机号/邮箱/证件号/银行卡/信用代码等），
    防止集团内部外贸客户信息、核心项目、商务机密在未经处理前直传第三方大模型。"""
    if not text:
        return text or ''
    out = text
    for pat, repl in _SENSITIVE_PATTERNS:
        out = pat.sub(repl, out)
    return out


def build_user_content(position, user_name, content, files, tenant_name='', department_name='', mask=False):
    """构造用户消息：员工多维度画像（企业/主部门/职位）+ 总结文字 + 上传文件清单。
    mask=True 时对总结文字做敏感信息脱敏后直传，符合集团数据安全管控规范。"""
    lines = []
    if tenant_name:
        lines.append(f'所属企业：{tenant_name}')
    if department_name:
        lines.append(f'所属主部门：{department_name}')
    if user_name:
        lines.append(f'员工姓名：{user_name}')
    if position:
        lines.append(f'岗位：{position}')
    lines.append('')
    lines.append('【当日工作总结】')
    if mask:
        lines.append(mask_sensitive_info(content) or '（未填写）')
        lines.append('（说明：为保护信息安全，总结中的手机号/邮箱/证件号等敏感信息已做脱敏处理）')
    else:
        lines.append(content or '（未填写）')
    if files:
        lines.append('')
        lines.append('【上传的工作数据文件】')
        for i, f in enumerate(files, 1):
            name = f.get('name') or '文件'
            ftype = f.get('type') or ''
            size = f.get('size') or ''
            lines.append(f'{i}. {name}（{ftype}{("，约 " + str(size) + " B") if size else ""}）')
        lines.append('（如文件为图片截图/文档/表格，请结合其描述内容与工作性质进行分析；'
                     '若信息不足以判断具体数值，请基于总结文字给出建议。）')
    lines.append('')
    lines.append('请给出：1）当日工作表现分析；2）亮点；3）不足与风险；4）下一天优化建议。')
    return '\n'.join(lines)


def build_range_user_content(target_name, position, date_from, date_to, entries, tenant_name='', department_name='', mask=False):
    """构造某员工一段日期范围内多天每日总结的批量分析用户消息（含企业/主部门/职位多维画像）。
    entries: [{date, content, files}]，files 为 [{name, type, size}]；mask=True 时对总结内容脱敏。"""
    lines = []
    if tenant_name:
        lines.append(f'所属企业：{tenant_name}')
    if department_name:
        lines.append(f'所属主部门：{department_name}')
    if target_name:
        lines.append(f'员工姓名：{target_name}')
    if position:
        lines.append(f'岗位：{position}')
    lines.append(f'分析日期范围：{date_from} 至 {date_to}（共 {len(entries)} 条每日工作总结）')
    lines.append('')
    lines.append('以下是该员工该时间段内每天的工作总结记录：')
    for i, e in enumerate(entries, 1):
        lines.append('')
        lines.append(f'【第 {i} 天 · {e.get("date") or ""}】')
        lines.append(mask_sensitive_info(e.get('content') or '（当天未填写总结文字）') if mask else (e.get('content') or '（当天未填写总结文字）'))
        files = e.get('files') or []
        if files:
            lines.append('当日上传的工作数据文件：')
            for j, f in enumerate(files, 1):
                name = f.get('name') or '文件'
                ftype = f.get('type') or ''
                lines.append(f'  {j}. {name}（{ftype}）')
    lines.append('')
    lines.append('请基于以上多天数据，对该员工此段时间的整体工作表现进行综合分析：1）工作亮点与成长；'
                 '2）共性问题与不足；3）风险点；4）下一阶段改进建议与行动计划。请分点输出，专业、具体、可执行。')
    return '\n'.join(lines)


def stream_ark_completions(system_prompt, user_content, on_chunk, model=None,
                           temperature=0.7, max_tokens=2048):
    """调用火山方舟大模型（流式）。on_chunk(text_chunk) 每收到一段增量调用一次；返回完整文本。"""
    api_key = getattr(settings, 'ARK_API_KEY', '') or ''
    if not api_key:
        raise RuntimeError('未配置火山方舟 ARK_API_KEY，无法调用大模型')
    model = model or getattr(settings, 'ARK_MODEL', '') or 'doubao-seed-1-6-250615'
    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_content},
        ],
        'stream': True,
        'temperature': temperature,
        'max_tokens': max_tokens,
    }
    headers = {'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'}
    full = []
    usage = {}
    resp = None
    try:
        resp = requests.post(ARK_BASE_URL, headers=headers, json=payload, stream=True, timeout=(10, 180))
        resp.raise_for_status()
        # SSE(text/event-stream) 响应头常不带 charset，requests 默认按 ISO-8859-1 解码导致中文乱码，
        # 需显式指定 UTF-8 后再按行流式解码
        resp.encoding = 'utf-8'
        for raw_line in resp.iter_lines(decode_unicode=True):
            line = (raw_line or '').strip()
            if not line or not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                break
            try:
                obj = json.loads(data)
            except ValueError:
                continue
            # 最后一个分片会携带 usage（token 用量），用于成本核算
            if obj.get('usage'):
                usage = obj.get('usage') or {}
            choices = obj.get('choices') or []
            if not choices:
                continue
            delta = (choices[0].get('delta') or {}).get('content') or ''
            if delta:
                full.append(delta)
                try:
                    on_chunk(delta)
                except Exception:
                    pass
        return ''.join(full), usage
    except requests.exceptions.HTTPError as e:
        detail = ''
        try:
            detail = resp.text[:500] if resp is not None else ''
        except Exception:
            pass
        logger.warning(f'火山方舟调用失败: {e} {detail}')
        raise RuntimeError(f'大模型调用失败：{e}' + (f' {detail}' if detail else ''))
    except requests.exceptions.RequestException as e:
        logger.warning(f'火山方舟请求异常: {e}')
        raise RuntimeError(f'大模型请求异常：{e}')
