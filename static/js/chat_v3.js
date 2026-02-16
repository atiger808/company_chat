// static/js/chat.js

class ChatClient {
    constructor() {
        this.globalWs = null;  // 全局 WebSocket 连接
        this.roomWs = null;    // 当前聊天室 WebSocket 连接
        this.ws = null;
        this.currentRoomId = null;
        this.currentUser = null;
        this.chatRooms = [];
        this.messages = [];
        this.users = [];
        this.membersForGroup = [];
        this.isTyping = false;
        this.typingTimeout = null;
        this.messageQueue = []; // 消息队列，用于离线消息
        this.isConnected = false;
        this.isShowingSidebar = true // 移动端侧边栏切换
        // 新建聊天相关变量
        this.usersForChat = [];
        this.selectedMembersForGroup = [];

        // 等待 DOM 加载完成后再初始化
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    // 检查登录状态
    async checkLoginStatus() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            console.log('未找到访问令牌，跳转到登录页');
            window.location.href = '/login/';
            return;
        }
    }


    async init() {
        console.log('ChatClient 初始化开始...');

        // 检查登录状态
        await this.checkLoginStatus();

        try {

            if (this.isShowingSidebar) {
                this.hideSidebar();
                this.showSidebar();
            } else {
                this.hideSidebar();
            }

            // 获取当前用户信息
            this.currentUser = await API.getCurrentUser();
            console.log('获取当前用户成功:', this.currentUser);
            this.renderCurrentUser();

            // 检查是否为管理员，显示控制台按钮
            if (this.currentUser.user_type === 'admin' || this.currentUser.user_type === 'super_admin') {
                document.getElementById('adminConsoleBtn').style.display = 'flex';

                // 绑定管理员控制台按钮
                document.getElementById('adminConsoleBtn').addEventListener('click', () => {
                    window.location.href = '/admin/';
                });
            }

            // 连接全局 WebSocket
            this.connectGlobalWebSocket();

            // 获取聊天列表
            await this.loadChatRooms();

            // 加载用户列表
            await this.loadUsers();

            // 设置事件监听
            this.setupEventListeners();

            // 请求通知权限
            if ('Notification' in window) {
                Notification.requestPermission();
            }


            // 移动端优化
            if (Utils.isMobile()) {
                this.setupMobileOptimizations();
            }

            console.log('ChatClient 初始化完成');
        } catch (error) {
            console.error('初始化失败:', error);
            this.showError('初始化失败，请重新登录');
            localStorage.removeItem('access_token');
            window.location.href = '/login/';
        }
    }


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
                    setTimeout(() => this.connectGlobalWebSocket(), 3000);
                }
            };

            this.globalWs.onerror = (error) => {
                console.error('Global WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to create global WebSocket:', error);
        }
    }

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
            default:
                console.log('Unknown global message type:', data.type);
        }
    }

    // 处理新消息通知
    handleNewGlobalMessage(data) {
        console.log('Received global message:', data);

        // 更新聊天室列表中的未读数
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(data.chat_room));
        if (room) {
            room.unread_count = (room.unread_count || 0) + 1;
            room.last_message = {
                content: data.content,
                timestamp: data.timestamp
            };
            room.updated_at = data.timestamp;

            // 如果不是当前聊天室，更新列表
            if (!this.currentRoomId || parseInt(this.currentRoomId) !== parseInt(data.chat_room)) {
                this.renderChatRooms();
                this.renderGroups();
            }
        } else {
            // 如果聊天室不存在，重新加载列表
            this.loadChatRooms();
        }

        // 播放提示音和显示通知
        if (this.shouldPlayNotificationSound()) {
            Utils.playNotificationSound();
        }

        if (this.shouldShowDesktopNotification()) {
            Utils.showNotification(data.sender_name, {
                body: data.content,
                icon: data.sender?.avatar_url || '/static/images/default-avatar.png'
            });
        }
    }

    // 处理未读数更新
    handleUnreadCountUpdate(data) {
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(data.chat_room_id));
        if (room) {
            room.unread_count = data.unread_count || 0;
            this.renderChatRooms();
            this.renderGroups();
        }
    }

    // 处理聊天室更新
    handleRoomUpdated(data) {
        const roomIndex = this.chatRooms.findIndex(r => parseInt(r.id) === parseInt(data.room_id));
        if (roomIndex !== -1) {
            this.chatRooms[roomIndex] = {...this.chatRooms[roomIndex], ...data.room};
            this.renderChatRooms();
            this.renderGroups();
        }
    }


    // 连接 WebSocket
    connectWebSocket(roomId) {
        // 关闭旧的聊天室连接
        if (this.roomWs) {
            this.roomWs.close();
        }

        // 防止重复连接
        if (parseInt(this.currentRoomId) === parseInt(roomId) && this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket already connected to room:', roomId);
            return;
        }


        if (this.ws) {
            console.log('Closing existing WebSocket connection')
            this.ws.close();
        }

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
        console.log('Attempting to connect WebSocket:', wsUrl);

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('WebSocket connected successfully roomId: ', roomId);
                this.isConnected = true;
                this.updateConnectionStatus(true);
                // 发送队列中的消息
                this.sendQueuedMessages();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
                this.isConnected = false;
                this.updateConnectionStatus(false);

                // 只有在当前房间时才重连
                if (parseInt(this.currentRoomId) === parseInt(roomId) && event.code !== 1000) {
                    console.log('Attempting to reconnect in 3 seconds...');
                    setTimeout(() => this.connectWebSocket(roomId), 3000);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.isConnected = false;
                // 不要在这里 close()，让 onclose 处理
            };
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.showError('WebSocket 连接失败，请检查网络连接');
        }
    }

    // 处理 WebSocket 消息
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'chat_message':
                this.handleNewMessage(data);
                break;
            case 'typing':
                this.handleTypingIndicator(data);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    // 处理新消息（从WebSocket接收）
    handleNewMessage(message) {
        // 安全性检查：确保必要字段存在
        if (!message || !message.timestamp || !message.chat_room) {
            console.warn('Invalid message object:', message);
            return;
        }

        const currentRoomIdInt = parseInt(this.currentRoomId);
        const senderId = message.sender_id ?? message.sender?.id;

        // 检查是否需要显示时间戳
        const lastMessage = this.messages[this.messages.length - 1];
        if (lastMessage?.timestamp) {
            try {
                const lastTime = new Date(lastMessage.timestamp);
                const currentTime = new Date(message.timestamp);
                const timeDiff = currentTime - lastTime;

                if (timeDiff > 2 * 60 * 1000) {
                    const timeElement = this.renderTimeStamp(message.timestamp);
                    const messagesList = document.getElementById('messagesList');
                    if (messagesList && timeElement) {
                        messagesList.appendChild(timeElement);
                    } else {
                        console.warn('Failed to append timestamp element.');
                    }
                }
            } catch (error) {
                console.error('Error processing timestamps:', error);
            }
        }

        // 添加到消息列表
        this.messages.push(message);
        console.log('New message:', message);
        console.log('this.currentRoomId:', currentRoomIdInt, ' type: ', typeof this.currentRoomId);
        console.log('this.currentUser:', this.currentUser, ' type: ', typeof this.currentUser);
        console.log('senderId:', senderId, ' type: ', typeof senderId);


        // 更新未读计数
        // this.updateUnreadCount(message.chat_room, 1);


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

        // 渲染消息（统一处理）
        // this.renderMessage(message, 'received');

        // 判断是否为当前聊天室的消息
        if (senderId !== this.currentUser?.id) {
            if (this.currentRoomId && parseInt(message.chat_room) === currentRoomIdInt) {
                // 当前聊天室，标记为已读
                message.is_read = true;
                this.renderMessage(message, 'received');
            } else {
                this.renderMessage(message, 'received');
                // 非当前聊天室，触发通知
                if (this.shouldPlayNotificationSound()) {
                    try {
                        Utils.playNotificationSound();
                    } catch (error) {
                        console.error('Failed to play notification sound:', error);
                    }
                }

                if (this.shouldShowDesktopNotification()) {
                    try {
                        Utils.showNotification(message.sender_name, {
                            body: message.content,
                            icon: message.sender?.avatar_url || '/static/images/default-avatar.png'
                        });
                    } catch (error) {
                        console.error('Failed to show desktop notification:', error);
                    }
                }
            }
        }
    }


    // 检查是否应该播放提示音
    shouldPlayNotificationSound() {
        // 检查全局声音提醒设置
        const soundNotifications = localStorage.getItem('soundNotifications') !== 'false';

        // 检查当前聊天室是否免打扰
        if (this.currentRoomId) {
            const currentRoom = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
            if (currentRoom?.is_muted) {
                return false;  // 免打扰状态下不播放提示音
            }
        }

        return soundNotifications;
    }

    // 检查是否应该显示桌面通知
    shouldShowDesktopNotification() {
        const desktopNotifications = localStorage.getItem('desktopNotifications') !== 'false';

        // 检查当前聊天室是否免打扰
        if (this.currentRoomId) {
            const currentRoom = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
            if (currentRoom && currentRoom?.is_muted) {
                return false;  // 免打扰状态下不显示通知
            }
        }

        return desktopNotifications && Notification.permission === 'granted';
    }


    // 处理输入状态指示器
    handleTypingIndicator(data) {
        const typingIndicator = document.getElementById('typingIndicator');
        if (!typingIndicator) return;

        if (data.is_typing && data.user_id !== this.currentUser.id) {
            typingIndicator.style.display = 'flex';
        } else {
            typingIndicator.style.display = 'none';
        }
    }

    // 发送文本消息
    sendMessage(content = null) {
        const messageInput = document.getElementById('messageInput');
        const actualContent = content || (messageInput ? messageInput.value.trim() : '');
        console.log('-> sendMessage currentRoomId: ', this.currentRoomId)
        if (!actualContent) {
            return;
        }

        if (!this.currentRoomId) {
            this.showError('请先选择一个聊天对象');
            return;
        }

        // 清空输入框
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            this.adjustTextareaHeight(messageInput);
        }

        // 停止输入状态
        this.stopTyping();

        // 本地渲染消息
        const message = {
            id: Date.now(),
            sender_id: this.currentUser.id,
            sender_name: this.currentUser.username,
            sender: this.currentUser,
            content: actualContent,
            timestamp: new Date().toISOString(),
            is_read: true,
            message_type: 'text',
            chat_room: parseInt(this.currentRoomId)
        };

        // 渲染并滚动到底部
        this.renderMessage(message, 'sent');
        Utils.scrollToBottom(document.getElementById('messagesList'));

        // 通过 WebSocket 发送
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'chat_message',
                content: actualContent,
                message_type: 'text'
            }));
        } else {
            // WebSocket 不可用时加入队列
            this.messageQueue.push({
                chat_room: parseInt(this.currentRoomId),
                content: actualContent,
                message_type: 'text'
            });
            this.showError('网络连接不稳定，消息将在连接恢复后发送');
        }

        this.loadChatRooms()


    }

    // 发送队列中的消息
    async sendQueuedMessages() {
        while (this.messageQueue.length > 0) {
            const messageData = this.messageQueue.shift();
            try {
                await API.sendMessage(messageData);
            } catch (error) {
                console.error('发送队列消息失败:', error);
                // 重新加入队列
                this.messageQueue.unshift(messageData);
                break;
            }
        }
    }

    // 发送输入状态
    sendTypingStatus(isTyping) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoomId) {
            this.ws.send(JSON.stringify({
                type: 'typing',
                is_typing: isTyping
            }));
        }
    }

    // 处理输入
    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.sendTypingStatus(true);
        }

        // 5秒后自动停止
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.stopTyping();
        }, 5000);
    }

    // 停止输入
    stopTyping() {
        this.isTyping = false;
        clearTimeout(this.typingTimeout);
        this.sendTypingStatus(false);
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.style.display = 'none';
        }
    }

    // 加载聊天室
    async loadChatRooms() {
        try {
            const response = await API.getChatRooms();
            this.chatRooms = Array.isArray(response) ? response : (response.results || []);

            // 渲染所有标签页
            this.renderChatRooms();
            this.renderGroups();

        } catch (error) {
            console.error('加载聊天室失败:', error);
            this.showError('加载聊天室失败，请刷新页面');
        }
    }

    // 加载聊天历史
    async loadChatHistory(roomId) {
        try {
            const response = await API.getChatHistory(roomId);
            console.log('聊天历史消息:', response);
            this.messages = response;
            ;
        } catch (error) {
            console.error('加载聊天历史失败:', error);
            this.showError('加载聊天历史失败');
            await this.checkLoginStatus();
        }
    }

    // 加载用户列表
    async loadUsers() {
        try {
            const response = await API.getUsers();
            this.users = Array.isArray(response) ? response : (response.results || []);
            this.renderUserList();
        } catch (error) {
            console.error('加载用户列表失败:', error);
            await this.checkLoginStatus();
        }
    }

    // 渲染当前用户个人设置信息
    renderCurrentUser() {
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = this.currentUser.real_name ? `${this.currentUser.real_name}` : this.currentUser.username;
            userNameEl.title = this.currentUser.username;
        }
        const currentUserAvatarEl = document.getElementById('currentUserAvatar');
        currentUserAvatarEl.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        currentUserAvatarEl.title = this.currentUser.username;


        // 设置表单中的用户信息
        document.getElementById('settingsUsername').value = this.currentUser.username;
        document.getElementById('settingsDepartment').value = this.currentUser.department_name || this.currentUser.department_info?.name || '';
        document.getElementById('settingsPosition').value = this.currentUser.position || '';
        document.getElementById('settingsRealName').value = this.currentUser.real_name || '';
        document.getElementById('settingsEmail').value = this.currentUser.email || '';
        document.getElementById('settingsPhone').value = this.currentUser.phone || '';


        // 设置头像
        const settingsAvatar = document.getElementById('settingsAvatar');
        if (settingsAvatar) {
            settingsAvatar.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        }

        // 恢复通知设置
        const desktopNotifications = localStorage.getItem('desktopNotifications') !== 'false';
        const soundNotifications = localStorage.getItem('soundNotifications') !== 'false';

        document.getElementById('desktopNotifications').checked = desktopNotifications;
        document.getElementById('soundNotifications').checked = soundNotifications;


    }

    // 渲染聊天室列表（私聊和群聊混合）
    renderChatRooms() {
        const chatList = document.getElementById('chatList');
        if (!chatList) return;

        // 按更新时间排序，置顶的在前面
        const sortedRooms = [...this.chatRooms].sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return new Date(b.updated_at) - new Date(a.updated_at);
        });


        let html = `
            <div class="group-item new-group-item" onclick="chatClient.openNewChatModal()">
                <div class="group-avatar">
                    <i class="fas fa-plus"></i>
                </div>
                <div class="group-info">
                    <div class="group-title">新建聊天</div>
                    <div class="group-subtitle">点击创建新的聊天</div>
                </div>
            </div>
        `;

        if (sortedRooms.length === 0) {
            html += `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>暂无聊天记录</p>
                </div>
            `;
            chatList.innerHTML = html;
            return;
        }


        sortedRooms.forEach(room => {
            const lastMessage = room.last_message || {};
            const unreadCount = room.unread_count || 0;
            const roomName = room.display_name || '未知聊天室';


            let roomAvatar, isOnline, isOnline_html = '', username = '';
            if (room.room_type === 'private') {
                // roomName = room.name || room.members.find(m => m.id !== this.currentUser.id).username || '未知聊天室';
                roomAvatar = room.avatar || room.members.find(m => m.id !== this.currentUser.id).avatar_url || '/static/images/default-avatar.png';

                let profileInfo = '', otherMember = room.members.find(m => m.id !== this.currentUser.id);
                if (otherMember) {
                    profileInfo = `${otherMember?.username}- ${otherMember?.department_info?.name} - ${otherMember?.position}`
                } else {
                    profileInfo = '未知用户'
                }

                username = profileInfo;
                isOnline = room.members.find(m => m.id !== this.currentUser.id).online_status?.is_online || false;

                isOnline_html = `
                    <div class="status ${isOnline ? 'online' : 'offline'}">
                    <span class="status-dot"> </span>
                    <span class="status-text">${isOnline ? '在线' : '离线'}</span>
                `;
            } else {
                // roomName = room.name || (room.members ? room.members.map(m => m.username).join(', ') : '未知群组');
                roomAvatar = room.avatar || '/static/images/group-avatar.png';
            }

            html += `
                <div class="chat-item ${room.is_pinned ? 'pinned' : ''}" data-room-id="${room.id}">
                    <img src="${roomAvatar}" 
                         alt="${roomName}" class="chat-item-avatar" title="${username}">
              
                    <div class="chat-item-info">
                        <div class="chat-item-title">
                            ${room.is_pinned ? '<i class="fas fa-thumbtack pinned-icon"></i>' : ''}
                            <!--                            消息免打扰-->
                            
                            ${room.is_muted ? '<i class="fas fa-volume-mute muted-icon"></i>' : ''}
                            ${roomName}
                        </div>
                        
                        <div class="chat-item-subtitle">${lastMessage.content || '暂无消息'}</div>
                         
                    </div>
                    <div class="chat-item-meta">
             
                        ${isOnline_html}
                        <div class="chat-item-time">${lastMessage.timestamp ? Utils.formatTime(lastMessage.timestamp) : ''}</div>
                        
                        ${unreadCount > 0 ? `<div class="chat-item-unread-count">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
                        
                    </div>
                </div>
               </div>
            `;
        });

        chatList.innerHTML = html;
    }

    // 渲染聊天历史
    renderChatHistory() {
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) return;

        messagesList.innerHTML = '';

        // 按时间顺序排序（最早的在前，最新的在后）
        this.messages.sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        this.messages.forEach(message => {
            const messageType = parseInt(message.sender?.id) === this.currentUser.id ? 'sent' : 'received';
            this.renderMessage(message, messageType);
        });

        // 滚动到底部
        Utils.scrollToBottom(messagesList);
    }


    // 渲染时间戳
    renderTimeStamp(timestamp) {
        const template = document.getElementById('timeStampTemplate');
        if (!template) return null;

        const timeElement = template.content.cloneNode(true);
        const timeSpan = timeElement.querySelector('span');

        if (timeSpan) {
            timeSpan.textContent = Utils.formatTime(timestamp);
        }

        return timeElement;
    }

    // 消息渲染方法 - 微信样式
    renderMessage(message, type) {
        const template = document.getElementById('messageTemplate');
        if (!template) return;

        // 创建消息元素
        const messageElement = template.content.cloneNode(true);

        // 设置消息容器类型
        const wrapper = messageElement.querySelector('.message-wrapper');
        wrapper.className = `message-wrapper ${type}`; // sent 或 received

        // 根据消息类型动态创建对应的 wrapper
        let messageWrapper;

        if (type === 'received') {
            // 接收的消息 - 使用左侧 wrapper
            messageWrapper = document.createElement('div');
            messageWrapper.className = 'message-left-wrapper';

            // 创建头像元素（左侧）
            const avatarElement = document.createElement('div');
            avatarElement.className = 'message-avatar';

            // 显示对方头像
            if (message.sender?.avatar_url || message.sender?.avatar) {
                avatarElement.innerHTML = `<img src="${message.sender?.avatar_url || message.sender?.avatar}" alt="头像">`;
            } else {
                // 使用首字母作为头像
                const username = message.sender?.real_name || message.sender?.username || '未知';
                avatarElement.textContent = username.charAt(0);
                avatarElement.style.background = '#07c160';
                avatarElement.style.color = 'white';
                avatarElement.style.display = 'flex';
                avatarElement.style.alignItems = 'center';
                avatarElement.style.justifyContent = 'center';
                avatarElement.style.fontWeight = 'bold';
                avatarElement.style.fontSize = '16px';
            }

            // 设置头像点击事件
            const avatarImg = avatarElement.querySelector('img');
            if (avatarImg) {
                let username = message.sender?.real_name ? `${message.sender?.real_name}（${message.sender?.username}）` : message.sender?.username || '未知用户';
                avatarImg.title = `${username} - ${message.sender?.department_info?.name} - ${message.sender?.position}`;

                avatarImg.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (message.sender?.id) {
                        this.showUserProfile(message.sender.id);
                    }
                });
                avatarImg.style.cursor = 'pointer';
            }

            // 创建消息头部元素（发送者姓名和时间）
            const headerElement = document.createElement('div');
            headerElement.className = 'message-header';
            headerElement.innerHTML = `
            <span class="message-sender">${message.sender?.real_name || message.sender?.username || message.sender_name || '未知用户'}</span>
        `;

            // 创建消息内容元素
            const contentElement = document.createElement('div');
            contentElement.className = 'message-content message-left';
            contentElement.innerHTML = `
            <div class="message-text"></div>
<!--            <div class="message-status">-->
<!--                <i class="fas fa-check-double"></i>-->
<!--            </div>-->
        `;

            const headerElement_2 = document.createElement('div');
            headerElement_2.className = 'message-header';
            headerElement_2.innerHTML = `
            <span class="message-time">${Utils.formatTime(message.timestamp)}</span>
        `;

            // 设置消息内容
            const messageContent = contentElement.querySelector('.message-text');
            console.log("message renderMessageContent: ", message);
            console.log("message.message_type: ", message.message_type);
            this.renderMessageContent(message, messageContent);

            // 添加到 wrapper（头像 -> 头部 -> 内容）
            messageWrapper.appendChild(avatarElement);
            messageWrapper.appendChild(headerElement);
            messageWrapper.appendChild(contentElement);
            messageWrapper.appendChild(headerElement_2);
        } else {
            // 发送的消息 - 使用右侧 wrapper
            messageWrapper = document.createElement('div');
            messageWrapper.className = 'message-right-wrapper';

            // 创建消息头部元素（只有时间，因为是自己）
            const headerElement = document.createElement('div');
            headerElement.className = 'message-header';
            headerElement.innerHTML = `
            <span class="message-time">${Utils.formatTime(message.timestamp)}</span>
        `;

            // 创建消息内容元素
            const contentElement = document.createElement('div');
            contentElement.className = 'message-content message-right';
            contentElement.innerHTML = `
            <div class="message-text"></div>
            
        `;

            // 设置消息内容
            const messageContent = contentElement.querySelector('.message-text');
            console.log("message renderMessageContent: ", message);
            console.log("message.message_type: ", message.message_type);
            this.renderMessageContent(message, messageContent);

            // 创建头像元素（右侧）
            const avatarElement = document.createElement('div');
            avatarElement.className = 'message-avatar';

            // 显示自己的头像或缩写
            if (this.currentUser && (this.currentUser.avatar_url || this.currentUser.avatar)) {
                avatarElement.innerHTML = `<img src="${this.currentUser.avatar_url || this.currentUser.avatar}" alt="我的头像">`;
            } else {
                avatarElement.textContent = '我';
                avatarElement.style.background = '#1aad19';
                avatarElement.style.color = 'white';
                avatarElement.style.display = 'flex';
                avatarElement.style.alignItems = 'center';
                avatarElement.style.justifyContent = 'center';
                avatarElement.style.fontWeight = 'bold';
                avatarElement.style.fontSize = '16px';
            }

            avatarElement.title = '点击打开设置';
            avatarElement.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSettings();
            });
            avatarElement.style.cursor = 'pointer';

            // 添加到 wrapper（头部 -> 内容 -> 头像）
            messageWrapper.appendChild(headerElement);
            messageWrapper.appendChild(contentElement);
            messageWrapper.appendChild(avatarElement);
        }

        // 清空原始模板内容，添加新的 wrapper
        wrapper.innerHTML = '';
        wrapper.appendChild(messageWrapper);

        // 设置消息内容宽度
        const messageContentElement = messageWrapper.querySelector('.message-content');
        if (messageContentElement) {
            messageContentElement.style.maxWidth = '80%';
            messageContentElement.style.minWidth = '25%';
        }

        // 获取消息列表容器
        const messagesList = document.getElementById('messagesList');
        if (messagesList) {
            messagesList.appendChild(messageElement);
        }

        // 如果是最新消息且当前在聊天界面，滚动到底部
        if (this.currentRoomId && parseInt(message.chat_room) == parseInt(this.currentRoomId)) {
            Utils.scrollToBottom(messagesList);
        }
    }

    // 渲染不同类型的消息内容
    renderMessageContent(message, container) {
        container.innerHTML = '';

        if (message?.uploading_id) {
            // 添加属性
            container.setAttribute('uploading_id', message.uploading_id);
            container.title = message?.content || '正在上传文件';
        }

        switch (message.message_type) {
            case 'text':
                container.textContent = message.content;
                break;

            case 'image':
                if (message.file_info?.url) {
                    const img = document.createElement('img');
                    img.src = message.file_info.url;
                    img.className = 'message-image';
                    img.onclick = () => this.previewImage(message.file_info.url);
                    container.appendChild(img);
                } else {
                    container.textContent = '[图片加载失败]';
                }
                break;

            case 'file':
                if (message.file_info?.url) {
                    const fileLink = document.createElement('div');
                    fileLink.className = 'message-file';
                    const iconClass = Utils.getFileIconClass(message.file_info.mime_type, message.file_info.name);
                    fileLink.innerHTML = `
                        <i class="${iconClass}"></i>
                        <span>${message.file_info.name}</span>
                        <span>(${Utils.formatFileSize(message.file_info.size)})</span>
                    `;
                    fileLink.onclick = () => window.open(message.file_info.url, '_blank');
                    container.appendChild(fileLink);
                } else {
                    container.textContent = '[文件信息缺失]';
                }
                break;

            case 'video':
                if (message.file_info?.url) {
                    const videoContainer = document.createElement('div');
                    videoContainer.className = 'message-video-container';

                    const video = document.createElement('video');
                    video.src = message.file_info.url;
                    video.controls = true;
                    video.className = 'message-video';

                    const playBtn = document.createElement('div');
                    playBtn.className = 'video-play-btn';
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                    playBtn.onclick = () => {
                        video.play();
                        playBtn.style.display = 'none';
                    };

                    videoContainer.appendChild(video);
                    videoContainer.appendChild(playBtn);
                    container.appendChild(videoContainer);
                } else {
                    container.textContent = '[视频加载失败]';
                }
                break;

            case 'voice':
                if (message.file_info?.url) {
                    const audio = document.createElement('audio');
                    audio.src = message.file_info.url;
                    audio.controls = true;
                    audio.className = 'message-audio';
                    container.appendChild(audio);
                } else {
                    container.textContent = '[语音加载失败]';
                }
                break;

            case 'location':
                if (message.file_info?.url) {
                    const locationLink = document.createElement('div');
                    locationLink.className = 'message-location';
                    locationLink.innerHTML = `
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${message.file_info.name}</span>
                    `;
                    locationLink.onclick = () => window.open(message.file_info.url)
                    container.appendChild(locationLink);
                } else {
                    container.textContent = '[位置信息缺失]';
                }
                break;

            case 'audio':
                if (message.file_info?.url) {
                    const audio = document.createElement('audio');
                    audio.src = message.file_info.url;
                    audio.controls = true;
                    audio.onerror = () => {
                        container.textContent = '[语音加载失败]';
                    };
                    container.appendChild(audio);
                } else {
                    container.textContent = '[无效的语音信息]';
                }
                break;

            case 'emoji':
                container.innerHTML = message.content;
                break;

            default:
                container.textContent = message.content || '[未知消息类型]';
        }
    }

    // 显示用户详细信息
    async showUserProfile(userId) {
        console.log('显示用户详细信息:', userId);
        if (!userId || userId === this.currentUser.id) {
            // 如果是当前用户，显示设置模态框
            this.showSettings();
            return;
        }

        try {
            const userData = await API.toggleGetUserProfile(userId);
            // 创建用户信息弹窗
            this.createUserProfileModal(userData);
        } catch (error) {
            console.error('获取用户信息失败:', error);
            this.showError('获取用户信息失败: ' + (error.message || '未知错误'));
            await this.checkLoginStatus();
        }
    }

    showProfile(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (room.room_type === 'private') {
            let otherUser = room.members.find(m => m.id !== this.currentUser.id);
            if (otherUser?.id) {
                this.showUserProfile(otherUser?.id);
            }
        } else if (room.room_type === 'group') {
            this.showGroupProfile(room);
        }
    }

    showGroupProfile(room) {
        if (room.creator !== this.currentUser.id) {
            this.showGroupMemberListModal(room)
            return;
        } else {
            this.showGroupManagementModal(room)
        }

    }


    // 修复：用户信息模态框改为宫格布局
    createUserProfileModal(userData) {
        // 关闭可能存在的其他模态框
        this.closeAllModals();

        const modal = document.createElement('div');
        modal.className = 'user-profile-modal show';
        modal.id = 'userProfileModal';

        // 清除之前该模态框
        this.clearModal(modal.id);

        // 格式化最后在线时间
        const formatLastSeen = (lastSeen) => {
            if (!lastSeen) return '从未登录';
            const date = new Date(lastSeen);
            const now = new Date();
            const diffTime = Math.abs(now - date);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                return '今天';
            } else if (diffDays === 1) {
                return '昨天';
            } else if (diffDays < 7) {
                return `${diffDays}天前`;
            } else {
                return date.toLocaleDateString('zh-CN');
            }
        };

        // 用户类型中文显示
        const userTypeMap = {
            'super_admin': '超级管理员',
            'admin': '管理员',
            'normal': '普通用户'
        };

        // 性别映射
        const genderMap = {
            'male': '男',
            'female': '女',
            'other': '其他'
        };

        modal.innerHTML = `
    <div class="modal-content">
        <div class="modal-header">
            <h3><i class="fas fa-user"></i> 用户信息</h3>
            <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
            <div class="profile-grid-container">
                <!-- 头像和基本信息宫格 -->
                <div class="profile-section profile-avatar-section">
                    <div class="profile-avatar-large">
                        <img src="${userData.avatar_url || '/static/images/default-avatar.png'}" alt="头像">
                    </div>
                    <div class="profile-basic-info">
                        <div class="profile-info-grid">
                            <div class="profile-info-item">
                                <label>账号:</label>
                                <span>${userData.username || '-'}</span>
                            </div>
                            <div class="profile-info-item">
                                <label>昵称:</label>
                                <span>${userData.real_name || '-'}</span>
                            </div>
                            <div class="profile-info-item">
                                <label>状态:</label>
                                <span class="profile-status ${userData.is_online ? 'online' : 'offline'}">
                                    ${userData.is_online ? '🟢 在线' : `🔴 离线 (${formatLastSeen(userData.last_seen)})`}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 基本信息宫格 -->
                <div class="profile-section">
                    <div class="profile-section-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-info-circle"></i>
                        </div>
                        <div class="profile-section-title">基本信息</div>
                    </div>
                    <div class="profile-info-grid">
                        <div class="profile-info-item">
                            <label>性别:</label>
                            <span>${genderMap[userData.gender] || '未设置'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>联系方式:</label>
                            <span>${userData.phone || '未设置'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>部门:</label>
                            <span>${userData.department_info?.name || userData.department || '未设置'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>职位:</label>
                            <span>${userData.position || '未设置'}</span>
                        </div>
                    </div>
                </div>

                <!-- 账户信息宫格 -->
                <div class="profile-section">
                    <div class="profile-section-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-user-shield"></i>
                        </div>
                        <div class="profile-section-title">账户信息</div>
                    </div>
                    <div class="profile-info-grid">
                        <div class="profile-info-item">
                            <label>用户类型:</label>
                            <span>${userTypeMap[userData.user_type] || '普通用户'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>邮箱:</label>
                            <span>${userData.email || '未设置'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>注册时间:</label>
                            <span>${userData.date_joined ? new Date(userData.date_joined).toLocaleDateString('zh-CN') : '未知'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>最近登录:</label>
                            <span>${formatLastSeen(userData.last_login)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="chatClient.closeModal('userProfileModal')">关闭</button>
            <button class="btn btn-primary" onclick="chatClient.startPrivateChat(${userData.id})">发起私聊</button>
        </div>
    </div>
    `;

        document.body.appendChild(modal);

        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        const closeButtons = modal.querySelectorAll('.btn-secondary, .btn-primary');

        closeBtn.onclick = () => this.closeModal('userProfileModal');
        closeButtons.forEach(btn => {
            btn.onclick = () => this.closeModal('userProfileModal');
        });

        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) this.closeModal('userProfileModal');
        };
    }

    // 开始私聊
    startPrivateChat(userId) {
        console.log("startPrivateChat: ", userId)
        if (!this.currentUser) {
            console.error('当前用户未登录');
            this.showError('当前用户未登录')
            return;
        }

        this.closeModal('userProfileModal');

        // 查找是否已有与该用户的私聊
        const existingRoom = this.chatRooms.find(room => {
            if (room.room_type === 'private' && room.members) {
                const memberIds = room.members.map(m => m.id.toString());
                return memberIds.includes(userId.toString()) &&
                    memberIds.includes(this.currentUser.id.toString());
            }
            return false;
        });

        if (existingRoom) {
            this.selectChatRoom(existingRoom.id);
        } else {
            // 创建新的私聊
            this.createPrivateChat([userId.toString()]);
        }

        // 关闭用户详情模态框
        this.closeModal('userProfileModal');
    }

    // 关闭所有模态框
    closeAllModals() {
        const modals = document.querySelectorAll('.modal.show');
        modals.forEach(modal => {
            modal.classList.remove('show');
        });

        const userProfileModals = document.querySelectorAll('.user-profile-modal.show');
        userProfileModals.forEach(modal => {
            modal.classList.remove('show');
        });

    }

    // 关闭指定模态框
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    }

    // 清除指定模态框
    clearModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.remove();
        }
    }

    // 打开指定模态框
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
        }
    }


    // 修复：打开新建聊天模态框
    openNewChatModal() {
        const newChatModal = document.getElementById('newChatModal');
        if (newChatModal) {
            newChatModal.classList.add('show');
            // 初始化模态框状态 - 默认显示私聊表单
            this.initNewChatModal();
        }
    }

    // 修复：初始化新建聊天模态框
    initNewChatModal() {
        // 重置表单状态 - 默认激活私聊
        document.querySelectorAll('.chat-type-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector('.chat-type-tabs .tab-btn[data-target="new-private-chat"]').classList.add('active');

        document.querySelectorAll('.chat-form').forEach(form => {
            form.classList.remove('active');
        });
        document.getElementById('new-private-chat').classList.add('active');

        // 清空表单
        document.getElementById('groupNameInput').value = '';
        document.getElementById('searchUserInput').value = '';
        document.getElementById('addGroupMemberInput').value = '';

        // 重置选中的成员
        this.selectedMembersForGroup = [];
        this.updateSelectedMembersDisplay();

        // 加载用户列表
        this.loadUsersForChat();
    }

    // 加载用户列表用于聊天创建
    async loadUsersForChat() {
        try {
            const response = await API.getUsers();
            this.usersForChat = Array.isArray(response) ? response : (response.results || []);
            this.renderUserSearchResults(this.usersForChat, 'userResults');
            this.renderMemberSearchResults(this.usersForChat);
        } catch (error) {
            console.error('加载用户列表失败:', error);
            this.showError('加载用户列表失败');
        }
    }

    // 渲染用户搜索结果（私聊）
    renderUserSearchResults(users, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = '';
        users.forEach(user => {
            if (user.id === this.currentUser.id) return; // 排除自己

            html += `
            <div class="user-list-item" data-user-id="${user.id}" onclick="chatClient.selectUserForPrivateChat(${user.id})">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" 
                     alt="${user.real_name || user.username}" class="user-list-avatar">
                <div class="user-list-info">
                    <div class="user-list-name">${user.real_name || user.username}</div>
                    <div class="user-list-department">
                        ${user.department_info?.name || user.department || ''} ${user.position || ''}
                    </div>
                </div>
            </div>
        `;
        });

        container.innerHTML = html || '<div class="empty-state"><p>暂无用户</p></div>';
    }

    // 渲染成员搜索结果（群聊）
    renderMemberSearchResults(users) {
        const container = document.getElementById('groupMemberResults');
        if (!container) return;

        let html = '';
        users.forEach(user => {
            if (user.id === this.currentUser.id) return; // 排除自己

            const isSelected = this.selectedMembersForGroup.includes(user.id);
            html += `
            <div class="member-list-item ${isSelected ? 'selected' : ''}" data-user-id="${user.id}">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" 
                     alt="${user.real_name || user.username}" class="member-list-avatar">
                <div class="member-list-info">
                    <div class="member-list-name">${user.real_name || user.username}</div>
                    <div class="member-list-department">
                        ${user.department_info?.name || user.department || ''} ${user.position || ''}
                    </div>
                </div>
            </div>
        `;
        });

        container.innerHTML = html || '<div class="empty-state"><p>暂无成员</p></div>';

        // 绑定成员点击事件
        document.querySelectorAll('.member-list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = parseInt(item.dataset.userId);
                this.toggleMemberSelection(userId);
            });
        });
    }

    // 选择用户进行私聊
    selectUserForPrivateChat(userId) {
        if (!userId || parseInt(userId) === parseInt(this.currentUser.id)) return;

        // 直接创建私聊
        this.createPrivateChat([userId.toString()]);
        this.closeModal('newChatModal');
    }

    // 切换成员选择状态
    toggleMemberSelection(userId) {
        const index = this.selectedMembersForGroup.indexOf(userId);
        if (index > -1) {
            this.selectedMembersForGroup.splice(index, 1);
        } else {
            this.selectedMembersForGroup.push(userId);
        }
        this.renderMemberSearchResults(this.usersForChat);
        this.updateSelectedMembersDisplay();
    }


    // 渲染用户列表（通讯录）
    // 在 renderUserList 方法中添加头像点击事件
    renderUserList() {
        const contactsList = document.getElementById('contactsList');
        if (!contactsList) return;

        const users = Array.isArray(this.users) ? this.users : [];

        let html = '';
        users.forEach(user => {
            console.log('user', user);
            console.log('user.id', user.id);
            console.log('this.currentUser.id', this.currentUser.id);

            if (user.id === this.currentUser.id) return; // 排除自己

            html += `
            <div class="user-list-item" data-user-id="${user.id}">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" 
                     alt="${user.real_name || user.username}" class="user-list-avatar" 
                     onclick="chatClient.showUserProfile(${user.id})">
                <div class="user-list-info">
                    <div class="user-list-name">${user.real_name || user.username}</div>
                    <div class="user-list-department">
                        ${user.department_info?.name || user.department || ''} - ${user.position || ''}
                    </div>
                </div>
                <div class="status ${user.online_status?.is_online ? 'online' : 'offline'}">
                    <span class="status-dot"> </span>
                    <span class="status-text">${user.online_status?.is_online ? '在线' : '离线'}</span>
                </div>
            </div>
        `;
        });

        contactsList.innerHTML = html || '<div class="empty-state"><p>暂无联系人</p></div>';
    }


    // 渲染群组列表
    renderGroups() {
        const groupsList = document.getElementById('groupsList');
        if (!groupsList) return;

        // 获取群组聊天室
        const groups = this.chatRooms.filter(room => room.room_type === 'group');

        let html = '';

        // 添加新建群组按钮作为第一项
        html += `
        <div class="group-item new-group-item" onclick="chatClient.openNewGroupModal()">
            <div class="group-avatar">
                <i class="fas fa-plus"></i>
            </div>
            <div class="group-info">
                <div class="group-title">新建群组</div>
                <div class="group-subtitle">点击创建新的群聊</div>
            </div>
        </div>
    `;

        if (groups.length === 0) {
            html += '<div class="empty-state"><p>暂无群组</p></div>';
        } else {
            groups.forEach(group => {
                const lastMessage = group.last_message || {};
                const unreadCount = group.unread_count || 0;

                html += `
                <div class="group-item" data-room-id="${group.id}" onclick="chatClient.selectChatRoom('${group.id}')">
                    <div class="group-avatar">
                        <img src="${group.avatar || '/static/images/group-avatar.png'}" alt="${group.display_name}">
                    </div>
                    <div class="group-info">
                        <div class="group-title">${group.display_name}</div>
                        <div class="group-subtitle">${lastMessage.content || '暂无消息'}</div>
                    </div>
                    <div class="group-meta">
                        <div class="group-time">${lastMessage.timestamp ? Utils.formatTime(lastMessage.timestamp) : ''}</div>
                        ${unreadCount > 0 ? `<div class="group-unread-count">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
                    </div>
                </div>
            `;
            });
        }

        groupsList.innerHTML = html;
    }

    // 修复：打开新建群组模态框
    openNewGroupModal() {
        const newChatModal = document.getElementById('newChatModal');
        if (!newChatModal) return;

        // 显示模态框
        newChatModal.classList.add('show');

        // 切换到群聊标签
        document.querySelectorAll('.chat-type-tabs .tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector('.chat-type-tabs .tab-btn[data-target="new-group-chat"]').classList.add('active');

        // 显示群聊表单
        document.querySelectorAll('.chat-form').forEach(form => {
            form.classList.remove('active');
        });
        document.getElementById('new-group-chat').classList.add('active');

        // 清空表单
        document.getElementById('groupNameInput').value = '';
        document.getElementById('addGroupMemberInput').value = '';

        // 重置选中的成员
        this.selectedMembersForGroup = [];
        this.updateSelectedMembersDisplay();

        // 加载用户列表
        this.loadUsersForChat();
    }


    hideSidebar() {
        console.log('Hiding sidebar')
        document.querySelector('.sidebar').classList.remove('show');
        this.isShowingSidebar = false;
    }

    showSidebar() {
        console.log('Opening sidebar')
        document.querySelector('.sidebar').classList.add('show');
        this.isShowingSidebar = true;
    }


    // 新增：切换侧边栏显示/隐藏
    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        if (sidebar.classList.contains('show')) {
            this.hideSidebar();
        } else {
            this.showSidebar();
        }
    }

    toggleHideSidebar() {
        if (this.isShowingSidebar) {
            this.hideSidebar();
        }
    }

    // 选择聊天室
    selectChatRoom(roomId) {
        console.log('选择聊天室:', roomId);

        // 隐藏侧边栏
        if (this.isShowingSidebar) {
            this.hideSidebar();
        }

        // 连接 WebSocket
        this.connectWebSocket(roomId);


        this.currentRoomId = roomId ? parseInt(roomId) : roomId;

        // 更新聊天室选中状态
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });

        const currentChatItem = document.querySelector(`.chat-item[data-room-id="${roomId}"]`);
        if (currentChatItem) {
            currentChatItem.classList.add('active');
        }

        // 加载聊天历史￼
        this.loadChatHistory(roomId).then(() => {

            // 标记消息为已读
            console.log('标记消息为已读 roomId:', roomId);
            // this.markMessagesAsRead(roomId);
            // this.renderChatHistory()
            this.markMessagesAsRead(roomId).then(() => {
                // 更新聊天室列表中的未读消息数
                const chatItem = document.querySelector(`.chat-item[data-room-id="${roomId}"]`);
                if (chatItem) {
                    const unreadCountElement = chatItem.querySelector('.chat-item-unread-count');
                    if (unreadCountElement) {
                        unreadCountElement.remove(); // 移除未读消息数显示
                    }
                }

                // 重新渲染聊天室列表以反映未读消息数的变化
                this.renderChatRooms();
            }).catch(error => {
                console.error('标记消息为已读失败:', error);
            });

            this.renderChatHistory()


        })


        // 显示聊天界面
        const messagesEmpty = document.getElementById('messagesEmpty');
        const messagesList = document.getElementById('messagesList');
        if (messagesEmpty) messagesEmpty.style.display = 'none';
        if (messagesList) messagesList.style.display = 'block';

        // 更新聊天头部
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        console.log('this.currentUser:', this.currentUser)
        console.log('room:', room)
        console.log('roomId:', roomId, ' room_type: ', room?.room_type)
        console.log('this.chatRooms:', this.chatRooms)

        if (room) {
            let roomName, roomAvatar, is_online = false;
            if (room.room_type === 'private') {
                roomName = room.display_name || room.members.find(m => m.id !== this.currentUser.id).real_name || room.members.find(m => m.id !== this.currentUser.id).username || '未知聊天室';
                roomAvatar = room.avatar || room.members.find(m => m.id !== this.currentUser.id).avatar_url || '/static/images/default-avatar.png';
                is_online = room.members.find(m => m.id !== this.currentUser.id)?.online_status?.is_online;
            } else {
                roomName = room.display_name || (room.members ? room.members.map(m => m.real_name || m.username).join(', ') : '未知群组');
                roomName = `${roomName} (${room.members ? room.members.length : 0})`
                roomAvatar = room.avatar || '/static/images/group-avatar.png';
                is_online = true;
                console.log('room.members is_online: ', is_online)
            }
            this.updateConnectionStatus(is_online, 'chatSubtitle')
            console.log('roomAvatar:', roomAvatar, ' is_online: ', is_online)


            const chatTitle = document.getElementById('chatTitle');
            const chatAvatar = document.getElementById('chatAvatar');
            // 清除点击事件

            if (chatTitle) {
                chatTitle.textContent = roomName;
            }
            if (chatAvatar) {
                chatAvatar.src = roomAvatar;

            }
        }

    }

    // 选择用户发起聊天（私聊）
    selectUserForChat(userId) {
        if (!userId || userId === this.currentUser.id) {
            return;
        }

        // 查找是否已有与该用户的私聊
        const existingRoom = this.chatRooms.find(room => {
            if (room.room_type === 'private' && room.members) {
                const memberIds = room.members.map(m => m.id.toString());
                return memberIds.includes(userId.toString()) &&
                    memberIds.includes(this.currentUser.id.toString());
            }
            return false;
        });

        if (existingRoom) {
            // 如果已存在，直接选择
            this.selectChatRoom(existingRoom.id);
        } else {
            // 如果不存在，创建新的私聊 - 确保 member_ids 是字符串数组
            this.createPrivateChat([userId.toString()]);
        }
    }

    // 创建私聊（确保唯一性）
    async createPrivateChat(memberIds) {
        try {
            // 确保 member_ids 是有效的字符串数组
            const validMemberIds = memberIds.filter(id => id && id.toString().trim());

            if (validMemberIds.length === 0) {
                this.showError('无效的用户ID');
                return;
            }

            // 发送创建请求（后端会处理唯一性检查）
            const response = await API.createChatRoom({
                room_type: 'private',
                member_ids: validMemberIds.map(id => parseInt(id))
            });

            console.log('私聊创建成功:', response)

            // 重新加载聊天室列表
            await this.loadChatRooms();

            // 自动选择聊天室
            const roomId = response.id;
            this.selectChatRoom(roomId);

            // // 自动选择新创建的聊天室
            // const newRoom = this.chatRooms.find(room =>
            //         room.members && room.members.some(m =>
            //             validMemberIds.includes(m.id.toString())
            //         )
            // );
            //
            // if (newRoom) {
            //     this.selectChatRoom(newRoom.id);
            // }

        } catch (error) {
            console.error('创建私聊失败:', error);
            this.showError('创建私聊失败: ' + (error.message || '未知错误'));
            await this.checkLoginStatus();
        }
    }

    // 创建群聊
    async createGroupChat(name, memberIds) {
        try {
            if (!name.trim()) {
                this.showError('请输入群组名称');
                return;
            }

            if (memberIds.length === 0) {
                this.showError('请至少选择一个成员');
                return;
            }

            const response = await API.createChatRoom({
                room_type: 'group',
                name: name,
                member_ids: memberIds.map(id => parseInt(id))
            });

            console.log('群聊创建成功:', response);

            // 重新加载聊天室列表
            await this.loadChatRooms();

            // 自动选择新创建的群聊
            const newRoom = this.chatRooms.find(room =>
                room.room_type === 'group' && room.name === name.trim()
            );

            if (newRoom) {
                this.selectChatRoom(newRoom.id);
            }

            this.closeModal('newChatModal');
            this.showSuccess('群聊创建成功');


        } catch (error) {
            console.error('创建群聊失败:', error);
            this.showError('创建群聊失败: ' + (error.message || '未知错误'));
            await this.checkLoginStatus();
        }
    }


// 修改 handleBackButtonClick 方法，只在移动端使用
    handleBackButtonClick() {
        console.log('返回按钮被点击（移动端）');

        // 清空当前聊天室
        this.currentRoomId = null;

        // 隐藏消息区域，显示空状态
        const messagesEmpty = document.getElementById('messagesEmpty');
        const messagesList = document.getElementById('messagesList');
        if (messagesEmpty) messagesEmpty.style.display = 'flex';
        if (messagesList) {
            messagesList.style.display = 'none';
            messagesList.innerHTML = '';
        }

        // 重置聊天头部
        const chatTitle = document.getElementById('chatTitle');
        const chatAvatar = document.getElementById('chatAvatar');
        const chatSubtitle = document.getElementById('chatSubtitle');

        if (chatTitle) {
            chatTitle.textContent = '选择聊天';
        }
        if (chatAvatar) {
            chatAvatar.src = '/static/images/default-avatar.png';
            // 移除所有事件监听
            const newAvatar = chatAvatar.cloneNode(true);
            chatAvatar.parentNode.replaceChild(newAvatar, chatAvatar);
        }
        if (chatSubtitle) {
            this.updateConnectionStatus(false, 'chatSubtitle');
        }

        // 移除所有聊天项的active状态
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });

        // 返回聊天列表（移动端）
        if (!this.isShowingSidebar) {
            this.showSidebar();
        }

        console.log('已返回聊天列表');
    }

    // 在 ChatClient 类中新增方法
    async computeFileMd5(file) {
        return new Promise((resolve) => {
            const spark = new SparkMD5.ArrayBuffer();
            const reader = new FileReader();

            reader.onload = (e) => {
                spark.append(e.target.result);
                resolve(spark.end());
            };

            reader.readAsArrayBuffer(file);
        });
    }

    async uploadFileWithDedup(file) {
        if (!Utils.isValidFileType(file)) {
            this.showError('不支持的文件类型');
            return null;
        }

        if (file.size > 50 * 1024 * 1024) {
            this.showError('文件大小不能超过50MB');
            return null;
        }

        // 1. 计算 MD5
        const md5 = await this.computeFileMd5(file);
        console.log('计算文件 MD5:', md5);

        // 2. 先检查是否已存在（GET /api/chat/upload/check/?md5=xxx）
        try {
            const checkRes = await fetch(`${API_BASE_URL}/chat/upload/check/?md5=${md5}`, {
                headers: TokenManager.getHeaders()
            });
            if (checkRes.ok) {
                const data = await checkRes.json();
                if (data.exists && data.url) {
                    console.log('命中缓存，复用已有文件:', data.url);
                    return {...data, md5};
                }
            }
        } catch (e) {
            console.warn('MD5 检查失败，继续上传:', e);
        }

        // 3. 上传新文件（带 MD5 参数）
        const formData = new FormData();
        formData.append('file', file);
        formData.append('md5', md5); // 后端用此做去重

        try {
            const response = await fetch(`${API_BASE_URL}/chat/upload/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${TokenManager.getToken()}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error('上传失败');
            }

            const result = await response.json();
            return {...result, md5};
        } catch (error) {
            console.error('文件上传失败:', error);
            this.showError('文件上传失败');
            return null;
        }
    }


    // 设置事件监听
    setupEventListeners() {
        // 发送按钮
        const sendBtn = document.getElementById('sendBtn');
        const messageInput = document.getElementById('messageInput');

        if (sendBtn) {
            sendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('sendBtn click')
                this.sendMessage();
            });
        }

        if (messageInput) {
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    console.log('messageInput keydown')
                    this.sendMessage();
                }
            });

            messageInput.addEventListener('input', () => {
                this.handleTyping();
                this.adjustTextareaHeight(messageInput);
            });
        }

        // 头像上传事件
        const avatarUpload = document.getElementById('avatarUpload');
        if (avatarUpload) {
            avatarUpload.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.previewAvatar(e.target.files[0]);
                }
            });
        }


        // 个人设置模态框头像点击事件
        const settingsAvatar = document.getElementById('settingsAvatar');
        if (settingsAvatar) {
            settingsAvatar.addEventListener('click', (e) => {
                e.preventDefault();
                this.openAvatarUpload();
            });
        }


        // 聊天列表点击事件
        document.addEventListener('click', (e) => {
            if (e.target.closest('.chat-item')) {
                const chatItem = e.target.closest('.chat-item');
                const roomId = chatItem.dataset.roomId;
                console.log('点击了聊天列表', roomId);
                if (roomId) {
                    this.selectChatRoom(roomId);
                }
            }
            // 用户列表点击
            else if (e.target.closest('.user-list-item')) {
                const userItem = e.target.closest('.user-list-item');
                const userId = userItem.dataset.userId;
                if (userId) {
                    this.selectUserForChat(userId);
                }
            }
            // 新建聊天按钮
            else if (e.target.closest('.empty-state .btn.btn-primary')) {
                this.openNewChatModal();
            }
        });

        // 用户操作按钮
        const userActionButtons = document.querySelectorAll('.user-actions .btn-icon');
        if (userActionButtons[0]) {
            userActionButtons[0].addEventListener('click', (e) => {
                e.preventDefault();
                this.showSettings();
            });
        }
        if (userActionButtons[1]) {
            userActionButtons[1].addEventListener('click', (e) => {
                e.preventDefault();
                this.logout();
            });
        }

        // 聊天头部操作按钮
        const headerButtons = document.querySelectorAll('.header-right .btn-icon');
        if (headerButtons.length >= 3) {
            headerButtons[0].addEventListener('click', (e) => {
                e.preventDefault();
                this.makeVoiceCall();
            });
            headerButtons[1].addEventListener('click', (e) => {
                e.preventDefault();
                this.makeVideoCall();
            });
            headerButtons[2].addEventListener('click', (e) => {
                e.preventDefault();
                this.showChatActions();
            });
        }

        // // 文件上传
        // const fileInput = document.getElementById('fileInput');
        // const fileUploadBtn = document.querySelector('.file-upload-btn');
        //
        // if (fileInput) {
        //     fileInput.addEventListener('change', (e) => {
        //         if (e.target.files.length > 0) {
        //             this.sendFile(e.target.files[0]);
        //         }
        //     });
        // }
        //
        // if (fileUploadBtn) {
        //     fileUploadBtn.addEventListener('click', (e) => {
        //         e.preventDefault();
        //         if (fileInput) {
        //             fileInput.click();
        //         }
        //     });
        // }


        // 文件上传事件
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    // 支持多文件上传
                    Array.from(e.target.files).forEach(file => {
                        this.sendFile(file);
                    });
                    // 重置 input 以便可以重新选择相同文件
                    e.target.value = '';
                }
            });
        }


        // // 图片按钮
        // const imageInput = document.querySelector('.input-actions .btn-icon:nth-child(2)');
        // if (imageInput) {
        //     imageInput.addEventListener('click', (e) => {
        //         e.preventDefault();
        //         this.openImageModal();
        //     });
        // }

        // 图片按钮
        const imageBtn = document.getElementById('imageBtn');
        if (imageBtn) {
            imageBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openImageModal();
            });
        }

        // 文件按钮
        const fileBtn = document.getElementById('fileBtn');
        if (fileBtn) {
            fileBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openFileModal()
            })
        }


        // 表情按钮事件
        const emojiBtn = document.getElementById('emojiBtn');
        const emojiPanel = document.getElementById('emojiPanel');
        if (emojiBtn && emojiPanel) {
            emojiBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (emojiPanel.style.display === 'block') {
                    emojiPanel.style.display = 'none';
                } else {
                    emojiPanel.style.display = 'block';

                    // 点击表情发送
                    emojiPanel.querySelectorAll('.emoji-item').forEach(item => {
                        item.onclick = (event) => {
                            const emoji = event.target.dataset.emoji;
                            this.sendEmoji(emoji);
                            emojiPanel.style.display = 'none';
                        };
                    });
                }
            });

            // 点击外部关闭表情面板
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.emoji-panel') && !e.target.closest('#emojiBtn')) {
                    emojiPanel.style.display = 'none';
                }
            });
        }


        // 语音按钮事件（简化版，实际项目可能需要录音功能）
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) {
            voiceBtn.addEventListener('click', (e) => {
                e.preventDefault();
                alert('语音消息功能将在后续版本中实现');
            });
        }


        // 搜索聊天
        const chatSearch = document.getElementById('chatSearch');
        if (chatSearch) {
            chatSearch.addEventListener('input', Utils.debounce((e) => {
                this.filterChatRooms(e.target.value);
            }, 300));
        }

        // 修复：返回按钮点击处理 - 电脑端切换侧边栏显示/隐藏
        const backBtn = document.getElementById('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault();

                // 电脑端（非移动端）切换侧边栏
                if (window.innerWidth > 768) {
                    this.toggleSidebar();
                }
                // 移动端返回聊天列表
                else {
                    this.handleBackButtonClick();
                }
            });
        }


        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
            messagesContainer.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleHideSidebar()
            })
        }


        // 修复：新建聊天模态框的tab切换，避免与侧边栏冲突
        document.querySelectorAll('.chat-type-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡到侧边栏
                document.querySelectorAll('.chat-type-tabs .tab-btn').forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');

                document.querySelectorAll('.chat-form').forEach(form => {
                    form.classList.remove('active');
                });

                const target = btn.dataset.target;
                document.getElementById(target).classList.add('active');

                // 切换到群聊时确保成员列表正确显示
                if (target === 'new-group-chat') {
                    this.renderMemberSearchResults(this.usersForChat);
                }
            });
        });

        // 修复：侧边栏tab切换
        document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');

                const tab = btn.dataset.tab;
                document.getElementById('chatList').classList.toggle('hidden', tab !== 'chats');
                document.getElementById('contactsList').classList.toggle('hidden', tab !== 'contacts');
                document.getElementById('groupsList').classList.toggle('hidden', tab !== 'groups');

                // 如果切换到群组标签，确保群组列表已渲染
                if (tab === 'groups') {
                    this.renderGroups();
                }
            });
        });

        // 模态框关闭
        document.querySelectorAll('.close-btn, .btn.btn-secondary').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.remove('show');
                }
            });
        });

        // 模态框主要按钮
        document.querySelectorAll('.btn.btn-primary').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    console.log('Modal button clicked:', modal.id);
                    if (modal.id === 'newChatModal') {
                        this.createChat();
                    } else if (modal.id === 'settingsModal') {
                        this.saveSettings();
                    }
                }
            });
        });

        // 回车键全局处理（移动端优化）
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.id === 'messageInput') {
                    e.preventDefault();
                    console.log('移动端优化 keypress click')
                    this.sendMessage();
                }
            }
        });

        // 设置新建聊天模态框事件监听
        this.setupNewChatModalListeners();
        // 初始化用户数据用于聊天创建
        this.loadUsersForChat();

    }

    // 移动端优化
    setupMobileOptimizations_v1() {
        // 触摸滑动返回
        let startX = 0;
        let startY = 0;

        document.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });

        document.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const diffX = endX - startX;
            const diffY = endY - startY;

            // 水平滑动且垂直滑动较小
            if (Math.abs(diffX) > 50 && Math.abs(diffY) < 30) {
                if (diffX > 0 && this.currentRoomId) {
                    // 向右滑动，返回聊天列表
                    this.currentRoomId = null;
                    document.getElementById('messagesEmpty').style.display = 'block';
                    document.getElementById('messagesList').style.display = 'none';
                }
            }
        });

        // 输入框聚焦时滚动到可视区域
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('focus', () => {
                setTimeout(() => {
                    messageInput.scrollIntoView({behavior: 'smooth', block: 'nearest'});
                }, 300);
            });
        }
    }


    // 手机端适配
    setupMobileOptimizations() {
        // 触摸滑动返回
        let startX = 0;
        document.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
        });

        document.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].clientX;
            const diffX = endX - startX;

            if (diffX > 50 && this.currentRoomId) {
                // 向右滑动返回聊天列表
                this.currentRoomId = null;
                document.getElementById('messagesEmpty').style.display = 'block';
                document.getElementById('messagesList').style.display = 'none';
            }
        });

        // 输入框聚焦时滚动到可视区域
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('focus', () => {
                setTimeout(() => {
                    messageInput.scrollIntoView({behavior: 'smooth', block: 'nearest'});
                }, 300);
            });
        }
    }

    // 调整文本框高度
    adjustTextareaHeight(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    // 过滤聊天室
    filterChatRooms(keyword) {
        console.log('0-this.chatRooms:', this.chatRooms);
        const filteredRooms = this.chatRooms.filter(room => {
            const name = room.display_name || (room.members ? room.members.map(m => m.real_name || m.username).join(' ') : '');
            return name.toLowerCase().includes(keyword.toLowerCase());
        });

        console.log('1-this.chatRooms:', this.chatRooms);
        console.log('keyword:', keyword);
        console.log('Filtered rooms:', filteredRooms);

        // 临时保存过滤结果
        const originalRooms = this.chatRooms;
        this.chatRooms = filteredRooms;
        this.renderChatRooms();
        this.chatRooms = originalRooms;

        console.log('2-this.chatRooms:', this.chatRooms);
    }

    // 修复：个人设置模态框改为宫格布局
    showSettings() {
        const settingsModal = document.getElementById('settingsModal');
        if (!settingsModal) {
            this.createSettingsModal();
        } else {
            settingsModal.classList.add('show');
        }

        // 填充表单数据
        this.populateSettingsForm();
    }

    createSettingsModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'settingsModal';

        modal.innerHTML = `
    <div class="modal-content">
        <div class="modal-header">
            <h3><i class="fas fa-cog"></i> 个人设置</h3>
            <button class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
            <div class="grid-container">
                <!-- 头像宫格 -->
                <div class="grid-item">
                    <div class="grid-item-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-image"></i>
                        </div>
                        <div class="grid-item-title">个人头像</div>
                    </div>
                    <div class="grid-item-content avatar-grid">
                        <div class="avatar-preview" onclick="chatClient.openAvatarUpload()">
                            <img id="settingsAvatar" src="/static/images/default-avatar.png" alt="头像">
                            <div class="avatar-upload-btn">
                                <i class="fas fa-camera"></i>
                            </div>
                            <input type="file" id="avatarUpload" accept="image/*" style="display:none;">
                        </div>
                        <small class="form-hint">点击头像上传新照片，支持JPG、PNG格式</small>
                    </div>
                </div>

                <!-- 基本信息宫格 -->
                <div class="grid-item">
                    <div class="grid-item-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="grid-item-title">基本信息</div>
                    </div>
                    <div class="grid-item-content">
                        <div class="form-group-grid">
                            <label><i class="fas fa-id-card"></i> 用户名</label>
                            <input type="text" id="settingsUsername" readonly>
                        </div>
                        <div class="form-group-grid">
                            <label><i class="fas fa-user-tag"></i> 真实姓名</label>
                            <input type="text" id="settingsRealName" placeholder="请输入真实姓名">
                        </div>
                        <div class="form-group-grid">
                            <label><i class="fas fa-envelope"></i> 邮箱</label>
                            <input type="email" id="settingsEmail" placeholder="请输入邮箱">
                        </div>
                        <div class="form-group-grid">
                            <label><i class="fas fa-phone"></i> 手机号</label>
                            <input type="tel" id="settingsPhone" placeholder="请输入手机号">
                        </div>
                    </div>
                </div>

                <!-- 工作信息宫格 -->
                <div class="grid-item">
                    <div class="grid-item-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-briefcase"></i>
                        </div>
                        <div class="grid-item-title">工作信息</div>
                    </div>
                    <div class="grid-item-content">
                        <div class="form-group-grid">
                            <label><i class="fas fa-building"></i> 部门</label>
                            <input type="text" id="settingsDepartment" placeholder="请输入部门" ${this.currentUser.user_type === 'normal' ? 'readonly' : ''}>
                        </div>
                        <div class="form-group-grid">
                            <label><i class="fas fa-user-tie"></i> 职位</label>
                            <input type="text" id="settingsPosition" placeholder="请输入职位" ${this.currentUser.user_type === 'normal' ? 'readonly' : ''}>
                        </div>
                    </div>
                </div>

                <!-- 通知设置宫格 -->
                <div class="grid-item">
                    <div class="grid-item-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-bell"></i>
                        </div>
                        <div class="grid-item-title">通知设置</div>
                    </div>
                    <div class="grid-item-content">
                        <div class="notification-grid">
                            <div class="notification-item">
                                <label>
                                    <i class="fas fa-bell"></i>
                                    桌面通知
                                </label>
                                <label class="switch">
                                    <input type="checkbox" id="desktopNotifications" checked>
                                    <span class="slider"></span>
                                </label>
                            </div>
                            <div class="notification-item">
                                <label>
                                    <i class="fas fa-volume-up"></i>
                                    声音提醒
                                </label>
                                <label class="switch">
                                    <input type="checkbox" id="soundNotifications" checked>
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="chatClient.closeModal('settingsModal')">取消</button>
            <button class="btn btn-primary" onclick="chatClient.saveSettings()">保存设置</button>
        </div>
    </div>
    `;

        document.body.appendChild(modal);

        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        closeBtn.onclick = () => this.closeModal('settingsModal');

        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) this.closeModal('settingsModal');
        };
    }

    populateSettingsForm() {
        if (!this.currentUser) return;

        document.getElementById('settingsUsername').value = this.currentUser.username || '';
        document.getElementById('settingsRealName').value = this.currentUser.real_name || '';
        document.getElementById('settingsEmail').value = this.currentUser.email || '';
        document.getElementById('settingsPhone').value = this.currentUser.phone || '';
        document.getElementById('settingsDepartment').value = this.currentUser.department_info?.name || this.currentUser.department || '';
        document.getElementById('settingsPosition').value = this.currentUser.position || '';

        const avatarImg = document.getElementById('settingsAvatar');
        if (avatarImg) {
            avatarImg.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        }

        // 恢复通知设置
        const desktopNotifications = localStorage.getItem('desktopNotifications') !== 'false';
        const soundNotifications = localStorage.getItem('soundNotifications') !== 'false';

        document.getElementById('desktopNotifications').checked = desktopNotifications;
        document.getElementById('soundNotifications').checked = soundNotifications;
    }


    openAvatarUpload() {
        const avatarUpload = document.getElementById('avatarUpload');
        if (avatarUpload) {
            avatarUpload.click();
        }
    }


    // 修复：个人设置 - 头像上传
    previewAvatar(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const settingsAvatar = document.getElementById('settingsAvatar');
            if (settingsAvatar) {
                settingsAvatar.src = e.target.result;
                // 保存文件引用以便后续上传
                this.avatarFileToUpload = file;
            }
        };
        reader.readAsDataURL(file);
    }


    // 预览图片（大图查看）
    previewImage(imageUrl) {
        if (!imageUrl) return;

        // 创建图片预览模态框
        const modal = document.createElement('div');
        modal.className = 'image-preview-modal';
        modal.innerHTML = `
            <div class="image-preview-content">
                <div class="image-preview-header">
                    <button class="close-btn" title="关闭">&times;</button>
                </div>
                <div class="image-preview-body">
                    <img src="${imageUrl}" alt="图片预览" class="preview-image">
                    <div class="image-preview-actions">
                        <button class="btn btn-secondary" onclick="chatClient.downloadImage('${imageUrl}')">
                            <i class="fas fa-download"></i> 下载
                        </button>
                        <button class="btn btn-primary" onclick="window.open('${imageUrl}', '_blank')">
                            <i class="fas fa-external-link-alt"></i> 在新窗口打开
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        closeBtn.addEventListener('click', () => modal.remove());

        // 点击外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // 键盘 ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') modal.remove();
        }, {once: true});
    }

    // 下载图片
    downloadImage(imageUrl) {
        try {
            const link = document.createElement('a');
            link.href = imageUrl;
            link.download = 'image_' + new Date().getTime() + '.jpg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('下载图片失败:', error);
            this.showError('下载图片失败');
        }
    }


    // 保存设置
    async saveSettings() {
        try {
            const formData = new FormData();

            // 获取用户输入的设置
            const realName = document.getElementById('settingsRealName').value;
            const phone = document.getElementById('settingsPhone').value;
            const email = document.getElementById('settingsEmail').value;
            const department = document.getElementById('settingsDepartment').value;
            const position = document.getElementById('settingsPosition').value;
            const avatarInput = document.getElementById('avatarUpload');

            // 验证邮箱格式
            if (email && !this.validateEmail(email)) {
                this.showError('请输入有效的邮箱地址');
                return;
            }

            // 验证手机号格式
            if (phone && !this.validatePhone(phone)) {
                this.showError('请输入有效的手机号码');
                return;
            }

            // 收集要更新的字段
            const updateData = {};
            if (realName !== this.currentUser.real_name) updateData.real_name = realName;
            if (phone !== this.currentUser.phone) updateData.phone = phone;
            if (email !== this.currentUser.email) updateData.email = email;


            // 检查权限 - 只有管理员以上才能修改部门和职位
            if (this.currentUser.user_type !== 'normal') {
                if (department !== this.currentUser.department) updateData.department = department;
                if (position !== this.currentUser.position) updateData.position = position;
            }


            let response;

            // 如果有文件上传或需要更新基本信息
            if (avatarInput.files.length > 0 || Object.keys(updateData).length > 0) {
                // 有文件上传，使用 multipart/form-data
                if (avatarInput.files.length > 0) {
                    formData.append('avatar', avatarInput.files[0]);
                }

                // 添加其他字段
                Object.keys(updateData).forEach(key => {
                    formData.append(key, updateData[key]);
                });

                response = await fetch('/api/auth/profile/', {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                    },
                    body: formData
                });
            } else {
                // 只更新基本信息，使用 JSON
                if (Object.keys(updateData).length > 0) {
                    response = await fetch('/api/auth/profile/', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                        },
                        body: JSON.stringify(updateData)
                    });
                } else {
                    // 没有更新内容
                    this.closeModal('settingsModal');
                    this.showSuccess('设置保存成功');
                    return;
                }
            }


            // // 检查用户权限 - 只有管理员以上才能修改部门和职位
            // if (this.currentUser.user_type === 'normal') {
            //     // 普通用户只能更新基本信息
            //     if (avatarInput.files.length > 0) {
            //         formData.append('avatar', avatarInput.files[0]);
            //     }
            //     if (real_name) formData.append('real_name', real_name);
            //     if (phone) formData.append('phone', phone);
            //     if (email) formData.append('email', email);
            //
            // } else {
            //     // 管理员可以更新所有信息
            //     if (avatarInput.files.length > 0) {
            //         formData.append('avatar', avatarInput.files[0]);
            //     }
            //     if (real_name) formData.append('real_name', real_name);
            //     if (phone) formData.append('phone', phone);
            //     if (email) formData.append('email', email);
            //     if (department) formData.append('department', department);
            //     if (position) formData.append('position', position);
            //
            // }
            //
            // console.log('currentUser.user_type:', this.currentUser.user_type);
            // console.log('department:', department);
            // console.log('position:', position);
            // console.log('real_name:', real_name);
            // console.log('phone:', phone);
            // console.log('email:', email);
            //
            // let response;
            // if (formData.has('avatar') || (this.currentUser.user_type !== 'normal' && (department || position || real_name || phone || email))) {
            //     console.log('有文件上传或管理员修改部门/职位，使用 multipart/form-data');
            //     // 有文件上传或管理员修改部门/职位，使用 multipart/form-data
            //     response = await fetch('/api/auth/profile/', {
            //         method: 'PUT',
            //         headers: {
            //             'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            //         },
            //         body: formData
            //     });
            // } else {
            //     console.log('没有文件上传或管理员修改部门/职位，使用 JSON');
            //     // 只更新基本信息，使用 JSON
            //     const userData = {};
            //     if (department && this.currentUser.user_type !== 'normal') userData.department = department;
            //     if (position && this.currentUser.user_type !== 'normal') userData.position = position;
            //     if (real_name) userData.real_name = real_name;
            //     if (phone) userData.phone = phone;
            //     if (email) userData.email = email;
            //
            //     console.log('userData:', userData);
            //
            //     response = await fetch('/api/auth/profile/', {
            //         method: 'PUT',
            //         headers: {
            //             'Content-Type': 'application/json',
            //             'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            //         },
            //         body: JSON.stringify(userData)
            //     });
            // }

            console.log('response:', response)

            if (response.ok) {
                const updatedUser = await response.json();
                this.currentUser = updatedUser;
                this.renderCurrentUser();


                // 保存通知设置
                const desktopNotifications = document.getElementById('desktopNotifications').checked;
                const soundNotifications = document.getElementById('soundNotifications').checked;

                localStorage.setItem('desktopNotifications', desktopNotifications.toString());
                localStorage.setItem('soundNotifications', soundNotifications.toString());


                this.closeModal('settingsModal');
                this.showSuccess('设置保存成功');
            } else {
                const errorData = await response.json();
                console.log('errorData:', errorData)
                throw new Error(errorData.detail || '保存失败');
            }
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showError('保存设置失败: ' + error.message);
        }
    }

    // 验证邮箱格式
    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

