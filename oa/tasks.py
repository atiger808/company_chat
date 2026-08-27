# -*- coding: utf-8 -*-
"""普惠补贴 OCR 异步任务

将耗时较长的票据 OCR 识别放入 Celery 后台执行，
Web 请求立即返回 task_id，前端轮询 /api/oa/subsidy/ocr-status/ 获取结果，
避免同步 OCR 长时间占用 Gunicorn worker。
"""
import os
import time as _time
from datetime import time, timedelta

from company_chat.celery_app import app
from django.utils import timezone
from django.db.models import Q, F
from loguru import logger


def _apply_tax_rate_type(result, threshold):
    """按税率判定发票类型：税率(%) >= 阈值(%) → 增值税专用发票，否则普通发票。返回修改后的 result"""
    if not result or not isinstance(result, dict):
        return result
    if not result.get('tax_rate'):
        return result
    try:
        import re
        m = re.search(r'[-+]?\d+(?:\.\d+)?', str(result['tax_rate']))
        if not m:
            return result
        rate_pct = float(m.group(0))
        if threshold and threshold > 0:
            if rate_pct >= threshold * 100:
                result['invoice_type'] = 'special'
            else:
                result['invoice_type'] = 'ordinary'
    except (ValueError, TypeError):
        pass
    return result


@app.task(bind=True, max_retries=1, default_retry_delay=5,
          acks_late=True, time_limit=180, soft_time_limit=150)
def subsidy_ocr_task(self, image_path, ocr_version='baidu_vat', cache_key=None, delete_after=False,
                     tax_rate_threshold=0, ocr_cache_ttl=604800):
    """异步识别票据（图片/PDF），返回解析字段 dict；失败返回 {'error': ...}
    识别成功后将结果写入 Redis 缓存（键=票据MD5+OCR版本），避免重复识别。
    delete_after=True 时才清理文件（仅用于临时文件，MEDIA 票据文件不能删）。
    tax_rate_threshold>0 时按税率判定发票类型（>=阈值→专用，否则普通）。
    ocr_cache_ttl 为发票识别缓存时间（秒），默认 7 天（604800）。"""
    image_data = None
    try:
        with open(image_path, 'rb') as f:
            image_data = f.read()
    except FileNotFoundError:
        logger.warning(f'OCR 票据文件不存在: {image_path}')
        return {'error': '票据文件不存在，请重新上传'}
    except Exception as e:
        logger.warning(f'读取 OCR 票据文件失败: {e}')
        return {'error': f'读取票据文件失败: {e}'}
    try:
        # 若未传入缓存键，则用文件内容 MD5 + 版本自行计算（保证一致性）
        if not cache_key:
            import hashlib
            md5 = hashlib.md5(image_data).hexdigest()
            cache_key = f'subsidy_ocr:{md5}:{ocr_version}'
        if ocr_version == 'baidu_general':
            from utils.baidu_ocr import recognize_invoice
            result = recognize_invoice(image_data)
        elif ocr_version == 'paddle':
            from utils.paddle_ocr import recognize_paddle
            result = recognize_paddle(image_data)
            invoice_number = result.get('invoice_number')
            if invoice_number and len(str(invoice_number)) > 20:
                logger.info(f'invoice_number: {invoice_number} 长度大于20，尝试扫描二维码')
                from utils.qr_scan import scan_qr_strings, parse_qr_fields
                try:
                    qr_strings = scan_qr_strings(image_data)
                    if qr_strings:
                        parsed = parse_qr_fields(qr_strings[0])
                        invoice_number = parsed.get('invoice_number')
                        if invoice_number and len(str(invoice_number)) == 20:
                            result['invoice_number'] = invoice_number
                            logger.info(f'invoice_number: {invoice_number} 长度为20，使用二维码扫描结果')
                        else:
                            logger.info(f'invoice_number: {invoice_number} 长度不为20，使用原始结果')
                    else:
                        logger.info(f'未扫描到二维码，使用原始结果')
                        result['invoice_number'] = str(invoice_number)[:20]
                except Exception as e:
                    logger.warning(f'二维码扫描失败: {e}')

        else:
            from utils.baidu_ocr import recognize_vat_invoice
            result = recognize_vat_invoice(image_data)
        logger.info(f'异步OCR_VERSION：({ocr_version}) tax_rate_threshold：{tax_rate_threshold} 结果: {result}')
        if not result:
            return {'error': '未能从票据中识别出有效信息，请更换更清晰的图片或手动填写'}
        elif not result.get('invoice_number'):
            return {'error': '未能从票据中识别出发票号码，请更换更清晰的图片或手动填写'}

        # 按税率阈值判定发票类型
        if tax_rate_threshold and tax_rate_threshold > 0:
            result = _apply_tax_rate_type(result, tax_rate_threshold)
        # 写入缓存（按配置的缓存时间，默认 7 天），供后续同一票据+版本直接复用
        try:
            from django.core.cache import cache
            cache.set(cache_key, result, timeout=int(ocr_cache_ttl or 604800))
        except Exception as e:
            logger.warning(f'写入OCR缓存失败: {e}')
        return result
    except Exception as e:
        logger.warning(f'异步OCR({ocr_version}) 识别失败: {e}')
        return {'error': str(e) or '票据识别失败'}
    finally:
        # 仅清理临时文件；MEDIA 文件不能删除（否则票据丢失）
        if delete_after:
            try:
                if image_path and os.path.exists(image_path):
                    os.remove(image_path)
            except OSError:
                pass


