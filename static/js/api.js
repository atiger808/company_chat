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
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }
}

// API 调用封装
class API {
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

    // 聊天室相关
    static async getChatRooms() {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('获取聊天室失败:', response.status, errorText);
            throw new Error(`获取聊天室列表失败 (${response.status})`);
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
            const errorData = await response.json().catch(() => ({}));
            console.error('创建聊天室失败:', response.status, errorData);
            throw new Error(errorData.error || `创建聊天室失败 (${response.status})`);
        }
        return await response.json();
    }

    static async getChatHistory(roomId, limit = 50) {
        const response = await fetch(
            `${API_BASE_URL}/chat/messages/?chat_room_id=${roomId}&limit=${limit}`, {
                headers: TokenManager.getHeaders()
            });
        if (!response.ok) {
            throw new Error('获取聊天历史失败');
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
            throw new Error(errorData.detail || '发送失败');
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
            throw new Error(errorData.error || '标记消息为已读失败');
        }
        return await response.json();
    }

    static async getUnreadCount(chat_room_id) {
        const response = await fetch(`${API_BASE_URL}/chat/messages/unread_count/?q=${chat_room_id}`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            throw new Error('获取未读消息数失败');
        }
        return await response.json();
    }

    // 用户列表
    static async getUsers() {
        const response = await fetch(`${API_BASE_URL}/auth/users/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            throw new Error('获取用户列表失败');
        }
        const data = await response.json();
        console.log("data: ", data);
        console.log("data type: ", typeof data);
        return data.results || [];
    }

    // 获取部门列表
    static async getDepartments() {
        const response = await fetch(`${API_BASE_URL}/auth/departments/`, {
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            throw new Error('获取部门列表失败');
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
            throw new Error('获取用户信息失败');
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
            throw new Error('操作失败');
        }
        return response
    }


    // 置顶聊天
    static async togglePinChat(roomId) {
        const response = await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/pin_chat/`, {
            method: 'POST',
            headers: TokenManager.getHeaders()
        });
        if (!response.ok) {
            throw new Error('操作失败');
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
            throw new Error('操作失败');
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
            throw new Error('操作失败');
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
            throw new Error('操作失败');
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
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || '文件上传失败');
        }

        return await response.json();
    }
}