// 验证手机号格式
    validatePhone(phone) {
        if (!phone) return true;
        const re = /^1[3-9]\d{9}$/;
        return re.test(phone);
    }


    // 显示聊天操作
    showChatActions() {
        if (!this.currentRoomId) {
            this.showError('请先选择聊天室');
            return;
        }

        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
        if (!room) {
            this.showError('当前聊天室不存在');
            return;
        }


        // 创建操作菜单
        const actionsMenu = document.createElement('div');
        actionsMenu.className = 'chat-actions-menu';

        let menuHtml = `
        <div class="action-item" onclick="chatClient.clearChatHistory(${this.currentRoomId})">清空聊天记录</div>
        <div class="action-item" onclick="chatClient.pinChat(${this.currentRoomId})">${room.is_pinned ? '取消置顶' : '置顶聊天'}</div>
        <div class="action-item" onclick="chatClient.muteChat(${this.currentRoomId})">${room.is_muted ? '关闭免打扰' : '消息免打扰'}</div>
<!--        <div class="action-item" onclick="chatClient.muteNotifications(${this.currentRoomId})">${room.is_muted ? '关闭免打扰' : '消息免打扰'}</div>-->
    `;

        // 添加删除选项
        menuHtml += `<div class="action-item" onclick="chatClient.softDeleteChatRoom(${this.currentRoomId})">删除聊天</div>`;

        // 添加群聊管理选项
        if (room.room_type === 'group' && room.creator === this.currentUser.id) {
            menuHtml += `<div class="action-item" onclick="chatClient.showGroupManagementModal(${this.currentRoomId})">群聊管理</div>`;
        }

        menuHtml += '<div class="action-item" onclick="chatClient.closeActionsMenu()">取消</div>';

        actionsMenu.innerHTML = menuHtml;
        document.body.appendChild(actionsMenu);

        // 点击外部关闭菜单
        setTimeout(() => {
            document.addEventListener('click', this.closeActionsMenu.bind(this), {once: true});
        }, 100);

    }

    closeActionsMenu() {
        const menu = document.querySelector('.chat-actions-menu');
        if (menu) {
            menu.remove();
        }
    }

    // 打开图片模态框
    openImageModal() {
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.accept = 'image/*';
            fileInput.click();
        }
    }

    openFileModal() {
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.accept = '*';
            fileInput.click();
        }
    }

    // 存储已发送的文件哈希，用于去重
    sentFileHashes = new Set();

    // 发送文件（支持MD5去重）
    async sendFile(file) {
        if (!file) return;

        // 验证文件类型
        if (!Utils.isValidFileType(file)) {
            console.log('不支持的文件类型 type: ', file.type);
            this.showError('不支持的文件类型');
            return;
        }
        console.log('文件类型: ', file.type);

        // 文件大小限制（50MB）
        if (file.size > 50 * 1024 * 1024) {
            console.log('文件大小不能超过50MB, size: ', parseInt(file.size / 1024 / 1024));
            this.showError('文件大小不能超过50MB');
            return;
        }

        try {
            // 显示上传中状态
            const uploadingMessage = {
                id: Date.now(),
                uploading_id: Date.now(),
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: `正在上传文件: ${file.name}`,
                timestamp: new Date().toISOString(),
                is_read: true,
                chat_room: this.currentRoomId,
                message_type: this.getFileMessageType(file.type),
                file_info: {
                    name: file.name,
                    size: file.size,
                    url: '/static/images/uploading.gif', // 占位符
                    mime_type: file.type
                }
            };

            // 渲染上传中消息
            this.renderMessage(uploadingMessage, 'sent');

            // 上传文件
            const uploadResult = await API.uploadFile(file);


            // http形式发送文件消息
            // const sendMessageResult = await API.sendMessage({
            //     chat_room: this.currentRoomId,
            //     content: '',
            //     message_type: this.getFileMessageType(file.type),
            //     file_url: uploadResult.file_url,
            //     file_id: uploadResult.file_id,
            //     file_name: uploadResult.filename,
            //     file_size: uploadResult.size
            // });


            // 构建最终文件消息对象
            const finalMessage = {
                id: Date.now(),
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: '',
                file_id: uploadResult?.file_id || uploadResult?.id,
                timestamp: new Date().toISOString(),
                is_read: true,
                chat_room: this.currentRoomId,
                message_type: this.getFileMessageType(file.type),
                file_info: {
                    id: uploadResult?.file_id || uploadResult?.id,
                    name: uploadResult.filename,
                    size: uploadResult.size,
                    url: uploadResult.file_url,
                    mime_type: uploadResult.mime_type,
                    md5: uploadResult.md5
                }
            };

            // 替换上传中的消息为最终消息
            const uploadingElement = document.querySelector(`[uploading_id="${uploadingMessage.uploading_id}"]`);
            if (uploadingElement) {
                uploadingElement.parentElement.remove()
            }
            this.renderMessage(finalMessage, 'sent');

            // 通过 WebSocket 发送文件消息
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'chat_message',
                    content: '',
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    message_type: this.getFileMessageType(file.type),
                    file_info: finalMessage.file_info
                }));
                this.showSuccess(uploadResult.exists ? '文件发送成功（已存在）' : '文件发送成功');
            } else {
                // WebSocket 不可用时加入队列
                this.messageQueue.push({
                    chat_room: this.currentRoomId,
                    content: '',
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    message_type: this.getFileMessageType(file.type),
                    file_info: finalMessage.file_info
                });
                this.showError('网络连接不稳定，消息将在连接恢复后发送');
            }

            // 滚动到底部
            Utils.scrollToBottom(document.getElementById('messagesList'));

        } catch (error) {
            console.error('文件发送失败:', error);
            this.showError('文件发送失败: ' + (error.message || '未知错误'));

            // 删除上传中的消息
            const uploadingElement = document.querySelector(`[uploading_id="${uploadingMessage.uploading_id}"]`);
            if (uploadingElement) {
                uploadingElement.parentElement.remove();
            }
            await this.checkLoginStatus();
        }
    }


    // 发送图片
    async sendImage(file) {
        if (!file) return;

        // 验证是否为图片
        if (!file.type.startsWith('image/')) {
            this.showError('请选择图片文件');
            return;
        }

        await this.sendFile(file);
    }

    // 发送表情包
    async sendEmoji(emojiHtml) {
        if (!emojiHtml || !this.currentRoomId) {
            return;
        }

        try {
            const message = {
                id: Date.now(),
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: emojiHtml,
                timestamp: new Date().toISOString(),
                is_read: true,
                chat_room: this.currentRoomId,
                message_type: 'emoji'
            };

            // 本地渲染
            this.renderMessage(message, 'sent');
            Utils.scrollToBottom(document.getElementById('messagesList'));

            // 通过 WebSocket 发送
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'chat_message',
                    content: emojiHtml,
                    message_type: 'emoji'
                }));
            } else {
                // WebSocket 不可用时使用 HTTP
                console.log('WebSocket is not open. Using HTTP.');
                await API.sendMessage({
                    chat_room: this.currentRoomId,
                    content: emojiHtml,
                    message_type: 'emoji'
                });
            }

        } catch (error) {
            console.error('表情发送失败:', error);
            this.showError('表情发送失败');
        }
    }


