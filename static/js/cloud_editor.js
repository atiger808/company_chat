/**
 * @File   : cloud_editor.js
 * @Time   : 2026/4/2
 * @Author : dayue
 * @Desc   : 文档协同编辑器前端逻辑（ 协同编辑专用 JS）
 */


// 从 URL 获取文件 ID
const fileId = new URLSearchParams(window.location.search).get('id');

// Token 管理器
const TokenManagerCustom = {
    getToken: () => localStorage.getItem('access_token'),
    getHeaders: () => {
        const token = localStorage.getItem('access_token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
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
        this.collabHeartbeatTimer = null;
        this.isCollabSidebarOpen = true;
        this.selectedCollaborators = new Set();
        this.editingCollabId = null;
        this.hasError = false;

        // 协同编辑 WebSocket 相关
        this.collabSocket = null;          // 协同编辑 WebSocket
        this.cursorPositions = new Map();     // 协作者光标位置 {userId: {line, column}}
        this.remoteSelections = new Map();
        this.userColors = new Map();         // 用户颜色映射
        this.typingTimeout = null;
        this.isMuted = false;


        this.init();
    }

    // 初始化
    async init() {
        try {

            // 🔧 1. 获取当前用户信息（优先从缓存，失败则请求后端）
            await this.loadCurrentUser();


            if (!this.fileId) throw new Error('文件 ID 缺失');

            // 2. 检查 OnlyOffice API 是否加载
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

            // 7. 启动协同心跳（降级方案）
            this.startCollabHeartbeat();

            // 8. 加载初始协作者列表
            await this.loadCollaborators();

            // 9. 恢复编辑动态显示状态
            this.restoreEditActivityVisibility();

            // 10. 设置搜索事件监听
            this.setupSearchListener();


        } catch (error) {
            console.error('初始化失败:', error);
            this.showError(error.error || error.message || error.detail || `加载失败!`);
            this.handleAuthError();
        }
    }


    // 加载当前用户信息
    async loadCurrentUser() {
        try {
            // 优先从缓存读取
            const cachedUser = localStorage.getItem('current_user');
            if (cachedUser) {
                this.currentUser = JSON.parse(cachedUser);
                return;
            }

            // 请求后端获取
            const response = await fetch('/api/auth/me/', {
                headers: TokenManagerCustom.getHeaders()
            });

            if (response.ok) {
                this.currentUser = await response.json();
                localStorage.setItem('current_user', JSON.stringify(this.currentUser));
            } else {
                throw new Error('获取用户信息失败');
            }
        } catch (error) {
            console.warn('加载用户信息失败，使用降级方案:', error);
            // 降级方案
            this.currentUser = {
                id: `anon_${Date.now()}`,
                username: '匿名用户',
                real_name: '匿名用户',
                email: '',
                avatar: '/static/images/default-avatar.png'
            };
        }
    }


    // 获取编辑配置
    async fetchEditConfig() {
        console.log('🔧 获取编辑配置...');
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/edit/`, {
                headers: TokenManagerCustom.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                console.error('获取编辑配置失败 error:', error);
                throw new Error(error.error || error.message || error.detail || '获取编辑配置失败');
            }

            this.config = await response.json();

            // 验证配置
            if (!this.config.document?.fileType || !this.config.documentType) {
                throw new Error('文档配置不完整');
            }
            if (!this.config.document?.url) {
                throw new Error('文档访问链接缺失');
            }

            // 🔧 验证 document key 是否稳定
            console.log('🔑 Document Key:', this.config.document.key);
        } catch (error) {
            this.hasError = true;
            console.error('获取编辑配置失败:', error);
            this.showLoadingError(error || `加载失败, 您没有访问该文件的权限！`);
            this.showError(error || `加载失败, 您没有访问该文件的权限！`);
        }

    }


    // 🔧 初始化时设置文档链接
    updatePageInfo() {
        if (!this.config?.document) return;
        let version_number = this.config.document?.version_number
        document.title = version_number ? `${this.config.document.title} - v${version_number} - 在线编辑` : `${this.config.document.title} - 在线编辑`;
        document.getElementById('docTitle').textContent = version_number ? `${this.config.document.title} - v${version_number}` : `${this.config.document.title}`;

        // 🔧 设置协作文档链接
        const docLinkInput = document.getElementById('docShareLink');
        if (docLinkInput) {
            docLinkInput.value = this.getDocShareLink();
            // 点击输入框自动全选并复制
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
        console.log('🔧 初始化编辑器', this.config);
        if (!this.config) return;

        if (typeof DocsAPI === 'undefined' || typeof DocsAPI.DocEditor !== 'function') {
            console.error('❌ OnlyOffice API 未加载成功');
            return;
        }

        const loadingEl = document.getElementById('loadingState');
        if (loadingEl) loadingEl.style.display = 'none';

        try {
            // 构建完整的编辑器配置
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
                        this.setupHideElementListener()
                        this.loadCollaborators();
                        this.startCollabHeartbeat();
                    },
                    onDocumentStateChange: (event) => {
                        this.updateSaveStatus({data: event.data});
                    },
                    // 🔧 关键修复：优化关闭事件处理
                    onRequestClose: async () => {
                        console.log('📝 用户请求关闭文档');
                        // 不立即关闭，先保存状态
                        await this.updateCollaborationStatus('closed');
                        // 然后调用自定义关闭逻辑
                        await this.closeEditor();
                    },
                    onError: (event) => {
                        console.error('❌ OnlyOffice 错误:', event.data);
                        this.showError('编辑器发生错误：' + JSON.stringify(event.data));
                    },
                    onRequestEditRights: () => {
                        console.log('🔑 请求编辑权限');
                        // 重新获取编辑配置
                        this.fetchEditConfig().then(() => {
                            // 重新初始化编辑器
                            this.initEditor();
                        });
                    },
                    onInfo: (event) => {
                        console.log('信息:', event.data);
                    },
                    onLifeCycle: (event) => {
                        console.log('生命周期:', event.data);
                    },
                    // 监听光标位置变化并广播
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
                    // 监听选区变化并广播
                    onSelectionChange: (event) => {
                        if (this.collabSocket?.readyState === WebSocket.OPEN) {
                            this.sendCollabMessage('selection_update', {
                                userId: this.config.editorConfig?.user?.id,
                                selection: event.data
                            });
                        }
                    },
                    // 监听输入状态
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

            console.log('editorConfig:', editorConfig);
            // 创建编辑器实例
            this.editor = new DocsAPI.DocEditor('editor-placeholder', editorConfig);

            if (!this.editor) {
                throw new Error('编辑器实例创建失败');
            }

            console.log('✅ OnlyOffice 编辑器初始化成功');

        } catch (error) {
            console.error('initEditor failed:', error);
            this.showLoadingError('编辑器启动失败: ' + error.message || error.detail || error.error || '未知错误');
        }
    }

    // 显示加载错误
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
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('access_token');
        const wsUrl = `${protocol}//${window.location.host}/ws/cloud/collab/${this.fileId}/?token=${encodeURIComponent(token)}`;

        try {
            this.collabSocket = new WebSocket(wsUrl);

            this.collabSocket.onopen = () => {
                console.log('✅ 协同编辑 WebSocket 已连接');
                // 发送加入消息
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
                console.log(`🔌 协同编辑 WebSocket 已断开 (code: ${event.code})，3 秒后重连...`);
                // 非正常关闭时重连
                if (!this.hasError) {
                    if (event.code !== 1000) {
                        setTimeout(() => this.initCollabWebSocket(), 3000);
                    }
                } else {
                    console.log('❌ 协同编辑 WebSocket 连接已断开');
                }

            };

            this.collabSocket.onerror = (error) => {
                console.error('协同编辑 WebSocket 错误:', error);
            };
        } catch (error) {
            console.error('创建协同编辑 WebSocket 失败:', error);
        }
    }

    // 发送协同消息
    sendCollabMessage(type, payload) {
        if (this.collabSocket?.readyState === WebSocket.OPEN) {
            this.collabSocket.send(JSON.stringify({
                type,
                data: {
                    ...payload,
                    file_id: this.fileId,  // 🔧 添加文件ID便于后端路由
                    sender_id: this.config?.editorConfig?.user?.id
                },
                timestamp: new Date().toISOString()
            }));
        }
    }

    // 🔧 核心修复：处理协同消息（与后端消息类型对齐）
    handleCollabMessage(data) {

        const type = data.type;
        const payload = data.data;

        switch (type) {
            // ==================== 用户状态消息 ====================

            case 'user_joined':
                this.handleUserJoined(payload);
                break;

            case 'user_left':
                this.handleUserLeft(payload);
                break;

            case 'collab_status_update':
                // 🔧 实时更新协作者状态（editing/viewing/closed）
                this.updateCollaboratorStatus(payload);
                break;

            // ==================== 光标与选区消息 ====================

            case 'cursor_update':
                this.updateRemoteCursor(payload);
                break;

            case 'selection_update':
                this.updateRemoteSelection(payload);
                break;

            // ==================== 输入状态消息 ====================

            case 'user_typing':
                this.handleTypingIndicator(payload);
                break;

            // ==================== 聊天消息 ====================

            case 'chat_message':
                this.handleChatMessage(payload);
                break;

            // ==================== 文档操作消息 ====================

            case 'document_saved':
                // 🔧 后端保存成功后通知所有协作者
                this.handleDocumentSaved(payload);
                break;

            case 'version_created':
                // 🔧 新版本创建通知
                this.handleVersionCreated(payload);
                break;

            // ==================== 错误与系统消息 ====================

            case 'error':
                this.handleCollabError(payload);
                break;

            case 'heartbeat':
                // 🔧 心跳保活消息，无需处理
                break;

            default:
                console.warn('⚠️ 未知协同消息类型:', type);
        }
    }


    // ==================== 用户状态处理 ====================

    /**
     * 处理用户加入协同编辑
     */
    handleUserJoined(payload) {
        const {user, timestamp} = payload;
        if (!user?.id) return;

        console.log(`👋 用户加入: ${user.real_name || user.username}`);
        console.log('user:', user);
        console.log('payload:', payload);

        // 更新本地协作者列表
        const existingIndex = this.collaborators.findIndex(c => c.id === user.id);
        if (existingIndex >= 0) {
            // 更新已存在的协作者
            this.collaborators[existingIndex] = {
                ...this.collaborators[existingIndex],
                ...user,
                status: 'editing',
                last_activity: timestamp,
                is_online: true
            };
        } else {
            // 添加新协作者
            this.collaborators.push({
                ...user,
                status: 'editing',
                last_activity: timestamp,
                is_online: true,
                color: this.getUserColor(user.id)
            });
        }

        // 重新渲染列表
        this.renderCollabList();
        this.updateCollabCount();

        // 显示编辑动态
        this.showEditActivity(user.real_name || user.username, '加入了协同编辑', new Date(timestamp));

        // 播放加入提示音（非自己）
        if (user.id !== this.config?.editorConfig?.user?.id && this.shouldPlayJoinSound()) {
            this.playNotificationSound('join',
                user.name || user.real_name || user.username,
                {
                    body: '加入了协同编辑',
                    icon: user?.avatar || user?.avatar_url || '/static/images/default-avatar.png',
                    data: payload,
                    // 🔧 关键修复4: 移动端锁屏通知必需参数
                    requireInteraction: Utils.isMobile() ? false : true,
                    silent: false,  // 强制播放系统通知声音
                    tag: `collab-${user.id}-${Date.now()}`  // 防止重复通知
                }
            );
        }

        // 渲染远程光标
        this.renderRemoteCursors();
    }

    /**
     * 处理用户离开协同编辑
     */
    handleUserLeft(payload) {
        console.log('user_left payload: ', payload)
        const {userId, userName, timestamp, reason} = payload;
        if (!userId) return;

        console.log(`👋 用户离开: ${userName}, 原因: ${reason || '正常离开'}`);

        // 更新协作者状态
        const collabIndex = this.collaborators.findIndex(c => c.id === userId);
        if (collabIndex >= 0) {
            this.collaborators[collabIndex] = {
                ...this.collaborators[collabIndex],
                status: 'closed',
                last_activity: timestamp,
                is_online: false,
                left_at: timestamp
            };
        }

        // 清理远程光标和选区
        this.cursorPositions.delete(userId);
        if (this.remoteSelections) this.remoteSelections.delete(userId);

        if (this.editor?.coAuthoringApi) {
            this.editor.coAuthoringApi.removeCursor?.(userId);
            this.editor.coAuthoringApi.removeSelection?.(userId);
        }

        // 重新渲染
        this.renderCollabList();
        this.updateCollabCount();

        // 显示编辑动态
        const reasonText = reason === 'timeout' ? '（连接超时）' :
            reason === 'conflict' ? '（编辑冲突）' : '';
        this.showEditActivity(userName, `离开了协同编辑${reasonText}`, new Date(timestamp));
    }


    /**
     * 🔧 更新协作者状态（editing/viewing/closed）
     */
    updateCollaboratorStatus(payload) {
        const {userId, status, last_activity} = payload;
        if (!userId) return;

        const collab = this.collaborators.find(c => parseInt(c.id) === parseInt(userId));
        if (collab) {
            collab.status = status;
            collab.last_activity = last_activity;
            collab.is_online = status !== 'closed';

            // 更新 UI
            this.renderCollabList();
            this.updateCollabCount();

            // 显示状态变化动态
            const statusText = status === 'editing' ? '正在编辑' :
                status === 'viewing' ? '正在查看' : '已离开';
            this.showEditActivity(collab.real_name || collab.username, statusText, new Date(last_activity), collab);
        }
    }


    // ==================== 光标与选区处理 ====================

    /**
     * 更新远程用户光标
     */
    updateRemoteCursor(payload) {
        const {userId, userName, position, color} = payload;

        // 不更新自己的光标
        if (userId === this.config?.editorConfig?.user?.id) return;

        // 存储光标位置
        this.cursorPositions.set(userId, {position, color, userName, timestamp: Date.now()});

        // 渲染到 OnlyOffice
        this.renderRemoteCursors();
    }

    /**
     * 渲染远程光标到 OnlyOffice
     */
    renderRemoteCursors() {
        if (!this.editor?.coAuthoringApi) return;

        // 清理过期光标（30 秒无活动）
        const now = Date.now();
        const EXPIRE_TIME = 30000;

        for (const [userId, data] of this.cursorPositions.entries()) {
            if (now - data.timestamp > EXPIRE_TIME) {
                this.cursorPositions.delete(userId);
                this.editor.coAuthoringApi.removeCursor?.(userId);
                continue;
            }

            if (userId !== this.config.editorConfig?.user?.id) {
                try {
                    this.editor.coAuthoringApi.addCursor?.({
                        userId,
                        userName: data.userName,
                        color: data.color || this.getUserColor(userId),
                        position: data.position
                    });
                } catch (e) {
                    console.warn('渲染远程光标失败:', e);
                }
            }
        }
    }

    /**
     * 更新远程用户选区
     */
    updateRemoteSelection(payload) {
        const {userId, userName, selection, color} = payload;

        // 不更新自己的选区
        if (userId === this.config?.editorConfig?.user?.id) return;

        if (!this.remoteSelections) this.remoteSelections = new Map();

        this.remoteSelections.set(userId, {
            selection,
            color: color || this.getUserColor(userId),
            userName,
            timestamp: Date.now()
        });

        this.renderRemoteSelections();
    }

    /**
     * 渲染远程选区到 OnlyOffice
     */
    renderRemoteSelections() {
        if (!this.editor?.coAuthoringApi) return;

        const now = Date.now();
        const EXPIRE_TIME = 30000;

        for (const [userId, data] of this.remoteSelections.entries()) {
            // 清理过期选区
            if (now - data.timestamp > EXPIRE_TIME) {
                this.remoteSelections.delete(userId);
                this.editor.coAuthoringApi.removeSelection?.(userId);
                continue;
            }

            try {
                // 先移除旧选区
                this.editor.coAuthoringApi.removeSelection?.(userId);

                // 添加新选区
                if (data.selection?.ranges?.length > 0) {
                    this.editor.coAuthoringApi.addSelection?.({
                        userId,
                        userName: data.userName,
                        color: data.color,
                        ranges: data.selection.ranges,
                        style: {
                            backgroundColor: `${data.color}20`,  // 20% 透明度
                            borderColor: data.color,
                            borderWidth: 2
                        }
                    });
                }
            } catch (e) {
                console.warn('渲染远程选区失败:', e);
            }
        }
    }


    // ==================== 输入状态处理 ====================

    /**
     * 处理用户输入指示器
     */
    handleTypingIndicator(payload) {
        const {userId, userName, isTyping} = payload;

        // 不显示自己的输入状态
        if (userId === this.config?.editorConfig?.user?.id) return;

        const collab = this.collaborators.find(c => c.id === userId);
        if (!collab) return;

        if (isTyping) {
            // 显示"正在输入"状态
            this.showTypingStatus(userName, true);

            // 5 秒后自动清除（防止卡住）
            setTimeout(() => {
                const currentCollab = this.collaborators.find(c => c.id === userId);
                if (currentCollab?.isTyping) {
                    this.showTypingStatus(userName, false);
                }
            }, 5000);
        } else {
            this.showTypingStatus(userName, false);
        }
    }

    /**
     * 显示/隐藏输入状态
     */
    showTypingStatus(userName, isTyping) {
        const indicator = document.getElementById('typingIndicator');
        if (!indicator) return;

        if (isTyping) {
            indicator.textContent = `${userName} 正在输入...`;
            indicator.style.display = 'flex';
        } else {
            // 检查是否还有其他人在输入
            const typingUsers = this.collaborators.filter(c => c.isTyping && c.id !== this.currentUser?.id);
            if (typingUsers.length === 0) {
                indicator.style.display = 'none';
            }
        }
    }

// ==================== 聊天消息处理 ====================

    /**
     * 处理协同聊天消息
     */
    handleChatMessage(payload) {
        const {
            messageId,
            userId,
            userName,
            avatar,
            content,
            timestamp,
            mentionUsers,
            isSystem
        } = payload;

        // 不处理自己的消息（已在本地显示）
        if (userId === this.config?.editorConfig?.user?.id) return;

        console.log(`💬 收到聊天消息: ${userName}: ${content}`);

        // 追加到聊天区域
        this.appendChatMessage(payload);

        // 处理@提及
        if (mentionUsers?.includes(this.config?.editorConfig?.user?.id)) {
            this.highlightMentionMessage(messageId);
            this.playNotificationSound('mention',
                userName,
                {
                    body: content,
                    icon: avatar || '/static/images/default-avatar.png',
                    data: payload,
                    // 🔧 关键修复4: 移动端锁屏通知必需参数
                    requireInteraction: Utils.isMobile() ? false : true,
                    silent: false,  // 强制播放系统通知声音
                    tag: `collab-${userId}-${Date.now()}`  // 防止重复通知
                }
            );
        }

        // 桌面通知（页面不可见时）
        if (!document.hasFocus() && !this.isMuted && Notification.permission === 'granted') {
            const mentionText = mentionUsers?.includes(this.config?.editorConfig?.user?.id) ? '🔔 提到你: ' : '';
            new Notification(`${mentionText}${userName} 发送消息`, {
                body: this.truncateMessage(content, 50),
                icon: avatar || '/static/images/default-avatar.png',
                tag: `chat-${messageId}`,
                requireInteraction: mentionUsers?.includes(this.config?.editorConfig?.user?.id),
                silent: false  // 🔧 允许系统播放提示音
            });
        }

        // 更新未读计数
        this.incrementUnreadChatCount();
    }

    /**
     * 在侧边栏追加聊天消息
     */
    appendChatMessage(payload) {
        const {userId, userName, avatar, content, timestamp, isSystem, mentionUsers} = payload;
        const chatContainer = document.getElementById('collabChatMessages');
        if (!chatContainer) return;

        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isSystem ? 'system' : ''} ${mentionUsers?.includes(this.config?.editorConfig?.user?.id) ? 'mention' : ''}`;
        messageEl.dataset.messageId = payload.messageId;

        // 安全转义并格式化内容
        const safeContent = this.escapeHtml(content)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // **粗体**
            .replace(/\*(.*?)\*/g, '<em>$1</em>')              // *斜体*
            .replace(/`([^`]+)`/g, '<code>$1</code>')          // `代码`
            .replace(/@(\w+)/g, '<span class="mention">@<strong>$1</strong></span>');  // @提及

        messageEl.innerHTML = `
        <div class="chat-message-header">
            <img src="${avatar || '/static/images/default-avatar.png'}" 
                 class="chat-avatar" 
                 alt="${userName}" 
                 title="${userName}">
            <div class="chat-meta">
                <span class="chat-username">${this.escapeHtml(userName)}</span>
                <span class="chat-time">${this.formatTime(timestamp)}</span>
                ${mentionUsers?.includes(this.config?.editorConfig?.user?.id) ?
            '<span class="mention-badge">🔔</span>' : ''}
            </div>
        </div>
        <div class="chat-message-body">${safeContent}</div>
    `;

        chatContainer.appendChild(messageEl);

        // 自动滚动到底部
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // 限制消息数量（保留最近 100 条）
        while (chatContainer.children.length > 100) {
            chatContainer.removeChild(chatContainer.firstChild);
        }
    }

    /**
     * 高亮@提及的消息
     */
    highlightMentionMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.classList.add('mention-highlight');
            // 3 秒后移除高亮
            setTimeout(() => messageEl.classList.remove('mention-highlight'), 3000);

            // 如果聊天区域被折叠，展开它
            const chatSection = document.getElementById('collabChatSection');
            if (chatSection?.classList.contains('collapsed')) {
                chatSection.classList.remove('collapsed');
            }
        }
    }


    /**
     * 增加未读聊天消息计数
     */
    incrementUnreadChatCount() {
        const badge = document.getElementById('chatUnreadBadge');
        if (badge) {
            const count = parseInt(badge.textContent) || 0;
            badge.textContent = count + 1;
            badge.style.display = count + 1 > 0 ? 'inline-block' : 'none';
        }
    }

    /**
     * 重置未读聊天消息计数
     */
    resetChatUnreadCount() {
        const badge = document.getElementById('chatUnreadBadge');
        if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
    }


