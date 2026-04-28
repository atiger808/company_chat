/**
 * @File   : cloud_auth.js
 * @Time   : 2026/04/22
 * @Author : Enterprise Cloud Team
 * @Desc   : 企业网盘认证模块逻辑
 * 依赖: /static/css/cloud_auth.css, /static/js/api.js, /static/js/token.js
 */

// ==================== 配置常量 ====================
const CLOUD_CONFIG = {
    API_BASE_URL: '/api/auth',           // 与聊天室共用认证接口
    REDIRECT_AFTER_LOGIN: '/cloud/',     // 登录成功跳转网盘首页
    REGISTRATION_ENABLED: false,          // 🔧 注册功能默认关闭
    REMEMBER_ME_DURATION: 7 * 24 * 60 * 60 * 1000,  // 记住我有效期：7天
    PASSWORD_MIN_LENGTH: 8,
    USERNAME_PATTERN: /^[a-zA-Z0-9_-]{3,20}$/,
    EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE_PATTERN: /^1[3-9]\d{9}$/
};

// ==================== 工具函数（复用） ====================
/**
 * 解析后端返回的验证错误
 */
function parseApiError(errorData, statusCode) {
    if (typeof errorData === 'object' && errorData !== null) {
        // DRF 字段验证错误
        for (const [field, messages] of Object.entries(errorData)) {
            if (Array.isArray(messages) && messages.length > 0) {
                return messages[0];
            }
        }
        // 通用错误格式
        if (errorData.error) return errorData.error;
        if (errorData.message) return errorData.message;
        if (errorData.detail) return errorData.detail;
        if (errorData.non_field_errors?.[0]) return errorData.non_field_errors[0];
    }
    // 状态码映射
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
 * UI 操作工具
 */
const UI = {
    show: (el) => { if (el) { el.style.display = ''; el.classList?.add('show'); } },
    hide: (el) => { if (el) { el.style.display = 'none'; el.classList?.remove('show'); } },
    clearHTML: (el) => { if (el) { el.textContent = ''; el.style.display = ''} },
    toggle: (el) => { if (el) { el.classList.toggle('show'); el.style.display = el.classList.contains('show') ? '' : 'none'; } },
    addClass: (el, cls) => el?.classList?.add(cls),
    removeClass: (el, cls) => el?.classList?.remove(cls),
    setText: (el, text) => { if (el) el.textContent = text; },
    setHTML: (el, html) => { if (el) el.innerHTML = html; }
};

/**
 * 消息提示
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
        setTimeout(() => field.classList.remove('error'), 2000);
    }
}

function clearMessage(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = '';
        el.className = el.classList.contains('alert') ? 'alert' : '';
    }
}

function clearAllMessages() {
    document.querySelectorAll('.error-message, .success-message, .alert').forEach(el => {
        el.textContent = '';
        el.className = el.classList.contains('alert') ? 'alert' : '';
    });
    document.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));
}

/**
 * 按钮加载状态
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
    toast.innerHTML = `
        <i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==================== 滑块验证码类（复用） ====================
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
            onSuccess: () => {},
            onFail: () => {},
            onRefresh: () => {},
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
        thumb.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('mouseup', () => this.endDrag());
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

        // 背景
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#f0f7ff');
        gradient.addColorStop(1, '#e6f4ff');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 随机正确位置
        this.correctPosition = Math.floor(Math.random() * (canvas.width - 140)) + 70;

        // 绘制拼图缺口
        ctx.strokeStyle = 'rgba(24, 144, 255, 0.6)';
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

        // 装饰图案（云朵元素）
        this.drawCloudDecorations(ctx, canvas.width, canvas.height);

        // 提示文字
        ctx.fillStyle = '#909399';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('拖动滑块完成验证', canvas.width / 2, canvas.height - 20);
    }

    drawCloudDecorations(ctx, width, height) {
        // 绘制云朵装饰
        ctx.fillStyle = 'rgba(24, 144, 255, 0.1)';
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * width;
            const y = Math.random() * (height - 60);
            const r = Math.random() * 15 + 10;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // 随机线条
        ctx.strokeStyle = 'rgba(24, 144, 255, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 10; i++) {
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
const CloudAuthState = {
    captcha: null,
    currentAction: null,  // 'login' | 'register'
    rememberMe: false,

    async init() {
        // 1. 恢复“记住我”状态
        this._restoreRememberedCredentials();

        // 2. 异步加载系统配置并更新注册开关状态
        await this._loadSystemConfig();

        // 3. 根据最终配置渲染界面（显示/隐藏注册入口）
        this._applyRegistrationVisibility();
    },

    /**
     * 从本地存储恢复用户名和密码
     * @private
     */
    _restoreRememberedCredentials() {
        const isRemembered = localStorage.getItem('cloud_rememberMe') === 'true';
        if (!isRemembered) return;

        const username = localStorage.getItem('cloud_username') || '';
        const password = localStorage.getItem('cloud_password') || '';

        const usernameEl = document.getElementById('loginUsername');
        const passwordEl = document.getElementById('loginPassword');
        const rememberEl = document.getElementById('rememberMe');

        if (usernameEl) usernameEl.value = username;
        if (passwordEl) passwordEl.value = password;
        if (rememberEl) rememberEl.checked = true;

        this.rememberMe = true;
    },

    /**
     * 加载后端系统配置
     * @private
     */
    async _loadSystemConfig() {
        try {
            // 确保 frontendConfig 存在且方法可用
            if (window.frontendConfig && typeof window.frontendConfig.loadConfigs === 'function') {
                await window.frontendConfig.loadConfigs();
            }

            // 获取注册开关配置，注意修正原代码中多余的引号
            if (window.frontendConfig && typeof window.frontendConfig.get === 'function') {
                CLOUD_CONFIG.REGISTRATION_ENABLED = window.frontendConfig.get('system.user_registration_enabled', false);
            }
        } catch (error) {
            console.warn('Failed to load system config for registration status:', error);
            // 失败时保持默认值或原有值
        }
    },

    /**
     * 应用注册功能的可见性逻辑
     * @private
     */
    _applyRegistrationVisibility() {
        const registerToggle = document.getElementById('registerToggle');
        const registerForm = document.getElementById('registerForm');

        // 如果注册未启用，则隐藏相关元素
        if (!CLOUD_CONFIG.REGISTRATION_ENABLED) {
            UI.hide(registerToggle);
            UI.hide(registerForm);
        } else {
            // 如果启用，确保它们可见（防止之前被隐藏）
            UI.show(registerToggle);
            // 注意：通常初始化时只显示登录表单，这里只控制“入口”可见性，
            // 具体显示哪个表单由 CloudFormController 控制，所以这里不强制 show registerForm
        }
    },

    setRemember(username, password, remember) {
        if (remember) {
            localStorage.setItem('cloud_username', username);
            localStorage.setItem('cloud_password', password);
            localStorage.setItem('cloud_rememberMe', 'true');
        } else {
            localStorage.removeItem('cloud_username');
            localStorage.removeItem('cloud_password');
            localStorage.removeItem('cloud_rememberMe');
        }
    }
};