// 获取文件类型
    getFileMessageType(fileType) {
        const type = fileType.toLowerCase();
        if (type.includes('image')) return 'image';
        if (type.includes('video')) return 'video';
        if (type.includes('audio')) return 'voice';
        return 'file';
    }


// 置顶聊天
    async pinChat(roomId) {
        try {
            roomId = roomId || this.currentRoomId;
            console.log('置顶聊天 roomId: ', roomId, ' type: ', typeof roomId);
            console.log('置顶聊天 currentRoomId: ', this.currentRoomId);

            const data = await API.togglePinChat(roomId);

            // 更新本地数据
            const room = this.chatRooms.find(r => r.id === parseInt(roomId));
            if (room) {
                room.is_pinned = data.is_pinned;
                this.renderChatRooms();
                this.closeActionsMenu();
            } else {
                this.showError('操作失败');
            }
        } catch (error) {
            console.error('置顶聊天 操作失败:', error);
            this.showError('操作失败');
            await this.checkLoginStatus();
        }
    }

// 消息免打扰
    async muteChat(roomId) {
        try {
            roomId = roomId || this.currentRoomId;
            console.log('消息免打扰 roomId: ', roomId, ' type: ', typeof roomId);
            console.log('消息免打扰 currentRoomId: ', this.currentRoomId);

            const data = await API.toggleMuteChat(roomId);

            const room = this.chatRooms.find(r => r.id === parseInt(roomId));
            if (room) {
                room.is_muted = data.is_muted;
                this.renderChatRooms();
                this.closeActionsMenu();
            } else {
                this.showError('操作失败');
            }
        } catch (error) {
            console.error('消息免打扰 操作失败:', error);
            this.showError('操作失败');
            await this.checkLoginStatus();
        }
    }


