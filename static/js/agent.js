// static/js/agent.js - 企业智能体（AI 助手）嵌入组件
// 用法：页面引入本文件后调用 AgentManager.init()（自动按 URL 识别页面）
// 说明：是否启用、以及嵌入的代码，都由管理控制台「智能体设置」按企业 / 按页面配置；
//       页面加载时拉取配置，命中当前页面则在页面中动态注入配置的嵌入代码（默认是一段 <script>）。
class AgentManager {
    static init(pageKey) {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        const key = pageKey || AgentManager._detectPageKey();
        const run = function () {
            // 加 no-store + 时间戳：配置随时可能在管理控制台被改动，必须每次取最新，避免被缓存导致「改了不生效」
            fetch('/api/system/agent-config/?page=' + encodeURIComponent(key) + '&_t=' + Date.now(),
                {headers: TokenManager.getHeaders(), cache: 'no-store'})
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (raw) {
                    if (!raw) return;
                    const d = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
                    AgentManager._inject(d.config || {}, key);
                })
                .catch(function () {});
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    }

    // 重新拉取配置并按需注入（管理控制台保存配置后调用，让各页面即时生效）
    static reload(pageKey) {
        AgentManager.init(pageKey);
    }

    // 当前页是否启用智能体（需全局开启，且该页面开关为真值）
    static isEnabledFor(cfg, key) {
        if (!cfg || !cfg.enabled) return false;
        return !!(cfg.page_enabled || {})[key];
    }

    static _inject(cfg, key) {
        if (!AgentManager.isEnabledFor(cfg, key)) return;
        if (AgentManager._injected) return;
        const code = String(cfg.embed_code || '').trim();
        if (!code) return;
        try {
            const scripts = AgentManager._extractScripts(code);
            if (scripts.length) {
                scripts.forEach(function (s) { AgentManager._appendScript(s); });
            } else {
                // 非 <script> 代码（如自定义 HTML 片段）→ 直接注入到 body 末尾
                const wrap = document.createElement('div');
                wrap.className = 'agent-embed-wrap';
                wrap.innerHTML = code;
                document.body.appendChild(wrap);
            }
            AgentManager._injected = true;
            console.log('[AgentManager] 已注入智能体');
        } catch (e) {
            console.warn('智能体注入失败', e);
        }
    }

    // 页面 window 的 load 事件是否已经触发过（触发过就不会再来，异步注入的挂件会因此不初始化）
    static _loadFired() {
        return document.readyState === 'complete';
    }

    // 从配置的代码片段中解析出所有 <script> 标签（支持 src 外链与内联脚本）
    static _extractScripts(code) {
        const out = [];
        const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
        let m;
        while ((m = re.exec(code)) !== null) {
            out.push({attrs: m[1] || '', body: m[2] || ''});
        }
        return out;
    }

    // 按属性字符串创建 <script> 元素并追加到页面（内联脚本会立即执行，外链脚本异步加载）
    static _appendScript(spec) {
        const el = document.createElement('script');
        const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
        let am;
        while ((am = attrRe.exec(spec.attrs)) !== null) {
            const name = am[1];
            if (!name) continue;
            const val = am[2] != null ? am[2] : (am[3] != null ? am[3] : (am[4] != null ? am[4] : ''));
            try { el.setAttribute(name, val); } catch (e) {}
        }
        if (spec.body && spec.body.trim()) el.text = spec.body;

        // 关键：很多第三方挂件（如 MaxKB）在脚本内部用 window.addEventListener('load', init) 初始化。
        // 我们是「异步」注入的，此时页面的 load 事件往往已经触发过、不会再来，挂件就永远不会初始化。
        // 因此在 load 已触发时，临时接管 window.addEventListener，把脚本自身注册的 load 回调
        // 在其加载完成后手动执行一次（不影响页面上其它已有监听）。
        if (!AgentManager._loadFired()) {
            (document.body || document.documentElement).appendChild(el);
            return;
        }
        const origAdd = window.addEventListener;
        const captured = [];
        window.addEventListener = function (type, fn, opts) {
            if (type === 'load' && typeof fn === 'function') { captured.push(fn); return; }
            return origAdd.call(window, type, fn, opts);
        };
        const flush = function () {
            window.addEventListener = origAdd;
            captured.splice(0).forEach(function (fn) {
                try { fn(); } catch (e) { console.warn('[AgentManager] 执行脚本 load 回调失败', e); }
            });
        };
        if (el.getAttribute('src')) {
            el.addEventListener('load', flush);
            el.addEventListener('error', function () { window.addEventListener = origAdd; });
            (document.body || document.documentElement).appendChild(el);
        } else {
            // 内联脚本：appendChild 时同步执行并完成注册，随后立即回放
            (document.body || document.documentElement).appendChild(el);
            flush();
        }
    }

    // 按当前 URL 识别页面 key（用于逐页开关，与管理控制台/水印保持一致）
    static _detectPageKey() {
        const path = window.location.pathname;
        if (path.indexOf('/control') === 0) return 'admin';
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
        if (path.indexOf('/oa/announcements') === 0) return 'oa_announcements';
        if (path.indexOf('/oa/work-calendar') === 0) return 'work_calendar';
        if (path.indexOf('/oa/work-summary') === 0) return 'work_summary';
        if (path.indexOf('/tasks') === 0) return 'tasks';
        if (path.indexOf('/org') === 0) return 'org';
        if (path.indexOf('/docs') === 0) return 'knowledge';
        return 'other';
    }
}

// 显式挂到 window：顶层 class 声明不会成为 window 属性，
// 而管理控制台需要跨 iframe 调用 window.AgentManager.reload() 让各页面即时生效。
if (typeof window !== 'undefined') window.AgentManager = AgentManager;
