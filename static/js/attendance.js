// static/js/attendance.js - 考勤打卡

const OA_API_URL = '/api/oa';

class AttendanceApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this._initTimer = null;

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = '/login/';
            return;
        }
        this.updateClock();
        this._initTimer = setInterval(() => this.updateClock(), 1000);
        await this.loadToday();
        await this.loadStats();
        await this.loadRecords();
    }

    updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const el = document.getElementById('todayTime');
        if (el) el.textContent = hours + ':' + minutes + ':' + seconds;

        const dateEl = document.getElementById('todayDate');
        if (dateEl) {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            dateEl.textContent = y + '年' + m + '月' + d + '日 星期' + weekdays[now.getDay()];
        }
    }

    async apiGet(url) {
        const resp = await fetch(url, { headers: TokenManager.getHeaders() });
        if (!resp.ok) throw new Error('请求失败');
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    async apiPost(url, data) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify(data || {})
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || '请求失败');
        }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    async loadToday() {
        try {
            const data = await this.apiGet(OA_API_URL + '/attendance/today/');
            const statusEl = document.getElementById('todayStatus');
            const clockInBtn = document.getElementById('clockInBtn');
            const clockOutBtn = document.getElementById('clockOutBtn');
            console.log('today:::', data);
            if (data.has_clock_in) {
                clockInBtn.disabled = true;
                clockInBtn.classList.add('clocked');
                clockInBtn.innerHTML = '<i class="fas fa-check-circle"></i> 已打卡';
            } else {
                clockInBtn.disabled = false;
                clockInBtn.classList.remove('clocked');
                clockInBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡';
            }

            if (data.has_clock_out) {
                clockOutBtn.disabled = true;
                clockOutBtn.classList.add('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-check-circle"></i> 已打卡';
            } else if (data.has_clock_in) {
                clockOutBtn.disabled = false;
                clockOutBtn.classList.remove('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            } else {
                clockOutBtn.disabled = true;
                clockOutBtn.classList.remove('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            }

            if (data.clock_in && data.clock_out) {
                statusEl.textContent = '✅ 今日考勤已完成';
            } else if (data.clock_in) {
                statusEl.textContent = '⏳ 已上班打卡，等待下班打卡';
            } else {
                statusEl.textContent = '📋 今日尚未打卡';
            }
        } catch (e) {
            console.error('加载今日状态失败:', e);
        }
    }

    async loadStats() {
        try {
            const data = await this.apiGet(OA_API_URL + '/attendance/statistics/');
            console.log('statistics:::', data);
            document.getElementById('statTotalDays').textContent = data.total_days || 0;
            document.getElementById('statClockIn').textContent = data.clock_in_count || 0;
            document.getElementById('statClockOut').textContent = data.clock_out_count || 0;
            document.getElementById('statLate').textContent = data.late_count || 0;
            document.getElementById('statEarlyLeave').textContent = data.early_leave_count || 0;
        } catch (e) {
            console.error('加载统计失败:', e);
        }
    }

    async loadRecords(page) {
        if (page === undefined) page = this.currentPage;
        this.currentPage = page;
        const tbody = document.getElementById('attendanceTableBody');
        const pagination = document.getElementById('attendancePagination');
        if (!tbody) return;
        try {
            let url = OA_API_URL + '/attendance/?page=' + page + '&page_size=' + this.pageSize;
            if (this.searchKeyword) url += '&search=' + encodeURIComponent(this.searchKeyword);
            const data = await this.apiGet(url);
            console.log('records:::', data);
            this._renderRecords(data, tbody);
            this._renderPagination(data, pagination);
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#909399;">加载失败: ' + e.message + '</td></tr>';
            pagination.style.display = 'none';
        }
    }

    onPageSizeChange(e) {
        this.pageSize = parseInt(e.target.value);
        this.loadRecords(1);
    }

    goToPage(t) {
        var input = document.getElementById('attendanceGotoInput');
        if (!input) return;
        var p = parseInt(input.value);
        if (isNaN(p) || p < 1) p = 1;
        if (p > t) p = t;
        this.loadRecords(p);
    }

    _renderRecords(data, tbody) {
        const rows = data.results || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#909399;">暂无打卡记录</td></tr>';
            return;
        }
        const statusMap = { 'normal': '正常', 'late': '迟到', 'early_leave': '早退' };
        const defaultAvatar = '/static/images/default-avatar.png';
        tbody.innerHTML = rows.map(function(r) {
            const st = r.status || 'normal';
            const avatar = r.avatar_url || defaultAvatar;
            return '<tr style="cursor:pointer;" onclick="attendanceApp.showDetail(' + r.id + ')">'
                + '<td><div style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">'
                + '<span>' + attendanceApp._escape(r.user_name || '') + '</span></div></td>'
                + '<td>' + attendanceApp._escape(r.department_name || '-') + '</td>'
                + '<td>' + (r.date || '-') + '</td>'
                + '<td><span class="badge badge-info">' + (r.clock_type_display || r.clock_type) + '</span></td>'
                + '<td>' + attendanceApp._formatTime(r.clock_time) + '</td>'
                + '<td><span class="status-badge ' + st + '">' + (statusMap[st] || st) + '</span></td>'
                + '<td>' + (r.location || '-') + '</td>'
                + '<td>' + (r.device || '-') + '</td>'
                + '<td><button class="action-btn" onclick="event.stopPropagation();attendanceApp.showDetail(' + r.id + ')" title="详情"><i class="fas fa-eye"></i></button></td></tr>';
        }).join('');
    }

    _renderPagination(data, container) {
        if (!data.total_pages || data.total_pages <= 1) { container.style.display = 'none'; return; }
        container.style.display = 'flex';
        const p = data.page, t = data.total_pages;
        let html = '<div class="oa-pagination-bar">'
            + '<span class="oa-pagination-total">共 ' + data.count + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<div class="oa-pagination-page-size"><span>每页</span><select onchange="attendanceApp.onPageSizeChange(event)">'
            + '<option value="10" ' + (this.pageSize === 10 ? 'selected' : '') + '>10</option>'
            + '<option value="20" ' + (this.pageSize === 20 ? 'selected' : '') + '>20</option>'
            + '<option value="50" ' + (this.pageSize === 50 ? 'selected' : '') + '>50</option>'
            + '</select><span>条</span></div>'
            + '<div class="oa-pagination-btns">';
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(1)" ' + (p <= 1 ? 'disabled' : '') + ' title="首页"><i class="fas fa-angle-double-left"></i></button>';
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(' + (p - 1) + ')" ' + (p <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        for (let i = Math.max(1, p - 2); i <= Math.min(t, p + 2); i++) {
            html += '<button class="pagination-btn ' + (i === p ? 'active' : '') + '" onclick="attendanceApp.loadRecords(' + i + ')">' + i + '</button>';
        }
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(' + (p + 1) + ')" ' + (p >= t ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(' + t + ')" ' + (p >= t ? 'disabled' : '') + ' title="末页"><i class="fas fa-angle-double-right"></i></button>';
        html += '</div>'
            + '<div class="oa-pagination-goto"><span>跳至</span><input type="text" id="attendanceGotoInput" value="' + p + '" onkeydown="if(event.key===\'Enter\')attendanceApp.goToPage(' + t + ')"><span>页</span></div>'
            + '</div>';
        container.innerHTML = html;
    }

    async showDetail(id) {
        try {
            const d = await this.apiGet(OA_API_URL + '/attendance/' + id + '/');
            const statusMap = { 'normal': '正常', 'late': '迟到', 'early_leave': '早退' };
            const avatar = d.avatar_url || '/static/images/default-avatar.png';
            const html = '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label>用户</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + this._escape(d.user_name || '') + '</span></div>'
                + '<div class="detail-item"><label>部门</label><span>' + this._escape(d.department_name || '-') + '</span></div>'
                + '<div class="detail-item"><label>日期</label><span>' + (d.date || '-') + '</span></div>'
                + '<div class="detail-item"><label>类型</label><span>' + (d.clock_type_display || '-') + '</span></div>'
                + '<div class="detail-item"><label>时间</label><span>' + this._formatTime(d.clock_time) + '</span></div>'
                + '<div class="detail-item"><label>状态</label><span class="status-badge ' + (d.status || 'normal') + '">' + (statusMap[d.status] || d.status || '-') + '</span></div>'
                + '<div class="detail-item" style="grid-column:1/-1;"><label>位置</label><span>' + (d.location || '-') + '</span></div>'
                + '<div class="detail-item"><label>经度</label><span>' + (d.longitude || '-') + '</span></div>'
                + '<div class="detail-item"><label>纬度</label><span>' + (d.latitude || '-') + '</span></div>'
                + '<div class="detail-item"><label>设备</label><span>' + (d.device || '-') + '</span></div>'
                + '<div class="detail-item" style="grid-column:1/-1;"><label>备注</label><span>' + (d.remark || '-') + '</span></div></div>';
            const modal = document.getElementById('attendanceDetailModal');
            document.getElementById('attendanceDetailBody').innerHTML = html;
            modal.style.display = 'flex';
            setTimeout(function() { modal.classList.add('show'); }, 10);
        } catch (e) {
            console.error('加载详情失败:', e);
        }
    }

    async _fetchLocation() {
        var location = '';
        var lat = null;
        var lng = null;
        var reverseGeocoding = null;
        try {
            var pos = await new Promise(function(res, rej) {
                navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, enableHighAccuracy: true });
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            // 通过后端接口进行百度地图反向地理编码
            try {
                var geoResp = await fetch('/api/oa/approval/geocode/?lat=' + lat + '&lng=' + lng, {
                    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || '') }
                });
                if (geoResp.ok) {
                    var geoData = await geoResp.json();
                    if (geoData.location) {
                        location = geoData.location;
                    }
                    if (geoData.reverse_geocoding) {
                        reverseGeocoding = geoData.reverse_geocoding;
                    }
                }
            } catch (geoErr) {
                console.warn('地理编码接口失败:', geoErr);
            }
        } catch (e) {
            console.warn('位置获取失败:', e);
        }
        return { latitude: lat, longitude: lng, location: location, reverse_geocoding: reverseGeocoding };
    }

    async clockIn() {
        const btn = document.getElementById('clockInBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
        try {
            var loc = await this._fetchLocation();
            var data = { device: this._getDeviceInfo() };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;
            await this.apiPost(OA_API_URL + '/attendance/clock-in/', data);
            await this.loadToday();
            await this.loadStats();
            await this.loadRecords(1);
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡';
            console.error('打卡失败:', e);
        }
    }

    async clockOut() {
        const btn = document.getElementById('clockOutBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
        try {
            var loc = await this._fetchLocation();
            var data = { device: this._getDeviceInfo() };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;
            await this.apiPost(OA_API_URL + '/attendance/clock-out/', data);
            await this.loadToday();
            await this.loadStats();
            await this.loadRecords(1);
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            console.error('打卡失败:', e);
        }
    }

    search() {
        const el = document.getElementById('attendanceSearch');
        this.searchKeyword = el ? el.value.trim() : '';
        this.loadRecords(1);
    }


    // ==================== 优雅的提示对话框 ====================
    showAlert(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-info-circle"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn confirm">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = () => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve();
            };
            dialog.querySelector('.confirm').addEventListener('click', close);
            dialog.querySelector('.close-btn').addEventListener('click', close);
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close();
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
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
        const toast = document.getElementById('toast');
        if (!toast) return;
        const icon = isError ? 'fa-exclamation-circle' : 'fa-check-circle';
        const title = isError ? '错误' : '成功';
        const color = isError ? '#f56c6c' : '#67c23a';
        toast.innerHTML = '<div class="toast-content" style="border-left-color:' + color + ';">'
            + '<div class="toast-icon"><i class="fas ' + icon + '" style="color:' + color + ';"></i></div>'
            + '<div><div class="toast-title">' + title + '</div>'
            + '<div class="toast-text">' + this._escape(message) + '</div></div></div>';
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    _escape(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _getDeviceInfo() {
        const ua = navigator.userAgent || '';
        if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
        if (ua.includes('Android')) return 'Android';
        if (ua.includes('Windows')) return 'Windows';
        if (ua.includes('Mac')) return 'macOS';
        if (ua.includes('Linux')) return 'Linux';
        return ua.substring(0, 50);
    }

    _formatTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }
}