# ==================== 每日工作汇总（工作日历 + 每日通知共用） ====================

def _tenant_ids(tenant):
    """当前企业 + 子企业 id 列表"""
    ids = [tenant.id]
    try:
        sub_ids = list(tenant.sub_tenants.filter(is_active=True).values_list('id', flat=True))
        if sub_ids:
            ids.extend(sub_ids)
    except Exception:
        pass
    return ids


def _primary_dept_name(user):
    """用户主部门名称"""
    try:
        from org.models import UserDepartment
        ud = UserDepartment.objects.filter(user=user, is_primary=True).select_related('department').first()
        if ud and ud.department:
            return ud.department.name
    except Exception:
        pass
    return (user.department.name if getattr(user, 'department', None) else '') or ''


def _is_verifier(user, tenant):
    """是否财务核验人员（复用 SubsidyViewSet 的配置解析）"""
    if user.user_type == 'super_admin':
        return True
    if not tenant:
        return False
    try:
        from .views import SubsidyViewSet
        return bool(SubsidyViewSet()._is_verifier(user, tenant))
    except Exception:
        return False


def _is_payment_staff(user, tenant):
    """是否财务支付人员（复用 SubsidyViewSet 的配置解析）"""
    if user.user_type == 'super_admin':
        return True
    if not tenant:
        return False
    try:
        from .views import SubsidyViewSet
        return bool(SubsidyViewSet()._is_payment_staff(user, tenant))
    except Exception:
        return False


