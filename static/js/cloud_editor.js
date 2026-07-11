/**
 * @File   : cloud_editor.js
 * @Time   : 2026/4/2
 * @Author : dayue
 * @Desc   : 文档协同编辑器前端逻辑（ 协同编辑专用 JS - 深度优化版）
 */

// 从 URL 获取文件 ID
const fileId = new URLSearchParams(window.location.search).get('id');

// Token 管理器 增强 TokenManagerCustom
const TokenManagerCustom = {
    getToken: () => localStorage.getItem('access_token'),
    getRefreshToken: () => localStorage.getItem('refresh_token'),

    getHeaders: () => {
        const token = localStorage.getItem('access_token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    },

    // 获取带自动刷新的 headers
    async getHeadersWithRefresh() {
        let token = localStorage.getItem('access_token');
        const refreshToken = localStorage.getItem('refresh_token');

        if (!token) {
            console.warn('❌ 无 access_token');
            return null;
        }

        // 检查 token 是否过期或即将过期
        const tokenData = this.parseToken(token);
        if (tokenData && tokenData.exp) {
            const expiryTime = tokenData.exp * 1000;
            const now = Date.now();
            const timeUntilExpiry = expiryTime - now;

            // 如果 token 将在 5 分钟内过期，提前刷新
            if (timeUntilExpiry < 5 * 60 * 1000) {
                const newToken = await this.refreshToken();
                if (newToken) {
                    token = newToken;
                }
            }
        }

        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
    },

    // 刷新 Token
    async refreshToken() {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
            console.warn('❌ 无 refresh_token');
            return null;
        }

        try {
            const response = await fetch('/api/auth/token/refresh/', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({refresh: refreshToken})
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('access_token', data.access);
                if (data.refresh) {
                    localStorage.setItem('refresh_token', data.refresh);
                }
                console.log('✅ Token 刷新成功');
                return data.access;
            } else {
                console.error('❌ Token 刷新失败');
                // 清除过期 token
                this.clearTokens();
                return null;
            }
        } catch (error) {
            console.error('❌ Token 刷新请求失败:', error);
            return null;
        }
    },

    // 解析 Token
    parseToken(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload;
        } catch (e) {
            return null;
        }
    },

    // 清除 Token
    clearTokens() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
    },

    // 检查 Token 是否有效
    isTokenValid() {
        const token = this.getToken();
        if (!token) return false;

        const payload = this.parseToken(token);
        if (!payload || !payload.exp) return false;

        return payload.exp * 1000 > Date.now();
    }
};

// 文档编辑器应用类
class DocumentEditorApp {
    constructor(fileId) {
        this.fileId = fileId;
        this.editor = null;
        this.config = null;
        this.currentUser = null;
        this.collaborators = [];
        this.isCollabSidebarOpen = true;
        this.selectedCollaborators = new Map(); // key: userId, value: {id, name, real_name, permission, avatar}
        this.editingCollabId = null;
        this.hasError = false;

        // 协同编辑 WebSocket 相关
        this.collabSocket = null;
        this.cursorPositions = new Map();
        this.remoteSelections = new Map();
        this.userColors = new Map();
        this.typingTimeout = null;
        this.isMuted = false;

        this.init();
    }

    // 初始化
    async init() {
        try {
            // 0. 检查并刷新 token
            const token = localStorage.getItem('access_token');
            if (!token) {
                this.handleAuthError();
                return;
            }

            // 尝试刷新 token（如果即将过期）
            const tokenExpiry = this.getTokenExpiry(token);
            if (tokenExpiry && tokenExpiry < Date.now()) {
                console.log('Token 已过期，尝试刷新...');
                const newToken = await this.refreshToken();
                if (!newToken) return; // 刷新失败，已跳转登录页
            }

            // 1. 获取当前用户信息
            await this.loadCurrentUser();
            if (!this.fileId) throw new Error('文件 ID 缺失');

            // 2. 检查 OnlyOffice API
            if (typeof DocsAPI === 'undefined') {
                throw new Error('OnlyOffice 组件未加载，请刷新页面');
            }

            // 3. 获取编辑配置
            await this.fetchEditConfig();

            // 4. 更新页面信息
            this.updatePageInfo();

            // 5. 初始化 OnlyOffice 编辑器
            this.initEditor();

            // 6. 初始化协同编辑 WebSocket
            this.initCollabWebSocket();

            // 🔧 7. 首次打开文档时，仅调用一次更新协同状态
            await this.updateCollaborationStatus('editing');

            // 8. 加载初始协作者列表（全局唯一一次初始化请求）
            await this.loadCollaborators();

            // 9. 恢复编辑动态显示状态
            this.restoreEditActivityVisibility();

            // 10. 设置搜索事件监听
            this.setupSearchListener();


            // 11. 启用自动保存
            this.startAutoSave();

            // 12. 启动 Token 心跳检查（每 5 分钟检查一次）
            this.startTokenHeartbeat();

            // 13. 尝试恢复本地缓存
            const cachedContent = this.restoreFromLocalCache();
            if (cachedContent) {
                this.showToast('发现未保存的本地缓存', 'info', 5000);
            }

        } catch (error) {
            console.error('初始化失败:', error);
            this.showError(error.error || error.message || error.detail || `加载失败!`);
            this.handleAuthError();
        }
    }

    // 加载当前用户信息
    async loadCurrentUser() {
        try {
            const cachedUser = localStorage.getItem('current_user');
            if (cachedUser) {
                this.currentUser = JSON.parse(cachedUser);
                this.renderCurrentUser(); // 🔧 新增：渲染用户信息
                return;
            }

            const response = await fetch('/api/auth/me/', {
                headers: TokenManagerCustom.getHeaders()
            });

            if (response.ok) {
                this.currentUser = await response.json();
                localStorage.setItem('current_user', JSON.stringify(this.currentUser));
                this.renderCurrentUser(); // 🔧 新增：渲染用户信息
            } else {
                throw new Error('获取用户信息失败');
            }
        } catch (error) {
            console.warn('加载用户信息失败，使用降级方案:', error);
            this.currentUser = {
                id: `anon_${Date.now()}`,
                username: '匿名用户',
                real_name: '匿名用户',
                email: '',
                avatar: '/static/images/default-avatar.png'
            };
        }
    }

    // 🔧 渲染顶部栏当前用户信息
    renderCurrentUser() {
        if (!this.currentUser) return;

        const avatarEl = document.getElementById('currentUserAvatar');
        const nameEl = document.getElementById('currentUserName');

        if (avatarEl) {
            // 兼容不同接口返回的头像字段名，并设置加载失败的兜底图
            const avatarUrl = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
            avatarEl.src = avatarUrl;
            // 兜底：如果头像URL无效或加载失败，回退到默认头像
            avatarEl.onerror = () => {
                avatarEl.src = '/static/images/default-avatar.png';
            };
        }

        if (nameEl) {
            // 优先显示真实姓名，其次用户名
            const displayName = this.currentUser.real_name || this.currentUser.username || '匿名用户';
            nameEl.textContent = displayName;
            nameEl.title = displayName; // 鼠标悬停时显示完整名称（防止被截断）
        }
    }

