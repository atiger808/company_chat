// static/js/attendance.js - 考勤打卡

const OA_API_URL = '/api/oa';

class AttendanceApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this._initTimer = null;
        this.chat_login_url = '/login/';

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
            window.location.href = this.chat_login_url;
            return;
        }
        this.updateClock();
        this._initTimer = setInterval(() => this.updateClock(), 1000);
        await this.loadToday();
        await this.loadStats();
        await this.loadRecords();

        // 显示管理员的过滤组件
        var userType = localStorage.getItem('user_type');
        if (userType === 'admin' || userType === 'super_admin') {
            var tenantFilter = document.getElementById('attendanceFilterTenant');
            var deptFilter = document.getElementById('attendanceFilterDepartment');
            var exportBtn = document.getElementById('attendanceExportBtn');
            var printBtn = document.getElementById('attendancePrintBtn');
            var configBtn = document.getElementById('attendanceConfigBtn');
            if (tenantFilter) tenantFilter.style.display = '';
            if (deptFilter) deptFilter.style.display = '';
            if (exportBtn) { exportBtn.style.display = ''; exportBtn.style.opacity = '0.4'; }
            if (printBtn) { printBtn.style.display = ''; printBtn.style.opacity = '0.4'; }
            if (configBtn) configBtn.style.display = 'inline-flex';
            this._loadFilterTenants();
            // Bind dept filter change
            if (deptFilter) {
                deptFilter.addEventListener('change', function() {
                    attendanceApp.loadRecords(1);
                });
            }
        }
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

    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
    }

    async apiGet(url) {
        const resp = await fetch(url, { headers: TokenManager.getHeaders() });
        if (!resp.ok) {
            if (resp.status === 401) {
                this.showToast('登录已过期，请重新登录', true)
                this.handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || '请求失败');
        };
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
            if (resp.status === 401) {
                this.showToast('登录已过期，请重新登录', true)
                this.handleAuthError();
                return
            }
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
            document.getElementById('statTotalDays').textContent = data.total_days || 0;
            document.getElementById('statClockIn').textContent = data.clock_in_count || 0;
            document.getElementById('statClockOut').textContent = data.clock_out_count || 0;
            document.getElementById('statLate').textContent = data.late_count || 0;
            document.getElementById('statLate').style.color = (data.late_count || 0) > 0 ? '#f56c6c' : '';
            document.getElementById('statEarlyLeave').textContent = data.early_leave_count || 0;
            document.getElementById('statEarlyLeave').style.color = (data.early_leave_count || 0) > 0 ? '#e6a23c' : '';
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
            var tenantId = document.getElementById('attendanceFilterTenant') ? document.getElementById('attendanceFilterTenant').value : '';
            var deptId = document.getElementById('attendanceFilterDepartment') ? document.getElementById('attendanceFilterDepartment').value : '';
            if (tenantId) url += '&tenant_id=' + tenantId;
            if (deptId) url += '&org_dept_id=' + deptId;
            const data = await this.apiGet(url);
            console.log(data);
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
        // Clear selection on page change
        if (this._selectedRecordIds) this._selectedRecordIds.clear();
        const rows = data.results || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:#909399;">暂无打卡记录</td></tr>';
            this._updateExportPrintButtons();
            return;
        }
        const statusMap = { 'normal': '正常', 'late': '迟到', 'early_leave': '早退' };
        const defaultAvatar = '/static/images/default-avatar.png';
        tbody.innerHTML = rows.map(function(r) {
            const st = r.status || 'normal';
            const avatar = r.avatar_url || defaultAvatar;
            var checked = attendanceApp._selectedRecordIds && attendanceApp._selectedRecordIds.has(r.id) ? 'checked' : '';
            return '<tr style="cursor:pointer;">'
                + '<td><input type="checkbox" class="record-cb" data-id="' + r.id + '" ' + checked + ' onchange="event.stopPropagation();attendanceApp._toggleRecord(' + r.id + ', this.checked)"></td>'
                + '<td><div style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">'
                + '<span>' + attendanceApp._escape(r.user_name || '') + '</span></div></td>'
                + '<td>' + attendanceApp._escape(r.department_name || '-') + '</td>'
                + '<td>' + (r.date || '-') + '</td>'
                + '<td><span class="badge badge-info">' + (r.clock_type_display || r.clock_type) + '</span></td>'
                + '<td>' + attendanceApp._formatTime(r.clock_time) + '</td>'
                + '<td><span class="status-badge ' + st + '">' + (statusMap[st] || st) + '</span></td>'
                + '<td onclick="event.stopPropagation();attendanceApp.showDetail(' + r.id + ')">' + (r.location || '-') + (r.bd09_latitude ? ' <i class="fas fa-map-marker-alt" style="color:#f56c6c;font-size:11px;" title="已标记地图位置"></i>' : '') + '</td>'
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
            let html = '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label>用户</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + this._escape(d.user_name || '') + '</span></div>'
                + '<div class="detail-item"><label>部门</label><span>' + this._escape(d.department_name || '-') + '</span></div>'
                + '<div class="detail-item"><label>日期</label><span>' + (d.date || '-') + '</span></div>'
                + '<div class="detail-item"><label>类型</label><span>' + (d.clock_type_display || '-') + '</span></div>'
                + '<div class="detail-item"><label>时间</label><span>' + this._formatTime(d.clock_time) + '</span></div>'
                + '<div class="detail-item"><label>状态</label><span class="status-badge ' + (d.status || 'normal') + '">' + (statusMap[d.status] || d.status || '-') + '</span></div>'
                + '<div class="detail-item"><label>位置</label><span>' + (d.location || '-') + '</span></div>'
                + '<div class="detail-item"><label>经度</label><span>' + (d.longitude || '-') + '</span></div>'
                + '<div class="detail-item"><label>纬度</label><span>' + (d.latitude || '-') + '</span></div>'
                + '<div class="detail-item"><label>设备</label><span>' + (d.device || '-') + '</span></div>'
                + '<div class="detail-item"><label>IP地址</label><span>' + (d.ip_address || '-') + '</span></div>'
                + '</div>'
                + '<div class="detail-item"><label>User-Agent</label><span style="font-size:11px;word-break:break-all;">' + (d.user_agent || '-') + '</span></div>';

            const modal = document.getElementById('attendanceDetailModal');
            document.getElementById('attendanceDetailBody').innerHTML = html;

            // 尝试加载百度地图
            if (d.latitude && d.longitude) {
                var bdLat = d.bd09_latitude;
                var bdLng = d.bd09_longitude;
                var status = '状态：' + (statusMap[d.status] || d.status || '-')
                var clock_time = ' 打卡时间：' + this._formatTime(d.clock_time)
                if (bdLat && bdLng) {
                    this._showBaiduMap(bdLat, bdLng, status, clock_time);
                } else {
                    // 坐标未转换，调用后端转换接口
                    this._convertAndShowMap(id, status, clock_time);
                }
            }

            modal.style.display = 'flex';
            setTimeout(function() { modal.classList.add('show'); }, 10);
        } catch (e) {
            console.error('加载详情失败:', e);
        }
    }

    async _convertAndShowMap(id, status, clock_time) {
        try {
            var resp = await fetch(OA_API_URL + '/attendance/' + id + '/convert-coords/', {
                headers: TokenManager.getHeaders()
            });
            if (resp.ok) {
                var data = await resp.json();
                if (data.bd09_latitude && data.bd09_longitude) {
                    this._showBaiduMap(data.bd09_latitude, data.bd09_longitude, status, clock_time);
                }
            }
        } catch (e) {
            console.warn('坐标转换失败:', e);
        }
    }

    _showBaiduMap(bdLat, bdLng, status, clock_time) {
        var body = document.getElementById('attendanceDetailBody');
        if (!body) return;
        var iframeUrl = 'https://api.map.baidu.com/marker?location=' + bdLat + ',' + bdLng + '&title=考勤打卡点&content=' + status + clock_time +'&output=html&coord_type=bd09ll';
        var mapId = 'bdmap_' + Date.now();
        var mapDiv = document.createElement('div');
        mapDiv.style.cssText = 'margin-top:16px;border-radius:8px;overflow:hidden;border:1px solid var(--border-color,#dcdfe6);';
        mapDiv.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:500;padding:8px 12px;background:var(--bg-secondary,#f5f7fa);color:var(--text-secondary,#606266);border-bottom:1px solid var(--border-color,#ebeef5);">'
            + '<span><i class="fas fa-map-marker-alt" style="color:#f56c6c;"></i> 打卡位置地图</span>'
            + '<span onclick="attendanceApp._toggleMapFullscreen(\'' + mapId + '\')" style="cursor:pointer;padding:2px 8px;border-radius:4px;color:var(--primary-color,#409eff);font-size:12px;" title="全屏查看"><i class="fas fa-expand"></i></span></div>'
            + '<div id="' + mapId + '" style="position:relative;"><iframe src="' + iframeUrl + '" width="100%" height="320px" frameborder="0" style="display:block;" scrolling="no"></iframe></div>';
        body.appendChild(mapDiv);
    }

    _toggleMapFullscreen(mapId) {
        var container = document.getElementById(mapId);
        if (!container) return;
        var isFull = container.classList.contains('map-fullscreen');
        if (isFull) {
            container.classList.remove('map-fullscreen');
            container.querySelector('iframe').style.height = '320px';
            container.style.position = 'relative';
            container.style.zIndex = '';
            container.style.background = '';
            container.style.top = '';
            container.style.left = '';
            container.style.width = '';
            container.style.height = '';
            if (container._fsBtn) {
                container._fsBtn.remove();
                container._fsBtn = null;
            }
        } else {
            container.classList.add('map-fullscreen');
            var iframe = container.querySelector('iframe');
            iframe.style.height = window.innerHeight + 'px';
            container.style.position = 'fixed';
            container.style.zIndex = '9999';
            container.style.background = '#fff';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            var btn = document.createElement('div');
            btn.innerHTML = '<i class="fas fa-compress"></i> 退出全屏';
            btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:10000;padding:8px 16px;background:rgba(0,0,0,0.6);color:#fff;border-radius:6px;font-size:14px;cursor:pointer;';
            btn.onclick = function(e) { e.stopPropagation(); attendanceApp._toggleMapFullscreen(mapId); };
            document.body.appendChild(btn);
            container._fsBtn = btn;
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

    _getClientInfo() {
        var ip = '';
        var ua = navigator.userAgent || '';
        return { ip: ip, userAgent: ua };
    }

    async clockIn() {
        const btn = document.getElementById('clockInBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
        try {
            var loc = await this._fetchLocation();
            var info = this._getClientInfo();
            var data = { device: this._getDeviceInfo(), user_agent: info.userAgent };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;
            var result = await this.apiPost(OA_API_URL + '/attendance/clock-in/', data);
            if (result && result.skip) {
                this.showToast(result.error || '该时段无需打卡', false);
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> 无需打卡';
                return;
            }
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
            var info = this._getClientInfo();
            var data = { device: this._getDeviceInfo(), user_agent: info.userAgent };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;
            var result = await this.apiPost(OA_API_URL + '/attendance/clock-out/', data);
            if (result && result.skip) {
                this.showToast(result.error || '该时段无需打卡', false);
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> 无需打卡';
                return;
            }
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

    _selectedRecordIds = null

    _getSelectedIds() {
        if (!this._selectedRecordIds) this._selectedRecordIds = new Set();
        return this._selectedRecordIds;
    }

    _toggleRecord(id, checked) {
        var set = this._getSelectedIds();
        if (checked) set.add(id); else set.delete(id);
        var selectAll = document.getElementById('attendanceSelectAll');
        if (selectAll) {
            var total = document.querySelectorAll('.record-cb').length;
            var checkedCount = document.querySelectorAll('.record-cb:checked').length;
            selectAll.checked = total > 0 && checkedCount === total;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < total;
        }
        this._updateExportPrintButtons();
    }

    _updateExportPrintButtons() {
        var count = this._selectedRecordIds ? this._selectedRecordIds.size : 0;
        var exportBtn = document.getElementById('attendanceExportBtn');
        var printBtn = document.getElementById('attendancePrintBtn');
        if (exportBtn) exportBtn.style.opacity = count > 0 ? '' : '0.4';
        if (printBtn) printBtn.style.opacity = count > 0 ? '' : '0.4';
    }

    _toggleSelectAll(checked) {
        document.querySelectorAll('.record-cb').forEach(function(cb) { cb.checked = checked; });
        var set = this._getSelectedIds();
        set.clear();
        if (checked) {
            document.querySelectorAll('.record-cb').forEach(function(cb) {
                var id = parseInt(cb.dataset.id);
                if (id) set.add(id);
            });
        }
        this._updateExportPrintButtons();
    }

    _loadFilterTenants() {
        var sel = document.getElementById('attendanceFilterTenant');
        if (!sel) return;
        fetch('/api/org/tenants/', { headers: TokenManager.getHeaders() }).then(function(resp) {
            return resp.ok ? resp.json() : {results: []};
        }).then(function(data) {
            var tenants = data.results || data || [];
            sel.innerHTML = '<option value="">全部企业</option>';
            tenants.forEach(function(t) {
                var opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.short_name || t.name;
                sel.appendChild(opt);
            });
        }).catch(function(e) { console.error(e); });
    }

    _loadFilterDepartments(tenantId) {
        var sel = document.getElementById('attendanceFilterDepartment');
        if (!sel) return;
        sel.innerHTML = '<option value="">全部部门</option>';
        if (!tenantId) return;
        fetch('/api/org/departments/?tenant_id=' + tenantId, { headers: TokenManager.getHeaders() }).then(function(resp) {
            return resp.ok ? resp.json() : {results: []};
        }).then(function(data) {
            var depts = data.results || data || [];
            var byParent = {};
            depts.forEach(function(d) {
                var pid = d.parent || 'root';
                if (!byParent[pid]) byParent[pid] = [];
                byParent[pid].push(d);
            });
            function renderChildren(parentId, depth) {
                var children = byParent[parentId] || [];
                children.forEach(function(d) {
                    var opt = document.createElement('option');
                    opt.value = d.id;
                    var prefix = '';
                    for (var k = 0; k < depth; k++) prefix += '— ';
                    opt.textContent = (depth > 0 ? prefix : '') + d.name;
                    sel.appendChild(opt);
                    renderChildren(d.id, depth + 1);
                });
            }
            renderChildren('root', 0);
        }).catch(function(e) { console.error(e); });
    }

    onFilterTenantChange() {
        var tenantId = document.getElementById('attendanceFilterTenant') ? document.getElementById('attendanceFilterTenant').value : '';
        this._loadFilterDepartments(tenantId);
        this.loadRecords(1);
    }

    exportRecords() {
        this._showExportPrintModal('export');
    }

    printRecords() {
        this._showExportPrintModal('print');
    }

    _showExportPrintModal(mode) {
        var self = this;
        var totalSelected = this._selectedRecordIds ? this._selectedRecordIds.size : 0;
        if (!totalSelected) {
            this.showAlert('提示', '请先选择要导出的打卡记录');
            return;
        }
        var fields = [
            {key:'user_name', label:'用户'},
            {key:'department_name', label:'部门'},
            {key:'date', label:'日期'},
            {key:'clock_type_display', label:'类型'},
            {key:'clock_time', label:'时间'},
            {key:'status', label:'状态'},
            {key:'location', label:'位置'},
            {key:'device', label:'设备'},
        ];
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
        var fieldHtml = fields.map(function(f, i) {
            return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;cursor:pointer;"><input type="checkbox" class="ef-field-cb" data-key="' + f.key + '" checked> ' + f.label + '</label>';
        }).join('');
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:500px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,0.18);">'
            + '<div style="padding:16px 20px;border-bottom:1px solid #ebeef5;"><h3 style="margin:0;font-size:16px;"><i class="fas fa-' + (mode==='print'?'print':'download') + '"></i> ' + (mode==='print'?'打印':'导出') + ' 考勤记录</h3></div>'
            + '<div style="padding:16px 20px;"><p style="margin:0 0 12px;font-size:14px;color:#606266;">选择表格字段：</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + fieldHtml + '</div></div>'
            + '<div style="padding:12px 20px;border-top:1px solid #ebeef5;display:flex;gap:10px;justify-content:flex-end;">'
            + '<button class="ef-cancel" style="padding:8px 20px;border:1px solid #dcdfe6;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>'
            + '<button class="ef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">' + (mode==='print'?'打印':'导出') + '</button></div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.ef-cancel').onclick = function() { overlay.remove(); };
        overlay.querySelector('.ef-confirm').onclick = function() {
            var checked = overlay.querySelectorAll('.ef-field-cb:checked');
            var selectedFields = Array.from(checked).map(function(cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showAlert('提示', '请至少选择一个字段'); return; }
            if (mode === 'print') self._doPrintRecords(selectedFields);
            else self._doExportRecords(selectedFields);
        };
    }

    _doPrintRecords(selectedFields) {
        var self = this;
        var tbody = document.getElementById('attendanceTableBody');
        if (!tbody) return;
        var trs = Array.from(tbody.querySelectorAll('tr')).filter(function(tr) { return tr.querySelector('.record-cb:checked'); });
        if (!trs.length) return;
        var now = new Date();
        var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
            + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var fields = [
            {key:'user_name', label:'用户'},{key:'department_name', label:'部门'},{key:'date', label:'日期'},
            {key:'clock_type_display', label:'类型'},{key:'clock_time', label:'时间'},{key:'status', label:'状态'},
            {key:'location', label:'位置'},{key:'device', label:'设备'},
        ];
        var fieldLabels = {};
        fieldLabels['user_name'] = '用户'; fieldLabels['department_name'] = '部门';
        fieldLabels['date'] = '日期'; fieldLabels['clock_type_display'] = '类型';
        fieldLabels['clock_time'] = '时间'; fieldLabels['status'] = '状态';
        fieldLabels['location'] = '位置'; fieldLabels['device'] = '设备';
        var selSet = {}; selectedFields.forEach(function(k){selSet[k]=true;});
        var win = window.open('', '_blank', 'width=1000,height=800');
        if (!win) return;
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>考勤打卡记录</title>'
            + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:20px;color:#333;}'
            + '.print-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}'
            + '.print-title{font-size:20px;font-weight:600;color:#409eff;}'
            + '.print-date{font-size:13px;color:#909399;}'
            + 'h2{text-align:center;margin-bottom:20px;color:#409eff;}'
            + 'table{width:100%;border-collapse:collapse;font-size:13px;}'
            + 'th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;}'
            + 'th{background:#f5f7fa;font-weight:600;}'
            + 'tr:nth-child(even){background:#fafafa;}'
            + '.normal{color:#67c23a;}.late{color:#f56c6c;}.early_leave{color:#e6a23c;}'
            + '@media print{body{padding:10px;}button{display:none;}}'
            + '</style></head><body>'
            + '<div class="print-header"><div class="print-title">考勤打卡记录</div><div class="print-date">打印时间：' + dateStr + '</div></div>'
            + '<table><thead><tr>';
        var statusMap = {'normal':'正常','late':'迟到','early_leave':'早退'};
        // Header
        fields.forEach(function(f) {
            if (selSet[f.key]) html += '<th>' + f.label + '</th>';
        });
        html += '</tr></thead><tbody>';
        trs.forEach(function(tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length < 10) return;
            html += '<tr>';
            fields.forEach(function(f) {
                if (!selSet[f.key]) return;
                if (f.key === 'status') {
                    var stText = tds[6].textContent || '';
                    var stKey = stText.toLowerCase().replace(/\s/g,'');
                    html += '<td class="' + stKey + '">' + (statusMap[stKey] || stText) + '</td>';
                } else {
                    var idx = {'user_name':1,'department_name':2,'date':3,'clock_type_display':4,'clock_time':5,'location':7,'device':8}[f.key];
                    html += '<td>' + (tds[idx] ? (tds[idx].textContent || '') : '') + '</td>';
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table><div style="text-align:center;margin-top:20px;"><button onclick="window.print()" style="padding:8px 24px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">打印</button></div></body></html>';
        win.document.write(html);
        win.document.close();
    }

    _doExportRecords(selectedFields) {
        var self = this;
        var token = localStorage.getItem('access_token');
        if (!token) { this.showAlert('提示', '登录已过期，请重新登录'); return; }
        var url = OA_API_URL + '/attendance/export/?';
        var params = [];
        var ids = Array.from(this._getSelectedIds());
        if (ids.length) params.push('record_ids=' + ids.join(','));
        if (selectedFields && selectedFields.length) params.push('fields=' + selectedFields.join(','));
        url += params.join('&');
        // Generate filename with current datetime
        var now = new Date();
        var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
        var filename = '考勤记录_' + dateStr + '_' + timeStr + '.csv';
        fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token }
        }).then(function(resp) {
            if (!resp.ok) { throw new Error('导出失败 ' + resp.status); }
            return resp.blob();
        }).then(function(blob) {
            var link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        }).catch(function(err) {
            self.showAlert('错误', '导出失败：' + err.message);
        });
    }

    // ==================== 优雅的提示对话框 ====================

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

    // ──────── 考勤配置 ────────

    resetFilters() {
        var searchEl = document.getElementById('attendanceSearch');
        if (searchEl) searchEl.value = '';
        this.searchKeyword = '';
        var tenantFilter = document.getElementById('attendanceFilterTenant');
        if (tenantFilter) tenantFilter.value = '';
        var deptFilter = document.getElementById('attendanceFilterDepartment');
        if (deptFilter) deptFilter.value = '';
        this.loadRecords(1);
    }

    async openConfigModal() {
        this._configEditKey = null;
        this._configDeleteId = null;
        this._configAttType = 'global';
        document.getElementById('attConfigType').value = 'global';
        // 重置类型卡片状态
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) {
            c.classList.remove('active');
            c.style.borderColor = '';
            c.style.background = '';
        });
        var gc = document.querySelector('.config-type-card[data-att-type="global"]');
        if (gc) { gc.classList.add('active'); gc.style.borderColor = '#409eff'; gc.style.background = '#ecf5ff'; }
        document.getElementById('attendanceConfigForm').style.display = 'none';
        document.getElementById('attendanceConfigFooter').style.display = 'none';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'block';
        document.getElementById('attConfigSubTenantRow').style.display = 'none';
        document.getElementById('attConfigDeptRow').style.display = 'none';
        var rightSel = document.getElementById('attConfigSubTenantSelect');
        if (rightSel) rightSel.innerHTML = '<option value="">请选择子公司</option>';
        await this._loadAttSubTenants();
        await this._loadAttConfigList();
        await this._loadAttDepts();
        document.getElementById('attendanceConfigModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('attendanceConfigModal').classList.add('show');
        }, 10);
    }

    _selectAttConfigType(type) {
        this._configAttType = type;
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = type;
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
        var card = document.querySelector('.config-type-card[data-att-type="' + type + '"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('attConfigSubTenantRow').style.display = type === 'sub_tenant' ? 'block' : 'none';
        document.getElementById('attConfigDeptRow').style.display = type === 'department' ? 'block' : 'none';
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        document.getElementById('attendanceConfigForm').style.display = 'block';
        document.getElementById('attendanceConfigFooter').style.display = 'flex';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'none';
        this._toggleClockIn();
        this._toggleClockOut();
        this._loadConfigForType(type);
    }

    async _loadConfigForType(type) {
        try {
            var resp = await fetch(OA_API_URL + '/attendance/attendance-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var json = await resp.json();
            var configs = json.results || [];
            var cfg = null;
            // Match using the actual selected dropdown values
            var selSubTenant = document.getElementById('attConfigSubTenantSelect').value;
            var selDept = document.getElementById('attendanceConfigDept').value;
            configs.forEach(function(c) {
                var cSt = c.sub_tenant ? String(c.sub_tenant) : '';
                var cDept = c.department ? String(c.department) : '';
                if (type === 'global' && !c.sub_tenant && !c.department) { cfg = c; }
                else if (type === 'sub_tenant' && c.sub_tenant && !c.department) {
                    if (selSubTenant && cSt === selSubTenant) cfg = c;
                }
                else if (type === 'department' && c.department) {
                    if (selDept && cDept === selDept) cfg = c;
                }
            });
            if (cfg) {
                this._configEditKey = cfg.id;
                this._configDeleteId = cfg.id;
                document.getElementById('attendanceConfigDeleteBtn').style.display = '';
                var deptSel = document.getElementById('attendanceConfigDept');
                if (deptSel) deptSel.value = cfg.department || '';
                var stSel = document.getElementById('attConfigSubTenantSelect');
                if (stSel) stSel.value = cfg.sub_tenant || '';
                document.getElementById('attendanceClockInEnabled').checked = cfg.clock_in_enabled !== false;
                document.getElementById('attendanceClockOutEnabled').checked = cfg.clock_out_enabled !== false;
                if (cfg.clock_in_time) {
                    document.getElementById('attendanceClockInTime').value = cfg.clock_in_time.substring(0, 5);
                } else {
                    document.getElementById('attendanceClockInTime').value = '09:00';
                }
                if (cfg.clock_out_time) {
                    document.getElementById('attendanceClockOutTime').value = cfg.clock_out_time.substring(0, 5);
                } else {
                    document.getElementById('attendanceClockOutTime').value = '18:00';
                }
                this._toggleClockIn();
                this._toggleClockOut();
            }
            this._loadAttConfigList();
        } catch (e) {
            console.warn('加载配置失败', e);
        }
    }

    async _loadAttConfigSubTenantSelect() {
        // 已合并到 _loadAttSubTenants 中
    }

    closeConfigModal() {
        var modal = document.getElementById('attendanceConfigModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    }

    async _loadAttSubTenants() {
        try {
            var resp = await fetch(OA_API_URL + '/attendance/attendance-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var json = await resp.json();
            var subTenants = json.sub_tenants || [];
            // 右侧子公司选择器
            var rightSel = document.getElementById('attConfigSubTenantSelect');
            if (rightSel) {
                rightSel.innerHTML = '<option value="">请选择子公司</option>';
                subTenants.forEach(function (st) {
                    var opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = (st.short_name || st.name) + '（' + (st.tenant_type || '公司') + '）';
                    rightSel.appendChild(opt);
                });
            }
        } catch (e) {
            console.warn('加载子公司列表失败', e);
        }
    }

    async _loadAttDepts() {
        var sel = document.getElementById('attendanceConfigDept');
        if (!sel) return;
        try {
            var resp = await fetch(OA_API_URL + '/approval/org_departments/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var data = await resp.json();
            var depts = data.results || [];
            var tree = {};
            depts.forEach(function (d) {
                var pid = d.parent_id != null ? d.parent_id : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });
            var html = '<option value="">集团默认配置</option>';
            var walk = function (pid, depth) {
                var children = tree[pid] || [];
                children.forEach(function (d) {
                    var prefix = '';
                    for (var j = 0; j < depth; j++) prefix += '—— ';
                    var companyIcon = d.department_type === 'company' ? ' ✈' : '';
                    html += '<option value="' + d.id + '">' + prefix + attendanceApp._escape(d.name) + companyIcon + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            if (!tree[0] || !tree[0].length) {
                var allIds = {};
                depts.forEach(function (d) { allIds[d.id] = true; });
                var roots = depts.filter(function (d) { return !allIds[d.parent_id]; });
                if (roots.length) {
                    html = '<option value="">集团默认配置</option>';
                    var renderFlat = function (items, depth) {
                        items.forEach(function (d) {
                            var prefix = '';
                            for (var j = 0; j < depth; j++) prefix += '—— ';
                            var companyIcon = d.department_type === 'company' ? ' ✈' : '';
                            html += '<option value="' + d.id + '">' + prefix + attendanceApp._escape(d.name) + companyIcon + '</option>';
                            var kids = tree[d.id] || [];
                            renderFlat(kids, depth + 1);
                        });
                    };
                    renderFlat(roots, 0);
                }
            }
            sel.innerHTML = html;
        } catch (e) {
            console.warn('加载部门列表失败', e);
        }
    }

    async _loadAttConfigList() {
        var container = document.getElementById('attendanceConfigList');
        if (!container) return;
        try {
            var resp = await fetch(OA_API_URL + '/attendance/attendance-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var json = await resp.json();
            var configs = json.results || [];
            var self = this;
            // 根据当前选中的类型过滤
            var filterType = this._configAttType || 'global';
            if (!configs.length) {
                container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 0;">暂无配置</div>';
                return;
            }
            container.innerHTML = configs.map(function (c) {
                // 按类型过滤
                if (filterType === 'global' && (c.sub_tenant || c.department)) return '';
                if (filterType === 'sub_tenant' && (!c.sub_tenant || c.department)) return '';
                if (filterType === 'department' && !c.department) return '';
                var label = c.department_name || c.sub_tenant_name || '集团默认';
                var typeTag = '';
                if (c.department) typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#f0f9eb;color:#67c23a;margin-left:4px;">部门</span>';
                else if (c.sub_tenant) typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#fef3e0;color:#e6a23c;margin-left:4px;">子公司</span>';
                else typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#e3f2fd;color:#409eff;margin-left:4px;">集团</span>';
                var sel = self._configEditKey && c.id === self._configEditKey ? ' style="background:#e8f4fd;font-weight:600;"' : '';
                return '<div class="config-list-item"' + sel + ' onclick="attendanceApp._editAttConfig(' + c.id + ')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
                    + '<span><i class="fas fa-clock" style="color:var(--primary-color,#409eff);margin-right:4px;"></i>' + self._escape(label) + typeTag + '</span></div>';
            }).join('');
        } catch (e) {
            console.warn('加载考勤配置列表失败', e);
        }
    }

    async _editAttConfig(configId) {
        try {
            var resp = await fetch(OA_API_URL + '/attendance/attendance-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var json = await resp.json();
            var configs = json.results || [];
            var cfg = null;
            configs.forEach(function (c) { if (c.id === configId) cfg = c; });
            if (!cfg) return;
            this._configEditKey = configId;
            this._configDeleteId = configId;
            // 根据配置类型激活对应类型卡片
            var cardType = 'global';
            if (cfg.sub_tenant && !cfg.department) cardType = 'sub_tenant';
            else if (cfg.department) cardType = 'department';
            this._configAttType = cardType;
            document.getElementById('attConfigType').value = cardType;
            document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
            var card = document.querySelector('.config-type-card[data-att-type="' + cardType + '"]');
            if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
            document.getElementById('attConfigSubTenantRow').style.display = cardType === 'sub_tenant' ? 'block' : 'none';
            document.getElementById('attConfigDeptRow').style.display = cardType === 'department' ? 'block' : 'none';
            document.getElementById('attendanceConfigEmpty').style.display = 'none';
            document.getElementById('attendanceConfigForm').style.display = 'block';
            document.getElementById('attendanceConfigFooter').style.display = 'flex';
            document.getElementById('attendanceConfigDeleteBtn').style.display = '';
            var deptSel = document.getElementById('attendanceConfigDept');
            if (deptSel) deptSel.value = cfg.department || '';
            var stSel = document.getElementById('attConfigSubTenantSelect');
            if (stSel) stSel.value = cfg.sub_tenant || '';
            document.getElementById('attendanceClockInEnabled').checked = cfg.clock_in_enabled !== false;
            document.getElementById('attendanceClockOutEnabled').checked = cfg.clock_out_enabled !== false;
            if (cfg.clock_in_time) {
                document.getElementById('attendanceClockInTime').value = cfg.clock_in_time.substring(0, 5);
            } else {
                document.getElementById('attendanceClockInTime').value = '09:00';
            }
            if (cfg.clock_out_time) {
                document.getElementById('attendanceClockOutTime').value = cfg.clock_out_time.substring(0, 5);
            } else {
                document.getElementById('attendanceClockOutTime').value = '18:00';
            }
            this._toggleClockIn();
            this._toggleClockOut();
            this._loadAttConfigList();
        } catch (e) {
            console.warn('加载考勤配置失败', e);
        }
    }

    _onConfigSubTenantChange() {
        this._loadAttConfigList();
    }

    _onAttConfigSubTenantChange() {
        var val = document.getElementById('attConfigSubTenantSelect').value;
        if (!val) return;
        // Switch type card without resetting to existing config
        this._configAttType = 'sub_tenant';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = 'sub_tenant';
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
        var card = document.querySelector('.config-type-card[data-att-type="sub_tenant"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('attConfigSubTenantRow').style.display = 'block';
        document.getElementById('attConfigDeptRow').style.display = 'none';
        document.getElementById('attendanceConfigForm').style.display = 'block';
        document.getElementById('attendanceConfigFooter').style.display = 'flex';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'none';
        document.getElementById('attConfigSubTenantSelect').value = val;
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        this._toggleClockIn();
        this._toggleClockOut();
        this._loadConfigForType('sub_tenant');
    }

    _onAttConfigDeptChange() {
        var val = document.getElementById('attendanceConfigDept').value;
        if (!val) return;
        this._configAttType = 'department';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = 'department';
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
        var card = document.querySelector('.config-type-card[data-att-type="department"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('attConfigSubTenantRow').style.display = 'none';
        document.getElementById('attConfigDeptRow').style.display = 'block';
        document.getElementById('attendanceConfigForm').style.display = 'block';
        document.getElementById('attendanceConfigFooter').style.display = 'flex';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'none';
        document.getElementById('attendanceConfigDept').value = val;
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        this._toggleClockIn();
        this._toggleClockOut();
        this._loadConfigForType('department');
    }

    _toggleClockIn() {
        var enabled = document.getElementById('attendanceClockInEnabled').checked;
        var group = document.getElementById('attendanceClockInTimeGroup');
        if (group) group.style.display = enabled ? 'block' : 'none';
    }

    _toggleClockOut() {
        var enabled = document.getElementById('attendanceClockOutEnabled').checked;
        var group = document.getElementById('attendanceClockOutTimeGroup');
        if (group) group.style.display = enabled ? 'block' : 'none';
    }

    async _saveConfig() {
        var attType = this._configAttType || document.getElementById('attConfigType').value || 'global';
        var deptId = document.getElementById('attendanceConfigDept').value;
        var subTenantId = document.getElementById('attConfigSubTenantSelect') ? document.getElementById('attConfigSubTenantSelect').value : '';
        var clockInEnabled = document.getElementById('attendanceClockInEnabled').checked;
        var clockOutEnabled = document.getElementById('attendanceClockOutEnabled').checked;
        var clockInTime = document.getElementById('attendanceClockInTime').value;
        var clockOutTime = document.getElementById('attendanceClockOutTime').value;
        var data = {
            clock_in_enabled: clockInEnabled,
            clock_out_enabled: clockOutEnabled,
        };
        if (clockInEnabled && clockInTime) data.clock_in_time = clockInTime;
        if (clockOutEnabled && clockOutTime) data.clock_out_time = clockOutTime;
        if (attType === 'department' && deptId) data.department_id = parseInt(deptId);
        if (attType === 'sub_tenant' && subTenantId) data.sub_tenant_id = parseInt(subTenantId);
        try {
            var resp = await fetch(OA_API_URL + '/attendance/save-attendance-config/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '保存失败');
            }
            this.showToast('考勤配置保存成功', false);
            this.closeConfigModal();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    }

    async _deleteConfig() {
        if (!this._configDeleteId) { this.showAlert('提示', '未找到配置ID'); return; }
        var confirmed = await this.showConfirmDialog('删除配置', '确定要删除当前考勤配置吗？删除后不可恢复。', 'danger');
        if (!confirmed) return;
        try {
            var resp = await fetch(OA_API_URL + '/attendance/delete-attendance-config/' + this._configDeleteId + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders(),
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.showToast('配置已删除', false);
            this._configDeleteId = null;
            this._configEditKey = null;
            document.getElementById('attendanceConfigForm').style.display = 'none';
            document.getElementById('attendanceConfigFooter').style.display = 'none';
            document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
            document.getElementById('attendanceConfigEmpty').style.display = 'block';
            await this._loadAttConfigList();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    }

    // ──────── 考勤日历 ────────

    _openCalendar() {
        this._calYear = new Date().getFullYear();
        this._calMonth = new Date().getMonth() + 1;
        this._renderCalendar();
        document.getElementById('attendanceCalendarModal').style.display = 'flex';
        setTimeout(function() {
            document.getElementById('attendanceCalendarModal').classList.add('show');
        }, 10);
    }

    _closeCalendar() {
        var modal = document.getElementById('attendanceCalendarModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    _calPrevMonth() {
        this._calMonth--;
        if (this._calMonth < 1) { this._calMonth = 12; this._calYear--; }
        this._renderCalendar();
    }

    _calNextMonth() {
        this._calMonth++;
        if (this._calMonth > 12) { this._calMonth = 1; this._calYear++; }
        this._renderCalendar();
    }

    async _renderCalendar() {
        var year = this._calYear, month = this._calMonth;
        document.getElementById('calYearMonth').textContent = year + '年' + month + '月';
        var grid = document.getElementById('calGrid');
        if (!grid) return;
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            var data = await this.apiGet(OA_API_URL + '/attendance/calendar-stats/?year=' + year + '&month=' + month);
            var days = data.days || [];
            var summary = data.summary || {};
            document.getElementById('calNormalCount').textContent = summary.normal || 0;
            document.getElementById('calLateCount').textContent = summary.late || 0;
            document.getElementById('calMissCount').textContent = summary.miss_clock || 0;
            document.getElementById('calAbsentCount').textContent = summary.absent || 0;
            var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            var html = '';
            weekDays.forEach(function(wd) {
                html += '<div style="font-size:12px;font-weight:600;color:var(--text-light,#909399);padding:6px 0;">' + wd + '</div>';
            });
            var firstDay = new Date(year, month - 1, 1).getDay();
            var dayMap = {};
            days.forEach(function(d) { dayMap[d.date] = d; });
            for (var e = 0; e < firstDay; e++) {
                html += '<div style="min-height:70px;"></div>';
            }
            for (var d = 1; d <= (summary.total || 30); d++) {
                var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                var info = dayMap[dateStr] || { day_status: 'none', day_label: '' };
                var status = info.day_status || 'none';
                var bgColor = '#fff';
                var textColor = 'var(--text-primary)';
                var dotColor = '';
                if (status === 'normal') { bgColor = '#f0f9eb'; dotColor = '#67c23a'; }
                else if (status === 'late') { bgColor = '#fdf6ec'; dotColor = '#e6a23c'; }
                else if (status === 'miss_clock') { bgColor = '#fef0f0'; dotColor = '#f56c6c'; }
                else if (status === 'absent') { bgColor = '#f5f5f5'; dotColor = '#909399'; textColor = '#bbb'; }
                else if (status === 'future') { bgColor = '#fafafa'; textColor = '#ccc'; }
                var tooltip = '';
                if (info.clock_in && info.clock_out) {
                    tooltip = '上班:' + (info.clock_in.time || '') + ' 下班:' + (info.clock_out.time || '');
                } else if (info.clock_in) {
                    tooltip = '上班:' + (info.clock_in.time || '') + ' 未下班打卡';
                } else if (info.clock_out) {
                    tooltip = '未上班打卡 下班:' + (info.clock_out.time || '');
                }
                var labelHtml = '<span style="font-weight:600;font-size:15px;">' + d + '</span>';
                if (dotColor) {
                    labelHtml += '<div style="width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin:2px auto 0;"></div>';
                }
                if (info.day_label) {
                    labelHtml += '<div style="font-size:9px;color:' + textColor + ';margin-top:1px;">' + info.day_label + '</div>';
                }
                html += '<div class="cal-cell cal-' + status + '" onclick="attendanceApp._showCalDayDetail(\'' + dateStr + '\')" title="' + this._escape(tooltip || dateStr) + '" style="min-height:68px;background:' + bgColor + ';border-radius:6px;padding:4px;text-align:center;cursor:pointer;transition:all 0.15s;border:1px solid transparent;' + (status === 'none' ? 'opacity:0.3;' : '') + '">' + labelHtml + '</div>';
            }
            grid.innerHTML = html;
        } catch (e) {
            console.error('加载考勤日历失败:', e);
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:#f56c6c;">加载失败</div>';
        }
    }

    async _showCalDayDetail(dateStr) {
        try {
            var data = await this.apiGet(OA_API_URL + '/attendance/calendar-day-detail/?date=' + dateStr);
            if (!data) return;
            var title = dateStr + ' 打卡详情';
            var body = '<div style="padding:8px 0;">';
            // Clock-in info
            var ci = data.clock_in;
            var co = data.clock_out;
            var statusMap = {'normal': '正常', 'late': '迟到', 'early_leave': '早退'};
            if (ci) {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f0f9eb;border-radius:8px;margin-bottom:8px;border-left:3px solid #67c23a;">'
                    + '<i class="fas fa-sign-in-alt" style="color:#52c41a;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">上班打卡</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">时间: ' + this._escape(ci.clock_time ? this._formatTime(ci.clock_time) : '') + '</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">状态: <span class="status-badge ' + (ci.status || 'normal') + '">' + (statusMap[ci.status] || ci.status || '正常') + '</span></div>'
                    + (ci.location ? '<div style="font-size:12px;color:#909399;">位置: ' + this._escape(ci.location) + '</div>' : '')
                    + '</div></div>';
            } else {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f5f5f5;border-radius:8px;margin-bottom:8px;border-left:3px solid #909399;color:#909399;">'
                    + '<i class="fas fa-sign-in-alt" style="color:#bbb;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">上班打卡</div><div style="font-size:13px;">未打卡</div></div></div>';
            }
            if (co) {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fef3e0;border-radius:8px;margin-bottom:8px;border-left:3px solid #e6a23c;">'
                    + '<i class="fas fa-sign-out-alt" style="color:#e6a23c;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">下班打卡</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">时间: ' + this._escape(co.clock_time ? this._formatTime(co.clock_time) : '') + '</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">状态: <span class="status-badge ' + (co.status || 'normal') + '">' + (statusMap[co.status] || co.status || '正常') + '</span></div>'
                    + (co.location ? '<div style="font-size:12px;color:#909399;">位置: ' + this._escape(co.location) + '</div>' : '')
                    + '</div></div>';
            } else {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f5f5f5;border-radius:8px;margin-bottom:8px;border-left:3px solid #909399;color:#909399;">'
                    + '<i class="fas fa-sign-out-alt" style="color:#bbb;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">下班打卡</div><div style="font-size:13px;">未打卡</div></div></div>';
            }
            // Overtime info
            if (data.overtime) {
                var ot = data.overtime;
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f3e8ff;border-radius:8px;margin-bottom:8px;border-left:3px solid #9b59b6;">'
                    + '<i class="fas fa-clock" style="color:#9b59b6;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">加班</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">时数: ' + (ot.duration || 0) + ' 小时</div>'
                    + (ot.content ? '<div style="font-size:12px;color:#606266;margin-top:2px;">内容: ' + this._escape(ot.content) + '</div>' : '')
                    + (ot.title ? '<div style="font-size:12px;color:#909399;margin-top:2px;">审批: ' + this._escape(ot.title) + '</div>' : '')
                    + '</div></div>';
            }
            body += '</div>';
            // Show in a temporary dialog
            this.showAlert(title, body);
        } catch (e) {
            console.error('加载日期详情失败:', e);
        }
    }

}


// // 全局初始化
// let attendanceApp = null;
//
// // 确保在 DOM 加载完成后初始化 attendanceApp
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', () => {
//         attendanceApp = new AttendanceApp();
//         window.attendanceApp = attendanceApp;
//     });
// } else {
//     // 如果 DOM 已经加载完成，直接初始化
//     attendanceApp = new AttendanceApp();
//     window.attendanceApp = attendanceApp;
// }
