// static/js/auth.js
// 企业聊天室 - 认证模块逻辑 (重构版)
// 依赖: /static/css/auth.css

// ==================== 工具函数 ====================

/**
 * 解析后端返回的验证错误
 * @param {Object} errorData - 后端返回的错误对象，如 {"email":["该邮箱未注册"]}
 * @param {Number} statusCode - HTTP 状态码
 * @returns {String} 用户友好的错误消息
 */
function parseApiError(errorData, statusCode) {

    // 1. Django REST Framework 字段验证错误格式: { "field": ["错误消息"] }
    if (typeof errorData === 'object' && errorData !== null) {
        // 提取第一个字段的第一个错误消息
        for (const [field, messages] of Object.entries(errorData)) {
            if (Array.isArray(messages) && messages.length > 0) {
                return messages[0]; // 返回第一条错误消息
            }
        }

        // 2. 通用错误格式: { "error": "消息" } 或 { "message": "消息" }
        if (errorData.error) return errorData.error;
        if (errorData.message) return errorData.message;
        if (errorData.detail) return errorData.detail;
        if (errorData.non_field_errors?.[0]) return errorData.non_field_errors[0];
    }

    // 3. 状态码映射
    const statusMap = {
        400: '请求参数错误',
        401: '未授权，请重新登录',
        403: '权限不足',
        404: '资源不存在',
        429: '请求过于频繁，请稍后重试',
        500: '服务器内部错误',
        502: '网关错误',
        503: '服务暂时不可用'
    };

    return statusMap[statusCode] || `请求失败 (${statusCode})`;
}


/**
 * 显示/隐藏元素
 */
const UI = {
    show: (el) => {
        if (el) el.style.display = '';
        el?.classList?.add('show');
    },
    hide: (el) => {
        if (el) el.style.display = 'none';
        el?.classList?.remove('show');
    },
    toggle: (el) => {
        if (!el) return;
        el.classList.toggle('show');
        el.style.display = el.classList.contains('show') ? '' : 'none';
    },
    addClass: (el, cls) => el?.classList?.add(cls),
    removeClass: (el, cls) => el?.classList?.remove(cls),
    setText: (el, text) => {
        if (el) el.textContent = text;
    },
    setHTML: (el, html) => {
        if (el) el.innerHTML = html;
    }
};

/**
 * 显示错误/成功信息
 */
function showMessage(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = message;
    el.className = `alert alert-${type} show`;

    // 高亮关联输入框
    const fieldId = elementId.replace(/(Error|Message)$/, '');
    const field = document.getElementById(fieldId);
    if (field && type === 'error') {
        field.classList.add('error');
    }
}

function clearMessage(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = '';
        el.className = 'alert';
    }
}

function clearAllMessages() {
    document.querySelectorAll('.error-message, .success-message, .alert').forEach(el => {
        el.textContent = '';
        el.className = el.classList.contains('alert') ? 'alert' : 'error-message success-message';
    });
    document.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));
}

/**
 * 按钮加载状态管理
 */
function setLoading(btn, loading = true) {
    if (!btn) return;
    const text = btn.querySelector('.text');
    const loader = btn.querySelector('.loading');

    if (loading) {
        btn.classList.add('loading');
        btn.disabled = true;
        text?.style.setProperty('display', 'none', 'important');
        loader?.style.setProperty('display', 'inline-block', 'important');
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
        text?.style.removeProperty('display');
        loader?.style.removeProperty('display');
    }
}

/**
 * Toast 提示
 */
function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==================== 滑块验证码类 ====================

