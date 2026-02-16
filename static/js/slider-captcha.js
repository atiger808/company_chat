// @File   :slider-captcha.js
// @Time   :2026/2/13 10:32
// @Author :dayue
// @Email  :ole211@qq.com

// 完善版滑块验证码类
class SliderCaptcha {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`SliderCaptcha: Container with id "${containerId}" not found`);
            return;
        }

        this.options = {
            width: options.width || 400,
            height: options.height || 160,
            sliderWidth: options.sliderWidth || 44,
            sliderHeight: options.sliderHeight || 44,
            onSuccess: options.onSuccess || function () {
            },
            onFail: options.onFail || function () {
            },
            onRefresh: options.onRefresh || function () {
            },
            ...options
        };

        this.isDragging = false;
        this.offsetX = 0;
        this.correctPosition = 0;
        this.sliderPosition = 0;
        this.verified = false;
        this.trackBox = null;

        this.init();
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
        if (!thumb) {
            console.error('SliderCaptcha: Required elements not found');
            return;
        }

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
        document.getElementById('captchaText').textContent = '拖动中...';
        document.getElementById('captchaThumb').classList.add('dragging');

        // 显示轨迹框
        const trackBox = document.getElementById('trackBox');
        if (trackBox) {
            trackBox.classList.add('show');
        }
    }

    drag(e) {
        if (!this.isDragging) return;

        const currentX = this.getMouseX(e);
        const deltaX = currentX - this.offsetX;
        const maxX = this.options.width - this.options.sliderWidth;

        // 限制滑块位置
        this.sliderPosition = Math.max(0, Math.min(deltaX, maxX));

        // 更新滑块和轨迹框位置
        this.updateSliderPosition();
        this.updateTrackBoxPosition();
    }

    endDrag() {
        if (!this.isDragging) return;

        this.isDragging = false;
        document.getElementById('captchaThumb').classList.remove('dragging');

        // 隐藏轨迹框
        const trackBox = document.getElementById('trackBox');
        if (trackBox) {
            trackBox.classList.remove('show');
        }

        // 验证是否在正确位置（允许±10像素误差）
        if (Math.abs(this.sliderPosition - this.correctPosition) <= 10) {
            this.success();
        } else {
            this.fail();
            setTimeout(() => this.reset(), 1500);
        }
    }

    getMouseX(e) {
        if (e.clientX) {
            return e.clientX;
        } else if (e.touches && e.touches[0]) {
            return e.touches[0].clientX;
        }
        return 0;
    }

    updateSliderPosition() {
        const thumb = document.getElementById('captchaThumb');
        if (thumb) {
            thumb.style.transform = `translateX(${this.sliderPosition}px)`;
        }
    }

    updateTrackBoxPosition() {
        const trackBox = document.getElementById('trackBox');
        if (trackBox) {
            // 轨迹框跟随滑块移动，但位置稍微偏移以显示拼图缺口
            const boxPosition = this.sliderPosition + (this.options.sliderWidth / 2) - 20;
            trackBox.style.left = `${boxPosition}px`;
        }
    }

    generateCaptcha() {
        const canvas = document.getElementById('captchaCanvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            console.error('SliderCaptcha: Unable to get canvas context');
            return;
        }

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制背景渐变
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#f0f0f0');
        gradient.addColorStop(1, '#e0e0e0');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 生成随机位置（避开边缘）
        this.correctPosition = Math.floor(Math.random() * (canvas.width - 140)) + 70;

        // 绘制拼图缺口轮廓（与轨迹框对应）
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

        // 绘制装饰图案
        this.drawDecorations(ctx, canvas.width, canvas.height);

        // 绘制提示文字
        ctx.fillStyle = '#999';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('拖动滑块完成验证', canvas.width / 2, canvas.height - 20);
    }

    drawDecorations(ctx, width, height) {
        // 绘制随机圆点
        ctx.fillStyle = 'rgba(64, 158, 255, 0.1)';
        for (let i = 0; i < 25; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            const radius = Math.random() * 12 + 6;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // 绘制随机线条
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
        this.updateSliderPosition();
        this.verified = false;

        const text = document.getElementById('captchaText');
        const thumb = document.getElementById('captchaThumb');

        if (text) text.textContent = '向右滑动完成验证';
        if (thumb) {
            thumb.className = 'slider-captcha-thumb';
            thumb.innerHTML = '<i class="fas fa-arrow-right"></i>';
        }

        // 隐藏轨迹框
        const trackBox = document.getElementById('trackBox');
        if (trackBox) {
            trackBox.classList.remove('show');
        }

        this.generateCaptcha();
        this.options.onRefresh();
    }

    success() {
        this.verified = true;
        const text = document.getElementById('captchaText');
        const thumb = document.getElementById('captchaThumb');

        if (text) text.textContent = '验证通过 ✓';
        if (thumb) {
            thumb.className = 'slider-captcha-thumb success';
            thumb.innerHTML = '<i class="fas fa-check"></i>';
        }

        setTimeout(() => {
            this.options.onSuccess();
        }, 500);
    }

    fail() {
        this.verified = false;
        const text = document.getElementById('captchaText');
        const thumb = document.getElementById('captchaThumb');

        if (text) text.textContent = '验证失败 ✗';
        if (thumb) {
            thumb.className = 'slider-captcha-thumb error';
            // 抖动动画
            thumb.style.animation = 'shake 0.5s';
            thumb.addEventListener('animationend', () => {
                thumb.style.animation = '';
            });
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