/**
 * OA 审批「报表与数据分析」（仅超级管理员）
 * 流程效率分析 / 业务统计分析 + 导出 Excel·PDF（ECharts 可视化）
 */
(function () {
    'use strict';
    var OA = '/api/oa';
    var state = { tab: 'overview', start: '', end: '', loading: false, userId: null, userName: '',
                  period: 'month', auditArchived: '' };
    var charts = {};
    // 各标签页对应的后端接口段与导出名
    var TAB_META = {
        overview: { seg: 'report-overview', title: 'OA审批-流程效率分析' },
        business: { seg: 'report-business', title: 'OA审批-业务统计分析' },
        audit: { seg: 'report-audit', title: 'OA审批-审计复盘' }
    };
    function tabMeta() { return TAB_META[state.tab] || TAB_META.overview; }

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
    function fmtDate(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function initRange() {
        var end = new Date();
        var start = new Date();
        start.setDate(end.getDate() - 29);
        state.end = fmtDate(end);
        state.start = fmtDate(start);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildModal() {
        if (document.getElementById('approvalReportModal')) return;
        var css = document.createElement('style');
        css.textContent = ''
            + '#approvalReportModal{position:fixed;inset:0;z-index:150000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:16px;}'
            + '#approvalReportModal .ar-panel{background:var(--bg-primary,#fff);color:var(--text-primary,#303133);border-radius:12px;width:100%;max-width:1080px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.28);}'
            + '#approvalReportModal .ar-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border-color,#ebeef5);flex-wrap:wrap;}'
            + '#approvalReportModal .ar-body{padding:16px 18px;overflow-y:auto;min-height:0;-webkit-overflow-scrolling:touch;}'
            + '#approvalReportModal .ar-tabs{display:flex;gap:8px;margin-bottom:14px;}'
            + '#approvalReportModal .ar-tab{padding:7px 16px;border-radius:8px;border:1px solid var(--border-color,#dcdfe6);cursor:pointer;font-size:13px;background:transparent;color:inherit;}'
            + '#approvalReportModal .ar-tab.active{background:#9b59b6;color:#fff;border-color:#9b59b6;}'
            + '#approvalReportModal .ar-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px;}'
            + '#approvalReportModal .ar-card{background:var(--bg-secondary,#f5f7fa);border-radius:10px;padding:12px;}'
            + '#approvalReportModal .ar-card .v{font-size:20px;font-weight:700;color:#9b59b6;}'
            + '#approvalReportModal .ar-card .l{font-size:12px;color:#909399;margin-top:2px;}'
            + '#approvalReportModal .ar-chart{width:100%;height:280px;margin-bottom:16px;}'
            + '#approvalReportModal .ar-chart.sm{height:240px;}'
            + '#approvalReportModal .ar-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;}'
            + '#approvalReportModal .ar-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--border-color,#dcdfe6);background:transparent;color:inherit;cursor:pointer;font-size:13px;}'
            + '#approvalReportModal .ar-btn.primary{background:#409eff;border-color:#409eff;color:#fff;}'
            + '#approvalReportModal .ar-btn:not(:disabled){transition:all .15s;}'
            + '#approvalReportModal .ar-btn:not(:disabled):hover{border-color:#409eff;color:#409eff;background:rgba(64,158,255,.08);}'
            + '#approvalReportModal .ar-btn:not(:disabled):active{transform:translateY(1px);background:rgba(64,158,255,.18);}'
            + '#approvalReportModal .ar-btn.primary:hover{background:#66b1ff;border-color:#66b1ff;color:#fff;}'
            + '#approvalReportModal .ar-btn.primary:active{background:#3a8ee6;border-color:#3a8ee6;color:#fff;}'
            + '#approvalReportModal .ar-table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;}'
            + '#approvalReportModal .ar-table th,#approvalReportModal .ar-table td{border:1px solid var(--border-color,#ebeef5);padding:6px 10px;text-align:left;}'
            + '#approvalReportModal .ar-table th{background:var(--bg-secondary,#f5f7fa);}'
            + '#approvalReportModal:fullscreen,#approvalReportModal:-webkit-full-screen{padding:0;background:var(--bg-primary,#fff);}'
            + '#approvalReportModal:fullscreen .ar-panel,#approvalReportModal:-webkit-full-screen .ar-panel{max-width:none;width:100vw;height:100vh;max-height:100vh;border-radius:0;}'
            + '#arDestMenu div:hover{background:var(--bg-secondary,#f5f7fa);}'
            + '#approvalReportModal .ar-sec{font-size:13px;font-weight:600;color:#9b59b6;margin:6px 0 8px;}'
            + '@media(max-width:720px){#approvalReportModal .ar-row{grid-template-columns:1fr;}#approvalReportModal .ar-panel{max-height:96vh;}}';
        document.head.appendChild(css);

        var ov = document.createElement('div');
        ov.id = 'approvalReportModal';
        ov.innerHTML = ''
            + '<div class="ar-panel">'
            + '  <div class="ar-head">'
            + '    <i class="fas fa-chart-line" style="color:#9b59b6;font-size:18px;"></i>'
            + '    <b style="font-size:16px;">报表与数据分析</b>'
            + '    <span style="flex:1;"></span>'
            + '    <div style="position:relative;">'
            + '      <input type="text" id="arUserSearch" class="ar-btn" placeholder="按用户筛选" style="padding:5px 8px;width:130px;">'
            + '      <div id="arUserRes" style="display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#dcdfe6);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.16);max-height:220px;overflow-y:auto;z-index:5;min-width:190px;"></div>'
            + '    </div>'
            + '    <span id="arUserChip" style="display:none;font-size:12px;color:#409eff;background:#ecf5ff;border-radius:12px;padding:3px 8px;"></span>'
            + '    <input type="date" id="arStart" class="ar-btn" style="padding:5px 8px;">'
            + '    <span style="color:#909399;">至</span>'
            + '    <input type="date" id="arEnd" class="ar-btn" style="padding:5px 8px;">'
            + '    <button class="ar-btn primary" id="arRefreshBtn"><i class="fas fa-sync"></i> 刷新</button>'
            + '    <button class="ar-btn" id="arFullBtn" title="全屏"><i class="fas fa-expand"></i></button>'
            + '    <button class="ar-btn" onclick="document.getElementById(\'approvalReportModal\').style.display=\'none\'"><i class="fas fa-times"></i></button>'
            + '  </div>'
            + '  <div class="ar-body">'
            + '    <div class="ar-tabs">'
            + '      <button class="ar-tab active" data-tab="overview">流程效率分析</button>'
            + '      <button class="ar-tab" data-tab="business">业务统计分析</button>'
            + '      <button class="ar-tab" data-tab="audit">审计复盘</button>'
            + '      <select id="arPeriod" class="ar-btn" style="display:none;padding:5px 8px;" onchange="ApprovalReport.setPeriod(this.value)">'
            + '        <option value="month">按月度汇总</option>'
            + '        <option value="quarter">按季度汇总</option>'
            + '        <option value="year">按年度汇总</option>'
            + '      </select>'
            + '      <select id="arAuditArchived" class="ar-btn" style="display:none;padding:5px 8px;" onchange="ApprovalReport.setAuditArchived(this.value)">'
            + '        <option value="">全部（含已归档）</option>'
            + '        <option value="1">仅已归档</option>'
            + '        <option value="0">仅未归档</option>'
            + '      </select>'
            + '      <span style="flex:1;"></span>'
            + '      <button class="ar-btn" id="arExportXlsx"><i class="fas fa-file-excel" style="color:#16a085;"></i> 导出Excel</button>'
            + '      <button class="ar-btn" id="arExportPdf"><i class="fas fa-file-pdf" style="color:#f56c6c;"></i> 导出PDF</button>'
            + '      <button class="ar-btn" id="arPrintBtn"><i class="fas fa-print"></i> 打印</button>'
            + '    </div>'
            + '    <div id="arContent"><div style="padding:40px;text-align:center;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中…</div></div>'
            + '  </div>'
            + '  <div class="ar-foot" style="padding:10px 18px;border-top:1px solid var(--border-color,#ebeef5);text-align:right;">'
            + '    <button class="ar-btn" onclick="ApprovalReport.close()"><i class="fas fa-times"></i> 关闭</button>'
            + '  </div>'
            + '</div>';
        document.body.appendChild(ov);
        ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
        ov.querySelectorAll('.ar-tab').forEach(function (b) {
            b.addEventListener('click', function () {
                state.tab = b.getAttribute('data-tab');
                ov.querySelectorAll('.ar-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
                syncAuditControls();
                load();
            });
        });
        document.getElementById('arRefreshBtn').addEventListener('click', function () {
            state.start = document.getElementById('arStart').value;
            state.end = document.getElementById('arEnd').value;
            load();
        });
        document.getElementById('arExportXlsx').addEventListener('click', function () { showDestMenu(this, 'xlsx'); });
        document.getElementById('arExportPdf').addEventListener('click', function () { showDestMenu(this, 'pdf'); });
        document.getElementById('arPrintBtn').addEventListener('click', function () { printReport(); });
        // 切换日期范围后自动刷新
        document.getElementById('arStart').addEventListener('change', function () { state.start = this.value; load(); });
        document.getElementById('arEnd').addEventListener('change', function () { state.end = this.value; load(); });
        // 全屏切换
        document.getElementById('arFullBtn').addEventListener('click', function () {
            var m = document.getElementById('approvalReportModal');
            if (document.fullscreenElement || document.webkitFullscreenElement) {
                (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            } else if (m.requestFullscreen) { m.requestFullscreen(); }
            else if (m.webkitRequestFullscreen) { m.webkitRequestFullscreen(); }
        });
        // 按用户筛选：搜索用户后查看该用户的报表数据
        var _usEl = document.getElementById('arUserSearch');
        if (_usEl) {
            var _uTimer = null;
            _usEl.addEventListener('input', function () {
                clearTimeout(_uTimer);
                var kw = this.value.trim();
                var resEl = document.getElementById('arUserRes');
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
                if (!e.target.closest('#arUserRes') && e.target !== _usEl) {
                    var r2 = document.getElementById('arUserRes');
                    if (r2) r2.style.display = 'none';
                }
            });
        }
        var onFsChange = function () {
            var on = !!(document.fullscreenElement || document.webkitFullscreenElement);
            var b = document.getElementById('arFullBtn');
            if (b) b.innerHTML = on ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
            setTimeout(function () { Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); }); }, 120);
        };
        document.addEventListener('fullscreenchange', onFsChange);
        document.addEventListener('webkitfullscreenchange', onFsChange);
        window.addEventListener('resize', function () {
            Object.keys(charts).forEach(function (k) { if (charts[k] && charts[k].resize) charts[k].resize(); });
        });
    }

    // 审计标签页专属控件（汇总粒度 / 归档筛选）显隐
    function syncAuditControls() {
        var on = state.tab === 'audit';
        var p = document.getElementById('arPeriod');
        if (p) { p.style.display = on ? '' : 'none'; p.value = state.period || 'month'; }
        var a = document.getElementById('arAuditArchived');
        if (a) { a.style.display = on ? '' : 'none'; a.value = state.auditArchived || ''; }
    }

    function card(v, l) { return '<div class="ar-card"><div class="v">' + esc(v) + '</div><div class="l">' + esc(l) + '</div></div>'; }
    function fmtMoney(v) { return '¥' + Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
    function fmtMin(v) {
        v = Number(v || 0);
        if (v >= 1440) return (v / 1440).toFixed(1) + '天';
        if (v >= 60) return (v / 60).toFixed(1) + '小时';
        return v.toFixed(1) + '分钟';
    }
    function renderUserChip() {
        var chip = document.getElementById('arUserChip');
        if (!chip) return;
        if (state.userId) {
            chip.style.display = 'inline-block';
            chip.innerHTML = '<i class="fas fa-user"></i> ' + esc(state.userName || ('#' + state.userId))
                + ' <i class="fas fa-times" style="cursor:pointer;margin-left:4px;" title="清除用户筛选" onclick="ApprovalReport.clearUser()"></i>';
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
        var content = document.getElementById('arContent');
        var blocks = [];
        function cellsOf(tr) {
            return Array.prototype.map.call(tr.children, function (td) {
                return (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim();
            });
        }
        function walk(node) {
            Array.prototype.forEach.call(node.children, function (el) {
                var cls = el.classList || {};
                if (cls.contains('ar-cards')) {
                    var rows = [];
                    el.querySelectorAll('.ar-card').forEach(function (c) {
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
                if (cls.contains('ar-chart')) {
                    var inst = charts[el.id];
                    if (inst && inst.getDataURL) {
                        try {
                            blocks.push({ kind: 'image', data: inst.getDataURL({ type: 'png', pixelRatio: 1.5, backgroundColor: '#fff' }) });
                        } catch (e) { /* ignore */ }
                    }
                    return;
                }
                if (cls.contains('ar-sec')) {
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
            + (state.tab === 'audit' ? ('　汇总粒度：' + ({ month: '月度', quarter: '季度', year: '年度' }[state.period] || '月度')) : '')
            + (state.userId ? ('　筛选用户：' + (state.userName || state.userId)) : '');
    }
    // 打印当前模态框内容（图表以图片、表格以表格输出）
    function printReport() {
        var blocks = collectBlocks();
        if (!blocks.length) { toast('暂无可打印的内容', true); return; }
        var title = tabMeta().title;
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<title>' + esc(title) + '</title><style>'
            + 'body{font-family:"Microsoft YaHei",sans-serif;padding:20px 20px 76px;margin:0;color:#333;}'
            + 'h1{font-size:20px;margin:0 0 4px;} .sub{font-size:12px;color:#909399;margin-bottom:14px;}'
            + 'h3{font-size:14px;color:#409eff;margin:16px 0 6px;}'
            + 'table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;}'
            + 'th,td{border:1px solid #dcdfe6;padding:6px 8px;text-align:left;} th{background:#f5f7fa;}'
            + 'img{max-width:100%;display:block;margin:8px 0;}'
            + '.rp-bar{position:fixed;left:0;right:0;bottom:0;height:auto;min-height:56px;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #ebeef5;box-shadow:0 -2px 8px rgba(0,0,0,.08);z-index:999;}'
            + '.rp-bar .rp-tt{flex:1;min-width:0;font-size:13px;font-weight:600;color:#303133;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
            + '.rp-bar button{flex:0 0 auto;height:38px;padding:0 20px;border:1px solid #dcdfe6;background:#fff;color:#606266;border-radius:6px;font-size:14px;cursor:pointer;}'
            + '.rp-bar button.rp-close{background:#409eff;border-color:#409eff;color:#fff;}'
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

    function chart(id, option) {
        var el = document.getElementById(id);
        if (!el || !window.echarts) return;
        if (charts[id]) { try { charts[id].dispose(); } catch (e) { /* ignore */ } charts[id] = null; }
        var c = window.echarts.init(el);
        c.setOption(option);
        charts[id] = c;
    }
    var axisColor = '#909399';
    function baseAxis() {
        return {
            axisLine: { lineStyle: { color: axisColor } },
            axisLabel: { color: axisColor, fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(144,147,153,.18)' } }
        };
    }

    function renderOverview(d) {
        var s = d.summary || {};
        var h = '<div class="ar-cards">'
            + card(s.total || 0, '审批总数')
            + card(s.approved || 0, '已通过')
            + card(s.rejected || 0, '已驳回')
            + card(s.backlog || 0, '积压量')
            + card(fmtMin(s.avg_minutes), '平均审批时长')
            + card(fmtMin(s.max_minutes), '最长审批时长')
            + card((s.reject_rate || 0) + '%', '驳回率')
            + card((s.timeout_rate || 0) + '%', '超时率(' + (d.timeout_days || 3) + '天)')
            + '</div>';
        h += '<div id="arTrend" class="ar-chart"></div>';
        h += '<div class="ar-row"><div id="arTypeBar" class="ar-chart sm"></div><div id="arNodeBar" class="ar-chart sm"></div></div>';
        document.getElementById('arContent').innerHTML = h;
        var trend = d.trend || [];
        chart('arTrend', {
            tooltip: { trigger: 'axis' },
            grid: { left: 40, right: 20, top: 24, bottom: 30 },
            xAxis: Object.assign({ type: 'category', data: trend.map(function (x) { return x.date; }) }, baseAxis()),
            yAxis: Object.assign({ type: 'value' }, baseAxis()),
            series: [{ name: '发起量', type: 'line', smooth: true, data: trend.map(function (x) { return x.count; }), areaStyle: { opacity: .15 }, itemStyle: { color: '#9b59b6' } }]
        });
        var types = d.by_type || [];
        chart('arTypeBar', {
            tooltip: { trigger: 'axis' },
            grid: { left: 80, right: 20, top: 24, bottom: 20 },
            xAxis: Object.assign({ type: 'value' }, baseAxis()),
            yAxis: Object.assign({ type: 'category', data: types.map(function (x) { return x.name; }) }, baseAxis()),
            series: [{ type: 'bar', data: types.map(function (x) { return x.count; }), itemStyle: { color: '#409eff' } }]
        });
        var nodes = d.node_avg || [];
        chart('arNodeBar', {
            tooltip: { trigger: 'axis' },
            grid: { left: 40, right: 20, top: 24, bottom: 30 },
            xAxis: Object.assign({ type: 'category', data: nodes.map(function (x) { return '第' + x.node + '节点'; }) }, baseAxis()),
            yAxis: Object.assign({ type: 'value' }, baseAxis()),
            series: [{ name: '平均耗时(分钟)', type: 'bar', data: nodes.map(function (x) { return x.avg_minutes; }), itemStyle: { color: '#e6a23c' } }]
        });
    }

    function renderBusiness(d) {
        var s = d.summary || {};
        var h = '<div class="ar-cards">'
            + card(fmtMoney(s.amount_total), '审批金额合计')
            + card(s.count_approved || 0, '已通过数')
            + card(fmtMoney(s.expense_amount), '报销金额')
            + card(fmtMoney(s.purchase_amount), '采购金额')
            + card(fmtMoney(s.material_amount), '物资金额')
            + card(fmtMoney(s.contract_amount), '合同金额')
            + card(fmtMoney(s.amount_fields_total), '金额字段合计')
            + '</div>';
        h += '<div id="arMonthly" class="ar-chart"></div>';
        h += '<div id="arExpense" class="ar-chart sm"></div>';
        h += '<div id="arDept" class="ar-chart"></div>';
        // 各审批类型金额统计（合并：内置 + 自定义，按金额字段逐行）
        var _ta = (d.type_amounts && d.type_amounts.length) ? d.type_amounts : (d.amount_fields || []);
        h += '<div class="ar-sec"><i class="fas fa-coins" style="color:#e6a23c;"></i> 各审批类型金额统计（内置 + 自定义，已通过审批）</div>';
        if (_ta.length) {
            var _tot = _ta.reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0);
            h += '<table class="ar-table"><thead><tr>'
                + '<th>审批类型</th><th>是否启用</th><th>金额字段</th><th>金额</th><th>笔数</th><th>占比</th>'
                + '</tr></thead><tbody>'
                + _ta.map(function (x) {
                    var pct = _tot > 0 ? ((Number(x.amount) || 0) / _tot * 100).toFixed(1) + '%' : '—';
                    var typeTag = x.is_builtin
                        ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e3f2fd;color:#409eff;margin-left:5px;">内置</span>'
                        : '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#f0f9eb;color:#67c23a;margin-left:5px;">自定义</span>';
                    var stTag = x.enabled === false
                        ? '<span style="font-size:12px;color:#909399;">停用</span>'
                        : '<span style="font-size:12px;color:#67c23a;">启用</span>';
                    return '<tr><td>' + esc(x.type_name) + typeTag + '</td><td>' + stTag + '</td>'
                        + '<td>' + esc(x.field_label) + '</td><td>' + fmtMoney(x.amount) + '</td><td>' + x.count + '</td><td>' + pct + '</td></tr>';
                }).join('')
                + '</tbody></table>';
        } else {
            h += '<div style="font-size:13px;color:#909399;padding:6px 0;">暂无数据</div>';
        }
        if ((d.leave_by_type || []).length) {
            h += '<div class="ar-sec"><i class="fas fa-calendar-day" style="color:#409eff;"></i> 请假统计</div>';
            h += '<table class="ar-table"><thead><tr><th>请假类型</th><th>天数</th><th>次数</th></tr></thead><tbody>'
                + d.leave_by_type.map(function (x) { return '<tr><td>' + esc(x.type) + '</td><td>' + (x.days || 0) + '</td><td>' + x.count + '</td></tr>'; }).join('')
                + '</tbody></table>';
        }
        document.getElementById('arContent').innerHTML = h;
        var monthly = d.monthly || [];
        chart('arMonthly', {
            tooltip: { trigger: 'axis' },
            legend: { data: ['金额', '笔数'], textStyle: { color: axisColor } },
            grid: { left: 60, right: 50, top: 30, bottom: 30 },
            xAxis: Object.assign({ type: 'category', data: monthly.map(function (x) { return x.month; }) }, baseAxis()),
            yAxis: [Object.assign({ type: 'value', name: '金额' }, baseAxis()), Object.assign({ type: 'value', name: '笔数' }, baseAxis())],
            series: [
                { name: '金额', type: 'line', smooth: true, data: monthly.map(function (x) { return x.amount; }), itemStyle: { color: '#16a085' } },
                { name: '笔数', type: 'bar', yAxisIndex: 1, data: monthly.map(function (x) { return x.count; }), itemStyle: { color: '#409eff' } }
            ]
        });
        var exp = d.expense_by_type || [];
        chart('arExpense', {
            tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
            legend: { type: 'scroll', bottom: 0, textStyle: { color: axisColor, fontSize: 11 } },
            series: [{
                type: 'pie', radius: ['38%', '66%'], center: ['50%', '44%'],
                data: exp.map(function (x) { return { name: x.name, value: x.amount }; }),
                label: { color: axisColor, fontSize: 11 }
            }]
        });
        var dept = d.dept_rank || [];
        chart('arDept', {
            tooltip: { trigger: 'axis' },
            grid: { left: 100, right: 30, top: 24, bottom: 20 },
            xAxis: Object.assign({ type: 'value' }, baseAxis()),
            yAxis: Object.assign({ type: 'category', data: dept.slice(0, 12).map(function (x) { return x.name; }).reverse() }, baseAxis()),
            series: [{ type: 'bar', data: dept.slice(0, 12).map(function (x) { return x.amount; }).reverse(), itemStyle: { color: '#9b59b6' } }]
        });
    }

    // 审计复盘：期间汇总 + 月度/季度/年度构成 + 审批类型构成 + 审计台账
    function renderAudit(d) {
        var s = d.summary || {};
        var unit = '笔';
        var h = '<div class="ar-cards">'
            + card(s.total || 0, '审批总数')
            + card(fmtMoney(s.amount_total), '金额合计')
            + card(s.approved || 0, '已通过')
            + card(s.rejected || 0, '已驳回')
            + card(fmtMoney(s.approved_amount), '已通过金额')
            + card((s.reject_rate || 0) + '%', '驳回率')
            + card(s.archived_count || 0, '已归档')
            + card(s.unarchived_count || 0, '未归档')
            + '</div>';
        h += '<div class="ar-sec"><i class="fas fa-calendar-alt" style="color:#409eff;"></i> '
            + esc((d.period_label || '月度') + '构成（' + (d.range && d.range.start ? d.range.start : '') + ' ~ ' + (d.range && d.range.end ? d.range.end : '') + '）')
            + '</div>';
        if ((d.periods || []).length) {
            h += '<table class="ar-table"><thead><tr>'
                + '<th>周期</th><th>笔数</th><th>金额</th><th>已通过</th><th>已驳回</th><th>已归档</th>'
                + '</tr></thead><tbody>'
                + d.periods.map(function (p) {
                    return '<tr><td>' + esc(p.label) + '</td><td>' + p.total + '</td><td>' + fmtMoney(p.amount) + '</td>'
                        + '<td>' + p.approved + '</td><td>' + p.rejected + '</td><td>' + p.archived + '</td></tr>';
                }).join('') + '</tbody></table>';
        } else {
            h += '<div style="font-size:13px;color:#909399;padding:6px 0;">该区间暂无数据</div>';
        }
        if ((d.types || []).length) {
            h += '<div class="ar-sec"><i class="fas fa-layer-group" style="color:#67c23a;"></i> 审批类型构成</div>';
            h += '<table class="ar-table"><thead><tr>'
                + '<th>审批类型</th><th>笔数</th><th>金额</th><th>已通过</th><th>已驳回</th><th>已归档</th>'
                + '</tr></thead><tbody>'
                + d.types.map(function (t) {
                    return '<tr><td>' + esc(t.name) + '</td><td>' + t.total + '</td><td>' + fmtMoney(t.amount) + '</td>'
                        + '<td>' + t.approved + '</td><td>' + t.rejected + '</td><td>' + t.archived + '</td></tr>';
                }).join('') + '</tbody></table>';
        }
        var led = d.ledger || [];
        h += '<div class="ar-sec"><i class="fas fa-clipboard-list" style="color:#e6a23c;"></i> 审计台账明细（共 '
            + (d.summary ? d.summary.total : 0) + ' 条' + (d.ledger_truncated ? '，仅显示最近 ' + led.length + ' 条' : '') + '）</div>';
        if (led.length) {
            h += '<table class="ar-table"><thead><tr>'
                + '<th>审批ID</th><th>审批类型</th><th>审批标题</th><th>申请人</th><th>所属部门</th><th>金额</th>'
                + '<th>状态</th><th>提交时间</th><th>结束时间</th><th>耗时</th><th>归档</th>'
                + '</tr></thead><tbody>'
                + led.map(function (x) {
                    var dur = (x.minutes === null || x.minutes === undefined) ? '—' : fmtMin(x.minutes);
                    var archTag = x.is_archived
                        ? '<span style="color:#e6a23c;" title="归档时间：' + esc(x.archived_at || '-') + '">已归档</span>'
                        : '<span style="color:#909399;">未归档</span>';
                    return '<tr><td>' + x.id + '</td><td>' + esc(x.type_name) + '</td>'
                        + '<td style="max-width:220px;word-break:break-all;">' + esc(x.title) + '</td>'
                        + '<td>' + esc(x.applicant) + '</td><td>' + esc(x.department || '-') + '</td>'
                        + '<td>' + fmtMoney(x.amount) + '</td><td>' + esc(x.status_label) + '</td>'
                        + '<td>' + esc(x.created_at || '-') + '</td><td>' + esc(x.finished_at || '-') + '</td>'
                        + '<td>' + dur + '</td><td>' + archTag + '</td></tr>';
                }).join('') + '</tbody></table>';
        } else {
            h += '<div style="font-size:13px;color:#909399;padding:6px 0;">该区间暂无审批记录</div>';
        }
        document.getElementById('arContent').innerHTML = h;
    }

    async function load() {
        if (state.loading) return;
        state.loading = true;
        var content = document.getElementById('arContent');
        content.innerHTML = '<div style="padding:40px;text-align:center;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中…</div>';
        try {
            await ensureEcharts();
            var seg = tabMeta().seg;
            var url = OA + '/approval/' + seg + '/?start=' + encodeURIComponent(state.start) + '&end=' + encodeURIComponent(state.end) + userParam();
            if (state.tab === 'audit') {
                url += '&period=' + encodeURIComponent(state.period || 'month')
                    + (state.auditArchived ? ('&archived=' + encodeURIComponent(state.auditArchived)) : '');
            }
            var d = await getJSON(url);
            if (state.tab === 'audit') renderAudit(d);
            else if (state.tab === 'business') renderBusiness(d);
            else renderOverview(d);
        } catch (e) {
            content.innerHTML = '<div style="padding:40px;text-align:center;color:#f56c6c;">' + esc(e.message || '加载失败') + '</div>';
            toast(e.message || '加载失败', true);
        } finally {
            state.loading = false;
        }
    }

    function closeDestMenu() {
        var m = document.getElementById('arDestMenu');
        if (m) m.remove();
    }
    function showDestMenu(anchor, format) {
        closeDestMenu();
        var r = anchor.getBoundingClientRect();
        var m = document.createElement('div');
        m.id = 'arDestMenu';
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
        var base = tabMeta().title;
        var name = exportFileName(base, format === 'pdf' ? 'pdf' : 'xlsx');
        var seg = tabMeta().seg;
        try {
            var blob;
            if (format === 'pdf') {
                // PDF：导出模态框当前全部内容（统计 + 表格 + 图表）
                var blocks = collectBlocks();
                if (!blocks.length) throw new Error('暂无可导出的内容');
                var rp = await fetch(OA + '/approval/report-pdf/', {
                    method: 'POST',
                    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ title: base, subtitle: reportSubtitle(), filename: name, blocks: blocks })
                });
                if (!rp.ok) {
                    var ep = await rp.json().catch(function () { return {}; });
                    throw new Error(ep.error || ('导出失败(' + rp.status + ')'));
                }
                blob = await rp.blob();
            } else {
                var url = OA + '/approval/' + seg + '/?export_format=' + format
                    + '&start=' + encodeURIComponent(state.start) + '&end=' + encodeURIComponent(state.end) + userParam();
                if (state.tab === 'audit') {
                    url += '&period=' + encodeURIComponent(state.period || 'month')
                        + (state.auditArchived ? ('&archived=' + encodeURIComponent(state.auditArchived)) : '');
                }
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
                var fid = await ensureCloudFolder('文档（来自审批）');
                await Utils.uploadToCloud(file, fid, 'OA审批报表');
                toast('已保存到我的网盘 / 文档（来自审批）', false);
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

    window.ApprovalReport = {
        open: function (tab) {
            buildModal();
            if (tab && TAB_META[tab]) state.tab = tab;
            var ov = document.getElementById('approvalReportModal');
            ov.querySelectorAll('.ar-tab').forEach(function (x) {
                x.classList.toggle('active', x.getAttribute('data-tab') === state.tab);
            });
            syncAuditControls();
            if (!state.start || !state.end) initRange();
            document.getElementById('arStart').value = state.start;
            document.getElementById('arEnd').value = state.end;
            renderUserChip();
            ov.style.display = 'flex';
            load();
        },
        clearUser: function () {
            state.userId = null;
            state.userName = '';
            renderUserChip();
            load();
        },
        setPeriod: function (v) { state.period = v || 'month'; load(); },
        setAuditArchived: function (v) { state.auditArchived = v || ''; load(); },
        close: function () {
            var m = document.getElementById('approvalReportModal');
            if (m) m.style.display = 'none';
        }
    };
})();
