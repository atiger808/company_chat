// static/js/tasks.js

class TaskApp {
    constructor() {
        this.tasks = [];
        this.assigneeResults = [];
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
        // 各初始化步骤独立容错：任一失败不阻断后续（含任务详情自动打开）
        try { await this.loadCurrentUser(); } catch (e) { console.error('加载当前用户失败', e); }
        try { await this.loadStats(); } catch (e) { console.error('加载统计失败', e); }
        try { await this.loadTasks(); } catch (e) { console.error('加载任务失败', e); }
        try { this.initAssigneePicker(); } catch (e) { console.error('初始化执行人选择器失败', e); }

        // 从工作通知/聊天室任务卡片跳转：自动打开对应任务详情
        try {
            const qp = new URLSearchParams(window.location.search);
            const taskId = qp.get('task_id');
            if (taskId) {
                setTimeout(() => { taskApp.selectTask(parseInt(taskId, 10)); }, 200);
            }
        } catch (e) { console.warn('解析任务跳转参数失败', e); }

        try { this.initTheme(); } catch (e) { console.warn('初始化主题失败', e); }
        try { this.initSortable(); } catch (e) { console.warn('初始化看板拖拽失败', e); }

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
            } else {
                const data = await res.json().catch(() => ({}));
                const msg = (data && (data.detail || data.error)) || (res.status === 404 ? '该任务不存在或者已经删除' : '加载详情失败');
                this.showToast(msg, 'error');
                this.closeDetail();
            }
        } catch (e) {
            console.error('加载详情失败', e);
            this.showToast('加载详情失败', 'error');
        }
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

    showError(title, message) {
        this.showToast(`${title}: ${message}`, 'error');
    }

    /**
     * 🔧 新增：警告提示
     */
    showWarning(title, message) {
        const toast = document.createElement('div');
        toast.className = 'toast toast-warning';
        toast.innerHTML = `<strong>${title}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 5000);  // 警告显示时间更长
    }

    showSuccess(title, message) {
        this.showToast(`${title}: ${message}`, 'success');
    }

    showInfo(title, message) {
        this.showToast(`${title}: ${message}`, 'info');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${type === 'error' ? '错误' : type === 'success' ? '成功' : '提示'}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ===== 工具 =====
    _escape(text) {
        return Utils.escapeHtml ? Utils.escapeHtml(text) : String(text || '').replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
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
        this.resetAssigneePicker();
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
            assignee_id: document.getElementById('taskAssigneeId').value || null,
            due_date: document.getElementById('taskDueDate').value || null
        };

        if (!data.title) {
            console.log('请输入任务标题');
            this.showAlert('提示', '请输入任务标题');
            return;
        }

        if (!data.assignee_id) {
            console.log('请选择执行人');
            this.showAlert('提示', '请选择执行人');
            return;
        }

        if (!data.due_date) {
            console.log('请选择截止日期');
            this.showAlert('提示', '请选择截止日期');
            return;
        }

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

    // ==================== 执行人搜索选择器 ====================

    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    initAssigneePicker() {
        const input = document.getElementById('taskAssigneeSearchInput');
        const dropdown = document.getElementById('taskAssigneeDropdown');
        if (!input || !dropdown) return;
        let debounceTimer = null;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.searchAssignees(), 250);
        });
        input.addEventListener('focus', () => { if (input.value.trim()) this.searchAssignees(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.searchAssignees(); }
        });
        // 点击选择器外部关闭下拉
        document.addEventListener('click', (e) => {
            const picker = document.querySelector('.assignee-picker');
            if (picker && !picker.contains(e.target)) dropdown.style.display = 'none';
        });
        // 模态框内滚动/窗口缩放时关闭下拉，避免位置错乱
        const modal = document.getElementById('taskModal');
        if (modal) modal.addEventListener('scroll', () => { dropdown.style.display = 'none'; }, true);
        window.addEventListener('resize', () => { dropdown.style.display = 'none'; });
    }

    async searchAssignees() {
        const input = document.getElementById('taskAssigneeSearchInput');
        const dropdown = document.getElementById('taskAssigneeDropdown');
        if (!input || !dropdown) return;
        const q = input.value.trim();
        try {
            const res = await fetch(`/api/auth/search_assignees/?q=${encodeURIComponent(q)}`, { headers: TokenManager.getHeaders() });
            if (res.status === 401) { this.handleAuthError(); return; }
            if (!res.ok) return;
            const data = await res.json();
            this.renderAssigneeDropdown(data.results || []);
        } catch (e) { console.error('搜索执行人失败', e); }
    }

    renderAssigneeDropdown(results) {
        const dropdown = document.getElementById('taskAssigneeDropdown');
        if (!dropdown) return;
        this.assigneeResults = results;
        if (!results.length) {
            dropdown.innerHTML = '<div class="assignee-empty">未找到匹配的用户</div>';
            this._positionAssigneeDropdown();
            return;
        }
        dropdown.innerHTML = results.map((u, i) => {
            const name = this.escapeHtml(u.real_name || u.username);
            const dept = u.department_info ? this.escapeHtml(u.department_info.name || '') : '';
            const pos = this.escapeHtml(u.position || '');
            const meta = [dept, pos].filter(Boolean).join(' · ');
            const avatar = u.avatar_url || '/static/images/default-avatar.png';
            return `<div class="assignee-option" onclick="taskApp.selectAssigneeByIndex(${i})">
                <img class="assignee-avatar" src="${this.escapeHtml(avatar)}" alt="头像">
                <div class="assignee-info">
                    <div class="assignee-name">${name}</div>
                    ${meta ? `<div class="assignee-meta">${meta}</div>` : ''}
                </div>
            </div>`;
        }).join('');
        this._positionAssigneeDropdown();
    }

    /**
     * 🔧 固定定位下拉：依据输入框实时坐标定位，避免被模态框 overflow 裁剪
     */
    _positionAssigneeDropdown() {
        const input = document.getElementById('taskAssigneeSearchInput');
        const dropdown = document.getElementById('taskAssigneeDropdown');
        if (!input || !dropdown) return;
        const rect = input.getBoundingClientRect();
        const maxH = 260;
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        let top;
        let maxHeight;
        if (spaceBelow >= 140) {
            top = rect.bottom + 4;
            maxHeight = Math.min(maxH, spaceBelow);
        } else {
            maxHeight = Math.min(maxH, rect.top - 8);
            top = rect.top - maxHeight;
        }
        dropdown.style.top = top + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.maxHeight = maxHeight + 'px';
        dropdown.style.display = 'block';
    }

    selectAssigneeByIndex(i) {
        const u = this.assigneeResults[i];
        if (u) this.setAssignee(u);
    }

    setAssignee(u) {
        document.getElementById('taskAssigneeId').value = u.id;
        const selected = document.getElementById('taskAssigneeSelected');
        const avatar = document.getElementById('taskAssigneeAvatar');
        const nameEl = document.getElementById('taskAssigneeName');
        const metaEl = document.getElementById('taskAssigneeMeta');
        const input = document.getElementById('taskAssigneeSearchInput');
        const dropdown = document.getElementById('taskAssigneeDropdown');
        if (avatar) avatar.src = u.avatar_url || '/static/images/default-avatar.png';
        if (nameEl) nameEl.textContent = u.real_name || u.username;
        if (metaEl) {
            const dept = u.department_info ? (u.department_info.name || '') : '';
            const pos = u.position || '';
            metaEl.textContent = [dept, pos].filter(Boolean).join(' · ');
        }
        if (selected) selected.style.display = 'flex';
        if (input) input.value = '';
        if (dropdown) dropdown.style.display = 'none';
    }

    clearAssignee(event) {
        if (event) event.stopPropagation();
        document.getElementById('taskAssigneeId').value = '';
        const selected = document.getElementById('taskAssigneeSelected');
        if (selected) selected.style.display = 'none';
    }

    resetAssigneePicker() {
        this.clearAssignee();
        const input = document.getElementById('taskAssigneeSearchInput');
        if (input) input.value = '';
    }

    getPriorityText(p) { return { low: '低', medium: '中', high: '高', urgent: '紧急' }[p]; }
    getStatusText(s) { return { todo: '待处理', in_progress: '进行中', done: '已完成' }[s]; }
    formatDate(date) { return new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
}

const taskApp = new TaskApp();
window.taskApp = taskApp;