    // 获取编辑配置
    async fetchEditConfig() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/edit/`, {
                headers: TokenManagerCustom.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.message || error.detail || '获取编辑配置失败');
            }

            this.config = await response.json();

            if (!this.config.document?.fileType || !this.config.documentType) {
                throw new Error('文档配置不完整');
            }
            if (!this.config.document?.url) {
                throw new Error('文档访问链接缺失');
            }
        } catch (error) {
            this.hasError = true;
            console.error('获取编辑配置失败:', error);
            this.showLoadingError(error || `加载失败, 您没有访问该文件的权限！`);
            this.showError(error || `加载失败, 您没有访问该文件的权限！`);
        }
    }

    // 初始化时设置文档链接
    updatePageInfo() {
        if (!this.config?.document) return;
        let version_number = this.config.document?.version_number;
        document.title = version_number ? `${this.config.document.title} - v${version_number} - 在线编辑` : `${this.config.document.title} - 在线编辑`;
        document.getElementById('docTitle').textContent = version_number ? `${this.config.document.title} - v${version_number}` : `${this.config.document.title}`;

        const docLinkInput = document.getElementById('docShareLink');
        if (docLinkInput) {
            docLinkInput.value = this.getDocShareLink();
            docLinkInput.onclick = () => this.copyDocLink();
        }

        const iconMap = {
            'word': 'fa-file-word',
            'excel': 'fa-file-excel',
            'ppt': 'fa-file-powerpoint',
            'pdf': 'fa-file-pdf',
        };
        const icon = iconMap[this.config.documentType] || 'fa-file';
        document.getElementById('docTypeIcon').className = `fas ${icon}`;
    }

    // ==================== OnlyOffice 编辑器初始化 ====================

    initEditor() {
        if (!this.config) return;
        if (typeof DocsAPI === 'undefined' || typeof DocsAPI.DocEditor !== 'function') {
            console.error('❌ OnlyOffice API 未加载成功');
            return;
        }

        const loadingEl = document.getElementById('loadingState');
        if (loadingEl) loadingEl.style.display = 'none';

        try {
            const editorConfig = {
                ...this.config,
                documentServerUrl: "https://chat.first-iq.com/onlyoffice/",
                editorConfig: {
                    ...this.config.editorConfig,
                    user: {
                        id: String(this.currentUser?.id || Date.now()),
                        name: this.currentUser?.real_name || this.currentUser?.username || '匿名用户',
                        email: this.currentUser?.email || ''
                    },
                    customization: {
                        ...this.config.editorConfig?.customization,
                        chat: true,
                        mentionShare: true,
                        onChatMessage: (message) => {
                            this.syncChatMessage(message);
                        }
                    }
                },
                events: {
                    onDocumentReady: () => {
                        console.log('✅ 文档就绪');
                        this.setupHideElementListener();
                        // 🔧 优化：移除这里的 loadCollaborators()，因为在 init() 中已经加载过了，避免重复请求
                    },
                    onDocumentStateChange: (event) => {
                        this._hasUnsavedChanges = !!event.data;
                        this.updateSaveStatus({data: event.data});
                    },
                    onRequestClose: async () => {
                        console.log('📝 用户请求关闭文档');
                        await this.updateCollaborationStatus('closed');
                        await this.closeEditor();
                    },
                    onError: (event) => {
                        console.error('❌ OnlyOffice 错误:', event.data);
                        this.showError('编辑器发生错误：' + JSON.stringify(event.data));
                    },
                    onRequestEditRights: () => {
                        this.fetchEditConfig().then(() => this.initEditor());
                    },
                    onCursor: (event) => {
                        if (this.collabSocket?.readyState === WebSocket.OPEN) {
                            this.sendCollabMessage('cursor_update', {
                                userId: this.config.editorConfig?.user?.id,
                                userName: this.config.editorConfig?.user?.name,
                                position: event.data,
                                color: this.getUserColor(this.config.editorConfig?.user?.id)
                            });
                        }
                    },
                    onSelectionChange: (event) => {
                        if (this.collabSocket?.readyState === WebSocket.OPEN) {
                            this.sendCollabMessage('selection_update', {
                                userId: this.config.editorConfig?.user?.id,
                                selection: event.data
                            });
                        }
                    },
                    onInput: () => {
                        if (this.typingTimeout) clearTimeout(this.typingTimeout);
                        this.typingTimeout = setTimeout(() => {
                            if (this.collabSocket?.readyState === WebSocket.OPEN) {
                                this.sendCollabMessage('user_typing', {
                                    userId: this.config.editorConfig?.user?.id,
                                    userName: this.config.editorConfig?.user?.name,
                                    isTyping: true
                                });
                            }
                        }, 500);
                    },
                    onInputEnd: () => {
                        if (this.collabSocket?.readyState === WebSocket.OPEN) {
                            this.sendCollabMessage('user_typing', {
                                userId: this.config.editorConfig?.user?.id,
                                userName: this.config.editorConfig?.user?.name,
                                isTyping: false
                            });
                        }
                    }
                }
            };

            this.editor = new DocsAPI.DocEditor('editor-placeholder', editorConfig);
            if (!this.editor) throw new Error('编辑器实例创建失败');
            console.log('✅ OnlyOffice 编辑器初始化成功');

        } catch (error) {
            console.error('initEditor failed:', error);
            this.showLoadingError('编辑器启动失败: ' + (error.message || '未知错误'));
        }
    }

    showLoadingError(message) {
        const loadingEl = document.getElementById('loadingState');
        if (loadingEl) {
            loadingEl.style.display = 'flex';
            loadingEl.innerHTML = `
                <i class="fas fa-exclamation-circle"></i>
                <p>${message}</p>
                <div style="margin-top:15px;">
                    <button class="btn btn-primary" onclick="location.reload()">重试</button>
                    <button class="btn btn-secondary" onclick="window.close()" style="margin-left:10px;">关闭</button>
                </div>
            `;
        }
    }

    // ==================== 协同编辑 WebSocket ====================

    initCollabWebSocket() {
        // 避免重复连接
        if (this.collabSocket && this.collabSocket.readyState === WebSocket.OPEN) {
            console.log('⚠️ WebSocket 已连接，跳过');
            return;
        }

        // 关闭旧连接
        if (this.collabSocket) {
            this.collabSocket.close(1000, 'Reconnecting');
            this.collabSocket = null;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('access_token');

        if (!token) {
            console.warn('❌ 未找到 access_token，跳转登录页');
            this.handleAuthError();
            return;
        }

        const wsUrl = `${protocol}//${window.location.host}/ws/cloud/collab/${this.fileId}/?token=${encodeURIComponent(token)}`;

        // 连接超时控制
        const connectionTimeout = setTimeout(() => {
            if (this.collabSocket && this.collabSocket.readyState === WebSocket.CONNECTING) {
                console.warn('⚠️ WebSocket 连接超时');
                this.collabSocket.close();
            }
        }, 10000); // 10秒超时


