# -*- coding: utf-8 -*-
from django.core.management.base import BaseCommand
from chat.models import PushSubscription


class Command(BaseCommand):
    help = '限制每个用户最多 N 条 Push 订阅，删除最旧的（清理重复订阅/密钥轮换堆积的陈旧 token）'

    def handle(self, *args, **options):
        max_subs = 10
        deleted = 0
        user_ids = PushSubscription.objects.values_list('user_id', flat=True).distinct()
        for uid in user_ids:
            subs = list(PushSubscription.objects.filter(user_id=uid).order_by('-updated_at'))
            count = len(subs)
            if count > max_subs:
                excess = [s.id for s in subs[max_subs:]]
                PushSubscription.objects.filter(id__in=excess).delete()
                deleted += len(excess)
                self.stdout.write(f'用户 {uid}: {count} -> {max_subs}（删除 {len(excess)}）')
        self.stdout.write(self.style.SUCCESS(f'清理完成，共删除 {deleted} 条陈旧订阅'))
