// static/js/work-summary.js - 每日工作总结（上传工作数据 + 总结文字 → 大模型流式分析）
const WS_API = '/api/oa/work-summary';

class WorkSummaryApp {
    constructor() {
        this.myPage = 1;
        this.myPageSize = 20;
        this.teamPage = 1;
        this.teamPageSize = 20;
        this.maxMessageLength = localStorage.getItem('max_message_length') || 5000;
        this.myFiles = [];
        this._canViewAll = false;
        this._isSuperAdmin = false;
        this._currentTab = 'my';
        this._polling = {};   // id -> {element, timer}
        this.rangePage = 1;
        this.rangePageSize = 10;
        this._rangeUsers = [];
        this._rangePolling = {};
        this._teamUsers = [];
        this.config = null;
        this._savedCloud = {};   // url -> cloud file_id（本次会话内已保存到网盘的文件）
        this._init();
    }

    async _init() {
        const token = localStorage.getItem('access_token');
        if (!token) { localStorage.setItem('redirect_url', window.location.href); window.location.href = '/login/'; return; }
        // 打印权限：无权限则隐藏打印按钮并提示（企业网盘操作权限-允许打印）
        if (window.WatermarkManager && WatermarkManager.applyPrintPermission) {
            WatermarkManager.applyPrintPermission();
        }
        // 工作总结日期默认今日；范围分析默认近 30 天
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const todayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
        const dateEl = document.getElementById('wsDate');
        if (dateEl) dateEl.value = todayStr;
        const fromD = new Date(now.getTime() - 29 * 86400000);
        const fromStr = fromD.getFullYear() + '-' + pad(fromD.getMonth() + 1) + '-' + pad(fromD.getDate());
        const dfEl = document.getElementById('wsRangeDateFrom');
        const dtEl = document.getElementById('wsRangeDateTo');
        if (dfEl) dfEl.value = fromStr;
        if (dtEl) dtEl.value = todayStr;
        await this._loadMe();
        await this._loadConfig();
        this._checkTodaySummary();
        this.switchTab('my');
        // 从工作日历/通知跳转：打开指定总结
        const qp = new URLSearchParams(window.location.search);
        const sid = qp.get('id');
        if (sid) setTimeout(() => this.openDetail(parseInt(sid, 10)), 300);
    }

    async _loadMe() {
        try {
            const me = await this.apiGet('/api/auth/me/');
            this.me = me;
            this._myId = me && (me.id != null ? me.id : me.user_id);
            this._isSuperAdmin = (me.user_type === 'super_admin');
            // 探测团队查看权限（部门负责人 / 超管）
            const resp = await fetch(WS_API + '/all/?page=1&page_size=1', {headers: TokenManager.getHeaders()});
            if (resp.ok) this._canViewAll = true;
        } catch (e) { /* ignore */ }
        const teamTab = document.getElementById('wsTabTeam');
        const rangeTab = document.getElementById('wsTabRange');
        if (teamTab) teamTab.style.display = this._canViewAll ? '' : 'none';
        if (rangeTab) rangeTab.style.display = this._canViewAll ? '' : 'none';
        if (this._canViewAll) { this._loadDepartments(); this.loadRangeAnalyses(1); }
    }

    async _loadConfig() {
        try {
            const cfg = await this.apiGet(WS_API + '/config/');
            this.config = cfg;
            const banner = document.getElementById('wsDisabledBanner');
            if (banner) banner.style.display = (cfg && cfg.enabled === false) ? 'flex' : 'none';
            const btn = document.getElementById('wsModelConfigBtn');
            if (btn) btn.style.display = (cfg && cfg.is_super_admin) ? '' : 'none';
            // 数据安全提示：脱敏开启时展示（默认开启）
            const sec = document.getElementById('wsSecurityNotice');
            if (sec) sec.style.display = (cfg && cfg.mask_sensitive !== false) ? 'flex' : 'none';
        } catch (e) { /* ignore */ }
    }
    openConfigModal() {
        const cfg = this.config || {};
        const en = document.getElementById('wsModelEnabled');
        if (en) en.checked = !!cfg.enabled;
        this._updateEnabledText();
        const sel = document.getElementById('wsModelSelect');
        const def = document.getElementById('wsDefaultModel');
        if (sel) {
            const presets = (cfg.presets || []).slice();
            const cur = cfg.model_id || '';
            const known = presets.some(p => p.id === cur);
            sel.innerHTML = '<option value="">使用系统默认模型</option>'
                + presets.map(p => '<option value="' + this._escape(p.id) + '">' + this._escape(p.name) + '（' + this._escape(p.id) + '）</option>').join('')
                + '<option value="__custom__">自定义模型...</option>';
            sel.value = known ? cur : (cur ? '__custom__' : '');
            const custom = document.getElementById('wsModelCustom');
            if (custom) custom.value = cur;
        }
        if (def) def.textContent = cfg.effective_model || '';
        this.onModelSelectChange();
        // —— 数据安全 / 限额 / 灰度试点 ——
        const mask = document.getElementById('wsMaskSensitive');
        if (mask) mask.checked = cfg.mask_sensitive !== false;
        this._updateMaskText();
        const lim = document.getElementById('wsLimitEnabled');
        if (lim) lim.checked = !!cfg.limit_enabled;
        this._updateLimitUi();
        if (document.getElementById('wsDailyCallLimit')) document.getElementById('wsDailyCallLimit').value = cfg.daily_call_limit || 0;
        if (document.getElementById('wsDailyCostLimit')) document.getElementById('wsDailyCostLimit').value = cfg.daily_cost_limit != null ? cfg.daily_cost_limit : 0;
        if (document.getElementById('wsCostPer1k')) document.getElementById('wsCostPer1k').value = (cfg.cost_per_1k_tokens != null ? cfg.cost_per_1k_tokens : 0.002);
        if (document.getElementById('wsTodayCalls')) document.getElementById('wsTodayCalls').textContent = cfg.today_call_count || 0;
        if (document.getElementById('wsTodayCost')) document.getElementById('wsTodayCost').textContent = (cfg.today_cost != null ? Number(cfg.today_cost) : 0).toFixed(2);
        const scopeSel = document.getElementById('wsScopeType');
        if (scopeSel) scopeSel.value = cfg.scope_type || 'all';
        this._scopeUsers = (cfg.scope_users_info || []).slice();
        this._scopeDeptIds = new Set((cfg.scope_type === 'departments' ? (cfg.scope_value || []) : []).map(Number));
        this._loadScopeValue();
        this._updateScopeUi();
        const modal = document.getElementById('wsModelModal');
        if (modal) modal.classList.add('show');
    }
    _updateMaskText() {
        const on = !!(document.getElementById('wsMaskSensitive') && document.getElementById('wsMaskSensitive').checked);
        const txt = document.getElementById('wsMaskText');
        if (txt) { txt.textContent = on ? '已开启' : '已关闭'; txt.style.color = on ? '#67c23a' : '#f56c6c'; }
    }
    _updateLimitUi() {
        const on = !!(document.getElementById('wsLimitEnabled') && document.getElementById('wsLimitEnabled').checked);
        const fields = document.getElementById('wsLimitFields');
        if (fields) fields.style.display = on ? 'block' : 'none';
        const txt = document.getElementById('wsLimitText');
        if (txt) { txt.textContent = on ? '已启用' : '未启用'; txt.style.color = on ? '#67c23a' : '#909399'; }
    }
    _updateScopeUi() {
        const v = document.getElementById('wsScopeType') ? document.getElementById('wsScopeType').value : 'all';
        const p = document.getElementById('wsScopePositions');
        const d = document.getElementById('wsScopeDepts');
        const u = document.getElementById('wsScopeUsers');
        if (p) p.style.display = v === 'positions' ? 'block' : 'none';
        if (d) d.style.display = v === 'departments' ? 'block' : 'none';
        if (u) u.style.display = v === 'users' ? 'block' : 'none';
        if (v === 'departments') this._loadScopeDepts();
        if (v === 'users') this._renderScopeUserTags();
    }

    // 全屏/退出全屏
    toggleMaximize(btn) {
        var mc = btn.closest('.ws-modal-content') || btn.closest('.ws-model-box') || btn.closest('.modal-content') ;
        if (!mc) return;
        var isMax = mc.classList.toggle('maximized');
        var icon = btn.querySelector('i');
        if (icon) {
            icon.className = isMax ? 'fas fa-compress' : 'fas fa-expand';
        }
        btn.title = isMax ? '恢复' : '最大化';
    }

