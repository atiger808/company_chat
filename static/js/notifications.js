// static/js/notifications.js - 工作通知

(function() {
    'use strict';

    const OA_API_URL = '/api/oa';
    let chat_login_url = '/login/';
    let ws = null;
    let unreadCount = 0;
    let wsReconnectTimer = null;
    let pollTimer = null;
    let initialized = false;

    // 样式注入
    function injectStyles() {
        var css = '.notif-bell-wrap { position:relative; display:inline-flex; align-items:center; cursor:pointer; padding:6px 8px; border-radius:6px; transition:background 0.2s; color:var(--text-secondary,#606266); }';
        css += '.notif-bell-wrap:hover { background:rgba(255,255,255,0.3); }';
        css += '.notif-bell-wrap i { font-size:18px; }';
        css += '.notif-badge { position:absolute; top:-2px; right:-2px; min-width:16px; height:16px; background:#f56c6c; border-radius:8px; font-size:11px; color:#fff; display:flex; align-items:center; justify-content:center; padding:0 4px; font-weight:600; border:2px solid var(--bg-primary,#fff); }';
        css += '.notif-badge.hide { display:none; }';
        css += '.notif-dropdown { position:fixed; width:360px; max-height:480px; background:#fff; border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,0.15); z-index:9999; overflow:hidden; display:none; }';
        css += '.notif-dropdown.show { display:block; }';
        css += '.notif-dropdown-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border-color,#ebeef5); }';
        css += '.notif-dropdown-header h3 { font-size:15px; font-weight:600; margin:0; color:var(--text-primary,#303133);}';
        css += '.notif-dropdown-header .btn-text { font-size:12px; color:var(--primary-color,#409eff); cursor:pointer; background:none; border:none; }';
        css += '.notif-dropdown-header .btn-text:hover { text-decoration:underline; }';
        css += '.notif-list { overflow-y:auto; max-height:400px; }';
        css += '.notif-item { display:flex; gap:10px; padding:12px 16px; border-bottom:1px solid var(--border-color,#f0f0f0); cursor:pointer; transition:background 0.15s; }';
        css += '.notif-item:hover { background:var(--bg-secondary,#f5f7fa); }';
        css += '.notif-item.unread { background:#f0f7ff; }';
        css += '.notif-item.unread:hover { background:#e6f0ff; }';
        css += '.notif-item-icon { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:16px; color:#fff; }';
        css += '.notif-item-icon.approval { background:#409eff; }';
        css += '.notif-item-icon.attendance { background:#67c23a; }';
        css += '.notif-item-icon.task { background:#e6a23c; }';
        css += '.notif-item-icon.collab { background:#9b59b6; }';
        css += '.notif-item-icon.system { background:#909399; }';
        css += '.notif-item-body { flex:1; min-width:0; }';
        css += '.notif-item-title { font-size:14px; font-weight:500; color:var(--text-primary,#303133); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }';
        css += '.notif-item-content { font-size:12px; color:var(--text-secondary,#606266); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }';
        css += '.notif-item-time { font-size:11px; color:var(--text-light,#909399); margin-top:4px; }';
        css += '.notif-empty { text-align:center; padding:40px 20px; color:var(--text-light,#909399); }';
        css += '.notif-empty i { font-size:36px; margin-bottom:8px; opacity:0.4; }';
        css += '[data-theme="dark"] .notif-dropdown { background:#1e1e1e; border-color:#333; }';
        css += '[data-theme="dark"] .notif-item.unread { background:#1a2740; }';
        css += '[data-theme="dark"] .notif-item.unread:hover { background:#1f3050; }';
        css += '[data-theme="dark"] .notif-bell-wrap:hover { background:#2d2d2d; }';
        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // 通知筛选和详情按钮样式
    (function(){var c='.notif-filter-bar{display:flex;gap:0;padding:8px 16px;border-bottom:1px solid var(--border-color,#ebeef5);}';c+='.notif-filter-btn{padding:4px 14px;border:1px solid var(--border-color,#dcdfe6);background:#fff;font-size:12px;cursor:pointer;color:var(--text-secondary,#606266);transition:all 0.15s;}';c+='.notif-filter-btn:first-child{border-radius:14px 0 0 14px;}';c+='.notif-filter-btn:last-child{border-radius:0 14px 14px 0;}';c+='.notif-filter-btn:not(:last-child){border-right:none;}';c+='.notif-filter-btn:hover{color:var(--primary-color,#409eff);}';c+='.notif-filter-btn.active{background:var(--primary-color,#409eff);border-color:var(--primary-color,#409eff);color:#fff;}';c+='.notif-detail-btn{display:inline-block;margin-top:6px;padding:2px 10px;font-size:11px;color:var(--primary-color,#409eff);background:#ecf5ff;border-radius:4px;text-decoration:none;cursor:pointer;}';c+='.notif-detail-btn:hover{background:#d9ecff;}';c+='[data-theme="dark"] .notif-filter-btn{background:#2d2d2d;border-color:#444;color:var(--text-secondary);}';c+='[data-theme="dark"] .notif-filter-btn.active{background:var(--primary-color,#409eff);border-color:var(--primary-color,#409eff);color:#fff;}';c+='[data-theme="dark"] .notif-detail-btn{background:#1a2740;color:#5ab0ff;}';c+='[data-theme="dark"] .notif-detail-btn:hover{background:#1f3050;}';var s=document.createElement('style');s.textContent=c;document.head.appendChild(s);})();

    function getAccessToken() {
        return localStorage.getItem('access_token') || '';
    }

    function handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = chat_login_url;
    }

    async function apiGet(url) {
        var resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + getAccessToken(), 'Content-Type': 'application/json' } });
        if (!resp.ok) {
            if (resp.status === 401) {
                console.log('登录已过期，请重新登录');
                handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed');
        };
        var raw = await resp.json();
        if (raw.encrypt && window.EncryptUtils) return window.EncryptUtils.decryptPacket(raw);
        return raw;
    }

    async function apiPost(url, data) {
        var resp = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + getAccessToken(), 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
        });
        if (!resp.ok) {
            if (resp.status === 401) {
                console.log('登录已过期，请重新登录');
                handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || 'Failed');
        };
        var raw = await resp.json();
        if (raw.encrypt && window.EncryptUtils) return window.EncryptUtils.decryptPacket(raw);
        return raw;
    }

    async function fetchUnreadCount() {
        try {
            var data = await apiGet(OA_API_URL + '/notifications/unread-count/');
            unreadCount = data.count || 0;
            updateBadge();
            return unreadCount;
        } catch(e) { return unreadCount; }
    }

    function updateBadge() {
        var badge = document.getElementById('notifBadge');
        if (!badge) return;
        if (unreadCount > 0) {
            badge.classList.remove('hide');
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            badge.classList.add('hide');
        }
        // 更新侧边栏工作通知项
        var sidebarItem = document.getElementById('notifSidebarItem');
        if (sidebarItem) {
            sidebarItem.style.display = 'flex';
            var sidebarBadge = document.getElementById('notifSidebarBadge');
            var sidebarSub = document.getElementById('notifSidebarSubtitle');
            if (sidebarBadge) {
                sidebarBadge.style.display = unreadCount > 0 ? 'flex' : 'none';
                sidebarBadge.querySelector('span').textContent = unreadCount > 99 ? '99+' : unreadCount;
            }
            if (sidebarSub) {
                sidebarSub.textContent = unreadCount > 0 ? (unreadCount + ' 条未读通知') : '查看工作通知';
            }
        }
        // 全局应用图标
        if (navigator.setAppBadge && unreadCount > 0) {
            navigator.setAppBadge(unreadCount);
        } else if (navigator.setAppBadge) {
            navigator.clearAppBadge();
        }
    }

    function formatTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var pad = function(n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function typeIcon(t) {
        return { 'approval': 'fas fa-check-double', 'attendance': 'fas fa-clock', 'task': 'fas fa-tasks', 'collab': 'fas fa-users', 'system': 'fas fa-bell' }[t] || 'fas fa-bell';
    }

    function typeColor(t) {
        return { 'approval': '#409eff', 'attendance': '#67c23a', 'task': '#e6a23c', 'collab': '#9b59b6', 'system': '#909399' }[t] || '#909399';
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    window.WorkNotif = {
        _nFilter: '',

        async toggle() {
            var dd = document.getElementById('notifDropdown');
            if (!dd) return;
            var shown = dd.classList.contains('show');
            if (shown) {
                dd.classList.remove('show');
                return;
            }
            document.querySelectorAll('.notif-dropdown').forEach(function(d) { d.classList.remove('show'); });

            var bell = document.getElementById('notifBellWrap');
            if (bell) {
                var rect = bell.getBoundingClientRect();
                dd.style.left = Math.max(10, rect.right - 360) + 'px';
                dd.style.top = (rect.bottom + 6) + 'px';
            }

            dd.classList.add('show');
            await this.loadList();
        },

        async setFilter(v) {
            this._nFilter = v;
            document.querySelectorAll('.notif-filter-btn').forEach(function(b) {
                b.classList.toggle('active', b.dataset.filter === v);
            });
            await this.loadList();
        },

        async loadList() {
            var list = document.getElementById('notifList');
            if (!list) return;
            try {
                var url = OA_API_URL + '/notifications/?page=1&page_size=50';
                if (this._nFilter) url += '&read_filter=' + this._nFilter;
                var data = await apiGet(url);
                var rows = data.results || [];
                var filterHtml = '<div class="notif-filter-bar">'
                    + '<button class="notif-filter-btn' + (this._nFilter === '' ? ' active' : '') + '" data-filter="" onclick="event.stopPropagation();WorkNotif.setFilter(\'\')">全部</button>'
                    + '<button class="notif-filter-btn' + (this._nFilter === 'unread' ? ' active' : '') + '" data-filter="unread" onclick="event.stopPropagation();WorkNotif.setFilter(\'unread\')">未读</button>'
                    + '<button class="notif-filter-btn' + (this._nFilter === 'read' ? ' active' : '') + '" data-filter="read" onclick="event.stopPropagation();WorkNotif.setFilter(\'read\')">已读</button>'
                    + '</div>';
                if (!rows.length) {
                    list.innerHTML = filterHtml + '<div class="notif-empty"><i class="fas fa-bell-slash"></i><p>暂无通知</p></div>';
                    return;
                }
                list.innerHTML = filterHtml + rows.map(function(n) {
                    var icon = typeIcon(n.type);
                    var color = typeColor(n.type);
                    var cls = n.is_read ? '' : 'unread';
                    var dotHtml = n.is_read ? '' : '<span style="position:absolute;top:20px;right:12px;width:8px;height:8px;border-radius:50%;background:#409eff;"></span>';
                    var u = n.related_url || '';
                    var detailBtn = u ? '<span class="notif-detail-btn" onclick="event.stopPropagation();WorkNotif.goDetail(' + n.id + ',\'' + u + '\')">查看详情 <i class="fas fa-arrow-right" style="font-size:10px;"></i></span>' : '';
                    return '<div class="notif-item ' + cls + '" onclick="event.stopPropagation();WorkNotif.markRead(' + n.id + ')" style="position:relative">'
                        + '<div class="notif-item-icon ' + n.type + '" style="background:' + color + ';"><i class="' + icon + '"></i></div>'
                        + '<div class="notif-item-body">'
                        + '<div class="notif-item-title" style="font-weight:' + (n.is_read ? '400' : '600') + '">' + escapeHtml(n.title) + '</div>'
                        + '<div class="notif-item-content">' + escapeHtml(n.content) + '</div>'
                        + '<div class="notif-item-time">' + formatTime(n.created_at) + '</div>' + detailBtn + '</div>' + dotHtml + '</div>';
                }).join('');
            } catch(e) {
                list.innerHTML = '<div class="notif-empty"><i class="fas fa-exclamation-circle"></i><p>加载失败</p></div>';
            }
        },

        async markRead(id) {
            try { await apiPost(OA_API_URL + '/notifications/' + id + '/mark-read/', {}); } catch(e) {}
            fetchUnreadCount();
        },

        async goDetail(id, url) {
            try { await apiPost(OA_API_URL + '/notifications/' + id + '/mark-read/', {}); } catch(e) {}
            fetchUnreadCount();
            if (url) window.location.href = url;
        },

        async markAllRead() {
            try {
                await apiPost(OA_API_URL + '/notifications/mark-all-read/', {});
                unreadCount = 0;
                updateBadge();
                var items = document.querySelectorAll('.notif-item.unread');
                items.forEach(function(i) { i.classList.remove('unread'); });
            } catch(e) {}
        },

        refreshCount: fetchUnreadCount,
    };

    // 初始化
    function init() {
        if (initialized) return;
        initialized = true;
        injectStyles();

        var bellWrap = document.getElementById('notifBellWrap');
        if (!bellWrap) return;

        // 创建下拉
        var dd = document.createElement('div');
        dd.className = 'notif-dropdown';
        dd.id = 'notifDropdown';
        dd.innerHTML = '<div class="notif-dropdown-header"><h3>工作通知</h3><button class="btn-text" onclick="WorkNotif.markAllRead()">全部标为已读</button></div><div class="notif-list" id="notifList"><div class="notif-empty"><i class="fas fa-spinner fa-spin"></i><p>加载中...</p></div></div>';
        bellWrap.appendChild(dd);

        // 点击铃铛切换下拉
        bellWrap.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            WorkNotif.toggle();
        });

        // 初始加载
        fetchUnreadCount();

        // 轮询
        pollTimer = setInterval(fetchUnreadCount, 30000);

        // WebSocket 连接
        connectWs();

        // 全局点击关闭
        document.addEventListener('click', function(e) {
            if (!bellWrap.contains(e.target)) {
                dd.classList.remove('show');
            }
        });
    }

    function connectWs() {
        try {
            var token = getAccessToken();
            if (!token) return;
            ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/notifications/?token=' + token);
            ws.onmessage = function(e) {
                try {
                    var data = JSON.parse(e.data);
                    if (data.type === 'work.notification' && data.event_type === 'new') {
                        fetchUnreadCount();
                        if (Notification.permission === 'granted') {
                            new Notification(data.notification.title, { body: data.notification.content, icon: '/static/images/logo.png' });
                        }
                    }
                    // 协作邀请通知也触发未读数刷新
                    if (data.type === 'collaboration_invite') {
                        fetchUnreadCount();
                    }
                    // 任务通知也触发未读数刷新
                    if (data.type === 'task.notification') {
                        fetchUnreadCount();
                        if (Notification.permission === 'granted') {
                            var title = data.event_type === 'assigned' ? '新任务分配' : '任务更新';
                            new Notification(title, { body: (data.task && data.task.title) || '', icon: '/static/images/logo.png' });
                        }
                    }
                } catch(err) {}
            };
            ws.onclose = function() {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = setTimeout(connectWs, 5000);
            };
            ws.onerror = function() { ws.close(); };
        } catch(e) {}
    }

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
