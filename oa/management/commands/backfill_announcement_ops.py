# -*- coding: utf-8 -*-
"""回填集团公告操作留痕（AnnouncementOperation）。

历史原因：公告留痕写入曾因外键传主键的写法被 Django 拒绝且异常被静默吞掉，
导致留痕表长期为空，工作日历看不到公告相关操作。此命令按现有数据重建：

- 每条还没有「内容操作」留痕的公告，按状态补一条：
  已发布 → publish（时间取 published_at，缺失则 created_at）；未发布 → draft（时间取 created_at）；
- 每条还没有「评论」留痕的公告，按其历史评论逐条补 comment（时间、评论人取原评论）。

幂等：只补缺失的部分，可重复执行。用法：
    python manage.py backfill_announcement_ops [--dry-run]
"""
from django.core.management.base import BaseCommand

from oa.models import Announcement, AnnouncementComment, AnnouncementOperation


class Command(BaseCommand):
    help = '回填集团公告操作留痕（发布/存草稿/评论），供工作日历统计；幂等，可重复执行'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='只统计将要补写的条数，不写入')

    def handle(self, *args, **options):
        dry = options.get('dry_run')
        has_pub = set(AnnouncementOperation.objects.filter(
            announcement__isnull=False).exclude(action='comment')
            .values_list('announcement_id', flat=True))
        has_cmt = set(AnnouncementOperation.objects.filter(
            announcement__isnull=False, action='comment')
            .values_list('announcement_id', flat=True))

        n_pub = n_cmt = 0
        for a in Announcement.objects.select_related('author').iterator():
            title = (a.title or '')[:200]
            if a.id not in has_pub and a.author_id:
                action = 'publish' if a.is_published else 'draft'
                ts = a.published_at or a.created_at
                if not dry:
                    op = AnnouncementOperation.objects.create(
                        tenant_id=a.tenant_id, user_id=a.author_id,
                        announcement_id=a.id, action=action, title=title)
                    if ts:
                        AnnouncementOperation.objects.filter(pk=op.pk).update(created_at=ts)
                n_pub += 1
            if a.id not in has_cmt:
                for c in AnnouncementComment.objects.filter(announcement_id=a.id).iterator():
                    if not c.author_id:
                        continue
                    if not dry:
                        op = AnnouncementOperation.objects.create(
                            tenant_id=a.tenant_id, user_id=c.author_id,
                            announcement_id=a.id, action='comment', title=title)
                        AnnouncementOperation.objects.filter(pk=op.pk).update(created_at=c.created_at)
                    n_cmt += 1

        prefix = '[试运行] 将补写' if dry else '已补写'
        self.stdout.write(self.style.SUCCESS(
            f'{prefix}公告内容留痕 {n_pub} 条、评论留痕 {n_cmt} 条；'
            f'当前留痕总数 {AnnouncementOperation.objects.count()}'))