// ==================== 表单控制 ====================
const CloudFormController = {
    showLoginForm() {
        UI.show(document.getElementById('loginForm'));
        UI.hide(document.getElementById('registerForm'));
        document.title = '企业网盘 - 登录';
        clearAllMessages();
    },

    showRegisterForm() {
        // 🔧 注册功能未启用时拦截
        if (!CLOUD_CONFIG.REGISTRATION_ENABLED) {
            showToast('注册功能暂未开放，请联系管理员', 'error');
            return;
        }
        UI.hide(document.getElementById('loginForm'));
        UI.show(document.getElementById('registerForm'));
        document.title = '企业网盘 - 注册';
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

        if (!username || !CLOUD_CONFIG.USERNAME_PATTERN.test(username)) {
            showMessage('registerUsernameError', '用户名长度必须在3-20个字符之间，仅支持字母、数字、下划线');
            valid = false;
        }
        if (!email || !CLOUD_CONFIG.EMAIL_PATTERN.test(email)) {
            showMessage('registerEmailError', '请输入有效的邮箱地址');
            valid = false;
        }
        if (!password || password.length < CLOUD_CONFIG.PASSWORD_MIN_LENGTH) {
            showMessage('registerPasswordError', `密码长度至少${CLOUD_CONFIG.PASSWORD_MIN_LENGTH}位`);
            valid = false;
        }
        if (password !== passwordConfirm) {
            showMessage('registerPasswordConfirmError', '两次输入的密码不一致');
            valid = false;
        }
        if (phone && !CLOUD_CONFIG.PHONE_PATTERN.test(phone)) {
            showMessage('registerPhoneError', '请输入有效的手机号');
            valid = false;
        }

        return valid;
    }
};

// ==================== API 请求（复用认证接口） ====================
const CloudAPI = {
    BASE_URL: CLOUD_CONFIG.API_BASE_URL,

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
            console.error(`CloudAPI ${endpoint} error:`, error);
            return {ok: false, error: '网络错误，请稍后重试'};
        }
    },

    async login(username, encryptedPassword) {
        return this.request('/login/', 'POST', {
            username,
            password: encryptedPassword
        });
    },

    async register(userData) {
        return this.request('/register/', 'POST', {
            ...userData,
            password: window.EncryptUtils?.encryptData(userData.password) || userData.password,
            password_confirm: window.EncryptUtils?.encryptData(userData.password_confirm) || userData.password_confirm
        });
    },

    async requestPasswordReset(email) {
        return this.request('/request_password_reset/', 'POST', {email});
    }
};

