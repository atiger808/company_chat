// @File   :service-worker.js
// @Time   :2026/3/6 14:55
// @Author :dayue
// @Email  :ole211@qq.com


// static/js/service-worker.js

// 缓存名称
const CACHE_NAME = 'chat-app-v1';
const urlsToCache = [
    '/static/css/chat.css',
    '/static/js/chat.js',
    '/static/js/api.js',
    '/static/js/utils.js',
    '/static/js/admin.js',
    '/static/js/admin_chat_rooms.js',
    '/static/images/default-avatar.png',
    '/manifest.json'
];

// 安装时缓存资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
        .then(() => self.clients.claim())
    );
});

// 拦截网络请求，使用缓存
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

// 🔧 关键修复：处理推送消息（锁屏通知必需）
self.addEventListener('push', event => {
    console.log('Push event received:', event);

    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: '新消息', body: event.data.text() };
        }
    }

    const title = data.title || '新消息';
    const options = {
        body: data.body || '您有一条新消息',
        icon: data.icon || '/static/images/default-avatar.png',
        badge: '/static/images/notification-badge.png',  // iOS 锁屏通知必需
        tag: data.tag || 'chat-notification',
        data: data.data || {},
        // 🔧 关键修复：移动端锁屏通知必需参数
        requireInteraction: false,  // 不强制用户交互
        silent: false,              // 播放系统通知声音
        // iOS 16.4+ 需要这些才能显示锁屏通知
        actions: [
            { action: 'view', title: '查看' },
            { action: 'reply', title: '回复' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// 通知点击处理
self.addEventListener('notificationclick', event => {
    console.log('Notification click received:', event);

    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clientList => {
                // 如果有已打开的窗口，聚焦并导航到聊天室
                for (const client of clientList) {
                    if (client.url.includes('/chat/') && 'focus' in client) {
                        client.focus();

                        // 发送消息到客户端
                        if (event.notification.data?.chat_room) {
                            client.postMessage({
                                type: 'notification-click',
                                chat_room: event.notification.data.chat_room
                            });
                        }
                        return;
                    }
                }

                // 没有窗口，打开新窗口
                if (clients.openWindow) {
                    const chatRoom = event.notification.data?.chat_room;
                    const url = chatRoom ? `/chat/?room=${chatRoom}` : '/chat/';
                    return clients.openWindow(url);
                }
            })
    );
});