// 清空聊天记录
    async clearChatHistory(roomId) {
        if (!confirm('确定要清空聊天记录吗？')) return;

        roomId = roomId || this.currentRoomId;
        console.log('清空聊天记录 roomId: ', roomId, ' type: ', typeof roomId);
        console.log('清空聊天记录 currentRoomId: ', this.currentRoomId);


        try {
            await API.toggleClearChatHistory(roomId);

            this.messages = [];
            this.renderChatHistory();
            this.closeActionsMenu();
            this.showSuccess('聊天记录已清空');
        } catch (error) {
            console.error('清空失败:', error);
            this.showError('清空失败');
            await this.checkLoginStatus();
        }
    }

// 搜索聊天
    async searchChats(query) {
        if (!query.trim()) {
            this.renderChatRooms(); // 显示全部
            return;
        }

        try {
            const response = await API.toggleSearchChats(query);
            console.log('搜索结果 response:', response);
            this.chatRooms = Array.isArray(response) ? response : (response.results || []);
            console.log('搜索结果 this.chatRooms:', this.chatRooms);
            this.renderChatRooms();
        } catch (error) {
            console.error('搜索失败:', error);
            this.showError('搜索失败');
            await this.checkLoginStatus();
        }
    }

// 搜索用户（用于群组成员选择）
    async searchUsers(query) {
        if (!query.trim()) {
            // 显示所有用户
            this.renderUserList(); // 显示全部
            return;
        }

        try {
            const data = await API.toggleSearchUsers(query);

            // this.users = data;
            // this.renderUserList();

            this.membersForGroup = data;
            this.renderMemberList();

        } catch (error) {
            console.error('搜索用户失败:', error);
            this.showError('搜索用户失败');
            await this.checkLoginStatus();
        }
    }

