/**
 * 普惠补贴「报表与数据分析」（超管 / 财务核验人员 / 财务支付人员）
 * 补贴发放统计 / 明细 / 趋势 / 排行 + 导出 Excel·PDF（ECharts 可视化）
 */
(function () {
    'use strict';
    var OA = '/api/oa';
    var state = { start: '', end: '', loading: false, userId: null, userName: '' };
    var charts = {};

    function authHeaders() {
        try { return TokenManager.getHeaders(); } catch (e) { return {}; }
    }
    function toast(msg, isErr) {
        // 独立 toast（z-index 高于报表模态框），避免提示被模态框遮挡
        var el = document.createElement('div');
        el.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:200001;padding:10px 18px;border-radius:8px;font-size:13px;color:#fff;background:' + (isErr ? '#f56c6c' : '#67c23a') + ';box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:86vw;word-break:break-all;';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, isErr ? 4200 : 2200);
    }
    async function getJSON(url) {
        var r = await fetch(url, { headers: authHeaders() });
        var raw = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(raw.error || raw.detail || ('请求失败(' + r.status + ')'));
        return (raw && raw.encrypt && window.EncryptUtils) ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    function ensureEcharts() {
        return new Promise(function (resolve, reject) {
            if (window.echarts) return resolve(window.echarts);
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
            s.onload = function () { resolve(window.echarts); };
            s.onerror = function () { reject(new Error('图表库加载失败，请检查网络')); };
            document.head.appendChild(s);
        });
    }
    function fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function initRange() {
        var end = new Date(), start = new Date();
        start.setDate(end.getDate() - 29);
        state.end = fmtDate(end); state.start = fmtDate(start);
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function money(v) { return '¥' + Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
    function renderUserChip() {
        var chip = document.getElementById('srUserChip');
        if (!chip) return;
        if (state.userId) {
            chip.style.display = 'inline-block';
            chip.innerHTML = '<i class="fas fa-user"></i> ' + esc(state.userName || ('#' + state.userId))
                + ' <i class="fas fa-times" style="cursor:pointer;margin-left:4px;" title="清除用户筛选" onclick="SubsidyReport.clearUser()"></i>';
        } else {
            chip.style.display = 'none';
            chip.innerHTML = '';
        }
    }
    function userParam() { return state.userId ? ('&user_id=' + state.userId) : ''; }
    // 导出文件名：原名称 + 日期范围（+ 筛选用户名）
    function rangeText() {
        var a = String(state.start || '').replace(/-/g, '');
        var b = String(state.end || '').replace(/-/g, '');
        return (a && b) ? (a + '-' + b) : '';
    }
    function exportFileName(base, ext) {
        var parts = [base];
        var rt = rangeText();
        if (rt) parts.push(rt);
        if (state.userId) parts.push(state.userName || ('用户' + state.userId));
        return parts.join('_') + '.' + ext;
    }
    // 确保网盘目录存在（不存在自动创建），返回目录 id
    async function ensureCloudFolder(name) {
        var r = await fetch('/api/cloud/folders/ensure/', {
            method: 'POST',
            headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name: name })
        });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok || !d.id) throw new Error((d && d.error) || '创建网盘目录失败');
        return d.id;
    }
    // 采集模态框当前内容为块（统计卡 / 表格 / 图表图片 / 小标题），用于导出 PDF 与打印
    function collectBlocks() {
        var content = document.getElementById('srContent');
        var blocks = [];
        function cellsOf(tr) {
            return Array.prototype.map.call(tr.children, function (td) {
                return (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim();
            });
        }
        function walk(node) {
            Array.prototype.forEach.call(node.children, function (el) {
                var cls = el.classList || {};
                if (cls.contains('sr-cards')) {
                    var rows = [];
                    el.querySelectorAll('.sr-card').forEach(function (c) {
                        var l = c.querySelector('.l'), v = c.querySelector('.v');
                        rows.push([l ? l.textContent.trim() : '', v ? v.textContent.trim() : '']);
                    });
                    if (rows.length) blocks.push({ kind: 'table', headers: ['指标', '数值'], rows: rows });
                    return;
                }
                if (el.tagName === 'TABLE') {
                    var headers = [], rows = [];
                    Array.prototype.forEach.call(el.querySelectorAll('tr'), function (tr) {
                        var cs = cellsOf(tr);
                        if (!cs.length) return;
                        if (!headers.length && tr.querySelector('th')) { headers = cs; return; }
                        rows.push(cs);
                    });
                    if (!headers.length && rows.length) headers = rows.shift();
                    if (headers.length || rows.length) blocks.push({ kind: 'table', headers: headers, rows: rows });
                    return;
                }
                if (cls.contains('sr-chart')) {
                    var inst = charts[el.id];
                    if (inst && inst.getDataURL) {
                        try {
                            blocks.push({ kind: 'image', data: inst.getDataURL({ type: 'png', pixelRatio: 1.5, backgroundColor: '#fff' }) });
                        } catch (e) { /* ignore */ }
                    }
                    return;
                }
                if (cls.contains('sr-sec')) {
                    var t = el.textContent.replace(/\s+/g, ' ').trim();
                    if (t) blocks.push({ kind: 'heading', text: t });
                    return;
                }
                walk(el);
            });
        }
        if (content) walk(content);
        return blocks;
    }
    function reportSubtitle() {
        return '统计区间：' + (state.start || '-') + ' ~ ' + (state.end || '-')
            + (state.userId ? ('　筛选用户：' + (state.userName || state.userId)) : '');
    }
    // 打印当前模态框内容（图表以图片、表格以表格输出）
    function printReport() {
        var blocks = collectBlocks();
        if (!blocks.length) { toast('暂无可打印的内容', true); return; }
        var title = '普惠补贴-报表与数据分析';
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<title>' + esc(title) + '</title><style>'
            + 'body{font-family:"Microsoft YaHei",sans-serif;padding:20px 20px 76px;margin:0;color:#333;}'
            + 'h1{font-size:20px;margin:0 0 4px;} .sub{font-size:12px;color:#909399;margin-bottom:14px;}'
            + 'h3{font-size:14px;color:#16a085;margin:16px 0 6px;}'
            + 'table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;}'
            + 'th,td{border:1px solid #dcdfe6;padding:6px 8px;text-align:left;} th{background:#f5f7fa;}'
            + 'img{max-width:100%;display:block;margin:8px 0;}'
            + '.rp-bar{position:fixed;left:0;right:0;bottom:0;height:auto;min-height:56px;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #ebeef5;box-shadow:0 -2px 8px rgba(0,0,0,.08);z-index:999;}'
            + '.rp-bar .rp-tt{flex:1;min-width:0;font-size:13px;font-weight:600;color:#303133;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
            + '.rp-bar button{flex:0 0 auto;height:38px;padding:0 20px;border:1px solid #dcdfe6;background:#fff;color:#606266;border-radius:6px;font-size:14px;cursor:pointer;}'
            + '.rp-bar button.rp-close{background:#16a085;border-color:#16a085;color:#fff;}'
            + '@media print{.rp-bar{display:none;} body{padding:0;}}'
            + '</style></head><body>'
            + '<h1>' + esc(title) + '</h1><div class="sub">' + esc(reportSubtitle()) + '</div>';
        blocks.forEach(function (b) {
            if (b.kind === 'heading') html += '<h3>' + esc(b.text) + '</h3>';
            else if (b.kind === 'image') html += '<img src="' + b.data + '">';
            else if (b.kind === 'table') {
                html += '<table>';
                if (b.headers && b.headers.length) html += '<tr>' + b.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr>';
                (b.rows || []).forEach(function (r) { html += '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; });
                html += '</table>';
            }
        });
        html += '<div class="rp-bar"><span class="rp-tt">' + esc(title) + '</span>'
            + '<button type="button" onclick="__rpBack()">返回</button>'
            + '<button type="button" class="rp-close" onclick="__rpClose()">关闭</button>'
            + '</div>'
            + '<script>'
            + 'function __rpClose(){try{window.close();}catch(e){}setTimeout(function(){try{window.open("","_self");window.close();}catch(e){}},80);}'
            + 'function __rpBack(){try{if(window.history.length>1){window.history.back();return;}}catch(e){}__rpClose();}'
            + '<\/script></body></html>';
        var win = window.open('', '_blank');
        if (!win) { toast('请允许浏览器弹出打印窗口', true); return; }
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(function () { try { win.print(); } catch (e) { /* ignore */ } }, 300);
    }

    function buildModal() {
        if (document.getElementById('subsidyReportModal')) return;
        var css = document.createElement('style');
        css.textContent = ''
            + '#subsidyReportModal{position:fixed;inset:0;z-index:150000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:16px;}'
            + '#subsidyReportModal .sr-panel{background:var(--bg-primary,#fff);color:var(--text-primary,#303133);border-radius:12px;width:100%;max-width:1080px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.28);}'
            + '#subsidyReportModal .sr-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border-color,#ebeef5);flex-wrap:wrap;}'
            + '#subsidyReportModal .sr-body{padding:16px 18px;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;}'
            + '#subsidyReportModal .sr-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px;}'
            + '#subsidyReportModal .sr-card{background:var(--bg-secondary,#f5f7fa);border-radius:10px;padding:12px;}'
            + '#subsidyReportModal .sr-card .v{font-size:20px;font-weight:700;color:#16a085;}'
            + '#subsidyReportModal .sr-card .l{font-size:12px;color:#909399;margin-top:2px;}'
            + '#subsidyReportModal .sr-chart{width:100%;height:280px;margin-bottom:16px;}'
            + '#subsidyReportModal .sr-chart.sm{height:240px;}'
            + '#subsidyReportModal .sr-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}'
            + '#subsidyReportModal .sr-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--border-color,#dcdfe6);background:transparent;color:inherit;cursor:pointer;font-size:13px;}'
            + '#subsidyReportModal .sr-btn.primary{background:#16a085;border-color:#16a085;color:#fff;}'
            + '#subsidyReportModal .sr-btn:not(:disabled){transition:all .15s;}'
            + '#subsidyReportModal .sr-btn:not(:disabled):hover{border-color:#16a085;color:#16a085;background:rgba(22,160,133,.08);}'
            + '#subsidyReportModal .sr-btn:not(:disabled):active{transform:translateY(1px);background:rgba(22,160,133,.18);}'
            + '#subsidyReportModal .sr-btn.primary:hover{background:#1abc9c;border-color:#1abc9c;color:#fff;}'
            + '#subsidyReportModal .sr-btn.primary:active{background:#12876f;border-color:#12876f;color:#fff;}'
            + '#subsidyReportModal:fullscreen,#subsidyReportModal:-webkit-full-screen{padding:0;background:var(--bg-primary,#fff);}'
            + '#subsidyReportModal:fullscreen .sr-panel,#subsidyReportModal:-webkit-full-screen .sr-panel{max-width:none;width:100vw;height:100vh;max-height:100vh;border-radius:0;}'
            + '#srDestMenu div:hover{background:var(--bg-secondary,#f5f7fa);}'
            + '#subsidyReportModal .sr-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;}'
            + '#subsidyReportModal .sr-table th,#subsidyReportModal .sr-table td{border:1px solid var(--border-color,#ebeef5);padding:6px 10px;text-align:left;}'
            + '#subsidyReportModal .sr-table th{background:var(--bg-secondary,#f5f7fa);}'
            + '#subsidyReportModal .sr-sec{font-size:13px;font-weight:600;color:#16a085;margin:4px 0 8px;}'
            + '@media(max-width:720px){#subsidyReportModal .sr-row{grid-template-columns:1fr;}#subsidyReportModal .sr-panel{max-height:96vh;}}';
        document.head.appendChild(css);
        var ov = document.createElement('div');
        ov.id = 'subsidyReportModal';
        ov.innerHTML = ''
            + '<div class="sr-panel">'
            + '  <div class="sr-head">'
            + '    <i class="fas fa-chart-pie" style="color:#16a085;font-size:18px;"></i>'
            + '    <b style="font-size:16px;">报表与数据分析</b>'
            + '    <span style="flex:1;"></span>'
            + '    <div style="position:relative;">'
            + '      <input type="text" id="srUserSearch" class="sr-btn" placeholder="按用户筛选" style="padding:5px 8px;width:130px;">'
            + '      <div id="srUserRes" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#dcdfe6);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.16);max-height:220px;overflow-y:auto;z-index:5;min-width:190px;"></div>'
            + '    </div>'
            + '    <span id="srUserChip" style="display:none;font-size:12px;color:#16a085;background:#e8f8f0;border-radius:12px;padding:3px 8px;"></span>'
            + '    <input type="date" id="srStart" class="sr-btn" style="padding:5px 8px;">'
            + '    <span style="color:#909399;">至</span>'
            + '    <input type="date" id="srEnd" class="sr-btn" style="padding:5px 8px;">'
            + '    <button class="sr-btn primary" id="srRefreshBtn"><i class="fas fa-sync"></i> 刷新</button>'
            + '    <button class="sr-btn" id="srFullBtn" title="全屏"><i class="fas fa-expand"></i></button>'
            + '    <button class="sr-btn" onclick="document.getElementById(\'subsidyReportModal\').style.display=\'none\'"><i class="fas fa-times"></i></button>'
            + '  </div>'
            + '  <div class="sr-body">'
            + '    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">'
            + '      <button class="sr-btn" id="srExportXlsx"><i class="fas fa-file-excel" style="color:#16a085;"></i> 导出Excel</button>'
            + '      <button class="sr-btn" id="srExportPdf"><i class="fas fa-file-pdf" style="color:#f56c6c;"></i> 导出PDF</button>'
            + '      <button class="sr-btn" id="srPrintBtn"><i class="fas fa-print"></i> 打印</button>'
            + '    </div>'
            + '    <div id="srContent"><div style="padding:40px;text-align:center;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中…</div></div>'
            + '  </div>'
            + '  <div class="sr-foot" style="padding:10px 18px;border-top:1px solid var(--border-color,#ebeef5);text-align:right;">'
            + '    <button class="sr-btn" onclick="SubsidyReport.close()"><i class="fas fa-times"></i> 关闭</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
        document.getElementById('srRefreshBtn').addEventListener('click', function () {
            state.start = document.getElementById('srStart').value;
            state.end = document.getElementById('srEnd').value;
            load();
        });
        document.getElementById('srExportXlsx').addEventListener('click', function () { showDestMenu(this, 'xlsx'); });
        document.getElementById('srExportPdf').addEventListener('click', function () { showDestMenu(this, 'pdf'); });
        document.getElementById('srPrintBtn').addEventListener('click', function () { printReport(); });
        // 切换日期范围后自动刷新
        document.getElementById('srStart').addEventListener('change', function () { state.start = this.value; load(); });
        document.getElementById('srEnd').addEventListener('change', function () { state.end = this.value; load(); });
        // 全屏切换
        document.getElementById('srFullBtn').addEventListener('click', function () {
            var m = document.getElementById('subsidyReportModal');
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            } else if (m.requestFullscreen) { m.requestFullscreen(); }
            else if (m.webkitRequestFullscreen) { m.webkitRequestFullscreen(); }
        });
        // 按用户筛选
        var _usEl = document.getElementById('srUserSearch');
        if (_usEl) {
            var _uTimer = null;
            _usEl.addEventListener('input', function () {
                clearTimeout(_uTimer);
                var kw = this.value.trim();
                var resEl = document.getElementById('srUserRes');
                if (!kw) { resEl.style.display = 'none'; return; }
                _uTimer = setTimeout(function () {
                    fetch('/api/oa/approval/search-cc-users/?search=' + encodeURIComponent(kw), { headers: authHeaders() })
                        .then(function (r) { return r.json(); })
                        .then(function (j) {
                            var list = (j && j.results) || [];
                            resEl.innerHTML = list.length ? list.map(function (u) {
                                return '<div data-uid="' + u.id + '" data-uname="' + esc(u.name || '') + '" style="padding:7px 12px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;">'
                                    + (u.avatar ? '<img src="' + u.avatar + '" style="width:22px;height:22px;border-radius:50%;">' : '')
                                    + '<span>' + esc(u.name || '') + '</span>'
                                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + esc(u.position) + '</span>' : '')
                                    + '</div>';
                            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:12px;">未找到用户</div>';
                            resEl.style.display = 'block';
                            resEl.querySelectorAll('[data-uid]').forEach(function (it) {
                                it.addEventListener('click', function () {
                                    state.userId = parseInt(it.getAttribute('data-uid'), 10);
                                    state.userName = it.getAttribute('data-uname') || '';
                                    resEl.style.display = 'none';
                                    _usEl.value = '';
                                    renderUserChip();
                                    load();
                                });
                            });
                        }).catch(function () { resEl.style.display = 'none'; });
                }, 300);
            });
            document.addEventListener('click', function (e) {
                if (!e.target.closest('#srUserRes') && e.target !== _usEl) {
                    var r2 = document.getElementById('srUserRes');
                    if (r2) r2.style.display = 'none';
                }
            });
        }
        var onFsChange = function () {
            var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
            var b = document.getElementById('srFullBtn');
            if (b) b.innerHTML = on ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
            setTimeout(function () { Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); }); }, 120);
        };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
        window.addEventListener('resize', function () {
            Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); });
        });
    }

    function card(v, l) { return '<div class="sr-card"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }
    var axisColor = '#909399';
    function baseAxis() {
        return {
            axisLine: { lineStyle: { color: axisColor } },
            axisLabel: { color: axisColor, fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(144,147,153,.18)' } }
        };
    }
    function chart(id, option) {
        var el = document.getElementById(id);
        if (!el || !window.echarts) return;
        if (charts[id]) { try { charts[id].dispose(); } catch (e) { /* ignore */ } charts[id] = null; }
        var c = window.echarts.init(el);
        c.setOption(option);
        charts[id] = c;
    }

    function render(d) {
        var s = d.summary || {};
        var h = '<div class="sr-cards">'
            + card(s.total_count || 0, '申领总数')
            + card(money(s.invoice_amount), '开票金额合计')
            + card(money(s.subsidy_amount), '补贴金额合计')
            + card(s.approved_count || 0, '已通过')
            + card(s.pending_count || 0, '待核验')
            + card(s.rejected_count || 0, '已驳回')
            + '</div>';
        var vs = d.verify_stats || {};
        var ws = d.withdraw_stats || {};
        h += '<div class="sr-sec"><i class="fas fa-clipboard-check"></i> 核验与提现统计</div>';
        h += '<div class="sr-cards">'
            + card(money(vs.approved_amount), '通过核验补贴金额')
            + card(money(vs.approved_invoice_amount), '通过核验开票金额')
            + card(money(vs.rejected_amount), '未通过核验补贴金额')
            + card(money(ws.paid_amount), '已支付提现')
            + card(money(ws.pending_amount), '未支付提现')
            + card(money(ws.total_amount), '全部提现')
            + '</div>';
        var _row = function (label, cnt, amt) {
            var c = (cnt === '' || cnt === undefined || cnt === null) ? '—' : (cnt || 0);
            return '<tr><td>' + label + '</td><td>' + c + '</td><td>' + money(amt) + '</td></tr>';
        };
        h += '<table class="sr-table"><tr><th>统计项</th><th>笔数</th><th>金额</th></tr>'
            + _row('通过核验的补贴（补贴金额）', vs.approved_count, vs.approved_amount)
            + _row('通过核验的开票金额', vs.approved_count, vs.approved_invoice_amount)
            + _row('未通过核验的补贴', vs.rejected_count, vs.rejected_amount)
            + _row('已支付的提现', ws.paid_count, ws.paid_amount)
            + _row('未支付的提现', ws.pending_count, ws.pending_amount)
            + _row('已驳回的提现', ws.rejected_count, ws.rejected_amount)
            + _row('全部提现', ws.total_count, ws.total_amount)
            + '</table>';
        h += '<div class="sr-row"><div id="srStatusPie" class="sr-chart sm"></div><div id="srTypePie" class="sr-chart sm"></div></div>';
        h += '<div class="sr-row"><div id="srVerifyPie" class="sr-chart sm"></div><div id="srWithdrawPie" class="sr-chart sm"></div></div>';
        h += '<div id="srMonthly" class="sr-chart"></div>';
        h += '<div id="srPayTrend" class="sr-chart"></div>';
        h += '<div class="sr-sec"><i class="fas fa-trophy" style="color:#e6a23c;"></i> 补贴排行（仅统计通过核验的补贴金额）</div>';
        h += '<div class="sr-row"><div id="srDept" class="sr-chart sm"></div><div id="srEmp" class="sr-chart sm"></div></div>';
        h += '<div class="sr-sec"><i class="fas fa-money-check-alt" style="color:#16a085;"></i> 已支付提现排行（按提现金额）</div>';
        h += '<div class="sr-row"><div id="srPaidDept" class="sr-chart sm"></div><div id="srPaidEmp" class="sr-chart sm"></div></div>';
        document.getElementById('srContent').innerHTML = h;

        var st = d.by_status || [];
        chart('srStatusPie', {
            title: { text: '按状态', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'item', formatter: '{b}: {c} 单 (¥{d}%)' },
            series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '58%'],
                data: st.map(function (x) { return { name: x.name, value: x.count }; }),
                label: { color: axisColor, fontSize: 11 } }]
        });
        var tp = d.by_type || [];
        chart('srTypePie', {
            title: { text: '按发票类型(补贴金额)', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
            series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '58%'],
                data: tp.map(function (x) { return { name: x.name, value: x.subsidy_amount }; }),
                label: { color: axisColor, fontSize: 11 } }]
        });
        chart('srVerifyPie', {
            title: { text: '补贴核验构成(补贴金额)', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
            series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '58%'],
                data: [
                    { name: '通过核验', value: (vs.approved_amount || 0) },
                    { name: '未通过核验', value: (vs.rejected_amount || 0) },
                    { name: '待核验', value: Math.max(0, (s.subsidy_amount || 0) - (vs.approved_amount || 0) - (vs.rejected_amount || 0)) }
                ],
                label: { color: axisColor, fontSize: 11 } }]
        });
        chart('srWithdrawPie', {
            title: { text: '提现构成(金额)', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
            series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '58%'],
                data: [
                    { name: '已支付', value: (ws.paid_amount || 0) },
                    { name: '未支付', value: (ws.pending_amount || 0) },
                    { name: '已驳回', value: (ws.rejected_amount || 0) }
                ],
                label: { color: axisColor, fontSize: 11 } }]
        });
        var ms = d.monthly || [];
        chart('srMonthly', {
            tooltip: { trigger: 'axis' },
            legend: { data: ['补贴金额', '申领笔数'], textStyle: { color: axisColor } },
            grid: { left: 60, right: 50, top: 30, bottom: 30 },
            xAxis: Object.assign({ type: 'category', data: ms.map(function (x) { return x.month; }) }, baseAxis()),
            yAxis: [Object.assign({ type: 'value', name: '金额' }, baseAxis()), Object.assign({ type: 'value', name: '笔数' }, baseAxis())],
            series: [
                { name: '补贴金额', type: 'line', smooth: true, data: ms.map(function (x) { return x.subsidy_amount; }), itemStyle: { color: '#16a085' } },
                { name: '申领笔数', type: 'bar', yAxisIndex: 1, data: ms.map(function (x) { return x.count; }), itemStyle: { color: '#409eff' } }
            ]
        });
        var pt = d.pay_trend || [];
        chart('srPayTrend', {
            tooltip: { trigger: 'axis' },
            grid: { left: 60, right: 20, top: 24, bottom: 30 },
            xAxis: Object.assign({ type: 'category', data: pt.map(function (x) { return x.date; }) }, baseAxis()),
            yAxis: Object.assign({ type: 'value' }, baseAxis()),
            series: [{ name: '发放金额', type: 'line', smooth: true, areaStyle: { opacity: .15 }, data: pt.map(function (x) { return x.subsidy_amount; }), itemStyle: { color: '#9b59b6' } }]
        });
        var dept = d.dept_rank || [];
        chart('srDept', {
            title: { text: '部门补贴排行（通过核验）', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'axis' },
            grid: { left: 90, right: 20, top: 40, bottom: 20 },
            xAxis: Object.assign({ type: 'value' }, baseAxis()),
            yAxis: Object.assign({ type: 'category', data: dept.slice(0, 10).map(function (x) { return x.name; }).reverse() }, baseAxis()),
            series: [{ type: 'bar', data: dept.slice(0, 10).map(function (x) { return x.subsidy_amount; }).reverse(), itemStyle: { color: '#16a085' } }]
        });
        var emp = d.emp_rank || [];
        chart('srEmp', {
            title: { text: '员工补贴排行（通过核验）', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'axis' },
            grid: { left: 90, right: 20, top: 40, bottom: 20 },
            xAxis: Object.assign({ type: 'value' }, baseAxis()),
            yAxis: Object.assign({ type: 'category', data: emp.slice(0, 10).map(function (x) { return x.name; }).reverse() }, baseAxis()),
            series: [{ type: 'bar', data: emp.slice(0, 10).map(function (x) { return x.subsidy_amount; }).reverse(), itemStyle: { color: '#409eff' } }]
        });
        var pdept = d.paid_dept_rank || [];
        chart('srPaidDept', {
            title: { text: '已支付提现部门排行', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'axis' },
            grid: { left: 90, right: 20, top: 40, bottom: 20 },
            xAxis: Object.assign({ type: 'value' }, baseAxis()),
            yAxis: Object.assign({ type: 'category', data: pdept.slice(0, 10).map(function (x) { return x.name; }).reverse() }, baseAxis()),
            series: [{ type: 'bar', data: pdept.slice(0, 10).map(function (x) { return x.amount; }).reverse(), itemStyle: { color: '#16a085' } }]
        });
        var pemp = d.paid_emp_rank || [];
        chart('srPaidEmp', {
            title: { text: '已支付提现员工排行', left: 'center', textStyle: { fontSize: 13, color: axisColor } },
            tooltip: { trigger: 'axis' },
            grid: { left: 90, right: 20, top: 40, bottom: 20 },
            xAxis: Object.assign({ type: 'value' }, baseAxis()),
            yAxis: Object.assign({ type: 'category', data: pemp.slice(0, 10).map(function (x) { return x.name; }).reverse() }, baseAxis()),
            series: [{ type: 'bar', data: pemp.slice(0, 10).map(function (x) { return x.amount; }).reverse(), itemStyle: { color: '#409eff' } }]
        });
    }

    async function load() {
        if (state.loading) return;
        state.loading = true;
        var content = document.getElementById('srContent');
        content.innerHTML = '<div style="padding:40px;text-align:center;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中…</div>';
        try {
            await ensureEcharts();
            var d = await getJSON(OA + '/subsidy/report-stats/?start=' + encodeURIComponent(state.start) + '&end=' + encodeURIComponent(state.end) + userParam());
            render(d);
        } catch (e) {
            content.innerHTML = '<div style="padding:40px;text-align:center;color:#f56c6c;">' + esc(e.message || '加载失败') + '</div>';
            toast(e.message || '加载失败', true);
        } finally {
            state.loading = false;
        }
    }

    function closeDestMenu() {
        var m = document.getElementById('srDestMenu');
        if (m) m.remove();
    }
    function showDestMenu(anchor, format) {
        closeDestMenu();
        var r = anchor.getBoundingClientRect();
        var m = document.createElement('div');
        m.id = 'srDestMenu';
        m.style.cssText = 'position:fixed;z-index:200000;background:var(--bg-primary,#fff);color:inherit;border:1px solid var(--border-color,#dcdfe6);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.16);padding:4px;font-size:13px;';
        m.style.left = Math.max(8, r.right - 150) + 'px';
        m.style.top = (r.bottom + 6) + 'px';
        m.innerHTML = '<div data-dest="local" style="padding:8px 14px;cursor:pointer;white-space:nowrap;border-radius:6px;"><i class="fas fa-download" style="color:#409eff;"></i> 导出到本地</div>'
            + '<div data-dest="cloud" style="padding:8px 14px;cursor:pointer;white-space:nowrap;border-radius:6px;"><i class="fas fa-cloud-upload-alt" style="color:#16a085;"></i> 保存到我的网盘</div>';
        document.body.appendChild(m);
        m.querySelectorAll('[data-dest]').forEach(function (it) {
            it.addEventListener('click', function () {
                var d = it.getAttribute('data-dest');
                closeDestMenu();
                doExport(format, d);
            });
        });
        setTimeout(function () { document.addEventListener('click', closeDestMenu, { once: true }); }, 0);
    }
    async function doExport(format, dest) {
        dest = dest || 'local';
        var name = exportFileName('普惠补贴发放明细', format === 'pdf' ? 'pdf' : 'xlsx');
        try {
            var blob;
            if (format === 'pdf') {
                // PDF：导出模态框当前全部内容（统计 + 表格 + 图表）
                var blocks = collectBlocks();
                if (!blocks.length) throw new Error('暂无可导出的内容');
                var rp = await fetch(OA + '/subsidy/report-pdf/', {
                    method: 'POST',
                    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ title: '普惠补贴-报表与数据分析', subtitle: reportSubtitle(), filename: name, blocks: blocks })
                });
                if (!rp.ok) {
                    var ep = await rp.json().catch(function () { return {}; });
                    throw new Error(ep.error || ('导出失败(' + rp.status + ')'));
                }
                blob = await rp.blob();
            } else {
                var url = OA + '/subsidy/report-stats/?export_format=' + format
                    + '&start=' + encodeURIComponent(state.start) + '&end=' + encodeURIComponent(state.end) + userParam();
                var r = await fetch(url, { headers: authHeaders() });
                if (!r.ok) {
                    var e = await r.json().catch(function () { return {}; });
                    throw new Error(e.error || ('导出失败(' + r.status + ')'));
                }
                blob = await r.blob();
            }
            var file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
            if (dest === 'cloud') {
                if (!window.Utils || !Utils.uploadToCloud) throw new Error('网盘上传组件未加载，请刷新');
                var fid = await ensureCloudFolder('文档（来自普惠补贴）');
                await Utils.uploadToCloud(file, fid, '普惠补贴报表');
                toast('已保存到我的网盘 / 文档（来自普惠补贴）', false);
            } else {
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
                toast('导出成功', false);
            }
        } catch (e) { toast(e.message || '导出失败', true); }
    }

    window.SubsidyReport = {
        open: function () {
            buildModal();
            if (!state.start || !state.end) initRange();
            document.getElementById('srStart').value = state.start;
            document.getElementById('srEnd').value = state.end;
            renderUserChip();
            document.getElementById('subsidyReportModal').style.display = 'flex';
            load();
        },
        clearUser: function () {
            state.userId = null;
            state.userName = '';
            renderUserChip();
            load();
        },
        close: function () {
            var m = document.getElementById('subsidyReportModal');
            if (m) m.style.display = 'none';
        }
    };
})();