        try {
            this.collabSocket = new WebSocket(wsUrl);

            this.collabSocket.onopen = () => {
                clearTimeout(connectionTimeout);
                this.reconnectAttempt = 0; // 重置重连次数
                console.log('✅ 协同编辑 WebSocket 已连接');

                this.sendCollabMessage('user_joined', {
                    user: {
                        id: this.config?.editorConfig?.user?.id,
                        name: this.config?.editorConfig?.user?.name,
                        avatar: this.currentUser?.avatar_url || '/static/images/default-avatar.png'
                    },
                    timestamp: new Date().toISOString()
                });
            };

            this.collabSocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleCollabMessage(data);
                } catch (e) {
                    console.error('解析协同消息失败:', e);
                }
            };

            this.collabSocket.onclose = (event) => {
                clearTimeout(connectionTimeout);
                console.log(`🔌 协同编辑 WebSocket 已断开 (code: ${event.code}, reason: ${event.reason})`);

                // 认证失败 (code 4001) - 不再重连，跳转登录页
                if (event.code === 4001) {
                    console.warn('❌ 认证失败，token 无效或已过期');
                    this.showToast('认证失败，请重新登录', 'error', 5000);
                    setTimeout(() => this.handleAuthError(), 2000);
                    return;
                }

                // 权限不足 (code 4003) - 不再重连
                if (event.code === 4003) {
                    console.warn('❌ 权限不足，无法访问此文档');
                    this.showToast('您没有权限访问此文档', 'error', 5000);
                    return;
                }

                // 正常关闭 (code 1000) 或页面卸载时不重连
                if (event.code === 1000 || event.code === 1001) {
                    console.log('WebSocket 正常关闭');
                    return;
                }

                // 其他错误 - 尝试刷新 Token 后有限次重连
                if (!this.hasError) {
                    const maxRetries = 5;
                    const currentAttempt = this.reconnectAttempt || 0;

                    if (currentAttempt < maxRetries) {
                        const reconnectDelay = Math.min(3000 * (currentAttempt + 1), 15000);
                        this.reconnectAttempt = currentAttempt + 1;

                        console.log(`🔄 尝试重连 (${currentAttempt + 1}/${maxRetries})，延迟 ${reconnectDelay}ms`);
                        this.showToast(`连接断开，尝试重连 (${currentAttempt + 1}/${maxRetries})...`, 'warning');

                        // 重连前先尝试刷新 token（可能连接断开是因为 token 过期）
                        if (this.reconnectAttempt === 1) {
                            const token = TokenManagerCustom.getToken();
                            const tokenData = token ? TokenManagerCustom.parseToken(token) : null;
                            if (tokenData && tokenData.exp) {
                                const timeUntilExpiry = (tokenData.exp * 1000) - Date.now();
                                if (timeUntilExpiry < 300000) { // 5分钟内过期
                                    console.log('⏰ Token 可能已过期，重连前尝试刷新...');
                                    TokenManagerCustom.refreshToken().then(newToken => {
                                        if (newToken) {
                                            setTimeout(() => this.initCollabWebSocket(), 1000);
                                        } else {
                                            setTimeout(() => this.initCollabWebSocket(), reconnectDelay);
                                        }
                                    }).catch(() => {
                                        setTimeout(() => this.initCollabWebSocket(), reconnectDelay);
                                    });
                                    return; // 由 refreshToken 回调触发重连
                                }
                            }
                        }

                        setTimeout(() => this.initCollabWebSocket(), reconnectDelay);
                    } else {
                        console.error('❌ 重连次数已达上限');
                        this.showToast('连接失败，请刷新页面重试', 'error', 5000);
                    }
                }
            };

            this.collabSocket.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('协同编辑 WebSocket 错误:', error);
            };

        } catch (error) {
            clearTimeout(connectionTimeout);
            console.error('创建协同编辑 WebSocket 失败:', error);
        }
    }

    sendCollabMessage(type, payload) {
        if (this.collabSocket?.readyState === WebSocket.OPEN) {
            this.collabSocket.send(JSON.stringify({
                type,
                data: {
                    ...payload,
                    file_id: this.fileId,
                    sender_id: this.config?.editorConfig?.user?.id
                },
                timestamp: new Date().toISOString()
            }));
        }
    }

    // 🔧 核心优化：处理协同消息（彻底移除冗余的 HTTP 请求）
    handleCollabMessage(data) {
        const type = data.type;
        const payload = data.data;

        switch (type) {
            case 'user_joined':
                // 🔧 优化：直接通过 WebSocket 数据更新本地状态，不再调用 loadCollaborators()
                this.handleUserJoined(payload);
                break;

            case 'user_left':
                // 🔧 优化：直接通过 WebSocket 数据更新本地状态，不再调用 loadCollaborators()
                this.handleUserLeft(payload);
                break;

            case 'collab_status_update':
                // 🔧 优化：直接通过 WebSocket 数据更新本地状态，不再调用 loadCollaborators()
                this.updateCollaboratorStatus(payload);
                break;

            case 'cursor_update':
                this.updateRemoteCursor(payload);
                break;

            case 'selection_update':
                this.updateRemoteSelection(payload);
                break;

            case 'user_typing':
                this.handleTypingIndicator(payload);
                break;

            case 'chat_message':
                this.handleChatMessage(payload);
                break;

            case 'document_saved':
                this.handleDocumentSaved(payload);
                break;

            case 'version_created':
                this.handleVersionCreated(payload);
                break;

            case 'error':
                this.handleCollabError(payload);
                break;

            case 'heartbeat':
                break;

            default:
                console.warn('⚠️ 未知协同消息类型:', type);
        }
    }

    // ==================== 用户状态处理 ====================

    handleUserJoined(payload) {
        const {user, timestamp} = payload;
        if (!user?.id) return;

        // 🔧 修复：统一转换为字符串进行比较，防止数字和字符串类型不一致导致重复添加
        const userStrId = String(user.id);
        const existingIndex = this.collaborators.findIndex(c => String(c.id) === userStrId);

        // 更新本地协作者列表
        if (existingIndex >= 0) {
            this.collaborators[existingIndex] = {
                ...this.collaborators[existingIndex],
                ...user,
                id: userStrId, // 确保 ID 类型一致
                status: 'editing',
                last_activity: timestamp,
                is_online: true
            };
        } else {
            this.collaborators.push({
                ...user,
                id: userStrId, // 确保 ID 类型一致
                status: 'editing',
                last_activity: timestamp,
                is_online: true,
                color: this.getUserColor(user.id)
            });
        }

        // 重新渲染列表
        this.renderCollabList();
        this.updateCollabCount();
        this.showEditActivity(user.real_name || user.username, '加入了协同编辑', new Date(timestamp));

        // 播放加入提示音（非自己）
        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);
        if (userStrId !== currentUserIdStr && this.shouldPlayJoinSound()) {
            this.playNotificationSound('join', user.name || user.real_name || user.username, {
                body: '加入了协同编辑',
                icon: user?.avatar || user?.avatar_url || '/static/images/default-avatar.png',
                requireInteraction: false,
                silent: false,
                tag: `collab-${userStrId}-${Date.now()}`
            });
        }
        this.renderRemoteCursors();
    }

    handleUserLeft(payload) {
        const {userId, userName, timestamp, reason} = payload;
        if (!userId) return;

        // 🔧 修复：统一转换为字符串进行比较
        const userStrId = String(userId);
        const collabIndex = this.collaborators.findIndex(c => String(c.id) === userStrId);

        if (collabIndex >= 0) {
            this.collaborators[collabIndex] = {
                ...this.collaborators[collabIndex],
                status: 'closed',
                last_activity: timestamp,
                is_online: false,
                left_at: timestamp
            };
        }

        // 清理远程光标和选区（使用字符串 ID）
        this.cursorPositions.delete(userStrId);
        if (this.remoteSelections) this.remoteSelections.delete(userStrId);

        if (this.editor?.coAuthoringApi) {
            this.editor.coAuthoringApi.removeCursor?.(userStrId);
            this.editor.coAuthoringApi.removeSelection?.(userStrId);
        }

        // 重新渲染
        this.renderCollabList();
        this.updateCollabCount();

        const reasonText = reason === 'timeout' ? '（连接超时）' :
            reason === 'conflict' ? '（编辑冲突）' : '';
        this.showEditActivity(userName, `离开了协同编辑${reasonText}`, new Date(timestamp));
    }

    updateCollaboratorStatus(payload) {
        const {userId, status, last_activity} = payload;
        if (!userId) return;

        // 🔧 修复：统一转换为字符串进行比较
        const userStrId = String(userId);
        const collab = this.collaborators.find(c => String(c.id) === userStrId);

        if (collab) {
            collab.status = status;
            collab.last_activity = last_activity;
            collab.is_online = status !== 'closed';

            this.renderCollabList();
            this.updateCollabCount();

            const statusText = status === 'editing' ? '正在编辑' :
                status === 'viewing' ? '正在查看' : '已离开';
            this.showEditActivity(collab.real_name || collab.username, statusText, new Date(last_activity), collab);
        }
    }


    // ==================== 光标与选区处理 ====================

    updateRemoteCursor(payload) {
        const {userId, userName, position, color} = payload;
        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);
        // 🔧 修复：统一类型比较
        if (String(userId) === currentUserIdStr) return;

        const userStrId = String(userId);
        this.cursorPositions.set(userStrId, {position, color, userName, timestamp: Date.now()});
        this.renderRemoteCursors();
    }

    renderRemoteCursors() {
        if (!this.editor?.coAuthoringApi) return;
        const now = Date.now();
        const EXPIRE_TIME = 30000;
        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);

        for (const [userId, data] of this.cursorPositions.entries()) {
            if (now - data.timestamp > EXPIRE_TIME) {
                this.cursorPositions.delete(userId);
                this.editor.coAuthoringApi.removeCursor?.(userId);
                continue;
            }
            if (userId !== currentUserIdStr) {
                try {
                    this.editor.coAuthoringApi.addCursor?.({
                        userId, userName: data.userName,
                        color: data.color || this.getUserColor(userId),
                        position: data.position
                    });
                } catch (e) {
                    console.warn('渲染远程光标失败:', e);
                }
            }
        }
    }

    updateRemoteSelection(payload) {
        const {userId, userName, selection, color} = payload;
        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);
        if (String(userId) === currentUserIdStr) return;

        if (!this.remoteSelections) this.remoteSelections = new Map();
        const userStrId = String(userId);
        this.remoteSelections.set(userStrId, {
            selection,
            color: color || this.getUserColor(userStrId),
            userName,
            timestamp: Date.now()
        });
        this.renderRemoteSelections();
    }


    renderRemoteSelections() {
        if (!this.editor?.coAuthoringApi) return;
        const now = Date.now();
        const EXPIRE_TIME = 30000;

        for (const [userId, data] of this.remoteSelections.entries()) {
            if (now - data.timestamp > EXPIRE_TIME) {
                this.remoteSelections.delete(userId);
                this.editor.coAuthoringApi.removeSelection?.(userId);
                continue;
            }
            try {
                this.editor.coAuthoringApi.removeSelection?.(userId);
                if (data.selection?.ranges?.length > 0) {
                    this.editor.coAuthoringApi.addSelection?.({
                        userId, userName: data.userName, color: data.color,
                        ranges: data.selection.ranges,
                        style: {backgroundColor: `${data.color}20`, borderColor: data.color, borderWidth: 2}
                    });
                }
            } catch (e) {
                console.warn('渲染远程选区失败:', e);
            }
        }
    }

    // ==================== 输入状态处理 ====================

    handleTypingIndicator(payload) {
        const {userId, userName, isTyping} = payload;
        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);
        if (String(userId) === currentUserIdStr) return;

        const userStrId = String(userId);
        const collab = this.collaborators.find(c => String(c.id) === userStrId);
        if (!collab) return;

        if (isTyping) {
            this.showTypingStatus(userName, true);
            setTimeout(() => {
                const currentCollab = this.collaborators.find(c => String(c.id) === userStrId);
                if (currentCollab?.isTyping) this.showTypingStatus(userName, false);
            }, 5000);
        } else {
            this.showTypingStatus(userName, false);
        }
    }


    showTypingStatus(userName, isTyping) {
        const indicator = document.getElementById('typingIndicator');
        if (!indicator) return;
        if (isTyping) {
            indicator.textContent = `${userName} 正在输入...`;
            indicator.style.display = 'flex';
        } else {
            const typingUsers = this.collaborators.filter(c => c.isTyping && c.id !== this.currentUser?.id);
            if (typingUsers.length === 0) indicator.style.display = 'none';
        }
    }

    // ==================== 聊天消息处理 ====================

    handleChatMessage(payload) {
        const {messageId, userId, userName, avatar, content, timestamp, mentionUsers, isSystem} = payload;
        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);

        if (String(userId) === currentUserIdStr) return;

        this.appendChatMessage(payload);

        // 🔧 修复：统一类型判断 @提及
        const isMentioned = mentionUsers?.some(id => String(id) === currentUserIdStr);
        if (isMentioned) {
            this.highlightMentionMessage(messageId);
            this.playNotificationSound('mention', userName, {
                body: content, icon: avatar || '/static/images/default-avatar.png',
                requireInteraction: false, silent: false, tag: `collab-${userId}-${Date.now()}`
            });
        }

        if (!document.hasFocus() && !this.isMuted && Notification.permission === 'granted') {
            const mentionText = isMentioned ? '🔔 提到你: ' : '';
            new Notification(`${mentionText}${userName} 发送消息`, {
                body: this.truncateMessage(content, 50),
                icon: avatar || '/static/images/default-avatar.png',
                tag: `chat-${messageId}`,
                requireInteraction: isMentioned,
                silent: false
            });
        }
        this.incrementUnreadChatCount();
    }

    appendChatMessage(payload) {
        const {userId, userName, avatar, content, timestamp, isSystem, mentionUsers} = payload;
        const chatContainer = document.getElementById('collabChatMessages');
        if (!chatContainer) return;

        const currentUserIdStr = String(this.config?.editorConfig?.user?.id);
        const isMentioned = mentionUsers?.some(id => String(id) === currentUserIdStr);

        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isSystem ? 'system' : ''} ${isMentioned ? 'mention' : ''}`;
        messageEl.dataset.messageId = payload.messageId;

        const safeContent = this.escapeHtml(content)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/@(\w+)/g, '<span class="mention">@<strong>$1</strong></span>');

        messageEl.innerHTML = `
        <div class="chat-message-header">
            <img src="${avatar || '/static/images/default-avatar.png'}" class="chat-avatar" alt="${userName}" title="${userName}">
            <div class="chat-meta">
                <span class="chat-username">${this.escapeHtml(userName)}</span>
                <span class="chat-time">${this.formatTime(timestamp)}</span>
                ${isMentioned ? '<span class="mention-badge">🔔</span>' : ''}
            </div>
        </div>
        <div class="chat-message-body">${safeContent}</div>`;

        chatContainer.appendChild(messageEl);
        chatContainer.scrollTop = chatContainer.scrollHeight;
        while (chatContainer.children.length > 100) chatContainer.removeChild(chatContainer.firstChild);
    }


    highlightMentionMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.classList.add('mention-highlight');
            setTimeout(() => messageEl.classList.remove('mention-highlight'), 3000);
            const chatSection = document.getElementById('collabChatSection');
            if (chatSection?.classList.contains('collapsed')) chatSection.classList.remove('collapsed');
        }
    }

    incrementUnreadChatCount() {
        const badge = document.getElementById('chatUnreadBadge');
        if (badge) {
            const count = parseInt(badge.textContent) || 0;
            badge.textContent = count + 1;
            badge.style.display = count + 1 > 0 ? 'inline-block' : 'none';
        }
    }

    // ==================== 文档操作处理 ====================

    handleDocumentSaved(payload) {
        const {versionNumber, savedBy, timestamp} = payload;
        this.updateSaveStatus({data: false});
        this.showToast(`文档已自动保存 (v${versionNumber})`, 'success', 2000);
        if (savedBy !== this.currentUser?.username) {
            this.showEditActivity(savedBy, `保存了文档 (v${versionNumber})`, new Date(timestamp));
        }
    }

    handleVersionCreated(payload) {
        const {versionNumber, createdBy, timestamp, comment} = payload;
        this.showToast(`新版本已创建: v${versionNumber}`, 'info', 3000);
        this.showEditActivity(createdBy, `创建了版本 v${versionNumber}${comment ? `: ${comment}` : ''}`, new Date(timestamp));
        if (document.getElementById('versionModal')?.classList.contains('show')) this.showVersions();
    }

    handleCollabError(payload) {
        const {code, message} = payload;
        const errorMap = {
            'permission_denied': '您没有权限执行此操作',
            'document_locked': '文档已被其他用户锁定，请稍后重试',
            'version_conflict': '版本冲突，请刷新页面后重试',
            'connection_lost': '连接断开，正在重连...'
        };
        this.showError(errorMap[code] || message || '协同编辑发生错误');
        if (code === 'connection_lost') setTimeout(() => this.initCollabWebSocket(), 2000);
    }

    async syncChatMessage(message) {
        try {
            await fetch(`/api/cloud/documents/${this.fileId}/chat_message/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json', ...TokenManagerCustom.getHeaders()},
                body: JSON.stringify({
                    content: message.text, timestamp: message.time,
                    user_id: message.user?.id, user_name: message.user?.name, avatar: message.user?.avatar
                })
            });
        } catch (error) {
            console.warn('聊天消息同步失败:', error);
        }
    }

    // ==================== 协同编辑功能 ====================

    async loadCollaborators() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/`, {
                headers: TokenManagerCustom.getHeaders()
            });
            if (!response.ok) {
                if (response.status === 401) {
                    this.handleAuthError();
                    return null;
                }
                throw new Error('加载协作者失败');
            }
            const data = await response.json();
            let rawCollaborators = data.collaborators || [];

            // 🔧 关键修复：对协作者列表进行强制去重（防止因类型不一致或后端数据重复导致的问题）
            const uniqueMap = new Map();
            rawCollaborators.forEach(collab => {
                // 统一使用字符串 ID 作为 Key，保留最新的一条记录
                uniqueMap.set(String(collab.id), collab);
            });
            this.collaborators = Array.from(uniqueMap.values());

            // 渲染协作者列表
            this.renderCollabList();
            this.updateCollabCount();

            // 检查是否是所有者（统一类型比较）
            const currentUserIdStr = String(this.currentUser?.id);
            const isOwner = this.collaborators.some(c => String(c.id) === currentUserIdStr && c.is_owner);

            // 如果不是所有者，则检查是否有管理员权限
            const hasAdminPermission = isOwner || this.collaborators.some(c => String(c.id) === currentUserIdStr && c.permission === 'admin');

            if (hasAdminPermission) {
                document.getElementById('manageCollabSection').style.display = 'block';
                this.renderManageCollabList();
            } else {
                document.getElementById('manageCollabSection').style.display = 'none';
            }
        } catch (error) {
            console.error('加载协作者失败:', error);
        }
    }

    renderCollabList() {
        const container = document.getElementById('onlineCollabList');
        if (!container) return;
        const onlineCollabs = this.collaborators.filter(c => c.status === 'editing' || c.status === 'viewing');
        if (onlineCollabs.length === 0) {
            container.innerHTML = '<div class="empty-tip" style="color:#999;font-size:12px;text-align:center;padding:10px;">暂无在线协作者</div>';
            return;
        }
        container.innerHTML = onlineCollabs.map(collab => `
            <div class="collab-item ${collab.is_owner ? 'owner' : ''}">
                <div class="collab-avatar">
                    <img src="${collab.avatar || '/static/images/default-avatar.png'}" alt="${collab.real_name}">
                    <span class="online-indicator ${collab.status === 'editing' ? 'online' : 'offline'}"></span>
                </div>
                <div class="collab-info">
                    <div class="collab-name">${this.currentUser?.id === collab.id ? '我' : this.escapeHtml(collab.real_name || collab.username)}</div>
                    <div class="collab-meta">${collab.status === 'editing' ? '✏️ 编辑中' : '👁️ 查看中'}</div>
                </div>
            </div>
        `).join('');
    }

    renderManageCollabList() {
        const container = document.getElementById('manageCollabList');
        if (!container) return;
        if (this.collaborators.length === 0) {
            container.innerHTML = '<div class="empty-tip" style="color:#999;font-size:12px;text-align:center;padding:10px;">暂无协作者</div>';
            return;
        }
        container.innerHTML = this.collaborators.map(collab => `
            <div class="collab-item ${collab.is_owner ? 'owner' : ''}" data-user-id="${collab.id}">
                <div class="collab-avatar">
                    <img src="${collab.avatar || '/static/images/default-avatar.png'}" alt="${collab.real_name}">
                    <span class="online-indicator ${collab.status === 'editing' ? 'online' : 'offline'}"></span>
                </div>
                <div class="collab-info">
                    <div class="collab-name">${this.currentUser?.id === collab.id ? '我' : this.escapeHtml(collab.real_name || collab.username)}</div>
                    <div class="collab-meta">
                        <span class="collab-permission ${collab.permission}">${this.getPermissionText(collab.permission)}</span>
                        ${collab.is_active ? '' : '<span class="badge badge-warning" style="margin-left:5px;">已禁用</span>'}
                    </div>
                </div>
                ${!collab.is_owner ? `
                <div class="collab-actions">
                    <button class="collab-action-btn" onclick="editorApp.openEditCollabModal('${collab.id}', '${collab.permission}', ${collab.is_active})" title="修改权限"><i class="fas fa-edit"></i></button>
                    <button class="collab-action-btn danger" onclick="editorApp.removeCollaborator('${collab.id}', '${this.escapeHtml(collab.real_name || collab.username)}')" title="移除协作者"><i class="fas fa-trash"></i></button>
                </div>` : ''}
            </div>
        `).join('');
    }

    updateCollabCount() {
        const countEl = document.getElementById('onlineCollabCount');
        if (countEl) {
            const onlineCount = this.collaborators.filter(c => c.status === 'editing' || c.status === 'viewing').length;
            countEl.textContent = onlineCount;
        }
    }

    getPermissionText(permission) {
        const map = {'read': '只读', 'write': '可编辑', 'admin': '管理员'};
        return map[permission] || permission;
    }

    async updateCollaborationStatus(status) {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaboration/status/`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json', ...TokenManagerCustom.getHeaders()},
                body: JSON.stringify({status: status}),
                keepalive: true // 🔧 关键：保证页面卸载时请求能发出去
            });
            if (!response.ok) {
                console.error('更新协同状态失败:', response.status, response.statusText);
                throw new Error('更新协同状态失败 ' + response.status);
            }

        } catch (error) {
            console.error('更新协同状态失败:', error);
        }
    }

    toggleCollabSidebar(btn) {
        const sidebar = document.getElementById('collaborationSidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
            this.isCollabSidebarOpen = !this.isCollabSidebarOpen;
        }
        btn = btn || document.getElementById('collaborationBtn');
        if (btn) {
            this.isCollabSidebarOpen ? btn.className = 'btn btn-primary' : btn.className = 'btn btn-secondary';
        }
    }

    // ==================== 编辑动态 ====================

    toggleEditActivity() {
        const activityList = document.getElementById('editActivityList');
        const toggleBtn = document.querySelector('.section-title .btn-secondary i');
        if (!activityList || !toggleBtn) return;
        const isHidden = activityList.style.display === 'none';
        activityList.style.display = isHidden ? 'flex' : 'none';
        toggleBtn.className = isHidden ? 'fas fa-eye' : 'fas fa-eye-slash';
        toggleBtn.title = isHidden ? '隐藏编辑动态' : '显示编辑动态';
        localStorage.setItem('hideEditActivity', String(!isHidden));
    }

    restoreEditActivityVisibility() {
        const hideActivity = localStorage.getItem('hideEditActivity') === 'true';
        if (hideActivity) {
            const activityList = document.getElementById('editActivityList');
            const toggleBtn = document.querySelector('.section-title .btn-secondary i');
            if (activityList) activityList.style.display = 'none';
            if (toggleBtn) {
                toggleBtn.className = 'fas fa-eye-slash';
                toggleBtn.title = '显示编辑动态';
            }
        }
    }

    showEditActivity(userName, action, timestamp, collab = null) {
        const container = document.getElementById('editActivityList');
        if (!container) return;
        const item = document.createElement('div');
        item.className = 'edit-activity-item';
        item.innerHTML = `
            <img src="${collab?.avatar || '/static/images/default-avatar.png'}" class="edit-activity-avatar" alt="${userName}">
            <span class="edit-activity-text"><strong>${this.escapeHtml(userName)}</strong> ${action}</span>
            <span class="edit-activity-time">${this.formatTime(timestamp)}</span>`;
        container.insertBefore(item, container.firstChild);
        while (container.children.length > 10) container.removeChild(container.lastChild);
    }

    shouldPlayJoinSound() {
        const soundEnabled = localStorage.getItem('collabSoundNotifications') !== 'false';
        return this.config?.editorConfig?.user?.id ? soundEnabled : false;
    }

    // ==================== 版本历史功能 ====================

    async showVersions() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/versions/`, {headers: TokenManagerCustom.getHeaders()});
            if (!response.ok) throw new Error('加载版本失败');
            const data = await response.json();
            this.renderVersionList(data.versions);
            document.getElementById('versionModal').classList.add('show');
        } catch (error) {
            this.showError('加载版本历史失败：' + error.message);
        }
    }

    renderVersionList(versions) {
        const container = document.getElementById('versionList');
        if (!versions || versions.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;">暂无版本记录</p>';
            return;
        }
        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="background:#f5f7fa;">
                    <th style="padding:12px;text-align:left;">版本号</th><th style="padding:12px;text-align:left;">大小</th>
                    <th style="padding:12px;text-align:left;">创建者</th><th style="padding:12px;text-align:left;">时间</th>
                    <th style="padding:12px;text-align:center;">操作</th>
                </tr></thead>
                <tbody>
                    ${versions.map(v => `
                        <tr style="border-bottom:1px solid #ebeef5;">
                            <td style="padding:12px;">v${v.version_number} ${v.is_current ? '<span style="color:#67C23A;margin-left:5px;">(当前)</span>' : ''}</td>
                            <td style="padding:12px;">${this.formatFileSize(v.file_size)}</td>
                            <td style="padding:12px;">${v.created_by}</td>
                            <td style="padding:12px;">${new Date(v.created_at).toLocaleString('zh-CN')}</td>
                            <td style="padding:12px;text-align:center; display: flex;">
                                <button class="btn btn-secondary btn-sm" onclick="editorApp.downloadVersion('${v.id}', '${this.escapeHtml(v.created_by)}', ${v.version_number})" style="padding:4px 12px;font-size:12px;">下载</button>
                                ${!v.is_current ? `<button class="btn btn-primary btn-sm" onclick="editorApp.restoreVersion('${v.id}')" style="padding:4px 12px;font-size:12px;margin-right:5px;">恢复</button>` : ''}
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    }

    async restoreVersion(versionId) {
        const confirmed = await this.showConfirmDialog('恢复版本', '确定要恢复到此版本吗？当前内容将被覆盖。', 'confirm');
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/restore_version/`, {
                method: 'POST', headers: {'Content-Type': 'application/json', ...TokenManagerCustom.getHeaders()},
                body: JSON.stringify({version_id: versionId, create_backup: false})
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '恢复失败');
            }
            this.showSuccess('版本恢复成功！');
            this.closeVersionModal();
            location.reload();
        } catch (error) {
            this.showError('恢复版本失败：' + error.message);
        }
    }

    async downloadVersion(versionId, createdBy, versionNumber) {
        try {
            const response = await fetch(`/api/cloud/documents/versions/${versionId}/download/`, {headers: TokenManagerCustom.getHeaders()});
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '下载失败');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `文档_v${versionNumber}_${createdBy}.docx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
        } catch (error) {
            this.showError('下载版本失败: ' + error.message);
        }
    }

    closeVersionModal() {
        document.getElementById('versionModal').classList.remove('show');
    }

    // ==================== 协作者管理功能 ====================

    showAddCollaboratorModal() {
        document.getElementById('addCollaboratorModal').classList.add('show');
        document.getElementById('collabSearchInput').value = '';
        document.getElementById('collabSearchResults').innerHTML = '';
        this.selectedCollaborators.clear();
        this._renderSelectedCollabs();
    }

    closeAddCollaboratorModal() {
        document.getElementById('addCollaboratorModal').classList.remove('show');
        this.selectedCollaborators.clear();
    }

    // 🔧 渲染已选协作者列表（含权限选择和移除功能）
    _renderSelectedCollabs() {
        const container = document.getElementById('selectedCollabsList');
        if (!container) return;

        if (this.selectedCollaborators.size === 0) {
            container.innerHTML = '<small class="text-muted">暂无选中的协作者</small>';
            return;
        }

        let html = '<div class="collabs-grid">';
        this.selectedCollaborators.forEach((collab) => {
            const name = this.escapeHtml(collab.real_name || collab.name);
            html += `
            <div class="collab-tag" data-user-id="${collab.id}">
                <span class="collab-name">${name}</span>
                <select class="collab-permission" onchange="editorApp._updateCollabPermission('${collab.id}', this.value)">
                    <option value="read" ${collab.permission === 'read' ? 'selected' : ''}>只读</option>
                    <option value="write" ${collab.permission === 'write' ? 'selected' : ''}>可编辑</option>
                    <option value="admin" ${collab.permission === 'admin' ? 'selected' : ''}>管理员</option>
                </select>
                <i class="fas fa-times remove-collab" onclick="editorApp._removeSelectedCollab('${collab.id}')"></i>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    }

    // 🔧 更新已选协作者的权限
    _updateCollabPermission(userId, permission) {
        const collab = this.selectedCollaborators.get(userId);
        if (collab) {
            collab.permission = permission;
        }
    }

    // 🔧 移除已选协作者
    _removeSelectedCollab(userId) {
        this.selectedCollaborators.delete(userId);
        const collabSearchResults = document.getElementById('collabSearchResults');
        let iconElement = collabSearchResults.querySelector(`[data-user-id="${userId}"]`);
        if (iconElement) {
            iconElement.className = 'fas fa-plus-circle';
            iconElement.style.color = '#409EFF'
        } else {
            console.log(`iconElement not found userId=${userId}`);
        }
        this._renderSelectedCollabs();
    }

    setupSearchListener() {
        const searchInput = document.getElementById('collabSearchInput');
        if (searchInput) searchInput.addEventListener('input', (e) => this.searchCollaborators(e.target.value));
    }

    setupHideElementListener(elementId = 'left-btn-about') {
        let attempts = 0;
        const maxAttempts = 50;
        const interval = setInterval(() => {
            const iframe = document.querySelector('iframe[name="frameEditor"]');
            if (iframe && iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                const elem = iframe.contentDocument.getElementById(elementId);
                if (elem) {
                    elem.style.display = 'none';
                    clearInterval(interval);
                }
            }
            if (++attempts >= maxAttempts) clearInterval(interval);
        }, 200);
    }

    async searchCollaborators(keyword) {
        if (!keyword.trim()) {
            document.getElementById('collabSearchResults').innerHTML = '';
            return;
        }
        try {
            const response = await fetch(`/api/auth/search_users/?q=${encodeURIComponent(keyword)}`, {headers: TokenManagerCustom.getHeaders()});
            if (!response.ok) throw new Error('搜索失败');
            const data = await response.json();
            const users = data.results || [];
            const existingIds = new Set([
                ...this.collaborators.map(c => c.id),
                this.currentUser?.id,
                ...Array.from(this.selectedCollaborators.keys()),
            ]);
            const filtered = users.filter(u => !existingIds.has(u.id.toString()));
            this.renderSearchResults(filtered);
        } catch (error) {
            document.getElementById('collabSearchResults').innerHTML = '<div style="padding:10px;color:#f56c6c;text-align:center;">搜索失败</div>';
        }
    }

    renderSearchResults(users) {
        const container = document.getElementById('collabSearchResults');
        if (users.length === 0) {
            container.innerHTML = '<div style="padding:10px;color:#999;text-align:center;">未找到用户</div>';
            return;
        }
        container.innerHTML = users.map(user => {
            const name = this.escapeHtml(user.real_name || user.username);
            const avatar = user.avatar_url || '/static/images/default-avatar.png';
            const realName = user.real_name || user.username;
            const userId = user.id;
            return `
            <div class="user-result-item" style="padding:10px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;cursor:pointer;"
                 onclick="editorApp.selectCollaborator('${userId}', '${name}', '${avatar}', '${this.escapeHtml(realName)}', this)">
                <img src="${avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;">
                    <div style="font-weight:500;">${name}</div>
                    <div style="font-size:12px;color:#999;">${user.department_info?.name || ''} ${user.position || ''}</div>
                </div>
                <i class="fas fa-plus-circle add-icon" data-user-id="${userId}" title="添加协作者"></i>
              
            </div>`;
        }).join('');
    }

    selectCollaborator(userId, userName, avatar, realName, element) {
        this.selectedCollaborators.set(userId, {
            id: userId,
            name: userName,
            real_name: realName || userName,
            avatar: avatar || '/static/images/default-avatar.png',
            permission: 'write', // 默认可编辑
        });
        let iconElement = element.querySelector('i') || element;
        if (iconElement) {
            iconElement.className = 'fas fa-check-circle';
            iconElement.style.color = '#28a745';
        }
        this._renderSelectedCollabs();
        this.showSuccess(`已选择：${userName}`);
    }

    async confirmAddCollaborator() {
        if (this.selectedCollaborators.size === 0) {
            this.showWarning('请选择要添加的协作者');
            return;
        }
        const notify = document.getElementById('collabNotify').checked;
        try {
            let successCount = 0;
            for (const [userId, collab] of this.selectedCollaborators) {
                const response = await fetch(`/api/cloud/documents/${this.fileId}/add_collaborator/`, {
                    method: 'POST', headers: {'Content-Type': 'application/json', ...TokenManagerCustom.getHeaders()},
                    body: JSON.stringify({user_id: userId, permission: collab.permission, notify: notify})
                });
                if (response.ok) successCount++;
                else {
                    const error = await response.json();
                    throw new Error(error.error || '添加失败');
                }
            }
            if (successCount > 0) this.showSuccess(`成功添加 ${successCount} 位协作者`);
            this.selectedCollaborators.clear();
            this.closeAddCollaboratorModal();
            await this.loadCollaborators();
        } catch (error) {
            this.showError('添加协作者失败: ' + error);
        }
    }

    async openEditCollabModal(collabId, currentPermission, isActive) {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/retrieve_collaborators/${collabId}/`, {headers: TokenManagerCustom.getHeaders()});
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '加载失败');
            }
            const collab = await response.json();
            document.getElementById('editCollabAvatar').src = collab.avatar || '/static/images/default-avatar.png';
            document.getElementById('editCollabName').textContent = collab.real_name || collab.username;
            document.getElementById('editCollabEmail').textContent = collab.email || '';
            document.getElementById('editCollabPermission').value = collab.permission || currentPermission;
            document.getElementById('editCollabActive').checked = collab.is_active !== undefined ? collab.is_active : isActive;
            this.editingCollabId = collabId;
            document.getElementById('editCollabModal').classList.add('show');
        } catch (error) {
            this.showError('加载失败: ' + error);
        }
    }

    closeEditCollabModal() {
        document.getElementById('editCollabModal').classList.remove('show');
        this.editingCollabId = null;
    }

    async saveEditCollab() {
        if (!this.editingCollabId || !this.fileId) {
            this.showError('参数错误');
            return;
        }
        const permission = document.getElementById('editCollabPermission').value;
        const isActive = document.getElementById('editCollabActive').checked;
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/update_collaborator/${this.editingCollabId}/`, {
                method: 'PUT', headers: {'Content-Type': 'application/json', ...TokenManagerCustom.getHeaders()},
                body: JSON.stringify({permission: permission, is_active: isActive})
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '更新失败');
            }
            this.showSuccess('更新成功', '协作者权限已更新');
            this.closeEditCollabModal();
            await this.loadCollaborators(); // 🔧 这里保留，主动管理操作后刷新
        } catch (error) {
            this.showError('更新失败: ' + error);
        }
    }

    async removeCollaborator(userId, userName) {
        const confirmed = await this.showConfirmDialog('移除协作者', `确定要移除 ${userName} 吗？`, 'confirm');
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/${userId}/`, {
                method: 'DELETE', headers: TokenManagerCustom.getHeaders()
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '移除失败');
            }
            this.showSuccess(`已移除协作者: ${userName}`);
            await this.loadCollaborators(); // 🔧 这里保留，主动管理操作后刷新
        } catch (error) {
            this.showError('移除失败: ' + error);
        }
    }

    // ==================== 文档链接分享 ====================

    getDocShareLink() {
        if (!this.fileId) return '';
        return `${window.location.origin}/cloud/editor/?id=${this.fileId}`;
    }

    async copyDocLink() {
        const link = this.getDocShareLink();
        const input = document.getElementById('docShareLink');
        if (input) {
            input.value = link;
            input.select();
            try {
                await navigator.clipboard.writeText(link);
                this.showSuccess('链接已复制');
            } catch (err) {
                document.execCommand('copy');
                this.showSuccess('链接已复制');
            }
        }
    }

    // ==================== 保存状态 ====================

    updateSaveStatus(data) {
        const statusEl = document.getElementById('saveStatus');
        if (!statusEl) return;
        const icon = statusEl.querySelector('i');
        const text = statusEl.querySelector('span');
        if (data?.data) {
            statusEl.classList.add('saving');
            if (icon) icon.className = 'fas fa-spinner fa-spin';
            if (text) text.textContent = '保存中...';
        } else {
            statusEl.classList.remove('saving');
            if (icon) icon.className = 'fas fa-check-circle';
            if (text) text.textContent = '已保存';
        }
    }

    // ==================== 工具方法增强 ====================

    getUserColor(userId) {
        if (!this.userColors) this.userColors = new Map();
        if (!this.userColors.has(userId)) {
            let hash = 0;
            for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
            const hue = Math.abs(hash) % 360;
            this.userColors.set(userId, `hsl(${hue}, 75%, 55%)`);
        }
        return this.userColors.get(userId);
    }

    formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            return `周${weekdays[date.getDay()]} ${date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            })}`;
        }
        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    truncateMessage(text, maxLength = 100) {
        if (!text) return '';
        const plainText = text.replace(/<[^>]*>/g, '');
        return plainText.length > maxLength ? plainText.substring(0, maxLength) + '...' : plainText;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // ==================== 提示消息 ====================

    showError(message) {
        this.showToast(`${message}`, 'error');
    }

    showWarning(message) {
        this.showToast(`${message}`, 'warning', 5000);
    }

    showSuccess(message) {
        this.showToast(`${message}`, 'success');
    }

    showToast(message, type = 'info', timeout = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${type === 'error' ? '错误' : type === 'success' ? '成功' : '提示'}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, timeout);
    }

    showAlert(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `<div class="confirm-dialog-content"><div class="confirm-dialog-header"><i class="fas fa-info-circle"></i><h3>${title}</h3><button class="close-btn" style="margin-left: auto;"><i class="fas fa-times"></i></button></div><div class="confirm-dialog-body"><p>${message}</p></div><div class="confirm-dialog-footer"><button class="confirm-dialog-btn confirm">确定</button></div></div>`;
            document.body.appendChild(dialog);
            const closeDialog = () => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 300);
                resolve();
            };
            dialog.querySelector('.confirm').addEventListener('click', closeDialog);
            dialog.querySelector('.close-btn').addEventListener('click', closeDialog);
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) closeDialog();
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    showConfirmDialog(title, message, type = 'confirm') {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `<div class="confirm-dialog-content"><div class="confirm-dialog-header"><i class="fas fa-${type === 'danger' ? 'exclamation-triangle' : 'check-circle'}"></i><h3>${title}</h3><button class="close-btn" style="margin-left: auto;"><i class="fas fa-times"></i></button></div><div class="confirm-dialog-body"><p>${message}</p></div><div class="confirm-dialog-footer"><button class="confirm-dialog-btn cancel">取消</button><button class="confirm-dialog-btn ${type}">确定</button></div></div>`;
            document.body.appendChild(dialog);
            const closeDialog = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 300);
                resolve(result);
            };
            dialog.querySelector('.cancel').addEventListener('click', () => closeDialog(false));
            dialog.querySelector('.close-btn').addEventListener('click', () => closeDialog(false));
            dialog.querySelector(`.${type}`).addEventListener('click', () => closeDialog(true));
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) closeDialog(false);
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    // ==================== 关闭编辑器 ====================

    async closeEditor() {
        const confirmed = await this.showConfirmDialog('关闭编辑器', '确定要关闭编辑器吗？', 'danger');
        if (!confirmed) return;
        try {
            if (this.editor) await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.fileId) {
                try {
                    await this.updateCollaborationStatus('closed');
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.warn('上报离开状态失败:', error);
                }
            }
            if (this.collabSocket?.readyState === WebSocket.OPEN) {
                this.collabSocket.close(1000, 'Page unload');
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            if (this.editor) {
                this.editor.destroyEditor();
                this.editor = null;
            }
            this.config = null;
            window.close();
        } catch (error) {
            console.error('关闭编辑器失败:', error);
        } finally {
            console.log('关闭编辑器!')
            window.close();
        }
    }

    // 🔧 修复：修复了 type 未定义的 Bug
    playCustomSound(type = 'message') {
        const soundMap = {
            'join': '/static/sounds/collab-join.mp3',
            'leave': '/static/sounds/collab-leave.mp3',
            'mention': '/static/sounds/mention.mp3',
            'message': '/static/sounds/chat-message.mp3'
        };
        const audio = new Audio(soundMap[type] || soundMap.message);
        audio.volume = 0.3;
        audio.play().catch(e => console.warn('播放音效失败:', e));
    }

    playSystemNotificationSound(title = '新消息', options = {}) {
        if (Notification.permission !== 'granted') {
            this.playCustomSound();
            return;
        }
        const notification = new Notification('🔔' + title, {
            ...options,
            silent: false,
            requireInteraction: false,
            tag: `notification-${Date.now()}`
        });
        setTimeout(() => notification.close(), 3000);
    }

    playNotificationSound(type = 'message', title = '新消息', options = {}) {
        try {
            const soundEnabled = localStorage.getItem('soundNotifications') !== 'false';
            if (!soundEnabled) return;
            if (Notification.permission === 'granted') {
                this.playSystemNotificationSound(title, options);
            } else {
                this.playCustomSound(type); // 🔧 修复：传递 type 参数
            }
        } catch (e) {
            console.warn('播放音效失败:', e);
        }
    }


    /**
     * 🔧 增强的错误处理 - 自动刷新 Token 并重试
     */
    async fetchWithAuth(url, options = {}) {
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // 获取带自动刷新的 headers
                const headers = await TokenManagerCustom.getHeadersWithRefresh();
                if (!headers) {
                    throw new Error('认证失败');
                }

                const response = await fetch(url, {
                    ...options,
                    headers: {
                        ...headers,
                        ...options.headers
                    }
                });

                // 401 未授权 - 尝试刷新 Token
                if (response.status === 401) {
                    if (attempt < maxRetries) {
                        console.warn(`🔄 尝试刷新 Token (${attempt + 1}/${maxRetries})`);
                        const newToken = await TokenManagerCustom.refreshToken();
                        if (newToken) {
                            continue; // 重试请求
                        }
                    }

                    // 刷新失败，跳转登录
                    this.handleAuthError();
                    throw new Error('认证已过期');
                }

                return response;

            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                await this.delay(1000 * (attempt + 1));
            }
        }
    }

    /**
     * 🔧 延迟函数
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 🔧 增强保存 - 确保文档内容不丢失
     */
    async saveDocumentWithRetry() {
        const maxRetries = 3;
        const saveUrl = `/api/cloud/documents/${this.fileId}/save/`;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // 从 OnlyOffice 获取当前文档内容
                const documentData = this.editor?.getDocumentData?.();

                const response = await this.fetchWithAuth(saveUrl, {
                    method: 'POST',
                    body: JSON.stringify({
                        content: documentData,
                        force_save: attempt > 0, // 重试时强制保存
                        timestamp: new Date().toISOString()
                    })
                });

                if (response.ok) {
                    console.log('✅ 文档保存成功');
                    this.updateSaveStatus({data: false});
                    return true;
                }

            } catch (error) {
                console.warn(`⚠️ 保存失败 (${attempt + 1}/${maxRetries}):`, error);

                // 最后一次尝试失败
                if (attempt === maxRetries - 1) {
                    // 保存到本地缓存
                    this.saveToLocalCache();
                    this.showToast('保存到服务器失败，已保存到本地缓存', 'warning', 5000);
                    return false;
                }

                // 等待后重试
                await this.delay(2000 * (attempt + 1));
            }
        }

        return false;
    }

    /**
     * 🔧 保存到本地缓存（防止内容丢失）
     */
    saveToLocalCache() {
        try {
            const cacheKey = `doc_cache_${this.fileId}`;
            const documentData = this.editor?.getDocumentData?.();

            if (documentData) {
                const cacheData = {
                    content: documentData,
                    fileId: this.fileId,
                    timestamp: Date.now(),
                    savedAt: new Date().toISOString()
                };

                localStorage.setItem(cacheKey, JSON.stringify(cacheData));
                console.log('💾 文档已保存到本地缓存');
            }
        } catch (error) {
            console.warn('保存到本地缓存失败:', error);
        }
    }

    /**
     * 🔧 从本地缓存恢复
     */
    restoreFromLocalCache() {
        try {
            const cacheKey = `doc_cache_${this.fileId}`;
            const cached = localStorage.getItem(cacheKey);

            if (cached) {
                const cacheData = JSON.parse(cached);
                const cacheAge = Date.now() - cacheData.timestamp;

                // 只恢复 1 小时内的缓存
                if (cacheAge < 60 * 60 * 1000) {
                    console.log('💾 发现本地缓存，尝试恢复...');
                    return cacheData.content;
                } else {
                    // 清除过期缓存
                    localStorage.removeItem(cacheKey);
                }
            }
        } catch (error) {
            console.warn('恢复本地缓存失败:', error);
        }

        return null;
    }

    /**
     * 🔧 定期自动保存（每 30 秒）
     */
    startAutoSave() {
        // 清除旧的定时器
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }

        // 每 30 秒自动保存
        this.autoSaveTimer = setInterval(() => {
            // 只在文档有修改时保存
            if (this.editor?.isDocumentModified?.()) {
                console.log('⏰ 自动保存触发');
                this.saveDocumentWithRetry();
            }
        }, 30000); // 30 秒

        console.log('⏰ 自动保存已启用（每30秒）');
    }

    /**
     * 🔧 停止自动保存
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }


    /**
     * 🔧 Token 心跳检查
     */
    startTokenHeartbeat() {
        // 清除旧的定时器
        if (this.tokenHeartbeatTimer) {
            clearInterval(this.tokenHeartbeatTimer);
        }

        // 每 5 分钟检查 Token 状态
        this.tokenHeartbeatTimer = setInterval(async () => {
            console.log('🔍 检查 Token 有效性...');

            const token = TokenManagerCustom.getToken();
            if (!token) {
                return;
            }

            const tokenData = TokenManagerCustom.parseToken(token);
            if (!tokenData || !tokenData.exp) {
                return;
            }

            const expiryTime = tokenData.exp * 1000;
            const timeUntilExpiry = expiryTime - Date.now();

            // 如果 10 分钟内过期，提前刷新
            if (timeUntilExpiry < 10 * 60 * 1000) {
                console.log('⏰ Token 即将过期，提前刷新...');

                // 先保存文档（确保刷新 token 过程中的修改不丢失）
                if (this.editor?.isDocumentModified?.()) {
                    await this.saveDocumentWithRetry();
                }

                // 再刷新 Token
                const newToken = await TokenManagerCustom.refreshToken();
                if (newToken) {
                    console.log('✅ Token 已刷新');
                    // 保存到本地缓存作为保险
                    this.saveToLocalCache();
                    // 重新初始化 WebSocket（传入新 token）
                    this.initCollabWebSocket();
                } else {
                    console.warn('⚠️ Token 刷新失败');
                    this.showToast('认证即将过期，请保存工作', 'warning');
                }
            }
        }, 300000); // 5 分钟
    }


    // 🔧 新增：跟踪文档是否有未保存的修改
    _hasUnsavedChanges = false;

    // ==================== Token 刷新方法 ====================

    // token 刷新方法
    async refreshToken() {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
            // 先尝试保存，再跳转
            await this._emergencySaveBeforeExit();
            this.handleAuthError();
            return null;
        }

        try {
            const response = await fetch('/api/auth/token/refresh/', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({refresh: refreshToken})
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('access_token', data.access);
                if (data.refresh) {
                    localStorage.setItem('refresh_token', data.refresh);
                }
                console.log('✅ Token 刷新成功');
                return data.access;
            } else {
                console.error('刷新 token 失败:', response.status);
                await this._emergencySaveBeforeExit();
                this.handleAuthError();
                return null;
            }
        } catch (error) {
            console.error('刷新 token 请求失败:', error);
            await this._emergencySaveBeforeExit();
            this.handleAuthError();
            return null;
        }
    }

    // 辅助方法：解析 token 过期时间
    getTokenExpiry(token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.exp * 1000; // 转换为毫秒
        } catch (e) {
            return null;
        }
    }

    handleAuthError() {
        // 先尝试保存文档（同步保存到本地缓存）
        this._emergencySaveBeforeExit();

        // 清除所有本地存储的认证信息
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');

        // 关闭 WebSocket 连接
        if (this.collabSocket) {
            try {
                this.collabSocket.close(1000, 'Auth error');
            } catch (e) {
                // ignore
            }
            this.collabSocket = null;
        }

        // 保存重定向地址
        localStorage.setItem('redirect_url', window.location.href);

        // 跳转到登录页
        window.location.href = '/cloud/login/';
    }

    // 🔧 强制保存到本地缓存（跳转前保护文档内容）
    async _emergencySaveBeforeExit() {
        try {
            // 先尝试同步到服务器
            if (this.editor?.isDocumentModified?.()) {
                await this.saveDocumentWithRetry();
            }
        } catch (e) {
            // 服务器保存失败不阻塞
        }
        // 无论如何都保存到本地缓存
        this.saveToLocalCache();
    }
}