// 渲染群组成员列表
    renderMemberList() {
        const memberList = document.getElementById('groupMemberResults');
        if (!memberList) return;

        const members = this.membersForGroup || this.users;
        let html = '';

        members.forEach(user => {
            if (user.id === this.currentUser.id) return; // 排除自己

            html += `
            <div class="member-list-item" data-user-id="${user.id}">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" 
                     alt="${user.real_name || user.username}" class="member-list-avatar">
                <div class="member-list-info">
                    <div class="member-list-name">${user.real_name || user.username}</div>
                    <div class="member-list-department">
                        ${user.department_info?.name || user.department || ''} ${user.position || ''}
                    </div>
                </div>
            </div>
        `;
        });

        memberList.innerHTML = html || '<div class="empty-state"><p>暂无成员</p></div>';

        // 绑定成员点击事件
        document.querySelectorAll('.member-list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                item.classList.toggle('selected');

                // 更新已选成员显示
                this.updateSelectedMembersDisplay();
            });
        });
    }

// 更新已选成员显示
    updateSelectedMembersDisplay() {
        const selectedMembersContainer = document.getElementById('selectedMembers');
        if (!selectedMembersContainer) return;

        let html = `
        <div class="selected-member">
            <span class="member-name">你</span>
            <span class="member-tag">创建者</span>
        </div>
    `;

        this.selectedMembersForGroup.forEach(userId => {
            const user = this.usersForChat.find(u => u.id === userId);
            if (user) {
                html += `
                <div class="selected-member">
                    <span class="member-name">${user.real_name || user.username}</span>
                    <span class="remove-member" data-user-id="${userId}">×</span>
                </div>
            `;
            }
        });

        selectedMembersContainer.innerHTML = html;

        // 绑定移除成员事件
        document.querySelectorAll('.remove-member').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = parseInt(btn.dataset.userId);
                this.toggleMemberSelection(userId);
            });
        });
    }


