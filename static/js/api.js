// static/js/api.js

// API 基础配置
const API_BASE_URL = '/api';
const WS_BASE_URL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

// Token 管理
class TokenManager {
    static getToken() {
        return localStorage.getItem('access_token');
    }

    static setToken(token) {
        localStorage.setItem('access_token', token);
    }

    static removeToken() {
        localStorage.removeItem('access_token');
    }

    static getHeaders() {
        const token = this.getToken();
        if (!token) return {'Content-Type': 'application/json' };
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    static refreshToken() {
        console.log('refresh token')
    }

}

// API 调用封装
class API {
    constructor() {
        this.configs = {};
        this.login_url = '/login/'
    }

    // 用户相关
    static async getCurrentUser() {
        const response = await fetch(`${API_BASE_URL}/auth/me/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            throw new Error('获取用户信息失败');
        }
        return await response.json();
    }

    static async loadConfigs(category = null) {
        try {
            const url = category
                ? `/api/chat/admin/settings/list_configs/?category=${category}`
                : '/api/chat/admin/settings/list_configs/';

            const response = await fetch(url, {headers: TokenManager.getHeaders()});
            if (!response.ok) throw new Error('加载配置失败');
            const data = await response.json();

            // 按分类组织配置
            this.configs = {};
            (data.configs || []).forEach(config => {
                if (!this.configs[config.category]) {
                    this.configs[config.category] = [];
                }
                this.configs[config.category].push(config);
            });

            return data.configs;
        } catch (error) {
            console.error('加载配置失败:', error);
            return [];
        }
    }


    static async login(username, password) {
        const response = await fetch(`${API_BASE_URL}/auth/login/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({username, password})
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.non_field_errors?.[0] || '登录失败');
        }
        return await response.json();
    }

    static async register(userData) {
        const response = await fetch(`${API_BASE_URL}/auth/register/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(JSON.stringify(errorData));
        }
        return await response.json();
    }

    static async logout() {
        const response = await fetch(`${API_BASE_URL}/auth/logout/`, {
            method: 'POST',
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '登出失败');
        }
        TokenManager.removeToken();
    }

    /**
     * 修改密码
     * @param {string} oldPassword
     * @param {string} newPassword
     * @param {string} confirmNewPassword
     */
    static async changePassword(oldPassword, newPassword, confirmNewPassword) {
        return fetch(`${API_BASE_URL}/auth/users/change_password/`, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify({
                old_password: oldPassword,
                new_password: newPassword,
                new_password_confirm: confirmNewPassword
            })
        });
    }

    // 聊天室相关
    static async getChatRooms() {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '获取聊天室失败');
        }
        const data = await response.json();
        return data.results || [];
    }

    static async createChatRoom(data) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/`, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '创建聊天室失败');
        }
        return await response.json();
    }

    static async getChatHistory(roomId, limit = 1000) {
        const response = await fetch(
            `${API_BASE_URL}/chat/messages/?chat_room_id=${roomId}`, {
                method: 'GET',
                headers: TokenManager.getHeaders()
            });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '获取聊天历史失败');
        }
        const data = await response.json();
        return Array.isArray(data) ? data : (data.results || []);
    }

    static async sendMessage(data) {
        const response = await fetch(`${API_BASE_URL}/chat/messages/`, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '发送失败');
        }

        return await response.json();
    }

    static async toggleMarkMessagesAsRead(messageIds, chatRoomId) {
        const response = await fetch(`${API_BASE_URL}/chat/messages/mark_as_read/`, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify({message_ids: messageIds, chat_room_id: chatRoomId})
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '标记消息为已读失败');
        }
        return await response.json();
    }

    static async getUnreadCount(chat_room_id) {
        const response = await fetch(`${API_BASE_URL}/chat/messages/unread_count/?q=${chat_room_id}`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '获取未读消息数失败');
        }
        return await response.json();
    }

    // 用户列表
    static async getUsers() {
        const response = await fetch(`${API_BASE_URL}/auth/list/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '获取用户列表失败');
        }
        const data = await response.json();
        return data.results || [];
    }


    // 好友列表
    static async getFriends() {
        const response = await fetch(`${API_BASE_URL}/auth/friends/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '获取好友列表失败');
        }
        const data = await response.json();
        return data.results || [];
    }


    // 获取部门列表
    static async getDepartments() {
        const response = await fetch(`${API_BASE_URL}/auth/departments/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '获取部门列表失败');
        }
        const data = await response.json();
        return data.results || [];
    }

    // 显示用户详细信息
    static async toggleGetUserProfile(userId) {
        const response = await fetch(`${API_BASE_URL}/auth/${userId}/profile/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '获取用户信息失败');
        }
        return await response.json();
    }


    // 软删除聊天室
    static async toggleDeleteChatRoom(roomId) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/soft_delete/`, {
            method: 'DELETE',
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '操作失败');
        }
        return response
    }

    // 解散群聊
    static async toggleDismissChatRoom(roomId) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/dismiss_chat/`, {
            method: 'DELETE',
            headers: TokenManager.getHeaders()
        })
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '操作失败');
        }
        return response;
    }


    // 置顶聊天
    static async togglePinChat(roomId) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/pin_chat/`, {
            method: 'POST',
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.error || errorData?.message || '操作失败');
        }
        const data = await response.json();
        return data;
    }

    // 消息免打扰
    static async toggleMuteChat(roomId) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/mute_chat/`, {
            method: 'POST',
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            throw new Error('操作失败');
        }
        const data = await response.json();
        return data;
    }

    // 清空聊天记录
    static async toggleClearChatHistory(roomId) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/clear_history/`, {
            method: 'DELETE',
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '操作失败');
        }
        const data = await response.json();
        return data;
    }

    // 搜索聊天
    static async toggleSearchChats(query) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/search_chats/?q=${encodeURIComponent(query)}`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '操作失败');
        }
        console.log("response: ", response);
        const data = await response.json();
        console.log("data: ", data);
        return data || [];
    }

    // 搜索用户
    static async toggleSearchUsers(query) {
        const response = await fetch(`${API_BASE_URL}/auth/search_users/?q=${encodeURIComponent(query)}`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '操作失败');
        }
        const data = await response.json();
        return data.results || [];
    }


    // 文件上传（支持MD5去重）
    static async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE_URL}/chat/upload/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TokenManager.getToken()}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData?.detail || errorData?.error || errorData?.message || '文件上传失败');
        }

        return await response.json();
    }

   async showConfirmDialog(title, message, type = 'confirm') {
    return new Promise(resolve => {
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
            dialog.remove();
            resolve(result);
        };

        dialog.querySelector('.cancel').onclick = () => close(false);
        dialog.querySelector(`.${type}`).onclick = () => close(true);
        dialog.querySelector('.close-btn').onclick = () => close(false);

        setTimeout(() => dialog.classList.add('show'), 10);
    });
}



    handleAuthError(login_url) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = login_url || this.login_url;
    }

    async logoutDialog(login_url) {
        const confirmed = await this.showConfirmDialog('退出登录', '确定要退出登录吗？', 'confirm');
        if (confirmed) {
            try {
                await this.logout();
            } catch (e) {
                console.error('登出失败:', e);
            } finally {
                this.handleAuthError(login_url);
            }
        }
    }

}


// 初始化
let apiConsole = null;
document.addEventListener('DOMContentLoaded', () => {
    apiConsole = new API();
    window.apiConsole = apiConsole;
});
