// static/js/cloud-collab.js - 协作文档、协作者管理与文档选择
// 说明：本文件为 CloudApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(CloudApp.prototype, {


    // ==================== 文档协同功能 ====================

    // 添加编辑文档方法
    async editDocument(fileId) {
        // 打开新窗口加载编辑器
        window.open(`/cloud/editor/?id=${fileId}`, '_blank');
    },


    // 🔧 修复：加载协作文档列表
    async loadCollaborations_v1(filters = {}) {
        try {
            this.showLoading();

            const params = new URLSearchParams({
                page: filters.page || 1,
                page_size: filters.page_size || 20,
                order: filters.order || '-updated_at',
            });

            if (filters.search) {
                params.append('search', filters.search);
            }
            if (filters.folder) {
                params.append('folder', filters.folder);
            }

            const response = await fetch(`/api/cloud/documents/list_collabs/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '加载协作文档失败');
            }

            const data = await response.json();
            // 🔧 关键修复：正确处理分页响应
            const docs = Array.isArray(data.results) ? data.results : [];
            this.collabDocs = docs;

            this.renderCollaborations(this.collabDocs);

            // 🔧 更新分页信息（如有）
            if (data.count !== undefined) {
                this.collabTotalCount = data.count;
            }

        } catch (error) {
            console.error('加载协作文档失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    },


    async loadCollaborations(filters = {}) {
        try {
            this.showLoading();
            const page = filters.page || this.pagination.collabs.page;
            const params = new URLSearchParams({
                page: page,
                page_size: this.pagination.collabs.pageSize,
                order: filters.order || '-updated_at'
            });
            if (filters.search) params.append('search', filters.search);
            if (filters.folder) params.append('folder', filters.folder);

            const res = await fetch(`/api/cloud/documents/list_collabs/?${params.toString()}`, {headers: TokenManager.getHeaders()});
            this.statusCode = res.status;
            if (!res.ok) throw new Error('加载协作文档失败');

            const data = await res.json();
            const docs = Array.isArray(data.results) ? data.results : [];
            this.pagination.collabs.count = data.count || 0;
            this.pagination.collabs.next = data.next;
            this.pagination.collabs.previous = data.previous;
            this.collabDocs = docs;
            this.renderCollaborations(this.collabDocs);
            this.renderPagination('collabs');
        } catch (e) {
            console.error(e);
            this.showError('加载失败', e);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        } finally {
            this.hideLoading();
        }
    },


    // 🔧 优化：渲染协作文档列表（支持列表/网格视图）
    renderCollaborations(docs) {
        const listBody = document.getElementById('collabListBody');
        const gridBody = document.getElementById('collabGridBody');

        // 空状态
        if (!docs || docs.length === 0) {
            const emptyHtml = `
            <div class="empty-state">
                <i class="fas fa-file-alt"></i>
                <p>暂无协作文档</p>
                <button class="btn btn-primary" onclick="cloudApp.createDocFromFile()">
                    <i class="fas fa-plus"></i> 从文件创建协作文档
                </button>
                <small class="text-muted" style="margin-top:10px;display:block;">
                    选择一个现有文档开始协作编辑
                </small>
            </div>
        `;
            if (listBody) listBody.innerHTML = emptyHtml;
            if (gridBody) gridBody.innerHTML = emptyHtml;
            return;
        }

        // 🔧 列表视图渲染
        if (listBody) {
            let html = '';
            docs.forEach(doc => {
                const docType = doc.document_type || 'word';
                const iconClass = doc.doc_icon || this.getDocIconClass(docType);
                const docColor = ({word: '#409eff', excel: '#16a085', ppt: '#e6a23c', pdf: '#f56c6c', video: '#9b59b6', audio: '#00a1ff', text: '#909399', image: '#67c23a'})[docType] || '#409eff';
                const collaboratorCount = doc.collaborator_count || 0;
                const isOwner = doc.owner?.id === this.currentUser?.id;

                html += `
                <div class="file-item is-collab"
                     data-doc-id="${doc.id}"
                     data-doc-type="${docType}"
                     title="${this.escapeHtml(doc.name)}"
                     ondblclick="cloudApp.openCollabDoc('${doc.id}')">
                     
                    <div class="file-col name">
                        <i class="fas ${iconClass} collab-icon" style="color:${docColor};"></i>
                        <span class="file-name">${this.escapeHtml(doc.name)}</span>
                        ${!isOwner ? '<span class="badge badge-info">协作</span>' : ''}
                    </div>
                    
                    <div class="file-col type">
                        <span class="doc-type-badge ${docType}">${doc.doc_type_text || this.getDocTypeText(docType)}</span>
                    </div>
                    
                    <div class="file-col collaborators">
                        <i class="fas fa-users"></i> ${collaboratorCount}
                    </div>
                    
                    <div class="file-col date">${this.formatDate(doc.updated_at)}</div>
                    
                    <div class="file-col actions">
                        <button class="btn-action" onclick="event.stopPropagation(); cloudApp.openCollabDoc('${doc.id}')" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${isOwner ? `
                        <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${doc.id}', false, '${this.escapeHtml(doc.name)}')" title="分享">
                            <i class="fas fa-share-alt"></i>
                        </button> 
                        ` : ''}
                        <button class="btn-action" onclick="event.stopPropagation(); cloudApp.removeCollabDoc('${doc.id}', '${this.escapeHtml(doc.name)}')" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                        
                    </div>
                </div>
            `;
            });
            listBody.innerHTML = html;
        }

        // 🔧 网格视图渲染（卡片式）
        if (gridBody) {
            let html = '';
            docs.forEach(doc => {
                const docType = doc.document_type || 'word';
                const iconClass = doc.doc_icon || this.getDocIconClass(docType);
                const docColor = ({word: '#409eff', excel: '#16a085', ppt: '#e6a23c', pdf: '#f56c6c', video: '#9b59b6', audio: '#00a1ff', text: '#909399', image: '#67c23a'})[docType] || '#409eff';
                const collaboratorCount = doc.collaborator_count || 0;
                const isOwner = doc.owner?.id === this.currentUser?.id;

                html += `
                <div class="file-grid-item is-collab"
                     data-doc-id="${doc.id}"
                     data-doc-type="${docType}"
                     ondblclick="cloudApp.openCollabDoc('${doc.id}')"
                     title="${this.escapeHtml(doc.name)}">
                     
                    <div class="file-icon collab-icon-large">
                        <i class="fas ${iconClass}" style="color:${docColor};"></i>
                    </div>
                    
                    <div class="file-name" onclick="cloudApp.openCollabDoc('${doc.id}')">
                        ${this.escapeHtml(doc.name)}
                    </div>
                    
                    <div class="collab-card-footer">
                        <div class="collab-type" style="display:none">
                            <span class="doc-type-badge small ${docType}">
                                ${doc.doc_type_text || this.getDocTypeText(docType)}
                            </span>
                        </div>
                       <div class="collab-type">
                            <span title="协作者"><i class="fas fa-users"></i> ${collaboratorCount}</span>
                        </div>
                    </div>
                    
                    <div class="collab-card-footer">
                        <div class="file-date">
                            <span title="更新时间"><i class="fas fa-clock"></i> ${this.formatDate(doc.updated_at, 'short')}</span>
                        </div>
                    </div>
                    
                    <div class="collab-card-actions">
                        <button class="btn-icon" onclick="event.stopPropagation(); cloudApp.openCollabDoc('${doc.id}')" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${isOwner ? `
                            
                        <button class="btn-icon" onclick="event.stopPropagation(); cloudApp.shareFile('${doc.id}', false, '${this.escapeHtml(doc.name)}')" title="分享">
                            <i class="fas fa-share-alt"></i>
                        </button>
                        ` : ''}
                        <button class="btn-icon" onclick="event.stopPropagation(); cloudApp.removeCollabDoc('${doc.id}', '${this.escapeHtml(doc.name)}')" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                        
                    </div>
                    
                    ${!isOwner ? '<div class="collab-badge">协作</div>' : ''}
                </div>
            `;
            });
            gridBody.innerHTML = html;
        }

        this.updateCollabCount(docs.length);
    },


    updateCollabCount(count) {
        this.collabTotalCount = count || 0
        const collabElement = document.getElementById('collabCount')
        if (collabElement) {
            if (this.collabTotalCount > 0) {
                if (this.currentView === 'collaborations') {
                    collabElement.style.display = 'none'
                } else {
                    collabElement.style.display = 'block'
                }
                collabElement.textContent = this.collabTotalCount > 99 ? '99+' : `${this.collabTotalCount}`
            } else {
                collabElement.style.display = 'none'
            }
        }
    },

    updateCount(count, view, isHidden = false) {
        let elementId = '';
        switch (view) {
            case 'files':
                elementId = 'filesCount'
                break;
            case 'starred':
                elementId = 'starredCount'
                break;
            case 'shared':
                elementId = 'sharedCount';
                break;
            case 'shared-with-me':
                elementId = 'sharedWithMeCount'
                break;
            case 'collaborations':
                this.collabTotalCount = count || 0
                elementId = 'collabCount'
                break;
            case 'trash':
                elementId = 'trashCount'
                break;
        }

        const element = document.getElementById(elementId)
        if (element) {
            if (count > 0) {
                if (this.currentView === view && isHidden) {
                    element.style.display = 'none'
                } else {
                    element.style.display = 'block'
                }
                element.textContent = count > 99 ? '99+' : `${count}`
            } else {
                element.style.display = 'none'
            }
        }
    },

    // 🔧 辅助方法：获取文档类型文本
    getDocTypeText(docType) {
        const map = {
            'word': 'Word',
            'excel': 'Excel',
            'ppt': 'PPT',
            'pdf': 'PDF'
        };
        return map[docType] || '文档';
    },

    // 🔧 辅助方法：获取文档图标类
    getDocIconClass(docType) {
        const map = {
            'word': 'fa-file-word',
            'excel': 'fa-file-excel',
            'ppt': 'fa-file-powerpoint',
            'pdf': 'fa-file-pdf'
        };
        return map[docType] || 'fa-file';
    },


    // 🔧 打开协作文档
    openCollabDoc(docId) {
        window.open(`/cloud/editor/?id=${docId}`, '_blank');
    },


    // ==================== 管理协作文档 start ====================
    // 🔧 管理协作文档
    async manageCollabDoc(docId) {
        this.currentCollabDocId = docId;

        try {
            // 加载文档详情
            const response = await fetch(`/api/cloud/documents/${docId}/retrieve_doc_detail/`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载文档失败');

            const doc = await response.json();

            // 填充管理模态框
            document.getElementById('manageDocName').textContent = doc.name;
            document.getElementById('manageDocPath').textContent = doc.path || '根目录';
            document.getElementById('manageDocIcon').className = `fas ${this.getDocIconClass(doc.document_type)} fa-2x`;
            document.getElementById('manageDocNameInput').value = doc.name;
            document.getElementById('manageDocDescInput').value = doc.description || '';
            document.getElementById('manageDocPublic').checked = doc.is_public || false;

            // 加载协作者列表
            await this.loadCollabManageList(docId);

            // 显示模态框
            document.getElementById('collabDocManageModal').classList.add('show');

        } catch (error) {
            console.error('加载文档管理信息失败:', error);
            this.showError('加载失败', error.message);
        }
    },

    // 🔧 关闭协作文档管理模态框
    closeCollabManageModal() {
        document.getElementById('collabDocManageModal').classList.remove('show');
        this.currentCollabDocId = null;
    },

    // 🔧 加载协作者管理列表
    async loadCollabManageList(docId) {
        try {
            const response = await fetch(`/api/cloud/documents/${docId}/collaborators/`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载协作者失败');

            const data = await response.json();
            const collabs = data.collaborators || [];

            const container = document.getElementById('collabManageList');
            if (collabs.length === 0) {
                container.innerHTML = '<div class="empty-tip">暂无协作者</div>';
                return;
            }

            let html = '';
            collabs.forEach(collab => {
                html += `
                <div class="collab-manage-item">
                    <img src="${collab.avatar || '/static/images/default-avatar.png'}" 
                         alt="${collab.username}" class="collab-avatar">
                    <div class="collab-details">
                        <div class="collab-name">${this.escapeHtml(collab.real_name || collab.username)}</div>
                        <div class="collab-role">
                            <span class="collab-permission ${collab.permission}">
                                ${this.getPermissionText(collab.permission)}
                            </span>
                            ${!collab.is_active ? '<span class="badge badge-warning">已禁用</span>' : ''}
                        </div>
                    </div>
                    <div class="collab-actions">
                        <button class="btn-action" onclick="cloudApp.editCollabPermission('${collab.id}')" title="修改权限">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-action ${collab.is_active ? 'btn-warning' : 'btn-success'}" 
                                onclick="cloudApp.toggleCollabActive('${collab.id}', ${collab.is_active})" 
                                title="${collab.is_active ? '禁用' : '启用'}">
                            <i class="fas ${collab.is_active ? 'fa-ban' : 'fa-check'}"></i>
                        </button>
                        <button class="btn-action btn-danger" onclick="cloudApp.removeCollaborator('${collab.id}')" title="移除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            });
            container.innerHTML = html;

        } catch (error) {
            console.error('加载协作者列表失败:', error);
        }
    },


    // 🔧 打开添加协作者模态框（简化版，复用现有逻辑）
    async openAddCollabModal() {
        if (!this.currentCollabDocId) return;

        // 这里可以复用 DocumentEditorApp 的添加协作者逻辑
        // 或创建新的模态框，此处简化处理
        this.showInfo('添加协作', '添加协作者功能请在文档编辑页面操作');
    },

    // 🔧 修改协作者权限
    async editCollabPermission(collabId) {
        const newPermission = prompt('设置权限 (read/write/admin):', 'write');
        if (!newPermission || !['read', 'write', 'admin'].includes(newPermission)) {
            this.showWarning('无效的权限类型');
            return;
        }

        await this.updateCollabPermission(collabId, newPermission);
    },

    // 🔧 更新协作者权限
    async updateCollabPermission(collabId, permission, isActive = null) {
        if (!this.currentCollabDocId) return;

        try {
            const body = {permission};
            if (isActive !== null) body.is_active = isActive;

            const response = await fetch(`/api/cloud/documents/${this.currentCollabDocId}/collaborators/${collabId}/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '更新失败');
            }

            this.showSuccess('更新成功', '协作者权限已更新');
            await this.loadCollabManageList(this.currentCollabDocId);

        } catch (error) {
            console.error('更新协作者失败:', error);
            this.showError('更新失败', error.message);
        }
    },

    // 🔧 切换协作者激活状态
    async toggleCollabActive(collabId, currentActive) {
        await this.updateCollabPermission(collabId, null, !currentActive);
    },

    // 🔧 移除协作者
    async removeCollaborator(collabId) {
        if (!this.currentCollabDocId) return;

        const confirmed = await this.showConfirmDialog('移除协作者', '确定要移除该协作者吗？', 'confirm');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/documents/${this.currentCollabDocId}/collaborators/${collabId}/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '移除失败');
            }

            this.showSuccess('移除成功', '协作者已移除');
            await this.loadCollabManageList(this.currentCollabDocId);

        } catch (error) {
            console.error('移除协作者失败:', error);
            this.showError('移除失败', error.message);
        }
    },


    // 🔧 删除协作文档
    async deleteCollabDocument(docId = null) {
        const targetId = docId || this.currentCollabDocId;
        if (!targetId) {
            this.showError('操作失败', '未选择文档');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '删除协作文档',
            '确定要删除这个协作文档吗？<br><small style="color: var(--text-light);">删除后所有协作者将失去访问权限</small>',
            'danger'
        );
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/documents/${targetId}/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '删除失败');
            }

            this.showSuccess('删除成功', '协作文档已删除');
            this.closeCollabManageModal();
            await this.loadCollaborations();

        } catch (error) {
            console.error('删除协作文档失败:', error);
            this.showError('删除失败', error.message);
        }
    },


    // 🔧 保存协作文档设置
    async saveCollabDocSettings() {
        if (!this.currentCollabDocId) return;

        const name = document.getElementById('manageDocNameInput').value.trim();
        const description = document.getElementById('manageDocDescInput').value;
        const isPublic = document.getElementById('manageDocPublic').checked;

        if (!name) {
            this.showError('验证失败', '文档名称不能为空');
            return;
        }

        try {
            const response = await fetch(`/api/cloud/documents/${this.currentCollabDocId}/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    name: name,
                    description: description,
                    is_public: isPublic
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '保存失败');
            }

            this.showSuccess('保存成功', '文档设置已更新');
            await this.loadCollaborations();

        } catch (error) {
            console.error('保存文档设置失败:', error);
            this.showError('保存失败', error.message);
        }
    },


    // ==================== 管理协作文档 end ====================


    // ==================== 创建协作文档功能 ====================


    /**
     * 🔧 打开创建协作文档模态框
     */
    async openCreateCollabDocModal(fileId, fileName) {
        this.currentCreateFileId = fileId;
        this.currentCreateFileName = fileName;
        this.selectedCollabUsers.clear();

        // 显示模态框
        this.showCreateCollabDocModal();

        // 加载可添加的用户列表
        await this.loadAvailableCollabUsers();
    },

    /**
     * 🔧 显示创建协作文档模态框
     */
    showCreateCollabDocModal() {
        // 检查模态框是否存在
        let modal = document.getElementById('createCollabDocModal');
        if (!modal) {
            this.createCollabDocModal();
            modal = document.getElementById('createCollabDocModal');
        }

        // 更新标题
        const titleEl = modal.querySelector('.modal-title');
        if (titleEl) {
            titleEl.innerHTML = `<i class="fas fa-file-alt"></i> 创建协作文档：${this.currentCreateFileName}`;
        }

        // 清空并显示
        this.updateSelectedCollabsDisplay();
        document.getElementById(this.collabSearchElementId).value = '';
        document.getElementById(this.collabResultsElementId).innerHTML = '';
        document.getElementById(this.collabResultsElementId).classList.remove('show');

        modal.classList.add('show');
    },

    /**
     * 🔧 动态创建模态框结构
     */
    createCollabDocModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'createCollabDocModal';
        modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3 class="modal-title"><i class="fas fa-file-alt"></i> 创建协作文档</h3>
                <button class="close-btn" onclick="cloudApp.closeCreateCollabDocModal()">&times;</button>
            </div>
            <div class="modal-body">
                <!-- 搜索协作用户 -->
                <div class="form-group">
                    <label>添加协作者</label>
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" 
                               id="collabUserSearch" 
                               placeholder="搜索用户..." 
                               oninput="cloudApp.searchCollabUsers(this.value)">
                    </div>
                    <div class="search-results" id="collabUserResults"></div>
                </div>
                
                <!-- 已选协作者列表 -->
                <div class="form-group">
                    <label>已选协作者</label>
                    <div class="selected-collabs" id="selectedCollabs">
                        <small class="text-muted">暂无选中的协作者</small>
                    </div>
                </div>

                <!-- 通知设置 -->
                <div class="form-group">
                    <div class="notification-item">
                        <label>
                            <i class="fas fa-bell"></i>
                            发送协作通知
                        </label>
                        <label class="switch">
                            <input type="checkbox" id="collabNotify" checked>
                            <span class="slider"></span>
                        </label>
                    </div>
                    <small class="form-hint">将以私聊消息形式通知协作者</small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="cloudApp.closeCreateCollabDocModal()">取消</button>
                <button class="btn btn-primary" onclick="cloudApp.confirmCreateCollabDoc()">创建并协作</button>
            </div>
        </div>
    `;
        document.body.appendChild(modal);

        // 绑定关闭事件
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeCreateCollabDocModal();
        });
    },

    /**
     * 🔧 搜索协作用户
     */
    async searchCollabUsers(keyword, elementId = 'collabUserResults') {
        if (!keyword.trim()) {
            document.getElementById(elementId).innerHTML = '';
            document.getElementById(elementId).classList.remove('show');
            return;
        }

        try {
            const response = await fetch(`/api/cloud/search-users/?q=${encodeURIComponent(keyword)}`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('搜索失败');

            const data = await response.json();
            const users = data.results || [];

            // 过滤：排除已选用户和当前用户
            const filtered = users.filter(u =>
                !this.selectedCollabUsers.has(u.id) &&
                u.id !== this.currentUser?.id
            );

            this.renderCollabUserResults(filtered, elementId);
        } catch (error) {
            console.error('搜索用户失败:', error);
            this.showError('搜索失败');
        }
    },

    /**
     * 🔧 渲染搜索结果
     */
    renderCollabUserResults(users, elementId = 'collabUserResults') {
        const container = document.getElementById(elementId);
        if (users.length === 0) {
            container.innerHTML = '<div class="empty-tip">未找到用户</div>';
            container.classList.add('show');
            return;
        }

        let html = '';
        users.forEach(user => {
            html += `
            <div class="user-result-item" onclick="cloudApp.addCollabUser(${user.id}, '${this.escapeHtml(user.real_name || user.username)}', this)">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" class="user-avatar">
                <div class="user-info">
                    <div class="user-name">${this.escapeHtml(user.real_name || user.username)}</div>
                    <div class="user-dept">${this.escapeHtml([user.position || '', user.department_name || user.department || (user.department_info && user.department_info.name) || ''].filter(Boolean).join(' · '))}</div>
                </div>
                <i class="fas fa-plus-circle add-icon" data-user-id="${user.id}" title="添加协作者"></i>
            </div>
        `;
        });
        container.innerHTML = html;
        container.classList.add('show');
    },

    /**
     * 🔧 加载可添加的用户列表（初始加载）
     */
    async loadAvailableCollabUsers() {
        try {
            const response = await fetch('/api/auth/users/?page_size=50', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) return;

            const data = await response.json();
            const users = data.results || data || [];

            // 过滤并缓存
            this.availableCollabUsers = users.filter(u =>
                u.id !== this.currentUser?.id &&
                !this.selectedCollabUsers.has(u.id)
            );
        } catch (error) {
            console.warn('加载用户列表失败:', error);
        }
    },

    /**
     * 🔧 添加协作者
     */
    addCollabUser(userId, userName, element) {
        if (this.selectedCollabUsers.has(userId)) return;

        this.selectedCollabUsers.set(userId, {
            name: userName,
            permission: 'write'
        });

        let iconElement = element.querySelector('i') || element;
        if (iconElement) {
            iconElement.className = 'fas fa-check-circle';
            iconElement.style.color = '#28a745';
        }

        this.updateSelectedCollabsDisplay();
        // document.getElementById(this.collabSearchElementId).value = '';
        // document.getElementById(this.collabResultsElementId).classList.remove('show');

        this.showSuccess('已添加', `${userName} 已添加到协作者列表`);
    },

    /**
     * 🔧 移除协作者
     */
    removeCollabUser(userId) {
        const user = this.selectedCollabUsers.get(userId);
        this.selectedCollabUsers.delete(userId);


        const collabSearchResults = document.getElementById(this.collabResultsElementId);
        let iconElement = collabSearchResults.querySelector(`[data-user-id="${userId}"]`);
        if (iconElement) {
            iconElement.className = 'fas fa-plus-circle';
            iconElement.style.color = '#409EFF'
        } else {
            console.log(`iconElement not found userId=${userId}`);
        }

        this.updateSelectedCollabsDisplay();

        if (user?.name) {
            this.showInfo('已移除', `${user.name} 已从协作者列表移除`);
        }
    },

    /**
     * 🔧 更新协作者权限
     */
    updateCollabPermission(userId, permission) {
        const user = this.selectedCollabUsers.get(userId);
        if (user) {
            user.permission = permission;
            this.updateSelectedCollabsDisplay();
        }
    },

    /**
     * 🔧 更新已选协作者显示
     */
    updateSelectedCollabsDisplay() {
        const container = document.getElementById(this.collabselectedElementId);
        if (!container) return;

        if (this.selectedCollabUsers.size === 0) {
            container.innerHTML = '<small class="text-muted">暂无选中的协作者</small>';
            return;
        }

        let html = '<div class="collabs-grid">';
        this.selectedCollabUsers.forEach((info, userId) => {
            html += `
            <div class="collab-tag">
                <span class="collab-name">${this.escapeHtml(info.name)}</span>
                <select class="collab-permission" onchange="cloudApp.updateCollabPermission(${userId}, this.value)">
                    <option value="read" ${info.permission === 'read' ? 'selected' : ''}>只读</option>
                    <option value="write" ${info.permission === 'write' ? 'selected' : ''}>可编辑</option>
                    <option value="admin" ${info.permission === 'admin' ? 'selected' : ''}>管理员</option>
                </select>
                <i class="fas fa-times remove-collab" onclick="cloudApp.removeCollabUser(${userId})"></i>
            </div>
        `;
        });
        html += '</div>';
        container.innerHTML = html;
    },

    /**
     * 🔧 确认创建协作文档
     */
    async confirmCreateCollabDoc() {
        if (!this.currentCreateFileId) {
            this.showError('操作失败', '未选择源文件');
            return;
        }

        if (this.selectedCollabUsers.size === 0) {
            this.showError('验证失败', '请至少添加一位协作者');
            return;
        }

        // 构建请求参数
        const initialCollaborators = Array.from(this.selectedCollabUsers.entries()).map(([userId, info]) => ({
            user_id: userId,
            permission: info.permission
        }));

        const notify = document.getElementById('collabNotify').checked;

        try {
            this.showLoading();

            const response = await fetch('/api/cloud/documents/create-collab/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    file_id: this.currentCreateFileId,
                    initial_collaborators: initialCollaborators,
                    notify: notify
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '创建失败');
            }

            const result = await response.json();

            // 创建成功，跳转到编辑器
            this.showSuccess('创建成功', `已添加 ${result.collaborator_count} 位协作者`);
            this.closeCreateCollabDocModal();

            // 打开编辑器（新窗口）
            window.open(result.edit_url, '_blank');

            // 刷新文件列表
            await this.loadFiles(this.currentFolderId);

        } catch (error) {
            console.error('创建协作文档失败:', error);
            this.showError('创建失败', error.message);
        } finally {
            this.hideLoading();
        }
    },

    /**
     * 🔧 关闭创建协作文档模态框
     */
    closeCreateCollabDocModal() {
        const modal = document.getElementById('createCollabDocModal');
        if (modal) {
            modal.classList.remove('show');
        }
        // 清理状态
        this.currentCreateFileId = null;
        this.currentCreateFileName = null;
        this.selectedCollabUsers.clear();
    },


    async removeCollabDoc(fileId, sourceName = '') {

        if (!fileId) {
            this.showError('操作失败', '未选择文档');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '删除协作文档',
            `确定要删除 <strong>${sourceName}</strong> 这个协作文档吗？<br><small style="color: var(--text-light);">删除后所有协作者将失去访问权限</small>`,
            'danger'
        );

        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/documents/${fileId}/remove-collab/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '删除失败');
            }

            this.showSuccess('删除成功', '已经删除该协作文档');
            await this.loadCollaborations();
        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    },


    loadCollabVersions(currentCollabDocId) {
        console.log('loadCollabVersions ...')
    },


    async editCollabDocument(fileId, fileName) {
        await this.renameFile(fileId, fileName, false)
    },


    // 🔧 分享协作文档
    async shareCollabDocument(fileId) {
        // 调用现有的分享功能
        await this.shareFile(fileId, false);
    },

    /**
     * 🔧 从云文件创建新协作文档（主入口）
     */
    async createDocFromFile() {
        this.openFileSelectModal('document');  // 只显示文档类型文件
    },

    /**
     * 🔧 打开文件选择模态框
     * @param {string} filterType - 'all' | 'document' | 'image' | 'video'
     */
    openFileSelectModal(filterType = 'all') {
        const modal = document.getElementById('fileSelectModal');

        if (!modal) {
            this.createFileSelectModal(filterType);
        } else {
            modal.dataset.filterType = filterType;
            modal.classList.add('show');
            this.loadFileSelectList(filterType);
        }
    },

    /**
     * 🔧 创建文件选择模态框（动态生成）
     */
    createFileSelectModal(filterType) {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'fileSelectModal';
        modal.dataset.filterType = filterType;

        this.selectedFileId = null
        this.selectedFileName = null;
        this.selectedCollabUsers.clear();

        const filterLabels = {
            'all': '全部文件',
            'document': '文档文件',
            'image': '图片文件',
            'video': '视频文件'
        };

        modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px; max-height: 80vh;">
            <div class="modal-header">
                <h3><i class="fas fa-file-alt"></i> 选择文件 - ${filterLabels[filterType] || '全部文件'}</h3>
                <button class="close-btn" onclick="cloudApp.closeFileSelectModal()">&times;</button>
            </div>
            <div class="modal-body">
                <!-- 面包屑导航 -->
                <div class="file-select-breadcrumb" id="fileSelectBreadcrumb">
                    <span class="crumb-item active" data-folder-id="">全部文件</span>
                </div>
                
                <!-- 文件列表容器 -->
                <div class="file-select-list" id="fileSelectList">
                    <div class="loading">加载中...</div>
                </div>
                
                <!-- 空状态 -->
                <div class="empty-state" id="fileSelectEmpty" style="display: none;">
                    <i class="fas fa-folder-open"></i>
                    <p>暂无文件</p>
                </div>
                
                
                <div class="form-group">
                    <label>初始协作者（必选）</label>
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" id="collabUserSearchNew" 
                            placeholder="搜索用户添加为协作者..." 
                            oninput="cloudApp.searchCollabUsers(this.value, 'collabUserResultsNew')">
                       
                    </div>
                    
                    <div class="search-results" id="collabUserResultsNew"></div>
                    
             
                </div>
                
                <!-- 已选协作者列表 -->
                <div class="form-group">
                    <label>已选协作者</label>
                    <div class="selected-collabs" id="selectedCollabsNew">
                        <small class="text-muted">暂无选中的协作者</small>
                    </div>
                </div>
                
                <!-- 通知设置 -->
                <div class="form-group">
                    <div class="notification-item">
                        <label>
                            <i class="fas fa-bell"></i>
                            发送协作通知
                        </label>
                        <label class="switch">
                            <input type="checkbox" id="selectCollabNotify" checked>
                            <span class="slider"></span>
                        </label>
                    </div>
                    <small class="form-hint">将以私聊消息形式通知协作者</small>
                </div>

              
                
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="cloudApp.closeFileSelectModal()">取消</button>
                <button class="btn btn-primary" id="confirmFileSelect" disabled onclick="cloudApp.confirmFileSelect()">确定</button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // 绑定事件
        modal.querySelector('.close-btn').onclick = () => this.closeFileSelectModal();
        modal.onclick = (e) => {
            if (e.target === modal) this.closeFileSelectModal();
        };

        // 加载文件列表
        this.loadFileSelectList(filterType);
    },

    /**
     * 🔧 加载文件选择列表（支持文件夹钻取 + 文档过滤）
     */
    async loadFileSelectList(filterType, folderId = null) {
        const listContainer = document.getElementById('fileSelectList');
        const emptyState = document.getElementById('fileSelectEmpty');

        if (!listContainer) return;

        listContainer.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
        emptyState.style.display = 'none';

        try {
            const params = new URLSearchParams();
            if (folderId) params.append('folder', folderId);

            // 🔧 关键：文档模式只返回可编辑的文档文件
            if (filterType === 'document') {
                // 后端需支持 doc_types 参数过滤
                params.append('doc_types', 'true');
            }

            const response = await fetch(`/api/cloud/files/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载失败');

            const data = await response.json();
            const files = Array.isArray(data.results) ? data.results : data;

            // 🔧 前端二次过滤：确保只显示文档文件
            let displayFiles = files;
            if (filterType === 'document') {
                displayFiles = files.filter(f => !f.is_folder && f.is_document);
            }

            if (displayFiles.length === 0) {
                listContainer.innerHTML = '';
                emptyState.style.display = 'flex';
                return;
            }

            // 🔧 渲染文件网格（卡片式）
            let html = '<div class="file-select-grid">';
            displayFiles.forEach(file => {
                if (file.is_folder) return;  // 暂不支持文件夹选择

                const iconClass = file.icon_class || 'fa-file';
                const isSelected = this.selectedFileId === file.id;

                html += `
                <div class="file-select-item ${isSelected ? 'selected' : ''}"
                     data-file-id="${file.id}"
                     data-file-name="${this.escapeHtml(file.name)}"
                     onclick="cloudApp.selectFileForDoc('${file.id}', '${this.escapeHtml(file.name)}')"
                     ondblclick="cloudApp.confirmFileSelect()">
                     
                    <div class="file-select-icon">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="file-select-name" title="${this.escapeHtml(file.name)}">
                        ${this.escapeHtml(file.name)}
                    </div>
                    <div class="file-select-size">${file.size_formatted || ''}</div>
                </div>
            `;
            });
            html += '</div>';

            listContainer.innerHTML = html;

        } catch (error) {
            console.error('加载文件列表失败:', error);
            listContainer.innerHTML = `<div class="error">加载失败: ${error.message}</div>`;
            emptyState.style.display = 'flex';
        }
    },

    /**
     * 🔧 选择文件
     */
    selectFileForDoc(fileId, fileName) {
        // 更新选中状态
        document.querySelectorAll('.file-select-item').forEach(item => {
            item.classList.remove('selected');
        });

        const selectedItem = document.querySelector(`.file-select-item[data-file-id="${fileId}"]`);
        if (selectedItem) selectedItem.classList.add('selected');

        // 保存选中状态
        this.selectedFileId = fileId;
        this.selectedFileName = fileName;

        // 启用确认按钮
        const confirmBtn = document.getElementById('confirmFileSelect');
        if (confirmBtn) confirmBtn.disabled = false;
    },

    /**
     * 🔧 确认选择并创建文档
     */
    async confirmFileSelect() {
        console.log('selectedFileId: ', this.selectedFileId)
        console.log('selectedCollabUsers: ', this.selectedCollabUsers)

        if (!this.selectedFileId) {
            this.showError('请先选择一个文件');
            return;
        }

        if (this.selectedCollabUsers.size === 0) {
            this.showError('验证失败', '请至少添加一位协作者');
            return;
        }

        // 构建请求参数
        const initialCollaborators = Array.from(this.selectedCollabUsers.entries()).map(([userId, info]) => ({
            user_id: userId,
            permission: info.permission
        }));

        const notify = document.getElementById('selectCollabNotify').checked;


        try {
            this.showLoading();


            const response = await fetch('/api/cloud/documents/create-collab/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    file_id: this.selectedFileId,
                    initial_collaborators: initialCollaborators,
                    notify: notify
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '创建失败');
            }

            const result = await response.json();

            // 创建成功，跳转到编辑器
            this.showSuccess('创建成功', `已添加 ${result.collaborator_count} 位协作者`);


            // 关闭模态框
            this.closeFileSelectModal();

            // // 🔧 打开编辑器（优先使用返回的配置）
            // if (result.config) {
            //     this.openEditorWithConfig(result.config);
            // } else {
            //     // 降级方案：直接打开编辑器页面
            //     window.open(`/cloud/editor/?id=${this.selectedFileId}`, '_blank');
            // }

            // // 降级方案：直接打开编辑器页面
            // window.open(`/cloud/editor/?id=${this.selectedFileId}`, '_blank');


            this.showSuccess('文档创建成功', `已开始编辑: ${this.selectedFileName}`);

            // 🔧 刷新协作文档列表
            await this.loadCollaborations();

        } catch (error) {
            console.error('创建文档失败:', error);
            this.showError('创建失败', error.message);
        } finally {
            this.hideLoading();
            // 清空选中状态
            this.selectedFileId = null;
            this.selectedFileName = null;
        }
    },

    /**
     * 🔧 使用配置打开编辑器（支持嵌入式初始化）
     */
    openEditorWithConfig(config) {
        const editorUrl = '/cloud/editor/?mode=embedded';
        const editorWindow = window.open(editorUrl, '_blank');

        if (editorWindow) {
            // 延迟发送配置，确保子窗口加载完成
            setTimeout(() => {
                editorWindow.postMessage({
                    type: 'EDITOR_CONFIG',
                    config: config
                }, window.location.origin);
            }, 1000);
        }
    },

    /**
     * 🔧 关闭文件选择模态框
     */
    closeFileSelectModal() {
        const modal = document.getElementById('fileSelectModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                if (modal.parentNode) modal.parentNode.removeChild(modal);
            }, 300);
        }
        this.selectedFileId = null;
        this.selectedFileName = null;
        this.selectedCollabUsers.clear();
    },
    });
})();
