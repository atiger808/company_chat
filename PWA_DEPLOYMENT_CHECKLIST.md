# 企业聊天室 PWA 部署与测试清单

> 本文档供服务器部署与多端验证使用。核心目标：**用户把聊天室添加为主屏 App 后，回到主屏幕/锁屏仍能实时收到消息通知**（Web Push），并适配 iOS/Android/iPad/HarmonyOS/Windows/Mac 各类终端。

---

## 一、服务器部署步骤

### 1. 依赖安装
```bash
cd /path/to/company_chat
pip install -r requirements.txt     # 含 pywebpush==2.2.1（Web Push 必需）
# 确认 redis 已启动（channels 与 celery 依赖）
```

### 2. 配置 VAPID 密钥
Web Push 需要 VAPID 公/私钥。本项目已在本机 `.env` 生成，把这三行复制到**服务器 `.env`**（如果服务器此前没有）：

```bash
VAPID_PUBLIC_KEY=<从本地 .env 复制>
VAPID_PRIVATE_KEY=<从本地 .env 复制>
VAPID_ADMIN_EMAIL=admin@first-iq.com
```

> 若服务器上想重新生成，可执行 `python manage.py gen_vapid_keys`（用 cryptography 直接生成，不依赖 py_vapid 版本 API）并将输出追加到 `.env`。**同一套公钥/私钥必须配对，前端用公钥订阅、后端用私钥签名。**
>
> 验证：`PUSH_ENABLED` 由 `VAPID_PUBLIC_KEY` 与 `VAPID_PRIVATE_KEY` 是否都存在决定，两者齐全后才为 `True`。

### 3. 数据库迁移（新增 PushSubscription 表）
```bash
python manage.py makemigrations chat   # 若 0006_pushsubscription.py 已存在且未被识别，可跳过
python manage.py migrate
```

### 4. 静态文件
```bash
python manage.py collectstatic --noinput
```
本次新增图标：`static/icons/icon-180x180.png`、`icon-167x167.png`、`icon-144x144.png`。
Service Worker 通过根路径视图 `/service-worker.js` 提供（见 `company_chat/views.py`），不需要 collectstatic 额外处理，但需确保该视图可读 `static/js/service-worker.js`。

### 5. 重启服务
重启后端 ASGI 服务（daphne/uvicorn）与 Celery（worker + beat）。`send_push_task` 是异步 Celery 任务，**必须保证 celery worker 在跑**，否则推送不会发出。

```
重启 daphne（或 gunicorn/uvicorn asgi）
重启 celery worker：celery -A company_chat worker -l info
重启 celery beat（若用 beat 调度）
nginx 无需改动（同域 HTTPS）
```

### 6. 部署后冒烟检查
| 检查项 | 期望结果 |
| --- | --- |
| `curl -I https://<域名>/service-worker.js` | `200`，且响应头含 `Service-Worker-Allowed: /` |
| `curl https://<域名>/api/chat/push/vapid-public-key/` | `{"public_key": "...", "enabled": true}` |
| `curl -I https://<域名>/static/icons/icon-180x180.png` | `200` |
| 浏览器打开 https://<域名>/chat/ → DevTools → Application → Service Workers | 已注册，scope 为 `/`，处于 activated |

---

## 二、Web Push 说明与限制

- **协议要求**：Push 必须 HTTPS（已满足，`https://chat.first-iq.com`）。`localhost` 例外。
- **iOS（重要）**：iOS 16.4+ 才支持 Web Push，且**必须**先通过 Safari「添加到主屏幕」安装为 App，再从 App 内授权通知。iOS 通知授权**必须由用户手势触发**（点击/触摸），页面加载时自动调用 `requestPermission()` 不会弹窗、甚至可能影响后续授权——代码已改为：首次点击/触摸时请求 + 一次性引导横幅「开启通知」按钮请求，不在加载时自动请求。
  - 若用户之前已**拒绝**过通知，iOS 不会重新弹窗，需到「设置 → 通知 → 本应用」手动开启。
  - 若用户从任务管理器**上滑划掉**（force-quit）App，iOS 会暂停推送，需重新打开一次 App 后才恢复（Apple 限制）。
