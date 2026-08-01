// static/js/tenant.js - 企业切换逻辑

const TENANT_API_URL = '/api/org';

class TenantManager {
    constructor() {
        this.tenants = [];
        this.activeTenant = null;
        this._initialized = false;
        this.isSuperAdmin = false;
        this.currentUser = null;
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    async _doInit() {
        if (this._initialized) return;
        await Promise.all([this.loadTenants(), this._checkSuperAdmin()]);
        this.updateTenantUI();
        this.renderAdminInfo();
        this._initialized = true;
        this._updateCreateButtons();
    }

    async _checkSuperAdmin() {
        try {
            var resp = await fetch('/api/auth/me/', { headers: TokenManager.getHeaders() });
            if (resp.ok) {
                var data = await resp.json();
                this.isSuperAdmin = data.user_type === "super_admin";
                this.currentUser = data;
                localStorage.setItem('current_user', JSON.stringify(data));
            }
        } catch (e) { console.error('检查管理员权限失败:', e); }
    }

    async loadTenants() {
        try {
            const resp = await fetch(TENANT_API_URL + '/tenants/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            const data = await resp.json();
            this.tenants = data.results || data || [];
            // 使用后端返回的 is_current 字段确定当前激活企业
            // 不再依赖 /api/auth/me/ 匹配，避免对象/ID类型不一致问题
            var found = this.tenants.filter(function(t) { return t.is_current; });
            if (found.length) {
                this.activeTenant = found[0];
            } else if (!this.activeTenant && this.tenants.length) {
                // 仅在初次加载且无 activeTenant 时使用第一个
                this.activeTenant = this.tenants[0];
            }
        } catch (e) {
            console.error('加载企业列表失败:', e);
        }
    }

    async switchTenant(tenantId) {
        try {
            // 显示加载状态
            var list = document.getElementById('tenantSwitchList');
            if (list) list.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin" style="color:var(--primary-color,#409eff);"></i><p style="margin-top:8px;font-size:13px;color:var(--text-light);">切换中...</p></div>';
            var resp = await fetch(TENANT_API_URL + '/tenants/' + tenantId + '/switch/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var errData = await resp.json().catch(function() { return {}; });
                throw new Error(errData.error || errData.detail || '切换失败');
            }
            const data = await resp.json();
            if (data.success) {
                // 1. 更新企业列表（把返回的 tenant 数据合并到列表中，确保 role 等信息完整）
                var newTenant = data.tenant;
                var found = false;
                for (var i = 0; i < this.tenants.length; i++) {
                    if (this.tenants[i].id === newTenant.id) {
                        this.tenants[i] = newTenant;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    this.tenants.push(newTenant);
                }
                // 2. 设置 activeTenant（使用响应数据，包含 role）
                this.activeTenant = newTenant;
                // 3. 关闭弹窗并更新 UI
                this.closeSwitchModal();
                this.updateTenantUI();
                // 4. 直接刷新组织架构数据
                if (window.orgApp) {
                    window.orgApp.currentDeptId = null;
                    window.orgApp.membersPage = 1;
                    var dc = document.getElementById('deptDetailContainer');
                    if (dc) dc.innerHTML = '<div style="text-align:center;padding:40px;"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:var(--primary-color,#409eff);"></i></div>';
                    var mc = document.getElementById('membersContainer');
                    if (mc) mc.innerHTML = '';
                    await window.orgApp.loadDeptTree();
                }
                this._showToast('已切换到 ' + (newTenant.short_name || newTenant.name));
            }
        } catch (e) {
            console.error('切换企业失败:', e);
            this._showToast('切换失败: ' + e.message, true);
        }
    }

    renderAdminInfo() {
        if (this.currentUser) {
            var adminUsername = document.getElementById('adminUsername');
            var adminAvatar = document.getElementById('adminAvatar');

            if (adminUsername) {
                adminUsername.textContent = this.currentUser.real_name || this.currentUser.username;
                adminUsername.title = `当前账号：${this.currentUser.username}`;
            }
            if (adminAvatar) {
                adminAvatar.src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
                adminAvatar.title = `当前账号：${this.currentUser.username}`;
            }

        }
    }

    updateTenantUI() {
        // 更新顶栏企业名称
        document.querySelectorAll('.tenant-name-display').forEach(function(el) {
            if (this.activeTenant) {
                el.textContent = this.activeTenant.short_name || this.activeTenant.name;
            }
        }.bind(this));
        // 更新组织架构页面的企业栏
        var nameEl = document.getElementById('orgTenantName');
        var roleEl = document.getElementById('orgTenantRole');
        if (nameEl && this.activeTenant) {
            nameEl.textContent = this.activeTenant.short_name || this.activeTenant.name;
        }
        if (roleEl && this.activeTenant) {
            var roleMap = {'owner': '企业所有者', 'admin': '企业管理员', 'dept_admin': '部门管理员', 'member': '成员'};
            roleEl.textContent = roleMap[this.activeTenant.role] || '成员';
        }
        // 更新全局聊天顶栏企业名称
        if (window.chatClient && chatClient.updateGlobalTenantUI) {
            chatClient.updateGlobalTenantUI();
        }
    }

    showSwitchModal() {
        var overlay = document.getElementById('tenantSwitchOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tenantSwitchOverlay';
            overlay.className = 'modal';
            overlay.innerHTML = '<div class="modal-content" style="max-width:420px;">'
                + '<div class="modal-header"><h3><i class="fas fa-building"></i> 切换企业</h3>'
                + '<button class="close-btn" onclick="tenantManager.closeSwitchModal()">&times;</button></div>'
                + '<div class="modal-body"><div class="tenant-switch-list" id="tenantSwitchList"></div></div>'
                + '<div class="tenant-switch-footer">'
                + '<button class="btn btn-primary" id="switchCreateTenantBtn" onclick="tenantManager.openCreateTenantModal()"><i class="fas fa-plus"></i> 创建新企业</button>'
                + '</div></div>';
            document.body.appendChild(overlay);
        }
        // 根据权限控制创建按钮显示
        var btn = document.getElementById('switchCreateTenantBtn');
        if (btn) btn.style.display = this.isSuperAdmin ? '' : 'none';
        this._renderTenantList();
        overlay.style.display = 'flex';
        setTimeout(function() { overlay.classList.add('show'); }, 10);
    }

    closeSwitchModal() {
        var overlay = document.getElementById('tenantSwitchOverlay');
        if (overlay) {
            overlay.classList.remove('show');
            setTimeout(function() { overlay.style.display = 'none'; }, 200);
        }
    }

    _renderTenantList() {
        var list = document.getElementById('tenantSwitchList');
        if (!list) return;
        var self = this;
        list.innerHTML = this.tenants.map(function(t) {
            var isActive = self.activeTenant && t.id === self.activeTenant.id;
            console.log('t.role: ', t.role);
            console.log('isActive: ', isActive);
            var roleMap = {'owner': '企业所有者', 'admin': '企业管理员', 'dept_admin': '部门管理员', 'member': '成员'};
            return '<div class="tenant-item' + (isActive ? ' active' : '') + '" onclick="tenantManager.switchTenant(' + t.id + ')">'
                + '<div class="tenant-logo"><i class="fas fa-building"></i></div>'
                + '<div class="tenant-info">'
                + '<div class="tenant-name">' + (t.short_name || t.name) + '</div>'
                + '<div class="tenant-role">' + (roleMap[t.role] || t.tenant_type || '') + '</div>'
                + '</div>'
                + (isActive ? '<i class="fas fa-check-circle check-icon"></i>' : '')
                + '</div>';
        }).join('');
        if (!this.tenants.length) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-building"></i><p>暂未加入任何企业</p></div>';
        }
    }

    openCreateTenantModal() {
        this.closeSwitchModal();
        var modal = document.getElementById('createTenantModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'createTenantModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:500px;">'
                + '<div class="modal-header"><h3><i class="fas fa-plus-circle"></i> 创建企业</h3>'
                + '<button class="close-btn" onclick="tenantManager.closeCreateModal()">&times;</button></div>'
                + '<div class="modal-body">'
                + '<div class="form-group"><label>企业名称 <span class="required">*</span></label>'
                + '<input type="text" id="newTenantName" class="form-input" placeholder="请输入企业名称"></div>'
                + '<div class="form-group"><label>企业简称</label>'
                + '<input type="text" id="newTenantShortName" class="form-input" placeholder="请输入企业简称"></div>'
                + '<div class="form-group"><label>企业编码 <span class="required">*</span></label>'
                + '<input type="text" id="newTenantCode" class="form-input" placeholder="英文编码，全局唯一"></div>'
                + '<div class="form-group"><label>企业类型 <span class="required">*</span></label>'
                + '<select id="newTenantType" class="form-select" onchange="tenantManager._onTenantTypeChange()">'
                + '<option value="company">公司</option>'
                + '<option value="group">集团</option>'
                + '<option value="branch">分公司</option>'
                + '<option value="virtual">虚拟组织</option>'
                + '</select></div>'
                + '<div class="form-group" id="parentTenantGroup" style="display:none;"><label>上级集团</label>'
                + '<select id="newTenantParent" class="form-select"><option value="">选择上级集团</option></select></div>'
                + '<div class="form-group"><label>所属行业</label>'
                + '<input type="text" id="newTenantIndustry" class="form-input" placeholder="如：信息技术"></div>'
                + '<div class="form-group"><label>企业规模</label>'
                + '<select id="newTenantScale" class="form-select">'
                + '<option value="">请选择</option>'
                + '<option value="1-50人">1-50人</option>'
                + '<option value="50-200人">50-200人</option>'
                + '<option value="200-1000人">200-1000人</option>'
                + '<option value="1000人以上">1000人以上</option>'
                + '</select></div>'
                + '<div class="form-group"><label>企业地址</label>'
                + '<input type="text" id="newTenantAddress" class="form-input" placeholder="企业地址"></div>'
                + '<p id="createTenantError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '<p style="font-size:12px;color:#909399;margin-top:8px;">提示：创建公司/分公司时可指定所属集团。也可在组织页将部门转换为子公司。</p>'
                + '</div>'
                + '<div class="modal-footer">'
                + '<button class="btn btn-secondary" onclick="tenantManager.closeCreateModal()">取消</button>'
                + '<button class="btn btn-primary" onclick="tenantManager.confirmCreate()">创建</button>'
                + '</div></div>';
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
    }

    _onTenantTypeChange() {
        var typeVal = document.getElementById('newTenantType').value;
        var parentGroup = document.getElementById('parentTenantGroup');
        if (parentGroup) parentGroup.style.display = (typeVal === 'company' || typeVal === 'branch') ? 'block' : 'none';
    }

    async _loadParentTenants() {
        var sel = document.getElementById('newTenantParent');
        if (!sel) return;
        try {
            var resp = await fetch(TENANT_API_URL + '/tenants/', { headers: TokenManager.getHeaders() });
            if (!resp.ok) return;
            var data = await resp.json();
            var tenants = data.results || data || [];
            sel.innerHTML = '<option value="">选择上级集团</option>';
            tenants.forEach(function(t) {
                if (t.tenant_type === 'group') {
                    var opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.short_name || t.name;
                    sel.appendChild(opt);
                }
            });
        } catch(e) {}
    }

    closeCreateModal() {
        var modal = document.getElementById('createTenantModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    async confirmCreate() {
        var name = document.getElementById('newTenantName').value.trim();
        var code = document.getElementById('newTenantCode').value.trim().toUpperCase();
        var errEl = document.getElementById('createTenantError');

        if (!name || !code) {
            if (errEl) { errEl.textContent = '请填写企业名称和企业编码'; errEl.style.display = 'block'; }
            return;
        }

        var tenantType = document.getElementById('newTenantType').value;
        var parentId = document.getElementById('newTenantParent').value;

        var data = {
            name: name,
            code: code,
            tenant_type: tenantType,
            short_name: document.getElementById('newTenantShortName').value.trim(),
            industry: document.getElementById('newTenantIndustry').value.trim(),
            scale: document.getElementById('newTenantScale').value,
            address: document.getElementById('newTenantAddress').value.trim(),
        };
        if (parentId) data.parent = parseInt(parentId);

        try {
            var resp = await fetch(TENANT_API_URL + '/tenants/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '创建失败');
            }
            this.closeCreateModal();
            this._showToast('企业创建成功');
            await this.loadTenants();
            this.updateTenantUI();
            // 直接刷新组织架构数据
            if (window.orgApp) {
                window.orgApp.currentDeptId = null;
                window.orgApp.membersPage = 1;
                await window.orgApp.loadDeptTree();
            }
            if (errEl) errEl.style.display = 'none';
        } catch (e) {
            if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
        }
    }

    _updateCreateButtons() {
        var show = this.isSuperAdmin;
        // 切换企业模态框中的创建按钮
        var switchFooter = document.querySelector('#tenantSwitchOverlay .tenant-switch-footer .btn');
        if (switchFooter) switchFooter.style.display = show ? '' : 'none';
        // 组织架构页顶栏下拉中的创建按钮
        var topCreate = document.querySelector('#orgTopTenantDropdown .tenant-dropdown-create');
        if (topCreate) topCreate.style.display = show ? '' : 'none';
        // 聊天页全局企业切换下拉中的创建按钮
        var chatCreate = document.querySelector('#globalTenantDropdown .tenant-dropdown-create');
        if (chatCreate) chatCreate.style.display = show ? '' : 'none';
    }

    _showToast(msg, isError) {
        var t = document.getElementById('tenantToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'tenantToast';
            t.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10001;background:#fff;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.14);padding:14px 20px;min-width:200px;border-left:4px solid #67c23a;font-size:14px;color:#303133;opacity:0;transform:translateX(60px);transition:all 0.35s ease;pointer-events:none;';
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

// 全局实例
var tenantManager = new TenantManager();

// DOMContentLoaded 自动初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { tenantManager.init(); });
} else {
    tenantManager.init();
}
