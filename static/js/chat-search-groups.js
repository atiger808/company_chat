// static/js/chat-search-groups.js - 提示弹窗、搜索、群管理与群公告、群词云
// 说明：本文件为 ChatClient 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ChatClient.prototype, {

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
    },


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
    },


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
    },

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
    },

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
    },

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
    },

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
    },

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
            let avatarClass = 'search-result-avatar';
            let avatarHtml = `<img src="${avatar}" alt="${name}">`;
            if (item.room_type === 'group') {
                avatarClass += ' group-avatar-grid-wrap';
                avatarHtml = this.buildGroupAvatarHtml(item);
            }

            html += `
        <div class="search-result-item" data-id="${item.id}" data-type="${type}" onclick="chatClient.handleSearchResultClick(${item.id}, '${type}')">
            <div class="${avatarClass}">
                ${avatarHtml}
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
    },

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
    },

// 获取搜索类型标签
    getSearchTypeLabel(type) {
        const labels = {
            'chats': '聊天',
            'contacts': '联系人',
            'groups': '群组'
        };
        return labels[type] || type;
    },

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
    },

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
    },

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
    },

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
    },

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
    },


    // 用户是否命中关键字（姓名/账号/部门/职位）
    _matchesUserKeyword(user, queryLower) {
        if (!user) return false;
        const uname = (user.username || '').toLowerCase();
        const real = (user.real_name || '').toLowerCase();
        const dept = ((user.department_info && user.department_info.name) || user.department || '').toLowerCase();
        const pos = (user.position || '').toLowerCase();
        return uname.includes(queryLower) || real.includes(queryLower)
            || dept.includes(queryLower) || pos.includes(queryLower);
    },

    // 本地已加载用户过滤：用于即时反馈与后端失败回退
    filterLoadedUsersForChat(query) {
        const q = (query || '').toLowerCase();
        return (this.usersForChat || []).filter(user => {
            if (!user || user.id === this.currentUser.id) return false;
            return this._matchesUserKeyword(user, q);
        });
    },

    // 合并后端搜索结果，保证已选成员能正确显示姓名/部门
    mergeUsersForChat(users) {
        if (!Array.isArray(users) || !users.length) return;
        const map = new Map((this.usersForChat || []).map(u => [u.id, u]));
        users.forEach(u => {
            if (u && u.id != null) map.set(u.id, u);
        });
        this.usersForChat = Array.from(map.values());
    },

    // 搜索用户（私聊）：先展示本地结果，再请求后端补齐未加载到本地的用户
    searchUsersForPrivate(query) {
        const q = (query || '').trim();
        if (this._privateUserSearchTimer) clearTimeout(this._privateUserSearchTimer);
        const seq = (this._privateUserSearchSeq = (this._privateUserSearchSeq || 0) + 1);

        if (!q) {
            this.renderUserSearchResults(this.usersForChat, 'userResults');
            return;
        }

        this.renderUserSearchResults(this.filterLoadedUsersForChat(q), 'userResults');
        this._privateUserSearchTimer = setTimeout(() => {
            API.toggleSearchUsers(q).then(users => {
                if (seq !== this._privateUserSearchSeq) return;
                this.mergeUsersForChat(users);
                this.renderUserSearchResults(users, 'userResults');
            }).catch(error => {
                if (seq !== this._privateUserSearchSeq) return;
                console.error('搜索用户失败:', error);
                // 后端失败时保留本地过滤结果，避免列表突然变空
            });
        }, 250);
    },


// 搜索成员（群聊）：后端搜索覆盖未加载到本地的用户
    searchMembersForGroup(query) {
        const q = (query || '').trim();
        if (this._groupMemberSearchTimer) clearTimeout(this._groupMemberSearchTimer);
        const seq = (this._groupMemberSearchSeq = (this._groupMemberSearchSeq || 0) + 1);

        if (!q) {
            this._memberSearchResults = null;
            this.renderMemberSearchResults(this.usersForChat);
            return;
        }

        const local = this.filterLoadedUsersForChat(q);
        this._memberSearchResults = local;
        this.renderMemberSearchResults(local);

        this._groupMemberSearchTimer = setTimeout(() => {
            API.toggleSearchUsers(q).then(users => {
                if (seq !== this._groupMemberSearchSeq) return;
                this.mergeUsersForChat(users);
                this._memberSearchResults = users;
                this.renderMemberSearchResults(users);
            }).catch(error => {
                if (seq !== this._groupMemberSearchSeq) return;
                console.error('搜索成员失败:', error);
                // 后端失败时保留本地过滤结果
            });
        }, 250);
    },

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
    },


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
    },

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

                // 切换标签时按当前输入框内容恢复列表（有搜索词则重新搜索）
                if (target === 'new-group-chat') {
                    const memberKw = (document.getElementById('addGroupMemberInput')?.value || '').trim();
                    if (memberKw) this.searchMembersForGroup(memberKw);
                    else this.renderMemberSearchResults(this.usersForChat);
                } else if (target === 'new-private-chat') {
                    const userKw = (document.getElementById('searchUserInput')?.value || '').trim();
                    if (userKw) this.searchUsersForPrivate(userKw);
                    else this.renderUserSearchResults(this.usersForChat, 'userResults');
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
    },


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
                    const chatStatus = document.getElementById('chatStatus');

                    if (chatTitle) {
                        chatTitle.textContent = '选择聊天';
                    }
                    this.setChatHeaderAvatar('/static/images/default-avatar-offline.png');
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
    },

// 软删除消息
    async softDeleteMessage(messageId) {
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
    },

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
    },

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
    },


    // 修复：显示群聊管理模态框
    showGroupManagementModal(room) {
        let roomId = typeof room === 'object' ? room.id : room;

        if (typeof room === 'object') {
            roomId = room.id;
        } else {
            roomId = room;
            room = this.chatRooms.find(r => r.id === parseInt(roomId));
        }

        // 显示该群聊自身所属企业（历史群聊没有 tenant 时后端会回退）
        var tenantName = '';
        if (room && room.tenant_name) {
            tenantName = room.tenant_name;
        } else if (window.tenantManager && tenantManager.activeTenant) {
            tenantName = tenantManager.activeTenant.short_name || tenantManager.activeTenant.name;
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
                <div style="margin-bottom:16px;padding:12px 16px;background:#f0f9eb;border-radius:8px;font-size:13px;display:flex;align-items:center;gap:8px;color:#67c23a;">
                    <i class="fas fa-building"></i> 所属企业：<strong>${this._escape(tenantName || '-')}</strong>
                </div>

                <div class="form-group">
                    <label>群聊名称</label>
                    <input type="text" id="groupManageName" value="${room.name || room.display_name}" maxlength="50">
                </div>

                <div class="form-group">
                    <label>群公告</label>
                    <div id="groupAnnounceEntryBox" onclick="chatClient.openGroupAnnouncement(${roomId})"
                         style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-color,#ebeef5);border-radius:8px;cursor:pointer;background:#fffdf5;">
                        <i class="fas fa-bullhorn" style="color:#e6a23c;font-size:16px;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary,#303133);">群公告</div>
                            <div id="groupAnnounceEntryTip" style="font-size:12px;color:var(--text-light,#909399);margin-top:2px;">点击发布或修改群公告</div>
                        </div>
                        <span style="font-size:12px;color:#409eff;flex-shrink:0;">管理 <i class="fas fa-chevron-right" style="font-size:9px;"></i></span>
                    </div>
                </div>

                <div class="form-group">
                    <label>群待办 / 工单</label>
                    <div id="groupWorkOrderCreateEntry" onclick="chatClient.closeModal('groupManagementModal');chatClient.openCreateWorkOrderModal()"
                         style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-color,#ebeef5);border-radius:8px;cursor:pointer;background:#f2fbff;">
                        <i class="fas fa-clipboard-list" style="color:#00a1ff;font-size:16px;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary,#303133);">新建群待办</div>
                            <div style="font-size:12px;color:var(--text-light,#909399);margin-top:2px;">多环节执行人、进度评论、核验闭环与归档</div>
                        </div>
                        <span style="font-size:12px;color:#00a1ff;flex-shrink:0;">发起 <i class="fas fa-chevron-right" style="font-size:9px;"></i></span>
                    </div>
                </div>

                <div class="form-group">
                    <label>群聊主题词云</label>
                    <div style="position:relative;border:1px solid var(--border-color,#ebeef5);border-radius:8px;background:#fff;overflow:hidden;">
                        <canvas id="groupWordCloudCanvas" style="display:block;width:100%;height:220px;"></canvas>
                        <div id="groupWordCloudEmpty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#909399;font-size:13px;pointer-events:none;">正在分析群聊内容...</div>
                        <div id="groupWordCloudTip" style="position:absolute;display:none;padding:4px 8px;background:rgba(255,255,255,.96);border:1px solid #e4e7ed;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:12px;color:#303133;pointer-events:none;z-index:5;white-space:nowrap;"></div>
                    </div>
                    <div id="groupWordCloudHint" style="font-size:12px;color:#909399;margin-top:4px;"></div>
                </div>

                <div class="form-group">
                    <label>群成员 (${room.members ? room.members.length : 0})</label>
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索成员..." id="groupManageSearch">
                    </div>
                    <div class="member-list gm-scope" id="groupManageMembers">
                        <!-- 成员列表将动态生成 -->
                        <span>正在加载中...</span>
                    </div>
                </div>

                <div class="form-group">
                    <label>添加成员</label>
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索用户添加到群聊..." id="addMemberSearch">
                    </div>
                    <div class="member-results gm-scope" id="addMemberResults">
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

        // 重置「添加成员」搜索防抖与缓存
        clearTimeout(this._availableMemberSearchTimer);
        this._availableMemberSearchSeq = (this._availableMemberSearchSeq || 0) + 1;
        this._availableMemberSearchResults = null;

        // 显示模态框
        this.openModal('groupManagementModal');

        // 群聊主题词云（按该群最近 30 天文本消息统计）
        var self = this;
        setTimeout(function () { self._loadGroupWordCloud(roomId); }, 30);

        // 加载成员列表
        this.loadGroupMembersForManagement(roomId);

        // 加载可添加的成员列表
        this.loadAvailableMembersForGroup(roomId);

        // 按权限配置隐藏「新建群待办」入口
        if (typeof this._applyWorkOrderEntryPermission === 'function') {
            this._applyWorkOrderEntryPermission(roomId);
        }

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
    },


    // ==================== 群公告 ====================

    // 群聊消息顶部的群公告入口：有未读公告时固定显示，已读后隐藏
    _renderGroupAnnounceBar(room) {
        var bar = document.getElementById('groupAnnounceBar');
        var container = document.getElementById('messagesContainer');
        if (!bar) return;
        var show = !!(room && room.room_type === 'group' && room.has_unread_announcement);
        bar.style.display = show ? 'flex' : 'none';
        if (container) container.classList.toggle('has-announce', show);
        if (show) {
            var txt = document.getElementById('groupAnnounceBarText');
            if (txt) txt.textContent = ((room && room.name) || '群聊') + ' · 有新的群公告';
        }
    },

    // 异步校准群公告未读标记（切换群聊时调用；失败静默，不影响聊天）
    async _refreshGroupAnnouncementFlag(roomId) {
        var room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || room.room_type !== 'group') return;
        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/announcement/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var payload = await resp.json();
            var unread = !!(payload && payload.announcement && !payload.is_read);
            if (!!room.has_unread_announcement !== unread) {
                room.has_unread_announcement = unread;
                if (this.currentRoomId === parseInt(roomId)) this._renderGroupAnnounceBar(room);
            }
        } catch (e) {
            // 静默失败
        }
    },

    async _fetchGroupAnnouncement(roomId) {
        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/announcement/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var err = await resp.json().catch(function () { return {}; });
                throw new Error(err.error || '加载群公告失败');
            }
            return await resp.json();
        } catch (e) {
            console.error('加载群公告失败:', e);
            this.showError('加载群公告失败');
            return null;
        }
    },

    // 打开群公告：查看详情；群主/群管理员可在此发布或修改
    async openGroupAnnouncement(roomId) {
        roomId = parseInt(roomId || this.currentRoomId);
        if (!roomId) return;
        var payload = await this._fetchGroupAnnouncement(roomId);
        if (!payload) return;
        this._gaRoomId = roomId;
        this._gaPayload = payload;
        this._buildGroupAnnouncementModal(roomId, payload);
        // 查看即已读：未读入口随即隐藏
        if (payload.announcement && !payload.is_read) {
            this._markGroupAnnouncementRead(roomId);
        }
    },

    _fmtAnnTime(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            var pad = function (n) { return (n < 10 ? '0' : '') + n; };
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
                + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        } catch (e) {
            return iso;
        }
    },

    _buildGroupAnnouncementModal(roomId, payload) {
        this.clearModal('groupAnnouncementModal');
        var ann = payload.announcement;
        var canManage = !!payload.can_manage;

        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'groupAnnouncementModal';

        var bodyHtml;
        if (ann) {
            bodyHtml = '<div id="gaViewWrap">'
                + '<div class="group-announce-content" id="gaContent">' + this._escape(ann.content) + '</div>'
                + '<div class="group-announce-meta">'
                + '<span><i class="fas fa-user-edit"></i> ' + this._escape(ann.publisher_name || '系统')
                + ' · ' + this._escape(this._fmtAnnTime(ann.updated_at)) + '</span>'
                + '<span><i class="fas fa-eye"></i> 已读 ' + (payload.read_count || 0) + ' / ' + (payload.member_count || 0) + '</span>'
                + '</div>'
                + '</div>';
        } else {
            bodyHtml = '<div id="gaViewWrap"><div class="empty-state" style="padding:26px 0;">'
                + '<i class="fas fa-bullhorn" style="font-size:28px;color:#dcdfe6;"></i>'
                + '<p style="margin-top:8px;color:var(--text-light,#909399);">'
                + (canManage ? '本群还没有群公告，点击下方「发布群公告」开始编辑' : '本群暂无群公告') + '</p>'
                + '</div></div>';
        }

        // 编辑区（默认隐藏）
        var editHtml = '<div id="gaEditWrap" style="display:none;">'
            + '<textarea id="gaInput" class="form-input" rows="8" maxlength="5000" '
            + 'style="width:100%;box-sizing:border-box;resize:vertical;line-height:1.7;" '
            + 'placeholder="请输入群公告内容（最多 5000 字）"></textarea>'
            + '<div style="font-size:12px;color:var(--text-light,#909399);margin-top:6px;">'
            + '<i class="fas fa-info-circle"></i> 发布或修改后，群成员将在群聊顶部重新看到未读公告入口。</div>'
            + '</div>';

        modal.innerHTML = '<div class="modal-content" style="max-width:560px;">'
            + '<div class="modal-header"><h3><i class="fas fa-bullhorn" style="color:#e6a23c;"></i> 群公告</h3>'
            + '<button class="close-btn" onclick="chatClient.closeModal(\'groupAnnouncementModal\')">&times;</button></div>'
            + '<div class="modal-body" style="max-height:66vh;overflow-y:auto;">' + bodyHtml + editHtml + '</div>'
            + '<div class="modal-footer">'
            + (canManage && ann ? '<button class="btn btn-danger" onclick="chatClient.deleteGroupAnnouncement()">删除公告</button>' : '')
            + '<span style="flex:1;"></span>'
            + '<button class="btn btn-secondary" onclick="chatClient.closeModal(\'groupAnnouncementModal\')">关闭</button>'
            + (canManage ? '<button class="btn btn-secondary" id="gaEditBtn" onclick="chatClient._toggleGroupAnnouncementEdit(' + (ann ? 'true' : 'false') + ')">' + (ann ? '编辑公告' : '发布群公告') + '</button>' : '')
            + (canManage ? '<button class="btn btn-primary" id="gaSaveBtn" style="display:none;" onclick="chatClient.saveGroupAnnouncement()">发布</button>' : '')
            + '</div></div>';

        document.body.appendChild(modal);
        this._gaEditing = false;
        this.openModal('groupAnnouncementModal');

        var closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) closeBtn.onclick = () => this.closeModal('groupAnnouncementModal');
        modal.onclick = (e) => {
            if (e.target === modal) this.closeModal('groupAnnouncementModal');
        };
    },

    _toggleGroupAnnouncementEdit(hasAnn) {
        var view = document.getElementById('gaViewWrap');
        var edit = document.getElementById('gaEditWrap');
        var input = document.getElementById('gaInput');
        var editBtn = document.getElementById('gaEditBtn');
        var saveBtn = document.getElementById('gaSaveBtn');
        var opening = edit && edit.style.display === 'none';
        if (edit) edit.style.display = opening ? 'block' : 'none';
        if (view) view.style.display = opening ? 'none' : 'block';
        if (saveBtn) saveBtn.style.display = opening ? 'inline-flex' : 'none';
        if (editBtn) editBtn.textContent = opening ? '取消编辑' : (hasAnn ? '编辑公告' : '发布群公告');
        if (opening && input) {
            var cur = this._gaPayload && this._gaPayload.announcement;
            input.value = cur ? cur.content : '';
            input.focus();
        }
    },

    async saveGroupAnnouncement() {
        var roomId = this._gaRoomId;
        var input = document.getElementById('gaInput');
        if (!roomId || !input) return;
        var content = (input.value || '').trim();
        if (!content) {
            this.showError('公告内容不能为空');
            return;
        }
        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/announcement/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({ content: content })
            });
            var data = await resp.json().catch(function () { return {}; });
            if (!resp.ok) throw new Error(data.error || '发布失败');
            this.showSuccess('群公告已发布');
            this._gaPayload = data;
            this._buildGroupAnnouncementModal(roomId, data);
            // 发布后把自己视为已读，本地同步群列表标记
            var room = this.chatRooms.find(function (r) { return r.id === roomId; });
            if (room) {
                room.has_unread_announcement = false;
                this._renderGroupAnnounceBar(room);
            }
        } catch (e) {
            console.error('发布群公告失败:', e);
            this.showError('发布失败: ' + e.message);
        }
    },

    async deleteGroupAnnouncement() {
        var roomId = this._gaRoomId;
        if (!roomId) return;
        var ok = await this.showConfirmDialog('删除群公告', '确定要删除该群的群公告吗？', 'danger');
        if (!ok) return;
        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/announcement/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            var data = await resp.json().catch(function () { return {}; });
            if (!resp.ok) throw new Error(data.error || '删除失败');
            this.showSuccess('群公告已删除');
            this._gaPayload = data;
            this._buildGroupAnnouncementModal(roomId, data);
            var room = this.chatRooms.find(function (r) { return r.id === roomId; });
            if (room) {
                room.has_unread_announcement = false;
                this._renderGroupAnnounceBar(room);
            }
        } catch (e) {
            console.error('删除群公告失败:', e);
            this.showError('删除失败: ' + e.message);
        }
    },

    async _markGroupAnnouncementRead(roomId) {
        try {
            await fetch('/api/chat/rooms/' + roomId + '/announcement_read/', {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
        } catch (e) {
            console.warn('群公告已读上报失败:', e);
        }
        var room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (room) {
            room.has_unread_announcement = false;
            this._renderGroupAnnounceBar(room);
        }
    },

    // 群主设置/取消群管理员
    async setGroupAdmin(roomId, userId, isAdmin) {
        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/set_group_admin/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({ user_id: userId, is_admin: !!isAdmin })
            });
            var data = await resp.json().catch(function () { return {}; });
            if (!resp.ok) throw new Error(data.error || '操作失败');
            var room = this.chatRooms.find(r => r.id === parseInt(roomId));
            if (room && room.members) {
                var m = room.members.find(function (x) { return x.id === parseInt(userId); });
                if (m) m.is_group_admin = !!isAdmin;
            }
            this.showSuccess(isAdmin ? '已设为群管理员' : '已取消群管理员');
            this.loadGroupMembersForManagement(roomId);
        } catch (e) {
            console.error('设置群管理员失败:', e);
            this.showError('操作失败: ' + e.message);
        }
    },


    // 非群主查看群成员列表模态框
    showGroupMemberListModal(room) {
        let roomId = room.id;

        // 显示该群聊自身所属企业（历史群聊没有 tenant 时后端会回退）
        var tenantName = '';
        if (room && room.tenant_name) {
            tenantName = room.tenant_name;
        } else if (window.tenantManager && tenantManager.activeTenant) {
            tenantName = tenantManager.activeTenant.short_name || tenantManager.activeTenant.name;
        }

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
                <div style="margin-bottom:16px;padding:12px 16px;background:#f0f9eb;border-radius:8px;font-size:13px;display:flex;align-items:center;gap:8px;color:#67c23a;">
                    <i class="fas fa-building"></i> 所属企业：<strong>${this._escape(tenantName || '-')}</strong>
                </div>

                <div class="form-group">
                    <label>群聊名称</label>
                    <input type="text" id="groupManageName" value="${room.name || room.display_name}" maxlength="50" readonly style="background:var(--bg-secondary,#f5f7fa);">
                </div>

                <div class="form-group">
                    <label>群公告</label>
                    <div id="groupAnnounceEntryBox" onclick="chatClient.openGroupAnnouncement(${roomId})"
                         style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-color,#ebeef5);border-radius:8px;cursor:pointer;background:#fffdf5;">
                        <i class="fas fa-bullhorn" style="color:#e6a23c;font-size:16px;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary,#303133);">群公告</div>
                            <div id="groupAnnounceEntryTip" style="font-size:12px;color:var(--text-light,#909399);margin-top:2px;">点击查看群公告</div>
                        </div>
                        <span style="font-size:12px;color:#409eff;flex-shrink:0;">查看 <i class="fas fa-chevron-right" style="font-size:9px;"></i></span>
                    </div>
                </div>

                <div class="form-group">
                    <label>群待办 / 工单</label>
                    <div id="groupWorkOrderCreateEntry" onclick="chatClient.closeModal('groupManagementModal');chatClient.openCreateWorkOrderModal()"
                         style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-color,#ebeef5);border-radius:8px;cursor:pointer;background:#f2fbff;">
                        <i class="fas fa-clipboard-list" style="color:#00a1ff;font-size:16px;"></i>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:600;color:var(--text-primary,#303133);">新建群待办</div>
                            <div style="font-size:12px;color:var(--text-light,#909399);margin-top:2px;">多环节执行人、进度评论、核验闭环与归档</div>
                        </div>
                        <span style="font-size:12px;color:#00a1ff;flex-shrink:0;">发起 <i class="fas fa-chevron-right" style="font-size:9px;"></i></span>
                    </div>
                </div>

                <div class="form-group">
                    <label>群聊主题词云</label>
                    <div style="position:relative;border:1px solid var(--border-color,#ebeef5);border-radius:8px;background:#fff;overflow:hidden;">
                        <canvas id="groupWordCloudCanvas" style="display:block;width:100%;height:220px;"></canvas>
                        <div id="groupWordCloudEmpty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#909399;font-size:13px;pointer-events:none;">正在分析群聊内容...</div>
                        <div id="groupWordCloudTip" style="position:absolute;display:none;padding:4px 8px;background:rgba(255,255,255,.96);border:1px solid #e4e7ed;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.12);font-size:12px;color:#303133;pointer-events:none;z-index:5;white-space:nowrap;"></div>
                    </div>
                    <div id="groupWordCloudHint" style="font-size:12px;color:#909399;margin-top:4px;"></div>
                </div>

                <div class="form-group">
                    <label>群成员 (${room.members ? room.members.length : 0})</label>
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索成员..." id="groupManageSearch">
                    </div>
                    <div class="member-list gm-scope" id="groupManageMembers">
                        <!-- 成员列表将动态生成 -->
                        <span>正在加载中...</span>
                    </div>
                </div>

                <!-- 群管理员可见：添加群成员 -->
                <div class="form-group" id="groupAdminAddMemberGroup" style="display:none;">
                    <label>添加成员</label>
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" placeholder="搜索用户添加到群聊..." id="addMemberSearch">
                    </div>
                    <div class="member-results gm-scope" id="addMemberResults">
                        <!-- 可添加的成员列表 -->
                    </div>
                </div>

            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="chatClient.closeModal('groupManagementModal')">确定</button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // 重置「添加成员」搜索防抖与缓存
        clearTimeout(this._availableMemberSearchTimer);
        this._availableMemberSearchSeq = (this._availableMemberSearchSeq || 0) + 1;
        this._availableMemberSearchResults = null;

        // 显示模态框
        this.openModal('groupManagementModal');

        // 群聊主题词云（按该群最近 30 天文本消息统计）
        var self = this;
        setTimeout(function () { self._loadGroupWordCloud(roomId); }, 30);

        // 加载成员列表
        this.loadGroupMembersForManagement(roomId);

        // 按权限配置隐藏「新建群待办」入口
        if (typeof this._applyWorkOrderEntryPermission === 'function') {
            this._applyWorkOrderEntryPermission(roomId);
        }

        // 绑定搜索事件
        document.getElementById('groupManageSearch').addEventListener('input', (e) => {
            this.searchGroupMembers(e.target.value, roomId);
        });
        var addMemberSearch = document.getElementById('addMemberSearch');
        if (addMemberSearch) {
            addMemberSearch.addEventListener('input', (e) => {
                this.searchAvailableMembers(e.target.value, roomId);
            });
        }

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
    },


    // ==================== 群聊主题词云 ====================

    async _loadGroupWordCloud(roomId) {
        var canvas = document.getElementById('groupWordCloudCanvas');
        if (!canvas) return;
        var empty = document.getElementById('groupWordCloudEmpty');
        var hint = document.getElementById('groupWordCloudHint');
        if (empty) { empty.style.display = 'flex'; empty.textContent = '正在分析群聊内容...'; }
        if (hint) hint.textContent = '';

        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/word_cloud/?days=30', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) throw new Error('加载失败');
            var raw = await resp.json();
            var data = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            this._renderGroupWordCloud(data);
        } catch (e) {
            if (empty) empty.textContent = '词云加载失败，请稍后重试';
            console.warn('加载群聊词云失败:', e);
        }
    },

    _renderGroupWordCloud(data) {
        var canvas = document.getElementById('groupWordCloudCanvas');
        if (!canvas) return;
        var empty = document.getElementById('groupWordCloudEmpty');
        var hint = document.getElementById('groupWordCloudHint');
        var tip = document.getElementById('groupWordCloudTip');
        var words = (data && data.words) || [];
        var days = (data && data.days) || 30;

        if (hint) {
            hint.textContent = words.length
                ? '统计近 ' + days + ' 天 ' + (data.total_messages || 0) + ' 条文本消息，悬停查看词频'
                : '';
        }
        if (!words.length) {
            if (empty) { empty.style.display = 'flex'; empty.textContent = '暂无足够的聊天文本生成词云'; }
            return;
        }
        if (empty) empty.style.display = 'none';

        var wrap = canvas.parentElement;
        var isMobile = window.innerWidth < 768;
        var cssW = Math.max(220, (wrap ? wrap.clientWidth : 600) - 2);
        var cssH = isMobile ? 180 : 220;
        var dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.height = cssH + 'px';
        var ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        var palette = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#7C4DFF', '#16A085',
            '#D81B60', '#00ACC1', '#8E44AD', '#2E86DE'];
        var items = words.slice(0, 60);
        var values = items.map(function (w) { return w.value || 0; });
        var maxV = Math.max.apply(null, [1].concat(values));
        var minV = Math.min.apply(null, values);
        var fontMin = isMobile ? 11 : 12;
        var fontMax = isMobile ? 26 : 32;
        var placed = [];
        var hits = [];
        var fits = function (x, y, w, h) {
            if (x < 2 || y < 2 || x + w > cssW - 2 || y + h > cssH - 2) return false;
            for (var i = 0; i < placed.length; i++) {
                var r = placed[i];
                if (!(x + w <= r.x || x >= r.x + r.w || y + h <= r.y || y >= r.y + r.h)) return false;
            }
            return true;
        };

        items.forEach(function (item, idx) {
            var value = item.value || 0;
            var ratio = maxV === minV ? 1 : (value - minV) / (maxV - minV);
            var fontSize = Math.round(fontMin + Math.sqrt(Math.max(ratio, 0)) * (fontMax - fontMin));
            ctx.font = (idx < 5 ? '700 ' : '500 ') + fontSize + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
            var text = String(item.name || '');
            var tw = Math.ceil(ctx.measureText(text).width) + 4;
            var th = Math.ceil(fontSize * 1.25);
            var baseX = cssW / 2 - tw / 2 + (Math.random() - 0.5) * 40;
            var baseY = cssH / 2 - th / 2 + (Math.random() - 0.5) * 30;
            var x = 0, y = 0, ok = false;
            for (var i = 0; i < 1200; i++) {
                var t = i * 0.25;
                x = baseX + t * Math.cos(t) * 2.0;
                y = baseY + t * Math.sin(t) * 1.25;
                if (fits(x, y, tw, th)) { ok = true; break; }
            }
            if (!ok) return;
            placed.push({x: x, y: y, w: tw, h: th});
            hits.push({x: x, y: y, w: tw, h: th, name: text, value: value});
            ctx.fillStyle = palette[idx % palette.length];
            ctx.textBaseline = 'top';
            ctx.fillText(text, x + 2, y + 1);
        });

        canvas._wordCloudHits = hits;
        canvas.onmousemove = function (e) {
            if (!tip) return;
            var rect = canvas.getBoundingClientRect();
            var px = (e.clientX - rect.left) * (cssW / Math.max(rect.width, 1));
            var py = (e.clientY - rect.top) * (cssH / Math.max(rect.height, 1));
            var hit = (canvas._wordCloudHits || []).find(function (h) {
                return px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h;
            });
            if (!hit) { tip.style.display = 'none'; return; }
            tip.textContent = hit.name + '：' + hit.value + ' 次';
            tip.style.display = 'block';
            var wrapRect = wrap.getBoundingClientRect();
            var left = Math.min(e.clientX - wrapRect.left + 12, Math.max(2, wrapRect.width - tip.offsetWidth - 4));
            tip.style.left = Math.max(2, left) + 'px';
            tip.style.top = Math.max(2, Math.min(e.clientY - wrapRect.top + 12, wrapRect.height - tip.offsetHeight - 4)) + 'px';
        };
        canvas.onmouseleave = function () { if (tip) tip.style.display = 'none'; };
    },

    // 优化：加载群聊成员用于管理（群主在第一位，显示部门职位）
    async loadGroupMembersForManagement(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || !room.members) {
            console.error('未找到群聊或成员列表');
            return;
        }

        const membersContainer = document.getElementById('groupManageMembers');
        if (!membersContainer) return;

        // 一次性批量获取成员详情（职位 / 群管理员标记），
        // 替代原先对每个成员并发请求 /api/auth/<id>/profile/（80 人 = 80 次请求，>5 秒）
        try {
            var resp = await fetch('/api/chat/rooms/' + roomId + '/members_detail/', {
                headers: TokenManager.getHeaders()
            });
            if (resp.ok) {
                var payload = await resp.json();
                var list = (payload && payload.members) ? payload.members : [];
                // 同步最新的职位 / 群管理员标记到本地成员列表，保证后续渲染（含搜索）一致
                if (list.length) {
                    var byId = {};
                    list.forEach(function (m) { byId[m.id] = m; });
                    room.members.forEach(function (m) {
                        var d = byId[m.id];
                        if (d) {
                            m.org_departments = d.org_departments;
                            m.department_info = d.department_info;
                            m.position = d.position;
                            m.is_group_admin = d.is_group_admin;
                        }
                    });
                }
            }
        } catch (e) {
            console.error('加载成员详细信息失败:', e);
        }

        // 将群主排在第一位
        const sortedMembers = [...room.members].sort((a, b) => {
            if (a.id === room.creator) return -1;
            if (b.id === room.creator) return 1;
            return 0;
        });

        membersContainer.innerHTML = this._buildGroupMemberGridHtml(roomId, sortedMembers)
            || '<div class="empty-state"><p>暂无成员</p></div>';

        // 非群主的管理员：成员详情同步后按群管理员身份显示「添加成员」
        this._applyGroupAdminTools(roomId);
    },

    // 当前用户是否为该群的群管理员（群主不算）
    _isCurrentGroupAdmin(room) {
        if (!room || !this.currentUser) return false;
        if (this.currentUser.id === room.creator) return false;
        var me = (room.members || []).find(function (m) { return m.id === chatClient.currentUser.id; });
        return !!(me && me.is_group_admin);
    },

    // 群管理员在成员列表弹窗中的「添加成员」入口
    _applyGroupAdminTools(roomId) {
        var group = document.getElementById('groupAdminAddMemberGroup');
        if (!group) return;  // 群主管理弹窗没有该隐藏区
        var room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (this._isCurrentGroupAdmin(room)) {
            group.style.display = '';
            this.loadAvailableMembersForGroup(roomId);
        } else {
            group.style.display = 'none';
        }
    },

    // 统一的群成员宫格渲染（加载与搜索共用，保证两处展示一致）
    // 参考微信：每行 5 个，只展示昵称与职位；点击头像查看用户信息；
    // 群主可设置群管理员 / 移除成员，群管理员可移除普通成员（不能移除群主和其他管理员）
    _buildGroupMemberGridHtml(roomId, members) {
        var room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || !members || !members.length) return '';
        var myId = this.currentUser ? this.currentUser.id : null;
        var iAmCreator = myId !== null && myId === room.creator;
        var me = (room.members || []).find(function (m) { return m.id === myId; });
        var iAmAdmin = !iAmCreator && !!(me && me.is_group_admin);

        var html = '<div class="member-grid">';
        members.forEach(function (member) {
            var isCreator = member.id === room.creator;
            var posName = member.position || '';
            if (!posName && member.org_departments && member.org_departments.length) {
                posName = member.org_departments[0].position || '';
            }
            var isAdmin = !isCreator && !!member.is_group_admin;
            var showSetAdmin = iAmCreator && !isCreator;  // 仅群主可设置/取消管理员
            // 群主可移除普通成员和管理员；群管理员只能移除普通成员，且不能移除自己
            var canRemove = !isCreator && member.id !== myId
                && (iAmCreator || (iAmAdmin && !isAdmin));
            html += '<div class="member-grid-item ' + (isCreator ? 'creator' : '') + '" data-member-id="' + member.id + '">'
                + '<div class="member-grid-avatar" title="查看用户信息" '
                + 'onclick="event.stopPropagation();chatClient.showUserProfile(' + member.id + ');">'
                + '<img src="' + chatClient._escape(member.avatar_url || '/static/images/default-avatar.png') + '" alt="' + chatClient._escape(member.username) + '">'
                + '</div>'
                + '<div class="member-grid-name" title="' + chatClient._escape(member.real_name || member.username) + '">' + chatClient._escape(member.real_name || member.username) + '</div>'
                + (posName ? '<div class="member-grid-position" title="' + chatClient._escape(posName) + '">' + chatClient._escape(posName) + '</div>' : '')
                + (isCreator ? '<div class="member-grid-tag">群主</div>' : (isAdmin ? '<div class="member-grid-tag admin">管理员</div>' : ''))
                + (showSetAdmin || canRemove
                    ? '<div class="gm-actions" onclick="event.stopPropagation();">'
                        + (showSetAdmin
                            ? '<button type="button" class="gm-btn' + (isAdmin ? ' is-admin' : '') + '" '
                                + 'title="' + (isAdmin ? '取消群管理员' : '设为群管理员') + '" '
                                + 'onclick="chatClient.setGroupAdmin(' + roomId + ', ' + member.id + ', ' + (isAdmin ? 'false' : 'true') + ')">'
                                + '<i class="fas fa-star"></i><span class="gm-btn-text">' + (isAdmin ? '取消管理员' : '设管理员') + '</span></button>'
                            : '')
                        + (canRemove
                            ? '<button type="button" class="gm-btn danger" title="移除成员" '
                                + 'onclick="chatClient.removeGroupMember(' + roomId + ', ' + member.id + ')">'
                                + '<i class="fas fa-user-minus"></i><span class="gm-btn-text">移除</span></button>'
                            : '')
                      + '</div>'
                    : '')
                + '</div>';
        });
        html += '</div>';
        return html;
    },


    // 修复：加载可添加的成员
    loadAvailableMembersForGroup(roomId) {
        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room) return;

        // 获取当前群成员的ID
        const currentMemberIds = room.members ? room.members.map(m => m.id) : [];

        // 根据用户类型过滤可添加的成员；群管理员视同管理角色，可添加企业内用户
        let availableMembers;
        if (this.currentUser.user_type === 'normal' && !this._isCurrentGroupAdmin(room)) {
            // 普通用户只能添加好友
            availableMembers = this.users.filter(user =>
                user.id !== this.currentUser.id &&
                !currentMemberIds.includes(user.id) &&
                this.currentUser.friends?.some(f => f.id === user.id)
            );
        } else {
            // 管理员 / 群管理员可以添加所有用户
            availableMembers = this.users.filter(user =>
                user.id !== this.currentUser.id &&
                !currentMemberIds.includes(user.id)
            );
        }

        this.renderAvailableMembers(availableMembers);
    },


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
            <div class="member-grid-avatar" title="查看用户信息"
                 onclick="event.stopPropagation();chatClient.showUserProfile(${user.id});">
                <img src="${user.avatar_url || '/static/images/default-avatar.png'}" alt="${user.real_name || user.username}">
            </div>
            <div class="member-grid-name" title="${user.real_name || user.username}">${user.real_name || user.username}</div>
            ${user.position ? '<div class="member-grid-position" title="' + user.position + '">' + user.position + '</div>' : ''}
            <div class="gm-actions">
                <button type="button" class="gm-btn primary" title="添加到群聊">
                    <i class="fas fa-plus"></i><span class="gm-btn-text">添加</span>
                </button>
            </div>
        </div>
        `;
        });
        html += '</div>';

        container.innerHTML = html || '<div class="empty-state"><p>暂无可添加的成员</p></div>';
    },

    // 可添加成员候选过滤：排除自己与已在群内成员；普通用户（非群管理）仍只允许好友
    _filterAvailableCandidates(users, room, currentMemberIds) {
        const friendOnly = this.currentUser.user_type === 'normal' && !this._isCurrentGroupAdmin(room);
        const friendIds = friendOnly
            ? new Set((this.currentUser.friends || []).map(f => f.id))
            : null;
        return (users || []).filter(user => {
            if (!user || user.id === this.currentUser.id) return false;
            if (currentMemberIds.includes(user.id)) return false;
            if (friendIds && !friendIds.has(user.id)) return false;
            return true;
        });
    },

    // 搜索可添加的成员：请求后端补齐未加载到本地的用户
    searchAvailableMembers(query, roomId) {
        const q = (query || '').trim();
        if (this._availableMemberSearchTimer) clearTimeout(this._availableMemberSearchTimer);
        const seq = (this._availableMemberSearchSeq = (this._availableMemberSearchSeq || 0) + 1);

        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room) return;

        if (!q) {
            this._availableMemberSearchResults = null;
            this.loadAvailableMembersForGroup(roomId);
            return;
        }

        const currentMemberIds = room.members ? room.members.map(m => m.id) : [];
        const qLower = q.toLowerCase();

        // 先展示本地已加载用户的匹配结果
        const localMatches = this._filterAvailableCandidates(
            (this.users || []).filter(user => this._matchesUserKeyword(user, qLower)),
            room,
            currentMemberIds
        );
        this._availableMemberSearchResults = localMatches;
        this.renderAvailableMembers(localMatches);

        // 再请求后端，覆盖分页未加载到的用户
        this._availableMemberSearchTimer = setTimeout(() => {
            API.toggleSearchUsers(q).then(users => {
                if (seq !== this._availableMemberSearchSeq) return;
                const filtered = this._filterAvailableCandidates(users, room, currentMemberIds);
                this._availableMemberSearchResults = filtered;
                this.renderAvailableMembers(filtered);
            }).catch(error => {
                if (seq !== this._availableMemberSearchSeq) return;
                console.error('搜索可添加成员失败:', error);
                // 失败时保留本地匹配结果
            });
        }, 250);
    },

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
    },


    // 修复：搜索群聊成员
    searchGroupMembers(query, roomId) {
        if (!query.trim()) {
            this.loadGroupMembersForManagement(roomId);
            return;
        }

        const room = this.chatRooms.find(r => r.id === parseInt(roomId));
        if (!room || !room.members) return;

        const q = query.toLowerCase();
        const filteredMembers = room.members.filter(member =>
            (member.username && member.username.toLowerCase().includes(q)) ||
            (member.real_name && member.real_name.toLowerCase().includes(q))
        );

        const membersContainer = document.getElementById('groupManageMembers');
        if (!membersContainer) return;

        // 与默认加载共用同一套宫格渲染，避免搜索结果样式不一致
        membersContainer.innerHTML = this._buildGroupMemberGridHtml(roomId, filteredMembers)
            || '<div class="empty-state"><p>未找到成员</p></div>';
    },


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
                    const chatStatus = document.getElementById('chatStatus');

                    if (chatTitle) {
                        chatTitle.textContent = '选择聊天';
                    }
                    this.setChatHeaderAvatar('/static/images/default-avatar-offline.png');
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
    },

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
    },

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
    },
    });
})();
