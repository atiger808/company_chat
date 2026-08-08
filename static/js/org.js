// static/js/org.js - 组织架构主逻辑（v3）
// 依赖: tenant.js (TenantManager)

const ORG_API_URL = '/api/org';

/* ============================================================
 * UserSelector — 用户选择器（可复用）
 * ============================================================ */
class UserSelector {
    /**
     * @param {Object} options
     *   mode: 'single' | 'multi'
     *   onSelect: function(user) — single 模式选中回调
     *   onConfirm: function(users[]) — multi 模式确认回调
     *   excludeIds: [] — 排除的用户 ID 列表
     *   title: string — 弹窗标题
     *   searchPlaceholder: string
     */
    constructor(options) {
        this.options = Object.assign({
            mode: 'single',
            onSelect: null,
            onConfirm: null,
            excludeIds: [],
            title: '选择用户',
            searchPlaceholder: '搜索用户姓名或邮箱...'
        }, options);
        this._results = [];
        this._selected = [];
        this._modal = null;
        this._searchTimer = null;
    }

    show() {
        // 彻底清理旧的 UserSelector DOM
        var old = document.querySelector('.user-selector-instance');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        this._selected = [];
        this._results = [];
        var self = this;
        var isMulti = this.options.mode === 'multi';

        var modal = document.createElement('div');
        modal.className = 'modal user-selector-instance';
        modal.innerHTML = '<div class="modal-content" style="max-width:580px;border-radius:14px;">'
            + '<div class="modal-header"><h3><i class="fas fa-user"></i> ' + this.options.title + '</h3>'
            + '<button class="close-btn" onclick="window._userSelector&&window._userSelector.close()">&times;</button></div>'
            + '<div class="modal-body" style="padding:16px 20px;">'
            + '<div class="user-selector-search" style="position:relative;margin-bottom:12px;">'
            + '<i class="fas fa-search" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-light,#909399);"></i>'
            + '<input type="text" class="us-input form-input" style="padding-left:34px;box-sizing:border-box;" placeholder="' + this.options.searchPlaceholder + '">'
            + '</div>'
            + '<div class="us-results user-selector-results" style="max-height:320px;overflow-y:auto;"></div>'
            + (isMulti ? '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color,#ebeef5);">'
                + '<button class="btn" onclick="window._userSelector&&window._userSelector.close()">取消</button>'
                + '<button class="btn btn-primary" onclick="window._userSelector&&window._userSelector._confirmMulti()">确定</button>'
                + '</div>' : '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color,#ebeef5);">'
                + '<button class="btn" onclick="window._userSelector&&window._userSelector.close()">取消</button>'
                + '</div>')
            + '</div></div>';
        document.body.appendChild(modal);
        this._modal = modal;
        // 暴露全局引用（必须先设置，因为 onclick 会立即用到）
        window._userSelector = this;

        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);

        // 搜索输入事件
        var input = modal.querySelector('.us-input');
        if (input) {
            input.addEventListener('input', function(e) {
                clearTimeout(self._searchTimer);
                var val = e.target.value.trim();
                self._searchTimer = setTimeout(function() {
                    self._doSearch(val);
                }, 200);
            });
            setTimeout(function() { input.focus(); }, 150);
        }

        // 点击事件委托
        modal.addEventListener('click', function(e) {
            var item = e.target.closest('.user-selector-item');
            if (!item) return;
            var uid = parseInt(item.getAttribute('data-uid'));
            if (!uid) return;
            if (isMulti) {
                self._toggleUser(uid);
            } else {
                var user = self._results.filter(function(u) { return u.id === uid; })[0];
                if (user && self.options.onSelect) {
                    self.options.onSelect(user);
                }
                self.close();
            }
        });

