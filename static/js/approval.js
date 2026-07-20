// static/js/approval.js - OA审批

const OA_API_URL = '/api/oa';

class ApprovalApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this.statusFilter = '';
        this.typeFilter = '';
        this._rejectId = null;
        this._attachmentFiles = [];
        this._approverNodes = [];
        this._isReEdit = false;
        this._reEditId = null;
        this._previewUrls = [];
        this._previewImgs = [];
        this._previewCurrent = 0;
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
                this.showToast('登录已过期，请重新登录', true)
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
                this.showToast('登录已过期，请重新登录', true)
                this.handleAuthError();
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
        const statusMap = {'draft': '草稿', 'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回', 'cancelled': '已撤回'};
        const scMap = {'draft': 'badge-default', 'pending': 'badge-info', 'approved': 'status-badge normal', 'rejected': 'status-badge late', 'cancelled': 'badge-default'};
        const tMap = {
            'leave': '请假',
            'overtime': '加班',
            'expense': '报销',
            'trip': '出差',
            'purchase': '采购',
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
                + '<span><i class="fas fa-clock"></i> ' + self._formatTime(r.created_at) + '</span>'
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
    }

    onTypeChange() {
        const type = document.getElementById('newApprovalType').value;
        const isExpense = type === 'expense';
        const hasDateFields = ['leave', 'overtime', 'trip'].includes(type);
        // 日期行：请假/加班/出差显示
        const dateRow = document.getElementById('dateRow');
        if (dateRow) dateRow.style.display = hasDateFields ? 'grid' : 'none';
        // 费用行：报销显示
        document.getElementById('expenseRow').style.display = isExpense ? 'grid' : 'none';
        document.getElementById('expenseTypeGroup').style.display = isExpense ? '' : 'none';
        document.getElementById('expenseDateGroup').style.display = isExpense ? '' : 'none';
        // 金额行：报销/采购显示
        var amountGroup = document.getElementById('amountGroup');
        if (amountGroup) amountGroup.style.display = (isExpense || type === 'purchase') ? '' : 'none';
    }

    _typeIcon(type) {
        var m = {'leave':'fa-plane-departure','overtime':'fa-clock','expense':'fa-file-invoice-dollar','trip':'fa-suitcase-rolling','purchase':'fa-shopping-cart','other':'fa-file'};
        return m[type] || 'fa-file';
    }
    _statusIcon(st) {
        var m = {'draft':'fa-pen','pending':'fa-hourglass-half','approved':'fa-check-circle','rejected':'fa-times-circle','cancelled':'fa-undo'};
        return m[st] || 'fa-circle';
    }

    filterByTypeBtn(el, type) {
        document.querySelectorAll('.type-filter-card').forEach(function(b) { b.classList.remove('active'); });
        el.classList.add('active');
        this.typeFilter = type;
        this.loadList(1);
    }

    calcDays() {
        var startVal = document.getElementById('newStartDate').value;
        var endVal = document.getElementById('newEndDate').value;
        if (startVal && endVal) {
            var start = new Date(startVal);
            var end = new Date(endVal);
            if (end >= start) {
                var diff = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
                document.getElementById('newDuration').value = diff;
            }
        }
    }

    // ==================== 新建审批 - 审批人配置 ====================

    async openCreateModal() {
        document.getElementById('createApprovalForm').reset();
        document.querySelectorAll('.type-card').forEach(function(c) { c.classList.remove('selected'); });
        document.getElementById('expenseTypeGroup').style.display = 'none';
        document.getElementById('expenseDateGroup').style.display = 'none';
        document.getElementById('expenseRow').style.display = 'none';
        var ar = document.getElementById('amountGroup');
        if (ar) ar.style.display = 'none';
        var dr = document.getElementById('dateRow');
        if (dr) dr.style.display = 'none';
        document.getElementById('attachmentPreview').innerHTML = '';
        document.getElementById('attachmentPreview').style.display = 'none';
        this._attachmentFiles = [];
        this._approverNodes = [];
        this._isReEdit = false;
        this._reEditId = null;
        var sdB = document.getElementById('saveDraftBtn');
        if (sdB) sdB.textContent = '存草稿';
        var sab = document.getElementById('submitApprovalBtn');
        if (sab) sab.innerHTML = '<i class="fas fa-paper-plane"></i> 提交审批';

        // 加载审批人下拉
        try {
            const admins = await this.apiGet(OA_API_URL + '/approval/admins/');
            const depts = await this.apiGet(OA_API_URL + '/approval/departments/');
            const sel = document.getElementById('approverUserSelect');
            sel.innerHTML = '<option value="">选择审批人或部门</option>';
            (admins.results || []).forEach(function (a) {
                sel.innerHTML += '<option value="user_' + a.id + '" data-type="user" data-id="' + a.id + '">' + a.name + '</option>';
            });
            (depts.results || []).forEach(function (d) {
                sel.innerHTML += '<option value="dept_' + d.id + '" data-type="department" data-id="' + d.id + '">' + d.name + '（部门）</option>';
            });
        } catch (e) {
            console.error(e);
        }

        // 加载部门下拉并默认选择用户所在部门
        try {
            var currentUser = window.approvalApp && window.approvalApp._currentUser;
            if (!currentUser) {
                try {
                    var uResp = await fetch('/api/auth/me/', { headers: TokenManager.getHeaders() });
                    var uRaw = await uResp.json();
                    currentUser = uRaw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(uRaw) : uRaw;
                    this._currentUser = currentUser;
                } catch(e) {}
            }
            var deptResp = await fetch(OA_API_URL + '/approval/all-departments/', { headers: TokenManager.getHeaders() });
            var deptData = await deptResp.json();
            var depts2 = deptData.results || [];
            var deptSel = document.getElementById('newDepartmentSelect');
            deptSel.innerHTML = '<option value="">请选择部门</option>';
            var userDeptId = currentUser && (currentUser.department_info ? currentUser.department_info.id : currentUser.department);
            (depts2 || []).forEach(function (d) {
                var selected = (userDeptId && d.id === userDeptId) ? ' selected' : '';
                deptSel.innerHTML += '<option value="' + d.id + '"' + selected + '>' + d.name + '</option>';
            });
        } catch (e) {
            console.error('加载部门失败:', e);
        }

        document.getElementById('createApprovalModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('createApprovalModal').classList.add('show');
        }, 10);
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
        const container = document.getElementById('approverNodeList');
        const self = this;
        if (!this._approverNodes.length) {
            container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 0;">暂未添加审批人，将自动分配给管理员</div>';
            return;
        }
        var iconMap = {'user': 'fa-user', 'department': 'fa-building'};
        container.innerHTML = this._approverNodes.map(function (n, i) {
            return '<div class="approver-node-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;margin-bottom:4px;border-left:3px solid var(--primary-color,#409eff);">'
                + '<i class="fas ' + (iconMap[n.type] || 'fa-user') + '" style="color:var(--primary-color,#409eff);"></i>'
                + '<span style="flex:1;font-size:13px;">' + self._escape(n.label) + '</span>'
                + '<span style="font-size:11px;color:var(--text-light,#909399);background:#fff;padding:2px 8px;border-radius:4px;">' + (n.type === 'user' ? '用户' : '部门') + '</span>'
                + '<button class="action-btn" onclick="approvalApp.removeApproverNode(' + i + ')" style="width:24px;height:24px;"><i class="fas fa-times" style="font-size:12px;"></i></button></div>';
        }).join('');
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
        if (file.size > 10 * 1024 * 1024) {
            this.showAlert('提示', '文件大小不能超过10MB');
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
        }).then(function (r) {
            return r.json();
        }).then(function (res) {
            if (res.url) {
                self._attachmentFiles.push({url: res.url, name: res.name});
                self._renderAttachments();
            } else {
                self.showAlert('提示', '上传失败');
            }
        }).catch(function (err) {
            self.showAlert('错误', '上传失败');
        });
    }

    _getFileIcon(name) {
        var ext = name.substring(name.lastIndexOf('.')).toLowerCase();
        if (ext.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'fa-file-image';
        if (ext.match(/\.(mp4|avi|mov|webm)$/)) return 'fa-file-video';
        if (ext.match(/\.(mp3|wav|ogg)$/)) return 'fa-file-audio';
        if (ext.match(/\.(pdf)$/)) return 'fa-file-pdf';
        if (ext.match(/\.(doc|docx)$/)) return 'fa-file-word';
        if (ext.match(/\.(xls|xlsx)$/)) return 'fa-file-excel';
        if (ext.match(/\.(zip|rar|7z)$/)) return 'fa-file-archive';
        return 'fa-file';
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
        if (!this._approverNodes.length) { this.showAlert('提示', '请至少添加一个审批人或审批部门'); return; }

        const data = {
            approval_type: type,
            title: title,
            content: content,
            department_id: parseInt(departmentId),
            sign_type: signType,
            approval_mode: approvalMode,
            approver_nodes: this._approverNodes,
        };
        if (startDate) data.start_date = startDate;
        if (endDate) data.end_date = endDate;
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
            this.showAlert('提交失败', e.message || '请检查表单后重试');
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
        };
        if (f.start_date) data.start_date = f.start_date;
        if (f.end_date) data.end_date = f.end_date;
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
            this.showAlert('保存失败', e.message);
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
            // 加载部门
            try {
                var deptResp = await fetch(OA_API_URL + '/approval/all-departments/', { headers: TokenManager.getHeaders() });
                var deptData = await deptResp.json();
                var deptOpts = deptData.results || [];
                var deptSel = document.getElementById('newDepartmentSelect');
                deptSel.innerHTML = '<option value="">请选择部门</option>';
                deptOpts.forEach(function(d2) {
                    deptSel.innerHTML += '<option value="' + d2.id + '" ' + (d.department === d2.id ? 'selected' : '') + '>' + d2.name + '</option>';
                });
            } catch(e) {}
            // 加载审批人
            try {
                var admins = await this.apiGet(OA_API_URL + '/approval/admins/');
                var depts = await this.apiGet(OA_API_URL + '/approval/departments/');
                var sel = document.getElementById('approverUserSelect');
                sel.innerHTML = '<option value="">选择审批人或部门</option>';
                (admins.results || []).forEach(function(a) { sel.innerHTML += '<option value="user_' + a.id + '" data-type="user" data-id="' + a.id + '">' + a.name + '</option>'; });
                (depts.results || []).forEach(function(d2) { sel.innerHTML += '<option value="dept_' + d2.id + '" data-type="department" data-id="' + d2.id + '">' + d2.name + '（部门）</option>'; });
            } catch(e) {}
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

    // ==================== 详情 ====================

    async showDetail(id) {
        try {
            const d = await this.apiGet(OA_API_URL + '/approval/' + id + '/');
            const statusMap = {'draft': '草稿', 'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回', 'cancelled': '已撤回'};
            const scMap = {'draft': 'badge-default', 'pending': 'badge-info', 'approved': 'status-badge normal', 'rejected': 'status-badge late', 'cancelled': 'badge-default'};
            const tMap = {
                'leave': '请假',
                'overtime': '加班',
                'expense': '报销',
                'trip': '出差',
                'purchase': '采购',
                'other': '其他'
            };
            const defAv = '/static/images/default-avatar.png';
            var currentUserId = parseInt(localStorage.getItem('user_id'));

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
            if (d.duration) html += '<div class="detail-item"><label><i class="fas fa-clock" style="color:#e6a23c;"></i> 天数</label><span>' + d.duration + '</span></div>';
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
                    if (isImg) {
                        html += '<a href="javascript:void(0)" onclick="approvalApp._previewImage(' + idx + ')" style="display:inline-block;" title="' + approvalApp._escape(origName) + '"><img src="' + url + '" style="width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid var(--border-color,#dcdfe6);cursor:pointer;" title="' + approvalApp._escape(origName) + '"></a>';
                    } else {
                        html += '<a href="' + url + '" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px;max-width:200px;" title="' + approvalApp._escape(origName) + '"><i class="fas fa-paperclip" style="color:var(--primary-color,#409eff);flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(origName) + '</span></a>';
                    }
                });
                html += '</div></div>';
                // 保存附件URL列表供预览使用
                this._previewUrls = attachUrls;
            }

            if (d.content) html += '<div class="detail-item full-width"><label><i class="fas fa-align-left" style="color:#606266;"></i> 审批内容</label><span>' + this._escape(d.content) + '</span></div>';
            html += '</div>';

            // 审批节点进度
            if (d.approval_nodes && d.approval_nodes.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-users" style="color:var(--primary-color,#409eff);margin-right:6px;"></i>审批节点</h4>';
                d.approval_nodes.forEach(function (node, ni) {
                    var icon = node.node_type === 'department' ? 'fa-building' : (node.node_type === 'initiator' ? 'fa-play-circle' : 'fa-user');
                    var label = node.user_name || node.department_name || ('节点' + (ni + 1));
                    var typeLabel = node.node_type === 'department' ? '部门审批' : (node.node_type === 'initiator' ? '发起人' : '用户审批');
                    html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-secondary,#f5f7fa);border-radius:8px;border-left:3px solid var(--primary-color,#409eff);">'
                        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><i class="fas ' + icon + '" style="color:var(--primary-color,#409eff);font-size:13px;"></i><span style="font-weight:600;font-size:14px;">' + label + '</span><span style="font-size:11px;color:var(--text-light,#909399);background:#fff;padding:1px 8px;border-radius:4px;">' + typeLabel + '</span></div>';
                    (node.assignees || []).forEach(function (as) {
                        var stCls = as.status === 'approved' ? 'status-badge normal' : as.status === 'rejected' ? 'status-badge late' : 'badge-info';
                        var stTxt = as.status_display || (as.status === 'approved' ? '已通过' : as.status === 'rejected' ? '已驳回' : '待审批');
                        var av = as.user_avatar || defAv;
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:4px;">'
                            + '<img src="' + av + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                            + '<span style="flex:1;font-size:13px;">' + (as.user === currentUserId ? '我' : (as.user_name || '')) + '</span>'
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
                    var actionText = log.action_display || (log.action === 'approve' ? '通过' : log.action === 'reject' ? '驳回' : log.action === 'resubmit' ? '重新提交' : log.action === 'cancel' ? '撤回' : '驳回');
                    var operatorName = (log.operator === currentUserId) ? '我' : (log.operator_name || '系统');
                    html += '<div class="timeline-item ' + log.action + '">'
                        + '<div class="timeline-header">' + operatorName + ' ' + actionText + '</div>'
                        + '<div class="timeline-time">' + (log.created_at ? new Date(log.created_at).toLocaleString() : '') + '</div>'
                        + (log.comment ? '<div class="timeline-comment">' + log.comment + '</div>' : '') + '</div>';
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
                    btns += '<button class="btn btn-primary" onclick="approvalApp.approve(' + d.id + ')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.openRejectModal(' + d.id + ')"><i class="fas fa-times"></i> 驳回</button>';
                }
                if (isApplicant) {
                    btns += ' <button class="btn btn-secondary" onclick="approvalApp.cancelApproval(' + d.id + ')"><i class="fas fa-undo"></i> 撤销</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'cancelled' || d.status === 'rejected') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'approvalDetailModal\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 重新编辑</button>';
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

    async approve(id) {
        try {
            await this.apiPost(OA_API_URL + '/approval/' + id + '/approve/', {comment: ''});
            this.closeModal('approvalDetailModal');
            this.loadList(this.currentPage);
        } catch (e) {
            console.error('审批通过失败:', e);
            this.showToast('审批通过失败: '+ e, true);
        }
    }

    openRejectModal(id) {
        this._rejectId = id;
        document.getElementById('rejectComment').value = '';
        document.getElementById('rejectModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('rejectModal').classList.add('show');
        }, 10);
    }

    async confirmReject() {
        if (!this._rejectId) return;
        const comment = document.getElementById('rejectComment').value.trim();
        try {
            await this.apiPost(OA_API_URL + '/approval/' + this._rejectId + '/reject/', {comment: comment});
            this.closeModal('rejectModal');
            this.closeModal('approvalDetailModal');
            this.loadList(this.currentPage);
        } catch (e) {
            console.error('驳回失败:', e);
            this.showToast('驳回失败: '+ e, true);
        }
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () {
                modal.style.display = 'none';
            }, 200);
        }
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
        const toast = document.getElementById('toast');
        if (!toast) return;
        const icon = isError ? 'fa-exclamation-circle' : 'fa-check-circle';
        const title = isError ? '错误' : '成功';
        const color = isError ? '#f56c6c' : '#67c23a';
        toast.innerHTML = '<div class="toast-content" style="border-left-color:' + color + ';">'
            + '<div class="toast-icon"><i class="fas ' + icon + '" style="color:' + color + ';"></i></div>'
            + '<div><div class="toast-title">' + title + '</div>'
            + '<div class="toast-text">' + this._escape(message) + '</div></div></div>';
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
    }


}
