# -*- coding: utf-8 -*-
import json
import logging
import time
from django.conf import settings
from .models import PushSubscription
from loguru import logger


def _send_via_relay(relay_url, sub, payload, ttl, urgent, endpoint_short):
    """通过海外推送中继发送（FCM 不可达时，避免国内服务器直连 Google）"""
    import requests as http_client
    try:
        r = http_client.post(
            relay_url + '/push',
            json={
                'endpoint': sub.endpoint,
                'keys': {'p256dh': sub.p256dh, 'auth': sub.auth},
                'payload': payload,
                'ttl': ttl,
                'urgent': urgent,
                'secret': getattr(settings, 'PUSH_RELAY_SECRET', '') or '',
            },
            timeout=(5, 15),
        )
        data = r.json()
        if data.get('ok'):
            logger.info(f'push OK (relay) user={sub.user_id} status={data.get("status")} {endpoint_short}')
            return True
        status = data.get('status')
        if status in (404, 410):
            try:
                sub.delete()
            except Exception:
                pass
            logger.warning(f'push 中继:订阅失效已删除 user={sub.user_id} status={status} {endpoint_short}')
        else:
            logger.warning(f'push 中继失败 user={sub.user_id} status={status} {endpoint_short}: {data.get("error")}')
        return False
    except Exception as e:
        logger.warning(f'push 中继请求失败 user={sub.user_id} {endpoint_short}: {e}')
        return False


def send_push(sub, payload, ttl=0, urgent=False):
    """发送单条 Web Push，订阅失效（404/410）自动删除"""
    if not settings.PUSH_ENABLED:
        return False
    endpoint_short = sub.endpoint[:60]
    try:
        # 🔧 FCM（安卓/鸿蒙）：国内服务器无法直连 Google 时，若配置了海外推送中继则走中继
        relay_url = (getattr(settings, 'PUSH_RELAY_URL', '') or '').rstrip('/')
        if relay_url and 'fcm.googleapis.com' in sub.endpoint:
            logger.info(f'push 中继:使用中继 {endpoint_short}')
            relay_ok = _send_via_relay(relay_url, sub, payload, ttl, urgent, endpoint_short)
            # 中继失败但配置了 PUSH_PROXY（国内可达的 HTTP(S) 代理）时，回退到 pywebpush 直连兜底
            if relay_ok or not getattr(settings, 'PUSH_PROXY', ''):
                return relay_ok
            logger.warning(f'push 中继失败，尝试 PUSH_PROXY 直连兜底 user={sub.user_id} {endpoint_short}')
        from pywebpush import webpush
        import inspect
        # 检查当前 pywebpush 的 webpush() 支持哪些参数，只传支持的——
        # 兼容老版本（有的不支持 urgency / requests_kwargs），保证不升级也能发送成功。
        try:
            params = set(inspect.signature(webpush).parameters)
        except (ValueError, TypeError):
            params = None

        all_kwargs = {
            'subscription_info': {
                'endpoint': sub.endpoint,
                'keys': {'p256dh': sub.p256dh, 'auth': sub.auth},
            },
            'data': json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            'vapid_private_key': settings.VAPID_PRIVATE_KEY,
            'vapid_claims': {'sub': 'mailto:' + settings.VAPID_ADMIN_EMAIL},
            'ttl': ttl,
        }

        # 请求参数：始终加超时，避免 FCM 不可达时长时间挂起（曾单次任务挂 521 秒）
        requests_kwargs = {'timeout': (5, 10)}
        if urgent:
            # 高优即时送达（新版 pywebpush 支持 requests_kwargs 设置 Urgency 头）
            requests_kwargs['headers'] = {'Urgency': 'high'}
        # 安卓/鸿蒙使用 FCM（fcm.googleapis.com），国内服务器可能无法直连 Google，
        # 支持通过配置 PUSH_PROXY 走可用的 HTTP(S) 代理转发。
        if 'fcm.googleapis.com' in sub.endpoint:
            proxy = getattr(settings, 'PUSH_PROXY', '') or ''
            if proxy:
                requests_kwargs['proxies'] = {'http': proxy, 'https': proxy}
                logger.info(f'FCM 推送走代理 {endpoint_short}')
        all_kwargs['requests_kwargs'] = requests_kwargs

        if params is not None:
            kwargs = {k: v for k, v in all_kwargs.items() if k in params}
        else:
            kwargs = all_kwargs
        resp = webpush(**kwargs)
        # 便于排查：每次发送记录状态码（iOS/APNs 与 Android/FCM 端点都可能出现）
        code = getattr(resp, 'status_code', None)
        logger.info(f'push OK  user={sub.user_id} status={code} urgent={urgent} {endpoint_short}')
        return True
    except Exception as e:
        logger.error(f'push 发送失败 user={sub.user_id} {endpoint_short}: {e}')
        # pywebpush 的 WebPushException 有 response，其它异常可能是网络/密钥问题
        status = getattr(getattr(e, 'response', None), 'status_code', None)
        if status in (404, 410):
            try:
                sub.delete()
            except Exception:
                pass
            logger.warning(f'push 订阅已失效并删除 user={sub.user_id} status={status} {endpoint_short}')
        else:
            logger.warning(f'push 发送失败 user={sub.user_id} status={status} {endpoint_short}: {e}')
        return False