// ==================== 全局初始化 ====================

let editorApp = null;
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('id');
    if (fileId) {
        editorApp = new DocumentEditorApp(fileId);
        window.editorApp = editorApp;
    } else {
        const loadingEl = document.getElementById('loadingState');
        if (loadingEl) loadingEl.innerHTML = '<p>❌ 缺少文件参数</p><button onclick="history.back()">返回</button>';
    }
});

// 🔧 移动端锁屏优化
// 替换原有的 visibilitychange 监听器
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // 页面重新可见时检查 token 是否有效
        if (window.editorApp) {
            const token = localStorage.getItem('access_token');
            if (!token) {
                console.warn('页面恢复时发现 token 已丢失');
                window.editorApp.handleAuthError();
                return;
            }

            // 检查 token 是否过期
            const editorApp = window.editorApp;
            const tokenExpiry = editorApp.getTokenExpiry?.(token);
            if (tokenExpiry && tokenExpiry < Date.now()) {
                console.warn('页面恢复时发现 token 已过期');
                // 先保存文档
                if (editorApp.editor?.isDocumentModified?.()) {
                    editorApp.saveDocumentWithRetry().finally(() => {
                        editorApp.saveToLocalCache();
                    });
                }
                // 尝试静默刷新
                editorApp.refreshToken().then(newToken => {
                    if (newToken) {
                        console.log('Token 刷新成功，重新连接 WebSocket');
                        editorApp.initCollabWebSocket();
                    }
                });
            } else {
                // token 有效，但可能需要同步最新状态
                try {
                    editorApp.loadCollaborators();
                } catch (error) {
                    console.warn('页面恢复时同步失败:', error);
                }
            }
        }
    }
});

// 🔧 页面卸载时的清理 (移除 async/await，防止阻塞浏览器卸载流程)
window.addEventListener('beforeunload', (event) => {
    if (window.editorApp) {
        const app = window.editorApp;

        // 如果文档有未保存的修改，弹出浏览器原生确认对话框
        if (app._hasUnsavedChanges || app.editor?.isDocumentModified?.()) {
            // 保存到本地缓存
            app.saveToLocalCache();
            // 弹出浏览器原生确认对话框
            event.preventDefault();
            event.returnValue = '文档尚未保存，确定离开吗？';
        }

        // 尝试同步到服务器
        app.updateCollaborationStatus('closed').catch(err => {
            console.warn('页面卸载时上报失败:', err);
        });

        // 关闭 WebSocket
        if (app.collabSocket?.readyState === WebSocket.OPEN) {
            app.collabSocket.close(1000, 'Page unload');
        }
    }
});