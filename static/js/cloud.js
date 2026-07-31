/**
 * @File   : cloud.js
 * @Time   : 2026/3/16
 * @Author : dayue
 * @Desc   : 企业网盘前端逻辑（完善版 - 支持文件夹层级导航/响应式布局）
 */


// cloud.js - 在 CloudApp 类中添加或作为独立类

/**
 * 🔧 分片上传管理器 - 支持断点续传和进度回调
 */
class ChunkedUploader {
    constructor(options = {}) {
        this.file = options.file;                    // File 对象
        this.fileName = options.fileName;            // 文件名
        this.fileSize = options.fileSize;            // 文件大小
        this.fileMd5 = options.fileMd5;              // 文件完整MD5
        this.chunkSize = options.chunkSize || 5 * 1024 * 1024;  // 分片大小，默认5MB
        this.concurrent = options.concurrent || 3;   // 并发上传数
        this.retryCount = options.retryCount || 3;   // 失败重试次数

        this.sessionId = null;                        // 上传会话ID
        this.totalChunks = 0;                         // 总分片数
        this.uploadedChunks = new Set();              // 已上传的分片索引
        this.missingChunks = [];                      // 待上传的分片索引

        this.isPaused = false;                        // 是否暂停
        this.isCancelled = false;                     // 是否取消
        this.isCompleted = false;                     // 是否完成

        // 回调函数
        this.onProgress = options.onProgress || (() => {
        });      // (progress, uploaded, total)
        this.onChunkSuccess = options.onChunkSuccess || (() => {
        }); // (chunkIndex)
        this.onChunkError = options.onChunkError || (() => {
        });     // (chunkIndex, error)
        this.onComplete = options.onComplete || (() => {
        });         // (fileInfo)
        this.onError = options.onError || (() => {
        });               // (error)
        this.onQuickUpload = options.onQuickUpload || (() => {
        });   // (fileInfo) 秒传回调
    }

    /**
     * 计算文件分片
     */
    _sliceFile(start, end) {
        return this.file.slice(start, end);
    }

    /**
     * 计算分片MD5
     */
    async _calculateChunkMd5(chunkBlob) {
        return new Promise((resolve, reject) => {
            const spark = new SparkMD5.ArrayBuffer();
            const reader = new FileReader();

            reader.onload = (e) => {
                spark.append(e.target.result);
                resolve(spark.end().toLowerCase());
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(chunkBlob);
        });
    }

    /**
     * 初始化上传会话
     */
    async initUpload(folderId = null, description = '', tags = '') {
        try {
            const response = await fetch('/api/cloud/files/init_upload/', {
                method: 'POST',
                headers: {
                    ...TokenManager.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_name: this.fileName,
                    file_size: this.fileSize,
                    file_md5: this.fileMd5,
                    chunk_size: this.chunkSize,
                    folder: folderId,
                    description: description,
                    tags: tags
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '初始化上传失败');
            }

            const data = await response.json();

            // 🔧 处理秒传
            if (data.status === 'quick_upload') {
                this.isCompleted = true;
                this.onQuickUpload(data.file);
                return {quickUpload: true, file: data.file};
            }

            // 🔧 处理断点续传或新上传
            this.sessionId = data.session.id;
            this.totalChunks = data.session.total_chunks;
            this.uploadedChunks = new Set(data.session.uploaded_chunks);

            // 🔧🔧🔧 关键修复：严格过滤 missingChunks，确保是有效的数字数组
            this.missingChunks = (data.missing_chunks || [])
                .filter(idx => {
                    const num = Number(idx);
                    return idx !== undefined && idx !== null && !isNaN(num) && num >= 0;
                })
                .map(idx => Number(idx));  // 统一转为数字类型

            console.log('✅ 待上传分片索引:', this.missingChunks);

            // 计算初始进度
            const progress = data.session.progress || 0;
            this.onProgress(progress, this.uploadedChunks.size, this.totalChunks);

            return {
                quickUpload: false,
                sessionId: this.sessionId,
                totalChunks: this.totalChunks,
                missingChunks: this.missingChunks,
                progress: progress
            };

        } catch (error) {
            console.error('初始化上传失败:', error);
            this.onError(error);
            throw error;
        }
    }

    /**
     * 上传单个分片
     */
    async _uploadChunk(chunkIndex, retry = 0) {
        // 🔧🔧🔧 关键修复：严格校验 chunkIndex
        if (chunkIndex === undefined || chunkIndex === null || isNaN(Number(chunkIndex))) {
            const errorMsg = `❌ 无效的分片索引: chunkIndex=${chunkIndex}, type=${typeof chunkIndex}`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }


        if (this.isCancelled) throw new Error('Upload cancelled');
        if (this.isPaused) return null;

        const start = chunkIndex * this.chunkSize;
        const end = Math.min(start + this.chunkSize, this.fileSize);
        const chunkBlob = this._sliceFile(start, end);

        // 计算分片MD5
        const chunkMd5 = await this._calculateChunkMd5(chunkBlob);

        // 构建 FormData
        const formData = new FormData();
        formData.append('session_id', this.sessionId);
        formData.append('chunk_index', chunkIndex);     // 🔧 确保是数字
        formData.append('chunk_md5', chunkMd5);
        formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);

        try {
            // 🔧 关键修复：获取头部并移除 Content-Type
            const headers = TokenManager.getHeaders();
            // 删除可能存在的 Content-Type，让浏览器自动设置 multipart/form-data
            delete headers['Content-Type'];
            delete headers['content-type'];

            // 🔧 调试日志（生产环境可注释）
            console.log(`📤 上传分片 #${chunkIndex}:`, {
                sessionId: this.sessionId,
                chunkSize: chunkBlob.size,
                start,
                end,
                headers: Object.keys(headers)
            });

            const response = await fetch('/api/cloud/files/upload_chunk/', {
                method: 'POST',
                headers: headers,  // 使用清理后的头部
                body: formData  // FormData 会自动设置正确的 Content-Type
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `分片 ${chunkIndex} 上传失败`);
            }

            const result = await response.json();

            if (result.skipped) {
                // 分片已存在，跳过
                return {skipped: true, ...result};
            }

            // 标记为已上传
            this.uploadedChunks.add(chunkIndex);
            this.onChunkSuccess(chunkIndex);

            // 更新进度
            const progress = (this.uploadedChunks.size / this.totalChunks) * 100;
            this.onProgress(progress, this.uploadedChunks.size, this.totalChunks);

            return result;

        } catch (error) {
            console.warn(`分片 ${chunkIndex} 上传失败 (重试 ${retry + 1}/${this.retryCount}):`, error);
            this.onChunkError(chunkIndex, error);

            // 重试逻辑
            if (retry < this.retryCount) {
                const delay = 1000 * Math.pow(2, retry); // 1s, 2s, 4s...
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._uploadChunk(chunkIndex, retry + 1);
            }

            throw error;
        }
    }

    /**
     * 并发上传分片
     */
    async _uploadChunksConcurrently(chunkIndices) {
        // 🔧🔧🔧 关键修复：过滤无效索引
        const validIndices = chunkIndices.filter(idx => {
            const num = Number(idx);
            return idx !== undefined && idx !== null && !isNaN(num) && num >= 0;
        }).map(idx => Number(idx));

        if (validIndices.length === 0) {
            console.log('⚠️ 没有有效的分片需要上传');
            return [];
        }

        console.log(`📦 开始并发上传 ${validIndices.length} 个分片:`, validIndices.slice(0, 10), '...');


        const queue = [...chunkIndices];
        const inProgress = new Set();
        const results = [];

        const processNext = async () => {
            while (queue.length > 0 && !this.isCancelled) {
                // 等待并发限制
                while (inProgress.size >= this.concurrent && !this.isCancelled) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                if (this.isCancelled) break;
                if (this.isPaused) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }

                const chunkIndex = queue.shift();

                // 🔧🔧🔧 二次校验：防止 shift 返回异常值
                if (chunkIndex === undefined || chunkIndex === null) {
                    console.warn('⚠️ queue.shift() 返回空值，跳过');
                    continue;
                }

                inProgress.add(chunkIndex);

                this._uploadChunk(chunkIndex)
                    .then(result => {
                        results.push({chunkIndex, success: true, result});
                    })
                    .catch(error => {
                        results.push({chunkIndex, success: false, error});
                    })
                    .finally(() => {
                        inProgress.delete(chunkIndex);
                    });
            }
        };

        // 启动并发任务
        const workers = Array(Math.min(this.concurrent, chunkIndices.length))
            .fill(null)
            .map(() => processNext());

        await Promise.all(workers);

        if (this.isCancelled) {
            throw new Error('Upload cancelled');
        }

        return results;
    }

