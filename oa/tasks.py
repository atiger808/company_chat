# -*- coding: utf-8 -*-
"""普惠补贴 OCR 异步任务

将耗时较长的票据 OCR 识别放入 Celery 后台执行，
Web 请求立即返回 task_id，前端轮询 /api/oa/subsidy/ocr-status/ 获取结果，
避免同步 OCR 长时间占用 Gunicorn worker。
"""
import os
from datetime import time

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
        logger.info(f'异步OCR({ocr_version}) 结果: {result}')
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

    return {
        'pending_approvals': pending_approvals,
        'pending_invoices': pending_invoices,
        'pending_withdrawals': pending_withdrawals,
        'pending_tasks': pending_tasks,
        'miss_clock_in': miss_clock_in,
        'miss_clock_out': miss_clock_out,
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
    content += '。点击查看工作日历。'
    extra = {
        'type': 'daily',
        'approvals': summary['pending_approvals'],
        'invoices': summary['pending_invoices'],
        'withdrawals': summary['pending_withdrawals'],
        'tasks': summary['pending_tasks'],
        'miss_clock_in': summary['miss_clock_in'],
        'miss_clock_out': summary['miss_clock_out'],
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
