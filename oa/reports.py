# -*- coding: utf-8 -*-
"""OA 审批 / 普惠补贴 报表与数据分析接口。

统计实时聚合，不新增模型（避免迁移）：
  ApprovalReportViewSet  — 流程效率分析 / 业务统计分析 / 导出 Excel·PDF（仅超级管理员）
  SubsidyReportViewSet   — 补贴发放统计 / 明细 / 趋势 / 排行 / 导出（超管、财务核验、财务支付）
"""
from collections import defaultdict
from datetime import date as _date, datetime as _dt, time as _time, timedelta
from io import BytesIO
from urllib.parse import quote

from django.conf import settings
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate, TruncMonth
from django.utils import timezone
from loguru import logger
from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from utils.encrypt_aes import encrypt_data

from .models import ApprovalRequest, ApprovalType, SubsidyApplication, SubsidyWithdrawal
from .type_utils import BUILTIN_TYPES


def _f(v):
    """安全转 float（Decimal/None → 0）"""
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _report_build_pdf(title, subtitle, headers, rows):
    """用 reportlab 生成简单表格 PDF（中文用 STSong-Light）。无 reportlab 返回 None"""
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.pdfgen import canvas
    except ImportError:
        return None
    try:
        pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    except Exception:
        return None
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 60
    c.setFont('STSong-Light', 16)
    c.drawString(50, y, str(title))
    y -= 22
    c.setFont('STSong-Light', 10)
    c.drawString(50, y, str(subtitle))
    y -= 26
    c.setFont('STSong-Light', 11)
    for r in rows:
        if y < 60:
            c.showPage()
            c.setFont('STSong-Light', 11)
            y = height - 60
        left = str(r[0]) if len(r) > 0 else ''
        right = str(r[1]) if len(r) > 1 else ''
        c.drawString(50, y, left[:40])
        c.drawString(300, y, right[:30])
        y -= 18
    c.showPage()
    c.save()
    return buf.getvalue()


def _excel_bytes(sheet_title, headers, rows, col_widths=None, extra_sheets=None):
    """生成 xlsx 字节；extra_sheets=[(title, headers, rows, col_widths)] 追加工作表；缺依赖返回 (None, error)"""
    try:
        import openpyxl
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        return None, '服务器缺少 openpyxl 依赖'

    def _fill(ws, hd, rws, cws):
        ws.append(hd)
        for c in range(1, len(hd) + 1):
            cell = ws.cell(row=1, column=c)
            cell.fill = PatternFill('solid', fgColor='409EFF')
            cell.font = Font(color='FFFFFF', bold=True)
            cell.alignment = Alignment(horizontal='center', vertical='center')
        for r in rws:
            ws.append(r)
        if not cws:
            cws = [32] + [20] * (len(hd) - 1)
        for i, w in enumerate(cws, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = (sheet_title or '报表')[:28]
    _fill(ws, headers, rows, col_widths)
    for (t, hd, rws, cws) in (extra_sheets or []):
        ws2 = wb.create_sheet((t or '统计')[:28])
        _fill(ws2, hd, rws, cws)
    out = BytesIO()
    wb.save(out)
    return out.getvalue(), None


def _file_response(data, filename, content_type):
    """以 HttpResponse 返回文件（显式 Content-Length，避免流式响应在网关侧 502）"""
    from django.http import HttpResponse
    resp = HttpResponse(data, content_type=content_type)
    resp['Content-Disposition'] = "attachment; filename*=UTF-8''%s" % quote(filename)
    resp['Content-Length'] = str(len(data))
    return resp


def _blocks_pdf(title, subtitle, blocks):
    """按模态框内容（统计卡/表格/图表图片）生成完整 PDF。
    blocks: [{'kind':'heading','text':..} | {'kind':'table','headers':[..],'rows':[[..]]}
             | {'kind':'image','data':'data:image/png;base64,...'}]
    无 reportlab 返回 None。"""
    try:
        import base64
        from reportlab.lib import colors as _colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import (Image as RLImage, Paragraph, SimpleDocTemplate,
                                        Spacer, Table, TableStyle)
    except ImportError:
        return None
    try:
        pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    except Exception:
        return None
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm, title=str(title))
    st_title = ParagraphStyle('t', fontName='STSong-Light', fontSize=16, leading=20, spaceAfter=4)
    st_sub = ParagraphStyle('s', fontName='STSong-Light', fontSize=9, leading=13,
                            textColor=_colors.HexColor('#909399'), spaceAfter=8)
    st_h = ParagraphStyle('h', fontName='STSong-Light', fontSize=12, leading=16, spaceBefore=8,
                          spaceAfter=4, textColor=_colors.HexColor('#409eff'))
    st_cell = ParagraphStyle('c', fontName='STSong-Light', fontSize=9, leading=12)
    st_head = ParagraphStyle('ch', fontName='STSong-Light', fontSize=9, leading=12,
                             textColor=_colors.white)
    story = [Paragraph(str(title or ''), st_title)]
    if subtitle:
        story.append(Paragraph(str(subtitle), st_sub))
    frame_w = A4[0] - 28 * mm   # 页宽 - 左右各 14mm 边距
    for b in (blocks or []):
        if not isinstance(b, dict):
            continue
        kind = b.get('kind')
        if kind == 'heading':
            txt = str(b.get('text') or '').strip()
            if txt:
                story.append(Paragraph(txt, st_h))
        elif kind == 'table':
            headers = b.get('headers') or []
            rows = b.get('rows') or []
            data = []
            if headers:
                data.append([Paragraph(str(h), st_head) for h in headers])
            for r in rows:
                data.append([Paragraph('' if c is None else str(c), st_cell) for c in r])
            if data:
                ncol = max(len(x) for x in data)
                tbl = Table(data, colWidths=[frame_w / ncol] * ncol,
                            repeatRows=1 if headers else 0)
                tbl.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), _colors.HexColor('#409eff')),
                    ('GRID', (0, 0), (-1, -1), 0.4, _colors.HexColor('#dcdfe6')),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                    ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
                ]))
                story.append(tbl)
                story.append(Spacer(1, 6))
        elif kind == 'image':
            data_uri = str(b.get('data') or '')
            if not data_uri:
                continue
            try:
                b64 = data_uri.split(',', 1)[1] if ',' in data_uri else data_uri
                raw = base64.b64decode(b64)
                img = RLImage(BytesIO(raw))
                iw, ih = img.imageWidth, img.imageHeight
                if iw > 0 and ih > 0:
                    scale = min(frame_w / iw, 1.0)
                    img.drawWidth = iw * scale
                    img.drawHeight = ih * scale
                story.append(img)
                story.append(Spacer(1, 8))
            except Exception as e:
                logger.warning(f'PDF 图表嵌入失败: {e}')
    if len(story) <= (2 if subtitle else 1):
        story.append(Paragraph('（无内容）', st_sub))
    try:
        doc.build(story)
    except Exception as e:
        logger.exception(f'生成报表 PDF 失败: {e}')
        return None
    return buf.getvalue()