class SliderCaptcha {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`SliderCaptcha: Container "${containerId}" not found`);
            return null;
        }

        this.options = {
            width: 400,
            height: 160,
            sliderWidth: 44,
            sliderHeight: 44,
            onSuccess: () => {
            },
            onFail: () => {
            },
            onRefresh: () => {
            },
            ...options
        };

        this.isDragging = false;
        this.offsetX = 0;
        this.correctPosition = 0;
        this.sliderPosition = 0;
        this.verified = false;

        this.init();
        return this;
    }

    init() {
        this.createHTML();
        this.bindEvents();
        this.reset();
    }

    createHTML() {
        this.container.innerHTML = `
      <div class="slider-captcha-container">
        <div class="slider-captcha-bg">
          <canvas id="captchaCanvas" width="${this.options.width}" height="${this.options.height}"></canvas>
          <div class="slider-track-box" id="trackBox"></div>
        </div>
        <div class="slider-captcha-track">
          <div class="slider-captcha-thumb" id="captchaThumb">
            <i class="fas fa-arrow-right"></i>
          </div>
          <span class="slider-captcha-text" id="captchaText">向右滑动完成验证</span>
        </div>
      </div>
    `;
    }

    bindEvents() {
        const thumb = document.getElementById('captchaThumb');
        if (!thumb) return;

        // 鼠标事件
        thumb.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('mouseup', () => this.endDrag());

        // 触摸事件
        thumb.addEventListener('touchstart', (e) => this.startDrag(e), {passive: false});
        document.addEventListener('touchmove', (e) => this.drag(e), {passive: false});
        document.addEventListener('touchend', () => this.endDrag());
    }

    startDrag(e) {
        e.preventDefault();
        this.isDragging = true;
        this.offsetX = this.getMouseX(e);

        UI.setText(document.getElementById('captchaText'), '拖动中...');
        UI.addClass(document.getElementById('captchaThumb'), 'dragging');
        UI.addClass(document.getElementById('trackBox'), 'show');
    }

    drag(e) {
        if (!this.isDragging) return;

        const currentX = this.getMouseX(e);
        const deltaX = currentX - this.offsetX;
        const maxX = this.options.width - this.options.sliderWidth;

        this.sliderPosition = Math.max(0, Math.min(deltaX, maxX));
        this.updateSliderPosition();
        this.updateTrackBoxPosition();
    }

    endDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        UI.removeClass(document.getElementById('captchaThumb'), 'dragging');
        UI.removeClass(document.getElementById('trackBox'), 'show');

        // 验证（±10像素容差）
        if (Math.abs(this.sliderPosition - this.correctPosition) <= 10) {
            this.success();
        } else {
            this.fail();
            setTimeout(() => this.reset(), 1500);
        }
    }

    getMouseX(e) {
        return e.clientX || (e.touches?.[0]?.clientX) || 0;
    }

    updateSliderPosition() {
        const thumb = document.getElementById('captchaThumb');
        if (thumb) thumb.style.transform = `translateX(${this.sliderPosition}px)`;
    }

    updateTrackBoxPosition() {
        const trackBox = document.getElementById('trackBox');
        if (trackBox) {
            const boxPosition = this.sliderPosition + (this.options.sliderWidth / 2) - 20;
            trackBox.style.left = `${boxPosition}px`;
        }
    }

    generateCaptcha() {
        const canvas = document.getElementById('captchaCanvas');
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 背景渐变
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#f0f0f0');
        gradient.addColorStop(1, '#e0e0e0');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 随机正确位置
        this.correctPosition = Math.floor(Math.random() * (canvas.width - 140)) + 70;

        // 绘制拼图缺口
        ctx.strokeStyle = 'rgba(64, 158, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(this.correctPosition, 50);
        ctx.lineTo(this.correctPosition + 40, 50);
        ctx.lineTo(this.correctPosition + 40, 100);
        ctx.lineTo(this.correctPosition, 100);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // 装饰图案
        this.drawDecorations(ctx, canvas.width, canvas.height);

        // 提示文字
        ctx.fillStyle = '#999';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('拖动滑块完成验证', canvas.width / 2, canvas.height - 20);
    }

    drawDecorations(ctx, width, height) {
        // 随机圆点
        ctx.fillStyle = 'rgba(64, 158, 255, 0.1)';
        for (let i = 0; i < 25; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            const r = Math.random() * 12 + 6;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 随机线条
        ctx.strokeStyle = 'rgba(64, 158, 255, 0.2)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 15; i++) {
            ctx.beginPath();
            ctx.moveTo(Math.random() * width, Math.random() * height);
            ctx.lineTo(Math.random() * width, Math.random() * height);
            ctx.stroke();
        }
    }

    reset() {
        this.sliderPosition = 0;
        this.verified = false;
        this.updateSliderPosition();

        UI.setText(document.getElementById('captchaText'), '向右滑动完成验证');

        const thumb = document.getElementById('captchaThumb');
        if (thumb) {
            thumb.className = 'slider-captcha-thumb';
            thumb.innerHTML = '<i class="fas fa-arrow-right"></i>';
        }

        UI.removeClass(document.getElementById('trackBox'), 'show');
        this.generateCaptcha();
        this.options.onRefresh();
    }

    success() {
        this.verified = true;
        UI.setText(document.getElementById('captchaText'), '验证通过 ✓');

        const thumb = document.getElementById('captchaThumb');
        if (thumb) {
            thumb.className = 'slider-captcha-thumb success';
            thumb.innerHTML = '<i class="fas fa-check"></i>';
        }

        setTimeout(() => this.options.onSuccess(), 500);
    }

    fail() {
        this.verified = false;
        UI.setText(document.getElementById('captchaText'), '验证失败 ✗');

        const thumb = document.getElementById('captchaThumb');
        if (thumb) {
            thumb.className = 'slider-captcha-thumb error';
            thumb.style.animation = 'shake 0.5s';
            thumb.addEventListener('animationend', () => {
                thumb.style.animation = '';
            }, {once: true});
        }

        this.options.onFail();
    }

    isValid() {
        return this.verified;
    }

    refresh() {
        this.reset();
    }
}

