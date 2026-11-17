/**
 * @File   : cloud.js
 * @Time   : 2026/3/16
 * @Author : dayue
 * @Desc   : 企业网盘前端逻辑（完善版 - 支持文件夹层级导航/响应式布局）
 */

// 说明：分片上传器、文件列表、协作文档、上传、分享/共享文件夹、回收站/移动/日志/配置已拆分到 cloud-*.js；由 cloud-boot.js 统一启动。


// cloud.js - 在 CloudApp 类中添加或作为独立类

/**
 * 🔧 分片上传管理器 - 支持断点续传和进度回调
 */


class CloudApp {
    constructor() {
        // 🔧 核心状态
        this.currentFolderId = null;          // 当前文件夹 ID（null 表示根目录）
        this.pathStack = [];                   // 面包屑路径栈 [{id, name}]
        this.sharedFolderPathStack = [];       // 共享文件夹面包屑路径
        this.currentView = 'files';            // 当前视图：files/starred/shared/shared-with-me/trash
        this.viewMode = 'grid';                // 视图模式：list/grid
        this.contextTarget = null;             // 右键菜单目标元素
        this.statusCode = null;

        this.pagination = {
            files: {page: 1, pageSize: 20, count: 0, next: null, previous: null},
            shares: {page: 1, pageSize: 10, count: 0, next: null, previous: null, search: ''},
            collabs: {page: 1, pageSize: 20, count: 0, next: null, previous: null},
            sharedFolders: {page: 1, pageSize: 20, count: 0, next: null, previous: null}
        };

        // 🔧 配置（从前端配置管理器获取）
        this.fileMaxSizeMB = 50;
        this.imageMaxSizeMB = 20;
        this.videoMaxSizeMB = 100;
        this.audioMaxSizeMB = 30;
        this.allowedFileTypes = ['image', 'video', 'audio', 'file'];
        this.storageQuotaGB = 10;
        this.downloadEnabled = false;
        this.defaultExpireDays = 7;
        this.defaultMaxDownloads = 0;


        // 🔧 新增：分片上传相关属性
        this.chunkedUploaders = new Map();  // 存储进行中的上传任务 (sessionId -> ChunkedUploader)
        this.uploadProgressMap = new Map();  // 存储上传进度 (fileId -> progress)
        // 🔧 新增：上传速度追踪
        this.uploadTrackers = new Map(); // 文件名 -> {startTime, loaded, lastUpdateTime, lastLoaded}

        // 🔧 上传配置
        this.uploadConfig = {
            chunkSize: 5 * 1024 * 1024,      // 5MB 分片
            concurrent: 3,                    // 并发 3 个分片
            retryCount: 3,                    // 失败重试 3 次
            maxFileSize: 500 * 1024 * 1024    // 最大 500MB 使用分片上传
        };


        // 🔧 UI 状态
        this.sidebarOpen = false;

        this.currentRenameId = null;
        this.currentRenameType = 'file';  // 'file' 或 'folder'
        this.currentRenameName = '';

        this.currentMoveIds = [];
        this.currentMoveType = 'file'; // 'file' 或 'folder'
        this.lastFolderId = null

        this.currentShareFileId = null;
        this.currentUser = null;
        this.cloud_home_url = '/cloud/';
        this.cloud_login_url = '/cloud/login/';
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
                window.location.href = this.cloud_login_url;
                return;
            }

            // 2. 获取用户信息
            this.currentUser = await API.getCurrentUser();
            if (this.currentUser?.user_type === 'super_admin') {
                document.getElementById('cloudSystemConfig').style.display = '';
            }
            this.renderAdminInfo();

            // 3. 加载系统配置
            await this.loadSystemConfigs();

            // 4. 加载仪表盘数据（存储信息）
            await this.loadDashboard();

            // 5. 加载文件列表（根目录）
            await this.loadFiles(null);

            // 🔧 关键修复：初始化主题（必须在设置事件监听前或同时调用，确保页面加载时应用正确主题）
            this.initTheme();

