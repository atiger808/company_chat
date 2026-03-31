/**
 * @File   : cloud.js
 * @Time   : 2026/3/16
 * @Author : dayue
 * @Desc   : 企业网盘前端逻辑（完善版 - 支持文件夹层级导航/响应式布局）
 */

class CloudApp {
    constructor() {
        // 🔧 核心状态
        this.currentFolderId = null;          // 当前文件夹 ID（null 表示根目录）
        this.pathStack = [];                   // 面包屑路径栈 [{id, name}]
        this.currentView = 'files';            // 当前视图：files/starred/shared/shared-with-me/trash
        this.viewMode = 'grid';                // 视图模式：list/grid
        this.contextTarget = null;             // 右键菜单目标元素

        // 🔧 配置（从前端配置管理器获取）
        this.fileMaxSizeMB = 50;
        this.imageMaxSizeMB = 20;
        this.videoMaxSizeMB = 100;
        this.audioMaxSizeMB = 30;
        this.allowedFileTypes = ['image', 'video', 'audio', 'file'];

        // 🔧 UI 状态
        this.sidebarOpen = false;

        this.currentRenameId = null;
        this.currentRenameType = 'file';  // 'file' 或 'folder'
        this.currentRenameName = '';

        this.currentMoveIds = [];
        this.currentMoveType = 'file'; // 'file' 或 'folder'

        this.currentShareFileId = null;
        this.currentUser = null;
        this.lastLoadedFiles = [];             // 缓存最后加载的文件列表

        this.trashViewMode = 'list';  // 🔧 回收站视图模式
        this.trashItems = [];  // 🔧 回收站数据缓存

        // 🔧 新增：批量操作相关属性
        this.selectedFiles = new Set();        // 已选择的文件/文件夹 ID 集合
        this.selectAllMode = false;            // 是否全选模式
        this.batchOperationType = null;        // 当前批量操作类型

        // 🔧 新增：批量移动相关属性
        this.batchMoveIds = [];           // 批量移动的文件 ID 列表
        this.batchMoveTargetFolder = null; // 目标文件夹


        // 🔧 新增：协同编辑相关属性
        this.currentDocId = null;           // 当前编辑的文档 ID
        this.collaborators = [];            // 协作者列表
        this.collabWebSocket = null;        // 协同编辑 WebSocket
        this.collabHeartbeatTimer = null;   // 心跳定时器


        // 🔧 在 constructor 中添加协作文档相关属性
        this.currentCollabView = 'list';  // 协作文档视图模式
        this.collabDocs = [];              // 协作文档列表缓存
        this.collabTotalCount = 0
        this.currentCollabDocId = null;    // 当前管理的协作文档ID
        this.selectedCollabUsers = new Set(); // 新建文档时选中的协作用户

        this.collabSearchElementId = 'collabUserSearch'
        this.collabResultsElementId = 'collabUserResults'
        this.collabselectedElementId = 'selectedCollabs'


        // 添加属性
        this.selectedFileId = null;
        this.selectedFileName = null;

        // 当前创建状态
        this.currentCreateFileId = null;
        this.currentCreateFileName = null;
        this.selectedCollabUsers = new Map(); // userId -> {name, permission}


        // 初始化
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        console.log('☁️ CloudApp 初始化开始...');

        try {
            // 1. 检查登录状态
            const token = localStorage.getItem('access_token');
            if (!token) {
                localStorage.setItem('redirect_url', window.location.href);
                window.location.href = '/login/';
                return;
            }

            // 2. 获取用户信息
            this.currentUser = await API.getCurrentUser();
            this.renderAdminInfo();

            // 3. 加载系统配置
            await this.loadSystemConfigs();

            // 4. 加载仪表盘数据（存储信息）
            await this.loadDashboard();

            // 5. 加载文件列表（根目录）
            await this.loadFiles(null);

            // 6. 设置事件监听
            this.setupEventListeners();
            this.setupSidebar();
            this.setupContextMenu();

            console.log('✅ CloudApp 初始化完成');

        } catch (error) {
            console.error('❌ 初始化失败:', error);
            this.showError('初始化失败', error.message);
            this.handleAuthError();
        }
    }

    // ==================== 侧边栏管理 ====================