class _AdminReportBase(viewsets.ViewSet):
    """报表基类：租户作用域 + 区间解析（OA / 补贴报表共用）"""
    permission_classes = [permissions.IsAuthenticated]

    def _tenant(self, request):
        return getattr(request, 'tenant', None) or request.user.get_active_tenant()

    def _tenant_ids(self, request):
        tenant = self._tenant(request)
        ids = []
        if tenant:
            ids.append(tenant.id)
            try:
                ids += [t.id for t in tenant.sub_tenants.filter(is_active=True)]
            except Exception:
                pass
        return ids

    @staticmethod
    def _user_id(request):
        """按用户筛选（可选）：报表支持搜索用户后查看该用户的数据"""
        uid = (request.query_params.get('user_id') or '').strip()
        try:
            return int(uid) if uid else None
        except (ValueError, TypeError):
            return None

    def _primary_dept_map(self, request, uids):
        """用户 → 主部门名（org.UserDepartment.is_primary，按企业范围；回退账号部门）"""
        dmap = {}
        if not uids:
            return dmap
        tenant_ids = self._tenant_ids(request)
        try:
            from org.models import UserDepartment
            ud_qs = UserDepartment.objects.filter(user_id__in=uids, is_primary=True).select_related('department')
            if tenant_ids:
                ud_qs = ud_qs.filter(department__tenant_id__in=tenant_ids)
            for ud in ud_qs:
                if ud.department and ud.user_id not in dmap:
                    dmap[ud.user_id] = ud.department.name
        except Exception as e:
            logger.warning(f'查询主部门失败: {e}')
        missing = [u for u in uids if u not in dmap]
        if missing:
            try:
                from accounts.models import CustomUser
                for u in CustomUser.objects.filter(id__in=missing).select_related('department'):
                    if u.department:
                        dmap[u.id] = u.department.name
            except Exception:
                pass
        return dmap

    @staticmethod
    def _parse_range(request):
        today = timezone.localdate()
        qs = request.query_params
        start_s = (qs.get('start') or '').strip()
        end_s = (qs.get('end') or '').strip()
        try:
            start_d = _date.fromisoformat(start_s) if start_s else (today - timedelta(days=29))
        except Exception:
            start_d = today - timedelta(days=29)
        try:
            end_d = _date.fromisoformat(end_s) if end_s else today
        except Exception:
            end_d = today
        if start_d > end_d:
            start_d, end_d = end_d, start_d
        tz = timezone.get_current_timezone()
        start_dt = timezone.make_aware(_dt.combine(start_d, _time.min), tz)
        end_dt = timezone.make_aware(_dt.combine(end_d, _time.max), tz)
        return start_d, end_d, start_dt, end_dt