// 搜索用户（私聊）
    searchUsersForPrivate(query) {
        if (!query.trim()) {
            this.renderUserSearchResults(this.usersForChat, 'userResults');
            return;
        }

        const filteredUsers = this.usersForChat.filter(user => {
            if (user.id === this.currentUser.id) return false;
            return (user.username.toLowerCase().includes(query.toLowerCase()) ||
                (user.real_name && user.real_name.toLowerCase().includes(query.toLowerCase())) ||
                (user.department_info && user.department_info?.name.toLowerCase().includes(query.toLowerCase())) ||
                (user.position && user.position.toLowerCase().includes(query.toLowerCase())));
        });

        this.renderUserSearchResults(filteredUsers, 'userResults');
    }


// 搜索成员（群聊）
    searchMembersForGroup(query) {
        if (!query.trim()) {
            this.renderMemberSearchResults(this.usersForChat);
            return;
        }

        const filteredUsers = this.usersForChat.filter(user => {
            if (user.id === this.currentUser.id) return false;
            return (user.username.toLowerCase().includes(query.toLowerCase()) ||
                (user.real_name && user.real_name.toLowerCase().includes(query.toLowerCase())) ||
                (user.department_info && user.department_info?.name.toLowerCase().includes(query.toLowerCase())) ||
                (user.position && user.position.toLowerCase().includes(query.toLowerCase())));
        });

        this.renderMemberSearchResults(filteredUsers);
    }

