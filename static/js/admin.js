// @File   :admin.js
// @Time   :2026/2/13 10:38
// @Author :dayue
// @Email  :ole211@qq.com
// API 基础配置
const API_ADMIN_URL = '/api/auth';

class AdminConsole {
    constructor() {
        this.users = [];
        this.allUsersForFriends = [];
        this.currentUser = null;
        this.currentPage = 1;
        this.pageSize = 20;
        this.pendingRequests = new Set(); // 跟踪请求状态
        this.sidebarCollapsed = false; // 侧边栏状态

        this.statusCode = null;
        this.chat_login_url = '/login/';

        // 🔧 新增：权限标识
        this.isSuperAdmin = false;
        this.selectedUsers = new Set();  // 🔧 批量操作选择


        // 🔧 新增：模块懒加载缓存
        this.modules = {
            statistics: null,    // AdminStatisticsClient
            settings: null,      // AdminSettingsClient
            chatRooms: null      // AdminChatRoomsClient
        };

        // 🔧 新增：当前激活的 tab
        this.currentTab = 'users';

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        try {
            // 检查登录状态
            const token = localStorage.getItem('access_token');
            if (!token) {
                // 保存当前页面链接，登录后跳转到该页面
                localStorage.setItem('redirect_url', window.location.href);
                window.location.href = this.chat_login_url;
                return;
            }

            // 检查管理员权限
            this.currentUser = await API.getCurrentUser();
            this.isSuperAdmin = this.currentUser?.is_superuser ||
                this.currentUser?.user_type === 'super_admin';

            console.log('🔧 当前用户权限:', {
                username: this.currentUser?.username,
                isSuperAdmin: this.isSuperAdmin,
                userType: this.currentUser?.user_type,
                department: this.currentUser?.department_info?.name
            });

            if (this.currentUser?.id) {
                localStorage.setItem('user_id', this.currentUser.id);
                localStorage.setItem('user_type', this.currentUser?.user_type);
            }


            if (!['admin', 'super_admin'].includes(this.currentUser?.user_type)) {
                // 仅管理员/超级管理员可访问，其余给出无权限警告并跳回聊天室
                this.showAlert('没有访问权限', '管理控制台仅限管理员 / 超级管理员访问。').then(() => {
                    window.location.href = '/chat/';
                });
                return;
            }


            //  🔧 根据权限初始化界面
            this.renderAdminInfo();
            this.setupPermissionUI();
            this.initTheme();

            // 🔧 关键修复：根据用户类型加载默认标签页
            if (this.isSuperAdmin) {
                // 超级管理员默认打开数据统计
                await this.switchTab('stats');
            } else {
                // 普通管理员默认打开用户管理
                await this.switchTab('users');
            }

            // // 🔧 普通管理员默认加载用户管理
            // if (!this.isSuperAdmin) {
            //     await this.loadUsers();
            // }

            // 设置事件监听
            this.setupEventListeners();
            this.setupSidebar();
            this.initTableScroll();
            this._setupGlobalClickHandler();

            // 加载用户管理过滤下拉
            this._loadFilterTenants();

            // 非超级管理员，自动选中当前企业并禁用企业下拉
            if (!this.isSuperAdmin && this.currentUser) {
                var activeTenant = this.currentUser.tenant_info || null;
                if (activeTenant && activeTenant.id) {
                    var filterTenant = document.getElementById('filterTenant');
                    if (filterTenant) {
                        filterTenant.value = activeTenant.id;
                        filterTenant.disabled = true;
                    }
                    this._loadFilterDepartments(activeTenant.id);
                }
            }

            // 添加跳转到聊天室按钮事件
            const gotoChatBtn = document.getElementById('gotoChatBtn');
            if (gotoChatBtn) {
                gotoChatBtn.addEventListener('click', () => {
                    window.location.href = '/chat/';
                });
            }


            // 🔧 关键修复：按需初始化聊天室管理（仅超级管理员）
            if (this.isSuperAdmin) {
                this.initChatRoomManagement();
            }

            console.log('AdminConsole 初始化完成');


        } catch (error) {
            console.error('初始化失败:', error);
            this.showError('初始化失败', error.message);
            this.handleAuthError()
        }
    }


    // ==================== 模块懒加载 ====================

    /**
     * 🔧 动态加载模块（懒加载核心方法）
     * @param {string} moduleName - 模块名称：'statistics' | 'settings' | 'chatRooms'
     * @param {Function} ModuleClass - 模块构造函数（从 window 获取）
     */
    async loadModule(moduleName, ModuleClass) {
        // 如果已加载，直接返回缓存实例
        if (this.modules[moduleName]) {
            console.log(`✅ 模块 ${moduleName} 已缓存，直接使用`);
            return this.modules[moduleName];
        }

        // 检查模块类是否存在
        if (typeof ModuleClass !== 'function') {
            console.warn(`⚠️ 模块 ${moduleName} 未定义，无法加载`);
            return null;
        }

        try {
            console.log(`🔧 正在加载模块 ${moduleName}...`);

            // 实例化模块
            const instance = new ModuleClass();

            // 如果有 init 方法，调用初始化
            if (typeof instance.init === 'function') {
                await instance.init();
            }

            // 缓存实例
            this.modules[moduleName] = instance;

            // 挂载到 window（兼容子模块内部代码）
            const windowName = `admin${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}`;
            window[windowName] = instance;

            console.log(`✅ 模块 ${moduleName} 加载完成`);
            return instance;

        } catch (error) {
            console.error(`❌ 加载模块 ${moduleName} 失败:`, error);
            this.showError('模块加载失败', `${moduleName} 初始化失败`);
            return null;
        }
    }

    /**
     * 🔧 根据 tab 切换动态加载对应模块
     * @param {string} tabName - 标签名称
     */
    async switchTabWithModule(tabName) {
        // 权限检查：普通管理员只能访问用户管理
        if (!this.isSuperAdmin && tabName !== 'users') {
            this.showError('权限不足', '您无权访问此功能');
            // 强制切回用户管理
            this.switchTab('users');
            return;
        }

        // 隐藏所有标签页
        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // 显示目标标签页
        const targetTab = document.getElementById(tabName + 'Tab');
        if (targetTab) {
            targetTab.classList.add('active');
        }

        // 更新当前激活的 tab
        this.currentTab = tabName;

        // 🔧 根据 tab 名称懒加载对应模块
        switch (tabName) {
            case 'stats':
                // 加载数据统计模块
                await this.loadModule('statistics', window.AdminStatisticsClient);
                // 刷新统计数据
                if (this.modules.statistics?.refreshAll) {
                    await this.modules.statistics.refreshAll();
                }
                break;

            case 'settings':
                // 加载系统设置模块
                await this.loadModule('settings', window.AdminSettingsClient);
                // 刷新配置列表
                if (this.modules.settings?.renderConfigList) {
                    this.modules.settings.renderConfigList(this.modules.settings.currentCategory);
                }
                break;

            case 'rooms':
                // 加载聊天室管理模块
                await this.loadModule('chatRooms', window.AdminChatRoomsClient);

                // 加载聊天室列表
                if (this.modules.chatRooms?.loadChatRooms) {
                    console.log('加载聊天室列表...');
                    this.modules.chatRooms.chatRoomsPage = 1;
                    await this.modules.chatRooms.loadChatRooms(false, 1);
                }
                break;

            case 'users':
            default:
                // 用户管理：直接加载数据
                await this.loadUsers();
                break;
        }
    }