- **Android / Windows / HarmonyOS / Mac**：基于 Chromium 的浏览器均支持 Web Push + 安装 PWA。
- **一律推送、不去重**：Service Worker 收到推送后**总是展示系统通知**，不做任何前台/房间去重——无论应用是否打开/前台，**每条新消息、每条工作通知都会触发一次系统通知**（含锁屏/回到主屏幕/后台）。若应用前台也在使用，可能与页面内实时消息同时出现，属预期行为。
- **每条消息独立提醒**：推送通知的 `tag` 按 `chat-房间-消息ID` 唯一生成（缺 message_id 时用毫秒时间戳兜底），同一房间的多条消息不会被系统折叠/替换——**每一条都会独立提醒**。工作通知的 tag 同样按通知 ID 唯一。
- **TTL**：推送 TTL 设为 12 小时，长时间离线后回到 App 也能补收到最近消息。

---

## 二·五、FCM 不可达时的解决方案（安卓/鸿蒙收不到推送）

安卓/鸿蒙 PWA 的 Web Push **必须**经 Google FCM（`fcm.googleapis.com`）投递，这是 Chrome / 夸克 / 鸿蒙浏览器的硬性要求。若服务器（如国内机房）无法直连 Google，会报：
```
push 发送失败 ... fcm.googleapis.com ... [Errno 101] Network is unreachable
```
（iOS 走 APNs 不受影响）。三种解决方式：

### 方式 A：HTTP(S) 代理（最简单，若你有可用代理）
服务器 `.env` 加一行，重启 celery：
```bash
PUSH_PROXY=http://你的代理地址:端口
```
仅 FCM 端点走代理，iOS APNs 保持直连。

### 方式 B：海外推送中继（自建，无需代理）
把「发送」一步放到一台**能访问 Google 的海外服务器**上执行，主站只转发订阅信息+载荷。

**1) 海外服务器部署中继 `push_relay.py`（项目根目录）**
```bash
pip install fastapi uvicorn pywebpush
export PUSH_RELAY_SECRET=你的共享密钥
export VAPID_PRIVATE_KEY=<与主站 .env 相同的 VAPID_PRIVATE_KEY>
export VAPID_ADMIN_EMAIL=admin@first-iq.com
python push_relay.py            # 监听 0.0.0.0:8001
```
建议用 nginx + HTTPS 反代到 8001（如 `https://push-relay.example.com`）。

**2) 主站 `.env` 加两行，重启 celery**
```bash
PUSH_RELAY_URL=https://push-relay.example.com
PUSH_RELAY_SECRET=你的共享密钥
```

**3) 验证**
```bash
curl -s https://push-relay.example.com/health
# {"ok": true, "relay_ready": true}
```
安卓/鸿蒙发消息后，主站 celery 日志出现 `push OK (relay) ... fcm.googleapis.com` 即成功。

> 说明：中继需与主站**共用同一把 VAPID 私钥**（订阅用对应公钥创建，签名必须匹配）。若海外中继域名从国内也不可达，可改用 IP + HTTPS。

### 方式 C：第三方推送 SaaS
主站调用海外 SaaS（Pushpad / OneSignal 等）的 API，由它们投递到 FCM/APNs。前提是这些 SaaS 的 API 域名从国内可访问。适合不想自建服务器的场景。

---

## 三、多端验证测试矩阵

### 3.1 推送送达（核心）
准备：两台设备（A、B），均登录不同账号并互为好友/同一群聊。

| 场景 | 步骤 | 预期 |
| --- | --- | --- |
| iOS 主屏 App | iPhone（iOS16.4+）Safari 打开 → 添加到主屏幕 → 打开 App → 授权通知 | A 在 B 回主屏幕后发消息 → B 收到系统推送 |
| iOS 锁屏 | B 回到主屏幕并锁屏 | B 锁屏收到推送；点击推送跳回对应聊天室 |
| Android PWA | Chrome 打开 → 安装/添加到主屏 → 授权通知 → 切到桌面 | 收到系统推送（含角标） |
| 桌面浏览器 | Edge/Chrome 打开 /chat/ → 授权 → 最小化或切到其它标签页 | 收到桌面通知；点击聚焦聊天窗口并切到对应房间 |
| 打开但看别的房间 | A 在 App 内查看房间 X，B 往房间 Y 发消息 | 弹推送（Y 房间）；点击后切到 Y |
| 正在看该房间 | A 正聚焦房间 X，B 往 X 发消息 | **不弹**系统通知，消息实时出现在聊天界面 |
| App 完全关闭 | 从后台划掉 App | 重新打开前收到推送；点击推送直接打开对应聊天室 |
| iPad | iPad Safari 添加到主屏 | 推送 + 布局正常 |
| HarmonyOS | 浏览器打开 / 支持安装则安装 | Chromium 内核，推送行为同 Android |