// 创建聊天
    createChat() {
        const activeTab = document.querySelector('.chat-type-tabs .tab-btn.active');
        const targetType = activeTab.dataset.target;

        if (targetType === 'new-private-chat') {
            // 私聊应该在用户点击时直接创建，这里不应该被调用
            this.showError('请选择要私聊的用户');
            return;
        } else if (targetType === 'new-group-chat') {
            this.createGroupChatFromModal();
        }
    }


// 从模态框创建群聊
    createGroupChatFromModal() {
        const groupName = document.getElementById('groupNameInput').value.trim();
        const memberIds = [...this.selectedMembersForGroup];

        // 验证群组名称
        if (!groupName) {
            this.showError('请输入群组名称');
            document.getElementById('groupNameInput').classList.add('error');
            return;
        }

        if (groupName.length < 2 || groupName.length > 20) {
            this.showError('群组名称长度必须在2-20个字符之间');
            document.getElementById('groupNameInput').classList.add('error');
            return;
        }

        // 验证成员数量
        if (memberIds.length === 0) {
            this.showError('请至少选择一个成员');
            return;
        }

        // 清除错误状态
        document.getElementById('groupNameInput').classList.remove('error');

        // 创建群聊
        this.createGroupChat(groupName, memberIds);
    }

// 设置事件监听器（在 setupEventListeners 中添加）
    setupNewChatModalListeners() {
        // 标签切换
        document.querySelectorAll('.chat-type-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.chat-type-tabs.tab-btn').forEach(b => {
                    b.classList.remove('active');
                });
                btn.classList.add('active');

                document.querySelectorAll('.chat-form').forEach(form => {
                    form.classList.remove('active');
                });

                const target = btn.dataset.target;
                document.getElementById(target).classList.add('active');

                // 切换到群聊时确保成员列表正确显示
                if (target === 'new-group-chat') {
                    this.renderMemberSearchResults(this.usersForChat);
                }
            });
        });

        // 搜索用户（私聊）
        const searchUserInput = document.getElementById('searchUserInput');
        if (searchUserInput) {
            searchUserInput.addEventListener('input', (e) => {
                this.searchUsersForPrivate(e.target.value);
            });
        }

        // 搜索成员（群聊）
        const addGroupMemberInput = document.getElementById('addGroupMemberInput');
        if (addGroupMemberInput) {
            addGroupMemberInput.addEventListener('input', (e) => {
                this.searchMembersForGroup(e.target.value);
            });
        }

        // 群组名称输入验证
        const groupNameInput = document.getElementById('groupNameInput');
        if (groupNameInput) {
            groupNameInput.addEventListener('input', () => {
                groupNameInput.classList.remove('error');
            });
        }

        // 模态框关闭事件
        const newChatModal = document.getElementById('newChatModal');
        if (newChatModal) {
            newChatModal.addEventListener('click', (e) => {
                if (e.target === newChatModal) {
                    this.closeModal('newChatModal');
                }
            });

            const closeBtn = newChatModal.querySelector('.close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    this.closeModal('newChatModal');
                });
            }
        }
    }


// 在 ChatClient 类中添加以下方法

// 软删除聊天室
    async softDeleteChatRoom(roomId) {
        if (!confirm('确定要删除这个聊天吗？')) return;

        try {
            const response = await API.toggleDeleteChatRoom(roomId);

            console.log("软删除聊天室 response: ", response);
            console.log("软删除聊天室 response.ok: ", response.ok);

            if (response.ok) {
                // 从本地列表中移除
                this.chatRooms = this.chatRooms.filter(room => room.id !== parseInt(roomId));
                this.renderChatRooms();
                this.showSuccess('聊天已删除');

                // 如果当前正在查看这个聊天室，切换到空状态
                if (parseInt(this.currentRoomId) === parseInt(roomId)) {
                    this.currentRoomId = null;
                    document.getElementById('messagesEmpty').style.display = 'block';
                    document.getElementById('messagesList').style.display = 'none';

                    const chatTitle = document.getElementById('chatTitle');
                    const chatAvatar = document.getElementById('chatAvatar');
                    const chatStatus = document.getElementById('chatStatus');

                    if (chatTitle) {
                        chatTitle.textContent = '选择聊天';
                    }
                    if (chatAvatar) {
                        chatAvatar.src = '/static/images/default-avatar-offline.png';
                    }
                    this.updateConnectionStatus(false, 'chatSubtitle')
                    if (chatStatus) {
                        chatStatus.textContent = '未连接';
                    }

                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '删除失败');
            }
        } catch (error) {
            console.error('删除聊天失败:', error);
            this.showError('删除聊天失败: ' + error.message);
        }
    }

