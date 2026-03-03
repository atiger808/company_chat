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
        this.departments = [];
        this.membersForGroup = [];
        this.isTyping = false;
        this.typingTimeout = null;
        this.messageQueue = []; // 消息队列，用于离线消息
        this.isConnected = false;
        this.isShowingSidebar = true // 移动端侧边栏切换
        // 新建聊天相关变量
        this.usersForChat = [];
        this.selectedMembersForGroup = [];

        this.currentSearchTab = 'chats'; // 默认搜索聊天
        this.searchResults = [];

        // 消息加载状态
        // 🔧 无限滚动状态
        this.isInitialLoad = true;      // 是否为首次加载
        this.isLoadingMore = false;     // 是否正在加载更多
        this.hasMoreMessages = true;    // 是否还有更多历史消息
        this.oldestMessageId = null;    // 最早消息的ID
        this.newestMessageId = null;    // 最新消息的ID


        // 消息通知队列
        this.notificationQueue = [];
        this.isNotificationVisible = false;

        // 当前引用的消息
        this.currentQuoteMessage = null;

        // 当前@面板状态
        this.isAtPanelOpen = false;
        this.atPanelPosition = null;

        // 防止重复创建聊天室的状态
        this.creatingChatMap = new Map(); // userId -> {timestamp, roomId}
        this.chatCreationLock = false; // 全局创建锁


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


    // 检测是否为 iOS 设备
    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    // 修复 iOS Safari 输入框遮挡问题
    fixIOSSafariInput() {
        if (!this.isIOS()) return;

        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;

        // 添加 iOS 专用样式类
        document.querySelector('.chat-container')?.classList.add('ios-fix');

        // 监听输入框焦点事件
        messageInput.addEventListener('focus', () => {
            // 延迟滚动确保软键盘完全弹出
            setTimeout(() => {
                // 滚动到输入框位置
                messageInput.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'nearest'
                });

                // 额外滚动补偿（iOS 需要）
                window.scrollTo(0, window.scrollY - 100);
            }, 400);
        });

        // 监听 resize 事件（软键盘弹出/收起）
        let lastHeight = window.innerHeight;
        window.addEventListener('resize', () => {
            const newHeight = window.innerHeight;
            const heightDiff = lastHeight - newHeight;

            // 软键盘弹出（高度减少超过100px）
            if (heightDiff > 100 && document.activeElement === messageInput) {
                setTimeout(() => {
                    messageInput.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest'
                    });
                    window.scrollTo(0, window.scrollY - 100);
                }, 300);
            }

            lastHeight = newHeight;
        });

        // 禁用 iOS 双击缩放
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        }, {passive: false});
    }


    // 检测是否为PWA standalone模式
    isPWAStandaloneMode() {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true;
    }

    // 修复iOS PWA布局
    fixPWALayout() {
        if (!this.isIOS()) return;

        // 检测是否为standalone模式
        if (this.isPWAStandaloneMode()) {
            console.log('检测到 PWA standalone 模式');

            // 添加PWA样式类
            document.body.classList.add('pwa-mode');

            // // 调整header高度
            // const headers = document.querySelectorAll('.sidebar-header, .chat-header');
            // headers.forEach(header => {
            //     header.style.paddingTop = 'max(20px, env(safe-area-inset-top))';
            // });
            //
            // // 调整输入区域
            // const inputArea = document.querySelector('.chat-input-area');
            // if (inputArea) {
            //     inputArea.style.paddingBottom = 'max(12px, env(safe-area-inset-bottom))';
            // }


            // 确保侧边栏顶部铺满屏幕
            const sidebarHeader = document.querySelector('.sidebar-header');
            if (sidebarHeader) {
                sidebarHeader.style.position = 'fixed';
                sidebarHeader.style.top = '0';
                sidebarHeader.style.left = '0';
                sidebarHeader.style.right = '0';
                sidebarHeader.style.zIndex = '100';

                // // 添加安全区域处理
                // const safeAreaTop = window.getComputedStyle(document.body).getPropertyValue('env(safe-area-inset-top)');
                // if (safeAreaTop && safeAreaTop !== '0px') {
                //     sidebarHeader.style.paddingTop = `max(20px, ${safeAreaTop})`;
                // }
            }

            // 确保聊天区域不被遮挡
            const chatHeader = document.querySelector('.chat-header');
            if (chatHeader) {
                chatHeader.style.position = 'fixed';
                chatHeader.style.top = '0';
                chatHeader.style.left = '0';
                chatHeader.style.right = '0';
                chatHeader.style.zIndex = '100';
            }

            // 调整输入区域
            const inputArea = document.querySelector('.chat-input-area');
            if (inputArea) {
                inputArea.style.paddingBottom = 'max(20px, env(safe-area-inset-bottom))';
            }

        }
    }


    async init() {
        console.log('ChatClient 初始化开始...');

        // 检查登录状态
        await this.checkLoginStatus();

        try {

            // 初始化通知系统（用户交互后）
            this.initNotificationSystem();


            // 初始化角标
            this.updateAppBadge(0);

            // 监听页面可见性变化，当页面获得焦点时清除角标闪烁
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.stopTitleBlink();

                    // 更新角标（可能有新消息）
                    const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                    this.updateAppBadge(totalUnread);
                }
            });


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
                const adminConsoleBtn = document.getElementById('adminConsoleBtn');
                if (adminConsoleBtn) {
                    adminConsoleBtn.style.display = 'flex';
                    adminConsoleBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        window.location.href = '/control/';
                        // 以新页面形式打开
                        // window.open('/control/', '_blank');
                    });
                }
            }

            // 连接全局 WebSocket
            this.connectGlobalWebSocket();

            // 获取聊天列表
            await this.loadChatRooms();

            // 加载用户列表
            await this.loadUsers();

            // 加载部门列表
            await this.loadDepartments();

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

            // 🔧 关键修复：调用 iOS 专用修复
            this.fixIOSSafariInput();

            // 修复iOS PWA布局
            this.fixPWALayout();

            // 恢复滚动位置（页面刷新后）
            this.restoreScrollPosition();

            // 设置@功能监听
            this.setupAtMentionListener();

            // 设置无限滚动
            this.setupInfiniteScroll();

            // 初始化直达底部按钮
            this.initScrollToBottomButton();

            // 设置用户交互监听器以恢复音频
            this.setupUserInteractionListeners();

            console.log('ChatClient 初始化完成');
        } catch
            (error) {
            console.error('初始化失败:', error);
            this.showError('初始化失败，请重新登录: ' + error);
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
            case 'user_online_status':
                // 🔧 新增：处理用户在线状态变化
                this.handleUserOnlineStatus(data);
                break;
            default:
                console.log('Unknown global message type:', data.type);
        }
    }

    // 处理新消息通知（全局WebSocket）
    handleNewGlobalMessage(data) {
        console.log('Received global message:', data);

        // 🔧 关键修复13: 更新聊天室列表中的未读数和最后一条消息
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(data.chat_room));
        if (room) {
            // 更新最后一条消息
            room.last_message = {
                content: data.content,
                timestamp: data.timestamp,
                sender: data.sender
            };
            room.updated_at = data.timestamp;

            // 仅当不是当前聊天室时增加未读数
            if (!this.currentRoomId || parseInt(this.currentRoomId) !== parseInt(data.chat_room)) {
                room.unread_count = (room.unread_count || 0) + 1;
            }

            // 🔧 关键修复：直接使用后端返回的未读数
            // 注意：这里我们不直接增加未读数，而是重新获取
            this.fetchUnreadCountForRoom(data.chat_room);

            // 重新渲染聊天室列表
            this.renderChatRooms();
            this.renderGroups();
        } else {
            // 聊天室不存在，重新加载列表
            this.loadChatRooms();
        }

        if (this.shouldPlayNotificationSound()) {
            console.log('播放提示音');
            this.playNotificationSound();
        }

        // 播放提示音和显示通知（仅非当前聊天室）
        if (!this.currentRoomId || parseInt(this.currentRoomId) !== parseInt(data.chat_room)) {
            console.log('非当前聊天室 通知: this.shouldShowDesktopNotification:', this.shouldShowDesktopNotification());

            if (this.shouldShowDesktopNotification()) {

                // Utils.showNotification(data.sender_name, {
                //     body: data.content,
                //     icon: data.sender?.avatar_url || '/static/images/default-avatar.png'
                // });

                console.log('显示通知');

                this.showNotification(data.sender_name, {
                    data: data,
                    body: data.content,
                    icon: data.sender?.avatar_url || '/static/images/default-avatar.png',
                })

            }
        }
    }

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
            default:
                console.log('Unknown message type:', data.type);
        }
    }


    // 处理新消息（从WebSocket接收）
    handleNewMessage(data) {
        console.log('Received new message:', data);

        // 🔧 关键修复1: 后端发送的是扁平结构，直接使用 data 作为消息对象
        const message = data;  // 不再使用 data.message

        // 安全性检查：确保必要字段存在
        if (!message || !message.timestamp || !message.chat_room) {
            console.warn('Invalid message object:', data);
            return;
        }

        const currentRoomIdInt = parseInt(this.currentRoomId);
        const senderId = message.sender_id ?? message.sender?.id;

        // 🔧 关键修复2: 处理消息撤回事件（虽然理论上不会在这里收到，但做防御性处理）
        if (message.type === 'message_revoked') {
            this.handleMessageRevoked(message);
            return;
        }

        // 🔧 关键修复7: 检查是否是自己发送的消息的确认回执（包含真实ID和temp_id）
        const isOwnMessage = senderId === this.currentUser?.id;

        if (isOwnMessage && message.temp_id) {
            // 这是自己发送的消息的确认回执，包含后端生成的真实ID
            // 查找并更新本地临时消息
            const tempIndex = this.messages.findIndex(msg =>
                msg.temp_id === message.temp_id
            );

            if (tempIndex !== -1) {
                // 更新为真实消息（替换ID和其他字段）
                this.messages[tempIndex] = {
                    ...this.messages[tempIndex],  // 保留本地临时消息的所有字段（包括引用）
                    ...message,                   // 合并后端返回的真实消息数据
                    id: parseInt(message.message_id) || parseInt(message.id),  // 使用真实ID
                    message_id: parseInt(message.message_id) || parseInt(message.id),
                    sender: message.sender,
                    sender_id: message.sender_id,
                    sender_name: message.sender_name,
                    content: message.content,
                    timestamp: message.timestamp,
                    is_read: message.is_read,
                    message_type: message.message_type,
                    file_info: message.file_info,
                    chat_room: parseInt(message.chat_room),
                    is_temp: false,    // 标记为真实消息
                    temp_id: undefined // 清除临时ID
                };

                //  重新渲染整个消息列表（确保UI更新）
                this.renderChatHistory();
                return; // 重要：处理完临时消息替换后直接返回，避免重复渲染
            }
        }

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
                    }
                }
            } catch (e) {
                console.error('Error rendering timestamp:', e);
            }
        }

        // 添加到消息列表（如果不是自己发送的消息，或未被上面的逻辑处理）
        if (!isOwnMessage || !message.temp_id) {
            // 添加完整的消息对象
            const fullMessage = {
                id: parseInt(message.message_id) || parseInt(message.id) || Date.now(),
                message_id: parseInt(message.message_id) || parseInt(message.id),
                sender: message.sender,
                sender_id: message.sender_id,
                sender_name: message.sender_name,
                content: message.content,
                timestamp: message.timestamp,
                is_read: message.is_read,
                message_type: message.message_type,
                file_info: message.file_info,
                chat_room: parseInt(message.chat_room),
                // 🔧 关键修复: 保留后端返回的引用信息
                quote_message_id: message.quote_message_id,
                quote_content: message.quote_content,
                quote_sender: message.quote_sender,
                quote_sender_id: message.quote_sender_id,
                quote_timestamp: message.quote_timestamp,
                quote_message_type: message.quote_message_type,
                is_temp: false
            };
            this.messages.push(fullMessage);

            // // 渲染消息
            // const msgType = senderId !== this.currentUser?.id ? 'received' : 'sent';
            // this.renderMessage(fullMessage, msgType);
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

        // 触发通知
        if (this.shouldPlayNotificationSound()) {
            console.log('播放提示音通知')
            try {
                this.playNotificationSound();
            } catch (error) {
                console.error('Failed to play notification sound:', error);
            }
        }

        // 判断是否为当前聊天室的消息
        if (senderId !== this.currentUser?.id) {
            if (this.currentRoomId && parseInt(message.chat_room) === currentRoomIdInt) {
                // 当前聊天室，标记为已读
                message.is_read = true;
                this.renderMessage(message, 'received');


            } else {
                // 非当前聊天室，显示通知
                this.renderMessage(message, 'received');

                // 🔧 新增：触发震动提示（仅非当前聊天室）
                console.log('触发震动提示')
                this.vibrateOnNewMessage();

                // 🔧 新增：显示消息通知弹窗
                this.showMessageNotification(message, {
                    chat_room_id: message.chat_room,
                    sender_name: message.sender?.real_name || message.sender?.username || '未知用户',
                    avatar_url: message.sender?.avatar_url,
                    is_current_room: false,
                    room_type: message.room_type || 'private'
                });

                // 更新未读数
                const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(message.chat_room));
                if (room) {
                    room.unread_count = (room.unread_count || 0) + 1;
                    this.renderChatRooms();
                    this.renderGroups();

                    // 🔧 更新应用角标（累计所有未读消息）
                    const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                    this.updateAppBadge(totalUnread);
                }


                // // 非当前聊天室，触发声音通知
                // if (this.shouldPlayNotificationSound()) {
                //     try {
                //         this.playNotificationSound();
                //     } catch (error) {
                //         console.error('Failed to play notification sound:', error);
                //     }
                // }

                if (this.shouldShowDesktopNotification()) {
                    try {
                        // Utils.showNotification(message.sender_name, {
                        //     body: message.content,
                        //     icon: message.sender?.avatar_url || '/static/images/default-avatar.png'
                        // });

                        this.showNotification(message.sender_name, {
                            data: message,
                            body: message.content,
                            icon: message.sender?.avatar_url || '/static/images/default-avatar.png',
                        })


                    } catch (error) {
                        console.error('Failed to show notification:', error);
                    }
                }

                // 🔧 关键修复8: 更新未读数（仅非当前聊天室）
                this.updateChatRoomUnreadCount(message.chat_room, 1);
            }
        } else if (!message.temp_id) {
            // 自己发送的消息（首次接收，不是确认回执）
            this.renderMessage(message, 'sent');
        }

        // 如果是当前聊天室的消息，滚动到底部
        if (this.currentRoomId && parseInt(message.chat_room) === currentRoomIdInt) {
            Utils.scrollToBottom(document.getElementById('messagesList'));

            // 🔧 关键修复9: 标记当前聊天室消息为已读
            this.markMessagesAsRead(this.currentRoomId);
        }

        // 🔧 关键修复10: 更新聊天室最后一条消息
        this.updateChatRoomLastMessage(message.chat_room, message.content, message.timestamp);
    }


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
    }

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
    }


    // 🔧 新增：撤回后更新聊天室最后消息（优化方案）
    async updateChatRoomLastMessageAfterRevoke(roomId) {
        try {
            // 获取聊天室最新消息（排除已撤回的消息）
            const response = await fetch(`/api/chat/messages/?chat_room=${roomId}&page_size=1`, {
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                const latestMessage = data.results?.[0];

                const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
                if (room && latestMessage) {
                    // 更新最后一条消息
                    room.last_message = {
                        content: latestMessage.content,
                        timestamp: latestMessage.timestamp,
                        sender: latestMessage.sender
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
            this.loadChatRooms();
        }
    }


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

        return desktopNotifications;
    }


    // 初始化通知系统（在用户首次交互后）
    initNotificationSystem() {
        // 桌面通知权限
        if ('Notification' in window) {
            // 尝试请求权限（如果尚未授权）
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    console.log('Notification permission:', permission);
                });
            }
        }

        // 音频上下文初始化（用户交互后恢复）
        this.initAudioContext();
    }

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
    }

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
    }


    // 显示桌面通知（增强版）
    async showNotification(title, options) {
        console.log('showNotification:', title, options);
        console.log('Notification.permission: ', Notification.permission)
        // 创建通知
        const notification = new Notification(title, options);

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

        // 通知关闭后清除角标
        notification.onclose = () => {
            const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
            this.updateAppBadge(totalUnread);
        };

        // 播放提示音
        console.log('播放提示音');
        this.playNotificationSound();

        // 触发震动（移动端）
        console.log('触发震动');
        this.vibrateOnNewMessage();

        console.log('显示消息通知弹窗（页面内通知）');
        this.showMessageNotification(options.data || options, {
            chat_room_id: options.data?.chat_room_id || options.data?.chat_room,
            sender_name: options.data?.sender?.real_name || options.data?.sender?.username || '未知用户',
            avatar_url: options.icon,
            is_current_room: false
        });
    }


    // 添加震动方法
    vibrateOnNewMessage() {
        // 仅在移动端且支持震动API时启用
        if (!('vibrate' in navigator) || !Utils.isMobile()) {
            return;
        }

        // 检查是否启用震动提醒
        const vibrateEnabled = localStorage.getItem('vibrateNotifications') !== 'false';
        if (!vibrateEnabled) {
            return;
        }

        // 短震动提示（300ms）
        navigator.vibrate(300);

        // 或者使用模式震动：短-长-短
        // navigator.vibrate([100, 50, 200]);
    }


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
            if (this.isIOS() || Utils.isMobile()) {
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
        if (this.isIOS() || Utils.isMobile()) {
            this.vibrateOnNewMessage();
        }
    }

    // 关闭通知
    closeNotification(notification) {
        if (!notification || !notification.parentNode) return;

        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    // 截断消息内容
    truncateMessage(content, maxLength = 50) {
        if (!content) return '';

        // 移除HTML标签
        const text = content.replace(/<[^>]*>/g, '');

        if (text.length > maxLength) {
            return text.substring(0, maxLength) + '...';
        }
        return text;
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

    // 处理用户在线状态变化
    handleUserOnlineStatus(data) {
        const {user_id, is_online, chat_room_id} = data;
        console.log('handleUserOnlineStatus', data)

        // 1. 更新聊天列表中的在线状态
        this.updateChatListUserStatus(user_id, is_online);

        // 2. 如果是当前聊天室的成员，更新聊天头部状态
        if (this.currentRoomId && chat_room_id && parseInt(chat_room_id) === parseInt(this.currentRoomId)) {
            this.updateCurrentChatStatus(user_id, is_online);
        }

        // 3. 更新通讯录中的在线状态
        this.updateContactsUserStatus(user_id, is_online);
    }

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
    }

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
    }

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
    }


    // 修复：发送图片/文件消息（限制9个，支持视频）
    async sendImageOrFileMessage(files) {
        if (!files || files.length === 0) return;

        // 限制一次最多9个文件
        if (files.length > 9) {
            this.showToast('一次最多只能发送9个文件', 'error');
            return;
        }

        const validFiles = [];
        const invalidFiles = [];

        // 验证文件类型和大小
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            const isValid = Utils.isValidFileType(file)
            if (!isValid) {
                invalidFiles.push(file.name);
                continue;
            }

            // 限制文件大小（50MB）
            const maxSizeMB = 50 * 1024 * 1024
            if (file.size > maxSizeMB) {
                this.showToast(`${file.name} 超过${maxSizeMB}MB，无法发送`, 'error');
                continue;
            }

            validFiles.push(file);
        }

        if (invalidFiles.length > 0) {
            this.showToast(`以下文件类型不支持: ${invalidFiles.join(', ')}`, 'error');
        }

        if (validFiles.length === 0) {
            return;
        }

        // 逐个上传文件
        for (const file of validFiles) {
            try {
                this.sendFile(file);

            } catch (error) {
                console.error('发送文件失败:', error);
                this.showToast(`发送 ${file.name} 失败`, 'error');
            }
        }
    }

    // 发送消息（支持文件消息）
    async sendMessage(content = null) {
        const messageInput = document.getElementById('messageInput');
        const actualContent = content || (messageInput ? messageInput.value.trim() : '');

        if (!actualContent && !content?.file_id) {
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

        // 🔧 关键修复1: 创建临时消息对象，使用虚拟ID并保存映射
        const tempMessageId = Date.now();
        // 构建消息数据（包含引用信息）
        const messageData = {
            id: tempMessageId,
            temp_id: tempMessageId,
            sender_id: this.currentUser.id,
            sender_name: this.currentUser.username,
            sender: this.currentUser,
            content: actualContent?.content || actualContent,
            timestamp: new Date().toISOString(),
            is_read: true,
            message_type: actualContent?.message_type || 'text',
            file_id: actualContent?.file_id,
            chat_room: parseInt(this.currentRoomId),
            is_temp: true
        };

        // 🔧 关键修复2: 如果有引用消息，添加完整的引用信息
        if (this.currentQuoteMessage) {
            messageData.quote_message_id = this.currentQuoteMessage.id || this.currentQuoteMessage.message_id;
            messageData.quote_content = this.currentQuoteMessage.content;
            messageData.quote_sender = this.currentQuoteMessage.sender?.real_name ||
                this.currentQuoteMessage.sender?.username ||
                this.currentQuoteMessage.sender_name || '未知用户';
            // 添加引用消息的其他必要信息
            messageData.quote_sender_id = this.currentQuoteMessage.sender?.id || this.currentQuoteMessage.sender_id;
            messageData.quote_timestamp = this.currentQuoteMessage.timestamp;
            messageData.quote_message_type = this.currentQuoteMessage.message_type || 'text';
        }

        // 🔧 关键修复3: 保存到本地消息列表
        this.messages.push(messageData);

        // 渲染并滚动到底部
        this.renderMessage(messageData, 'sent');
        Utils.scrollToBottom(document.getElementById('messagesList'));

        // 🔧 关键修复3: 通过 WebSocket 发送（传递临时ID）
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const wsMessage = {
                type: 'chat_message',
                content: messageData.content,
                message_type: messageData.message_type,
                file_id: messageData.file_id,
                temp_id: tempMessageId
            };

            // 传递引用信息给后端
            if (this.currentQuoteMessage) {
                wsMessage.quote_message_id = messageData.quote_message_id;
                wsMessage.quote_content = messageData.quote_content;
                wsMessage.quote_sender = messageData.quote_sender;
                wsMessage.quote_sender_id = messageData.quote_sender_id;
                wsMessage.quote_timestamp = messageData.quote_timestamp;
                wsMessage.quote_message_type = messageData.quote_message_type;
            }

            this.ws.send(JSON.stringify(wsMessage));
        } else {
            // WebSocket 不可用时加入队列（同样包含引用信息）
            const queueMessage = {
                chat_room: parseInt(this.currentRoomId),
                content: messageData.content,
                message_type: messageData.message_type,
                file_id: messageData.file_id,
                temp_id: tempMessageId
            };

            if (this.currentQuoteMessage) {
                queueMessage.quote_message_id = messageData.quote_message_id;
                queueMessage.quote_content = messageData.quote_content;
                queueMessage.quote_sender = messageData.quote_sender;
                queueMessage.quote_sender_id = messageData.quote_sender_id;
                queueMessage.quote_timestamp = messageData.quote_timestamp;
                queueMessage.quote_message_type = messageData.quote_message_type;
            }

            this.messageQueue.push(queueMessage);
            this.showError('网络连接不稳定，消息将在连接恢复后发送');
        }

        // 🔧 关键修复5: 本地预更新聊天室最后一条消息
        this.updateChatRoomLastMessage(this.currentRoomId, messageData.content, messageData.timestamp);
        this.updateChatRoomUnreadCount(this.currentRoomId, 0);

        // 发送成功后清除引用（避免影响下一条消息）
        this.clearQuoteMessage();

        // this.loadChatRooms();
    }

    // 更新聊天室最后一条消息（本地预更新）
    updateChatRoomLastMessage(roomId, content, timestamp) {
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
        if (room) {
            // 🔧 关键修复16: 检查是否是撤回消息，如果是则不更新最后消息
            if (content === '[消息已撤销]') {
                // 不更新最后消息，等待后端推送最新消息
                return;
            }

            room.last_message = {
                content: content,
                timestamp: timestamp,
                sender: {
                    id: this.currentUser.id,
                    username: this.currentUser.username,
                    real_name: this.currentUser.real_name
                }
            };
            room.updated_at = timestamp;
            // 重新渲染聊天室列表
            this.renderChatRooms();
            this.renderGroups();
        }
    }

    // 更新聊天室未读数
    updateChatRoomUnreadCount(roomId, increment) {
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
        if (room) {
            room.unread_count = Math.max(0, (room.unread_count || 0) + increment);
            // 重新渲染聊天室列表
            this.renderChatRooms();
            this.renderGroups();
        }
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

    // 处理粘贴事件
    handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return;

        const items = clipboardData.items;
        if (!items) return;

        // 检查是否有图片
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault(); // 阻止默认粘贴

                const blob = items[i].getAsFile();
                if (blob) {
                    // 上传并发送图片
                    this.sendImageFromClipboard(blob);
                }
                break;
            }
        }
    }

