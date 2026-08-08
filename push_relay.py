#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
海外推送中继服务
================
解决国内服务器无法直连 Google FCM（fcm.googleapis.com）导致安卓/鸿蒙收不到推送的问题。

原理：把「发送 Web Push」这一步放到一台能访问 Google 的海外服务器上执行。
主站（国内）把订阅信息 + 载荷通过 HTTPS 转发给本服务，本服务调用 pywebpush 发送到
FCM / APNs。主站在 .env 配置 PUSH_RELAY_URL 指向本服务即可。

部署（海外服务器，例如香港/新加坡 VPS）：
    pip install fastapi uvicorn pywebpush
    export PUSH_RELAY_SECRET=你的共享密钥
    export VAPID_PRIVATE_KEY=与主站同一把 VAPID 私钥
    export VAPID_ADMIN_EMAIL=admin@first-iq.com
    python push_relay.py          # 监听 0.0.0.0:8001

建议用 nginx + HTTPS 反代到 8001，保证主站到中继全程加密。
"""
import json
import os
from loguru import logger

from fastapi import FastAPI, Request, HTTPException
from pywebpush import webpush
import uvicorn

app = FastAPI(title="企业聊天室推送中继")

RELAY_SECRET = os.getenv('PUSH_RELAY_SECRET', '') or 'WwjzK4RuVWHxVq5ZKE7p'
VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY', '') or 'pwARQEpDxXEayy8oavqCx98o_s3_fg_WL7aYWvcts00'
VAPID_ADMIN_EMAIL = os.getenv('VAPID_ADMIN_EMAIL', 'ole211@qqfirst-iq.com')

logger.info(f'push 中继:启动 {RELAY_SECRET}')
@app.post("/push")
async def push(req: Request):
    data = await req.json()
    if RELAY_SECRET and data.get('secret') != RELAY_SECRET:
        logger.warning(f'push 中继:非法请求 {data}')
        raise HTTPException(status_code=403, detail='unauthorized')

    endpoint = data.get('endpoint')
    keys = data.get('keys') or {}
    payload = data.get('payload') or {}
    ttl = data.get('ttl', 0)
    urgent = data.get('urgent', False)

    if not endpoint or not keys.get('p256dh') or not keys.get('auth'):
        logger.warning(f'push 中继:非法参数 {data}')
        raise HTTPException(status_code=400, detail='endpoint/keys 必填')
    if not VAPID_PRIVATE_KEY:
        logger.warning(f'push 中继:未配置 VAPID_PRIVATE_KEY')
        raise HTTPException(status_code=500, detail='VAPID_PRIVATE_KEY 未配置')

    requests_kwargs = {'timeout': (5, 10)}
    if urgent:
        # 高优即时送达（新版 pywebpush 支持 requests_kwargs 设置 Urgency 头）
        logger.info(f'push 中继:高优即时送达 {endpoint[:60]}')
        requests_kwargs['headers'] = {'Urgency': 'high'}

    try:
        # 兼容旧版 pywebpush：只传该版本支持的参数（有的不支持 requests_kwargs）
        import inspect
        try:
            params = set(inspect.signature(webpush).parameters)
        except (ValueError, TypeError):
            params = None

        all_kwargs = {
            'subscription_info': {'endpoint': endpoint, 'keys': keys},
            'data': json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            'vapid_private_key': VAPID_PRIVATE_KEY,
            'vapid_claims': {'sub': 'mailto:' + VAPID_ADMIN_EMAIL},
            'ttl': ttl,
        }
        if params is not None and 'requests_kwargs' in params:
            all_kwargs['requests_kwargs'] = requests_kwargs

        if params is not None:
            kwargs = {k: v for k, v in all_kwargs.items() if k in params}
        else:
            kwargs = all_kwargs

        # 🔧 关键：webpush 是阻塞 IO，在 async 端点里直接调用会阻塞事件循环，
        # 导致并发请求被串行处理（10 个订阅=每个6秒=累计超时）。改用线程池执行，保证并发。
        from starlette.concurrency import run_in_threadpool
        resp = await run_in_threadpool(webpush, **kwargs)
        logger.info(f'push 中继:OK {endpoint[:60]}')
        return {'ok': True, 'status': getattr(resp, 'status_code', None)}
    except Exception as e:
        status = getattr(getattr(e, 'response', None), 'status_code', None)
        logger.error(f'push 中继失败: {e}')
        return {'ok': False, 'status': status, 'error': str(e)}


@app.get("/health")
async def health():
    return {'ok': True, 'relay_ready': bool(VAPID_PRIVATE_KEY)}


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8001)
