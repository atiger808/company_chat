// static/js/chat-modals.js - 用户资料、通知面板、新建聊天、组织架构与企业切换
// 说明：本文件为 ChatClient 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ChatClient.prototype, {


    // 显示用户详细信息
    // 打开子模态框（用户信息等）前记录当前已打开的模态框，关闭子模态框后原样恢复
    _captureModalReturnStack(excludeId) {
        var ids = [];
        document.querySelectorAll('.modal.show, .user-profile-modal.show').forEach(function (m) {
            if (m.id && m.id !== excludeId) ids.push(m.id);
        });
        this._modalReturnStack = ids;
    },

    _restoreModalReturnStack() {
        var ids = this._modalReturnStack || [];
        this._modalReturnStack = [];
        if (!ids.length) return;
        var self = this;
        // 放到下一个事件循环，确保子模态框的关闭动画/状态已处理完
        setTimeout(function () {
            ids.forEach(function (id) { self.openModal(id); });
        }, 0);
    },

    // 关闭用户信息模态框；restore 为 false 时不回到上一层（如点了「发起私聊」）
    _closeUserProfileModal(restore) {
        this.closeModal('userProfileModal');
        if (restore === false) {
            this._modalReturnStack = [];
        } else {
            this._restoreModalReturnStack();
        }
    },

    async showUserProfile(userId, room) {
        console.log('显示用户详细信息:', userId);
        if (!userId || userId === this.currentUser.id) {
            // 如果是当前用户，显示设置模态框
            this.showSettings();
            return;
        }

        // 记录当前打开的模态框（例如群成员管理弹窗），关闭用户信息后返回它
        this._captureModalReturnStack('userProfileModal');

        try {
            const userData = await API.toggleGetUserProfile(userId);
            // 创建用户信息弹窗（room 用于展示私聊聊天室所属企业）
            this.createUserProfileModal(userData, room);
        } catch (error) {
            console.error('获取用户信息失败:', error);
            this.showError('获取用户信息失败: ' + (error.error || error.message || '未知错误'));
            await this.checkLoginStatus();
        }
    },

    showProfile(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room) return;
        if (room.room_type === 'private') {
            let otherUser = room.members.find(m => m.id !== this.currentUser.id);
            if (otherUser?.id) {
                this.showUserProfile(otherUser?.id, room);
            }
        } else if (room.room_type === 'group') {
            this.showGroupProfile(room);
        }
    },

    showGroupProfile(room) {
        if (room.creator !== this.currentUser.id) {
            this.showGroupMemberListModal(room)
            return;
        } else {
            this.showGroupManagementModal(room)
        }

    },


    // 优化用户信息模态框
    createUserProfileModal(userData, room) {
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
                ${room && room.room_type === 'private' ? `
                <div class="private-room-tenant-banner">
                    <i class="fas fa-building"></i> 私聊所属企业：<strong>${this._escape(room.tenant_name || userData.tenant_info?.name || '-')}</strong>
                </div>` : ''}

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
                            <label>所属企业:</label>
                            <span>${userData.tenant_info?.name || '-'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>部门:</label>
                            <span>${userData.org_departments && userData.org_departments.length ? userData.org_departments.map(function (d) {
            return '<i class="fas fa-sitemap" style="color:#e6a23c;font-size:11px;margin-right:4px;"></i>' + chatClient._escape(d.full_path || d.name)
        }).join('<br>') : (userData.department_info?.name ? (userData.department_info.name + (userData.department_info.type === 'legacy' ? '' : '')) : '未设置')}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>职位:</label>
                            <span>${userData.position || (userData.org_departments && userData.org_departments.length ? userData.org_departments[0].position : '') || '未设置'}</span>
                        </div>
                        <div class="profile-info-item">
                            <label>直属主管:</label>
                            <span>${userData.supervisor ? (userData.supervisor.real_name || userData.supervisor.username) : '未设置'}</span>
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
                this._closeUserProfileModal();
            };
        }

        if (closeModalBtn) {
            closeModalBtn.onclick = (e) => {
                e.stopPropagation();
                this._closeUserProfileModal();
            };
        }

        // 🔧 关键修复4: 为"发起私聊"按钮单独绑定事件（先私聊再关闭，不回到上一层弹窗）
        const startChatBtn = modal.querySelector('.start-chat-btn');
        if (startChatBtn) {
            startChatBtn.onclick = (e) => {
                e.stopPropagation();
                const userId = startChatBtn.dataset.userId;

                // 先发起私聊
                this.selectUserForChat(userId);
                // 再关闭模态框（直接进入新私聊，不恢复群成员弹窗）
                this._closeUserProfileModal(false);
            };
        }


        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) this._closeUserProfileModal();
        };
    },


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

    },

    // 关闭指定模态框
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    },

    // 清除指定模态框
    clearModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.remove();
        }
    },

    // 打开指定模态框
    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('show');
        }
    },


    // 修复：打开新建聊天模态框
    openNewChatModal() {
        const newChatModal = document.getElementById('newChatModal');
        if (newChatModal) {
            newChatModal.classList.add('show');
            this.initNewChatModal();
        }
    },

    // ==================== 工作通知 ====================

    openNotifications() {
        // 更新侧边栏激活状态
        this.currentRoomId = null;
        document.querySelectorAll('.chat-item.cursor-pointer').forEach(function (el) {
            el.classList.remove('active');
        });
        // 收起移动端侧边栏
        if (window.innerWidth <= 768) {
            document.querySelector('.sidebar').classList.remove('show');
        }

        // 设置聊天头
        document.getElementById('chatTitle').textContent = '工作通知';
        document.getElementById('chatStatus').textContent = '';
        this.setChatHeaderAvatar('/media/avatars/work-notify.png');
        // 隐藏聊天输入区和头部操作按钮
        this._setChatControlsVisible(false);

        // 隐藏消息列表和组织架构视图，显示通知容器
        document.getElementById('messagesList').style.display = 'none';
        document.getElementById('messagesEmpty').style.display = 'none';
        var ov = document.getElementById('orgViewContainer');
        if (ov) ov.classList.add('hidden');
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
        // 回到顶部浮动按钮（仅通知列表内滚动时出现）
        this._ensureNotifBackTop();
        this._bindNotifScroll();

        // 加载通知数据
        this._loadNotificationList();
    },

    async _loadNotificationList(filter) {
        if (filter === undefined) filter = this._notifFilter || '';
        this._notifFilter = filter;
        this._notifPage = 1;
        this._notifHasMore = false;
        this._notifLoadingMore = false;

        var container = document.getElementById('notificationMessages');
        if (!container) return;
        var reqToken = (this._notifReqToken = (this._notifReqToken || 0) + 1);
        container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-light);"><i class="fas fa-spinner fa-spin" style="font-size:32px;"></i><p style="margin-top:12px;">加载中...</p></div>';
        container.scrollTop = 0;
        this._hideNotifBackTop();
        this._bindNotifScroll();

        try {
            var data = await this._fetchNotifPage(1);
            if (reqToken !== this._notifReqToken) return;
            var rows = (data && data.results) || [];
            this._notifHasMore = (data && data.page ? data.page : 1) < (data && data.total_pages ? data.total_pages : 1);

            if (!rows.length) {
                container.innerHTML = this._notifFilterHtml(filter)
                    + '<div style="text-align:center;padding:60px 20px;color:var(--text-light);"><i class="fas fa-bell-slash" style="font-size:48px;opacity:0.4;"></i><p style="margin-top:12px;">暂无工作通知</p></div>';
                return;
            }

            container.innerHTML = this._notifFilterHtml(filter)
                + '<div id="notifItemsWrap">' + rows.map(this._notifRowHtml.bind(this)).join('') + '</div>'
                + '<div id="notifLoadMoreWrap" style="padding:14px;text-align:center;">' + this._notifFootHtml() + '</div>';
        } catch (e) {
            if (reqToken !== this._notifReqToken) return;
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><i class="fas fa-exclamation-circle" style="font-size:36px;"></i><p style="margin-top:8px;">加载失败</p></div>';
        }
    },

    // 工作通知分页：加载下一页（按钮 + 文案提示），追加到列表底部
    async _loadMoreNotifications() {
        if (this._notifLoadingMore || !this._notifHasMore) return;
        this._notifLoadingMore = true;
        var filterAtStart = this._notifFilter;

        var hint = document.getElementById('notifLoadMoreHint');
        var btn = document.getElementById('notifLoadMoreBtn');
        if (hint) hint.style.display = 'block';
        if (btn) {
            btn.disabled = true;
            btn.style.opacity = '0.7';
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
        }

        try {
            var next = (this._notifPage || 1) + 1;
            var data = await this._fetchNotifPage(next);
            if (filterAtStart !== this._notifFilter) return;
            var rows = (data && data.results) || [];
            this._notifPage = (data && data.page) || next;
            this._notifHasMore = this._notifPage < (data && data.total_pages ? data.total_pages : 1);

            var itemsWrap = document.getElementById('notifItemsWrap');
            if (rows.length && itemsWrap) {
                itemsWrap.insertAdjacentHTML('beforeend', rows.map(this._notifRowHtml.bind(this)).join(''));
            }

            var foot = document.getElementById('notifLoadMoreWrap');
            if (foot) foot.innerHTML = this._notifFootHtml();
        } catch (e) {
            if (hint) hint.style.display = 'none';
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.innerHTML = '加载更多 <i class="fas fa-chevron-down" style="font-size:11px;"></i>';
            }
        } finally {
            this._notifLoadingMore = false;
        }
    },

    async _fetchNotifPage(page) {
        var url = '/api/oa/notifications/?page=' + page + '&page_size=20';
        if (this._notifFilter) url += '&read_filter=' + this._notifFilter;
        var resp = await fetch(url, {headers: TokenManager.getHeaders()});
        var raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    },

    _notifTypeIcon(t) {
        if (typeof typeIcon === 'function') return typeIcon(t);
        return 'fas ' + ({'approval': 'fa-check-double', 'attendance': 'fa-clock', 'task': 'fa-tasks', 'collab': 'fa-users', 'subsidy': 'fa-hand-holding-usd', 'subsidy_apply': 'fa-file-invoice', 'subsidy_result': 'fa-clipboard-check', 'subsidy_withdraw': 'fa-money-check-alt', 'subsidy_withdraw_result': 'fa-wallet', 'daily': 'fa-calendar-day', 'work_summary': 'fa-file-signature', 'announcement': 'fa-bullhorn', 'workorder': 'fas fa-clipboard-list', 'hr': 'fa-user-tie', 'system': 'fa-bell'}[t] || 'fa-bell');
    },

    _notifTypeColor(t) {
        if (typeof typeColor === 'function') return typeColor(t);
        return {'approval': '#409eff', 'attendance': '#67c23a', 'task': '#e6a23c', 'collab': '#9b59b6', 'subsidy': '#16a085', 'subsidy_apply': '#16a085', 'subsidy_result': '#67c23a', 'subsidy_withdraw': '#e6a23c', 'subsidy_withdraw_result': '#16a085', 'daily': '#409eff', 'work_summary': '#9b59b6', 'announcement': '#7c4dff', 'workorder': '#00a1ff', 'hr': '#6c5ce7', 'system': '#909399'}[t] || '#909399';
    },

    _notifFormatTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        var pad = function (n) {
            return String(n).padStart(2, '0');
        };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },

    _notifRowHtml(n) {
        var icon = this._notifTypeIcon(n.type);
        var color = this._notifTypeColor(n.type);
        var cls = n.is_read ? '' : 'notif-item-unread';
        var dotHtml = n.is_read ? '' : '<span style="position:absolute;top:20px;right:2px;width:8px;height:8px;border-radius:50%;background:#409eff;"></span>';
        var u = (n.related_url || '');
        var detailBtn = u ? '<span onclick="event.stopPropagation();chatClient._clickNotification(' + n.id + ',\'' + u + '\',' + (n.is_read ? 'true' : 'false') + ')" style="display:inline-block;margin-top:6px;padding:2px 10px;font-size:11px;color:var(--primary-color,#409eff);background:#ecf5ff;border-radius:4px;cursor:pointer;">查看详情 <i class="fas fa-arrow-right" style="font-size:10px;"></i></span>' : '';
        return '<div class="notif-chat-item ' + cls + '" onclick="chatClient._markNotifRead(' + n.id + ')" style="position:relative;display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid #ede4e4;cursor:pointer;transition:background 0.15s;">'
            + '<div style="width:40px;height:40px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;font-size:16px;"><i class="' + icon + '"></i></div>'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:14px;font-weight:' + (n.is_read ? '400' : '600') + ';color:var(--text-primary,#303133);">' + this._notifEscape(n.title) + '</span>'
            + '<span style="font-size:11px;color:var(--text-light,#909399);flex-shrink:0;margin-left:8px;">' + this._notifFormatTime(n.created_at) + '</span></div>'
            + '<div style="font-size:13px;color:var(--text-secondary,#606266);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + this._notifEscape(n.content) + '</div>' + detailBtn + '</div>' + dotHtml + '</div>';
    },

    _notifFilterHtml(filter) {
        var btn = function (val, label, radius) {
            var active = filter === val;
            return '<button style="padding:4px 14px;border:1px solid var(--border-color,#dcdfe6);background:' + (active ? 'var(--primary-color,#409eff)' : '#fff') + ';color:' + (active ? '#fff' : 'var(--text-secondary,#606266)') + ';font-size:12px;cursor:pointer;' + radius + '" onclick="chatClient._loadNotificationList(\'' + val + '\')">' + label + '</button>';
        };
        return '<div style="display:flex;gap:0;padding:8px 16px;border-bottom:1px solid var(--border-color,#ebeef5);">'
            + btn('', '全部', 'border-radius:14px 0 0 14px;border-right:none;')
            + btn('unread', '未读', 'border-right:none;')
            + btn('read', '已读', 'border-radius:0 14px 14px 0;')
            + '</div>';
    },

    _notifFootHtml() {
        if (!this._notifHasMore) {
            return '<div style="color:var(--text-light,#909399);font-size:12px;">已加载全部通知</div>';
        }
        return '<div id="notifLoadMoreHint" style="display:none;margin-bottom:8px;font-size:12px;color:var(--text-light,#909399);">'
            + '<i class="fas fa-spinner fa-spin"></i> 正在加载更多通知...</div>'
            + '<button id="notifLoadMoreBtn" onclick="event.stopPropagation();chatClient._loadMoreNotifications()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 24px;border:1px solid var(--border-color,#dcdfe6);border-radius:18px;background:var(--bg-secondary,#f5f7fa);color:var(--primary-color,#409eff);font-size:13px;cursor:pointer;">加载更多 <i class="fas fa-chevron-down" style="font-size:11px;"></i></button>';
    },

    // 通知列表滚动时显示「回到顶部」浮动按钮
    _bindNotifScroll() {
        var container = document.getElementById('notificationMessages');
        if (!container || container._notifScrollBound) return;
        container._notifScrollBound = true;
        container.addEventListener('scroll', function () {
            var btn = document.getElementById('notifBackTopBtn');
            if (!btn) return;
            btn.style.display = container.scrollTop > 160 ? 'flex' : 'none';
        });
    },

    _ensureNotifBackTop() {
        var mc = document.getElementById('messagesContainer');
        if (!mc) return;
        var btn = document.getElementById('notifBackTopBtn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'notifBackTopBtn';
            btn.title = '回到顶部';
            btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
            btn.style.cssText = 'position:absolute;right:22px;bottom:18px;z-index:40;width:40px;height:40px;border-radius:50%;border:none;background:rgba(64,158,255,0.92);color:#fff;font-size:16px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.18);display:none;align-items:center;justify-content:center;';
            btn.onclick = function () {
                var c = document.getElementById('notificationMessages');
                if (c) c.scrollTo({top: 0, behavior: 'smooth'});
            };
            mc.appendChild(btn);
        }
    },

    _hideNotifBackTop() {
        var btn = document.getElementById('notifBackTopBtn');
        if (btn) btn.style.display = 'none';
    },

    async _markNotifRead(id) {
        try {
            await fetch('/api/oa/notifications/' + id + '/mark-read/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
        } catch (e) {
        }
        if (window.WorkNotif && window.WorkNotif.refreshCount) {
            window.WorkNotif.refreshCount();
        }
    },

    async _clickNotification(id, url, isRead) {
        if (!isRead) {
            try {
                await fetch('/api/oa/notifications/' + id + '/mark-read/', {
                    method: 'POST', headers: TokenManager.getHeaders()
                });
            } catch (e) {
            }
            if (window.WorkNotif && window.WorkNotif.refreshCount) {
                window.WorkNotif.refreshCount();
            }
        }
        if (url) {
            window.location.href = url;
        }
    },

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

        // 重置搜索防抖与搜索结果缓存
        clearTimeout(this._privateUserSearchTimer);
        clearTimeout(this._groupMemberSearchTimer);
        this._privateUserSearchSeq = (this._privateUserSearchSeq || 0) + 1;
        this._groupMemberSearchSeq = (this._groupMemberSearchSeq || 0) + 1;
        this._memberSearchResults = null;

        // 重置选中的成员
        this.selectedMembersForGroup = [];
        this.updateSelectedMembersDisplay();

        // 加载用户列表
        this.loadUsersForChat();
    },

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
    },

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
    },

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
    },

    // 选择用户进行私聊
    selectUserForPrivateChat(userId) {
        if (!userId || parseInt(userId) === parseInt(this.currentUser.id)) return;

        // 直接创建私聊
        this.createPrivateChat([userId.toString()]);
        this.closeModal('newChatModal');
    },

    // 切换成员选择状态
    toggleMemberSelection(userId) {
        const index = this.selectedMembersForGroup.indexOf(userId);
        if (index > -1) {
            this.selectedMembersForGroup.splice(index, 1);
        } else {
            this.selectedMembersForGroup.push(userId);
        }
        this.renderMemberSearchResults(this._memberSearchResults || this.usersForChat);
        this.updateSelectedMembersDisplay();
    },


    // 渲染用户列表（通讯录）
    // 在 renderUserList 方法中添加头像点击事件
    renderUserList() {
        const contactsList = document.getElementById('contactsList');
        if (!contactsList) return;

        const users = Array.isArray(this.users) ? this.users : [];

        let html = '';
        users.forEach(user => {

            if (user.id === this.currentUser.id) return; // 排除自己

            const mainDept = user.department_info?.name || user.department || '未设置';
            const position = user.position || user.department_info?.position || '未设置';
            const tenantName = user.tenant_info?.short_name || user.tenant_info?.name || '';
            html += `
            <div class="user-list-item" data-user-id="${user.id}">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}"
                     alt="${user.real_name || user.username}" class="user-list-avatar"
                     onclick="chatClient.showUserProfile(${user.id})">
                <div class="user-list-info">
                    <div class="user-list-name">${user.real_name || user.username}</div>
                    <div class="user-list-department">
                        <span title="主部门"><i class="fas fa-sitemap"></i> ${this._escape(mainDept)}</span>
                        <span title="职位"><i class="fas fa-user-tie"></i> ${this._escape(position)}</span>
                    </div>
                    <div class="user-list-enterprise" title="所属企业">
                        <i class="fas fa-building"></i> ${this._escape(tenantName || '未归属企业')}
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
    },


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

                // 🔧 群公告消息：最后一条是群公告时加 [群公告] 前缀（红字 + 闪烁，与 @ 提示同款）
                if (lastMessage.message_type === 'announcement') {
                    mentionHint = '<span class="mention-hint announce-hint">[群公告] </span> ' + mentionHint;
                }

                // 🔧 关键修复：群聊头像不添加输入指示器（群聊使用成员九宫格头像）
                const avatarHtml = this.buildGroupAvatarHtml(group);


                html += `
                <div class="group-item" data-room-id="${group.id}" onclick="chatClient.selectChatRoom('${group.id}')">
                    <div class="group-avatar group-avatar-grid-wrap">
                         ${avatarHtml}
                    </div>
                    <div class="group-info">
                        <div class="group-title">${group.display_name}</div>
                        <div class="group-enterprise" title="所属企业">
                            <i class="fas fa-building"></i> ${this._escape(group.tenant_name || '未归属企业')}
                        </div>
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
    },

    // ────────── 组织架构侧边栏 ──────────

    /** 打开组织架构视图（主内容区域） */
    openOrgView() {
        // 隐藏消息区域，显示组织架构视图
        this.currentRoomId = null;
        document.querySelectorAll('.chat-item.cursor-pointer').forEach(function (el) {
            el.classList.remove('active');
        });
        if (window.innerWidth <= 768) {
            var sidebar = document.querySelector('.sidebar');
            if (sidebar) sidebar.classList.remove('show');
        }
        var msgList = document.getElementById('messagesList');
        if (msgList) msgList.style.display = 'none';
        var msgEmpty = document.getElementById('messagesEmpty');
        if (msgEmpty) msgEmpty.style.display = 'none';
        var notif = document.getElementById('notificationMessages');
        if (notif) notif.style.display = 'none';
        this._hideNotifBackTop();
        var orgView = document.getElementById('orgViewContainer');
        if (orgView) orgView.classList.remove('hidden');

        // 更新企业名称
        var nameEl = document.getElementById('orgViewTenantName');
        if (nameEl && window.tenantManager && tenantManager.activeTenant) {
            nameEl.textContent = tenantManager.activeTenant.short_name || tenantManager.activeTenant.name;
        } else if (nameEl) {
            nameEl.textContent = '';
        }

        // 更新聊天头
        document.getElementById('chatTitle').textContent = '组织架构';
        document.getElementById('chatStatus').textContent = '';
        this.setChatHeaderAvatar('/static/images/org-avatar-0.png');
        // 隐藏聊天输入区和头部通话按钮
        this._setChatControlsVisible(false);

        this._loadOrgTree();
    },

    /** 控制聊天输入区域和头部操作按钮的显隐 */
    _setChatControlsVisible(visible, limit = 3) {
        var inputArea = document.querySelector('.chat-input-area');
        if (inputArea) inputArea.style.display = visible ? '' : 'none';
        // 隐藏/显示通话和更多操作按钮
        var headerRight = document.querySelector('.header-right');
        if (headerRight) {
            var btns = headerRight.querySelectorAll('.btn-icon');
            btns.forEach(function (b, key) {
                if (key < limit) {
                    b.style.display = visible ? '' : 'none';
                }
            });
        }
    },

    /** 加载并渲染完整组织架构树（可折叠，成员内联显示） */
    async _loadOrgTree() {
        var body = document.getElementById('orgViewBody');
        if (!body) return;
        body.innerHTML = '<div class="empty-state" style="padding:40px;"><i class="fas fa-spinner fa-spin"></i><p>加载中...</p></div>';
        try {
            var resp = await fetch('/api/org/org-chart/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                body.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>加载失败</p></div>';
                return;
            }
            var data = await resp.json();
            var chartData = data.org_chart || [];
            if (!chartData.length) {
                body.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>暂无部门</p></div>';
                return;
            }
            this._orgMembersCache = {};
            if (!this._orgViewHandler) {
                this._orgViewHandler = function (e) {
                    var toggle = e.target.closest('.toggle-icon');
                    if (toggle) {
                        e.stopPropagation();
                        var content = toggle.closest('.dept-tree-node-content');
                        if (content) {
                            var node = content.closest('.dept-tree-node');
                            if (node) {
                                var kids = node.children;
                                for (var ki = 0; ki < kids.length; ki++) {
                                    if (kids[ki].classList.contains('dept-tree-children')) {
                                        kids[ki].classList.toggle('collapsed');
                                        var icon = toggle.querySelector('i');
                                        if (icon) icon.className = 'fas fa-chevron-' + (kids[ki].classList.contains('collapsed') ? 'right' : 'down');
                                        break;
                                    }
                                }
                            }
                        }
                        return;
                    }
                    var content = e.target.closest('.dept-tree-node-content');
                    if (content) {
                        var deptId = parseInt(content.getAttribute('data-dept-id'));
                        if (deptId) chatClient._loadDeptMembersInline(deptId, content);
                    }
                };
                body.addEventListener('click', this._orgViewHandler);
            }
            body.innerHTML = '<div style="display:flex;align-items:center;justify-content:flex-end;padding:6px 12px;border-bottom:1px solid var(--border-color,#ebeef5);background:#fff;">'
                + '<button id="orgViewFoldBtn" style="padding:4px 10px;font-size:12px;border:1px solid var(--border-color,#dcdfe6);background:#fff;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:4px;"><i id="orgViewFoldIcon" class="fas fa-compress-alt" style="font-size:11px;"></i> <span id="orgViewFoldText">折叠</span></button>'
                + '</div>'
                + '<div class="dept-tree-children">' + this._buildOrgTreeHTML(chartData, 0) + '</div>';
            // 绑定折叠/展开按钮
            var foldBtn = document.getElementById('orgViewFoldBtn');
            this._orgIsFolded = false;
            if (foldBtn) {
                foldBtn.onclick = function () {
                    chatClient._orgIsFolded = !chatClient._orgIsFolded;
                    var expanded = !chatClient._orgIsFolded;
                    var bodyEl = document.getElementById('orgViewBody');
                    if (bodyEl) {
                        bodyEl.querySelectorAll('.dept-tree-node > .dept-tree-children').forEach(function (el) {
                            el.classList.toggle('collapsed', !expanded);
                        });
                        bodyEl.querySelectorAll('.toggle-icon i').forEach(function (icon) {
                            var node = icon.closest('.dept-tree-node');
                            if (node) {
                                var kids = node.children;
                                for (var ki = 0; ki < kids.length; ki++) {
                                    if (kids[ki].classList.contains('dept-tree-children')) {
                                        icon.className = 'fas fa-chevron-' + (expanded ? 'down' : 'right');
                                        break;
                                    }
                                }
                            }
                        });
                    }
                    var fi = document.getElementById('orgViewFoldIcon');
                    var ft = document.getElementById('orgViewFoldText');
                    if (fi) fi.className = 'fas fa-' + (expanded ? 'compress-alt' : 'expand-alt');
                    if (ft) ft.textContent = expanded ? '折叠' : '展开';
                    foldBtn.title = expanded ? '全部折叠' : '全部展开';
                };
            }
        } catch (e) {
            body.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>加载失败</p></div>';
        }
    },

    /** 递归构建树形 HTML（可折叠） */
    _buildOrgTreeHTML(nodes, depth) {
        if (!nodes || !nodes.length) return '';
        var self = this;
        var html = '';
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var hasChildren = n.children && n.children.length;
            var enterpriseBadge = n.department_type === 'company' ? '<span class="converted-badge" title="企业部门"><i class="fas fa-building"></i></span>' : '';
            html += '<div class="dept-tree-node" data-dept-id="' + n.id + '">'
                + '<div class="dept-tree-node-content" data-dept-id="' + n.id + '">'
                + '<span class="toggle-icon">' + (hasChildren ? '<i class="fas fa-chevron-right"></i>' : '') + '</span>'
                + '<span class="dept-icon"><i class="fas ' + (hasChildren ? 'fa-folder-open' : 'fa-building') + '"></i></span>'
                + '<span class="dept-name">' + self._escape(n.name) + enterpriseBadge + '</span>'
                + '<span class="member-badge">' + (n.member_count || 0) + '</span>'
                + '</div>'
                + (hasChildren ? '<div class="dept-tree-children">' + self._buildOrgTreeHTML(n.children, depth + 1) + '</div>' : '')
                + '<div class="org-dept-members" id="orgDeptMembers_' + n.id + '" style="display:none;"></div>'
                + '</div>';
        }
        return html;
    },

    /** 点击部门节点加载成员列表（内联显示） */
    async _loadDeptMembersInline(deptId, nodeEl) {
        var container = document.getElementById('orgDeptMembers_' + deptId);
        if (!container) return;
        // 高亮当前行
        document.querySelectorAll('#orgViewBody .dept-tree-node').forEach(function (r) {
            r.classList.remove('active');
        });
        var deptNode = nodeEl.closest('.dept-tree-node');
        if (deptNode) deptNode.classList.add('active');

        // 如果已加载，切换显示
        if (container.dataset.loaded === '1') {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
            return;
        }
        container.style.display = 'block';
        container.innerHTML = '<div style="text-align:center;padding:16px;"><i class="fas fa-spinner fa-spin" style="color:var(--primary-color,#409eff);"></i></div>';
        try {
            var resp = await fetch('/api/org/departments/' + deptId + '/members/?page_size=100', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                container.innerHTML = '<div class="empty-state" style="padding:16px;"><p>加载失败</p></div>';
                return;
            }
            var data = await resp.json();
            var members = data.results || [];
            var self = this;
            var currentUserId = this.currentUser.id;
            var currentUserType = this.currentUser.user_type;
            var canChat = currentUserType === 'admin' || currentUserType === 'super_admin';
            var html = '<div style="padding:4px 12px 8px 44px;">';
            members.forEach(function (m) {
                var isOwner = currentUserId === m.id;
                html += '<div class="org-member-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:default;">';
                if (m.avatar) {
                    html += '<img class="member-avatar" src="' + self._escape(m.avatar) + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">';
                } else {
                    var initial = (m.real_name || m.username || '?')[0].toUpperCase();
                    html += '<div class="member-avatar-placeholder" style="width:32px;height:32px;border-radius:50%;background:var(--primary-color,#409eff);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">' + initial + '</div>';
                }
                html += '<div style="flex:1;min-width:0;">'
                    + '<div style="font-size:13px;font-weight:500;">' + (isOwner ? '我' : self._escape(m.real_name || m.username))
                    + (m.is_manager ? ' <span style="font-size:10px;padding:0 5px;border-radius:3px;background:#fff3e0;color:#e6a23c;">负责人</span>' : '')
                    + (m.is_deputy ? ' <span style="font-size:10px;padding:0 5px;border-radius:3px;background:#ecf5ff;color:#409eff;">副负责人</span>' : '')
                    + '</div>'
                    + '<div style="font-size:11px;color:var(--text-light,#909399);">' + self._escape(m.position || m.department_name || '-') + '</div>'
                    + '</div>'
                    + (isOwner || !canChat ? '' : '<button class="chat-btn" style="padding:4px 10px;font-size:12px;border:none;border-radius:6px;background:var(--primary-color,#409eff);color:#fff;cursor:pointer;flex-shrink:0;" onclick="event.stopPropagation();chatClient._startOrgChat(' + m.id + ', \'' + self._escape(m.real_name || m.username) + '\')">发消息</button>');
                html += '</div>';
            });
            if (!members.length) html += '<div style="text-align:center;padding:16px;color:var(--text-light,#909399);font-size:13px;">暂无成员</div>';
            html += '</div>';
            container.innerHTML = html;
            container.dataset.loaded = '1';
        } catch (e) {
            container.innerHTML = '<div class="empty-state" style="padding:16px;"><p>加载失败</p></div>';
        }
    },

    async _startOrgChat(userId, userName) {

        this.selectUserForChat(userId)
        return

        try {
            var resp = await fetch('/api/chat/rooms/?user_id=' + userId, {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                this.showError('启动聊天失败');
                return;
            }
            var data = await resp.json();
            var rooms = data.results || data || [];
            if (rooms.length) {
                this.selectChatRoom(rooms[0].id);
            } else {
                // 创建新私聊
                var createResp = await fetch('/api/chat/rooms/', {
                    method: 'POST',
                    headers: TokenManager.getHeaders(),
                    body: JSON.stringify({room_type: 'private', member_ids: [userId]})
                });
                if (createResp.ok) {
                    var newRoom = await createResp.json();
                    if (newRoom.id) {
                        await this.loadChatRooms();
                        this.selectChatRoom(newRoom.id);
                    } else if (newRoom.room_id) {
                        await this.loadChatRooms();
                        this.selectChatRoom(newRoom.room_id);
                    }
                } else {
                    this.showError('创建聊天失败');
                }
            }
        } catch (e) {
            console.error('启动聊天失败:', e);
            this.showError('启动聊天失败');
        }
    },

    // ────────── 全局企业切换（顶栏） ──────────

    toggleTenantDropdown(event) {
        if (event) event.stopPropagation();
        var dd = document.getElementById('globalTenantDropdown');
        var arrow = document.querySelector('.tenant-switcher-arrow');
        if (!dd) return;
        var isOpen = dd.classList.contains('show');
        // 关闭所有 tenant dropdown
        document.querySelectorAll('.tenant-dropdown').forEach(function (d) {
            d.classList.remove('show');
        });
        document.querySelectorAll('.tenant-switcher-arrow').forEach(function (a) {
            a.classList.remove('open');
        });
        if (!isOpen) {
            this.renderTenantDropdown();
            dd.classList.add('show');
            if (arrow) arrow.classList.add('open');
        }
    },

    renderTenantDropdown() {
        var list = document.getElementById('globalTenantList');
        if (!list) return;
        if (!window.tenantManager || !tenantManager.tenants.length) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-light);font-size:13px;">暂未加入企业</div>';
            return;
        }
        var self = this;
        var roleMap = {'owner': '企业所有者', 'admin': '企业管理员', 'dept_admin': '部门管理员', 'member': '成员'};
        list.innerHTML = tenantManager.tenants.map(function (t) {
            var isActive = tenantManager.activeTenant && t.id === tenantManager.activeTenant.id;
            return '<div class="tenant-dropdown-item' + (isActive ? ' active' : '') + '">'
                + '<div class="td-icon"><i class="fas fa-building"></i></div>'
                + '<div class="td-info">'
                + '<div class="td-name">' + self._escape(t.short_name || t.name) + '</div>'
                + '<div class="td-role">' + self._escape(roleMap[t.role] || t.tenant_type || '') + '</div>'
                + '</div>'
                + (isActive ? '<i class="fas fa-check-circle td-check"></i>'
                    : '<button class="td-switch-btn" onclick="event.stopPropagation();chatClient._switchGlobalTenant(' + t.id + ')">切换</button>')
                + '</div>';
        }).join('');
    },

    async _switchGlobalTenant(tenantId) {
        var dd = document.getElementById('globalTenantDropdown');
        if (dd) dd.classList.remove('show');
        var arrow = document.querySelector('.tenant-switcher-arrow');
        if (arrow) arrow.classList.remove('open');
        // 使用 tenantManager 的 switch 方法
        await tenantManager.switchTenant(tenantId);
    },

    /** 更新全局顶栏的企业名称 */
    updateGlobalTenantUI() {
        var nameEl = document.getElementById('globalTenantName');
        if (!nameEl) return;
        if (window.tenantManager && tenantManager.activeTenant) {
            nameEl.textContent = tenantManager.activeTenant.short_name || tenantManager.activeTenant.name;
            nameEl.title = tenantManager.activeTenant.short_name || tenantManager.activeTenant.name;
        } else {
            nameEl.textContent = '企业聊天室';
            nameEl.title = '企业聊天室';
        }
    },

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
    },

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
    },

    openSidebar() {
        console.log('Open sidebar')
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) {
            overlay.classList.toggle('show');
        }
    },


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
    },

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
    },


    toggleSidebar() {

        this.showSidebar();
        this.openSidebar();

    },


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
    },

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
    },


    // 选择聊天室
    selectChatRoom(roomId) {
        console.log('选择聊天室 roomId:', roomId, ' this.currentRoomId: ', this.currentRoomId);

        // 隐藏通知消息列表（如果打开）
        var notifContainer = document.getElementById('notificationMessages');
        if (notifContainer) {
            notifContainer.style.display = 'none';
        }
        this._hideNotifBackTop();

        // 隐藏组织架构视图（如果打开）
        var orgView = document.getElementById('orgViewContainer');
        if (orgView) {
            orgView.classList.add('hidden');
        }

        // 🔧 新增：进入聊天室时清除未读@提及标记
        const targetRoom = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (targetRoom) {
            targetRoom.has_unread_mention = false;
            targetRoom.has_mention_all = false; // 🔧 同步清除 @所有人 标记
        }
        // 立即同步顶部头像（群聊=九宫格）：不依赖后续逻辑是否全部执行成功
        if (targetRoom && typeof this.syncChatHeaderAvatar === 'function') {
            this.syncChatHeaderAvatar(targetRoom);
        }
        // 群公告未读入口：仅群聊且有未读公告时显示在消息顶部
        this._renderGroupAnnounceBar(targetRoom);
        // 进入群聊时异步校准一次群公告未读状态（列表缓存可能已过期）
        this._refreshGroupAnnouncementFlag(roomId);

        // 🔧 关键修复 1: 保存当前聊天室的草稿
        if (this.currentRoomId) {
            this.saveInputDraft(this.currentRoomId);
            this.renderChatRooms(); // ✅ 立即更新侧边栏状态

        }

        // 恢复聊天输入区和头部按钮
        this._setChatControlsVisible(true)

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
            // loadChatHistory 内部已处理用户可见的错误提示（含重试与内联重试入口），
            // 这里只兜底记录，避免同一错误弹两次提示
            console.error('加载聊天历史异常:', error);
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


        if (room) {
            if (room.room_type === 'group') {
                var headerRight = document.querySelector('.header-right');
                if (headerRight) {
                    var btns = headerRight.querySelectorAll('.btn-icon');
                    btns.forEach(function (b, key) {
                        if (key < 2) {
                            b.style.display = 'none';
                        }
                    });
                }
            }
            // 清除该聊天室的未读数
            room.unread_count = 0;
            // 更新总未读数并设置角标
            const totalUnread = this.chatRooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
            this.updateAppBadge(totalUnread);

            // 更新聊天头部
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
                for (const member of (room.members || [])) {
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
            // 清除点击事件

            if (chatTitle) {
                chatTitle.textContent = roomName;
            }
            if (typeof this.syncChatHeaderAvatar === 'function') {
                this.syncChatHeaderAvatar(room);
            } else if (room.room_type === 'group' && typeof this.renderHeaderGroupAvatar === 'function') {
                this.renderHeaderGroupAvatar(room);
            }
        }


    },

    // 选择用户发起聊天（私聊）
    selectUserForChat(userId) {
        console.log('选择用户发起聊天:', userId);
        if (!userId || parseInt(userId) === parseInt(this.currentUser.id)) {
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
    },

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
    },

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
    },


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
                const chatSubtitle = document.getElementById('chatSubtitle');

                if (chatTitle) {
                    chatTitle.textContent = '选择聊天';
                }
                this.setChatHeaderAvatar('/static/images/default-avatar.png');
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
    },
    });
})();