def compute_user_work_summary(user, tenant=None):
    """计算用户当前工作汇总：待处理审批/待核验发票/待支付提现/待处理任务 + 今日漏打卡。

    供工作日历接口与每日通知共用；核验/支付计数按角色权限返回。
    """
    from .models import ApprovalRequest, ApprovalAssignee, SubsidyApplication, SubsidyWithdrawal, AttendanceRecord
    from tasks.models import Task

    if tenant is None:
        tenant = user.get_active_tenant()
    tenant_ids = _tenant_ids(tenant) if tenant else [None]

    # 待处理审批：该用户作为审批人，审批节点已到达自己且尚未处理
    assignee_ids = ApprovalAssignee.objects.filter(
        user=user, status='pending'
    ).exclude(
        node__request__applicant=user
    ).filter(
        Q(node__request__status__in=['pending', 'deferred', 'processing']) &
        (
            Q(node__request__approval_mode='parallel') |
            Q(node__request__approval_mode='sequential', node__order__lte=F('node__request__current_node_order'))
        )
    ).values_list('node__request_id', flat=True).distinct()
    pending_approvals = ApprovalRequest.objects.filter(id__in=list(assignee_ids)).distinct().count()

    # 待核验发票（仅超管/核验人员）
    pending_invoices = 0
    if _is_verifier(user, tenant):
        pending_invoices = SubsidyApplication.objects.filter(tenant_id__in=tenant_ids, status='pending').count()

    # 待支付提现（仅超管/财务支付人员）
    pending_withdrawals = 0
    if _is_payment_staff(user, tenant):
        pending_withdrawals = SubsidyWithdrawal.objects.filter(tenant_id__in=tenant_ids, status='pending').count()

    # 待处理任务：该用户作为任务执行人且任务状态为未完成
    pending_tasks = Task.objects.filter(assignee=user, status__in=['todo', 'in_progress']).count()

    # 今日漏打卡：休息日（星期日/法定节假日）或已批准的请假日期不提示未打卡；
    # 其余按用户所参照的考勤配置（部门>子公司>企业默认>父级回溯）判断上下班时间
    miss_clock_in = False
    miss_clock_out = False
    today = timezone.localdate()
    now_time = timezone.localtime().time()
    from .holidays import is_rest_day
    on_leave = ApprovalRequest.objects.filter(
        applicant=user, approval_type='leave', status='approved',
        start_date__lte=today, end_date__gte=today,
    ).exists()
    if not is_rest_day(today) and not on_leave:
        has_in = AttendanceRecord.objects.filter(user=user, date=today, clock_type='clock_in').exists()
        has_out = AttendanceRecord.objects.filter(user=user, date=today, clock_type='clock_out').exists()
        clock_in_limit, clock_out_start = time(9, 0), time(18, 0)
        is_night = False
        try:
            from .views import AttendanceViewSet
            from org.models import UserDepartment
            primary = UserDepartment.objects.filter(user=user, is_primary=True).select_related('department').first()
            cfg = AttendanceViewSet()._get_attendance_config(tenant, primary.department_id if primary else None, user)
            if cfg:
                if cfg.clock_in_enabled and cfg.clock_in_time:
                    clock_in_limit = cfg.clock_in_time
                if cfg.clock_out_enabled and cfg.clock_out_time:
                    clock_out_start = cfg.clock_out_time
                is_night = cfg.shift_type == 'night'
        except Exception:
            pass
        # 上班未打卡：过了上班时间点仍未打卡
        if not has_in and now_time >= clock_in_limit:
            miss_clock_in = True
        # 下班未打卡：过了下班时间点，且当日时间已过 23 点。
        # 夜班下班打卡在次日凌晨，不做当日"忘记下班"提醒。
        if not is_night and not has_out and now_time >= clock_out_start and now_time >= time(23, 0):
            miss_clock_out = True

    # 今日/昨日每日工作总结完成情况
    from .models import DailyWorkSummary
    today_summary_done = DailyWorkSummary.objects.filter(user=user, summary_date=today).exists()
    yesterday_summary_done = DailyWorkSummary.objects.filter(user=user, summary_date=today - timedelta(days=1)).exists()

    return {
        'pending_approvals': pending_approvals,
        'pending_invoices': pending_invoices,
        'pending_withdrawals': pending_withdrawals,
        'pending_tasks': pending_tasks,
        'miss_clock_in': miss_clock_in,
        'miss_clock_out': miss_clock_out,
        'today_summary_done': today_summary_done,
        'yesterday_summary_done': yesterday_summary_done,
    }


def build_daily_digest(summary):
    """由工作汇总生成每日通知的标题/正文/扩展数据"""
    parts = []
    if summary['pending_approvals']:
        parts.append(f'待处理审批 {summary["pending_approvals"]} 项')
    if summary['pending_invoices']:
        parts.append(f'待核验发票 {summary["pending_invoices"]} 张')
    if summary['pending_withdrawals']:
        parts.append(f'待支付提现 {summary["pending_withdrawals"]} 笔')
    if summary['pending_tasks']:
        parts.append(f'待处理任务 {summary["pending_tasks"]} 项')
    if not parts:
        parts.append('暂无待办事项')
    content = '；'.join(parts)
    if summary['miss_clock_in']:
        content += '；今日上班卡未打'
    if summary['miss_clock_out']:
        content += '；今日下班卡未打'
    # 昨日每日工作总结完成情况提示
    yesterday_done = bool(summary.get('yesterday_summary_done'))
    if yesterday_done:
        content += '；昨日工作总结已完成'
    else:
        content += '；昨日工作总结未完成，请及时补充'
    content += '。点击查看工作日历。'
    extra = {
        'type': 'daily',
        'approvals': summary['pending_approvals'],
        'invoices': summary['pending_invoices'],
        'withdrawals': summary['pending_withdrawals'],
        'tasks': summary['pending_tasks'],
        'miss_clock_in': summary['miss_clock_in'],
        'miss_clock_out': summary['miss_clock_out'],
        'yesterday_summary_done': yesterday_done,
    }
    return '今日工作汇总', content, extra


