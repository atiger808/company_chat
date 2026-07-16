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
            window.location.href = '/login/';
            return;
        }
        await this.loadList();
    }

    async apiGet(url) {
        const resp = await fetch(url, {headers: TokenManager.getHeaders()});
        if (!resp.ok) throw new Error('请求失败');
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
        const statusMap = {'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回', 'cancelled': '已撤回'};
        const scMap = {'pending': 'badge-info', 'approved': 'status-badge normal', 'rejected': 'status-badge late'};
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
                + '<span><i class="fas fa-tag"></i> ' + (tMap[r.approval_type] || r.approval_type) + '</span>'
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

    onTypeChange() {
        const type = document.getElementById('newApprovalType').value;
        const isExpense = type === 'expense';
        document.getElementById('expenseRow').style.display = isExpense ? 'grid' : 'none';
        document.getElementById('expenseTypeGroup').style.display = isExpense ? '' : 'none';
        document.getElementById('expenseDateGroup').style.display = isExpense ? '' : 'none';
    }

    // ==================== 新建审批 - 审批人配置 ====================

    async openCreateModal() {
        document.getElementById('createApprovalForm').reset();
        document.getElementById('expenseTypeGroup').style.display = 'none';
        document.getElementById('expenseDateGroup').style.display = 'none';
        document.getElementById('expenseRow').style.display = 'none';
        document.getElementById('attachmentPreview').innerHTML = '';
        document.getElementById('attachmentPreview').style.display = 'none';
        this._attachmentFiles = [];
        this._approverNodes = [];

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
        if (this._attachmentFiles.length) data.attachments = this._attachmentFiles.map(function (f) { return f.url; });

        try {
            await this.apiPost(OA_API_URL + '/approval/', data);
            this.closeModal('createApprovalModal');
            this.showToast('审批提交成功', false);
            this.loadList(1);
        } catch (e) {
            this.showAlert('提交失败', e.message || '请检查表单后重试');
        }
    }

    // ==================== 详情 ====================

    async showDetail(id) {
        try {
            const d = await this.apiGet(OA_API_URL + '/approval/' + id + '/');
            const statusMap = {'pending': '待审批', 'approved': '已通过', 'rejected': '已驳回', 'cancelled': '已撤回'};
            const scMap = {'pending': 'badge-info', 'approved': 'status-badge normal', 'rejected': 'status-badge late'};
            const tMap = {
                'leave': '请假',
                'overtime': '加班',
                'expense': '报销',
                'trip': '出差',
                'purchase': '采购',
                'other': '其他'
            };
            const defAv = '/static/images/default-avatar.png';

            var modeLabel = '';
            if (d.sign_type === 'countersign') modeLabel = '会签';
            else modeLabel = '或签';
            if (d.approval_mode === 'sequential') modeLabel += ' · 顺序审批';
            else modeLabel += ' · 并行审批';

            let html = '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label>申请人</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + (d.applicant_avatar || defAv) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + this._escape(d.applicant_name || '') + '</span></div>'
                + '<div class="detail-item"><label>审批标题</label><span>' + this._escape(d.title) + '</span></div>'
                + '<div class="detail-item"><label>审批类型</label><span>' + (tMap[d.approval_type] || d.approval_type) + '</span></div>'
                + '<div class="detail-item"><label>所属部门</label><span>' + this._escape(d.department_name || '-') + '</span></div>'
                + '<div class="detail-item"><label>审批方式</label><span>' + modeLabel + '</span></div>'
                + '<div class="detail-item"><label>状态</label><span class="' + (scMap[d.status] || '') + '">' + (statusMap[d.status] || d.status) + '</span></div>'
                + '<div class="detail-item"><label>创建时间</label><span>' + this._formatTime(d.created_at) + '</span></div>'
                + '<div class="detail-item"><label>更新时间</label><span>' + this._formatTime(d.updated_at) + '</span></div>';

            if (d.start_date) html += '<div class="detail-item"><label>开始日期</label><span>' + d.start_date + '</span></div>';
            if (d.end_date) html += '<div class="detail-item"><label>结束日期</label><span>' + d.end_date + '</span></div>';
            if (d.duration) html += '<div class="detail-item"><label>天数</label><span>' + d.duration + '</span></div>';
            if (d.amount) html += '<div class="detail-item"><label>金额</label><span>¥' + parseFloat(d.amount).toFixed(2) + '</span></div>';
            if (d.expense_type) html += '<div class="detail-item"><label>费用类型</label><span>' + (d.expense_type_display || d.expense_type) + '</span></div>';
            if (d.expense_date) html += '<div class="detail-item"><label>费用日期</label><span>' + d.expense_date + '</span></div>';
            if (d.approver_comment) html += '<div class="detail-item" style="grid-column:1/-1;"><label>审批意见</label><span>' + this._escape(d.approver_comment) + '</span></div>';

            // 附件预览
            if (d.attachments && d.attachments.length) {
                html += '<div class="detail-item full-width"><label>附件</label><div style="display:flex;flex-wrap:wrap;gap:8px;">';
                d.attachments.forEach(function (url) {
                    var name = url.split('/').pop() || '附件';
                    var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    if (isImg) {
                        html += '<a href="' + url + '" target="_blank" style="display:inline-block;"><img src="' + url + '" style="width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid var(--border-color,#dcdfe6);" title="' + name + '"></a>';
                    } else {
                        html += '<a href="' + url + '" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px;"><i class="fas fa-paperclip" style="color:var(--primary-color,#409eff);"></i>' + name + '</a>';
                    }
                });
                html += '</div></div>';
            }

            if (d.content) html += '<div class="detail-item full-width"><label>审批内容</label><span>' + this._escape(d.content) + '</span></div>';
            html += '</div>';

            // 审批节点进度
            if (d.approval_nodes && d.approval_nodes.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-users"></i> 审批节点</h4>';
                d.approval_nodes.forEach(function (node, ni) {
                    var icon = node.node_type === 'department' ? 'fa-building' : 'fa-user';
                    var label = node.user_name || node.department_name || ('节点' + (ni + 1));
                    html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-secondary,#f5f7fa);border-radius:8px;border-left:3px solid var(--primary-color,#409eff);">'
                        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><i class="fas ' + icon + '" style="color:var(--primary-color,#409eff);font-size:13px;"></i><span style="font-weight:600;font-size:14px;">' + label + '</span><span style="font-size:11px;color:var(--text-light,#909399);background:#fff;padding:1px 8px;border-radius:4px;">' + (node.node_type === 'department' ? '部门审批' : '用户审批') + '</span></div>';
                    (node.assignees || []).forEach(function (as) {
                        var stCls = as.status === 'approved' ? 'status-badge normal' : as.status === 'rejected' ? 'status-badge late' : 'badge-info';
                        var stTxt = as.status === 'approved' ? '已通过' : as.status === 'rejected' ? '已驳回' : '待审批';
                        var av = as.user_avatar || defAv;
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:4px;">'
                            + '<img src="' + av + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                            + '<span style="flex:1;font-size:13px;">' + (as.user_name || '') + '</span>'
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
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-history"></i> 审批记录</h4>'
                    + '<div class="approval-timeline">';
                d.logs.forEach(function (log) {
                    var actionText = log.action === 'approve' ? '通过' : '驳回';
                    html += '<div class="timeline-item ' + log.action + '">'
                        + '<div class="timeline-header">' + (log.operator_name || '系统') + ' ' + actionText + '</div>'
                        + '<div class="timeline-time">' + (log.created_at ? new Date(log.created_at).toLocaleString() : '') + '</div>'
                        + (log.comment ? '<div class="timeline-comment">' + log.comment + '</div>' : '') + '</div>';
                });
                html += '</div></div>';
            }

            document.getElementById('approvalDetailBody').innerHTML = html;

            // 底部按钮
            const footer = document.getElementById('approvalDetailFooter');
            const isAdmin = localStorage.getItem('user_type') === 'super_admin' || localStorage.getItem('user_type') === 'admin';
            if (d.status === 'pending') {
                footer.innerHTML = '<button class="btn btn-primary" onclick="approvalApp.approve(' + d.id + ')"><i class="fas fa-check"></i> 通过</button>'
                    + ' <button class="btn btn-danger" onclick="approvalApp.openRejectModal(' + d.id + ')"><i class="fas fa-times"></i> 驳回</button>'
                    + ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button>';
            } else {
                footer.innerHTML = '<button class="btn btn-secondary" onclick="approvalApp.closeModal(\'approvalDetailModal\')">关闭</button>';
            }

            document.getElementById('approvalDetailModal').style.display = 'flex';
            setTimeout(function () {
                document.getElementById('approvalDetailModal').classList.add('show');
            }, 10);
        } catch (e) {
            console.error('加载详情失败:', e);
        }
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
