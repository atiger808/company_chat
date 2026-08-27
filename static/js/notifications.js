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
        css += '.notif-item-icon.subsidy { background:#16a085; }';
        css += '.notif-item-icon.subsidy_apply { background:#16a085; }';
        css += '.notif-item-icon.subsidy_result { background:#67c23a; }';
        css += '.notif-item-icon.subsidy_withdraw { background:#e6a23c; }';
        css += '.notif-item-icon.subsidy_withdraw_result { background:#16a085; }';
        css += '.notif-item-icon.hr { background:#6c5ce7; }';
        css += '.notif-item-icon.daily { background:#409eff; }';
        css += '.notif-item-icon.work_summary { background:#9b59b6; }';
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
        css += '[data-theme="dark"] .notif-item:hover { background:#2a2a2a; }';
        css += '[data-theme="dark"] .notif-dropdown-header { background:#1e1e1e; border-color:#333; }';
        css += '[data-theme="dark"] .notif-dropdown-header h3 { color:#e5eaf3; }';
        css += '[data-theme="dark"] .notif-bell-wrap:hover { background:#2d2d2d; }';
        css += '[data-theme="dark"] .notif-list::-webkit-scrollbar-thumb { background:#444; }';
        // 🔧 移动端：扩大「全部标为已读」按钮点击区域，并覆盖 chat.css 中 .btn-text{display:none}
        // （该规则本意是隐藏通话界面文字，误伤了通知头部按钮），确保移动端可见可点。
        css += '@media (max-width: 768px) { .notif-dropdown-header { padding:10px 14px; } .notif-dropdown-header .btn-text { display:inline-block !important; padding:6px 8px; } }';
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
        // 全局应用图标：把工作通知未读数上报给 Service Worker，
        // 由 SW 汇总「聊天未读 + 工作未读」统一设置图标徽章（避免与聊天未读互相覆盖）。
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({type: 'work-badge', count: unreadCount});
            }
        } catch (e) {}
    }

    function formatTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var pad = function(n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function typeIcon(t) {
        return { 'approval': 'fas fa-check-double', 'attendance': 'fas fa-clock', 'task': 'fas fa-tasks', 'collab': 'fas fa-users', 'subsidy': 'fas fa-hand-holding-usd', 'subsidy_apply': 'fas fa-file-invoice', 'subsidy_result': 'fas fa-clipboard-check', 'subsidy_withdraw': 'fas fa-money-check-alt', 'subsidy_withdraw_result': 'fas fa-wallet', 'daily': 'fas fa-calendar-day', 'work_summary': 'fas fa-file-signature', 'hr': 'fas fa-user-tie', 'system': 'fas fa-bell' }[t] || 'fas fa-bell';
    }

    function typeColor(t) {
        return { 'approval': '#409eff', 'attendance': '#67c23a', 'task': '#e6a23c', 'collab': '#9b59b6', 'subsidy': '#16a085', 'subsidy_apply': '#16a085', 'subsidy_result': '#67c23a', 'subsidy_withdraw': '#e6a23c', 'subsidy_withdraw_result': '#16a085', 'daily': '#409eff', 'work_summary': '#9b59b6', 'hr': '#6c5ce7', 'system': '#909399' }[t] || '#909399';
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // 通知跳转 URL：老数据 related_url 可能不带对象 id（如 /oa/approval/），
    // 用 extra_data 中的对象 id 拼装，确保跳转后页面能自动打开对应详情。
    function notifJumpUrl(n) {
        var u = (n && n.related_url) || '';
        var ed = (n && n.extra_data) || {};
        // console.log('n::',n);
        if (n && n.type === 'approval' && ed.approval_id && u.indexOf('approval_id') === -1) {
            u = '/oa/approval/?approval_id=' + ed.approval_id;
        } else if (n && n.type === 'subsidy' && ed.application_id && u.indexOf('application_id') === -1) {
            u = '/oa/subsidy/?application_id=' + ed.application_id;
        } else if (n && n.type === 'task' && ed.task_id && u.indexOf('task_id') === -1) {
            u = '/tasks/?task_id=' + ed.task_id;
        } else if (n && n.type === 'work_summary' && ed.summary_id && u.indexOf('summary_id') === -1) {
            u = '/oa/work-summary/?id=' + ed.summary_id;
        } else if (n && n.type === 'daily') {
            u = '/oa/work-calendar/';
        }
        return u;
    }

    window.WorkNotif = {
        _nFilter: '',
        _page: 1,
        _hasMore: false,
        _loadingMore: false,

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
                // 🔧 移动端适配：宽高与位置都限制在视口内，保证顶部「全部标为已读」按钮始终可见
                var vw = window.innerWidth;
                var vh = window.innerHeight;
                var ddWidth = Math.min(360, vw - 16);
                var top = rect.bottom + 6;
                var ddHeight = Math.min(480, vh - top - 8);
                dd.style.width = ddWidth + 'px';
                dd.style.left = Math.max(8, Math.min(rect.right - ddWidth, vw - ddWidth - 8)) + 'px';
                dd.style.top = top + 'px';
                dd.style.maxHeight = ddHeight + 'px';
                var list = document.getElementById('notifList');
                if (list) list.style.maxHeight = Math.max(120, ddHeight - 50) + 'px';
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
            this._page = 1;
            this._hasMore = false;
            try {
                var data = await this._fetchPage(1);
                var rows = data.results || [];
                var totalPages = data.total_pages || 1;
                this._hasMore = this._page < totalPages;
                var filterHtml = this._filterHtml();
                if (!rows.length) {
                    list.innerHTML = filterHtml + '<div class="notif-empty"><i class="fas fa-bell-slash"></i><p>暂无通知</p></div>';
                    return;
                }

                list.innerHTML = filterHtml + this._renderRows(rows) + this._moreHtml();
            } catch(e) {
                list.innerHTML = this._filterHtml() + '<div class="notif-empty"><i class="fas fa-exclamation-circle"></i><p>加载失败</p></div>';
            }
        },

        async loadMore() {
            if (this._loadingMore) return;
            this._loadingMore = true;
            var list = document.getElementById('notifList');
            var btn = document.getElementById('notifMoreBtn');
            if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
            try {
                var next = this._page + 1;
                var data = await this._fetchPage(next);
                this._page = next;
                var rows = data.results || [];
                var totalPages = data.total_pages || 1;
                this._hasMore = this._page < totalPages;
                var wrap = document.getElementById('notifMoreWrap');
                if (rows.length) {
                    var html = this._renderRows(rows) + this._moreHtml();
                    if (wrap) wrap.outerHTML = html;
                    else list.innerHTML += html;
                } else {
                    this._hasMore = false;
                    if (wrap) wrap.outerHTML = '<div id="notifMoreWrap" style="text-align:center;padding:12px;color:var(--text-light,#909399);font-size:12px;">已加载全部</div>';
                }
            } catch(e) {
                if (btn) btn.innerHTML = '加载更多 <i class="fas fa-chevron-down"></i>';
            } finally {
                this._loadingMore = false;
            }
        },

        _fetchPage(page) {
            var url = OA_API_URL + '/notifications/?page=' + page + '&page_size=50';
            if (this._nFilter) url += '&read_filter=' + this._nFilter;
            return apiGet(url);
        },

        _filterHtml() {
            return '<div class="notif-filter-bar">'
                + '<button class="notif-filter-btn' + (this._nFilter === '' ? ' active' : '') + '" data-filter="" onclick="event.stopPropagation();WorkNotif.setFilter(\'\')">全部</button>'
                + '<button class="notif-filter-btn' + (this._nFilter === 'unread' ? ' active' : '') + '" data-filter="unread" onclick="event.stopPropagation();WorkNotif.setFilter(\'unread\')">未读</button>'
                + '<button class="notif-filter-btn' + (this._nFilter === 'read' ? ' active' : '') + '" data-filter="read" onclick="event.stopPropagation();WorkNotif.setFilter(\'read\')">已读</button>'
                + '</div>';
        },

        _renderRows(rows) {
            return rows.map(function(n) {
                var icon = typeIcon(n.type);
                var color = typeColor(n.type);
                var cls = n.is_read ? '' : 'unread';
                var dotHtml = n.is_read ? '' : '<span style="position:absolute;top:20px;right:12px;width:8px;height:8px;border-radius:50%;background:#409eff;"></span>';
                var u = notifJumpUrl(n);
                var detailBtn = u ? '<span class="notif-detail-btn" onclick="event.stopPropagation();WorkNotif.goDetail(' + n.id + ',\'' + u + '\')">查看详情 <i class="fas fa-arrow-right" style="font-size:10px;"></i></span>' : '';
                return '<div class="notif-item ' + cls + '" onclick="event.stopPropagation();WorkNotif.markRead(' + n.id + ')" style="position:relative">'
                    + '<div class="notif-item-icon ' + n.type + '" style="background:' + color + ';"><i class="' + icon + '"></i></div>'
                    + '<div class="notif-item-body">'
                    + '<div class="notif-item-title" style="font-weight:' + (n.is_read ? '400' : '600') + '">' + escapeHtml(n.title) + '</div>'
                    + '<div class="notif-item-content">' + escapeHtml(n.content) + '</div>'
                    + '<div class="notif-item-time">' + formatTime(n.created_at) + '</div>' + detailBtn + '</div>' + dotHtml + '</div>';
            }).join('');
        },

        _moreHtml() {
            if (this._hasMore) {
                return '<div id="notifMoreWrap" style="text-align:center;padding:12px;">'
                    + '<button id="notifMoreBtn" onclick="event.stopPropagation();WorkNotif.loadMore()" style="display:inline-flex;align-items:center;gap:6px;padding:6px 20px;border:1px solid var(--border-color,#dcdfe6);border-radius:16px;background:var(--bg-secondary,#f5f7fa);color:var(--primary-color,#409eff);font-size:13px;cursor:pointer;">加载更多 <i class="fas fa-chevron-down" style="font-size:11px;"></i></button>'
                    + '</div>';
            }
            return '<div id="notifMoreWrap" style="text-align:center;padding:12px;color:var(--text-light,#909399);font-size:12px;">已加载全部</div>';
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
        pollTimer = setInterval(fetchUnreadCount, 20000);

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