// ==================== 业务逻辑 ====================
const CloudAuthLogic = {
    // 滑块验证码控制
    showCaptcha(action) {
        CloudAuthState.currentAction = action;
        UI.show(document.getElementById('captchaModal'));

        if (!CloudAuthState.captcha) {
            CloudAuthState.captcha = new SliderCaptcha('captchaContainer', {
                onSuccess: () => this.executeAction(),
                onFail: () => showToast('验证失败，请重试', 'error'),
                onRefresh: () => console.log('Captcha refreshed')
            });
        } else {
            CloudAuthState.captcha.reset();
        }
    },

    closeCaptcha() {
        UI.hide(document.getElementById('captchaModal'));
        CloudAuthState.currentAction = null;
    },

    async executeAction() {
        if (CloudAuthState.currentAction === 'login') {
            await this.performLogin();
        } else if (CloudAuthState.currentAction === 'register') {
            await this.performRegister();
        }
        this.closeCaptcha();
    },

    async performLogin() {
        const username = document.getElementById('loginUsername')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        const remember = document.getElementById('rememberMe')?.checked;
        const loginBtn = document.getElementById('loginSubmitBtn');

        if (!username || !password) return;

        setLoading(loginBtn, true);

        try {
            // 密码加密（如果存在加密工具）
            const encryptedPwd = window.EncryptUtils?.encryptData(password) || password;
            const result = await CloudAPI.login(username, encryptedPwd);

            if (result.ok) {
                // 保存 token
                localStorage.setItem('access_token', result.data.access);
                localStorage.setItem('refresh_token', result.data.refresh);

                // 记住我
                CloudAuthState.setRemember(username, password, remember);

                showMessage('loginSuccessMessage', '登录成功，正在跳转到网盘...', 'success');

                // 🔧 跳转到网盘首页
                setTimeout(() => {
                    const redirect = localStorage.getItem('cloud_redirect_url');
                    localStorage.removeItem('cloud_redirect_url');
                    window.location.href = redirect || CLOUD_CONFIG.REDIRECT_AFTER_LOGIN;
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
        // 🔧 注册功能未启用时拦截
        if (!CLOUD_CONFIG.REGISTRATION_ENABLED) {
            showToast('注册功能暂未开放', 'error');
            return;
        }

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
            const result = await CloudAPI.register(userData);

            if (result.ok) {
                showMessage('registerSuccessMessage', '注册成功！正在跳转到登录页面...', 'success');
                setTimeout(() => CloudFormController.showLoginForm(), 2000);
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
                showMessage(fieldMap[field], messages);
            }
        }
    },

    async handleForgotPassword() {
        const email = document.getElementById('resetEmail')?.value;
        const sendBtn = document.getElementById('sendResetBtn');
        const messageDiv = document.getElementById('resetMessage');

        if (sendBtn?.disabled) return;

        if (!email || !CLOUD_CONFIG.EMAIL_PATTERN.test(email)) {
            UI.setHTML(messageDiv, '请输入有效的邮箱地址');
            messageDiv.className = 'alert alert-danger show';
            return;
        }

        setLoading(sendBtn, true);
        UI.clearHTML(messageDiv);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(`${CloudAPI.BASE_URL}/request_password_reset/`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({email}),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            let responseData;
            const contentType = response.headers.get('content-type');

            if (contentType && contentType.includes('application/json')) {
                responseData = await response.json();
            } else {
                const text = await response.text();
                throw new Error(text || `服务器返回错误: ${response.status}`);
            }

            if (response.ok) {
                UI.setHTML(messageDiv, responseData.message || '重置链接已发送，请检查邮箱');
                messageDiv.className = 'alert alert-success show';

                const emailInput = document.getElementById('resetEmail');
                if (emailInput) emailInput.value = '';

                setTimeout(() => {
                    this.closeForgotPasswordModal();
                    showToast('请检查邮箱查收重置链接', 'success');
                }, 3000);
                return;
            }

            throw new Error(parseApiError(responseData, response.status));

        } catch (error) {
            console.error('密码重置请求失败:', error);
            UI.setHTML(messageDiv, error.message || '请求失败，请稍后重试');
            messageDiv.className = 'alert alert-danger show';
        } finally {
            setLoading(sendBtn, false);
        }
    },

    openForgotPasswordModal() {
        UI.show(document.getElementById('forgotPasswordModal'));
        UI.hide(document.getElementById('resetMessage'));
        UI.clearHTML(document.getElementById('resetMessage'))
        document.getElementById('forgotPasswordForm')?.reset();
    },

    closeForgotPasswordModal() {
        UI.hide(document.getElementById('forgotPasswordModal'));
    }
};

// ==================== 事件绑定 ====================

function setupEnterKeyHandler() {
    let lastEnterTime = 0;

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.shiftKey) return;

        // 防抖：避免快速连按
        const now = Date.now();
        if (now - lastEnterTime < 300) return;
        lastEnterTime = now;

        e.preventDefault();

        // 检查当前激活的表单
        const forms = [
            { id: 'loginForm', btnId: 'loginSubmitBtn', validator: CloudFormController.validateLogin },
            { id: 'registerForm', btnId: 'registerSubmitBtn', validator: CloudFormController.validateRegister }
        ];

        for (const form of forms) {
            const el = document.getElementById(form.id);
            if (el && isElementVisible(el)) {
                // 先验证，再触发滑块
                if (typeof form.validator === 'function' && form.validator()) {
                    CloudAuthLogic.showCaptcha(form.id === 'loginForm' ? 'login' : 'register');
                }
                return;
            }
        }
    });
}