class ApprovalReportViewSet(_AdminReportBase):
    """OA 审批报表与数据分析（仅超级管理员）"""

    def _require_admin(self, request):
        return getattr(request.user, 'user_type', '') == 'super_admin'

    def _base_qs(self, request, start_dt, end_dt):
        ids = self._tenant_ids(request)
        qs = ApprovalRequest.objects.filter(created_at__gte=start_dt, created_at__lte=end_dt)
        if ids:
            qs = qs.filter(tenant_id__in=ids)
        uid = self._user_id(request)
        if uid:
            qs = qs.filter(applicant_id=uid)
        return qs

    def _type_names(self, request):
        """审批类型 code → 名称（含集团默认 + 本企业/子企业自定义类型，避免图表显示编码）"""
        names = {}
        try:
            from django.db.models import Q
            ids = self._tenant_ids(request)
            cond = Q(tenant__isnull=True)
            if ids:
                cond |= Q(tenant_id__in=ids)
            for t in ApprovalType.objects.filter(cond):
                names[t.code] = t.name
        except Exception:
            pass
        for t in BUILTIN_TYPES:
            names.setdefault(t['code'], t['name'])
        return names

    def _overview_data(self, request):
        """流程效率分析聚合"""
        start_d, end_d, start_dt, end_dt = self._parse_range(request)
        try:
            timeout_days = int(request.query_params.get('timeout_days') or 3)
        except (ValueError, TypeError):
            timeout_days = 3
        qs = self._base_qs(request, start_dt, end_dt)
        total = qs.count()
        status_counts = dict(qs.values_list('status').annotate(c=Count('id')))
        approved = status_counts.get('approved', 0)
        rejected = status_counts.get('rejected', 0)
        pending = status_counts.get('pending', 0)
        processing = status_counts.get('processing', 0)
        deferred = status_counts.get('deferred', 0)
        cancelled = status_counts.get('cancelled', 0)
        draft = status_counts.get('draft', 0)
        now = timezone.now()
        timeout_count = qs.filter(status__in=['pending', 'processing', 'deferred'],
                                  created_at__lt=now - timedelta(days=timeout_days)).count()
        durations = []
        node_durations = defaultdict(list)
        for a in qs.prefetch_related('logs'):
            logs = sorted(a.logs.all(), key=lambda x: x.created_at)
            approve_logs = [l for l in logs if l.action == 'approve']
            if a.status == 'approved' and approve_logs:
                durations.append((approve_logs[-1].created_at - a.created_at).total_seconds() / 60.0)
            prev = a.created_at
            for idx, l in enumerate(logs):
                if l.action in ('approve', 'reject', 'deferred', 'processing'):
                    node_durations[idx].append((l.created_at - prev).total_seconds() / 60.0)
                    prev = l.created_at
        avg_minutes = round(sum(durations) / len(durations), 1) if durations else 0
        max_minutes = round(max(durations), 1) if durations else 0
        node_avg = []
        for idx in sorted(node_durations.keys())[:6]:
            arr = node_durations[idx]
            node_avg.append({'node': idx + 1, 'avg_minutes': round(sum(arr) / len(arr), 1) if arr else 0,
                             'count': len(arr)})
        type_names = self._type_names(request)
        by_type = [{'code': r['approval_type'],
                    'name': type_names.get(r['approval_type'], r['approval_type']),
                    'count': r['count']}
                   for r in qs.values('approval_type').annotate(count=Count('id')).order_by('-count')]
        trend = [{'date': r['d'].strftime('%Y-%m-%d') if r['d'] else '', 'count': r['count']}
                 for r in qs.annotate(d=TruncDate('created_at')).values('d').annotate(count=Count('id')).order_by('d')]
        decided = approved + rejected
        return {
            'range': {'start': start_d.isoformat(), 'end': end_d.isoformat()},
            'timeout_days': timeout_days,
            'summary': {
                'total': total, 'approved': approved, 'rejected': rejected,
                'pending': pending, 'processing': processing, 'deferred': deferred,
                'cancelled': cancelled, 'draft': draft,
                'avg_minutes': avg_minutes, 'max_minutes': max_minutes,
                'reject_rate': round(rejected / decided * 100, 2) if decided else 0,
                'timeout_rate': round(timeout_count / total * 100, 2) if total else 0,
                'timeout_count': timeout_count,
                'backlog': pending + processing + deferred,
            },
            'node_avg': node_avg,
            'by_type': by_type,
            'trend': trend,
        }

    def _business_data(self, request):
        """业务统计分析聚合"""
        start_d, end_d, start_dt, end_dt = self._parse_range(request)
        qs = self._base_qs(request, start_dt, end_dt)
        approved_qs = qs.filter(status='approved')
        type_names = self._type_names(request)
        by_type = [{'code': r['approval_type'], 'name': type_names.get(r['approval_type'], r['approval_type']),
                    'amount': _f(r['amount']), 'count': r['count']}
                   for r in approved_qs.values('approval_type').annotate(amount=Sum('amount'), count=Count('id')).order_by('-amount')]
        expense_names = dict(ApprovalRequest.EXPENSE_TYPE_CHOICES)
        expense_by_type = [{'code': r['expense_type'] or '',
                            'name': expense_names.get(r['expense_type'], r['expense_type'] or '未分类'),
                            'amount': _f(r['amount']), 'count': r['count']}
                           for r in approved_qs.filter(approval_type='expense').values('expense_type').annotate(
                               amount=Sum('amount'), count=Count('id')).order_by('-amount')]
        dept_rank = [{'name': r['department__name'] or '未分配', 'amount': _f(r['amount']), 'count': r['count']}
                     for r in approved_qs.values('department__name').annotate(
                         amount=Sum('amount'), count=Count('id')).order_by('-amount')[:20]]
        leave_by_type = [{'type': r['leave_type'] or '未分类', 'count': r['count'], 'days': round(_f(r['days']), 1)}
                         for r in qs.filter(approval_type='leave').values('leave_type').annotate(
                             count=Count('id'), days=Sum('duration'))]
        monthly = [{'month': r['m'].strftime('%Y-%m') if r['m'] else '', 'amount': _f(r['amount']), 'count': r['count']}
                   for r in approved_qs.annotate(m=TruncMonth('created_at')).values('m').annotate(
                       amount=Sum('amount'), count=Count('id')).order_by('m')]
        # 合并「各审批类型金额统计」：内置 + 自定义，按金额字段逐行
        #  - 有表单 schema 的类型（自定义 / 带表单内置）：按 schema 中 type=amount 的字段从 form_data 汇总
        #  - 无 schema 金额字段的内置类型（报销/采购等）：按审批「金额」字段(ApprovalRequest.amount)汇总
        # 每行含：审批类型、是否内置、是否启用、类型编码、金额字段、金额、笔数
        type_amounts = []
        try:
            from django.db.models import Q
            tids = self._tenant_ids(request)
            cond = Q(tenant__isnull=True)
            if tids:
                cond |= Q(tenant_id__in=tids)
            builtin_codes = [t['code'] for t in BUILTIN_TYPES]
            # code -> {name, is_builtin, enabled}（本企业/子企业行覆盖集团默认行）
            meta = {}
            for t in ApprovalType.objects.filter(cond).order_by('tenant_id'):
                meta[t.code] = {'name': t.name, 'is_builtin': bool(t.is_builtin), 'enabled': bool(t.enabled)}
            for t in BUILTIN_TYPES:
                m = meta.get(t['code'])
                if m is None:
                    meta[t['code']] = {'name': t['name'], 'is_builtin': True, 'enabled': True}
                else:
                    m['is_builtin'] = True
                    if not m.get('name'):
                        m['name'] = t['name']
            # code -> {field_key: label}（schema 金额字段）
            schema_map = {}
            for t in ApprovalType.objects.filter(cond):
                for f in (t.form_schema or []):
                    if isinstance(f, dict) and f.get('type') == 'amount' and f.get('key'):
                        schema_map.setdefault(t.code, {})[f['key']] = f.get('label') or f['key']
            for t in BUILTIN_TYPES:
                for f in (t.get('form_schema') or []):
                    if isinstance(f, dict) and f.get('type') == 'amount' and f.get('key'):
                        schema_map.setdefault(t['code'], {})[f['key']] = f.get('label') or f['key']
            codes = list(meta.keys()) + [c for c in builtin_codes if c not in meta]
            seen = set()
            for code in codes:
                if code in seen:
                    continue
                seen.add(code)
                mi = meta.get(code) or {'name': code, 'is_builtin': code in builtin_codes, 'enabled': True}
                sub = approved_qs.filter(approval_type=code)
                flds = schema_map.get(code) or {}

                def _row(fkey, flabel, amount, count):
                    return {
                        'type_code': code, 'type_name': mi.get('name') or code,
                        'is_builtin': bool(mi.get('is_builtin')), 'enabled': bool(mi.get('enabled', True)),
                        'field_key': fkey, 'field_label': flabel,
                        'amount': round(amount, 2), 'count': count,
                    }

                if not flds:
                    # 内置类型无 schema 金额字段：按审批金额统计
                    cnt = sub.filter(amount__isnull=False).count()
                    amt = _f(sub.aggregate(s=Sum('amount'))['s'])
                    type_amounts.append(_row('amount', '金额', amt, cnt))
                    continue
                acc = {k: [0.0, 0] for k in flds}
                for fd in sub.values_list('form_data', flat=True):
                    fd = fd or {}
                    for k in flds:
                        v = fd.get(k)
                        if v in (None, ''):
                            continue
                        try:
                            acc[k][0] += float(v)
                            acc[k][1] += 1
                        except (TypeError, ValueError):
                            pass
                for k, lbl in flds.items():
                    type_amounts.append(_row(k, lbl, acc[k][0], acc[k][1]))
            type_amounts.sort(key=lambda x: -x['amount'])
        except Exception as e:
            logger.warning(f'审批类型金额统计失败: {e}')
        amount_fields = type_amounts   # 兼容旧字段名
        return {
            'range': {'start': start_d.isoformat(), 'end': end_d.isoformat()},
            'summary': {
                'amount_total': _f(approved_qs.aggregate(s=Sum('amount'))['s']),
                'count_total': qs.count(),
                'count_approved': approved_qs.count(),
                'expense_amount': _f(approved_qs.filter(approval_type='expense').aggregate(s=Sum('amount'))['s']),
                'purchase_amount': _f(approved_qs.filter(approval_type='purchase').aggregate(s=Sum('amount'))['s']),
                'contract_amount': _f(approved_qs.filter(approval_type__in=['contract', 'contract_approval']).aggregate(s=Sum('amount'))['s']),
                'material_amount': _f(approved_qs.filter(approval_type__in=['material_requirement', 'material_stock_in']).aggregate(s=Sum('amount'))['s']),
                'amount_fields_total': round(sum(x['amount'] for x in amount_fields), 2),
            },
            'by_type': by_type,
            'expense_by_type': expense_by_type,
            'dept_rank': dept_rank,
            'leave_by_type': leave_by_type,
            'monthly': monthly,
            'amount_fields': amount_fields,
            'type_amounts': type_amounts,
        }

    @action(detail=False, methods=['get'])
    def overview(self, request):
        """流程效率分析：审批时长、节点耗时、驳回率、超时率、积压量、类型分布、趋势"""
        if not self._require_admin(request):
            return Response({'error': '仅超级管理员可查看'}, status=403)
        if (request.query_params.get('export_format') or '').strip().lower() in ('xlsx', 'pdf'):
            return self._export_file(request, 'overview', request.query_params.get('export_format').strip().lower())
        return Response({'encrypt': True, 'data': encrypt_data(self._overview_data(request))})

    @action(detail=False, methods=['get'])
    def business(self, request):
        """业务统计分析（带 format=xlsx/pdf 时直接导出该报表）"""
        if not self._require_admin(request):
            return Response({'error': '仅超级管理员可查看'}, status=403)
        if (request.query_params.get('export_format') or '').strip().lower() in ('xlsx', 'pdf'):
            return self._export_file(request, 'business', request.query_params.get('export_format').strip().lower())
        return Response({'encrypt': True, 'data': encrypt_data(self._business_data(request))})

    @action(detail=False, methods=['post'])
    def pdf_export(self, request):
        """按模态框内容（统计卡 + 表格 + 图表图片）生成完整 PDF：POST {title,subtitle,filename,blocks}"""
        if not self._require_admin(request):
            return Response({'error': '仅超级管理员可导出'}, status=403)
        title = (request.data.get('title') or 'OA审批-报表与数据分析').strip()
        subtitle = (request.data.get('subtitle') or '').strip()
        blocks = request.data.get('blocks') or []
        pdf = _blocks_pdf(title, subtitle, blocks)
        if not pdf:
            return Response({'error': '服务器未安装 PDF 生成库(reportlab)'}, status=400)
        filename = (request.data.get('filename') or '').strip() or (title + '_' + _dt.now().strftime('%Y%m%d_%H%M') + '.pdf')
        if not filename.lower().endswith('.pdf'):
            filename += '.pdf'
        return _file_response(pdf, filename, 'application/pdf')

    @action(detail=False, methods=['get'])
    def export(self, request):
        """导出报表（兼容入口）：kind=overview(流程效率)/business(业务统计)，export_format=xlsx(默认)/pdf"""
        if not self._require_admin(request):
            return Response({'error': '仅超级管理员可导出'}, status=403)
        kind = (request.query_params.get('kind') or 'overview').strip()
        fmt = (request.query_params.get('export_format') or 'xlsx').strip().lower()
        return self._export_file(request, kind, fmt)

    # ==================== 审计复盘（超管 / 财务专员） ====================
    def _can_audit(self, request):
        """审计复盘权限：超级管理员 或 本企业启用的财务专员"""
        u = request.user
        if getattr(u, 'user_type', '') == 'super_admin':
            return True
        try:
            from .models import FinanceSpecialist
            tenant = self._tenant(request)
            return FinanceSpecialist.objects.filter(tenant=tenant, user=u, is_active=True).exists()
        except Exception:
            return False

    @staticmethod
    def _period_key(d, period):
        """把日期归到 月/季/年 的周期键与展示名"""
        if period == 'year':
            return '%04d' % d.year, '%d年' % d.year
        if period == 'quarter':
            q = (d.month - 1) // 3 + 1
            return '%04dQ%d' % (d.year, q), '%d年Q%d' % (d.year, q)
        return '%04d-%02d' % (d.year, d.month), '%d年%02d月' % (d.year, d.month)

    def _audit_data(self, request):
        """审计复盘聚合：期间汇总 + 按 月/季/年 的周期构成 + 审批类型构成 + 审计台账明细"""
        start_d, end_d, start_dt, end_dt = self._parse_range(request)
        period = (request.query_params.get('period') or 'month').strip().lower()
        if period not in ('month', 'quarter', 'year'):
            period = 'month'
        qs = self._base_qs(request, start_dt, end_dt)
        t = (request.query_params.get('type') or '').strip()
        if t:
            qs = qs.filter(approval_type=t)
        # 归档筛选：审计复盘默认看全量（含已归档）；archived=1 只看已归档；archived=0 只看未归档
        archived_filter = (request.query_params.get('archived') or '').strip().lower()
        if archived_filter in ('1', 'true', 'yes', 'archived'):
            qs = qs.filter(is_archived=True)
        elif archived_filter in ('0', 'false', 'no'):
            qs = qs.filter(is_archived=False)

        STATUS_LABELS = dict(ApprovalRequest.STATUS_CHOICES)
        type_names = self._type_names(request)

        # —— 汇总 ——
        total = qs.count()
        status_counts = dict(qs.values_list('status').annotate(c=Count('id')))
        approved_cnt = status_counts.get('approved', 0)
        rejected_cnt = status_counts.get('rejected', 0)
        approved_amount = _f(qs.filter(status='approved').aggregate(s=Sum('amount'))['s'])
        total_amount = _f(qs.aggregate(s=Sum('amount'))['s'])
        archived_cnt = qs.filter(is_archived=True).count()
        decided = approved_cnt + rejected_cnt

        # —— 周期构成（按月聚合后按 月/季/年 重新归并）——
        month_rows = list(qs.annotate(m=TruncMonth('created_at')).values('m').annotate(
            cnt=Count('id'), amount=Sum('amount')).order_by('m'))
        month_appr = dict(qs.filter(status='approved').annotate(m=TruncMonth('created_at'))
                          .values_list('m').annotate(c=Count('id')))
        month_rej = dict(qs.filter(status='rejected').annotate(m=TruncMonth('created_at'))
                         .values_list('m').annotate(c=Count('id')))
        month_arch = dict(qs.filter(is_archived=True).annotate(m=TruncMonth('created_at'))
                          .values_list('m').annotate(c=Count('id')))
        periods = {}
        for r in month_rows:
            m = r['m']
            if not m:
                continue
            key, label = self._period_key(m, period)
            it = periods.setdefault(key, {'key': key, 'label': label, 'total': 0,
                                          'amount': 0.0, 'approved': 0, 'rejected': 0, 'archived': 0})
            it['total'] += r['cnt']
            it['amount'] += _f(r['amount'])
            it['approved'] += month_appr.get(m, 0)
            it['rejected'] += month_rej.get(m, 0)
            it['archived'] += month_arch.get(m, 0)
        period_rows = [dict(v, amount=round(v['amount'], 2)) for v in periods.values()]

        # —— 审批类型构成 ——
        type_rows = []
        for r in qs.values('approval_type').annotate(cnt=Count('id'), amount=Sum('amount')).order_by('-cnt'):
            code = r['approval_type']
            type_rows.append({
                'code': code, 'name': type_names.get(code, code),
                'total': r['cnt'], 'amount': round(_f(r['amount']), 2),
                'approved': qs.filter(approval_type=code, status='approved').count(),
                'rejected': qs.filter(approval_type=code, status='rejected').count(),
                'archived': qs.filter(approval_type=code, is_archived=True).count(),
            })

        # —— 审计台账明细 ——
        LEDGER_LIMIT = 1000
        ledger = []
        detail_qs = qs.select_related('applicant', 'department').prefetch_related('logs').order_by('-created_at')
        for a in detail_qs[:LEDGER_LIMIT + 1]:
            if len(ledger) >= LEDGER_LIMIT:
                break
            # 结束时间取「通过/驳回/撤回」最后一次记录，避免归档保存改动 updated_at 造成失真
            done_at = None
            for lg in a.logs.all():
                if lg.action in ('approve', 'reject', 'cancel'):
                    if done_at is None or lg.created_at > done_at:
                        done_at = lg.created_at
            minutes = round((done_at - a.created_at).total_seconds() / 60.0, 1) if done_at else None
            ledger.append({
                'id': a.id,
                'type_code': a.approval_type,
                'type_name': type_names.get(a.approval_type, a.approval_type),
                'title': a.title,
                'applicant': (a.applicant.real_name or a.applicant.username) if a.applicant else '',
                'department': a.department.name if a.department else '',
                'amount': _f(a.amount),
                'status': a.status,
                'status_label': STATUS_LABELS.get(a.status, a.status),
                'created_at': timezone.localtime(a.created_at).strftime('%Y-%m-%d %H:%M') if a.created_at else '',
                'finished_at': timezone.localtime(done_at).strftime('%Y-%m-%d %H:%M') if done_at else '',
                'minutes': minutes,
                'is_archived': bool(a.is_archived),
                'archived_at': timezone.localtime(a.archived_at).strftime('%Y-%m-%d %H:%M') if a.archived_at else '',
                'archive_note': a.archive_note or '',
            })
        return {
            'range': {'start': start_d.isoformat(), 'end': end_d.isoformat()},
            'period': period,
            'period_label': {'month': '月度', 'quarter': '季度', 'year': '年度'}.get(period, '月度'),
            'summary': {
                'total': total,
                'amount_total': round(total_amount, 2),
                'approved': approved_cnt,
                'rejected': rejected_cnt,
                'approved_amount': round(approved_amount, 2),
                'decided': decided,
                'reject_rate': round(rejected_cnt / decided * 100, 2) if decided else 0,
                'archived_count': archived_cnt,
                'unarchived_count': total - archived_cnt,
            },
            'periods': period_rows,
            'types': type_rows,
            'ledger': ledger,
            'ledger_limit': LEDGER_LIMIT,
            'ledger_truncated': total > LEDGER_LIMIT,
        }

    @action(detail=False, methods=['get'])
    def audit_summary(self, request):
        """审计复盘：期间汇总 + 月度/季度/年度构成 + 审批类型构成 + 审计台账（超管/财务专员）
        带 export_format=xlsx 时直接导出审计复盘 Excel（含台账明细）。"""
        if not self._can_audit(request):
            return Response({'error': '仅超级管理员或财务专员可查看审计复盘'}, status=403)
        if (request.query_params.get('export_format') or '').strip().lower() in ('xlsx', 'pdf'):
            return self._export_file(request, 'audit', request.query_params.get('export_format').strip().lower())
        return Response({'encrypt': True, 'data': encrypt_data(self._audit_data(request))})

    def _export_file(self, request, kind, fmt):
        """构建并返回报表文件（xlsx/pdf）：供 overview/business/audit/export 复用"""
        start_d, end_d, _, _ = self._parse_range(request)
        extra = []
        if kind == 'audit':
            data = self._audit_data(request)
            s = data.get('summary', {})
            title = 'OA审批-审计复盘（%s）' % data.get('period_label', '')
            headers = ['统计项', '数值']
            rows = [
                ['统计区间', '%s ~ %s' % (start_d.isoformat(), end_d.isoformat())],
                ['汇总粒度', data.get('period_label', '')],
                ['审批总数', s.get('total', 0)],
                ['金额合计(元)', s.get('amount_total', 0)],
                ['已通过', s.get('approved', 0)],
                ['已驳回', s.get('rejected', 0)],
                ['已通过金额(元)', s.get('approved_amount', 0)],
                ['驳回率(%)', s.get('reject_rate', 0)],
                ['已归档', s.get('archived_count', 0)],
                ['未归档', s.get('unarchived_count', 0)],
            ]
            # 第二张表：周期构成
            p_rows = [[p.get('label', ''), p.get('total', 0), p.get('amount', 0),
                       p.get('approved', 0), p.get('rejected', 0), p.get('archived', 0)]
                      for p in data.get('periods', [])]
            extra.append((('%s构成' % data.get('period_label', '周期'))[:28],
                          ['周期', '笔数', '金额(元)', '已通过', '已驳回', '已归档'],
                          p_rows, [18, 10, 14, 10, 10, 10]))
            # 第三张表：审批类型构成
            t_rows = [[t.get('name', ''), t.get('total', 0), t.get('amount', 0),
                       t.get('approved', 0), t.get('rejected', 0), t.get('archived', 0)]
                      for t in data.get('types', [])]
            extra.append(('审批类型构成', ['审批类型', '笔数', '金额(元)', '已通过', '已驳回', '已归档'],
                          t_rows, [20, 10, 14, 10, 10, 10]))
            # 第四张表：审计台账明细
            l_rows = [[x.get('id', ''), x.get('type_name', ''), x.get('title', ''),
                       x.get('applicant', ''), x.get('department', ''), x.get('amount', 0),
                       x.get('status_label', ''), x.get('created_at', ''), x.get('finished_at', ''),
                       (x.get('minutes') if x.get('minutes') is not None else ''),
                       ('已归档' if x.get('is_archived') else '未归档'), x.get('archived_at', '')]
                      for x in data.get('ledger', [])]
            extra.append(('审计台账', ['审批ID', '审批类型', '审批标题', '申请人', '所属部门', '金额(元)',
                                       '状态', '提交时间', '结束时间', '耗时(分钟)', '归档状态', '归档时间'],
                          l_rows, [10, 16, 26, 12, 16, 12, 10, 18, 18, 12, 10, 18]))
        elif kind == 'business':
            data = self._business_data(request)
            title = 'OA审批-业务统计分析'
            headers = ['统计项', '数值']
            s = data.get('summary', {})
            rows = [
                ['审批总数', s.get('count_total', 0)],
                ['已通过数', s.get('count_approved', 0)],
                ['金额合计(元)', s.get('amount_total', 0)],
                ['报销金额(元)', s.get('expense_amount', 0)],
                ['采购金额(元)', s.get('purchase_amount', 0)],
                ['合同金额(元)', s.get('contract_amount', 0)],
                ['物资金额(元)', s.get('material_amount', 0)],
                ['—— 部门费用排行 ——', ''],
            ]
            rows += [[d.get('name', ''), d.get('amount', 0)] for d in data.get('dept_rank', [])]
            rows.append(['—— 费用类型统计 ——', ''])
            rows += [[d.get('name', ''), d.get('amount', 0)] for d in data.get('expense_by_type', [])]
            # 第二张工作表：各审批类型金额统计（合并表）
            ta = data.get('type_amounts') or data.get('amount_fields') or []
            ta_rows = [[('是' if x.get('is_builtin') else '否'), ('启用' if x.get('enabled', True) else '停用'),
                        x.get('type_code', ''), x.get('field_label', ''), x.get('amount', 0), x.get('count', 0)]
                       for x in ta]
            # 追加审批类型名称列（放最前）
            ta_rows = [[x.get('type_name', '')] + r for x, r in zip(ta, ta_rows)]
            extra.append(('各审批类型金额统计',
                          ['审批类型', '是否内置', '是否启用', '类型编码', '金额字段', '金额', '笔数'],
                          ta_rows, [20, 10, 10, 18, 16, 14, 10]))
        else:
            data = self._overview_data(request)
            title = 'OA审批-流程效率分析'
            headers = ['指标', '数值']
            s = data.get('summary', {})
            rows = [
                ['审批总数', s.get('total', 0)],
                ['已通过', s.get('approved', 0)],
                ['已驳回', s.get('rejected', 0)],
                ['待审批', s.get('pending', 0)],
                ['办理中', s.get('processing', 0)],
                ['暂缓', s.get('deferred', 0)],
                ['积压量', s.get('backlog', 0)],
                ['平均审批时长(分钟)', s.get('avg_minutes', 0)],
                ['最长审批时长(分钟)', s.get('max_minutes', 0)],
                ['驳回率(%)', s.get('reject_rate', 0)],
                ['超时率(%)', s.get('timeout_rate', 0)],
                ['—— 审批类型分布 ——', ''],
            ]
            rows += [[d.get('name', ''), d.get('count', 0)] for d in data.get('by_type', [])]
        ts = _dt.now().strftime('%Y%m%d_%H%M')
        try:
            if fmt == 'pdf':
                data_bytes = _report_build_pdf(title, f'{start_d.isoformat()} ~ {end_d.isoformat()}', headers, rows)
                if not data_bytes:
                    return Response({'error': '服务器未安装 PDF 生成库(reportlab)'}, status=400)
                return _file_response(data_bytes, f'{title}_{ts}.pdf', 'application/pdf')
            data_bytes, err = _excel_bytes(title, headers, rows, [32, 20], extra_sheets=extra)
            if err:
                return Response({'error': err}, status=500)
            return _file_response(data_bytes, f'{title}_{ts}.xlsx',
                                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        except Exception as e:
            logger.exception(f'OA审批报表导出失败: {e}')
            return Response({'error': f'导出失败: {e}'}, status=500)


class SubsidyReportViewSet(_AdminReportBase):
    """普惠补贴报表与数据分析（超管 / 财务核验人员 / 财务支付人员）"""

    def _can_view(self, request):
        u = request.user
        if getattr(u, 'user_type', '') == 'super_admin':
            return True
        try:
            from .views import SubsidyViewSet
            sv = SubsidyViewSet()
            tenant = self._tenant(request)
            return sv._is_verifier(u, tenant) or sv._is_payment_staff(u, tenant)
        except Exception:
            return False

    def _base_qs(self, request, start_dt, end_dt):
        ids = self._tenant_ids(request)
        qs = SubsidyApplication.objects.filter(created_at__gte=start_dt, created_at__lte=end_dt)
        if ids:
            qs = qs.filter(tenant_id__in=ids)
        uid = self._user_id(request)
        if uid:
            qs = qs.filter(applicant_id=uid)
        return qs

    def _stats_data(self, request):
        start_d, end_d, start_dt, end_dt = self._parse_range(request)
        qs = self._base_qs(request, start_dt, end_dt)
        approved_qs = qs.filter(status='approved')
        agg = qs.aggregate(inv=Sum('invoice_amount'), sub=Sum('subsidy_amount'))
        status_names = {'pending': '待核验', 'approved': '已通过', 'rejected': '已驳回'}
        by_status = [{'code': r['status'], 'name': status_names.get(r['status'], r['status']),
                      'count': r['count'], 'subsidy_amount': _f(r['sub'])}
                     for r in qs.values('status').annotate(count=Count('id'), sub=Sum('subsidy_amount')).order_by('-count')]
        type_names = dict(SubsidyApplication.INVOICE_TYPE_CHOICES)
        by_type = [{'code': r['invoice_type'], 'name': type_names.get(r['invoice_type'], r['invoice_type']),
                    'count': r['count'], 'invoice_amount': _f(r['inv']), 'subsidy_amount': _f(r['sub'])}
                   for r in qs.values('invoice_type').annotate(count=Count('id'), sub=Sum('subsidy_amount'),
                                                               inv=Sum('invoice_amount')).order_by('-sub')]
        monthly = [{'month': r['m'].strftime('%Y-%m') if r['m'] else '', 'count': r['count'],
                    'subsidy_amount': _f(r['sub'])}
                   for r in qs.annotate(m=TruncMonth('created_at')).values('m').annotate(
                       count=Count('id'), sub=Sum('subsidy_amount')).order_by('m')]
        pay_trend = [{'date': r['d'].strftime('%Y-%m-%d') if r['d'] else '', 'count': r['count'],
                      'subsidy_amount': _f(r['sub'])}
                     for r in qs.filter(status='approved', verified_at__isnull=False).annotate(
                         d=TruncDate('verified_at')).values('d').annotate(
                         count=Count('id'), sub=Sum('subsidy_amount')).order_by('d')]
        # 部门/员工补贴排行：只统计「通过核验」的补贴金额，按主部门汇总
        tenant_ids = self._tenant_ids(request)
        approved_rows = list(approved_qs.values('applicant_id').annotate(count=Count('id'), sub=Sum('subsidy_amount')))
        uids = [r['applicant_id'] for r in approved_rows if r['applicant_id']]
        dept_map = self._primary_dept_map(request, uids)
        _agg = {}
        for r in approved_rows:
            nm = dept_map.get(r['applicant_id']) or '未分配'
            it = _agg.setdefault(nm, {'name': nm, 'count': 0, 'subsidy_amount': 0.0})
            it['count'] += r['count']
            it['subsidy_amount'] += _f(r['sub'])
        dept_rank = sorted(_agg.values(), key=lambda x: -x['subsidy_amount'])[:20]
        emp_rank = [{'name': r['applicant__real_name'] or r['applicant__username'] or '未知',
                     'count': r['count'], 'subsidy_amount': _f(r['sub'])}
                    for r in approved_qs.values('applicant_id', 'applicant__real_name', 'applicant__username').annotate(
                        count=Count('id'), sub=Sum('subsidy_amount')).order_by('-sub')[:20]]
        # 已支付提现排行（按提现金额）：员工排行 + 部门排行
        paid_emp_rank = []
        paid_dept_rank = []
        try:
            wpaid = SubsidyWithdrawal.objects.filter(
                status='paid', requested_at__gte=start_dt, requested_at__lte=end_dt)
            if tenant_ids:
                wpaid = wpaid.filter(tenant_id__in=tenant_ids)
            uid = self._user_id(request)
            if uid:
                wpaid = wpaid.filter(user_id=uid)
            paid_emp_rank = [{'name': r['user__real_name'] or r['user__username'] or '未知',
                              'count': r['cnt'], 'amount': _f(r['amt'])}
                             for r in wpaid.values('user_id', 'user__real_name', 'user__username').annotate(
                                 cnt=Count('id'), amt=Sum('amount')).order_by('-amt')[:20]]
            puids = list(wpaid.values_list('user_id', flat=True).distinct())
            pdmap = self._primary_dept_map(request, puids)
            pagg = {}
            for r in wpaid.values('user_id').annotate(cnt=Count('id'), amt=Sum('amount')):
                nm = pdmap.get(r['user_id']) or '未分配'
                it = pagg.setdefault(nm, {'name': nm, 'count': 0, 'amount': 0.0})
                it['count'] += r['cnt']
                it['amount'] += _f(r['amt'])
            paid_dept_rank = sorted(pagg.values(), key=lambda x: -x['amount'])[:20]
        except Exception as e:
            logger.warning(f'已支付提现排行统计失败: {e}')
        # 核验结果统计（通过/未通过核验的补贴）
        approved_qs = qs.filter(status='approved')
        rejected_qs = qs.filter(status='rejected')
        verify_stats = {
            'approved_count': approved_qs.count(),
            'approved_amount': _f(approved_qs.aggregate(s=Sum('subsidy_amount'))['s']),
            'approved_invoice_amount': _f(approved_qs.aggregate(s=Sum('invoice_amount'))['s']),
            'rejected_count': rejected_qs.count(),
            'rejected_amount': _f(rejected_qs.aggregate(s=Sum('subsidy_amount'))['s']),
            'rejected_invoice_amount': _f(rejected_qs.aggregate(s=Sum('invoice_amount'))['s']),
        }
        # 提现统计（按提现申请时间区间）：已支付 / 未支付 / 已驳回 / 全部
        withdraw_stats = {
            'paid_count': 0, 'paid_amount': 0.0,
            'pending_count': 0, 'pending_amount': 0.0,
            'rejected_count': 0, 'rejected_amount': 0.0,
            'total_count': 0, 'total_amount': 0.0,
        }
        try:
            wq = SubsidyWithdrawal.objects.filter(requested_at__gte=start_dt, requested_at__lte=end_dt)
            if tenant_ids:
                wq = wq.filter(tenant_id__in=tenant_ids)
            _uid = self._user_id(request)   # 按用户筛选：提现统计同样只统计该用户
            if _uid:
                wq = wq.filter(user_id=_uid)
            for code, ck, ak in (('paid', 'paid', 'paid'), ('pending', 'pending', 'pending'), ('rejected', 'rejected', 'rejected')):
                sub = wq.filter(status=code)
                withdraw_stats[ck + '_count'] = sub.count()
                withdraw_stats[ak + '_amount'] = _f(sub.aggregate(s=Sum('amount'))['s'])
            withdraw_stats['total_count'] = wq.count()
            withdraw_stats['total_amount'] = _f(wq.aggregate(s=Sum('amount'))['s'])
        except Exception as e:
            logger.warning(f'提现统计失败: {e}')
        return {
            'range': {'start': start_d.isoformat(), 'end': end_d.isoformat()},
            'summary': {
                'total_count': qs.count(),
                'invoice_amount': _f(agg.get('inv')),
                'subsidy_amount': _f(agg.get('sub')),
                'approved_count': sum(x['count'] for x in by_status if x['code'] == 'approved'),
                'pending_count': sum(x['count'] for x in by_status if x['code'] == 'pending'),
                'rejected_count': sum(x['count'] for x in by_status if x['code'] == 'rejected'),
            },
            'by_status': by_status,
            'by_type': by_type,
            'monthly': monthly,
            'pay_trend': pay_trend,
            'dept_rank': dept_rank,
            'emp_rank': emp_rank,
            'paid_dept_rank': paid_dept_rank,
            'paid_emp_rank': paid_emp_rank,
            'verify_stats': verify_stats,
            'withdraw_stats': withdraw_stats,
        }

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """补贴发放统计/趋势/排行（带 format=xlsx/pdf 时直接导出补贴明细）"""
        if not self._can_view(request):
            return Response({'error': '仅超级管理员、财务核验人员或财务支付人员可查看'}, status=403)
        if (request.query_params.get('export_format') or '').strip().lower() in ('xlsx', 'pdf'):
            return self._export_file(request, request.query_params.get('export_format').strip().lower())
        return Response({'encrypt': True, 'data': encrypt_data(self._stats_data(request))})

    @action(detail=False, methods=['post'])
    def pdf_export(self, request):
        """按模态框内容（统计卡 + 表格 + 图表图片）生成完整 PDF：POST {title,subtitle,filename,blocks}"""
        if not self._can_view(request):
            return Response({'error': '仅超级管理员、财务核验人员或财务支付人员可导出'}, status=403)
        title = (request.data.get('title') or '普惠补贴-报表与数据分析').strip()
        subtitle = (request.data.get('subtitle') or '').strip()
        blocks = request.data.get('blocks') or []
        pdf = _blocks_pdf(title, subtitle, blocks)
        if not pdf:
            return Response({'error': '服务器未安装 PDF 生成库(reportlab)'}, status=400)
        filename = (request.data.get('filename') or '').strip() or (title + '_' + _dt.now().strftime('%Y%m%d_%H%M') + '.pdf')
        if not filename.lower().endswith('.pdf'):
            filename += '.pdf'
        return _file_response(pdf, filename, 'application/pdf')

    @action(detail=False, methods=['get'])
    def export(self, request):
        """导出补贴明细（兼容入口）：export_format=xlsx(默认)/pdf，可按状态/时间筛选"""
        if not self._can_view(request):
            return Response({'error': '仅超级管理员、财务核验人员或财务支付人员可导出'}, status=403)
        fmt = (request.query_params.get('export_format') or 'xlsx').strip().lower()
        return self._export_file(request, fmt)

    def _export_file(self, request, fmt):
        """构建并返回补贴明细文件（xlsx/pdf）"""
        start_d, end_d, start_dt, end_dt = self._parse_range(request)
        qs = self._base_qs(request, start_dt, end_dt)
        status = (request.query_params.get('status') or '').strip()
        if status in ('pending', 'approved', 'rejected'):
            qs = qs.filter(status=status)
        qs = qs.select_related('applicant', 'tenant').order_by('-created_at')[:10000]
        headers = ['申领编号', '申请人', '所属企业', '发票类型', '发票号码', '开票金额(元)',
                   '补贴比例', '补贴金额(元)', '状态', '开票日期', '核验时间', '申请时间']
        smap = {'pending': '待核验', 'approved': '已通过', 'rejected': '已驳回'}
        rows = []
        for a in qs:
            rows.append([
                a.application_no,
                (a.applicant.real_name or a.applicant.username) if a.applicant else '',
                (a.tenant.short_name or a.tenant.name) if a.tenant else '',
                a.get_invoice_type_display(),
                a.invoice_number or '',
                float(a.invoice_amount or 0),
                f'{float(a.subsidy_rate or 0) * 100:g}%',
                float(a.subsidy_amount or 0),
                smap.get(a.status, a.status),
                a.invoice_date.strftime('%Y-%m-%d') if a.invoice_date else '',
                timezone.localtime(a.verified_at).strftime('%Y-%m-%d %H:%M') if a.verified_at else '',
                timezone.localtime(a.created_at).strftime('%Y-%m-%d %H:%M') if a.created_at else '',
            ])
        ts = _dt.now().strftime('%Y%m%d_%H%M')
        title = '普惠补贴发放明细'
        try:
            if fmt == 'pdf':
                body = [[r[0], r[4], str(r[7]), r[8]] for r in rows]
                data_bytes = _report_build_pdf(title, f'{start_d.isoformat()} ~ {end_d.isoformat()}',
                                               ['申领编号', '发票号码', '补贴金额(元)', '状态'], body)
                if not data_bytes:
                    return Response({'error': '服务器未安装 PDF 生成库(reportlab)'}, status=400)
                return _file_response(data_bytes, f'{title}_{ts}.pdf', 'application/pdf')
            st = self._stats_data(request)
            vs = st.get('verify_stats', {})
            ws_ = st.get('withdraw_stats', {})
            summary_rows = [
                ['通过核验的补贴(笔数)', vs.get('approved_count', 0)],
                ['通过核验的补贴(补贴金额/元)', vs.get('approved_amount', 0)],
                ['通过核验的补贴(开票金额/元)', vs.get('approved_invoice_amount', 0)],
                ['未通过核验的补贴(笔数)', vs.get('rejected_count', 0)],
                ['未通过核验的补贴(补贴金额/元)', vs.get('rejected_amount', 0)],
                ['未通过核验的补贴(开票金额/元)', vs.get('rejected_invoice_amount', 0)],
                ['已支付的提现(笔数)', ws_.get('paid_count', 0)],
                ['已支付的提现(金额/元)', ws_.get('paid_amount', 0)],
                ['未支付的提现(笔数)', ws_.get('pending_count', 0)],
                ['未支付的提现(金额/元)', ws_.get('pending_amount', 0)],
                ['已驳回的提现(笔数)', ws_.get('rejected_count', 0)],
                ['已驳回的提现(金额/元)', ws_.get('rejected_amount', 0)],
                ['全部提现(笔数)', ws_.get('total_count', 0)],
                ['全部提现(金额/元)', ws_.get('total_amount', 0)],
            ]
            data_bytes, err = _excel_bytes(
                '补贴明细', headers, rows, [20, 14, 18, 18, 24, 14, 10, 14, 10, 12, 18, 18],
                extra_sheets=[('统计汇总', ['统计项', '数值'], summary_rows, [34, 20])])
            if err:
                return Response({'error': err}, status=500)
            return _file_response(data_bytes, f'{title}_{ts}.xlsx',
                                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        except Exception as e:
            logger.exception(f'普惠补贴报表导出失败: {e}')
            return Response({'error': f'导出失败: {e}'}, status=500)