    /**
     * 🔧 切换标签页（公共方法）
     */
    async switchTab_v1(tabName) {
        // 更新导航激活状态
        document.querySelectorAll('.admin-nav .nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        // 更新页面标题
        const titles = {
            'users': '用户管理',
            'stats': '数据统计',
            'rooms': '聊天室管理',
            'settings': '系统设置'
        };
        document.getElementById('pageTitle').textContent = titles[tabName] || '管理控制台';

        // 加载对应模块
        await this.switchTabWithModule(tabName);
    }

    // admin.js - 修改 switchTab 方法

    /**
     * 🔧 切换标签页（支持权限控制）
     */
    async switchTab(tabName) {
        // 🔧 权限检查：普通管理员只能访问用户管理、操作日志和OA
        if (!this.isSuperAdmin && tabName !== 'users' && tabName !== 'operation-logs' && tabName !== 'oa-attendance' && tabName !== 'oa-approval' && tabName !== 'oa-subsidy' && tabName !== 'chat' && tabName !== 'org') {
            this.showError('权限不足', '您无权访问此功能');
            // 强制切回用户管理
            tabName = 'users';
        }

        // 隐藏所有标签页
        document.querySelectorAll('.admin-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // 显示目标标签页
        const targetTab = document.getElementById(tabName + 'Tab');
        if (targetTab) {
            targetTab.classList.add('active');
        }

        // 更新导航激活状态
        document.querySelectorAll('.admin-nav .nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        // 更新页面标题
        const titles = {
            'users': '用户管理',
            'stats': '数据统计',
            'rooms': '聊天室管理',
            'settings': '系统设置',
            'login-logs': '登录日志',
            'operation-logs': '操作日志',
            'oa-attendance': '考勤打卡',
            'oa-approval': 'OA审批',
            'oa-subsidy': '普惠补贴',
            'org': '组织架构',
            'chat': '聊天',
        };
        document.getElementById('pageTitle').textContent = titles[tabName] || '管理控制台';

        // 🔧 加载对应模块数据
        switch (tabName) {
            case 'users':
                await this.loadUsers();
                break;
            case 'stats':
                if (this.isSuperAdmin && window.adminStatistics) {
                    // 懒加载统计模块
                    if (!window.adminStatistics.isInitialized) {
                        await window.adminStatistics.init();
                    } else {
                        await window.adminStatistics.refreshAll();
                    }
                }
                break;
            case 'rooms':
                if (this.isSuperAdmin && window.adminChatRoomsClient) {
                    console.log('切换聊天室列表...');
                    window.adminChatRoomsClient.chatRoomsPage = 1;
                    await window.adminChatRoomsClient.loadChatRooms();
                }
                break;
            case 'settings':
                if (this.isSuperAdmin && window.adminSettings) {
                    // 懒加载设置模块
                    if (!window.adminSettings.isInitialized) {
                        await window.adminSettings.init();
                    }
                }
                break;
            case 'login-logs':
                if (this.isSuperAdmin) this.loadLoginLogs();
                break;
            case 'operation-logs':
                this.loadOperationLogs();
                break;
            case 'oa-attendance':
            case 'oa-approval':
            case 'oa-subsidy':
                // iframe 自动加载，无需额外操作
                break;
        }
    }


    // ==================== 权限控制 ====================

    /**
     * 🔧 根据权限设置界面显示
     */
    setupPermissionUI() {
        // 🔧 隐藏/显示超级管理员专属菜单项（OA+组织架构+聊天对所有管理员开放）
        const superAdminItems = document.querySelectorAll('.nav-item[data-tab]:not([data-tab="users"]):not([data-tab="org"]):not([data-tab="chat"]):not([data-tab="oa-attendance"]):not([data-tab="oa-approval"]):not([data-tab="oa-subsidy"])');
        superAdminItems.forEach(item => {
            item.style.display = this.isSuperAdmin ? '' : 'none';
        });

        // 🔧 隐藏/显示超级管理员专属内容区域（操作日志+OA+聊天+组织架构对所有管理员可见）
        const superAdminTabs = document.querySelectorAll('.admin-tab:not(#usersTab):not(#operation-logsTab):not(#oa-attendanceTab):not(#oa-approvalTab):not(#oa-subsidyTab):not(#chatTab):not(#orgTab)');
        superAdminTabs.forEach(tab => {
            tab.style.display = this.isSuperAdmin ? '' : 'none';
        });

        // 🔧 操作日志为所有管理员开放
        const opLogNav = document.querySelector('[data-tab="operation-logs"]');
        if (opLogNav) opLogNav.style.display = '';
        const opLogTab = document.getElementById('operation-logsTab');
        if (opLogTab) opLogTab.style.display = '';

        // 🔧 组织架构对所有管理员开放
        const orgNav = document.querySelector('[data-tab="org"]');
        if (orgNav) orgNav.style.display = '';
        const orgTab = document.getElementById('orgTab');
        if (orgTab) orgTab.style.display = '';

        // 🔧 聊天对所有管理员开放
        const chatNav = document.querySelector('[data-tab="chat"]');
        if (chatNav) chatNav.style.display = '';
        const chatTab = document.getElementById('chatTab');
        if (chatTab) chatTab.style.display = '';

        // 🔧 OA办公对所有管理员开放
        const attNav = document.querySelector('[data-tab="oa-attendance"]');
        if (attNav) attNav.style.display = '';
        const appNav = document.querySelector('[data-tab="oa-approval"]');
        if (appNav) appNav.style.display = '';
        const attTab = document.getElementById('oa-attendanceTab');
        if (attTab) attTab.style.display = '';
        const appTab = document.getElementById('oa-approvalTab');
        if (appTab) appTab.style.display = '';
        const subNav = document.querySelector('[data-tab="oa-subsidy"]');
        if (subNav) subNav.style.display = '';
        const subTab = document.getElementById('oa-subsidyTab');
        if (subTab) subTab.style.display = '';

        // 🔧 如果普通管理员，确保只显示用户管理
        if (!this.isSuperAdmin) {
            // 移除其他标签页的激活状态
            document.querySelectorAll('.admin-tab').forEach(tab => {
                tab.classList.remove('active');
            });

            // 激活用户管理标签页
            const usersTab = document.getElementById('usersTab');
            if (usersTab) {
                usersTab.classList.add('active');
            }

            // 更新导航激活状态
            document.querySelectorAll('.admin-nav .nav-item').forEach(item => {
                item.classList.remove('active');
            });
            const usersNavItem = document.querySelector('[data-tab="users"]');
            if (usersNavItem) {
                usersNavItem.classList.add('active');
            }

            // 更新页面标题
            document.getElementById('pageTitle').textContent = '用户管理';
        }


        // 🔧 隐藏/显示部门字段（普通管理员）
        const createDeptGroup = document.getElementById('createDepartmentGroup');
        const editDeptGroup = document.getElementById('editDepartmentGroup');
        const createDeptHint = document.getElementById('createDepartmentHint');
        const editDeptHint = document.getElementById('editDepartmentHint');

        // 🔧 隐藏/显示用户类型字段（普通管理员）
        const createUserTypeGroup = document.getElementById('createUserTypeGroup');
        const editUserTypeGroup = document.getElementById('editUserTypeGroup');
        const createUserTypeHint = document.getElementById('createUserTypeHint');
        const editUserTypeHint = document.getElementById('editUserTypeHint');

        if (!this.isSuperAdmin) {
            // 🔧 普通管理员：部门字段设为只读，默认自己的部门
            if (createDeptGroup) {
                const deptSelect = document.getElementById('newDepartment');
                if (deptSelect) {
                    deptSelect.disabled = true;
                    // 默认设置为当前管理员的部门
                    if (this.currentUser?.department_info?.id) {
                        deptSelect.value = this.currentUser.department_info.id;
                    }
                }
                if (createDeptHint) createDeptHint.style.display = 'block';
            }

            if (editDeptGroup) {
                const deptSelect = document.getElementById('editDepartment');
                if (deptSelect) {
                    deptSelect.disabled = true;
                }
                if (editDeptHint) editDeptHint.style.display = 'block';
            }

            // 🔧 普通管理员：用户类型字段设为只读，只能是普通用户
            if (createUserTypeGroup) {
                const userTypeSelect = document.getElementById('newUserType');
                if (userTypeSelect) {
                    userTypeSelect.value = 'user';
                    userTypeSelect.disabled = true;
                }
                if (createUserTypeHint) createUserTypeHint.style.display = 'block';
            }

            if (editUserTypeGroup) {
                const userTypeSelect = document.getElementById('editUserType');
                if (userTypeSelect) {
                    userTypeSelect.disabled = true;
                }
                if (editUserTypeHint) editUserTypeHint.style.display = 'block';
            }
        } else {
            // 🔧 超级管理员：所有字段可编辑
            if (createDeptGroup) {
                const deptSelect = document.getElementById('newDepartment');
                if (deptSelect) deptSelect.disabled = false;
                if (createDeptHint) createDeptHint.style.display = 'none';
            }

            if (editDeptGroup) {
                const deptSelect = document.getElementById('editDepartment');
                if (deptSelect) deptSelect.disabled = false;
                if (editDeptHint) editDeptHint.style.display = 'none';
            }

            if (createUserTypeGroup) {
                const userTypeSelect = document.getElementById('newUserType');
                if (userTypeSelect) userTypeSelect.disabled = false;
                if (createUserTypeHint) createUserTypeHint.style.display = 'none';
            }

            if (editUserTypeGroup) {
                const userTypeSelect = document.getElementById('editUserType');
                if (userTypeSelect) userTypeSelect.disabled = false;
                if (editUserTypeHint) editUserTypeHint.style.display = 'none';
            }
        }


    }


    // ==================== 部门加载 ====================

    /**
     * 🔧 加载部门列表
     * @param {string} selectId - select element ID
     * @param {number|null} selectedId - selected department ID
     * @param {number|null} tenantId - filter by tenant ID, null for non-org departments only
     */
    async loadDepartments(selectId, selectedId = null, tenantId = null) {
        try {
            const select = document.getElementById(selectId);
            if (!select) return;

            // 清除之前的提示
            var parent = select.parentNode;
            var oldHint = parent.querySelector('.tenant-dept-hint');
            if (oldHint) oldHint.remove();

            // 填充部门下拉
            select.innerHTML = '';
            var firstOpt = document.createElement('option');
            firstOpt.value = '';
            firstOpt.textContent = '请选择部门';
            select.appendChild(firstOpt);

            if (tenantId) {
                // 选择了企业 → 加载该企业的组织架构部门
                var tenantName = '';
                var tenantSelect = document.getElementById(selectId === 'newDepartment' ? 'newTenant' : 'editTenant');
                if (tenantSelect && tenantSelect._tenantData) {
                    for (var ti = 0; ti < tenantSelect._tenantData.length; ti++) {
                        if (tenantSelect._tenantData[ti].id == tenantId) {
                            tenantName = tenantSelect._tenantData[ti].short_name || tenantSelect._tenantData[ti].name;
                            break;
                        }
                    }
                }
                try {
                    var orgResp = await fetch('/api/org/departments/?tenant_id=' + tenantId, {
                        headers: TokenManager.getHeaders()
                    });
                    if (orgResp.ok) {
                        var orgData = await orgResp.json();
                        var orgDepts = orgData.results || orgData || [];
                        // Build tree: group by parent
                        var byParent = {};
                        orgDepts.forEach(function(d) {
                            var pid = d.parent || 'root';
                            if (!byParent[pid]) byParent[pid] = [];
                            byParent[pid].push(d);
                        });
                        function appendChildren(parentId, depth) {
                            var children = byParent[parentId] || [];
                            children.forEach(function(d) {
                                var opt = document.createElement('option');
                                opt.value = 'org:' + d.id;
                                opt.setAttribute('data-dept-id', d.id);
                                var prefix = '';
                                for (var k = 0; k < depth; k++) prefix += '— ';
                                opt.textContent = (depth > 0 ? prefix : '') + d.name;
                                select.appendChild(opt);
                                appendChildren(d.id, depth + 1);
                            });
                        }
                        appendChildren('root', 0);
                    }
                } catch (e) { console.error('加载组织部门失败:', e); }

                var hint = document.createElement('div');
                hint.className = 'tenant-dept-hint';
                hint.style.cssText = 'font-size:12px;color:var(--text-light,#909399);padding:4px 0 0;';
                hint.textContent = '已选择企业「' + tenantName + '」，用户将自动加入该企业';
                parent.appendChild(hint);
            } else {
                // 未选择企业 → 只加载没有所属企业的部门
                try {
                    var adminResp = await fetch('/api/auth/admin/departments/?tenant_isnull=true', { headers: TokenManager.getHeaders() });
                    if (adminResp.ok) {
                        var departments = await adminResp.json();
                        var deptList = Array.isArray(departments) ? departments : (departments.results || []);
                        deptList.forEach(function(dept) {
                            var opt = document.createElement('option');
                            opt.value = dept.name;
                            opt.textContent = dept.name;
                            if (selectedId === dept.id) opt.selected = true;
                            select.appendChild(opt);
                        });
                    }
                } catch (e) { console.error('加载部门失败:', e); }
            }

        } catch (error) {
            console.error('加载部门失败:', error);
        }
    }


    renderAdminInfo() {
        const usernameEl = document.getElementById('adminUsername');
        const avatarEl = document.getElementById('adminAvatar');

        if (usernameEl && this.currentUser) {
            const roleText = this.isSuperAdmin ? '（超级管理员）' : '（管理员）';
            usernameEl.textContent = `${this.currentUser.username}${roleText}`;
        }

        if (avatarEl && this.currentUser?.avatar_url) {
            avatarEl.src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
        }
    }

    // ==================== 批量操作 ====================

    /**
     * 🔧 更新批量操作按钮显示
     */
    updateBatchActions() {
        const batchActions = document.getElementById('batchActions');
        const selectedCount = document.getElementById('selectedCount');

        if (batchActions && selectedCount) {
            const count = this.selectedUsers.size;
            if (count > 0) {
                batchActions.style.display = 'flex';
                selectedCount.textContent = `已选 ${count} 项`;
            } else {
                selectedCount.textContent = '';
                batchActions.style.display = 'none';
            }
        }
    }

    /**
     * 🔧 切换用户选择状态
     */
    toggleUserSelection(userId, checked) {
        if (checked) {
            this.selectedUsers.add(userId);
        } else {
            this.selectedUsers.delete(userId);
        }
        this.updateBatchActions();
    }

    /**
     * 🔧 批量删除用户
     */
    async batchDeleteUsers() {
        if (this.selectedUsers.size === 0) {
            this.showError('操作失败', '请先选择要删除的用户');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '批量删除',
            `确定要删除选中的 <span class="highlight">${this.selectedUsers.size}</span> 个用户吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>`,
            'danger'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/batch_delete/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({user_ids: Array.from(this.selectedUsers)})
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '批量删除失败');
            }

            const data = await response.json();
            this.showSuccess('删除成功', `成功删除 ${data.deleted_count} 个用户`);

            // 清空选择
            this.selectedUsers.clear();
            this.updateBatchActions();

            // 刷新列表
            await this.loadUsers();

        } catch (error) {
            console.error('批量删除失败:', error);
            this.showError('删除失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    // ==================== 初始化表格滚动检测 ====================
    initTableScroll() {
        const tableContainer = document.getElementById('usersTableContainer');
        const scrollIndicator = document.getElementById('scrollIndicator');

        if (!tableContainer || !scrollIndicator) return;

        // 检测是否需要显示滚动指示器
        const checkScroll = () => {
            const scrollWidth = tableContainer.scrollWidth;
            const clientWidth = tableContainer.clientWidth;

            if (scrollWidth > clientWidth) {
                scrollIndicator.classList.add('show');
            } else {
                scrollIndicator.classList.remove('show');
            }

            // 检测是否显示左右阴影
            const scrollLeft = tableContainer.scrollLeft;

            if (scrollLeft > 0) {
                tableContainer.classList.add('show-shadow');
            } else {
                tableContainer.classList.remove('show-shadow');
            }
        };

        // 监听滚动事件
        tableContainer.addEventListener('scroll', () => {
            checkScroll();
        });

        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            checkScroll();
        });

        // 初始检查
        setTimeout(() => {
            checkScroll();
        }, 100);
    }



    // ==================== 侧边栏管理 ====================
    setupSidebar() {
        const toggleBtn = document.getElementById('sidebarToggleBtn');
        const closeBtn = document.getElementById('sidebarCloseBtn');
        const overlay = document.getElementById('sidebarOverlay');

        // 切换
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleSidebar());
        }

        // 关闭
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeSidebar());
        }

        // 遮罩层
        if (overlay) {
            overlay.addEventListener('click', () => this.closeSidebar());
        }

    }

    toggleSidebar() {
        const sidebar = document.getElementById('adminSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const adminMain = document.querySelector('.admin-main');

        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
            this.sidebarOpen = sidebar.classList.contains('open');
        }

    }



    closeSidebar() {
        const sidebar = document.getElementById('adminSidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            this.sidebarOpen = false;
        }
    }

    // ==================== 刷新用户列表 ====================
    async refreshUsers() {
        const refreshBtn = event.target.closest('.btn');
        if (refreshBtn) {
            refreshBtn.classList.add('btn-refreshing');
            refreshBtn.disabled = true;
        }

        try {
            await this.loadUsers();
            this.showSuccess('刷新成功', '用户列表已更新');
        } catch (error) {
            console.error('刷新失败:', error);
            this.showError('刷新失败', error.message);
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('btn-refreshing');
                refreshBtn.disabled = false;
                // 清空选择
                this.selectedUsers.clear();
                this.updateBatchActions();
                const selectAll = document.getElementById('selectAll');
                if (selectAll) {
                    selectAll.checked = false;
                }
            }

        }
    }

    async loadUsers(page) {
        if (page === undefined) page = this.currentPage || 1;
        try {
            this.showLoading();
            var tenantId = document.getElementById('filterTenant') ? document.getElementById('filterTenant').value : '';
            var deptId = document.getElementById('filterDepartment') ? document.getElementById('filterDepartment').value : '';
            var searchVal = document.getElementById('userSearch') ? document.getElementById('userSearch').value.trim() : '';

            var url = API_ADMIN_URL + '/admin/users/?page=' + page + '&page_size=20';
            if (tenantId) url += '&tenant_id=' + tenantId;
            if (deptId) url += '&org_dept_id=' + deptId;
            if (searchVal) url += '&search=' + encodeURIComponent(searchVal);

            const response = await fetch(url, {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || errorData.detail || errorData.error || '加载用户列表失败');
            }

            const data = await response.json();
            if (data.results) {
                this.users = data.results;
                this.currentPage = data.page || page;
                this._renderUserPagination(data);
            } else {
                this.users = Array.isArray(data) ? data : [];
            }
            this.renderUsersTable();

        } catch (error) {
            console.error('加载用户失败:', error);
            this.showError('加载失败', error);
            if (this.statusCode === 401) {
                this.handleAuthError();
            }
        } finally {
            this.hideLoading();
        }
    }

    _renderUserPagination(data) {
        var container = document.getElementById('userPagination');
        if (!container) return;
        if (!data.total_pages || data.total_pages <= 1) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        var p = data.page, t = data.total_pages;
        var html = '<div class="user-pagination-bar">'
            + '<span class="user-pagination-total">共 ' + data.count + ' 条</span>'
            + '<div class="user-pagination-btns">';
        html += '<button class="pagination-btn" onclick="adminConsole.loadUsers(' + (p - 1) + ')" ' + (p <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        for (var i = Math.max(1, p - 2); i <= Math.min(t, p + 2); i++) {
            html += '<button class="pagination-btn ' + (i === p ? 'active' : '') + '" onclick="adminConsole.loadUsers(' + i + ')">' + i + '</button>';
        }
        html += '<button class="pagination-btn" onclick="adminConsole.loadUsers(' + (p + 1) + ')" ' + (p >= t ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button></div></div>';
        container.innerHTML = html;
    }

    _loadFilterTenants() {
        var sel = document.getElementById('filterTenant');
        if (!sel) return;
        fetch('/api/org/tenants/', { headers: TokenManager.getHeaders() }).then(function(resp) {
            return resp.ok ? resp.json() : {results: []};
        }).then(function(data) {
            var tenants = data.results || data || [];
            sel.innerHTML = '<option value="">全部企业</option>';
            tenants.forEach(function(t) {
                var opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.short_name || t.name;
                sel.appendChild(opt);
            });
        }).catch(function(e) { console.error('加载企业列表失败:', e); });
    }

    _loadFilterDepartments(tenantId) {
        var sel = document.getElementById('filterDepartment');
        if (!sel) return;
        sel.innerHTML = '<option value="">全部部门</option>';
        if (!tenantId) return;
        fetch('/api/org/departments/?tenant_id=' + tenantId, { headers: TokenManager.getHeaders() }).then(function(resp) {
            return resp.ok ? resp.json() : {results: []};
        }).then(function(data) {
            var depts = data.results || data || [];
            // Build tree structure: group by parent
            var byParent = {};
            depts.forEach(function(d) {
                var pid = d.parent || 'root';
                if (!byParent[pid]) byParent[pid] = [];
                byParent[pid].push(d);
            });
            // Render with depth prefix
            function renderChildren(parentId, depth) {
                var children = byParent[parentId] || [];
                children.forEach(function(d) {
                    var prefix = '';
                    for (var k = 0; k < depth; k++) prefix += '— ';
                    var opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = (depth > 0 ? prefix : '') + d.name;
                    sel.appendChild(opt);
                    renderChildren(d.id, depth + 1);
                });
            }
            renderChildren('root', 0);
        }).catch(function(e) { console.error('加载部门列表失败:', e); });
    }

    onFilterTenantChange() {
        var tenantId = document.getElementById('filterTenant') ? document.getElementById('filterTenant').value : '';
        this._loadFilterDepartments(tenantId);
        this.loadUsers(1);
    }

    loadFilteredUsers() {
        this.loadUsers(1);
    }


    // ==================== 用户列表渲染 ====================

    /**
     * 🔧 渲染用户表格（添加权限控制）
     */
    renderUsersTable(users=[]) {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        // 如果不是超级管理员，过滤掉普通管理员用户
        let allUsers = [];
        if (!this.isSuperAdmin) {
            allUsers = users.length > 0 ? users.filter(user => user.user_type === 'normal') : this.users.filter(user => user.user_type === 'normal')
        } else {
            allUsers = users.length > 0 ? users : this.users;
        }

        let html = '';
        allUsers.forEach(user => {
            // 🔧 关键修复：普通管理员不能操作超级管理员
            const canOperate = this.isSuperAdmin || user.user_type !== 'super_admin';

            html += `
                <tr class="${!user.is_active ? 'user-disabled-row' : ''}">
                    <td>
                        ${canOperate && this.isSuperAdmin ? `
                            <input type="checkbox" 
                                   class="user-checkbox" 
                                   data-user-id="${user.id}"
                                   onchange="adminConsole.toggleUserSelection(${user.id}, this.checked)">
                        ` : ''}
                    </td>
                    <td>${user.id}</td>
                    <td><img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="头像"></td>
                    <td>${user.username}</td>
                    <td>${user.real_name || '-'}</td>
                    <td>${user.tenant_info?.name || user.tenant_name || '-'}</td>
                    <td>${user.department_info?.name || user.department || '-'}</td>
                    <td>${user.position || '-'}</td>
                    <td><span class="user-type-badge user-type-${user.user_type}">${this.getUserTypeText(user.user_type)}</span></td>
                    <td>
                        <span class="user-status ${user.is_online ? 'online' : 'offline'}">
                            <i class="fas fa-${user.is_online ? 'circle' : 'circle'}"></i>
                            ${user.is_online ? '在线' : '离线'}
                        </span>
                    </td>
                    <td>
                        ${canOperate ? `
                            <div class="toggle-btn-container" onclick="event.stopPropagation()">
                                <label class="toggle-switch">
                                    <input type="checkbox"
                                           onchange="adminConsole.toggleUserStatus(${user.id}, this.checked, '${user.username}')"
                                           ${user.is_active ? 'checked' : ''}>
                                    <span class="toggle-slider"></span>
                                </label>
                                <span>${user.is_active ? '启用' : '禁用'}</span>
                            </div>
                        ` : `<span class="badge ${user.is_active ? 'badge-success' : 'badge-danger'}">${user.is_active ? '启用' : '禁用'}</span>`}
                    </td>
                    <td>
                        ${canOperate ? `
                            <div class="action-buttons">
                                <button class="action-btn" onclick="adminConsole.openEditUserModal(${user.id})" title="编辑">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="action-btn" onclick="adminConsole.resetPassword(${user.id}, '${user.username}')" title="重置密码">
                                    <i class="fas fa-key"></i>
                                </button>
                                ${this.isSuperAdmin ? `
                                    <button class="action-btn delete" onclick="adminConsole.confirmDeleteUser(${user.id}, '${user.username}')" title="删除">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                ` : ''}
                            </div>
                        ` : '<span class="text-muted">-</span>'}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="11" style="text-align: center; padding: 40px;">暂无用户</td></tr>';

        // 🔧 重新绑定全选事件
        this.bindSelectAllEvent();
    }

    /**
     * 🔧 绑定全选事件
     */
    bindSelectAllEvent() {
        const selectAll = document.getElementById('selectAll');
        if (selectAll) {
            selectAll.onchange = (e) => {
                const checked = e.target.checked;
                document.querySelectorAll('.user-checkbox').forEach(cb => {
                    cb.checked = checked;
                    const userId = cb.dataset.userId;
                    if (checked) {
                        if (userId) {
                            this.selectedUsers.add(userId);
                        }
                    } else {
                        this.selectedUsers.delete(userId);
                    }
                });
                this.updateBatchActions();
            };
        }
    }


    getUserTypeText(type) {
        const map = {
            'normal': '普通用户',
            'admin': '管理员',
            'super_admin': '超级管理员'
        };
        return map[type] || type;
    }

    // ==================== 禁用/启用用户 ====================
    /**
     * 🔧 切换用户状态（添加权限检查）
     */
    async toggleUserStatus(userId, newStatus, username) {
        // 🔧 权限检查
        // if (!this.isSuperAdmin) {
        //     this.showError('权限不足', '仅超级管理员可操作用户状态');
        //     // 恢复开关状态
        //     const checkbox = event.target;
        //     checkbox.checked = !newStatus;
        //     return;
        // }

        event.stopPropagation();

        const action = newStatus ? '启用' : '禁用';
        const confirmed = await this.showConfirmDialog(
            `${action}用户`,
            `确定要${action}用户 "<span class="highlight">${username}</span>" 吗？`,
            action === '禁用' ? 'danger' : 'confirm'
        );

        if (!confirmed) {
            const checkbox = event.target;
            checkbox.checked = !newStatus;
            return;
        }

        try {
            this.showLoading();
            const response = await fetch(`${API_ADMIN_URL}/admin/users/${userId}/toggle-status/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || `${action}用户失败`);
            }

            const data = await response.json();
            this.showSuccess(`${action}成功`, data.message);
            await this.loadUsers();

        } catch (error) {
            console.error(`${action}用户失败:`, error);
            this.showError(`${action}失败`, error.message);
            const checkbox = event.target;
            checkbox.checked = !newStatus;
        } finally {
            this.hideLoading();
        }
    }


    // ==================== 创建用户 ====================
    async openCreateUserModal() {
        // 重置表单
        document.getElementById('createUserForm').reset();


        // 🔧 关键修复：根据权限设置用户类型
        const userTypeSelect = document.getElementById('newUserType');
        if (userTypeSelect) {
            if (this.isSuperAdmin) {
                userTypeSelect.value = 'user';
                userTypeSelect.disabled = false;
            } else {
                userTypeSelect.value = 'user';
                userTypeSelect.disabled = true;
            }
        }

        // 🔧 关键修复：根据权限设置部门
        const deptSelect = document.getElementById('newDepartment');
        if (deptSelect) {
            if (this.isSuperAdmin) {
                deptSelect.disabled = false;
                await this.loadDepartments('newDepartment');
            } else {
                deptSelect.disabled = true;
                await this.loadDepartments('newDepartment');
                // 默认设置为当前管理员的部门（用名称匹配）
                if (this.currentUser?.department_info?.name) {
                    deptSelect.value = this.currentUser.department_info.name;
                }
            }
        }


        // 加载企业列表
        var tenantSelect = document.getElementById('newTenant');
        if (tenantSelect) {
            tenantSelect.innerHTML = '<option value="">请选择企业</option>';
            await this._loadTenantsSelect(tenantSelect);
            var tenantGroup = document.getElementById('createTenantGroup');
            if (tenantGroup) tenantGroup.style.display = this.isSuperAdmin ? '' : 'none';
        }

        // 加载所有用户用于好友分配
        await this.loadAllUsersForFriends();

        // 渲染好友选择界面（初始无好友）
        this.renderFriendSelection_create('friendGridCreate', [], 'friendSearchCreate');

        this.openModal('createUserModal');
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    isValidPhone(phone) {
        const phoneRegex = /^1[3456789]\d{9}$/;
        return phoneRegex.test(phone);
    }

    // 修改 createUser 方法，添加好友分配
    async createUser() {
        const username = document.getElementById('newUsername').value.trim();
        const password = document.getElementById('newPassword').value;
        const passwordConfirm = document.getElementById('newPasswordConfirm').value;
        const gender = document.getElementById('newGender').value;
        const realName = document.getElementById('newRealName').value.trim();
        const email = document.getElementById('newEmail').value.trim();
        const phone = document.getElementById('newPhone').value.trim();
        const departmentName = document.getElementById('newDepartment').value.trim();
        const position = document.getElementById('newPosition').value.trim();
        const userType = document.getElementById('newUserType').value;

        if (!username || !password) {
            this.showError('验证失败', '用户名和密码不能为空');
            return;
        }
        if (password !== passwordConfirm) {
            this.showError('验证失败', '两次输入的密码不一致');
            return;
        }

        if (!email) {
            this.showError('验证失败', '邮箱不能为空');
            return;
        }

        // 验证是否是合法邮箱
        if (!this.isValidEmail(email)) {
            this.showError('验证失败', '邮箱格式不正确');
            return;
        }

        if (phone && !this.isValidPhone(phone)) {
            this.showError('验证失败', '手机号格式不正确');
            return;
        }

        if (this.isSuperAdmin && !userType) {
            this.showError('验证失败', '用户类型不能为空');
            return;
        }



        try {
            this.showLoading();

            // 构建请求数据
            const requestData = {
                username: username,
                password: password,
                password_confirm: passwordConfirm,
                gender: gender || null,
                real_name: realName || null,
                email: email || null,
                phone: phone || null,
                position: position || null,
                // 🔧 关键修复：普通管理员强制设置为普通用户
                user_type: this.isSuperAdmin ? userType : 'normal'
            };

            // 🔧 处理部门（支持旧版和组织架构部门）
            if (this.isSuperAdmin) {
                // 超级管理员可以设置任意部门
                if (departmentName) {
                    if (departmentName.startsWith('org:')) {
                        // 组织架构部门 - 创建用户后再通过 org API 分配
                        var orgDeptId = parseInt(departmentName.replace('org:', ''));
                        requestData._org_dept_id = orgDeptId;
                    } else {
                        let departmentId = await this.getOrCreateDepartment(departmentName);
                        if (departmentId) {
                            requestData.department = departmentId;
                        }
                    }
                }
            } else {
                // 🔧 普通管理员强制设置为自己的部门
                if (this.currentUser?.department_info?.id) {
                    requestData.department = this.currentUser.department_info.id;
                }
            }

            // 移除内部字段
            var orgDeptId = requestData._org_dept_id;
            delete requestData._org_dept_id;

            // 获取选择的所属企业
            var tenantIdVal = document.getElementById('newTenant') ? document.getElementById('newTenant').value : '';

            // 创建用户
            const response = await fetch(`${API_ADMIN_URL}/admin/users/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || errorData.detail || '创建用户失败');
            }

            const newUser = await response.json();
            console.log('创建用户成功:', newUser);

            // 自动加入所选企业（invite会自动设置为默认企业）
            if (tenantIdVal) {
                try {
                    await fetch('/api/org/tenants/' + tenantIdVal + '/invite/', {
                        method: 'POST',
                        headers: TokenManager.getHeaders(),
                        body: JSON.stringify({ user_id: newUser.id, role: 'member' })
                    });
                } catch (e) { console.error('加入企业失败:', e); }
            }

            // 分配到组织架构部门（如果选择了）
            if (orgDeptId) {
                try {
                    var addUrl = '/api/org/departments/' + orgDeptId + '/add_members/';
                    if (tenantIdVal) addUrl += '?tenant_id=' + tenantIdVal;
                    await fetch(addUrl, {
                        method: 'POST',
                        headers: TokenManager.getHeaders(),
                        body: JSON.stringify({ user_ids: [newUser.id] })
                    });
                } catch (e) {
                    console.error('分配组织部门失败:', e);
                }
            }

            // 保存好友关系
            const selectedFriends = Array.from(document.querySelectorAll('#friendGridCreate .member-grid-item.selected'))
                .map(item => parseInt(item.dataset.userId));

            if (selectedFriends.length > 0) {
                await this.assignFriends(newUser.id, selectedFriends)
            }


            this.showSuccess('创建成功', '用户创建成功');
            this.closeModal('createUserModal');
            await this.loadUsers();

        } catch (error) {
            console.error('创建用户失败:', error);
            this.showError('创建失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // 修改 updateUser 方法，保存好友关系
    async updateUser() {
        const userId = document.getElementById('editUserId').value;
        const password = document.getElementById('editPassword').value;
        const realName = document.getElementById('editRealName').value.trim();
        const gender = document.getElementById('editGender').value;
        const email = document.getElementById('editEmail').value.trim();
        const phone = document.getElementById('editPhone').value.trim();
        const departmentName = document.getElementById('editDepartment').value.trim();
        const position = document.getElementById('editPosition').value.trim();
        const userType = document.getElementById('editUserType').value;

        try {
            this.showLoading();

            // 构建请求数据（不包含username）
            const requestData = {
                real_name: realName || null,
                gender: gender || null,
                email: email || null,
                phone: phone || null,
                position: position || null,
                // 🔧 关键修复：普通管理员不能修改用户类型
                user_type: this.isSuperAdmin ? userType : 'normal'
            };

            // 如果密码不为空，添加到请求中
            if (password) requestData.password = password;


            // 🔧 处理部门（支持旧版和组织架构部门）
            if (this.isSuperAdmin) {
                // 超级管理员可以修改部门
                if (departmentName) {
                    if (departmentName.startsWith('org:')) {
                        // 组织架构部门
                        var orgDeptId = parseInt(departmentName.replace('org:', ''));
                        requestData._org_dept_id = orgDeptId;
                        // 不设置旧版部门
                    } else {
                        let departmentId = await this.getOrCreateDepartment(departmentName);
                        if (departmentId) {
                            requestData.department = departmentId;
                        }
                    }
                } else {
                    requestData.department = null;
                }
            } else {
                // 🔧 普通管理员不能修改部门，保持原部门
                const user = this.users.find(u => u.id === userId);
                if (user?.department_info?.id) {
                    requestData.department = user.department_info.id;
                }
            }

            // 移除内部字段
            var orgDeptId = requestData._org_dept_id;
            delete requestData._org_dept_id;
            var editTenantVal = document.getElementById('editTenant') ? document.getElementById('editTenant').value : '';

            const response = await fetch(`${API_ADMIN_URL}/admin/users/${userId}/`, {
                method: 'PUT',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || errorData.detail || '更新用户失败');
            }

            // 保存好友关系
            const selectedFriends = Array.from(document.querySelectorAll('#friendGrid .member-grid-item.selected'))
                .map(item => parseInt(item.dataset.userId));

            await this.assignFriends(userId, selectedFriends)

            // 分配到组织架构部门（如果选择了）
            if (orgDeptId) {
                try {
                    var addUrl = '/api/org/departments/' + orgDeptId + '/add_members/';
                    if (editTenantVal) addUrl += '?tenant_id=' + editTenantVal;
                    await fetch(addUrl, {
                        method: 'POST',
                        headers: TokenManager.getHeaders(),
                        body: JSON.stringify({ user_ids: [userId] })
                    });
                } catch (e) {
                    console.error('分配组织部门失败:', e);
                }
            }

            // 处理所属企业变更（invite自动设置为默认企业）
            if (editTenantVal) {
                try {
                    await fetch('/api/org/tenants/' + editTenantVal + '/invite/', {
                        method: 'POST',
                        headers: TokenManager.getHeaders(),
                        body: JSON.stringify({ user_id: userId, role: 'member' })
                    });
                } catch (e) { console.error('加入企业失败:', e); }
            }

            this.showSuccess('更新成功', '用户信息更新成功');
            this.closeModal('editUserModal');
            await this.loadUsers();

        } catch (error) {
            console.error('更新用户失败:', error);
            this.showError('更新失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // 新增：获取或创建部门
    async getOrCreateDepartment(departmentName) {
        try {
            // 1. 先查询部门是否存在
            const searchResponse = await fetch(`${API_ADMIN_URL}/departments/?name=${encodeURIComponent(departmentName)}`, {
                headers: TokenManager.getHeaders()
            });

            if (searchResponse.ok) {
                const deptData = await searchResponse.json()
                if (Array.isArray(deptData.results) && deptData.results.length > 0) {
                    // 部门已存在，返回ID
                    return deptData.results[0].id;
                }
                console.log('部门不存在，尝试创建');
            }

            // 2. 部门不存在，尝试创建
            const createResponse = await fetch(`${API_ADMIN_URL}/departments/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({name: departmentName})
            });

            if (createResponse.ok) {
                const newDept = await createResponse.json();
                return newDept.id;
            } else {
                // 创建失败（可能是唯一性冲突），再次查询
                const retryResponse = await fetch(`${API_ADMIN_URL}/departments/?name=${encodeURIComponent(departmentName)}`, {
                    headers: TokenManager.getHeaders()
                });

                if (retryResponse.ok) {
                    const retryData = await retryResponse.json();
                    if (Array.isArray(retryData) && retryData.length > 0) {
                        return retryData[0].id;
                    }
                }
            }

            return null;
        } catch (error) {
            console.error('获取或创建部门失败:', error);
            return null;
        }
    }


    // 加载所有用户用于好友分配
    async loadAllUsersForFriends() {
        try {
            const response = await fetch(`${API_ADMIN_URL}/users/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '加载用户列表失败');
            }

            const data = await response.json();
            // console.log('data:', data)
            this.allUsersForFriends = Array.isArray(data) ? data : (data.results || []);
            // console.log('this.allUsersForFriends:', this.allUsersForFriends)
            return this.allUsersForFriends;
        } catch (error) {
            console.error('加载用户列表失败:', error);
            this.showError('加载失败', error.message);
            return [];
        }
    }


    // 加载用户好友列表
    async loadUserFriends(userId) {
        try {
            const response = await fetch(`${API_ADMIN_URL}/admin/users/${userId}/friends/`, {
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                const friends = await response.json();
                // 渲染好友选择界面，传入已选好友
                this.renderFriendSelection_edit(friends, userId);
            }
        } catch (error) {
            console.error('加载好友列表失败:', error);
        }
    }

    // 分配好友
    async assignFriends(userId, selectedFriends = []) {
        try {
            const response = await fetch(`${API_ADMIN_URL}/admin/users/${userId}/assign-friends/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({friend_ids: selectedFriends})
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData?.error || errorData?.message || '分配好友失败');
            }
            return response;
        } catch (error) {
            console.error('分配好友失败:', error);
            this.showError('分配好友失败', error || error.message);

        }
    }

    // 渲染好友选择界面
    renderFriendSelection_edit(friends, userId) {
        const friendContainer = document.getElementById('friendSelectionContainer');
        if (!friendContainer) return;

        // 获取所有用户（排除当前用户）
        const allUsers = this.users.filter(u => u.id !== userId);

        let html = `
        <div class="form-group">
            <label><i class="fas fa-user-friends"></i> 分配好友</label>
            <div class="search-box">
                <i class="fas fa-search"></i>
                <input type="text" id="friendSearch" placeholder="搜索用户...">
            </div>
            <div class="member-grid" id="friendGrid">
    `;

        allUsers.forEach(user => {
            const isSelected = friends.some(f => f.id === user.id);
            html += `
            <div class="member-grid-item ${isSelected ? 'selected' : ''}" data-user-id="${user.id}">
                <div class="member-grid-avatar">
                    <img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="${user.username}">
                </div>
                <div class="member-grid-name">${user.real_name || user.username}</div>
                ${isSelected ? '<div class="member-grid-tag">已选</div>' : ''}
            </div>
        `;
        });

        html += `
            </div>
            <small class="form-hint">点击用户选择/取消好友，选中的用户将出现在该用户的通讯录中</small>
        </div>
    `;

        friendContainer.innerHTML = html;

        // 绑定好友选择事件
        document.querySelectorAll('#friendGrid .member-grid-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                item.classList.toggle('selected');
            });
        });

        // 绑定搜索事件
        const friendSearch = document.getElementById('friendSearch');
        if (friendSearch) {
            friendSearch.addEventListener('input', (e) => {
                const keyword = e.target.value.toLowerCase();
                document.querySelectorAll('#friendGrid .member-grid-item').forEach(item => {
                    const username = item.querySelector('.member-grid-name').textContent.toLowerCase();
                    item.style.display = username.includes(keyword) ? 'flex' : 'none';
                });
            });
        }
    }


    // 渲染好友选择界面（创建用户和编辑用户通用）
    renderFriendSelection_create(containerId, selectedFriends = [], searchInputId = 'friendSearch') {
        const container = document.getElementById(containerId);
        if (!container) return;


        // 获取所有用户（排除当前用户 - 仅在编辑用户时需要）
        // let allUsers = this.allUsersForFriends;
        let allUsers = this.users;

        // 将已选好友排到前面
        const sortedUsers = [...allUsers].sort((a, b) => {
            const aSelected = selectedFriends.some(f => f.id === a.id);
            const bSelected = selectedFriends.some(f => f.id === b.id);
            if (aSelected && !bSelected) return -1;
            if (!aSelected && bSelected) return 1;
            return 0;
        });

        let html = '';

        sortedUsers.forEach(user => {
            const isSelected = selectedFriends.some(f => f.id === user.id);
            html += `
            <div class="member-grid-item ${isSelected ? 'selected' : ''}" data-user-id="${user.id}">
                <div class="member-grid-avatar">
                    <img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="${user.username}">
                </div>
                <div class="member-grid-name">${user.real_name || user.username}</div>
                ${isSelected ? '<div class="member-grid-tag">已选</div>' : ''}
            </div>
        `;
        });

        container.innerHTML = html || '<div class="empty-state"><p>暂无用户</p></div>';

        // 绑定好友选择事件
        document.querySelectorAll(`#${containerId} .member-grid-item`).forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                item.classList.toggle('selected');
                const tag = item.querySelector('.member-grid-tag');
                if (tag) {
                    tag.remove();
                } else {
                    const tagEl = document.createElement('div');
                    tagEl.className = 'member-grid-tag';
                    tagEl.textContent = '已选';
                    item.appendChild(tagEl);
                }
            });
        });

        // 绑定搜索事件
        const friendSearch = document.getElementById(searchInputId);
        if (friendSearch) {
            friendSearch.addEventListener('input', (e) => {
                const keyword = e.target.value.toLowerCase();
                document.querySelectorAll(`#${containerId} .member-grid-item`).forEach(item => {
                    const username = item.querySelector('.member-grid-name').textContent.toLowerCase();
                    item.style.display = username.includes(keyword) ? 'flex' : 'none';
                });
            });
        }
    }


    // ==================== 编辑用户 ====================
    async openEditUserModal(userId) {
        try {
            const user = this.users.find(u => u.id === userId);
            if (!user) {
                this.showError('错误', '用户不存在');
                return;
            }


            // 🔧 权限检查：普通管理员不能编辑非普通用户
            if (!this.isSuperAdmin && user.user_type !== 'normal') {
                this.showError('权限不足', '普通管理员只能编辑普通用户');
                return;
            }

            // 渲染当前编辑的用户
            document.getElementById('editCurrentUser').textContent = `${user.username}（${user.real_name || '-'}）`;
            // 填充表单
            document.getElementById('editUserId').value = user.id;
            document.getElementById('editUsername').value = user.username;
            document.getElementById('editRealName').value = user.real_name || '';
            document.getElementById('editGender').value = user.gender || '';
            document.getElementById('editEmail').value = user.email || '';
            document.getElementById('editPhone').value = user.phone || '';
            document.getElementById('editPosition').value = user.position || '';
            document.getElementById('editUserType').value = user.user_type;

            // 🔧 关键修复：根据权限设置字段状态
            const userTypeSelect = document.getElementById('editUserType');
            const deptSelect = document.getElementById('editDepartment');

            // 加载企业列表（先于部门加载）
            var editTenantId = null;
            var editTenantSelect = document.getElementById('editTenant');
            if (editTenantSelect) {
                editTenantSelect.innerHTML = '<option value="">请选择企业</option>';
                await this._loadTenantsSelect(editTenantSelect);
                // 如果用户有 tenant_info，默认选中
                if (user.tenant_info) {
                    editTenantSelect.value = user.tenant_info.id || user.tenant_info.tenant_id;
                    editTenantId = editTenantSelect.value;
                }
                var editTenantGroup = document.getElementById('editTenantGroup');
                if (editTenantGroup) editTenantGroup.style.display = this.isSuperAdmin ? '' : 'none';
            }

            if (!this.isSuperAdmin) {
                // 普通管理员：用户类型和部门不可编辑
                if (userTypeSelect) userTypeSelect.disabled = true;
                if (deptSelect) deptSelect.disabled = true;
            } else {
                // 超级管理员：可编辑
                if (userTypeSelect) userTypeSelect.disabled = false;
                if (deptSelect) {
                    deptSelect.disabled = false;
                    await this.loadDepartments('editDepartment', null, editTenantId);
                }
            }

            // 部门列表加载完成后，设置当前选中值
            var deptVal = '';
            if (user.department_info) {
                if (user.department_info.type === 'org' && user.department_info.id) {
                    deptVal = 'org:' + user.department_info.id;
                } else if (user.department_info.name) {
                    deptVal = user.department_info.name;
                }
            } else if (user.department) {
                deptVal = user.department;
            }
            if (deptSelect && deptVal) {
                deptSelect.value = deptVal;
            }

            // 加载所有用户用于好友分配
            await this.loadAllUsersForFriends();

            // 加载当前用户的好友列表
            await this.loadUserFriends(userId);

            this.openModal('editUserModal');
        } catch (error) {
            console.error('加载用户信息失败:', error);
            this.showError('加载失败', '加载用户信息失败');
        }
    }


    // ==================== 权限控制的操作方法 ====================

    /**
     * 🔧 确认删除用户（添加权限检查）
     */
    async confirmDeleteUser(userId, username) {
        // 🔧 权限检查
        if (!this.isSuperAdmin) {
            this.showError('权限不足', '仅超级管理员可删除用户');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '删除用户',
            `确定要删除用户 "<span class="highlight">${username}</span>" 吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>`,
            'danger'
        );

        if (confirmed) {
            await this.deleteUser(userId);
        }
    }

    async deleteUser(userId) {
        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/${userId}/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '删除用户失败');
            }

            this.showSuccess('删除成功', '用户已删除');
            this.closeModal('editUserModal');
            await this.loadUsers();

        } catch (error) {
            console.error('删除用户失败:', error);
            this.showError('删除失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    /**
     * 🔧 优雅的重置密码入口
     */
    async resetPassword(userId, username) {
        // 保存当前操作的用户信息
        this.currentResetUserId = userId;

        // 填充模态框
        document.getElementById('resetPasswordUsername').textContent = username;
        document.getElementById('resetPasswordInput').value = '123456';

        // 打开模态框
        this.openModal('resetPasswordModal');
    }

    /**
     * 🔧 确认重置密码
     */
    async confirmResetPassword() {
        const newPassword = document.getElementById('resetPasswordInput').value.trim();

        // 验证密码
        if (!newPassword || newPassword.length < 6) {
            this.showError('验证失败', '密码不能为空且至少 6 位');
            return;
        }

        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/${this.currentResetUserId}/reset-password/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({password: newPassword})
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '重置密码失败');
            }

            const data = await response.json();
            this.showSuccess('重置成功', `密码已重置为：${data.default_password}`);

            this.closeModal('resetPasswordModal');

        } catch (error) {
            console.error('重置密码失败:', error);
            this.showError('重置失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    // ==================== 批量删除 ====================
    async batchDelete(users) {
        if (users.length === 0) {
            this.showError('操作失败', '请选择要删除的用户');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '批量删除',
            `确定要删除选中的 <span class="highlight">${users.length}</span> 个用户吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>`,
            'danger'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/batch-delete/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({user_ids: users})
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '批量删除失败');
            }

            const data = await response.json();
            this.showSuccess('删除成功', `成功删除 ${data.deleted_count} 个用户`);
            await this.loadUsers();

        } catch (error) {
            console.error('批量删除失败:', error);
            this.showError('删除失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // ==================== 导出用户 ====================
    async exportUsers() {
        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/export/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '导出失败');
            }

            // 下载文件
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `users_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.showSuccess('导出成功', '用户数据已导出');

        } catch (error) {
            console.error('导出失败:', error);
            this.showError('导出失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // ==================== 搜索用户 ====================
    /**
     * 🔧 搜索用户（前端过滤）
     */
    searchUsers_frontend(keyword) {
        if (!keyword.trim()) {
            this.renderUsersTable();
            return;
        }

        const filteredUsers = this.users.filter(user =>
            user.username.toLowerCase().includes(keyword.toLowerCase()) ||
            (user.real_name && user.real_name.toLowerCase().includes(keyword.toLowerCase())) ||
            (user.department_info && user.department_info?.name.toLowerCase().includes(keyword.toLowerCase())) ||
            (user.position && user.position.toLowerCase().includes(keyword.toLowerCase()))
        );

        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        let html = '';
        filteredUsers.forEach(user => {
            html += `
            <tr class="${!user.is_active ? 'user-disabled-row' : ''}">
                <td></td>
                <td>${user.id}</td>
                <td><img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="头像"></td>
                <td>${user.username}</td>
                <td>${user.real_name || '-'}</td>
                <td>${user.tenant_info?.name || user.tenant_name || '-'}</td>
                <td>${user.department_info?.name || user.department || '-'}</td>
                <td>${user.position || '-'}</td>
                <td><span class="user-type-badge user-type-${user.user_type}">${this.getUserTypeText(user.user_type)}</span></td>
                <td>
                    <div class="toggle-btn-container" onclick="event.stopPropagation()">
                        <label class="toggle-switch">
                            <input type="checkbox"
                                   onchange="adminConsole.toggleUserStatus(${user.id}, this.checked, '${user.username}')"
                                   ${user.is_active ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                        <span>${user.is_active ? '启用' : '禁用'}</span>
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn" onclick="adminConsole.openEditUserModal(${user.id})" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete" onclick="adminConsole.confirmDeleteUser(${user.id}, '${user.username}')" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="11" style="text-align: center; padding: 40px;">未找到相关用户</td></tr>';
    }


    // ==================== 搜索功能 ====================

    /**
     * 🔧 搜索用户（调用后端接口）
     */
    searchUsers(keyword) {
        if (!keyword.trim()) {
            this.loadUsers(1);
            return;
        }
        // For search with keyword, use the backend search with filters
        this.searchUsersFromBackend(keyword);
    }

    /**
     * 🔧 从后端搜索用户（支持分页和企业/部门过滤）
     */
    async searchUsersFromBackend(keyword) {
        try {
            this.showLoading();

            var tenantId = document.getElementById('filterTenant') ? document.getElementById('filterTenant').value : '';
            var deptId = document.getElementById('filterDepartment') ? document.getElementById('filterDepartment').value : '';

            var url = API_ADMIN_URL + '/admin/users/?search=' + encodeURIComponent(keyword) + '&page=1&page_size=20';
            if (tenantId) url += '&tenant_id=' + tenantId;
            if (deptId) url += '&org_dept_id=' + deptId;

            const response = await fetch(url, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '搜索用户失败');
            }

            const data = await response.json();
            if (data.results) {
                this.users = data.results;
                this.currentPage = data.page || 1;
                this._renderUserPagination(data);
            } else {
                this.users = Array.isArray(data) ? data : [];
            }
            this.renderUsersTable();

        } catch (error) {
            console.error('搜索用户失败:', error);
            this.showError('搜索失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    // ==================== 事件监听 ====================

    /**
     * 🔧 设置事件监听（添加权限检查）
     */
    setupEventListeners() {
        // 标签切换
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                // 🔧 权限检查：普通管理员不能访问超级管理员菜单
                if (item.classList.contains('super-admin-only') && !this.isSuperAdmin) {
                    this.showError('权限不足', '您无权访问此功能');
                    return;
                }

                // 更新激活状态
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                const tabName = item.dataset.tab;

                // 切换标签页
                document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
                const targetTab = document.getElementById(tabName + 'Tab');
                if (targetTab) {
                    targetTab.classList.add('active');
                }

                // 移动端自动关闭侧边栏
                if (window.innerWidth <= 768) {
                    this.closeSidebar();
                }


                // 更新页面标题
                document.getElementById('pageTitle').textContent = item.textContent.trim();

                // 🔧 加载对应模块数据
                switch (tabName) {
                    case 'users':
                        this.loadUsers(1);
                        break;
                    case 'stats':
                        if (this.isSuperAdmin && window.adminStatistics) {
                            // 懒加载统计模块
                            if (!window.adminStatistics.isInitialized) {
                                window.adminStatistics.init();
                            } else {
                                window.adminStatistics.refreshAll();
                            }
                        }
                        break;
                    case 'rooms':
                        if (this.isSuperAdmin && window.adminChatRoomsClient) {
                            console.log('监听加载聊天室列表...');
                            window.adminChatRoomsClient.chatRoomsPage = 1;
                            window.adminChatRoomsClient.loadChatRooms();
                        }
                        break;
                    case 'settings':
                        if (this.isSuperAdmin && window.adminSettings) {
                            // 懒加载设置模块
                            if (!window.adminSettings.isInitialized) {
                                window.adminSettings.init();
                            }
                        }
                        break;
                    case 'login-logs':
                        if (this.isSuperAdmin) this.loadLoginLogs();
                        break;
                    case 'operation-logs':
                        this.loadOperationLogs();
                        break;
                    case 'oa-attendance':
                    case 'oa-approval':
                    case 'oa-subsidy':
                        // iframe 自动加载，无需额外操作
                        break;

                }
            });
        })

        // 🔧 重置密码模态框关闭
        const resetPasswordModal = document.getElementById('resetPasswordModal');
        if (resetPasswordModal) {
            resetPasswordModal.querySelector('.close-btn')?.addEventListener('click', () => {
                this.closeModal('resetPasswordModal');
            });
            resetPasswordModal.addEventListener('click', (e) => {
                if (e.target === resetPasswordModal) {
                    this.closeModal('resetPasswordModal');
                }
            });
        }


        // 搜索框 — already bound via oninput in template, use debounce to avoid double
        /* Already handled by oninput in template */

        // 部门过滤下拉变化 → 重新加载用户列表
        var filterDept = document.getElementById('filterDepartment');
        if (filterDept) {
            filterDept.addEventListener('change', function() {
                adminConsole.loadUsers(1);
            });
        }

        // 模态框关闭
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    this.closeModal(modal.id);
                }
            });
        });

        // 点击遮罩关闭模态框
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(modal.id);
                }
            });
        });
    }


    // ==================== 模态框操作 ====================
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            // 禁止滚动
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            // 恢复滚动
            document.body.style.overflow = '';
        }
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
    showConfirmDialog(title, message, type = 'confirm') {
        return new Promise((resolve) => {
            // 创建对话框
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <div class="confirm-dialog-header">
                        <i class="fas fa-${type === 'danger' ? 'exclamation-triangle' : type === 'confirm' ? 'check-circle' : 'question-circle'}"></i>
                        <h3>${title}</h3>
                        <button class="close-btn" style="margin-left: auto;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="confirm-dialog-body">
                        <p>${message}</p>
                    </div>
                    <div class="confirm-dialog-footer">
                        <button class="confirm-dialog-btn cancel">取消</button>
                        <button class="confirm-dialog-btn ${type}">确定</button>
                    </div>
                </div>
            `;

            document.body.appendChild(dialog);

            // 获取按钮
            const cancelBtn = dialog.querySelector('.cancel');
            const confirmBtn = dialog.querySelector(`.${type}`);
            const closeBtn = dialog.querySelector('.close-btn');

            // 关闭对话框
            const closeDialog = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) {
                        document.body.removeChild(dialog);
                    }
                }, 300);
                resolve(result);
            };

            // 事件监听
            cancelBtn.addEventListener('click', () => closeDialog(false));
            closeBtn.addEventListener('click', () => closeDialog(false));
            confirmBtn.addEventListener('click', () => closeDialog(true));
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    closeDialog(false);
                }
            });

            // 显示对话框
            setTimeout(() => {
                dialog.classList.add('show');
            }, 10);
        });
    }

    // ==================== 错误处理 ====================
    async parseErrorResponse(response) {
        try {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                return {
                    message: data.message || data.detail || data.error || '请求失败',
                    code: data.code || response.status
                };
            }
            return {
                message: `服务器错误: ${response.status}`,
                code: response.status
            };
        } catch (error) {
            console.error('解析错误响应失败:', error);
            return {
                message: '网络请求失败',
                code: response.status
            };
        }
    }

    // ==================== 提示框 ====================
    showError(title, message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-toast';
        errorDiv.innerHTML = `
            <div class="error-toast-content">
                <i class="fas fa-exclamation-circle"></i>
                <div>
                    <div class="error-toast-title">${title}</div>
                    <div class="error-toast-message">${message}</div>
                </div>
            </div>
        `;
        document.body.appendChild(errorDiv);
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 3000);
    }

    showSuccess(title, message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-toast';
        successDiv.innerHTML = `
            <div class="success-toast-content">
                <i class="fas fa-check-circle"></i>
                <div>
                    <div class="success-toast-title">${title}</div>
                    <div class="success-toast-message">${message}</div>
                </div>
            </div>
        `;
        document.body.appendChild(successDiv);
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
    }

    // ==================== 加载指示器 ====================
    showLoading() {
        if (document.querySelector('.loading-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div>';
        document.body.appendChild(overlay);
    }

    hideLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.parentNode.removeChild(overlay);
        }
    }


    // 全局点击关闭下拉菜单
    _setupGlobalClickHandler() {
        document.addEventListener('click', () => {
            document.querySelectorAll('.user-dropdown-menu').forEach(d => {
                d.style.display = 'none';
            });
        });
    }

    // ==================== 聊天室管理初始化 ====================
    initChatRoomManagement() {
        // 仅超级管理员显示聊天室管理菜单
        if (this.currentUser && this.currentUser.user_type === 'super_admin') {
            const chatRoomsNavItem = document.getElementById('chatRoomsNavItem');
            if (chatRoomsNavItem) {
                chatRoomsNavItem.style.display = 'flex';
            }
        }

        // 绑定聊天室管理事件
        this.setupChatRoomManagementListeners();
    }

    // 设置聊天室管理事件监听
    setupChatRoomManagementListeners() {
        // 刷新按钮
        const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
        if (refreshRoomsBtn) {
            refreshRoomsBtn.addEventListener('click', () => {
                if (window.adminChatRoomsClient) {
                    console.log('刷新聊天室列表...')
                    window.adminChatRoomsClient.chatRoomsPage = 1;
                    window.adminChatRoomsClient.loadChatRooms();
                }
            });
        }

        // 返回按钮
        const backToRoomsBtn = document.getElementById('backToRoomsBtn');
        if (backToRoomsBtn) {
            backToRoomsBtn.addEventListener('click', () => {
                if (window.adminChatRoomsClient) {
                    window.adminChatRoomsClient.backToRooms();
                }
            });
        }

        // 搜索聊天室
        const roomSearchInput = document.getElementById('roomSearchInput');
        if (roomSearchInput) {
            roomSearchInput.addEventListener('input', (e) => {
                if (window.adminChatRoomsClient) {
                    window.adminChatRoomsClient.searchRooms(e.target.value);
                }
            });
        }

        // 搜索消息
        const messageSearchInput = document.getElementById('messageSearchInput');
        if (messageSearchInput) {
            messageSearchInput.addEventListener('input', (e) => {
                if (window.adminChatRoomsClient) {
                    window.adminChatRoomsClient.searchMessages(e.target.value);
                }
            });
        }

        // 加载更多消息
        const loadMoreMessagesBtn = document.getElementById('loadMoreMessagesBtn');
        if (loadMoreMessagesBtn) {
            loadMoreMessagesBtn.addEventListener('click', () => {
                if (window.adminChatRoomsClient) {
                    window.adminChatRoomsClient.loadMoreHistory();
                }
            });
        }

        // 导出历史
        const exportHistoryBtn = document.getElementById('exportHistoryBtn');
        if (exportHistoryBtn) {
            exportHistoryBtn.addEventListener('click', () => {
                if (window.adminChatRoomsClient) {
                    window.adminChatRoomsClient.exportRoomHistory();
                }
            });
        }
    }


    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
    }

    // ==================== 主题切换 ====================

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this.updateThemeIcon(savedTheme);
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        this.updateThemeIcon(newTheme);
    }

    updateThemeIcon(theme) {
        const icon = document.querySelector('#themeToggleBtn i');
        if (icon) {
            icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }
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

    // 🔧 用户下拉菜单切换
    toggleUserDropdown(event) {
        event.stopPropagation();
        const dropdown = document.getElementById('userDropdownMenu');
        if (!dropdown) return;
        // 关闭其他下拉
        document.querySelectorAll('.user-dropdown-menu').forEach(d => {
            if (d !== dropdown) d.style.display = 'none';
        });
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    }


    // ==================== 企业加载 ====================

    async _loadTenantsSelect(selectEl) {
        try {
            var resp = await fetch('/api/org/tenants/', { headers: TokenManager.getHeaders() });
            if (resp.ok) {
                var data = await resp.json();
                var tenants = data.results || data || [];
                selectEl._tenantData = tenants;
                tenants.forEach(function(t) {
                    var opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.short_name || t.name;
                    selectEl.appendChild(opt);
                });
            }
        } catch (e) { console.error('加载企业列表失败:', e); }
    }

    onTenantChange(prefix) {
        var tenantId = document.getElementById(prefix + 'Tenant').value;
        var deptSelectId = prefix === 'new' ? 'newDepartment' : 'editDepartment';
        this.loadDepartments(deptSelectId, null, tenantId || null);
    }

    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==================== 日志相关方法 ====================

    async loadLoginLogs(page = 1) {
        const tbody = document.getElementById('loginLogsTableBody');
        const pagination = document.getElementById('loginLogPagination');
        const searchEl = document.getElementById('loginLogSearch');
        if (!tbody) return;
        try {
            const search = searchEl ? encodeURIComponent(searchEl.value.trim()) : '';
            let url = '/api/auth/admin/login-logs/?page=' + page + '&page_size=20';
            if (search) url += '&search=' + search;
            const resp = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!resp.ok) throw new Error('Failed');
            const rawData = await resp.json();
            const data = window.EncryptUtils.decryptPacket(rawData);
            this._renderLoginLogs(data, tbody);
            this._renderLogPagination(data, pagination, 'loadLoginLogs');
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#909399;">Failed: ' + e.message + '</td></tr>';
            pagination.style.display = 'none';
        }
    }

    _renderLoginLogs(data, tbody) {
        const rows = data.results || [];
        if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#909399;">没有登录日志</td></tr>'; return; }
        tbody.innerHTML = rows.map(function(r) {
            const loc = [r.country, r.province, r.city].filter(Boolean).join(' ') || '-';
            return '<tr style="cursor:pointer;">'
                + '<td>' + adminConsole.escapeHtml(r.username) + '<br><small style="color:var(--text-light);font-size:11px;">' + adminConsole.escapeHtml(r.real_name || '-') + '</small></td>'
                + '<td><code>' + (r.ip || '') + '</code></td>'
                + '<td><span class="badge badge-info">' + r.login_type_display + '</span></td>'
                + '<td>' + (adminConsole.escapeHtml(r.browser || '-').substring(0, 30)) + '</td>'
                + '<td>' + adminConsole.escapeHtml(r.os || '-') + '</td>'
                + '<td>' + loc + '</td>'
                + '<td class="log-time-cell">' + adminConsole.formatLogTime(r.created_at) + '</td>'
                + '<td><button class="action-btn" onclick="event.stopPropagation();adminConsole.showLoginLogDetail(' + r.id + ')" title="查看详情"><i class="fas fa-eye"></i></button></td></tr>';
        }).join('');
    }

    async showLoginLogDetail(id) {
        try {
            const resp = await fetch('/api/auth/admin/login-logs/' + id + '/', { headers: TokenManager.getHeaders() });
            if (!resp.ok) throw new Error('Failed');
            const rawData = await resp.json();
            const d = window.EncryptUtils.decryptPacket(rawData);
            const loc = [d.country, d.province, d.city, d.district].filter(Boolean).join(' ') || '-';
            const html = '<div class="log-detail-grid">'
                + '<div class="log-detail-item"><label>User</label><span>' + adminConsole.escapeHtml(d.username) + '</span></div>'
                + '<div class="log-detail-item"><label>Real Name</label><span>' + adminConsole.escapeHtml(d.real_name || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>IP</label><span>' + d.ip + '</span></div>'
                + '<div class="log-detail-item"><label>Type</label><span>' + d.login_type_display + '</span></div>'
                + '<div class="log-detail-item"><label>Browser</label><span>' + adminConsole.escapeHtml(d.browser || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>OS</label><span>' + adminConsole.escapeHtml(d.os || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Location</label><span>' + loc + '</span></div>'
                + '<div class="log-detail-item"><label>ISP</label><span>' + (d.isp || '-') + '</span></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>User Agent</label><span style="font-size:11px;word-break:break-all;">' + adminConsole.escapeHtml(d.agent || '-') + '</span></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Time</label><span>' + adminConsole.formatLogTime(d.created_at) + '</span></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Desc</label><span>' + adminConsole.escapeHtml(d.request_path || '-') + '</span></div></div>';
            adminConsole._showLogDetailModal('登录日志详情', html);
        } catch (e) { adminConsole.showError('Failed', e.message); }
    }

    searchLoginLogs() { clearTimeout(this._loginLogTimer); this._loginLogTimer = setTimeout(() => this.loadLoginLogs(1), 300); }

    async loadOperationLogs(page) {
        if (page === undefined) page = 1;
        const tbody = document.getElementById('operationLogsTableBody');
        const pagination = document.getElementById('operationLogPagination');
        const searchEl = document.getElementById('operationLogSearch');
        if (!tbody) return;
        try {
            const search = searchEl ? encodeURIComponent(searchEl.value.trim()) : '';
            let url = '/api/auth/admin/operation-logs/?page=' + page + '&page_size=20';
            if (search) url += '&search=' + search;
            const resp = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!resp.ok) throw new Error('Failed');
            const rawData = await resp.json();
            const data = window.EncryptUtils.decryptPacket(rawData);
            this._renderOperationLogs(data, tbody);
            this._renderLogPagination(data, pagination, 'loadOperationLogs');
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#909399;">Failed: ' + e.message + '</td></tr>';
            pagination.style.display = 'none';
        }
    }

    _renderOperationLogs(data, tbody) {
        const rows = data.results || [];
        if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#909399;">没有操作日志</td></tr>'; return; }
        tbody.innerHTML = rows.map(function(r) {
            const st = r.status ? '<span class="status-badge active">OK</span>' : '<span class="status-badge inactive">Fail</span>';
            return '<tr style="cursor:pointer;">'
                + '<td>' + adminConsole.escapeHtml(r.creator_name || '-') + '<br><small style="color:var(--text-light);font-size:11px;">' + adminConsole.escapeHtml(r.real_name || '-') + '</small></td>'
                + '<td><span class="badge badge-info">' + adminConsole.escapeHtml(r.request_modular || '-') + '</span></td>'
                + '<td title="' + adminConsole.escapeHtml(r.request_path) + '">' + (adminConsole.escapeHtml(r.request_path || '-').substring(0, 40)) + '</td>'
                + '<td><code>' + (r.request_method || '-') + '</code></td>'
                + '<td><code>' + (r.request_ip || '-') + '</code></td>'
                + '<td>' + st + '</td>'
                + '<td class="log-time-cell">' + adminConsole.formatLogTime(r.created_at) + '</td>'
                + '<td><button class="action-btn" onclick="event.stopPropagation();adminConsole.showOperationLogDetail(' + r.id + ')" title="查看详情"><i class="fas fa-eye"></i></button></td></tr>';
        }).join('');
    }

    async showOperationLogDetail(id) {
        try {
            const resp = await fetch('/api/auth/admin/operation-logs/' + id + '/', { headers: TokenManager.getHeaders() });
            if (!resp.ok) throw new Error('Failed');
            const rawData = await resp.json();
            const d = window.EncryptUtils.decryptPacket(rawData);
            const st = d.status ? '<span class="status-badge active">OK</span>' : '<span class="status-badge inactive">Fail</span>';
            const html = '<div class="log-detail-grid">'
                + '<div class="log-detail-item"><label>User</label><span>' + adminConsole.escapeHtml(d.creator_name || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Real Name</label><span>' + adminConsole.escapeHtml(d.real_name || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Module</label><span>' + adminConsole.escapeHtml(d.request_modular || '-') + '</span></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Path</label><span style="word-break:break-all;font-size:12px;">' + adminConsole.escapeHtml(d.request_path || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Method</label><span><code>' + (d.request_method || '-') + '</code></span></div>'
                + '<div class="log-detail-item"><label>IP</label><span>' + (d.request_ip || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Browser</label><span>' + adminConsole.escapeHtml(d.request_browser || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>OS</label><span>' + adminConsole.escapeHtml(d.request_os || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Code</label><span>' + (d.response_code || '-') + '</span></div>'
                + '<div class="log-detail-item"><label>Status</label><span>' + st + '</span></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Msg</label><span>' + adminConsole.escapeHtml(d.request_msg || '-') + '</span></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Params</label><pre class="log-pre">' + adminConsole.escapeHtml(d.request_body || '-') + '</pre></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Result</label><pre class="log-pre">' + adminConsole.escapeHtml(d.json_result || '-') + '</pre></div>'
                + '<div class="log-detail-item" style="grid-column:1/-1;"><label>Time</label><span>' + adminConsole.formatLogTime(d.created_at) + '</span></div></div>';
            adminConsole._showLogDetailModal('操作日志详情', html);
        } catch (e) { adminConsole.showError('Failed', e.message); }
    }

    searchOperationLogs() { clearTimeout(this._opLogTimer); this._opLogTimer = setTimeout(() => this.loadOperationLogs(1), 300); }

    _renderLogPagination(data, container, loadFn) {
        if (!data.total_pages || data.total_pages <= 1) { container.style.display = 'none'; return; }
        container.style.display = 'flex';
        const p = data.page; const t = data.total_pages;
        let html = '<div class="log-pagination-bar">'
            + '<span class="log-pagination-total">共 ' + data.count + ' 条</span>'
            + '<div class="log-pagination-btns">';
        html += '<button class="pagination-btn" onclick="adminConsole.' + loadFn + '(' + (p - 1) + ')" ' + (p <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        for (let i = Math.max(1, p - 2); i <= Math.min(t, p + 2); i++) {
            html += '<button class="pagination-btn ' + (i === p ? 'active' : '') + '" onclick="adminConsole.' + loadFn + '(' + i + ')">' + i + '</button>';
        }
        html += '<button class="pagination-btn" onclick="adminConsole.' + loadFn + '(' + (p + 1) + ')" ' + (p >= t ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button></div></div>';
        container.innerHTML = html;
    }

    _showLogDetailModal(title, content) {
        const existing = document.getElementById('logDetailModal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.className = 'modal show'; modal.id = 'logDetailModal'; modal.style.display = 'flex';
        modal.innerHTML = '<div class="modal-content" style="max-width:700px;">'
            + '<div class="modal-header"><h3><i class="fas fa-info-circle"></i> ' + title + '</h3><button class="close-btn">&times;</button></div>'
            + '<div class="modal-body">' + content + '</div>'
            + '<div class="modal-footer"><button class="btn btn-secondary" onclick="this.closest(\'.modal\').remove()">Close</button></div></div>';
        document.body.appendChild(modal);
        modal.querySelector('.close-btn').onclick = function() { modal.remove(); };
        modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    }

    formatLogTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    _debounce(fn, delay) {
        var timer = null;
        return function() {
            var args = arguments, ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
        };
    }

}


// 初始化
let adminConsole = null;
document.addEventListener('DOMContentLoaded', () => {
    adminConsole = new AdminConsole();
    window.adminConsole = adminConsole;
});







    



