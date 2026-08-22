// static/js/subsidy-verify.js - 财务核验（独立页）
const SUBSIDY_API = '/api/oa/subsidy';

class SubsidyVerifyApp {
    constructor() {
        this.chat_login_url = '/login/';
        this._adminRecordIds = [];
        this._isVerifier = false;
        this._invoiceVerifyEnabled = false;
        this.adminPage = 1;
        this._detailId = null;
        this._detailInvoiceFile = '';
        this._detailInvoiceImage = '';
        this._rejectId = null;
        this._rejectReason = '';
        this._verifyApprovingId = null;
        this._init();
    }

    async _init() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = this.chat_login_url;
            return;
        }
        // 先完成账户加载（拿到 is_verifier），确保默认加载数据
        await this._loadAccount();
        this.loadAdmin(1);
        // 从工作通知跳转：自动打开对应申领详情，并按申领状态提示
        try {
            const qp = new URLSearchParams(window.location.search);
            const appId = qp.get('application_id');
            if (appId) {
                setTimeout(() => { subsidyVerifyApp._openFromNotification(parseInt(appId, 10)); }, 300);
            }
        } catch (e) { /* ignore */ }
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

    // ===== 工具 =====
    _escape(text) {
        return Utils.escapeHtml ? Utils.escapeHtml(text) : String(text || '').replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
    }
    _jsStr(s) {
        return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }
    _mediaUrl(u) {
        if (!u) return '';
        if (/^https?:\/\//i.test(u) || u.charAt(0) === '/') return u;
        return '/' + u;
    }
    _fmtAmount(n) {
        return Utils.formatAmount ? Utils.formatAmount(n) : Number(n || 0).toFixed(2);
    }
    _fmtTime(iso) {
        if (!iso) return '-';
        try { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return '-'; }
    }
    _fmtDate(v) {
        if (!v) return '-';
        const s = String(v);
        return s.length >= 10 ? s.substring(0, 10) : s;
    }
    _statusBadge(st) {
        const m = {pending: ['待核验', '#e6a23c', '#fdf6ec'], approved: ['已通过', '#67c23a', '#f0f9eb'], rejected: ['已驳回', '#f56c6c', '#fef0f0']};
        const x = m[st] || [st, '#909399', '#f4f4f5'];
        return '<span style="color:' + x[1] + ';background:' + x[2] + ';padding:2px 10px;border-radius:10px;font-size:12px;">' + x[0] + '</span>';
    }
    _typeBadge(t, d) {
        const color = t === 'special' ? '#409eff' : (t === 'ordinary' ? '#e6a23c' : '#909399');
        const bg = t === 'special' ? '#ecf5ff' : (t === 'ordinary' ? '#fdf6ec' : '#f4f4f5');
        return '<span style="color:' + color + ';background:' + bg + ';padding:2px 10px;border-radius:10px;font-size:12px;">' + this._escape(d || t || '-') + '</span>';
    }
    _userCell(name, avatar) {
        return '<span style="display:inline-flex;align-items:center;gap:6px;">'
            + '<img src="' + (avatar || '/static/images/default-avatar.png') + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">'
            + '<span>' + this._escape(name || '') + '</span></span>';
    }

    // ===== 账户与权限 =====
    async _loadAccount() {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/account/');
            if (!d) return;
            this._isVerifier = !!d.is_verifier;
            this._isPaymentStaff = !!d.is_payment_staff;
            this._invoiceVerifyEnabled = !!d.invoice_verify_enabled;
            this._updateRoleNav();
            if (!this._canVerify()) {
                document.getElementById('verifyPageBody').innerHTML = '<div style="text-align:center;padding:60px 20px;color:#909399;font-size:14px;"><i class="fas fa-lock" style="font-size:28px;display:block;margin-bottom:10px;"></i>您没有财务核验权限</div>';
            }
        } catch (e) { /* ignore */ }
    }

    // 顶部导航：财务服务下拉项按角色显隐；导出/打印按钮仅超管或核验人员可见
    _updateRoleNav() {
        const ut = localStorage.getItem('user_type');
        const canVerify = ut === 'super_admin' || !!this._isVerifier;
        const canPay = ut === 'super_admin' || !!this._isPaymentStaff;
        const vi = document.getElementById('subsidyVerifyNavItem');
        const pi = document.getElementById('subsidyPayNavItem');
        if (vi) vi.style.display = canVerify ? 'flex' : 'none';
        if (pi) pi.style.display = canPay ? 'flex' : 'none';
        const eBtn = document.getElementById('vExportBtn');
        const rBtn = document.getElementById('vPrintBtn');
        if (eBtn) eBtn.style.display = canVerify ? '' : 'none';
        if (rBtn) rBtn.style.display = canVerify ? '' : 'none';
        const ci = document.getElementById('subsidyConfigNavItem');
        if (ci) ci.style.display = (ut === 'super_admin' || this._isVerifier || this._isPaymentStaff) ? 'flex' : 'none';
        this._updateFinanceMenuVisibility();
    }

    // 财务服务菜单整体显隐：任一项可见才显示
    _updateFinanceMenuVisibility() {
        const wrap = document.getElementById('financeSvcWrap');
        if (!wrap) return;
        let visible = false;
        ['subsidyConfigNavItem', 'subsidyVerifyNavItem', 'subsidyPayNavItem'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el && el.style.display !== 'none') visible = true;
        });
        wrap.style.display = visible ? 'inline-flex' : 'none';
    }

    // 财务服务下拉切换
    toggleFinanceMenu(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        const ud = document.getElementById('oaUserDropdown');
        if (ud) ud.classList.remove('show');
        const dd = document.getElementById('financeSvcDropdown');
        if (dd) dd.classList.toggle('show');
    }
    _canVerify() {
        return localStorage.getItem('user_type') === 'super_admin' || !!this._isVerifier;
    }

    // ===== 核验列表 =====
    async loadAdmin(page) {
        if (!this._canVerify()) return;
        this.adminPage = page || 1;
        try {
            const data = await this.apiGet(SUBSIDY_API + '/all/?' + this._adminQuery());
            this._renderAdmin(data);
        } catch (e) {
            console.log('加载核验列表失败:::', e)
            this.showToast('加载核验列表失败', true);
        }
    }
    _adminQuery() {
        const ps = document.getElementById('vPageSize');
        const pageSize = ps ? (ps.value || '20') : '20';
        const parts = ['page=' + this.adminPage, 'page_size=' + pageSize];
        const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
        const s = get('vSearch'); if (s) parts.push('search=' + encodeURIComponent(s));
        const st = get('vStatus'); if (st) parts.push('status=' + st);
        const ty = get('vType'); if (ty) parts.push('invoice_type=' + ty);
        const inv = get('vInvNumber'); if (inv) parts.push('invoice_number=' + encodeURIComponent(inv));
        const df = get('vDateFrom'); if (df) parts.push('date_from=' + df);
        const dt = get('vDateTo'); if (dt) parts.push('date_to=' + dt);
        const minA = get('vMinAmount'); if (minA) parts.push('min_amount=' + minA);
        const maxA = get('vMaxAmount'); if (maxA) parts.push('max_amount=' + maxA);
        return parts.join('&');
    }

    resetFilter() {
        ['vSearch', 'vStatus', 'vType', 'vInvNumber', 'vDateFrom', 'vDateTo', 'vMinAmount', 'vMaxAmount'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        this.loadAdmin(1);
    }

    // ===== 勾选与导出/打印 =====
    toggleAll(checked) {
        document.querySelectorAll('.v-row-cb').forEach(function (cb) { cb.checked = checked; });
        this._updateExportPrintBtns();
    }
    _getSelectedIds() {
        const ids = [];
        document.querySelectorAll('.v-row-cb:checked').forEach(function (cb) {
            const id = parseInt(cb.dataset.id);
            if (id) ids.push(id);
        });
        return ids;
    }
    _updateExportPrintBtns() {
        const n = this._getSelectedIds().length;
        const e = document.getElementById('vExportBtn');
        const p = document.getElementById('vPrintBtn');
        if (e) e.style.opacity = n > 0 ? '' : '0.4';
        if (p) p.style.opacity = n > 0 ? '' : '0.4';
    }

    showExportPrintModal(mode) {
        const ids = this._getSelectedIds();
        if (!ids.length) { this.showToast('请先选择要导出/打印的申领记录', true); return; }
        const fields = [
            {key: 'application_no', label: '申领编号'}, {key: 'applicant_name', label: '申请人'},
            {key: 'invoice_type', label: '发票类型'}, {key: 'invoice_number', label: '发票号码'},
            {key: 'invoice_amount', label: '开票金额(元)'}, {key: 'subsidy_amount', label: '补贴金额(元)'},
            {key: 'status', label: '状态'}, {key: 'verified_by', label: '核验人'},
            {key: 'verified_at', label: '核验时间'}, {key: 'created_at', label: '申请时间'},
            {key: 'invoice_issuer', label: '开票主体'}
        ];
        const self = this;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
        const fieldHtml = fields.map(function (f) {
            return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:#f5f7fa;border-radius:6px;cursor:pointer;"><input type="checkbox" class="vef-field-cb" data-key="' + f.key + '" checked> ' + f.label + '</label>';
        }).join('');
        const isPrint = mode === 'print';
        let footerBtns = '<button class="vef-cancel" style="padding:8px 20px;border:1px solid #dcdfe6;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>';
        if (isPrint) {
            footerBtns += '<button class="vef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-print"></i> 打印</button>';
        } else {
            footerBtns += '<button class="vef-cloud" style="padding:8px 20px;background:#16a085;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-cloud-upload-alt"></i> 保存到网盘</button>'
                + '<button class="vef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-download"></i> 导出到本地</button>';
        }
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:520px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,0.18);">'
            + '<div style="padding:16px 20px;border-bottom:1px solid #ebeef5;"><h3 style="margin:0;font-size:16px;"><i class="fas fa-' + (mode === 'print' ? 'print' : 'file-excel') + '" style="color:' + (mode === 'print' ? '#409eff' : '#67c23a') + ';"></i> ' + (mode === 'print' ? '打印' : '导出') + ' 申领记录（已选 ' + ids.length + ' 条）</h3></div>'
            + '<div style="padding:16px 20px;"><p style="margin:0 0 12px;font-size:14px;color:#606266;">选择表格字段：</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + fieldHtml + '</div></div>'
            + '<div style="padding:12px 20px;border-top:1px solid #ebeef5;display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap;">' + footerBtns + '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.vef-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.vef-confirm').onclick = function () {
            const checked = overlay.querySelectorAll('.vef-field-cb:checked');
            const selectedFields = Array.from(checked).map(function (cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showToast('请至少选择一个字段', true); return; }
            const idsArr = self._getSelectedIds();
            if (isPrint) self._doPrintSelected(idsArr, selectedFields);
            else self._doExportSelected(idsArr, selectedFields, 'local');
        };
        const cloudBtn = overlay.querySelector('.vef-cloud');
        if (cloudBtn) cloudBtn.onclick = function () {
            const checked = overlay.querySelectorAll('.vef-field-cb:checked');
            const selectedFields = Array.from(checked).map(function (cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showToast('请至少选择一个字段', true); return; }
            self._doExportSelected(self._getSelectedIds(), selectedFields, 'cloud');
        };
    }

    async _doExportSelected(ids, selectedFields, target) {
        const token = localStorage.getItem('access_token');
        if (!token) { this._handleAuthError(); return; }
        const parts = this._adminQuery().split('&').filter(function (p) { return p.indexOf('page=') !== 0 && p.indexOf('page_size=') !== 0; });
        parts.push('record_ids=' + ids.join(','));
        parts.push('fields=' + selectedFields.join(','));
        const url = SUBSIDY_API + '/export/?' + parts.join('&');
        const now = new Date();
        const d = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const t = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
        const filename = '普惠补贴申领_' + d + '_' + t + '.xlsx';
        this.showToast(target === 'cloud' ? '正在生成并保存到网盘，请稍候...' : '正在导出 Excel，请稍候...', false);
        try {
            const resp = await fetch(url, {headers: TokenManager.getHeaders()});
            if (!resp.ok) throw new Error('导出失败 ' + resp.status);
            const blob = await resp.blob();
            if (target === 'cloud') {
                const file = new File([blob], filename, {type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
                await Utils.uploadToCloud(file, null);
                this.showToast('已保存到网盘', false);
            } else {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                this.showToast('导出成功', false);
            }
        } catch (e) {
            this.showToast('导出失败：' + ((e && e.message) || '请重试'), true);
        }
    }

    async _doPrintSelected(ids, selectedFields) {
        try {
            const parts = this._adminQuery().split('&').filter(function (p) { return p.indexOf('page=') !== 0 && p.indexOf('page_size=') !== 0; });
            parts.push('record_ids=' + ids.join(','));
            parts.push('page=1');
            parts.push('page_size=1000');
            const data = await this.apiGet(SUBSIDY_API + '/all/?' + parts.join('&'));
            const list = data.results || [];
            if (!list.length) { this.showToast('暂无数据可打印', true); return; }
            // 🔧 打印留痕 + 「允许打印」权限门：无权限则拦截
            const printRes = (window.WatermarkManager && WatermarkManager.reportPrint)
                ? await WatermarkManager.reportPrint({page: 'subsidy_verify', target_type: 'subsidy_application', count: list.length})
                : {allowed: true};
            if (printRes && printRes.allowed === false) {
                this.showToast('您没有打印权限，请联系管理员开通', true);
                return;
            }
            const now = new Date();
            const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
                + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            const typeMap = {special: '增值税专用发票', ordinary: '增值税普通发票'};
            const statusMap = {pending: '待核验', approved: '已通过', rejected: '已驳回'};
            const labelMap = {
                application_no: '申领编号', applicant_name: '申请人', invoice_type: '发票类型',
                invoice_number: '发票号码', invoice_amount: '开票金额(元)', subsidy_amount: '补贴金额(元)',
                status: '状态', verified_by: '核验人', verified_at: '核验时间', created_at: '申请时间', invoice_issuer: '开票主体'
            };
            const valueMap = {
                application_no: function (r) { return r.application_no; },
                applicant_name: function (r) { return r.applicant_name || '-'; },
                invoice_type: function (r) { return typeMap[r.invoice_type] || r.invoice_type_display || '-'; },
                invoice_number: function (r) { return r.invoice_number || '-'; },
                invoice_amount: function (r) { return subsidyVerifyApp._fmtAmount(r.invoice_amount); },
                subsidy_amount: function (r) { return subsidyVerifyApp._fmtAmount(r.subsidy_amount); },
                status: function (r) { return statusMap[r.status] || r.status; },
                verified_by: function (r) { return r.verified_by_name || '-'; },
                verified_at: function (r) { return subsidyVerifyApp._fmtTime(r.verified_at); },
                created_at: function (r) { return subsidyVerifyApp._fmtTime(r.created_at); },
                invoice_issuer: function (r) { return r.invoice_issuer || '-'; }
            };
            let thead = '<tr>' + selectedFields.map(function (f) { return '<th>' + subsidyVerifyApp._escape(labelMap[f] || f) + '</th>'; }).join('') + '</tr>';
            let tbody = list.map(function (r) {
                return '<tr>' + selectedFields.map(function (f) { return '<td>' + subsidyVerifyApp._escape((valueMap[f] ? valueMap[f](r) : '')) + '</td>'; }).join('') + '</tr>';
            }).join('');
            const win = window.open('', '_blank');
            if (!win) { this.showToast('请允许浏览器弹出打印窗口', true); return; }
            // 打印样式参考考勤打卡页：print-header 标题+日期，表样式统一；底部打印/关闭按钮也随纸面打印出来
            win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>普惠补贴申领打印</title>'
                + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:20px;color:#333;}'
                + '.print-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}'
                + '.print-title{font-size:20px;font-weight:600;color:#409eff;}'
                + '.print-date{font-size:13px;color:#909399;}'
                + 'table{width:100%;border-collapse:collapse;font-size:13px;}'
                + 'th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;}'
                + 'th{background:#f5f7fa;font-weight:600;}'
                + 'tr:nth-child(even){background:#fafafa;}'
                + '</style></head><body>'
                + '<div class="print-header"><div class="print-title">普惠补贴申领核验记录</div><div class="print-date">打印时间：' + dateStr + '</div></div>'
                + '<table>' + thead + tbody + '</table>'
                + '<div style="text-align:center;margin-top:20px;">'
                + '<button onclick="window.print()" style="padding:8px 24px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">打印</button> '
                + '<button onclick="window.close()" style="padding:8px 24px;background:#fff;color:#606266;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:14px;">返回 / 关闭</button>'
                + '</div></body></html>');
            win.document.close();
            // 🔧 打印默认叠加水印（由管理控制台「打印时添加水印」开关控制）
            const wm = (window.WatermarkManager && WatermarkManager.buildPrintWatermark) ? WatermarkManager.buildPrintWatermark() : null;
            if (wm) {
                if (win.document.head) win.document.head.insertAdjacentHTML('beforeend', '<style>' + wm.css + '</style>');
                if (win.document.body) win.document.body.insertAdjacentHTML('beforeend', wm.html);
            }
        } catch (e) {
            this.showToast((e && e.message) || '打印失败', true);
        }
    }
    _renderAdmin(data) {
        const body = document.getElementById('vListBody');
        const list = data.results || [];
        this._adminRecordIds = list.map(function (r) { return r.id; });
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="14" style="text-align:center;color:#909399;padding:20px;">暂无符合条件的申领</td></tr>';
        } else {
            body.innerHTML = list.map(function (r) {
                let ops = '<button class="btn btn-sm btn-secondary" onclick="subsidyVerifyApp._showDetail(' + r.id + ')"><i class="fas fa-eye"></i> 详情</button>';
                if (r.status === 'pending') {
                    ops += ' <button class="btn btn-sm btn-primary" onclick="subsidyVerifyApp._confirmVerify(' + r.id + ')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-sm btn-danger" onclick="subsidyVerifyApp._openReject(' + r.id + ')"><i class="fas fa-times"></i> 驳回</button>';
                }
                return '<tr>'
                    + '<td><input type="checkbox" class="v-row-cb" data-id="' + r.id + '" onchange="subsidyVerifyApp._updateExportPrintBtns()"></td>'
                    + '<td>' + this._escape(r.application_no) + '</td>'
                    + '<td>' + this._userCell(r.applicant_name, r.applicant_avatar) + '</td>'
                    + '<td>' + this._escape(r.applicant_department || '-') + '</td>'
                    + '<td>' + this._escape(r.applicant_position || '-') + '</td>'
                    + '<td>' + this._typeBadge(r.invoice_type, r.invoice_type_display) + '</td>'
                    + '<td>' + this._escape(r.invoice_number || '-') + '</td>'
                    + '<td>¥' + this._fmtAmount(r.invoice_amount) + '</td>'
                    + '<td style="color:#e6a23c;font-weight:600;">¥' + this._fmtAmount(r.subsidy_amount) + '</td>'
                    + '<td>' + this._statusBadge(r.status) + '</td>'
                    + '<td>' + (r.verified_by_name ? this._userCell(r.verified_by_name, r.verified_by_avatar) : '-') + '</td>'
                    + '<td>' + this._fmtTime(r.verified_at) + '</td>'
                    + '<td>' + this._fmtTime(r.created_at) + '</td>'
                    + '<td style="white-space:nowrap;">' + ops + '</td>'
                    + '</tr>';
            }, this).join('');
        }
        this._renderPagination(data, 'vPagination');
    }
    _renderPagination(data, cid) {
        const wrap = document.getElementById(cid);
        if (!wrap) return;
        const page = data.page || 1;
        const totalPages = data.total_pages || 1;
        this._adminTotalPages = totalPages;
        if (totalPages <= 1) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        let html = '<button class="pagination-btn" onclick="subsidyVerifyApp.loadAdmin(1)"' + (page <= 1 ? ' disabled' : '') + '><i class="fas fa-angle-double-left"></i></button>'
            + '<button class="pagination-btn" onclick="subsidyVerifyApp.loadAdmin(' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '><i class="fas fa-angle-left"></i></button>'
            + '<span style="margin:0 8px;font-size:13px;color:#606266;">' + page + ' / ' + totalPages + '</span>'
            + '<button class="pagination-btn" onclick="subsidyVerifyApp.loadAdmin(' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '><i class="fas fa-angle-right"></i></button>'
            + '<button class="pagination-btn" onclick="subsidyVerifyApp.loadAdmin(' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '><i class="fas fa-angle-double-right"></i></button>';
        wrap.innerHTML = html;
    }

    // ===== 详情模态框 =====
    // 通知跳转：按申领状态提示（不存在/已通过/已驳回）后决定是否打开详情
    async _openFromNotification(id) {
        try {
            const r = await this.apiGet(SUBSIDY_API + '/' + id + '/');
            if (!r) return;
            if (r.status === 'approved') {
                this.showToast('该申领已通过', false);
            } else if (r.status === 'rejected') {
                this.showToast('该申领已驳回', false);
            }
            this._showDetail(id);
        } catch (e) {
            const msg = (e && e.message) || '';
            if (msg && (msg.indexOf('不存在') !== -1 || msg.indexOf('删除') !== -1 || (e && e.status === 404))) {
                this.showToast('该条申领不存在或者已经删除', true);
            } else {
                this.showToast(msg || '加载失败', true);
            }
        }
    }

    _showDetail(id) {
        this._detailId = id;
        this.apiGet(SUBSIDY_API + '/' + id + '/').then(function (r) {
            if (!r) return;
            this._detailInvoiceFile = r.invoice_file || '';
            this._detailInvoiceImage = r.invoice_image || '';
            const canVerify = r.status === 'pending' && this._canVerify();
            const invTypes = [['special', '增值税专用发票'], ['ordinary', '增值税普通发票']];
            const invTypeCell = canVerify
                ? '<select style="width:auto;padding:1px 6px;height:26px;font-size:12px;border:1px solid #dcdfe6;border-radius:4px;" onchange="subsidyVerifyApp._changeInvoiceType(' + r.id + ', this.value)">'
                    + invTypes.map(function (o) {
                        return '<option value="' + o[0] + '"' + (r.invoice_type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                    }).join('') + '</select>'
                : r.invoice_type_display;
            const applicantCell = '<span style="display:inline-flex;align-items:center;gap:6px;">'
                + '<img src="' + (r.applicant_avatar || '/static/images/default-avatar.png') + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">'
                + '<span>' + this._escape(r.applicant_name || '-') + '</span></span>';
            const lines = [
                ['申请人', applicantCell],
                ['部门', r.applicant_department || '-'],
                ['职位', r.applicant_position || '-'],
                ['申领编号', r.application_no],
                ['发票号码', r.invoice_number || '-'],
                ['发票类型', invTypeCell],
                ['票据代码', r.invoice_code || '-'],
                ['开票金额', '¥' + this._fmtAmount(r.invoice_amount)],
                ['开票日期', this._fmtDate(r.invoice_date)],
                ['税率', r.tax_rate || '-'],
                ['购买方名称', r.buyer_name || '-'],
                ['购买方纳税人识别号', r.buyer_tax_no || '-'],
                ['销售方名称', r.invoice_issuer || r.seller_name || '-'],
                ['销售方纳税人识别号', r.seller_tax_no || '-'],
                ['开票人', r.drawer || '-'],
                ['补贴比例', r.subsidy_rate ? (parseFloat(r.subsidy_rate) * 100).toFixed(1) + '%' : '-'],
                ['补贴金额', '¥' + this._fmtAmount(r.subsidy_amount)],
                ['状态', this._statusBadge(r.status)],
                ['驳回原因', r.reject_reason || '-'],
                ['核验人', r.verified_by_name ? this._userCell(r.verified_by_name, r.verified_by_avatar) : '-'],
                ['核验时间', this._fmtTime(r.verified_at)],
                ['申请时间', this._fmtTime(r.created_at)]
            ];
            let leftHtml = '<div style="font-size:13px;font-weight:600;color:#409eff;margin-bottom:8px;"><i class="fas fa-clipboard-list"></i> 申领信息</div>';
            lines.forEach(function (l) {
                leftHtml += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed #eee;font-size:13px;"><span style="color:#909399;flex-shrink:0;">' + l[0] + '</span><span style="text-align:right;">' + l[1] + '</span></div>';
            });
            let rightHtml = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-shrink:0;">'
                + '<div style="font-size:13px;font-weight:600;color:#409eff;"><i class="fas fa-file-invoice"></i> 票据原件</div>'
                + '<div style="display:flex;gap:6px;">'
                + (this._invoiceVerifyEnabled && r.invoice_file
                    ? '<button class="btn btn-sm btn-secondary" id="vInvoiceVerifyBtn" style="font-size:12px;" onclick="subsidyVerifyApp._verifyInvoice(' + r.id + ')" title="（百度智能云提供核验）"><i class="fas fa-shield-alt"></i> 发票验真</button>'
                    : '')
                + (r.invoice_file ? '<button class="btn btn-sm btn-primary" id="vQrScanBtn" style="font-size:12px;" onclick="subsidyVerifyApp._scanQr(' + r.id + ')"><i class="fas fa-qrcode"></i> 二维码扫描</button>' : '')
                + '</div></div>';
            if (r.invoice_file) {
                const fname = r.invoice_original_name || r.invoice_file.split('?')[0].split('/').pop() || '票据文件';
                const fileExt = r.invoice_file.split('?')[0].split('/').pop() || '';
                const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(fname) || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileExt);
                const isPdf = /\.pdf$/i.test(fname) || /\.pdf$/i.test(fileExt);
                const invFile = this._mediaUrl(r.invoice_file);
                const invImg = r.invoice_image ? this._mediaUrl(r.invoice_image) : '';
                const previewUrl = invImg || (isPdf ? SUBSIDY_API + '/invoice-preview/?url=' + encodeURIComponent(invFile) : invFile);
                rightHtml += '<div class="subsidy-detail-invoice">'
                    + '<div id="vQrOverlay" style="display:none;position:absolute;inset:0;z-index:5;background:rgba(2,12,27,0.80);border-radius:8px;overflow:hidden;">'
                    + '<div class="qr-scan-corners"></div><div class="qr-scan-line"></div>'
                    + '<div style="position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#00e5ff;font-size:13px;letter-spacing:2px;font-family:monospace;"><i class="fas fa-sync-alt fa-spin"></i> 正在扫描二维码...</div>'
                    + '</div>';
                if (isImg || isPdf) {
                    // PDF 已转为图片预览，点击后灯箱放大缩放
                    rightHtml += '<img src="' + previewUrl + '" style="max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in;background:#fff;" onclick="subsidyVerifyApp._previewImage(\'' + this._jsStr(previewUrl) + '\',\'' + this._jsStr(fname) + '\')" title="点击放大/缩放查看" onerror="this.style.display=\'none\';var fb=this.parentNode.querySelector(\'.inv-fallback\');if(fb)fb.style.display=\'flex\';">'
                        + '<div class="inv-fallback" style="display:none;align-items:center;justify-content:center;color:#909399;font-size:13px;width:100%;height:100%;"><i class="fas fa-exclamation-circle" style="margin-right:6px;"></i> 票据预览加载失败</div>'
                        + '<span style="position:absolute;bottom:8px;right:10px;font-size:11px;color:#fff;background:rgba(0,0,0,0.45);padding:2px 10px;border-radius:10px;"><i class="fas fa-search-plus"></i> 点击放大/缩放</span>';
                } else {
                    rightHtml += '<iframe src="' + invFile + '" style="width:100%;height:100%;border:none;"></iframe>';
                }
                rightHtml += '</div>';
                rightHtml += '<div id="vQrResult" style="display:none;margin-top:10px;flex-shrink:0;"></div>';
                rightHtml += '<div id="vVerifyResult" style="display:none;margin-top:10px;flex-shrink:0;"></div>';
                // 申请人支付截图（支持预览）
                if (r.payment_proof) {
                    const pname = r.payment_proof_name || r.payment_proof.split('/').pop() || '支付截图';
                    const pIsImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(pname);
                    const pFile = this._mediaUrl(r.payment_proof);
                    const pThumb = pIsImg
                        ? '<img src="' + pFile + '" style="width:56px;height:56px;border-radius:6px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;flex-shrink:0;background:#fff;" onclick="subsidyVerifyApp._previewImage(\'' + this._jsStr(pFile) + '\',\'' + this._jsStr(pname) + '\')" title="点击预览">'
                        : '<div style="width:56px;height:56px;border-radius:6px;border:1px solid #dcdfe6;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;" onclick="window.open(\'' + this._jsStr(pFile) + '\',\'_blank\')" title="点击查看"><i class="fas fa-file-pdf" style="color:#f56c6c;font-size:26px;"></i></div>';
                    rightHtml += '<div style="margin-top:10px;flex-shrink:0;"><span style="color:#909399;font-size:12px;"><i class="fas fa-receipt"></i> 支付截图（申请人）：</span>'
                        + '<div class="subsidy-invoice-preview" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f5f7fa;border:1px solid #dcdfe6;border-radius:8px;">'
                        + pThumb
                        + '<span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">' + this._escape(pname) + '</span></div></div>';
                }
            } else {
                rightHtml += '<div class="subsidy-detail-invoice" style="align-items:center;color:#909399;border-style:dashed;">无票据文件</div>';
            }
            let footer = '<button class="btn btn-secondary" onclick="subsidyVerifyApp._closeModal()">关闭</button>';
            if (canVerify) {
                footer = '<button class="btn btn-secondary" onclick="subsidyVerifyApp._closeModal()">关闭</button>'
                    + '<button class="btn btn-primary" onclick="subsidyVerifyApp._confirmVerify(' + r.id + ')"><i class="fas fa-check"></i> 通过</button>'
                    + '<button class="btn btn-danger" onclick="subsidyVerifyApp._openReject(' + r.id + ')"><i class="fas fa-times"></i> 驳回</button>';
            }
            // 顶部：上一条 / 下一条（核验列表上下文）
            let navHtml = '';
            if (this._adminRecordIds && this._adminRecordIds.length) {
                const idx = this._adminRecordIds.indexOf(id);
                if (idx !== -1) {
                    navHtml = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;background:linear-gradient(90deg,#ecf5ff,#f0f9eb);border-radius:8px;margin-bottom:12px;">'
                        + '<button class="btn btn-sm btn-secondary" onclick="subsidyVerifyApp._navDetail(-1)"><i class="fas fa-chevron-left"></i> 上一条</button>'
                        + '<span style="font-size:13px;color:#606266;font-weight:600;">' + (idx + 1) + ' / ' + this._adminRecordIds.length + '</span>'
                        + '<button class="btn btn-sm btn-secondary" onclick="subsidyVerifyApp._navDetail(1)">下一条 <i class="fas fa-chevron-right"></i></button>'
                        + '</div>';
                }
            }
            this._showModalContent('补贴申领详情', navHtml + '<div class="subsidy-detail-wrap"><div class="subsidy-detail-left">' + leftHtml + '</div><div class="subsidy-detail-right">' + rightHtml + '</div></div>', {width: '960px', footer: footer});
            // 回显验真状态
            if (this._invoiceVerifyEnabled) this._loadInvoiceVerifyStatus(id);
        }.bind(this)).catch(function (e) {
            let msg = (e && e.message) || '';
            if (!msg || msg === 'Failed to fetch') msg = '加载失败';
            this.showToast(msg, true);
        }.bind(this));
    }

    _showModalContent(title, bodyHtml, options) {
        options = options || {};
        const modal = document.getElementById('rejectModal');
        const contentEl = modal.querySelector('.modal-content');
        if (contentEl) {
            contentEl.style.maxWidth = options.width || '520px';
            contentEl.style.width = options.width ? '100%' : '';
        }
        const header = modal.querySelector('.modal-header');
        header.querySelector('h3').innerHTML = '<i class="fas fa-info-circle" style="color:#409eff;"></i> ' + title;
        if (!header.querySelector('.modal-header-actions')) {
            const actions = document.createElement('div');
            actions.className = 'modal-header-actions';
            actions.style.cssText = 'display:flex;align-items:center;gap:6px;';
            const maxBtn = document.createElement('button');
            maxBtn.className = 'maximize-btn';
            maxBtn.innerHTML = '<i class="fas fa-expand"></i>';
            maxBtn.title = '最大化';
            maxBtn.onclick = function () { subsidyVerifyApp.toggleMaximize(maxBtn); };
            actions.appendChild(maxBtn);
            const closeBtn = header.querySelector('.close-btn');
            header.insertBefore(actions, closeBtn);
            actions.appendChild(closeBtn);
        }
        const body = modal.querySelector('.modal-body');
        body.innerHTML = bodyHtml;
        const footer = modal.querySelector('.modal-footer');
        footer.innerHTML = options.footer || '<button class="btn btn-secondary" onclick="subsidyVerifyApp._closeModal()">关闭</button>';
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    _closeModal() {
        const modal = document.getElementById('rejectModal');
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
    }

    toggleMaximize(btn) {
        const content = btn.closest('.modal-content');
        if (content) content.classList.toggle('maximized');
    }

    _previewInvoice(url, name) {
        // 图片（含 PDF 渲染图）→ 灯箱放大预览
        this._previewImage(url, name);
    }

    // 图片灯箱预览（滚轮缩放 + 按钮缩放/适应 + 拖拽平移）
    _previewImage(url, name) {
        if (this._previewOverlay) this._closePreview();
        const overlay = document.createElement('div');
        overlay.id = 'subsidyVerifyPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.9);overflow:hidden;';
        overlay.innerHTML = '<span onclick="subsidyVerifyApp._closePreview()" style="position:fixed;top:20px;right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10001;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.55);border-radius:22px;padding:6px 14px;">'
            + '<button onclick="subsidyVerifyApp._previewZoom(-1)" title="缩小" style="width:30px;height:30px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:16px;cursor:pointer;">−</button>'
            + '<span id="subsidyVerifyZoomLabel" style="color:#fff;font-size:12px;min-width:46px;text-align:center;">100%</span>'
            + '<button onclick="subsidyVerifyApp._previewZoom(1)" title="放大" style="width:30px;height:30px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:16px;cursor:pointer;">+</button>'
            + '<button onclick="subsidyVerifyApp._previewZoom(0)" title="适应窗口" style="padding:4px 10px;border:none;border-radius:14px;background:rgba(255,255,255,0.15);color:#fff;font-size:12px;cursor:pointer;">适应</button>'
            + '</div>'
            + '<div style="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._escape(name || '') + '</div>'
            + '<div id="subsidyVerifyZoomWrap" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;">'
            + '<img id="subsidyVerifyPreviewMainImg" src="' + url + '" style="max-width:92vw;max-height:90vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.5);cursor:grab;user-select:none;transition:transform 0.12s ease-out;">'
            + '</div>';
        document.body.appendChild(overlay);
        this._previewOverlay = overlay;
        this._previewZoomScale = 1;
        this._previewTx = 0;
        this._previewTy = 0;
        const self = this;
        const mainImg = overlay.querySelector('#subsidyVerifyPreviewMainImg');
        const keyHandler = function (e) {
            if (e.key === 'Escape') { self._closePreview(); e.preventDefault(); }
        };
        document.addEventListener('keydown', keyHandler);
        overlay._keyHandler = keyHandler;
        overlay.addEventListener('wheel', function (e) {
            e.preventDefault();
            self._previewZoom(undefined, e.deltaY > 0 ? -0.15 : 0.15);
        }, {passive: false});
        let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
        mainImg.addEventListener('mousedown', function (e) {
            drag = true; sx = e.clientX; sy = e.clientY; ox = self._previewTx; oy = self._previewTy;
            overlay.querySelector('#subsidyVerifyZoomWrap').style.cursor = 'grabbing';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!drag) return;
            self._previewTx = ox + (e.clientX - sx);
            self._previewTy = oy + (e.clientY - sy);
            mainImg.style.transform = 'translate(' + self._previewTx + 'px,' + self._previewTy + 'px) scale(' + self._previewZoomScale + ')';
        });
        document.addEventListener('mouseup', function () {
            drag = false;
            overlay.querySelector('#subsidyVerifyZoomWrap').style.cursor = 'grab';
        });
    }
    _previewZoom(dir, delta) {
        const overlay = this._previewOverlay;
        if (!overlay) return;
        const mainImg = overlay.querySelector('#subsidyVerifyPreviewMainImg');
        if (!mainImg) return;
        let scale = this._previewZoomScale || 1;
        scale += (delta !== undefined) ? delta : (dir > 0 ? 0.25 : -0.25);
        scale = Math.max(0.2, Math.min(5, scale));
        this._previewZoomScale = scale;
        mainImg.style.transform = 'translate(' + (this._previewTx || 0) + 'px,' + (this._previewTy || 0) + 'px) scale(' + scale + ')';
        const label = overlay.querySelector('#subsidyVerifyZoomLabel');
        if (label) label.textContent = Math.round(scale * 100) + '%';
        if (dir === 0) {
            this._previewTx = 0; this._previewTy = 0;
            mainImg.style.transform = 'scale(1)';
            this._previewZoomScale = 1;
            if (label) label.textContent = '100%';
        }
    }
    _closePreview() {
        if (this._previewOverlay) {
            if (this._previewOverlay._keyHandler) document.removeEventListener('keydown', this._previewOverlay._keyHandler);
            this._previewOverlay.remove();
            this._previewOverlay = null;
        }
    }

    // ===== 通过（确认对话框）与驳回 =====
    _confirmVerify(id) {
        this.apiGet(SUBSIDY_API + '/' + id + '/').then(function (r) {
            if (!r) return;
            this._verifyApprovingId = id;
            const html = '<div style="text-align:center;padding:8px 0;">'
                + '<div style="font-size:16px;font-weight:600;color:#303133;margin-bottom:6px;">确认核验通过该申领？</div>'
                + '<div style="font-size:13px;color:#909399;">补贴金额 <span style="color:#e6a23c;font-weight:600;">¥' + this._fmtAmount(r.subsidy_amount) + '</span> 将转入申请人钱包</div>'
                + '<div style="font-size:12px;color:#909399;margin-top:8px;">核验通过后如需支付，由申请人在钱包发起提现，财务支付人员处理。</div>'
                + '</div>';
            const footer = '<button class="btn btn-secondary" onclick="subsidyVerifyApp._closeModal()">取消</button>'
                + '<button class="btn btn-primary" onclick="subsidyVerifyApp._doApprove(' + id + ')"><i class="fas fa-check"></i> 确认通过</button>';
            this._showModalContent('确认核验通过', html, {width: '440px', footer: footer});
        }.bind(this)).catch(function (e) { this.showToast((e && e.message) || '加载失败', true); }.bind(this));
    }

    async _doApprove(id) {
        try {
            await this.apiPost(SUBSIDY_API + '/' + id + '/verify/', {action: 'approve'});
            this.showToast('已通过，补贴已转入申请人钱包', false);
            this.loadAdmin(this.adminPage);
            // 不关闭详情模态框，刷新当前详情（状态变为已通过），便于核验人员继续核验
            this._showDetail(id);
        } catch (e) {
            this.showToast((e && e.message) || '操作失败', true);
        }
    }

    _openReject(id) {
        this._rejectId = id;
        const body = document.getElementById('rejectModal').querySelector('.modal-body');
        body.innerHTML = '<div class="form-group"><label>驳回原因 <span class="required">*</span></label><textarea id="vRejectReason" class="form-textarea" rows="3" placeholder="请填写驳回原因"></textarea></div>';
        const header = document.getElementById('rejectModal').querySelector('.modal-header');
        header.querySelector('h3').innerHTML = '<i class="fas fa-times-circle" style="color:#f56c6c;"></i> 驳回申领';
        const footer = document.getElementById('rejectModal').querySelector('.modal-footer');
        footer.innerHTML = '<button class="btn btn-secondary" onclick="subsidyVerifyApp._closeModal()">取消</button>'
            + '<button class="btn btn-danger" onclick="subsidyVerifyApp._doReject()"><i class="fas fa-times"></i> 确认驳回</button>';
        const modal = document.getElementById('rejectModal');
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    async _doReject() {
        const reason = document.getElementById('vRejectReason').value.trim();
        if (!reason) { this.showToast('请填写驳回原因', true); return; }
        try {
            await this.apiPost(SUBSIDY_API + '/' + this._rejectId + '/verify/', {action: 'reject', reason: reason});
            this.showToast('已驳回', false);
            this.loadAdmin(this.adminPage);
            // 不关闭详情模态框，刷新当前详情（状态变为已驳回），便于核验人员继续核验
            this._showDetail(this._rejectId);
        } catch (e) {
            this.showToast((e && e.message) || '操作失败', true);
        }
    }

    // 详情模态框：上一条 / 下一条切换（到本页首/末条时给出提示，引导用户翻页）
    _navDetail(delta) {
        if (!this._adminRecordIds || !this._adminRecordIds.length) return;
        const idx = this._adminRecordIds.indexOf(this._detailId);
        if (idx === -1) return;
        if (delta < 0 && idx === 0) {
            const total = this._adminTotalPages || 1;
            this.showToast('已经是本页第一条了，当前第 ' + this.adminPage + '/' + total + ' 页，如需查看更多请翻页', true);
            return;
        }
        if (delta > 0 && idx === this._adminRecordIds.length - 1) {
            const total = this._adminTotalPages || 1;
            this.showToast('已经是本页最后一条了，当前第 ' + this.adminPage + '/' + total + ' 页，如需查看更多请翻页', true);
            return;
        }
        const next = this._adminRecordIds[idx + delta];
        if (next == null) return;
        this._showDetail(next);
    }

    // ===== 发票验真 =====
    async _loadInvoiceVerifyStatus(id) {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/' + id + '/invoice-verify-status/');
            if (!d || !d.verified) return;
            this._renderVerifyResult(d);
        } catch (e) { /* ignore */ }
    }
    async _verifyInvoice(id) {
        const btn = document.getElementById('vInvoiceVerifyBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 验真中...'; }
        try {
            const res = await this.apiPost(SUBSIDY_API + '/' + id + '/verify-invoice/', {});
            this._renderVerifyResult({verified: true, result: res.result, result_display: res.result_display, message: res.message, cached: !!res.cached});
        } catch (e) {
            this.showToast((e && e.message) || '验真失败', true);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-alt"></i> 发票验真'; }
        }
    }
    _renderVerifyResult(d) {
        const el = document.getElementById('vVerifyResult');
        const btn = document.getElementById('vInvoiceVerifyBtn');
        if (!el) return;
        const ok = d.result === 'pass';
        el.style.display = 'block';
        el.innerHTML = '<div style="border:1px solid ' + (ok ? '#67c23a' : '#f56c6c') + ';border-radius:8px;background:' + (ok ? '#f0f9eb' : '#fef0f0') + ';padding:9px 12px;font-size:12px;color:' + (ok ? '#67c23a' : '#f56c6c') + ';">'
            + '<i class="fas ' + (ok ? 'fa-check-circle' : 'fa-times-circle') + '" style="margin-right:4px;"></i>'
            + this._escape(d.result_display || (ok ? '验真通过' : '验真失败')) + '（百度智能云提供核验）'
            + (d.message ? '<div style="margin-top:4px;color:#909399;">' + this._escape(d.message) + '</div>' : '')
            + (d.cached ? '<div style="margin-top:4px;color:#c0c4cc;font-size:11px;">（已验真，复用结果）</div>' : '')
            + '</div>';
        if (btn) {
            btn.disabled = true;
            btn.title = '（百度智能云提供核验）'
            btn.innerHTML = '<i class="fas ' + (ok ? 'fa-check-circle' : 'fa-times-circle') + '"></i> ' + (ok ? '验真通过' : '验真失败');
        }
    }

    // ===== 二维码扫描 =====
    async _scanQr(id) {
        const btn = document.getElementById('vQrScanBtn');
        const overlay = document.getElementById('vQrOverlay');
        const resultEl = document.getElementById('vQrResult');
        if (btn) { btn.disabled = true; btn.style.opacity = 0.5; }
        if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
        if (overlay) overlay.style.display = 'block';
        await new Promise(function (r) { setTimeout(r, 1500); });
        try {
            let invoiceFile = this._detailInvoiceImage || this._detailInvoiceFile;
            if (!invoiceFile) {
                const app = await this.apiGet(SUBSIDY_API + '/' + id + '/');
                invoiceFile = (app && (app.invoice_image || app.invoice_file)) || '';
            }
            if (!invoiceFile) throw new Error('无票据文件');
            const res = await this.apiPost(SUBSIDY_API + '/qr-scan/', {url: invoiceFile});
            if (overlay) overlay.style.display = 'none';
            const qrStrings = (res && res.qr_strings) || [];
            const parsed = (res && res.parsed) || {};
            this._renderQrResult(resultEl, id, qrStrings, parsed);
            if (resultEl) resultEl.style.display = 'block';
            if (!qrStrings.length) this.showToast('未识别到二维码，请确认票据图片清晰', true);
        } catch (e) {
            if (overlay) overlay.style.display = 'none';
            if (resultEl) {
                resultEl.innerHTML = '<div style="border:1px solid #f56c6c;border-radius:8px;background:#fef0f0;padding:10px 12px;font-size:12px;color:#f56c6c;">二维码扫描失败：' + this._escape((e && e.message) || '请重试') + '</div>';
                resultEl.style.display = 'block';
            }
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        }
    }
    async _renderQrResult(el, id, qrStrings, parsed) {
        const qr = (qrStrings && qrStrings[0]) || '';
        let app = null;
        try { app = await this.apiGet(SUBSIDY_API + '/' + id + '/'); } catch (e) { /* ignore */ }
        const compare = [
            {label: '发票号码', qrVal: (parsed && parsed.invoice_number) || '', ocrVal: app ? (app.invoice_number || '') : ''},
            {label: '开票金额', qrVal: (parsed && parsed.invoice_amount) || '', ocrVal: app ? this._fmtAmount(app.invoice_amount) : ''},
            {label: '开票日期', qrVal: (parsed && parsed.invoice_date) || '', ocrVal: app ? this._fmtDate(app.invoice_date) : ''},
        ];
        let html = '<div style="border:1px solid #e6a23c;border-radius:8px;background:#fffbe6;padding:9px 12px;font-size:12px;color:#b88230;">'
            + '<i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i> 以下信息仅为发票二维码所含信息，并不代表发票查验真伪的结果。</div>';
        html += '<div style="margin-top:8px;border:1px solid #dcdfe6;border-radius:8px;overflow:hidden;">'
            + '<div style="padding:6px 10px;background:#f5f7fa;font-size:12px;color:#606266;font-weight:600;"><i class="fas fa-qrcode" style="color:#409eff;margin-right:4px;"></i> 二维码原文</div>'
            + '<div style="padding:8px 10px;font-size:12px;color:#303133;word-break:break-all;max-height:90px;overflow-y:auto;font-family:monospace;">' + this._escape(qr || '未识别到二维码') + '</div></div>';
        html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            + '<tr style="background:#f5f7fa;color:#606266;"><th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:left;">字段</th><th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:left;">二维码</th><th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:left;">识别（申领）</th><th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:center;">对比</th></tr>';
        compare.forEach(function (c) {
            const q = c.qrVal || '-';
            const o = c.ocrVal || '-';
            let badge = '<span style="color:#c0c4cc;">—</span>';
            if (c.qrVal && c.ocrVal) {
                badge = String(c.qrVal).trim() === String(c.ocrVal).trim()
                    ? '<span style="color:#67c23a;"><i class="fas fa-check-circle"></i> 一致</span>'
                    : '<span style="color:#f56c6c;"><i class="fas fa-times-circle"></i> 不一致</span>';
            }
            html += '<tr><td style="padding:6px 8px;border:1px solid #dcdfe6;">' + c.label + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #dcdfe6;word-break:break-all;">' + this._escape(q) + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #dcdfe6;word-break:break-all;">' + this._escape(o) + '</td>'
                + '<td style="padding:6px 8px;border:1px solid #dcdfe6;text-align:center;">' + badge + '</td></tr>';
        }, this);
        html += '</table>';
        el.innerHTML = html;
    }

    // ===== 发票类型修改 =====
    async _changeInvoiceType(id, value) {
        try {
            await this.apiPost(SUBSIDY_API + '/' + id + '/update-invoice-type/', {invoice_type: value});
            this.showToast('发票类型已更新，补贴比例/金额已同步', false);
            this._showDetail(id);
        } catch (e) {
            this.showToast((e && e.error) || '修改失败', true);
            this._showDetail(id);
        }
    }

    // ===== 补贴配置（与普惠补贴页一致） =====
    async openConfigModal() {
        this._configType = 'global';
        this._configEditKey = null;
        this._configDeleteId = null;
        this._verifierValues = [];
        this._payStaffValues = [];
        document.getElementById('subConfigType').value = 'global';
        document.querySelectorAll('.config-type-card[data-sub-type]').forEach(function (c) {
            c.classList.remove('active');
            c.style.borderColor = '';
            c.style.background = '';
        });
        const gc = document.querySelector('.config-type-card[data-sub-type="global"]');
        if (gc) { gc.classList.add('active'); gc.style.borderColor = '#409eff'; gc.style.background = '#ecf5ff'; }
        document.getElementById('subsidyConfigForm').style.display = 'none';
        document.getElementById('subsidyConfigFooter').style.display = 'none';
        document.getElementById('subsidyConfigDeleteBtn').style.display = 'none';
        document.getElementById('subsidyConfigEmpty').style.display = 'block';
        document.getElementById('subConfigSubTenantRow').style.display = 'none';
        document.getElementById('subConfigDeptRow').style.display = 'none';
        document.getElementById('subConfigVerifierRes').style.display = 'none';
        document.getElementById('subConfigVerifierSearch').value = '';
        document.getElementById('subConfigVerifierTags').innerHTML = '';
        const rightSel = document.getElementById('subConfigSubTenantSelect');
        if (rightSel) rightSel.innerHTML = '<option value="">请选择子公司</option>';
        await this._loadSubTenants();
        await this._loadConfigList();
        await this._loadDepts();
        document.getElementById('subsidyConfigModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('subsidyConfigModal').classList.add('show');
        }, 10);
    }

    _selectConfigType(type) {
        this._configType = type;
        this._configEditKey = null;
        this._configDeleteId = null;
        this._verifierValues = [];
        document.getElementById('subConfigType').value = type;
        document.querySelectorAll('.config-type-card[data-sub-type]').forEach(function (c) {
            c.classList.remove('active');
            c.style.borderColor = '';
            c.style.background = '';
        });
        const card = document.querySelector('.config-type-card[data-sub-type="' + type + '"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('subConfigSubTenantRow').style.display = type === 'sub_tenant' ? 'block' : 'none';
        document.getElementById('subConfigDeptRow').style.display = type === 'department' ? 'block' : 'none';
        this._resetConfigForm();
        this._loadConfigForType(type);
    }

    _resetConfigForm() {
        document.getElementById('subsidyEnabled').checked = true;
        document.getElementById('subsidyShowInvoiceHeader').checked = false;
        document.getElementById('subsidySpecialRate').value = '1';
        document.getElementById('subsidyOrdinaryRate').value = '0.5';
        document.getElementById('subsidyMaxInvoices').value = '10';
        document.getElementById('subsidyTaxRateThreshold').value = '6';
        document.getElementById('subsidyMinWithdrawAmount').value = '0';
        document.getElementById('subsidyDefaultOcrVersion').value = 'baidu_vat';
        document.getElementById('subsidyOcrCacheTtl').value = '604800';
        document.getElementById('subsidyInvoiceVerifyEnabled').checked = false;
        var ihIds = ['ihName', 'ihTaxNo', 'ihAddress', 'ihPhone', 'ihBank', 'ihBankAccount', 'ihBankName', 'ihCompanyName', 'ihCompanyTaxNo'];
        ihIds.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
        document.querySelectorAll('.ih-show-cb').forEach(function (cb) { cb.checked = true; });
        document.getElementById('subConfigVerifierSearch').value = '';
        document.getElementById('subConfigVerifierRes').style.display = 'none';
        this._verifierValues = [];
        this._renderVerifierTags();
        document.getElementById('subConfigPayStaffSearch').value = '';
        document.getElementById('subConfigPayStaffRes').style.display = 'none';
        this._payStaffValues = [];
        this._renderPayStaffTags();
        document.getElementById('subsidyConfigForm').style.display = 'block';
        document.getElementById('subsidyConfigFooter').style.display = 'flex';
        document.getElementById('subsidyConfigDeleteBtn').style.display = 'none';
        document.getElementById('subsidyConfigEmpty').style.display = 'none';
    }

    async _loadSubTenants() {
        try {
            const resp = await fetch(SUBSIDY_API + '/configs/', {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            const json = await resp.json();
            const subTenants = json.sub_tenants || [];
            const rightSel = document.getElementById('subConfigSubTenantSelect');
            if (rightSel) {
                rightSel.innerHTML = '<option value="">请选择子公司</option>';
                subTenants.forEach(function (st) {
                    const opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = (st.short_name || st.name) + '（' + (st.tenant_type || '公司') + '）';
                    rightSel.appendChild(opt);
                });
            }
        } catch (e) {}
    }

    async _loadDepts() {
        const sel = document.getElementById('subsidyConfigDept');
        if (!sel) return;
        try {
            const resp = await fetch('/api/oa/approval/org_departments/', {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            const data = await resp.json();
            const depts = data.results || [];
            const tree = {};
            depts.forEach(function (d) {
                const pid = d.parent_id != null ? d.parent_id : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });
            let html = '<option value="">集团默认配置</option>';
            const self = this;
            const walk = function (pid, depth) {
                const children = tree[pid] || [];
                children.forEach(function (d) {
                    let prefix = '';
                    for (let j = 0; j < depth; j++) prefix += '—— ';
                    const companyIcon = d.department_type === 'company' ? ' ✈' : '';
                    html += '<option value="' + d.id + '">' + prefix + self._escape(d.name) + companyIcon + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            if (!tree[0] || !tree[0].length) {
                const allIds = {};
                depts.forEach(function (d) { allIds[d.id] = true; });
                const roots = depts.filter(function (d) { return !allIds[d.parent_id]; });
                if (roots.length) {
                    html = '<option value="">集团默认配置</option>';
                    const renderFlat = function (items, depth) {
                        items.forEach(function (d) {
                            let prefix = '';
                            for (let j = 0; j < depth; j++) prefix += '—— ';
                            const companyIcon = d.department_type === 'company' ? ' ✈' : '';
                            html += '<option value="' + d.id + '">' + prefix + self._escape(d.name) + companyIcon + '</option>';
                        });
                    };
                    renderFlat(roots, 0);
                }
            }
            sel.innerHTML = html;
        } catch (e) {}
    }

    async _fetchConfigs() {
        try {
            const resp = await fetch(SUBSIDY_API + '/configs/', {headers: TokenManager.getHeaders()});
            if (!resp.ok) return {results: [], sub_tenants: []};
            return await resp.json();
        } catch (e) {
            return {results: [], sub_tenants: []};
        }
    }

    async _loadConfigList() {
        const container = document.getElementById('subsidyConfigList');
        if (!container) return;
        const json = await this._fetchConfigs();
        const configs = json.results || [];
        const filterType = this._configType || 'global';
        if (!configs.length) {
            container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 0;">暂无配置</div>';
            return;
        }
        const self = this;
        container.innerHTML = configs.map(function (c) {
            if (filterType === 'global' && (c.sub_tenant || c.department)) return '';
            if (filterType === 'sub_tenant' && (!c.sub_tenant || c.department)) return '';
            if (filterType === 'department' && !c.department) return '';
            const label = c.department_name || c.sub_tenant_name || '集团默认';
            let typeTag = '';
            if (c.department) typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#f0f9eb;color:#67c23a;margin-left:4px;">部门</span>';
            else if (c.sub_tenant) typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#fef3e0;color:#e6a23c;margin-left:4px;">子公司</span>';
            else typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#e3f2fd;color:#409eff;margin-left:4px;">集团</span>';
            const sel = self._configEditKey && c.id === self._configEditKey ? ' style="background:#e8f4fd;font-weight:600;"' : '';
            return '<div class="config-list-item"' + sel + ' onclick="subsidyVerifyApp._editConfig(' + c.id + ')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
                + '<span><i class="fas fa-hand-holding-usd" style="color:var(--primary-color,#409eff);margin-right:4px;"></i>' + self._escape(label) + typeTag
                + (c.enabled === false ? ' <span style="font-size:10px;color:#909399;">(停用)</span>' : '')
                + '</span></div>';
        }).join('') || '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 0;">暂无配置</div>';
    }

    async _loadConfigForType(type) {
        const json = await this._fetchConfigs();
        const configs = json.results || [];
        const selSubTenant = document.getElementById('subConfigSubTenantSelect').value;
        const selDept = document.getElementById('subsidyConfigDept').value;
        let cfg = null;
        configs.forEach(function (c) {
            const cSt = c.sub_tenant ? String(c.sub_tenant) : '';
            const cDept = c.department ? String(c.department) : '';
            if (type === 'global' && !c.sub_tenant && !c.department) cfg = c;
            else if (type === 'sub_tenant' && c.sub_tenant && !c.department) {
                if (selSubTenant && cSt === selSubTenant) cfg = c;
            }
            else if (type === 'department' && c.department) {
                if (selDept && cDept === selDept) cfg = c;
            }
        });
        if (cfg) this._fillConfigForm(cfg);
        this._loadConfigList();
    }

    _fillConfigForm(cfg) {
        this._configEditKey = cfg.id;
        this._configDeleteId = cfg.id;
        // 删除配置仅超级管理员可操作（财务核验人员只可查看/保存）
        document.getElementById('subsidyConfigDeleteBtn').style.display = localStorage.getItem('user_type') === 'super_admin' ? '' : 'none';
        const deptSel = document.getElementById('subsidyConfigDept');
        if (deptSel) deptSel.value = cfg.department || '';
        const stSel = document.getElementById('subConfigSubTenantSelect');
        if (stSel) stSel.value = cfg.sub_tenant || '';
        document.getElementById('subsidyEnabled').checked = cfg.enabled !== false;
        document.getElementById('subsidyShowInvoiceHeader').checked = !!cfg.show_invoice_header;
        document.getElementById('subsidySpecialRate').value = cfg.special_rate != null ? (parseFloat(cfg.special_rate) * 100) : 1;
        document.getElementById('subsidyOrdinaryRate').value = cfg.ordinary_rate != null ? (parseFloat(cfg.ordinary_rate) * 100) : 0.5;
        document.getElementById('subsidyMaxInvoices').value = cfg.max_invoices || 10;
        document.getElementById('subsidyTaxRateThreshold').value = cfg.tax_rate_threshold != null ? (parseFloat(cfg.tax_rate_threshold) * 100) : 6;
        document.getElementById('subsidyMinWithdrawAmount').value = cfg.min_withdraw_amount != null ? cfg.min_withdraw_amount : 0;
        document.getElementById('subsidyDefaultOcrVersion').value = cfg.default_ocr_version || 'baidu_vat';
        document.getElementById('subsidyOcrCacheTtl').value = cfg.ocr_cache_ttl != null ? cfg.ocr_cache_ttl : 604800;
        document.getElementById('subsidyInvoiceVerifyEnabled').checked = !!cfg.invoice_verify_enabled;
        var ihMap = {
            ihName: 'invoice_header_name', ihTaxNo: 'invoice_header_tax_no', ihAddress: 'invoice_header_address',
            ihPhone: 'invoice_header_phone', ihBank: 'invoice_header_bank', ihBankAccount: 'invoice_header_bank_account',
            ihBankName: 'invoice_header_bank_name', ihCompanyName: 'company_name', ihCompanyTaxNo: 'company_tax_no'
        };
        Object.keys(ihMap).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = cfg[ihMap[id]] || '';
        });
        // 发票抬头字段显示开关
        var ihShow = cfg.invoice_header_show || {};
        var hasShowCfg = Object.keys(ihShow).length > 0;
        document.querySelectorAll('.ih-show-cb').forEach(function (cb) {
            cb.checked = hasShowCfg ? ihShow[cb.dataset.key] !== false : true;
        });
        this._verifierValues = (cfg.verifiers || (cfg.verifier_ids || []).map(function (id) { return {id: id, name: '#' + id}; })).map(function (v) {
            return {id: v.id, name: v.name || ('#' + v.id), avatar: v.avatar || ''};
        });
        this._renderVerifierTags();
        this._payStaffValues = (cfg.payment_staff || (cfg.payment_staff_ids || []).map(function (id) { return {id: id, name: '#' + id}; })).map(function (v) {
            return {id: v.id, name: v.name || ('#' + v.id), avatar: v.avatar || ''};
        });
        this._renderPayStaffTags();
    }

    async _editConfig(configId) {
        const json = await this._fetchConfigs();
        const configs = json.results || [];
        let cfg = null;
        configs.forEach(function (c) { if (c.id === configId) cfg = c; });
        if (!cfg) return;
        let cardType = 'global';
        if (cfg.sub_tenant && !cfg.department) cardType = 'sub_tenant';
        else if (cfg.department) cardType = 'department';
        this._configType = cardType;
        document.getElementById('subConfigType').value = cardType;
        document.querySelectorAll('.config-type-card[data-sub-type]').forEach(function (c) {
            c.classList.remove('active');
            c.style.borderColor = '';
            c.style.background = '';
        });
        const card = document.querySelector('.config-type-card[data-sub-type="' + cardType + '"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('subConfigSubTenantRow').style.display = cardType === 'sub_tenant' ? 'block' : 'none';
        document.getElementById('subConfigDeptRow').style.display = cardType === 'department' ? 'block' : 'none';
        document.getElementById('subsidyConfigForm').style.display = 'block';
        document.getElementById('subsidyConfigFooter').style.display = 'flex';
        document.getElementById('subsidyConfigEmpty').style.display = 'none';
        this._fillConfigForm(cfg);
        this._loadConfigList();
    }

    _onConfigSubTenantChange() {
        this._configType = 'sub_tenant';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('subConfigType').value = 'sub_tenant';
        document.querySelectorAll('.config-type-card[data-sub-type]').forEach(function (c) {
            c.classList.remove('active');
            c.style.borderColor = '';
            c.style.background = '';
        });
        const card = document.querySelector('.config-type-card[data-sub-type="sub_tenant"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('subConfigSubTenantRow').style.display = 'block';
        document.getElementById('subConfigDeptRow').style.display = 'none';
        this._resetConfigForm();
        this._loadConfigForType('sub_tenant');
    }

    _onConfigDeptChange() {
        this._configType = 'department';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('subConfigType').value = 'department';
        document.querySelectorAll('.config-type-card[data-sub-type]').forEach(function (c) {
            c.classList.remove('active');
            c.style.borderColor = '';
            c.style.background = '';
        });
        const card = document.querySelector('.config-type-card[data-sub-type="department"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('subConfigSubTenantRow').style.display = 'none';
        document.getElementById('subConfigDeptRow').style.display = 'block';
        this._resetConfigForm();
        this._loadConfigForType('department');
    }

    _closeConfigModal() {
        const modal = document.getElementById('subsidyConfigModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    }

    async _saveConfig() {
        if (!this._configType) this._configType = 'global';
        const subTenantId = this._configType === 'sub_tenant' ? document.getElementById('subConfigSubTenantSelect').value : '';
        const deptId = this._configType === 'department' ? document.getElementById('subsidyConfigDept').value : '';
        const specialPct = parseFloat(document.getElementById('subsidySpecialRate').value);
        const ordinaryPct = parseFloat(document.getElementById('subsidyOrdinaryRate').value);
        if (isNaN(specialPct) || specialPct < 0 || specialPct > 100) { this.showAlert('提示', '请填写正确的专用发票补贴比例（0-100）'); return; }
        if (isNaN(ordinaryPct) || ordinaryPct < 0 || ordinaryPct > 100) { this.showAlert('提示', '请填写正确的普通发票补贴比例（0-100）'); return; }
        const maxInv = parseInt(document.getElementById('subsidyMaxInvoices').value, 10);
        if (isNaN(maxInv) || maxInv < 1 || maxInv > 50) { this.showAlert('提示', '一次上传最大票据数量应在 1 - 50 之间'); return; }
        var ihMap = {
            invoice_header_name: 'ihName', invoice_header_tax_no: 'ihTaxNo', invoice_header_address: 'ihAddress',
            invoice_header_phone: 'ihPhone', invoice_header_bank: 'ihBank', invoice_header_bank_account: 'ihBankAccount',
            invoice_header_bank_name: 'ihBankName', company_name: 'ihCompanyName', company_tax_no: 'ihCompanyTaxNo'
        };
        var ihData = {};
        Object.keys(ihMap).forEach(function (k) {
            var el = document.getElementById(ihMap[k]);
            if (el) ihData[k] = el.value.trim();
        });
        const taxRatePct = parseFloat(document.getElementById('subsidyTaxRateThreshold').value);
        if (isNaN(taxRatePct) || taxRatePct < 0 || taxRatePct > 100) { this.showAlert('提示', '请填写正确的税率阈值（0-100）'); return; }
        const minWd = parseFloat(document.getElementById('subsidyMinWithdrawAmount').value);
        if (isNaN(minWd) || minWd < 0) { this.showAlert('提示', '请填写正确的提现最小额度'); return; }
        const ihShow = {};
        document.querySelectorAll('.ih-show-cb').forEach(function (cb) { ihShow[cb.dataset.key] = cb.checked; });
        const payload = {
            enabled: document.getElementById('subsidyEnabled').checked,
            show_invoice_header: document.getElementById('subsidyShowInvoiceHeader').checked,
            invoice_header_show: ihShow,
            special_rate: (specialPct / 100).toFixed(5),
            ordinary_rate: (ordinaryPct / 100).toFixed(5),
            max_invoices: maxInv,
            tax_rate_threshold: (taxRatePct / 100).toFixed(5),
            min_withdraw_amount: minWd.toFixed(2),
            default_ocr_version: document.getElementById('subsidyDefaultOcrVersion').value,
            ocr_cache_ttl: parseInt(document.getElementById('subsidyOcrCacheTtl') ? (document.getElementById('subsidyOcrCacheTtl').value || 604800) : 604800),
            invoice_verify_enabled: document.getElementById('subsidyInvoiceVerifyEnabled').checked,
            verifier_ids: this._verifierValues.map(function (v) { return v.id; }),
            payment_staff_ids: (this._payStaffValues || []).map(function (v) { return v.id; }),
            invoice_header_name: ihData.invoice_header_name,
            invoice_header_tax_no: ihData.invoice_header_tax_no,
            invoice_header_address: ihData.invoice_header_address,
            invoice_header_phone: ihData.invoice_header_phone,
            invoice_header_bank: ihData.invoice_header_bank,
            invoice_header_bank_account: ihData.invoice_header_bank_account,
            invoice_header_bank_name: ihData.invoice_header_bank_name,
            company_name: ihData.company_name,
            company_tax_no: ihData.company_tax_no
        };
        if (subTenantId) payload.sub_tenant_id = subTenantId;
        if (deptId) payload.department_id = deptId;
        try {
            await this.apiPost(SUBSIDY_API + '/save-config/', payload);
            this.showToast('配置已保存', false);
            this._loadConfigList();
            this._loadConfigForType(this._configType);
            // 刷新账户配置，让申领提交页的发票抬头按字段开关即时更新
            this._loadAccount();
        } catch (e) {
            this.showToast('保存失败：' + e.message, true);
        }
    }

    // 清除发票识别缓存（修改识别版本/税率阈值后立即生效）
    async _clearOcrCache() {
        const confirmed = await this.showConfirmDialog('清除发票识别缓存', '确定清除全部发票识别缓存吗？清除后下次识别将重新进行（修改的识别版本/税率阈值立即生效）。', 'danger');
        if (!confirmed) return;
        try {
            const res = await this.apiPost(SUBSIDY_API + '/clear-ocr-cache/', {});
            this.showToast((res && res.message) || '发票识别缓存已清除', false);
        } catch (e) {
            this.showToast('清除失败：' + e.message, true);
        }
    }

    async _deleteConfig() {
        if (!this._configDeleteId) return;
        if (!confirm('确认删除该普惠补贴配置？')) return;
        try {
            const resp = await fetch(SUBSIDY_API + '/delete-config/' + this._configDeleteId + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) { this.showToast('删除失败', true); return; }
            this._configEditKey = null;
            this._configDeleteId = null;
            this._verifierValues = [];
            this._resetConfigForm();
            this.showToast('配置已删除', false);
            this._loadConfigList();
        } catch (e) {
            this.showToast('删除失败', true);
        }
    }

    // ===== 核验人员选择 =====
    async _onVerifierSearch(e) {
        const kw = (e.target.value || '').trim();
        const res = document.getElementById('subConfigVerifierRes');
        if (!res) return;
        if (!kw) { res.style.display = 'none'; return; }
        try {
            const resp = await fetch('/api/oa/approval/search-cc-users/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            const json = await resp.json();
            const users = json.results || [];
            const selectedIds = {};
            this._verifierValues.forEach(function (v) { selectedIds[v.id] = true; });
            res.innerHTML = users.length ? users.map(function (u) {
                const cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="subsidyVerifyApp._addVerifier(' + u.id + ',\'' + this._jsStr(u.name) + '\',\'' + this._jsStr(u.avatar || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + this._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + this._escape(u.position) + '</span>' : '')
                    + '</div>';
            }, this).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            res.style.display = 'block';
        } catch (err) {}
    }

    _addVerifier(id, name, avatar) {
        if (this._verifierValues.some(function (v) { return v.id === id; })) return;
        this._verifierValues.push({id: id, name: name, avatar: avatar || ''});
        this._renderVerifierTags();
        const res = document.getElementById('subConfigVerifierRes');
        if (res) res.style.display = 'none';
        document.getElementById('subConfigVerifierSearch').value = '';
    }

    _removeVerifier(idx) {
        this._verifierValues.splice(idx, 1);
        this._renderVerifierTags();
    }

    _renderVerifierTags() {
        const container = document.getElementById('subConfigVerifierTags');
        if (!container) return;
        if (!this._verifierValues.length) {
            container.innerHTML = '<span style="font-size:12px;color:#c0c4cc;">未选择核验人员（将默认通知企业管理员）</span>';
            return;
        }
        container.innerHTML = this._verifierValues.map(function (v, i) {
            return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:#ecf5ff;border-radius:14px;font-size:12px;margin:2px;">'
                + (v.avatar ? '<img src="' + v.avatar + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user" style="font-size:10px;color:#409eff;"></i>')
                + '<span>' + this._escape(v.name || ('#' + v.id)) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="subsidyVerifyApp._removeVerifier(' + i + ')"></i>'
                + '</span>';
        }, this).join('');
    }

    // ===== 财务支付人员选择 =====
    async _onPayStaffSearch(e) {
        const kw = (e.target.value || '').trim();
        const res = document.getElementById('subConfigPayStaffRes');
        if (!res) return;
        if (!kw) { res.style.display = 'none'; return; }
        try {
            const resp = await fetch('/api/oa/approval/search-cc-users/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            const json = await resp.json();
            const users = json.results || [];
            const selected = {};
            (this._payStaffValues || []).forEach(function (v) { selected[v.id] = true; });
            res.innerHTML = users.length ? users.map(function (u) {
                const cls = selected[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="subsidyVerifyApp._addPayStaff(' + u.id + ',\'' + this._jsStr(u.name) + '\',\'' + this._jsStr(u.avatar || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + this._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + this._escape(u.position) + '</span>' : '')
                    + (selected[u.id] ? '<i class="fas fa-check" style="color:#67c23a;"></i>' : '')
                    + '</div>';
            }, this).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到成员</div>';
            res.style.display = 'block';
        } catch (err) { res.style.display = 'none'; }
    }
    _addPayStaff(id, name, avatar) {
        if (!this._payStaffValues) this._payStaffValues = [];
        if (this._payStaffValues.some(function (v) { return v.id === id; })) return;
        this._payStaffValues.push({id: id, name: name, avatar: avatar || ''});
        this._renderPayStaffTags();
        document.getElementById('subConfigPayStaffRes').style.display = 'none';
        document.getElementById('subConfigPayStaffSearch').value = '';
    }
    _removePayStaff(idx) {
        this._payStaffValues.splice(idx, 1);
        this._renderPayStaffTags();
    }
    _renderPayStaffTags() {
        const container = document.getElementById('subConfigPayStaffTags');
        if (!container) return;
        if (!this._payStaffValues || !this._payStaffValues.length) {
            container.innerHTML = '<span style="font-size:12px;color:#c0c4cc;">未选择支付人员（将默认通知企业管理员）</span>';
            return;
        }
        container.innerHTML = this._payStaffValues.map(function (v, i) {
            return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:#e8f8f0;border-radius:14px;font-size:12px;margin:2px;">'
                + (v.avatar ? '<img src="' + v.avatar + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user" style="font-size:10px;color:#16a085;"></i>')
                + '<span>' + this._escape(v.name || ('#' + v.id)) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="subsidyVerifyApp._removePayStaff(' + i + ')"></i>'
                + '</span>';
        }, this).join('');
    }

    // ===== Toast =====
    showToast(message, isError) {
        let el = document.getElementById('verifyToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'verifyToast';
            el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:8px;font-size:14px;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.15);';
            document.body.appendChild(el);
        }
        el.style.background = isError ? '#f56c6c' : '#67c23a';
        el.textContent = message;
        el.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2600);
    }

    showAlert(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header"><i class="fas fa-info-circle"></i><span>' + this._escape(title) + '</span><button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer"><button class="confirm-dialog-btn confirm">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = () => {
                dialog.classList.remove('show');
                setTimeout(() => { if (dialog.parentNode) document.body.removeChild(dialog); }, 250);
                resolve();
            };
            dialog.querySelector('.confirm').addEventListener('click', close);
            dialog.querySelector('.close-btn').addEventListener('click', close);
            dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }
}

const subsidyVerifyApp = new SubsidyVerifyApp();
window.subsidyVerifyApp = subsidyVerifyApp;
window.subsidyConfigUI = subsidyVerifyApp;
