# -*- coding: utf-8 -*-
"""修复历史审批里「审批金额」与「表单金额」不一致的数据。

历史原因：在「新建审批」弹窗里先选了某个审批类型（例如内置的报销）填了金额，没提交就
切换到另一个类型（例如自定义的付款申请单）提交时，前端会把上一个类型残留的金额一并提交，
于是审批记录上的 amount（审批金额，列表/详情里显示的那个）与 form_data 里表单的实际金额
对不上。

修复口径与线上新逻辑一致：
- 报销 / 采购 / 出差：金额原本就由这几个类型自己的字段决定，不改动；
- 其它类型（自定义类型、带表单的内置类型）：审批金额一律取「该类型 schema 里的金额字段」
  在 form_data 中的值（优先 key=amount，其次第一个 type=amount 的顶层字段；例如入库单取
  actual_amount）。表单里没填 → 金额清空。

幂等：金额已经一致的不动，可重复执行。用法：
    python manage.py backfill_approval_amount [--dry-run]
"""
from django.core.management.base import BaseCommand
from oa.models import ApprovalRequest
from oa.type_utils import resolve_approval_type

# 这些类型的金额本来就不来自「表单金额字段」，不参与修复
SKIP_TYPES = ('expense', 'purchase', 'trip')


def _schema_amount_key(type_obj):
    """取 schema 里的金额字段 key：优先 amount，其次第一个顶层 type=amount 的字段"""
    schema = (getattr(type_obj, 'form_schema', None) or []) if type_obj else []
    first = None
    for f in schema:
        if not isinstance(f, dict) or f.get('type') != 'amount':
            continue
        if f.get('key') == 'amount':
            return 'amount'
        if first is None:
            first = f.get('key')
    return first


class Command(BaseCommand):
    help = '修复「审批金额」与「表单金额字段」不一致的历史审批数据；幂等，可重复执行'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='只统计将要修改的条数，不写入')

    def handle(self, *args, **options):
        dry = options.get('dry_run')
        qs = (ApprovalRequest.objects
              .exclude(approval_type__in=SKIP_TYPES)
              .select_related('tenant')
              .order_by('id'))

        scanned = fixed = skipped_no_schema = 0
        samples = []
        for ap in qs.iterator():
            scanned += 1
            type_obj = resolve_approval_type(ap.approval_type, ap.tenant)
            key = _schema_amount_key(type_obj)
            if not key:
                # 该类型 schema 里没有金额字段（含请假/加班/招聘等）→ 审批金额应为空
                skipped_no_schema += 1
            form_data = ap.form_data or {}
            raw = form_data.get(key) if key else None
            if raw in (None, ''):
                expect = None
            else:
                try:
                    expect = round(float(raw), 2)
                except (TypeError, ValueError):
                    continue
            cur = float(ap.amount) if ap.amount is not None else None
            if cur is not None:
                cur = round(cur, 2)
            if cur == expect:
                continue
            fixed += 1
            if len(samples) < 10:
                samples.append(f'#{ap.id} {ap.approval_type} {key or "(无金额字段)"}: {cur} → {expect}')
            if not dry:
                ap.amount = expect
                ap.save(update_fields=['amount'])

        prefix = '[试运行] 将修复' if dry else '已修复'
        self.stdout.write(self.style.SUCCESS(
            f'{prefix} {fixed} 条 / 共扫描 {scanned} 条（其中 {skipped_no_schema} 条类型无金额字段）；'
            f'金额已一致的不改动'))
        for s in samples:
            self.stdout.write('  ' + s)
