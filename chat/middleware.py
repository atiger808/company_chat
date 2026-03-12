# -*- coding: utf-8 -*-
# @File   :middleware.py
# @Time   :2026/2/4 13:42
# @Author :admin


# chat/middleware.py
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from urllib.parse import parse_qs

from utils.utils import SystemConfigManager
from django.core.cache import cache


@database_sync_to_async
def get_user(user_id):
    User = get_user_model()
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return None


class TokenAuthMiddleware:
    """
    自定义 Token 认证中间件，用于 WebSocket 连接
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        # 从查询参数中获取 token
        query_string = scope.get('query_string', b'').decode('utf-8')
        query_params = parse_qs(query_string)
        token = query_params.get('token', [None])[0]

        if token:
            try:
                # 验证 token
                UntypedToken(token)
                # 解码 token 获取用户信息
                from rest_framework_simplejwt.authentication import JWTAuthentication
                validated_token = JWTAuthentication().get_validated_token(token)
                user_id = validated_token['user_id']
                user = await get_user(user_id)
                if user:
                    scope['user'] = user
                else:
                    from django.contrib.auth.models import AnonymousUser
                    scope['user'] = AnonymousUser()
            except (InvalidToken, TokenError, KeyError):
                from django.contrib.auth.models import AnonymousUser
                scope['user'] = AnonymousUser()
        else:
            from django.contrib.auth.models import AnonymousUser
            scope['user'] = AnonymousUser()

        return await self.inner(scope, receive, send)


class SystemConfigCacheMiddleware:
    """系统配置缓存中间件 - 确保配置高效读取"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 在请求开始时预加载常用配置到缓存
        common_configs = [
            'file.max_upload_size_mb',
            'chat.max_message_length',
            'voice.max_duration_seconds',
            'security.login_max_attempts',
            'system.user_registration_enabled'
        ]

        for key in common_configs:
            # 预加载配置（如果缓存不存在）
            SystemConfigManager.get_config(key)

        response = self.get_response(request)
        return response