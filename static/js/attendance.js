// static/js/attendance.js - 考勤打卡

// 说明：拍照/定位/补卡、记录详情/申诉/导出、配置与地图、考勤日历已拆分到 att-*.js；公共弹窗与转义由 app-common.js 提供。

const OA_API_URL = '/api/oa';

class AttendanceApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this._searchTimer = null;
        this._recordsReqToken = 0;
        this._initTimer = null;
        this.chat_login_url = '/login/';
        // 用户端打卡范围地图状态
        this._myGeoRanges = [];
        this._myGeoPos = null;
        this._myGeoBd09 = null;       // 我的位置换算成 BD09 后的缓存（避免每次重绘都请求后端）
        this._myGeoInsideName = '';
        this._myGeoFocusIndex = -1;   // 底部标识点选后锁定的打卡点，-1 表示自动框选全部
        this._myGeoFullscreenOn = false;
        this.state = { start: '', end: '', loading: false, userId: null, userName: '' };
        // 「显示考勤打卡范围配置」开关行是否暴露：由 .env 的 ATTENDANCE_GEO_VISIBLE_SWITCH
        // 经 settings.py → 模板块 下发（默认 false，即该行整体隐藏）
        this._geoVisibleSwitchEnabled = !!(window.ATT_GEO_VISIBLE_SWITCH);

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
        // 打印权限：无权限则隐藏打印按钮并提示
        if (window.WatermarkManager && WatermarkManager.applyPrintPermission) {
            WatermarkManager.applyPrintPermission();
        }


        if (!this.state.start || !this.state.end) this.initRange();
        document.getElementById('vDateFrom').value = this.state.start;
        document.getElementById('vDateTo').value = this.state.end;

        // 切换日期范围后自动刷新
        document.getElementById('vDateFrom').addEventListener('change', (event) => {
            // 1. 通过 event.target.value 获取 DOM 元素更改后的值
            const newValue = event.target.value;
            // 2. 更新 state
            this.state.start = newValue;
            // 3. 触发加载（回到第一页）
            this.loadRecords(1);
        });

        document.getElementById('vDateTo').addEventListener('change', (event) => {
            // 1. 通过 event.target.value 获取 DOM 元素更改后的值
            const newValue = event.target.value;
            // 2. 更新 state
            this.state.end = newValue;
            // 3. 触发加载（回到第一页）
            this.loadRecords(1);
        });


        // 点击空白处关闭考勤日历的成员下拉
        if (!this._calDropBound) {
            this._calDropBound = true;
            document.addEventListener('click', function(e) {
                var dd = document.getElementById('calMemberDropdown');
                var btn = document.getElementById('calMemberBtn');
                if (!dd || dd.style.display === 'none') return;
                if (!e.target.closest('#calMemberBtn') && !e.target.closest('#calMemberDropdown')) {
                    dd.style.display = 'none';
                }
                if (btn && e.target.closest('#calMemberBtn')) return;
            });
        }

        this.updateClock();
        this._initTimer = setInterval(() => this.updateClock(), 1000);
        this._bindViewportRelayout();
        // 今日状态/统计/记录并行加载，缩短首屏等待时间
        await Promise.all([this.loadToday(), this.loadStats(), this.loadRecords()]);

        // 管理功能按钮：管理员/超级管理员；企业/部门过滤：仅超级管理员
        var userType = localStorage.getItem('user_type');
        if (userType === 'admin' || userType === 'super_admin') {
            var exportBtn = document.getElementById('attendanceExportBtn');
            var printBtn = document.getElementById('attendancePrintBtn');
            var configBtn = document.getElementById('attendanceConfigBtn');
            if (exportBtn) { exportBtn.style.display = ''; exportBtn.style.opacity = '0.4'; }
            if (printBtn) { printBtn.style.display = ''; printBtn.style.opacity = '0.4'; }
            if (configBtn) configBtn.style.display = 'inline-flex';
            if (userType === 'super_admin') {
                var tenantFilter = document.getElementById('attendanceFilterTenant');
                var deptFilter = document.getElementById('attendanceFilterDepartment');
                if (tenantFilter) tenantFilter.style.display = '';
                if (deptFilter) deptFilter.style.display = '';
                this._loadFilterTenants();
                // Bind dept filter change
                if (deptFilter) {
                    deptFilter.addEventListener('change', function() {
                        attendanceApp.loadRecords(1);
                    });
                }
            }
        }
    }

    // 移动端/PWA 上地图画布尺寸会在这些时机失效（旋转屏幕、下拉/收起地址栏、从后台切回、
    // iOS 前进后退缓存恢复），需要重算，否则地图会显示为空白或错位。
    _bindViewportRelayout() {
        if (this._viewportBound) return;
        this._viewportBound = true;
        var self = this;
        var relayout = function () {
            [self._myGeoMap, self._baiduMap].forEach(function (m) {
                if (m && m.checkResize) { try { m.checkResize(); } catch (e) { /* 忽略 */ } }
            });
        };
        window.addEventListener('resize', relayout);
        window.addEventListener('orientationchange', function () { setTimeout(relayout, 250); });
        window.addEventListener('pageshow', function () {
            setTimeout(function () {
                relayout();
                // iOS 前进后退缓存恢复时地图库可能没注册成功 → 重新尝试，别一直空着
                var card = document.getElementById('myGeoCard');
                if (card && card.style.display !== 'none' && !self._myGeoMap) {
                    var a = self._myGeoMapArgs || {};
                    self._ensureMyGeoMap(a.ranges || [], a.pos || null);
                }
            }, 150);
        });
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                setTimeout(relayout, 120);
                setTimeout(function () { self._retryPendingMaps(); }, 400);
            }
        });
        // 手机网络抖动很常见：恢复联网后自动再试一次（之前只会在加载失败时一直显示降级提示）
        window.addEventListener('online', function () {
            setTimeout(function () { self._retryPendingMaps(); }, 500);
        });
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

    // multipart 上传（拍照打卡）：不能带 Content-Type，交给浏览器生成 boundary
    async apiPostForm(url, formData) {
        var headers = {};
        var token = localStorage.getItem('access_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;
        var resp = await fetch(url, { method: 'POST', headers: headers, body: formData });
        if (!resp.ok) {
            if (resp.status === 401) {
                this.showToast('登录已过期，请重新登录', true);
                this.handleAuthError();
                return;
            }
            var err = await resp.json().catch(function () { return {}; });
            throw new Error(err.error || '请求失败');
        }
        var raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    _clockFormData(data, photo) {
        var fd = new FormData();
        Object.keys(data).forEach(function (k) {
            var v = data[k];
            if (v === undefined || v === null || v === '') return;
            fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
        });
        fd.append('photo', photo, 'clock_photo.jpg');
        // 照片上烧录的时间戳（ISO 8601），后端以此作为打卡时间
        if (photo._takenAt) fd.append('photo_taken_at', photo._takenAt);
        // 相机设备信息（用于审计与虚拟摄像头识别）
        if (photo._cameraInfo) fd.append('camera_info', JSON.stringify(photo._cameraInfo));
        // 人脸截图 + 人脸检测元数据（供后续人脸识别数据储备与质量审计）
        if (photo._faceBlob) fd.append('face_photo', photo._faceBlob, 'clock_face.jpg');
        if (photo._faceMeta) fd.append('face_meta', JSON.stringify(photo._faceMeta));
        return fd;
    }

    async loadToday() {
        try {
            const data = await this.apiGet(OA_API_URL + '/attendance/today/');
            this.loadGeoHint();
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

            var clockOutCount = data.clock_out_count || 0;
            var clockOutLimit = data.clock_out_limit || 3;
            var shiftType = data.shift_type || 'day';
            var isNight = shiftType === 'night';
            var canClockOut = data.has_clock_in || data.has_pending_clock_out;
            if (data.has_clock_out) {
                clockOutBtn.classList.add('clocked');
                if (clockOutCount >= clockOutLimit) {
                    clockOutBtn.disabled = true;
                    clockOutBtn.innerHTML = '<i class="fas fa-check-circle"></i> 已打' + clockOutCount + '次（上限）';
                } else {
                    clockOutBtn.disabled = false;
                    clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡（' + clockOutCount + '/' + clockOutLimit + '）';
                }
            } else if (canClockOut) {
                clockOutBtn.disabled = false;
                clockOutBtn.classList.remove('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            } else {
                clockOutBtn.disabled = true;
                clockOutBtn.classList.remove('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            }

            if (data.has_clock_out) {
                statusEl.textContent = '✅ ' + (isNight ? '夜班' : '今日') + '考勤已完成';
            } else if (canClockOut) {
                statusEl.textContent = '⏳ ' + (isNight ? '夜班' : '') + '已上班打卡，等待下班打卡';
            } else {
                statusEl.textContent = '📋 今日尚未打卡';
            }

            var shiftBadge = document.getElementById('todayShiftBadge');
            if (shiftBadge) {
                shiftBadge.style.display = 'inline-flex';
                shiftBadge.textContent = isNight ? '🌙 夜班' : '☀ 白班';
                shiftBadge.className = 'shift-badge ' + shiftType;
            }

            // 补卡与下班打卡次数提示
            this._makeupUsed = data.makeup_used || 0;
            this._makeupAllowance = (data.makeup_allowance != null) ? data.makeup_allowance : 3;
            this._makeupEnabled = !!data.makeup_enabled;
            var makeupInfoEl = document.getElementById('todayMakeupInfo');
            if (makeupInfoEl) {
                if (data.makeup_enabled) {
                    var coInfo = clockOutCount > 0 ? ' · 今日下班打卡 ' + clockOutCount + '/' + clockOutLimit + ' 次' : '';
                    makeupInfoEl.innerHTML = '<i class="fas fa-edit"></i> 本月补卡剩余 <b>' + (data.makeup_remaining || 0) + '</b> 次' + coInfo;
                } else {
                    makeupInfoEl.innerHTML = '<i class="fas fa-edit"></i> 未开启补卡功能';
                }
            }
            var makeupBtn = document.getElementById('makeupBtn');
            if (makeupBtn) makeupBtn.style.display = data.makeup_enabled ? '' : 'none';

            // 拍照打卡：集团开启后，打卡前会要求抓拍带时间戳的照片
            this._photoClockEnabled = data.photo_clock_enabled === true;
            if (statusEl && this._photoClockEnabled && !data.has_clock_out) {
                statusEl.textContent += ' · 📷 需拍照打卡';
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
        var token = ++this._recordsReqToken;
        // 只更新表格区域，不影响上方打卡按钮的正常使用
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:left;padding:36px;color:#909399;">'
            + '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>正在加载打卡记录...</td></tr>';
        try {
            let url = OA_API_URL + '/attendance/?page=' + page + '&page_size=' + this.pageSize;
            if (this.searchKeyword) url += '&search=' + encodeURIComponent(this.searchKeyword);
            if (this.state.start && this.state.end) url += '&start=' + encodeURIComponent(this.state.start) + '&end=' + encodeURIComponent(this.state.end)
            var tenantId = document.getElementById('attendanceFilterTenant') ? document.getElementById('attendanceFilterTenant').value : '';
            var deptId = document.getElementById('attendanceFilterDepartment') ? document.getElementById('attendanceFilterDepartment').value : '';
            var clockType = document.getElementById('attendanceFilterClockType') ? document.getElementById('attendanceFilterClockType').value : '';
            var statusVal = document.getElementById('attendanceFilterStatus') ? document.getElementById('attendanceFilterStatus').value : '';
            if (tenantId) url += '&tenant_id=' + tenantId;
            if (deptId) url += '&org_dept_id=' + deptId;
            if (clockType) url += '&clock_type=' + clockType;
            if (statusVal) url += '&status=' + statusVal;
            const data = await this.apiGet(url);
            if (token !== this._recordsReqToken) return; // 丢弃过期响应（快速切换筛选时）
            this._renderRecords(data, tbody);
            this._renderPagination(data, pagination);
        } catch (e) {
            if (token !== this._recordsReqToken) return;
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:left;padding:40px;color:#909399;">加载失败: ' + this._escape(e.message) + '</td></tr>';
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
        this._rowCache = {};
        rows.forEach(function(r) { attendanceApp._rowCache[String(r.id)] = r; });
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:left;padding:40px;color:#909399;">暂无打卡记录</td></tr>';
            this._updateExportPrintButtons();
            return;
        }
        const statusMap = {
            'normal': '正常', 'late': '迟到', 'early_leave': '早退',
            'missing_clock': '缺卡', 'absent': '缺勤', 'rest': '休息',
            'location_abnormal': '地点异常', 'leave': '请假', 'trip': '出差'
        };
        const appealable = {late: 1, early_leave: 1, missing_clock: 1, absent: 1, location_abnormal: 1};
        const selfId = parseInt(localStorage.getItem('user_id'));
        const defaultAvatar = '/static/images/default-avatar.png';
        tbody.innerHTML = rows.map(function(r) {
            const st = r.status || 'normal';
            const avatar = r.avatar_url || defaultAvatar;
            const key = String(r.id);
            const checked = attendanceApp._selectedRecordIds && attendanceApp._selectedRecordIds.has(key) ? 'checked' : '';
            const canAppeal = (Number(r.user) === selfId) && appealable[st];
            const appealBtn = canAppeal
                ? '<button class="action-btn" onclick="event.stopPropagation();attendanceApp.openAppeal(\'' + (r.date || '') + '\',\'' + (r.clock_type || 'day') + '\',\'' + st + '\',' + Number(r.user) + ')" title="申诉/补卡申请" style="color:#e6a23c;"><i class="fas fa-balance-scale"></i></button>'
                : '';
            return '<tr style="cursor:pointer;">'
                + '<td><input type="checkbox" class="record-cb" data-id="' + key + '" ' + checked + ' onchange="event.stopPropagation();attendanceApp._toggleRecord(this.dataset.id, this.checked)"></td>'
                + '<td><div style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">'
                + '<span>' + attendanceApp._escape(r.user_name || '') + '</span></div></td>'
                + '<td>' + attendanceApp._escape(r.department_name || '-') + '</td>'
                + '<td>' + (r.date || '-') + '</td>'
                + '<td><span class="badge badge-info">' + attendanceApp._escape(r.clock_type_display || r.clock_type) + '</span></td>'
                + '<td>' + (r.clock_time ? attendanceApp._formatTime(r.clock_time) : '-')
                + (r.photo_compressed_url ? ' <i class="fas fa-camera" style="color:#16a085;font-size:11px;" title="已拍照打卡"></i>' : '') + '</td>'
                + '<td><span class="status-badge ' + st + '">' + attendanceApp._escape(r.status_display || statusMap[st] || st) + '</span></td>'
                + '<td onclick="event.stopPropagation();attendanceApp.showDetail(\'' + key + '\')">' + attendanceApp._escape(r.location || '-') + (r.bd09_latitude ? ' <i class="fas fa-map-marker-alt" style="color:#f56c6c;font-size:11px;" title="已标记地图位置"></i>' : '') + '</td>'
                + '<td>' + attendanceApp._escape(r.device || '-') + '</td>'
                + '<td style="white-space:nowrap;"><button class="action-btn" onclick="event.stopPropagation();attendanceApp.showDetail(\'' + key + '\')" title="详情"><i class="fas fa-eye"></i></button>'
                + appealBtn + '</td></tr>';
        }).join('');
    }

    async clockIn() {
        const btn = document.getElementById('clockInBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-location-crosshairs fa-spin"></i> 正在获取定位...';
        try {
            var loc = await this._fetchLocation();
            if (loc.abort) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡'; return; }
            var info = this._getClientInfo();
            var data = { device: this._getDeviceInfo(), user_agent: info.userAgent };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;

            var photo = null;
            if (this._photoClockEnabled) {
                btn.innerHTML = '<i class="fas fa-camera"></i> 请拍摄打卡照片...';
                photo = await this._captureClockPhoto(data.location || '');
                if (!photo) {
                    btn.disabled = false;
                    btn.classList.remove('clocked');
                    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡';
                    this.showToast('已取消拍照，未记录本次打卡', false);
                    return;
                }
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传打卡照片...';
            } else {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
            }

            var result = photo
                ? await this.apiPostForm(OA_API_URL + '/attendance/clock-in/', this._clockFormData(data, photo))
                : await this.apiPost(OA_API_URL + '/attendance/clock-in/', data);
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
            // 必须把后端原因展示出来：指定区域打卡未通过（不在范围内/无定位）时会返回具体说明
            this.showToast(e.message || '打卡失败', true);
            console.error('打卡失败:', e);
        }
    }

    async clockOut() {
        const btn = document.getElementById('clockOutBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-location-crosshairs fa-spin"></i> 正在获取定位...';
        try {
            var loc = await this._fetchLocation();
            if (loc.abort) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡'; return; }
            var info = this._getClientInfo();
            var data = { device: this._getDeviceInfo(), user_agent: info.userAgent };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;

            var photo = null;
            if (this._photoClockEnabled) {
                btn.innerHTML = '<i class="fas fa-camera"></i> 请拍摄打卡照片...';
                photo = await this._captureClockPhoto(data.location || '');
                if (!photo) {
                    btn.disabled = false;
                    btn.classList.remove('clocked');
                    btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
                    this.showToast('已取消拍照，未记录本次打卡', false);
                    return;
                }
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传打卡照片...';
            } else {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
            }

            var result = photo
                ? await this.apiPostForm(OA_API_URL + '/attendance/clock-out/', this._clockFormData(data, photo))
                : await this.apiPost(OA_API_URL + '/attendance/clock-out/', data);
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
            this.showToast(e.message || '打卡失败', true);
            console.error('打卡失败:', e);
        }
    }

    search() {
        const el = document.getElementById('attendanceSearch');
        this.searchKeyword = el ? el.value.trim() : '';
        // 输入防抖：避免每敲一个字都请求一次（远程/大企业数据加载更顺畅）
        clearTimeout(this._searchTimer);
        var self = this;
        this._searchTimer = setTimeout(function() { self.loadRecords(1); }, 350);
    }

    onFilterStatusChange() {
        this.loadRecords(1);
    }

    fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

    initRange() {
        // 默认展示近 7 天，避免首次加载一次生成整月所有成员的虚拟考勤行导致卡顿
        var end = new Date(), start = new Date();
        start.setDate(end.getDate() - 6);
        this.state.end = this.fmtDate(end); this.state.start = this.fmtDate(start);
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
                var id = cb.dataset.id;
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

    // ==================== 提示 / 确认 / Toast 由 AppCommon 提供（见文件末尾 mixin） ====================

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
        var clockTypeFilter = document.getElementById('attendanceFilterClockType');
        if (clockTypeFilter) clockTypeFilter.value = '';
        var statusFilter = document.getElementById('attendanceFilterStatus');
        if (statusFilter) statusFilter.value = '';
        this.initRange()
        document.getElementById('vDateFrom').value = this.state.start;
        document.getElementById('vDateTo').value = this.state.end;

        this.loadRecords(1);
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

// 公共方法（AppCommon）：转义 / 鉴权跳转 / 提示弹窗
AppCommon.mixin(AttendanceApp, {
    "escapeHtml": "escapeHtml",
    "_escape": "escapeHtml",
    "handleAuthError": "handleAuthError",
    "showAlert": "showAlert",
    "showConfirmDialog": "showConfirmDialog",
    "showToast": "showToast"
});
