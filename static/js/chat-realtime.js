// static/js/chat-realtime.js - 聊天室实时通信、通知与推送
// 说明：本文件为 ChatClient 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ChatClient.prototype, {


    // 连接全局 WebSocket（用于接收所有聊天室的通知）
    connectGlobalWebSocket() {
        if (this.globalWs && this.globalWs.readyState === WebSocket.OPEN) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('access_token');
        let wsUrl = `${protocol}//${window.location.host}/ws/notifications/`;
        if (token) {
            wsUrl += `?token=${encodeURIComponent(token)}`;
        }

        try {
            this.globalWs = new WebSocket(wsUrl);

            this.globalWs.onopen = () => {
                console.log('Global WebSocket connected');
                this._globalWsReconnectDelay = 3000;  // 连接成功重置退避
                // 🔧 打开/重连后查询是否有待接听的来电（后台/锁屏错过的，补发并弹接听框）
                this._checkPendingCall();
            };

            this.globalWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleGlobalMessage(data);
                } catch (error) {
                    console.error('Failed to parse global WebSocket message:', error);
                }
            };

            this.globalWs.onclose = (event) => {
                console.log('Global WebSocket disconnected');
                if (event.code !== 1000) {
                    this._scheduleGlobalWsReconnect();
                }
            };

            this.globalWs.onerror = (error) => {
                console.error('Global WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to create global WebSocket:', error);
        }
    },

    // 全局 WebSocket 重连：指数退避 + 随机抖动，避免服务重启后集中重连触发 WAF 限流
    _scheduleGlobalWsReconnect() {
        if (!navigator.onLine) return;
        clearTimeout(this._globalWsReconnectTimer);
        var base = Math.max(3000, this._globalWsReconnectDelay || 3000);
        var delay = Math.round(base * (0.6 + Math.random() * 0.8));
        if (document.hidden) delay = Math.min(120000, delay * 2);
        this._globalWsReconnectDelay = Math.min(60000, Math.round(base * 1.8));
        var self = this;
        this._globalWsReconnectTimer = setTimeout(function () {
            if (!self.globalWs || self.globalWs.readyState > WebSocket.OPEN) {
                self.connectGlobalWebSocket();
            }
        }, Math.max(3000, delay));
    },

    // 查询待接听的来电：后台/锁屏期间错过的来电，回到前台时补发并弹出接听提示框
    _checkPendingCall() {
        try {
            if (this.globalWs && this.globalWs.readyState === WebSocket.OPEN) {
                this.globalWs.send(JSON.stringify({type: 'check_pending_call'}));
            }
        } catch (e) {
            console.warn('查询待接听来电失败:', e);
        }
    },

    // 处理全局消息
    handleGlobalMessage(data) {
        switch (data.type) {
            case 'new_message':
                this.handleNewGlobalMessage(data);
                break;
            case 'unread_count_update':
                this.handleUnreadCountUpdate(data);
                break;
            case 'room_updated':
                this.handleRoomUpdated(data);
                break;
            case 'user_online_status':
                // 🔧 新增：处理用户在线状态变化
                this.handleUserOnlineStatus(data);
                break;
            // 🔧 新增：通话信令处理（直接处理，避免 callWs.send 循环）
            case 'call_offer':
            case 'call_answer':
            case 'call_end':
            case 'call_reject':
            case 'call_missed':
            case 'ice_candidate':
                this.handleCallSignaling(data);
                break;
            // 🔧 关键修复：添加 heartbeat 处理（保活消息，无需处理）
            case 'heartbeat':
                // 全局 WebSocket 心跳保活消息
                this.heartbeatCount++;
                this.lastHeartbeatTime = new Date();
                // 调试模式下可显示心跳状态
                if (localStorage.getItem('debugMode') === 'true') {
                    console.log(`[Heartbeat] ${this.heartbeatCount} - ${this.lastHeartbeatTime.toLocaleTimeString()}`);
                }
                break;
            // 🔧 新增：处理云盘协作邀请通知
            case 'collaboration_invite':
                this.handleCollaborationInvite(data);
                break;
            case 'task.notification':
                this.handleTaskNotification(data);
                break;
            case 'work_order.update':
                this.handleWorkOrderUpdate(data);
                break;
            case 'work.notification':
                if (data.event_type === 'new') {
                    if (window.WorkNotif && window.WorkNotif.onPush) {
                        window.WorkNotif.onPush(data.notification);
                    } else if (window.WorkNotif && window.WorkNotif.refreshCount) {
                        window.WorkNotif.refreshCount();
                    }
                }
                break;
            case 'collaboration_invite':
                if (window.WorkNotif && window.WorkNotif.refreshCount) {
                    window.WorkNotif.refreshCount();
                }
                break;
            default:
                console.log('Unknown global message type:', data.type, data);
        }
    },


    // 处理新消息通知（全局WebSocket）
    handleNewGlobalMessage(data) {
        console.log('Received global message:', data);

        const roomId = parseInt(data.chat_room);
        const isCurrentRoom = this.currentRoomId && parseInt(this.currentRoomId) === roomId;

        // 🔧 关键修复1: 检查页面是否可见/聚焦，决定是否显示桌面通知
        const isPageVisible = document.visibilityState === 'visible';
        const isPageFocused = document.hasFocus();
        const shouldShowDesktopNotification = !isPageVisible || !isPageFocused;

        // 🔧 更新聊天室列表中的未读数和最后一条消息
        let room = this.chatRooms.find(r => parseInt(r.id) === roomId);

        if (room) {
            // 更新最后一条消息
            room.last_message = {
                content: data.content,
                timestamp: data.timestamp,
                sender: data.sender,
                message_type: data.message_type
            };
            room.updated_at = data.timestamp;

            // 🔧 新增：检测@提及并标记聊天室
            const currentUserIdStr = this.currentUser?.id?.toLocaleString();

            // 1. 处理 @我
            if (data.mentioned_users && Array.isArray(data.mentioned_users)) {
                if (currentUserIdStr && data.mentioned_users.includes(currentUserIdStr)) {
                    room.has_unread_mention = true;
                }
            }

            // 2. 处理 @所有人 (优先后端标记，其次内容匹配)
            if (data.is_mention_all === true || (data.content && data.content.includes('@所有人'))) {
                room.has_mention_all = true;
                room.has_unread_mention = true; // 保持触发渲染逻辑
            } else if (data.mentioned_all) {
                // 兼容旧字段或特定标记
                this.has_mention_all = true; // 注意：这里似乎是想设置全局状态，但通常应设置在 room 上
                room.has_mention_all = true;
            }

            // 3. 群公告消息：标记该群有未读公告（群聊顶部会出现未读入口）
            if (data.message_type === 'announcement') {
                room.has_unread_announcement = true;
                if (this.currentRoomId && parseInt(this.currentRoomId) === roomId) {
                    this._renderGroupAnnounceBar(room);
                }
            }

            // 🔧 关键修复：异步获取后端准确的未读数，避免前端计数误差
            this.fetchUnreadCountForRoom(roomId).then(unreadCount => {
                // 重新渲染聊天室列表
                this.renderChatRooms();
                this.renderGroups();
            });


        } else {
            // 聊天室不存在，重新加载列表
            this.loadChatRooms();
            return; // 如果房间不存在，后续逻辑可能无法准确执行，提前返回或继续取决于需求，这里选择继续执行通知逻辑
        }

        // 🔧 关键修复2: 播放提示音（全局）
        if (this.shouldPlayNotificationSound()) {
            this.playNotificationSound();
        }

        // 🔧 关键修复3: 非当前聊天室处理（震动、未读数、通知）
        if (!isCurrentRoom) {
            // 触发震动（移动端）
            this.vibrateOnNewMessage();

            // 更新本地未读数（作为后端数据返回前的临时展示，或者如果后端不返回精确未读数时的兜底）
            // 注意：fetchUnreadCountForRoom 是异步的，这里先+1保证UI即时反馈，随后会被后端数据覆盖修正
            if (room) {
                room.unread_count = (room.unread_count || 0) + 1;
                this.renderChatRooms();
                this.renderGroups();

                // 更新应用角标
                const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                this.updateAppBadge(totalUnread);
            }

            // 决定显示哪种通知
            if (shouldShowDesktopNotification && this.shouldShowDesktopNotification()) {
                // 场景A: 页面不可见/失焦 -> 显示系统桌面通知
                console.log('页面不可见/失焦，显示桌面通知');
                this.showNotification(
                    data.sender?.real_name || data.sender?.username || data.sender_name || '新消息',
                    {
                        data: data,
                        body: data.content,
                        icon: data.sender?.avatar_url || '/static/images/default-avatar.png',
                        requireInteraction: Utils.isMobile() ? false : true, // 移动端不强制交互，PC端强制
                        silent: false,
                        tag: `chat-${roomId}-${Date.now()}`
                    }
                );
            } else {
                // 场景B: 页面可见且聚焦 -> 显示页面内通知横幅
                this.showMessageNotification(data, {
                    chat_room_id: roomId,
                    sender_name: data.sender?.real_name || data.sender?.username || '未知用户',
                    avatar_url: data.sender?.avatar_url,
                    is_current_room: false,
                    room_type: data.room_type || 'private'
                });
            }
        } else {
            // 场景C: 是当前聊天室
            // 如果页面不可见（例如最小化但当前选中的是这个房间），依然可能需要系统通知提醒用户有新消息
            if (shouldShowDesktopNotification && this.shouldShowDesktopNotification()) {
                this.showNotification(
                    '新消息',
                    {
                        data: data,
                        body: data.content,
                        icon: data.sender?.avatar_url || '/static/images/default-avatar.png',
                        requireInteraction: false
                    }
                );
            }
            // 如果页面可见，通常不需要额外通知，因为消息会直接渲染在聊天窗口中
        }
    },


    // 处理未读数更新
    handleUnreadCountUpdate(data) {
        console.log('handleUnreadCountUpdate: ', data)
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(data.chat_room_id));
        if (room) {
            // 🔧 关键修复：直接使用后端返回的未读数
            room.unread_count = data.unread_count || 0;
            this.renderChatRooms();
            this.renderGroups();

            // 如果是当前聊天室，更新徽章
            if (this.currentRoomId === parseInt(data.chat_room_id)) {
                this.updateUnreadBadge();
            }
        }
    },

    // 处理聊天室更新
    // 🔧 替换原有的 handleRoomUpdated 方法
    handleRoomUpdated(data) {
        const roomIndex = this.chatRooms.findIndex(r => parseInt(r.id) === parseInt(data.room_id));
        if (roomIndex === -1) return;

        let currentRoom = this.chatRooms[roomIndex];
        const updatedData = data.room || {};

        currentRoom.unread_count = Math.max(currentRoom.unread_count - 1, 0);

        // 🔑 关键修复：保留本地未读数，防止被跨用户上下文的序列化值覆盖（如撤回、更新群名等操作）
        //   置顶 / 免打扰 / 未读群公告同样是「按用户」的个人状态，广播方用的是其自身上下文，
        //   若直接合并会把操作人的状态覆盖到接收方，这里一并保留本地值。
        const preservedUnread = currentRoom.unread_count || 0;
        const hasMentionAll = currentRoom.has_mention_all
        const hasUnreadMention = currentRoom.has_unread_mention
        const isPinned = currentRoom.is_pinned
        const isMuted = currentRoom.is_muted
        const hasUnreadAnnounce = currentRoom.has_unread_announcement

        this.chatRooms[roomIndex] = {
            ...currentRoom,
            ...updatedData,
            unread_count: preservedUnread, // 强制覆盖可能错误的未读数
            has_mention_all: hasMentionAll,
            has_unread_mention: hasUnreadMention,
            is_pinned: isPinned,
            is_muted: isMuted,
            // 群公告未读：以本地为准（广播方上下文无法代表接收方）
            has_unread_announcement: hasUnreadAnnounce
        };

        this.renderChatRooms();
        this.renderGroups();
    },


    // 连接 WebSocket
    connectWebSocket(roomId) {
        console.log('连接 WebSocket roomId:', roomId);

        // 关闭旧的聊天室连接
        if (this.roomWs) {
            // this.roomWs.close();
            this.roomWs.close(1000, 'Switching room');
            this.roomWs = null;
        }

        if (this.ws) {
            console.log('关闭旧 WebSocket 连接');
            this.ws.close(1000, 'Switching room');
            this.ws = null;
        }

        // 防止重复连接
        if (parseInt(this.currentRoomId) === parseInt(roomId) && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket 已连接到该聊天室:', roomId);
            return;
        }

        // 🔧 关键修复：生成连接序号。每次建立连接（切换聊天室 / 重连）都会递增，
        //    用于作废旧连接的迟到回调——避免网络不稳定时旧聊天室的延时重连把
        //    currentRoomId 改回旧房间，导致用户在新聊天室发送却发到了旧聊天室。
        const seq = (this._wsSeq = (this._wsSeq || 0) + 1);

        this.currentRoomId = parseInt(roomId);
        this.isConnected = false;

        // 获取协议（http/https）
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = localStorage.getItem('access_token');

        // 在 URL 中传递 token（Channels 支持这种方式）
        let wsUrl = `${protocol}//${window.location.host}/ws/chat/${roomId}/`;
        if (token) {
            wsUrl += `?token=${encodeURIComponent(token)}`;
        }

        try {
            this.ws = new WebSocket(wsUrl);
            // 记录该 socket 所属聊天室与序号，供发送与回调校验
            this.ws._roomId = parseInt(roomId);
            this.ws._seq = seq;

            // 🔧 关键修复：添加连接超时
            const connectionTimeout = setTimeout(() => {
                if (this.ws && this.ws._seq === seq && this.ws.readyState === WebSocket.CONNECTING) {
                    console.warn('WebSocket connection timeout');
                    this.ws.close();
                    this.showError('WebSocket 连接超时，请检查网络连接');
                }
            }, 10000); // 10 秒超时


            this.ws.onopen = () => {
                clearTimeout(connectionTimeout);
                if (!this.ws || this.ws._seq !== seq) { // 迟到的旧连接，直接关闭
                    if (this.ws) this.ws.close(1000);
                    return;
                }
                console.log('WebSocket connected successfully roomId: ', roomId);
                this._roomWsReconnectDelay = 3000;  // 连接成功重置退避
                this.isConnected = true;
                this.updateConnectionStatus(true);
                // 发送队列中的消息
                this.sendQueuedMessages();
            };

            this.ws.onmessage = (event) => {
                if (!this.ws || this.ws._seq !== seq) return; // 忽略旧连接消息，避免错乱渲染
                try {
                    let data = JSON.parse(event.data);

                    data = this.decryptPacket(data);

                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                clearTimeout(connectionTimeout);
                if (!this.ws || this.ws._seq !== seq) return; // 旧连接关闭，忽略
                console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
                this.isConnected = false;
                this.updateConnectionStatus(false);

                // 只有当前聊天室且连接被异常断开时才延时重连；
                // 重连前再次校验序号，避免切换聊天室后旧的重连把 currentRoomId 改回旧房间。
                // 采用指数退避 + 随机抖动，避免服务重启时所有页面每 3 秒集中重连。
                if (parseInt(this.currentRoomId) === parseInt(roomId) && event.code !== 1000) {
                    var base = Math.max(3000, this._roomWsReconnectDelay || 3000);
                    var delay = Math.round(base * (0.6 + Math.random() * 0.8));
                    if (document.hidden) delay = Math.min(120000, delay * 2);
                    this._roomWsReconnectDelay = Math.min(60000, Math.round(base * 1.8));
                    var self = this;
                    console.log('Attempting to reconnect in ' + Math.max(3000, delay) + 'ms...');
                    setTimeout(function () {
                        if (self._wsSeq === seq) {
                            self.connectWebSocket(roomId);
                        }
                    }, Math.max(3000, delay));
                }
            };

            this.ws.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('WebSocket error:', error);
                this.isConnected = false;
                // 不要在这里 close()，让 onclose 处理
            };
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.showError('WebSocket 连接失败，请检查网络连接');
        }
    },


    // 🔧 关键修复：页面卸载时正确关闭 WebSocket
    beforeUnload() {
        // 常规聊天 WebSocket 关闭
        if (this.ws) {
            this.ws.close(1000, 'Page unload');
            this.ws = null;
        }
        if (this.globalWs) {
            this.globalWs.close(1000, 'Page unload');
            this.globalWs = null;
        }

        // 🔑 关键修复：如果正在通话中，强制发送结束信令并清理资源
        if (this.callState !== 'idle' && this.callState !== 'ended') {
            console.log('🚨 页面卸载/刷新，正在安全结束通话...');
            const duration = this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;

            // 1. 尝试同步发送 WebSocket 结束信令（现代浏览器在 unload 阶段支持同步 send）
            if (this.callWs && this.callWs.readyState === WebSocket.OPEN) {
                try {
                    this.callWs.send(JSON.stringify({
                        type: 'call_end',
                        room_id: this.callRoomId,
                        from_user_id: this.currentUser?.id,
                        duration: duration,
                        media_type: this.callType || 'audio',
                        reason: 'page_unload'
                    }));
                    console.log('✅ 已发送 call_end 信令');
                } catch (e) {
                    console.warn('⚠️ 发送 call_end 失败:', e);
                }
                this.callWs.close(1000, 'Page unload');
            }

            // 2. 清理本地状态（skipSignal=true 因为已手动发送）
            this.endCall(true);
        }
    },

    // 🔧 新增：在 init() 方法末尾调用此监听器（兼容 iOS Safari）
    setupPageUnloadListener() {
        const handlePageUnload = () => this.beforeUnload();

        // 🔑 pagehide 是 iOS Safari 最可靠的卸载事件
        window.addEventListener('pagehide', handlePageUnload);
        window.addEventListener('beforeunload', handlePageUnload);

        // 可选：监听后台状态，防止锁屏杀进程
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.callState !== 'idle') {
                console.log('📱 页面进入后台，通话保持心跳保活');
            }
        });
    },

    // 处理 WebSocket 消息
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'chat_message':
                this.handleNewMessage(data);
                break;
            case 'task.update': // 🔧 新增：处理任务状态变更
                this.handleTaskUpdate(data);
                break;
            case 'work_order.update':
                this.handleWorkOrderUpdate(data);
                break;
            case 'message_revoked':
                this.handleMessageRevoked(data);
                break;
            case 'typing':
                this.handleTypingIndicator(data);
                break;
            case 'user_online_status':
                // 🔧 新增：处理用户在线状态变化
                this.handleUserOnlineStatus(data);
                break;
            // 🔧 关键修复：添加 heartbeat 处理（保活消息，无需处理）
            case 'heartbeat':
                // 心跳保活消息，仅用于保持连接活跃，无需任何处理
                // 后端每30秒发送一次，防止移动端锁屏断开连接
                this.heartbeatCount++;
                this.lastHeartbeatTime = new Date();
                // 调试模式下可显示心跳状态
                if (localStorage.getItem('debugMode') === 'true') {
                    console.log(`[Heartbeat] ${this.heartbeatCount} - ${this.lastHeartbeatTime.toLocaleTimeString()}`);
                }
                break;
            default:
                console.log('Unknown message type:', data.type, data);
        }
    },


    // 处理新消息（从WebSocket接收）
    handleNewMessage(data) {
        console.log('Received new message:', data);

        // 🔧 关键修复：收到对方消息时，隐藏输入指示器
        const senderId = data.sender_id ?? data.sender?.id;
        if (senderId !== this.currentUser?.id) {
            this.hideAllTypingIndicators();
        }

        // 🔧 关键修复1: 检查页面是否可见/聚焦
        const isPageVisible = document.visibilityState === 'visible';
        const isPageFocused = document.hasFocus();
        const shouldShowDesktopNotification = !isPageVisible || !isPageFocused;

        // 安全性检查：确保必要字段存在
        if (!data || !data.timestamp || !data.chat_room) {
            console.warn('Invalid message object:', data);
            return;
        }

        const currentRoomIdInt = parseInt(this.currentRoomId);
        const isOwnMessage = senderId === this.currentUser?.id;

        // 检查是否是自己发送的消息的确认回执
        if (isOwnMessage && data.temp_id) {
            const tempIndex = this.messages.findIndex(msg => msg.temp_id === data.temp_id);
            if (tempIndex !== -1) {
                // 更新为真实消息
                this.messages[tempIndex] = {
                    ...this.messages[tempIndex],
                    id: parseInt(data.message_id) || parseInt(data.id),
                    message_id: parseInt(data.message_id) || parseInt(data.id),
                    sender: data.sender,
                    sender_id: data.sender_id,
                    sender_name: data.sender_name,
                    content: data.content,
                    timestamp: data.timestamp,
                    is_read: data.is_read,
                    message_type: data.message_type,
                    file_info: data.file_info,
                    chat_room: parseInt(data.chat_room),
                    is_temp: false,
                    temp_id: undefined
                };
                this.renderChatHistory();
                return;
            }
        }

        // 检查是否需要显示时间戳
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage?.timestamp) {
            try {
                const lastTime = new Date(lastMessage.timestamp);
                const currentTime = new Date(data.timestamp);
                const timeDiff = currentTime - lastTime;
                if (timeDiff > 2 * 60 * 1000) {
                    const timeElement = this.renderTimeStamp(data.timestamp);
                    const messagesList = document.getElementById('messagesList');
                    if (messagesList && timeElement) {
                        messagesList.appendChild(timeElement);
                    }
                }
            } catch (e) {
                console.error('Error rendering timestamp:', e);
            }
        }

        // 添加到消息列表
        if (!isOwnMessage || !data.temp_id) {
            const fullMessage = {
                id: parseInt(data.message_id) || parseInt(data.id) || Date.now(),
                message_id: parseInt(data.message_id) || parseInt(data.id),
                sender: data.sender,
                sender_id: data.sender_id,
                sender_name: data.sender_name,
                content: data.content,
                timestamp: data.timestamp,
                is_read: data.is_read,
                message_type: data.message_type,
                file_info: data.file_info,
                chat_room: parseInt(data.chat_room),
                quote_message_id: data.quote_message_id,
                quote_content: data.quote_content,
                quote_sender: data.quote_sender,
                quote_sender_id: data.quote_sender_id,
                quote_timestamp: data.quote_timestamp,
                quote_message_type: data.quote_message_type,
                // 🔧 新增：接收后端广播的文件信息，用于富媒体渲染
                quote_file_info: data.quote_file_info || null,
                // 🔧 关键修复：添加通话相关字段
                call_duration: data.call_duration || 0,
                call_type: data.call_type || null,
                call_status: data.call_status || 'completed',
                // 🔧 卡片数据（任务/审批/群工单）
                task_data: data.task_data || null,
                approval_data: data.approval_data || null,
                work_order_data: data.work_order_data || null,
                is_temp: false
            };
            this.messages.push(fullMessage);
        }

        // 查找当前房间信息
        let currentRoom = null;
        if (this.chatRooms && this.currentRoomId) {
            currentRoom = this.chatRooms.find(r => parseInt(r.id) === currentRoomIdInt);
        }

        // 私聊房间在线状态更新
        if (currentRoom?.room_type === 'private' && this.currentUser) {
            const otherMember = currentRoom.members.find(m => m.id !== this.currentUser.id);
            const isOnline = otherMember?.online_status?.is_online;
            this.updateConnectionStatus(isOnline, 'chatSubtitle');
        }

        // 判断是否为当前聊天室的消息
        if (senderId !== this.currentUser?.id) {
            if (this.currentRoomId && parseInt(data.chat_room) === currentRoomIdInt) {
                // 当前聊天室，标记为已读
                data.is_read = true;
                this.renderMessage(data, 'received');

                // 🔧 关键修复2: 当前聊天室但页面不可见，显示桌面通知
                if (shouldShowDesktopNotification && this.shouldShowDesktopNotification()) {
                    console.log('当前聊天室但页面不可见，显示桌面通知');
                    this.showNotification(
                        '新消息',
                        {
                            data: data,
                            body: data.content,
                            icon: data.sender?.avatar_url || '/static/images/default-avatar.png',
                            requireInteraction: false
                        }
                    );
                }
            } else {
                // 非当前聊天室
                this.renderMessage(data, 'received');
                this.vibrateOnNewMessage();

                // 更新未读数
                const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(data.chat_room));
                if (room) {
                    room.unread_count = (room.unread_count || 0) + 1;
                    this.renderChatRooms();
                    this.renderGroups();

                    const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                    this.updateAppBadge(totalUnread);
                }

                // 🔧 关键修复3: 非当前聊天室且页面不可见，显示桌面通知
                if (shouldShowDesktopNotification && this.shouldShowDesktopNotification()) {
                    console.log('非当前聊天室且页面不可见，显示桌面通知');
                    this.showNotification(
                        data.sender?.real_name || data.sender?.username || '新消息',
                        {
                            data: data,
                            body: data.content,
                            icon: data.sender?.avatar_url || '/static/images/default-avatar.png',
                            requireInteraction: true
                        }
                    );
                } else {
                    // 页面可见但非当前聊天室，显示页面内通知
                    this.showMessageNotification(data, {
                        chat_room_id: data.chat_room,
                        sender_name: data.sender?.real_name || data.sender?.username || '未知用户',
                        avatar_url: data.sender?.avatar_url,
                        is_current_room: false,
                        room_type: data.room_type || 'private'
                    });
                }
            }

            // 播放提示音
            if (this.shouldPlayNotificationSound()) {
                this.playNotificationSound();
            }

            // 🔧 关键修复4: 更新未读数（仅非当前聊天室）
            if (!this.currentRoomId || parseInt(data.chat_room) !== currentRoomIdInt) {
                this.updateChatRoomUnreadCount(data.chat_room, 1);
            }
        } else if (!data.temp_id) {
            // 自己发送的消息
            this.renderMessage(data, 'sent');
        }

        // 如果是当前聊天室的消息，滚动到底部
        if (this.currentRoomId && parseInt(data.chat_room) === currentRoomIdInt) {
            Utils.scrollToBottom(document.getElementById('messagesList'));
            console.log('如果是当前聊天室的消息，滚动到底部, 标记消息为已读');
            this.markMessagesAsRead(this.currentRoomId);
        }

        // 更新聊天室最后一条消息
        this.updateChatRoomLastMessage(data.chat_room, data.content, data.timestamp);
    },


    // 处理消息撤回事件（接收方实时更新）
    handleMessageRevoked(data) {
        console.log('handleMessageRevoked:', data);
        const {message_id, revoked_at, sender_id, sender_name, chat_room_id, room_type} = data;

        // 查找并更新本地消息
        const messageIndex = this.messages.findIndex(msg =>
            msg.id === message_id ||
            msg.message_id === message_id
        );

        if (messageIndex !== -1) {
            this.messages[messageIndex].content = '[消息已撤销]';
            this.messages[messageIndex].is_deleted = true;
            this.messages[messageIndex].deleted_at = revoked_at || new Date().toISOString();

            // 重新渲染消息列表
            this.renderChatHistory();

            // 显示提示（如果不是自己撤销的）
            if (sender_id !== this.currentUser.id) {
                if (room_type !== 'private') {
                    this.showSuccess(`${sender_name} 撤回了一条群组消息`);
                } else {
                    this.showSuccess('对方撤回了一条消息');
                }

            }
        }

        // 🔧 关键修复12: 实时更新聊天室列表中的最后一条消息
        if (chat_room_id) {
            // // 重新加载该聊天室信息以获取最新的最后一条消息
            // this.loadSingleChatRoom(chat_room_id).then(room => {
            //     console.log('loadSingleChatRoom room:', room);
            //     if (room) {
            //         // 更新本地聊天室数据
            //         const roomIndex = this.chatRooms.findIndex(r => r.id === parseInt(chat_room_id));
            //         if (roomIndex !== -1) {
            //             this.chatRooms[roomIndex] = room;
            //             this.renderChatRooms();
            //             this.renderGroups();
            //         }
            //     }
            // }).catch(error => {
            //     console.error('加载聊天室失败:', error);
            //     // 降级处理：标记需要刷新
            //     const room = this.chatRooms.find(r => r.id === parseInt(chat_room_id));
            //     if (room) {
            //         room.needs_refresh = true;
            //         this.renderChatRooms();
            //         this.renderGroups();
            //     }
            // });

            // 方案2（可选优化）: 只更新特定聊天室的最后消息
            this.updateChatRoomLastMessageAfterRevoke(chat_room_id);

        }
    },


    // 检测连接是否异常（连续3次未收到心跳）
    checkConnectionHealth() {
        const now = new Date();
        const timeSinceLastHeartbeat = now - this.lastHeartbeatTime;

        if (timeSinceLastHeartbeat > 5 * 3) { // 15秒未收到心跳
            console.warn('WebSocket 连接可能已断开，尝试重连...');
        }
    },

    // 加载单个聊天室信息
    async loadSingleChatRoom(roomId) {
        try {
            const response = await fetch(`/api/chat/rooms/${roomId}/`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                throw new Error('加载聊天室失败');
            }

            return await response.json();
        } catch (error) {
            console.error('加载单个聊天室失败:', error);
            return null;
        }
    },


    // 🔧 新增：撤回后更新聊天室最后消息（优化方案）
    async updateChatRoomLastMessageAfterRevoke(roomId) {
        try {
            // 构建查询参数
            const params = new URLSearchParams({
                chat_room_id: roomId,
                page_size: '1'
            });
            // 获取聊天室最新消息（排除已撤回的消息）
            const response = await fetch(`/api/chat/messages/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                const data = await response.json();

                // 🔧 关键修复：解密后端返回的加密数据
                let results = this._decryptMessageResults(data.results);

                // 如果解密后没有 results 字段，尝试直接使用 data
                if (!results && data.results) {
                    results = data.results;
                } else if (!results && Array.isArray(data)) {
                    results = data;
                }

                // 确保 results 是数组
                let newMessages = Array.isArray(results) ? results : (results ? [results] : []);

                const latestMessage = newMessages ? newMessages?.[0] : {};

                const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
                if (room && latestMessage) {
                    // 更新最后一条消息
                    room.last_message = {
                        content: latestMessage.content,
                        timestamp: latestMessage.timestamp,
                        sender: latestMessage.sender,
                        message_type: latestMessage.message_type
                    };
                    room.updated_at = latestMessage.timestamp;
                    console.log('roomId：', roomId)
                    console.log('chatRooms: ', this.chatRooms)
                    this.renderChatRooms();
                    this.renderGroups();
                } else if (room) {
                    // 没有消息了，清空最后消息
                    room.last_message = null;
                    room.updated_at = new Date().toISOString();
                    this.renderChatRooms();
                    this.renderGroups();
                }
            }
        } catch (error) {
            console.error('更新撤回后最后消息失败:', error);
            // 降级：重新加载整个列表
            await this.loadChatRooms();

        }
    },


    // 检查是否应该播放提示音
    shouldPlayNotificationSound() {
        console.log('shouldPlayNotificationSound localStorage: ', localStorage.getItem('soundNotifications'));
        // 检查全局声音提醒设置
        const soundNotifications = localStorage.getItem('soundNotifications') !== 'false';

        console.log("soundNotifications: ", soundNotifications)
        console.log("this.currentRoomId: ", this.currentRoomId)

        // 检查当前聊天室是否免打扰
        if (this.currentRoomId) {
            const currentRoom = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
            if (currentRoom?.is_muted) {
                console.log('当前聊天室免打扰，不播放提示音 currentRoom: ', currentRoom)
                return false;  // 免打扰状态下不播放提示音
            }
        }

        return soundNotifications;
    },

    // 检查是否应该显示桌面通知
    shouldShowDesktopNotification() {
        // 🔧 关键修复1: 检查通知权限
        // if (Notification.permission !== 'granted') {
        //     console.log('未授权通知权限');
        //     return false;
        // }

        // 检查全局桌面通知设置
        const desktopNotifications = localStorage.getItem('desktopNotifications') !== 'false';

        // 检查当前聊天室是否免打扰
        if (this.currentRoomId) {
            const currentRoom = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
            if (currentRoom && currentRoom?.is_muted) {
                return false;  // 免打扰状态下不显示通知
            }
        }

        // 🔧 关键修复2: 移动端特殊处理 - 锁屏/后台也显示通知
        if (Utils.isMobile()) {
            // 页面不可见时强制显示通知
            if (document.visibilityState !== 'visible') {
                return desktopNotifications;
            }

            // 页面可见但失焦（如切换到其他App）也显示通知
            if (!document.hasFocus()) {
                return desktopNotifications;
            }
        }


        return desktopNotifications;
    },

    // 确保已订阅 Web Push（已授权且有 token 时执行；未订阅会自动补订）
    ensurePushSubscribed() {
        // 🔧 用户在「个人设置 → 通知设置」中关闭桌面通知后，不再自动补订 Web Push，
        //    否则关闭动作会被随后的自动重订阅覆盖，导致「关闭不生效」。
        if (localStorage.getItem('desktopNotifications') === 'false') {
            return;
        }
        if (window.PushNotifier && window.PushNotifier.supported() &&
            'Notification' in window && Notification.permission === 'granted' &&
            localStorage.getItem('access_token')) {
            // 当前浏览器支持推送：清除历史「不支持」标记（用户可能已换到支持推送的浏览器）
            try {
                localStorage.removeItem('pushUnsupported');
            } catch (ignore) {
            }
            window.PushNotifier.subscribe(true);
        }
    },

    // 🔧 订阅自动补订：服务端 token 因 410 被清理后，设备端订阅可能已失效或未同步，
    // 定时重试 subscribe（幂等），直到服务端重新建立订阅，避免安卓/鸿蒙长期 subs=0。
    // 一旦判定当前浏览器不支持推送（pushUnsupported）即停止，避免无限空转。
    _startPushSubscribeRetry() {
        if (this._pushRetryTimer) return;
        if (localStorage.getItem('pushUnsupported')) return;
        let attempts = 0;
        const doRetry = () => {
            if (localStorage.getItem('pushUnsupported')) {
                clearInterval(this._pushRetryTimer);
                this._pushRetryTimer = null;
                return;
            }
            attempts++;
            // 用户关闭桌面通知时停止自动重订阅
            if (localStorage.getItem('desktopNotifications') === 'false') {
                clearInterval(this._pushRetryTimer);
                this._pushRetryTimer = null;
                return;
            }
            if ('Notification' in window && Notification.permission === 'granted' &&
                window.PushNotifier && window.PushNotifier.supported() &&
                localStorage.getItem('access_token')) {
                try {
                    localStorage.removeItem('pushUnsupported');
                } catch (ignore) {
                }
                window.PushNotifier.subscribe(true);
            }
            if (attempts >= 6) { // 最多重试 6 次（约 60 秒），后续由可见性/登录兜底
                clearInterval(this._pushRetryTimer);
                this._pushRetryTimer = null;
            }
        };
        this._pushRetryTimer = setInterval(doRetry, 10000);
    },

    // 请求通知权限（必须在用户手势中触发，iOS 尤其要求如此）
    requestNotificationPermission() {
        if (!('Notification' in window)) return;
        // 避免重复请求
        if (this.notificationPermissionRequested || Notification.permission !== 'default') {
            return;
        }

        this.notificationPermissionRequested = true;

        // 等待用户首次交互后再请求权限（iOS 无手势调用会不弹窗甚至影响后续授权）
        const requestPermission = () => {
            Notification.requestPermission().then(permission => {
                console.log('Notification permission:', permission);

                // 权限被拒绝时显示友好提示
                if (permission === 'denied') {
                    this.showNotificationPermissionHint();
                } else if (permission === 'granted') {
                    // 授权后同时订阅 Web Push（锁屏/后台也能收到消息）
                    this.ensurePushSubscribed();
                }

                // 移除事件监听（只请求一次）
                document.removeEventListener('click', requestPermission);
                document.removeEventListener('touchstart', requestPermission);
            }).catch(() => {
                document.removeEventListener('click', requestPermission);
                document.removeEventListener('touchstart', requestPermission);
            });
        };

        // 监听用户交互
        document.addEventListener('click', requestPermission, {once: true});
        document.addEventListener('touchstart', requestPermission, {once: true});
    },

    // 显示通知权限提示（权限被拒绝时）
    showNotificationPermissionHint() {
        // 检查是否已显示过提示（避免重复）
        if (localStorage.getItem('notificationHintShown')) return;

        const hint = document.createElement('div');
        hint.className = 'notification-hint';
        hint.innerHTML = `
        <div class="hint-content">
            <i class="fas fa-bell"></i>
            <div class="hint-text">
                <strong>开启桌面通知</strong><br>
                不错过重要消息，即使页面在后台或手机锁屏
            </div>
            <button class="hint-btn" id="enableNotificationsBtn">开启</button>
            <button class="hint-close" id="closeHintBtn">×</button>
        </div>
    `;
        document.body.appendChild(hint);

        // 绑定事件
        document.getElementById('enableNotificationsBtn').onclick = () => {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    hint.remove();
                    this.showSuccess('通知已开启');
                } else {
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                    if (isIOS && permission === 'denied') {
                        this.showInfo('iOS 需在「设置 → 通知」中找到本应用并手动允许通知');
                    } else {
                        this.showInfo('请在浏览器设置中手动开启通知权限');
                    }
                }
            });
        };

        document.getElementById('closeHintBtn').onclick = () => {
            hint.remove();
            localStorage.setItem('notificationHintShown', 'true');
        };

        // 10秒后自动隐藏
        setTimeout(() => {
            if (hint.parentNode) {
                hint.remove();
                localStorage.setItem('notificationHintShown', 'true');
            }
        }, 10000);
    },


    // 🔧 PWA 安装：Android / Chromium（含鸿蒙浏览器）会触发 beforeinstallprompt，
    // 用它提供"一键安装到桌面"按钮；iOS 走 Safari「添加到主屏幕」。
    initInstallPrompt() {
        try {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredInstallPrompt = e;
                this._updateInstallPromptUI();
            });
            window.addEventListener('appinstalled', () => {
                this.deferredInstallPrompt = null;
                this.hideInstallPromptUI();
                this.showSuccess('应用已安装，欢迎使用企业聊天室 App');
            });

            // 右上角菜单「安装到桌面」入口
            const installMenu = document.getElementById('installAppBtn');
            if (installMenu) {
                installMenu.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const menu = document.getElementById('userDropdownMenu');
                    if (menu) menu.classList.remove('show');
                    this._promptInstall();
                };
            }
        } catch (e) {
            console.warn('PWA install prompt 不支持:', e);
        }
    },

    _updateInstallPromptUI() {
        const installBtn = document.getElementById('pwaGuideInstall');
        const installMenu = document.getElementById('installAppBtn');
        const isStandalone = window.navigator.standalone === true ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        if (isStandalone || this._installed) {
            if (installBtn) installBtn.style.display = 'none';
            if (installMenu) installMenu.style.display = 'none';
            return;
        }
        // 无论是否有 beforeinstallprompt 都提供入口：
        // 有则走原生安装弹窗，无则点按后经 _promptInstall() 给平台化引导（如 iOS/夸克/鸿蒙）
        if (installBtn) installBtn.style.display = 'inline-block';
        if (installMenu) installMenu.style.display = 'flex';
    },

    hideInstallPromptUI() {
        this.deferredInstallPrompt = null;
        this._installed = true;
        this._updateInstallPromptUI();
        const banner = document.getElementById('pwaGuideBanner');
        if (banner) banner.classList.remove('show');
    },

    // 🔧 浏览器/平台识别（用于安装与推送引导）
    detectBrowser() {
        const ua = navigator.userAgent || '';
        if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'ios-safari';
        if (/HuaweiBrowser|PetalBrowser|TASBrowser/i.test(ua)) return 'huawei-harmony';
        if (/Quark/i.test(ua)) return 'quark';
        if (/Edg\//i.test(ua)) return 'edge';
        if (/Chrome\//i.test(ua)) return 'chrome';
        if (/HarmonyOS/i.test(ua)) return 'huawei-harmony';
        return 'other';
    },

    // 安装不可用时的引导（不同浏览器菜单不同）
    showInstallGuidance() {
        const browser = this.detectBrowser();
        const msgs = {
            'ios-safari': '请使用 Safari 底部「分享」按钮 → 「添加到主屏幕」',
            'chrome': '请点击浏览器右上角「⋮」菜单 → 「安装应用」',
            'edge': '请点击浏览器右上角「…」菜单 → 「应用」→「安装此网站为应用」',
            'quark': '请点击夸克浏览器菜单 → 「添加到桌面」',
            'huawei-harmony': '请使用浏览器菜单 → 「添加到主屏幕」（快捷方式）；如需收到推送通知，请改用 Chrome 或夸克浏览器打开并安装',
            'other': '请使用浏览器菜单 → 「安装应用 / 添加到主屏幕 / 添加到桌面」'
        };
        this.showInfo(msgs[browser] || msgs['other']);
    },

    async _promptInstall() {
        const promptEvent = this.deferredInstallPrompt;
        if (!promptEvent) {
            this.showInstallGuidance();
            return;
        }
        try {
            promptEvent.prompt();
            // 部分浏览器（如夸克）beforeinstallprompt 触发但 prompt() 不弹窗，
            // userChoice 永不 resolve，用超时兜底并引导走浏览器菜单。
            const timeout = new Promise(resolve => setTimeout(() => resolve({outcome: 'timeout'}), 8000));
            const choice = await Promise.race([promptEvent.userChoice, timeout]);
            this.deferredInstallPrompt = null;
            this._updateInstallPromptUI();
            if (choice && choice.outcome === 'accepted') {
                this.hideInstallPromptUI();
            } else if (choice && choice.outcome === 'timeout') {
                console.warn('浏览器未弹出安装界面，引导使用浏览器菜单');
                this.showInstallGuidance();
            }
        } catch (e) {
            console.warn('安装被取消或失败:', e);
            this.deferredInstallPrompt = null;
            this._updateInstallPromptUI();
            this.showInstallGuidance();
        }
    },

    // 🔧 PWA：移动端一次性引导（安装到桌面 + 开启通知），兼容 iOS / Android / 鸿蒙
    initPwaGuideBanner() {
        // 已安装为 App（standalone）则不显示安装引导
        const isStandalone = window.navigator.standalone === true ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        // 已授权通知：无需再引导
        if ('Notification' in window && Notification.permission === 'granted') return;
        // 已关闭过 / 点击过安装 / 授权过摄像头麦克风：刷新后不再显示，避免打扰用户
        if (localStorage.getItem('pwaGuideShown')) return;
        // 桌面大屏：安装入口在右上角菜单，不弹横幅
        if (window.innerWidth > 768) return;

        const banner = document.getElementById('pwaGuideBanner');
        if (!banner) return;

        const hide = (remember) => {
            banner.classList.remove('show');
            if (remember) localStorage.setItem('pwaGuideShown', '1');
        };

        const closeBtn = document.getElementById('pwaGuideClose');
        if (closeBtn) closeBtn.onclick = () => hide(true);

        // 平台适配：安装按钮 / 步骤文案
        const stepsEl = document.getElementById('pwaGuideSteps');
        const installBtn = document.getElementById('pwaGuideInstall');
        const browser = this.detectBrowser();
        if (installBtn) {
            if (isStandalone) {
                // 已安装为 App：隐藏安装按钮，只保留「开启通知」（standalone 下未授权时才走到这里）
                installBtn.style.display = 'none';
                if (stepsEl) stepsEl.innerHTML = '<span>开启通知后，主屏幕 / 锁屏也能实时收到消息</span>';
            } else {
                // 统一入口：有 beforeinstallprompt 走原生安装弹窗；无则点按后经 _promptInstall() 给平台化引导
                installBtn.style.display = 'inline-block';
                installBtn.onclick = () => { this._promptInstall(); this._persistPwaGuideDismissed(); };
                if (this.deferredInstallPrompt) {
                    if (stepsEl) stepsEl.innerHTML = '<span>① 点击下方「安装应用」</span><span>② 再开启通知</span>';
                } else if (browser === 'ios-safari') {
                    if (stepsEl) stepsEl.innerHTML = '<span>① Safari 分享按钮 → 添加到主屏幕</span><span>② 再开启通知</span>';
                } else if (browser === 'huawei-harmony') {
                    if (stepsEl) stepsEl.innerHTML = '<span>① 浏览器菜单 → 添加到主屏幕（快捷方式）</span><span>② 推送请用 Chrome / 夸克</span>';
                } else if (browser === 'quark') {
                    if (stepsEl) stepsEl.innerHTML = '<span>① 夸克菜单 → 添加到桌面</span><span>② 再开启通知</span>';
                } else {
                    if (stepsEl) stepsEl.innerHTML = '<span>① 浏览器菜单 → 安装应用 / 添加到主屏幕</span><span>② 再开启通知</span>';
                }
            }
        }

        // 浏览器不支持 Web Push（华为/鸿蒙自带浏览器、老版本）：明确提示换用支持推送的浏览器
        if (window.PushNotifier && !window.PushNotifier.supported()) {
            if (stepsEl) {
                if (browser === 'huawei-harmony') {
                    stepsEl.innerHTML = '<span>⚠️ 华为/鸿蒙自带浏览器不支持消息推送</span><span>仍可「添加到主屏幕」，推送请用 Chrome / 夸克</span>';
                } else {
                    stepsEl.innerHTML = '<span>⚠️ 当前浏览器不支持消息推送</span><span>仍可「添加到主屏幕」，推送请用 Chrome / Edge / 夸克</span>';
                }
            }
            const enableBtn2 = document.getElementById('pwaGuideEnable');
            if (enableBtn2) enableBtn2.style.display = 'none';
        }

        // 开启通知按钮：已授权则隐藏
        const enableBtn = document.getElementById('pwaGuideEnable');
        if (enableBtn) {
            if ('Notification' in window && Notification.permission === 'granted') {
                enableBtn.style.display = 'none';
            } else {
                enableBtn.onclick = () => {
                    if ('Notification' in window) {
                        Notification.requestPermission().then(permission => {
                            if (permission === 'granted') {
                                this.ensurePushSubscribed();
                            }
                            hide(true);
                        }).catch(() => hide(true));
                    } else {
                        hide(true);
                    }
                };
            }
        }

        // 🔧 授权摄像头/麦克风按钮（点击一次性请求通知 + 摄像头 + 麦克风权限）
        const permBtn = document.getElementById('pwaGuidePerms');
        if (permBtn) {
            permBtn.style.display = 'inline-block';
            permBtn.onclick = () => this._requestAllPermissions();
        }

        // 延迟出现，避免打断登录/首屏
        setTimeout(() => banner.classList.add('show'), 800);
    },

    // 🔧 一次性获取推送通知 + 摄像头 + 麦克风权限（供安卓/鸿蒙安装后一键授权）
    async _requestAllPermissions() {
        let granted = 0;
        // 1) 推送通知
        if ('Notification' in window && Notification.permission !== 'granted') {
            try {
                const p = await Notification.requestPermission();
                if (p === 'granted') {
                    granted++;
                    this.ensurePushSubscribed();
                }
            } catch (e) {
            }
        } else if ('Notification' in window && Notification.permission === 'granted') {
            granted++;
            this.ensurePushSubscribed();
        }
        // 2) 摄像头 + 麦克风（需要用户手势 + HTTPS）
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
                stream.getTracks().forEach(t => t.stop()); // 只授权，不持续占用设备
                granted++;
            } catch (e) {
                console.warn('摄像头/麦克风授权失败:', e);
            }
        } else {
            granted++;
        }
        if (granted >= 2) {
            this.showSuccess('通知、摄像头、麦克风权限已获取');
        } else if (granted >= 1) {
            this.showInfo('部分权限已获取，未授权的请在浏览器设置中开启');
        } else {
            this.showInfo('请允许通知与摄像头/麦克风权限（浏览器设置中可开启）');
        }
        const permBtn = document.getElementById('pwaGuidePerms');
        if (permBtn) permBtn.style.display = 'none';
        // 授权完成后关闭横幅并记忆，刷新后不再显示
        this._persistPwaGuideDismissed();
    },

    // 🔧 关闭引导横幅并持久化，刷新后不再显示
    _persistPwaGuideDismissed() {
        localStorage.setItem('pwaGuideShown', '1');
        const banner = document.getElementById('pwaGuideBanner');
        if (banner) banner.classList.remove('show');
    },

    // 初始化通知系统（在用户首次交互后）
    initNotificationSystem() {
        // 不再在页面加载时自动请求权限：
        // iOS 上无用户手势的 requestPermission 不弹窗，且可能在非安装态下影响后续授权。
        // 授权改由 requestNotificationPermission()（手势触发）与引导横幅「开启通知」按钮完成。
        if ('Notification' in window && Notification.permission === 'granted') {
            this.ensurePushSubscribed();
        }

        // 音频上下文初始化（用户交互后恢复）
        this.initAudioContext();
    },

    // 初始化音频上下文（解决 autoplay 问题）
    initAudioContext() {
        // 创建单例音频上下文
        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.audioGainNode = this.audioContext.createGain();
                this.audioGainNode.connect(this.audioContext.destination);
                this.audioGainNode.gain.value = 0.5; // 默认音量50%

                // 尝试恢复上下文（可能被暂停）
                if (this.audioContext.state === 'suspended') {
                    // 等待用户交互后恢复
                    const resumeAudio = () => {
                        if (this.audioContext && this.audioContext.state === 'suspended') {
                            this.audioContext.resume().then(() => {
                                console.log('AudioContext resumed successfully');
                            }).catch(err => {
                                console.warn('Failed to resume AudioContext:', err);
                            });
                        }
                        // 只监听一次用户交互
                        document.removeEventListener('click', resumeAudio);
                        document.removeEventListener('touchstart', resumeAudio);
                    };

                    document.addEventListener('click', resumeAudio, {once: true});
                    document.addEventListener('touchstart', resumeAudio, {once: true});
                }
            } catch (e) {
                console.warn('Failed to create AudioContext:', e);
                this.audioContext = null;
            }
        }
    },

    // 播放提示音（修复 autoplay 问题）
    playNotificationSound() {
        // 确保音频上下文已初始化
        if (!this.audioContext) {
            this.initAudioContext();
        }

        // 检查是否启用声音通知
        const soundEnabled = localStorage.getItem('soundNotifications') !== 'false';
        if (!soundEnabled) return;

        // 检查音频上下文状态
        if (this.audioContext && this.audioContext.state === 'suspended') {
            // 尝试恢复（需要用户交互）
            this.audioContext.resume().catch(err => {
                console.warn('AudioContext still suspended, cannot play sound:', err);
                // 降级：显示视觉提示
                this.showToast('🔔 有新消息', 'info');
            });
            return;
        }


        try {
            // 使用 Web Audio API 播放提示音
            if (this.audioContext) {
                // 创建振荡器生成提示音
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();

                oscillator.type = 'sine';
                oscillator.frequency.value = 800; // 800Hz
                gainNode.gain.value = 0.1;

                oscillator.connect(gainNode);
                gainNode.connect(this.audioGainNode);

                oscillator.start();
                oscillator.stop(this.audioContext.currentTime + 0.15); // 150ms 短提示音

                // 淡出效果
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);
            }
            // 降级方案：使用 Audio 元素
            else {
                if (!this.notificationAudio) {
                    this.notificationAudio = new Audio('/static/sounds/notification.mp3');
                    this.notificationAudio.volume = 0.5;
                }
                this.notificationAudio.play().catch(err => {
                    console.warn('Audio playback failed (autoplay policy):', err);
                    // 显示视觉提示作为降级
                    this.showToast('🔔 有新消息', 'info');
                });
            }
        } catch (e) {
            console.warn('Failed to play notification sound:', e);
            this.showToast('🔔 有新消息', 'info');
        }
    },


    // 增强桌面通知，支持锁屏通知（移动端），添加震动反馈和声音
    async showNotification(title, options) {
        console.log('showNotification:', title, options);
        console.log('Notification.permission: ', Notification.permission)

        // 检查通知权限
        if (Notification.permission !== 'granted') {
            // iOS 必须在用户手势中授权，这里（消息事件，非手势）不自动请求，避免影响后续授权，直接降级为页面内通知；
            // 其他平台保留自动请求作为兜底。
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
            if (!isIOS) {
                await Notification.requestPermission();
            }

            // 仍无权限，降级为页面内通知
            if (Notification.permission !== 'granted') {
                console.warn('用户拒绝了通知权限, 降级为页面内通知');
                this.showToast('未授权通知权限, 降级为页面内通知', 'error');
                this.showMessageNotification(options.data || options, {
                    chat_room_id: options.data?.chat_room_id || options.data?.chat_room,
                    sender_name: options.data?.sender?.real_name || options.data?.sender?.username || '未知用户',
                    avatar_url: options.icon,
                    is_current_room: false
                });
                // return;
            }

        }

        // // 🔧 关键修复1: 移动端锁屏通知必需参数
        // const notificationOptions = {
        //     ...options,
        //     // iOS 16.4+ 需要这些参数才能显示锁屏通知
        //     requireInteraction: Utils.isMobile() ? false : true,  // 移动端不强制交互
        //     silent: false,  // 强制播放系统通知声音
        //     tag: `chat-${options.data?.chat_room_id || options.data?.chat_room || Date.now()}`,  // 防止重复
        //     // 🔧 关键修复2: iOS PWA 锁屏通知需要 badge
        //     badge: '/static/images/notification-badge.png'
        // };
        //
        // // 创建通知
        // const notification = new Notification(title, notificationOptions);

        // // 创建通知
        const notification = new Notification(title, {
            ...options,
            icon: options.icon || '/static/images/default-avatar.png',
            badge: '/static/images/notification-badge.png', // 小图标（Android PWA）
            tag: `chat-${options.data?.chat_room_id || options.data?.chat_room || Date.now()}`, // 防止重复
            renotify: true, // 允许重复通知
            requireInteraction: Utils.isMobile() ? false : options.requireInteraction !== false, // 移动端不强制交互, 默认需要交互
            silent: false // 播放系统通知声音
        });


        // 通知点击事件
        notification.onclick = () => {
            window.focus();
            this.stopTitleBlink();
            // 如果有指定的聊天室，切换到该聊天室
            const chatRoomId = options.data?.chat_room_id || options.data?.chat_room;
            if (chatRoomId) {
                this.selectChatRoom(chatRoomId);
            }
            notification.close();
        };

        // 通知关闭后清除角标（如果所有通知都已读）
        notification.onclose = () => {
            const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
            this.updateAppBadge(totalUnread);
        };

        // 🔧 关键修复3: 移动端通知同时触发震动
        if (Utils.isMobile()) {
            this.vibrateOnNewMessage();
        }

        // 播放提示音（降级方案，系统通知可能已有声音）
        if (this.shouldPlayNotificationSound()) {
            // 延迟播放避免与系统通知声音冲突
            setTimeout(() => {
                this.playNotificationSound();
            }, 300);
        }

        // 🔧 关键修复4: 5秒后自动关闭（避免通知堆积）
        setTimeout(() => {
            try {
                notification.close();
            } catch (e) {
                // 通知可能已被用户关闭
                console.warn('通知已关闭 error: ', e);
            }
        }, 5000);

    },


    // 添加震动方法
    vibrateOnNewMessage() {
        // 仅在移动端且支持震动API时启用
        if (!('vibrate' in navigator) || !Utils.isMobile()) {
            return;
        }

        // 🔧 关键修复1: 检查用户是否已交互
        if (!this.userHasInteracted) {
            // 未交互时不震动，避免浏览器拦截
            console.warn('未交互时不震动，避免浏览器拦截');
            return;
        }

        // 检查是否启用震动提醒
        const vibrateEnabled = localStorage.getItem('vibrateNotifications') !== 'false';
        if (!vibrateEnabled) {
            return;
        }

        // 🔧 当前聊天室免打扰时不震动（与声音/桌面通知保持一致）
        if (this.currentRoomId) {
            const currentRoom = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
            if (currentRoom && currentRoom.is_muted) {
                return;
            }
        }

        try {
            // 🔧 关键修复2: 使用 try-catch 包裹，避免报错中断
            // 锁屏震动模式（长-短-长）
            navigator.vibrate([300, 100, 300]);
        } catch (error) {
            // 静默失败，不影响其他功能
            console.warn('震动失败:', error);
            // 🔧 降级方案：视觉反馈替代震动
            this.visualNotificationHint();
        }

        // 短震动提示（300ms）
        // 降级：简单震动
        // navigator.vibrate(300);
    },

    // 🔧 新增：视觉通知提示（震动不可用时的降级方案）
    visualNotificationHint() {
        // 创建临时视觉提示
        const hint = document.createElement('div');
        hint.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(64, 158, 255, 0.9);
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 13px;
        z-index: 9999;
        animation: slideIn 0.3s ease, fadeOut 0.5s ease 2s forwards;
        pointer-events: none;
    `;
        hint.innerHTML = '🔔 新消息';
        document.body.appendChild(hint);

        setTimeout(() => {
            if (hint.parentNode) {
                hint.parentNode.removeChild(hint);
            }
        }, 3000);
    },


    // 显示消息通知弹窗（页面内通知）
    showMessageNotification(message, options = {}) {
        const {
            chat_room_id,
            sender_name,
            avatar_url,
            is_current_room = false,
            room_type = 'private'
        } = options;

        console.log('showMessageNotification: ', message, options);

        // 如果是当前聊天室，不显示弹窗（仅声音/震动）
        if (is_current_room) {
            if (this.shouldPlayNotificationSound()) {
                this.playNotificationSound();
            }
            if (Utils.isIOS() || Utils.isMobile()) {
                this.vibrateOnNewMessage();
            }
            return;
        }

        // 🔧 关键修复1: 检查通知容器是否存在
        let notificationContainer = document.getElementById('notificationContainer');
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.id = 'notificationContainer';
            // 🔧 关键修复2: 移动端适配安全区域
            if (Utils.isMobile()) {
                notificationContainer.style.top = 'env(safe-area-inset-top, 20px)';
                notificationContainer.style.right = 'env(safe-area-inset-right, 20px)';
            }
            document.body.appendChild(notificationContainer);
        }

        // 🔧 关键修复3: 检查是否已有相同通知（避免重复）
        const existingNotification = notificationContainer.querySelector(`.message-notification[data-room-id="${chat_room_id}"]`);
        if (existingNotification) {
            // 更新现有通知的时间
            const timeEl = existingNotification.querySelector('.notification-time');
            if (timeEl) timeEl.textContent = Utils.formatTime(new Date());
            return;
        }

        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = 'message-notification';
        notification.innerHTML = `
        <div class="notification-avatar">
            <img src="${avatar_url || '/static/images/default-avatar.png'}" alt="${sender_name}">
        </div>
        <div class="notification-content">
            <div class="notification-header">
                <span class="notification-sender">${sender_name}的消息：</span>
                <span class="notification-time">${Utils.formatTime(new Date())}</span>
            </div>
            <div class="notification-message">${this.truncateMessage(message.content)}</div>
            <div class="notification-actions">
                <button class="notification-btn reply" data-room-id="${chat_room_id}">
                    <i class="fas fa-reply"></i> 回复
                </button>
                <button class="notification-btn view" data-room-id="${chat_room_id}">
                    <i class="fas fa-eye"></i> 查看
                </button>
            </div>
        </div>
        <button class="notification-close">
            <i class="fas fa-times"></i>
        </button>
    `;

        // 添加到通知容器
        notificationContainer.appendChild(notification);

        // 显示动画
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // 🔧 关键修复4: 移动端适配 - 确保通知在可视区域内
        if (Utils.isMobile()) {
            // 检查通知是否在视口内
            const rect = notification.getBoundingClientRect();
            if (rect.bottom > window.innerHeight) {
                // 通知超出视口底部，滚动到可视区域
                notification.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            }
        }

        // 自动关闭
        const autoCloseTimer = setTimeout(() => {
            this.closeNotification(notification);
        }, 8000); // 8秒后自动关闭

        // 绑定事件
        notification.querySelector('.notification-close').addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(autoCloseTimer);
            this.closeNotification(notification);
        });

        notification.querySelector('.notification-btn.reply').addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(autoCloseTimer);
            this.closeNotification(notification);
            this.selectChatRoom(chat_room_id);
            // 自动聚焦输入框
            setTimeout(() => {
                const input = document.getElementById('messageInput');
                if (input) input.focus();
            }, 300);
        });

        notification.querySelector('.notification-btn.view').addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(autoCloseTimer);
            this.closeNotification(notification);
            this.selectChatRoom(chat_room_id);
        });

        // 播放提示音
        if (this.shouldPlayNotificationSound()) {
            this.playNotificationSound();
        }

        // 震动提示（移动端）
        if (Utils.isIOS() || Utils.isMobile()) {
            this.vibrateOnNewMessage();
        }
    },

    // 关闭通知
    closeNotification(notification) {
        if (!notification || !notification.parentNode) return;

        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    },

    // 截断消息内容
    truncateMessage(content, maxLength = 50) {
        if (!content) return '';

        // 移除HTML标签
        const text = content.replace(/<[^>]*>/g, '');

        if (text.length > maxLength) {
            return text.substring(0, maxLength) + '...';
        }
        return text;
    },


    // 处理输入状态指示器
    handleTypingIndicator(data) {
        console.log('typing data: ', data)
        const {user_id, is_typing, chat_room_id} = data;
        console.log(`user_id: ${user_id} is_typing: ${is_typing} chat_room_id: ${chat_room_id}`)

        // 🔧 关键修复 1: 只处理私聊场景
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(chat_room_id));
        if (!room || room.room_type !== 'private') {
            // 群聊不显示头像区域输入提示，保持原有底部提示
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                typingIndicator.style.display = is_typing && parseInt(user_id) !== this.currentUser.id ? 'flex' : 'none';
            }
            return;
        }


        // 🔧 关键修复 2: 确认是对方在输入（不是自己）
        if (user_id && parseInt(user_id) === this.currentUser.id) {
            this.hideAllTypingIndicators();
            return;
        }

        // 🔧 关键修复 3: 显示/隐藏输入指示器
        if (is_typing && parseInt(user_id) !== this.currentUser.id) {
            // 显示聊天列表中的指示器
            const listIndicator = document.getElementById(`typingIndicator-${chat_room_id}`);
            if (listIndicator) {
                listIndicator.classList.add('show');
            }

            // 如果是当前聊天室，显示聊天头部的指示器
            if (this.currentRoomId === parseInt(chat_room_id)) {
                const headerIndicator = document.getElementById('chatHeaderTypingIndicator');
                if (headerIndicator) {
                    headerIndicator.classList.add('show');
                }
                // 🔧 可选：隐藏底部的旧指示器，避免重复
                const oldIndicator = document.getElementById('typingIndicator');
                if (oldIndicator) {
                    oldIndicator.style.display = 'none';
                }
            }
        } else {
            // 隐藏所有指示器
            this.hideAllTypingIndicators();
        }

    },

    // 处理用户在线状态变化
    handleUserOnlineStatus(data) {
        const {user_id, is_online, chat_room_id} = data;

        // 🔧 关键修复：用户离线时，隐藏输入指示器
        if (!is_online) {
            const listIndicator = document.getElementById(`typingIndicator-${chat_room_id}`);
            if (listIndicator) {
                listIndicator.classList.remove('show');
            }
            if (this.currentRoomId === parseInt(chat_room_id)) {
                const headerIndicator = document.getElementById('chatHeaderTypingIndicator');
                if (headerIndicator) {
                    headerIndicator.classList.remove('show');
                }
            }
        }

        // 1. 更新聊天列表中的在线状态
        this.updateChatListUserStatus(user_id, is_online);

        // 2. 如果是当前聊天室的成员，更新聊天头部状态
        if (this.currentRoomId && chat_room_id && parseInt(chat_room_id) === parseInt(this.currentRoomId)) {
            this.updateCurrentChatStatus(user_id, is_online);
        }

        // 3. 更新通讯录中的在线状态
        this.updateContactsUserStatus(user_id, is_online);
    },

    // 🔧 新增：处理云盘协作邀请通知
    handleCollaborationInvite(data) {
        const {file_name, inviter_real_name, inviter_username, permission_display, editor_url} = data;
        const inviter = inviter_real_name || inviter_username;
        const msg = `${this.escapeHtml(inviter)} 邀请你协作编辑 <b>${this.escapeHtml(file_name)}</b>（权限：${permission_display}）`;
        this.showToast(msg, 'success');
        // 桌面通知（点击跳转编辑器）
        if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
            const notif = new Notification('📄 协作邀请', {
                body: `${inviter} 邀请你编辑 ${file_name}（权限：${permission_display}）`,
                icon: '/static/images/default-avatar.png',
                tag: `collab-invite-${data.file_id}`,
                requireInteraction: true,
                data: {url: editor_url},
            });
            notif.onclick = () => {
                window.focus();
                if (editor_url) window.open(editor_url, '_blank');
                notif.close();
            };
        }
    },


    handleTaskNotification(data) {
        const {event_type, task} = data;

        // 桌面通知/铃铛未读统一由 work.notification 处理（含 Web Push），此处仅处理群内任务卡片

        if (task.related_chat_room_id == this.currentRoomId && event_type === 'assigned') {
            const cardHtml = `
            <div class="message-task-card" style="border: 1px solid #dcdfe6; border-radius: 8px; padding: 12px; margin-top: 8px; background: #f5f7fa; cursor: pointer; max-width: 300px;" onclick="window.open('/tasks/?task_id=${task.id}', '_blank')">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: bold; color: #303133;"><i class="fas fa-tasks"></i> 任务卡片</span>
                    <span style="font-size: 12px; padding: 2px 8px; border-radius: 4px; color: white; background: #409EFF;">待处理</span>
                </div>
                <div style="font-size: 14px; color: #606266; margin-bottom: 8px;">${task.title}</div>
                <div style="font-size: 12px; color: #909399; display: flex; gap: 12px;">
                    <span><i class="fas fa-user"></i> ${task.assignee_info?.real_name || '未指派'}</span>
                </div>
            </div>
        `;

            const messagesList = document.getElementById('messagesList');
            const systemMsg = document.createElement('div');
            systemMsg.className = 'message-wrapper received';
            systemMsg.innerHTML = `<div class="message-content message-left">${cardHtml}</div>`;
            messagesList.appendChild(systemMsg);
            Utils.scrollToBottom(messagesList);
        }
    },

    /**
     * 群工单状态/进度更新：就地更新聊天卡片，并刷新已打开的详情弹窗
     */
    handleWorkOrderUpdate(data) {
        const wo = data && data.work_order;
        if (!wo || !wo.work_order_id) return;
        const id = String(wo.work_order_id);
        // 更新内存中的消息卡片数据，避免重新渲染时丢失最新进度
        (this.messages || []).forEach(function (m) {
            if (m && m.message_type === 'work_order_card' && m.work_order_data
                && String(m.work_order_data.work_order_id) === id) {
                m.work_order_data = wo;
            }
        });
        document.querySelectorAll('.wo-card-message[data-work-order-id="' + id + '"]').forEach(function (card) {
            const status = card.querySelector('.wo-status-badge');
            if (status) {
                status.textContent = wo.status_display || wo.status || '';
                status.className = 'wo-status-badge wo-status-' + (wo.status || 'pending');
            }
            const progress = card.querySelector('.wo-progress-text');
            if (progress && wo.progress) {
                progress.textContent = (wo.progress.done || 0) + '/' + (wo.progress.total || 0);
            }
            const bar = card.querySelector('.wo-progress-bar > i');
            if (bar && wo.progress && wo.progress.total) {
                bar.style.width = Math.round((wo.progress.done || 0) * 100 / wo.progress.total) + '%';
            }
            const stage = card.querySelector('.wo-current-stage');
            if (stage && wo.current_stage) {
                stage.textContent = wo.current_stage.name + '（' + (wo.current_stage.assignee_name || '未指派') + '）';
            }
            const headRight = card.querySelector('.wo-card-head-right');
            if (headRight) {
                const oldBadge = headRight.querySelector('.wo-mine-badge');
                const mine = wo.current_stage && wo.current_stage.assignee_id && this.currentUser
                    && String(wo.current_stage.assignee_id) === String(this.currentUser.id)
                    && wo.status !== 'done' && wo.status !== 'cancelled';
                if (mine && !oldBadge) {
                    headRight.insertAdjacentHTML('afterbegin',
                        '<span class="wo-mine-badge"><i class="fas fa-bell"></i> 待我处理</span>');
                } else if (!mine && oldBadge) {
                    oldBadge.remove();
                }
            }
            card.classList.add('wo-card-flash');
            setTimeout(function () { card.classList.remove('wo-card-flash'); }, 1800);
        });
        if (this._workOrderDetailId && String(this._workOrderDetailId) === id
            && typeof this.refreshWorkOrderDetail === 'function') {
            this.refreshWorkOrderDetail(this._workOrderDetailId, true);
        }
    },

    /**
     * 🔧 处理任务状态更新推送
     */
    handleTaskUpdate(data) {
        const {event, task} = data;
        console.log('📥 收到任务更新:', event, task);
        if (!task || !task.related_chat_room) return;

        // 1. 渲染或更新聊天室中的任务卡片
        this.renderTaskCardInChat_realtime(task, event);

        // 2. 如果任务指派给了当前用户，且状态发生了变更，弹出系统通知
        if (event === 'status_changed' && task.assignee_info?.id === this.currentUser.id) {
            const statusText = {
                'todo': '待处理',
                'in_progress': '进行中',
                'done': '已完成'
            }[task.status] || task.status;
            this.showNotification(`任务状态更新: ${task.title}`, {
                body: `任务状态已变更为: ${statusText}`,
                icon: task.creator_info?.avatar_url || '/static/images/default-avatar.png',
                tag: `task-${task.id}-${Date.now()}`
            });
        }
    },

    /**
     * 🔧 渲染任务卡片到聊天室（支持增量更新与闪烁动画）
     */
    renderTaskCardInChat_realtime(task, event) {
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) return;

        const statusColors = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
        const statusText = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};

        const currentStatus = task.status;
        const color = statusColors[currentStatus] || '#909399';
        const text = statusText[currentStatus] || currentStatus;

        const assigneeName = task.assignee_info ? (task.assignee_info.real_name || task.assignee_info.username) : '未指派';
        const dueDateStr = task.due_date ? new Date(task.due_date).toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric'
        }) : '无期限';

        // 🔧 核心优化：如果卡片已存在，直接更新状态并闪烁，避免重复插入
        const existingCard = messagesList.querySelector(`.task-card-message[data-task-id="${task.id}"]`);
        if (existingCard) {
            const statusBadge = existingCard.querySelector('.task-status-badge');
            if (statusBadge) {
                statusBadge.style.background = color;
                statusBadge.textContent = text;
            }
            existingCard.classList.add('task-card-flash');
            setTimeout(() => existingCard.classList.remove('task-card-flash'), 2000);
            Utils.scrollToBottom(messagesList);
            return;
        }

        // 构建精美的任务卡片 HTML
        const cardHtml = `
            <div class="message-wrapper received">
                <div class="message-content message-left task-card-message" data-task-id="${task.id}" 
                     style="max-width: 320px; padding: 0; overflow: hidden; border-radius: 8px; border: 1px solid #e4e7ed; background: #fff; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05); cursor: pointer; transition: all 0.3s;" 
                     >
                    
                    <!-- 卡片头部 -->
                    <div style="padding: 12px 16px; gap: 8px; background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%); border-bottom: 1px solid #e4e7ed; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 600; color: #303133; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                            <i class="fas fa-tasks" style="color: var(--primary-color);"></i> 任务卡片
                        </span>
                        <span class="task-status-badge" style="font-size: 12px; padding: 2px 8px; border-radius: 10px; color: #fff; background: ${color}; transition: all 0.3s;">${text}</span>
                    </div>
                    
                    <!-- 卡片内容 -->
                    <div style="padding: 12px 16px;">
                        <div class="task-title" style="font-size: 14px; color: #303133; margin-bottom: 8px; font-weight: 500; line-height: 1.0;">${this.escapeHtml(task.title)}</div>
                        <div class="task-meta" style="font-size: 12px; color: #909399; display: flex; flex-direction: column; gap: 4px;">
                            <span title="执行人"><i class="fas fa-user-circle" style="width: 14px;"></i> ${assigneeName}</span>
                            <span title="截止日期"><i class="fas fa-clock" style="width: 14px;"></i> 截止: ${dueDateStr}</span>
                        </div>
                    </div>
                    
                    <!-- 卡片底部 -->
                    <div style="padding: 8px 8px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;"
                        onclick="window.open('/tasks/?task_id=${task.id}', '_blank')">
                        点击查看详情 <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                    </div>
                </div>
            </div>
        `;

        messagesList.insertAdjacentHTML('beforeend', cardHtml);
        Utils.scrollToBottom(messagesList);

        // 添加入场闪烁动画
        const newCard = messagesList.querySelector(`.task-card-message[data-task-id="${task.id}"]`);
        if (newCard) {
            newCard.classList.add('task-card-flash');
            setTimeout(() => newCard.classList.remove('task-card-flash'), 2000);
        }
    },


    /**
     * 渲染任务卡片到聊天室（静态渲染）
     */
    renderTaskCardInChat(task, container) {
        container.className = '';

        const statusColors = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
        const statusText = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};

        const currentStatus = task.status;
        const color = statusColors[currentStatus] || '#909399';
        const text = statusText[currentStatus] || currentStatus;

        const assigneeName = task.assignee_info ? (task.assignee_info.real_name || task.assignee_info.username) : '未指派';
        const dueDateStr = task.due_date ? new Date(task.due_date).toLocaleDateString('zh-CN', {
            month: 'short',
            day: 'numeric'
        }) : '无期限';


        // 构建任务卡片内容 HTML（不带外层 message-wrapper，供 renderMessageContent 嵌入使用）
        const cardHtml = `
            <div class="message-content message-left task-card-message" data-task-card-id="${task.id}"
                 style="max-width: 320px; padding: 0; overflow: hidden; border-radius: 8px; border: 1px solid #e4e7ed; background: #fff; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05); cursor: pointer; transition: all 0.3s;"
                 >

                <!-- 卡片头部 -->
                <div style="padding: 12px 16px; gap: 8px; background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%); border-bottom: 1px solid #e4e7ed; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: #303133; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-tasks" style="color: var(--primary-color);"></i> 任务卡片
                    </span>
                    <span class="task-status-badge" style="font-size: 10px; padding: 8px; border-radius: 10px; color: #fff; background: ${color}; transition: all 0.3s;">${text}</span>
                </div>

                <!-- 卡片内容 -->
                <div style="padding: 12px 16px;">
                    <div class="task-title" style="font-size: 14px; color: #303133; margin-bottom: 8px; font-weight: 500; line-height: 1.0;">${this.escapeHtml(task.title)}</div>
                    <div class="task-meta" style="font-size: 12px; color: #909399; display: flex; flex-direction: column; gap: 4px;">
                        <span title="执行人"><i class="fas fa-user-circle" style="width: 14px;"></i> ${assigneeName}</span>
                        <span title="截止日期"><i class="fas fa-clock" style="width: 14px;"></i> 截止: ${dueDateStr}</span>
                    </div>
                </div>

                <!-- 卡片底部 -->
                <div style="padding: 8px 8px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;"
                    onclick="window.open('/tasks/?task_id=${task.id}', '_blank')">
                    点击查看详情 <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                </div>
            </div>
        `;

        container.innerHTML = cardHtml;
    },

    /**
     * 🔧 渲染审批卡片到聊天室（审批发起人私聊发送给审批人，点击直达审批详情）
     */
    renderApprovalCardInChat(data, container) {
        // container.className = '';
        if (!data || !data.approval_id) {
            container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-clipboard-check"></i> [审批卡片]</div>';
            return;
        }

        const statusText = data.status_display || '待审批';
        const statusColors = {
            'pending': '#E6A23C', 'approved': '#67C23A', 'rejected': '#F56C6C',
            'cancelled': '#909399', 'deferred': '#909399', 'processing': '#409EFF'
        };
        const statusColor = statusColors[data.status] || '#909399';

        const title = this.escapeHtml(data.title || '审批');
        const typeName = this.escapeHtml(data.type_name || '');
        const typeIcon = this.escapeHtml(data.type_icon || '');
        const typeColor = this.escapeHtml(data.type_color || '');
        const applicant = this.escapeHtml(data.applicant_name || '');
        const amount = data.amount ? '¥' + this.escapeHtml(data.amount) : '';

        const cardHtml = `
            <div class="message-content message-left approval-card-message" data-approval-id="${data.approval_id}"
                 onclick="window.open('/oa/approval/?approval_id=${data.approval_id}', '_blank')"
                 style="max-width: 320px; padding: 0; overflow: hidden; border-radius: 8px; border: 1px solid #e4e7ed; background: #fff; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05); cursor: pointer; transition: all 0.3s;">
                <!-- 卡片头部 -->
                <div style="padding: 12px 16px; gap: 8px; background: linear-gradient(135deg, ${data.mention ? '#fff7e6 0%, #ffedd6 100%' : '#eef6ff 0%, #dbeafe 100%'}); border-bottom: 1px solid #e4e7ed; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: #303133; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <i class="fas ${data.mention ? 'fa-at' : typeIcon || 'fa-clipboard-check'}" style="color: ${data.mention ? '#e6a23c' : typeColor || 'var(--primary-color, #409eff)'};"></i>${(typeName ? typeName + ' ' : '')} ${data.mention ?  '' : ''}
                    </span>
                    <span style="font-size: 10px; padding: 4px 8px; border-radius: 10px; color: #fff; background: ${statusColor}; white-space: nowrap;">${statusText}</span>
                </div>
                <!-- 卡片内容 -->
                <div style="padding: 12px 16px;">
                    <div style="font-size: 14px; color: #303133; margin-bottom: 8px; font-weight: 500; line-height: 1.4;">${title}</div>
                    <div style="font-size: 12px; color: #909399; display: flex; flex-direction: column; gap: 4px;">
                        <span title="发起人"><i class="fas fa-user-circle" style="width: 14px;"></i> ${applicant}</span>
                        ${amount ? `<span title="金额"><i class="fas fa-yen-sign" style="width: 14px;"></i> ${amount}</span>` : ''}
                    </div>
                    ${data.mention ? `
                    <div style="margin-top: 10px; padding: 8px 10px; background: #fdf6ec; border-left: 3px solid #e6a23c; border-radius: 4px; font-size: 12px; color: #8a6d3b; line-height: 1.5; word-break: break-all;">
                        <i class="fas fa-at" style="margin-right: 4px;"></i> ${this.escapeHtml(data.sender_name || '')} 在审批中提及了您
                    </div>` : ''}
                    
                    ${data.mention && data.mention_comment ? `
                    <div style="margin-top: 10px; padding: 8px 10px; background: #fdf6ec; border-left: 3px solid #e6a23c; border-radius: 4px; font-size: 12px; color: #8a6d3b; line-height: 1.5; word-break: break-all;">
                        <i class="fas fa-comment-dots" style="margin-right: 4px;"></i> 审批意见：${this.escapeHtml(data.mention_comment)}
                    </div>` : ''}
                </div>
                <!-- 卡片底部 -->
                <div style="padding: 8px 8px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;">
                    点击查看审批 <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                </div>
            </div>
        `;
        container.innerHTML = cardHtml;
    },

    renderWorkSummaryCardInChat(data, container) {
        container.className = '';
        if (!data || !data.summary_id) {
            container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-file-signature"></i> [每日工作总结卡片]</div>';
            return;
        }
        const statusMap = {done: '已完成', analyzing: '分析中', failed: '分析失败', pending: '待分析', disabled: '已停用'};
        const statusColor = {done: '#67C23A', analyzing: '#409EFF', failed: '#F56C6C', pending: '#E6A23C', disabled: '#909399'};
        const statusText = statusMap[data.status] || '待分析';
        const color = statusColor[data.status] || '#E6A23C';
        const userName = this.escapeHtml(data.user_name || '员工');
        const date = this.escapeHtml(data.summary_date || '');
        const position = this.escapeHtml(data.position || '');
        const content = this.escapeHtml(data.content || '（未填写总结文字）');
        const analysis = this.escapeHtml(data.analysis || '');
        const summaryId = data.summary_id;
        const cardHtml = `
            <div class="message-content message-left approval-card-message" data-summary-id="${summaryId}"
                 onclick="window.open('/oa/work-summary/?id=${summaryId}', '_blank')"
                 style="max-width: 340px; padding: 0; overflow: hidden; border-radius: 8px; border: 1px solid #e4e7ed; background: #fff; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05); cursor: pointer; transition: all 0.3s;">
                <div style="padding: 12px 16px; background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border-bottom: 1px solid #e4e7ed; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: #303133; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-file-signature" style="color: #9b59b6;"></i> 每日工作总结
                    </span>
                    <span style="font-size: 10px; padding: 4px 8px; border-radius: 10px; color: #fff; background: ${color}; white-space: nowrap;">${statusText}</span>
                </div>
                <div style="padding: 12px 16px;">
                    <div style="font-size: 13px; color: #303133; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                        <i class="fas fa-user-circle" style="color:#9b59b6;"></i> ${userName}
                        <span style="font-size:11px;color:#909399;font-weight:400;">${date}</span>
                    </div>
                    ${position ? `<div style="font-size: 11px; color: #a47bd1; margin-bottom: 8px;"><i class="fas fa-user-tie" style="width:14px;"></i> ${position}</div>` : ''}
                    <div style="font-size: 12px; color: #606266; line-height: 1.6; margin-bottom: 8px; max-height: 60px; overflow: hidden;">${content}</div>
                    ${analysis ? `<div style="font-size: 12px; color: #7c4dff; line-height: 1.6; background:#f8f6ff; border-radius:6px; padding:8px 10px; max-height: 72px; overflow: hidden;">🤖 ${analysis}</div>` : ''}
                </div>
                <div style="padding: 8px 8px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;">
                    点击查看每日总结 <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                </div>
            </div>
        `;
        container.innerHTML = cardHtml;
    },

    /**
     * 🔧 渲染协作邀请卡片（云盘文档协作 / 共享文件夹邀请），点击直达对应页面
     */
    renderCollabCardInChat(data, container) {
        container.className = '';
        if (!data || !data.url) {
            container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-handshake"></i> [协作邀请]</div>';
            return;
        }
        const isFolder = data.invite_type === 'folder';
        const icon = data.icon || (isFolder ? 'fa-folder' : 'fa-file-word');
        const title = this.escapeHtml(data.title || (isFolder ? '共享文件夹邀请' : '协作邀请'));
        const targetName = this.escapeHtml(data.target_name || '');
        const inviter = this.escapeHtml(data.inviter_name || '');
        const perm = data.permission_display || '';
        const permColors = {'只读': '#909399', '可编辑': '#409EFF', '管理员': '#E6A23C'};
        const permColor = permColors[perm] || '#00a1ff';
        const openText = isFolder ? '打开共享文件夹' : '打开协作编辑';
        const cardHtml = `
            <div class="message-content message-left approval-card-message" data-collab-url="${this.escapeHtml(data.url)}"
                 onclick="window.open('${this.escapeHtml(data.url)}', '_blank')"
                 style="max-width: 320px; padding: 0; overflow: hidden; border-radius: 8px; border: 1px solid #e4e7ed; background: #fff; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05); cursor: pointer; transition: all 0.3s;">
                <div style="padding: 12px 16px; background: linear-gradient(135deg, #e6f7ff 0%, #bae7ff 100%); border-bottom: 1px solid #e4e7ed; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: #303133; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                        <i class="fas ${isFolder ? 'fa-folder' : 'fa-handshake'}" style="color: #00a1ff;"></i> ${title}
                    </span>
                    ${perm ? `<span style="font-size: 10px; padding: 4px 8px; border-radius: 10px; color: #fff; background: ${permColor}; white-space: nowrap;">${this.escapeHtml(perm)}</span>` : ''}
                </div>
                <div style="padding: 12px 16px;">
                    <div style="font-size: 14px; color: #303133; margin-bottom: 8px; font-weight: 500; line-height: 1.4; display: flex; align-items: center; gap: 6px;">
                        <i class="fas ${icon}" style="color: #00a1ff;"></i> <span style="word-break: break-all;">${targetName || '(未命名)'}</span>
                    </div>
                    <div style="font-size: 12px; color: #909399; display: flex; align-items: center; gap: 4px;">
                        <i class="fas fa-user-circle" style="width: 14px;"></i> ${inviter} 邀请你参与协作
                    </div>
                </div>
                <div style="padding: 8px 8px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;">
                    点击${openText} <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                </div>
            </div>
        `;
        container.innerHTML = cardHtml;
    },

    // 更新聊天列表中的用户状态
    updateChatListUserStatus(userId, isOnline) {
        // 私聊：通过 data-user-id 查找
        const chatItems = document.querySelectorAll(`.chat-item[data-user-id="${userId}"]`);
        chatItems.forEach(item => {
            const statusDot = item.querySelector('.status-dot');
            if (statusDot) {
                statusDot.parentNode.className = isOnline ? 'status online' : 'status offline';

                const statusText = item.querySelector('.status-text');
                if (statusText) {
                    statusText.textContent = isOnline ? '在线' : '离线';
                }
            }
        });

        // 群聊：更新群成员列表（如果打开）
        if (this.currentRoomId) {
            const room = this.chatRooms.find(r => r.id === parseInt(this.currentRoomId));
            if (room && room.members) {
                const member = room.members.find(m => m.id === userId);
                if (member) {
                    member.online_status = {is_online: isOnline};
                    // 重新渲染成员列表（如果打开）
                    if (document.getElementById('groupMemberList')) {
                        this.renderGroupMembers(room.members);
                    }
                }
            }
        }
    },

    // 更新当前聊天头部状态
    updateCurrentChatStatus(userId, isOnline) {
        const chatSubtitle = document.getElementById('chatSubtitle');
        if (chatSubtitle) {
            const statusDot = chatSubtitle.querySelector('.status-dot');
            const statusText = chatSubtitle.querySelector('.status-text');

            if (statusDot) {
                statusDot.parentNode.className = isOnline ? 'status online' : 'status offline';
            }
            if (statusText) {
                statusText.textContent = isOnline ? '在线' : '离线';
            }
        }
    },

    // 更新通讯录中的用户状态
    updateContactsUserStatus(userId, isOnline) {
        const contactItems = document.querySelectorAll(`.user-list-item[data-user-id="${userId}"]`);
        contactItems.forEach(item => {
            const statusDot = item.querySelector('.status-dot');
            if (statusDot) {
                statusDot.parentNode.className = isOnline ? 'status online' : 'status offline';
            }
            const statusText = item.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = isOnline ? '在线' : '离线';
            }
        });
    },
    });
})();
