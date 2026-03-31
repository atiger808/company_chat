# cloud/managers.py - 自定义管理器

from django.db import models


class SoftDeleteManager(models.Manager):
    """软删除管理器"""

    def get_queryset(self):
        # return super().get_queryset().filter(deleted_at__isnull=True)
        return super().get_queryset()

    def all_with_deleted(self):
        """获取所有记录（包括已删除的）"""
        return super().get_queryset()

    def restore(self, *args, **kwargs):
        """恢复已删除的记录"""
        return self.all_with_deleted().filter(*args, **kwargs).update(deleted_at=None)