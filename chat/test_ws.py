# chat/test_ws.py - 修复版
import asyncio
import websockets
import os
import sys

# 添加项目路径
sys.path.insert(0, '/www/yue/company_chat')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'company_chat.settings')

import django

django.setup()

from accounts.models import CustomUser
from rest_framework_simplejwt.tokens import AccessToken


# token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzc4NjYzMDc2LCJpYXQiOjE3Nzg2MzQyNzYsImp0aSI6IjZlZmI3NDg1YjA1ZTQ2OTg5MzVmOWM1ZjAwYjNhNzljIiwidXNlcl9pZCI6NX0.jlhq0yb_j4M4fhXHZqNph_D8ZP0E35FpGk4DA7uRhx8"


async def test_call_ws():
    # 🔧 关键修复1: 使用真实用户生成有效 token
    try:
        user = await CustomUser.objects.aget(username='testuser')  # 替换为你的测试用户
        token = str(AccessToken.for_user(user))
        print(f"✅ 生成 token: {token[:30]}...")
    except Exception as e:
        print(f"❌ 生成 token 失败: {e}")
        return

    # 🔧 关键修复2: 正确构造 wss URL（含 token 参数）
    token_encoded = websockets.http.encode_uri_component(token)  # URL 编码
    url = f"wss://chat.first-iq.com/ws/call/114/?token={token_encoded}"

    print(f"🔗 尝试连接: {url[:80]}...")

    try:
        async with websockets.connect(
                url,
                # 🔧 关键修复3: 添加必要头（某些服务器需要）
                extra_headers={
                    'Origin': 'https://chat.first-iq.com',
                    'Host': 'chat.first-iq.com'
                },
                # 🔧 关键修复4: 禁用证书验证（仅测试用，生产环境移除）
                ssl=False  # ⚠️ 生产环境应使用 ssl=True 并配置证书
        ) as websocket:
            print("✅ 连接成功！")

            # 发送测试消息
            await websocket.send('{"type": "ping"}')
            response = await websocket.recv()
            print(f"📨 收到: {response}")

    except websockets.exceptions.InvalidStatusCode as e:
        print(f"❌ HTTP 错误: {e.status_code}")
        if e.status_code == 403:
            print("💡 403 可能原因:")
            print("   1. Token 无效或已过期")
            print("   2. Nginx 未正确代理 /ws/ 路径")
            print("   3. CallConsumer 未正确解析 token")
    except Exception as e:
        print(f"❌ 连接错误: {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(test_call_ws())