        // 初始加载全部成员
        this._doSearch('');
    }

    close() {
        window._userSelector = null;
        if (this._modal) {
            this._modal.classList.remove('show');
            var el = this._modal;
            var self = this;
            setTimeout(function() {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                self._modal = null;
            }, 200);
        }
    }

    async _doSearch(q) {
        // 查询序列号，防止异步返回乱序覆盖结果
        this._seq = (this._seq || 0) + 1;
        var seq = this._seq;

        var container = this._modal ? this._modal.querySelector('.us-results') : null;
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin" style="color:var(--primary-color,#409eff);"></i></div>';
        try {
            var self = this;
            var url = ORG_API_URL + '/tenants/search_all_users/';
            if (q) url += '?q=' + encodeURIComponent(q);
            var resp = await fetch(url, { headers: TokenManager.getHeaders() });
            // 如果已不是最新查询，丢弃结果
            if (seq !== this._seq) return;
            if (!resp.ok) {
                container.innerHTML = '<div style="text-align:center;padding:20px;color:#f56c6c;">加载失败</div>';
                return;
            }
            var data = await resp.json();
            // 再次检查序列
            if (seq !== this._seq) return;
            var users = (data.results || []).filter(function(u) {
                return self.options.excludeIds.indexOf(u.id) === -1;
            });
            self._results = users;
            if (!users.length) {
                container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-light,#909399);font-size:13px;">' + (q ? '未找到匹配的用户' : '企业暂无其他成员') + '</div>';
                return;
            }
            var isMulti = self.options.mode === 'multi';
            var html = '';
            users.forEach(function(u, i) {
                var avatarHtml = u.avatar
                    ? '<img class="us-avatar" src="' + self._escape(u.avatar) + '">'
                    : '<div class="us-avatar us-avatar-placeholder">' + (u.real_name || u.username || '?')[0].toUpperCase() + '</div>';
                var checked = isMulti && self._selected.indexOf(u.id) !== -1;
                var inTenant = u.in_tenant;
                html += '<div class="user-selector-item' + (checked ? ' selected' : '') + '" data-uid="' + u.id + '">'
                    + avatarHtml
                    + '<div class="us-info"><div class="us-name">' + self._escape(u.real_name || u.username) + '</div>'
                    + '<div class="us-detail">' + self._escape(u.username || '') + (u.email ? ' · ' + self._escape(u.email) : '') + '</div></div>'
                    + '<div class="us-position">' + self._escape(u.position || '') + (inTenant ? '' : ' <span class="tag-outside">非企业成员</span>') + '</div>'
                    + (isMulti ? '<div class="us-checkbox"><i class="fas ' + (checked ? 'fa-check-circle' : 'fa-circle') + '"></i></div>' : '')
                    + '</div>';
            });
            container.innerHTML = html;

        } catch (e) {
            if (seq !== this._seq) return;
            if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:#f56c6c;">搜索失败</div>';
        }
    }

    _confirmMulti() {
        if (this.options.onConfirm) {
            var users = this._results.filter(function(u) {
                return this._selected.indexOf(u.id) !== -1;
            }.bind(this));
            this.options.onConfirm(users);
        }
        this.close();
    }

    _toggleUser(uid) {
        var pos = this._selected.indexOf(uid);
        if (pos === -1) {
            this._selected.push(uid);
        } else {
            this._selected.splice(pos, 1);
        }
        // 更新 UI
        var container = this._modal ? this._modal.querySelector('.us-results') : null;
        if (container) {
            var item = container.querySelector('.user-selector-item[data-uid="' + uid + '"]');
            if (item) {
                item.classList.toggle('selected');
                var cb = item.querySelector('.us-checkbox i');
                if (cb) cb.className = 'fas ' + (item.classList.contains('selected') ? 'fa-check-circle' : 'fa-circle');
            }
        }
    }

    _escape(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}


/* ============================================================
 * OrgApp — 组织架构主应用
 * ============================================================ */
class OrgApp {
    constructor() {
        this.currentDeptId = null;
        this.deptTree = [];
        this.currentMembers = [];
        this.membersPage = 1;
        this.membersTotal = 0;
        this._enterpriseMembers = [];
        this._collapsed = {};
        this._currentTenantId = null;
        this._chartModal = null;
        this._initialized = false;
        this.chat_login_url = '/login/';
    }

    async init() {
        if (this._initialized) return;
        this._initialized = true;

        if (window.tenantManager) {
            await tenantManager.init();
            this._updateTenantBar();
        }

        if (tenantManager.activeTenant) {
            await this.loadDeptTree();
        } else {
            this._showNoTenant();
        }
        this.bindEvents();
    }

    async refresh() {
        // 先清除旧数据，避免显示前一个企业内容
        this.currentDeptId = null;
        this.membersPage = 1;
        document.getElementById('deptDetailContainer').innerHTML =
            '<div class="empty-state"><i class="fas fa-sitemap"></i><p>请从左侧选择一个部门</p><div class="sub-text">点击部门名称查看详情和成员</div></div>';
        document.getElementById('membersContainer').innerHTML = '';

        if (window.tenantManager) {
            await tenantManager.init();
            this._updateTenantBar();
        }
        if (tenantManager.activeTenant) {
            await this.loadDeptTree();
        } else {
            this._showNoTenant();
        }
    }

    // ────────── 企业栏 ──────────

    _updateTenantBar() {
        var t = tenantManager.activeTenant;
        var nameEl = document.getElementById('orgTenantName');
        var roleEl = document.getElementById('orgTenantRole');
        if (!nameEl) return;
        if (t) {
            nameEl.textContent = t.short_name || t.name;
            var roleMap = { 'owner': '企业所有者', 'admin': '企业管理员', 'dept_admin': '部门管理员', 'member': '成员' };
            roleEl.textContent = roleMap[t.role] || '成员';
            // 集团企业显示"新增子公司"按钮
            var subBtn = document.getElementById('createSubTenantBtn');
            if (subBtn) {
                subBtn.style.display = (t.tenant_type === 'group') ? '' : 'none';
            }
        } else {
            nameEl.textContent = '未选择企业';
            roleEl.textContent = '点击选择';
        }
    }

    _showNoTenant() {
        var container = document.getElementById('deptTreeContainer');
        if (container) {
            container.innerHTML = '<div class="empty-state" style="padding:40px 20px;">'
                + '<i class="fas fa-building" style="font-size:40px;"></i><p>请先选择或创建企业</p>'
                + '<div class="sub-text">点击顶部企业栏切换</div></div>';
        }
        var detail = document.getElementById('deptDetailContainer');
        if (detail) {
            detail.innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><p>请先选择企业</p>'
                + '<div class="sub-text">选择企业后方可查看组织架构</div></div>';
        }
        var mc = document.getElementById('membersContainer');
        if (mc) mc.innerHTML = '';
    }

    // ────────── 部门树 ──────────

    async loadDeptTree() {
        var container = document.getElementById('deptTreeContainer');
        if (!container) return;
        container.innerHTML = '<div class="skeleton"><div class="skeleton-item"></div><div class="skeleton-item"></div><div class="skeleton-item"></div><div class="skeleton-item"></div></div>';
        try {
            // 集团模式：带 include_subtenants 参数显示子企业部门
            var currentTenant = localStorage.getItem('active_tenant');
            this._currentTenantId = null;
            if (currentTenant) {
                try { this._currentTenantId = JSON.parse(currentTenant).id; } catch(e) {}
            }
            var url = ORG_API_URL + '/departments/';
            var userType = localStorage.getItem('user_type');
            if (userType === 'super_admin' || userType === 'admin') {
                url += '?include_subtenants=1';
            }
            var resp = await fetch(url, {
                headers: TokenManager.getHeaders()
            });
            if (resp.status === 403) {
                container.innerHTML = '<div class="empty-state" style="padding:30px 16px;"><i class="fas fa-lock" style="font-size:32px;"></i><p>暂无权限查看部门</p></div>';
                return;
            }
            if (!resp.ok) return;
            var data = await resp.json();
            this.deptTree = data.results || data || [];
            this.renderDeptTree();
            if (this.deptTree.length && !this.currentDeptId) {
                var root = this.deptTree.find(function(d) { return !d.parent; }) || this.deptTree[0];
                if (root) this.selectDepartment(root.id);
            }
        } catch (e) {
            console.error('加载部门树失败:', e);
            container.innerHTML = '<div class="empty-state" style="padding:30px 16px;"><i class="fas fa-exclamation-triangle" style="font-size:32px;color:#f56c6c;"></i><p style="color:#f56c6c;">加载失败</p></div>';
        }
    }

    renderDeptTree() {
        var container = document.getElementById('deptTreeContainer');
        if (!container) return;
        var roots = this.deptTree.filter(function(d) { return !d.parent; });
        if (!roots.length) {
            container.innerHTML = '<div class="empty-state" style="padding:40px 20px;"><i class="fas fa-folder-open" style="font-size:40px;"></i><p>暂无部门</p><div class="sub-text">点击上方「新建部门」开始</div></div>';
            return;
        }
        container.innerHTML = this._buildTreeHTML(roots, 0);
    }

    _buildTreeHTML(depts, depth) {
        var self = this;
        var currentTenantId = this._currentTenantId;
        var html = '<div class="dept-tree-children">';
        depts.forEach(function(d) {
            var children = self.deptTree.filter(function(c) { return c.parent === d.id; });
            var hasChildren = children.length > 0;
            var isActive = self.currentDeptId === d.id;
            var isCollapsed = self._collapsed && self._collapsed[d.id];
            // 集团模式：显示子公司标签
            var tenantBadge = '';
            if (d.tenant_id && currentTenantId && parseInt(d.tenant_id) !== parseInt(currentTenantId)) {
                tenantBadge = '<span class="tenant-badge">' + self._escape(d.tenant_name || '') + '</span>';
            }
            // 企业部门标识（department_type=company）
            var companyBadge = d.department_type === 'company' && !d.converted_tenant ? '<span class="company-badge" title="企业部门"><i class="fas fa-building"></i></span>' : '';
            // 已转子公司标识
            var convertedBadge = d.converted_tenant ? '<span class="converted-badge" title="已转换为子公司 ' + self._escape(d.converted_tenant_name || '') + '"><i class="fas fa-building"></i></span>' : '';
            html += '<div class="dept-tree-node' + (isActive ? ' active' : '') + '">'
                + '<div class="dept-tree-node-content" data-dept-id="' + d.id + '">'
                + '<span class="toggle-icon">' + (hasChildren ? '<i class="fas fa-chevron-' + (isCollapsed ? 'right' : 'down') + '"></i>' : '') + '</span>'
                + '<span class="dept-icon"><i class="fas ' + (hasChildren ? 'fa-folder-open' : 'fa-building') + '"></i></span>'
                + '<span class="dept-name">' + self._escape(d.name) + companyBadge + tenantBadge + convertedBadge + '</span>'
                + '<span class="member-badge">' + (d.member_count || 0) + '</span>'
                + '</div>'
                + (hasChildren ? '<div class="dept-tree-children' + (isCollapsed ? ' collapsed' : '') + '">' + self._buildChildrenHTML(children, depth + 1) + '</div>' : '')
                + '</div>';
        });
        html += '</div>';
        return html;
    }

    /** 构建子部门列表（不含外层 .dept-tree-children 包装） */
    _buildChildrenHTML(depts, depth) {
        var self = this;
        var html = '';
        depts.forEach(function(d) {
            var children = self.deptTree.filter(function(c) { return c.parent === d.id; });
            var hasChildren = children.length > 0;
            var isActive = self.currentDeptId === d.id;
            var isCollapsed = self._collapsed && self._collapsed[d.id];
            var tenantBadge = '';
            if (d.tenant_id && self._currentTenantId && parseInt(d.tenant_id) !== parseInt(self._currentTenantId)) {
                tenantBadge = '<span class="tenant-badge">' + self._escape(d.tenant_name || '') + '</span>';
            }
            var companyBadge = d.department_type === 'company' && !d.converted_tenant ? '<span class="company-badge" title="企业部门"><i class="fas fa-building"></i></span>' : '';
            var convertedBadge = d.converted_tenant ? '<span class="converted-badge" title="已转换为子公司 ' + self._escape(d.converted_tenant_name || '') + '"><i class="fas fa-building"></i></span>' : '';
            html += '<div class="dept-tree-node' + (isActive ? ' active' : '') + '">'
                + '<div class="dept-tree-node-content" data-dept-id="' + d.id + '">'
                + '<span class="toggle-icon">' + (hasChildren ? '<i class="fas fa-chevron-' + (isCollapsed ? 'right' : 'down') + '"></i>' : '') + '</span>'
                + '<span class="dept-icon"><i class="fas ' + (hasChildren ? 'fa-folder-open' : 'fa-building') + '"></i></span>'
                + '<span class="dept-name">' + self._escape(d.name) + companyBadge + tenantBadge + convertedBadge + '</span>'
                + '<span class="member-badge">' + (d.member_count || 0) + '</span>'
                + '</div>'
                + (hasChildren ? '<div class="dept-tree-children' + (isCollapsed ? ' collapsed' : '') + '">' + self._buildChildrenHTML(children, depth + 1) + '</div>' : '')
                + '</div>';
        });
        return html;
    }

    // ────────── 部门选择与详情 ──────────

    async selectDepartment(deptId) {
        this.currentDeptId = deptId;
        this.membersPage = 1;
        document.querySelectorAll('.dept-tree-node').forEach(function(n) { n.classList.remove('active'); });
        if (deptId) {
            var activeContent = document.querySelector('.dept-tree-node-content[data-dept-id="' + deptId + '"]');
            if (activeContent) activeContent.closest('.dept-tree-node').classList.add('active');
            this._updateBreadcrumb(deptId);
            await Promise.all([this.loadDeptDetail(deptId), this.loadMembers(deptId)]);
        } else {
            this._updateBreadcrumb(null);
            document.getElementById('deptDetailContainer').innerHTML =
                '<div class="empty-state"><i class="fas fa-sitemap"></i><p>请从左侧选择一个部门</p><div class="sub-text">点击部门名称查看详情和成员</div></div>';
            document.getElementById('membersContainer').innerHTML = '';
        }
    }

    async _updateBreadcrumb(deptId) {
        var bc = document.getElementById('orgBreadcrumb');
        if (!bc) return;
        if (!deptId) {
            bc.innerHTML = '<span class="crumb-item" onclick="orgApp.selectDepartment(null)"><i class="fas fa-home"></i> 组织架构</span>';
            return;
        }
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/path/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var path = await resp.json();
            var self = this;
            var html = '<span class="crumb-item" onclick="orgApp.selectDepartment(null)"><i class="fas fa-home"></i> 组织架构</span>';
            path.forEach(function(p, i) {
                html += '<span class="sep">/</span>';
                if (i === path.length - 1) {
                    html += '<span class="crumb-item current">' + self._escape(p.name) + '</span>';
                } else {
                    html += '<span class="crumb-item" onclick="orgApp.selectDepartment(' + p.id + ')">' + self._escape(p.name) + '</span>';
                }
            });
            bc.innerHTML = html;
        } catch(e) {
            console.error('加载面包屑失败:', e);
        }
    }

    async loadDeptDetail(deptId) {
        var container = document.getElementById('deptDetailContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color,#409eff);"></i></div>';
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var d = await resp.json();
            this.renderDeptDetail(d);
        } catch (e) {
            console.error('加载部门详情失败:', e);
        }
    }

    renderDeptDetail(d) {
        var container = document.getElementById('deptDetailContainer');
        if (!container) return;
        var self = this;
        var typeMap = { 'company': '公司', 'department': '部门', 'group': '小组', 'virtual': '虚拟组织' };
        var visMap = { 'public': '全企业可见', 'department': '部门及子部门可见', 'custom': '自定义', 'hidden': '隐藏' };
        var isEditable = this._canEdit();
        var eyeIcon = d.visibility != 'hidden' ? 'fas fa-eye' : 'fas fa-eye-slash';
        var isDeptAdmin = this._isDeptAdmin();
        var mgrName = d.manager_name || '未设置';

        // 负责人和副负责人头像
        var managerHtml = '<span>' + this._escape(mgrName) + '</span>';
        if (d.manager_info && d.manager_info.avatar) {
            managerHtml = '<div class="leader-avatar-cell"><img class="mini-avatar" src="' + this._escape(d.manager_info.avatar) + '"><span>' + this._escape(d.manager_info.real_name || d.manager_info.username || '?') + '</span></div>';
        } else if (d.manager_info) {
            var initial = (d.manager_info.real_name || d.manager_info.username || '?')[0].toUpperCase();
            managerHtml = '<div class="leader-avatar-cell"><span class="mini-avatar-placeholder">' + initial + '</span><span>' + this._escape(d.manager_info.real_name || d.manager_info.username || '?') + '</span></div>';
        }

        var deputiesHtml = '';
        var deputiesList = d.deputy_managers_info || [];
        if (deputiesList.length) {
            deputiesHtml = '<div class="dept-detail-item" style="grid-column:1/-1;"><label>副负责人</label><div class="deputy-list">';
            deputiesList.forEach(function(dep) {
                var avHtml;
                if (dep.avatar) {
                    avHtml = '<img class="mini-avatar" src="' + self._escape(dep.avatar) + '">';
                } else {
                    var ini = (dep.real_name || dep.username || '?')[0].toUpperCase();
                    avHtml = '<span class="mini-avatar-placeholder">' + ini + '</span>';
                }
                deputiesHtml += '<span class="deputy-tag">' + avHtml + '<span>' + self._escape(dep.real_name) + '</span></span>';
            });
            deputiesHtml += '</div></div>';
        }
        container.innerHTML = '<div class="dept-detail-card">'
            + '<div class="dept-detail-header">'
            + '<div class="dept-icon-large"><i class="fas fa-building"></i></div>'
            + '<div class="dept-detail-info">'
            + '<h2>' + this._escape(d.name) + '</h2>'
            + '<div class="dept-meta">'
            + '<span><i class="fas fa-tag"></i> ' + (typeMap[d.department_type] || d.department_type || '部门') + '</span>'
            + '<span><i class="fas fa-users"></i> ' + (d.member_count || 0) + ' 人</span>'
            + '<span><i class="' + eyeIcon + '"></i> ' + (visMap[d.visibility] || '全企业可见') + '</span>'
            + (d.tenant_name && this._currentTenantId && parseInt(d.tenant) !== parseInt(this._currentTenantId)
                ? '<span><i class="fas fa-building" style="color:#e6a23c;"></i> ' + this._escape(d.tenant_name) + '</span>' : '')
            + '</div></div>'
            + (isEditable || isDeptAdmin ? '<div class="dept-detail-actions">'
                + '<button class="btn btn-sm" id="deptDetailToggleBtn" onclick="orgApp._toggleDeptDetail(' + d.id + ')" title="折叠详情"><i class="fas fa-chevron-up"></i></button>'
                + '<button class="btn btn-sm" onclick="orgApp.showEditDeptModal(' + d.id + ')" title="编辑部门"><i class="fas fa-edit"></i></button>'
                + '<button class="btn btn-sm" onclick="orgApp.showDeptLeadersModal(' + d.id + ')" title="负责人管理"><i class="fas fa-user-cog"></i></button>'
                + '<button class="btn btn-sm" onclick="orgApp.rebuildDeptGroup(' + d.id + ')" title="重构部门群"><i class="fas fa-users-cog"></i> 重构群</button>'
                + (d.converted_tenant ? '<button class="btn btn-sm" onclick="orgApp.revertToDepartment(' + d.id + ')" title="恢复为普通部门" style="border-color:#67c23a;color:#67c23a;"><i class="fas fa-undo"></i> 恢复部门</button>' : '<button class="btn btn-sm" onclick="orgApp.convertToTenant(' + d.id + ')" title="转换为子公司" style="border-color:#e6a23c;color:#e67e22;"><i class="fas fa-building"></i> 转子公司</button>')
                + '<button class="btn btn-sm btn-danger" onclick="orgApp.deleteDepartment(' + d.id + ')" title="删除部门"><i class="fas fa-trash-alt"></i></button>'
                + '</div>' : '<div class="dept-detail-actions">'
                + '<button class="btn btn-sm" id="deptDetailToggleBtn" onclick="orgApp._toggleDeptDetail(' + d.id + ')" title="折叠详情"><i class="fas fa-chevron-up"></i></button>'
                + '</div>')
            + '</div>'
            + '<div class="dept-detail-body" id="deptDetailBody_' + d.id + '">'
            + '<div class="dept-detail-item"><label>部门负责人</label>' + managerHtml + '</div>'
            + (deputiesList.length ? deputiesHtml : (isEditable ? '<div class="dept-detail-item"><label>副负责人</label><span class="value-muted">点击负责人管理按钮设置</span></div>' : ''))
            + '<div class="dept-detail-item"><label>部门编码</label><span>' + this._escape(d.code || '-') + '</span></div>'
            + '<div class="dept-detail-item"><label>上级部门</label><span>' + this._escape(d.parent_name || '无') + '</span></div>'
            + '<div class="dept-detail-item"><label>排序号</label><span>' + (d.sort_order || 0) + '</span></div>'
            + (d.converted_tenant ? '<div class="dept-detail-item" style="grid-column:1/-1;"><label style="color:#e67e22;"><i class="fas fa-building"></i> 已转换为子公司</label><span style="color:#e67e22;font-weight:600;">' + this._escape(d.converted_tenant_name || '') + '</span></div>' : '')
            + (d.description ? '<div class="dept-detail-item" style="grid-column:1/-1;"><label>描述</label><span>' + this._escape(d.description) + '</span></div>' : '')
            + '</div></div>'
            + '<div class="dept-detail-card" style="margin-top:16px;">'
            + '<div class="dept-detail-header"><div class="dept-icon-large" style="background:linear-gradient(135deg,#67c23a,#a0d911);"><i class="fas fa-sitemap"></i></div>'
            + '<div class="dept-detail-info"><h2>汇报关系</h2>'
            + '<div class="dept-meta"><span><i class="fas fa-user-tie"></i> 根据组织架构自动生成</span></div></div>'
            + '<div style="display:flex;gap:6px;align-items:center;">'
            + '<button class="btn btn-sm" id="reportToggleBtn_' + d.id + '" onclick="orgApp._toggleReportChain(' + d.id + ')" title="折叠汇报关系"><i class="fas fa-chevron-up"></i></button>'
            + '<button class="btn btn-sm" onclick="orgApp._zoomReportChain(\'out\', ' + d.id + ')" title="缩小"><i class="fas fa-search-minus"></i></button>'
            + '<span id="reportZoomLevel_' + d.id + '" style="font-size:12px;color:var(--text-light,#909399);min-width:36px;text-align:center;">100%</span>'
            + '<button class="btn btn-sm" onclick="orgApp._zoomReportChain(\'in\', ' + d.id + ')" title="放大"><i class="fas fa-search-plus"></i></button>'
            + '<button class="btn btn-sm" onclick="orgApp._zoomReportChain(\'reset\', ' + d.id + ')" title="重置缩放"><i class="fas fa-expand"></i></button>'
            + '<button class="btn btn-sm" onclick="orgApp._showReportFullscreen(' + d.id + ')" title="全屏查看"><i class="fas fa-expand-arrows-alt"></i></button>'
            + (isEditable ? '<button class="btn btn-sm" onclick="orgApp.rebuildReportRelations()" title="根据最新架构重建汇报关系"><i class="fas fa-sync-alt"></i> 重建</button>' : '')
            + '</div></div>'
            + '<div class="dept-detail-body" id="reportChainBody_' + d.id + '"><div class="report-chain" id="reportChain_' + d.id + '">'
            + '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin" style="color:var(--primary-color,#409eff);"></i></div>'
            + '</div></div></div>';
        // 加载汇报关系链
        this._loadReportChain(d.id, d.manager_info, d.manager_name);
    }

    async rebuildReportRelations() {
        var confirmed = await this.showConfirmDialog('重建汇报关系', '根据当前组织架构自动重建汇报关系？<br><small style="color:var(--text-light);">系统将根据部门负责人和部门层级关系自动生成</small>', 'confirm');
        if (!confirmed) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/rebuild_report_relations/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '重建失败');
            }
            var data = await resp.json();
            this._showToast(data.message || '汇报关系已重建');
            if (this.currentDeptId) {
                await this.loadDeptDetail(this.currentDeptId);
            }
        } catch (e) {
            this._showToast('重建失败: ' + e.message, true);
        }
    }

    async rebuildDeptGroup(deptId) {
        var confirmed = await this.showConfirmDialog('重构部门群', '根据当前部门信息自动创建或更新部门群？<br><small style="color:var(--text-light);">系统将同步部门名称、成员、负责人到部门群</small>', 'confirm');
        if (!confirmed) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/rebuild_group/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '重构失败');
            }
            var data = await resp.json();
            this._showToast(data.message || '部门群已重构');
            if (this.currentDeptId) {
                await this.loadDeptDetail(this.currentDeptId);
            }
        } catch (e) {
            this._showToast('重构失败: ' + e.message, true);
        }
    }

    async convertToTenant(deptId) {
        var confirmed = await this.showConfirmDialog('转换为子公司',
            '将当前部门转换为独立的企业（子公司）？<br><small style="color:var(--text-light);">部门成员将自动加入新企业，部门负责人成为企业管理员。</small>', 'confirm');
        if (!confirmed) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/convert_to_tenant/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({})
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '转换失败');
            }
            var data = await resp.json();
            this._showToast(data.message || '已转换为子公司');
            // 刷新页面以显示新企业
            if (window.tenantManager) {
                await window.tenantManager.loadTenants();
                await window.tenantManager._renderTenantList();
                var tenantId = data.tenant_id;
                if (tenantId && window.tenantManager.activeTenant && parseInt(window.tenantManager.activeTenant.id) === this._currentTenantId) {
                    await this.loadDeptTree();
                    if (this.currentDeptId) await this.loadDeptDetail(this.currentDeptId);
                }
            }
        } catch (e) {
            this._showToast('转换失败: ' + e.message, true);
        }
    }

    async revertToDepartment(deptId) {
        var confirmed = await this.showConfirmDialog('恢复为普通部门',
            '将该子公司恢复为普通部门？<br><small style="color:var(--text-light);">对应的子公司企业将被标记为不可用，成员仍需在其他企业中访问。</small>', 'confirm');
        if (!confirmed) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/revert_to_department/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({})
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '恢复失败');
            }
            var data = await resp.json();
            this._showToast(data.message || '已恢复为普通部门');
            // 刷新部门树
            if (window.tenantManager) {
                await window.tenantManager.loadTenants();
                await window.tenantManager._renderTenantList();
            }
            await this.loadDeptTree();
            if (this.currentDeptId) await this.loadDeptDetail(this.currentDeptId);
        } catch (e) {
            this._showToast('恢复失败: ' + e.message, true);
        }
    }

    async _loadReportChain(deptId, managerInfo, managerName) {
        var container = document.getElementById('reportChain_' + deptId);
        if (!container) return;
        try {
            var self = this;
            // 并行获取部门成员和子部门
            var [membersData, chartData] = await Promise.all([
                fetch(ORG_API_URL + '/departments/' + deptId + '/members/?page_size=100', { headers: TokenManager.getHeaders() }).then(function(r) { return r.ok ? r.json() : {results: []}; }),
                fetch(ORG_API_URL + '/departments/' + deptId + '/org_chart/', { headers: TokenManager.getHeaders() }).then(function(r) { return r.ok ? r.json() : null; })
            ]);
            var members = membersData.results || [];
            var subTree = chartData; // may have children

            if (!members.length && !managerInfo) {
                container.innerHTML = '<div class="empty-state" style="padding:20px;"><i class="fas fa-sitemap"></i><p>暂无汇报关系数据</p></div>';
                return;
            }

            this._reportZoom = this._reportZoom || {};
            this._reportPan = this._reportPan || {};
            this._reportZoom[deptId] = this._reportZoom[deptId] || 1;
            this._reportPan[deptId] = this._reportPan[deptId] || {x: 0, y: 0};
            var html = '<div class="org-report-pyramid-wrapper" id="reportWrapper_' + deptId + '" style="overflow:hidden;width:100%;cursor:grab;position:relative;padding:32px 40px;box-sizing:border-box;">'
                + '<div class="org-report-pyramid" id="reportPyramid_' + deptId + '" style="transform-origin:0 0;transition:none;">';

            // ─── 第1层：部门负责人 ───
            var mgrName = managerName || '未设置';
            var mgrHtml = self._buildPersonHtml(managerInfo, mgrName);
            html += self._buildPyramidLevel(mgrHtml, '部门负责人', 'crown', '#e6a23c', true);

            // ─── 第2层：副负责人（直接向负责人汇报） ───
            var deputies = members.filter(function(m) { return m.is_deputy; });
            var regularMembers = members.filter(function(m) { return !m.is_manager && !m.is_deputy; });

            if (deputies.length) {
                html += self._buildConnector();
                var depHtml = '';
                deputies.forEach(function(d) {
                    depHtml += self._buildPersonHtml(d, d.real_name || d.username);
                });
                html += self._buildPyramidLevel(depHtml, '副负责人 → 向负责人汇报', 'user-tie', '#67c23a', false);
            }

            // ─── 第3层：普通成员（向副负责人或直接向负责人汇报） ───
            if (regularMembers.length) {
                html += self._buildConnector();
                var memHtml = '';
                regularMembers.forEach(function(m) {
                    memHtml += self._buildPersonHtml(m, m.real_name || m.username);
                });
                var reportTo = deputies.length ? '向副负责人汇报' : '向负责人汇报';
                html += self._buildPyramidLevel(memHtml, '部门成员 · ' + reportTo, 'user', '#409eff', false);
            }

            // ─── 第4+层：子部门汇报链 ───
            if (subTree && subTree.children && subTree.children.length) {
                html += self._buildConnector();
                html += self._buildSubDeptTree(subTree.children, 0);
            }

            html += '<div class="report-footnote"><i class="fas fa-info-circle"></i> 汇报关系根据部门负责人和部门层级自动生成</div>';
            html += '</div></div>';  // close pyramid + wrapper
            container.innerHTML = html;
            // 初始化缩放状态
            this._reportZoom = this._reportZoom || {};
            this._reportPan = this._reportPan || {};
            this._reportZoom[deptId] = this._reportZoom[deptId] || 1;
            this._reportPan[deptId] = this._reportPan[deptId] || {x: 0, y: 0};
            // 绑定滚轮缩放和拖拽
            this._bindReportChartEvents(deptId);
        } catch (e) {
            container.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
        }
    }

    _buildPersonHtml(person, name) {
        if (!person) {
            return '<div class="pyramid-person"><span class="mini-avatar-placeholder">?</span><span class="pyramid-name">' + this._escape(name) + '</span></div>';
        }
        var avHtml;
        if (person.avatar) {
            avHtml = '<img class="mini-avatar" src="' + this._escape(person.avatar) + '">';
        } else {
            var ini = (person.real_name || person.username || name || '?')[0].toUpperCase();
            avHtml = '<span class="mini-avatar-placeholder">' + ini + '</span>';
        }
        return '<div class="pyramid-person">' + avHtml + '<span class="pyramid-name">' + this._escape(person.real_name || person.username || name) + '</span></div>';
    }

    _buildPyramidLevel(contentHtml, label, icon, color, isTop) {
        var extraClass = isTop ? ' pyramid-top' : '';
        return '<div class="pyramid-level' + extraClass + '">'
            + '<div class="pyramid-level-label"><i class="fas fa-' + icon + '" style="color:' + color + ';"></i> ' + this._escape(label) + '</div>'
            + '<div class="pyramid-level-content">' + contentHtml + '</div>'
            + '</div>';
    }

    _buildConnector() {
        return '<div class="pyramid-connector"><div class="pyramid-line"></div><i class="fas fa-chevron-down"></i></div>';
    }

    _buildSubDeptTree(children, depth) {
        if (!children || !children.length) return '';
        var self = this;
        var html = '<div class="pyramid-subdept" style="padding-left:' + (depth * 16) + 'px;">';
        children.forEach(function(child) {
            html += '<div class="pyramid-dept-block">'
                + '<div class="pyramid-dept-header"><i class="fas fa-building" style="color:#e6a23c;"></i> ' + self._escape(child.name) + '</div>'
                + '<div class="pyramid-dept-body">';
            if (child.manager) {
                html += '<div class="pyramid-report-row"><span class="pr-label">负责人</span><span class="pr-arrow">→</span><span class="pr-name">' + self._escape(child.manager) + ' <span class="pr-to">向上级汇报</span></span></div>';
            } else {
                html += '<div class="pyramid-report-row muted">无负责人</div>';
            }
            if (child.children && child.children.length) {
                html += self._buildSubDeptTree(child.children, depth + 1);
            }
            html += '</div></div>';
        });
        html += '</div>';
        return html;
    }

    // ────────── 成员列表（增强：添加/移除成员） ──────────

    // ────────── 汇报关系缩放 ──────────

    _zoomReportChain(dir, deptId) {
        this._reportZoom = this._reportZoom || {};
        this._reportPan = this._reportPan || {};
        var level = this._reportZoom[deptId] || 1;
        if (dir === 'in') level = Math.min(level + 0.15, 2.5);
        else if (dir === 'out') level = Math.max(level - 0.15, 0.3);
        else level = 1;
        this._reportZoom[deptId] = level;
        if (dir === 'reset') {
            this._reportPan[deptId] = {x: 0, y: 0};
        }
        this._applyReportTransform(deptId);
        var label = document.getElementById('reportZoomLevel_' + deptId);
        if (label) label.textContent = Math.round(level * 100) + '%';
    }

    _applyReportTransform(deptId) {
        var el = document.getElementById('reportPyramid_' + deptId);
        if (!el) return;
        var zoom = this._reportZoom[deptId] || 1;
        var pan = this._reportPan[deptId] || {x: 0, y: 0};
        el.style.transform = 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')';
    }

    /** 折叠/展开汇报关系图 */
    _toggleReportChain(deptId) {
        var body = document.getElementById('reportChainBody_' + deptId);
        var btn = document.getElementById('reportToggleBtn_' + deptId);
        if (!body) return;
        var isHidden = body.style.display === 'none';
        body.style.display = isHidden ? '' : 'none';
        if (btn) {
            btn.title = isHidden ? '折叠汇报关系' : '展开汇报关系';
            btn.innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>';
        }
    }

    /** 绑定汇报关系图的滚轮缩放和拖拽功能 */
    _bindReportChartEvents(deptId) {
        var wrapper = document.getElementById('reportWrapper_' + deptId);
        if (!wrapper) return;
        var self = this;
        var isDragging = false;
        var startX, startY, startPan;

        // 滚轮缩放
        wrapper.addEventListener('wheel', function(e) {
            e.preventDefault();
            var level = self._reportZoom[deptId] || 1;
            if (e.deltaY < 0) level = Math.min(level + 0.1, 2.5);
            else level = Math.max(level - 0.1, 0.3);
            self._reportZoom[deptId] = level;
            self._applyReportTransform(deptId);
            var label = document.getElementById('reportZoomLevel_' + deptId);
            if (label) label.textContent = Math.round(level * 100) + '%';
        }, { passive: false });

        // 拖拽平移
        wrapper.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startPan = { x: (self._reportPan[deptId] || {x:0}).x, y: (self._reportPan[deptId] || {y:0}).y };
            wrapper.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            self._reportPan[deptId] = { x: startPan.x + dx, y: startPan.y + dy };
            self._applyReportTransform(deptId);
        });

        document.addEventListener('mouseup', function() {
            if (isDragging) {
                isDragging = false;
                wrapper.style.cursor = 'grab';
            }
        });
    }

    /** 全屏查看汇报关系图 */
    async _showReportFullscreen(deptId) {
        var self = this;
        // Reuse existing modal or create new one
        var existing = document.getElementById('reportFullscreenModal');
        if (existing) {
            existing.style.display = 'flex';
            setTimeout(function() { existing.classList.add('show'); }, 10);
            // Render pyramid into it
            self._renderFullscreenReport(deptId, existing);
            return;
        }
        var overlay = document.createElement('div');
        overlay.id = 'reportFullscreenModal';
        overlay.className = 'modal';
        overlay.innerHTML = '<div class="modal-content" style="max-width:95vw;max-height:95vh;border-radius:14px;overflow:hidden;">'
            + '<div class="modal-header"><h3><i class="fas fa-sitemap" style="color:var(--primary-color,#409eff);"></i> 汇报关系 - 全屏查看</h3>'
            + '<div style="display:flex;align-items:center;gap:6px;">'
            + '<span id="reportFsZoomLevel" style="font-size:12px;color:var(--text-light,#909399);min-width:36px;text-align:center;">100%</span>'
            + '<button class="close-btn" onclick="orgApp._zoomFsReport(\'out\')" title="缩小" style="font-size:14px;width:32px;height:32px;"><i class="fas fa-search-minus"></i></button>'
            + '<button class="close-btn" onclick="orgApp._zoomFsReport(\'in\')" title="放大" style="font-size:14px;width:32px;height:32px;"><i class="fas fa-search-plus"></i></button>'
            + '<button class="close-btn" onclick="orgApp._zoomFsReport(\'reset\')" title="重置" style="font-size:14px;width:32px;height:32px;"><i class="fas fa-expand"></i></button>'
            + '<button class="close-btn" onclick="orgApp._closeFullscreenReport()" title="关闭" style="font-size:20px;width:32px;height:32px;">&times;</button>'
            + '</div></div>'
            + '<div class="modal-body" id="reportFsBody" style="padding:0;overflow:hidden;flex:1;min-height:400px;position:relative;overflow-y:auto;">'
            + '<div style="text-align:center;padding:60px;"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:var(--primary-color,#409eff);"></i></div>'
            + '</div></div>';
        document.body.appendChild(overlay);
        overlay.style.display = 'flex';
        setTimeout(function() { overlay.classList.add('show'); }, 10);
        self._renderFullscreenReport(deptId, overlay);
    }

    _renderFullscreenReport(deptId, modal) {
        var body = document.getElementById('reportFsBody');
        if (!body) return;
        // Clone the existing report pyramid content
        var srcWrapper = document.getElementById('reportWrapper_' + deptId);
        if (srcWrapper) {
            // Clone the pyramid content into fullscreen
            var clone = srcWrapper.cloneNode(true);
            clone.id = 'reportFsWrapper';
            clone.style.width = '100%';
            clone.style.maxWidth = '100%';
            clone.style.cursor = 'grab';
            body.innerHTML = '';
            body.appendChild(clone);
            // Bind fullscreen zoom/pan events
            this._bindFsReportEvents();
            // Sync zoom state
            var zoom = this._reportZoom && this._reportZoom[deptId] || 1;
            var pan = this._reportPan && this._reportPan[deptId] || {x: 0, y: 0};
            this._fsZoom = zoom;
            this._fsPan = {x: pan.x, y: pan.y};
            var pyramid = document.getElementById('reportFsWrapper');
            if (pyramid) {
                var inner = pyramid.querySelector('.org-report-pyramid');
                // If cloned inner doesn't exist, the source might have been flat
                if (!inner) {
                    // The wrapper itself is the pyramid-like content
                    pyramid.style.transformOrigin = '0 0';
                    pyramid.style.transform = 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')';
                } else {
                    inner.style.transformOrigin = '0 0';
                    inner.style.transform = 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')';
                }
            }
            var label = document.getElementById('reportFsZoomLevel');
            if (label) label.textContent = Math.round(zoom * 100) + '%';
        } else {
            // Report chain not loaded yet — reload the data into fullscreen
            body.innerHTML = '<div style="text-align:center;padding:60px;"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:var(--primary-color,#409eff);"></i><p style="margin-top:12px;">加载汇报关系...</p></div>';
            this._loadReportChainToFs(deptId);
        }
        this._fsDeptId = deptId;
    }

    async _loadReportChainToFs(deptId) {
        var self = this;
        var body = document.getElementById('reportFsBody');
        if (!body) return;
        try {
            var [membersData, chartData] = await Promise.all([
                fetch(ORG_API_URL + '/departments/' + deptId + '/members/?page_size=100', { headers: TokenManager.getHeaders() }).then(function(r) { return r.ok ? r.json() : {results: []}; }),
                fetch(ORG_API_URL + '/departments/' + deptId + '/org_chart/', { headers: TokenManager.getHeaders() }).then(function(r) { return r.ok ? r.json() : null; })
            ]);
            var members = membersData.results || [];
            var subTree = chartData;
            // Get department detail for manager name
            var deptResp = await fetch(ORG_API_URL + '/departments/' + deptId + '/', {
                headers: TokenManager.getHeaders()
            });
            var deptData = deptResp.ok ? await deptResp.json() : {};
            var managerInfo = deptData.manager_info || null;
            var managerName = deptData.manager_name || '未设置';

            this._reportZoom = this._reportZoom || {};
            this._reportPan = this._reportPan || {};
            this._reportZoom[deptId] = this._reportZoom[deptId] || 1;
            this._reportPan[deptId] = this._reportPan[deptId] || {x: 0, y: 0};

            var html = '<div class="org-report-pyramid-wrapper" id="reportFsWrapper" style="overflow:hidden;width:100%;cursor:grab;position:relative;padding:40px 60px;box-sizing:border-box;">'
                + '<div class="org-report-pyramid" id="reportFsPyramid" style="transform-origin:0 0;transition:none;">';

            var mgrHtml = this._buildPersonHtml(managerInfo, managerName);
            html += this._buildPyramidLevel(mgrHtml, '部门负责人', 'crown', '#e6a23c', true);

            var deputies = members.filter(function(m) { return m.is_deputy; });
            var regularMembers = members.filter(function(m) { return !m.is_manager && !m.is_deputy; });

            if (deputies.length) {
                html += this._buildConnector();
                var depHtml = '';
                deputies.forEach(function(d) { depHtml += self._buildPersonHtml(d, d.real_name || d.username); });
                html += this._buildPyramidLevel(depHtml, '副负责人 → 向负责人汇报', 'user-tie', '#67c23a', false);
            }

            if (regularMembers.length) {
                html += this._buildConnector();
                var memHtml = '';
                regularMembers.forEach(function(m) { memHtml += self._buildPersonHtml(m, m.real_name || m.username); });
                var reportTo = deputies.length ? '向副负责人汇报' : '向负责人汇报';
                html += this._buildPyramidLevel(memHtml, '部门成员 · ' + reportTo, 'user', '#409eff', false);
            }

            if (subTree && subTree.children && subTree.children.length) {
                html += this._buildConnector();
                html += this._buildSubDeptTree(subTree.children, 0);
            }

            html += '<div class="report-footnote"><i class="fas fa-info-circle"></i> 汇报关系根据部门负责人和部门层级自动生成</div>';
            html += '</div></div>';
            body.innerHTML = html;
            this._fsZoom = 1;
            this._fsPan = {x: 0, y: 0};
            this._bindFsReportEvents();
        } catch(e) {
            body.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>加载失败</p></div>';
        }
    }

    _bindFsReportEvents() {
        var wrapper = document.getElementById('reportFsWrapper');
        if (!wrapper) return;
        var self = this;
        var isDragging = false;
        var startX, startY, startPan;

        wrapper.addEventListener('wheel', function(e) {
            e.preventDefault();
            var rect = wrapper.getBoundingClientRect();
            var mx = e.clientX - rect.left;
            var my = e.clientY - rect.top;
            var zoom = self._fsZoom || 1;
            var pan = self._fsPan || {x: 0, y: 0};
            var factor = e.deltaY < 0 ? 0.15 : -0.15;
            var newZoom = Math.max(0.3, Math.min(zoom + factor, 3.5));
            // Zoom towards mouse cursor
            var scale = newZoom / zoom;
            pan.x = mx - (mx - pan.x) * scale;
            pan.y = my - (my - pan.y) * scale;
            self._fsZoom = newZoom;
            self._fsPan = pan;
            self._applyFsTransform();
        }, { passive: false });

        wrapper.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startPan = { x: (self._fsPan || {x: 0}).x, y: (self._fsPan || {y: 0}).y };
            wrapper.style.cursor = 'grabbing';
            wrapper.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            self._fsPan = { x: startPan.x + dx, y: startPan.y + dy };
            self._applyFsTransform();
        });

        document.addEventListener('mouseup', function() {
            if (!isDragging) return;
            isDragging = false;
            if (wrapper) wrapper.style.cursor = 'grab';
            wrapper.style.userSelect = '';
        });
    }

    _applyFsTransform() {
        var el = document.getElementById('reportFsPyramid') || document.getElementById('reportFsWrapper');
        if (!el) {
            // Try the wrapper itself if it's a non-standard structure
            el = document.getElementById('reportFsWrapper');
            if (!el) return;
        }
        var zoom = this._fsZoom || 1;
        var pan = this._fsPan || {x: 0, y: 0};
        // Determine which element to transform
        var inner = document.getElementById('reportFsPyramid');
        if (inner) {
            inner.style.transform = 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')';
        } else {
            el.style.transformOrigin = '0 0';
            el.style.transform = 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')';
        }
        var label = document.getElementById('reportFsZoomLevel');
        if (label) label.textContent = Math.round(zoom * 100) + '%';
    }

    _zoomFsReport(dir) {
        var cur = this._fsZoom || 1;
        if (dir === 'in') cur = Math.min(cur + 0.15, 3.5);
        else if (dir === 'out') cur = Math.max(cur - 0.15, 0.3);
        else {
            cur = 1;
            this._fsPan = {x: 0, y: 0};
        }
        this._fsZoom = cur;
        this._applyFsTransform();
    }

    _closeFullscreenReport() {
        var modal = document.getElementById('reportFullscreenModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    // ────────── 部门详情/成员折叠/展开 ──────────

    _toggleDeptDetail(deptId) {
        var body = document.getElementById('deptDetailBody_' + deptId);
        var btn = document.getElementById('deptDetailToggleBtn');
        if (!body) return;
        var isHidden = body.style.display === 'none';
        body.style.display = isHidden ? '' : 'none';
        if (btn) {
            btn.title = isHidden ? '折叠详情' : '展开详情';
            btn.innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>';
        }
    }

    _toggleDeptMembers(deptId) {
        var grid = document.getElementById('deptMembersGrid_' + deptId);
        var btn = document.getElementById('deptMembersToggleBtn_' + deptId);
        if (!grid) return;
        var isHidden = grid.style.display === 'none';
        grid.style.display = isHidden ? '' : 'none';
        if (btn) {
            btn.title = isHidden ? '折叠成员' : '展开成员';
            btn.innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i>' : '<i class="fas fa-chevron-down"></i>';
        }
    }

    async loadMembers(deptId, page) {
        if (page === undefined) page = this.membersPage;
        var container = document.getElementById('membersContainer');
        if (!container) return;
        container.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color,#409eff);"></i></div>';
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/members/?page=' + page + '&page_size=50', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var data = await resp.json();
            this.currentMembers = data.results || [];
            this.membersTotal = data.count || 0;
            this.membersPage = data.page || 1;
            this.renderMembers();
        } catch (e) {
            console.error('加载成员失败:', e);
        }
    }

    renderMembers() {
        var container = document.getElementById('membersContainer');
        if (!container) return;
        var canEdit = this._canEdit();
        var isAdmin = this._isAdmin();

        if (!this.currentMembers.length) {
            container.innerHTML = '<div class="members-section">'
                + '<div class="members-header"><h3><i class="fas fa-users" style="color:var(--primary-color,#409eff);"></i> 部门成员</h3>'
                + (canEdit ? '<div style="display:flex;gap:6px;">'
                    + '<button class="btn btn-sm btn-primary" onclick="orgApp.showAddMembersModal(' + this.currentDeptId + ')"><i class="fas fa-plus"></i> 选择成员</button>'
                    + '<button class="btn btn-sm" onclick="orgApp.syncAllMembers(' + this.currentDeptId + ')" title="一键同步所有企业成员到此部门"><i class="fas fa-sync-alt"></i> 全部同步</button>'
                    + '</div>' : '')
                + '</div>'
                + '<div style="padding:40px 20px;text-align:center;">'
                + '<i class="fas fa-users" style="font-size:48px;color:var(--text-light,#c0c4cc);opacity:0.5;margin-bottom:12px;"></i>'
                + '<p style="font-size:15px;font-weight:500;margin:0 0 6px;color:var(--text-primary,#303133);">此部门暂无成员</p>'
                + '<p style="font-size:13px;color:var(--text-light,#909399);margin:0 0 16px;">将企业用户分配到部门后，可在组织架构中查看和管理</p>'
                + '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">'
                + '<button class="btn btn-primary" onclick="orgApp.showAddMembersModal(' + this.currentDeptId + ')" style="padding:10px 24px;">'
                + '<i class="fas fa-user-plus"></i> 选择已有成员添加</button>'
                + '<button class="btn" onclick="orgApp.syncAllMembers(' + this.currentDeptId + ')" style="padding:10px 24px;">'
                + '<i class="fas fa-users"></i> 一键同步全部成员</button>'
                + '</div>'
                + '<p style="font-size:12px;color:var(--text-light,#c0c4cc);margin-top:12px;">选择成员：在弹窗中勾选要分配的用户 → 确定<br>全部同步：将企业所有成员一键加入此部门</p>'
                + '</div></div>';
            return;
        }
        var self = this;
        var html = '<div class="members-section">'
            + '<div class="members-header">'
            + '<h3><i class="fas fa-users" style="color:var(--primary-color,#409eff);"></i> 部门成员</h3>'
            + '<div style="display:flex;align-items:center;gap:6px;">'
            + '<button class="btn btn-sm" id="deptMembersToggleBtn_' + this.currentDeptId + '" onclick="orgApp._toggleDeptMembers(' + this.currentDeptId + ')" title="折叠成员" style="padding:3px 8px;font-size:12px;"><i class="fas fa-chevron-up"></i></button>'
            + '<span class="member-count">共 ' + this.membersTotal + ' 人</span>'
            + (canEdit ? '<button class="btn btn-sm btn-primary" onclick="orgApp.showAddMembersModal(' + this.currentDeptId + ')"><i class="fas fa-plus"></i> 添加成员</button>'
                + '<button class="btn btn-sm" onclick="orgApp.syncAllMembers(' + this.currentDeptId + ')" title="一键同步所有企业成员到此部门"><i class="fas fa-sync-alt"></i></button>' : '')
            + '</div></div>'
            + '<div class="members-grid" id="deptMembersGrid_' + this.currentDeptId + '">';

        this.currentMembers.forEach(function(m) {
            var avatarHtml;
            if (m.avatar) {
                avatarHtml = '<img class="member-avatar" src="' + self._escape(m.avatar) + '" alt="">';
            } else {
                var initial = (m.real_name || m.username || '?')[0].toUpperCase();
                avatarHtml = '<div class="member-avatar-placeholder">' + initial + '</div>';
            }
            var statusClass = m.is_active !== false ? 'active' : 'inactive';
            var roleBadge = '';
            if (m.is_manager) { roleBadge = '<span class="role-badge manager">负责人</span>'; }
            else if (m.is_deputy) { roleBadge = '<span class="role-badge deputy">副负责人</span>'; }
            html += '<div class="member-card">'
                + avatarHtml
                + '<div class="member-info">'
                + '<div class="member-name-row">'
                + '<span class="member-name">' + self._escape(m.real_name || m.username) + '</span>'
                + roleBadge
                + (m.is_primary ? '<span class="primary-tag">主部门</span>' : '')
                + '<span class="status-dot ' + statusClass + '"></span>'
                + '</div>'
                + '<div class="member-detail">'
                + (m.position ? '<span><i class="fas fa-briefcase"></i> ' + self._escape(m.position) : '<span><i class="fas fa-briefcase"></i> -')
                + (canEdit ? ' <i class="fas fa-pen member-pos-edit" onclick="event.stopPropagation();orgApp.showEditPositionModal(' + m.id + ', \'' + self._escape(m.position || '') + '\')" title="编辑职位"></i>' : '')
                + '</span>'
                + '<span><i class="fas fa-id-badge"></i> ' + self._escape(m.enterprise_role ? {'owner':'企业所有者','admin':'企业管理员','dept_admin':'部门管理员','member':'成员'}[m.enterprise_role] || m.enterprise_role : '成员') + '</span>'
                + (m.email ? '<span><i class="fas fa-envelope"></i> ' + self._escape(m.email) + '</span>' : '')
                + (canEdit && m.phone ? '<span><i class="fas fa-phone"></i> ' + self._escape(m.phone) + '</span>' : '')
                + '</div></div>'
                + (canEdit ? '<button class="btn-icon-sm btn-remove" onclick="orgApp.removeMember(' + m.id + ')" title="移出部门"><i class="fas fa-times"></i></button>' : '')
                + '</div>';
        });
        html += '</div></div>';
        container.innerHTML = html;
    }

    // ────────── 新建部门 ──────────

    showCreateDeptModal() {
        var modal = document.getElementById('createDeptModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'createDeptModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:640px;border-radius:14px;">'
                + '<div class="modal-header"><h3><i class="fas fa-plus-circle" style="color:var(--primary-color,#409eff);"></i> 新建部门</h3>'
                + '<button class="close-btn" onclick="orgApp.closeCreateDeptModal()">&times;</button></div>'
                + '<div class="modal-body">'
                + '<div class="form-group"><label>部门名称 <span class="required">*</span></label>'
                + '<input type="text" id="newDeptName" class="form-input" placeholder="请输入部门名称"></div>'
                + '<div class="form-group"><label>上级部门</label>'
                + '<select id="newDeptParent" class="form-select"><option value="">无（顶级部门）</option></select></div>'
                + '<div class="form-group"><label>部门负责人</label>'
                + '<div class="user-picker" id="newDeptManagerPicker" onclick="orgApp._pickManager(\'newDeptManagerId\', \'newDeptManagerDisplay\')">'
                + '<input type="hidden" id="newDeptManagerId" value="">'
                + '<div class="user-picker-display" id="newDeptManagerDisplay"><i class="fas fa-user"></i> 点击选择负责人</div>'
                + '<span class="user-picker-clear" style="display:none;" onclick="event.stopPropagation();orgApp._clearManager(\'newDeptManagerId\', \'newDeptManagerDisplay\')">&times;</span>'
                + '<i class="fas fa-chevron-right"></i>'
                + '</div></div>'
                + '<div class="form-group"><label>部门编码</label>'
                + '<input type="text" id="newDeptCode" class="form-input" placeholder="可选"></div>'
                + '<div class="form-group"><label>可见范围</label>'
                + '<select id="newDeptVisibility" class="form-select">'
                + '<option value="public">全企业可见</option>'
                + '<option value="department">仅本部门及子部门可见</option>'
                + '<option value="hidden">隐藏部门</option>'
                + '</select></div>'
                + '<div class="form-group"><label>排序号</label>'
                + '<input type="number" id="newDeptSort" class="form-input" value="0"></div>'
                + '<p id="createDeptError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '</div>'
                + '<div class="modal-footer"><button class="btn btn-secondary" onclick="orgApp.closeCreateDeptModal()">取消</button>'
                + '<button class="btn btn-primary" onclick="orgApp.confirmCreateDept()">创建</button></div></div>';
            document.body.appendChild(modal);
        }
        // 填充上级部门列表
        var parentSelect = document.getElementById('newDeptParent');
        if (parentSelect) {
            parentSelect.innerHTML = '<option value="">无（顶级部门）</option>';
            var self = this;
            var seen = {};
            this.deptTree.forEach(function(d) {
                if (!seen[d.id]) {
                    parentSelect.innerHTML += '<option value="' + d.id + '">' + (d.full_path || d.name) + '</option>';
                    seen[d.id] = true;
                }
            });
        }
        // 清空负责人选择
        document.getElementById('newDeptManagerId').value = '';
        document.getElementById('newDeptManagerDisplay').innerHTML = '<i class="fas fa-user"></i> 点击选择负责人';
        // 清空错误
        var errEl = document.getElementById('createDeptError');
        if (errEl) errEl.style.display = 'none';

        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
    }

    closeCreateDeptModal() {
        var modal = document.getElementById('createDeptModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    async confirmCreateDept() {
        var name = document.getElementById('newDeptName').value.trim();
        var errEl = document.getElementById('createDeptError');
        if (!name) {
            if (errEl) { errEl.textContent = '请输入部门名称'; errEl.style.display = 'block'; }
            return;
        }
        var parentVal = document.getElementById('newDeptParent').value;
        var managerVal = document.getElementById('newDeptManagerId').value;
        var data = {
            name: name,
            parent: parentVal ? parseInt(parentVal) : null,
            manager: managerVal ? parseInt(managerVal) : null,
            code: document.getElementById('newDeptCode').value.trim() || undefined,
            visibility: document.getElementById('newDeptVisibility').value || 'public',
            sort_order: parseInt(document.getElementById('newDeptSort').value) || 0,
        };
        try {
            var resp = await fetch(ORG_API_URL + '/departments/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '创建失败');
            }
            this.closeCreateDeptModal();
            this._showToast('部门创建成功');
            await this.loadDeptTree();
            if (errEl) errEl.style.display = 'none';
        } catch (e) {
            if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
            this._showToast(e.message, true);
        }
    }

    // ────────── 新增子公司 ──────────

    showCreateSubTenantModal() {
        var modal = document.getElementById('createSubTenantModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'createSubTenantModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:640px;border-radius:14px;">'
                + '<div class="modal-header"><h3><i class="fas fa-building" style="color:#e67e22;"></i> 新增子公司</h3>'
                + '<button class="close-btn" onclick="orgApp.closeCreateSubTenantModal()">&times;</button></div>'
                + '<div class="modal-body">'
                + '<div class="form-group"><label>子公司名称 <span class="required">*</span></label>'
                + '<input type="text" id="newSubTenantName" class="form-input" placeholder="请输入子公司名称"></div>'
                + '<div class="form-group"><label>企业类型 <span class="required">*</span></label>'
                + '<select id="newSubTenantType" class="form-select">'
                + '<option value="company">公司</option>'
                + '<option value="branch">分公司</option>'
                + '<option value="virtual">虚拟组织</option>'
                + '</select></div>'
                + '<div class="form-group"><label>所属部门 <span class="required">*</span></label>'
                + '<p style="font-size:12px;color:#909399;margin:0 0 6px;">该部门将作为子公司在集团组织架构中的节点</p>'
                + '<select id="newSubTenantParentDept" class="form-select"><option value="">顶级部门</option></select></div>'
                + '<div class="form-group"><label>子公司负责人</label>'
                + '<div class="user-picker" onclick="orgApp._pickManager(\'newSubTenantManagerId\', \'newSubTenantManagerDisplay\')">'
                + '<input type="hidden" id="newSubTenantManagerId" value="">'
                + '<div class="user-picker-display" id="newSubTenantManagerDisplay"><i class="fas fa-user"></i> 点击选择负责人</div>'
                + '<span class="user-picker-clear" style="display:none;" onclick="event.stopPropagation();orgApp._clearManager(\'newSubTenantManagerId\', \'newSubTenantManagerDisplay\')">&times;</span>'
                + '<i class="fas fa-chevron-right"></i>'
                + '</div></div>'
                + '<p id="createSubTenantError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '</div>'
                + '<div class="modal-footer"><button class="btn btn-secondary" onclick="orgApp.closeCreateSubTenantModal()">取消</button>'
                + '<button class="btn btn-primary" onclick="orgApp.confirmCreateSubTenant()" style="background:#e67e22;border-color:#e67e22;"><i class="fas fa-building"></i> 创建子公司</button></div></div>';
            document.body.appendChild(modal);
        }
        // 填充上级部门列表
        var parentSelect = document.getElementById('newSubTenantParentDept');
        if (parentSelect) {
            parentSelect.innerHTML = '<option value="">顶级部门</option>';
            var self = this;
            this.deptTree.forEach(function(d) {
                parentSelect.innerHTML += '<option value="' + d.id + '">' + (d.full_path || d.name) + '</option>';
            });
        }
        // 清空负责人
        document.getElementById('newSubTenantManagerId').value = '';
        document.getElementById('newSubTenantManagerDisplay').innerHTML = '<i class="fas fa-user"></i> 点击选择负责人';
        var errEl = document.getElementById('createSubTenantError');
        if (errEl) errEl.style.display = 'none';

        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
    }

    closeCreateSubTenantModal() {
        var modal = document.getElementById('createSubTenantModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    async confirmCreateSubTenant() {
        var name = document.getElementById('newSubTenantName').value.trim();
        var errEl = document.getElementById('createSubTenantError');
        if (!name) {
            if (errEl) { errEl.textContent = '请输入子公司名称'; errEl.style.display = 'block'; }
            return;
        }
        var data = {
            name: name,
            tenant_type: document.getElementById('newSubTenantType').value || 'company',
            parent_dept_id: document.getElementById('newSubTenantParentDept').value || null,
            manager_id: document.getElementById('newSubTenantManagerId').value || null,
        };
        try {
            var resp = await fetch(ORG_API_URL + '/departments/create_sub_tenant/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '创建失败');
            }
            this.closeCreateSubTenantModal();
            this._showToast('子公司创建成功');
            await this.loadDeptTree();
            // 刷新企业列表
            if (window.tenantManager) {
                await window.tenantManager.loadTenants();
            }
            if (errEl) errEl.style.display = 'none';
        } catch (e) {
            if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
            this._showToast(e.message, true);
        }
    }

    // ────────── 编辑部门 ──────────

    async showEditDeptModal(deptId) {
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var d = await resp.json();
            this._openEditModal(d);
        } catch (e) {
            console.error('加载部门信息失败:', e);
        }
    }

    _openEditModal(d) {
        var modal = document.getElementById('editDeptModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'editDeptModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:640px;border-radius:14px;">'
                + '<div class="modal-header"><h3><i class="fas fa-edit" style="color:var(--primary-color,#409eff);"></i> 编辑部门</h3>'
                + '<button class="close-btn" onclick="orgApp.closeEditDeptModal()">&times;</button></div>'
                + '<div class="modal-body">'
                + '<div class="form-group"><label>部门名称 <span class="required">*</span></label>'
                + '<input type="text" id="editDeptName" class="form-input" placeholder="请输入部门名称"></div>'
                + '<div class="form-group"><label>上级部门</label>'
                + '<select id="editDeptParent" class="form-select"><option value="">无（顶级部门）</option></select></div>'
                + '<div class="form-group"><label>部门负责人</label>'
                + '<div class="user-picker" id="editDeptManagerPicker" onclick="orgApp._pickManager(\'editDeptManagerId\', \'editDeptManagerDisplay\')">'
                + '<input type="hidden" id="editDeptManagerId" value="">'
                + '<div class="user-picker-display" id="editDeptManagerDisplay"><i class="fas fa-user"></i> 点击选择负责人</div>'
                + '<span class="user-picker-clear" style="display:none;" onclick="event.stopPropagation();orgApp._clearManager(\'editDeptManagerId\', \'editDeptManagerDisplay\')">&times;</span>'
                + '<i class="fas fa-chevron-right"></i>'
                + '</div></div>'
                + '<div class="form-group"><label>部门编码</label>'
                + '<input type="text" id="editDeptCode" class="form-input" placeholder="可选"></div>'
                + '<div class="form-group"><label>可见范围</label>'
                + '<select id="editDeptVisibility" class="form-select">'
                + '<option value="public">全企业可见</option>'
                + '<option value="department">仅本部门及子部门可见</option>'
                + '<option value="hidden">隐藏部门</option>'
                + '</select></div>'
                + '<div class="form-group"><label>排序号</label>'
                + '<input type="number" id="editDeptSort" class="form-input" value="0"></div>'
                + '<div class="form-group"><label>描述</label>'
                + '<textarea id="editDeptDesc" class="form-input" rows="2" placeholder="部门描述（可选）"></textarea></div>'
                + '<p id="editDeptError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '</div>'
                + '<div class="modal-footer"><button class="btn btn-secondary" onclick="orgApp.closeEditDeptModal()">取消</button>'
                + '<button class="btn btn-primary" id="editDeptConfirmBtn" onclick="orgApp.confirmEditDept()">保存</button></div></div>';
            document.body.appendChild(modal);
        }

        // 填充数据
        document.getElementById('editDeptName').value = d.name;
        document.getElementById('editDeptCode').value = d.code || '';
        document.getElementById('editDeptVisibility').value = d.visibility || 'public';
        document.getElementById('editDeptSort').value = d.sort_order || 0;
        document.getElementById('editDeptDesc').value = d.description || '';

        // 上级部门
        var parentSelect = document.getElementById('editDeptParent');
        if (parentSelect) {
            parentSelect.innerHTML = '<option value="">无（顶级部门）</option>';
            var self = this;
            var seen = {};
            this.deptTree.forEach(function(dept) {
                if (dept.id === d.id) return;
                if (!seen[dept.id]) {
                    parentSelect.innerHTML += '<option value="' + dept.id + '">' + (dept.full_path || dept.name) + '</option>';
                    seen[dept.id] = true;
                }
            });
            if (d.parent) parentSelect.value = d.parent;
        }

        // 负责人（d.manager = user ID, d.manager_name = display name）
        if (d.manager) {
            document.getElementById('editDeptManagerId').value = d.manager;
            var mgrName = d.manager_name || '';
            document.getElementById('editDeptManagerDisplay').innerHTML = '<i class="fas fa-user-check"></i> ' + this._escape(mgrName);
            var clearBtn = document.querySelector('#editDeptManagerPicker .user-picker-clear');
            if (clearBtn) clearBtn.style.display = '';
        } else if (d.manager_name) {
            document.getElementById('editDeptManagerId').value = '';
            document.getElementById('editDeptManagerDisplay').innerHTML = '<i class="fas fa-user-check"></i> ' + this._escape(d.manager_name);
        } else {
            document.getElementById('editDeptManagerId').value = '';
            document.getElementById('editDeptManagerDisplay').innerHTML = '<i class="fas fa-user"></i> 点击选择负责人';
        }

        this._editingDeptId = d.id;

        var errEl = document.getElementById('editDeptError');
        if (errEl) errEl.style.display = 'none';

        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
    }

    closeEditDeptModal() {
        var modal = document.getElementById('editDeptModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
        this._editingDeptId = null;
    }

    async confirmEditDept() {
        var deptId = this._editingDeptId;
        if (!deptId) return;
        var name = document.getElementById('editDeptName').value.trim();
        var errEl = document.getElementById('editDeptError');
        if (!name) {
            if (errEl) { errEl.textContent = '请输入部门名称'; errEl.style.display = 'block'; }
            return;
        }
        var parentVal = document.getElementById('editDeptParent').value;
        var managerVal = document.getElementById('editDeptManagerId').value;
        var data = {
            name: name,
            parent: parentVal ? parseInt(parentVal) : null,
            manager: managerVal ? parseInt(managerVal) : null,
            code: document.getElementById('editDeptCode').value.trim() || '',
            visibility: document.getElementById('editDeptVisibility').value || 'public',
            sort_order: parseInt(document.getElementById('editDeptSort').value) || 0,
            description: document.getElementById('editDeptDesc').value.trim() || '',
        };
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/', {
                method: 'PUT',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || err.manager?.error || err.parent?.error || err.name?.error || '保存失败');
            }
            this.closeEditDeptModal();
            this._showToast('部门已更新');
            await this.loadDeptTree();
            await this.selectDepartment(deptId);
            if (errEl) errEl.style.display = 'none';
        } catch (e) {
            console.error(e);
            this._showToast(e.message || e.error || e.detail || '保存失败', true);
            if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; };
        }
    }

    // ────────── 删除部门 ──────────

    deleteDepartment(deptId) {
        var confirmEl = document.getElementById('deleteDeptConfirm');
        if (!confirmEl) {
            confirmEl = document.createElement('div');
            confirmEl.id = 'deleteDeptConfirm';
            confirmEl.className = 'modal';
            confirmEl.innerHTML = '<div class="modal-content" style="max-width:520px;border-radius:14px;">'
                + '<div class="modal-header"><h3><i class="fas fa-exclamation-triangle" style="color:#f56c6c;"></i> 确认删除</h3></div>'
                + '<div class="modal-body" style="text-align:center;padding:24px;">'
                + '<i class="fas fa-trash-alt" style="font-size:48px;color:#f56c6c;margin-bottom:12px;"></i>'
                + '<p style="font-size:15px;font-weight:500;margin:0 0 6px;">确定要删除此部门吗？</p>'
                + '<p style="font-size:13px;color:var(--text-light,#909399);margin:0;">删除后不可恢复，部门成员将被移除</p>'
                + '</div>'
                + '<div class="modal-footer" style="justify-content:center;">'
                + '<button class="btn btn-secondary" onclick="orgApp._closeDeleteConfirm()">取消</button>'
                + '<button class="btn" style="background:#f56c6c;border-color:#f56c6c;color:#fff;" onclick="orgApp._doDelete()">确认删除</button>'
                + '</div></div>';
            document.body.appendChild(confirmEl);
        }
        this._deletingDeptId = deptId;
        confirmEl.style.display = 'flex';
        setTimeout(function() { confirmEl.classList.add('show'); }, 10);
    }

    _closeDeleteConfirm() {
        var el = document.getElementById('deleteDeptConfirm');
        if (el) {
            el.classList.remove('show');
            setTimeout(function() { el.style.display = 'none'; }, 200);
        }
        this._deletingDeptId = null;
    }

    async _doDelete() {
        var deptId = this._deletingDeptId;
        if (!deptId) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '删除失败');
            }
            this._closeDeleteConfirm();
            this._showToast('部门已删除');
            this.currentDeptId = null;
            await this.loadDeptTree();
            document.getElementById('deptDetailContainer').innerHTML =
                '<div class="empty-state"><i class="fas fa-sitemap"></i><p>请从左侧选择一个部门</p><div class="sub-text">点击部门名称查看详情和成员</div></div>';
            document.getElementById('membersContainer').innerHTML = '';
        } catch (e) {
            this._showToast('删除失败: ' + e.message, true);
        }
    }

    // ────────── 企业成员管理 ──────────

    async showEnterpriseMembers(page) {
        if (page === undefined) page = 1;

        // 切换到成员管理视图（清空当前选择）
        this.currentDeptId = null;
        document.querySelectorAll('.dept-tree-node').forEach(function(n) { n.classList.remove('active'); });
        var detail = document.getElementById('deptDetailContainer');
        var mc = document.getElementById('membersContainer');
        if (!detail) return;
        if (mc) mc.innerHTML = '';

        // 更新面包屑
        var bc = document.getElementById('orgBreadcrumb');
        if (bc) bc.innerHTML = '<span class="crumb-item"><i class="fas fa-users-cog"></i> 企业成员管理</span>';

        // 首次渲染：构建稳定的页面结构（搜索框不随结果刷新）
        if (!document.getElementById('enterpriseMembersContainer')) {
            detail.innerHTML = '<div class="dept-detail-card" id="enterpriseMembersContainer">'
                + '<div class="dept-detail-header">'
                + '<div class="dept-icon-large" style="background:linear-gradient(135deg,#409eff,#337ecc);"><i class="fas fa-users"></i></div>'
                + '<div class="dept-detail-info">'
                + '<h2>企业成员管理</h2>'
                + '<div class="dept-meta" id="emMeta"><span><i class="fas fa-users"></i> 加载中...</span></div>'
                + '</div></div>'
                + '<div style="padding:20px 24px;">'
                + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">'
                + '<div style="position:relative;flex:1;min-width:180px;"><i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-light,#909399);"></i>'
                + '<input type="text" id="enterpriseMemberSearch" placeholder="搜索姓名、用户名、邮箱..." style="padding-left:32px;width:100%;box-sizing:border-box;" class="form-input"></div>'
                + '<button class="btn btn-primary" onclick="orgApp.showInviteUserModal()" style="padding:10px 24px;"><i class="fas fa-user-plus"></i> 邀请用户加入企业</button>'
                + '</div>'
                + '<div style="font-size:13px;color:var(--text-light,#909399);margin-bottom:12px;">提示：不在企业的用户也可以在添加部门成员时自动加入企业</div>'
                + '<div id="emResults" style="min-height:100px;"><div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color,#409eff);"></i></div></div>'
                + '</div></div>';

            // 绑定搜索输入事件（实时搜索，不丢失焦点）
            var searchInput = document.getElementById('enterpriseMemberSearch');
            if (searchInput) {
                searchInput.addEventListener('input', function(e) {
                    clearTimeout(orgApp._emSearchTimer);
                    var val = e.target.value;
                    orgApp._emSearchTimer = setTimeout(function() {
                        orgApp._loadEnterpriseMembers(1, val);
                    }, 300);
                });
            }
        }

        // 加载数据（只更新结果区域）
        var searchQ = document.getElementById('enterpriseMemberSearch') ? document.getElementById('enterpriseMemberSearch').value.trim() : '';
        await this._loadEnterpriseMembers(page, searchQ);
    }

    async _loadEnterpriseMembers(page, searchQ) {
        var resultsContainer = document.getElementById('emResults');
        var metaEl = document.getElementById('emMeta');
        if (!resultsContainer) return;
        resultsContainer.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color,#409eff);"></i></div>';

        try {
            var tenantId = tenantManager.activeTenant ? tenantManager.activeTenant.id : null;
            if (!tenantId) { resultsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><p>请先选择企业</p></div>'; return; }
            var url = ORG_API_URL + '/tenants/' + tenantId + '/members/?page=' + page + '&page_size=20';
            if (searchQ) url += '&q=' + encodeURIComponent(searchQ);
            var resp = await fetch(url, {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) { resultsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#f56c6c;"></i><p>加载失败</p></div>'; return; }
            var data = await resp.json();
            var members = data.results || [];
            this._enterpriseMembers = members;
            var canEdit = this._canEdit();

            if (metaEl) metaEl.innerHTML = '<span><i class="fas fa-users"></i> 共 ' + (data.count || members.length) + ' 人</span>';

            var html = '';
            if (!members.length) {
                html = '<div class="empty-state"><i class="fas fa-users"></i><p>' + (searchQ ? '未找到匹配的成员' : '暂无企业成员') + '</p></div>';
            } else {
                html = '<div class="members-grid">';
                members.forEach(function(m) {
                    var avatarHtml = m.avatar
                        ? '<img class="member-avatar" src="' + orgApp._escape(m.avatar) + '">'
                        : '<div class="member-avatar-placeholder">' + (m.real_name || m.username || '?')[0].toUpperCase() + '</div>';
                    var roleMap = {'owner': '企业所有者', 'admin': '企业管理员', 'dept_admin': '部门管理员', 'member': '成员'};
                    // 默认企业
                    var defaultTenantName = '';
                    if (m.active_tenant_id && m.tenants && m.tenants.length) {
                        for (var ti = 0; ti < m.tenants.length; ti++) {
                            if (parseInt(m.tenants[ti].id) === parseInt(m.active_tenant_id)) {
                                defaultTenantName = m.tenants[ti].short_name || m.tenants[ti].name;
                                break;
                            }
                        }
                    }
                    // 主部门
                    var primaryDeptName = '';
                    if (m.org_departments && m.org_departments.length) {
                        for (var di = 0; di < m.org_departments.length; di++) {
                            if (m.org_departments[di].is_primary) {
                                primaryDeptName = m.org_departments[di].name;
                                break;
                            }
                        }
                    }
                    html += '<div class="member-card">'
                        + avatarHtml
                        + '<div class="member-info">'
                        + '<div class="member-name-row">'
                        + '<span class="member-name">' + orgApp._escape(m.real_name || m.username) + '</span>'
                        + '<span style="font-size:11px;padding:1px 8px;border-radius:4px;background:#ecf5ff;color:#409eff;">' + orgApp._escape(roleMap[m.role] || m.role || '') + '</span>'
                        + '</div>'
                        + '<div class="member-detail">'
                        + '<span><i class="fas fa-user"></i> ' + orgApp._escape(m.username) + '</span>'
                        + (canEdit && m.phone ? '<span><i class="fas fa-phone"></i> ' + orgApp._escape(m.phone) : '') + '</span>'
                        + (m.email ? '<span><i class="fas fa-envelope"></i> ' + orgApp._escape(m.email) : '') + '</span>'
                        + (m.position ? '<span title="职位"><i class="fas fa-briefcase"></i> ' + orgApp._escape(m.position) : '') + '</span>'
                        + (defaultTenantName ? '<span title="默认企业"><i class="fas fa-building" style="color:#e6a23c;"></i> ' + orgApp._escape(defaultTenantName) : '') + '</span>'
                        + (primaryDeptName ? '<span title="主部门"><i class="fas fa-sitemap" style="color:#67c23a;"></i> ' + orgApp._escape(primaryDeptName) : '') + '</span>'
                        + '</div></div>'
                        + '<div style="display:flex;flex-direction:column;gap:4px;">'
                        + (canEdit && m.role !== 'owner' ? '<button class="btn-icon-sm" onclick="orgApp._openEditEnterpriseMember(' + m.id + ')" title="编辑"><i class="fas fa-edit"></i></button>' : '')
                        + (canEdit && m.role !== 'owner' ? '<button class="btn-icon-sm btn-remove" onclick="orgApp.removeTenantMember(' + m.id + ')" title="移出企业"><i class="fas fa-user-minus"></i></button>' : '')
                        + '</div>'
                        + '</div>';
                });
                html += '</div>';
            }
            // 分页
            var totalPages = Math.ceil((data.count || 0) / (data.page_size || 20));
            if (totalPages > 1) {
                html += '<div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:16px 0;">'
                    + '<button class="btn btn-sm" onclick="orgApp._loadEnterpriseMembers(' + (page - 1) + ', \'' + orgApp._escape(searchQ || '') + '\')" ' + (page <= 1 ? 'disabled style="opacity:0.5;"' : '') + '><i class="fas fa-chevron-left"></i> 上一页</button>'
                    + '<span style="font-size:13px;color:var(--text-light,#909399);">第 ' + page + '/' + totalPages + ' 页</span>'
                    + '<button class="btn btn-sm" onclick="orgApp._loadEnterpriseMembers(' + (page + 1) + ', \'' + orgApp._escape(searchQ || '') + '\')" ' + (page >= totalPages ? 'disabled style="opacity:0.5;"' : '') + '>下一页 <i class="fas fa-chevron-right"></i></button>'
                    + '</div>';
            }
            resultsContainer.innerHTML = html;
        } catch (e) {
            console.error('加载企业成员失败:', e);
            resultsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#f56c6c;"></i><p>加载失败</p></div>';
        }
    }

    showInviteUserModal() {
        var selector = new UserSelector({
            mode: 'multi',
            title: '邀请用户加入企业',
            searchPlaceholder: '搜索用户名、姓名或邮箱...',
            excludeIds: [],
            onConfirm: function(users) {
                if (users && users.length) {
                    var ids = users.map(function(u) { return u.id; });
                    orgApp.confirmInviteToTenant(ids);
                }
            }
        });
        selector.show();
    }

    async confirmInviteToTenant(userIds) {
        var tenantId = tenantManager.activeTenant ? tenantManager.activeTenant.id : null;
        if (!tenantId) return;
        var added = 0;
        var errMsg = '';
        for (var i = 0; i < userIds.length; i++) {
            try {
                var resp = await fetch(ORG_API_URL + '/tenants/' + tenantId + '/invite/', {
                    method: 'POST',
                    headers: TokenManager.getHeaders(),
                    body: JSON.stringify({ user_id: userIds[i], role: 'member' })
                });
                if (resp.ok) added++;
                else {
                    var err = await resp.json();
                    throw new Error(err.error || err.detail || '邀请失败');
                }
            } catch (e) { console.error('邀请失败:', e);  errMsg = e}
        }

        if (added) {
            this._showToast('成功邀请 ' + added + ' 名用户加入企业');
            await this.showEnterpriseMembers();
            await tenantManager.init();
            tenantManager.updateTenantUI();
        } else {
            this._showToast('邀请失败: ' + errMsg, true);
        }
    }

    async removeTenantMember(userId) {
        var confirmed = await this.showConfirmDialog('移出企业', '确定要将该用户移出企业吗？<br><small style="color:var(--text-light);">移出后该用户将无法访问企业数据</small>', 'danger');
        if (!confirmed) return;
        var tenantId = tenantManager.activeTenant ? tenantManager.activeTenant.id : null;
        if (!tenantId) return;
        try {
            var resp = await fetch(ORG_API_URL + '/tenants/' + tenantId + '/remove_member/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({ user_id: userId })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '移出失败');
            }
            this._showToast('已移出企业');
            await this.showEnterpriseMembers();
        } catch (e) {
            this._showToast('移出失败: ' + e.message, true);
        }
    }

    // ────────── 企业成员编辑 ──────────

    _openEditEnterpriseMember(userId) {
        var m = null;
        for (var i = 0; i < this._enterpriseMembers.length; i++) {
            if (this._enterpriseMembers[i].id === userId) {
                m = this._enterpriseMembers[i];
                break;
            }
        }
        if (!m) { this._showToast('用户数据未找到', true); return; }
        var roleMap = {'owner': '企业所有者', 'admin': '企业管理员', 'dept_admin': '部门管理员', 'member': '普通成员'};
        var roleOptions = '';
        var roles = ['member', 'dept_admin', 'admin', 'owner'];
        var roleLabels = {'member': '普通成员', 'dept_admin': '部门管理员', 'admin': '企业管理员', 'owner': '企业所有者'};
        for (var r = 0; r < roles.length; r++) {
            var selected = (m.role === roles[r]) ? ' selected' : '';
            roleOptions += '<option value="' + roles[r] + '"' + selected + '>' + roleLabels[roles[r]] + '</option>';
        }

        var self = this;
        var dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = '<div class="confirm-dialog-content" style="max-width:480px;">'
            + '<div class="confirm-dialog-header">'
            + '<i class="fas fa-user-cog"></i>'
            + '<h3>编辑成员 - ' + this._escape(m.real_name || m.username) + '</h3>'
            + '<button class="close-btn" style="margin-left:auto;"><i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div class="confirm-dialog-body">'
            + '<div class="form-group"><label>企业角色</label>'
            + '<select id="eemRole" class="form-select">' + roleOptions + '</select></div>'
            + '<div class="form-group"><label>部门职位</label>'
            + '<input type="text" id="eemPosition" class="form-input" value="' + this._escape(m.position || '') + '" placeholder="职位名称" style="width:100%;box-sizing:border-box;"></div>'
            + '<div class="form-group"><label>主部门</label>'
            + '<select id="eemPrimaryDept" class="form-select"><option value="">加载中...</option></select></div>'
            + '<div class="form-group"><label>默认企业（登录时默认选中）</label>'
            + '<select id="eemDefaultTenant" class="form-select"><option value="">加载中...</option></select></div>'
            + '</div>'
            + '<div class="confirm-dialog-footer">'
            + '<button class="confirm-dialog-btn cancel">取消</button>'
            + '<button class="confirm-dialog-btn confirm">保存</button>'
            + '</div></div>';
        document.body.appendChild(dialog);

        // 异步加载部门列表和企业列表
        self._loadDeptOptionsForMember(m, m.active_tenant_id || null);
        self._loadTenantOptionsForMember(m);

        dialog.querySelector('.cancel').addEventListener('click', function() { self._closeDialog(dialog); });
        dialog.querySelector('.close-btn').addEventListener('click', function() { self._closeDialog(dialog); });
        dialog.querySelector('.confirm').addEventListener('click', function() {
            var role = document.getElementById('eemRole').value;
            var position = document.getElementById('eemPosition').value.trim();
            var primaryDeptId = document.getElementById('eemPrimaryDept').value;
            var defaultTenantId = document.getElementById('eemDefaultTenant').value;
            self._confirmEditEnterpriseMember(userId, role, position, primaryDeptId, defaultTenantId);
            self._closeDialog(dialog);
        });
        dialog.addEventListener('click', function(e) {
            if (e.target === dialog) self._closeDialog(dialog);
        });
        setTimeout(function() { dialog.classList.add('show'); }, 10);
    }

    _loadDeptOptionsForMember(m, tenantId) {
        var sel = document.getElementById('eemPrimaryDept');
        if (!sel) return;
        var self = this;
        if (!tenantId) { sel.innerHTML = '<option value="">请先选择企业</option>'; return; }
        fetch(ORG_API_URL + '/departments/?tenant_id=' + tenantId, {
            headers: TokenManager.getHeaders()
        }).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
            if (!data) { sel.innerHTML = '<option value="">无法加载</option>'; return; }
            var depts = data.results || data || [];
            // 构建当前企业的部门ID集合，用于匹配成员的主部门
            var deptIds = {};
            depts.forEach(function(d) { deptIds[d.id] = true; });
            var userPrimaryDeptId = null;
            if (m.org_departments && m.org_departments.length) {
                for (var i = 0; i < m.org_departments.length; i++) {
                    if (m.org_departments[i].is_primary && deptIds[m.org_departments[i].id]) {
                        userPrimaryDeptId = m.org_departments[i].id;
                        break;
                    }
                }
            }
            // 构建树形结构
            var tree = {};
            depts.forEach(function(d) {
                var pid = d.parent != null ? d.parent : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });
            var html = '<option value="">未设置</option>';
            var walk = function(pid, depth) {
                var children = tree[pid] || [];
                children.forEach(function(d) {
                    var prefix = '';
                    for (var j = 0; j < depth; j++) prefix += '—— ';
                    var companyIcon = d.department_type === 'company' ? ' \u{1F3E2}' : '';
                    var selected = (userPrimaryDeptId && parseInt(d.id) === parseInt(userPrimaryDeptId)) ? ' selected' : '';
                    html += '<option value="' + d.id + '"' + selected + '>' + prefix + self._escape(d.name) + companyIcon + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            // Fallback: 如果根节点parent_id不是0
            if (!tree[0] || !tree[0].length) {
                var allIds = {};
                depts.forEach(function(d) { allIds[d.id] = true; });
                var actualRoots = depts.filter(function(d) { return !allIds[d.parent]; });
                if (actualRoots.length) {
                    html = '<option value="">未设置</option>';
                    var renderFlat = function(items, depth) {
                        items.forEach(function(d) {
                            var prefix = '';
                            for (var j = 0; j < depth; j++) prefix += '—— ';
                            var companyIcon = d.department_type === 'company' ? ' \u{1F3E2}' : '';
                            var selected = (userPrimaryDeptId && parseInt(d.id) === parseInt(userPrimaryDeptId)) ? ' selected' : '';
                            html += '<option value="' + d.id + '"' + selected + '>' + prefix + self._escape(d.name) + companyIcon + '</option>';
                            var kids = tree[d.id] || [];
                            renderFlat(kids, depth + 1);
                        });
                    };
                    renderFlat(actualRoots, 0);
                }
            }
            sel.innerHTML = html;
        }).catch(function() { if (sel) sel.innerHTML = '<option value="">加载失败</option>'; });
    }

    _loadTenantOptionsForMember(m) {
        var sel = document.getElementById('eemDefaultTenant');
        if (!sel) return;
        var self = this;
        // 获取该成员所属的所有企业（从API返回的tenants字段）
        var tenants = m.tenants || [];
        if (tenants.length) {
            self._renderTenantOptions(sel, tenants, m.active_tenant_id);
        } else {
            // 降级：尝试从当前操作者的企业列表获取
            var userTenants = window.tenantManager && window.tenantManager.tenants ? window.tenantManager.tenants : [];
            if (userTenants.length) {
                self._renderTenantOptions(sel, userTenants, m.active_tenant_id);
            } else {
                sel.innerHTML = '<option value="">未加入任何企业</option>';
            }
        }
        // 切换企业时重新加载部门列表
        sel.onchange = function() {
            var tid = sel.value;
            self._loadDeptOptionsForMember(m, tid || null);
        };
    }

    _renderTenantOptions(sel, tenants, activeTenantId) {
        var html = '<option value="">不设置（自动选择默认企业）</option>';
        tenants.forEach(function(t) {
            var selected = (activeTenantId && parseInt(t.id) === parseInt(activeTenantId)) ? ' selected' : '';
            html += '<option value="' + t.id + '"' + selected + '>' + orgApp._escape(t.short_name || t.name) + '</option>';
        });
        sel.innerHTML = html;
    }

    async _confirmEditEnterpriseMember(userId, role, position, primaryDeptId, defaultTenantId) {
        var tenantId = tenantManager.activeTenant ? tenantManager.activeTenant.id : null;
        if (!tenantId) return;
        var data = { user_id: userId, role: role, position: position };
        if (primaryDeptId) data.primary_department_id = parseInt(primaryDeptId);
        if (defaultTenantId) data.default_tenant_id = parseInt(defaultTenantId);
        try {
            var resp = await fetch(ORG_API_URL + '/tenants/' + tenantId + '/update_member/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '更新失败');
            }
            this._showToast('成员信息已更新');
            await this.showEnterpriseMembers();
        } catch (e) {
            this._showToast('更新失败: ' + e.message, true);
        }
    }

    _closeDialog(el) {
        el.classList.remove('show');
        setTimeout(function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 300);
    }

    // ────────── 添加/移除成员 ──────────

    showAddMembersModal(deptId) {
        var currentMemberIds = this.currentMembers.map(function(m) { return m.id; });
        var selector = new UserSelector({
            mode: 'multi',
            title: '添加部门成员',
            searchPlaceholder: '搜索企业成员姓名或邮箱...',
            excludeIds: currentMemberIds,
            onConfirm: function(users) {
                if (users && users.length) {
                    var ids = users.map(function(u) { return u.id; });
                    orgApp.confirmAddMembers(deptId, ids);
                }
            }
        });
        selector.show();
    }

    async confirmAddMembers(deptId, userIds) {
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/add_members/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({ user_ids: userIds })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '添加失败');
            }
            this._showToast('成员已添加');
            await this.loadMembers(deptId);
        } catch (e) {
            this._showToast('添加失败: ' + e.message, true);
        }
    }

    async syncAllMembers(deptId) {
        var confirmed = await this.showConfirmDialog('同步全部成员', '将企业所有成员同步到此部门？<br><small style="color:var(--text-light);">不在部门的成员将被添加，已存在的成员不受影响</small>', 'confirm');
        if (!confirmed) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/sync_all_members/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '同步失败');
            }
            var data = await resp.json();
            this._showToast(data.message || '同步成功');
            await this.loadMembers(deptId);
        } catch (e) {
            this._showToast('同步失败: ' + e.message, true);
        }
    }

    async removeMember(userId) {
        if (!this.currentDeptId) return;
        var confirmed = await this.showConfirmDialog('移出部门', '确定要将该成员移出此部门吗？<br><small style="color:var(--text-light);">移出后该成员将不再属于此部门</small>', 'danger');
        if (!confirmed) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + this.currentDeptId + '/remove_members/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({ user_ids: [userId] })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '移除失败');
            }
            this._showToast('成员已移除');
            await this.loadMembers(this.currentDeptId);
        } catch (e) {
            this._showToast('移除失败: ' + e.message, true);
        }
    }

    // ────────── 职位编辑 ──────────

    showEditPositionModal(userId, currentPosition) {
        var self = this;
        var dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = '<div class="confirm-dialog-content" style="max-width:380px;">'
            + '<div class="confirm-dialog-header">'
            + '<i class="fas fa-user-tie"></i>'
            + '<h3>编辑职位</h3>'
            + '<button class="close-btn" style="margin-left:auto;"><i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div class="confirm-dialog-body">'
            + '<div class="form-group"><label>部门职位</label>'
            + '<input type="text" id="editPositionInput" class="form-input" value="' + this._escape(currentPosition) + '" placeholder="请输入职位名称" style="width:100%;box-sizing:border-box;"></div>'
            + '</div>'
            + '<div class="confirm-dialog-footer">'
            + '<button class="confirm-dialog-btn cancel">取消</button>'
            + '<button class="confirm-dialog-btn confirm" id="editPositionConfirmBtn">确定</button>'
            + '</div></div>';
        document.body.appendChild(dialog);

        var cancelBtn = dialog.querySelector('.cancel');
        var confirmBtn = dialog.querySelector('.confirm');
        var closeBtn = dialog.querySelector('.close-btn');
        var input = document.getElementById('editPositionInput');

        var closeDialog = function() {
            dialog.classList.remove('show');
            setTimeout(function() {
                if (dialog.parentNode) document.body.removeChild(dialog);
            }, 300);
        };

        cancelBtn.addEventListener('click', closeDialog);
        closeBtn.addEventListener('click', closeDialog);
        confirmBtn.addEventListener('click', function() {
            var pos = input.value.trim();
            self._confirmEditPosition(userId, pos);
            closeDialog();
        });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                var pos = input.value.trim();
                self._confirmEditPosition(userId, pos);
                closeDialog();
            }
        });
        dialog.addEventListener('click', function(e) {
            if (e.target === dialog) closeDialog();
        });

        setTimeout(function() { dialog.classList.add('show'); input.focus(); input.select(); }, 10);
    }

    async _confirmEditPosition(userId, position) {
        var deptId = this.currentDeptId;
        if (!deptId) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/update_member_position/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({ user_id: userId, position: position })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '更新失败');
            }
            this._showToast('职位已更新');
            await this.loadMembers(deptId);
        } catch (e) {
            this._showToast('更新失败: ' + e.message, true);
        }
    }

    // ────────── 负责人选择器 ──────────

    _pickManager(hiddenId, displayId, context) {
        var excludeIds = this._leadersDeputyUsers ? this._leadersDeputyUsers.map(function(u) { return u.id; }) : [];
        var selector = new UserSelector({
            mode: 'single',
            title: '选择部门负责人',
            searchPlaceholder: '搜索用户...',
            excludeIds: excludeIds,
            onSelect: function(user) {
                document.getElementById(hiddenId).value = user.id;
                var name = user.real_name || user.username;
                document.getElementById(displayId).innerHTML = '<i class="fas fa-user-check"></i> '
                    + (user.avatar ? '<img class="mini-avatar" src="' + orgApp._escape(user.avatar) + '">' : '<span class="mini-avatar-placeholder">' + (name[0] || '?').toUpperCase() + '</span>')
                    + ' ' + name;
                orgApp._leadersManagerUser = user;
                var display = document.getElementById(displayId);
                if (display) {
                    var picker = display.closest('.user-picker');
                    if (picker) {
                        var clearBtn = picker.querySelector('.user-picker-clear');
                        if (clearBtn) clearBtn.style.display = '';
                    }
                }
            }
        });
        selector.show();
    }

    _clearManager(hiddenId, displayId) {
        document.getElementById(hiddenId).value = '';
        this._leadersManagerUser = null;
        var display = document.getElementById(displayId);
        if (display) display.innerHTML = '<i class="fas fa-user"></i> 点击选择负责人';
        var picker = display ? display.closest('.user-picker') : null;
        if (picker) {
            var clearBtn = picker.querySelector('.user-picker-clear');
            if (clearBtn) clearBtn.style.display = 'none';
        }
    }

    // ────────── 负责人/副负责人管理 ──────────

    async showDeptLeadersModal(deptId) {
        // 先获取当前负责人和副负责人
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/leaders/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var data = await resp.json();
            this._openLeadersModal(deptId, data);
        } catch (e) {
            console.error('加载负责人信息失败:', e);
        }
    }

    _openLeadersModal(deptId, leadersData) {
        var modal = document.getElementById('leadersModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'leadersModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:620px;border-radius:14px;">'
                + '<div class="modal-header"><h3><i class="fas fa-user-tie" style="color:var(--primary-color,#409eff);"></i> 部门负责人管理</h3>'
                + '<button class="close-btn" onclick="orgApp.closeLeadersModal()">&times;</button></div>'
                + '<div class="modal-body">'
                + '<div class="form-group"><label>部门负责人 <span style="font-weight:400;color:var(--text-light,#909399);">（限1人）</span></label>'
                + '<div class="user-picker" id="leadersManagerPicker" onclick="orgApp._pickManager(\'leadersManagerId\', \'leadersManagerDisplay\', \'leaders\')">'
                + '<input type="hidden" id="leadersManagerId" value="">'
                + '<div class="user-picker-display" id="leadersManagerDisplay"><i class="fas fa-user"></i> 点击选择负责人</div>'
                + '<span class="user-picker-clear" style="display:none;" onclick="event.stopPropagation();orgApp._clearManager(\'leadersManagerId\', \'leadersManagerDisplay\')">&times;</span>'
                + '<i class="fas fa-chevron-right"></i></div></div>'
                + '<div class="form-group"><label>副负责人 <span style="font-weight:400;color:var(--text-light,#909399);">（可多选）</span></label>'
                + '<div class="user-picker" onclick="orgApp._pickDeputies()">'
                + '<div class="user-picker-display" id="leadersDeputiesDisplay"><i class="fas fa-users"></i> 点击选择副负责人</div>'
                + '<i class="fas fa-chevron-right"></i></div>'
                + '<div class="deputy-tags" id="leadersDeputyTags"></div></div>'
                + '<p id="leadersError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '</div>'
                + '<div class="modal-footer"><button class="btn btn-secondary" onclick="orgApp.closeLeadersModal()">取消</button>'
                + '<button class="btn btn-primary" onclick="orgApp.confirmLeaders()">保存</button></div></div>';
            document.body.appendChild(modal);
        }
        // 存储当前编辑的部门ID
        this._leadersDeptId = deptId;
        // 填充数据
        this._leadersDeputyUsers = [];
        if (leadersData.manager) {
            document.getElementById('leadersManagerId').value = leadersData.manager.id;
            this._leadersManagerUser = leadersData.manager;
            document.getElementById('leadersManagerDisplay').innerHTML = '<i class="fas fa-user-check"></i> ' + this._buildUserLabel(leadersData.manager);
            var cls = document.querySelector('#leadersManagerPicker .user-picker-clear');
            if (cls) cls.style.display = '';
        } else {
            document.getElementById('leadersManagerId').value = '';
            this._leadersManagerUser = null;
            document.getElementById('leadersManagerDisplay').innerHTML = '<i class="fas fa-user"></i> 点击选择负责人';
        }
        // 副负责人列表（存储完整用户对象）
        var deputies = leadersData.deputy_managers || [];
        this._leadersDeputyUsers = deputies.slice();
        this._renderDeputyTags();

        var errEl = document.getElementById('leadersError');
        if (errEl) errEl.style.display = 'none';
        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
    }

    _buildUserLabel(user) {
        if (!user) return '';
        if (user.avatar) {
            return '<img class="mini-avatar" src="' + this._escape(user.avatar) + '"> <span>' + this._escape(user.real_name || user.username) + '</span>';
        }
        var initial = (user.real_name || user.username || '?')[0].toUpperCase();
        return '<span class="mini-avatar-placeholder">' + initial + '</span> <span>' + this._escape(user.real_name || user.username) + '</span>';
    }

    closeLeadersModal() {
        var modal = document.getElementById('leadersModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    async confirmLeaders() {
        var deptId = this._leadersDeptId;
        if (!deptId) return;
        var managerId = document.getElementById('leadersManagerId').value;
        var errEl = document.getElementById('leadersError');
        var deputyUsers = this._leadersDeputyUsers || [];
        var deputyIds = deputyUsers.map(function(u) { return u.id; });

        // 校验：主负责人和副负责人不能是同一个人
        if (managerId) {
            var mgrIdNum = parseInt(managerId);
            if (deputyIds.indexOf(mgrIdNum) !== -1) {
                if (errEl) { errEl.textContent = '主负责人和副负责人不能是同一个人'; errEl.style.display = 'block'; }
                return;
            }
        }

        // 校验：主负责人和副负责人不能是当前部门的子部门负责人
        // 需要先验证子部门负责人是否包含被选中的用户
        try {
            var checkResp = await fetch(ORG_API_URL + '/departments/' + deptId + '/org_chart/', {
                headers: TokenManager.getHeaders()
            });
            if (checkResp.ok) {
                var chartData = await checkResp.json();
                var subManagerIds = this._collectSubManagerIds(chartData);
                // if (managerId) {
                //     var mgrIdNum = parseInt(managerId);
                //     if (subManagerIds.indexOf(mgrIdNum) !== -1) {
                //         if (errEl) { errEl.textContent = '主负责人不能是子部门的负责人'; errEl.style.display = 'block'; }
                //         return;
                //     }
                // }
                // deputyIds.forEach(function(did) {
                //     if (subManagerIds.indexOf(did) !== -1) {
                //         if (errEl) { errEl.textContent = '副负责人不能是子部门的负责人'; errEl.style.display = 'block'; }
                //         return;
                //     }
                // });
            }
        } catch (e) {}

        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/set_leaders/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({
                    manager_id: managerId ? parseInt(managerId) : null,
                    deputy_ids: deputyIds
                })
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '保存失败');
            }
            this.closeLeadersModal();
            this._showToast('负责人已更新');
            // 刷新部门详情
            if (this.currentDeptId === deptId) {
                await this.loadDeptDetail(deptId);
            }
        } catch (e) {
            if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
            this._showToast(e.message, true);
        }
    }

    /** 递归收集子部门负责人 ID */
    _collectSubManagerIds(chartData) {
        var ids = [];
        if (!chartData) return ids;
        // chartData may have 'children' array
        var children = chartData.children || [];
        var self = this;
        children.forEach(function(child) {
            // 如果子部门有 manager 字段（字符串），需要查到对应 ID
            // 但 manager 是姓名，无法直接得到 ID。主负责人/副负责人的检查在后端更可靠
            // 这里简单递归子部门
            ids = ids.concat(self._collectSubManagerIds(child));
        });
        return ids;
    }

    _pickDeputies() {
        var excludeIds = [];
        var mgrId = document.getElementById('leadersManagerId').value;
        if (mgrId) excludeIds.push(parseInt(mgrId));
        var selector = new UserSelector({
            mode: 'multi',
            title: '选择副负责人',
            searchPlaceholder: '搜索用户...',
            excludeIds: excludeIds,
            onConfirm: function(users) {
                orgApp._leadersDeputyUsers = users;
                orgApp._renderDeputyTags();
            }
        });
        selector.show();
    }

    _renderDeputyTags() {
        var container = document.getElementById('leadersDeputyTags');
        if (!container) return;
        var users = this._leadersDeputyUsers || [];
        if (!users.length) {
            container.innerHTML = '<span style="font-size:12px;color:var(--text-light,#c0c4cc);">暂未选择副负责人</span>';
            return;
        }
        var self = this;
        container.innerHTML = users.map(function(u) {
            var avHtml;
            if (u.avatar) {
                avHtml = '<img class="mini-avatar" src="' + self._escape(u.avatar) + '">';
            } else {
                var ini = (u.real_name || u.username || '?')[0].toUpperCase();
                avHtml = '<span class="mini-avatar-placeholder">' + ini + '</span>';
            }
            return '<span class="deputy-tag-item">' + avHtml + '<span>' + self._escape(u.real_name || u.username) + '</span> <i class="fas fa-times" onclick="orgApp._removeDeputy(' + u.id + ')"></i></span>';
        }).join('');
    }

    _removeDeputy(id) {
        if (!this._leadersDeputyUsers) return;
        this._leadersDeputyUsers = this._leadersDeputyUsers.filter(function(u) { return u.id !== id; });
        this._renderDeputyTags();
    }

    // ────────── 汇报关系管理弹窗 ──────────

    showReportModal(deptId) {
        var modal = document.getElementById('reportModal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(function() { modal.classList.add('show'); }, 10);
            this._loadReportMembers(deptId);
            return;
        }
        modal = document.createElement('div');
        modal.id = 'reportModal';
        modal.className = 'modal';
        modal.innerHTML = '<div class="modal-content" style="max-width:720px;border-radius:14px;">'
            + '<div class="modal-header"><h3><i class="fas fa-sitemap" style="color:#67c23a;"></i> 汇报关系管理</h3>'
            + '<button class="close-btn" onclick="orgApp.closeReportModal()">&times;</button></div>'
            + '<div class="modal-body" id="reportModalBody" style="min-height:200px;">'
            + '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color,#409eff);"></i></div>'
            + '</div></div>';
        document.body.appendChild(modal);
        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
        this._loadReportMembers(deptId);
    }

    closeReportModal() {
        var modal = document.getElementById('reportModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    async _loadReportMembers(deptId) {
        var body = document.getElementById('reportModalBody');
        if (!body) return;
        try {
            var resp = await fetch(ORG_API_URL + '/departments/' + deptId + '/members/?page_size=100', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) { body.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; return; }
            var data = await resp.json();
            var members = data.results || [];
            var self = this;
            var html = '<div style="font-size:13px;color:var(--text-light,#909399);margin-bottom:12px;">为部门成员设置直属上级，形成组织汇报关系</div>';
            members.forEach(function(m) {
                var avatarHtml = m.avatar
                    ? '<img class="mini-avatar" src="' + self._escape(m.avatar) + '">'
                    : '<span class="mini-avatar-placeholder">' + (m.real_name || m.username || '?')[0].toUpperCase() + '</span>';
                html += '<div class="report-modal-row" data-user-id="' + m.id + '">'
                    + '<div class="report-user">' + avatarHtml + '<span>' + self._escape(m.real_name || m.username) + '</span></div>'
                    + '<div class="report-sup-area" id="reportSupArea_' + deptId + '_' + m.id + '">'
                    + '<span style="font-size:12px;color:var(--text-light);">上级: </span>'
                    + '<span class="sup-name" id="supName_' + deptId + '_' + m.id + '">-</span>'
                    + '</div>'
                    + '<button class="btn btn-sm" onclick="orgApp._setSupervisorFromModal(' + m.id + ', ' + deptId + ')"><i class="fas fa-user-tie"></i> 设置上级</button>'
                    + '</div>';
            });
            if (!members.length) {
                html = '<div class="empty-state"><i class="fas fa-users"></i><p>暂无成员</p></div>';
            }
            body.innerHTML = html;
            // 加载每个成员的上级
            members.forEach(function(m) {
                self._loadMemberSupervisor(m.id, deptId);
            });
        } catch (e) {
            body.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
        }
    }

    _setSupervisorFromModal(userId, deptId) {
        var self = this;
        var selector = new UserSelector({
            mode: 'single',
            title: '选择直属上级',
            searchPlaceholder: '搜索用户...',
            excludeIds: [userId],
            onSelect: function(user) {
                self._confirmSetSupervisor(userId, deptId, user.id);
            }
        });
        selector.show();
    }

    // ────────── 权限辅助 ──────────

    _canEdit() {
        if (!window.tenantManager || !tenantManager.activeTenant) return false;
        var role = tenantManager.activeTenant.role;
        return role === 'owner' || role === 'admin';
    }

    _isDeptAdmin() {
        if (!window.tenantManager || !tenantManager.activeTenant) return false;
        return tenantManager.activeTenant.role === 'dept_admin';
    }

    _isAdmin() {
        return this._canEdit();
    }

    // ────────── 组织架构图 ──────────

    showOrgChart() {
        var self = this;
        if (this._chartModal) {
            this._chartModal.style.display = 'flex';
            setTimeout(function() { self._chartModal.classList.add('show'); }, 10);
            return;
        }
        var overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.innerHTML = '<div class="modal-content" style="max-width:860px;max-height:88vh;border-radius:14px;">'
            + '<div class="modal-header"><h3><i class="fas fa-sitemap" style="color:var(--primary-color,#409eff);"></i> 组织架构图</h3>'
            + '<div style="display:flex;align-items:center;gap:6px;">'
            + '<button class="close-btn" id="orgChartMaxBtn" onclick="orgApp.toggleChartMax()" title="最大化" style="font-size:16px;width:32px;height:32px;">'
            + '<i class="fas fa-expand"></i></button>'
            + '<button class="close-btn" onclick="orgApp.closeChart()">&times;</button>'
            + '</div></div>'
            + '<div class="modal-body" id="orgChartBody" style="padding:20px 24px;">'
            + '<div style="text-align:center;padding:60px;"><i class="fas fa-spinner fa-spin" style="font-size:28px;color:var(--primary-color,#409eff);"></i></div>'
            + '</div></div>';
        document.body.appendChild(overlay);
        this._chartModal = overlay;
        overlay.style.display = 'flex';
        setTimeout(function() { overlay.classList.add('show'); }, 10);
        this._loadChartData();
    }

    closeChart() {
        var self = this;
        if (this._chartModal) {
            // 如果当前是最大化状态，先恢复再关闭，避免残留样式
            if (this._chartModal.classList.contains('maximized')) {
                this._chartModal.classList.remove('maximized');
                var content = this._chartModal.querySelector('.modal-content');
                if (content) {
                    content.style.width = '';
                    content.style.height = '';
                    content.style.maxWidth = '';
                    content.style.maxHeight = '';
                }
            }
            this._chartModal.classList.remove('show');
            setTimeout(function() { if (self._chartModal) self._chartModal.style.display = 'none'; }, 200);
        }
    }

    toggleChartMax() {
        var modal = this._chartModal;
        if (!modal) return;
        var content = modal.querySelector('.modal-content');
        if (!content) return;
        var btn = document.getElementById('orgChartMaxBtn');
        var icon = btn ? btn.querySelector('i') : null;
        var isMax = modal.classList.toggle('maximized');
        if (isMax) {
            content.style.width = '100vw';
            content.style.height = '100vh';
            content.style.maxWidth = '100vw';
            content.style.maxHeight = '100vh';
            content.style.borderRadius = '0';
            if (icon) { icon.className = 'fas fa-compress'; }
            if (btn) btn.title = '恢复';
        } else {
            content.style.width = '';
            content.style.height = '';
            content.style.maxWidth = '';
            content.style.maxHeight = '';
            content.style.borderRadius = '';
            if (icon) { icon.className = 'fas fa-expand'; }
            if (btn) btn.title = '最大化';
        }
    }

    async _loadChartData() {
        try {
            var resp = await fetch(ORG_API_URL + '/org-chart/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var data = await resp.json();
            this._renderChart(data);
        } catch (e) {
            console.error('加载架构图失败:', e);
        }
    }

    _renderChart(data) {
        var container = document.getElementById('orgChartBody');
        if (!container) return;
        var chartData = data.org_chart || [];
        if (!chartData.length) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-sitemap"></i><p>暂无组织架构数据</p></div>';
            return;
        }
        container.innerHTML = '<div class="org-chart-wrapper"><div class="chart-tree">'
            + this._buildChartHTML(chartData, 0) + '</div></div>';
    }

    _buildChartHTML(nodes, depth) {
        if (!nodes || !nodes.length) return '';
        var self = this;
        var html = '<ul>';
        nodes.forEach(function(n) {
            var hasChildren = n.children && n.children.length;
            html += '<li>'
                + '<div class="chart-node" onclick="orgApp.selectDepartment(' + n.id + ');orgApp.closeChart();">'
                + '<i class="fas fa-building node-icon"></i>'
                + '<span class="node-name">' + self._escape(n.name) + '</span>'
                + (n.manager ? '<span class="node-manager">(' + self._escape(n.manager) + ')</span>' : '')
                + '<span class="node-count">' + (n.member_count || 0) + ' 人</span>'
                + '</div>'
                + (hasChildren ? self._buildChartHTML(n.children, depth + 1) : '')
                + '</li>';
        });
        html += '</ul>';
        return html;
    }

    // 退出登录
    async logout() {
        const confirmed = await this.showConfirmDialog('退出登录', '确定要退出登录吗？', 'confirm');
        if (confirmed) {
            try {
                await API.logout();
                console.log('登出成功');
            } catch (error) {
                console.error('登出失败:', error);
            } finally {
                this.handleAuthError();
            }
        }
    }

    // ────────── 工具方法 ──────────


    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
    }

    /** 自定义确认对话框（Promise 形式） */
    showConfirmDialog(title, message, type) {
        return new Promise(function(resolve) {
            var dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            var iconName = type === 'danger' ? 'exclamation-triangle' : type === 'confirm' ? 'check-circle' : 'question-circle';
            dialog.innerHTML =
                '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-' + iconName + '"></i>'
                + '<h3>' + title + '</h3>'
                + '<button class="close-btn" style="margin-left:auto;"><i class="fas fa-times"></i></button>'
                + '</div>'
                + '<div class="confirm-dialog-body"><p>' + message + '</p></div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn cancel">取消</button>'
                + '<button class="confirm-dialog-btn ' + type + '">确定</button>'
                + '</div></div>';
            document.body.appendChild(dialog);

            var cancelBtn = dialog.querySelector('.cancel');
            var confirmBtn = dialog.querySelector('.' + type);
            var closeBtn = dialog.querySelector('.close-btn');

            var closeDialog = function(result) {
                dialog.classList.remove('show');
                setTimeout(function() {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 300);
                resolve(result);
            };

            if (cancelBtn) cancelBtn.addEventListener('click', function() { closeDialog(false); });
            if (closeBtn) closeBtn.addEventListener('click', function() { closeDialog(false); });
            if (confirmBtn) confirmBtn.addEventListener('click', function() { closeDialog(true); });
            dialog.addEventListener('click', function(e) {
                if (e.target === dialog) closeDialog(false);
            });

            setTimeout(function() { dialog.classList.add('show'); }, 10);
        });
    }

    bindEvents() {
        var searchInput = document.getElementById('orgSearchInput');
        if (searchInput) {
            var searchTimer;
            searchInput.addEventListener('input', function(e) {
                var q = e.target.value.trim();
                clearTimeout(searchTimer);
                searchTimer = setTimeout(function() {
                    if (!q) {
                        // Clear search — restore all nodes to visible, remove highlights
                        document.querySelectorAll('.dept-tree-node').forEach(function(node) {
                            node.style.display = '';
                        });
                        document.querySelectorAll('.dept-tree-node-content.search-highlight').forEach(function(el) {
                            el.classList.remove('search-highlight');
                        });
                        // Reset collapsed state
                        document.querySelectorAll('.dept-tree-children.collapsed').forEach(function(el) {
                            el.classList.remove('collapsed');
                        });
                        document.querySelectorAll('.toggle-icon i').forEach(function(icon) {
                            icon.className = 'fas fa-chevron-down';
                        });
                        return;
                    }

                    // Expand everything so nodes are visible
                    document.querySelectorAll('.dept-tree-children.collapsed').forEach(function(el) {
                        el.classList.remove('collapsed');
                    });
                    document.querySelectorAll('.toggle-icon i').forEach(function(icon) {
                        icon.className = 'fas fa-chevron-down';
                    });

                    // Call backend search API
                    fetch(ORG_API_URL + '/departments/search/?q=' + encodeURIComponent(q), {
                        headers: TokenManager.getHeaders()
                    }).then(function(resp) {
                        return resp.json();
                    }).then(function(data) {
                        var results = data.results || [];
                        // Build sets of matching and ancestor IDs
                        var matchingIds = {};
                        var ancestorIds = {};
                        results.forEach(function(r) {
                            matchingIds[r.id] = true;
                            if (r.parent_ids) {
                                r.parent_ids.forEach(function(pid) {
                                    ancestorIds[pid] = true;
                                });
                            }
                        });

                        // First clear all highlights
                        document.querySelectorAll('.dept-tree-node-content.search-highlight').forEach(function(el) {
                            el.classList.remove('search-highlight');
                        });

                        // Show/hide each node
                        document.querySelectorAll('.dept-tree-node').forEach(function(node) {
                            var content = node.querySelector('.dept-tree-node-content');
                            if (!content) return;
                            var deptId = parseInt(content.getAttribute('data-dept-id'));
                            if (!deptId) return;
                            if (matchingIds[deptId] || ancestorIds[deptId]) {
                                node.style.display = '';
                                if (matchingIds[deptId]) {
                                    content.classList.add('search-highlight');
                                }
                            } else {
                                node.style.display = 'none';
                            }
                        });
                    }).catch(function() {});
                }, 250);
            });
        }
        var treeContainer = document.getElementById('deptTreeContainer');
        if (treeContainer) {
            treeContainer.addEventListener('click', function(e) {
                // 折叠/展开切换按钮
                var toggle = e.target.closest('.toggle-icon');
                if (toggle) {
                    e.stopPropagation();
                    var content = toggle.closest('.dept-tree-node-content');
                    if (content) {
                        var deptId = parseInt(content.getAttribute('data-dept-id'));
                        if (deptId) {
                            var node = content.closest('.dept-tree-node');
                            var childrenContainer = null;
                            if (node) {
                                var kids = node.children;
                                for (var ki = 0; ki < kids.length; ki++) {
                                    if (kids[ki].classList.contains('dept-tree-children')) {
                                        childrenContainer = kids[ki];
                                        break;
                                    }
                                }
                            }
                            if (childrenContainer) {
                                childrenContainer.classList.toggle('collapsed');
                                // 更新箭头方向
                                var icon = toggle.querySelector('i');
                                if (icon) {
                                    icon.className = 'fas fa-chevron-' + (childrenContainer.classList.contains('collapsed') ? 'right' : 'down');
                                }
                            }
                        }
                    }
                    return;
                }
                // 部门节点点击（选择部门）
                var content = e.target.closest('.dept-tree-node-content');
                if (content) {
                    var deptId = parseInt(content.getAttribute('data-dept-id'));
                    if (deptId) orgApp.selectDepartment(deptId);
                }
            });
        }
    }

    _escape(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    _showToast(msg, isError) {
        var t = document.getElementById('orgToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'orgToast';
            t.style.cssText = 'position:fixed;top:24px;right:24px;z-index:10001;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.14);padding:14px 22px;min-width:200px;border-left:4px solid #67c23a;font-size:14px;color:#303133;opacity:0;transform:translateX(60px);transition:all 0.35s ease;pointer-events:none;';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.borderLeftColor = isError ? '#f56c6c' : '#67c23a';
        t.style.opacity = '1';
        t.style.transform = 'translateX(0)';
        clearTimeout(t._timer);
        t._timer = setTimeout(function() {
            t.style.opacity = '0';
            t.style.transform = 'translateX(60px)';
        }, 2500);
    }
}

var orgApp = new OrgApp();
