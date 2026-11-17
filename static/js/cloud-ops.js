// static/js/cloud-ops.js - 回收站、移动/重命名、搜索统计、操作日志与配置
// 说明：本文件为 CloudApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(CloudApp.prototype, {

    async loadTrash_v1() {
        try {
            this.showLoading();
            const response = await fetch('/api/cloud/files/?trash=true', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载回收站失败');

            const data = await response.json();
            const files = Array.isArray(data.results) ? data.results : data;
            this.renderTrash(files);
        } catch (error) {
            console.error('加载回收站失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    },

    /**
     * 🔧 加载回收站（使用新接口）
     */
    async loadTrash() {
        try {
            this.showLoading();

            // 🔧 使用新接口获取文件和文件夹
            const response = await fetch('/api/cloud/files/trash_items/', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;

            if (!response.ok) throw new Error('加载回收站失败');

            const data = await response.json();
            this.trashItems = Array.isArray(data.items) ? data.items : [];

            this.renderTrash(this.trashItems);

        } catch (error) {
            console.error('加载回收站失败:', error);
            this.showError('加载失败', error);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        } finally {
            this.hideLoading();
        }
    },


    /**
     * 🔧 渲染回收站（支持列表/网格视图）
     */
    renderTrash(items) {
        const listBody = document.getElementById('trashListBody');
        const gridBody = document.getElementById('trashGridBody');

        if (!items || items.length === 0) {
            const emptyHtml = `
                <div class="empty-state">
                    <i class="fas fa-trash"></i>
                    <p>回收站为空</p>
                </div>
            `;
            if (listBody) listBody.innerHTML = emptyHtml;
            if (gridBody) gridBody.innerHTML = emptyHtml;
            return;
        }

        // 🔧 列表视图渲染
        if (listBody) {
            let html = '';
            items.forEach(item => {
                const isFolder = item.is_folder || item.item_type === 'folder';
                const iconClass = isFolder ? 'fa-folder' : (item.icon_class || 'fa-file');
                html += `
                    <div class="file-item ${isFolder ? 'is-folder' : ''}" 
                         data-file-id="${item.id}" 
                         data-is-folder="${isFolder}" title="${item.name}">
                        <div class="file-col name">
                            <input type="checkbox" class="file-checkbox" data-file-id="${item.id}">
                            ${isFolder ? '<i class="fas fa-folder" style="color:#e6a23c"></i>' : this._typedIconHtml(item, 18)}
                            <span class="file-name">${this.escapeHtml(item.name)}</span>
                        </div>
                        <div class="file-col size">${isFolder ? '-' : (item.size_formatted || '-')}</div>
                        <div class="file-col date">${this.formatDate(item.deleted_at)}</div>
                        <div class="file-col actions">
                            <button class="btn-action" 
                                    onclick="event.stopPropagation(); cloudApp.restoreItem('${item.id}', ${isFolder})" 
                                    title="恢复">
                                <i class="fas fa-undo"></i>
                            </button>
                            <button class="btn-action" 
                                    onclick="event.stopPropagation(); cloudApp.permanentDeleteItem('${item.id}', ${isFolder}, '${this.escapeHtml(item.name)}')" 
                                    title="永久删除">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            listBody.innerHTML = html;
        }

        // 🔧 网格视图渲染
        if (gridBody) {
            let html = '';
            items.forEach(item => {
                const isFolder = item.is_folder;
                const iconClass = isFolder ? 'fa-folder' : (item.icon_class || 'fa-file');
                html += `
                    <div class="file-grid-item ${isFolder ? 'is-folder' : ''}" 
                         data-file-id="${item.id}" 
                         data-is-folder="${isFolder}" title="${item.name}">
                        <div class="file-icon">
                            ${isFolder ? '<i class="fas fa-folder" style="color:#e6a23c"></i>' : this._typedIconHtml(item, 48)}
                        </div>
                        <div class="file-name">${this.escapeHtml(item.name)}</div>
                        <div class="file-size">${isFolder ? '' : (item.size_formatted || '')}</div>
                        <div class="file-date">${this.formatDate(item.deleted_at)}</div>
                        <div class="file-actions">
                            <button class="btn-action" onclick="cloudApp.restoreItem('${item.id}', ${isFolder})" title="恢复">
                                <i class="fas fa-undo"></i>
                            </button>
                            <button class="btn-action" onclick="cloudApp.permanentDeleteItem('${item.id}', ${isFolder}, '${this.escapeHtml(item.name)}')" title="永久删除">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            gridBody.innerHTML = html;
        }

        // 绑定复选框事件
        document.querySelectorAll('#trashListBody .file-checkbox, #trashGridBody .file-checkbox').forEach(cb => {
            cb.onchange = (e) => {
                const itemId = e.target.dataset.fileId;
                if (e.target.checked) {
                    this.selectedFiles.add(itemId);
                } else {
                    this.selectedFiles.delete(itemId);
                }
                this.updateTrashBatchButtons();
            };
        });

    },

    /**
     * 🔧 切换回收站视图模式
     */
    switchTrashViewMode(mode) {
        this.trashViewMode = mode;

        // 更新按钮状态
        document.querySelectorAll('.view-switcher .btn-icon').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.viewMode === mode);
        });

        // 切换显示
        const listView = document.getElementById('trashListView');
        const gridView = document.getElementById('trashGridView');

        if (listView && gridView) {
            listView.classList.toggle('active', mode === 'list');
            gridView.classList.toggle('active', mode === 'grid');
        }
    },


    /**
     * 🔧 切换协作文档视图模式
     */
    switchCollabViewMode(mode) {
        this.trashViewMode = mode;

        // 更新按钮状态
        document.querySelectorAll('.view-switcher .btn-icon').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.viewMode === mode);
        });

        // 切换显示
        const listView = document.getElementById('collabListView');
        const gridView = document.getElementById('collabGridView');

        if (listView && gridView) {
            listView.classList.toggle('active', mode === 'list');
            gridView.classList.toggle('active', mode === 'grid');
        }
    },


    /**
     * 🔧 更新回收站批量操作按钮
     */
    updateTrashBatchButtons() {
        const batchRestoreBtn = document.getElementById('batchRestoreBtn');
        const batchDeleteTrashBtn = document.getElementById('batchDeleteTrashBtn');

        if (batchRestoreBtn && batchDeleteTrashBtn) {
            const hasSelection = this.selectedFiles.size > 0;
            batchRestoreBtn.style.display = hasSelection ? 'inline-block' : 'none';
            batchDeleteTrashBtn.style.display = hasSelection ? 'inline-block' : 'none';
        }
    },


    // ==================== 右键菜单（完善版）====================

    /**
     * 🔧 右键菜单恢复
     */
    restoreSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder, sourceName} = this.contextTarget;
            this.restoreItem(fileId, isFolder);
        }
        this.hideContextMenu();
    },

    /**
     * 🔧 右键菜单永久删除
     */
    permanentDeleteSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder, sourceName} = this.contextTarget;
            this.permanentDeleteItem(fileId, isFolder, sourceName);
        }
        this.hideContextMenu();
    },

    /**
     * 🔧 右键菜单设置（回收站视图专用）
     */
    setupTrashContextMenu() {
        // 在回收站视图中，右键菜单显示恢复和永久删除选项
        const menu = document.getElementById('contextMenu');
        if (menu && this.currentView === 'trash') {
            menu.innerHTML = `
                <div class="menu-item" onclick="cloudApp.restoreSelectedItem()">
                    <i class="fas fa-undo"></i> 恢复
                </div>
                <div class="menu-divider"></div>
                <div class="menu-item danger" onclick="cloudApp.permanentDeleteSelectedItem()">
                    <i class="fas fa-trash-alt"></i> 永久删除
                </div>
            `;
        }
    },


    /**
     * 🔧 回收站批量操作按钮
     */
    setupTrashActions() {
        // 批量恢复按钮
        const batchRestoreBtn = document.getElementById('batchRestoreBtn');
        if (batchRestoreBtn) {
            batchRestoreBtn.addEventListener('click', () => this.batchRestore());
        }

        // 批量删除按钮
        const batchDeleteTrashBtn = document.getElementById('batchDeleteTrashBtn');
        if (batchDeleteTrashBtn) {
            batchDeleteTrashBtn.addEventListener('click', () => this.batchPermanentDelete());
        }

        // 全选按钮
        const selectAllTrash = document.getElementById('selectAllTrash');
        if (selectAllTrash) {
            selectAllTrash.addEventListener('change', (e) => {
                document.querySelectorAll('#trashListBody .file-checkbox').forEach(cb => {
                    cb.checked = e.target.checked;
                    const fileId = cb.dataset.fileId;
                    if (e.target.checked) {
                        this.selectedFiles.add(fileId);
                    } else {
                        this.selectedFiles.delete(fileId);
                    }
                });
            });
        }
    },


    async restoreFile(fileId) {
        const confirmed = await this.showConfirmDialog('恢复文件', '确定要恢复这个文件吗？', 'confirm');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/files/${fileId}/restore/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('恢复失败');

            this.showSuccess('恢复成功', '文件已恢复');
            await this.loadTrash();
        } catch (error) {
            console.error('恢复失败:', error);
            this.showError('恢复失败', error.message);
        }
    },


    // ==================== 删除功能（完善版）====================

    /**
     * 🔧 关键修复：删除文件/文件夹（区分类型）
     * @param {string} itemId - 文件或文件夹 ID
     * @param {boolean} isFolder - 是否为文件夹
     */
    async deleteItem(itemId, isFolder = false, sourceName = '') {
        const confirmed = await this.showConfirmDialog(
            '删除确认',
            `确定要删除 <strong>${sourceName}</strong> 这个${isFolder ? '文件夹' : '文件'}吗？`,
            'danger'
        );

        if (!confirmed) return;

        try {
            // 🔧 根据类型调用不同接口
            const url = isFolder
                ? `/api/cloud/folders/${itemId}/delete/`
                : `/api/cloud/files/${itemId}/delete/`;

            const response = await fetch(url, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '删除失败');
            }

            this.showSuccess('删除成功', `${isFolder ? '文件夹' : '文件'}已移动到回收站`);

            // 刷新当前列表
            if (this.currentView === 'files') {
                await this.loadFiles(this.currentFolderId);
            } else if (this.currentView === 'trash') {
                await this.loadTrash();
            } else if (this.currentView === 'shared-folders') {
                await this.loadSharedFolders(this.currentFolderId);
            } else {
                await this.loadFiles(null);
            }


        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    },

    /**
     * 🔧 永久删除文件（回收站专用）
     */
    async permanentDelete(fileId) {
        const confirmed = await this.showConfirmDialog(
            '永久删除',
            '确定要永久删除这个文件吗？此操作不可恢复！',
            'danger'
        );

        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/files/${fileId}/permanent_delete/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '删除失败');
            }

            this.showSuccess('删除成功', response.error || response.message || '文件已永久删除');
            await this.loadTrash();

        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    },


    // ==================== 回收站恢复功能（完善版）====================

    /**
     * 🔧 恢复文件/文件夹
     */
    async restoreItem(itemId, isFolder = false) {
        const confirmed = await this.showConfirmDialog(
            '恢复确认',
            `确定要恢复这个${isFolder ? '文件夹' : '文件'}吗？`,
            'confirm'
        );

        if (!confirmed) return;

        try {
            // 🔧 根据类型调用不同接口
            const url = isFolder
                ? `/api/cloud/folders/${itemId}/restore/`
                : `/api/cloud/files/${itemId}/restore/`;

            const response = await fetch(url, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '恢复失败');
            }

            this.showSuccess('恢复成功', `${isFolder ? '文件夹' : '文件'}已恢复`);
            await this.loadTrash();

        } catch (error) {
            console.error('恢复失败:', error);
            this.showError('恢复失败', error.message);
        }
    },

    /**
     * 🔧 永久删除文件/文件夹
     */
    async permanentDeleteItem(itemId, isFolder = false, sourceName = null) {
        const confirmed = await this.showConfirmDialog(
            '永久删除',
            `确定要永久删除 <strong>${sourceName}</strong> 个${isFolder ? '文件夹' : '文件'}吗？此操作不可恢复！`,
            'danger'
        );

        if (!confirmed) return;

        try {
            // 🔧 根据类型调用不同接口
            const url = isFolder
                ? `/api/cloud/folders/${itemId}/permanent_delete/`
                : `/api/cloud/files/${itemId}/permanent_delete/`;

            const response = await fetch(url, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || '删除失败');
            }

            // 🔧 处理逻辑清空和物理清空的不同响应
            if (result.logical_delete) {
                this.showWarning(
                    '有关联引用',
                    `${isFolder ? '文件夹' : '文件'}有关联引用，已标记为永久删除（保留记录）<br>
                     关联类型：${result.associations?.join(', ') || '未知'}`
                );
            } else {
                this.showSuccess('删除成功', `${isFolder ? '文件夹' : '文件'}已永久删除`);
            }
            await this.loadTrash();

        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    },

    /**
     * 🔧 批量恢复
     */
    async batchRestore() {
        if (this.selectedFiles.size === 0) {
            this.showError('操作失败', '请先选择要恢复的项目');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '批量恢复',
            `确定要恢复选中的 ${this.selectedFiles.size} 个项目吗？`,
            'confirm'
        );


        if (!confirmed) return;

        try {
            for (const itemId of this.selectedFiles) {
                // 从数据中获取类型
                const item = this.trashItems.find(i => i.id === itemId);
                const isFolder = item?.is_folder || false;

                const url = isFolder
                    ? `/api/cloud/folders/${itemId}/restore/`
                    : `/api/cloud/files/${itemId}/restore/`;

                await fetch(url, {
                    method: 'POST',
                    headers: TokenManager.getHeaders()
                });
            }

            this.showSuccess('批量恢复成功', `已恢复 ${this.selectedFiles.size} 个项目`);
            this.selectedFiles.clear();
            this.updateTrashBatchButtons();
            await this.loadTrash();

        } catch (error) {
            console.error('批量恢复失败:', error);
            this.showError('批量恢复失败', error.message);
        }
    },

    /**
     * 🔧 批量永久删除
     */
    async batchPermanentDelete() {
        if (this.selectedFiles.size === 0) {
            this.showError('操作失败', '请先选择要删除的项目');
            return;
        }

        console.log('this.selectedFiles.size: ', this.selectedFiles.size)

        const confirmed = await this.showConfirmDialog(
            '批量永久删除',
            `确定要永久删除选中的 ${this.selectedFiles.size} 个项目吗？此操作不可恢复！`,
            'danger'
        );

        if (!confirmed) return;

        try {
            for (const itemId of this.selectedFiles) {
                const item = this.trashItems.find(i => i.id === itemId);
                const isFolder = item?.is_folder || false;

                const url = isFolder
                    ? `/api/cloud/folders/${itemId}/permanent_delete/`
                    : `/api/cloud/files/${itemId}/permanent_delete/`;

                await fetch(url, {
                    method: 'POST',
                    headers: TokenManager.getHeaders()
                });
            }

            this.showSuccess('批量删除成功', `已永久删除 ${this.selectedFiles.size} 个项目`);
            this.selectedFiles.clear();
            this.updateTrashBatchButtons();
            await this.loadTrash();

        } catch (error) {
            console.error('批量删除失败:', error);
            this.showError('批量删除失败', error.message);
        }
    },


    async emptyTrash() {
        const confirmed = await this.showConfirmDialog('清空回收站', '确定要清空回收站吗？所有文件将永久删除，此操作不可恢复！', 'danger');
        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch('/api/cloud/files/empty_trash/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || '删除失败');
            }


            // 🔧 显示详细统计
            const stats = result.stats;
            let message = `回收站已清空<br>
                          文件：逻辑清空 ${stats.files_logical} 个，物理清空 ${stats.files_physical} 个<br>
                          文件夹：逻辑清空 ${stats.folders_logical} 个，物理清空 ${stats.folders_physical} 个`;

            if (stats.errors.length > 0) {
                message += `<br><small style="color: var(--text-warning);">
                           ${stats.errors.length} 个项目处理失败</small>`;
            }

            this.showSuccess('清空成功', message);
            await this.loadTrash();
        } catch (error) {
            this.hideLoading();
            console.error('清空失败:', error);
            this.showError('清空失败', error);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        }
    },

    // ==================== 移动/重命名 ====================


    /**
     * 🔧 关键修复：重命名文件/文件夹（增加类型参数）
     * @param {string} itemId - 文件或文件夹 ID
     * @param {string} itemName - 当前名称
     * @param {boolean} isFolder - 是否为文件夹
     */
    async renameItem(itemId, itemName, isFolder = false) {
        this.currentRenameId = itemId;
        this.currentRenameType = isFolder ? 'folder' : 'file';
        this.currentRenameName = itemName;

        document.getElementById('renameInput').value = itemName;

        // 🔧 更新模态框标题
        const modalTitle = document.querySelector('#renameModal .modal-header h3');
        if (modalTitle) {
            modalTitle.innerHTML = isFolder ? '<i class="fas fa-edit"></i> 重命名文件夹' : '<i class="fas fa-edit"></i> 重命名文件';
        }

        this.openModal('renameModal');
    },

    /**
     * 列表/网格视图中的重命名按钮调用
     * @param {string} fileId - 文件/文件夹 ID
     * @param {string} fileName - 名称
     * @param {boolean} isFolder - 是否为文件夹
     */
    async renameFile(fileId, fileName, isFolder = false) {
        // 🔧 阻止事件冒泡
        event?.stopPropagation();

        // 🔧 传递 isFolder 参数
        await this.renameItem(fileId, fileName, isFolder);
    },


    /**
     * 🔧 关键修复：确认重命名（根据类型请求不同接口）
     */
    async confirmRename() {
        const newName = document.getElementById('renameInput').value.trim();
        if (!newName) {
            this.showError('验证失败', '名称不能为空');
            return;
        }

        // 🔧 验证：名称不能与原来相同
        if (newName === this.currentRenameName) {
            this.showError('验证失败', '名称没有变化');
            return;
        }

        try {
            // 🔧 关键修复：根据类型请求不同接口
            let url, method = 'POST';

            if (this.currentRenameType === 'folder') {
                // 文件夹重命名接口
                url = `/api/cloud/folders/${this.currentRenameId}/rename/`;
            } else {
                // 文件重命名接口
                url = `/api/cloud/files/${this.currentRenameId}/rename/`;
            }

            console.log(`重命名请求：${url}, 类型：${this.currentRenameType}`);

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TokenManager.getToken()}`
                },
                body: JSON.stringify({name: newName})
            });
            this.statusCode = response.status;
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || '重命名失败');
            }

            const result = await response.json();
            console.log('重命名成功:', result);

            this.showSuccess('重命名成功', `${this.currentRenameType === 'folder' ? '文件夹' : '文件'}已重命名`);
            this.closeModal('renameModal');

            // 刷新当前列表
            if (this.currentView === 'files') {
                await this.loadFiles(this.currentFolderId);
            } else if (this.currentView === 'trash') {
                await this.loadTrash();
            } else if (this.currentView === 'shared-folders') {
                await this.loadSharedFolders(this.currentFolderId);
            } else {
                await this.loadFiles(null);
            }

        } catch (error) {
            console.error('重命名失败:', error);
            this.showError('重命名失败', error.message);
        }
    },


    /**
     * 计算移动时「不可选择」的文件夹集合：被移动的文件夹自身 + 其所有子孙文件夹。
     * 用于在移动树的 UI 上直接置灰，避免用户选中非法目标后再被后端拒绝（提升体验）。
     * @param {Array} nodes 文件夹树节点（含 children）
     * @param {Array} movingIds 正在移动的 ID 列表（文件 ID 不会命中树节点，自动忽略）
     * @returns {Set<string>}
     */
    _collectForbiddenMoveTargets(nodes, movingIds) {
        const movingSet = new Set((movingIds || []).map(id => String(id)));
        const forbidden = new Set();
        const markSubtree = (node) => {
            if (!node) return;
            forbidden.add(String(node.id));
            (node.children || []).forEach(markSubtree);
        };
        const walk = (list) => {
            (list || []).forEach(node => {
                if (movingSet.has(String(node.id))) markSubtree(node);
                if (node.children && node.children.length) walk(node.children);
            });
        };
        walk(nodes);
        return forbidden;
    },

    /**
     * 🔧 关键修复：移动文件/文件夹
     * @param {Array} itemIds - 要移动的 ID 列表
     * @param {boolean} isFolder - 是否为文件夹
     */
    async moveItems(itemIds, isFolder = false, sourceName = '') {
        this.currentMoveIds = itemIds;
        this.currentMoveType = isFolder ? 'folder' : 'file';
        await this.loadFolderTree();
        this.openModal('moveModal', sourceName);
    },


    async moveFiles(fileIds, sourceName = '') {
        this.currentMoveIds = fileIds;
        await this.loadFolderTree();
        this.openModal('moveModal', sourceName);
    },


    /**
     * 🔧 关键修复：加载文件夹树（递归加载所有层级）
     */
    async loadFolderTree() {
        try {
            // 🔧 使用 tree 接口获取所有文件夹的树状结构
            const response = await fetch('/api/cloud/folders/tree/', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载文件夹失败');

            const data = await response.json();
            const treeContainer = document.getElementById('folderTree');

            // 🔧 计算不可选择的文件夹：被移动的文件夹自身 + 其所有子文件夹。
            // 直接置灰不可选，比让用户选中后再报错更友好（后端仍保留循环引用校验作为兜底）。
            const movingFolderIds = (this.currentMoveType === 'folder') ? (this.currentMoveIds || []) : [];
            const forbidden = this._collectForbiddenMoveTargets(data.folders || [], movingFolderIds);

            // 🔧 递归渲染树状结构
            const renderTree = (nodes, level = 0) => {
                let html = '';

                nodes.forEach(node => {
                    const indent = level * 20;
                    const hasChildren = node.children && node.children.length > 0;
                    const isSharedFolder = node.is_shared_folder;
                    const isCurrentFolder = node.id === this.currentFolderId;
                    const isForbidden = forbidden.has(String(node.id));
                    const backgroundColor = isCurrentFolder ? '#f0f0f0' : '';
                    const iconColor = isSharedFolder ? '#E6A23C' : '#409EFF';
                    const avatar = node.owner?.avatar || '/static/images/default-avatar.png';
                    const ownerName = node.owner?.real_name || node.owner?.username || '未知';
                    const itemTitle = isForbidden
                        ? '不可选择：它是被移动文件夹自身或其子文件夹'
                        : (isSharedFolder ? '共享文件夹 - ' + node.name : '我的文件夹 - ' + node.name);

                    html += `
                        <div class="folder-tree-item${isForbidden ? ' disabled' : ''}" title="${this.escapeHtml(itemTitle)}" data-folder-id="${node.id}" ${isForbidden ? 'data-forbidden="1"' : ''} style="padding-left: ${indent + 15}px; background-color: ${backgroundColor};">
                            <i class="fas fa-folder${hasChildren ? '-open' : ''}" style="color: ${iconColor}"></i>
                            <span>${node.name}</span>
                            ${isForbidden ? '<span class="badge badge-forbidden" title="不可选择"><i class="fas fa-ban"></i></span>' : ''}
                            ${isSharedFolder ? `<div class="badge" title="共享文件夹 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>` : ''}
                            ${isCurrentFolder ? '<span class="badge badge-current" title="当前文件夹" style="color: lightseagreen; font-size:12px">当前文件夹</span>' : ''}
                        </div>
                    `;

                    // 🔧 递归渲染子文件夹
                    if (hasChildren) {
                        html += renderTree(node.children, level + 1);
                    }
                });

                return html;
            };

            let html = '';
            if (forbidden.size > 0) {
                html += '<div class="folder-tree-hint"><i class="fas fa-info-circle"></i> '
                    + '灰色文件夹不可选择（被移动文件夹自身或其子文件夹）</div>';
            }
            html += `
                <div class="folder-tree-item" data-folder-id="">
                    <i class="fas fa-folder" style="color: #409EFF"></i>
                    <span>根目录</span>
                </div>
            `;

            if (data.folders && data.folders.length > 0) {
                html += renderTree(data.folders);
            }

            treeContainer.innerHTML = html;

            // 绑定选择事件
            treeContainer.querySelectorAll('.folder-tree-item').forEach(item => {
                item.addEventListener('click', () => {
                    // 自身/子文件夹不可选：给出明确提示，而不是让用户选中后再报错
                    if (item.dataset.forbidden === '1') {
                        this.showToast('该文件夹不可选择：它是被移动文件夹自身或其子文件夹', 'error');
                        return;
                    }
                    treeContainer.querySelectorAll('.folder-tree-item').forEach(i =>
                        i.classList.remove('selected')
                    );
                    item.classList.add('selected');
                });
            });

        } catch (error) {
            console.error('加载文件夹树失败:', error);
            this.showError('加载失败', error);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        }
    },

    /**
     * 🔧 关键修复：确认移动（区分文件和文件夹）
     */
    async confirmMove() {
        const selectedFolder = document.querySelector('#folderTree .folder-tree-item.selected');
        if (!selectedFolder) {
            this.showError('错误', '请选择目标文件夹');
            return;
        }

        const targetFolderId = selectedFolder.dataset.folderId || null;

        try {
            // 🔧 根据类型调用不同接口
            if (this.currentMoveType === 'folder') {
                // 文件夹移动
                for (const folderId of this.currentMoveIds) {
                    let response = await fetch(`/api/cloud/folders/${folderId}/move/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TokenManager.getToken()}`
                        },
                        body: JSON.stringify({new_parent: targetFolderId})
                    });
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || error.detail || error.message || '移动失败')
                    }
                }
            } else {
                // 文件移动
                for (const fileId of this.currentMoveIds) {
                    let response = await fetch(`/api/cloud/files/${fileId}/move/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TokenManager.getToken()}`
                        },
                        body: JSON.stringify({target_folder_id: targetFolderId})
                    });
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || error.detail || error.message || '移动失败')
                    }
                }
            }

            this.showSuccess('移动成功', '文件/文件夹已移动');
            this.closeModal('moveModal');

            // 刷新当前列表
            if (this.currentView === 'files') {
                await this.loadFiles(this.currentFolderId);
            } else if (this.currentView === 'trash') {
                await this.loadTrash();
            } else if (this.currentView === 'shared-folders') {
                await this.loadSharedFolders(this.currentFolderId);
            } else {
                await this.loadFiles(null);
            }

        } catch (error) {
            console.error('移动失败:', error);
            this.showError('移动失败', error.message);
        }
    },


    // ==================== 搜索/统计 ====================

    async searchFiles(keyword) {
        if (!keyword.trim()) {
            await this.loadFiles(this.currentFolderId);
            return;
        }

        try {
            const response = await fetch(`/api/cloud/files/?search=${encodeURIComponent(keyword)}`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('搜索失败');

            const data = await response.json();
            const fileList = Array.isArray(data.results) ? data.results : data;
            this.renderFiles(fileList);
        } catch (error) {
            console.error('搜索失败:', error);
        }
    },

    async loadDashboardStats() {
        try {
            const response = await fetch('/api/cloud/dashboard/overview/', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载统计失败');

            const stats = await response.json();
            this.renderDashboard(stats);
            this.renderOverview(stats);
        } catch (error) {
            console.error('加载统计失败:', error);
            document.getElementById('dashboardStatsContent').innerHTML =
                `<div class="empty-state"><p>加载失败：${error.message}</p></div>`;
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        }
    },

    renderDashboard(stats) {
        const container = document.getElementById('dashboardStatsContent');

        const html = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-file"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.total_count}</div>
                        <div class="stat-label">文件总数</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-hdd"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.total_size_formatted}</div>
                        <div class="stat-label">已用空间</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-database"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.storage_quota_formatted}</div>
                        <div class="stat-label">总配额</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-percentage"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.storage_used_percent}%</div>
                        <div class="stat-label">使用率</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-star"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.starred_count}</div>
                        <div class="stat-label">星标文件</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-share-alt"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.shared_count}</div>
                        <div class="stat-label">我的分享</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-users"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.collab_count}</div>
                        <div class="stat-label">协作文档</div>
                    </div>
                </div>
            </div>
            
            <div class="recent-files-section">
                
                <h4>最近上传的文件</h4>
                <div class="file-list-simple">
                    ${stats.recent_files?.map(f => `
                        <div class="simple-file-item">
                            <i class="fas ${f.icon_class}"></i>
                            <span class="stat-name">${f.name}</span>
                            <span class="stat-meta">${this.formatDate(f.created_at)}</span>
                        </div>
                    `).join('') || ''}
                </div>
               
            </div>
            
            <div class="recent-files-section">
                
                <h4>最近分享的文件</h4>
                <div class="file-list-simple">
                    ${stats.recent_shares?.map(f => `
                        <div class="simple-file-item">
                            <i class="fas ${f.file_info?.icon_class}"></i>
                            <span class="stat-name">${f.file_info?.name}</span>
                            <span class="stat-meta">${this.formatDate(f.created_at)}</span>
                        </div>
                    `).join('') || ''}
                </div>
            </div>
            
        `;

        container.innerHTML = html;
    },

    renderOverview(data) {
        document.getElementById('storageUsed').style.width = `${data.storage_used_percent}%`;
        document.getElementById('storageText').textContent =
            `${data.total_size_formatted} / ${data.storage_quota_formatted}`;

        // this.updateCollabCount(data.collab_count);
        this.updateCount(data.total_count, 'files')
        this.updateCount(data.shared_count, 'shared')
        this.updateCount(data.collab_count, 'collaborations')
        this.updateCount(data.trash_count, 'trash')
        this.updateCount(data.starred_count, 'starred')

    },

    // ==================== 操作日志功能 ====================

    async loadOperationLogs(page = 1) {
        const container = document.getElementById('logListContainer');
        const pagination = document.getElementById('paginationContainerLogs');
        const searchInput = document.getElementById('logSearchInput');
        const operationFilter = document.getElementById('logOperationFilter');

        try {
            const search = searchInput ? encodeURIComponent(searchInput.value.trim()) : '';
            const operation = operationFilter ? operationFilter.value : '';
            let url = `/api/cloud/operation-logs/?page=${page}&page_size=20`;
            if (search) url += `&search=${search}`;
            if (operation) url += `&operation=${operation}`;

            const response = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!response.ok) throw new Error('加载操作日志失败');
            const rawData = await response.json();
            const data = window.EncryptUtils.decryptPacket(rawData);

            this.renderOperationLogs(data, container);
            this.renderLogPagination(data, pagination);
        } catch (error) {
            console.error('加载操作日志失败:', error);
            container.innerHTML = `<div class="empty-state"><i class="fas fa-history"></i><p>${error.message}</p></div>`;
            pagination.style.display = 'none';
        }
    },

    renderOperationLogs(data, container) {
        const logs = data.results || [];
        if (logs.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>暂无操作日志</p></div>';
            return;
        }

        let html = '<div class="log-list">';
        logs.forEach(log => {
            const date = new Date(log.created_at);
            const dateStr = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
            const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const avatar = log.user_avatar || '/static/images/default-avatar.png';
            const isDocAndEditable = log.is_document && log.cloud_file_id;
            const fileLink = isDocAndEditable
                ? `<a href="/cloud/editor/?id=${log.cloud_file_id}" target="_blank" class="log-file-link" title="点击在线编辑"><i class="fas fa-edit"></i> ${this.escapeHtml(log.file_name)}</a>`
                : log.file_name
                    ? `<span class="log-file-name"><i class="fas fa-file"></i> ${this.escapeHtml(log.file_name)}</span>`
                    : '<span class="text-muted">-</span>';

            html += `
            <div class="log-item">
                <div class="log-icon-wrapper">
                    <img src="${avatar}" alt="头像" class="log-avatar" onerror="this.src='/static/images/default-avatar.png'">
                </div>
                <div class="log-content">
                    <div class="log-header">
                        <span class="log-user">${this.escapeHtml(log.user_name)}</span>
                        <span class="log-time" title="${dateStr} ${timeStr}">${dateStr} ${timeStr}</span>
                    </div>
                    <div class="log-body">
                        <span class="log-description">${this.escapeHtml(log.description || log.operation_display)}</span>
                        <span class="log-operation-badge log-op-${log.operation}">${log.operation_display}</span>
                    </div>
                    <div class="log-file-row">${fileLink}</div>
                </div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    },

    renderLogPagination(data, container) {
        const page = data.page || 1;
        const total = data.total_pages || 0;
        this._logPagination = {page, total};

        if (!total || total <= 1) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        let html = `<div class="pagination-wrapper"><div class="pagination-info">共 ${data.count} 条，第 ${page}/${total} 页</div><div class="pagination-controls">`;
        html += `<button class="pagination-btn" title="首页" onclick="cloudApp.loadOperationLogs(1)" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-angle-double-left"></i></button>`;
        html += `<button class="pagination-btn" title="上一页" onclick="cloudApp.loadOperationLogs(${page - 1})" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-angle-left"></i></button>`;
        const startPage = Math.max(1, page - 2);
        const endPage = Math.min(total, page + 2);
        if (startPage > 1) {
            html += `<button class="pagination-btn" onclick="cloudApp.loadOperationLogs(1)">1</button>`;
            if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
        }
        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="cloudApp.loadOperationLogs(${i})">${i}</button>`;
        }
        if (endPage < total) {
            if (endPage < total - 1) html += `<span class="pagination-ellipsis">...</span>`;
            html += `<button class="pagination-btn" onclick="cloudApp.loadOperationLogs(${total})">${total}</button>`;
        }
        html += `<button class="pagination-btn" title="下一页" onclick="cloudApp.loadOperationLogs(${page + 1})" ${page >= total ? 'disabled' : ''}><i class="fas fa-angle-right"></i></button>`;
        html += `<button class="pagination-btn" title="末页" onclick="cloudApp.loadOperationLogs(${total})" ${page >= total ? 'disabled' : ''}><i class="fas fa-angle-double-right"></i></button>`;
        html += `<span class="pagination-jump">跳至 <input type="number" min="1" max="${total}" value="${page}" id="logPageJumpInput" onkeydown="if(event.key==='Enter'){event.preventDefault();cloudApp.jumpToLogPage(this.value);}"> 页`;
        html += `<button class="pagination-btn" title="跳转" onclick="cloudApp.jumpToLogPage(document.getElementById('logPageJumpInput').value)">确定</button></span>`;
        html += '</div></div>';
        container.innerHTML = html;
    },

    jumpToLogPage(value) {
        const pag = this._logPagination || {page: 1, total: 1};
        let page = parseInt(value, 10);
        if (!Number.isFinite(page)) return;
        page = Math.max(1, Math.min(page, pag.total || 1));
        this.loadOperationLogs(page);
    },

    searchLogs(keyword) {
        clearTimeout(this._logSearchTimer);
        this._logSearchTimer = setTimeout(() => {
            this.loadOperationLogs(1);
        }, 300);
    },

    filterLogsByOperation(operation) {
        this.loadOperationLogs(1);
    },

    /**
     * 🔧 同步聊天室文档到网盘
     */
    async syncChatDocuments() {
        // 1. 二次确认提示
        const confirmed = await this.showConfirmDialog(
            '同步聊天室文档',
            '确定要将聊天室中未同步的文档同步到企业网盘吗？<br><small style="color: var(--text-light);">系统将在根目录自动创建/维护“文档（来自聊天室）”文件夹</small>',
            'confirm'
        );
        if (!confirmed) return;

        try {
            // 2. 显示全局加载遮罩
            this.showLoading('正在扫描并同步聊天室文档，请稍候...');

            // 3. 调用后端同步接口
            const response = await fetch('/api/cloud/files/sync_file_from_chat/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders() // 复用现有鉴权逻辑
                },
                body: JSON.stringify({}) // 后端已自动处理，无需传参
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.detail || '同步请求失败');
            }

            const result = await response.json();
            const stats = result.stats || {};

            // 4. 解析并展示同步结果
            const successCount = stats.sync_success || 0;
            const skipCount = stats.skipped_invalid || 0;
            const errorCount = typeof stats.errors === 'number' ? stats.errors : (stats.errors?.length || 0);

            let message = `成功同步 ${successCount} 个文件`;
            if (skipCount > 0) message += `，跳过 ${skipCount} 个`;
            if (errorCount > 0) message += `，失败 ${errorCount} 个`;

            this.showSuccess('同步完成', message);

            // 5. 自动刷新当前视图
            if (this.currentView === 'files') {
                await this.loadFiles(this.currentFolderId);
            } else if (this.currentView === 'trash') {
                await this.loadTrash();
            } else if (this.currentView === 'shared-folders') {
                await this.loadSharedFolders(this.currentFolderId);
            } else {
                await this.loadFiles(null);
            }

        } catch (error) {
            console.error('同步聊天室文档失败:', error);
            this.showError('同步失败', error.message || '网络异常或接口请求失败');
        } finally {
            // 6. 无论成功失败，均关闭加载状态
            this.hideLoading();
        }
    },


    // ==================== 系统配置 ====================

    async loadSystemConfigs() {
        try {
            await frontendCloudConfig?.loadConfigs?.();
            this.applyFrontendConfigs();
            // 🔧 自定义操作权限：当前用户生效的 allow_download 也启用下载（含全局 system.download_enabled）
            try {
                const resp = await fetch('/api/cloud/settings/effective-permission/?perm=allow_download', {
                    headers: TokenManager.getHeaders()
                });
                if (resp.ok) {
                    const d = await resp.json();
                    if (d && d.allowed) this.downloadEnabled = true;
                }
            } catch (e) {}
            console.log('✅ 系统配置已应用');
        } catch (error) {
            console.warn('⚠️ 加载系统配置失败，使用默认值:', error);
            this.applyFrontendConfigs();
        }
    },

    /**
     * 🔧 应用前端配置到本地属性
     */
    applyFrontendConfigs() {
        this.fileMaxSizeMB = frontendCloudConfig.get('upload.max_file_size_mb', 50);
        this.imageMaxSizeMB = frontendCloudConfig.get('upload.image_max_size_mb', 20);
        this.videoMaxSizeMB = frontendCloudConfig.get('upload.video_max_size_mb', 100);
        this.audioMaxSizeMB = frontendCloudConfig.get('upload.audio_max_size_mb', 30);
        this.allowedFileTypes = frontendCloudConfig.get('upload.allowed_types', ['image', 'video', 'audio', 'file']);
        this.storageQuotaGB = frontendCloudConfig.get('storage.quota_gb', 10);
        this.downloadEnabled = frontendCloudConfig.get('system.download_enabled', false);
        this.defaultExpireDays = frontendCloudConfig?.get('share.default_expire_days', 7);
        this.defaultMaxDownloads = frontendCloudConfig?.get('share.max_downloads', 0);

        // 更新页面标题
        const cloudName = frontendCloudConfig.getCloudName();
        document.title = `${cloudName} - 企业文件管理`;

        // 更新 Logo
        const logoUrl = frontendCloudConfig.get('cloud.logo_url');
        if (logoUrl) {
            const logo = document.getElementById('cloudLogo');
            if (logo) logo.src = logoUrl;
        }
    },
    });
})();