// ==================== 全局状态管理 ====================

const AppState = {
    captcha: null,
    currentAction: null, // 'login' | 'register'
    rememberMe: false,

    init() {
        // 恢复记住我状态
        this.rememberMe = localStorage.getItem('rememberMe') === 'true';
        if (this.rememberMe) {
            const username = localStorage.getItem('username') || '';
            const password = localStorage.getItem('password') || '';
            const usernameEl = document.getElementById('loginUsername');
            const passwordEl = document.getElementById('loginPassword');
            const rememberEl = document.getElementById('rememberMe');

            if (usernameEl) usernameEl.value = username;
            if (passwordEl) passwordEl.value = password;
            if (rememberEl) rememberEl.checked = true;
        }
    },

    setRemember(username, password, remember) {
        if (remember) {
            localStorage.setItem('username', username);
            localStorage.setItem('password', password);
            localStorage.setItem('rememberMe', 'true');
        } else {
            localStorage.removeItem('username');
            localStorage.removeItem('password');
            localStorage.removeItem('rememberMe');
        }
    }
};

// ==================== 表单控制 ====================

const FormController = {
    showLoginForm() {
        UI.show(document.getElementById('loginForm'));
        UI.hide(document.getElementById('registerForm'));
        document.title = '企业聊天室 - 登录';
        clearAllMessages();
    },

    showRegisterForm() {
        UI.hide(document.getElementById('loginForm'));
        UI.show(document.getElementById('registerForm'));
        document.title = '企业聊天室 - 注册';
        clearAllMessages();
    },

    validateLogin() {
        const username = document.getElementById('loginUsername')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;

        if (!username) {
            showMessage('loginUsernameError', '请输入用户名或邮箱');
            return false;
        }
        if (!password) {
            showMessage('loginPasswordError', '请输入密码');
            return false;
        }
        return true;
    },

    validateRegister() {
        const username = document.getElementById('registerUsername')?.value.trim();
        const email = document.getElementById('registerEmail')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;
        const passwordConfirm = document.getElementById('registerPasswordConfirm')?.value;
        const phone = document.getElementById('registerPhone')?.value.trim();

        let valid = true;

        if (!username || username.length < 3 || username.length > 20) {
            showMessage('registerUsernameError', '用户名长度必须在3-20个字符之间');
            valid = false;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showMessage('registerEmailError', '请输入有效的邮箱地址');
            valid = false;
        }
        if (!password || password.length < 8) {
            showMessage('registerPasswordError', '密码长度至少8位');
            valid = false;
        }
        if (password !== passwordConfirm) {
            showMessage('registerPasswordConfirmError', '两次输入的密码不一致');
            valid = false;
        }
        if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
            showMessage('registerPhoneError', '请输入有效的手机号');
            valid = false;
        }

        return valid;
    }
};

// ==================== API 请求 ====================

const API = {
    BASE_URL: '/api/auth/',

    async request(endpoint, method = 'POST', data = null) {
        try {
            const response = await fetch(this.BASE_URL + endpoint, {
                method,
                headers: {'Content-Type': 'application/json'},
                body: data ? JSON.stringify(data) : null
            });
            return {
                ok: response.ok,
                status: response.status,
                data: await response.json()
            };
        } catch (error) {
            console.error(`API ${endpoint} error:`, error);
            return {ok: false, error: '网络错误，请稍后重试'};
        }
    },

    async login(username, encryptedPassword) {
        return this.request('login/', 'POST', {
            username,
            password: encryptedPassword
        });
    },

    async register(userData) {
        return this.request('register/', 'POST', {
            ...userData,
            password: window.EncryptUtils?.encryptData(userData.password) || userData.password
        });
    },

    async requestPasswordReset(email) {
        return this.request('request_password_reset/', 'POST', {email});
    },

    async confirmPasswordReset(email, token, newPassword, confirmPassword) {
        return this.request('confirm_password_reset/', 'POST', {
            email, token, new_password: newPassword, new_password_confirm: confirmPassword
        });
    }
};

// ==================== 业务逻辑 ====================

