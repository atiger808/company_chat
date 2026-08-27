// static/js/approval.js - OA审批

const OA_API_URL = '/api/oa';

class ApprovalApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this.statusFilter = '';
        this.typeFilter = '';
        this.scopeFilter = '';  // 我发起的(mine) / 抄送我的(cc)
        this.fileMaxSizeMB = localStorage.getItem('file_max_size') || 50;
        this._rejectId = null;
        this._attachmentFiles = [];
        this._approverNodes = [];
        this._approverNodesReady = false;
        this._isReEdit = false;
        this._reEditId = null;
        this._chainReqSeq = 0;
        this._previewUrls = [];
        this._previewImgs = [];
        this._previewCurrent = 0;
        this._ccUsers = [];
        this._ccDepartments = [];
        this._ccTab = 'users';
        this._ccSearchTimer = null;
        this._configEditType = null;
        this._configEditSubTenant = '';
        this._configApprovers = [];
        this._configFinalApprover = null;   // 最终审批人 {id, name, position}
        this._configCcDepts = [];
        this._configCcUsers = [];
        this._configDeleteId = null;
        this._currentCcType = '';   // tracks which type's CC is currently loaded
        this._approvalTypes = [];          // 审批类型列表（启用：内置+自定义，供选择）
        this._manageTypes = [];            // 类型管理列表（含未启用自定义类型）
        this._dynAttachmentValues = {};    // 动态字段附件值 {key: [{url,name}]}
        this._dynUserValues = {};          // 动态字段成员值 {key: [{id,name}]}
        this._editFormData = {};           // 编辑/回填时的 form_data
        // 可供选择的 FontAwesome 图标（审批类型常用）
        this._ICON_LIST = [
            // 文件/合同/文档
            'fa-file-contract', 'fa-file-invoice', 'fa-file-invoice-dollar', 'fa-file-signature', 'fa-file-lines', 'fa-file-word',
            'fa-file-excel', 'fa-file-pdf', 'fa-file-zipper', 'fa-file-arrow-up', 'fa-file-circle-check', 'fa-clipboard-check',
            'fa-clipboard-list', 'fa-clipboard-question', 'fa-folder-open', 'fa-folder', 'fa-box-archive', 'fa-scroll',
            // 交通/差旅
            'fa-car', 'fa-car-side', 'fa-car-rear', 'fa-bus', 'fa-bus-simple', 'fa-plane', 'fa-plane-departure', 'fa-plane-arrival',
            'fa-train', 'fa-train-subway', 'fa-truck', 'fa-truck-fast', 'fa-motorcycle', 'fa-bicycle', 'fa-taxi', 'fa-ship', 'fa-rocket',
            'fa-suitcase', 'fa-suitcase-rolling', 'fa-luggage-cart', 'fa-map-location-dot', 'fa-map', 'fa-location-dot', 'fa-gas-pump',
            // 人事/转正/调岗
            'fa-user-check', 'fa-user-plus', 'fa-user-shield', 'fa-user-pen', 'fa-user-gear', 'fa-user-tie', 'fa-id-card', 'fa-id-badge',
            'fa-address-card', 'fa-people-group', 'fa-users', 'fa-user-graduate', 'fa-user-clock', 'fa-user-large', 'fa-chalkboard-user',
            'fa-arrow-right-arrow-left', 'fa-arrows-rotate', 'fa-exchange', 'fa-rotate', 'fa-up-right-from-square',
            // 财务/采购/报销
            'fa-money-bill-wave', 'fa-money-bill-1', 'fa-coins', 'fa-sack-dollar', 'fa-handshake', 'fa-handshake-angle', 'fa-box',
            'fa-box-open', 'fa-boxes-stacked', 'fa-cart-plus', 'fa-cart-shopping', 'fa-shopping-cart', 'fa-gift', 'fa-receipt',
            'fa-credit-card', 'fa-wallet', 'fa-bank', 'fa-scale-balanced', 'fa-calculator', 'fa-percent',
            // 办公/设备/其他
            'fa-building', 'fa-building-columns', 'fa-house', 'fa-house-laptop', 'fa-laptop', 'fa-desktop', 'fa-mobile-screen',
            'fa-computer', 'fa-print', 'fa-keyboard', 'fa-mouse', 'fa-network-wired', 'fa-wifi', 'fa-plug', 'fa-plug-circle-check',
            'fa-shield-halved', 'fa-shield', 'fa-lock', 'fa-key', 'fa-fingerprint', 'fa-shield-virus',
            'fa-medal', 'fa-award', 'fa-trophy', 'fa-star', 'fa-certificate', 'fa-fire', 'fa-bolt',
            'fa-calendar', 'fa-calendar-check', 'fa-calendar-days', 'fa-clock', 'fa-hourglass-half', 'fa-stopwatch', 'fa-alarm-clock',
            'fa-heart', 'fa-heart-pulse', 'fa-stethoscope', 'fa-briefcase', 'fa-chart-line', 'fa-chart-pie', 'fa-chart-bar',
            'fa-tasks', 'fa-check-double', 'fa-circle-check', 'fa-list-check', 'fa-gavel', 'fa-book', 'fa-graduation-cap', 'fa-wrench', 'fa-gear'
        ];
        // 金额字段单位（币种）
        this._AMOUNT_UNITS = [
            {code: 'cny', label: '人民币', symbol: '¥'},
            {code: 'usd', label: '美元', symbol: '$'},
            {code: 'eur', label: '欧元', symbol: '€'},
            {code: 'gbp', label: '英镑', symbol: '£'},
            {code: 'jpy', label: '日元', symbol: '¥'},
            {code: 'hkd', label: '港币', symbol: 'HK$'},
            {code: 'krw', label: '韩元', symbol: '₩'},
            {code: 'aud', label: '澳元', symbol: 'A$'},
            {code: 'cad', label: '加元', symbol: 'C$'},
            {code: 'sgd', label: '新加坡元', symbol: 'S$'}
        ];
        // 数字字段单位
        this._NUMBER_UNITS = [
            {code: 'ge', label: '个'}, {code: 'tian', label: '天'}, {code: 'xiaoshi', label: '小时'},
            {code: 'jian', label: '件'}, {code: 'tao', label: '套'}, {code: 'ci', label: '次'},
            {code: 'ben', label: '本'}, {code: 'tai', label: '台'}, {code: 'gege', label: '台(台)'},
            {code: 'ren', label: '人'}, {code: 'dun', label: '吨'}, {code: 'kg', label: '千克'},
            {code: 'li', label: '里'}, {code: 'gongli', label: '公里'}, {code: 'pingfang', label: '平方米'},
            {code: 'lip', label: '粒'}, {code: 'pi', label: '批'}, {code: 'che', label: '车'}
        ];
        this.chat_login_url = '/login/';
        this._initStarted = false;

        // 全局错误捕获：任何异常都打到控制台并显示可见错误条，便于定位问题
        if (!window.__approvalErrBound) {
            window.__approvalErrBound = true;
            const showErr = (msg) => {
                console.error('[审批页] ', msg);
                try {
                    let el = document.getElementById('approvalFatalError');
                    if (!el) {
                        el = document.createElement('div');
                        el.id = 'approvalFatalError';
                        el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#f56c6c;color:#fff;padding:8px 12px;font-size:13px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer;';
                        el.onclick = function() { el.remove(); };
                        document.body.appendChild(el);
                    }
                    el.textContent = '审批页加载出错：' + msg + '（点击关闭）';
                } catch (ignore) {}
            };
            window.addEventListener('error', function (e) {
                if (e && e.message) showErr(e.message);
            });
            window.addEventListener('unhandledrejection', function (e) {
                const r = e && e.reason;
                const m = (r && (r.message || r.error)) || String(r) || 'unhandledrejection';
                showErr(m);
            });
        }

        // 确保 init 一定会被调用：DOM 未就绪时监听 DOMContentLoaded，已就绪则立即执行；
        // 并用 _initStarted 防止重复初始化。
        const start = () => {
            if (!this._initStarted) {
                this._initStarted = true;
                this.init().catch(function (err) {
                    console.error('审批页 init 失败:', err);
                    if (window.__approvalErrBound) {
                        window.dispatchEvent(new ErrorEvent('error', {message: (err && err.message) || 'init 失败'}));
                    }
                });
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start);
            window.addEventListener('load', start); // 兜底：万一 DOMContentLoaded 未触发
            // 已就绪则立即启动
            if (document.readyState !== 'loading') start();
        } else {
            // 微任务延迟一拍，确保构造完成后 DOM 查询稳定
            Promise.resolve().then(start);
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
        // 管理员按钮：先按本地信息立即显示（不等待列表/类型加载），再以接口实时校正
        var isAdmin = this._isAdminFromStorage();
        console.log('isAdmin:', isAdmin);
        this._applyAdminButtons(isAdmin);
        // 物资管理/物品库入口在「审批服务」下拉（该下拉仅管理员可见），无需额外显隐
        // 各初始化步骤独立容错：任一失败不阻断后续执行
        try {
            await this.loadList();
        } catch (e) {
            console.error('加载审批列表失败:', e);
        }
        try {
            await this._loadApprovalTypes();
        } catch (e) {
            console.error('加载审批类型失败:', e);
        }
        // 实时校正管理员状态（避免 localStorage 未写入/过期导致按钮不显示）
        try {
            const me = await this.apiGet('/api/auth/me/');
            if (me && me.user_type) {
                localStorage.setItem('user_type', me.user_type);
                if (me.id) localStorage.setItem('user_id', me.id);
                if (me.avatar_url || me.avatar) {
                    try { localStorage.setItem('current_user', JSON.stringify(me)); } catch (ignore) {}
                }
                var realAdmin = (me.user_type === 'super_admin' || me.user_type === 'admin');
                console.log('realAdmin::', realAdmin);
                if (realAdmin !== isAdmin) {
                    isAdmin = realAdmin;
                    this._applyAdminButtons(isAdmin);
                }
            }
        } catch (e) {
            console.warn('获取当前用户失败，使用本地 user_type:', isAdmin ? '管理员' : '非管理员');
        }
        this._ccTab = 'users';
        // 从工作通知跳转：自动打开对应审批详情模态框
        try {
            const qp = new URLSearchParams(window.location.search);
            const approvalId = qp.get('approval_id');
            if (approvalId) {
                setTimeout(function () { approvalApp.showDetail(parseInt(approvalId, 10)); }, 300);
            }
        } catch (e) { /* ignore */ }
    }

    _isAdminFromStorage() {
        var ut = localStorage.getItem('user_type');
        if (ut === 'admin' || ut === 'super_admin') return true;
        try {
            var cu = JSON.parse(localStorage.getItem('current_user') || '{}');
            if (cu.user_type === 'admin' || cu.user_type === 'super_admin') return true;
        } catch (e) {}
        return false;
    }

    _applyAdminButtons(isAdmin) {
        var configBtn = document.getElementById('approvalConfigBtn');
        if (configBtn) configBtn.style.display = isAdmin ? 'inline-flex' : 'none';
        var typeManageBtn = document.getElementById('approvalTypeManageBtn');
        if (typeManageBtn) typeManageBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }

    // 内置类型兜底（接口异常时保证类型筛选/选择仍可用）
    _fallbackBuiltinTypes() {
        return [
            {code: 'leave', name: '请假', icon: 'fa-calendar-check', color: '#409EFF', is_builtin: true, form_schema: []},
            {code: 'overtime', name: '加班', icon: 'fa-clock', color: '#e6a23c', is_builtin: true, form_schema: []},
            {code: 'expense', name: '报销', icon: 'fa-file-invoice-dollar', color: '#67c23a', is_builtin: true, form_schema: []},
            {code: 'trip', name: '出差', icon: 'fa-plane', color: '#9b59b6', is_builtin: true, form_schema: []},
            {code: 'purchase', name: '采购', icon: 'fa-cart-plus', color: '#f56c6c', is_builtin: true, form_schema: []},
            {code: 'recruit', name: '招聘需求', icon: 'fa-user-plus', color: '#e6a23c', is_builtin: true, form_schema: []},
            {code: 'other', name: '其他', icon: 'fa-file-lines', color: '#909399', is_builtin: true, form_schema: []}
        ];
    }

    // ===== 单位工具（金额币种 / 数字单位） =====
    _unitOf(code) {
        return (this._AMOUNT_UNITS || []).find(function (u) { return u.code === code; })
            || (this._NUMBER_UNITS || []).find(function (u) { return u.code === code; }) || null;
    }

    _unitSymbol(code) {
        const u = this._unitOf(code);
        return u ? u.symbol : '';
    }

    _unitLabel(code) {
        const u = this._unitOf(code);
        return u ? u.label : '';
    }

    _schemaUnitOptions(type, selected) {
        const list = type === 'amount' ? (this._AMOUNT_UNITS || []) : (type === 'number' ? (this._NUMBER_UNITS || []) : []);
        if (type === 'amount' && !selected) selected = 'cny'; // 金额默认人民币元
        let html = '<option value="">单位</option>';
        html += list.map(function (u) {
            return '<option value="' + u.code + '"' + (selected === u.code ? ' selected' : '') + '>' + u.label + '</option>';
        }).join('');
        return html;
    }

    // 字段类型变化时刷新单位下拉选项与选项输入占位（amount→币种，number→数量单位，struct_table→列定义）
    _onSchemaFieldTypeChange(sel) {
        const row = sel.closest('.tm-field-row');
        if (!row) return;
        const unitSel = row.querySelector('[data-f="unit"]');
        if (unitSel) unitSel.innerHTML = this._schemaUnitOptions(sel.value, unitSel.value);
        const optSel = row.querySelector('[data-f="options"]');
        if (optSel) optSel.placeholder = this._schemaOptionsPlaceholder(sel.value);
    }

    // ===== 审批类型（动态自定义） =====
    async _loadApprovalTypes() {
        try {
            const data = await this.apiGet(OA_API_URL + '/approval/types/');
            this._approvalTypes = Array.isArray(data) ? data : (data.results || []);
            if (!this._approvalTypes.length) this._approvalTypes = this._fallbackBuiltinTypes();
        } catch (e) {
            console.error('加载审批类型失败，使用内置类型兜底:', e);
            this._approvalTypes = this._fallbackBuiltinTypes();
        }
        this._renderTypeSelector();
        this._renderTypeFilterBar();
        this._renderConfigTypeGrid();
        const cur = document.getElementById('newApprovalType');
        if (cur && !cur.value && this._approvalTypes.length) {
            this.selectType(this._approvalTypes[0].code);
        } else if (cur && cur.value && (!this._isBuiltinType(cur.value) || this._isDynamicSchemaType(cur.value))) {
            // 类型保存后：当前已选中的自定义/带表单内置类型实时重渲染动态表单（无需刷新页面）
            const t = this._getType(cur.value);
            this._renderDynamicFields(t ? (t.form_schema || []) : [], this._editFormData || {});
        }
    }

    _getType(code) {
        return (this._approvalTypes || []).find(t => t.code === code) || null;
    }

    _getTypeName(code) {
        const t = this._getType(code);
        return t ? t.name : code;
    }

    _getTypeIcon(code) {
        const t = this._getType(code);
        return t ? t.icon : this._typeIcon(code);
    }

    _getTypeColor(code) {
        const t = this._getType(code);
        return t ? t.color : '#409EFF';
    }

    _hexA(hex, alpha) {
        try {
            const h = String(hex || '#409EFF').replace('#', '');
            const r = parseInt(h.substring(0, 2), 16);
            const g = parseInt(h.substring(2, 4), 16);
            const b = parseInt(h.substring(4, 6), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        } catch (e) {
            return 'rgba(64,158,255,0.12)';
        }
    }

    _renderTypeSelector() {
        const container = document.getElementById('approvalTypeSelector');
        if (!container) return;
        container.innerHTML = (this._approvalTypes || []).map(t => {
            return '<div class="type-card" data-type="' + this._escape(t.code) + '" onclick="approvalApp.selectType(\'' + this._escape(t.code) + '\')">'
                + '<div class="type-card-icon" style="background:' + this._hexA(t.color, 0.14) + ';color:' + this._escape(t.color) + ';"><i class="fas ' + this._escape(t.icon || 'fa-file-lines') + '"></i></div>'
                + '<div class="type-card-label">' + this._escape(t.name) + '</div>'
                + '</div>';
        }).join('');
    }

    _renderTypeFilterBar() {
        const container = document.getElementById('approvalTypeFilterBar');
        if (!container) return;
        let html = '<span class="type-filter-card active" data-type="" onclick="approvalApp.filterByTypeBtn(this,\'\')">'
            + '<div class="type-filter-card-icon" style="background:#e8f4fd;color:#409eff;"><i class="fas fa-list"></i></div>'
            + '<div class="type-filter-card-label">全部</div></span>';
        html += (this._approvalTypes || []).map(t => {
            return '<span class="type-filter-card" data-type="' + this._escape(t.code) + '" onclick="approvalApp.filterByTypeBtn(this,\'' + this._escape(t.code) + '\')">'
                + '<div class="type-filter-card-icon" style="background:' + this._hexA(t.color, 0.14) + ';color:' + this._escape(t.color) + ';"><i class="fas ' + this._escape(t.icon || 'fa-file-lines') + '"></i></div>'
                + '<div class="type-filter-card-label">' + this._escape(t.name) + '</div></span>';
        }).join('');
        container.innerHTML = html;
    }

    _renderConfigTypeGrid() {
        const grid = document.getElementById('config-type-grid');
        if (!grid) return;
        grid.innerHTML = (this._approvalTypes || []).map(t => {
            return '<div class="config-type-card" data-type="' + this._escape(t.code) + '" onclick="approvalApp._selectConfigType(\'' + this._escape(t.code) + '\')">'
                + '<div class="config-type-icon" style="background:' + this._hexA(t.color, 0.12) + ';color:' + this._escape(t.color) + ';"><i class="fas ' + this._escape(t.icon || 'fa-file-lines') + '"></i></div>'
                + '<span>' + this._escape(t.name) + '</span>'
                + '</div>';
        }).join('');
    }

    // ===== 自定义类型动态表单引擎 =====
    _isBuiltinType(code) {
        const t = this._getType(code);
        if (t) return t.is_builtin;
        return ['leave', 'overtime', 'expense', 'trip', 'purchase', 'recruit', 'other'].indexOf(code) !== -1;
    }

    // 是否渲染动态表单：自定义类型，或带 form_schema 的内置类型（如物资需求单/领用单）
    _isDynamicSchemaType(code) {
        const t = this._getType(code);
        return !!(t && t.form_schema && t.form_schema.length);
    }

    _hideBuiltinFields() {
        ['dateRow', 'amountGroup', 'expenseRow', 'recruitForm',
         'leaveTypeRow', 'tripInfoRow', 'purchaseItemsRow', 'expenseItemsRow'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    _renderDynamicFields(schema, values) {
        const container = document.getElementById('dynamicFormFields');
        if (!container) return;
        values = values || {};
        this._currentSchema = schema || [];
        this._dynAttachmentValues = {};
        this._dynUserValues = {};
        this._dynReqLinkValues = {};
        let html = '';
        const self = this;
        (schema || []).forEach(f => {
            const key = f.key, label = f.label || key, type = f.type || 'text';
            const req = f.required ? ' <span class="required">*</span>' : '';
            const val = values[key] !== undefined ? values[key] : (f.default !== undefined ? f.default : '');
            const placeholder = f.placeholder || '';
            html += '<div class="form-group" style="margin-top:12px;">';
            html += '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;"><i class="fas fa-edit" style="color:#9b59b6;margin-right:4px;"></i> ' + self._escape(label) + req + '</label>';
            switch (type) {
                case 'textarea':
                    html += '<textarea class="form-textarea" data-k="' + self._escape(key) + '" rows="2" placeholder="' + self._escape(placeholder) + '" style="min-height:56px;">' + self._escape(val) + '</textarea>';
                    break;
                case 'select': {
                    html += '<select class="form-select" data-k="' + self._escape(key) + '"><option value="">请选择</option>';
                    (f.options || []).forEach(o => {
                        const ov = typeof o === 'object' ? o.value : o;
                        const ol = typeof o === 'object' ? (o.label || o.value) : o;
                        html += '<option value="' + self._escape(ov) + '"' + (String(val) === String(ov) ? ' selected' : '') + '>' + self._escape(ol) + '</option>';
                    });
                    html += '</select>';
                    break;
                }
                case 'radio': {
                    (f.options || []).forEach(o => {
                        const ov = typeof o === 'object' ? o.value : o;
                        const ol = typeof o === 'object' ? (o.label || o.value) : o;
                        html += '<label style="margin-right:14px;font-size:13px;cursor:pointer;"><input type="radio" name="dyn_' + self._escape(key) + '" value="' + self._escape(ov) + '"' + (String(val) === String(ov) ? ' checked' : '') + '> ' + self._escape(ol) + '</label>';
                    });
                    break;
                }
                case 'checkbox': {
                    const arr = Array.isArray(val) ? val : (val ? [val] : []);
                    (f.options || []).forEach(o => {
                        const ov = typeof o === 'object' ? o.value : o;
                        const ol = typeof o === 'object' ? (o.label || o.value) : o;
                        html += '<label style="margin-right:14px;font-size:13px;cursor:pointer;"><input type="checkbox" name="dyn_' + self._escape(key) + '" value="' + self._escape(ov) + '"' + (arr.indexOf(ov) !== -1 ? ' checked' : '') + '> ' + self._escape(ol) + '</label>';
                    });
                    break;
                }
                case 'date':
                    html += '<input type="date" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '">';
                    break;
                case 'datetime':
                    html += '<input type="datetime-local" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '">';
                    break;
                case 'number':
                    html += '<div style="display:flex;align-items:center;gap:6px;"><input type="number" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '" placeholder="' + self._escape(placeholder) + '" oninput="approvalApp._onDynNumericChange()" style="flex:1;">'
                        + (f.unit ? '<span style="font-size:12px;color:#909399;white-space:nowrap;flex-shrink:0;">' + self._escape(self._unitLabel(f.unit)) + '</span>' : '') + '</div>';
                    break;
                case 'amount':
                    html += '<div style="display:flex;align-items:center;gap:6px;">'
                        + (f.unit ? '<span style="font-size:15px;font-weight:600;color:#e6a23c;white-space:nowrap;flex-shrink:0;">' + self._escape(self._unitSymbol(f.unit)) + '</span>' : '<i class="fas fa-yen-sign" style="color:#e6a23c;"></i>')
                        + '<input type="number" step="0.01" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '" placeholder="0.00" oninput="approvalApp._onDynNumericChange()" style="flex:1;' + (f.readonly ? 'background:#f5f7fa;' : '') + '"' + (f.readonly ? ' disabled' : '') + '>'
                        + (f.unit ? '<span style="font-size:12px;color:#909399;white-space:nowrap;flex-shrink:0;">' + self._escape(self._unitLabel(f.unit)) + '</span>' : '') + '</div>';
                    break;
                case 'attachment':
                    html += '<div class="dyn-attachment"><input type="file" multiple style="display:none;" onchange="approvalApp._onDynAttachmentChange(event, \'' + self._escape(key) + '\')">'
                        + '<button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.click()"><i class="fas fa-paperclip"></i> 选择附件</button>'
                        + '<div class="dyn-attach-list" id="dynAttach_' + self._escape(key) + '"></div></div>';
                    break;
                case 'department':
                    html += '<select class="form-select" data-k="' + self._escape(key) + '" id="dynDept_' + self._escape(key) + '"><option value="">请选择部门</option></select>';
                    break;
                case 'user':
                    html += '<div class="dyn-user"><div style="position:relative;">'
                        + '<input type="text" class="form-input" placeholder="搜索成员添加..." oninput="approvalApp._onDynUserSearch(event, \'' + self._escape(key) + '\')">'
                        + '<div class="dyn-user-results" id="dynUserRes_' + self._escape(key) + '" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:#fff;border:1px solid #dcdfe6;border-radius:6px;max-height:160px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);"></div>'
                        + '</div><div class="dyn-user-tags" id="dynUserTags_' + self._escape(key) + '"></div></div>';
                    break;
                case 'expense_type':
                    // 费用类型选择：原生 select 隐藏存值，自定义下拉展示（已选仅名称，下拉项带小字提示）
                    html += '<div class="exp-select-field">'
                        + '<select class="form-select exp-select-native" data-k="' + self._escape(key) + '">' + self._expenseTypeOptionHtml(val) + '</select>'
                        + '</div>';
                    break;
                case 'struct_table': {
                    const ro = !!f.readonly;
                    html += '<div class="dyn-struct-table" data-struct-key="' + self._escape(key) + '"' + (ro ? ' data-readonly="1"' : '') + '>'
                        + '<div class="dyn-struct-rows"></div>'
                        + (ro ? '' : '<button type="button" class="btn btn-sm btn-secondary dyn-struct-add" onclick="approvalApp._addDynStructRow(\'' + self._escape(key) + '\')"><i class="fas fa-plus"></i> 添加明细</button>')
                        + '</div>';
                    break;
                }
                case 'link_requisition': {
                    html += '<div class="dyn-reqlink"><div style="position:relative;">'
                        + '<input type="text" class="form-input" placeholder="输入需求单号/分公司/物品名称搜索..." oninput="approvalApp._onDynReqLinkSearch(event, \'' + self._escape(key) + '\')">'
                        + '<div class="dyn-reqlink-res" id="dynReqLinkRes_' + self._escape(key) + '" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:#fff;border:1px solid #dcdfe6;border-radius:6px;max-height:180px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);"></div>'
                        + '</div><div class="dyn-reqlink-tag" id="dynReqLinkTag_' + self._escape(key) + '"></div></div>';
                    break;
                }
                default:
                    html += '<input type="text" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '" placeholder="' + self._escape(placeholder) + '">';
            }
            html += '</div>';
        });
        container.innerHTML = html;
        container.style.display = 'block';
        (schema || []).forEach(f => {
            if (f.type === 'attachment') {
                this._dynAttachmentValues[f.key] = Array.isArray(values[f.key]) ? values[f.key] : [];
                this._renderDynAttachList(f.key);
            }
            if (f.type === 'user') {
                this._dynUserValues[f.key] = Array.isArray(values[f.key]) ? values[f.key] : [];
                this._renderDynUserTags(f.key);
            }
            if (f.type === 'department') {
                // 始终加载部门下拉（新建审批无值也要渲染选项）
                this._loadDynDeptOptions(f.key, values[f.key], f.scope);
            }
            if (f.type === 'struct_table') {
                this._dynStructCols = this._dynStructCols || {};
                this._dynStructCols[f.key] = f.columns || [];
                this._dynStructReadonly = this._dynStructReadonly || {};
                this._dynStructReadonly[f.key] = !!f.readonly;
                this._renderDynStructRows(f.key, values[f.key], f.columns || []);
            }
            if (f.type === 'link_requisition') {
                this._dynReqLinkValues = this._dynReqLinkValues || {};
                this._dynReqLinkValues[f.key] = (typeof values[f.key] === 'object' && values[f.key]) ? values[f.key] : null;
                this._renderDynReqLinkTag(f.key);
                // 若已选需求单，自动带出明细
                const lv = this._dynReqLinkValues[f.key];
                if (lv && lv.requirement_id && f.target) {
                    this._autoFillRequisitionDetail(f.key, f.target, lv.requirement_id);
                }
            }
            if (f.type === 'expense_type') {
                let target = null;
                container.querySelectorAll('select[data-k]').forEach(function (s) {
                    if (s.getAttribute('data-k') === f.key) target = s;
                });
                this._buildExpenseSelect(target);
            }
        });
    }

    // 费用类型选择：选项与内置报销一致（名称 + 括号提示）
    // 费用类型数据源（value, 名称, 提示内容）
    _getExpenseTypeList() {
        return [
            ['travel', '差旅费', '出差机票、火车票、住宿费'],
            ['office', '办公费', '办公家具、文具用品、公司用车油费、打印机耗材、电脑配件、纸张类、桶装水、水电费、办公软件、行业会员费等'],
            ['meals', '业务招待费', '招待餐费、招待住宿、伴手礼、等招待相关的费用'],
            ['transport', '交通费', '市内打车、公交车、油费'],
            ['communication', '通讯费', '电话费、宽带费'],
            ['equipment', '设备采购', '电脑、服务器、空调等固定资产'],
            ['training', '培训费', '讲课费、场地费、和培训相关的吃住行等费用'],
            ['welfare', '员工福利费', '员工活动餐费、过年过节福利用品及费用'],
            ['professional_service', '专业服务费', '咨询费、审计费、律师费、资产评估费等'],
            ['advertising', '广告宣传费', '广告策划宣传等'],
            ['other_expense', '其他', '']
        ];
    }

    _getExpenseTypeInfo(value) {
        const list = this._getExpenseTypeList();
        for (let i = 0; i < list.length; i++) {
            if (list[i][0] === value) return {name: list[i][1], hint: list[i][2]};
        }
        return null;
    }

    // 费用类型选择：下拉仅显示类型名称，选择后以弹窗形式提示费用说明
    _expenseTypeOptionHtml(selected) {
        let html = '<option value="">请选择</option>';
        this._getExpenseTypeList().forEach(function (o) {
            html += '<option value="' + o[0] + '"' + (String(selected) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        return html;
    }

    // 结构化明细：回填已有行
    _renderDynStructRows(key, rows, columns) {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + key + '"]');
        if (!tbl) return;
        const rowsEl = tbl.querySelector('.dyn-struct-rows');
        if (!rowsEl) return;
        const readonly = this._dynStructReadonly && this._dynStructReadonly[key];
        rowsEl.innerHTML = '';
        (rows || []).forEach(function (row) {
            if (typeof row !== 'object') return;
            approvalApp._appendDynStructRow(tbl, row, columns, readonly);
        });
    }

    _appendDynStructRow(tbl, row, columns, readonly) {
        const rowsEl = tbl.querySelector('.dyn-struct-rows');
        if (!rowsEl || !columns || !columns.length) return;
        row = row || {};
        const wrap = document.createElement('div');
        wrap.className = 'dyn-struct-row';
        wrap.innerHTML = '<div class="dyn-struct-fields">'
            + columns.map(function (c) {
                const val = row[c.key] !== undefined ? row[c.key] : '';
                const isNumeric = c.type === 'amount' || c.type === 'number';
                const isItem = c.type === 'item';
                if (readonly) {
                    // 只读（如领用单关联需求单自动带出的明细）：文本展示 + 隐藏值用于提交收集，不可改/删/加
                    let txt = val;
                    if (c.type === 'amount' && val !== '' && val != null) txt = Number(val).toFixed(2);
                    return '<div class="dyn-struct-field"><label>' + approvalApp._escape(c.label || c.key) + '</label>'
                        + '<input type="hidden" class="dyn-struct-input" data-c="' + approvalApp._escape(c.key) + '" value="' + approvalApp._escape(val) + '">'
                        + '<div class="dyn-struct-ro" style="padding:6px 10px;background:#f5f7fa;border:1px solid #ebeef5;border-radius:4px;color:#606266;font-size:13px;min-height:20px;">' + approvalApp._escape(txt === '' ? '-' : txt) + '</div></div>';
                }
                const inputAttrs = c.type === 'amount'
                    ? 'type="number" step="0.01" placeholder="0.00"'
                    : (c.type === 'number' ? 'type="number"' : 'type="text"');
                const onInput = (isNumeric || isItem) ? ' oninput="approvalApp._onDynStructChange()"' : '';
                const input = '<input ' + inputAttrs + onInput + ' autocomplete="off" class="form-input dyn-struct-input" data-c="' + approvalApp._escape(c.key) + '"' + (isItem ? ' data-item="1" placeholder="输入或搜索物品"' : '') + ' value="' + approvalApp._escape(val) + '">';
                return '<div class="dyn-struct-field">'
                    + '<label>' + approvalApp._escape(c.label || c.key) + '</label>'
                    + input
                    + (isItem ? '<div class="dyn-struct-item-res" style="position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #dcdfe6;border-radius:6px;max-height:160px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);display:none;"></div>' : '')
                    + '</div>';
            }).join('')
            + '</div>'
            + (readonly ? '' : '<button type="button" class="dyn-struct-del" title="删除此行" onclick="approvalApp._removeDynStructRow(this)"><i class="fas fa-times"></i></button>');
        rowsEl.appendChild(wrap);
        // 物品名称列：挂接物品库联想（只读明细不挂接）
        if (!readonly) {
            wrap.querySelectorAll('.dyn-struct-input[data-item="1"]').forEach(function (input) {
                approvalApp._bindDynStructItemAuto(input);
            });
        }
    }

    // 物品名称列联想：从物品库搜索，选中后自动回填规格/单位
    _bindDynStructItemAuto(input) {
        const field = input.closest('.dyn-struct-field');
        if (!field) return;
        const res = field.querySelector('.dyn-struct-item-res');
        if (!res) return;
        let timer = null;
        input.addEventListener('input', function (e) {
            const kw = e.target.value.trim();
            if (!kw) { res.style.display = 'none'; return; }
            clearTimeout(timer);
            timer = setTimeout(function () {
                fetch(OA_API_URL + '/material/item-search/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()})
                    .then(r => r.json()).then(function (d) {
                        const items = d.results || [];
                        if (!items.length) { res.innerHTML = '<div style="padding:6px 10px;color:#909399;font-size:12px;">未找到物品，可直接输入</div>'; }
                        else {
                            res.innerHTML = items.map(function (it) {
                                return '<div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px;" onclick="approvalApp._pickDynStructItem(this)" data-name="' + approvalApp._escape(it.name) + '" data-spec="' + approvalApp._escape(it.spec || '') + '" data-unit="' + approvalApp._escape(it.unit || '') + '" data-price="' + approvalApp._escape(it.price || '') + '">'
                                    + '<span>' + approvalApp._escape(it.name) + '</span>'
                                    + (it.spec ? ' <span style="font-size:11px;color:#909399;">' + approvalApp._escape(it.spec) + '</span>' : '')
                                    + (it.unit ? ' <span style="font-size:11px;color:#c0c4cc;">' + approvalApp._escape(it.unit) + '</span>' : '')
                                    + (it.price ? ' <span style="font-size:11px;color:#e6a23c;">¥' + approvalApp._escape(it.price) + '</span>' : '')
                                    + '</div>';
                            }).join('');
                        }
                        res.style.display = 'block';
                    }).catch(function () {});
            }, 200);
        });
        input.addEventListener('blur', function () {
            setTimeout(function () { res.style.display = 'none'; }, 200);
        });
    }

    _pickDynStructItem(el) {
        const input = el.closest('.dyn-struct-field').querySelector('.dyn-struct-input[data-item="1"]');
        if (input) input.value = el.getAttribute('data-name') || '';
        const row = el.closest('.dyn-struct-row');
        if (row) {
            const spec = el.getAttribute('data-spec');
            const unit = el.getAttribute('data-unit');
            const price = el.getAttribute('data-price');
            const specIn = row.querySelector('.dyn-struct-input[data-c="spec"]');
            const unitIn = row.querySelector('.dyn-struct-input[data-c="unit"]');
            const priceIn = row.querySelector('.dyn-struct-input[data-c="price"]');
            if (specIn && spec) specIn.value = spec;
            if (unitIn && unit) unitIn.value = unit;
            if (priceIn && price) priceIn.value = price;
        }
        const res = el.parentNode;
        if (res) res.style.display = 'none';
        approvalApp._onDynStructChange();
    }

    // 结构化明细变更：自动把明细金额/数字列合计写入顶层「金额/合计」阈值字段，并刷新审批链（联动阈值审批）
    _onDynStructChange() {
        const typeEl = document.getElementById('newApprovalType');
        const type = typeEl ? typeEl.value : '';
        if (type && (!this._isBuiltinType(type) || this._isDynamicSchemaType(type))) {
            const t = this._getType(type);
            const schema = (t && t.form_schema) || [];
            let totalSum = 0;
            const self = this;
            schema.forEach(function (f) {
                if (f.type !== 'struct_table') return;
                const cols = f.columns || [];
                const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + f.key + '"]');
                if (!tbl) return;
                const priceCol = cols.find(function (c) { return c.key === 'price' && (c.type === 'amount' || c.type === 'number'); });
                const qtyCol = cols.find(function (c) { return c.key === 'quantity' && (c.type === 'number' || c.type === 'amount'); });
                if (priceCol && qtyCol) {
                    // 物资明细：预估金额 = Σ(单价 × 数量)
                    tbl.querySelectorAll('.dyn-struct-row').forEach(function (row) {
                        const p = parseFloat(row.querySelector('.dyn-struct-input[data-c="price"]').value) || 0;
                        const q = parseFloat(row.querySelector('.dyn-struct-input[data-c="quantity"]').value) || 0;
                        totalSum += p * q;
                    });
                    return;
                }
                const numericCols = cols.filter(function (c) { return c.type === 'amount' || c.type === 'number'; });
                if (!numericCols.length) return;
                numericCols.forEach(function (ac) {
                    tbl.querySelectorAll('.dyn-struct-input[data-c="' + ac.key + '"]').forEach(function (input) {
                        totalSum += parseFloat(input.value) || 0;
                    });
                });
            });
            // 若 schema 存在顶层「金额/合计」数字字段，自动写入合计值
            const amountField = schema.find(function (f) {
                return (f.key === 'amount' || f.key === 'total' || f.key === 'total_amount')
                    && (f.type === 'amount' || f.type === 'number');
            });
            if (amountField) {
                const el = document.querySelector('input[data-k="' + amountField.key + '"]');
                if (el) el.value = totalSum > 0 ? totalSum.toFixed(2) : '';
            }
        }
        this._debouncedChainRefresh();
    }

    _addDynStructRow(key) {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + key + '"]');
        if (!tbl) return;
        if (tbl.getAttribute('data-readonly') === '1') return;  // 只读明细不可添加
        this._dynStructCols = this._dynStructCols || {};
        this._appendDynStructRow(tbl, {}, this._dynStructCols[key] || [], false);
        this._onDynStructChange();
    }

    _removeDynStructRow(btn) {
        const row = btn.closest('.dyn-struct-row');
        if (row) row.remove();
        this._onDynStructChange();
    }

    // ===== 关联需求单（物资领用单） =====
    async _onDynReqLinkSearch(e, key) {
        const kw = (e.target.value || '').trim();
        const res = document.getElementById('dynReqLinkRes_' + key);
        if (!res) return;
        if (!kw) { res.style.display = 'none'; return; }
        try {
            const r = await fetch(OA_API_URL + '/material/requirement-search/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()});
            if (!r.ok) return;
            const d = await r.json();
            const list = d.results || [];
            const self = this;
            res.innerHTML = list.length ? list.map(function (it) {
                if (it.linkable) {
                    return '<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onclick="approvalApp._selectDynReqLink(' + it.id + ', \'' + self._escape(key) + '\')">'
                        + '<div style="font-size:13px;font-weight:600;color:#16a085;">' + self._escape(it.doc_no) + ' <span style="font-size:10px;color:#16a085;background:#e8f8f0;border-radius:4px;padding:0 4px;">可领用</span></div>'
                        + '<div style="font-size:11px;color:#909399;">' + self._escape([it.branch_dept, '物品 ' + it.item_count + ' 项', '剩余可领 ' + it.remaining].filter(Boolean).join(' · ')) + '</div>'
                        + '</div>';
                }
                return '<div style="padding:8px 12px;opacity:0.55;border-bottom:1px solid #f0f0f0;cursor:not-allowed;" title="需求单' + self._escape(it.status_label) + '，入库后方可领用">'
                    + '<div style="font-size:13px;font-weight:600;color:#606266;">' + self._escape(it.doc_no) + ' <span style="font-size:10px;color:#e6a23c;background:#fdf6ec;border-radius:4px;padding:0 4px;">' + self._escape(it.status_label) + '</span></div>'
                    + '<div style="font-size:11px;color:#909399;">' + self._escape([it.branch_dept, '物品 ' + it.item_count + ' 项'].filter(Boolean).join(' · ')) + '（未入库，暂不可领用）</div>'
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到需求单，请先发起物资需求单</div>';
            res.style.display = 'block';
        } catch (err) {}
    }

    async _selectDynReqLink(id, key) {
        this._dynReqLinkValues = this._dynReqLinkValues || {};
        try {
            const r = await fetch(OA_API_URL + '/material/requirement-detail/?id=' + id, {headers: TokenManager.getHeaders()});
            if (!r.ok) { this.showToast('加载需求单失败', true); return; }
            const raw = await r.json();
            const detail = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            if (!detail) { this.showToast('加载需求单失败', true); return; }
            this._dynReqLinkValues[key] = {requirement_id: detail.id, doc_no: detail.doc_no, branch_dept: detail.branch_dept, purpose: detail.purpose, amount: detail.amount};
            const search = document.querySelector('.dyn-reqlink input');
            if (search) search.value = '';
            const res = document.getElementById('dynReqLinkRes_' + key);
            if (res) res.style.display = 'none';
            this._renderDynReqLinkTag(key);
            // 产品金额 = 关联需求单的预估金额（自动填充；只读字段已禁用）
            const amtInput = document.querySelector('input[data-k="amount"]');
            if (amtInput) {
                amtInput.value = (detail.amount != null && detail.amount !== '') ? detail.amount : '';
            }
            const f = (this._currentSchema || []).find(function (s) { return s.key === key; });
            if (f && f.target) this._fillDynStructFromRequirement(f.target, detail.items || []);
        } catch (e) { this.showToast((e && e.message) || '加载需求单失败', true); }
    }

    _clearDynReqLink(key) {
        this._dynReqLinkValues = this._dynReqLinkValues || {};
        this._dynReqLinkValues[key] = null;
        this._renderDynReqLinkTag(key);
        // 清空产品金额
        const amtInput = document.querySelector('input[data-k="amount"]');
        if (amtInput) amtInput.value = '';
        const f = (this._currentSchema || []).find(function (s) { return s.key === key; });
        if (f && f.target) {
            const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + f.target + '"]');
            if (tbl) { const rowsEl = tbl.querySelector('.dyn-struct-rows'); if (rowsEl) rowsEl.innerHTML = ''; }
        }
    }

    _renderDynReqLinkTag(key) {
        const tag = document.getElementById('dynReqLinkTag_' + key);
        if (!tag) return;
        const v = this._dynReqLinkValues && this._dynReqLinkValues[key];
        if (!v) { tag.innerHTML = '<span style="font-size:12px;color:#c0c4cc;">未选择需求单（选择后将自动带出领用明细）</span>'; return; }
        tag.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:#e8f8f0;border-radius:14px;font-size:12px;color:#16a085;margin-top:6px;">'
            + '<i class="fas fa-box-open" style="font-size:11px;"></i>'
            + '<span style="font-weight:600;">' + this._escape(v.doc_no || '') + '</span>'
            + (v.branch_dept ? '<span style="font-size:11px;color:#7fc8b0;">' + this._escape(v.branch_dept) + '</span>' : '')
            + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._clearDynReqLink(\'' + this._escape(key) + '\')" title="取消关联"></i>'
            + '</span>';
    }

    // 🔧 重新编辑/草稿回填时：按已关联的需求单自动带出领用明细（回填剩余可领量）与产品金额
    async _autoFillRequisitionDetail(key, target, requirementId) {
        if (!requirementId || !target) return;
        try {
            const r = await fetch(OA_API_URL + '/material/requirement-detail/?id=' + requirementId, {headers: TokenManager.getHeaders()});
            if (!r.ok) { this.showToast('加载需求单失败', true); return; }
            const raw = await r.json();
            const detail = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            if (!detail) { this.showToast('加载需求单失败', true); return; }
            this._fillDynStructFromRequirement(target, detail.items || []);
            // 产品金额 = 关联需求单的预估金额（自动填充）
            const amtInput = document.querySelector('input[data-k="amount"]');
            if (amtInput && detail.amount != null && detail.amount !== '') amtInput.value = detail.amount;
        } catch (e) {
            this.showToast((e && e.message) || '加载需求单失败', true);
        }
    }

    // 从需求单自动带出明细到目标 struct_table（回填数量为剩余可领量；只读字段按只读渲染）
    _fillDynStructFromRequirement(target, items) {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + target + '"]');
        if (!tbl) return;
        const rowsEl = tbl.querySelector('.dyn-struct-rows');
        if (!rowsEl) return;
        const cols = this._dynStructCols[target] || [];
        const readonly = this._dynStructReadonly && this._dynStructReadonly[target];
        rowsEl.innerHTML = '';
        (items || []).forEach(function (it) {
            approvalApp._appendDynStructRow(tbl, {
                item_name: it.item_name, spec: it.spec, unit: it.unit,
                price: it.price,
                quantity: it.remaining != null ? it.remaining : it.quantity,
                remark: it.remark || ''
            }, cols, readonly);
        });
        this._onDynStructChange();
    }

    _collectDynamicFormData() {
        const data = {};
        const container = document.getElementById('dynamicFormFields');
        if (!container) return data;
        container.querySelectorAll('[data-k]').forEach(el => {
            if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
            const k = el.getAttribute('data-k');
            if (!k) return;
            if (el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'date' || el.type === 'datetime-local')) {
                data[k] = el.value !== '' ? el.value : null;
            } else {
                data[k] = el.value;
            }
        });
        container.querySelectorAll('input[type="radio"]').forEach(el => {
            if (el.checked) data[el.name.replace(/^dyn_/, '')] = el.value;
        });
        container.querySelectorAll('input[type="checkbox"]').forEach(el => {
            const key = el.name.replace(/^dyn_/, '');
            if (el.checked) {
                if (!data[key]) data[key] = [];
                data[key].push(el.value);
            }
        });
        Object.keys(this._dynAttachmentValues || {}).forEach(k => {
            if (this._dynAttachmentValues[k] && this._dynAttachmentValues[k].length) data[k] = this._dynAttachmentValues[k];
        });
        Object.keys(this._dynUserValues || {}).forEach(k => {
            if (this._dynUserValues[k] && this._dynUserValues[k].length) data[k] = this._dynUserValues[k].map(u => ({
                id: u.id,
                name: u.name
            }));
        });
        // 结构化明细：收集每个明细表的行（至少填写一列才保留）
        container.querySelectorAll('.dyn-struct-table').forEach(function (tbl) {
            const key = tbl.getAttribute('data-struct-key');
            if (!key) return;
            const rows = [];
            tbl.querySelectorAll('.dyn-struct-row').forEach(function (rowEl) {
                const obj = {};
                rowEl.querySelectorAll('.dyn-struct-input').forEach(function (input) {
                    obj[input.getAttribute('data-c')] = input.value.trim();
                });
                const hasVal = Object.keys(obj).some(function (k) { return obj[k] !== ''; });
                if (hasVal) rows.push(obj);
            });
            if (rows.length) data[key] = rows;
        });
        // 关联需求单
        Object.keys(this._dynReqLinkValues || {}).forEach(k => {
            if (this._dynReqLinkValues[k]) data[k] = this._dynReqLinkValues[k];
        });
        return data;
    }

    _onDynAttachmentChange(e, key) {
        const files = e.target.files;
        if (!files || !files.length) return;
        const self = this;
        Array.from(files).forEach(file => {
            const fd = new FormData();
            fd.append('file', file);
            // multipart 上传不能手动设置 Content-Type（浏览器自动带 boundary），只传 Authorization
            fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: fd
            }).then(r => r.json()).then(d => {
                if (d.url) {
                    if (!self._dynAttachmentValues[key]) self._dynAttachmentValues[key] = [];
                    self._dynAttachmentValues[key].push({url: d.url, name: d.name || file.name});
                    self._renderDynAttachList(key);
                } else {
                    self.showError('附件上传失败');
                }
            }).catch(() => self.showError('附件上传失败'));
        });
        e.target.value = '';
    }

    _renderDynAttachList(key) {
        const container = document.getElementById('dynAttach_' + key);
        if (!container) return;
        const items = this._dynAttachmentValues[key] || [];
        const self = this;
        container.innerHTML = items.map((a, i) => {
            const name = a.name || '';
            const url = a.url || '';
            const isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            const isVideo = name.match(/\.(mp4|avi|mov|webm|mkv)$/i);
            // 缩略图/图标：图片可点击预览，文档/文件可点击保存到网盘并打开/下载
            let thumbHtml;
            if (isImg) {
                thumbHtml = '<img src="' + url + '" style="width:48px;height:48px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #dcdfe6;cursor:pointer;" title="' + self._escape(name) + '">';
            } else if (isVideo) {
                thumbHtml = '<video src="' + url + '" controls preload="metadata" style="width:130px;height:72px;border-radius:6px;object-fit:cover;flex-shrink:0;"></video>';
            } else {
                thumbHtml = '<div style="width:40px;height:40px;border-radius:6px;background:var(--bg-secondary,#e8ecf1);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ' + self._getFileIcon(name) + '" style="font-size:16px;color:#409eff;"></i></div>';
            }
            const clickWrap = isVideo
                ? thumbHtml
                : '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + self._escape(name) + '" onclick="approvalApp._handleAttach(this)" title="' + self._escape(name) + '">' + thumbHtml + '</a>';
            const downloadIcon = (!isImg && !isVideo)
                ? '<a href="' + url + '" download="' + self._escape(name) + '" target="_blank" title="下载" style="color:#409eff;"><i class="fas fa-cloud-download-alt"></i></a>'
                : '';
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;margin-bottom:4px;flex-wrap:wrap;">'
                + clickWrap
                + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:50px;">' + self._escape(name) + '</span>'
                + downloadIcon
                + '<button onclick="approvalApp._removeDynAttachment(\'' + self._escape(key) + '\',' + i + ')" style="width:24px;height:24px;border:none;background:transparent;cursor:pointer;color:#909399;" title="移除"><i class="fas fa-times"></i></button>'
                + '</div>';
        }).join('') || '';
    }

    _removeDynAttachment(key, idx) {
        if (!this._dynAttachmentValues[key]) return;
        this._dynAttachmentValues[key].splice(idx, 1);
        this._renderDynAttachList(key);
    }

    _loadDynDeptOptions(key, selectedId, scope) {
        const sel = document.getElementById('dynDept_' + key);
        if (!sel) return;
        // scope=all：自定义类型「部门」字段，展示当前用户所属所有企业下的所有部门
        this.apiGet(OA_API_URL + '/approval/org_departments/?scope=all').then(data => {
            let depts = data.results || [];
            // scope=company（分公司）：仅展示公司型部门
            if (scope === 'company') {
                depts = depts.filter(function (d) { return d.department_type === 'company'; });
            }
            sel.innerHTML = this._buildDepartmentTreeHtml(depts, selectedId);
        }).catch(() => {
        });
    }

    _onDynUserSearch(e, key) {
        const kw = e.target.value.trim();
        const res = document.getElementById('dynUserRes_' + key);
        if (!res) return;
        if (!kw) {
            res.style.display = 'none';
            return;
        }
        this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(kw)).then(data => {
            const users = data.results || [];
            const selectedIds = {};
            (this._dynUserValues[key] || []).forEach(u => selectedIds[u.id] = true);
            res.innerHTML = users.length ? users.map(u => {
                const cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addDynUser(\'' + this._escape(key) + '\',' + u.id + ',\'' + this._escape(u.name) + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + this._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + this._escape(u.position) + '</span>' : '')
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            res.style.display = 'block';
        }).catch(() => {
        });
    }

    _addDynUser(key, id, name) {
        if (!this._dynUserValues[key]) this._dynUserValues[key] = [];
        if (this._dynUserValues[key].some(u => u.id === id)) return;
        this._dynUserValues[key].push({id: id, name: name});
        this._renderDynUserTags(key);
        const res = document.getElementById('dynUserRes_' + key);
        if (res) res.style.display = 'none';
    }

    _removeDynUser(key, idx) {
        if (!this._dynUserValues[key]) return;
        this._dynUserValues[key].splice(idx, 1);
        this._renderDynUserTags(key);
    }

    _renderDynUserTags(key) {
        const container = document.getElementById('dynUserTags_' + key);
        if (!container) return;
        const items = this._dynUserValues[key] || [];
        container.innerHTML = items.map((u, i) => {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user" style="font-size:10px;color:#409eff;"></i>'
                + '<span>' + this._escape(u.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="approvalApp._removeDynUser(\'' + this._escape(key) + '\',' + i + ')"></i>'
                + '</span>';
        }).join('') || '';
    }

    _renderDynamicDetail(form_data, schema, display) {
        if (!schema || !schema.length) return '';
        display = display || {};
        const self = this;
        let html = '<div class="detail-item full-width" style="border:1px solid #e8d5f5;border-radius:8px;padding:12px;background:#faf7ff;margin-top:8px;">'
            + '<div style="font-size:14px;font-weight:600;color:#9b59b6;margin-bottom:8px;border-bottom:1px solid #e8d5f5;padding-bottom:6px;"><i class="fas fa-clipboard-list"></i> 表单详情</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">';
        schema.forEach(f => {
            const key = f.key;
            // 后端已解析好的可读值（如部门名称）优先
            if (display[key] !== undefined && display[key] !== null && display[key] !== '') {
                html += '<div><strong>' + self._escape(f.label || key) + '：</strong>' + self._escape(String(display[key])) + '</div>';
                return;
            }
            let v = (form_data || {})[key];
            if (v === undefined || v === null || v === '') v = '-';
            if (f.type === 'attachment' && Array.isArray(v)) {
                // 与内置附件一致：图片预览、视频播放、文档/文件点击保存到网盘并打开或下载
                v = v.map(function (a) {
                    var url = a.url || a;
                    var name = a.name || url.split('/').pop() || '';
                    var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    var isVideo = name.match(/\.(mp4|avi|mov|webm|mkv)$/i);
                    var icon = self._getFileIcon(name);
                    var inner;
                    if (isImg) {
                        inner = '<img src="' + url + '" style="width:48px;height:48px;border-radius:4px;object-fit:cover;border:1px solid #dcdfe6;cursor:pointer;" title="' + self._escape(name) + '">';
                    } else if (isVideo) {
                        inner = '<video src="' + url + '" controls preload="metadata" style="width:140px;height:80px;border-radius:4px;"></video>';
                    } else {
                        inner = '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#f0f9eb;border-radius:4px;font-size:12px;color:#409eff;"><i class="fas ' + icon + '"></i>' + self._escape(name) + '</span>';
                    }
                    var clickWrap = isVideo ? inner
                        : '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + self._escape(name) + '" onclick="approvalApp._handleAttach(this)" title="' + self._escape(name) + '">' + inner + '</a>';
                    var downloadIcon = (!isImg && !isVideo)
                        ? '<a href="' + url + '" download="' + self._escape(name) + '" target="_blank" title="下载" style="color:#409eff;margin-left:2px;"><i class="fas fa-cloud-download-alt"></i></a>'
                        : '';
                    return '<span style="display:inline-flex;align-items:center;gap:4px;margin:2px;vertical-align:middle;">' + clickWrap + downloadIcon + '</span>';
                }).join('') || '-';
            } else if (f.type === 'user' && Array.isArray(v)) {
                v = v.map(u => self._escape(u.name || u)).join('、') || '-';
            } else if ((f.type === 'select' || f.type === 'radio') && typeof v === 'string') {
                const opt = (f.options || []).find(o => String((typeof o === 'object' ? o.value : o)) === String(v));
                if (opt) v = typeof opt === 'object' ? (opt.label || opt.value) : opt;
            } else if (f.type === 'checkbox' && Array.isArray(v)) {
                v = v.map(x => {
                    const o = (f.options || []).find(oo => String((typeof oo === 'object' ? oo.value : oo)) === String(x));
                    return o ? (typeof o === 'object' ? (o.label || o.value) : o) : x;
                }).join('、') || '-';
            } else if (f.type === 'amount' && f.unit) {
                // 金额：带币种符号（¥/$/€/£/HK$…）
                const sym = self._unitSymbol(f.unit);
                v = (sym ? sym : '') + v;
            } else if (f.type === 'number' && f.unit) {
                // 数字：带单位后缀（个/天/小时/件/套…）
                const lb = self._unitLabel(f.unit);
                v = v + (lb ? ' ' + lb : '');
            } else if (f.type === 'expense_type' && typeof v === 'string') {
                // 费用类型：key → 中文名（后端 form_data_display 已解析时走上方 display 分支）
                const expMap = {travel: '差旅费', office: '办公费', meals: '业务招待费', transport: '交通费', communication: '通讯费', equipment: '设备采购', training: '培训费', welfare: '员工福利费', professional_service: '专业服务费', advertising: '广告宣传费', other_expense: '其他'};
                v = expMap[v] || v;
            } else if (f.type === 'struct_table' && Array.isArray(v)) {
                // 结构化明细：渲染为表格
                const cols = f.columns || [];
                if (cols.length) {
                    let tbl = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">'
                        + '<tr>' + cols.map(function (c) { return '<th style="border:1px solid #dcdfe6;padding:4px 6px;background:#f5f7fa;">' + self._escape(c.label || c.key) + '</th>'; }).join('') + '</tr>';
                    v.forEach(function (row) {
                        if (typeof row !== 'object') return;
                        tbl += '<tr>' + cols.map(function (c) {
                            let cv = row[c.key];
                            if (c.type === 'amount' && cv !== undefined && cv !== null && cv !== '') cv = Number(cv).toFixed(2);
                            if (cv === undefined || cv === null) cv = '-';
                            return '<td style="border:1px solid #dcdfe6;padding:4px 6px;">' + self._escape(String(cv)) + '</td>';
                        }).join('') + '</tr>';
                    });
                    tbl += '</table>';
                    v = tbl;
                } else {
                    v = JSON.stringify(v);
                }
            } else if (f.type === 'link_requisition' && typeof v === 'object' && v) {
                v = self._escape(v.doc_no || ('关联需求单 #' + (v.requirement_id || '')));
                if (v.branch_dept) v += '（' + self._escape(v.branch_dept) + '）';
            } else if (f.type === 'link_requisition') {
                v = String(v || '-');
            } else if (f.type === 'payment_method' && typeof v === 'object' && v && v.type) {
                // 收款方式（兜底：form_data 中仍含该字段时展示）
                var _pm = v;
                var _parts = [_pm.type === 'custom' ? '自定义收款方式' : '默认收款账号'];
                if (_pm.payee_name) _parts.push('收款人：' + _pm.payee_name);
                if (_pm.bank_card) _parts.push('银行卡：' + _pm.bank_card + (_pm.bank_name ? '（' + _pm.bank_name + '）' : '') + (_pm.bank_address ? ' ' + _pm.bank_address : ''));
                if (_pm.alipay_account) _parts.push('支付宝：' + _pm.alipay_account);
                if (_pm.wechat_account) _parts.push('微信：' + _pm.wechat_account);
                v = _parts.map(function (p) { return self._escape(p); }).join('；');
            } else if (typeof v === 'object') {
                v = JSON.stringify(v);
            }
            html += '<div><strong>' + self._escape(f.label || key) + '：</strong>' + v + '</div>';
        });
        html += '</div></div>';
        return html;
    }

    // ===== 审批类型管理（企业自定义类型 + 表单 schema 编辑器） =====
    async openTypeManageModal() {
        document.getElementById('approvalTypeManageModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('approvalTypeManageModal').classList.add('show');
        }, 10);
        this._typeManageEditingType = null;
        // 未选中类型时右侧不渲染内容，仅显示引导占位
        this._renderTypeManageForm(null);
        this._initSplitter('tmSplitter', 'tmManageLayout', 'tmSidebar');
        await this._loadTypeManageList();
    }

    // 左右拖动分隔条（动态调整左右占比，桌面端；可复用于配置/类型管理模态框）
    _initSplitter(splitterId, layoutId, sidebarId) {
        if (!this._splittersInit) this._splittersInit = {};
        if (this._splittersInit[splitterId]) return;
        this._splittersInit[splitterId] = true;
        const splitter = document.getElementById(splitterId);
        const layout = document.getElementById(layoutId);
        const sidebar = document.getElementById(sidebarId);
        if (!splitter || !layout || !sidebar) return;
        let dragging = false;
        splitter.addEventListener('mousedown', function (e) {
            e.preventDefault();
            dragging = true;
            splitter.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            const rect = layout.getBoundingClientRect();
            if (!rect.width) return;
            let pct = ((e.clientX - rect.left) / rect.width) * 100;
            pct = Math.max(18, Math.min(pct, 62));
            sidebar.style.flex = '0 0 ' + pct + '%';
            sidebar.style.width = pct + '%';
        });
        document.addEventListener('mouseup', function () {
            if (dragging) {
                dragging = false;
                splitter.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    async _loadTypeManageList() {
        const list = document.getElementById('typeManageList');
        if (!list) return;
        try {
            // scope=manage：包含未启用类型，保证未启用的自定义类型也能编辑/重新启用
            const data = await this.apiGet(OA_API_URL + '/approval/types/?scope=manage');
            this._manageTypes = Array.isArray(data) ? data : (data.results || []);
            const types = this._manageTypes;
            const cur = this._typeManageEditingType;
            // 内置 + 自定义类型均展示，支持启用/禁用开关；内置类型其它字段锁定
            list.innerHTML = types.map(function (t) {
                var active = (cur && cur.id === t.id) ? ' active' : '';
                var tag = t.is_builtin
                    ? '<span style="font-size:11px;color:#909399;background:#f0f2f5;border-radius:4px;padding:1px 6px;flex-shrink:0;">内置</span>'
                    : '<span class="tm-fields">' + (t.form_schema || []).length + ' 字段</span>';
                return '<div class="config-list-item' + active + '" data-id="' + t.id + '" onclick="approvalApp._editTypeManage(' + t.id + ')">'
                    + '<i class="fas ' + (t.icon || 'fa-file-lines') + '" style="color:' + t.color + ';width:16px;text-align:center;"></i>'
                    + '<span style="flex:1;">' + this._escape(t.name) + '</span>'
                    + tag
                    + '<label class="oa-switch" onclick="event.stopPropagation()" title="打开后该类型在新建审批和顶部筛选中显示"><input type="checkbox"' + (t.enabled ? ' checked' : '') + ' onchange="approvalApp._toggleTypeEnabled(' + t.id + ', this.checked)"><span class="oa-switch-slider"></span></label>'
                    + '</div>';
            }, this).join('') || '<div style="padding:12px;color:#909399;font-size:13px;">暂无审批类型</div>';
        } catch (e) {
            console.error('加载类型列表失败:', e);
        }
    }

    _editTypeManage(id) {
        // 用类型管理列表（含未启用）查找，保证未启用的自定义类型也可编辑/启用
        const t = (this._manageTypes || []).find(function (x) {
            return x.id === id;
        });
        if (t) this._renderTypeManageForm(t);
        // 更新左侧列表选中高亮
        document.querySelectorAll('#typeManageList .config-list-item').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.getAttribute('data-id')) === id);
        });
    }

    _newType() {
        this._renderTypeManageForm({
            name: '',
            code: '',
            icon: 'fa-file-lines',
            color: '#409EFF',
            description: '',
            enabled: true,
            form_schema: [],
            is_builtin: false,
            id: null
        });
    }

    _fieldTypeOptions(sel) {
        const types = [
            ['text', '单行文本'], ['textarea', '多行文本'], ['number', '数字'],
            ['date', '日期'], ['datetime', '日期时间'], ['amount', '金额'],
            ['select', '下拉选择'], ['radio', '单选'], ['checkbox', '多选'],
            ['attachment', '附件'], ['department', '部门选择'], ['user', '成员选择'],
            ['expense_type', '费用类型选择'], ['struct_table', '结构化数据明细'],
            ['payment_method', '收款方式'], ['link_requisition', '关联需求单']
        ];
        return types.map(function (t) {
            return '<option value="' + t[0] + '"' + (sel === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('');
    }

    // schema 编辑器：options 输入框占位提示随字段类型变化
    _schemaOptionsPlaceholder(type) {
        if (type === 'struct_table') return '列定义：key:名称:类型|key2:名称2（如 name:项目名称:amount|remark:备注，类型 text/number/amount/item）';
        if (type === 'link_requisition') return '关联明细字段key（如 items，选择需求单后自动带出到该明细）';
        if (['select', 'radio', 'checkbox'].indexOf(type) !== -1) return '选项（逗号分隔，下拉/单选/多选用）';
        return '选项（下拉/单选/多选 或 结构化明细 使用）';
    }

    _renderTypeManageForm(type) {
        const wrap = document.getElementById('typeManageFormWrap');
        if (!wrap) return;
        if (!type) {
            wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-light,#909399);">'
                + '<i class="fas fa-chevron-left" style="font-size:24px;display:block;margin-bottom:12px;"></i>'
                + '<p>请从左侧选择类型编辑，或新建一个类型</p></div>';
            return;
        }
        this._typeManageEditingType = type;
        // 内置类型：名称/编码/图标/颜色/说明/表单字段全部锁定，仅启用开关可操作
        const locked = type.is_builtin ? ' disabled' : '';
        const schema = type.form_schema || [];
        let fieldRows = schema.map(function (f, i) {
            const ftype = f.type || 'text';
            // options 输入框：struct_table 回填列定义（key:名称:类型|...），其余回填 options
            let optsVal = '';
            if (ftype === 'struct_table') {
                optsVal = (f.columns || []).map(function (c) {
                    return (c.key || '') + ':' + (c.label || c.key || '') + ':' + (c.type || 'text');
                }).join('|');
            } else {
                optsVal = Array.isArray(f.options) ? f.options.map(function (o) {
                    return typeof o === 'object' ? o.value : o;
                }).join(',') : (f.options || '');
            }
            const optsPlaceholder = this._schemaOptionsPlaceholder(ftype);
            return '<div class="tm-field-row" style="border:1px solid #dcdfe6;border-radius:8px;padding:8px;margin-bottom:8px;background:#fafbfc;">'
                + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
                + '<input type="text" class="form-input" data-f="label" placeholder="字段名称" value="' + this._escape(f.label || '') + '" style="flex:1;min-width:70px;">'
                + '<input type="text" class="form-input" data-f="key" placeholder="字段key" value="' + this._escape(f.key || '') + '" style="width:90px;">'
                + '<select class="form-select" data-f="type" style="width:128px;" onchange="approvalApp._onSchemaFieldTypeChange(this)">' + this._fieldTypeOptions(ftype) + '</select>'
                + '<label style="font-size:12px;"><input type="checkbox" data-f="required"' + (f.required ? ' checked' : '') + '> 必填</label>'
                + '<button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removeSchemaField(this)"><i class="fas fa-times"></i></button>'
                + '</div>'
                + '<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
                + '<input type="text" class="form-input" data-f="placeholder" placeholder="占位提示" value="' + this._escape(f.placeholder || '') + '" style="flex:1;min-width:70px;">'
                + '<input type="text" class="form-input" data-f="options" placeholder="' + this._escape(optsPlaceholder) + '" value="' + this._escape(optsVal) + '" style="flex:2;min-width:80px;">'
                + '<select class="form-select" data-f="unit" style="width:110px;" title="金额/数字字段可设置单位">' + this._schemaUnitOptions(ftype, f.unit || (ftype === 'amount' ? 'cny' : '')) + '</select>'
                + '</div></div>';
        }, this).join('');
        wrap.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
            + '<div><label style="font-size:12px;">类型名称</label><input type="text" id="tmName" class="form-input" value="' + this._escape(type.name || '') + '"' + locked + '></div>'
            + '<div><label style="font-size:12px;">类型编码（英文，唯一）</label><input type="text" id="tmCode" class="form-input" value="' + this._escape(type.code || '') + '"' + locked + '></div>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">'
            + '<div><label style="font-size:12px;">图标</label>'
            + '<div style="display:flex;gap:6px;align-items:center;">'
            + '<span id="tmIconPreview" style="width:34px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#f0f2f5;border-radius:8px;color:#409EFF;font-size:15px;"><i class="fas ' + this._escape(type.icon || 'fa-file-lines') + '"></i></span>'
            + '<input type="text" id="tmIcon" class="form-input" value="' + this._escape(type.icon || 'fa-file-lines') + '"' + locked + ' style="flex:1;min-width:0;">'
            + '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._openIconPicker()"' + locked + '><i class="fas fa-th-large"></i> 选择</button>'
            + '</div></div>'
            + '<div><label style="font-size:12px;">颜色</label><input type="color" id="tmColor" value="' + this._escape(type.color || '#409EFF') + '"' + locked + ' style="height:34px;width:100%;border:none;"></div>'
            + '<div style="display:flex;align-items:flex-end;padding-bottom:6px;gap:6px;">'
            + '<label style="font-size:12px;white-space:nowrap;">启用开关</label>'
            + '<label class="oa-switch" title="打开后该类型在新建审批和顶部筛选中显示"><input type="checkbox" id="tmEnabled"' + (type.enabled !== false ? ' checked' : '') + ' onchange="approvalApp._updateTypeEnabledLabel()"><span class="oa-switch-slider"></span></label>'
            + '<span id="tmEnabledLabel" style="font-size:12px;white-space:nowrap;color:' + (type.enabled !== false ? '#67c23a' : '#909399') + ';">' + (type.enabled !== false ? '启用' : '禁用') + '</span>'
            + '</div>'
            + '</div>'
            + '<div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;">说明</label><input type="text" id="tmDesc" class="form-input" value="' + this._escape(type.description || '') + '"' + locked + '></div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 6px;">'
            + '<label style="font-size:13px;font-weight:600;"><i class="fas fa-clipboard-list"></i> 表单字段</label>'
            + '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._addSchemaField()"' + locked + '><i class="fas fa-plus"></i> 添加字段</button></div>'
            + '<div id="tmSchemaFields">' + fieldRows + '</div>'
            + '<div style="display:flex;justify-content:space-between;margin-top:12px;">'
            + (type.is_builtin ? '' : '<button type="button" class="btn btn-danger" onclick="approvalApp._deleteType()"><i class="fas fa-trash"></i> 删除类型</button>')
            + '<div style="display:flex;gap:8px;' + (type.is_builtin ? 'margin-left:auto;' : '') + '">'
            + '<button type="button" class="btn btn-secondary" onclick="approvalApp._renderTypeManageForm(null)">取消</button>'
            + '<button type="button" class="btn btn-primary" onclick="approvalApp._saveType()"><i class="fas fa-save"></i> 保存类型</button>'
            + '</div></div>';
    }

    _addSchemaField() {
        const container = document.getElementById('tmSchemaFields');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'tm-field-row';
        row.style.cssText = 'border:1px solid #dcdfe6;border-radius:8px;padding:8px;margin-bottom:8px;background:#fafbfc;';
        row.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
            + '<input type="text" class="form-input" data-f="label" placeholder="字段名称" style="flex:1;min-width:70px;">'
            + '<input type="text" class="form-input" data-f="key" placeholder="字段key" style="width:90px;">'
            + '<select class="form-select" data-f="type" style="width:128px;" onchange="approvalApp._onSchemaFieldTypeChange(this)">' + this._fieldTypeOptions('text') + '</select>'
            + '<label style="font-size:12px;"><input type="checkbox" data-f="required"> 必填</label>'
            + '<button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removeSchemaField(this)"><i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
            + '<input type="text" class="form-input" data-f="placeholder" placeholder="占位提示" style="flex:1;min-width:70px;">'
            + '<input type="text" class="form-input" data-f="options" placeholder="' + this._escape(this._schemaOptionsPlaceholder('text')) + '" style="flex:2;min-width:80px;">'
            + '<select class="form-select" data-f="unit" style="width:110px;" title="金额/数字字段可设置单位">' + this._schemaUnitOptions('text', '') + '</select>'
            + '</div>';
        container.appendChild(row);
    }

    _removeSchemaField(el) {
        const row = el.closest ? el.closest('.tm-field-row') : null;
        if (row) row.remove();
    }

    _collectTypeSchema() {
        const rows = document.querySelectorAll('#tmSchemaFields .tm-field-row');
        const schema = [];
        rows.forEach(function (row, i) {
            const label = row.querySelector('[data-f="label"]').value.trim();
            const key = row.querySelector('[data-f="key"]').value.trim();
            const type = row.querySelector('[data-f="type"]').value;
            const required = row.querySelector('[data-f="required"]').checked;
            const placeholder = row.querySelector('[data-f="placeholder"]').value.trim();
            const optsRaw = row.querySelector('[data-f="options"]').value;
            const unit = row.querySelector('[data-f="unit"]').value;
            if (!label && !key) return;
            const field = {label: label || key, key: key || ('field_' + (i + 1)), type: type, required: !!required};
            if (placeholder) field.placeholder = placeholder;
            if (unit && (type === 'amount' || type === 'number')) field.unit = unit;
            else if (type === 'amount') field.unit = 'cny'; // 金额未选时默认人民币元
            if (type === 'struct_table' && optsRaw.trim()) {
                // 列定义：key:名称:类型|key2:名称2（类型 text/number/amount/item，缺省 text）
                field.columns = optsRaw.split('|').map(function (s) {
                    const parts = s.split(':');
                    const ck = (parts[0] || '').trim();
                    const cl = (parts[1] || ck || '').trim();
                    const ct = (parts[2] || '').trim();
                    return {
                        key: ck,
                        label: cl,
                        type: (ct === 'number' || ct === 'amount' || ct === 'item') ? ct : 'text'
                    };
                }).filter(function (c) { return c.key; });
            } else if (type === 'link_requisition' && optsRaw.trim()) {
                field.target = optsRaw.trim();
            } else if (['select', 'radio', 'checkbox'].indexOf(type) !== -1 && optsRaw.trim()) {
                field.options = optsRaw.split(/[,，]/).map(function (s) {
                    return s.trim();
                }).filter(Boolean);
            }
            schema.push(field);
        });
        return schema;
    }

    async _saveType() {
        const t = this._typeManageEditingType;
        if (!t) return;
        // 内置类型：仅可切换启用/禁用，其它字段锁定
        if (t.is_builtin) {
            try {
                const r = await fetch(OA_API_URL + '/approval/types/' + t.id + '/', {
                    method: 'PATCH',
                    headers: TokenManager.getHeaders(),
                    body: JSON.stringify({enabled: document.getElementById('tmEnabled').checked})
                });
                const rd = await r.json().catch(function () { return {}; });
                if (!r.ok) throw new Error(rd.error || '保存失败');
                this.showToast('内置类型启用状态已更新', false);
                await this._loadTypeManageList();
                await this._loadApprovalTypes();
            } catch (e) {
                this.showAlert('保存失败', e.message || '请重试');
            }
            return;
        }
        const schema = this._collectTypeSchema();
        // 校验字段 key 不重复（避免保存后提交/回显错乱）
        const keyMap = {};
        for (let i = 0; i < schema.length; i++) {
            const k = schema[i].key;
            if (keyMap[k]) {
                this.showAlert('提示', '字段编码(key)「' + k + '」存在重复，请修改后再保存');
                return;
            }
            keyMap[k] = true;
        }
        // 校验下拉/单选/多选必须配置选项（避免后端 400）
        const typeNameMap = {select: '下拉', radio: '单选', checkbox: '多选'};
        for (let i = 0; i < schema.length; i++) {
            const f = schema[i];
            if (typeNameMap[f.type] && (!f.options || !f.options.length)) {
                this.showAlert('提示', '字段「' + f.label + '」为' + typeNameMap[f.type] + '类型，必须填写选项');
                return;
            }
        }
        const data = {
            name: document.getElementById('tmName').value.trim(),
            icon: document.getElementById('tmIcon').value.trim() || 'fa-file-lines',
            color: document.getElementById('tmColor').value || '#409EFF',
            description: document.getElementById('tmDesc').value.trim(),
            enabled: document.getElementById('tmEnabled').checked,
            form_schema: schema
        };
        if (!t.is_builtin) data.code = document.getElementById('tmCode').value.trim();
        if (!data.name) {
            this.showAlert('提示', '请输入类型名称');
            return;
        }
        if (!t.is_builtin && !data.code) {
            this.showAlert('提示', '请输入类型编码');
            return;
        }
        try {
            const url = t.id ? (OA_API_URL + '/approval/types/' + t.id + '/') : (OA_API_URL + '/approval/types/');
            const method = t.id ? 'PUT' : 'POST';
            const r = await fetch(url, {
                method: method,
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            const rd = await r.json().catch(function () {
                return {};
            });
            if (!r.ok) throw new Error(rd.error || '保存失败');
            this.showToast('类型保存成功', false);
            // this._typeManageEditingType = null;
            await this._loadTypeManageList();
            await this._loadApprovalTypes();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    }

    // 类型列表快捷启用/禁用开关：保存 enabled 并同步刷新新建审批与顶部筛选
    async _toggleTypeEnabled(id, checked) {
        try {
            const r = await fetch(OA_API_URL + '/approval/types/' + id + '/', {
                method: 'PATCH',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({enabled: !!checked})
            });
            const rd = await r.json().catch(function () { return {}; });
            if (!r.ok) throw new Error(rd.error || '操作失败');
            this.showToast(checked ? '该审批类型已启用' : '该审批类型已禁用', false);
            await this._loadTypeManageList();
            await this._loadApprovalTypes();
        } catch (e) {
            this.showToast('切换失败：' + (e.message || '请重试'), true);
            await this._loadTypeManageList();
        }
    }

    // 类型表单启用开关标签实时联动
    _updateTypeEnabledLabel() {
        const cb = document.getElementById('tmEnabled');
        const lb = document.getElementById('tmEnabledLabel');
        if (cb && lb) {
            lb.textContent = cb.checked ? '启用' : '禁用';
            lb.style.color = cb.checked ? '#67c23a' : '#909399';
        }
    }

    async _deleteType() {
        const t = this._typeManageEditingType;
        if (!t || !t.id || t.is_builtin) return;
        if (!window.confirm('确定删除该审批类型？删除后历史数据仍保留，但不可再发起该类型审批')) return;
        try {
            const r = await fetch(OA_API_URL + '/approval/types/' + t.id + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!r.ok) {
                const rd = await r.json().catch(function () {
                    return {};
                });
                throw new Error(rd.error || '删除失败');
            }
            this.showToast('类型已删除', false);
            this._typeManageEditingType = null;
            await this._loadTypeManageList();
            await this._loadApprovalTypes();
        } catch (e) {
            this.showAlert('删除失败', e.message);
        }
    }

    // 全屏/退出全屏
    _toggleMaximize(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        const content = modal.querySelector('.modal-content');
        if (content) {
            const max = content.classList.toggle('maximized');
            const icon = modal.querySelector('#tmMaximizeBtn i');
            if (icon) icon.className = max ? 'fas fa-compress' : 'fas fa-expand';
        }
    }

    // 图标选择弹窗
    _openIconPicker() {
        const grid = document.getElementById('tmIconGrid');
        const modal = document.getElementById('tmIconPickerModal');
        if (!grid || !modal) return;
        const current = document.getElementById('tmIcon') ? document.getElementById('tmIcon').value : '';
        const self = this;
        grid.innerHTML = (this._ICON_LIST || []).map(function (c) {
            const active = c === current ? ' background:#ecf5ff;border-color:#409eff;color:#409eff;' : '';
            return '<div class="tm-icon-opt" data-icon="' + c + '" onclick="approvalApp._pickIcon(\'' + c + '\')" style="height:48px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #eee;border-radius:6px;cursor:pointer;font-size:18px;color:#409EFF;' + active + '" title="' + c + '"><i class="fas ' + c + '"></i></div>';
        }).join('');
        modal.style.display = 'flex';
        setTimeout(function () {
            modal.classList.add('show');
        }, 10);
    }

    _closeIconPicker() {
        const modal = document.getElementById('tmIconPickerModal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.style.display = 'none';
    }

    _pickIcon(cls) {
        const input = document.getElementById('tmIcon');
        const preview = document.getElementById('tmIconPreview');
        if (input) input.value = cls;
        if (preview) preview.innerHTML = '<i class="fas ' + cls + '"></i>';
        this._closeIconPicker();
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
        const resp = await fetch(url, {headers: TokenManager.getHeaders()});
        if (!resp.ok) {
            if (resp.status === 401) {
                this.handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(this._extractApiError(err));
        }
        ;
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    _extractApiError(err) {
        if (!err || typeof err !== 'object') return '请求失败';
        var msg = err.error || err.message || err.detail;
        if (Array.isArray(msg)) msg = msg.join('；');
        else if (msg && typeof msg === 'object') msg = Object.values(msg)[0];
        if (Array.isArray(msg)) msg = msg.join('；');
        return msg || '请求失败';
    }

    async apiPost(url, data) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify(data || {})
        });
        if (!resp.ok) {
            if (resp.status === 401) {
                this.handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(this._extractApiError(err));
        }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    // ==================== 列表相关 ====================

    async loadList(page) {
        if (page === undefined) page = this.currentPage;
        this.currentPage = page;
        const container = document.getElementById('approvalList');
        const pagination = document.getElementById('approvalPagination');
        if (!container) return;
        try {
            let url = OA_API_URL + '/approval/?page=' + page + '&page_size=' + this.pageSize;
            if (this.searchKeyword) url += '&search=' + encodeURIComponent(this.searchKeyword);
            if (this.statusFilter) url += '&status=' + this.statusFilter;
            if (this.typeFilter) url += '&type=' + this.typeFilter;
            if (this.scopeFilter) url += '&scope=' + this.scopeFilter;
            const data = await this.apiGet(url);
            this._renderList(data, container);
            this._renderPagination(data, pagination);
        } catch (e) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>加载失败</p></div>';
            pagination.style.display = 'none';
        }
    }

    _renderList(data, container) {
        const rows = data.results || [];
        // 🔧 记录当前页审批ID列表（用于详情上一条/下一条切换）
        this._listApprovalIds = rows.map(function (r) { return r.id; });
        if (!rows.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>暂无审批记录</p></div>';
            return;
        }
        const statusMap = {
            'draft': '草稿',
            'pending': '待审批',
            'approved': '已通过',
            'rejected': '已驳回',
            'deferred': '暂缓',
            'processing': '办理中',
            'cancelled': '已撤回'
        };
        const scMap = {
            'draft': 'badge-default',
            'pending': 'badge-info',
            'approved': 'status-badge normal',
            'rejected': 'status-badge late',
            'deferred': 'status-badge deferred',
            'processing': 'status-badge processing',
            'cancelled': 'badge-default'
        };
        const tMap = {
            'leave': '请假',
            'overtime': '加班',
            'expense': '报销',
            'trip': '出差',
            'purchase': '采购',
            'recruit': '招聘需求',
            'other': '其他'
        };
        const defAv = '/static/images/default-avatar.png';
        const self = this;
        container.innerHTML = rows.map(function (r) {
            const avatar = r.applicant_avatar || defAv;
            const amt = r.amount ? ' &nbsp;|&nbsp; ¥' + parseFloat(r.amount).toFixed(2) : '';
            return '<div class="approval-item" onclick="approvalApp.showDetail(' + r.id + ')">'
                + '<div class="approval-item-left"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
                + '<img src="' + avatar + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">'
                + '<div><div class="approval-item-title">' + self._escape(r.title) + '</div>'
                + '<div class="approval-item-meta">'
                + '<span><i class="fas fa-user"></i> ' + self._escape(r.applicant_name || '') + '</span>'
                + '<span><i class="fas fa-tag"></i> <span class="type-icon-badge type-' + r.approval_type + '" style="color:' + (r.approval_type_color || self._getTypeColor(r.approval_type)) + ';"><i class="fas ' + (r.approval_type_icon || self._getTypeIcon(r.approval_type)) + '"></i> ' + self._escape(r.approval_type_display || r.approval_type) + '</span></span>'
                + '<span title="更新时间"><i class="fas fa-clock"></i> ' + self._formatTime(r.updated_at) + '</span>'
                + (r.department_name ? '<span><i class="fas fa-building"></i> ' + self._escape(r.department_name) + '</span>' : '')
                + (amt || '') + '</div></div></div></div>'
                + '<div class="approval-item-right"><span class="' + (scMap[r.status] || '') + '">' + (statusMap[r.status] || r.status) + '</span></div></div>';
        }).join('');
    }

    _renderPagination(data, container) {
        this._listTotalPages = data.total_pages || 1; // 🔧 记录总页数（详情上一条/下一条提示用）
        if (!data.total_pages || data.total_pages <= 1) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        const p = data.page, t = data.total_pages;
        let html = '<div class="oa-pagination-bar">'
            + '<span class="oa-pagination-total">共 ' + data.count + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<div class="oa-pagination-page-size"><span>每页</span><select onchange="approvalApp.onPageSizeChange(event)">'
            + '<option value="10" ' + (this.pageSize === 10 ? 'selected' : '') + '>10</option>'
            + '<option value="20" ' + (this.pageSize === 20 ? 'selected' : '') + '>20</option>'
            + '<option value="50" ' + (this.pageSize === 50 ? 'selected' : '') + '>50</option>'
            + '</select><span>条</span></div>'
            + '<div class="oa-pagination-btns">';
        html += '<button class="pagination-btn" onclick="approvalApp.loadList(1)" ' + (p <= 1 ? 'disabled' : '') + ' title="首页"><i class="fas fa-angle-double-left"></i></button>';
        html += '<button class="pagination-btn" onclick="approvalApp.loadList(' + (p - 1) + ')" ' + (p <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        for (let i = Math.max(1, p - 2); i <= Math.min(t, p + 2); i++) {
            html += '<button class="pagination-btn ' + (i === p ? 'active' : '') + '" onclick="approvalApp.loadList(' + i + ')">' + i + '</button>';
        }
        html += '<button class="pagination-btn" onclick="approvalApp.loadList(' + (p + 1) + ')" ' + (p >= t ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
        html += '<button class="pagination-btn" onclick="approvalApp.loadList(' + t + ')" ' + (p >= t ? 'disabled' : '') + ' title="末页"><i class="fas fa-angle-double-right"></i></button>';
        html += '</div>'
            + '<div class="oa-pagination-goto"><span>跳至</span><input type="text" id="approvalGotoInput" value="' + p + '" onkeydown="if(event.key===\'Enter\')approvalApp.goToPage(' + t + ')"><span>页</span></div>'
            + '</div>';
        container.innerHTML = html;
    }

    filterByStatus(btn, status) {
        document.querySelectorAll('.filter-btn:not(.filter-scope-btn)').forEach(function (b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');
        this.statusFilter = status;
        this.loadList(1);
    }

    // 我发起的 / 抄送我的 过滤（互斥，再次点击取消）
    filterByScope(btn, scope) {
        document.querySelectorAll('.filter-scope-btn').forEach(function (b) {
            b.classList.remove('active');
        });
        var activate = this.scopeFilter !== scope;
        this.scopeFilter = activate ? scope : '';
        if (activate) btn.classList.add('active');
        this.loadList(1);
    }

    filterByType() {
        this.typeFilter = document.getElementById('approvalTypeFilter').value;
        this.loadList(1);
    }

    search() {
        this.searchKeyword = (document.getElementById('approvalSearch').value || '').trim();
        this.loadList(1);
    }

    onPageSizeChange(e) {
        this.pageSize = parseInt(e.target.value);
        this.loadList(1);
    }

    goToPage(t) {
        var input = document.getElementById('approvalGotoInput');
        if (!input) return;
        var p = parseInt(input.value);
        if (isNaN(p) || p < 1) p = 1;
        if (p > t) p = t;
        this.loadList(p);
    }

    selectType(type) {
        // 更新隐藏字段
        document.getElementById('newApprovalType').value = type;
        // 更新选中状态
        document.querySelectorAll('.type-card').forEach(function (c) {
            c.classList.toggle('selected', c.dataset.type === type);
        });
        this.onTypeChange();
        this._onDeptOrTypeChange();
    }

    // 费用类型选择：原生 select 转为自定义下拉。
    // 已选（收起态）仅显示类型名称；展开下拉项显示「名称 + 小字浅色提示」。
    _buildExpenseSelect(selectEl) {
        if (!selectEl || selectEl._expWrap) return;
        const self = this;
        const wrap = document.createElement('div');
        wrap.className = 'exp-select-wrap';
        const val = selectEl.value || '';
        const info = this._getExpenseTypeInfo(val);
        wrap.innerHTML = '<div class="exp-select" tabindex="0" role="listbox">'
            + '<span class="exp-select-value">' + this._escape(info ? info.name : '请选择') + '</span>'
            + '<i class="fas fa-chevron-down exp-select-arrow"></i></div>'
            + '<div class="exp-select-drop" style="display:none;">'
            + '<div class="exp-select-option" data-val=""><span class="exp-opt-name">请选择</span></div>'
            + this._getExpenseTypeList().map(function (o) {
                return '<div class="exp-select-option" data-val="' + o[0] + '">'
                    + '<span class="exp-opt-name">' + o[1] + '</span>'
                    + (o[2] ? '<span class="exp-opt-hint">（' + o[2] + '）</span>' : '')
                    + '</div>';
            }).join('')
            + '</div>';
        selectEl.style.display = 'none';
        selectEl.parentNode.insertBefore(wrap, selectEl);
        const valueEl = wrap.querySelector('.exp-select-value');
        const drop = wrap.querySelector('.exp-select-drop');
        const sync = function () {
            const cur = self._getExpenseTypeInfo(selectEl.value || '');
            valueEl.textContent = cur ? cur.name : '请选择';
            drop.querySelectorAll('.exp-select-option').forEach(function (opt) {
                opt.classList.toggle('active', opt.getAttribute('data-val') === (selectEl.value || ''));
            });
        };
        selectEl._expWrap = wrap;
        wrap._syncExp = sync;
        if (!this._expSelectDocBound) {
            this._expSelectDocBound = true;
            document.addEventListener('click', function () {
                document.querySelectorAll('.exp-select-drop').forEach(function (d) {
                    d.style.display = 'none';
                });
            });
        }
        wrap.querySelector('.exp-select').addEventListener('click', function (e) {
            e.stopPropagation();
            const isOpen = drop.style.display === 'block';
            document.querySelectorAll('.exp-select-drop').forEach(function (d) {
                d.style.display = 'none';
            });
            if (!isOpen) {
                sync();
                drop.style.display = 'block';
            }
        });
        drop.querySelectorAll('.exp-select-option').forEach(function (opt) {
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                selectEl.value = opt.getAttribute('data-val');
                sync();
                drop.style.display = 'none';
                selectEl.dispatchEvent(new Event('change', {bubbles: true}));
            });
        });
    }

    // 同步内置费用类型下拉的收起态显示（表单重置/回填后调用）
    _syncExpenseTypeDisplay() {
        const sel = document.getElementById('newExpenseType');
        if (sel && sel._expWrap && sel._expWrap._syncExp) sel._expWrap._syncExp();
    }

    onTypeChange() {
        const type = document.getElementById('newApprovalType').value;
        // 收款方式：报销/采购/自定义类型显示
        this._togglePaymentSection(type);
        // 自定义类型 / 带表单的内置类型（物资需求单等）：隐藏内置专属表单，按 schema 渲染动态表单
        if (!this._isBuiltinType(type) || this._isDynamicSchemaType(type)) {
            this._hideBuiltinFields();
            const t = this._getType(type);
            this._renderDynamicFields(t ? (t.form_schema || []) : [], this._editFormData || {});
            return;
        }
        const dynC = document.getElementById('dynamicFormFields');
        if (dynC) {
            dynC.style.display = 'none';
            dynC.innerHTML = '';
        }
        this._editFormData = {};
        const isExpense = type === 'expense';
        const isRecruit = type === 'recruit';
        const isOvertime = type === 'overtime';
        const hasDateFields = ['leave', 'overtime', 'trip'].includes(type);
        // 日期行：请假/加班/出差显示
        const dateRow = document.getElementById('dateRow');
        if (dateRow) dateRow.style.display = hasDateFields ? 'grid' : 'none';

        // 单位标签和输入类型动态化
        var startInput = document.getElementById('newStartDate');
        var endInput = document.getElementById('newEndDate');
        var durInput = document.getElementById('newDuration');
        var durUnit = document.getElementById('durationUnit');
        var startLabel = document.getElementById('startDateLabel');
        var endLabel = document.getElementById('endDateLabel');
        var durLabel = document.getElementById('durationLabel');

        if (isOvertime) {
            // 加班：日期时间 → 自动计算小时数
            if (startInput) {
                startInput.type = 'datetime-local';
                startInput.onchange = function () {
                    approvalApp.calcDays();
                };
                startInput.oninput = function () {
                    approvalApp.calcDays();
                };
            }
            if (endInput) {
                endInput.type = 'datetime-local';
                endInput.onchange = function () {
                    approvalApp.calcDays();
                };
                endInput.oninput = function () {
                    approvalApp.calcDays();
                };
            }
            if (startLabel) startLabel.innerHTML = '<i class="fas fa-play-circle" style="color:#e6a23c;margin-right:4px;"></i> 加班开始';
            if (endLabel) endLabel.innerHTML = '<i class="fas fa-stop-circle" style="color:#e6a23c;margin-right:4px;"></i> 加班结束';
            if (durLabel) durLabel.innerHTML = '<i class="fas fa-clock" style="color:#e6a23c;margin-right:4px;"></i> 时数';
            if (durUnit) durUnit.textContent = '小时';
            if (durInput) {
                durInput.readOnly = true;
                durInput.placeholder = '0';
            }
        } else if (hasDateFields) {
            // 请假/出差：日期 → 自动计算天数
            if (startInput) {
                startInput.type = 'date';
                startInput.onchange = function () {
                    approvalApp.calcDays();
                };
            }
            if (endInput) {
                endInput.type = 'date';
                endInput.onchange = function () {
                    approvalApp.calcDays();
                };
            }
            if (startLabel) startLabel.innerHTML = '<i class="fas fa-calendar-alt" style="color:var(--primary-color,#409eff);margin-right:4px;"></i> 开始日期';
            if (endLabel) endLabel.innerHTML = '<i class="fas fa-calendar-check" style="color:#67c23a;margin-right:4px;"></i> 结束日期';
            if (durLabel) durLabel.innerHTML = '<i class="fas fa-clock" style="color:#e6a23c;margin-right:4px;"></i> 天数';
            if (durUnit) durUnit.textContent = '天';
            if (durInput) {
                durInput.readOnly = true;
                durInput.placeholder = '0';
            }
        }

        // 金额单位
        var amountUnit = document.querySelector('#amountGroup label');
        if (amountUnit) {
            if (type === 'purchase') amountUnit.innerHTML = '<i class="fas fa-money-bill-wave" style="color:#e6a23c;margin-right:4px;"></i> 金额（¥）';
            else if (isExpense) amountUnit.innerHTML = '<i class="fas fa-file-invoice-dollar" style="color:#67c23a;margin-right:4px;"></i> 金额（¥）';
        }

        // 费用行：报销显示
        document.getElementById('expenseRow').style.display = isExpense ? 'grid' : 'none';
        document.getElementById('expenseTypeGroup').style.display = isExpense ? '' : 'none';
        document.getElementById('expenseDateGroup').style.display = isExpense ? '' : 'none';
        // 同步费用类型自定义下拉的收起态显示
        this._syncExpenseTypeDisplay();
        // 金额行：报销/采购显示
        var amountGroup = document.getElementById('amountGroup');
        if (amountGroup) amountGroup.style.display = (isExpense || type === 'purchase') ? '' : 'none';
        // 招聘需求表单
        var rForm = document.getElementById('recruitForm');
        if (rForm) rForm.style.display = isRecruit ? 'block' : 'none';
        // 请假类型
        var leaveRow = document.getElementById('leaveTypeRow');
        if (leaveRow) leaveRow.style.display = type === 'leave' ? 'block' : 'none';
        // 出差信息
        var tripRow = document.getElementById('tripInfoRow');
        if (tripRow) tripRow.style.display = type === 'trip' ? 'block' : 'none';
        // 采购物项
        var purchaseRow = document.getElementById('purchaseItemsRow');
        if (purchaseRow) purchaseRow.style.display = type === 'purchase' ? 'block' : 'none';
        // 报销项目
        var expenseItemsRow = document.getElementById('expenseItemsRow');
        if (expenseItemsRow) expenseItemsRow.style.display = type === 'expense' ? 'block' : 'none';
        // Auto-set title if recruit
        if (isRecruit) {
            var titleInput = document.getElementById('newApprovalTitle');
            var posName = document.getElementById('recruitPositionName');
            if (titleInput && posName && posName.value.trim()) {
                titleInput.value = '招聘：' + posName.value.trim();
            }
            this._initRecruitDateSelects();
        }
    }

    _toggleStaffingRemark() {
        var val = document.getElementById('recruitStaffingType').value;
        var row = document.getElementById('recruitStaffingRemarkRow');
        if (row) row.style.display = val === 'supplement' ? 'block' : 'none';
    }

    // ===== 收款方式（报销/采购/自定义类型） =====

    // 显示/隐藏收款方式区块：报销/采购自动显示；自定义类型仅当 schema 配置了「收款方式」字段时显示
    _togglePaymentSection(type) {
        const section = document.getElementById('paymentMethodSection');
        if (!section) return;
        this._paymentMethodFieldKey = null;
        let need = (type === 'expense' || type === 'purchase');
        if (!need && !this._isBuiltinType(type)) {
            const t = this._getType(type);
            const pmField = (t && t.form_schema || []).find(function (f) { return f.type === 'payment_method'; });
            if (pmField) {
                need = true;
                this._paymentMethodFieldKey = pmField.key;
            }
        }
        section.style.display = need ? 'block' : 'none';
        if (!need) return;
        this._loadApprovalPaymentInfo();
        this._onPaymentMethodTypeChange();
    }

    _onPaymentMethodTypeChange() {
        const t = document.querySelector('input[name="paymentMethodType"]:checked');
        const v = t ? t.value : 'none';
        const isCustom = v === 'custom';
        const dWrap = document.getElementById('paymentMethodDefaultWrap');
        const cWrap = document.getElementById('paymentMethodCustomWrap');
        if (dWrap) dWrap.style.display = (v === 'default') ? 'block' : 'none';
        if (cWrap) cWrap.style.display = isCustom ? 'block' : 'none';
        // 切换到自定义时加载已保存的收款方式（记忆功能）
        if (isCustom) this._loadCustomPaymentMethods();
    }

    // 加载用户默认收款账号
    async _loadApprovalPaymentInfo() {
        const infoEl = document.getElementById('paymentMethodDefaultInfo');
        const emptyEl = document.getElementById('paymentMethodDefaultEmpty');
        if (!infoEl) return;
        infoEl.textContent = '加载中...';
        try {
            const d = await this.apiGet('/api/oa/subsidy/payment-info/');
            const parts = [];
            if (d.payee_name) parts.push('收款人：' + d.payee_name);
            if (d.bank_card) parts.push('银行卡：' + d.bank_card);
            if (d.bank_name) parts.push('开户行：' + d.bank_name);
            if (d.bank_address) parts.push('开户行地址：' + d.bank_address);
            if (d.alipay_account) parts.push('支付宝：' + d.alipay_account);
            if (d.wechat_account) parts.push('微信：' + d.wechat_account);
            const has = !!d.payee_name && !!(d.bank_card || d.alipay_account || d.wechat_account);
            if (emptyEl) emptyEl.style.display = has ? 'none' : 'flex';
            infoEl.style.color = has ? '#606266' : '#f56c6c';
            infoEl.textContent = has ? (parts.join('；') || '已设置') : '尚未设置收款账号，请点击下方按钮完善';
        } catch (e) {
            if (emptyEl) emptyEl.style.display = 'flex';
            infoEl.style.color = '#f56c6c';
            infoEl.textContent = '未获取到收款账号';
        }
    }

    openApprovalPaymentModal() {
        const modal = document.getElementById('approvalPaymentModal');
        if (!modal) return;
        const self = this;
        this.apiGet('/api/oa/subsidy/payment-info/').then(function (d) {
            document.getElementById('apPayeeName').value = d.payee_name || '';
            document.getElementById('apBankCard').value = d.bank_card || '';
            document.getElementById('apBankName').value = d.bank_name || '';
            document.getElementById('apBankAddress').value = d.bank_address || '';
            document.getElementById('apAlipayAccount').value = d.alipay_account || '';
            document.getElementById('apWechatAccount').value = d.wechat_account || '';
        }).catch(function () {});
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    _closeApprovalPaymentModal() {
        const modal = document.getElementById('approvalPaymentModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    }

    async _saveApprovalPaymentInfo() {
        const payee = document.getElementById('apPayeeName').value.trim();
        const bank = document.getElementById('apBankCard').value.trim();
        const alipay = document.getElementById('apAlipayAccount').value.trim();
        const wechat = document.getElementById('apWechatAccount').value.trim();
        if (!payee) { this.showAlert('提示', '请填写收款人真实姓名'); return; }
        if (!bank && !alipay && !wechat) { this.showAlert('提示', '请至少填写一种收款方式（银行卡/支付宝/微信）'); return; }
        try {
            await this.apiPost('/api/oa/subsidy/payment-info/', {
                payee_name: payee, bank_card: bank,
                bank_name: document.getElementById('apBankName').value.trim(),
                bank_address: document.getElementById('apBankAddress').value.trim(),
                alipay_account: alipay, wechat_account: wechat
            });
            this._closeApprovalPaymentModal();
            this.showToast('收款账号已保存', false);
            this._loadApprovalPaymentInfo();
        } catch (e) {
            this.showAlert('保存失败', e.message);
        }
    }

    // 收集收款方式提交数据（未选择则返回空对象，不要求必须填写）
    _collectPaymentMethod() {
        const t = document.querySelector('input[name="paymentMethodType"]:checked');
        const type = t ? t.value : 'none';
        if (type === 'custom') {
            return {
                type: 'custom',
                payee_name: document.getElementById('pmCustomPayee').value.trim(),
                bank_card: document.getElementById('pmCustomBank').value.trim(),
                bank_name: document.getElementById('pmCustomBankName').value.trim(),
                bank_address: document.getElementById('pmCustomBankAddress').value.trim(),
                alipay_account: document.getElementById('pmCustomAlipay').value.trim(),
                wechat_account: document.getElementById('pmCustomWechat').value.trim()
            };
        }
        if (type === 'default') {
            return {type: 'default'};
        }
        return {};
    }

    // 加载用户已保存的自定义收款方式（记忆功能），含开户行展示与删除管理
    async _loadCustomPaymentMethods() {
        const sel = document.getElementById('pmCustomSaved');
        if (!sel) return;
        try {
            const data = await this.apiGet(OA_API_URL + '/approval/custom-payment-methods/');
            this._customPmList = data.results || [];
            const list = this._customPmList;
            const current = sel.value;
            sel.innerHTML = '<option value="">— 新建收款方式 —</option>';
            list.forEach(function (m) {
                const label = this._customPmLabel(m);
                const opt = document.createElement('option');
                opt.value = String(m.id);
                opt.setAttribute('data-pm', JSON.stringify(m));
                opt.textContent = label;
                sel.appendChild(opt);
            }, this);
            if (current && Array.prototype.some.call(sel.options, function (o) { return o.value === current; })) {
                sel.value = current;
            } else {
                sel.value = '';
            }
            this._renderCustomPmList();
        } catch (e) {
            console.warn('加载已保存收款方式失败', e);
        }
    }

    // 已保存收款方式的展示文案（收款人 + 开户行 + 银行卡/支付宝/微信）
    _customPmLabel(m) {
        if (!m) return '';
        const parts = [m.payee_name || '收款人'];
        if (m.bank_name) parts.push('开户行：' + m.bank_name);
        if (m.bank_card) parts.push('银行卡：' + m.bank_card);
        if (m.alipay_account) parts.push('支付宝：' + m.alipay_account);
        if (m.wechat_account) parts.push('微信：' + m.wechat_account);
        return parts.join('　');
    }

    // 渲染已保存收款方式的管理列表（每项可删除）
    _renderCustomPmList() {
        const wrap = document.getElementById('pmCustomSavedList');
        if (!wrap) return;
        const list = this._customPmList || [];
        if (!list.length) {
            wrap.innerHTML = '';
            return;
        }
        const self = this;
        wrap.innerHTML = list.map(function (m) {
            return '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#fff;border:1px solid var(--border-color,#dcdfe6);border-radius:6px;font-size:12px;color:#606266;">'
                + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + self._escape(self._customPmLabel(m)) + '">' + self._escape(self._customPmLabel(m)) + '</span>'
                + '<button type="button" title="删除该收款方式" onclick="approvalApp._deleteCustomPaymentMethod(' + m.id + ', this)" style="border:none;background:none;color:#f56c6c;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;"><i class="fas fa-times"></i></button>'
                + '</div>';
        }).join('');
    }

    // 删除一条已保存的自定义收款方式
    async _deleteCustomPaymentMethod(id, btn) {
        const confirmed = await this.showConfirmDialog('删除收款方式', '确定删除这条已保存的收款方式吗？', 'danger');
        if (!confirmed) return;
        try {
            const resp = await fetch(OA_API_URL + '/approval/custom-payment-method/' + id + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.showToast('已删除', false);
            this._loadCustomPaymentMethods();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    }

    // 选择已保存的收款方式时回填表单；选择“新建”则清空
    _onCustomSavedChange() {
        const sel = document.getElementById('pmCustomSaved');
        if (!sel) return;
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) {
            // 新建
            document.getElementById('pmCustomPayee').value = '';
            document.getElementById('pmCustomBank').value = '';
            document.getElementById('pmCustomBankName').value = '';
            document.getElementById('pmCustomBankAddress').value = '';
            document.getElementById('pmCustomAlipay').value = '';
            document.getElementById('pmCustomWechat').value = '';
            return;
        }
        try {
            const pm = JSON.parse(opt.getAttribute('data-pm') || '{}');
            document.getElementById('pmCustomPayee').value = pm.payee_name || '';
            document.getElementById('pmCustomBank').value = pm.bank_card || '';
            document.getElementById('pmCustomBankName').value = pm.bank_name || '';
            document.getElementById('pmCustomBankAddress').value = pm.bank_address || '';
            document.getElementById('pmCustomAlipay').value = pm.alipay_account || '';
            document.getElementById('pmCustomWechat').value = pm.wechat_account || '';
        } catch (e) {
            console.warn('回填收款方式失败', e);
        }
    }

    // 编辑回填：把已有收款方式加载到表单
    _fillPaymentMethod(pm) {
        if (!pm || typeof pm !== 'object') pm = {};
        const radios = document.querySelectorAll('input[name="paymentMethodType"]');
        let pmType = 'none';
        if (pm.type === 'custom') pmType = 'custom';
        else if (pm.type === 'default') pmType = 'default';
        for (let i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === pmType;
        document.getElementById('pmCustomPayee').value = pm.payee_name || '';
        document.getElementById('pmCustomBank').value = pm.bank_card || '';
        document.getElementById('pmCustomBankName').value = pm.bank_name || '';
        document.getElementById('pmCustomBankAddress').value = pm.bank_address || '';
        document.getElementById('pmCustomAlipay').value = pm.alipay_account || '';
        document.getElementById('pmCustomWechat').value = pm.wechat_account || '';
        this._onPaymentMethodTypeChange();
    }

    // ===== 采购物项 =====
    _addPurchaseItem(item) {
        item = item || {};
        var body = document.getElementById('purchaseItemsBody');
        if (!body) return;
        var row = document.createElement('tr');
        row.innerHTML = '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input pi-name" value="' + this._escape(item.name || '') + '" placeholder="商品名称" style="min-width:100px;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input type="number" class="form-input pi-qty" value="' + (item.qty || '') + '" min="0" step="1" oninput="approvalApp._recalcPurchaseTotal()" style="width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input type="number" class="form-input pi-price" value="' + (item.price || '') + '" min="0" step="0.01" oninput="approvalApp._recalcPurchaseTotal()" style="width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><span class="pi-total" style="color:#e6a23c;">0.00</span></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input pi-remark" value="' + this._escape(item.remark || '') + '" placeholder="备注" style="min-width:80px;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);text-align:center;"><button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removePurchaseItem(this)"><i class="fas fa-times"></i></button></td>';
        body.appendChild(row);
        this._recalcPurchaseTotal();
    }
    _removePurchaseItem(btn) {
        var tr = btn.closest('tr');
        if (tr) tr.remove();
        this._recalcPurchaseTotal();
    }
    _collectPurchaseItems() {
        var items = [];
        document.querySelectorAll('#purchaseItemsBody tr').forEach(function (tr) {
            var name = (tr.querySelector('.pi-name') || {}).value || '';
            var qty = parseFloat((tr.querySelector('.pi-qty') || {}).value) || 0;
            var price = parseFloat((tr.querySelector('.pi-price') || {}).value) || 0;
            var remark = (tr.querySelector('.pi-remark') || {}).value || '';
            if (name || qty || price) items.push({name: name, qty: qty, price: price, total: +((qty * price).toFixed(2)), remark: remark});
        });
        return items;
    }
    _recalcPurchaseTotal() {
        var total = 0;
        document.querySelectorAll('#purchaseItemsBody tr').forEach(function (tr) {
            var qty = parseFloat((tr.querySelector('.pi-qty') || {}).value) || 0;
            var price = parseFloat((tr.querySelector('.pi-price') || {}).value) || 0;
            var t = qty * price;
            var totalEl = tr.querySelector('.pi-total');
            if (totalEl) totalEl.textContent = t.toFixed(2);
            total += t;
        });
        var el = document.getElementById('purchaseTotal');
        if (el) el.textContent = total.toFixed(2);
        var amount = document.getElementById('newAmount');
        if (amount) amount.value = total ? total.toFixed(2) : '';
        // 明细变动使总金额变化，需刷新审批链以联动阈值审批
        this._debouncedChainRefresh();
        return total;
    }

    // ===== 报销项目 =====
    _addExpenseItem(item) {
        item = item || {};
        var body = document.getElementById('expenseItemsBody');
        if (!body) return;
        var row = document.createElement('tr');
        row.innerHTML = '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input ei-name" value="' + this._escape(item.name || '') + '" placeholder="项目名称" style="min-width:100px;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input type="number" class="form-input ei-amount" value="' + (item.amount || '') + '" min="0" step="0.01" oninput="approvalApp._recalcExpenseTotal()" style="width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input ei-remark" value="' + this._escape(item.remark || '') + '" placeholder="备注" style="min-width:80px;width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);text-align:center;"><button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removeExpenseItem(this)"><i class="fas fa-times"></i></button></td>';
        body.appendChild(row);
        this._recalcExpenseTotal();
    }
    _removeExpenseItem(btn) {
        var tr = btn.closest('tr');
        if (tr) tr.remove();
        this._recalcExpenseTotal();
    }
    _collectExpenseItems() {
        var items = [];
        document.querySelectorAll('#expenseItemsBody tr').forEach(function (tr) {
            var name = (tr.querySelector('.ei-name') || {}).value || '';
            var amount = parseFloat((tr.querySelector('.ei-amount') || {}).value) || 0;
            var remark = (tr.querySelector('.ei-remark') || {}).value || '';
            if (name || amount) items.push({name: name, amount: amount, remark: remark});
        });
        return items;
    }
    _recalcExpenseTotal() {
        var total = 0;
        document.querySelectorAll('#expenseItemsBody tr').forEach(function (tr) {
            total += parseFloat((tr.querySelector('.ei-amount') || {}).value) || 0;
        });
        var el = document.getElementById('expenseTotal');
        if (el) el.textContent = total.toFixed(2);
        var amount = document.getElementById('newAmount');
        if (amount) amount.value = total ? total.toFixed(2) : '';
        // 明细变动使总金额变化，需刷新审批链以联动阈值审批
        this._debouncedChainRefresh();
        return total;
    }

    // ===== 出差/请假 =====
    _updateTripDuration() {
        var days = document.getElementById('tripDays') ? document.getElementById('tripDays').value : '';
        var dur = document.getElementById('newDuration');
        if (dur && days) dur.value = days;
    }
    _collectLeaveType() {
        var checked = document.querySelector('input[name="leaveType"]:checked');
        return checked ? checked.value : '';
    }
    _collectTripData() {
        return {
            reason: document.getElementById('tripReason') ? document.getElementById('tripReason').value : '',
            place: document.getElementById('tripPlace') ? document.getElementById('tripPlace').value : '',
            days: document.getElementById('tripDays') ? document.getElementById('tripDays').value : '',
            amount: document.getElementById('tripAmount') ? document.getElementById('tripAmount').value : '',
            remark: document.getElementById('tripRemark') ? document.getElementById('tripRemark').value : ''
        };
    }
    _clearTypeRows() {
        var pb = document.getElementById('purchaseItemsBody'); if (pb) pb.innerHTML = '';
        var eb = document.getElementById('expenseItemsBody'); if (eb) eb.innerHTML = '';
        document.querySelectorAll('input[name="leaveType"]').forEach(function (r) { r.checked = false; });
        ['tripReason', 'tripPlace', 'tripDays', 'tripAmount', 'tripRemark'].forEach(function (id) {
            var el = document.getElementById(id); if (el) el.value = '';
        });
    }
    _loadTypeDataIntoForm(d) {
        if (d.purchase_items && d.purchase_items.length) {
            var self = this;
            d.purchase_items.forEach(function (it) { self._addPurchaseItem(it); });
        }
        if (d.expense_items && d.expense_items.length) {
            var self2 = this;
            d.expense_items.forEach(function (it) { self2._addExpenseItem(it); });
        }
        if (d.leave_type) {
            var radio = document.querySelector('input[name="leaveType"][value="' + this._escape(d.leave_type) + '"]');
            if (radio) radio.checked = true;
        }
        if (d.trip_data && typeof d.trip_data === 'object') {
            if (document.getElementById('tripReason')) document.getElementById('tripReason').value = d.trip_data.reason || '';
            if (document.getElementById('tripPlace')) document.getElementById('tripPlace').value = d.trip_data.place || '';
            if (document.getElementById('tripDays')) document.getElementById('tripDays').value = d.trip_data.days || '';
            if (document.getElementById('tripAmount')) document.getElementById('tripAmount').value = d.trip_data.amount || '';
            if (document.getElementById('tripRemark')) document.getElementById('tripRemark').value = d.trip_data.remark || '';
        }
    }

    _typeIcon(type) {
        var m = {
            'leave': 'fa-plane-departure',
            'overtime': 'fa-clock',
            'expense': 'fa-file-invoice-dollar',
            'trip': 'fa-suitcase-rolling',
            'purchase': 'fa-shopping-cart',
            'recruit': 'fa-user-plus',
            'other': 'fa-file'
        };
        return m[type] || 'fa-file';
    }

    _initRecruitDateSelects() {
        var yearSel = document.getElementById('recruitArrivalYear');
        var monthSel = document.getElementById('recruitArrivalMonth');
        var daySel = document.getElementById('recruitArrivalDay');
        if (!yearSel) return;
        if (!yearSel.options.length) {
            var now = new Date();
            var curYear = now.getFullYear();
            for (var y = curYear; y <= curYear + 1; y++) {
                var opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y + '年';
                yearSel.appendChild(opt);
            }
            for (var m = 1; m <= 12; m++) {
                var opt2 = document.createElement('option');
                opt2.value = m;
                opt2.textContent = m + '月';
                monthSel.appendChild(opt2);
            }
            for (var d = 1; d <= 31; d++) {
                var opt3 = document.createElement('option');
                opt3.value = d;
                opt3.textContent = d + '日';
                daySel.appendChild(opt3);
            }
            yearSel.value = curYear;
        }
    }

    _gatherRecruitData() {
        var pos = document.getElementById('recruitPositionName');
        if (!pos || pos.style.display === 'none') return null;
        var rd = {
            position_name: (pos.value || '').trim(),
            headcount: parseInt(document.getElementById('recruitHeadcount').value) || 0,
            staffing_type: document.getElementById('recruitStaffingType').value || 'annual',
            staffing_remark: (document.getElementById('recruitStaffingRemark').value || '').trim(),
            responsibilities: (document.getElementById('recruitResponsibilities').value || '').trim(),
            basic_requirement: (document.getElementById('recruitBasicReq').value || '').trim(),
            experience_requirement: (document.getElementById('recruitExpReq').value || '').trim(),
            skill_requirement: (document.getElementById('recruitSkillReq').value || '').trim(),
            soft_requirement: (document.getElementById('recruitSoftReq').value || '').trim(),
            salary_min: parseFloat(document.getElementById('recruitSalaryMin').value) || 0,
            salary_max: parseFloat(document.getElementById('recruitSalaryMax').value) || 0,
            salary_structure: (document.getElementById('recruitSalaryStructure').value || '').trim(),
            arrival_year: parseInt(document.getElementById('recruitArrivalYear').value) || 0,
            arrival_month: parseInt(document.getElementById('recruitArrivalMonth').value) || 0,
            arrival_day: parseInt(document.getElementById('recruitArrivalDay').value) || 0,
            urgency: document.getElementById('recruitUrgency').value || 'normal',
            special_requirements: (document.getElementById('recruitSpecialReq').value || '').trim(),
            employment_type: document.getElementById('recruitEmploymentType').value || 'fulltime',
        };
        return rd;
    }

    _statusIcon(st) {
        var m = {
            'draft': 'fa-pen',
            'pending': 'fa-hourglass-half',
            'approved': 'fa-check-circle',
            'rejected': 'fa-times-circle',
            'deferred': 'fa-pause-circle',
            'processing': 'fa-spinner',
            'cancelled': 'fa-undo'
        };
        return m[st] || 'fa-circle';
    }

    filterByTypeBtn(el, type) {
        document.querySelectorAll('.type-filter-card').forEach(function (b) {
            b.classList.remove('active');
        });
        el.classList.add('active');
        this.typeFilter = type;
        this.loadList(1);
    }

    calcDays() {
        var type = document.getElementById('newApprovalType').value;
        var startVal = document.getElementById('newStartDate').value;
        var endVal = document.getElementById('newEndDate').value;
        if (startVal && endVal) {
            var start = new Date(startVal);
            var end = new Date(endVal);
            if (end >= start) {
                if (type === 'overtime') {
                    // 加班：计算小时数
                    var diffHours = (end - start) / (1000 * 60 * 60);
                    diffHours = Math.round(diffHours * 100) / 100;
                    document.getElementById('newDuration').value = diffHours > 0 ? diffHours : 0;
                } else {
                    // 请假/出差：计算天数
                    var diff = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
                    document.getElementById('newDuration').value = diff;
                }
            }
        }
        this._loadApprovalChainPreview();
    }

    // ==================== 新建审批 - 审批人配置 ====================

    async openCreateModal() {
        var self = this;
        document.getElementById('createApprovalForm').reset();
        // 内置费用类型下拉：首次构建自定义下拉，重置后同步收起态显示
        this._buildExpenseSelect(document.getElementById('newExpenseType'));
        this._syncExpenseTypeDisplay();
        document.querySelectorAll('.type-card').forEach(function (c) {
            c.classList.remove('selected');
        });
        // 隐藏所有内置类型专属表单（含请假类型/出差/采购物项/报销项目等）
        this._hideBuiltinFields();
        var recruitInputs = document.querySelectorAll('#recruitForm input, #recruitForm textarea, #recruitForm select');
        recruitInputs.forEach(function (el) {
            if (el.type === 'text' || el.tagName === 'TEXTAREA') el.value = '';
            else if (el.type === 'number') el.value = '';
            else if (el.tagName === 'SELECT') el.selectedIndex = 0;
        });
        document.getElementById('recruitStaffingRemarkRow').style.display = 'none';
        this._clearTypeRows();
        document.getElementById('attachmentPreview').innerHTML = '';
        document.getElementById('attachmentPreview').style.display = 'none';
        this._attachmentFiles = [];
        this._approverNodes = [];
        this._isReEdit = false;
        this._reEditId = null;
        this._editFormData = {};
        // 自定义类型/带表单内置类型：重置动态表单为空白
        var _curType = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        if (_curType && (!this._isBuiltinType(_curType) || this._isDynamicSchemaType(_curType))) {
            var _t = this._getType(_curType);
            this._renderDynamicFields(_t ? (_t.form_schema || []) : [], {});
        }
        this._ccUsers = [];
        this._ccDepartments = [];
        this._ccTab = 'users';
        this._ccSearchTimer = null;
        var sdB = document.getElementById('saveDraftBtn');
        if (sdB) sdB.textContent = '存草稿';
        var sab = document.getElementById('submitApprovalBtn');
        if (sab) sab.innerHTML = '<i class="fas fa-paper-plane"></i> 提交审批';

        // 固定为会签 + 顺序审批，不可修改
        this._lockApprovalDefaults();

        // Init CC display
        this._ccUsers = [];
        this._ccDepartments = [];
        this._currentCcType = '';
        this._renderCcTags();

        // Load department tree and chain preview before showing modal
        await this._loadDepartmentTree();
        await this._onDeptOrTypeChange();

        document.getElementById('createApprovalModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('createApprovalModal').classList.add('show');
        }, 10);
        // Init CC search
        setTimeout(function () {
            self._initCcSearch();
        }, 100);
        // Init 关联审批 search
        this._relatedApprovals = [];
        this._renderRelApprovalTags();
        setTimeout(function () {
            self._initRelApprovalSearch();
        }, 100);
    }

    // 明细/动态字段金额变化后防抖刷新审批链（联动阈值审批）
    _debouncedChainRefresh() {
        if (this._chainRefreshTimer) clearTimeout(this._chainRefreshTimer);
        this._chainRefreshTimer = setTimeout(function () {
            approvalApp._loadApprovalChainPreview();
        }, 300);
    }

    // 自定义类型动态数字/金额字段输入时刷新审批链（联动阈值审批）
    _onDynNumericChange() {
        this._debouncedChainRefresh();
    }

    async _loadApprovalChainPreview() {
        var container = document.getElementById('approverNodeList');
        if (!container) return;
        // Request sequencing to prevent stale responses from overwriting newer ones
        var seq = ++this._chainReqSeq;
        var deptId = document.getElementById('newDepartmentSelect') ? document.getElementById('newDepartmentSelect').value : '';
        var apprType = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 12px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;"><i class="fas fa-spinner fa-spin" style="margin-right:4px;"></i> 加载审批链...</div>';
        var url = OA_API_URL + '/approval/approval_chain/';
        var params = [];
        if (deptId) params.push('department_id=' + deptId);
        if (apprType) params.push('approval_type=' + apprType);
        // Pass threshold values from form fields for chain preview
        var dur = document.getElementById('newDuration') ? document.getElementById('newDuration').value : '';
        if (dur) params.push('duration=' + dur);
        var amt = document.getElementById('newAmount') ? document.getElementById('newAmount').value : '';
        if (amt) params.push('amount=' + amt);
        var hc = document.getElementById('recruitHeadcount') ? document.getElementById('recruitHeadcount').value : '';
        if (hc) params.push('headcount=' + hc);
        // 自定义类型 / 带表单内置类型：传递动态表单数字字段值用于阈值预览
        if (!this._isBuiltinType(apprType) || this._isDynamicSchemaType(apprType)) {
            var fd = this._collectDynamicFormData();
            var numeric = {};
            Object.keys(fd).forEach(function (k) {
                var v = fd[k];
                if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(v))) {
                    numeric[k] = Number(v);
                }
            });
            if (Object.keys(numeric).length) {
                params.push('form_data=' + encodeURIComponent(JSON.stringify(numeric)));
            }
        }
        if (params.length) url += '?' + params.join('&');
        try {
            var data = await this.apiGet(url);
            // Ignore stale responses from earlier requests
            if (seq !== this._chainReqSeq) return;
            var chain = data.results || [];
            var departments = data.departments || {};
            // Store approver nodes from chain preview (converts API format to backend format)
            this._approverNodes = chain.map(function (a) {
                return {
                    type: a.type || 'user',
                    id: a.id,
                    label: a.label,
                    user_position: a.user_position || '',
                    is_final_approver: !!a.is_final_approver
                };
            });
            this._approverNodesReady = true;
            var self = this;
            if (chain.length) {
                var html = '<div style="margin-bottom:6px;font-size:12px;color:var(--text-light,#909399);display:flex;align-items:center;gap:4px;">'
                    + '<i class="fas fa-sitemap" style="color:#67c23a;"></i> 自动审批链'
                    + (departments.selected ? ' · ' + self._escape(departments.selected) : '')
                    + (departments.final ? ' → ' + self._escape(departments.final) : '')
                    + '</div>';
                var currentLevel = 0;
                chain.forEach(function (a, i) {
                    var arrow = i < chain.length - 1 ? ' <span style="color:var(--text-light,#c0c4cc);font-size:11px;"><i class="fas fa-arrow-down"></i></span>' : '';
                    var levelLabel = a.level_label || ('第' + (a.level || (i + 1)) + '级');
                    var isFinal = !!a.is_final_approver;
                    var nodeBg = isFinal ? '#f3e8ff' : '#f0f9eb';
                    var nodeBorder = isFinal ? '#9b59b6' : '#67c23a';
                    var nodeIcon = isFinal ? 'fa-user-shield' : 'fa-user-check';
                    var nodeColor = isFinal ? '#9b59b6' : '#67c23a';
                    var srcLabel = isFinal ? (a.final_approver_source_label || '') : '';
                    html += '<div class="approver-node-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:' + nodeBg + ';border-radius:6px;margin-bottom:4px;border-left:3px solid ' + nodeBorder + ';">'
                        + '<i class="fas ' + nodeIcon + '" style="color:' + nodeColor + ';font-size:13px;"></i>'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(a.label) + (a.user_position ? ' <span style="font-size:11px;color:#909399;">(' + self._escape(a.user_position) + ')</span>' : '') + '</span>'
                        + (srcLabel ? '<span style="font-size:10px;color:#9b59b6;background:#fff;border:1px solid #e8d5f5;padding:2px 8px;border-radius:4px;margin-right:4px;" title="最终审批人配置来源">' + self._escape(srcLabel) + '</span>' : '')
                        + '<span style="font-size:11px;color:' + nodeColor + ';background:#fff;padding:2px 8px;border-radius:4px;">' + levelLabel + '</span>'
                        + arrow + '</div>';
                });
                container.innerHTML = html;
            } else {
                // No chain found — let backend auto-determine
                this._approverNodes = [];
                this._approverNodesReady = false;
                if (deptId) {
                    container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 12px;background:#fff3e0;border-radius:6px;border-left:3px solid #e6a23c;">'
                        + '<i class="fas fa-info-circle" style="color:#e6a23c;margin-right:4px;"></i>'
                        + '所选部门暂无负责人，审批将自动分配给企业管理员</div>';
                } else {
                    var msg = '<i class="fas fa-info-circle" style="color:var(--primary-color,#409eff);margin-right:4px;"></i>请选择所属部门以生成审批链';
                    if (departments && departments.final) {
                        msg += '<div style="margin-top:6px;font-size:12px;color:#67c23a;"><i class="fas fa-building" style="margin-right:4px;"></i>最终审批部门：' + self._escape(departments.final) + '</div>';
                    }
                    container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 12px;">' + msg + '</div>';
                }
            }
        } catch (e) {
            if (seq === this._chainReqSeq) {
                this._approverNodes = [];
                this._approverNodesReady = false;
                container.innerHTML = '<div style="color:#f56c6c;font-size:13px;padding:8px 12px;"><i class="fas fa-exclamation-circle"></i> 加载审批链失败</div>';
            }
        }
    }

    async _loadDepartmentTree(selectedId) {
        var sel = document.getElementById('newDepartmentSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">加载中...</option>';
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/org_departments/');
            if (!data || !data.results || !data.results.length) {
                this._noDeptOptions(sel);
                return;
            }
            var depts = data.results;

            var tree = {};
            depts.forEach(function (d) {
                var pid = d.parent_id != null ? d.parent_id : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });

            var html = '<option value="">请选择部门</option>';
            var walk = function (pid, depth) {
                var children = tree[pid] || [];
                children.forEach(function (d) {
                    var prefix = '';
                    for (var i = 0; i < depth; i++) prefix += '—— ';
                    html += '<option value="' + d.id + '">' + prefix + d.name + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            // Fallback: if no roots at 0, find actual roots (parent_id not matching any id)
            if (!tree[0] || !tree[0].length) {
                var allIds = {};
                depts.forEach(function (d) {
                    allIds[d.id] = true;
                });
                var actualRoots = [];
                depts.forEach(function (d) {
                    if (!allIds[d.parent_id]) actualRoots.push(d);
                });
                if (actualRoots.length) {
                    html = '<option value="">请选择部门</option>';
                    var renderFlat = function (items, depth) {
                        var prefix = '';
                        for (var i = 0; i < depth; i++) prefix += '—— ';
                        items.forEach(function (d) {
                            html += '<option value="' + d.id + '">' + prefix + d.name + '</option>';
                            var kids = tree[d.id] || [];
                            renderFlat(kids, depth + 1);
                        });
                    };
                    renderFlat(actualRoots, 0);
                }
            }

            sel.innerHTML = html;
            sel.disabled = false;
            var hint = document.getElementById('newDeptHint');
            if (hint) hint.style.display = 'none';
            if (selectedId) {
                sel.value = selectedId;
                return;
            }
            // 使用后端返回的默认部门（主部门 → 无主部门时最低级部门）
            if (data.default_id != null) {
                for (var i = 0; i < sel.options.length; i++) {
                    if (parseInt(sel.options[i].value) === parseInt(data.default_id)) {
                        sel.value = String(data.default_id);
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Load dept tree failed:', e);
            this._noDeptOptions(sel);
        }
    }

    // 无可用部门时的提示
    _noDeptOptions(sel) {
        if (sel) {
            sel.innerHTML = '<option value="">无可用部门</option>';
            sel.disabled = true;
        }
        var hint = document.getElementById('newDeptHint');
        if (hint) hint.style.display = 'flex';
    }

    async _onDeptOrTypeChange() {
        // 部门或审批类型变化时：刷新审批链
        await this._loadApprovalChainPreview();
        // 审批类型变化时：同步CC配置（部门变化不影响CC）
        var currentType = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        if (currentType !== this._currentCcType) {
            this._currentCcType = currentType;
            await this._loadConfigDefaults();
        }
    }

    // 解析当前用户企业/审批类型匹配到的配置（优先子企业专属，再集团默认）
    async _resolveApprovalConfig(type) {
        if (!type) return null;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var activeTenant = null;
            try {
                activeTenant = JSON.parse(localStorage.getItem('active_tenant'));
            } catch (e) {
            }
            var userTenantId = activeTenant ? activeTenant.id : null;
            var cfg = null;
            var defaultCfg = null;
            configs.forEach(function (c) {
                if (c.approval_type !== type) return;
                if (c.sub_tenant && userTenantId && parseInt(c.sub_tenant) === parseInt(userTenantId)) {
                    cfg = c;
                } else if (!c.sub_tenant) {
                    defaultCfg = c;
                }
            });
            return cfg || defaultCfg;
        } catch (e) {
            console.error('解析审批配置失败:', e);
            return null;
        }
    }

    // 重新编辑时：将当前抄送项中匹配配置默认抄送人/部门的项标记为不可删除
    async _lockConfigCcDefaults() {
        var type = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        if (!type) return;
        var cfg = await this._resolveApprovalConfig(type);
        if (!cfg) return;
        var userIds = (cfg.cc_user_details || []).map(function (u) {
            return u.id;
        });
        var deptIds = (cfg.cc_department_details || []).map(function (d) {
            return d.id;
        });
        (this._ccUsers || []).forEach(function (u) {
            if (userIds.indexOf(u.id) !== -1) u.locked = true;
        });
        (this._ccDepartments || []).forEach(function (d) {
            if (deptIds.indexOf(d.id) !== -1) d.locked = true;
        });
        this._renderCcTags();
    }

    async _loadConfigDefaults() {
        var type = this._currentCcType;
        this._ccUsers = [];
        this._ccDepartments = [];
        if (!type) {
            this._renderCcTags();
            return;
        }
        try {
            var cfg = await this._resolveApprovalConfig(type);
            if (!cfg) {
                this._renderCcTags();
                return;
            }
            // 审批方式/审批模式固定为会签+顺序审批，不受配置影响（不可修改）
            this._lockApprovalDefaults();
            // 配置中的默认抄送人/部门自动带入，且不可删除（locked）
            if (cfg.cc_user_details && cfg.cc_user_details.length) {
                cfg.cc_user_details.forEach(function (u) {
                    if (!this._ccUsers) this._ccUsers = [];
                    if (!this._ccUsers.some(function (x) {
                        return x.id === u.id;
                    })) {
                        this._ccUsers.push({id: u.id, name: u.name, avatar: u.avatar || '', locked: true});
                    }
                }, this);
            }
            if (cfg.cc_department_details && cfg.cc_department_details.length) {
                cfg.cc_department_details.forEach(function (d) {
                    if (!this._ccDepartments) this._ccDepartments = [];
                    if (!this._ccDepartments.some(function (x) {
                        return x.id === d.id;
                    })) {
                        this._ccDepartments.push({id: d.id, name: d.name, locked: true});
                    }
                }, this);
            }
            this._renderCcTags();
        } catch (e) {
            console.error('加载审批配置默认值失败:', e);
        }
    }

    // 审批方式/审批模式固定为 会签 + 顺序审批，不可修改
    _lockApprovalDefaults() {
        var signTypeSel = document.getElementById('newSignType');
        if (signTypeSel) {
            signTypeSel.value = 'countersign';
            signTypeSel.disabled = true;
        }
        var apprModeSel = document.getElementById('newApprovalMode');
        if (apprModeSel) {
            apprModeSel.value = 'sequential';
            apprModeSel.disabled = true;
        }
    }

    // ==================== 抄送人选择（用户+部门） ====================

    _switchCcTab(tab) {
        this._ccTab = tab;
        var ut = document.getElementById('ccTabUsers');
        var dt = document.getElementById('ccTabDepts');
        var activeBg = 'var(--primary-color,#409eff)';
        var inactiveBg = 'var(--bg-secondary,#f5f7fa)';
        if (ut) {
            ut.className = 'cc-tab' + (tab === 'users' ? ' active' : '');
            ut.style.cssText = 'flex:1;text-align:center;padding:5px 0;font-size:12px;cursor:pointer;'
                + 'background:' + (tab === 'users' ? activeBg : inactiveBg) + ';'
                + 'color:' + (tab === 'users' ? '#fff' : 'var(--text-secondary)');
        }
        if (dt) {
            dt.className = 'cc-tab' + (tab === 'departments' ? ' active' : '');
            dt.style.cssText = 'flex:1;text-align:center;padding:5px 0;font-size:12px;cursor:pointer;'
                + 'background:' + (tab === 'departments' ? activeBg : inactiveBg) + ';'
                + 'color:' + (tab === 'departments' ? '#fff' : 'var(--text-secondary)');
        }
        var input = document.getElementById('ccUserSearch');
        if (input) {
            input.value = '';
            input.placeholder = tab === 'users' ? '搜索企业成员...' : '搜索部门...';
        }
        document.getElementById('ccUserDropdown').style.display = 'none';
    }

    _initCcSearch() {
        var self = this;
        var input = document.getElementById('ccUserSearch');
        if (!input) return;
        input.oninput = function () {
            clearTimeout(self._ccSearchTimer);
            var val = input.value.trim();
            if (!val) {
                document.getElementById('ccUserDropdown').style.display = 'none';
                return;
            }
            self._ccSearchTimer = setTimeout(function () {
                if (self._ccTab === 'departments') {
                    self._searchCcDepartments(val);
                } else {
                    self._searchCcUsers(val);
                }
            }, 300);
        };
        input.onfocus = function () {
            if (input.value.trim()) {
                if (self._ccTab === 'departments') {
                    self._searchCcDepartments(input.value.trim());
                } else {
                    self._searchCcUsers(input.value.trim());
                }
            }
        };
        document.addEventListener('click', function (e) {
            var dd = document.getElementById('ccUserDropdown');
            if (dd && !e.target.closest('#ccUserSearch') && !e.target.closest('#ccUserDropdown') && !e.target.closest('.cc-tab')) {
                dd.style.display = 'none';
            }
        });
    }

    // ===== 关联审批选择器 =====
    _initRelApprovalSearch() {
        var self = this;
        var input = document.getElementById('relApprovalSearch');
        if (!input) return;
        input.oninput = function () {
            clearTimeout(self._relSearchTimer);
            var val = input.value.trim();
            if (!val) {
                document.getElementById('relApprovalDropdown').style.display = 'none';
                return;
            }
            self._relSearchTimer = setTimeout(function () {
                self._searchRelApprovals(val);
            }, 300);
        };
        // 聚焦时若未输入，默认加载当前用户的审批列表
        input.onfocus = function () {
            if (!input.value.trim()) {
                self._loadDefaultRelApprovals();
            } else {
                self._searchRelApprovals(input.value.trim());
            }
        };
        document.addEventListener('click', function (e) {
            var dd = document.getElementById('relApprovalDropdown');
            if (dd && !e.target.closest('#relApprovalSearch') && !e.target.closest('#relApprovalDropdown')) {
                dd.style.display = 'none';
            }
        });
    }

    async _loadDefaultRelApprovals() {
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/?page=1&page_size=10');
            this._renderRelApprovalDropdown(data.results || []);
        } catch (e) {
            var dd = document.getElementById('relApprovalDropdown');
            if (dd) dd.style.display = 'none';
        }
    }

    async _searchRelApprovals(keyword) {
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/?search=' + encodeURIComponent(keyword) + '&page_size=20');
            this._renderRelApprovalDropdown(data.results || []);
        } catch (e) {
            var dd = document.getElementById('relApprovalDropdown');
            if (dd) dd.style.display = 'none';
        }
    }

    _renderRelApprovalDropdown(list) {
        var dd = document.getElementById('relApprovalDropdown');
        if (!dd) return;
        if (!list.length) {
            dd.innerHTML = '<div style="padding:8px 12px;color:#909399;font-size:13px;">暂无审批可关联</div>';
            dd.style.display = 'block';
            return;
        }
        var self = this;
        this._relSearchResults = list || [];
        var selectedIds = {};
        (this._relatedApprovals || []).forEach(function (r) { selectedIds[r.id] = true; });
        var statusMap = {draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', deferred: '暂缓', processing: '办理中', cancelled: '已撤回'};
        dd.innerHTML = list.map(function (r) {
            if (selectedIds[r.id]) return '';
            var cls = 'cursor:pointer;';
            // 发起人 / 部门 / 职位
            var info = '';
            if (r.applicant_name) info += '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><i class="fas fa-user" style="color:#16a085;"></i> ' + self._escape(r.applicant_name) + '</span>';
            if (r.department_name) info += '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><i class="fas fa-building" style="color:#e6a23c;"></i> ' + self._escape(r.department_name) + '</span>';
            if (r.applicant_position) info += '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><i class="fas fa-id-badge" style="color:#409eff;"></i> ' + self._escape(r.applicant_position) + '</span>';
            return '<div class="rel-approval-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addRelApproval(' + r.id + ')">'
                + '<i class="fas fa-file-alt" style="color:#16a085;"></i>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(r.title) + '</div>'
                + '<div style="font-size:11px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(r.approval_type_display || r.approval_type) + ' · ' + (statusMap[r.status] || r.status || '') + ' · 更新 ' + self._formatTime(r.updated_at || r.created_at) + '</div>'
                + (info ? '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:#909399;margin-top:2px;">' + info + '</div>' : '')
                + '</div>'
                + '</div>';
        }).join('') || '<div style="padding:8px 12px;color:#909399;font-size:13px;">暂无审批可关联</div>';
        dd.style.display = 'block';
    }

    _addRelApproval(id) {
        if (!this._relatedApprovals) this._relatedApprovals = [];
        if (this._relatedApprovals.some(function (r) { return r.id === id; })) return;
        var src = (this._relSearchResults || []).filter(function (r) { return r.id === id; })[0] || {};
        this._relatedApprovals.push({
            id: id,
            title: src.title || '',
            type: src.approval_type_display || src.approval_type || '',
            status: src.status || '',
            applicant_name: src.applicant_name || '',
            department_name: src.department_name || '',
            applicant_position: src.applicant_position || ''
        });
        this._renderRelApprovalTags();
        document.getElementById('relApprovalDropdown').style.display = 'none';
        document.getElementById('relApprovalSearch').value = '';
    }

    _removeRelApproval(idx) {
        this._relatedApprovals.splice(idx, 1);
        this._renderRelApprovalTags();
    }

    _renderRelApprovalTags() {
        var container = document.getElementById('relApprovalTags');
        if (!container) return;
        if (!this._relatedApprovals || !this._relatedApprovals.length) {
            container.innerHTML = '';
            return;
        }
        var self = this;
        container.innerHTML = this._relatedApprovals.map(function (r, i) {
            var tip = '';
            if (r.applicant_name) tip += '发起人：' + r.applicant_name;
            if (r.department_name) tip += (tip ? ' · ' : '') + '部门：' + r.department_name;
            if (r.applicant_position) tip += (tip ? ' · ' : '') + '职位：' + r.applicant_position;
            return '<span title="' + self._escape(tip || '') + '" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:#e8f6f3;border:1px solid #b2e0d8;border-radius:14px;font-size:12px;margin:2px;max-width:240px;">'
                + '<i class="fas fa-link" style="font-size:10px;color:#16a085;"></i>'
                + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(r.title) + '</span>'
                + (r.applicant_name ? '<span style="color:#606266;font-size:11px;flex-shrink:0;">(' + self._escape(r.applicant_name) + ')</span>' : '')
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;flex-shrink:0;" onclick="approvalApp._removeRelApproval(' + i + ')"></i>'
                + '</span>';
        }).join('');
    }

    async _searchCcUsers(keyword) {
        var dd = document.getElementById('ccUserDropdown');
        if (!dd) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            if (!users.length) {
                dd.innerHTML = '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            } else {
                var self = this;
                var selectedIds = {};
                (this._ccUsers || []).forEach(function (u) {
                    selectedIds[u.id] = true;
                });
                dd.innerHTML = users.map(function (u) {
                    var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                    return '<div class="cc-user-item" data-id="' + u.id + '" data-name="' + self._escape(u.name) + '" data-avatar="' + (u.avatar || '') + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addCcUser(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + (u.avatar || '') + '\')">'
                        + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                        + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                        + '</div>';
                }).join('');
            }
            dd.style.display = 'block';
        } catch (e) {
            console.error('Search CC users failed:', e);
        }
    }

    async _searchCcDepartments(keyword) {
        var dd = document.getElementById('ccUserDropdown');
        if (!dd) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-departments/?search=' + encodeURIComponent(keyword));
            var depts = data.results || [];
            if (!depts.length) {
                dd.innerHTML = '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到部门</div>';
            } else {
                var self = this;
                var selectedIds = {};
                (this._ccDepartments || []).forEach(function (d) {
                    selectedIds[d.id] = true;
                });
                dd.innerHTML = depts.map(function (d) {
                    var cls = selectedIds[d.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                    return '<div class="cc-user-item" data-id="' + d.id + '" data-name="' + self._escape(d.name) + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addCcDept(' + d.id + ',\'' + self._escape(d.name) + '\')">'
                        + '<i class="fas fa-building" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#409eff;font-size:16px;"></i>'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(d.name) + '</span>'
                        + (d.manager_name ? '<span style="font-size:11px;color:#909399;">负责人：' + self._escape(d.manager_name) + '</span>' : '')
                        + '</div>';
                }).join('');
            }
            dd.style.display = 'block';
        } catch (e) {
            console.error('Search CC departments failed:', e);
        }
    }

    _addCcUser(id, name, avatar) {
        if (!this._ccUsers) this._ccUsers = [];
        if (this._ccUsers.some(function (u) {
            return u.id === id;
        })) return;
        this._ccUsers.push({id: id, name: name, avatar: avatar});
        this._renderCcTags();
        document.getElementById('ccUserDropdown').style.display = 'none';
        document.getElementById('ccUserSearch').value = '';
    }

    _addCcDept(id, name) {
        if (!this._ccDepartments) this._ccDepartments = [];
        if (this._ccDepartments.some(function (d) {
            return d.id === id;
        })) return;
        this._ccDepartments.push({id: id, name: name});
        this._renderCcTags();
        document.getElementById('ccUserDropdown').style.display = 'none';
        document.getElementById('ccUserSearch').value = '';
    }

    _removeCcUser(id) {
        if (!this._ccUsers) return;
        var target = null;
        for (var i = 0; i < this._ccUsers.length; i++) {
            if (this._ccUsers[i].id === id) { target = this._ccUsers[i]; break; }
        }
        // 默认抄送人不可删除
        if (target && target.locked) return;
        this._ccUsers = this._ccUsers.filter(function (u) {
            return u.id !== id;
        });
        this._renderCcTags();
    }

    _removeCcDept(id) {
        if (!this._ccDepartments) return;
        var target = null;
        for (var i = 0; i < this._ccDepartments.length; i++) {
            if (this._ccDepartments[i].id === id) { target = this._ccDepartments[i]; break; }
        }
        // 默认抄送部门不可删除
        if (target && target.locked) return;
        this._ccDepartments = this._ccDepartments.filter(function (d) {
            return d.id !== id;
        });
        this._renderCcTags();
    }

    _renderCcTags() {
        var container = document.getElementById('ccUserTags');
        if (!container) return;
        var self = this;
        var html = '';
        // 默认（配置带入）项不可删除：虚线边框 + 锁图标
        var lockedBorder = 'border:1px dashed #c0c4cc;';
        // Department tags
        if (this._ccDepartments && this._ccDepartments.length) {
            html += this._ccDepartments.map(function (d) {
                return '<span class="cc-tag cc-tag-dept" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#e8f4fd;border-radius:14px;font-size:12px;margin:2px;' + (d.locked ? lockedBorder : '') + '">'
                    + '<i class="fas fa-building" style="font-size:11px;color:#409eff;"></i>'
                    + '<span>' + self._escape(d.name) + '</span>'
                    + (d.locked
                        ? '<i class="fas fa-lock" style="font-size:10px;color:#c0c4cc;" title="默认抄送部门，不可删除"></i>'
                        : '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeCcDept(' + d.id + ')"></i>')
                    + '</span>';
            }).join('');
        }
        // User tags
        if (this._ccUsers && this._ccUsers.length) {
            html += this._ccUsers.map(function (u) {
                return '<span class="cc-tag" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f3e8ff;border-radius:14px;font-size:12px;margin:2px;' + (u.locked ? lockedBorder : '') + '">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">'
                    + '<span>' + self._escape(u.name) + '</span>'
                    + (u.locked
                        ? '<i class="fas fa-lock" style="font-size:10px;color:#c0c4cc;" title="默认抄送人，不可删除"></i>'
                        : '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeCcUser(' + u.id + ')"></i>')
                    + '</span>';
            }).join('');
        }
        container.innerHTML = html || '';
    }

    addApproverNode() {
        const sel = document.getElementById('approverUserSelect');
        const val = sel.value;
        if (!val) {
            this.showAlert('提示', '请选择审批人或部门');
            return;
        }
        const opt = sel.options[sel.selectedIndex];
        const type = opt.dataset.type;
        const id = parseInt(opt.dataset.id);
        const label = opt.text;

        // 去重
        for (var i = 0; i < this._approverNodes.length; i++) {
            if (this._approverNodes[i].type === type && this._approverNodes[i].id === id) {
                this.showAlert('提示', '该审批人已在列表中');
                return;
            }
        }

        this._approverNodes.push({type: type, id: id, label: label});
        this._renderApproverNodes();
        sel.value = '';
    }

    removeApproverNode(idx) {
        this._approverNodes.splice(idx, 1);
        this._renderApproverNodes();
    }

    _renderApproverNodes() {
        this._loadApprovalChainPreview();
    }

    // ==================== 附件上传 ====================

    triggerUpload() {
        document.getElementById('fileInput').click();
    }

    handleFileSelect(e) {
        const files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;
        const max = 10;
        const self = this;
        let pending = files.slice();
        let failed = false;

        const uploadNext = function () {
            if (!pending.length) {
                e.target.value = '';
                if (failed) self.showAlert('提示', '部分文件上传失败，请检查格式或大小后重试');
                return;
            }
            if (self._attachmentFiles.length >= max) {
                self.showAlert('提示', '最多上传10个附件，已忽略多余文件');
                pending = [];
                e.target.value = '';
                return;
            }
            const file = pending.shift();
            if (file.size > self.fileMaxSizeMB * 1024 * 1024) {
                failed = true;
                self.showAlert('提示', `「${file.name}」大小不能超过${self.fileMaxSizeMB}MB`);
                uploadNext();
                return;
            }
            const ext = (file.name.substring(file.name.lastIndexOf('.')) || '').toLowerCase();
            const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.mp4', '.avi', '.mov', '.mp3', '.wav'];
            if (!allowed.includes(ext)) {
                failed = true;
                self.showAlert('错误', `「${file.name}」不支持的文件格式`);
                uploadNext();
                return;
            }
            const formData = new FormData();
            formData.append('file', file);
            fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: formData
            }).then(async function (r) {
                var res = await r.json();
                if (!r.ok) throw new Error(res.error || res.detail || '上传失败');
                if (res.url) {
                    self._attachmentFiles.push({url: res.url, name: res.name});
                    self._renderAttachments();
                } else {
                    failed = true;
                    self.showAlert('提示', `「${file.name}」上传失败`);
                }
                uploadNext();
            }).catch(function (err) {
                failed = true;
                self.showAlert('上传失败', `「${file.name}」${err.message}`);
                uploadNext();
            });
        };
        uploadNext();
    }

    _getFileIcon(name) {
        return Utils.getFileIconClass('', name);
    }

    _renderAttachments() {
        const container = document.getElementById('attachmentPreview');
        container.style.display = 'block';
        const self = this;
        var isImage = function (name) {
            return name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        };
        container.innerHTML = this._attachmentFiles.map(function (f, i) {
            var icon = self._getFileIcon(f.name);
            var thumbHtml = '';
            if (isImage(f.name)) {
                thumbHtml = '<img src="' + f.url + '" style="width:40px;height:40px;border-radius:4px;object-fit:cover;flex-shrink:0;">';
            } else {
                thumbHtml = '<div style="width:40px;height:40px;border-radius:4px;background:var(--bg-secondary,#e8ecf1);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ' + icon + '" style="font-size:18px;color:var(--primary-color,#409eff);"></i></div>';
            }
            return '<div class="att-item" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;margin-bottom:4px;">'
                + thumbHtml
                + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(f.name) + '</span>'
                + '<button class="btn btn-secondary" onclick="approvalApp.removeAttachment(' + i + ')" style="width:24px;height:24px;"><i class="fas fa-times" style="font-size:12px;"></i></button></div>';
        }).join('');
    }

    removeAttachment(index) {
        this._attachmentFiles.splice(index, 1);
        this._renderAttachments();
    }

    // ==================== 提交审批 ====================

    async submitApproval() {
        // 防重复提交：提交期间禁用按钮并阻止重复进入，避免同一审批被重复创建
        if (this._submitting) return;
        this._submitting = true;
        const sab = document.getElementById('submitApprovalBtn');
        const sabHtml = sab ? sab.innerHTML : '';
        if (sab) { sab.disabled = true; sab.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...'; }
        try {
            await this._doSubmitApproval();
        } finally {
            this._submitting = false;
            if (sab) { sab.disabled = false; sab.innerHTML = sabHtml; }
        }
    }
    async _doSubmitApproval() {
        const type = document.getElementById('newApprovalType').value;
        const title = document.getElementById('newApprovalTitle').value.trim();
        const content = document.getElementById('newApprovalContent').value.trim();
        const departmentId = document.getElementById('newDepartmentSelect').value;
        const startDate = document.getElementById('newStartDate').value;
        const endDate = document.getElementById('newEndDate').value;
        const duration = document.getElementById('newDuration').value;
        const amount = document.getElementById('newAmount').value;
        const expenseType = document.getElementById('newExpenseType').value;
        const expenseDate = document.getElementById('newExpenseDate').value;
        const signType = document.getElementById('newSignType').value;
        const approvalMode = document.getElementById('newApprovalMode').value;

        if (!type) {
            this.showAlert('提示', '请选择审批类型');
            return;
        }
        if (!title) {
            this.showAlert('提示', '请输入审批标题');
            return;
        }
        if (!departmentId) {
            this.showAlert('提示', '请选择所属部门');
            return;
        }
        // 审批人可为空，后端会自动根据汇报关系确定审批人

        var ccIds = (this._ccUsers || []).map(function (u) {
            return u.id;
        });
        var ccDeptIds = (this._ccDepartments || []).map(function (d) {
            return d.id;
        });
        const data = {
            approval_type: type,
            title: title,
            content: content,
            department_id: parseInt(departmentId),
            sign_type: signType,
            approval_mode: approvalMode,
            approver_nodes: this._approverNodes,
            cc_users: ccIds,
            cc_departments: ccDeptIds,
            related_approvals: (this._relatedApprovals || []).map(function (r) { return r.id; }),
        };
        // 内置类型结构化数据
        if (type === 'purchase') data.purchase_items = this._collectPurchaseItems();
        if (type === 'expense') data.expense_items = this._collectExpenseItems();
        if (type === 'leave') data.leave_type = this._collectLeaveType();
        if (type === 'trip') data.trip_data = this._collectTripData();
        // 收款方式：报销/采购用固定区块
        if (type === 'expense' || type === 'purchase') {
            data.payment_method = this._collectPaymentMethod();
        }
        // Include recruit_data if recruit type
        if (type === 'recruit') {
            var rd = this._gatherRecruitData();
            if (rd) data.recruit_data = rd;
        }
        // 自定义类型 / 带表单内置类型（物资需求单等）：收集动态表单数据（若配置了「收款方式」字段，把收款方式注入该字段）
        if (!this._isBuiltinType(type) || this._isDynamicSchemaType(type)) {
            var fd = this._collectDynamicFormData();
            if (this._paymentMethodFieldKey) fd[this._paymentMethodFieldKey] = this._collectPaymentMethod();
            data.form_data = fd;
        }
        if (startDate) data.start_date = startDate.substring(0, 10);
        if (endDate) data.end_date = endDate.substring(0, 10);
        if (duration) data.duration = parseFloat(duration);
        if (amount) data.amount = parseFloat(amount);
        if (expenseType) data.expense_type = expenseType;
        if (expenseDate) data.expense_date = expenseDate;
        if (this._attachmentFiles.length) data.attachments = this._attachmentFiles.map(function (f) {
            return {url: f.url, name: f.name};
        });

        try {
            if (this._isReEdit && this._reEditId) {
                await this.apiPost(OA_API_URL + '/approval/' + this._reEditId + '/re-edit/', data);
                this._isReEdit = false;
                this._reEditId = null;
            } else {
                await this.apiPost(OA_API_URL + '/approval/', data);
            }
            this.closeModal('createApprovalModal');
            this.showToast('审批提交成功', false);
            this.loadList(1);
        } catch (e) {
            var msg = e.message || '请检查表单后重试';
            // 未设置收款账号：弹出收款方式设置弹窗
            if (msg && msg.indexOf('收款账号') >= 0) this.openApprovalPaymentModal();
            this.showToast('提交失败' + msg, true);
        }
    }

    _gatherFormData() {
        return {
            approval_type: document.getElementById('newApprovalType').value,
            title: document.getElementById('newApprovalTitle').value.trim(),
            content: document.getElementById('newApprovalContent').value.trim(),
            department_id: parseInt(document.getElementById('newDepartmentSelect').value),
            start_date: document.getElementById('newStartDate').value,
            end_date: document.getElementById('newEndDate').value,
            duration: document.getElementById('newDuration').value,
            amount: document.getElementById('newAmount').value,
            expense_type: document.getElementById('newExpenseType').value,
            expense_date: document.getElementById('newExpenseDate').value,
            sign_type: document.getElementById('newSignType').value,
            approval_mode: document.getElementById('newApprovalMode').value,
        };
    }

    async saveDraft() {
        // 防重复提交：保存期间禁用按钮并阻止重复进入，避免同一草稿被重复创建
        if (this._submitting) return;
        this._submitting = true;
        const sdb = document.getElementById('saveDraftBtn');
        const sdbHtml = sdb ? sdb.innerHTML : '';
        if (sdb) { sdb.disabled = true; sdb.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...'; }
        try {
            await this._doSaveDraft();
        } finally {
            this._submitting = false;
            if (sdb) { sdb.disabled = false; sdb.innerHTML = sdbHtml; }
        }
    }
    async _doSaveDraft() {
        var f = this._gatherFormData();
        if (!f.title && !f.approval_type) {
            var confirmed = await this.showConfirmDialog('存草稿', '标题和审批类型为空，确定要保存为草稿吗？', 'confirm');
            if (!confirmed) return;
        }
        var data = {
            approval_type: f.approval_type || 'other',
            title: f.title || '未命名草稿',
            content: f.content,
            department_id: f.department_id || null,
            sign_type: f.sign_type,
            approval_mode: f.approval_mode,
            approver_nodes: this._approverNodes,
            cc_users: (this._ccUsers || []).map(function (u) {
                return u.id;
            }),
            cc_departments: (this._ccDepartments || []).map(function (d) {
                return d.id;
            }),
            related_approvals: (this._relatedApprovals || []).map(function (r) { return r.id; }),
        };
        if (f.approval_type === 'purchase') data.purchase_items = this._collectPurchaseItems();
        if (f.approval_type === 'expense') data.expense_items = this._collectExpenseItems();
        if (f.approval_type === 'leave') data.leave_type = this._collectLeaveType();
        if (f.approval_type === 'trip') data.trip_data = this._collectTripData();
        // 收款方式：报销/采购用固定区块；自定义类型注入到 form_data 的「收款方式」字段
        if (f.approval_type === 'expense' || f.approval_type === 'purchase') {
            data.payment_method = this._collectPaymentMethod();
        }
        if (f.approval_type === 'recruit') {
            var rd = this._gatherRecruitData();
            if (rd) data.recruit_data = rd;
        }
        // 自定义类型 / 带表单内置类型（物资需求单等）：收集动态表单数据（若配置了「收款方式」字段，把收款方式注入该字段）
        if (!this._isBuiltinType(f.approval_type) || this._isDynamicSchemaType(f.approval_type)) {
            var _fd = this._collectDynamicFormData();
            if (this._paymentMethodFieldKey) _fd[this._paymentMethodFieldKey] = this._collectPaymentMethod();
            data.form_data = _fd;
        }
        if (f.start_date) data.start_date = f.start_date.substring(0, 10);
        if (f.end_date) data.end_date = f.end_date.substring(0, 10);
        if (f.duration) data.duration = parseFloat(f.duration);
        if (f.amount) data.amount = parseFloat(f.amount);
        if (f.expense_type) data.expense_type = f.expense_type;
        if (f.expense_date) data.expense_date = f.expense_date;
        if (this._attachmentFiles.length) data.attachments = this._attachmentFiles.map(function (x) {
            return {url: x.url, name: x.name};
        });
        try {
            if (this._isReEdit && this._reEditId) {
                await this.apiPost(OA_API_URL + '/approval/' + this._reEditId + '/update-draft/', data);
            } else {
                await this.apiPost(OA_API_URL + '/approval/draft/', data);
            }
            this.closeModal('createApprovalModal');
            this.showToast('草稿已保存', false);
            this.statusFilter = 'draft';
            document.querySelectorAll('.filter-btn').forEach(function (b) {
                b.classList.toggle('active', b.dataset.status === 'draft');
            });
            this.loadList(1);
        } catch (e) {
            // this.showAlert('保存失败', e.message);
            this.showToast('保存失败' + (e.message || '请检查表单后重试'), true);
        }
    }

    async cancelApproval(id) {
        var confirmed = await this.showConfirmDialog('撤销审批', '确定要撤销此审批申请吗？撤销后可以重新编辑。', 'danger');
        if (!confirmed) return;
        try {
            await this.apiPost(OA_API_URL + '/approval/' + id + '/cancel/', {});
            this.closeModal('approvalDetailModal');
            this.showToast('已撤销', false);
            this.loadList(this.currentPage);
        } catch (e) {
            this.showToast('撤销失败: ' + e.message, true);
        }
    }

    async deleteDraft(id) {
        var confirmed = await this.showConfirmDialog('删除草稿', '确定要删除此草稿吗？删除后无法恢复。', 'danger');
        if (!confirmed) return;
        try {
            var resp = await fetch(OA_API_URL + '/approval/' + id + '/delete-draft/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.closeModal('approvalDetailModal');
            this.showToast('草稿已删除', false);
            this.loadList(this.currentPage);
        } catch (e) {
            this.showToast('删除失败: ' + e.message, true);
        }
    }

    async reEdit(id) {
        try {
            var d = await this.apiGet(OA_API_URL + '/approval/' + id + '/');
            // 填充表单
            document.getElementById('newApprovalType').value = d.approval_type || '';
            document.getElementById('newApprovalTitle').value = d.title || '';
            document.getElementById('newApprovalContent').value = d.content || '';
            if (d.start_date) document.getElementById('newStartDate').value = d.start_date;
            if (d.end_date) document.getElementById('newEndDate').value = d.end_date;
            if (d.duration) document.getElementById('newDuration').value = d.duration;
            if (d.amount) document.getElementById('newAmount').value = d.amount;
            if (d.expense_type) document.getElementById('newExpenseType').value = d.expense_type;
            this._syncExpenseTypeDisplay();
            if (d.expense_date) document.getElementById('newExpenseDate').value = d.expense_date;
            // 审批方式/模式固定为会签+顺序审批，历史草稿也强制这两个值
            this._lockApprovalDefaults();
            // 重置附件列表与预览，避免残留上一份草稿的附件
            this._attachmentFiles = [];
            var ap = document.getElementById('attachmentPreview');
            if (ap) { ap.innerHTML = ''; ap.style.display = 'none'; }
            if (d.attachments && d.attachments.length) {
                this._attachmentFiles = d.attachments.map(function (u) {
                    if (typeof u === 'object' && u !== null) {
                        return {url: u.url || u, name: u.name || (u.url ? u.url.split('/').pop() : '附件')};
                    }
                    return {url: u, name: u.split('/').pop() || '附件'};
                });
                this._renderAttachments();
            }
            // 加载抄送人（用户+部门）
            this._ccUsers = [];
            this._ccDepartments = [];
            if (d.cc_users && d.cc_users.length) {
                d.cc_users.forEach(function (u) {
                    if (u.cc_type === 'department') {
                        this._ccDepartments.push({id: u.id, name: u.name});
                    } else {
                        this._ccUsers.push({id: u.id, name: u.name, avatar: u.avatar || ''});
                    }
                }, this);
            }
            this._renderCcTags();
            // 配置默认抄送人/部门不可删除
            await this._lockConfigCcDefaults();
            // 加载关联审批
            this._relatedApprovals = (d.related_approval_list || []).map(function (ra) {
                return {id: ra.id, title: ra.title, type: ra.approval_type_display || ra.approval_type, status: ra.status_display || ''};
            });
            this._renderRelApprovalTags();
            // 清空可能残留的内置类型结构化数据行（避免重新编辑时叠加重复的报销项目/采购物项等）
            this._clearTypeRows();
            // 加载内置类型结构化数据（采购物项/报销项目/请假类型/出差信息）
            this._loadTypeDataIntoForm(d);
            // 加载招聘需求数据
            if (d.approval_type === 'recruit' && d.recruit_data) {
                var rd = d.recruit_data;
                if (document.getElementById('recruitPositionName')) document.getElementById('recruitPositionName').value = rd.position_name || '';
                if (document.getElementById('recruitHeadcount')) document.getElementById('recruitHeadcount').value = rd.headcount || '';
                if (document.getElementById('recruitStaffingType')) document.getElementById('recruitStaffingType').value = rd.staffing_type || 'annual';
                if (document.getElementById('recruitStaffingRemark')) document.getElementById('recruitStaffingRemark').value = rd.staffing_remark || '';
                if (rd.staffing_type === 'supplement') {
                    var sr = document.getElementById('recruitStaffingRemarkRow');
                    if (sr) sr.style.display = 'block';
                }
                if (document.getElementById('recruitResponsibilities')) document.getElementById('recruitResponsibilities').value = rd.responsibilities || '';
                if (document.getElementById('recruitBasicReq')) document.getElementById('recruitBasicReq').value = rd.basic_requirement || '';
                if (document.getElementById('recruitExpReq')) document.getElementById('recruitExpReq').value = rd.experience_requirement || '';
                if (document.getElementById('recruitSkillReq')) document.getElementById('recruitSkillReq').value = rd.skill_requirement || '';
                if (document.getElementById('recruitSoftReq')) document.getElementById('recruitSoftReq').value = rd.soft_requirement || '';
                if (document.getElementById('recruitSalaryMin')) document.getElementById('recruitSalaryMin').value = rd.salary_min || '';
                if (document.getElementById('recruitSalaryMax')) document.getElementById('recruitSalaryMax').value = rd.salary_max || '';
                if (document.getElementById('recruitSalaryStructure')) document.getElementById('recruitSalaryStructure').value = rd.salary_structure || '';
                if (document.getElementById('recruitArrivalYear')) document.getElementById('recruitArrivalYear').value = rd.arrival_year || '';
                if (document.getElementById('recruitArrivalMonth')) document.getElementById('recruitArrivalMonth').value = rd.arrival_month || '';
                if (document.getElementById('recruitArrivalDay')) document.getElementById('recruitArrivalDay').value = rd.arrival_day || '';
                if (document.getElementById('recruitUrgency')) document.getElementById('recruitUrgency').value = rd.urgency || 'normal';
                if (document.getElementById('recruitSpecialReq')) document.getElementById('recruitSpecialReq').value = rd.special_requirements || '';
                if (document.getElementById('recruitEmploymentType')) document.getElementById('recruitEmploymentType').value = rd.employment_type || 'fulltime';
            }
            // 加载部门树
            await this._loadDepartmentTree(d.department || null);
            // 填充已选审批人节点
            this._approverNodes = [];
            if (d.approval_nodes) {
                d.approval_nodes.forEach(function (n) {
                    if (n.node_type === 'user' && n.user) {
                        this._approverNodes.push({type: 'user', id: n.user, label: n.user_name || '用户'});
                    } else if (n.node_type === 'department' && n.department) {
                        this._approverNodes.push({
                            type: 'department',
                            id: n.department,
                            label: n.department_name || '部门'
                        });
                    }
                }, this);
            }
            this._renderApproverNodes();
            this._isReEdit = true;
            this._reEditId = id;
            // Set current CC type to prevent config defaults from overwriting restored CC
            this._currentCcType = d.approval_type || '';
            // 自定义类型：保存 form_data 供动态表单回填
            this._editFormData = d.form_data || {};
            // 选中审批类型卡片
            if (d.approval_type) this.selectType(d.approval_type);
            // 回填收款方式（报销/采购，或自定义类型配置了「收款方式」字段）
            if (d.approval_type === 'expense' || d.approval_type === 'purchase' || this._paymentMethodFieldKey) {
                this._fillPaymentMethod(d.payment_method);
            }
            // 显示费用行
            if (d.approval_type === 'expense') {
                document.getElementById('expenseRow').style.display = 'grid';
                document.getElementById('expenseTypeGroup').style.display = '';
                document.getElementById('expenseDateGroup').style.display = '';
            }
            document.getElementById('saveDraftBtn').textContent = '重新保存';
            document.getElementById('submitApprovalBtn').innerHTML = '<i class="fas fa-paper-plane"></i> 重新提交';
            document.getElementById('createApprovalModal').style.display = 'flex';
            setTimeout(function () {
                document.getElementById('createApprovalModal').classList.add('show');
            }, 10);
        } catch (e) {
            this.showAlert('加载失败', e.message);
        }
    }

    // ==================== 审批配置（企业管理员） ====================

    async openConfigModal() {
        this._configEditType = null;
        this._configEditSubTenant = '';
        this._configApprovers = [];
        this._configFinalApprover = null;
        this._configCcDepts = [];
        this._configCcUsers = [];
        this._configDeleteId = null;
        document.getElementById('configApprovalType').value = '';
        document.querySelectorAll('.config-type-card').forEach(function (c) {
            c.classList.remove('active');
        });
        document.getElementById('configForm').style.display = 'none';
        document.getElementById('configDeleteBtn').style.display = 'none';
        // 配置模态框左右拖动分隔条
        this._initSplitter('configSplitter', 'configManageLayout', 'configSidebar');
        // Load sub-tenant selector for group enterprises
        await this._loadSubTenants();
        // Load config list
        await this._renderConfigList();
        // Init search fields
        var self = this;
        setTimeout(function () {
            self._initConfigSearch('configApproverSearch', 'configApproverDropdown', self._searchConfigApprovers, self._addConfigApprover);
            self._initConfigSearch('configFinalApproverSearch', 'configFinalApproverDropdown', self._searchConfigFinalApprover, self._selectConfigFinalApprover);
            self._initConfigSearch('configCcDeptSearch', 'configCcDeptDropdown', self._searchConfigCcDepts, self._addConfigCcDept);
            self._initConfigSearch('configCcUserSearch', 'configCcUserDropdown', self._searchConfigCcUsers, self._addConfigCcUser);
        }, 100);
        document.getElementById('approvalConfigModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('approvalConfigModal').classList.add('show');
        }, 10);
    }

    async _loadSubTenants() {
        var group = document.getElementById('configSubTenantGroup');
        var sel = document.getElementById('configSubTenant');
        if (!group || !sel) return;
        group.style.display = 'block';
        sel.innerHTML = '<option value="">集团默认配置</option>';
        try {
            var resp = await fetch(OA_API_URL + '/approval/dept-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (resp.ok) {
                var json = await resp.json();
                var subTenants = json.sub_tenants || [];
                subTenants.forEach(function (st) {
                    var opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = (st.short_name || st.name) + '（' + (st.tenant_type || '公司') + '）';
                    sel.appendChild(opt);
                });
            }
        } catch (e) {
            console.warn('加载子公司列表失败', e);
        }
    }


    async _renderConfigList() {
        var container = document.getElementById('configList');
        if (!container) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var self = this;
            if (!configs.length) {
                container.innerHTML = '<div style="color:#909399;font-size:13px;padding:8px 0;">暂无配置</div>';
                return;
            }
            var currentSt = document.getElementById('configSubTenant') ? document.getElementById('configSubTenant').value : '';
            container.innerHTML = configs.map(function (c) {
                // Only show configs for the selected sub-tenant (or global when none selected)
                var cSt = c.sub_tenant ? String(c.sub_tenant) : '';
                if (currentSt && cSt !== currentSt) return '';
                if (!currentSt && cSt) return '';
                var sel = self._configEditType === c.approval_type ? ' style="background:#e8f4fd;font-weight:600;display:flex;align-items:center;justify-content:space-between;"' : '';
                var subTag = c.sub_tenant_name ? ' <span style="font-size:10px;color:#e67e22;">[' + self._escape(c.sub_tenant_name) + ']</span>' : '';
                return '<div class="config-list-item"' + sel + ' data-type="' + c.approval_type + '" onclick="approvalApp._editConfig(\'' + c.approval_type + '\')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
                    + '<span><i class="fas fa-tag" style="color:var(--primary-color,#409eff);margin-right:4px;font-size:11px;"></i>' + self._escape(self._getTypeName(c.approval_type)) + subTag + '</span>'
                    + '<span style="font-size:11px;color:#909399;">' + (c.department_name || '未设置') + '</span>'
                    + '</div>';
            }).join('');
        } catch (e) {
            console.error('Load config list failed:', e);
            container.innerHTML = '<div style="color:#f56c6c;font-size:13px;">加载失败</div>';
        }
    }

    _selectConfigType(type) {
        this._configEditType = type;
        document.getElementById('configApprovalType').value = type;
        document.querySelectorAll('.config-type-card').forEach(function (c) {
            c.classList.remove('active');
        });
        document.querySelector('.config-type-card[data-type="' + type + '"]').classList.add('active');
        this._updateThresholdFieldOptions();
        this._loadConfig();
        this._renderConfigList();
    }

    _onConfigSubTenantChange() {
        this._renderConfigList();
        this._loadConfig();
    }

    _editConfig(type) {
        this._configEditType = type;
        this._selectConfigType(type);
        this._renderConfigList();
    }

    async _loadConfig() {
        var type = document.getElementById('configApprovalType').value;
        var form = document.getElementById('configForm');
        var delBtn = document.getElementById('configDeleteBtn');
        if (!type) {
            form.style.display = 'none';
            if (delBtn) delBtn.style.display = 'none';
            return;
        }
        form.style.display = 'block';
        await this._loadConfigDepts();
        // 获取当前选中的子公司
        var subTenantId = document.getElementById('configSubTenant') ? document.getElementById('configSubTenant').value : '';
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var cfg = null;
            configs.forEach(function (c) {
                var cSt = c.sub_tenant ? String(c.sub_tenant) : '';
                if (c.approval_type === type && cSt === subTenantId) cfg = c;
            });
            this._configDeleteId = cfg ? cfg.id : null;
            if (delBtn) delBtn.style.display = cfg ? 'inline-flex' : 'none';
            var deptSel = document.getElementById('configFinalDept');
            if (deptSel && cfg && cfg.department) deptSel.value = cfg.department;
            else if (deptSel) deptSel.value = '';
            this._configApprovers = [];
            if (cfg && cfg.approver_user_details) {
                this._configApprovers = cfg.approver_user_details.map(function (u) {
                    return {id: u.id, name: u.name, position: u.position || ''};
                });
            }
            this._renderConfigApproverTags();
            this._configFinalApprover = null;
            if (cfg && cfg.final_approver_details) {
                this._configFinalApprover = {
                    id: cfg.final_approver_details.id,
                    name: cfg.final_approver_details.name,
                    position: cfg.final_approver_details.position || ''
                };
            }
            this._renderConfigFinalApproverTag();
            this._configCcDepts = [];
            if (cfg && cfg.cc_department_details) {
                this._configCcDepts = cfg.cc_department_details.map(function (d) {
                    return {id: d.id, name: d.name};
                });
            }
            this._renderConfigCcDeptTags();
            this._configCcUsers = [];
            if (cfg && cfg.cc_user_details) {
                this._configCcUsers = cfg.cc_user_details.map(function (u) {
                    return {id: u.id, name: u.name, avatar: u.avatar || ''};
                });
            }
            this._renderConfigCcUserTags();
            // Restore sign_type and approval_mode
            var signTypeSel = document.getElementById('configSignType');
            if (signTypeSel && cfg && cfg.sign_type) signTypeSel.value = cfg.sign_type;
            else if (signTypeSel) signTypeSel.value = 'countersign';
            var apprModeSel = document.getElementById('configApprovalMode');
            if (apprModeSel && cfg && cfg.approval_mode) apprModeSel.value = cfg.approval_mode;
            else if (apprModeSel) apprModeSel.value = 'sequential';
            // Restore threshold config
            var thEnable = document.getElementById('configThresholdEnable');
            if (thEnable) {
                thEnable.checked = cfg && cfg.threshold_enabled ? true : false;
                this._toggleThresholdConfig();
            }
            var thField = document.getElementById('configThresholdField');
            if (thField && cfg && cfg.threshold_field) thField.value = cfg.threshold_field;
            else if (thField) thField.value = 'duration';
            var thVal = document.getElementById('configThresholdValue');
            if (thVal && cfg && cfg.threshold_value != null) thVal.value = cfg.threshold_value;
            else if (thVal) thVal.value = '';
            var thDept = document.getElementById('configThresholdDept');
            if (thDept && cfg && cfg.threshold_department) thDept.value = cfg.threshold_department;
            else if (thDept) thDept.value = '';
            var sigEl = document.getElementById('configRequireSignature');
            if (sigEl) sigEl.checked = cfg && cfg.require_signature ? true : false;
            var rhEl = document.getElementById('configReceiptReturnHours');
            if (rhEl) rhEl.value = (cfg && cfg.receipt_return_hours !== null && cfg.receipt_return_hours !== undefined) ? cfg.receipt_return_hours : 24;
            var erEl = document.getElementById('configEnableReceiptReturn');
            if (erEl) erEl.checked = !!(cfg && cfg.enable_receipt_return);
            this._onReceiptConfigChange();
        } catch (e) {
            console.error('Load config failed:', e);
        }
    }

    _onReceiptConfigChange() {
        var erEl = document.getElementById('configEnableReceiptReturn');
        var grp = document.getElementById('configReceiptReturnHoursGroup');
        if (grp) grp.style.display = erEl && erEl.checked ? 'block' : 'none';
    }

    _buildDepartmentTreeHtml(depts, selectedId) {
        var tree = {};
        depts.forEach(function (d) {
            var pid = d.parent_id != null ? d.parent_id : 0;
            if (!tree[pid]) tree[pid] = [];
            tree[pid].push(d);
        });
        var html = '<option value="">请选择</option>';
        var walk = function (pid, depth) {
            var children = tree[pid] || [];
            children.forEach(function (d) {
                var prefix = '';
                for (var i = 0; i < depth; i++) prefix += '—— ';
                var sel = selectedId && parseInt(d.id) === parseInt(selectedId) ? ' selected' : '';
                html += '<option value="' + d.id + '"' + sel + '>' + prefix + d.name + '</option>';
                walk(d.id, depth + 1);
            });
        };
        walk(0, 0);
        // Fallback for non-zero root parent_ids
        if (!tree[0] || !tree[0].length) {
            var allIds = {};
            depts.forEach(function (d) {
                allIds[d.id] = true;
            });
            var actualRoots = [];
            depts.forEach(function (d) {
                if (!allIds[d.parent_id]) actualRoots.push(d);
            });
            if (actualRoots.length) {
                html = '<option value="">请选择</option>';
                var renderFlat = function (items, depth) {
                    items.forEach(function (d) {
                        var prefix = '';
                        for (var i = 0; i < depth; i++) prefix += '—— ';
                        var sel = selectedId && parseInt(d.id) === parseInt(selectedId) ? ' selected' : '';
                        html += '<option value="' + d.id + '"' + sel + '>' + prefix + d.name + '</option>';
                        var kids = tree[d.id] || [];
                        renderFlat(kids, depth + 1);
                    });
                };
                renderFlat(actualRoots, 0);
            }
        }
        return html;
    }

    async _loadConfigDepts() {
        var sel = document.getElementById('configFinalDept');
        var thSel = document.getElementById('configThresholdDept');
        if (!sel) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/org_departments/');
            var depts = data.results || [];
            var treeHtml = this._buildDepartmentTreeHtml(depts);
            sel.innerHTML = treeHtml;
            if (thSel) thSel.innerHTML = treeHtml;
        } catch (e) {
            console.error('Load config depts failed:', e);
        }
    }

    _initConfigSearch(inputId, dropdownId, searchFn, addFn) {
        var self = this;
        var input = document.getElementById(inputId);
        var dd = document.getElementById(dropdownId);
        if (!input || !dd) return;
        var timer = null;
        input.oninput = function () {
            clearTimeout(timer);
            var val = input.value.trim();
            if (!val) {
                dd.style.display = 'none';
                return;
            }
            timer = setTimeout(function () {
                searchFn.call(self, val, dd);
            }, 300);
        };
        input.onfocus = function () {
            if (input.value.trim()) searchFn.call(self, input.value.trim(), dd);
        };
    }

    async _searchConfigApprovers(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var selectedIds = {};
            (this._configApprovers || []).forEach(function (u) {
                selectedIds[u.id] = true;
            });
            dd.innerHTML = users.length ? users.map(function (u) {
                var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="if(!this.classList.contains(\'disabled\'))approvalApp._addConfigApprover(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + self._escape(u.position || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    }

    _addConfigApprover(id, name, position) {
        if (this._configApprovers.some(function (u) {
            return u.id === id;
        })) return;
        this._configApprovers.push({id: id, name: name, position: position});
        this._renderConfigApproverTags();
        document.getElementById('configApproverDropdown').style.display = 'none';
        document.getElementById('configApproverSearch').value = '';
    }

    _removeConfigApprover(id) {
        this._configApprovers = this._configApprovers.filter(function (u) {
            return u.id !== id;
        });
        this._renderConfigApproverTags();
    }

    _renderConfigApproverTags() {
        var container = document.getElementById('configApproverTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configApprovers || []).map(function (u) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f0f9eb;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user-check" style="font-size:10px;color:#67c23a;"></i>'
                + '<span>' + self._escape(u.name) + '</span>'
                + (u.position ? '<span style="font-size:10px;color:#909399;">(' + self._escape(u.position) + ')</span>' : '')
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigApprover(' + u.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    }

    // ===== 最终审批人（单个，可选） =====
    async _searchConfigFinalApprover(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var currentId = this._configFinalApprover ? this._configFinalApprover.id : null;
            dd.innerHTML = users.length ? users.map(function (u) {
                var cls = (currentId && u.id === currentId) ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._selectConfigFinalApprover(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + self._escape(u.position || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    }

    _selectConfigFinalApprover(id, name, position) {
        this._configFinalApprover = {id: id, name: name, position: position || ''};
        this._renderConfigFinalApproverTag();
        document.getElementById('configFinalApproverDropdown').style.display = 'none';
        document.getElementById('configFinalApproverSearch').value = '';
    }

    _removeConfigFinalApprover() {
        this._configFinalApprover = null;
        this._renderConfigFinalApproverTag();
    }

    _renderConfigFinalApproverTag() {
        var container = document.getElementById('configFinalApproverTags');
        if (!container) return;
        var self = this;
        var fa = this._configFinalApprover;
        container.innerHTML = fa ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:14px;font-size:12px;margin:2px;">'
            + '<i class="fas fa-user-shield" style="font-size:10px;color:#409eff;"></i>'
            + '<span>' + self._escape(fa.name) + '</span>'
            + (fa.position ? '<span style="font-size:10px;color:#909399;">(' + self._escape(fa.position) + ')</span>' : '')
            + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigFinalApprover()"></i>'
            + '</span>' : '';
    }

    async _searchConfigCcDepts(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-departments/?search=' + encodeURIComponent(keyword));
            var depts = data.results || [];
            var selectedIds = {};
            (this._configCcDepts || []).forEach(function (d) {
                selectedIds[d.id] = true;
            });
            dd.innerHTML = depts.length ? depts.map(function (d) {
                var cls = selectedIds[d.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addConfigCcDept(' + d.id + ',\'' + self._escape(d.name) + '\')">'
                    + '<i class="fas fa-building" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#409eff;"></i>'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(d.name) + '</span>'
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到部门</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    }

    _addConfigCcDept(id, name) {
        if (this._configCcDepts.some(function (d) {
            return d.id === id;
        })) return;
        this._configCcDepts.push({id: id, name: name});
        this._renderConfigCcDeptTags();
        document.getElementById('configCcDeptDropdown').style.display = 'none';
        document.getElementById('configCcDeptSearch').value = '';
    }

    _removeConfigCcDept(id) {
        this._configCcDepts = this._configCcDepts.filter(function (d) {
            return d.id !== id;
        });
        this._renderConfigCcDeptTags();
    }

    _renderConfigCcDeptTags() {
        var container = document.getElementById('configCcDeptTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configCcDepts || []).map(function (d) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#e8f4fd;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-building" style="font-size:10px;color:#409eff;"></i>'
                + '<span>' + self._escape(d.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigCcDept(' + d.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    }

    async _searchConfigCcUsers(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var selectedIds = {};
            (this._configCcUsers || []).forEach(function (u) {
                selectedIds[u.id] = true;
            });
            dd.innerHTML = users.length ? users.map(function (u) {
                var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addConfigCcUser(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + (u.avatar || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    }

    _addConfigCcUser(id, name, avatar) {
        if (this._configCcUsers.some(function (u) {
            return u.id === id;
        })) return;
        this._configCcUsers.push({id: id, name: name, avatar: avatar || ''});
        this._renderConfigCcUserTags();
        document.getElementById('configCcUserDropdown').style.display = 'none';
        document.getElementById('configCcUserSearch').value = '';
    }

    _removeConfigCcUser(id) {
        this._configCcUsers = this._configCcUsers.filter(function (u) {
            return u.id !== id;
        });
        this._renderConfigCcUserTags();
    }

    _renderConfigCcUserTags() {
        var container = document.getElementById('configCcUserTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configCcUsers || []).map(function (u) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f3e8ff;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user" style="font-size:10px;color:#9b59b6;"></i>'
                + '<span>' + self._escape(u.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigCcUser(' + u.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    }

    async _deleteConfig() {
        var confirmed = await this.showConfirmDialog('删除配置', '确定要删除当前审批类型的配置吗？删除后不可恢复。', 'danger');
        if (!confirmed) return;
        if (!this._configDeleteId) {
            this.showAlert('提示', '未找到配置ID');
            return;
        }
        try {
            var resp = await fetch(OA_API_URL + '/approval/delete-dept-config/' + this._configDeleteId + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders(),
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.showToast('配置已删除', false);
            this._configDeleteId = null;
            this._configEditType = null;
            document.getElementById('configForm').style.display = 'none';
            document.getElementById('configDeleteBtn').style.display = 'none';
            document.getElementById('configApprovalType').value = '';
            await this._renderConfigList();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    }

    _toggleThresholdConfig() {
        var enabled = document.getElementById('configThresholdEnable') ? document.getElementById('configThresholdEnable').checked : false;
        var fields = document.getElementById('configThresholdFields');
        if (fields) fields.style.display = enabled ? 'block' : 'none';
        // 根据审批类型动态更新阈值字段选项
        this._updateThresholdFieldOptions();
    }

    _updateThresholdFieldOptions() {
        var type = document.getElementById('configApprovalType') ? document.getElementById('configApprovalType').value : '';
        var fieldSel = document.getElementById('configThresholdField');
        if (!fieldSel) return;
        var fieldLabel = fieldSel.closest('div') ? fieldSel.closest('div').querySelector('label') : null;

        if (type === 'leave' || type === 'trip') {
            fieldSel.innerHTML = '<option value="duration">天数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（天）';
        } else if (type === 'overtime') {
            fieldSel.innerHTML = '<option value="duration">小时数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（小时）';
        } else if (type === 'expense' || type === 'purchase') {
            fieldSel.innerHTML = '<option value="amount">金额（¥）</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（元）';
        } else if (type === 'recruit') {
            fieldSel.innerHTML = '<option value="headcount">招聘人数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（人）';
        } else if (!this._isBuiltinType(type) || this._isDynamicSchemaType(type)) {
            // 自定义类型 / 带表单内置类型：列出 schema 中的数字/金额字段
            const t = this._getType(type);
            const numericFields = ((t && t.form_schema) || []).filter(function (f) {
                return f.type === 'number' || f.type === 'amount';
            });
            if (numericFields.length) {
                fieldSel.innerHTML = numericFields.map(function (f) {
                    return '<option value="' + this._escape(f.key) + '">' + this._escape(f.label || f.key) + '</option>';
                }, this).join('');
            } else {
                fieldSel.innerHTML = '<option value="">该类型无数字字段</option>';
            }
            if (fieldLabel) fieldLabel.innerHTML = '阈值字段';
        } else {
            fieldSel.innerHTML = '<option value="duration">天数/时长</option><option value="amount">金额</option><option value="headcount">招聘人数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值字段';
        }
    }

    async _saveConfig() {
        var type = document.getElementById('configApprovalType').value;
        if (!type) {
            this.showAlert('提示', '请选择审批类型');
            return;
        }
        var departmentId = document.getElementById('configFinalDept').value;
        var thEnabled = document.getElementById('configThresholdEnable') ? document.getElementById('configThresholdEnable').checked : false;
        var thField = document.getElementById('configThresholdField') ? document.getElementById('configThresholdField').value : '';
        var thValue = document.getElementById('configThresholdValue') ? document.getElementById('configThresholdValue').value : '';
        var thDeptId = document.getElementById('configThresholdDept') ? document.getElementById('configThresholdDept').value : '';
        var subTenantId = document.getElementById('configSubTenant') ? document.getElementById('configSubTenant').value : '';
        var signType = document.getElementById('configSignType') ? document.getElementById('configSignType').value : 'countersign';
        var apprMode = document.getElementById('configApprovalMode') ? document.getElementById('configApprovalMode').value : 'sequential';
        var data = {
            approval_type: type,
            department_id: departmentId ? parseInt(departmentId) : null,
            cc_departments: (this._configCcDepts || []).map(function (d) {
                return d.id;
            }),
            cc_users: (this._configCcUsers || []).map(function (u) {
                return u.id;
            }),
            approver_users: (this._configApprovers || []).map(function (u) {
                return u.id;
            }),
            final_approver: this._configFinalApprover ? this._configFinalApprover.id : null,
            sign_type: signType,
            approval_mode: apprMode,
            threshold_enabled: thEnabled,
            threshold_field: thField,
            threshold_value: thValue ? parseFloat(thValue) : null,
            threshold_department_id: thDeptId ? parseInt(thDeptId) : null,
            require_signature: document.getElementById('configRequireSignature') ? document.getElementById('configRequireSignature').checked : false,
            receipt_return_hours: parseInt(document.getElementById('configReceiptReturnHours') ? (document.getElementById('configReceiptReturnHours').value || 0) : 24),
            enable_receipt_return: document.getElementById('configEnableReceiptReturn') ? document.getElementById('configEnableReceiptReturn').checked : false,
        };
        if (subTenantId) data.sub_tenant_id = parseInt(subTenantId);
        try {
            await this.apiPost(OA_API_URL + '/approval/save-dept-config/', data);
            this.showToast('配置保存成功', false);
            // this.closeModal('approvalConfigModal');
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    }

    // ==================== 详情 ====================

    async _openRelatedApproval(id) {
        // 在独立的新模态框中打开关联审批，保持当前详情不关闭
        var overlayId = 'relApprovalModal_' + id + '_' + Date.now();
        var overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.className = 'modal';
        overlay.style.cssText = 'z-index:2500;';
        overlay.innerHTML = '<div class="modal-content" style="max-width:800px;">'
            + '<div class="modal-header"><h3><i class="fas fa-link" style="color:#16a085;"></i> 关联审批详情</h3>'
            + '<span class="approval-detail-subtitle" style="font-size:12px;color:var(--text-light,#909399);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;flex:1;margin-left:8px;"></span>'
            + '<div style="display:flex;align-items:center;gap:6px;"><button class="close-btn" onclick="approvalApp.closeModal(\'' + overlayId + '\')">&times;</button></div></div>'
            + '<div class="modal-body" style="max-height:70vh;overflow-y:auto;"></div>'
            + '<div class="modal-footer"><button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + overlayId + '\')">关闭</button></div>'
            + '</div>';
        document.body.appendChild(overlay);
        this._detailModalId = overlayId;
        try {
            await this.showDetail(id);
        } finally {
            this._detailModalId = null;
        }
    }

    async showDetail(id) {
        try {
            this._detailApprovalId = id;
            const d = await this.apiGet(OA_API_URL + '/approval/' + id + '/');
            // 支持在新模态框中打开（关联审批查看时保持当前详情不关闭）
            var modalId = this._detailModalId || 'approvalDetailModal';
            const statusMap = {
                'draft': '草稿',
                'pending': '待审批',
                'approved': '已通过',
                'rejected': '已驳回',
                'deferred': '暂缓',
                'processing': '办理中',
                'cancelled': '已撤回'
            };
            const scMap = {
                'draft': 'badge-default',
                'pending': 'badge-info',
                'approved': 'status-badge normal',
                'rejected': 'status-badge late',
                'deferred': 'status-badge deferred',
                'processing': 'status-badge processing',
                'cancelled': 'badge-default'
            };
            const tMap = {
                'leave': '请假',
                'overtime': '加班',
                'expense': '报销',
                'trip': '出差',
                'purchase': '采购',
                'recruit': '招聘需求',
                'other': '其他'
            };
            const defAv = '/static/images/default-avatar.png';
            var currentUserId = parseInt(localStorage.getItem('user_id'));
            // 记录该审批是否需要手写签名 / 是否开启票据回传
            this._currentApprovalRequireSignature = d.require_signature ? true : false;
            this._currentApprovalEnableReceipt = !!d.enable_receipt_return;

            console.log('_currentApprovalRequireSignature:::', this._currentApprovalRequireSignature);

            var modeLabel = '';
            if (d.sign_type === 'countersign') modeLabel = '会签';
            else modeLabel = '或签';
            if (d.approval_mode === 'sequential') modeLabel += ' · 顺序审批';
            else modeLabel += ' · 并行审批';

            // 已撤回的审批在顶部给出醒目提示（从工作通知/聊天跳转过来时尤其重要）
            var cancelledBanner = d.status === 'cancelled'
                ? '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fdf0ef;border:1px solid #f8d0cd;border-radius:8px;color:#c0392b;font-size:13px;margin-bottom:12px;"><i class="fas fa-ban" style="flex-shrink:0;"></i> <span>该审批已被发起人撤回（撤销），无需继续处理。</span></div>'
                : '';

            let html = cancelledBanner + '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label><i class="fas fa-user-circle" style="color:var(--primary-color,#409eff);"></i> 申请人</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + (d.applicant_avatar || defAv) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + (d.applicant === currentUserId ? '我' : this._escape(d.applicant_name || '')) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-tag" style="color:#409eff;"></i> 审批标题</label><span>' + this._escape(d.title) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-list" style="color:#67c23a;"></i> 审批类型</label><span><span class="type-icon-badge type-' + d.approval_type + '" style="color:' + (d.approval_type_color || this._getTypeColor(d.approval_type)) + ';"><i class="fas ' + (d.approval_type_icon || this._getTypeIcon(d.approval_type)) + '"></i> ' + this._escape(d.approval_type_name || d.approval_type_display || d.approval_type) + '</span></span></div>'
                + '<div class="detail-item"><label><i class="fas fa-building" style="color:#e6a23c;"></i> 所属部门</label><span>' + this._escape(d.department_name || '-') + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-sitemap" style="color:#9b59b6;"></i> 审批方式</label><span>' + modeLabel + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-info-circle" style="color:#909399;"></i> 状态</label><span class="' + (scMap[d.status] || '') + '"><i class="fas ' + this._statusIcon(d.status) + '" style="margin-right:4px;"></i>' + (statusMap[d.status] || d.status) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-clock" style="color:#909399;"></i> 创建时间</label><span>' + this._formatTime(d.created_at) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-sync" style="color:#909399;"></i> 更新时间</label><span>' + this._formatTime(d.updated_at) + '</span></div>';

            if (d.start_date) html += '<div class="detail-item"><label><i class="fas fa-calendar-alt" style="color:var(--primary-color,#409eff);"></i> 开始日期</label><span>' + d.start_date + '</span></div>';
            if (d.end_date) html += '<div class="detail-item"><label><i class="fas fa-calendar-check" style="color:#67c23a;"></i> 结束日期</label><span>' + d.end_date + '</span></div>';
            if (d.duration) {
                var durLabel = d.approval_type === 'overtime' ? '小时数' : '天数';
                html += '<div class="detail-item"><label><i class="fas fa-clock" style="color:#e6a23c;"></i> ' + durLabel + '</label><span>' + d.duration + '</span></div>';
            }
            if (d.amount) html += '<div class="detail-item"><label><i class="fas fa-money-bill-wave" style="color:#67c23a;"></i> 金额</label><span>¥' + parseFloat(d.amount).toFixed(2) + '</span></div>';
            if (d.expense_type) html += '<div class="detail-item"><label><i class="fas fa-tags" style="color:#e6a23c;"></i> 费用类型</label><span>' + (d.expense_type_display || d.expense_type) + '</span></div>';
            if (d.expense_date) html += '<div class="detail-item"><label><i class="fas fa-calendar-day" style="color:#409eff;"></i> 费用日期</label><span>' + d.expense_date + '</span></div>';
            if (d.approver_comment) html += '<div class="detail-item" style="grid-column:1/-1;"><label><i class="fas fa-comment-dots" style="color:#e6a23c;"></i> 审批意见</label><span>' + this._escape(d.approver_comment) + '</span></div>';

            // 附件预览
            if (d.attachments && d.attachments.length) {
                var attachUrls = d.attachments;
                html += '<div class="detail-item full-width"><label><i class="fas fa-paperclip" style="color:#909399;"></i> 附件</label><div style="display:flex;flex-wrap:wrap;gap:8px;">';
                attachUrls.forEach(function (url, idx) {
                    var name = url;
                    var origName = '';
                    if (typeof url === 'object' && url !== null) {
                        name = url.name || '附件';
                        origName = url.name || '';
                        url = url.url || url;
                    } else {
                        name = (url || '').split('/').pop() || '附件';
                        origName = name;
                    }
                    var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    var isVideo = name.match(/\.(mp4|avi|mov|webm)$/i);
                    var isAudio = name.match(/\.(mp3|wav|ogg)$/i);
                    var isDoc = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i);
                    if (isImg) {
                        html += '<a href="javascript:void(0)" onclick="approvalApp._previewImage(' + idx + ')" style="display:inline-block;" title="' + approvalApp._escape(origName) + '"><img src="' + url + '" style="width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid var(--border-color,#dcdfe6);cursor:pointer;" title="' + approvalApp._escape(origName) + '"></a>';
                    } else if (isVideo) {
                        html += '<div style="display:inline-block;width:180px;vertical-align:top;"><video src="' + url + '" controls style="width:100%;border-radius:6px;border:1px solid var(--border-color,#dcdfe6);" title="' + approvalApp._escape(origName) + '"></video><div style="font-size:11px;color:#909399;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">' + approvalApp._escape(origName) + '</div></div>';
                    } else if (isAudio) {
                        html += '<div style="display:inline-block;width:220px;vertical-align:top;padding:8px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;border:1px solid var(--border-color,#dcdfe6);"><audio src="' + url + '" controls style="width:100%;" title="' + approvalApp._escape(origName) + '"></audio><div style="font-size:11px;color:#909399;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">' + approvalApp._escape(origName) + '</div></div>';
                    } else if (isDoc) {
                        html += '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(origName) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:#f0f9eb;border:1px solid #b7eb8f;border-radius:6px;text-decoration:none;color:#135200;font-size:12px;max-width:200px;cursor:pointer;" title="保存到网盘并在线编辑"><i class="fas fa-cloud-upload-alt" style="color:#52c41a;flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(origName) + '</span></a>';
                    } else {
                        var otherIcon = approvalApp._getFileIcon(origName);
                        html += '<span style="display:inline-flex;align-items:center;gap:4px;"><a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(origName) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px;max-width:200px;cursor:pointer;" title="保存到网盘"><i class="fas ' + otherIcon + '" style="color:var(--primary-color,#409eff);flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(origName) + '</span></a><a href="' + url + '" download="' + approvalApp._escape(origName) + '" target="_blank" title="下载" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#f0f2f5;text-decoration:none;flex-shrink:0;"><i class="fas fa-cloud-download-alt" style="color:#409eff;font-size:12px;"></i></a></span>';
                    }
                });
                html += '</div></div>';
                // 保存附件URL列表供预览使用
                this._previewUrls = attachUrls;
            }

            // 抄送人显示（支持用户和部门）
            if (d.cc_users && d.cc_users.length) {
                html += '<div class="detail-item full-width"><label><i class="fas fa-eye" style="color:#9b59b6;"></i> 抄送人</label><div style="display:flex;flex-wrap:wrap;gap:6px;">';
                d.cc_users.forEach(function (cc) {
                    if (cc.cc_type === 'department') {
                        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px 3px 4px;background:#e8f4fd;border-radius:14px;font-size:12px;" title="部门抄送">'
                            + '<i class="fas fa-building" style="font-size:12px;color:#409eff;"></i>'
                            + approvalApp._escape(cc.name)
                            + (cc.manager_name ? ' <span style="font-size:10px;color:#909399;">(' + approvalApp._escape(cc.manager_name) + ')</span>' : '')
                            + '</span>';
                    } else {
                        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px 3px 4px;background:#f3e8ff;border-radius:14px;font-size:12px;">'
                            + '<img src="' + (cc.avatar || '/static/images/default-avatar.png') + '" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">'
                            + approvalApp._escape(cc.name) + '</span>';
                    }
                });
                html += '</div></div>';
            }

            // 关联审批展示（报销关联采购等）
            if (d.related_approval_list && d.related_approval_list.length) {
                var relStatusMap = {draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', deferred: '暂缓', processing: '办理中', cancelled: '已撤回'};
                html += '<div class="detail-item full-width"><label><i class="fas fa-link" style="color:#16a085;"></i> 关联审批</label><div style="display:flex;flex-wrap:wrap;gap:6px;">';
                d.related_approval_list.forEach(function (ra) {
                    var rsc = relStatusMap[ra.status] || ra.status || '';
                    html += '<a href="javascript:void(0)" onclick="approvalApp._openRelatedApproval(' + ra.id + ')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#e8f6f3;border:1px solid #b2e0d8;border-radius:14px;font-size:12px;color:#0f766e;text-decoration:none;cursor:pointer;" title="点击查看关联审批">'
                        + '<i class="fas fa-link" style="font-size:11px;"></i>'
                        + approvalApp._escape(ra.title)
                        + ' <span style="font-size:10px;color:#909399;">' + approvalApp._escape(ra.approval_type_display || ra.approval_type) + ' · ' + approvalApp._escape(rsc) + '</span>'
                        + '</a>';
                });
                html += '</div></div>';
            }

            // 请假类型
            if (d.approval_type === 'leave' && d.leave_type) {
                html += '<div class="detail-item full-width"><label><i class="fas fa-bed" style="color:#409eff;"></i> 请假类型</label><span>' + this._escape(d.leave_type) + '</span></div>';
            }
            // 出差信息
            if (d.approval_type === 'trip' && d.trip_data && typeof d.trip_data === 'object') {
                var td = d.trip_data;
                var tripParts = [];
                if (td.reason) tripParts.push('事由：' + td.reason);
                if (td.place) tripParts.push('地点：' + td.place);
                if (td.days) tripParts.push('天数：' + td.days + ' 天');
                if (td.amount) tripParts.push('金额：¥' + td.amount);
                if (td.remark) tripParts.push('备注：' + td.remark);
                if (tripParts.length) html += '<div class="detail-item full-width"><label><i class="fas fa-plane" style="color:#16a085;"></i> 出差信息</label><span>' + this._escape(tripParts.join('；')) + '</span></div>';
            }
            // 采购物项
            if (d.approval_type === 'purchase' && d.purchase_items && d.purchase_items.length) {
                var pit = d.purchase_items;
                html += '<div class="detail-item full-width"><label><i class="fas fa-cart-plus" style="color:#e6a23c;"></i> 采购物项</label><div style="overflow-x:auto;">'
                    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;"><thead><tr style="background:var(--bg-secondary,#f5f7fa);"><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">商品名称</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">数量</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">单价(¥)</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">总价(¥)</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">备注</th></tr></thead><tbody>';
                pit.forEach(function (it) {
                    html += '<tr><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.name || '') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + (it.qty || 0) + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + (it.price != null ? it.price : '-') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);font-weight:600;">' + (it.total != null ? Number(it.total).toFixed(2) : '0.00') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.remark || '') + '</td></tr>';
                });
                var pTotal = pit.reduce(function (s, it) { return s + (parseFloat(it.total) || 0); }, 0);
                html += '<tr style="background:var(--bg-secondary,#f5f7fa);"><td colspan="3" style="padding:5px;border:1px solid var(--border-color,#dcdfe6);text-align:right;"><b>采购总金额</b></td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);font-weight:700;color:#e6a23c;">' + pTotal.toFixed(2) + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);"></td></tr>';
                html += '</tbody></table></div></div>';
            }
            // 报销项目
            if (d.approval_type === 'expense' && d.expense_items && d.expense_items.length) {
                var eit = d.expense_items;
                html += '<div class="detail-item full-width"><label><i class="fas fa-receipt" style="color:#67c23a;"></i> 报销项目</label><div style="overflow-x:auto;">'
                    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;"><thead><tr style="background:var(--bg-secondary,#f5f7fa);"><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">项目名称</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">金额(¥)</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">备注</th></tr></thead><tbody>';
                eit.forEach(function (it) {
                    html += '<tr><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.name || '') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + (it.amount != null ? Number(it.amount).toFixed(2) : '0.00') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.remark || '') + '</td></tr>';
                });
                var eTotal = eit.reduce(function (s, it) { return s + (parseFloat(it.amount) || 0); }, 0);
                html += '<tr style="background:var(--bg-secondary,#f5f7fa);"><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);text-align:right;"><b>报销总金额</b></td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);font-weight:700;color:#67c23a;">' + eTotal.toFixed(2) + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);"></td></tr>';
                html += '</tbody></table></div></div>';
            }
            // 收款方式/收款信息展示（仅超级管理员、申请人、最终审批节点审批人可见，保护申请人隐私）
            if (d.payment_method && d.payment_method.type && d.can_view_payment) {
                var pm = d.payment_method;
                // 左侧：收款信息文本（仅显示已填写字段）
                var payee = '<div style="font-size:13px;line-height:1.8;">'
                    + '<div style="margin-bottom:4px;"><span style="color:#909399;">方式：</span><b>' + this._escape(pm.type === 'custom' ? '自定义收款方式' : '默认收款账号') + '</b></div>'
                    + (pm.payee_name ? '<div style="margin-bottom:2px;"><span style="color:#909399;">收款人：</span><b>' + this._escape(pm.payee_name) + '</b></div>' : '')
                    + (pm.bank_card ? '<div style="margin-bottom:2px;"><span style="color:#909399;">银行卡号：</span>' + this._escape(pm.bank_card) + '</div>' : '')
                    + (pm.bank_name ? '<div style="margin-bottom:2px;"><span style="color:#909399;">开户银行：</span>' + this._escape(pm.bank_name) + '</div>' : '')
                    + (pm.bank_address ? '<div style="margin-bottom:2px;"><span style="color:#909399;">开户银行地址：</span>' + this._escape(pm.bank_address) + '</div>' : '')
                    + (pm.alipay_account ? '<div style="margin-bottom:2px;"><span style="color:#909399;">支付宝账号：</span>' + this._escape(pm.alipay_account) + '</div>' : '')
                    + (pm.wechat_account ? '<div style="margin-bottom:2px;"><span style="color:#909399;">微信账号：</span>' + this._escape(pm.wechat_account) + '</div>' : '')
                    + '</div>';
                // 右侧：收款二维码（如有）
                var qrHtml = '';
                var qrItem = function (u, label) {
                    return '<div style="text-align:center;flex:0 0 auto;"><img src="' + approvalApp._escape(u) + '" style="width:88px;height:88px;max-width:88px;border-radius:8px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;background:#fff;" onclick="approvalApp._previewImageByUrl(this.src,\'' + label + '\')" title="点击放大预览"><div style="font-size:11px;color:#909399;margin-top:2px;">' + label + '</div></div>';
                };
                if (pm.alipay_qr) qrHtml += qrItem(pm.alipay_qr, '支付宝收款码');
                if (pm.wechat_qr) qrHtml += qrItem(pm.wechat_qr, '微信收款码');
                var hasInfo = pm.payee_name || pm.bank_card || pm.alipay_account || pm.wechat_account;
                if (hasInfo || qrHtml) {
                    html += '<div class="detail-item full-width" style="background:var(--bg-secondary,#f5f7fa);border-radius:6px;padding:8px 10px;"><label><i class="fas fa-wallet" style="color:#16a085;"></i> 收款方式</label><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;flex:1;">'
                        + '<div style="flex:1;min-width:200px;">' + payee + '</div>'
                        + (qrHtml ? '<div style="display:flex;gap:10px;flex-wrap:wrap;flex:0 0 auto;">' + qrHtml + '</div>' : '')
                        + '</div></div>';
                }
            }
            // 票据回传：最终审批通过后申请人在时限内回传付款凭证/票据
            html += this._renderReceiptSection(d);
            // 招聘需求详情展示
            if (d.approval_type === 'recruit' && d.recruit_data) {
                var rd = d.recruit_data;
                var urgencyText = {
                    'normal': '常规（7-15个工作日）',
                    'urgent': '紧急（3-7个工作日）',
                    'critical': '特急（3个工作日内）'
                };
                var empText = {'fulltime': '全职正式岗', 'parttime': '兼职岗', 'temporary': '临时顶岗'};
                var staffText = {'annual': '年度核定编制内招聘', 'supplement': '临时增补超编招聘'};
                var self = this;
                html += '<div class="detail-item full-width" style="border:1px solid #fef3e0;border-radius:8px;padding:12px;background:#fffbf0;margin-top:8px;">'
                    + '<div style="font-size:14px;font-weight:600;color:#e67e22;margin-bottom:8px;border-bottom:1px solid #fef3e0;padding-bottom:6px;"><i class="fas fa-user-plus"></i> 招聘需求详情</div>'
                    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">'
                    + '<div><strong>岗位名称：</strong>' + self._escape(rd.position_name || '-') + '</div>'
                    + '<div><strong>招聘人数：</strong>' + (rd.headcount || 0) + '人</div>'
                    + '<div style="grid-column:1/-1;"><strong>编制属性：</strong>' + (staffText[rd.staffing_type] || rd.staffing_type) + '</div>'
                    + (rd.staffing_remark ? '<div style="grid-column:1/-1;"><strong>超编说明：</strong>' + self._escape(rd.staffing_remark) + '</div>' : '')
                    + '<div style="grid-column:1/-1;margin-top:4px;"><strong>岗位职责：</strong><br>' + self._escape(rd.responsibilities || '-').replace(/\n/g, '<br>') + '</div>'
                    + '<div style="grid-column:1/-1;margin-top:4px;"><strong>① 基础条件：</strong>' + self._escape(rd.basic_requirement || '-') + '</div>'
                    + '<div style="grid-column:1/-1;"><strong>② 工作经验：</strong>' + self._escape(rd.experience_requirement || '-') + '</div>'
                    + '<div style="grid-column:1/-1;"><strong>③ 专业技能：</strong>' + self._escape(rd.skill_requirement || '-') + '</div>'
                    + '<div style="grid-column:1/-1;"><strong>④ 综合素养：</strong>' + self._escape(rd.soft_requirement || '-') + '</div>'
                    + '<div><strong>薪资区间：</strong>' + (rd.salary_min || 0) + ' - ' + (rd.salary_max || 0) + ' 元/月</div>'
                    + '<div><strong>薪资结构：</strong>' + self._escape(rd.salary_structure || '-') + '</div>'
                    + '<div><strong>最迟到岗：</strong>' + (rd.arrival_year || '----') + '年' + (rd.arrival_month || '--') + '月' + (rd.arrival_day || '--') + '日</div>'
                    + '<div><strong>紧急程度：</strong>' + (urgencyText[rd.urgency] || rd.urgency) + '</div>'
                    + '<div><strong>用工性质：</strong>' + (empText[rd.employment_type] || rd.employment_type) + '</div>'
                    + (rd.special_requirements ? '<div style="grid-column:1/-1;"><strong>特殊要求：</strong>' + self._escape(rd.special_requirements) + '</div>' : '')
                    + '</div></div>';
            }

            // 物资单据：显眼展示单据号 + 复制按钮（方便申请人凭单号发起领用/领料）
            if ((d.approval_type === 'material_requirement' || d.approval_type === 'material_requisition')
                && d.form_data && d.form_data.doc_no) {
                var _docNo = String(d.form_data.doc_no);
                var _docLabel = d.approval_type === 'material_requirement' ? '物资需求单号' : '物资领用单号';
                html += '<div class="detail-item" style="grid-column:1/-1;background:#f0f9eb;border:1px solid #cdeeda;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
                    + '<label style="margin:0;"><i class="fas fa-hashtag" style="color:#16a085;"></i> ' + _docLabel + '</label>'
                    + '<span style="font-size:18px;font-weight:700;color:#16a085;letter-spacing:1px;cursor:pointer;" title="点击复制" onclick="approvalApp._copyText(\'' + this._escape(_docNo) + '\')">' + this._escape(_docNo) + '</span>'
                    + '<button class="btn btn-secondary" onclick="approvalApp._copyText(\'' + this._escape(_docNo) + '\')" title="复制单据号" style="font-size:12px;padding:3px 10px;border:1px solid #16a085;border-radius:4px;color:#16a085;background:#fff;cursor:pointer;"><i class="fas fa-copy"></i> 复制</button>'
                    + (d.approval_type === 'material_requisition' && d.form_data.requirement_doc_no ? '<span style="font-size:12px;color:#909399;">关联需求单：' + this._escape(d.form_data.requirement_doc_no) + '</span>' : '')
                    + (d.approval_type === 'material_requisition' && d.form_data.link_req
                        ? '<button class="btn btn-secondary" onclick="approvalApp._openRequirementDetail(\'' + this._escape(d.form_data.link_req.requirement_id || d.form_data.link_req.id) + '\')" title="查看需求单详情" style="font-size:12px;padding:3px 10px;border:1px solid #16a085;border-radius:4px;color:#16a085;background:#fff;cursor:pointer;"><i class="fas fa-box-open"></i> 查看需求单</button>'
                        : '')
                    + '</div>';
            }

            // 自定义审批类型 / 带表单内置类型（物资需求单/领用单）：动态表单详情
            if (!this._isBuiltinType(d.approval_type) || this._isDynamicSchemaType(d.approval_type)) {
                var dynType = this._getType(d.approval_type);
                if (dynType && dynType.form_schema && dynType.form_schema.length) {
                    html += this._renderDynamicDetail(d.form_data || {}, dynType.form_schema, d.form_data_display || {});
                }
            }

            if (d.content) html += '<div class="detail-item full-width"><label><i class="fas fa-align-left" style="color:#606266;"></i> 审批内容</label><span>' + this._escape(d.content) + '</span></div>';
            html += '</div>';

            // 审批节点进度
            if (d.approval_nodes && d.approval_nodes.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-sitemap" style="color:#67c23a;margin-right:6px;"></i>审批流程 <span style="font-size:12px;font-weight:400;color:var(--text-light,#909399);">根据汇报关系</span></h4>';
                d.approval_nodes.forEach(function (node, ni) {
                    var isFinal = !!node.is_final_approver;
                    var icon = isFinal ? 'fa-user-shield' : (node.node_type === 'department' ? 'fa-building' : (node.node_type === 'initiator' ? 'fa-play-circle' : 'fa-user-check'));
                    var label = node.user_name || node.department_name || ('节点' + (ni + 1));
                    if (node.user_name && node.user_position) label += ', ' + node.user_position;
                    var typeLabel = isFinal ? '最终审批人' : (node.node_type === 'department' ? '部门审批' : (node.node_type === 'initiator' ? '发起人' : (ni === 0 ? '直属上级' : '上级审批')));
                    var borderColor = isFinal ? '#9b59b6' : (node.node_type === 'initiator' ? 'var(--primary-color,#409eff)' : '#67c23a');
                    var iconColor = isFinal ? '#9b59b6' : (node.node_type === 'initiator' ? 'var(--primary-color,#409eff)' : '#67c23a');
                    var badgeBg = isFinal ? '#f3e8ff' : '#fff';
                    var badgeColor = isFinal ? '#9b59b6' : 'var(--text-light,#909399)';
                    var srcLabel = isFinal ? (node.final_approver_source_label || '') : '';
                    html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-secondary,#f5f7fa);border-radius:8px;border-left:3px solid ' + borderColor + ';">'
                        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><i class="fas ' + icon + '" style="color:' + iconColor + ';font-size:13px;"></i><span style="font-weight:600;font-size:14px;">' + label + '</span>'
                        + (srcLabel ? '<span style="font-size:10px;color:#9b59b6;background:#fff;border:1px solid #e8d5f5;padding:1px 8px;border-radius:4px;" title="最终审批人配置来源">' + approvalApp._escape(srcLabel) + '</span>' : '')
                        + '<span style="font-size:11px;color:' + badgeColor + ';background:' + badgeBg + ';padding:1px 8px;border-radius:4px;">' + typeLabel + '</span></div>';
                    (node.assignees || []).forEach(function (as) {
                        var stCls = as.status === 'approved' ? 'status-badge normal' : as.status === 'rejected' ? 'status-badge late' : as.status === 'deferred' ? 'status-badge deferred' : as.status === 'processing' ? 'status-badge processing' : 'badge-info';
                        var stTxt = as.status_display || (as.status === 'approved' ? '已通过' : as.status === 'rejected' ? '已驳回' : as.status === 'deferred' ? '暂缓' : as.status === 'processing' ? '办理中' : '待审批');
                        var av = as.user_avatar || defAv;
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:4px;">'
                            + '<img src="' + av + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                            + '<span style="flex:1;font-size:13px;">' + (as.user === currentUserId ? '我' : (as.user_name || '')) + (as.user_position ? '<span style="font-size:11px;color:#909399;margin-left:4px;">' + as.user_position + '</span>' : '') + (as.user_department ? '<span style="font-size:11px;color:#a0a0a0;margin-left:4px;">(' + approvalApp._escape(as.user_department) + ')</span>' : '') + '</span>'
                            + '<span class="' + stCls + '" style="font-size:11px;">' + stTxt + '</span>'
                            + (as.comment ? '<span style="font-size:12px;color:var(--text-light);">: ' + as.comment + '</span>' : '')
                            // 发起人查看自己发起的审批时，对"待审批且节点已到达"的审批人提供"发送私聊"提醒
                            + (d.applicant === currentUserId && as.status === 'pending' && as.user !== currentUserId
                                && (d.approval_mode === 'parallel' || node.order <= (d.current_node_order || 0) || node.node_type === 'initiator')
                                ? '<button type="button" onclick="approvalApp.sendApprovalPrivate(' + d.id + ',' + as.user + ',this)" style="border:1px solid #409eff;color:#409eff;background:#fff;border-radius:4px;font-size:11px;padding:2px 8px;cursor:pointer;white-space:nowrap;flex-shrink:0;line-height:1.6;" title="以私聊形式发送给该审批人，对方点击可直接处理"><i class="fas fa-comment-dots" style="margin-right:2px;"></i>发送私聊</button>'
                                : '')
                            + '</div>';
                    });
                    html += '</div>';
                });
                html += '</div>';
            }

            // 审批日志时间线
            if (d.logs && d.logs.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-history" style="color:#9b59b6;margin-right:6px;"></i>审批记录</h4>'
                    + '<div class="approval-timeline">';
                d.logs.forEach(function (log) {
                    var actionText = log.action_display || (log.action === 'approve' ? '通过' : log.action === 'reject' ? '驳回' : log.action === 'deferred' ? '暂缓' : log.action === 'processing' ? '办理中' : log.action === 'resubmit' ? '重新提交' : log.action === 'cancel' ? '撤回' : log.action === 'receipt_return' ? '票据回传' : '');

                    var operatorName = (log.operator === currentUserId) ? '我' : (log.operator_name || '系统');
                    if (log.operator_position && log.operator !== currentUserId) operatorName += ', ' + log.operator_position;
                    var attachHtml = '';
                    if (log.attachments && log.attachments.length) {
                        attachHtml = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
                        log.attachments.forEach(function (att) {
                            var url = typeof att === 'object' ? (att.url || att) : att;
                            var name = typeof att === 'object' ? (att.name || '') : url.split('/').pop() || '';
                            var isLogImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                            var isLogVideo = name.match(/\.(mp4|avi|mov|webm)$/i);
                            var isLogAudio = name.match(/\.(mp3|wav|ogg)$/i);
                            var isLogDoc = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i);
                            if (isLogImg) {
                                attachHtml += '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(name) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-block;" title="' + approvalApp._escape(name) + '"><img src="' + url + '" style="width:48px;height:48px;border-radius:4px;object-fit:cover;border:1px solid #dcdfe6;cursor:pointer;"></a>';
                            } else if (isLogVideo) {
                                attachHtml += '<div style="display:inline-block;width:140px;vertical-align:top;"><video src="' + url + '" controls style="width:100%;border-radius:4px;border:1px solid #dcdfe6;"></video></div>';
                            } else if (isLogAudio) {
                                attachHtml += '<div style="display:inline-block;width:160px;vertical-align:top;padding:4px 8px;background:#f5f7fa;border-radius:4px;border:1px solid #dcdfe6;"><audio src="' + url + '" controls style="width:100%;"></audio></div>';
                            } else if (isLogDoc) {
                                var logDocIcon = approvalApp._getFileIcon(name);
                                attachHtml += '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(name) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;background:#f0f9eb;border:1px solid #b7eb8f;border-radius:4px;text-decoration:none;font-size:11px;color:#135200;cursor:pointer;"><i class="fas ' + logDocIcon + '" style="font-size:10px;color:#135200;"></i><i class="fas fa-cloud-upload-alt" style="font-size:10px;color:#52c41a;margin-left:1px;"></i><span>' + approvalApp._escape(name) + '</span></a>';
                            } else {
                                var logOtherIcon = approvalApp._getFileIcon(name);
                                attachHtml += '<span style="display:inline-flex;align-items:center;gap:3px;"><a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(name) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;background:#fff;border:1px solid #dcdfe6;border-radius:4px;text-decoration:none;font-size:11px;color:#409eff;cursor:pointer;"><i class="fas ' + logOtherIcon + '" style="font-size:10px;"></i><span>' + approvalApp._escape(name) + '</span></a><a href="' + url + '" download="' + approvalApp._escape(name) + '" target="_blank" title="下载" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#f0f2f5;text-decoration:none;flex-shrink:0;"><i class="fas fa-cloud-download-alt" style="color:#409eff;font-size:10px;"></i></a></span>';
                            }
                        });
                        attachHtml += '</div>';
                    }
                    var signatureHtml = '';
                    if (log.signature) {
                        signatureHtml = '<div style="margin-top:6px;"><span style="font-size:11px;color:#909399;display:block;margin-bottom:2px;"><i class="fas fa-signature" style="color:#9b59b6;"></i> 手写签名</span>'
                            + '<a href="javascript:void(0)" onclick="approvalApp._previewSignature(this)" title="点击放大查看签名"><img src="' + log.signature + '" style="max-width:180px;max-height:80px;border:1px solid #e0e0e0;border-radius:4px;background:#fff;padding:4px;cursor:zoom-in;" alt="审批人签名"></a></div>';
                    }
                    html += '<div class="timeline-item ' + log.action + '">'
                        + '<div class="timeline-header">' + operatorName + (log.operator_position ? ' <span style="font-size:11px;color:var(--text-light,#909399);font-weight:400;">(' + log.operator_position + ')</span>' : '') + (log.operator_department ? ' <span style="font-size:11px;color:#a0a0a0;font-weight:400;">[' + approvalApp._escape(log.operator_department) + ']</span>' : '') + ' ' + actionText + '</div>'
                        + '<div class="timeline-time">' + (log.created_at ? new Date(log.created_at).toLocaleString() : '') + '</div>'
                        + (log.comment ? '<div class="timeline-comment">' + approvalApp._escape(log.comment) + '</div>' : '')
                        + attachHtml + signatureHtml + '</div>';
                });
                html += '</div></div>';
            }

            // 🔧 详情顶部：上一条 / 下一条（当前页列表上下文）
            var navHtml = '';
            if (this._listApprovalIds && this._listApprovalIds.length) {
                var listIdx = this._listApprovalIds.indexOf(d.id);
                if (listIdx !== -1) {
                    navHtml = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;background:linear-gradient(90deg,#ecf5ff,#f0f9eb);border-radius:8px;margin-bottom:12px;">'
                        + '<button class="btn btn-sm btn-secondary" onclick="approvalApp._navDetail(-1)"><i class="fas fa-chevron-left"></i> 上一条</button>'
                        + '<span style="font-size:13px;color:#606266;font-weight:600;">' + (listIdx + 1) + ' / ' + this._listApprovalIds.length + '</span>'
                        + '<button class="btn btn-sm btn-secondary" onclick="approvalApp._navDetail(1)">下一条 <i class="fas fa-chevron-right"></i></button>'
                        + '</div>';
                }
            }

            var detailContainer = document.getElementById(modalId);
            var bodyEl = detailContainer ? detailContainer.querySelector('.modal-body') : null;
            if (bodyEl) bodyEl.innerHTML = navHtml + html;

            // 设置副标题（截取过长标题）
            var subEl = detailContainer ? detailContainer.querySelector('.approval-detail-subtitle') : null;
            if (subEl) {
                var titleText = d.title || '';
                subEl.textContent = titleText.length > 30 ? titleText.substring(0, 27) + '...' : titleText;
            }

            // 权限判断
            var userType = localStorage.getItem('user_type');
            var isApplicant = d.applicant === currentUserId;
            var isSuperAdmin = userType === 'super_admin';
            var isApprover = false;
            var isActiveApprover = false;
            if (d.approval_nodes) {
                for (var ni = 0; ni < d.approval_nodes.length; ni++) {
                    var node = d.approval_nodes[ni];
                    if (node.node_type === 'initiator') continue;
                    // 判断此节点是否已到达（顺序审批仅当前节点，并行审批全部节点）
                    var isNodeActive = (d.approval_mode !== 'sequential') || (node.order === d.current_node_order);
                    if (node.assignees) {
                        for (var ai = 0; ai < node.assignees.length; ai++) {
                            if (node.assignees[ai].user === currentUserId) {
                                isApprover = true;
                                if (isNodeActive) isActiveApprover = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 底部按钮 — 根据角色显示
            const footer = detailContainer ? detailContainer.querySelector('.modal-footer') : null;
            if (d.status === 'pending') {
                var btns = '';
                if (isActiveApprover || isSuperAdmin) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp._openActionModal(' + d.id + ',\'approve\',\'审批通过\')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp._openActionModal(' + d.id + ',\'reject\',\'驳回审批\')"><i class="fas fa-times"></i> 驳回</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'deferred\',\'暂缓审批\')" style="border-color:#e6a23c;color:#e67e22;"><i class="fas fa-pause-circle"></i> 暂缓</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'processing\',\'正在办理\')" style="border-color:#9b59b6;color:#9b59b6;"><i class="fas fa-spinner"></i> 办理</button>';
                }
                if (isApplicant) {
                    btns += ' <button class="btn btn-secondary" onclick="approvalApp.cancelApproval(' + d.id + ')"><i class="fas fa-undo"></i> 撤销</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'cancelled') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'' + modalId + '\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 重新编辑</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.deleteDraft(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'deferred' || d.status === 'processing') {
                var btns = '';
                if (isActiveApprover || isSuperAdmin) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp._openActionModal(' + d.id + ',\'approve\',\'审批通过\')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp._openActionModal(' + d.id + ',\'reject\',\'驳回审批\')"><i class="fas fa-times"></i> 驳回</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'deferred\',\'暂缓审批\')" style="border-color:#e6a23c;color:#e67e22;"><i class="fas fa-pause-circle"></i> 暂缓</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'processing\',\'正在办理\')" style="border-color:#9b59b6;color:#9b59b6;"><i class="fas fa-spinner"></i> 办理</button>';
                }
                if (isApplicant) {
                    btns += ' <button class="btn btn-secondary" onclick="approvalApp.cancelApproval(' + d.id + ')"><i class="fas fa-undo"></i> 撤销</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'rejected') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'' + modalId + '\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 继续编辑</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'draft') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'' + modalId + '\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 继续编辑</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.deleteDraft(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else {
                footer.innerHTML = '<button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
            }


            var detailEl = document.getElementById(modalId);
            if (detailEl) {
                detailEl.style.display = 'flex';
                setTimeout(function () {
                    detailEl.classList.add('show');
                }, 10);
            }
        } catch (e) {
            console.error('加载详情失败:', e);
            var msg = (e && e.message) || '加载详情失败';
            // 审批已删除/不存在 → 给出明确提示（从工作通知/聊天跳转时尤其常见）
            if (msg.indexOf('不存在') !== -1 || msg.indexOf('删除') !== -1) {
                this.showAlert('审批已删除', '该审批已被删除或不存在，无法查看详情。');
            } else {
                this.showToast(msg, true);
            }
        }
    }

    // ==================== 附件图片预览+云文档 ====================

    /** 根据URL直接预览图片 */
    /** 预览手写签名图片（点击放大查看） */
    _previewSignature(el) {
        var img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (!img || !img.src) return;
        this._previewImageByUrl(img.src, '审批人手写签名');
    }

    _previewImageByUrl(url, name) {
        var overlay = document.createElement('div');
        overlay.id = 'approvalPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        overlay.innerHTML = '<span onclick="approvalApp._closePreview()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<img src="' + url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + approvalApp._escape(name || '') + '</div>';
        document.body.appendChild(overlay);
        this._previewImgs = null;
        this._previewOverlay = overlay;
        var self = this;
        var keyHandler = function (e) {
            if (e.key === 'Escape') {
                self._closePreview();
                e.preventDefault();
            }
        };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);
        // 🔧 点击图片/背景退出预览
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) self._closePreview();
        });
        var mainImg = overlay.querySelector('img');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function (e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                self._closePreview();
            });
        }
    }

    /** 统一附件处理：图片→预览，文档→保存到网盘并编辑，其他→保存到网盘并提示 */
    _handleAttach(el) {
        var url = el.getAttribute('data-url');
        var name = el.getAttribute('data-name') || '';
        if (!url) return;
        var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        if (isImg) {
            this._previewImageByUrl(url, name);
        } else {
            this._saveToCloudAndOpen(url, name, el);
        }
    }

    /** 保存附件到网盘，文档打开在线编辑，其他文件提示已保存 */
    async _saveToCloudAndOpen(url, name, el) {
        try {
            var resp = await fetch('/api/cloud/files/save_from_url/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({url: url, name: name || url.split('/').pop() || '文档'})
            });
            if (!resp.ok) {
                window.open(url, '_blank');
                return;
            }
            var data = await resp.json();
            if (data.file_id) {
                var isDoc = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i);
                if (isDoc) {
                    window.open('/cloud/editor/?id=' + data.file_id, '_blank');
                } else {
                    console.log('已保存到我的网盘 → 文档（来自审批）文件夹');
                    this.showToast('已保存到我的网盘 → 文档（来自审批）文件夹', false);
                    // 如果点击的元素有对应的下载图标，高亮提示
                    if (el && el.parentNode) {
                        var dnIcon = el.parentNode.querySelector('.fa-cloud-download-alt');
                        if (dnIcon) {
                            dnIcon.style.color = '#52c41a';
                            dnIcon.parentNode.style.background = '#f0f9eb';
                        }
                    }
                }
            } else {
                window.open(url, '_blank');
            }
        } catch (e) {
            window.open(url, '_blank');
        }
    }

    // ==================== 图片预览 ====================

    _previewImage(idx) {
        var urls = this._previewUrls || [];
        var _getUrl = function (u) {
            return (typeof u === 'object' && u !== null) ? (u.url || u) : u;
        };
        var _getName = function (u) {
            return (typeof u === 'object' && u !== null) ? (u.name || '') : '';
        };
        var imgs = urls.filter(function (u) {
            var fn = _getName(u) || _getUrl(u).split('/').pop() || '';
            return fn.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        });
        if (!imgs.length) return;
        var currentIdx = 0;
        for (var i = 0; i < imgs.length; i++) {
            if (urls.indexOf(imgs[i]) >= idx && urls.indexOf(imgs[i]) <= idx) {
                currentIdx = i;
                break;
            }
        }
        var overlay = document.createElement('div');
        overlay.id = 'approvalPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var prevDisplay = imgs.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="approvalApp._closePreview()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="approvalApp._previewNav(-1)" id="approvalPrevBtn" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="approvalApp._previewNav(1)" id="approvalNextBtn" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="previewMainImg" src="' + _getUrl(imgs[currentIdx]) + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div id="previewCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (currentIdx + 1) + ' / ' + imgs.length + '</div>';
        document.body.appendChild(overlay);
        this._previewImgs = imgs;
        this._previewCurrent = currentIdx;
        this._previewOverlay = overlay;
        var self = this;
        var keyHandler = function (e) {
            if (e.key === 'ArrowLeft') {
                self._previewNav(-1);
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                self._previewNav(1);
                e.preventDefault();
            } else if (e.key === 'Escape') {
                self._closePreview();
                e.preventDefault();
            }
        };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);

        // 🔧 触摸滑动：左右滑动切换图片（移动端）；双指捏合由 Utils.enableImagePinchZoom 处理
        var touchStartX = null, touchStartY = null, swiped = false;
        overlay.addEventListener('touchstart', function (e) {
            if (e.touches.length >= 2) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            swiped = false;
        }, {passive: true});
        overlay.addEventListener('touchmove', function (e) {
            if (e.touches.length >= 2) return;
            if (touchStartX !== null) {
                var dx = e.touches[0].clientX - touchStartX;
                var dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 30 || Math.abs(dy) > 30) swiped = true;
            }
        }, {passive: true});
        overlay.addEventListener('touchend', function (e) {
            if (e.changedTouches && e.changedTouches.length >= 2) { touchStartX = null; return; }
            if (touchStartX !== null) {
                var endX = e.changedTouches[0].clientX;
                var endY = e.changedTouches[0].clientY;
                var dx = endX - touchStartX, dy = endY - touchStartY;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    self._previewNav(dx < 0 ? 1 : -1);  // 左滑下一张，右滑上一张
                }
            }
            touchStartX = null;
        }, {passive: true});

        // 🔧 点击图片切换预览模式（再点一次退出）；点击背景也退出
        overlay.addEventListener('click', function (e) {
            if (swiped) {
                swiped = false;
                return;
            }  // 刚滑动过，忽略本次点击
            if (e.target === overlay) self._closePreview();
        });
        var mainImg = document.getElementById('previewMainImg');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function (e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                if (swiped) {
                    swiped = false;
                    return;
                }
                self._closePreview();
            });
        }
    }

    _closePreview() {
        if (this._previewOverlay) {
            this._previewOverlay.remove();
            this._previewOverlay = null;
        }
        if (this._previewKeyHandler) {
            document.removeEventListener('keydown', this._previewKeyHandler);
            this._previewKeyHandler = null;
        }
    }

    _previewNav(dir) {
        if (!this._previewImgs || !this._previewImgs.length) return;
        var len = this._previewImgs.length;
        if (dir < 0 && this._previewCurrent <= 0) {
            this._approvalShowTip('已是第一张');
            return;
        }
        if (dir > 0 && this._previewCurrent >= len - 1) {
            this._approvalShowTip('已是最后一张');
            return;
        }
        this._previewCurrent += dir;
        var img = document.getElementById('previewMainImg');
        var item = this._previewImgs[this._previewCurrent];
        var src = (typeof item === 'object' && item !== null) ? (item.url || item) : item;
        if (img) {
            img.src = src;
            Utils.resetImageZoom(img);
        }
        var counter = document.getElementById('previewCounter');
        if (counter) counter.textContent = (this._previewCurrent + 1) + ' / ' + this._previewImgs.length;
        var p = document.getElementById('approvalPrevBtn');
        var n = document.getElementById('approvalNextBtn');
        if (p) {
            p.style.opacity = this._previewCurrent <= 0 ? '0.2' : '1';
            p.style.cursor = this._previewCurrent <= 0 ? 'default' : 'pointer';
        }
        if (n) {
            n.style.opacity = this._previewCurrent >= this._previewImgs.length - 1 ? '0.2' : '1';
            n.style.cursor = this._previewCurrent >= this._previewImgs.length - 1 ? 'default' : 'pointer';
        }
    }

    _approvalShowTip(msg) {
        var tip = document.getElementById('approvalShowTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'approvalShowTip';
            tip.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);z-index:10002;color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:20px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.opacity = '1';
        clearTimeout(tip._t);
        tip._t = setTimeout(function () {
            tip.style.opacity = '0';
        }, 1500);
    }

    // ==================== 物资物品库管理 ====================
    openMaterialItemsModal() {
        document.getElementById('materialItemsModal').style.display = 'flex';
        setTimeout(function () { document.getElementById('materialItemsModal').classList.add('show'); }, 10);
        this._defaultMaximize('materialItemsModal');
        this._materialItemPage = 1;
        this._loadMaterialItems(1);
    }
    closeMaterialItemsModal() {
        var m = document.getElementById('materialItemsModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    }
    async _loadMaterialItems(page) {
        var tbody = document.getElementById('materialItemTableBody');
        if (!tbody) return;
        page = page || 1;
        this._materialItemPage = page;
        var kw = document.getElementById('materialItemSearch') ? document.getElementById('materialItemSearch').value.trim() : '';
        try {
            var url = OA_API_URL + '/material/items/?page=' + page + '&page_size=10';
            if (kw) url += '&search=' + encodeURIComponent(kw);
            var r = await fetch(url, {headers: TokenManager.getHeaders()});
            if (!r.ok) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; return; }
            var d = await r.json();
            var items = d.results || [];
            if (!items.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">' + (kw ? '未找到匹配物品' : '暂无物品，点击「新增物品」添加') + '</td></tr>'; this._renderMaterialItemPagination(d); return; }
            tbody.innerHTML = items.map(function (it) {
                var stock = (it.stock != null) ? Number(it.stock) : null;
                var stockHtml = stock === null ? '-'
                    : '<span style="color:' + (stock > 0 ? '#67c23a' : (stock === 0 ? '#909399' : '#f56c6c')) + ';font-weight:600;">' + stock + ' ' + approvalApp._escape(it.unit || '') + '</span>';
                return '<tr>'
                    + '<td>' + approvalApp._escape(it.name) + '</td>'
                    + '<td>' + approvalApp._escape(it.spec || '-') + '</td>'
                    + '<td>' + approvalApp._escape(it.unit || '-') + '</td>'
                    + '<td>' + approvalApp._escape(it.category || '-') + '</td>'
                    + '<td>' + approvalApp._escape(it.price || '-') + '</td>'
                    + '<td>' + stockHtml + '</td>'
                    + '<td><button class="action-btn" onclick="approvalApp._editMaterialItem(' + it.id + ')" title="编辑"><i class="fas fa-edit"></i></button>'
                    + '<button class="action-btn" style="color:#f56c6c;" onclick="approvalApp._deleteMaterialItem(' + it.id + ')" title="删除"><i class="fas fa-trash"></i></button></td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialItemPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    }
    _renderMaterialItemPagination(d) {
        var el = document.getElementById('materialItemPagination');
        if (!el) return;
        var p = (d && d.page) || 1, t = (d && d.total_pages) || 1;
        if (t <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = 'flex';
        el.innerHTML = '<span style="margin-right:10px;color:#909399;font-size:12px;">共 ' + (d.count || 0) + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<button class="pagination-btn" onclick="approvalApp._loadMaterialItems(' + (p - 1) + ')"' + (p <= 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i> 上一页</button>'
            + '<button class="pagination-btn" onclick="approvalApp._loadMaterialItems(' + (p + 1) + ')"' + (p >= t ? ' disabled' : '') + '>下一页 <i class="fas fa-chevron-right"></i></button>';
    }
    _openMaterialItemForm() {
        this._editingMaterialItem = null;
        ['miName', 'miSpec', 'miUnit', 'miCategory', 'miPrice'].forEach(function (id) { document.getElementById(id).value = ''; });
        document.getElementById('materialItemForm').style.display = 'block';
    }
    _editMaterialItem(id) {
        var self = this;
        fetch(OA_API_URL + '/material/items/' + id + '/', {headers: TokenManager.getHeaders()}).then(function (r) { return r.ok ? r.json() : null; }).then(function (it) {
            if (!it) return;
            self._editingMaterialItem = id;
            document.getElementById('miName').value = it.name || '';
            document.getElementById('miSpec').value = it.spec || '';
            document.getElementById('miUnit').value = it.unit || '';
            document.getElementById('miCategory').value = it.category || '';
            document.getElementById('miPrice').value = it.price || '';
            document.getElementById('materialItemForm').style.display = 'block';
        });
    }
    _cancelMaterialItemForm() {
        document.getElementById('materialItemForm').style.display = 'none';
        this._editingMaterialItem = null;
    }
    async _saveMaterialItem() {
        var name = document.getElementById('miName').value.trim();
        if (!name) { this.showToast('物品名称不能为空', true); return; }
        var payload = {
            name: name,
            spec: document.getElementById('miSpec').value.trim(),
            unit: document.getElementById('miUnit').value.trim(),
            category: document.getElementById('miCategory').value.trim(),
            price: document.getElementById('miPrice').value
        };
        try {
            var url = OA_API_URL + '/material/items/';
            var opts = {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify(payload)};
            if (this._editingMaterialItem) {
                url = OA_API_URL + '/material/items/' + this._editingMaterialItem + '/';
                opts = {method: 'PUT', headers: TokenManager.getHeaders(), body: JSON.stringify(payload)};
            }
            var r = await fetch(url, opts);
            if (!r.ok) { var e2 = await r.json().catch(function () { return {}; }); throw new Error(e2.error || '保存失败'); }
            this.showToast('保存成功', false);
            this._cancelMaterialItemForm();
            this._loadMaterialItems();
        } catch (e) { this.showToast(e.message || '保存失败', true); }
    }
    async _deleteMaterialItem(id) {
        var ok = await this.showConfirmDialog('删除物品', '确定删除该物品吗？', 'danger');
        if (!ok) return;
        try {
            var r = await fetch(OA_API_URL + '/material/items/' + id + '/', {method: 'DELETE', headers: TokenManager.getHeaders()});
            if (!r.ok) throw new Error('删除失败');
            this.showToast('已删除', false);
            this._loadMaterialItems();
        } catch (e) { this.showToast(e.message || '删除失败', true); }
    }

    // ==================== 物资管理（需求单/领用单） ====================
    openMaterialMgmtModal() {
        document.getElementById('materialMgmtModal').style.display = 'flex';
        setTimeout(function () { document.getElementById('materialMgmtModal').classList.add('show'); }, 10);
        this._defaultMaximize('materialMgmtModal');
        this._matTab = 'req';
        this._matPage = 1;
        var ms = document.getElementById('matSearch');
        if (ms) ms.value = '';
        this._switchMaterialTab('req');
    }
    closeMaterialMgmtModal() {
        var m = document.getElementById('materialMgmtModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    }
    _defaultMaximize(modalId) {
        var modal = document.getElementById(modalId);
        if (!modal) return;
        var content = modal.querySelector('.modal-content');
        if (content && !content.classList.contains('maximized')) {
            content.classList.add('maximized');
            var btn = modal.querySelector('.maximize-btn i');
            if (btn) btn.className = 'fas fa-compress';
        }
    }
    _switchMaterialTab(tab) {
        this._matTab = tab;
        this._matPage = 1;
        document.querySelectorAll('.mat-tab-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
        document.getElementById('matReqPanel').style.display = tab === 'req' ? 'block' : 'none';
        document.getElementById('matReqsnPanel').style.display = tab === 'reqsn' ? 'block' : 'none';
        if (tab === 'req') this._loadMaterialRequirements(1);
        else this._loadMaterialRequisitions(1);
    }
    _onMaterialSearch() {
        var self = this;
        clearTimeout(this._matSearchTimer);
        this._matSearchTimer = setTimeout(function () {
            self._matPage = 1;
            if (self._matTab === 'req') self._loadMaterialRequirements(1);
            else self._loadMaterialRequisitions(1);
        }, 300);
    }
    _reloadMaterialTab() {
        var page = this._matPage || 1;
        if (this._matTab === 'req') this._loadMaterialRequirements(page);
        else this._loadMaterialRequisitions(page);
    }
    _matPageGo(page) {
        if (this._matTab === 'req') this._loadMaterialRequirements(page);
        else this._loadMaterialRequisitions(page);
    }
    _renderMaterialPagination(data) {
        var el = document.getElementById('matPagination');
        if (!el) return;
        var p = (data && data.page) || 1, t = (data && data.total_pages) || 1;
        if (t <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = 'flex';
        el.innerHTML = '<span style="margin-right:10px;color:#909399;font-size:12px;">共 ' + (data.count || 0) + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<button class="pagination-btn" onclick="approvalApp._matPageGo(' + (p - 1) + ')"' + (p <= 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i> 上一页</button>'
            + '<button class="pagination-btn" onclick="approvalApp._matPageGo(' + (p + 1) + ')"' + (p >= t ? ' disabled' : '') + '>下一页 <i class="fas fa-chevron-right"></i></button>';
    }
    _renderMatStatus(status, kind) {
        var reqMap = {
            pending: ['#909399', '待审批'],
            approved: ['#e6a23c', '已通过(待采购)'],
            purchasing: ['#409eff', '采购中'],
            stocked: ['#67c23a', '已入库(可领用)'],
            rejected: ['#f56c6c', '已驳回']
        };
        var reqsnMap = {
            pending: ['#909399', '待审批'],
            approved: ['#67c23a', '已通过(可领用)'],
            rejected: ['#f56c6c', '已驳回']
        };
        var map = kind === 'reqsn' ? reqsnMap : reqMap;
        var c = map[status] || ['#909399', status];
        return '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;color:#fff;background:' + c[0] + ';">' + this._escape(c[1]) + '</span>';
    }
    async _loadMaterialRequirements(page) {
        var tbody = document.getElementById('matReqTbody');
        if (!tbody) return;
        page = page || 1;
        this._matPage = page;
        var search = document.getElementById('matSearch') ? document.getElementById('matSearch').value.trim() : '';
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';
        try {
            var url = OA_API_URL + '/material/requirements/?page=' + page + '&page_size=10';
            if (search) url += '&search=' + encodeURIComponent(search);
            var d = await this.apiGet(url);
            if (!d) return;
            var list = d.results || [];
            if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">' + (search ? '未找到匹配的需求单' : '暂无物资需求单') + '</td></tr>'; this._renderMaterialPagination(d); return; }
            var self = this;
            tbody.innerHTML = list.map(function (it) {
                var actions = '';
                if (it.status === 'approved') {
                    actions += '<button class="action-btn" title="确认采购" onclick="approvalApp._changeRequirementStatus(' + it.id + ',\'purchasing\')"><i class="fas fa-cart-arrow-down" style="color:#409eff;"></i></button>';
                    actions += '<button class="action-btn" title="确认入库" onclick="approvalApp._changeRequirementStatus(' + it.id + ',\'stocked\')"><i class="fas fa-warehouse" style="color:#67c23a;"></i></button>';
                } else if (it.status === 'purchasing') {
                    actions += '<button class="action-btn" title="确认入库" onclick="approvalApp._changeRequirementStatus(' + it.id + ',\'stocked\')"><i class="fas fa-warehouse" style="color:#67c23a;"></i></button>';
                } else if (it.status === 'stocked') {
                    actions += '<span style="font-size:11px;color:#67c23a;"><i class="fas fa-check-circle"></i> 可领用</span>';
                }
                if (it.request_id) {
                    actions += '<button class="action-btn" title="查看审批" onclick="approvalApp.showDetail(' + it.request_id + ')"><i class="fas fa-eye"></i></button>';
                }
                return '<tr>'
                    + '<td style="font-weight:600;color:#16a085;">' + self._escape(it.doc_no) + '</td>'
                    + '<td>' + self._escape(it.branch_dept || '-') + '</td>'
                    + '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + self._escape(it.purpose) + '">' + self._escape(it.purpose || '-') + '</td>'
                    + '<td>' + self._renderMatStatus(it.status, 'req') + '</td>'
                    + '<td>' + it.item_count + ' 项 / 剩余 ' + it.remaining + '</td>'
                    + '<td>' + self._escape(it.applicant || '-') + '</td>'
                    + '<td>' + self._escape(it.created_at || '-') + '</td>'
                    + '<td>' + (actions || '-') + '</td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    }
    async _loadMaterialRequisitions(page) {
        var tbody = document.getElementById('matReqsnTbody');
        if (!tbody) return;
        page = page || 1;
        this._matPage = page;
        var search = document.getElementById('matSearch') ? document.getElementById('matSearch').value.trim() : '';
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';
        try {
            var url = OA_API_URL + '/material/requisitions/?page=' + page + '&page_size=10';
            if (search) url += '&search=' + encodeURIComponent(search);
            var d = await this.apiGet(url);
            if (!d) return;
            var list = d.results || [];
            if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">' + (search ? '未找到匹配的领用单' : '暂无物资领用单') + '</td></tr>'; this._renderMaterialPagination(d); return; }
            var self = this;
            tbody.innerHTML = list.map(function (it) {
                var actions = it.request_id ? '<button class="action-btn" title="查看审批" onclick="approvalApp.showDetail(' + it.request_id + ')"><i class="fas fa-eye"></i></button>' : '-';
                return '<tr>'
                    + '<td style="font-weight:600;color:#e6a23c;">' + self._escape(it.doc_no) + '</td>'
                    + '<td style="font-weight:600;color:#16a085;">' + self._escape(it.requirement_doc_no || '-') + '</td>'
                    + '<td>' + self._escape(it.branch_dept || '-') + '</td>'
                    + '<td>' + self._renderMatStatus(it.status, 'reqsn') + '</td>'
                    + '<td>' + it.item_count + ' 项</td>'
                    + '<td>' + self._escape(it.applicant || '-') + '</td>'
                    + '<td>' + self._escape(it.created_at || '-') + '</td>'
                    + '<td>' + actions + '</td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    }
    async _changeRequirementStatus(id, status) {
        var label = status === 'stocked' ? '确认该需求单已采购入库，之后可被领用' : '将该需求单标记为采购中';
        var ok = await this.showConfirmDialog('需求单状态流转', label + '？', 'confirm');
        if (!ok) return;
        try {
            var r = await fetch(OA_API_URL + '/material/requirement-status/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({id: id, status: status})
            });
            if (!r.ok) { var e2 = await r.json().catch(function () { return {}; }); throw new Error(this._extractApiError(e2)); }
            this.showToast('已更新', false);
            this._loadMaterialRequirements();
        } catch (e) { this.showToast(e.message || '更新失败', true); }
    }

    async _openRequirementDetail(rid) {
        try {
            var d = await this.apiGet(OA_API_URL + '/material/requirement-detail/?id=' + rid);
            if (!d) return;
            var body = document.getElementById('matReqDetailBody');
            var itemsHtml = (d.items || []).map(function (i) {
                var price = (i.price != null && i.price !== '') ? Number(i.price) : null;
                var totalAmt = (price != null) ? (price * (Number(i.quantity) || 0)).toFixed(2) : '-';
                return '<tr><td>' + approvalApp._escape(i.item_name) + '</td>'
                    + '<td>' + approvalApp._escape(i.spec || '-') + '</td>'
                    + '<td>' + approvalApp._escape(i.unit || '-') + '</td>'
                    + '<td style="text-align:right;">' + (price != null ? price.toFixed(2) : '-') + '</td>'
                    + '<td style="text-align:right;">' + i.quantity + '</td>'
                    + '<td style="text-align:right;color:#e6a23c;font-weight:600;">' + totalAmt + '</td>'
                    + '<td style="color:#67c23a;font-weight:600;">' + i.remaining + '</td></tr>';
            }).join('') || '<tr><td colspan="7" style="text-align:center;color:#909399;">无明细</td></tr>';
            body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px;">'
                + '<div><strong>需求单号：</strong><span style="color:#16a085;font-weight:700;">' + approvalApp._escape(d.doc_no) + '</span></div>'
                + '<div><strong>状态：</strong>' + approvalApp._renderMatStatus(d.status, 'req') + '</div>'
                + '<div><strong>分公司：</strong>' + approvalApp._escape(d.branch_dept || '-') + '</div>'
                + '<div><strong>申请人：</strong>' + approvalApp._escape(d.applicant || '-') + '</div>'
                + '<div><strong>预估金额：</strong><span style="color:#e6a23c;font-weight:700;">¥' + (d.amount != null && d.amount !== '' ? (Number(d.amount)).toFixed(2) : '-') + '</span></div>'
                + '<div><strong>用途：</strong>' + approvalApp._escape(d.purpose || '-') + '</div>'
                + '</div>'
                + '<table class="oa-table"><thead><tr><th>物品名称</th><th>规格</th><th>单位</th><th>单价</th><th>数量</th><th>金额</th><th>剩余可领</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>';
            // 提升层级：在审批详情（z-index 3000）之上打开
            document.getElementById('materialReqDetailModal').style.zIndex = '3500';
            document.getElementById('materialReqDetailModal').style.display = 'flex';
            setTimeout(function () { document.getElementById('materialReqDetailModal').classList.add('show'); }, 10);
        } catch (e) { this.showToast('加载需求单详情失败', true); }
    }
    closeRequirementDetailModal() {
        var m = document.getElementById('materialReqDetailModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    }

    // 详情模态框：上一条 / 下一条切换（到本页首/末条时提示并引导翻页）
    _navDetail(delta) {
        if (!this._listApprovalIds || !this._listApprovalIds.length) return;
        var idx = this._listApprovalIds.indexOf(this._detailApprovalId);
        if (idx === -1) return;
        var total = this._listTotalPages || 1;
        if (delta < 0 && idx === 0) {
            this.showToast('已经是本页第一条审批了，当前第 ' + this.currentPage + '/' + total + ' 页，如需查看更多请翻页', true);
            return;
        }
        if (delta > 0 && idx === this._listApprovalIds.length - 1) {
            this.showToast('已经是本页最后一条审批了，当前第 ' + this.currentPage + '/' + total + ' 页，如需查看更多请翻页', true);
            return;
        }
        var next = this._listApprovalIds[idx + delta];
        if (next == null) return;
        this.showDetail(next);
    }

    // ==================== 打印 ====================
    _printDetail() {
        var self = this;
        var gate = function () {
            var modalId = self._detailModalId || 'approvalDetailModal';
            var modal = document.getElementById(modalId);
            if (!modal) return;
            var bodyEl = modal.querySelector('.modal-body');
            if (!bodyEl || !bodyEl.innerHTML.trim()) {
                self.showToast('没有可打印的审批内容', true);
                return;
            }
        // 用独立隐藏iframe承载打印内容，避免打印整个页面时等待无关资源（字体/CDN/其他弹窗图片）导致一直加载
        var old = document.getElementById('approvalPrintFrame');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var iframe = document.createElement('iframe');
        iframe.id = 'approvalPrintFrame';
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
        document.body.appendChild(iframe);

        var css = '@page{margin:12mm 15mm;}'
            + '*{box-sizing:border-box;}'
            + 'body{font-family:"Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif;color:#333;background:#fff;font-size:14px;line-height:1.6;}'
            + 'i{display:none!important;}'
            + '.detail-grid{display:block!important;}'
            + '.detail-item{display:flex;padding:6px 0;border-bottom:1px solid #eee;page-break-inside:avoid;}'
            + '.detail-item label{width:110px;min-width:110px;font-size:12px;color:#888;font-weight:600;padding-right:12px;flex-shrink:0;}'
            + '.detail-item span{flex:1;font-size:14px;color:#333;}'
            + '.detail-item.full-width{display:block;}'
            + '.detail-item.full-width label{display:block;width:auto;margin-bottom:4px;}'
            + '.detail-item.full-width span{display:block;}'
            + '.approval-timeline{margin-top:16px;page-break-inside:avoid;}'
            + '.timeline-item{padding:6px 0 6px 20px;border-left:2px solid #ddd;margin-left:4px;page-break-inside:avoid;}'
            + '.timeline-item::before{left:-6px;top:10px;width:10px;height:10px;}'
            + '.timeline-header{font-size:13px;font-weight:600;color:#333;}'
            + '.timeline-time{font-size:11px;color:#999;}'
            + '.timeline-comment{font-size:12px;color:#666;padding:6px 10px;background:#f8f8f8;border-radius:4px;margin-top:4px;}'
            + 'h4{font-size:15px;margin:20px 0 12px!important;padding-top:16px;border-top:2px solid #333;}'
            + '.status-badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;}'
            + '.status-badge.normal{background:#f0f9eb;color:#67c23a;}'
            + '.status-badge.late{background:#fef0f0;color:#f56c6c;}'
            + '.badge-info{background:#e3f2fd;color:#1976d2;}'
            + '.badge-default{background:#f5f5f5;color:#999;}'
            + '.status-badge.deferred{background:#fdf6ec;color:#e6a23c;}'
            + '.status-badge.processing{background:#f3e8ff;color:#9b59b6;}'
            + 'img[onclick],img[alt="审批人签名"]{max-width:120px!important;max-height:120px!important;}'
            + 'a[href]{color:#409eff!important;text-decoration:underline!important;}'
            + '.btn{display:none!important;}'
            + 'video,audio{display:none!important;}'
            + '.detail-item a[target="_blank"]{display:inline-flex!important;align-items:center;padding:4px 8px;background:#f5f7fa;border-radius:4px;font-size:11px;color:#666!important;text-decoration:none!important;max-width:180px;}'
            + '.detail-item a[target="_blank"] i{display:inline!important;color:#409eff!important;margin-right:4px;}'
            + '.detail-item a[target="_blank"] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';

        var doc = iframe.contentDocument;
        doc.open();
        // 🔧 打印默认叠加水印（由管理控制台「打印时添加水印」开关控制）
        var wm = (window.WatermarkManager && WatermarkManager.buildPrintWatermark) ? WatermarkManager.buildPrintWatermark() : null;
        var printCss = wm ? css + wm.css : css;
        var printBody = wm ? bodyEl.innerHTML + wm.html : bodyEl.innerHTML;
        doc.write('<html><head><meta charset="utf-8"><title>审批详情打印</title><style>' + printCss + '</style></head><body>' + printBody + '</body></html>');
        doc.close();

        // 图片加载失败时直接隐藏，避免打印预览一直等待
        var imgs = doc.getElementsByTagName('img');
        for (var i = 0; i < imgs.length; i++) {
            imgs[i].onerror = function () { this.style.display = 'none'; };
        }

        var printed = false;
        function doPrint() {
            if (printed) return;
            printed = true;
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (e) {}
            setTimeout(function () {
                if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 3000);
        }
            // 等资源加载完再打印；超时强制打印，避免卡死
            var force = setTimeout(doPrint, 1200);
            iframe.onload = function () {
                clearTimeout(force);
                setTimeout(doPrint, 150);
            };
        };
        // 🔧 打印权限门：先上报打印并校验「允许打印」权限，无权限则拦截
        if (window.WatermarkManager && WatermarkManager.reportPrint) {
            WatermarkManager.reportPrint({page: 'approval', target_type: 'approval', target_id: self._detailApprovalId || ''}).then(function (res) {
                if (res && res.allowed === false) {
                    self.showToast('您没有打印权限，请联系管理员开通', true);
                    return;
                }
                gate();
            });
        } else {
            gate();
        }
    }

    // ==================== 审批操作 ====================

    _openActionModal(id, action, actionLabel) {
        this._actionId = id;
        this._actionType = action;
        this._actionLabel = actionLabel;
        this._actionAttachments = [];
        var modal = document.getElementById('actionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'actionModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:500px;">'
                + '<div class="modal-header"><h3 id="actionModalTitle"><i class="fas fa-check-circle" style="color:#409eff;"></i> 审批反馈</h3>'
                + '<button class="close-btn" onclick="approvalApp.closeModal(\'actionModal\')">&times;</button></div>'
                + '<div class="modal-body">'
                + '<p style="font-size:14px;color:#606266;margin-bottom:10px;">请填写审批意见：</p>'
                + '<textarea id="actionComment" class="form-textarea" rows="4" placeholder="请输入审批意见..." style="width:100%;min-height:80px;"></textarea>'
                + '<div style="margin-top:12px;"><label style="font-size:13px;font-weight:500;display:block;margin-bottom:6px;"><i class="fas fa-paperclip"></i> 附件</label>'
                + '<div style="display:flex;gap:8px;align-items:center;">'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._triggerActionUpload()" style="font-size:12px;padding:6px 12px;"><i class="fas fa-paperclip"></i> 选择文件</button>'
                + '<input type="file" id="actionFileInput" style="display:none;" accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.zip,.mp4,.avi,.mov,.mp3,.wav" onchange="approvalApp._handleActionFileSelect(event)">'
                + '<span style="font-size:11px;color:#909399;">支持 jpg/png/pdf/doc/zip/mp4等，不超过10MB</span></div>'
                + '<div id="actionAttachmentPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div></div>'
                + '<p id="actionError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '<div id="actionSignatureWrap" style="display:none;margin-top:12px;">'
                + '<label style="font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;margin-bottom:6px;"><i class="fas fa-signature" style="color:#9b59b6;"></i> 手写签名 <span style="font-weight:400;font-size:11px;color:#f56c6c;">（必填）</span>'
                + '<button type="button" onclick="approvalApp._toggleSignatureFullscreen()" id="actionSignatureFullscreenBtn" style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1px solid #9b59b6;border-radius:4px;background:#f9f0ff;color:#9b59b6;font-size:11px;cursor:pointer;"><i class="fas fa-expand"></i> 全屏</button></label>'
                + '<div id="actionSignatureBox" style="border:1px dashed #9b59b6;border-radius:8px;overflow:hidden;position:relative;background:#fff;height:180px;">'
                + '<canvas id="actionSignatureCanvas" width="900" height="360" style="width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;"></canvas>'
                + '<div id="actionSignaturePlaceholder" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;color:#c0c4cc;font-size:14px;pointer-events:none;">请在此手写签名</div>'
                + '<button type="button" id="actionSignatureExitFullscreen" onclick="approvalApp._toggleSignatureFullscreen()" style="display:none;position:absolute;top:10px;right:10px;z-index:10;align-items:center;gap:5px;padding:6px 14px;border:1px solid #dcdfe6;border-radius:6px;background:rgba(255,255,255,0.92);color:#606266;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.12);"><i class="fas fa-compress"></i> 退出全屏</button>'
                + '<div id="actionSignatureFullActions" style="display:none;position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:10;gap:10px;align-items:center;background:rgba(255,255,255,0.95);border:1px solid #dcdfe6;border-radius:8px;padding:6px 10px;box-shadow:0 2px 12px rgba(0,0,0,0.15);">'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._rotateSignatureFullscreen()" id="actionSignatureRotateBtn" style="font-size:12px;padding:5px 12px;"><i class="fas fa-redo-alt"></i> 旋转</button>'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._clearSignature()" style="font-size:12px;padding:5px 14px;"><i class="fas fa-eraser"></i> 清除</button>'
                + '<button type="button" class="btn btn-primary" onclick="approvalApp._confirmSignatureFullscreen()" style="font-size:12px;padding:5px 18px;"><i class="fas fa-check"></i> 确定</button>'
                + '</div>'
                + '</div>'
                + '<div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap;">'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._clearSignature()" style="font-size:12px;padding:4px 12px;"><i class="fas fa-eraser"></i> 清除</button>'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._toggleSignatureFullscreen()" style="font-size:12px;padding:4px 12px;"><i class="fas fa-expand"></i> 全屏签名</button>'
                + '<span style="font-size:11px;color:#909399;">支持鼠标或手指书写</span></div>'
                + '</div>'
                + '<div id="actionNotifyReceiptWrap" style="display:none;margin-top:12px;padding:10px 12px;background:#f4fdf9;border:1px solid #d1f2eb;border-radius:8px;">'
                + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:#16a085;">'
                + '<input type="checkbox" id="actionNotifyReceipt" style="width:16px;height:16px;cursor:pointer;">'
                + '<span><i class="fas fa-bell" style="margin-right:2px;"></i> 通知发起人回传票据</span></label>'
                + '<div style="font-size:11px;color:#909399;margin-top:4px;">开启后，通过审批时会向发起人发送「请及时回传票据/凭证」的工作通知</div></div>'
                + '</div>'
                + '<div class="modal-footer" id="actionModalFooter">'
                + '<button class="btn btn-secondary" onclick="approvalApp.closeModal(\'actionModal\')">取消</button>'
                + '<button class="btn btn-primary" id="actionConfirmBtn" onclick="approvalApp._confirmAction()"><i class="fas fa-check"></i> 确定</button></div></div>';
            document.body.appendChild(modal);
        }
        document.getElementById('actionComment').value = '';
        document.getElementById('actionAttachmentPreview').innerHTML = '';
        this._actionAttachments = [];
        this._actionSignatureData = '';
        this._signatureRequired = false;
        // Reset signature pad
        var sigWrap = document.getElementById('actionSignatureWrap');
        if (sigWrap) sigWrap.style.display = 'none';
        var sigBox = document.getElementById('actionSignatureBox');
        if (sigBox) {
            sigBox.classList.remove('sig-fullscreen');
            sigBox.classList.remove('sig-rotate');
        }
        var sigExit = document.getElementById('actionSignatureExitFullscreen');
        if (sigExit) sigExit.style.display = 'none';
        var sigTopBtn = document.getElementById('actionSignatureFullscreenBtn');
        if (sigTopBtn) sigTopBtn.style.display = 'inline-flex';
        var sigCanvas = document.getElementById('actionSignatureCanvas');
        if (sigCanvas) this._resetSignatureCanvas(sigCanvas);
        var titleEl = document.getElementById('actionModalTitle');
        if (titleEl) {
            var icon = action === 'approve' ? 'fa-check-circle' : action === 'reject' ? 'fa-times-circle' : action === 'deferred' ? 'fa-pause-circle' : 'fa-spinner';
            var color = action === 'reject' ? '#f56c6c' : action === 'deferred' ? '#e6a23c' : action === 'processing' ? '#9b59b6' : '#67c23a';
            titleEl.innerHTML = '<i class="fas ' + icon + '" style="color:' + color + ';"></i> ' + actionLabel;
        }
        var footer = document.getElementById('actionModalFooter');
        if (footer) {
            var confirmBtn = footer.querySelector('#actionConfirmBtn');
            if (confirmBtn) {
                confirmBtn.innerHTML = '<i class="fas fa-check"></i> ' + (action === 'reject' ? '驳回' : action === 'deferred' ? '暂缓' : action === 'processing' ? '开始办理' : '通过');
                confirmBtn.className = 'btn ' + (action === 'reject' ? 'btn-danger' : action === 'deferred' ? 'btn-secondary' : 'btn-primary');
            }
        }
        // 判断是否需要手写签名（仅通过审批时）
        this._signatureRequired = false;
        if (action === 'approve') {
            var reqSig = this._currentApprovalRequireSignature;
            if (reqSig) {
                this._signatureRequired = true;
                var sigWrap = document.getElementById('actionSignatureWrap');
                if (sigWrap) sigWrap.style.display = 'block';
            }
        }
        // 「通知发起人回传票据」开关：仅当该审批类型开启票据回传且操作为通过时显示
        var notifyWrap = document.getElementById('actionNotifyReceiptWrap');
        if (notifyWrap) notifyWrap.style.display = (action === 'approve' && this._currentApprovalEnableReceipt) ? 'block' : 'none';
        var notifyCb = document.getElementById('actionNotifyReceipt');
        if (notifyCb) notifyCb.checked = false;
        // 提升详情层级，保证在物资管理/物品库等其它模态框之上打开（不关闭下层模态框）
        modal.style.zIndex = '3000';
        modal.style.display = 'flex';
        setTimeout(function () {
            modal.classList.add('show');
        }, 10);
    }

    async _triggerActionUpload() {
        document.getElementById('actionFileInput').click();
    }

    async _handleActionFileSelect(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > this.fileMaxSizeMB * 1024 * 1024) {
            console.log('文件大小超过限制::', file.size);
            this.showAlert('提示', `文件大小不能超过${this.fileMaxSizeMB}MB`);
            return;
        }
        var formData = new FormData();
        formData.append('file', file);
        try {
            var resp = await fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: formData
            });
            if (!resp.ok) {
                var errData = await resp.json().catch(function () {
                    return {};
                });
                throw new Error(errData.error || errData.detail || '上传失败');
            }
            var result = await resp.json();
            if (result.url) {
                if (!this._actionAttachments) this._actionAttachments = [];
                this._actionAttachments.push({url: result.url, name: result.name || file.name});
                this._renderActionAttachments();
            }
        } catch (e) {
            this.showAlert('错误', '附件上传失败');
        }
    }

    _renderActionAttachments() {
        var container = document.getElementById('actionAttachmentPreview');
        if (!container) return;
        container.innerHTML = (this._actionAttachments || []).map(function (a) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:#f5f7fa;border-radius:4px;font-size:12px;">'
                + '<i class="fas fa-paperclip" style="color:#409eff;"></i>'
                + '<span>' + approvalApp._escape(a.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:10px;" onclick="var idx=approvalApp._actionAttachments.findIndex(function(x){return x.url===\'' + a.url + '\'});if(idx>-1){approvalApp._actionAttachments.splice(idx,1);approvalApp._renderActionAttachments();}"></i></span>';
        }).join('') || '';
    }

    async _confirmAction() {
        var id = this._actionId;
        var action = this._actionType;
        if (!id || !action) return;
        var comment = document.getElementById('actionComment').value.trim();
        var data = {comment: comment};
        if (this._actionAttachments && this._actionAttachments.length) {
            data.attachments = this._actionAttachments;
        }
        // 校验手写签名
        if (this._signatureRequired && action === 'approve') {
            var sigCanvas = document.getElementById('actionSignatureCanvas');
            if (!this._actionSignatureData || !sigCanvas) {
                this.showAlert('提示', '请先完成手写签名');
                return;
            }
            data.signature = this._signatureWithTimestamp(sigCanvas);
        }

        if (action === 'approve') {
            var confirmed = await this.showConfirmDialog('确认发送私聊卡片', '是否确认通过审批？', 'confirm');
            if (!confirmed) return;
            // 「通知发起人回传票据」开关：开启才让后端发送请及时回传票据/凭证通知
            var notifyCb = document.getElementById('actionNotifyReceipt');
            if (notifyCb && notifyCb.checked) data.notify_receipt_return = true;
        }

        try {
            await this.apiPost(OA_API_URL + '/approval/' + id + '/' + action + '/', data);
            this.closeModal('actionModal');
            this.showToast('操作成功', false);
            // 🔧 操作成功后不关闭详情模态框：刷新列表，并展示一条仍在当前列表中的审批，保证「上一条/下一条」导航可用。
            //    若当前审批已被过滤移除（如 待我审批/待审批 下处理完），则自动切到列表第一条（下一条待办）继续审批。
            await this.loadList(this.currentPage);
            const _navIds = this._listApprovalIds || [];
            const _navIdx = _navIds.indexOf(id);
            if (_navIdx === -1 && _navIds.length) {
                this.showToast('开始下一条审批！', false);
                this.showDetail(_navIds[0]);
            } else {
                this.showDetail(id);
            }
        } catch (e) {
            console.error('操作失败:', e);
            // this.showAlert('操作失败', e.message || '请重试');
            this.showToast(('操作失败' + e.message || '请重试'), true);
        }
    }

    // ==================== 手写签名面板 ====================

    _resetSignatureCanvas(canvas) {
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // 绑定绘制事件（鼠标+触摸）
        var self = this;
        canvas._drawing = false;
        canvas._lastX = 0;
        canvas._lastY = 0;
        canvas.onmousedown = function (e) {
            self._sigStart(e, canvas);
        };
        canvas.onmousemove = function (e) {
            self._sigMove(e, canvas);
        };
        canvas.onmouseup = function (e) {
            self._sigEnd(e, canvas);
        };
        canvas.onmouseleave = function (e) {
            self._sigEnd(e, canvas);
        };
        canvas.ontouchstart = function (e) {
            e.preventDefault();
            self._sigStart(e, canvas);
        };
        canvas.ontouchmove = function (e) {
            e.preventDefault();
            self._sigMove(e, canvas);
        };
        canvas.ontouchend = function (e) {
            e.preventDefault();
            self._sigEnd(e, canvas);
        };
        var placeholder = document.getElementById('actionSignaturePlaceholder');
        if (placeholder) placeholder.style.display = 'flex';
    }

    _getSigPos(e, canvas) {
        var rect = canvas.getBoundingClientRect();
        var clientX = e.touches && e.touches.length ? e.touches[0].clientX : (e.clientX || 0);
        var clientY = e.touches && e.touches.length ? e.touches[0].clientY : (e.clientY || 0);
        // 全屏旋转90度时：画布视觉宽高互换，需按旋转后的坐标空间反向映射，
        // 保证书写内容与旋正时一致、无拉伸变形
        var box = document.getElementById('actionSignatureBox');
        var rotated = box && box.classList.contains('sig-rotate');
        if (rotated) {
            // 90度顺时针旋转：局部x → 屏幕向下(y)，局部y → 屏幕向左(x)
            var nx = (clientX - rect.left) / rect.width;
            var ny = (clientY - rect.top) / rect.height;
            return {
                x: ny * canvas.width,
                y: (1 - nx) * canvas.height
            };
        }
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    _sigStart(e, canvas) {
        canvas._drawing = true;
        var pos = this._getSigPos(e, canvas);
        canvas._lastX = pos.x;
        canvas._lastY = pos.y;
        this._actionSignatureData = 'drawn';
        var placeholder = document.getElementById('actionSignaturePlaceholder');
        if (placeholder) placeholder.style.display = 'none';
    }

    _sigMove(e, canvas) {
        if (!canvas._drawing) return;
        var pos = this._getSigPos(e, canvas);
        var ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(canvas._lastX, canvas._lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        canvas._lastX = pos.x;
        canvas._lastY = pos.y;
    }

    _sigEnd(e, canvas) {
        canvas._drawing = false;
    }

    _clearSignature() {
        var canvas = document.getElementById('actionSignatureCanvas');
        if (!canvas) return;
        this._actionSignatureData = '';
        this._resetSignatureCanvas(canvas);
    }

    /** 在签名下方自动添加日期时间与审批人信息，返回合成后的 dataURL */
    _signatureWithTimestamp(canvas) {
        var w = canvas.width;
        var h = canvas.height;
        var stampH = Math.round(h * 0.18); // 底部信息区高度（时间戳+审批人）
        var tsCanvas = document.createElement('canvas');
        tsCanvas.width = w;
        tsCanvas.height = h + stampH;
        var ctx = tsCanvas.getContext('2d');
        // 白色背景
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, tsCanvas.width, tsCanvas.height);
        // 绘制原签名
        ctx.drawImage(canvas, 0, 0);
        // 底部信息区：浅灰分割线 + 审批人 + 日期时间
        var now = new Date();
        var pad = function (n) {
            return String(n).padStart(2, '0');
        };
        var dateStr = '审批时间：' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
            + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        // 获取当前用户（审批人）姓名
        var approverName = '';
        try {
            var cu = JSON.parse(localStorage.getItem('current_user') || 'null');
            approverName = (cu && (cu.real_name || cu.username)) ? (cu.real_name || cu.username) : '';
        } catch (e) {
        }
        var lineY = h + 2;
        ctx.strokeStyle = '#c0c4cc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(w, lineY);
        ctx.stroke();
        var fontPx = Math.round(h * 0.065);
        ctx.fillStyle = '#606266';
        ctx.font = fontPx + 'px "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'middle';
        // 审批人：靠左
        ctx.textAlign = 'left';
        var nameStr = '审批人：' + approverName;
        ctx.fillText(nameStr, 16, h + stampH / 2);
        // 日期时间：靠右
        ctx.textAlign = 'right';
        ctx.fillText(dateStr, w - 16, h + stampH / 2);
        return tsCanvas.toDataURL('image/png');
    }

    _toggleSignatureFullscreen() {
        var box = document.getElementById('actionSignatureBox');
        var btn = document.getElementById('actionSignatureFullscreenBtn');
        var exitBtn = document.getElementById('actionSignatureExitFullscreen');
        var fullActions = document.getElementById('actionSignatureFullActions');
        var rotateBtn = document.getElementById('actionSignatureRotateBtn');
        var canvas = document.getElementById('actionSignatureCanvas');
        if (!box) return;
        var isFull = box.classList.toggle('sig-fullscreen');
        // 全屏默认不自动旋转；退出全屏时清除旋转状态（回正）
        if (!isFull) {
            box.classList.remove('sig-rotate');
        }
        if (canvas && !this._actionSignatureData) {
            this._resetSignatureCanvas(canvas);
        }
        // 顶部全屏按钮：全屏时隐藏（框内按钮接管）
        if (btn) btn.style.display = isFull ? 'none' : 'inline-flex';
        // 框内退出全屏按钮：仅全屏时显示
        if (exitBtn) exitBtn.style.display = isFull ? 'inline-flex' : 'none';
        // 全屏操作栏（清除/确定）：仅全屏时显示
        if (fullActions) {
            fullActions.style.display = isFull ? 'inline-flex' : 'none';
        }
        // 旋转按钮：仅全屏时显示，初始图标随当前旋转状态
        if (rotateBtn) {
            rotateBtn.style.display = isFull ? 'inline-flex' : 'none';
            if (isFull) this._updateRotateBtnIcon();
        }
        // 下方"全屏签名"按钮文字
        var allBtns = document.querySelectorAll('#actionSignatureWrap button[onclick*="_toggleSignatureFullscreen"]');
        allBtns.forEach(function (b) {
            if (b !== btn) {
                b.innerHTML = isFull ? '<i class="fas fa-compress"></i> 退出全屏' : '<i class="fas fa-expand"></i> 全屏签名';
            }
        });
    }

    /** 旋转按钮：点击后输入区域旋转90度铺满全屏，再次点击回正 */
    _rotateSignatureFullscreen() {
        var box = document.getElementById('actionSignatureBox');
        if (!box) return;
        box.classList.toggle('sig-rotate');
        this._updateRotateBtnIcon();
    }

    /** 更新旋转按钮图标（横竖屏状态提示） */
    _updateRotateBtnIcon() {
        var rotateBtn = document.getElementById('actionSignatureRotateBtn');
        if (!rotateBtn) return;
        var box = document.getElementById('actionSignatureBox');
        var isRotated = box && box.classList.contains('sig-rotate');
        rotateBtn.innerHTML = isRotated
            ? '<i class="fas fa-undo"></i> 回正'
            : '<i class="fas fa-redo-alt"></i> 旋转';
        rotateBtn.title = isRotated ? '旋转回正' : '旋转90度铺满屏幕';
    }

    /** 全屏签名确定：退出全屏（签名已保留在画布，方向自动回正） */
    _confirmSignatureFullscreen() {
        this._toggleSignatureFullscreen();
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            // Remove maximized state if present
            var mc = modal.querySelector('.modal-content');
            if (mc) {
                mc.classList.remove('maximized');
            }
            modal.classList.remove('show');
            setTimeout(function () {
                modal.style.display = 'none';
            }, 200);
        }
    }

    toggleMaximize(btn) {
        var mc = btn.closest('.modal-content');
        if (!mc) return;
        var isMax = mc.classList.toggle('maximized');
        var icon = btn.querySelector('i');
        if (icon) {
            icon.className = isMax ? 'fas fa-compress' : 'fas fa-expand';
        }
        btn.title = isMax ? '恢复' : '最大化';
    }

    // ==================== 工具方法 ====================

    _copyText(text) {
        var self = this;
        var done = function () { self.showToast('已复制：' + text, false); };
        var fallback = function () {
            var ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { self.showToast('复制失败，请手动复制', true); }
            document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
            fallback();
        }
    }

    _escape(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _formatTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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

    /**
     * 发起人把审批以私聊卡片形式发送给待审批人，对方点击卡片直达审批详情
     */
    async sendApprovalPrivate(approvalId, assigneeUserId, btn) {
        var confirmed = await this.showConfirmDialog('确认发送私聊卡片', '确认发送私聊卡片给待审批人？', 'confirm');
        if (!confirmed) return;

        if (!approvalId || !assigneeUserId) return;
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 发送中...';
        }
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + approvalId + '/send-private/', {
                assignee_user_id: assigneeUserId
            });
            this.showToast((res && res.message) || '已发送私聊提醒', false);
            if (btn) {
                btn.disabled = true;
                btn.style.borderColor = '#67c23a';
                btn.style.color = '#67c23a';
                btn.innerHTML = '<i class="fas fa-check" style="margin-right:2px;"></i>已发送';
            }
        } catch (e) {
            this.showToast(e.message || '发送失败', true);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-comment-dots" style="margin-right:2px;"></i>发送私聊';
            }
        }
    }

    // ==================== 票据回传 ====================·

    // 渲染票据回传区块（仅审批已通过且配置了回传时限时显示）
    // 判断当前用户是否为最后审批人（最终审批节点；未标记最终节点时取最高 order 节点）
    _isLastApprover(d, currentUserId) {
        if (!d || !d.approval_nodes || !currentUserId) return false;
        var finalNode = null;
        for (var i = 0; i < d.approval_nodes.length; i++) {
            if (d.approval_nodes[i].is_final_approver) { finalNode = d.approval_nodes[i]; break; }
        }
        if (!finalNode) {
            var candidates = d.approval_nodes.filter(function (x) { return x.node_type !== 'initiator'; });
            candidates.sort(function (a, b) { return (b.order || 0) - (a.order || 0); });
            finalNode = candidates[0];
        }
        if (!finalNode) return false;
        return (finalNode.assignees || []).some(function (as) { return as.user === currentUserId; });
    }

    _renderReceiptSection(d) {
        if (!d) return '';
        var currentUserId = parseInt(localStorage.getItem('user_id'));
        var isApplicant = d.applicant === currentUserId;
        var isLastApprover = this._isLastApprover(d, currentUserId);
        if (!isApplicant && !isLastApprover) return '';
        // 票据回传开关关闭时：发起人与最后审批人均不可使用票据回传，整个区域隐藏
        if (!d.enable_receipt_return) return '';
        var inProgress = ['pending', 'deferred', 'processing'].indexOf(d.status) >= 0;
        // 已通过：只要配置开启回传（时限>0）即显示；进行中：发起人/最后审批人可补传
        if (d.status === 'approved') {
            if (!(d.receipt_return_hours > 0)) return '';
        } else if (!inProgress) {
            return '';
        }
        var deadlineText = '';
        var canUpload = false;
        if (d.status === 'approved') {
            if (d.receipt_deadline) {
                var deadline = new Date(d.receipt_deadline);
                var expired = new Date() > deadline;
                deadlineText = '回传截止时间：' + this._formatTime(d.receipt_deadline)
                    + (expired ? ' <span style="color:#f56c6c;">（已过期）</span>' : ' <span style="color:#67c23a;">（请在截止前回传付款凭证/票据）</span>');
                canUpload = !expired;
            } else {
                // 截止时间缺失（旧数据/边界）：按配置的回传时限展示并允许回传（后端会自动补算截止时间）
                deadlineText = '审批已通过，可在配置的回传时限（' + d.receipt_return_hours + ' 小时）内补传付款凭证/票据';
                canUpload = true;
            }
        } else {
            deadlineText = '审批进行中，可补传票据';
            canUpload = true;
        }
        var receipts = d.receipts || [];
        // 区分回传方：最后审批人回传=对发起人的反馈；发起人回传=对审批人的反馈（历史数据无标记按发起人处理）
        var lastApproverReceipts = receipts.filter(function (r) { return (r.uploader_role || '') === 'last_approver'; });
        var applicantReceipts = receipts.filter(function (r) { return (r.uploader_role || '') !== 'last_approver'; });
        var html = '<div class="detail-item full-width" style="margin-top:8px;border:1px solid #d1f2eb;border-radius:8px;padding:12px;background:#f4fdf9;">'
            + '<div style="font-size:14px;font-weight:600;color:#16a085;margin-bottom:8px;border-bottom:1px solid #d1f2eb;padding-bottom:6px;"><i class="fas fa-file-upload"></i> 票据回传</div>'
            + '<div style="font-size:13px;color:#606266;margin-bottom:8px;">' + deadlineText + '</div>';
        // 渲染一组回传票据（canDelete=仅该组回传者可删除本人上传的票据）
        var renderReceiptGroup = function (title, hint, group, canDelete) {
            if (!group.length) return '';
            var g = '<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;color:#16a085;margin-bottom:4px;">' + title + ' <span style="font-weight:400;color:#909399;font-size:12px;">' + hint + '</span></div>'
                + '<div style="display:flex;flex-direction:column;gap:4px;">';
            group.forEach(function (r) {
                var rName = r.name || '';
                var rUrl = r.url || '';
                var isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(rName || rUrl);
                var isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i.test(rName || rUrl);
                // 点击行为：图片→预览；文档→自动保存到我的网盘并打开在线编辑；其他→保存到网盘
                var inner = isImg
                    ? '<img src="' + approvalApp._escape(rUrl) + '" style="width:40px;height:40px;border-radius:4px;object-fit:cover;border:1px solid #d1f2eb;">'
                    : '<i class="fas ' + (isDoc ? 'fa-file-word' : 'fa-file') + '" style="color:#16a085;font-size:18px;"></i>';
                g += '<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;background:#fff;border:1px solid #e2f3ee;border-radius:6px;">'
                    + '<a href="javascript:void(0)" data-url="' + approvalApp._escape(rUrl) + '" data-name="' + approvalApp._escape(rName || '') + '" onclick="approvalApp._handleAttach(this)" title="' + (isImg ? '点击预览图片' : '点击保存到我的网盘' + (isDoc ? '并在线编辑' : '')) + '" style="display:inline-flex;align-items:center;gap:6px;color:#16a085;text-decoration:none;flex:1;overflow:hidden;">'
                    + inner + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(rName || '') + '</span></a>'
                    + (canDelete ? '<button type="button" title="删除该回传票据" data-url="' + approvalApp._escape(rUrl) + '" onclick="approvalApp._deleteReceipt(' + d.id + ', this)" style="border:none;background:none;color:#f56c6c;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;flex-shrink:0;"><i class="fas fa-trash-alt"></i></button>' : '')
                    + '</div>';
            });
            g += '</div></div>';
            return g;
        };
        html += renderReceiptGroup('最后审批人回传', '（对发起人的反馈）', lastApproverReceipts, isLastApprover);
        html += renderReceiptGroup('发起人回传', '（对审批人的反馈）', applicantReceipts, isApplicant);
        // 最后审批人可填写审批意见（随票据一起回传，展示在审批记录最下面）
        if (canUpload && isLastApprover && !isApplicant) {
            html += '<div style="margin-bottom:8px;"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;"><i class="fas fa-comment-dots" style="color:#16a085;"></i> 审批意见</label>'
                + '<textarea id="receiptComment' + d.id + '" rows="2" placeholder="选填，填写回传票据的相关说明..." style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#dcdfe6);border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea></div>';
        }
        // 发起人/最后审批人可上传；最后审批人还可单独提交审批意见
        if (canUpload) {
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
                + '<button type="button" class="btn btn-sm btn-primary" onclick="approvalApp._triggerReceiptUpload(' + d.id + ')"><i class="fas fa-upload"></i> 回传付款凭证/票据</button>'
                + '<input type="file" id="receiptFileInput' + d.id + '" style="display:none;" multiple onchange="approvalApp._handleReceiptFileSelect(' + d.id + ', this)">'
                + (isLastApprover && !isApplicant
                    ? '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._submitReceiptComment(' + d.id + ')"><i class="fas fa-comment-dots"></i> 单独提交审批意见</button>'
                    : '')
                + '</div>';
        }
        html += '</div>';
        return html;
    }

    // 单独提交审批意见（不附票据文件）
    async _submitReceiptComment(id) {
        const commentEl = document.getElementById('receiptComment' + id);
        const comment = commentEl ? commentEl.value.trim() : '';
        if (!comment) {
            this.showToast('请先填写审批意见', true);
            return;
        }
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/upload-receipt/', {comment: comment});
            this.showToast((res && res.message) || '审批意见已提交', false);
            if (commentEl) commentEl.value = '';
            this.showDetail(id);
        } catch (e) {
            this.showAlert('提交失败', e.message || '请重试');
        }
    }

    // 删除一条已回传的票据（仅最后审批人有权限，后端会再次校验）
    async _deleteReceipt(id, btn) {
        const url = btn ? btn.getAttribute('data-url') : '';
        if (!url) return;
        const confirmed = await this.showConfirmDialog('删除票据', '确定删除该回传票据吗？删除后不可恢复。', 'danger');
        if (!confirmed) return;
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/delete-receipt/', {url: url});
            this.showToast((res && res.message) || '已删除', false);
            this.showDetail(id);
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    }

    _triggerReceiptUpload(id) {
        const input = document.getElementById('receiptFileInput' + id);
        if (input) input.click();
    }

    async _handleReceiptFileSelect(id, input) {
        const files = input.files;
        if (!files || !files.length) return;
        const uploaded = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.size > this.fileMaxSizeMB * 1024 * 1024) {
                this.showAlert('提示', '文件大小不能超过' + this.fileMaxSizeMB + 'MB');
                continue;
            }
            const formData = new FormData();
            formData.append('file', file);
            try {
                const resp = await fetch(OA_API_URL + '/approval/upload-attachment/', {
                    method: 'POST',
                    headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                    body: formData
                });
                if (!resp.ok) throw new Error('上传失败');
                const result = await resp.json();
                if (result.url) uploaded.push({url: result.url, name: result.name || file.name});
            } catch (e) {
                console.error('上传回传票据失败', e);
            }
        }
        if (input) input.value = '';
        if (uploaded.length) {
            // 随票据一起提交的审批意见（最后审批人可填）
            const commentEl = document.getElementById('receiptComment' + id);
            const comment = commentEl ? commentEl.value.trim() : '';
            try {
                const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/upload-receipt/', {files: uploaded, comment: comment});
                this.showToast((res && res.message) || '票据回传成功', false);
                if (commentEl) commentEl.value = '';
                this.showDetail(id);
            } catch (e) {
                this.showAlert('回传失败', e.message || '请重试');
            }
        }
    }


}

// // 全局初始化
// let approvalApp = null;
//
// // 确保在 DOM 加载完成后初始化 approvalApp
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', () => {
//         approvalApp = new ApprovalApp();
//         window.approvalApp = approvalApp;
//     });
// } else {
//     // 如果 DOM 已经加载完成，直接初始化
//     approvalApp = new ApprovalApp();
//     window.approvalApp = approvalApp;
// }
