// static/js/attendance.js - 考勤打卡

const OA_API_URL = '/api/oa';

class AttendanceApp {
    constructor() {
        this.currentPage = 1;
        this.pageSize = 20;
        this.searchKeyword = '';
        this._initTimer = null;
        this.chat_login_url = '/login/';
        // 用户端打卡范围地图状态
        this._myGeoRanges = [];
        this._myGeoPos = null;
        this._myGeoBd09 = null;       // 我的位置换算成 BD09 后的缓存（避免每次重绘都请求后端）
        this._myGeoInsideName = '';
        this._myGeoFocusIndex = -1;   // 底部标识点选后锁定的打卡点，-1 表示自动框选全部
        this._myGeoFullscreenOn = false;
        // 「显示考勤打卡范围配置」开关行是否暴露：由 .env 的 ATTENDANCE_GEO_VISIBLE_SWITCH
        // 经 settings.py → 模板块 下发（默认 false，即该行整体隐藏）
        this._geoVisibleSwitchEnabled = !!(window.ATT_GEO_VISIBLE_SWITCH);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    async init() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = this.chat_login_url;
            return;
        }
        // 打印权限：无权限则隐藏打印按钮并提示
        if (window.WatermarkManager && WatermarkManager.applyPrintPermission) {
            WatermarkManager.applyPrintPermission();
        }
        this.updateClock();
        this._initTimer = setInterval(() => this.updateClock(), 1000);
        this._bindViewportRelayout();
        await this.loadToday();
        await this.loadStats();
        await this.loadRecords();