const AuthLogic = {
    // 滑块验证码控制
    showCaptcha(action) {
        AppState.currentAction = action;
        UI.show(document.getElementById('captchaModal'));

        if (!AppState.captcha) {
            AppState.captcha = new SliderCaptcha('captchaContainer', {
                onSuccess: () => this.executeAction(),
                onFail: () => showToast('验证失败，请重试', 'error'),
                onRefresh: () => console.log('Captcha refreshed')
            });
        } else {
            AppState.captcha.reset();
        }
    },

    closeCaptcha() {
        UI.hide(document.getElementById('captchaModal'));
        AppState.currentAction = null;
    },

    async executeAction() {
        if (AppState.currentAction === 'login') {
            await this.performLogin();
        } else if (AppState.currentAction === 'register') {
            await this.performRegister();
        }
        this.closeCaptcha()
    },

    async performLogin() {
        const username = document.getElementById('loginUsername')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        const remember = document.getElementById('rememberMe')?.checked;
        const loginBtn = document.getElementById('loginSubmitBtn');

        if (!username || !password) return;

        setLoading(loginBtn, true);

        try {
            const encryptedPwd = window.EncryptUtils?.encryptData(password) || password;
            const result = await API.login(username, encryptedPwd);

            if (result.ok) {
                // 保存 token
                localStorage.setItem('access_token', result.data.access);
                localStorage.setItem('refresh_token', result.data.refresh);

                // 记住我
                AppState.setRemember(username, password, remember);

                showMessage('loginSuccessMessage', '登录成功，正在跳转...', 'success');

                setTimeout(() => {
                    const redirect = localStorage.getItem('redirect_url');
                    localStorage.removeItem('redirect_url');
                    window.location.href = redirect || '/chat/';
                }, 1000);
            } else {
                this.handleLoginError(result.data);
            }
        } catch (error) {
            showMessage('loginGeneralError', '网络错误，请稍后重试');
        } finally {
            setLoading(loginBtn, false);
        }
    },

    handleLoginError(data) {
        if (Array.isArray(data.non_field_errors)) {
            showMessage('loginGeneralError', data.non_field_errors[0]);
        } else if (typeof data === 'object') {
            for (const [field, messages] of Object.entries(data)) {
                if (Array.isArray(messages)) {
                    const errorId = field === 'non_field_errors'
                        ? 'loginGeneralError'
                        : `login${field.charAt(0).toUpperCase() + field.slice(1)}Error`;
                    showMessage(errorId, messages[0]);
                }
            }
        } else if (typeof data === 'string') {
            showMessage('loginGeneralError', data);
        } else {
            showMessage('loginGeneralError', '登录失败，请检查用户名和密码');
        }
    },

    async performRegister() {
        const userData = {
            username: document.getElementById('registerUsername')?.value.trim(),
            email: document.getElementById('registerEmail')?.value.trim(),
            password: document.getElementById('registerPassword')?.value,
            password_confirm: document.getElementById('registerPasswordConfirm')?.value
        };

        const phone = document.getElementById('registerPhone')?.value.trim();
        if (phone) userData.phone = phone;

        const registerBtn = document.getElementById('registerSubmitBtn');
        setLoading(registerBtn, true);

        try {
            const result = await API.register(userData);

            if (result.ok) {
                showMessage('registerSuccessMessage', '注册成功！正在跳转到登录页面...', 'success');
                setTimeout(() => FormController.showLoginForm(), 2000);
            } else {
                this.handleRegisterError(result.data);
            }
        } catch (error) {
            showMessage('registerGeneralError', '网络错误，请稍后重试');
        } finally {
            setLoading(registerBtn, false);
        }
    },

    handleRegisterError(data) {
        const fieldMap = {
            username: 'registerUsernameError',
            email: 'registerEmailError',
            password: 'registerPasswordError',
            password_confirm: 'registerPasswordConfirmError',
            phone: 'registerPhoneError',
            non_field_errors: 'registerGeneralError',
            detail: 'registerGeneralError',
            error: 'registerGeneralError'
        };

        for (const [field, messages] of Object.entries(data)) {
            if (Array.isArray(messages) && fieldMap[field]) {
                showMessage(fieldMap[field], messages[0]);
            }
            if (typeof messages === 'string' && fieldMap[field]) {
                showMessage(fieldMap[field], messages)
            }
        }
    },


    async handleForgotPassword() {
        const email = document.getElementById('resetEmail')?.value;
        const sendBtn = document.getElementById('sendResetBtn');
        const messageDiv = document.getElementById('resetMessage');

        if (sendBtn?.disabled) return;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            UI.setHTML(messageDiv, '请输入有效的邮箱地址');
            messageDiv.className = 'alert alert-danger show';
            return;
        }

        setLoading(sendBtn, true);
        UI.hide(messageDiv);

        try {
            // const result = await API.requestPasswordReset(email);
            // console.log('result: ', result)

            // 使用 AbortController 添加超时
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 秒超时

            const response = await fetch('/api/auth/request_password_reset/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // ...TokenManager.getHeaders?.() // 兼容可能不存在的 TokenManager
                },
                body: JSON.stringify({email}),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // 🔧 关键修复：解析响应（无论成功或失败）
            let responseData;
            const contentType = response.headers.get('content-type');

            if (contentType && contentType.includes('application/json')) {
                responseData = await response.json();
            } else {
                // 非 JSON 响应，降级处理
                const text = await response.text();
                throw new Error(text || `服务器返回错误: ${response.status}`);
            }

            console.log('responseData: ', responseData)

            if (response.ok) {
                UI.setHTML(messageDiv, responseData.message || '重置链接已发送，请检查邮箱');
                messageDiv.className = 'alert alert-success show';

                // 可选：成功后清空输入框
                const emailInput = document.getElementById('resetEmail');
                if (emailInput) emailInput.value = '';

                setTimeout(() => {
                    AuthLogic.closeForgotPasswordModal();
                    showToast('请检查邮箱查收重置链接', 'success');
                }, 3000);

                return;
            }

            // 🔧 错误响应 (400/401/403/500 等)
            throw new Error(parseApiError(responseData, response.status));

        } catch (error) {
            console.error('密码重置请求失败:', error);


            // 🔧 显示错误信息
            UI.setHTML(messageDiv, error.message || '请求失败，请稍后重试');
            messageDiv.className = 'alert alert-danger show';

        } finally {
            // 🔧 恢复按钮状态
            setLoading(sendBtn, false);
        }
    },

    // 模态框控制
    openForgotPasswordModal() {
        UI.show(document.getElementById('forgotPasswordModal'));
        UI.hide(document.getElementById('resetMessage'));
        document.getElementById('forgotPasswordForm')?.reset();
    },

    closeForgotPasswordModal() {
        UI.hide(document.getElementById('forgotPasswordModal'));
    }
};

