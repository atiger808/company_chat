// @File   :token.js
// @Time   :2026/4/22 17:08
// @Author :dayue
// @Email  :ole211@qq.com



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