    /**
     * 合并分片完成上传
     */
    async mergeChunks(folderId = null, description = null, tags = null) {
        try {

            // 🔧 关键修复：合并前先检查会话状态
            const sessionCheck = await this.checkSession();
            if (sessionCheck && sessionCheck.missingChunks?.length > 0) {
                console.warn(`⚠️ 合并前检查：还有 ${sessionCheck.missingChunks.length} 个分片未上传，尝试补传...`);

                const results = await this._uploadChunksConcurrently(sessionCheck.missingChunks);
                const failed = results.filter(r => !r.success);
                if (failed.length > 0) {
                    throw new Error(`${failed.length} 个分片补传失败`);
                }
            }


            const response = await fetch('/api/cloud/files/merge_chunks/', {
                method: 'POST',
                headers: {
                    ...TokenManager.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    folder: folderId,
                    description: description || null,  // 🔧 确保传递 null 而非空字符串  // null 会被 DRF 正确处理
                    tags: tags || null
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '合并分片失败');
            }

            const data = await response.json();
            this.isCompleted = true;
            this.onComplete(data.file);

            return data;

        } catch (error) {
            console.error('合并分片失败:', error);
            this.onError(error);
            throw error;
        }
    }

    /**
     * 检查会话状态（用于恢复上传）
     */
    async checkSession() {
        if (!this.sessionId) return null;

        try {
            const response = await fetch(
                `/api/cloud/files/check_session/?session_id=${this.sessionId}`,
                {headers: TokenManager.getHeaders()}
            );

            if (!response.ok) return null;

            const data = await response.json();
            if (data.exists && !data.is_completed) {
                this.missingChunks = data.missing_chunks || [];
                return {
                    progress: data.session?.progress || 0,
                    missingChunks: this.missingChunks,
                    uploadedCount: this.uploadedChunks.size
                };
            }
            return null;

        } catch (error) {
            console.warn('检查会话状态失败:', error);
            return null;
        }
    }

    /**
     * 取消上传
     */
    async cancel() {
        this.isCancelled = true;
        this.isPaused = false;

        if (this.sessionId) {
            try {
                await fetch(`/api/cloud/files/cancel_upload/?session_id=${this.sessionId}`, {
                    method: 'DELETE',
                    headers: TokenManager.getHeaders()
                });
            } catch (error) {
                console.warn('取消上传请求失败:', error);
            }
        }

        this.onError(new Error('Upload cancelled by user'));
    }

    /**
     * 暂停上传
     */
    pause() {
        this.isPaused = true;
    }

    /**
     * 恢复上传
     */
    resume() {
        this.isPaused = false;
    }

    /**
     * 主上传流程
     */
    async upload(folderId = null, description = '', tags = '') {
        try {
            // 1. 初始化上传会话
            const initResult = await this.initUpload(folderId, description, tags);
            if (initResult.quickUpload) {
                return initResult;  // 秒传直接返回
            }

            // 2. 上传所有缺失的分片
            if (this.missingChunks.length > 0) {
                console.log(`开始上传 ${this.missingChunks.length} 个分片...`);

                const results = await this._uploadChunksConcurrently(this.missingChunks);

                // 检查是否有失败的分片
                const failed = results.filter(r => !r.success);
                if (failed.length > 0) {
                    throw new Error(`${failed.length} 个分片上传失败`);
                }
            }

            // 3. 合并分片
            console.log('所有分片上传完成，开始合并...');
            // 🔧 确保传递 null 而不是空字符串
            const mergeResult = await this.mergeChunks(
                folderId,
                description || null,   // 🔧 空字符串转 null
                tags || null           // 🔧 空字符串转 null
            );

            return mergeResult;

        } catch (error) {
            if (error.message !== 'Upload cancelled') {
                console.error('上传失败:', error);
                this.onError(error);
            }
            throw error;
        }
    }
}


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
    }

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
    }


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
    }

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
                const isSelected = this.selectedFiles.has(file.id);
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
                            <i class="fas ${isFolder ? 'fa-folder' : file.icon_class || 'fa-file'}" style="color: ${folderColor}"></i>
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
                const isSelected = this.selectedFiles.has(file.id);
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
                        <${tagType} src="${file.file_url}" alt="${file.name}" title="${file.name}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;" />
                    </div>
                ` : `
                    <div class="file-icon">
                        <i class="fas ${isFolder ? 'fa-folder folder' : file.icon_class || 'fa-file'}" style="color: ${folderColor}"></i>
                        
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
    }


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
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载文件夹失败');

            const data = await response.json();
            const folders = data.folders || [];

            // 🔧 递归渲染树状结构
            const renderTree = (nodes, level = 0) => {
                let html = '';

                nodes.forEach(node => {
                    const indent = level * 20;
                    const hasChildren = node.children && node.children.length > 0;
                    const isSharedFolder = node.is_shared_folder || false;
                    console.log('isSharedFolder:', isSharedFolder);
                    html += `
                        <div class="folder-tree-item" 
                             data-folder-id="${node.id}" 
                             data-folder-name="${this.escapeHtml(node.name)}"
                             style="padding-left: ${indent + 15}px;">
                            <i class="fas fa-folder${hasChildren ? '-open' : ''}"></i>
                            <span class="folder-name">${this.escapeHtml(node.name)}</span>
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
    }

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
    }

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
    }

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
    }

    _cloudShowImage(startIdx, list) {
        if (!list || !list.length) return;
        this._cloudImgList = list;
        this._cloudImgIdx = startIdx;
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var pd = list.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="cloudApp._cloudImgClose()" style="position:fixed;top:20px;right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
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
        overlay.addEventListener('click', function(e) { if (e.target === overlay) self._cloudImgClose(); });
    }

    _cloudImgNav(dir) {
        if (!this._cloudImgList || !this._cloudImgList.length) return;
        var len = this._cloudImgList.length;
        if (dir < 0 && this._cloudImgIdx <= 0) { cloudApp._cloudShowTip('已是第一张'); return; }
        if (dir > 0 && this._cloudImgIdx >= len - 1) { cloudApp._cloudShowTip('已是最后一张'); return; }
        this._cloudImgIdx += dir;
        var img = document.getElementById('cloudImgMain');
        var item = this._cloudImgList[this._cloudImgIdx];
        if (img) { img.style.opacity = '0'; var self = this; setTimeout(function() { img.src = item.url; img.style.opacity = '1'; }, 100); }
        var ct = document.getElementById('cloudImgCounter');
        if (ct) ct.textContent = (this._cloudImgIdx + 1) + ' / ' + this._cloudImgList.length;
        var p = document.getElementById('cloudImgPrev');
        var n = document.getElementById('cloudImgNext');
        if (p) { p.style.opacity = this._cloudImgIdx <= 0 ? '0.2' : '1'; p.style.cursor = this._cloudImgIdx <= 0 ? 'default' : 'pointer'; }
        if (n) { n.style.opacity = this._cloudImgIdx >= this._cloudImgList.length - 1 ? '0.2' : '1'; n.style.cursor = this._cloudImgIdx >= this._cloudImgList.length - 1 ? 'default' : 'pointer'; }
    }

    _cloudImgClose() {
        if (this._cloudKeyHandler) { document.removeEventListener('keydown', this._cloudKeyHandler); this._cloudKeyHandler = null; }
        if (this._cloudOverlay) { this._cloudOverlay.remove(); this._cloudOverlay = null; }
        this._cloudImgList = null;
    }

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
    }

    /**
     * 下载文件
     */
    async downloadFile(fileId) {
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
            this.showError('下载失败', error.message || error.error || error);
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
    }


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
                const isOwner = doc.owner?.id === this.currentUser?.id;

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
                const collaboratorCount = doc.collaborator_count || 0;
                const isOwner = doc.owner?.id === this.currentUser?.id;

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
    }


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
    }

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
            titleEl.innerHTML = `<i class="fas fa-file-alt"></i> 创建协作文档：${this.currentCreateFileName}`;
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
    }

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
                    <div class="user-dept">${user.department_info?.name || ''}</div>
                </div>
                <i class="fas fa-plus-circle add-icon" data-user-id="${user.id}" title="添加协作者"></i>
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
    }

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


    // ==================== 文件操作 ====================

    /**
     * 🔧 重构：文件上传（支持分片/断点续传/秒传）
     * @param {File} file - 文件对象
     * @param {string|null} folderId - 目标文件夹 ID
     * @param {string} description - 文件描述
     * @param {string} tags - 文件标签
     */
    async uploadFile(file, folderId = null, description = '', tags = '') {
        if (!file) {
            this.showError('上传失败', '文件不能为空');
            return null;
        }

        // 🔧 文件验证
        if (!this.isValidFileType(file)) {
            this.showError('不支持的文件类型', `允许的类型：${this.allowedFileTypes.join(', ')}`);
            return null;
        }

        if (description === '' && tags === '') {
            // 可选：给用户提示，但不阻止上传
            console.log('提示：建议填写文件描述便于后续管理');
        }

        // 🔧 文件大小验证
        const maxSizeBytes = this.fileMaxSizeMB * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            this.showError('文件过大', `文件大小不能超过${this.fileMaxSizeMB}MB`);
            return null;
        }

        // 🔧 显示上传进度对话框
        const uploadDialog = this.showUploadDialog(file.name);

        try {
            // 🔧 1. 计算文件 MD5（大文件使用 Worker）
            uploadDialog.updateStatus('正在计算文件指纹...');
            const fileMd5 = file.size > 100 * 1024 * 1024
                ? await this.computeFileMd5WithWorker(file, (current, total, percent) => {
                    uploadDialog.updateMd5Progress(percent);
                })
                : await this.computeFileMd5(file, 2 * 1024 * 1024, (current, total, percent) => {
                    uploadDialog.updateMd5Progress(percent);
                });

            console.log('🔐 文件 MD5:', fileMd5);

            // 🔧 2. 初始化上传追踪器（用于计算上传速度）
            this.initUploadTracker(file.name, file.size);

            // 🔧 3. 创建分片上传器
            const uploader = new ChunkedUploader({
                file: file,
                fileName: file.name,
                fileSize: file.size,
                fileMd5: fileMd5,
                chunkSize: this.uploadConfig.chunkSize,
                concurrent: this.uploadConfig.concurrent,
                retryCount: this.uploadConfig.retryCount,

                // 🔧 进度回调 - 关键：在此处更新速度显示
                onProgress: (progress, uploaded, total) => {
                    uploadDialog.updateUploadProgress(progress, uploaded, total);
                    // 🔧 实时更新上传速度
                    this.updateUploadSpeed(file.name, progress, file.size);
                },

                // 🔧 分片成功回调
                onChunkSuccess: (chunkIndex) => {
                    console.log(`✅ 分片 ${chunkIndex} 上传成功`);
                },

                // 🔧 分片失败回调
                onChunkError: (chunkIndex, error) => {
                    console.warn(`❌ 分片 ${chunkIndex} 上传失败:`, error);
                    uploadDialog.updateStatus(`分片 ${chunkIndex} 上传失败，重试中...`);
                },

                // 🔧 秒传回调
                onQuickUpload: (fileInfo) => {
                    uploadDialog.close();
                    // 🔧 清理上传追踪器
                    this.clearUploadTracker(file.name);
                    this.showSuccess('上传成功', `${file.name} 已存在（秒传）`);
                    this.loadFiles(this.currentFolderId);
                },

                // 🔧 完成回调
                onComplete: (fileInfo) => {
                    uploadDialog.close();
                    // 🔧 清理上传追踪器
                    this.clearUploadTracker(file.name);
                    this.showSuccess('上传成功', `${file.name} 上传完成`);
                    this.loadFiles(this.currentFolderId);
                },

                // 🔧 错误回调
                onError: (error) => {
                    uploadDialog.close();
                    // 🔧 清理上传追踪器
                    this.clearUploadTracker(file.name);
                    this.showError('上传失败', error.message || '未知错误');
                }
            });

            // 🔧 4. 存储上传任务（支持取消）
            const sessionId = `upload_${Date.now()}_${file.name}`;
            this.chunkedUploaders.set(sessionId, uploader);

            // 🔧 5. 执行上传
            await uploader.upload(folderId, description, tags);

            // 🔧 6. 清理上传任务
            this.chunkedUploaders.delete(sessionId);

            return {success: true, fileInfo: uploader.fileInfo};

        } catch (error) {
            console.error('文件上传失败:', error);
            uploadDialog.close();
            // 🔧 异常时也要清理追踪器
            this.clearUploadTracker(file.name);
            this.showError('上传失败', error.message);
            return null;
        }
    }


    /**
     * 🔧 批量文件上传
     * @param {FileList} files - 文件列表
     * @param {string|null} folderId - 目标文件夹 ID
     */
    async uploadMultipleFiles(files, folderId = null) {
        if (!files || files.length === 0) {
            this.showError('上传失败', '请选择文件');
            return;
        }

        const totalFiles = files.length;
        let successCount = 0;
        let failCount = 0;

        // 🔧 显示批量上传进度
        const batchDialog = this.showBatchUploadDialog(totalFiles);

        // 🔧 关键修复：串行上传，避免分片会话冲突
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            batchDialog.updateFileProgress(i + 1, totalFiles, file.name);

            try {
                // 🔧 等待当前文件上传完成
                await this.uploadFile(file, folderId);
                successCount++;
            } catch (error) {
                console.error(`文件 ${file.name} 上传失败:`, error);
                failCount++;
            }
        }

        batchDialog.close();
        this.showSuccess('批量上传完成',
            `成功 ${successCount} 个，失败 ${failCount} 个`);
        await this.loadFiles(this.currentFolderId);
    }

    /**
     * 🔧 显示批量上传进度对话框
     */
    showBatchUploadDialog(totalFiles) {
        let dialog = document.getElementById('batchUploadProgressDialog');

        if (!dialog) {
            dialog = document.createElement('div');
            dialog.id = 'batchUploadProgressDialog';
            dialog.className = 'upload-progress-dialog';
            dialog.innerHTML = `
            <div class="upload-progress-content">
                <div class="upload-progress-header">
                    <h4>批量上传</h4>
                    <button class="close-btn" onclick="this.closest('.upload-progress-dialog').classList.remove('show')">&times;</button>
                </div>
                <div class="upload-progress-body">
                    <div class="progress-section">
                        <div class="progress-label">
                            <span>总体进度</span>
                            <span id="batchProgressText">0/${totalFiles}</span>
                        </div>
                        <div class="progress-bar">
                            <div id="batchProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    <div class="current-file" id="currentFileName">准备上传...</div>
                </div>
            </div>
        `;
            document.body.appendChild(dialog);
        }

        dialog.classList.add('show');

        return {
            updateFileProgress: (current, total, filename) => {
                const bar = document.getElementById('batchProgressBar');
                const text = document.getElementById('batchProgressText');
                const file = document.getElementById('currentFileName');
                const percent = (current / total) * 100;

                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${current}/${total}`;
                if (file) file.textContent = `正在上传：${filename}`;
            },
            close: () => {
                dialog.classList.remove('show');
            }
        };
    }


    /**
     * 🔧 显示上传进度对话框
     * @param {string} filename - 文件名
     */
    showUploadDialog(filename) {
        // 检查是否已存在
        let dialog = document.getElementById('uploadProgressDialog');

        if (!dialog) {
            dialog = document.createElement('div');
            dialog.id = 'uploadProgressDialog';
            dialog.className = 'upload-progress-dialog';
            dialog.innerHTML = `
            <div class="upload-progress-content">
                <div class="upload-progress-header">
                    <h4>文件上传</h4>
                    <button class="close-btn" id="uploadProgressClose">&times;</button>
                </div>
                <div class="upload-progress-body">
                    <div class="file-info">
                        <i class="fas fa-file"></i>
                        <span id="uploadFileName">${this.escapeHtml(filename)}</span>
                    </div>
                    
                    <div class="progress-section">
                        <div class="progress-label">
                            <span>MD5 计算</span>
                            <span id="md5ProgressText">0%</span>
                        </div>
                        <div class="progress-bar">
                            <div id="md5ProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    
                    <div class="progress-section">
                        <div class="progress-label">
                            <span>文件上传</span>
                            <span id="uploadProgressText">0%</span>
                        </div>
                        <div class="progress-bar">
                            <div id="uploadProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                        <div class="progress-detail">
                            <span id="uploadDetail">0/0 分片</span>
                            <span id="uploadSpeed">-- KB/s</span>
                        </div>
                    </div>
                    
                    <div class="progress-status" id="uploadStatus">准备上传...</div>
                    
                    <div class="progress-actions">
                        <button id="pauseResumeBtn" class="btn btn-sm btn-secondary">暂停</button>
                        <button id="cancelUploadBtn" class="btn btn-sm btn-danger">取消</button>
                    </div>
                </div>
            </div>
        `;
            document.body.appendChild(dialog);
        }

        // 更新文件名
        document.getElementById('uploadFileName').textContent = filename;

        // 显示对话框
        dialog.classList.add('show');

        // 🔧 绑定暂停/恢复事件
        const pauseResumeBtn = document.getElementById('pauseResumeBtn');
        let isPaused = false;
        pauseResumeBtn.onclick = () => {
            isPaused = !isPaused;
            pauseResumeBtn.textContent = isPaused ? '继续' : '暂停';
            pauseResumeBtn.className = isPaused ?
                'btn btn-sm btn-success' : 'btn btn-sm btn-secondary';

            // 获取当前上传器（简化处理，实际应存储引用）
            const uploader = Array.from(this.chunkedUploaders.values())[0];
            if (uploader) {
                if (isPaused) {
                    uploader.pause();
                } else {
                    uploader.resume();
                }
            }
        };

        // 🔧 绑定取消事件
        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        cancelUploadBtn.onclick = () => {
            const uploader = Array.from(this.chunkedUploaders.values())[0];
            if (uploader) {
                uploader.cancel();
            }
            dialog.classList.remove('show');
        };

        // 关闭按钮
        const closeBtn = document.getElementById('uploadProgressClose');
        closeBtn.onclick = () => {
            dialog.classList.remove('show');
        };

        return {
            updateMd5Progress: (percent) => {
                const bar = document.getElementById('md5ProgressBar');
                const text = document.getElementById('md5ProgressText');
                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${percent}%`;
            },

            updateUploadProgress: (percent, uploaded, total) => {
                const bar = document.getElementById('uploadProgressBar');
                const text = document.getElementById('uploadProgressText');
                const detail = document.getElementById('uploadDetail');
                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${Math.round(percent)}%`;
                if (detail) detail.textContent = `${uploaded}/${total} 分片`;
            },

            updateStatus: (message) => {
                const status = document.getElementById('uploadStatus');
                if (status) status.textContent = message;
            },

            close: () => {
                dialog.classList.remove('show');
            }
        };
    }


    /**
     * 🔧 格式化上传速度显示
     * @param {number} bytesPerSecond - 每秒字节数
     * @returns {string} 格式化后的速度字符串
     */
    formatSpeed(bytesPerSecond) {
        if (!bytesPerSecond || bytesPerSecond < 0) return '-- KB/s';

        if (bytesPerSecond < 1024) {
            return `${bytesPerSecond.toFixed(1)} B/s`;
        } else if (bytesPerSecond < 1024 * 1024) {
            return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        } else if (bytesPerSecond < 1024 * 1024 * 1024) {
            return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
        } else {
            return `${(bytesPerSecond / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
        }
    }


    /**
     * 🔧 更新上传速度显示
     * @param {string} filename - 文件名
     * @param {number} progress - 上传进度百分比 (0-100)
     * @param {number} fileSize - 文件总大小（字节）
     */
    updateUploadSpeed(filename, progress, fileSize) {
        const tracker = this.uploadTrackers.get(filename);
        if (!tracker) return;

        const now = Date.now();
        const elapsed = (now - tracker.startTime) / 1000; // 已用时间（秒）
        const loaded = (progress / 100) * fileSize; // 已上传字节数

        // 🔧 计算瞬时速度（滑动窗口：最近 500ms 的平均速度，避免抖动）
        const timeDiff = (now - tracker.lastUpdateTime) / 1000;
        const loadedDiff = loaded - tracker.lastLoaded;

        let instantSpeed = 0;
        // 至少间隔 100ms 才更新瞬时速度，避免频繁计算
        if (timeDiff >= 0.1) {
            instantSpeed = loadedDiff / timeDiff;
            tracker.lastUpdateTime = now;
            tracker.lastLoaded = loaded;
        }

        // 🔧 计算平均速度（用于进度较慢或刚开始时参考）
        const avgSpeed = elapsed > 0 ? loaded / elapsed : 0;

        // 🔧 智能选择显示速度：
        // - 上传初期 (<5%) 或瞬时速度为 0 时，显示平均速度
        // - 正常上传时显示瞬时速度
        const displaySpeed = (progress < 5 || instantSpeed === 0) ? avgSpeed : instantSpeed;

        // 🔧 更新 DOM 元素
        const speedEl = document.getElementById('uploadSpeed');
        if (speedEl) {
            speedEl.textContent = this.formatSpeed(displaySpeed);
        }
    }


    /**
     * 🔧 初始化上传追踪器
     * @param {string} filename - 文件名
     * @param {number} fileSize - 文件大小（字节）
     */
    initUploadTracker(filename, fileSize) {
        const now = Date.now();
        this.uploadTrackers.set(filename, {
            startTime: now,
            loaded: 0,
            lastUpdateTime: now,
            lastLoaded: 0,
            fileSize: fileSize
        });
    }

    /**
     * 🔧 清理上传追踪器
     * @param {string} filename - 文件名
     */
    clearUploadTracker(filename) {
        this.uploadTrackers.delete(filename);
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
        const desc = document.getElementById('newFolderDesc')?.value.trim();
        const isSharedFolder = document.getElementById('isSharedFolder').checked;

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
                body: JSON.stringify({
                    name: name,
                    description: desc,
                    is_shared_folder: isSharedFolder,
                    parent: this.currentFolderId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '创建失败');
            }

            this.showSuccess('创建成功', '文件夹创建成功');
            this.closeModal('newFolderModal');
            document.getElementById('newFolderName').value = '';
            document.getElementById('newFolderDesc').value = '';
            document.getElementById('isSharedFolder').checked = false;

            await this.loadFiles(this.currentFolderId);
        } catch (error) {
            console.error('创建失败:', error);
            this.showError('创建失败', error.message);
        }
    }

    // ==================== 分享功能 ====================

    async loadMyShares_v1() {
        try {
            this.showLoading();
            const response = await fetch('/api/cloud/shares/?owner=me', {
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status;
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

    async loadMyShares() {
        try {
            this.showLoading();
            const params = new URLSearchParams({
                owner: 'me',
                page: this.pagination.shares.page,
                page_size: this.pagination.shares.pageSize
            });
            if (this.pagination.shares.search) params.append('search', this.pagination.shares.search);

            const res = await fetch(`/api/cloud/shares/?${params.toString()}`, {headers: TokenManager.getHeaders()});
            this.statusCode = res.status;
            if (!res.ok) throw new Error('加载分享失败');

            const data = await res.json();
            const shares = Array.isArray(data.results) ? data.results : [];
            this.pagination.shares.count = data.count || 0;
            this.pagination.shares.next = data.next;
            this.pagination.shares.previous = data.previous;
            this.renderMyShares(shares);
            this.renderPagination('shares');
        } catch (e) {
            console.error(e);
            this.showError('加载失败', e);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
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
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载分享失败');

            const data = await response.json();
            const shares = Array.isArray(data.results) ? data.results : data;
            this.renderSharedWithMe(shares);
        } catch (error) {
            console.error('加载分享给我失败:', error);
            this.showError('加载失败', error);
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
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
                            <i class="fas ${iconClass}"></i>
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
            const {fileId, isFolder, sourceName} = this.contextTarget;
            this.restoreItem(fileId, isFolder);
        }
        this.hideContextMenu();
    }

    /**
     * 🔧 右键菜单永久删除
     */
    permanentDeleteSelectedItem() {
        if (this.contextTarget) {
            const {fileId, isFolder, sourceName} = this.contextTarget;
            this.permanentDeleteItem(fileId, isFolder, sourceName);
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

            this.showSuccess('删除成功', response.error || response.message || '文件已永久删除');
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
    async shareFile(fileId, isFolder = false, sourceName = '') {
        this.currentShareFileId = fileId;
        this.currentShareType = isFolder ? 'folder' : 'file';

        // 🔧 1. 安全读取系统配置默认值
        const defaultExpireDays = window.frontendCloudConfig?.get('share.default_expire_days', 7);
        const defaultMaxDownloads = window.frontendCloudConfig?.get('share.max_downloads', 0);

        // 🔧 2. 计算默认过期时间 (当前时间 + 配置天数)
        // 修复时区问题：使用本地时间构建字符串，避免 toISOString() 强制转为 UTC 导致的 8 小时偏差
        const now = new Date();
        now.setDate(now.getDate() + defaultExpireDays);

        // 手动格式化为 YYYY-MM-DDTHH:mm (本地时间)
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const defaultExpireTime = `${year}-${month}-${day}T${hours}:${minutes}`;


        // 🔧 3. 重置表单并预填默认值
        const shareTypeEl = document.getElementById('shareType');
        const sharePasswordEl = document.getElementById('sharePassword');
        const shareExpiresEl = document.getElementById('shareExpires');
        const shareMaxDownloadsEl = document.getElementById('shareMaxDownloads');

        if (shareTypeEl) shareTypeEl.value = 'public';
        if (sharePasswordEl) sharePasswordEl.value = '';
        if (shareExpiresEl) shareExpiresEl.value = defaultExpireTime;
        if (shareMaxDownloadsEl) shareMaxDownloadsEl.value = defaultMaxDownloads || '';

        // 隐藏分享结果区域
        const shareLinkEl = document.getElementById('shareLink');
        const shareQrcodeEl = document.getElementById('shareQrcode');
        const passwordGroupEl = document.getElementById('passwordGroup');
        const qrcodeContainerEl = document.getElementById('qrcodeContainer');

        if (shareLinkEl) shareLinkEl.style.display = 'none';
        if (shareQrcodeEl) shareQrcodeEl.style.display = 'none';
        if (passwordGroupEl) passwordGroupEl.style.display = 'none';
        if (qrcodeContainerEl) qrcodeContainerEl.innerHTML = '';


        // 更新模态框标题
        const modalTitle = document.querySelector('#shareModal .modal-header h3');
        if (modalTitle) modalTitle.innerHTML = isFolder ? `<i class="fas fa-share-alt"></i> 分享文件夹：<strong>${sourceName}</strong> ` : `<i class="fas fa-share-alt"></i> 分享文件：<strong>${sourceName}</strong> `;

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
        if (shareType !== 'password') password = '';

        // 🔧 安全解析过期时间
        let expiresAt = document.getElementById('shareExpires')?.value || null;
        // 如果用户清空了输入框，传递 null 给后端表示永久有效
        if (expiresAt === '') expiresAt = null;

        // 🔧 安全解析最大下载次数
        const maxDownloadsInput = document.getElementById('shareMaxDownloads')?.value;
        let maxDownloads = (maxDownloadsInput === '' || maxDownloadsInput === null) ? null : parseInt(maxDownloadsInput, 10);
        // 兼容后端逻辑：0 通常表示无限制，若为 0 则转为 null 或直接传 0（视后端校验而定）
        if (maxDownloads === 0) maxDownloads = 0;

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

            // 替换为：
            let shortUrl = share.share_url || `${baseUrl}/s/${share.share_code}/`;
            if (share.password) shortUrl += `?pwd=${share.password}`; // 🔧 使用短参数避免二维码溢出

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
            // 替换为：
            new QRCode(container, {
                text: url,
                width: 300,              // 🔧 增大尺寸，允许生成更高 Version 的二维码
                height: 300,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M  // 🔧 改为 M 级，数据容量提升约 30%
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
            modalTitle.innerHTML = isFolder ? '<i class="fas fa-edit"></i> 重命名文件夹' : '<i class="fas fa-edit"></i> 重命名文件';
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
    }


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
    }


    async moveFiles(fileIds, sourceName = '') {
        this.currentMoveIds = fileIds;
        await this.loadFolderTree();
        this.openModal('moveModal', sourceName);
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
            this.statusCode = response.status;
            if (!response.ok) throw new Error('加载文件夹失败');

            const data = await response.json();
            const treeContainer = document.getElementById('folderTree');

            // 🔧 递归渲染树状结构
            const renderTree = (nodes, level = 0) => {
                let html = '';

                nodes.forEach(node => {
                    const indent = level * 20;
                    const hasChildren = node.children && node.children.length > 0;
                    const isSharedFolder = node.is_shared_folder;
                    const isCurrentFolder = node.id === this.currentFolderId;
                    const backgroundColor = isCurrentFolder ? '#f0f0f0' : '';
                    const iconColor = isSharedFolder ? '#E6A23C' : '#409EFF';
                    const avatar = node.owner?.avatar || '/static/images/default-avatar.png';
                    const ownerName = node.owner?.real_name || node.owner?.username || '未知';

                    html += `
                        <div class="folder-tree-item" title="${isSharedFolder ? '共享文件夹 - ' + node.name : '我的文件夹 - ' + node.name}" data-folder-id="${node.id}" style="padding-left: ${indent + 15}px; background-color: ${backgroundColor};">
                            <i class="fas fa-folder${hasChildren ? '-open' : ''}" style="color: ${iconColor}"></i>
                            <span>${node.name}</span>
                            
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

            let html = `
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
    }

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
    }

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

    }

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
    }

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
    }

    renderLogPagination(data, container) {
        if (!data.total_pages || data.total_pages <= 1) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        const page = data.page || 1;
        const total = data.total_pages;
        let html = `<div class="pagination-wrapper"><div class="pagination-info">共 ${data.count} 条</div><div class="pagination-controls">`;
        html += `<button class="pagination-btn" onclick="cloudApp.loadOperationLogs(${page - 1})" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
        const startPage = Math.max(1, page - 2);
        const endPage = Math.min(total, page + 2);
        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="pagination-btn ${i === page ? 'active' : ''}" onclick="cloudApp.loadOperationLogs(${i})">${i}</button>`;
        }
        html += `<button class="pagination-btn" onclick="cloudApp.loadOperationLogs(${page + 1})" ${page >= total ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
        html += '</div></div>';
        container.innerHTML = html;
    }

    searchLogs(keyword) {
        clearTimeout(this._logSearchTimer);
        this._logSearchTimer = setTimeout(() => {
            this.loadOperationLogs(1);
        }, 300);
    }

    filterLogsByOperation(operation) {
        this.loadOperationLogs(1);
    }

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
    }


    // ==================== 系统配置 ====================

    async loadSystemConfigs() {
        try {
            await frontendCloudConfig?.loadConfigs?.();
            this.applyFrontendConfigs();
            console.log('✅ 系统配置已应用');
        } catch (error) {
            console.warn('⚠️ 加载系统配置失败，使用默认值:', error);
            this.applyFrontendConfigs();
        }
    }

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
    }


    /**
     * 🔧 切换共享文件夹视图模式
     */
    switchSharedFolderViewMode(mode) {
        const listView = document.getElementById('sharedFoldersListView');
        const gridView = document.getElementById('sharedFoldersGridView');

        if (listView && gridView) {
            listView.classList.toggle('active', mode === 'list');
            gridView.classList.toggle('active', mode === 'grid');

            // 更新按钮状态
            document.querySelectorAll('#sharedFoldersView .view-switcher .btn-icon').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.viewMode === mode);
            });
        }

        this.sharedFolderViewMode = mode;
    }

    /**
     * 🔧 更改共享文件夹分页
     */
    changeSharedFolderPage(page) {
        if (page < 1) return;

        if (!this.pagination.sharedFolders) {
            this.pagination.sharedFolders = {page: 1, pageSize: 20, count: 0, next: null, previous: null};
        }

        this.pagination.sharedFolders.page = page;

        // 判断当前是否在钻取模式
        const currentFolderId = this.sharedFolderPathStack && this.sharedFolderPathStack.length > 0
            ? this.sharedFolderPathStack[this.sharedFolderPathStack.length - 1].id
            : null;

        this.loadSharedFolders(currentFolderId);
    }


    /**
     * 🔧 搜索共享文件夹中的文件和文件夹
     */
    async searchSharedFolders(keyword) {
        // 清除搜索时重新加载
        if (!keyword || !keyword.trim()) {
            await this.loadSharedFolders(this.currentFolderId);
            this.updateSharedFolderSearchUI(false);
            return;
        }

        try {
            // 显示搜索状态
            this.updateSharedFolderSearchUI(true, keyword);

            let url = '/api/cloud/shared-folders/';
            const params = new URLSearchParams();

            if (this.currentFolderId) {
                params.append('folder', this.currentFolderId);
            }
            params.append('search', keyword.trim());
            params.append('page', 1);
            params.append('page_size', 20);

            if (params.toString()) {
                url += '?' + params.toString();
            }

            const res = await fetch(url, {headers: TokenManager.getHeaders()});

            if (!res.ok) {
                throw new Error('搜索失败');
            }

            const data = await res.json();
            const results = Array.isArray(data.results) ? data.results : data;

            // 渲染搜索结果
            if (this.currentFolderId) {
                this.renderSharedFolderContents(results, this.currentFolderId);
            } else {
                this.renderSharedFolders(results);
            }

            // 更新分页
            if (!this.pagination.sharedFolders) {
                this.pagination.sharedFolders = {page: 1, pageSize: 20, count: 0, next: null, previous: null};
            }
            this.pagination.sharedFolders.count = data.count || results.length;
            this.pagination.sharedFolders.next = data.next;
            this.pagination.sharedFolders.previous = data.previous;
            this.renderPagination('sharedFolders');

        } catch (error) {
            console.error('搜索共享文件夹失败:', error);
            this.showError('搜索失败', error.message);
        }
    }

    /**
     * 🔧 清除共享文件夹搜索
     */
    clearSharedFolderSearch() {
        const searchInput = document.getElementById('sharedFolderSearchInput');
        if (searchInput) {
            searchInput.value = '';
        }
        this.updateSharedFolderSearchUI(false);
        this.loadSharedFolders(this.currentFolderId);
    }

    /**
     * 🔧 更新共享文件夹搜索UI状态
     */
    updateSharedFolderSearchUI(isSearching, keyword = '') {
        const searchInput = document.getElementById('sharedFolderSearchInput');
        const clearBtn = searchInput?.parentElement?.querySelector('.search-clear-btn');

        if (clearBtn) {
            clearBtn.style.display = (isSearching && keyword) ? 'block' : 'none';
        }

        // 可选：添加搜索中的视觉反馈
        if (searchInput) {
            if (isSearching) {
                searchInput.classList.add('searching');
            } else {
                searchInput.classList.remove('searching');
            }
        }
    }


    /**
     * 🔧 加载共享文件夹（支持分页和钻取）
     */
    async loadSharedFolders(folderId = null) {
        try {
            this.showLoading();

            // 🔧 构建查询参数
            let url = '/api/cloud/shared-folders/';
            const params = new URLSearchParams();

            if (folderId) {
                // 钻取模式：获取共享文件夹下的内容
                params.append('folder', folderId);
                params.append('page', this.pagination.sharedFolders?.page || 1);
                params.append('page_size', this.pagination.sharedFolders?.pageSize || 20);
            } else {
                // 列表模式：获取共享文件夹列表
                params.append('page', this.pagination.sharedFolders?.page || 1);
                params.append('page_size', this.pagination.sharedFolders?.pageSize || 20);
            }

            if (params.toString()) {
                url += '?' + params.toString();
            }

            const res = await fetch(url, {headers: TokenManager.getHeaders()});

            this.statusCode = res.status;


            if (!res.ok) {
                const errorText = await res.text();
                console.error('❌ 请求失败:', {
                    status: res.status,
                    statusText: res.statusText,
                    body: errorText
                });

                let errorMessage = '加载失败';
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.error || errorData.detail || errorMessage;
                } catch (e) {
                    errorMessage = `服务器错误 (${res.status})`;
                }

                throw new Error(errorMessage);
            }

            const data = await res.json();

            // 🔧 处理分页信息
            if (!this.pagination.sharedFolders) {
                this.pagination.sharedFolders = {page: 1, pageSize: 20, count: 0, next: null, previous: null};
            }
            this.pagination.sharedFolders.count = data.count || 0;
            this.pagination.sharedFolders.next = data.next;
            this.pagination.sharedFolders.previous = data.previous;

            const results = Array.isArray(data.results) ? data.results : data;

            if (folderId) {
                // 钻取模式：渲染文件夹内容
                this.renderSharedFolderContents(results, folderId);
            } else {
                // 列表模式：渲染共享文件夹列表
                this.renderSharedFolders(results);
            }

            // 🔧 渲染分页控件
            this.renderPagination('sharedFolders');

        } catch (e) {
            console.error('❌ 加载共享文件夹失败:', e);
            this.showError('加载失败', e || '未知错误');
            if (this.statusCode === 401) {
                this.handleAuthError()
            }
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 🔧 渲染共享文件夹列表（卡片+列表双视图）
     */
    renderSharedFolders(folders) {
        const listView = document.getElementById('sharedFoldersListView');
        const gridView = document.getElementById('sharedFoldersGridView');

        if (!folders || folders.length === 0) {
            const emptyHtml = `
                <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>暂无共享文件夹</p>
                    <button class="btn btn-primary" onclick="cloudApp.openModal('createSharedFolderModal')">新建共享文件夹</button>
                </div>
            `;

            if (listView) {
                listView.querySelector('.file-list-body').innerHTML = emptyHtml;
            }
            if (gridView) {
                gridView.querySelector('.file-grid-body').innerHTML = emptyHtml;
            }
            return;
        }

        // 🔧 渲染列表视图
        if (listView) {
            let listHtml = '';
            folders.forEach(f => {
                const memberCount = f.member_count || (f.folder_collaborations ? f.folder_collaborations.length + 1 : 1);
                const fileCount = f.file_count || (f.folder_contents ? f.folder_contents.length : 0);
                const ownerName = f.owner?.real_name || f.owner?.username || '未知';
                const avatar = f.owner?.avatar || '/static/images/default-avatar.png';
                listHtml += `
                    <div class="file-item is-folder" data-file-id="${f.id}" data-is-folder="true" ondblclick="cloudApp.navigateToSharedFolder('${f.id}')">
                        <div class="file-col name">
                            <i class="fas fa-folder" style="color: #E6A23C;"></i>
                            <span class="file-name">${this.escapeHtml(f.name)}</span>
                        </div>
                        <div class="file-col size">${memberCount} 人 / ${fileCount} 个文件</div>
                        
                        <div class="file-col badge" title="创建者 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"><span class="file-col size">${ownerName}</span></div>
                        <div class="file-col date" title="创建时间">${this.formatDate(f.created_at)}</div>
                        <div class="file-col actions">
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.openManageMembersModal('${f.id}', '${this.escapeHtml(f.name)}')" title="管理成员">
                                <i class="fas fa-user-cog"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.navigateToSharedFolder('${f.id}')" title="打开">
                                <i class="fas fa-folder-open"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            listView.querySelector('.file-list-body').innerHTML = listHtml;
        }

        // 🔧 渲染网格视图
        if (gridView) {
            let gridHtml = '';
            folders.forEach(f => {
                const memberCount = f.member_count || (f.folder_collaborations ? f.folder_collaborations.length + 1 : 1);
                const fileCount = f.file_count || (f.folder_contents ? f.folder_contents.length : 0);
                const ownerName = f.owner?.real_name || f.owner?.username || '未知';
                const avatar = f.owner?.avatar || '/static/images/default-avatar.png';
                gridHtml += `
                    <div class="file-grid-item is-folder" data-file-id="${f.id}" data-is-folder="true" ondblclick="cloudApp.navigateToSharedFolder('${f.id}')">
                        <div class="file-icon">
                            <i class="fas fa-folder" style="font-size: 48px; color: #E6A23C;"></i>
                            <div class="badge badge-corner" title="创建者 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>
                        </div>
                        <div class="file-name" title="${this.escapeHtml(f.name)}">${this.escapeHtml(f.name)}</div>
                        <div class="file-meta" title="成员：${memberCount} 人 / ${fileCount} 个文件">${memberCount} 人 / ${fileCount} 个文件</div>
                        <div class="file-meta" title="创建者 - ${ownerName}">${ownerName}</div>
                        <div class="file-meta" title="创建时间：${this.formatDate(f.created_at)}">${this.formatDate(f.created_at)}</div>
                        <div class="file-actions">
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.openManageMembersModal('${f.id}', '${this.escapeHtml(f.name)}')" title="管理成员">
                                <i class="fas fa-user-cog"></i>
                            </button>
                            <button class="btn-action" onclick="event.stopPropagation(); cloudApp.navigateToSharedFolder('${f.id}')" title="打开">
                                <i class="fas fa-folder-open"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            gridView.querySelector('.file-grid-body').innerHTML = gridHtml;
        }
    }


    /**
     * 🔧 渲染共享文件夹内容（钻取后的文件和子文件夹）- 参考全部文件的网格视图
     */
    renderSharedFolderContents(items, folderId) {
        const listView = document.getElementById('sharedFoldersListView');
        const gridView = document.getElementById('sharedFoldersGridView');

        if (!items || items.length === 0) {
            const emptyHtml = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>此文件夹为空</p>
                </div>
            `;

            if (listView) {
                listView.querySelector('.file-list-body').innerHTML = emptyHtml;
            }
            if (gridView) {
                gridView.querySelector('.file-grid-body').innerHTML = emptyHtml;
            }
            return;
        }

        // 🔧 列表视图渲染
        if (listView) {
            let listHtml = '';
            items.forEach(item => {

                if (item.is_folder) {
                    const memberCount = item.member_count || (item.folder_collaborations ? item.folder_collaborations.length + 1 : 1);
                    const fileCount = item.file_count || (item.folder_contents ? item.folder_contents.length : 0);
                    const ownerName = item.owner?.real_name || item.owner?.username || '未知';
                    const avatar = item.owner?.avatar || '/static/images/default-avatar.png';
                    // 文件夹
                    listHtml += `
                        <div class="file-item is-folder" data-file-id="${item.id}" data-is-folder="true" ondblclick="cloudApp.navigateToSharedFolder('${item.id}')">
                            <div class="file-col name">
                                <i class="fas fa-folder" style="color: #E6A23C;"></i>
                                <span class="file-name">${this.escapeHtml(item.name)}</span>
                            </div>
                            <div class="file-col size">${memberCount} 人 / ${fileCount} 个文件</div>
                        
                            <div class="file-col badge" title="${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"><span class="file-col size">${ownerName}</span></div>

                            <div class="file-col date" title="修改时间">${this.formatDate(item.updated_at)}</div>
                            <div class="file-col actions">
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.navigateToSharedFolder('${item.id}')" title="打开">
                                    <i class="fas fa-folder-open"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${item.id}'], true, '${this.escapeHtml(item.name)}')" title="移动">
                                    <i class="fas fa-cut"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${item.id}', true, '${this.escapeHtml(item.name)}')" title="删除">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    // 文件
                    const isImage = item.is_image || (item.mime_type && item.mime_type.startsWith('image/'));
                    const isVideo = item.is_video || (item.mime_type && item.mime_type.startsWith('video/'));
                    const isPdf = item.document_type === 'pdf' || (item.mime_type && item.mime_type === 'application/pdf');
                    const isDocument = item.is_document;


                    const ownerName = item.owner?.real_name || item.owner?.username || '未知';
                    const avatar = item.owner?.avatar || '/static/images/default-avatar.png';

                    listHtml += `
                        <div class="file-item" data-file-id="${item.id}" data-is-folder="false">
                            <div class="file-col name">
                                <i class="fas ${item.icon_class || 'fa-file'}"></i>
                                <span class="file-name">${this.escapeHtml(item.name)}</span>
                            </div>
                            <div class="file-col size">${item.size_formatted || '0 B'}</div>
                            <div class="file-col badge" title="${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"><span class="file-col size">${ownerName}</span></div>
                        
                            <div class="file-col date" title="修改时间">${this.formatDate(item.updated_at)}</div>
                            <div class="file-col actions">
                                ${isImage || isVideo || isPdf ? `
                                    <button class="btn-action" onclick="event.stopPropagation(); cloudApp.previewFile('${item.id}')" title="预览">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                ` : ''}
                                
                                ${isDocument ? `
                                    <button class="btn-action" onclick="event.stopPropagation(); cloudApp.editDocument('${item.id}')" title="在线编辑">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                ` : ''}
                                
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${item.id}', false, '${this.escapeHtml(item.name)}')" title="分享">
                                    <i class="fas fa-share-alt"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.renameFile('${item.id}', '${this.escapeHtml(item.name)}', false)" title="重命名">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${item.id}'], false, '${this.escapeHtml(item.name)}')" title="移动">
                                    <i class="fas fa-cut"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${item.id}', false, '${this.escapeHtml(item.name)}')" title="删除">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }
            });
            listView.querySelector('.file-list-body').innerHTML = listHtml;
        }

        // 🔧 网格视图渲染 - 参考全部文件的网格视图
        if (gridView) {
            let gridHtml = '';
            items.forEach(item => {

                if (item.is_folder) {
                    const memberCount = item.member_count || (item.folder_collaborations ? item.folder_collaborations.length + 1 : 1);
                    const fileCount = item.file_count || (item.folder_contents ? item.folder_contents.length : 0);
                    const ownerName = item.owner?.real_name || item.owner?.username || '未知';
                    const avatar = item.owner?.avatar || '/static/images/default-avatar.png';
                    // 文件夹网格项
                    gridHtml += `
                        <div class="file-grid-item is-folder" 
                             data-file-id="${item.id}" 
                             data-is-folder="true"
                             ondblclick="cloudApp.navigateToSharedFolder('${item.id}')"
                             oncontextmenu="cloudApp.handleContextMenu(event, '${item.id}', true, '${this.escapeHtml(item.name)}')">
                            <div class="file-checkbox-overlay">
                                <input type="checkbox" 
                                       class="file-checkbox" 
                                       data-file-id="${item.id}"
                                       onchange="cloudApp.toggleFileSelection('${item.id}', this.checked)">
                            </div>
                            
                            
                            <div class="file-icon">
                                <i class="fas fa-folder" style="font-size: 48px; color: #E6A23C;"></i>
                                <div class="badge badge-corner" title="创建者 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>
                            </div>
                            <div class="file-name" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</div>
                            <div class="file-meta" title="成员：${memberCount} 人 / ${fileCount} 个文件">${memberCount} 人 / ${fileCount} 个文件</div>
                            <div class="file-meta" title="创建者 - ${ownerName}">${ownerName}</div>
                            
                            
                            <div class="file-date" title="修改时间">${this.formatDate(item.updated_at)}</div>
                            <div class="file-actions">
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.navigateToSharedFolder('${item.id}')" title="打开">
                                    <i class="fas fa-folder-open"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${item.id}'], true, '${this.escapeHtml(item.name)}')" title="移动">
                                    <i class="fas fa-cut"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${item.id}', true, '${this.escapeHtml(item.name)}')" title="删除">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    // 文件网格项 - 支持缩略图预览
                    const isImage = item.is_image || (item.mime_type && item.mime_type.startsWith('image/'));
                    const isVideo = item.is_video || (item.mime_type && item.mime_type.startsWith('video/'));
                    const isPdf = item.document_type === 'pdf' || (item.mime_type && item.mime_type === 'application/pdf');
                    const isDocument = item.is_document;
                    const tagType = isImage ? 'img' : isVideo ? 'video' : 'file';

                    const ownerName = item.owner?.real_name || item.owner?.username || '未知';
                    const avatar = item.owner?.avatar || '/static/images/default-avatar.png';

                    // 🔧 图片、视频、PDF显示缩略图
                    const thumbnailHtml = (isImage || isVideo) ? `
                        <div class="file-thumbnail">
                            <${tagType} src="${item.file_url}" alt="${item.name}" title="${item.name}" 
                                  style="width:100%;height:80px;object-fit:cover;border-radius:4px;" 
                                  onerror="this.parentElement.innerHTML='<div class=\\'file-icon\\'><i class=\\'fas ${item.icon_class || 'fa-file'}\\'></i></div>'" />
                        </div>
                        <div class="badge badge-corner" title="创建者 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>
                    ` : `
                        <div class="file-icon">
                            <i class="fas ${item.icon_class || 'fa-file'}" style="font-size: 48px;"></i>
                            <div class="badge badge-corner" title="创建者 - ${ownerName}"><img src="${avatar}" alt="${ownerName}" class="owner-avatar"></div>
                        </div>
                    `;

                    gridHtml += `

                        
                        <div class="file-grid-item" 
                             data-file-id="${item.id}" 
                             data-is-folder="false"
                             ondblclick="cloudApp.handleItemDoubleClick('${item.id}', false, ${isDocument})"
                             oncontextmenu="cloudApp.handleContextMenu(event, '${item.id}', false, '${this.escapeHtml(item.name)}')">
                            <div class="file-checkbox-overlay">
                                <input type="checkbox" 
                                       class="file-checkbox" 
                                       data-file-id="${item.id}"
                                       onchange="cloudApp.toggleFileSelection('${item.id}', this.checked)">
                            </div>
                            ${thumbnailHtml}
                            <div class="file-name" title="${this.escapeHtml(item.name)}">${this.escapeHtml(item.name)}</div>
                            <div class="file-meta">${item.size_formatted || '0 B'}</div>
                            <div class="file-meta" title="创建者 - ${ownerName}">${ownerName}</div>
                            <div class="file-date" title="修改时间">${this.formatDate(item.updated_at)}</div>
                            <div class="file-actions">
                                ${isImage || isVideo || isPdf ? `
                                    <button class="btn-action" onclick="event.stopPropagation(); cloudApp.previewFile('${item.id}')" title="预览">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                ` : ''}
                                
                                ${isDocument ? `
                                    <button class="btn-action" onclick="event.stopPropagation(); cloudApp.editDocument('${item.id}')" title="在线编辑">
                                        <i class="fas fa-edit"></i>
                                    </button>
                                ` : ''}
                                
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.shareFile('${item.id}', false, '${this.escapeHtml(item.name)}')" title="分享">
                                    <i class="fas fa-share-alt"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.renameFile('${item.id}', '${this.escapeHtml(item.name)}', false)" title="重命名">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.moveItems(['${item.id}'], false, '${this.escapeHtml(item.name)}')" title="移动">
                                    <i class="fas fa-cut"></i>
                                </button>
                                <button class="btn-action" onclick="event.stopPropagation(); cloudApp.deleteItem('${item.id}', false, '${this.escapeHtml(item.name)}')" title="删除">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }
            });
            gridView.querySelector('.file-grid-body').innerHTML = gridHtml;
        }
    }


    /**
     * 🔧 导航到共享文件夹（支持钻取）- 参考全部文件的navigateToFolder逻辑
     */
    async navigateToSharedFolder(folderId, sliceIndex = null) {
        try {
            console.log('导航到共享文件夹:', folderId);

            if (!this.sharedFolderPathStack) {
                this.sharedFolderPathStack = [];
            }

            if (sliceIndex !== null && sliceIndex >= 0) {
                // 🔧 点击面包屑中间项：截断路径
                this.sharedFolderPathStack = this.sharedFolderPathStack.slice(0, sliceIndex + 1);
            } else if (folderId === null) {
                // 🔧 返回根目录
                this.sharedFolderPathStack = [];
            } else {
                // 🔧 关键修复：检查是否已存在该文件夹，防止重复添加
                const existingIndex = this.sharedFolderPathStack.findIndex(item => item.id === folderId);

                if (existingIndex !== -1) {
                    // 如果路径中已存在该文件夹，截断到该位置
                    console.log('📁 路径中已存在该文件夹，截断到索引:', existingIndex);
                    this.sharedFolderPathStack = this.sharedFolderPathStack.slice(0, existingIndex + 1);
                } else {
                    // 获取文件夹名称并压入栈
                    const folderName = this.getFolderNameById(folderId);
                    if (folderName) {
                        this.sharedFolderPathStack.push({id: folderId, name: folderName});
                        console.log('📁 添加新文件夹到路径栈:', folderName);
                    } else {
                        console.warn(`未能获取文件夹 ${folderId} 的名称`);
                        this.sharedFolderPathStack.push({id: folderId, name: '未知文件夹'});
                    }
                }
            }

            this.currentFolderId = folderId;

            // 更新面包屑和返回按钮显示
            this.updateSharedFolderBreadcrumb();

            // 重置分页
            if (!this.pagination.sharedFolders) {
                this.pagination.sharedFolders = {page: 1, pageSize: 20, count: 0, next: null, previous: null};
            } else {
                this.pagination.sharedFolders.page = 1;
            }

            // 加载文件夹内容
            await this.loadSharedFolders(folderId);

        } catch (error) {
            console.error('导航失败:', error);
            this.showError('导航错误', '无法进入该文件夹');
        }
    }

    /**
     * 🔧 更新共享文件夹面包屑 - 参考全部文件的updateBreadcrumb逻辑
     */
    updateSharedFolderBreadcrumb() {
        const breadcrumb = document.getElementById('breadcrumbSharedFolder');
        const backBtn = document.getElementById('btnBackSharedFolder');

        if (!breadcrumb) return;

        // 清空面包屑
        breadcrumb.innerHTML = '';

        // 🔧 根目录项
        const rootItem = document.createElement('span');
        rootItem.className = 'crumb-item' + (this.sharedFolderPathStack.length === 0 ? ' active' : '');
        rootItem.textContent = '共享文件夹';
        rootItem.dataset.folderId = '';
        rootItem.onclick = () => this.backToSharedFolderRoot();
        breadcrumb.appendChild(rootItem);

        // 🔧 路径项
        this.sharedFolderPathStack.forEach((item, index) => {
            // 分隔符
            const sep = document.createElement('span');
            sep.className = 'crumb-separator';
            sep.textContent = '/';
            breadcrumb.appendChild(sep);

            // 路径项
            const crumb = document.createElement('span');
            crumb.className = 'crumb-item' + (index === this.sharedFolderPathStack.length - 1 ? ' active' : '');
            crumb.textContent = item.name;
            crumb.dataset.folderId = item.id;

            // 🔧 非当前项可点击
            if (index < this.sharedFolderPathStack.length - 1) {
                crumb.style.cursor = 'pointer';
                crumb.onclick = () => this.navigateToSharedFolder(item.id, index);
            }

            breadcrumb.appendChild(crumb);
        });

        // 🔧 关键修复：更新返回按钮显示状态
        if (backBtn) {
            backBtn.style.display = this.sharedFolderPathStack.length > 0 ? 'block' : 'none';
            backBtn.onclick = () => this.goBackInSharedFolder();
            console.log('🔙 返回按钮显示状态:', this.sharedFolderPathStack.length > 0 ? '显示' : '隐藏');
        } else {
            console.warn('⚠️ btnBackSharedFolder 元素未找到');
        }
    }

    /**
     * 🔧 返回共享文件夹根目录
     */
    async backToSharedFolderRoot() {
        this.sharedFolderPathStack = [];
        this.currentFolderId = null;
        this.updateSharedFolderBreadcrumb();
        await this.loadSharedFolders(null);
    }

    /**
     * 🔧 共享文件夹中返回上一级 - 参考全部文件的goBack逻辑
     */
    async goBackInSharedFolder() {
        if (this.sharedFolderPathStack.length > 0) {
            this.sharedFolderPathStack.pop();
            const prevFolder = this.sharedFolderPathStack.length > 0
                ? this.sharedFolderPathStack[this.sharedFolderPathStack.length - 1].id
                : null;

            this.currentFolderId = prevFolder;
            this.updateSharedFolderBreadcrumb();
            await this.loadSharedFolders(prevFolder);
        }
    }

    /**
     * 🔧 按索引导航到共享文件夹
     */
    async navigateToSharedFolderByIndex(index) {
        this.sharedFolderPathStack = this.sharedFolderPathStack.slice(0, index + 1);
        this.updateSharedFolderBreadcrumb();
        const folderId = this.sharedFolderPathStack[index].id;
        await this.loadSharedFolders(folderId);
    }


    /**
     * 🔧 创建共享文件夹
     */
    async createSharedFolder() {
        const name = document.getElementById('sharedFolderName').value.trim();
        const desc = document.getElementById('sharedFolderDesc').value.trim();
        if (!name) {
            this.showError('验证失败', '文件夹名称不能为空');
            return;
        }
        try {
            this.showLoading();
            const res = await fetch('/api/cloud/shared-folders/', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManager.getHeaders()},
                // 🔧 关键修复：显式传递 parent 字段，支持在当前目录下创建
                body: JSON.stringify({
                    name: name,
                    description: desc,
                    parent: this.currentFolderId
                })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || err.detail || '创建失败');
            }
            this.showSuccess('创建成功', '共享文件夹创建成功');
            this.closeModal('createSharedFolderModal');

            // 清空表单
            document.getElementById('sharedFolderName').value = '';
            document.getElementById('sharedFolderDesc').value = '';

            // 刷新当前视图
            await this.loadSharedFolders(this.currentFolderId);

        } catch (e) {
            this.showError('创建失败', e.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 🔧 打开管理成员模态框
     */
    async openManageMembersModal(folderId, folderName) {
        this.currentManageSharedFolderId = folderId;
        this.tempAddMemberId = null;
        document.getElementById('manageSharedFolderName').textContent = folderName;
        this.openModal('manageSharedFolderMembersModal');
        await this.loadSharedFolderMembers(folderId);

        // 绑定搜索事件 (防抖)
        const searchInput = document.getElementById('memberSearchInput');
        searchInput.oninput = Utils.debounce(async (e) => {
            const keyword = e.target.value.trim();
            if (keyword.length < 2) {
                document.getElementById('memberSearchResults').style.display = 'none';
                return;
            }
            try {
                const res = await fetch(`/api/auth/search_users/?q=${encodeURIComponent(keyword)}`, {headers: TokenManager.getHeaders()});
                const data = await res.json();
                const users = data.results || [];
                const resultsDiv = document.getElementById('memberSearchResults');
                if (users.length === 0) {
                    resultsDiv.innerHTML = '<div style="padding:10px; color:#999;">未找到用户</div>';
                } else {
                    resultsDiv.innerHTML = users.map(u => `
                    <div class="user-result-item" onclick="cloudApp.selectMemberToAdd('${u.id}', '${this.escapeHtml(u.real_name || u.username)}')">
                        <img src="${u.avatar_url || '/static/images/default-avatar.png'}" class="user-avatar">
                        <div class="user-info">
                            <div class="user-name">${this.escapeHtml(u.real_name || u.username)}</div>
                        </div>
                    </div>
                `).join('');
                }
                resultsDiv.style.display = 'block';
            } catch (err) {
                console.error('搜索用户失败', err);
            }
        }, 300);
    }

    /**
     * 🔧 选择待添加的成员
     */
    selectMemberToAdd(userId, userName) {
        this.tempAddMemberId = userId;
        document.getElementById('memberSearchResults').style.display = 'none';
        document.getElementById('memberSearchInput').value = userName;
    }

    /**
     * 🔧 添加共享文件夹成员
     */
    async addSharedFolderMember() {
        if (!this.tempAddMemberId) {
            this.showError('操作失败', '请先搜索并选择用户');
            return;
        }
        const permission = document.getElementById('memberPermissionSelect').value;
        try {
            this.showLoading();
            const res = await fetch(`/api/cloud/shared-folders/${this.currentManageSharedFolderId}/add_member/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManager.getHeaders()},
                body: JSON.stringify({user_id: this.tempAddMemberId, permission: permission})
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || err.detail || err.message || '添加失败')
            }
            ;

            this.showSuccess('添加成功', '成员添加成功');
            document.getElementById('memberSearchInput').value = '';
            this.tempAddMemberId = null;
            await this.loadSharedFolderMembers(this.currentManageSharedFolderId);
        } catch (e) {
            this.showError('添加失败', e.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 🔧 加载共享文件夹成员列表
     */
    async loadSharedFolderMembers(folderId) {
        try {
            const res = await fetch(`/api/cloud/shared-folders/${folderId}/members/`, {headers: TokenManager.getHeaders()});
            if (!res.ok) throw new Error('加载成员失败');
            const data = await res.json();
            const members = data.members || [];
            const listDiv = document.getElementById('sharedFolderMembersList');

            let html = '';
            members.forEach(m => {
                const isOwner = m.is_owner;
                html += `
                <div class="collab-manage-item" style="margin-bottom: 8px;">
                    <div class="collab-details" style="flex:1;">
                        <div class="collab-name">
                            ${this.escapeHtml(m.real_name)} 
                            ${isOwner ? '<span class="badge badge-success" style="font-size:10px; margin-left:5px;">所有者</span>' : ''}
                       </div>
                    </div>
                    <select class="collab-permission" ${isOwner ? 'disabled' : ''} onchange="cloudApp.updateSharedFolderPermission('${m.id}', this.value)">
                        <option value="read" ${m.permission === 'read' ? 'selected' : ''}>只读</option>
                        <option value="write" ${m.permission === 'write' ? 'selected' : ''}>可编辑</option>
                        <option value="admin" ${m.permission === 'admin' ? 'selected' : ''}>管理员</option>
                    </select>
                    ${!isOwner ? `<button class="btn-action btn-danger" onclick="cloudApp.removeSharedFolderMember('${m.id}')" title="移除"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            `;
            });
            listDiv.innerHTML = html || '<div class="empty-tip" style="padding:10px; color:#999;">暂无其他成员</div>';
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * 🔧 更新成员权限
     */
    async updateSharedFolderPermission(userId, permission) {
        try {
            const res = await fetch(`/api/cloud/shared-folders/${this.currentManageSharedFolderId}/update_member/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManager.getHeaders()},
                body: JSON.stringify({user_id: userId, permission: permission})
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || err.detail || err.message || '更新失败');
            }
            this.showSuccess('更新成功', '权限已更新');
        } catch (e) {
            this.showError('更新失败', e.message);
            await this.loadSharedFolderMembers(this.currentManageSharedFolderId); // 失败时恢复原状
        }
    }

    /**
     * 🔧 移除成员
     */
    async removeSharedFolderMember(userId) {

        const confirm = await this.showConfirmDialog('移除成员', '此操作将删除该成员，并取消该成员对当前文件夹的访问权限。', 'confirm');
        if (!confirm) return;

        try {
            const res = await fetch(`/api/cloud/shared-folders/${this.currentManageSharedFolderId}/remove_member/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManager.getHeaders()},
                body: JSON.stringify({user_id: userId})
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || err.detail || err.message || '移除失败')
            }
            ;
            this.showSuccess('移除成功', '成员已移除');
            await this.loadSharedFolderMembers(this.currentManageSharedFolderId);
        } catch (e) {
            this.showError('移除失败', e.message);
        }
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

// 全局初始化
let cloudApp = null;

// 确保在 DOM 加载完成后初始化 CloudApp
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        cloudApp = new CloudApp();
        window.cloudApp = cloudApp;
    });
} else {
    // 如果 DOM 已经加载完成，直接初始化
    cloudApp = new CloudApp();
    window.cloudApp = cloudApp;
}