def send_daily_digest_to_user(user, tenant=None):
    """给单个用户发送每日工作汇总通知"""
    try:
        summary = compute_user_work_summary(user, tenant)
        title, content, extra = build_daily_digest(summary)
        from .views import send_work_notification
        send_work_notification(
            user_id=user.id,
            title=title,
            content=content,
            notification_type='daily',
            related_url='/oa/work-calendar/',
            extra_data=extra,
        )
        return True
    except Exception as e:
        logger.warning(f'发送每日汇总给 {user} 失败: {e}')
        return False


@app.task(bind=True)
def run_daily_digest(self):
    """每日定时：遍历开启自动发送的企业，到点后给企业所有活跃用户发送工作汇总。"""
    try:
        from .models import DailyDigestConfig
        today = timezone.localdate()
        now_time = timezone.localtime().time()
        sent = 0
        for cfg in DailyDigestConfig.objects.filter(enabled=True, auto_send=True).select_related('tenant'):
            if cfg.last_sent_date == today:
                continue
            if now_time < cfg.send_time:
                continue
            from accounts.models import CustomUser
            users = CustomUser.objects.filter(
                tenant_memberships__tenant=cfg.tenant,
                tenant_memberships__is_active=True,
                is_active=True,
            ).distinct()
            for u in users:
                if send_daily_digest_to_user(u, cfg.tenant):
                    sent += 1
            cfg.last_sent_date = today
            cfg.save(update_fields=['last_sent_date'])
        logger.info(f'每日工作汇总发送完成，共 {sent} 条')
    except Exception as e:
        logger.warning(f'每日工作汇总任务异常: {e}')


# ==================== 每日工作总结 → 大模型分析 ====================

def check_summary_quota(cfg):
    """第三方依赖风险管控：检查今日 AI 分析调用量/费用限额是否已满。
    返回 (blocked, reason)。触发接近(80%)/已达(100%)阈值时向超管发工作通知（每天仅一次）。
    已达上限时停止调用大模型（降级兜底），保证模块不因超支而失控。"""
    from decimal import Decimal as _D
    try:
        cfg.ensure_today()
    except Exception:
        pass
    if not cfg.limit_enabled:
        return False, ''
    blocked = False
    reason = ''
    near_parts = []
    if cfg.daily_call_limit and cfg.today_call_count >= cfg.daily_call_limit:
        blocked = True
        reason = f'今日 AI 分析次数已达上限（{cfg.today_call_count}/{cfg.daily_call_limit} 次），今日将不再调用大模型分析'
    elif cfg.daily_call_limit and cfg.today_call_count >= int(cfg.daily_call_limit * _D('0.8')):
        near_parts.append(f'今日 AI 分析次数接近上限（{cfg.today_call_count}/{cfg.daily_call_limit} 次）')
    if cfg.daily_cost_limit:
        if float(cfg.today_cost) >= float(cfg.daily_cost_limit):
            if not blocked:
                blocked = True
                reason = f'今日 AI 分析费用已达上限（约 ¥{float(cfg.today_cost):.2f}/{float(cfg.daily_cost_limit):.2f} 元），今日将不再调用大模型分析'
        elif float(cfg.today_cost) >= float(cfg.daily_cost_limit) * 0.8:
            near_parts.append(f'今日 AI 分析费用接近上限（约 ¥{float(cfg.today_cost):.2f}/{float(cfg.daily_cost_limit):.2f} 元）')
    notify = []
    if blocked and not cfg.limit_notified:
        cfg.limit_notified = True
        notify.append(reason)
    if near_parts and not cfg.near_limit_notified:
        cfg.near_limit_notified = True
        notify.extend(near_parts)
    if notify:
        try:
            cfg.save(update_fields=['limit_notified', 'near_limit_notified'])
        except Exception:
            pass
        try:
            from .views import send_work_notification
            from accounts.models import CustomUser
            admins = CustomUser.objects.filter(user_type='super_admin',
                                               tenant_memberships__tenant=cfg.tenant).distinct()
            if not admins.exists():
                admins = CustomUser.objects.filter(user_type='super_admin')
            for ad in admins:
                send_work_notification(ad.id, '每日工作总结 AI 分析限额告警',
                                       '；'.join(notify), notification_type='system',
                                       related_url='/oa/work-summary/')
        except Exception:
            pass
    return blocked, reason


