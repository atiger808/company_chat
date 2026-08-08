// @File   :service-worker.js
// @Desc   :PWA Service Worker - Web Push + SWR 缓存 + 离线回退

// 每次部署递增此版本号（SW 文件字节变化即可触发更新，但显式版本更可靠）
const STATIC_VERSION = '20260808-pwa11';
const CACHE = 'company-chat-' + STATIC_VERSION;
const SHELL_CACHE = CACHE + '-shell';

const PRECACHE = [
    '/offline/',
    '/chat/',
    '/login/',
    '/manifest.json',
    '/static/js/chat.js',
    '/static/js/api.js',
    '/static/js/utils.js',
    '/static/js/notifications.js',
    '/static/js/push.js',
    '/static/css/chat.css',
    '/static/images/default-avatar.png',
    '/static/images/notification-badge.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => !k.startsWith('company-chat-')).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    // 非 GET / 跨域 / 带鉴权头一律放行（绝不缓存 API）
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (req.headers.get('Authorization')) return;
    if (url.pathname.startsWith('/api/')) return;

    // 1) 页面导航：网络优先，离线回退 /offline/
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).then(res => {
                if (res.ok) {
                    // 🔧 必须在返回响应前【同步】clone，否则浏览器消费 body 后再 clone 会报
                    // "Response body is already used"；并用 event.waitUntil 保持 SW 存活完成写缓存
                    const copy = res.clone();
                    event.waitUntil(
                        caches.open(SHELL_CACHE).then(c => c.put('/chat/', copy)).catch(() => {})
                    );
                }
                return res;
            }).catch(() =>
                caches.match('/offline/', {ignoreSearch: true}).then(r => r || caches.match('/chat/', {ignoreSearch: true}))
            )
        );
        return;
    }

    // 2) 静态资源：缓存优先 + 后台刷新（stale-while-revalidate）
    // 🔧 关键：按完整 URL（含 ?v= 版本号）匹配缓存，保证改版本号后一定请求到最新文件；
    //    离线时再回退到忽略版本号的缓存兜底。
    if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.json') {
        event.respondWith(
            caches.open(CACHE).then(async c => {
                const hit = await c.match(req); // 精确 URL（含版本号）命中 → 返回缓存，后台刷新
                const pathHit = await c.match(req, {ignoreSearch: true}); // 离线兜底：任意版本
                const net = fetch(req).then(res => {
                    if (res.ok) {
                        const copy = res.clone();
                        c.put(req, copy).catch(() => {});
                    }
                    return res;
                }).catch(() => pathHit || hit); // 网络失败（离线）时回退缓存
                return hit || net;
            })
        );
    }
});

// ===== 应用图标徽章（未读数 = 聊天未读 + 工作通知未读）=====
// 页面上报各自模块的精确未读数；后台收到推送时由 SW 自增（Badging API 在 SW 中也可用，
// 页面在后台被挂起时也能实时更新桌面/Android 图标徽章）。iOS 不支持 Badging API，属平台限制。
let chatUnread = 0;
let workUnread = 0;
function applyBadge() {
    const total = chatUnread + workUnread;
    try {
        if (navigator && typeof navigator.setAppBadge === 'function') {
            if (total > 0) {
                navigator.setAppBadge(total).catch(() => {});
            } else {
                navigator.clearAppBadge().catch(() => {});
            }
        }
    } catch (e) {}
}
self.addEventListener('message', event => {
    const msg = event.data || {};
    if (msg.type === 'chat-badge' && typeof msg.count === 'number') {
        chatUnread = msg.count;
        applyBadge();
    } else if (msg.type === 'work-badge' && typeof msg.count === 'number') {
        workUnread = msg.count;
        applyBadge();
    }
});

// 🔧 处理推送消息：无论应用是否打开/前台，一律展示系统通知（锁屏/回到主屏幕/后台都要收到）。
// 不做任何去重/抑制——每条新消息、每条工作通知都触发一次系统通知。
self.addEventListener('push', event => {
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: '新消息', body: event.data.text() };
        }
    }
    // 后台收到推送：未读数徽章自增（页面打开后会用精确值覆盖）
    const pd = data.data || {};
    if (pd.kind === 'chat') {
        chatUnread += 1;
        applyBadge();
    } else if (pd.kind === 'work') {
        workUnread += 1;
        applyBadge();
    }

    if (!(self.Notification && self.Notification.permission === 'granted')) return;

    const title = data.title || '新消息';
    // 用最兼容的字段，避免 iOS 对 renotify/actions 等支持不完整导致通知不显示：
    //   - tag 必须唯一，避免同一 tag 被折叠/替换（后端已带 message_id 生成唯一 tag）
    //   - 去掉 renotify/actions（iOS 不支持，个别版本可能因它们而不弹通知）
    const options = {
        body: data.body || '您有一条新消息',
        icon: data.icon || '/static/images/default-avatar.png',
        badge: data.badge || '/static/images/notification-badge.png',
        tag: data.tag || ('chat-' + Date.now()),
        data: data.data || {},
        requireInteraction: false,
        silent: false
    };

    event.waitUntil(
        self.registration.showNotification(title, options).catch(() => {})
    );
});

// 通知点击处理
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const nd = event.notification.data || {};
    const room = nd.chat_room;
    const url = nd.url || (room ? `/chat/?room=${room}` : '/chat/');

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                // 已有同源应用窗口：聚焦并把该窗口切换到目标房间 / 目标页面
                const target = clientList.find(c => c.url.startsWith(self.location.origin) && 'focus' in c);
                if (target) {
                    target.focus();
                    if (room) {
                        target.postMessage({ type: 'notification-click', chat_room: room });
                    } else {
                        target.navigate(url);
                    }
                    return;
                }
                // 无应用窗口：新开窗口
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});
