/**
 * @File   : cloud_editor.js
 * @Time   : 2026/3/16
 * @Author : dayue
 * @Desc   : 文档协同编辑器前端逻辑（WebSocket 协同 + OnlyOffice 集成）
 */

class DocumentEditorApp {
    constructor() {
        // 🔧 核心状态
        this.fileId = null;
        this.docEditor = null;
        this.ws = null;
        this.isConnected = false;
        this.currentUser = null;
        this.collaborators = [];
        this.typingUsers = new Map();  // userId -> {username, lastActive}
        this.cursorPositions = new Map();  // userId -> cursor data
        this.selections = new Map();  // userId -> selection data

        // 🔧 心跳配置
        this.heartbeatInterval = null;
        this.HEARTBEAT_INTERVAL = 30000;  // 30秒
        this.lastHeartbeatTime = null;

        // 🔧 防抖配置
        this.typingTimeout = null;
        this.TYPING_TIMEOUT = 1000;  // 1秒无输入视为停止打字

        // 🔧 初始化
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        console.log('📝 DocumentEditorApp 初始化开始...');

        try {
            // 1. 解析文件ID
            const urlParams = new URLSearchParams(window.location.search);
            this.fileId = urlParams.get('id');

            if (!this.fileId) {
                this.showError('缺少文件参数');
                return;
            }

            // 2. 获取用户信息
            this.currentUser = await API.getCurrentUser();
            console.log('当前用户:', this.currentUser);

            // 3. 获取文档编辑配置
            const config = await this.fetchEditConfig();
            if (!config) {
                this.showError('获取编辑配置失败');
                return;
            }

            // 4. 初始化 OnlyOffice 编辑器
            await this.initOnlyOffice(config);

            // 5. 连接 WebSocket
            this.connectWebSocket();

            // 6. 加载协作者列表
            await this.loadCollaborators();

            // 7. 设置事件监听
            this.setupEventListeners();

            console.log('✅ DocumentEditorApp 初始化完成');

        } catch (error) {
            console.error('❌ 初始化失败:', error);
            this.showError('初始化失败: ' + error.message);
        }
    }

