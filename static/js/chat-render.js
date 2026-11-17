// static/js/chat-render.js - 用户/房间/历史与消息渲染、转发、引用
// 说明：本文件为 ChatClient 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ChatClient.prototype, {

    // ==================== 群组头像（九宫格，参考微信群头像） ====================

    _groupAvatarMembers(room) {
        const members = (room && Array.isArray(room.members)) ? room.members : [];
        return members.slice(0, 9);
    },

    _groupAvatarCellsHtml(room) {
        const members = this._groupAvatarMembers(room);
        const esc = (text) => (this.escapeHtml ? this.escapeHtml(text) : String(text == null ? '' : text));
        let cells = '';
        for (let i = 0; i < 9; i++) {
            const m = members[i];
            if (m) {
                const src = esc(m.avatar_url || '/static/images/default-avatar.png');
                cells += `<span class="ga-cell"><img src="${src}" alt="" loading="lazy"
                    onerror="this.onerror=null;this.src='/static/images/default-avatar.png';"></span>`;
            } else {
                cells += '<span class="ga-cell ga-cell-empty"></span>';
            }
        }
        return cells;
    },

    /**
     * 生成群组九宫格头像 HTML。
     * 取群成员前 9 个头像按 3x3 排列，不足 9 个的位置留空，整体为圆角方形。
     */
    buildGroupAvatarHtml(room, extraClass) {
        const members = this._groupAvatarMembers(room);
        const name = (room && (room.display_name || room.name)) || '';
        const title = this.escapeHtml ? this.escapeHtml(name) : '';
        const cls = 'group-avatar-grid' + (extraClass ? ' ' + extraClass : '');
        if (!members.length) {
            return `<span class="${cls} group-avatar-grid-fallback" title="${title}"><i class="fas fa-users"></i></span>`;
        }
        return `<span class="${cls}" title="${title}">${this._groupAvatarCellsHtml(room)}</span>`;
    },

    /** 聊天头部展示群组九宫格头像 */
    renderHeaderGroupAvatar(room) {
        let wrap = document.getElementById('chatAvatarWrap') || document.querySelector('.chat-avatar');
        const img = document.getElementById('chatAvatar');
        let grid = document.getElementById('chatGroupAvatar');
        // 兼容旧缓存模板：若九宫格容器不存在，运行时补齐，避免头像停留在旧图
        if (!grid && wrap) {
            grid = document.createElement('span');
            grid.id = 'chatGroupAvatar';
            grid.className = 'group-avatar-grid';
            wrap.appendChild(grid);
        }
        if (!grid) return;
        if (wrap) wrap.classList.add('has-group');
        if (img) img.style.display = 'none';
        const members = this._groupAvatarMembers(room);
        if (members.length) {
            grid.classList.remove('group-avatar-grid-fallback');
            grid.innerHTML = this._groupAvatarCellsHtml(room);
            grid.style.display = 'grid';
        } else {
            grid.classList.add('group-avatar-grid-fallback');
            grid.innerHTML = '<i class="fas fa-users"></i>';
            grid.style.display = 'flex';
        }
    },

    /** 按当前聊天室类型同步聊天头部头像（群聊=九宫格，私聊=对方单头像） */
    syncChatHeaderAvatar(room) {
        if (!room) return;
        if (room.room_type === 'group') {
            this.renderHeaderGroupAvatar(room);
            return;
        }
        if (room.room_type === 'private') {
            const uid = this.currentUser ? this.currentUser.id : null;
            const other = (room.members || []).find(m => m.id !== uid);
            this.setChatHeaderAvatar(
                (other && other.avatar_url) || '/static/images/default-avatar.png'
            );
        }
    },

    /** 聊天头部展示单张头像（私聊 / 通知 / 组织架构等），并复位群组九宫格 */
    setChatHeaderAvatar(src) {
        const wrap = document.getElementById('chatAvatarWrap') || document.querySelector('.chat-avatar');
        const img = document.getElementById('chatAvatar');
        const grid = document.getElementById('chatGroupAvatar');
        if (wrap) wrap.classList.remove('has-group');
        if (grid) {
            grid.style.display = 'none';
            grid.innerHTML = '';
            grid.classList.remove('group-avatar-grid-fallback');
        }
        if (img) {
            img.style.display = '';
            img.src = src || '/static/images/default-avatar.png';
        }
    },


    // 加载用户列表（append=true 表示滚动到底部加载下一页）
    async loadUsers(append = false) {
        if (this.usersLoading) return;
        const page = append ? (this.usersPage || 1) + 1 : 1;
        this.usersLoading = true;
        try {
            const data = await API.getUsersPage(page);
            const rows = Array.isArray(data) ? data : (data.results || []);

            if (append) {
                const existing = new Set(this.users.map(u => u.id));
                this.users = this.users.concat(rows.filter(u => !existing.has(u.id)));
            } else {
                this.users = rows;
            }

            this.usersPage = (data && data.page) || page;
            const hasNextKey = data && !Array.isArray(data) &&
                Object.prototype.hasOwnProperty.call(data, 'next');
            this.usersHasMore = Array.isArray(data) ? false : (hasNextKey
                ? !!data.next
                : (typeof data.count === 'number' && this.users.length < data.count));

            const contactsEl = document.getElementById('contactsList');
            const scrollTop = append && contactsEl ? contactsEl.scrollTop : 0;
            this.renderUserList();
            if (append && contactsEl) contactsEl.scrollTop = scrollTop;
        } catch (error) {
            console.error('加载用户列表失败:', error?.detail || error.message);
            if (!append) {
                this.showError('加载用户列表失败');
                await this.checkLoginStatus();
            }
        } finally {
            this.usersLoading = false;
        }
    },

    // 滚动到底部加载更多通讯录好友
    async loadMoreUsers() {
        if (this.usersLoading || !this.usersHasMore) return;
        await this.loadUsers(true);
    },

    // 加载部门列表
    async loadDepartments() {
        try {
            const response = await API.getDepartments();
            this.departments = Array.isArray(response) ? response : (response.results || []);
        } catch (error) {
            console.error('加载部门列表失败:', error?.detail || error.message);
            this.showError('加载部门列表失败');
        }
    },

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
        var sp2 = document.getElementById('settingsPosition');
        if (sp2) sp2.value = this.currentUser.position || '';
        document.getElementById('settingsRealName').value = this.currentUser.real_name || '';
        document.getElementById('settingsEmail').value = this.currentUser.email || '';
        document.getElementById('settingsPhone').value = this.currentUser.phone || '';


        // 设置头像
        const settingsAvatar = document.getElementById('settingsAvatar');
        if (settingsAvatar) {
            settingsAvatar.src = this.currentUser.avatar_url || this.currentUser.avatar || '/static/images/default-avatar.png';
        }

    },

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
            const hasUnreadAnnouncement = room.has_unread_announcement === true;
            let mentionHint = '';

            if (hasMentionAll) {
                mentionHint = '<span class="mention-hint">[@所有人] </span>';
            } else if (hasUnreadMention) {
                mentionHint = '<span class="mention-hint">[有人@我] </span>';
            }

            // 🔧 群公告消息：最后一条是群公告时，在内容前加 [群公告] 前缀（与 @ 提示同款红字 + 闪烁）
            const announceHint = (lastMessage.message_type === 'announcement' && hasUnreadAnnouncement)
                ? '<span class="mention-hint announce-hint">[群公告] </span>' : '';

            // 🔧 新增：检测草稿状态
            const hasDraft = this.inputDrafts.has(room.id);
            const draftHint = hasDraft ? ' <span class="draft-hint">[草稿]</span> ' : '';


            let roomAvatar, isOnline, isOnline_html = '', username = '',
                lastMessageText = this._lastMessagePreview(lastMessage),
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
                : this.buildGroupAvatarHtml(room);


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
                    <div class="chat-item-subtitle">${announceHint}${mentionHint}${draftHint}${lastMessageText}</div>
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
    },


    // 重新渲染整个消息历史（用于消息更新/撤回等场景）
    renderChatHistory(append = false) {
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) return;

        // 按时间顺序排序（最早的在前，最新的在后）
        this.messages.sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        // 先在离屏容器中完成全部渲染，再一次性替换，避免逐条插入造成滚动闪烁
        const batch = document.createElement('div');
        this.messages.forEach((message, index) => {
            const senderId = message.sender_id ?? message.sender?.id;
            const type = senderId === this.currentUser?.id ? 'sent' : 'received';

            // 渲染时间戳分隔符（每5分钟或跨天）
            if (index === 0 || this.shouldShowTimestamp(this.messages[index - 1], message)) {
                batch.appendChild(this.renderTimeStamp(message.timestamp));
            }

            this.renderMessage(message, type, batch);
        });

        messagesList.innerHTML = '';
        while (batch.firstChild) messagesList.appendChild(batch.firstChild);

        // 连续朗读中重渲染后恢复当前消息高亮
        if (this._continuousTTS && this._continuousTTS.currentId != null) {
            const cur = document.querySelector(`.message-wrapper[data-message-id="${this._continuousTTS.currentId}"]`);
            if (cur) cur.classList.add('tts-reading');
        }

        if (!append) {
            // 滚动到底部
            Utils.scrollToBottom(messagesList);
        }

    },

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
    },


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
    },


    // 消息渲染方法 - 微信样式
    renderMessage(message, type, targetContainer) {
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

            // 朗读按钮（文本消息；电脑/手机/平板通用）
            let ttsBtn = null;
            if (this._isTtsableMessage(message)) {
                ttsBtn = document.createElement('button');
                ttsBtn.className = 'message-tts-btn';
                ttsBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
                ttsBtn.title = '朗读（连续朗读）';
                ttsBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._toggleMessageTTS(message, ttsBtn);
                };
            }

            if (type === 'sent') {
                headerElementContainer.appendChild(actionBtnForward);
                if (ttsBtn) headerElementContainer.appendChild(ttsBtn);
            } else {
                messageWrapper.appendChild(forwardBtn);
                if (ttsBtn) messageWrapper.appendChild(ttsBtn);
            }
        }


        if (type === 'sent') {
            messageWrapper.appendChild(headerElementContainer);
        }


        // 清空原始模板内容，添加新的 wrapper
        wrapper.innerHTML = '';
        wrapper.appendChild(messageWrapper);


        // 获取消息列表容器（批量渲染时传入离屏容器，避免逐条触发滚动）
        const messagesList = targetContainer || document.getElementById('messagesList');
        if (messagesList) {
            messagesList.appendChild(messageElement);
        }


        // 如果是最新消息且当前在聊天界面，滚动到底部（批量渲染时不滚动）
        if (!targetContainer && this.currentRoomId && parseInt(message.chat_room) == parseInt(this.currentRoomId)) {
            Utils.scrollToBottom(messagesList);
        }

        // 绑定视频监听
        setTimeout(() => {
            this.setupVideoMessageListerners()
        }, 100)

    },


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
            const statusColorPreview = {
                'todo': '#909399',
                'in_progress': '#E6A23C',
                'done': '#67C23A',
                'overdue': '#F56C6C'
            };
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
            previewContent = `
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
        } else if (message.message_type === 'approval_card') {
            let appTitle = '';
            let appType = '';
            try {
                const apData = typeof message.content === 'string' ? JSON.parse(message.content) : (message.approval_data || {});
                appTitle = apData.title || apData.approval_id || '';
                appType = apData.type_name || '';
            } catch (e) {
                appTitle = '';
            }
            previewContent = `
                    <div class="forward-task-card-preview" title="审批卡片" style="padding:6px 8px;border-left:3px solid #409EFF;display:flex;align-items:center;gap:8px;">
                        <div style="font-weight:500;font-size:13px;color:#303133;display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                            <i class="fas fa-clipboard-check" style="color:#409EFF;"></i>
                            <span>${this.escapeHtml(appType ? appType + ' · ' : '')}审批卡片${appTitle ? '：' + this.escapeHtml(appTitle) : ''}</span>
                        </div>
                    </div>
                `;
        } else if (message.message_type === 'work_summary_card') {
            let wsTitle = '';
            try {
                const wsData = typeof message.content === 'string' ? JSON.parse(message.content) : (message.work_summary_data || {});
                wsTitle = (wsData.summary_date ? wsData.summary_date + ' ' : '') + (wsData.user_name || '');
            } catch (e) { wsTitle = ''; }
            previewContent = `
                    <div class="forward-task-card-preview" title="每日工作总结卡片" style="padding:6px 8px;border-left:3px solid #9b59b6;display:flex;align-items:center;gap:8px;">
                        <div style="font-weight:500;font-size:13px;color:#303133;display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                            <i class="fas fa-file-signature" style="color:#9b59b6;"></i>
                            <span>每日工作总结${wsTitle ? '：' + this.escapeHtml(wsTitle) : ''}</span>
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
    },

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
            let forwardAvatarHtml, forwardAvatarClass = 'forward-avatar';
            if (room.room_type === 'private') {
                const avatar = room.members?.find(m => m.id !== this.currentUser.id)?.avatar_url
                    || '/static/images/default-avatar.png';
                forwardAvatarHtml = `<img src="${avatar}" alt="${roomName}">`;
            } else {
                forwardAvatarClass += ' group-avatar-grid-wrap';
                forwardAvatarHtml = this.buildGroupAvatarHtml(room);
            }

            html += `
            <div class="forward-item" data-room-id="${room.id}" onclick="chatClient.toggleForwardTarget(${room.id})">
                <div class="${forwardAvatarClass}">
                    ${forwardAvatarHtml}
                </div>
                <div class="forward-info">
                    <div class="forward-name">${this.escapeHtml(roomName)}</div>
                    <div class="forward-subtitle">${room.room_type === 'private' ? '私聊' : '群聊'}</div>
                </div>
                <div class="forward-checkbox" onclick="chatClient.toggleForwardTarget(${room.id})">
                    <input type="checkbox" class="target-checkbox" data-room-id="${room.id}">
                </div>
            </div>
        `;
        });

        container.innerHTML = html || '<div class="empty-state"><p>暂无可转发的聊天对象</p></div>';

        // 保存消息引用
        this.forwardMessage = message;
        this.selectedForwardTargets = new Set();
    },

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
    },


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
    },


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
            // 🔧 卡片类消息保留解析后的数据字段，保证本地即时渲染为卡片而非 JSON
            if (forwardContent.task_data) messageData.task_data = forwardContent.task_data;
            if (forwardContent.approval_data) messageData.approval_data = forwardContent.approval_data;
            if (forwardContent.work_summary_data) messageData.work_summary_data = forwardContent.work_summary_data;
            if (forwardContent.collab_data) messageData.collab_data = forwardContent.collab_data;

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
    },


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
                    try {
                        taskData = JSON.parse(originalMessage.content);
                    } catch (_) {
                    }
                }
                return {
                    content: taskData ? JSON.stringify(taskData) : (originalMessage.content || '{}'),
                    message_type: 'task_card',
                    task_data: taskData
                };

            // 🔧 新增：转发审批卡片（保留 message_type 与卡片数据，避免转发后显示成 JSON 文本）
            case 'approval_card': {
                let approvalData = originalMessage.approval_data || null;
                if (!approvalData && originalMessage.content) {
                    try {
                        approvalData = JSON.parse(originalMessage.content);
                    } catch (_) {
                    }
                }
                return {
                    content: approvalData ? JSON.stringify(approvalData) : (originalMessage.content || '{}'),
                    message_type: 'approval_card',
                    approval_data: approvalData
                };
            }

            // 🔧 新增：转发每日工作总结卡片
            case 'work_summary_card': {
                let wsData = originalMessage.work_summary_data || null;
                if (!wsData && originalMessage.content) {
                    try {
                        wsData = JSON.parse(originalMessage.content);
                    } catch (_) {
                    }
                }
                return {
                    content: wsData ? JSON.stringify(wsData) : (originalMessage.content || '{}'),
                    message_type: 'work_summary_card',
                    work_summary_data: wsData
                };
            }

            // 🔧 新增：转发协作邀请卡片
            case 'collab_card': {
                let collabData = originalMessage.collab_data || null;
                if (!collabData && originalMessage.content) {
                    try {
                        collabData = JSON.parse(originalMessage.content);
                    } catch (_) {
                    }
                }
                return {
                    content: collabData ? JSON.stringify(collabData) : (originalMessage.content || '{}'),
                    message_type: 'collab_card',
                    collab_data: collabData
                };
            }

            // 群工单卡片跨群转发会泄露详情：降级为文本摘要，不转发原始卡片数据
            case 'work_order_card': {
                let woData = originalMessage.work_order_data || null;
                if (!woData && originalMessage.content) {
                    try { woData = JSON.parse(originalMessage.content); } catch (_) {}
                }
                const summary = woData
                    ? `「群工单转发」\n${woData.order_no || ''} ${woData.title || ''}\n状态：${woData.status_display || ''}（请到原群查看完整详情）`
                    : '「群工单转发」（请到原群查看完整详情）';
                return {content: summary, message_type: 'text'};
            }

            case 'work_order_notice': {
                let noticeData = originalMessage.work_order_data || null;
                if (!noticeData && originalMessage.content) {
                    try { noticeData = JSON.parse(originalMessage.content); } catch (_) {}
                }
                const noticeText = (noticeData && noticeData.text) || originalMessage.content || '工单通知';
                return {content: `「群工单通知」\n${noticeText}`, message_type: 'text'};
            }

            default:
                return {
                    content: `「转发消息」\n${sender}: ${originalMessage.content || '[未知类型]'}`,
                    message_type: 'text'
                };
        }
    },

    // 🔧 新增：过滤转发目标
    filterForwardTargets(keyword) {
        const items = document.querySelectorAll('.forward-item');
        items.forEach(item => {
            const name = item.querySelector('.forward-name').textContent.toLowerCase();
            const match = name.includes(keyword.toLowerCase());
            item.style.display = match ? 'flex' : 'none';
        });
    },


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
    },


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
    },


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
    },


    // 🔧 新增：根据引用消息类型生成 HTML
    renderQuotedContent(type, content, fileInfo = null, messageId = null, message = null) {
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
                const qStatusColors = {
                    'todo': '#909399',
                    'in_progress': '#E6A23C',
                    'done': '#67C23A',
                    'overdue': '#F56C6C'
                };
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

            // 🔧 新增：渲染被引用的审批卡片消息（迷你卡片风格）
            case 'approval_card':
                let qAppTitle = '';
                let qAppType = '';
                let qAppStatus = '';
                try {
                    const apData = (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) ? JSON.parse(content) : (message?.approval_data || {});
                    qAppTitle = apData.title || content || '[审批卡片]';
                    qAppType = apData.type_name || '';
                    qAppStatus = apData.status_display || '';
                } catch (e) {
                    qAppTitle = content || '[审批卡片]';
                }
                if (qAppTitle.length > 40) qAppTitle = qAppTitle.substring(0, 40) + '...';
                return `<div class="quoted-file-link" style="padding: 6px 8px; border-left: 3px solid #409EFF; background: #f0f7ff; border-radius: 4px;"
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <i class="fas fa-clipboard-check" style="color:#409EFF;font-size:12px;"></i>
                                <span style="font-weight:500;font-size:12px;color:#303133;">${escape(qAppTitle)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                                ${qAppType ? `<span style="background:#409EFF;color:#fff;padding:1px 6px;border-radius:8px;">${escape(qAppType)}</span>` : ''}
                                ${qAppStatus ? `<span>${escape(qAppStatus)}</span>` : ''}
                                <i class="fas fa-location-arrow" style="margin-left:auto;color:#ccc;"></i>
                            </div>
                        </div>`;


            case 'work_summary_card':
                let qWsDate = '';
                try {
                    const wsData = (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) ? JSON.parse(content) : (message?.work_summary_data || {});
                    qWsDate = (wsData.summary_date || '') + (wsData.user_name ? ' ' + wsData.user_name : '');
                } catch (e) {}
                const qWsTitle0 = qWsDate || content || '[每日工作总结]';
                const qWsTitle = qWsTitle0.length > 40 ? qWsTitle0.substring(0, 40) + '...' : qWsTitle0;
                return `<div class="quoted-file-link" style="padding: 6px 8px; border-left: 3px solid #9b59b6; background: #f6f2ff; border-radius: 4px;"
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <i class="fas fa-file-signature" style="color:#9b59b6;font-size:12px;"></i>
                                <span style="font-weight:500;font-size:12px;color:#303133;">${escape(qWsTitle)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                                <span>每日工作总结</span>
                                <i class="fas fa-location-arrow" style="margin-left:auto;color:#ccc;"></i>
                            </div>
                        </div>`;

            case 'work_order_card': {
                let woData = {};
                try {
                    woData = (typeof content === 'string' && (content.startsWith('{') || content.startsWith('[')))
                        ? JSON.parse(content) : (message?.work_order_data || {});
                } catch (e) { woData = {}; }
                const woTitleRaw = (woData.order_no ? woData.order_no + ' ' : '') + (woData.title || content || '[群工单]');
                const woTitle = woTitleRaw.length > 40 ? woTitleRaw.substring(0, 40) + '...' : woTitleRaw;
                return `<div class="quoted-file-link" style="padding: 6px 8px; border-left: 3px solid #00a1ff; background: #eefaff; border-radius: 4px;"
                             onclick="${getClickHandler()}"
                             title="点击跳转到原消息">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <i class="fas fa-clipboard-list" style="color:#00a1ff;font-size:12px;"></i>
                                <span style="font-weight:500;font-size:12px;color:#303133;">${escape(woTitle)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:#909399;">
                                ${woData.status_display ? `<span style="background:#00a1ff;color:#fff;padding:1px 6px;border-radius:8px;">${escape(woData.status_display)}</span>` : ''}
                                <i class="fas fa-location-arrow" style="margin-left:auto;color:#ccc;"></i>
                            </div>
                        </div>`;
            }

            case 'work_order_notice':
                return `<span class="quote-text-content">${escape(content) || '[工单通知]'}</span>`;

            case 'work_order_notice': {
                let qNoticeText = content || '';
                try {
                    const d = (typeof content === 'string' && content.trim().indexOf('{') === 0)
                        ? JSON.parse(content) : (message?.work_order_data || {});
                    qNoticeText = d.text || qNoticeText;
                } catch (e) {}
                return `<span class="quote-text-content">${escape(qNoticeText || '工单通知')}</span>`;
            }

            case 'location':
                return `<span class="quote-icon-wrapper"><i class="fas fa-map-marker-alt"></i> [位置]</span>`;

            default:
                return `<span class="quote-text-content">${escape(content) || '[未知类型]'}</span>`;
        }
    },


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

            // 🔧 群公告消息（发布群公告时同步发出的群消息）
            case 'announcement': {
                const body = document.createElement('div');
                body.className = 'ga-message';
                const head = document.createElement('div');
                head.className = 'ga-message-head';
                head.innerHTML = '<i class="fas fa-bullhorn"></i> 群公告';
                const text = document.createElement('div');
                text.className = 'ga-message-body';
                text.textContent = message.content || '';
                body.appendChild(head);
                body.appendChild(text);
                const more = document.createElement('div');
                more.className = 'ga-message-more';
                more.innerHTML = '<i class="fas fa-chevron-right"></i> 查看群公告详情';
                more.onclick = (e) => {
                    e.stopPropagation();
                    this.openGroupAnnouncement(message.chat_room);
                };
                body.appendChild(more);
                container.appendChild(body);
                break;
            }

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
                        } catch (_) {
                        }
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
            case 'approval_card':
                try {
                    // 🔧 从 content(JSON) 或 approval_data 获取审批数据
                    let approvalData = message.approval_data || null;
                    if (!approvalData && message.content) {
                        try {
                            const parsed = JSON.parse(message.content);
                            if (parsed && parsed.approval_id !== undefined) {
                                approvalData = parsed;
                            }
                        } catch (_) {
                        }
                    }
                    this.renderApprovalCardInChat(approvalData, container);
                } catch (e) {
                    console.error('解析审批卡片数据失败', e);
                    container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-clipboard-check"></i> [审批卡片]</div>';
                }
                break;
            case 'work_summary_card':
                try {
                    let wsData = message.work_summary_data || null;
                    if (!wsData && message.content) {
                        try {
                            const parsed = JSON.parse(message.content);
                            if (parsed && parsed.summary_id !== undefined) {
                                wsData = parsed;
                            }
                        } catch (_) {
                        }
                    }
                    this.renderWorkSummaryCardInChat(wsData, container);
                } catch (e) {
                    console.error('解析工作总结卡片数据失败', e);
                    container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-file-signature"></i> [每日工作总结卡片]</div>';
                }
                break;
            case 'collab_card':
                try {
                    // 🔧 从 content(JSON) 或 collab_data 获取协作邀请数据
                    let collabData = message.collab_data || null;
                    if (!collabData && message.content) {
                        try {
                            const parsed = JSON.parse(message.content);
                            if (parsed && parsed.url !== undefined) {
                                collabData = parsed;
                            }
                        } catch (_) {
                        }
                    }
                    this.renderCollabCardInChat(collabData, container);
                } catch (e) {
                    console.error('解析协作邀请卡片数据失败', e);
                    container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-handshake"></i> [协作邀请]</div>';
                }
                break;
            case 'work_order_card':
                try {
                    let woData = message.work_order_data || null;
                    if (!woData && message.content) {
                        try {
                            const parsed = JSON.parse(message.content);
                            if (parsed && parsed.work_order_id !== undefined) woData = parsed;
                        } catch (_) {}
                    }
                    if (woData && typeof this.renderWorkOrderCardInChat === 'function') {
                        this.renderWorkOrderCardInChat(woData, container);
                    } else {
                        container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-clipboard-list"></i> [群工单]</div>';
                    }
                } catch (e) {
                    console.error('解析群工单卡片失败', e);
                    container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-clipboard-list"></i> [群工单]</div>';
                }
                break;
            case 'work_order_notice':
                try {
                    var notice = message.work_order_data || null;
                    if (!notice && typeof message.content === 'string' && message.content.trim().indexOf('{') === 0) {
                        notice = JSON.parse(message.content);
                    }
                    var noticeText = (notice && notice.text) || message.content || '工单通知';
                    var noticeWoId = notice && notice.work_order_id;
                    container.innerHTML = '<div class="wo-notice">'
                        + this.escapeHtml(noticeText)
                        + (noticeWoId ? ' <a class="wo-notice-link" onclick="event.stopPropagation();chatClient.openWorkOrderDetail(' + noticeWoId + ')">查看工单详情 <i class="fas fa-chevron-right"></i></a>' : '')
                        + '</div>';
                } catch (e) {
                    container.innerHTML = '<div class="wo-notice">' + this.escapeHtml(message.content || '工单通知') + '</div>';
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

    },
    });

    // 兜底：点击聊天/群组后同步顶部头像，覆盖不同进入入口或选择流程未走到头像更新的情况
    document.addEventListener('click', function (e) {
        if (!e.target || typeof e.target.closest !== 'function') return;
        var item = e.target.closest('.chat-item[data-room-id], .group-item[data-room-id]');
        if (!item) return;
        var cc = window.chatClient;
        if (!cc || !Array.isArray(cc.chatRooms)) return;
        var roomId = item.getAttribute('data-room-id');
        var room = cc.chatRooms.find(function (r) {
            return parseInt(r.id) === parseInt(roomId);
        });
        if (room && room.room_type === 'group' && typeof cc.renderHeaderGroupAvatar === 'function') {
            cc.renderHeaderGroupAvatar(room);
        }
    });
})();