### 3.1b 安装到桌面（Android / 鸿蒙 / 电脑 / iOS）
| 平台 | 安装方式 |
| --- | --- |
| Android（Chrome） | 打开聊天室 → 右上角「⋮」→「**安装应用**」或「添加到主屏幕」；或点页面底部引导横幅的绿色「**安装应用**」按钮（自动弹系统安装框）。安装后从桌面图标打开，再授权通知 |
| 鸿蒙 | 鸿蒙 NEXT 自带浏览器 / Chrome / Edge 均可：菜单「**安装应用** / **添加到桌面**」，或横幅绿色「安装应用」按钮。Chromium 内核，推送行为同 Android |
| 电脑（Win / Mac） | Chrome / Edge 打开 `/chat/` → 地址栏右侧「**安装**」图标；或右上角头像菜单 →「**安装到桌面**」 |
| iOS | Safari → 分享按钮 →「**添加到主屏幕**」（iOS 16.4+ 才能收到推送） |

> 代码已支持 `beforeinstallprompt`：Android / Chromium（含鸿蒙）打开页面时，底部横幅会显示绿色「安装应用」按钮，右上角头像菜单也会出现「安装到桌面」入口，一键唤起系统安装框。

### 3.2 布局适配（重点：iOS 头像/按钮找不到问题）
| 终端 | 检查项 |
| --- | --- |
| iPhone（standalone App） | 顶部安全区（刘海）正常；聊天头部**头像、返回、语音/视频/更多/主题按钮全部可见**；标题可收缩 |
| iPhone（浏览器） | 同上 |
| Android 手机 | 顶部、底部输入区不被遮挡 |
| iPad / 平板 | 侧边栏 360px + 主区域布局正常 |
| 桌面宽屏 | 侧边栏 + 聊天主区域布局正常 |
| 窄屏 320-400px | `.header-right` 按钮不溢出，消息输入区不被软键盘遮挡 |

### 3.3 离线壳
| 场景 | 预期 |
| --- | --- |
| 断网刷新 /chat/ | 回退到 `/offline/` 离线页（SW scope 修复后生效） |
| 断网后恢复 | 点「重新连接」正常恢复 |

### 3.4 引导横幅
| 场景 | 预期 |
| --- | --- |
| Android / 鸿蒙首次打开（未安装） | 底部横幅出现绿色「**安装应用**」按钮 + 「开启通知」按钮 |
| 点击「安装应用」 | 唤起系统安装框（`beforeinstallprompt`），确认后安装为桌面 App |
| iOS 首次打开（未安装） | 横幅显示「Safari 分享按钮 → 添加到主屏幕」步骤 + 「开启通知」按钮 |
| 已安装为 App（standalone）但未授权通知 | 横幅显示「开启通知」按钮 |
| 点击「开启通知」 | 触发系统通知授权 + Web Push 订阅（iOS 手势授权） |
| 已授权通知 | 横幅不再显示 |
| 关闭横幅 | 之后不再显示（可联系管理员重置 localStorage `pwaGuideShown`） |
| 右上角头像菜单 | Android / 电脑（Chromium）会显示「**安装到桌面**」入口 |

---

## 四、常见问题排查

| 现象 | 排查 |
| --- | --- |
| 收不到任何推送 | ① `.env` VAPID 两把密钥是否齐全（`PUSH_ENABLED`）；② celery worker 是否运行；③ 浏览器是否已授权通知；④ 是否 HTTPS |
| 授权后仍收不到 | DevTools → Application → Push → 查看是否有订阅；服务端查 `chat_pushsubscription` 表是否有记录 |
| 同一房间重复通知 | 检查 Service Worker 是否更新到新版本（版本号 `20260801-pwa2`），`shouldSuppressNotification` 依赖页面上报的 `room-active` 消息 |
| iOS 收到「网站」而非「App」推送 | 需在 iOS16.4+ 通过「添加到主屏幕」安装后从 App 内授权 |
| SW 未生效（scope 不对） | 确认注册的是 `/service-worker.js`（根路径），而非 `/static/js/...` |
| 推送显示「查看」按钮无响应 | 需在 App/浏览器中授权通知后点击；旧浏览器可能不支持 actions |

---

## 五、回滚
- 代码回滚到上一版本后重启服务即可。VAPID 密钥保留不影响。
- 若推送表异常，可 `python manage.py migrate chat 0005` 回退迁移（会删除 push_subscription 表，用户需重新授权订阅）。
