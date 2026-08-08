// static/js/push.js - Web Push 订阅
(function () {
    'use strict';
    var API_BASE = '/api/chat';

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = atob(base64);
        var output = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) {
            output[i] = raw.charCodeAt(i);
        }
        return output;
    }

    window.PushNotifier = {
        // 连续失败计数（达到阈值后置 pushUnsupported，前端停止自动重试）
        _failures: 0,

        supported: function () {
            if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
                return false;
            }
            // 功能性校验：部分旧浏览器有 PushManager 构造器但没有 getSubscription 实现
            if (!window.PushManager || typeof window.PushManager.prototype.getSubscription !== 'function') {
                return false;
            }
            // 华为/鸿蒙自带浏览器（HuaweiBrowser/PetalBrowser/TASBrowser）不实现标准 Web Push 通道，
            // subscribe 必然失败；直接判定为不支持，避免误导用户去授权/订阅。
            var ua = navigator.userAgent || '';
            if (/HuaweiBrowser|PetalBrowser|TASBrowser/i.test(ua)) {
                return false;
            }
            return true;
        },

        // 给 Promise 加超时，避免 SW ready / subscribe 在部分浏览器上永久挂起
        _withTimeout: function (promise, ms, label) {
            return Promise.race([
                Promise.resolve(promise),
                new Promise(function (_, reject) {
                    setTimeout(function () {
                        reject(new Error('[push] ' + (label || '操作') + ' 超时'));
                    }, ms || 5000);
                })
            ]);
        },

        _markUnsupported: function () {
            this._failures = (this._failures || 0) + 1;
            if (this._failures >= 3) {
                try { localStorage.setItem('pushUnsupported', '1'); } catch (ignore) {}
            }
        },

        getVapidKey: function () {
            return fetch(API_BASE + '/push/vapid-public-key/', {cache: 'no-store'})
                .then(function (r) { return r.json(); })
                .then(function (d) { return d.public_key || ''; });
        },

        subscribe: function (force) {
            if (!this.supported()) {
                console.warn('[push] 浏览器不支持 Web Push（缺 SW/PushManager/Notification）');
                return Promise.resolve(null);
            }
            if (Notification.permission !== 'granted') {
                console.warn('[push] 通知权限未授权，跳过订阅：', Notification.permission);
                return Promise.resolve(null);
            }
            if (!force && localStorage.getItem('pushSubscribed')) return Promise.resolve(null);
            console.log('[push] 开始订阅（force=' + !!force + '）');
            var self = this;
            return this._withTimeout(navigator.serviceWorker.ready, 5000, 'ServiceWorker ready').then(function (reg) {
                return reg.pushManager.getSubscription().then(function (sub) {
                    return self.getVapidKey().then(function (key) {
                        if (!key) throw new Error('VAPID key 未配置');
                        var expected = urlBase64ToUint8Array(key);
                        // 校验现有订阅的 applicationServerKey 是否与服务器当前 VAPID 公钥一致；
                        // 若不一致（服务器曾用 gen_vapid_keys 重新生成过密钥），旧订阅已失效，
                        // 必须先退订再重新订阅，否则推送会静默失败。
                        // 🔧 关键：applicationServerKey 在 Chrome 上是 ArrayBuffer，
                        //   直接 existing[i] 取不到字节（恒为 undefined），导致永远判断"不匹配"、
                        //   每次加载都退订重订，FCM token 被反复作废（410）。先转成 Uint8Array 再比较。
                        if (sub) {
                            var existing = sub.options && sub.options.applicationServerKey;
                            if (existing) {
                                var existingBytes = new Uint8Array(existing);
                                if (existingBytes.length !== expected.length ||
                                    !expected.every(function (b, i) { return b === existingBytes[i]; })) {
                                    console.warn('push 订阅的 VAPID key 已变更，重新订阅');
                                    return sub.unsubscribe().then(function () { return null; });
                                }
                            }
                            return sub;
                        }
                        return self._withTimeout(reg.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: expected
                        }), 5000, 'pushManager.subscribe');
                    });
                }).then(function (sub) {
                    var j = sub.toJSON();
                    return fetch(API_BASE + '/push/subscribe/', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || ''),
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({endpoint: j.endpoint, keys: j.keys})
                    }).then(function (r) {
                        if (r.ok) {
                            localStorage.setItem('pushSubscribed', '1');
                            return sub;
                        }
                        return null;
                    });
                });
            }).catch(function (e) {
                console.warn('push subscribe failed:', e);
                // 连续失败达到阈值后标记为不支持，前端自动重试停止（避免无限空转）
                self._markUnsupported();
                // 清空标记，允许下次（重新可见/手势）重试
                try { localStorage.removeItem('pushSubscribed'); } catch (ignore) {}
                return null;
            });
        },

        unsubscribe: function () {
            return navigator.serviceWorker.ready.then(function (reg) {
                return reg.pushManager.getSubscription().then(function (sub) {
                    if (!sub) return null;
                    return sub.unsubscribe().then(function () {
                        return fetch(API_BASE + '/push/unsubscribe/', {
                            method: 'DELETE',
                            headers: {
                                'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || ''),
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({endpoint: sub.endpoint})
                        });
                    });
                });
            }).then(function () {
                localStorage.removeItem('pushSubscribed');
            }).catch(function (e) {
                console.warn('push unsubscribe failed:', e);
            });
        }
    };
})();