// 从剪切板发送图片
    async sendImageFromClipboard(blob) {
        try {
            // 创建文件对象
            const fileName = `clipboard_${Date.now()}.png`;
            const file = new File([blob], fileName, {type: 'image/png'});

            // 验证文件
            if (!Utils.isValidFileType(file)) {
                this.showError('不支持的图片格式');
                return;
            }

            if (file.size > 50 * 1024 * 1024) {
                this.showError('图片大小不能超过50MB');
                return;
            }

            // 发送图片
            await this.sendFile(file);

        } catch (error) {
            console.error('发送剪切板图片失败:', error);
            this.showError('发送图片失败');
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


    // 加载聊天历史（支持分页）
    async loadChatHistory(roomId, options = {}) {
        const {
            beforeId = null,      // 加载此消息之前的消息
            afterId = null,       // 加载此消息之后的消息
            append = false,       // 是否追加到现有消息（默认替换）
            page_size = 50       // 每页消息数
        } = options;

        if (!roomId || this.isLoadingMore) return; // 🔧 防止重复请求

        this.isLoadingMore = true; // 🔧 标记为加载中

        try {
            // 显示加载指示器（首次加载）
            if (this.isInitialLoad && !append) {
                this.showLoading();
            }

            // 构建查询参数
            const params = new URLSearchParams({
                chat_room_id: roomId,
                page_size: page_size.toString()
            });

            if (beforeId) {
                params.append('before_id', beforeId);
            }
            if (afterId) {
                params.append('after_id', afterId);
            }

            const response = await fetch(`/api/chat/messages/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                throw new Error('加载聊天历史失败');
            }

            const data = await response.json();
            let newMessages = Array.isArray(data.results) ? data.results : data;

            // 🔧 关键修复1: 消息去重（基于ID，避免重复）
            if (append && newMessages.length > 0) {
                const existingIds = new Set(this.messages.map(msg => msg.id.toString()));
                newMessages = newMessages.filter(msg => !existingIds.has(msg.id.toString()));

                // 🔧 关键修复2: 检查是否已无更多消息（去重后为空）
                if (newMessages.length === 0) {
                    this.hasMoreMessages = false;
                    // return;
                }
            }

            // 处理消息
            if (append && this.currentRoomId === parseInt(roomId) && newMessages.length > 0) {
                // 追加模式：将新消息添加到现有消息列表（保持时间顺序）
                // 注意：后端返回的是倒序（最新在前），需要反转
                const reversedMessages = [...newMessages].reverse();

                // 🔧 关键修复3: 更新 oldestMessageId 为追加消息中最旧的消息ID
                this.oldestMessageId = reversedMessages[0].id;

                // 追加到消息列表开头（保持时间顺序：最早->最新）
                this.messages = [...reversedMessages, ...this.messages];

                // 🔧 关键修复4: 标记新加载的消息为已读
                this.markMessagesAsRead(roomId, reversedMessages);

            } else if (!append && newMessages.length > 0) {
                // 替换模式：清空并设置新消息
                // 注意：后端返回的是倒序（最新在前），需要反转
                this.messages = [...newMessages].reverse();
                this.isInitialLoad = false;
                this.hasMoreMessages = data.next ? true : false; // 检查是否有下一页

                // 🔧 关键修复5: 正确记录最早消息ID
                this.oldestMessageId = newMessages[newMessages.length - 1].id;

                // 标记消息为已读
                this.markMessagesAsRead(roomId);
            } else if (newMessages.length === 0) {
                // 🔧 关键修复6: 没有更多消息，停止加载
                this.hasMoreMessages = false;
                // return;
            }

            console.log('加载聊天历史成功:', newMessages);
            console.log('append:', append);
            console.log('this.hasMoreMessages:', this.hasMoreMessages);

            // 渲染消息
            this.renderChatHistory();

            const messagesList = document.getElementById('messagesList');
            // 如果没有更多消息，显示没有更多消息指示器
            if (!this.hasMoreMessages) {
                const noMoreIndicator = document.createElement('div');
                noMoreIndicator.className = 'message-no-more-indicator';
                if (messagesList) {
                    if (messagesList.firstChild) {
                        noMoreIndicator.innerHTML = `
                        <span>没有更多消息</span>
                        `
                        messagesList.insertBefore(noMoreIndicator, messagesList.firstChild);
                    } else {
                        noMoreIndicator.innerHTML = `
                        <span>暂无消息</span>
                        `
                        messagesList.appendChild(noMoreIndicator)
                    }

                }
            }

            // 首次加载滚动到底部
            if (!append) {
                Utils.scrollToBottom(document.getElementById('messagesList'));
            }

        } catch (error) {
            console.error('加载聊天历史失败:', error);
            this.showError('加载聊天历史失败');
            await this.checkLoginStatus();
        } finally {
            this.isLoadingMore = false; // 🔧 恢复加载状态
            this.hideLoading();
        }
    }


    // 获取特定聊天室的未读消息数
    async fetchUnreadCountForRoom(roomId) {
        if (!roomId) return;

        try {
            const response = await fetch(`/api/chat/messages/unread_count/?chat_room_id=${roomId}`, {
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
                if (room) {
                    room.unread_count = data.unread_count || 0;

                    // 如果当前房间有直达底部按钮，更新徽章
                    if (this.currentRoomId === parseInt(roomId)) {
                        this.updateUnreadBadge();
                    }
                }
            }
        } catch (error) {
            console.error('获取未读消息数失败:', error);
        }
    }


    // 移除无限滚动监听器（防止重复绑定）
    removeInfiniteScrollListener() {
        const messagesList = document.getElementById('messagesList');
        if (messagesList && this.infiniteScrollHandler) {
            messagesList.removeEventListener('scroll', this.infiniteScrollHandler);
            this.infiniteScrollHandler = null;
        }
    }


    // 设置无限滚动监听
    setupInfiniteScroll() {
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) return;

        // 先移除旧的监听器
        this.removeInfiniteScrollListener();

        // 创建滚动处理函数
        this.infiniteScrollHandler = () => {
            // 检查是否滚动到顶部（加载更早的消息）
            if (messagesList.scrollTop < 50 &&
                !this.isLoadingMore &&
                this.hasMoreMessages &&
                this.currentRoomId) {

                this.loadMoreHistory();
            }
        };

        // 添加滚动监听
        messagesList.addEventListener('scroll', this.infiniteScrollHandler);
    }


    // 加载更多历史消息
    async loadMoreHistory() {

        if (this.isLoadingMore || !this.hasMoreMessages || !this.currentRoomId || !this.oldestMessageId) return;

        // 🔧 关键修复：保存当前滚动位置
        try {
            // 显示加载指示器
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'message-loading-indicator';
            loadingIndicator.innerHTML = `
            <div class="spinner"></div>
            <span>加载更多消息...</span>
        `;
            const messagesList = document.getElementById('messagesList');
            if (messagesList && messagesList.firstChild) {
                messagesList.insertBefore(loadingIndicator, messagesList.firstChild);
            }
            const currentOldestMessageId = this.oldestMessageId
            const loadingIndicatorOffset = loadingIndicator.offsetHeight;
            console.log('currentOldestMessageId: ', currentOldestMessageId)
            console.log('loadingIndicatorOffset: ', loadingIndicatorOffset)
            console.log('加载更多历史消息...');
            // 加载更早的消息
            await this.loadChatHistory(this.currentRoomId, {
                beforeId: this.oldestMessageId,
                append: true,
                page_size: 30
            });


            // 恢复滚动位置（考虑加载指示器高度）
            if (messagesList) {
                const currentScrollTop = document.querySelector(`.message-wrapper[data-message-id="${currentOldestMessageId}"]`).offsetTop
                console.log('currentScrollTop: ', currentScrollTop)
                console.log('loadingIndicator.offsetHeight: ', loadingIndicator.offsetHeight)
                messagesList.scrollTop = currentScrollTop - loadingIndicatorOffset;

                // setTimeout(() => {
                //     messagesList.scrollTop = currentScrollTop - loadingIndicatorOffset;
                // }, 100);
            }

        } catch (error) {
            console.error('加载更多历史消息失败:', error);
            this.showError('加载更多消息失败');
        } finally {
            // 移除加载指示器
            const indicator = document.querySelector('.message-loading-indicator');
            if (indicator) indicator.remove();
        }
    }


    // 初始化直达底部按钮
    initScrollToBottomButton() {
        const container = document.getElementById('scrollToBottomContainer');
        const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
        const unreadCountBadge = document.getElementById('unreadCountBadge');
        const messagesList = document.getElementById('messagesList');

        if (!container || !scrollToBottomBtn || !unreadCountBadge || !messagesList) return;

        // 初始隐藏按钮和徽章
        scrollToBottomBtn.style.display = 'none';
        unreadCountBadge.style.display = 'none';

        let lastScrollTop = 0;
        let showTimeout = null;
        let hideTimeout = null;

        // 更新按钮显示状态（基于滚动方向）
        const updateButtonVisibility = () => {
            const scrollTop = messagesList.scrollTop;
            const scrollHeight = messagesList.scrollHeight;
            const clientHeight = messagesList.clientHeight;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            const isScrollingUp = scrollTop < lastScrollTop;

            // 仅当向上滚动且距离底部超过150px时显示按钮
            const shouldShowButton = isScrollingUp && distanceFromBottom > 150;

            if (shouldShowButton) {
                if (!showTimeout) {
                    showTimeout = setTimeout(() => {
                        scrollToBottomBtn.style.display = 'block';
                        scrollToBottomBtn.classList.add('show');
                        showTimeout = null;

                        // 🔧 关键修复：使用后端未读数更新徽章
                        this.updateUnreadBadge();
                    }, 200);
                }
                if (hideTimeout) clearTimeout(hideTimeout);
            } else {
                if (showTimeout) clearTimeout(showTimeout);
                if (!hideTimeout) {
                    hideTimeout = setTimeout(() => {
                        scrollToBottomBtn.classList.remove('show');
                        setTimeout(() => {
                            scrollToBottomBtn.style.display = 'none';
                            // 按钮隐藏时也隐藏徽章
                            unreadCountBadge.classList.remove('show');
                        }, 350);
                        hideTimeout = null;
                    }, 300);
                }
            }

            lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
        };

        // 防抖滚动监听
        let scrollTimeout = null;
        messagesList.addEventListener('scroll', () => {
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(updateButtonVisibility, 100);
        });

        // 按钮点击事件
        scrollToBottomBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // 添加点击反馈
            scrollToBottomBtn.style.transform = 'translateY(-2px) scale(0.98)';
            setTimeout(() => {
                scrollToBottomBtn.style.transform = '';
            }, 150);

            // 平滑滚动到底部
            messagesList.scrollTo({
                top: messagesList.scrollHeight,
                behavior: 'smooth'
            });

            // 滚动后隐藏按钮和徽章
            setTimeout(() => {
                scrollToBottomBtn.classList.remove('show');
                setTimeout(() => {
                    scrollToBottomBtn.style.display = 'none';
                    unreadCountBadge.classList.remove('show');
                }, 350);
            }, 500);

            // 标记所有消息为已读
            if (this.currentRoomId) {
                this.markMessagesAsRead(this.currentRoomId);
            }
        });

        // 保存引用
        this.scrollToBottomContainer = container;
        this.scrollToBottomBtn = scrollToBottomBtn;
        this.unreadCountBadge = unreadCountBadge;
    }

    // 🔧 新增：更新未读消息徽章（使用后端数据）
    updateUnreadBadge() {
        if (!this.currentRoomId || !this.unreadCountBadge) return;

        // 从聊天室列表中获取后端返回的未读数
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(this.currentRoomId));
        if (room && room.unread_count > 0) {
            this.unreadCountBadge.textContent = room.unread_count > 99 ? '99+' : room.unread_count;
            this.unreadCountBadge.classList.add('show');
        } else {
            this.unreadCountBadge.classList.remove('show');
        }
    }


    // 滚动到底部并标记为已读
    scrollToBottomAndMarkRead() {
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) return;

        // 滚动到底部
        messagesList.scrollTo({
            top: messagesList.scrollHeight,
            behavior: 'smooth'
        });

        // 标记为已读
        if (this.currentRoomId) {
            this.markMessagesAsRead(this.currentRoomId);

            // 隐藏未读徽章
            if (this.unreadCountBadge) {
                this.unreadCountBadge.classList.remove('show');
            }
        }
    }


    // 加载用户列表
    async loadUsers() {
        try {
            // 根据用户类型决定加载方式
            let response;
            if (this.currentUser.user_type === 'normal') {
                // 普通用户加载好友列表
                response = await API.getUsers();
            } else {
                // 管理员加载所有用户列表
                response = await API.getUsers();
            }

            this.users = Array.isArray(response) ? response : (response.results || []);
            this.renderUserList();
        } catch (error) {
            console.error('加载用户列表失败:', error?.detail || error.message);
            this.showError('加载用户列表失败');
            await this.checkLoginStatus();
        }
    }

    // 加载部门列表
    async loadDepartments() {
        try {
            const response = await API.getDepartments();
            this.departments = Array.isArray(response) ? response : (response.results || []);
        } catch (error) {
            console.error('加载部门列表失败:', error?.detail || error.message);
            this.showError('加载部门列表失败');
        }
    }

    // 渲染当前用户个人设置信息
    renderCurrentUser() {
        const userNameEl = document.getElementById('currentUsername');
        if (userNameEl) {
            userNameEl.textContent = this.currentUser.real_name ? `${this.currentUser.real_name}` : this.currentUser.username;
            userNameEl.title = this.currentUser.username;
        }
        const currentUserAvatarEl = document.getElementById('currentUserAvatar');
        currentUserAvatarEl.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        currentUserAvatarEl.title = this.currentUser.username;


        // 设置表单中的用户信息
        document.getElementById('settingsUsernameDisplay').value = this.currentUser.username;
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
            console.log('render room: ', room);
            const lastMessage = room.last_message || {};
            const unreadCount = room.unread_count || 0;
            let roomName = room.display_name || '未知聊天室';

            let roomAvatar, isOnline, isOnline_html = '', username = '',
                lastMessageText = lastMessage.content || '暂无消息';
            let otherUserId = null; // 🔧 新增：存储对方用户ID

            if (room.room_type === 'private') {
                // 🔧 获取对方用户（排除当前用户）
                const otherMember = room.members.find(m => m.id !== this.currentUser.id);
                if (otherMember) {
                    roomAvatar = otherMember.avatar_url || '/static/images/default-avatar.png';
                    roomName = `${otherMember.real_name || otherMember.username}`;
                    username = `${otherMember.real_name || otherMember.username} - ${otherMember.department_info?.name || otherMember.department || ''} - ${otherMember.position || ''}`;
                    isOnline = otherMember.online_status?.is_online || false;
                    otherUserId = otherMember.id; // 🔧 保存对方用户ID
                } else {
                    roomAvatar = '/static/images/default-avatar.png';
                    username = '未知用户';
                    isOnline = falsel;
                }


                isOnline_html = `
                <div class="status ${isOnline ? 'online' : 'offline'}">
                    <span class="status-dot"></span>
                    <span class="status-text">${isOnline ? '在线' : '离线'}</span>
                </div>
            `;
            } else {
                // 群聊处理
                roomAvatar = room.avatar || '/static/images/group-avatar.png';
                if (lastMessage.sender && lastMessage.sender.id !== this.currentUser.id) {
                    lastMessageText = `${lastMessage.sender?.real_name || lastMessage.sender?.username}: ${lastMessage.content || '暂无消息'}`;
                } else {
                    lastMessageText = lastMessage.content || '暂无消息';
                }
                console.log('lastMessageText: ', lastMessageText);
            }

            // 🔧 关键修复：为私聊添加 data-user-id 属性，群聊不添加
            const dataUserIdAttr = room.room_type === 'private' && otherUserId ? `data-user-id="${otherUserId}"` : '';

            html += `
            <div class="chat-item ${room.is_pinned ? 'pinned' : ''}" 
                 data-room-id="${room.id}" 
                 ${dataUserIdAttr}
                 >
                <div class="chat-item-avatar">
                    <img src="${roomAvatar}" alt="${roomName}" class="chat-item-avatar" title="${username}">
                  
                </div>
                <div class="chat-item-info">
                    <div class="chat-item-title">
                        ${room.is_pinned ? '<i class="fas fa-thumbtack pinned-icon"></i>' : ''}
                        ${room.is_muted ? '<i class="fas fa-volume-mute muted-icon"></i>' : ''}
                        ${roomName}
                    </div>
                    <div class="chat-item-subtitle">${lastMessageText}</div>
                </div>
                <div class="chat-item-meta">
                    ${unreadCount > 0 ? `<div class="chat-item-unread-count">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
                    ${isOnline_html}
                    <div class="chat-item-time">${lastMessage.timestamp ? Utils.formatTime(lastMessage.timestamp) : ''}</div>
                </div>
            </div>
        `;
        });

        chatList.innerHTML = html;
    }


    // 重新渲染整个消息历史（用于消息更新/撤回等场景）
    renderChatHistory() {
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) return;

        // 清空消息列表
        messagesList.innerHTML = '';

        // 按时间顺序排序（最早的在前，最新的在后）
        this.messages.sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        // 重新渲染所有消息
        this.messages.forEach((message, index) => {
            const senderId = message.sender_id ?? message.sender?.id;
            const type = senderId === this.currentUser?.id ? 'sent' : 'received';

            // 渲染时间戳分隔符（每5分钟或跨天）
            if (index === 0 || this.shouldShowTimestamp(this.messages[index - 1], message)) {
                const timeElement = this.renderTimeStamp(message.timestamp);
                messagesList.appendChild(timeElement);
            }

            this.renderMessage(message, type);
        });


        // 滚动到底部
        Utils.scrollToBottom(messagesList);
    }

    // 判断是否需要显示时间戳
    shouldShowTimestamp(prevMessage, currMessage) {
        if (!prevMessage || !currMessage) return true;

        const prevTime = new Date(prevMessage.timestamp);
        const currTime = new Date(currMessage.timestamp);
        const timeDiff = currTime - prevTime;

        // 跨天显示日期
        if (prevTime.toDateString() !== currTime.toDateString()) {
            return true;
        }

        // 超过5分钟显示时间
        return timeDiff > 5 * 60 * 1000;
    }


    // 渲染时间戳
    renderTimeStamp_v1(timestamp) {
        const template = document.getElementById('timeStampTemplate');
        if (!template) return null;

        const timeElement = template.content.cloneNode(true);
        const timeSpan = timeElement.querySelector('span');

        if (timeSpan) {
            timeSpan.textContent = Utils.formatTime(timestamp);
        }

        return timeElement;
    }


    // 渲染时间戳
    renderTimeStamp_2(timestamp) {
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time-divider';
        let label = Utils.formatTime(timestamp);
        timeElement.innerHTML = `<span class="message-date-label">${label}</span>`;
        return timeElement;
    }

    // 渲染时间戳
    renderTimeStamp(timestamp) {
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time-divider';

        const date = new Date(timestamp);
        const now = new Date();

        // 判断是否是今天
        const isToday = date.toDateString() === now.toDateString();
        const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();

        let label;
        if (isToday) {
            label = '今天';
        } else if (isYesterday) {
            label = '昨天';
        } else {
            label = date.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }

        timeElement.innerHTML = `<span class="message-date-label">${label}</span>`;
        return timeElement;
    }


    // 消息渲染方法 - 微信样式
    renderMessage(message, type) {
        const template = document.getElementById('messageTemplate');
        if (!template) return;

        // 创建消息元素
        const messageElement = template.content.cloneNode(true);
        const wrapper = messageElement.querySelector('.message-wrapper');
        wrapper.className = `message-wrapper ${type}`; // sent 或 received

        // 🔧 关键修复11: 添加 data-message-id 属性到 wrapper 元素
        const messageId = message.message_id || message.id;
        wrapper.setAttribute('data-message-id', messageId);
        wrapper.setAttribute('data-message-timestamp', message.timestamp);

        // 根据消息类型动态创建对应的 wrapper
        let messageWrapper;
        const headerElementContainer = document.createElement('div');

        if (type === 'received') {
            // 接收的消息 - 使用左侧 wrapper
            messageWrapper = document.createElement('div');
            messageWrapper.className = 'message-left-wrapper';

            // 创建头像元素（左侧）
            const avatarElement = document.createElement('div');
            avatarElement.className = 'message-avatar';

            const contentElementContainer = document.createElement('div');


            // 显示对方头像
            if (message.sender?.avatar_url || message.sender?.avatar) {
                avatarElement.innerHTML = `<img src="${message.sender?.avatar_url || message.sender?.avatar}" alt="${message.sender.real_name || message.sender.username}" title="${message.sender.real_name || message.sender.username}">`;
            } else {
                // 使用首字母作为头像
                // const username = message.sender?.real_name || message.sender?.username || '未知';
                // avatarElement.textContent = username.charAt(0);
                avatarElement.textContent = message.sender?.real_name?.charAt(0) || message.sender?.username?.charAt(0) || '未知';
                // avatarElement.style.background = '#07c160';
                avatarElement.style.background = '#409eff';
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
                avatarImg.title = `${username} - ${message.sender?.department_info?.name || message.sender?.department || ''} - ${message.sender?.position || ''}`;

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
            `;

            const headerElement_2 = document.createElement('div');
            headerElement_2.className = 'message-header';
            headerElement_2.innerHTML = `
            <span class="message-time">${Utils.formatTime(message.timestamp)}</span>
            `;

            // 设置消息内容
            const messageContent = contentElement.querySelector('.message-text');
            this.renderMessageContent(message, messageContent);

            // 添加到 wrapper（头像 -> 头部 -> 内容）
            messageWrapper.appendChild(avatarElement);
            contentElementContainer.appendChild(headerElement);
            contentElementContainer.appendChild(contentElement);
            messageWrapper.appendChild(contentElementContainer);
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
            headerElementContainer.appendChild(avatarElement);
        }


        // // 在消息内容后添加操作按钮（仅在发送的消息上显示）
        // if (canRevoke && type === 'sent') {
        //     // 在消息渲染后添加撤销按钮（通过CSS定位）
        //     setTimeout(() => {
        //         const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
        //         if (messageElement) {
        //             // 添加撤销按钮的逻辑
        //             this.addRevokeButton(messageElement, message.id);
        //         }
        //     }, 100);
        // }

        // 在发送的消息上直接渲染撤销按钮（10分钟内）
        if (type === 'sent' && !message.is_deleted) {
            const isOwnMessage = parseInt(message.sender?.id) === this.currentUser?.id;
            const messageTime = new Date(message.timestamp).getTime();
            const currentTime = new Date().getTime();
            const timeDiff = currentTime - messageTime;
            const canRevoke = isOwnMessage && timeDiff < 10 * 60 * 1000; // 10分钟内

            if (canRevoke) {
                const actionBtn = document.createElement('div');
                actionBtn.className = 'message-actions';
                actionBtn.innerHTML = `
                <button class="message-action-btn" onclick="chatClient.revokeMessage(${messageId})">
                    <i class="fas fa-undo"></i> 撤销
                </button>
            `;
                headerElementContainer.appendChild(actionBtn);
            }
        }

        if (type === 'sent') {
            messageWrapper.appendChild(headerElementContainer);
        }


        // 为接收的消息添加引用按钮（非撤回消息）
        if (type === 'received' && !message.is_deleted && message.content && message.content !== '[消息已撤销]') {
            const quoteBtn = document.createElement('button');
            quoteBtn.className = 'message-quote-btn';
            quoteBtn.innerHTML = '<i class="fas fa-quote-left"></i>';
            quoteBtn.title = '引用';
            quoteBtn.onclick = (e) => {
                e.stopPropagation();
                this.setQuoteMessage(message);
            };
            messageWrapper.appendChild(quoteBtn);
        }


        // 清空原始模板内容，添加新的 wrapper
        wrapper.innerHTML = '';
        wrapper.appendChild(messageWrapper);

        // 设置消息内容宽度
        const messageContentElement = messageWrapper.querySelector('.message-content');
        if (messageContentElement) {
            messageContentElement.style.maxWidth = '100%';
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


    // 添加撤销按钮
    addRevokeButton(messageElement, messageId) {
        const actionBtn = document.createElement('div');
        actionBtn.className = 'message-actions';
        actionBtn.innerHTML = `
        <button class="message-action-btn" onclick="chatClient.revokeMessage(${messageId})">
            <i class="fas fa-undo"></i> 撤销
        </button>
    `;
        messageElement.appendChild(actionBtn);
    }


    // 撤销消息方法
    async revokeMessage(messageId) {
        try {
            const confirmed = await this.showConfirmDialog(
                '撤销消息',
                '确定要撤销这条消息吗？<br><small style="color: var(--text-light);">消息发出后10分钟内可撤销</small>',
                'confirm'
            );

            if (!confirmed) return;

            // 🔧 关键修复7: 查找消息的真实ID（如果是临时消息，可能还没有真实ID）
            const message = this.messages.find(msg => msg.id === messageId);
            if (!message) {
                this.showError('消息不存在');
                return;
            }

            // 如果是临时消息且还没有真实ID，直接从本地删除
            if (message.is_temp) {
                this.messages = this.messages.filter(msg => msg.id !== messageId);
                this.renderChatHistory();
                this.showSuccess('消息已撤销');
                return;
            }

            // 调用后端撤销接口（使用真实消息ID）
            const response = await fetch(`/api/chat/messages/${messageId}/revoke/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.message);
            }

            // 从本地消息列表中更新
            const messageIndex = this.messages.findIndex(msg => msg.id === messageId);
            if (messageIndex !== -1) {
                this.messages[messageIndex].content = '[消息已撤销]';
                this.messages[messageIndex].is_deleted = true;
                this.messages[messageIndex].deleted_at = new Date().toISOString();
                this.renderChatHistory();
            }

            this.showSuccess('消息已撤销');

        } catch (error) {
            console.error('撤销消息失败:', error);
            this.showError('撤销失败' + (error || '消息已超过可撤销时间'));
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


        // 🔧 关键修复11: 处理已撤销消息
        if (message.is_deleted && message.content === '[消息已撤销]') {
            container.innerHTML = '<span class="revoked-message">[消息已撤销]</span>';
            container.classList.add('message-revoked');
            return;
        }


        switch (message.message_type) {
            case 'text':
                // container.textContent = message.content;
                container.innerHTML += message.content || '';
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
                // container.textContent = message.content || '[未知消息类型]';
                container.innerHTML += message.content || '[未知消息类型]';
        }

        // 🔧 关键修复: 渲染引用消息（必须在内容之前）
        if (message.quote_message_id || message.quote_content) {
            const quoteElement = document.createElement('div');
            quoteElement.className = 'message-quote';

            // 引用头部
            const quoteHeader = document.createElement('div');
            quoteHeader.className = 'quote-header';
            quoteHeader.innerHTML = `
            <i class="fas fa-quote-left"></i>
            <span class="quote-sender">${this.escapeHtml(message.quote_sender || '引用')}：</span>
        `;

            // 引用内容
            const quoteContent = document.createElement('div');
            quoteContent.className = 'quote-text';
            quoteContent.innerHTML = this.escapeHtml(message.quote_content || '[引用内容]');

            // 添加到引用容器
            quoteElement.appendChild(quoteHeader);
            quoteElement.appendChild(quoteContent);

            // 添加到消息容器
            container.appendChild(quoteElement);
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
            this.showError('获取用户信息失败: ' + (error.error || error.message || '未知错误'));
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


    // 优化用户信息模态框
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
                <!-- 头像和基本信息宫格 -->
                <div class="profile-section profile-avatar-section">
                    <div class="profile-avatar-large">
                        <img src="${userData.avatar_url || '/static/images/default-avatar.png'}" alt="头像">
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
                            <label>账号:</label>
                            <span>${userData.username || '-'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>真实姓名:</label>
                            <span>${userData.real_name || '-'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>状态:</label>
                            <span class="profile-status ${userData.is_online ? 'online' : 'offline'}">
                                ${userData.is_online ? '🟢 在线' : `🔴 离线 (${formatLastSeen(userData.last_seen)})`}
                            </span>
                        </div>
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
        <div class="modal-footer">
            <button class="btn btn-secondary close-modal-btn">关闭</button>
            <!-- 🔧 关键修复2: 添加唯一class并移除内联onclick -->
            <button class="btn btn-primary start-chat-btn" data-user-id="${userData.id}">发起私聊</button>
        </div>
    </div>
    `;

        document.body.appendChild(modal);

        // 🔧 关键修复3: 只为关闭按钮绑定关闭事件（不再覆盖所有按钮）
        const closeBtn = modal.querySelector('.close-btn');
        const closeModalBtn = modal.querySelector('.close-modal-btn');

        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.closeModal('userProfileModal');
            };
        }

        if (closeModalBtn) {
            closeModalBtn.onclick = (e) => {
                e.stopPropagation();
                this.closeModal('userProfileModal');
            };
        }

        // 🔧 关键修复4: 为"发起私聊"按钮单独绑定事件（先私聊再关闭）
        const startChatBtn = modal.querySelector('.start-chat-btn');
        if (startChatBtn) {
            startChatBtn.onclick = (e) => {
                e.stopPropagation();
                const userId = startChatBtn.dataset.userId;

                // 先发起私聊
                this.selectUserForChat(userId);
                // 再关闭模态框
                this.closeModal('userProfileModal');
            };
        }


        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) this.closeModal('userProfileModal');
        };
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
            let response;
            if (this.currentUser.user_type === 'normal') {
                // 普通用户加载好友列表
                response = await API.getUsers();
            } else {
                // 管理员加载所有用户列表
                response = await API.getUsers();
            }
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
            <div class="user-list-item" data-user-id="${user.id}" onclick="chatClient.selectUserForChat(${user.id})">
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
                let lastMessageText = '';
                if (lastMessage.sender && lastMessage.sender.id !== this.currentUser.id) {
                    lastMessageText = `${lastMessage.sender?.real_name || lastMessage.sender?.username}: ${lastMessage.content || '暂无消息'}`
                } else {
                    lastMessageText = lastMessage.content || '暂无消息';
                }

                html += `
                <div class="group-item" data-room-id="${group.id}" onclick="chatClient.selectChatRoom('${group.id}')">
                    <div class="group-avatar">
                        <img src="${group.avatar || '/static/images/group-avatar.png'}" alt="${group.display_name}">
                    </div>
                    <div class="group-info">
                        <div class="group-title">${group.display_name}</div>
                        <div class="group-subtitle">${lastMessageText || '暂无消息'}</div>
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


    // 隐藏侧边栏
    hideSidebar() {
        console.log('Hiding sidebar');
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('show');
            this.isShowingSidebar = false;

            // 🔧 关键修复：移动端显示输入区域
            this.toggleInputAreaVisibility(true);
        }
    }

    // 显示侧边栏
    showSidebar() {
        console.log('Opening sidebar');
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.add('show');
            this.isShowingSidebar = true;

            // 🔧 关键修复：移动端隐藏输入区域（除非输入框正在聚焦）
            const messageInput = document.getElementById('messageInput');
            if (!messageInput || messageInput !== document.activeElement) {
                this.toggleInputAreaVisibility(false);
            }
        }
    }

    // 🔧 新增：智能控制输入区域显示/隐藏（仅移动端）
    toggleInputAreaVisibility(show) {
        // 仅在移动端（768px 以下）应用此逻辑
        if (window.innerWidth > 768) {
            return;
        }

        const inputArea = document.querySelector('.chat-input-area');
        if (!inputArea) return;

        // 检查输入框是否聚焦，聚焦时不隐藏
        const messageInput = document.getElementById('messageInput');
        if (messageInput && messageInput === document.activeElement && !show) {
            // 输入框聚焦时，不隐藏输入区域
            return;
        }

        if (show) {
            inputArea.classList.remove('hidden-mobile');
            inputArea.classList.add('visible-mobile');

            // 延迟滚动到输入框（确保软键盘弹出后位置正确）
            setTimeout(() => {
                if (messageInput && messageInput === document.activeElement) {
                    messageInput.scrollIntoView({behavior: 'smooth', block: 'nearest'});
                }
            }, 300);
        } else {
            inputArea.classList.remove('visible-mobile');
            inputArea.classList.add('hidden-mobile');
        }
    }


    toggleSidebar() {
        if (this.isShowingSidebar) {
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
        // 清除引用
        this.clearQuoteMessage();

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

        // 🔧 关键修复1: 重置无限滚动状态
        this.isInitialLoad = true;
        this.isLoadingMore = false;
        this.hasMoreMessages = true;
        this.oldestMessageId = null;
        this.newestMessageId = null;
        this.messages = []; // 清空当前消息列表

        // 🔧 关键修复2: 移除旧的滚动监听器（防止重复绑定）
        this.removeInfiniteScrollListener();


        // 🔧 关键修复3: 加载聊天历史（支持分页）
        this.loadChatHistory(roomId, {
            page_size: 50,
            append: false
        }).then(() => {
            // 标记消息为已读
            console.log('标记消息为已读 roomId:', roomId);
            this.markMessagesAsRead(roomId).then(() => {
                // 更新聊天室列表中的未读消息数
                const chatItem = document.querySelector(`.chat-item[data-room-id="${roomId}"]`);
                if (chatItem) {
                    const unreadCountElement = chatItem.querySelector('.chat-item-unread-count');
                    if (unreadCountElement) {
                        unreadCountElement.remove();
                    }
                }
            }).catch(error => {
                console.error('标记消息为已读失败:', error);
            });

            // 🔧 关键修复4: 设置滚动监听器（无限滚动）
            this.setupInfiniteScroll();

            // 🔧 新增: 滚动到底部并标记已读
            this.scrollToBottomAndMarkRead();


            // 🔧 关键修复8: 初始化直达底部按钮（初始隐藏）
            this.initScrollToBottomButton();

            // 🔧 关键修复：初始化时更新未读徽章
            this.updateUnreadBadge();

        }).catch(error => {
            console.error('加载聊天历史失败:', error);
            this.showError('加载聊天历史失败');
        });


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


        // 清除该聊天室的未读数
        if (room) {
            room.unread_count = 0;

            // 更新总未读数并设置角标
            const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
            this.updateAppBadge(totalUnread);
        }


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
        console.log('选择用户发起聊天:', userId);
        if (!userId || userId === this.currentUser.id) {
            return;
        }

        // 检查是否正在创建与该用户的私聊（5秒内）
        const now = Date.now();
        const creatingInfo = this.creatingChatMap.get(userId);
        if (creatingInfo && (now - creatingInfo.timestamp) < 5000) {
            console.log(`正在创建与用户 ${userId} 的私聊，请稍候...`);
            this.showToast('正在创建聊天，请稍候...', 'error');
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
        // 确保 member_ids 是有效的字符串数组
        const validMemberIds = memberIds.filter(id => id && id.toString().trim());
        if (validMemberIds.length === 0) {
            this.showError('无效的用户ID');
            return;
        }

        // 获取对方用户ID（私聊只有两个成员：当前用户和对方）
        const otherUserId = validMemberIds[0];

        // 检查是否正在创建（双重检查）
        if (this.chatCreationLock) {
            console.log('聊天室创建中，请稍候...');
            this.showToast('聊天室创建中，请稍候...', 'error');
            return;
        }

        // 设置创建锁和状态
        this.chatCreationLock = true;
        this.creatingChatMap.set(otherUserId, {
            timestamp: Date.now(),
            status: 'creating'
        });

        try {
            // 发送创建请求（后端会处理唯一性检查）
            const response = await API.createChatRoom({
                room_type: 'private',
                member_ids: validMemberIds.map(id => parseInt(id))
            });

            console.log('私聊创建成功:', response)

            // 保存创建的聊天室ID
            this.creatingChatMap.set(otherUserId, {
                timestamp: Date.now(),
                roomId: response.id,
                status: 'success'
            });

            // 重新加载聊天室列表
            await this.loadChatRooms();

            // 查找新创建的私聊（通过成员匹配）
            const newRoom = this.chatRooms.find(room =>
                room.room_type === 'private' &&
                room.members?.some(m => m.id.toString() === otherUserId.toString()) &&
                room.members?.some(m => m.id.toString() === this.currentUser.id.toString())
            );

            if (newRoom) {
                this.selectChatRoom(newRoom.id);
            } else {
                // 降级：使用返回的ID
                this.selectChatRoom(response.id);
            }

        } catch (error) {
            console.error('创建私聊失败:', error);
            this.showError('创建私聊失败: ' + (error.error || error.message || '未知错误'));

            // 清除创建状态（标记为失败）
            this.creatingChatMap.set(otherUserId, {
                timestamp: Date.now(),
                status: 'failed',
                error: error.message
            });

            await this.checkLoginStatus();
        } finally {
            // 释放锁（1秒后，避免太快连续创建）
            setTimeout(() => {
                this.chatCreationLock = false;
                // 清理5秒前的创建记录
                const cleanupTime = Date.now() - 5000;
                this.creatingChatMap.forEach((value, key) => {
                    if (value.timestamp < cleanupTime) {
                        this.creatingChatMap.delete(key);
                    }
                });
            }, 1000);
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
            this.showError('创建群聊失败: ' + (error.error || error.message || '未知错误'));
            await this.checkLoginStatus();
        }
    }

    // 修复：返回按钮点击处理
    handleBackButtonClick_v1() {
        console.log('返回按钮被点击');

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

        // 返回聊天列表
        if (this.isShowingSidebar) {
            console.log('Hiding sidebar')
            this.hideSidebar()
        } else {
            console.log('show sidebar')
            this.showSidebar()
        }


        console.log('已返回聊天列表');
    }


    // 修复：返回按钮点击处理
    handleBackButtonClick() {
        console.log('返回按钮被点击');

        // 移动端：隐藏侧边栏并显示输入区域
        if (window.innerWidth <= 768) {
            if (this.isShowingSidebar) {
                this.hideSidebar();
            } else {
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
                }
                if (chatSubtitle) {
                    this.updateConnectionStatus(false, 'chatSubtitle');
                }

                // 移除所有聊天项的active状态
                document.querySelectorAll('.chat-item').forEach(item => {
                    item.classList.remove('active');
                });
            }
        }
        // 电脑端：切换侧边栏显示/隐藏
        else {
            this.toggleSidebar();
        }

        console.log('已处理返回按钮点击');
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


    // 添加加载指示器方法（如果尚未实现）
    showLoading() {
        if (document.querySelector('.loading-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
        </div>
    `;
        document.body.appendChild(overlay);
    }

    hideLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.parentNode.removeChild(overlay);
        }
    }


    // 清除静态文件缓存（增强版）
    clearStaticCache() {
        return new Promise((resolve) => {
            // 显示确认对话框
            this.showConfirmDialog(
                '清除缓存',
                '确定要清除页面缓存吗？<br><small style="color: var(--text-light);">这将清除本地数据并强制重新加载所有资源</small>',
                'confirm'
            ).then((confirmed) => {
                if (!confirmed) {
                    resolve(false);
                    return;
                }

                // 显示加载指示器
                this.showLoading();

                try {
                    // 1. 清除 Service Worker 缓存
                    this.clearServiceWorkerCache();

                    // 2. 清除所有本地存储
                    this.clearAllStorage();

                    // 3. 清除网络缓存（通过 Cache API）
                    this.clearNetworkCache();

                    // 4. 延迟后强制刷新页面（带时间戳参数）
                    setTimeout(() => {
                        this.forceReloadWithCacheBust();
                        resolve(true);
                    }, 800);

                } catch (error) {
                    console.error('清除缓存失败:', error);
                    this.hideLoading();
                    this.showError('清除失败 ' + ' 清除缓存时发生错误: ' + (error.error || error.message || '未知错误'));
                    resolve(false);
                }
            });
        });
    }

    // 清除 Service Worker 缓存
    clearServiceWorkerCache() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(registration => {
                    registration.unregister().catch(console.error);
                });
            }).catch(console.error);

            // 清除所有 Cache Storage
            if ('caches' in window) {
                caches.keys().then(keys => {
                    keys.forEach(key => {
                        caches.delete(key).catch(console.error);
                    });
                }).catch(console.error);
            }
        }
    }

    // 清除所有本地存储
    clearAllStorage() {
        // 保存必要数据（如当前聊天室ID）
        const currentRoomId = this.currentRoomId;

        // 清除所有存储
        // localStorage.clear();
        sessionStorage.clear();

        // 恢复必要数据
        if (currentRoomId) {
            sessionStorage.setItem('lastRoomId', currentRoomId.toString());
        }
    }

    // 清除网络缓存
    clearNetworkCache() {
        // 尝试清除 HTTP 缓存（通过重新请求资源）
        const resources = [
            '/static/css/chat.css',
            '/static/js/chat.js',
            '/static/js/api.js',
            '/static/js/utils.js',
            '/static/js/admin.js'
        ];

        resources.forEach(url => {
            fetch(url, {
                method: 'GET',
                cache: 'reload',
                headers: {'Cache-Control': 'no-cache, no-store, must-revalidate'}
            }).catch(() => {
                // 忽略错误，继续执行
            });
        });
    }

    // 强制刷新页面并绕过缓存
    forceReloadWithCacheBust() {
        // 构建带时间戳的 URL
        const url = new URL(window.location.href);

        // 移除旧的缓存参数
        url.searchParams.delete('v');
        url.searchParams.delete('cacheBust');

        // 添加新的时间戳参数
        url.searchParams.set('cacheBust', Date.now());

        // 保存当前滚动位置（用于恢复）
        const scrollY = window.scrollY;
        sessionStorage.setItem('preReloadScrollY', scrollY.toString());

        // 强制重定向（不使用 location.reload 因为它可能被缓存）
        window.location.replace(url.toString());
    }

    // 在页面加载时恢复滚动位置
    restoreScrollPosition() {
        const scrollY = sessionStorage.getItem('preReloadScrollY');
        if (scrollY) {
            setTimeout(() => {
                window.scrollTo(0, parseInt(scrollY));
                sessionStorage.removeItem('preReloadScrollY');
            }, 100);
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

            messageInput.addEventListener('paste', (e) => this.handlePaste(e));

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
            // 聊天列表点击
            if (e.target.closest('.chat-item')) {
                const chatItem = e.target.closest('.chat-item');
                const roomId = chatItem.dataset.roomId;
                console.log('点击了聊天列表', roomId);
                if (roomId) {
                    this.selectChatRoom(roomId);
                }
            }
            // 通讯录用户列表点击
            else if (e.target.closest('.user-list-item')) {
                const userItem = e.target.closest('.user-list-item');
                const userId = userItem.dataset.userId;
                if (userId) {
                    // this.selectUserForChat(userId);
                    this.showUserProfile(userId)

                }
            }

            // 新建聊天按钮
            else if (e.target.closest('.empty-state .btn.btn-primary')) {
                this.openNewChatModal();
            }
        });

        // 用户操作按钮
        const userActionButtons = document.querySelectorAll('.user-actions .btn-icon');
        if (userActionButtons[1]) {
            userActionButtons[1].addEventListener('click', (e) => {
                e.preventDefault();
                this.showSettings();
            });
        }
        if (userActionButtons[2]) {
            userActionButtons[2].addEventListener('click', (e) => {
                e.preventDefault();
                this.logout();
            });
        }

        // 当前用户头像点击操作
        const currentUserAvatar = document.getElementById('currentUserAvatar');
        if (currentUserAvatar) {
            currentUserAvatar.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSettings();
            })
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


        // 图片/视频选择
        const imageBtn = document.getElementById('imageBtn');
        if (imageBtn) {
            imageBtn.addEventListener('click', () => {
                document.getElementById('imageInput').click();
            });
        }

        // 文件选择
        const fileBtn = document.getElementById('fileBtn');
        if (fileBtn) {
            fileBtn.addEventListener('click', () => {
                document.getElementById('fileInput').click();
            });
        }

        // 图片/视频输入
        const imageInput = document.getElementById('imageInput');
        if (imageInput) {
            imageInput.addEventListener('change', (e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                    this.sendImageOrFileMessage(files);
                }
                // 重置input，允许重复选择同一文件
                e.target.value = '';
            });
        }

        // 文件输入
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                    this.sendImageOrFileMessage(files);
                }
                // 重置input，允许重复选择同一文件
                e.target.value = '';
            });
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

        // 修复：添加返回按钮事件监听
        const backBtn = document.getElementById('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // this.handleBackButtonClick();
                this.toggleSidebar()
            });
        }

        // const messagesContainer = document.getElementById('messagesContainer');
        // if (messagesContainer) {
        //     messagesContainer.addEventListener('click', (e) => {
        //         e.preventDefault();
        //         this.toggleHideSidebar()
        //     })
        // }


        // 消息容器点击（移动端隐藏侧边栏）
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
            messagesContainer.addEventListener('click', (e) => {
                e.preventDefault();
                // 仅在移动端且侧边栏显示时隐藏
                if (window.innerWidth <= 768 && this.isShowingSidebar) {
                    this.hideSidebar();
                }
            });
        }

        // 输入框聚焦时确保输入区域可见
        // const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('focus', () => {
                // 移动端聚焦时确保输入区域可见
                if (window.innerWidth <= 768) {
                    this.toggleInputAreaVisibility(true);

                    // 延迟滚动到输入框
                    setTimeout(() => {
                        messageInput.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest'
                        });
                    }, 300);
                }
            });

            // 输入框失焦时根据侧边栏状态决定是否隐藏
            messageInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (window.innerWidth <= 768 && this.isShowingSidebar) {
                        this.toggleInputAreaVisibility(false);
                    }
                }, 200); // 延迟确保点击事件先处理
            });
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

        // 修复：搜索区域 Tab 切换（替换原侧边栏 tab 切换）
        document.querySelectorAll('.search-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                // 移除所有 active 状态
                document.querySelectorAll('.search-tab').forEach(t => {
                    t.classList.remove('active');
                });
                // 添加当前 active 状态
                tab.classList.add('active');

                // 更新当前搜索类型
                this.currentSearchTab = tab.dataset.tab;

                // 隐藏所有列表
                const chatList = document.getElementById('chatList');
                const contactsList = document.getElementById('contactsList');
                const groupsList = document.getElementById('groupsList');

                if (chatList) chatList.classList.add('hidden');
                if (contactsList) contactsList.classList.add('hidden');
                if (groupsList) groupsList.classList.add('hidden');

                // 显示当前 tab 对应的列表
                const tabType = this.currentSearchTab;
                if (tabType === 'chats' && chatList) {
                    chatList.classList.remove('hidden');
                } else if (tabType === 'contacts' && contactsList) {
                    contactsList.classList.remove('hidden');
                    // 如果通讯录列表为空，重新渲染
                    if (contactsList.innerHTML.trim() === '' || contactsList.innerHTML.includes('empty-state')) {
                        this.renderUserList();
                    }
                } else if (tabType === 'groups' && groupsList) {
                    groupsList.classList.remove('hidden');
                    // 如果群组列表为空，重新渲染
                    if (groupsList.innerHTML.trim() === '' || groupsList.innerHTML.includes('empty-state')) {
                        this.renderGroups();
                    }
                }

                // 清空搜索输入框和结果
                const searchInput = document.getElementById('searchInput');
                const searchClearBtn = document.getElementById('searchClearBtn');
                if (searchInput) searchInput.value = '';
                if (searchClearBtn) searchClearBtn.style.display = 'none';
                this.clearSearchResults();
            });
        });

        // 搜索输入框事件
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const keyword = e.target.value.trim();
                if (keyword) {
                    document.getElementById('searchClearBtn').style.display = 'block';
                    this.performSearch(keyword);
                } else {
                    document.getElementById('searchClearBtn').style.display = 'none';
                    this.clearSearchResults();
                }
            });
        }

        // 搜索清除按钮
        const searchClearBtn = document.getElementById('searchClearBtn');
        if (searchClearBtn) {
            searchClearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus();
                }
                searchClearBtn.style.display = 'none';
                this.clearSearchResults();
            });
        }

        // 点击外部关闭搜索结果
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-container')) {
                this.clearSearchResults();
            }
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


        // 清除缓存按钮
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearStaticCache();
            });
        }


        // 设置新建聊天模态框事件监听
        this.setupNewChatModalListeners();
        // 初始化用户数据用于聊天创建
        this.loadUsersForChat();

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
                // this.currentRoomId = null;
                // document.getElementById('messagesEmpty').style.display = 'block';
                // document.getElementById('messagesList').style.display = 'none';
            }
        });

        // 输入框聚焦时滚动到可视区域
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('focus', () => {
                // 移动端聚焦时确保输入区域可见
                if (window.innerWidth <= 768) {
                    this.toggleInputAreaVisibility(true);

                    // 延迟滚动到输入框
                    setTimeout(() => {
                        messageInput.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest'
                        });
                    }, 300);
                }
            });

            // 输入框失焦时根据侧边栏状态决定是否隐藏
            messageInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (window.innerWidth <= 768 && this.isShowingSidebar) {
                        this.toggleInputAreaVisibility(false);
                    }
                }, 200); // 延迟确保点击事件先处理
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
            console.log('Modal already exists, refreshing...');
            // this.clearModal('settingsModal')
            this.createSettingsModal()
            // settingsModal.classList.add('show');
        }
    }

    // 优化个人设置模态框 - 改为优雅的表单布局
    createSettingsModal() {
        const modal = document.createElement('div');
        modal.className = 'modal settings-modal show';
        modal.id = 'settingsModal';
        this.clearModal(modal.id);


        // 动态生成部门选项
        const departmentOptions = this.departments.map(dept =>
            `<option value="${dept.id}" ${this.currentUser.department_info?.id === dept.id ? 'selected' : ''}>${dept.name}</option>`
        ).join('');

        console.log('departments:', this.departments)
        console.log('departmentOptions:', departmentOptions)

        modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-user-cog"></i> 个人资料设置</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div class="profile-section">
                    <div class="profile-section-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-image"></i>
                        </div>
                        <div class="profile-section-title">头像设置</div>
                    </div>
                    <div class="profile-avatar-section">
                        <div class="avatar-upload-container">
                            <img id="settingsAvatar" src="/static/images/default-avatar.png" alt="头像">
                            <label class="upload-btn" for="avatarUpload">
                                <i class="fas fa-camera"></i>
                            </label>
                            <input type="file" id="avatarUpload" accept="image/*" style="display:none;">
                        </div>
                        <small class="form-hint">点击头像上传新照片，支持JPG、PNG格式，最大2MB</small>
                    </div>
                </div>
        
                <div class="profile-section">
                    <div class="profile-section-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-id-card"></i>
                        </div>
                        <div class="profile-section-title">基本信息</div>
                    </div>
                    <div class="profile-info-grid">
                        <div class="profile-info-item">
                            <label>用户名</label>
                            <span id="settingsUsernameDisplay"></span>
                        </div>
                        <div class="profile-info-item">
                            <label>真实姓名</label>
                            <input type="text" id="settingsRealName" placeholder="请输入真实姓名">
                        </div>
                        <div class="profile-info-item">
                            <label>性别</label>
                            <select id="settingsGender" class="form-select">
                                <option value="">请选择</option>
                                <option value="male">男</option>
                                <option value="female">女</option>
                                <option value="other">其他</option>
                            </select>
                        </div>
                        <div class="profile-info-item">
                            <label>邮箱</label>
                            <input type="email" id="settingsEmail" placeholder="请输入邮箱">
                        </div>
                        <div class="profile-info-item">
                            <label>手机号</label>
                            <input type="tel" id="settingsPhone" placeholder="请输入手机号">
                        </div>
                    </div>
                </div>
        
                <div class="profile-section">
                    <div class="profile-section-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-briefcase"></i>
                        </div>
                        <div class="profile-section-title">工作信息</div>
                    </div>
                    <div class="profile-info-grid">
                        <div class="profile-info-item">
                            <label>部门</label>
                            
                            <select id="settingsDepartment" class="form-select"  ${this.currentUser.user_type === 'normal' ? 'readonly' : ''}>>
                            <option value="">请选择部门</option>
                            ${departmentOptions}
                            </select>
                        </div>
                        <div class="profile-info-item">
                            <label>职位</label>
                            <input type="text" id="settingsPosition" placeholder="请输入职位" ${this.currentUser.user_type === 'normal' ? 'readonly' : ''}>
                        </div>
                    </div>
                </div>
        
                <div class="profile-section">
                    <div class="profile-section-header">
                        <div class="grid-item-icon">
                            <i class="fas fa-bell"></i>
                        </div>
                        <div class="profile-section-title">通知设置</div>
                    </div>
                    <div class="notification-grid">
                        <div class="notification-item">
                            <label>
                                <i class="fas fa-bell"></i>
                                桌面通知
                            </label>
                            <label class="switch">
                                <input type="checkbox" id="desktopNotifications">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="notification-item">
                            <label>
                                <i class="fas fa-volume-up"></i>
                                声音提醒
                            </label>
                            <label class="switch">
                                <input type="checkbox" id="soundNotifications">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="notification-item">
                            <label>
                                <i class="fas fa-mobile-alt"></i>
                                震动提醒
                            </label>
                            <label class="switch">
                                <input type="checkbox" id="vibrateNotifications">
                                <span class="slider"></span>
                            </label>
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

        // 绑定头像上传事件
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


        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        closeBtn.onclick = () => this.closeModal('settingsModal');

        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) this.closeModal('settingsModal');
        };

        // 填充表单数据
        this.populateSettingsForm();
    }

    populateSettingsForm() {
        if (!this.currentUser) return;

        // 基本信息
        document.getElementById('settingsUsernameDisplay').textContent = this.currentUser.username || '';
        document.getElementById('settingsRealName').value = this.currentUser.real_name || '';
        document.getElementById('settingsEmail').value = this.currentUser.email || '';
        document.getElementById('settingsPhone').value = this.currentUser.phone || '';
        document.getElementById('settingsGender').value = this.currentUser.gender || '';

        // 工作信息
        document.getElementById('settingsDepartment').value = this.currentUser.department_info?.id || this.currentUser.department || '';
        document.getElementById('settingsPosition').value = this.currentUser.position || '';

        // 头像
        const avatarImg = document.getElementById('settingsAvatar');
        if (avatarImg) {
            avatarImg.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        }

        // 恢复通知设置
        const desktopNotifications = localStorage.getItem('desktopNotifications') !== 'false';
        const soundNotifications = localStorage.getItem('soundNotifications') !== 'false';
        const vibrateNotifications = localStorage.getItem('vibrateNotifications') !== 'false';
        document.getElementById('desktopNotifications').checked = desktopNotifications;
        document.getElementById('soundNotifications').checked = soundNotifications;
        document.getElementById('vibrateNotifications').checked = vibrateNotifications;

        console.log('==> 恢复通知设置：', desktopNotifications, soundNotifications, vibrateNotifications, typeof desktopNotifications);
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
            const gender = document.getElementById('settingsGender').value;
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
            if (gender !== this.currentUser.gender) updateData.gender = gender;


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
                const vibrateNotifications = document.getElementById('vibrateNotifications').checked;
                localStorage.setItem('desktopNotifications', desktopNotifications.toString());
                localStorage.setItem('soundNotifications', soundNotifications.toString());
                localStorage.setItem('vibrateNotifications', vibrateNotifications.toString());

                console.log('保存通知设置: ', desktopNotifications, soundNotifications, vibrateNotifications);


                this.closeModal('settingsModal');
                this.showSuccess('设置保存成功');
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.detail || '保存失败');
            }
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showError('保存设置失败: ' + error);
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

        // 🔧 关键修复1: 创建临时消息对象（上传中状态），使用统一虚拟ID机制
        const tempMessageId = Date.now();
        try {
            // 显示上传中状态
            const uploadingMessage = {
                id: tempMessageId,
                temp_id: tempMessageId,  // 临时ID，用于后续匹配
                uploading_id: tempMessageId,
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: `正在上传文件: ${file.name}`,
                timestamp: new Date().toISOString(),
                is_read: true,
                chat_room: parseInt(this.currentRoomId),
                message_type: this.getFileMessageType(file.type),
                file_info: {
                    name: file.name,
                    size: file.size,
                    url: '/static/images/uploading.gif', // 占位符
                    mime_type: file.type
                },
                is_temp: true,  // 标记为临时消息
                is_uploading: true  // 标记为上传中
            };

            // 🔧 关键修复2: 保存到本地消息列表（统一管理）
            this.messages.push(uploadingMessage);

            // 渲染上传中消息
            this.renderMessage(uploadingMessage, 'sent');
            Utils.scrollToBottom(document.getElementById('messagesList'));

            // 上传文件
            const uploadResult = await API.uploadFile(file);

            const message_type = this.getFileMessageType(file.type)
            const content = this.getFileMessageContent(message_type)

            // 构建最终文件消息对象
            // 🔧 关键修复3: 创建最终消息对象（带temp_id，等待后端确认）
            const finalMessage = {
                id: tempMessageId,  // 临时使用虚拟ID
                temp_id: tempMessageId,
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: content,
                file_id: uploadResult?.file_id || uploadResult?.id,
                timestamp: new Date().toISOString(),
                is_read: true,
                chat_room: parseInt(this.currentRoomId),
                message_type: message_type,
                file_info: {
                    id: uploadResult?.file_id || uploadResult?.id,
                    name: uploadResult.filename,
                    size: uploadResult.size,
                    url: uploadResult.file_url,
                    mime_type: uploadResult.mime_type,
                    md5: uploadResult.md5
                },
                is_temp: true  // 仍是临时消息，等待后端确认
            };

            // // 替换上传中的消息为最终消息
            // const uploadingElement = document.querySelector(`[uploading_id="${uploadingMessage.uploading_id}"]`);
            // if (uploadingElement) {
            //     uploadingElement.parentElement.remove()
            // }
            // this.renderMessage(finalMessage, 'sent');


            // 🔧 关键修复4: 替换上传中消息为最终消息（仍在本地，等待后端确认）
            const tempIndex = this.messages.findIndex(msg => msg.temp_id === tempMessageId);
            if (tempIndex !== -1) {
                this.messages[tempIndex] = finalMessage;
                // 重新渲染该消息
                this.renderChatHistory();
            }


            // 🔧 关键修复5: 通过 WebSocket 发送文件消息（携带temp_id）
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'chat_message',
                    content: content,
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    message_type: message_type,
                    file_info: finalMessage.file_info,
                    temp_id: tempMessageId  // 传递临时ID，方便后端返回时匹配
                }));
                this.showSuccess(uploadResult.exists ? '文件发送成功（已存在）' : '文件发送成功');
            } else {
                // WebSocket 不可用时加入队列
                this.messageQueue.push({
                    chat_room: parseInt(this.currentRoomId),
                    content: content,
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    message_type: message_type,
                    file_info: finalMessage.file_info,
                    temp_id: tempMessageId
                });
                this.showError('网络连接不稳定，消息将在连接恢复后发送');
            }

            // // 滚动到底部
            // Utils.scrollToBottom(document.getElementById('messagesList'));

            // 🔧 关键修复6: 本地预更新聊天室最后一条消息
            this.updateChatRoomLastMessage(this.currentRoomId, content, finalMessage.timestamp);

        } catch (error) {
            console.error('文件发送失败:', error);
            this.showError('文件发送失败: ' + (error.error || error.message || error || '未知错误'));

            // // 删除上传中的消息
            // const uploadingElement = document.querySelector(`[uploading_id="${uploadingMessage.uploading_id}"]`);
            // if (uploadingElement) {
            //     uploadingElement.parentElement.remove();
            // }

            // 🔧 关键修复7: 从本地消息列表中移除上传失败的消息
            this.messages = this.messages.filter(msg => msg.temp_id !== tempMessageId);
            this.renderChatHistory();

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

        // 🔧 关键修复1: 创建临时消息对象，使用统一虚拟ID机制
        const tempMessageId = Date.now();
        try {
            const message = {
                id: tempMessageId,
                temp_id: tempMessageId,  // 临时ID，用于后续匹配
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: emojiHtml,
                timestamp: new Date().toISOString(),
                is_read: true,
                chat_room: parseInt(this.currentRoomId),
                message_type: 'emoji',
                is_temp: true  // 标记为临时消息
            };

            // 🔧 关键修复2: 保存到本地消息列表（统一管理）
            this.messages.push(message);

            // 本地渲染
            this.renderMessage(message, 'sent');
            Utils.scrollToBottom(document.getElementById('messagesList'));

            // 🔧 关键修复3: 通过 WebSocket 发送（携带temp_id）
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'chat_message',
                    content: emojiHtml,
                    message_type: 'emoji',
                    temp_id: tempMessageId  // 传递临时ID，方便后端返回时匹配
                }));
            } else {
                // WebSocket 不可用时使用 HTTP
                console.log('WebSocket is not open. Using HTTP.');
                await API.sendMessage({
                    chat_room: parseInt(this.currentRoomId),
                    content: emojiHtml,
                    message_type: 'emoji'
                });
                // HTTP方式不支持temp_id匹配，直接视为已发送（降级处理）
                const msgIndex = this.messages.findIndex(msg => msg.temp_id === tempMessageId);
                if (msgIndex !== -1) {
                    this.messages[msgIndex].is_temp = false;
                    this.renderChatHistory();
                }
            }

            // 🔧 关键修复4: 本地预更新聊天室最后一条消息
            this.updateChatRoomLastMessage(this.currentRoomId, emojiHtml, message.timestamp);

        } catch (error) {
            console.error('表情发送失败:', error);
            this.showError('表情发送失败: ' + error);
            // 从本地消息列表中移除发送失败的消息
            this.messages = this.messages.filter(msg => msg.temp_id !== tempMessageId);
            this.renderChatHistory();
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

    getFileMessageContent(message_type) {
        const type = message_type.toLowerCase();
        if (type.includes('image')) return '[图片]';
        if (type.includes('video')) return '[视频]';
        if (type.includes('audio') || type.includes('voice')) return '[语音]';
        return '[文件]';
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
            this.showError('操作失败: ' + error);
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
            this.showError('操作失败: ' + error);
            await this.checkLoginStatus();
        }
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


    // ==================== 优雅的确认对话框 ====================
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


// 清空聊天记录
    async clearChatHistory(roomId) {
        const confirmed = await this.showConfirmDialog(
            '清空聊天记录',
            '确定要清空所有聊天记录吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>',
            'danger'
        );
        if (!confirmed) return;

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
            this.showError('清空失败: ' + error);
            await this.checkLoginStatus();
        }
    }

    // 执行搜索
    async performSearch(keyword) {
        if (!keyword.trim()) {
            this.clearSearchResults();
            return;
        }

        try {
            let results = [];

            switch (this.currentSearchTab) {
                case 'chats':
                    results = await this.searchChats(keyword);
                    break;
                case 'contacts':
                    results = await this.searchContacts(keyword);
                    break;
                case 'groups':
                    results = await this.searchGroups(keyword);
                    break;
            }

            this.renderSearchResults(results, this.currentSearchTab);
        } catch (error) {
            console.error('搜索失败:', error);
            this.showError('搜索失败，请重试: ' + error);
        }
    }

// 搜索聊天记录
    async searchChats(keyword) {
        try {
            const response = await fetch(`/api/chat/rooms/search_chats/?q=${encodeURIComponent(keyword)}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('搜索失败');

            const data = await response.json();
            return data.results || [];
        } catch (error) {
            console.error('搜索聊天失败:', error);
            return [];
        }
    }

// 搜索通讯录用户
    async searchContacts(keyword) {
        try {
            const response = await fetch(`/api/auth/search_users/?q=${encodeURIComponent(keyword)}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('搜索失败');

            const data = await response.json();
            return data.results || [];
        } catch (error) {
            console.error('搜索用户失败:', error);
            return [];
        }
    }

// 搜索群组
    async searchGroups(keyword) {
        try {
            const response = await fetch(`/api/chat/rooms/search/?q=${encodeURIComponent(keyword)}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('搜索失败');

            const data = await response.json();
            return data.results || [];
        } catch (error) {
            console.error('搜索群组失败:', error);
            return [];
        }
    }

// 渲染搜索结果
    renderSearchResults(results, type) {
        const container = document.getElementById('searchResults');
        if (!container) return;

        if (results.length === 0) {
            container.innerHTML = `
            <div class="search-result-item">
                <div class="search-result-info">
                    <div class="search-result-name">暂无结果</div>
                    <div class="search-result-desc">请尝试其他关键词</div>
                </div>
            </div>
        `;
            container.classList.add('show');
            return;
        }

        let html = '';
        results.forEach((item, index) => {
            const avatar = item.avatar_url || item.avatar || '/static/images/default-avatar.png';
            const name = item.real_name || item.username || item.name || item.display_name || '未知';
            const desc = this.getSearchItemDesc(item, type);

            html += `
        <div class="search-result-item" data-id="${item.id}" data-type="${type}" onclick="chatClient.handleSearchResultClick(${item.id}, '${type}')">
            <div class="search-result-avatar">
                <img src="${avatar}" alt="${name}">
            </div>
            <div class="search-result-info">
                <div class="search-result-name">${name}</div>
                <div class="search-result-desc">${desc}</div>
            </div>
            <span class="search-result-type ${type}">${this.getSearchTypeLabel(type)}</span>
        </div>
        `;
        });

        container.innerHTML = html;
        container.classList.add('show');
    }

// 获取搜索项描述
    getSearchItemDesc(item, type) {
        switch (type) {
            case 'chats':
                return item.last_message?.content || item.last_message || '最近聊天';
            case 'contacts':
                return item.department_info?.name || item.department || item.position || '联系人';
            case 'groups':
                return `${item?.members?.length || 0}人` || '群组';
            default:
                return '';
        }
    }

// 获取搜索类型标签
    getSearchTypeLabel(type) {
        const labels = {
            'chats': '聊天',
            'contacts': '联系人',
            'groups': '群组'
        };
        return labels[type] || type;
    }

// 处理搜索结果点击
    handleSearchResultClick(id, type) {
        switch (type) {
            case 'chats':
                // 跳转到对应聊天
                this.selectChatRoom(id);
                break;
            case 'contacts':
                // 显示用户信息或发起私聊
                this.showUserProfile(id);
                break;
            case 'groups':
                // 跳转到群组聊天
                this.selectChatRoom(id);
                break;
        }
        this.clearSearchResults();
    }

// 清除搜索结果
    clearSearchResults() {
        const container = document.getElementById('searchResults');
        const searchInput = document.getElementById('searchInput');
        const searchClearBtn = document.getElementById('searchClearBtn');

        if (container) {
            container.classList.remove('show');
            container.innerHTML = '';
        }

        if (searchInput) {
            searchInput.value = '';
        }

        if (searchClearBtn) {
            searchClearBtn.style.display = 'none';
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
            this.showError('搜索用户失败: ' + error);
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
        const confirmed = await this.showConfirmDialog(
            '删除聊天',
            '确定要删除这个聊天吗？',
            'danger'
        );
        if (!confirmed) return;

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
                    // document.getElementById('messagesEmpty').style.display = 'block';
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
                console.error('删除聊天失败:', errorData);
                throw new Error(errorData.error || errorData.message || '删除失败');
            }
        } catch (error) {
            console.error('删除聊天失败:', error);
            this.showError('删除聊天失败: ' + error);
        }
    }

// 软删除消息
    async softDeleteMessage(messageId) {
        if (!confirm('确定要删除这条消息吗？')) return;
        const confirmed = await this.showConfirmDialog(
            '删除聊天消息',
            '确定要删除这条消息吗？',
            'danger'
        );
        if (!confirmed) return;


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
                throw new Error(errorData.error || errorData.message || '删除失败');
            }
        } catch (error) {
            console.error('删除消息失败:', error);
            this.showError('删除消息失败: ' + error);
        }
    }

// 清空聊天记录
    async clearChatHistory(roomId) {
        const confirmed = await this.showConfirmDialog(
            '清空聊天记录',
            '确定要清空所有聊天记录吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>',
            'danger'
        );
        if (!confirmed) return;

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
                throw new Error(errorData.error || error.message || '清空失败');
            }
        } catch (error) {
            console.error('清空聊天记录失败:', error);
            this.showError('清空聊天记录失败: ' + error);
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
                throw new Error(errorData.error || error.message || '更新失败');
            }
        } catch (error) {
            console.error('更新群聊失败:', error);
            this.showError('更新群聊失败: ' + error);
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
                <button class="btn btn-danger" onclick="chatClient.dismissGroupChat(${roomId})">解散群聊</button>
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


    // 优化：加载群聊成员用于管理（群主在第一位）
    loadGroupMembersForManagement(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || !room.members) {
            console.error('未找到群聊或成员列表');
            return;
        }

        const membersContainer = document.getElementById('groupManageMembers');
        if (!membersContainer) return;

        // 将群主排在第一位
        const sortedMembers = [...room.members].sort((a, b) => {
            if (a.id === room.creator) return -1;
            if (b.id === room.creator) return 1;
            return 0;
        });

        let html = '<div class="member-grid">';
        sortedMembers.forEach(member => {
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

        // 根据用户类型过滤可添加的成员
        let availableMembers;
        if (this.currentUser.user_type === 'normal') {
            // 普通用户只能添加好友
            availableMembers = this.users.filter(user =>
                user.id !== this.currentUser.id &&
                !currentMemberIds.includes(user.id) &&
                this.currentUser.friends?.some(f => f.id === user.id)
            );
        } else {
            // 管理员可以添加所有用户
            availableMembers = this.users.filter(user =>
                user.id !== this.currentUser.id &&
                !currentMemberIds.includes(user.id)
            );
        }

        this.renderAvailableMembers(availableMembers);
    }


    // 优化：渲染可添加的成员（宫格布局）
    renderAvailableMembers(members) {
        const container = document.getElementById('addMemberResults');
        if (!container) return;

        // 过滤掉已经在群里的成员
        const room = this.currentChatRoom;
        const existingMemberIds = room?.members?.map(m => m.id) || [];
        const availableMembers = members.filter(m => !existingMemberIds.includes(m.id));

        let html = '<div class="member-grid">';
        availableMembers.forEach(user => {
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
                throw new Error(errorData.error || error.message || '添加失败');
            }
        } catch (error) {
            console.error('添加成员失败:', error);
            this.showError('添加成员失败: ' + error);
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


    // 解散群聊
    async dismissGroupChat(roomId) {
        const confirmed = await this.showConfirmDialog(
            '解散群聊',
            '确定要解散该群聊吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>',
            'danger'
        );
        if (!confirmed) return;


        try {
            const response = await API.toggleDismissChatRoom(roomId)

            if (response.ok) {
                this.chatRooms = this.chatRooms.filter(room => room.id !== roomId);
                this.renderChatRooms();
                this.closeModal('groupManagementModal');
                this.showSuccess('群聊已解散');

                if (parseInt(this.currentRoomId) === parseInt(roomId)) {
                    this.currentRoomId = null;
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
                throw new Error(errorData.error || error.message || '解散失败');
            }
        } catch (error) {
            console.error('解散群聊失败:', error);
            this.showError('解散群聊失败: ' + error);
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
        const confirmed = await this.showConfirmDialog(
            '移除成员',
            '确定要移除该成员吗？',
            'confirm'
        );
        if (!confirmed) return;
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
                throw new Error(errorData.error || error.message || '移除失败');
            }
        } catch (error) {
            console.error('移除成员失败:', error);
            this.showError('移除成员失败: ' + error);
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

// 示例：替换 logout 方法
    async logout() {
        const confirmed = await this.showConfirmDialog('退出登录', '确定要退出登录吗？', 'confirm');
        if (confirmed) {
            try {
                await API.logout();
            } catch (error) {
                console.error('登出失败:', error);
                localStorage.removeItem('access_token');
            }
            if (this.ws) {
                this.ws.close();
            }
            window.location.href = '/login/';
        }
    }


    // 语音通话
    makeVoiceCall() {
        this.showAlert('功能提示', '语音通话功能开发中...');
    }

    // 视频通话
    makeVideoCall() {
        this.showAlert('功能提示', '视频通话功能开发中...');
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

    showToast(message, type = 'success') {
        if (type === 'error') {
            this.showError(message)
        } else {
            this.showSuccess(message)
        }
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

    // 标记消息为已读
    async markMessagesAsRead(roomId, messages = null) {
        if (!roomId) return;

        try {
            // 获取当前聊天室的所有未读消息ID
            let messageIds;

            if (messages) {
                // 如果指定了消息列表，只标记这些消息
                messageIds = messages
                    .filter(msg => !msg.is_read && msg.id)
                    .map(msg => msg.id)
                    .filter(id => id); // 过滤无效ID
            } else {
                // 否则获取所有未读消息
                messageIds = this.messages
                    .filter(msg => !msg.is_read && parseInt(msg.chat_room) === parseInt(roomId) && msg.id)
                    .map(msg => msg.id)
                    .filter(id => id);
            }

            if (messageIds.length === 0) {
                return;
            }

            // 调用 API 标记为已读
            const response = await API.toggleMarkMessagesAsRead(messageIds, roomId);

            if (response.ok) {
                // 更新本地消息状态
                const messagesToUpdate = messages || this.messages;
                messagesToUpdate.forEach(msg => {
                    if (messageIds.includes(msg.id)) {
                        msg.is_read = true;
                    }
                });

                // 更新聊天室未读数
                const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
                if (room) {
                    room.unread_count = 0;
                    this.renderChatRooms();
                    this.renderGroups();
                    // 更新徽章
                    this.updateUnreadBadge();
                }
            }
        } catch (error) {
            console.error('标记消息为已读失败:', error);
            await this.checkLoginStatus();
        }
    }


    // 生成带未读数的 Favicon
    generateFaviconBadge(count) {
        // 创建 canvas 元素
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // 绘制背景（企业蓝色）
        const gradient = ctx.createLinearGradient(0, 0, 128, 128);
        gradient.addColorStop(0, '#409EFF');
        gradient.addColorStop(1, '#337ECC');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);

        // 绘制聊天气泡
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(64, 64, 45, 0, Math.PI * 2);
        ctx.fill();

        // 绘制消息图标
        ctx.fillStyle = '#409EFF';
        ctx.font = 'bold 60px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💬', 64, 64);

        // 如果有未读消息，绘制红色角标
        if (count > 0) {
            ctx.fillStyle = '#ff4d4f';
            ctx.beginPath();
            ctx.arc(100, 32, 24, 0, Math.PI * 2);
            ctx.fill();

            // 绘制未读数字
            ctx.fillStyle = 'white';
            ctx.font = count > 99 ? 'bold 20px Arial, sans-serif' : 'bold 28px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const text = count > 99 ? '99+' : count.toString();
            ctx.fillText(text, 100, 32);
        }

        // 生成 data URL
        return canvas.toDataURL('image/png');
    }

    // 更新Favicon
    updateFavicon(count) {
        // 查找现有的favicon link
        let faviconLink = document.querySelector('link[rel="icon"]');

        // 如果不存在，创建一个新的
        if (!faviconLink) {
            faviconLink = document.createElement('link');
            faviconLink.rel = 'icon';
            document.head.appendChild(faviconLink);
        }

        // 生成并设置新的favicon
        const faviconUrl = this.generateFaviconBadge(count);
        // const faviconUrl = '/media/avatars/icon.svg';
        faviconLink.href = faviconUrl;
    }

    // 添加角标管理方法
    updateAppBadge(count) {
        // 1. 使用 Badging API (Chrome 81+, Edge 81+)
        if ('setAppBadge' in navigator) {
            if (count > 0) {
                navigator.setAppBadge(count).catch(err => {
                    console.warn('设置应用角标失败:', err);
                });
            } else {
                navigator.clearAppBadge().catch(err => {
                    console.warn('清除应用角标失败:', err);
                });
            }
        }

        // 2. 更新 Favicon（所有浏览器）
        this.updateFavicon(count);

        // 3. 更新 document.title
        this.updateDocumentTitle(count);

        // 4. iOS PWA 专用：更新应用图标角标（需要原生支持，这里用降级方案）
        if (this.isIOS() && this.isPWAStandaloneMode()) {
            // iOS 16.4+ 支持 setAppBadge
            if ('setAppBadge' in navigator) {
                if (count > 0) {
                    navigator.setAppBadge(count).catch(err => {
                        console.warn('iOS PWA 设置角标失败:', err);
                    });
                } else {
                    navigator.clearAppBadge().catch(err => {
                        console.warn('iOS PWA 清除角标失败:', err);
                    });
                }
            }
            // 降级：使用 document.title 显示未读数
            else {
                this.updateDocumentTitle(count);
            }
        }
    }


    // 更新文档标题（带未读数）
    updateDocumentTitle(unreadCount) {
        const originalTitle = '企业聊天室 - 公司内部通讯';
        if (unreadCount > 0) {
            document.title = `(${unreadCount}) ${originalTitle}`;

            // 启动标题闪烁（仅当页面不在前台时）
            if (!document.hasFocus() && !this.titleBlinkInterval) {
                this.startTitleBlink(unreadCount);
            }
        } else {
            document.title = originalTitle;
            this.stopTitleBlink();
        }
    }


    // 标题闪烁效果
    startTitleBlink(unreadCount) {
        if (this.titleBlinkInterval) return;

        const originalTitle = document.title;
        let isOriginal = true;

        this.titleBlinkInterval = setInterval(() => {
            if (isOriginal) {
                document.title = `【新消息${unreadCount > 1 ? `(${unreadCount})` : ''}】${originalTitle}`;
            } else {
                document.title = originalTitle;
            }
            isOriginal = !isOriginal;
        }, 1000);
    }

    // 停止标题闪烁
    stopTitleBlink() {
        if (this.titleBlinkInterval) {
            clearInterval(this.titleBlinkInterval);
            this.titleBlinkInterval = null;
        }
    }

    // ==================== 引用功能 ====================

    // 设置引用消息
    setQuoteMessage(message) {
        if (!message || !message.content) {
            this.clearQuoteMessage();
            return;
        }

        this.currentQuoteMessage = message;

        // 显示引用预览
        const quotePreview = document.getElementById('quotePreview');
        const quoteSender = document.getElementById('quoteSender');
        const quoteContent = document.getElementById('quoteContent');

        if (quotePreview && quoteSender && quoteContent) {
            quotePreview.style.display = 'block';
            quoteSender.textContent = `${message.sender?.real_name || message.sender?.username || message.sender_name || '未知用户'}：`

            quoteContent.textContent = message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '');

            // 自动聚焦输入框
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.focus();
            }
        }
    }

    // 清除引用消息
    clearQuoteMessage() {
        this.currentQuoteMessage = null;

        const quotePreview = document.getElementById('quotePreview');
        if (quotePreview) {
            quotePreview.style.display = 'none';
        }

        // 清空预览内容
        const quoteSender = document.getElementById('quoteSender');
        const quoteContent = document.getElementById('quoteContent');
        if (quoteSender && quoteContent) {
            quoteSender.textContent = '';
            quoteContent.textContent = '';
        }
    }

    // 转义 HTML 特殊字符，防止 XSS 攻击
    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }


    // ==================== @功能 ====================

    // 当前@面板状态
    isAtPanelOpen = false;
    atPanelPosition = null;

    // 打开@面板
    openAtPanel(position) {
        this.isAtPanelOpen = true;
        this.atPanelPosition = position;

        const atPanel = document.getElementById('atPanel');
        if (atPanel) {
            atPanel.style.display = 'block';
            // atPanel.style.top = `${position.top}px`;
            // atPanel.style.left = `${position.left}px`;
            atPanel.style.bottom = `80px`;
            atPanel.style.left = `auto`;

            // 加载当前聊天室的成员
            this.loadAtMembers();
        }
    }

    // 关闭@面板
    closeAtPanel() {
        this.isAtPanelOpen = false;
        this.atPanelPosition = null;

        const atPanel = document.getElementById('atPanel');
        if (atPanel) {
            atPanel.style.display = 'none';
            atPanel.innerHTML = '';
        }
    }

    // 加载@成员列表
    loadAtMembers() {
        const atPanel = document.getElementById('atPanel');
        if (!atPanel || !this.currentRoomId) return;

        // 获取当前聊天室
        const room = this.chatRooms.find(r => r.id === parseInt(this.currentRoomId));
        if (!room || !room.members) return;

        // 过滤掉自己
        const members = room.members.filter(m => m.id !== this.currentUser.id);

        let html = '<div class="at-panel-header"><i class="fas fa-at"></i> @成员</div>';
        html += '<div class="at-panel-search"><input type="text" id="atSearch" placeholder="搜索成员..."></div>';
        html += '<div class="at-panel-list">';

        members.forEach(member => {
            html += `
            <div class="at-member-item" data-user-id="${member.id}" data-username="${member.real_name || member.username}">
                <img src="${member.avatar_url || '/static/images/default-avatar.png'}" alt="${member.real_name || member.username}" title="${member.real_name || member.username}">
                <div class="at-member-info">
                    <div class="at-member-name">${member.real_name || member.username}</div>
                    <div class="at-member-username">@${member.username}</div>
                </div>
            </div>
        `;
        });

        html += '</div>';
        atPanel.innerHTML = html;

        // 绑定搜索事件
        const atSearch = document.getElementById('atSearch');
        if (atSearch) {
            atSearch.addEventListener('input', (e) => {
                this.filterAtMembers(e.target.value);
            });
        }

        // 绑定成员点击事件
        document.querySelectorAll('.at-member-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const userId = item.dataset.userId;
                const username = item.dataset.username;
                this.insertAtMention(username);
            });
        });
    }

    // 过滤@成员
    filterAtMembers(keyword) {
        const items = document.querySelectorAll('.at-member-item');
        items.forEach(item => {
            const name = item.querySelector('.at-member-name').textContent.toLowerCase();
            const username = item.querySelector('.at-member-username').textContent.toLowerCase();
            const match = name.includes(keyword.toLowerCase()) || username.includes(keyword.toLowerCase());
            item.style.display = match ? 'flex' : 'none';
        });
    }

    // 插入@提及
    insertAtMention(username) {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;

        // 获取光标位置
        const startPos = messageInput.selectionStart;
        const endPos = messageInput.selectionEnd;
        const currentValue = messageInput.value;

        // 插入@用户名
        const newValue = currentValue.substring(0, startPos) + `${username} ` + currentValue.substring(endPos);
        messageInput.value = newValue;

        // 移动光标到插入内容后
        const newCursorPos = startPos + username.length + 2;
        messageInput.setSelectionRange(newCursorPos, newCursorPos);
        messageInput.focus();

        // 关闭@面板
        this.closeAtPanel();
    }

    // 监听输入框的@输入
    setupAtMentionListener() {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;

        messageInput.addEventListener('input', (e) => {
            const value = e.target.value;
            const cursorPos = e.target.selectionStart;

            // 检查是否输入了@
            if (value.charAt(cursorPos - 1) === '@' && !this.isAtPanelOpen) {
                // 获取@符号的位置
                const rect = e.target.getBoundingClientRect();
                const lineHeight = parseInt(window.getComputedStyle(e.target).lineHeight);

                // 计算@面板位置
                const position = {
                    top: rect.bottom + window.scrollY,
                    left: rect.left + window.scrollX
                };

                this.openAtPanel(position);
            }
        });

        // 点击外部关闭@面板
        document.addEventListener('click', (e) => {
            if (this.isAtPanelOpen && !e.target.closest('#atPanel') && !e.target.closest('#messageInput')) {
                this.closeAtPanel();
            }
        });
    }


    // 设置用户交互监听器
    setupUserInteractionListeners() {
        // 监听用户首次交互以恢复音频上下文
        const resumeAudioOnInteraction = () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                    console.log('AudioContext resumed on user interaction');
                }).catch(err => {
                    console.warn('Failed to resume AudioContext:', err);
                });
            }
            // 只监听一次
            document.removeEventListener('click', resumeAudioOnInteraction);
            document.removeEventListener('touchstart', resumeAudioOnInteraction);
        };

        document.addEventListener('click', resumeAudioOnInteraction, {once: true});
        document.addEventListener('touchstart', resumeAudioOnInteraction, {once: true});
    }


}

// 初始化全局实例
let chatClient = null;

document
    .addEventListener(
        'DOMContentLoaded'
        , () => {
            console
                .log(
                    'DOM 加载完成，创建 ChatClient 实例'
                )
            ;
            chatClient = new ChatClient();
            window
                .chatClient = chatClient;
        }
    )
;

// 如果页面已经加载完成
if (document.readyState === 'complete') {
    console.log('页面已加载完成，立即创建 ChatClient 实例');
    chatClient = new ChatClient();
    window.chatClient = chatClient;
}