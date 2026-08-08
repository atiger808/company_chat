# -*- coding: utf-8 -*-
import logging
from django.conf import settings
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import PushSubscription
from loguru import logger


class VapidPublicKeyView(APIView):
    """公开：前端订阅前获取 VAPID 公钥（无需登录）"""
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({'public_key': settings.VAPID_PUBLIC_KEY, 'enabled': settings.PUSH_ENABLED})


class PushSubscriptionView(APIView):
    """登录用户的 Push 订阅管理"""
    permission_classes = [permissions.IsAuthenticated]
    # 🔧 每个用户最多保留的订阅数：避免长期重复订阅/密钥轮换导致几十上百条陈旧
    # token 堆积（日志里曾出现 91 条：每条消息都发 91 次、延迟明显、旧 token 收不到推送）。
    MAX_SUBS_PER_USER = 10

    def post(self, request):
        endpoint = request.data.get('endpoint')
        keys = request.data.get('keys', {}) or {}
        p256dh = keys.get('p256dh')
        auth = keys.get('auth')
        if not all([endpoint, p256dh, auth]):
            return Response({'error': 'endpoint/p256dh/auth 必填'}, status=400)
        sub, created = PushSubscription.objects.update_or_create(
            user=request.user, endpoint=endpoint,
            defaults={
                'p256dh': p256dh,
                'auth': auth,
                'user_agent': request.META.get('HTTP_USER_AGENT', '')[:500],
            })
        # 🔧 便于排查：记录订阅来源（设备/浏览器），判断设备是否真的订阅成功
        logger.info(f'push 订阅 {"新增" if created else "更新"} user={request.user.id} endpoint={endpoint[:60]} '
                    f'UA={request.META.get("HTTP_USER_AGENT", "")[:100]}')

        # 超过上限则删除该用户最旧的订阅
        try:
            user_count = PushSubscription.objects.filter(user=request.user).count()
            if user_count > self.MAX_SUBS_PER_USER:
                excess_ids = list(
                    PushSubscription.objects.filter(user=request.user)
                    .order_by('updated_at')
                    .values_list('id', flat=True)[:user_count - self.MAX_SUBS_PER_USER]
                )
                if excess_ids:
                    PushSubscription.objects.filter(id__in=excess_ids).delete()
        except Exception:
            pass

        return Response({'ok': True, 'id': sub.id, 'created': created})

    def delete(self, request):
        endpoint = request.data.get('endpoint') or request.query_params.get('endpoint')
        if not endpoint:
            return Response({'error': '缺少 endpoint'}, status=400)
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({'ok': True})


class PushSubscriptionListView(APIView):
    """当前用户的 Push 订阅列表（用于排查「安卓 subs=0」等投递问题）"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        subs = PushSubscription.objects.filter(user=request.user).order_by('-updated_at')
        data = [{
            'id': s.id,
            'endpoint_host': s.endpoint.split('/')[2] if '/' in s.endpoint else s.endpoint[:60],
            'is_fcm': 'fcm.googleapis.com' in s.endpoint,
            'user_agent': s.user_agent[:120],
            'created_at': s.created_at.isoformat() if s.created_at else '',
            'updated_at': s.updated_at.isoformat() if s.updated_at else '',
        } for s in subs]
        return Response({'count': len(data), 'subscriptions': data})
