// static/js/chat.js

// 说明：实时通信/渲染/弹窗/搜索与群管理/界面交互/通话等已拆分到 chat-*.js，由 chat-boot.js 统一启动。


class ChatClient {
    constructor() {
        this.globalWs = null;  // 全局 WebSocket 连接
        this.roomWs = null;    // 当前聊天室 WebSocket 连接
        this.ws = null;
        // WebSocket 重连退避（避免服务重启时所有页面每 3 秒集中重连）
        this._globalWsReconnectDelay = 3000;
        this._globalWsReconnectTimer = null;
        this._roomWsReconnectDelay = 3000;
        this.statusCode = null;
        this.chat_login_url = '/login/';
        this.currentRoomId = null;
        this.currentUser = null;
        this.chatRooms = [];
        this.messages = [];
        this.users = [];
        // 侧边栏分页（滚动到底部时加载更多）
        this.chatRoomsPage = 1;
        this.chatRoomsHasMore = false;
        this.chatRoomsLoading = false;
        this.usersPage = 1;
        this.usersHasMore = false;
        this.usersLoading = false;
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

        this.heartbeatCount = 0;
        this.lastHeartbeatTime = null;

        this.markReadTimers = {}; // 新增：按聊天室存储防抖定时器

        // 消息加载状态
        // 🔧 无限滚动状态
        this.isInitialLoad = true;      // 是否为首次加载
        this.isLoadingMore = false;     // 是否正在加载更多
        this._historyReqToken = 0;      // 🔧 历史消息请求令牌（防止快速切换聊天室时过期响应覆盖）
        this._historyAbortController = null;  // 🔧 上一条历史消息请求的中止器
        this._historyLoadFailedToken = null;  // 🔧 记录加载失败的那次请求，避免失败后滚动到底部
        this.hasMoreMessages = true;    // 是否还有更多历史消息
        this.oldestMessageId = null;    // 最早消息的ID
        this.newestMessageId = null;    // 最新消息的ID


        // 消息通知队列
        this.notificationQueue = [];
        this.isNotificationVisible = false;

        // 右侧主内容区「工作通知」列表分页状态
        this._notifFilter = '';
        this._notifPage = 1;
        this._notifHasMore = false;
        this._notifLoadingMore = false;

        // 🔧 新增：用户交互标志（用于震动/音频等需要用户授权的功能）
        this.userHasInteracted = false;

        // 当前引用的消息
        this.currentQuoteMessage = null;

        // 当前@面板状态
        this.isAtPanelOpen = false;
        this.atPanelPosition = null;

        // 🔧 新增：当前输入框中 @提及的用户ID集合
        this.currentMentions = new Set();
        this.mentionedAll = false

        // 防止重复创建聊天室的状态
        this.creatingChatMap = new Map(); // userId -> {timestamp, roomId}
        this.chatCreationLock = false; // 全局创建锁


        // 🔧 语音消息相关
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioStream = null;
        this.recordingStartTime = null;
        this.recordingTimer = null;
        this.maxRecordingTime = 60000; // 60秒
        this.isCancelling = false;
        this.voicePlayers = new Map(); // 存储音频播放器实例

        // 🔧 关键修复：使用前端配置管理器（替代 SystemConfigManager）
        this.fileMaxSizeMB = 50;
        this.imageMaxSizeMB = 20;
        this.videoMaxSizeMB = 100;
        this.audioMaxSizeMB = 30;
        this.voiceMaxDuration = 60;
        this.voiceMinDuration = 1;
        this.maxMessageLength = 2000;
        this.messageCanrevokeMinutes = 10;

        this.contextTarget = null;

        this.inputDrafts = new Map(); // roomId -> {content, cursorPosition, quoteMessage}
        this.forwardMessage = null;   // 当前待转发的消息
        this.selectedForwardTargets = new Set(); // 选中的转发目标


        // 🔧 新增：通话功能相关属性
        this.callWs = null;                    // 通话信令 WebSocket
        this.callState = 'idle';               // idle | calling | ringing | connected | ended
        this.callType = null;                  // 'audio' | 'video'
        this.callRoomId = null;                // 当前通话的聊天室 ID
        this.localStream = null;               // 本地媒体流
        this.remoteStream = null;              // 远程媒体流
        this.peerConnection = null;            // RTCPeerConnection 实例

        // 🔧 关键修复：来电缓存属性（解决 undefined 问题）
        this.pendingOffer = null;              // 缓存收到的 SDP offer
        this.pendingCallerId = null;           // 缓存呼叫方用户 ID
        this.incomingOffer = null;             // 备用：用于 acceptCall 的 offer 缓存

        // 🔧 新增：来电弹窗引用（用于手动关闭）
        this.incomingCallModal = null;

        // 🔧 关键修复：通话保护标志，防止在处理其他消息时意外结束通话
        this.isCallInProgress = false;         // 是否有进行中的通话

        // 🔧 新增：通话时长追踪
        this.callStartTime = null;             // 通话开始时间戳
        this.callDurationTimer = null;         // 通话时长定时器

        // 🔧 关键修复：防止重复处理 answer 的标志
        this.answerProcessed = false;          // 是否已处理过 answer


        this.pendingIceCandidates = [];       // 🔧 缓存未处理的 ICE 候选
        this.isRemoteDescriptionSet = false;  // 🔧 标记 remoteDescription 是否已设置
        this.iceTimeoutTimer = null;          // 🔧 ICE 协商超时定时器
        this.iceCandidatesCollected = [];     // 🔧 已收集的 ICE 候选

        this.processedSignals = new Set();  // 🔧 新增：已处理的信令ID集合
        this.signalCacheTimeout = 5000;     // 🔧 信令缓存超时时间(5秒)

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
            window.location.href = this.chat_login_url;
            return;
        }
    }


    // 修复 iOS Safari 输入框遮挡问题
    fixIOSSafariInput() {
        if (!Utils.isIOS()) return;

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
        if (!Utils.isIOS()) return;

        // 检测是否为standalone模式
        if (this.isPWAStandaloneMode()) {
            console.log('检测到 PWA standalone 模式');
            // 仅添加 PWA 样式类，顶栏保持 flex 流内，安全区由 CSS 统一处理
            // （不再设置 position:fixed，否则会遮住侧边栏头像和聊天头部按钮）
            document.body.classList.add('pwa-mode');
        }
    }

    // 🔧 新增：保存当前聊天室的输入草稿
    saveInputDraft(roomId) {
        if (!roomId) return;
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;
        if (!messageInput.value) {
            let hasDraft = this.inputDrafts.get(parseInt(roomId))
            if (hasDraft) {
                this.inputDrafts.delete(parseInt(roomId));
            }
            return
        }
        ;

        this.inputDrafts.set(parseInt(roomId), {
            content: messageInput.value,
            cursorPosition: messageInput.selectionStart,
            quoteMessage: this.currentQuoteMessage ? {...this.currentQuoteMessage} : null,
            timestamp: Date.now()
        });
    }

    // 🔧 新增：恢复指定聊天室的输入草稿
    restoreInputDraft(roomId) {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) return;

        const draft = this.inputDrafts.get(parseInt(roomId));
        console.log('恢复草稿 roomId:', roomId, ' draft: ', draft);
        if (draft) {
            messageInput.value = draft.content || '';
            this.adjustTextareaHeight(messageInput);

            // 恢复光标位置
            if (draft.cursorPosition !== undefined) {
                setTimeout(() => {
                    messageInput.setSelectionRange(
                        draft.cursorPosition,
                        draft.cursorPosition
                    );
                }, 10);
            }

            // 恢复引用消息
            if (draft.quoteMessage) {
                this.setQuoteMessage(draft.quoteMessage);
            }

            console.log('恢复草稿 roomId:', roomId);

        } else {
            console.log('恢复草稿 roomId:', roomId, ' 无草稿');
            // 新聊天室，清空输入框
            messageInput.value = '';
            this.adjustTextareaHeight(messageInput);
            this.clearQuoteMessage();
        }
    }


    async init() {
        console.log('ChatClient 初始化开始...');
        // 🔧 PWA：尽早监听安装事件（Android/鸿蒙 beforeinstallprompt），避免错过
        this.initInstallPrompt();
        // 🔧 初始同步安装入口显示状态（无 beforeinstallprompt 的浏览器也展示「安装到桌面」以提供引导）
        this._updateInstallPromptUI();

        // 🔧 关键修复1: 注册 Service Worker（锁屏通知必需）
        this.registerServiceWorker();

        // 🔧 PWA：移动端「添加到主屏幕 + 开启通知」一次性引导
        this.initPwaGuideBanner();


        try {

            // 检查登录状态
            await this.checkLoginStatus();

            // 🔧 PWA：登录后确保订阅 Web Push（注册 SW 时可能还未拿到 token）
            this.ensurePushSubscribed();

            // 🔧 订阅自动补订：服务端 token 因 410 被清理后，定时重试直到重新建订阅
            // （幂等：已有订阅则重 POST 同步，无订阅则新建），避免安卓/鸿蒙长期 subs=0
            this._startPushSubscribeRetry();

            // 🔧 关键修复：以用户手势请求通知权限（iOS 必须手势触发，否则不弹窗/可能静默拒绝）
            this.requestNotificationPermission();

            // 🔧 通知权限诊断：权限被拒绝时页面无法再次弹窗，必须引导去浏览器设置开启
            if ('Notification' in window && Notification.permission === 'denied') {
                setTimeout(() => {
                    this.showInfo('通知权限已被拒绝：请在浏览器地址栏点锁图标 → 网站设置 → 通知 → 允许，才能收到推送。');
                }, 1500);
            } else if (!(window.PushNotifier && window.PushNotifier.supported())) {
                // 只提示一次，之后不再提示（避免每次进入/刷新都弹）
                if (!localStorage.getItem('push_unsupported_notified')) {
                    localStorage.setItem('push_unsupported_notified', '1');
                    setTimeout(() => {
                        this.showInfo('当前浏览器不支持消息推送，请用 Chrome / Edge / 夸克 打开后安装。');
                    }, 1500);
                }
            }

            // 🔧 关键修复：加载系统配置（使用 FrontendConfigManager）
            await this.loadSystemConfigs();

            // 初始化通知系统（音频等，不在加载时自动请求权限）
            this.initNotificationSystem();


            // 初始化角标
            this.updateAppBadge(0);

            // 🔧 关键修复：监听页面可见性变化
            document.addEventListener('visibilitychange', () => {
                // console.log(`页面可见性变化: ${document.visibilityState}`);

                // 页面变为可见时，清除角标闪烁
                if (document.visibilityState === 'visible') {
                    this.stopTitleBlink();

                    // 回到前台：查询是否有待接听的来电（后台/锁屏期间错过的）
                    this._checkPendingCall();

                    // 更新角标（可能有新消息）
                    const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                    this.updateAppBadge(totalUnread);

                    // 兜底：已授权通知但尚未订阅 Web Push 时补订（新设备 / 订阅被清理后）
                    if ('Notification' in window && Notification.permission === 'granted' &&
                        window.PushNotifier && !localStorage.getItem('pushSubscribed')) {
                        window.PushNotifier.subscribe();
                    }

                }
                // 页面变为隐藏时，停止音频播放（可选优化）
                else if (document.visibilityState === 'hidden') {
                    // 可选：暂停所有音频播放
                    this.voicePlayers.forEach((player) => {
                        if (!player.paused) {
                            player.pause();
                        }
                    });
                }
            });

            window.addEventListener('focus', () => {
                // console.log('窗口聚焦');
                // 恢复角标
                const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                this.updateAppBadge(totalUnread);
            });

            if (this.isShowingSidebar) {
                this.closeSidebar();
                this.showSidebar();
            } else {
                this.closeSidebar();
            }

            // 获取当前用户信息
            this.currentUser = await API.getCurrentUser();
            this.renderCurrentUser();

            if (this.currentUser?.id) {
                localStorage.setItem('user_id', this.currentUser.id);
                localStorage.setItem('user_type', this.currentUser?.user_type);
            }

            // 检查是否为管理员，显示控制台按钮
            if (this.currentUser.user_type === 'super_admin' || this.currentUser.user_type === 'admin') {
                const adminConsoleBtn = document.getElementById('adminConsoleBtn');
                if (adminConsoleBtn) {
                    adminConsoleBtn.style.display = 'flex';
                    adminConsoleBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        window.location.href = '/control/';
                    });
                }
            }

            const cloudBtn = document.getElementById('cloudBtn');
            if (cloudBtn) {
                cloudBtn.style.display = 'flex';
                cloudBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = '/cloud/';
                });
            }

            const tasksBtn = document.getElementById('tasksBtn');
            if (tasksBtn) {
                tasksBtn.style.display = 'flex';
                tasksBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = '/tasks/';
                });
            }

            const attendanceBtn = document.getElementById('attendanceBtn');
            if (attendanceBtn) {
                attendanceBtn.style.display = 'flex';
                attendanceBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = '/oa/attendance/';
                });
            }

            const approvalBtn = document.getElementById('approvalBtn');
            if (approvalBtn) {
                approvalBtn.style.display = 'flex';
                approvalBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = '/oa/approval/';
                });
            }

            const subsidyBtn = document.getElementById('subsidyBtn');
            if (subsidyBtn) {
                subsidyBtn.style.display = 'flex';
                subsidyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = '/oa/subsidy/';
                });
            }

            const orgBtn = document.getElementById('orgBtn');
            if (orgBtn) {
                orgBtn.style.display = 'flex';
                orgBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.location.href = '/org/';
                });
            }

            // 连接全局 WebSocket
            this.connectGlobalWebSocket();

            // 回到前台/网络恢复时立即恢复连接（通知 WS 由这里统一维护）
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'visible') return;
                this._globalWsReconnectDelay = 3000;
                this._roomWsReconnectDelay = 3000;
                if (!this.globalWs || this.globalWs.readyState > WebSocket.OPEN) {
                    this.connectGlobalWebSocket();
                }
                if (this.currentRoomId && (!this.ws || this.ws.readyState > WebSocket.OPEN)) {
                    this.connectWebSocket(this.currentRoomId);
                }
            });
            window.addEventListener('online', () => {
                this._globalWsReconnectDelay = 3000;
                this._roomWsReconnectDelay = 3000;
                if (!this.globalWs || this.globalWs.readyState > WebSocket.OPEN) {
                    this.connectGlobalWebSocket();
                }
                if (this.currentRoomId && (!this.ws || this.ws.readyState > WebSocket.OPEN)) {
                    this.connectWebSocket(this.currentRoomId);
                }
            });

            // 获取聊天列表
            await this.loadChatRooms();

            // 加载用户列表
            await this.loadUsers();

            // 加载部门列表
            await this.loadDepartments();

            this.initTheme();

            // 设置事件监听
            this.setupEventListeners();
            this.setupSidebar();
            this.setupSidebarInfiniteScroll();
            this.setupContextMenu();

            // 初始化用户下拉菜单
            this.initUserDropdown()

            // 更新全局顶栏企业名称
            var self = this;
            setTimeout(function () {
                self.updateGlobalTenantUI();
            }, 200);

            // 点击页面空白处关闭企业切换下拉
            document.addEventListener('click', function (e) {
                if (!e.target.closest('.tenant-switcher-trigger') && !e.target.closest('.tenant-dropdown')) {
                    document.querySelectorAll('.tenant-dropdown').forEach(function (d) {
                        d.classList.remove('show');
                    });
                    document.querySelectorAll('.tenant-switcher-arrow').forEach(function (a) {
                        a.classList.remove('open');
                    });
                }
            });

            // 请求通知权限（改由用户手势触发；页面加载时无手势调用在 iOS 上不弹窗且可能影响后续授权）
            this.requestNotificationPermission();


            // 移动端优化
            if (Utils.isMobile()) {
                this.setupMobileOptimizations();
                // 🔧 关键修复：初始化移动端音频上下文
                this.initAudioContextForMobile();
            }

            // 🔧 关键修复：调用 iOS 专用修复
            this.fixIOSSafariInput();

            // 修复iOS PWA布局
            this.fixPWALayout();

            // 🔧 关键修复：初始化版本管理
            await this.initVersionManagement();

            // 设置@功能监听
            this.setupAtMentionListener();

            // 设置无限滚动
            this.setupInfiniteScroll();

            // 初始化直达底部按钮
            this.initScrollToBottomButton();

            // 设置用户交互监听器以恢复音频
            this.setupUserInteractionListeners();

            // 🔧 初始化语音消息功能
            this.initVoiceMessage();

            this.setupVideoMessageListerners()

            this.setupUserInteractionListener();


            // 🔧 关键修复：监听页面卸载事件
            window.addEventListener('beforeunload', () => {
                this.beforeUnload();
            });

            // // 在 getUserMedia 成功后添加
            // if (this.callType === 'video' && this.localStream) {
            //     const localVideo = document.getElementById('localVideo');
            //     const remoteVideo = document.getElementById('remoteVideo');
            //     const btnVideoToggle = document.getElementById('btnVideoToggle');
            //
            //     if (localVideo) {
            //         localVideo.srcObject = this.localStream;
            //         localVideo.classList.remove('hidden');
            //     }
            //     if (remoteVideo) {
            //         remoteVideo.classList.remove('hidden');
            //     }
            //     if (btnVideoToggle) {
            //         btnVideoToggle.style.display = 'block';
            //     }
            // } else {
            //     const btnVideoToggle = document.getElementById('btnVideoToggle');
            //     if (btnVideoToggle) {
            //         btnVideoToggle.style.display = 'none';
            //     }
            // }

            // 在 init() 中添加
            if (typeof RTCPeerConnection !== 'undefined') {
                window.RTCPeerConnection = new Proxy(RTCPeerConnection, {
                    construct(target, args) {
                        console.log('🔧 [RTC-DEBUG] 创建 PeerConnection:', args[0]);
                        return new target(...args);
                    }
                });
            }

            this.setupPageUnloadListener();

            console.log('ChatClient 初始化完成');
        } catch (error) {
            console.error('初始化失败:', error);
            this.showError('初始化失败，请重新登录: ' + error);
            this.handleAuthError()
        }
    }


    // 🔧 新增：加载系统配置（使用 FrontendConfigManager）
    async loadSystemConfigs() {
        try {
            // 等待配置加载完成
            await frontendConfig.loadConfigs();

            // 应用配置
            this.applySystemConfigs();

            console.log('✅ 系统配置已应用');
        } catch (error) {
            console.warn('⚠️ 加载系统配置失败，使用默认值:', error);
            this.applySystemConfigs();
        }
    }

    // 🔧 新增：应用系统配置
    applySystemConfigs() {
        // 文件上传大小限制
        this.fileMaxSizeMB = frontendConfig.get('file.max_upload_size_mb', 50);
        this.imageMaxSizeMB = frontendConfig.get('file.image_max_size_mb', 20);
        this.videoMaxSizeMB = frontendConfig.get('file.video_max_size_mb', 100);
        this.audioMaxSizeMB = frontendConfig.get('file.audio_max_size_mb', 30);

        // 语音消息时长限制
        this.voiceMaxDuration = frontendConfig.get('voice.max_duration_seconds', 60);
        this.voiceMinDuration = frontendConfig.get('voice.min_duration_seconds', 1);

        // 消息长度限制
        this.maxMessageLength = frontendConfig.get('chat.max_message_length', 2000);
        localStorage.setItem('max_message_length', this.maxMessageLength);

        // 消息可撤回时间限制
        this.messageCanrevokeMinutes = frontendConfig.get('chat.message_canrevoke_minutes', 10);

        // 截图功能版本（管理控制台可切换）：fullscreen=整屏截图（默认） / region=区域截图
        this.screenshotVersion = frontendConfig.get('chat.screenshot_version', 'fullscreen') || 'fullscreen';
        this.applyScreenshotButtonUI();

        console.log('📋 系统配置已应用:', {
            fileMaxSizeMB: this.fileMaxSizeMB,
            voiceMinDuration: this.voiceMinDuration,
            voiceMaxDuration: this.voiceMaxDuration,
            maxMessageLength: this.maxMessageLength,
            messageCanrevokeMinutes: this.messageCanrevokeMinutes
        });
    }


    // 注册 Service Worker
    registerServiceWorker() {
        // 仅在支持 Service Worker 的浏览器中注册
        if (!('serviceWorker' in navigator)) {
            console.warn('Service Worker not supported');
            return;
        }

        // 仅在 HTTPS 环境下注册（生产环境）
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            console.warn('Service Worker requires HTTPS');
            return;
        }

        navigator.serviceWorker.register('/service-worker.js', {updateViaCache: 'none'})
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);

                // 监听来自 Service Worker 的消息
                navigator.serviceWorker.addEventListener('message', event => {
                    if (event.data.type === 'notification-click' && event.data.chat_room) {
                        this.selectChatRoom(event.data.chat_room);
                    }
                });

                // Web Push 订阅（已授权通知时自动订阅，锁屏/后台也能收到消息；登录后会再次兜底）
                this.ensurePushSubscribed();
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });

        // 🔧 部署更新：新 Service Worker 激活接管页面时自动刷新一次，
        // 确保改版本号后第一时间拿到最新静态资源（而非旧 SW 缓存）
        let _swRefreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (_swRefreshing) return;
            _swRefreshing = true;
            console.log('Service Worker 已更新，自动刷新加载最新资源');
            window.location.reload();
        });
    }


    // 修复：发送图片/文件消息（限制9个，支持视频）
    async sendImageOrFileMessage(files) {
        // 🔧 关键修复 1: 保存发送时的 roomId
        const sendRoomId = this.currentRoomId;

        if (!sendRoomId) {
            console.error('请先选择一个聊天对象');
            this.showError('请先选择一个聊天对象');
            return;
        }

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

            // 🔧 关键修复：使用实例变量验证文件大小
            const maxSizeBytes = this.fileMaxSizeMB * 1024 * 1024
            if (file.size > maxSizeBytes) {
                this.showToast(`${file.name} 超过${this.fileMaxSizeMB}MB，无法发送`, 'error');
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

        // 🔧 关键修复 2: 逐个上传文件，每个都使用保存的 roomId
        for (const file of validFiles) {
            try {
                // 🔧 传递保存的 roomId
                this.sendFile(file, sendRoomId);

            } catch (error) {
                console.error('发送文件失败:', error);
                this.showToast(`发送 ${file.name} 失败`, 'error');
            }
        }
    }

    // 支持把本地文件/图片拖拽到聊天区域（含输入框）直接发送
    setupDragDropUpload() {
        const chatMain = document.querySelector('.chat-main');
        const overlay = document.getElementById('chatDropOverlay');
        if (!chatMain || !overlay) return;

        let dragDepth = 0;

        const isFileDrag = (e) => {
            const dt = e.dataTransfer;
            if (!dt) return false;
            const types = dt.types || [];
            for (let i = 0; i < types.length; i++) {
                if (types[i] === 'Files') return true;
            }
            if (dt.items) {
                for (let i = 0; i < dt.items.length; i++) {
                    if (dt.items[i].kind === 'file') return true;
                }
            }
            return false;
        };

        const hideOverlay = () => {
            dragDepth = 0;
            overlay.classList.remove('show');
        };

        chatMain.addEventListener('dragenter', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            dragDepth++;
            if (this.currentRoomId) overlay.classList.add('show');
        });

        chatMain.addEventListener('dragover', (e) => {
            if (!isFileDrag(e)) return;
            // 必须阻止默认行为，否则浏览器会直接打开拖入的文件
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer && 'dropEffect' in e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
            if (this.currentRoomId) overlay.classList.add('show');
        });

        chatMain.addEventListener('dragleave', (e) => {
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0 || e.relatedTarget === null) hideOverlay();
        });

        chatMain.addEventListener('drop', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            hideOverlay();
            if (!this.currentRoomId) {
                this.showError('请先选择一个聊天对象');
                return;
            }
            const files = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
            if (files.length) this.sendImageOrFileMessage(files);
        });

        // 拖出窗口 / 松手在窗口外时兜底隐藏遮罩
        window.addEventListener('drop', () => hideOverlay());
        window.addEventListener('dragend', () => hideOverlay());
        window.addEventListener('blur', () => hideOverlay());
    }

    // 发送文本消息统一加密
    async sendMessage(content = null, targetRoomId = null) {
        // 🔧 关键修复 1: 使用传入的 roomId 或当前的 currentRoomId
        const roomId = parseInt(targetRoomId || this.currentRoomId);

        if (!roomId) {
            this.showError('请先选择一个聊天对象');
            return;
        }


        const messageInput = document.getElementById('messageInput');
        const actualContent = content || (messageInput ? messageInput.value.trim() : '');

        if (!actualContent && !content?.file_id) {
            return;
        }

        if (actualContent && actualContent.length > parseInt(this.maxMessageLength)) {
            this.showToast(`你输入的文字过长，无法发送`, 'error');
            return;
        }

        console.log('actualContent: ', actualContent)

        // 清空输入框
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            this.adjustTextareaHeight(messageInput);
        }

        // 停止输入状态
        this.stopTyping();

        // 🔧 关键修复 2: 创建临时消息对象，使用虚拟 ID
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
            file_info: actualContent?.file_info,
            chat_room: parseInt(roomId),  // 🔧 使用正确的 roomId
            mentioned_users: Array.from(this.currentMentions),
            mentioned_all: this.mentionedAll,
            is_temp: true
        };

        // 添加引用信息
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
            messageData.quote_file_info = this.currentQuoteMessage.file_info || null;
        }
        // 保存到本地消息列表
        this.messages.push(messageData);

        // 渲染并滚动到底部
        this.renderMessage(messageData, 'sent');
        Utils.scrollToBottom(document.getElementById('messagesList'));

        // 🔧 关键修复 3: 通过 WebSocket 发送（传递临时 ID 和正确的 roomId）
        //    仅当 socket 属于目标聊天室时才直发，否则走队列，杜绝发到别的聊天室
        const wsReady = this.ws && this.ws.readyState === WebSocket.OPEN &&
            parseInt(this.ws._roomId) === parseInt(roomId);
        if (wsReady) {
            this.ws.send(JSON.stringify(this.encryptPacket({
                type: "chat_message",
                ...messageData
            })));
        } else {
            // WebSocket 不可用或 socket 与目标聊天室不一致时加入队列（同样包含引用信息）
            const queueMessage = messageData;
            this.messageQueue.push(queueMessage);
            this.showError('网络连接不稳定，消息将在连接恢复后发送');
        }

        // 本地预更新聊天室最后一条消息
        this.updateChatRoomLastMessage(roomId, messageData.content, messageData.timestamp);

        // 发送成功后清除引用（避免影响下一条消息）
        this.clearQuoteMessage();
        this.clearMentions(); // 🔧 新增调用

        // 清空当前聊天室的草稿
        const hasDraft = this.inputDrafts.has(parseInt(roomId));
        console.log('清除聊天室草稿 roomId:', roomId, ' hasDraft: ', hasDraft);
        if (hasDraft) {
            this.inputDrafts.delete(parseInt(roomId));
            this.renderChatRooms(); // ✅ 立即更新侧边栏状态
        }

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

    // 聊天室列表「最后一条消息」预览文案（卡片消息显示友好样式而非原始 JSON）
    _lastMessagePreview(lastMessage) {
        if (!lastMessage) return '暂无消息';
        const mt = lastMessage.message_type;
        const c = lastMessage.content || '';
        if (mt === 'work_summary_card') {
            if (c.indexOf('{') === 0) {
                try {
                    const d = JSON.parse(c);
                    return '📄 ' + (d.user_name || d.sender_name || '员工') + ' 的每日工作总结' + (d.summary_date ? '（' + d.summary_date + '）' : '');
                } catch (e) {}
            }
            return c || '📄 每日工作总结';
        }
        if (mt === 'approval_card') {
            if (c.indexOf('{') === 0) {
                try {
                    const d = JSON.parse(c);
                    if (d.mention) {
                        return '📢 ' + (d.sender_name || '') + ' 在审批中提及了您：' + (d.title || '');
                    }
                    return '📨 ' + (d.applicant_name || '') + ' 的审批' + (d.title ? '：' + d.title : '');
                } catch (e) {}
            }
            return c || '📨 审批卡片';
        }
        if (mt === 'task_card') {
            if (c.indexOf('{') === 0) {
                try {
                    const d = JSON.parse(c);
                    return '📋 ' + (d.title || '任务');
                } catch (e) {}
            }
            return c || '📋 任务卡片';
        }
        if (mt === 'work_order_card') {
            if (c.indexOf('{') === 0) {
                try {
                    const d = JSON.parse(c);
                    const p = d.progress || {};
                    return '🧾 工单 ' + (d.order_no || '') + '「' + (d.title || '') + '」 · '
                        + (d.status_display || '') + ' ' + (p.done || 0) + '/' + (p.total || 0);
                } catch (e) {}
            }
            return c || '🧾 群工单';
        }
        if (mt === 'work_order_notice') {
            if (c.indexOf('{') === 0) {
                try {
                    const d = JSON.parse(c);
                    return d.text || '🧾 工单通知';
                } catch (e) {}
            }
            return c || '🧾 工单通知';
        }
        return lastMessage.content || '暂无消息';
    }

    // 更新聊天室未读数
    updateChatRoomUnreadCount(roomId, increment) {
        const room = this.chatRooms.find(r => parseInt(r.id) === parseInt(roomId));
        if (room) {
            console.log('更新聊天室未读数 room:', roomId, room);
            console.log('更新聊天室未读数 increment:', roomId, increment);
            console.log('更新聊天室未读数 unread_count:', roomId, room.unread_count);
            room.unread_count = Math.max(0, (room.unread_count || 0) + increment);
            console.log('更新聊天室未读数 unread_count:', roomId, room.unread_count);
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

    handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;

        if (!this.currentRoomId) {
            this.showError('请先选择一个聊天对象');
            return;
        }

        // 1) 站内复制的图片/视频/语音/文件消息：直接按原消息类型发送（不再变成链接文本）
        const copiedPayload = this._readCopiedMessageMarker(clipboardData);
        if (copiedPayload) {
            e.preventDefault();
            this.sendExistingFileMessage(copiedPayload);
            return;
        }
        // 2) 非 HTTPS / 剪贴板不支持富格式时：按最近一次复制文本精确匹配
        try {
            const cached = this._copiedMessage;
            if (cached && cached.payload && Date.now() - cached.at < 5 * 60 * 1000) {
                const pastedText = (clipboardData && clipboardData.getData
                    ? clipboardData.getData('text/plain') : '') || '';
                if (pastedText.trim() && pastedText.trim() === cached.text) {
                    e.preventDefault();
                    this.sendExistingFileMessage(cached.payload);
                    return;
                }
            }
        } catch (err) { /* 继续按默认粘贴处理 */ }

        // 只处理图片，其他内容交给浏览器默认处理
        if (clipboardData?.items) {
            for (let item of clipboardData.items) {
                if (item.type?.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = item.getAsFile();
                    if (blob) this.sendImageFromClipboard(blob);
                    return;
                }
            }
        }

        // 🔑 关键：纯文本不阻止默认行为，保证兼容性
        // 可选：异步处理@提及
        setTimeout(() => {
            const text = clipboardData?.getData?.('text/plain');
            if (text?.includes('@')) this.checkMentionsInPastedText(text);
        }, 0);
    }


    // 🔧 新增：检查粘贴文本中的@提及
    checkMentionsInPastedText(text) {
        if (!text || !this.currentRoomId) return;

        // 获取当前聊天室成员
        const room = this.chatRooms.find(r => r.id === parseInt(this.currentRoomId));
        if (!room || !room.members) return;

        // 简单检测是否包含@符号
        if (text.includes('@')) {
            // 可以在此处触发@面板或高亮提示
            // 注意：不要自动插入，避免干扰用户粘贴体验
            console.log('粘贴内容包含@，可触发提示');
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

    // 截图入口：按「截图功能版本」（管理控制台 → 系统设置 → 聊天设置 可切换）分发
    //   fullscreen（默认）：整屏截图 —— 截屏选择框默认勾选「整个屏幕」，无需切换标签页/窗口，
    //                       抓取整屏后在预览里确认发送（Enter 发送 / Esc 取消）
    //   region：区域截图 —— 拖拽框选范围后发送（原版行为）
    async captureScreenshot() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            this.showError('当前浏览器不支持屏幕截图，请使用 Chrome / Edge 浏览器');
            return;
        }
        if (!this.currentRoomId) {
            this.showError('请先选择聊天对象，再进行截图发送');
            return;
        }
        if (this.screenshotVersion === 'region') {
            return this._captureScreenshotRegion();
        }
        return this._captureScreenshotFullscreen();
    }

    // 截图按钮文案随版本变化
    applyScreenshotButtonUI() {
        const btn = document.getElementById('screenshotBtn');
        if (!btn) return;
        btn.title = (this.screenshotVersion === 'region')
            ? '区域截图（拖拽框选范围后发送）'
            : '整屏截图（选择框默认整个屏幕，可在当前屏幕直接拖拽框选区域，不框选则发送整屏）';
    }

    // 抓取一帧屏幕画面。surface 为预设提示（monitor=整个屏幕 / window=窗口 / browser=标签页），
    // 传 'monitor' 可让 Chrome 在选择框里默认选中「整个屏幕」，用户无需再切换标签页或窗口。
    async _grabScreenFrame(surface) {
        const constraints = {
            video: {cursor: 'always'},
            audio: false,
            // 候选里不出现本标签页，并隐藏「切换共享内容」悬浮栏，进一步减少误选与干扰
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'exclude',
        };
        if (surface) constraints.video.displaySurface = {ideal: surface};
        const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
        try {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.playsInline = true;
            video.muted = true;
            await new Promise((resolve) => {
                video.onloadedmetadata = resolve;
                setTimeout(resolve, 8000); // 超时兜底，避免一直等待
            });
            await Promise.race([
                video.play().catch(() => {
                }),
                new Promise(resolve => setTimeout(resolve, 5000)),
            ]);
            // 等待一帧渲染完成后再绘制，避免截到黑帧
            await new Promise(resolve => setTimeout(resolve, 120));

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || window.screen.width || 1280;
            canvas.height = video.videoHeight || window.screen.height || 720;
            canvas.getContext('2d').drawImage(video, 0, 0);
            return canvas;
        } finally {
            // 释放屏幕共享（停止屏幕占用提示）
            try {
                stream.getTracks().forEach(t => t.stop());
            } catch (ignore) {
            }
        }
    }

    // 版本一（默认）：整屏截图 —— 默认整个屏幕，抓取后预览确认即可发送
    async _captureScreenshotFullscreen() {
        let canvas;
        try {
            canvas = await this._grabScreenFrame('monitor');
        } catch (e) {
            // 用户取消选择或浏览器拒绝
            console.warn('整屏截图取消或失败:', e);
            return;
        }
        // 整屏画面铺满视口：在当前屏幕直接拖拽框选区域；不框选则发送整屏（Enter 发送 / Esc 取消）
        const blob = await this._openScreenshotCropper(canvas, {allowFullScreen: true});
        if (blob) await this.sendImageFromClipboard(blob);
    }

    // 版本二：区域截图 —— 拖拽框选范围后发送
    async _captureScreenshotRegion() {
        let canvas;
        try {
            canvas = await this._grabScreenFrame(null);
        } catch (e) {
            console.warn('区域截图取消或失败:', e);
            return;
        }
        const blob = await this._openScreenshotCropper(canvas);
        if (blob) await this.sendImageFromClipboard(blob);
    }

    // 截图区域选择浮层：把抓取到的整屏图铺满视口，鼠标在当前屏幕直接拖拽框选范围，返回裁剪后的 PNG blob（取消返回 null）。
    // opts.allowFullScreen=true（整屏截图版本）：不框选也可直接发送整屏，Enter 发送（有选区则发选区）。
    _openScreenshotCropper(sourceCanvas, opts) {
        opts = opts || {};
        const allowFull = !!opts.allowFullScreen;
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.id = 'screenshotCropOverlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;'
                + 'background:' + (allowFull ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.6)')
                + ';cursor:crosshair;user-select:none;-webkit-user-drag:none;';
            document.body.appendChild(overlay);

            const img = new Image();
            img.src = sourceCanvas.toDataURL('image/png');
            img.onload = () => {
                const vw = window.innerWidth, vh = window.innerHeight;
                const iw = img.naturalWidth, ih = img.naturalHeight;
                const scale = Math.min(vw / iw, vh / ih);
                const dispW = Math.round(iw * scale), dispH = Math.round(ih * scale);
                const offsetX = Math.round((vw - dispW) / 2), offsetY = Math.round((vh - dispH) / 2);
                const sf = 1 / scale; // 原始像素 / 显示像素

                const imgEl = document.createElement('img');
                imgEl.src = img.src;
                imgEl.style.cssText = 'position:absolute;left:' + offsetX + 'px;top:' + offsetY + 'px;'
                    + 'width:' + dispW + 'px;height:' + dispH + 'px;pointer-events:none;';
                overlay.appendChild(imgEl);

                const selRect = document.createElement('div');
                selRect.style.cssText = 'position:absolute;display:none;border:2px solid #409eff;'
                    + 'background:rgba(64,158,255,0.15);z-index:2;pointer-events:none;';
                overlay.appendChild(selRect);

                const hint = document.createElement('div');
                hint.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);color:#fff;'
                    + 'background:rgba(0,0,0,0.6);padding:6px 14px;border-radius:6px;font-size:13px;z-index:3;pointer-events:none;white-space:nowrap;';
                const hintDefault = allowFull
                    ? '已默认截取整个屏幕 —— 在当前屏幕按住鼠标左键拖拽可框选区域，不框选则发送整屏；Enter 发送 · Esc 取消'
                    : '按住鼠标左键拖拽选择截图区域，Esc 取消';
                hint.textContent = hintDefault;
                overlay.appendChild(hint);

                const toolbar = document.createElement('div');
                toolbar.style.cssText = 'position:absolute;z-index:3;gap:8px;align-items:center;'
                    + (allowFull
                        ? 'display:flex;left:50%;transform:translateX(-50%);bottom:24px;'
                        : 'display:none;');
                toolbar.innerHTML =
                    '<button type="button" data-act="sel" style="display:none;padding:6px 18px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">✓ 发送选区</button>'
                    + (allowFull ? '<button type="button" data-act="full" style="padding:6px 18px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">✓ 发送整屏</button>' : '')
                    + '<button type="button" data-act="cancel" style="padding:6px 18px;background:rgba(255,255,255,0.92);color:#333;border:none;border-radius:6px;cursor:pointer;font-size:13px;">取消</button>'
                    + (allowFull ? '<span style="color:rgba(255,255,255,.65);font-size:12px;">拖拽可框选区域</span>' : '');
                overlay.appendChild(toolbar);
                const selBtn = toolbar.querySelector('[data-act="sel"]');
                const fullBtn = toolbar.querySelector('[data-act="full"]');
                const cancelBtn = toolbar.querySelector('[data-act="cancel"]');

                let drawing = false;
                let startX = 0, startY = 0;
                let sel = null; // {x,y,w,h} 视口坐标
                const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                const hasSel = () => !!(sel && sel.w >= 4 && sel.h >= 4);
                // 有选区 → 只显示「发送选区」；无选区 → 整屏版本显示「发送整屏」
                const updateBtns = () => {
                    const ok = hasSel();
                    selBtn.style.display = ok ? '' : 'none';
                    if (fullBtn) fullBtn.style.display = ok ? 'none' : '';
                };

                const cleanup = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.removeEventListener('keydown', onKey);
                    window.removeEventListener('resize', onResize);
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                };

                const onMove = (e) => {
                    if (!drawing) return;
                    const x1 = clamp(e.clientX, offsetX, offsetX + dispW);
                    const y1 = clamp(e.clientY, offsetY, offsetY + dispH);
                    const x = Math.min(startX, x1), y = Math.min(startY, y1);
                    const w = Math.abs(x1 - startX), h = Math.abs(y1 - startY);
                    sel = {x: x, y: y, w: w, h: h};
                    selRect.style.display = 'block';
                    selRect.style.left = x + 'px';
                    selRect.style.top = y + 'px';
                    selRect.style.width = w + 'px';
                    selRect.style.height = h + 'px';
                    updateBtns();
                    // 区域截图版本：工具栏跟随选区边缘（整屏版本工具栏固定在底部，避免跳动）
                    if (!allowFull) {
                        let tx = x + w + 6, ty = y;
                        if (tx + 130 > vw) tx = Math.max(4, x - 136);
                        if (ty + 90 > vh) ty = Math.max(4, y + h - 90);
                        toolbar.style.left = tx + 'px';
                        toolbar.style.top = ty + 'px';
                        toolbar.style.display = 'flex';
                    }
                };

                const onDown = (e) => {
                    if (e.button !== 0) return;
                    if (e.target && e.target.closest && e.target.closest('button')) return; // 工具栏按钮不触发选区
                    e.preventDefault();
                    drawing = true;
                    startX = e.clientX; startY = e.clientY;
                    sel = null;
                    selRect.style.display = 'none';
                    updateBtns();
                    if (!allowFull) toolbar.style.display = 'none';
                };

                const onUp = (e) => {
                    if (!drawing) return;
                    drawing = false;
                    onMove(e);
                    if (!hasSel()) {
                        hint.textContent = '拖拽范围太小，请重新框选';
                        setTimeout(() => { hint.textContent = hintDefault; }, 1500);
                    }
                };

                const onKey = (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        cleanup(); resolve(null);
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        // 有选区发送选区；整屏版本无选区则发送整屏；区域截图版本无选区不发送
                        finish(hasSel() ? 'sel' : (allowFull ? 'full' : 'cancel'));
                    }
                };

                const onResize = () => { cleanup(); resolve(null); };

                const finish = (mode) => {
                    if (mode === 'cancel') { cleanup(); resolve(null); return; }
                    if (mode === 'sel' && hasSel()) {
                        const ox = clamp(sel.x - offsetX, 0, dispW);
                        const oy = clamp(sel.y - offsetY, 0, dispH);
                        const ow = Math.min(sel.w, dispW - ox);
                        const oh = Math.min(sel.h, dispH - oy);
                        const cropCanvas = document.createElement('canvas');
                        cropCanvas.width = Math.max(1, Math.round(ow * sf));
                        cropCanvas.height = Math.max(1, Math.round(oh * sf));
                        cropCanvas.getContext('2d').drawImage(
                            sourceCanvas,
                            Math.round(ox * sf), Math.round(oy * sf),
                            cropCanvas.width, cropCanvas.height,
                            0, 0, cropCanvas.width, cropCanvas.height
                        );
                        cropCanvas.toBlob((blob) => { cleanup(); resolve(blob); }, 'image/png');
                        return;
                    }
                    if (mode === 'full' && allowFull) {
                        // 发送整屏：直接用抓取到的原始画面，保证与原分辨率一致
                        sourceCanvas.toBlob((blob) => { cleanup(); resolve(blob); }, 'image/png');
                        return;
                    }
                    cleanup();
                    resolve(null);
                };

                updateBtns();
                selBtn.addEventListener('click', () => finish('sel'));
                if (fullBtn) fullBtn.addEventListener('click', () => finish('full'));
                cancelBtn.addEventListener('click', () => finish('cancel'));
                overlay.addEventListener('mousedown', onDown);
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                document.addEventListener('keydown', onKey);
                window.addEventListener('resize', onResize);
            };
            img.onerror = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(null); };
        });
    }


    // 加载聊天室（append=true 表示滚动到底部加载下一页）
    async loadChatRooms(append = false) {
        if (this.chatRoomsLoading) return;
        const page = append ? (this.chatRoomsPage || 1) + 1 : 1;
        this.chatRoomsLoading = true;
        try {
            const data = await API.getChatRoomsPage(page);
            const rows = Array.isArray(data) ? data : (data.results || []);

            if (append) {
                const existing = new Set(this.chatRooms.map(r => r.id));
                this.chatRooms = this.chatRooms.concat(rows.filter(r => !existing.has(r.id)));
            } else {
                this.chatRooms = rows;
            }

            this.chatRoomsPage = (data && data.page) || page;
            const hasNextKey = data && !Array.isArray(data) &&
                Object.prototype.hasOwnProperty.call(data, 'next');
            this.chatRoomsHasMore = Array.isArray(data) ? false : (hasNextKey
                ? !!data.next
                : (typeof data.count === 'number' && this.chatRooms.length < data.count));

            // 渲染所有标签页（保留滚动位置，避免加载更多时列表跳回顶部）
            const chatEl = document.getElementById('chatList');
            const groupEl = document.getElementById('groupsList');
            const chatScrollTop = append && chatEl ? chatEl.scrollTop : 0;
            const groupScrollTop = append && groupEl ? groupEl.scrollTop : 0;
            this.renderChatRooms();
            this.renderGroups();
            if (append && chatEl) chatEl.scrollTop = chatScrollTop;
            if (append && groupEl) groupEl.scrollTop = groupScrollTop;

        } catch (error) {
            console.error('加载聊天室失败:', error);
            if (!append) {
                this.showError('加载聊天室失败，请刷新页面');
            }
        } finally {
            this.chatRoomsLoading = false;
        }
    }

    // 滚动到底部加载更多聊天室
    async loadMoreChatRooms() {
        if (this.chatRoomsLoading || !this.chatRoomsHasMore) return;
        await this.loadChatRooms(true);
    }

    // 侧边栏无限滚动：聊天 / 群组 / 通讯录
    setupSidebarInfiniteScroll() {
        const bind = (el, loader) => {
            if (!el || el._sidebarInfiniteBound) return;
            el._sidebarInfiniteBound = true;
            el.addEventListener('scroll', () => {
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
                    loader();
                }
            }, {passive: true});
        };
        bind(document.getElementById('chatList'), () => this.loadMoreChatRooms());
        bind(document.getElementById('groupsList'), () => this.loadMoreChatRooms());
        bind(document.getElementById('contactsList'), () => this.loadMoreUsers());
    }


    // 加载聊天历史（支持分页）
    async loadChatHistory(roomId, options = {}) {
        const {
            beforeId = null,      // 加载此消息之前的消息
            afterId = null,       // 加载此消息之后的消息
            append = false,       // 是否追加到现有消息（默认替换）
            page_size = 50       // 每页消息数
        } = options;

        if (!roomId) return false;
        // 切换聊天室时停止连续朗读
        if (!append && this._continuousTTS) this.stopContinuousTTS();
        // 🔧 「加载更多」防抖：同一聊天室上滚分页时避免重复请求；
        //    但切换聊天室（append=false）必须放行，否则会因上一个请求在途而整场加载失败
        if (append && this.isLoadingMore) return false;

        // 🔧 请求令牌：快速切换聊天室时，旧请求的响应将被丢弃，避免覆盖新房间的消息列表
        var reqRoomId = parseInt(roomId);
        var token = ++this._historyReqToken;
        var self = this;

        // 🔧 切换聊天室时主动中止上一条历史请求：避免快速切换时连接堆积、
        //    也避免浏览器把被丢弃的请求报成 net::ERR_SSL_PROTOCOL_ERROR 之类的网络错误
        if (!append && this._historyAbortController) {
            try { this._historyAbortController.abort(); } catch (ignore) {}
        }
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        if (!append) this._historyAbortController = controller;

        this.isLoadingMore = true; // 🔧 标记为加载中

        // 🔧 请求参数
        const params = new URLSearchParams({
            chat_room_id: roomId,
            page_size: page_size.toString()
        });
        if (beforeId) params.append('before_id', beforeId);
        if (afterId) params.append('after_id', afterId);
        const requestUrl = `/api/chat/messages/?${params.toString()}`;

        // 🔧 瞬时网络故障（连接被重置 / ERR_SSL_PROTOCOL_ERROR / 502 等）自动重试，
        //    避免偶发抖动直接把「加载历史消息失败」抛给用户
        const MAX_ATTEMPTS = 3;
        const isStale = function () {
            return token !== self._historyReqToken || self.currentRoomId !== reqRoomId;
        };
        const sleep = function (ms) {
            return new Promise(function (r) { setTimeout(r, ms); });
        };

        let response = null;
        let lastError = null;

        try {
            // 显示加载指示器（首次加载）
            if (this.isInitialLoad && !append) {
                this.showLoading();
            }

            for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    response = await fetch(requestUrl, {
                        headers: TokenManager.getHeaders(),
                        signal: controller ? controller.signal : undefined
                    });
                } catch (fetchError) {
                    lastError = fetchError;
                    // 主动中止 / 已被更新的请求取代 → 静默退出，不报错、不重试
                    if (this._isAbortError(fetchError) || isStale()) return false;
                    if (!this._isNetworkError(fetchError) || attempt >= MAX_ATTEMPTS) break;
                    console.warn('加载历史消息网络异常，' + (400 * attempt) + 'ms 后重试（第 ' + attempt + ' 次）：'
                        + (fetchError && fetchError.message));
                    await sleep(400 * attempt);
                    if (isStale()) return false;
                    continue;
                }

                // 5xx（网关超时/后端重启等）同样属于瞬时故障，重试一次
                if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
                    lastError = new Error('HTTP ' + response.status);
                    console.warn('加载历史消息返回 ' + response.status + '，' + (400 * attempt) + 'ms 后重试');
                    response = null;
                    await sleep(400 * attempt);
                    if (isStale()) return false;
                    continue;
                }
                lastError = null;
                break;
            }

            if (!response) {
                throw (lastError || new Error('加载聊天历史失败'));
            }

            this.statusCode = response.status;
            if (!response.ok) {
                throw new Error('加载聊天历史失败');
            }

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

            // 🔧 过期响应丢弃：请求发出后用户又切换了聊天室 / 触发了新请求，
            //    此时直接放弃本次结果，避免旧房间的消息覆盖当前房间
            if (token !== this._historyReqToken || this.currentRoomId !== reqRoomId) {
                console.log('丢弃过期的历史消息响应 roomId:', reqRoomId, ' token:', token, '/', this._historyReqToken);
                return;
            }

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
                console.log('标记新加载的消息为已读')
                this.markMessagesAsRead(roomId, reversedMessages);

            } else if (!append && newMessages.length > 0) {
                // 替换模式：清空并设置新消息
                // 注意：后端返回的是倒序（最新在前），需要反转
                this.messages = [...newMessages].reverse();
                this.isInitialLoad = false;

                // 🔧 关键修复：正确判断是否有更多消息
                if (data && data.count !== undefined) {
                    this.hasMoreMessages = this.messages.length < data.count;
                } else if (newMessages.length >= page_size) {
                    this.hasMoreMessages = true;
                } else {
                    this.hasMoreMessages = false;
                }

                // 🔧 关键修复5: 正确记录最早消息ID
                this.oldestMessageId = newMessages[newMessages.length - 1].id;

                // 标记消息为已读
                console.log('首次加载消息标记为已读')
                this.markMessagesAsRead(roomId);
            } else if (newMessages.length === 0) {
                // 🔧 关键修复6: 没有更多消息，停止加载
                this.hasMoreMessages = false;
                // return;
            }

            // console.log('加载聊天历史成功:', newMessages);
            console.log('append:', append);
            console.log('this.hasMoreMessages:', this.hasMoreMessages);


            // 渲染消息
            this.renderChatHistory(append);

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


        } catch (error) {
            // 主动中止 / 过期请求：静默处理，不打扰用户
            if (this._isAbortError(error) || token !== this._historyReqToken || this.currentRoomId !== reqRoomId) {
                console.log('忽略已中止/过期的历史消息请求 roomId:', reqRoomId);
                return false;
            }
            console.error('加载聊天历史失败:', error);
            if (this.statusCode === 401) {
                this.handleAuthError();
            }
            // 重试后仍失败：给出可重试的提示，并在消息区放一个「点击重试」，而不是只剩空白
            this.showError('消息加载失败，请点击重试');
            if (!append) {
                this._renderHistoryLoadFailed(reqRoomId);
            }
            try {
                await this.checkLoginStatus();
            } catch (ignore) {
                // checkLoginStatus 自身失败不影响主流程
            }
            return false;
        } finally {
            // 🔧 仅最新请求才恢复状态 / 隐藏 loading / 滚动，避免过期请求干扰当前房间
            if (token === this._historyReqToken) {
                this.isLoadingMore = false; // 🔧 恢复加载状态
                this.hideLoading();
                // 首次加载滚动到底部（加载失败时不滚动，保留重试提示）
                if (!append && this._historyLoadFailedToken !== token) {
                    Utils.scrollToBottom(document.getElementById('messagesList'));
                }
            }
            if (this.statusCode === 401) {
                this.handleAuthError();
            }
        }
    }

    // 判断是否为「主动中止」错误（AbortController 引发，属正常流程，不应提示用户）
    _isAbortError(error) {
        if (!error) return false;
        if (error.name === 'AbortError') return true;
        return /aborted|AbortError/i.test(String(error.message || ''));
    }

    // 判断是否为「网络/传输层」失败（如 Failed to fetch、ERR_SSL_PROTOCOL_ERROR、连接被重置）
    _isNetworkError(error) {
        if (!error || this._isAbortError(error)) return false;
        if (typeof TypeError !== 'undefined' && error instanceof TypeError) return true;
        return /failed to fetch|networkerror|network error|load failed|err_ssl|err_connection|err_network|err_http2/i
            .test(String(error.message || ''));
    }

    // 消息加载失败时的内联重试提示（避免只剩空白列表）
    _renderHistoryLoadFailed(roomId) {
        var messagesList = document.getElementById('messagesList');
        if (!messagesList) return;
        this._historyLoadFailedToken = this._historyReqToken;
        messagesList.innerHTML = ''
            + '<div class="history-load-failed" id="historyLoadFailed">'
            + '  <i class="fas fa-exclamation-circle"></i>'
            + '  <p>消息加载失败，可能是网络波动</p>'
            + '  <button type="button" class="btn btn-primary" '
            + '    onclick="chatClient.retryLoadChatHistory(' + roomId + ')">重新加载</button>'
            + '</div>';
    }

    // 手动重试加载聊天历史
    retryLoadChatHistory(roomId) {
        roomId = parseInt(roomId || this.currentRoomId);
        if (!roomId) return;
        var box = document.getElementById('historyLoadFailed');
        if (box) box.remove();
        this.isInitialLoad = true;
        this.loadChatHistory(roomId, { page_size: 50, append: false });
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
            // 提前 120px 触发，避免用户真的滚到顶部才出现“加载中”的空档
            if (messagesList.scrollTop < 120 &&
                !this.isLoadingMore &&
                !this._historyAnchorRestoring &&
                this.hasMoreMessages &&
                this.currentRoomId) {

                this.loadMoreHistory();
            }
        };

        // 添加滚动监听
        messagesList.addEventListener('scroll', this.infiniteScrollHandler);
    }


    setupVideoMessageListerners() {

        document.querySelectorAll('.video-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const videoEl = btn.parentElement.querySelector('video');
                if (videoEl.paused) {
                    videoEl.play();
                    btn.classList.add('playing');
                    btn.innerHTML = '<i class="fas fa-pause"></i>';

                } else {
                    videoEl.pause();
                    btn.classList.remove('playing');
                    btn.innerHTML = '<i class="fas fa-play"></i>';

                }
            });
        });
    }


    // 通过消息ID跳转到目标消息位置（支持平滑滚动和高亮闪烁）
    async jumpToMessage(messageId) {
        try {
            // 显示加载状态
            this.showLoading(true);
            const messagesList = document.getElementById('messagesList');
            if (!messagesList) return;

            // 1. 尝试查找当前已渲染的消息元素
            let messageElement = document.querySelector(`.message-wrapper[data-message-id="${messageId}"]`);

            // 2. 如果未找到，且还有更多历史消息，尝试加载更早的消息
            // 注意：这里简单尝试加载一次，实际场景中可能需要循环加载直到找到或无更多消息
            if (!messageElement && this.hasMoreMessages && this.currentRoomId) {
                console.log(`消息 ${messageId} 未在视图中，尝试加载更多历史消息...`);

                // 记录加载前的最旧消息ID，用于判断是否加载了新内容
                const oldOldestId = this.oldestMessageId;

                // 加载更早的消息
                await this.loadChatHistory(this.currentRoomId, {
                    beforeId: this.oldestMessageId,
                    append: true,
                    page_size: 50
                });

                // 再次尝试查找
                messageElement = document.querySelector(`.message-wrapper[data-message-id="${messageId}"]`);
            }

            // 3. 如果仍然找不到，提示用户或退出
            if (!messageElement) {
                console.warn(`未找到消息ID: ${messageId}`);
                // 可选：显示 Toast 提示 "消息可能已被删除或过于久远"
                this.showError('消息可能已被删除或过于久远');
                return;
            }
            console.log('找到消息ID: ', messageId)


            // 等待 DOM 渲染完成后再次尝试跳转
            const tryScroll = () => {
                const el = document.querySelector(`.message-wrapper[data-message-id="${messageId}"]`);
                if (el) {
                    // 4. 执行平滑滚动
                    // 使用 scrollIntoView 比直接设置 scrollTop 更可靠，尤其是处理边界情况时
                    el.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center', // 将消息滚动到视图中间
                        inline: 'nearest'
                    });
                    // 5. 添加高亮闪烁效果，帮助用户定位
                    this.highlightMessage(el);
                } else {
                    // 如果还没渲染完成，继续等待
                    requestAnimationFrame(tryScroll);
                }
            };
            requestAnimationFrame(tryScroll);


        } catch (error) {
            console.error('跳转消息失败:', error);
            this.showError('跳转消息失败');
        } finally {
            this.hideLoading();
        }
    }


    // 高亮闪烁消息元素
    highlightMessage(element) {
        if (!element) return;

        // 添加高亮类
        element.classList.add('message-highlighted');

        // 移除之前的定时器（防止快速连续调用导致样式错乱）
        if (this.highlightTimeout) {
            clearTimeout(this.highlightTimeout);
        }

        // 2秒后移除高亮
        this.highlightTimeout = setTimeout(() => {
            element.classList.remove('message-highlighted');
        }, 2000);
    }


    // 记录当前视口内第一条消息及它在容器中的相对位置（用于加载后精确还原）
    _captureMessageAnchor() {
        const list = document.getElementById('messagesList');
        if (!list) return null;
        const listRect = list.getBoundingClientRect();
        const items = list.querySelectorAll('.message-wrapper[data-message-id]');
        let anchor = null;
        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (r.bottom > listRect.top + 1) { anchor = items[i]; break; }
        }
        if (!anchor) {
            return {scrollTop: list.scrollTop, scrollHeight: list.scrollHeight};
        }
        return {
            id: anchor.getAttribute('data-message-id'),
            offsetTop: anchor.getBoundingClientRect().top - listRect.top,
            scrollTop: list.scrollTop,
            scrollHeight: list.scrollHeight
        };
    }

    // 历史消息插入后，让原先查看的消息停留在原来的屏幕位置
    _restoreMessageAnchor(anchor) {
        if (!anchor) return;
        const list = document.getElementById('messagesList');
        if (!list) return;
        const apply = () => {
            if (!list.isConnected) return;
            if (anchor.id) {
                const el = list.querySelector(`.message-wrapper[data-message-id="${anchor.id}"]`);
                if (el) {
                    const delta = (el.getBoundingClientRect().top - list.getBoundingClientRect().top) - anchor.offsetTop;
                    if (Math.abs(delta) > 0.5) list.scrollTop += delta;
                    return;
                }
            }
            const deltaH = list.scrollHeight - (anchor.scrollHeight || 0);
            if (deltaH) list.scrollTop = (anchor.scrollTop || 0) + deltaH;
        };
        apply();
        requestAnimationFrame(apply);
        setTimeout(apply, 80);
        setTimeout(apply, 240);
        // 图片/字体异步加载会改变上方高度，短暂监听尺寸变化继续校正锚点
        if (typeof ResizeObserver !== 'undefined') {
            try {
                const ro = new ResizeObserver(apply);
                ro.observe(list);
                setTimeout(() => ro.disconnect(), 800);
            } catch (e) { /* ignore */ }
        }
    }

    // 加载更多历史消息
    async loadMoreHistory() {
        if (this.isLoadingMore || !this.hasMoreMessages || !this.currentRoomId || !this.oldestMessageId) return;

        // 加载前记录锚点：用户当前看到的第一条消息
        const anchor = this._captureMessageAnchor();
        const beforeCount = this.messages.length;
        // 还原期间暂停滚动触发的自动分页，避免刚渲染完 scrollTop=0 时再次误触发
        this._historyAnchorRestoring = true;

        // 悬浮加载提示：不插入消息列表，避免加载期间把可视内容向下挤动
        const loader = document.createElement('div');
        loader.className = 'history-top-loading';
        loader.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在加载更早的消息...';
        const host = document.getElementById('messagesContainer');
        if (host) host.appendChild(loader);

        try {
            await this.loadChatHistory(this.currentRoomId, {
                beforeId: this.oldestMessageId,
                append: true,
                page_size: 50
            });
        } catch (error) {
            console.error('加载更多历史消息失败:', error);
            this.showError('加载更多消息失败');
        } finally {
            if (loader.parentNode) loader.remove();
            // 新加载的消息做一次淡入，提示“更早消息已就位”
            const added = this.messages.length - beforeCount;
            if (added > 0) {
                const ids = this.messages.slice(0, added).map(m => String(m.id));
                ids.forEach(id => {
                    const el = document.querySelector(`.message-wrapper[data-message-id="${id}"]`);
                    if (el) el.classList.add('msg-append-in');
                });
                setTimeout(() => {
                    document.querySelectorAll('.msg-append-in').forEach(el => el.classList.remove('msg-append-in'));
                }, 420);
            }
            // 用锚点精确还原，避免新消息插入后画面跳到顶部
            this._restoreMessageAnchor(anchor);
            setTimeout(() => { this._historyAnchorRestoring = false; }, 300);
        }
    }


    // 初始化直达底部按钮
    // 🔧 动态把「回到底部」按钮放在输入区上方，始终与输入区保持 12px 间距，避免被遮挡
    _positionScrollToBottomBtn() {
        const container = document.getElementById('scrollToBottomContainer');
        if (!container) return;
        const inputArea = document.querySelector('.chat-input-area');
        if (!inputArea) return;
        const inputTop = inputArea.getBoundingClientRect().top;
        const offset = Math.max(12, window.innerHeight - inputTop + 12);
        container.style.bottom = offset + 'px';
    }

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
            // 每次显示状态变化时重新定位（输入区高度可能因输入/表情面板变化）
            this._positionScrollToBottomBtn();

            const scrollTop = messagesList.scrollTop;
            const scrollHeight = messagesList.scrollHeight;
            const clientHeight = messagesList.clientHeight;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            const isScrollingUp = scrollTop < lastScrollTop;

            // 仅当向上滚动且距离底部超过150px时显示按钮
            // const shouldShowButton = isScrollingUp && distanceFromBottom > 150;
            const shouldShowButton = distanceFromBottom > 150;

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
                console.log('滚动到底部标记所有消息为已读');
                this.markMessagesAsRead(this.currentRoomId);
            }
        });

        // 窗口尺寸变化 / 输入框高度变化（多行输入/表情面板）时重新定位，避免按钮被输入区遮挡
        window.addEventListener('resize', () => this._positionScrollToBottomBtn());
        const msgInput = document.getElementById('messageInput');
        if (msgInput) {
            msgInput.addEventListener('input', () => this._positionScrollToBottomBtn());
        }

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
            this.unreadCountBadge.style.display = 'block';
            this.unreadCountBadge.classList.add('show');
        } else {
            this.unreadCountBadge.style.display = 'none';
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


    // 优化清除缓存方法（使用版本管理器）
    clearStaticCache() {
        return new Promise((resolve) => {
            this.showConfirmDialog(
                '清除缓存',
                '确定要清除所有缓存并重新加载最新资源吗？<br><small style="color: var(--text-light);">这将刷新页面并强制加载最新版本</small>',
                'confirm'
            ).then((confirmed) => {
                if (!confirmed) {
                    resolve(false);
                    return;
                }

                this.showLoading();

                try {
                    // 使用版本管理器执行更新
                    versionManager.performUpdate({
                        forceUpdate: true,
                        updateMessage: '手动清除缓存并更新'
                    });

                    resolve(true);
                } catch (error) {
                    console.error('清除缓存失败:', error);
                    this.hideLoading();
                    this.showError('清除失败: ' + (error.message || '未知错误'));
                    resolve(false);
                }
            });
        });
    }


    // 初始化版本管理
    async initVersionManagement() {
        console.log('🔍 启动版本管理系统...');

        // 页面加载时恢复滚动位置
        versionManager.restoreScrollPosition();

        // 🔧 修复：首次检查前先保存当前版本（防止无限循环）
        const currentStaticVersion = localStorage.getItem('static_version');
        const injectedVersion = document.querySelector('script[data-version]')?.dataset.version ||
            (typeof CURRENT_VERSION !== 'undefined' ? CURRENT_VERSION : null);

        if (injectedVersion && (!currentStaticVersion || currentStaticVersion !== injectedVersion)) {
            console.log('💾 保存注入的版本到 localStorage:', injectedVersion);
            localStorage.setItem('static_version', injectedVersion);
        }

        // 首次检查版本（立即执行）
        try {
            const updateInfo = await versionManager.checkForUpdates(true);
            if (updateInfo && updateInfo.hasUpdate) {
                console.log('✅ 检测到新版本，显示更新提示:', updateInfo);
                versionManager.showUpdatePrompt(updateInfo);
            } else {
                console.log('✅ 当前已是最新版本');
            }
        } catch (error) {
            console.error('❌ 首次版本检查失败:', error);
        }

        // 设置定期检查（每 10 分钟；页面在后台时跳过，回到前台后的首次检查仍会执行）
        console.log('⏱️ 设置定期版本检查（每10分钟）');
        setInterval(async () => {
            if (document.hidden) return;
            try {
                const updateInfo = await versionManager.checkForUpdates();
                if (updateInfo && updateInfo.hasUpdate) {
                    console.log('✅ 定期检查检测到新版本:', updateInfo);
                    versionManager.showUpdatePrompt(updateInfo);
                }
            } catch (error) {
                console.warn('⚠️ 定期版本检查失败:', error);
            }
        }, versionManager.CHECK_INTERVAL);

        // 监听在线状态变化
        window.addEventListener('online', async () => {
            console.log('🌐 网络恢复，检查版本更新...');
            const updateInfo = await versionManager.checkForUpdates(true);
            if (updateInfo && updateInfo.hasUpdate) {
                versionManager.showUpdatePrompt(updateInfo);
            }
        });
    }


    // ==================== 侧边栏管理 ====================
    setupSidebar() {

        // 修复：添加返回按钮事件监听
        const backBtn = document.getElementById('backBtn');

        const closeBtn = document.getElementById('sidebarCloseBtn');
        const overlay = document.getElementById('sidebarOverlay');

        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault();
                // this.handleBackButtonClick();
                this.toggleSidebar()
            });
        }

        // 关闭
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeSidebar());
        }

        // 遮罩层
        if (overlay) {
            overlay.addEventListener('click', () => this.closeSidebar());
        }

        // 消息容器点击（移动端隐藏侧边栏）
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
            messagesContainer.addEventListener('click', (e) => {
                // 仅在移动端且侧边栏显示时隐藏，不影响链接点击
                if (window.innerWidth <= 768 && this.isShowingSidebar) {
                    e.preventDefault();
                    this.closeSidebar();
                }
            });
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

            // 在 setupEventListeners 方法中，确认粘贴事件绑定无误
            messageInput.addEventListener('paste', (e) => this.handlePaste(e));

        }


        // ==================== 输入区域优化逻辑 ====================

        // 1. ➕ 按钮展开/收起功能
        const togglePlusBtn = document.getElementById('togglePlusBtn');
        const extraActions = document.getElementById('extraActions');

        if (togglePlusBtn && extraActions) {
            togglePlusBtn.addEventListener('click', () => {
                const isShow = extraActions.classList.toggle('show');
                togglePlusBtn.classList.toggle('active', isShow);

                // 切换图标：+ 变 ×
                const icon = togglePlusBtn.querySelector('i');
                if (icon) icon.className = isShow ? 'fas fa-times' : 'fas fa-plus';
            });

            // 点击输入框外部自动收起（提升体验）
            document.addEventListener('click', (e) => {
                if (!extraActions.contains(e.target) &&
                    !togglePlusBtn.contains(e.target) &&
                    extraActions.classList.contains('show')) {
                    extraActions.classList.remove('show');
                    togglePlusBtn.classList.remove('active');
                    const icon = togglePlusBtn.querySelector('i');
                    if (icon) icon.className = 'fas fa-plus';
                }
            });
        }

        // 2. 输入框内容变化控制发送按钮状态
        // const messageInput = document.getElementById('messageInput');
        // const sendBtn = document.getElementById('sendBtn');

        if (messageInput && sendBtn) {
            // 复用您原有的 adjustTextareaHeight，此处增强禁用/启用逻辑
            messageInput.addEventListener('input', () => {
                this.adjustTextareaHeight(messageInput);
                // 有内容时启用发送按钮
                sendBtn.disabled = !messageInput.value.trim();
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
            headerButtons[0].onclick = (e) => {
                e.preventDefault();
                this.makeVoiceCall();
            };
            headerButtons[1].onclick = (e) => {
                e.preventDefault();
                this.makeVideoCall();
            };
            headerButtons[2].onclick = (e) => {
                e.preventDefault();
                this.showChatActions();
            };
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

        // 截图按钮
        const screenshotBtn = document.getElementById('screenshotBtn');
        if (screenshotBtn) {
            screenshotBtn.addEventListener('click', () => this.captureScreenshot());
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

        // 拖拽文件/图片到聊天区域直接发送
        this.setupDragDropUpload();


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


        // // 语音按钮事件（简化版，实际项目可能需要录音功能）
        // const voiceBtn = document.getElementById('voiceBtn');
        // if (voiceBtn) {
        //     voiceBtn.addEventListener('click', (e) => {
        //         e.preventDefault();
        //         this.showSuccess('语音消息功能将在后续版本中实现');
        //     });
        // }


        // 搜索聊天
        const chatSearch = document.getElementById('chatSearch');
        if (chatSearch) {
            chatSearch.addEventListener('input', Utils.debounce((e) => {
                this.filterChatRooms(e.target.value);
            }, 300));
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
                const orgPanel = document.getElementById('orgSidebarPanel');

                if (chatList) chatList.classList.add('hidden');
                if (contactsList) contactsList.classList.add('hidden');
                if (groupsList) groupsList.classList.add('hidden');
                if (orgPanel) orgPanel.classList.add('hidden');

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


        // 🔑 绑定修改密码提交事件
        const submitPwdBtn = document.getElementById('submitChangePasswordBtn');
        if (submitPwdBtn) {
            submitPwdBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.submitChangePassword();
            });
        }

        // 回车键提交支持
        const pwdForm = document.getElementById('changePasswordForm');
        if (pwdForm) {
            pwdForm.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.submitChangePassword();
                }
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

        // 🔧 通话控制事件（调用独立方法）
        this.setupCallControls();  // ✅ 调用独立方法

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

        // 🔧 修复移动端（尤其安卓）软键盘弹出遮挡输入框：用 visualViewport 实时把输入区顶到键盘上方
        this.setupKeyboardReposition();
    }

    // 修复移动端软键盘遮挡输入框：安卓默认键盘是"覆盖"在布局视口上，
    // 输入框 position:fixed;bottom:0 会藏在键盘后面。用 visualViewport 计算可见区域，
    // 把输入区 bottom 动态设置为键盘占用高度，保证输入框始终在键盘上方可见。
    setupKeyboardReposition() {
        const vv = window.visualViewport;
        const inputArea = document.querySelector('.chat-input-area');
        const messageInput = document.getElementById('messageInput');
        if (!vv || !inputArea) return;

        const reposition = () => {
            // 键盘弹出时 visualViewport 高度 < 布局视口高度，差值即键盘占用高度
            const keyboardH = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
            if (keyboardH > 1) {
                inputArea.style.setProperty('bottom', keyboardH + 'px', 'important');
                // 键盘弹出后确保输入框在可视区域内（部分机型需延迟滚动）
                if (messageInput && document.activeElement === messageInput) {
                    clearTimeout(this._kbScrollTimer);
                    this._kbScrollTimer = setTimeout(() => {
                        messageInput.scrollIntoView({behavior: 'smooth', block: 'nearest'});
                    }, 120);
                }
            } else {
                inputArea.style.setProperty('bottom', '0px', 'important');
            }
        };

        vv.addEventListener('resize', reposition);
        vv.addEventListener('scroll', reposition);
        window.addEventListener('orientationchange', () => setTimeout(reposition, 300));
        // 输入框聚焦时主动执行一次（部分机型 visualViewport resize 事件不触发）
        if (messageInput) {
            messageInput.addEventListener('focus', () => setTimeout(reposition, 200));
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


        modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-user-cog"></i> 个人资料设置</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                ${window.tenantManager && tenantManager.activeTenant ? '<div style="margin-bottom:16px;padding:12px 16px;background:#f0f9eb;border-radius:8px;font-size:13px;display:flex;align-items:center;gap:8px;color:#67c23a;"><i class="fas fa-building"></i> 当前企业：<strong>' + chatClient._escape(tenantManager.activeTenant.short_name || tenantManager.activeTenant.name) + '</strong></div>' : ''}

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
                            <label>所属企业</label>
                            <span id="settingsTenantDisplay" style="line-height:36px;color:var(--primary-color,#409eff);font-weight:500;">-</span>
                        </div>
                        <div class="profile-info-item">
                            <label>部门</label>
                            <div id="settingsDeptDisplay" style="line-height:1.8;"></div>
                        </div>
                        <div class="profile-info-item">
                            <label>职位</label>
                            <input type="text" id="settingsPosition" placeholder="请输入职位">
                        </div>
                        <div class="profile-info-item">
                            <label>直属主管</label>
                            <span id="settingsSupervisorDisplay" style="line-height:36px;">-</span>
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

        // 🔧 通知设置即时生效：切换开关立即应用（无需先点保存）
        this._bindNotificationToggles();
    }

    // 绑定通知设置的即时生效逻辑
    _bindNotificationToggles() {
        var self = this;
        var desktop = document.getElementById('desktopNotifications');
        if (desktop) {
            desktop.addEventListener('change', function () {
                // 先落盘再应用，保证刷新/其他逻辑读到的是最新值
                try { localStorage.setItem('desktopNotifications', desktop.checked ? 'true' : 'false'); } catch (ignore) {}
                self._applyDesktopNotificationSetting(desktop.checked);
            });
        }
        var sound = document.getElementById('soundNotifications');
        if (sound) {
            sound.addEventListener('change', function () {
                try { localStorage.setItem('soundNotifications', sound.checked ? 'true' : 'false'); } catch (ignore) {}
                if (sound.checked) self.playNotificationSound();
            });
        }
        var vibrate = document.getElementById('vibrateNotifications');
        if (vibrate) {
            vibrate.addEventListener('change', function () {
                try { localStorage.setItem('vibrateNotifications', vibrate.checked ? 'true' : 'false'); } catch (ignore) {}
                if (vibrate.checked) self.vibrateOnNewMessage();
            });
        }
    }

    // 应用「桌面通知」开关：开启时申请权限并订阅 Web Push，关闭时退订
    _applyDesktopNotificationSetting(enabled) {
        var self = this;
        if (enabled) {
            if (!('Notification' in window)) {
                this.showError('当前浏览器不支持桌面通知');
                return;
            }
            if (Notification.permission === 'granted') {
                this.ensurePushSubscribed();
            } else if (Notification.permission === 'default') {
                Notification.requestPermission().then(function (permission) {
                    if (permission === 'granted') {
                        self.ensurePushSubscribed();
                    } else if (permission === 'denied') {
                        self.showNotificationPermissionHint();
                    }
                });
            } else {
                // 已被用户或浏览器拒绝，给出引导提示
                this.showNotificationPermissionHint();
            }
        } else if (window.PushNotifier && window.PushNotifier.supported()) {
            window.PushNotifier.unsubscribe();
        }
    }

    populateSettingsForm() {
        if (!this.currentUser) return;

        // 基本信息
        document.getElementById('settingsUsernameDisplay').textContent = this.currentUser.username || '';
        document.getElementById('settingsRealName').value = this.currentUser.real_name || '';
        document.getElementById('settingsEmail').value = this.currentUser.email || '';
        document.getElementById('settingsPhone').value = this.currentUser.phone || '';
        document.getElementById('settingsGender').value = this.currentUser.gender || '';
        var sp = document.getElementById('settingsPosition');
        if (sp) sp.value = this.currentUser.position || '';

        // 头像
        const avatarImg = document.getElementById('settingsAvatar');
        if (avatarImg) {
            avatarImg.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        }

        // 加载组织架构信息
        this._loadSettingsOrgInfo();

        // 恢复通知设置
        const desktopNotifications = localStorage.getItem('desktopNotifications') !== 'false';
        const soundNotifications = localStorage.getItem('soundNotifications') !== 'false';
        const vibrateNotifications = localStorage.getItem('vibrateNotifications') !== 'false';
        document.getElementById('desktopNotifications').checked = desktopNotifications;
        document.getElementById('soundNotifications').checked = soundNotifications;
        document.getElementById('vibrateNotifications').checked = vibrateNotifications;

        console.log('==> 恢复通知设置：', desktopNotifications, soundNotifications, vibrateNotifications, typeof desktopNotifications);
    }

    async _loadSettingsOrgInfo() {
        try {
            // 企业信息
            var tenantEl = document.getElementById('settingsTenantDisplay');
            if (tenantEl && window.tenantManager && tenantManager.activeTenant) {
                var t = tenantManager.activeTenant;
                var roleMap = {
                    'owner': '企业所有者',
                    'admin': '企业管理员',
                    'dept_admin': '部门管理员',
                    'member': '成员'
                };
                tenantEl.textContent = (t.short_name || t.name) + ' · ' + (roleMap[t.role] || '成员');
            }

            // 从 /api/auth/me/ 获取 supervisor / org_departments
            var resp = await fetch('/api/auth/me/', {headers: TokenManager.getHeaders()});
            if (resp.ok) {
                var me = await resp.json();
                // 部门（逐级链式显示，多部门分行）
                var deptEl = document.getElementById('settingsDeptDisplay');
                if (deptEl) {
                    if (me.org_departments && me.org_departments.length) {
                        deptEl.innerHTML = me.org_departments.map(function (d) {
                            return '<div style="padding:2px 0;"><i class="fas fa-sitemap" style="color:#e6a23c;font-size:11px;margin-right:4px;"></i>' + chatClient._escape(d.full_path || d.name) + '</div>';
                        }).join('');
                    } else {
                        deptEl.innerHTML = '<span>' + chatClient._escape((me.department_info && me.department_info.name) || '-') + '</span>';
                    }
                }
                // 直属主管
                var supEl = document.getElementById('settingsSupervisorDisplay');
                if (supEl) {
                    if (me.supervisor) {
                        supEl.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;">'
                            + (me.supervisor.avatar ? '<img src="' + chatClient._escape(me.supervisor.avatar) + '" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">' : '')
                            + '<span>' + chatClient._escape(me.supervisor.real_name || me.supervisor.username) + '</span>'
                            + (me.supervisor.position ? '<span style="color:var(--text-light,#909399);font-size:12px;">(' + chatClient._escape(me.supervisor.position) + ')</span>' : '')
                            + '</span>';
                    } else {
                        supEl.textContent = '-';
                    }
                }
            }
        } catch (e) {
            console.error('加载组织信息失败:', e);
        }
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


    // 收集当前房间所有图片消息的 URL 列表
    _collectImageList() {
        const images = [];
        if (!this.messages || !Array.isArray(this.messages)) return images;
        for (const msg of this.messages) {
            if (!msg.is_deleted && msg.file_info?.url && (msg.message_type === 'image' || msg.file_info?.mime_type?.startsWith('image/'))) {
                images.push({url: msg.file_info.url, name: msg.file_info.name || '图片'});
            }
        }
        return images;
    }

    // 预览图片（大图查看，左右箭头导航）
    previewImage(imageUrl) {
        if (!imageUrl) return;
        var list = this._collectImageList();
        if (!list.length) return;
        // 兼容相对/绝对 URL（imageEl.src 是绝对地址，file_info.url 可能是相对地址）
        var idx = list.findIndex(function (i) {
            try {
                return new URL(i.url, window.location.origin).href === new URL(imageUrl, window.location.origin).href;
            } catch (e) {
                return i.url === imageUrl;
            }
        });
        if (idx < 0) idx = 0;
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var pd = list.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="chatClient._chatPreviewClose()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="chatClient._chatPreviewDir(-1)" id="chatPrev" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + pd + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="chatClient._chatPreviewDir(1)" id="chatNext" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + pd + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="chatMainImg" src="' + list[idx].url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);transition:opacity 0.15s;">'
            + '<div id="chatPageCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (idx + 1) + ' / ' + list.length + '</div>';
        document.body.appendChild(overlay);
        this._chatPreviewList = list;
        this._chatPreviewIdx = idx;
        this._chatOverlay = overlay;
        if (idx <= 0) {
            var p = document.getElementById('chatPrev');
            if (p) p.style.opacity = '0.2';
        }
        if (idx >= list.length - 1) {
            var n = document.getElementById('chatNext');
            if (n) n.style.opacity = '0.2';
        }
        var self = this;
        var kh = function (e) {
            if (e.key === 'ArrowLeft') {
                self._chatPreviewDir(-1);
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                self._chatPreviewDir(1);
                e.preventDefault();
            } else if (e.key === 'Escape') {
                self._chatPreviewClose();
                e.preventDefault();
            }
        };
        this._chatKeyHandler = kh;
        document.addEventListener('keydown', kh);

        // 🔧 触摸滑动：左右滑动切换图片（移动端）；双指捏合由 Utils.enableImagePinchZoom 处理
        var touchStartX = null, touchStartY = null, swiped = false;
        overlay.addEventListener('touchstart', function (e) {
            if (e.touches.length >= 2) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            swiped = false;
        }, {passive: true});
        overlay.addEventListener('touchmove', function (e) {
            if (e.touches.length >= 2) return;
            if (touchStartX !== null) {
                var dx = e.touches[0].clientX - touchStartX;
                var dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 30 || Math.abs(dy) > 30) swiped = true;
            }
        }, {passive: true});
        overlay.addEventListener('touchend', function (e) {
            if (e.changedTouches && e.changedTouches.length >= 2) { touchStartX = null; return; }
            if (touchStartX !== null) {
                var endX = e.changedTouches[0].clientX;
                var endY = e.changedTouches[0].clientY;
                var dx = endX - touchStartX, dy = endY - touchStartY;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    self._chatPreviewDir(dx < 0 ? 1 : -1);  // 左滑下一张，右滑上一张
                }
            }
            touchStartX = null;
        }, {passive: true});

        // 🔧 点击图片切换预览模式（再点一次退出）；点击背景也退出
        overlay.addEventListener('click', function (e) {
            if (swiped) {
                swiped = false;
                return;
            }  // 刚滑动过，忽略本次点击
            if (e.target === overlay) self._chatPreviewClose();
        });
        var mainImg = document.getElementById('chatMainImg');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function (e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                if (swiped) {
                    swiped = false;
                    return;
                }
                self._chatPreviewClose();
            });
        }
    }

    _chatPreviewDir(dir) {
        if (!this._chatPreviewList || !this._chatPreviewList.length) return;
        var len = this._chatPreviewList.length;
        if (dir < 0 && this._chatPreviewIdx <= 0) {
            this._chatShowTip('已是第一张');
            return;
        }
        if (dir > 0 && this._chatPreviewIdx >= len - 1) {
            this._chatShowTip('已是最后一张');
            return;
        }
        this._chatPreviewIdx += dir;
        var img = document.getElementById('chatMainImg');
        var item = this._chatPreviewList[this._chatPreviewIdx];
        if (img) {
            img.style.opacity = '0';
            var self = this;
            setTimeout(function () {
                img.src = item.url;
                Utils.resetImageZoom(img);
                img.style.opacity = '1';
            }, 100);
        }
        var ct = document.getElementById('chatPageCounter');
        if (ct) ct.textContent = (this._chatPreviewIdx + 1) + ' / ' + this._chatPreviewList.length;
        var p = document.getElementById('chatPrev');
        var n = document.getElementById('chatNext');
        if (p) {
            p.style.opacity = this._chatPreviewIdx <= 0 ? '0.2' : '1';
            p.style.cursor = this._chatPreviewIdx <= 0 ? 'default' : 'pointer';
        }
        if (n) {
            n.style.opacity = this._chatPreviewIdx >= this._chatPreviewList.length - 1 ? '0.2' : '1';
            n.style.cursor = this._chatPreviewIdx >= this._chatPreviewList.length - 1 ? 'default' : 'pointer';
        }
    }

    _chatPreviewClose() {
        if (this._chatKeyHandler) {
            document.removeEventListener('keydown', this._chatKeyHandler);
            this._chatKeyHandler = null;
        }
        if (this._chatOverlay) {
            this._chatOverlay.remove();
            this._chatOverlay = null;
        }
        this._chatPreviewList = null;
    }

    _chatShowTip(msg) {
        var tip = document.getElementById('chatImgTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'chatImgTip';
            tip.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);z-index:10002;color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:20px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.opacity = '1';
        clearTimeout(tip._t);
        tip._t = setTimeout(function () {
            tip.style.opacity = '0';
        }, 1500);
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
            const position = document.getElementById('settingsPosition') ? document.getElementById('settingsPosition').value : '';
            const avatarInput = document.getElementById('avatarUpload');

            // 保存通知设置
            const desktopNotifications = document.getElementById('desktopNotifications').checked;
            const soundNotifications = document.getElementById('soundNotifications').checked;
            const vibrateNotifications = document.getElementById('vibrateNotifications').checked;
            localStorage.setItem('desktopNotifications', desktopNotifications.toString());
            localStorage.setItem('soundNotifications', soundNotifications.toString());
            localStorage.setItem('vibrateNotifications', vibrateNotifications.toString());
            console.log('保存通知设置: ', desktopNotifications, soundNotifications, vibrateNotifications);

            // 🔧 保存时同步应用桌面通知设置（申请权限 / 订阅或退订 Web Push），确保及时生效
            this._applyDesktopNotificationSetting(desktopNotifications);


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
            if (position && position !== (this.currentUser.position || '')) updateData.position = position;

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
                    console.log('没有更新内容');
                    // 没有更新内容
                    this.closeModal('settingsModal');
                    this.showSuccess('设置保存成功');
                    return;
                }
            }

            console.log('response:', response)

            if (response.ok) {
                const updatedUser = await response.json();
                this.currentUser = updatedUser;
                this.renderCurrentUser();

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
    async showChatActions() {
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

        // 添加群聊管理选项（群待办入口按管理控制台权限配置展示）
        if (room.room_type === 'group') {
            let woPerm = null;
            if (typeof this.checkWorkOrderCreatePerm === 'function') {
                woPerm = await this.checkWorkOrderCreatePerm(room.id);
            }
            if (!woPerm || woPerm.allowed !== false) {
                menuHtml += `<div class="action-item" onclick="chatClient.openCreateWorkOrderModal()"><i class="fas fa-clipboard-list"></i> 新建群待办</div>`;
            }
            menuHtml += `<div class="action-item" onclick="event.stopPropagation();window.location.href='/tasks/?flag=work-orders'"><i class="fas fa-tasks"></i> 任务中心（群工单）</div>`;
        }
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
    async sendFile(file, targetRoomId = null) {
        if (!file) return;

        // 🔧 关键修复 1: 使用传入的 roomId 或当前的 currentRoomId
        const roomId = parseInt(targetRoomId || this.currentRoomId)

        if (!roomId) {
            this.showError('请先选择一个聊天对象');
            return;
        }

        console.log('发送文件到聊天室:', roomId);

        // 验证文件类型
        if (!Utils.isValidFileType(file)) {
            console.log('不支持的文件类型 type: ', file.type);
            this.showError('不支持的文件类型');
            return;
        }
        console.log('文件类型: ', file.type);

        // 🔧 关键修复：使用实例变量验证文件大小
        const maxSizeBytes = this.fileMaxSizeMB * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            console.log(`文件大小不能超过${this.fileMaxSizeMB}MB, size: `, parseInt(file.size / 1024 / 1024));
            this.showError(`文件大小不能超过${this.fileMaxSizeMB}MB`);
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
                chat_room: parseInt(roomId),  // 🔧 使用保存的 roomId
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
                chat_room: parseInt(roomId),  // 🔧 使用保存的 roomId
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


            // 替换上传中消息为最终消息（仍在本地，等待后端确认）
            const tempIndex = this.messages.findIndex(msg => msg.temp_id === tempMessageId);
            if (tempIndex !== -1) {
                this.messages[tempIndex] = finalMessage;
                // 重新渲染该消息
                this.renderChatHistory();
            }


            // 🔧 关键修复 3: 通过 WebSocket 发送文件消息（携带 temp_id 和正确的 roomId）
            //    仅当 socket 属于目标聊天室时才直发，否则走队列，杜绝发到别的聊天室
            if (this.ws && this.ws.readyState === WebSocket.OPEN &&
                parseInt(this.ws._roomId) === parseInt(roomId)) {
                const wsMessage = {
                    type: 'chat_message',
                    content: content,
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    message_type: message_type,
                    file_info: finalMessage.file_info,
                    temp_id: tempMessageId,
                    chat_room: parseInt(roomId)  // 🔧 确保携带正确的聊天室 ID
                };

                console.log('通过 WebSocket 发送文件消息:', wsMessage);
                this.ws.send(JSON.stringify(wsMessage));

                this.showSuccess(uploadResult.exists ? '文件发送成功（已存在）' : '文件发送成功');
            } else {
                // WebSocket 不可用或 socket 与目标聊天室不一致时加入队列
                this.messageQueue.push({
                    chat_room: parseInt(roomId),  // 🔧 使用保存的 roomId
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

            // 🔧本地预更新聊天室最后一条消息
            this.updateChatRoomLastMessage(parseInt(roomId), content, finalMessage.timestamp);

        } catch (error) {
            console.error('文件发送失败:', error);
            this.showError('文件发送失败: ' + (error.error || error.message || error || '未知错误'));

            // // 删除上传中的消息
            // const uploadingElement = document.querySelector(`[uploading_id="${uploadingMessage.uploading_id}"]`);
            // if (uploadingElement) {
            //     uploadingElement.parentElement.remove();
            // }

            // 从本地消息列表中移除上传失败的消息
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
    async sendEmoji(emojiHtml, targetRoomId = null) {
        const roomId = parseInt(targetRoomId || this.currentRoomId)
        if (!emojiHtml) {
            console.error('请选择表情包');
            this.showError('请选择表情包');
            return;
        }
        if (!roomId) {
            console.error('请先选择一个聊天对象')
            this.showError('请先选择一个聊天对象');
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
                chat_room: parseInt(roomId),
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
                    chat_room: parseInt(roomId),
                    temp_id: tempMessageId  // 传递临时ID，方便后端返回时匹配
                }));
            } else {
                // WebSocket 不可用时使用 HTTP
                console.log('WebSocket is not open. Using HTTP.');
                await API.sendMessage({
                    content: emojiHtml,
                    chat_room: parseInt(roomId),
                    message_type: 'emoji',
                    temp_id: tempMessageId  // 传递临时ID，方便后端返回时匹配
                });
                // HTTP方式不支持temp_id匹配，直接视为已发送（降级处理）
                const msgIndex = this.messages.findIndex(msg => msg.temp_id === tempMessageId);
                if (msgIndex !== -1) {
                    this.messages[msgIndex].is_temp = false;
                    this.renderChatHistory();
                }
            }

            // 🔧 关键修复4: 本地预更新聊天室最后一条消息
            this.updateChatRoomLastMessage(parseInt(roomId), emojiHtml, message.timestamp);

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
    async pinChat(targetRoomId) {
        try {
            const roomId = parseInt(targetRoomId || this.currentRoomId)
            console.log('置顶聊天 roomId: ', roomId, ' type: ', typeof roomId);


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
    async muteChat(targetRoomId) {
        try {
            const roomId = parseInt(targetRoomId || this.currentRoomId)
            console.log('消息免打扰 roomId: ', roomId, ' type: ', typeof roomId);

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

    // 转义 HTML 特殊字符 / 鉴权跳转等由 AppCommon 提供（见 chat-boot.js）

    // ==================== @功能 ====================

    // 初始化用户下拉菜单
    initUserDropdown() {
        const trigger = document.getElementById('userMenuTrigger');
        const menu = document.getElementById('userDropdownMenu');
        if (!trigger || !menu) return;

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('show');
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !trigger.contains(e.target)) {
                menu.classList.remove('show');
            }
        });

        // 绑定菜单项事件
        document.getElementById('settingsBtn')?.addEventListener('click', () => {
            this.showSettings();
            menu.classList.remove('show');
        });

        document.getElementById('changePasswordBtn')?.addEventListener('click', () => {
            this.openChangePasswordModal();
            menu.classList.remove('show');
        });

        document.getElementById('versionLogBtn')?.addEventListener('click', () => {
            menu.classList.remove('show');
            versionManager.openVersionLog();
        });

        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            this.logout();
            menu.classList.remove('show');
        });
    }


    // 语音&视频通话功能结束


    // 🔧 判断是否为文档类型
    isDocumentType(mimeType) {
        if (!mimeType) return false;
        const docTypes = [
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/pdf'
        ];
        return docTypes.includes(mimeType);
    }

    // 🔧 保存消息文件到云盘
    async saveToCloud(messageId) {
        const message = this.messages.find(m => m.id == messageId || m.message_id == messageId);
        if (!message || !message.file_info?.id) {
            this.showError('无法保存，文件信息缺失');
            return;
        }

        try {
            const response = await fetch('/api/cloud/files/save_from_chat/', {
                method: 'POST',
                headers: {...TokenManager.getHeaders(), 'Content-Type': 'application/json'},
                body: JSON.stringify({file_upload_id: message.file_info.id})
            });
            const data = await response.json();
            if (response.ok) {
                message.cloud_file_id = data.cloud_file_id; // 缓存云盘文件ID
                this.showSuccess(data.message || '保存成功');
                // 重新渲染该消息以显示“在线编辑”按钮
                this.rerenderMessage(message);
            } else {
                this.showError('保存失败', data.error || data.message || data.detail);
            }
        } catch (error) {
            this.showError('保存失败', error.message || data.error | data.detail);
        }
        this.hideContextMenu();
    }

    // 🔧 重新渲染单条消息
    rerenderMessage(message) {
        const msgEl = document.querySelector(`.message-wrapper[data-message-id="${message.id}"]`);
        if (msgEl) {
            const type = message.sender_id === this.currentUser?.id ? 'sent' : 'received';
            // 清空原内容并重新渲染
            const contentContainer = msgEl.querySelector('.message-text') || msgEl.querySelector('.message-content');
            if (contentContainer) {
                contentContainer.innerHTML = '';
                this.renderMessageContent(message, contentContainer);
            }
        }
    }

    // 🔧 打开云盘文档在线编辑
    editCloudDoc(cloudFileId) {
        if (!cloudFileId) {
            this.showError('未找到云盘文件ID');
            return;
        }
        window.open(`/cloud/editor/?id=${cloudFileId}`, '_blank');
        this.hideContextMenu();
    }

    // ==================== 主题切换功能 ====================
    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        this.updateThemeIcon(savedTheme);
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        this.updateThemeIcon(newTheme);
    }

    updateThemeIcon(theme) {
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
        console.log(`🌗 主题已切换为: ${theme}`);
    }

    // 🔧 ChatClient 全局加密封装
    encryptPacket(data) {
        return EncryptUtils.encryptPacket(data);
    }

    // 在 ChatClient 类中添加 decryptPacket 方法
    decryptPacket(packet) {
        return EncryptUtils.decryptPacket(packet)
    }


    // 🔧 新增：解密消息结果的方法
    _decryptMessageResults(rawData) {
        try {
            // 🔑 关键修复：检查是否为加密数据
            if (rawData && rawData.encrypt && rawData.data) {
                // console.log('🔒 检测到加密的历史消息数据，正在解密...');

                // 解密数据
                const decryptedStr = window.EncryptUtils.decryptData(rawData.data, 'aes');
                const decryptedData = JSON.parse(decryptedStr);

                // console.log('🔓 解密后的历史消息数据:', decryptedData);

                // 返回解密后的数据（可能是数组或包含 results 的对象）
                if (Array.isArray(decryptedData)) {
                    return decryptedData;
                } else if (decryptedData && decryptedData.results) {
                    return decryptedData.results;
                } else {
                    return decryptedData;
                }
            }

            // 未加密的数据，直接返回
            return rawData;
        } catch (error) {
            console.error('❌ 解密历史消息失败:', error);
            return rawData; // 解密失败时返回原始数据
        }
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


    // 🔧 监听用户首次交互，解锁震动/音频等权限
    // 🔧 修复：确保在用户交互后解锁音频/震动功能
    setupUserInteractionListener() {
        const unlockFeatures = () => {
            if (!this.userHasInteracted) {
                this.userHasInteracted = true;
                console.log('✅ 用户已交互，解锁震动/音频功能');

                // 🔧 关键：恢复所有可能被挂起的 AudioContext
                [this.audioContext, this.audioContextForMobile, this.ringtoneContext]
                    .filter(ctx => ctx && ctx.state === 'suspended')
                    .forEach(ctx => {
                        ctx.resume().catch(() => {
                        });
                    });
            }

            // 移除监听器（只执行一次）
            ['click', 'touchstart', 'keydown'].forEach(event => {
                document.removeEventListener(event, unlockFeatures);
            });
        };

        // 监听多种用户交互事件
        ['click', 'touchstart', 'keydown'].forEach(event => {
            document.addEventListener(event, unlockFeatures, {passive: true});
        });
    }


}