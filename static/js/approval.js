// static/js/approval.js - OA审批

// 说明：动态表单/类型配置/详情打印/物资/票据发票已拆分到 approval-*.js；公共弹窗与转义由 app-common.js 提供。

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
        // 物资入口：管理员走「审批服务」下拉里的物资管理/物品库，普通员工走顶栏「物资」栏（二者互斥，避免重复）
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
                // 一律按接口返回的真实角色刷新（超管专属入口依赖 user_type，缓存可能过期）
                isAdmin = realAdmin;
                this._applyAdminButtons(isAdmin);
            }
        } catch (e) {
            console.warn('获取当前用户失败，使用本地 user_type:', isAdmin ? '管理员' : '非管理员');
        }
        // 「报表与数据分析」入口：默认隐藏，由管理控制台开启并授权后可见（后端接口另有一道校验）
        try {
            await this._applyReportAccess();
        } catch (e) { /* ignore */ }
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

    // 「报表与数据分析」入口显隐：默认隐藏；管理控制台开启并授权当前用户后才显示
    async _applyReportAccess() {
        var nav = document.getElementById('approvalReportNavItem');
        if (!nav) return;
        var divider = document.getElementById('reportSvcDivider');
        var ok = false;
        try {
            var resp = await fetch(OA_API_URL + '/report-access/', {headers: TokenManager.getHeaders()});
            if (resp.ok) {
                var d = await resp.json();
                ok = !!(d && d.oa);
            }
        } catch (e) { /* 取不到则保持隐藏 */ }
        nav.style.display = ok ? '' : 'none';
        if (divider) divider.style.display = ok ? '' : 'none';
    }

    _applyAdminButtons(isAdmin) {
        var configBtn = document.getElementById('approvalConfigBtn');
        if (configBtn) configBtn.style.display = isAdmin ? 'inline-flex' : 'none';
        var typeManageBtn = document.getElementById('approvalTypeManageBtn');
        if (typeManageBtn) typeManageBtn.style.display = isAdmin ? 'inline-flex' : 'none';
        // 管理员的物资入口在「审批服务」下拉里，「物资」栏仅面向普通员工，避免同一功能两个入口
        var svcWrap = document.getElementById('approvalSvcWrap');
        if (svcWrap) svcWrap.style.display = isAdmin ? 'inline-flex' : 'none';
        var matWrap = document.getElementById('materialEntryWrap');
        if (matWrap) matWrap.style.display = isAdmin ? 'none' : '';
        // 审批生命周期期限配置仅超级管理员可见（归档/撤回/草稿保留天数）
        var lcItem = document.getElementById('approvalLifecycleNavItem');
        if (lcItem) {
            lcItem.style.display = localStorage.getItem('user_type') === 'super_admin' ? '' : 'none';
        }
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
        var msg = err.error || err.message || err.detail || err;
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

    async apiPut(url, data) {
        const resp = await fetch(url, {
            method: 'PUT',
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
            if (this.archivedFilter) url += '&archived=' + this.archivedFilter;
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
        // 归档/审计权限（超管 或 财务专员）由后端判定，用于显示归档操作与审计入口
        if (data && typeof data.can_archive !== 'undefined') {
            this._canArchive = !!data.can_archive;
            var _auditNav = document.getElementById('approvalAuditNavItem');
            if (_auditNav) _auditNav.style.display = this._canArchive ? 'flex' : 'none';
        }
        // 🔧 记录当前页审批ID列表（用于详情上一条/下一条切换）
        this._listApprovalIds = rows.map(function (r) { return r.id; });
        if (!rows.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>' + (this.archivedFilter ? '暂无已归档的审批' : '暂无审批记录') + '</p></div>';
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
                + '<span title="审批ID（可在搜索框输入该ID检索）" style="cursor:pointer;" onclick="event.stopPropagation();approvalApp._copyText(\'' + r.id + '\')"><i class="fas fa-hashtag"></i> ' + r.id + '</span>'
                + '<span><i class="fas fa-user"></i> ' + self._escape(r.applicant_name || '') + '</span>'
                + '<span><i class="fas fa-tag"></i> <span class="type-icon-badge type-' + r.approval_type + '" style="background:' + self._hexA((r.approval_type_color || self._getTypeColor(r.approval_type)), 0.14) + ';color:' + (r.approval_type_color || self._getTypeColor(r.approval_type)) + ';"><i class="fas ' + (r.approval_type_icon || self._getTypeIcon(r.approval_type)) + '"></i> ' + self._escape(r.approval_type_display || r.approval_type) + '</span></span>'
                + '<span title="更新时间"><i class="fas fa-clock"></i> ' + self._formatTime(r.updated_at) + '</span>'
                + (r.department_name ? '<span><i class="fas fa-building"></i> ' + self._escape(r.department_name) + '</span>' : '')
                + (r.is_archived ? '<span title="已归档' + (r.archived_at ? '：' + self._formatTime(r.archived_at) : '') + (r.archived_by_name ? '（' + self._escape(r.archived_by_name) + '）' : '') + '" style="color:#e6a23c;"><i class="fas fa-box-archive"></i> 已归档</span>' : '')
                + (amt || '') + '</div></div></div></div>'
                + '<div class="approval-item-right" style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">'
                + '<span class="' + (scMap[r.status] || '') + '">' + (statusMap[r.status] || r.status) + '</span>'
                + (self._canArchive
                    ? (r.is_archived
                        ? '<button class="action-btn" title="取消归档（回到常规列表）" onclick="event.stopPropagation();approvalApp.unarchiveApproval(' + r.id + ')"><i class="fas fa-box-open" style="color:#409eff;"></i></button>'
                        : (r.status === 'approved'
                            ? '<button class="action-btn" title="归档（移出常规列表，便于审计复盘）" onclick="event.stopPropagation();approvalApp.archiveApproval(' + r.id + ')"><i class="fas fa-box-archive" style="color:#e6a23c;"></i></button>'
                            : ''))
                    : '')
                + '</div></div>';
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
        // 「已归档」是独立的归档状态筛选，不随状态/范围筛选互斥清除
        document.querySelectorAll('.filter-btn:not(.filter-scope-btn):not(.filter-arch-btn)').forEach(function (b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');
        this.statusFilter = status;
        this.loadList(1);
    }

    // 我发起的 / 抄送我的 过滤（互斥，再次点击取消）
    filterByScope(btn, scope) {
        document.querySelectorAll('.filter-scope-btn:not(.filter-arch-btn)').forEach(function (b) {
            b.classList.remove('active');
        });
        var activate = this.scopeFilter !== scope;
        this.scopeFilter = activate ? scope : '';
        if (activate) btn.classList.add('active');
        this.loadList(1);
    }

    // 已归档筛选（再次点击取消，回到未归档列表）
    toggleArchivedFilter(btn) {
        var activate = this.archivedFilter !== '1';
        this.archivedFilter = activate ? '1' : '';
        if (btn) btn.classList.toggle('active', activate);
        this.loadList(1);
    }

    // 归档 / 取消归档（超管或财务专员，后端二次校验）
    async archiveApproval(id) {
        var ok = await this.showConfirmDialog('归档审批',
            '归档后该审批将从常规列表移出（可在「已归档」中查看），便于月度/季度/年度归档与审计复盘。是否继续？', 'confirm');
        if (!ok) return;
        await this._doArchive(id, false);
    }

    async unarchiveApproval(id) {
        var ok = await this.showConfirmDialog('取消归档', '取消归档后该审批将回到常规列表。是否继续？', 'confirm');
        if (!ok) return;
        await this._doArchive(id, true);
    }

    async _doArchive(id, unarchive) {
        try {
            var res = await this.apiPost(OA_API_URL + '/approval/' + id + '/' + (unarchive ? 'unarchive' : 'archive') + '/', {});
            this.showToast(unarchive ? '已取消归档' : '已归档（可在「已归档」筛选查看）', false);
            this.loadList(this.currentPage);
            var dm = document.getElementById('approvalDetailModal');
            if (dm && dm.style.display === 'flex' && this._detailApproval && this._detailApproval.id === id) {
                this.showDetail(id);
            }
        } catch (e) {
            this.showAlert(unarchive ? '取消归档失败' : '归档失败', (e && e.message) || '请重试');
        }
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

    // opts.userSwitch：用户点击类型卡片主动切换（会清空上一个类型填过的内容）
    selectType(type, opts) {
        var prev = document.getElementById('newApprovalType').value;
        // 更新隐藏字段
        document.getElementById('newApprovalType').value = type;
        // 更新选中状态
        document.querySelectorAll('.type-card').forEach(function (c) {
            c.classList.toggle('selected', c.dataset.type === type);
        });
        // ⚠️ 用户切换审批类型且类型确实变了 → 先清空上一个类型填过的所有内容。
        //    否则上一种类型残留的值（尤其金额）会跟着提交，导致「审批金额」与「表单金额」不一致。
        //    注意：程序化设置类型（打开弹窗自动选中、编辑/驳回续审回填）不带 userSwitch，不会清空。
        if (opts && opts.userSwitch && prev !== type) {
            // 所属部门 / 审批标题 / 审批内容 是跨审批类型共用的字段（部门在打开弹窗、重新编辑时
            // 已按主部门带出默认值；标题与内容是用户手填的），切换类型只应清空该类型专属的内容，
            // 这三个字段要原样保留，避免用户重新填一遍。
            var kept = {};
            ['newDepartmentSelect', 'newApprovalTitle', 'newApprovalContent'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el && el.value) kept[id] = el.value;
            });
            this._resetApprovalForm();
            Object.keys(kept).forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = kept[id];
            });
        }
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
        // 当前类型的「发票上传数量上限」（来自审批类型配置，默认 10）→ 供发票区块提示与限制使用
        var _tObj = this._getType(type);
        this._currentInvoiceMax = (_tObj && _tObj.invoice_max_count) ? parseInt(_tObj.invoice_max_count, 10) : 10;
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
            if (startLabel) startLabel.innerHTML = '<i class="fas fa-play-circle" style="color:#e6a23c;margin-right:4px;"></i> 加班开始 <span class="required">*</span>';
            if (endLabel) endLabel.innerHTML = '<i class="fas fa-stop-circle" style="color:#e6a23c;margin-right:4px;"></i> 加班结束 <span class="required">*</span>';
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
            if (startLabel) startLabel.innerHTML = '<i class="fas fa-calendar-alt" style="color:var(--primary-color,#409eff);margin-right:4px;"></i> 开始日期 <span class="required">*</span>';
            if (endLabel) endLabel.innerHTML = '<i class="fas fa-calendar-check" style="color:#67c23a;margin-right:4px;"></i> 结束日期 <span class="required">*</span>';
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
            if (type === 'purchase') amountUnit.innerHTML = '<i class="fas fa-money-bill-wave" style="color:#e6a23c;margin-right:4px;"></i> 金额（¥）<span class="required">*</span>';
            else if (isExpense) amountUnit.innerHTML = '<i class="fas fa-file-invoice-dollar" style="color:#67c23a;margin-right:4px;"></i> 金额（¥）<span class="required">*</span>';
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
        // 发票：报销/采购显示（超管可直接二维码扫描/验真）
        var invGroup = document.getElementById('invoiceGroup');
        if (invGroup) {
            var _showInv = (isExpense || type === 'purchase');
            invGroup.style.display = _showInv ? '' : 'none';
            if (_showInv) {
                var _isSuper = false;
                try { _isSuper = (localStorage.getItem('user_type') === 'super_admin'); } catch (e) { /* ignore */ }
                this._renderBuiltinInvoices(_isSuper);
            }
        }
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

    // 清空「新建审批」表单里已填写的一切（内置字段 + 动态表单 + 附件/发票/抄送人/审批链状态）。
    // 打开弹窗时和「用户切换审批类型」时都会调用，避免上一个类型的内容残留到下一个类型
    // （最典型的后果：换了类型后提交，金额还是上一个类型填的值）。
    _resetApprovalForm() {
        var form = document.getElementById('createApprovalForm');
        if (form) form.reset();
        // 内置费用类型下拉：首次构建自定义下拉，重置后同步收起态显示
        this._buildExpenseSelect(document.getElementById('newExpenseType'));
        this._syncExpenseTypeDisplay();
        // 隐藏所有内置类型专属表单（含请假类型/出差/采购物项/报销项目等）
        this._hideBuiltinFields();
        var recruitInputs = document.querySelectorAll('#recruitForm input, #recruitForm textarea, #recruitForm select');
        recruitInputs.forEach(function (el) {
            if (el.type === 'text' || el.tagName === 'TEXTAREA') el.value = '';
            else if (el.type === 'number') el.value = '';
            else if (el.tagName === 'SELECT') el.selectedIndex = 0;
        });
        var remarkRow = document.getElementById('recruitStaffingRemarkRow');
        if (remarkRow) remarkRow.style.display = 'none';
        this._clearTypeRows();
        // 附件
        var ap = document.getElementById('attachmentPreview');
        if (ap) {
            ap.innerHTML = '';
            ap.style.display = 'none';
        }
        this._attachmentFiles = [];
        this._invoiceValues = {};
        var _invG = document.getElementById('invoiceGroup');
        if (_invG) _invG.style.display = 'none';
        // 动态表单：既要清容器，也要清挂在容器之外的状态（附件字段/人员字段/联动值/当前 schema），
        // 否则 _collectDynamicFormData 会把它们合并进来，跨审批类型带到提交数据里
        this._editFormData = {};
        this._currentSchema = [];
        this._dynAttachmentValues = {};
        this._dynUserValues = {};
        this._dynReqLinkValues = {};
        this._paymentMethodFieldKey = null;
        var dynC = document.getElementById('dynamicFormFields');
        if (dynC) {
            dynC.innerHTML = '';
            dynC.style.display = 'none';
        }
        // 审批链 / 抄送人（不同审批类型的审批链与默认抄送人不同，重置后按新类型重新带出）
        this._approverNodes = [];
        this._isReEdit = false;
        this._reEditId = null;
        this._ccUsers = [];
        this._ccDepartments = [];
        this._ccTab = 'users';
        this._ccSearchTimer = null;
        this._currentCcType = '';
        var sdB = document.getElementById('saveDraftBtn');
        if (sdB) sdB.textContent = '存草稿';
        var sab = document.getElementById('submitApprovalBtn');
        if (sab) sab.innerHTML = '<i class="fas fa-paper-plane"></i> 提交审批';

        // 审批方式/审批模式：先置默认，随后按「该审批类型配置」覆盖（见 _loadConfigDefaults）
        this._applyApprovalModeDefaults();
        this._renderCcTags();
    }

    async openCreateModal() {
        var self = this;
        this._resetApprovalForm();
        document.querySelectorAll('.type-card').forEach(function (c) {
            c.classList.remove('selected');
        });
        // 自定义类型/带表单内置类型：重置动态表单为空白
        var _curType = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        if (_curType && (!this._isBuiltinType(_curType) || this._isDynamicSchemaType(_curType))) {
            var _t = this._getType(_curType);
            this._renderDynamicFields(_t ? (_t.form_schema || []) : [], {});
        }

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

    // ==================== 提交审批 ====================

    async submitApproval() {
        // 发票识别/验真/二维码扫描进行中时，禁止提交，避免提交到未识别完的发票数据
        if (this._invoiceBusy()) { this.showToast('发票正在识别/验真/二维码扫描中，请稍候再提交', true); return; }
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
    // 金额是否由「内置金额输入框」提交：只有报销/采购的金额是用户可见可填的。
    // 其余类型（自定义类型、带表单的内置类型）一律以后端按「表单金额字段」取值为准，
    // 前端不再提交 amount —— 否则切换审批类型时会带上上一个类型残留的金额。
    _isBuiltinAmountType(type) {
        return type === 'expense' || type === 'purchase';
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
            const typeEl = document.getElementById('newApprovalType');
            if (typeEl) { try { typeEl.scrollIntoView({ block: 'center' }); typeEl.focus(); } catch (e) { /* ignore */ } }
            return;
        }
        if (!title) {
            this.showAlert('提示', '请输入审批标题');
            const titleEl = document.getElementById('newApprovalTitle');
            if (titleEl) { try { titleEl.scrollIntoView({ block: 'center' }); titleEl.focus(); } catch (e) { /* ignore */ } }
            return;
        }
        if (!departmentId) {
            this.showAlert('提示', '请选择所属部门');
            const deEl = document.getElementById('newDepartmentSelect');
            if (deEl) { try { deEl.scrollIntoView({ block: 'center' }); deEl.focus(); } catch (e) { /* ignore */ } }
            return;
        }
        // 报销或者采购：金额必填
        if (type === 'expense' || type === 'purchase') {
            if (!amount) {
                this.showToast('请输入金额', true);
                // this.showAlert('提示', '请输入金额');
                const amEl = document.getElementById('newAmount');
                if (amEl) { try { amEl.scrollIntoView({ block: 'center' }); amEl.focus(); } catch (e) { /* ignore */ } }
                return;
            }
        }

        // 报销：费用类型必填
        if (type === 'expense' && !expenseType) {
            // this.showToast('请选择费用类型', true);
            this.showAlert('提示', '请选择费用类型');
            const etEl = document.getElementById('newExpenseType');
            if (etEl) { try { etEl.scrollIntoView({ block: 'center' }); etEl.focus(); } catch (e) { /* ignore */ } }
            return;
        }


        // 请假：请假类型必填
        if (type === 'leave') {
            if (!this._collectLeaveType()) {
                // this.showToast('请选择请假类型', true);
                this.showAlert('提示', '请选择请假类型');
                const ltRow = document.getElementById('leaveTypeRow');
                if (ltRow) { try { ltRow.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } }
                return;
            }
            if (!startDate) {
                this.showToast('请选择开始日期', true);
                const sdEl = document.getElementById('newStartDate');
                if (sdEl) { try { sdEl.scrollIntoView({ block: 'center' }); sdEl.focus(); } catch (e) { /* ignore */ } }
                return;
            }
            if (!endDate) {
                this.showToast('请选择结束日期', true);
                const edEl = document.getElementById('newEndDate');
                if (edEl) { try { edEl.scrollIntoView({ block: 'center' }); edEl.focus(); } catch (e) { /* ignore */ } }
                return;
            }

            if (startDate > endDate) {
                this.showToast('开始日期不能大于结束日期', true);
                const sdEl = document.getElementById('newStartDate');
                if (sdEl) { try { sdEl.scrollIntoView({ block: 'center' }); sdEl.focus(); } catch (e) { /* ignore */ } }
                return;
            }

        }
        // 物资领用单：领用数量不得超过剩余可领数量
        if (type === 'material_requisition') {
            const over = this._validateRequisitionItems();
            if (over !== null) { this.showToast('领用数量不能超过剩余可领数量 ' + over, true); return; }
        }
        // 自定义审批类型：按 schema 校验必填字段（配置必填才必填）
        if (!this._isBuiltinType(type) || this._isDynamicSchemaType(type)) {
            const missing = this._validateDynRequired();
            if (missing.length) {
                this.showToast('请填写必填项：' + missing.join('、'), true);
                return;
            }
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
        // 发票（内置报销/采购）：写入 form_data.invoices
        if (type === 'expense' || type === 'purchase') {
            var _inv = this._invoiceList('__builtin__');
            if (_inv && _inv.length) {
                data.form_data = data.form_data || {};
                data.form_data.invoices = _inv;
            }
        }
        if (startDate) data.start_date = startDate.substring(0, 10);
        if (endDate) data.end_date = endDate.substring(0, 10);
        if (duration) data.duration = parseFloat(duration);
        // 仅报销/采购提交内置金额；其余类型的金额由后端按表单金额字段取值（防止残留金额混入）
        if (amount && this._isBuiltinAmountType(type)) data.amount = parseFloat(amount);
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
        // 发票识别/验真/二维码扫描进行中时，禁止存草稿
        if (this._invoiceBusy()) { this.showToast('发票正在识别/验真/二维码扫描中，请稍候再保存草稿', true); return; }
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
        // 发票（内置报销/采购）：写入 form_data.invoices
        if (f.approval_type === 'expense' || f.approval_type === 'purchase') {
            var _invDraft = this._invoiceList('__builtin__');
            if (_invDraft && _invDraft.length) {
                data.form_data = data.form_data || {};
                data.form_data.invoices = _invDraft;
            }
        }
        if (f.start_date) data.start_date = f.start_date.substring(0, 10);
        if (f.end_date) data.end_date = f.end_date.substring(0, 10);
        if (f.duration) data.duration = parseFloat(f.duration);
        if (f.amount && this._isBuiltinAmountType(data.approval_type || f.approval_type)) data.amount = parseFloat(f.amount);
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
            // 审批方式/审批模式：默认读取该审批类型配置（无配置时回退到原单的取值）
            var _amCfg = await this._resolveApprovalConfig(d.approval_type);
            this._applyApprovalModeDefaults(
                (_amCfg && _amCfg.default_sign_type) || d.sign_type,
                (_amCfg && _amCfg.default_approval_mode) || d.approval_mode);
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
            // 发票（报销/采购）：回填
            var _invList = (d.form_data && Array.isArray(d.form_data.invoices)) ? d.form_data.invoices : [];
            this._invoiceValues = this._invoiceValues || {};
            this._invoiceValues['__builtin__'] = _invList;
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


    _formatTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }


    // ==================== 优雅的提示对话框 ====================

    // ==================== 优雅的确认对话框 ====================


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

// 公共方法（AppCommon）：转义 / 鉴权跳转 / 提示弹窗 / 最大化
AppCommon.mixin(ApprovalApp, {
    "escapeHtml": "escapeHtml",
    "_escape": "escapeHtml",
    "handleAuthError": "handleAuthError",
    "showAlert": "showAlert",
    "showConfirmDialog": "showConfirmDialog",
    "showToast": "showToast",
    "toggleMaximize": "toggleMaximize"
});