// ==================== 文档操作处理 ====================

    /**
     * 处理文档保存成功通知
     */
    handleDocumentSaved(payload) {
        const {versionNumber, savedBy, timestamp} = payload;

        console.log(`💾 文档已保存: v${versionNumber} by ${savedBy}`);

        // 更新保存状态显示
        this.updateSaveStatus({data: false});  // 保存完成

        // 显示保存提示
        this.showToast(`文档已自动保存 (v${versionNumber})`, 'success', 2000);

        // 如果是当前用户保存的，不显示动态
        if (savedBy !== this.currentUser?.username) {
            this.showEditActivity(savedBy, `保存了文档 (v${versionNumber})`, new Date(timestamp));
        }
    }

    /**
     * 处理新版本创建通知
     */
    handleVersionCreated(payload) {
        const {versionNumber, createdBy, timestamp, comment} = payload;

        console.log(`📝 新版本创建: v${versionNumber}`);

        // 显示版本提示
        this.showToast(`新版本已创建: v${versionNumber}`, 'info', 3000);

        // 添加到编辑动态
        this.showEditActivity(createdBy, `创建了版本 v${versionNumber}${comment ? `: ${comment}` : ''}`, new Date(timestamp));

        // 刷新版本列表（如果需要）
        if (document.getElementById('versionModal')?.classList.contains('show')) {
            this.showVersions();
        }
    }

    /**
     * 处理协同编辑错误
     */
    handleCollabError(payload) {
        const {code, message, detail} = payload;

        console.error('❌ 协同编辑错误:', code, message);

        // 显示用户友好的错误提示
        const errorMap = {
            'permission_denied': '您没有权限执行此操作',
            'document_locked': '文档已被其他用户锁定，请稍后重试',
            'version_conflict': '版本冲突，请刷新页面后重试',
            'connection_lost': '连接断开，正在重连...'
        };

        const userMessage = errorMap[code] || message || '协同编辑发生错误';
        this.showError(userMessage);

        // 特定错误处理
        if (code === 'connection_lost') {
            // 尝试重连
            setTimeout(() => this.initCollabWebSocket(), 2000);
        }
    }


    // ==================== 协同聊天消息同步 ====================

    /**
     * 🔧 同步聊天消息到后端（OnlyOffice 内置聊天）
     */
    async syncChatMessage(message) {
        try {
            await fetch(`/api/cloud/documents/${this.fileId}/chat_message/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManagerCustom.getHeaders()
                },
                body: JSON.stringify({
                    content: message.text,
                    timestamp: message.time,
                    user_id: message.user?.id,
                    user_name: message.user?.name,
                    avatar: message.user?.avatar
                })
            });
        } catch (error) {
            console.warn('聊天消息同步失败:', error);
        }
    }


    /**
     * 清理过期选区
     */
    cleanupExpiredSelections() {
        if (!this.remoteSelections) return;
        const now = Date.now();
        const EXPIRE_TIME = 30000;

        for (const [userId, data] of this.remoteSelections.entries()) {
            if (now - data.timestamp > EXPIRE_TIME) {
                this.remoteSelections.delete(userId);
                this.editor?.coAuthoringApi?.removeSelection?.(userId);
            }
        }
    }


    // 更新协作者状态显示
    updateCollaboratorStatusUI(data) {
        const collaboratorEl = document.querySelector(`.collaborator[data-user-id="${data.user_id}"]`);
        if (collaboratorEl) {
            collaboratorEl.classList.toggle('editing', data.status === 'editing');
            const statusDot = collaboratorEl.querySelector('.status-dot');
            if (statusDot) {
                statusDot.className = `status-dot ${data.status === 'editing' ? 'active' : ''}`;
            }
        }
        this.updateCollabCount();
    }


    // ==================== 协同编辑功能 ====================

    // 加载协作者列表
    async loadCollaborators() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/`, {
                headers: TokenManagerCustom.getHeaders()
            });

            if (!response.ok) {
                if (response.status === 401) {
                    if (this.collabHeartbeatTimer) {
                        clearTimeout(this.collabHeartbeatTimer);
                        this.collabHeartbeatTimer = null;
                    }
                    ;
                    this.handleAuthError()
                    return null;
                }
                throw new Error('加载协作者失败');
            }

            const data = await response.json();
            this.collaborators = data.collaborators || [];

            // 渲染协作者列表
            this.renderCollabList();
            this.updateCollabCount();

            // 检查是否是所有者
            const isOwner = this.collaborators.some(c => c.is_owner);
            if (isOwner) {
                document.getElementById('manageCollabSection').style.display = 'block';
                this.renderManageCollabList();
            }

        } catch (error) {
            console.error('加载协作者失败:', error);
        }
    }

    // 渲染在线协作者列表
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
                        <div class="collab-name">${this.escapeHtml(collab.real_name || collab.username)}</div>
                        <div class="collab-meta">${collab.status === 'editing' ? '✏️ 编辑中' : '👁️ 查看中'}</div>
                    </div>
                </div>
            `).join('');


    }

    // 渲染管理协作者列表
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
                    <div class="collab-name">${this.escapeHtml(collab.real_name || collab.username)}</div>
                    <div class="collab-meta">
                        <span class="collab-permission ${collab.permission}">
                            ${this.getPermissionText(collab.permission)}
                        </span>
                        ${collab.is_active ? '' : '<span class="badge badge-warning" style="margin-left:5px;">已禁用</span>'}
                    </div>
                </div>
                ${!collab.is_owner ? `
                <div class="collab-actions">
                    <button class="collab-action-btn"
                            onclick="editorApp.openEditCollabModal('${collab.id}', '${collab.permission}', ${collab.is_active})"
                            title="修改权限">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="collab-action-btn danger"
                            onclick="editorApp.removeCollaborator('${collab.id}', '${this.escapeHtml(collab.real_name || collab.username)}')"
                            title="移除协作者">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                ` : ''}
            </div>
        `).join('');
    }

    // 更新协作者数量
    updateCollabCount() {
        const countEl = document.getElementById('onlineCollabCount');
        if (countEl) {
            const onlineCount = this.collaborators.filter(c => c.status === 'editing' || c.status === 'viewing').length;
            countEl.textContent = onlineCount;
        }
    }

    // 获取权限文本
    getPermissionText(permission) {
        const map = {
            'read': '只读',
            'write': '可编辑',
            'admin': '管理员'
        };
        return map[permission] || permission;
    }

    // 启动协同心跳
    // 替换原有的 startCollabHeartbeat 方法
    startCollabHeartbeat() {
        let retryCount = 0;
        const maxRetries = 5;

        const heartbeat = async () => {
            try {
                await this.updateCollaborationStatus('editing');
                await this.loadCollaborators();
                if (this.hasError) {
                    console.log('清除定时器 hasError', this.hasError);
                    if (this.collabHeartbeatTimer) {
                        clearTimeout(this.collabHeartbeatTimer);
                        this.collabHeartbeatTimer = null;
                    }
                    if (this.collabSocket?.readyState === WebSocket.OPEN) {
                        this.collabSocket.close(1000, 'Page unload');
                    }
                    return;
                }
                retryCount = 0;
            } catch (error) {
                console.warn('心跳失败，重试中...', retryCount);
                retryCount++;
                if (retryCount <= maxRetries) {
                    setTimeout(heartbeat, Math.min(1000 * Math.pow(2, retryCount - 1), 16000));
                    return;
                }
            }
            this.collabHeartbeatTimer = setTimeout(heartbeat, 10000);
        };

        heartbeat();

        window.addEventListener('beforeunload', () => {
            console.log('loadCollaborators 401 or hasError 清除定时器 hasError', this.hasError);
            if (this.collabHeartbeatTimer) clearTimeout(this.collabHeartbeatTimer);
            this.updateCollaborationStatus('closed');
            if (this.collabSocket?.readyState === WebSocket.OPEN) {
                this.collabSocket.close(1000, 'Page unload');
            }
        });
    }


    // 更新协同状态
    async updateCollaborationStatus(status) {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaboration/status/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManagerCustom.getHeaders()
                },
                body: JSON.stringify({
                    status: status
                })
            });

        } catch (error) {
            console.error('更新协同状态失败:', error);
        }
    }

    // 切换侧边栏
    toggleCollabSidebar() {
        const sidebar = document.getElementById('collaborationSidebar');
        if (sidebar) {
            sidebar.classList.toggle('collapsed');
            this.isCollabSidebarOpen = !this.isCollabSidebarOpen;
        }
    }


    // ==================== 编辑动态 ====================

    /**
     * 🔧 切换编辑动态显示/隐藏
     */
    toggleEditActivity() {
        const activityList = document.getElementById('editActivityList');
        const toggleBtn = document.querySelector('.section-title .btn-secondary i');

        if (!activityList || !toggleBtn) return;

        const isHidden = activityList.style.display === 'none';

        if (isHidden) {
            // 显示编辑动态
            activityList.style.display = 'flex';
            toggleBtn.className = 'fas fa-eye';
            toggleBtn.title = '隐藏编辑动态';
        } else {
            // 隐藏编辑动态
            activityList.style.display = 'none';
            toggleBtn.className = 'fas fa-eye-slash';
            toggleBtn.title = '显示编辑动态';
        }

        // 保存到本地设置，下次打开时保持状态
        localStorage.setItem('hideEditActivity', String(!isHidden));
    }

    /**
     * 🔧 初始化时恢复编辑动态显示状态
     */
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


    // 添加编辑动态显示方法
    showEditActivity(userName, action, timestamp, collab = null) {
        const container = document.getElementById('editActivityList');
        if (!container) return;

        const item = document.createElement('div');
        item.className = 'edit-activity-item';
        item.innerHTML = `
            <img src="${collab?.avatar || '/static/images/default-avatar.png'}" class="edit-activity-avatar" alt="${userName}">
            <span class="edit-activity-text"><strong>${this.escapeHtml(userName)}</strong> ${action}</span>
            <span class="edit-activity-time">${this.formatTime(timestamp)}</span>
        `;

        container.insertBefore(item, container.firstChild);
        while (container.children.length > 10) {
            container.removeChild(container.lastChild);
        }
    }

    // 处理远程用户输入状态
    showTypingIndicator(payload) {
        const {userId, userName, isTyping} = payload;
        if (isTyping && userId !== this.config?.editorConfig?.user?.id) {
            this.showEditActivity(userName, '正在输入...', new Date());
        }
    }


    /**
     * 判断是否播放加入提示音
     */
    shouldPlayJoinSound() {
        // 检查是否启用声音通知
        const soundEnabled = localStorage.getItem('collabSoundNotifications') !== 'false';
        // 如果是自己加入，不播放
        if (this.config?.editorConfig?.user?.id) {
            return soundEnabled;
        }
        return false;
    }


    // ==================== 版本历史功能 ====================

    // 显示版本历史
    async showVersions() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/versions/`, {
                headers: TokenManagerCustom.getHeaders()
            });

            if (!response.ok) throw new Error('加载版本失败');

            const data = await response.json();
            this.renderVersionList(data.versions);
            document.getElementById('versionModal').classList.add('show');

        } catch (error) {
            this.showError('加载版本历史失败：' + error.message);
        }
    }

    // 渲染版本列表
    renderVersionList(versions) {
        const container = document.getElementById('versionList');
        if (!versions || versions.length === 0) {
            container.innerHTML = '<p style="text-align:center;color:#999;">暂无版本记录</p>';
            return;
        }

        container.innerHTML = `
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f5f7fa;">
                        <th style="padding:12px;text-align:left;">版本号</th>
                        <th style="padding:12px;text-align:left;">大小</th>
                        <th style="padding:12px;text-align:left;">创建者</th>
                        <th style="padding:12px;text-align:left;">时间</th>
                        <th style="padding:12px;text-align:center;">操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${versions.map(v => `
                        <tr style="border-bottom:1px solid #ebeef5;">
                            <td style="padding:12px;">
                                v${v.version_number}
                                ${v.is_current ? '<span style="color:#67C23A;margin-left:5px;">(当前)</span>' : ''}
                            </td>
                            <td style="padding:12px;">${this.formatFileSize(v.file_size)}</td>
                            <td style="padding:12px;">${v.created_by}</td>
                            <td style="padding:12px;">${new Date(v.created_at).toLocaleString('zh-CN')}</td>
                            <td style="padding:12px;text-align:center; display: flex;">
                                <button class="btn btn-secondary btn-sm"
                                            onclick="editorApp.downloadVersion('${v.id}', '${this.escapeHtml(v.created_by)}', ${v.version_number})"
                                            style="padding:4px 12px;font-size:12px;">
                                        下载
                                </button>
                                ${!v.is_current ? `
                                    <button class="btn btn-primary btn-sm"
                                            onclick="editorApp.restoreVersion('${v.id}')"
                                            style="padding:4px 12px;font-size:12px;margin-right:5px;">
                                        恢复此版本
                                    </button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    // 恢复版本
    async restoreVersion(versionId) {
        const confirmed = await this.showConfirmDialog('恢复版本', '确定要恢复到此版本吗？当前内容将被覆盖。', 'confirm');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/restore_version/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManagerCustom.getHeaders()
                },
                body: JSON.stringify({
                    version_id: versionId,
                    create_backup: false
                })
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

    // 下载版本
    async downloadVersion(versionId, createdBy, versionNumber) {
        try {
            const response = await fetch(`/api/cloud/documents/versions/${versionId}/download/`, {
                headers: TokenManagerCustom.getHeaders()
            });

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
            console.error(error);
            this.showError('下载版本失败: ' + error.message || error.error || error);
        }
    }

    // 关闭版本模态框
    closeVersionModal() {
        document.getElementById('versionModal').classList.remove('show');
    }

    // ==================== 协作者管理功能 ====================

    // 显示添加协作者模态框
    showAddCollaboratorModal() {
        document.getElementById('addCollaboratorModal').classList.add('show');
        // 清空搜索框
        document.getElementById('collabSearchInput').value = '';
        document.getElementById('collabSearchResults').innerHTML = '';
        this.selectedCollaborators.clear();
    }

    // 关闭添加协作者模态框
    closeAddCollaboratorModal() {
        document.getElementById('addCollaboratorModal').classList.remove('show');
        this.selectedCollaborators.clear();
    }

    // 设置搜索事件监听
    setupSearchListener() {
        const searchInput = document.getElementById('collabSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchCollaborators(e.target.value);
            });
        }

    }

    // 隐藏指定元素事件监听
    setupHideElementListener(elementId = 'left-btn-about') {
        elementId = elementId || 'left-btn-about'

        let attempts = 0;
        const maxAttempts = 50;   // 总超时 50*200 = 10s
        const interval = setInterval(() => {
            const iframe = document.querySelector('iframe[name="frameEditor"]')

            if (iframe && iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                const elem = iframe.contentDocument.getElementById(elementId);
                if (elem) {
                    console.log('隐藏元素成功');
                    elem.style.display = 'none';
                    clearInterval(interval);
                }
            }
            attempts++;
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.log('未找到元素或超时');
            }
        }, 200);

    }


    // 搜索用户
    async searchCollaborators(keyword) {
        if (!keyword.trim()) {
            document.getElementById('collabSearchResults').innerHTML = '';
            return;
        }

        try {
            const response = await fetch(`/api/auth/search_users/?q=${encodeURIComponent(keyword)}`, {
                headers: TokenManagerCustom.getHeaders()
            });

            if (!response.ok) throw new Error('搜索失败');

            const data = await response.json();
            const users = data.results || [];

            // 过滤掉已存在的协作者和当前用户
            const existingIds = new Set([...this.collaborators.map(c => c.id), this.currentUser?.id]);
            const filtered = users.filter(u => !existingIds.has(u.id.toString()));

            this.renderSearchResults(filtered);

        } catch (error) {
            console.error('搜索用户失败:', error);
            document.getElementById('collabSearchResults').innerHTML = '<div style="padding:10px;color:#f56c6c;text-align:center;">搜索失败</div>';
        }
    }

    // 渲染搜索结果
    renderSearchResults(users) {
        const container = document.getElementById('collabSearchResults');
        if (users.length === 0) {
            container.innerHTML = '<div style="padding:10px;color:#999;text-align:center;">未找到用户</div>';
            return;
        }

        container.innerHTML = users.map(user => `
            <div class="search-result-item" style="padding:10px;border-bottom:1px solid #eee;display:flex;align-items:center;gap:10px;cursor:pointer;"
                 onclick="editorApp.selectCollaborator('${user.id}', '${this.escapeHtml(user.real_name || user.username)}')">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}"
                     style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
                <div style="flex:1;">
                    <div style="font-weight:500;">${this.escapeHtml(user.real_name || user.username)}</div>
                    <div style="font-size:12px;color:#999;">${user.department_info?.name || ''} ${user.position || ''}</div>
                </div>
                <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();editorApp.selectCollaborator('${user.id}', '${this.escapeHtml(user.real_name || user.username)}')">
                    添加
                </button>
            </div>
        `).join('');
    }

    // 选择协作者
    selectCollaborator(userId, userName) {
        this.selectedCollaborators.add({id: userId, name: userName});
        console.log('this.selectedCollaborators: ', this.selectedCollaborators)
        console.log('this.selectedCollaborators.size: ', this.selectedCollaborators.size)
        this.showSuccess(`已选择：${userName}`);
        // this.closeAddCollaboratorModal();
    }

    // 确认添加协作者
    async confirmAddCollaborator() {
        if (this.selectedCollaborators.size === 0) {
            this.showWarning('请选择要添加的协作者');
            return;
        }

        const permission = document.getElementById('collabPermission').value;
        const notify = document.getElementById('collabNotify').checked;

        try {
            let successCount = 0;
            for (const collaborator of this.selectedCollaborators) {
                const response = await fetch(`/api/cloud/documents/${this.fileId}/add_collaborator/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...TokenManagerCustom.getHeaders()
                    },
                    body: JSON.stringify({
                        user_id: collaborator.id,      // ✅ 与后端参数名一致
                        permission: permission,         // ✅ read/write/admin
                        notify: notify                  // ✅ 是否发送通知
                    })
                });

                if (response.ok) {
                    successCount++;
                } else {
                    const error = await response.json();
                    throw new Error(error.error || error.detail || error.message || '添加失败');
                }
            }

            if (successCount > 0) {
                this.showSuccess(`成功添加 ${successCount} 位协作者`);
            }

            this.selectedCollaborators.clear();
            this.closeAddCollaboratorModal();
            await this.loadCollaborators();

        } catch (error) {
            console.error('添加协作者失败:', error);
            this.showError('添加协作者失败: ' + error);
        }
    }


    // 🔧 打开修改协作者模态框
    async openEditCollabModal(collabId, currentPermission, isActive) {
        try {
            // 获取协作者详情
            const response = await fetch(`/api/cloud/documents/${this.fileId}/retrieve_collaborators/${collabId}/`, {
                headers: TokenManagerCustom.getHeaders()
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || error.message || '加载协作者信息失败');
            };

            const collab = await response.json();

            // 填充模态框数据
            document.getElementById('editCollabAvatar').src = collab.avatar || '/static/images/default-avatar.png';
            document.getElementById('editCollabName').textContent = collab.real_name || collab.username;
            document.getElementById('editCollabEmail').textContent = collab.email || '';
            document.getElementById('editCollabPermission').value = collab.permission || currentPermission;
            document.getElementById('editCollabActive').checked = collab.is_active !== undefined ? collab.is_active : isActive;

            // 保存当前编辑的协作者ID
            this.editingCollabId = collabId;

            // 显示模态框
            document.getElementById('editCollabModal').classList.add('show');

        } catch (error) {
            console.error('加载协作者信息失败:', error);
            this.showError('加载失败: ' + error);
        }
    }

    // 🔧 关闭修改协作者模态框
    closeEditCollabModal() {
        document.getElementById('editCollabModal').classList.remove('show');
        this.editingCollabId = null;
    }

    // 🔧 保存协作者修改
    async saveEditCollab() {
        if (!this.editingCollabId || !this.fileId) {
            this.showError('参数错误');
            return;
        }

        const permission = document.getElementById('editCollabPermission').value;
        const isActive = document.getElementById('editCollabActive').checked;

        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/update_collaborator/${this.editingCollabId}/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManagerCustom.getHeaders()
                },
                body: JSON.stringify({
                    permission: permission,
                    is_active: isActive
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || error.message || '更新协作者失败');
            }

            this.showSuccess('更新成功', '协作者权限已更新');
            this.closeEditCollabModal();

            // 重新加载协作者列表
            await this.loadCollaborators();

        } catch (error) {
            console.error('更新协作者失败:', error);
            this.showError('更新失败: ' + error);
        }
    }

    // 移除协作者
    async removeCollaborator(userId, userName) {
        const confirmed = await this.showConfirmDialog('移除协作者', `确定要移除 ${userName} 吗？`, 'confirm');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/${userId}/`, {
                method: 'DELETE',
                headers: TokenManagerCustom.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || error.detail || error.message || '移除失败');
            }

            this.showSuccess(`已移除协作者: ${userName}`);
            await this.loadCollaborators();

        } catch (error) {
            console.error('移除协作者失败:', error);
            this.showError('移除失败: ' + error);
        }
    }


    // 修改协作者权限
    async editCollaboratorPermission(userId, currentPermission, isActive = true) {
        const newPermission = prompt('设置权限 (read/write/admin):', currentPermission);
        if (!newPermission) {
            return;
        }
        if (!['read', 'write', 'admin'].includes(newPermission)) {
            this.showWarning('无效的权限类型');
            return;
        }

        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/${userId}/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManagerCustom.getHeaders()
                },
                body: JSON.stringify({
                    permission: newPermission,
                    is_active: isActive
                })
            });

            if (!response.ok) {
                this.showError(`权限更新失败: ${userId}`);
            } else {
                this.showSuccess(`权限已更新：${userId}`);
                this.loadCollaborators();
            }


        } catch (error) {
            this.showError('更新权限失败：' + error.message);
        }
    }


    // ==================== 文档链接分享 ====================

    // 🔧 获取协作文档链接
    getDocShareLink() {
        if (!this.fileId) return '';
        const baseUrl = window.location.origin;
        return `${baseUrl}/cloud/editor/?id=${this.fileId}`;
    }

    // 🔧 复制协作文档链接
    async copyDocLink() {
        const link = this.getDocShareLink();
        const input = document.getElementById('docShareLink');
        if (input) {
            input.value = link;
            input.select();
            try {
                await navigator.clipboard.writeText(link);
                this.showSuccess('链接已复制', '协作文档链接已复制到剪贴板');
            } catch (err) {
                // 降级方案
                document.execCommand('copy');
                this.showSuccess('链接已复制', '协作文档链接已复制到剪贴板');
            }
        }
    }


    // ==================== 保存状态 ====================
    // 更新保存状态
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

    /**
     * 获取用户专属颜色（用于光标/选区标识）
     * @param {string} userId
     * @returns {string} hex 颜色值
     */
    getUserColor(userId) {
        if (!this.userColors) this.userColors = new Map();

        if (!this.userColors.has(userId)) {
            // 使用确定性哈希生成颜色
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = userId.charCodeAt(i) + ((hash << 5) - hash);
            }
            const hue = Math.abs(hash) % 360;
            // 使用 HSL 生成柔和且区分度高的颜色
            const color = `hsl(${hue}, 75%, 55%)`;
            this.userColors.set(userId, color);
        }
        return this.userColors.get(userId);
    }

    /**
     * 格式化时间显示
     * @param {string|Date} timestamp
     * @returns {string}
     */
    formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();

        // 今天显示时分
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        }
        // 本周显示星期 + 时分
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            return `周${weekdays[date.getDay()]} ${date.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            })}`;
        }
        // 更早显示日期
        return date.toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    /**
     * 截断消息内容
     * @param {string} text
     * @param {number} maxLength
     * @returns {string}
     */
    truncateMessage(text, maxLength = 100) {
        if (!text) return '';
        // 移除 HTML 标签后截断
        const plainText = text.replace(/<[^>]*>/g, '');
        return plainText.length > maxLength
            ? plainText.substring(0, maxLength) + '...'
            : plainText;
    }


    // 工具方法：格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // 工具方法：转义 HTML
    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }


    // ==================== 提示消息 ====================

    showError(message) {
        this.showToast(`${message}`, 'error');
    }

    /**
     * 🔧 新增：警告提示
     */
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


    // ==================== 优雅的提示对话框（替换 alert） ====================
    showAlert(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
            <div class="confirm-dialog-content">
                <div class="confirm-dialog-header">
                    <i class="fas fa-info-circle"></i>
                    <h3>${title}</h3>
                    <button class="close-btn" style="margin-left: auto;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="confirm-dialog-body">
                    <p>${message}</p>
                </div>
                <div class="confirm-dialog-footer">
                    <button class="confirm-dialog-btn confirm">确定</button>
                </div>
            </div>
        `;

            document.body.appendChild(dialog);

            const confirmBtn = dialog.querySelector('.confirm');
            const closeBtn = dialog.querySelector('.close-btn');

            const closeDialog = () => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) {
                        document.body.removeChild(dialog);
                    }
                }, 300);
                resolve();
            };

            if (confirmBtn) confirmBtn.addEventListener('click', closeDialog);
            if (closeBtn) closeBtn.addEventListener('click', closeDialog);
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) closeDialog();
            });

            setTimeout(() => {
                dialog.classList.add('show');
            }, 10);
        });
    }


    // ==================== 确认对话框 ====================
    showConfirmDialog(title, message, type = 'confirm') {
        return new Promise((resolve) => {
            // 创建对话框
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
            <div class="confirm-dialog-content">
                <div class="confirm-dialog-header">
                    <i class="fas fa-${type === 'danger' ? 'exclamation-triangle' : type === 'confirm' ? 'check-circle' : 'question-circle'}"></i>
                    <h3>${title}</h3>
                    <button class="close-btn" style="margin-left: auto;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="confirm-dialog-body">
                    <p>${message}</p>
                </div>
                <div class="confirm-dialog-footer">
                    <button class="confirm-dialog-btn cancel">取消</button>
                    <button class="confirm-dialog-btn ${type}">确定</button>
                </div>
            </div>
        `;

            document.body.appendChild(dialog);

            // 获取按钮
            const cancelBtn = dialog.querySelector('.cancel');
            const confirmBtn = dialog.querySelector(`.${type}`);
            const closeBtn = dialog.querySelector('.close-btn');

            // 关闭对话框
            const closeDialog = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) {
                        document.body.removeChild(dialog);
                    }
                }, 300);
                resolve(result);
            };

            // 事件监听
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => closeDialog(false));
            }
            if (closeBtn) {
                closeBtn.addEventListener('click', () => closeDialog(false));
            }
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => closeDialog(true));
            }
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    closeDialog(false);
                }
            });

            // 显示对话框
            setTimeout(() => {
                dialog.classList.add('show');
            }, 10);
        });
    }


    // ==================== 关闭编辑器 ====================
    // 关闭编辑器
    async closeEditor() {

        const confirmed = await this.showConfirmDialog('关闭编辑器', '确定要关闭编辑器吗？', 'danger');
        if (!confirmed) return;

        try {

            // 🔧 1. 先等待文档保存完成
            if (this.editor) {
                // 触发自定义保存事件（如果需要）
                await new Promise(resolve => setTimeout(resolve, 1000));
            }


            // 2. 停止心跳
            if (this.collabHeartbeatTimer) {
                clearTimeout(this.collabHeartbeatTimer);
                this.collabHeartbeatTimer = null;
            }

            // 3. 上报离开状态（等待后端处理）
            if (this.fileId) {
                try {
                    await this.updateCollaborationStatus('closed');
                    // 等待后端处理完成
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.warn('上报离开状态失败:', error);
                }
            }

            // 4. 关闭 WebSocket（等待关闭完成）
            if (this.collabSocket?.readyState === WebSocket.OPEN) {
                this.collabSocket.close(1000, 'Page unload');
                // 等待 WebSocket 关闭
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            // 5. 销毁编辑器
            if (this.editor) {
                this.editor.destroyEditor();
                this.editor = null;
            }

            // 6. 清理配置（关键！）
            this.config = null;


            // 7. 关闭窗口或跳转
            window.close();
            // 或者：window.location.href = '/cloud/';
        } catch (error) {
            console.error('关闭编辑器失败:', error);
            // 即使出错也要关闭窗口
            window.close();
        }

    }


    playSystemNotificationSound(title = '新消息', options = {}) {
        // 检查通知权限
        if (Notification.permission !== 'granted') {
            // 降级：使用自定义声音
            this.playCustomSound();
            return;
        }

        // 创建静默通知（silent: false 会触发系统默认提示音）
        const notification = new Notification('🔔' + title, {
            ...options,
            silent: false,  // 🔧 关键：允许系统播放默认提示音
            requireInteraction: false,
            tag: `notification-${Date.now()}`
        });

        // 3 秒后自动关闭，避免通知堆积
        setTimeout(() => notification.close(), 3000);
    }

    // 保留自定义声音作为降级方案
    playCustomSound() {
        // 原有 Web Audio API 或 Audio 元素逻辑...
        const soundMap = {
            'join': '/static/sounds/collab-join.mp3',
            'leave': '/static/sounds/collab-leave.mp3',
            'mention': '/static/sounds/mention.mp3',
            'message': '/static/sounds/chat-message.mp3'
        };

        const audio = new Audio(soundMap[type] || soundMap.message);
        audio.volume = 0.3; // 降低音量避免打扰
        audio.play().catch(e => console.warn('播放音效失败:', e));
    }


    /**
     * 播放通知音效
     * @param {string} type - 'join' | 'leave' | 'mention' | 'message'
     */
    playNotificationSound(type = 'message', title = '新消息', options = {}) {
        try {
            const soundEnabled = localStorage.getItem('soundNotifications') !== 'false';
            if (!soundEnabled) return;
            // 优先尝试系统通知声音
            if (Notification.permission === 'granted') {
                this.playSystemNotificationSound(title, options);
            } else {
                // 降级：自定义声音
                this.playCustomSound();
            }


        } catch (e) {
            console.warn('播放音效失败:', e);
        }

    }


    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = '/cloud/login/';
    }


}

