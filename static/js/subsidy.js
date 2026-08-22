// static/js/subsidy.js - 员工消费普惠补贴
const SUBSIDY_API = '/api/oa/subsidy';
const OA_API_URL = '/api/oa';

class SubsidyApp {
    constructor() {
        this.myPage = 1;
        this.adminPage = 1;
        this.pageSize = 10;
        this._rejectId = null;
        this.chat_login_url = '/login/';
        this._configType = 'global';
        this._configEditKey = null;
        this._configDeleteId = null;
        this._verifierValues = [];
        this._payStaffValues = [];
        this._reSubmitId = null;
        this._adminCardShown = false;
        this._invoiceCards = [];      // 批量票据卡片 [{id,fileUrl,fileName,status,fields...}]
        this._paymentProof = null;    // 支付截图 {url,name}
        this._paymentInfo = null;     // 用户收款信息
        this._maxInvoices = 10;
        this._cardSeq = 0;
        this._ocrQueue = [];
        this._ocrProcessing = false;
        this._init();
    }

    _init() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = this.chat_login_url;
            return;
        }
        this._loadAccount();
        this._loadPaymentInfo();
        this.loadMy(1);
        this.loadPayments();
        this.loadWallet();
        this.loadWithdrawals();
        // 从工作通知跳转：自动打开对应补贴申领详情
        try {
            const qp = new URLSearchParams(window.location.search);
            const appId = qp.get('application_id');
            if (appId) {
                setTimeout(function () { subsidyApp._showDetail(parseInt(appId, 10)); }, 300);
            }
        } catch (e) {}
        const ut = localStorage.getItem('user_type');
        // OCR 下拉框先按角色做一次基础锁定（管理员可改/普通用户锁定）；配置默认版本由 _loadAccount 异步回填
        this._applyOcrVersionPermission();
        // 补贴配置：仅超级管理员或财务核验人员可见（核验身份由 account 接口异步返回后更新）
        this._updateConfigBtnVisibility();
        // 从提现通知跳转：滚动到钱包卡片并刷新
        try {
            const qp2 = new URLSearchParams(window.location.search);
            if (qp2.get('withdrawal_id')) {
                setTimeout(function () {
                    const wc = document.getElementById('subsidyWalletCard');
                    if (wc) wc.scrollIntoView({behavior: 'smooth', block: 'start'});
                    subsidyApp.loadWallet();
                    subsidyApp.loadWithdrawals();
                }, 300);
            }
        } catch (e) { /* ignore */ }
    }

    // 财务服务下拉菜单项显隐（财务核验/财务支付按角色）
    _updateRoleNav() {
        const ut = localStorage.getItem('user_type');
        const canVerify = ut === 'super_admin' || !!this._isVerifier;
        const canPay = ut === 'super_admin' || !!this._isPaymentStaff;
        const vi = document.getElementById('subsidyVerifyNavItem');
        const pi = document.getElementById('subsidyPayNavItem');
        if (vi) vi.style.display = canVerify ? 'flex' : 'none';
        if (pi) pi.style.display = canPay ? 'flex' : 'none';
        this._updateFinanceMenuVisibility();
    }

    // 是否有权限查看/操作核验列表：仅超级管理员或配置的财务核验人员
    _canVerifyList() {
        return localStorage.getItem('user_type') === 'super_admin' || !!this._isVerifier;
    }

    // 补贴配置项：超级管理员、财务核验或财务支付人员可见
    _updateConfigBtnVisibility() {
        const ci = document.getElementById('subsidyConfigNavItem');
        if (!ci) return;
        const ut = localStorage.getItem('user_type');
        ci.style.display = (ut === 'super_admin' || this._isVerifier || this._isPaymentStaff) ? 'flex' : 'none';
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
        const resp = await fetch(url, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify(data || {})
        });
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

    // 嵌入到内联 onclick 单引号字符串时使用，保证引号/反斜杠安全
    _jsStr(s) {
        return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    }

    // 将存储的媒体 URL 规范化为浏览器可访问的绝对路径（兼容 media/... 与 /media/...）
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
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    _fmtDate(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    _statusBadge(status) {
        const map = {
            pending: '<span class="badge-info" style="font-size:11px;padding:2px 8px;border-radius:4px;">待核验</span>',
            approved: '<span class="status-badge normal" style="font-size:11px;padding:2px 8px;border-radius:4px;">已通过</span>',
            rejected: '<span class="status-badge late" style="font-size:11px;padding:2px 8px;border-radius:4px;">已驳回</span>'
        };
        return map[status] || (status || '-');
    }

    // 提现申请状态徽标（待支付/已支付/已驳回）
    _withdrawStatusBadge(status) {
        const map = {
            pending: '<span class="badge-info" style="font-size:11px;padding:2px 8px;border-radius:4px;">待支付</span>',
            paid: '<span class="status-badge normal" style="font-size:11px;padding:2px 8px;border-radius:4px;">已支付</span>',
            rejected: '<span class="status-badge late" style="font-size:11px;padding:2px 8px;border-radius:4px;">已驳回</span>'
        };
        return map[status] || (status || '-');
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

    showError(message) {
        this.showToast(message, true);
    }

    showSuccess(message) {
        this.showToast(message, false);
    }

    // 头像 + 姓名单元格
    _userCell(name, avatarUrl) {
        const img = avatarUrl
            ? '<img src="' + avatarUrl + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid #eee;" onerror="this.style.display=\'none\'">'
            : '<i class="fas fa-user-circle" style="color:#c0c4cc;font-size:20px;flex-shrink:0;"></i>';
        return '<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">' + img + '<span>' + this._escape(name || '-') + '</span></span>';
    }


    // 发票类型标识
    _typeBadge(type, display) {
        if (type === 'special') {
            return '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#ecf5ff;color:#409eff;border:1px solid #b3d8ff;white-space:nowrap;">' + this._escape(display || '增值税专用发票') + '</span>';
        }
        if (type === 'ordinary') {
            return '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:#fef3e0;color:#e6a23c;border:1px solid #f5dab1;white-space:nowrap;">' + this._escape(display || '增值税普通发票') + '</span>';
        }
        return this._escape(display || type || '-');
    }

    // ===== 补贴预览（合计） =====
    _recalc() {
        let total = 0, count = 0;
        (this._invoiceCards || []).forEach(function (c) {
            const amt = parseFloat(c.amount) || 0;
            const rate = c.type === 'special' ? 0.01 : (c.type === 'ordinary' ? 0.005 : 0);
            if (amt > 0 && rate > 0) total += amt * rate;
            count++;
        });
        const el1 = document.getElementById('invCountLabel');
        if (el1) el1.textContent = count;
        const el2 = document.getElementById('subAmountLabel');
        if (el2) el2.textContent = this._fmtAmount(total) + ' 元';
    }

    // ===== 批量上传票据 =====
    _onFilesSelected(e) {
        const files = Array.prototype.slice.call(e.target.files || []);
        e.target.value = '';
        const remaining = this._maxInvoices - this._invoiceCards.length;
        if (remaining <= 0) { this.showToast('已达最大上传数量', true); return; }
        const toUpload = files.slice(0, remaining);
        if (files.length > remaining) this.showToast('最多上传 ' + this._maxInvoices + ' 张，已忽略多余文件', true);
        toUpload.forEach(function (file) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'].includes(ext)) { this.showToast('跳过不支持的文件：' + file.name, true); return; }
            if (file.size > 50 * 1024 * 1024) { this.showToast('文件超过50MB：' + file.name, true); return; }
            this._uploadAndAddCard(file);
        }, this);
    }

    _uploadAndAddCard(file) {
        const card = {
            id: ++this._cardSeq,
            fileUrl: '', fileName: file.name,
            type: '', number: '', code: '', amount: '', date: '', taxRate: '',
            issuer: '', buyerName: '', buyerTaxNo: '', sellerName: '', sellerTaxNo: '', drawer: '',
            status: 'uploading', error: ''
        };
        this._invoiceCards.push(card);
        this._renderInvoiceCards();
        const fd = new FormData();
        fd.append('file', file);
        fetch(SUBSIDY_API + '/upload-invoice/', {
            method: 'POST',
            headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
            body: fd
        }).then(r => r.json()).then(d => {
            if (d.url) {
                card.fileUrl = d.url;
                card.fileName = d.name || file.name;
                card.status = 'ready';
                this._renderInvoiceCards();
                this._enqueueOcr(card);
            } else {
                card.status = 'error';
                card.error = d.error || '上传失败';
                this._renderInvoiceCards();
                this.showToast(d.error || '上传失败', true);
            }
        }).catch(() => { card.status = 'error'; card.error = '上传失败'; this._renderInvoiceCards(); this.showToast('上传失败', true); });
    }

    // 串行 OCR 队列：一次只识别一张，避免并发请求压垮服务器/浏览器
    _enqueueOcr(card) {
        this._ocrQueue.push(card);
        this._processOcrQueue();
    }

    async _processOcrQueue() {
        if (this._ocrProcessing) return;
        if (!this._ocrQueue.length) return;
        this._ocrProcessing = true;
        const total = this._invoiceCards.length;
        const doneBefore = this._invoiceCards.filter(function (c) { return c.status === 'ocr_ok'; }).length;
        this._showOcrLoading();
        const title = document.getElementById('ocrLoadingTitle');
        if (title) title.textContent = '正在识别 第 ' + (doneBefore + 1) + '/' + total + ' 张票据，请稍候...';
        while (this._ocrQueue.length) {
            const card = this._ocrQueue.shift();
            const idx = this._invoiceCards.indexOf(card);
            if (title) title.textContent = '正在识别 第 ' + (idx + 1) + '/' + total + ' 张票据，请稍候...';
            await this._ocrCard(card);
            this._renderInvoiceCards();
        }
        this._hideOcrLoading();
        this._ocrProcessing = false;
        const hint = document.getElementById('ocrHint');
        if (hint) {
            const failed = this._invoiceCards.some(function (c) { return c.status === 'ready'; });
            if (failed) { hint.textContent = '识别完成，部分票据未识别到信息，请手动填写'; hint.style.color = '#f56c6c'; }
            else { hint.textContent = '全部识别完成，请校验票据信息'; hint.style.color = '#67c23a'; }
        }
    }

    _removeInvoiceCard(id) {
        this._invoiceCards = this._invoiceCards.filter(function (c) { return c.id !== id; });
        this._renderInvoiceCards();
        this._recalc();
    }

    _renderInvoiceCards() {
        const container = document.getElementById('invoiceCards');
        if (!container) return;
        const self = this;
        if (!this._invoiceCards.length) {
            container.innerHTML = '';
            this._recalc();
            return;
        }
        container.innerHTML = this._invoiceCards.map(function (c) {
            const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(c.fileName || '');
            const thumb = isImg
                ? '<img src="' + c.fileUrl + '" style="width:48px;height:48px;border-radius:6px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;flex-shrink:0;" onclick="subsidyApp._previewInvoice(\'' + self._jsStr(c.fileUrl) + '\',\'' + self._jsStr(c.fileName) + '\')" title="点击预览">'
                : '<div style="width:48px;height:48px;border-radius:6px;border:1px solid #dcdfe6;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;" onclick="subsidyApp._previewInvoice(\'' + self._jsStr(c.fileUrl) + '\',\'' + self._jsStr(c.fileName) + '\')" title="点击查看"><i class="fas fa-file-pdf" style="color:#f56c6c;font-size:24px;"></i></div>';
            let statusHtml = '';
            if (c.status === 'uploading') statusHtml = '<span style="color:#909399;"><i class="fas fa-spinner fa-spin"></i> 上传中...</span>';
            else if (c.status === 'error') statusHtml = '<span style="color:#f56c6c;">' + self._escape(c.error || '上传失败') + '</span>';
            else if (c.status === 'ocr') statusHtml = '<span style="color:#409eff;"><i class="fas fa-spinner fa-spin"></i> 识别中...</span>';
            else if (c.status === 'ocr_ok') statusHtml = '<span style="color:#67c23a;"><i class="fas fa-check-circle"></i> 已识别，请校验</span>';
            else statusHtml = '<span style="color:#909399;">待识别</span>';
            // 提交失败（如发票号码已存在）时整卡红色标识
            const hasErr = !!(c.error && !c.submitted);
            const errBanner = hasErr
                ? '<div style="margin-bottom:8px;padding:6px 10px;background:#fef0f0;border:1px solid #fde2e2;border-radius:6px;color:#f56c6c;font-size:12px;"><i class="fas fa-exclamation-circle"></i> ' + self._escape(c.error) + '</div>'
                : '';
            const numberErrStyle = (hasErr && c.duplicate) ? 'border-color:#f56c6c !important;background:#fef0f0 !important;' : '';
            return '<div class="subsidy-card-error" style="border:1px solid ' + (hasErr ? '#f56c6c' : '#e2e8f0') + ';border-radius:10px;padding:12px;margin-bottom:10px;background:' + (hasErr ? '#fff7f7' : '#fbfcfe') + ';">'
                + errBanner
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
                + thumb
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(c.fileName) + (hasErr ? ' <span style="color:#f56c6c;font-size:11px;">（需处理）</span>' : '') + '</div>'
                + '<div style="margin-top:2px;">' + statusHtml + '</div>'
                + '</div>'
                + '<button class="btn btn-sm btn-danger" onclick="subsidyApp._removeInvoiceCard(' + c.id + ')"><i class="fas fa-trash"></i> 删除</button>'
                + '</div>'
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">'
                + self._cardField(c, 'type', '发票类型', 'select', true)
                + self._cardField(c, 'number', '发票号码', 'text', true, numberErrStyle)
                + self._cardField(c, 'code', '票据代码', 'text')
                + self._cardField(c, 'amount', '开票金额(含税)', 'number', true)
                + self._cardField(c, 'date', '开票日期', 'date')
                + self._cardField(c, 'taxRate', '税率', 'text')
                + self._cardField(c, 'drawer', '开票人', 'text')
                + self._cardField(c, 'buyerName', '购买方名称', 'text')
                + self._cardField(c, 'buyerTaxNo', '购买方税号', 'text')
                + self._cardField(c, 'sellerName', '销售方名称', 'text')
                + self._cardField(c, 'sellerTaxNo', '销售方税号', 'text')
                + '</div>'
                + '</div>';
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">'
                + self._cardField(c, 'type', '发票类型', 'select', true)
                + self._cardField(c, 'number', '发票号码', 'text', true)
                + self._cardField(c, 'code', '票据代码', 'text')
                + self._cardField(c, 'amount', '开票金额(含税)', 'number', true)
                + self._cardField(c, 'date', '开票日期', 'date')
                + self._cardField(c, 'taxRate', '税率', 'text')
                + self._cardField(c, 'drawer', '开票人', 'text')
                + self._cardField(c, 'buyerName', '购买方名称', 'text')
                + self._cardField(c, 'buyerTaxNo', '购买方税号', 'text')
                + self._cardField(c, 'sellerName', '销售方名称', 'text')
                + self._cardField(c, 'sellerTaxNo', '销售方税号', 'text')
                + '</div>'
                + '</div>';
        }, this).join('');
        this._recalc();
    }

    _cardField(c, key, label, type, required, extraStyle) {
        const fid = 'card_' + key + '_' + c.id;
        const styleAttr = extraStyle ? ' style="' + extraStyle + '"' : '';
        let input;
        if (type === 'select') {
            input = '<select id="' + fid + '" class="form-select"' + styleAttr + ' data-card="' + c.id + '" data-field="' + key + '" onchange="subsidyApp._onCardInput(this)">'
                + '<option value="">请选择</option>'
                + '<option value="special"' + (c[key] === 'special' ? ' selected' : '') + '>增值税专用发票</option>'
                + '<option value="ordinary"' + (c[key] === 'ordinary' ? ' selected' : '') + '>增值税普通发票</option>'
                + '</select>';
        } else if (type === 'date') {
            input = '<input type="date" id="' + fid + '" class="form-input"' + styleAttr + ' data-card="' + c.id + '" data-field="' + key + '" value="' + this._escape(c[key] || '') + '" onchange="subsidyApp._onCardInput(this)">';
        } else if (type === 'number') {
            input = '<input type="number" id="' + fid + '" class="form-input"' + styleAttr + ' min="0" step="0.01" data-card="' + c.id + '" data-field="' + key + '" value="' + this._escape(c[key] || '') + '" oninput="subsidyApp._onCardInput(this)">';
        } else {
            input = '<input type="text" id="' + fid + '" class="form-input"' + styleAttr + ' data-card="' + c.id + '" data-field="' + key + '" value="' + this._escape(c[key] || '') + '" oninput="subsidyApp._onCardInput(this)">';
        }
        return '<div><label style="font-size:12px;color:#606266;display:block;margin-bottom:3px;">' + label + (required ? ' <span class="required">*</span>' : '') + '</label>' + input + '</div>';
    }

    _onCardInput(el) {
        const cid = parseInt(el.getAttribute('data-card'), 10);
        const field = el.getAttribute('data-field');
        const card = this._invoiceCards.find(function (c) { return c.id === cid; });
        if (!card) return;
        card[field] = el.value;
        // 用户修改后清除提交失败标识
        if (card.error && !card.submitted) {
            card.error = '';
            card.duplicate = false;
            this._renderInvoiceCards();
        }
        this._recalc();
    }

    _collectCardData(card) {
        ['type', 'number', 'code', 'amount', 'date', 'taxRate', 'drawer', 'buyerName', 'buyerTaxNo', 'sellerName', 'sellerTaxNo'].forEach(function (k) {
            const el = document.getElementById('card_' + k + '_' + card.id);
            if (el) card[k] = el.value;
        });
        return card;
    }

    // 单张票据 OCR 识别并填充（Celery 异步：入队 → 轮询结果；由串行队列调用）
    async _ocrCard(card) {
        if (!card.fileUrl) return;
        card.status = 'ocr';
        this._renderInvoiceCards();
        // 未手动选择过识别版本时留空，由后端按补贴配置默认版本解析（未配置则 PaddleOCR 本地识别）
        const version = localStorage.getItem('subsidy_ocr_version') || '';
        try {
            const enq = await this.apiPost(SUBSIDY_API + '/ocr-invoice/', {
                url: card.fileUrl,
                ocr_version: version,
                tax_rate_threshold: this._taxRateThreshold || 0.06
            });
            if (!enq) { card.status = 'ready'; return; }
            let data = null;
            if (enq.result) {
                // 缓存命中（同一票据+版本已识别过），直接返回结果
                data = enq.result;
            } else if (enq.task_id) {
                data = await this._pollOcrTask(enq.task_id, card);
            } else {
                card.status = 'ready';
                this.showToast('识别任务提交失败', true);
                return;
            }
            if (!data) { card.status = 'ready'; return; }
            if (data.error) {
                card.status = 'ready';
                this.showToast('「' + card.fileName + '」识别失败：' + data.error, true);
                console.error('「' + card.fileName + '」识别失败：' + data.error);
                return;
            }
            this._applyOcrResult(card, data);
        } catch (e) {
            card.status = 'ready';
            this.showToast('「' + card.fileName + '」识别失败：' + (e.message || '请手动填写'), true);
            console.error('「' + card.fileName + '」识别失败：' + (e.message || '请手动填写'));
        }
    }

    // 轮询异步 OCR 任务结果（最多约 150s）
    async _pollOcrTask(taskId, card) {
        const maxWait = 150 * 1000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            await new Promise(function (r) { setTimeout(r, 2000); });
            // 更新遮罩标题，提示正在识别第几张
            try {
                const title = document.getElementById('ocrLoadingTitle');
                if (title && card) {
                    const idx = this._invoiceCards.indexOf(card);
                    if (idx >= 0) title.textContent = '正在识别 第 ' + (idx + 1) + '/' + this._invoiceCards.length + ' 张票据，请稍候...';
                }
            } catch (e) {}
            let st = null;
            try { st = await this.apiGet(SUBSIDY_API + '/ocr-status/?task_id=' + taskId); } catch (e) { st = null; }
            if (!st) continue;
            if (st.state === 'SUCCESS') return st.result || {};
            if (st.state === 'FAILURE') return {error: st.error || '识别失败'};
        }
        return {error: '识别超时，请稍后重试'};
    }

    // 将 OCR 结果填充到卡片
    _applyOcrResult(card, data) {
        if (data.invoice_type === 'special' || data.invoice_type === 'ordinary') {
            card.type = data.invoice_type;
        } else if (data.invoice_type) {
            card.status = 'ready';
            this.showToast('「' + card.fileName + '」发票类型不支持，请更换票据或手动选择', true);
            return;
        }
        if (data.invoice_number) card.number = data.invoice_number;
        if (data.invoice_code) card.code = data.invoice_code;
        if (data.invoice_amount) card.amount = data.invoice_amount;
        if (data.invoice_date) card.date = data.invoice_date;
        if (data.tax_rate) card.taxRate = data.tax_rate;
        if (data.drawer) card.drawer = data.drawer;
        if (data.buyer_name) card.buyerName = data.buyer_name;
        if (data.buyer_tax_no) card.buyerTaxNo = data.buyer_tax_no;
        if (data.invoice_issuer || data.seller_name) card.sellerName = data.invoice_issuer || data.seller_name;
        if (data.seller_tax_no) card.sellerTaxNo = data.seller_tax_no;
        // 保留百度OCR返回的原始JSON，提交时随申领一并存入数据库
        if (data.raw_data) card.ocrRawData = data.raw_data;
        card.status = 'ocr_ok';
        const got = [data.invoice_number, data.invoice_code, data.invoice_amount, data.invoice_date, data.tax_rate, data.buyer_name, data.seller_name, data.drawer].filter(Boolean).length;
        if (got) this.showToast('「' + card.fileName + '」识别成功，请校验信息是否正确', false);
        else {
            this.showToast('「' + card.fileName + '」识别失败，请手动填写', true);
            console.error('「' + card.fileName + '」识别失败，请手动填写');
        }
    }

    // ===== 支付截图（选填，辅助证明支付真实性） =====
    _onProofSelected(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) { this.showToast('文件不能超过50MB', true); e.target.value = ''; return; }
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'].includes(ext)) { this.showToast('仅支持图片或 PDF 文件', true); e.target.value = ''; return; }
        const fd = new FormData();
        fd.append('file', file);
        this.showToast('上传中...', false);
        fetch(SUBSIDY_API + '/upload-proof/', {
            method: 'POST',
            headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
            body: fd
        }).then(r => r.json()).then(d => {
            if (d.url) {
                this._paymentProof = {url: d.url, name: d.name || file.name};
                this._renderProofPreview();
                this.showToast('支付截图上传成功', false);
            } else this.showToast(d.error || '上传失败', true);
        }).catch(() => this.showToast('上传失败', true));
    }

    _renderProofPreview() {
        const area = document.getElementById('proofPreviewArea');
        if (!area) return;
        if (!this._paymentProof) { area.innerHTML = ''; return; }
        const p = this._paymentProof;
        const fname = p.name || p.url.split('/').pop() || '支付截图';
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(fname);
        const thumb = isImg
            ? '<img class="subsidy-invoice-thumb" src="' + p.url + '" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(p.url) + '\',\'' + this._jsStr(fname) + '\')" title="点击预览">'
            : '<div class="subsidy-invoice-thumb" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(p.url) + '\',\'' + this._jsStr(fname) + '\')" title="点击查看" style="cursor:pointer;"><i class="fas fa-file-pdf" style="color:#f56c6c;"></i></div>';
        area.innerHTML = '<div class="subsidy-invoice-preview">'
            + thumb
            + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + this._escape(fname) + '</span>'
            + '<button class="btn btn-sm btn-primary" onclick="subsidyApp._saveToCloud(\'' + this._jsStr(p.url) + '\',\'' + this._jsStr(fname) + '\')" title="保存到网盘"><i class="fas fa-cloud-upload-alt"></i> </button>'
            + '<button class="btn btn-sm btn-danger" onclick="subsidyApp._removeProof()"><i class="fas fa-trash"></i> 删除</button>'
            + '</div>';
    }

    _removeProof() {
        this._paymentProof = null;
        document.getElementById('proofFile').value = '';
        document.getElementById('proofPreviewArea').innerHTML = '';
    }

    // 票据查看：图片→灯箱预览，PDF→新标签打开
    _previewInvoice(url, name) {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(name || '')) {
            this._previewImage(url, name);
        } else {
            window.open(url, '_blank');
        }
    }

    // 图片灯箱预览（支持滚轮缩放 + 按钮缩放/适应 + 拖拽平移）
    _previewImage(url, name) {
        if (this._previewOverlay) this._closePreview();
        const overlay = document.createElement('div');
        overlay.id = 'subsidyPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.9);overflow:hidden;';
        overlay.innerHTML = '<span onclick="subsidyApp._closePreview()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10001;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.55);border-radius:22px;padding:6px 14px;">'
            + '<button onclick="subsidyApp._previewZoom(-1)" title="缩小" style="width:30px;height:30px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:16px;cursor:pointer;">−</button>'
            + '<span id="subsidyZoomLabel" style="color:#fff;font-size:12px;min-width:46px;text-align:center;">100%</span>'
            + '<button onclick="subsidyApp._previewZoom(1)" title="放大" style="width:30px;height:30px;border:none;border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;font-size:16px;cursor:pointer;">+</button>'
            + '<span style="width:1px;height:18px;background:rgba(255,255,255,0.3);"></span>'
            + '<button onclick="subsidyApp._previewZoom(0)" title="适应窗口" style="padding:4px 10px;border:none;border-radius:14px;background:rgba(255,255,255,0.15);color:#fff;font-size:12px;cursor:pointer;">适应</button>'
            + '</div>'
            + '<div id="subsidyZoomHint" style="position:fixed;top:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.6);font-size:12px;z-index:10001;background:rgba(0,0,0,0.35);padding:4px 14px;border-radius:12px;">滚轮缩放 · 拖拽平移 · 点击放大</div>'
            + '<div style="position:fixed;bottom:70px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + this._escape(name || '') + '</div>'
            + '<div id="subsidyZoomWrap" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:grab;">'
            + '<img id="subsidyPreviewMainImg" src="' + url + '" style="max-width:92vw;max-height:90vh;object-fit:contain;border-radius:6px;box-shadow:0 8px 40px rgba(0,0,0,0.5);cursor:grab;user-select:none;transition:transform 0.12s ease-out;">'
            + '</div>';
        document.body.appendChild(overlay);
        this._previewOverlay = overlay;
        this._previewZoomScale = 1;
        this._previewTx = 0;
        this._previewTy = 0;
        const self = this;
        const mainImg = overlay.querySelector('#subsidyPreviewMainImg');

        // 键盘：Esc 关闭
        const keyHandler = function (e) {
            if (e.key === 'Escape') { self._closePreview(); e.preventDefault(); }
        };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);

        // 滚轮缩放
        const wheelHandler = function (e) {
            e.preventDefault();
            self._previewZoom(e.deltaY < 0 ? 1 : -1);
        };
        this._previewWheelHandler = wheelHandler;
        overlay.addEventListener('wheel', wheelHandler, {passive: false});

        // 点击放大 / 点击背景关闭
        mainImg.addEventListener('click', function (e) { e.stopPropagation(); self._previewZoom(1); });
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target.id === 'subsidyZoomWrap') self._closePreview();
        });

        // 拖拽平移（放大后查看细节）
        let dragging = false, sx = 0, sy = 0;
        const wrap = overlay.querySelector('#subsidyZoomWrap');
        wrap.addEventListener('mousedown', function (e) {
            if (self._previewZoomScale <= 1) return;
            dragging = true;
            sx = e.clientX - (self._previewTx || 0);
            sy = e.clientY - (self._previewTy || 0);
            wrap.style.cursor = 'grabbing';
            e.preventDefault();
        });
        const moveHandler = function (e) {
            if (!dragging) return;
            self._previewTx = e.clientX - sx;
            self._previewTy = e.clientY - sy;
            self._applyPreviewTransform();
        };
        const upHandler = function () {
            if (dragging) { dragging = false; wrap.style.cursor = 'grab'; }
        };
        this._previewMoveHandler = moveHandler;
        this._previewUpHandler = upHandler;
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);

        // 移动端触摸缩放/平移
        this._previewTouch = null;
        const touchStart = function (e) {
            if (e.touches.length === 1) {
                self._previewTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
            }
        };
        const touchMove = function (e) {
            if (!self._previewTouch || e.touches.length !== 1) return;
            if (self._previewZoomScale <= 1) return;
            e.preventDefault();
            const dx = e.touches[0].clientX - self._previewTouch.x;
            const dy = e.touches[0].clientY - self._previewTouch.y;
            self._previewTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
            self._previewTx = (self._previewTx || 0) + dx;
            self._previewTy = (self._previewTy || 0) + dy;
            self._applyPreviewTransform();
        };
        const touchEnd = function () { self._previewTouch = null; };
        this._previewTouchStart = touchStart;
        this._previewTouchMove = touchMove;
        this._previewTouchEnd = touchEnd;
        overlay.addEventListener('touchstart', touchStart, {passive: true});
        overlay.addEventListener('touchmove', touchMove, {passive: false});
        overlay.addEventListener('touchend', touchEnd, {passive: true});
    }

    _applyPreviewTransform() {
        if (!this._previewImg) this._previewImg = document.getElementById('subsidyPreviewMainImg');
        const img = this._previewImg;
        if (!img) return;
        const tx = this._previewTx || 0, ty = this._previewTy || 0, s = this._previewZoomScale || 1;
        img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
        const label = document.getElementById('subsidyZoomLabel');
        if (label) label.textContent = Math.round(s * 100) + '%';
    }

    _previewZoom(dir) {
        let s = this._previewZoomScale || 1;
        if (dir > 0) s = Math.min(8, s + 0.25);
        else if (dir < 0) s = Math.max(0.25, s - 0.25);
        else { s = 1; this._previewTx = 0; this._previewTy = 0; }
        this._previewZoomScale = s;
        this._applyPreviewTransform();
    }

    _closePreview() {
        if (this._previewOverlay) {
            if (this._previewWheelHandler) this._previewOverlay.removeEventListener('wheel', this._previewWheelHandler);
            if (this._previewTouchStart) this._previewOverlay.removeEventListener('touchstart', this._previewTouchStart);
            if (this._previewTouchMove) this._previewOverlay.removeEventListener('touchmove', this._previewTouchMove);
            if (this._previewTouchEnd) this._previewOverlay.removeEventListener('touchend', this._previewTouchEnd);
            this._previewOverlay.remove();
            this._previewOverlay = null;
        }
        if (this._previewKeyHandler) { document.removeEventListener('keydown', this._previewKeyHandler); this._previewKeyHandler = null; }
        if (this._previewMoveHandler) { document.removeEventListener('mousemove', this._previewMoveHandler); this._previewMoveHandler = null; }
        if (this._previewUpHandler) { document.removeEventListener('mouseup', this._previewUpHandler); this._previewUpHandler = null; }
        this._previewImg = null;
        this._previewZoomScale = 1;
        this._previewTx = 0;
        this._previewTy = 0;
        this._previewWheelHandler = null;
        this._previewTouchStart = null;
        this._previewTouchMove = null;
        this._previewTouchEnd = null;
    }

    // 保存到我的网盘（MD5 去重由后端 save_from_url 保证）
    async _saveToCloud(url, name) {
        const btn = event && event.currentTarget;
        try {
            const resp = await fetch('/api/cloud/files/save_from_url/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({url: url, name: name || url.split('/').pop() || '票据'})
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                this.showToast(err.error || '保存失败', true);
                return;
            }
            const data = await resp.json();
            if (data.file_id) {
                this.showToast(data.already_exists ? '该票据已在您的网盘中（已去重）' : '已保存到我的网盘 → 文档（来自审批）', false);
                if (btn) btn.style.background = '#67c23a';
            } else {
                this.showToast('保存失败', true);
            }
        } catch (e) {
            this.showToast('保存失败', true);
        }
    }

    // ===== 票据OCR智能识别（支持多引擎） =====
    _onOcrVersionChange() {
        const sel = document.getElementById('ocrVersion');
        if (!sel) return;
        // 非管理员以上用户不允许手动切换（兜底：忽略非法变更，恢复为配置默认版本）
        const ut = localStorage.getItem('user_type');
        if (ut !== 'super_admin' && ut !== 'admin') {
            sel.value = this._defaultOcrVersion || 'paddle';
            return;
        }
        localStorage.setItem('subsidy_ocr_version', sel.value);
    }

    // OCR 下拉框权限：仅管理员以上可切换；其余用户锁定为补贴配置的默认版本（未配置则 paddle）
    _applyOcrVersionPermission() {
        const sel = document.getElementById('ocrVersion');
        if (!sel) return;
        const ut = localStorage.getItem('user_type');
        const isAdmin = (ut === 'super_admin' || ut === 'admin');
        const target = isAdmin
            ? (localStorage.getItem('subsidy_ocr_version') || this._defaultOcrVersion || 'paddle')
            : (this._defaultOcrVersion || 'paddle');
        if (sel.querySelector('option[value="' + target + '"]')) sel.value = target;
        sel.disabled = !isAdmin;
        sel.style.opacity = isAdmin ? '1' : '0.6';
        sel.style.cursor = isAdmin ? 'pointer' : 'not-allowed';
        const hint = document.getElementById('ocrHint');
        if (hint) {
            const labelMap = {baidu_vat: '百度增值税发票识别', baidu_general: '百度通用文字识别', paddle: 'PaddleOCR本地识别'};
            hint.textContent = isAdmin
                ? '识别版本可手动切换（默认为补贴配置）'
                : '识别版本：' + (labelMap[this._defaultOcrVersion] || 'PaddleOCR本地识别');
        }
    }

    _showOcrLoading() {
        const overlay = document.getElementById('ocrLoadingOverlay');
        if (!overlay) return;
        // 重置进度条动画
        const bar = overlay.querySelector('.ocr-progress-bar');
        if (bar) {
            bar.style.animation = 'none';
            void bar.offsetWidth;
            bar.style.animation = '';
        }
        overlay.style.display = 'flex';
        overlay.classList.add('show');
    }

    _hideOcrLoading() {
        const overlay = document.getElementById('ocrLoadingOverlay');
        if (!overlay) return;
        overlay.classList.remove('show');
        overlay.style.display = 'none';
    }

    // ===== 提交申领（批量） =====
    async submit() {
        if (!this._invoiceCards.length) { this.showAlert('提示', '请先上传票据文件'); return; }
        // 校验收款账号
        if (!this._hasPaymentInfo) {
            this.showAlert('提示', '您还未填写收款账号，需要先完善收款信息后才能提交申领');
            this.openPaymentInfoModal();
            return;
        }
        const payloads = [];
        for (let i = 0; i < this._invoiceCards.length; i++) {
            const card = this._collectCardData(this._invoiceCards[i]);
            if (card.status === 'error') { this.showToast('存在上传失败的票据，请删除后重新上传', true); return; }
            if (!card.type) { this.showToast('第 ' + (i + 1) + ' 张票据：请选择发票类型', true); return; }
            if (!card.number) { this.showToast('第 ' + (i + 1) + ' 张票据：请填写发票号码', true); return; }
            if (!card.amount || parseFloat(card.amount) <= 0) { this.showToast('第 ' + (i + 1) + ' 张票据：请填写正确的开票金额', true); return; }
            if (!card.fileUrl) { this.showToast('第 ' + (i + 1) + ' 张票据：票据文件未上传成功', true); return; }
            payloads.push({
                invoice_number: card.number,
                invoice_type: card.type,
                invoice_code: card.code || '',
                invoice_amount: card.amount,
                invoice_date: card.date || null,
                tax_rate: card.taxRate || '',
                invoice_issuer: card.sellerName || '',
                invoice_file: card.fileUrl,
                invoice_original_name: card.fileName,
                buyer_name: card.buyerName || '',
                buyer_tax_no: card.buyerTaxNo || '',
                seller_name: card.sellerName || '',
                seller_tax_no: card.sellerTaxNo || '',
                drawer: card.drawer || '',
                payment_proof: this._paymentProof ? this._paymentProof.url : '',
                payment_proof_name: this._paymentProof ? this._paymentProof.name : '',
                ocr_raw_data: card.ocrRawData ? JSON.stringify(card.ocrRawData) : ''
            });
        }
        const btn = document.getElementById('submitSubsidyBtn');
        btn.disabled = true;
        btn.style.opacity = 0.4;
        let success = 0, failed = 0;
        const failMsgs = [];
        try {
            for (let i = 0; i < payloads.length; i++) {
                const card = this._invoiceCards[i];
                try {
                    if (this._reSubmitId) {
                        await this.apiPost(SUBSIDY_API + '/' + this._reSubmitId + '/re-submit/', payloads[i]);
                    } else {
                        await this.apiPost(SUBSIDY_API + '/', payloads[i]);
                    }
                    card.submitted = true;
                    success++;
                } catch (e2) {
                    failed++;
                    card.error = e2.message || '提交失败';
                    card.duplicate = !!(e2.message && e2.message.indexOf('发票号码已存在') >= 0);
                    failMsgs.push('第' + (i + 1) + '张：' + card.error);
                }
            }
            // 移除已成功提交的卡片，保留失败卡片供修改
            this._invoiceCards = this._invoiceCards.filter(function (c) { return !c.submitted; });
            this._renderInvoiceCards();
            if (failed > 0) {
                const hint = document.getElementById('ocrHint');
                if (hint) {
                    hint.textContent = '提交完成：成功 ' + success + ' 张，失败 ' + failed + ' 张。' + failMsgs.join('；');
                    hint.style.color = '#f56c6c';
                }
                this.showToast('成功 ' + success + ' 张，失败 ' + failed + ' 张，请修改红色标识票据后重新提交', true);
                // 滚动到第一张失败卡片
                const firstErr = document.querySelector('.subsidy-card-error');
                if (firstErr) firstErr.scrollIntoView({behavior: 'smooth', block: 'center'});
            } else {
                this.showToast(this._reSubmitId ? '已重新提交，等待财务核验' : '已提交 ' + success + ' 张票据申领，等待财务核验', false);
                this._resetForm();
            }
            await this._loadAccount();
            this.loadMy(1);
            // 仅核验人员/超级管理员刷新核验列表（loadAdmin 内部会再次判断）
            this.loadAdmin(1);
        } catch (e) {
            if (e.message && e.message.indexOf('收款账号') >= 0) this.openPaymentInfoModal();
            this.showToast('提交失败：' + e.message, true);
        } finally {
            btn.disabled = false;
            btn.style.opacity = 1;
        }
    }

    _resetForm() {
        this._invoiceCards = [];
        this._paymentProof = null;
        this._reSubmitId = null;
        document.getElementById('invFiles').value = '';
        document.getElementById('proofFile').value = '';
        const proofArea = document.getElementById('proofPreviewArea');
        if (proofArea) proofArea.innerHTML = '';
        const cards = document.getElementById('invoiceCards');
        if (cards) cards.innerHTML = '';
        const hint = document.getElementById('ocrHint');
        if (hint) hint.textContent = '';
        this._recalc();
    }

    // ===== 收款账号信息（完善/修改） =====
    async openPaymentInfoModal() {
        if (!this._paymentInfo) await this._loadPaymentInfo();
        const d = this._paymentInfo || {};
        document.getElementById('piPayeeName').value = d.payee_name || '';
        document.getElementById('piBankCard').value = d.bank_card || '';
        document.getElementById('piBankName').value = d.bank_name || '';
        document.getElementById('piBankAddress').value = d.bank_address || '';
        document.getElementById('piAlipayAccount').value = d.alipay_account || '';
        document.getElementById('piWechatAccount').value = d.wechat_account || '';
        this._renderQrPreview('alipay', d.alipay_qr || '');
        this._renderQrPreview('wechat', d.wechat_qr || '');
        const modal = document.getElementById('paymentInfoModal');
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    _closePaymentInfoModal() {
        const modal = document.getElementById('paymentInfoModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    }

    _onQrSelected(e, kind) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!/\.(jpg|jpeg|png|gif|webp)$/i.test(file.name)) { this.showToast('收款码仅支持图片', true); e.target.value = ''; return; }
        if (file.size > 10 * 1024 * 1024) { this.showToast('文件不能超过10MB', true); e.target.value = ''; return; }
        const fd = new FormData();
        fd.append('file', file);
        this.showToast('上传中...', false);
        fetch(SUBSIDY_API + '/upload-proof/', {
            method: 'POST',
            headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
            body: fd
        }).then(r => r.json()).then(d => {
            if (d.url) {
                this._paymentInfo = this._paymentInfo || {};
                this._paymentInfo[kind + '_qr'] = d.url;
                this._renderQrPreview(kind, d.url);
                this.showToast('收款码上传成功', false);
            } else this.showToast(d.error || '上传失败', true);
        }).catch(() => this.showToast('上传失败', true));
    }

    _renderQrPreview(kind, url) {
        const area = document.getElementById('pi' + (kind === 'alipay' ? 'Alipay' : 'Wechat') + 'QrPreview');
        if (!area) return;
        if (!url) { area.innerHTML = ''; return; }
        area.innerHTML = '<div class="subsidy-invoice-preview">'
            + '<img class="subsidy-invoice-thumb" src="' + url + '" onclick="subsidyApp._previewImage(\'' + this._jsStr(url) + '\',\'' + (kind === 'alipay' ? '支付宝收款码' : '微信收款码') + '\')" title="点击预览">'
            + '<span style="flex:1;font-size:12px;color:#909399;">已上传</span>'
            + '<button class="btn btn-sm btn-danger" onclick="subsidyApp._removeQr(\'' + kind + '\')"><i class="fas fa-trash"></i> 移除</button>'
            + '</div>';
    }

    _removeQr(kind) {
        if (this._paymentInfo) this._paymentInfo[kind + '_qr'] = '';
        document.getElementById('pi' + (kind === 'alipay' ? 'Alipay' : 'Wechat') + 'QrFile').value = '';
        this._renderQrPreview(kind, '');
    }

    async _savePaymentInfo() {
        const payee = document.getElementById('piPayeeName').value.trim();
        const bank = document.getElementById('piBankCard').value.trim();
        const alipay = document.getElementById('piAlipayAccount').value.trim();
        const wechat = document.getElementById('piWechatAccount').value.trim();
        if (!payee) { this.showToast('请填写收款人真实姓名', true); return; }
        if (!bank && !alipay && !wechat) { this.showToast('请至少填写一种收款方式（银行卡/支付宝/微信）', true); return; }
        const data = {
            payee_name: payee,
            bank_card: bank,
            bank_name: document.getElementById('piBankName').value.trim(),
            bank_address: document.getElementById('piBankAddress').value.trim(),
            alipay_account: alipay,
            wechat_account: wechat,
            alipay_qr: (this._paymentInfo && this._paymentInfo.alipay_qr) || '',
            wechat_qr: (this._paymentInfo && this._paymentInfo.wechat_qr) || ''
        };
        try {
            const res = await this.apiPost(SUBSIDY_API + '/payment-info/', data);
            this._paymentInfo = res || data;
            this._hasPaymentInfo = true;
            this._closePaymentInfoModal();
            this.showToast('收款账号信息已保存', false);
        } catch (e) {
            this.showToast('保存失败：' + e.message, true);
        }
    }

    // ===== 我的申领 =====
    async loadMy(page) {
        this.myPage = page || 1;
        const status = document.getElementById('myStatusFilter').value;
        let url = SUBSIDY_API + '/?page=' + this.myPage + '&page_size=' + this.pageSize;
        if (status) url += '&status=' + status;
        try {
            const data = await this.apiGet(url);
            this._renderMy(data);
        } catch (e) {
            this.showToast('加载申领失败', true);
        }
    }

    _renderMy(data) {
        const body = document.getElementById('myListBody');
        const list = data.results || [];
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#909399;padding:20px;">暂无申领记录</td></tr>';
        } else {
            body.innerHTML = list.map(function (r) {
                // 所有申领均保留「详情」按钮，方便申领人查看申领详情（含驳回原因）
                const op = r.status === 'rejected'
                    ? '<button class="btn btn-sm btn-secondary" onclick="subsidyApp._showDetail(' + r.id + ')"><i class="fas fa-eye"></i> 详情</button>'
                        + ' <button class="btn btn-sm btn-primary" onclick="subsidyApp._prefillReject(' + r.id + ')"><i class="fas fa-redo"></i> 重新申领</button>'
                        + ' <button class="btn btn-sm btn-danger" onclick="subsidyApp._deleteApplication(' + r.id + ')"><i class="fas fa-trash"></i> 删除</button>'
                    : '<button class="btn btn-sm btn-secondary" onclick="subsidyApp._showDetail(' + r.id + ')"><i class="fas fa-eye"></i> 详情</button>';
                return '<tr>'
                    + '<td>' + this._escape(r.application_no) + '</td>'
                    + '<td>' + this._typeBadge(r.invoice_type, r.invoice_type_display) + '</td>'
                    + '<td>¥' + this._fmtAmount(r.invoice_amount) + '</td>'
                    + '<td style="color:#e6a23c;font-weight:600;">¥' + this._fmtAmount(r.subsidy_amount) + '</td>'
                    + '<td>' + this._statusBadge(r.status) + (r.status === 'rejected' && r.reject_reason ? '<div style="font-size:11px;color:#f56c6c;margin-top:2px;">' + this._escape(r.reject_reason) + '</div>' : '') + '</td>'
                    + '<td>' + this._fmtTime(r.created_at) + '</td>'
                    + '<td>' + op + '</td>'
                    + '</tr>';
            }, this).join('');
        }
        this._renderPagination(data, 'myPagination', 'loadMy');
    }

    // 重新申领：回填已驳回单的字段（保留原申领，提交时走 re-submit）
    _prefillReject(id) {
        this.apiGet(SUBSIDY_API + '/' + id + '/').then(function (r) {
            if (!r) return;
            this._reSubmitId = id;
            this._invoiceCards = [];
            if (r.invoice_file) {
                this._invoiceCards.push({
                    id: ++this._cardSeq,
                    fileUrl: r.invoice_file,
                    fileName: r.invoice_original_name || '历史票据',
                    type: r.invoice_type || '', number: r.invoice_number || '', code: r.invoice_code || '',
                    amount: r.invoice_amount || '', date: r.invoice_date || '', taxRate: r.tax_rate || '',
                    issuer: r.invoice_issuer || r.seller_name || '',
                    buyerName: r.buyer_name || '', buyerTaxNo: r.buyer_tax_no || '',
                    sellerName: r.invoice_issuer || r.seller_name || '', sellerTaxNo: r.seller_tax_no || '',
                    drawer: r.drawer || '', status: 'ocr_ok'
                });
            }
            if (r.payment_proof) {
                this._paymentProof = {url: r.payment_proof, name: r.payment_proof_name || '历史支付截图'};
            } else {
                this._paymentProof = null;
            }
            this._renderInvoiceCards();
            this._renderProofPreview();
            this.showToast('已回填被驳回申领的信息，修改后提交将重新核验（原申领编号保留）', false);
            window.scrollTo({top: 0, behavior: 'smooth'});
        }.bind(this)).catch(function (e) { this.showToast('加载失败', true); }.bind(this));
    }

    // 删除被驳回的申领
    async _deleteApplication(id) {
        var confirmed = await this.showConfirmDialog('删除申领', '确认删除该被驳回的申领？删除后不可恢复。。', 'danger');
        if (!confirmed) return;
        try {
            const resp = await fetch(SUBSIDY_API + '/' + id + '/delete-my/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                this.showToast(err.error || '删除失败', true);
                return;
            }
            this.showToast('申领已删除', false);
            this.loadMy(1);
            this._loadAccount();
        } catch (e) {
            this.showToast('删除失败', true);
        }
    }

    // 详情弹窗：左侧申领字段 + 右侧票据原件（铺满高度，图片支持预览缩放）
    _showDetail(id) {
        this._detailId = id;
        this.apiGet(SUBSIDY_API + '/' + id + '/').then(function (r) {
            if (!r) return;
            const ut = localStorage.getItem('user_type');
            // 主页面详情为申请人视角：核验操作（通过/驳回/二维码/改类型）已移至「财务核验」独立页
            const canVerify = false;
            this._detailInvoiceFile = r.invoice_file || '';
            this._detailInvoiceImage = r.invoice_image || '';
            // 发票类型：核验人员可在详情中直接修改，修改后补贴比例/金额自动同步
            const invTypes = [['special', '增值税专用发票'], ['ordinary', '增值税普通发票']];
            const invTypeCell = canVerify
                ? '<select style="width:auto;padding:1px 6px;height:26px;font-size:12px;border:1px solid #dcdfe6;border-radius:4px;" onchange="subsidyApp._changeInvoiceType(' + r.id + ', this.value)">'
                    + invTypes.map(function (o) {
                        return '<option value="' + o[0] + '"' + (r.invoice_type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
                    }).join('')
                    + '</select>'
                : r.invoice_type_display;
            const lines = [
                ['申请人', (r.applicant_name || '-') + (r.applicant_avatar ? '' : '')],
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
                ['销售方名称（开票主体）', r.invoice_issuer || r.seller_name || '-'],
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
            // 顶部导航：上一条 / 下一条（核验列表上下文可用时显示）
            let navHtml = '';
            if (this._adminRecordIds && this._adminRecordIds.length) {
                const idx = this._adminRecordIds.indexOf(id);
                if (idx !== -1) {
                    navHtml = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;background:linear-gradient(90deg,#ecf5ff,#f0f9eb);border-radius:8px;margin-bottom:12px;">'
                        + '<button class="btn btn-sm btn-secondary" onclick="subsidyApp._navDetail(-1)"><i class="fas fa-chevron-left"></i> 上一条</button>'
                        + '<span style="font-size:13px;color:#606266;font-weight:600;">' + (idx + 1) + ' / ' + this._adminRecordIds.length + '</span>'
                        + '<button class="btn btn-sm btn-secondary" onclick="subsidyApp._navDetail(1)">下一条 <i class="fas fa-chevron-right"></i></button>'
                        + '</div>';
                }
            }
            // 左侧：申领字段
            let leftHtml = '<div style="font-size:13px;font-weight:600;color:#409eff;margin-bottom:8px;position:sticky;top:0;background:var(--bg-primary,#fff);padding-bottom:6px;"><i class="fas fa-clipboard-list"></i> 申领信息</div>';
            lines.forEach(function (l) {
                leftHtml += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed #eee;font-size:13px;"><span style="color:#909399;flex-shrink:0;">' + l[0] + '</span><span style="text-align:right;">' + l[1] + '</span></div>';
            });
            // 右侧：票据原件（铺满）+ 支付凭证（二维码扫描移至财务核验独立页）
            const isVerifierView = false;
            let rightHtml = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-shrink:0;">'
                + '<div style="font-size:13px;font-weight:600;color:#409eff;"><i class="fas fa-file-invoice"></i> 票据原件</div>'
                + (isVerifierView && r.invoice_file
                    ? '<button class="btn btn-sm btn-primary" id="subsidyQrScanBtn" style="font-size:12px;white-space:nowrap;" onclick="subsidyApp._scanQr(' + r.id + ')"><i class="fas fa-qrcode"></i> 二维码扫描</button>'
                    : '')
                + '</div>';
            if (r.invoice_file) {
                const fname = r.invoice_original_name || r.invoice_file.split('?')[0].split('/').pop() || '票据文件';
                const fileExt = r.invoice_file.split('?')[0].split('/').pop() || '';
                // 同时按原始文件名与实际存储路径判断类型，避免文件名不带扩展名导致 PDF 误走 iframe
                const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(fname) || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileExt);
                const isPdf = /\.pdf$/i.test(fname) || /\.pdf$/i.test(fileExt);
                // PDF 渲染为图片预览（invoice-preview 接口将第一页转 PNG），图片直接显示原图
                const invFile = this._mediaUrl(r.invoice_file);
                // 优先用提交时已转换好的 PDF 图片（invoice_image），旧数据回退到 invoice-preview 接口即时转换
                const invImg = r.invoice_image ? this._mediaUrl(r.invoice_image) : '';
                const previewUrl = invImg || (isPdf ? SUBSIDY_API + '/invoice-preview/?url=' + encodeURIComponent(invFile) : invFile);
                rightHtml += '<div class="subsidy-detail-invoice">'
                    // 二维码扫描动画浮层（科技感扫描线）
                    + '<div id="subsidyQrOverlay" style="display:none;position:absolute;inset:0;z-index:5;background:rgba(2,12,27,0.80);border-radius:8px;overflow:hidden;">'
                    + '<div class="qr-scan-corners"></div>'
                    + '<div class="qr-scan-line"></div>'
                    + '<div style="position:absolute;bottom:16px;left:0;right:0;text-align:center;color:#00e5ff;font-size:13px;letter-spacing:2px;font-family:monospace;"><i class="fas fa-sync-alt fa-spin"></i> 正在扫描二维码...</div>'
                    + '</div>';
                if (isImg || isPdf) {
                    // PDF 已转为图片预览，点击后灯箱放大缩放
                    rightHtml += '<img src="' + previewUrl + '" style="max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in;background:#fff;" onclick="subsidyApp._previewImage(\'' + this._jsStr(previewUrl) + '\',\'' + this._jsStr(fname) + '\')" title="点击放大/缩放查看" onerror="this.style.display=\'none\';var fb=this.parentNode.querySelector(\'.inv-fallback\');if(fb)fb.style.display=\'flex\';">'
                        + '<div class="inv-fallback" style="display:none;align-items:center;justify-content:center;color:#909399;font-size:13px;width:100%;height:100%;"><i class="fas fa-exclamation-circle" style="margin-right:6px;"></i> 票据预览加载失败' + (isPdf ? '，请点击图片区域查看PDF' : '') + '</div>'
                        + '<span style="position:absolute;bottom:8px;right:10px;font-size:11px;color:#fff;background:rgba(0,0,0,0.45);padding:2px 10px;border-radius:10px;"><i class="fas fa-search-plus"></i> 点击放大/缩放</span>';
                } else {
                    rightHtml += '<iframe src="' + invFile + '" style="width:100%;height:100%;border:none;"></iframe>';
                }
                rightHtml += '</div>';
                // 二维码扫描结果展示区
                rightHtml += '<div id="subsidyQrResult" style="display:none;margin-top:10px;flex-shrink:0;"></div>';
            } else {
                rightHtml += '<div class="subsidy-detail-invoice" style="align-items:center;color:#909399;border-style:dashed;">无票据文件</div>';
            }
            // 申请人支付截图（辅助证明支付真实性）
            if (r.payment_proof) {
                const pname = r.payment_proof_name || r.payment_proof.split('/').pop() || '支付截图';
                const pFile = this._mediaUrl(r.payment_proof);
                const pIsImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(pname);
                const pThumb = pIsImg
                    ? '<img src="' + pFile + '" style="width:52px;height:52px;border-radius:6px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;flex-shrink:0;" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(pFile) + '\',\'' + this._jsStr(pname) + '\')" title="点击预览">'
                    : '<div style="width:52px;height:52px;border-radius:6px;border:1px solid #dcdfe6;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(pFile) + '\',\'' + this._jsStr(pname) + '\')" title="点击查看"><i class="fas fa-file-pdf" style="color:#f56c6c;font-size:26px;"></i></div>';
                rightHtml += '<div style="margin-top:10px;flex-shrink:0;"><span style="color:#909399;font-size:12px;"><i class="fas fa-receipt"></i> 支付截图（申请人）：</span>'
                    + '<div class="subsidy-invoice-preview">'
                    + pThumb
                    + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + this._escape(pname) + '</span>'
                    + '<button class="btn btn-sm btn-primary" onclick="subsidyApp._saveToCloud(\'' + this._jsStr(r.payment_proof) + '\',\'' + this._jsStr(pname) + '\')" title="保存到云盘"><i class="fas fa-cloud-upload-alt"></i> </button>'
                    + '</div></div>';
            }
            if (r.payment_voucher) {
                const vname = r.payment_voucher_name || r.payment_voucher.split('/').pop() || '支付凭证';
                const vFile = this._mediaUrl(r.payment_voucher);
                const vIsImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(vname);
                const vThumb = vIsImg
                    ? '<img src="' + vFile + '" style="width:52px;height:52px;border-radius:6px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;flex-shrink:0;" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(vFile) + '\',\'' + this._jsStr(vname) + '\')" title="点击预览">'
                    : '<div style="width:52px;height:52px;border-radius:6px;border:1px solid #dcdfe6;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(vFile) + '\',\'' + this._jsStr(vname) + '\')" title="点击查看"><i class="fas fa-file-pdf" style="color:#f56c6c;font-size:26px;"></i></div>';
                rightHtml += '<div style="margin-top:10px;flex-shrink:0;"><span style="color:#67c23a;font-size:12px;"><i class="fas fa-money-check-alt"></i> 支付凭证（付款截图）：</span>'
                    + '<div class="subsidy-invoice-preview">'
                    + vThumb
                    + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + this._escape(vname) + '</span>'
                    + '<button class="btn btn-sm btn-primary" onclick="subsidyApp._saveToCloud(\'' + this._jsStr(r.payment_voucher) + '\',\'' + this._jsStr(vname) + '\')" title="保存到云盘"><i class="fas fa-cloud-upload-alt"></i> </button>'
                    + '</div></div>';
            }
            const html = navHtml
                + '<div class="subsidy-detail-wrap">'
                + '<div class="subsidy-detail-left">' + leftHtml + '</div>'
                + '<div class="subsidy-detail-right">' + rightHtml + '</div>'
                + '</div>';
            // 底部：核验人员可在详情中直接通过/驳回（与列表功能一致）
            let footer = '<button class="btn btn-secondary" onclick="subsidyApp._closeRejectModal()">关闭</button>';
            if (canVerify) {
                footer = '<button class="btn btn-secondary" onclick="subsidyApp._closeRejectModal()">关闭</button>'
                    + '<button class="btn btn-primary" onclick="subsidyApp.approve(' + r.id + ')"><i class="fas fa-check"></i> 通过</button>'
                    + '<button class="btn btn-danger" onclick="subsidyApp._openReject(' + r.id + ')"><i class="fas fa-times"></i> 驳回</button>';
            }
            this._showModalContent('补贴申领详情', html, {width: '960px', footer: footer});
        }.bind(this)).catch(function (e) {
            let msg = (e && e.message) || '';
            if (!msg || msg === 'Failed to fetch') msg = '加载失败';
            this.showToast(msg, true);
        }.bind(this));
    }

    // 详情弹窗：上一条 / 下一条切换（到本页首/末条时给出提示，引导用户翻页）
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

    // 详情弹窗：扫描当前票据二维码（播放科技感扫描动画后请求后端解析）
    async _scanQr(id) {
        const btn = document.getElementById('subsidyQrScanBtn');
        const overlay = document.getElementById('subsidyQrOverlay');
        const resultEl = document.getElementById('subsidyQrResult');
        if (btn) { btn.disabled = true; btn.style.opacity = 0.5; }
        if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
        if (overlay) overlay.style.display = 'block';
        // 播放约 1.8s 扫描动画
        await new Promise(function (r) { setTimeout(r, 1800); });
        try {
            let invoiceFile = this._detailInvoiceImage || this._detailInvoiceFile;
            if (!invoiceFile) {
                const app = await this.apiGet(SUBSIDY_API + '/' + id + '/');
                invoiceFile = (app && (app.invoice_image || app.invoice_file)) || '';
            }
            if (!invoiceFile) throw new Error('无票据文件');
            const res = await this.apiPost(SUBSIDY_API + '/qr-scan/', {url: invoiceFile});
            const qrStrings = (res && res.qr_strings) || [];
            const parsed = (res && res.parsed) || {};
            if (overlay) overlay.style.display = 'none';
            if (resultEl) {
                this._renderQrResult(resultEl, id, qrStrings, parsed);
                resultEl.style.display = 'block';
            }
            if (!qrStrings.length) this.showToast('未识别到二维码，请确认票据图片清晰', true);
        } catch (e) {
            if (overlay) overlay.style.display = 'none';
            if (resultEl) {
                resultEl.innerHTML = '<div style="border:1px solid #f56c6c;border-radius:8px;background:#fef0f0;padding:10px 12px;font-size:12px;color:#f56c6c;">'
                    + '<i class="fas fa-exclamation-circle" style="margin-right:4px;"></i> 二维码扫描失败：' + this._escape((e && e.message) || '请重试')
                    + '</div>';
                resultEl.style.display = 'block';
            }
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        }
    }

    // 渲染二维码扫描结果：提示 + 原文 + 与识别字段对比
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
            + '<i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i> 以下信息仅为发票二维码所含信息，并不代表查验发票真伪的结果。'
            + '</div>';
        html += '<div style="margin-top:8px;border:1px solid #dcdfe6;border-radius:8px;overflow:hidden;">'
            + '<div style="padding:6px 10px;background:#f5f7fa;font-size:12px;color:#606266;font-weight:600;"><i class="fas fa-qrcode" style="color:#409eff;margin-right:4px;"></i> 二维码原文</div>'
            + '<div style="padding:8px 10px;font-size:12px;color:#303133;word-break:break-all;max-height:90px;overflow-y:auto;font-family:monospace;">' + this._escape(qr || '未识别到二维码') + '</div>'
            + '</div>';
        html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">'
            + '<tr style="background:#f5f7fa;color:#606266;"><th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:left;">字段</th>'
            + '<th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:left;">二维码</th>'
            + '<th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:left;">识别（申领）</th>'
            + '<th style="padding:6px 8px;border:1px solid #dcdfe6;text-align:center;">对比</th></tr>';
        compare.forEach(function (c) {
            const q = c.qrVal || '-';
            const o = c.ocrVal || '-';
            let badge = '<span style="color:#c0c4cc;">—</span>';
            if (c.qrVal && c.ocrVal) {
                const match = String(c.qrVal).trim() === String(c.ocrVal).trim();
                badge = match
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

    _showModalContent(title, bodyHtml, options) {
        options = options || {};
        // 复用 rejectModal 容器做一个通用弹窗
        const modal = document.getElementById('rejectModal');
        const contentEl = modal.querySelector('.modal-content');
        if (contentEl) {
            contentEl.style.maxWidth = options.width || '520px';
            contentEl.style.width = options.width ? '100%' : '';
        }
        const header = modal.querySelector('.modal-header');
        header.querySelector('h3').innerHTML = '<i class="fas fa-info-circle" style="color:#409eff;"></i> ' + title;
        // 右上角：全屏 + 关闭 在同一 div（与审批配置模态框一致）
        if (!header.querySelector('.modal-header-actions')) {
            const actions = document.createElement('div');
            actions.className = 'modal-header-actions';
            actions.style.cssText = 'display:flex;align-items:center;gap:6px;';
            const maxBtn = document.createElement('button');
            maxBtn.className = 'maximize-btn';
            maxBtn.innerHTML = '<i class="fas fa-expand"></i>';
            maxBtn.title = '最大化';
            maxBtn.onclick = function (e) {
                e.stopPropagation();
                subsidyApp.toggleMaximize(maxBtn);
            };
            actions.appendChild(maxBtn);
            const closeBtn = header.querySelector('.close-btn');
            header.insertBefore(actions, closeBtn);
            actions.appendChild(closeBtn);
        }
        const body = modal.querySelector('.modal-body');
        body.innerHTML = bodyHtml;
        const footer = modal.querySelector('.modal-footer');
        footer.innerHTML = options.footer || '<button class="btn btn-secondary" onclick="subsidyApp._closeRejectModal()">关闭</button>';
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    toggleMaximize(btn) {
        const mc = btn.closest('.modal-content');
        if (!mc) return;
        const isMax = mc.classList.toggle('maximized');
        const icon = btn.querySelector('i');
        if (icon) icon.className = isMax ? 'fas fa-compress' : 'fas fa-expand';
        btn.title = isMax ? '恢复' : '最大化';
    }

    _closeRejectModal() {
        const modal = document.getElementById('rejectModal');
        const content = modal.querySelector('.modal-content');
        if (content) content.classList.remove('maximized');
        modal.classList.remove('show');
        modal.style.display = 'none';
        this._resetRejectModalBody();
    }

    _resetRejectModalBody() {
        const modal = document.getElementById('rejectModal');
        // 还原弹窗宽度为驳回默认
        const contentEl = modal.querySelector('.modal-content');
        if (contentEl) {
            contentEl.style.maxWidth = '520px';
            contentEl.style.width = '';
        }
        // 还原头部结构（移除最大化按钮与 action 包裹）
        const header = modal.querySelector('.modal-header');
        header.innerHTML = '<h3><i class="fas fa-times-circle" style="color:#f56c6c;"></i> 驳回申领</h3>'
            + '<button class="close-btn" onclick="subsidyApp._closeRejectModal()">&times;</button>';
        const body = modal.querySelector('.modal-body');
        body.innerHTML = '<div class="form-group"><label>驳回原因 <span class="required">*</span></label>'
            + '<textarea id="rejectReasonInput" class="form-textarea" rows="3" placeholder="请填写驳回原因，员工将看到并可重新申领"></textarea></div>';
        const footer = modal.querySelector('.modal-footer');
        footer.innerHTML = '<button class="btn btn-secondary" onclick="subsidyApp._closeRejectModal()">取消</button>'
            + '<button class="btn btn-danger" onclick="subsidyApp._confirmReject()"><i class="fas fa-times"></i> 确认驳回</button>';
    }

    // ===== 发放记录 =====
    async loadPayments() {
        try {
            const data = await this.apiGet(SUBSIDY_API + '/payments/');
            this._renderPayments(data);
        } catch (e) { /* ignore */ }
    }

    // 刷新我的钱包栏（余额 + 提现记录）
    refreshWallet() {
        this.loadWallet();
        this.loadWithdrawals();
        this.showToast('钱包数据已刷新', false);
    }

    // 刷新补贴发放记录栏
    refreshPayments() {
        this.loadPayments();
        this.showToast('发放记录已刷新', false);
    }

    // ===== 钱包与提现 =====
    async loadWallet() {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/wallet/');
            if (!d) return;
            const b = document.getElementById('walletBalance');
            const ti = document.getElementById('walletTotalIn');
            const to = document.getElementById('walletTotalOut');
            const mw = document.getElementById('walletMinWithdraw');
            if (b) b.textContent = '¥' + this._fmtAmount(d.balance);
            if (ti) ti.textContent = '¥' + this._fmtAmount(d.total_in);
            if (to) to.textContent = '¥' + this._fmtAmount(d.total_out);
            if (mw) mw.textContent = '¥' + this._fmtAmount(d.min_withdraw_amount);
            this._minWithdrawAmount = d.min_withdraw_amount || 0;
        } catch (e) { /* ignore */ }
    }

    async loadWithdrawals() {
        try {
            const data = await this.apiGet(SUBSIDY_API + '/withdrawals/');
            this._renderWithdrawals(data);
        } catch (e) { /* ignore */ }
    }

    _renderWithdrawals(data) {
        const body = document.getElementById('withdrawListBody');
        if (!body) return;
        const list = data.results || [];
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#909399;padding:14px;">暂无提现记录</td></tr>';
            return;
        }
        body.innerHTML = list.map(function (w) {
            const stCls = w.status === 'paid' ? 'color:#67c23a;' : w.status === 'rejected' ? 'color:#f56c6c;' : 'color:#e6a23c;';
            const note = w.status === 'rejected' ? (w.reject_reason || '') : (w.note || '');
            return '<tr>'
                + '<td style="color:#e6a23c;font-weight:600;">¥' + this._fmtAmount(w.amount) + '</td>'
                + '<td style="' + stCls + '">' + this._escape(w.status_display || w.status) + '</td>'
                + '<td>' + this._fmtTime(w.requested_at) + '</td>'
                + '<td>' + this._fmtTime(w.paid_at) + '</td>'
                + '<td>' + this._escape(note || '-') + '</td>'
                + '<td><button class="btn btn-sm btn-secondary" onclick="subsidyApp._viewWithdrawalDetail(' + w.id + ')"><i class="fas fa-eye"></i> 详情</button></td>'
                + '</tr>';
        }, this).join('');
    }

    // 查看我的提现申请详情（类似财务支付页的提现详情）
    async _viewWithdrawalDetail(id) {
        try {
            const w = await this.apiGet(SUBSIDY_API + '/withdrawals/' + id + '/');
            if (!w) return;
            const p = w.applicant_payment || {};
            const lines = [
                ['申领人', this._userCell(w.user_name || '-', w.user_avatar)],
                ['申领时间', this._fmtTime(w.requested_at)],
                ['申领金额', '¥' + this._fmtAmount(w.amount)],
                ['剩余金额', '¥' + this._fmtAmount(w.remaining_balance)],
                ['已支付金额', w.payment ? '¥' + this._fmtAmount(w.payment.amount) : '-'],
                ['状态', this._withdrawStatusBadge(w.status)],
                ['支付人员', w.paid_by_name ? this._userCell(w.paid_by_name, w.paid_by_avatar) : '-'],
                ['支付时间', this._fmtTime(w.paid_at)],
                ['备注', this._escape(w.note || '-')],
                ['驳回原因', this._escape(w.reject_reason || '-')],
            ];
            let leftHtml = '<div style="font-size:13px;font-weight:600;color:#16a085;margin-bottom:8px;"><i class="fas fa-clipboard-list"></i> 提现信息</div>';
            lines.forEach(function (l) {
                leftHtml += '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed #eee;font-size:13px;"><span style="color:#909399;flex-shrink:0;">' + l[0] + '</span><span style="text-align:right;">' + l[1] + '</span></div>';
            });
            let voucherHtml = '';
            if (w.payment_voucher) {
                const vName = w.payment_voucher_name || '支付凭证';
                const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(vName);
                voucherHtml = isImg
                    ? '<img src="' + this._mediaUrl(w.payment_voucher) + '" style="max-width:100%;max-height:240px;border-radius:8px;border:1px solid #dcdfe6;cursor:zoom-in;object-fit:contain;background:#fff;" onclick="subsidyApp._previewImage(\'' + this._jsStr(this._mediaUrl(w.payment_voucher)) + '\',\'' + this._jsStr(vName) + '\')" title="点击放大预览">'
                    : '<a href="' + this._mediaUrl(w.payment_voucher) + '" target="_blank"><i class="fas fa-file-pdf" style="color:#f56c6c;font-size:26px;"></i> ' + this._escape(vName) + '</a>';
            }
            const html = '<div style="display:flex;gap:16px;flex-wrap:wrap;">'
                + '<div style="flex:1;min-width:260px;">' + leftHtml + '</div>'
                + (voucherHtml ? '<div style="flex:0 0 auto;min-width:220px;"><div style="font-size:13px;font-weight:600;color:#67c23a;margin-bottom:8px;"><i class="fas fa-money-check-alt"></i> 支付截图</div>' + voucherHtml + '</div>' : '')
                + '</div>';
            this._showModalContent('提现申请详情', html, {width: '680px', footer: '<button class="btn btn-secondary" onclick="subsidyApp._closeRejectModal()">关闭</button>'});
        } catch (e) {
            this.showToast((e && e.message) || '加载失败', true);
        }
    }

    async openWithdrawModal() {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/wallet/');
            if (!d) return;
            this._walletBalance = d.balance || 0;
            const bal = document.getElementById('withdrawBalance');
            const mn = document.getElementById('withdrawMin');
            if (bal) bal.textContent = '¥' + this._fmtAmount(d.balance);
            if (mn) mn.textContent = '¥' + this._fmtAmount(d.min_withdraw_amount);
            this._minWithdrawAmount = d.min_withdraw_amount || 0;
            const amt = document.getElementById('withdrawAmount');
            if (amt) amt.value = '';
            const note = document.getElementById('withdrawNote');
            if (note) note.value = '';
            const modal = document.getElementById('withdrawModal');
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        } catch (e) { this.showToast('加载钱包失败', true); }
    }

    _closeWithdrawModal() {
        const modal = document.getElementById('withdrawModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 150);
        }
    }

    async _confirmWithdraw() {
        const amt = parseFloat(document.getElementById('withdrawAmount').value);
        if (!amt || amt <= 0) { this.showToast('请输入有效的提现金额', true); return; }
        if (this._minWithdrawAmount && amt < this._minWithdrawAmount) {
            this.showToast('提现金额不能低于最小额度 ' + this._minWithdrawAmount + ' 元', true);
            return;
        }
        try {
            const res = await this.apiPost(SUBSIDY_API + '/withdraw/', {
                amount: amt.toFixed(2),
                note: document.getElementById('withdrawNote').value.trim()
            });
            this._closeWithdrawModal();
            this.showToast('提现申请已提交，等待财务支付', false);
            this.loadWallet();
            this.loadWithdrawals();
        } catch (e) {
            this.showToast((e && e.message) || '提现失败', true);
        }
    }



    _renderPayments(data) {
        const body = document.getElementById('payListBody');
        const list = data.results || [];
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#909399;padding:20px;">暂无发放记录</td></tr>';
        } else {
            body.innerHTML = list.map(function (p) {
                return '<tr>'
                    + '<td>' + this._escape(p.application_no || '-') + '</td>'
                    + '<td>' + this._escape(p.invoice_type_display || '-') + '</td>'
                    + '<td style="color:#67c23a;font-weight:600;">¥' + this._fmtAmount(p.amount) + '</td>'
                    + '<td>' + this._fmtTime(p.paid_at) + '</td>'
                    + '<td>' + this._escape(p.note || '-') + '</td>'
                    + '</tr>';
            }, this).join('');
        }
    }

    // ===== 补贴账户 =====
    async _loadAccount() {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/account/');
            if (!d) return;
            document.getElementById('statTotal').textContent = this._fmtAmount(d.total_subsidy);
            document.getElementById('statPending').textContent = d.pending_count || 0;
            document.getElementById('statApproved').textContent = d.approved_count || 0;
            document.getElementById('statRejected').textContent = d.rejected_count || 0;
            this._isVerifier = !!d.is_verifier;
            this._isPaymentStaff = !!d.is_payment_staff;
            this._hasPaymentInfo = !!d.has_payment_info;
            this._taxRateThreshold = d.tax_rate_threshold || 0.06;
            this._invoiceVerifyEnabled = !!d.invoice_verify_enabled;
            this._defaultOcrVersion = d.default_ocr_version || 'paddle';
            console.log('default_ocr_version::', d.default_ocr_version)

            // OCR 识别版本按角色控制：仅管理员以上可手动选择，其余用户锁定为补贴配置的默认版本
            this._applyOcrVersionPermission();
            // 核验人员身份确认后刷新补贴配置按钮可见性（普通管理员不显示）
            this._updateConfigBtnVisibility();
            // 财务核验 / 财务支付导航入口按角色显示
            this._updateRoleNav();
            if (d.max_invoices) {
                this._maxInvoices = d.max_invoices;
                const l1 = document.getElementById('maxInvoicesLabel');
                const l2 = document.getElementById('maxInvoicesLabel2');
                if (l1) l1.textContent = this._maxInvoices;
                if (l2) l2.textContent = this._maxInvoices;
            }
            // 渲染发票抬头信息（总开关 + 字段级开关过滤）
            this._renderInvoiceHeader((d.invoice_header || {}), !!d.show_invoice_header, d.invoice_header_show || {});
        } catch (e) { /* ignore */ }
    }

    _renderInvoiceHeader(ih, showFlag, showMap) {
        const infoEl = document.getElementById('invoiceHeaderInfo');
        const contentEl = document.getElementById('invoiceHeaderContent');
        if (!infoEl || !contentEl) return;
        if (!showFlag) { infoEl.style.display = 'none'; return; }
        showMap = showMap || {};
        const visible = function (key) {
            // 未配置开关（空）时全部显示；配置后按开关过滤
            if (!Object.keys(showMap).length) return true;
            return showMap[key] !== false;
        };
        // 企业主体名称 / 纳税人识别号放在最前，红色强调“必须填写正确”
        const keyRows = [
            ['企业主体名称', ih.company_name, true, 'company_name'],
            ['纳税人识别号', ih.company_tax_no, true, 'company_tax_no']
        ];
        const otherRows = [
            ['发票抬头名称', ih.invoice_header_name, false, 'name'],
            ['发票抬头税号', ih.invoice_header_tax_no, false, 'tax_no'],
            ['发票抬头地址', ih.invoice_header_address, false, 'address'],
            ['发票抬头电话', ih.invoice_header_phone, false, 'phone'],
            ['发票抬头开户行', ih.invoice_header_bank, false, 'bank'],
            ['发票抬头开户账号', ih.invoice_header_bank_account, false, 'bank_account'],
            ['发票抬头开户银行', ih.invoice_header_bank_name, false, 'bank_name']
        ];
        const allRows = keyRows.concat(otherRows);
        const filled = allRows.filter(function (r) { return r[1] && visible(r[3]); });
        if (!filled.length) { infoEl.style.display = 'none'; return; }
        let html = '<div style="color:#f56c6c;font-size:12px;margin-bottom:6px;"><i class="fas fa-exclamation-circle"></i> 企业主体名称、纳税人识别号必须填写正确</div>';
        filled.forEach(function (r) {
            const st = r[2] ? 'color:#f56c6c;font-weight:600;' : '';
            html += '<span style="display:inline-flex;margin-right:16px;margin-bottom:2px;"><span style="color:#909399;">' + r[0] + '：</span><b style="' + st + '">' + this._escape(r[1]) + '</b></span>';
        }, this);
        contentEl.innerHTML = html;
        infoEl.style.display = 'block';
    }

    async _loadPaymentInfo() {
        try {
            const d = await this.apiGet(SUBSIDY_API + '/payment-info/');
            if (d) this._paymentInfo = d;
        } catch (e) { /* ignore */ }
    }

    // ===== 管理员核验 =====
    _adminQuery() {
        const parts = [];
        parts.push('page=' + this.adminPage);
        parts.push('page_size=' + this.pageSize);
        const search = (document.getElementById('adminSearchInput') ? document.getElementById('adminSearchInput').value : '').trim();
        const status = document.getElementById('adminStatusFilter') ? document.getElementById('adminStatusFilter').value : '';
        const type = document.getElementById('adminTypeFilter') ? document.getElementById('adminTypeFilter').value : '';
        const invNumber = document.getElementById('adminInvNumberInput') ? document.getElementById('adminInvNumberInput').value : '';
        const dateFrom = document.getElementById('adminDateFrom') ? document.getElementById('adminDateFrom').value : '';
        const dateTo = document.getElementById('adminDateTo') ? document.getElementById('adminDateTo').value : '';
        const minAmt = document.getElementById('adminMinAmount') ? document.getElementById('adminMinAmount').value : '';
        const maxAmt = document.getElementById('adminMaxAmount') ? document.getElementById('adminMaxAmount').value : '';
        if (search) parts.push('search=' + encodeURIComponent(search));
        if (status) parts.push('status=' + status);
        if (type) parts.push('invoice_type=' + type);
        if (invNumber) parts.push('invoice_number=' + encodeURIComponent(invNumber));
        if (dateFrom) parts.push('date_from=' + dateFrom);
        if (dateTo) parts.push('date_to=' + dateTo);
        if (minAmt) parts.push('min_amount=' + minAmt);
        if (maxAmt) parts.push('max_amount=' + maxAmt);
        return parts.join('&');
    }

    async loadAdmin(page) {
        // 非核验用户（含普通管理员）不加载核验列表，避免无权限报错提示
        if (!this._canVerifyList()) return;
        this.adminPage = page || 1;
        if (this._selectedAdminIds) this._selectedAdminIds.clear();
        const selAll = document.getElementById('adminSelectAll');
        if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
        this._updateExportPrintButtons();
        try {
            const data = await this.apiGet(SUBSIDY_API + '/all/?' + this._adminQuery());
            this._renderAdmin(data);
        } catch (e) {
            console.log('加载核验列表失败:::', e)
            this.showToast('加载核验列表失败', true);
        }
    }

    resetAdminFilter() {
        document.getElementById('adminSearchInput').value = '';
        document.getElementById('adminStatusFilter').value = '';
        document.getElementById('adminTypeFilter').value = '';
        document.getElementById('adminInvNumberInput').value = '';
        document.getElementById('adminDateFrom').value = '';
        document.getElementById('adminDateTo').value = '';
        document.getElementById('adminMinAmount').value = '';
        document.getElementById('adminMaxAmount').value = '';
        this.loadAdmin(1);
    }

    _renderAdmin(data) {
        const body = document.getElementById('adminListBody');
        // 主补贴页不包含核验列表容器（核验列表在财务核验独立页），直接跳过避免报错
        if (!body) return;
        this._adminTotalPages = data.total_pages || 1;
        const list = data.results || [];
        // 记录当前核验列表的申领ID，供详情弹窗上一条/下一条切换
        this._adminRecordIds = list.map(function (r) { return r.id; });
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="14" style="text-align:center;color:#909399;padding:20px;">暂无符合条件的申领</td></tr>';
        } else {
            const self = this;
            body.innerHTML = list.map(function (r) {
                let ops = '<button class="btn btn-sm btn-secondary" onclick="subsidyApp._showDetail(' + r.id + ')"><i class="fas fa-eye"></i> 详情</button>';
                if (r.status === 'pending') {
                    ops += ' <button class="btn btn-sm btn-primary" onclick="subsidyApp.approve(' + r.id + ')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-sm btn-danger" onclick="subsidyApp._openReject(' + r.id + ')"><i class="fas fa-times"></i> 驳回</button>';
                }
                const checked = self._selectedAdminIds && self._selectedAdminIds.has(r.id) ? 'checked' : '';
                return '<tr>'
                    + '<td><input type="checkbox" class="admin-cb" data-id="' + r.id + '" ' + checked + ' onchange="subsidyApp._toggleRecord(' + r.id + ', this.checked)"></td>'
                    + '<td>' + this._escape(r.application_no) + '</td>'
                    + '<td>' + this._userCell(r.applicant_name, r.applicant_avatar) + '</td>'
                    + '<td>' + this._escape(r.applicant_department || '-') + '</td>'
                    + '<td>' + this._escape(r.applicant_position || '-') + '</td>'
                    + '<td>' + this._typeBadge(r.invoice_type, r.invoice_type_display) + '</td>'
                    + '<td>' + this._escape(r.invoice_number || '-') + '</td>'
                    + '<td>¥' + this._fmtAmount(r.invoice_amount) + '</td>'
                    + '<td style="color:#e6a23c;font-weight:600;">¥' + this._fmtAmount(r.subsidy_amount) + '</td>'
                    + '<td>' + this._statusBadge(r.status) + (r.status === 'rejected' && r.reject_reason ? '<div style="font-size:11px;color:#f56c6c;margin-top:2px;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + this._escape(r.reject_reason) + '">' + this._escape(r.reject_reason) + '</div>' : '') + '</td>'
                    + '<td>' + (r.verified_by_name ? this._userCell(r.verified_by_name, r.verified_by_avatar) : '-') + '</td>'
                    + '<td>' + this._fmtTime(r.verified_at) + '</td>'
                    + '<td>' + this._fmtTime(r.created_at) + '</td>'
                    + '<td style="white-space:nowrap;">' + ops + '</td>'
                    + '</tr>';
            }, this).join('');
        }
        this._renderPagination(data, 'adminPagination', 'loadAdmin');
    }

    // ===== 选择与导出/打印 =====
    _getSelectedAdminIds() {
        if (!this._selectedAdminIds) this._selectedAdminIds = new Set();
        return this._selectedAdminIds;
    }

    _toggleRecord(id, checked) {
        const set = this._getSelectedAdminIds();
        if (checked) set.add(id); else set.delete(id);
        const selAll = document.getElementById('adminSelectAll');
        if (selAll) {
            const total = document.querySelectorAll('.admin-cb').length;
            const checkedCount = document.querySelectorAll('.admin-cb:checked').length;
            selAll.checked = total > 0 && checkedCount === total;
            selAll.indeterminate = checkedCount > 0 && checkedCount < total;
        }
        this._updateExportPrintButtons();
    }

    _toggleSelectAll(checked) {
        const set = this._getSelectedAdminIds();
        set.clear();
        document.querySelectorAll('.admin-cb').forEach(function (cb) {
            cb.checked = checked;
            if (checked) {
                const id = parseInt(cb.dataset.id);
                if (id) set.add(id);
            }
        });
        this._updateExportPrintButtons();
    }

    _updateExportPrintButtons() {
        const count = this._selectedAdminIds ? this._selectedAdminIds.size : 0;
        const exportBtn = document.getElementById('subsidyExportBtn');
        const printBtn = document.getElementById('subsidyPrintBtn');
        if (exportBtn) exportBtn.style.opacity = count > 0 ? '' : '0.4';
        if (printBtn) printBtn.style.opacity = count > 0 ? '' : '0.4';
    }

    // ===== 导出 / 打印（需先选择记录，再选择字段） =====
    _adminFilterParts() {
        const parts = [];
        const search = (document.getElementById('adminSearchInput') ? document.getElementById('adminSearchInput').value : '').trim();
        const status = document.getElementById('adminStatusFilter') ? document.getElementById('adminStatusFilter').value : '';
        const type = document.getElementById('adminTypeFilter') ? document.getElementById('adminTypeFilter').value : '';
        const invNumber = document.getElementById('adminInvNumberInput') ? document.getElementById('adminInvNumberInput').value : '';
        const dateFrom = document.getElementById('adminDateFrom') ? document.getElementById('adminDateFrom').value : '';
        const dateTo = document.getElementById('adminDateTo') ? document.getElementById('adminDateTo').value : '';
        const minAmt = document.getElementById('adminMinAmount') ? document.getElementById('adminMinAmount').value : '';
        const maxAmt = document.getElementById('adminMaxAmount') ? document.getElementById('adminMaxAmount').value : '';
        if (search) parts.push('search=' + encodeURIComponent(search));
        if (status) parts.push('status=' + status);
        if (type) parts.push('invoice_type=' + type);
        if (invNumber) parts.push('invoice_number=' + encodeURIComponent(invNumber));
        if (dateFrom) parts.push('date_from=' + dateFrom);
        if (dateTo) parts.push('date_to=' + dateTo);
        if (minAmt) parts.push('min_amount=' + minAmt);
        if (maxAmt) parts.push('max_amount=' + maxAmt);
        return parts;
    }

    exportExcel() {
        this._showExportPrintModal('export');
    }

    printList() {
        this._showExportPrintModal('print');
    }

    _showExportPrintModal(mode) {
        const ids = Array.from(this._getSelectedAdminIds());
        if (!ids.length) { this.showToast('请先选择要导出/打印的申领记录', true); return; }
        const fields = [
            {key: 'application_no', label: '申领编号'},
            {key: 'applicant_name', label: '申请人'},
            {key: 'invoice_type', label: '发票类型'},
            {key: 'invoice_number', label: '发票号码'},
            {key: 'invoice_amount', label: '开票金额(元)'},
            {key: 'subsidy_amount', label: '补贴金额(元)'},
            {key: 'status', label: '状态'},
            {key: 'verified_by', label: '核验人'},
            {key: 'verified_at', label: '核验时间'},
            {key: 'created_at', label: '申请时间'},
            {key: 'invoice_issuer', label: '开票主体'}
        ];
        const self = this;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
        const fieldHtml = fields.map(function (f) {
            return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;cursor:pointer;"><input type="checkbox" class="ef-field-cb" data-key="' + f.key + '" checked> ' + f.label + '</label>';
        }).join('');
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:520px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,0.18);">'
            + '<div style="padding:16px 20px;border-bottom:1px solid #ebeef5;"><h3 style="margin:0;font-size:16px;"><i class="fas fa-' + (mode === 'print' ? 'print' : 'file-excel') + '" style="color:' + (mode === 'print' ? '#409eff' : '#67c23a') + ';"></i> ' + (mode === 'print' ? '打印' : '导出') + ' 申领记录（已选 ' + ids.length + ' 条）</h3></div>'
            + '<div style="padding:16px 20px;"><p style="margin:0 0 12px;font-size:14px;color:#606266;">选择表格字段：</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + fieldHtml + '</div></div>'
            + '<div style="padding:12px 20px;border-top:1px solid #ebeef5;display:flex;gap:10px;justify-content:flex-end;">'
            + '<button class="ef-cancel" style="padding:8px 20px;border:1px solid #dcdfe6;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>'
            + '<button class="ef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">' + (mode === 'print' ? '打印' : '导出') + '</button></div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.ef-cancel').onclick = function () { overlay.remove(); };
        overlay.querySelector('.ef-confirm').onclick = function () {
            const checked = overlay.querySelectorAll('.ef-field-cb:checked');
            const selectedFields = Array.from(checked).map(function (cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showToast('请至少选择一个字段', true); return; }
            const idsArr = Array.from(self._getSelectedAdminIds());
            if (mode === 'print') self._doPrintSelected(idsArr, selectedFields);
            else self._doExportSelected(idsArr, selectedFields);
        };
    }

    _doExportSelected(ids, selectedFields) {
        const token = localStorage.getItem('access_token');
        if (!token) { this._handleAuthError(); return; }
        const parts = this._adminFilterParts();
        parts.push('record_ids=' + ids.join(','));
        parts.push('fields=' + selectedFields.join(','));
        const url = SUBSIDY_API + '/export/?' + parts.join('&');
        const now = new Date();
        const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
        const filename = '普惠补贴申领_' + dateStr + '_' + timeStr + '.xlsx';
        this.showToast('正在导出 Excel，请稍候...', false);
        fetch(url, {headers: TokenManager.getHeaders()}).then(function (resp) {
            if (!resp.ok) throw new Error('导出失败 ' + resp.status);
            return resp.blob();
        }).then(function (blob) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            subsidyApp.showToast('导出成功', false);
        }).catch(function (err) {
            subsidyApp.showToast('导出失败：' + err.message, true);
        });
    }

    async _doPrintSelected(ids, selectedFields) {
        try {
            const parts = this._adminFilterParts();
            parts.push('record_ids=' + ids.join(','));
            parts.push('page=1');
            parts.push('page_size=1000');
            const data = await this.apiGet(SUBSIDY_API + '/all/?' + parts.join('&'));
            const list = data.results || [];
            if (!list.length) { this.showToast('暂无数据可打印', true); return; }
            // 🔧 打印留痕 + 「允许打印」权限门：无权限则拦截
            const printRes = (window.WatermarkManager && WatermarkManager.reportPrint)
                ? await WatermarkManager.reportPrint({page: 'subsidy', target_type: 'subsidy_application', count: list.length})
                : {allowed: true};
            if (printRes && printRes.allowed === false) {
                this.showToast('您没有打印权限，请联系管理员开通', true);
                return;
            }
            const now = new Date();
            const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
                + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            const statusMap = {pending: '待核验', approved: '已通过', rejected: '已驳回'};
            const typeMap = {special: '增值税专用发票', ordinary: '增值税普通发票'};
            const labelMap = {
                application_no: '申领编号', applicant_name: '申请人', invoice_type: '发票类型',
                invoice_number: '发票号码', invoice_amount: '开票金额(元)', subsidy_amount: '补贴金额(元)',
                status: '状态', verified_by: '核验人', verified_at: '核验时间', created_at: '申请时间', invoice_issuer: '开票主体'
            };
            const valueMap = {
                application_no: r => r.application_no,
                applicant_name: r => r.applicant_name || '-',
                invoice_type: r => typeMap[r.invoice_type] || r.invoice_type_display || '-',
                invoice_number: r => r.invoice_number || '-',
                invoice_amount: r => this._fmtAmount(r.invoice_amount),
                subsidy_amount: r => this._fmtAmount(r.subsidy_amount),
                status: r => statusMap[r.status] || r.status || '-',
                verified_by: r => r.verified_by_name || '-',
                verified_at: r => this._fmtTime(r.verified_at),
                created_at: r => this._fmtTime(r.created_at),
                invoice_issuer: r => this._escape(r.invoice_issuer || '-')
            };
            let header = '';
            selectedFields.forEach(function (k) { header += '<th>' + (labelMap[k] || k) + '</th>'; });
            let rows = '';
            list.forEach(function (r) {
                let tr = '<tr>';
                selectedFields.forEach(function (k) {
                    const fn = valueMap[k] || (function () { return r[k] || '-'; });
                    tr += '<td>' + fn(r) + '</td>';
                });
                tr += '</tr>';
                rows += tr;
            }, this);
            const win = window.open('', '_blank', 'width=1000,height=800');
            if (!win) { this.showToast('浏览器拦截了打印窗口，请允许弹窗', true); return; }
            const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>普惠补贴申领列表</title>'
                + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:20px;color:#333;}'
                + '.print-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}'
                + '.print-title{font-size:20px;font-weight:600;color:#409eff;}'
                + '.print-date{font-size:13px;color:#909399;}'
                + 'table{width:100%;border-collapse:collapse;font-size:13px;}'
                + 'th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;}'
                + 'th{background:#f5f7fa;font-weight:600;}'
                + 'tr:nth-child(even){background:#fafafa;}'
                + '.btn{display:inline-block;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:14px;border:none;margin:0 4px;}'
                + '@media print{.no-print{display:none !important;}}'
                + '</style></head><body>'
                + '<div class="print-header"><div class="print-title">普惠补贴申领列表</div><div class="print-date">打印时间：' + dateStr + '</div></div>'
                + '<table><thead><tr>' + header + '</tr></thead><tbody>' + rows + '</tbody></table>'
                + '<div class="no-print" style="text-align:center;margin-top:20px;">'
                + '<button class="btn" style="background:#409eff;color:#fff;" onclick="window.print()">打印</button> '
                + '<button class="btn" style="background:#fff;color:#606266;border:1px solid #dcdfe6;" onclick="window.close()">返回 / 关闭</button>'
                + '</div>'
                + '</body></html>';
            // 🔧 打印默认叠加水印（由管理控制台「打印时添加水印」开关控制）
            const wm = (window.WatermarkManager && WatermarkManager.buildPrintWatermark) ? WatermarkManager.buildPrintWatermark() : null;
            if (wm) html = html.replace('</head>', '<style>' + wm.css + '</style></head>').replace('</body>', wm.html + '</body>');
            win.document.write(html);
            win.document.close();
        } catch (e) {
            this.showToast('打印失败', true);
        }
    }

    // ===== 通过核验：先上传支付凭证（付款截图） =====
    // 核验人员在详情中修改发票类型，后端同步重算补贴比例与补贴金额
    async _changeInvoiceType(id, value) {
        try {
            const res = await this.apiPost(SUBSIDY_API + '/' + id + '/update-invoice-type/', {invoice_type: value});
            this.showToast((res && res.message) || '发票类型已更新，补贴比例/金额已同步', false);
            this._showDetail(id);
        } catch (e) {
            this.showToast((e && e.error) || '修改失败', true);
            this._showDetail(id);
        }
    }

    approve(id) {
        this._approveId = id;
        this._voucherFile = null; // {url, name}
        const preview = document.getElementById('voucherPreviewArea');
        if (preview) preview.innerHTML = '';
        document.getElementById('voucherFile').value = '';
        const confirmBtn = document.getElementById('voucherConfirmBtn');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.opacity = 0.4; }
        // 加载申领人收款信息并展示
        const payeeBox = document.getElementById('voucherPayeeInfo');
        if (payeeBox) {
            payeeBox.style.display = 'none';
            payeeBox.innerHTML = '';
        }
        this.apiGet(SUBSIDY_API + '/' + id + '/').then(function (r) {
            const p = (r && r.applicant_payment) || {};
            const hasAny = (p.payee_name || p.bank_card || p.alipay_account || p.wechat_account || p.alipay_qr || p.wechat_qr);
            if (payeeBox && hasAny) {
                // 左侧：收款人 / 收款账号；右侧：收款码（更大显示区）
                let left = '<div style="flex:1;min-width:0;">'
                    + (p.payee_name ? '<div style="margin-bottom:4px;"><span style="color:#909399;">收款人：</span><b>' + this._escape(p.payee_name) + '</b></div>' : '')
                    + (p.bank_card ? '<div style="margin-bottom:4px;"><span style="color:#909399;">银行卡号：</span>' + this._escape(p.bank_card) + '</div>' : '')
                    + (p.bank_name ? '<div style="margin-bottom:4px;"><span style="color:#909399;">开户银行：</span>' + this._escape(p.bank_name) + '</div>' : '')
                    + (p.bank_address ? '<div style="margin-bottom:4px;"><span style="color:#909399;">开户银行地址：</span>' + this._escape(p.bank_address) + '</div>' : '')
                    + (p.alipay_account ? '<div style="margin-bottom:4px;"><span style="color:#909399;">支付宝账号：</span>' + this._escape(p.alipay_account) + '</div>' : '')
                    + (p.wechat_account ? '<div style="margin-bottom:4px;"><span style="color:#909399;">微信账号：</span>' + this._escape(p.wechat_account) + '</div>' : '')
                    + '</div>';
                let qrCol = '<div style="flex:0 0 auto;display:flex;gap:10px;align-items:flex-start;">';
                if (p.alipay_qr) qrCol += '<div style="text-align:center;"><img src="' + p.alipay_qr + '" style="width:92px;height:92px;border-radius:8px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;background:#fff;" onclick="subsidyApp._previewImage(\'' + this._jsStr(p.alipay_qr) + '\',\'支付宝收款码\')" title="点击预览支付宝收款码"><div style="font-size:11px;color:#909399;margin-top:2px;">支付宝收款码</div></div>';
                if (p.wechat_qr) qrCol += '<div style="text-align:center;"><img src="' + p.wechat_qr + '" style="width:92px;height:92px;border-radius:8px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;background:#fff;" onclick="subsidyApp._previewImage(\'' + this._jsStr(p.wechat_qr) + '\',\'微信收款码\')" title="点击预览微信收款码"><div style="font-size:11px;color:#909399;margin-top:2px;">微信收款码</div></div>';
                qrCol += '</div>';
                let html = '<div style="font-weight:600;color:#7b5bd6;margin-bottom:8px;"><i class="fas fa-user-check"></i> 申领人收款信息</div>'
                    + '<div style="display:flex;gap:14px;align-items:flex-start;">' + left + qrCol + '</div>';
                payeeBox.innerHTML = html;
                payeeBox.style.display = 'block';
            }
        }.bind(this)).catch(function () {});
        const modal = document.getElementById('paymentVoucherModal');
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    _closeVoucherModal() {
        const modal = document.getElementById('paymentVoucherModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
        this._approveId = null;
        this._voucherFile = null;
    }

    _onVoucherSelected(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) { this.showToast('文件不能超过50MB', true); e.target.value = ''; return; }
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'].includes(ext)) {
            this.showToast('仅支持图片或 PDF 文件', true);
            e.target.value = '';
            return;
        }
        const fd = new FormData();
        fd.append('file', file);
        this.showToast('上传中...', false);
        fetch(SUBSIDY_API + '/upload-voucher/', {
            method: 'POST',
            headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
            body: fd
        }).then(r => r.json()).then(d => {
            if (d.url) {
                this._voucherFile = {url: d.url, name: d.name || file.name};
                this._renderVoucherPreview(d.url, d.name || file.name);
                const confirmBtn = document.getElementById('voucherConfirmBtn');
                if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.style.opacity = 1; }
                this.showToast('支付凭证上传成功', false);
            } else {
                this.showToast(d.error || '上传失败', true);
            }
        }).catch(() => this.showToast('上传失败', true));
    }

    _renderVoucherPreview(url, name) {
        const area = document.getElementById('voucherPreviewArea');
        if (!area) return;
        const fname = name || url.split('/').pop() || '支付凭证';
        const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(fname);
        const thumb = isImg
            ? '<img class="subsidy-invoice-thumb" src="' + url + '" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(url) + '\',\'' + this._jsStr(fname) + '\')" title="点击预览">'
            : '<div class="subsidy-invoice-thumb" onclick="subsidyApp._previewInvoice(\'' + this._jsStr(url) + '\',\'' + this._jsStr(fname) + '\')" title="点击查看" style="cursor:pointer;"><i class="fas fa-file-pdf" style="color:#f56c6c;"></i></div>';
        area.innerHTML = '<div class="subsidy-invoice-preview">'
            + thumb
            + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + this._escape(fname) + '</span>'
            + '<button class="btn btn-sm btn-danger" onclick="subsidyApp._removeVoucher()"><i class="fas fa-times"></i> 移除</button>'
            + '</div>';
    }

    _removeVoucher() {
        this._voucherFile = null;
        document.getElementById('voucherFile').value = '';
        document.getElementById('voucherPreviewArea').innerHTML = '';
        const confirmBtn = document.getElementById('voucherConfirmBtn');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.opacity = 0.4; }
    }

    async _confirmApprove() {
        if (!this._approveId) return;
        if (!this._voucherFile) { this.showToast('请先上传支付凭证（付款截图）', true); return; }
        const confirmBtn = document.getElementById('voucherConfirmBtn');
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = 0.4;
        try {
            await this.apiPost(SUBSIDY_API + '/' + this._approveId + '/verify/', {
                action: 'approve',
                payment_voucher: this._voucherFile.url,
                payment_voucher_name: this._voucherFile.name
            });
            this._closeVoucherModal();
            this.showToast('已通过，补贴已自动发放', false);
            this.loadAdmin(1);
            this._loadAccount();
            this.loadPayments();
        } catch (e) {
            this.showToast('操作失败：' + e.message, true);
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = 1;
        }
    }

    _openReject(id) {
        this._rejectId = id;
        const modal = document.getElementById('rejectModal');
        // 弹窗内容可能被详情弹窗覆盖过，先还原驳回表单
        if (!modal.querySelector('#rejectReasonInput')) {
            this._resetRejectModalBody();
        }
        document.getElementById('rejectReasonInput').value = '';
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    async _confirmReject() {
        const reason = document.getElementById('rejectReasonInput').value.trim();
        if (!reason) { this.showAlert('提示', '请填写驳回原因'); return; }
        if (!this._rejectId) return;
        try {
            await this.apiPost(SUBSIDY_API + '/' + this._rejectId + '/verify/', {action: 'reject', reason: reason});
            this._closeRejectModal();
            this.showToast('已驳回', false);
            this.loadAdmin(1);
        } catch (e) {
            this.showToast('操作失败：' + e.message, true);
        }
    }

    // ===== 补贴配置 =====
    async openConfigModal() {
        this._configType = 'global';
        this._configEditKey = null;
        this._configDeleteId = null;
        this._verifierValues = [];
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
        document.getElementById('subsidyDefaultOcrVersion').value = 'paddle';
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
            return '<div class="config-list-item"' + sel + ' onclick="subsidyApp._editConfig(' + c.id + ')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
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
        document.getElementById('subsidyDefaultOcrVersion').value = cfg.default_ocr_version || 'paddle';
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
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="subsidyApp._addVerifier(' + u.id + ',\'' + this._jsStr(u.name) + '\',\'' + this._jsStr(u.avatar || '') + '\')">'
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
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="subsidyApp._removeVerifier(' + i + ')"></i>'
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
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="subsidyApp._addPayStaff(' + u.id + ',\'' + this._jsStr(u.name) + '\',\'' + this._jsStr(u.avatar || '') + '\')">'
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
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="subsidyApp._removePayStaff(' + i + ')"></i>'
                + '</span>';
        }, this).join('');
    }

    // ===== 分页 =====
    _renderPagination(data, containerId, fn) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (!data.total_pages || data.total_pages <= 1) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        container.style.display = 'flex';
        const p = data.page, t = data.total_pages;
        let html = '<div class="oa-pagination-bar">'
            + '<span class="oa-pagination-total">共 ' + (data.count || 0) + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<div class="oa-pagination-page-size"><span>每页</span><select onchange="subsidyApp.onPageSizeChange(event)">'
            + '<option value="10" ' + (this.pageSize === 10 ? 'selected' : '') + '>10</option>'
            + '<option value="20" ' + (this.pageSize === 20 ? 'selected' : '') + '>20</option>'
            + '<option value="50" ' + (this.pageSize === 50 ? 'selected' : '') + '>50</option>'
            + '</select><span>条</span></div>'
            + '<div class="oa-pagination-btns">';
        html += '<button class="pagination-btn" onclick="subsidyApp.' + fn + '(1)" ' + (p <= 1 ? 'disabled' : '') + ' title="首页"><i class="fas fa-angle-double-left"></i></button>';
        html += '<button class="pagination-btn" onclick="subsidyApp.' + fn + '(' + (p - 1) + ')" ' + (p <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        for (let i = Math.max(1, p - 2); i <= Math.min(t, p + 2); i++) {
            html += '<button class="pagination-btn ' + (i === p ? 'active' : '') + '" onclick="subsidyApp.' + fn + '(' + i + ')">' + i + '</button>';
        }
        html += '<button class="pagination-btn" onclick="subsidyApp.' + fn + '(' + (p + 1) + ')" ' + (p >= t ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
        html += '<button class="pagination-btn" onclick="subsidyApp.' + fn + '(' + t + ')" ' + (p >= t ? 'disabled' : '') + ' title="末页"><i class="fas fa-angle-double-right"></i></button>';
        html += '</div>'
            + '<div class="oa-pagination-goto"><span>跳至</span><input type="text" data-fn="' + fn + '" value="' + p + '" onkeydown="if(event.key===\'Enter\')subsidyApp.goToPage(this,' + t + ')"><span>页</span></div>'
            + '</div>';
        container.innerHTML = html;
    }

    onPageSizeChange(e) {
        this.pageSize = parseInt(e.target.value, 10) || 10;
        this.loadMy(1);
        this.loadPayments();
        this.loadAdmin(1);
    }

    goToPage(input, t) {
        const fn = input.getAttribute('data-fn');
        let v = parseInt(input.value, 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > t) v = t;
        if (typeof this[fn] === 'function') this[fn](v);
    }
}