def record_analysis_usage(cfg, usage):
    """分析成功后累计今日调用次数与估算成本，用于限额与成本核算"""
    from decimal import Decimal as _D
    try:
        cfg.ensure_today()
        cfg.today_call_count += 1
        if usage:
            total_tokens = (usage.get('total_tokens')
                            or ((usage.get('prompt_tokens') or 0) + (usage.get('completion_tokens') or 0)))
            if total_tokens:
                cfg.today_cost += (_D(total_tokens) / _D(1000)) * cfg.cost_per_1k_tokens
        cfg.save(update_fields=['today_call_count', 'today_cost'])
    except Exception:
        pass


@app.task(bind=True, max_retries=2, default_retry_delay=10,
          acks_late=True, time_limit=240, soft_time_limit=210)
def analyze_work_summary_task(self, summary_id):
    """每日工作总结 → 火山方舟大模型流式分析，结果流式写入 DailyWorkSummary.analysis_result。
    含第三方依赖降级兜底：调用失败自动重试 2 次，仍失败则标记 failed（总结已保存，用户可稍后点「重新分析」）；
    灰度范围外用户标记 not_allowed；当日限额已满标记 limited，均不再调用大模型。"""
    from .models import DailyWorkSummary, WorkSummaryConfig
    summary = DailyWorkSummary.objects.filter(id=summary_id).first()
    if not summary:
        return {'error': '工作总结不存在'}
    user = summary.user
    try:
        cfg = WorkSummaryConfig.get_config(summary.tenant)
        if not cfg.enabled:
            DailyWorkSummary.objects.filter(id=summary_id).update(
                status='disabled', analysis_result='', error_message='模型分析功能已停用')
            return {'ok': False, 'reason': 'disabled'}
        # 灰度试点：不在分析范围内的员工不调用大模型（总结仍正常保存）
        if not cfg.in_scope(user):
            DailyWorkSummary.objects.filter(id=summary_id).update(
                status='not_allowed', analysis_result='', error_message='当前岗位/部门暂未开放 AI 分析（灰度试点中）')
            return {'ok': False, 'reason': 'not_allowed'}
        # 当日调用量/成本限额已满：降级为不调用大模型
        blocked, reason = check_summary_quota(cfg)
        if blocked:
            DailyWorkSummary.objects.filter(id=summary_id).update(
                status='limited', analysis_result='', error_message=reason)
            return {'ok': False, 'reason': 'limited'}
        DailyWorkSummary.objects.filter(id=summary_id).update(status='analyzing', analysis_result='', error_message='')
        from utils.ark_llm import get_position_system_prompt, build_user_content, stream_ark_completions
        system_prompt = get_position_system_prompt(summary.position)
        tenant_name = summary.tenant.name if summary.tenant else ''
        user_content = build_user_content(summary.position, user.real_name or user.username,
                                          summary.content, summary.files or [],
                                          tenant_name=tenant_name, department_name=_primary_dept_name(user),
                                          mask=cfg.mask_sensitive)
        prompt_text = f'{system_prompt}\n\n----------\n{user_content}'
        DailyWorkSummary.objects.filter(id=summary_id).update(prompt_text=prompt_text)
        # 流式落库：每累计约 300 字符或 1.5 秒即写入一次数据库，保证前端能看到增量内容并流畅打字
        buf = []
        pending = 0
        last_flush = _time.time()

        def flush():
            DailyWorkSummary.objects.filter(id=summary_id).update(analysis_result=''.join(buf))

        def on_chunk(chunk):
            nonlocal pending, last_flush
            buf.append(chunk)
            pending += len(chunk)
            now = _time.time()
            if pending >= 300 or now - last_flush >= 1.5:
                flush()
                pending = 0
                last_flush = now

        full, usage = stream_ark_completions(system_prompt, user_content, on_chunk, model=cfg.effective_model())
        flush()
        record_analysis_usage(cfg, usage)
        DailyWorkSummary.objects.filter(id=summary_id).update(
            status='done', analysis_result=full or '（模型未返回内容）',
            analyzed_at=timezone.now(), error_message='')
        logger.info(f'每日工作总结分析完成: {summary_id} ({user.username}) 长度={len(full or "")}')
        return {'ok': True}
    except Exception as e:
        # 重试耗尽后标记失败并友好提示（总结已保存，用户可稍后点「重新分析」），避免状态悬在 analyzing
        if self.request.retries >= (self.max_retries or 0):
            DailyWorkSummary.objects.filter(id=summary_id).update(
                status='failed', error_message='大模型服务暂时不可用，请稍后点击「重新分析」重试')
            logger.warning(f'每日工作总结分析重试耗尽: {summary_id} {e}')
            return {'error': 'max retries exceeded'}
        raise self.retry(exc=e)


