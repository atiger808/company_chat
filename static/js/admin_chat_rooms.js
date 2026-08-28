// static/js/admin_chat_rooms.js
class AdminChatRoomsClient {
    constructor() {

        this.isInitialized = false;
        this.currentRoomId = null;
        this.currentRoom = null;
        this.roomMessages = [];
        this.chatRooms = [];

        // 消息分页状态
        this.currentPage = 1;
        this.hasMoreMessages = true;
        this.isLoading = false;
        this.oldestMessageId = null;    // 最早消息的 ID (用于向上加载)
        this.newestMessageId = null;    // 最新消息的 ID

        // 聊天室列表分页状态
        this.chatRoomsPage = 1;
        this.chatRoomsPageSize = 20;
        this.chatRoomsHasMore = true;
        this.chatRoomsLoading = false;
        this.lastScrollRoomId = null;   // 记录最后看到的聊天室 ID 用于位置恢复

        // 🔧 新增：语音播放器状态管理
        this.voicePlayers = new Map(); // 存储音频播放器实例 { messageId: audioElement }
        this.currentPlayingId = null;  // 当前正在播放的语音 ID

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            console.log('AdminChatRoomsClient DOMContentLoaded');
            // this.init();
        }
    }

    init() {
        // 🔧 防止重复初始化
        if (this.isInitialized) {
            console.log('AdminChatRoomsClient 已初始化，跳过');
            return;
        }
        console.log('AdminChatRoomsClient 初始化开始...');

        // 🔧 移动端禁止缩放
        this.setupMobileViewport();

        // 🔧 初始化事件监听
        this.setupEventListeners();

        // 🔧 关键修复：添加语音消息事件委托（处理动态生成的语音元素）
        this.setupImageMessageListeners();


        // 🔧 新增：注入引用消息样式
        this.injectQuoteMessageStyles();


        // 加载聊天室列表
        this.loadChatRooms();

        // 设置聊天室列表无限滚动 (如果需要)
        this.setupChatRoomsInfiniteScroll();

        this.isInitialized = true;
    }

    // 🔧 新增：注入引用消息的CSS样式
    injectQuoteMessageStyles() {
        const styleId = 'admin-quote-message-styles';
        if (document.getElementById(styleId)) return; // 避免重复注入

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `            /* 引用消息样式 */
            .message-quote-history {
                margin-bottom: 8px;
                padding: 8px 10px;
                background: rgba(0, 0, 0, 0.03);
                border-left: 3px solid #409EFF;
                border-radius: 4px;
                font-size: 13px;
                color: #606266;
            }
            
            .history-message.sent .message-quote-history {
                background: rgba(255, 255, 255, 0.15);
                border-left-color: rgba(255, 255, 255, 0.6);
            }
            
            .quote-header-history {
                display: flex;
                align-items: center;
                margin-bottom: 4px;
                font-weight: 500;
            }
            
            .quote-header-history i {
                margin-right: 4px;
                color: #909399;
                font-size: 12px;
            }
            
            .history-message.sent .quote-header-history i {
                color: rgba(255, 255, 255, 0.7);
            }
            
            .quote-sender-history {
                color: #409EFF;
                font-weight: 600;
            }
            
            .history-message.sent .quote-sender-history {
                color: rgba(255, 255, 255, 0.9);
            }
            
            .quote-content-history {
                line-height: 1.5;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            
            .quote-content-history i {
                margin-right: 4px;
            }
        `;
        document.head.appendChild(style);
        console.log('✅ 引用消息样式已注入');
    }

    // 🔧 新增：移动端禁止缩放
    setupMobileViewport() {
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            // 确保包含 user-scalable=no
            if (!viewport.content.includes('user-scalable=no')) {
                viewport.content += ', user-scalable=no';
            }
        } else {
            const meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
            document.head.appendChild(meta);
        }
    }

    // 🔧 新增：设置事件监听
    setupEventListeners() {
        // 聊天室列表刷新按钮
        const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');
        if (refreshRoomsBtn) {
            refreshRoomsBtn.addEventListener('click', () => {
                this.chatRoomsPage = 1;
                this.chatRoomsHasMore = true;
                this.loadChatRooms();
            });
        }

        // 返回按钮
        const backToRoomsBtn = document.getElementById('backToRoomsBtn');
        if (backToRoomsBtn) {
            backToRoomsBtn.addEventListener('click', () => {
                this.backToRooms();
            });
        }

        // 搜索聊天室
        const roomSearchInput = document.getElementById('roomSearchInput');
        if (roomSearchInput) {
            roomSearchInput.addEventListener('input', (e) => {
                this.searchRooms(e.target.value);
            });
        }

        // 搜索消息
        const messageSearchInput = document.getElementById('messageSearchInput');
        if (messageSearchInput) {
            messageSearchInput.addEventListener('input', (e) => {
                this.searchMessages(e.target.value);
            });
        }

        // 导出历史
        const exportHistoryBtn = document.getElementById('exportHistoryBtn');
        if (exportHistoryBtn) {
            exportHistoryBtn.addEventListener('click', () => {
                this.exportRoomHistory();
            });
        }

    }


    // 🔧 新增：设置图片消息事件监听（事件委托）
    setupImageMessageListeners() {
        const messagesList = document.getElementById('messagesHistoryList');
        if (!messagesList) return;

        // 🔧 关键修复：事件委托只绑定一次。renderRoomHistory 每次渲染都会调用本方法，
        // 若重复绑定会导致一次点击触发多次 previewImage、创建多个覆盖层与键盘监听，
        // 造成「首次预览正常、再进另一个聊天室预览时切换错乱」。
        if (!this._imageClickBound) {
            this._imageClickBound = true;
            messagesList.addEventListener('click', (e) => {
                // 处理图片预览点击
                const imageEl = e.target.closest('.message-image-img');
                if (imageEl) {
                    e.stopPropagation();
                    this.previewImage(imageEl.src);
                }
            });
        }

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

    // ==================== 聊天室列表功能 ====================

    // 加载聊天室列表（支持分页）
    async loadChatRooms(append = false, currentPage=null) {
        if (this.chatRoomsLoading) return;
        this.chatRoomsLoading = true;

        console.log('currentPage: ', currentPage)
        console.log('this.chatRoomsPage: ', this.chatRoomsPage)

        currentPage = currentPage || this.chatRoomsPage;

        try {
            if (!append) {
                this.showLoading();
                // 记录当前视口中的第一个房间 ID，以便恢复位置
                const firstVisibleRow = document.querySelector('#chatRoomsTableBody tr');
                if (firstVisibleRow) {
                    this.lastScrollRoomId = firstVisibleRow.dataset.roomId;
                }
            } else {
                currentPage += 1;
            }

            const params = new URLSearchParams({
                page: currentPage.toString(),
                page_size: this.chatRoomsPageSize.toString()
            });

            const response = await fetch(`/api/chat/admin/chat-rooms/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '加载聊天室列表失败');
            }

            const data = await response.json();
            const rooms = data.results || [];

            if (append) {
                this.chatRooms = [...this.chatRooms, ...rooms];
            } else {
                this.chatRooms = rooms;
            }

            this.chatRoomsPage = data.page || 1;
            this.chatRoomsHasMore = data.next ? true : false;

            // console.log('加载聊天室列表成功 data:', data);
            // console.log('加载聊天室列表成功 rooms:', rooms);
            // console.log('加载聊天室列表成功 chatRooms:', this.chatRooms);
            console.log('加载聊天室列表成功 append:', append);
            console.log('加载聊天室列表成功 chatRoomsPage:', this.chatRoomsPage);
            console.log('加载聊天室列表成功 chatRoomsHasMore:', this.chatRoomsHasMore);

            this.renderChatRooms(this.chatRooms);
            this.updateChatRoomsLoadMoreButton();

            // 🔧 恢复滚动位置
            if (append && this.lastScrollRoomId) {
                setTimeout(() => {
                    const row = document.querySelector(`tr[data-room-id="${this.lastScrollRoomId}"]`);
                    if (row) {
                        row.scrollIntoView({behavior: 'auto', block: 'start'});
                    }
                }, 100);
            }

        } catch (error) {
            console.error('加载聊天室列表失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.chatRoomsLoading = false;
            this.hideLoading();
        }
    }

    // 🔧 新增：更新聊天室列表加载更多按钮状态
    updateChatRoomsLoadMoreButton() {
        let loadMoreContainer = document.getElementById('loadMoreChatRoomsContainer');
        if (!loadMoreContainer) {
            loadMoreContainer = document.createElement('div');
            loadMoreContainer.id = 'loadMoreChatRoomsContainer';
            loadMoreContainer.className = 'load-more-container';
            loadMoreContainer.innerHTML = `<button id="loadMoreChatRoomsBtn" class="btn btn-secondary">加载更多</button>`;
            const tableContainer = document.querySelector('.admin-table-container');
            if (tableContainer && tableContainer.parentNode) {
                tableContainer.parentNode.insertBefore(loadMoreContainer, tableContainer.nextSibling);
            }
        }

        const loadMoreBtn = document.getElementById('loadMoreChatRoomsBtn');
        if (!loadMoreBtn) return;

        if (this.chatRoomsHasMore) {
            loadMoreContainer.style.display = 'block';
            loadMoreBtn.disabled = !this.chatRoomsHasMore;
            loadMoreBtn.textContent = !this.chatRoomsHasMore ? '加载中...' : '加载更多';
            loadMoreBtn.onclick = () => this.loadMoreChatRooms();
        } else {
            loadMoreContainer.style.display = 'none';
        }
    }

    // 🔧 新增：加载更多聊天室
    async loadMoreChatRooms() {
        if (!this.chatRoomsHasMore || this.chatRoomsLoading) return;
        await this.loadChatRooms(true);
    }

    // 设置聊天室列表无限滚动
    setupChatRoomsInfiniteScroll() {
        const tableContainer = document.querySelector('.admin-table-container');
        if (!tableContainer) return;

        tableContainer.addEventListener('scroll', () => {
            if (this.chatRoomsHasMore && !this.chatRoomsLoading) {
                const {scrollTop, scrollHeight, clientHeight} = tableContainer;
                if (scrollHeight - scrollTop - clientHeight < 100) {
                    this.loadMoreChatRooms();
                }
            }
        });
    }

    // 渲染聊天室列表
    renderChatRooms(rooms) {
        const chatRoomsTableBody = document.getElementById('chatRoomsTableBody');
        const roomCountEl = document.getElementById('roomCount');

        if (!chatRoomsTableBody || !roomCountEl) return;

        roomCountEl.textContent = `${rooms.length} 个聊天室`;

        let html = '';
        rooms.forEach(room => {
            const lastMessage = room.last_message || {};
            let roomName = room.display_name || '未知聊天室';
            roomName = roomName.indexOf(' - ') > 0 ? roomName : `${roomName} - 我`;
            const roomType = room.room_type === 'private' ? '私聊' : '群聊';
            const roomTypeClass = room.room_type === 'private' ? 'private' : 'group';

            // 🔧 获取当前用户 ID
            const currentUserId = parseInt(localStorage.getItem('user_id'));
            const isSuperAdmin = localStorage.getItem('user_type') === 'super_admin';

            let membersInfo = this.renderMembersInfo(room);

            html += `
                <tr data-room-id="${room.id}">
                    <td>
                        <div class="room-name">
                            <i class="fas fa-${room.room_type === 'private' ? 'user' : 'users'}"></i>
                            <span>${roomName}</span>
                        </div>
                    </td>
                    <td>
                        <span class="room-type-badge ${roomTypeClass}">${roomType}</span>
                    </td>
                    <td>
                        <div class="members-container">
                            ${membersInfo}
                        </div>
                    </td>
                    <td>
                        <div class="last-message">
                            <div class="last-message-content">${this.escapeHtml(room.last_message?.content || '暂无消息')}</div>
                        </div>
                    </td>
                    <td>
                        <div class="updated-at">${room.updated_at ? this.formatDateTime(room.updated_at) : '未知'}</div>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-view-history" data-room-id="${room.id}" title="查看历史">
                                <i class="fas fa-history"></i> 
                            </button>
                            ${isSuperAdmin ? `
                            <button class="action-btn delete" data-room-id="${room.id}" title="删除聊天室" onclick="event.stopPropagation(); adminChatRoomsClient.confirmDeleteRoom(${room.id}, '${this.escapeHtml(roomName)}')">
                                <i class="fas fa-trash-alt"></i> 
                            </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        });

        chatRoomsTableBody.innerHTML = html || `
            <tr>
                <td colspan="6" class="empty-table">
                    <i class="fas fa-inbox"></i>
                    <p>暂无聊天室</p>
                </td>
            </tr>
        `;

        // 绑定查看历史按钮事件
        document.querySelectorAll('.btn-view-history').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const roomId = e.currentTarget.dataset.roomId;
                this.showRoomHistory(roomId);
            });
        });

        this.updateChatRoomsLoadMoreButton();
    }

    // 🔧 辅助方法：渲染成员信息
    renderMembersInfo(room) {
        if (!room.members || room.members.length === 0) return '';
        const memberAvatars = room.members.slice(0, 3).map(member => `
            <img src="${member.avatar_url || '/static/images/default-avatar.png'}" 
                 alt="${member.real_name || member.username}" 
                 title="${member.real_name || member.username}">
        `).join('');

        return `
            <div class="member-avatars">
                ${memberAvatars}
                ${room.members.length > 3 ? `<span class="member-count">+${room.members.length - 3}</span>` : ''}
            </div>
            <div class="member-count-text">${room.members.length} 人</div>
        `;
    }

    // 🔧 新增：确认删除聊天室
    async confirmDeleteRoom(roomId, roomName) {
        const confirmed = await this.showConfirmDialog(
            '删除聊天室',
            `确定要删除聊天室 "<span class="highlight">${roomName}</span>" 吗？<br><small style="color: var(--text-light);">此操作不可恢复，所有消息将被清除！</small>`,
            'danger'
        );

        if (confirmed) {
            await this.deleteRoom(roomId);
        }
    }



    // 🔧 新增：执行删除
    async deleteRoom(roomId) {
        try {
            this.showLoading();
            const response = await fetch(`/api/chat/admin/chat-rooms/${roomId}/`, {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '删除失败');
            }

            this.showSuccess('删除成功', '聊天室已删除');

            // 如果当前正在查看该聊天室的历史，则返回
            if (this.currentRoomId === roomId) {
                this.backToRooms();
            } else {
                // 否则重新加载列表
                this.loadChatRooms();
            }

        } catch (error) {
            console.error('删除聊天室失败:', error);
            this.showError('删除失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // ==================== 聊天室历史消息功能 ====================

    // 显示聊天室历史
    showRoomHistory(roomId) {
        this.currentRoomId = roomId;
        this.currentPage = 1;
        this.hasMoreMessages = true;
        this.roomMessages = [];
        this.oldestMessageId = null;

        // 切换界面
        document.getElementById('chatRoomsListContainer').style.display = 'none';
        document.getElementById('roomHistoryContainer').style.display = 'block';

        this.loadRoomInfo(roomId);
        this.loadRoomHistory(roomId, 1, false);

        // 设置无限滚动监听
        this.setupInfiniteScroll();
    }

    // 加载聊天室信息
    async loadRoomInfo(roomId) {
        try {
            const response = await fetch(`/api/chat/admin/chat-rooms/${roomId}/`, {
                headers: TokenManager.getHeaders()
            });

            if (response.ok) {
                const room = await response.json();
                this.currentRoom = room;

                const roomHistoryTitle = document.getElementById('roomHistoryTitle');
                const roomTypeBadge = document.getElementById('roomTypeBadge');

                if (roomHistoryTitle) {
                    if (room.room_type === 'private') {
                        roomHistoryTitle.textContent = `${room.members[0].real_name || room.members[0].username} - ${room.members[1].real_name || room.members[1].username}`;
                    } else {
                        roomHistoryTitle.textContent = room.display_name || '聊天历史';
                    }

                }
                if (roomTypeBadge) {
                    roomTypeBadge.textContent = room.room_type === 'private' ? '私聊' : '群聊';
                    roomTypeBadge.className = `room-info-badge ${room.room_type === 'private' ? 'private' : 'group'}`;
                }
            }
        } catch (error) {
            console.error('加载聊天室信息失败:', error);
        }
    }

    // 加载聊天室历史消息
    async loadRoomHistory(roomId, page = 1, append = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        if (!append) {
            this.showLoading();
        } else {
            // 🔧 关键：在加载前记录当前最早消息的 ID 和位置，用于恢复滚动
            const messagesList = document.getElementById('messagesHistoryList');
            if (messagesList && this.oldestMessageId) {
                const oldestElement = messagesList.querySelector(`.history-message[data-message-id="${this.oldestMessageId}"]`);
                if (oldestElement) {
                    this.scrollPositionToRestore = oldestElement.offsetTop;
                }
            }
        }

        try {
            const params = new URLSearchParams({
                room_id: roomId,
                page: page.toString(),
                page_size: '50'
            });

            const response = await fetch(`/api/chat/admin/chat-rooms/messages/history/?${params.toString()}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '加载消息历史失败');
            }

            const data = await response.json();
            let results = Array.isArray(data.results) ? data.results : window.EncryptUtils.decryptData(data.results);
            let newMessages = Array.isArray(results) ? data.results : [results];

            // 去重
            if (append && newMessages.length > 0) {
                const existingIds = new Set(this.roomMessages.map(msg => msg.id.toString()));
                newMessages = newMessages.filter(msg => !existingIds.has(msg.id.toString()));
                if (newMessages.length === 0) {
                    this.hasMoreMessages = false;
                }
            }

            if (append && newMessages.length > 0) {
                // 后端返回的是倒序（新->旧），需要反转变成（旧->新）以便插入到顶部
                const reversedMessages = [...newMessages].reverse();
                this.oldestMessageId = reversedMessages[0].id;
                this.roomMessages = [...reversedMessages, ...this.roomMessages];
            } else if (!append && newMessages.length > 0) {
                this.roomMessages = [...newMessages].reverse();
                this.oldestMessageId = this.roomMessages[0]?.id;
                this.newestMessageId = this.roomMessages[this.roomMessages.length - 1]?.id;
            } else if (newMessages.length === 0) {
                this.hasMoreMessages = false;
            }

            this.currentPage = page;
            this.hasMoreMessages = data.has_next;

            // 🔧 关键修复：记录当前正在播放的语音 ID（加载更多前）
            const wasPlayingId = this.currentPlayingId;
            const wasPlayingTime = wasPlayingId ?
                document.getElementById(`voice-audio-${wasPlayingId}`)?.currentTime : 0;


            this.renderRoomHistory(data.room_info);



            const messagesList = document.getElementById('messagesHistoryList');
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


            // 🔧 关键修复：恢复播放状态（如果之前正在播放）
            if (wasPlayingId && append) {
                setTimeout(() => {
                    const audio = document.getElementById(`voice-audio-${wasPlayingId}`);
                    const playBtn = document.querySelector(`.voice-play-btn[data-message-id="${wasPlayingId}"]`);

                    if (audio && playBtn) {
                        audio.currentTime = wasPlayingTime;
                        audio.play().then(() => {
                            playBtn.classList.add('playing');
                            playBtn.querySelector('i').className = 'fas fa-pause';
                        }).catch(() => {
                            // 播放失败，恢复按钮状态
                            playBtn.classList.remove('playing');
                            playBtn.querySelector('i').className = 'fas fa-play';
                        });
                    }
                }, 200);
            }


            // 🔧 关键：恢复滚动位置
            if (append) {
                setTimeout(() => {
                    const messagesList = document.getElementById('messagesHistoryList');
                    if (messagesList && this.scrollPositionToRestore !== undefined) {
                        messagesList.scrollTop = this.scrollPositionToRestore;
                        this.scrollPositionToRestore = undefined;
                    }
                }, 50);
            } else {
                // 首次加载滚动到底部
                setTimeout(() => {
                    const messagesList = document.getElementById('messagesHistoryList');
                    if (messagesList) {
                        messagesList.scrollTop = messagesList.scrollHeight;
                    }
                }, 100);
            }

            this.updateMessagesLoadMoreButton();

        } catch (error) {
            console.error('加载消息历史失败:', error);
            this.showError('加载失败', error.message);
        } finally {
            this.isLoading = false;
            if (!append) {
                this.hideLoading();
            }
        }
    }

    // 更新消息加载更多按钮状态
    updateMessagesLoadMoreButton() {
        const loadMoreContainer = document.getElementById('loadMoreMessagesContainer');
        if (!loadMoreContainer) return;

        if (this.hasMoreMessages) {
            loadMoreContainer.style.display = 'block';
            const btn = loadMoreContainer.querySelector('button');
            if (btn) {
                btn.disabled = !this.hasMoreMessages;
                btn.textContent = !this.hasMoreMessages ? '加载中...' : '加载更多消息';
                btn.onclick = () => this.loadMoreHistory();
            }
        } else {
            loadMoreContainer.style.display = 'none';
        }
    }

    // 渲染聊天室历史
    renderRoomHistory(roomInfo) {
        const messagesList = document.getElementById('messagesHistoryList');
        const emptyState = document.getElementById('historyEmptyState');

        if (!messagesList || !emptyState) return;

        if (this.roomMessages.length === 0) {
            emptyState.style.display = 'flex';
            messagesList.style.display = 'none';
            return;
        } else {
            emptyState.style.display = 'none';
            messagesList.style.display = 'block';
        }

        // 🔧 优化：使用 DocumentFragment 提高渲染性能
        const fragment = document.createDocumentFragment();
        messagesList.innerHTML = ''; // 清空

        const sortedMessages = [...this.roomMessages].sort((a, b) =>
            new Date(a.timestamp) - new Date(b.timestamp)
        );

        sortedMessages.forEach((message, index) => {
            if (index === 0 || this.shouldShowTimestamp(sortedMessages[index - 1], message)) {
                fragment.appendChild(this.renderHistoryTimeStamp(message.timestamp));
            }
            fragment.appendChild(this.renderHistoryMessage(message, roomInfo));
        });

        messagesList.appendChild(fragment);

        // 🔧 关键修复：重新绑定图片消息事件（因为重新渲染会移除旧的事件监听）
        setTimeout(() => {
            this.setupImageMessageListeners();
        }, 50);

        // 🔧 关键修复：渲染后初始化语音消息监听
        setTimeout(() => {
            this.initVoiceMessageListeners();
        }, 100);


    }

    // 判断是否需要显示时间戳
    shouldShowTimestamp(prevMessage, currMessage) {
        if (!prevMessage || !currMessage) return true;
        const prevTime = new Date(prevMessage.timestamp);
        const currTime = new Date(currMessage.timestamp);

        if (prevTime.toDateString() !== currTime.toDateString()) return true;
        return (currTime - prevTime) > 5 * 60 * 1000;
    }

    // 渲染时间戳
    renderHistoryTimeStamp(timestamp) {
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time-divider';
        const date = new Date(timestamp);
        const now = new Date();
        let label;

        if (date.toDateString() === now.toDateString()) label = '今天';
        else if (new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString()) label = '昨天';
        else label = date.toLocaleDateString('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'});

        timeElement.innerHTML = `<span class="message-date-label">${label}</span>`;
        return timeElement;
    }

    // 🔧 核心增强：渲染历史消息（支持所有类型，包括引用消息）
    renderHistoryMessage(message, roomInfo) {
        const currentUserId = parseInt(localStorage.getItem('user_id'));
        const isCurrentUser = message.sender?.id === currentUserId;
        const messageType = isCurrentUser ? 'sent' : 'received';

        const messageElement = document.createElement('div');
        messageElement.className = `history-message ${messageType}`;
        messageElement.setAttribute('data-message-id', message.id);

        let senderName = message.sender?.real_name || message.sender?.username || '未知用户';
        let senderAvatar = message.sender?.avatar_url || '/static/images/default-avatar.png';
        const showSender = true; // 始终显示发送者信息

        let contentHtml = '';
        const fileType = message.message_type;

        switch (fileType) {
            case 'text':
                contentHtml = `<div class="message-text">${message.content || ''}</div>`;
                break;

            case 'emoji':
                contentHtml = `<div class="message-emoji">${message.content}</div>`;
                break;

            case 'image':
                if (message.file_info?.url) {
                    contentHtml = `
                        <div class="message-image">
                            <img src="${message.file_info.url}" alt="图片" class="message-image-img" loading="lazy">
                        </div>`;
                } else {
                    contentHtml = '[图片加载失败]';
                }
                break;

            case 'video':
                if (message.file_info?.url) {
                    // contentHtml = `
                    //     <div class="message-video">
                    //         <video controls preload="metadata" poster="${message.file_info?.thumbnail_url || ''}">
                    //             <source src="${message.file_info.url}" type="${message.file_info.mime_type || 'video/mp4'}">
                    //             您的浏览器不支持视频播放。
                    //         </video>
                    //     </div>`;


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
                    const container = document.createElement('div');
                    container.appendChild(videoContainer);
                    contentHtml = container.outerHTML;

                } else {
                    contentHtml = '[视频加载失败]';
                }
                break;

            case 'voice':
            case 'audio':
                contentHtml = this.renderVoiceMessageInHistory(message);
                break;

            case 'file':
                if (message.file_info?.url) {
                    const iconClass = this.getFileIcon(message.file_info.mime_type, message.file_info.name);
                    contentHtml = `
                        <a href="${message.file_info.url}" target="_blank" class="message-file-link">
                            <div class="message-file">
                                <i class="${iconClass}"></i>
                                <div class="file-info">
                                    <span class="file-name">${message.file_info.name}</span>
                                    <span class="file-size">${this.formatFileSize(message.file_info.size)}</span>
                                </div>
                                <i class="fas fa-download download-icon"></i>
                            </div>
                        </a>`;
                } else {
                    contentHtml = '[文件加载失败]';
                }
                break;

            // 🔧 新增：渲染任务卡片
            case 'task_card':
                try {
                    let taskCardData = message.task_data || null;
                    if (!taskCardData && message.content) {
                        try { taskCardData = JSON.parse(message.content); } catch (_) {}
                    }
                    if (taskCardData) {
                        const statusColors = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
                        const statusText = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};
                        const st = taskCardData.status;
                        const color = statusColors[st] || '#909399';
                        const text = statusText[st] || st || '未知';
                        const assigneeName = taskCardData.assignee_info ? (taskCardData.assignee_info.real_name || taskCardData.assignee_info.username) : (taskCardData.assignee_name || '未指派');
                        const dueDateStr = taskCardData.due_date ? new Date(taskCardData.due_date).toLocaleDateString('zh-CN', {month: 'short', day: 'numeric'}) : '无期限';
                        const title = taskCardData.title || taskCardData.task_title || '任务卡片';
                        contentHtml = `
                            <div class="task-card-message" data-task-id="${taskCardData.id || ''}"
                                 style="max-width: 320px; overflow: hidden; border-radius: 8px; border: 1px solid #e4e7ed; background: #fff; box-shadow: 0 2px 12px 0 rgba(0,0,0,0.05);">
                                <div style="padding: 10px 14px; background: linear-gradient(135deg, #f5f7fa 0%, #e4e7ed 100%); border-bottom: 1px solid #e4e7ed; display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-weight: 600; color: #303133; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                                        <i class="fas fa-tasks" style="color: #409EFF;"></i> 任务卡片
                                    </span>
                                    <span style="font-size: 11px; padding: 2px 8px; border-radius: 10px; color: #fff; background: ${color};">${this.escapeHtml(text)}</span>
                                </div>
                                <div style="padding: 10px 14px;">
                                    <div style="font-size: 14px; color: #303133; margin-bottom: 6px; font-weight: 500;">${this.escapeHtml(title)}</div>
                                    <div style="font-size: 12px; color: #909399; display: flex; flex-direction: column; gap: 3px;">
                                        <span><i class="fas fa-user-circle" style="width: 14px;"></i> ${this.escapeHtml(assigneeName)}</span>
                                        <span><i class="fas fa-clock" style="width: 14px;"></i> 截止: ${dueDateStr}</span>
                                    </div>
                                </div>
                                <div style="padding: 6px 14px; background: #fafafa; border-top: 1px solid #f0f0f0; font-size: 11px; color: #909399; text-align: center;">
                                    点击查看详情 <i class="fas fa-external-link-alt" style="margin-left: 4px;"></i>
                                </div>
                            </div>`;
                    } else {
                        contentHtml = '<span style="color:#909399;"><i class="fas fa-tasks"></i> [任务卡片]</span>';
                    }
                } catch (e) {
                    contentHtml = '<span style="color:#909399;"><i class="fas fa-tasks"></i> [任务卡片]</span>';
                }
                break;

            default:
                contentHtml = `<div class="message-text">${this.escapeHtml(message.content || '[未知消息类型]')}</div>`;
        }

        // 🔧 关键修复：渲染引用消息
        if (message.quote_message_id || message.quote_info) {
            const quoteHtml = this.renderQuotedMessageInHistory(message);
            contentHtml = quoteHtml + contentHtml;
        }

        let html = '';
        if (showSender) {
            if (messageType === 'sent') {
                html += `
                    <div class="message-sender-info right">
                        <span class="message-time">${this.formatTime(message.timestamp)}</span>
                        <img src="${senderAvatar}" alt="我" title="我">
                    </div>`;
            } else {
                html += `
                    <div class="message-sender-info left">
                        <img src="${senderAvatar}" alt="${senderName}" title="${senderName}">
                        <span>${senderName}</span>
                        <span class="message-time">${this.formatTime(message.timestamp)}</span>
                    </div>`;
            }
        }

        html += `<div class="message-bubble ${messageType}">${contentHtml}</div>`;


        // 创建消息内容元素
        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        contentElement.innerHTML = html;

        messageElement.appendChild(contentElement);
        return messageElement;
    }

    // 🔧 新增：渲染历史消息中的引用消息（支持媒体直接渲染和文件滚动定位）
    renderQuotedMessageInHistory(message) {
        // 🔧 获取引用消息的各个字段（兼容多种字段名）
        const quoteSenderId = message.quote_sender_id || message.quote_info?.sender_id;
        const quoteSenderName = message.quote_sender ||
                               message.quote_info?.sender ||
                               message.quoted_sender ||
                               '引用';
        const quoteContent = message.quote_content ||
                            message.quote_info?.content ||
                            message.quoted_content ||
                            '';
        const quoteMessageType = message.quote_message_type ||
                                message.quote_info?.message_type ||
                                'text';
        const quoteFileInfo = message.quote_file_info ||
                             message.quote_info?.file_info ||
                             message.quoted_file_info ||
                             null;
        const quoteMessageId = message.quote_message_id || message.quote_info?.id;

        // 🔧 根据引用消息类型渲染不同的内容
        let quotedContentHtml = '';

        switch (quoteMessageType) {
            case 'text':
            case 'emoji':
                if (quoteMessageId) {

                    quotedContentHtml = `<div class="quoted-file-link" 
                             onclick="window.adminChatRoomsClient.scrollToQuotedMessage('${quoteMessageId}')"
                             title="点击跳转到原消息">
                           <i class="fas fa-link"></i> [引用消息]
                            <span class="quote-text-content" style="color: #909399; font-size: 12px;">${this.escapeHtml(quoteContent || '[文本消息]')}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`;

                } else {
                    quotedContentHtml = this.escapeHtml(quoteContent || '[文本消息]');
                }
                break;

            case 'image':
                // 🔧 直接渲染图片
                if (quoteFileInfo?.url) {
                    quotedContentHtml = `<div class="quoted-image-preview" style="margin-top: 4px;">
                            
                            <img src="${quoteFileInfo.url}" 
                                 alt="引用的图片" 
                                 class="quoted-image"
                                 style="max-width: 150px; max-height: 100px; border-radius: 4px; cursor: pointer;"
                                 onclick="window.adminChatRoomsClient.previewImage('${quoteFileInfo.url}')">
                        </div>`;
                } else {
                    quotedContentHtml = '<i class="fas fa-image"></i> [图片]';
                }
                break;

            case 'video':
                // 🔧 直接渲染视频播放器
                if (quoteFileInfo?.url) {
                    quotedContentHtml = `<div class="quoted-video-preview" style="margin-top: 4px;">
                            
                            <video controls preload="metadata" 
                                   style="max-width: 200px; max-height: 150px; border-radius: 4px;"
                                   poster="${quoteFileInfo.thumbnail_url || ''}">
                                <source src="${quoteFileInfo.url}" type="${quoteFileInfo.mime_type || 'video/mp4'}">
                                您的浏览器不支持视频播放。
                            </video>
                        </div>`;
                } else {
                    quotedContentHtml = '<i class="fas fa-video"></i> [视频]';
                }
                break;

            case 'voice':
            case 'audio':
                // 🔧 直接渲染语音播放器
                const duration = quoteFileInfo?.duration ? Math.floor(quoteFileInfo.duration) : 5;
                const mm = Math.floor(duration / 60).toString().padStart(2, '0');
                const ss = (duration % 60).toString().padStart(2, '0');

                let audioUrl = quoteFileInfo?.url || '';
                if (audioUrl) {
                    audioUrl = audioUrl.includes('?')
                        ? `${audioUrl}&t=${Date.now()}`
                        : `${audioUrl}?t=${Date.now()}`;
                }

                // 🔧 iOS 设备优先使用 MP3 格式
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
                if (isIOS && quoteFileInfo?.mp3_url) {
                    audioUrl = quoteFileInfo.mp3_url + `?t=${Date.now()}`;
                }

                if (audioUrl) {
                    const voiceId = `quoted-voice-${quoteMessageId}-${Date.now()}`;
                    quotedContentHtml = `                        <div class="message-voice quoted-voice" data-message-id="${voiceId}" style="margin-top: 4px; min-width: 120px;">
                            
                            <button class="voice-play-btn" 
                                    data-message-id="${voiceId}" 
                                    title="点击播放"
                                    onclick="window.adminChatRoomsClient.toggleVoicePlay('${voiceId}', event)">
                                <i class="fas fa-play"></i>
                            </button>
                            <span class="voice-duration">${mm}:${ss}</span>
                            <div class="voice-progress">
                                <div class="voice-progress-bar" 
                                     id="voice-progress-${voiceId}" 
                                     style="width: 0%"></div>
                            </div>
                            <audio class="voice-audio" 
                                   id="voice-audio-${voiceId}"
                                   data-message-id="${voiceId}"
                                   src="${audioUrl}"
                                   preload="none"></audio>
                        </div>`;
                } else {
                    quotedContentHtml = `<i class="fas fa-microphone"></i> [语音] ${mm}:${ss}`;
                }
                break;

            case 'file':
                // 🔧 文件类型：点击滚动到原消息位置
                const fileName = quoteFileInfo?.name || quoteContent || '[文件]';
                if (quoteMessageId) {
                    quotedContentHtml = `<div class="quoted-file-link" 
                             style="cursor: pointer; padding: 4px 8px; background: rgba(64, 158, 255, 0.05); border-radius: 4px; display: inline-flex; align-items: center; gap: 6px;"
                             onclick="window.adminChatRoomsClient.scrollToQuotedMessage('${quoteMessageId}')"
                             title="点击跳转到原消息">
                            <i class="fas fa-link"></i> [引用消息]
                            <i class="fas fa-file" style="color: #409EFF;"></i>
                            <span style="color: #909399; font-size: 12px;">${this.escapeHtml(fileName)}</span>
                            <i class="fas fa-location-arrow" style="color: #909399; font-size: 11px;"></i>
                        </div>`;
                } else {
                    quotedContentHtml = `<i class="fas fa-file"></i> ${this.escapeHtml(fileName)}`;
                }
                break;

            // 🔧 新增：渲染被引用的任务卡片消息（迷你卡片风格）
            case 'task_card':
                let taskCardTitle = '';
                let taskCardStatus = '';
                let taskCardStatusRaw = '';
                let taskCardAssignee = '';
                const aStatusMap = {'todo': '待处理', 'in_progress': '进行中', 'done': '已完成', 'overdue': '已逾期'};
                const aStatusColors = {'todo': '#909399', 'in_progress': '#E6A23C', 'done': '#67C23A', 'overdue': '#F56C6C'};
                try {
                    const acData = typeof quoteContent === 'string' ? JSON.parse(quoteContent) : {};
                    taskCardTitle = acData.title || acData.task_title || quoteContent;
                    taskCardStatusRaw = acData.status || '';
                    taskCardStatus = aStatusMap[acData.status] || '';
                    taskCardAssignee = (acData.assignee_info?.real_name || acData.assignee_info?.username || acData.assignee_name || '');
                } catch (e) {
                    taskCardTitle = quoteContent || '[任务卡片]';
                }
                const acolor = aStatusColors[taskCardStatusRaw] || '#909399';
                const displayTitle = typeof taskCardTitle === 'string' && taskCardTitle.length > 30 ? taskCardTitle.substring(0, 30) + '...' : (taskCardTitle || '[任务卡片]');
                if (quoteMessageId) {
                    quotedContentHtml = `<div class="quoted-file-link"
                             style="cursor: pointer; padding: 6px 8px; background: #f0f7ff; border-radius: 4px; border-left: 3px solid #409EFF; display: flex; flex-direction: column; gap: 3px;"
                             onclick="window.adminChatRoomsClient.scrollToQuotedMessage('${quoteMessageId}')"
                             title="点击跳转到原消息">
                            <div style="display:flex;align-items:center;gap:6px;">
                                <i class="fas fa-tasks" style="color:#409EFF;font-size:12px;"></i>
                                <span style="font-weight:500;font-size:12px;color:#303133;">${this.escapeHtml(displayTitle)}</span>
                                <i class="fas fa-location-arrow" style="margin-left:auto;color:#909399;font-size:11px;"></i>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                                ${taskCardStatus ? `<span style="background:${acolor};color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;">${taskCardStatus}</span>` : ''}
                                ${taskCardAssignee ? `<span><i class="fas fa-user-circle" style="margin-right:2px;"></i>${this.escapeHtml(taskCardAssignee)}</span>` : ''}
                            </div>
                        </div>`;
                } else {
                    quotedContentHtml = `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
                        <i class="fas fa-tasks" style="color:#409EFF;"></i>
                        <span style="font-weight:500;font-size:12px;">${this.escapeHtml(displayTitle)}</span>
                        ${taskCardStatus ? `<span style="background:${acolor};color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;">${taskCardStatus}</span>` : ''}
                    </div>`;
                }
                break;

            default:
                quotedContentHtml = this.escapeHtml(quoteContent || '[未知类型]');
        }

        // 🔧 构建引用消息HTML
        return `            <div class="message-quote-history">
                <div class="quote-header-history">
                    <i class="fas fa-quote-left"></i>
                    <span class="quote-sender-history">${this.escapeHtml(quoteSenderName)}：</span>
                </div>
                <div class="quote-content-history">
                    ${quotedContentHtml}                </div>
            </div>
        `;
    }


    // 🔧 新增：滚动到被引用的消息位置
    scrollToQuotedMessage(messageId) {
        if (!messageId) return;

        const messagesList = document.getElementById('messagesHistoryList');
        if (!messagesList) return;

        // 查找目标消息元素
        const targetMessage = messagesList.querySelector(`[data-message-id="${messageId}"]`);

        if (targetMessage) {
            // 高亮显示目标消息
            targetMessage.classList.add('message-highlighted');

            // 平滑滚动到目标位置
            targetMessage.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });

            // 3秒后移除高亮
            setTimeout(() => {
                targetMessage.classList.remove('message-highlighted');
            }, 3000);
        } else {
            // 如果消息不在当前视图中，可能需要加载更多消息
            console.log('目标消息不在当前加载中，尝试加载...');
            this.showToast('目标消息不在当前加载范围内', 'info');
        }
    }

    // 🔧 新增：打开图片预览
    openImagePreview(imageUrl) {
        if (!imageUrl) return;

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'image-preview-modal';
        modal.style.cssText = `            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

        modal.innerHTML = `            <div class="image-preview-content" style="position: relative; max-width: 90vw; max-height: 90vh;">
                <img src="${imageUrl}" 
                     style="max-width: 100%; max-height: 90vh; border-radius: 8px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);"
                     alt="预览图片">
                <button class="close-preview" 
                        style="position: absolute; top: -40px; right: 0; color: white; font-size: 32px; cursor: pointer; background: none; border: none; padding: 8px;"
                        onclick="this.closest('.image-preview-modal').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        document.body.appendChild(modal);

        // 触发动画
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);

        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }


    // 🔧 新增：渲染历史消息中的语音消息（支持播放/暂停）
    renderVoiceMessageInHistory(message) {
        const messageId = message.id || message.message_id;
        const duration = message.file_info?.duration
            ? Math.floor(message.file_info.duration)
            : (message.file_info?.size ? Math.max(Math.floor(message.file_info.size / 8000), 1) : 5);
        const mm = Math.floor(duration / 60).toString().padStart(2, '0');
        const ss = (duration % 60).toString().padStart(2, '0');

        // 构建音频 URL（添加时间戳防止缓存）
        let audioUrl = message.file_info?.url || '';
        if (audioUrl) {
            audioUrl = audioUrl.includes('?')
                ? `${audioUrl}&t=${Date.now()}`
                : `${audioUrl}?t=${Date.now()}`;
        }

        // 🔧 关键修复：iOS 设备优先使用 MP3 格式
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS && message.file_info?.mp3_url) {
            audioUrl = message.file_info.mp3_url + `?t=${Date.now()}`;
        }

        return `
            <div class="message-voice" data-message-id="${messageId}">
                <!-- 播放/暂停按钮 -->
                <button class="voice-play-btn" 
                        data-message-id="${messageId}" 
                        title="点击播放"
                        onclick="window.adminChatRoomsClient.toggleVoicePlay('${messageId}', event)">
                    <i class="fas fa-play"></i>
                </button>
                
                <!-- 语音时长 -->
                <span class="voice-duration">${mm}:${ss}</span>
                
                <!-- 进度条 -->
                <div class="voice-progress">
                    <div class="voice-progress-bar" 
                         id="voice-progress-${messageId}" 
                         style="width: 0%"></div>
                </div>
                
                <!-- 隐藏的音频元素 -->
                <audio class="voice-audio" 
                       id="voice-audio-${messageId}"
                       data-message-id="${messageId}"
                       src="${audioUrl}"
                       preload="metadata"
                       playsinline
                       webkit-playsinline
                       crossOrigin="anonymous">
                </audio>
                
                <!-- 下载按钮（错误时显示） -->
                <button class="voice-download-btn" 
                        style="display: none;"
                        data-message-id="${messageId}"
                        onclick="window.adminChatRoomsClient.downloadVoice('${messageId}', '${audioUrl}')"
                        title="下载音频">
                    <i class="fas fa-download"></i>
                </button>
            </div>
        `;

    }


    // 🔧 新增：切换语音播放/暂停
    toggleVoicePlay(messageId, event) {
        if (event) {
            event.stopPropagation();
        }

        const audio = document.getElementById(`voice-audio-${messageId}`);
        const playBtn = document.querySelector(`.voice-play-btn[data-message-id="${messageId}"]`);
        const progressBar = document.getElementById(`voice-progress-${messageId}`);

        if (!audio || !playBtn) {
            console.error('语音元素未找到:', messageId);
            return;
        }

        // 🔧 关键修复：如果当前正在播放，则暂停
        if (!audio.paused) {
            audio.pause();
            playBtn.classList.remove('playing');
            playBtn.querySelector('i').className = 'fas fa-play';
            playBtn.title = '点击播放';
            this.currentPlayingId = null;
            return;
        }

        // 🔧 关键修复：暂停其他所有正在播放的语音（互斥播放）
        this.voicePlayers.forEach((playerAudio, id) => {
            if (playerAudio !== audio && !playerAudio.paused) {
                playerAudio.pause();

                // 更新其他语音的按钮状态
                const otherBtn = document.querySelector(`.voice-play-btn[data-message-id="${id}"]`);
                const otherProgress = document.getElementById(`voice-progress-${id}`);

                if (otherBtn) {
                    otherBtn.classList.remove('playing');
                    otherBtn.querySelector('i').className = 'fas fa-play';
                    otherBtn.title = '点击播放';
                }
                if (otherProgress) {
                    otherProgress.style.width = '0%';
                }
            }
        });

        // 🔧 关键修复：播放当前语音
        const attemptPlay = () => {
            audio.play().then(() => {
                // 播放成功，更新 UI
                playBtn.classList.add('playing');
                playBtn.querySelector('i').className = 'fas fa-pause';
                playBtn.title = '点击暂停';
                this.currentPlayingId = messageId;
                this.voicePlayers.set(messageId, audio);
            }).catch(err => {
                console.error('语音播放失败:', err);

                // 根据错误类型给出提示
                if (err.name === 'NotSupportedError') {
                    this.showError('播放失败', '您的设备不支持此音频格式');
                    this.showDownloadButton(messageId);
                } else if (err.name === 'NotAllowedError') {
                    this.showError('播放失败', '请先与页面交互后再试');
                } else {
                    // 尝试重新加载后播放
                    setTimeout(() => {
                        audio.load();
                        audio.play().catch(e => {
                            console.error('重试播放失败:', e);
                            this.showError('播放失败', '请检查网络或稍后重试');
                            this.showDownloadButton(messageId);
                        });
                    }, 500);
                }
            });
        };

        // 🔧 关键修复：智能加载策略
        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            attemptPlay();
        } else {
            audio.addEventListener('loadedmetadata', attemptPlay, {once: true});
            audio.load();

            // 超时处理
            setTimeout(() => {
                audio.removeEventListener('loadedmetadata', attemptPlay);
                attemptPlay();
            }, 3000);
        }
    }

    // 🔧 新增：显示下载按钮（播放失败时）
    showDownloadButton(messageId) {
        const downloadBtn = document.querySelector(`.voice-download-btn[data-message-id="${messageId}"]`);
        if (downloadBtn) {
            downloadBtn.style.display = 'inline-block';
        }
    }

    // 🔧 新增：下载语音文件
    downloadVoice(messageId, audioUrl) {
        const link = document.createElement('a');
        link.href = audioUrl;
        link.download = `voice_${messageId}_${Date.now()}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }


    // 🔧 新增：初始化语音消息事件监听（在渲染后调用）
    initVoiceMessageListeners() {
        // 为所有语音消息添加事件监听
        document.querySelectorAll('.voice-audio').forEach(audio => {
            const messageId = audio.dataset.messageId;
            const playBtn = document.querySelector(`.voice-play-btn[data-message-id="${messageId}"]`);
            const progressBar = document.getElementById(`voice-progress-${messageId}`);

            if (!playBtn || !progressBar) return;

            // 🔧 播放事件
            audio.addEventListener('play', () => {
                playBtn.classList.add('playing');
                playBtn.querySelector('i').className = 'fas fa-pause';
                playBtn.title = '点击暂停';
                this.currentPlayingId = messageId;
            });

            // 🔧 暂停事件
            audio.addEventListener('pause', () => {
                playBtn.classList.remove('playing');
                playBtn.querySelector('i').className = 'fas fa-play';
                playBtn.title = '点击播放';
                if (this.currentPlayingId === messageId) {
                    this.currentPlayingId = null;
                }
            });

            // 🔧 播放进度更新事件
            audio.addEventListener('timeupdate', () => {
                if (audio.duration) {
                    const progress = (audio.currentTime / audio.duration) * 100;
                    progressBar.style.width = `${Math.min(progress, 100)}%`;
                }
            });

            // 🔧 播放结束事件
            audio.addEventListener('ended', () => {
                playBtn.classList.remove('playing');
                playBtn.querySelector('i').className = 'fas fa-play';
                playBtn.title = '点击播放';
                progressBar.style.width = '0%';
                audio.currentTime = 0;
                if (this.currentPlayingId === messageId) {
                    this.currentPlayingId = null;
                }
            });

            // 🔧 错误处理事件
            audio.addEventListener('error', (e) => {
                console.error('语音加载错误:', audio.error);
                this.showDownloadButton(messageId);
                playBtn.title = '播放失败，点击下载';
            });

            // 存储音频引用
            this.voicePlayers.set(messageId, audio);
        });
    }


    // 🔧 辅助：获取文件图标类
    getFileIcon(mimeType, fileName) {
        if (!mimeType && fileName) {
            const ext = fileName.split('.').pop().toLowerCase();
            if (['pdf'].includes(ext)) return 'fas fa-file-pdf';
            if (['doc', 'docx'].includes(ext)) return 'fas fa-file-word';
            if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fas fa-file-excel';
            if (['ppt', 'pptx'].includes(ext)) return 'fas fa-file-powerpoint';
            if (['zip', 'rar', '7z'].includes(ext)) return 'fas fa-file-archive';
            if (['txt', 'md'].includes(ext)) return 'fas fa-file-alt';
        }
        if (mimeType) {
            if (mimeType.includes('pdf')) return 'fas fa-file-pdf';
            if (mimeType.includes('word')) return 'fas fa-file-word';
            if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'fas fa-file-excel';
            if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'fas fa-file-powerpoint';
            if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'fas fa-file-archive';
            if (mimeType.includes('text')) return 'fas fa-file-alt';
        }
        return 'fas fa-file';
    }

    // 🔧 新增：显示图片预览模态框
    // 收集当前房间所有图片消息的 URL 列表
    _collectImageList() {
        const images = [];
        if (!this.roomMessages || !Array.isArray(this.roomMessages)) return images;
        for (const msg of this.roomMessages) {
            if (!msg.is_deleted && msg.file_info?.url && (msg.message_type === 'image' || msg.file_info?.mime_type?.startsWith('image/'))) {
                images.push({ url: msg.file_info.url, name: msg.file_info.name || '图片' });
            }
        }
        return images;
    }

    previewImage(imageUrl) {
        if (!imageUrl) return;
        const imageList = this._collectImageList();
        if (!imageList.length) return;
        // 兼容相对/绝对 URL（imageEl.src 是绝对地址，file_info.url 可能是相对地址），
        // 否则 findIndex 永远匹配不到，预览会从第一张开始，导致左右切换看起来不正常。
        let currentIndex = imageList.findIndex(item => {
            try { return new URL(item.url, window.location.origin).href === new URL(imageUrl, window.location.origin).href; }
            catch (e) { return item.url === imageUrl; }
        });
        if (currentIndex === -1) currentIndex = 0;
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var prevDisplay = imageList.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="this.parentNode.remove()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="adminChatRoomsClient._adminPreviewNav(-1)" id="adminPrevBtn" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="adminChatRoomsClient._adminPreviewNav(1)" id="adminNextBtn" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="adminPreviewMainImg" src="' + imageList[currentIndex].url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div id="adminPreviewCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (currentIndex + 1) + ' / ' + imageList.length + '</div>';
        document.body.appendChild(overlay);
        this._adminPreviewImgs = imageList;
        this._adminPreviewCurrent = currentIndex;
        this._adminPreviewOverlay = overlay;
        var self = this;
        this._adminPreviewKeyHandler = function(e) {
            if (e.key === 'ArrowLeft') { self._adminPreviewNav(-1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { self._adminPreviewNav(1); e.preventDefault(); }
            else if (e.key === 'Escape') { self._adminPreviewCleanup(); e.preventDefault(); }
        };
        document.addEventListener('keydown', this._adminPreviewKeyHandler);

        // 🔧 触摸滑动：左右滑动切换图片（移动端）；双指捏合由 Utils.enableImagePinchZoom 处理
        var touchStartX = null, touchStartY = null, swiped = false;
        overlay.addEventListener('touchstart', function(e) {
            if (e.touches.length >= 2) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            swiped = false;
        }, {passive: true});
        overlay.addEventListener('touchmove', function(e) {
            if (e.touches.length >= 2) return;
            if (touchStartX !== null) {
                var dx = e.touches[0].clientX - touchStartX;
                var dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 30 || Math.abs(dy) > 30) swiped = true;
            }
        }, {passive: true});
        overlay.addEventListener('touchend', function(e) {
            if (e.changedTouches && e.changedTouches.length >= 2) { touchStartX = null; return; }
            if (touchStartX !== null) {
                var endX = e.changedTouches[0].clientX;
                var endY = e.changedTouches[0].clientY;
                var dx = endX - touchStartX, dy = endY - touchStartY;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    self._adminPreviewNav(dx < 0 ? 1 : -1);  // 左滑下一张，右滑上一张
                }
            }
            touchStartX = null;
        }, {passive: true});

        // 🔧 点击图片切换预览模式（再点一次退出）；点击背景也退出
        overlay.addEventListener('click', function(e) {
            if (swiped) { swiped = false; return; }  // 刚滑动过，忽略本次点击
            if (e.target === overlay) self._adminPreviewCleanup();
        });
        var mainImg = document.getElementById('adminPreviewMainImg');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function(e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                if (swiped) { swiped = false; return; }
                self._adminPreviewCleanup();
            });
        }
    }

    _adminPreviewNav(dir) {
        if (!this._adminPreviewImgs || !this._adminPreviewImgs.length) return;
        var len = this._adminPreviewImgs.length;
        if (dir < 0 && this._adminPreviewCurrent <= 0) { this._adminShowTip('已是第一张'); return; }
        if (dir > 0 && this._adminPreviewCurrent >= len - 1) { this._adminShowTip('已是最后一张'); return; }
        this._adminPreviewCurrent += dir;
        var img = document.getElementById('adminPreviewMainImg');
        var item = this._adminPreviewImgs[this._adminPreviewCurrent];
        if (img) { img.src = item.url || item; Utils.resetImageZoom(img); }
        var counter = document.getElementById('adminPreviewCounter');
        if (counter) counter.textContent = (this._adminPreviewCurrent + 1) + ' / ' + this._adminPreviewImgs.length;
        var p = document.getElementById('adminPrevBtn');
        var n = document.getElementById('adminNextBtn');
        if (p) { p.style.opacity = this._adminPreviewCurrent <= 0 ? '0.2' : '1'; p.style.cursor = this._adminPreviewCurrent <= 0 ? 'default' : 'pointer'; }
        if (n) { n.style.opacity = this._adminPreviewCurrent >= this._adminPreviewImgs.length - 1 ? '0.2' : '1'; n.style.cursor = this._adminPreviewCurrent >= this._adminPreviewImgs.length - 1 ? 'default' : 'pointer'; }
    }

    _adminPreviewCleanup() {
        if (this._adminPreviewOverlay) { this._adminPreviewOverlay.remove(); this._adminPreviewOverlay = null; }
        if (this._adminPreviewKeyHandler) { document.removeEventListener('keydown', this._adminPreviewKeyHandler); this._adminPreviewKeyHandler = null; }
    }

    _adminShowTip(msg) {
        var tip = document.getElementById('adminShowTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'adminShowTip';
            tip.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);z-index:10002;color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:20px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.opacity = '1';
        clearTimeout(tip._t);
        tip._t = setTimeout(function() { tip.style.opacity = '0'; }, 1500);
    }

    // 返回聊天室列表
    backToRooms() {
        this.currentRoomId = null;
        this.currentRoom = null;
        this.roomMessages = [];
        this.currentPage = 1;
        this.hasMoreMessages = true;
        this.oldestMessageId = null;

        document.getElementById('chatRoomsListContainer').style.display = 'block';
        document.getElementById('roomHistoryContainer').style.display = 'none';

        // 移除历史消息的滚动监听，避免干扰列表
        this.removeInfiniteScrollListener();

        // this.loadChatRooms();
    }

    // 搜索聊天室
    searchRooms(keyword) {
        if (!keyword.trim()) {
            this.renderChatRooms(this.chatRooms);
            return;
        }
        // 这里可以调用后端搜索接口，暂时前端过滤
        const filteredRooms = this.chatRooms?.filter(room => {
            const name = room.display_name || '';
            return name.toLowerCase().includes(keyword.toLowerCase());
        }) || [];
        this.renderChatRooms(filteredRooms);
    }

    // 搜索消息
    searchMessages(keyword) {
        if (!keyword.trim()) {
            this.renderRoomHistory(this.currentRoom);
            return;
        }
        const filteredMessages = this.roomMessages.filter(message =>
            message.content?.toLowerCase().includes(keyword.toLowerCase()) ||
            message.sender?.real_name?.toLowerCase().includes(keyword.toLowerCase())
        );
        const originalMessages = this.roomMessages;
        this.roomMessages = filteredMessages;
        this.renderRoomHistory(this.currentRoom);
        this.roomMessages = originalMessages;
    }

    // 🔧 修复：加载更多历史消息（向上滚动）
    loadMoreHistory() {
        if (this.isLoading || !this.hasMoreMessages || !this.currentRoomId) return;


        try {

            // 显示加载指示器
            const loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'message-loading-indicator';
            loadingIndicator.innerHTML = `
                <div class="spinner"></div>
                <span>加载更多消息...</span>
            `;


            // 记录当前最早消息的位置
            const messagesList = document.getElementById('messagesHistoryList');
            if (messagesList && messagesList.firstChild) {
                messagesList.insertBefore(loadingIndicator, messagesList.firstChild);
            }
            const currentOldestMessageId = this.oldestMessageId
            const loadingIndicatorOffset = loadingIndicator.offsetHeight;
            console.log('currentOldestMessageId: ', currentOldestMessageId)
            console.log('loadingIndicatorOffset: ', loadingIndicatorOffset)
            console.log('加载更多历史消息...')

            this.loadRoomHistory(this.currentRoomId, this.currentPage + 1, true);

            if (messagesList) {

                const currentScrollTop = document.querySelector(`.history-message[data-message-id="${this.oldestMessageId}"]`).offsetTop
                console.log('currentScrollTop: ', currentScrollTop)
                console.log('loadingIndicator.offsetHeight: ', loadingIndicator.offsetHeight)
                messagesList.scrollTop = currentScrollTop - loadingIndicatorOffset;

            }
        } catch (error) {
            console.error('加载更多历史消息出错：', error);
        } finally {
            // 移除加载指示器
            const indicator = document.querySelector('.message-loading-indicator');
            if (indicator) indicator.remove();
        }

    }

    // 移除无限滚动监听器
    removeInfiniteScrollListener() {
        const messagesList = document.getElementById('messagesHistoryList');
        if (messagesList && this.infiniteScrollHandler) {
            messagesList.removeEventListener('scroll', this.infiniteScrollHandler);
            this.infiniteScrollHandler = null;
        }
    }

    // 设置无限滚动监听
    setupInfiniteScroll() {
        const messagesList = document.getElementById('messagesHistoryList');
        if (!messagesList) return;

        this.removeInfiniteScrollListener();

        this.infiniteScrollHandler = () => {
            if (messagesList.scrollTop < 50 && !this.isLoading && this.hasMoreMessages && this.currentRoomId) {
                this.loadMoreHistory();
            }
        };

        messagesList.addEventListener('scroll', this.infiniteScrollHandler);
    }

    // 导出聊天室历史
    exportRoomHistory() {
        if (!this.currentRoom || this.roomMessages.length === 0) {
            this.showError('导出失败', '没有可导出的消息');
            return;
        }

        let csvContent = '时间，发送者，消息类型，内容，文件名，文件大小\n';
        this.roomMessages.forEach(message => {
            const time = new Date(message.timestamp).toLocaleString('zh-CN');
            const sender = message.sender?.real_name || message.sender?.username || '未知';
            const type = message.message_type;
            const content = (message.content || '').replace(/"/g, '""');
            const fileName = message.file_info?.name || '';
            const fileSize = message.file_info?.size ? this.formatFileSize(message.file_info.size) : '';
            csvContent += `"${time}","${sender}","${type}","${content}","${fileName}","${fileSize}"\n`;
        });

        const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${this.currentRoom.display_name || '聊天记录'}_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
    }

    // ==================== 工具方法 ====================

    formatDateTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }

    formatTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
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
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    showLoading() {
        let overlay = document.getElementById('loadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = '<div class="loading-spinner"></div>';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
    }

    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    showError(title, message) {
        this.showToast(title, message, 'error');
    }

    showSuccess(title, message) {
        this.showToast(title, message, 'success');
    }

    showToast(title, message, type) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${title}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 3000);
    }

    showConfirmDialog(title, message, type = 'confirm') {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <div class="confirm-dialog-header">
                        <i class="fas fa-${type === 'danger' ? 'exclamation-triangle' : 'check-circle'}"></i>
                        <h3>${title}</h3>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="confirm-dialog-body"><p>${message}</p></div>
                    <div class="confirm-dialog-footer">
                        <button class="confirm-dialog-btn cancel">取消</button>
                        <button class="confirm-dialog-btn ${type}">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);

            const close = (result) => {
                dialog.style.opacity = '0';
                setTimeout(() => {
                    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
                }, 300);
                resolve(result);
            };

            dialog.querySelector('.cancel').onclick = () => close(false);
            dialog.querySelector(`.${type}`).onclick = () => close(true);
            dialog.querySelector('.close-btn').onclick = () => close(false);
            dialog.onclick = (e) => {
                if (e.target === dialog) close(false);
            };

            setTimeout(() => dialog.style.opacity = '1', 10);
        });
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.adminChatRoomsClient = new AdminChatRoomsClient();
});