// ==================== 全局初始化 ====================

let editorApp = null;

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('id');

    if (fileId) {
        editorApp = new DocumentEditorApp(fileId);
        window.editorApp = editorApp
    } else {
        const loadingEl = document.getElementById('loadingState');
        if (loadingEl) {
            loadingEl.innerHTML = '<p>❌ 缺少文件参数</p><button onclick="history.back()">返回</button>';
        }
    }
});


// 🔧 移动端锁屏优化
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        // 页面隐藏时降低心跳频率到 60 秒
        if (this.collabHeartbeatTimer) {
            console.log('页面隐藏时降低心跳频率到 60 秒...');
            clearTimeout(this.collabHeartbeatTimer);
            this.collabHeartbeatTimer = setTimeout(() => this.startCollabHeartbeat(), 60000);
        }
    } else {
        try {
            // 页面恢复时立即同步状态
            console.log('页面恢复时同步状态...');
            this.loadCollaborators();
            this.startCollabHeartbeat();
        } catch (error) {
            console.warn('页面恢复时同步失败:', error);
        }

    }
});


// 🔧 页面卸载时的清理
window.addEventListener('beforeunload', async (event) => {
    if (window.editorApp) {
        // 同步上报离开状态
        try {
            await window.editorApp.updateCollaborationStatus('closed');
        } catch (error) {
            console.warn('页面卸载时上报失败:', error);
        }

        // 关闭 WebSocket
        if (window.editorApp.collabSocket?.readyState === WebSocket.OPEN) {
            window.editorApp.collabSocket.close(1000, 'Page unload');
        }
    }
});