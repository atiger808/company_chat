// static/js/work-calendar.js - 工作日历
const WC_API = '/api/oa/work-calendar';

class WorkCalendarApp {
    constructor() {
        this.chat_login_url = '/login/';
        this._year = new Date().getFullYear();
        this._month = new Date().getMonth() + 1;
        this._isSuperAdmin = localStorage.getItem('user_type') === 'super_admin';
        this._targetUserId = null;
        this._rangeDays = '30';
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
            const mbar = document.getElementById('wcMemberBar');
            if (mbar) { mbar.style.display = 'flex'; }
        }
        this.loadMonth(this._year, this._month);
        this._loadAllCharts();
    }

    _targetParam() {
        return this._targetUserId ? '&user_id=' + this._targetUserId : '';
    }

    _rangeParams() {
        var now = new Date();
        var start, end;
        if (this._rangeDays === 'custom') {
            start = document.getElementById('wcStatStart') ? document.getElementById('wcStatStart').value : '';
            end = document.getElementById('wcStatEnd') ? document.getElementById('wcStatEnd').value : '';
            if (!start || !end) return null;
        } else {
            var days = parseInt(this._rangeDays) || 30;
            var s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
            start = this._fmtDate(s);
            end = this._fmtDate(now);
        }
        return 'start=' + start + '&end=' + end;
    }

    _fmtDate(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
            const d = await this.apiGet(WC_API + '/?year=' + year + '&month=' + month + this._targetParam());
            if (!d) return;
            this._renderPending(d.pending || {});
            this._renderCalendar(d.days || {}, year, month);
            this._renderMemberTitle(d.target_user);
        } catch (e) {
            this.showToast('加载工作日历失败', true);
        }
    }

    _renderMemberTitle(target) {
        var titleEl = document.getElementById('wcTitle');
        if (!titleEl) return;
        if (this._targetUserId && target) {
            titleEl.innerHTML = '<i class="fas fa-tasks" style="color:#409eff;"></i> ' + this._escape(target.name || '') + ' 的工作汇总';
        } else {
            titleEl.innerHTML = '<i class="fas fa-tasks" style="color:#409eff;"></i> 工作汇总';
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
                [info.docs, '文', '#9b59b6'],
                [info.cloud, '云', '#00a1ff'],
                [info.org, '组', '#2f9e44'],
                [info.work_summary, '总', '#7c4dff']
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
            const d = await this.apiGet(WC_API + '/day/?date=' + encodeURIComponent(dateStr) + this._targetParam());
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
                        task: ['#fdf6ec', '#e6a23c'], doc: ['#f3e8ff', '#9b59b6'], attendance: ['#f0f9eb', '#67c23a'],
                        cloud: ['#e3f4ff', '#00a1ff'], org: ['#e7f5ea', '#2f9e44'], work_summary: ['#f3e8ff', '#7c4dff']
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

    // ===== 工作统计图表 =====
    _setRange(days) {
        this._rangeDays = days;
        document.querySelectorAll('.wc-range-btn').forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-range') === days);
        });
        this._loadAllCharts();
    }
    _onCustomRange() {
        this._rangeDays = 'custom';
        document.querySelectorAll('.wc-range-btn').forEach(function (b) { b.classList.remove('active'); });
        this._loadAllCharts();
    }
    _loadAllCharts() {
        var params = this._rangeParams();
        if (!params) return;
        params += this._targetParam();
        this._loadStats(params);
        this._loadEfficiency(params);
        this._loadLeaderboard(params);
        if (this._isSuperAdmin) this._loadSummaryStats(this._rangeParams());
    }
    async _loadStats(params) {
        var wrap = document.getElementById('wcStatsChart');
        var empty = document.getElementById('wcStatsEmpty');
        if (!wrap) return;
        try {
            const d = await this.apiGet(WC_API + '/stats/?' + params);
            if (!d) return;
            var total = 0;
            (d.approvals || []).forEach(function (n) { total += n; });
            (d.invoices || []).forEach(function (n) { total += n; });
            (d.withdrawals || []).forEach(function (n) { total += n; });
            (d.tasks || []).forEach(function (n) { total += n; });
            if (total <= 0) {
                wrap.style.display = 'none';
                if (empty) empty.style.display = 'block';
                return;
            }
            wrap.style.display = 'block';
            if (empty) empty.style.display = 'none';
            if (!window.echarts) { wrap.innerHTML = '<div style="text-align:center;color:#909399;padding:60px 0;">图表组件加载失败</div>'; return; }
            if (!this._statsChart) this._statsChart = echarts.init(wrap);
            this._statsChart.setOption({
                tooltip: {trigger: 'axis'},
                legend: {data: ['审批', '核验发票', '支付提现', '任务'], textStyle: {color: '#909399'}},
                grid: {left: 40, right: 16, top: 36, bottom: 28},
                xAxis: {type: 'category', data: d.labels || [], axisLabel: {color: '#909399'}},
                yAxis: {type: 'value', minInterval: 1, axisLabel: {color: '#909399'}},
                series: [
                    {name: '审批', type: 'line', smooth: true, data: d.approvals, itemStyle: {color: '#409eff'}},
                    {name: '核验发票', type: 'line', smooth: true, data: d.invoices, itemStyle: {color: '#e6a23c'}},
                    {name: '支付提现', type: 'line', smooth: true, data: d.withdrawals, itemStyle: {color: '#16a085'}},
                    {name: '任务', type: 'line', smooth: true, data: d.tasks, itemStyle: {color: '#f56c6c'}}
                ]
            });
            this._statsChart.resize();
        } catch (e) {
            this.showToast('加载工作统计失败', true);
        }
    }
    async _loadEfficiency(params) {
        var wrap = document.getElementById('wcEffChart');
        var empty = document.getElementById('wcEffEmpty');
        var summaryEl = document.getElementById('wcEffSummary');
        if (!wrap) return;
        try {
            const d = await this.apiGet(WC_API + '/approval-efficiency/?' + params);
            if (!d) return;
            if (summaryEl) {
                summaryEl.innerHTML = '<span>共 <b style="color:#409eff;">' + (d.count || 0) + '</b> 次审批</span>'
                    + '<span>平均用时 <b style="color:#e6a23c;">' + this._fmtDur(d.avg_minutes) + '</b></span>'
                    + '<span>最长用时 <b style="color:#f56c6c;">' + this._fmtDur(d.max_minutes) + '</b></span>';
            }
            var items = d.items || [];
            if (!items.length) {
                wrap.style.display = 'none';
                if (empty) empty.style.display = 'block';
                return;
            }
            wrap.style.display = 'block';
            if (empty) empty.style.display = 'none';
            if (!window.echarts) { wrap.innerHTML = '<div style="text-align:center;color:#909399;padding:40px 0;">图表组件加载失败</div>'; return; }
            if (!this._effChart) this._effChart = echarts.init(wrap);
            var list = items.slice(-20);
            var avg = d.avg_minutes || 0;
            this._effChart.setOption({
                tooltip: {trigger: 'axis', formatter: function (ps) {
                    var i = ps[0].dataIndex;
                    var it = list[i];
                    var ap = it.applicant || {};
                    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">'
                        + '<img src="' + this._escape(ap.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                        + '<div><div style="font-weight:600;">' + this._escape(ap.name || '') + '</div>'
                        + '<div style="font-size:11px;color:#909399;">' + this._escape([ap.department, ap.position].filter(Boolean).join(' · ')) + '</div></div></div>'
                        + '<div style="font-weight:600;max-width:220px;word-break:break-all;">' + this._escape(it.title) + '</div>'
                        + '<div>到达 ' + this._escape(Utils.formatDateTime(it.arrival)) + ' → 通过 ' + this._escape(Utils.formatDateTime(it.approved_at)) + '</div>'
                        + '<div>用时：' + this._fmtDur(it.minutes) + '</div>';
                }.bind(this)},
                grid: {left: 44, right: 16, top: 24, bottom: 90},
                xAxis: {type: 'category', data: list.map(function (it) { return it.title.length > 12 ? it.title.substring(0, 12) + '…' : it.title; }), axisLabel: {color: '#909399', rotate: 30, fontSize: 10}},
                yAxis: {type: 'value', name: '分钟', nameTextStyle: {color: '#909399'}, axisLabel: {color: '#909399'}},
                series: [{name: '审批用时', type: 'bar', barMaxWidth: 28, data: list.map(function (it) { return it.minutes; }), itemStyle: {color: function (p) { return p.value >= avg ? '#e6a23c' : '#409eff'; }}}]
            });
            this._effChart.resize();
        } catch (e) {
            this.showToast('加载审批效率失败', true);
        }
    }
    async _loadLeaderboard(params) {
        var card = document.getElementById('wcLeaderboardCard');
        if (!card) return;
        if (!this._isSuperAdmin) { card.style.display = 'none'; return; }
        var wrap = document.getElementById('wcLeaderboardChart');
        var empty = document.getElementById('wcLeaderboardEmpty');
        try {
            const d = await this.apiGet(WC_API + '/approval-leaderboard/?' + params);
            if (!d) return;
            var results = d.results || [];
            if (!results.length) {
                if (wrap) wrap.style.display = 'none';
                if (empty) empty.style.display = 'block';
                return;
            }
            card.style.display = 'block';
            if (wrap) wrap.style.display = 'block';
            if (empty) empty.style.display = 'none';
            if (!window.echarts) { if (wrap) wrap.innerHTML = '<div style="text-align:center;color:#909399;padding:40px 0;">图表组件加载失败</div>'; return; }
            if (!this._leaderboardChart) this._leaderboardChart = echarts.init(wrap);
            var names = results.map(function (r) { return r.name || ('#' + r.user_id); });
            var avgs = results.map(function (r) { return r.avg_minutes; });
            var self = this;
            this._leaderboardChart.setOption({
                tooltip: {trigger: 'axis', axisPointer: {type: 'shadow'}, formatter: function (ps) {
                    var i = ps[0].dataIndex;
                    var r = results[i];
                    return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">'
                        + '<img src="' + self._escape(r.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                        + '<div><div style="font-weight:600;">' + self._escape(r.name || '') + '</div>'
                        + '<div style="font-size:11px;color:#909399;">' + self._escape([r.department, r.position].filter(Boolean).join(' · ')) + '</div></div></div>'
                        + '<div>审批数量：<b>' + r.count + '</b> 次</div>'
                        + '<div>总用时：' + self._fmtDur(r.total_minutes) + '</div>'
                        + '<div>平均用时：' + self._fmtDur(r.avg_minutes) + '</div>';
                }},
                grid: {left: 90, right: 56, top: 20, bottom: 20},
                xAxis: {type: 'value', name: '平均用时(分钟)', nameTextStyle: {color: '#909399'}, axisLabel: {color: '#909399'}},
                yAxis: {type: 'category', inverse: true, data: names, axisLabel: {color: '#606266', fontSize: 12}},
                series: [{name: '平均用时', type: 'bar', barMaxWidth: 22, data: avgs, itemStyle: {color: function (p) { return p.value >= 1440 ? '#f56c6c' : (p.value >= 60 ? '#e6a23c' : '#409eff'); }}, label: {show: true, position: 'right', color: '#909399', fontSize: 11, formatter: function (p) { var r = results[p.dataIndex]; return r.count + '次'; }}}]
            });
            this._leaderboardChart.resize();
        } catch (e) {
            this.showToast('加载审批效率排行榜失败', true);
        }
    }

    // ===== 每日工作总结完成情况统计（仅超管） =====
    _refreshSummaryStats() { this._loadSummaryStats(this._rangeParams()); }
    async _loadSummaryStats(params) {
        var card = document.getElementById('wcSummaryStatsCard');
        if (!card) return;
        if (!this._isSuperAdmin) { card.style.display = 'none'; return; }
        card.style.display = 'block';
        if (!params) return;
        try {
            const d = await this.apiGet(WC_API + '/work-summary-stats/?' + params);
            if (!d) return;
            var empty = document.getElementById('wcSummaryEmpty');
            if (d.overview && d.overview.member_count > 0) {
                this._renderSummaryOverview(d);
                this._renderSummaryDaily(d);
                this._renderSummaryBar(d.by_department, 'wcSummaryDeptChart');
                this._renderSummaryBar(d.by_position, 'wcSummaryPosChart');
                this._renderSummaryMembers(d.by_member);
                if (empty) empty.style.display = 'none';
            } else {
                if (empty) empty.style.display = 'block';
            }
            var rangeEl = document.getElementById('wcSummaryRange');
            if (rangeEl && d.range) rangeEl.textContent = d.range.start + ' ~ ' + d.range.end + '（' + d.range.days + '天）';
        } catch (e) {
            this.showToast('加载每日总结完成统计失败', true);
        }
    }
    _renderSummaryOverview(d) {
        var o = d.overview || {}, r = d.range || {};
        var wrap = document.getElementById('wcSummaryOverview');
        if (!wrap) return;
        var rate = o.overall_rate || 0;
        var rateColor = rate >= 60 ? '#67c23a' : (rate >= 30 ? '#e6a23c' : '#f56c6c');
        var items = [
            ['成员总数', o.member_count ?? 0, '#409eff'],
            ['已提交成员', o.submitted_members ?? 0, '#67c23a'],
            ['总完成天数', o.total_submitted_days ?? 0, '#e6a23c'],
            ['整体完成率', rate + '%', rateColor],
            ['统计天数', r.days ?? 0, '#909399']
        ];
        wrap.innerHTML = items.map(function (it) {
            return '<div style="display:flex;flex-direction:column;align-items:center;background:#f8f9fb;border:1px solid #ebeef5;border-radius:10px;padding:10px 18px;min-width:92px;">'
                + '<div style="font-size:22px;font-weight:700;color:' + it[2] + ';">' + it[1] + '</div>'
                + '<div style="font-size:12px;color:#909399;margin-top:2px;">' + it[0] + '</div></div>';
        }).join('');
    }
    _renderSummaryDaily(d) {
        var wrap = document.getElementById('wcSummaryDailyChart');
        if (!wrap) return;
        var list = d.daily || [];
        if (!window.echarts) { wrap.innerHTML = '<div style="text-align:center;color:#909399;padding:40px 0;">图表组件加载失败</div>'; return; }
        if (!this._summaryDailyChart) this._summaryDailyChart = echarts.init(wrap);
        this._summaryDailyChart.setOption({
            tooltip: {trigger: 'axis'},
            grid: {left: 40, right: 20, top: 26, bottom: 28},
            xAxis: {type: 'category', data: list.map(function (x) { return x.date.slice(5); }), axisLabel: {color: '#909399'}},
            yAxis: {type: 'value', min: 0, max: 100, axisLabel: {formatter: '{value}%', color: '#909399'}},
            series: [{
                name: '提交率', type: 'line', smooth: true, data: list.map(function (x) { return x.rate; }),
                itemStyle: {color: '#7c4dff'}, areaStyle: {color: 'rgba(124,77,255,.12)'},
                markLine: {symbol: 'none', data: [{type: 'average', name: '平均'}], lineStyle: {color: '#e6a23c', type: 'dashed'}}
            }]
        });
        this._summaryDailyChart.resize();
    }
    _renderSummaryBar(list, chartId) {
        var wrap = document.getElementById(chartId);
        if (!wrap) return;
        var arr = list || [];
        if (!window.echarts) { wrap.innerHTML = '<div style="text-align:center;color:#909399;padding:40px 0;">图表组件加载失败</div>'; return; }
        if (!this._summaryBarCharts) this._summaryBarCharts = {};
        if (!this._summaryBarCharts[chartId]) this._summaryBarCharts[chartId] = echarts.init(wrap);
        // 取完成率最低的后 12 项，便于发现落后部门/岗位
        var top = arr.slice(-12);
        var names = top.map(function (x) { return x.name; });
        var rates = top.map(function (x) { return x.rate; });
        this._summaryBarCharts[chartId].setOption({
            tooltip: {trigger: 'axis', axisPointer: {type: 'shadow'}, formatter: function (ps) {
                var x = top[ps[0].dataIndex];
                return '<b>' + x.name + '</b><br/>成员 ' + x.member_count + ' 人 · 完成 ' + x.submitted_days + '/' + (x.member_count * x.total_days) + ' 天<br/>完成率 ' + x.rate + '%';
            }},
            grid: {left: 110, right: 44, top: 16, bottom: 20},
            xAxis: {type: 'value', min: 0, max: 100, axisLabel: {formatter: '{value}%', color: '#909399'}},
            yAxis: {type: 'category', inverse: true, data: names, axisLabel: {color: '#606266', fontSize: 11}},
            series: [{type: 'bar', barMaxWidth: 16, data: rates, itemStyle: {color: function (p) { return p.value >= 60 ? '#67c23a' : (p.value >= 30 ? '#e6a23c' : '#f56c6c'); }}, label: {show: true, position: 'right', color: '#909399', fontSize: 11, formatter: '{c}%'}}]
        });
        this._summaryBarCharts[chartId].resize();
    }
    _renderSummaryMembers(list) {
        var wrap = document.getElementById('wcSummaryMember');
        if (!wrap) return;
        if (!list || !list.length) { wrap.innerHTML = '<div style="color:#909399;text-align:center;padding:30px 0;">暂无成员数据</div>'; return; }
        var self = this;
        wrap.innerHTML = list.map(function (m) {
            var rateColor = m.rate >= 60 ? '#67c23a' : (m.rate >= 30 ? '#e6a23c' : '#f56c6c');
            var missed = m.missed_days || [];
            var missedTag = missed.length
                ? '<span style="flex-shrink:0;font-size:10px;color:#f56c6c;background:#fef0f0;border-radius:8px;padding:1px 6px;cursor:default;" title="缺勤日期：' + self._escape(missed.join(', ')) + '">缺' + m.missed_count + '天</span>'
                : '<span style="flex-shrink:0;font-size:10px;color:#67c23a;background:#f0f9eb;border-radius:8px;padding:1px 6px;">已完成</span>';
            return '<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid #f0f0f0;">'
                + '<img src="' + (m.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:13px;color:#303133;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(m.name) + '</div>'
                + '<div style="font-size:11px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape([m.department, m.position].filter(Boolean).join(' · ') || '未分组') + '</div></div>'
                + '<div style="font-size:11px;color:#909399;flex-shrink:0;">' + m.submitted + '/' + m.total + '天</div>'
                + '<div style="width:52px;flex-shrink:0;text-align:right;font-size:13px;font-weight:600;color:' + rateColor + ';">' + m.rate + '%</div>'
                + missedTag
                + '</div>';
        }).join('');
    }

    _fmtDur(mins) {
        if (mins == null) return '0分钟';
        if (mins < 60) return mins + '分钟';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return h + '小时' + (m ? m + '分钟' : '');
    }

    // ===== 超管查看成员 =====
    async _onMemberSearch(e) {
        var kw = (e.target.value || '').trim();
        var res = document.getElementById('wcMemberRes');
        if (!res) return;
        if (!kw) { res.style.display = 'none'; return; }
        try {
            var resp = await fetch('/api/oa/attendance/members/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            var json = await resp.json();
            var users = json.results || [];
            this._memberSearchUsers = users;
            var self = this;
            res.innerHTML = users.length ? users.map(function (u) {
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onclick="wcApp._selectMember(' + u.id + ')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name || '') + '</span>'
                    + (u.department_name ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.department_name) + '</span>' : '')
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到成员</div>';
            res.style.display = 'block';
        } catch (err) {}
    }
    _selectMember(id) {
        var u = null;
        (this._memberSearchUsers || []).forEach(function (x) { if (String(x.id) === String(id)) u = x; });
        if (!u) return;
        this._targetUserId = u.id;
        var search = document.getElementById('wcMemberSearch');
        if (search) search.value = '';
        var res = document.getElementById('wcMemberRes');
        if (res) res.style.display = 'none';
        var tag = document.getElementById('wcMemberTag');
        if (tag) {
            tag.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:#ecf5ff;border-radius:14px;font-size:12px;color:#409eff;">'
                + (u.avatar ? '<img src="' + this._escape(u.avatar) + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user" style="font-size:10px;color:#409eff;"></i>')
                + '<span>' + this._escape(u.name || ('#' + u.id)) + '</span>'
                + (u.department_name ? '<span style="font-size:11px;color:#a0c4ff;">' + this._escape(u.department_name) + '</span>' : '')
                + '</span>';
        }
        var clearBtn = document.getElementById('wcMemberClearBtn');
        if (clearBtn) clearBtn.style.display = '';
        this.loadMonth(this._year, this._month);
        this._loadAllCharts();
    }
    _clearMember() {
        this._targetUserId = null;
        var tag = document.getElementById('wcMemberTag');
        if (tag) tag.innerHTML = '';
        var clearBtn = document.getElementById('wcMemberClearBtn');
        if (clearBtn) clearBtn.style.display = 'none';
        var search = document.getElementById('wcMemberSearch');
        if (search) search.value = '';
        this.loadMonth(this._year, this._month);
        this._loadAllCharts();
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

window.addEventListener('resize', function () {
    if (wcApp._statsChart) wcApp._statsChart.resize();
    if (wcApp._effChart) wcApp._effChart.resize();
    if (wcApp._leaderboardChart) wcApp._leaderboardChart.resize();
    if (wcApp._summaryDailyChart) wcApp._summaryDailyChart.resize();
    if (wcApp._summaryBarCharts) {
        Object.keys(wcApp._summaryBarCharts).forEach(function (k) {
            if (wcApp._summaryBarCharts[k]) wcApp._summaryBarCharts[k].resize();
        });
    }
});