        // 管理功能按钮：管理员/超级管理员；企业/部门过滤：仅超级管理员
        var userType = localStorage.getItem('user_type');
        if (userType === 'admin' || userType === 'super_admin') {
            var exportBtn = document.getElementById('attendanceExportBtn');
            var printBtn = document.getElementById('attendancePrintBtn');
            var configBtn = document.getElementById('attendanceConfigBtn');
            if (exportBtn) { exportBtn.style.display = ''; exportBtn.style.opacity = '0.4'; }
            if (printBtn) { printBtn.style.display = ''; printBtn.style.opacity = '0.4'; }
            if (configBtn) configBtn.style.display = 'inline-flex';
            if (userType === 'super_admin') {
                var tenantFilter = document.getElementById('attendanceFilterTenant');
                var deptFilter = document.getElementById('attendanceFilterDepartment');
                if (tenantFilter) tenantFilter.style.display = '';
                if (deptFilter) deptFilter.style.display = '';
                this._loadFilterTenants();
                // Bind dept filter change
                if (deptFilter) {
                    deptFilter.addEventListener('change', function() {
                        attendanceApp.loadRecords(1);
                    });
                }
            }
        }
    }

    // 移动端/PWA 上地图画布尺寸会在这些时机失效（旋转屏幕、下拉/收起地址栏、从后台切回、
    // iOS 前进后退缓存恢复），需要重算，否则地图会显示为空白或错位。
    _bindViewportRelayout() {
        if (this._viewportBound) return;
        this._viewportBound = true;
        var self = this;
        var relayout = function () {
            [self._myGeoMap, self._baiduMap].forEach(function (m) {
                if (m && m.checkResize) { try { m.checkResize(); } catch (e) { /* 忽略 */ } }
            });
        };
        window.addEventListener('resize', relayout);
        window.addEventListener('orientationchange', function () { setTimeout(relayout, 250); });
        window.addEventListener('pageshow', function () {
            setTimeout(function () {
                relayout();
                // iOS 前进后退缓存恢复时地图库可能没注册成功 → 重新尝试，别一直空着
                var card = document.getElementById('myGeoCard');
                if (card && card.style.display !== 'none' && !self._myGeoMap) {
                    var a = self._myGeoMapArgs || {};
                    self._ensureMyGeoMap(a.ranges || [], a.pos || null);
                }
            }, 150);
        });
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                setTimeout(relayout, 120);
                setTimeout(function () { self._retryPendingMaps(); }, 400);
            }
        });
        // 手机网络抖动很常见：恢复联网后自动再试一次（之前只会在加载失败时一直显示降级提示）
        window.addEventListener('online', function () {
            setTimeout(function () { self._retryPendingMaps(); }, 500);
        });
    }

    updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const el = document.getElementById('todayTime');
        if (el) el.textContent = hours + ':' + minutes + ':' + seconds;

        const dateEl = document.getElementById('todayDate');
        if (dateEl) {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            dateEl.textContent = y + '年' + m + '月' + d + '日 星期' + weekdays[now.getDay()];
        }
    }

    handleAuthError() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_type');
        localStorage.removeItem('current_user');
        localStorage.setItem('redirect_url', window.location.href);
        window.location.href = this.chat_login_url;
    }

    async apiGet(url) {
        const resp = await fetch(url, { headers: TokenManager.getHeaders() });
        if (!resp.ok) {
            if (resp.status === 401) {
                this.showToast('登录已过期，请重新登录', true)
                this.handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || '请求失败');
        };
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    async apiPost(url, data) {
        const resp = await fetch(url, {
            method: 'POST',
            headers: TokenManager.getHeaders(),
            body: JSON.stringify(data || {})
        });
        if (!resp.ok) {
            if (resp.status === 401) {
                this.showToast('登录已过期，请重新登录', true)
                this.handleAuthError();
                return
            }
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || '请求失败');
        }
        const raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    // 指定区域打卡提示 + 打卡范围地图（告诉员工有哪些打卡点、自己是否在范围内）
    // ⚠️ 移动端/iOS/PWA 修复点：先渲染「范围 + 地图」，再异步补「我的位置」。
    //   iOS 独立 PWA 里 navigator.geolocation 常常既不回调成功也不回调失败（拿不到权限弹窗），
    //   若等定位回来才画地图，用户会一直停在「正在定位…」/空白，表现就是「地图加载不出来」。
    async refreshMyGeo(withMap) {
        var el = document.getElementById('todayGeoInfo');
        var card = document.getElementById('myGeoCard');
        var statusEl = document.getElementById('myGeoStatus');
        if (!card) return;
        if (statusEl && withMap !== true) {
            statusEl.textContent = '正在定位…';
            statusEl.style.color = '#909399';
        }
        // 先让卡片可见：容器 display:none 时地图画布尺寸为 0，初始化出来就是一片空白
        card.style.display = 'block';
        // 1) 先取范围配置（不带位置）→ 立刻把地图画出来，绝不因定位而阻塞
        var d = null;
        try { d = await this.apiGet(OA_API_URL + '/attendance/attendance-geo/'); } catch (e) { d = null; }
        if (!d || !d.switch_on) {
            card.style.display = 'none';
            if (el) el.style.display = 'none';
            this._exitMyGeoFullscreen();
            return;
        }
        this._myGeoRanges = d.ranges || [];
        this._myGeoInsideName = '';
        this._renderMyGeoView(d, null);
        // 2) 位置单独取：拿到后再补「我的位置」与是否在范围内（失败也不影响上面已画出的范围）
        if (withMap === false) return;
        var pos = null;
        try { pos = await this._currentPosition(); } catch (e) { pos = null; }
        if (!pos) return;
        this._myGeoPos = pos;
        this._myGeoBd09 = null;   // 新位置 → 换掉的坐标缓存作废
        var d2 = null;
        try {
            d2 = await this.apiGet(OA_API_URL + '/attendance/attendance-geo/?lat=' + pos.lat + '&lng=' + pos.lng);
        } catch (e) { d2 = null; }
        if (d2 && d2.switch_on) d = d2;
        this._myGeoInsideName = d.inside ? (d.hit_name || '') : '';
        this._renderMyGeoView(d, pos);
    }

    // 渲染打卡范围卡片：状态文案 + 地图（或降级提示）+ 底部打卡点标识
    _renderMyGeoView(d, pos) {
        var el = document.getElementById('todayGeoInfo');
        var statusEl = document.getElementById('myGeoStatus');
        var mapEl = document.getElementById('myGeoMap');
        var fbEl = document.getElementById('myGeoFallback');
        var listEl = document.getElementById('myGeoList');
        var ranges = d.ranges || [];
        var self = this;
        // 打卡点文本清单：只在没有地图时作为降级说明（有地图时改用底部可点的标识条）
        if (listEl && !this._geoMapReady()) {
            listEl.innerHTML = ranges.length
                ? '打卡点：' + ranges.map(function (r) {
                    return self._escape(r.name || '打卡点') + '（半径 ' + (r.radius || 0) + ' 米）';
                }).join('、')
                : '';
        }
        // 开关开了但一个点都没配 → 不限制
        if (!d.required) {
            if (statusEl) {
                statusEl.textContent = '已启用指定区域打卡，但尚未配置打卡点，当前不做位置限制';
                statusEl.style.color = '#e6a23c';
            }
            if (mapEl) mapEl.style.display = 'none';
            if (fbEl) fbEl.style.display = 'none';
            if (el) el.style.display = 'none';
            this._renderMyGeoPoints([]);
            return;
        }
        // 顶部一句话提示
        if (el) {
            var names = ranges.map(function (r) { return r.name || '打卡点'; }).join('、');
            el.innerHTML = '<i class="fas fa-location-crosshairs"></i> 需在指定范围内打卡：'
                + this._escape(names) + '（' + this._escape(d.source_label || '') + '）';
            el.style.display = 'block';
        }
        // 状态：是否在范围内（由后端用与打卡校验相同的规则计算）
        if (statusEl) {
            if (d.inside === undefined) {
                statusEl.textContent = pos
                    ? '位置已获取，正在判断…'
                    : '正在获取定位…（若长时间无反应，请允许浏览器定位后点「重新定位」）';
                statusEl.style.color = pos ? '#909399' : '#e6a23c';
            } else if (d.inside) {
                statusEl.innerHTML = '<i class="fas fa-check-circle"></i> 您当前在打卡范围内'
                    + (d.hit_name ? '（' + this._escape(d.hit_name) + '）' : '') + '，可以打卡';
                statusEl.style.color = '#67c23a';
            } else {
                statusEl.innerHTML = '<i class="fas fa-times-circle"></i> 您当前不在打卡范围内，无法打卡'
                    + (d.nearest_m != null ? '（最近打卡点约 ' + d.nearest_m + ' 米）' : '');
                statusEl.style.color = '#f56c6c';
            }
        }
        this._renderMyGeoPoints(ranges);
        this._ensureMyGeoMap(ranges, pos);
    }

    // 当前位置（WGS84）。失败/超时返回 null。
    // iOS 独立 PWA 上 getCurrentPosition 可能「两个回调都不触发」，额外加看门狗定时器兜底，
    // 否则 Promise 永远不 resolve，整个打卡范围渲染都会被拖住。
    _currentPosition() {
        return new Promise(function (resolve) {
            var done = false;
            var finish = function (v) { if (!done) { done = true; resolve(v); } };
            if (!navigator.geolocation) { finish(null); return; }
            setTimeout(function () { finish(null); }, 9000);
            try {
                navigator.geolocation.getCurrentPosition(function (p) {
                    finish({lat: p.coords.latitude, lng: p.coords.longitude});
                }, function () { finish(null); },
                    {enableHighAccuracy: true, timeout: 7000, maximumAge: 60000});
            } catch (e) { finish(null); }
        });
    }

    // 地图库就绪前轮询等待。
    // 移动端/PWA 上百度脚本（含 AK 异步校验）可能几秒后才注册 window.BMap，之前这里是
    // 「一次判定失败 → 永久降级为文字」，于是手机上永远看不到地图。
    _ensureMyGeoMap(ranges, pos) {
        // 记下最新一次渲染参数：等库就绪后用它画（定位回调可能晚于地图就绪）
        this._myGeoMapArgs = {ranges: ranges || [], pos: pos || null};
        if (this._geoMapReady()) {
            this._myGeoMapWaiting = false;
            this._renderMyGeoMap(ranges, pos);
            return;
        }
        if (!window.BAIDU_MAP_JS_AK) {
            this._myGeoFallback('<i class="fas fa-info-circle"></i> 未配置百度地图浏览器端 AK（BAIDU_MAP_JS_AK），'
                + '无法显示地图。请在上方列出的打卡点范围内打卡（半径内的任意一点均可）。');
            return;
        }
        if (this._myGeoMapWaiting) return;   // 已在轮询，等它回调即可
        this._myGeoMapWaiting = true;
        var mapEl = document.getElementById('myGeoMap');
        if (mapEl) mapEl.style.display = 'none';   // 等待期间先不露出空白地图
        var self = this;
        var attempt = 0;
        (function poll() {
            if (self._geoMapReady()) {
                self._myGeoMapWaiting = false;
                var a = self._myGeoMapArgs || {};
                self._renderMyGeoMap(a.ranges, a.pos);
                return;
            }
            // 约 6 秒仍未就绪：补一次 callback 方式的异步加载（绕开 document.write）
            if (attempt === 30) self._loadGeoMapScriptAsync();
            if (++attempt >= 80) {   // 约 16 秒（手机上百度脚本是一串请求，留足时间）
                self._myGeoMapWaiting = false;
                var err = self._geoAkReason();
                var html;
                if (self._geoAkError || window.__baiduAkError) {
                    html = '<i class="fas fa-exclamation-triangle" style="color:#e6a23c;"></i> '
                        + '百度地图 AK 校验未通过：' + self._escape(err)
                        + '<br>当前页面地址：<b>' + self._escape((location.origin || '')) + '</b>。'
                        + '百度浏览器端 AK 按 Referer 校验、白名单需包含协议与端口，请把这个来源加进白名单。'
                        + self._geoAkHintHtml();
                } else {
                    html = '<i class="fas fa-info-circle"></i> '
                        + '地图底图暂时没加载出来（百度并未返回 AK 校验错误，多为网络较慢或被拦截）。'
                        + '<br>可下拉刷新、或换个网络再试；下方仍会列出全部打卡点，'
                        + '在任一打卡点半径内都能正常打卡。';
                }
                self._probeBaiduNet();
                self._myGeoFallback(html + self._diagBoxHtml());
                return;
            }
            setTimeout(poll, 200);
        })();
    }

    // 地图降级提示：隐藏地图与底部标识，展示说明文字
    _myGeoFallback(html) {
        var mapEl = document.getElementById('myGeoMap');
        var fbEl = document.getElementById('myGeoFallback');
        if (mapEl) mapEl.style.display = 'none';
        if (fbEl) {
            fbEl.style.display = 'block';
            if (html) fbEl.innerHTML = html;
        }
        this._exitMyGeoFullscreen();
        this._renderMyGeoPoints([]);
    }

    // AK 校验失败的原始文案（模板里的 alert 拦截器记录在 window.__baiduAkError）
    _geoAkReason() {
        var akErr = this._geoAkError || window.__baiduAkError;
        return akErr ? ('百度返回：' + akErr) : '可能是网络较慢，或 AK 校验未通过';
    }

    // AK 域名白名单排查提示（打卡端与配置端共用）
    _geoAkHintHtml() {
        var host = window.location.hostname || '';
        var base = host.split('.').slice(-2).join('.');
        var origin = (window.location && window.location.origin) || '';
        return '<br>百度浏览器端 AK 是按 <b>Referer（来源）</b> 校验的，白名单里<b>不支持端口泛匹配</b>：'
            + '请在<b>百度地图开放平台 → 应用管理 → 该 AK 的「设置」</b>中，把来源加进 Referer 白名单，'
            + '推荐同时加 <b>' + this._escape(origin) + '</b>（完整来源）、<b>' + this._escape(host) + '</b>'
            + '与 <b>*.' + this._escape(base) + '</b>。'
            + '若电脑端正常、只有手机端失败，多半是手机访问的地址不同（带端口 / http / PWA 里带了参数），'
            + '把那个来源也加上即可；想最快确认是否白名单问题，可临时填 <b>*</b> 验证一次再改回。';
    }

    // 用户端打卡范围地图：画出各打卡点圆圈 + 我的位置
    _renderMyGeoMap(ranges, pos) {
        var el = document.getElementById('myGeoMap');
        if (!el || !this._geoMapReady()) return;
        var fbEl = document.getElementById('myGeoFallback');
        if (fbEl) fbEl.style.display = 'none';
        el.style.display = 'block';
        this._renderMyGeoPoints(ranges);
        // 卡片刚从 display:none 变为可见，等浏览器完成布局再初始化，否则画布尺寸为 0
        // （移动端/iOS 上尤其明显：地图"加载出来了"却是一片空白）
        var self = this;
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        raf(function () {
            setTimeout(function () { self._drawMyGeoMap(ranges, pos); }, 30);
        });
    }

    async _drawMyGeoMap(ranges, pos) {
        var el = document.getElementById('myGeoMap');
        var NS = this._geoMapNS();
        if (!el || !NS) return;
        try {
            if (!this._myGeoMap) {
                this._myGeoMap = new NS.Map(el);
                // 鼠标：拖动 + 滚轮缩放 + 双击缩放（电脑端用户要求能缩放/拖动）；
                // 触摸：单指拖动 + 双指缩放（自己实现）。另给一组 +/− 按钮方便点击缩放。
                this._setupMapGestures(this._myGeoMap, el);
                try {
                    if (typeof NS.NavigationControl === 'function') {
                        this._myGeoMap.addControl(new NS.NavigationControl());
                    }
                } catch (e) { /* 该版本没有导航控件则忽略 */ }
            }
            var map = this._myGeoMap;
            (this._myGeoCircles || []).forEach(function (c) { map.removeOverlay(c); });
            (this._myGeoMarkers || []).forEach(function (m) { map.removeOverlay(m); });
            this._myGeoCircles = []; this._myGeoMarkers = [];
            var pts = [];
            var self = this;
            var inside = this._myGeoInsideName || '';
            (ranges || []).forEach(function (r, i) {
                if (r.bd09_lat == null || r.bd09_lng == null) return;
                var pt = new NS.Point(r.bd09_lng, r.bd09_lat);
                pts.push(pt);
                // 配色：我在里面的点绿色，点击定位的点蓝色，其余橙色
                var hit = !!(inside && (r.name || '打卡点') === inside);
                var focused = (i === self._myGeoFocusIndex);
                var color = hit ? '#67c23a' : (focused ? '#409eff' : '#e6a23c');
                var c = new NS.Circle(pt, r.radius || 300, {
                    strokeColor: color, strokeWeight: focused ? 3 : 2, strokeOpacity: 0.9,
                    fillColor: color, fillOpacity: focused ? 0.26 : 0.18
                });
                map.addOverlay(c); self._myGeoCircles.push(c);
                var lb = new NS.Label(r.name || '打卡点', {offset: new NS.Size(44, -18)});
                map.addOverlay(lb); self._myGeoCircles.push(lb);
            });
            // 我的位置：浏览器定位是 WGS84，地图需要 BD09 → 交给后端换算
            // （换算结果缓存下来，点底部打卡点标识重绘时不再重复请求）
            if (pos) {
                var bd = this._myGeoBd09;
                if (!bd) {
                    try {
                        var resp = await fetch(OA_API_URL + '/attendance/geo-convert/?lat=' + pos.lat
                            + '&lng=' + pos.lng + '&to=bd09', {headers: TokenManager.getHeaders()});
                        if (resp.ok) {
                            var raw = await resp.json();
                            // 必须是 decryptPacket：接口返回的是 {encrypt:true, data:<base64>} 整个报文，
                            // 而 decryptData() 只接受里面的 base64 字符串，直接传报文会让 crypto-js 报
                            // "t.indexOf is not a function"（iOS 上就是这条报错）。
                            var dd = (raw && raw.encrypt && window.EncryptUtils)
                                ? window.EncryptUtils.decryptPacket(raw) : raw;
                            bd = {lat: dd.bd09_lat, lng: dd.bd09_lng};
                            this._myGeoBd09 = bd;
                        }
                    } catch (e) { /* 定位换算失败不影响范围展示 */ }
                }
                if (bd) {
                    var myPt = new NS.Point(bd.lng, bd.lat);
                    pts.push(myPt);
                    var mk = new NS.Marker(myPt);
                    map.addOverlay(mk); this._myGeoMarkers.push(mk);
                    var tk = new NS.Label('我的位置', {offset: new NS.Size(30, -22), color: '#409eff'});
                    map.addOverlay(tk); this._myGeoMarkers.push(tk);
                }
            }
            // 视野：用户点过某个打卡点就锁定该点，否则把「我」和所有打卡点都框进来
            var focus = (this._myGeoFocusIndex >= 0) ? (ranges || [])[this._myGeoFocusIndex] : null;
            if (focus && focus.bd09_lat != null && focus.bd09_lng != null) {
                map.centerAndZoom(new NS.Point(focus.bd09_lng, focus.bd09_lat), 17);
            } else if (pts.length === 1) {
                map.centerAndZoom(pts[0], 15);
            } else if (pts.length > 1) {
                map.setViewport(pts);
            }
            setTimeout(function () { try { if (map.checkResize) map.checkResize(); } catch (e) {} }, 60);
        } catch (e) {
            console.warn('打卡范围地图渲染失败', e);
            // 同上：百度命名空间/覆盖物类还没注册完时也会抛 "undefined is not a constructor"，
            // 这是「还没准备好」，稍后重绘即可（不必给用户看错误，也不必重新加载脚本）
            if (this._isNsHalfLoadedError(e) && (this._myGeoRetry || 0) < 6) {
                this._myGeoRetry = (this._myGeoRetry || 0) + 1;
                var self2 = this;
                setTimeout(function () {
                    if (self2._geoMapReady()) self2._drawMyGeoMap(ranges, pos);
                }, 400);
                return;
            }
            this._myGeoFallback('<i class="fas fa-exclamation-triangle" style="color:#e6a23c;"></i> '
                + '地图渲染失败：' + this._escape((e && e.message) || '未知原因')
                + '。请在上方列出的打卡点范围内打卡（半径内的任意一点均可）。');
        }
    }

    // 底部打卡点标识：点击直接把地图定位到该打卡点
    _renderMyGeoPoints(ranges) {
        var wrap = document.getElementById('myGeoPoints');
        var listEl = document.getElementById('myGeoList');
        if (!wrap) return;
        var self = this;
        if (!ranges || !ranges.length || !this._geoMapReady()) {
            wrap.style.display = 'none';
            wrap.innerHTML = '';
            return;
        }
        if (listEl) listEl.style.display = 'none';   // 有地图就不再重复文字清单
        var inside = this._myGeoInsideName || '';
        wrap.style.display = 'flex';
        wrap.innerHTML = ranges.map(function (r, i) {
            var name = r.name || ('打卡点' + (i + 1));
            var hit = !!(inside && name === inside);
            var active = (i === self._myGeoFocusIndex);
            return '<button type="button" class="my-geo-chip' + (hit ? ' hit' : '') + (active ? ' active' : '')
                + '" onclick="attendanceApp._focusMyGeoPoint(' + i + ')" title="点击定位到该打卡点">'
                + '<i class="fas fa-location-dot"></i>' + self._escape(name)
                + '<span class="my-geo-chip-sub">' + (r.radius || 0) + '米</span>'
                + (hit ? '<span class="my-geo-chip-sub">当前在此</span>' : '')
                + '</button>';
        }).join('');
    }

    // 点击底部打卡点标识 → 地图直接定位到该点
    _focusMyGeoPoint(i) {
        var r = (this._myGeoRanges || [])[i];
        if (!r) return;
        this._myGeoFocusIndex = i;
        this._renderMyGeoPoints(this._myGeoRanges);
        var NS = this._geoMapNS();
        if (this._myGeoMap && NS && r.bd09_lat != null && r.bd09_lng != null) {
            try { if (this._myGeoMap.checkResize) this._myGeoMap.checkResize(); } catch (e) { /* 忽略 */ }
            this._myGeoMap.centerAndZoom(new NS.Point(r.bd09_lng, r.bd09_lat), 17);
        }
        this._drawMyGeoMap(this._myGeoRanges, this._myGeoPos);
    }

    // 打卡范围卡片全屏/退出全屏（CSS 模拟，兼容移动端/iOS，不用 Fullscreen API）
    _toggleMyGeoFullscreen(btn) {
        var card = document.getElementById('myGeoCard');
        if (!card) return;
        var isFs = card.classList.toggle('geo-fs');
        var icon = (btn && btn.querySelector) ? btn.querySelector('i') : null;
        if (icon) icon.className = isFs ? 'fas fa-compress' : 'fas fa-expand';
        if (btn) btn.title = isFs ? '退出全屏（Esc）' : '全屏查看打卡范围';
        this._myGeoFullscreenOn = isFs;
        this._refreshMyGeoMapLayout();
    }

    _exitMyGeoFullscreen() {
        if (!this._myGeoFullscreenOn) return;
        this._toggleMyGeoFullscreen(document.getElementById('myGeoFsBtn'));
    }

    // 卡片尺寸变化（全屏切换 / 旋转屏幕）后重算地图画布，否则地图仍是旧尺寸
    _refreshMyGeoMapLayout() {
        var self = this;
        setTimeout(function () {
            if (self._myGeoMap && self._myGeoMap.checkResize) {
                try { self._myGeoMap.checkResize(); } catch (e) { /* 忽略 */ }
            }
        }, 150);
    }

    // 兼容旧调用名
    async loadGeoHint() { return this.refreshMyGeo(); }

    async loadToday() {
        try {
            const data = await this.apiGet(OA_API_URL + '/attendance/today/');
            this.loadGeoHint();
            const statusEl = document.getElementById('todayStatus');
            const clockInBtn = document.getElementById('clockInBtn');
            const clockOutBtn = document.getElementById('clockOutBtn');
            if (data.has_clock_in) {
                clockInBtn.disabled = true;
                clockInBtn.classList.add('clocked');
                clockInBtn.innerHTML = '<i class="fas fa-check-circle"></i> 已打卡';
            } else {
                clockInBtn.disabled = false;
                clockInBtn.classList.remove('clocked');
                clockInBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡';
            }

            var clockOutCount = data.clock_out_count || 0;
            var clockOutLimit = data.clock_out_limit || 3;
            var shiftType = data.shift_type || 'day';
            var isNight = shiftType === 'night';
            var canClockOut = data.has_clock_in || data.has_pending_clock_out;
            if (data.has_clock_out) {
                clockOutBtn.classList.add('clocked');
                if (clockOutCount >= clockOutLimit) {
                    clockOutBtn.disabled = true;
                    clockOutBtn.innerHTML = '<i class="fas fa-check-circle"></i> 已打' + clockOutCount + '次（上限）';
                } else {
                    clockOutBtn.disabled = false;
                    clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡（' + clockOutCount + '/' + clockOutLimit + '）';
                }
            } else if (canClockOut) {
                clockOutBtn.disabled = false;
                clockOutBtn.classList.remove('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            } else {
                clockOutBtn.disabled = true;
                clockOutBtn.classList.remove('clocked');
                clockOutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            }

            if (data.has_clock_out) {
                statusEl.textContent = '✅ ' + (isNight ? '夜班' : '今日') + '考勤已完成';
            } else if (canClockOut) {
                statusEl.textContent = '⏳ ' + (isNight ? '夜班' : '') + '已上班打卡，等待下班打卡';
            } else {
                statusEl.textContent = '📋 今日尚未打卡';
            }

            var shiftBadge = document.getElementById('todayShiftBadge');
            if (shiftBadge) {
                shiftBadge.style.display = 'inline-flex';
                shiftBadge.textContent = isNight ? '🌙 夜班' : '☀ 白班';
                shiftBadge.className = 'shift-badge ' + shiftType;
            }

            // 补卡与下班打卡次数提示
            this._makeupUsed = data.makeup_used || 0;
            this._makeupAllowance = (data.makeup_allowance != null) ? data.makeup_allowance : 3;
            this._makeupEnabled = !!data.makeup_enabled;
            var makeupInfoEl = document.getElementById('todayMakeupInfo');
            if (makeupInfoEl) {
                if (data.makeup_enabled) {
                    var coInfo = clockOutCount > 0 ? ' · 今日下班打卡 ' + clockOutCount + '/' + clockOutLimit + ' 次' : '';
                    makeupInfoEl.innerHTML = '<i class="fas fa-edit"></i> 本月补卡剩余 <b>' + (data.makeup_remaining || 0) + '</b> 次' + coInfo;
                } else {
                    makeupInfoEl.innerHTML = '<i class="fas fa-edit"></i> 未开启补卡功能';
                }
            }
            var makeupBtn = document.getElementById('makeupBtn');
            if (makeupBtn) makeupBtn.style.display = data.makeup_enabled ? '' : 'none';
        } catch (e) {
            console.error('加载今日状态失败:', e);
        }
    }

    async loadStats() {
        try {
            const data = await this.apiGet(OA_API_URL + '/attendance/statistics/');
            document.getElementById('statTotalDays').textContent = data.total_days || 0;
            document.getElementById('statClockIn').textContent = data.clock_in_count || 0;
            document.getElementById('statClockOut').textContent = data.clock_out_count || 0;
            document.getElementById('statLate').textContent = data.late_count || 0;
            document.getElementById('statLate').style.color = (data.late_count || 0) > 0 ? '#f56c6c' : '';
            document.getElementById('statEarlyLeave').textContent = data.early_leave_count || 0;
            document.getElementById('statEarlyLeave').style.color = (data.early_leave_count || 0) > 0 ? '#e6a23c' : '';
        } catch (e) {
            console.error('加载统计失败:', e);
        }
    }

    async loadRecords(page) {
        if (page === undefined) page = this.currentPage;
        this.currentPage = page;
        const tbody = document.getElementById('attendanceTableBody');
        const pagination = document.getElementById('attendancePagination');
        if (!tbody) return;
        try {
            let url = OA_API_URL + '/attendance/?page=' + page + '&page_size=' + this.pageSize;
            if (this.searchKeyword) url += '&search=' + encodeURIComponent(this.searchKeyword);
            var tenantId = document.getElementById('attendanceFilterTenant') ? document.getElementById('attendanceFilterTenant').value : '';
            var deptId = document.getElementById('attendanceFilterDepartment') ? document.getElementById('attendanceFilterDepartment').value : '';
            var clockType = document.getElementById('attendanceFilterClockType') ? document.getElementById('attendanceFilterClockType').value : '';
            if (tenantId) url += '&tenant_id=' + tenantId;
            if (deptId) url += '&org_dept_id=' + deptId;
            if (clockType) url += '&clock_type=' + clockType;
            const data = await this.apiGet(url);
            // console.log(data);
            this._renderRecords(data, tbody);
            this._renderPagination(data, pagination);
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:#909399;">加载失败: ' + e.message + '</td></tr>';
            pagination.style.display = 'none';
        }
    }

    onPageSizeChange(e) {
        this.pageSize = parseInt(e.target.value);
        this.loadRecords(1);
    }

    goToPage(t) {
        var input = document.getElementById('attendanceGotoInput');
        if (!input) return;
        var p = parseInt(input.value);
        if (isNaN(p) || p < 1) p = 1;
        if (p > t) p = t;
        this.loadRecords(p);
    }

    _renderRecords(data, tbody) {
        // Clear selection on page change
        if (this._selectedRecordIds) this._selectedRecordIds.clear();
        const rows = data.results || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:#909399;">暂无打卡记录</td></tr>';
            this._updateExportPrintButtons();
            return;
        }
        const statusMap = { 'normal': '正常', 'late': '迟到', 'early_leave': '早退' };
        const defaultAvatar = '/static/images/default-avatar.png';
        tbody.innerHTML = rows.map(function(r) {
            const st = r.status || 'normal';
            const avatar = r.avatar_url || defaultAvatar;
            var checked = attendanceApp._selectedRecordIds && attendanceApp._selectedRecordIds.has(r.id) ? 'checked' : '';
            return '<tr style="cursor:pointer;">'
                + '<td><input type="checkbox" class="record-cb" data-id="' + r.id + '" ' + checked + ' onchange="event.stopPropagation();attendanceApp._toggleRecord(' + r.id + ', this.checked)"></td>'
                + '<td><div style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" alt="" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">'
                + '<span>' + attendanceApp._escape(r.user_name || '') + '</span></div></td>'
                + '<td>' + attendanceApp._escape(r.department_name || '-') + '</td>'
                + '<td>' + (r.date || '-') + '</td>'
                + '<td><span class="badge badge-info">' + (r.clock_type_display || r.clock_type) + '</span></td>'
                + '<td>' + attendanceApp._formatTime(r.clock_time) + '</td>'
                + '<td><span class="status-badge ' + st + '">' + (statusMap[st] || st) + '</span></td>'
                + '<td onclick="event.stopPropagation();attendanceApp.showDetail(' + r.id + ')">' + (r.location || '-') + (r.bd09_latitude ? ' <i class="fas fa-map-marker-alt" style="color:#f56c6c;font-size:11px;" title="已标记地图位置"></i>' : '') + '</td>'
                + '<td>' + (r.device || '-') + '</td>'
                + '<td><button class="action-btn" onclick="event.stopPropagation();attendanceApp.showDetail(' + r.id + ')" title="详情"><i class="fas fa-eye"></i></button></td></tr>';
        }).join('');
    }

    _renderPagination(data, container) {
        if (!data.total_pages || data.total_pages <= 1) { container.style.display = 'none'; return; }
        container.style.display = 'flex';
        const p = data.page, t = data.total_pages;
        let html = '<div class="oa-pagination-bar">'
            + '<span class="oa-pagination-total">共 ' + data.count + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<div class="oa-pagination-page-size"><span>每页</span><select onchange="attendanceApp.onPageSizeChange(event)">'
            + '<option value="10" ' + (this.pageSize === 10 ? 'selected' : '') + '>10</option>'
            + '<option value="20" ' + (this.pageSize === 20 ? 'selected' : '') + '>20</option>'
            + '<option value="50" ' + (this.pageSize === 50 ? 'selected' : '') + '>50</option>'
            + '</select><span>条</span></div>'
            + '<div class="oa-pagination-btns">';
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(1)" ' + (p <= 1 ? 'disabled' : '') + ' title="首页"><i class="fas fa-angle-double-left"></i></button>';
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(' + (p - 1) + ')" ' + (p <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
        for (let i = Math.max(1, p - 2); i <= Math.min(t, p + 2); i++) {
            html += '<button class="pagination-btn ' + (i === p ? 'active' : '') + '" onclick="attendanceApp.loadRecords(' + i + ')">' + i + '</button>';
        }
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(' + (p + 1) + ')" ' + (p >= t ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
        html += '<button class="pagination-btn" onclick="attendanceApp.loadRecords(' + t + ')" ' + (p >= t ? 'disabled' : '') + ' title="末页"><i class="fas fa-angle-double-right"></i></button>';
        html += '</div>'
            + '<div class="oa-pagination-goto"><span>跳至</span><input type="text" id="attendanceGotoInput" value="' + p + '" onkeydown="if(event.key===\'Enter\')attendanceApp.goToPage(' + t + ')"><span>页</span></div>'
            + '</div>';
        container.innerHTML = html;
    }

    async showDetail(id) {
        try {
            const d = await this.apiGet(OA_API_URL + '/attendance/' + id + '/');
            const statusMap = { 'normal': '正常', 'late': '迟到', 'early_leave': '早退' };
            const avatar = d.avatar_url || '/static/images/default-avatar.png';
            let html = '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label>用户</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + avatar + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + this._escape(d.user_name || '') + '</span></div>'
                + '<div class="detail-item"><label>部门</label><span>' + this._escape(d.department_name || '-') + '</span></div>'
                + '<div class="detail-item"><label>日期</label><span>' + (d.date || '-') + '</span></div>'
                + '<div class="detail-item"><label>类型</label><span>' + (d.clock_type_display || '-') + '</span></div>'
                + '<div class="detail-item"><label>时间</label><span>' + this._formatTime(d.clock_time) + '</span></div>'
                + '<div class="detail-item"><label>状态</label><span class="status-badge ' + (d.status || 'normal') + '">' + (statusMap[d.status] || d.status || '-') + '</span></div>'
                + '<div class="detail-item"><label>位置</label><span>' + (d.location || '-') + '</span></div>'
                + '<div class="detail-item"><label>经度</label><span>' + (d.longitude || '-') + '</span></div>'
                + '<div class="detail-item"><label>纬度</label><span>' + (d.latitude || '-') + '</span></div>'
                + '<div class="detail-item"><label>设备</label><span>' + (d.device || '-') + '</span></div>'
                + '<div class="detail-item"><label>IP地址</label><span>' + (d.ip_address || '-') + '</span></div>'
                + '</div>'
                + '<div class="detail-item"><label>User-Agent</label><span style="font-size:11px;word-break:break-all;">' + (d.user_agent || '-') + '</span></div>';

            const modal = document.getElementById('attendanceDetailModal');
            document.getElementById('attendanceDetailBody').innerHTML = html;

            // 尝试加载百度地图
            if (d.latitude && d.longitude) {
                var bdLat = d.bd09_latitude;
                var bdLng = d.bd09_longitude;
                var status = '状态：' + (statusMap[d.status] || d.status || '-')
                var clock_time = ' 打卡时间：' + this._formatTime(d.clock_time)
                if (bdLat && bdLng) {
                    this._showBaiduMap(bdLat, bdLng, status, clock_time);
                } else {
                    // 坐标未转换，调用后端转换接口
                    this._convertAndShowMap(id, status, clock_time);
                }
            }

            modal.style.display = 'flex';
            setTimeout(function() { modal.classList.add('show'); }, 10);
        } catch (e) {
            console.error('加载详情失败:', e);
        }
    }

    async _convertAndShowMap(id, status, clock_time) {
        try {
            var resp = await fetch(OA_API_URL + '/attendance/' + id + '/convert-coords/', {
                headers: TokenManager.getHeaders()
            });
            if (resp.ok) {
                var data = await resp.json();
                if (data.bd09_latitude && data.bd09_longitude) {
                    this._showBaiduMap(data.bd09_latitude, data.bd09_longitude, status, clock_time);
                }
            }
        } catch (e) {
            console.warn('坐标转换失败:', e);
        }
    }

    _showBaiduMap(bdLat, bdLng, status, clock_time) {
        var body = document.getElementById('attendanceDetailBody');
        if (!body) return;
        var iframeUrl = 'https://api.map.baidu.com/marker?location=' + bdLat + ',' + bdLng + '&title=考勤打卡点&content=' + status + clock_time +'&output=html&coord_type=bd09ll';
        var mapId = 'bdmap_' + Date.now();
        var mapDiv = document.createElement('div');
        mapDiv.style.cssText = 'margin-top:16px;border-radius:8px;overflow:hidden;border:1px solid var(--border-color,#dcdfe6);';
        mapDiv.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:500;padding:8px 12px;background:var(--bg-secondary,#f5f7fa);color:var(--text-secondary,#606266);border-bottom:1px solid var(--border-color,#ebeef5);">'
            + '<span><i class="fas fa-map-marker-alt" style="color:#f56c6c;"></i> 打卡位置地图</span>'
            + '<span onclick="attendanceApp._toggleMapFullscreen(\'' + mapId + '\')" style="cursor:pointer;padding:2px 8px;border-radius:4px;color:var(--primary-color,#409eff);font-size:12px;" title="全屏查看"><i class="fas fa-expand"></i></span></div>'
            + '<div id="' + mapId + '" style="position:relative;"><iframe src="' + iframeUrl + '" width="100%" height="320px" frameborder="0" style="display:block;" scrolling="no"></iframe></div>';
        body.appendChild(mapDiv);
    }

    _toggleMapFullscreen(mapId) {
        var container = document.getElementById(mapId);
        if (!container) return;
        var isFull = container.classList.contains('map-fullscreen');
        if (isFull) {
            container.classList.remove('map-fullscreen');
            container.querySelector('iframe').style.height = '320px';
            container.style.position = 'relative';
            container.style.zIndex = '';
            container.style.background = '';
            container.style.top = '';
            container.style.left = '';
            container.style.width = '';
            container.style.height = '';
            if (container._fsBtn) {
                container._fsBtn.remove();
                container._fsBtn = null;
            }
        } else {
            container.classList.add('map-fullscreen');
            var iframe = container.querySelector('iframe');
            iframe.style.height = window.innerHeight + 'px';
            container.style.position = 'fixed';
            container.style.zIndex = '9999';
            container.style.background = '#fff';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            var btn = document.createElement('div');
            btn.innerHTML = '<i class="fas fa-compress"></i> 退出全屏';
            btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:10000;padding:8px 16px;background:rgba(0,0,0,0.6);color:#fff;border-radius:6px;font-size:14px;cursor:pointer;';
            btn.onclick = function(e) { e.stopPropagation(); attendanceApp._toggleMapFullscreen(mapId); };
            document.body.appendChild(btn);
            container._fsBtn = btn;
        }
    }

    // 获取打卡位置：自动请求定位权限，失败时给出清晰提示（权限被拒→引导去设置；无法定位→可重试或继续无位置打卡）
    async _fetchLocation() {
        var result = { ok: true, abort: false, skip: false, latitude: null, longitude: null, location: '', reverse_geocoding: null };
        var pos = null;
        try {
            pos = await PermUtils.getLocation();
        } catch (err) {
            // 定位权限被拒绝 → 引导用户去系统设置开启
            if (err.code === 'PERMISSION_DENIED') {
                PermUtils.showPermissionGuide('location', '考勤打卡需要获取位置信息。');
                result.ok = false; result.abort = true; result.code = err.code; result.message = err.message;
                return result;
            }
            // 无法定位/超时 → 给出提示，可重试或继续无位置打卡
            var choice = await new Promise(function (resolve) {
                var overlay = document.createElement('div');
                overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);padding:20px;';
                overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:340px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.25);overflow:hidden;">'
                    + '<div style="display:flex;align-items:center;gap:8px;padding:14px 18px;background:#fdf6ec;border-bottom:1px solid #f5e6c8;font-size:15px;font-weight:600;color:#b88230;"><i class="fas fa-map-marker-alt" style="color:#e6a23c;"></i> 无法获取位置</div>'
                    + '<div style="padding:16px 18px;font-size:14px;color:#606266;line-height:1.7;">' + (err.message || '定位失败') + '。请检查手机系统定位服务是否开启，或移动到信号较好的位置后重试。</div>'
                    + '<div style="padding:12px 18px;border-top:1px solid #ebeef5;text-align:right;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">'
                    + '<button data-act="retry" style="padding:8px 16px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">重试</button>'
                    + '<button data-act="skip" style="padding:8px 16px;background:#fff;color:#606266;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:14px;">继续打卡（无位置）</button>'
                    + '</div></div>';
                document.body.appendChild(overlay);
                overlay.querySelector('[data-act="retry"]').onclick = function () { overlay.remove(); resolve('retry'); };
                overlay.querySelector('[data-act="skip"]').onclick = function () { overlay.remove(); resolve('skip'); };
                overlay.addEventListener('click', function (e) { if (e.target === overlay) { overlay.remove(); resolve('skip'); } });
            });
            if (choice === 'skip') {
                result.ok = true; result.skip = true;
                return result;
            }
            // 重试一次
            try {
                pos = await PermUtils.getLocation();
            } catch (err2) {
                result.ok = false; result.abort = true; result.code = err2.code; result.message = err2.message;
                return result;
            }
        }
        if (pos) {
            result.latitude = pos.latitude;
            result.longitude = pos.longitude;
        }
        // 通过后端接口进行百度地图反向地理编码
        try {
            var geoResp = await fetch('/api/oa/approval/geocode/?lat=' + result.latitude + '&lng=' + result.longitude, {
                headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('access_token') || '') }
            });
            if (geoResp.ok) {
                var geoData = await geoResp.json();
                if (geoData.location) result.location = geoData.location;
                if (geoData.reverse_geocoding) result.reverse_geocoding = geoData.reverse_geocoding;
            }
        } catch (geoErr) {
            console.warn('地理编码接口失败:', geoErr);
        }
        return result;
    }

    _getClientInfo() {
        var ip = '';
        var ua = navigator.userAgent || '';
        return { ip: ip, userAgent: ua };
    }

    async clockIn() {
        const btn = document.getElementById('clockInBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
        try {
            var loc = await this._fetchLocation();
            if (loc.abort) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡'; return; }
            var info = this._getClientInfo();
            var data = { device: this._getDeviceInfo(), user_agent: info.userAgent };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;
            var result = await this.apiPost(OA_API_URL + '/attendance/clock-in/', data);
            if (result && result.skip) {
                this.showToast(result.error || '该时段无需打卡', false);
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> 无需打卡';
                return;
            }
            await this.loadToday();
            await this.loadStats();
            await this.loadRecords(1);
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> 上班打卡';
            // 必须把后端原因展示出来：指定区域打卡未通过（不在范围内/无定位）时会返回具体说明
            this.showToast(e.message || '打卡失败', true);
            console.error('打卡失败:', e);
        }
    }

    async clockOut() {
        const btn = document.getElementById('clockOutBtn');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打卡中...';
        try {
            var loc = await this._fetchLocation();
            if (loc.abort) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡'; return; }
            var info = this._getClientInfo();
            var data = { device: this._getDeviceInfo(), user_agent: info.userAgent };
            if (loc.latitude) data.latitude = loc.latitude;
            if (loc.longitude) data.longitude = loc.longitude;
            if (loc.location) data.location = loc.location;
            if (loc.reverse_geocoding) data.reverse_geocoding = loc.reverse_geocoding;
            var result = await this.apiPost(OA_API_URL + '/attendance/clock-out/', data);
            if (result && result.skip) {
                this.showToast(result.error || '该时段无需打卡', false);
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-check-circle"></i> 无需打卡';
                return;
            }
            await this.loadToday();
            await this.loadStats();
            await this.loadRecords(1);
        } catch (e) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> 下班打卡';
            this.showToast(e.message || '打卡失败', true);
            console.error('打卡失败:', e);
        }
    }

    async openMakeupModal() {
        var now = new Date();
        this._mkYear = now.getFullYear();
        this._mkMonth = now.getMonth() + 1;
        var dateHidden = document.getElementById('makeupDate');
        if (dateHidden) dateHidden.value = '';
        this._mkSelectedDate = null;
        this._mkDays = [];
        // 加载本月考勤日历，用于高亮迟到/早退与漏卡日期
        try {
            var cdata = await this.apiGet(OA_API_URL + '/attendance/calendar-stats/?year=' + this._mkYear + '&month=' + this._mkMonth);
            this._mkDays = (cdata && cdata.days) || [];
            this._mkCfgTime = (cdata && cdata.config_time) || null;  // {clock_in, clock_out, shift_type}
        } catch (e) { /* 高亮加载失败不影响补卡 */ }
        this.renderMakeupCalendar();
        var used = this._makeupUsed || 0;
        var allowance = (this._makeupAllowance != null) ? this._makeupAllowance : 3;
        var tip = document.getElementById('makeupRemainingTip');
        if (tip) {
            tip.innerHTML = '<i class="fas fa-info-circle"></i> 本月已用补卡 <b>' + used + '</b> / ' + allowance + ' 次，剩余 <b>' + Math.max(0, allowance - used) + '</b> 次';
        }
        document.getElementById('attendanceMakeupModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('attendanceMakeupModal').classList.add('show');
        }, 10);
    }

    // 渲染补卡日历：仅当日及之前「迟到/早退（琥珀）」「漏卡（红）」可点选；
    // 正常打卡/未来/休息日/节假日/请假日不可选；未获取到考勤数据时全部置灰并提示。
    renderMakeupCalendar() {
        var grid = document.getElementById('makeupCalGrid');
        var legend = document.getElementById('makeupCalLegend');
        var hint = document.getElementById('makeupCalHint');
        if (!grid) return;
        var ct = document.getElementById('makeupClockType') ? document.getElementById('makeupClockType').value : 'clock_in';
        var y = this._mkYear, month = this._mkMonth;
        var now = new Date();
        var todayStr = y + '-' + String(month).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var dataOk = !!(this._mkDays && this._mkDays.length);
        var cfgT = this._mkCfgTime || {};
        var shiftNight = cfgT.shift_type === 'night';
        var nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var typeTime = ct === 'clock_in' ? (cfgT.clock_in || '09:00') : (cfgT.clock_out || '18:00');
        if (hint) {
            if (!dataOk) {
                hint.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 未获取到考勤数据，暂无法选择补卡日期，请刷新后重试';
                hint.style.background = '#fdf6ec';
                hint.style.color = '#e6a23c';
            } else {
                hint.innerHTML = '<i class="fas fa-info-circle"></i> 可选择今日及之前的「迟到/早退」或「漏卡」日期（休息日/节假日/请假日除外）；今日漏打的' + (ct === 'clock_in' ? '上班卡' : '下班卡') + '在打卡时间 ' + typeTime + ' 过后也可补，点击高亮日期选择';
                hint.style.background = '#ecf5ff';
                hint.style.color = '#409eff';
            }
        }
        var week = ['日', '一', '二', '三', '四', '五', '六'];
        var html = week.map(function (w) {
            return '<div style="text-align:center;font-size:11px;color:var(--text-light,#909399);padding:2px 0;">' + w + '</div>';
        }).join('');
        var firstDay = new Date(y, month - 1, 1).getDay();
        var dim = new Date(y, month, 0).getDate();
        for (var i = 0; i < firstDay; i++) html += '<div></div>';
        for (var day = 1; day <= dim; day++) {
            var ds = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            var info = {};
            (this._mkDays || []).forEach(function (x) { if (x.date === ds) info = x; });
            var rec = ct === 'clock_in' ? (info.clock_in || null) : (info.clock_out || null);
            var recStatus = rec ? rec.status : '';
            var isFuture = info.day_status === 'future';
            var isRest = info.day_status === 'rest' || info.day_status === 'leave';
            // 今日漏卡：该卡配置打卡时间已过才可补（夜班下班卡属次日，不在今日补）
            var todayMissOk = (ds === todayStr) && !rec
                && !(shiftNight && ct === 'clock_out')
                && (nowHM >= typeTime);
            // 严格按规则判定：必须有考勤数据且为迟到/早退或漏卡才可选择，其余日期一律不可选
            var hasInfo = !!info.day_status;
            var eligible = false, kind = '';
            if (dataOk && hasInfo && !isFuture && !isRest) {
                if (!rec) { eligible = ds === todayStr ? todayMissOk : true; kind = 'miss'; }
                else if (recStatus === 'late' || recStatus === 'early_leave') { eligible = true; kind = 'late'; }
            }
            var isSel = this._mkSelectedDate === ds;
            var bg = eligible ? (kind === 'late' ? '#fdf6ec' : '#fef0f0') : '#f5f7fa';
            var color = eligible ? '#303133' : (isFuture ? '#c0c4cc' : '#909399');
            var border = isSel ? '2px solid #409eff' : '1px solid #ebeef5';
            var cursor = eligible ? 'pointer' : 'not-allowed';
            var mark = '';
            if (eligible && kind === 'late') mark = '<i class="fas fa-edit" style="font-size:8px;color:#e6a23c;display:block;line-height:1;"></i>';
            else if (eligible && kind === 'miss') mark = '<i class="fas fa-exclamation" style="font-size:8px;color:#f56c6c;display:block;line-height:1;"></i>';
            html += '<div class="makeup-day' + (isSel ? ' selected' : '') + '" data-date="' + ds + '"'
                + (eligible ? ' onclick="attendanceApp.selectMakeupDate(\'' + ds + '\')"' : '')
                + ' title="' + (eligible ? (kind === 'late' ? '迟到/早退，可补卡' : '漏卡，可补卡') : '不可补卡') + '"'
                + ' style="cursor:' + cursor + ';border-radius:6px;padding:5px 2px;text-align:center;font-size:12px;border:' + border + ';background:' + bg + ';color:' + color + ';">'
                + day + mark
                + '</div>';
        }
        grid.innerHTML = html;
        if (legend) {
            legend.innerHTML = '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fef0f0;border:1px solid #fde2e2;vertical-align:-2px;margin-right:3px;"></span>漏卡可补</span>'
                + '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fdf6ec;border:1px solid #f5dab1;vertical-align:-2px;margin-right:3px;"></span>迟到/早退可补</span>'
                + '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#f5f7fa;vertical-align:-2px;margin-right:3px;"></span>正常/不可补</span>';
        }
        // 已选日期提示：将按考勤配置时间补卡
        var tipEl = document.getElementById('makeupTimeTip');
        if (tipEl) {
            if (this._mkSelectedDate) {
                var tipT = ct === 'clock_in' ? (cfgT.clock_in || '09:00') : (cfgT.clock_out || '18:00');
                tipEl.innerHTML = '<i class="fas fa-clock" style="margin-right:4px;"></i> 将按考勤配置时间 <b>' + tipT + '</b> 补' + (ct === 'clock_in' ? '上班' : '下班') + '卡（' + this._mkSelectedDate + '）';
                tipEl.style.display = 'block';
            } else {
                tipEl.style.display = 'none';
            }
        }
    }

    selectMakeupDate(ds) {
        this._mkSelectedDate = ds;
        var dateHidden = document.getElementById('makeupDate');
        if (dateHidden) dateHidden.value = ds;
        this.renderMakeupCalendar();
    }

    closeMakeupModal() {
        var modal = document.getElementById('attendanceMakeupModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    }

    async submitMakeup() {
        var dateStr = document.getElementById('makeupDate') ? document.getElementById('makeupDate').value : '';
        var clockType = document.getElementById('makeupClockType') ? document.getElementById('makeupClockType').value : 'clock_in';
        if (!dateStr) { this.showToast('请选择补卡日期', true); return; }
        var btn = document.querySelector('#attendanceMakeupModal .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...'; }
        try {
            await this.apiPost(OA_API_URL + '/attendance/makeup/', { date: dateStr, clock_type: clockType });
            this.showToast('补卡成功', false);
            this.closeMakeupModal();
            await this.loadToday();
            await this.loadStats();
            await this.loadRecords(1);
        } catch (e) {
            this.showToast(e.message || '补卡失败', true);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> 确认补卡'; }
        }
    }

    search() {
        const el = document.getElementById('attendanceSearch');
        this.searchKeyword = el ? el.value.trim() : '';
        this.loadRecords(1);
    }

    _selectedRecordIds = null

    _getSelectedIds() {
        if (!this._selectedRecordIds) this._selectedRecordIds = new Set();
        return this._selectedRecordIds;
    }

    _toggleRecord(id, checked) {
        var set = this._getSelectedIds();
        if (checked) set.add(id); else set.delete(id);
        var selectAll = document.getElementById('attendanceSelectAll');
        if (selectAll) {
            var total = document.querySelectorAll('.record-cb').length;
            var checkedCount = document.querySelectorAll('.record-cb:checked').length;
            selectAll.checked = total > 0 && checkedCount === total;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < total;
        }
        this._updateExportPrintButtons();
    }

    _updateExportPrintButtons() {
        var count = this._selectedRecordIds ? this._selectedRecordIds.size : 0;
        var exportBtn = document.getElementById('attendanceExportBtn');
        var printBtn = document.getElementById('attendancePrintBtn');
        if (exportBtn) exportBtn.style.opacity = count > 0 ? '' : '0.4';
        if (printBtn) printBtn.style.opacity = count > 0 ? '' : '0.4';
    }

    _toggleSelectAll(checked) {
        document.querySelectorAll('.record-cb').forEach(function(cb) { cb.checked = checked; });
        var set = this._getSelectedIds();
        set.clear();
        if (checked) {
            document.querySelectorAll('.record-cb').forEach(function(cb) {
                var id = parseInt(cb.dataset.id);
                if (id) set.add(id);
            });
        }
        this._updateExportPrintButtons();
    }

    _loadFilterTenants() {
        var sel = document.getElementById('attendanceFilterTenant');
        if (!sel) return;
        fetch('/api/org/tenants/', { headers: TokenManager.getHeaders() }).then(function(resp) {
            return resp.ok ? resp.json() : {results: []};
        }).then(function(data) {
            var tenants = data.results || data || [];
            sel.innerHTML = '<option value="">全部企业</option>';
            tenants.forEach(function(t) {
                var opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.short_name || t.name;
                sel.appendChild(opt);
            });
        }).catch(function(e) { console.error(e); });
    }

    _loadFilterDepartments(tenantId) {
        var sel = document.getElementById('attendanceFilterDepartment');
        if (!sel) return;
        sel.innerHTML = '<option value="">全部部门</option>';
        if (!tenantId) return;
        fetch('/api/org/departments/?tenant_id=' + tenantId, { headers: TokenManager.getHeaders() }).then(function(resp) {
            return resp.ok ? resp.json() : {results: []};
        }).then(function(data) {
            var depts = data.results || data || [];
            var byParent = {};
            depts.forEach(function(d) {
                var pid = d.parent || 'root';
                if (!byParent[pid]) byParent[pid] = [];
                byParent[pid].push(d);
            });
            function renderChildren(parentId, depth) {
                var children = byParent[parentId] || [];
                children.forEach(function(d) {
                    var opt = document.createElement('option');
                    opt.value = d.id;
                    var prefix = '';
                    for (var k = 0; k < depth; k++) prefix += '— ';
                    opt.textContent = (depth > 0 ? prefix : '') + d.name;
                    sel.appendChild(opt);
                    renderChildren(d.id, depth + 1);
                });
            }
            renderChildren('root', 0);
        }).catch(function(e) { console.error(e); });
    }

    onFilterTenantChange() {
        var tenantId = document.getElementById('attendanceFilterTenant') ? document.getElementById('attendanceFilterTenant').value : '';
        this._loadFilterDepartments(tenantId);
        this.loadRecords(1);
    }

    exportRecords() {
        this._showExportPrintModal('export');
    }

    printRecords() {
        this._showExportPrintModal('print');
    }

    _showExportPrintModal(mode) {
        var self = this;
        var totalSelected = this._selectedRecordIds ? this._selectedRecordIds.size : 0;
        if (!totalSelected) {
            this.showAlert('提示', '请先选择要导出的打卡记录');
            return;
        }
        var fields = [
            {key:'user_name', label:'用户'},
            {key:'department_name', label:'部门'},
            {key:'date', label:'日期'},
            {key:'clock_type_display', label:'类型'},
            {key:'clock_time', label:'时间'},
            {key:'status', label:'状态'},
            {key:'location', label:'位置'},
            {key:'device', label:'设备'},
        ];
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
        var fieldHtml = fields.map(function(f, i) {
            return '<label style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;cursor:pointer;"><input type="checkbox" class="ef-field-cb" data-key="' + f.key + '" checked> ' + f.label + '</label>';
        }).join('');
        var isPrint = mode === 'print';
        var footerBtns = '<button class="ef-cancel" style="padding:8px 20px;border:1px solid #dcdfe6;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>';
        if (isPrint) {
            footerBtns += '<button class="ef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-print"></i> 打印</button>';
        } else {
            footerBtns += '<button class="ef-cloud" style="padding:8px 20px;background:#16a085;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-cloud-upload-alt"></i> 保存到网盘</button>'
                + '<button class="ef-confirm" style="padding:8px 20px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;"><i class="fas fa-download"></i> 导出到本地</button>';
        }
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:500px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,0.18);">'
            + '<div style="padding:16px 20px;border-bottom:1px solid #ebeef5;"><h3 style="margin:0;font-size:16px;"><i class="fas fa-' + (mode==='print'?'print':'download') + '"></i> ' + (mode==='print'?'打印':'导出') + ' 考勤记录</h3></div>'
            + '<div style="padding:16px 20px;"><p style="margin:0 0 12px;font-size:14px;color:#606266;">选择表格字段：</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + fieldHtml + '</div></div>'
            + '<div style="padding:12px 20px;border-top:1px solid #ebeef5;display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap;">' + footerBtns + '</div></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.ef-cancel').onclick = function() { overlay.remove(); };
        overlay.querySelector('.ef-confirm').onclick = function() {
            var checked = overlay.querySelectorAll('.ef-field-cb:checked');
            var selectedFields = Array.from(checked).map(function(cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showAlert('提示', '请至少选择一个字段'); return; }
            if (isPrint) self._doPrintRecords(selectedFields);
            else self._doExportRecords(selectedFields, 'local');
        };
        var cloudBtn = overlay.querySelector('.ef-cloud');
        if (cloudBtn) cloudBtn.onclick = function() {
            var checked = overlay.querySelectorAll('.ef-field-cb:checked');
            var selectedFields = Array.from(checked).map(function(cb) { return cb.dataset.key; });
            overlay.remove();
            if (!selectedFields.length) { self.showAlert('提示', '请至少选择一个字段'); return; }
            self._doExportRecords(selectedFields, 'cloud');
        };
    }

    _doPrintRecords(selectedFields) {
        var self = this;
        var tbody = document.getElementById('attendanceTableBody');
        if (!tbody) return;
        var trs = Array.from(tbody.querySelectorAll('tr')).filter(function(tr) { return tr.querySelector('.record-cb:checked'); });
        if (!trs.length) return;
        var gate = function () {
        var now = new Date();
        var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
            + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var fields = [
            {key:'user_name', label:'用户'},{key:'department_name', label:'部门'},{key:'date', label:'日期'},
            {key:'clock_type_display', label:'类型'},{key:'clock_time', label:'时间'},{key:'status', label:'状态'},
            {key:'location', label:'位置'},{key:'device', label:'设备'},
        ];
        var fieldLabels = {};
        fieldLabels['user_name'] = '用户'; fieldLabels['department_name'] = '部门';
        fieldLabels['date'] = '日期'; fieldLabels['clock_type_display'] = '类型';
        fieldLabels['clock_time'] = '时间'; fieldLabels['status'] = '状态';
        fieldLabels['location'] = '位置'; fieldLabels['device'] = '设备';
        var selSet = {}; selectedFields.forEach(function(k){selSet[k]=true;});
        var win = window.open('', '_blank', 'width=1000,height=800');
        if (!win) return;
        var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>考勤打卡记录</title>'
            + '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:20px;color:#333;}'
            + '.print-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}'
            + '.print-title{font-size:20px;font-weight:600;color:#409eff;}'
            + '.print-date{font-size:13px;color:#909399;}'
            + 'h2{text-align:center;margin-bottom:20px;color:#409eff;}'
            + 'table{width:100%;border-collapse:collapse;font-size:13px;}'
            + 'th,td{border:1px solid #ddd;padding:8px 10px;text-align:left;}'
            + 'th{background:#f5f7fa;font-weight:600;}'
            + 'tr:nth-child(even){background:#fafafa;}'
            + '.normal{color:#67c23a;}.late{color:#f56c6c;}.early_leave{color:#e6a23c;}'
            + '@media print{body{padding:10px;}button{display:none;}}'
            + '</style></head><body>'
            + '<div class="print-header"><div class="print-title">考勤打卡记录</div><div class="print-date">打印时间：' + dateStr + '</div></div>'
            + '<table><thead><tr>';
        var statusMap = {'normal':'正常','late':'迟到','early_leave':'早退'};
        // Header
        fields.forEach(function(f) {
            if (selSet[f.key]) html += '<th>' + f.label + '</th>';
        });
        html += '</tr></thead><tbody>';
        trs.forEach(function(tr) {
            var tds = tr.querySelectorAll('td');
            if (tds.length < 10) return;
            html += '<tr>';
            fields.forEach(function(f) {
                if (!selSet[f.key]) return;
                if (f.key === 'status') {
                    var stText = tds[6].textContent || '';
                    var stKey = stText.toLowerCase().replace(/\s/g,'');
                    html += '<td class="' + stKey + '">' + (statusMap[stKey] || stText) + '</td>';
                } else {
                    var idx = {'user_name':1,'department_name':2,'date':3,'clock_type_display':4,'clock_time':5,'location':7,'device':8}[f.key];
                    html += '<td>' + (tds[idx] ? (tds[idx].textContent || '') : '') + '</td>';
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table><div style="text-align:center;margin-top:20px;">'
            + '<button onclick="window.print()" style="padding:8px 24px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">打印</button> '
            + '<button onclick="window.close()" style="padding:8px 24px;background:#fff;color:#606266;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:14px;">返回 / 关闭</button>'
            + '</div></body></html>';
        // 🔧 打印默认叠加水印（由管理控制台「打印时添加水印」开关控制）
        var wm = (window.WatermarkManager && WatermarkManager.buildPrintWatermark) ? WatermarkManager.buildPrintWatermark() : null;
        if (wm) html = html.replace('</head>', '<style>' + wm.css + '</style></head>').replace('</body>', wm.html + '</body>');
        win.document.write(html);
        win.document.close();
        };
        // 🔧 打印权限门：先上报打印并校验「允许打印」权限，无权限则拦截
        if (window.WatermarkManager && WatermarkManager.reportPrint) {
            WatermarkManager.reportPrint({page: 'attendance', target_type: 'attendance_record', count: trs.length}).then(function (res) {
                if (res && res.allowed === false) {
                    self.showToast('您没有打印权限，请联系管理员开通', true);
                    return;
                }
                gate();
            });
        } else {
            gate();
        }
    }

    _doExportRecords(selectedFields, target) {
        var self = this;
        var token = localStorage.getItem('access_token');
        if (!token) { this.showAlert('提示', '登录已过期，请重新登录'); return; }
        var url = OA_API_URL + '/attendance/export/?';
        var params = [];
        var ids = Array.from(this._getSelectedIds());
        if (ids.length) params.push('record_ids=' + ids.join(','));
        if (selectedFields && selectedFields.length) params.push('fields=' + selectedFields.join(','));
        url += params.join('&');
        // Generate filename with current datetime

        var now = new Date();
        var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');

        var filename = '考勤记录_' + dateStr + '_' + timeStr + '.xlsx';
        if (this.searchKeyword) {
            filename = '考勤记录_' + this.searchKeyword +'_' + dateStr + '_' + timeStr + '.xlsx';
        }

        if (target === 'cloud') {
            fetch(url, {
                headers: { 'Authorization': 'Bearer ' + token }
            }).then(function(resp) {
                if (!resp.ok) { throw new Error('导出失败 ' + resp.status); }
                return resp.blob();
            }).then(function(blob) {
                var file = new File([blob], filename, {type: blob.type || 'text/csv'});
                return Utils.uploadToCloud(file, null);
            }).then(function() {
                self.showAlert('成功', '已保存到网盘');
            }).catch(function(err) {
                self.showAlert('错误', '保存到网盘失败：' + err.message);
            });
        } else {
            fetch(url, {
                headers: { 'Authorization': 'Bearer ' + token }
            }).then(function(resp) {
                if (!resp.ok) { throw new Error('导出失败 ' + resp.status); }
                return resp.blob();
            }).then(function(blob) {
                var link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            }).catch(function(err) {
                self.showAlert('错误', '导出失败：' + err.message);
            });
        }
    }

    // ==================== 优雅的提示对话框 ====================

    // ==================== 优雅的提示对话框 ====================
    showAlert(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-info-circle"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn confirm">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = () => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve();
            };
            dialog.querySelector('.confirm').addEventListener('click', close);
            dialog.querySelector('.close-btn').addEventListener('click', close);
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close();
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    // ==================== 优雅的确认对话框 ====================
    showConfirmDialog(title, message, type) {
        if (type === undefined) type = 'confirm';
        return new Promise((resolve) => {
            const iconMap = {danger: 'exclamation-triangle', confirm: 'check-circle'};
            const icon = iconMap[type] || 'question-circle';
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-' + icon + '"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn cancel">取消</button>'
                + '<button class="confirm-dialog-btn ' + type + '">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve(result);
            };
            dialog.querySelector('.cancel').addEventListener('click', () => close(false));
            dialog.querySelector('.' + type).addEventListener('click', () => close(true));
            dialog.querySelector('.close-btn').addEventListener('click', () => close(false));
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close(false);
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    showToast(message, isError) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        const icon = isError ? 'fa-exclamation-circle' : 'fa-check-circle';
        const title = isError ? '错误' : '成功';
        const color = isError ? '#f56c6c' : '#67c23a';
        toast.innerHTML = '<div class="toast-content" style="border-left-color:' + color + ';">'
            + '<div class="toast-icon"><i class="fas ' + icon + '" style="color:' + color + ';"></i></div>'
            + '<div><div class="toast-title">' + title + '</div>'
            + '<div class="toast-text">' + this._escape(message) + '</div></div></div>';
        toast.classList.remove('show');
        void toast.offsetHeight;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    _escape(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _getDeviceInfo() {
        const ua = navigator.userAgent || '';
        if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
        if (ua.includes('Android')) return 'Android';
        if (ua.includes('Windows')) return 'Windows';
        if (ua.includes('Mac')) return 'macOS';
        if (ua.includes('Linux')) return 'Linux';
        return ua.substring(0, 50);
    }

    _formatTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }

    // ──────── 考勤配置 ────────

    resetFilters() {
        var searchEl = document.getElementById('attendanceSearch');
        if (searchEl) searchEl.value = '';
        this.searchKeyword = '';
        var tenantFilter = document.getElementById('attendanceFilterTenant');
        if (tenantFilter) tenantFilter.value = '';
        var deptFilter = document.getElementById('attendanceFilterDepartment');
        if (deptFilter) deptFilter.value = '';
        var clockTypeFilter = document.getElementById('attendanceFilterClockType');
        if (clockTypeFilter) clockTypeFilter.value = '';
        this.loadRecords(1);
    }

    async openConfigModal() {
        var ut = localStorage.getItem('user_type');
        // 普通用户无考勤配置权限，不开放配置模态框
        if (ut !== 'admin' && ut !== 'super_admin') {
            if (this.showToast) this.showToast('您没有考勤配置权限', true);
            return;
        }
        var isSuperAdmin = ut === 'super_admin';
        this._attIsSuperAdmin = isSuperAdmin;
        this._configEditKey = null;
        this._configDeleteId = null;
        this._attConfigUser = null;
        // 普通管理员：只能配置本部门/个人考勤，集团与子公司配置入口隐藏；默认切到部门
        this._configAttType = isSuperAdmin ? 'global' : 'department';
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) {
            var t = c.getAttribute('data-att-type');
            c.style.display = (isSuperAdmin || t === 'department' || t === 'user') ? '' : 'none';
        });
        this._selectAttConfigType(this._configAttType);
        // 地图容器此刻才可见，等模态框显示后再初始化/校正尺寸
        var self = this;
        setTimeout(function () { self._ensureGeoMap(); }, 260);
        // Esc 退出全屏（用户端打卡范围卡片 / 配置端范围圈选），只绑定一次
        if (!this._geoEscBound) {
            this._geoEscBound = true;
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    self._exitMyGeoFullscreen();
                    self._exitGeoFullscreen();
                }
            });
        }
        // 配置模态框打开时收起用户端范围卡片的全屏，避免两个全屏层叠
        this._exitMyGeoFullscreen();
        document.getElementById('attendanceConfigForm').style.display = 'none';
        document.getElementById('attendanceConfigFooter').style.display = 'none';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'block';
        var rightSel = document.getElementById('attConfigSubTenantSelect');
        if (rightSel) rightSel.innerHTML = '<option value="">请选择子公司</option>';
        await this._loadAttSubTenants();
        await this._loadAttConfigList();
        await this._loadAttDepts();
        document.getElementById('attendanceConfigModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('attendanceConfigModal').classList.add('show');
        }, 10);
    }

    _selectAttConfigType(type) {
        this._configAttType = type;
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = type;
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
        var card = document.querySelector('.config-type-card[data-att-type="' + type + '"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('attConfigSubTenantRow').style.display = type === 'sub_tenant' ? 'block' : 'none';
        document.getElementById('attConfigDeptRow').style.display = type === 'department' ? 'block' : 'none';
        document.getElementById('attConfigUserRow').style.display = type === 'user' ? 'block' : 'none';
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        document.getElementById('attendanceMakeupAllowance').value = 3;
        document.getElementById('attendanceClockOutLimit').value = 3;
        this._setShiftType('day');
        document.getElementById('attendanceConfigForm').style.display = 'block';
        document.getElementById('attendanceConfigFooter').style.display = 'flex';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'none';
        this._renderConfigMeta(null);
        this._toggleClockIn();
        this._toggleClockOut();
        if (type === 'user') {
            this._attConfigUser = null;
            var userSearch = document.getElementById('attConfigUserSearch');
            if (userSearch) userSearch.value = '';
            var userRes = document.getElementById('attConfigUserRes');
            if (userRes) userRes.style.display = 'none';
            this._renderAttUserTag();
        }
        this._loadConfigForType(type);
    }

    // 配置模态框底部：展示该配置的最后更新时间和操作人（新建/未保存时隐藏）
    _renderConfigMeta(cfg) {
        var el = document.getElementById('attConfigMeta');
        if (!el) return;
        if (!cfg) { el.style.display = 'none'; el.innerHTML = ''; return; }
        var time = (typeof Utils !== 'undefined' && Utils.formatDateTime)
            ? Utils.formatDateTime(cfg.updated_at) : (cfg.updated_at || '-');
        var who = cfg.updated_by_name || '—';
        el.innerHTML = '<i class="fas fa-history"></i>最后更新：' + this._escape(time)
            + '<span class="config-meta-sep">|</span>操作人：' + this._escape(who);
        el.style.display = 'block';
    }

    async _loadConfigForType(type) {
        try {
            var url = OA_API_URL + '/attendance/attendance-configs/';
            if (type === 'user') url = OA_API_URL + '/attendance/user-attendance-configs/';
            var resp = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!resp.ok) return;
            var json = await resp.json();
            var configs = json.results || [];
            var cfg = null;
            // Match using the actual selected dropdown values
            var selSubTenant = document.getElementById('attConfigSubTenantSelect').value;
            var selDept = document.getElementById('attendanceConfigDept').value;
            var selUser = this._attConfigUser ? String(this._attConfigUser.id) : '';
            configs.forEach(function(c) {
                var cSt = c.sub_tenant ? String(c.sub_tenant) : '';
                var cDept = c.department ? String(c.department) : '';
                var cUser = c.user ? String(c.user) : '';
                if (type === 'global' && !c.sub_tenant && !c.department) { cfg = c; }
                else if (type === 'sub_tenant' && c.sub_tenant && !c.department) {
                    if (selSubTenant && cSt === selSubTenant) cfg = c;
                }
                else if (type === 'department' && c.department) {
                    if (selDept && cDept === selDept) cfg = c;
                }
                else if (type === 'user' && c.user) {
                    if (selUser && cUser === selUser) cfg = c;
                }
            });
            if (cfg) {
                this._configEditKey = cfg.id;
                this._configDeleteId = cfg.id;
                document.getElementById('attendanceConfigDeleteBtn').style.display = '';
                var deptSel = document.getElementById('attendanceConfigDept');
                if (deptSel) deptSel.value = cfg.department || '';
                var stSel = document.getElementById('attConfigSubTenantSelect');
                if (stSel) stSel.value = cfg.sub_tenant || '';
                if (cfg.user) {
                    this._attConfigUser = {id: cfg.user, name: cfg.user_name || '', avatar: cfg.avatar_url || '', department: cfg.department_name || '', position: cfg.position || ''};
                    this._renderAttUserTag();
                }
                document.getElementById('attendanceClockInEnabled').checked = cfg.clock_in_enabled !== false;
                document.getElementById('attendanceClockOutEnabled').checked = cfg.clock_out_enabled !== false;
                if (cfg.clock_in_time) {
                    document.getElementById('attendanceClockInTime').value = cfg.clock_in_time.substring(0, 5);
                } else {
                    document.getElementById('attendanceClockInTime').value = '09:00';
                }
                if (cfg.clock_out_time) {
                    document.getElementById('attendanceClockOutTime').value = cfg.clock_out_time.substring(0, 5);
                } else {
                    document.getElementById('attendanceClockOutTime').value = '18:00';
                }
                document.getElementById('attendanceMakeupAllowance').value = (cfg.makeup_allowance != null) ? cfg.makeup_allowance : 3;
                document.getElementById('attendanceClockOutLimit').value = (cfg.clock_out_limit != null) ? cfg.clock_out_limit : 3;
                this._setShiftType(cfg.shift_type || 'day');
                this._toggleClockIn();
                this._toggleClockOut();
                // 考勤打卡范围（location_ranges_map 带 BD09，供地图绘制）
                this._setGeoRanges(cfg.location_ranges_map || cfg.location_ranges || []);
                if (type === 'global') {
                    this._setGeoSwitch(cfg.location_required === true);
                    this._setGeoVisible(cfg.location_config_visible === true);
                }
                this._renderConfigMeta(cfg);
            } else {
                // 该层级还没有配置：范围清空（留空即沿用上一层）
                this._setGeoRanges([]);
                if (type === 'global') this._setGeoSwitch(false);
                this._renderConfigMeta(null);
            }
            this._syncGeoSwitchVisibility(type);
            this._loadAttConfigList();
        } catch (e) {
            console.warn('加载配置失败', e);
        }
    }

    async _loadAttConfigSubTenantSelect() {
        // 已合并到 _loadAttSubTenants 中
    }

    // ==================== 考勤打卡范围（地图圈选） ====================
    // 说明：库里存 WGS84；百度地图给到/需要的是 BD09。前端只做「透传」——地图点击得到的 BD09
    // 原样交给后端换算保存，后端返回的 location_ranges_map 也已带 BD09 供地图直接画圆，
    // 因此坐标换算逻辑只存在于后端（utils/coord_transform.py）。

    // 开启百度自带的「鼠标侧」手势：拖动 / 惯性拖动 / 双击缩放 / 滚轮缩放。
    // 桌面端一直用百度自带实现——鼠标事件本来就可靠，而且它自带惯性拖拽与瓦片预取，
    // 比我们自己用 setCenter 逐帧平移顺滑得多（自己实现只用于手机上不可靠的触摸手势）。
    // 方法名逐个探测：存在就开启，不存在就跳过（避免整段初始化报错）。
    _enableMouseGestures(map) {
        if (!map) return;
        var features = ['enableDragging', 'enableInertialDragging',
                        'enableDoubleClickZoom', 'enableScrollWheelZoom'];
        features.forEach(function (fn) {
            try {
                if (typeof map[fn] === 'function') map[fn](true);
            } catch (e) { /* 该版本不支持则忽略 */ }
        });
    }

    // ==================== 触摸手势（自己实现，见下） ====================
    // 为什么触摸要自己实现：百度地图 JS API 3.0 在手机上其实是靠浏览器把触摸
    // 「合成鼠标事件」来实现拖动的，而 iOS 在手指持续拖动时不会再合成 mousemove；双指缩放又会被
    // 浏览器当成「缩放整个网页」抢走 —— 结果就是手机上手指在地图上既拖不动也捏不动。
    // 这里用 touch 事件自己算，并调用百度地图的公开接口来改变视野：
    //   单指拖动 = 平移；双指捏合 = 缩放。
    // 前置条件：容器 CSS 必须是 touch-action:none（见 attendance.html），浏览器才不会抢走手势。
    // 注意范围：**只接管触摸**。鼠标（桌面端）仍然交给百度自带拖动/滚轮缩放/双击缩放，
    //   —— 同时因为我们会在 touchmove 里 preventDefault（浏览器因此不会补发鼠标事件），
    //      百度那套基于鼠标事件的拖动在触摸时自然不会触发，两套逻辑不会叠加。
    // 只有确实拿到可用的平移/缩放接口时才接管；拿不到就返回 false，保持百度原样。
    _bindMapGestures(map, el) {
        if (!map || !el) return false;
        if (el.__gestureBound) return true;

        var canPan = typeof map.pointToPixel === 'function' && typeof map.pixelToPoint === 'function'
            && typeof map.getCenter === 'function' && typeof map.setCenter === 'function';
        var canZoom = typeof map.getZoom === 'function' && typeof map.setZoom === 'function';
        if (!canPan && !canZoom) return false;

        el.__gestureBound = true;
        var self = this;
        var MIN_ZOOM = 3, MAX_ZOOM = 19;
        var touchPts = [];      // 当前所有手指的位置
        var pinch = null;       // 捏合起始状态 {dist, zoom}
        var pinchMid = null;    // 上一帧双指中点（捏合时顺带跟随平移，手感更连续）

        // 只关掉百度自带的「双指缩放」：它与下面的捏合实现会叠加成两倍缩放速度。
        // 拖动（enableDragging）保持开启，供桌面端鼠标使用。
        try { if (canZoom && typeof map.disablePinchToZoom === 'function') map.disablePinchToZoom(); } catch (e) { /* 忽略 */ }

        var log2 = Math.log2 || function (v) { return Math.log(v) / Math.LN2; };
        var dist = function (a, b) {
            var dx = a.x - b.x, dy = a.y - b.y;
            return Math.sqrt(dx * dx + dy * dy);
        };
        var ptOf = function (t) { return {x: t.clientX, y: t.clientY}; };
        var midOf = function (a, b) { return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}; };
        // 标记「刚刚用地图手势动过」，供「点图设定打卡点圆心」处忽略拖动后的误触
        var markMoved = function () { self._mapGestureMovedAt = Date.now(); };

        // 平移：把地图中心反向移动同样的像素距离（手指往哪拖，地图往哪走）
        var panByPixels = function (dx, dy) {
            if (!canPan || (!dx && !dy)) return;
            try {
                var NS = self._geoMapNS ? self._geoMapNS() : null;
                var c = map.pointToPixel(map.getCenter());
                var p = (NS && typeof NS.Pixel === 'function')
                    ? new NS.Pixel(c.x - dx, c.y - dy) : {x: c.x - dx, y: c.y - dy};
                map.setCenter(map.pixelToPoint(p));
                markMoved();
            } catch (e) { /* 忽略 */ }
        };
        var zoomTo = function (z) {
            if (!canZoom) return;
            z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
            try {
                if (z !== map.getZoom()) { map.setZoom(z); markMoved(); }
            } catch (e) { /* 忽略 */ }
        };

        // ---- 触摸：记录当前手指与捏合状态 ----
        var syncTouches = function (e) {
            var ts = (e && e.touches) || [];
            touchPts = [];
            for (var i = 0; i < ts.length; i++) touchPts.push(ptOf(ts[i]));
            if (touchPts.length >= 2) {
                pinch = {dist: dist(touchPts[0], touchPts[1]),
                         zoom: (canZoom ? map.getZoom() : 15)};
                pinchMid = midOf(touchPts[0], touchPts[1]);
            } else {
                pinch = null;
                pinchMid = null;
            }
        };
        var onTouchStart = function (e) { syncTouches(e); };
        var onTouchEnd = function (e) { syncTouches(e); };
        var onTouchMove = function (e) {
            if (!e.touches || !e.touches.length) return;
            // 关键：阻止浏览器把这段触摸当成「滚动页面 / 缩放网页」，否则手势永远到不了地图
            if (e.cancelable) e.preventDefault();
            var pts = [];
            for (var i = 0; i < e.touches.length; i++) pts.push(ptOf(e.touches[i]));
            if (pts.length >= 2) {
                if (!pinch) {  // 先单指后双指：补一次起始状态
                    pinch = {dist: dist(pts[0], pts[1]), zoom: (canZoom ? map.getZoom() : 15)};
                    pinchMid = midOf(pts[0], pts[1]);
                    return;
                }
                if (pinch.dist > 0) zoomTo(pinch.zoom + log2(dist(pts[0], pts[1]) / pinch.dist));
                var mid = midOf(pts[0], pts[1]);
                if (pinchMid) panByPixels(mid.x - pinchMid.x, mid.y - pinchMid.y);
                pinchMid = mid;
            } else if (pts.length === 1) {
                if (touchPts.length === 1) panByPixels(pts[0].x - touchPts[0].x, pts[0].y - touchPts[0].y);
                touchPts = pts;
            }
        };
        // iOS Safari 的整页捏合缩放走的是 gesture 事件，光 preventDefault(touchmove) 拦不住
        var stopGesture = function (e) { if (e.cancelable) e.preventDefault(); };

        // 用「捕获阶段」监听：万一百度内部在自己的图层上拦截了事件传播，也能先拿到手势
        el.addEventListener('touchstart', onTouchStart, {passive: true, capture: true});
        el.addEventListener('touchmove', onTouchMove, {passive: false, capture: true});
        el.addEventListener('touchend', onTouchEnd, {passive: true, capture: true});
        el.addEventListener('touchcancel', onTouchEnd, {passive: true, capture: true});
        el.addEventListener('gesturestart', stopGesture, {passive: false, capture: true});
        el.addEventListener('gesturechange', stopGesture, {passive: false, capture: true});
        return true;
    }

    // 如果地图库之前没加载出来（网络慢/断网），回到前台或恢复联网时再试一次，
    // 成功了就把降级提示换成真正的地图，不必让用户手动刷新。
    _retryPendingMaps() {
        if (!this._geoMapReady()) return;
        try {
            if (this._myGeoMapWaiting || !this._myGeoMap) {
                var a = this._myGeoMapArgs || {};
                if (a.ranges && a.ranges.length) {
                    this._myGeoMapWaiting = false;
                    this._ensureMyGeoMap(a.ranges, a.pos || null);
                }
            }
            if (this._geoMapWaiting) {
                this._geoMapWaiting = false;
                this._ensureGeoMap();
            }
        } catch (e) { /* 忽略 */ }
    }

    // 统一入口：
    //   鼠标（桌面端）→ 百度自带（拖动/惯性拖动/双击缩放/滚轮缩放），顺滑且有惯性；
    //   触摸（手机端）→ 自己实现（见 _bindMapGestures），百度那套在手机上不可靠。
    // 接管失败时再退回开启百度自带的双指缩放，尽量多一个能用。
    _setupMapGestures(map, el) {
        this._enableMouseGestures(map);
        var taken = false;
        try { taken = this._bindMapGestures(map, el); } catch (e) { taken = false; }
        if (!taken) {
            try {
                if (typeof map.enablePinchToZoom === 'function') map.enablePinchToZoom(true);
            } catch (e) { /* 忽略 */ }
        }
        return taken;
    }

    // 百度地图命名空间：JS API 3.0 是 BMap，GL 版是 BMapGL，两者 API 表面一致，做个兼容。
    // ⚠️ 必须确认「核心构造函数已注册」才算就绪：百度是分模块加载的，`window.BMap` 会先被
    //    创建成一个**空壳**（此时 BMap.Map 还不存在），如果只判断 window.BMap 是否存在就当成就绪，
    //    紧接着 `new NS.Map(...)` 就会抛 "undefined is not a constructor"
    //    —— 这正是「首次打开偶发初始化失败、稍后重试又正常」的原因。
    _geoMapNS() {
        var cands = [];
        if (typeof window.BMap !== 'undefined' && window.BMap) cands.push(window.BMap);
        if (typeof window.BMapGL !== 'undefined' && window.BMapGL) cands.push(window.BMapGL);
        for (var i = 0; i < cands.length; i++) {
            if (typeof cands[i].Map === 'function' && typeof cands[i].Point === 'function') return cands[i];
        }
        return null;
    }

    // 判断异常是否属于「百度命名空间还处于半加载状态」——这类错误应当继续等待重试，
    // 而不是当成失败弹给用户看（例如 `new NS.Map` 的 "undefined is not a constructor"）。
    _isNsHalfLoadedError(e) {
        var m = String((e && e.message) || '');
        return m.indexOf('is not a constructor') > -1
            || m.indexOf('is not a function') > -1
            || m.indexOf("reading 'Map'") > -1
            || m.indexOf('reading "Map"') > -1
            || m.indexOf('of null') > -1 || m.indexOf('of undefined') > -1;
    }

    _geoMapReady() {
        return !!this._geoMapNS();
    }

    // ==================== 全屏（模态框 / 地图区域） ====================
    // 都走 CSS 固定定位模拟全屏，不用 Fullscreen API（移动端/iOS 支持差）。

    // 考勤配置模态框全屏/退出全屏（复用 oa.css 的 .modal-content.maximized）
    _toggleModalMaximize(btn) {
        var mc = (btn && btn.closest) ? btn.closest('.modal-content') : null;
        if (!mc) return;
        var isMax = mc.classList.toggle('maximized');
        var icon = btn.querySelector('i');
        if (icon) icon.className = isMax ? 'fas fa-compress' : 'fas fa-expand';
        btn.title = isMax ? '退出全屏' : '全屏/退出全屏';
        // 容器尺寸变了要重算地图画布，否则地图仍是旧尺寸
        this._refreshGeoMapLayout();
    }

    // 考勤打卡范围（含地图）区域全屏/退出全屏
    _toggleGeoFullscreen(btn) {
        var sec = document.getElementById('attGeoSection');
        if (!sec) return;
        var isFs = sec.classList.toggle('att-fs');
        var icon = (btn && btn.querySelector) ? btn.querySelector('i') : null;
        if (icon) icon.className = isFs ? 'fas fa-compress' : 'fas fa-expand';
        if (btn) btn.title = isFs ? '退出全屏（Esc）' : '地图全屏（方便圈选范围）';
        this._geoFullscreenOn = isFs;
        this._refreshGeoMapLayout();
    }

    _exitGeoFullscreen() {
        if (!this._geoFullscreenOn) return;
        var sec = document.getElementById('attGeoSection');
        if (sec) sec.classList.remove('att-fs');
        var btn = document.getElementById('attGeoFsBtn');
        if (btn) {
            var icon = btn.querySelector('i');
            if (icon) icon.className = 'fas fa-expand';
            btn.title = '地图全屏（方便圈选范围）';
        }
        this._geoFullscreenOn = false;
        this._refreshGeoMapLayout();
    }

    // 容器尺寸变化后：重算地图画布，并把视野移回「正在设置」的打卡点
    _refreshGeoMapLayout() {
        var self = this;
        setTimeout(function () {
            if (!self._baiduMap) return;
            try { self._baiduMap.checkResize(); } catch (e) { /* 忽略 */ }
            var r = (self._geoRanges || [])[self._geoEditingIndex];
            var NS = self._geoMapNS();
            if (r && r.bd09_lat != null && NS) {
                self._baiduMap.panTo(new NS.Point(r.bd09_lng, r.bd09_lat));
            }
        }, 120);
    }

    // 展示降级提示面板（未配 AK / AK 校验失败 / 初始化异常，都走这里）
    _geoFallback(html) {
        var mapEl = document.getElementById('attGeoMap');
        var fbEl = document.getElementById('attGeoMapFallback');
        var tipEl = document.getElementById('attGeoMapTip');
        if (mapEl) mapEl.style.display = 'none';
        if (tipEl) tipEl.textContent = '';
        if (fbEl) {
            fbEl.style.display = 'block';
            if (html) fbEl.innerHTML = html;
        }
        // 降级后需要重新渲染列表，才能出现「手填经纬度」输入框
        this._renderGeoRanges();
    }

    // 地图库就绪前的轮询等待（百度脚本「引导脚本 → getscript → 各功能模块」是一串请求，
    // 手机上慢一些很正常，所以给足时间；成功则初始化地图，超时则给出**准确的原因**而不只是
    // 一句笼统的「AK 校验未通过」——两者排查方向完全不同：
    //   ① 记录到了百度的报错原文 → 确实是 AK/Referer 白名单问题；
    //   ② 没有任何报错、只是没注册成功 → 多半是加载慢/被网络拦截（api.map.baidu.com 没请求到）。
    _waitForGeoMap(attempt) {
        var self = this;
        attempt = attempt || 0;
        if (this._geoMapReady()) {
            this._geoMapWaiting = false;
            this._initGeoMap();
            return;
        }
        // 等了约 5 秒还没注册出 BMap：大概率是引导脚本里的 document.write 被浏览器忽略了
        // （慢网络 + 跨域脚本时现代浏览器会忽略它），这里补一次 callback 方式的异步加载
        if (attempt === 25) this._loadGeoMapScriptAsync();
        if (attempt >= 60) {   // 约 12 秒仍未就绪 → 判定失败（手机慢网络留足余量）
            this._geoMapWaiting = false;
            this._showGeoLoadFailure(attempt);
            return;
        }
        setTimeout(function () { self._waitForGeoMap(attempt + 1); }, 200);
    }

    // 手机端「百度 SDK 一直没注册出 BMap」时再补一次异步加载。
    // 原理：`api?v=3.0` 返回的引导脚本内部是用 **document.write** 去加载真正的 getscript 的；
    //   而现代浏览器在「慢网络 + 跨域脚本」时会**忽略 document.write**（Chrome 的慢速网络干预），
    //   于是真正的 SDK 永远加载不出来、BMap 始终未定义 —— 这恰好能解释「电脑端正常、手机端一直出不来」。
    //   带上 `&callback=` 参数时百度会走异步加载路径、不再依赖 document.write，这是常见可行解法；
    //   即便这次也失败，也不影响下面的页面诊断信息。
    _loadGeoMapScriptAsync() {
        if (this._geoMapAsyncTried) return;
        this._geoMapAsyncTried = true;
        try {
            var ak = window.BAIDU_MAP_JS_AK;
            if (!ak) return;
            window.__bmapOnLoad = function () { window.__bmapAsyncLoaded = true; };
            var s = document.createElement('script');
            s.async = true;
            s.src = 'https://api.map.baidu.com/api?v=3.0&ak=' + encodeURIComponent(ak)
                + '&callback=__bmapOnLoad&t=' + Date.now();   // 加时间戳避免拿到被缓存的失败响应
            s.onerror = function () { window.__bmapAsyncError = 'script onerror'; };
            (document.head || document.body || document.documentElement).appendChild(s);
            console.warn('[考勤地图诊断] 已尝试用 callback 方式异步补载百度地图 SDK（绕开 document.write）');
        } catch (e) { /* 忽略 */ }
    }

    // 探测能否访问 api.map.baidu.com（区分「网络被拦/DNS 问题」与「AK 被拒」）
    _probeBaiduNet(onDone) {
        var self = this;
        if (self._geoNetProbe) { if (onDone) onDone(); return; }
        var url = 'https://api.map.baidu.com/api?v=3.0&ak=' + encodeURIComponent(window.BAIDU_MAP_JS_AK || '');
        var t0 = Date.now();
        var finish = function (txt) {
            self._geoNetProbe = txt;
            try {
                var box = document.getElementById('geoDiagText');
                if (box) box.textContent = self._diagText();
            } catch (e) { /* 忽略 */ }
            if (onDone) onDone();
        };
        try {
            fetch(url, {mode: 'no-cors', cache: 'no-store'}).then(function () {
                finish('可以访问（' + (Date.now() - t0) + 'ms）→ 不是网络被拦，重点看 AK/Referer 白名单');
            }).catch(function (e) {
                finish('访问失败（' + ((e && e.message) || '未知') + '）→ 更像是网络/DNS 被拦，而不是 AK 白名单');
            });
        } catch (e) {
            finish('无法探测（' + ((e && e.message) || '') + '）');
        }
    }

    // 收集「为什么地图没出来」的关键信息（同时打到控制台，便于远程排查）
    _mapDiag() {
        var standalone = false;
        try {
            standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
                || window.navigator.standalone === true;
        } catch (e) { /* 忽略 */ }
        var ak = window.BAIDU_MAP_JS_AK || '';
        return {
            href: (window.location && window.location.href) || '',      // 含协议/端口，最关键的线索
            origin: (window.location && window.location.origin) || '',
            akTail: ak ? ('***' + String(ak).slice(-6)) : '(未注入)',
            bmap: typeof window.BMap,
            bmapgl: typeof window.BMapGL,
            baiduError: window.__baiduAkError || this._geoAkError || '',
            pwa: standalone,
            online: (typeof navigator !== 'undefined') ? navigator.onLine : null,
            referrer: (typeof document !== 'undefined' && document.referrer) || '',
            ua: (typeof navigator !== 'undefined' && navigator.userAgent) || ''
        };
    }

    // 把诊断信息打到控制台，并探测能不能访问 api.map.baidu.com（区分「网络被拦」与「AK 被拒」）
    _logMapDiag() {
        var d = this._mapDiag();
        console.warn('[考勤地图诊断] 地图库未能就绪:', JSON.stringify(d));
        this.showToast(JSON.stringify(d), true)
        var url = 'https://api.map.baidu.com/api?v=3.0&ak=' + encodeURIComponent(window.BAIDU_MAP_JS_AK || '');
        try {
            fetch(url, {mode: 'no-cors', cache: 'no-store'}).then(function () {
                console.warn('[考勤地图诊断] api.map.baidu.com 可以访问 → 不是网络被拦，'
                    + '重点查 AK/Referer 白名单（当前来源：' + d.origin + (d.pwa ? '，PWA 独立窗口' : '') + '）');

                this.showToast('[考勤地图诊断] api.map.baidu.com 可以访问 → 不是网络被拦，'
                    + '重点查 AK/Referer 白名单（当前来源：' + d.origin + (d.pwa ? '，PWA 独立窗口' : '') + '）');
            }).catch(function (e) {
                console.warn('[考勤地图诊断] api.map.baidu.com 访问失败（' + (e && e.message) + '）→ '
                    + '更像是网络/DNS/代理拦截，而不是 AK 白名单问题');

                this.showToast('[考勤地图诊断] api.map.baidu.com 访问失败（' + (e && e.message) + '）→ '
                    + '更像是网络/DNS/代理拦截，而不是 AK 白名单问题');
            });
        } catch (e) { /* 忽略 */ console.log(e) ; this.showToast(e, true)}
        return d;
    }

    // 诊断信息文本（手机上打不开控制台，所以直接渲染在页面上，可长按复制/一键复制）
    _diagText() {
        var d = this._mapDiag();
        var scripts = [];
        try {
            var list = document.querySelectorAll('script[src*="map.baidu.com"]');
            for (var i = 0; i < list.length; i++) {
                scripts.push(String(list[i].src).replace(/ak=[^&]+/, 'ak=***'));
            }
        } catch (e) { /* 忽略 */ }
        return [
            '【考勤地图诊断】',
            '页面地址: ' + (d.href || '').split('?')[0],
            '来源origin: ' + d.origin,
            'AK: ' + d.akTail,
            '百度脚本标签: ' + (scripts.length ? scripts.join('\n            ') : '页面里没有百度地图脚本标签'),
            'BMap: ' + d.bmap + ' / BMapGL: ' + d.bmapgl,
            '百度报错: ' + (d.baiduError || '(无)'),
            '已尝试callback异步补载: ' + (this._geoMapAsyncTried ? '是' : '否'),
            '异步脚本报错: ' + (window.__bmapAsyncError || '(无)'),
            'PWA独立窗口: ' + (d.pwa ? '是' : '否'),
            '联网状态: ' + (d.online ? '在线' : '离线'),
            'api.map.baidu.com: ' + (this._geoNetProbe || '探测中…'),
            '屏幕: ' + (window.innerWidth || 0) + 'x' + (window.innerHeight || 0),
            'UA: ' + d.ua
        ].join('\n');
    }

    // 诊断信息面板（渲染到页面上 + 一键复制，方便用户直接发给我们）
    _diagBoxHtml() {
        return '<div style="margin-top:10px;padding:8px 10px;background:#fff7e6;border:1px solid #f5dab1;border-radius:8px;">'
            + '<div style="font-size:12px;color:#b88230;margin-bottom:4px;">'
            + '下面的诊断信息可以帮助我们定位问题：点「复制诊断信息」后粘贴发给我们即可。</div>'
            + '<pre id="geoDiagText" style="margin:0;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;'
            + 'font-size:11px;line-height:1.6;color:#606266;background:#fff;border-radius:6px;padding:6px 8px;'
            + '-webkit-user-select:text;user-select:text;">' + this._escape(this._diagText()) + '</pre>'
            + '<button type="button" class="btn btn-secondary" style="margin-top:6px;padding:6px 12px;font-size:12px;" '
            + 'onclick="attendanceApp.copyGeoDiag()">复制诊断信息</button>'
            + '</div>';
    }

    // 一键复制诊断信息（优先用剪贴板 API，老 iOS 退回 execCommand）
    copyGeoDiag() {
        var self = this;
        var text = this._diagText();
        var fallback = function () {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', 'readonly');
                ta.style.position = 'fixed';
                ta.style.top = '0';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, ta.value.length);
                var ok = document.execCommand && document.execCommand('copy');
                document.body.removeChild(ta);
                return !!ok;
            } catch (e) { return false; }
        };
        var done = function (ok) {
            if (self.showToast) {
                self.showToast(ok ? '诊断信息已复制，请粘贴发送给我们' : '复制失败：请长按上面的文字手动全选复制', !ok);
            }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback()); });
        } else {
            done(fallback());
        }
    }

    // 地图加载失败时给出的提示（区分「百度明确报错」与「根本没加载出来」）
    _showGeoLoadFailure() {
        var d = this._logMapDiag();
        var origin = d.origin || '';
        var host = (window.location && window.location.hostname) || '';
        var base = host.split('.').slice(-2).join('.');
        var where = '当前页面地址：<b>' + this._escape(d.href.split('?')[0]) + '</b>'
            + (d.pwa ? '（PWA 独立窗口）' : '');
        var html;
        if (d.baiduError) {
            // 百度自己报了错 → 就是 AK / Referer 白名单问题
            html = '<i class="fas fa-exclamation-triangle" style="color:#e6a23c;"></i> '
                + '百度地图 AK 校验未通过。<br>百度返回：<span style="color:#f56c6c;">'
                + this._escape(d.baiduError) + '</span><br>' + where
                + '<br>百度浏览器端 AK 是按 <b>Referer（来源）</b> 校验的，且白名单<b>必须包含协议与端口、'
                + '不支持端口泛匹配</b>。请在<b>百度地图开放平台 → 应用管理 → 该 AK 的「设置」</b>中，'
                + '把上面这个地址的<b>完整来源</b>加进白名单（例如 <b>' + this._escape(origin) + '</b>、'
                + '<b>*.' + this._escape(base) + '</b>）；'
                + '若电脑端正常、只有手机端失败，通常是手机访问的地址不同（带了端口/是 http/或 PWA 里带了参数），'
                + '把那个来源也加上即可。想最快确认是不是白名单问题，可临时把白名单设为 <b>*</b> 试一次（验证后改回）。';
        } else {
            // 没有百度的报错 → 更像「脚本没加载出来 / 网络慢或被拦」
            html = '<i class="fas fa-exclamation-triangle" style="color:#e6a23c;"></i> '
                + '地图库没有加载出来（等待约 12 秒）。百度这边<b>没有返回 AK 校验错误</b>，'
                + '所以更可能是网络问题：手机网络较慢、或对 <b>api.map.baidu.com</b> 的请求被拦截/超时。<br>'
                + where
                + '<br>可先<b>下拉刷新页面</b>或换个网络（如切到 4G/5G）再试；'
                + '若多次都这样，请把控制台里 <b>[考勤地图诊断]</b> 那几行发给我们定位。'
                + '<br>在此之前，可用下方「手填经纬度 + 半径」配置打卡范围（不影响功能）。';
        }
        this._probeBaiduNet();
        this._geoFallback(html + this._diagBoxHtml());
    }

    _setGeoSwitch(on) {
        var el = document.getElementById('attGeoRequired');
        if (el) el.checked = !!on;
    }

    // 「考勤打卡范围」整块的显隐：默认隐藏；仅超级管理员 + 已在集团默认配置里开启「显示范围配置」时才可见。
    // 后端同样会拦截（非超管不下发范围数据、不允许写入），前端隐藏只是第一道。
    _syncGeoSwitchVisibility(type) {
        var isSuperAdmin = localStorage.getItem('user_type') === 'super_admin';
        var canConfig = !!(isSuperAdmin && this._geoVisible);
        this._canConfigGeo = canConfig;
        var sec = document.getElementById('attGeoSection');
        if (sec) sec.style.display = canConfig ? 'block' : 'none';
        // 「显示打卡范围配置」开关：超管 + 集团默认配置卡片（放在范围区块之外，否则关掉后再也打不开）
        // 另外受 .env 的 ATTENDANCE_GEO_VISIBLE_SWITCH 控制（由 settings.py 下发到页面）：
        // 该参数未开启时整行永远隐藏，页面上就没有入口去开启/隐藏考勤范围配置。
        var visRow = document.getElementById('attGeoVisibleRow');
        if (visRow) {
            visRow.style.display = (this._geoVisibleSwitchEnabled && isSuperAdmin
                && this._canSetGeoSwitch && type === 'global') ? 'flex' : 'none';
        }
        var row = document.getElementById('attGeoSwitchRow');
        if (row) row.style.display = (canConfig && type === 'global' && this._canSetGeoSwitch) ? 'block' : 'none';
        // 不可配置时不要初始化地图（省流量，也避免加载地图相关的报错）
        if (!canConfig) {
            this._exitGeoFullscreen();
        }
    }

    // 是否显示「考勤打卡范围配置」（集团默认配置上的开关，仅超管可改）
    _setGeoVisible(on) {
        var el = document.getElementById('attGeoConfigVisible');
        if (el) el.checked = !!on;
    }

    _setGeoRanges(list) {
        var out = [];
        (list || []).forEach(function (r) {
            if (!r || typeof r !== 'object') return;
            out.push({
                name: r.name || '',
                radius: r.radius != null ? r.radius : 300,
                // 每个打卡点可单独启停（停用后不参与打卡判定，坐标与半径保留）
                enabled: r.enabled !== false,
                // 地图来源（BD09）
                bd09_lat: r.bd09_lat != null ? r.bd09_lat : null,
                bd09_lng: r.bd09_lng != null ? r.bd09_lng : null,
                // 手填来源（WGS84）
                lat: r.lat != null ? r.lat : null,
                lng: r.lng != null ? r.lng : null
            });
        });
        this._geoRanges = out;
        // 默认把「正在设置」定位到第一个启用的打卡点
        var firstOn = -1;
        out.forEach(function (r, i) { if (firstOn < 0 && r.enabled) firstOn = i; });
        this._geoEditingIndex = out.length ? (firstOn >= 0 ? firstOn : 0) : -1;
        this._renderGeoRanges();
        this._ensureGeoMap();
    }

    _addGeoRange() {
        this._geoRanges = this._geoRanges || [];
        if (this._geoRanges.length >= 50) { this.showToast('最多 50 个打卡点', true); return; }
        this._geoRanges.push({name: '打卡点' + (this._geoRanges.length + 1), radius: 300,
                              enabled: true,
                              bd09_lat: null, bd09_lng: null, lat: null, lng: null});
        this._geoEditingIndex = this._geoRanges.length - 1;
        this._renderGeoRanges();
        this._drawGeoRanges();
    }

    // 单个打卡点启用/停用
    _toggleGeoRangeEnabled(i) {
        var r = (this._geoRanges || [])[i];
        if (!r) return;
        r.enabled = !r.enabled;
        if (!r.enabled && this._geoEditingIndex === i) {
            // 正在设置的点被停用了：把编辑目标让给其它启用的点（没有就保持不动）
            var self = this;
            var nextOn = -1;
            (this._geoRanges || []).forEach(function (x, xi) { if (nextOn < 0 && x.enabled) nextOn = xi; });
            if (nextOn >= 0) this._geoEditingIndex = nextOn;
        }
        this._renderGeoRanges();
        this._drawGeoRanges();
        this.showToast(r.enabled ? '已启用该打卡点' : '已停用该打卡点（不参与打卡判定）', false);
    }

    _enabledGeoCount() {
        return (this._geoRanges || []).filter(function (r) { return r.enabled !== false; }).length;
    }

    _removeGeoRange(i) {
        this._geoRanges = this._geoRanges || [];
        if (i < 0 || i >= this._geoRanges.length) return;
        this._geoRanges.splice(i, 1);
        if (this._geoEditingIndex >= this._geoRanges.length) this._geoEditingIndex = this._geoRanges.length - 1;
        this._renderGeoRanges();
        this._drawGeoRanges();
    }

    _editGeoRange(i) {
        this._geoEditingIndex = i;
        this._renderGeoRanges();
        var r = (this._geoRanges || [])[i];
        var NS = this._geoMapNS();
        if (r && r.bd09_lat != null && this._baiduMap && NS) {
            this._baiduMap.panTo(new NS.Point(r.bd09_lng, r.bd09_lat));
        }
    }

    _onGeoRangeFieldChange(i, field, value) {
        var r = (this._geoRanges || [])[i];
        if (!r) return;
        if (field === 'name') r.name = value;
        else if (field === 'radius') {
            var n = parseFloat(value);
            if (!isNaN(n)) r.radius = n;
        } else if (field === 'lat' || field === 'lng') {
            var v = parseFloat(value);
            r[field] = isNaN(v) ? null : v;
            // 手改了经纬度就不再使用地图来源坐标
            r.bd09_lat = null; r.bd09_lng = null;
        }
    }

    _geoRangeText(r) {
        if (r.bd09_lat != null && r.bd09_lng != null) {
            return '圆心(BD09)：' + Number(r.bd09_lat).toFixed(6) + ', ' + Number(r.bd09_lng).toFixed(6);
        }
        if (r.lat != null && r.lng != null) {
            return '圆心(WGS84)：' + Number(r.lat).toFixed(6) + ', ' + Number(r.lng).toFixed(6);
        }
        return '尚未设定圆心';
    }

    _renderGeoRanges() {
        var wrap = document.getElementById('attGeoRangeList');
        if (!wrap) return;
        var self = this;
        var list = this._geoRanges || [];
        if (!list.length) {
            wrap.innerHTML = '<div style="font-size:12px;color:#909399;padding:6px 2px;">'
                + '暂无打卡范围（留空表示沿用上一层配置；若所有层级都为空则不做位置限制）</div>';
            return;
        }
        var hasMap = this._geoMapReady();
        var enabledCount = this._enabledGeoCount();
        var notice = (enabledCount === 0)
            ? '<div style="font-size:12px;color:#e6a23c;background:#fdf6ec;border:1px solid #f5dab1;border-radius:6px;'
              + 'padding:6px 10px;margin-bottom:8px;"><i class="fas fa-exclamation-triangle"></i> '
              + '当前层级的打卡点已全部停用，等同于「本层级未配置」——将自动沿用上一层（个人 &gt; 部门 &gt; 子公司 &gt; 集团）的范围。</div>'
            : '';
        wrap.innerHTML = notice + list.map(function (r, i) {
            var active = (i === self._geoEditingIndex);
            var on = r.enabled !== false;
            var dim = on ? '' : 'opacity:.55;';
            var head = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
                + '<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;flex-shrink:0;" '
                + 'title="停用后该打卡点不参与打卡判定，坐标与半径会保留">'
                + '<input type="checkbox"' + (on ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;" '
                + 'onchange="attendanceApp._toggleGeoRangeEnabled(' + i + ')">'
                + '<span style="font-size:12px;color:' + (on ? '#67c23a' : '#909399') + ';">' + (on ? '启用' : '停用') + '</span>'
                + '</label>'
                + '<input type="text" class="form-input" value="' + self._escape(r.name || '') + '" placeholder="打卡点名称" '
                + 'oninput="attendanceApp._onGeoRangeFieldChange(' + i + ',\'name\',this.value)" style="width:140px;">'
                + '<span style="font-size:12px;color:#606266;">半径(米)</span>'
                + '<input type="number" min="1" max="20000" class="form-input" value="' + (r.radius != null ? r.radius : 300) + '" '
                + 'oninput="attendanceApp._onGeoRangeFieldChange(' + i + ',\'radius\',this.value)" style="width:100px;">'
                + '<span style="flex:1;min-width:0;font-size:12px;color:' + (active ? '#409eff' : '#909399') + ';">'
                + self._escape(self._geoRangeText(r)) + '</span>'
                + (hasMap ? '<button type="button" class="btn btn-sm ' + (active ? 'btn-primary' : 'btn-secondary') + '" '
                    + 'onclick="attendanceApp._editGeoRange(' + i + ')">' + (active ? '正在设置此点' : '设为当前设置点') + '</button>' : '')
                + '<button type="button" class="btn btn-sm btn-secondary" onclick="attendanceApp._removeGeoRange(' + i + ')">删除</button>'
                + '</div>';
            var manual = '';
            if (!hasMap) {
                manual = '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">'
                    + '<span style="font-size:12px;color:#606266;">纬度(WGS84)</span>'
                    + '<input type="number" step="0.000001" class="form-input" value="' + (r.lat != null ? r.lat : '') + '" '
                    + 'oninput="attendanceApp._onGeoRangeFieldChange(' + i + ',\'lat\',this.value)" style="width:130px;">'
                    + '<span style="font-size:12px;color:#606266;">经度(WGS84)</span>'
                    + '<input type="number" step="0.000001" class="form-input" value="' + (r.lng != null ? r.lng : '') + '" '
                    + 'oninput="attendanceApp._onGeoRangeFieldChange(' + i + ',\'lng\',this.value)" style="width:130px;">'
                    + '</div>';
            }
            return '<div style="padding:8px 10px;border:1px solid ' + (active && hasMap && on ? '#409eff' : '#ebeef5') + ';'
                + 'border-radius:8px;background:' + (active && hasMap && on ? '#ecf5ff' : '#fff') + ';' + dim + '">'
                + head + manual + '</div>';
        }).join('');
    }

    _ensureGeoMap() {
        var mapEl = document.getElementById('attGeoMap');
        var tipEl = document.getElementById('attGeoMapTip');
        if (!mapEl) return;
        // 1) 没配浏览器端 AK：直接降级为手填经纬度
        if (!window.BAIDU_MAP_JS_AK) {
            this._geoFallback('<i class="fas fa-info-circle"></i> 未配置百度地图浏览器端 AK（BAIDU_MAP_JS_AK），'
                + '无法显示地图底图。仍可在下方手动填写圆心经纬度与半径（经纬度请填 WGS84，即手机定位原始坐标）。');
            return;
        }
        // 2) 地图库已就绪：直接用
        if (this._geoMapReady()) {
            this._initGeoMap();
            if (tipEl) tipEl.textContent = '在地图上点击即可为「正在设置」的打卡点设定圆心';
            return;
        }
        // 3) AK 已配置但地图库没就绪：页面已同步加载过地图脚本（仅管理员页面），
        //    这里等它的异步校验完成；超时未就绪即判定 AK 校验失败并给出提示。
        //    注意：不能改成动态注入脚本——百度地图依赖 document.write，异步注入会直接报错。
        mapEl.style.display = 'none';
        if (this._geoMapWaiting) return;
        this._geoMapWaiting = true;
        this._waitForGeoMap(0);
    }

    _initGeoMap() {
        var mapEl = document.getElementById('attGeoMap');
        if (!mapEl) return;
        mapEl.style.display = 'block';
        var fbEl = document.getElementById('attGeoMapFallback');
        if (fbEl) fbEl.style.display = 'none';
        if (this._baiduMap) {
            try { this._baiduMap.checkResize && this._baiduMap.checkResize(); } catch (e) { /* 忽略 */ }
            this._drawGeoRanges();
            this._renderGeoRanges();
            return;
        }
        // 还没真正就绪（含「半加载」状态）→ 回到等待流程，别在这里报错
        if (!this._geoMapReady()) {
            this._geoMapWaiting = false;
            this._ensureGeoMap();
            return;
        }
        var NS = this._geoMapNS();
        try {
            this._baiduMap = new NS.Map(mapEl);
            this._baiduMap.centerAndZoom(new NS.Point(116.404, 39.915), 12);
            this._baiduMap.enableScrollWheelZoom(true);
            this._baiduMap.addControl(new NS.NavigationControl());
            // 触摸手势：单指拖动 + 双指缩放（圈选范围时手机上也能自由缩放拖动）
            this._setupMapGestures(this._baiduMap, mapEl);
            var self = this;
            this._baiduMap.addEventListener('click', function (e) {
                // 刚用双指/单指拖动或缩放过，别把这次抬手当成「点图设定圆心」的点击
                if (self._mapGestureMovedAt && Date.now() - self._mapGestureMovedAt < 400) return;
                if (self._geoEditingIndex < 0) {
                    self.showToast('请先「添加打卡点」或选择要设置的点', true);
                    return;
                }
                var r = self._geoRanges[self._geoEditingIndex];
                if (!r) return;
                r.bd09_lat = e.point.lat;
                r.bd09_lng = e.point.lng;
                r.lat = null; r.lng = null;
                self._drawGeoRanges();
                self._renderGeoRanges();
            });
            this._drawGeoRanges();
            // 地图就绪后重渲染列表：把手填经纬度输入框切换为「地图点选」模式
            this._renderGeoRanges();
        } catch (e) {
            console.warn('初始化百度地图失败', e);
            this._baiduMap = null;
            // 「半加载」状态（模块还没注册完）导致的报错 → 属于还没准备好，回去继续等，
            // 不要把这种瞬时状态当失败提示给用户（首次打开偶发、稍后又正常，就是这种情况）
            if (this._isNsHalfLoadedError(e) && (this._geoInitRetry || 0) < 6) {
                this._geoInitRetry = (this._geoInitRetry || 0) + 1;
                this._geoMapWaiting = false;
                this._ensureGeoMap();
                return;
            }
            this._geoFallback('<i class="fas fa-exclamation-triangle" style="color:#e6a23c;"></i> 百度地图初始化失败：'
                + this._escape((e && e.message) || '未知原因')
                + '<br>常见原因：该 AK 未勾选「浏览器端」服务、或未开通「JavaScript API」、或 Referer 白名单不含当前域名。'
                + '<br>可先用下方「手填经纬度 + 半径」配置打卡范围（不影响功能）。'
                + this._diagBoxHtml());
        }
    }

    _drawGeoRanges() {
        var NS = this._geoMapNS();
        if (!this._baiduMap || !NS) return;
        var map = this._baiduMap;
        (this._geoCircles || []).forEach(function (c) { map.removeOverlay(c); });
        (this._geoMarkers || []).forEach(function (m) { map.removeOverlay(m); });
        this._geoCircles = [];
        this._geoMarkers = [];
        var self = this;
        (this._geoRanges || []).forEach(function (r, i) {
            if (r.bd09_lat == null || r.bd09_lng == null) return;
            var pt = new NS.Point(r.bd09_lng, r.bd09_lat);
            var active = (i === self._geoEditingIndex);
            var on = r.enabled !== false;
            // 停用的打卡点用灰色虚线画出，便于对比查看，但不参与打卡判定
            var circle = new NS.Circle(pt, r.radius || 300, {
                strokeColor: on ? (active ? '#409eff' : '#e6a23c') : '#c0c4cc',
                strokeWeight: 2, strokeOpacity: on ? 0.9 : 0.7,
                strokeStyle: on ? 'solid' : 'dashed',
                fillColor: on ? (active ? '#409eff' : '#e6a23c') : '#c0c4cc',
                fillOpacity: on ? 0.18 : 0.10
            });
            map.addOverlay(circle);
            self._geoCircles.push(circle);
            if (!on) return;   // 停用点不画大头针，视觉上明确区分
            var marker = new NS.Marker(pt);
            map.addOverlay(marker);
            self._geoMarkers.push(marker);
        });
    }

    async _useMyLocationForRange() {
        if (this._geoEditingIndex < 0) {
            if (!(this._geoRanges || []).length) this._addGeoRange();
            else this._geoEditingIndex = 0;
        }
        var self = this;
        var idx = this._geoEditingIndex;
        if (!navigator.geolocation) { this.showToast('当前浏览器不支持定位', true); return; }
        this.showToast('正在获取当前位置...', false);
        navigator.geolocation.getCurrentPosition(async function (pos) {
            try {
                // 浏览器定位是 WGS84，地图需要 BD09 —— 交给后端换算，避免前后端各写一份
                var resp = await fetch(OA_API_URL + '/attendance/geo-convert/?lat=' + pos.coords.latitude
                    + '&lng=' + pos.coords.longitude + '&to=bd09', {headers: TokenManager.getHeaders()});
                if (!resp.ok) throw new Error('坐标换算失败');
                var raw = await resp.json();
                // 接口返回 {encrypt:true, data:<base64>} 整个报文，必须用 decryptPacket 解包；
                // decryptData() 只吃里面的 base64 字符串，传报文会报 "t.indexOf is not a function"。
                var d = (raw && raw.encrypt && window.EncryptUtils)
                    ? window.EncryptUtils.decryptPacket(raw) : raw;
                var r = self._geoRanges[idx];
                if (!r) return;
                r.bd09_lat = d.bd09_lat; r.bd09_lng = d.bd09_lng;
                r.lat = pos.coords.latitude; r.lng = pos.coords.longitude;
                self._drawGeoRanges();
                self._renderGeoRanges();
                var NS = self._geoMapNS();
                if (self._baiduMap && NS) {
                    self._baiduMap.panTo(new NS.Point(d.bd09_lng, d.bd09_lat));
                }
                self.showToast('已把当前位置设为该打卡点圆心', false);
            } catch (e) {
                self.showToast('获取位置失败：' + (e.message || ''), true);
            }
        }, function () {
            self.showToast('定位失败，请检查浏览器定位权限', true);
        }, {enableHighAccuracy: true, timeout: 10000});
    }

    _collectGeoRanges() {
        var out = [];
        (this._geoRanges || []).forEach(function (r, i) {
            var name = (r.name || '').trim() || ('打卡点' + (i + 1));
            var radius = parseInt(r.radius, 10);
            if (!(radius > 0)) radius = 300;
            var enabled = r.enabled !== false;
            if (r.bd09_lat != null && r.bd09_lng != null) {
                out.push({name: name, radius: radius, enabled: enabled,
                          bd09_lat: r.bd09_lat, bd09_lng: r.bd09_lng});
            } else if (r.lat != null && r.lng != null) {
                out.push({name: name, radius: radius, enabled: enabled, lat: r.lat, lng: r.lng});
            }
        });
        return out;
    }

    closeConfigModal() {
        // 先退出两种全屏，避免关闭后残留 fixed 遮罩挡住页面
        this._exitGeoFullscreen();
        this._renderConfigMeta(null);
        var modal = document.getElementById('attendanceConfigModal');
        if (modal) {
            var mc = modal.querySelector('.modal-content');
            if (mc) mc.classList.remove('maximized');
            var fsBtn = modal.querySelector('.maximize-btn');
            if (fsBtn) {
                var icon = fsBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-expand';
                fsBtn.title = '全屏/退出全屏';
            }
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    }

    async _loadAttSubTenants() {
        try {
            var resp = await fetch(OA_API_URL + '/attendance/attendance-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var json = await resp.json();
            var subTenants = json.sub_tenants || [];
            // 「指定区域打卡」总开关是否可编辑（仅最顶层集团 + 超管）
            this._canSetGeoSwitch = json.can_set_geo_switch === true;
            // 打卡范围配置是否可见/可配（后端已按角色裁剪，超管且开关打开才为真）
            this._geoVisible = !!(json.geo_config && json.geo_config.can_config);
            this._setGeoVisible(json.geo_config ? json.geo_config.visible : false);
            this._syncGeoSwitchVisibility(this._configAttType);
            // 右侧子公司选择器
            var rightSel = document.getElementById('attConfigSubTenantSelect');
            if (rightSel) {
                rightSel.innerHTML = '<option value="">请选择子公司</option>';
                subTenants.forEach(function (st) {
                    var opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = (st.short_name || st.name) + '（' + (st.tenant_type || '公司') + '）';
                    rightSel.appendChild(opt);
                });
            }
        } catch (e) {
            console.warn('加载子公司列表失败', e);
        }
    }

    async _loadAttDepts() {
        var sel = document.getElementById('attendanceConfigDept');
        if (!sel) return;
        try {
            var resp = await fetch(OA_API_URL + '/approval/org_departments/', {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var data = await resp.json();
            var depts = data.results || [];
            // 普通管理员：仅展示其可配置的本部门（含子部门）范围
            if (this._attManagedDeptIds) {
                var allowed = {};
                (this._attManagedDeptIds || []).forEach(function (id) { allowed[String(id)] = true; });
                depts = depts.filter(function (d) { return allowed[String(d.id)]; });
            }
            var tree = {};
            depts.forEach(function (d) {
                var pid = d.parent_id != null ? d.parent_id : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });
            var html = '<option value="">集团默认配置</option>';
            var walk = function (pid, depth) {
                var children = tree[pid] || [];
                children.forEach(function (d) {
                    var prefix = '';
                    for (var j = 0; j < depth; j++) prefix += '—— ';
                    var companyIcon = d.department_type === 'company' ? ' ✈' : '';
                    html += '<option value="' + d.id + '">' + prefix + attendanceApp._escape(d.name) + companyIcon + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            if (!tree[0] || !tree[0].length) {
                var allIds = {};
                depts.forEach(function (d) { allIds[d.id] = true; });
                var roots = depts.filter(function (d) { return !allIds[d.parent_id]; });
                if (roots.length) {
                    html = '<option value="">集团默认配置</option>';
                    var renderFlat = function (items, depth) {
                        items.forEach(function (d) {
                            var prefix = '';
                            for (var j = 0; j < depth; j++) prefix += '—— ';
                            var companyIcon = d.department_type === 'company' ? ' ✈' : '';
                            html += '<option value="' + d.id + '">' + prefix + attendanceApp._escape(d.name) + companyIcon + '</option>';
                            var kids = tree[d.id] || [];
                            renderFlat(kids, depth + 1);
                        });
                    };
                    renderFlat(roots, 0);
                }
            }
            sel.innerHTML = html;
        } catch (e) {
            console.warn('加载部门列表失败', e);
        }
    }

    async _onAttUserSearch(e) {
        var kw = (e.target.value || '').trim();
        var res = document.getElementById('attConfigUserRes');
        if (!res) return;
        if (!kw) { res.style.display = 'none'; return; }
        try {
            var resp = await fetch(OA_API_URL + '/attendance/members/?search=' + encodeURIComponent(kw), {
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) return;
            var json = await resp.json();
            var users = json.results || [];
            this._attSearchUsers = users;
            var self = this;
            res.innerHTML = users.length ? users.map(function (u) {
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onclick="attendanceApp._selectAttUser(' + u.id + ')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name || '') + '</span>'
                    + (u.department_name ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.department_name) + '</span>' : '')
                    + (u.position ? '<span style="font-size:11px;color:#c0c4cc;margin-left:4px;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到成员</div>';
            res.style.display = 'block';
        } catch (err) {
            console.warn('搜索成员失败', err);
        }
    }

    _selectAttUser(id) {
        var u = null;
        var users = this._attSearchUsers || [];
        for (var i = 0; i < users.length; i++) {
            if (String(users[i].id) === String(id)) { u = users[i]; break; }
        }
        if (!u) return;
        this._attConfigUser = {
            id: u.id, name: u.name || '', avatar: u.avatar || '',
            department: u.department_name || '', position: u.position || ''
        };
        var searchEl = document.getElementById('attConfigUserSearch');
        if (searchEl) searchEl.value = '';
        var res = document.getElementById('attConfigUserRes');
        if (res) res.style.display = 'none';
        this._renderAttUserTag();
        this._configAttType = 'user';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = 'user';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        document.getElementById('attendanceMakeupAllowance').value = 3;
        document.getElementById('attendanceClockOutLimit').value = 3;
        this._setShiftType('day');
        this._toggleClockIn();
        this._toggleClockOut();
        this._loadConfigForType('user');
    }

    _clearAttUser() {
        this._attConfigUser = null;
        this._renderAttUserTag();
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
    }

    _renderAttUserTag() {
        var container = document.getElementById('attConfigUserTag');
        if (!container) return;
        if (!this._attConfigUser) {
            container.innerHTML = '<span style="font-size:12px;color:#c0c4cc;">未选择成员</span>';
            return;
        }
        var u = this._attConfigUser;
        container.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:#f3e8ff;border-radius:14px;font-size:12px;margin:2px;color:#9b59b6;">'
            + (u.avatar ? '<img src="' + this._escape(u.avatar) + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">' : '<i class="fas fa-user" style="font-size:10px;color:#9b59b6;"></i>')
            + '<span>' + this._escape(u.name || ('#' + u.id)) + '</span>'
            + (u.department ? '<span style="font-size:11px;color:#b39ddb;">' + this._escape(u.department) + '</span>' : '')
            + '<i class="fas fa-times" style="cursor:pointer;color:#9b59b6;font-size:11px;" onclick="attendanceApp._clearAttUser()" title="取消选择"></i>'
            + '</span>';
    }

    async _loadAttConfigList() {
        var container = document.getElementById('attendanceConfigList');
        if (!container) return;
        try {
            var filterType = this._configAttType || 'global';
            var url = OA_API_URL + '/attendance/attendance-configs/';
            if (filterType === 'user') url = OA_API_URL + '/attendance/user-attendance-configs/';
            var resp = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!resp.ok) return;
            var json = await resp.json();
            // 记录管理员可配置的部门范围（后端返回 managed_dept_ids），供部门选择器过滤
            this._attManagedDeptIds = (json && json.managed_dept_ids) ? json.managed_dept_ids : null;
            var configs = json.results || [];
            var self = this;
            if (!configs.length) {
                container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 0;">暂无配置</div>';
                return;
            }
            container.innerHTML = configs.map(function (c) {
                // 按类型过滤
                if (filterType === 'global' && (c.sub_tenant || c.department)) return '';
                if (filterType === 'sub_tenant' && (!c.sub_tenant || c.department)) return '';
                if (filterType === 'department' && !c.department) return '';
                if (filterType === 'user' && !c.user) return '';
                var label, typeTag;
                if (filterType === 'user') {
                    label = c.user_name || ('成员 #' + c.user);
                    typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#f3e8ff;color:#9b59b6;margin-left:4px;">个人</span>';
                    if (c.department_name) label += ' <span style="color:var(--text-light,#909399);font-weight:400;">(' + attendanceApp._escape(c.department_name) + ')</span>';
                } else {
                    label = c.department_name || c.sub_tenant_name || '集团默认';
                    if (c.department) typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#f0f9eb;color:#67c23a;margin-left:4px;">部门</span>';
                    else if (c.sub_tenant) typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#fef3e0;color:#e6a23c;margin-left:4px;">子公司</span>';
                    else typeTag = '<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:#e3f2fd;color:#409eff;margin-left:4px;">集团</span>';
                }
                var sel = self._configEditKey && c.id === self._configEditKey ? ' style="background:#e8f4fd;font-weight:600;"' : '';
                return '<div class="config-list-item"' + sel + ' onclick="attendanceApp._editAttConfig(' + c.id + ')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
                    + '<span><i class="fas fa-clock" style="color:var(--primary-color,#409eff);margin-right:4px;"></i>' + label + typeTag + '</span></div>';
            }).join('');
        } catch (e) {
            console.warn('加载考勤配置列表失败', e);
        }
    }

    async _editAttConfig(configId) {
        try {
            var url = OA_API_URL + '/attendance/attendance-configs/';
            if (this._configAttType === 'user') url = OA_API_URL + '/attendance/user-attendance-configs/';
            var resp = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!resp.ok) return;
            var json = await resp.json();
            var configs = json.results || [];
            var cfg = null;
            configs.forEach(function (c) { if (c.id === configId) cfg = c; });
            if (!cfg) return;
            this._configEditKey = configId;
            this._configDeleteId = configId;
            this._renderConfigMeta(cfg);
            // 根据配置类型激活对应类型卡片
            var cardType = 'global';
            if (cfg.sub_tenant && !cfg.department) cardType = 'sub_tenant';
            else if (cfg.department) cardType = 'department';
            else if (cfg.user) cardType = 'user';
            this._configAttType = cardType;
            document.getElementById('attConfigType').value = cardType;
            document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
            var card = document.querySelector('.config-type-card[data-att-type="' + cardType + '"]');
            if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
            document.getElementById('attConfigSubTenantRow').style.display = cardType === 'sub_tenant' ? 'block' : 'none';
            document.getElementById('attConfigDeptRow').style.display = cardType === 'department' ? 'block' : 'none';
            document.getElementById('attConfigUserRow').style.display = cardType === 'user' ? 'block' : 'none';
            document.getElementById('attendanceConfigEmpty').style.display = 'none';
            document.getElementById('attendanceConfigForm').style.display = 'block';
            document.getElementById('attendanceConfigFooter').style.display = 'flex';
            document.getElementById('attendanceConfigDeleteBtn').style.display = '';
            var deptSel = document.getElementById('attendanceConfigDept');
            if (deptSel) deptSel.value = cfg.department || '';
            var stSel = document.getElementById('attConfigSubTenantSelect');
            if (stSel) stSel.value = cfg.sub_tenant || '';
            if (cardType === 'user') {
                this._attConfigUser = {id: cfg.user, name: cfg.user_name || '', avatar: cfg.avatar_url || '', department: cfg.department_name || '', position: cfg.position || ''};
                var userSearch = document.getElementById('attConfigUserSearch');
                if (userSearch) userSearch.value = '';
                var userRes = document.getElementById('attConfigUserRes');
                if (userRes) userRes.style.display = 'none';
                this._renderAttUserTag();
            }
            document.getElementById('attendanceClockInEnabled').checked = cfg.clock_in_enabled !== false;
            document.getElementById('attendanceClockOutEnabled').checked = cfg.clock_out_enabled !== false;
            if (cfg.clock_in_time) {
                document.getElementById('attendanceClockInTime').value = cfg.clock_in_time.substring(0, 5);
            } else {
                document.getElementById('attendanceClockInTime').value = '09:00';
            }
            if (cfg.clock_out_time) {
                document.getElementById('attendanceClockOutTime').value = cfg.clock_out_time.substring(0, 5);
            } else {
                document.getElementById('attendanceClockOutTime').value = '18:00';
            }
            document.getElementById('attendanceMakeupAllowance').value = (cfg.makeup_allowance != null) ? cfg.makeup_allowance : 3;
            document.getElementById('attendanceClockOutLimit').value = (cfg.clock_out_limit != null) ? cfg.clock_out_limit : 3;
            this._setShiftType(cfg.shift_type || 'day');
            this._toggleClockIn();
            this._toggleClockOut();
            this._loadAttConfigList();
        } catch (e) {
            console.warn('加载考勤配置失败', e);
        }
    }

    _onConfigSubTenantChange() {
        this._loadAttConfigList();
    }

    _onAttConfigSubTenantChange() {
        var val = document.getElementById('attConfigSubTenantSelect').value;
        if (!val) return;
        // Switch type card without resetting to existing config
        this._configAttType = 'sub_tenant';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = 'sub_tenant';
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
        var card = document.querySelector('.config-type-card[data-att-type="sub_tenant"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('attConfigSubTenantRow').style.display = 'block';
        document.getElementById('attConfigDeptRow').style.display = 'none';
        document.getElementById('attConfigUserRow').style.display = 'none';
        document.getElementById('attendanceConfigForm').style.display = 'block';
        document.getElementById('attendanceConfigFooter').style.display = 'flex';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'none';
        this._renderConfigMeta(null);
        document.getElementById('attConfigSubTenantSelect').value = val;
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        document.getElementById('attendanceMakeupAllowance').value = 3;
        document.getElementById('attendanceClockOutLimit').value = 3;
        this._setShiftType('day');
        this._toggleClockIn();
        this._toggleClockOut();
        this._loadConfigForType('sub_tenant');
    }

    _onAttConfigDeptChange() {
        var val = document.getElementById('attendanceConfigDept').value;
        if (!val) return;
        this._configAttType = 'department';
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attConfigType').value = 'department';
        document.querySelectorAll('.config-type-card[data-att-type]').forEach(function(c) { c.classList.remove('active'); c.style.borderColor = ''; c.style.background = ''; });
        var card = document.querySelector('.config-type-card[data-att-type="department"]');
        if (card) { card.classList.add('active'); card.style.borderColor = '#409eff'; card.style.background = '#ecf5ff'; }
        document.getElementById('attConfigSubTenantRow').style.display = 'none';
        document.getElementById('attConfigDeptRow').style.display = 'block';
        document.getElementById('attConfigUserRow').style.display = 'none';
        document.getElementById('attendanceConfigForm').style.display = 'block';
        document.getElementById('attendanceConfigFooter').style.display = 'flex';
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
        document.getElementById('attendanceConfigEmpty').style.display = 'none';
        this._renderConfigMeta(null);
        document.getElementById('attendanceConfigDept').value = val;
        document.getElementById('attendanceClockInEnabled').checked = true;
        document.getElementById('attendanceClockInTime').value = '09:00';
        document.getElementById('attendanceClockOutEnabled').checked = true;
        document.getElementById('attendanceClockOutTime').value = '18:00';
        document.getElementById('attendanceMakeupAllowance').value = 3;
        document.getElementById('attendanceClockOutLimit').value = 3;
        this._setShiftType('day');
        this._toggleClockIn();
        this._toggleClockOut();
        this._loadConfigForType('department');
    }

    _getShiftType() {
        var night = document.getElementById('attShiftNight');
        return night && night.checked ? 'night' : 'day';
    }

    _setShiftType(val) {
        var day = document.getElementById('attShiftDay');
        var night = document.getElementById('attShiftNight');
        var isNight = val === 'night';
        if (day) day.checked = !isNight;
        if (night) night.checked = isNight;
        var hint = document.getElementById('attShiftNightHint');
        if (hint) hint.style.display = isNight ? 'block' : 'none';
    }

    _onShiftTypeChange() {
        var isNight = this._getShiftType() === 'night';
        var hint = document.getElementById('attShiftNightHint');
        if (hint) hint.style.display = isNight ? 'block' : 'none';
        // 切换班次时若打卡时间仍为另一班次的默认值，则自动填入本班次默认时间
        var ci = document.getElementById('attendanceClockInTime');
        var co = document.getElementById('attendanceClockOutTime');
        if (!ci || !co) return;
        if (isNight) {
            if ((ci.value === '09:00' || !ci.value) && (co.value === '18:00' || !co.value)) {
                ci.value = '20:00';
                co.value = '06:00';
            }
        } else {
            if ((ci.value === '20:00' || !ci.value) && (co.value === '06:00' || !co.value)) {
                ci.value = '09:00';
                co.value = '18:00';
            }
        }
    }

    _toggleClockIn() {
        var enabled = document.getElementById('attendanceClockInEnabled').checked;
        var group = document.getElementById('attendanceClockInTimeGroup');
        if (group) group.style.display = enabled ? 'block' : 'none';
    }

    _toggleClockOut() {
        var enabled = document.getElementById('attendanceClockOutEnabled').checked;
        var group = document.getElementById('attendanceClockOutTimeGroup');
        if (group) group.style.display = enabled ? 'block' : 'none';
    }

    async _saveConfig() {
        var attType = this._configAttType || document.getElementById('attConfigType').value || 'global';
        var deptId = document.getElementById('attendanceConfigDept').value;
        var subTenantId = document.getElementById('attConfigSubTenantSelect') ? document.getElementById('attConfigSubTenantSelect').value : '';
        var userId = this._attConfigUser ? this._attConfigUser.id : '';
        if (attType === 'user' && !userId) {
            this.showToast('请先选择成员', true);
            return;
        }
        var clockInEnabled = document.getElementById('attendanceClockInEnabled').checked;
        var clockOutEnabled = document.getElementById('attendanceClockOutEnabled').checked;
        var clockInTime = document.getElementById('attendanceClockInTime').value;
        var clockOutTime = document.getElementById('attendanceClockOutTime').value;
        var makeupAllowance = document.getElementById('attendanceMakeupAllowance') ? document.getElementById('attendanceMakeupAllowance').value : '';
        var clockOutLimit = document.getElementById('attendanceClockOutLimit') ? document.getElementById('attendanceClockOutLimit').value : '';
        var data = {
            clock_in_enabled: clockInEnabled,
            clock_out_enabled: clockOutEnabled,
            shift_type: this._getShiftType(),
        };
        if (clockInEnabled && clockInTime) data.clock_in_time = clockInTime;
        if (clockOutEnabled && clockOutTime) data.clock_out_time = clockOutTime;
        if (makeupAllowance !== '') data.makeup_allowance = parseInt(makeupAllowance);
        if (clockOutLimit !== '') data.clock_out_limit = parseInt(clockOutLimit);
        if (attType === 'department' && deptId) data.department_id = parseInt(deptId);
        if (attType === 'sub_tenant' && subTenantId) data.sub_tenant_id = parseInt(subTenantId);
        // 考勤打卡范围：仅「可见且可配」时才提交（否则不带该字段，后端会保留原值，避免把已有范围清空）
        if (this._canConfigGeo) {
            data.location_ranges = this._collectGeoRanges();
        }
        // 两个集团级开关：仅集团默认配置 + 超管可改（后端也会二次校验）
        if (attType === 'global' && this._canSetGeoSwitch) {
            var sw = document.getElementById('attGeoRequired');
            if (this._canConfigGeo) data.location_required = !!(sw && sw.checked);
            var vis = document.getElementById('attGeoConfigVisible');
            // 关闭显示时一并把总开关关掉，避免"看不到范围却仍在强制校验"的困惑
            data.location_config_visible = !!(vis && vis.checked);
            if (!data.location_config_visible) data.location_required = false;
        }
        if (attType === 'user' && userId) data.user_id = parseInt(userId);
        var url = OA_API_URL + '/attendance/save-attendance-config/';
        if (attType === 'user') url = OA_API_URL + '/attendance/save-user-attendance-config/';
        try {
            var resp = await fetch(url, {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            if (!resp.ok) {
                var err = await resp.json();
                throw new Error(err.error || err.detail || '保存失败');
            }
            this.showToast('考勤配置保存成功', false);
            this._loadAttConfigList();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    }

    async _deleteConfig() {
        if (!this._configDeleteId) { this.showAlert('提示', '未找到配置ID'); return; }
        var confirmed = await this.showConfirmDialog('删除配置', '确定要删除当前考勤配置吗？删除后不可恢复。', 'danger');
        if (!confirmed) return;
        try {
            var url = OA_API_URL + '/attendance/delete-attendance-config/' + this._configDeleteId + '/';
            if (this._configAttType === 'user') url = OA_API_URL + '/attendance/delete-user-attendance-config/' + this._configDeleteId + '/';
            var resp = await fetch(url, {
                method: 'DELETE',
                headers: TokenManager.getHeaders(),
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.showToast('配置已删除', false);
            this._configDeleteId = null;
            this._configEditKey = null;
            document.getElementById('attendanceConfigForm').style.display = 'none';
            document.getElementById('attendanceConfigFooter').style.display = 'none';
            document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
            document.getElementById('attendanceConfigEmpty').style.display = 'block';
            this._renderConfigMeta(null);
            await this._loadAttConfigList();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    }

    // ──────── 考勤日历 ────────

    _openCalendar() {
        this._calYear = new Date().getFullYear();
        this._calMonth = new Date().getMonth() + 1;
        this._renderCalendar();
        document.getElementById('attendanceCalendarModal').style.display = 'flex';
        setTimeout(function() {
            document.getElementById('attendanceCalendarModal').classList.add('show');
        }, 10);
    }

    _closeCalendar() {
        var modal = document.getElementById('attendanceCalendarModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() { modal.style.display = 'none'; }, 200);
        }
    }

    _calPrevMonth() {
        this._calMonth--;
        if (this._calMonth < 1) { this._calMonth = 12; this._calYear--; }
        this._renderCalendar();
    }

    _calNextMonth() {
        this._calMonth++;
        if (this._calMonth > 12) { this._calMonth = 1; this._calYear++; }
        this._renderCalendar();
    }

    async _renderCalendar() {
        var year = this._calYear, month = this._calMonth;
        document.getElementById('calYearMonth').textContent = year + '年' + month + '月';
        var grid = document.getElementById('calGrid');
        if (!grid) return;
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            var data = await this.apiGet(OA_API_URL + '/attendance/calendar-stats/?year=' + year + '&month=' + month);
            var days = data.days || [];
            var summary = data.summary || {};
            document.getElementById('calNormalCount').textContent = summary.normal || 0;
            document.getElementById('calLateCount').textContent = summary.late || 0;
            document.getElementById('calMissCount').textContent = summary.miss_clock || 0;
            document.getElementById('calAbsentCount').textContent = summary.absent || 0;
            document.getElementById('calLeaveCount').textContent = summary.leave || 0;
            document.getElementById('calRestCount').textContent = summary.rest || 0;
            var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            var html = '';
            weekDays.forEach(function(wd) {
                html += '<div style="font-size:12px;font-weight:600;color:var(--text-light,#909399);padding:6px 0;">' + wd + '</div>';
            });
            var firstDay = new Date(year, month - 1, 1).getDay();
            var dayMap = {};
            days.forEach(function(d) { dayMap[d.date] = d; });
            for (var e = 0; e < firstDay; e++) {
                html += '<div style="min-height:70px;"></div>';
            }
            for (var d = 1; d <= (summary.total || 30); d++) {
                var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                var info = dayMap[dateStr] || { day_status: 'none', day_label: '' };
                var status = info.day_status || 'none';
                var bgColor = '#fff';
                var textColor = 'var(--text-primary)';
                var dotColor = '';
                if (status === 'normal') { bgColor = '#f0f9eb'; dotColor = '#67c23a'; }
                else if (status === 'late') { bgColor = '#fdf6ec'; dotColor = '#e6a23c'; }
                else if (status === 'miss_clock') { bgColor = '#fef0f0'; dotColor = '#f56c6c'; }
                else if (status === 'absent') { bgColor = '#f5f5f5'; dotColor = '#909399'; textColor = '#bbb'; }
                else if (status === 'future') { bgColor = '#fafafa'; textColor = '#ccc'; }
                else if (status === 'leave') { bgColor = '#ecf5ff'; dotColor = '#409eff'; }
                else if (status === 'rest') { bgColor = '#f0f2f5'; dotColor = '#a0a4ab'; textColor = '#999'; }
                var tooltip = '';
                if (info.clock_in && info.clock_out) {
                    tooltip = '上班:' + (info.clock_in.time || '') + ' 下班:' + (info.clock_out.time || '');
                } else if (info.clock_in) {
                    tooltip = '上班:' + (info.clock_in.time || '') + ' 未下班打卡';
                } else if (info.clock_out) {
                    tooltip = '未上班打卡 下班:' + (info.clock_out.time || '');
                }
                var labelHtml = '<span style="font-weight:600;font-size:15px;">' + d + '</span>';
                if (dotColor) {
                    labelHtml += '<div style="width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin:2px auto 0;"></div>';
                }
                if (info.day_label) {
                    labelHtml += '<div style="font-size:9px;color:' + textColor + ';margin-top:1px;">' + info.day_label + '</div>';
                }
                html += '<div class="cal-cell cal-' + status + '" onclick="attendanceApp._showCalDayDetail(\'' + dateStr + '\')" title="' + this._escape(tooltip || dateStr) + '" style="min-height:68px;background:' + bgColor + ';border-radius:6px;padding:4px;text-align:center;cursor:pointer;transition:all 0.15s;border:1px solid transparent;' + (status === 'none' ? 'opacity:0.3;' : '') + '">' + labelHtml + '</div>';
            }
            grid.innerHTML = html;
        } catch (e) {
            console.error('加载考勤日历失败:', e);
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:#f56c6c;">加载失败</div>';
        }
    }

    async _showCalDayDetail(dateStr) {
        try {
            var data = await this.apiGet(OA_API_URL + '/attendance/calendar-day-detail/?date=' + dateStr);
            if (!data) return;
            var title = dateStr + ' 打卡详情';
            var body = '<div style="padding:8px 0;">';
            // Clock-in info
            var ci = data.clock_in;
            var co = data.clock_out;
            var statusMap = {'normal': '正常', 'late': '迟到', 'early_leave': '早退'};
            if (ci) {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f0f9eb;border-radius:8px;margin-bottom:8px;border-left:3px solid #67c23a;">'
                    + '<i class="fas fa-sign-in-alt" style="color:#52c41a;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">上班打卡</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">时间: ' + this._escape(ci.clock_time ? this._formatTime(ci.clock_time) : '') + '</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">状态: <span class="status-badge ' + (ci.status || 'normal') + '">' + (statusMap[ci.status] || ci.status || '正常') + '</span></div>'
                    + (ci.location ? '<div style="font-size:12px;color:#909399;">位置: ' + this._escape(ci.location) + '</div>' : '')
                    + '</div></div>';
            } else {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f5f5f5;border-radius:8px;margin-bottom:8px;border-left:3px solid #909399;color:#909399;">'
                    + '<i class="fas fa-sign-in-alt" style="color:#bbb;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">上班打卡</div><div style="font-size:13px;">未打卡</div></div></div>';
            }
            if (co) {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fef3e0;border-radius:8px;margin-bottom:8px;border-left:3px solid #e6a23c;">'
                    + '<i class="fas fa-sign-out-alt" style="color:#e6a23c;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">下班打卡</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">时间: ' + this._escape(co.clock_time ? this._formatTime(co.clock_time) : '') + '</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">状态: <span class="status-badge ' + (co.status || 'normal') + '">' + (statusMap[co.status] || co.status || '正常') + '</span></div>'
                    + (co.location ? '<div style="font-size:12px;color:#909399;">位置: ' + this._escape(co.location) + '</div>' : '')
                    + '</div></div>';
            } else {
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f5f5f5;border-radius:8px;margin-bottom:8px;border-left:3px solid #909399;color:#909399;">'
                    + '<i class="fas fa-sign-out-alt" style="color:#bbb;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">下班打卡</div><div style="font-size:13px;">未打卡</div></div></div>';
            }
            // Overtime info
            if (data.overtime) {
                var ot = data.overtime;
                body += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f3e8ff;border-radius:8px;margin-bottom:8px;border-left:3px solid #9b59b6;">'
                    + '<i class="fas fa-clock" style="color:#9b59b6;font-size:18px;"></i>'
                    + '<div><div style="font-weight:600;font-size:14px;">加班</div>'
                    + '<div style="font-size:13px;color:var(--text-secondary);">时数: ' + (ot.duration || 0) + ' 小时</div>'
                    + (ot.content ? '<div style="font-size:12px;color:#606266;margin-top:2px;">内容: ' + this._escape(ot.content) + '</div>' : '')
                    + (ot.title ? '<div style="font-size:12px;color:#909399;margin-top:2px;">审批: ' + this._escape(ot.title) + '</div>' : '')
                    + '</div></div>';
            }
            body += '</div>';
            // Show in a temporary dialog
            this.showAlert(title, body);
        } catch (e) {
            console.error('加载日期详情失败:', e);
        }
    }

}


// // 全局初始化
// let attendanceApp = null;
//
// // 确保在 DOM 加载完成后初始化 attendanceApp
// if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', () => {
//         attendanceApp = new AttendanceApp();
//         window.attendanceApp = attendanceApp;
//     });
// } else {
//     // 如果 DOM 已经加载完成，直接初始化
//     attendanceApp = new AttendanceApp();
//     window.attendanceApp = attendanceApp;
// }
