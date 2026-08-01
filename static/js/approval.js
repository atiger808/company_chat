// static/js/approval.js - OA审批

const OA_API_URL = '/api/oa';

class ApprovalApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this.statusFilter = '';
        this.typeFilter = '';
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
        this._configCcDepts = [];
        this._configCcUsers = [];
        this._configDeleteId = null;
        this._currentCcType = '';   // tracks which type's CC is currently loaded
        this.chat_login_url = '/login/';

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
        await this.loadList();
        // Show config button for admins
        var userType = localStorage.getItem('user_type');
        var configBtn = document.getElementById('approvalConfigBtn');
        if (configBtn && (userType === 'super_admin' || userType === 'admin')) {
            configBtn.style.display = 'inline-flex';
        }
        this._ccTab = 'users';
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
                this.handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || '请求失败');
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
        if (!rows.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>暂无审批记录</p></div>';
            return;
        }
        const statusMap = {'draft': '草稿', 'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回', 'deferred': '暂缓', 'processing': '办理中', 'cancelled': '已撤回'};
        const scMap = {'draft': 'badge-default', 'pending': 'badge-info', 'approved': 'status-badge normal', 'rejected': 'status-badge late', 'deferred': 'status-badge deferred', 'processing': 'status-badge processing', 'cancelled': 'badge-default'};
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
                + '<span><i class="fas fa-tag"></i> <span class="type-icon-badge type-' + r.approval_type + '"><i class="fas ' + self._typeIcon(r.approval_type) + '"></i> ' + (tMap[r.approval_type] || r.approval_type) + '</span></span>'
                + '<span title="更新时间"><i class="fas fa-clock"></i> ' + self._formatTime(r.updated_at) + '</span>'
                + (r.department_name ? '<span><i class="fas fa-building"></i> ' + self._escape(r.department_name) + '</span>' : '')
                + (amt || '') + '</div></div></div></div>'
                + '<div class="approval-item-right"><span class="' + (scMap[r.status] || '') + '">' + (statusMap[r.status] || r.status) + '</span></div></div>';
        }).join('');
    }

    _renderPagination(data, container) {
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
        document.querySelectorAll('.filter-btn').forEach(function (b) {
            b.classList.remove('active');
        });
        btn.classList.add('active');
        this.statusFilter = status;
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
        document.querySelectorAll('.type-card').forEach(function(c) {
            c.classList.toggle('selected', c.dataset.type === type);
        });
        this.onTypeChange();
        this._onDeptOrTypeChange();
    }

    onTypeChange() {
        const type = document.getElementById('newApprovalType').value;
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
            if (startInput) { startInput.type = 'datetime-local'; startInput.onchange = function() { approvalApp.calcDays(); }; startInput.oninput = function() { approvalApp.calcDays(); }; }
            if (endInput) { endInput.type = 'datetime-local'; endInput.onchange = function() { approvalApp.calcDays(); }; endInput.oninput = function() { approvalApp.calcDays(); }; }
            if (startLabel) startLabel.innerHTML = '<i class="fas fa-play-circle" style="color:#e6a23c;margin-right:4px;"></i> 加班开始';
            if (endLabel) endLabel.innerHTML = '<i class="fas fa-stop-circle" style="color:#e6a23c;margin-right:4px;"></i> 加班结束';
            if (durLabel) durLabel.innerHTML = '<i class="fas fa-clock" style="color:#e6a23c;margin-right:4px;"></i> 时数';
            if (durUnit) durUnit.textContent = '小时';
            if (durInput) { durInput.readOnly = true; durInput.placeholder = '0'; }
        } else if (hasDateFields) {
            // 请假/出差：日期 → 自动计算天数
            if (startInput) { startInput.type = 'date'; startInput.onchange = function() { approvalApp.calcDays(); }; }
            if (endInput) { endInput.type = 'date'; endInput.onchange = function() { approvalApp.calcDays(); }; }
            if (startLabel) startLabel.innerHTML = '<i class="fas fa-calendar-alt" style="color:var(--primary-color,#409eff);margin-right:4px;"></i> 开始日期';
            if (endLabel) endLabel.innerHTML = '<i class="fas fa-calendar-check" style="color:#67c23a;margin-right:4px;"></i> 结束日期';
            if (durLabel) durLabel.innerHTML = '<i class="fas fa-clock" style="color:#e6a23c;margin-right:4px;"></i> 天数';
            if (durUnit) durUnit.textContent = '天';
            if (durInput) { durInput.readOnly = true; durInput.placeholder = '0'; }
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
        // 金额行：报销/采购显示
        var amountGroup = document.getElementById('amountGroup');
        if (amountGroup) amountGroup.style.display = (isExpense || type === 'purchase') ? '' : 'none';
        // 招聘需求表单
        var rForm = document.getElementById('recruitForm');
        if (rForm) rForm.style.display = isRecruit ? 'block' : 'none';
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

    _typeIcon(type) {
        var m = {'leave':'fa-plane-departure','overtime':'fa-clock','expense':'fa-file-invoice-dollar','trip':'fa-suitcase-rolling','purchase':'fa-shopping-cart','recruit':'fa-user-plus','other':'fa-file'};
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
                opt.value = y; opt.textContent = y + '年';
                yearSel.appendChild(opt);
            }
            for (var m = 1; m <= 12; m++) {
                var opt2 = document.createElement('option');
                opt2.value = m; opt2.textContent = m + '月';
                monthSel.appendChild(opt2);
            }
            for (var d = 1; d <= 31; d++) {
                var opt3 = document.createElement('option');
                opt3.value = d; opt3.textContent = d + '日';
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
        var m = {'draft':'fa-pen','pending':'fa-hourglass-half','approved':'fa-check-circle','rejected':'fa-times-circle','deferred':'fa-pause-circle','processing':'fa-spinner','cancelled':'fa-undo'};
        return m[st] || 'fa-circle';
    }

    filterByTypeBtn(el, type) {
        document.querySelectorAll('.type-filter-card').forEach(function(b) { b.classList.remove('active'); });
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
        document.querySelectorAll('.type-card').forEach(function(c) { c.classList.remove('selected'); });
        document.getElementById('expenseTypeGroup').style.display = 'none';
        document.getElementById('expenseDateGroup').style.display = 'none';
        document.getElementById('expenseRow').style.display = 'none';
        var ar = document.getElementById('amountGroup');
        if (ar) ar.style.display = 'none';
        var dr = document.getElementById('dateRow');
        if (dr) dr.style.display = 'none';
        // Reset recruit form
        document.getElementById('recruitForm').style.display = 'none';
        var recruitInputs = document.querySelectorAll('#recruitForm input, #recruitForm textarea, #recruitForm select');
        recruitInputs.forEach(function(el) {
            if (el.type === 'text' || el.tagName === 'TEXTAREA') el.value = '';
            else if (el.type === 'number') el.value = '';
            else if (el.tagName === 'SELECT') el.selectedIndex = 0;
        });
        document.getElementById('recruitStaffingRemarkRow').style.display = 'none';
        document.getElementById('attachmentPreview').innerHTML = '';
        document.getElementById('attachmentPreview').style.display = 'none';
        this._attachmentFiles = [];
        this._approverNodes = [];
        this._isReEdit = false;
        this._reEditId = null;
        this._ccUsers = [];
        this._ccDepartments = [];
        this._ccTab = 'users';
        this._ccSearchTimer = null;
        var sdB = document.getElementById('saveDraftBtn');
        if (sdB) sdB.textContent = '存草稿';
        var sab = document.getElementById('submitApprovalBtn');
        if (sab) sab.innerHTML = '<i class="fas fa-paper-plane"></i> 提交审批';

        // Set defaults: countersign & sequential
        document.getElementById('newSignType').value = 'countersign';
        document.getElementById('newApprovalMode').value = 'sequential';

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
        setTimeout(function() { self._initCcSearch(); }, 100);
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
        if (params.length) url += '?' + params.join('&');
        try {
            var data = await this.apiGet(url);
            // Ignore stale responses from earlier requests
            if (seq !== this._chainReqSeq) return;
            var chain = data.results || [];
            var departments = data.departments || {};
            // Store approver nodes from chain preview (converts API format to backend format)
            this._approverNodes = chain.map(function(a) {
                return {type: a.type || 'user', id: a.id, label: a.label, user_position: a.user_position || ''};
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
                chain.forEach(function(a, i) {
                    var arrow = i < chain.length - 1 ? ' <span style="color:var(--text-light,#c0c4cc);font-size:11px;"><i class="fas fa-arrow-down"></i></span>' : '';
                    var levelLabel = a.level_label || ('第' + (a.level || (i + 1)) + '级');
                    html += '<div class="approver-node-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f0f9eb;border-radius:6px;margin-bottom:4px;border-left:3px solid #67c23a;">'
                        + '<i class="fas fa-user-check" style="color:#67c23a;font-size:13px;"></i>'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(a.label) + (a.user_position ? ' <span style="font-size:11px;color:#909399;">(' + self._escape(a.user_position) + ')</span>' : '') + '</span>'
                        + '<span style="font-size:11px;color:#67c23a;background:#fff;padding:2px 8px;border-radius:4px;">' + levelLabel + '</span>'
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
            if (!data || !data.results) { sel.innerHTML = '<option value="">请选择部门</option>'; return; }
            var depts = data.results;

            if (!depts.length) { sel.innerHTML = '<option value="">请选择部门</option>'; return; }
            var tree = {};
            depts.forEach(function(d) {
                var pid = d.parent_id != null ? d.parent_id : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });

            var html = '<option value="">请选择部门</option>';
            var walk = function(pid, depth) {
                var children = tree[pid] || [];
                children.forEach(function(d) {
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
                depts.forEach(function(d) { allIds[d.id] = true; });
                var actualRoots = [];
                depts.forEach(function(d) {
                    if (!allIds[d.parent_id]) actualRoots.push(d);
                });
                if (actualRoots.length) {
                    html = '<option value="">请选择部门</option>';
                    var renderFlat = function(items, depth) {
                        var prefix = '';
                        for (var i = 0; i < depth; i++) prefix += '—— ';
                        items.forEach(function(d) {
                            html += '<option value="' + d.id + '">' + prefix + d.name + '</option>';
                            var kids = tree[d.id] || [];
                            renderFlat(kids, depth + 1);
                        });
                    };
                    renderFlat(actualRoots, 0);
                }
            }

            sel.innerHTML = html;
            if (selectedId) { sel.value = selectedId; return; }
            try {
                var meRaw = await this.apiGet('/api/auth/me/');
                if (meRaw && meRaw.org_departments && meRaw.org_departments.length) {
                    var pdid = meRaw.org_departments[0].id;
                    for (var i = 0; i < sel.options.length; i++) {
                        if (parseInt(sel.options[i].value) === pdid) { sel.value = pdid; break; }
                    }
                }
            } catch(e) {}
        } catch(e) {
            console.error('Load dept tree failed:', e);
            sel.innerHTML = '<option value="">请选择部门</option>';
        }
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

    async _loadConfigDefaults() {
        var type = this._currentCcType;
        this._ccUsers = [];
        this._ccDepartments = [];
        if (!type) { this._renderCcTags(); return; }
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            // 根据当前用户企业匹配配置：优先子企业专属配置，再找集团默认配置
            var activeTenant = null;
            try { activeTenant = JSON.parse(localStorage.getItem('active_tenant')); } catch(e) {}
            var userTenantId = activeTenant ? activeTenant.id : null;
            var cfg = null;
            var defaultCfg = null;
            configs.forEach(function(c) {
                if (c.approval_type !== type) return;
                if (c.sub_tenant && userTenantId && parseInt(c.sub_tenant) === parseInt(userTenantId)) {
                    cfg = c;
                } else if (!c.sub_tenant) {
                    defaultCfg = c;
                }
            });
            if (!cfg) cfg = defaultCfg;
            if (!cfg) { this._renderCcTags(); return; }
            // Apply sign_type and approval_mode defaults from config
            var signTypeSel = document.getElementById('newSignType');
            if (signTypeSel && cfg.default_sign_type) signTypeSel.value = cfg.default_sign_type;
            var apprModeSel = document.getElementById('newApprovalMode');
            if (apprModeSel && cfg.default_approval_mode) apprModeSel.value = cfg.default_approval_mode;
            if (cfg.cc_user_details && cfg.cc_user_details.length) {
                cfg.cc_user_details.forEach(function(u) {
                    this._ccUsers.push({id: u.id, name: u.name, avatar: u.avatar || ''});
                }, this);
            }
            if (cfg.cc_department_details && cfg.cc_department_details.length) {
                cfg.cc_department_details.forEach(function(d) {
                    this._ccDepartments.push({id: d.id, name: d.name});
                }, this);
            }
            this._renderCcTags();
        } catch(e) {
            console.error('加载审批配置默认值失败:', e);
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
        if (input) { input.value = ''; input.placeholder = tab === 'users' ? '搜索企业成员...' : '搜索部门...'; }
        document.getElementById('ccUserDropdown').style.display = 'none';
    }

    _initCcSearch() {
        var self = this;
        var input = document.getElementById('ccUserSearch');
        if (!input) return;
        input.oninput = function() {
            clearTimeout(self._ccSearchTimer);
            var val = input.value.trim();
            if (!val) {
                document.getElementById('ccUserDropdown').style.display = 'none';
                return;
            }
            self._ccSearchTimer = setTimeout(function() {
                if (self._ccTab === 'departments') {
                    self._searchCcDepartments(val);
                } else {
                    self._searchCcUsers(val);
                }
            }, 300);
        };
        input.onfocus = function() {
            if (input.value.trim()) {
                if (self._ccTab === 'departments') {
                    self._searchCcDepartments(input.value.trim());
                } else {
                    self._searchCcUsers(input.value.trim());
                }
            }
        };
        document.addEventListener('click', function(e) {
            var dd = document.getElementById('ccUserDropdown');
            if (dd && !e.target.closest('#ccUserSearch') && !e.target.closest('#ccUserDropdown') && !e.target.closest('.cc-tab')) {
                dd.style.display = 'none';
            }
        });
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
                (this._ccUsers || []).forEach(function(u) { selectedIds[u.id] = true; });
                dd.innerHTML = users.map(function(u) {
                    var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                    return '<div class="cc-user-item" data-id="' + u.id + '" data-name="' + self._escape(u.name) + '" data-avatar="' + (u.avatar || '') + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addCcUser(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + (u.avatar || '') + '\')">'
                        + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                        + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                        + '</div>';
                }).join('');
            }
            dd.style.display = 'block';
        } catch(e) {
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
                (this._ccDepartments || []).forEach(function(d) { selectedIds[d.id] = true; });
                dd.innerHTML = depts.map(function(d) {
                    var cls = selectedIds[d.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                    return '<div class="cc-user-item" data-id="' + d.id + '" data-name="' + self._escape(d.name) + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addCcDept(' + d.id + ',\'' + self._escape(d.name) + '\')">'
                        + '<i class="fas fa-building" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#409eff;font-size:16px;"></i>'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(d.name) + '</span>'
                        + (d.manager_name ? '<span style="font-size:11px;color:#909399;">负责人：' + self._escape(d.manager_name) + '</span>' : '')
                        + '</div>';
                }).join('');
            }
            dd.style.display = 'block';
        } catch(e) {
            console.error('Search CC departments failed:', e);
        }
    }

    _addCcUser(id, name, avatar) {
        if (!this._ccUsers) this._ccUsers = [];
        if (this._ccUsers.some(function(u) { return u.id === id; })) return;
        this._ccUsers.push({id: id, name: name, avatar: avatar});
        this._renderCcTags();
        document.getElementById('ccUserDropdown').style.display = 'none';
        document.getElementById('ccUserSearch').value = '';
    }

    _addCcDept(id, name) {
        if (!this._ccDepartments) this._ccDepartments = [];
        if (this._ccDepartments.some(function(d) { return d.id === id; })) return;
        this._ccDepartments.push({id: id, name: name});
        this._renderCcTags();
        document.getElementById('ccUserDropdown').style.display = 'none';
        document.getElementById('ccUserSearch').value = '';
    }

    _removeCcUser(id) {
        if (!this._ccUsers) return;
        this._ccUsers = this._ccUsers.filter(function(u) { return u.id !== id; });
        this._renderCcTags();
    }

    _removeCcDept(id) {
        if (!this._ccDepartments) return;
        this._ccDepartments = this._ccDepartments.filter(function(d) { return d.id !== id; });
        this._renderCcTags();
    }

    _renderCcTags() {
        var container = document.getElementById('ccUserTags');
        if (!container) return;
        var self = this;
        var html = '';
        // Department tags
        if (this._ccDepartments && this._ccDepartments.length) {
            html += this._ccDepartments.map(function(d) {
                return '<span class="cc-tag cc-tag-dept" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#e8f4fd;border-radius:14px;font-size:12px;margin:2px;">'
                    + '<i class="fas fa-building" style="font-size:11px;color:#409eff;"></i>'
                    + '<span>' + self._escape(d.name) + '</span>'
                    + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeCcDept(' + d.id + ')"></i>'
                    + '</span>';
            }).join('');
        }
        // User tags
        if (this._ccUsers && this._ccUsers.length) {
            html += this._ccUsers.map(function(u) {
                return '<span class="cc-tag" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f3e8ff;border-radius:14px;font-size:12px;margin:2px;">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">'
                    + '<span>' + self._escape(u.name) + '</span>'
                    + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeCcUser(' + u.id + ')"></i>'
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
        const files = e.target.files;
        if (!files.length) return;
        if (this._attachmentFiles.length >= 10) {
            this.showAlert('提示', '当前已添加10个附件，最多上传10个附件');
            return;
        }
        const file = files[0];
        if (file.size > this.fileMaxSizeMB * 1024 * 1024) {
            this.showAlert('提示', `文件大小不能超过${this.fileMaxSizeMB}MB`);
            return;
        }
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.mp4', '.avi', '.mov', '.mp3', '.wav'];
        if (!allowed.includes(ext)) {
            this.showAlert('错误', '不支持的文件格式');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);
        const self = this;

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
                self.showAlert('提示', '上传失败');
            }
        }).catch(function (err) {
            self.showAlert('上传失败', err.message);
        });
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
                + '<button class="action-btn" onclick="approvalApp.removeAttachment(' + i + ')" style="width:24px;height:24px;"><i class="fas fa-times" style="font-size:12px;"></i></button></div>';
        }).join('');
    }

    removeAttachment(index) {
        this._attachmentFiles.splice(index, 1);
        this._renderAttachments();
    }

    // ==================== 提交审批 ====================

    async submitApproval() {
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

        if (!type) { this.showAlert('提示', '请选择审批类型'); return; }
        if (!title) { this.showAlert('提示', '请输入审批标题'); return; }
        if (!departmentId) { this.showAlert('提示', '请选择所属部门'); return; }
        // 审批人可为空，后端会自动根据汇报关系确定审批人

        var ccIds = (this._ccUsers || []).map(function(u) { return u.id; });
        var ccDeptIds = (this._ccDepartments || []).map(function(d) { return d.id; });
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
        };
        // Include recruit_data if recruit type
        if (type === 'recruit') {
            var rd = this._gatherRecruitData();
            if (rd) data.recruit_data = rd;
        }
        if (startDate) data.start_date = startDate.substring(0, 10);
        if (endDate) data.end_date = endDate.substring(0, 10);
        if (duration) data.duration = parseFloat(duration);
        if (amount) data.amount = parseFloat(amount);
        if (expenseType) data.expense_type = expenseType;
        if (expenseDate) data.expense_date = expenseDate;
        if (this._attachmentFiles.length) data.attachments = this._attachmentFiles.map(function (f) { return {url: f.url, name: f.name}; });

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
            this.showToast('提交失败' + (e.message || '请检查表单后重试'), true);
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
            cc_users: (this._ccUsers || []).map(function(u) { return u.id; }),
            cc_departments: (this._ccDepartments || []).map(function(d) { return d.id; }),
        };
        if (f.approval_type === 'recruit') {
            var rd = this._gatherRecruitData();
            if (rd) data.recruit_data = rd;
        }
        if (f.start_date) data.start_date = f.start_date.substring(0, 10);
        if (f.end_date) data.end_date = f.end_date.substring(0, 10);
        if (f.duration) data.duration = parseFloat(f.duration);
        if (f.amount) data.amount = parseFloat(f.amount);
        if (f.expense_type) data.expense_type = f.expense_type;
        if (f.expense_date) data.expense_date = f.expense_date;
        if (this._attachmentFiles.length) data.attachments = this._attachmentFiles.map(function (x) { return {url: x.url, name: x.name}; });
        try {
            if (this._isReEdit && this._reEditId) {
                await this.apiPost(OA_API_URL + '/approval/' + this._reEditId + '/update-draft/', data);
            } else {
                await this.apiPost(OA_API_URL + '/approval/draft/', data);
            }
            this.closeModal('createApprovalModal');
            this.showToast('草稿已保存', false);
            this.statusFilter = 'draft';
            document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.status === 'draft'); });
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
            if (d.expense_date) document.getElementById('newExpenseDate').value = d.expense_date;
            document.getElementById('newSignType').value = d.sign_type || 'orsign';
            document.getElementById('newApprovalMode').value = d.approval_mode || 'parallel';
            if (d.attachments && d.attachments.length) {
                this._attachmentFiles = d.attachments.map(function(u) {
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
                d.cc_users.forEach(function(u) {
                    if (u.cc_type === 'department') {
                        this._ccDepartments.push({id: u.id, name: u.name});
                    } else {
                        this._ccUsers.push({id: u.id, name: u.name, avatar: u.avatar || ''});
                    }
                }, this);
            }
            this._renderCcTags();
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
                d.approval_nodes.forEach(function(n) {
                    if (n.node_type === 'user' && n.user) {
                        this._approverNodes.push({type: 'user', id: n.user, label: n.user_name || '用户'});
                    } else if (n.node_type === 'department' && n.department) {
                        this._approverNodes.push({type: 'department', id: n.department, label: n.department_name || '部门'});
                    }
                }, this);
            }
            this._renderApproverNodes();
            this._isReEdit = true;
            this._reEditId = id;
            // Set current CC type to prevent config defaults from overwriting restored CC
            this._currentCcType = d.approval_type || '';
            // 选中审批类型卡片
            if (d.approval_type) this.selectType(d.approval_type);
            // 显示费用行
            if (d.approval_type === 'expense') {
                document.getElementById('expenseRow').style.display = 'grid';
                document.getElementById('expenseTypeGroup').style.display = '';
                document.getElementById('expenseDateGroup').style.display = '';
            }
            document.getElementById('saveDraftBtn').textContent = '重新保存';
            document.getElementById('submitApprovalBtn').innerHTML = '<i class="fas fa-paper-plane"></i> 重新提交';
            document.getElementById('createApprovalModal').style.display = 'flex';
            setTimeout(function() { document.getElementById('createApprovalModal').classList.add('show'); }, 10);
        } catch (e) {
            this.showAlert('加载失败', e.message);
        }
    }

    // ==================== 审批配置（企业管理员） ====================

    async openConfigModal() {
        this._configEditType = null;
        this._configEditSubTenant = '';
        this._configApprovers = [];
        this._configCcDepts = [];
        this._configCcUsers = [];
        this._configDeleteId = null;
        document.getElementById('configApprovalType').value = '';
        document.querySelectorAll('.config-type-card').forEach(function(c) { c.classList.remove('active'); });
        document.getElementById('configForm').style.display = 'none';
        document.getElementById('configDeleteBtn').style.display = 'none';
        // Load sub-tenant selector for group enterprises
        await this._loadSubTenants();
        // Load config list
        await this._renderConfigList();
        // Init search fields
        var self = this;
        setTimeout(function() {
            self._initConfigSearch('configApproverSearch', 'configApproverDropdown', self._searchConfigApprovers, self._addConfigApprover);
            self._initConfigSearch('configCcDeptSearch', 'configCcDeptDropdown', self._searchConfigCcDepts, self._addConfigCcDept);
            self._initConfigSearch('configCcUserSearch', 'configCcUserDropdown', self._searchConfigCcUsers, self._addConfigCcUser);
        }, 100);
        document.getElementById('approvalConfigModal').style.display = 'flex';
        setTimeout(function() {
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
                subTenants.forEach(function(st) {
                    var opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = (st.short_name || st.name) + '（' + (st.tenant_type || '公司') + '）';
                    sel.appendChild(opt);
                });
            }
        } catch(e) {
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
            var typeNames = {'leave':'请假','overtime':'加班','expense':'报销','trip':'出差','purchase':'采购','recruit':'招聘需求','other':'其他'};
            if (!configs.length) {
                container.innerHTML = '<div style="color:#909399;font-size:13px;padding:8px 0;">暂无配置</div>';
                return;
            }
            var currentSt = document.getElementById('configSubTenant') ? document.getElementById('configSubTenant').value : '';
            container.innerHTML = configs.map(function(c) {
                // Only show configs for the selected sub-tenant (or global when none selected)
                var cSt = c.sub_tenant ? String(c.sub_tenant) : '';
                if (currentSt && cSt !== currentSt) return '';
                if (!currentSt && cSt) return '';
                var sel = self._configEditType === c.approval_type ? ' style="background:#e8f4fd;font-weight:600;display:flex;align-items:center;justify-content:space-between;"' : '';
                var subTag = c.sub_tenant_name ? ' <span style="font-size:10px;color:#e67e22;">[' + self._escape(c.sub_tenant_name) + ']</span>' : '';
                return '<div class="config-list-item"' + sel + ' data-type="' + c.approval_type + '" onclick="approvalApp._editConfig(\'' + c.approval_type + '\')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
                    + '<span><i class="fas fa-tag" style="color:var(--primary-color,#409eff);margin-right:4px;font-size:11px;"></i>' + self._escape(typeNames[c.approval_type] || c.approval_type) + subTag + '</span>'
                    + '<span style="font-size:11px;color:#909399;">' + (c.department_name || '未设置') + '</span>'
                    + '</div>';
            }).join('');
        } catch(e) {
            console.error('Load config list failed:', e);
            container.innerHTML = '<div style="color:#f56c6c;font-size:13px;">加载失败</div>';
        }
    }

    _selectConfigType(type) {
        this._configEditType = type;
        document.getElementById('configApprovalType').value = type;
        document.querySelectorAll('.config-type-card').forEach(function(c) { c.classList.remove('active'); });
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
        if (!type) { form.style.display = 'none'; if (delBtn) delBtn.style.display = 'none'; return; }
        form.style.display = 'block';
        await this._loadConfigDepts();
        // 获取当前选中的子公司
        var subTenantId = document.getElementById('configSubTenant') ? document.getElementById('configSubTenant').value : '';
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var cfg = null;
            configs.forEach(function(c) {
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
                this._configApprovers = cfg.approver_user_details.map(function(u) {
                    return {id: u.id, name: u.name, position: u.position || ''};
                });
            }
            this._renderConfigApproverTags();
            this._configCcDepts = [];
            if (cfg && cfg.cc_department_details) {
                this._configCcDepts = cfg.cc_department_details.map(function(d) {
                    return {id: d.id, name: d.name};
                });
            }
            this._renderConfigCcDeptTags();
            this._configCcUsers = [];
            if (cfg && cfg.cc_user_details) {
                this._configCcUsers = cfg.cc_user_details.map(function(u) {
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
        } catch(e) {
            console.error('Load config failed:', e);
        }
    }

    _buildDepartmentTreeHtml(depts, selectedId) {
        var tree = {};
        depts.forEach(function(d) {
            var pid = d.parent_id != null ? d.parent_id : 0;
            if (!tree[pid]) tree[pid] = [];
            tree[pid].push(d);
        });
        var html = '<option value="">请选择</option>';
        var walk = function(pid, depth) {
            var children = tree[pid] || [];
            children.forEach(function(d) {
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
            depts.forEach(function(d) { allIds[d.id] = true; });
            var actualRoots = [];
            depts.forEach(function(d) {
                if (!allIds[d.parent_id]) actualRoots.push(d);
            });
            if (actualRoots.length) {
                html = '<option value="">请选择</option>';
                var renderFlat = function(items, depth) {
                    items.forEach(function(d) {
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
        } catch(e) {
            console.error('Load config depts failed:', e);
        }
    }

    _initConfigSearch(inputId, dropdownId, searchFn, addFn) {
        var self = this;
        var input = document.getElementById(inputId);
        var dd = document.getElementById(dropdownId);
        if (!input || !dd) return;
        var timer = null;
        input.oninput = function() {
            clearTimeout(timer);
            var val = input.value.trim();
            if (!val) { dd.style.display = 'none'; return; }
            timer = setTimeout(function() { searchFn.call(self, val, dd); }, 300);
        };
        input.onfocus = function() {
            if (input.value.trim()) searchFn.call(self, input.value.trim(), dd);
        };
    }

    async _searchConfigApprovers(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var selectedIds = {};
            (this._configApprovers || []).forEach(function(u) { selectedIds[u.id] = true; });
            dd.innerHTML = users.length ? users.map(function(u) {
                var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="if(!this.classList.contains(\'disabled\'))approvalApp._addConfigApprover(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + self._escape(u.position || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch(e) { console.error(e); }
    }

    _addConfigApprover(id, name, position) {
        if (this._configApprovers.some(function(u) { return u.id === id; })) return;
        this._configApprovers.push({id: id, name: name, position: position});
        this._renderConfigApproverTags();
        document.getElementById('configApproverDropdown').style.display = 'none';
        document.getElementById('configApproverSearch').value = '';
    }

    _removeConfigApprover(id) {
        this._configApprovers = this._configApprovers.filter(function(u) { return u.id !== id; });
        this._renderConfigApproverTags();
    }

    _renderConfigApproverTags() {
        var container = document.getElementById('configApproverTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configApprovers || []).map(function(u) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f0f9eb;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user-check" style="font-size:10px;color:#67c23a;"></i>'
                + '<span>' + self._escape(u.name) + '</span>'
                + (u.position ? '<span style="font-size:10px;color:#909399;">(' + self._escape(u.position) + ')</span>' : '')
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigApprover(' + u.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    }

    async _searchConfigCcDepts(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-departments/?search=' + encodeURIComponent(keyword));
            var depts = data.results || [];
            var selectedIds = {};
            (this._configCcDepts || []).forEach(function(d) { selectedIds[d.id] = true; });
            dd.innerHTML = depts.length ? depts.map(function(d) {
                var cls = selectedIds[d.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addConfigCcDept(' + d.id + ',\'' + self._escape(d.name) + '\')">'
                    + '<i class="fas fa-building" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#409eff;"></i>'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(d.name) + '</span>'
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到部门</div>';
            dd.style.display = 'block';
        } catch(e) { console.error(e); }
    }

    _addConfigCcDept(id, name) {
        if (this._configCcDepts.some(function(d) { return d.id === id; })) return;
        this._configCcDepts.push({id: id, name: name});
        this._renderConfigCcDeptTags();
        document.getElementById('configCcDeptDropdown').style.display = 'none';
        document.getElementById('configCcDeptSearch').value = '';
    }

    _removeConfigCcDept(id) {
        this._configCcDepts = this._configCcDepts.filter(function(d) { return d.id !== id; });
        this._renderConfigCcDeptTags();
    }

    _renderConfigCcDeptTags() {
        var container = document.getElementById('configCcDeptTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configCcDepts || []).map(function(d) {
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
            (this._configCcUsers || []).forEach(function(u) { selectedIds[u.id] = true; });
            dd.innerHTML = users.length ? users.map(function(u) {
                var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addConfigCcUser(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + (u.avatar || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch(e) { console.error(e); }
    }

    _addConfigCcUser(id, name, avatar) {
        if (this._configCcUsers.some(function(u) { return u.id === id; })) return;
        this._configCcUsers.push({id: id, name: name, avatar: avatar || ''});
        this._renderConfigCcUserTags();
        document.getElementById('configCcUserDropdown').style.display = 'none';
        document.getElementById('configCcUserSearch').value = '';
    }

    _removeConfigCcUser(id) {
        this._configCcUsers = this._configCcUsers.filter(function(u) { return u.id !== id; });
        this._renderConfigCcUserTags();
    }

    _renderConfigCcUserTags() {
        var container = document.getElementById('configCcUserTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configCcUsers || []).map(function(u) {
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
        if (!this._configDeleteId) { this.showAlert('提示', '未找到配置ID'); return; }
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
        } catch(e) {
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
        } else {
            fieldSel.innerHTML = '<option value="duration">天数/时长</option><option value="amount">金额</option><option value="headcount">招聘人数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值字段';
        }
    }

    async _saveConfig() {
        var type = document.getElementById('configApprovalType').value;
        if (!type) { this.showAlert('提示', '请选择审批类型'); return; }
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
            cc_departments: (this._configCcDepts || []).map(function(d) { return d.id; }),
            cc_users: (this._configCcUsers || []).map(function(u) { return u.id; }),
            approver_users: (this._configApprovers || []).map(function(u) { return u.id; }),
            sign_type: signType,
            approval_mode: apprMode,
            threshold_enabled: thEnabled,
            threshold_field: thField,
            threshold_value: thValue ? parseFloat(thValue) : null,
            threshold_department_id: thDeptId ? parseInt(thDeptId) : null,
            require_signature: document.getElementById('configRequireSignature') ? document.getElementById('configRequireSignature').checked : false,
        };
        if (subTenantId) data.sub_tenant_id = parseInt(subTenantId);
        try {
            await this.apiPost(OA_API_URL + '/approval/save-dept-config/', data);
            this.showToast('配置保存成功', false);
            this.closeModal('approvalConfigModal');
        } catch(e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    }

    // ==================== 详情 ====================

    async showDetail(id) {
        try {
            const d = await this.apiGet(OA_API_URL + '/approval/' + id + '/');
            const statusMap = {'draft': '草稿', 'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回', 'deferred': '暂缓', 'processing': '办理中', 'cancelled': '已撤回'};
            const scMap = {'draft': 'badge-default', 'pending': 'badge-info', 'approved': 'status-badge normal', 'rejected': 'status-badge late', 'deferred': 'status-badge deferred', 'processing': 'status-badge processing', 'cancelled': 'badge-default'};
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
            // 记录该审批是否需要手写签名
            this._currentApprovalRequireSignature = d.require_signature ? true : false;

            console.log('_currentApprovalRequireSignature:::', this._currentApprovalRequireSignature);

            var modeLabel = '';
            if (d.sign_type === 'countersign') modeLabel = '会签';
            else modeLabel = '或签';
            if (d.approval_mode === 'sequential') modeLabel += ' · 顺序审批';
            else modeLabel += ' · 并行审批';

            let html = '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label><i class="fas fa-user-circle" style="color:var(--primary-color,#409eff);"></i> 申请人</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + (d.applicant_avatar || defAv) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + (d.applicant === currentUserId ? '我' : this._escape(d.applicant_name || '')) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-tag" style="color:#409eff;"></i> 审批标题</label><span>' + this._escape(d.title) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-list" style="color:#67c23a;"></i> 审批类型</label><span><span class="type-icon-badge type-' + d.approval_type + '"><i class="fas ' + this._typeIcon(d.approval_type) + '"></i> ' + (tMap[d.approval_type] || d.approval_type) + '</span></span></div>'
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
                d.cc_users.forEach(function(cc) {
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

            // 招聘需求详情展示
            if (d.approval_type === 'recruit' && d.recruit_data) {
                var rd = d.recruit_data;
                var urgencyText = {'normal':'常规（7-15个工作日）','urgent':'紧急（3-7个工作日）','critical':'特急（3个工作日内）'};
                var empText = {'fulltime':'全职正式岗','parttime':'兼职岗','temporary':'临时顶岗'};
                var staffText = {'annual':'年度核定编制内招聘','supplement':'临时增补超编招聘'};
                var self = this;
                html += '<div class="detail-item full-width" style="border:1px solid #fef3e0;border-radius:8px;padding:12px;background:#fffbf0;margin-top:8px;">'
                    + '<div style="font-size:14px;font-weight:600;color:#e67e22;margin-bottom:8px;border-bottom:1px solid #fef3e0;padding-bottom:6px;"><i class="fas fa-user-plus"></i> 招聘需求详情</div>'
                    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">'
                    + '<div><strong>岗位名称：</strong>' + self._escape(rd.position_name || '-') + '</div>'
                    + '<div><strong>招聘人数：</strong>' + (rd.headcount || 0) + '人</div>'
                    + '<div style="grid-column:1/-1;"><strong>编制属性：</strong>' + (staffText[rd.staffing_type] || rd.staffing_type) + '</div>'
                    + (rd.staffing_remark ? '<div style="grid-column:1/-1;"><strong>超编说明：</strong>' + self._escape(rd.staffing_remark) + '</div>' : '')
                    + '<div style="grid-column:1/-1;margin-top:4px;"><strong>岗位职责：</strong><br>' + self._escape(rd.responsibilities || '-').replace(/\n/g,'<br>') + '</div>'
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

            if (d.content) html += '<div class="detail-item full-width"><label><i class="fas fa-align-left" style="color:#606266;"></i> 审批内容</label><span>' + this._escape(d.content) + '</span></div>';
            html += '</div>';

            // 审批节点进度
            if (d.approval_nodes && d.approval_nodes.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-sitemap" style="color:#67c23a;margin-right:6px;"></i>审批流程 <span style="font-size:12px;font-weight:400;color:var(--text-light,#909399);">根据汇报关系</span></h4>';
                d.approval_nodes.forEach(function (node, ni) {
                    var icon = node.node_type === 'department' ? 'fa-building' : (node.node_type === 'initiator' ? 'fa-play-circle' : 'fa-user-check');
                    var label = node.user_name || node.department_name || ('节点' + (ni + 1));
                    if (node.user_name && node.user_position) label += ', ' + node.user_position;
                    var typeLabel = node.node_type === 'department' ? '部门审批' : (node.node_type === 'initiator' ? '发起人' : (ni === 0 ? '直属上级' : '上级审批'));
                    var borderColor = node.node_type === 'initiator' ? 'var(--primary-color,#409eff)' : '#67c23a';
                    var iconColor = node.node_type === 'initiator' ? 'var(--primary-color,#409eff)' : '#67c23a';
                    html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-secondary,#f5f7fa);border-radius:8px;border-left:3px solid ' + borderColor + ';">'
                        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><i class="fas ' + icon + '" style="color:' + iconColor + ';font-size:13px;"></i><span style="font-weight:600;font-size:14px;">' + label + '</span><span style="font-size:11px;color:var(--text-light,#909399);background:#fff;padding:1px 8px;border-radius:4px;">' + typeLabel + '</span></div>';
                    (node.assignees || []).forEach(function (as) {
                        var stCls = as.status === 'approved' ? 'status-badge normal' : as.status === 'rejected' ? 'status-badge late' : as.status === 'deferred' ? 'status-badge deferred' : as.status === 'processing' ? 'status-badge processing' : 'badge-info';
                        var stTxt = as.status_display || (as.status === 'approved' ? '已通过' : as.status === 'rejected' ? '已驳回' : as.status === 'deferred' ? '暂缓' : as.status === 'processing' ? '办理中' : '待审批');
                        var av = as.user_avatar || defAv;
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:4px;">'
                            + '<img src="' + av + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                            + '<span style="flex:1;font-size:13px;">' + (as.user === currentUserId ? '我' : (as.user_name || '')) + (as.user_position ? '<span style="font-size:11px;color:#909399;margin-left:4px;">' + as.user_position + '</span>' : '') + (as.user_department ? '<span style="font-size:11px;color:#a0a0a0;margin-left:4px;">(' + approvalApp._escape(as.user_department) + ')</span>' : '') + '</span>'
                            + '<span class="' + stCls + '" style="font-size:11px;">' + stTxt + '</span>'
                            + (as.comment ? '<span style="font-size:12px;color:var(--text-light);">: ' + as.comment + '</span>' : '')
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
                    var actionText = log.action_display || (log.action === 'approve' ? '通过' : log.action === 'reject' ? '驳回' : log.action === 'deferred' ? '暂缓' : log.action === 'processing' ? '办理中' : log.action === 'resubmit' ? '重新提交' : log.action === 'cancel' ? '撤回' : '');
                    var operatorName = (log.operator === currentUserId) ? '我' : (log.operator_name || '系统');
                    if (log.operator_position && log.operator !== currentUserId) operatorName += ', ' + log.operator_position;
                    var attachHtml = '';
                    if (log.attachments && log.attachments.length) {
                        attachHtml = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
                        log.attachments.forEach(function(att) {
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

            document.getElementById('approvalDetailBody').innerHTML = html;

            // 设置副标题（截取过长标题）
            var subEl = document.getElementById('approvalDetailSubtitle');
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
            const footer = document.getElementById('approvalDetailFooter');
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
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'cancelled') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'approvalDetailModal\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 重新编辑</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.deleteDraft(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
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
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'rejected') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'approvalDetailModal\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 继续编辑</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'draft') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'approvalDetailModal\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 继续编辑</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.deleteDraft(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else {
                footer.innerHTML = '<button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
            }


            document.getElementById('approvalDetailModal').style.display = 'flex';
            setTimeout(function () {
                document.getElementById('approvalDetailModal').classList.add('show');
            }, 10);
        } catch (e) {
            console.error('加载详情失败:', e);
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
        overlay.innerHTML = '<span onclick="approvalApp._closePreview()" style="position:fixed;top:20px;right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<img src="' + url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + approvalApp._escape(name || '') + '</div>';
        document.body.appendChild(overlay);
        this._previewImgs = null;
        this._previewOverlay = overlay;
        var self = this;
        var keyHandler = function(e) { if (e.key === 'Escape') { self._closePreview(); e.preventDefault(); } };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) self._closePreview(); });
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
        } catch(e) {
            window.open(url, '_blank');
        }
    }

    // ==================== 图片预览 ====================

    _previewImage(idx) {
        var urls = this._previewUrls || [];
        var _getUrl = function(u) { return (typeof u === 'object' && u !== null) ? (u.url || u) : u; };
        var _getName = function(u) { return (typeof u === 'object' && u !== null) ? (u.name || '') : ''; };
        var imgs = urls.filter(function(u) {
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
        overlay.innerHTML = '<span onclick="approvalApp._closePreview()" style="position:fixed;top:20px;right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="approvalApp._previewNav(-1)" id="approvalPrevBtn" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="approvalApp._previewNav(1)" id="approvalNextBtn" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="previewMainImg" src="' + _getUrl(imgs[currentIdx]) + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div id="previewCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (currentIdx + 1) + ' / ' + imgs.length + '</div>';
        document.body.appendChild(overlay);
        this._previewImgs = imgs;
        this._previewCurrent = currentIdx;
        this._previewOverlay = overlay;
        var self = this;
        var keyHandler = function(e) {
            if (e.key === 'ArrowLeft') { self._previewNav(-1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { self._previewNav(1); e.preventDefault(); }
            else if (e.key === 'Escape') { self._closePreview(); e.preventDefault(); }
        };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) self._closePreview();
        });
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
        if (dir < 0 && this._previewCurrent <= 0) { this._approvalShowTip('已是第一张'); return; }
        if (dir > 0 && this._previewCurrent >= len - 1) { this._approvalShowTip('已是最后一张'); return; }
        this._previewCurrent += dir;
        var img = document.getElementById('previewMainImg');
        var item = this._previewImgs[this._previewCurrent];
        var src = (typeof item === 'object' && item !== null) ? (item.url || item) : item;
        if (img) img.src = src;
        var counter = document.getElementById('previewCounter');
        if (counter) counter.textContent = (this._previewCurrent + 1) + ' / ' + this._previewImgs.length;
        var p = document.getElementById('approvalPrevBtn');
        var n = document.getElementById('approvalNextBtn');
        if (p) { p.style.opacity = this._previewCurrent <= 0 ? '0.2' : '1'; p.style.cursor = this._previewCurrent <= 0 ? 'default' : 'pointer'; }
        if (n) { n.style.opacity = this._previewCurrent >= this._previewImgs.length - 1 ? '0.2' : '1'; n.style.cursor = this._previewCurrent >= this._previewImgs.length - 1 ? 'default' : 'pointer'; }
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
        tip._t = setTimeout(function() { tip.style.opacity = '0'; }, 1500);
    }

    // ==================== 打印 ====================
    _printDetail() {
        if (!this._printStyle) {
            this._printStyle = document.createElement('style');
            this._printStyle.textContent = '@media print{'
                + '@page{margin:12mm 15mm;}'
                + 'body{font-family:"Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif;color:#333;background:#fff;font-size:14px;line-height:1.6;}'
                + '.oa-container,#createApprovalModal,#rejectModal{display:none!important;}'
                + '#approvalDetailModal{position:static!important;display:block!important;background:none!important;backdrop-filter:none!important;opacity:1!important;}'
                + '.modal-content{box-shadow:none!important;max-width:100%!important;border-radius:0!important;padding:0;border:none!important;overflow:visible!important;}'
                + '.modal-header,.modal-footer{display:none!important;}'
                + '.modal-body{padding:0!important;}'
                + '.detail-grid{display:block!important;}'
                + '.detail-item{display:flex;padding:6px 0;border-bottom:1px solid #eee;page-break-inside:avoid;}'
                + '.detail-item label{width:100px;min-width:100px;font-size:12px;color:#888;font-weight:600;padding-right:12px;flex-shrink:0;}'
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
                + 'h4 i{display:none;}'
                + '.status-badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;}'
                + '.status-badge.normal{background:#f0f9eb;color:#67c23a;}'
                + '.status-badge.late{background:#fef0f0;color:#f56c6c;}'
                + '.badge-info{background:#e3f2fd;color:#1976d2;}'
                + '.badge-default{background:#f5f5f5;color:#999;}'
                + '.status-badge.deferred{background:#fdf6ec;color:#e6a23c;}'
                + '.status-badge.processing{background:#f3e8ff;color:#9b59b6;}'
                + 'img[onclick]{max-width:120px!important;max-height:120px!important;}'
                + 'a[href]{color:#409eff!important;text-decoration:underline!important;}'
                + '.btn{display:none!important;}'
                + '.detail-item a[target="_blank"]{display:inline-flex!important;align-items:center;padding:4px 8px;background:#f5f7fa;border-radius:4px;font-size:11px;color:#666!important;text-decoration:none!important;max-width:180px;}'
                + '.detail-item a[target="_blank"] i{color:#409eff!important;margin-right:4px;}'
                + '.detail-item a[target="_blank"] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
                + '}';
            document.head.appendChild(this._printStyle);
        }
        setTimeout(function(){ window.print(); }, 300);
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
        if (sigBox) { sigBox.classList.remove('sig-fullscreen'); sigBox.classList.remove('sig-rotate'); }
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
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    async _triggerActionUpload() {
        document.getElementById('actionFileInput').click();
    }

    async _handleActionFileSelect(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > this.fileMaxSizeMB * 1024 * 1024) { console.log('文件大小超过限制::', file.size); this.showAlert('提示', `文件大小不能超过${this.fileMaxSizeMB}MB`); return; }
        var formData = new FormData();
        formData.append('file', file);
        try {
            var resp = await fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: formData
            });
            if (!resp.ok) {
                var errData = await resp.json().catch(function(){ return {}; });
                throw new Error(errData.error || errData.detail || '上传失败');
            }
            var result = await resp.json();
            if (result.url) {
                if (!this._actionAttachments) this._actionAttachments = [];
                this._actionAttachments.push({url: result.url, name: result.name || file.name});
                this._renderActionAttachments();
            }
        } catch(e) { this.showAlert('错误', '附件上传失败'); }
    }

    _renderActionAttachments() {
        var container = document.getElementById('actionAttachmentPreview');
        if (!container) return;
        container.innerHTML = (this._actionAttachments || []).map(function(a) {
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
        try {
            await this.apiPost(OA_API_URL + '/approval/' + id + '/' + action + '/', data);
            this.closeModal('actionModal');
            this.closeModal('approvalDetailModal');
            this.loadList(this.currentPage);
        } catch (e) {
            console.error('操作失败:', e);
            // this.showAlert('操作失败', e.message || '请重试');
            this.showToast(('操作失败' +e.message || '请重试'), true);
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
        canvas.onmousedown = function(e) { self._sigStart(e, canvas); };
        canvas.onmousemove = function(e) { self._sigMove(e, canvas); };
        canvas.onmouseup = function(e) { self._sigEnd(e, canvas); };
        canvas.onmouseleave = function(e) { self._sigEnd(e, canvas); };
        canvas.ontouchstart = function(e) { e.preventDefault(); self._sigStart(e, canvas); };
        canvas.ontouchmove = function(e) { e.preventDefault(); self._sigMove(e, canvas); };
        canvas.ontouchend = function(e) { e.preventDefault(); self._sigEnd(e, canvas); };
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
        var pad = function(n) { return String(n).padStart(2, '0'); };
        var dateStr = '审批时间：' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
            + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        // 获取当前用户（审批人）姓名
        var approverName = '';
        try {
            var cu = JSON.parse(localStorage.getItem('current_user') || 'null');
            approverName = (cu && (cu.real_name || cu.name)) ? (cu.real_name || cu.name) : '';
        } catch (e) {}
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
        allBtns.forEach(function(b) {
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
            if (mc) { mc.classList.remove('maximized'); }
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


}