// 软删除消息
    async softDeleteMessage(messageId) {
        if (!confirm('确定要删除这条消息吗？')) return;

        try {
            const response = await fetch(`/api/chat/messages/${messageId}/soft_delete/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                // 从本地消息列表中移除
                this.messages = this.messages.filter(msg => msg.id !== parseInt(messageId));
                this.renderChatHistory();
                this.showSuccess('消息已删除');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '删除失败');
            }
        } catch (error) {
            console.error('删除消息失败:', error);
            this.showError('删除消息失败: ' + error.message);
        }
    }

// 清空聊天记录
    async clearChatHistory(roomId) {
        if (!confirm('确定要清空所有聊天记录吗？')) return;

        try {
            const response = await fetch('/api/chat/messages/clear_history/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({chat_room_id: roomId})
            });

            if (response.ok) {
                this.messages = [];
                this.renderChatHistory();
                this.showSuccess('聊天记录已清空');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '清空失败');
            }
        } catch (error) {
            console.error('清空聊天记录失败:', error);
            this.showError('清空聊天记录失败: ' + error.message);
        }
    }

// 更新群聊信息
    async updateGroupChat(roomId, name, memberIds) {
        try {
            const data = {};
            if (name !== undefined) data.name = name;
            if (memberIds !== undefined) data.member_ids = memberIds;

            const response = await fetch(`/api/chat/rooms/${roomId}/update_group/`, {
                method: 'PUT',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });

            if (response.ok) {
                const updatedRoom = await response.json();

                // 更新本地数据
                const roomIndex = this.chatRooms.findIndex(r => r.id === parseInt(roomId));
                if (roomIndex !== -1) {
                    this.chatRooms[roomIndex] = updatedRoom;
                    this.renderChatRooms();
                }

                this.showSuccess('群聊信息已更新');
                return updatedRoom;
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '更新失败');
            }
        } catch (error) {
            console.error('更新群聊失败:', error);
            this.showError('更新群聊失败: ' + error.message);
            throw error;
        }
    }


    // 修复：显示群聊管理模态框
    showGroupManagementModal(room) {
        let roomId = typeof room === 'object' ? room.id : room;

        if (typeof room === 'object') {
            roomId = room.id;
        } else {
            roomId = room;
            room = this.chatRooms.find(r => r.id === parseInt(roomId));
        }

        // 创建群聊管理模态框
        const modal = document.createElement('div');
        modal.className = 'modal group-management-modal';
        modal.id = 'groupManagementModal';

        this.clearModal(modal.id);

        modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>群聊管理 - ${room.name || room.display_name}</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>群聊名称</label>
                    <input type="text" id="groupManageName" value="${room.name || room.display_name}" maxlength="50">
                </div>
                
                <div class="form-group">
                    <label>群成员 (${room.members ? room.members.length : 0})</label>
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索成员..." id="groupManageSearch">
                    </div>
                    <div class="member-list" id="groupManageMembers">
                        <!-- 成员列表将动态生成 -->
                    </div>
                </div>
                
                <div class="form-group">
                    <label>添加成员</label>
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索用户添加到群聊..." id="addMemberSearch">
                    </div>
                    <div class="member-results" id="addMemberResults">
                        <!-- 可添加的成员列表 -->
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-danger" onclick="chatClient.deleteGroupChat(${roomId})">删除群聊</button>
                <button class="btn btn-secondary" onclick="chatClient.closeModal('groupManagementModal')">取消</button>
                <button class="btn btn-primary" onclick="chatClient.saveGroupChanges(${roomId})">保存</button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // 显示模态框
        this.openModal('groupManagementModal');

        // 加载成员列表
        this.loadGroupMembersForManagement(roomId);

        // 加载可添加的成员列表
        this.loadAvailableMembersForGroup(roomId);

        // 绑定搜索事件
        document.getElementById('groupManageSearch').addEventListener('input', (e) => {
            this.searchGroupMembers(e.target.value, roomId);
        });

        document.getElementById('addMemberSearch').addEventListener('input', (e) => {
            this.searchAvailableMembers(e.target.value, roomId);
        });

        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeModal('groupManagementModal');
        }

        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeModal('groupManagementModal');
            }
        };
    }


    // 非群主查看群成员列表模态框
    showGroupMemberListModal(room) {
        let roomId = room.id;

        // 创建群聊管理模态框
        const modal = document.createElement('div');
        modal.className = 'modal group-management-modal';
        modal.id = 'groupManagementModal';

        this.clearModal(modal.id);

        modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>群聊 - ${room.name || room.display_name}</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label>群聊名称</label>
                    <input type="text" id="groupManageName" value="${room.name || room.display_name}" maxlength="50">
                </div>
                
                <div class="form-group">
                    <label>群成员 (${room.members ? room.members.length : 0})</label>
                    <div class="search-box">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索成员..." id="groupManageSearch">
                    </div>
                    <div class="member-list" id="groupManageMembers">
                        <!-- 成员列表将动态生成 -->
                    </div>
                </div>
                
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="chatClient.closeModal('groupManagementModal')">确定</button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // 显示模态框
        this.openModal('groupManagementModal');

        // 加载成员列表
        this.loadGroupMembersForManagement(roomId);

        // 加载可添加的成员列表
        this.loadAvailableMembersForGroup(roomId);

        // 绑定搜索事件
        document.getElementById('groupManageSearch').addEventListener('input', (e) => {
            this.searchGroupMembers(e.target.value, roomId);
        });

        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeModal('groupManagementModal');
        }

        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) {
                this.closeModal('groupManagementModal');
            }
        };
    }


    // 修复：加载群聊成员用于管理（宫格布局）
    loadGroupMembersForManagement(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || !room.members) {
            console.error('未找到群聊或成员列表');
            return;
        }

        const membersContainer = document.getElementById('groupManageMembers');
        if (!membersContainer) return;

        let html = '<div class="member-grid">';
        room.members.forEach(member => {
            const isCreator = member.id === room.creator;
            html += `
            <div class="member-grid-item ${isCreator ? 'creator' : ''}" data-member-id="${member.id}">
                <div class="member-grid-avatar">
                    <img src="${member.avatar_url || '/static/images/default-avatar.png'}" alt="${member.username}">
                </div>
                <div class="member-grid-name">${member.real_name || member.username}</div>
                ${isCreator ? '<div class="member-grid-tag">群主</div>' : ''}
                ${!isCreator ? `<button class="btn-remove" onclick="chatClient.removeGroupMember(${roomId}, ${member.id})" title="移除成员">×</button>` : ''}
            </div>
            `;
        });
        html += '</div>';

        membersContainer.innerHTML = html || '<div class="empty-state"><p>暂无成员</p></div>';
    }

    // 修复：加载可添加的成员
    loadAvailableMembersForGroup(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room) return;

        // 获取当前群成员的ID
        const currentMemberIds = room.members ? room.members.map(m => m.id) : [];

        // 过滤出不在群里的用户
        const availableMembers = this.users.filter(user =>
            user.id !== this.currentUser.id &&
            !currentMemberIds.includes(user.id)
        );

        this.renderAvailableMembers(availableMembers);
    }


    // 修复：渲染可添加的成员（宫格布局）
    renderAvailableMembers(members) {
        const container = document.getElementById('addMemberResults');
        if (!container) return;

        let html = '<div class="member-grid">';
        members.forEach(user => {
            html += `
        <div class="member-grid-item" data-user-id="${user.id}" onclick="chatClient.addMemberToGroup(${user.id})">
            <div class="member-grid-avatar">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="${user.real_name || user.username}">
            </div>
            <div class="member-grid-name">${user.real_name || user.username}</div>
            <button class="btn btn-primary btn-small">添加</button>
        </div>
        `;
        });
        html += '</div>';

        container.innerHTML = html || '<div class="empty-state"><p>暂无可添加的成员</p></div>';
    }

    // 修复：搜索可添加的成员
    searchAvailableMembers(query, roomId) {
        if (!query.trim()) {
            this.loadAvailableMembersForGroup(roomId);
            return;
        }

        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room) return;

        const currentMemberIds = room.members ? room.members.map(m => m.id) : [];

        const filteredMembers = this.users.filter(user =>
            user.id !== this.currentUser.id &&
            !currentMemberIds.includes(user.id) &&
            (
                user.username.toLowerCase().includes(query.toLowerCase()) ||
                (user.real_name && user.real_name.toLowerCase().includes(query.toLowerCase())) ||
                (user.department_info?.name && user.department_info.name.toLowerCase().includes(query.toLowerCase())) ||
                (user.position && user.position.toLowerCase().includes(query.toLowerCase()))
            )
        );

        this.renderAvailableMembers(filteredMembers);
    }

    // 修复：添加成员到群聊
    async addMemberToGroup(userId) {
        if (!this.currentRoomId) {
            this.showError('请先选择群聊');
            return;
        }

        try {
            const response = await fetch(`/api/chat/rooms/${this.currentRoomId}/add_member/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({member_id: userId})
            });

            if (response.ok) {
                // 重新加载聊天室信息
                await this.loadChatRooms();
                // 刷新成员列表
                this.loadGroupMembersForManagement(this.currentRoomId);
                this.loadAvailableMembersForGroup(this.currentRoomId);
                this.showSuccess('成员添加成功');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '添加失败');
            }
        } catch (error) {
            console.error('添加成员失败:', error);
            this.showError('添加成员失败: ' + error.message);
        }
    }


    // 修复：搜索群聊成员
    searchGroupMembers(query, roomId) {
        if (!query.trim()) {
            this.loadGroupMembersForManagement(roomId);
            return;
        }

        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || !room.members) return;

        const filteredMembers = room.members.filter(member =>
            member.username.toLowerCase().includes(query.toLowerCase()) ||
            (member.real_name && member.real_name.toLowerCase().includes(query.toLowerCase()))
        );

        const membersContainer = document.getElementById('groupManageMembers');
        if (!membersContainer) return;

        let html = '';
        filteredMembers.forEach(member => {
            const isCreator = member.id === room.creator;
            html += `
            <div class="member-item" data-member-id="${member.id}">
                <img src="${member.avatar_url || '/static/images/default-avatar.png'}" alt="${member.username}">
                <div class="member-info">
                    <div class="member-name">${member.real_name || member.username}</div>
                    ${isCreator ? '<span class="member-tag">群主</span>' : ''}
                </div>
                ${!isCreator ? `<button class="btn-remove" onclick="chatClient.removeGroupMember(${roomId}, ${member.id})">×</button>` : ''}
            </div>
        `;
        });

        membersContainer.innerHTML = html || '<div class="empty-state"><p>未找到成员</p></div>';
    }


    // 删除群聊
    async deleteGroupChat(roomId) {
        if (!confirm('确定要删除整个群聊吗？此操作不可恢复！')) return;

        try {
            const response = await fetch(`/api/chat/rooms/${roomId}/soft_delete/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                this.chatRooms = this.chatRooms.filter(room => room.id !== roomId);
                this.renderChatRooms();
                this.closeModal('groupManagementModal');
                this.showSuccess('群聊已删除');

                if (parseInt(this.currentRoomId) === parseInt(roomId)) {
                    this.currentRoomId = null;
                    document.getElementById('messagesEmpty').style.display = 'block';
                    document.getElementById('messagesList').style.display = 'none';
                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '删除失败');
            }
        } catch (error) {
            console.error('删除群聊失败:', error);
            this.showError('删除群聊失败: ' + error.message);
        }
    }

    // 保存群聊更改
    async saveGroupChanges(roomId) {
        const groupName = document.getElementById('groupManageName').value.trim();
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));

        if (!groupName) {
            this.showError('请输入群聊名称');
            return;
        }

        if (groupName.length < 2 || groupName.length > 50) {
            this.showError('群聊名称长度必须在2-50个字符之间');
            return;
        }

        // 获取当前成员列表
        const currentMembers = room.members.map(m => m.id);

        try {
            await this.updateGroupChat(roomId, groupName, currentMembers);
            this.closeModal('groupManagementModal');
        } catch (error) {
            // 错误已在 updateGroupChat 中处理
        }
    }

    // 移除群聊成员
    async removeGroupMember(roomId, memberId) {
        if (!confirm('确定要移除该成员吗？')) return;

        try {
            const response = await fetch(`/api/chat/rooms/${roomId}/remove_member/`, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({member_id: memberId})
            });

            if (response.ok) {
                // 重新加载群聊信息
                await this.loadChatRooms();
                this.loadGroupMembersForManagement(roomId);
                this.showSuccess('成员已移除');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || '移除失败');
            }
        } catch (error) {
            console.error('移除成员失败:', error);
            this.showError('移除成员失败: ' + error.message);
        }
    }

    // 在消息右键菜单中添加删除选项
    createMessageContextMenu(messageId, isOwnMessage, chatRoom) {
        const menu = document.createElement('div');
        menu.className = 'context-menu';

        let menuItems = '';

        if (isOwnMessage || (chatRoom && chatRoom.creator === this.currentUser.id)) {
            menuItems += `<div class="menu-item" onclick="chatClient.softDeleteMessage(${messageId})">删除消息</div>`;
        }

        if (chatRoom && chatRoom.room_type === 'group' && chatRoom.creator === this.currentUser.id) {
            menuItems += `<div class="menu-item" onclick="chatClient.showGroupManagementModal(${this.currentRoomId})">群聊管理</div>`;
        }

        menu.innerHTML = menuItems;

        if (!menuItems) return; // 没有菜单项则不显示

        document.body.appendChild(menu);

        // 定位菜单
        const rect = event.target.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY}px`;
        menu.style.left = `${rect.left + window.scrollX}px`;

        // 点击外部关闭
        setTimeout(() => {
            document.addEventListener('click', () => {
                if (menu.parentNode) {
                    menu.parentNode.removeChild(menu);
                }
            }, {once: true});
        }, 10);
    }


// 退出登录
    async logout() {
        if (confirm('确定要退出登录吗？')) {
            localStorage.removeItem('access_token');
            if (this.ws) {
                this.ws.close();
            }
            window.location.href = '/login/';
        }
    }

// 语音通话
    makeVoiceCall() {
        alert('语音通话功能开发中...');
    }

// 视频通话
    makeVideoCall() {
        alert('视频通话功能开发中...');
    }

// 显示错误
    showError(message) {
        console.error('显示错误:', message);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'toast toast-error';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);

        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 3000);
    }

// 显示成功
    showSuccess(message) {
        console.log('显示成功:', message);
        const successDiv = document.createElement('div');
        successDiv.className = 'toast toast-success';
        successDiv.textContent = message;
        document.body.appendChild(successDiv);

        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
    }

// 更新连接状态
    updateConnectionStatus(isConnected, elementId = 'userStatus') {
        const userStatus = document.getElementById(elementId);
        if (userStatus) {
            const statusText = userStatus.querySelector('.status-text');
            if (isConnected) {
                userStatus.className = 'status online';
                if (statusText) statusText.textContent = '在线';
            } else {
                userStatus.className = 'status offline';
                if (statusText) statusText.textContent = '离线';
            }
        }
    }

// 更新未读消息数（在聊天室列表中显示）
    updateUnreadCount(roomId, increment) {

        this.loadChatRooms()

        // const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        // if (room) {
        //     room.unread_count = Math.max(0, (room.unread_count || 0) + increment);
        //     this.renderChatRooms(); // 重新渲染聊天室列表
        // }
    }

// 当选择聊天室时，标记所有消息为已读
    async markMessagesAsRead(roomId) {
        if (!roomId) return;

        try {
            // 获取当前聊天室的所有未读消息ID
            const unreadMessages = this.messages.filter(msg =>
                !msg.is_read && parseInt(msg.chat_room) === parseInt(roomId)
            );

            console.log('未读消息 unreadMessages:', unreadMessages);
            console.log('this.messages:', this.messages);
            console.log('roomId:', roomId, " type: ", typeof roomId);


            if (unreadMessages.length > 0) {
                const messageIds = unreadMessages.map(msg => msg.id);

                // 调用 API 标记为已读
                await API.toggleMarkMessagesAsRead(messageIds, roomId);

                // 更新本地消息状态
                unreadMessages.forEach(msg => {
                    msg.is_read = true;
                });

                // 更新聊天室未读数
                const room = this.chatRooms.find(r => r.id === parseInt(roomId));
                if (room) {
                    room.unread_count = 0;

                    this.loadChatRooms()
                }
            }
        } catch (error) {
            console.error('标记消息为已读失败:', error);
            await this.checkLoginStatus();
        }
    }

}

// 初始化全局实例
let chatClient = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM 加载完成，创建 ChatClient 实例');
    chatClient = new ChatClient();
    window.chatClient = chatClient;
});

// 如果页面已经加载完成
if (document.readyState === 'complete') {
    console.log('页面已加载完成，立即创建 ChatClient 实例');
    chatClient = new ChatClient();
    window.chatClient = chatClient;
}