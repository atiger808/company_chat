// static/js/notification-waterfall.js
// 登录后未读工作通知「瀑布流」：仅在企业开启后显示，延迟加载，避免影响首屏。
(function () {
    'use strict';

    var OA_API = '/api/oa';
    var MAX_ITEMS = 15;
    var TODO_PAGE_SIZE = 20;
    var cached = [];
    var cachedTodo = [];
    var todoPage = 0;
    var todoTotal = 0;
    var todoHasMore = false;
    var todoLoading = false;
    var notifPage = 0;
    var notifTotal = 0;
    var notifHasMore = false;
    var notifLoading = false;

    function token() {
        return localStorage.getItem('access_token') || '';
    }

    function authHeaders() {
        return {'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'};
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function apiGet(url) {
        var res = await fetch(url, {headers: authHeaders()});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var raw = await res.json();
        if (raw && raw.encrypt && window.EncryptUtils) return window.EncryptUtils.decryptPacket(raw);
        return raw;
    }

    async function apiPost(url) {
        var res = await fetch(url, {method: 'POST', headers: authHeaders(), body: '{}'});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json().catch(function () { return {}; });
    }

    function typeColor(t) {
        return {
            approval: '#409eff', attendance: '#67c23a', task: '#e6a23c',
            collab: '#9b59b6', subsidy: '#16a085', subsidy_apply: '#16a085',
            subsidy_result: '#67c23a', subsidy_withdraw: '#e6a23c',
            subsidy_withdraw_result: '#16a085', daily: '#409eff',
            work_summary: '#9b59b6', announcement: '#7c4dff',
            workorder: '#00a1ff', hr: '#6c5ce7', system: '#909399'
        }[t] || '#909399';
    }

    function typeIcon(t) {
        return {
            approval: 'fa-check-double', attendance: 'fa-clock', task: 'fa-tasks',
            collab: 'fa-users', subsidy: 'fa-hand-holding-usd', daily: 'fa-calendar-day',
            work_summary: 'fa-file-signature', announcement: 'fa-bullhorn',
            workorder: 'fa-clipboard-list', hr: 'fa-user-tie', system: 'fa-bell'
        }[t] || 'fa-bell';
    }

    function jumpUrl(n) {
        var u = (n && n.related_url) || '';
        var ed = (n && n.extra_data) || {};
        if (n && n.type === 'approval' && ed.approval_id && u.indexOf('approval_id') === -1) {
            u = '/oa/approval/?approval_id=' + ed.approval_id;
        } else if (n && n.type === 'subsidy' && ed.application_id && u.indexOf('application_id') === -1) {
            u = '/oa/subsidy/?application_id=' + ed.application_id;
        } else if (n && n.type === 'task' && ed.task_id && u.indexOf('task_id') === -1) {
            u = '/tasks/?task_id=' + ed.task_id;
        } else if (n && n.type === 'work_summary' && ed.summary_id && u.indexOf('summary_id') === -1) {
            u = '/oa/work-summary/?id=' + ed.summary_id;
        } else if (n && n.type === 'workorder' && ed.work_order_id) {
            u = '/tasks/?work_order_id=' + ed.work_order_id;
        } else if (n && n.type === 'daily') {
            u = '/oa/work-calendar/';
        }
        return u;
    }

    function fmtTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var p = function (n) { return String(n).padStart(2, '0'); };
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function injectStyles() {
        if (document.getElementById('wfStyle')) return;
        var css = ''
            + '#wfPanel{position:fixed;right:16px;top:72px;width:340px;max-width:calc(100vw - 24px);max-height:70vh;z-index:9600;display:flex;flex-direction:column;pointer-events:auto;opacity:.92;border-radius:12px;box-shadow:0 0 0 1px rgba(64,158,255,.32),0 10px 30px rgba(0,0,0,.14);transition:opacity .2s ease,box-shadow .2s ease;}'
            + '#wfPanel:hover{opacity:1;}'
            + '#wfPanel.collapsed{opacity:.96;box-shadow:0 0 0 2px rgba(64,158,255,.55),0 8px 24px rgba(0,0,0,.16);}'
            + '#wfPanel .wf-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#ebeef5);border-radius:12px 12px 0 0;box-shadow:0 6px 24px rgba(0,0,0,.12);font-size:14px;font-weight:600;color:var(--text-primary,#303133);cursor:move;touch-action:none;user-select:none;}'
            + '#wfPanel .wf-head button{cursor:pointer;}'
            + '#wfPanel .wf-head .wf-count{position:relative;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;background:#f56c6c;border-radius:10px;padding:1px 7px;animation:wfCountBeat 1.8s ease-in-out infinite;}'
            + '#wfPanel .wf-head .wf-count::after{content:"";position:absolute;inset:-3px;border-radius:10px;border:2px solid rgba(245,108,108,.62);animation:wfCountPulse 1.5s ease-out infinite;pointer-events:none;}'
            + '@keyframes wfCountPulse{0%{transform:scale(.72);opacity:.9}70%{transform:scale(1.35);opacity:0}100%{transform:scale(1.35);opacity:0}}'
            + '@keyframes wfCountBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}'
            + '@media (prefers-reduced-motion: reduce){#wfPanel .wf-head .wf-count,#wfPanel .wf-head .wf-count::after{animation:none;}}'
            + '#wfPanel .wf-fold{margin-left:auto;border:none;background:transparent;color:#909399;font-size:13px;line-height:1;cursor:pointer;padding:4px 5px;border-radius:5px;}'
            + '#wfPanel .wf-fold:hover{color:#409eff;background:rgba(64,158,255,.1);}'
            + '#wfPanel .wf-toggle{border:none;background:transparent;color:#909399;font-size:13px;line-height:1;cursor:pointer;padding:4px 5px;border-radius:5px;}'
            + '#wfPanel .wf-toggle:hover{color:#409eff;background:rgba(64,158,255,.1);}'
            + '#wfPanel .wf-close{border:none;background:transparent;color:#909399;font-size:20px;line-height:1;cursor:pointer;padding:0 2px;margin-left:2px;}'
            + '#wfPanel .wf-close:hover{color:#303133;}'
            + '#wfPanel.folded #wfList{display:none;}'
            + '#wfPanel.folded .wf-head{border-radius:12px;}'
            + '#wfPanel.collapsed{width:auto;}'
            + '#wfPanel.collapsed #wfList{display:none;}'
            + '#wfPanel.collapsed .wf-head{border-radius:12px;padding:6px 8px;justify-content:flex-end;gap:4px;}'
            + '#wfPanel.collapsed .wf-head .wf-stream-icon,#wfPanel.collapsed .wf-head .wf-title-text,#wfPanel.collapsed .wf-head .wf-fold,#wfPanel.collapsed .wf-head .wf-close{display:none;}'
            + '#wfList{background:var(--bg-secondary,#f5f7fa);border:1px solid var(--border-color,#ebeef5);border-top:none;border-radius:0 0 12px 12px;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 28px rgba(0,0,0,.12);}'
            + '.wf-card{display:flex;gap:9px;padding:9px 10px;background:var(--bg-primary,#fff);border-radius:9px;border-left:3px solid #409eff;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;animation:wfIn .22s ease both;}'
            + '.wf-card:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.12);}'
            + '.wf-card .wf-icon{width:30px;height:30px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;}'
            + '.wf-card .wf-body{flex:1;min-width:0;}'
            + '.wf-card .wf-title{font-size:13px;font-weight:600;color:var(--text-primary,#303133);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
            + '.wf-card .wf-text{font-size:12px;color:var(--text-secondary,#606266);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:2px;word-break:break-word;}'
            + '.wf-card .wf-time{font-size:10px;color:var(--text-light,#909399);margin-top:3px;}'
            + '.wf-card .wf-arrow{color:#c0c4cc;font-size:11px;align-self:center;flex-shrink:0;}'
            + '.wf-card .wf-badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;color:#fff;background:#f56c6c;margin-right:5px;vertical-align:1px;}'
            + '#wfPanel .wf-sec-title{display:flex;align-items:center;gap:6px;padding:2px 4px;font-size:11px;font-weight:600;color:#909399;}'
            + '#wfPanel .wf-sec-title.todo{color:#f56c6c;}'
            + '#wfPanel .wf-more{text-align:center;padding:3px 0 5px;}'
            + '#wfPanel .wf-more-btn{border:1px solid var(--border-color,#dcdfe6);background:var(--bg-primary,#fff);color:#409eff;border-radius:14px;padding:5px 16px;font-size:12px;cursor:pointer;transition:all .15s;}'
            + '#wfPanel .wf-more-btn:hover{border-color:#409eff;background:rgba(64,158,255,.08);}'
            + '#wfPanel .wf-more-btn:disabled{opacity:.5;cursor:default;}'
            + '#wfPanel .wf-empty-tip{text-align:center;font-size:12px;color:#909399;padding:4px 0;}'
            + '.wf-card.wf-todo{background:linear-gradient(90deg,#fff5ee,#fff);box-shadow:0 2px 10px rgba(245,108,108,.10);}'
            + '@keyframes wfIn{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}'
            + '[data-theme="dark"] #wfPanel .wf-head{background:#1e1e1e;border-color:#333;color:#e0e0e0;}'
            + '[data-theme="dark"] #wfList{background:#1a1a1a;border-color:#333;}'
            + '[data-theme="dark"] .wf-card{background:#2d2d2d;}'
            + '[data-theme="dark"] .wf-card.wf-todo{background:#332622;}'
            + '[data-theme="dark"] .wf-card .wf-title{color:#e5eaf3;}'
            + '[data-theme="dark"] .wf-card .wf-text{color:#a8b0bd;}'
            + '@media (max-width:768px){#wfPanel{left:8px;right:8px;top:auto;bottom:calc(8px + env(safe-area-inset-bottom,0px));width:auto;max-width:none;max-height:58vh;}#wfPanel .wf-head{border-radius:12px 12px 0 0;}#wfList{border-radius:0 0 12px 12px;}}';
        var style = document.createElement('style');
        style.id = 'wfStyle';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function isCollapsed() {
        try { return sessionStorage.getItem('wf_collapsed') === '1'; } catch (e) { return false; }
    }

    function setCollapsed(v) {
        try { sessionStorage.setItem('wf_collapsed', v ? '1' : '0'); } catch (e) {}
    }

    function isFolded() {
        try { return sessionStorage.getItem('wf_folded') === '1'; } catch (e) { return false; }
    }

    function setFolded(v) {
        try { sessionStorage.setItem('wf_folded', v ? '1' : '0'); } catch (e) {}
    }

    function _clampPos(panel, left, top) {
        var w = panel.offsetWidth || 0;
        var h = panel.offsetHeight || 0;
        return {
            left: Math.max(4, Math.min(left, window.innerWidth - w - 4)),
            top: Math.max(4, Math.min(top, window.innerHeight - h - 4))
        };
    }

    function restorePosition(panel) {
        try {
            var raw = localStorage.getItem('wf_position');
            if (!raw) return;
            var pos = JSON.parse(raw);
            if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
            var c = _clampPos(panel, pos.left, pos.top);
            panel.style.left = c.left + 'px';
            panel.style.top = c.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        } catch (e) {}
    }

    function savePosition(panel) {
        try {
            localStorage.setItem('wf_position', JSON.stringify({
                left: parseInt(panel.style.left, 10) || panel.offsetLeft,
                top: parseInt(panel.style.top, 10) || panel.offsetTop
            }));
        } catch (e) {}
    }

    function enableDrag(panel) {
        var head = panel.querySelector('.wf-head');
        if (!head) return;
        var state = null;
        head.addEventListener('pointerdown', function (e) {
            if (e.target && e.target.closest && e.target.closest('button')) return;
            var rect = panel.getBoundingClientRect();
            state = {dx: e.clientX - rect.left, dy: e.clientY - rect.top};
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transition = 'none';
            try { head.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        head.addEventListener('pointermove', function (e) {
            if (!state) return;
            var c = _clampPos(panel, e.clientX - state.dx, e.clientY - state.dy);
            panel.style.left = c.left + 'px';
            panel.style.top = c.top + 'px';
            e.preventDefault();
        });
        var end = function (e) {
            if (!state) return;
            state = null;
            panel.style.transition = '';
            try { head.releasePointerCapture(e.pointerId); } catch (err) {}
            savePosition(panel);
        };
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
    }

    function dismiss() {
        // 仅隐藏当前页面；下次打开页面仍会默认展示（不做持久化关闭）
        var p = document.getElementById('wfPanel');
        if (p) p.remove();
    }

    function todoCardHtml(t) {
        return '<div class="wf-card wf-todo" data-kind="' + esc(t.kind || '') + '" data-url="' + esc(t.url || '') + '">'
            + '<div class="wf-icon" style="background:#f56c6c;">'
            + '<i class="fas ' + (t.kind === 'approval' ? 'fa-check-double' : (t.kind === 'workorder' ? 'fa-clipboard-list' : 'fa-tasks')) + '"></i></div>'
            + '<div class="wf-body"><div class="wf-title"><span class="wf-badge">' + esc(t.badge || '待办') + '</span>'
            + esc(t.title || '') + '</div>'
            + '<div class="wf-text">' + esc(t.subtitle || '') + '</div>'
            + '<div class="wf-time">' + esc(fmtTime(t.since)) + '</div></div>'
            + '<i class="fas fa-chevron-right wf-arrow"></i></div>';
    }

    function normalCardHtml(n) {
        var color = typeColor(n.type);
        var url = jumpUrl(n);
        return '<div class="wf-card" data-id="' + n.id + '" data-url="' + esc(url) + '"'
            + ' style="border-left-color:' + color + ';">'
            + '<div class="wf-icon" style="background:' + color + ';">'
            + '<i class="fas ' + typeIcon(n.type) + '"></i></div>'
            + '<div class="wf-body"><div class="wf-title">' + esc(n.title || '工作通知') + '</div>'
            + '<div class="wf-text">' + esc(n.content || '') + '</div>'
            + '<div class="wf-time">' + esc(fmtTime(n.created_at)) + '</div></div>'
            + '<i class="fas fa-chevron-right wf-arrow"></i></div>';
    }

    // 待办已展示的事项，不再在「工作通知」区重复展示
    function filterNotifications() {
        var todoKeys = {};
        (cachedTodo || []).forEach(function (t) { todoKeys[t.kind + ':' + t.id] = true; });
        return (cached || []).filter(function (n) {
            var ed = n.extra_data || {};
            if (n.type === 'approval' && ed.approval_id) return !todoKeys['approval:' + ed.approval_id];
            if (n.type === 'task' && ed.task_id) return !todoKeys['task:' + ed.task_id];
            if (n.type === 'workorder' && ed.work_order_id) return !todoKeys['workorder:' + ed.work_order_id];
            return true;
        });
    }

    function moreHtml(kind, hasMore) {
        if (!hasMore) return '';
        var label = kind === 'todo' ? '加载更多待办' : '加载更多通知';
        return '<div class="wf-more"><button class="wf-more-btn" data-kind="' + kind + '">'
            + label + ' <i class="fas fa-chevron-down" style="font-size:10px;"></i></button></div>';
    }

    function render(todo, rows) {
        var old = document.getElementById('wfPanel');
        var listScroll = 0;
        if (old) {
            var oldList = old.querySelector('#wfList');
            listScroll = oldList ? oldList.scrollTop : 0;
            old.remove();
        }
        todo = todo || [];
        rows = rows || [];
        // 即使当前页被去重后为空，只要仍有更多数据，也必须渲染分区与「加载更多」按钮
        if (!todo.length && !rows.length && !todoHasMore && !notifHasMore) return;
        injectStyles();
        var panel = document.createElement('div');
        panel.id = 'wfPanel';
        var displayTotal = (todoTotal || todo.length) + (notifTotal || rows.length);
        var html = ''
            + '<div class="wf-head"><i class="fas fa-stream wf-stream-icon" style="color:#409eff;"></i><span class="wf-title-text">工作通知</span>'
            + '<span class="wf-count">' + displayTotal + '</span>'
            + '<button class="wf-fold" title="收起"><i class="fas fa-chevron-up"></i></button>'
            + '<button class="wf-toggle" title="隐藏瀑布流"><i class="fas fa-eye-slash"></i></button>'
            + '<button class="wf-close" title="关闭">&times;</button></div>'
            + '<div id="wfList">';
        if (todo.length || todoHasMore) {
            html += '<div class="wf-sec-title todo"><i class="fas fa-list-check"></i> 待办工作（' + (todoTotal || todo.length) + '）</div>'
                + (todo.length ? todo.map(todoCardHtml).join('') : '<div class="wf-empty-tip">暂无更多待办</div>')
                + moreHtml('todo', todoHasMore);
        }
        if (rows.length || notifHasMore) {
            html += '<div class="wf-sec-title"><i class="fas fa-bell"></i> 工作通知（' + (notifTotal || rows.length) + '）</div>'
                + (rows.length ? rows.map(normalCardHtml).join('') : '<div class="wf-empty-tip">当前页通知已并入待办，继续加载更多</div>')
                + moreHtml('notif', notifHasMore);
        }
        html += '</div>';
        panel.innerHTML = html;
        document.body.appendChild(panel);
        restorePosition(panel);
        enableDrag(panel);
        if (listScroll) {
            var newList = panel.querySelector('#wfList');
            if (newList) newList.scrollTop = listScroll;
        }
        var toggleBtn = panel.querySelector('.wf-toggle');
        var toggleIcon = toggleBtn ? toggleBtn.querySelector('i') : null;
        var foldBtn = panel.querySelector('.wf-fold');
        var foldIcon = foldBtn ? foldBtn.querySelector('i') : null;
        var clampIfDragged = function () {
            if (!panel.style.left) return;
            setTimeout(function () {
                var left = parseInt(panel.style.left, 10) || 0;
                var top = parseInt(panel.style.top, 10) || 0;
                var c = _clampPos(panel, left, top);
                panel.style.left = c.left + 'px';
                panel.style.top = c.top + 'px';
            }, 0);
        };
        var applyFolded = function (folded) {
            panel.classList.toggle('folded', folded);
            if (foldIcon) foldIcon.className = folded ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
            if (foldBtn) foldBtn.title = folded ? '展开' : '收起';
            clampIfDragged();
        };
        var applyCollapsed = function (collapsed) {
            panel.classList.toggle('collapsed', collapsed);
            if (toggleIcon) toggleIcon.className = collapsed ? 'fas fa-eye' : 'fas fa-eye-slash';
            if (toggleBtn) toggleBtn.title = collapsed ? '显示瀑布流' : '隐藏瀑布流';
            if (collapsed) {
                setFolded(false);
                panel.classList.remove('folded');
                if (foldIcon) foldIcon.className = 'fas fa-chevron-up';
                if (foldBtn) foldBtn.title = '收起';
            }
            clampIfDragged();
        };
        applyCollapsed(isCollapsed());
        if (!isCollapsed()) applyFolded(isFolded());
        if (foldBtn) {
            foldBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var next = !panel.classList.contains('folded');
                setFolded(next);
                applyFolded(next);
            });
        }
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var next = !panel.classList.contains('collapsed');
                setCollapsed(next);
                applyCollapsed(next);
            });
        }
        panel.querySelector('.wf-close').addEventListener('click', function (e) {
            e.stopPropagation();
            dismiss();
        });
        panel.querySelectorAll('.wf-more-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                loadMore(btn.getAttribute('data-kind'), panel);
            });
        });
        panel.querySelectorAll('.wf-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var url = card.getAttribute('data-url') || '';
                var id = card.getAttribute('data-id');
                // 待办不是「消息通知」，不标记已读；处理完成后由后端自动从待办中移除
                if (id) apiPost(OA_API + '/notifications/' + id + '/mark-read/').catch(function () {});
                if (url) window.location.href = url;
            });
        });
    }

    async function loadMore(kind, panel) {
        if (kind === 'todo' && (!todoHasMore || todoLoading)) return;
        if (kind === 'notif' && (!notifHasMore || notifLoading)) return;
        var btn = panel ? panel.querySelector('.wf-more-btn[data-kind="' + kind + '"]') : null;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
        }
        if (kind === 'todo') todoLoading = true; else notifLoading = true;
        try {
            if (kind === 'todo') {
                var nextTodo = todoPage + 1;
                var td = await apiGet(OA_API + '/notifications/todo/?page=' + nextTodo + '&page_size=' + TODO_PAGE_SIZE);
                todoPage = nextTodo;
                todoTotal = (td && td.count != null) ? td.count : todoTotal;
                var todoSeen = {};
                cachedTodo.forEach(function (t) { todoSeen[t.kind + ':' + t.id] = true; });
                var todoAdded = ((td && td.items) || []).filter(function (t) { return !todoSeen[t.kind + ':' + t.id]; });
                cachedTodo = cachedTodo.concat(todoAdded);
                todoHasMore = todoAdded.length > 0 &&
                    (cachedTodo.length < todoTotal || !!(td && td.has_more));
            } else {
                var nextNotif = notifPage + 1;
                var nd = await apiGet(OA_API + '/notifications/?page=' + nextNotif + '&page_size=' + MAX_ITEMS + '&read_filter=unread');
                notifPage = nextNotif;
                notifTotal = (nd && nd.count != null) ? nd.count : notifTotal;
                var notifSeen = {};
                cached.forEach(function (n) { notifSeen[n.id] = true; });
                var notifAdded = ((nd && nd.results) || []).filter(function (n) { return !notifSeen[n.id]; });
                cached = cached.concat(notifAdded);
                notifHasMore = notifAdded.length > 0 && (!!(nd && nd.next) ||
                    (notifTotal != null && cached.length < notifTotal));
            }
            render(cachedTodo, filterNotifications());
        } catch (e) {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '加载失败，点击重试';
            }
        } finally {
            if (kind === 'todo') todoLoading = false; else notifLoading = false;
        }
    }

    async function load() {
        try {
            if (!token()) return;
            var cfg = await apiGet(OA_API + '/notifications/waterfall-config/');
            if (!cfg || !cfg.enabled) return;
            var results = await Promise.all([
                apiGet(OA_API + '/notifications/todo/?page=1&page_size=' + TODO_PAGE_SIZE),
                apiGet(OA_API + '/notifications/?page=1&page_size=' + MAX_ITEMS + '&read_filter=unread')
            ]);
            var td = results[0] || {};
            var nd = results[1] || {};
            cachedTodo = td.items || [];
            todoPage = 1;
            todoTotal = (td.count != null) ? td.count : cachedTodo.length;
            // 以「总数 > 已加载」为主判断，兼容旧后端未返回 has_more / next 的情况
            todoHasMore = (cachedTodo.length < todoTotal) || !!td.has_more;
            cached = nd.results || [];
            notifPage = 1;
            notifTotal = (nd.count != null) ? nd.count : cached.length;
            notifHasMore = !!(nd.next) || (notifTotal > cached.length);
            render(cachedTodo, filterNotifications());
        } catch (e) {
            // 静默失败：瀑布流不影响页面其它功能
        }
    }

    function schedule() {
        var run = function () { setTimeout(load, 600); };
        if ('requestIdleCallback' in window) {
            requestIdleCallback(run, {timeout: 2500});
        } else {
            setTimeout(run, 1000);
        }
    }

    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule);

    window.NotificationWaterfall = {
        refresh: function () {
            cached = [];
            cachedTodo = [];
            todoPage = 0;
            notifPage = 0;
            todoTotal = 0;
            notifTotal = 0;
            todoHasMore = false;
            notifHasMore = false;
            load();
        },
        close: dismiss
    };
})();