    // 🔧 获取文档编辑配置
    async fetchEditConfig() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/edit/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '获取配置失败');
            }

            return await response.json();
        } catch (error) {
            console.error('获取编辑配置失败:', error);
            throw error;
        }
    }

    // 🔧 初始化 OnlyOffice 编辑器
    async initOnlyOffice(config) {
        return new Promise((resolve, reject) => {
            // 🔧 关键修复：确保 DocEditor 已加载
            if (typeof DocsAPI === 'undefined') {
                console.error('DocsAPI not loaded');
                reject(new Error('OnlyOffice SDK 未加载'));
                return;
            }

            try {
                this.docEditor = new DocsAPI.DocEditor('editor-container', {
                    ...config,
                    events: {
                        // 🔧 文档就绪事件
                        onAppReady: () => {
                            console.log('✅ OnlyOffice 编辑器就绪');
                            resolve();
                        },

                        // 🔧 文档状态变更
                        onDocumentStateChange: (event) => {
                            console.log('文档状态变更:', event);
                            // 可以在此处理自动保存状态
                        },

                        // 🔧 用户连接/断开
                        onMetaChange: (meta) => {
                            console.log('Meta 变更:', meta);
                            // 更新协作者列表
                            this.updateCollaboratorsFromMeta(meta);
                        },

                        // 🔧 光标位置变更 - 广播给其他协作者
                        onCursor: (event) => {
                            this.handleLocalCursorChange(event);
                        },

                        // 🔧 选区变更 - 广播给其他协作者
                        onSelectionChange: (event) => {
                            this.handleLocalSelectionChange(event);
                        },

                        // 🔧 输入状态 - 广播打字状态
                        onInput: () => {
                            this.handleLocalTyping();
                        },

                        // 🔧 聊天消息
                        onChat: (event) => {
                            this.handleLocalChatMessage(event);
                        },

                        // 🔧 错误处理
                        onError: (event) => {
                            console.error('OnlyOffice 错误:', event);
                            this.showError('编辑器错误: ' + (event?.data || '未知错误'));
                        }
                    }
                });

            } catch (error) {
                console.error('初始化 OnlyOffice 失败:', error);
                reject(error);
            }
        });
    }

    // 🔧 连接 WebSocket
    connectWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('access_token');
        // let wsUrl = `${protocol}//${window.location.host}/ws/cloud/documents/${this.fileId}/collab/`;
        let wsUrl = `${protocol}//${window.location.host}/ws/cloud/collab/${this.fileId}/`;


        if (token) {
            wsUrl += `?token=${encodeURIComponent(token)}`;
        }

        console.log('Connecting WebSocket:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('✅ WebSocket 连接成功');
            this.isConnected = true;
            this.startHeartbeat();
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleCollabMessage(data);  // 🔧 核心消息处理
            } catch (error) {
                console.error('解析消息失败:', error);
            }
        };

        this.ws.onclose = (event) => {
            console.log('WebSocket 断开:', event.code, event.reason);
            this.isConnected = false;
            this.stopHeartbeat();

            // 🔧 自动重连（非正常关闭时）
            if (event.code !== 1000) {
                console.log('尝试重连...');
                setTimeout(() => this.connectWebSocket(), 3000);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket 错误:', error);
            this.isConnected = false;
        };
    }

    // 🔧 核心：处理协同消息
    handleCollabMessage(message) {
        console.log('📨 收到协同消息:', message);

        const { type, data, timestamp, sender } = message;

        switch (type) {
            // 🔧 用户输入状态
            case 'user_typing':
                this.handleUserTyping(data, sender);
                break;

            // 🔧 光标位置更新
            case 'cursor_update':
                this.handleCursorUpdate(data, sender);
                break;

            // 🔧 选区更新
            case 'selection_update':
                this.handleSelectionUpdate(data, sender);
                break;

            // 🔧 聊天消息
            case 'chat_message':
                this.handleChatMessage(data, sender, timestamp);
                break;

            // 🔧 协同状态变更
            case 'collab_status':
                this.handleCollabStatus(data, sender);
                break;

            // 🔧 心跳确认
            case 'heartbeat_ack':
                this.handleHeartbeatAck(data);
                break;

            // 🔧 连接确认
            case 'connected':
                console.log('✅ 协同连接已建立:', data);
                break;

            default:
                console.warn('未知消息类型:', type);
        }
    }

    // 🔧 处理用户输入状态
    handleUserTyping(data, sender) {
        if (!sender || !data) return;

        const userId = sender.user_id;
        const username = sender.real_name || sender.username;

        if (data.is_typing) {
            // 用户开始输入
            this.typingUsers.set(userId, {
                username,
                lastActive: Date.now(),
                cursor: data.cursor_position
            });
            this.showTypingIndicator(username);
        } else {
            // 用户停止输入
            this.typingUsers.delete(userId);
            this.hideTypingIndicator(username);
        }

        // 🔧 更新光标位置（如果提供）
        if (data.cursor_position) {
            this.cursorPositions.set(userId, data.cursor_position);
            this.renderRemoteCursor(userId, data.cursor_position);
        }
    }

    // 🔧 处理光标位置更新
    handleCursorUpdate(data, sender) {
        if (!sender || !data?.cursor) return;

        const userId = sender.user_id;
        this.cursorPositions.set(userId, data.cursor);

        // 🔧 渲染远程用户的光标
        this.renderRemoteCursor(userId, data.cursor);

        // 🔧 如果用户在输入，更新打字状态
        if (data.viewport?.isTyping) {
            this.typingUsers.set(userId, {
                username: sender.real_name || sender.username,
                lastActive: Date.now(),
                cursor: data.cursor
            });
        }
    }

    // 🔧 处理选区更新
    handleSelectionUpdate(data, sender) {
        if (!sender || !data?.selection) return;

        const userId = sender.user_id;
        this.selections.set(userId, data.selection);

        // 🔧 渲染远程用户的选区高亮
        this.renderRemoteSelection(userId, data.selection, data.highlight_color);
    }

    // 🔧 处理聊天消息
    handleChatMessage(data, sender, timestamp) {
        if (!data?.content) return;

        const message = {
            id: data.message_id,
            content: data.content,
            sender: {
                id: sender?.user_id,
                username: sender?.username,
                real_name: sender?.real_name,
                avatar: sender?.avatar
            },
            timestamp: timestamp,
            reply_to: data.reply_to,
            mentions: data.mentions || []
        };

        // 🔧 添加到聊天面板
        this.appendChatMessage(message);

        // 🔧 如果有@提及当前用户，显示通知
        if (data.mentions?.includes(this.currentUser.id)) {
            this.showMentionNotification(message);
        }
    }

    // 🔧 处理协同状态变更
    handleCollabStatus(data, sender) {
        if (!sender || !data?.status) return;

        const userId = sender.user_id;
        const username = sender.real_name || sender.username;
        const status = data.status;  // editing/viewing/closed

        // 🔧 更新协作者列表中的状态
        this.updateCollaboratorStatus(userId, status);

        // 🔧 显示状态变化提示
        if (status === 'editing') {
            this.showToast(`${username} 开始编辑文档`);
        } else if (status === 'closed') {
            this.showToast(`${username} 离开文档`);
            // 清理该用户的光标和选区
            this.cursorPositions.delete(userId);
            this.selections.delete(userId);
            this.typingUsers.delete(userId);
            this.removeRemoteCursor(userId);
            this.removeRemoteSelection(userId);
        }
    }

    // 🔧 处理心跳确认
    handleHeartbeatAck(data) {
        this.lastHeartbeatTime = Date.now();

        // 🔧 更新在线用户数显示
        if (data.online_users !== undefined) {
            this.updateOnlineCount(data.online_users);
        }
    }

    // 🔧 发送协同消息
    sendCollabMessage(messageType, data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket 未连接，消息已加入队列');
            this.messageQueue = this.messageQueue || [];
            this.messageQueue.push({ type: messageType, data });
            return;
        }

        const message = {
            type: messageType,
            data: data,
            timestamp: new Date().toISOString()
        };

        this.ws.send(JSON.stringify(message));
    }

    // 🔧 本地光标变更处理 - 广播给其他协作者
    handleLocalCursorChange(event) {
        // 🔧 防抖：避免频繁发送
        if (this.cursorDebounceTimer) {
            clearTimeout(this.cursorDebounceTimer);
        }

        this.cursorDebounceTimer = setTimeout(() => {
            this.sendCollabMessage('cursor_update', {
                cursor: event?.cursor || null,
                viewport: event?.viewport || null
            });
        }, 100);
    }

    // 🔧 本地选区变更处理 - 广播给其他协作者
    handleLocalSelectionChange(event) {
        this.sendCollabMessage('selection_update', {
            selection: event?.selection || null,
            color: '#409EFF'  // 选区高亮颜色
        });
    }

    // 🔧 本地输入处理 - 广播打字状态
    handleLocalTyping() {
        // 发送"正在输入"状态
        this.sendCollabMessage('user_typing', {
            is_typing: true,
            cursor_position: this.getCurrentCursorPosition()
        });

        // 🔧 防抖：停止输入后发送"停止输入"
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.sendCollabMessage('user_typing', {
                is_typing: false,
                cursor_position: null
            });
        }, this.TYPING_TIMEOUT);
    }

    // 🔧 本地聊天消息处理
    handleLocalChatMessage(event) {
        if (!event?.message) return;

        this.sendCollabMessage('chat_message', {
            content: event.message,
            reply_to: event.replyTo || null,
            mentions: event.mentions || []
        });
    }

    // 🔧 心跳保活
    startHeartbeat() {
        this.stopHeartbeat();  // 清除旧的心跳

        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected) {
                this.sendCollabMessage('heartbeat', {
                    timestamp: new Date().toISOString()
                });
            }
        }, this.HEARTBEAT_INTERVAL);

        console.log('❤️ 心跳启动');
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            console.log('❤️ 心跳停止');
        }
    }

    // 🔧 加载协作者列表
    async loadCollaborators() {
        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载协作者失败');

            const data = await response.json();
            this.collaborators = data.collaborators || [];

            // 🔧 渲染协作者列表
            this.renderCollaboratorList(this.collaborators);

            // 🔧 初始化在线状态
            this.collaborators.forEach(collab => {
                if (collab.is_online) {
                    this.cursorPositions.set(collab.id, null);
                }
            });

        } catch (error) {
            console.error('加载协作者失败:', error);
        }
    }

    // 🔧 渲染协作者列表
    renderCollaboratorList(collaborators) {
        const container = document.getElementById('collaboratorList');
        if (!container) return;

        let html = '';

        collaborators.forEach(collab => {
            const statusClass = collab.is_editing ? 'status-editing' :
                               collab.is_online ? 'status-online' : 'status-offline';
            const permissionText = {
                'admin': '管理员',
                'write': '可编辑',
                'read': '只读'
            }[collab.permission] || collab.permission;

            html += `
                <div class="collaborator-item" data-user-id="${collab.id}">
                    <div class="collaborator-avatar">
                        <img src="${collab.avatar || '/static/images/default-avatar.png'}" 
                             alt="${collab.username}"
                             title="${collab.real_name || collab.username}">
                        <span class="status-dot ${statusClass}"></span>
                    </div>
                    <div class="collaborator-info">
                        <div class="collaborator-name">
                            ${collab.real_name || collab.username}
                            ${collab.is_owner ? '<span class="badge badge-owner">所有者</span>' : ''}
                        </div>
                        <div class="collaborator-permission">${permissionText}</div>
                    </div>
                    ${collab.is_owner ? '' : `
                        <div class="collaborator-actions">
                            <button class="btn-icon" onclick="editorApp.removeCollaborator('${collab.id}')" 
                                    title="移除协作者">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    `}
                </div>
            `;
        });

        container.innerHTML = html || '<div class="empty-tip">暂无协作者</div>';
    }

    // 🔧 更新协作者状态
    updateCollaboratorStatus(userId, status) {
        const item = document.querySelector(`.collaborator-item[data-user-id="${userId}"]`);
        if (!item) return;

        const statusDot = item.querySelector('.status-dot');
        if (statusDot) {
            statusDot.className = `status-dot status-${status}`;
        }

        // 🔧 更新本地缓存
        const collab = this.collaborators.find(c => c.id === userId);
        if (collab) {
            collab.status = status;
            collab.is_editing = status === 'editing';
            collab.is_online = ['editing', 'viewing'].includes(status);
        }
    }

    // 🔧 渲染远程用户光标
    renderRemoteCursor(userId, cursor) {
        // 🔧 OnlyOffice 提供 API 渲染远程光标
        if (this.docEditor && cursor) {
            // 使用 OnlyOffice 的协同光标功能
            // 注意：实际实现需要参考 OnlyOffice 的协同 API
            console.log(`渲染用户 ${userId} 的光标:`, cursor);
        }
    }

    // 🔧 移除远程用户光标
    removeRemoteCursor(userId) {
        if (this.docEditor) {
            // 调用 OnlyOffice API 移除远程光标
            console.log(`移除用户 ${userId} 的光标`);
        }
    }

    // 🔧 渲染远程用户选区
    renderRemoteSelection(userId, selection, color) {
        if (this.docEditor && selection) {
            // 使用 OnlyOffice 的协同选区高亮功能
            console.log(`渲染用户 ${userId} 的选区:`, selection, color);
        }
    }

    // 🔧 移除远程用户选区
    removeRemoteSelection(userId) {
        if (this.docEditor) {
            console.log(`移除用户 ${userId} 的选区`);
        }
    }

    // 🔧 显示打字指示器
    showTypingIndicator(username) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            const typers = Array.from(this.typingUsers.values())
                .map(u => u.username)
                .slice(0, 3)
                .join('、');

            indicator.textContent = `${typers} 正在输入...`;
            indicator.style.display = 'flex';

            // 🔧 自动隐藏
            clearTimeout(this.typingIndicatorTimeout);
            this.typingIndicatorTimeout = setTimeout(() => {
                if (this.typingUsers.size === 0) {
                    indicator.style.display = 'none';
                }
            }, 3000);
        }
    }

    hideTypingIndicator(username) {
        if (this.typingUsers.size === 0) {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) {
                indicator.style.display = 'none';
            }
        }
    }

    // 🔧 添加聊天消息到面板
    appendChatMessage(message) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const isOwn = message.sender?.id === this.currentUser?.id;
        const avatar = message.sender?.avatar || '/static/images/default-avatar.png';
        const senderName = message.sender?.real_name || message.sender?.username || '未知用户';

        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${isOwn ? 'own' : 'other'}`;
        messageEl.innerHTML = `
            ${!isOwn ? `
                <div class="chat-avatar">
                    <img src="${avatar}" alt="${senderName}">
                </div>
            ` : ''}
            <div class="chat-content">
                <div class="chat-header">
                    <span class="chat-sender">${senderName}</span>
                    <span class="chat-time">${this.formatTime(message.timestamp)}</span>
                </div>
                <div class="chat-text">${this.escapeHtml(message.content)}</div>
                ${message.reply_to ? `
                    <div class="chat-reply">
                        <i class="fas fa-reply"></i> 回复: ${this.escapeHtml(message.reply_content || '')}
                    </div>
                ` : ''}
            </div>
            ${isOwn ? `
                <div class="chat-avatar">
                    <img src="${this.currentUser?.avatar_url || '/static/images/default-avatar.png'}" alt="我">
                </div>
            ` : ''}
        `;

        container.appendChild(messageEl);

        // 🔧 滚动到底部
        container.scrollTop = container.scrollHeight;
    }

    // 🔧 发送聊天消息
    sendChatMessage(content, replyTo = null, mentions = []) {
        if (!content.trim()) return;

        // 🔧 本地先显示
        this.appendChatMessage({
            content: content,
            sender: {
                id: this.currentUser?.id,
                username: this.currentUser?.username,
                real_name: this.currentUser?.real_name,
                avatar: this.currentUser?.avatar_url
            },
            timestamp: new Date().toISOString(),
            reply_to: replyTo,
            mentions: mentions
        });

        // 🔧 通过 WebSocket 发送
        this.handleLocalChatMessage({
            message: content,
            replyTo: replyTo,
            mentions: mentions
        });
    }

    // 🔧 显示@提及通知
    showMentionNotification(message) {
        // 🔧 浏览器通知（如果权限允许）
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('有人@了你', {
                body: message.content.substring(0, 50) + '...',
                icon: message.sender?.avatar || '/static/images/default-avatar.png'
            });
        }

        // 🔧 页面内通知
        this.showToast(`🔔 ${message.sender?.real_name || message.sender?.username} 提到了你`, 'mention');
    }

    // 🔧 获取当前光标位置
    getCurrentCursorPosition() {
        if (!this.docEditor) return null;

        try {
            // 🔧 调用 OnlyOffice API 获取光标位置
            // 注意：实际实现需要参考 OnlyOffice 的 API 文档
            return this.docEditor.getCursorPosition?.() || null;
        } catch (error) {
            console.warn('获取光标位置失败:', error);
            return null;
        }
    }

    // 🔧 更新在线用户数显示
    updateOnlineCount(count) {
        const badge = document.getElementById('onlineCountBadge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 1 ? 'inline-block' : 'none';
        }
    }

    // 🔧 设置事件监听
    setupEventListeners() {
        // 🔧 聊天输入框
        const chatInput = document.getElementById('chatInput');
        const chatSendBtn = document.getElementById('chatSendBtn');

        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', () => {
                if (chatInput) {
                    this.sendChatMessage(chatInput.value);
                    chatInput.value = '';
                }
            });
        }

        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage(chatInput.value);
                    chatInput.value = '';
                }
            });

            // 🔧 @提及自动补全
            chatInput.addEventListener('input', (e) => this.handleAtMention(e));
        }

        // 🔧 页面关闭时发送离开消息
        window.addEventListener('beforeunload', () => {
            this.sendCollabMessage('collab_status', {
                status: 'closed'
            });
            this.stopHeartbeat();
            if (this.ws) {
                this.ws.close(1000, 'Page unload');
            }
        });
    }

    // 🔧 处理@提及输入
    handleAtMention(event) {
        const input = event.target;
        const value = input.value;
        const cursorPos = input.selectionStart;

        // 🔧 检测@符号
        if (value.charAt(cursorPos - 1) === '@') {
            this.showAtMentionPanel(input, cursorPos);
        }
    }

    // 🔧 显示@提及面板
    showAtMentionPanel(input, cursorPos) {
        const panel = document.getElementById('atMentionPanel');
        if (!panel) return;

        // 🔧 过滤协作者列表
        const filtered = this.collaborators.filter(c =>
            c.id !== this.currentUser?.id &&
            (c.username.toLowerCase().includes(input.value.substring(cursorPos).toLowerCase()) ||
             (c.real_name && c.real_name.toLowerCase().includes(input.value.substring(cursorPos).toLowerCase())))
        );

        if (filtered.length === 0) {
            panel.style.display = 'none';
            return;
        }

        // 🔧 渲染提及列表
        let html = '';
        filtered.forEach(user => {
            html += `
                <div class="at-item" onclick="editorApp.insertAtMention('${user.username}', '${user.real_name || user.username}')">
                    <img src="${user.avatar || '/static/images/default-avatar.png'}" alt="${user.username}">
                    <span>${user.real_name || user.username} ${user.is_owner ? '(所有者)' : ''}</span>
                </div>
            `;
        });

        panel.innerHTML = html;
        panel.style.display = 'block';

        // 🔧 定位面板
        const rect = input.getBoundingClientRect();
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top - panel.offsetHeight - 10}px`;
    }

    // 🔧 插入@提及
    insertAtMention(username, displayName) {
        const input = document.getElementById('chatInput');
        if (!input) return;

        const cursorPos = input.selectionStart;
        const value = input.value;

        // 🔧 找到最后一个@的位置
        const atIndex = value.lastIndexOf('@', cursorPos - 1);
        if (atIndex === -1) return;

        // 🔧 替换@后的内容为@username
        const newValue = value.substring(0, atIndex) + `@${displayName} ` + value.substring(cursorPos);
        input.value = newValue;
        input.selectionStart = input.selectionEnd = atIndex + displayName.length + 2;
        input.focus();

        // 🔧 隐藏面板
        document.getElementById('atMentionPanel').style.display = 'none';
    }

    // 🔧 移除协作者
    async removeCollaborator(userId) {
        const confirmed = await this.showConfirmDialog('移除协作者', '确定要移除该协作者吗？');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/documents/${this.fileId}/collaborators/${userId}/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '移除失败');
            }

            this.showToast('协作者已移除');
            await this.loadCollaborators();  // 🔧 重新加载列表

        } catch (error) {
            console.error('移除协作者失败:', error);
            this.showError('移除失败: ' + error.message);
        }
    }

    // 🔧 工具方法：格式化时间
    formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // 🔧 工具方法：转义HTML
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

    // 🔧 工具方法：显示提示
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // 🔧 工具方法：显示错误
    showError(message) {
        this.showToast(message, 'error');
        console.error(message);
    }

    // 🔧 工具方法：确认对话框
    async showConfirmDialog(title, message) {
        return new Promise(resolve => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <h4>${title}</h4>
                    <p>${message}</p>
                    <div class="confirm-dialog-actions">
                        <button class="btn btn-secondary cancel">取消</button>
                        <button class="btn btn-primary confirm">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);

            const close = (result) => {
                dialog.remove();
                resolve(result);
            };

            dialog.querySelector('.cancel').onclick = () => close(false);
            dialog.querySelector('.confirm').onclick = () => close(true);

            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    // 🔧 从 OnlyOffice meta 更新协作者
    updateCollaboratorsFromMeta(meta) {
        // 🔧 OnlyOffice 的 onMetaChange 事件会提供协同用户信息
        // 这里可以根据实际需求处理
        console.log('Meta 变更，更新协作者:', meta);
    }

    // 🔧 清理资源
    destroy() {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close(1000, 'App destroy');
            this.ws = null;
        }
        if (this.docEditor) {
            this.docEditor.destroyEditor();
            this.docEditor = null;
        }
        console.log('🧹 资源已清理');
    }
}

// 🔧 全局实例
let editorApp = null;

document.addEventListener('DOMContentLoaded', () => {
    editorApp = new DocumentEditorApp();
    window.editorApp = editorApp;
});

// 🔧 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (editorApp) {
        editorApp.destroy();
    }
});