# -*- coding: utf-8 -*-
# 一次性压缩存量用户头像：保留原图到 avatar_original，avatar 存压缩版
# 用法：python manage.py compress_avatars
#
# 说明：压缩源优先取 avatar_original（真正原图，含 EXIF 方向信息），
# 没有时才用当前 avatar，并把它原样存为 avatar_original。这样即使此前
# 已被压缩成旋转 90° 的头像，也能从原图重新压缩出正确方向。
from django.core.management.base import BaseCommand
from django.core.files.base import ContentFile

from accounts.models import CustomUser
from utils.avatar_utils import compress_avatar

DEFAULT_AVATAR = 'avatars/default-avatar.png'


class Command(BaseCommand):
    help = '一次性压缩存量用户头像：原图保留到 avatar_original，avatar 存压缩版（幂等；从原图重新压缩可修复此前旋转 90° 的头像）'

    def handle(self, *args, **options):
        users = CustomUser.objects.exclude(avatar__isnull=True).exclude(avatar='').exclude(avatar=DEFAULT_AVATAR)
        total = users.count()
        self.stdout.write(f'共 {total} 个用户带自定义头像，开始压缩...')
        done = failed = 0
        for u in users.iterator():
            try:
                # 压缩源：优先用原图（含 EXIF 方向），否则用当前头像
                source = u.avatar_original if u.avatar_original else u.avatar
                name = source.name.rsplit('/', 1)[-1] or 'avatar'
                with source.open('rb') as f:
                    data = f.read()
                if not data:
                    failed += 1
                    self.stderr.write(f'  ✗ 用户 {u.id} {u.username} 头像文件为空，跳过')
                    continue
                comp = compress_avatar(ContentFile(data, name=name))
                if not comp:
                    failed += 1
                    self.stderr.write(f'  ✗ 用户 {u.id} {u.username} 压缩失败，保留原样')
                    continue
                # 首次处理：把当前头像原样存为原图（已有原图则保留，避免覆盖）
                if not u.avatar_original:
                    u.avatar_original.save('orig_' + name, ContentFile(data), save=False)
                # 保存压缩版为新文件名（路径变化可刷新浏览器缓存），并删除旧的头像文件
                old_path = u.avatar.name
                u.avatar.save(name, comp, save=False)
                if old_path and old_path != u.avatar.name:
                    try:
                        u.avatar.storage.delete(old_path)
                    except Exception:
                        pass
                u.save(update_fields=['avatar', 'avatar_original'])
                done += 1
            except Exception as e:
                failed += 1
                self.stderr.write(f'  ✗ 用户 {u.id} {u.username} 处理异常: {e}')
        self.stdout.write(self.style.SUCCESS(f'完成：压缩 {done}，失败 {failed}'))