// ==================== 事件绑定 ====================

function bindEvents() {

    // 绑定表单切换
    // document.getElementById('showRegisterLink').addEventListener('click', function (e) {
    //     e.preventDefault();
    //     FormController.showRegisterForm();
    // });

    // 表单切换
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        FormController.showLoginForm();
    });

    // 登录/注册提交（触发滑块验证）
    document.getElementById('loginSubmitBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllMessages();
        if (FormController.validateLogin()) {
            AuthLogic.showCaptcha('login');
        }
    });

    document.getElementById('registerSubmitBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllMessages();
        if (FormController.validateRegister()) {
            AuthLogic.showCaptcha('register');
        }
    });

    // 忘记密码
    document.getElementById('forgotPasswordForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        AuthLogic.handleForgotPassword();
    });

    // 滑块验证码弹窗控制
    document.getElementById('captchaCancelBtn')?.addEventListener('click', () => {
        AuthLogic.closeCaptcha();
    });

    document.getElementById('captchaRefreshBtn')?.addEventListener('click', () => {
        AppState.captcha?.refresh();
    });

    document.getElementById('captchaModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'captchaModal') AuthLogic.closeCaptcha();
    });

    // 模态框关闭按钮
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal?.id === 'forgotPasswordModal') {
                AuthLogic.closeForgotPasswordModal();
            } else if (modal?.id === 'captchaModal') {
                AuthLogic.closeCaptcha();
            }
        });
    });

    // 回车键提交
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const activeForm = document.querySelector('.auth-form:not([style*="display: none"])');
            if (activeForm?.querySelector('form')) {
                e.preventDefault();
                if (activeForm.id === 'loginForm') {
                    document.getElementById('loginSubmitBtn')?.click();
                } else if (activeForm.id === 'registerForm') {
                    document.getElementById('registerSubmitBtn')?.click();
                }
            }
        }
    });
}

// ==================== 初始化 ====================

function init() {
    // 恢复记住我状态
    AppState.init();

    // 绑定事件
    bindEvents();

    // 检查登录状态
    const token = localStorage.getItem('access_token');
    if (token) {
        const redirect = localStorage.getItem('redirect_url');
        localStorage.removeItem('redirect_url');
        window.location.href = redirect || '/chat/';
    }

    console.log('Auth module initialized');
}

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// 导出全局函数（供 HTML 内联调用）
window.openForgotPasswordModal = () => AuthLogic.openForgotPasswordModal();
window.closeForgotPasswordModal = () => AuthLogic.closeForgotPasswordModal();