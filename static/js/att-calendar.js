// static/js/att-calendar.js - 考勤日历
// 说明：本文件为 AttendanceApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(AttendanceApp.prototype, {

    // ──────── 考勤日历 ────────

    _openCalendar() {
        this._calYear = new Date().getFullYear();
        this._calMonth = new Date().getMonth() + 1;
        this._calUserId = '';
        this._loadCalendarMembers();
        this._renderCalendar();
        document.getElementById('attendanceCalendarModal').style.display = 'flex';
        setTimeout(function() {
            document.getElementById('attendanceCalendarModal').classList.add('show');
        }, 10);
    },

    _loadCalendarMembers() {
        var btn = document.getElementById('calMemberBtn');
        var dd = document.getElementById('calMemberDropdown');
        if (!btn || !dd) return;
        btn.style.display = 'none';
        dd.style.display = 'none';
        dd.innerHTML = '';
        if (this._calMembersLoading) return;
        this._calMembersLoading = true;
        var self = this;
        var selfId = parseInt(localStorage.getItem('user_id'));
        fetch(OA_API_URL + '/attendance/members/', {headers: TokenManager.getHeaders()})
            .then(function(r) { return r.ok ? r.json() : {results: []}; })
            .then(function(data) {
                var list = data.results || [];
                // 本人信息优先取接口返回的 self，兜底从成员列表匹配，避免头像/职位/部门为空
                var selfItem = data.self || list.filter(function(u) { return u.id === selfId; })[0] || {};
                var others = list.filter(function(u) { return u.id !== selfId; });
                if (!others.length) return;
                var items = [{
                    id: '',
                    name: '本人',
                    position: selfItem.position || '',
                    department_name: selfItem.department_name || '',
                    avatar: selfItem.avatar || ''
                }].concat(others);
                self._calMembers = items;
                dd.innerHTML = '<div style="position:sticky;top:0;z-index:2;background:var(--bg-primary,#fff);padding:8px;border-bottom:1px solid var(--border-color,#ebeef5);">'
                    + '<div style="position:relative;"><i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:#c0c4cc;"></i>'
                    + '<input id="calMemberSearchInput" type="text" placeholder="搜索姓名、职位或部门..." oninput="attendanceApp._filterCalMembers(this.value)" style="width:100%;box-sizing:border-box;padding:7px 10px 7px 28px;border:1px solid var(--border-color,#dcdfe6);border-radius:6px;font-size:12px;outline:none;background:var(--bg-primary,#fff);color:var(--text-primary,#303133);"></div>'
                    + '</div><div id="calMemberList" style="padding:6px 0;"></div>';
                self._renderCalMemberList('');
                self._setCalMemberButton('');
                btn.style.display = 'inline-flex';
            })
            .catch(function() {})
            .then(function() { self._calMembersLoading = false; });
    },

    _renderCalMemberList(keyword) {
        var listEl = document.getElementById('calMemberList');
        if (!listEl) return;
        var kw = String(keyword || '').trim().toLowerCase();
        var items = this._calMembers || [];
        var filtered = kw ? items.filter(function(u) {
            return [u.name, u.username, u.position, u.department_name].some(function(v) {
                return String(v || '').toLowerCase().indexOf(kw) !== -1;
            });
        }) : items;
        if (!filtered.length) {
            listEl.innerHTML = '<div style="padding:18px 12px;text-align:center;font-size:12px;color:#909399;">未找到匹配成员</div>';
            return;
        }
        var self = this;
        listEl.innerHTML = filtered.map(function(u) {
            var uid = u.id === '' ? '' : String(u.id);
            var avatar = u.avatar || '/static/images/default-avatar.png';
            var meta = [u.position, u.department_name].filter(Boolean).join(' · ') || '—';
            return '<div data-uid="' + uid + '" style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border-color,#f0f2f5);">'
                + '<img src="' + avatar + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#f5f7fa;">'
                + '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;color:var(--text-primary,#303133);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(u.name || u.username || '') + '</div>'
                + '<div style="font-size:11px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(meta) + '</div></div>'
                + '</div>';
        }).join('');
        listEl.querySelectorAll('[data-uid]').forEach(function(it) {
            it.addEventListener('click', function() { self._pickCalMember(it.getAttribute('data-uid')); });
        });
    },

    _filterCalMembers(keyword) {
        this._renderCalMemberList(keyword);
    },

    _setCalMemberButton(uid) {
        var btn = document.getElementById('calMemberBtn');
        var avatarEl = document.getElementById('calMemberBtnAvatar');
        var textEl = document.getElementById('calMemberBtnText');
        if (!btn || !avatarEl || !textEl) return;
        var list = this._calMembers || [];
        var item = null;
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(uid)) { item = list[i]; break; }
        }
        if (!item) item = {name: '本人', position: '', department_name: '', avatar: ''};
        avatarEl.src = item.avatar || '/static/images/default-avatar.png';
        var meta = [item.position, item.department_name].filter(Boolean).join(' · ');
        textEl.textContent = (item.name || '本人') + (meta ? '（' + meta + '）' : '');
    },

    _toggleCalMemberDropdown(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var dd = document.getElementById('calMemberDropdown');
        if (!dd) return;
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        if (dd.style.display === 'block') {
            var input = document.getElementById('calMemberSearchInput');
            if (input) setTimeout(function() { input.focus(); }, 0);
        }
    },

    _pickCalMember(uid) {
        var dd = document.getElementById('calMemberDropdown');
        if (dd) dd.style.display = 'none';
        this._calUserId = uid ? parseInt(uid) : '';
        this._setCalMemberButton(this._calUserId);
        this._renderCalendar();
    },

    _closeCalendar() {
        var modal = document.getElementById('attendanceCalendarModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    },

    _calPrevMonth() {
        this._calMonth--;
        if (this._calMonth < 1) { this._calMonth = 12; this._calYear--; }
        this._renderCalendar();
    },

    _calNextMonth() {
        this._calMonth++;
        if (this._calMonth > 12) { this._calMonth = 1; this._calYear++; }
        this._renderCalendar();
    },

    async _renderCalendar() {
        var year = this._calYear, month = this._calMonth;
        document.getElementById('calYearMonth').textContent = year + '年' + month + '月';
        var grid = document.getElementById('calGrid');
        if (!grid) return;
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            var url = OA_API_URL + '/attendance/calendar-stats/?year=' + year + '&month=' + month;
            if (this._calUserId) url += '&user_id=' + encodeURIComponent(this._calUserId);
            var data = await this.apiGet(url);
            var days = data.days || [];
            var summary = data.summary || {};
            document.getElementById('calNormalCount').textContent = summary.normal || 0;
            document.getElementById('calLateCount').textContent = summary.late || 0;
            document.getElementById('calMissCount').textContent = summary.miss_clock || 0;
            document.getElementById('calAbsentCount').textContent = summary.absent || 0;
            document.getElementById('calLeaveCount').textContent = summary.leave || 0;
            var tripEl = document.getElementById('calTripCount');
            if (tripEl) tripEl.textContent = summary.trip || 0;
            document.getElementById('calRestCount').textContent = summary.rest || 0;
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
                else if (status === 'leave') { bgColor = '#ecf5ff'; dotColor = '#409eff'; }
                else if (status === 'trip') { bgColor = '#f3e8ff'; dotColor = '#9b59b6'; }
                else if (status === 'rest') { bgColor = '#f0f2f5'; dotColor = '#a0a4ab'; textColor = '#999'; }
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
    },

    async _showCalDayDetail(dateStr) {
        try {
            var url = OA_API_URL + '/attendance/calendar-day-detail/?date=' + dateStr;
            if (this._calUserId) url += '&user_id=' + encodeURIComponent(this._calUserId);
            var data = await this.apiGet(url);
            if (!data) return;
            var title = (data.user_name ? data.user_name + ' · ' : '') + dateStr + ' 考勤详情';
            var body = '<div style="padding:8px 0;">';
            // Clock-in info
            var ci = data.clock_in;
            var co = data.clock_out;
            var statusMap = {'normal': '正常', 'late': '迟到', 'early_leave': '早退', 'location_abnormal': '地点异常'};
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
            if (data.leave) {
                var lv = data.leave;
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#ecf5ff;border-radius:8px;margin-bottom:8px;border-left:3px solid #409eff;">'
                    + '<i class="fas fa-calendar-check" style="color:#409eff;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">请假（' + this._escape(lv.type || '请假') + '）</div>'
                    + (lv.title ? '<div style="font-size:12px;color:#909399;">审批：' + this._escape(lv.title) + '</div>' : '')
                    + '</div></div>';
            }
            if (data.trip) {
                var tp = data.trip;
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f3e8ff;border-radius:8px;margin-bottom:8px;border-left:3px solid #9b59b6;">'
                    + '<i class="fas fa-plane" style="color:#9b59b6;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">出差' + (tp.destination ? '（' + this._escape(tp.destination) + '）' : '') + '</div>'
                    + (tp.title ? '<div style="font-size:12px;color:#909399;">审批：' + this._escape(tp.title) + '</div>' : '')
                    + '</div></div>';
            }
            body += '</div>';
            // Show in a temporary dialog
            this.showAlert(title, body);
        } catch (e) {
            console.error('加载日期详情失败:', e);
        }
    },
    });
})();
