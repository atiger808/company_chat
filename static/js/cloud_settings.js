/**
 * @File   : cloud_settings.js
 * @Desc   : 企业网盘系统配置管理前端逻辑（适配 CloudSystemConfig 模型）
 */

class CloudSettingsApp {
    constructor() {
        this.currentCategory = 'system';  // 🔧 默认分类改为 system
        this.configs = [];
        this.categories = [];
        this.editingConfig = null;
        this.onlyofficeConfigs = null;

        this.currentUser = null;
        this.cloud_home_url = '/cloud/';
        this.cloud_login_url = '/cloud/login/';

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        try {

            // 1. 检查登录状态
            const token = localStorage.getItem('access_token');
            if (!token) {
                localStorage.setItem('redirect_url', window.location.href);
                window.location.href = this.cloud_login_url;
                return;
            }

            // 检查管理员权限
            this.currentUser = await API.getCurrentUser();
            if (this.currentUser.user_type === 'normal' || this.currentUser.user_type === 'visitor') {
                // 替换原生 alert 为优雅的提示框
                this.showAlert('权限不足', '您没有管理员权限').then(() => {
                    window.location.href = this.cloud_home_url;
                });
                return;
            }


            await this.loadCategories();
            await this.loadConfigs(this.currentCategory);
            const categoryInfo = this.categories.find(c => c.key === this.currentCategory);
            document.getElementById('currentCategoryName').textContent = categoryInfo?.name || '配置';

            this.setupEventListeners();
            console.log('✅ 系统配置管理初始化完成');
        } catch (error) {
            console.error('❌ 初始化失败:', error);
            this.showError('加载配置失败', error.message);
            this.handleAuthError()
        }
    }


    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.cloud_login_url;
    }

    // 加载配置分类
    async loadCategories() {
        const response = await fetch('/api/cloud/settings/categories/', {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) throw new Error('加载分类失败');
        const data = await response.json();
        this.categories = data.categories;
        this.renderCategories();
    }

    // 渲染分类导航
    renderCategories() {
        const nav = document.getElementById('settingsNav');
        if (!nav) return;
        nav.innerHTML = this.categories.map(cat => `
            <div class="settings-nav-item ${cat.key === this.currentCategory ? 'active' : ''}"
                 onclick="cloudSettings.switchCategory('${cat.key}')">
                <i class="${cat.icon}"></i>
                <span>${cat.name}</span>
                <span class="badge">${cat.count || 0}</span>
            </div>
        `).join('');
    }

    // 切换分类
    async switchCategory(category) {
        this.currentCategory = category;
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.classList.toggle('active', item.onclick?.toString().includes(category));
        });
        const categoryInfo = this.categories.find(c => c.key === category);
        document.getElementById('currentCategoryName').textContent = categoryInfo?.name || '配置';

        // 移动端点击分类后自动收起侧边栏
        if (window.innerWidth <= 768) {
            this.toggleSidebar(true);
        }
        await this.loadConfigs(category);
    }

    // 加载配置列表
    async loadConfigs(category) {
        const configList = document.getElementById('configList');
        if (!configList) return;
        configList.innerHTML = `<div class="loading"><i class="fas fa-spinner fa-spin"></i> <span>加载中...</span></div>`;

        try {
            const response = await fetch(`/api/cloud/settings/list_configs/?category=${category}`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载配置失败');
            const data = await response.json();
            this.configs = data.configs;
            if (category === 'collaboration') {
                await this.loadOnlyofficeConfigs();
                this.renderCollabConfigs();
            } else {
                this.renderConfigs();
            }
        } catch (error) {
            console.error('加载配置失败:', error);
            configList.innerHTML = `
                <div class="error-state" style="text-align:center; padding:40px; color:var(--danger-color);">
                    <i class="fas fa-exclamation-circle" style="font-size:32px; margin-bottom:10px;"></i><br>
                    加载失败：${error.message}<br>
                    <button class="btn btn-primary" style="margin-top:15px;" onclick="cloudSettings.loadConfigs('${category}')">
                        <i class="fas fa-redo"></i> 重试
                    </button>
                </div>`;
        }
    }

    // 渲染普通配置列表（保持原有逻辑，此处略作精简）
    renderConfigs() {
        const configList = document.getElementById('configList');
        if (!configList) return;
        if (this.configs.length === 0) {
            configList.innerHTML = `<div class="empty-state" style="text-align:center; padding:40px;"><i class="fas fa-inbox"></i><p>暂无配置项</p></div>`;
            return;
        }
        configList.innerHTML = this.configs.map(config => `
            <div class="config-item" data-key="${config.key}">
                <div class="config-header">
                    <div class="config-name">
                        ${this.escapeHtml(config.name)}
                        <span class="config-key">${config.key}</span>
                        ${config.is_default ? '<span class="badge badge-info" style="background:#909399">默认</span>' : ''}
                        ${!config.is_editable ? '<span class="badge badge-warning" style="background:#E6A23C">只读</span>' : ''}
                    </div>
                </div>
                <div class="config-value ${config.value_type === 'password' ? 'password' : ''}">
                    ${this.formatValue(config.typed_value, config.value_type)}
                </div>
                ${config.description ? `<div class="config-description">${this.escapeHtml(config.description)}</div>` : ''}
                <div class="config-actions">
                    ${config.is_editable ? `<button class="btn btn-sm btn-primary" onclick="cloudSettings.openEditModal('${config.key}')"><i class="fas fa-edit"></i> 编辑</button>` : ''}
                    ${!config.is_default ? `<button class="btn btn-sm btn-secondary" onclick="cloudSettings.resetConfig('${config.key}')"><i class="fas fa-undo"></i> 重置</button>` : ''}
                </div>
            </div>
        `).join('');
    }


    // 🔧 加载 OnlyOffice 专用配置
    async loadOnlyofficeConfigs() {
        try {
            const response = await fetch('/api/cloud/settings/onlyoffice_configs/', {
                headers: TokenManager.getHeaders()
            });
            if (response.ok) {
                this.onlyofficeConfigs = await response.json();
            }
        } catch (error) {
            console.warn('加载 OnlyOffice 配置失败:', error);
        }
    }


    // 🔧 渲染协同设置（OnlyOffice 专用）
    renderCollabConfigs() {
        const configList = document.getElementById('configList');
        if (!configList || !this.onlyofficeConfigs) return;

        const oo = this.onlyofficeConfigs;

        configList.innerHTML = `
            <!-- OnlyOffice 服务器配置 -->
            <div class="config-section">
                <h4><i class="fas fa-server"></i> 服务器配置</h4>
                <div class="config-item">
                    <div class="config-name">
                        文档服务器地址
                        <span class="config-key">onlyoffice.document_server_url</span>
                    </div>
                    <div class="config-value">
                        <input type="text" class="form-control" id="oo_doc_url" 
                               value="${this.escapeHtml(oo.document_server_url)}">
                    </div>
                </div>
                <div class="config-item">
                    <div class="config-name">
                        启用 JWT 认证
                        <span class="config-key">onlyoffice.jwt_enabled</span>
                    </div>
                    <div class="config-value">
                        <label class="switch">
                            <input type="checkbox" id="oo_jwt_enabled" ${oo.jwt_enabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>
                <div class="config-item">
                    <div class="config-name">
                        JWT 密钥
                        <span class="config-key">onlyoffice.jwt_secret</span>
                    </div>
                    <div class="config-value password">
                        <input type="password" class="form-control" id="oo_jwt_secret" 
                               value="${this.escapeHtml(oo.jwt_secret)}" placeholder="输入密钥">
                    </div>
                </div>
            </div>

            <!-- 全局权限配置 -->          
            <div class="config-section">
                <h4><i class="fas fa-lock"></i> 全局权限配置</h4>
                <p class="section-desc">以下配置将应用于所有用户，除非为用户设置了自定义权限</p>
                <div class="permission-grid config-item">
                    ${Object.entries(oo.permissions).map(([key, val]) => `
                        <label class="permission-item">
                            <input type="checkbox" id="perm_${key}" ${val ? 'checked' : ''}>
                            <span>${this.getPermissionLabel(key)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            
            <!-- 🔧 新增：用户自定义权限管理 -->
            <div class="config-section">
                <div class="section-header-with-action">
                    <h4><i class="fas fa-user-cog"></i> 用户自定义权限</h4>
                    <button class="btn btn-sm btn-primary" onclick="cloudSettings.showAddUserPermissionModal()">
                        <i class="fas fa-plus"></i> 添加用户权限
                    </button>
                </div>
                <p class="section-desc">为特定用户设置个性化的文档编辑权限</p>
                <div id="userPermissionsList" class="config-item">
                    <div class="loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>
                </div>
            </div>

            <!-- 界面配置 -->
            <div class="config-section">
                <h4><i class="fas fa-palette"></i> 界面配置</h4>
                <div class="config-item">
                    <div class="config-name">界面语言</div>
                    <div class="config-value">
                        <select class="form-control" id="oo_language">
                            ${this.renderLanguageOptions(oo.language)}
                        </select>
                    </div>
                </div>
                <div class="config-item">
                    <div class="config-name">协同模式</div>
                    <div class="config-value">
                        <select class="form-control" id="oo_collab_mode">
                            <option value="fast" ${oo.collaboration_mode === 'fast' ? 'selected' : ''}>快速模式</option>
                            <option value="strict" ${oo.collaboration_mode === 'strict' ? 'selected' : ''}>严格模式</option>
                        </select>
                    </div>
                </div>
                <div class="config-item">
                    <div class="config-name">界面主题</div>
                    <div class="config-value">
                        <select class="form-control" id="oo_ui_theme">
                            <option value="theme-light" ${oo.ui.ui_theme === 'theme-light' ? 'selected' : ''}>浅色</option>
                            <option value="theme-dark" ${oo.ui.ui_theme === 'theme-dark' ? 'selected' : ''}>深色</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- 功能开关 -->
            <div class="config-section">
                <h4><i class="fas fa-toggle-on"></i> 功能开关</h4>
                <div class="toggle-grid config-item">
                    ${Object.entries(oo.ui).filter(([k]) => k !== 'ui_theme').map(([key, val]) => `
                        <label class="toggle-item">
                            <span>${this.getFeatureLabel(key)}</span>
                            <label class="switch">
                                <input type="checkbox" id="ui_${key}" ${val ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- 版本控制 -->
            <div class="config-section">
                <h4><i class="fas fa-history"></i> 版本控制</h4>
                <div class="config-item">
                    <div class="config-name">保留版本数量</div>
                    <div class="config-value">
                        <input type="number" class="form-control" id="oo_version_count" 
                               value="${oo.version_keep_count}" min="1" max="100">
                    </div>
                </div>
            </div>

            <div class="config-actions" style="margin-top: 20px;">
                <button class="btn btn-primary" onclick="cloudSettings.saveOnlyofficeConfigs()">
                    <i class="fas fa-save"></i> 保存 OnlyOffice 配置
                </button>
                <button class="btn btn-secondary" onclick="cloudSettings.testOnlyofficeConnection()">
                    <i class="fas fa-plug"></i> 测试连接
                </button>
            </div>
        `;

        // 加载用户权限列表
        this.loadUserPermissions();
    }


    // 🔧 加载用户权限列表
    async loadUserPermissions() {
        const container = document.getElementById('userPermissionsList');
        if (!container) return;

        try {
            const response = await fetch('/api/cloud/settings/user-permissions/', {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                throw new Error('加载失败');
            }

            const data = await response.json();
            this.renderUserPermissions(data.results || data);

        } catch (error) {
            console.error('加载用户权限失败:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>加载失败：${error.message}</p>
                </div>
            `;
        }
    }

    // 🔧 渲染用户权限列表
    renderUserPermissions(permissions) {
        const container = document.getElementById('userPermissionsList');
        if (!container) return;

        if (!permissions || permissions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user-slash"></i>
                    <p>暂无用户自定义权限配置</p>
                    <button class="btn btn-primary" onclick="cloudSettings.showAddUserPermissionModal()">
                        <i class="fas fa-plus"></i> 添加第一个用户权限
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="user-permissions-table">
                <table>
                    <thead>
                        <tr>
                            <th>用户</th>
                            <th>权限配置</th>
                            <th>状态</th>
                            <th>更新时间</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${permissions.map(perm => `
                            <tr>
                                <td>
                                    <div class="user-info-cell">
                                        <img src="${perm.user_info.avatar || '/static/images/default-avatar.png'}" 
                                             alt="${perm.user_info.username}" 
                                             class="user-avatar-small">
                                        <div>
                                            <div class="user-name">${this.escapeHtml(perm.user_info.real_name || perm.user_info.username)}</div>
                                            <div class="user-username">@${this.escapeHtml(perm.user_info.username)}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div class="permissions-summary">
                                        ${this.renderPermissionsSummary(perm.permissions)}
                                    </div>
                                </td>
                                <td>
                                    <span class="status-badge ${perm.is_active ? 'active' : 'inactive'}">
                                        ${perm.is_active ? '启用' : '禁用'}
                                    </span>
                                </td>
                                <td>${new Date(perm.updated_at).toLocaleString('zh-CN')}</td>
                                <td>
                                    <button class="btn btn-sm btn-primary" 
                                            onclick="cloudSettings.editUserPermission('${perm.user}')">
                                        <i class="fas fa-edit"></i> 编辑
                                    </button>
                                    <button class="btn btn-sm btn-danger" 
                                            onclick="cloudSettings.deleteUserPermission('${perm.user}')">
                                        <i class="fas fa-trash"></i> 删除
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    // 🔧 渲染权限摘要
    renderPermissionsSummary(permissions) {
        const enabledPerms = Object.entries(permissions)
            .filter(([_, val]) => val)
            .map(([key]) => this.getPermissionLabel(key));

        if (enabledPerms.length === 0) {
            return '<span class="text-muted">无权限</span>';
        }

        if (enabledPerms.length <= 3) {
            return enabledPerms.join('、');
        }

        return `${enabledPerms.slice(0, 3).join('、')} 等${enabledPerms.length}项`;
    }

    // 🔧 显示添加用户权限模态框
    async showAddUserPermissionModal() {
        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'addUserPermissionModal';
        modal.innerHTML = `
            <div class="modal-content modal-lg">
                <div class="modal-header">
                    <h3><i class="fas fa-user-plus"></i> 添加用户权限配置</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>选择用户 <span class="required">*</span></label>
                        <div class="user-search-container">
                            <input type="text" 
                                   id="userSearchInput" 
                                   class="form-control" 
                                   placeholder="搜索用户名、姓名或邮箱..."
                                   oninput="cloudSettings.searchUsersForPermission(this.value)">
                            <div id="userSearchResults" class="user-search-results"></div>
                        </div>
                        <input type="hidden" id="selectedUserId">
                        <div id="selectedUserInfo" class="selected-user-info" style="display:none;"></div>
                    </div>
                    
                    <div class="config-section">
                        <label>权限配置</label>
                        <div class="permission-grid">
                            ${Object.keys(this.onlyofficeConfigs.permissions).map(key => `
                                <label class="permission-item">
                                    <input type="checkbox" 
                                           id="new_perm_${key}" 
                                           checked>
                                    <span>${this.getPermissionLabel(key)}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <label>启用状态</label>
                        <label class="switch">
                            <input type="checkbox" id="new_perm_is_active" checked>
                            <span class="slider"></span>
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <label>备注说明</label>
                        <textarea id="new_perm_description" 
                                  class="form-control" 
                                  rows="3" 
                                  placeholder="可选：说明为何设置此权限..."></textarea>
                    </div>
                    
                    <p id="addUserPermError" class="error-message"></p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="cloudSettings.closeAddUserPermissionModal()">取消</button>
                    <button class="btn btn-primary" onclick="cloudSettings.saveUserPermission()">保存</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 绑定关闭事件
        modal.querySelector('.close-btn').onclick = () => this.closeAddUserPermissionModal();
        modal.onclick = (e) => {
            if (e.target === modal) this.closeAddUserPermissionModal();
        };
    }

    // 🔧 关闭添加用户权限模态框
    closeAddUserPermissionModal() {
        const modal = document.getElementById('addUserPermissionModal');
        if (modal) {
            modal.remove();
        }
    }

    // 🔧 搜索用户
    async searchUsersForPermission(searchText) {
        const resultsContainer = document.getElementById('userSearchResults');
        if (!resultsContainer) return;

        if (!searchText) {
            resultsContainer.innerHTML = '';
            resultsContainer.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(
                `/api/cloud/settings/users-for-permission/?search=${encodeURIComponent(searchText)}`,
                {
                    headers: TokenManager.getHeaders()
                }
            );

            if (!response.ok) {
                throw new Error('搜索失败');
            }

            const users = await response.json();

            if (users.length === 0) {
                resultsContainer.innerHTML = '<div class="search-result-item">未找到用户</div>';
            } else {
                resultsContainer.innerHTML = users.map(user => `
                    <div class="search-result-item" 
                         onclick="cloudSettings.selectUserForPermission('${user.id}', '${this.escapeHtml(user.username)}', '${this.escapeHtml(user.real_name || '')}')">
                        <img src="/static/images/default-avatar.png" alt="${user.username}" class="user-avatar-tiny">
                        <div>
                            <div class="result-user-name">${this.escapeHtml(user.real_name || user.username)}</div>
                            <div class="result-user-detail">@${this.escapeHtml(user.username)} ${user.email ? `(${user.email})` : ''}</div>
                        </div>
                    </div>
                `).join('');
            }

            resultsContainer.style.display = 'block';

        } catch (error) {
            console.error('搜索用户失败:', error);
            resultsContainer.innerHTML = '<div class="search-result-item">搜索失败</div>';
            resultsContainer.style.display = 'block';
        }
    }

    // 🔧 选择用户
    selectUserForPermission(userId, username, realName) {
        document.getElementById('selectedUserId').value = userId;
        document.getElementById('userSearchInput').value = '';
        document.getElementById('userSearchResults').style.display = 'none';

        const userInfoDiv = document.getElementById('selectedUserInfo');
        userInfoDiv.innerHTML = `
            <div class="selected-user-badge">
                <i class="fas fa-user-check"></i>
                已选择：${this.escapeHtml(realName || username)} (@${this.escapeHtml(username)})
                <button type="button" onclick="cloudSettings.clearSelectedUser()" class="clear-selection">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        userInfoDiv.style.display = 'block';
    }

    // 🔧 清除选中的用户
    clearSelectedUser() {
        document.getElementById('selectedUserId').value = '';
        document.getElementById('selectedUserInfo').style.display = 'none';
    }

    // 🔧 保存用户权限
    async saveUserPermission() {
        const userId = document.getElementById('selectedUserId').value;
        if (!userId) {
            document.getElementById('addUserPermError').textContent = '请先选择一个用户';
            return;
        }

        const permissions = {};
        Object.keys(this.onlyofficeConfigs.permissions).forEach(key => {
            const checkbox = document.getElementById(`new_perm_${key}`);
            if (checkbox) {
                permissions[key] = checkbox.checked;
            }
        });

        const payload = {
            user: userId,
            permissions: permissions,
            is_active: document.getElementById('new_perm_is_active').checked,
            description: document.getElementById('new_perm_description').value.trim()
        };

        try {
            const response = await fetch('/api/cloud/settings/user-permissions/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.user || error.error || '保存失败');
            }

            this.showSuccess('保存成功', '用户权限配置已添加');
            this.closeAddUserPermissionModal();
            await this.loadUserPermissions();

        } catch (error) {
            document.getElementById('addUserPermError').textContent = error.message;
        }
    }

    // 🔧 编辑用户权限
    async editUserPermission(userId) {
        // 先获取用户权限详情
        try {
            const response = await fetch(`/api/cloud/settings/user-permissions/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                throw new Error('加载失败');
            }

            const data = await response.json();
            const perm = (data.results || data).find(p => p.user === parseInt(userId));

            if (!perm) {
                console.error('找不到该用户的权限配置')
                this.showError('错误', '找不到该用户的权限配置');
                return;
            }

            this.showEditUserPermissionModal(perm);

        } catch (error) {
            this.showError('加载失败', error.message);
        }
    }

    // 🔧 显示编辑用户权限模态框
    showEditUserPermissionModal(perm) {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'editUserPermissionModal';
        modal.innerHTML = `
            <div class="modal-content modal-lg">
                <div class="modal-header">
                    <h3><i class="fas fa-user-edit"></i> 编辑用户权限配置</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>用户</label>
                        <div class="readonly-user-info">
                            <img src="${perm.user_info.avatar || '/static/images/default-avatar.png'}" 
                                 alt="${perm.user_info.username}" 
                                 class="user-avatar-small">
                            <div>
                                <div>${this.escapeHtml(perm.user_info.real_name || perm.user_info.username)}</div>
                                <div class="text-muted">@${this.escapeHtml(perm.user_info.username)}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <label>权限配置</label>
                        <div class="permission-grid">
                            ${Object.entries(perm.permissions).map(([key, val]) => `
                                <label class="permission-item">
                                    <input type="checkbox" 
                                           id="edit_perm_${key}" 
                                           ${val ? 'checked' : ''}>
                                    <span>${this.getPermissionLabel(key)}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="config-section">
                        <label>启用状态</label>
                        <label class="switch">
                            <input type="checkbox" id="edit_perm_is_active" ${perm.is_active ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>
                    
                    <div class="form-group">
                        <label>备注说明</label>
                        <textarea id="edit_perm_description" 
                                  class="form-control" 
                                  rows="3">${this.escapeHtml(perm.description || '')}</textarea>
                    </div>
                    
                    <p id="editUserPermError" class="error-message"></p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="cloudSettings.closeEditUserPermissionModal()">取消</button>
                    <button class="btn btn-primary" onclick="cloudSettings.updateUserPermission('${perm.user}')">更新</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-btn').onclick = () => this.closeEditUserPermissionModal();
        modal.onclick = (e) => {
            if (e.target === modal) this.closeEditUserPermissionModal();
        };
    }

    // 🔧 关闭编辑用户权限模态框
    closeEditUserPermissionModal() {
        const modal = document.getElementById('editUserPermissionModal');
        if (modal) {
            modal.remove();
        }
    }

    // 🔧 更新用户权限
    async updateUserPermission(userId) {
        const permissions = {};
        Object.keys(this.onlyofficeConfigs.permissions).forEach(key => {
            const checkbox = document.getElementById(`edit_perm_${key}`);
            if (checkbox) {
                permissions[key] = checkbox.checked;
            }
        });

        const payload = {
            permissions: permissions,
            is_active: document.getElementById('edit_perm_is_active').checked,
            description: document.getElementById('edit_perm_description').value.trim()
        };

        try {
            const response = await fetch(`/api/cloud/settings/user-permissions/${userId}/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '更新失败');
            }

            this.showSuccess('更新成功', '用户权限配置已更新');
            this.closeEditUserPermissionModal();
            await this.loadUserPermissions();

        } catch (error) {
            document.getElementById('editUserPermError').textContent = error.message;
        }
    }

    // 🔧 删除用户权限
    async deleteUserPermission(userId) {
        const confirmed = await this.showConfirmDialog(
            '删除确认',
            '确定要删除该用户的自定义权限配置吗？删除后将使用全局权限配置。',
            'danger'
        );

        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/settings/user-permissions/${userId}/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '删除失败');
            }

            this.showSuccess('删除成功', '用户权限配置已删除');
            await this.loadUserPermissions();

        } catch (error) {
            this.showError('删除失败', error.message);
        }
    }





    // 🔧 保存 OnlyOffice 配置
    async saveOnlyofficeConfigs() {
        const payload = {
            document_server_url: document.getElementById('oo_doc_url')?.value,
            jwt_enabled: document.getElementById('oo_jwt_enabled')?.checked,
            jwt_secret: document.getElementById('oo_jwt_secret')?.value,
            language: document.getElementById('oo_language')?.value,
            collaboration_mode: document.getElementById('oo_collab_mode')?.value,
            permissions: {
                download: document.getElementById('perm_download')?.checked,
                copy: document.getElementById('perm_copy')?.checked,
                edit: document.getElementById('perm_edit')?.checked,
                print: document.getElementById('perm_print')?.checked,
                comment: document.getElementById('perm_comment')?.checked,
                chat: document.getElementById('perm_chat')?.checked,
                review: document.getElementById('perm_review')?.checked,
                fill_forms: document.getElementById('perm_fill_forms')?.checked,
                modify_content_control: document.getElementById('perm_modify_content_control')?.checked,
                modify_filter: document.getElementById('perm_modify_filter')?.checked,
            },
            ui: {
                show_chat: document.getElementById('ui_show_chat')?.checked,
                show_comments: document.getElementById('ui_show_comments')?.checked,
                show_review: document.getElementById('ui_show_review')?.checked,
                show_spellcheck: document.getElementById('ui_show_spellcheck')?.checked,
                forcesave: document.getElementById('ui_forcesave')?.checked,
                compact_toolbar: document.getElementById('ui_compact_toolbar')?.checked,
                ui_theme: document.getElementById('oo_ui_theme')?.value,
            },
            version_keep_count: parseInt(document.getElementById('oo_version_count')?.value) || 10,
        };

        if (payload.jwt_enabled) {
            if (!payload.jwt_secret) {
                this.showError('请输入 JWT 密钥');
                return;
            }
            if (payload.jwt_secret.length !== 32) {
                this.showError('JWT 密钥长度必须为 32 个字符');
            }
            // payload.jwt_secret = btoa(payload.jwt_secret);
        }


        try {
            const response = await fetch('/api/cloud/settings/update_onlyoffice_configs/', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '保存失败');
            }

            this.showSuccess('保存成功', 'OnlyOffice 配置已更新');
            await this.loadOnlyofficeConfigs();

        } catch (error) {
            this.showError('保存失败', error.message);
        }
    }

    // 🔧 测试 OnlyOffice 连接
    async testOnlyofficeConnection() {
        const url = document.getElementById('oo_doc_url')?.value;
        if (!url) {
            this.showError('请输入服务器地址');
            return;
        }

        this.showLoading('正在测试连接...');

        try {
            // 通过后端代理测试，避免 CORS 问题
            const response = await fetch('/api/cloud/settings/system_info/', {
                headers: TokenManager.getHeaders()
            });
            const data = await response.json();

            const status = data.onlyoffice;
            if (status.status === 'online') {
                this.showSuccess('连接成功', `响应时间: ${status.response_time}s`);
            } else {
                this.showError('连接失败', status.error || '未知错误');
            }
        } catch (error) {
            this.showError('测试失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // 辅助方法：获取权限标签
    getPermissionLabel(key) {
        const map = {
            'download': '允许下载',
            'copy': '允许复制',
            'edit': '允许编辑',
            'print': '允许打印',
            'comment': '允许评论',
            'chat': '允许聊天',
            'review': '允许审阅',
            'fill_forms': '允许填写表单',
            'modify_content_control': '允许修改控件',
            'modify_filter': '允许修改筛选',
        };
        return map[key] || key;
    }

    // 辅助方法：获取功能标签
    getFeatureLabel(key) {
        const map = {
            'show_chat': '显示聊天',
            'show_comments': '显示评论',
            'show_review': '显示审阅',
            'show_spellcheck': '拼写检查',
            'forcesave': '强制保存按钮',
            'compact_toolbar': '紧凑工具栏',
        };
        return map[key] || key;
    }

    // 辅助方法：渲染语言选项
    renderLanguageOptions(current) {
        const langs = [
            {value: 'zh-CN', label: '简体中文'},
            {value: 'zh-TW', label: '繁体中文'},
            {value: 'en-US', label: 'English'},
            {value: 'ru-RU', label: 'Русский'},
            {value: 'de-DE', label: 'Deutsch'},
            {value: 'fr-FR', label: 'Français'},
            {value: 'es-ES', label: 'Español'},
            {value: 'pt-BR', label: 'Português'},
            {value: 'ja-JP', label: '日本語'},
            {value: 'ko-KR', label: '한국어'},
        ];
        return langs.map(lang =>
            `<option value="${lang.value}" ${lang.value === current ? 'selected' : ''}>${lang.label}</option>`
        ).join('');
    }

    // 格式化配置值显示
    formatValue(value, valueType) {
        if (valueType === 'password') return '••••••••';
        if (valueType === 'boolean') return value ? '✅ 是' : '❌ 否';
        if (valueType === 'json') {
            try {
                return '<pre>' + JSON.stringify(JSON.parse(value), null, 2) + '</pre>';
            } catch {
                return value;
            }
        }
        return this.escapeHtml(String(value));
    }

    // 打开编辑模态框
    openEditModal(key) {
        const config = this.configs.find(c => c.key === key);
        if (!config) return;

        this.editingConfig = config;

        document.getElementById('editConfigName').value = config.name;
        document.getElementById('editConfigKey').value = config.key;
        document.getElementById('editConfigDesc').textContent = config.description || '无描述';

        const valueContainer = document.getElementById('editConfigValueContainer');
        valueContainer.innerHTML = this.createValueInput(config);

        document.getElementById('editConfigError').textContent = '';
        document.getElementById('editConfigModal').classList.add('show');
    }

    // 创建值输入框
    createValueInput(config) {
        const value = config.typed_value;
        switch (config.value_type) {
            case 'boolean':
                return `<label class="switch"><input type="checkbox" id="editConfigValue" ${value ? 'checked' : ''}><span class="slider"></span></label>`;
            case 'json':
                return `<textarea id="editConfigValue" class="form-control" rows="5">${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</textarea>`;
            case 'password':
                return `<input type="password" id="editConfigValue" class="form-control" value="${value}" placeholder="输入新密码">`;
            default:
                return `<input type="${config.value_type === 'integer' || config.value_type === 'float' ? 'number' : 'text'}" id="editConfigValue" class="form-control" value="${value}">`;
        }
    }

    // 关闭编辑模态框
    closeEditModal() {
        document.getElementById('editConfigModal').classList.remove('show');
        this.editingConfig = null;
    }

    // 保存配置
    async saveConfig() {
        if (!this.editingConfig) return;

        const valueInput = document.getElementById('editConfigValue');
        let value;

        if (this.editingConfig.value_type === 'boolean') {
            value = valueInput.checked;
        } else if (this.editingConfig.value_type === 'json') {
            try {
                value = JSON.parse(valueInput.value);
            } catch (e) {
                document.getElementById('editConfigError').textContent = 'JSON 格式错误：' + e.message;
                return;
            }
        } else {
            value = valueInput.value;
        }

        try {
            const response = await fetch('/api/cloud/settings/update_config/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({key: this.editingConfig.key, value: value})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '保存失败');
            }

            this.showSuccess('保存成功', '配置已更新');
            this.closeEditModal();
            await this.loadConfigs(this.currentCategory);
        } catch (error) {
            document.getElementById('editConfigError').textContent = error.message;
        }
    }

    // 重置配置
    async resetConfig(key) {
        const confirmed = await this.showConfirm('重置配置', '确定要重置此配置为默认值吗？', 'warning');
        if (!confirmed) return;

        try {
            const response = await fetch('/api/cloud/settings/reset_to_default/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({key: key})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '重置失败');
            }

            this.showSuccess('重置成功', '配置已恢复为默认值');
            await this.loadConfigs(this.currentCategory);
        } catch (error) {
            this.showError('重置失败', error.message);
        }
    }

    // 导出配置

    // ==================== 配置导出 ====================

    /**
     * 导出系统配置
     * @param {string} format - 导出格式：'csv' 或 'json'
     * @param {string} category - 可选：只导出指定分类的配置
     */
    async exportConfigs(format = 'csv', category = null) {
        try {
            // 构建查询参数
            const params = new URLSearchParams({
                fmt: format
            });

            if (category) {
                params.append('category', category);
            }

            // 显示确认对话框
            const formatLabel = format === 'json' ? 'JSON' : 'CSV';
            const categoryLabel = category ? `（${this.getCategoryName(category)}）` : '（全部）';

            const confirmed = await this.showConfirmDialog(
                '导出配置',
                `确定要导出 ${formatLabel} 格式的系统配置${categoryLabel}吗？`,
                'confirm'
            );

            if (!confirmed) return;

            this.showLoading();

            // 🔧 关键修复1: 使用 fetch 下载文件（携带 Token）
            const url = `/api/cloud/settings/export_configs/?${params.toString()}`;

            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: TokenManager.getHeaders()  // 🔧 携带认证 Token
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    this.showError('导出失败', errorText);
                    throw new Error(`导出失败：${response.status} ${errorText.substring(0, 200)}`);
                }

                // 🔧 关键修复2: 获取 Blob 并触发下载
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);

                // 从 Content-Disposition 头获取文件名
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = `system_configs_${new Date().toISOString().split('T')[0]}.${format}`;
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                    if (filenameMatch) {
                        filename = filenameMatch[1];
                    }
                }

                // 创建下载链接
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // 释放 URL 对象
                window.URL.revokeObjectURL(downloadUrl);

                this.showSuccess('导出成功', `配置文件已下载`);

            } catch (error) {
                console.error('导出配置失败:', error);
                throw error;
            }

        } catch (error) {
            console.error('导出配置失败:', error);
            this.showError('导出失败', error.message || '未知错误');
        } finally {
            this.hideLoading();
        }
    }


    /**
     * 获取分类名称（用于显示）
     * @param {string} categoryKey - 分类键
     * @returns {string} 分类中文名称
     */
    getCategoryName(categoryKey) {
        const categoryMap = {
                'storage': '存储设置',
                'security': '安全设置',
                'upload': '上传设置',
                'share': '分享设置',
                'collaboration': '协同设置',
                'system': '系统设置',
                'notification': '通知设置',
                'audit': '审计日志'
            };
        return categoryMap[categoryKey] || categoryKey;
    }


    // 清除缓存
    async clearCache() {
        const confirmed = await this.showConfirm('清除缓存', '确定要清除系统缓存吗？', 'warning');
        if (!confirmed) return;

        try {
            const response = await fetch('/api/cloud/settings/clear_cache/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({type: 'all'})
            });
            if (!response.ok) throw new Error('清除失败');
            this.showSuccess('清除成功', '系统缓存已清除');
        } catch (error) {
            this.showError('清除失败', error.message);
        }
    }

    // 显示系统信息
    async showSystemInfo() {
        const modal = document.getElementById('systemInfoModal');
        const content = document.getElementById('systemInfoContent');
        modal.classList.add('show');
        content.innerHTML = `<div class="loading"><i class="fas fa-spinner fa-spin"></i><span>加载中...</span></div>`;

        try {
            const response = await fetch('/api/cloud/settings/system_info/', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载失败');
            const data = await response.json();
            content.innerHTML = this.renderSystemInfo(data);
        } catch (error) {
            content.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i><p>加载失败：${error.message}</p></div>`;
        }
    }

    // 渲染系统信息
    renderSystemInfo(data) {
        return `
            <div class="system-info-grid">
                <div class="info-card">
                    <div class="info-card-title"><i class="fas fa-server"></i> 服务器信息</div>
                    <div class="info-card-content">
                        <div>主机名：${data.server.hostname}</div>
                        <div>操作系统：${data.server.os}</div>
                        <div>Python: ${data.server.python_version}</div>
                        <div>Django: ${data.server.django_version}</div>
                    </div>
                </div>
                <div class="info-card">
                    <div class="info-card-title"><i class="fas fa-file-alt"></i> OnlyOffice</div>
                    <div class="info-card-content">
                        <div>状态：<span class="status-badge ${data.onlyoffice.status}">${data.onlyoffice.status}</span></div>
                        <div>URL: ${data.onlyoffice.url}</div>
                        ${data.onlyoffice.response_time ? `<div>响应时间：${data.onlyoffice.response_time}s</div>` : ''}
                        ${data.onlyoffice.error ? `<div style="color: var(--danger-color);">错误：${data.onlyoffice.error}</div>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    closeSystemInfoModal() {
        document.getElementById('systemInfoModal').classList.remove('show');
    }

    // 🔧 核心：侧边栏切换逻辑（适配移动端+桌面端）
    toggleSidebar(forceClose = false) {
        const sidebar = document.getElementById('settingsSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (!sidebar) return;

        if (window.innerWidth <= 768) {
            // 移动端：通过 class 控制显隐
            const isOpen = sidebar.classList.contains('show');
            if (forceClose || isOpen) {
                sidebar.classList.remove('show');
                if (overlay) overlay.classList.remove('show');
            } else {
                sidebar.classList.add('show');
                if (overlay) overlay.classList.add('show');
            }
        } else {
            // 桌面端：可选实现折叠逻辑，此处按需保持默认
            const overlayIsOpen = overlay && overlay.classList.contains('show');
            if (overlayIsOpen) {
                overlay.classList.remove('show');
            } else {
                overlay.classList.add('show');
            }
        }
    }

    setupEventListeners() {
        // 模态框关闭逻辑
        document.querySelectorAll('.modal .close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => e.target.closest('.modal')?.classList.remove('show'));
        });
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('show');
            });
        });

        // 侧边栏切换按钮绑定
        const toggleBtn = document.getElementById('sidebarToggleBtn');
        const closeBtn = document.getElementById('sidebarCloseBtn');
        const overlay = document.getElementById('sidebarOverlay');

        if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleSidebar());
        if (closeBtn) closeBtn.addEventListener('click', () => this.toggleSidebar());
        if (overlay) overlay.addEventListener('click', () => this.toggleSidebar(true));

        // 窗口尺寸变化时自动重置侧边栏状态
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                document.getElementById('settingsSidebar')?.classList.remove('show');
                document.getElementById('sidebarOverlay')?.classList.remove('show');
            }
        });
    }

    // 工具方法
    escapeHtml(text) {
        if (!text) return '';
        const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    showSuccess(title, message) {
        this.showToast(message, 'success');
    }

    showError(title, message) {
        this.showToast(message, 'error');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${type === 'error' ? '错误' : '成功'}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async showConfirm(title, message, type = 'confirm') {
        return new Promise(resolve => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <div class="confirm-dialog-header">
                        <i class="fas fa-${type === 'warning' ? 'exclamation-triangle' : 'question-circle'}"></i>
                        <h3>${title}</h3>
                    </div>
                    <div class="confirm-dialog-body"><p>${message}</p></div>
                    <div class="confirm-dialog-footer">
                        <button class="confirm-dialog-btn cancel">取消</button>
                        <button class="confirm-dialog-btn confirm">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);
            setTimeout(() => dialog.classList.add('show'), 10);
            dialog.querySelector('.cancel').onclick = () => {
                dialog.remove();
                resolve(false);
            };
            dialog.querySelector('.confirm').onclick = () => {
                dialog.remove();
                resolve(true);
            };
        });
    }

    async showSelect(title, options) {
        return new Promise(resolve => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <div class="confirm-dialog-header"><h3>${title}</h3></div>
                    <div class="confirm-dialog-body">
                        ${options.map(opt => `<button class="select-option-btn" data-value="${opt.value}">${opt.label}</button>`).join('')}
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);
            setTimeout(() => dialog.classList.add('show'), 10);
            dialog.querySelectorAll('.select-option-btn').forEach(btn => {
                btn.onclick = () => {
                    dialog.remove();
                    resolve(btn.dataset.value);
                };
            });
        });
    }


    // ==================== 优雅的提示对话框（替换 alert） ====================
    showAlert(title, message) {
        return new Promise((resolve) => {
            // 创建对话框
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
            <div class="confirm-dialog-content">
                <div class="confirm-dialog-header">
                    <i class="fas fa-info-circle"></i>
                    <h3>${title}</h3>
                    <button class="close-btn" style="margin-left: auto;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="confirm-dialog-body">
                    <p>${message}</p>
                </div>
                <div class="confirm-dialog-footer">
                    <button class="confirm-dialog-btn confirm">确定</button>
                </div>
            </div>
        `;

            document.body.appendChild(dialog);

            // 获取按钮
            const confirmBtn = dialog.querySelector('.confirm');
            const closeBtn = dialog.querySelector('.close-btn');

            // 关闭对话框
            const closeDialog = () => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) {
                        document.body.removeChild(dialog);
                    }
                }, 300);
                resolve();
            };

            // 事件监听
            if (confirmBtn) {
                confirmBtn.addEventListener('click', closeDialog);
            }
            if (closeBtn) {
                closeBtn.addEventListener('click', closeDialog);
            }
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    closeDialog();
                }
            });

            // 显示对话框
            setTimeout(() => {
                dialog.classList.add('show');
            }, 10);
        });
    }

    // ==================== 优雅的确认对话框 ====================

    async showConfirmDialog(title, message, type = 'confirm') {
        return new Promise(resolve => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <div class="confirm-dialog-header">
                        <i class="fas fa-${type === 'danger' ? 'exclamation-triangle' : 'check-circle'}"></i>
                        <h3>${title}</h3>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="confirm-dialog-body"><p>${message}</p></div>
                    <div class="confirm-dialog-footer">
                        <button class="confirm-dialog-btn cancel">取消</button>
                        <button class="confirm-dialog-btn ${type}">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);

            const close = (result) => {
                dialog.style.opacity = '0';
                setTimeout(() => {
                    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
                }, 300);
                resolve(result);
            };

            dialog.querySelector('.cancel').onclick = () => close(false);
            dialog.querySelector(`.${type}`).onclick = () => close(true);
            dialog.querySelector('.close-btn').onclick = () => close(false);
            dialog.onclick = (e) => {
                if (e.target === dialog) close(false);
            };

            setTimeout(() => dialog.style.opacity = '1', 10);
        });
    }

    showLoading(message) {
        let overlay = document.querySelector('.loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `<div class="loading-spinner"></div><div class="loading-text">${message || '加载中...'}</div>`;
            document.body.appendChild(overlay);
        } else {
            overlay.querySelector('.loading-text').textContent = message || '加载中...';
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        document.querySelector('.loading-overlay')?.remove();
    }
}

// 全局初始化
let cloudSettings = null;
document.addEventListener('DOMContentLoaded', () => {
    cloudSettings = new CloudSettingsApp();
    window.cloudSettings = cloudSettings;
});