@app.task(bind=True, max_retries=2, default_retry_delay=10,
          acks_late=True, time_limit=240, soft_time_limit=210)
def analyze_work_summary_range_task(self, analysis_id):
    """指定员工 + 日期范围内多天每日总结的批量大模型分析，结果流式写入 WorkSummaryRangeAnalysis.analysis_result"""
    from .models import WorkSummaryRangeAnalysis, DailyWorkSummary, WorkSummaryConfig
    a = WorkSummaryRangeAnalysis.objects.select_related('target_user').filter(id=analysis_id).first()
    if not a:
        return {'error': '范围分析记录不存在'}
    try:
        cfg = WorkSummaryConfig.get_config(a.tenant)
        if not cfg.enabled:
            WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(
                status='disabled', analysis_result='', error_message='模型分析功能已停用')
            return {'ok': False, 'reason': 'disabled'}
        target = a.target_user
        # 灰度试点 + 当日限额：范围分析同样受管控
        if not cfg.in_scope(target):
            WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(
                status='not_allowed', analysis_result='', error_message='该员工当前暂未开放 AI 分析（灰度试点中）')
            return {'ok': False, 'reason': 'not_allowed'}
        blocked, reason = check_summary_quota(cfg)
        if blocked:
            WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(
                status='limited', analysis_result='', error_message=reason)
            return {'ok': False, 'reason': 'limited'}
        WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(status='analyzing', analysis_result='', error_message='')
        qs = DailyWorkSummary.objects.filter(user=target, summary_date__range=[a.date_from, a.date_to]).order_by('summary_date')
        entries = [{'date': str(s.summary_date), 'content': s.content, 'files': s.files or []} for s in qs]
        from utils.ark_llm import get_position_system_prompt, build_range_user_content, stream_ark_completions
        system_prompt = get_position_system_prompt(target.position)
        tenant_name = a.tenant.name if a.tenant else ''
        user_content = build_range_user_content(target.real_name or target.username, target.position,
                                                str(a.date_from), str(a.date_to), entries,
                                                tenant_name=tenant_name, department_name=_primary_dept_name(target),
                                                mask=cfg.mask_sensitive)
        prompt_text = f'{system_prompt}\n\n----------\n{user_content}'
        WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(prompt_text=prompt_text, summary_count=len(entries))
        # 流式落库：每累计约 300 字符或 1.5 秒写入一次，保证前端打字流式可见
        buf = []
        pending = 0
        last_flush = _time.time()

        def flush():
            WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(analysis_result=''.join(buf))

        def on_chunk(chunk):
            nonlocal pending, last_flush
            buf.append(chunk)
            pending += len(chunk)
            now = _time.time()
            if pending >= 300 or now - last_flush >= 1.5:
                flush()
                pending = 0
                last_flush = now

        full, usage = stream_ark_completions(system_prompt, user_content, on_chunk, model=cfg.effective_model())
        flush()
        record_analysis_usage(cfg, usage)
        WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(
            status='done', analysis_result=full or '（模型未返回内容）',
            analyzed_at=timezone.now(), error_message='')
        logger.info(f'每日总结范围分析完成: {analysis_id} 目标={target.username} 条数={len(entries)}')
        return {'ok': True}
    except Exception as e:
        if self.request.retries >= (self.max_retries or 0):
            WorkSummaryRangeAnalysis.objects.filter(id=analysis_id).update(
                status='failed', error_message='大模型服务暂时不可用，请稍后重试')
            logger.warning(f'每日总结范围分析重试耗尽: {analysis_id} {e}')
            return {'error': 'max retries exceeded'}
        raise self.retry(exc=e)