def is_ws_online(user_id):
    """用户全局通知 WS 组是否非空（任何页面打开即视为在线）"""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channels = async_to_sync(get_channel_layer().group_channels)(f'user_{user_id}_notifications')
        return bool(channels)
    except Exception:
        return False


def build_call_push_payload(room_id, caller, media_type='audio'):
    """来电 Web Push 载荷（后台/锁屏也能收到来电提醒）"""
    label = '视频通话' if media_type == 'video' else '语音通话'
    name = getattr(caller, 'real_name', None) or getattr(caller, 'username', '') or '未知用户'
    return {
        'type': 'call_notification',
        'title': label,
        'body': f'{name} 正在呼叫您',
        'icon': caller.get_avatar_url() if hasattr(caller, 'get_avatar_url') else '/static/images/default-avatar.png',
        'badge': '/static/images/notification-badge.png',
        'tag': f'call-{room_id}',
        'data': {
            'kind': 'call',
            'call_type': media_type,
            'room_id': str(room_id),
            'chat_room': str(room_id),
            'caller_id': str(caller.id),
            'caller_name': name,
            'url': f'/chat/?room={room_id}',
        },
    }


def build_chat_push_payload(nd, sender):
    """聊天消息 push payload（明文 JSON，SW 直接展示）"""
    content = nd.get('content') or ''
    msg_type = nd.get('message_type')
    if msg_type and msg_type != 'text':
        type_map = {'image': '图片', 'file': '文件', 'voice': '语音', 'video': '视频',
                    'audio': '音频', 'emoji': '表情', 'location': '位置',
                    'call_audio': '语音通话', 'call_video': '视频通话'}
        content = f'[{type_map.get(msg_type, "消息")}]'
        # 🔧 通话状态补充，未接听最醒目
        if msg_type in ('call_audio', 'call_video'):
            status = nd.get('call_status')
            if status == 'missed':
                content = f'[未接听的{type_map[msg_type]}]'
            elif status == 'rejected':
                content = f'[{type_map[msg_type]}] 已拒绝'
            elif status == 'cancelled':
                content = f'[{type_map[msg_type]}] 已取消'
    return {
        'type': 'new_message',
        'title': sender.real_name or sender.username,
        'body': content,
        'icon': sender.get_avatar_url() if hasattr(sender, 'get_avatar_url') else '/static/images/default-avatar.png',
        'badge': '/static/images/notification-badge.png',
        # 🔧 tag 必须每条消息唯一：同一 tag 会被系统折叠/替换，iOS 上替换时不重新提醒，
        # 导致回到主屏幕/锁屏后"只能收到一次推送"。带 message_id 保证每条都独立提醒；
        # 若 message_id 缺失则用毫秒时间戳兜底，确保绝不折叠。
        'tag': f'chat-{nd.get("chat_room", "")}-{nd.get("message_id") or int(time.time() * 1000)}',
        'data': {
            'kind': 'chat',
            'chat_room': nd.get('chat_room', ''),
            'message_id': str(nd.get('message_id', '')),
            'url': f'/chat/?room={nd.get("chat_room", "")}',
        },
    }


def build_work_push_payload(note, related_url):
    """工作通知 push payload（审批/考勤/任务/协作）"""
    return {
        'type': 'work_notification',
        'title': note.title,
        'body': note.content,
        'icon': '/static/images/logo.png',
        'badge': '/static/images/notification-badge.png',
        'tag': f'work-{note.id}',
        'data': {
            'kind': 'work',
            'notification_id': note.id,
            'url': related_url or '/chat/',
        },
    }
