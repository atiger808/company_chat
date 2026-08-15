// static/js/work-calendar.js - 工作日历
const WC_API = '/api/oa/work-calendar';

class WorkCalendarApp {
    constructor() {
        this.chat_login_url = '/login/';
        this._year = new Date().getFullYear();
        this._month = new Date().getMonth() + 1;
        this._isSuperAdmin = localStorage.getItem('user_type') === 'super_admin';
        this._init();
    }

    async _init() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = this.chat_login_url;
            return;
        }
        if (this._isSuperAdmin) {
            const bar = document.getElementById('wcAdminBar');
            if (bar) { bar.style.display = 'flex'; }
        }
        this.loadMonth(this._year, this._month);
    }

    // ===== API 封装 =====
    _apiError(resp, body) {
        const err = new Error((body && (body.error || body.detail)) || '请求失败');
        err.status = resp.status;
        return err;
    }
    async apiGet(url) {
        const resp = await fetch(url, {headers: TokenManager.getHeaders()});
        if (!resp.ok) {
            if (resp.status === 401) { this._handleAuthError(); return null; }
            const body = await resp.json().catch(() => ({}));
            throw this._apiError(resp, body);
        }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    async apiPost(url, data) {
        const resp = await fetch(url, {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify(data || {})});
        if (!resp.ok) {
            if (resp.status === 401) { this._handleAuthError(); return null; }
            const body = await resp.json().catch(() => ({}));
            throw this._apiError(resp, body);
        }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    _handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
    }

    _escape(text) {
        return Utils.escapeHtml ? Utils.escapeHtml(text) : String(text || '').replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
    }

    // ===== 月度加载 =====
    async loadMonth(year, month) {
        this._year = year;
        this._month = month;
        const el = document.getElementById('wcYearMonth');
        if (el) el.textContent = year + '年' + month + '月';
        try {
            const d = await this.apiGet(WC_API + '/?year=' + year + '&month=' + month);
            if (!d) return;
            this._renderPending(d.pending || {});
            this._renderCalendar(d.days || {}, year, month);
        } catch (e) {
            this.showToast('加载工作日历失败', true);
        }
    }

    _renderPending(p) {
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('wcApprovals', p.pending_approvals || 0);
        set('wcInvoices', p.pending_invoices || 0);
        set('wcWithdrawals', p.pending_withdrawals || 0);
        set('wcTasks', p.pending_tasks || 0);
        const miss = document.getElementById('wcMissClock');
        if (miss) {
            const parts = [];
            if (p.miss_clock_in) parts.push('<i class="fas fa-exclamation-triangle"></i> 今日上班卡未打');
            if (p.miss_clock_out) parts.push('<i class="fas fa-exclamation-triangle"></i> 今日下班卡未打');
            if (parts.length) {
                miss.innerHTML = parts.join('&nbsp;&nbsp;') + '，请及时打卡';
                miss.style.display = 'block';
            } else {
                miss.style.display = 'none';
            }
        }
    }

    _renderCalendar(days, year, month) {
        const grid = document.getElementById('wcCalGrid');
        if (!grid) return;
        const week = ['日', '一', '二', '三', '四', '五', '六'];
        let html = week.map(function (w) { return '<div class="wc-cal-week">' + w + '</div>'; }).join('');
        const firstDay = new Date(year, month - 1, 1).getDay();
        const daysInMonth = new Date(year, month, 0).getDate();
        const todayStr = this._todayStr();
        for (let i = 0; i < firstDay; i++) html += '<div></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            const info = days[ds] || {};
            let badges = '';
            const badgeMap = [
                [info.approvals, '审', '#409eff'],
                [info.invoices, '补', '#e6a23c'],
                [info.withdrawals, '提', '#16a085'],
                [info.tasks, '任', '#f56c6c'],
                [info.docs, '文', '#9b59b6']
            ];
            badgeMap.forEach(function (b) {
                if (b[0] > 0) badges += '<span class="wc-cal-badge" style="background:' + b[2] + ';">' + b[1] + '</span>';
            });
            let attr = '';
            if (info.clock_in || info.clock_out) {
                attr = '<div class="wc-cal-attr"><i class="fas fa-clock" style="color:#67c23a;"></i> ' + (info.clock_in || '--') + ' / ' + (info.clock_out || '--') + '</div>';
            }
            const isToday = ds === todayStr;
            html += '<div class="wc-cal-cell' + (isToday ? ' today' : '') + '" onclick="wcApp.showDay(\'' + ds + '\')" title="' + ds + '">'
                + '<div class="wc-cal-day">' + d + (isToday ? ' <span style="font-size:10px;color:#409eff;">今</span>' : '') + '</div>'
                + (badges ? '<div class="wc-cal-badges">' + badges + '</div>' : '')
                + attr
                + '</div>';
        }
        grid.innerHTML = html;
    }

    _todayStr() {
        const n = new Date();
        return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    }

    prevMonth() {
        let y = this._year, m = this._month - 1;
        if (m < 1) { m = 12; y--; }
        this.loadMonth(y, m);
    }
    nextMonth() {
        let y = this._year, m = this._month + 1;
        if (m > 12) { m = 1; y++; }
        this.loadMonth(y, m);
    }
    showToday() {
        const n = new Date();
        this.loadMonth(n.getFullYear(), n.getMonth() + 1);
    }

    // ===== 某日详情 =====
    async showDay(dateStr) {
        try {
            const d = await this.apiGet(WC_API + '/day/?date=' + encodeURIComponent(dateStr));
            if (!d) return;
            const title = document.getElementById('wcDayTitle');
            if (title) title.textContent = dateStr + ' 工作汇总';
            const p = d.pending || {};
            const chips = [];
            const chipDef = [
                ['待处理审批 ' + (p.pending_approvals || 0), '/oa/approval/', '#409eff'],
                ['待核验发票 ' + (p.pending_invoices || 0), '/oa/subsidy-verify/', '#e6a23c'],
                ['待支付提现 ' + (p.pending_withdrawals || 0), '/oa/subsidy-pay/', '#16a085'],
                ['待处理任务 ' + (p.pending_tasks || 0), '/tasks/', '#f56c6c']
            ];
            chipDef.forEach(function (c) {
                chips.push('<span class="wc-pending-chip" style="color:' + c[2] + ';" onclick="window.location.href=\'' + c[1] + '\'"><i class="fas fa-arrow-right"></i> ' + c[0] + '</span>');
            });
            document.getElementById('wcDayPending').innerHTML = chips.join('');
            const events = d.events || [];
            const body = document.getElementById('wcDayEvents');
            if (!events.length) {
                body.innerHTML = '<div class="wc-empty"><i class="fas fa-coffee" style="font-size:26px;display:block;margin-bottom:8px;color:#c0c4cc;"></i>当日暂无工作记录</div>';
            } else {
                body.innerHTML = events.map(function (e) {
                    const iconBg = {
                        approval: ['#ecf5ff', '#409eff'], subsidy: ['#e8f8f0', '#16a085'],
                        task: ['#fdf6ec', '#e6a23c'], doc: ['#f3e8ff', '#9b59b6'], attendance: ['#f0f9eb', '#67c23a']
                    }[e.type] || ['#f0f2f5', '#909399'];
                    return '<div class="wc-event" onclick="window.location.href=\'' + this._escape(e.url || '#') + '\'">'
                        + '<div class="wc-event-icon" style="background:' + iconBg[0] + ';color:' + iconBg[1] + ';"><i class="' + this._escape(e.icon || 'fas fa-circle') + '"></i></div>'
                        + '<div class="wc-event-time">' + this._escape(e.time || '') + '</div>'
                        + '<div class="wc-event-title">' + this._escape(e.title || '') + '</div>'
                        + '<i class="fas fa-chevron-right" style="color:#c0c4cc;font-size:11px;flex-shrink:0;"></i>'
                        + '</div>';
                }, this).join('');
            }
            const modal = document.getElementById('wcDayModal');
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        } catch (e) {
            this.showToast('加载当日详情失败', true);
        }
    }
    _closeDayModal() {
        const modal = document.getElementById('wcDayModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    }

    // ===== 每日通知配置 =====
    async openConfigModal() {
        try {
            const d = await this.apiGet(WC_API + '/digest-config/');
            if (!d) return;
            document.getElementById('wcDigestEnabled').checked = !!d.enabled;
            document.getElementById('wcDigestTime').value = d.send_time || '09:00';
            document.getElementById('wcDigestAuto').checked = !!d.auto_send;
            const modal = document.getElementById('wcConfigModal');
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        } catch (e) {
            this.showToast((e && e.message) || '加载配置失败', true);
        }
    }
    _closeConfigModal() {
        const modal = document.getElementById('wcConfigModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    }

    async saveConfig() {
        try {
            const payload = {
                enabled: document.getElementById('wcDigestEnabled').checked,
                send_time: document.getElementById('wcDigestTime').value,
                auto_send: document.getElementById('wcDigestAuto').checked
            };
            const d = await this.apiPost(WC_API + '/digest-config/', payload);
            if (!d) return;
            this._closeConfigModal();
            this.showToast('配置已保存', false);
        } catch (e) {
            this.showToast((e && e.message) || '保存失败', true);
        }
    }

    async sendNow() {
        var confirmed = await this.showConfirmDialog('发送工作汇总', '确认立即给企业所有员工发送每日工作汇总？', 'confirm');
        if (!confirmed) return;
        try {
            const d = await this.apiPost(WC_API + '/digest-send/', {});
            if (!d) return;
            this.showToast(d.message || '已发送', false);
        } catch (e) {
            this.showToast((e && e.message) || '发送失败', true);
        }
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


    // ===== Toast =====
    showToast(message, isError) {
        let el = document.getElementById('wcToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'wcToast';
            el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:8px;font-size:14px;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.15);';
            document.body.appendChild(el);
        }
        el.style.background = isError ? '#f56c6c' : '#67c23a';
        el.textContent = message;
        el.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2600);
    }
}

const wcApp = new WorkCalendarApp();
window.wcApp = wcApp;
