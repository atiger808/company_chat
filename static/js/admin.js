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
                window.location.href = '/login/';
                return;
            }

            // 检查管理员权限
            this.currentUser = await API.getCurrentUser();
            if (this.currentUser.user_type === 'normal') {
                // 替换原生 alert 为优雅的提示框
                this.showAlert('权限不足', '您没有管理员权限').then(() => {
                    window.location.href = '/chat/';
                });
                return;

                // this.showError('权限不足', '您没有管理员权限');
                // setTimeout(() => {
                //     window.location.href = '/chat/';
                // }, 1500);
                // return;
            }

            // 渲染管理员信息
            this.renderAdminInfo();

            // 加载用户列表
            await this.loadUsers();

            // 设置事件监听
            this.setupEventListeners();

            this.initSidebar();

            this.initTableScroll();

            // 添加跳转到聊天室按钮事件
            const gotoChatBtn = document.getElementById('gotoChatBtn');
            if (gotoChatBtn) {
                gotoChatBtn.addEventListener('click', () => {
                    window.location.href = '/chat/';
                });
            }


        } catch (error) {
            console.error('初始化失败:', error);
            localStorage.removeItem('access_token');
            this.showError('初始化失败', error.message);
            setTimeout(() => {
                window.location.href = '/login/';
            }, 1500);
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


    // 修改 admin.js 中的 initSidebar 方法
    // ==================== 侧边栏伸缩功能 ====================
    initSidebar() {
        const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
        const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        const adminSidebar = document.getElementById('adminSidebar');
        const adminMain = document.querySelector('.admin-main');

        // 侧边栏伸缩按钮 - 统一切换逻辑
        if (sidebarToggleBtn && adminSidebar) {
            sidebarToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSidebar();
            });
        }

        // 侧边栏关闭按钮（移动端）
        if (sidebarCloseBtn && adminSidebar) {
            sidebarCloseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                adminSidebar.classList.remove('open');
            });
        }

        // 点击侧边栏外部关闭（移动端）
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 &&
                adminSidebar.classList.contains('open') &&
                !adminSidebar.contains(e.target) &&
                !sidebarToggleBtn.contains(e.target)) {
                adminSidebar.classList.remove('open');
            }
        });

        // 窗口大小变化时调整侧边栏
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                adminSidebar.classList.remove('open');
            }
        });
    }

    toggleSidebar() {
        const adminSidebar = document.getElementById('adminSidebar');
        const adminMain = document.querySelector('.admin-main');

        if (!adminSidebar || !adminMain) return;

        // 移动端处理（768px以下）
        if (window.innerWidth <= 768) {
            // 切换 open 类
            adminSidebar.classList.toggle('open');
            return;
        }

        // 桌面端处理
        if (this.sidebarCollapsed) {
            // 展开侧边栏
            adminSidebar.classList.remove('collapsed');
            adminMain.classList.remove('full-width');
            this.sidebarCollapsed = false;

            // 更新按钮图标（可选）
            const toggleBtnIcon = document.querySelector('#sidebarToggleBtn i');
            if (toggleBtnIcon) {
                toggleBtnIcon.className = 'fas fa-bars';
            }
        } else {
            // 折叠侧边栏
            adminSidebar.classList.add('collapsed');
            adminMain.classList.add('full-width');
            this.sidebarCollapsed = true;

            // 更新按钮图标（可选）
            const toggleBtnIcon = document.querySelector('#sidebarToggleBtn i');
            if (toggleBtnIcon) {
                toggleBtnIcon.className = 'fas fa-indent';
            }
        }
    }

    renderAdminInfo() {
        document.getElementById('adminUsername').textContent = this.currentUser.username;
        document.getElementById('adminAvatar').src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
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
            }
        }
    }

    async loadUsers() {
        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '加载用户列表失败');
            }

            const data = await response.json();
            this.users = Array.isArray(data) ? data : (data.results || []);
            this.renderUsersTable();

        } catch (error) {
            console.error('加载用户失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    renderUsersTable() {
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        let html = '';
        this.users.forEach(user => {
            // 禁用状态样式
            const rowClass = !user.is_active ? 'user-disabled-row' : '';
            // 禁用/启用开关状态
            const toggleChecked = user.is_active ? 'checked' : '';
            const toggleLabel = user.is_active ? '启用' : '禁用';

            html += `
        <tr class="${rowClass}">
            <td>${user.id}</td>
            <td><img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="头像"></td>
            <td>${user.username}</td>
            <td>${user.real_name || '-'}</td>
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
                <div class="toggle-btn-container" onclick="event.stopPropagation()">
                    <label class="toggle-switch">
                        <input type="checkbox" 
                               onchange="adminConsole.toggleUserStatus(${user.id}, this.checked, '${user.username}')" 
                               ${toggleChecked}>
                        <span class="toggle-slider"></span>
                    </label>
                    <span>${toggleLabel}</span>
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

        tbody.innerHTML = html || '<tr><td colspan="10" style="text-align: center; padding: 40px;">暂无用户</td></tr>';

        // 重新检查滚动状态
        setTimeout(() => {
            this.initTableScroll();
        }, 100);
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
    async toggleUserStatus(userId, newStatus, username) {
        // 阻止默认行为
        event.stopPropagation();

        const action = newStatus ? '启用' : '禁用';

        // 显示确认对话框
        const confirmed = await this.showConfirmDialog(
            `${action}用户`,
            `确定要${action}用户 "<span class="highlight">${username}</span>" 吗？`,
            action === '禁用' ? 'danger' : 'confirm'
        );

        if (!confirmed) {
            // 恢复开关状态
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

            // 重新加载用户列表
            await this.loadUsers();

        } catch (error) {
            console.error(`${action}用户失败:`, error);
            this.showError(`${action}失败`, error.message);
            // 恢复开关状态
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

        // 加载所有用户用于好友分配
        await this.loadAllUsersForFriends();
        console.log('allUsersForFriends:', this.allUsersForFriends)

        // 渲染好友选择界面（初始无好友）
        this.renderFriendSelection_create('friendGridCreate', [], 'friendSearchCreate');

        this.openModal('createUserModal');
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
                user_type: userType
            };

            // 处理部门：先查询，如果不存在再创建
            if (departmentName) {
                let departmentId = await this.getOrCreateDepartment(departmentName);
                if (departmentId) {
                    requestData.department = departmentId;
                }
            }

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

            // 保存好友关系
            const selectedFriends = Array.from(document.querySelectorAll('#friendGridCreate .member-grid-item.selected'))
                .map(item => parseInt(item.dataset.userId));

            await this.assignFriends(newUser.id, selectedFriends)

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
                user_type: userType
            };
            if (password) requestData.password = password;

            // 处理部门：先查询，如果不存在再创建
            if (departmentName) {
                let departmentId = await this.getOrCreateDepartment(departmentName);
                if (departmentId) {
                    requestData.department = departmentId;
                }
            } else {
                requestData.department = null;
            }

            // 如果密码不为空，添加到请求中
            if (password) {
                requestData.password = password;
            }

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
            console.log('data:', data)
            this.allUsersForFriends = Array.isArray(data) ? data : (data.results || []);
            console.log('this.allUsersForFriends:', this.allUsersForFriends)
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
        if (document.getElementById('editUserId')) {
            // 编辑用户时排除当前用户
            const currentUserId = parseInt(document.getElementById('editUserId').value || '0');
            allUsers = allUsers.filter(u => u.id !== currentUserId);
        }

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

            // 填充表单
            document.getElementById('editUserId').value = user.id;
            document.getElementById('editUsername').value = user.username;
            document.getElementById('editRealName').value = user.real_name || '';
            document.getElementById('editGender').value = user.gender || '';
            document.getElementById('editEmail').value = user.email || '';
            document.getElementById('editPhone').value = user.phone || '';
            document.getElementById('editDepartment').value = user.department_info?.name || user.department || '';
            document.getElementById('editPosition').value = user.position || '';
            document.getElementById('editUserType').value = user.user_type;

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


    // ==================== 删除用户 ====================
    async confirmDeleteUser(userId, username) {
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

    // ==================== 重置密码 ====================
    async resetPassword(userId, username) {
        const newPassword = prompt(`请输入 "${username}" 的新密码：`);

        if (!newPassword || newPassword.length < 6) {
            this.showError('验证失败', '密码不能为空且至少6位');
            return;
        }

        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/${userId}/reset-password/`, {
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
    searchUsers_v1(keyword) {
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
                <td>${user.id}</td>
                <td><img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="头像"></td>
                <td>${user.username}</td>
                <td>${user.real_name || '-'}</td>
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

        tbody.innerHTML = html || '<tr><td colspan="10" style="text-align: center; padding: 40px;">未找到相关用户</td></tr>';
    }

    // 修改 admin.js 中的 searchUsers 方法
    searchUsers(keyword) {
        // 如果关键词为空，重新加载所有用户
        if (!keyword.trim()) {
            this.loadUsers();
            return;
        }

        // 调用后端搜索接口
        this.searchUsersFromBackend(keyword);
    }

    // 新增：从后端搜索用户
    async searchUsersFromBackend(keyword) {
        try {
            this.showLoading();

            const response = await fetch(`${API_ADMIN_URL}/admin/users/?search=${encodeURIComponent(keyword)}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await this.parseErrorResponse(response);
                throw new Error(errorData.message || '搜索用户失败');
            }

            const data = await response.json();
            this.users = Array.isArray(data) ? data : (data.results || []);
            this.renderUsersTable();

        } catch (error) {
            console.error('搜索用户失败:', error);
            this.showError('搜索失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // ==================== 事件监听 ====================
    setupEventListeners() {
        // 标签切换
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                const tabName = item.dataset.tab;
                document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
                document.getElementById(tabName + 'Tab').classList.add('active');

                document.getElementById('pageTitle').textContent = item.textContent.trim();
            });
        });

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

        // 监听搜索框输入

        const userSearch = document.getElementById('userSearch');
        if (userSearch) {
            userSearch.addEventListener('input', (e) => {
                this.searchUsers_v1(e.target.value);
            });
        }

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
}

// 初始化
let adminConsole = null;
document.addEventListener('DOMContentLoaded', () => {
    adminConsole = new AdminConsole();
    window.adminConsole = adminConsole;
});

// 退出登录
function logout() {
    adminConsole.showConfirmDialog('退出登录', '确定要退出登录吗？', 'confirm').then((confirmed) => {
        if (confirmed) {
            try {
                API.logout();
                console.log('登出成功');
            } catch (error) {
                console.error('登出失败:', error);
                localStorage.removeItem('access_token');
            }
            window.location.href = '/login/';
        }
    });
}