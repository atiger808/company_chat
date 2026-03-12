# -*- coding: utf-8 -*-
# @File   :utils.py
# @Time   :2026/3/12 11:40
# @Author :admin


# 系统配置工具类

from django.core.cache import cache
from chat.models import SystemConfig
# import logging
# logger = logging.getLogger(__name__)

from loguru import logger


class SystemConfigManager:
    """系统配置管理器 - 确保配置实际生效"""

    # 🔧 关键修复：使用与 settings.py 一致的缓存键前缀
    CACHE_PREFIX = 'company_chat:config:'  # ✅ 添加前缀避免冲突
    CACHE_TIMEOUT = 300  # 5 分钟缓存

    @classmethod
    def get_config(cls, key, default=None):
        """获取配置值（带缓存）"""
        # 🔧 使用统一前缀构建缓存键
        cache_key = f'{cls.CACHE_PREFIX}{key}'

        # 先从缓存获取
        value = cache.get(cache_key)
        if value is not None:
            return value

        # 从数据库获取
        try:
            config = SystemConfig.objects.get(key=key)
            value = config.get_typed_value()
            # 写入缓存（使用统一前缀）
            cache.set(cache_key, value, cls.CACHE_TIMEOUT)
            return value
        except SystemConfig.DoesNotExist:
            # 返回默认值
            from chat.views import SystemSettingsViewSet
            predefined = SystemSettingsViewSet.PREDEFINED_CONFIGS.get(key, {})
            default_value = predefined.get('default', default)

            # 类型转换
            value_type = predefined.get('value_type', 'string')
            if value_type == 'integer':
                return int(default_value) if str(default_value).isdigit() else default
            elif value_type == 'boolean':
                return str(default_value).lower() in ('true', '1', 'yes')
            elif value_type == 'json':
                import json
                try:
                    return json.loads(default_value)
                except:
                    return default

            return default_value

    @classmethod
    def set_config(cls, key, value, user=None):
        """设置配置值（清除缓存）"""
        from chat.models import SystemConfig
        from chat.views import SystemSettingsViewSet

        predefined = SystemSettingsViewSet.PREDEFINED_CONFIGS.get(key, {})
        value_type = predefined.get('value_type', 'string')

        config, created = SystemConfig.objects.update_or_create(
            key=key,
            defaults={
                'name': predefined.get('name', key),
                'value': str(value),
                'value_type': value_type,
                'category': predefined.get('category', 'basic'),
                'updated_by': user
            }
        )

        # 🔧 关键：清除缓存（使用统一前缀）
        cache_key = f'{cls.CACHE_PREFIX}{key}'
        cache.delete(cache_key)

        # 清除所有配置缓存（确保一致性）
        cache.delete(f'{cls.CACHE_PREFIX}all')

        logger.info(f'配置更新：{key} = {value}')
        return config

    @classmethod
    def invalidate_cache(cls, key=None):
        """使配置缓存失效"""
        if key:
            cache.delete(f'{cls.CACHE_PREFIX}{key}')
        else:
            # 清除所有配置缓存
            # 注意：django-redis 不支持 pattern 删除，需手动遍历
            from django_redis import get_redis_connection
            try:
                redis_conn = get_redis_connection("default")
                keys = redis_conn.keys(f'{cls.CACHE_PREFIX}*')
                if keys:
                    redis_conn.delete(*keys)
            except Exception as e:
                logger.warning(f'批量清除缓存失败：{e}')
                # 降级方案：清除所有缓存
                cache.clear()