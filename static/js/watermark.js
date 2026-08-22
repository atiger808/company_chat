// static/js/watermark.js - 企业水印组件（显性 + 隐性，支持移动端/PC，可自定义配置）
// 用法：页面引入本文件后调用 WatermarkManager.init()（自动按 URL 识别页面）
//      提取隐性水印信息：WatermarkManager.extractHidden()
class WatermarkManager {
    static init(pageKey) {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const key = pageKey || WatermarkManager._detectPageKey();
        const run = function () {
            fetch('/api/system/watermark-config/?page=' + encodeURIComponent(key), {headers: TokenManager.getHeaders()})
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (raw) {
                    if (!raw) return;
                    const d = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
                    WatermarkManager._render(d.config || {}, d.extra || {}, key);
                })
                .catch(function () {});
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }

    // 用最近一次加载的配置重绘水印（如异步获取到用户信息后刷新显示内容），不重复请求配置
    static refresh(pageKey) {
        const key = pageKey || WatermarkManager._detectPageKey();
        if (WatermarkManager._lastConfig && WatermarkManager._lastKey === key) {
            WatermarkManager._render(WatermarkManager._lastConfig, WatermarkManager._lastExtra || {}, key);
        } else {
            WatermarkManager.init(key);
        }
    }

    // ===== 打印支持：操作留痕 + 打印水印 =====