// 辅助函数：可靠判断元素可见性
function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           !el.classList.contains('hidden');
}


function bindCloudEvents() {
    // 表单切换
    document.getElementById('showLoginLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        CloudFormController.showLoginForm();
    });

    document.getElementById('showRegisterLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        CloudFormController.showRegisterForm();
    });

    // 登录/注册提交
    document.getElementById('loginSubmitBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllMessages();
        if (CloudFormController.validateLogin()) {
            CloudAuthLogic.showCaptcha('login');
        }
    });

    document.getElementById('registerSubmitBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllMessages();
        if (CloudFormController.validateRegister()) {
            CloudAuthLogic.showCaptcha('register');
        }
    });

    // 忘记密码
    document.getElementById('forgotPasswordForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        CloudAuthLogic.handleForgotPassword();
    });

    document.getElementById('sendResetBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        CloudAuthLogic.handleForgotPassword();
    });

    // 滑块验证码控制
    document.getElementById('captchaCancelBtn')?.addEventListener('click', () => {
        CloudAuthLogic.closeCaptcha();
    });

    document.getElementById('captchaRefreshBtn')?.addEventListener('click', () => {
        CloudAuthState.captcha?.refresh();
    });

    document.getElementById('captchaModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'captchaModal') CloudAuthLogic.closeCaptcha();
    });

    // 模态框关闭
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal?.id === 'forgotPasswordModal') {
                CloudAuthLogic.closeForgotPasswordModal();
            } else if (modal?.id === 'captchaModal') {
                CloudAuthLogic.closeCaptcha();
            }
        });
    });

    // 输入框实时验证反馈
    document.getElementById('loginUsername')?.addEventListener('blur', function() {
        if (this.value && !this.value.includes('@') && this.value.length < 3) {
            showMessage('loginUsernameError', '用户名至少3个字符');
        } else {
            clearMessage('loginUsernameError');
        }
    });

    document.getElementById('loginPassword')?.addEventListener('input', function() {
        clearMessage('loginPasswordError');
    });
}

// ==================== 初始化 ====================
function initCloudAuth() {
    // 恢复状态
    CloudAuthState.init();

    // 绑定事件
    bindCloudEvents();
    setupEnterKeyHandler();  // ✅ 新增

    // 检查登录状态（避免重复登录）
    const token = localStorage.getItem('access_token');
    if (token) {
        // 验证 token 有效性（可选）
        const redirect = localStorage.getItem('cloud_redirect_url');
        localStorage.removeItem('cloud_redirect_url');
        // 如果已登录且未指定来源，可考虑直接跳转
        window.location.href = redirect || CLOUD_CONFIG.REDIRECT_AFTER_LOGIN;
    }

    console.log('☁️ CloudAuth module initialized');
}

// DOM 加载完成后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCloudAuth);
} else {
    initCloudAuth();
}

// 导出全局函数（供 HTML 内联调用）
window.openForgotPasswordModal = () => CloudAuthLogic.openForgotPasswordModal();
window.closeForgotPasswordModal = () => CloudAuthLogic.closeForgotPasswordModal();
window.togglePassword = function(inputId, icon) {
    const input = document.getElementById(inputId);
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        icon.classList.toggle('fa-eye');
        icon.classList.toggle('fa-eye-slash');
    }
};