    setupSidebar() {
        const toggleBtn = document.getElementById('sidebarToggleBtn');
        const closeBtn = document.getElementById('sidebarCloseBtn');
        const overlay = document.getElementById('sidebarOverlay');

        // 移动端菜单按钮
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleSidebar());
            this.updateMobileMenuButton();
            window.addEventListener('resize', () => this.updateMobileMenuButton());
        }

        // 关闭按钮
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeSidebar());
        }

        // 遮罩层
        if (overlay) {
            overlay.addEventListener('click', () => this.closeSidebar());
        }

        // 导航菜单
        document.querySelectorAll('.nav-menu .nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                document.querySelectorAll('.nav-menu .nav-item').forEach(i =>
                    i.classList.remove('active')
                );
                item.classList.add('active');

                this.switchView(item.dataset.view, item.dataset.folderId || null);
                // 移动端自动关闭侧边栏
                if (window.innerWidth <= 768) {
                    this.closeSidebar();
                }
            });
        });
    }

    toggleSidebar() {
        const sidebar = document.getElementById('cloudSidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (sidebar && overlay) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('show');
            this.sidebarOpen = sidebar.classList.contains('open');
        }
    }

    closeSidebar() {
        const sidebar = document.getElementById('cloudSidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            this.sidebarOpen = false;
        }
    }

    // 🔧 关键修复：确保按钮显示状态正确
    updateMobileMenuButton() {
        const btn = document.getElementById('sidebarToggleBtn');
        const backBtn = document.getElementById('btnBack');

        if (btn) {
            // 🔧 移动端显示菜单按钮
            btn.style.display = window.innerWidth <= 768 ? 'block' : 'none';
        }

        // 🔧 关键修复：确保 btnBack 存在
        if (backBtn) {
            backBtn.style.display = this.pathStack.length > 0 ? 'block' : 'none';
        }
    }

    // ==================== 面包屑导航 ====================

    /**
     * 更新面包屑导航
     * @param {Array} pathStack - 路径栈 [{id, name}]
     */
    updateBreadcrumb(pathStack = this.pathStack) {
        const breadcrumb = document.getElementById('breadcrumb');
        const backBtn = document.getElementById('btnBack');

        if (!breadcrumb) return;

        // 清空面包屑
        breadcrumb.innerHTML = '';

        // 🔧 根目录项
        const rootItem = document.createElement('span');
        rootItem.className = 'crumb-item' + (pathStack.length === 0 ? ' active' : '');
        rootItem.textContent = '全部文件';
        rootItem.dataset.folderId = '';
        rootItem.onclick = () => this.navigateToFolder(null);
        breadcrumb.appendChild(rootItem);

        // 🔧 路径项
        pathStack.forEach((item, index) => {
            // 分隔符
            const sep = document.createElement('span');
            sep.className = 'crumb-separator';
            sep.textContent = '/';
            breadcrumb.appendChild(sep);

            // 路径项
            const crumb = document.createElement('span');
            crumb.className = 'crumb-item' + (index === pathStack.length - 1 ? ' active' : '');
            crumb.textContent = item.name;
            crumb.dataset.folderId = item.id;

            // 🔧 非当前项可点击
            if (index < pathStack.length - 1) {
                crumb.style.cursor = 'pointer';
                crumb.onclick = () => this.navigateToFolder(item.id, index);
            }

            breadcrumb.appendChild(crumb);
        });

        // 🔧 更新返回按钮显示
        // 🔧 关键修复：确保 btnBack 存在后再操作
        if (backBtn) {
            backBtn.style.display = pathStack.length > 0 ? 'block' : 'none';
            backBtn.onclick = () => this.goBack();
        } else {
            console.warn('btnBack 元素未找到');
        }
    }

    /**
     * 导航到指定文件夹
     * @param {string|null} folderId - 文件夹 ID，null 表示根目录
     * @param {number} sliceIndex - 可选：截断路径栈的位置
     */
    async navigateToFolder(folderId, sliceIndex = null) {
        if (sliceIndex !== null) {
            // 🔧 点击面包屑中间项：截断路径
            this.pathStack = this.pathStack.slice(0, sliceIndex + 1);
        } else if (folderId === null) {
            // 🔧 返回根目录
            this.pathStack = [];
        } else {
            // 🔧 进入新文件夹：添加到路径栈
            const folderName = this.getFolderNameById(folderId);
            if (folderName) {
                this.pathStack.push({id: folderId, name: folderName});
            }
        }

        this.currentFolderId = folderId;
        this.updateBreadcrumb();
        await this.loadFiles(folderId);
    }

    /**
     * 返回上一级
     */
    async goBack() {
        if (this.pathStack.length > 0) {
            this.pathStack.pop();
            const prevFolder = this.pathStack.length > 0
                ? this.pathStack[this.pathStack.length - 1].id
                : null;

            this.currentFolderId = prevFolder;
            this.updateBreadcrumb();
            await this.loadFiles(prevFolder);
        }
    }

    /**
     * 根据文件夹 ID 获取名称（用于面包屑）
     */
    getFolderNameById(folderId) {
        // 简单实现：从当前渲染的文件列表中查找
        const items = document.querySelectorAll('.file-item, .file-grid-item');
        for (const item of items) {
            if (item.dataset.fileId === folderId && item.dataset.isFolder === 'true') {
                return item.querySelector('.file-name')?.textContent || '未知文件夹';
            }
        }
        return '文件夹';
    }

    // ==================== 视图切换 ====================

    /**
     * 切换主视图（全部文件/星标/分享等）
     * @param {string} view - 视图名称
     * @param {string|null} folderId - 文件夹 ID
     */
    async switchView(view, folderId = null) {
        // 更新侧边栏激活状态
        document.querySelectorAll('.nav-menu .nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        // 隐藏所有视图
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.remove('active');
        });

        // 更新状态
        this.currentView = view;

        // 🔧 关键：只在"全部文件"视图下支持文件夹钻取
        if (view !== 'files') {
            this.pathStack = [];
            this.currentFolderId = null;
        } else {
            this.currentFolderId = folderId || null;
        }

        // 更新面包屑
        this.updateBreadcrumb();

        // 加载对应数据
        switch (view) {
            case 'files':
                document.getElementById('filesView').classList.add('active');

                this.collabSearchElementId = 'collabUserSearch'
                this.collabResultsElementId = 'collabUserResults'
                this.collabselectedElementId = 'selectedCollabs'
                await this.loadFiles(folderId);
                break;
            case 'starred':
                document.getElementById('filesView').classList.add('active');
                await this.loadFiles(null, {starred: true});
                break;
            case 'shared':
                document.getElementById('sharedView').classList.add('active');
                await this.loadMyShares();
                break;
            case 'shared-with-me':
                document.getElementById('sharedWithMeView').classList.add('active');
                await this.loadSharedWithMe();
                break;
            // 🔧 新增协作文档视图处理
            case 'collaborations':
                document.getElementById('collaborationsView').classList.add('active');
                this.collabSearchElementId = 'collabUserSearchNew'
                this.collabResultsElementId = 'collabUserResultsNew'
                this.collabselectedElementId = 'selectedCollabsNew'
                await this.loadCollaborations();
                break;
            case 'trash':
                document.getElementById('trashView').classList.add('active');
                await this.loadTrash();
                break;
            case 'dashboard':
                document.getElementById('dashboardView').classList.add('active');
                await this.loadDashboardStats();
                break;
        }


        // 🔧 根据视图类型更新右键菜单
        if (view === 'trash') {
            this.setupTrashContextMenu();
            this.setupTrashActions();
        } else {
            this.setupContextMenu();
        }

    }

    /**
     * 切换视图模式（列表/网格）
     * @param {string} mode - 'list' 或 'grid'
     */
    switchViewMode(mode) {
        this.viewMode = mode;

        // 更新按钮状态
        document.querySelectorAll('.view-switcher .btn-icon').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.viewMode === mode);
        });

        // 切换容器显示
        const listView = document.getElementById('fileListView');
        const gridView = document.getElementById('fileGridView');

        if (listView && gridView) {
            listView.classList.toggle('active', mode === 'list');
            gridView.classList.toggle('active', mode === 'grid');
        }

        // 重新渲染当前文件列表（保持数据，只改样式）
        if (this.lastLoadedFiles) {
            this.renderFiles(this.lastLoadedFiles);
        }

        this.switchTrashViewMode(mode)
        this.switchCollabViewMode(mode)

    }

    // ==================== 数据加载 ====================

    async loadDashboard() {
        try {
            const response = await fetch('/api/cloud/dashboard/overview/', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载仪表盘失败');

            const data = await response.json();
            document.getElementById('storageUsed').style.width = `${data.storage_used_percent}%`;
            document.getElementById('storageText').textContent =
                `${data.total_size_formatted} / ${data.storage_quota_formatted}`;
        } catch (error) {
            console.error('加载仪表盘失败:', error);
        }
    }

    /**
     * 加载文件列表
     * @param {string|null} folderId - 文件夹 ID
     * @param {Object} filters - 额外过滤参数
     */
    async loadFiles(folderId = null, filters = {}) {
        try {
            this.showLoading();

            const params = new URLSearchParams();
            if (folderId) params.append('folder', folderId);
            if (filters.starred) params.append('starred', 'true');
            if (filters.trash) params.append('trash', 'true');

            const response = await fetch(`/api/cloud/files/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

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
    }

    /**
     * 渲染文件列表（支持列表/网格视图）
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

        // 🔧 排序：文件夹在前，按名称排序
        data.sort((a, b) => {
            if (a.is_folder && !b.is_folder) return -1;
            if (!a.is_folder && b.is_folder) return 1;
            return a.name.localeCompare(b.name);
        });

        // 🔧 列表视图渲染
        if (listBody) {
            let html = '';
            data.forEach(file => {
                const isFolder = file.is_folder;
                const isSelected = this.selectedFiles.has(file.id);
                html += `
                    <div class="file-item ${isFolder ? 'is-folder' : ''} ${isSelected ? 'selected' : ''}" 
                         data-file-id="${file.id}" 
                         data-is-folder="${isFolder}"
                         ondblclick="cloudApp.handleItemDoubleClick('${file.id}', ${isFolder})"
                         oncontextmenu="cloudApp.handleContextMenu(event, '${file.id}', ${isFolder})" title="${file.name}">
                        <div class="file-col name">
                            <!-- 🔧 关键修复：添加复选框 -->
                            <input type="checkbox" 
                                   class="file-checkbox" 
                                   data-file-id="${file.id}"
                                   ${isSelected ? 'checked' : ''}
                                   onchange="cloudApp.toggleFileSelection('${file.id}', this.checked)">
                            <i class="fas ${isFolder ? 'fa-folder' : file.icon_class || 'fa-file'}"></i>
                            <span class="file-name">${this.escapeHtml(file.name)}</span>
                        </div>
                        <div class="file-col size">${isFolder ? '-' : (file.size_formatted || '-')}</div>
                        <div class="file-col date">${this.formatDate(file.updated_at || file.created_at)}</div>
                        <div class="file-col actions">
                            ${!isFolder ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.previewFile('${file.id}')" title="预览">
                                    <i class="fas fa-eye"></i>
                                </button>
                            ` : `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.handleItemDoubleClick('${file.id}', true)" title="打开">
                                    <i class="fas fa-folder-open"></i>
                                </button>
                            `}
                            
                            ${isFolder ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFolder('${file.id}', '${this.escapeHtml(file.name)}')" title="下载文件夹">
                                    <i class="fas fa-download"></i>
                                </button>
                            ` : `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFile('${file.id}')" title="下载">
                                    <i class="fas fa-download"></i>
                                </button>
                            `}
                            
                           
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
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${file.id}', ${isFolder})" title="分享">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.renameFile('${file.id}', '${this.escapeHtml(file.name)}')" title="重命名">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${file.id}'], ${isFolder})" title="移动">
                                <i class="fas fa-cut"></i>
                            </button>
                            <button class="btn-action btn-danger" onclick="event.stopPropagation(); cloudApp.deleteItem('${file.id}', ${isFolder})" title="删除">
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
                    const fileId = e.target.dataset.fileId;
                    this.toggleFileSelection(fileId, e.target.checked);
                };
            });
        }

        // 🔧 网格视图渲染
        if (gridBody) {
            let html = '';
            data.forEach(file => {
                const isFolder = file.is_folder;
                const isSelected = this.selectedFiles.has(file.id);
                const isImage = file.is_image || (file.mime_type && file.mime_type.startsWith('image/'));
                const isVideo = file.is_video || (file.mime_type && file.mime_type.startsWith('video/'));
                const tagType = isImage ? 'img' : isVideo ? 'video' : 'file';


                // 🔧 关键修复：图片和视频显示缩略图
                const thumbnailHtml = (isImage || isVideo) && !isFolder ? `
                    <div class="file-thumbnail">
                        <${tagType} src="${file.file_url}" alt="${file.name}" title="${file.name}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;" />
                    </div>
                ` : `
                    <div class="file-icon">
                        <i class="fas ${isFolder ? 'fa-folder folder' : file.icon_class || 'fa-file'}"></i>
                    </div>
                `;


                html += `
                    <div class="file-grid-item ${isFolder ? 'is-folder' : ''} ${isSelected ? 'selected' : ''}" 
                         data-file-id="${file.id}" 
                         data-is-folder="${isFolder}"
                         ondblclick="cloudApp.handleItemDoubleClick('${file.id}', ${isFolder})"
                         oncontextmenu="cloudApp.handleContextMenu(event, '${file.id}', ${isFolder})" title="${file.name}">
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
                        
                            ${!isFolder ? `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.previewFile('${file.id}')" title="预览">
                                    <i class="fas fa-eye"></i>
                                </button>
                            ` : `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.handleItemDoubleClick('${file.id}', true)" title="打开">
                                    <i class="fas fa-folder-open"></i>
                                </button>
                            `}
                            
                            ${isFolder ? `
                                <button class="btn-action" class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFolder('${file.id}', '${this.escapeHtml(file.name)}')" title="下载文件夹">
                                    <i class="fas fa-download"></i>
                                </button>
                            ` : `
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.downloadFile('${file.id}')" title="下载">
                                    <i class="fas fa-download"></i>
                                </button>
                            `}
                            
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
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${file.id}', ${isFolder})" title="分享">
                                <i class="fas fa-share-alt"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${file.id}'], ${isFolder})" title="移动">
                                <i class="fas fa-cut"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${file.id}', ${isFolder})" title="删除">
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
    }


    // cloud.js - 添加批量选择方法

    /**
     * 🔧 切换单个文件的选择状态
     */
    toggleFileSelection(fileId, checked) {
        if (checked) {
            this.selectedFiles.add(fileId);
        } else {
            this.selectedFiles.delete(fileId);
            this.selectAllMode = false;
        }
        this.updateBatchOperationBar();
        this.updateFileItemStyle(fileId, checked);
    }

    /**
     * 🔧 更新文件项的选中样式
     */
    updateFileItemStyle(fileId, isSelected) {
        const items = document.querySelectorAll(`[data-file-id="${fileId}"]`);
        items.forEach(item => {
            if (isSelected) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

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
    }

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
    }

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
    }


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
    }

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

            if (!response.ok) throw new Error('加载文件夹失败');

            const data = await response.json();
            const folders = data.folders || [];

            // 🔧 递归渲染树状结构
            const renderTree = (nodes, level = 0) => {
                let html = '';

                nodes.forEach(node => {
                    const indent = level * 20;
                    const hasChildren = node.children && node.children.length > 0;

                    html += `
                        <div class="folder-tree-item" 
                             data-folder-id="${node.id}" 
                             data-folder-name="${this.escapeHtml(node.name)}"
                             style="padding-left: ${indent + 15}px;">
                            <i class="fas fa-folder${hasChildren ? '-open' : ''}"></i>
                            <span class="folder-name">${this.escapeHtml(node.name)}</span>
                        </div>
                    `;

                    // 🔧 递归渲染子文件夹
                    if (hasChildren) {
                        html += renderTree(node.children, level + 1);
                    }
                });

                return html;
            };

            let html = `
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
    }

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
    }

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
    }

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
    }


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
    }

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
    }


    /**
     * 🔧 根据文件 ID 获取文件名（用于分享结果展示）
     */
    getFileNameById(fileId) {
        const item = document.querySelector(`[data-file-id="${fileId}"] .file-name`);
        return item?.textContent || '未知文件';
    }


    getEmptyText() {
        const texts = {
            'files': '此文件夹为空',
            'starred': '暂无星标文件',
            'shared': '您还没有创建任何分享',
            'shared-with-me': '还没有人分享文件给您',
            'trash': '回收站为空'
        };
        return texts[this.currentView] || '暂无内容';
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // ==================== 文件交互 ====================

    /**
     * 处理项目单击（选中）
     */
    handleItemClick(fileId, isFolder) {
        if (isFolder) {
            // 🔧 单击文件夹：在网格视图中也支持进入
            this.navigateToFolder(fileId);
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
    }

    /**
     * 处理项目双击（打开文件夹或预览文件）
     */
    async handleItemDoubleClick(fileId, isFolder) {
        if (isFolder) {
            await this.navigateToFolder(fileId);
        } else {
            await this.previewFile(fileId);
        }
    }

    /**
     * 预览文件
     */
    async previewFile(fileId) {
        try {
            const response = await fetch(`/api/cloud/files/${fileId}/`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载失败');

            const file = await response.json();

            if (file.is_image || file.is_video || file.is_document) {
                window.open(file.file_url, '_blank');
            } else {
                this.downloadFile(fileId);
            }
        } catch (error) {
            console.error('预览失败:', error);
            this.showError('预览失败', error.message);
        }
    }

    /**
     * 下载文件
     */
    async downloadFile(fileId) {
        try {
            const response = await fetch(`/api/cloud/files/${fileId}/download/`, {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error(`下载失败：${response.status}`);

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
            this.showError('下载失败', error.message);
        }
    }


    /**
     * 🔧 下载文件夹（打包下载）
     */
    async downloadFolder(folderId, folderName) {
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
            this.showError('下载失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    // ==================== 文档协同功能 ====================

    // 添加编辑文档方法
    async editDocument(fileId) {
        // 打开新窗口加载编辑器
        window.open(`/cloud/editor/?id=${fileId}`, '_blank');
    }


    // 🔧 修复：加载协作文档列表
    async loadCollaborations(filters = {}) {
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
    }


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
                const collaboratorCount = doc.collaborator_count || 0;
                const isOwner = doc.owner === this.currentUser?.id;

                html += `
                <div class="file-item is-collab"
                     data-doc-id="${doc.id}"
                     data-doc-type="${docType}"
                     title="${this.escapeHtml(doc.name)}"
                     ondblclick="cloudApp.openCollabDoc('${doc.id}')">
                     
                    <div class="file-col name">
                        <i class="fas ${iconClass} collab-icon"></i>
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
                        <button class="btn-action" onclick="event.stopPropagation(); cloudApp.manageCollabDoc('${doc.id}')" title="管理">
                            <i class="fas fa-cog"></i>
                        </button>
                        <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${doc.id}', false)" title="分享">
                            <i class="fas fa-share-alt"></i>
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
                const collaboratorCount = doc.collaborator_count || 0;
                const isOwner = doc.owner === this.currentUser?.id;

                html += `
                <div class="file-grid-item is-collab"
                     data-doc-id="${doc.id}"
                     data-doc-type="${docType}"
                     ondblclick="cloudApp.openCollabDoc('${doc.id}')"
                     title="${this.escapeHtml(doc.name)}">
                     
                    <div class="file-icon collab-icon-large">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    
                    <div class="file-name" onclick="cloudApp.openCollabDoc('${doc.id}')">
                        ${this.escapeHtml(doc.name)}
                    </div>
                    
                    <div class="collab-card-footer">
                        <div class="collab-type">
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
                            <button class="btn-icon" onclick="event.stopPropagation(); cloudApp.manageCollabDoc('${doc.id}')" title="管理">
                                <i class="fas fa-cog"></i>
                            </button>
                        ` : ''}
                        <button class="btn-icon" onclick="event.stopPropagation(); cloudApp.shareFile('${doc.id}', false)" title="分享">
                            <i class="fas fa-share-alt"></i>
                        </button>
                    </div>
                    
                    ${!isOwner ? '<div class="collab-badge">协作</div>' : ''}
                </div>
            `;
            });
            gridBody.innerHTML = html;
        }
    }

    // 🔧 辅助方法：获取文档类型文本
    getDocTypeText(docType) {
        const map = {
            'word': 'Word',
            'excel': 'Excel',
            'ppt': 'PPT',
            'pdf': 'PDF'
        };
        return map[docType] || '文档';
    }

    // 🔧 辅助方法：获取文档图标类
    getDocIconClass(docType) {
        const map = {
            'word': 'fa-file-word',
            'excel': 'fa-file-excel',
            'ppt': 'fa-file-powerpoint',
            'pdf': 'fa-file-pdf'
        };
        return map[docType] || 'fa-file';
    }


    // 🔧 打开协作文档
    openCollabDoc(docId) {
        window.open(`/cloud/editor/?id=${docId}`, '_blank');
    }


    // ==================== 管理协作文档 start ====================
    // 🔧 管理协作文档
    async manageCollabDoc(docId) {
        this.currentCollabDocId = docId;

        try {
            // 加载文档详情
            const response = await fetch(`/api/cloud/documents/${docId}/`, {
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
    }

    // 🔧 关闭协作文档管理模态框
    closeCollabManageModal() {
        document.getElementById('collabDocManageModal').classList.remove('show');
        this.currentCollabDocId = null;
    }

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
    }


    // 🔧 打开添加协作者模态框（简化版，复用现有逻辑）
    async openAddCollabModal() {
        if (!this.currentCollabDocId) return;

        // 这里可以复用 DocumentEditorApp 的添加协作者逻辑
        // 或创建新的模态框，此处简化处理
        this.showInfo('添加协作', '添加协作者功能请在文档编辑页面操作');
    }

    // 🔧 修改协作者权限
    async editCollabPermission(collabId) {
        const newPermission = prompt('设置权限 (read/write/admin):', 'write');
        if (!newPermission || !['read', 'write', 'admin'].includes(newPermission)) {
            this.showWarning('无效的权限类型');
            return;
        }

        await this.updateCollabPermission(collabId, newPermission);
    }

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
    }

    // 🔧 切换协作者激活状态
    async toggleCollabActive(collabId, currentActive) {
        await this.updateCollabPermission(collabId, null, !currentActive);
    }

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
    }



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
    }


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
    }


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
    }

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
            titleEl.textContent = `创建协作文档：${this.currentCreateFileName}`;
        }

        // 清空并显示
        this.updateSelectedCollabsDisplay();
        document.getElementById(this.collabSearchElementId).value = '';
        document.getElementById(this.collabResultsElementId).innerHTML = '';
        document.getElementById(this.collabResultsElementId).classList.remove('show');

        modal.classList.add('show');
    }

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
                <h3 class="modal-title">创建协作文档</h3>
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
    }

    /**
     * 🔧 搜索协作用户
     */
    async searchCollabUsers(keyword, elementId='collabUserResults') {
        if (!keyword.trim()) {
            document.getElementById(elementId).innerHTML = '';
            document.getElementById(elementId).classList.remove('show');
            return;
        }

        try {
            const response = await fetch(`/api/auth/search_users/?q=${encodeURIComponent(keyword)}`, {
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
    }

    /**
     * 🔧 渲染搜索结果
     */
    renderCollabUserResults(users, elementId='collabUserResults') {
        const container = document.getElementById(elementId);
        if (users.length === 0) {
            container.innerHTML = '<div class="empty-tip">未找到用户</div>';
            container.classList.add('show');
            return;
        }

        let html = '';
        users.forEach(user => {
            html += `
            <div class="user-result-item" onclick="cloudApp.addCollabUser(${user.id}, '${this.escapeHtml(user.real_name || user.username)}')">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" class="user-avatar">
                <div class="user-info">
                    <div class="user-name">${this.escapeHtml(user.real_name || user.username)}</div>
                    <div class="user-dept">${user.department_info?.name || ''}</div>
                </div>
                <i class="fas fa-plus-circle add-icon"></i>
            </div>
        `;
        });
        container.innerHTML = html;
        container.classList.add('show');
    }

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
    }

    /**
     * 🔧 添加协作者
     */
    addCollabUser(userId, userName, permission = 'write') {
        if (this.selectedCollabUsers.has(userId)) return;

        this.selectedCollabUsers.set(userId, {
            name: userName,
            permission: permission
        });

        this.updateSelectedCollabsDisplay();
        document.getElementById(this.collabSearchElementId).value = '';
        document.getElementById(this.collabResultsElementId).classList.remove('show');

        this.showSuccess('已添加', `${userName} 已添加到协作者列表`);
    }

    /**
     * 🔧 移除协作者
     */
    removeCollabUser(userId) {
        const user = this.selectedCollabUsers.get(userId);
        this.selectedCollabUsers.delete(userId);
        this.updateSelectedCollabsDisplay();

        if (user?.name) {
            this.showInfo('已移除', `${user.name} 已从协作者列表移除`);
        }
    }

    /**
     * 🔧 更新协作者权限
     */
    updateCollabPermission(userId, permission) {
        const user = this.selectedCollabUsers.get(userId);
        if (user) {
            user.permission = permission;
            this.updateSelectedCollabsDisplay();
        }
    }

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
    }

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

        try {
            this.showLoading();

            const response = await fetch('/api/cloud/documents/custom-create/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    file_id: this.currentCreateFileId,
                    initial_collaborators: initialCollaborators
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
    }

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
    }

    /**
     * 🔧 转义工具方法（如果不存在则添加）
     */
    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }


    loadCollabVersions(currentCollabDocId) {
        console.log('loadCollabVersions ...')
    }


    async editCollabDocument(fileId, fileName) {
        await this.renameFile(fileId, fileName, false)
    }


    // 🔧 分享协作文档
    async shareCollabDocument(fileId) {
        // 调用现有的分享功能
        await this.shareFile(fileId, false);
    }

    /**
     * 🔧 从云文件创建新协作文档（主入口）
     */
    async createDocFromFile() {
        this.openFileSelectModal('document');  // 只显示文档类型文件
    }

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
    }

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
                <h3>选择文件 - ${filterLabels[filterType] || '全部文件'}</h3>
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
    }

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
    }

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
    }

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


        try {
            this.showLoading();


            const response = await fetch('/api/cloud/documents/custom-create/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({
                    file_id: this.selectedFileId,
                    initial_collaborators: initialCollaborators
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
    }

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
    }

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
    }


    // ==================== 文档协同功能 end ====================


    // ==================== 右键菜单 ====================
    /**
     * 🔧 右键菜单设置（非回收站视图专用）
     */
    setupContextMenu() {

        // 在非回收站视图中，右键菜单显示下载和分享选项
        const menu = document.getElementById('contextMenu');
        if (menu && this.currentView !== 'trash') {
            menu.innerHTML = `
                <div class="menu-item" onclick="cloudApp.openSelectedItem()"><i class="fas fa-folder-open"></i> 打开</div>
                <div class="menu-item" onclick="cloudApp.renameSelectedItem()"><i class="fas fa-edit"></i> 重命名</div>
                <div class="menu-item" onclick="cloudApp.moveSelectedItem()"><i class="fas fa-cut"></i> 移动</div>
                <div class="menu-divider"></div>
                <div class="menu-item danger" onclick="cloudApp.deleteSelectedItem()"><i class="fas fa-trash"></i> 删除</div>
            `
        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu') && !e.target.closest('.file-item, .file-grid-item')) {
                this.hideContextMenu();
            }
        });
    }


    handleContextMenu(e, fileId, isFolder) {
        e.preventDefault();
        e.stopPropagation();

        // 🔧 保存类型信息
        this.contextTarget = {fileId, isFolder};
        const menu = document.getElementById('contextMenu');

        if (menu) {
            // 菜单位置
            let x = e.pageX;
            let y = e.pageY;

            // 防止菜单超出屏幕
            const rect = menu.getBoundingClientRect();
            if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 10;
            if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 10;

            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
            menu.style.display = 'block';
        }
    }

    hideContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) menu.style.display = 'none';
        this.contextTarget = null;
    }

    /**
     * 🔧 右键菜单打卡
     */
    openSelectedItem() {
        if (this.contextTarget) {
            this.handleItemDoubleClick(this.contextTarget.fileId, this.contextTarget.isFolder);
        }
        this.hideContextMenu();
    }

    /**
     * 右键菜单重命名（从 contextTarget 获取类型）
     */
    renameSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder} = this.contextTarget;

            // 获取文件名
            const item = document.querySelector(`[data-file-id="${fileId}"]`);
            const name = item?.querySelector('.file-name')?.textContent || '';

            // 🔧 传递 isFolder 参数
            this.renameItem(fileId, name, isFolder);
        }
        this.hideContextMenu();
    }

    // ==================== 右键菜单（完善版）====================

    /**
     * 🔧 右键菜单移动
     */
    moveSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder} = this.contextTarget;
            this.moveItems([fileId], isFolder);
        }
        this.hideContextMenu();
    }

    /**
     * 🔧 右键菜单删除
     */
    deleteSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder} = this.contextTarget;
            this.deleteItem(fileId, isFolder);
        }
        this.hideContextMenu();
    }


    // ==================== 文件操作 ====================

    async uploadFile(file, folderId = null) {
        if (!file) {
            this.showError('上传失败', '文件不能为空');
            return null;
        }

        if (!this.isValidFileType(file)) {
            this.showError('不支持的文件类型', `允许的类型：${this.allowedFileTypes.join(', ')}`);
            return null;
        }

        const maxSizeBytes = this.fileMaxSizeMB * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            this.showError('文件过大', `文件大小不能超过${this.fileMaxSizeMB}MB`);
            return null;
        }

        const fileType = this.getFileCategory(file.type);
        let typeMaxSizeMB = this.fileMaxSizeMB;

        if (fileType === 'image') typeMaxSizeMB = this.imageMaxSizeMB;
        else if (fileType === 'video') typeMaxSizeMB = this.videoMaxSizeMB;
        else if (fileType === 'audio') typeMaxSizeMB = this.audioMaxSizeMB;

        const typeMaxSizeBytes = typeMaxSizeMB * 1024 * 1024;
        if (file.size > typeMaxSizeBytes) {
            this.showError('文件过大', `${fileType}文件不能超过${typeMaxSizeMB}MB`);
            return null;
        }

        try {
            const formData = new FormData();
            formData.append('file', file);
            if (folderId) formData.append('folder', folderId);

            this.showUploadProgress(file.name, 0);

            const response = await fetch('/api/cloud/files/', {
                method: 'POST',
                headers: {'Authorization': `Bearer ${TokenManager.getToken()}`},
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.detail || '上传失败');
            }

            const result = await response.json();
            this.updateUploadProgress(file.name, 100);
            this.showSuccess('上传成功', result.exists ? `${file.name} 已存在（秒传）` : `${file.name} 上传成功`);

            await this.loadFiles(this.currentFolderId);
            return result;

        } catch (error) {
            console.error('文件上传失败:', error);
            this.showError('上传失败', error.message);
            this.hideUploadProgress(file.name);
            return null;
        }
    }

    isValidFileType(file) {
        const fileType = this.getFileCategory(file.type);
        return this.allowedFileTypes.includes(fileType);
    }

    getFileCategory(mimeType) {
        if (!mimeType) return 'file';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        return 'file';
    }

    showUploadProgress(filename, progress) {
        let progressContainer = document.getElementById('uploadProgressContainer');
        if (!progressContainer) {
            progressContainer = document.createElement('div');
            progressContainer.id = 'uploadProgressContainer';
            progressContainer.className = 'upload-progress-container';
            document.body.appendChild(progressContainer);
        }

        const progressItem = document.createElement('div');
        progressItem.className = 'upload-progress-item';
        progressItem.id = `upload-${filename.replace(/[^a-zA-Z0-9]/g, '-')}`;
        progressItem.innerHTML = `
            <div class="progress-info">
                <span class="filename">${filename}</span>
                <span class="progress-percent">${progress}%</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
        `;
        progressContainer.appendChild(progressItem);
    }

    updateUploadProgress(filename, progress) {
        const progressItem = document.getElementById(`upload-${filename.replace(/[^a-zA-Z0-9]/g, '-')}`);
        if (progressItem) {
            const percentEl = progressItem.querySelector('.progress-percent');
            const fillEl = progressItem.querySelector('.progress-fill');
            if (percentEl) percentEl.textContent = `${progress}%`;
            if (fillEl) fillEl.style.width = `${progress}%`;
        }
    }

    hideUploadProgress(filename) {
        const progressItem = document.getElementById(`upload-${filename.replace(/[^a-zA-Z0-9]/g, '-')}`);
        if (progressItem) {
            setTimeout(() => progressItem.remove(), 2000);
        }
    }

    async deleteFile(fileId) {
        const confirmed = await this.showConfirmDialog('删除文件', '确定要删除这个文件吗？', 'danger');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/files/${fileId}/delete/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('删除失败');

            this.showSuccess('删除成功', '文件已移动到回收站');
            await this.loadFiles(this.currentFolderId);
        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    }

    async createFolder() {
        const name = document.getElementById('newFolderName')?.value.trim();
        if (!name) {
            this.showError('验证失败', '文件夹名称不能为空');
            return;
        }

        try {
            const response = await fetch('/api/cloud/folders/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TokenManager.getToken()}`
                },
                body: JSON.stringify({name, parent: this.currentFolderId})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '创建失败');
            }

            this.showSuccess('创建成功', '文件夹创建成功');
            this.closeModal('newFolderModal');
            document.getElementById('newFolderName').value = '';
            await this.loadFiles(this.currentFolderId);
        } catch (error) {
            console.error('创建失败:', error);
            this.showError('创建失败', error.message);
        }
    }

    // ==================== 分享功能 ====================

    async loadMyShares() {
        try {
            this.showLoading();
            const response = await fetch('/api/cloud/shares/?owner=me', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载分享失败');

            const data = await response.json();
            const shares = Array.isArray(data.results) ? data.results : data;
            this.renderMyShares(shares);
        } catch (error) {
            console.error('加载我的分享失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    renderMyShares(shares) {
        const container = document.getElementById('mySharesList');
        if (!shares || shares.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-share-alt"></i>
                    <p>暂无分享</p>
                    <small class="text-muted">您还没有创建任何分享</small>
                </div>
            `;
            return;
        }

        let html = '<div class="share-list">';
        shares.forEach(share => {
            const statusBadge = share.is_expired
                ? '<span class="badge badge-danger">已过期</span>'
                : '<span class="badge badge-success">有效</span>';

            html += `
                <div class="share-item">
                    <div class="share-icon">
                        <i class="fas ${share.is_folder ? 'fa-folder' : share.file_info?.icon_class || 'fa-file'}"></i>
                    </div>
                    <div class="share-info">
                        <div class="share-name">
                            ${share.file_info ? share.file_info.name : share.folder_info?.name || '未知'}
                            ${statusBadge}
                        </div>
                        <div class="share-meta">
                            <span><i class="fas fa-link"></i> ${share.share_code}</span>
                            <span><i class="fas fa-download"></i> ${share.download_count || 0} 次</span>
                            ${share.expires_at ? `<span><i class="fas fa-clock"></i> ${this.formatDate(share.expires_at)}</span>` : ''}
                        </div>
                    </div>
                    <div class="share-actions">
                        <button class="btn-action" onclick="cloudApp.copyShareUrl('${share.share_url}?提取码=${share.password}')" title="复制链接">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="btn-action" onclick="cloudApp.revokeShare('${share.id}')" title="取消分享">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    async loadSharedWithMe() {
        try {
            this.showLoading();
            const response = await fetch('/api/cloud/shares/?shared_with_me=true', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载分享失败');

            const data = await response.json();
            const shares = Array.isArray(data.results) ? data.results : data;
            this.renderSharedWithMe(shares);
        } catch (error) {
            console.error('加载分享给我失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    renderSharedWithMe(shares) {
        const container = document.getElementById('sharedWithMeList');
        if (!shares || shares.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>暂无分享</p>
                    <small class="text-muted">还没有人分享文件给您</small>
                </div>
            `;
            return;
        }

        let html = '<div class="share-list">';
        shares.forEach(share => {
            html += `
                <div class="share-item">
                    <div class="share-icon">
                        <i class="fas ${share.file_info ? share.file_info.icon_class : 'fa-folder'}"></i>
                    </div>
                    <div class="share-info">
                        <div class="share-name">
                            ${share.file_info ? share.file_info.name : share.folder_info?.name || '未知'}
                        </div>
                        <div class="share-meta">
                            <span><i class="fas fa-user"></i> ${share.owner_name}</span>
                            <span><i class="fas fa-calendar"></i> ${this.formatDate(share.created_at)}</span>
                        </div>
                    </div>
                    <div class="share-actions">
                        <a href="${share.share_url}" target="_blank" class="btn-action" title="查看">
                            <i class="fas fa-eye"></i>
                        </a>
                        <button class="btn-action" onclick="cloudApp.saveSharedFile('${share.id}')" title="保存到我的网盘">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }

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
    }

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

            if (!response.ok) throw new Error('加载回收站失败');

            const data = await response.json();
            this.trashItems = Array.isArray(data.items) ? data.items : [];

            this.renderTrash(this.trashItems);

        } catch (error) {
            console.error('加载回收站失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


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
                            <i class="fas ${iconClass}"></i>
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
                            <button class="btn-action btn-danger" 
                                    onclick="event.stopPropagation(); cloudApp.permanentDeleteItem('${item.id}', ${isFolder})" 
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
                            <i class="fas ${iconClass}"></i>
                        </div>
                        <div class="file-name">${this.escapeHtml(item.name)}</div>
                        <div class="file-size">${isFolder ? '' : (item.size_formatted || '')}</div>
                        <div class="file-date">${this.formatDate(item.deleted_at)}</div>
                        <div class="file-actions">
                            <button class="btn-action" onclick="cloudApp.restoreItem('${item.id}', ${isFolder})" title="恢复">
                                <i class="fas fa-undo"></i>
                            </button>
                            <button class="btn-action" onclick="cloudApp.permanentDeleteItem('${item.id}', ${isFolder})" title="永久删除">
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

    }

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
    }


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
    }


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
    }


    // ==================== 右键菜单（完善版）====================

    /**
     * 🔧 右键菜单恢复
     */
    restoreSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder} = this.contextTarget;
            this.restoreItem(fileId, isFolder);
        }
        this.hideContextMenu();
    }

    /**
     * 🔧 右键菜单永久删除
     */
    permanentDeleteSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder} = this.contextTarget;
            this.permanentDeleteItem(fileId, isFolder);
        }
        this.hideContextMenu();
    }

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
    }


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
    }


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
    }


    // ==================== 删除功能（完善版）====================

    /**
     * 🔧 关键修复：删除文件/文件夹（区分类型）
     * @param {string} itemId - 文件或文件夹 ID
     * @param {boolean} isFolder - 是否为文件夹
     */
    async deleteItem(itemId, isFolder = false) {
        const confirmed = await this.showConfirmDialog(
            '删除确认',
            `确定要删除这个${isFolder ? '文件夹' : '文件'}吗？`,
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
            } else {
                await this.loadFiles(null);
            }

        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    }

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

            this.showSuccess('删除成功', '文件已永久删除');
            await this.loadTrash();

        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    }


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
    }

    /**
     * 🔧 永久删除文件/文件夹
     */
    async permanentDeleteItem(itemId, isFolder = false) {
        const confirmed = await this.showConfirmDialog(
            '永久删除',
            `确定要永久删除这个${isFolder ? '文件夹' : '文件'}吗？此操作不可恢复！`,
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
    }

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
    }

    /**
     * 🔧 批量永久删除
     */
    async batchPermanentDelete() {
        if (this.selectedFiles.size === 0) {
            this.showError('操作失败', '请先选择要删除的项目');
            return;
        }

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
    }


    async emptyTrash() {
        const confirmed = await this.showConfirmDialog('清空回收站', '确定要清空回收站吗？所有文件将永久删除，此操作不可恢复！', 'danger');
        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch('/api/cloud/files/empty_trash/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

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
            this.showError('清空失败', error.message);
        }
    }

    async copyShareUrl(url) {
        try {
            await navigator.clipboard.writeText(url);
            this.showSuccess('复制成功', '分享链接已复制');
        } catch (error) {
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            this.showSuccess('复制成功', '分享链接已复制');
        }
    }

    async revokeShare(shareId) {
        const confirmed = await this.showConfirmDialog('取消分享', '确定要取消这个分享吗？', 'confirm');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/shares/${shareId}/revoke/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('取消失败');

            this.showSuccess('取消成功', '分享已取消');
            await this.loadMyShares();
        } catch (error) {
            console.error('取消失败:', error);
            this.showError('取消失败', error.message);
        }
    }

    async saveSharedFile(shareId) {
        try {
            const response = await fetch(`/api/cloud/shares/${shareId}/save/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '保存失败');
            }
            this.showSuccess('保存成功', '文件已保存到我的网盘');
        } catch (error) {
            console.error('保存失败:', error);
            this.showError('保存失败', error.message);
        }
    }

    /**
     * 🔧 分享文件/文件夹（支持文件夹）
     */
    async shareFile(fileId, isFolder = false) {
        this.currentShareFileId = fileId;
        this.currentShareType = isFolder ? 'folder' : 'file';

        // 重置表单
        document.getElementById('shareType').value = 'public';
        document.getElementById('sharePassword').value = '';
        document.getElementById('shareExpires').value = '';
        document.getElementById('shareMaxDownloads').value = '';
        document.getElementById('shareLink').style.display = 'none';
        document.getElementById('shareQrcode').style.display = 'none';
        document.getElementById('passwordGroup').style.display = 'none';
        document.getElementById('qrcodeContainer').innerHTML = '';

        // 更新模态框标题
        const modalTitle = document.querySelector('#shareModal .modal-header h3');
        if (modalTitle) {
            modalTitle.textContent = isFolder ? '分享文件夹' : '分享文件';
        }

        this.openModal('shareModal');
    }

    /**
     * 🔧 创建分享（完善版）
     */
    async createShare() {
        const itemId = this.currentShareFileId;
        const itemType = this.currentShareType || 'file';

        if (!itemId) {
            this.showError('错误', '未选择文件或文件夹');
            return;
        }

        const shareType = document.getElementById('shareType')?.value || 'public';
        let password = document.getElementById('sharePassword')?.value || '';

        // 🔧 密码保护类型且密码为空，自动生成
        if (shareType === 'password' && !password) {
            this.generatePassword();
            password = document.getElementById('sharePassword').value;
        }

        if (shareType !== 'password') {
            password = '';
        }

        const expiresAt = document.getElementById('shareExpires')?.value || null;
        const maxDownloads = document.getElementById('shareMaxDownloads')?.value || null;
        const shareMethod = document.querySelector('input[name="shareMethod"]:checked')?.value || 'link';

        try {
            // 🔧 根据类型调用不同接口
            const url = itemType === 'folder'
                ? '/api/cloud/shares/'
                : '/api/cloud/shares/';

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TokenManager.getToken()}`
                },
                body: JSON.stringify({
                    file: itemType === 'file' ? itemId : null,
                    folder: itemType === 'folder' ? itemId : null,
                    share_type: shareType,
                    password: password,
                    expires_at: expiresAt || null,
                    max_downloads: maxDownloads ? parseInt(maxDownloads) : null
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || '分享失败');
            }

            const share = await response.json();
            const baseUrl = window.location.origin;
            let shortUrl = share.share_url || `${baseUrl}/s/${share.share_code}/`;
            if (share.password) shortUrl += `?提取码=${share.password}`;

            // 🔧 根据分享方式显示不同内容
            if (shareMethod === 'link') {
                document.getElementById('shareLinkInput').value = shortUrl;
                document.getElementById('shareLink').style.display = 'block';
                document.getElementById('shareQrcode').style.display = 'none';
            } else {
                // 🔧 生成二维码
                document.getElementById('shareLink').style.display = 'none';
                document.getElementById('shareQrcode').style.display = 'block';
                this.generateQrcode(shortUrl);
            }

            this.showSuccess('分享成功', '分享链接已生成');

        } catch (error) {
            console.error('分享失败:', error);
            this.showError('分享失败', error.message);
        }
    }

    /**
     * 🔧 生成二维码
     */
    generateQrcode(url) {
        const container = document.getElementById('qrcodeContainer');
        container.innerHTML = '';

        // 使用 qrcode.js 库生成二维码
        if (typeof QRCode !== 'undefined') {
            new QRCode(container, {
                text: url,
                width: 200,
                height: 200,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            // 降级方案：显示链接
            container.innerHTML = `
                <p style="color:#999;">二维码库未加载，请使用分享链接</p>
                <input type="text" value="${url}" readonly style="width:100%;padding:8px;margin-top:10px;">
            `;
        }
    }

    /**
     * 🔧 下载二维码
     */
    downloadQrcode() {
        const container = document.getElementById('qrcodeContainer');
        const canvas = container.querySelector('canvas');
        if (canvas) {
            const link = document.createElement('a');
            link.download = 'share-qrcode.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
            this.showSuccess('下载成功', '二维码已下载');
        } else {
            this.showError('下载失败', '请先生成二维码');
        }
    }


    /**
     * 🔧 复制分享链接
     */
    async copyShareLink() {
        const input = document.getElementById('shareLinkInput');
        if (input) {
            try {
                await navigator.clipboard.writeText(input.value);
                this.showSuccess('复制成功', '分享链接已复制到剪贴板');
            } catch (error) {
                input.select();
                document.execCommand('copy');
                this.showSuccess('复制成功', '分享链接已复制到剪贴板');
            }
        }
    }

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
            modalTitle.textContent = isFolder ? '重命名文件夹' : '重命名文件';
        }

        this.openModal('renameModal');
    }

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
    }


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

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || '重命名失败');
            }

            const result = await response.json();
            console.log('重命名成功:', result);

            this.showSuccess('重命名成功', `${this.currentRenameType === 'folder' ? '文件夹' : '文件'}已重命名`);
            this.closeModal('renameModal');

            // 刷新当前列表
            await this.loadFiles(this.currentFolderId);

        } catch (error) {
            console.error('重命名失败:', error);
            this.showError('重命名失败', error.message);
        }
    }


    /**
     * 🔧 关键修复：移动文件/文件夹
     * @param {Array} itemIds - 要移动的 ID 列表
     * @param {boolean} isFolder - 是否为文件夹
     */
    async moveItems(itemIds, isFolder = false) {
        this.currentMoveIds = itemIds;
        this.currentMoveType = isFolder ? 'folder' : 'file';
        await this.loadFolderTree();
        this.openModal('moveModal');
    }


    async moveFiles(fileIds) {
        this.currentMoveIds = fileIds;
        await this.loadFolderTree();
        this.openModal('moveModal');
    }


    /**
     * 🔧 关键修复：加载文件夹树（递归加载所有层级）
     */
    async loadFolderTree() {
        try {
            // 🔧 使用 tree 接口获取所有文件夹的树状结构
            const response = await fetch('/api/cloud/folders/tree/', {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载文件夹失败');

            const data = await response.json();
            const treeContainer = document.getElementById('folderTree');

            // 🔧 递归渲染树状结构
            const renderTree = (nodes, level = 0) => {
                let html = '';

                nodes.forEach(node => {
                    const indent = level * 20;
                    const hasChildren = node.children && node.children.length > 0;

                    html += `
                        <div class="folder-tree-item" data-folder-id="${node.id}" style="padding-left: ${indent + 15}px;">
                            <i class="fas fa-folder${hasChildren ? '-open' : ''}"></i>
                            <span>${node.name}</span>
                        </div>
                    `;

                    // 🔧 递归渲染子文件夹
                    if (hasChildren) {
                        html += renderTree(node.children, level + 1);
                    }
                });

                return html;
            };

            let html = `
                <div class="folder-tree-item" data-folder-id="">
                    <i class="fas fa-folder"></i>
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
                    treeContainer.querySelectorAll('.folder-tree-item').forEach(i =>
                        i.classList.remove('selected')
                    );
                    item.classList.add('selected');
                });
            });

        } catch (error) {
            console.error('加载文件夹树失败:', error);
            this.showError('加载失败', error.message);
        }
    }

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
                    await fetch(`/api/cloud/folders/${folderId}/move/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TokenManager.getToken()}`
                        },
                        body: JSON.stringify({new_parent: targetFolderId})
                    });
                }
            } else {
                // 文件移动
                for (const fileId of this.currentMoveIds) {
                    await fetch(`/api/cloud/files/${fileId}/move/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TokenManager.getToken()}`
                        },
                        body: JSON.stringify({target_folder_id: targetFolderId})
                    });
                }
            }

            this.showSuccess('移动成功', '文件/文件夹已移动');
            this.closeModal('moveModal');

            // 刷新当前列表
            if (this.currentView === 'files') {
                await this.loadFiles(this.currentFolderId);
            } else {
                await this.loadFiles(null);
            }

        } catch (error) {
            console.error('移动失败:', error);
            this.showError('移动失败', error.message);
        }
    }


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
    }

    async loadDashboardStats() {
        try {
            const response = await fetch('/api/cloud/dashboard/overview/', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载统计失败');

            const stats = await response.json();
            this.renderDashboard(stats);
        } catch (error) {
            console.error('加载统计失败:', error);
            document.getElementById('dashboardStatsContent').innerHTML =
                `<div class="empty-state"><p>加载失败：${error.message}</p></div>`;
        }
    }

    renderDashboard(stats) {
        const container = document.getElementById('dashboardStatsContent');

        const html = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-file"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.total_files}</div>
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
                        <div class="stat-value">${stats.starred_files}</div>
                        <div class="stat-label">星标文件</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon"><i class="fas fa-share-alt"></i></div>
                    <div class="stat-info">
                        <div class="stat-value">${stats.shared_files}</div>
                        <div class="stat-label">我的分享</div>
                    </div>
                </div>
            </div>
            
            <div class="recent-files-section">
                <h4>最近上传的文件</h4>
                <div class="file-list-simple">
                    ${stats.recent_files?.map(f => `
                        <div class="simple-file-item">
                            <i class="fas ${f.icon_class}"></i>
                            <span>${f.name}</span>
                            <span class="text-muted">${this.formatDate(f.created_at)}</span>
                        </div>
                    `).join('') || ''}
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    // ==================== 系统配置 ====================

    async loadSystemConfigs() {
        try {
            await frontendConfig?.loadConfigs?.();
            this.applySystemConfigs();
            console.log('✅ 系统配置已应用');
        } catch (error) {
            console.warn('⚠️ 加载系统配置失败，使用默认值:', error);
            this.applySystemConfigs();
        }
    }

    applySystemConfigs() {
        this.fileMaxSizeMB = frontendConfig?.get('file.max_upload_size_mb', 50) || 50;
        this.imageMaxSizeMB = frontendConfig?.get('file.image_max_size_mb', 20) || 20;
        this.videoMaxSizeMB = frontendConfig?.get('file.video_max_size_mb', 100) || 100;
        this.audioMaxSizeMB = frontendConfig?.get('file.audio_max_size_mb', 30) || 30;
        this.allowedFileTypes = frontendConfig?.get('file.allowed_types', ['image', 'video', 'audio', 'file']) || ['image', 'video', 'audio', 'file'];
    }

    // ==================== 事件监听 ====================

    setupEventListeners() {
        // 上传按钮
        const uploadBtn = document.getElementById('uploadBtn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => this.openModal('uploadModal'));
        }

        // 新建文件夹按钮
        const newFolderBtn = document.getElementById('newFolderBtn');
        if (newFolderBtn) {
            newFolderBtn.addEventListener('click', () => this.openModal('newFolderModal'));
        }

        // 拖拽上传
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                const files = e.dataTransfer.files;
                for (let file of files) {
                    this.uploadFile(file, this.currentFolderId);
                }
            });
            uploadArea.addEventListener('click', () => {
                const fileInput = document.getElementById('fileInput');
                if (fileInput) fileInput.click();
            });
        }

        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const files = e.target.files;
                for (let file of files) {
                    this.uploadFile(file, this.currentFolderId);
                }
            });
        }

        // 视图切换
        document.querySelectorAll('.view-switcher .btn-icon').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchViewMode(btn.dataset.viewMode);
            });
        });

        // 搜索
        const fileSearch = document.getElementById('fileSearch');
        if (fileSearch) {
            fileSearch.addEventListener('input',
                Utils.debounce((e) => {
                    this.searchFiles(e.target.value);
                }, 300)
            );
        }


        // 🔧 批量操作相关事件
        // 全选复选框
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                this.toggleSelectAll(e.target.checked);
            });
        }

        const selectAllCheckboxHeader = document.getElementById('selectAllCheckboxHeader');
        if (selectAllCheckboxHeader) {
            selectAllCheckboxHeader.addEventListener('change', (e) => {
                this.toggleSelectAll(e.target.checked);
            });
        }


        // 批量删除按钮
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        if (batchDeleteBtn) {
            batchDeleteBtn.addEventListener('click', () => this.batchDelete());
        }

        // 🔧 批量移动按钮
        const batchMoveBtn = document.getElementById('batchMoveBtn');
        if (batchMoveBtn) {
            batchMoveBtn.addEventListener('click', () => this.batchMove());
        }

        // 批量分享按钮
        const batchShareBtn = document.getElementById('batchShareBtn');
        if (batchShareBtn) {
            batchShareBtn.addEventListener('click', () => this.batchShare());
        }

        // 🔧 批量移动模态框关闭时清空状态
        const batchMoveModal = document.getElementById('batchMoveModal');
        if (batchMoveModal) {
            batchMoveModal.addEventListener('click', (e) => {
                if (e.target === batchMoveModal) {
                    this.closeModal('batchMoveModal');
                    this.clearBatchMoveState();
                }
            });
        }

        // 取消选择按钮
        const cancelSelectBtn = document.getElementById('cancelSelectBtn');
        if (cancelSelectBtn) {
            cancelSelectBtn.addEventListener('click', () => this.clearSelection());
        }

        // 点击文件项时的选择逻辑（支持按住 Ctrl/Cmd 多选）
        document.addEventListener('click', (e) => {
            const fileItem = e.target.closest('.file-item, .file-grid-item');
            if (fileItem && !e.target.closest('.file-checkbox, .btn-action')) {
                const fileId = fileItem.dataset.fileId;
                const isFolder = fileItem.dataset.isFolder === 'true';

                // Ctrl/Cmd + 点击：切换选择状态
                if (e.ctrlKey || e.metaKey) {
                    const checkbox = fileItem.querySelector('.file-checkbox');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        this.toggleFileSelection(fileId, checkbox.checked);
                    }
                }
                // 普通点击：打开文件或文件夹
                else {
                    this.handleItemClick(fileId, isFolder);
                }
            }
        });


        // 模态框关闭
        document.querySelectorAll('.modal .close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal');
                if (modal) this.closeModal(modal.id);
            });
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal.id);
            });
        });

        // 🔧 分享类型切换
        const shareType = document.getElementById('shareType');
        if (shareType) {
            shareType.addEventListener('change', (e) => {
                const passwordGroup = document.getElementById('passwordGroup');
                if (passwordGroup) {
                    passwordGroup.style.display = e.target.value === 'password' ? 'block' : 'none';
                }
            });
        }

        // 🔧 分享方式切换
        document.querySelectorAll('input[name="shareMethod"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const shareLink = document.getElementById('shareLink');
                const shareQrcode = document.getElementById('shareQrcode');
                if (shareLink && shareQrcode) {
                    if (e.target.value === 'link') {
                        shareLink.style.display = 'block';
                        shareQrcode.style.display = 'none';
                    } else {
                        shareLink.style.display = 'none';
                        shareQrcode.style.display = 'block';
                    }
                }
            });
        });


        // 🔧 在 setupEventListeners 方法中添加以下事件监听

        // 协作文档导航点击
        document.querySelectorAll('.nav-item[data-view="collaborations"]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView('collaborations');
            });
        });

        // 🔧 关键修复：新建协作文档按钮 -> 改为从文件创建
        const newCollabDocBtn = document.getElementById('newCollabDocBtn');
        if (newCollabDocBtn) {
            newCollabDocBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // this.openNewCollabDocModal();
                cloudApp.createDocFromFile();
            });
        }

        // 协作文档搜索（前端）
        const collabSearch = document.getElementById('collabSearch');
        if (collabSearch) {
            collabSearch.addEventListener('input', Utils.debounce((e) => {
                const keyword = e.target.value.trim();
                if (keyword) {
                    const filtered = this.collabDocs.filter(doc =>
                        doc.name.toLowerCase().includes(keyword.toLowerCase())
                    );
                    this.renderCollaborations(filtered);
                } else {
                    this.renderCollaborations(this.collabDocs);
                }
            }, 300));
        }

        // 🔧 协作文档搜索（后端）
        // const collabSearchBackend = document.getElementById('collabSearch');
        // if (collabSearchBackend) {
        //     collabSearchBackend.addEventListener('input', Utils.debounce((e) => {
        //         this.loadCollaborations({search: e.target.value});
        //     }, 300));
        // }

        // 协作用户搜索
        const collabUserSearch = document.getElementById('collabUserSearch');
        if (collabUserSearch) {
            collabUserSearch.addEventListener('input', Utils.debounce((e) => {
                this.searchCollabUsers(e.target.value, 'collabUserResults');
            }, 300));

            // 点击外部关闭搜索结果
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.collab-user-search')) {
                    const results = document.getElementById('collabUserResults');
                    if (results) results.classList.remove('show');
                }
            });
        }


        // 点击外部关闭搜索结果
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#collabUserResults') &&
                !e.target.closest('#collabUserSearch')) {
                document.getElementById('collabUserResults')?.classList.remove('show');
            }
        });


        // 协作用户搜索（新建）
        const collabUserSearchNew = document.getElementById('collabUserSearchNew');
        if (collabUserSearchNew) {
            collabUserSearchNew.addEventListener('input', Utils.debounce((e) => {
                this.searchCollabUsers(e.target.value, 'collabUserResultsNew');
            }, 300));

            // 点击外部关闭搜索结果
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.collab-user-search')) {
                    const results = document.getElementById('collabUserResultsNew');
                    if (results) results.classList.remove('show');
                }
            });
        }


        // 点击外部关闭搜索结果（新建）
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#collabUserResultsNew') &&
                !e.target.closest('#collabUserSearchNew')) {
                document.getElementById('collabUserResultsNew')?.classList.remove('show');
            }
        });




        // 模态框关闭时清理
        const collabModal = document.getElementById('createCollabDocModal');
        if (collabModal) {
            collabModal.addEventListener('click', (e) => {
                if (e.target === collabModal) {
                    this.closeCreateCollabDocModal();
                }
            });
        }


        // 协作文档管理 Tab 切换
        document.querySelectorAll('.collab-manage-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.collab-manage-tabs .tab-btn').forEach(b =>
                    b.classList.remove('active')
                );
                btn.classList.add('active');

                const tab = btn.dataset.tab;
                document.querySelectorAll('.tab-panel').forEach(panel =>
                    panel.classList.remove('active')
                );
                document.getElementById(`tab-${tab}`).classList.add('active');

                // 如果切换到版本历史，加载版本列表
                if (tab === 'versions' && this.currentCollabDocId) {
                    this.loadCollabVersions(this.currentCollabDocId);
                }
            });
        });

    }

    // ==================== 工具方法 ====================

    /**
     * 🔧 生成随机密码（最大 5 个字符）
     */
    generatePassword(length = 5) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符
        let password = '';
        for (let i = 0; i < length; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        document.getElementById('sharePassword').value = password;
        this.showSuccess('密码已生成', `提取码：${password}`);
    }

    renderAdminInfo() {
        if (this.currentUser) {
            document.getElementById('adminUsername').textContent = this.currentUser.username;
            document.getElementById('adminAvatar').src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
        }
    }

    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }

    showLoading() {
        if (document.querySelector('.loading-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div>';
        document.body.appendChild(overlay);
    }

    hideLoading() {
        document.querySelector('.loading-overlay')?.remove();
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
                dialog.remove();
                resolve(result);
            };

            dialog.querySelector('.cancel').onclick = () => close(false);
            dialog.querySelector(`.${type}`).onclick = () => close(true);
            dialog.querySelector('.close-btn').onclick = () => close(false);

            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = '/login/';
    }

    async logout() {
        const confirmed = await this.showConfirmDialog('退出登录', '确定要退出登录吗？', 'confirm');
        if (confirmed) {
            try {
                await API.logout();
            } catch (e) {
                console.error('登出失败:', e);
            } finally {
                localStorage.removeItem('access_token');
                localStorage.removeItem('user_id');
                localStorage.removeItem('user_type');
                window.location.href = '/login/';
            }
        }
    }
}

// 全局初始化
let cloudApp = null;
document.addEventListener('DOMContentLoaded', () => {
    cloudApp = new CloudApp();
    window.cloudApp = cloudApp;
});