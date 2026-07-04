// static/js/tasks.js

class TaskApp {
    constructor() {
        this.tasks = [];
        this.users = [];
        this.currentUser = null;
        this.currentFilter = 'my';
        this.currentView = 'list';
        this.selectedTaskId = null;
        this.searchKeyword = '';
        this.sortableInstances = [];
        this.chat_login_url = '/login/';

        this.init();
    }

    async init() {
        if (!localStorage.getItem('access_token')) {
            window.location.href = this.chat_login_url;
            return;
        }
        await this.loadCurrentUser();
        await this.loadUsers();
        await this.loadStats();
        await this.loadTasks();
        this.initTheme();
        this.initSortable();

        // 全局点击关闭下拉菜单
        document.addEventListener('click', () => {
            document.querySelectorAll('.user-dropdown').forEach(d => d.style.display = 'none');
        });
    }

    // ==================== 数据加载 ====================

    async loadCurrentUser() {
        try {
            const res = await fetch('/api/auth/me/', { headers: TokenManager.getHeaders() });
            if (res.status === 401) {
                this.handleAuthError();
                return;
            }
            if (res.ok) {
                this.currentUser = await res.json();
                const userEl = document.getElementById('currentUser');
                userEl.querySelector('.user-avatar').src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
                userEl.querySelector('.user-name').textContent = this.currentUser.real_name || this.currentUser.username;
            }
        } catch (e) { console.error('加载用户失败', e); }
    }

    async loadUsers() {
        try {
            const res = await fetch('/api/auth/users/?page_size=100', { headers: TokenManager.getHeaders() });
            if (res.status === 401) {
                this.handleAuthError();
                return;
            }
            const data = await res.json();
            this.users = data.results || data || [];
            this.renderAssigneeOptions();
        } catch (e) { console.error('加载用户列表失败', e); }
    }

    async loadStats() {
        try {
            const res = await fetch('/api/tasks/stats/', { headers: TokenManager.getHeaders() });
            if (res.status === 401) {
                this.handleAuthError();
                return;
            }
            if (res.ok) {
                const stats = await res.json();
                document.getElementById('badge-my').textContent = stats.my || 0;
                document.getElementById('badge-created').textContent = stats.created || 0;
                document.getElementById('badge-today').textContent = stats.today || 0;
                document.getElementById('badge-done').textContent = stats.done || 0;
            }
        } catch (e) { console.error('加载统计失败', e); }
    }

