// static/js/chat.js


// 版本管理器
class VersionManager {
    constructor() {
        this.STORAGE_KEY = 'app_version_info';
        this.STATIC_KEY = 'static_version';
        this.CHECK_INTERVAL = 5 * 60 * 1000; // 5分钟检查一次
        this.lastCheckTime = 0;
        this.isChecking = false;
        this.updateBanner = null;
        this.updateBannerTimeout = 2 * 60 * 1000 // 2分钟后自动关闭
    }

    // 获取存储的版本信息
    getStoredVersion() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            console.warn('读取版本信息失败:', e);
            return null;
        }
    }

    // 保存版本信息
    saveVersionInfo(info) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(info));
            if (info?.static_version) {
                localStorage.setItem(this.STATIC_KEY, info.static_version);
            }
            return true;
        } catch (e) {
            console.warn('保存版本信息失败:', e);
            return false;
        }
    }


    // 比较版本（支持语义化版本和时间戳-哈希格式）
    compareVersions(current, latest) {
        // 处理时间戳-哈希格式 (20260306-f396db6)
        if (current.includes('-') && latest.includes('-')) {
            // 直接按字典序比较（日期部分保证单调递增）
            return latest.localeCompare(current);
        }

        // 处理语义化版本 (2.3.1)
        const currentParts = current.split('.').map(Number);
        const latestParts = latest.split('.').map(Number);

        for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
            const currentVal = currentParts[i] || 0;
            const latestVal = latestParts[i] || 0;

            if (latestVal > currentVal) return 1;  // 需要更新
            if (latestVal < currentVal) return -1; // 降级（通常不应发生）
        }

        return 0; // 相同版本
    }

    // 检查是否需要更新
    async checkForUpdates(force = false) {
        // 避免频繁检查
        if (this.isChecking) return null;
        if (!force && Date.now() - this.lastCheckTime < this.CHECK_INTERVAL) {
            return null;
        }

        this.isChecking = true;
        this.lastCheckTime = Date.now();

        try {
            const response = await fetch('/api/chat/version/?t=' + Date.now(), {
                method: 'GET',
                cache: 'no-cache', // 强制从网络获取
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status
            if (!response.ok) {
                if (response.status === 401) {
                    try {
                        await API.logout();
                    } catch (error) {
                        console.error('登出失败:', error);
                    } finally {
                        localStorage.removeItem('access_token');
                        localStorage.removeItem('user_id');
                        localStorage.removeItem('user_type');
                        window.location.href = '/login/';
                    }
                    return null;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const serverVersion = await response.json();
            const localVersion = this.getStoredVersion();

            // 🔧 修复1: 首次访问时保存版本
            if (!localVersion) {
                this.saveVersionInfo(serverVersion);
                console.log('✅ 首次访问，保存版本信息:', serverVersion.static_version);
                return null;
            }

            // 🔧 修复2: 正确比较版本（使用修复后的 compareVersions）
            const staticDiff = this.compareVersions(
                localVersion.static_version || '',
                serverVersion.static_version || ''
            );
            const appDiff = this.compareVersions(
                localVersion.app_version || '',
                serverVersion.app_version || ''
            );

            // 🔧 修复3: 只有版本真正更新时才触发提示
            const hasUpdate = staticDiff > 0 || appDiff > 0;
            console.log('🔍 版本检查结果:', {
                currentStatic: localVersion.static_version,
                latestStatic: serverVersion.static_version,
                staticDiff,
                currentApp: localVersion.app_version,
                latestApp: serverVersion.app_version,
                appDiff,
                hasUpdate
            });

            if (hasUpdate) {
                const updateInfo = {
                    hasUpdate: true,
                    staticUpdated: staticDiff > 0,
                    appUpdated: appDiff > 0,
                    forceUpdate: serverVersion.force_update || false,
                    current: localVersion,
                    latest: serverVersion,
                    updateMessage: serverVersion.update_message || '发现新版本，建议更新以获得最佳体验'
                };

                // 保存最新版本信息
                this.saveVersionInfo(serverVersion);

                return updateInfo;
            }

            // 无更新，但仍保存最新信息（用于下次比较）
            this.saveVersionInfo(serverVersion);
            return null;

        } catch (error) {
            console.warn('⚠️ 版本检查失败:', error);
            return null;
        } finally {
            this.isChecking = false;
        }
    }

    // 显示更新提示
    showUpdatePrompt(updateInfo) {
        // 移除旧的提示
        if (this.updateBanner && this.updateBanner.parentNode) {
            this.updateBanner.parentNode.removeChild(this.updateBanner);
        }

        // 创建更新提示
        this.updateBanner = document.createElement('div');
        this.updateBanner.className = 'version-update-banner';

        // 根据更新类型设置样式
        const isCritical = updateInfo.forceUpdate || updateInfo.appUpdated;
        this.updateBanner.classList.add(isCritical ? 'critical' : 'minor');

        // 构建提示内容
        let content = `
            <div class="update-content">
                <div class="update-icon">
                    <i class="fas fa-${isCritical ? 'exclamation-triangle' : 'sync-alt'}"></i>
                </div>
                <div class="update-text">
                    <div class="update-title">
                        ${isCritical ? '重要更新' : '发现新版本'}
                    </div>
                    <div class="update-desc">
                        ${updateInfo.updateMessage}
                    </div>
                    ${updateInfo.latest.build_time ? `
                    <div class="update-time">
                        <small>版本: ${updateInfo.latest.static_version}</small>
                        <small>更新时间: ${updateInfo.latest.build_time}</small>
                    </div>
                    ` : ''}
                </div>
                <div class="update-actions">
        `;

        if (isCritical) {
            // 强制更新：只有"立即更新"按钮
            content += `
                <button class="update-btn critical" id="updateNowBtn">
                    <i class="fas fa-redo"></i> 立即更新
                </button>
            `;
        } else {
            // 静默更新：提供"稍后更新"选项
            content += `
                <button class="update-btn minor" id="updateNowBtn">
                    <i class="fas fa-redo"></i> 立即更新
                </button>
                <button class="update-btn later" id="updateLaterBtn">
                    稍后
                </button>
            `;
        }

        content += `
                </div>
                <button class="update-close" id="updateCloseBtn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        this.updateBanner.innerHTML = content;
        document.body.appendChild(this.updateBanner);

        // 绑定事件
        document.getElementById('updateNowBtn').onclick = () => {
            this.performUpdate(updateInfo);
        };

        const closeBtn = document.getElementById('updateCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.dismissUpdatePrompt(false);
            };
        }

        const laterBtn = document.getElementById('updateLaterBtn');
        if (laterBtn) {
            laterBtn.onclick = () => {
                this.dismissUpdatePrompt(true);
            };
        }

        // 自动隐藏（非强制更新）
        if (!isCritical) {
            setTimeout(() => {
                if (this.updateBanner && this.updateBanner.parentNode) {
                    this.dismissUpdatePrompt(true);
                }
            }, this.updateBannerTimeout); // 30秒后自动隐藏
        }

        // 强制更新：5秒后自动刷新
        if (isCritical) {
            setTimeout(() => {
                this.performUpdate(updateInfo);
            }, 5000);
        }
    }

    // 消除更新提示
    dismissUpdatePrompt(remindLater = false) {
        if (!this.updateBanner || !this.updateBanner.parentNode) return;

        this.updateBanner.classList.add('fade-out');
        setTimeout(() => {
            if (this.updateBanner && this.updateBanner.parentNode) {
                this.updateBanner.parentNode.removeChild(this.updateBanner);
                this.updateBanner = null;
            }
        }, 300);

        // 稍后提醒：10分钟后再次检查
        if (remindLater) {
            console.log('稍后提醒：10分钟后再次检查');
            setTimeout(() => {
                this.checkForUpdates(true).then(updateInfo => {
                    if (updateInfo && updateInfo.hasUpdate) {
                        this.showUpdatePrompt(updateInfo);
                    }
                });
            }, 10 * 60 * 1000);
        }
    }


    // 执行更新（清除所有缓存层）
    performUpdate(updateInfo) {
        // 1. 清除 Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(reg => reg.unregister());
            }).catch(console.warn);

            // 清除 Cache Storage
            if ('caches' in window) {
                caches.keys().then(keys => {
                    keys.forEach(key => caches.delete(key));
                }).catch(console.warn);
            }
        }

        // 2. 清除 localStorage 中的缓存标记
        Object.keys(localStorage).forEach(key => {
            if (key.includes('cache') || key.includes('version') || key.includes('static')) {
                localStorage.removeItem(key);
            }
        });

        // 3. 保存滚动位置
        sessionStorage.setItem('preUpdateScrollY', window.scrollY.toString());

        // 4. 强制刷新（带唯一时间戳）
        const url = new URL(window.location.href);
        url.searchParams.set('updated', Date.now());
        window.location.replace(url.toString());
    }

    // 页面加载时恢复滚动位置
    restoreScrollPosition() {
        const scrollY = sessionStorage.getItem('preUpdateScrollY');
        if (scrollY) {
            setTimeout(() => {
                window.scrollTo(0, parseInt(scrollY));
                sessionStorage.removeItem('preUpdateScrollY');
            }, 100);
        }
    }
}


class ChatClient {
    constructor() {
        this.globalWs = null;  // 全局 WebSocket 连接
        this.roomWs = null;    // 当前聊天室 WebSocket 连接
        this.ws = null;
        this.statusCode = null;
        this.chat_login_url = '/login/';
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

        this.heartbeatCount = 0;
        this.lastHeartbeatTime = null;

        this.markReadTimers = {}; // 新增：按聊天室存储防抖定时器

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
        // 🔧 关键修复1: 注册 Service Worker（锁屏通知必需）
        this.registerServiceWorker();


        try {

            // 检查登录状态
            await this.checkLoginStatus();

            // 🔧 关键修复：加载系统配置（使用 FrontendConfigManager）
            await this.loadSystemConfigs();

            // 初始化通知系统（用户交互后）
            this.initNotificationSystem();


            // 初始化角标
            this.updateAppBadge(0);

            // 🔧 关键修复：监听页面可见性变化
            document.addEventListener('visibilitychange', () => {
                // console.log(`页面可见性变化: ${document.visibilityState}`);

                // 页面变为可见时，清除角标闪烁
                if (document.visibilityState === 'visible') {
                    this.stopTitleBlink();

                    // 更新角标（可能有新消息）
                    const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
                    this.updateAppBadge(totalUnread);

                    // // 页面恢复可见时，标记当前聊天室消息为已读
                    // if (this.currentRoomId) {
                    //     console.log('页面恢复可见时, 标记当前聊天室消息为已读');
                    //     this.markMessagesAsRead(this.currentRoomId);
                    // }
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

            // 监听窗口聚焦/失焦
            window.addEventListener('blur', () => {
                // console.log('窗口失焦');
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

            // 连接全局 WebSocket
            this.connectGlobalWebSocket();

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
            this.setupContextMenu();

            // 初始化用户下拉菜单
            this.initUserDropdown()

            // 请求通知权限
            if ('Notification' in window) {
                Notification.requestPermission();
            }


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

    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
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

        // 消息可撤回时间限制
        this.messageCanrevokeMinutes = frontendConfig.get('chat.message_canrevoke_minutes', 10);

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

        navigator.serviceWorker.register('/static/js/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);

                // 监听来自 Service Worker 的消息
                navigator.serviceWorker.addEventListener('message', event => {
                    if (event.data.type === 'notification-click' && event.data.chat_room) {
                        this.selectChatRoom(event.data.chat_room);
                    }
                });
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
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
            case 'work.notification':
                if (data.event_type === 'new' && window.WorkNotif && window.WorkNotif.refreshCount) {
                    window.WorkNotif.refreshCount();
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
    }


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
                sender: data.sender
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
    // 🔧 替换原有的 handleRoomUpdated 方法
    handleRoomUpdated(data) {
        const roomIndex = this.chatRooms.findIndex(r => parseInt(r.id) === parseInt(data.room_id));
        if (roomIndex === -1) return;

        let currentRoom = this.chatRooms[roomIndex];
        const updatedData = data.room || {};

        currentRoom.unread_count = Math.max(currentRoom.unread_count - 1, 0);

        // 🔑 关键修复：保留本地未读数，防止被跨用户上下文的序列化值覆盖（如撤回、更新群名等操作）
        const preservedUnread = currentRoom.unread_count || 0;
        const hasMentionAll = currentRoom.has_mention_all
        const hasUnreadMention = currentRoom.has_unread_mention

        this.chatRooms[roomIndex] = {
            ...currentRoom,
            ...updatedData,
            unread_count: preservedUnread, // 强制覆盖可能错误的未读数
            has_mention_all: hasMentionAll,
            has_unread_mention: hasUnreadMention
        };

        this.renderChatRooms();
        this.renderGroups();
    }


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

            // 🔧 关键修复：添加连接超时
            const connectionTimeout = setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                    console.warn('WebSocket connection timeout');
                    this.ws.close();
                    this.showError('WebSocket 连接超时，请检查网络连接');
                }
            }, 10000); // 10 秒超时


            this.ws.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('WebSocket connected successfully roomId: ', roomId);
                this.isConnected = true;
                this.updateConnectionStatus(true);
                // 发送队列中的消息
                this.sendQueuedMessages();
            };

            this.ws.onmessage = (event) => {
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
                clearTimeout(connectionTimeout);
                console.error('WebSocket error:', error);
                this.isConnected = false;
                // 不要在这里 close()，让 onclose 处理
            };
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.showError('WebSocket 连接失败，请检查网络连接');
        }
    }


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
    }

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
    }

    // 处理 WebSocket 消息
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'chat_message':
                this.handleNewMessage(data);
                break;
            case 'task.update': // 🔧 新增：处理任务状态变更
                this.handleTaskUpdate(data);
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
    }


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


    // 检测连接是否异常（连续3次未收到心跳）
    checkConnectionHealth() {
        const now = new Date();
        const timeSinceLastHeartbeat = now - this.lastHeartbeatTime;

        if (timeSinceLastHeartbeat > 5 * 3) { // 15秒未收到心跳
            console.warn('WebSocket 连接可能已断开，尝试重连...');
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
            await this.loadChatRooms();

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
    }

    // 请求通知权限（用户首次交互后）
    requestNotificationPermission() {
        // 避免重复请求
        if (this.notificationPermissionRequested || Notification.permission !== 'default') {
            return;
        }

        this.notificationPermissionRequested = true;

        // 等待用户交互后请求权限
        const requestPermission = () => {
            Notification.requestPermission().then(permission => {
                console.log('Notification permission:', permission);

                // 权限被拒绝时显示友好提示
                if (permission === 'denied') {
                    this.showNotificationPermissionHint();
                }

                // 移除事件监听（只请求一次）
                document.removeEventListener('click', requestPermission);
                document.removeEventListener('touchstart', requestPermission);
            });
        };

        // 监听用户交互
        document.addEventListener('click', requestPermission, {once: true});
        document.addEventListener('touchstart', requestPermission, {once: true});

        // 3秒后自动请求（降级方案）
        setTimeout(() => {
            if (Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }, 3000);
    }

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
                    this.showInfo('请在浏览器设置中手动开启通知权限');
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


    // 增强桌面通知，支持锁屏通知（移动端），添加震动反馈和声音
    async showNotification(title, options) {
        console.log('showNotification:', title, options);
        console.log('Notification.permission: ', Notification.permission)

        // 检查通知权限
        if (Notification.permission !== 'granted') {
            // 尝试请求权限（用户已交互）
            await Notification.requestPermission();

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

    }


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
    }

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

    }

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
    }

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
    }


    handleTaskNotification(data) {
        const {event_type, task} = data;
        const isAssignee = task.assignee_info?.id === this.currentUser.id;

        // 1. 显示桌面通知
        if (isAssignee && event_type === 'assigned') {
            this.showNotification('📋 您有一个新任务', {
                body: task.title,
                icon: task.creator_info?.avatar_url || '/static/images/default-avatar.png',
                data: {url: '/tasks/'}
            });
        }

        // 2. 在聊天室渲染“任务卡片” (如果关联了当前聊天室)
        if (task.related_chat_room_id == this.currentRoomId && event_type === 'assigned') {
            const cardHtml = `
            <div class="message-task-card" style="border: 1px solid #dcdfe6; border-radius: 8px; padding: 12px; margin-top: 8px; background: #f5f7fa; cursor: pointer; max-width: 300px;" onclick="window.open('/tasks/', '_blank')">
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
    }

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
    }

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
                    <div style="padding: 8px 16px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;"
                        onclick="window.open('/tasks/', '_blank')">
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
    }


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
                <div style="padding: 8px 16px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 12px; color: #909399; text-align: center;"
                    onclick="window.open('/tasks/', '_blank')">
                    点击查看详情 <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                </div>
            </div>
        `;

        container.innerHTML = cardHtml;
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
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(this.encryptPacket({
                type: "chat_message",
                ...messageData
            })));
        } else {
            // WebSocket 不可用时加入队列（同样包含引用信息）
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
        if (!this.currentRoomId) {
            this.showError('请先选择一个聊天对象');
            return;
        }

        const clipboardData = e.clipboardData || window.clipboardData;

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
            console.error('加载聊天历史失败:', error);
            this.showError('加载聊天历史失败');
            await this.checkLoginStatus();
        } finally {
            this.isLoadingMore = false; // 🔧 恢复加载状态
            this.hideLoading();
            // 首次加载滚动到底部
            if (!append) {
                Utils.scrollToBottom(document.getElementById('messagesList'));
            }
            if (this.statusCode === 401) {
                this.handleAuthError();
            }
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
                let targetScrollTop = currentScrollTop - loadingIndicatorOffset;
                console.log('currentScrollTop: ', currentScrollTop)
                console.log('targetScrollTop: ', targetScrollTop)

                messagesList.scrollTop = targetScrollTop;

                setTimeout(() => {
                    messagesList.scrollTop = targetScrollTop;
                }, 100);
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

        // console.log('sortedRooms:', sortedRooms);

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
            let lastMessage = room.last_message || {};
            const unreadCount = room.unread_count || 0;
            let roomName = room.display_name || '未知聊天室';

            // 🔧 修改：优先判断 @所有人，其次判断 @我
            const hasMentionAll = room.has_mention_all === true;
            const hasUnreadMention = room.has_unread_mention === true;
            let mentionHint = '';

            if (hasMentionAll) {
                mentionHint = '<span class="mention-hint">[@所有人] </span>';
            } else if (hasUnreadMention) {
                mentionHint = '<span class="mention-hint">[有人@我] </span>';
            }

            // 🔧 新增：检测草稿状态
            const hasDraft = this.inputDrafts.has(room.id);
            const draftHint = hasDraft ? ' <span class="draft-hint">[草稿]</span> ' : '';


            let roomAvatar, isOnline, isOnline_html = '', username = '',
                lastMessageText = lastMessage.content || '暂无消息',
                lastMessageTimestamp = lastMessage.timestamp || '';
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
                    isOnline = false;
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

            }


            if (hasDraft) {
                let draft = this.inputDrafts.get(room.id)
                lastMessageText = draft.content
                lastMessageTimestamp = draft.timestamp
            }

            // console.log('lastMessageText: ', lastMessageText);

            // 🔧 关键修复：为私聊头像添加包装器和输入指示器
            const avatarHtml = room.room_type === 'private'
                ? `<div class="chat-item-avatar-wrapper">
                    <img src="${roomAvatar}" alt="${roomName}" class="chat-item-avatar" title="${username}">
                    <span class="chat-item-typing-indicator" id="typingIndicator-${room.id}">正在输入...</span>
                </div>`
                : `<img src="${roomAvatar}" alt="${roomName}" class="chat-item-avatar" title="${username}">`;


            // 🔧 关键修复：为私聊添加 data-user-id 属性，群聊不添加
            const dataUserIdAttr = room.room_type === 'private' && otherUserId ? `data-user-id="${otherUserId}"` : '';

            html += `
            <div class="chat-item ${room.is_pinned ? 'pinned' : ''}" 
                 data-room-id="${room.id}" 
                 ${dataUserIdAttr}
                 >
                <div class="chat-item-avatar">
                    ${avatarHtml}
                </div>
                <div class="chat-item-info">
                    <div class="chat-item-title">
                        ${room.is_pinned ? '<i class="fas fa-thumbtack pinned-icon"></i>' : ''}
                        ${room.is_muted ? '<i class="fas fa-volume-mute muted-icon"></i>' : ''}
                        ${roomName}
                    </div>
                    <div class="chat-item-subtitle">${mentionHint}${draftHint}${lastMessageText}</div>
                </div>
                <div class="chat-item-meta">
                    ${unreadCount > 0 ? `<div class="chat-item-unread-count">${unreadCount > 99 ? '99+' : unreadCount}</div>` : ''}
                    ${isOnline_html}
                    <div class="chat-item-time">${lastMessageTimestamp ? Utils.formatLastmessageTimeStamp(lastMessageTimestamp) : ''}</div>
                </div>
            </div>
        `;
        });

        chatList.innerHTML = html;
    }


    // 重新渲染整个消息历史（用于消息更新/撤回等场景）
    renderChatHistory(append = false) {
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

        if (!append) {
            // 滚动到底部
            Utils.scrollToBottom(messagesList);
        }

    }

    // 判断是否需要显示时间戳
    shouldShowTimestamp(prevMessage, currMessage, diffMinutes = 5) {
        if (!prevMessage || !currMessage) return true;

        const prevTime = new Date(prevMessage.timestamp);
        const currTime = new Date(currMessage.timestamp);
        const timeDiff = currTime - prevTime;

        // 跨天显示日期
        if (prevTime.toDateString() !== currTime.toDateString()) {
            return true;
        }

        // 超过5分钟显示时间
        return timeDiff > diffMinutes * 60 * 1000;
    }


    // 渲染时间戳
    renderTimeStamp(timestamp) {
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time-divider';

        const date = new Date(timestamp);
        const now = new Date();

        // 获取具体时间字符串 (HH:mm)
        const timeStr = date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        // 重置 now 为当前时间，避免 setDate 修改原对象影响后续判断
        const currentNow = new Date();

        // 计算时间差
        const diffTime = currentNow.getTime() - date.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // 判断是否是今天 (0天)
        const isToday = currentNow.toDateString() === date.toDateString();

        // 判断是否是昨天 (1天)
        const yesterday = new Date(currentNow);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = yesterday.toDateString() === date.toDateString();

        // 判断是否是前天 (2天)
        const dayBeforeYesterday = new Date(currentNow);
        dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
        const isDayBeforeYesterday = dayBeforeYesterday.toDateString() === date.toDateString();

        let label;
        if (isToday) {
            label = `今天 ${timeStr}`;
        } else if (isYesterday) {
            label = `昨天 ${timeStr}`;
        } else if (isDayBeforeYesterday) {
            label = `前天 ${timeStr}`;
        } else if (diffDays < 6) {
            // 最近一周内（不含今天、昨天、前天），显示星期几 + 时间
            const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            const weekDay = weekDays[date.getDay()];
            label = `${weekDay} ${timeStr}`;
        } else {
            const currentYear = currentNow.getFullYear();
            const messageYear = date.getFullYear();

            if (messageYear === currentYear) {
                // 同一年但超过一周，显示月日 + 时间
                const month = date.getMonth() + 1;
                const day = date.getDate();
                label = `${month}月${day}日 ${timeStr}`;
            } else {
                // 超过一年，显示年月日 + 时间
                const year = date.getFullYear();
                const month = date.getMonth() + 1;
                const day = date.getDate();
                label = `${year}年${month}月${day}日 ${timeStr}`;
            }
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
        // 创建消息包装器
        let messageWrapper = document.createElement('div');
        messageWrapper.className = `${type === 'received' ? 'message-left-wrapper' : 'message-right-wrapper'}`;
        messageWrapper.dataset.messageId = message.id || message.message_id;
        messageWrapper.dataset.id = message.id || message.message_id;

        // ✅ 正确绑定右键菜单
        messageWrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.handleContextMenu(e, message)
        });

        const headerElementContainer = document.createElement('div');

        if (type === 'received') {
            // 接收的消息 - 使用左侧 wrapper
            // messageWrapper = document.createElement('div');
            // messageWrapper.className = 'message-left-wrapper';


            // 创建头像元素（左侧）
            const avatarElement = document.createElement('div');
            avatarElement.className = 'message-avatar';

            const contentElementContainer = document.createElement('div');
            contentElementContainer.className = 'message-container';


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
            <span class="message-time" style="display:none">${Utils.formatTime(message.timestamp)}</span>
            `;

            // 创建消息内容元素
            const contentElement = document.createElement('div');
            contentElement.className = 'message-content message-left';
            contentElement.innerHTML = `
            <div class="message-text"></div>
            `;


            // 设置消息内容
            const messageContent = contentElement.querySelector('.message-text');
            this.renderMessageContent(message, messageContent);

            // 添加到 wrapper（头像 -> 头部 -> 内容）
            messageWrapper.appendChild(avatarElement);
            contentElementContainer.appendChild(headerElement);
            contentElementContainer.appendChild(contentElement);
            messageWrapper.appendChild(contentElementContainer);
            // messageWrapper.appendChild(headerElement_2);
        } else {
            // 发送的消息 - 使用右侧 wrapper
            // messageWrapper = document.createElement('div');
            // messageWrapper.className = 'message-right-wrapper';

            // 引用
            const quoteBtn = document.createElement('button');
            quoteBtn.className = 'message-quote-btn';
            quoteBtn.innerHTML = '<i class="fas fa-quote-left"></i>';
            quoteBtn.title = '引用';
            quoteBtn.onclick = (e) => {
                e.stopPropagation();
                this.setQuoteMessage(message);
            };

            // 创建消息头部元素（只有时间，因为是自己）
            const headerElement = document.createElement('div');
            headerElement.className = 'message-header';
            headerElement.innerHTML = `
            <span class="message-time" style="display:none">${Utils.formatTime(message.timestamp)}</span>
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

            // 添加到 wrapper（引用 -> 头部 -> 内容 -> 头像）
            messageWrapper.appendChild(quoteBtn);
            messageWrapper.appendChild(headerElement);
            messageWrapper.appendChild(contentElement);
            headerElementContainer.appendChild(avatarElement);
        }

        // 在发送的消息上直接渲染撤销按钮（10分钟内）
        if (type === 'sent' && !message.is_deleted) {
            const isOwnMessage = parseInt(message.sender?.id) === this.currentUser?.id;
            const messageTime = new Date(message.timestamp).getTime();
            const currentTime = new Date().getTime();
            const timeDiff = currentTime - messageTime;
            const canRevoke = isOwnMessage && timeDiff < this.messageCanrevokeMinutes * 60 * 1000; // 10分钟内

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


        // 为接收的消息添加引用按钮（非撤回消息）
        // 🔧 新增：为消息添加转发按钮（非撤回消息）
        if (!message.is_deleted && message.content && message.content !== '[消息已撤销]') {
            // 引用按钮（原有的）
            if (type === 'received') {
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


            const actionBtnForward = document.createElement('div');
            actionBtnForward.className = 'message-actions';

            // 🔧 新增：转发按钮
            const forwardBtn = document.createElement('button');
            forwardBtn.className = 'message-forward-btn';
            forwardBtn.innerHTML = '<i class="fas fa-share"></i>';
            forwardBtn.title = '转发';
            forwardBtn.onclick = (e) => {
                e.stopPropagation();
                this.showForwardModal(message);
            };
            actionBtnForward.appendChild(forwardBtn);

            if (type === 'sent') {
                headerElementContainer.appendChild(actionBtnForward)
            } else {
                messageWrapper.appendChild(forwardBtn);
            }
        }


        if (type === 'sent') {
            messageWrapper.appendChild(headerElementContainer);
        }


        // 清空原始模板内容，添加新的 wrapper
        wrapper.innerHTML = '';
        wrapper.appendChild(messageWrapper);


        // 获取消息列表容器
        const messagesList = document.getElementById('messagesList');
        if (messagesList) {
            messagesList.appendChild(messageElement);
        }


        // 如果是最新消息且当前在聊天界面，滚动到底部
        if (this.currentRoomId && parseInt(message.chat_room) == parseInt(this.currentRoomId)) {
            Utils.scrollToBottom(messagesList);
        }

        // 绑定视频监听
        setTimeout(() => {
            this.setupVideoMessageListerners()
        }, 100)

    }


    // 🔧 新增：显示转发模态框,如果消息类型是语音则禁止转发
    showForwardModal(message) {
        console.log('forward message: ', message)
        if (message.message_type === 'voice') {
            this.showAlert('错误', '语音消息不支持转发');
            return;
        }
        // 关闭可能存在的其他模态框
        this.closeAllModals();

        const modal = document.createElement('div');
        modal.className = 'forward-modal show';
        modal.id = 'forwardModal';

        // 清除之前该模态框
        this.clearModal(modal.id);

        // 构建预览内容
        let previewContent = '';
        if (message.message_type === 'text') {
            previewContent = this.escapeHtml(message.content || '');
        } else if (message.message_type === 'image') {
            previewContent = '[图片]';
        } else if (message.message_type === 'file') {
            previewContent = `[文件] ${message.file_info?.name || ''}`;
        } else if (message.message_type === 'task_card') {
            let taskTitle = '';
            let taskStatus = '';
            let taskStatusRaw = '';
            let taskAssignee = '';
            const statusMapPreview = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};
            const statusColorPreview = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
            try {
                const taskData = typeof message.content === 'string' ? JSON.parse(message.content) : (message.task_data || {});
                taskTitle = taskData.title || taskData.task_title || '';
                taskStatusRaw = taskData.status || '';
                taskStatus = statusMapPreview[taskData.status] || '';
                taskAssignee = (taskData.assignee_info?.real_name || taskData.assignee_info?.username || taskData.assignee_name || '');
            } catch (e) {
                taskTitle = '';
            }
            // 使用 innerHTML 的标记，后面会在渲染时检测
            const escTitle = this.escapeHtml(taskTitle || '任务卡片');
            const statusBg = statusColorPreview[taskStatusRaw] || '#909399';
            previewContent =`
                    <div class="forward-task-card-preview" title="任务卡片" style="padding:6px 8px;border-left:3px solid #409EFF;display:flex;align-items:center;gap:8px;">
                        <div style="font-weight:500;font-size:13px;color:#303133;display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                            <i class="fas fa-tasks" style="color:#409EFF;"></i> 
                            <span>${escTitle}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                            ${taskStatus ? `<span style="background:${statusBg};color:#fff;padding:1px 6px;border-radius:8px;">${taskStatus}</span>` : ''}
                            ${taskAssignee ? `<span title="执行人">${this.escapeHtml(taskAssignee)}</span>` : ''}
                        </div>
                    </div>
                `;
        } else {
            previewContent = this.escapeHtml(message.content || '[未知类型]');
        }

        modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-share"></i> 转发消息</h3>
                <button class="close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <!-- 预览转发的消息 -->
                <div class="forward-preview" id="forwardPreviewContainer">
                    <div class="preview-content">${previewContent}</div>
                    ${message.file_info ? `
                        <div class="preview-file">
                            <i class="${Utils.getFileIconClass(message.file_info.mime_type)}"></i>
                            <span>${message.file_info?.url ? this.escapeHtml(message.file_info.name) : ''}</span>
                        </div>
                    ` : ''}
                </div>

                <!-- 搜索聊天对象 -->
                <div class="search-box">
                    <i class="fas fa-search"></i>
                    <input type="text" id="forwardSearch" placeholder="搜索聊天对象...">
                </div>
                
                <!-- 聊天对象列表 -->
                <div class="forward-list" id="forwardList">
                    <!-- 动态生成 -->
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="chatClient.closeModal('forwardModal')">取消</button>
                <button class="btn btn-primary" id="forwardConfirmBtn" disabled>转发</button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // 绑定关闭事件
        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeModal('forwardModal');
        }

        modal.onclick = (e) => {
            if (e.target === modal) this.closeModal('forwardModal');
        };

        // 加载可转发的聊天对象
        this.loadForwardTargets(message);

        // 绑定搜索事件
        const forwardSearch = document.getElementById('forwardSearch');
        if (forwardSearch) {
            forwardSearch.addEventListener('input', (e) => {
                this.filterForwardTargets(e.target.value);
            });
        }

        // 绑定确认按钮
        const confirmBtn = document.getElementById('forwardConfirmBtn');
        if (confirmBtn) {
            confirmBtn.onclick = () => this.executeForward();
        }
    }

    // 🔧 新增：加载可转发的聊天对象
    loadForwardTargets(message) {
        const container = document.getElementById('forwardList');
        if (!container) return;

        // // 过滤掉当前聊天室和已删除的聊天室
        // const targets = this.chatRooms.filter(room => {
        //     return room.id !== this.currentRoomId && !room.is_deleted;
        // });

        // 🔧 修改：允许转发给当前聊天室（移除 room.id !== this.currentRoomId 判断）
        const targets = this.chatRooms.filter(room => {
            return !room.is_deleted;
        });

        let html = '';
        targets.forEach(room => {
            const roomName = room.display_name ||
                (room.room_type === 'private'
                    ? room.members?.find(m => m.id !== this.currentUser.id)?.real_name || '未知用户'
                    : '未知群组');
            const avatar = room.room_type === 'private'
                ? room.members?.find(m => m.id !== this.currentUser.id)?.avatar_url || '/static/images/default-avatar.png'
                : room.avatar || '/static/images/group-avatar.png';

            html += `
            <div class="forward-item" data-room-id="${room.id}" onclick="chatClient.toggleForwardTarget(${room.id})">
                <div class="forward-avatar">
                    <img src="${avatar}" alt="${roomName}">
                </div>
                <div class="forward-info">
                    <div class="forward-name">${this.escapeHtml(roomName)}</div>
                    <div class="forward-subtitle">${room.room_type === 'private' ? '私聊' : '群聊'}</div>
                </div>
                <div class="forward-checkbox">
                    <input type="checkbox" class="target-checkbox" data-room-id="${room.id}">
                </div>
            </div>
        `;
        });

        container.innerHTML = html || '<div class="empty-state"><p>暂无可转发的聊天对象</p></div>';

        // 保存消息引用
        this.forwardMessage = message;
        this.selectedForwardTargets = new Set();
    }

    // 🔧 新增：切换转发目标
    toggleForwardTarget(roomId) {
        const checkbox = document.querySelector(`.target-checkbox[data-room-id="${roomId}"]`);
        if (checkbox) {
            checkbox.checked = !checkbox.checked;

            if (checkbox.checked) {
                this.selectedForwardTargets.add(roomId);
            } else {
                this.selectedForwardTargets.delete(roomId);
            }

            // 更新确认按钮状态
            const confirmBtn = document.getElementById('forwardConfirmBtn');
            if (confirmBtn) {
                confirmBtn.disabled = this.selectedForwardTargets.size === 0;
            }
        }
    }


    // chat.js - ChatClient 类中的 executeForward 方法

// 🔧 新增：执行转发（使用 WebSocket）
    async executeForward() {
        if (!this.forwardMessage || this.selectedForwardTargets.size === 0) {
            this.showError('请选择转发的聊天对象');
            return;
        }

        const message = this.forwardMessage;
        const targets = Array.from(this.selectedForwardTargets);

        try {
            // 🔧 关键修复：不切换聊天室，直接使用当前 WebSocket 发送
            // 后端会根据 chat_room 参数路由到正确的聊天室
            for (const roomId of targets) {
                await this.forwardMessageViaWebSocket(roomId, message);
            }

            this.closeModal('forwardModal');
            this.showSuccess(`已成功转发到 ${targets.length} 个聊天`);

        } catch (error) {
            console.error('转发失败:', error);
            this.showError('转发失败: ' + (error.message || '未知错误'));
        }
    }


    // 🔧 关键修复：通过 WebSocket 转发消息（不切换聊天室）
    async forwardMessageViaWebSocket(roomId, originalMessage) {
        return new Promise((resolve, reject) => {
            // 构建转发消息内容
            const forwardContent = this.buildForwardContent(originalMessage);

            // 🔧 关键修复：不切换聊天室，直接使用当前 WebSocket 发送
            // 后端会根据 chat_room 参数路由到正确的聊天室
            console.log(`📤 转发消息到聊天室 ${roomId}（不切换聊天室）`);

            // 构建完整的消息数据
            const tempMessageId = Date.now();

            const messageData = {
                id: tempMessageId,
                temp_id: tempMessageId,
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.username,
                sender: this.currentUser,
                content: forwardContent.content,
                timestamp: new Date().toISOString(),
                is_read: true,
                message_type: forwardContent.message_type,
                file_id: forwardContent.file_id,
                file_info: forwardContent.file_info,
                chat_room: parseInt(roomId),  // 🔧 确保携带正确的聊天室 ID
                is_temp: true,
                is_forwarded: true
            };

            // 通过当前 WebSocket 发送
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const wsMessage = {
                    type: 'chat_message',
                    content: messageData.content,
                    message_type: messageData.message_type,
                    file_id: messageData.file_id,
                    file_info: messageData.file_info,
                    temp_id: tempMessageId,
                    chat_room: parseInt(roomId)  // 🔧 确保携带正确的聊天室 ID
                };

                console.log('通过 WebSocket 发送转发消息:', wsMessage);
                this.ws.send(JSON.stringify(wsMessage));

                // 保存到本地消息列表（仅当前聊天室）
                if (parseInt(roomId) === parseInt(this.currentRoomId)) {
                    this.messages.push(messageData);
                    this.renderMessage(messageData, 'sent');
                    Utils.scrollToBottom(document.getElementById('messagesList'));
                }

                resolve();

            } else {
                // WebSocket 不可用时加入队列
                this.messageQueue.push({
                    chat_room: parseInt(roomId),
                    content: messageData.content,
                    message_type: messageData.message_type,
                    file_id: messageData.file_id,
                    file_info: messageData.file_info,
                    temp_id: tempMessageId
                });
                resolve();
            }
            // 更新聊天室最后一条消息
            this.updateChatRoomLastMessage(parseInt(roomId), messageData.content, messageData.timestamp);

        });
    }


    // 🔧 新增：构建转发消息内容
    buildForwardContent(originalMessage) {
        const sender = originalMessage.sender?.real_name ||
            originalMessage.sender?.username ||
            originalMessage.sender_name || '未知用户';

        // 🔧 关键修复：根据消息类型构建不同的内容
        switch (originalMessage.message_type) {
            case 'text':
                return {
                    content: `「转发消息」\n${sender}: ${originalMessage.content}`,
                    message_type: 'text'
                };

            case 'image':
                return {
                    content: `「转发图片」\n${sender} 发送的图片`,
                    message_type: 'image',
                    file_info: originalMessage.file_info,  // 🔧 保留文件信息
                    file_id: originalMessage.file_info?.file_id || originalMessage.file_info?.id
                };

            case 'file':
                return {
                    content: `「转发文件」\n${sender} 发送的文件: ${originalMessage.file_info?.name || ''}`,
                    message_type: 'file',
                    file_info: originalMessage.file_info,  // 🔧 保留文件信息
                    file_id: originalMessage.file_info?.file_id || originalMessage.file_info?.id
                };

            case 'video':
                return {
                    content: `「转发视频」\n${sender} 发送的视频`,
                    message_type: 'video',
                    file_info: originalMessage.file_info,
                    file_id: originalMessage.file_info?.file_id || originalMessage.file_info?.id
                };

            case 'voice':
                return {
                    content: `「转发语音」\n${sender} 发送的语音`,
                    message_type: 'voice',
                    file_info: originalMessage.file_info,
                    file_id: originalMessage.file_info?.file_id || originalMessage.file_info?.id
                };

            case 'emoji':
                return {
                    content: `「转发表情」\n${sender}: ${originalMessage.content}`,
                    message_type: 'emoji'
                };

            // 🔧 新增：转发任务卡片（携带完整任务数据）
            case 'task_card':
                let taskData = originalMessage.task_data || null;
                if (!taskData && originalMessage.content) {
                    try { taskData = JSON.parse(originalMessage.content); } catch (_) {}
                }
                return {
                    content: taskData ? JSON.stringify(taskData) : (originalMessage.content || '{}'),
                    message_type: 'task_card',
                    task_data: taskData
                };

            default:
                return {
                    content: `「转发消息」\n${sender}: ${originalMessage.content || '[未知类型]'}`,
                    message_type: 'text'
                };
        }
    }

    // 🔧 新增：过滤转发目标
    filterForwardTargets(keyword) {
        const items = document.querySelectorAll('.forward-item');
        items.forEach(item => {
            const name = item.querySelector('.forward-name').textContent.toLowerCase();
            const match = name.includes(keyword.toLowerCase());
            item.style.display = match ? 'flex' : 'none';
        });
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


    // 🔧 新增：渲染通话记录消息
    renderCallRecordMessage(message, container) {
        const callType = message.call_type || (message.message_type === 'call_video' ? 'video' : 'audio');
        const callStatus = message.call_status || 'completed';
        const callDuration = message.call_duration || 0;

        // 创建通话记录容器
        const callRecord = document.createElement('div');
        callRecord.className = `call-record ${callStatus}`;

        // 确定图标
        let iconClass = '';
        let iconColor = '';
        let statusText = '';

        if (callType === 'video') {
            iconClass = 'fas fa-video';
            iconColor = '#5b5ef7'; // 视频用紫色
        } else {
            iconClass = 'fas fa-phone-alt';
            iconColor = '#4caf50'; // 语音用绿色
        }

        // 根据状态设置文本和样式
        switch (callStatus) {
            case 'completed':
                // 已完成的通话，显示时长
                const minutes = Math.floor(callDuration / 60);
                const seconds = callDuration % 60;
                if (minutes > 0) {
                    statusText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                } else {
                    statusText = `${seconds}秒`;
                }
                break;
            case 'missed':
                statusText = '未接听';
                iconColor = '#999';
                break;
            case 'rejected':
                statusText = '已拒绝';
                iconColor = '#999';
                break;
            case 'cancelled':
                statusText = '已取消';
                iconColor = '#999';
                break;
            default:
                statusText = '通话结束';
                iconColor = '#999';
        }

        // 构建HTML内容
        callRecord.innerHTML = `
            <div class="call-record-icon" style="color: ${iconColor};">
                <i class="${iconClass}"></i>
            </div>
            <div class="call-record-info">
                <div class="call-record-type">
                    ${callType === 'video' ? '视频通话' : '语音通话'}
                </div>
                <div class="call-record-status">
                    ${statusText}
                </div>
            </div>
        `;

        container.appendChild(callRecord);
    }


    // 🔧 新增：根据引用消息类型生成 HTML
    renderQuotedContent(type, content, fileInfo = null, messageId = null, message= null) {
        const escape = (str) => this.escapeHtml(str || '');

        // 生成点击跳转的处理函数，如果 messageId 存在则跳转，否则阻止冒泡
        const getClickHandler = () => {
            if (messageId) {
                return `event.stopPropagation(); chatClient.jumpToMessage('${messageId}')`;
            }
            return 'event.stopPropagation()';
        };

        switch (type) {
            case 'text':
            case 'emoji':
                return `<div class="quoted-file-link" "
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <i class="fas fa-link"></i> 
                            <span class="quote-text-content" style="color: #909399; font-size: 12px;">${this.escapeHtml(content || '[文本消息]')}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`


            case 'image':
                // 优先使用 fileInfo.url，兼容 content 直接存 URL 的旧数据
                const imgUrl = (content.startsWith('http') || content.startsWith('/')) ? content : (fileInfo?.url || '');
                return imgUrl
                    ? `<img src="${escape(imgUrl)}" class="quote-image-preview" alt="引用图片" onclick="event.stopPropagation(); chatClient.previewImage('${escape(imgUrl)}')" title="点击预览" />`
                    : `<span class="quote-icon-wrapper"><i class="fas fa-image"></i> [图片]</span>`;

            case 'video':
                return `<div class="quoted-file-link" "
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <i class="fas fa-link"></i> 
                            <span class="quote-text-content" style="color: #909399; font-size: 12px;"><i class="fas fa-video"></i> ${escape(content || '[视频]')}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`;


            case 'file':
                const iconClass = Utils.getFileIconClass(fileInfo?.mime_type, fileInfo?.name);
                return `<div class="quoted-file-link" "
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <i class="fas fa-link"></i> 
                            <span class="quote-text-content" style="color: #909399; font-size: 12px;"><i class="${iconClass}"></i> ${escape(fileInfo?.name || content || '[文件]')}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`;

            case 'voice':
            case 'audio':
                const dur = fileInfo?.duration ? `${Math.floor(fileInfo.duration)}"` : '';
                return `<div class="quoted-file-link" "
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <i class="fas fa-link"></i> 
                            <span class="quote-text-content" style="color: #909399; font-size: 12px;"><i class="fas fa-microphone"></i> ${escape(content || '[语音]')} ${dur}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`;

            // 🔧 新增：渲染通话记录消息
            case 'call_audio':
            case 'call_video':
                // 确定图标
                let _iconClass = '';
                let iconColor = '';
                let statusText = '';
                const callType = type.replace('call_', '');
                if (callType === 'video') {
                    _iconClass = 'fas fa-video';
                    iconColor = '#5b5ef7'; // 视频用紫色
                } else {
                    _iconClass = 'fas fa-phone-alt';
                    iconColor = '#4caf50'; // 语音用绿色
                }
                const callDuration = fileInfo?.call_duration || 0;

                const minutes = Math.floor(callDuration / 60);
                const seconds = callDuration % 60;
                if (minutes > 0) {
                    statusText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                } else {
                    statusText = `${seconds}秒`;
                }

                return `<div class="quoted-file-link" "
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <i class="fas fa-link"></i>
                            <span class="quote-text-content" style="color: #909399; font-size: 12px;"><i class="${_iconClass}" style="color: ${iconColor};"></i> ${callType === 'video' ? '视频通话' : '语音通话'} ${statusText}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`;

            // 🔧 新增：渲染被引用的任务卡片消息（迷你卡片风格）
            case 'task_card':
                let qTaskTitle = '';
                let qTaskStatus = '';
                let qTaskAssignee = '';
                let qTaskStatusRaw = '';
                const qStatusMap = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};
                const qStatusColors = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
                try {
                    const tcData = (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) ? JSON.parse(content) : (message?.task_data || {});
                    qTaskTitle = tcData.title || tcData.task_title || content || '[任务卡片]';
                    qTaskStatusRaw = tcData.status || '';
                    qTaskStatus = qStatusMap[tcData.status] || '';
                    qTaskAssignee = (tcData.assignee_info?.real_name || tcData.assignee_info?.username || tcData.assignee_name || '');
                } catch (e) {
                    console.log('task_card error:', e)
                    qTaskTitle = content || '[任务卡片]';
                }
                const qStatusColor = qStatusColors[qTaskStatusRaw] || '#909399';
                if (qTaskTitle.length > 40) qTaskTitle = qTaskTitle.substring(0, 40) + '...';
                return `<div class="quoted-file-link" style="padding: 6px 8px; border-left: 3px solid #409EFF; background: #f0f7ff; border-radius: 4px;"
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <i class="fas fa-tasks" style="color:#409EFF;font-size:12px;"></i>
                                <span style="font-weight:500;font-size:12px;color:#303133;">${escape(qTaskTitle)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                                ${qTaskStatus ? `<span style="background:${qStatusColor};color:#fff;padding:1px 6px;border-radius:8px;">${qTaskStatus}</span>` : ''}
                                ${qTaskAssignee ? `<span title="执行人"><i class="fas fa-user-circle" style="margin-right:2px;"></i>${escape(qTaskAssignee)}</span>` : ''}
                                <i class="fas fa-location-arrow" style="margin-left:auto;color:#ccc;"></i>
                            </div>
                        </div>`;


            case 'location':
                return `<span class="quote-icon-wrapper"><i class="fas fa-map-marker-alt"></i> [位置]</span>`;

            default:
                return `<span class="quote-text-content">${escape(content) || '[未知类型]'}</span>`;
        }
    }


    // chat.js - ChatClient 类中的 renderMessageContent 方法

    // 🔧 修复：渲染不同类型的消息内容
    renderMessageContent(message, container) {
        container.innerHTML = '';

        if (message?.uploading_id) {
            // 添加属性
            container.setAttribute('uploading_id', message.uploading_id);
            container.title = message?.content || '正在上传文件';
        }

        // 🔧 关键修复 1: 处理已撤销消息
        if (message.is_deleted && message.content === '[消息已撤销]') {
            container.innerHTML = '<span class="revoked-message">[消息已撤销]</span>';
            container.classList.add('message-revoked');
            return;
        }

        // 🔧 关键修复 2: 处理转发消息标记
        if (message.is_forwarded) {
            const forwardMark = document.createElement('div');
            forwardMark.className = 'message-forward-mark';
            forwardMark.innerHTML = '<i class="fas fa-share"></i> 转发';
            container.appendChild(forwardMark);
        }

        // 🔧 关键修复 3: 根据消息类型渲染
        switch (message.message_type) {
            case 'text':
                // 🔧 保留 HTML 内容（支持转发标记）
                container.innerHTML += message.content || '';
                break;

            case 'image':
                if (message.file_info?.url) {
                    const img = document.createElement('img');
                    img.src = message.file_info.url;
                    img.className = 'message-image';
                    img.onclick = () => this.previewImage(message.file_info.url);
                    container.appendChild(img);

                    // 🔧 新增：添加文件操作按钮
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'message-file-actions';
                    actionsDiv.innerHTML = `
                        <button class="msg-action-btn" onclick="chatClient.saveToCloud('${message.id}')" title="保存到云盘">
                            <i class="fas fa-cloud-upload-alt"></i> 
                        </button>
                        ${message.cloud_file_id && this.isDocumentType(message.file_info?.mime_type) ? `
                            <button class="msg-action-btn" onclick="chatClient.editCloudDoc('${message.cloud_file_id}')" title="在线编辑">
                                <i class="fas fa-edit"></i> 
                            </button>
                        ` : ''}
                    `;
                    container.appendChild(actionsDiv);
                } else {
                    container.textContent = '[图片加载失败]';
                }
                break;

            case 'file':
                if (message.file_info?.url) {
                    const fileLink = document.createElement('div');
                    fileLink.className = 'message-file';
                    fileLink.title = message.file_info?.name || '文件'
                    const iconClass = Utils.getFileIconClass(message.file_info.mime_type, message.file_info.name);
                    fileLink.innerHTML = `
                    <i class="${iconClass}"></i>
                    <span  class="file-name">${message.file_info.name}</span>
                    <span  class="file-size">(${Utils.formatFileSize(message.file_info.size)})</span>
                    <i class="fas fa-download download-icon"></i>
                `;
                    fileLink.onclick = () => window.open(message.file_info.url, '_blank');
                    container.appendChild(fileLink);

                    // 🔧 新增：添加文件操作按钮
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'message-file-actions';
                    actionsDiv.innerHTML = `
                        <button class="msg-action-btn" onclick="chatClient.saveToCloud('${message.id}')" title="保存到云盘">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        ${message.cloud_file_id && this.isDocumentType(message.file_info?.mime_type) ? `
                            <button class="msg-action-btn" onclick="chatClient.editCloudDoc('${message.cloud_file_id}')" title="在线编辑">
                                <i class="fas fa-edit"></i>
                            </button>
                        ` : ''}
                    `;
                    container.appendChild(actionsDiv);
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
                    // video.muted = true;
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

                    // 🔧 新增：添加文件操作按钮
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'message-file-actions';
                    actionsDiv.innerHTML = `
                        <button class="msg-action-btn" onclick="chatClient.saveToCloud('${message.id}')" title="保存到云盘">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        ${message.cloud_file_id && this.isDocumentType(message.file_info?.mime_type) ? `
                            <button class="msg-action-btn" onclick="chatClient.editCloudDoc('${message.cloud_file_id}')" title="在线编辑">
                                <i class="fas fa-edit"></i>
                            </button>
                        ` : ''}
                    `;
                    container.appendChild(actionsDiv);
                } else {
                    container.textContent = '[视频加载失败]';
                }
                break;

            case 'voice':
                this.renderVoiceMessage(message, container);
                break;

            case 'audio':
                if (message.file_info?.url) {
                    const audio = document.createElement('audio');
                    audio.src = message.file_info.url;
                    audio.controls = true;
                    audio.className = 'message-audio';
                    container.appendChild(audio);

                    // 🔧 新增：添加文件操作按钮
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'message-file-actions';
                    actionsDiv.innerHTML = `
                        <button class="msg-action-btn" onclick="chatClient.saveToCloud('${message.id}')" title="保存到云盘">
                            <i class="fas fa-cloud-upload-alt"></i>
                        </button>
                        ${message.cloud_file_id && this.isDocumentType(message.file_info?.mime_type) ? `
                            <button class="msg-action-btn" onclick="chatClient.editCloudDoc('${message.cloud_file_id}')" title="在线编辑">
                                <i class="fas fa-edit"></i>
                            </button>
                        ` : ''}
                    `;
                    container.appendChild(actionsDiv);
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
                    locationLink.onclick = () => window.open(message.file_info.url);
                    container.appendChild(locationLink);
                } else {
                    container.textContent = '[位置信息缺失]';
                }
                break;

            case 'emoji':
                container.innerHTML = message.content;
                break;

            // 🔧 新增：渲染通话记录消息
            case 'call_audio':
            case 'call_video':
                this.renderCallRecordMessage(message, container);
                break;
            case 'task_card':
                try {
                    // 🔧 从 content(JSON) 或 task_data 获取任务数据
                    let taskData = message.task_data || null;
                    if (!taskData && message.content) {
                        try {
                            const parsed = JSON.parse(message.content);
                            if (parsed && parsed.title !== undefined) {
                                taskData = parsed;
                            }
                        } catch (_) {}
                    }
                    if (taskData) {
                        this.renderTaskCardInChat(taskData, container);
                    } else {
                        container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-tasks"></i> [任务卡片]</div>';
                    }
                } catch (e) {
                    console.error('解析任务卡片数据失败', e);
                    container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-tasks"></i> [任务卡片]</div>';
                }
                break;
            default:
                container.innerHTML += message.content || '[未知消息类型]';
        }

        // 🔧 关键修复 4: 渲染引用消息（必须在内容之后）
        if (message.quote_message_id || message.quote_info || message.quote_file_info) {
            const quoteElement = document.createElement('div');
            quoteElement.className = 'message-quote';

            // 🔧 获取发送者名称（兼容多种字段）
            const senderName = message.quote_sender ||
                message.quote_info?.sender ||
                message.quote_sender_name ||
                '引用';

            // 引用头部
            const quoteHeader = document.createElement('div');
            quoteHeader.className = 'quote-header';
            quoteHeader.title = '被引用的消息';
            quoteHeader.innerHTML = `<i class="fas fa-quote-left"></i> <span class="quote-sender">${this.escapeHtml(senderName)}：</span>`;

            // 引用内容容器
            const quoteContent = document.createElement('div');
            quoteContent.className = 'quote-text';

            // 🔧 核心：根据消息类型动态渲染引用内容（支持图片/视频/语音/文件等）
            quoteContent.innerHTML = this.renderQuotedContent(
                message.quote_message_type || 'text',
                message.quote_message_type === 'file' ? message.quote_file_info?.name || message.quote_content || '' : message.quote_content || message.quote_info?.content || '',
                message.quote_file_info || message.quote_info || null,
                message.quote_message_id || message.quote_info?.id || null,
                message
            );

            quoteElement.appendChild(quoteHeader);
            quoteElement.appendChild(quoteContent);
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
            this.initNewChatModal();
        }
    }

    // ==================== 工作通知 ====================

    openNotifications() {
        // 更新侧边栏激活状态
        this.currentRoomId = null;
        document.querySelectorAll('.chat-item.cursor-pointer').forEach(function(el) { el.classList.remove('active'); });
        // 收起移动端侧边栏
        if (window.innerWidth <= 768) {
            document.querySelector('.sidebar').classList.remove('show');
        }

        // 设置聊天头
        document.getElementById('chatTitle').textContent = '工作通知';
        document.getElementById('chatStatus').textContent = '';
        document.getElementById('chatAvatar').src = '/media/avatars/work-notify.png';

        // 隐藏消息列表，显示通知容器
        document.getElementById('messagesList').style.display = 'none';
        document.getElementById('messagesEmpty').style.display = 'none';
        var notifContainer = document.getElementById('notificationMessages');
        if (!notifContainer) {
            notifContainer = document.createElement('div');
            notifContainer.className = 'messages-list';
            notifContainer.id = 'notificationMessages';
            notifContainer.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:15px;';
            document.getElementById('messagesContainer').appendChild(notifContainer);
        }
        notifContainer.style.display = 'flex';
        notifContainer.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-light);"><i class="fas fa-spinner fa-spin" style="font-size:32px;"></i><p style="margin-top:12px;">加载中...</p></div>';

        // 加载通知数据
        this._loadNotificationList();
    }

    async _loadNotificationList(filter) {
        if (filter === undefined) filter = this._notifFilter || '';
        this._notifFilter = filter;
        var container = document.getElementById('notificationMessages');
        if (!container) return;
        try {
            var url = '/api/oa/notifications/?page=1&page_size=50';
            if (filter) url += '&read_filter=' + filter;
            var resp = await fetch(url, { headers: TokenManager.getHeaders() });
            var raw = await resp.json();
            var data = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            var rows = data.results || [];

            var typeIcon2 = function(t) {
                var map = { 'approval': 'fa-check-double', 'attendance': 'fa-clock', 'task': 'fa-tasks', 'collab': 'fa-users', 'system': 'fa-bell' };
                return map[t] || 'fa-bell';
            };
            var typeColor2 = function(t) {
                var map = { 'approval': '#409eff', 'attendance': '#67c23a', 'task': '#e6a23c', 'collab': '#9b59b6', 'system': '#909399' };
                return map[t] || '#909399';
            };
            var formatTime2 = function(iso) {
                if (!iso) return '';
                var d = new Date(iso);
                var pad = function(n) { return String(n).padStart(2, '0'); };
                return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
            };
            var escapeHtml2 = function(text) {
                if (!text) return '';
                return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            };

            var filterBar = '<div style="display:flex;gap:0;padding:8px 16px;border-bottom:1px solid var(--border-color,#ebeef5);">'
                + '<button style="padding:4px 14px;border:1px solid var(--border-color,#dcdfe6);background:' + (filter === '' ? 'var(--primary-color,#409eff)' : '#fff') + ';color:' + (filter === '' ? '#fff' : 'var(--text-secondary,#606266)') + ';font-size:12px;cursor:pointer;border-radius:14px 0 0 14px;border-right:none;" onclick="chatClient._loadNotificationList(\'\')">全部</button>'
                + '<button style="padding:4px 14px;border:1px solid var(--border-color,#dcdfe6);background:' + (filter === 'unread' ? 'var(--primary-color,#409eff)' : '#fff') + ';color:' + (filter === 'unread' ? '#fff' : 'var(--text-secondary,#606266)') + ';font-size:12px;cursor:pointer;border-right:none;" onclick="chatClient._loadNotificationList(\'unread\')">未读</button>'
                + '<button style="padding:4px 14px;border:1px solid var(--border-color,#dcdfe6);background:' + (filter === 'read' ? 'var(--primary-color,#409eff)' : '#fff') + ';color:' + (filter === 'read' ? '#fff' : 'var(--text-secondary,#606266)') + ';font-size:12px;cursor:pointer;border-radius:0 14px 14px 0;" onclick="chatClient._loadNotificationList(\'read\')">已读</button>'
                + '</div>';

            if (!rows.length) {
                container.innerHTML = filterBar + '<div style="text-align:center;padding:60px 20px;color:var(--text-light);"><i class="fas fa-bell-slash" style="font-size:48px;opacity:0.4;"></i><p style="margin-top:12px;">暂无工作通知</p></div>';
                return;
            }

            var self = this;
            container.innerHTML = filterBar + rows.map(function(n) {
                var icon = typeIcon2(n.type);
                var color = typeColor2(n.type);
                var cls = n.is_read ? '' : 'notif-item-unread';
                var dotHtml = n.is_read ? '' : '<span style="position:absolute;top:20px;right:2px;width:8px;height:8px;border-radius:50%;background:#409eff;"></span>';
                var u = (n.related_url || '');
                var detailBtn = u ? '<span onclick="event.stopPropagation();chatClient._clickNotification(' + n.id + ',\'' + u + '\',' + (n.is_read ? 'true' : 'false') + ')" style="display:inline-block;margin-top:6px;padding:2px 10px;font-size:11px;color:var(--primary-color,#409eff);background:#ecf5ff;border-radius:4px;cursor:pointer;">查看详情 <i class="fas fa-arrow-right" style="font-size:10px;"></i></span>' : '';
                return '<div class="notif-chat-item ' + cls + '" onclick="chatClient._markNotifRead(' + n.id + ')" style="position:relative;display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border-color,#f0f0f0);cursor:pointer;transition:background 0.15s;">'
                    + '<div style="width:40px;height:40px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-size:16px;"><i class="fas ' + icon + '"></i></div>'
                    + '<div style="flex:1;min-width:0;">'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:14px;font-weight:' + (n.is_read ? '400' : '600') + ';color:var(--text-primary,#303133);">' + escapeHtml2(n.title) + '</span>'
                    + '<span style="font-size:11px;color:var(--text-light,#909399);flex-shrink:0;margin-left:8px;">' + formatTime2(n.created_at) + '</span></div>'
                    + '<div style="font-size:13px;color:var(--text-secondary,#606266);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + escapeHtml2(n.content) + '</div>' + detailBtn + '</div>' + dotHtml + '</div>';
            }).join('');
        } catch(e) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><i class="fas fa-exclamation-circle" style="font-size:36px;"></i><p style="margin-top:8px;">加载失败</p></div>';
        }
    }

    async _markNotifRead(id) {
        try {
            await fetch('/api/oa/notifications/' + id + '/mark-read/', { method: 'POST', headers: TokenManager.getHeaders() });
        } catch(e) {}
        if (window.WorkNotif && window.WorkNotif.refreshCount) {
            window.WorkNotif.refreshCount();
        }
    }

    async _clickNotification(id, url, isRead) {
        if (!isRead) {
            try {
                await fetch('/api/oa/notifications/' + id + '/mark-read/', {
                    method: 'POST', headers: TokenManager.getHeaders()
                });
            } catch(e) {}
            if (window.WorkNotif && window.WorkNotif.refreshCount) {
                window.WorkNotif.refreshCount();
            }
        }
        if (url) {
            window.location.href = url;
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
            <div class="user-list-item" data-user-id="${user.id}" onclick="chatClient.showUserProfile(${user.id})">
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

                // 🔧 修改：优先判断 @所有人，其次判断 @我
                const hasMentionAll = group.has_mention_all === true;
                const hasUnreadMention = group.has_unread_mention === true;
                let mentionHint = '';

                if (hasMentionAll) {
                    mentionHint = '<span class="mention-hint">[@所有人] </span> ';
                } else if (hasUnreadMention) {
                    mentionHint = '<span class="mention-hint">[有人@我] </span> ';
                }

                // 🔧 关键修复：群聊头像不添加输入指示器
                const avatarHtml = `<img src="${group.avatar || '/static/images/group-avatar.png'}" alt="${group.display_name}">`;


                html += `
                <div class="group-item" data-room-id="${group.id}" onclick="chatClient.selectChatRoom('${group.id}')">
                    <div class="group-avatar">
                         ${avatarHtml}
                    </div>
                    <div class="group-info">
                        <div class="group-title">${group.display_name}</div>
                        <div class="group-subtitle">${mentionHint}${lastMessageText || '暂无消息'}</div>
                    </div>
                    <div class="group-meta">
                        <div class="group-time">${lastMessage.timestamp ? Utils.formatLastmessageTimeStamp(lastMessage.timestamp) : ''}</div>
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

    closeSidebar() {
        console.log('Close sidebar')
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');

        if (sidebar) {
            sidebar.classList.remove('show');
            this.isShowingSidebar = false;

            // 🔧 关键修复：移动端显示输入区域
            this.toggleInputAreaVisibility(true);
        }


        if (overlay) {
            overlay.classList.remove('show');
        }
    }

    openSidebar() {
        console.log('Open sidebar')
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) {
            overlay.classList.toggle('show');
        }
    }


    // 显示侧边栏
    showSidebar() {
        console.log('Show sidebar');
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

        this.showSidebar();
        this.openSidebar();

    }


    // 🔧 新增：隐藏所有输入指示器
    hideAllTypingIndicators() {
        // 隐藏聊天列表中的指示器
        document.querySelectorAll('.chat-item-typing-indicator').forEach(el => {
            el.classList.remove('show');
        });

        // 隐藏聊天头部的指示器
        const headerIndicator = document.getElementById('chatHeaderTypingIndicator');
        if (headerIndicator) {
            headerIndicator.classList.remove('show');
        }
    }

    // 🔧 新增：初始化聊天头部的输入指示器
    initChatHeaderTypingIndicator() {
        const chatAvatar = document.getElementById('chatStatus');
        if (!chatAvatar) return;

        // 检查是否已有指示器
        if (document.getElementById('chatHeaderTypingIndicator')) return;

        // 创建包装器和指示器
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-header-avatar-wrapper';
        wrapper.id = 'chatHeaderAvatarWrapper';

        // 移动头像到包装器内
        chatAvatar.parentNode.insertBefore(wrapper, chatAvatar);
        wrapper.appendChild(chatAvatar);

        // 添加输入指示器
        const indicator = document.createElement('span');
        indicator.id = 'chatHeaderTypingIndicator';
        indicator.className = 'chat-header-typing-indicator';
        indicator.textContent = '对方正在输入...';
        wrapper.appendChild(indicator);
    }


    // 选择聊天室
    selectChatRoom(roomId) {
        console.log('选择聊天室 roomId:', roomId, ' this.currentRoomId: ', this.currentRoomId);

        // 隐藏通知消息列表（如果打开）
        var notifContainer = document.getElementById('notificationMessages');
        if (notifContainer) { notifContainer.style.display = 'none'; }

        // 🔧 新增：进入聊天室时清除未读@提及标记
        const targetRoom = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (targetRoom) {
            targetRoom.has_unread_mention = false;
            targetRoom.has_mention_all = false; // 🔧 同步清除 @所有人 标记
        }

        // 🔧 关键修复 1: 保存当前聊天室的草稿
        if (this.currentRoomId) {
            this.saveInputDraft(this.currentRoomId);
            this.renderChatRooms(); // ✅ 立即更新侧边栏状态

        }

        // 🔧 关键修复 2: 清除所有输入指示器
        this.hideAllTypingIndicators();

        // 清除引用
        this.clearQuoteMessage();
        this.clearMentions(roomId); // 🔧 切换聊天室时清空提及

        // 隐藏侧边栏
        if (this.isShowingSidebar) {
            this.closeSidebar();
        }


        // 连接新的 WebSocket（这会关闭旧的连接）
        this.connectWebSocket(roomId);


        // this.currentRoomId = roomId ? parseInt(roomId) : roomId;

        // 🔧 关键修复 3: 初始化聊天头部的输入指示器
        this.initChatHeaderTypingIndicator();

        // 🔧 关键修复 3: 恢复新聊天室的草稿
        this.restoreInputDraft(roomId);

        // 更新聊天室选中状态
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });

        const currentChatItem = document.querySelector(`.chat-item[data-room-id="${roomId}"]`);
        if (currentChatItem) {
            currentChatItem.classList.add('active');
        }

        // 重置无限滚动状态
        this.isInitialLoad = true;
        this.isLoadingMore = false;
        this.hasMoreMessages = true;
        this.oldestMessageId = null;
        this.newestMessageId = null;
        this.messages = []; // 清空当前消息列表

        //  移除旧的滚动监听器（防止重复绑定）
        this.removeInfiniteScrollListener();


        // 加载聊天历史（支持分页）
        this.loadChatHistory(roomId, {
            page_size: 50,
            append: false
        }).then(() => {

            // 更新聊天室未读数
            const chatItem = document.querySelector(`.chat-item[data-room-id="${roomId}"]`);
            if (chatItem) {
                const unreadCountElement = chatItem.querySelector('.chat-item-unread-count');
                if (unreadCountElement) {
                    unreadCountElement.remove();
                }
            }

            // 设置滚动监听器（无限滚动）
            this.setupInfiniteScroll();

            // 滚动到底部并标记已读, ✅ 保留这一处调用即可（内部已包含 markMessagesAsRead）
            // this.scrollToBottomAndMarkRead();

            // 初始化直达底部按钮（初始隐藏）
            this.initScrollToBottomButton();

            // 初始化时更新未读徽章
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

        // 滚动到底部
        Utils.scrollToBottom(messagesList);

        // 更新聊天头部
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        // console.log('this.currentUser:', this.currentUser)
        console.log('room:', room)
        console.log('roomId:', roomId, ' room_type: ', room?.room_type)
        // console.log('this.chatRooms:', this.chatRooms)


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
                const otherMember = room.members.find(m => m.id !== this.currentUser.id);
                if (otherMember) {
                    roomName = otherMember.real_name || otherMember.username || '未知用户';
                    roomAvatar = otherMember.avatar_url || '/static/images/default-avatar.png';
                    is_online = otherMember.online_status?.is_online;
                } else {
                    roomName = '未知用户';
                    roomAvatar = '/static/images/default-avatar.png';
                }
            } else {
                roomName = room.display_name || (room.members ? room.members.map(m => m.real_name || m.username).join(', ') : '未知群组');
                roomName = `${roomName} (${room.members ? room.members.length : 0})`
                roomAvatar = room.avatar || '/static/images/group-avatar.png';

                // 除自己以外如果有一个成员在线，则显示在线, 并统计在线成员人数
                let online_count = 0
                for (const member of room.members) {
                    if (member.online_status?.is_online) {
                        online_count++
                        if (member.id !== this.currentUser.id) {
                            is_online = true
                        }
                    }
                }
                console.log('room.members is_online: ', is_online, ' online_count: ', online_count)
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
    handleBackButtonClick() {
        console.log('返回按钮被点击');

        // 移动端：隐藏侧边栏并显示输入区域
        if (window.innerWidth <= 768) {
            if (this.isShowingSidebar) {
                this.closeSidebar();
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

        // 设置定期检查（每5分钟）
        console.log('⏱️ 设置定期版本检查（每5分钟）');
        setInterval(async () => {
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
        var idx = list.findIndex(function(i) { return i.url === imageUrl; });
        if (idx < 0) idx = 0;
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var pd = list.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="chatClient._chatPreviewClose()" style="position:fixed;top:20px;right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="chatClient._chatPreviewDir(-1)" id="chatPrev" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + pd + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="chatClient._chatPreviewDir(1)" id="chatNext" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + pd + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="chatMainImg" src="' + list[idx].url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);transition:opacity 0.15s;">'
            + '<div id="chatPageCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (idx + 1) + ' / ' + list.length + '</div>';
        document.body.appendChild(overlay);
        this._chatPreviewList = list;
        this._chatPreviewIdx = idx;
        this._chatOverlay = overlay;
        if (idx <= 0) { var p = document.getElementById('chatPrev'); if (p) p.style.opacity = '0.2'; }
        if (idx >= list.length - 1) { var n = document.getElementById('chatNext'); if (n) n.style.opacity = '0.2'; }
        var self = this;
        var kh = function(e) {
            if (e.key === 'ArrowLeft') { self._chatPreviewDir(-1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { self._chatPreviewDir(1); e.preventDefault(); }
            else if (e.key === 'Escape') { self._chatPreviewClose(); e.preventDefault(); }
        };
        this._chatKeyHandler = kh;
        document.addEventListener('keydown', kh);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) self._chatPreviewClose(); });
    }

    _chatPreviewDir(dir) {
        if (!this._chatPreviewList || !this._chatPreviewList.length) return;
        var len = this._chatPreviewList.length;
        if (dir < 0 && this._chatPreviewIdx <= 0) { this._chatShowTip('已是第一张'); return; }
        if (dir > 0 && this._chatPreviewIdx >= len - 1) { this._chatShowTip('已是最后一张'); return; }
        this._chatPreviewIdx += dir;
        var img = document.getElementById('chatMainImg');
        var item = this._chatPreviewList[this._chatPreviewIdx];
        if (img) { img.style.opacity = '0'; var self = this; setTimeout(function() { img.src = item.url; img.style.opacity = '1'; }, 100); }
        var ct = document.getElementById('chatPageCounter');
        if (ct) ct.textContent = (this._chatPreviewIdx + 1) + ' / ' + this._chatPreviewList.length;
        var p = document.getElementById('chatPrev');
        var n = document.getElementById('chatNext');
        if (p) { p.style.opacity = this._chatPreviewIdx <= 0 ? '0.2' : '1'; p.style.cursor = this._chatPreviewIdx <= 0 ? 'default' : 'pointer'; }
        if (n) { n.style.opacity = this._chatPreviewIdx >= this._chatPreviewList.length - 1 ? '0.2' : '1'; n.style.cursor = this._chatPreviewIdx >= this._chatPreviewList.length - 1 ? 'default' : 'pointer'; }
    }

    _chatPreviewClose() {
        if (this._chatKeyHandler) { document.removeEventListener('keydown', this._chatKeyHandler); this._chatKeyHandler = null; }
        if (this._chatOverlay) { this._chatOverlay.remove(); this._chatOverlay = null; }
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
        tip._t = setTimeout(function() { tip.style.opacity = '0'; }, 1500);
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

            // 保存通知设置
            const desktopNotifications = document.getElementById('desktopNotifications').checked;
            const soundNotifications = document.getElementById('soundNotifications').checked;
            const vibrateNotifications = document.getElementById('vibrateNotifications').checked;
            localStorage.setItem('desktopNotifications', desktopNotifications.toString());
            localStorage.setItem('soundNotifications', soundNotifications.toString());
            localStorage.setItem('vibrateNotifications', vibrateNotifications.toString());
            console.log('保存通知设置: ', desktopNotifications, soundNotifications, vibrateNotifications);


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
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
                // WebSocket 不可用时加入队列
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
    async clearChatHistory(targetRoomId) {
        const confirmed = await this.showConfirmDialog(
            '清空聊天记录',
            '确定要清空所有聊天记录吗？<br><small style="color: var(--text-light);">此操作不可恢复！</small>',
            'danger'
        );
        if (!confirmed) return;

        const roomId = parseInt(targetRoomId || this.currentRoomId)
        console.log('清空聊天记录 roomId: ', roomId, ' type: ', typeof roomId);

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
            } finally {

                if (this.ws) {
                    this.ws.close();
                }
                this.handleAuthError();
            }

        }
    }


    // 语音通话
    makeVoiceCall() {
        // this.showAlert('功能提示', '语音通话功能开发中...');
        this.initiateCall('audio');
    }

    // 视频通话
    makeVideoCall() {
        // this.showAlert('功能提示', '视频通话功能开发中...');
        this.initiateCall('video');
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
        if (Utils.isIOS() && this.isPWAStandaloneMode()) {
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

        console.log('currentQuoteMessage: ', this.currentQuoteMessage);

        // 显示引用预览
        const quotePreview = document.getElementById('quotePreview');
        const quoteSender = document.getElementById('quoteSender');
        const quoteContent = document.getElementById('quoteContent');

        if (quotePreview && quoteSender && quoteContent) {
            quotePreview.style.display = 'block';
            const tcData = message.task_data;
            if (tcData) {
                let qTaskTitle = '';
                let qTaskStatus = '';
                let qTaskAssignee = '';
                let qTaskStatusRaw = '';
                const qStatusMap = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};
                const qStatusColors = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
                qTaskTitle = tcData.title || tcData.task_title || content || '[任务卡片]';
                qTaskStatusRaw = tcData.status || '';
                qTaskStatus = qStatusMap[tcData.status] || '';
                qTaskAssignee = (tcData.assignee_info?.real_name || tcData.assignee_info?.username || tcData.assignee_name || '');

                const qStatusColor = qStatusColors[qTaskStatusRaw] || '#909399';
                if (qTaskTitle.length > 40) qTaskTitle = qTaskTitle.substring(0, 40) + '...';

                quoteSender.innerHTML = `<div class="quoted-file-link" style="padding: 6px 8px; border-left: 3px solid #409EFF; background: #f0f7ff; border-radius: 4px;"
                             >
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <i class="fas fa-tasks" style="color:#409EFF;font-size:12px;"></i>
                                <span style="font-weight:500;font-size:12px;color:#303133;">${qTaskTitle}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                                ${qTaskStatus ? `<span style="background:${qStatusColor};color:#fff;padding:1px 6px;border-radius:8px;">${qTaskStatus}</span>` : ''}
                                ${qTaskAssignee ? `<span><i class="fas fa-user-circle" style="margin-right:2px;"></i>${qTaskAssignee}</span>` : ''}
                                <i class="fas fa-location-arrow" style="margin-left:auto;color:#ccc;"></i>
                            </div>
                        </div>`;

            } else {
                quoteSender.textContent = `${message.sender?.real_name || message.sender?.username || message.sender_name || '未知用户'}：`
                quoteContent.textContent = message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '');
            }




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

    // 🔧 新增：清空提及状态
    clearMentions(roomId) {
        this.currentMentions.clear();
        this.mentionedAll = false;
        // 清空提及状态
        const chatItem = document.querySelector(`.chat-item[data-room-id="${roomId}"]`);
        if (chatItem) {
            const mentionHintElement = chatItem.querySelector('.mention-hint');
            if (mentionHintElement) {
                mentionHintElement.textContent = ''
            }
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


    // ==================== 右键菜单 ====================
    /**
     * 🔧 右键菜单设置
     */
    setupContextMenu() {

        console.log('contextTarget: ', this.contextTarget)

        // 在非回收站视图中，右键菜单显示下载和分享选项
        const menu = document.getElementById('contextMenu');
        if (menu) {
            // 基础菜单项
            let menuHtml = `
                <div class="menu-item" onclick="chatClient.quoteSelectedItem()"><i class="fas fa-quote-left"></i> 引用</div>
                <div class="menu-divider"></div>
                <div class="menu-item" onclick="chatClient.forwardSelectedItem()"><i class="fas fa-share"></i> 转发</div>
               
            `;
            // 🔧 新增：如果是文件/图片/视频/音频，添加保存到云盘
            if (this.contextTarget && this.contextTarget.file_info && this.contextTarget.file_info.id) {
                menuHtml += `
                    <div class="menu-divider"></div>
                    <div class="menu-item" onclick="chatClient.saveToCloud('${this.contextTarget.id}')">
                        <i class="fas fa-cloud-upload-alt"></i> 保存到云盘
                    </div>
                `;
                // 如果已在云盘且是文档，添加在线编辑
                if (this.contextTarget.cloud_file_id && this.isDocumentType(this.contextTarget.file_info.mime_type)) {
                    menuHtml += `
                        <div class="menu-item" onclick="chatClient.editCloudDoc('${this.contextTarget.cloud_file_id}')">
                            <i class="fas fa-edit"></i> 在线编辑
                        </div>
                    `;
                }
            }

            menu.innerHTML = menuHtml;

        }

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu') && !e.target.closest('.file-item, .file-grid-item')) {
                this.hideContextMenu();
            }
        });
    }


    handleContextMenu(e, message) {
        if (!message || message.is_deleted) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        // 🔧 保存类型信息
        this.contextTarget = message;
        const menu = document.getElementById('contextMenu');

        if (menu) {
            let menuHtml = `
            <div class="menu-item" onclick="chatClient.quoteSelectedItem()"><i class="fas fa-quote-left"></i> 引用</div>
            <div class="menu-item" onclick="chatClient.forwardSelectedItem()"><i class="fas fa-share"></i> 转发</div>
        `;

            // 🔧 新增：如果消息是文件且在云盘中，添加“在线编辑”和“保存到云盘”
            if (message.file_info && (message.message_type === 'file' || message.message_type === 'image' || message.message_type === 'video' || message.message_type === 'audio')) {
                if (message.cloud_file_id) {
                    menuHtml += `
                    <div class="menu-divider"></div>
                    <div class="menu-item" onclick="chatClient.editCloudDoc('${message.cloud_file_id}')">
                        <i class="fas fa-edit"></i> 在线编辑
                    </div>
                `;
                } else {
                    menuHtml += `
                    <div class="menu-divider"></div>
                    <div class="menu-item" onclick="chatClient.saveToCloud('${message.id}')">
                        <i class="fas fa-cloud-upload-alt"></i> 保存到云盘
                    </div>
                `;
                }
            }

            if (message.message_type !== 'task_card') {
                menuHtml += `
                    <div class="menu-divider"></div>
                    <div class="menu-item" onclick="chatClient.convertToTask(${message.id})">
                        <i class="fas fa-tasks"></i> 转为任务
                    </div>
                `;
            }



            menu.innerHTML = menuHtml;

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
     * 🔧 优雅的消息转任务模态框
     */
    async convertToTask(messageId) {
        const message = this.messages.find(m => m.id === messageId || m.message_id === messageId);
        if (!message) return;

        // 获取当前聊天室成员用于指派
        const room = this.chatRooms.find(r => r.id == this.currentRoomId);
        const members = room?.members || [];

        // 生成成员下拉选项，默认选中自己
        const memberOptions = members.map(m =>
            `<option value="${m.id}" ${m.id === this.currentUser.id ? 'selected' : ''}>${m.real_name || m.username}</option>`
        ).join('');

        // 移除可能存在的旧模态框
        const oldModal = document.getElementById('taskConvertModal');
        if (oldModal) oldModal.remove();

        const modalHtml = `
        <div class="modal show" id="taskConvertModal" style="z-index: 10000;">
            <div class="modal-content" style="max-width: 500px; animation: slideUp 0.3s ease;">
                <div class="modal-header">
                    <h3><i class="fas fa-tasks" style="color: var(--primary-color); margin-right: 8px;"></i> 消息转为任务</h3>
                    <button class="close-btn" onclick="chatClient.closeModal('taskConvertModal')">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                    <label>任务标题 <span style="color: var(--danger-color);">*</span></label>
                    <div class="input-with-icon">
                        <i class="fas fa-link"></i>
                        <input type="text" id="taskConvertTitle" class="form-control" value="${this.escapeHtml(message.content.substring(0, 50))}" placeholder="请输入任务标题">
                    </div>
                        
                        
                    </div>
                    <div class="form-group">
                        <label>任务描述</label>
                        <div class="input-with-icon">
                            <i class="fas fa-link"></i>
                            <textarea id="taskConvertDesc" class="form-control" rows="3" placeholder="任务详情...">${this.escapeHtml(message.content)}</textarea>
                        </div>
                    </div>
                    <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div class="form-group">
                            <label>指派给</label>
                            <select id="taskConvertAssignee" class="form-control" style="padding-left: 12px;">
                                <option value="">不指派</option>
                                ${memberOptions}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>截止日期</label>
                            <input type="datetime-local" id="taskConvertDueDate" class="form-control" style="padding-left: 12px;">
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px;">
                            <i class="fas fa-link" style="color: var(--primary-color);"></i> 
                            自动关联当前聊天上下文与原始消息
                        </label>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="chatClient.closeModal('taskConvertModal')">取消</button>
                    <button class="btn btn-primary" onclick="chatClient.submitConvertTask(${messageId})">
                        <i class="fas fa-plus-circle"></i> 创建任务
                    </button>
                </div>
            </div>
        </div>
    `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.hideContextMenu();
    }

    /**
     * 🔧 提交任务创建请求
     */
    async submitConvertTask(messageId) {
        const title = document.getElementById('taskConvertTitle').value.trim();
        const desc = document.getElementById('taskConvertDesc').value.trim();
        const assigneeId = document.getElementById('taskConvertAssignee').value;
        const dueDate = document.getElementById('taskConvertDueDate').value;

        if (!title) {
            this.showError('请输入任务标题');
            return;
        }

        const btn = document.querySelector('#taskConvertModal .btn-primary');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 创建中...';

        try {
            const response = await fetch('/api/tasks/', {
                method: 'POST',
                headers: {...TokenManager.getHeaders(), 'Content-Type': 'application/json'},
                body: JSON.stringify({
                    title: title,
                    description: desc,
                    assignee_id: assigneeId || null,
                    due_date: dueDate || null,
                    related_chat_room_id: this.currentRoomId, // 🔧 关联聊天室
                    related_message_id: messageId             // 🔧 关联原始消息
                })
            });

            if (response.ok) {
                this.showSuccess('任务创建成功', '已添加到任务中心并通知相关人员');
                this.closeModal('taskConvertModal');
            } else {
                const err = await response.json();
                this.showError('创建失败', err.detail || err.error || '未知错误');
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-plus-circle"></i> 创建任务';
            }
        } catch (error) {
            this.showError('网络错误', error.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> 创建任务';
        }
    }

    forwardSelectedItem() {
        if (this.contextTarget) {
            const message = this.contextTarget;
            this.showForwardModal(message);
        }
        this.hideContextMenu();
    }

    quoteSelectedItem() {
        if (this.contextTarget) {
            const message = this.contextTarget;
            this.setQuoteMessage(message);
        }
        this.hideContextMenu();
    }


    /**
     * 🔧 右键菜单删除
     */
    deleteSelectedItem() {
        if (this.contextTarget) {
            const message = this.contextTarget;
            this.deleteMessage(message);
        }
        this.hideContextMenu();
    }

    deleteMessage(message) {
        console.log("delete message: ", message)
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
            atPanel.style.bottom = `150px`;
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

        // 🔧 新增：@所有人 选项（始终置顶）
        html += `
            <div class="at-member-item at-all-item" data-user-id="all" data-username="所有人">
                <img src="/static/images/group-avatar.png" alt="所有人">
                <div class="at-member-info">
                    <div class="at-member-name">所有人</div>
                    <div class="at-member-username">@所有人</div>
                </div>
            </div>
        `;

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

                // 🔧 修复：处理 @所有人
                if (userId === 'all') {
                    const messageInput = document.getElementById('messageInput');
                    const start = messageInput.selectionStart;
                    const end = messageInput.selectionEnd; // ✅ 正确定义 end 变量
                    const currentValue = messageInput.value;

                    messageInput.value = currentValue.substring(0, start) + `所有人 ` + currentValue.substring(end);
                    messageInput.setSelectionRange(start + 4, start + 4); // 4 为 "所有人 " 的长度
                    messageInput.focus();
                    this.mentionedAll = true
                    this.closeAtPanel();
                    return;
                }

                // 处理普通用户 @
                // 🔧 传递 userId 给 insertAtMention
                this.insertAtMention(username, userId);
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
    insertAtMention(username, userId) {
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

        // 🔧 关键：记录被提及的用户ID（防止重复）
        if (userId) this.currentMentions.add(userId);

        // 关闭@面板
        this.closeAtPanel();
    }


    // 初始化语音消息功能
    initVoiceMessage() {
        const voiceBtn = document.getElementById('voiceBtn');
        const voiceRecorderOverlay = document.getElementById('voiceRecorderOverlay');
        const voiceRecorderSendBtn = document.getElementById('voiceRecorderSendBtn');
        const voiceRecorderBackdrop = document.querySelector('.voice-recorder-backdrop');

        if (!voiceBtn || !voiceRecorderOverlay || !voiceRecorderBackdrop) return;

        // 检查浏览器支持
        const isVoiceSupported =
            navigator.mediaDevices &&
            navigator.mediaDevices.getUserMedia &&
            window.MediaRecorder &&
            (location.protocol === 'https:' ||
                location.hostname === 'localhost' ||
                location.hostname === '127.0.0.1');

        if (!isVoiceSupported) {
            voiceBtn.style.display = 'none';
            console.warn('语音消息功能不可用');
            return;
        }

        // 🔧 关键修复：电脑端和移动端统一使用录音界面
        voiceBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isRecording) {
                // 正在录音，停止并发送
                this.stopRecording();
            } else {
                // 未录音，开始录音
                this.startRecording();
            }
        });

        // 🔧 关键修复：移动端长按录音（保留原有交互）
        if (Utils.isMobile()) {
            let touchStartY = 0;
            let isLongPress = false;
            let longPressTimer = null;

            voiceBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                touchStartY = e.touches[0].clientY;
                voiceBtn.classList.add('recording');
                document.querySelector('.voice-btn-text').style.display = 'none';
                document.querySelector('.voice-btn-recording-text').style.display = 'block';

                // 长按200ms开始录音
                longPressTimer = setTimeout(() => {
                    isLongPress = true;
                    this.startRecording();
                }, 200);
            });

            voiceBtn.addEventListener('touchmove', (e) => {
                if (!this.isRecording || !isLongPress) return;

                e.preventDefault();
                const touchY = e.touches[0].clientY;
                const diffY = touchStartY - touchY;

                // 上滑超过50px取消录音
                if (diffY > 50 && !this.isCancelling) {
                    this.isCancelling = true;
                    voiceRecorderOverlay.classList.add('cancelling');
                } else if (diffY <= 50 && this.isCancelling) {
                    this.isCancelling = false;
                    voiceRecorderOverlay.classList.remove('cancelling');
                }
            });

            voiceBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                clearTimeout(longPressTimer);
                voiceBtn.classList.remove('recording');
                document.querySelector('.voice-btn-text').style.display = 'block';
                document.querySelector('.voice-btn-recording-text').style.display = 'none';

                if (!isLongPress) return;
                isLongPress = false;

                if (this.isCancelling) {
                    this.cancelRecording();
                } else if (this.isRecording) {
                    this.stopRecording(); // 松开手指停止并发送
                }
            });
        }

        // 点击覆盖层背景取消录音
        voiceRecorderBackdrop.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.isRecording && !this.isCancelling) {
                this.cancelRecording();
            }
        });

        // 点击发送按钮停止并发送（电脑端）
        if (voiceRecorderSendBtn) {
            voiceRecorderSendBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isRecording) {
                    this.stopRecording();
                }
            });
        }

        // 点击取消区域取消录音
        const cancelArea = document.querySelector('.voice-recorder-cancel-area');
        if (cancelArea) {
            cancelArea.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isRecording) {
                    this.cancelRecording();
                }
            });
        }
    }

    // 录音开始震动反馈
    startRecordingVibration() {
        if ('vibrate' in navigator && Utils.isMobile()) {
            navigator.vibrate([50, 30, 50]); // 短-短-短震动
        }
    }

    // 录音结束震动反馈
    stopRecordingVibration() {
        if ('vibrate' in navigator && Utils.isMobile()) {
            navigator.vibrate(100); // 长震动
        }
    }


    // 开始录音
    async startRecording() {
        if (this.isRecording) return;

        // 检查浏览器支持（双重检查）
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showError('浏览器不支持录音功能');
            return;
        }

        if (location.protocol !== 'https:' &&
            location.hostname !== 'localhost' &&
            location.hostname !== '127.0.0.1') {
            this.showError('录音功能需要在 HTTPS 环境下使用');
            return;
        }

        if (!window.MediaRecorder) {
            this.showError('浏览器不支持录音功能');
            return;
        }

        try {
            // 🔧 关键修复：电脑端和移动端使用不同的采样率
            const isMobile = Utils.isMobile();
            const isIOS = Utils.isIOS();
            const isAndroid = Utils.isAndroid();

            // 音频约束（移动端使用 44.1kHz 采样率）
            const audioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: isMobile ? 44100 : 48000
            };


            // 请求麦克风权限
            this.audioStream = await navigator.mediaDevices.getUserMedia({audio: audioConstraints});

            // 智能选择 MIME 类型（iOS 优先 AAC/MP4）
            let mimeType = '';
            const supportedTypes = MediaRecorder.isTypeSupported.bind(MediaRecorder);

            // iOS 优先选择 AAC/MP3
            if (isIOS) {
                // iOS 推荐格式：audio/mp4 (AAC) 或 audio/mpeg
                const iosTypes = [
                    'audio/mp4;codecs=mp4a.40.2',  // AAC-LC (最兼容)
                    'audio/mp4;codecs=mp4a.40.5',  // HE-AAC
                    'audio/mpeg',                   // MP3
                    'audio/x-m4a'                   // Apple 专用
                    // 'audio/webm;codecs=opus'           // 降级
                ];
                for (const type of iosTypes) {
                    if (supportedTypes(type)) {
                        mimeType = type;
                        break;
                    }
                }
                console.log('iOS 最终 mimeType:', mimeType || '默认');
                // this.showSuccess('iOS 检测到的 mimeType: ' + (mimeType || '默认'));
            }
            // Android 优先 WebM (Opus)
            else if (isAndroid) {
                // 安卓端支持的音频格式
                const androidTypes = [
                    'audio/mpeg',
                    'audio/webm;codecs=opus',
                    'audio/webm'
                ];
                for (const type2 of androidTypes) {
                    if (supportedTypes(type2)) {
                        mimeType = type2;
                        break;
                    }
                }
                console.log('Android 检测到的 mimeType:', mimeType || '默认');
                // this.showSuccess('Android 检测到的 mimeType: ' + (mimeType || '默认'));
            }
            // 桌面端优先 WebM (Opus)
            else {
                const desktopTypes = [
                    'audio/mpeg',
                    'audio/webm;codecs=opus',
                    'audio/webm'
                ];
                for (const type3 of desktopTypes) {
                    if (supportedTypes(type3)) {
                        mimeType = type3
                        break
                    }
                }
                console.log('桌面检测到的 mimeType:', mimeType || '默认');
                // this.showSuccess('桌面检测到的 mimeType: ' + (mimeType || '默认'));
            }


            // 创建 MediaRecorder
            const options = {
                audioBitsPerSecond: isMobile ? 128000 : 256000 // 移动端降低比特率
            };

            if (mimeType) options.mimeType = mimeType;

            this.mediaRecorder = new MediaRecorder(this.audioStream, options);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this.audioStream.getTracks().forEach(track => track.stop());
            };

            // 🔧 关键修复：开始录音前确保录音界面已准备好
            this.showRecordingOverlay();

            // 开始录音
            this.mediaRecorder.start(100);
            this.isRecording = true;
            this.isCancelling = false;
            this.recordingStartTime = Date.now();

            // 移动端震动反馈
            this.startRecordingVibration();


            // 更新录音时间
            this.updateRecordingTime();

            // 🔧 关键修复：使用实例变量设置最大录音时间
            setTimeout(() => {
                if (this.isRecording) {
                    this.stopRecording();
                }
            }, this.voiceMaxDuration * 1000);

        } catch (error) {
            console.error('录音失败:', error);

            let errorMessage = '录音失败';
            if (error.name === 'NotAllowedError') {
                errorMessage = '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风';
            } else if (error.name === 'NotFoundError') {
                errorMessage = '未检测到麦克风设备，请检查设备连接';
            } else if (error.name === 'NotReadableError') {
                errorMessage = '麦克风正被其他应用占用，请关闭其他使用麦克风的程序';
            } else if (error.name === 'OverconstrainedError') {
                errorMessage = '麦克风配置错误，请检查设备设置';
            } else if (error.message && error.message.includes('mimeType')) {
                errorMessage = '浏览器不支持该音频格式，请尝试更新浏览器';
            } else {
                errorMessage = error.message || '请检查麦克风权限和设备连接';
            }

            this.showError('录音失败: ' + errorMessage);
            this.isRecording = false;

            // 隐藏录音界面
            this.hideRecordingOverlay();
        }
    }

    // 显示录音界面
    showRecordingOverlay() {
        const voiceRecorderOverlay = document.getElementById('voiceRecorderOverlay');
        if (!voiceRecorderOverlay) return;

        voiceRecorderOverlay.style.display = 'flex';
        setTimeout(() => {
            voiceRecorderOverlay.style.opacity = '1';
            const panel = voiceRecorderOverlay.querySelector('.voice-recorder-panel');
            if (panel) {
                panel.style.transform = 'scale(1)';
            }
        }, 10);

        // 🔧 关键修复：电脑端禁用页面滚动
        if (!Utils.isMobile()) {
            document.body.style.overflow = 'hidden';
        }
    }

    // 隐藏录音界面
    hideRecordingOverlay() {
        const voiceRecorderOverlay = document.getElementById('voiceRecorderOverlay');
        if (!voiceRecorderOverlay) return;

        voiceRecorderOverlay.style.opacity = '0';
        const panel = voiceRecorderOverlay.querySelector('.voice-recorder-panel');
        if (panel) {
            panel.style.transform = 'scale(0.9)';
        }

        setTimeout(() => {
            voiceRecorderOverlay.style.display = 'none';

            // 🔧 关键修复：恢复页面滚动
            document.body.style.overflow = '';
        }, 200);
    }

    // 停止录音
    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) return;

        console.log('停止录音')

        this.mediaRecorder.stop();
        this.isRecording = false;

        // 隐藏录音界面
        const voiceRecorderOverlay = document.getElementById('voiceRecorderOverlay');
        if (voiceRecorderOverlay) {
            voiceRecorderOverlay.style.opacity = '0';
            voiceRecorderOverlay.querySelector('.voice-recorder-panel').style.transform = 'scale(0.9)';
            setTimeout(() => {
                voiceRecorderOverlay.style.display = 'none';
            }, 200);
        }

        // 清除定时器
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }

        // 🔧 移动端震动反馈
        if (Utils.isMobile()) {
            this.stopRecordingVibration();
        }

        // 检查录音时长（至少1秒）
        const recordingDuration = Date.now() - this.recordingStartTime;
        if (recordingDuration < this.voiceMinDuration * 1000) {
            console.log(`录音时间太短，请至少录制${this.voiceMinDuration}秒`);
            this.showError(`录音时间太短，请至少录制${this.voiceMinDuration}秒`);
            this.audioChunks = [];
            return;
        }

        // 发送语音消息
        if (this.audioChunks.length > 0) {
            console.log('发送语音消息')
            this.sendVoiceMessage();
        } else {
            console.log('没有录音数据')
        }
    }

    // 取消录音
    cancelRecording() {
        if (!this.isRecording) return;

        console.log('取消录音')


        this.isRecording = false;
        this.isCancelling = false;
        this.mediaRecorder.stop();
        this.audioStream.getTracks().forEach(track => track.stop());

        // 隐藏录音界面
        const voiceRecorderOverlay = document.getElementById('voiceRecorderOverlay');
        if (voiceRecorderOverlay) {
            voiceRecorderOverlay.classList.remove('cancelling');
            voiceRecorderOverlay.style.opacity = '0';
            voiceRecorderOverlay.querySelector('.voice-recorder-panel').style.transform = 'scale(0.9)';
            setTimeout(() => {
                voiceRecorderOverlay.style.display = 'none';
            }, 200);
        }

        // 清除定时器
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }

        // 清空录音数据
        this.audioChunks = [];

        // 显示取消提示
        this.showToast('已取消录音', 'info');
    }

    // 更新录音时间
    updateRecordingTime() {
        if (!this.isRecording) return;

        const voiceRecorderTime = document.getElementById('voiceRecorderTime');
        if (!voiceRecorderTime) return;

        const elapsed = Date.now() - this.recordingStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const displaySeconds = (seconds % 60).toString().padStart(2, '0');
        const displayMinutes = minutes.toString().padStart(2, '0');

        voiceRecorderTime.textContent = `${displayMinutes}:${displaySeconds}`;

        this.recordingTimer = setTimeout(() => this.updateRecordingTime(), 100);
    }

    // 发送语音消息（添加 iOS 兼容标记）
    async sendVoiceMessage(targetRoomId = null) {
        const roomId = parseInt(targetRoomId || this.currentRoomId)

        if (!roomId) {
            console.error('请先选择一个聊天对象')
            this.showError('请先选择一个聊天对象');
            return;
        }

        if (this.audioChunks.length === 0) {
            console.error('录音内容为空');
            this.showError('录音内容为空');
            return;
        }

        // 创建音频文件
        const audioBlob = new Blob(this.audioChunks, {type: this.mediaRecorder.mimeType || 'audio/webm'});
        console.log('创建音频文件成功')

        // 限制最小录音时长（1秒）
        if (audioBlob.size < 5000) {
            console.error('录音时间太短，请至少录制1秒');
            this.showError('录音时间太短，请至少录制1秒');
            return;
        }

        // 🔧 关键修复：根据设备类型设置文件扩展名
        const isIOS = Utils.isIOS();
        const isAndroid = Utils.isAndroid();

        const extension = isIOS ? 'm4a' : isAndroid ? 'mp3' : 'webm';
        const mimeType = isIOS ? 'audio/mp4' : (this.mediaRecorder.mimeType || 'audio/webm');

        const audioFile = new File([audioBlob], `voice_${Date.now()}.${extension}`, {
            type: mimeType,
            lastModified: Date.now()
        });

        // 显示上传中消息
        const tempMessageId = Date.now();
        const uploadingMessage = {
            id: tempMessageId,
            temp_id: tempMessageId,
            uploading_id: tempMessageId,
            sender_id: this.currentUser.id,
            sender_name: this.currentUser.username,
            sender: this.currentUser,
            content: '正在上传语音...',
            timestamp: new Date().toISOString(),
            is_read: true,
            chat_room: parseInt(roomId),
            message_type: 'voice',
            file_info: {
                name: audioFile.name,
                size: audioFile.size,
                url: '/static/images/uploading.gif',
                mime_type: audioFile.type,
                is_ios_compatible: isIOS,  // 🔧 标记是否为 iOS 兼容格式
                is_android_compatible: isAndroid // 标记是否为 android 兼容格式
            },
            is_temp: true
        };

        this.messages.push(uploadingMessage);
        this.renderMessage(uploadingMessage, 'sent');
        Utils.scrollToBottom(document.getElementById('messagesList'));

        try {
            // 上传文件
            const uploadResult = await API.uploadFile(audioFile);

            // 通过 WebSocket 发送
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const wsMessage = {
                    type: 'chat_message',
                    content: '[语音]',
                    message_type: 'voice',
                    chat_room: parseInt(roomId),
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    temp_id: tempMessageId,
                    // 🔧 传递设备信息以便后端转码
                    device_info: {
                        is_ios: isIOS,
                        is_android: Utils.isAndroid(),
                        user_agent: navigator.userAgent
                    }
                };

                this.ws.send(JSON.stringify(wsMessage));
                console.log('通过 WebSocket 发送语音成功')
            } else {
                // WebSocket 不可用时加入队列
                this.messageQueue.push({
                    content: '[语音]',
                    message_type: 'voice',
                    chat_room: parseInt(roomId),
                    file_id: uploadResult?.file_id || uploadResult?.id,
                    temp_id: tempMessageId,
                    device_info: {
                        is_ios: isIOS,
                        is_android: Utils.isAndroid(),
                        user_agent: navigator.userAgent
                    }
                });
                this.showError('网络连接不稳定，消息将在连接恢复后发送');
            }

            // 本地预更新聊天室最后一条消息
            this.updateChatRoomLastMessage(parseInt(roomId), '[语音消息]', uploadingMessage.timestamp);

        } catch (error) {
            console.error('发送语音消息失败:', error);
            this.showError('发送语音消息失败: ' + (error.message || '未知错误'));

            // 删除上传中的消息
            this.messages = this.messages.filter(msg => msg.temp_id !== tempMessageId);
            this.renderChatHistory();
        }
    }


    // 渲染语音消息
    renderVoiceMessage(message, container) {
        const template = document.getElementById('voiceMessageTemplate');
        if (!template) return;

        const voiceElement = template.content.cloneNode(true).firstElementChild;
        voiceElement.dataset.messageId = message.id || message.message_id;

        // 设置语音时长
        const durationElement = voiceElement.querySelector('.voice-duration');
        let duration = 0;

        // 1. 优先使用 message.voice_duration（来自Message模型）
        if (message.voice_duration) {
            duration = Math.min(Math.floor(message.voice_duration), 59);
        }
        // 2. 其次使用 file_info.duration（来自FileUpload模型）
        else if (message.file_info?.duration) {
            duration = Math.min(Math.floor(message.file_info.duration), 59);
        }
        // 3. 最后使用估算（兼容旧数据）
        else if (message.file_info?.size) {
            // 估算：每8KB约1秒（降低比特率后）
            duration = Math.min(Math.max(Math.floor(message.file_info.size / 8000), 1), 59);
        } else {
            duration = 5;
        }

        console.log('语音精确时长:', duration, '秒 (来源:',
            message.voice_duration ? 'message.voice_duration' :
                (message.file_info?.duration ? 'file_info.duration' : '估算'), ')');

        durationElement.textContent = `${duration}"`;

        // 🔧 关键修复：智能选择音频源（优先 iOS 兼容格式）
        const audioElement = voiceElement.querySelector('.voice-audio');
        if (message.file_info?.url) {
            let audioUrl = message.file_info.url;

            // 检测设备类型
            const isIOS = Utils.isIOS();
            const isMobible = Utils.isMobile();
            const isAndroid = Utils.isAndroid();

            // OS 设备优先使用 MP3 格式（如果后端已提供）
            if (isIOS && message.file_info?.mp3_url) {
                audioUrl = message.file_info.mp3_url;
                console.log('iOS设备使用MP3格式');
            }
            // iOS 设备但只有 WebM，尝试请求 MP3 格式（触发后端转码）
            else if (isMobible && audioUrl.includes('.webm')) {
                // 🔧 关键修复2: 正确获取 file_id（优先使用 message.file_id）
                const fileId = message.file_info?.file_id || message.file_info?.id || message.file_id;

                if (fileId) {
                    // 尝试获取 MP3 格式
                    // 构建查询参数
                    const params = new URLSearchParams({
                        format: 'mp3'
                    });
                    const mp3CheckUrl = `/api/chat/audio/${fileId}/format/`;
                    console.log('尝试获取 MP3 格式:', mp3CheckUrl);

                    fetch(mp3CheckUrl, {
                        headers: TokenManager.getHeaders()
                    })
                        .then(response => {
                            if (!response.ok) {
                                console.error('获取 MP3 状态失败:', response.status);
                                console.error('获取 MP3 状态失败response:', response);
                                // this.showError('获取 MP3 失败:' + response);
                                throw new Error(`HTTP ${response.status}`);
                            }
                            return response.json();
                        })
                        .then(data => {
                            console.log('MP3 格式检查结果:', data);

                            if (data.is_ready && data.url) {
                                // 转码已完成，更新音频源
                                audioUrl = data.url + `?t=${Date.now()}`;
                                audioElement.src = audioUrl;
                                console.log('iOS 设备获取到 MP3 格式:', audioUrl);
                            } else if (data.converting) {
                                // 转码中，保持原始 URL，稍后重试
                                console.log('MP3 格式转换中，稍后重试...');
                                setTimeout(() => {
                                    // 5秒后重试
                                    fetch(mp3CheckUrl, {
                                        headers: TokenManager.getHeaders()
                                    })
                                        .then(response => response.json())
                                        .then(data => {
                                            if (data.is_ready && data.url) {
                                                audioElement.src = data.url + `?t=${Date.now()}`;
                                                console.log('重试成功，使用 MP3 格式:', data.url);
                                            }
                                        })
                                        .catch(err => {
                                            console.warn('重试获取 MP3 失败:', err);
                                        });
                                }, 5000);
                            }
                        })
                        .catch(err => {
                            console.warn('MP3 格式检查失败:', err);
                            // 保持原始 URL，让用户尝试播放（部分 iOS 版本可能支持）
                        });
                } else {
                    console.warn('无法获取 file_id，无法请求 MP3 格式');
                }

            }

            // 添加时间戳防止缓存
            audioUrl = audioUrl.includes('?')
                ? `${audioUrl}&t=${Date.now()}`
                : `${audioUrl}?t=${Date.now()}`;

            audioElement.src = audioUrl;
            audioElement.crossOrigin = 'anonymous'; // 处理跨域

            // iOS 必需属性
            if (isIOS) {
                audioElement.setAttribute('playsinline', 'playsinline');
                audioElement.setAttribute('webkit-playsinline', 'webkit-playsinline');
            }

            // 🔧 关键修复：监听音频事件更新 UI
            audioElement.addEventListener('play', () => {
                const playBtn = voiceElement.querySelector('.voice-play-btn');
                if (playBtn) {
                    playBtn.classList.add('playing');
                    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    playBtn.title = '点击暂停';
                }
            });

            audioElement.addEventListener('pause', () => {
                const playBtn = voiceElement.querySelector('.voice-play-btn');
                if (playBtn) {
                    playBtn.classList.remove('playing');
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                    playBtn.title = '点击播放';
                }
            });

            audioElement.addEventListener('ended', () => {
                // 播放结束自动重置
                const playBtn = voiceElement.querySelector('.voice-play-btn');
                const progressBar = voiceElement.querySelector('.voice-progress-bar');
                if (playBtn) {
                    playBtn.classList.remove('playing');
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                    playBtn.title = '点击播放';
                }
                if (progressBar) {
                    progressBar.style.width = '0%';
                }
                audioElement.currentTime = 0;
            });

            // 更新进度条
            audioElement.addEventListener('timeupdate', () => {
                if (audioElement.duration) {
                    const progress = (audioElement.currentTime / audioElement.duration) * 100;
                    const progressBar = voiceElement.querySelector('.voice-progress-bar');
                    if (progressBar) {
                        progressBar.style.width = `${Math.min(progress, 100)}%`;
                    }
                }
            });

            // 🔧 关键修复3: 添加 canplaythrough 事件确保音频可播放
            audioElement.addEventListener('canplaythrough', () => {
                console.log('音频已准备好');
            }, {once: true});

            // 🔧 错误处理（详细日志 + 降级方案）
            audioElement.addEventListener('error', (e) => {
                const error = audioElement.error;
                let errorMsg = '未知错误';
                if (error) {
                    switch (error.code) {
                        case MediaError.MEDIA_ERR_ABORTED:
                            errorMsg = '加载中止';
                            break;
                        case MediaError.MEDIA_ERR_NETWORK:
                            errorMsg = '网络错误';
                            break;
                        case MediaError.MEDIA_ERR_DECODE:
                            errorMsg = '解码失败';
                            break;
                        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                            errorMsg = '不支持的音频格式';
                            break;
                    }
                }

                console.error('音频加载错误:', errorMsg, {
                    src: audioElement.src,
                    networkState: audioElement.networkState,
                    readyState: audioElement.readyState,
                    error: error?.code
                });


                // 智能降级提示
                if (isIOS && audioUrl.includes('.webm')) {
                    this.showToast(`iOS 不支持 WebM 格式，建议发送方重发语音: ${errorMsg}`, 'error');
                } else if (isAndroid && audioUrl.includes('.webm')) {
                    this.showToast(`Android 不支持 WebM 格式，建议发送方重发语音: ${errorMsg}`, 'error');
                } else {
                    console.log('音频播放失败: ', errorMsg)
                    // this.showToast(`音频播放失败: ${errorMsg}`, 'error');
                }

                // 🔧 降级方案：提供下载链接
                this.offerAudioDownload(message);

                // 可选：在 UI 上显示错误提示
                const playBtn = voiceElement.querySelector('.voice-play-btn');
                if (playBtn) playBtn.title = `播放失败: ${errorMsg}`;

                // 尝试重新加载
                // setTimeout(() => {
                //     audioElement.load();
                // }, 500);
            });

            // 🔧 关键修复5: iOS 特殊处理 - 添加 loadedmetadata 事件
            if (Utils.isIOS()) {
                audioElement.addEventListener('loadedmetadata', () => {
                    console.log('iOS: 音频元数据已加载');
                }, {once: true});
            }
        }


        // 播放按钮事件
        const playBtn = voiceElement.querySelector('.voice-play-btn');
        if (playBtn) {
            playBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleVoicePlay(voiceElement, audioElement, playBtn, message);
            };

            // 添加点击反馈动画
            playBtn.addEventListener('touchstart', () => {
                playBtn.style.transform = 'scale(0.95)';
            });
            playBtn.addEventListener('touchend', () => {
                playBtn.style.transform = '';
            });
        }

        // // 进度和结束事件...
        // audioElement.ontimeupdate = () => {
        //     if (audioElement.duration) {
        //         const progress = (audioElement.currentTime / audioElement.duration) * 100;
        //         const progressBar = voiceElement.querySelector('.voice-progress-bar');
        //         if (progressBar) {
        //             progressBar.style.width = `${progress}%`;
        //         }
        //     }
        // };
        //
        // // 播放结束
        // audioElement.onended = () => {
        //     playBtn.classList.remove('playing');
        //     const progressBar = voiceElement.querySelector('.voice-progress-bar');
        //     if (progressBar) {
        //         progressBar.style.width = '0%';
        //     }
        // };

        container.appendChild(voiceElement);
    }


    // 🔧 修复：切换语音播放/暂停（支持点击切换）
    toggleVoicePlay(voiceElement, audioElement, playBtn, message) {
        const messageId = voiceElement.dataset.messageId;

        // 🔧 关键修复1: 如果当前音频正在播放，则暂停
        if (!audioElement.paused) {
            audioElement.pause();
            // 状态会在 pause 事件中自动更新
            return;
        }

        // 🔧 关键修复2: 暂停其他所有正在播放的语音
        this.voicePlayers.forEach((player, key) => {
            if (player !== audioElement && !player.paused) {
                player.pause();
                // 更新其他语音的按钮状态
                const otherVoiceEl = document.querySelector(`.message-voice[data-message-id="${key}"]`);
                if (otherVoiceEl) {
                    const otherBtn = otherVoiceEl.querySelector('.voice-play-btn');
                    const otherProgress = otherVoiceEl.querySelector('.voice-progress-bar');
                    if (otherBtn) {
                        otherBtn.classList.remove('playing');
                        otherBtn.innerHTML = '<i class="fas fa-play"></i>';
                        otherBtn.title = '点击播放';
                    }
                    if (otherProgress) {
                        otherProgress.style.width = '0%';
                    }
                }
            }
        });

        // 🔧 关键修复3: 确保音频已加载元数据后再播放
        const attemptPlay = () => {
            // 移动端确保音频上下文已恢复
            if (Utils.isMobile() && this.audioContextForMobile) {
                if (this.audioContextForMobile.state === 'suspended') {
                    this.audioContextForMobile.resume().catch(console.warn);
                }
            }

            audioElement.play().then(() => {
                // 播放成功，状态会在 play 事件中更新
                // 保存当前播放的音频引用
                this.voicePlayers.set(messageId, audioElement);
            }).catch(err => {
                console.error('播放失败:', err);

                // 根据错误类型给出友好提示
                if (err.name === 'NotAllowedError') {
                    this.showToast('请先与页面交互后再试', 'error');
                } else if (err.name === 'NotSupportedError') {
                    this.showToast('您的设备不支持此音频格式', 'error');
                    this.offerAudioDownload(message);
                } else {
                    // 尝试重新加载后播放
                    audioElement.load();
                    setTimeout(() => {
                        audioElement.play().catch(e => {
                            console.error('重试播放失败:', e);
                            this.showToast('播放失败，请检查网络', 'error');
                        });
                    }, 500);
                }
            });
        };

        // 智能加载策略
        if (audioElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
            attemptPlay();
        } else {
            audioElement.addEventListener('loadedmetadata', attemptPlay, {once: true});
            audioElement.load();

            // 超时处理
            setTimeout(() => {
                audioElement.removeEventListener('loadedmetadata', attemptPlay);
                attemptPlay();
            }, 3000);
        }
    }


    // 🔧 新增：提供音频下载（降级方案）
    offerAudioDownload(message) {
        if (!message.file_info?.url) return;
        console.log('offerAudioDownload', message.file_info?.url);
        // return

        // 创建下载按钮
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'voice-download-btn';
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> 下载音频';
        downloadBtn.onclick = (e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = message.file_info.url;
            link.download = `voice_${Date.now()}.${message.file_info.url.split('.').pop() || 'mp3'}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            downloadBtn.remove();
        };

        // 添加到语音消息容器
        const container = downloadBtn.closest('.message-content') || downloadBtn.parentElement;
        if (container) {
            container.appendChild(downloadBtn);
        }
    }


    // 初始化音频上下文（用于移动端播放）
    initAudioContextForMobile() {
        if (this.audioContextForMobile) return;

        try {
            // 创建音频上下文（用于移动端播放）
            this.audioContextForMobile = new (window.AudioContext || window.webkitAudioContext)();

            // 尝试恢复（需要用户手势）
            const resumeAudio = () => {
                if (this.audioContextForMobile && this.audioContextForMobile.state === 'suspended') {
                    this.audioContextForMobile.resume().catch(err => {
                        console.warn('AudioContext resume failed:', err);
                    });
                }
                document.removeEventListener('touchstart', resumeAudio);
                document.removeEventListener('click', resumeAudio);
            };

            document.addEventListener('touchstart', resumeAudio, {once: true});
            document.addEventListener('click', resumeAudio, {once: true});
        } catch (e) {
            console.warn('Failed to create AudioContext for mobile:', e);
            this.audioContextForMobile = null;
        }
    }


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

        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            this.logout();
            menu.classList.remove('show');
        });
    }


    // ================= 修改密码相关方法 =================
    openChangePasswordModal() {
        this.resetChangePasswordForm();
        const modal = document.getElementById('changePasswordModal');
        if (modal) modal.classList.add('show');
    }

    closeChangePasswordModal() {
        const modal = document.getElementById('changePasswordModal');
        if (modal) modal.classList.remove('show');
        this.resetChangePasswordForm();
    }

    resetChangePasswordForm() {
        document.getElementById('changePasswordForm').reset();
        ['currentPasswordError', 'newPasswordError', 'confirmPasswordError'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '';
                el.style.display = 'none';
            }
        });
        const successEl = document.getElementById('changePasswordSuccess');
        if (successEl) {
            successEl.textContent = '';
            successEl.style.display = 'none';
        }

        const btn = document.getElementById('submitChangePasswordBtn');
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }

        // 清除输入框错误样式
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.classList.remove('error');
        });
    }

    showChangePasswordError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
            // 联动高亮输入框
            const inputId = elementId.replace('Error', '');
            const input = document.getElementById(inputId);
            if (input) input.classList.add('error');
        }
    }


    async submitChangePassword() {
        const currentPwd = document.getElementById('currentPassword').value.trim();
        const newPwd = document.getElementById('newPassword').value.trim();
        const confirmPwd = document.getElementById('confirmPassword').value.trim();

        // 清除历史状态
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            document.getElementById(id).classList.remove('error');
        });
        ['currentPasswordError', 'newPasswordError', 'confirmPasswordError'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // 🔍 前端基础验证
        let isValid = true;
        if (!currentPwd) {
            this.showChangePasswordError('currentPasswordError', '请输入当前密码');
            isValid = false;
        }
        if (!newPwd) {
            this.showChangePasswordError('newPasswordError', '请输入新密码');
            isValid = false;
        } else if (newPwd.length < 8) {
            this.showChangePasswordError('newPasswordError', '新密码长度至少为8位');
            isValid = false;
        }
        if (!confirmPwd) {
            this.showChangePasswordError('confirmPasswordError', '请确认新密码');
            isValid = false;
        } else if (newPwd !== confirmPwd) {
            this.showChangePasswordError('confirmPasswordError', '两次输入的新密码不一致');
            isValid = false;
        }

        if (!isValid) return;

        // 🔄 显示加载状态
        const btn = document.getElementById('submitChangePasswordBtn');
        btn.classList.add('loading');
        btn.disabled = true;

        try {
            // 🔐 加密传输（与登录逻辑保持一致）
            const encCurrent = window.EncryptUtils ? window.EncryptUtils.encryptData(currentPwd) : currentPwd;
            const encNew = window.EncryptUtils ? window.EncryptUtils.encryptData(newPwd) : newPwd;

            const response = await API.changePassword(encCurrent, encNew, encNew);
            const data = await response.json();

            if (response.ok) {
                const successEl = document.getElementById('changePasswordSuccess');
                successEl.textContent = data.message || '✅ 密码修改成功';
                successEl.style.display = 'block';

                // 1.5秒后自动关闭并提示重新登录（因为修改密码后旧Token通常失效）
                setTimeout(() => {
                    this.closeChangePasswordModal();
                    this.showSuccess('密码已更新，请重新登录');
                    this.logout(); // 修改密码后使旧 Token 失效并跳回登录页
                    // 可选：自动跳转登录页
                    // localStorage.removeItem('access_token');
                    // window.location.href = '/login/';
                }, 1500);
            } else {
                // 🛡️ 处理后端 DRF 验证错误
                if (data.old_password?.[0]) {
                    this.showChangePasswordError('currentPasswordError', data.old_password[0]);
                } else if (data.new_password?.[0]) {
                    this.showChangePasswordError('newPasswordError', data.new_password[0]);
                } else if (data.new_password_confirm?.[0]) {
                    this.showChangePasswordError('confirmPasswordError', data.new_password_confirm[0]);
                } else {
                    this.showChangePasswordError('currentPasswordError', data.detail || data.error || data.message || '修改失败');
                }
            }
        } catch (error) {
            console.error('修改密码请求失败:', error);
            this.showChangePasswordError('currentPasswordError', '网络异常，请稍后重试');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }


    // 语音&视频通话功能开始

    // 🔧 新增/替换：初始化并绑定远程媒体元素
    setupRemoteMediaElements() {
        let remoteVideo = document.getElementById('remoteVideo');
        let remoteAudio = document.getElementById('remoteAudio');

        // 如果元素不存在则动态创建
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = 'remoteVideo';
            remoteVideo.className = 'remote-video hidden';
            document.getElementById('callMediaContainer')?.appendChild(remoteVideo);
        }
        if (!remoteAudio) {
            remoteAudio = document.createElement('audio');
            remoteAudio.id = 'remoteAudio';
            remoteAudio.className = 'remote-audio hidden';
            document.getElementById('callMediaContainer')?.appendChild(remoteAudio);
        }

        // 🔑 关键修复：设置自动播放与内联播放（iOS Safari 必需）
        remoteVideo.autoplay = true;
        remoteVideo.playsinline = true;
        remoteVideo.muted = false; // 远程流不能静音

        remoteAudio.autoplay = true;
        remoteAudio.playsinline = true;
    }

    // 🔧 新增/替换：初始化本地媒体元素
    setupLocalMediaElements() {
        let localVideo = document.getElementById('localVideo');
        if (!localVideo) {
            localVideo = document.createElement('video');
            localVideo.id = 'localVideo';
            localVideo.className = 'local-video hidden';
            document.getElementById('callMediaContainer')?.appendChild(localVideo);
        }
        // 🔑 关键修复：本地视频必须静音，否则触发浏览器音频回环保护
        localVideo.autoplay = true;
        localVideo.playsinline = true;
        localVideo.muted = true;
    }


    async initiateCall(type) {
        console.log('🚀 [CALL] 发起通话:', type);

        // 🔧 关键修复1: 状态检查
        if (this.callState !== 'idle') {
            this.showError('当前已有进行中的通话');
            return;
        }

        const targetUserId = this.getCurrentChatTargetUserId();
        if (!targetUserId || targetUserId === this.currentUser.id) {

            console.log('请选择有效的聊天对象，暂不支持群组语音&视频通话!');
            return;
        }

        // 🔧 关键修复2: 初始化通话参数
        this.callType = type;
        this.callRoomId = this.currentRoomId;
        this.callState = 'calling';
        this.pendingCallerId = targetUserId;  // 🔧 保存目标用户 ID

        // 🔧 关键修复：启用通话保护
        this.isCallInProgress = true;
        console.log('🔒 通话保护已启用');

        // 🔧 关键修复：重置 answer 处理标志（新通话）
        this.answerProcessed = false;

        try {
            // 🔧 1. 先获取 TURN 凭证（避免媒体权限阻塞信令）
            console.log('🔑 获取 TURN 凭证...');
            const turnConfig = await this.fetchTurnCredentials();

            // 🔧 2. 连接信令 WebSocket
            console.log('🔄 连接通话信令...');
            await this.connectCallWebSocket();
            console.log('✅ 信令连接成功');

            // 🔧 3. 获取本地媒体
            console.log('🎤 请求媒体权限...');
            const constraints = {
                audio: true,
                video: type === 'video' ? {
                    facingMode: 'user',
                    width: {ideal: 1280},
                    height: {ideal: 720}
                } : false
            };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('✅ 获取本地媒体流成功');

            // 🔧 2. 初始化 UI 元素
            this.setupRemoteMediaElements();
            this.setupLocalMediaElements();

            // 🔧 7. 更新 UI - 显示对方信息
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                if (type === 'video') localVideo.classList.remove('hidden');
                this.updateCallUI('calling');
            }

            // 🔧 新增：显示对方名字和头像
            this.updateCallHeaderWithTargetInfo(targetUserId);


            // 🔧 3. 创建 PeerConnection（此时 localStream 已准备就绪）（传入凭证）
            console.log('🔧 初始化 RTCPeerConnection...');
            this.setupPeerConnection(turnConfig.iceServers);

            // 🔧 关键修复：确保本地轨道已添加到 PeerConnection
            if (!this.localStream || this.localStream.getTracks().length === 0) {
                throw new Error('本地媒体流为空，请检查麦克风/摄像头权限');
            }

            // 🔧 关键修复：验证所有轨道都处于启用状态
            this.localStream.getTracks().forEach(track => {
                if (!track.enabled) {
                    console.warn('⚠️ 轨道被禁用，重新启用:', track.kind);
                    track.enabled = true;
                }
                console.log('✅ 本地轨道状态:', {
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                    label: track.label
                });
            });


            // 🔧 5. 创建并发送 Offer
            console.log('🔧 创建 SDP Offer...');
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);


            // 🔧 6. 发送信令（带重试）
            const sendOffer = () => {
                if (this.callWs?.readyState === WebSocket.OPEN) {
                    this.callWs.send(JSON.stringify({
                        type: 'call_offer',
                        sdp: offer,
                        from: this.currentUser.id,
                        to: targetUserId,
                        room_id: this.callRoomId,
                        media_type: this.callType
                    }));
                    return true;
                }
                return false;
            };

            if (!sendOffer()) {
                // 重试机制
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!sendOffer()) {
                    throw new Error('信令发送失败');
                }
            }

            // 🔧 关键修复：不在这里记录 callStartTime，等 ICE 连接成功后再记录
            // this.callStartTime = Date.now();  // ❌ 删除这行
            console.log('✅ 通话发起成功，等待对方接听...');

            // 🔧 新增：播放呼叫方铃声（与接听方铃声区分）
            this.playCallerRingtone();


        } catch (err) {
            console.error('❌ 发起通话失败:', err);
            this.showError(`无法发起通话: ${err.message || '请检查网络或权限'}`);
            if (err.name === 'NotAllowedError') {
                this.showError('请允许访问麦克风/摄像头权限');
            }
            this.endCall();
        }
    }


    // 🔧 修复：连接通话信令 WebSocket
    async connectCallWebSocket(roomId = null) {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const token = localStorage.getItem('access_token');

            // 🔧 关键修复：优先使用传入的 roomId，其次使用 this.callRoomId
            const targetRoomId = roomId || this.callRoomId;
            if (!targetRoomId) {
                reject(new Error('缺少聊天室 ID'));
                return;
            }

            let wsUrl = `${protocol}//${window.location.host}/ws/call/${targetRoomId}/`;
            if (token) {
                wsUrl += `?token=${encodeURIComponent(token)}`;
            }

            console.log('🔗 连接通话信令 WebSocket:', wsUrl);

            this.callWs = new WebSocket(wsUrl);

            const connectionTimeout = setTimeout(() => {
                if (this.callWs && this.callWs.readyState === WebSocket.CONNECTING) {
                    console.warn('⏰ 通话信令连接超时');
                    this.callWs.close();
                    reject(new Error('通话信令连接超时'));
                }
            }, 5000);

            this.callWs.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('✅ 通话信令 WebSocket 已连接');
                resolve();
            };

            this.callWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleCallSignaling(data);
                } catch (error) {
                    console.error('❌ 解析信令消息失败:', error);
                }
            };

            this.callWs.onclose = (event) => {
                clearTimeout(connectionTimeout);
                console.log('🔌 通话信令断开:', event.code, event.reason);

                // 🔧 关键修复：只在通话进行中且非正常关闭时才结束通话
                // code 1000: 正常关闭
                // code 1001: 离开页面
                // code 1006: 异常断开
                if (event.code !== 1000 && this.callState !== 'idle' && this.callState !== 'ended') {
                    console.warn('⚠️ 通话信令异常断开，但保持通话状态，尝试重连...');
                    // 🔧 不立即结束通话，给用户一个恢复的机会
                    // 只有在真正需要结束时才调用 endCall()
                    this.showToast('通话连接不稳定，请检查网络', 'warning');
                }
            };

            this.callWs.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('❌ 通话信令错误:', error);
                reject(new Error('WebSocket 连接错误'));
            };
        });
    }

    // 发起通话前先获取凭证
    async fetchTurnCredentials() {
        try {
            const response = await fetch('/api/chat/turn/credentials/', {
                headers: TokenManager.getHeaders(),
                cache: 'no-store'
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(`HTTP ${response.status}: ${err.error || 'Unknown'}`);
            }

            const data = await response.json();

            if (!data.username || !data.credential) {
                throw new Error('凭证数据不完整');
            }

            console.log('🔑 TURN 凭证获取成功:', {
                username: data.username,
                realm: data.realm,
                uris: data.uris,
                expiresAt: new Date(Date.now() + data.ttl * 1000).toLocaleTimeString()
            });

            // 🔧 关键修复：构造标准的 ICE 服务器配置
            const iceServers = data.uris.map(uri => {
                const server = {
                    urls: uri,
                    username: data.username,
                    credential: data.credential
                };

                // 🔧 某些浏览器需要 credentialType 字段
                if (data.credentialType) {
                    server.credentialType = data.credentialType;
                }

                return server;
            });

            // 🔧 添加 STUN 服务器作为备用
            iceServers.push(
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            );

            // console.log('🔧 ICE Servers 配置:', JSON.stringify(iceServers, null, 2));

            return {
                iceServers: iceServers,
                expiresAt: Date.now() + (data.ttl * 1000),
                realm: data.realm
            };
        } catch (error) {
            console.error('❌ 获取 TURN 凭证失败:', error);
            return {
                iceServers: [
                    {urls: 'stun:stun.l.google.com:19302'},
                    {urls: 'stun:stun1.l.google.com:19302'}
                ],
                expiresAt: 0
            };
        }
    }

    // 🔧 新增：安全添加 ICE 候选（解决竞态条件）
    async addIceCandidateSafe(candidate) {
        const rtcCandidate = new RTCIceCandidate(candidate);
        if (this.isRemoteDescriptionSet) {
            await this.peerConnection.addIceCandidate(rtcCandidate).catch(e =>
                console.warn('⚠️ ICE候选注入失败:', e)
            );
        } else {
            this.pendingIceCandidates.push(rtcCandidate);
        }
    }

    // 🔧 新增：清空候选队列（在 setRemoteDescription 成功后调用）
    async drainIceCandidateQueue() {
        this.isRemoteDescriptionSet = true;
        for (const cand of this.pendingIceCandidates) {
            await this.peerConnection.addIceCandidate(cand).catch(e =>
                console.warn('⚠️ 队列候选注入失败:', e)
            );
        }
        this.pendingIceCandidates = [];
        console.log('✅ ICE候选队列已清空，共处理:', this.pendingIceCandidates.length);
    }


    setupPeerConnection_v1(iceServers = null) {
        if (!iceServers || !Array.isArray(iceServers) || iceServers.length === 0) {
            console.warn('⚠️ [RTC] 未提供 ICE 服务器，使用降级配置');
            iceServers = [
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            ];
        }

        const iceInfo = iceServers.map(s => ({
            urls: s.urls,
            hasAuth: !!s.username,
            transport: s.urls.includes('transport=') ? s.urls.split('transport=')[1] : 'default'
        }));
        console.log('🔧 [RTC] PeerConnection config:', JSON.stringify(iceInfo, null, 2));

        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        });

        // 🔧 关键修复：跟踪已设置的远程流
        this.remoteStreamSet = false;
        this.audioStreamSet = false;  // 🔧 新增：单独跟踪音频
        this.videoStreamSet = false;  // 🔧 新增：单独跟踪视频

        // 🔧 关键修复：立即添加本地流（必须在设置事件处理器之前）
        if (this.localStream) {
            console.log('📤 [SETUP] 添加本地媒体轨道:', this.localStream.getTracks().length);
            this.localStream.getTracks().forEach(track => {
                try {
                    this.peerConnection.addTrack(track, this.localStream);
                    console.log('  ✅ [SETUP] 已添加轨道:', track.kind, track.label, 'enabled:', track.enabled);
                } catch (err) {
                    console.error('  ❌ [SETUP] 添加轨道失败:', track.kind, err);
                }
            });
        }


        // 🔧 关键修复：收集所有远程轨道，等待完整流后再设置
        const remoteTracks = new Map(); // track.kind -> track

        const sentCandidates = new Set();

        this.peerConnection.onicecandidate = (event) => {
            if (!event.candidate || this.callWs?.readyState !== WebSocket.OPEN) return;

            const cand = event.candidate;
            const key = `${cand.sdpMid}:${cand.sdpMLineIndex}:${cand.candidate?.substring(0, 50)}`;

            if (!sentCandidates.has(key)) {
                sentCandidates.add(key);

                // 🔧 关键修复：将 RTCIceCandidate 转换为普通对象
                const candidateData = {
                    candidate: cand.candidate,
                    sdpMid: cand.sdpMid,
                    sdpMLineIndex: cand.sdpMLineIndex,
                    usernameFragment: cand.usernameFragment
                };
                this.callWs.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: candidateData,  // 🔧 使用普通对象而不是 RTCIceCandidate
                    room_id: this.callRoomId,
                    to: this.pendingCallerId
                }));
                console.log('📤 [ICE] Sent candidate:', cand.type, cand.address ? cand.address.substring(0, 20) : 'unknown');
            }
        };

        // 🔧 关键修复：同时监听多个连接状态
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 [ICE Connection State]:', state);

            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE 连接成功，媒体通道已打通');

                // 🔧 关键修复：ICE 连接成功后才记录通话开始时间
                if (!this.callStartTime) {
                    this.callStartTime = Date.now();
                    console.log('⏱️ 通话开始时间已记录:', new Date(this.callStartTime).toLocaleTimeString());
                }

                // 🔧 关键修复：更新通话状态为 connected
                if (this.callState !== 'connected') {
                    this.callState = 'connected';
                    this.updateCallUI('connected');
                    this.startCallDurationTimer();

                    // 🔧 新增：停止呼叫方铃声（如果是发起方）
                    this.stopCallerRingtone();
                    // 🔧 新增：停止接听方铃声（如果是接听方）
                    this.stopRingtone();
                }
            }

            if (state === 'failed') {
                console.error('❌ ICE 连接失败，详细诊断信息:');

                // 🔧 新增：收集诊断信息
                const stats = this.peerConnection.getStats();
                stats.then(statsReport => {
                    let iceCandidatePairs = [];
                    statsReport.forEach(report => {
                        if (report.type === 'candidate-pair') {
                            iceCandidatePairs.push({
                                state: report.state,
                                localCandidateId: report.localCandidateId,
                                remoteCandidateId: report.remoteCandidateId,
                                nominated: report.nominated,
                                bytesSent: report.bytesSent,
                                bytesReceived: report.bytesReceived
                            });
                        }
                    });
                    console.log('📊 ICE Candidate Pairs:', JSON.stringify(iceCandidatePairs, null, 2));
                }).catch(err => {
                    console.warn('⚠️ 获取 ICE 统计信息失败:', err);
                });

                // 🔧 优化错误提示：根据场景提供不同建议
                const isMobileToPC = /Mobi|Android/i.test(navigator.userAgent); // 判断是否是移动端
                const errorMessage = isMobileToPC
                    ? '网络连接失败。请检查：\n1. 是否在同一网络环境\n2. 防火墙/路由器是否阻止了 UDP 端口\n3. 尝试切换到 WiFi 或移动数据'
                    : '网络连接失败。请检查：\n1. TURN 服务器是否正常运行\n2. 防火墙是否允许 UDP/TCP 端口 3478/5349\n3. 尝试刷新页面后重试';

                this.showError(errorMessage);
                this.endCall();
            }
        };

        // 🔧 新增：监听 PeerConnection 整体状态
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 [PeerConnection State]:', state);

            if (state === 'connected') {
                console.log('✅ PeerConnection 已连接，音视频应该可以传输');
            }

            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                console.warn('⚠️ PeerConnection 状态异常:', state);

                // 🔧 关键修复：只有在非 idle 状态下才显示错误并结束通话
                if (this.callState !== 'idle') {
                    // 🔧 新增：区分是 ICE 失败还是其他原因
                    const iceState = this.peerConnection.iceConnectionState;
                    if (iceState === 'failed') {
                        // ICE 失败已经在 oniceconnectionstatechange 中处理了，这里不再重复
                        console.log('⏭️ ICE 失败已由 oniceconnectionstatechange 处理');
                    } else {
                        this.showError(`通话连接断开 (${state})`);
                        this.endCall();
                    }
                }
            }
        };

        // 🔧 关键修复：接收远程媒体
        this.peerConnection.ontrack = (event) => {
            console.log('🎬 收到远程轨道:', {
                kind: event.track.kind,
                streams: event.streams.length,
                trackId: event.track.id,
                readyState: event.track.readyState
            });

            if (!event.streams || event.streams.length === 0) {
                console.warn('⚠️ 收到轨道但无关联流');
                return;
            }

            // 🔧 关键修复：保存轨道引用
            remoteTracks.set(event.track.kind, {
                track: event.track,
                stream: event.streams[0]
            });

            const remoteStream = event.streams[0];
            this.remoteStream = remoteStream;

            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');

            // 🔧 关键修复：视频轨道处理 - 延迟设置 srcObject，避免中断
            if (event.track.kind === 'video' && remoteVideo && this.callType === 'video') {
                console.log('📹 收到视频轨道，准备设置远程视频流');

                // 🔧 等待一小段时间，确保音频也已设置（如果有的话）
                setTimeout(() => {
                    if (!this.videoStreamSet && remoteVideo.srcObject !== remoteStream) {
                        console.log('📹 设置远程视频流到 video 元素');
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.classList.remove('hidden');
                        remoteVideo.playsInline = true;
                        remoteVideo.autoplay = true;
                        remoteVideo.muted = false;
                        this.videoStreamSet = true;  // 🔧 只标记视频已设置
                        this.remoteStreamSet = true;

                        this.playVideoElement(remoteVideo).then(() => {
                            console.log('✅ 远程视频播放成功');
                        }).catch(err => {
                            console.error('❌ 远程视频播放失败:', err);
                            // 🔧 不要立即显示错误，给一些缓冲时间
                            setTimeout(() => {
                                if (remoteVideo.readyState < 3) {
                                    this.showToast('🎥 视频加载中，请稍候...', 'info');
                                }
                            }, 1000);
                        });
                    } else {
                        console.log('⏭️ 视频流已设置或正在设置，跳过');
                    }
                }, 100);
            }

            // 🔧 关键修复：音频轨道处理
            if (event.track.kind === 'audio' && remoteAudio) {
                console.log('🔊 收到音频轨道，准备设置远程音频流');

                // 🔧 音频可以立即设置
                if (!this.audioStreamSet && remoteAudio.srcObject !== remoteStream) {
                    console.log('🔊 设置远程音频流到 audio 元素');
                    remoteAudio.srcObject = remoteStream;
                    remoteAudio.autoplay = true;
                    remoteAudio.muted = false;
                    this.audioStreamSet = true;  // 🔧 只标记音频已设置
                    this.remoteStreamSet = true;

                    this.playAudioElement(remoteAudio).then(() => {
                        console.log('✅ 远程音频播放成功');
                    }).catch(err => {
                        console.error('❌ 远程音频播放失败:', err);
                        this.showToast('🔊 音频加载失败，请点击页面启用音频', 'info');
                    });
                } else {
                    console.log('⏭️ 音频流已设置或正在设置，跳过');
                }
            }
        };


        return this.peerConnection;
    }


    setupPeerConnection(iceServers = null) {
        if (!iceServers || !Array.isArray(iceServers) || iceServers.length === 0) {
            console.warn('⚠️ [RTC] 未提供 ICE 服务器，使用降级配置');
            iceServers = [
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            ];
        }

        const iceInfo = iceServers.map(s => ({
            urls: s.urls,
            hasAuth: !!s.username,
            transport: s.urls.includes('transport=') ? s.urls.split('transport=')[1] : 'default'
        }));
        console.log('🔧 [RTC] PeerConnection config:', JSON.stringify(iceInfo, null, 2));

        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        });

        // 🔧 关键修复：跟踪已设置的远程流
        this.remoteStreamSet = false;
        this.audioStreamSet = false;  // 🔧 新增：单独跟踪音频
        this.videoStreamSet = false;  // 🔧 新增：单独跟踪视频

        // 🔧 关键修复：立即添加本地流（必须在设置事件处理器之前）
        if (this.localStream) {
            console.log('📤 [SETUP] 添加本地媒体轨道:', this.localStream.getTracks().length);
            this.localStream.getTracks().forEach(track => {
                try {
                    this.peerConnection.addTrack(track, this.localStream);
                    console.log('  ✅ [SETUP] 已添加轨道:', track.kind, track.label, 'enabled:', track.enabled);
                } catch (err) {
                    console.error('  ❌ [SETUP] 添加轨道失败:', track.kind, err);
                }
            });
        }


        // 🔧 关键修复：收集所有远程轨道，等待完整流后再设置
        const remoteTracks = new Map(); // track.kind -> track

        const sentCandidates = new Set();

        this.peerConnection.onicecandidate = (event) => {
            if (!event.candidate || this.callWs?.readyState !== WebSocket.OPEN) return;

            const cand = event.candidate;
            const key = `${cand.sdpMid}:${cand.sdpMLineIndex}:${cand.candidate?.substring(0, 50)}`;

            if (!sentCandidates.has(key)) {
                sentCandidates.add(key);

                // 🔧 关键修复：将 RTCIceCandidate 转换为普通对象
                const candidateData = {
                    candidate: cand.candidate,
                    sdpMid: cand.sdpMid,
                    sdpMLineIndex: cand.sdpMLineIndex,
                    usernameFragment: cand.usernameFragment
                };
                this.callWs.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: candidateData,  // 🔧 使用普通对象而不是 RTCIceCandidate
                    room_id: this.callRoomId,
                    to: this.pendingCallerId
                }));
                console.log('📤 [ICE] Sent candidate:', cand.type, cand.address ? cand.address.substring(0, 20) : 'unknown');
            }
        };

        // 🔧 替换原有的 oniceconnectionstatechange 逻辑
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 [ICE Connection State]:', state);

            // 清除超时定时器
            if (this.iceTimeoutTimer) {
                clearTimeout(this.iceTimeoutTimer);
                this.iceTimeoutTimer = null;
            }

            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE 连接成功，媒体通道已打通');
                if (!this.callStartTime) {
                    this.callStartTime = Date.now();
                    console.log('⏱️ 通话开始时间已记录');
                }
                if (this.callState !== 'connected') {
                    this.callState = 'connected';
                    this.updateCallUI('connected');
                    this.startCallDurationTimer();
                    this.stopCallerRingtone();
                    this.stopRingtone();
                }
            }

            if (state === 'failed') {
                console.error('❌ ICE 连接失败，详细诊断信息:');

                // 🔧 新增：尝试自动重启 ICE（挽救网络抖动）
                if (this.peerConnection.canTrickleIceCandidates) {
                    console.warn('🔄 尝试 ICE Restart 恢复连接...');
                    this.peerConnection.restartIce();
                    // 重启后重新设置超时
                    this.iceTimeoutTimer = setTimeout(() => {
                        if (this.peerConnection.iceConnectionState !== 'connected') {
                            this.showError('网络连接失败。建议检查运营商网络或切换 WiFi/5G 后重试');
                            this.endCall();
                        }
                    }, 15000);
                } else {
                    this.showError('网络连接失败。请检查防火墙或 TURN 服务器状态');
                    this.endCall();
                }
            }
        };

        /// 🔧 关键修复：增强 ICE 错误处理
        this.peerConnection.onicecandidateerror = (event) => {
            const url = event.url || 'unknown';
            const errorCode = event.errorCode;
            const errorText = event.errorText || 'Unknown error';

            // 🔧 过滤掉非关键错误（如 TURNS 连接失败但 TURN 可用）
            if (errorCode === 701 && url.includes('turns:')) {
                console.warn('⚠️ [ICE] TURNS 连接失败，尝试其他传输方式:', {
                    url: url,
                    errorCode: errorCode,
                    errorText: errorText
                });
                // 不显示错误提示，因为可能有其他可用的 TURN 服务器
            } else if (errorCode !== 0) {
                console.error('❌ [ICE] Candidate 错误:', {
                    url: url,
                    errorCode: errorCode,
                    errorText: errorText
                });
            }
        };


        // 🔧 新增：监听 PeerConnection 整体状态
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 [PeerConnection State]:', state);

            if (state === 'connected') {
                console.log('✅ PeerConnection 已连接，音视频应该可以传输');
            }

            if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                console.warn('⚠️ PeerConnection 状态异常:', state);

                // 🔧 关键修复：只有在非 idle 状态下才显示错误并结束通话
                if (this.callState !== 'idle') {
                    // 🔧 新增：区分是 ICE 失败还是其他原因
                    const iceState = this.peerConnection.iceConnectionState;
                    if (iceState === 'failed') {
                        // ICE 失败已经在 oniceconnectionstatechange 中处理了，这里不再重复
                        console.log('⏭️ ICE 失败已由 oniceconnectionstatechange 处理');
                    } else {
                        this.showError(`通话连接断开 (${state})`);
                        this.endCall();
                    }
                }
            }
        };

        // 🔧 关键修复：接收远程媒体
        this.peerConnection.ontrack = (event) => {
            console.log('🎬 收到远程轨道:', {
                kind: event.track.kind,
                streams: event.streams.length,
                trackId: event.track.id,
                readyState: event.track.readyState
            });

            if (!event.streams || event.streams.length === 0) {
                console.warn('⚠️ 收到轨道但无关联流');
                return;
            }

            // 🔧 关键修复：保存轨道引用
            remoteTracks.set(event.track.kind, {
                track: event.track,
                stream: event.streams[0]
            });

            const remoteStream = event.streams[0];
            this.remoteStream = remoteStream;

            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');

            // 🔧 关键修复：视频轨道处理 - 延迟设置 srcObject，避免中断
            if (event.track.kind === 'video' && remoteVideo && this.callType === 'video') {
                console.log('📹 收到视频轨道，准备设置远程视频流');

                // 🔧 等待一小段时间，确保音频也已设置（如果有的话）
                setTimeout(() => {
                    if (!this.videoStreamSet && remoteVideo.srcObject !== remoteStream) {
                        console.log('📹 设置远程视频流到 video 元素');
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.classList.remove('hidden');
                        remoteVideo.playsInline = true;
                        remoteVideo.autoplay = true;
                        remoteVideo.muted = false;
                        this.videoStreamSet = true;  // 🔧 只标记视频已设置
                        this.remoteStreamSet = true;

                        this.playVideoElement(remoteVideo).then(() => {
                            console.log('✅ 远程视频播放成功');
                        }).catch(err => {
                            console.error('❌ 远程视频播放失败:', err);
                            // 🔧 不要立即显示错误，给一些缓冲时间
                            setTimeout(() => {
                                if (remoteVideo.readyState < 3) {
                                    this.showToast('🎥 视频加载中，请稍候...', 'info');
                                }
                            }, 1000);
                        });
                    } else {
                        console.log('⏭️ 视频流已设置或正在设置，跳过');
                    }
                }, 100);
            }

            // 🔧 关键修复：音频轨道处理
            if (event.track.kind === 'audio' && remoteAudio) {
                console.log('🔊 收到音频轨道，准备设置远程音频流');

                // 🔧 音频可以立即设置
                if (!this.audioStreamSet && remoteAudio.srcObject !== remoteStream) {
                    console.log('🔊 设置远程音频流到 audio 元素');
                    remoteAudio.srcObject = remoteStream;
                    remoteAudio.autoplay = true;
                    remoteAudio.muted = false;
                    this.audioStreamSet = true;  // 🔧 只标记音频已设置
                    this.remoteStreamSet = true;

                    this.playAudioElement(remoteAudio).then(() => {
                        console.log('✅ 远程音频播放成功');
                    }).catch(err => {
                        console.error('❌ 远程音频播放失败:', err);
                        this.showToast('🔊 音频加载失败，请点击页面启用音频', 'info');
                    });
                } else {
                    console.log('⏭️ 音频流已设置或正在设置，跳过');
                }
            }
        };


        return this.peerConnection;
    }

    // 🔧 新增：检查信令是否已处理
    isSignalProcessed(signalId) {
        if (!signalId) return false;

        const now = Date.now();
        // 清理过期的缓存
        for (const id of this.processedSignals) {
            if (now - parseInt(id.split('_')[0]) > this.signalCacheTimeout) {
                this.processedSignals.delete(id);
            }
        }

        return this.processedSignals.has(signalId);
    }

    // 🔧 新增：标记信令已处理
    markSignalProcessed(signalId) {
        if (signalId) {
            this.processedSignals.add(`${Date.now()}_${signalId}`);
        }
    }


    handleCallSignaling(data) {
        console.log('📡 [SIGNAL] 收到通话信令:', {
            type: data.type,
            from: data.from_user?.id || data.from_user_id,
            room_id: data.room_id,
            has_sdp: !!data.sdp
        });

        // 🔧 关键修复：生成信令唯一ID并去重
        const signalId = `${data.type}_${data.from_user_id || data.from_user?.id}_${data.room_id}_${Date.now()}`;
        if (this.isSignalProcessed(signalId)) {
            console.warn('⏭️ 忽略重复的信令:', signalId);
            return;
        }

        switch (data.type) {
            case 'call_offer':
                console.log('🔔 收到来电邀请');
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                this.handleIncomingCall(data); // ✅ 处理来电
                break;
            case 'call_answer':
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                this.handleCallAnswer(data);
                break;
            case 'ice_candidate_v1':
                if (this.peerConnection && data.candidate) {
                    console.log('📥 [ICE] 收到远程 candidate:', data.candidate);
                    try {
                        this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                            .then(() => {
                                console.log('✅ [ICE] Candidate 添加成功');
                            })
                            .catch(err => {
                                console.error('❌ [ICE] Candidate 添加失败:', err);
                            });
                    } catch (err) {
                        console.error('❌ [ICE] 创建 RTCIceCandidate 失败:', err, data.candidate);
                    }
                }
                break;
            case 'ice_candidate':
                if (this.peerConnection && data.candidate) {
                    console.log('📥 [ICE] 收到远程 candidate:', data.candidate);
                    // 🔧 关键修复：使用安全队列注入，替代直接 addIceCandidate
                    this.addIceCandidateSafe(data.candidate);
                }
                break;
            case 'call_end':
                // 🔧 关键修复：防止重复处理 call_end 信令
                if (this.callState === 'idle') {
                    console.log('⏭️ 忽略重复的 call_end 信令（当前状态已是 idle）');
                    return;
                }
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                console.log('❌ 通话已结束（对方挂断）');
                // 🔧 关键修复：先关闭来电弹窗（如果是被叫方）
                this.closeIncomingCallModal();
                // 🔧 关键修复：收到 call_end 时只清理本地资源，不再发送信令
                this.endCall(true);  // 🔧 传参 skipSignal=true，避免重复发送
                this.showSuccess('通话已结束');
                break;
            case 'call_reject':
                console.log('❌ 通话被拒绝');
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                // 🔧 关键修复：关闭弹窗并提示
                this.closeIncomingCallModal();
                this.endCall(true);  // 拒绝时不发送 call_end
                this.showSuccess('对方已拒绝通话');
                break;
            case 'call_missed':  // 🔧 新增：处理未接听信令
                console.log('⏱️ 通话未接听');
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                // 🔧 关键修复：关闭弹窗并提示
                this.closeIncomingCallModal();
                this.endCall(true);  // 未接听时不发送 call_end
                this.showToast('对方未接听', 'info');
                break;
        }
    }

    // chat.js - ChatClient 类中替换原有方法
    async handleIncomingCall(offerData) {
        console.log('📞 处理来电邀请:', offerData);

        if (this.callState !== 'idle') {
            console.warn('⚠️ 当前已有通话，拒绝新来电');
            if (this.callWs?.readyState === WebSocket.OPEN) {
                this.callWs.send(JSON.stringify({
                    type: 'call_reject',
                    room_id: offerData.room_id,
                    reason: 'busy'
                }));
            }
            return;
        }

        // 🔧 关键修复：正确解析 SDP
        const sdpData = offerData.data?.sdp || offerData.sdp;
        const sdpType = offerData.data?.type || 'offer';

        if (!sdpData || !sdpType) {
            console.error('❌ 来电邀请 SDP 数据无效');
            return;
        }

        // 🔧 关键修复1: 确保 room_id 是数字类型
        const roomId = parseInt(offerData.room_id);
        if (!roomId || isNaN(roomId)) {
            console.error('❌ 无效的聊天室 ID:', offerData.room_id);
            this.showError('无效的通话请求');
            return;
        }

        // 🔧 关键修复2: 缓存关键数据（解决 undefined 问题）
        this.pendingOffer = offerData.data?.sdp || offerData.sdp;
        this.incomingOffer = this.pendingOffer;  // 备用字段
        this.pendingCallerId = offerData.from_user?.id || offerData.from_user_id || offerData.from?.id;
        this.callType = offerData.media_type || 'audio';
        this.callRoomId = roomId;  // ✅ 确保是数字
        this.callState = 'ringing';

        // 🔧 关键修复：启用通话保护
        this.isCallInProgress = true;
        console.log('🔒 通话保护已启用（接听方）');

        // 🔧 关键修复：重置 answer 处理标志（新通话）
        this.answerProcessed = false;

        console.log('✅ 缓存来电数据:', {
            pendingOffer: !!this.pendingOffer,
            pendingCallerId: this.pendingCallerId,
            callType: this.callType
        });

        // 🔧 关键修复3: 【新增】接收方先连接信令通道
        try {
            await this.connectCallWebSocket();
            console.log('✅ 接收方信令通道已连接');
        } catch (err) {
            console.error('❌ 连接信令通道失败:', err);
            this.showError('无法建立通话连接');
            this.callState = 'idle';
            return;
        }

        // 🔧 关键：来电时也获取 TURN 凭证
        const turnConfig = await this.fetchTurnCredentials();
        console.log('🔧 [RTC] 获取 TURN 配置:', turnConfig);

        // 🔧 关键修复3: 准备 PeerConnection（不获取媒体流，等用户接听后再获取）
        this.setupPeerConnectionForAnswer(turnConfig.iceServers);

        // 🔧 关键修复4: 显示来电弹窗
        this.showIncomingCallModal(offerData);

        // 🔧 关键修复5: 播放来电铃声（可选）
        this.playRingtone();

        // 🔧 新增：启动60秒超时定时器
        this.callTimeoutTimer = setTimeout(() => {
            console.log('⏱️ 来电超时60秒，自动挂断');
            if (this.callState === 'ringing') {
                this.showToast('对方未接听，已自动挂断', 'info');
                // 🔧 关键修复：超时时应该发送 call_missed 而不是 call_reject
                this.handleCallMissed(offerData);
            }
        }, 60000); // 60秒超时
    }

    // chat.js - ChatClient 类中添加此方法
    // chat.js - ChatClient 类中添加此方法
    setupPeerConnectionForAnswer(iceServers = null) {
        console.log('🔧 setupPeerConnectionForAnswer 初始化');

        if (!iceServers || !Array.isArray(iceServers) || iceServers.length === 0) {
            iceServers = [
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            ];
        }

        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        });

        // 🔧 关键修复：跟踪已设置的远程流，避免重复设置
        this.remoteStreamSet = false;
        this.audioStreamSet = false;  // 🔧 新增
        this.videoStreamSet = false;  // 🔧 新增

        // 🔧 关键修复：ICE candidate 收集标志
        this.iceCandidatesCollected = [];

        // ICE Candidate 交换
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('📤 收集 ICE candidate:', event.candidate.type);
                this.iceCandidatesCollected.push(event.candidate);

                // 🔧 关键修复：立即发送每个 candidate（trickle ICE）
                if (this.callWs?.readyState === WebSocket.OPEN) {
                    // 🔧 将 RTCIceCandidate 转换为普通对象
                    const candidateData = {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        usernameFragment: event.candidate.usernameFragment
                    };

                    this.callWs.send(JSON.stringify({
                        type: 'ice_candidate',
                        candidate: candidateData,  // 🔧 使用普通对象而不是 RTCIceCandidate
                        room_id: this.callRoomId,
                        to: this.pendingCallerId
                    }));
                }
            } else {
                // ICE candidate 收集完成
                console.log('✅ ICE candidate 收集完成，共', this.iceCandidatesCollected.length, '个');
            }
        };

        // 🔧 关键修复：接收远程媒体
        const remoteTracks = new Map();

        this.peerConnection.ontrack = (event) => {
            console.log('🎬 收到远程轨道:', {
                kind: event.track.kind,
                streams: event.streams.length,
                trackId: event.track.id,
                readyState: event.track.readyState
            });

            if (!event.streams || event.streams.length === 0) {
                console.warn('⚠️ 收到轨道但无关联流');
                return;
            }

            remoteTracks.set(event.track.kind, {
                track: event.track,
                stream: event.streams[0]
            });

            const remoteStream = event.streams[0];
            this.remoteStream = remoteStream;

            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');

            // 🔧 关键修复：视频轨道处理 - 延迟设置 srcObject
            if (event.track.kind === 'video' && remoteVideo && this.callType === 'video') {
                console.log('📹 收到视频轨道，准备设置远程视频流');

                setTimeout(() => {
                    if (!this.videoStreamSet && remoteVideo.srcObject !== remoteStream) {
                        console.log('📹 设置远程视频流到 video 元素');
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.classList.remove('hidden');
                        remoteVideo.playsInline = true;
                        remoteVideo.autoplay = true;
                        remoteVideo.muted = false;
                        this.videoStreamSet = true;  // 🔧 只标记视频已设置
                        this.remoteStreamSet = true;

                        this.playVideoElement(remoteVideo).then(() => {
                            console.log('✅ 远程视频播放成功');
                        }).catch(err => {
                            console.error('❌ 远程视频播放失败:', err);
                            setTimeout(() => {
                                if (remoteVideo.readyState < 3) {
                                    this.showToast('🎥 视频加载中，请稍候...', 'info');
                                }
                            }, 1000);
                        });
                    } else {
                        console.log('⏭️ 视频流已设置或正在设置，跳过');
                    }
                }, 100);
            }

            // 🔧 关键修复：音频轨道处理
            if (event.track.kind === 'audio' && remoteAudio) {
                console.log('🔊 收到音频轨道，准备设置远程音频流');

                if (!this.audioStreamSet && remoteAudio.srcObject !== remoteStream) {
                    console.log('🔊 设置远程音频流到 audio 元素');
                    remoteAudio.srcObject = remoteStream;
                    remoteAudio.autoplay = true;
                    remoteAudio.muted = false;
                    this.audioStreamSet = true;  // 🔧 只标记音频已设置
                    this.remoteStreamSet = true;

                    this.playAudioElement(remoteAudio).then(() => {
                        console.log('✅ 远程音频播放成功');
                    }).catch(err => {
                        console.error('❌ 远程音频播放失败:', err);
                        this.showToast('🔊 音频加载失败，请点击页面启用音频', 'info');
                    });
                } else {
                    console.log('⏭️ 音频流已设置或正在设置，跳过');
                }
            }
        };

        // 连接状态监控
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 [ICE Connection State]:', state);

            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE 连接成功，媒体通道已打通');
                // 🔧 关键修复：只有在 ICE 连接成功后才更新 UI 为 connected
                if (this.callState !== 'connected') {
                    this.callState = 'connected';

                    // 🔧 关键修复：在 ICE 连接成功时才记录通话开始时间
                    if (!this.callStartTime) {
                        this.callStartTime = Date.now();
                        console.log('⏱️ 通话开始时间:', new Date(this.callStartTime).toLocaleTimeString());
                    }

                    // 🔧 新增：启动通话时长定时器
                    this.startCallDurationTimer();

                    // 🔧 新增：停止铃声（接听方）
                    this.stopRingtone();
                    // 🔧 新增：停止呼叫方铃声（如果是发起方）
                    this.stopCallerRingtone();

                    this.updateCallUI('connected');
                    console.log('✅ 通话已完全建立');
                }
            }

            if (state === 'failed') {
                console.error('❌ ICE 连接失败');
                this.showError('网络连接失败，请检查防火墙或切换网络');
                this.endCall();
            }
        };


        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection.connectionState;
            console.log('🔗 [PeerConnection State]:', state);

            if (state === 'connected') {
                console.log('✅ PeerConnection 已连接');
            }

            if (state === 'failed' || state === 'disconnected') {
                console.warn('⚠️ PeerConnection 状态异常:', state);
            }
        };

        console.log('✅ setupPeerConnectionForAnswer 初始化完成');
        return this.peerConnection;
    }


    // 🔧 优化后的来电弹窗显示方法
    showIncomingCallModal(offerData) {
        // 先关闭可能存在的旧弹窗
        if (this.incomingCallModal?.parentNode) {
            this.incomingCallModal.remove();
        }

        const callerName = offerData.from_user?.real_name ||
            offerData.from_user?.username ||
            offerData.from_username ||
            '未知用户';

        const callerAvatar = offerData.from_user?.avatar_url ||
            offerData.from_avatar_url ||
            '/static/images/default-avatar.png';

        const callTypeText = offerData.media_type === 'video' ? '视频通话' : '语音通话';
        const callTypeIcon = offerData.media_type === 'video' ? 'fa-video' : 'fa-phone';

        const modal = document.createElement('div');
        modal.className = 'incoming-call-modal show';
        modal.id = 'incomingCallModal';
        modal.style.zIndex = '9999';  // 🔧 确保在最上层

        modal.innerHTML = `
        <div class="modal-backdrop" onclick="chatClient.rejectCallByBackdrop()"></div>
        <div class="modal-content">
            <button class="modal-close" onclick="chatClient.rejectCallByBackdrop()" title="关闭">
                <i class="fas fa-times"></i>
            </button>
            
            <div class="caller-avatar">
                <img src="${callerAvatar}" alt="${callerName}" 
                     onerror="this.src='/static/images/default-avatar.png'">
            </div>
            
            <p class="caller-name">${this.escapeHtml(callerName)}</p>
            
            <p class="call-type">
                <i class="fas ${callTypeIcon}"></i>
                ${callTypeText}
            </p>
            
            <p class="call-tip">
                <i class="fas fa-ring"></i> 正在呼叫您...
            </p>
            
            <div class="call-actions">
                <button class="btn btn-reject" id="rejectCallBtn" data-label="拒绝">
                    <i class="fas fa-phone-slash"></i>
                </button>
                <button class="btn btn-accept" id="acceptCallBtn" data-label="接听">
                    <i class="fas fa-phone"></i>
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);
        this.incomingCallModal = modal;

        // 绑定事件
        const acceptBtn = document.getElementById('acceptCallBtn');
        const rejectBtn = document.getElementById('rejectCallBtn');

        if (acceptBtn) {
            acceptBtn.onclick = (e) => {
                e.stopPropagation();
                this.acceptCall(offerData);
            };
        }

        if (rejectBtn) {
            rejectBtn.onclick = (e) => {
                e.stopPropagation();
                this.rejectCall(offerData);
            };
        }

        // 点击背景拒绝
        modal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
            this.rejectCall(offerData);
        });

        // ESC 键拒绝
        this._incomingCallKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this.rejectCall(offerData);
            }
        };
        document.addEventListener('keydown', this._incomingCallKeyHandler);

        console.log('✅ 来电弹窗已显示');
    }

    // 🔧 新增：点击背景拒绝来电
    rejectCallByBackdrop() {
        if (this.incomingCallModal) {
            const offerData = {
                room_id: this.callRoomId,
                from_user_id: this.pendingCallerId
            };
            this.rejectCall(offerData);
        }
    }


    // chat.js - ChatClient 类中替换原有方法
    async acceptCall(offerData) {
        console.log('✅ 用户点击接听');

        if (this.callState !== 'ringing') {
            console.warn('⚠️ 当前状态不可接听:', this.callState);
            return;
        }

        try {
            this.stopRingtone();

            // 确保用户已交互（解锁媒体权限）
            if (!this.userHasInteracted) {
                this.userHasInteracted = true;
                [this.audioContext, this.audioContextForMobile]
                    .filter(ctx => ctx && ctx.state === 'suspended')
                    .forEach(ctx => ctx.resume().catch(() => {
                    }));
            }

            this.setupRemoteMediaElements();
            this.setupLocalMediaElements();

            // 🔧 关键修复1: 获取 TURN 凭证
            const turnConfig = await this.fetchTurnCredentials();

            // 🔧 关键修复：如果 PeerConnection 不存在，才创建新的
            if (!this.peerConnection) {
                console.log('🔧 PeerConnection 不存在，创建新的');
                this.setupPeerConnectionForAnswer(turnConfig.iceServers);
            } else {
                console.log('✅ 复用已有的 PeerConnection');
            }

            // 🔧 关键修复2: 获取本地媒体流
            const constraints = {
                audio: true,
                video: this.callType === 'video' ? {
                    facingMode: 'user',
                    width: {ideal: 1280},
                    height: {ideal: 720}
                } : false
            };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

            // 🔧 关键修复：不在这里记录 callStartTime，等 ICE 连接成功后再记录
            // this.callStartTime = Date.now();  // ❌ 删除这行

            // 显示本地预览
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                if (this.callType === 'video') localVideo.classList.remove('hidden');
            }

            // 🔧 关键修复3: 处理 Offer - 必须先设置 RemoteDescription
            const offer = this.pendingOffer || this.incomingOffer;
            if (!offer) throw new Error('未找到有效的 SDP offer');

            console.log('🔧 设置 RemoteDescription (offer)');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

            // 🔧 关键修复：设置 RemoteDescription 后立即启用 ICE candidate 队列
            this.isRemoteDescriptionSet = true;
            // 清空已缓存的 ICE 候选（offer SDP 处理前到达的）
            if (this.pendingIceCandidates.length > 0) {
                console.log('🧊 处理已缓存的 ICE 候选:', this.pendingIceCandidates.length);
                for (const cand of this.pendingIceCandidates) {
                    try {
                        await this.peerConnection.addIceCandidate(cand);
                    } catch (e) {
                        console.warn('⚠️ 注入缓存的 ICE 候选失败:', e);
                    }
                }
                this.pendingIceCandidates = [];
            }

            // 🔧 关键修复4: 在设置 RemoteDescription 之后、创建 Answer 之前添加本地轨道
            if (this.localStream) {
                console.log('🎬 添加本地轨道到 PeerConnection');

                // 🔧 关键修复：验证所有轨道都处于启用状态
                this.localStream.getTracks().forEach(track => {
                    if (!track.enabled) {
                        console.warn('⚠️ 轨道被禁用，重新启用:', track.kind);
                        track.enabled = true;
                    }
                    console.log('✅ 本地轨道状态:', {
                        kind: track.kind,
                        enabled: track.enabled,
                        muted: track.muted,
                        readyState: track.readyState,
                        label: track.label
                    });

                    try {
                        this.peerConnection.addTrack(track, this.localStream);
                        console.log('  ✅ 已添加轨道:', track.kind, track.label);
                    } catch (err) {
                        console.error('  ❌ 添加轨道失败:', track.kind, err);
                    }
                });
            } else {
                console.error('❌ localStream 为空，无法添加本地轨道');
                throw new Error('本地媒体流为空');
            }

            // 🔧 关键修复5: 创建并设置 Answer
            console.log('🔧 创建 Answer');
            const answer = await this.peerConnection.createAnswer();
            console.log('🔧 设置 LocalDescription (answer)');
            await this.peerConnection.setLocalDescription(answer);

            // 🔧 关键修复6: 发送 Answer 信令
            if (this.callWs?.readyState === WebSocket.OPEN) {
                this.callWs.send(JSON.stringify({
                    type: 'call_answer',
                    sdp: answer,
                    room_id: this.callRoomId,
                    from: this.currentUser.id,
                    to: this.pendingCallerId
                }));
                console.log('📤 已发送 call_answer 信令');
            } else {
                throw new Error('信令通道未就绪');
            }

            // 更新状态
            this.callState = 'connecting';  // 🔧 改为 connecting，等 ICE 连接成功后再改为 connected
            this.updateCallUI('connecting');
            this.closeIncomingCallModal();

            console.log('✅ 接听流程完成，等待 ICE 连接建立');

        } catch (err) {
            console.error('❌ 接听通话失败:', err);
            this.showError(`接听失败: ${err.message || '请检查麦克风/摄像头权限'}`);
            if (err.name === 'NotAllowedError') {
                this.showError('请允许访问麦克风/摄像头权限');
            }
            this.stopRingtone();
            this.closeIncomingCallModal();
            this.endCall();
        }
    }


    // 🔧 新增：关闭来电弹窗
    closeIncomingCallModal() {
        if (this.incomingCallModal?.parentNode) {
            this.incomingCallModal.remove();
            this.incomingCallModal = null;
        }
        // 移除键盘监听
        if (this._incomingCallKeyHandler) {
            document.removeEventListener('keydown', this._incomingCallKeyHandler);
            this._incomingCallKeyHandler = null;
        }
    }

    // chat.js - ChatClient 类中添加/替换此方法
    async rejectCall(offerData) {
        console.log('❌ 用户拒绝来电');

        // 🔧 关键修复1: 停止铃声
        this.stopRingtone();

        // 🔧 关键修复2: 发送拒绝信令（包含reason字段）
        if (this.callWs?.readyState === WebSocket.OPEN) {
            try {
                this.callWs.send(JSON.stringify({
                    type: 'call_reject',
                    room_id: offerData?.room_id || this.callRoomId,
                    from_user_id: this.currentUser.id,  // 🔧 修复：使用from_user_id而不是from
                    to: this.pendingCallerId,
                    reason: 'rejected',  // 🔧 新增：明确标识拒绝原因
                    media_type: this.callType || 'audio'  // 🔧 新增：通话类型
                }));
                console.log('📤 已发送 call_reject 信令');
            } catch (e) {
                console.warn('⚠️ 发送拒绝信令失败:', e);
            }
        }

        // 🔧 关键修复3: 清理资源
        this.closeIncomingCallModal();

        // 🔧 关键修复4: 关闭可能已创建的 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // 🔧 关键修复5: 重置状态
        this.callState = 'idle';
        this.pendingOffer = null;
        this.pendingCallerId = null;
        this.incomingOffer = null;
        this.callRoomId = null;

        // 🔧 关键修复6: 不再调用 endCall(true)，而是让后端的 call_reject 处理
        // endCall(true);  // ❌ 删除这行，避免重复处理

        console.log('✅ 拒绝来电，资源已清理');
    }

    // 🔧 新增：处理未接听的通话
    async handleCallMissed(offerData) {
        console.log('⏱️ 通话未接听，超时自动挂断');

        // 🔧 关键修复1: 停止铃声
        this.stopRingtone();

        // 🔧 关键修复2: 发送未接听信令
        if (this.callWs?.readyState === WebSocket.OPEN) {
            try {
                this.callWs.send(JSON.stringify({
                    type: 'call_missed',
                    room_id: offerData?.room_id || this.callRoomId,
                    from_user_id: this.currentUser.id,
                    to: this.pendingCallerId,
                    reason: 'missed',
                    media_type: this.callType || 'audio'
                }));
                console.log('📤 已发送 call_missed 信令');
            } catch (e) {
                console.warn('⚠️ 发送未接听信令失败:', e);
            }
        }

        // 🔧 关键修复3: 清理资源
        this.closeIncomingCallModal();

        // 🔧 关键修复4: 关闭可能已创建的 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // 🔧 关键修复5: 重置状态
        this.callState = 'idle';
        this.pendingOffer = null;
        this.pendingCallerId = null;
        this.incomingOffer = null;
        this.callRoomId = null;

        console.log('✅ 未接听通话，资源已清理');
    }

    // 🔧 修复 handleCallAnswer 方法 - 正确处理 SDP 数据
    async handleCallAnswer(data) {
        console.log('📥 处理接听信令:', data);

        if (!this.peerConnection) {
            console.warn('⚠️ peerConnection 未初始化');
            return;
        }

        // 🔧 关键修复：防止重复处理 answer
        if (this.answerProcessed) {
            console.warn('⚠️ Answer 已处理过，忽略重复的 call_answer 信令');
            return;
        }

        try {
            // 🔧 关键修复: 正确解析嵌套的 SDP 数据
            const sdpData = data.data?.sdp || data.sdp;
            const sdpType = data.data?.type || 'answer';  // 默认类型为 answer

            if (!sdpData || !sdpType) {
                console.error('❌ SDP 数据无效');
                this.showError('对方接听失败，请重试');
                this.endCall();
                return;
            }

            // 🔧 关键修复: 正确构造 RTCSessionDescription
            const remoteDescription = new RTCSessionDescription({
                type: sdpType,  // 必须是 'answer'
                sdp: sdpData
            });

            console.log('🔧 设置 RemoteDescription:', {
                type: sdpType,
                currentState: this.peerConnection.signalingState,
                sdpLength: sdpData.length
            });

            await this.peerConnection.setRemoteDescription(remoteDescription);

            console.log('✅ RemoteDescription 设置成功');

            await this.drainIceCandidateQueue(); // 🔧 关键：注入缓存的候选

            // 🔧 关键修复：设置 ICE 超时保护（20秒未连通则提示）
            this.iceTimeoutTimer = setTimeout(() => {
                if (this.peerConnection.iceConnectionState !== 'connected' &&
                    this.peerConnection.iceConnectionState !== 'completed') {
                    console.warn('⏰ ICE 协商超时，当前状态:', this.peerConnection.iceConnectionState);

                    // 🔧 尝试重启 ICE
                    if (this.peerConnection.canTrickleIceCandidates) {
                        console.log('🔄 尝试重启 ICE 协商...');
                        this.peerConnection.restartIce();

                        // 🔧 如果重启后仍然失败，提示用户
                        setTimeout(() => {
                            if (this.peerConnection.iceConnectionState !== 'connected' &&
                                this.peerConnection.iceConnectionState !== 'completed') {
                                console.error('❌ ICE 重启后仍然无法连接');
                                this.showError('网络连接失败，请检查网络或稍后重试');
                                this.endCall();
                            }
                        }, 10000);  // 再等10秒
                    } else {
                        this.showError('网络连接失败。请检查：1. TURN服务器是否正常运行 2.防火墙是否允许 UDP/TCP端口 3478/5349 3. 尝试刷新页面后重试');
                        this.endCall();
                    }
                }
            }, 20000);  // 🔧 增加到20秒

            // 🔧 关键修复：标记 answer 已处理
            this.answerProcessed = true;

            // 🔧 关键修复：不在这里更新状态，等 ICE 连接成功后再更新
            // this.callState = 'connected';  // ❌ 删除这行
            // this.startCallDurationTimer();  // ❌ 删除这行

            console.log('⏳ 等待 ICE 连接建立...');

            // 🔧 关键修复: 恢复音频上下文（移动端必需）
            if (this.audioContextForMobile?.state === 'suspended') {
                await this.audioContextForMobile.resume();
            }

            console.log('✅ Answer 处理完成');

        } catch (err) {
            console.error('❌ handleCallAnswer 失败:', err);

            // 🔧 关键修复：区分不同类型的错误
            if (err.name === 'InvalidStateError') {
                console.warn('⚠️ SDP 状态错误，可能已收到 answer，忽略此错误');
                // 如果是因为重复设置导致的错误，不显示错误提示，也不结束通话
                // 因为第一次设置已经成功了，ICE 连接会正常建立
                return;
            }

            this.showError(`通话连接失败: ${err.message}`);
            this.endCall();
        }
    }


    async endCall_v1(skipSignal = false) {
        console.log('🔚 结束通话，当前状态:', this.callState);

        // 🔧 关键修复：避免重复执行
        if (this.callState === 'idle') {
            return;
        }

        // 🔧 新增：计算通话时长
        let callDuration = 0;
        if (this.callStartTime) {
            callDuration = Math.floor((Date.now() - this.callStartTime) / 1000); // 转换为秒
            console.log('⏱️ 通话时长:', callDuration, '秒', '(callStartTime:', new Date(this.callStartTime).toLocaleTimeString(), ')');
        } else {
            console.warn('⚠️ callStartTime 为空，通话未接通，时长将为0');
            console.log('🔍 当前状态:', {
                callState: this.callState,
                peerConnection: !!this.peerConnection,
                iceConnectionState: this.peerConnection?.iceConnectionState
            });
        }

        // 🔧 新增：停止通话时长定时器
        if (this.callDurationTimer) {
            clearInterval(this.callDurationTimer);
            this.callDurationTimer = null;
        }

        // 1. 停止媒体流
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log('🎤 已停止媒体轨道:', track.kind);
            });
            this.localStream = null;
        }

        // 2. 关闭 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.ontrack = null;
            this.peerConnection.onicecandidate = null;
            this.peerConnection.close();
            this.peerConnection = null;
            console.log('🔌 已关闭 RTCPeerConnection');
        }

        // 3. 🔧 关键修复：条件发送结束信令，包含通话时长信息
        if (!skipSignal && this.callWs?.readyState === WebSocket.OPEN) {
            try {
                const endMessage = {
                    type: 'call_end',
                    room_id: this.callRoomId,
                    from_user_id: this.currentUser.id,  // 🔧 当前用户就是发起方
                    duration: callDuration,  // 🔧 新增：通话时长（秒）
                    media_type: this.callType || 'audio'  // 🔧 新增：通话类型
                };
                console.log('📤 准备发送 call_end 信令:', JSON.stringify(endMessage));

                this.callWs.send(JSON.stringify(endMessage));
                console.log('✅ 已发送 call_end 信令，时长:', callDuration, '秒');
            } catch (e) {
                console.error('❌ 发送结束信令失败:', e.message);
            }
        } else {
            console.warn('⚠️ 跳过发送 call_end 信令: skipSignal=', skipSignal, ', callWs状态=', this.callWs?.readyState);
        }

        // 4. 关闭信令 WebSocket
        if (this.callWs) {
            if (this.callWs.readyState <= WebSocket.OPEN) {
                this.callWs.close(1000, 'Call ended');
            }
            this.callWs = null;
        }


        // 5. 重置状态
        this.callState = 'idle';
        this.callType = null;
        this.remoteStream = null;
        this.remoteStreamSet = false;  // 🔧 关键修复：重置远程流设置标志
        this.audioStreamSet = false;   // 🔧 新增：重置音频标志
        this.videoStreamSet = false;   // 🔧 新增：重置视频标志
        this.callRoomId = null;
        this.pendingOffer = null;
        this.pendingCallerId = null;

        // 🔧 新增：重置通话时长追踪
        this.callStartTime = null;

        // 🔧 关键修复：重置 answer 处理标志
        this.answerProcessed = false;

        // 🔧 关键修复：禁用通话保护
        this.isCallInProgress = false;
        console.log('🔓 通话保护已禁用');

        this.updateCallUI('idle');
        this.closeIncomingCallModal();
        this.stopRingtone(); // 🔧 确保停止铃声
        this.stopCallerRingtone(); // 🔧 新增：停止呼叫方铃声

        // 6. 清理 DOM
        const remoteVideo = document.getElementById('remoteVideo');
        const remoteAudio = document.getElementById('remoteAudio');
        const localVideo = document.getElementById('localVideo');

        [remoteVideo, remoteAudio, localVideo].forEach(el => {
            if (el) {
                el.srcObject = null;
                if (el.tagName === 'VIDEO') el.classList.add('hidden');
            }
        });

        console.log('✅ 通话资源已清理');

        // 🔧 重置控制按钮状态
        const muteBtn = document.getElementById('muteBtn');
        const cameraBtn = document.getElementById('cameraBtn');
        const speakerBtn = document.getElementById('speakerBtn');

        if (muteBtn) {
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            muteBtn.classList.remove('muted');
        }
        if (cameraBtn) {
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
            cameraBtn.classList.remove('off');
        }
        if (speakerBtn) {
            speakerBtn.classList.remove('active');
        }

        console.log('✅ 通话控制按钮已重置');

    }

    async endCall(skipSignal = false) {
        console.log('🔚 结束通话，当前状态:', this.callState, 'skipSignal:', skipSignal);
        if (this.callState === 'idle') return;

        let callDuration = 0;
        if (this.callStartTime) {
            callDuration = Math.floor((Date.now() - this.callStartTime) / 1000);
        }

        // 清除所有定时器
        [this.callDurationTimer, this.callTimeoutTimer].forEach(timer => {
            if (timer) {
                clearInterval(timer);
                clearTimeout(timer);
            }
        });
        this.callDurationTimer = null;
        this.callTimeoutTimer = null;

        // 停止媒体流
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        // 关闭 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.ontrack = null;
            this.peerConnection.onicecandidate = null;
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // 发送结束信令（除非页面卸载已手动发送）
        if (!skipSignal && this.callWs?.readyState === WebSocket.OPEN) {
            try {
                this.callWs.send(JSON.stringify({
                    type: 'call_end',
                    room_id: this.callRoomId,
                    from_user_id: this.currentUser.id,
                    duration: callDuration,
                    media_type: this.callType || 'audio'
                }));
            } catch (e) {
                console.warn('发送 end 信令失败:', e);
            }
        }

        // 关闭信令通道
        if (this.callWs) {
            if (this.callWs.readyState <= WebSocket.OPEN) this.callWs.close(1000, 'Call ended');
            this.callWs = null;
        }

        // 🔑 重置所有状态标志
        this.callState = 'idle';
        this.callType = null;
        this.remoteStream = null;
        this.remoteStreamSet = false;
        this.audioStreamSet = false;
        this.videoStreamSet = false;
        this.callRoomId = null;
        this.pendingOffer = null;
        this.pendingCallerId = null;
        this.callStartTime = null;
        this.answerProcessed = false;
        this.isCallInProgress = false;

        // 🔧 重置 ICE 相关状态
        this.pendingIceCandidates = [];
        this.isRemoteDescriptionSet = false;
        this.iceCandidatesCollected = [];
        this.iceTimeoutTimer = null;
        this.processedSignals = new Set();

        this.updateCallUI('idle');
        this.closeIncomingCallModal();
        this.stopRingtone();
        this.stopCallerRingtone();

        // 清理 DOM 视频流
        ['remoteVideo', 'remoteAudio', 'localVideo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.srcObject = null;
                if (el.tagName === 'VIDEO') el.classList.add('hidden');
            }
        });

        // 重置按钮 UI
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            muteBtn.classList.remove('muted');
        }
        const cameraBtn = document.getElementById('cameraBtn');
        if (cameraBtn) {
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
            cameraBtn.classList.remove('off');
        }

        console.log('✅ 通话资源已完全清理');
    }

    // 🔧 新增：更新通话头部显示对方信息
    updateCallHeaderWithTargetInfo(targetUserId) {
        const targetUser = this.users?.find(u => u.id === targetUserId);
        if (!targetUser) {
            console.warn('⚠️ 未找到目标用户信息');
            return;
        }

        const statusText = document.getElementById('callStatusText');
        if (statusText) {
            statusText.textContent = `📞 正在呼叫: ${targetUser.real_name || targetUser.username}`;
        }

        // 🔧 可以在这里添加头像显示逻辑（如果需要）
        console.log('📞 正在呼叫:', targetUser.real_name || targetUser.username);
    }

    // 🔧 新增：播放呼叫方铃声（与接听方铃声区分）
    playCallerRingtone() {
        try {
            // 使用 Web Audio API 生成不同的提示音（高频短促声）
            if (!this.callerRingtoneContext) {
                this.callerRingtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const oscillator = this.callerRingtoneContext.createOscillator();
            const gainNode = this.callerRingtoneContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(1200, this.callerRingtoneContext.currentTime); // 更高频率

            // 创建“嘟嘟嘟”的节奏（每 1.5 秒响一次）
            const startTime = this.callerRingtoneContext.currentTime;
            for (let i = 0; i < 40; i++) {  // 循环 40 次，约 1 分钟
                const t = startTime + i * 1.5;
                gainNode.gain.setValueAtTime(0.2, t);
                gainNode.gain.setValueAtTime(0, t + 0.2);  // 更短的响声
            }

            oscillator.connect(gainNode);
            gainNode.connect(this.callerRingtoneContext.destination);

            oscillator.start();

            // 保存引用以便清理
            this.callerRingtoneOscillator = oscillator;

            console.log('🔔 呼叫方铃声响中（高频短促声）');
        } catch (e) {
            console.warn('🔔 呼叫方铃声失败:', e);
        }
    }

    // 🔧 新增：停止呼叫方铃声
    stopCallerRingtone() {
        if (this.callerRingtoneOscillator) {
            try {
                this.callerRingtoneOscillator.stop();
                this.callerRingtoneOscillator.disconnect();
            } catch (e) {
                // 可能已经停止
            }
            this.callerRingtoneOscillator = null;
        }

        if (this.callerRingtoneContext && this.callerRingtoneContext.state !== 'closed') {
            this.callerRingtoneContext.close().catch(() => {
            });
            this.callerRingtoneContext = null;
        }

        console.log('🔕 呼叫方铃声已停止');
    }

    // 🔧 新增：启动通话时长定时器
    startCallDurationTimer() {
        // 清除旧的定时器
        if (this.callDurationTimer) {
            clearInterval(this.callDurationTimer);
        }

        // 每秒更新一次通话时长显示
        this.callDurationTimer = setInterval(() => {
            if (this.callStartTime && this.callState === 'connected') {
                const duration = Math.floor((Date.now() - this.callStartTime) / 1000);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                // 更新UI显示
                const callTimer = document.getElementById('callTimer');
                if (callTimer) {
                    callTimer.textContent = timeStr;
                    callTimer.classList.remove('hidden');
                    callTimer.style.display = 'block'; // 🔧 确保覆盖 .hidden 的 display: none !important
                }
            }
        }, 1000);

        console.log('⏱️ 通话时长定时器已启动');
    }


    // 辅助方法

    // 🔧 修复：playRingtone 方法 - 添加备用 Web Audio 方案
    playRingtone() {
        try {
            // 方案1: 尝试播放 MP3 文件
            if (!this.ringtoneAudio) {
                this.ringtoneAudio = new Audio('/static/sounds/ringtone.mp3');
                this.ringtoneAudio.loop = true;
                this.ringtoneAudio.volume = 0.6;
            }

            this.ringtoneAudio.play().catch(err => {
                console.warn('🔔 MP3 铃声播放失败，使用备用方案:', err);
                // 🔧 方案2: 使用 Web Audio API 生成提示音
                this.playRingtoneWithWebAudio();
            });
        } catch (e) {
            console.warn('🔔 铃声初始化失败，使用备用方案:', e);
            this.playRingtoneWithWebAudio();
        }
    }

    // 🔧 新增：Web Audio API 生成来电铃声（持续循环）
    playRingtoneWithWebAudio() {
        try {
            // 确保 AudioContext 已创建
            if (!this.ringtoneContext) {
                this.ringtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // 如果上下文被挂起，尝试恢复
            if (this.ringtoneContext.state === 'suspended') {
                this.ringtoneContext.resume().catch(() => {
                });
            }

            // 创建振荡器生成“嘟嘟”声
            const oscillator = this.ringtoneContext.createOscillator();
            const gainNode = this.ringtoneContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, this.ringtoneContext.currentTime); // A5 音符

            // 🔧 关键修复：创建持续循环的节奏（不再限制5秒）
            gainNode.gain.setValueAtTime(0, this.ringtoneContext.currentTime);

            const startTime = this.ringtoneContext.currentTime;
            // 🔧 循环120次，约1分钟（每次0.5秒）
            for (let i = 0; i < 120; i++) {
                const t = startTime + i * 0.5;
                gainNode.gain.setValueAtTime(0.3, t);
                gainNode.gain.setValueAtTime(0, t + 0.3);
            }

            oscillator.connect(gainNode);
            gainNode.connect(this.ringtoneContext.destination);

            oscillator.start();
            // 🔧 关键修复：不再设置 stop 时间，让铃声持续直到手动停止
            // oscillator.stop(startTime + 5); // ❌ 删除这行

            // 保存引用以便清理
            this.ringtoneOscillator = oscillator;

            console.log('✅ Web Audio 铃声播放中（持续循环）');
        } catch (e) {
            console.warn('🔔 Web Audio 铃声也失败:', e);
            // 最终降级：视觉提示
            this.showToast('📞 有来电', 'info');
        }
    }

    // 🔧 新增：停止铃声（清理资源）
    stopRingtone() {
        // 停止 MP3
        if (this.ringtoneAudio) {
            this.ringtoneAudio.pause();
            this.ringtoneAudio.currentTime = 0;
        }

        // 停止 Web Audio
        if (this.ringtoneOscillator) {
            try {
                this.ringtoneOscillator.stop();
                this.ringtoneOscillator.disconnect();
            } catch (e) {
                // 可能已经停止
            }
            this.ringtoneOscillator = null;
        }

        // 关闭 AudioContext（可选）
        if (this.ringtoneContext && this.ringtoneContext.state !== 'closed') {
            this.ringtoneContext.close().catch(() => {
            });
            this.ringtoneContext = null;
        }

        // 🔧 新增：清除超时定时器
        if (this.callTimeoutTimer) {
            clearTimeout(this.callTimeoutTimer);
            this.callTimeoutTimer = null;
            console.log('⏱️ 来电超时定时器已清除');
        }
    }


    // 🔧 新增：安全的视频播放方法
    async playVideoElement(videoElement) {
        if (!videoElement) return;

        try {
            // 确保必要属性
            videoElement.playsInline = true;
            videoElement.autoplay = true;
            videoElement.muted = false; // 取消静音以播放声音

            // 尝试播放
            await videoElement.play();
            console.log('✅ 视频播放成功');
        } catch (err) {
            // 🔧 降级方案1: 先静音播放
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                console.warn('⚠️ 尝试静音播放视频...');
                videoElement.muted = true;
                await videoElement.play();

                // 显示提示让用户取消静音
                this.showToast('🔇 视频已静音，点击取消静音', 'info');

                // 添加点击取消静音的功能
                videoElement.onclick = () => {
                    videoElement.muted = false;
                    videoElement.onclick = null;
                };
            } else {
                throw err;
            }
        }
    }

    // 🔧 新增：安全的音频播放方法
    async playAudioElement(audioElement) {
        if (!audioElement) return;

        try {
            await audioElement.play();
            console.log('✅ 音频播放成功');
        } catch (err) {
            // 音频播放需要用户交互，显示友好提示
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                console.warn('⚠️ 音频播放需要用户交互');
                this.showToast('🔊 请点击页面启用音频', 'info');

                // 添加一次性点击监听
                const enableAudio = () => {
                    audioElement.play().then(() => {
                        console.log('✅ 用户交互后音频播放成功');
                    }).catch(e => {
                        console.warn('⚠️ 音频播放仍失败:', e);
                    });
                    document.removeEventListener('click', enableAudio);
                    document.removeEventListener('touchstart', enableAudio);
                };

                document.addEventListener('click', enableAudio, {once: true});
                document.addEventListener('touchstart', enableAudio, {once: true});
            } else {
                throw err;
            }
        }
    }

    // 🔧 获取当前聊天目标用户 ID（支持群聊场景）
    getCurrentChatTargetUserId() {
        const room = this.chatRooms.find(r => r.id === parseInt(this.currentRoomId));
        if (!room) {
            console.warn('⚠️ 未找到聊天室');
            this.showError('请先选择一个聊天对象');
            return null;
        }

        // 🔧 关键修复：群聊时给予友好提示
        if (room.room_type === 'group') {
            console.warn('⚠️ 群聊暂不支持语音/视频通话');
            this.showConfirmDialog(
                '💡 功能提示',
                '当前版本暂不支持群组语音/视频通话，请选择私聊进行通话'
            ).then(() => {
                // 用户确认后关闭对话框
            });
            return null;
        }

        const other = room.members.find(m => m.id !== this.currentUser.id);
        return other ? other.id : null;
    }

    // 🔧 更新通话 UI 状态
    updateCallUI(state, callerId = null) {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) {
            console.warn('⚠️ callOverlay 元素未找到');
            return;
        }

        // 移除所有状态类
        overlay.classList.remove('calling', 'ringing', 'connected', 'hidden');

        // 添加当前状态类
        if (state === 'idle') {
            overlay.classList.add('hidden');
        } else {
            overlay.classList.add(state);
        }

        // 🔧 更新状态文本
        const statusText = document.getElementById('callStatusText');
        if (statusText) {
            const statusMap = {
                'calling': '正在呼叫...',
                'ringing': '来电中...',
                'connected': '通话中',
                'ended': '通话已结束'
            };

            // 🔧 关键修复：如果是发起方且处于 calling 状态，应该显示对方名字（已在 updateCallHeaderWithTargetInfo 中设置）
            // 如果是接听方或已连接，则使用默认状态文本
            if (state === 'calling') {
                // 保持当前显示的对方名字，不覆盖
                console.log('📞 保持显示对方名字');
            } else {
                statusText.textContent = statusMap[state] || '';
            }
        }

        // 🔧 更新呼叫方名称（仅 ringing 状态）
        if (state === 'ringing' && callerId) {
            const callerNameEl = document.getElementById('callCallerName');
            if (callerNameEl) {
                const caller = this.users?.find(u => u.id === callerId) ||
                    {real_name: '未知用户', username: 'unknown'};
                callerNameEl.textContent = `${caller.real_name || caller.username} 请求通话`;
            }
        }

        // 🔧 显示/隐藏控制按钮
        const controls = document.getElementById('callControls');
        if (controls) {
            if (state === 'connected' || state === 'calling') {
                controls.style.display = 'flex';
                console.log('🎮 通话控制按钮已显示 (state:', state, ')');
            } else {
                console.log('state: ', state)
                controls.style.display = 'none';
            }
        }

        // 🔧 关键修复：在 calling 状态下只显示挂断按钮，隐藏其他按钮
        if (state === 'calling') {
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.style.display = 'none';
            }
            const cameraBtn = document.getElementById('cameraBtn');
            if (cameraBtn) {
                cameraBtn.style.display = 'none';
            }
            const switchCameraBtn = document.getElementById('btnSwitchCamera');
            if (switchCameraBtn) {
                switchCameraBtn.style.display = 'none';
            }
            const speakerBtn = document.getElementById('speakerBtn');
            if (speakerBtn) {
                speakerBtn.style.display = 'none';
            }
            const endCallBtn = document.getElementById('btnEndCall');
            if (endCallBtn) {
                endCallBtn.style.display = 'flex';
                console.log('📞 呼叫中，显示挂断按钮');
            }
        }

        // 🔧 显示/隐藏通话时长 - 关键修复：同时移除 hidden 类和设置 display
        const callTimer = document.getElementById('callTimer');
        if (callTimer) {
            if (state === 'connected') {
                callTimer.classList.remove('hidden');
                callTimer.style.display = 'block'; // 🔧 确保覆盖 .hidden 的 display: none !important
                console.log('⏱️ 通话时长已显示');
            } else {
                callTimer.classList.add('hidden');
                callTimer.style.display = ''; // 恢复默认
            }
        }

        // 🔧 关键修复：在视频通话连接时显示所有控制按钮（移动端和PC端）
        if (state === 'connected' && this.callType === 'video') {
            const switchCameraBtn = document.getElementById('btnSwitchCamera');
            if (switchCameraBtn) {
                switchCameraBtn.style.display = 'flex'; // 🔧 使用 flex 以匹配 CSS
                console.log('📹 切换摄像头按钮已显示');
            }
            const videoToggleBtn = document.getElementById('cameraBtn');
            if (videoToggleBtn) {
                videoToggleBtn.style.display = 'flex'; // 🔧 使用 flex 以匹配 CSS
                console.log('📷 摄像头开关按钮已显示');
            }
            const speakerBtn = document.getElementById('speakerBtn');
            if (speakerBtn) {
                speakerBtn.style.display = 'flex'; // 🔧 使用 flex 以匹配 CSS
                console.log('🔊 免提按钮已显示');
            }
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.style.display = 'flex'; // 🔧 确保静音按钮也显示
            }
            const endCallBtn = document.getElementById('btnEndCall');
            if (endCallBtn) {
                endCallBtn.style.display = 'flex'; // 🔧 确保挂断按钮也显示
            }
        } else if (state === 'connected') {
            // 语音通话时只显示静音和挂断按钮
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.style.display = 'flex';
            }
            const endCallBtn = document.getElementById('btnEndCall');
            if (endCallBtn) {
                endCallBtn.style.display = 'flex';
            }
            // 隐藏视频相关按钮
            const switchCameraBtn = document.getElementById('btnSwitchCamera');
            if (switchCameraBtn) {
                switchCameraBtn.style.display = 'none';
            }
            const videoToggleBtn = document.getElementById('cameraBtn');
            if (videoToggleBtn) {
                videoToggleBtn.style.display = 'none';
            }
            const speakerBtn = document.getElementById('speakerBtn');
            if (speakerBtn) {
                speakerBtn.style.display = 'none';
            }
        } else {
            // 非 connected 状态时隐藏所有按钮（除了 calling 状态下的挂断按钮）
            if (state !== 'calling') {
                const switchCameraBtn = document.getElementById('btnSwitchCamera');
                if (switchCameraBtn) {
                    switchCameraBtn.style.display = 'none';
                }
                const videoToggleBtn = document.getElementById('cameraBtn');
                if (videoToggleBtn) {
                    videoToggleBtn.style.display = 'none';
                }
                const speakerBtn = document.getElementById('speakerBtn');
                if (speakerBtn) {
                    speakerBtn.style.display = 'none';
                }
                const muteBtn = document.getElementById('muteBtn');
                if (muteBtn) {
                    muteBtn.style.display = 'none';
                }
                const endCallBtn = document.getElementById('btnEndCall');
                if (endCallBtn) {
                    endCallBtn.style.display = 'none';
                }
            }
        }

        console.log(`🎨 UI 已更新为状态: ${state}`);
    }

    // 🔧 切换静音/取消静音
    toggleMute() {
        if (!this.localStream) return;

        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.innerHTML = audioTrack.enabled
                    ? '<i class="fas fa-microphone"></i>'
                    : '<i class="fas fa-microphone-slash"></i>';
                muteBtn.classList.toggle('muted', !audioTrack.enabled);
            }
            console.log(`🔇 音频已${audioTrack.enabled ? '开启' : '静音'}`);
        }
    }

    // 🔧 切换摄像头
    toggleCamera() {
        if (!this.localStream || this.callType !== 'video') return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const cameraBtn = document.getElementById('cameraBtn');
            if (cameraBtn) {
                cameraBtn.innerHTML = videoTrack.enabled
                    ? '<i class="fas fa-video"></i>'
                    : '<i class="fas fa-video-slash"></i>';
                cameraBtn.classList.toggle('off', !videoTrack.enabled);
            }
            console.log(`📹 摄像头已${videoTrack.enabled ? '开启' : '关闭'}`);
        }
    }

    // 🔧 切换前后摄像头（移动端）
    async switchCamera() {
        if (this.callType !== 'video' || !this.localStream) return;

        try {
            const videoTrack = this.localStream.getVideoTracks()[0];
            const capabilities = videoTrack.getCapabilities();

            if (capabilities.facingMode) {
                const currentMode = videoTrack.getSettings().facingMode;
                const newMode = currentMode === 'user' ? 'environment' : 'user';

                const constraints = {
                    audio: true,
                    video: {facingMode: {exact: newMode}}
                };

                const newStream = await navigator.mediaDevices.getUserMedia(constraints);
                const newVideoTrack = newStream.getVideoTracks()[0];

                // 替换轨道
                this.peerConnection.getSenders().forEach(sender => {
                    if (sender.track?.kind === 'video') {
                        sender.replaceTrack(newVideoTrack);
                    }
                });

                // 更新本地预览
                const localVideo = document.getElementById('localVideo');
                if (localVideo) {
                    localVideo.srcObject = newStream;
                }

                // 停止旧轨道
                videoTrack.stop();
                this.localStream = newStream;

                console.log(`🔄 摄像头已切换为: ${newMode}`);
            }
        } catch (err) {
            console.warn('⚠️ 切换摄像头失败:', err);
            this.showToast('当前设备不支持切换摄像头', 'info');
        }
    }


    // 🔧 新增：切换免提模式
    // 🔹 独立方法：切换免提模式（功能逻辑，与事件绑定分离）
    toggleSpeaker() {
        console.log('🔊 切换免提模式');

        // 移动端：尝试切换音频输出设备
        if (Utils.isMobile()) {
            const audioEl = document.getElementById('remoteAudio');
            if (audioEl?.setSinkId) {
                // 切换到扬声器（空字符串表示默认设备）
                audioEl.setSinkId('').catch(err => {
                    console.warn('⚠️ 切换音频输出失败:', err);
                    this.showToast('切换免提失败', 'error');
                });
            }
        }

        // 更新按钮状态
        const speakerBtn = document.getElementById('speakerBtn');
        if (speakerBtn) {
            speakerBtn.classList.toggle('active');
            const isActive = speakerBtn.classList.contains('active');
            this.showToast(isActive ? '已切换为免提' : '已切换为听筒', 'info');
        }
    }

    // 🔧 新增：最小化通话窗口
    minimizeCallWindow_v1() {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) return;

        const isMinimized = overlay.classList.contains('minimized');

        if (isMinimized) {
            // 恢复最大化
            overlay.classList.remove('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-minus"></i>';
                minimizeBtn.title = '最小化';
            }
            console.log('✅ 通话窗口已恢复');
        } else {
            // 最小化
            overlay.classList.add('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-expand"></i>';
                minimizeBtn.title = '最大化';
            }
            console.log('✅ 通话窗口已最小化');
            this.showToast('点击最大化按钮可恢复通话窗口', 'info');
        }
    }

    minimizeCallWindow() {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) return;

        const isMinimized = overlay.classList.contains('minimized');

        if (isMinimized) {
            overlay.classList.remove('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-minus"></i>';
                minimizeBtn.title = '最小化';
            }
            // 恢复隐藏的非核心按钮
            document.querySelectorAll('.call-btn').forEach(btn => btn.style.display = '');
            console.log('✅ 通话窗口已恢复最大化');
        } else {
            overlay.classList.add('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-expand"></i>';
                minimizeBtn.title = '最大化';
            }
            console.log('✅ 通话窗口已最小化');
        }
    }


    // 🔧 通话控制按钮绑定（在 setupEventListeners 末尾添加）
    setupCallControls() {
        console.log('🔧 绑定通话控制按钮事件');

        // 静音按钮
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleMute();
            };
        }

        // 摄像头按钮
        const cameraBtn = document.getElementById('cameraBtn');
        if (cameraBtn) {
            cameraBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleCamera();
            };
        }

        // 切换摄像头按钮（移动端）
        const switchCameraBtn = document.getElementById('switchCameraBtn');
        if (switchCameraBtn) {
            switchCameraBtn.onclick = (e) => {
                e.stopPropagation();
                this.switchCamera();
            };
            // 仅在移动端显示
            if (!Utils.isMobile()) {
                switchCameraBtn.style.display = 'none';
            }
        }

        // 挂断按钮
        const hangupBtn = document.getElementById('hangupBtn');
        if (hangupBtn) {
            hangupBtn.onclick = (e) => {
                e.stopPropagation();
                this.endCall(false);  // 主动挂断，需要发送信令
            };
        }

        // 🔧 新增：最小化按钮
        const minimizeBtn = document.getElementById('minimizeCallBtn');
        if (minimizeBtn) {
            minimizeBtn.onclick = (e) => {
                e.stopPropagation();
                this.minimizeCallWindow();
            };
        }

        // 免提按钮（可选）
        const speakerBtn = document.getElementById('speakerBtn');
        if (speakerBtn) {
            speakerBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleSpeaker();
            };
        }

        console.log('✅ 通话控制按钮绑定完成');
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


// 全局版本管理器实例
const versionManager = new VersionManager();

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