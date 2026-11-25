// static/js/cloud-files.js - 数据加载、文件列表渲染、批量操作、预览与下载
// 说明：本文件为 CloudApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(CloudApp.prototype, {


    // ==================== 数据加载 ====================

    async loadDashboard() {
        try {
            const response = await fetch('/api/cloud/dashboard/overview/', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载仪表盘失败');

            const data = await response.json();
            this.renderOverview(data);

        } catch (error) {
            console.error('加载仪表盘失败:', error);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        }
    },

    /**
     * 加载文件列表
     * @param {string|null} folderId - 文件夹 ID
     * @param {Object} filters - 额外过滤参数
     */
    async loadFiles_v1(folderId = null, filters = {}) {
        try {
            this.showLoading();

            const params = new URLSearchParams();
            if (folderId) params.append('folder', folderId);
            if (filters.starred) params.append('starred', 'true');
            if (filters.trash) params.append('trash', 'true');

            const response = await fetch(`/api/cloud/files/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载文件列表失败');

            const data = await response.json();
            const fileList = Array.isArray(data.results) ? data.results : data;

            // 🔧 保存最后加载的数据（用于视图模式切换时重渲染）
            this.lastLoadedFiles = fileList;

            this.renderFiles(fileList);

        } catch (error) {
            console.error('加载文件失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    },


    /**
     * 🔧 关键修复：加载文件列表，支持分页和搜索
     * @param {string|null} folderId - 文件夹 ID
     * @param {Object} filters - 额外过滤参数
     */
    async loadFiles(folderId = null, filters = {}) {
        try {
            this.showLoading();

            // 🔧 如果文件夹改变，重置到第一页
            if (folderId !== this.lastFolderId) {
                this.pagination.files.page = 1;
                this.lastFolderId = folderId;
            }

            // 构建查询参数
            const params = new URLSearchParams();

            // 文件夹参数
            if (folderId) {
                params.append('folder', folderId);
            }

            // 🔧 分页参数
            params.append('page', this.pagination.files.page);
            params.append('page_size', this.pagination.files.pageSize);

            // 🔧 搜索参数
            const searchValue = document.getElementById('fileSearch')?.value?.trim();
            if (searchValue) {
                params.append('search', searchValue);
            }

            // 星标过滤
            if (filters.starred) {
                params.append('starred', 'true');
            }

            console.log(`🔍 加载文件列表: page=${this.pagination.files.page}, folder=${folderId}, search=${searchValue}`);

            const response = await fetch(`/api/cloud/files/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || '加载文件列表失败');
            }

            const data = await response.json();

            // 🔧 处理分页响应
            const fileList = Array.isArray(data.results) ? data.results : (Array.isArray(data) ? data : []);

            this.pagination.files.count = data.count || fileList.length || 0;
            this.pagination.files.next = data.next || null;
            this.pagination.files.previous = data.previous || null;

            // 🔧 保存最后加载的数据
            this.lastLoadedFiles = fileList;

            console.log(`✅ 文件列表加载完成: ${fileList.length} 项, 总计 ${this.pagination.files.count} 项`);

            // 渲染文件列表
            this.renderFiles(fileList);

            // 渲染分页
            this.renderPagination('files');

        } catch (error) {
            console.error('❌ 加载文件失败:', error);
            this.showError('加载失败', error);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        } finally {
            this.hideLoading();
        }
    },

    /**
     * 🔧 按文件类型生成图标/缩略图（图片可用缩略图，其余按类型着色），与网盘选择器一致
     */
    _typedIconHtml(item, size) {
        size = size || 18;
        const name = String((item && (item.original_name || item.name)) || '');
        const mime = String((item && item.mime_type) || '').toLowerCase();
        const ext = name.lastIndexOf('.') > -1 ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : '';
        const isImg = !!(item && (item.is_image || (mime && mime.indexOf('image/') === 0)
            || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].indexOf(ext) > -1));
        const isVid = !!(item && (item.is_video || (mime && mime.indexOf('video/') === 0)
            || ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'webm', 'flv', 'm4v'].indexOf(ext) > -1));
        const isPdf = ext === 'pdf' || (item && item.document_type === 'pdf') || mime === 'application/pdf';
        const isWord = ['doc', 'docx', 'rtf'].indexOf(ext) > -1 || (mime && mime.indexOf('word') > -1);
        const isExcel = ['xls', 'xlsx', 'csv', 'et'].indexOf(ext) > -1 || (mime && (mime.indexOf('excel') > -1 || mime.indexOf('spreadsheet') > -1));
        const isPpt = ['ppt', 'pptx'].indexOf(ext) > -1 || (mime && mime.indexOf('presentation') > -1);
        const isAudio = !!(item && (item.is_audio || (mime && mime.indexOf('audio/') === 0)
            || ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'amr'].indexOf(ext) > -1));
        const isZip = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].indexOf(ext) > -1
            || (mime && (mime.indexOf('zip') > -1 || mime.indexOf('compressed') > -1));
        const isText = ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml'].indexOf(ext) > -1
            || (mime && mime.indexOf('text/') === 0);
        let cls = 'fa-file', color = '#909399';
        if (isImg) { cls = 'fa-image'; color = '#67c23a'; }
        else if (isPdf) { cls = 'fa-file-pdf'; color = '#f56c6c'; }
        else if (isWord) { cls = 'fa-file-word'; color = '#409eff'; }
        else if (isExcel) { cls = 'fa-file-excel'; color = '#16a085'; }
        else if (isPpt) { cls = 'fa-file-powerpoint'; color = '#e6a23c'; }
        else if (isVid) { cls = 'fa-video'; color = '#9b59b6'; }
        else if (isAudio) { cls = 'fa-music'; color = '#00a1ff'; }
        else if (isZip) { cls = 'fa-file-archive'; color = '#b7791f'; }
        else if (isText) { cls = 'fa-file-alt'; color = '#909399'; }
        if (isImg && item && item.file_url && size > 24) {
            return '<img src="' + this.escapeHtml(item.file_url) + '" style="width:' + size + 'px;height:' + size + 'px;border-radius:4px;object-fit:cover;vertical-align:middle;" alt="' + this.escapeHtml(item.name || '') + '">';
        }
        const w = Math.max(size, 22);
        return '<i class="fas ' + cls + '" style="color:' + color + ';font-size:' + size + 'px;width:' + w + 'px;text-align:center;vertical-align:middle;"></i>';
    },

    /**
     * 渲染文件列表（支持列表/网格视图）（增强版 - 标识共享文件夹）
     */
    renderFiles(data) {
        const listBody = document.getElementById('fileListBody');
        const gridBody = document.getElementById('fileGridBody');

        const batchBar = document.getElementById('batchOperationBar');

        // 空状态
        if (!data || data.length === 0) {
            const emptyHtml = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>${this.getEmptyText()}</p>
                    ${this.currentView === 'files' ? `
                        <button class="btn btn-primary" onclick="cloudApp.openModal('uploadModal')">
                            <i class="fas fa-upload"></i> 上传文件
                        </button>
                    ` : ''}
                </div>
            `;
            if (listBody) listBody.innerHTML = emptyHtml;
            if (gridBody) gridBody.innerHTML = emptyHtml;
            // 隐藏批量操作栏
            if (batchBar) batchBar.style.display = 'none';
            return;
        }

        // 🔧 排序：文件夹在前，按修改时间倒序排序（新的在前）
        data.sort((a, b) => {
            // 1. 文件夹优先于文件
            if (a.is_folder && !b.is_folder) return -1;
            if (!a.is_folder && b.is_folder) return 1;

            // 2. 同类型之间，按更新时间倒序排列（最新的在前）
            const dateA = new Date(a.updated_at || a.created_at).getTime();
            const dateB = new Date(b.updated_at || b.created_at).getTime();
            return dateB - dateA;
        });

        // 🔧 列表视图渲染
        if (listBody) {
            let html = '';
            data.forEach(file => {
                const isFolder = file.is_folder;
                const isDocument = file.is_document
                const isImage = file.is_image || (file.mime_type && file.mime_type.startsWith('image/'));
                const isVideo = file.is_video || (file.mime_type && file.mime_type.startsWith('video/'));
                const isPdf = file.document_type === 'pdf' || (file.mime_type && file.mime_type.startsWith('application/pdf'));
                const isSelected = this.selectedFiles.has(String(file.id));
                const isDownload = this.downloadEnabled || window.frontendCloudConfig?.get('system.download_enabled', false)

                // 🔧 新增：检查是否为共享文件夹
                const isSharedFolder = isFolder && file.is_shared_folder;
                const folderColor = isSharedFolder ? '#E6A23C' : '#409EFF';

                const avatar = file.owner?.avatar || '/static/images/default-avatar.png';
                const ownerName = file.owner?.real_name || file.owner?.username || '未知';

                html += `
                    <div class="file-item ${isFolder ? 'is-folder' : ''} ${isSelected ? 'selected' : ''}" 
                         data-file-id="${file.id}" 
                         data-is-folder="${isFolder}"
                         ondblclick="cloudApp.handleItemDoubleClick('${file.id}', ${isFolder}, ${isDocument})"
                         oncontextmenu="cloudApp.handleContextMenu(event, '${file.id}', ${isFolder}, '${file.name}')" title="${file.name}">
                        <div class="file-col name">
                            <!-- 🔧 关键修复：添加复选框 -->
                            <input type="checkbox" 
                                   class="file-checkbox" 
                                   data-file-id="${file.id}"
                                   ${isSelected ? 'checked' : ''}
                                   onchange="cloudApp.toggleFileSelection('${file.id}', this.checked)">
                            ${isFolder
                                ? `<i class="fas fa-folder" style="color: ${folderColor}"></i>`
                                : this._typedIconHtml(file, 18)}
                            <span class="file-name">${this.escapeHtml(file.name)}</span>
        
                            ${isSharedFolder ? `<div class="badge" title="共享文件夹 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>` : ''}
                        </div>
                        <div class="file-col size">${isFolder ? '-' : (file.size_formatted || '-')}</div>
                        <div class="file-col date">${this.formatDate(file.updated_at || file.created_at)}</div>
                        <div class="file-col actions">
                            ${!isFolder ? isImage || isVideo || isPdf ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.previewFile('${file.id}')" title="预览">
                                    <i class="fas fa-eye"></i>
                                </button>
                            ` : `` : `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.handleItemDoubleClick('${file.id}', true)" title="打开">
                                    <i class="fas fa-folder-open"></i>
                                </button>
                            `}
                            
                            ${isFolder ? isDownload ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFolder('${file.id}', '${this.escapeHtml(file.name)}')" title="下载文件夹">
                                    <i class="fas fa-download"></i>
                                </button>
                            ` : `` : isDownload ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFile('${file.id}')" title="下载">
                                    <i class="fas fa-download"></i>
                                </button>
                            ` : ``}
                            
                           
                            ${!isFolder && file.is_document ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.editDocument('${file.id}')" title="在线编辑">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn-action" 
                                        onclick="cloudApp.openCreateCollabDocModal('${file.id}', '${file.name}')" 
                                        title="创建协作文档"
                                        data-file-id="${file.id}"
                                        data-file-name="${file.name}">
                                    <i class="fas fa-users-cog"></i>
                                </button>
                            ` : ''}
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${file.id}', ${isFolder}, '${this.escapeHtml(file.name)}')" title="分享">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.renameFile('${file.id}', '${this.escapeHtml(file.name)}', ${isFolder})" title="重命名">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${file.id}'], ${isFolder}, '${this.escapeHtml(file.name)}')" title="移动">
                                <i class="fas fa-cut"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${file.id}', ${isFolder}, '${this.escapeHtml(file.name)}')" title="删除">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            listBody.innerHTML = html;


            // 绑定复选框事件
            listBody.querySelectorAll('.file-checkbox').forEach(cb => {
                cb.onchange = (e) => {
                    // 🔧 使用可选链 + 空值检查
                    const fileId = e.target?.dataset?.fileId;
                    if (fileId) {
                        this.toggleFileSelection(fileId, e.target.checked);
                    } else {
                        console.warn('复选框缺少 data-file-id 属性', e.target);
                    }
                };
            });
        }

        // 🔧 网格视图渲染
        if (gridBody) {
            let html = '';
            data.forEach(file => {
                const isFolder = file.is_folder;
                const isSelected = this.selectedFiles.has(String(file.id));
                const isDocument = file.is_document
                const isImage = file.is_image || (file.mime_type && file.mime_type.startsWith('image/'));
                const isVideo = file.is_video || (file.mime_type && file.mime_type.startsWith('video/'));
                const isPdf = file.document_type === 'pdf' || (file.mime_type && file.mime_type.startsWith('application/pdf'));
                const tagType = isImage ? 'img' : isVideo ? 'video' : 'file';
                const isDownload = this.downloadEnabled || window.frontendCloudConfig?.get('system.download_enabled', false)

                // 🔧 新增：检查是否为共享文件夹
                const isSharedFolder = isFolder && file.is_shared_folder;
                const folderColor = isSharedFolder ? '#E6A23C' : '#409EFF';
                const avatar = file.owner?.avatar || '/static/images/default-avatar.png';
                const ownerName = file.owner?.real_name || file.owner?.username || '未知';

                // 🔧 关键修复：图片和视频显示缩略图
                const thumbnailHtml = (isImage || isVideo) && !isFolder ? `
                    <div class="file-thumbnail">
                        <${tagType} src="${file.file_url}" alt="${file.name}" title="${file.name}" style="width:100%;height:100%;object-fit:cover;" />
                    </div>
                ` : `
                    <div class="file-icon">
                        ${isFolder
                            ? `<i class="fas fa-folder folder" style="color: ${folderColor}"></i>`
                            : this._typedIconHtml(file, 48)}

                        ${isSharedFolder ? `<div class="badge badge-corner" title="共享文件夹 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>` : ''}
                    </div>
                `;


                html += `
                    <div class="file-grid-item ${isFolder ? 'is-folder' : ''} ${isSelected ? 'selected' : ''}" 
                         data-file-id="${file.id}" 
                         data-is-folder="${isFolder}"
                         ondblclick="cloudApp.handleItemDoubleClick('${file.id}', ${isFolder}, ${isDocument})"
                         oncontextmenu="cloudApp.handleContextMenu(event, '${file.id}', ${isFolder}, '${file.name}')" title="${file.name}">
                         <!-- 🔧 网格视图的复选框（悬停显示） -->
                        <div class="file-checkbox-overlay">
                            <input type="checkbox" 
                                   class="file-checkbox" 
                                   data-file-id="${file.id}"
                                   ${isSelected ? 'checked' : ''}
                                   onchange="cloudApp.toggleFileSelection('${file.id}', this.checked)">
                        </div>
                        ${thumbnailHtml}
                        <div class="file-name" onclick="cloudApp.handleItemClick('${file.id}', ${isFolder})">
                            ${this.escapeHtml(file.name)}
                        </div>
                        <div class="file-size">${isFolder ? '' : (file.size_formatted || '')}</div>
                        <div class="file-date">${this.formatDate(file.updated_at || file.created_at)}</div>
                        <div class="file-actions">
                        
                            ${!isFolder ? isImage || isVideo || isPdf ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.previewFile('${file.id}')" title="预览">
                                    <i class="fas fa-eye"></i>
                                </button>
                            ` : `` : `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.handleItemDoubleClick('${file.id}', true)" title="打开">
                                    <i class="fas fa-folder-open"></i>
                                </button>
                            `}
                            
                            ${isFolder ? isDownload ? `
                                <button class="btn-action" class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFolder('${file.id}', '${this.escapeHtml(file.name)}')" title="下载文件夹">
                                    <i class="fas fa-download"></i>
                                </button>
                            ` : `` : isDownload ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFile('${file.id}')" title="下载">
                                    <i class="fas fa-download"></i>
                                </button>
                            ` : ``}
                            
                            ${!isFolder && file.is_document ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.editDocument('${file.id}')" title="在线编辑">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn-action" 
                                        onclick="cloudApp.openCreateCollabDocModal('${file.id}', '${file.name}')" 
                                        title="创建协作文档"
                                        data-file-id="${file.id}"
                                        data-file-name="${file.name}">
                                    <i class="fas fa-users-cog"></i>
                                </button>
                            ` : ''}
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${file.id}', ${isFolder}, '${this.escapeHtml(file.name)}')" title="分享">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${file.id}'], ${isFolder}, '${this.escapeHtml(file.name)}')" title="移动">
                                <i class="fas fa-cut"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${file.id}', ${isFolder}, '${this.escapeHtml(file.name)}')" title="删除">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            gridBody.innerHTML = html;
        }
        // 🔧 更新批量操作栏显示
        this.updateBatchOperationBar();
    },


    // cloud.js - 添加批量选择方法

    /**
     * 🔧 切换单个文件的选择状态
     */
    toggleFileSelection(fileId, checked) {
        // 🔧 添加空值检查
        if (!fileId) {
            console.warn('toggleFileSelection: fileId is empty', {fileId, checked});
            return;
        }

        if (checked) {
            this.selectedFiles.add(fileId);
        } else {
            this.selectedFiles.delete(fileId);
            this.selectAllMode = false;
        }
        this.updateBatchOperationBar();
        this.updateFileItemStyle(fileId, checked);
    },

    /**
     * 🔧 更新文件项的选中样式
     */
    updateFileItemStyle(fileId, isSelected) {
        // 只更新卡片/行本身，避免把 selected 类加到复选框、操作按钮上
        const items = document.querySelectorAll(
            `.file-item[data-file-id="${fileId}"], .file-grid-item[data-file-id="${fileId}"]`
        );
        items.forEach(item => {
            if (isSelected) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    },

    /**
     * 🔧 全选/取消全选
     */
    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.file-checkbox');

        checkboxes.forEach(cb => {
            cb.checked = checked;
            const fileId = cb.dataset.fileId;
            if (checked) {
                this.selectedFiles.add(fileId);
                this.updateFileItemStyle(fileId, true);
            } else {
                this.selectedFiles.delete(fileId);
                this.updateFileItemStyle(fileId, false);
            }
        });

        this.selectAllMode = checked;
        this.updateBatchOperationBar();
    },

    /**
     * 🔧 更新批量操作栏显示
     */
    updateBatchOperationBar() {
        const batchBar = document.getElementById('batchOperationBar');
        const selectedCount = document.getElementById('batchSelectedCount');
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const selectAllCheckboxHeader = document.getElementById('selectAllCheckboxHeader');

        if (!batchBar) return;

        const count = this.selectedFiles.size;

        if (count > 0) {
            // 显示批量操作栏
            batchBar.style.display = 'flex';
            if (selectedCount) selectedCount.textContent = `已选择 ${count} 项`;
            if (selectAllCheckbox) selectAllCheckbox.checked = this.selectAllMode;
            if (selectAllCheckboxHeader) selectAllCheckboxHeader.checked = this.selectAllMode;
        } else {
            // 隐藏批量操作栏
            batchBar.style.display = 'none';
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            if (selectAllCheckboxHeader) selectAllCheckboxHeader.checked = false;
            this.selectAllMode = false;
        }
    },

    /**
     * 🔧 批量删除
     */
    async batchDelete() {
        if (this.selectedFiles.size === 0) {
            this.showError('操作失败', '请先选择要删除的文件');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '批量删除',
            `确定要删除选中的 <strong>${this.selectedFiles.size}</strong> 个项目吗？<br>
         <small style="color: var(--text-light);">删除后将移动到回收站，可恢复</small>`,
            'danger'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch('/api/cloud/files/batch_delete/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    file_ids: Array.from(this.selectedFiles)
                })
            });
            this.statusCode = response.status;
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '批量删除失败');
            }

            const result = await response.json();
            this.showSuccess('删除成功', `已成功删除 ${result.deleted_count} 个项目`);

            // 清空选择并刷新列表
            this.clearSelection();
            await this.loadFiles(this.currentFolderId);

        } catch (error) {
            console.error('批量删除失败:', error);
            this.showError('删除失败', error.message);
        } finally {
            this.hideLoading();
        }
    },


    // ==================== 批量移动功能 ====================

    /**
     * 🔧 批量移动（完善版）
     */
    async batchMove() {
        if (this.selectedFiles.size === 0) {
            this.showError('操作失败', '请先选择要移动的文件');
            return;
        }

        // 🔧 保存选中的文件 ID
        this.batchMoveIds = Array.from(this.selectedFiles);

        // 🔧 更新批量移动模态框的计数
        document.getElementById('batchMoveCount').textContent = this.batchMoveIds.length;

        // 🔧 重置目标文件夹
        this.batchMoveTargetFolder = null;
        document.getElementById('batchMoveTargetInfo').style.display = 'none';
        document.getElementById('batchMoveConfirmBtn').disabled = true;

        // 🔧 加载文件夹树
        await this.loadBatchFolderTree();

        // 🔧 打开批量移动模态框
        this.openModal('batchMoveModal');
    },

    /**
     * 🔧 加载批量移动的文件夹树
     */
    async loadBatchFolderTree() {
        const container = document.getElementById('batchFolderTree');
        if (!container) return;

        try {
            // 🔧 使用 tree 接口获取所有文件夹的树状结构
            const response = await fetch('/api/cloud/folders/tree/', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载文件夹失败');

            const data = await response.json();
            const folders = data.folders || [];

            // 🔧 批量移动时同样置灰「被移动的文件夹自身及其子文件夹」
            const forbidden = this._collectForbiddenMoveTargets(folders, this.batchMoveIds || []);

            // 🔧 递归渲染树状结构
            const renderTree = (nodes, level = 0) => {
                let html = '';

                nodes.forEach(node => {
                    const indent = level * 20;
                    const hasChildren = node.children && node.children.length > 0;
                    const isSharedFolder = node.is_shared_folder || false;
                    const isForbidden = forbidden.has(String(node.id));
                    html += `
                        <div class="folder-tree-item${isForbidden ? ' disabled' : ''}"
                             data-folder-id="${node.id}"
                             data-folder-name="${this.escapeHtml(node.name)}"
                             ${isForbidden ? 'data-forbidden="1" title="不可选择：它是被移动文件夹自身或其子文件夹"' : ''}
                             style="padding-left: ${indent + 15}px;">
                            <i class="fas fa-folder${hasChildren ? '-open' : ''}"></i>
                            <span class="folder-name">${this.escapeHtml(node.name)}</span>
                            ${isForbidden ? '<span class="badge badge-forbidden" title="不可选择"><i class="fas fa-ban"></i></span>' : ''}
                            ${isSharedFolder ? '<span class="badge" title="共享文件夹"><i class="fas fa-folder-open"></i></span>' : ''}
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
                <div class="folder-tree-item" data-folder-id="" data-folder-name="根目录">
                    <i class="fas fa-folder"></i>
                    <span class="folder-name">根目录</span>
                </div>
            `;

            if (folders.length > 0) {
                html += renderTree(folders);
            }

            container.innerHTML = html;

            // 🔧 绑定选择事件
            container.querySelectorAll('.folder-tree-item').forEach(item => {
                item.addEventListener('click', () => {
                    if (item.dataset.forbidden === '1') {
                        this.showToast('该文件夹不可选择：它是被移动文件夹自身或其子文件夹', 'error');
                        return;
                    }
                    // 移除其他选中状态
                    container.querySelectorAll('.folder-tree-item').forEach(i =>
                        i.classList.remove('selected')
                    );

                    // 添加当前选中状态
                    item.classList.add('selected');

                    // 🔧 保存目标文件夹
                    this.batchMoveTargetFolder = {
                        id: item.dataset.folderId || null,
                        name: item.dataset.folderName
                    };

                    // 🔧 显示目标文件夹提示
                    const targetInfo = document.getElementById('batchMoveTargetInfo');
                    const targetName = document.getElementById('batchTargetFolderName');
                    if (targetInfo && targetName) {
                        targetName.textContent = this.batchMoveTargetFolder.name;
                        targetInfo.style.display = 'flex';
                    }

                    // 🔧 启用确认按钮
                    document.getElementById('batchMoveConfirmBtn').disabled = false;
                });
            });

        } catch (error) {
            console.error('加载文件夹树失败:', error);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>加载失败</p>
                    <button class="btn btn-sm btn-primary" onclick="cloudApp.loadBatchFolderTree()">
                        <i class="fas fa-sync"></i> 重试
                    </button>
                </div>
            `;
        }
    },

    /**
     * 🔧 确认批量移动
     */
    async confirmBatchMove() {
        if (!this.batchMoveTargetFolder) {
            this.showError('操作失败', '请选择目标文件夹');
            return;
        }

        if (this.batchMoveIds.length === 0) {
            this.showError('操作失败', '没有要移动的文件');
            return;
        }

        // 🔧 显示确认对话框
        const confirmed = await this.showConfirmDialog(
            '批量移动',
            `确定要将选中的 <strong>${this.batchMoveIds.length}</strong> 个项目移动到 "<span class="highlight">${this.batchMoveTargetFolder.name}</span>" 吗？`,
            'confirm'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            // 🔧 调用批量移动接口
            const response = await fetch('/api/cloud/files/batch_move/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    file_ids: this.batchMoveIds,
                    target_folder_id: this.batchMoveTargetFolder.id
                })
            });
            this.statusCode = response.status;
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || '批量移动失败');
            }

            const result = await response.json();

            // 🔧 显示移动结果
            const successCount = result.moved_count || this.batchMoveIds.length;
            const failCount = result.failed_count || 0;

            let message = `成功移动 ${successCount} 个项目`;
            if (failCount > 0) {
                message += `，${failCount} 个失败`;
            }

            this.showSuccess('移动成功', message);

            // 🔧 关闭模态框并刷新列表
            this.closeModal('batchMoveModal');
            this.clearSelection();
            await this.loadFiles(this.currentFolderId);

        } catch (error) {
            console.error('批量移动失败:', error);
            this.showError('移动失败', error.message);
        } finally {
            this.hideLoading();
        }
    },

    /**
     * 🔧 清空批量移动状态
     */
    clearBatchMoveState() {
        this.batchMoveIds = [];
        this.batchMoveTargetFolder = null;

        const container = document.getElementById('batchFolderTree');
        const targetInfo = document.getElementById('batchMoveTargetInfo');
        const confirmBtn = document.getElementById('batchMoveConfirmBtn');

        if (container) container.innerHTML = '';
        if (targetInfo) targetInfo.style.display = 'none';
        if (confirmBtn) confirmBtn.disabled = true;
    },

    // ==================== 修改现有方法 ====================

    /**
     * 🔧 修改：清空所有选择时也清空批量移动状态
     */
    clearSelection() {
        this.selectedFiles.clear();
        this.selectAllMode = false;
        this.updateBatchOperationBar();

        // 🔧 清空批量移动状态
        this.clearBatchMoveState();

        // 更新所有复选框状态
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.checked = false;
        });

        // 移除所有选中样式
        document.querySelectorAll('.file-item.selected, .file-grid-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
    },


    /**
     * 🔧 批量分享
     */
    async batchShare() {
        if (this.selectedFiles.size === 0) {
            this.showError('操作失败', '请先选择要分享的文件');
            return;
        }

        // 批量分享逻辑：逐个创建分享或创建批量分享链接
        // 这里简化为逐个创建
        const confirmed = await this.showConfirmDialog(
            '批量分享',
            `确定要为选中的 <strong>${this.selectedFiles.size}</strong> 个项目创建分享链接吗？`,
            'confirm'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const results = [];
            for (const fileId of this.selectedFiles) {
                const response = await fetch('/api/cloud/shares/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...TokenManager.getHeaders()
                    },
                    body: JSON.stringify({
                        file: fileId,
                        share_type: 'public'
                    })
                });
                this.statusCode = response.status;
                if (response.ok) {
                    const share = await response.json();
                    results.push({
                        name: this.getFileNameById(fileId),
                        url: share.share_url
                    });
                }
            }

            // 显示分享结果
            this.showBatchShareResults(results);
            this.clearSelection();

        } catch (error) {
            console.error('批量分享失败:', error);
            this.showError('分享失败', error.message);
        } finally {
            this.hideLoading();
        }
    },

    /**
     * 🔧 显示批量分享结果
     */
    showBatchShareResults(results) {
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3>批量分享结果</h3>
                <button class="close-btn" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 15px;">成功创建 ${results.length} 个分享链接：</p>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${results.map(r => `
                        <div style="padding: 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(r.name)}</span>
                            <button class="btn btn-sm btn-primary" 
                                    onclick="navigator.clipboard.writeText('${r.url}'); alert('已复制')"
                                    style="margin-left: 10px;">
                                复制链接
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" onclick="this.closest('.modal').remove()">关闭</button>
            </div>
        </div>
    `;
        document.body.appendChild(modal);

        // 点击遮罩关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    },


    /**
     * 🔧 根据文件 ID 获取文件名（用于分享结果展示）
     */
    getFileNameById(fileId) {
        const item = document.querySelector(`[data-file-id="${fileId}"] .file-name`);
        return item?.textContent || '未知文件';
    },


    getEmptyText() {
        const texts = {
            'files': '此文件夹为空',
            'starred': '暂无星标文件',
            'shared': '您还没有创建任何分享',
            'shared-with-me': '还没有人分享文件给您',
            'trash': '回收站为空'
        };
        return texts[this.currentView] || '暂无内容';
    },

    // ==================== 文件交互 ====================

    /**
     * 处理项目单击（选中）
     */
    handleItemClick(fileId, isFolder) {
        if (isFolder) {

            if (this.currentView === 'shared-folders') {
                this.navigateToSharedFolder(fileId);
            } else {
                // 🔧 单击文件夹：在网格视图中也支持进入
                this.navigateToFolder(fileId);
            }


        } else {
            // 文件：切换选中状态
            const item = document.querySelector(`[data-file-id="${fileId}"]`);
            if (item) {
                item.classList.toggle('selected');
                const checkbox = item.querySelector('.file-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.onchange?.(checkbox);
                }
            }
        }
    },

    /**
     * 处理项目双击（打开文件夹或预览文件）
     */
    async handleItemDoubleClick(fileId, isFolder, isDocument) {
        if (isFolder) {
            await this.navigateToFolder(fileId);
        } else {
            if (isDocument) {
                await this.editDocument(fileId);
            } else {
                await this.previewFile(fileId);
            }

        }
    },

    /**
     * 预览文件（图片使用暗色覆盖层+左右导航）
     */
    async previewFile(fileId) {
        try {
            const response = await fetch('/api/cloud/files/' + fileId + '/', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载失败');

            const file = await response.json();

            if (file.is_image) {
                var list = this._cloudImageList();
                var idx = list.findIndex(function(i) { return i.id === fileId; });
                if (idx < 0) { idx = 0; list = [{id: fileId, url: file.file_url, name: file.name}]; }
                if (!list.length) return;
                this._cloudShowImage(idx, list);
            } else if (file.is_video || file.is_document) {
                window.open(file.file_url, '_blank');
            } else {
                this.downloadFile(fileId);
            }
        } catch (error) {
            console.error('预览失败:', error);
            this.showError('预览失败', error.message);
        }
    },

    _cloudImageList() {
        var items = [];
        var viewItems = this.lastLoadedFiles || [];
        for (var i = 0; i < viewItems.length; i++) {
            var f = viewItems[i];
            if (f.is_image && f.id && f.file_url) {
                items.push({id: f.id, url: f.file_url, name: f.name || '图片'});
            }
        }
        if ((!items.length || this.currentView === 'shared-folders') && this.sharedFolderItems) {
            for (var j = 0; j < this.sharedFolderItems.length; j++) {
                var s = this.sharedFolderItems[j];
                if (s.is_image && s.id && s.file_url) {
                    items.push({id: s.id, url: s.file_url, name: s.name || '图片'});
                }
            }
        }
        return items;
    },

    _cloudShowImage(startIdx, list) {
        if (!list || !list.length) return;
        this._cloudImgList = list;
        this._cloudImgIdx = startIdx;
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var pd = list.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="cloudApp._cloudImgClose()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="cloudApp._cloudImgNav(-1)" id="cloudImgPrev" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + pd + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="cloudApp._cloudImgNav(1)" id="cloudImgNext" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + pd + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="cloudImgMain" src="' + list[startIdx].url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div id="cloudImgCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (startIdx + 1) + ' / ' + list.length + '</div>';
        document.body.appendChild(overlay);
        this._cloudOverlay = overlay;
        if (startIdx <= 0) { var p = document.getElementById('cloudImgPrev'); if (p) p.style.opacity = '0.2'; }
        if (startIdx >= list.length - 1) { var n = document.getElementById('cloudImgNext'); if (n) n.style.opacity = '0.2'; }
        var self = this;
        var kh = function(e) {
            if (e.key === 'ArrowLeft') { self._cloudImgNav(-1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { self._cloudImgNav(1); e.preventDefault(); }
            else if (e.key === 'Escape') { self._cloudImgClose(); e.preventDefault(); }
        };
        this._cloudKeyHandler = kh;
        document.addEventListener('keydown', kh);

        // 🔧 触摸滑动：左右滑动切换图片（移动端）；双指捏合由 Utils.enableImagePinchZoom 处理
        var touchStartX = null, touchStartY = null, swiped = false;
        overlay.addEventListener('touchstart', function(e) {
            if (e.touches.length >= 2) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            swiped = false;
        }, {passive: true});
        overlay.addEventListener('touchmove', function(e) {
            if (e.touches.length >= 2) return;
            if (touchStartX !== null) {
                var dx = e.touches[0].clientX - touchStartX;
                var dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 30 || Math.abs(dy) > 30) swiped = true;
            }
        }, {passive: true});
        overlay.addEventListener('touchend', function(e) {
            if (e.changedTouches && e.changedTouches.length >= 2) { touchStartX = null; return; }
            if (touchStartX !== null) {
                var endX = e.changedTouches[0].clientX;
                var endY = e.changedTouches[0].clientY;
                var dx = endX - touchStartX, dy = endY - touchStartY;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    self._cloudImgNav(dx < 0 ? 1 : -1);  // 左滑下一张，右滑上一张
                }
            }
            touchStartX = null;
        }, {passive: true});

        // 🔧 点击图片切换预览模式（再点一次退出）；点击背景也退出
        overlay.addEventListener('click', function(e) {
            if (swiped) { swiped = false; return; }  // 刚滑动过，忽略本次点击
            if (e.target === overlay) self._cloudImgClose();
        });
        var mainImg = document.getElementById('cloudImgMain');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function(e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                if (swiped) { swiped = false; return; }
                self._cloudImgClose();
            });
        }
    },

    _cloudImgNav(dir) {
        if (!this._cloudImgList || !this._cloudImgList.length) return;
        var len = this._cloudImgList.length;
        if (dir < 0 && this._cloudImgIdx <= 0) { cloudApp._cloudShowTip('已是第一张'); return; }
        if (dir > 0 && this._cloudImgIdx >= len - 1) { cloudApp._cloudShowTip('已是最后一张'); return; }
        this._cloudImgIdx += dir;
        var img = document.getElementById('cloudImgMain');
        var item = this._cloudImgList[this._cloudImgIdx];
        if (img) { img.style.opacity = '0'; var self = this; setTimeout(function() { img.src = item.url; Utils.resetImageZoom(img); img.style.opacity = '1'; }, 100); }
        var ct = document.getElementById('cloudImgCounter');
        if (ct) ct.textContent = (this._cloudImgIdx + 1) + ' / ' + this._cloudImgList.length;
        var p = document.getElementById('cloudImgPrev');
        var n = document.getElementById('cloudImgNext');
        if (p) { p.style.opacity = this._cloudImgIdx <= 0 ? '0.2' : '1'; p.style.cursor = this._cloudImgIdx <= 0 ? 'default' : 'pointer'; }
        if (n) { n.style.opacity = this._cloudImgIdx >= this._cloudImgList.length - 1 ? '0.2' : '1'; n.style.cursor = this._cloudImgIdx >= this._cloudImgList.length - 1 ? 'default' : 'pointer'; }
    },

    _cloudImgClose() {
        if (this._cloudKeyHandler) { document.removeEventListener('keydown', this._cloudKeyHandler); this._cloudKeyHandler = null; }
        if (this._cloudOverlay) { this._cloudOverlay.remove(); this._cloudOverlay = null; }
        this._cloudImgList = null;
    },

    _cloudShowTip(msg) {
        var tip = document.getElementById('cloudImgTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'cloudImgTip';
            tip.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);z-index:10002;color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:20px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.opacity = '1';
        clearTimeout(tip._t);
        tip._t = setTimeout(function() { tip.style.opacity = '0'; }, 1500);
    },

    /**
     * 校验企业操作权限（允许文件下载/允许公开分享 等），无权限时提示并返回 false
     */
    async checkOpPermission(perm, tip) {
        try {
            const token = localStorage.getItem('access_token');
            if (!token) return true;
            const response = await fetch(`/api/cloud/settings/effective-permission/?perm=${encodeURIComponent(perm)}`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) return true; // 接口异常默认放行，避免影响正常操作
            const data = await response.json();
            if (data && data.allowed === false) {
                this.showToast(tip || '您没有权限执行此操作', 'error');
                return false;
            }
            return true;
        } catch (e) {
            return true;
        }
    },

    /**
     * 下载文件
     */
    async downloadFile(fileId) {
        // 🔧 允许文件下载权限校验
        if (!(await this.checkOpPermission('allow_download', '您没有文件下载权限，请联系管理员开通'))) return;
        try {
            const response = await fetch(`/api/cloud/files/${fileId}/download/`, {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '下载失败');
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0) throw new Error('下载的文件为空');

            // 解析文件名（支持中文）
            let filename = 'download';
            const disposition = response.headers.get('Content-Disposition');

            if (disposition) {
                console.log('Content-Disposition:', disposition);

                // 1. 优先尝试匹配 filename*=UTF-8'' 格式 (RFC 5987，通常用于中文)
                // 格式示例：filename*=UTF-8''%E5%90%88%E5%90%8C%20.docx
                const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8\s*''\s*([^;\n"]+)/i);

                if (utf8Match && utf8Match[1]) {
                    // 解码 URL 编码的 UTF-8 文件名
                    try {
                        filename = decodeURIComponent(utf8Match[1]);
                        console.log('通过 filename* 解析成功:', filename);
                    } catch (e) {
                        console.warn('filename* 解码失败:', e);
                    }
                }

                // 2. 如果上面没成功，尝试备用方案：匹配普通 filename= 格式
                if (filename === 'download') {
                    // 格式示例：filename="合同.docx" 或 filename=contract.docx
                    const match = disposition.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i);
                    if (match) {
                        let rawName = match[1] || match[2];
                        if (rawName) {
                            rawName = rawName.trim();
                            // 尝试解码，如果包含百分号则说明是 URL 编码
                            if (rawName.includes('%')) {
                                try {
                                    filename = decodeURIComponent(rawName);
                                    console.log('通过 filename (URL 编码) 解析成功:', filename);
                                } catch (e) {
                                    filename = rawName;
                                }
                            } else {
                                filename = rawName;
                                console.log('通过 filename (普通) 解析成功:', filename);
                            }
                        }
                    }
                }
            }

            // 确保文件名有效
            if (!filename || filename === 'download') {
                // 如果还是无法解析，尝试从 URL 或其他地方推断，或者保持默认
                console.warn('未能从 Content-Disposition 中解析出文件名，使用默认名');
            }

            // 触发下载
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);

            this.showSuccess('下载成功', `文件 "${filename}" 已下载`);
        } catch (error) {
            console.error('下载失败:', error);
            this.showError('下载失败', error.message || error.error || error);
        }
    },


    /**
     * 🔧 下载文件夹（打包下载）
     */
    async downloadFolder(folderId, folderName) {
        // 🔧 允许文件下载权限校验
        if (!(await this.checkOpPermission('allow_download', '您没有文件下载权限，请联系管理员开通'))) return;
        const confirmed = await this.showConfirmDialog(
            '下载文件夹',
            `确定要下载文件夹"${folderName}"吗？文件夹将被打包为 ZIP 文件。`,
            'confirm'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch(`/api/cloud/folders/${folderId}/download/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '下载失败');
            }

            // 🔧 处理 ZIP 文件下载
            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = `${folderName}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);

            this.showSuccess('下载成功', '文件夹已打包下载');

        } catch (error) {
            console.error('文件夹下载失败:', error);
            this.showError('下载失败', error.message || error.error || error);
        } finally {
            this.hideLoading();
        }
    },
    });
})();