    // 记录打印操作（供打印统计 / 打印权限分配），返回 Promise<{allowed:bool}>
    // allowed=false 表示当前用户没有打印权限（由后端按「允许打印」权限判定）
    static reportPrint(opts) {
        return new Promise(function (resolve) {
            try {
                const token = localStorage.getItem('access_token');
                if (!token) return resolve({allowed: true});
                const headers = (window.TokenManager && TokenManager.getHeaders)
                    ? TokenManager.getHeaders()
                    : {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token};
                fetch('/api/system/print-log/', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(opts || {}),
                    keepalive: true
                }).then(function (r) {
                    return r.ok ? r.json() : null;
                }).then(function (raw) {
                    if (!raw) return resolve({allowed: true});
                    let d = raw;
                    if (raw.encrypt && window.EncryptUtils) d = window.EncryptUtils.decryptPacket(raw);
                    resolve({allowed: d.allowed !== false});
                }).catch(function () {
                    resolve({allowed: true});
                });
            } catch (e) {
                resolve({allowed: true});
            }
        });
    }

    // 构建打印文档内嵌水印（{css, html}）；未开启水印/未开启打印水印时返回 null。
    // 打印底色恒为白纸，强制用深色文字，避免父页面深色主题下打印水印变白不可见。
    static buildPrintWatermark() {
        const cfg = WatermarkManager._lastConfig;
        if (!cfg || !cfg.enabled || !cfg.print_enabled) return null;
        const user = WatermarkManager._getCurrentUser();
        const baseText = (cfg.company_name || '义乌吉通集团') + ' · ' + (user.name || '') + ' · ' + WatermarkManager._nowText();
        const text = cfg.text ? (baseText + ' · ' + cfg.text) : baseText;
        const fontSize = cfg.font_size || 16;
        const opacity = Math.max(0.02, Math.min(1, cfg.opacity != null ? cfg.opacity : 0.08));
        const rot = ((cfg.rotation != null ? cfg.rotation : -30) * Math.PI) / 180;
        const style = cfg.font_style === 'bold' ? 'bold ' : (cfg.font_style === 'italic' ? 'italic ' : '');
        const base = cfg.font_color || '#000000';
        const color = WatermarkManager._colorLuminance(base) > 0.7 ? '#000000' : base;
        const stepX = Math.max(fontSize * 14, 240);
        const stepY = Math.max(fontSize * 9, 160);
        try {
            const canvas = document.createElement('canvas');
            canvas.width = stepX;
            canvas.height = stepY;
            const ctx = canvas.getContext('2d');
            ctx.globalAlpha = opacity;
            ctx.fillStyle = color;
            ctx.font = style + fontSize + 'px "Microsoft YaHei", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.save();
            ctx.translate(stepX / 2, stepY / 2);
            ctx.rotate(rot);
            ctx.fillText(text, 0, 0);
            ctx.restore();
            const url = canvas.toDataURL('image/png');
            const pos = cfg.position === 'center' ? 'center' : '0 0';
            // 🔧 css 为纯规则（不带 <style> 包裹），由各打印入口自行包进 <style>，避免嵌套 style 导致规则不生效
            return {
                css: '*{print-color-adjust:exact !important;-webkit-print-color-adjust:exact !important;}'
                    + '.wm-print-layer{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;'
                    + 'background-image:url(' + url + ') !important;background-repeat:repeat;background-position:' + pos + ';'
                    + 'print-color-adjust:exact;-webkit-print-color-adjust:exact;}',
                html: '<div class="wm-print-layer"></div>'
            };
        } catch (e) {
            return null;
        }
    }

    // 按当前 URL 识别页面 key（用于逐页开关）
    static _detectPageKey() {
        const path = window.location.pathname;
        if (path.indexOf('/chat/') === 0 && path.indexOf('/admin') >= 0) return 'admin';
        if (path.indexOf('/chat/') === 0) return 'chat';
        if (path.indexOf('/cloud/settings') === 0) return 'cloud_settings';
        if (path.indexOf('/cloud/editor') === 0) return 'cloud_editor';
        if (path.indexOf('/cloud/') === 0) return 'cloud';
        if (path.indexOf('/oa/approval') === 0) return 'oa_approval';
        if (path.indexOf('/oa/subsidy-verify') === 0) return 'oa_subsidy_verify';
        if (path.indexOf('/oa/subsidy-pay') === 0) return 'oa_subsidy_pay';
        if (path.indexOf('/oa/subsidy') === 0) return 'oa_subsidy';
        if (path.indexOf('/oa/attendance') === 0) return 'oa_attendance';
        if (path.indexOf('/oa/work-calendar') === 0) return 'work_calendar';
        if (path.indexOf('/tasks') === 0) return 'tasks';
        if (path.indexOf('/org') === 0) return 'org';
        return 'other';
    }

    // 读取当前登录用户信息（localStorage.current_user）
    static _getCurrentUser() {
        const out = {name: '', department: '', position: ''};
        try {
            const u = JSON.parse(localStorage.getItem('current_user') || '{}') || {};
            out.name = u.username || u.real_name || '';
            out.department = u.department_name || u.department_info.name || u.department || '';
            out.position = u.position || u.department_info.position || '';
        } catch (e) {}
        if (!out.name) {
            const uid = localStorage.getItem('user_id');
            if (uid) out.name = '用户' + uid;
        }
        return out;
    }

    static _nowText() {
        const n = new Date();
        const p = function (x) { return String(x).padStart(2, '0'); };
        return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes());
    }

    static _device() {
        const ua = navigator.userAgent || '';
        if (ua.indexOf('iPhone') >= 0 || ua.indexOf('iPad') >= 0) return 'iOS';
        if (ua.indexOf('Android') >= 0) return 'Android';
        if (ua.indexOf('Windows') >= 0) return 'Windows';
        if (ua.indexOf('Mac') >= 0) return 'macOS';
        return 'Other';
    }

    static _render(cfg, extra, key) {
        if (!cfg) return;
        // 缓存最近配置：即使当前页被页面级开关关闭，打印水印仍可用（打印水印只受全局+print_enabled 控制）
        WatermarkManager._lastConfig = cfg;
        WatermarkManager._lastExtra = extra || {};
        WatermarkManager._lastKey = key;
        if (!cfg.enabled) return;
        const pageEnabled = (cfg.page_enabled || {})[key];
        if (pageEnabled === false) return;
        const user = WatermarkManager._getCurrentUser();
        const baseText = (cfg.company_name || '义乌吉通集团') + ' · ' + (user.name || '') + ' · ' + WatermarkManager._nowText();
        const visibleText = cfg.text ? (baseText + ' · ' + cfg.text) : baseText;
        WatermarkManager._applyVisible(cfg, visibleText);
        if (cfg.hidden_enabled) {
            WatermarkManager._applyHidden(cfg, {
                company: cfg.company_name || '义乌吉通集团',
                visible: visibleText,
                name: user.name,
                department: user.department,
                position: user.position,
                ip: (extra && extra.ip) || '',
                device: WatermarkManager._device(),
                ua: navigator.userAgent || '',
                time: new Date().toLocaleString(),
            });
        }
    }

    // 是否深色主题（页面 <html data-theme="dark">）
    static _isDark() {
        return document.documentElement && document.documentElement.getAttribute('data-theme') === 'dark';
    }

    // 计算颜色亮度（0~1）
    static _colorLuminance(hex) {
        var c = String(hex || '#000000').replace('#', '');
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        var r = parseInt(c.substring(0, 2), 16);
        var g = parseInt(c.substring(2, 4), 16);
        var b = parseInt(c.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return 0.5;
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    // 根据主题自适应水印颜色：深色背景用亮色，浅色背景用暗色，保证两种模式下都可见
    static _effectiveColor(cfg) {
        var base = cfg.font_color || '#000000';
        var lum = WatermarkManager._colorLuminance(base);
        if (WatermarkManager._isDark()) {
            return lum < 0.45 ? '#ffffff' : base;   // 深色下：配置为暗色 → 自动改亮色
        }
        return lum > 0.7 ? '#000000' : base;         // 浅色下：配置为亮色 → 自动改暗色
    }

    // ===== 显性水印 =====
    static _applyVisible(cfg, text) {
        const id = 'wm_visible_layer';
        let layer = document.getElementById(id);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = id;
            document.body.appendChild(layer);
        }
        layer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483000;pointer-events:none;overflow:hidden;';
        let canvas = layer.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            layer.appendChild(canvas);
        }
        const draw = function () { WatermarkManager._drawVisible(canvas, cfg, text); };
        draw();
        if (WatermarkManager._visResizeHandler) window.removeEventListener('resize', WatermarkManager._visResizeHandler);
        WatermarkManager._visResizeHandler = draw;
        window.addEventListener('resize', WatermarkManager._visResizeHandler);
        WatermarkManager._visibleDraw = draw;
        WatermarkManager._watchTheme();
    }

    // 监听主题切换，切换后自动重绘水印（适配深浅色）
    static _watchTheme() {
        if (WatermarkManager._themeObserver) return;
        var target = document.documentElement;
        if (!target) return;
        WatermarkManager._themeObserver = new MutationObserver(function () {
            if (WatermarkManager._visibleDraw) WatermarkManager._visibleDraw();
        });
        WatermarkManager._themeObserver.observe(target, {attributes: true, attributeFilter: ['data-theme']});
    }

    static _drawVisible(canvas, cfg, text) {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth, h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const opacity = Math.max(0.02, Math.min(1, cfg.opacity != null ? cfg.opacity : 0.08));
        const fontSize = cfg.font_size || 16;
        const color = WatermarkManager._effectiveColor(cfg);
        const style = cfg.font_style === 'bold' ? 'bold ' : (cfg.font_style === 'italic' ? 'italic ' : '');
        const rot = ((cfg.rotation != null ? cfg.rotation : -30) * Math.PI) / 180;
        // 印章底色：用当前水印颜色取其低透明度版本，深浅色下均可见
        const rgb = WatermarkManager._hexToRgb(color);
        const stampBg = rgb ? 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (opacity * 0.15) + ')' : 'rgba(0,0,0,' + (opacity * 0.15) + ')';
        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;
        ctx.font = style + fontSize + 'px "Microsoft YaHei", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const stamp = cfg.shape === 'stamp';
        if (cfg.position === 'tile') {
            const stepX = Math.max(fontSize * 14, 240);
            const stepY = Math.max(fontSize * 9, 160);
            ctx.font = style + fontSize + 'px "Microsoft YaHei", Arial, sans-serif';
            const tw = ctx.measureText(text).width;
            for (let y = 0; y <= h + stepY; y += stepY) {
                for (let x = 0; x <= w + stepX; x += stepX) {
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(rot);
                    if (stamp) {
                        const pad = fontSize * 0.5;
                        ctx.fillStyle = stampBg;
                        WatermarkManager._roundRect(ctx, -tw / 2 - pad, -fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2, fontSize * 0.4);
                        ctx.fill();
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 1;
                        ctx.globalAlpha = opacity * 0.8;
                        ctx.stroke();
                        ctx.globalAlpha = opacity;
                        ctx.fillStyle = color;
                    }
                    ctx.fillText(text, 0, 0);
                    ctx.restore();
                }
            }
        } else {
            let px = w / 2, py = h / 2;
            if (cfg.position === 'top_left') { px = Math.max(fontSize * 6, 140); py = Math.max(fontSize * 3, 50); }
            else if (cfg.position === 'top_right') { px = w - Math.max(fontSize * 6, 140); py = Math.max(fontSize * 3, 50); }
            else if (cfg.position === 'bottom_left') { px = Math.max(fontSize * 6, 140); py = h - Math.max(fontSize * 3, 50); }
            else if (cfg.position === 'bottom_right') { px = w - Math.max(fontSize * 6, 140); py = h - Math.max(fontSize * 3, 50); }
            const tw = ctx.measureText(text).width;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(rot);
            if (stamp) {
                const pad = fontSize * 0.6;
                ctx.fillStyle = stampBg;
                WatermarkManager._roundRect(ctx, -tw / 2 - pad, -fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2, fontSize * 0.5);
                ctx.fill();
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.globalAlpha = opacity * 0.8;
                ctx.stroke();
                ctx.globalAlpha = opacity;
                ctx.fillStyle = color;
            }
            ctx.fillText(text, 0, 0);
            ctx.restore();
        }
    }

    static _hexToRgb(hex) {
        var c = String(hex || '').replace('#', '');
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        var r = parseInt(c.substring(0, 2), 16);
        var g = parseInt(c.substring(2, 4), 16);
        var b = parseInt(c.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
        return {r: r, g: g, b: b};
    }

    static _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // ===== 隐性水印（不可见，含用户姓名/部门/职位/IP/设备等，便于溯源） =====
    static _applyHidden(cfg, info) {
        const id = 'wm_hidden_layer';
        let layer = document.getElementById(id);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = id;
            document.body.appendChild(layer);
        }
        layer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147482999;pointer-events:none;overflow:hidden;';
        layer.setAttribute('data-hidden-info', JSON.stringify(info));
        let canvas = layer.querySelector('canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            layer.appendChild(canvas);
        }
        const draw = function () { WatermarkManager._drawHidden(canvas, cfg, info); };
        draw();
        if (WatermarkManager._hidResizeHandler) window.removeEventListener('resize', WatermarkManager._hidResizeHandler);
        WatermarkManager._hidResizeHandler = draw;
        window.addEventListener('resize', WatermarkManager._hidResizeHandler);
    }

    static _drawHidden(canvas, cfg, info) {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth, h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const opacity = Math.max(0.005, Math.min(0.1, cfg.hidden_opacity != null ? cfg.hidden_opacity : 0.04));
        ctx.globalAlpha = opacity;
        ctx.fillStyle = '#000000';
        ctx.font = '10px "Microsoft YaHei", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const line = [info.company || '义乌吉通集团', info.name, info.department, info.position, info.ip, info.device, info.time].join('|');
        const cw = ctx.measureText(line).width + 24;
        for (let y = 10; y < h; y += 22) {
            for (let x = 10; x < w; x += cw) {
                ctx.fillText(line, x, y);
            }
        }
    }

    // 提取隐性水印信息（溯源用）
    static extractHidden() {
        const layer = document.getElementById('wm_hidden_layer');
        if (!layer) return null;
        try {
            return JSON.parse(layer.getAttribute('data-hidden-info') || 'null');
        } catch (e) {
            return null;
        }
    }
}