    async loadTasks() {
        try {
            const params = new URLSearchParams();
            if (this.currentFilter === 'my') params.append('assignee_id', this.currentUser.id);
            if (this.currentFilter === 'created') params.append('creator', this.currentUser.id);
            if (this.currentFilter === 'today') params.append('due_date__date', new Date().toISOString().split('T')[0]);
            if (this.currentFilter === 'done') params.append('status', 'done');
            if (this.searchKeyword) params.append('search', this.searchKeyword);

            const res = await fetch(`/api/tasks/?${params.toString()}`, { headers: TokenManager.getHeaders() });

            if (res.status === 401) {
                this.handleAuthError();
                return;
            }
            const data = await res.json();
            this.tasks = data.results || data || [];
            
            this.render();
            this.updateKanbanCounts();
            
            // 如果当前选中的任务还在列表中，刷新详情
            if (this.selectedTaskId) {
                const task = this.tasks.find(t => t.id == this.selectedTaskId);
                if (task) this.selectTask(task.id);
                else this.closeDetail();
            }
        } catch (e) { console.error('加载任务失败', e); }
    }
    
    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
    }

    // ==================== 视图渲染 ====================

    render() {
        if (this.currentView === 'list') {
            document.getElementById('listView').style.display = 'flex';
            document.getElementById('kanbanView').style.display = 'none';
            this.renderListView();
        } else {
            document.getElementById('listView').style.display = 'none';
            document.getElementById('kanbanView').style.display = 'flex';
            this.renderKanbanView();
        }
    }

    renderListView() {
        const container = document.getElementById('listView');
        if (this.tasks.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>暂无任务</p></div>';
            return;
        }

        container.innerHTML = this.tasks.map(task => `
            <div class="task-card ${this.selectedTaskId == task.id ? 'selected' : ''}" onclick="taskApp.selectTask(${task.id})">
                <div class="card-header">
                    <span class="priority-tag priority-${task.priority}">${this.getPriorityText(task.priority)}</span>
                    <span class="status-tag status-${task.status}">${this.getStatusText(task.status)}</span>
                </div>
                <div class="card-title">${task.title}</div>
                <div class="card-footer">
                    <span><i class="fas fa-user-circle"></i> ${task.assignee_info?.real_name || '未指派'}</span>
                    <span>${task.due_date ? `<i class="fas fa-clock"></i> ${this.formatDate(task.due_date)}` : ''}</span>
                </div>
            </div>
        `).join('');
    }

    renderKanbanView() {
        ['todo', 'in_progress', 'done'].forEach(status => {
            const container = document.getElementById(`kanban-${status}`);
            const tasksInCol = this.tasks.filter(t => t.status === status);
            
            container.innerHTML = tasksInCol.map(task => `
                <div class="kanban-card ${this.selectedTaskId == task.id ? 'selected' : ''}" 
                     data-task-id="${task.id}" onclick="taskApp.selectTask(${task.id})">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span class="priority-tag priority-${task.priority}">${this.getPriorityText(task.priority)}</span>
                    </div>
                    <div style="font-weight: 600; margin-bottom: 8px;">${task.title}</div>
                    <div style="font-size: 12px; color: var(--text-light);">
                        <i class="fas fa-user"></i> ${task.assignee_info?.real_name || '未指派'}
                    </div>
                </div>
            `).join('');
        });
    }

    updateKanbanCounts() {
        ['todo', 'in_progress', 'done'].forEach(status => {
            const count = this.tasks.filter(t => t.status === status).length;
            document.getElementById(`kanban-count-${status}`).textContent = count;
        });
    }

    // ==================== 详情面板 ====================

    async selectTask(taskId) {
        this.selectedTaskId = taskId;
        this.render(); // 更新选中样式

        const panel = document.getElementById('taskDetailPanel');
        panel.classList.add('show');

        try {
            const res = await fetch(`/api/tasks/${taskId}/`, { headers: TokenManager.getHeaders() });
            if (res.ok) {
                const task = await res.json();
                this.renderTaskDetail(task);
            }
        } catch (e) { console.error('加载详情失败', e); }
    }

    renderTaskDetail(task) {
        const body = document.getElementById('taskDetailBody');
        body.innerHTML = `
            <!-- 基本信息 -->
            <div class="detail-section">
                <h4><i class="fas fa-info-circle"></i> 基本信息</h4>
                <div style="margin-bottom: 12px;">
                    <input type="text" value="${task.title}" class="form-control" style="font-weight: 600; font-size: 16px;" 
                           onchange="taskApp.updateTaskField(${task.id}, 'title', this.value)">
                </div>
                <div class="info-grid">
                    <div class="info-item">
                        <label>状态</label>
                        <select class="form-control" onchange="taskApp.updateTaskField(${task.id}, 'status', this.value)">
                            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>待处理</option>
                            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>进行中</option>
                            <option value="done" ${task.status === 'done' ? 'selected' : ''}>已完成</option>
                        </select>
                    </div>
                    <div class="info-item">
                        <label>优先级</label>
                        <select class="form-control" onchange="taskApp.updateTaskField(${task.id}, 'priority', this.value)">
                            <option value="low" ${task.priority === 'low' ? 'selected' : ''}>低</option>
                            <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>中</option>
                            <option value="high" ${task.priority === 'high' ? 'selected' : ''}>高</option>
                            <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>紧急</option>
                        </select>
                    </div>
                    <div class="info-item">
                        <label>创建者</label>
                        <span>${task.creator_info?.real_name || task.creator_info?.username}</span>
                    </div>
                    <div class="info-item">
                        <label>执行人</label>
                        <span>${task.assignee_info?.real_name || '未指派'}</span>
                    </div>
                    <div class="info-item">
                        <label>截止日期</label>
                        <span>${task.due_date ? this.formatDate(task.due_date) : '无'}</span>
                    </div>
                </div>
            </div>

            <!-- 任务描述 -->
            <div class="detail-section">
                <h4><i class="fas fa-align-left"></i> 任务描述</h4>
                <textarea class="form-control" rows="3" placeholder="添加描述..." 
                          onchange="taskApp.updateTaskField(${task.id}, 'description', this.value)">${task.description || ''}</textarea>
            </div>

            <!-- 来源信息 -->
            <div class="detail-section">
                <h4><i class="fas fa-link"></i> 任务来源</h4>
                ${this.renderSourceInfo(task)}
            </div>

            <!-- 评论区 -->
            <div class="detail-section">
                <h4><i class="fas fa-comments"></i> 评论 (${task.comments?.length || 0})</h4>
                <div class="comment-list" id="commentList">
                    ${this.renderComments(task.comments || [])}
                </div>
                <div class="comment-input-wrapper">
                    <textarea id="commentInput" placeholder="添加评论..."></textarea>
                    <button class="btn btn-primary" style="align-self: flex-end;" onclick="taskApp.addComment(${task.id})">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        `;
    }

    renderSourceInfo(task) {
        if (!task.source_chat_room_name) {
            return '<div style="color: var(--text-light); font-size: 14px;">无来源信息（手动创建的任务）</div>';
        }

        let contentHtml = '';
        const type = task.source_message_type;
        const content = task.source_message_content;
        const fileInfo = task.source_file_info;

        if (type === 'text') {
            contentHtml = `<div style="color: var(--text-primary);">${content}</div>`;
        } else if (type === 'image' && fileInfo?.url) {
            contentHtml = `<img src="${fileInfo.url}" class="source-image" onclick="window.open('${fileInfo.url}', '_blank')" />`;
        } else if (type === 'video' && fileInfo?.url) {
            contentHtml = `<video src="${fileInfo.url}" controls class="source-image" style="width:100%"></video>`;
        } else if (type === 'file' && fileInfo) {
            contentHtml = `<div style="display:flex; align-items:center; gap:8px;"><i class="fas fa-file"></i> ${fileInfo.name}</div>`;
        } else {
            contentHtml = `<div style="color: var(--text-light);">[未知类型消息]</div>`;
        }

        let actionHtml = '';
        if (task.source_message_id) {
            actionHtml += `<a href="/chat/?msg=${task.source_message_id}" target="_blank" class="btn-sm btn-outline"><i class="fas fa-external-link-alt"></i> 查看原消息</a>`;
        }
        // 如果是文档类型
        if (fileInfo?.is_document && fileInfo?.id) {
            if (fileInfo.cloud_file_id) {
                // 已保存到云盘 → 提供在线编辑入口
                actionHtml += `<a href="/cloud/editor/?id=${fileInfo.cloud_file_id}" target="_blank" class="btn-sm btn-primary" style="background:var(--primary-color); color:white;"><i class="fas fa-edit"></i> 在线编辑文档</a>`;
            } else {
                // 未保存到云盘 → 提供保存按钮
                const fileUploadId = fileInfo.id;
                actionHtml += `<button class="btn-sm btn-outline" onclick="taskApp.saveSourceToCloud(${task.id}, ${fileUploadId}, this)" style="cursor:pointer;border:1px solid var(--border-color);background:var(--bg-primary);"><i class="fas fa-cloud-upload-alt"></i> 保存到云盘</button>`;
            }
        }

        return `
            <div class="source-card">
                <div class="source-header">
                    <i class="fas fa-comments"></i> 来自: ${task.source_chat_room_name}
                </div>
                <div class="source-body">
                    ${contentHtml}
                </div>
                <div class="source-actions">
                    ${actionHtml}
                </div>
            </div>
        `;
    }

    renderComments(comments) {
        if (comments.length === 0) {
            return '<div style="text-align: center; color: var(--text-light); padding: 16px;">暂无评论</div>';
        }
        return comments.map(c => `
            <div class="comment-item">
                <img src="${c.user_info?.avatar_url || '/static/images/default-avatar.png'}" class="comment-avatar">
                <div class="comment-body">
                    <div class="comment-header">
                        <span class="comment-author">${c.user_info?.real_name || c.user_info?.username}</span>
                        <span class="comment-time">${this.formatDate(c.created_at)}</span>
                    </div>
                    <div class="comment-content">${c.content}</div>
                </div>
            </div>
        `).join('');
    }

    closeDetail() {
        this.selectedTaskId = null;
        document.getElementById('taskDetailPanel').classList.remove('show');
        this.render(); // 移除选中样式
    }

    // ==================== 交互操作 ====================

    async updateTaskField(taskId, field, value) {
        try {
            await fetch(`/api/tasks/${taskId}/`, {
                method: 'PATCH',
                headers: { ...TokenManager.getHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ [field]: value })
            });
            this.loadTasks(); // 刷新列表
            if (field === 'status') this.loadStats(); // 刷新徽章
        } catch (e) { console.error('更新失败', e); }
    }

    async addComment(taskId) {
        const input = document.getElementById('commentInput');
        const content = input.value.trim();
        if (!content) return;

        try {
            const res = await fetch(`/api/tasks/${taskId}/add_comment/`, {
                method: 'POST',
                headers: { ...TokenManager.getHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            if (res.ok) {
                input.value = '';
                this.selectTask(taskId); // 刷新详情
            }
        } catch (e) { console.error('评论失败', e); }
    }

    async updateTaskStatus(taskId, newStatus) {
        try {
            await fetch(`/api/tasks/${taskId}/change_status/`, {
                method: 'POST',
                headers: { ...TokenManager.getHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            this.loadTasks();
            this.loadStats();
        } catch (e) { console.error('更新状态失败', e); }
    }

    // ==================== 视图切换与搜索 ====================

    switchFilter(filter) {
        this.currentFilter = filter;
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.filter === filter);
        });
        const titles = { my: '我的任务', created: '我创建的', today: '今日到期', done: '已完成' };
        document.getElementById('currentViewTitle').textContent = titles[filter];
        this.loadTasks();
    }

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.view-switcher .btn-icon').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        this.render();
        if (view === 'kanban') this.initSortable();
    }

    searchTasks(keyword) {
        this.searchKeyword = keyword;
        this.loadTasks();
    }

    // ==================== 看板拖拽 ====================

    initSortable() {
        // 销毁旧实例
        this.sortableInstances.forEach(instance => instance.destroy());
        this.sortableInstances = [];

        const columns = document.querySelectorAll('.column-body');
        columns.forEach(col => {
            const instance = new Sortable(col, {
                group: 'tasks',
                animation: 150,
                ghostClass: 'sortable-ghost',
                onEnd: async (evt) => {
                    const taskId = evt.item.dataset.taskId;
                    const newStatus = evt.to.closest('.kanban-column').dataset.status;
                    await this.updateTaskStatus(taskId, newStatus);
                }
            });
            this.sortableInstances.push(instance);
        });
    }

    // ==================== 用户下拉菜单 ====================

    toggleUserDropdown(event) {
        event.stopPropagation();
        const dropdown = document.getElementById('userDropdown');
        const isVisible = dropdown.style.display === 'block';
        // 关闭所有下拉
        document.querySelectorAll('.user-dropdown').forEach(d => d.style.display = 'none');
        dropdown.style.display = isVisible ? 'none' : 'block';
    }

    async logout() {
        const confirmed = await this.showConfirm('退出登录', '确定要退出当前账号吗？');
        if (!confirmed) return;

        try {
            const refreshToken = localStorage.getItem('refresh_token');
            await fetch('/api/auth/logout/', {
                method: 'POST',
                headers: { ...TokenManager.getHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh: refreshToken })
            });
        } catch (e) {
            console.warn('登出请求失败:', e);
        }

        // 清除本地认证信息
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        window.location.href = this.chat_login_url;
    }

    showConfirm(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'modal';
            dialog.style.display = 'flex';
            dialog.innerHTML = `
                <div class="modal-content" style="max-width:400px;">
                    <div class="modal-header"><h3>${title}</h3><button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button></div>
                    <div class="modal-body"><p>${message}</p></div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal').remove();resolve(false)">取消</button>
                        <button class="btn btn-primary" onclick="this.closest('.modal').remove();resolve(true)">确定</button>
                    </div>
                </div>`;
            document.body.appendChild(dialog);
            const btns = dialog.querySelectorAll('.modal-footer .btn');
            btns[0].onclick = () => { dialog.remove(); resolve(false); };
            btns[1].onclick = () => { dialog.remove(); resolve(true); };
            dialog.querySelector('.close-btn').onclick = () => { dialog.remove(); resolve(false); };
        });
    }

    // ==================== 侧边栏切换 ====================

    toggleSidebar() {
        const sidebar = document.getElementById('taskSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar.classList.toggle('show');
        overlay.classList.toggle('show');
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

    // ==================== 保存来源文件到云盘 ====================

    async saveSourceToCloud(taskId, fileUploadId, btn) {
        if (!fileUploadId) {
            this.showToast('文件信息缺失', 'error');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';
        }

        try {
            const response = await fetch('/api/cloud/files/save_from_chat/', {
                method: 'POST',
                headers: { ...TokenManager.getHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_upload_id: fileUploadId })
            });
            const data = await response.json();

            if (response.ok) {
                this.showToast(data.message || '保存成功', 'success');
                this.selectTask(taskId);
            } else {
                this.showToast(data.error || data.message || data.detail || '保存失败', 'error');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> 保存到云盘';
                }
            }
        } catch (error) {
            console.error('保存到云盘失败:', error);
            this.showToast('保存失败: ' + (error.message || '网络错误'), 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> 保存到云盘';
            }
        }
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${type === 'error' ? '错误' : type === 'success' ? '成功' : '提示'}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ==================== 模态框与辅助方法 ====================

    openCreateModal() {
        document.getElementById('taskModal').classList.add('show');
        document.getElementById('taskModalTitle').textContent = '新建任务';
        document.getElementById('taskId').value = '';
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDesc').value = '';
    }

    closeModal() {
        document.getElementById('taskModal').classList.remove('show');
    }

    async saveTask() {
        const id = document.getElementById('taskId').value;
        const data = {
            title: document.getElementById('taskTitle').value,
            description: document.getElementById('taskDesc').value,
            priority: document.getElementById('taskPriority').value,
            status: document.getElementById('taskStatus').value,
            assignee_id: document.getElementById('taskAssignee').value || null,
            due_date: document.getElementById('taskDueDate').value || null
        };

        if (!data.title) return alert('请输入任务标题');

        try {
            const url = id ? `/api/tasks/${id}/` : '/api/tasks/';
            const method = id ? 'PUT' : 'POST';
            await fetch(url, {
                method,
                headers: { ...TokenManager.getHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            this.closeModal();
            this.loadTasks();
            this.loadStats();
        } catch (e) { console.error('保存失败', e); }
    }

    renderAssigneeOptions() {
        const select = document.getElementById('taskAssignee');
        select.innerHTML = '<option value="">未指派</option>' + 
            this.users.map(u => `<option value="${u.id}">${u.real_name || u.username}</option>`).join('');
    }

    getPriorityText(p) { return { low: '低', medium: '中', high: '高', urgent: '紧急' }[p]; }
    getStatusText(s) { return { todo: '待处理', in_progress: '进行中', done: '已完成' }[s]; }
    formatDate(date) { return new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
}

const taskApp = new TaskApp();
window.taskApp = taskApp;