// static/js/collab_socket.js

class CollabSocketManager {
    constructor(cloudApp) {
        this.cloudApp = cloudApp;
        this.ws = null;
        this.fileId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.heartbeatInterval = null;
        this.messageHandlers = {};
    }

    /**
     * 连接协同编辑 WebSocket
     * @param {string} fileId - 文档 ID
     */
    connect(fileId) {
        if (this.ws?.readyState === WebSocket.OPEN && this.fileId === fileId) {
            return;
        }

        this.disconnect();
        this.fileId = fileId;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('access_token');
        const wsUrl = `${protocol}//${window.location.host}/ws/cloud/documents/${fileId}/collab/?token=${encodeURIComponent(token)}`;

        console.log(`🔗 连接协同编辑 WebSocket: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => this._onOpen();
        this.ws.onmessage = (event) => this._onMessage(event);
        this.ws.onclose = (event) => this._onClose(event);
        this.ws.onerror = (error) => this._onError(error);
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.ws) {
            // 发送离开通知
            this.sendCollabMessage('collab_status', { status: 'closed' });

            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }

            this.ws.close();
            this.ws = null;
        }
        this.fileId = null;
    }

    /**
     * 发送协同消息
     * @param {string} type - 消息类型
     * @param {Object} data - 消息数据
     */
    sendCollabMessage(type, data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: type,
                data: data,
                timestamp: new Date().toISOString()
            }));
        }
    }

    /**
     * 注册消息处理器
     * @param {string} messageType - 消息类型
     * @param {Function} handler - 处理函数
     */
    on(messageType, handler) {
        this.messageHandlers[messageType] = handler;
    }

    /**
     * 发送用户输入状态
     * @param {boolean} isTyping - 是否正在输入
     * @param {Object} cursorPosition - 光标位置
     */
    sendTypingStatus(isTyping, cursorPosition = null) {
        this.sendCollabMessage('user_typing', {
            is_typing: isTyping,
            cursor_position: cursorPosition
        });
    }

    /**
     * 发送光标位置更新
     * @param {Object} cursor - 光标信息 {line, column, offset}
     */
    sendCursorUpdate(cursor) {
        this.sendCollabMessage('cursor_update', { cursor });
    }

    /**
     * 发送选区更新
     * @param {Object} selection - 选区信息 {start, end, text}
     */
    sendSelectionUpdate(selection, color = '#409EFF') {
        this.sendCollabMessage('selection_update', {
            selection,
            color
        });
    }

    /**
     * 发送协同聊天消息
     * @param {string} content - 消息内容
     * @param {string} replyToId - 回复的消息 ID (可选)
     * @param {Array} mentions - @提及的用户列表 (可选)
     */
    sendChatMessage(content, replyToId = null, mentions = []) {
        this.sendCollabMessage('chat_message', {
            content,
            reply_to_id: replyToId,
            mentions
        });
    }

    /**
     * 启动心跳
     */
    startHeartbeat(interval = 30000) {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.sendCollabMessage('heartbeat', {
                    timestamp: new Date().toISOString()
                });
            }
        }, interval);
    }

    // ============ 内部事件处理 ============

    _onOpen() {
        console.log('✅ 协同编辑 WebSocket 连接成功');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;

        // 启动心跳
        this.startHeartbeat();

        // 通知已连接
        if (this.messageHandlers['connected']) {
            this.messageHandlers['connected']({
                fileId: this.fileId,
                timestamp: new Date().toISOString()
            });
        }
    }

    _onMessage(event) {
        try {
            const message = JSON.parse(event.data);
            const messageType = message.type;

            console.log(`📨 收到协同消息: ${messageType}`, message);

            // 调用注册的处理器
            if (this.messageHandlers[messageType]) {
                this.messageHandlers[messageType](message.data, message.timestamp);
            }

            // 🔧 关键: 调用 cloudApp 的 handleCollabMessage
            if (this.cloudApp?.handleCollabMessage) {
                this.cloudApp.handleCollabMessage(message);
            }

        } catch (error) {
            console.error('❌ 解析协同消息失败:', error);
        }
    }

    _onClose(event) {
        console.log(`🔌 协同编辑 WebSocket 断开: ${event.code} ${event.reason}`);

        // 自动重连
        if (this.fileId && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectDelay * 1.5, 10000);

            console.log(`🔄 ${this.reconnectAttempts}/${this.maxReconnectAttempts} 尝试重连 (${Math.round(delay)}ms)...`);

            setTimeout(() => {
                this.connect(this.fileId);
            }, delay);
        }
    }

    _onError(error) {
        console.error('❌ 协同编辑 WebSocket 错误:', error);
    }
}