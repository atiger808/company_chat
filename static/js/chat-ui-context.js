// static/js/chat-ui-context.js - 状态角标、右键菜单、任务转换、连续朗读、复制/引用、@ 与语音
// 说明：本文件为 ChatClient 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ChatClient.prototype, {

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
    },

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
    },


    // 语音通话
    makeVoiceCall() {
        // this.showAlert('功能提示', '语音通话功能开发中...');
        this.initiateCall('audio');
    },

    // 视频通话
    makeVideoCall() {
        // this.showAlert('功能提示', '视频通话功能开发中...');
        this.initiateCall('video');
    },

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
    },

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
    },

    showToast(message, type = 'success') {
        if (type === 'error') {
            this.showError(message)
        } else {
            this.showSuccess(message)
        }
    },

    showInfo(message) {
        console.log('显示信息:', message);
        const successDiv = document.createElement('div');
        successDiv.className = 'toast toast-info';
        successDiv.textContent = message;
        document.body.appendChild(successDiv);

        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.parentNode.removeChild(successDiv);
            }
        }, 3000);
    },

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
    },

    // 更新未读消息数（在聊天室列表中显示）
    updateUnreadCount(roomId, increment) {

        this.loadChatRooms()

        // const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        // if (room) {
        //     room.unread_count = Math.max(0, (room.unread_count || 0) + increment);
        //     this.renderChatRooms(); // 重新渲染聊天室列表
        // }
    },

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
    },


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
    },

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
    },

    // 添加角标管理方法
    updateAppBadge(count) {
        // 0. 同步聊天未读数给 Service Worker（SW 汇总聊天+工作通知未读来更新图标徽章，
        // 后台被挂起时由 SW 在收到推送时自增保证实时，这里用精确值覆盖）
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({type: 'chat-badge', count: count});
            }
        } catch (e) {
        }

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
    },


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
    },


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
    },

    // 停止标题闪烁
    stopTitleBlink() {
        if (this.titleBlinkInterval) {
            clearInterval(this.titleBlinkInterval);
            this.titleBlinkInterval = null;
        }
    },

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
                const qStatusColors = {
                    'todo': '#909399',
                    'in_progress': '#E6A23C',
                    'done': '#67C23A',
                    'overdue': '#F56C6C'
                };
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
    },

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
    },

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
    },


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
    },


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
            <div class="menu-item" onclick="chatClient.copySelectedItem()"><i class="fas fa-copy"></i> 复制</div>
            <div class="menu-divider"></div>
            <div class="menu-item" onclick="chatClient.quoteSelectedItem()"><i class="fas fa-quote-left"></i> 引用</div>
            <div class="menu-item" onclick="chatClient.forwardSelectedItem()"><i class="fas fa-share"></i> 转发</div>
        `;
            if (this._isTtsableMessage(message)) {
                menuHtml += '<div class="menu-item" onclick="chatClient.speakSelectedMessage()"><i class="fas fa-volume-up"></i> 朗读</div>';
            }

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
    },

    hideContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) menu.style.display = 'none';
        this.contextTarget = null;
    },


    /**
     * 🔧 优雅的消息转任务模态框
     */
    async convertToTask(messageId) {
        const message = this.messages.find(m => m.id === messageId || m.message_id === messageId);
        if (!message) return;

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
                    <div class="form-group">
                        <label>指派给</label>
                        <div class="assignee-picker">
                            <input type="hidden" id="taskConvertAssigneeId" value="">
                            <div class="assignee-selected" id="taskConvertAssigneeSelected" style="display:none;">
                                <img id="taskConvertAssigneeAvatar" class="assignee-avatar" src="/static/images/default-avatar.png" alt="头像">
                                <div class="assignee-info">
                                    <div class="assignee-name" id="taskConvertAssigneeName"></div>
                                    <div class="assignee-meta" id="taskConvertAssigneeMeta"></div>
                                </div>
                                <button type="button" class="assignee-clear" title="取消选择" onclick="chatClient.clearConvertAssignee(event)">&times;</button>
                            </div>
                            <div class="assignee-search">
                                <i class="fas fa-search"></i>
                                <input type="text" id="taskConvertAssigneeSearchInput" class="form-control" placeholder="输入姓名/账号/部门/职位搜索用户...">
                            </div>
                            <div class="assignee-dropdown" id="taskConvertAssigneeDropdown"></div>
                        </div>
                    </div>
                    <div class="form-group">
                            <label>截止日期</label>
                            <input type="datetime-local" id="taskConvertDueDate" class="form-control" style="padding-left: 12px;">
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
        this.initTaskConvertPicker();
        this.hideContextMenu();
    },

    /**
     * 🔧 执行人搜索选择器初始化（消息转任务）
     */
    initTaskConvertPicker() {
        const input = document.getElementById('taskConvertAssigneeSearchInput');
        const dropdown = document.getElementById('taskConvertAssigneeDropdown');
        if (!input || !dropdown) return;
        let debounceTimer = null;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this.searchConvertAssignees(), 250);
        });
        input.addEventListener('focus', () => { if (input.value.trim()) this.searchConvertAssignees(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.searchConvertAssignees(); }
        });
        // 点击选择器外部关闭下拉
        document.addEventListener('click', (e) => {
            if (dropdown.style.display !== 'none' && !document.querySelector('#taskConvertModal .assignee-picker')?.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
        // 模态框内滚动/窗口缩放时关闭下拉，避免位置错乱
        // const modal = document.getElementById('taskConvertModal');
        // if (modal) modal.addEventListener('scroll', () => { dropdown.style.display = 'none'; }, true);
        window.addEventListener('resize', () => { dropdown.style.display = 'none'; });
        // 不默认指派任何人，交由用户搜索选择
    },

    async searchConvertAssignees() {
        const input = document.getElementById('taskConvertAssigneeSearchInput');
        const dropdown = document.getElementById('taskConvertAssigneeDropdown');
        if (!input || !dropdown) return;
        const q = input.value.trim();
        try {
            const res = await fetch(`/api/auth/search_assignees/?q=${encodeURIComponent(q)}`, { headers: TokenManager.getHeaders() });
            if (res.status === 401) { this.handleAuthError(); return; }
            if (!res.ok) return;
            const data = await res.json();
            this.renderConvertAssigneeDropdown(data.results || []);
        } catch (e) { console.error('搜索执行人失败', e); }
    },

    renderConvertAssigneeDropdown(results) {
        const dropdown = document.getElementById('taskConvertAssigneeDropdown');
        if (!dropdown) return;
        this.convertAssigneeResults = results;
        if (!results.length) {
            dropdown.innerHTML = '<div class="assignee-empty">未找到匹配的用户</div>';
            this._positionConvertDropdown();
            return;
        }
        dropdown.innerHTML = results.map((u, i) => {
            const name = this.escapeHtml(u.real_name || u.username);
            const dept = u.department_info ? this.escapeHtml(u.department_info.name || '') : '';
            const pos = this.escapeHtml(u.position || '');
            const meta = [dept, pos].filter(Boolean).join(' · ');
            const avatar = u.avatar_url || '/static/images/default-avatar.png';
            return `<div class="assignee-option" onclick="chatClient.selectConvertAssigneeByIndex(${i})">
                <img class="assignee-avatar" src="${this.escapeHtml(avatar)}" alt="头像">
                <div class="assignee-info">
                    <div class="assignee-name">${name}</div>
                    ${meta ? `<div class="assignee-meta">${meta}</div>` : ''}
                </div>
            </div>`;
        }).join('');
        this._positionConvertDropdown();
    },

    /**
     * 🔧 固定定位下拉：依据输入框实时坐标定位，避免被模态框 overflow 裁剪
     */
    _positionConvertDropdown() {
        const input = document.getElementById('taskConvertAssigneeSearchInput');
        const dropdown = document.getElementById('taskConvertAssigneeDropdown');
        if (!input || !dropdown) return;
        const rect = input.getBoundingClientRect();
        const maxH = 260;
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        let top;
        let maxHeight;
        if (spaceBelow >= 140) {
            top = rect.bottom + 4;
            maxHeight = Math.min(maxH, spaceBelow);
        } else {
            maxHeight = Math.min(maxH, rect.top - 8);
            top = rect.top - maxHeight;
        }
        dropdown.style.top = top + 'px';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        dropdown.style.maxHeight = maxHeight + 'px';
        dropdown.style.display = 'block';
    },

    selectConvertAssigneeByIndex(i) {
        const u = this.convertAssigneeResults[i];
        if (u) this.setConvertAssignee(u);
    },

    setConvertAssignee(u) {
        if (!u || !u.id) return;
        document.getElementById('taskConvertAssigneeId').value = u.id;
        const selected = document.getElementById('taskConvertAssigneeSelected');
        const avatar = document.getElementById('taskConvertAssigneeAvatar');
        const nameEl = document.getElementById('taskConvertAssigneeName');
        const metaEl = document.getElementById('taskConvertAssigneeMeta');
        const input = document.getElementById('taskConvertAssigneeSearchInput');
        const dropdown = document.getElementById('taskConvertAssigneeDropdown');
        if (avatar) avatar.src = u.avatar_url || '/static/images/default-avatar.png';
        if (nameEl) nameEl.textContent = u.real_name || u.username;
        if (metaEl) {
            const dept = u.department_info ? (u.department_info.name || '') : '';
            const pos = u.position || '';
            metaEl.textContent = [dept, pos].filter(Boolean).join(' · ');
        }
        if (selected) selected.style.display = 'flex';
        if (input) input.value = '';
        if (dropdown) dropdown.style.display = 'none';
    },

    clearConvertAssignee(event) {
        if (event) event.stopPropagation();
        document.getElementById('taskConvertAssigneeId').value = '';
        const selected = document.getElementById('taskConvertAssigneeSelected');
        if (selected) selected.style.display = 'none';
    },

    /**
     * 🔧 提交任务创建请求
     */
    async submitConvertTask(messageId) {
        const title = document.getElementById('taskConvertTitle').value.trim();
        const desc = document.getElementById('taskConvertDesc').value.trim();
        const assigneeId = document.getElementById('taskConvertAssigneeId').value;
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
    },

    // ==================== 消息朗读（浏览器语音合成） ====================
    _isTtsableMessage(message) {
        if (!message || message.is_deleted) return false;
        var type = message.message_type || 'text';
        if (type !== 'text' && type !== 'emoji') return false;
        return !!this._messageTtsText(message);
    },

    _messageTtsText(message) {
        var content = String((message && message.content) || '');
        return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    },

    _toggleMessageTTS(message, btn) {
        if (!window.BrowserTTS) return;
        if (!BrowserTTS.supported) { this.showError('当前浏览器不支持语音播放'); return; }
        if (!message || !this._messageTtsText(message)) { this.showError('该消息暂无可朗读内容'); return; }
        // 正在连续朗读：点击当前正在朗读的消息则停止；点击其它消息则从该条重新开始
        var active = this._continuousTTS;
        if (active && String(active.currentId) === String(message.id)) {
            this.stopContinuousTTS();
            return;
        }
        this._startContinuousTTS(message);
    },

    // 从指定消息开始，按时间顺序连续朗读后续文本消息（类似微信连续朗读）
    _startContinuousTTS(startMessage) {
        var items = (this.messages || []).filter(m => this._isTtsableMessage(m));
        if (!items.length) return;
        var idx = items.findIndex(m => String(m.id) === String(startMessage.id));
        if (idx < 0) idx = 0;
        this._continuousTTS = {items: items, index: idx, active: true, currentId: null};
        this._speakContinuousQueue();
    },

    _highlightTTSMessage(msg) {
        document.querySelectorAll('.message-wrapper.tts-reading').forEach(function (x) {
            x.classList.remove('tts-reading');
        });
        var el = document.querySelector(`.message-wrapper[data-message-id="${msg.id}"]`);
        if (el) {
            el.classList.add('tts-reading');
            this._ensureMessageVisible(el);
        }
    },

    _speakContinuousQueue() {
        var st = this._continuousTTS;
        if (!st || !st.active) return;
        var list = st.items.slice(st.index, st.index + 200);
        if (!list.length) { this.stopContinuousTTS(); return; }

        // 立即高亮首条，后续由 onItemStart 逐条切换
        st.currentId = list[0].id;
        this._highlightTTSMessage(list[0]);

        var self = this;
        // 用户通过悬浮面板停止时，同步清理页面高亮与连续朗读状态
        if (window.BrowserTTS) {
            BrowserTTS.onStop = function () { self.stopContinuousTTS(); };
        }
        var lastStarted = -1;
        var entries = list.map(function (msg) {
            var text = self._messageTtsText(msg);
            var sender = (msg.sender && (msg.sender.real_name || msg.sender.username)) || '';
            return {text: sender ? sender + '：' + text : text, data: msg};
        });
        // 一次性入队，iOS/移动端不会因异步回调续播被系统拦截
        var ok = BrowserTTS.speakSequence(entries, {
            lang: 'zh-CN',
            onItemStart: function (index, msg) {
                if (self._continuousTTS !== st) return;
                lastStarted = index;
                st.currentId = msg.id;
                self._highlightTTSMessage(msg);
            },
            onend: function () {
                if (self._continuousTTS !== st) return;
                // 浏览器提前中断长队列时，从下一条继续
                if (lastStarted >= 0 && lastStarted < list.length - 1) {
                    st.index = st.index + lastStarted + 1;
                    self._speakContinuousQueue();
                    return;
                }
                self.stopContinuousTTS();
            }
        });
        if (!ok) this.stopContinuousTTS();
    },

    _ensureMessageVisible(el) {
        var list = document.getElementById('messagesList');
        if (!list || !el) return;
        var r = el.getBoundingClientRect();
        var lr = list.getBoundingClientRect();
        if (r.top >= lr.top + 8 && r.bottom <= lr.bottom - 8) return;
        // 即时滚动，避免平滑滚动动画打断语音合成队列
        var target = list.scrollTop + (r.top - lr.top) - Math.max(8, (list.clientHeight - el.offsetHeight) / 2);
        list.scrollTop = Math.max(0, target);
    },

    stopContinuousTTS() {
        this._continuousTTS = null;
        if (window.BrowserTTS) {
            BrowserTTS.onStop = null;
            BrowserTTS.stop();
        }
        document.querySelectorAll('.message-wrapper.tts-reading').forEach(function (x) {
            x.classList.remove('tts-reading');
        });
    },

    speakSelectedMessage() {
        var message = this.contextTarget;
        this.hideContextMenu();
        if (message) this._toggleMessageTTS(message, null);
    },

    forwardSelectedItem() {
        if (this.contextTarget) {
            const message = this.contextTarget;
            this.showForwardModal(message);
        }
        this.hideContextMenu();
    },

    quoteSelectedItem() {
        if (this.contextTarget) {
            const message = this.contextTarget;
            this.setQuoteMessage(message);
        }
        this.hideContextMenu();
    },

    // 复制右键选中的消息（文本走系统剪贴板；文件/图片/视频/语音同时写入结构化标记，
    // 在聊天输入框粘贴时可直接按原消息类型发送，而不是变成一条链接文本）
    copySelectedItem() {
        const message = this.contextTarget;
        this.hideContextMenu();
        if (!message) return;
        const text = this.getMessageCopyText(message);
        if (!text) {
            this.showInfo('该消息暂无可复制的内容');
            return;
        }
        const payload = this.getStructuredCopyPayload(message);
        // 兼容非 HTTPS / 不支持 ClipboardItem 的环境：记住本次复制内容，粘贴时按文本匹配
        this._copiedMessage = payload
            ? { text: text.trim(), payload: payload, at: Date.now() }
            : null;

        this.copyMessageToClipboard(text, payload, message).then(() => {
            this.showSuccess(payload ? '已复制，可在输入框直接粘贴发送' : '已复制到剪贴板');
        }).catch(() => {
            this.copyTextToClipboard(text).then((ok) => {
                if (ok) this.showSuccess(payload ? '已复制，可在输入框直接粘贴发送' : '已复制到剪贴板');
                else this.showError('复制失败，请手动选择内容复制');
            });
        });
    },

    // 可结构化复制的消息（图片/视频/语音/音频/文件），优先复用 file_id 免二次上传
    getStructuredCopyPayload(message) {
        const types = ['image', 'video', 'voice', 'audio', 'file'];
        if (!message || types.indexOf(message.message_type) === -1) return null;
        if (!message.file_id && !(message.file_info && message.file_info.id)) return null;
        const fi = message.file_info || {};
        return {
            t: message.message_type,
            id: message.file_id || fi.id,
            c: message.content || '',
            f: {
                id: message.file_id || fi.id,
                name: fi.name || '',
                size: fi.size || 0,
                url: fi.url || '',
                mime_type: fi.mime_type || '',
                duration: fi.duration || 0,
                mp3_url: fi.mp3_url || '',
            },
            v: message.voice_duration || fi.duration || 0,
        };
    },

    // 写入富格式剪贴板：text/plain（外部粘贴为文字/链接）+ text/html（内嵌可识别标记）
    // + 图片消息尽量附带 image/png（外部应用可直接粘贴图片）
    copyMessageToClipboard(text, payload, message) {
        return new Promise((resolve, reject) => {
            if (!navigator.clipboard || !navigator.clipboard.write
                || !window.isSecureContext || typeof window.ClipboardItem === 'undefined') {
                reject(new Error('clipboard unsupported'));
                return;
            }
            let html = this.escapeHtml(text).replace(/\n/g, '<br>');
            if (payload) {
                let b64 = '';
                try {
                    const bytes = new TextEncoder().encode(JSON.stringify(payload));
                    b64 = btoa(String.fromCharCode.apply(null, bytes));
                } catch (e) { b64 = ''; }
                if (b64) html += '<!--ZQMSG:' + b64 + '-->';
            }
            const baseTypes = {
                'text/plain': new Blob([text], {type: 'text/plain'}),
                'text/html': new Blob([html], {type: 'text/html'}),
            };
            const write = (types) => navigator.clipboard.write([new window.ClipboardItem(types)]);

            const doWrite = (extra) => {
                const types = Object.assign({}, baseTypes, extra || {});
                write(types).then(resolve).catch(() => {
                    // 部分浏览器不支持多类型组合：逐步降级为纯文本
                    const t2 = Object.assign({}, baseTypes);
                    delete t2['image/png'];
                    write(t2).then(resolve).catch(() => {
                        write({'text/plain': baseTypes['text/plain']}).then(resolve).catch(reject);
                    });
                });
            };

            if (payload && payload.t === 'image' && payload.f && payload.f.url) {
                this._fetchClipboardImageBlob(payload.f.url).then((blob) => {
                    doWrite(blob ? {'image/png': blob} : null);
                }).catch(() => doWrite(null));
            } else {
                doWrite(null);
            }
        });
    },

    // 拉取图片并转成 PNG Blob（剪贴板图片仅稳定支持 image/png）
    _fetchClipboardImageBlob(url) {
        return fetch(url, {credentials: 'same-origin'}).then((resp) => {
            if (!resp.ok) throw new Error('fetch image failed');
            return resp.blob();
        }).then((blob) => {
            if (blob.type === 'image/png') return blob;
            return new Promise((resolve, reject) => {
                const img = new Image();
                const objUrl = URL.createObjectURL(blob);
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        canvas.toBlob((png) => {
                            URL.revokeObjectURL(objUrl);
                            if (png) resolve(png); else reject(new Error('toBlob failed'));
                        }, 'image/png');
                    } catch (e) {
                        URL.revokeObjectURL(objUrl);
                        reject(e);
                    }
                };
                img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('image load failed')); };
                img.src = objUrl;
            });
        });
    },

    // 解析剪贴板中的站内消息标记
    _readCopiedMessageMarker(clipboardData) {
        try {
            const html = clipboardData && clipboardData.getData ? clipboardData.getData('text/html') : '';
            const m = /<!--ZQMSG:([A-Za-z0-9+/=]+)-->/.exec(html || '');
            if (!m) return null;
            const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
            const p = JSON.parse(new TextDecoder().decode(bytes));
            const allowed = ['image', 'video', 'voice', 'audio', 'file'];
            if (!p || allowed.indexOf(p.t) === -1 || !p.id) return null;
            return p;
        } catch (e) {
            return null;
        }
    },

    // 粘贴已复制的文件/图片/视频/语音消息：复用原 file_id，直接按原类型发送
    sendExistingFileMessage(payload) {
        const roomId = parseInt(this.currentRoomId);
        if (!roomId || !payload || !payload.id) {
            this.showError('请先选择一个聊天对象');
            return;
        }
        const tempMessageId = Date.now();
        const messageType = payload.t || 'file';
        const fileInfo = Object.assign({}, payload.f || {});
        if (payload.v) fileInfo.duration = payload.v;
        const messageData = {
            id: tempMessageId,
            temp_id: tempMessageId,
            sender_id: this.currentUser.id,
            sender_name: this.currentUser.username,
            sender: this.currentUser,
            content: payload.c || this.getFileMessageContent(messageType),
            timestamp: new Date().toISOString(),
            is_read: true,
            chat_room: roomId,
            message_type: messageType,
            file_id: payload.id,
            file_info: fileInfo,
            voice_duration: payload.v || undefined,
            is_temp: true,
        };
        this.messages.push(messageData);
        this.renderMessage(messageData, 'sent');
        Utils.scrollToBottom(document.getElementById('messagesList'));

        const wsReady = this.ws && this.ws.readyState === WebSocket.OPEN &&
            parseInt(this.ws._roomId) === roomId;
        if (wsReady) {
            this.ws.send(JSON.stringify(this.encryptPacket({
                type: 'chat_message',
                ...messageData,
            })));
            this.updateChatRoomLastMessage(roomId, messageData.content, messageData.timestamp);
            const label = {image: '图片', video: '视频', voice: '语音', audio: '音频', file: '文件'}[messageType] || '消息';
            this.showSuccess('已粘贴发送' + label);
        } else {
            this.messageQueue.push(messageData);
            this.showError('网络连接不稳定，消息将在连接恢复后发送');
        }
    },

    // 不同消息类型 → 可复制的文本
    getMessageCopyText(message) {
        if (!message) return '';
        const self = this;
        const absoluteUrl = function (u) {
            if (!u) return '';
            if (/^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return u;
            return window.location.origin + (u.charAt(0) === '/' ? '' : '/') + u;
        };
        const fileUrl = message.file_info && message.file_info.url
            ? absoluteUrl(message.file_info.url) : '';
        const plain = function () { return self.htmlToPlainText(message.content || '').trim(); };

        switch (message.message_type) {
            case 'text':
            case 'emoji':
            case 'announcement':
            case 'system':
                return plain();
            case 'image':
            case 'video':
            case 'audio':
            case 'voice':
            case 'location':
                return fileUrl || plain();
            case 'file': {
                const name = (message.file_info && message.file_info.name) || '';
                return [name, fileUrl].filter(Boolean).join('\n');
            }
            case 'task_card': {
                const d = this.parseMessageContentData(message, 'task_data');
                if (!d) return plain();
                const statusMap = {todo: '待处理', in_progress: '进行中', done: '已完成', overdue: '已逾期'};
                const status = statusMap[d.status] || d.status || '';
                const assignee = d.assignee_info
                    ? (d.assignee_info.real_name || d.assignee_info.username || '')
                    : (d.assignee_name || '');
                let out = '任务：' + (d.title || d.task_title || '');
                if (status) out += '（' + status + '）';
                if (assignee) out += '\n执行人：' + assignee;
                if (d.id) out += '\n' + window.location.origin + '/tasks/?task_id=' + d.id;
                return out.trim();
            }
            case 'approval_card': {
                const d = this.parseMessageContentData(message, 'approval_data');
                if (!d) return plain();
                let out = '审批：' + (d.type_name ? d.type_name + ' - ' : '') + (d.title || '');
                if (d.status_display) out += '（' + d.status_display + '）';
                if (d.applicant_name) out += '\n发起人：' + d.applicant_name;
                if (d.approval_id) out += '\n' + window.location.origin + '/oa/approval/?approval_id=' + d.approval_id;
                return out.trim();
            }
            case 'work_summary_card': {
                const d = this.parseMessageContentData(message, 'work_summary_data');
                if (!d) return plain();
                let out = ('每日工作总结：' + (d.summary_date || '') + ' ' + (d.user_name || '')).trim();
                if (d.summary_id) out += '\n' + window.location.origin + '/oa/work-summary/?id=' + d.summary_id;
                return out;
            }
            case 'collab_card': {
                const d = this.parseMessageContentData(message, 'collab_data');
                if (!d) return plain();
                let out = ('协作邀请：' + (d.title || d.target_name || '')).trim();
                if (d.inviter_name) out += '\n邀请人：' + d.inviter_name;
                if (d.url) out += '\n' + absoluteUrl(d.url);
                return out;
            }
            case 'work_order_card': {
                const d = this.parseMessageContentData(message, 'work_order_data');
                if (!d) return plain();
                let out = ('群工单：' + (d.order_no || '') + ' ' + (d.title || '')).trim();
                if (d.status_display) out += '（' + d.status_display + '）';
                if (d.current_stage && d.current_stage.name) {
                    out += '\n当前环节：' + d.current_stage.name + '（' + (d.current_stage.assignee_name || '未指派') + '）';
                }
                if (d.work_order_id) out += '\n' + window.location.origin + '/tasks/?work_order_id=' + d.work_order_id;
                return out;
            }
            case 'work_order_notice': {
                const d = this.parseMessageContentData(message, 'work_order_data');
                if (d && d.text) return d.text;
                return plain();
            }
            case 'call_audio':
            case 'call_video': {
                const sec = Number((message.file_info && message.file_info.call_duration) || 0);
                const label = message.message_type === 'call_video' ? '视频通话' : '语音通话';
                const dur = sec >= 60 ? (Math.floor(sec / 60) + '分' + (sec % 60) + '秒') : (sec + '秒');
                return label + '：' + dur;
            }
            default:
                return plain();
        }
    },

    // 卡片消息数据兼容 content JSON 与 *_data 字段
    parseMessageContentData(message, field) {
        const direct = message && message[field];
        if (direct && typeof direct === 'object') return direct;
        if (message && typeof message.content === 'string') {
            try {
                const parsed = JSON.parse(message.content);
                return (parsed && typeof parsed === 'object') ? parsed : null;
            } catch (e) { /* 非 JSON 内容 */ }
        }
        return null;
    },

    // 消息正文可能是 HTML（@提及、表情等），复制时转为纯文本
    htmlToPlainText(html) {
        if (!html) return '';
        let s = String(html);
        if (s.indexOf('<') === -1 && s.indexOf('&') === -1) return s;
        s = s.replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li)>/gi, '\n')
            .replace(/<[^>]*>/g, '');
        const ta = document.createElement('textarea');
        ta.innerHTML = s;
        return ta.value.replace(/\n{3,}/g, '\n\n');
    },

    // 复制到剪贴板：优先 Clipboard API，失败/非安全上下文时回退 execCommand
    copyTextToClipboard(text) {
        return new Promise((resolve) => {
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text)
                    .then(() => resolve(true))
                    .catch(() => resolve(this.copyTextFallback(text)));
            } else {
                resolve(this.copyTextFallback(text));
            }
        });
    },

    copyTextFallback(text) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e) {
            return false;
        }
    },


    /**
     * 🔧 右键菜单删除
     */
    deleteSelectedItem() {
        if (this.contextTarget) {
            const message = this.contextTarget;
            this.deleteMessage(message);
        }
        this.hideContextMenu();
    },

    deleteMessage(message) {
        console.log("delete message: ", message)
    },

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
    },

    // 关闭@面板
    closeAtPanel() {
        this.isAtPanelOpen = false;
        this.atPanelPosition = null;

        const atPanel = document.getElementById('atPanel');
        if (atPanel) {
            atPanel.style.display = 'none';
            atPanel.innerHTML = '';
        }
    },

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
    },

    // 过滤@成员
    filterAtMembers(keyword) {
        const items = document.querySelectorAll('.at-member-item');
        items.forEach(item => {
            const name = item.querySelector('.at-member-name').textContent.toLowerCase();
            const username = item.querySelector('.at-member-username').textContent.toLowerCase();
            const match = name.includes(keyword.toLowerCase()) || username.includes(keyword.toLowerCase());
            item.style.display = match ? 'flex' : 'none';
        });
    },

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
    },


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
    },

    // 录音开始震动反馈
    startRecordingVibration() {
        if ('vibrate' in navigator && Utils.isMobile()) {
            navigator.vibrate([50, 30, 50]); // 短-短-短震动
        }
    },

    // 录音结束震动反馈
    stopRecordingVibration() {
        if ('vibrate' in navigator && Utils.isMobile()) {
            navigator.vibrate(100); // 长震动
        }
    },


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
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage = '麦克风权限被拒绝';
                // 引导用户去系统设置开启麦克风权限（移动端 PWA 友好提示）
                if (window.PermUtils) PermUtils.showPermissionGuide('microphone', '录音需要麦克风权限。');
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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },


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
    },


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
    },


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
    },


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
    },
    });
})();