    async _loadScopeDepts() {
        const wrap = document.getElementById('wsScopeDeptList');
        if (!wrap) return;
        if (this._deptTree) { this._renderScopeDeptList(); return; }
        try {
            const resp = await fetch('/api/oa/approval/org_departments/', {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            const data = await resp.json();
            this._deptTree = data.results || [];
            this._renderScopeDeptList();
        } catch (e) { /* ignore */ }
    }
    _renderScopeDeptList() {
        const wrap = document.getElementById('wsScopeDeptList');
        if (!wrap) return;
        const depts = this._deptTree || [];
        if (!depts.length) { wrap.innerHTML = '<div style="color:#909399;">暂无部门数据</div>'; return; }
        const byId = {};
        depts.forEach(d => { byId[d.id] = d; });
        const kids = {};
        depts.forEach(d => { const pid = d.parent_id != null ? d.parent_id : 0; (kids[pid] = kids[pid] || []).push(d); });
        let html = '';
        const walk = (pid, depth) => (kids[pid] || []).forEach(d => {
            const checked = this._scopeDeptIds.has(Number(d.id));
            html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;">'
                + '<input type="checkbox" data-dept="' + d.id + '" ' + (checked ? 'checked' : '') + ' style="width:15px;height:15px;cursor:pointer;flex-shrink:0;"> '
                + new Array(depth).join('—') + this.escapeHtml(d.name) + '</label>';
            walk(d.id, depth + 1);
        });
        walk(0, 0);
        if (!kids[0] || !kids[0].length) {
            const allIds = {};
            depts.forEach(d => { allIds[d.id] = true; });
            const roots = depts.filter(d => !allIds[d.parent_id]);
            const flat = (items, depth) => items.forEach(d => {
                const checked = this._scopeDeptIds.has(Number(d.id));
                html += '<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;">'
                    + '<input type="checkbox" data-dept="' + d.id + '" ' + (checked ? 'checked' : '') + ' style="width:15px;height:15px;cursor:pointer;flex-shrink:0;"> '
                    + new Array(depth).join('—') + this.escapeHtml(d.name) + '</label>';
                flat(kids[d.id] || [], depth + 1);
            });
            flat(roots, 0);
        }
        wrap.innerHTML = html;
        wrap.querySelectorAll('input[data-dept]').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) this._scopeDeptIds.add(Number(cb.getAttribute('data-dept')));
                else this._scopeDeptIds.delete(Number(cb.getAttribute('data-dept')));
            });
        });
    }
    async searchScopeUsers() {
        const input = document.getElementById('wsScopeUserInput');
        const kw = (input ? input.value : '').trim();
        const list = document.getElementById('wsScopeUserList');
        if (!list) return;
        try {
            const data = await this.apiGet(WS_API + '/members/?search=' + encodeURIComponent(kw));
            this._scopeUsersFound = (data.results || []).slice();
            const users = this._scopeUsersFound.filter(u => !(this._scopeUsers || []).some(x => x.id === u.id));
            if (!kw || !users.length) { list.innerHTML = ''; list.classList.remove('show'); return; }
            const self = this;
            list.classList.add('show');
            list.innerHTML = users.map(u =>
                '<div class="ws-range-user-item" onclick="workSummaryApp.pickScopeUser(' + u.id + ', this)">'
                + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '">'
                + '<div class="ws-range-user-meta"><div>' + self.escapeHtml(u.name) + '</div>'
                + '<div class="ws-range-user-sub">' + self.escapeHtml(u.department_name || '') + (u.position ? ' · ' + self.escapeHtml(u.position) : '') + '</div></div></div>'
            ).join('');
        } catch (e) { /* ignore */ }
    }
    pickScopeUser(id, el) {
        this._scopeUsers = this._scopeUsers || [];
        const u = (this._scopeUsersFound || []).find(x => x.id === id);
        if (u && !this._scopeUsers.some(x => x.id === id)) this._scopeUsers.push(u);
        const input = document.getElementById('wsScopeUserInput');
        if (input) input.value = '';
        const list = document.getElementById('wsScopeUserList');
        if (list) { list.innerHTML = ''; list.classList.remove('show'); }
        this._renderScopeUserTags();
    }
    removeScopeUser(id) {
        this._scopeUsers = (this._scopeUsers || []).filter(x => x.id !== id);
        this._renderScopeUserTags();
    }
    _renderScopeUserTags() {
        const wrap = document.getElementById('wsScopeUserTags');
        if (!wrap) return;
        const users = this._scopeUsers || [];
        wrap.innerHTML = users.map(u =>
            '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#ecf5ff;border-radius:14px;font-size:12px;color:#409eff;">'
            + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">'
            + this.escapeHtml(u.name)
            + '<i class="fas fa-times" style="cursor:pointer;color:#f56c6c;" onclick="workSummaryApp.removeScopeUser(' + u.id + ')"></i></span>'
        ).join('') || '<span style="color:#c0c4cc;font-size:12px;">未选择用户</span>';
    }
    _loadScopeValue() {
        const v = document.getElementById('wsScopeType') ? document.getElementById('wsScopeType').value : 'all';
        if (v === 'positions') {
            const ta = document.getElementById('wsScopePositionsInput');
            if (ta) ta.value = (this.config.scope_value || []).join('\n');
        }
    }
    closeConfigModal() {
        const modal = document.getElementById('wsModelModal');
        if (modal) modal.classList.remove('show');
    }
    _updateEnabledText() {
        const en = document.getElementById('wsModelEnabled');
        const txt = document.getElementById('wsModelEnabledText');
        const on = !!(en && en.checked);
        if (txt) { txt.textContent = on ? '已启用' : '已停用'; txt.style.color = on ? '#67c23a' : '#f56c6c'; }
    }
    onModelSelectChange() {
        const sel = document.getElementById('wsModelSelect');
        const customRow = document.getElementById('wsModelCustomRow');
        if (customRow) customRow.style.display = (sel && sel.value === '__custom__') ? 'block' : 'none';
        this._updateEffectiveModel();
    }
    _updateEffectiveModel() {
        const sel = document.getElementById('wsModelSelect');
        const custom = document.getElementById('wsModelCustom');
        const eff = document.getElementById('wsEffectiveModel');
        let v = '';
        if (sel) {
            if (sel.value === '__custom__') v = (custom ? custom.value : '').trim();
            else if (sel.value) v = sel.value;
        }
        if (!v && this.config && this.config.effective_model) v = this.config.effective_model;
        if (eff) eff.textContent = v || '（未配置）';
    }
    _collectScopeValue() {
        const v = document.getElementById('wsScopeType') ? document.getElementById('wsScopeType').value : 'all';
        if (v === 'positions') {
            const ta = document.getElementById('wsScopePositionsInput');
            return (ta ? ta.value : '').split('\n').map(s => s.trim()).filter(Boolean);
        }
        if (v === 'departments') return Array.from(this._scopeDeptIds || []);
        if (v === 'users') return (this._scopeUsers || []).map(u => u.id);
        return [];
    }
    async saveConfig() {
        const en = document.getElementById('wsModelEnabled');
        const sel = document.getElementById('wsModelSelect');
        const custom = document.getElementById('wsModelCustom');
        let model_id = '';
        if (sel) {
            if (sel.value === '__custom__') model_id = (custom ? custom.value : '').trim();
            else model_id = sel.value;
        }
        const payload = {
            enabled: !!(en && en.checked),
            model_id: model_id,
            mask_sensitive: !!(document.getElementById('wsMaskSensitive') && document.getElementById('wsMaskSensitive').checked),
            limit_enabled: !!(document.getElementById('wsLimitEnabled') && document.getElementById('wsLimitEnabled').checked),
            daily_call_limit: parseInt((document.getElementById('wsDailyCallLimit') || {}).value) || 0,
            daily_cost_limit: parseFloat((document.getElementById('wsDailyCostLimit') || {}).value) || 0,
            cost_per_1k_tokens: parseFloat((document.getElementById('wsCostPer1k') || {}).value) || 0.002,
            scope_type: (document.getElementById('wsScopeType') || {}).value || 'all',
            scope_value: this._collectScopeValue(),
        };
        try {
            const cfg = await this.apiPost(WS_API + '/config/', payload);
            this.config = cfg;
            this.toast('模型配置已保存', false);
            this.closeConfigModal();
            const banner = document.getElementById('wsDisabledBanner');
            if (banner) banner.style.display = (cfg.enabled === false) ? 'flex' : 'none';
            const sec = document.getElementById('wsSecurityNotice');
            if (sec) sec.style.display = (cfg.mask_sensitive !== false) ? 'flex' : 'none';
        } catch (e) {
            this.toast('保存失败：' + (e.message || ''), true);
        }
    }

    async _loadDepartments() {
        try {
            const resp = await fetch('/api/oa/approval/org_departments/', {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            const data = await resp.json();
            const depts = data.results || [];
            const sel = document.getElementById('wsDeptFilter');
            if (!sel) return;
            const tree = {};
            depts.forEach(d => { const pid = d.parent_id != null ? d.parent_id : 0; (tree[pid] = tree[pid] || []).push(d); });
            const self = this;
            let html = '<option value="">全部部门</option>';
            const walk = (pid, depth) => {
                (tree[pid] || []).forEach(d => {
                    html += '<option value="' + d.id + '">' + new Array(depth).join('—— ') + self.escapeHtml(d.name) + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            if (!tree[0] || !tree[0].length) {
                const allIds = {}; depts.forEach(d => { allIds[d.id] = true; });
                const roots = depts.filter(d => !allIds[d.parent_id]);
                const flat = (items, depth) => items.forEach(d => {
                    html += '<option value="' + d.id + '">' + new Array(depth).join('—— ') + self.escapeHtml(d.name) + '</option>';
                });
                flat(roots, 0);
            }
            sel.innerHTML = html;
        } catch (e) {}
    }

    // ===== API 封装 =====
    _apiError(resp, body) { const err = new Error((body && (body.error || body.detail)) || '请求失败'); err.status = resp.status; return err; }
    async apiGet(url) {
        const resp = await fetch(url, {headers: TokenManager.getHeaders()});
        if (!resp.ok) { if (resp.status === 401) { this._auth(); return null; } const b = await resp.json().catch(() => ({})); throw this._apiError(resp, b); }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    async apiPost(url, data) {
        const resp = await fetch(url, {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify(data || {})});
        if (!resp.ok) { const b = await resp.json().catch(() => ({})); throw this._apiError(resp, b); }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    async apiPostForm(url, formData) {
        const resp = await fetch(url, {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('access_token')}, body: formData});
        if (!resp.ok) { const b = await resp.json().catch(() => ({})); throw this._apiError(resp, b); }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    async apiDelete(url) {
        const resp = await fetch(url, {method: 'DELETE', headers: TokenManager.getHeaders()});
        if (!resp.ok) { const b = await resp.json().catch(() => ({})); throw this._apiError(resp, b); }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    _auth() { localStorage.removeItem('access_token'); localStorage.removeItem('user_id'); localStorage.removeItem('user_type'); localStorage.removeItem('current_user'); localStorage.setItem('redirect_url', window.location.href); window.location.href = '/login/'; }

    // ===== 工具 =====
    escapeHtml(t) { return Utils.escapeHtml ? Utils.escapeHtml(t) : String(t || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

    _escape(text) {
        return Utils.escapeHtml ? Utils.escapeHtml(text) : String(text || '').replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
    }

    // ===== markdown 渲染（先转义 HTML 再安全转换，防 XSS） =====
    _renderMarkdown(text) {
        if (!text) return '';
        const lines = String(text).replace(/\r\n/g, '\n').split('\n');
        const esc = t => this._escape(t);
        let html = '';
        let i = 0;
        let listType = null;
        let listItems = [];
        let inCode = false;
        let codeBuf = [];
        const flushList = () => {
            if (listItems.length) {
                html += '<' + listType + '>' + listItems.join('') + '</' + listType + '>';
                listItems = [];
            }
            listType = null;
        };
        while (i < lines.length) {
            const line = lines[i];
            if (inCode) {
                if (/^```/.test(line)) { inCode = false; html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; codeBuf = []; }
                else codeBuf.push(line);
                i++; continue;
            }
            if (/^```/.test(line)) { flushList(); inCode = true; codeBuf = []; i++; continue; }
            if (/^#{1,4}\s/.test(line)) {
                flushList();
                const m = line.match(/^(#{1,4})\s+(.*)$/);
                const lvl = Math.min(6, m[1].length + 1);
                html += '<h' + lvl + '>' + this._mdInline(esc(m[2])) + '</h' + lvl + '>';
                i++; continue;
            }
            if (/^---+$/.test(line)) { flushList(); html += '<hr>'; i++; continue; }
            if (/^\s*[-*]\s+/.test(line)) {
                if (listType && listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push('<li>' + this._mdInline(esc(line.replace(/^\s*[-*]\s+/, ''))) + '</li>');
                i++; continue;
            }
            if (/^\s*\d+[.)]\s+/.test(line)) {
                if (listType && listType !== 'ol') flushList();
                listType = 'ol';
                listItems.push('<li>' + this._mdInline(esc(line.replace(/^\s*\d+[.)]\s+/, ''))) + '</li>');
                i++; continue;
            }
            if (/^>\s?/.test(line)) {
                flushList();
                const q = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(this._mdInline(esc(lines[i].replace(/^>\s?/, '')))); i++; }
                html += '<blockquote>' + q.join('<br>') + '</blockquote>';
                continue;
            }
            if (!line.trim()) { flushList(); i++; continue; }
            flushList();
            const para = [line];
            i++;
            while (i < lines.length) {
                const nx = lines[i];
                if (!nx.trim() || /^```/.test(nx) || /^#{1,4}\s/.test(nx) || /^\s*[-*]\s+/.test(nx) || /^\s*\d+[.)]\s+/.test(nx) || /^>\s?/.test(nx) || /^---+$/.test(nx)) break;
                para.push(nx);
                i++;
            }
            html += '<p>' + para.map(x => this._mdInline(esc(x))).join('<br>') + '</p>';
        }
        flushList();
        if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
        return html;
    }
    _mdInline(t) {
        t = String(t || '');
        t = t.replace(/`([^`]+)`/g, (m, c) => '<code>' + c + '</code>');
        t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/(^|[^*])\*([^*\s][^*\n]*[^*\s])\*(?!\*)/g, (m, p, c) => p + '<em>' + c + '</em>');
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return t;
    }

    // ===== ChatGPT 式打字机流式输出（增量缓存 + markdown 渲染；opts.collapsible 时长内容完成后折叠） =====
    _resetTyping(key) {
        if (this._typeTimers && this._typeTimers[key]) { clearInterval(this._typeTimers[key]); delete this._typeTimers[key]; }
        if (this._typeEls) delete this._typeEls[key];
        if (this._typeLen) delete this._typeLen[key];
        if (this._typeBuf) delete this._typeBuf[key];
    }
    _startTyping(key, el, fullText, titleHtml, opts) {
        this._typeBuf = this._typeBuf || {};
        this._typeLen = this._typeLen || {};
        this._typeEls = this._typeEls || {};
        this._typeTimers = this._typeTimers || {};
        this._typeBuf[key] = fullText || '';
        if (!this._typeLen[key]) this._typeLen[key] = 0;
        if (!this._typeEls[key]) this._typeEls[key] = [];
        if (el) {
            if (el._thinkTimer) { clearInterval(el._thinkTimer); el._thinkTimer = null; }
            if (this._typeEls[key].indexOf(el) < 0) this._typeEls[key].push(el);
        }
        if (this._typeTimers[key]) return;
        const self = this;
        const useCollapse = !!(opts && opts.collapsible) && String(fullText || '').length > 220;
        const tick = () => {
            const buf = self._typeBuf[key] || '';
            self._typeLen[key] = Math.min(buf.length, (self._typeLen[key] || 0) + 3);
            const shown = buf.slice(0, self._typeLen[key]);
            const typing = self._typeLen[key] < buf.length;
            const body = self._renderMarkdown(shown) + (typing ? '<span class="ws-typing-caret"></span>' : '');
            let html;
            if (useCollapse) {
                const collapsed = !typing;
                html = titleHtml
                    + '<div class="ws-analysis-body-wrap' + (collapsed ? ' ws-collapsed' : '') + '"><div class="ws-analysis-body">' + body + '</div></div>'
                    + '<div class="ws-analysis-toggle"><button class="ws-collapse-btn" onclick="workSummaryApp.toggleAnalysisCollapse(this)">'
                    + (collapsed ? '<i class="fas fa-chevron-down"></i> 展开' : '<i class="fas fa-chevron-up"></i> 收起')
                    + '</button></div>';
            } else {
                html = titleHtml + '<div class="ws-analysis-body">' + body + '</div>';
            }
            (self._typeEls[key] || []).forEach(x => {
                if (x) { x.innerHTML = html; x.classList.toggle('ws-typing-active', typing); }
                // 打字时自动滚动到视野，防止输出的内容不在可视区
                if (typing && x) self._ensureTypingVisible(x);
            });
            if (!typing) {
                clearInterval(self._typeTimers[key]);
                delete self._typeTimers[key];
            }
        };
        tick();
        this._typeTimers[key] = setInterval(tick, 16);
    }
    _ensureTypingVisible(el) {
        try {
            var scroll = el.closest('.ws-modal-body') || el.closest('.modal-body');
            if (!scroll) return;
            // 用户若已向上翻阅历史（远离底部）则不强制跟随，避免打扰
            if ((scroll.scrollTop + scroll.clientHeight) < scroll.scrollHeight - 60) return;
            // 平滑贴底跟随：始终让内容底部在可视区，避免逐帧累加偏移导致的上下抖动/越滚越快
            scroll.scrollTop = scroll.scrollHeight;
        } catch (e) {}
    }
    _stopTyping(key, finalHtml) {
        if (this._typeTimers && this._typeTimers[key]) { clearInterval(this._typeTimers[key]); delete this._typeTimers[key]; }
        if (this._typeEls && this._typeEls[key]) {
            if (finalHtml) this._typeEls[key].forEach(x => { if (x) { x.innerHTML = finalHtml; x.classList.remove('ws-typing-active'); } });
            else this._typeEls[key].forEach(x => { if (x) x.classList.remove('ws-typing-active'); });
            delete this._typeEls[key];
        }
        if (this._typeBuf) delete this._typeBuf[key];
        if (this._typeLen) delete this._typeLen[key];
    }
    // 已完成分析：长内容默认折叠，带「展开/收起」按钮，防止内容太长影响查阅
    _analysisCollapsedHtml(result) {
        const long = String(result || '').length > 220;
        if (!long) return '<div class="ws-analysis-body">' + this._renderMarkdown(result) + '</div>';
        return '<div class="ws-analysis-body-wrap ws-collapsed"><div class="ws-analysis-body">' + this._renderMarkdown(result) + '</div></div>'
            + '<div class="ws-analysis-toggle"><button class="ws-collapse-btn" onclick="workSummaryApp.toggleAnalysisCollapse(this)"><i class="fas fa-chevron-down"></i> 展开</button></div>';
    }
    _analysisHtml(s) {
        if (s.status === 'done' && s.analysis_result) {
            return '<div class="ws-analysis"><div class="ws-analysis-title"><i class="fas fa-robot"></i> 大模型分析建议</div>' + this._analysisCollapsedHtml(s.analysis_result) + '</div>';
        }
        if (s.status === 'analyzing') {
            return '<div class="ws-analysis" id="wsAnalysis_' + s.id + '"></div>';
        }
        if (s.status === 'failed') {
            return '<div class="ws-analysis" style="color:#f56c6c;">分析失败：' + this.escapeHtml(s.error_message || '请重试') + '</div>';
        }
        if (s.status === 'limited') {
            return '<div class="ws-analysis" style="color:#e6a23c;"><i class="fas fa-hourglass-half"></i> ' + this.escapeHtml(s.error_message || '今日 AI 分析已达上限，明日可继续使用') + '</div>';
        }
        if (s.status === 'not_allowed') {
            return '<div class="ws-analysis" style="color:#909399;"><i class="fas fa-shield-alt"></i> ' + this.escapeHtml(s.error_message || '当前岗位/部门暂未开放 AI 分析（灰度试点中）') + '</div>';
        }
        if (s.status === 'disabled') {
            return '<div class="ws-analysis" style="color:#909399;">模型分析功能已停用</div>';
        }
        return '';
    }
    toggleAnalysisCollapse(btn) {
        const analysis = btn.closest('.ws-analysis');
        const wrap = analysis ? analysis.querySelector('.ws-analysis-body-wrap') : null;
        if (!wrap) return;
        const collapsed = wrap.classList.toggle('ws-collapsed');
        btn.innerHTML = collapsed ? '<i class="fas fa-chevron-down"></i> 展开' : '<i class="fas fa-chevron-up"></i> 收起';
    }
    // 长内容默认折叠，带「展开/收起」按钮（用于当日工作总结内容等）
    _collapsibleBlock(html, cls) {
        const long = String(html || '').length > 220;
        if (!long) return '<div class="' + cls + '">' + html + '</div>';
        return '<div class="ws-collapse-block">'
            + '<div class="' + cls + '-wrap ws-collapsed"><div class="' + cls + '">' + html + '</div></div>'
            + '<div class="ws-analysis-toggle"><button class="ws-collapse-btn" onclick="workSummaryApp.toggleContentCollapse(this)"><i class="fas fa-chevron-down"></i> 展开</button></div>'
            + '</div>';
    }
    toggleContentCollapse(btn) {
        const block = btn.closest('.ws-collapse-block');
        const wrap = block ? block.querySelector('.ws-content-wrap') : null;
        if (!wrap) return;
        const collapsed = wrap.classList.toggle('ws-collapsed');
        btn.innerHTML = collapsed ? '<i class="fas fa-chevron-down"></i> 展开' : '<i class="fas fa-chevron-up"></i> 收起';
    }
    // AI 分析中：科技感动态提示（扩散光环 + 脑图标 + 渐变流动文字 + 跳动圆点，文案轮播）
    _showThinking(el) {
        if (!el) return;
        if (el._thinkTimer) { clearInterval(el._thinkTimer); el._thinkTimer = null; }
        const msgs = ['正在读取今日工作数据', '正在调用大模型推理', '正在深度分析工作内容', '正在生成分析与建议'];
        let i = 0;
        el.classList.add('ws-thinking-active');
        el.innerHTML = '<div class="ws-ai-thinking">'
            + '<span class="ws-ai-rings"><span class="ws-ai-ring r1"></span><span class="ws-ai-ring r2"></span><span class="ws-ai-ring r3"></span><i class="fas fa-brain ws-ai-brain"></i></span>'
            + '<span class="ws-ai-mid"><span class="ws-ai-text">' + msgs[0] + '</span><span class="ws-ai-sub">AI 正在深度思考，为您精心生成分析与建议，请稍候...</span></span>'
            + '<span class="ws-ai-dots"><i></i><i></i><i></i></span>'
            + '</div>';
        el._thinkTimer = setInterval(() => {
            if (!el._thinkTimer) return;
            i = (i + 1) % msgs.length;
            const t = el.querySelector('.ws-ai-text');
            if (t) t.textContent = msgs[i];
        }, 1500);
    }

    statusBadge(st) {
        const m = {pending:['待分析','pending'], analyzing:['分析中','analyzing'], done:['已完成','done'], failed:['分析失败','failed'], disabled:['已停用','disabled'], limited:['已达限额','failed'], not_allowed:['未开放分析','disabled']};
        const x = m[st] || [st, 'pending'];
        return '<span class="ws-badge ' + x[1] + '">' + x[0] + '</span>';
    }
    fileIcon(type) {
        return {image: 'fa-image', table: 'fa-table', doc: 'fa-file-word'}[type] || 'fa-file';
    }

    // ===== 工作数据文件：图片缩略图+预览；文档/文件 保存到网盘，可编辑文档打开编辑页 =====
    _isEditableDoc(name) { return /\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i.test(name || ''); }
    _fileTypeIcon(name) { return (window.Utils && Utils.getFileIconClass) ? Utils.getFileIconClass('', name) : 'fa-file'; }
    // 通过 Utils.getFileIconClass 判定图片（与文件图标类名一致，覆盖 jpg/png/gif/webp/bmp 等）
    _isImage(name) {
        if (window.Utils && Utils.getFileIconClass) return Utils.getFileIconClass('', name) === 'fas fa-image';
        return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(name || '');
    }
    // 通过 Utils.isValidFileType 校验上传文件类型（每日总结额外支持 md/txt 及常见图片扩展）
    _isAllowedWorkSummaryFile(f) {
        if (!(window.Utils && Utils.isValidFileType)) return true;
        const ext = (f && f.name ? f.name : '').toLowerCase().split('.').pop();
        if (['md', 'markdown', 'txt', 'html', 'js', 'py', 'php', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].indexOf(ext) >= 0) return true;
        return Utils.isValidFileType(f);
    }

    _fileHtml(files, removable) {
        if (!files || !files.length) return '';
        const self = this;
        return '<div class="ws-files">' + files.map((f, i) => {
            const name = f.name || '';
            const url = f.url || '';
            const isImg = this._isImage(name);
            const rmBtn = removable ? '<span class="ws-file-rm" onclick="event.stopPropagation();workSummaryApp.removeMyFile(' + i + ')" title="移除"><i class="fas fa-times"></i></span>' : '';
            const saved = !!(this._savedCloud && this._savedCloud[url]);
            if (isImg) {
                const action = saved
                    ? '<span class="ws-file-saved" title="已保存到网盘"><i class="fas fa-check-circle"></i></span>'
                    : '<span class="ws-file-upload" onclick="event.stopPropagation();workSummaryApp.saveFileToCloud(this)" title="上传到网盘" data-url="' + self.escapeHtml(url) + '" data-name="' + self.escapeHtml(name) + '"><i class="fas fa-cloud-upload-alt"></i></span>';
                return '<span class="ws-file-thumb" onclick="workSummaryApp.openImagePreviewByEl(this)" title="' + self.escapeHtml(name) + '">'
                    + '<img class="ws-file-img" src="' + self.escapeHtml(url) + '" data-url="' + self.escapeHtml(url) + '" data-name="' + self.escapeHtml(name) + '" alt="" loading="lazy">'
                    + '<span class="ws-file-name">' + self.escapeHtml(name) + '</span>'
                    + action
                    + rmBtn + '</span>';
            }
            const editable = self._isEditableDoc(name);
            let action;
            if (saved && editable) {
                action = '<span class="ws-file-edit" onclick="event.stopPropagation();workSummaryApp.openCloudEditor(this)" title="在线编辑" data-url="' + self.escapeHtml(url) + '"><i class="fas fa-edit"></i></span>';
            } else if (saved) {
                action = '<span class="ws-file-saved" title="已保存到网盘"><i class="fas fa-check-circle"></i></span>';
            } else {
                action = '<span class="ws-file-upload" onclick="event.stopPropagation();workSummaryApp.saveFileToCloud(this)" title="上传到网盘" data-url="' + self.escapeHtml(url) + '" data-name="' + self.escapeHtml(name) + '"><i class="fas fa-cloud-upload-alt"></i></span>';
            }
            return '<span class="ws-file-doc" data-url="' + self.escapeHtml(url) + '" onclick="workSummaryApp.openRawFile(this)" title="' + self.escapeHtml(name) + '">'
                + '<span class="ws-file-icon"><i class="fas ' + self._fileTypeIcon(name) + '"></i></span>'
                + '<span class="ws-file-name">' + self.escapeHtml(name) + '</span>'
                + action
                + rmBtn + '</span>';
        }).join('') + '</div>';
    }

    // 上传到网盘：自动创建「文档（来自每日工作总结）」文件夹并保存，成功后给出提示，可编辑文档切换为编辑图标
    async saveFileToCloud(el) {
        const tile = el && el.closest ? el.closest('[data-url]') : null;
        const url = tile ? tile.getAttribute('data-url') : '';
        const name = tile ? tile.getAttribute('data-name') : '';
        if (!url) return;
        if (this._savingCloud) return;
        this._savingCloud = true;
        try {
            const resp = await fetch('/api/cloud/files/save_from_url/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({url: url, name: name || url.split('/').pop() || '文档', folder_name: '文档（来自每日工作总结）'})
            });
            const data = await resp.json();
            if (!resp.ok) { this.toast((data && data.error) || '保存到网盘失败', true); return; }
            if (data.file_id) {
                this._savedCloud = this._savedCloud || {};
                this._savedCloud[url] = data.file_id;
                this.toast('已保存到我的网盘 → 文档（来自每日工作总结）', false);
                this._replaceFileAction(el, url, name);
            } else {
                this.toast('保存到网盘失败', true);
            }
        } catch (e) {
            this.toast('保存到网盘失败：' + (e.message || ''), true);
        } finally {
            this._savingCloud = false;
        }
    }
    _replaceFileAction(el, url, name) {
        if (!el || !el.parentNode) return;
        const editable = this._isEditableDoc(name);
        el.outerHTML = editable
            ? '<span class="ws-file-edit" onclick="event.stopPropagation();workSummaryApp.openCloudEditor(this)" title="在线编辑" data-url="' + this.escapeHtml(url) + '"><i class="fas fa-edit"></i></span>'
            : '<span class="ws-file-saved" title="已保存到网盘"><i class="fas fa-check-circle"></i></span>';
    }
    openCloudEditor(el) {
        const tile = el && el.closest ? el.closest('[data-url]') : null;
        const url = tile ? tile.getAttribute('data-url') : '';
        const fid = this._savedCloud && this._savedCloud[url];
        if (fid) window.open('/cloud/editor/?id=' + fid, '_blank');
    }
    openRawFile(el) {
        const url = el && el.getAttribute ? el.getAttribute('data-url') : '';
        if (url) window.open(url, '_blank');
    }

    // ===== 图片预览（支持左右滑动/键盘切换） =====
    openImagePreviewByEl(el) {
        const container = el.closest('.ws-files');
        const imgs = container ? Array.prototype.slice.call(container.querySelectorAll('.ws-file-img')) : [];
        const urls = imgs.map(im => ({url: im.getAttribute('data-url') || '', name: im.getAttribute('data-name') || ''}));
        const idx = imgs.indexOf(el.querySelector('.ws-file-img') || el);
        this._openPreview(urls, Math.max(0, idx));
    }
    _openPreview(urls, idx) {
        this._previewImgs = (urls && urls.length) ? urls : [];
        this._previewIdx = Math.max(0, Math.min(idx || 0, Math.max(0, this._previewImgs.length - 1)));
        this._renderPreview();
    }
    _renderPreview() {
        const self = this;
        let ov = document.getElementById('wsPreviewOverlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'wsPreviewOverlay'; document.body.appendChild(ov); }
        const imgs = this._previewImgs || [];
        const cur = imgs[this._previewIdx] || {};
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
        const nav = imgs.length > 1
            ? '<button onclick="workSummaryApp._prevImage()" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;font-size:20px;cursor:pointer;z-index:2;"><i class="fas fa-chevron-left"></i></button>'
            + '<button onclick="workSummaryApp._nextImage()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,.15);color:#fff;font-size:20px;cursor:pointer;z-index:2;"><i class="fas fa-chevron-right"></i></button>'
            : '';
        ov.innerHTML = '<button onclick="workSummaryApp._closePreview()" style="position:absolute;top:max(14px,env(safe-area-inset-top,0px));right:14px;background:transparent;border:none;color:#fff;font-size:26px;cursor:pointer;z-index:2;"><i class="fas fa-times"></i></button>'
            + '<div style="color:#fff;font-size:14px;margin-bottom:10px;">' + (this._previewIdx + 1) + ' / ' + imgs.length + '</div>'
            + '<img src="' + self.escapeHtml(cur.url || '') + '" style="max-width:94vw;max-height:76vh;object-fit:contain;border-radius:6px;background:#111;box-shadow:0 8px 30px rgba(0,0,0,.5);">'
            + '<div style="color:rgba(255,255,255,.85);font-size:13px;margin-top:12px;max-width:86vw;text-align:center;word-break:break-all;">' + self.escapeHtml(cur.name || '') + '</div>'
            + nav;
        if (ov._keyHandler) document.removeEventListener('keydown', ov._keyHandler);
        ov._keyHandler = function (e) { if (e.key === 'ArrowLeft') self._prevImage(); else if (e.key === 'ArrowRight') self._nextImage(); else if (e.key === 'Escape') self._closePreview(); };
        document.addEventListener('keydown', ov._keyHandler);
        ov._touchStart = null;
        ov.ontouchstart = function (e) { ov._touchStart = e.touches[0].clientX; };
        ov.ontouchend = function (e) {
            if (ov._touchStart == null) return;
            const dx = e.changedTouches[0].clientX - ov._touchStart;
            ov._touchStart = null;
            if (Math.abs(dx) > 40) { if (dx < 0) self._nextImage(); else self._prevImage(); }
        };
    }
    _prevImage() { this._previewIdx = Math.max(0, (this._previewIdx || 0) - 1); this._renderPreview(); }
    _nextImage() { this._previewIdx = Math.min((this._previewImgs || []).length - 1, (this._previewIdx || 0) + 1); this._renderPreview(); }
    _closePreview() {
        const ov = document.getElementById('wsPreviewOverlay');
        if (ov) { if (ov._keyHandler) document.removeEventListener('keydown', ov._keyHandler); ov.remove(); }
        this._previewImgs = null; this._previewIdx = 0;
    }
    toast(msg, isError) {
        let el = document.getElementById('wsToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'wsToast';
            el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:8px;font-size:14px;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.15);';
            document.body.appendChild(el);
        }
        el.style.background = isError ? '#f56c6c' : '#67c23a';
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
    }
    _fmtDate(s) { return s || ''; }
    _fmtDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // ===== 标签切换 =====
    switchTab(tab) {
        this._currentTab = tab;
        document.getElementById('wsTabMy').classList.toggle('active', tab === 'my');
        document.getElementById('wsTabTeam').classList.toggle('active', tab === 'team');
        const rt = document.getElementById('wsTabRange');
        if (rt) rt.classList.toggle('active', tab === 'range');
        document.getElementById('wsMyView').style.display = tab === 'my' ? '' : 'none';
        document.getElementById('wsTeamView').style.display = tab === 'team' ? '' : 'none';
        const rv = document.getElementById('wsRangeView');
        if (rv) rv.style.display = tab === 'range' ? '' : 'none';
        if (tab === 'my') this.loadMy(this.myPage);
        else if (tab === 'team') this.loadTeam(this.teamPage);
        else this.loadRangeAnalyses(this.rangePage || 1);
    }

    // ===== 文件上传（支持 点击选择 与 拖拽到上传区域） =====
    async _uploadFiles(files) {
        const list = Array.prototype.slice.call(files || []);
        if (!list.length) return;
        let toUpload = list;
        if (window.Utils && Utils.isValidFileType) {
            const bad = list.filter(f => !this._isAllowedWorkSummaryFile(f));
            toUpload = list.filter(f => this._isAllowedWorkSummaryFile(f));
            if (bad.length) this.toast('以下文件类型暂不支持，已自动跳过：' + bad.map(f => f.name).join('、'), true);
        }
        if (!toUpload.length) return;
        const fd = new FormData();
        for (const f of toUpload) fd.append('files', f);
        try {
            const up = await this.apiPostForm(WS_API + '/upload/', fd);
            this.myFiles = this.myFiles.concat(up.files || []);
            this.renderMyFiles();
            this.toast('已上传 ' + ((up.files || []).length) + ' 个文件', false);
        } catch (err) {
            this.toast('上传失败：' + (err.message || '请重试'), true);
        }
    }
    async onFilesSelected(e) {
        const files = e && e.target && e.target.files ? e.target.files : null;
        if (files && files.length) await this._uploadFiles(files);
        if (e && e.target && e.target.tagName === 'INPUT') { e.target.value = ''; }
    }
    onDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        const box = document.getElementById('wsUploadBox');
        if (box) box.classList.add('ws-upload-drag');
        return false;
    }
    onDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        const box = document.getElementById('wsUploadBox');
        if (box) box.classList.remove('ws-upload-drag');
        return false;
    }
    onDropFiles(e) {
        e.preventDefault();
        e.stopPropagation();
        const box = document.getElementById('wsUploadBox');
        if (box) box.classList.remove('ws-upload-drag');
        this._uploadFiles(e && e.dataTransfer ? e.dataTransfer.files : null);
        return false;
    }
    renderMyFiles() {
        const el = document.getElementById('wsFilesList');
        if (!el) return;
        if (!this.myFiles.length) { el.innerHTML = ''; return; }
        el.innerHTML = this._fileHtml(this.myFiles, true);
    }
    removeMyFile(i) { this.myFiles.splice(i, 1); this.renderMyFiles(); }

    // ===== 提交 =====
    async submit() {
        const dateEl = document.getElementById('wsDate');
        const content = (document.getElementById('wsContent').value || '').trim();
        if (!dateEl.value) { this.toast('请选择工作总结日期', true); return; }
        if (!content && !this.myFiles.length) { this.toast('请填写工作总结或上传工作数据', true); return; }
        if (!content) { this.toast('请填写工作总结', true); return; }
        if (this.maxMessageLength && content.length > this.maxMessageLength) { this.toast('工作总结内容过长，请精简后重试', true); return; }
        var confirmed = await this.showConfirmDialog('确认提交工作总结？', '确认提交工作总结？');
        if (!confirmed) return;
        try {
            const d = await this.apiPost(WS_API + '/', {summary_date: dateEl.value, content: content, files: this.myFiles});
            dateEl.value = ''; document.getElementById('wsContent').value = ''; this.myFiles = []; this.renderMyFiles();
            let tip = '提交成功，正在调用大模型分析...';
            if (d && d.status === 'disabled') tip = '已保存（模型分析功能已停用）';
            else if (d && d.status === 'limited') tip = '已保存（今日 AI 分析已达上限，未调用大模型）';
            else if (d && d.status === 'not_allowed') tip = '已保存（当前岗位暂未开放 AI 分析，灰度试点中）';
            this.toast(tip, false);
            await this.loadMy(1);
            if (d && d.id) setTimeout(() => this.openDetail(d.id), 300);
        } catch (e) {
            this.toast('提交失败：' + (e.message || '请重试'), true);
        }
    }

    // ===== 我的总结列表（支持 日期/总结内容/账号名 搜索 + 翻页） =====
    async loadMy(page) {
        this.myPage = page || 1;
        const wrap = document.getElementById('wsMyList');
        if (!wrap) return;
        wrap.innerHTML = '<div class="ws-empty"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
        try {
            const parts = ['page=' + this.myPage, 'page_size=' + this.myPageSize];
            const df = document.getElementById('wsMyDateFrom');
            const dt = document.getElementById('wsMyDateTo');
            const kw = document.getElementById('wsMyKeyword');
            if (df && df.value) parts.push('date_from=' + df.value);
            if (dt && dt.value) parts.push('date_to=' + dt.value);
            if (kw && (kw.value || '').trim()) parts.push('search=' + encodeURIComponent(kw.value.trim()));
            const data = await this.apiGet(WS_API + '/?' + parts.join('&'));
            this.renderMy(data.results || []);
            this._renderPagination(data, 'wsMyPagination', 'loadMy');
        } catch (e) {
            wrap.innerHTML = '<div class="ws-empty">加载失败</div>';
        }
    }
    resetMyFilter() {
        ['wsMyDateFrom', 'wsMyDateTo', 'wsMyKeyword'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.loadMy(1);
    }
    renderMy(list) {
        const wrap = document.getElementById('wsMyList');
        if (!list.length) { wrap.innerHTML = '<div class="ws-empty"><i class="fas fa-inbox"></i> 暂无总结记录，请在上方提交今日工作总结</div>'; return; }
        const self = this;
        wrap.innerHTML = list.map(s => this._summaryCard(s)).join('');
        // 对分析中的总结启动轮询，并立即显示科技感分析动画
        list.forEach(s => { if (s.status === 'analyzing') { this._ensurePolling(s.id); this._showThinking(document.getElementById('wsAnalysis_' + s.id)); } });
    }
    _summaryCard(s) {
        const self = this;
        const filesHtml = (s.files || []).length ? this._fileHtml(s.files) : '';
        const analysisHtml = this._analysisHtml(s);
        return '<div class="ws-list-item" id="wsItem_' + s.id + '">'
            + '<div class="ws-item-head"><span class="ws-date"><i class="fas fa-calendar-day" style="color:#409eff;"></i> ' + self._fmtDate(s.summary_date) + '</span>'
            + (s.position ? '<span class="ws-badge pending" style="background:#ecf5ff;color:#409eff;"><i class="fas fa-user-tie"></i> ' + self.escapeHtml(s.position) + '</span>' : '')
            + self.statusBadge(s.status)
            + (s.analyzed_at ? '<span style="font-size:11px;color:#909399;margin-left:auto;"><i class="fas fa-clock"></i> 分析完成 ' + self._fmtDateTime(s.analyzed_at) + '</span>' : '')
            + '</div>'
            + (s.content ? '<div class="ws-content">' + self.escapeHtml(s.content) + '</div>' : '<div class="ws-content" style="color:#c0c4cc;">（未填写总结文字）</div>')
            + filesHtml
            + analysisHtml
            + '<div class="ws-actions">'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openDetail(' + s.id + ')"><i class="fas fa-eye"></i> 详情</button>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openPrintModal(' + s.id + ')"><i class="fas fa-print"></i> 打印</button>'
            + (s.status === 'failed' || s.status === 'done' ? '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.rerunAnalysis(' + s.id + ')"><i class="fas fa-sync"></i> 重新分析</button>' : '')
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openExportModal(' + s.id + ')"><i class="fas fa-download"></i> 导出</button>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openShareModal(' + s.id + ')"><i class="fas fa-share-alt"></i> 分享</button>'
            + (s.user === this._myId ? '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.editSummary(' + s.id + ')"><i class="fas fa-edit"></i> 编辑</button>' : '')
            + (this._isSuperAdmin ? '<button class="btn btn-sm btn-danger" onclick="workSummaryApp.deleteSummary(' + s.id + ')"><i class="fas fa-trash"></i> 删除</button>' : '')
            + '</div></div>';
    }

    // ===== 团队总结 =====
    async loadTeam(page) {
        if (!this._canViewAll) return;
        this.teamPage = page || 1;
        const wrap = document.getElementById('wsTeamList');
        if (!wrap) return;
        wrap.innerHTML = '<div class="ws-empty"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
        try {
            const parts = ['page=' + this.teamPage, 'page_size=' + this.teamPageSize];
            const dept = document.getElementById('wsDeptFilter').value;
            const df = document.getElementById('wsDateFrom').value;
            const dt = document.getElementById('wsDateTo').value;
            const sw = (document.getElementById('wsSearch').value || '').trim();
            const uid = document.getElementById('wsTeamUserId').value;
            if (dept) parts.push('department_id=' + dept);
            if (df) parts.push('date_from=' + df);
            if (dt) parts.push('date_to=' + dt);
            if (uid) parts.push('user_id=' + uid);
            else if (sw) parts.push('search=' + encodeURIComponent(sw));
            const data = await this.apiGet(WS_API + '/all/?' + parts.join('&'));
            this.renderTeam(data.results || []);
            this._renderPagination(data, 'wsTeamPagination', 'loadTeam');
        } catch (e) {
            wrap.innerHTML = '<div class="ws-empty">加载失败</div>';
        }
    }
    resetTeamFilter() {
        ['wsDeptFilter', 'wsDateFrom', 'wsDateTo', 'wsSearch', 'wsTeamUserId'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.loadTeam(1);
    }
    async searchTeamUsers() {
        const input = document.getElementById('wsSearch');
        const kw = (input ? input.value : '').trim();
        const list = document.getElementById('wsTeamUserList');
        if (!list) return;
        try {
            const data = await this.apiGet(WS_API + '/members/?search=' + encodeURIComponent(kw));
            this._teamUsers = (data.results || []).slice(0, 20);
            if (!kw || !this._teamUsers.length) { list.innerHTML = ''; list.classList.remove('show'); return; }
            const self = this;
            list.classList.add('show');
            list.innerHTML = this._teamUsers.map(u =>
                '<div class="ws-range-user-item" onclick="workSummaryApp.pickTeamUser(' + u.id + ', this)">'
                + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '">'
                + '<div class="ws-range-user-meta"><div>' + self.escapeHtml(u.name) + '</div>'
                + '<div class="ws-range-user-sub">' + self.escapeHtml(u.department_name || '') + (u.position ? ' · ' + self.escapeHtml(u.position) : '') + '</div></div></div>'
            ).join('');
        } catch (e) { /* ignore */ }
    }
    pickTeamUser(id, el) {
        const u = (this._teamUsers || []).find(x => x.id === id);
        const input = document.getElementById('wsSearch');
        const hid = document.getElementById('wsTeamUserId');
        if (input && u) input.value = u.name;
        if (hid) hid.value = id;
        const list = document.getElementById('wsTeamUserList');
        if (list) { list.innerHTML = ''; list.classList.remove('show'); }
        this.loadTeam(1);
    }
    renderTeam(list) {
        const wrap = document.getElementById('wsTeamList');
        if (!list.length) { wrap.innerHTML = '<div class="ws-empty"><i class="fas fa-inbox"></i> 暂无符合条件的总结</div>'; return; }
        const self = this;
        wrap.innerHTML = list.map(s => {
            const filesHtml = (s.files || []).length ? this._fileHtml(s.files) : '';
            const analysisHtml = this._analysisHtml(s);
            return '<div class="ws-list-item" id="wsItem_' + s.id + '">'
                + '<div class="ws-item-head"><span class="ws-user"><img src="' + (s.user_avatar || '/static/images/default-avatar.png') + '">' + self.escapeHtml(s.user_name) + '</span>'
                + (s.department ? '<span class="ws-badge pending" style="background:#f0f9eb;color:#67c23a;"><i class="fas fa-building"></i> ' + self.escapeHtml(s.department) + '</span>' : '')
                + (s.position ? '<span class="ws-badge pending" style="background:#ecf5ff;color:#409eff;"><i class="fas fa-user-tie"></i> ' + self.escapeHtml(s.position) + '</span>' : '')
                + '<span class="ws-date">' + self._fmtDate(s.summary_date) + '</span>'
                + self.statusBadge(s.status)
                + (s.analyzed_at ? '<span style="font-size:11px;color:#909399;margin-left:auto;"><i class="fas fa-clock"></i> 分析完成 ' + self._fmtDateTime(s.analyzed_at) + '</span>' : '') + '</div>'
                + (s.content ? '<div class="ws-content">' + self.escapeHtml(s.content) + '</div>' : '<div class="ws-content" style="color:#c0c4cc;">（未填写总结文字）</div>')
                + filesHtml
                + analysisHtml
                + '<div class="ws-actions"><button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openDetail(' + s.id + ')"><i class="fas fa-eye"></i> 详情</button>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openPrintModal(' + s.id + ')"><i class="fas fa-print"></i> 打印</button>'
                + (s.status === 'failed' || s.status === 'done' ? '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.rerunAnalysis(' + s.id + ')"><i class="fas fa-sync"></i> 重新分析</button>' : '')
                + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openExportModal(' + s.id + ')"><i class="fas fa-download"></i> 导出</button>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.openShareModal(' + s.id + ')"><i class="fas fa-share-alt"></i> 分享</button>'
            + (s.user === this._myId ? '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.editSummary(' + s.id + ')"><i class="fas fa-edit"></i> 编辑</button>' : '')
                + (this._isSuperAdmin ? '<button class="btn btn-sm btn-danger" onclick="workSummaryApp.deleteSummary(' + s.id + ')"><i class="fas fa-trash"></i> 删除</button>' : '')
                + '</div></div>';
        }).join('');
        list.forEach(s => { if (s.status === 'analyzing') { this._ensurePolling(s.id); this._showThinking(document.getElementById('wsAnalysis_' + s.id)); } });
    }

    _renderPagination(data, cid, fn) {
        const wrap = document.getElementById(cid);
        if (!wrap) return;
        const page = data.page || 1;
        const totalPages = data.total_pages || 1;
        if (totalPages <= 1) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        wrap.innerHTML = '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.' + fn + '(1)"' + (page <= 1 ? ' disabled' : '') + '><i class="fas fa-angle-double-left"></i></button>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.' + fn + '(' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '><i class="fas fa-angle-left"></i></button>'
            + '<span style="font-size:13px;color:#606266;">' + page + ' / ' + totalPages + '</span>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.' + fn + '(' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '><i class="fas fa-angle-right"></i></button>'
            + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.' + fn + '(' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '><i class="fas fa-angle-double-right"></i></button>';
    }

    // ===== 流式分析（轮询） =====
    _ensurePolling(id) {
        if (this._polling[id]) return;
        const timer = setInterval(() => this._pollSummary(id), 2000);
        this._polling[id] = {timer: timer};
        this._pollSummary(id);
    }
    _stopPolling(id) {
        const p = this._polling[id];
        if (p) { clearInterval(p.timer); delete this._polling[id]; }
    }
    async _pollSummary(id) {
        try {
            const d = await this.apiGet(WS_API + '/' + id + '/');
            if (!d) return;
            const titleHtml = '<div class="ws-analysis-title"><i class="fas fa-robot"></i> 大模型分析建议</div>';
            const curLen = (d.analysis_result || '').length;
            // 列表卡片：分析中有内容才打字（无内容保持科技感动画），完成时折叠长内容
            const el = document.getElementById('wsAnalysis_' + id);
            if (el) {
                const typed = (this._typeLen && this._typeLen['s' + id]) || 0;
                if (d.status === 'analyzing') {
                    if (d.analysis_result && curLen > typed) this._startTyping('s' + id, el, d.analysis_result || '', titleHtml, {collapsible: true});
                    else if (!d.analysis_result && !(el.querySelector && el.querySelector('.ws-ai-thinking'))) this._showThinking(el);
                    // 内容无新增则保持当前状态，避免重复渲染把用户已展开的内容又折叠回去
                } else if (d.status === 'done') {
                    this._stopPolling(id);
                    if (curLen !== typed) this._startTyping('s' + id, el, d.analysis_result || '（模型未返回内容）', titleHtml, {collapsible: true});
                } else if (d.status === 'failed') {
                    this._stopPolling(id);
                    this._stopTyping('s' + id, '<span style="color:#f56c6c;">分析失败：' + this.escapeHtml(d.error_message || '请重试') + '</span>');
                }
            }
            // 更新状态徽标与列表
            const badgeEl = document.querySelector('#wsItem_' + id + ' .ws-badge.done, #wsItem_' + id + ' .ws-badge.analyzing, #wsItem_' + id + ' .ws-badge.failed, #wsItem_' + id + ' .ws-badge.pending');
            if (badgeEl && badgeEl.closest('#wsItem_' + id)) {
                const stEl = badgeEl.closest('#wsItem_' + id).querySelector('.ws-item-head .ws-badge');
                if (stEl) stEl.outerHTML = this.statusBadge(d.status);
            }
            // 详情模态框：独立打字 key，点击详情后总是从零打字呈现
            if (this._detailId === id && document.getElementById('wsDetailAnalysis')) {
                const detailEl = document.getElementById('wsDetailAnalysis');
                const typedD = (this._typeLen && this._typeLen['d' + id]) || 0;
                if (d.status === 'analyzing') {
                    if (d.analysis_result && curLen > typedD) this._startTyping('d' + id, detailEl, d.analysis_result || '', titleHtml);
                    else if (!d.analysis_result && !(detailEl.querySelector && detailEl.querySelector('.ws-ai-thinking'))) this._showThinking(detailEl);
                } else if (d.status === 'done') {
                    this._stopPolling(id);
                    if (curLen !== typedD) this._startTyping('d' + id, detailEl, d.analysis_result || '（模型未返回内容）', titleHtml);
                } else if (d.status === 'failed') { this._stopPolling(id); this._stopTyping('d' + id, '<span style="color:#f56c6c;">分析失败：' + this.escapeHtml(d.error_message || '') + '</span>'); }
            }
            if (d.prompt_text) {
                const pEl = document.getElementById('wsDetailPrompt');
                if (pEl && !pEl.getAttribute('data-filled')) { pEl.setAttribute('data-filled', '1'); pEl.innerHTML = this.escapeHtml(d.prompt_text); }
            }
        } catch (e) { /* ignore */ }
    }

    // ===== 详情 =====
    async openDetail(id) {
        try {
            const d = await this.apiGet(WS_API + '/' + id + '/');
            if (!d) return;
            this._detailId = id;
            const filesHtml = (d.files || []).length
                ? this._fileHtml(d.files)
                : '<div style="color:#c0c4cc;font-size:12px;margin:6px 0;">未上传工作数据文件</div>';
            const promptHtml = '<div style="margin-top:12px;"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">'
                  + '<div style="font-size:13px;font-weight:600;color:#909399;"><i class="fas fa-key"></i> 喂给大模型的提示词</div>'
                  + '<button class="btn btn-sm btn-secondary" onclick="workSummaryApp.toggleDetailPrompt()"><i class="fas fa-eye"></i> 查看提示词</button></div>'
                  + '<div id="wsDetailPrompt" style="display:none;margin-top:8px;background:#f8f9fb;border:1px solid #ebeef5;border-radius:8px;padding:10px 12px;font-size:12px;color:#606266;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;">' + (d.prompt_text ? this.escapeHtml(d.prompt_text) : '') + '</div></div>';
            const analysisHtml = '<div id="wsDetailAnalysis" class="ws-analysis"><div class="ws-analysis-title"><i class="fas fa-robot"></i> 大模型分析建议</div></div>';
            const body = document.getElementById('wsDetailBody');
            body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
                + '<span class="ws-user"><img src="' + (d.user_avatar || '/static/images/default-avatar.png') + '">' + this.escapeHtml(d.user_name) + '</span>'
                + (d.department ? '<span class="ws-badge pending" style="background:#f0f9eb;color:#67c23a;"><i class="fas fa-building"></i> ' + this.escapeHtml(d.department) + '</span>' : '')
                + (d.position ? '<span class="ws-badge pending" style="background:#ecf5ff;color:#409eff;"><i class="fas fa-user-tie"></i> ' + this.escapeHtml(d.position) + '</span>' : '')
                + '<span style="font-size:13px;color:#606266;"><i class="fas fa-calendar-day"></i> ' + this._fmtDate(d.summary_date) + '</span>'
                + this.statusBadge(d.status)
                + (d.analyzed_at ? '<span style="font-size:12px;color:#909399;"><i class="fas fa-clock"></i> 分析完成 ' + this._fmtDateTime(d.analyzed_at) + '</span>' : '') + '</div>'
                + '<div style="font-size:13px;font-weight:600;color:#409eff;margin-bottom:6px;"><i class="fas fa-pen-square"></i> 当日工作总结</div>'
                + this._collapsibleBlock(this.escapeHtml(d.content || '（未填写总结文字）'), 'ws-content')
                + '<div style="font-size:13px;font-weight:600;color:#409eff;margin:12px 0 6px;"><i class="fas fa-folder-open"></i> 工作数据文件</div>'
                + filesHtml
                + promptHtml
                + '<div style="font-size:13px;font-weight:600;color:#9b59b6;margin:12px 0 6px;"><i class="fas fa-robot"></i> 分析与建议</div>'
                + analysisHtml;
            document.getElementById('wsDetailModal').classList.add('show');
            const footer = document.getElementById('wsDetailFooter');
            if (footer) {
                footer.innerHTML = '<button class="btn btn-secondary" onclick="workSummaryApp.closeDetail()">关闭</button>'
                    + '<button class="btn btn-secondary" onclick="workSummaryApp.openExportModal(' + d.id + ')"><i class="fas fa-download"></i> 导出</button>'
                    + '<button class="btn btn-secondary" onclick="workSummaryApp.openShareModal(' + d.id + ')"><i class="fas fa-share-alt"></i> 分享</button>'
                    + '<button class="btn btn-secondary" onclick="workSummaryApp.openPrintModal(' + d.id + ')"><i class="fas fa-print"></i> 打印</button>'
                    + (d.user === this._myId ? '<button class="btn btn-secondary" onclick="workSummaryApp.editSummary(' + d.id + ')"><i class="fas fa-edit"></i> 编辑</button>' : '')
                    + (this._isSuperAdmin ? '<button class="btn btn-danger" onclick="workSummaryApp.deleteSummary(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>' : '');
            }
            // 分析与建议：已完成→从零开始打字呈现；分析中/待分析→科技感动态 AI 提示 + 轮询
            const titleHtml = '<div class="ws-analysis-title"><i class="fas fa-robot"></i> 大模型分析建议</div>';
            const detailEl = document.getElementById('wsDetailAnalysis');
            if (d.status === 'done') {
                if (d.analysis_result) { this._resetTyping('d' + d.id); this._startTyping('d' + d.id, detailEl, d.analysis_result, titleHtml); }
                else if (detailEl) detailEl.innerHTML = titleHtml + '<div class="ws-analysis-body">（模型未返回内容）</div>';
            } else if (d.status === 'analyzing' || d.status === 'pending') {
                this._showThinking(detailEl);
                this._ensurePolling(d.id);
            } else if (d.status === 'failed') {
                if (detailEl) detailEl.innerHTML = titleHtml + '<div class="ws-analysis-body" style="color:#f56c6c;">分析失败：' + this.escapeHtml(d.error_message || '请重试') + '</div>';
            } else if (d.status === 'limited') {
                if (detailEl) detailEl.innerHTML = titleHtml + '<div class="ws-analysis-body" style="color:#e6a23c;"><i class="fas fa-hourglass-half"></i> ' + this.escapeHtml(d.error_message || '今日 AI 分析已达上限，明日可继续使用') + '</div>';
            } else if (d.status === 'not_allowed') {
                if (detailEl) detailEl.innerHTML = titleHtml + '<div class="ws-analysis-body" style="color:#909399;"><i class="fas fa-shield-alt"></i> ' + this.escapeHtml(d.error_message || '当前岗位/部门暂未开放 AI 分析（灰度试点中）') + '</div>';
            } else if (d.status === 'disabled') {
                if (detailEl) detailEl.innerHTML = titleHtml + '<div class="ws-analysis-body" style="color:#909399;">模型分析功能已停用</div>';
            }
        } catch (e) {
            this.toast((e && e.message) || '加载失败', true);
        }
    }
    closeDetail() {
        document.getElementById('wsDetailModal').classList.remove('show');
        this._detailId = null;
        const el = document.getElementById('wsDetailAnalysis');
        if (el && el._thinkTimer) { clearInterval(el._thinkTimer); el._thinkTimer = null; }
    }
    toggleDetailPrompt() {
        const el = document.getElementById('wsDetailPrompt');
        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }

    // ===== 操作 =====
    async editSummary(id) {
        try {
            const d = await this.apiGet(WS_API + '/' + id + '/');
            if (!d) return;
            if (d.user !== this._myId) { this.toast('只能编辑自己的工作总结', true); return; }
            const dateEl = document.getElementById('wsDate');
            if (dateEl) dateEl.value = d.summary_date || '';
            const contentEl = document.getElementById('wsContent');
            if (contentEl) contentEl.value = d.content || '';
            this.myFiles = (d.files || []).slice();
            this.renderMyFiles();
            this.closeDetail();
            this.switchTab('my');
            window.scrollTo({top: 0, behavior: 'smooth'});
            this.toast('已载入编辑：修改后点击「提交并分析」将生成新的总结记录，原记录保留', false);
        } catch (e) {
            this.toast('载入失败：' + (e.message || ''), true);
        }
    }
    async rerunAnalysis(id) {
        try {
            var confirmed = await this.showConfirmDialog('重新触发分析', '确定重新触发分析吗？');
            if (!confirmed) return;
            await this.apiPost(WS_API + '/' + id + '/analyze/', {});
            this.toast('已重新触发分析', false);
            await this.openDetail(id);
            this._refreshCurrent();
        } catch (e) {
            this.toast('触发失败：' + (e.message || ''), true);
        }
    }
    async deleteSummary(id) {
        var confirmed = await this.showConfirmDialog('删除每日工作总结', '确定删除该条每日工作总结吗？');
        if (!confirmed) return;
        try {
            await this.apiDelete(WS_API + '/' + id + '/');
            this.toast('已删除', false);
            this.closeDetail();
            this._refreshCurrent();
        } catch (e) {
            this.toast('删除失败：' + (e.message || ''), true);
        }
    }
    _refreshCurrent() {
        if (this._currentTab === 'my') this.loadMy(this.myPage);
        else if (this._currentTab === 'team') this.loadTeam(this.teamPage);
        else this.loadRangeAnalyses(this.rangePage);
    }


    // ==================== 今日工作总结提醒 ====================
    async _checkTodaySummary() {
        try {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
            const data = await this.apiGet(WS_API + '/?date_from=' + today + '&date_to=' + today + '&page_size=1');
            const el = document.getElementById('wsTodayBanner');
            if (el) {
                const count = (data && data.count) || 0;
                if (count === 0) {
                    el.style.display = 'flex';
                    el.innerHTML = '<i class="fas fa-bell"></i> 今日工作总结未完成，请及时提交今日工作总结';
                } else {
                    el.style.display = 'none';
                }
            }
        } catch (e) { /* ignore */ }
    }


    // ==================== 导出（Markdown / Word / PDF → 本地或网盘） ====================
    openExportModal(id) {
        this._exportId = id;
        const modal = document.getElementById('wsExportModal');
        if (modal) modal.classList.add('show');
    }
    closeExportModal() {
        const modal = document.getElementById('wsExportModal');
        if (modal) modal.classList.remove('show');
    }
    _exportFilename(d, ext) {
        return '每日工作总结_' + (d.summary_date || '') + '_' + (d.user_name || '员工') + '.' + ext;
    }
    _buildExportMarkdown(d) {
        const statusMap = {done: '已完成', analyzing: '分析中', failed: '分析失败', pending: '待分析', disabled: '已停用', limited: '已达今日限额', not_allowed: '未开放分析'};
        return [
            '# 每日工作总结', '',
            '- 员工：' + (d.user_name || ''),
            '- 所属部门：' + (d.department || ''),
            '- 职位：' + (d.position || ''),
            '- 日期：' + (d.summary_date || ''),
            '- 状态：' + (statusMap[d.status] || d.status || ''), '',
            '## 当日工作总结', '',
            d.content || '（未填写总结文字）', '',
            '## 大模型分析建议', '',
            d.analysis_result || '（模型未返回内容）', ''
        ].join('\n');
    }
    _downloadBlob(text, filename, mime) {
        const blob = new Blob([text], {type: (mime || 'text/plain') + ';charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
    }
    async _saveBlobToCloud(text, d, ext, mime) {
        const file = new File([new Blob([text], {type: (mime || 'text/plain') + ';charset=utf-8'})], this._exportFilename(d, ext), {type: mime || 'text/plain'});
        try {
            // 自动创建/复用「文档（来自每日工作总结）」文件夹，与上传到网盘保持一致
            const folderId = await this._resolveCloudFolderId('文档（来自每日工作总结）');
            const r = await Utils.uploadToCloud(file, folderId, '每日工作总结导出', '');
            this.toast('已保存到我的网盘 → 文档（来自每日工作总结）（' + this._exportFilename(d, ext) + '）', false);
        } catch (e) {
            this.toast('保存到网盘失败：' + (e.message || ''), true);
        }
    }
    async _fetchExportPdfBlob(id) {
        const resp = await fetch(WS_API + '/' + id + '/export-pdf/', {headers: TokenManager.getHeaders()});
        if (!resp.ok) {
            const b = await resp.json().catch(() => ({}));
            throw new Error(b.error || '导出 PDF 失败');
        }
        return await resp.blob();
    }
    async _downloadExportPdf(id, d) {
        const blob = await this._fetchExportPdfBlob(id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this._exportFilename(d, 'pdf');
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
    }
    async _savePdfBlobToCloud(blob, d) {
        const file = new File([blob], this._exportFilename(d, 'pdf'), {type: 'application/pdf'});
        try {
            // 自动创建/复用「文档（来自每日工作总结）」文件夹，与上传到网盘保持一致
            const folderId = await this._resolveCloudFolderId('文档（来自每日工作总结）');
            await Utils.uploadToCloud(file, folderId, '每日工作总结导出', '');
            this.toast('PDF 已保存到我的网盘 → 文档（来自每日工作总结）', false);
        } catch (e) {
            this.toast('保存到网盘失败：' + (e.message || ''), true);
        }
    }

    // 取或建「文档（来自每日工作总结）」文件夹并返回 folder id（与 saveFileToCloud 上传到网盘保持一致）
    async _resolveCloudFolderId(folderName) {
        const hd = TokenManager.getHeaders();
        try {
            const resp = await fetch('/api/cloud/folders/?search=' + encodeURIComponent(folderName), {headers: hd});
            if (resp.ok) {
                const json = await resp.json();
                const list = Array.isArray(json) ? json : (json.results || []);
                for (let i = 0; i < list.length; i++) {
                    if (list[i].name === folderName) return list[i].id;
                }
            }
        } catch (e) { /* 查询失败则尝试创建 */ }
        const createResp = await fetch('/api/cloud/folders/', {
            method: 'POST',
            headers: Object.assign({}, hd, {'Content-Type': 'application/json'}),
            body: JSON.stringify({name: folderName})
        });
        if (!createResp.ok) throw new Error('创建网盘文件夹失败');
        const created = await createResp.json();
        return created.id || null;
    }

    // ===== 打印预览（带关闭/返回按钮，移动端可关闭） =====
    async openPrintModal(id) {
        // 打印留痕 + 「允许打印」权限门：无权限则拦截并提示
        if (window.WatermarkManager && WatermarkManager.reportPrint) {
            const res = await WatermarkManager.reportPrint({page: 'work_summary', target_type: 'work_summary', target_id: id, count: 1});
            if (res && res.allowed === false) { this.toast('您没有打印权限，请联系管理员开通', true); return; }
        }
        try {
            const d = await this.apiGet(WS_API + '/' + id + '/');
            if (!d) return;
            const area = document.getElementById('wsPrintArea');
            if (area) area.innerHTML = this._renderMarkdown(this._buildExportMarkdown(d));
            const modal = document.getElementById('wsPrintModal');
            if (modal) modal.classList.add('show');
        } catch (e) {
            this.toast((e && e.message) || '加载打印预览失败', true);
        }
    }
    closePrintModal() {
        const modal = document.getElementById('wsPrintModal');
        if (modal) modal.classList.remove('show');
    }
    doPrint() {
        // 依据管理控制台水印设置注入打印水印：对应页面「页面水印开关」开启时打印加水印，关闭则不加
        let injected = null;
        const area = document.getElementById('wsPrintArea');
        if (area && window.WatermarkManager && WatermarkManager.buildPrintWatermark) {
            const wm = WatermarkManager.buildPrintWatermark();
            if (wm) {
                const style = document.createElement('style');
                style.setAttribute('data-ws-wm', '1');
                style.textContent = wm.css;
                area.appendChild(style);
                area.insertAdjacentHTML('beforeend', wm.html);
                injected = area;
            }
        }
        window.print();
        // 打印完成后清理注入的水印节点，避免残留
        if (injected) {
            setTimeout(function () {
                const st = injected.querySelector('style[data-ws-wm]');
                if (st) st.remove();
                const layer = injected.querySelector('.wm-print-layer');
                if (layer) layer.remove();
            }, 120);
        }
    }
    async doExport() {
        const id = this._exportId;
        const fmt = document.getElementById('wsExportFormat').value;
        const dest = document.getElementById('wsExportDest').value;
        try {
            const d = await this.apiGet(WS_API + '/' + id + '/');
            if (!d) return;
            const md = this._buildExportMarkdown(d);
            if (fmt === 'md') {
                if (dest === 'cloud') await this._saveBlobToCloud(md, d, 'md', 'text/markdown');
                else { this._downloadBlob(md, this._exportFilename(d, 'md'), 'text/markdown'); this.toast('已导出 Markdown 文件', false); }
            } else if (fmt === 'doc') {
                // Word 兼容格式：HTML 内容存为 .doc，可在 Word/WPS 打开
                const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>每日工作总结</title></head><body>'
                    + this._renderMarkdown(md) + '</body></html>';
                if (dest === 'cloud') await this._saveBlobToCloud(html, d, 'doc', 'application/msword');
                else { this._downloadBlob(html, this._exportFilename(d, 'doc'), 'application/msword'); this.toast('已导出 Word 文档', false); }
            } else if (fmt === 'pdf') {
                // 真实 PDF 文件导出（后端生成，不经过打印对话框）
                if (dest === 'cloud') {
                    const blob = await this._fetchExportPdfBlob(id);
                    if (blob) await this._savePdfBlobToCloud(blob, d);
                } else {
                    await this._downloadExportPdf(id, d);
                    this.toast('已导出 PDF 文件', false);
                }
            }
            this.closeExportModal();
        } catch (e) {
            this.toast('导出失败：' + (e.message || ''), true);
        }
    }


    // ==================== 分享到私聊 ====================
    openShareModal(id) {
        this._shareId = id;
        this._shareTargetId = null;
        const input = document.getElementById('wsShareUserInput');
        if (input) input.value = '';
        const list = document.getElementById('wsShareUserList');
        if (list) { list.innerHTML = ''; list.classList.remove('show'); }
        const modal = document.getElementById('wsShareModal');
        if (modal) modal.classList.add('show');
    }
    closeShareModal() {
        const modal = document.getElementById('wsShareModal');
        if (modal) modal.classList.remove('show');
    }
    async searchShareUsers() {
        const kw = (document.getElementById('wsShareUserInput').value || '').trim();
        const list = document.getElementById('wsShareUserList');
        if (!list) return;
        try {
            const data = await this.apiGet(WS_API + '/members/?search=' + encodeURIComponent(kw));
            this._shareUsers = (data.results || []).slice(0, 20);
            if (!kw || !this._shareUsers.length) { list.innerHTML = ''; list.classList.remove('show'); return; }
            const self = this;
            list.classList.add('show');
            list.innerHTML = this._shareUsers.map(u =>
                '<div class="ws-range-user-item" onclick="workSummaryApp.pickShareUser(' + u.id + ', this)">'
                + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '">'
                + '<div class="ws-range-user-meta"><div>' + self.escapeHtml(u.name) + '</div>'
                + '<div class="ws-range-user-sub">' + self.escapeHtml(u.department_name || '') + (u.position ? ' · ' + self.escapeHtml(u.position) : '') + '</div></div></div>'
            ).join('');
        } catch (e) { /* ignore */ }
    }
    pickShareUser(id, el) {
        this._shareTargetId = id;
        const u = (this._shareUsers || []).find(x => x.id === id);
        const input = document.getElementById('wsShareUserInput');
        if (input && u) input.value = u.name;
        const list = document.getElementById('wsShareUserList');
        if (list) { list.innerHTML = ''; list.classList.remove('show'); }
    }
    async doShare() {
        const id = this._shareId;
        if (!this._shareTargetId) { this.toast('请选择要分享的用户', true); return; }
        try {
            await this.apiPost(WS_API + '/' + id + '/share/', {target_user_id: parseInt(this._shareTargetId, 10)});
            this.toast('已通过私聊分享给该用户', false);
            this.closeShareModal();
        } catch (e) {
            this.toast('分享失败：' + (e.message || ''), true);
        }
    }


    // ==================== 范围分析（指定员工 + 日期范围 → 大模型批量分析） ====================
    async searchRangeUsers() {
        const input = document.getElementById('wsRangeUserInput');
        const kw = (input ? input.value : '').trim();
        const list = document.getElementById('wsRangeUserList');
        if (!list) return;
        try {
            const qs = kw ? ('?search=' + encodeURIComponent(kw)) : '';
            const data = await this.apiGet(WS_API + '/members/' + qs);
            this._rangeUsers = (data.results || []).slice(0, 20);
            this._renderRangeUserList();
        } catch (e) { /* ignore */ }
    }
    _renderRangeUserList() {
        const list = document.getElementById('wsRangeUserList');
        if (!list) return;
        const input = document.getElementById('wsRangeUserInput');
        const kw = (input ? input.value : '').trim();
        if (!kw || !this._rangeUsers.length) { list.innerHTML = ''; list.classList.remove('show'); return; }
        const self = this;
        list.classList.add('show');
        list.innerHTML = this._rangeUsers.map(u =>
            '<div class="ws-range-user-item" onclick="workSummaryApp.pickRangeUser(' + u.id + ', this)">'
            + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '">'
            + '<div class="ws-range-user-meta"><div>' + self.escapeHtml(u.name) + '</div>'
            + '<div class="ws-range-user-sub">' + self.escapeHtml(u.department_name || '') + (u.position ? ' · ' + self.escapeHtml(u.position) : '') + '</div></div></div>'
        ).join('');
    }
    pickRangeUser(id, el) {
        const u = (this._rangeUsers || []).find(x => x.id === id);
        const input = document.getElementById('wsRangeUserInput');
        const hid = document.getElementById('wsRangeUserId');
        if (input && u) input.value = u.name;
        if (hid) hid.value = id;
        this.hideRangeUserList();
    }
    hideRangeUserList() {
        const list = document.getElementById('wsRangeUserList');
        if (list) { list.innerHTML = ''; list.classList.remove('show'); }
    }
    async startRangeAnalysis() {
        const userIdEl = document.getElementById('wsRangeUserId');
        const userId = userIdEl ? userIdEl.value : '';
        const dateFrom = document.getElementById('wsRangeDateFrom').value;
        const dateTo = document.getElementById('wsRangeDateTo').value;
        if (!userId) { this.toast('请选择要分析的员工', true); return; }
        if (!dateFrom || !dateTo) { this.toast('请选择日期范围', true); return; }

        var confirmed = await this.showConfirmDialog('确认开始分析？', '确认开始分析？')
        if (!confirmed) return;

        try {
            const d = await this.apiPost(WS_API + '/range/', {user_id: parseInt(userId, 10), date_from: dateFrom, date_to: dateTo});
            this.toast('已开始分析，正在调用大模型推理...', false);
            this.loadRangeAnalyses(1);
            if (d && d.id) this._ensureRangePolling(d.id);
        } catch (e) {
            this.toast('发起失败：' + (e.message || ''), true);
        }
    }
    async loadRangeAnalyses(page) {
        this.rangePage = page || 1;
        const wrap = document.getElementById('wsRangeList');
        if (!wrap) return;
        wrap.innerHTML = '<div class="ws-empty"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
        try {
            const data = await this.apiGet(WS_API + '/range/?page=' + this.rangePage + '&page_size=' + this.rangePageSize);
            this._renderRangeList(data.results || []);
            this._renderPagination(data, 'wsRangePagination', 'loadRangeAnalyses');
        } catch (e) {
            wrap.innerHTML = '<div class="ws-empty">加载失败</div>';
        }
    }
    _renderRangeList(list) {
        const wrap = document.getElementById('wsRangeList');
        if (!list.length) { wrap.innerHTML = '<div class="ws-empty"><i class="fas fa-inbox"></i> 暂无批量分析记录，请在上方选择员工和日期范围后点击开始分析</div>'; return; }
        const self = this;
        wrap.innerHTML = list.map(a => {
            const resultHtml = a.status === 'analyzing'
                ? '<div class="ws-analysis" id="wsRangeResult_' + a.id + '"></div>'
                : '<div class="ws-analysis" id="wsRangeResult_' + a.id + '"><div class="ws-analysis-title"><i class="fas fa-robot"></i> 大模型分析结果</div>' + (a.status === 'done' ? self._analysisCollapsedHtml(a.analysis_result || '（模型未返回内容）') : (a.status === 'failed' ? '<div class="ws-analysis-body" style="color:#f56c6c;">分析失败：' + self.escapeHtml(a.error_message || '') + '</div>' : (a.status === 'disabled' ? '<div class="ws-analysis-body" style="color:#909399;">模型分析功能已停用</div>' : '<div class="ws-analysis-body">等待分析...</div>'))) + '</div>';
            return '<div class="ws-list-item" id="wsRangeItem_' + a.id + '">'
                + '<div class="ws-item-head">'
                + '<span class="ws-user"><img src="' + (a.target_avatar || '/static/images/default-avatar.png') + '">' + self.escapeHtml(a.target_name) + '</span>'
                + (a.target_position ? '<span class="ws-badge pending" style="background:#ecf5ff;color:#409eff;"><i class="fas fa-user-tie"></i> ' + self.escapeHtml(a.target_position) + '</span>' : '')
                + (a.requester && a.requester !== this._myId && a.requester_name ? '<span class="ws-badge pending" style="background:#f0f2f5;color:#606266;" title="发起人"><i class="fas fa-user-cog"></i> ' + self.escapeHtml(a.requester_name) + '</span>' : '')
                + '<span class="ws-date" title="日期范围"><i class="fas fa-calendar-alt" style="color:#409eff;"></i> ' + self.escapeHtml(a.date_from) + ' ~ ' + self.escapeHtml(a.date_to) + '</span>'
                + '<span class="ws-badge pending" style="background:#fdf6ec;color:#e6a23c;"><i class="fas fa-file-alt"></i> ' + a.summary_count + ' 条</span>'
                + self.statusBadge(a.status).replace('<span', '<span id="wsRangeStatus_' + a.id + '"')
                + (a.analyzed_at ? '<span style="font-size:11px;color:#909399;margin-left:auto;"><i class="fas fa-clock"></i> 分析完成 ' + self._fmtDateTime(a.analyzed_at) + '</span>' : '')
                + '</div>'
                + resultHtml
                + '<div style="margin-top:10px;"><button class="btn btn-sm btn-secondary" onclick="workSummaryApp.toggleRangePrompt(' + a.id + ')"><i class="fas fa-key"></i> 查看喂给大模型的提示词</button><div id="wsRangePrompt_' + a.id + '" style="display:none;margin-top:8px;background:#f8f9fb;border:1px solid #ebeef5;border-radius:8px;padding:10px 12px;font-size:12px;color:#606266;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;">' + (a.prompt_text ? self.escapeHtml(a.prompt_text) : '') + '</div></div>'
                + '</div>';
        }).join('');
        list.forEach(a => { if (a.status === 'analyzing') { this._ensureRangePolling(a.id); this._showThinking(document.getElementById('wsRangeResult_' + a.id)); } });
    }
    toggleRangePrompt(id) {
        const el = document.getElementById('wsRangePrompt_' + id);
        if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
    _ensureRangePolling(id) {
        if (this._rangePolling[id]) return;
        const timer = setInterval(() => this._pollRange(id), 2000);
        this._rangePolling[id] = {timer: timer};
        this._pollRange(id);
    }
    _stopRangePolling(id) {
        const p = this._rangePolling[id];
        if (p) { clearInterval(p.timer); delete this._rangePolling[id]; }
    }
    async _pollRange(id) {
        try {
            const d = await this.apiGet(WS_API + '/range/' + id + '/');
            if (!d) return;
            const el = document.getElementById('wsRangeResult_' + id);
            const titleHtml = '<div class="ws-analysis-title"><i class="fas fa-robot"></i> 大模型分析结果</div>';
            if (el) {
                if (d.status === 'analyzing') {
                    if (d.analysis_result) this._startTyping('r' + id, el, d.analysis_result || '', titleHtml);
                    else if (!(el.querySelector && el.querySelector('.ws-ai-thinking'))) this._showThinking(el);
                }
                else if (d.status === 'done') { this._stopRangePolling(id); this._stopTyping('r' + id, titleHtml + this._analysisCollapsedHtml(d.analysis_result || '（模型未返回内容）')); }
                else if (d.status === 'failed') { this._stopRangePolling(id); this._stopTyping('r' + id, '<span style="color:#f56c6c;">分析失败：' + this.escapeHtml(d.error_message || '') + '</span>'); }
            }
            const stEl = document.getElementById('wsRangeStatus_' + id);
            if (stEl) stEl.outerHTML = this.statusBadge(d.status).replace('<span', '<span id="wsRangeStatus_' + id + '"');
            if (d.prompt_text) {
                const pEl = document.getElementById('wsRangePrompt_' + id);
                if (pEl && !pEl.getAttribute('data-filled')) { pEl.setAttribute('data-filled', '1'); pEl.innerHTML = this.escapeHtml(d.prompt_text); }
            }
        } catch (e) { /* ignore */ }
    }


    // ==================== 优雅的确认对话框 ====================
    showConfirmDialog(title, message, type) {
        if (type === undefined) type = 'confirm';
        return new Promise((resolve) => {
            const iconMap = {danger: 'exclamation-triangle', confirm: 'check-circle'};
            const icon = iconMap[type] || 'question-circle';
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-' + icon + '"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn cancel">取消</button>'
                + '<button class="confirm-dialog-btn ' + type + '">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve(result);
            };
            dialog.querySelector('.cancel').addEventListener('click', () => close(false));
            dialog.querySelector('.' + type).addEventListener('click', () => close(true));
            dialog.querySelector('.close-btn').addEventListener('click', () => close(false));
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close(false);
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    showToast(message, isError) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        const icon = isError ? 'fa-exclamation-circle' : 'fa-check-circle';
        const title = isError ? '错误' : '成功';
        const color = isError ? '#f56c6c' : '#67c23a';
        toast.innerHTML = '<div class="toast-content" style="border-left-color:' + color + ';">'
            + '<div class="toast-icon"><i class="fas ' + icon + '" style="color:' + color + ';"></i></div>'
            + '<div><div class="toast-title">' + title + '</div>'
            + '<div class="toast-text">' + this._escape(message) + '</div></div></div>';
        toast.classList.remove('show');
        void toast.offsetHeight;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    showError(message) {
        this.showToast(message, true);
    }

    showSuccess(message) {
        this.showToast(message, false);
    }

}

const workSummaryApp = new WorkSummaryApp();
window.workSummaryApp = workSummaryApp;
