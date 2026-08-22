// static/js/subsidy-pay.js - 财务支付（独立页）
const SUBSIDY_API = '/api/oa/subsidy';

class SubsidyPayApp {
    constructor() {
        this.chat_login_url = '/login/';
        this._isPaymentStaff = false;
        this.page = 1;
        this._payId = null;
        this._voucherFile = null;
        this._rejectId = null;
        this._init();
    }

    async _init() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = this.chat_login_url;
            return;
        }
        // 先完成账户加载（拿到 is_payment_staff），确保默认加载数据
        await this._loadAccount();
        this.loadList(1);
        // 从工作通知跳转：按提现状态自动打开对应模态框（待支付→支付凭证；已支付/已驳回→详情）
        try {
            const qp = new URLSearchParams(window.location.search);
            const wid = qp.get('withdrawal_id');
            if (wid) {
                setTimeout(() => { subsidyPayApp.openByNotification(parseInt(wid, 10)); }, 300);
            }
        } catch (e) { /* ignore */ }
    }

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
    _userCell(name, avatar) {
        return '<span style="display:inline-flex;align-items:center;gap:6px;"><img src="' + (avatar || '/static/images/default-avatar.png') + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;"><span>' + this._escape(name || '') + '</span></span>';
    }

    // 图片灯箱预览（滚轮缩放 + 按钮缩放/适应 + 拖拽平移）
    _previewImage(url, name) {
        if (this._previewOverlay) this._closePreview();
        const overlay = document.createElement('div');
        overlay.id = 'subsidyPayPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.9);overflow:hidden;';
        overlay.innerHTML = '<span onclick="subsidyPayApp._closePreview()" style="position:fixed;top:20px;right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10001;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.55);border-radius:22px;padding:6px 14px;">'
            + '<button onclick="subsidyPayApp._previewZoom(-1)" title="缩小" style="width:30px;height:30px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:16px;cursor:pointer;">−</button>'
            + '<span id="subsidyPayZoomLabel" style="color:#fff;font-size:12px;min-width:46px;text-align:center;">100%</span>'
            + '<button onclick="subsidyPayApp._previewZoom(1)" title="放大" style="width:30px;height:30px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:16px;cursor:pointer;">+</button>'
            + '<button onclick="subsidyPayApp._previewZoom(0)" title="适应窗口" style="padding:4px 10px;border:none;border-radius:14px;background:rgba(255,255,255,0.15);color:#fff;font-size:12px;cursor:pointer;">适应</button>'
            + '</div>'
            + '<div style="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._escape(name || '') + '</div>'
            + '<div id="subsidyPayZoomWrap" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;">'
            + '<img id="subsidyPayPreviewMainImg" src="' + url + '" style="max-width:92vw;max-height:90vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.5);cursor:grab;user-select:none;transition:transform 0.12s ease-out;">'
            + '</div>';
        document.body.appendChild(overlay);
        this._previewOverlay = overlay;
        this._previewZoomScale = 1;
        this._previewTx = 0;
        this._previewTy = 0;
        const self = this;
        const mainImg = overlay.querySelector('#subsidyPayPreviewMainImg');
        const keyHandler = function (e) {
            if (e.key === 'Escape') { self._closePreview(); e.preventDefault(); }
        };
        document.addEventListener('keydown', keyHandler);
        overlay._keyHandler = keyHandler;
        overlay.addEventListener('wheel', function (e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            self._previewZoom(undefined, delta);
        }, {passive: false});
        let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
        mainImg.addEventListener('mousedown', function (e) {
            drag = true; sx = e.clientX; sy = e.clientY; ox = self._previewTx; oy = self._previewTy;
            overlay.querySelector('#subsidyPayZoomWrap').style.cursor = 'grabbing';
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
            overlay.querySelector('#subsidyPayZoomWrap').style.cursor = 'grab';
        });
    }
    _previewZoom(dir, delta) {
        const overlay = this._previewOverlay;
        if (!overlay) return;
        const mainImg = overlay.querySelector('#subsidyPayPreviewMainImg');
        if (!mainImg) return;
        let scale = this._previewZoomScale || 1;
        scale += (delta !== undefined) ? delta : (dir > 0 ? 0.25 : -0.25);
        scale = Math.max(0.2, Math.min(5, scale));
        this._previewZoomScale = scale;
        mainImg.style.transform = 'translate(' + (this._previewTx || 0) + 'px,' + (this._previewTy || 0) + 'px) scale(' + scale + ')';
        const label = overlay.querySelector('#subsidyPayZoomLabel');
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
    _statusBadge(st) {
        const m = {pending: ['待支付', '#e6a23c', '#fdf6ec'], paid: ['已支付', '#67c23a', '#f0f9eb'], rejected: ['已驳回', '#f56c6c', '#fef0f0']};
        const x = m[st] || [st, '#909399', '#f4f4f5'];
        return '<span style="color:' + x[1] + ';background:' + x[2] + ';padding:2px 10px;border-radius:10px;font-size:12px;">' + x[0] + '</span>';
    }

    async _loadAccount() {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/account/');
            if (!d) return;
            this._isPaymentStaff = !!d.is_payment_staff;
            this._isVerifier = !!d.is_verifier;
            this._updateRoleNav();
            if (!this._canPay()) {
                document.getElementById('payPageBody').innerHTML = '<div style="text-align:center;padding:60px 20px;color:#909399;font-size:14px;"><i class="fas fa-lock" style="font-size:28px;display:block;margin-bottom:10px;"></i>您没有财务支付权限</div>';
            }
        } catch (e) { /* ignore */ }
    }

    // 顶部导航：财务服务下拉项按角色显隐；导出/打印按钮仅超管或支付人员可见
    _updateRoleNav() {
        const ut = localStorage.getItem('user_type');
        const canVerify = ut === 'super_admin' || !!this._isVerifier;
        const canPay = ut === 'super_admin' || !!this._isPaymentStaff;
        const vi = document.getElementById('subsidyVerifyNavItem');
        const pi = document.getElementById('subsidyPayNavItem');
        if (vi) vi.style.display = canVerify ? 'flex' : 'none';
        if (pi) pi.style.display = canPay ? 'flex' : 'none';
        const eBtn = document.getElementById('pExportBtn');
        const rBtn = document.getElementById('pPrintBtn');
        if (eBtn) eBtn.style.display = canPay ? '' : 'none';
        if (rBtn) rBtn.style.display = canPay ? '' : 'none';
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
    _canPay() {
        return localStorage.getItem('user_type') === 'super_admin' || !!this._isPaymentStaff;
    }

    async loadList(page) {
        if (!this._canPay()) return;
        this.page = page || 1;
        // 清除勾选与导出/打印状态
        const selAll = document.getElementById('pSelectAll');
        if (selAll) selAll.checked = false;
        this._updateExportPrintBtns();
        try {
            const ps = document.getElementById('pPageSize');
            const pageSize = ps ? (ps.value || '20') : '20';
            const parts = ['page=' + this.page, 'page_size=' + pageSize];
            const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
            const s = get('pSearch'); if (s) parts.push('search=' + encodeURIComponent(s));
            const st = get('pStatus'); if (st) parts.push('status=' + st);
            const data = await this.apiGet(SUBSIDY_API + '/withdrawals/all/?' + parts.join('&'));
            this._renderList(data);
        } catch (e) { this.showToast('加载提现列表失败', true); }
    }

    // ===== 勾选与导出/打印 =====
    toggleAll(checked) {
        document.querySelectorAll('.p-row-cb').forEach(function (cb) { cb.checked = checked; });
        this._updateExportPrintBtns();
    }
    _getSelectedIds() {
        const ids = [];
        document.querySelectorAll('.p-row-cb:checked').forEach(function (cb) {
            const id = parseInt(cb.dataset.id);
            if (id) ids.push(id);
        });
        return ids;
    }
    _updateExportPrintBtns() {
        const n = this._getSelectedIds().length;
        const e = document.getElementById('pExportBtn');
        const p = document.getElementById('pPrintBtn');
        if (e) e.style.opacity = n > 0 ? '' : '0.4';
        if (p) p.style.opacity = n > 0 ? '' : '0.4';
    }

    showExportPrintModal(mode) {
        const ids = this._getSelectedIds();
        if (!ids.length) { this.showToast('请先选择要导出/打印的提现申请', true); return; }
        const fields = [
            {key: 'user_name', label: '提现人'}, {key: 'user_department', label: '部门'},
            {key: 'amount', label: '提现金额(元)'}, {key: 'remaining_balance', label: '剩余金额(元)'},
            {key: 'status', label: '状态'}, {key: 'requested_at', label: '申请时间'},
            {key: 'paid_at', label: '支付时间'}, {key: 'paid_by', label: '支付人员'},
            {key: 'note', label: '备注'}, {key: 'reject_reason', label: '驳回原因'}
        ];
        const self = this;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
        const fieldHtml = fields.map(function (f) {
            return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:#f5f7fa;border-radius:6px;cursor:pointer;"><input type="checkbox" class="pef-field-cb" data-key="' + f.key + '" checked> ' + f.label + '</label>';
        }).join('');
        const isPrint = mode === 'print';
        let footerBtns = '<button class="pef-cancel" style="padding:8px 20px;border:1px solid #dcdfe6;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>';
        if (isPrint) {
            footerBtns += '<button class="pef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-print"></i> 打印</button>';
        } else {
            footerBtns += '<button class="pef-cloud" style="padding:8px 20px;background:#16a085;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-cloud-upload-alt"></i> 保存到网盘</button>'
                + '<button class="pef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-download"></i> 导出到本地</button>';
        }
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:520px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,0.18);">'
            + '<div style="padding:16px 20px;border-bottom:1px solid #ebeef5;"><h3 style="margin:0;font-size:16px;"><i class="fas fa-' + (mode === 'print' ? 'print' : 'file-excel') + '" style="color:' + (mode === 'print' ? '#409eff' : '#67c23a') + ';"></i> ' + (mode === 'print' ? '打印' : '导出') + ' 提现申请（已选 ' + ids.length + ' 条）</h3></div>'
            + '<div style="padding:16px 20px;"><p style="margin:0 0 12px;font-size:14px;color:#606266;">选择表格字段：</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + fieldHtml + '</div></div>'
            + '<div style="padding:12px 20px;border-top:1px solid #ebeef5;display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap;">' + footerBtns + '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.pef-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.pef-confirm').onclick = function () {
            const checked = overlay.querySelectorAll('.pef-field-cb:checked');
            const selectedFields = Array.from(checked).map(function (cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showToast('请至少选择一个字段', true); return; }
            const idsArr = self._getSelectedIds();
            if (isPrint) self._doPrintSelected(idsArr, selectedFields);
            else self._doExportSelected(idsArr, selectedFields, 'local');
        };
        const cloudBtn = overlay.querySelector('.pef-cloud');
        if (cloudBtn) cloudBtn.onclick = function () {
            const checked = overlay.querySelectorAll('.pef-field-cb:checked');
            const selectedFields = Array.from(checked).map(function (cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showToast('请至少选择一个字段', true); return; }
            self._doExportSelected(self._getSelectedIds(), selectedFields, 'cloud');
        };
    }

    async _doExportSelected(ids, selectedFields, target) {
        const token = localStorage.getItem('access_token');
        if (!token) { this._handleAuthError(); return; }
        const parts = [];
        const st = (document.getElementById('pStatus') || {}).value || '';
        if (st) parts.push('status=' + st);
        const s = (document.getElementById('pSearch') || {}).value || '';
        if (s) parts.push('search=' + encodeURIComponent(s));
        parts.push('record_ids=' + ids.join(','));
        parts.push('fields=' + selectedFields.join(','));
        const url = SUBSIDY_API + '/withdrawals/export/?' + parts.join('&');
        const now = new Date();
        const d = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const t = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
        const filename = '提现申请_' + d + '_' + t + '.xlsx';
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
            const parts = [];
            const st = (document.getElementById('pStatus') || {}).value || '';
            if (st) parts.push('status=' + st);
            const s = (document.getElementById('pSearch') || {}).value || '';
            if (s) parts.push('search=' + encodeURIComponent(s));
            parts.push('record_ids=' + ids.join(','));
            const data = await this.apiGet(SUBSIDY_API + '/withdrawals/all/?' + parts.join('&') + '&page_size=1000');
            const list = data.results || [];
            if (!list.length) { this.showToast('暂无数据可打印', true); return; }
            // 🔧 打印留痕 + 「允许打印」权限门：无权限则拦截
            const printRes = (window.WatermarkManager && WatermarkManager.reportPrint)
                ? await WatermarkManager.reportPrint({page: 'subsidy_pay', target_type: 'subsidy_withdrawal', count: list.length})
                : {allowed: true};
            if (printRes && printRes.allowed === false) {
                this.showToast('您没有打印权限，请联系管理员开通', true);
                return;
            }
            const now = new Date();
            const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
                + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            const statusMap = {pending: '待支付', paid: '已支付', rejected: '已驳回'};
            const labelMap = {
                user_name: '提现人', user_department: '部门', amount: '提现金额(元)', remaining_balance: '剩余金额(元)',
                status: '状态', requested_at: '申请时间', paid_at: '支付时间', paid_by: '支付人员',
                note: '备注', reject_reason: '驳回原因'
            };
            const valueMap = {
                user_name: function (w) { return w.user_name || '-'; },
                user_department: function (w) { return w.user_department || '-'; },
                amount: function (w) { return subsidyPayApp._fmtAmount(w.amount); },
                remaining_balance: function (w) { return subsidyPayApp._fmtAmount(w.remaining_balance); },
                status: function (w) { return statusMap[w.status] || w.status; },
                requested_at: function (w) { return subsidyPayApp._fmtTime(w.requested_at); },
                paid_at: function (w) { return subsidyPayApp._fmtTime(w.paid_at); },
                paid_by: function (w) { return w.paid_by_name || '-'; },
                note: function (w) { return w.note || '-'; },
                reject_reason: function (w) { return w.reject_reason || '-'; }
            };
            let thead = '<tr>' + selectedFields.map(function (f) { return '<th>' + subsidyPayApp._escape(labelMap[f] || f) + '</th>'; }).join('') + '</tr>';
            let tbody = list.map(function (w) {
                return '<tr>' + selectedFields.map(function (f) { return '<td>' + subsidyPayApp._escape((valueMap[f] ? valueMap[f](w) : '')) + '</td>'; }).join('') + '</tr>';
            }).join('');
            const win = window.open('', '_blank');
            if (!win) { this.showToast('请允许浏览器弹出打印窗口', true); return; }
            // 打印样式参考考勤打卡页：print-header 标题+日期，表样式统一；底部打印/关闭按钮也随纸面打印出来
            win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>提现申请打印</title>'
                + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:20px;color:#333;}'
                + '.print-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}'
                + '.print-title{font-size:20px;font-weight:600;color:#16a085;}'
                + '.print-date{font-size:13px;color:#909399;}'
                + 'table{width:100%;border-collapse:collapse;font-size:13px;}'
                + 'th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;}'
                + 'th{background:#f5f7fa;font-weight:600;}'
                + 'tr:nth-child(even){background:#fafafa;}'
                + '</style></head><body>'
                + '<div class="print-header"><div class="print-title">普惠补贴提现申请记录</div><div class="print-date">打印时间：' + dateStr + '</div></div>'
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

    _renderList(data) {
        const body = document.getElementById('pListBody');
        const list = data.results || [];
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#909399;padding:20px;">暂无提现申请</td></tr>';
            return;
        }
        body.innerHTML = list.map(function (w) {
            let ops = '';
            if (w.status === 'pending') {
                ops = '<button class="btn btn-sm btn-primary" onclick="subsidyPayApp.openPayModal(' + w.id + ')"><i class="fas fa-money-check-alt"></i> 支付</button>'
                    + ' <button class="btn btn-sm btn-danger" onclick="subsidyPayApp.openReject(' + w.id + ')"><i class="fas fa-times"></i> 驳回</button>';
            } else {
                // 已支付/已驳回：仅查看详情
                ops = '<button class="btn btn-sm btn-secondary" onclick="subsidyPayApp.viewWithdrawalDetail(' + w.id + ')"><i class="fas fa-eye"></i> 详情</button>';
            }
            const payStaff = w.paid_by_name ? this._userCell(w.paid_by_name, w.paid_by_avatar) : '-';
            return '<tr>'
                + '<td><input type="checkbox" class="p-row-cb" data-id="' + w.id + '" onchange="subsidyPayApp._updateExportPrintBtns()"></td>'
                + '<td>' + this._userCell(w.user_name, w.user_avatar) + '</td>'
                + '<td>' + this._escape(w.user_department || '-') + '</td>'
                + '<td style="color:#e6a23c;font-weight:600;">¥' + this._fmtAmount(w.amount) + '</td>'
                + '<td>¥' + this._fmtAmount(w.remaining_balance) + '</td>'
                + '<td>' + this._statusBadge(w.status) + '</td>'
                + '<td>' + this._fmtTime(w.requested_at) + '</td>'
                + '<td>' + payStaff + '</td>'
                + '<td>' + this._fmtTime(w.paid_at) + '</td>'
                + '<td style="white-space:nowrap;">' + ops + '</td>'
                + '</tr>';
        }, this).join('');
        this._renderPagination(data);
    }

    _renderPagination(data) {
        const wrap = document.getElementById('pPagination');
        if (!wrap) return;
        const page = data.page || 1;
        const totalPages = data.total_pages || 1;
        if (totalPages <= 1) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        wrap.innerHTML = '<button class="pagination-btn" onclick="subsidyPayApp.loadList(1)"' + (page <= 1 ? ' disabled' : '') + '><i class="fas fa-angle-double-left"></i></button>'
            + '<button class="pagination-btn" onclick="subsidyPayApp.loadList(' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '><i class="fas fa-angle-left"></i></button>'
            + '<span style="margin:0 8px;font-size:13px;color:#606266;">' + page + ' / ' + totalPages + '</span>'
            + '<button class="pagination-btn" onclick="subsidyPayApp.loadList(' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '><i class="fas fa-angle-right"></i></button>'
            + '<button class="pagination-btn" onclick="subsidyPayApp.loadList(' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '><i class="fas fa-angle-double-right"></i></button>';
    }

    // ===== 提现详情（已支付/已驳回查看） =====
    async viewWithdrawalDetail(id) {
        try {
            const w = await this.apiGet(SUBSIDY_API + '/withdrawals/' + id + '/');
            if (!w) return;
            const p = w.applicant_payment || {};
            const lines = [
                ['申领人', this._userCell(w.user_name || '-', w.user_avatar)],
                ['部门', this._escape(w.user_department || '-')],
                ['职位', this._escape(w.user_position || '-')],
                ['申领时间', this._fmtTime(w.requested_at)],
                ['申领金额', '¥' + this._fmtAmount(w.amount)],
                ['剩余金额', '¥' + this._fmtAmount(w.remaining_balance)],
                ['已支付金额', w.payment ? '¥' + this._fmtAmount(w.payment.amount) : '-'],
                ['状态', this._statusBadge(w.status)],
                ['支付人员', w.paid_by_name ? this._userCell(w.paid_by_name, w.paid_by_avatar) : '-'],
                ['支付时间', this._fmtTime(w.paid_at)],
                ['备注', this._escape(w.note || '-')],
                ['驳回原因', this._escape(w.reject_reason || '-')],
            ];
            if (p.payee_name) lines.push(['收款人', p.payee_name]);
            if (p.bank_card) lines.push(['银行卡号', p.bank_card]);
            if (p.bank_name) lines.push(['开户银行', p.bank_name]);
            if (p.bank_address) lines.push(['开户银行地址', p.bank_address]);
            if (p.alipay_account) lines.push(['支付宝账号', p.alipay_account]);
            if (p.wechat_account) lines.push(['微信账号', p.wechat_account]);
            let leftHtml = '<div style="font-size:13px;font-weight:600;color:#16a085;margin-bottom:8px;"><i class="fas fa-clipboard-list"></i> 提现信息</div>';
            lines.forEach(function (l) {
                leftHtml += '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed #eee;font-size:13px;"><span style="color:#909399;flex-shrink:0;">' + l[0] + '</span><span style="text-align:right;">' + l[1] + '</span></div>';
            });
            // 收款码（可点击放大预览，不跳新页面）
            let qrCol = '';
            const qrItem = function (u, label) {
                return '<div style="text-align:center;"><img src="' + u + '" style="width:88px;height:88px;max-width:88px;border-radius:8px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;background:#fff;" onclick="subsidyPayApp._previewImage(\'' + subsidyPayApp._jsStr(u) + '\',\'' + label + '\')" title="点击放大预览"><div style="font-size:11px;color:#909399;margin-top:2px;">' + label + '</div></div>';
            };
            if (p.alipay_qr) qrCol += qrItem(this._mediaUrl(p.alipay_qr), '支付宝收款码');
            if (p.wechat_qr) qrCol += qrItem(this._mediaUrl(p.wechat_qr), '微信收款码');
            // 支付截图（可点击放大预览）
            let voucherHtml = '';
            if (w.payment_voucher) {
                const vName = w.payment_voucher_name || '支付凭证';
                const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(vName);
                voucherHtml = isImg
                    ? '<img src="' + this._mediaUrl(w.payment_voucher) + '" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid #dcdfe6;cursor:zoom-in;object-fit:contain;background:#fff;" onclick="subsidyPayApp._previewImage(\'' + this._jsStr(this._mediaUrl(w.payment_voucher)) + '\',\'' + this._jsStr(vName) + '\')" title="点击放大预览">'
                    : '<a href="' + this._mediaUrl(w.payment_voucher) + '" target="_blank"><i class="fas fa-file-pdf" style="color:#f56c6c;font-size:26px;"></i> ' + this._escape(vName) + '</a>';
            }
            const html = '<div style="display:flex;gap:16px;flex-wrap:wrap;">'
                + '<div style="flex:1;min-width:260px;">' + leftHtml + (qrCol ? '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' + qrCol + '</div>' : '') + '</div>'
                + (voucherHtml ? '<div style="flex:0 0 auto;min-width:220px;"><div style="font-size:13px;font-weight:600;color:#67c23a;margin-bottom:8px;"><i class="fas fa-money-check-alt"></i> 支付截图</div>' + voucherHtml + '</div>' : '')
                + '</div>';
            this._showInfoModal('提现申请详情', html);
        } catch (e) {
            this.showToast((e && e.message) || '加载失败', true);
        }
    }

    // ===== 支付 / 驳回 =====
    // 通知跳转：按状态打开（待支付→支付凭证；已支付/已驳回→详情；已支付不可重复支付）
    async openByNotification(id) {
        try {
            const w = await this.apiGet(SUBSIDY_API + '/withdrawals/' + id + '/');
            if (!w) return;
            if (w.status === 'pending') {
                this.openPayModal(id);
            } else {
                this.showToast(w.status === 'paid' ? '该提现已支付' : '该提现已被驳回', w.status === 'rejected');
                this.viewWithdrawalDetail(id);
            }
        } catch (e) {
            const msg = (e && e.message) || '';
            if (msg && (msg.indexOf('不存在') !== -1 || msg.indexOf('删除') !== -1 || (e && e.status === 404))) {
                this.showToast('该条提现申请不存在或者已经删除', true);
            } else {
                this.showToast(msg || '加载失败', true);
            }
        }
    }

    async openPayModal(id) {
        if (!this._canPay()) return;
        this._payId = id;
        this._voucherFile = null;
        try {
            const w = await this.apiGet(SUBSIDY_API + '/withdrawals/' + id + '/');
            if (!w) return;
            if (w.status !== 'pending') {
                // 已支付/已驳回：不能重复支付，打开详情
                this.showToast(w.status === 'paid' ? '该提现已支付，不能重复支付' : '该提现已被驳回', true);
                this.viewWithdrawalDetail(id);
                return;
            }
            const p = w.applicant_payment || {};
            const modal = document.getElementById('payModal');
            const body = modal.querySelector('.modal-body');
            let payee = '<div style="color:#909399;font-size:12px;">未填写收款信息</div>';
            if (p.payee_name || p.bank_card || p.alipay_account || p.wechat_account) {
                payee = '<div style="font-size:13px;line-height:1.8;">'
                    + (p.payee_name ? '<div><span style="color:#909399;">收款人：</span><b>' + this._escape(p.payee_name) + '</b></div>' : '')
                    + (p.bank_card ? '<div><span style="color:#909399;">银行卡号：</span>' + this._escape(p.bank_card) + '</div>' : '')
                    + (p.bank_name ? '<div><span style="color:#909399;">开户银行：</span>' + this._escape(p.bank_name) + '</div>' : '')
                    + (p.bank_address ? '<div><span style="color:#909399;">开户银行地址：</span>' + this._escape(p.bank_address) + '</div>' : '')
                    + (p.alipay_account ? '<div><span style="color:#909399;">支付宝账号：</span>' + this._escape(p.alipay_account) + '</div>' : '')
                    + (p.wechat_account ? '<div><span style="color:#909399;">微信账号：</span>' + this._escape(p.wechat_account) + '</div>' : '')
                    + '</div>';
            }
            // 收款码：可点击放大预览（不跳新页面）；布局自适应（移动端可换行）
            let qrCol = '';
            const qrItem = function (u, label) {
                return '<div style="text-align:center;flex:0 0 auto;"><img src="' + u + '" style="width:88px;height:88px;max-width:88px;border-radius:8px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;background:#fff;" onclick="subsidyPayApp._previewImage(\'' + subsidyPayApp._jsStr(u) + '\',\'' + label + '\')" title="点击放大预览"><div style="font-size:11px;color:#909399;margin-top:2px;">' + label + '</div></div>';
            };
            if (p.alipay_qr) qrCol += qrItem(this._mediaUrl(p.alipay_qr), '支付宝收款码');
            if (p.wechat_qr) qrCol += qrItem(this._mediaUrl(p.wechat_qr), '微信收款码');
            body.innerHTML = '<div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;">'
                + '<div style="flex:1;min-width:200px;">' + payee + '</div>'
                + (qrCol ? '<div style="display:flex;gap:10px;flex-wrap:wrap;flex:0 0 auto;">' + qrCol + '</div>' : '')
                + '</div>'
                + '<div style="display:flex;gap:12px;margin-bottom:12px;">'
                + '<div style="flex:1;background:#fff7e6;border-radius:8px;padding:10px 12px;"><div style="font-size:12px;color:#b88230;">提现额度</div><div style="font-size:20px;font-weight:700;color:#e6a23c;">¥' + this._fmtAmount(w.amount) + '</div></div>'
                + '<div style="flex:1;background:#f0f9f4;border-radius:8px;padding:10px 12px;"><div style="font-size:12px;color:#16a085;">剩余额度</div><div style="font-size:20px;font-weight:700;color:#16a085;">¥' + this._fmtAmount(w.remaining_balance) + '</div></div>'
                + '</div>'
                + '<div style="margin-bottom:8px;"><button class="btn btn-secondary btn-sm" onclick="subsidyPayApp.viewUserRecords(' + w.user + ')"><i class="fas fa-history"></i> 该用户提现记录</button></div>'
                + '<div class="form-group" style="margin-bottom:8px;"><label>支付凭证（付款截图）<span class="required">*</span></label>'
                + '<input type="file" id="pVoucherFile" accept=".jpg,.jpeg,.png,.gif,.webp,.pdf" style="display:none;" onchange="subsidyPayApp._onVoucherSelected(event)">'
                + '<button type="button" class="btn btn-secondary" onclick="document.getElementById(\'pVoucherFile\').click()"><i class="fas fa-paperclip"></i> 上传支付凭证</button>'
                + '<div id="pVoucherPreview" style="margin-top:8px;"></div></div>';
            const footer = modal.querySelector('.modal-footer');
            const isPending = w.status === 'pending';
            footer.innerHTML = '<button class="btn btn-secondary" onclick="subsidyPayApp._closePayModal()">关闭</button>'
                + '<button class="btn btn-danger" onclick="subsidyPayApp.openReject(' + w.id + ')"' + (isPending ? '' : ' disabled') + '><i class="fas fa-times"></i> 驳回</button>'
                + '<button class="btn btn-primary" id="pConfirmBtn" onclick="subsidyPayApp._doPay()"' + (isPending ? '' : ' disabled') + '><i class="fas fa-check"></i> 确认支付</button>';
            modal.querySelector('.modal-header').querySelector('h3').innerHTML = '<i class="fas fa-money-check-alt" style="color:#16a085;"></i> 提现申请 · 上传支付凭证';
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        } catch (e) {
            this.showToast((e && e.message) || '加载失败', true);
        }
    }

    _closePayModal() {
        const modal = document.getElementById('payModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 150);
        }
    }

    async _onVoucherSelected(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const self = this;
        const fd = new FormData();
        fd.append('file', file);
        const resp = await fetch(SUBSIDY_API + '/upload-voucher/', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('access_token')}, body: fd});
        const rd = await resp.json().catch(function () { return {}; });
        if (!resp.ok) { this.showToast(rd.error || '上传失败', true); return; }
        this._voucherFile = {url: rd.url, name: rd.name};
        const el = document.getElementById('pVoucherPreview');
        if (el) el.innerHTML = '<div class="subsidy-invoice-preview" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#f5f7fa;border:1px solid #dcdfe6;border-radius:8px;">'
            + '<i class="fas fa-file-image" style="color:#67c23a;font-size:22px;"></i>'
            + '<span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + this._escape(rd.name || '支付凭证') + '</span>'
            + '<button class="btn btn-sm btn-danger" onclick="subsidyPayApp._removeVoucher()"><i class="fas fa-times"></i></button></div>';
    }

    _removeVoucher() {
        this._voucherFile = null;
        const el = document.getElementById('pVoucherPreview');
        if (el) el.innerHTML = '';
    }

    async _doPay() {
        if (!this._payId) return;
        if (!this._voucherFile) { this.showToast('请先上传支付凭证（付款截图）', true); return; }
        try {
            await this.apiPost(SUBSIDY_API + '/withdrawals/' + this._payId + '/pay/', {
                payment_voucher: this._voucherFile.url,
                payment_voucher_name: this._voucherFile.name
            });
            this._closePayModal();
            this.showToast('提现已支付', false);
            this.loadList(this.page);
        } catch (e) {
            this.showToast((e && e.message) || '支付失败', true);
        }
    }

    openReject(id) {
        this._rejectId = id;
        const modal = document.getElementById('payRejectModal');
        const body = modal.querySelector('.modal-body');
        body.innerHTML = '<div class="form-group"><label>驳回原因 <span class="required">*</span></label><textarea id="pRejectReason" class="form-textarea" rows="3" placeholder="请填写驳回原因，金额将退回用户钱包"></textarea></div>';
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    _closeRejectModal() {
        const modal = document.getElementById('payRejectModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    }

    async _doReject() {
        const reason = document.getElementById('pRejectReason').value.trim();
        if (!reason) { this.showToast('请填写驳回原因', true); return; }
        try {
            await this.apiPost(SUBSIDY_API + '/withdrawals/' + this._rejectId + '/reject/', {reason: reason});
            this._closeRejectModal();
            this._closePayModal();
            this.showToast('已驳回，金额已退回用户钱包', false);
            this.loadList(this.page);
        } catch (e) {
            this.showToast((e && e.message) || '操作失败', true);
        }
    }

    // 查看指定用户的提现记录
    async viewUserRecords(userId) {
        try {
            const data = await this.apiGet(SUBSIDY_API + '/withdrawals/all/?user_id=' + userId + '&page_size=50');
            const list = data.results || [];
            let rows = list.length ? list.map(function (w) {
                return '<tr><td>¥' + this._fmtAmount(w.amount) + '</td><td>' + this._statusBadge(w.status) + '</td><td>' + this._fmtTime(w.requested_at) + '</td><td>' + this._fmtTime(w.paid_at) + '</td></tr>';
            }, this).join('') : '<tr><td colspan="4" style="text-align:center;color:#909399;padding:16px;">暂无记录</td></tr>';
            const html = '<div class="oa-table-container" style="max-height:300px;overflow-y:auto;"><table class="oa-table"><thead><tr><th>金额</th><th>状态</th><th>申请时间</th><th>支付时间</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
            this._showInfoModal('该用户提现记录', html);
        } catch (e) { this.showToast((e && e.message) || '加载失败', true); }
    }

    _showInfoModal(title, bodyHtml) {
        let modal = document.getElementById('payInfoModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'payInfoModal';
            modal.className = 'modal';
            modal.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:2500;align-items:center;justify-content:center;';
            modal.innerHTML = '<div class="modal-content" style="max-width:560px;width:92%;background:#fff;border-radius:12px;max-height:85vh;overflow-y:auto;"><div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #ebeef5;"><h3 style="margin:0;font-size:15px;"></h3><button class="close-btn" style="background:none;border:none;font-size:22px;cursor:pointer;" onclick="subsidyPayApp._closeInfoModal()">&times;</button></div><div class="modal-body" style="padding:16px 18px;"></div></div>';
            document.body.appendChild(modal);
        }
        modal.querySelector('.modal-header h3').innerHTML = title;
        modal.querySelector('.modal-body').innerHTML = bodyHtml;
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }
    _closeInfoModal() {
        const modal = document.getElementById('payInfoModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
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
            return '<div class="config-list-item"' + sel + ' onclick="subsidyPayApp._editConfig(' + c.id + ')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
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
        // 删除配置仅超级管理员可操作（财务支付人员只可查看/保存）
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
        if (!confirm('确定清除全部发票识别缓存吗？清除后下次识别将重新进行（修改的识别版本/税率阈值立即生效）。')) return;
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
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="subsidyPayApp._addVerifier(' + u.id + ',\'' + this._jsStr(u.name) + '\',\'' + this._jsStr(u.avatar || '') + '\')">'
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
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="subsidyPayApp._removeVerifier(' + i + ')"></i>'
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
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="subsidyPayApp._addPayStaff(' + u.id + ',\'' + this._jsStr(u.name) + '\',\'' + this._jsStr(u.avatar || '') + '\')">'
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
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="subsidyPayApp._removePayStaff(' + i + ')"></i>'
                + '</span>';
        }, this).join('');
    }

    showToast(message, isError) {
        let el = document.getElementById('payToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'payToast';
            el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:8px;font-size:14px;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.15);';
            document.body.appendChild(el);
        }
        el.style.background = isError ? '#f56c6c' : '#67c23a';
        el.textContent = message;
        el.style.display = 'block';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { el.style.display = 'none'; }, 2600);
    }

    toggleMaximize(btn) {
        const content = btn.closest('.modal-content');
        if (content) content.classList.toggle('maximized');
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

const subsidyPayApp = new SubsidyPayApp();
window.subsidyPayApp = subsidyPayApp;
window.subsidyConfigUI = subsidyPayApp;