            // 6. 设置事件监听
            this.setupEventListeners();
            this.setupSidebar();
            this.setupContextMenu();
            this._setupGlobalClickHandler();

            // 7. 列表视图：初始化列宽拖拽调整
            this.initListColumnResizers();

            console.log('✅ CloudApp 初始化完成');

        } catch (error) {
            console.error('❌ 初始化失败:', error);
            this.showError('初始化失败', error.message);
            this.handleAuthError();
        }
    }

    // ==================== 列表视图：列宽拖拽调整 ====================

    /**
     * 为全部文件 / 协作文档 / 共享文件夹 / 回收站的列表视图添加列宽拖拽手柄。
     * - 鼠标、触控笔、手指触摸统一使用 Pointer Events
     * - 表头与行共用 --list-columns 变量，列宽实时同步
     * - 宽度按列表持久化到 localStorage，双击（触屏双击）手柄恢复默认
     */
    initListColumnResizers() {
        const configurations = [
            {
                listId: 'fileListView',
                storageKey: 'cloud_list_col_widths',
                columns: [
                    {key: 'name', min: 140, track: 'minmax(200px, 1fr)'},
                    {key: 'size', min: 70, track: '110px'},
                    {key: 'date', min: 90, track: '160px'},
                    {key: 'actions', min: 140, track: '300px'}
                ]
            },
            {
                listId: 'collabListView',
                storageKey: 'cloud_collab_col_widths',
                columns: [
                    {key: 'name', min: 140, track: 'minmax(180px, 1fr)'},
                    {key: 'type', min: 70, track: '110px'},
                    {key: 'collaborators', min: 80, track: '110px'},
                    {key: 'date', min: 90, track: '160px'},
                    {key: 'actions', min: 100, track: '220px'}
                ]
            },
            {
                listId: 'sharedFoldersListView',
                storageKey: 'cloud_shared_folder_col_widths',
                columns: [
                    {key: 'name', min: 140, track: 'minmax(180px, 1fr)'},
                    {key: 'size', min: 100, track: '170px'},
                    {key: 'owner', min: 100, track: '160px'},
                    {key: 'date', min: 90, track: '160px'},
                    {key: 'actions', min: 90, track: '140px'}
                ]
            },
            {
                listId: 'trashListView',
                storageKey: 'cloud_trash_col_widths',
                columns: [
                    {key: 'name', min: 140, track: 'minmax(200px, 1fr)'},
                    {key: 'size', min: 70, track: '110px'},
                    {key: 'date', min: 90, track: '160px'},
                    {key: 'actions', min: 90, track: '160px'}
                ]
            }
        ];

        configurations.forEach(config => this._initColumnResizer(config));
    }

    _initColumnResizer({listId, storageKey, columns}) {
        const list = document.getElementById(listId);
        if (!list) return;
        const header = list.querySelector('.file-list-header');
        if (!header) return;

        const cols = columns.map(c => c.key);
        const minWidths = {};
        const defaultTracks = {};
        columns.forEach(c => {
            minWidths[c.key] = c.min;
            defaultTracks[c.key] = c.track;
        });

        let widths = {};
        try { widths = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (e) { widths = {}; }
        Object.keys(widths).forEach(k => {
            if (cols.indexOf(k) === -1 || !(widths[k] > 0)) delete widths[k];
        });

        list.classList.add('col-resizable-list');

        const applyTemplate = () => {
            const template = columns
                .map(c => widths[c.key] ? Math.round(widths[c.key]) + 'px' : defaultTracks[c.key])
                .join(' ');
            list.style.setProperty('--list-columns', template);
        };
        applyTemplate();

        const cells = Array.from(header.querySelectorAll('.file-col'));
        const cellFor = (col) => {
            const idx = cols.indexOf(col);
            return idx >= 0 ? cells[idx] : null;
        };
        const currentWidth = (col) => {
            if (widths[col]) return widths[col];
            const cell = cellFor(col);
            return cell ? Math.round(cell.getBoundingClientRect().width) : 0;
        };
        const layoutMetrics = () => {
            const style = getComputedStyle(header);
            const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
            const gap = parseFloat(style.columnGap || style.gap) || 0;
            return {inner: Math.max(0, list.clientWidth - padding), gap};
        };
        const maxWidthFor = (col) => {
            const {inner, gap} = layoutMetrics();
            const gaps = gap * (columns.length - 1);
            let used = 0;
            columns.forEach(c => {
                if (c.key === col) return;
                // 名称列若为自适应宽度，按最小宽度预留，拖动其它列时名称列自动收缩
                if (c.key === 'name' && col !== 'name') {
                    used += widths.name || minWidths.name;
                } else {
                    used += currentWidth(c.key);
                }
            });
            return Math.max(minWidths[col], Math.round(inner - gaps - used));
        };

        const resetWidths = () => {
            widths = {};
            applyTemplate();
            try { localStorage.removeItem(storageKey); } catch (err) { }
        };

        cells.forEach((cell, idx) => {
            const col = cols[idx];
            if (!col) return;

            const oldHandle = cell.querySelector('.col-resizer');
            if (oldHandle) oldHandle.remove();
            cell.classList.add('resizable');

            const handle = document.createElement('span');
            handle.className = 'col-resizer';
            handle.title = '拖动调整列宽（双击恢复默认）';
            handle.dataset.col = col;
            cell.appendChild(handle);

            let lastTap = 0;
            let lastTapMoved = false;

            handle.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.button !== undefined && e.button !== 0) return;

                // 双击（含触屏双击）恢复默认列宽；上一手势需为原地点击，避免连续拖动误触
                const now = Date.now();
                if (now - lastTap < 320 && !lastTapMoved) {
                    lastTap = 0;
                    resetWidths();
                    return;
                }
                lastTap = now;
                lastTapMoved = false;

                const startX = e.clientX;
                const startW = currentWidth(col);
                const maxW = maxWidthFor(col);
                const ceiling = col === 'name' ? maxW : Math.min(maxW, 480);
                const pointerId = e.pointerId;

                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                list.classList.add('column-resizing');
                try { handle.setPointerCapture(pointerId); } catch (err) { }

                let moved = false;

                const onMove = (ev) => {
                    if (pointerId !== undefined && ev.pointerId !== undefined && ev.pointerId !== pointerId) return;
                    const delta = ev.clientX - startX;
                    if (Math.abs(delta) > 2) moved = true;
                    const w = Math.max(minWidths[col], Math.min(startW + delta, ceiling));
                    widths[col] = Math.round(w);
                    applyTemplate();
                };
                const finish = () => {
                    document.removeEventListener('pointermove', onMove);
                    document.removeEventListener('pointerup', finish);
                    document.removeEventListener('pointercancel', finish);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    list.classList.remove('column-resizing');
                    lastTapMoved = moved;
                    try { handle.releasePointerCapture(pointerId); } catch (err) { }
                    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch (err) { }
                };

                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', finish);
                document.addEventListener('pointercancel', finish);
            });

            // 鼠标双击恢复默认列宽
            handle.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                resetWidths();
            });
        });

        // 窗口尺寸变化时，避免已手动加宽的名称列把其它列挤出可视区
        if (!list._colResizeWindowBound) {
            list._colResizeWindowBound = true;
            window.addEventListener('resize', () => {
                // 隐藏视图的 clientWidth 为 0，不能用它来夹取已保存的列宽
                if (!list.clientWidth || !widths.name) return;
                const capped = Math.max(minWidths.name, Math.min(widths.name, maxWidthFor('name')));
                if (capped !== Math.round(widths.name)) {
                    widths.name = capped;
                    applyTemplate();
                }
            });
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
        try {
            if (sliceIndex !== null && sliceIndex >= 0) {
                // 🔧 点击面包屑中间项：截断路径
                this.pathStack = this.pathStack.slice(0, sliceIndex + 1);
            } else if (folderId === null) {
                // 🔧 返回根目录
                this.pathStack = [];
            } else {
                // 🔧 进入新文件夹：检查是否已存在，防止重复添加
                const existingIndex = this.pathStack.findIndex(item => item.id === folderId);

                if (existingIndex !== -1) {
                    // 如果路径中已存在该文件夹，截断到该位置（处理循环导航或历史状态不一致）
                    this.pathStack = this.pathStack.slice(0, existingIndex + 1);
                } else {
                    // 获取文件夹名称并压入栈
                    const folderName = this.getFolderNameById(folderId);
                    if (folderName) {
                        this.pathStack.push({id: folderId, name: folderName});
                    } else {
                        console.warn(`未能获取文件夹 ${folderId} 的名称`);
                        // 即使没有名称也尝试导航，但使用默认名或ID
                        this.pathStack.push({id: folderId, name: '未知文件夹'});
                    }
                }
            }

            this.currentFolderId = folderId;

            // 更新 UI
            this.updateBreadcrumb();

            // 加载文件数据
            await this.loadFiles(folderId);

        } catch (error) {
            console.error('导航失败:', error);
            this.showError('导航错误', '无法进入该文件夹');
        }
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
     * 🔧 根据ID获取文件夹名称（增强版，支持从多个来源查找）
     */
    getFolderNameById(folderId) {
        // 1. 从当前渲染的文件列表中查找
        const items = document.querySelectorAll('.file-item, .file-grid-item');
        for (const item of items) {
            if (item.dataset.fileId === folderId && item.dataset.isFolder === 'true') {
                return item.querySelector('.file-name')?.textContent || '未知文件夹';
            }
        }

        // 2. 从路径栈中查找
        if (this.sharedFolderPathStack) {
            const found = this.sharedFolderPathStack.find(item => item.id === folderId);
            if (found) {
                return found.name;
            }
        }

        // 3. 默认返回
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

        console.log('currentView: ', view)
        // 🔧 切换视图时重置分页
        if (view === 'files') this.pagination.files.page = 1;
        else if (view === 'shared') this.pagination.shares.page = 1;
        else if (view === 'collaborations') this.pagination.collabs.page = 1;
        else if (view === 'shared-folders') this.pagination.sharedFolders.page = 1;

        // 🔧 关键：只在"全部文件"视图下支持文件夹钻取
        if (view !== 'files') {
            this.pathStack = [];
        }

        // 🔧 关键修复：只在"共享文件夹"视图下支持共享文件夹钻取
        if (view !== 'shared-folders') {
            this.sharedFolderPathStack = [];
            this.currentFolderId = null;
        } else {
            this.currentFolderId = folderId || null;
        }

        // 更新面包屑
        this.updateBreadcrumb();
        this.updateSharedFolderBreadcrumb()

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
            case 'shared-folders':
                document.getElementById('sharedFoldersView').classList.add('active');
                await this.loadSharedFolders();
                break;
            case 'trash':
                document.getElementById('trashView').classList.add('active');
                await this.loadTrash();
                break;
            case 'dashboard':
                document.getElementById('dashboardView').classList.add('active');
                await this.loadDashboardStats();
                break;
            case 'operation-log':
                document.getElementById('operationLogView').classList.add('active');
                await this.loadOperationLogs();
                break;
            case 'org':
                document.getElementById('orgView').classList.add('active');
                break;
            case 'chat':
                document.getElementById('chatView').classList.add('active');
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
        this.switchSharedFolderViewMode(mode)

    }


    /**
     * 🔧 渲染分页控件
     * @param {string} type - 分页类型: 'files', 'shares', 'collabs', 'sharedFolders'
     */
    renderPagination(type) {
        const containerId = `paginationContainer${type.charAt(0).toUpperCase() + type.slice(1)}`;
        const container = document.getElementById(containerId);
        if (!container) return;

        const pag = this.pagination[type];
        if (!pag || pag.count === 0) {
            container.innerHTML = '';
            return;
        }

        const totalPages = Math.max(1, Math.ceil(pag.count / pag.pageSize));
        const currentPage = pag.page;

        container.innerHTML = `
            <div class="pagination-wrapper">
                <div class="pagination-info">共 ${pag.count} 项，第 ${currentPage}/${totalPages} 页</div>
                <div class="pagination-controls">
                    <button class="pagination-btn" 
                            onclick="cloudApp.changePage('${type}', 1)" 
                            ${currentPage <= 1 ? 'disabled' : ''}
                            title="首页">
                        <i class="fas fa-angle-double-left"></i>
                    </button>
                    <button class="pagination-btn" 
                            onclick="cloudApp.changePage('${type}', ${currentPage - 1})" 
                            ${!pag.previous ? 'disabled' : ''}
                            title="上一页">
                        <i class="fas fa-angle-left"></i>
                    </button>
                    ${this._renderPageNumbers(type, currentPage, totalPages)}
                    <button class="pagination-btn" 
                            onclick="cloudApp.changePage('${type}', ${currentPage + 1})" 
                            ${!pag.next ? 'disabled' : ''}
                            title="下一页">
                        <i class="fas fa-angle-right"></i>
                    </button>
                    <button class="pagination-btn" 
                            onclick="cloudApp.changePage('${type}', ${totalPages})" 
                            ${currentPage >= totalPages ? 'disabled' : ''}
                            title="末页">
                        <i class="fas fa-angle-double-right"></i>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 🔧 渲染页码
     */
    _renderPageNumbers(type, currentPage, totalPages) {
        let html = '';
        const showPages = 7; // 最多显示页码数

        let start = Math.max(1, currentPage - Math.floor(showPages / 2));
        let end = Math.min(totalPages, start + showPages - 1);

        // 调整起始位置，确保显示足够页码
        if (end - start + 1 < showPages) {
            start = Math.max(1, end - showPages + 1);
        }

        // 第一页和省略号
        if (start > 1) {
            html += `<button class="pagination-btn" onclick="cloudApp.changePage('${type}', 1)">1</button>`;
            if (start > 2) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
        }

        // 中间页码
        for (let i = start; i <= end; i++) {
            html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
                              onclick="cloudApp.changePage('${type}', ${i})">${i}</button>`;
        }

        // 最后一页和省略号
        if (end < totalPages) {
            if (end < totalPages - 1) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
            html += `<button class="pagination-btn" onclick="cloudApp.changePage('${type}', ${totalPages})">${totalPages}</button>`;
        }

        return html;
    }


    /**
     * 🔧 切换页码
     * @param {string} type - 分页类型
     * @param {number} page - 目标页码
     */
    changePage(type, page) {
        if (page < 1) return;

        const pag = this.pagination[type];
        const totalPages = Math.max(1, Math.ceil(pag.count / pag.pageSize));

        if (page > totalPages) return;

        pag.page = page;

        console.log(`📄 切换页码: type=${type}, page=${page}`);

        // 根据类型加载对应数据
        switch (type) {
            case 'files':
                this.loadFiles(this.currentFolderId);
                break;
            case 'shares':
                this.loadMyShares();
                break;
            case 'collabs':
                this.loadCollaborations();
                break;
            case 'sharedFolders':
                this.loadSharedFolders(this.currentFolderId);
                break;
        }

        // 滚动到列表顶部
        const scrollContainer = document.querySelector(
            type === 'files' ? '.file-list-container' :
                type === 'shares' ? '#mySharesList' :
                    type === 'collabs' ? '#collabListView' :
                        '.file-list-container'
        );

        if (scrollContainer) {
            scrollContainer.scrollTo({top: 0, behavior: 'smooth'});
        }
    }


    /**
     * 🔧 转义工具方法（如果不存在则添加）
     */


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


    handleContextMenu(e, fileId, isFolder, sourceName) {
        e.preventDefault();
        e.stopPropagation();

        // 🔧 保存类型信息
        this.contextTarget = {fileId, isFolder, sourceName};
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
            const {fileId, isFolder, sourceName} = this.contextTarget;

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
            const {fileId, isFolder, sourceName} = this.contextTarget;
            this.moveItems([fileId], isFolder, sourceName);
        }
        this.hideContextMenu();
    }

    /**
     * 🔧 右键菜单删除
     */
    deleteSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder, sourceName} = this.contextTarget;
            this.deleteItem(fileId, isFolder, sourceName);
        }
        this.hideContextMenu();
    }

    // ==================== 主题切换功能 ====================
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
        // 更新图标
        const themeIcon = document.querySelector('#themeToggleBtn i');
        if (themeIcon) {
            themeIcon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
        }
        console.log(`🌗 主题已切换为: ${theme}`);
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

        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadFiles(this.currentFolderId));
        }

        // 👇 新增：绑定同步聊天室文档按钮
        const syncChatBtn = document.getElementById('syncChatDocsBtn');
        if (syncChatBtn) {
            syncChatBtn.addEventListener('click', () => this.syncChatDocuments());
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
                this._warnBigExcel(files);

                // 🔧 支持批量上传
                if (files.length > 1) {
                    this.uploadMultipleFiles(files, this.currentFolderId);
                } else {
                    for (let file of files) {
                        this.uploadFile(file, this.currentFolderId);
                    }
                }

                this.closeModal('uploadModal');
            });

            uploadArea.addEventListener('click', () => {
                const fileInput = document.getElementById('fileInput');
                if (fileInput) fileInput.click();
            });
        }

        // 文件输入
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const files = e.target.files;
                this._warnBigExcel(files);

                // 🔧 支持批量上传
                if (files.length > 1) {
                    this.uploadMultipleFiles(files, this.currentFolderId);
                } else {
                    for (let file of files) {
                        this.uploadFile(file, this.currentFolderId);
                    }
                }

                this.closeModal('uploadModal');
            });
        }


        // 视图切换
        document.querySelectorAll('.view-switcher .btn-icon').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchViewMode(btn.dataset.viewMode);
            });
        });

        // // 搜索
        // const fileSearch = document.getElementById('fileSearch');
        // if (fileSearch) {
        //     fileSearch.addEventListener('input',
        //         Utils.debounce((e) => {
        //             this.searchFiles(e.target.value);
        //         }, 300)
        //     );
        // }

        // 🔧 文件搜索（防抖处理）
        const fileSearchInput = document.getElementById('fileSearch');
        if (fileSearchInput) {
            let searchTimer = null;
            fileSearchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    // 搜索时重置到第一页
                    this.pagination.files.page = 1;
                    this.loadFiles(this.currentFolderId);
                }, 500); // 500ms 防抖
            });

            // 回车搜索
            fileSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(searchTimer);
                    this.pagination.files.page = 1;
                    this.loadFiles(this.currentFolderId);
                }
            });
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

        // 🔧 我的分享搜索功能
        const shareSearchInput = document.getElementById('shareSearchInput');
        if (shareSearchInput) {
            // 使用防抖避免频繁请求
            const debounceSearch = Utils.debounce((e) => {
                this.pagination.shares.search = e.target.value.trim();
                this.pagination.shares.page = 1; // 搜索时重置到第一页
                this.loadMyShares();
            }, 500);
            shareSearchInput.addEventListener('input', debounceSearch);
        }


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
                    // if (results) results.classList.remove('show');
                }
            });
        }


        // 点击外部关闭搜索结果
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#collabUserResults') &&
                !e.target.closest('#collabUserSearch')) {
                // document.getElementById('collabUserResults')?.classList.remove('show');
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
            document.getElementById('adminUsername').textContent = this.currentUser.real_name || this.currentUser.username;
            document.getElementById('adminUsername').title = `当前账号：${this.currentUser.username}`;
            document.getElementById('adminAvatar').src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
            document.getElementById('adminAvatar').title = `当前账号：${this.currentUser.username}`;
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

    openModal(modalId, sourceName = null) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
            // 更新标题
            const titleEl = modal.querySelector('.modal-title');
            if (titleEl && sourceName && modalId === 'moveModal') {
                titleEl.innerHTML = `<i class="fas fa-cut"></i> 移动：<strong>${sourceName}</strong> 到`;
            }
            if (titleEl && modalId === 'uploadModal') {
                var currentFolderName = this.pathStack.length > 0 ? this.pathStack[this.pathStack.length -1]?.name + '目录' || '当前目录' : '当前目录'
                titleEl.innerHTML = `<i class="fas fa-upload"></i> <strong>上传文件</strong> 到 ${currentFolderName}`;
            }
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


    /**
     * 更新加载提示（辅助方法）
     * @param {string} message - 提示消息
     */
    updateLoading(message) {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            const spinner = overlay.querySelector('.loading-text');
            if (spinner) spinner.textContent = message;
        }
    }

    hideLoading() {
        document.querySelector('.loading-overlay')?.remove();
    }


    /**
     * 计算文件 MD5（分块读取版 - 企业级推荐）
     * @param {File} file - 文件对象
     * @param {number} chunkSize - 分块大小（字节），默认 2MB
     * @param {function} onProgress - 进度回调函数 (currentChunk, totalChunks, percent)
     * @returns {Promise<string>} MD5 字符串（32位小写十六进制）
     */
    async computeFileMd5(file, chunkSize = 2 * 1024 * 1024, onProgress = null) {
        return new Promise((resolve, reject) => {
            // 参数校验
            if (!file || !(file instanceof File)) {
                reject(new Error('无效的文件对象'));
                return;
            }

            const spark = new SparkMD5.ArrayBuffer();
            const fileSize = file.size;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            let currentChunk = 0;

            // 空文件处理
            if (fileSize === 0) {
                resolve(SparkMD5.hash(''));
                return;
            }

            const loadNext = () => {
                const start = currentChunk * chunkSize;
                const end = Math.min(start + chunkSize, fileSize);

                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        spark.append(e.target.result);
                        currentChunk++;

                        // 进度回调
                        if (typeof onProgress === 'function') {
                            const percent = Math.round((currentChunk / totalChunks) * 100);
                            onProgress(currentChunk, totalChunks, percent);
                        }

                        if (currentChunk < totalChunks) {
                            // 使用 setTimeout 避免阻塞主线程
                            setTimeout(loadNext, 0);
                        } else {
                            // 计算完成
                            const md5 = spark.end();
                            resolve(md5.toLowerCase());
                        }
                    } catch (error) {
                        reject(new Error(`MD5 计算错误: ${error.message}`));
                    }
                };

                reader.onerror = () => {
                    reject(new Error(`读取文件块 ${currentChunk + 1} 失败`));
                };

                reader.onabort = () => {
                    reject(new Error('文件读取被中止'));
                };

                // 读取文件块
                reader.readAsArrayBuffer(file.slice(start, end));
            };

            // 开始读取
            loadNext();
        });
    }


    /**
     * 使用 Web Worker 计算文件 MD5（超大文件推荐）
     * @param {File} file - 文件对象
     * @param {function} onProgress - 进度回调
     * @returns {Promise<string>} MD5 字符串
     */
    async computeFileMd5WithWorker(file, onProgress = null) {
        return new Promise((resolve, reject) => {
            // 检查浏览器支持
            if (!window.Worker) {
                // 降级使用主线程版本
                return this.computeFileMd5(file, 2 * 1024 * 1024, onProgress)
                    .then(resolve)
                    .catch(reject);
            }

            const worker = new Worker('/static/js/md5-worker.js');

            worker.onmessage = (e) => {
                if (e.data.type === 'progress' && typeof onProgress === 'function') {
                    onProgress(e.data.current, e.data.total, e.data.percent);
                } else if (e.data.type === 'complete') {
                    worker.terminate();
                    resolve(e.data.md5);
                } else if (e.data.type === 'error') {
                    worker.terminate();
                    reject(new Error(e.data.message));
                }
            };

            worker.onerror = (error) => {
                worker.terminate();
                reject(new Error(`Worker 错误: ${error.message}`));
            };

            /// 🔧 修复2: 移除 [file] 参数，使用克隆方式传递（File 对象可克隆但不可转移）
            worker.postMessage({
                file: file,
                chunkSize: 2 * 1024 * 1024  // 可选：传递分块大小
            });
            // ❌ 错误写法: worker.postMessage({file}, [file]);
        });
    }


    // ==================== Excel 兼容格式转换（WPS/新版 Excel 单元格内图片） ====================
    _isSpreadsheetName(name) {
        return /\.(xlsx|xlsm|xls)$/i.test(String(name || ''));
    }
    // 上传 Excel 前提示（产品层：大型 Excel 多为单元格内图片，提示先本地转浮动图片）
    _warnBigExcel(files) {
        if (!files || !files.length) return;
        const BIG = 15 * 1024 * 1024; // 15MB 以上视为“异常大”
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f || !f.name) continue;
            if (/\.(xlsx|xlsm|xls)$/i.test(f.name) && f.size >= BIG) {
                this.showWarning('上传提示', '检测到大型 Excel（可能包含大量“单元格内图片”）。若在线预览图片不显示，请在本地 WPS/Excel 把“单元格图片”批量转为“浮动图片”后重新上传；原始文件将原样保存，不会做任何转换。');
                return;
            }
        }
    }
    // 手动触发「转换为兼容格式」：后台 LibreOffice 清洗为 OnlyOffice 可识别标准格式
    async convertCompatibleFile(id, name) {
        this.showInfo('格式转换', `已开始为「${name || ''}」生成兼容副本（原始文件会保留）；大表格可能需要几分钟，转换期间请勿在线编辑。`);
        try {
            const resp = await fetch(`/api/cloud/files/${id}/convert_compatible/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            const data = await resp.json();
            if (!resp.ok) {
                this.showError('格式转换', (data && (data.error || data.message)) || '请求失败，请重试');
                return;
            }
            this._pollConvertStatus(id);
        } catch (e) {
            console.error('convertCompatibleFile error', e);
            this.showError('格式转换', '请求失败：' + (e.message || e));
        }
    }
    _pollConvertStatus(id) {
        let tries = 0;
        const timer = setInterval(async () => {
            tries++;
            try {
                const r = await fetch(`/api/cloud/files/${id}/convert_compatible/`, {headers: TokenManager.getHeaders()});
                const d = await r.json();
                const st = d && d.state;
                if (st === 'done') {
                    clearInterval(timer);
                    this.showSuccess('格式转换', '转换完成：已生成兼容副本（原始文件已保留）。重新打开时会默认使用兼容副本，并可在编辑页一键切回原始文件。');
                    this.loadFiles(this.currentFolderId);
                } else if (st === 'error' || st === 'error_nofile' || st === 'error_unavailable') {
                    clearInterval(timer);
                    this.showError('格式转换', '转换失败，请检查服务器是否已安装 LibreOffice(soffice) 后重试。');
                } else if (tries >= 40) {
                    clearInterval(timer);
                    this.showInfo('格式转换', '仍在后台转换中，请稍后刷新查看结果。');
                }
            } catch (e) {
                console.warn('poll convert status error', e);
            }
        }, 8000);
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
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.cloud_login_url;
    }

    async logout() {
        const confirmed = await this.showConfirmDialog('退出登录', '确定要退出登录吗？', 'confirm');
        if (confirmed) {
            try {
                await API.logout();
            } catch (e) {
                console.error('登出失败:', e);
            } finally {
                this.handleAuthError();
            }
        }
    }

    // 🔧 全局点击关闭下拉菜单
    _setupGlobalClickHandler() {
        document.addEventListener('click', () => {
            document.querySelectorAll('.user-dropdown-menu').forEach(d => {
                d.style.display = 'none';
            });
        });
    }

    // 🔧 用户下拉菜单切换
    toggleUserDropdown(event) {
        event.stopPropagation();
        const dropdown = document.getElementById('userDropdownMenu');
        if (!dropdown) return;
        document.querySelectorAll('.user-dropdown-menu').forEach(d => {
            if (d !== dropdown) d.style.display = 'none';
        });
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    }


}