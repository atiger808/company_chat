// static/js/cloud-share.js - 我的分享、分享给他人、共享文件夹
// 说明：本文件为 CloudApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(CloudApp.prototype, {

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
    },

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
    },

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
            let shareName = share.file_info ? share.file_info.name : share.folder_info?.name || '未知';
            html += `
                <div class="share-item">
                    <div class="share-icon">
                        ${share.is_folder
                            ? '<i class="fas fa-folder"></i>'
                            : this._typedIconHtml(share.file_info || {name: share.file_info?.name}, 24)}
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
                       
                        <button class="btn-action" onclick="cloudApp.copyShareUrl(\`## 来自浙企钉分享 ## 【${shareName}】 ${share.share_url}?提取码=${share.password} 复制此链接，用浏览器打开\`)" title="复制分享链接">
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    /**
     * 🔧 分享文件/文件夹（支持文件夹）
     */
    async shareFile(fileId, isFolder = false, sourceName = '') {
        // 🔧 允许公开分享权限校验
        if (!(await this.checkOpPermission('allow_public_share', '您没有公开分享权限，请联系管理员开通'))) return;
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
    },

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
            let shareName = share.file_info ? share.file_info.name : share.folder_info?.name || '未知';
            if (share.password) shortUrl += `?pwd=${share.password}`; // 🔧 使用短参数避免二维码溢出

            // 🔧 根据分享方式显示不同内容
            if (shareMethod === 'link') {
                document.getElementById('shareLinkInput').value = `## 来自浙企钉分享 ## 【${shareName}】 ${shortUrl} 复制此链接，用浏览器打开` ;
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
    },

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
    },

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
    },


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
    },


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
    },

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
    },


    /**
     * 🔧 共享文件夹搜索输入（防抖触发全局搜索）
     */
    onSharedFolderSearchInput(value) {
        clearTimeout(this._sharedFolderSearchTimer);
        const self = this;
        this._sharedFolderSearchTimer = setTimeout(function () {
            self.searchSharedFolders((value || '').trim());
        }, 400);
    },

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

            // 搜索不传 folder：在整个可访问的共享文件夹内跨目录搜索文件
            let url = '/api/cloud/shared-folders/';
            const params = new URLSearchParams();
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

            // 搜索结果统一以“文件列表”形式渲染（含跨目录命中的文件）
            this.renderSharedFolderContents(results, '');

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
    },

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
    },

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
    },


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
    },

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
    },


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
                                ${this._typedIconHtml(item, 18)}
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
                            ${this._typedIconHtml(item, 48)}
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
    },


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
    },

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
    },

    /**
     * 🔧 返回共享文件夹根目录
     */
    async backToSharedFolderRoot() {
        this.sharedFolderPathStack = [];
        this.currentFolderId = null;
        this.updateSharedFolderBreadcrumb();
        await this.loadSharedFolders(null);
    },

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
    },

    /**
     * 🔧 按索引导航到共享文件夹
     */
    async navigateToSharedFolderByIndex(index) {
        this.sharedFolderPathStack = this.sharedFolderPathStack.slice(0, index + 1);
        this.updateSharedFolderBreadcrumb();
        const folderId = this.sharedFolderPathStack[index].id;
        await this.loadSharedFolders(folderId);
    },


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
    },

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
                const res = await fetch(`/api/cloud/search-users/?q=${encodeURIComponent(keyword)}`, {headers: TokenManager.getHeaders()});
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
                            <div style="font-size:11px;color:#909399;">${this.escapeHtml([u.position || '', u.department_name || u.department || (u.department_info && u.department_info.name) || ''].filter(Boolean).join(' · '))}</div>
                        </div>
                    </div>
                `).join('');
                }
                resultsDiv.style.display = 'block';
            } catch (err) {
                console.error('搜索用户失败', err);
            }
        }, 300);
    },

    /**
     * 🔧 选择待添加的成员
     */
    selectMemberToAdd(userId, userName) {
        this.tempAddMemberId = userId;
        document.getElementById('memberSearchResults').style.display = 'none';
        document.getElementById('memberSearchInput').value = userName;
    },

    /**
     * 🔧 添加共享文件夹成员
     */
    async addSharedFolderMember() {
        if (!this.tempAddMemberId) {
            this.showError('操作失败', '请先搜索并选择用户');
            return;
        }
        const permission = document.getElementById('memberPermissionSelect').value;
        const sendWorkNotify = document.getElementById('sendWorkNotifyCheckbox')?.checked ?? true;
        try {
            this.showLoading();
            const res = await fetch(`/api/cloud/shared-folders/${this.currentManageSharedFolderId}/add_member/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManager.getHeaders()},
                body: JSON.stringify({user_id: this.tempAddMemberId, permission: permission, send_work_notify: sendWorkNotify})
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
    },

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
                const notifyOn = m.notify_private_chat !== false;
                html += `
                <div class="collab-manage-item" style="margin-bottom: 8px;">
                    <div class="collab-details" style="flex:1;">
                        <div class="collab-name">
                            ${this.escapeHtml(m.real_name)}
                            ${isOwner ? '<span class="badge badge-success" style="font-size:10px; margin-left:5px;">所有者</span>' : ''}
                       </div>
                    </div>
                    <span style="font-size:11px; color:#909399; margin-right:6px;" title="是否以私聊消息形式通知该成员">私聊</span>
                    <label class="switch" style="margin-right: 10px;${isOwner ? 'pointer-events:none; opacity:.5;' : ''}" title="是否以私聊消息形式通知该成员">
                        <input type="checkbox" ${notifyOn ? 'checked' : ''} ${isOwner ? 'disabled' : ''} onchange="cloudApp.toggleMemberPrivateNotify('${m.id}', this.checked)">
                        <span class="slider"></span>
                    </label>
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
    },

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
    },

    /**
     * 🔧 切换成员私聊通知开关（决定是否以私聊消息形式通知该成员）
     */
    async toggleMemberPrivateNotify(userId, checked) {
        try {
            const res = await fetch(`/api/cloud/shared-folders/${this.currentManageSharedFolderId}/update_member/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManager.getHeaders()},
                body: JSON.stringify({user_id: userId, notify_private_chat: checked})
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || err.detail || err.message || '更新失败');
            }
            this.showSuccess('设置已保存', checked ? '已开启私聊通知' : '已关闭私聊通知');
        } catch (e) {
            this.showError('更新失败', e.message);
            await this.loadSharedFolderMembers(this.currentManageSharedFolderId); // 失败时恢复原状
        }
    },

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
    },
    });
})();
