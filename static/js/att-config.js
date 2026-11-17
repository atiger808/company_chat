// static/js/att-config.js - 考勤配置与地图范围
// 说明：本文件为 AttendanceApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(AttendanceApp.prototype, {

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
    },

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
        this._setPhotoSwitch(false);
        this._syncPhotoSwitchVisibility(type);
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
    },

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
    },

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
                    this._setPhotoSwitch(cfg.photo_clock_enabled === true);
                }
                this._renderConfigMeta(cfg);
            } else {
                // 该层级还没有配置：范围清空（留空即沿用上一层）
                this._setGeoRanges([]);
                if (type === 'global') {
                    this._setGeoSwitch(false);
                    this._setPhotoSwitch(false);
                }
                this._renderConfigMeta(null);
            }
            this._syncGeoSwitchVisibility(type);
            this._syncPhotoSwitchVisibility(type);
            this._loadAttConfigList();
        } catch (e) {
            console.warn('加载配置失败', e);
        }
    },

    async _loadAttConfigSubTenantSelect() {
        // 已合并到 _loadAttSubTenants 中
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    // 判断异常是否属于「百度命名空间还处于半加载状态」——这类错误应当继续等待重试，
    // 而不是当成失败弹给用户看（例如 `new NS.Map` 的 "undefined is not a constructor"）。
    _isNsHalfLoadedError(e) {
        var m = String((e && e.message) || '');
        return m.indexOf('is not a constructor') > -1
            || m.indexOf('is not a function') > -1
            || m.indexOf("reading 'Map'") > -1
            || m.indexOf('reading "Map"') > -1
            || m.indexOf('of null') > -1 || m.indexOf('of undefined') > -1;
    },

    _geoMapReady() {
        return !!this._geoMapNS();
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    _setGeoSwitch(on) {
        var el = document.getElementById('attGeoRequired');
        if (el) el.checked = !!on;
    },

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
    },

    // 是否显示「考勤打卡范围配置」（集团默认配置上的开关，仅超管可改）
    _setGeoVisible(on) {
        var el = document.getElementById('attGeoConfigVisible');
        if (el) el.checked = !!on;
    },

    // 拍照打卡总开关：仅集团默认配置 + 超级管理员可改（后端二次校验）
    _setPhotoSwitch(on) {
        var el = document.getElementById('attPhotoClockEnabled');
        if (el) el.checked = !!on;
    },

    _syncPhotoSwitchVisibility(type) {
        var isSuperAdmin = localStorage.getItem('user_type') === 'super_admin';
        var row = document.getElementById('attPhotoClockRow');
        if (row) {
            row.style.display = (isSuperAdmin && this._canSetPhotoSwitch && type === 'global') ? 'block' : 'none';
        }
    },

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
    },

    _addGeoRange() {
        this._geoRanges = this._geoRanges || [];
        if (this._geoRanges.length >= 50) { this.showToast('最多 50 个打卡点', true); return; }
        this._geoRanges.push({name: '打卡点' + (this._geoRanges.length + 1), radius: 300,
                              enabled: true,
                              bd09_lat: null, bd09_lng: null, lat: null, lng: null});
        this._geoEditingIndex = this._geoRanges.length - 1;
        this._renderGeoRanges();
        this._drawGeoRanges();
    },

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
    },

    _enabledGeoCount() {
        return (this._geoRanges || []).filter(function (r) { return r.enabled !== false; }).length;
    },

    _removeGeoRange(i) {
        this._geoRanges = this._geoRanges || [];
        if (i < 0 || i >= this._geoRanges.length) return;
        this._geoRanges.splice(i, 1);
        if (this._geoEditingIndex >= this._geoRanges.length) this._geoEditingIndex = this._geoRanges.length - 1;
        this._renderGeoRanges();
        this._drawGeoRanges();
    },

    _editGeoRange(i) {
        this._geoEditingIndex = i;
        this._renderGeoRanges();
        var r = (this._geoRanges || [])[i];
        var NS = this._geoMapNS();
        if (r && r.bd09_lat != null && this._baiduMap && NS) {
            this._baiduMap.panTo(new NS.Point(r.bd09_lng, r.bd09_lat));
        }
    },

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
    },

    _geoRangeText(r) {
        if (r.bd09_lat != null && r.bd09_lng != null) {
            return '圆心(BD09)：' + Number(r.bd09_lat).toFixed(6) + ', ' + Number(r.bd09_lng).toFixed(6);
        }
        if (r.lat != null && r.lng != null) {
            return '圆心(WGS84)：' + Number(r.lat).toFixed(6) + ', ' + Number(r.lng).toFixed(6);
        }
        return '尚未设定圆心';
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
            // 拍照打卡总开关是否可编辑（仅最顶层集团 + 超管）
            this._canSetPhotoSwitch = json.can_set_photo_switch === true;
            if (json.photo_clock_enabled !== undefined) {
                this._setPhotoSwitch(json.photo_clock_enabled === true);
            }
            // 打卡范围配置是否可见/可配（后端已按角色裁剪，超管且开关打开才为真）
            this._geoVisible = !!(json.geo_config && json.geo_config.can_config);
            this._setGeoVisible(json.geo_config ? json.geo_config.visible : false);
            this._syncGeoSwitchVisibility(this._configAttType);
            this._syncPhotoSwitchVisibility(this._configAttType);
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
    },

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
    },

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
    },

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
    },

    _clearAttUser() {
        this._attConfigUser = null;
        this._renderAttUserTag();
        this._configEditKey = null;
        this._configDeleteId = null;
        document.getElementById('attendanceConfigDeleteBtn').style.display = 'none';
    },

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
    },

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
    },

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
    },

    _onConfigSubTenantChange() {
        this._loadAttConfigList();
    },

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
    },

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
    },

    _getShiftType() {
        var night = document.getElementById('attShiftNight');
        return night && night.checked ? 'night' : 'day';
    },

    _setShiftType(val) {
        var day = document.getElementById('attShiftDay');
        var night = document.getElementById('attShiftNight');
        var isNight = val === 'night';
        if (day) day.checked = !isNight;
        if (night) night.checked = isNight;
        var hint = document.getElementById('attShiftNightHint');
        if (hint) hint.style.display = isNight ? 'block' : 'none';
    },

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
    },

    _toggleClockIn() {
        var enabled = document.getElementById('attendanceClockInEnabled').checked;
        var group = document.getElementById('attendanceClockInTimeGroup');
        if (group) group.style.display = enabled ? 'block' : 'none';
    },

    _toggleClockOut() {
        var enabled = document.getElementById('attendanceClockOutEnabled').checked;
        var group = document.getElementById('attendanceClockOutTimeGroup');
        if (group) group.style.display = enabled ? 'block' : 'none';
    },

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
        // 拍照打卡总开关：仅集团默认配置 + 超管可改（后端也会二次校验）
        if (attType === 'global' && this._canSetPhotoSwitch) {
            var photoSw = document.getElementById('attPhotoClockEnabled');
            data.photo_clock_enabled = !!(photoSw && photoSw.checked);
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
            // 保存接口会返回完整配置（含已有打卡范围），用于即时回填范围区块
            var saved = null;
            try {
                var rawSaved = await resp.json();
                saved = rawSaved && rawSaved.encrypt && window.EncryptUtils
                    ? window.EncryptUtils.decryptPacket(rawSaved) : rawSaved;
            } catch (e) { saved = null; }
            this.showToast('考勤配置保存成功', false);
            // 「显示考勤打卡范围配置」保存后立即生效，无需重新打开配置模态框：
            // 开启 → 立刻展示范围配置区块并初始化地图；关闭 → 立刻隐藏（同时收起总开关，与后端一致）
            if (attType === 'global' && this._canSetGeoSwitch) {
                var visNow = document.getElementById('attGeoConfigVisible');
                var visibleNow = !!(visNow && visNow.checked);
                this._geoVisible = visibleNow
                    && localStorage.getItem('user_type') === 'super_admin';
                if (!visibleNow) {
                    this._setGeoSwitch(false);
                }
                this._syncGeoSwitchVisibility(this._configAttType);
                if (this._geoVisible) {
                    // 之前开关关闭时后端不会下发范围数据；这里用保存接口返回的完整配置回填，
                    // 否则区块虽然显示了，但历史打卡点会是空的。
                    var ranges = this._geoRanges || [];
                    if (saved && (saved.location_ranges_map || saved.location_ranges)) {
                        ranges = saved.location_ranges_map || saved.location_ranges;
                    }
                    this._setGeoSwitch(saved ? saved.location_required === true : false);
                    var self = this;
                    // 等区块从 display:none 变为可见后再初始化/校正地图尺寸
                    setTimeout(function () {
                        self._setGeoRanges(ranges);
                        self._ensureGeoMap();
                    }, 60);
                }
            }
            this._loadAttConfigList();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    },

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
    },
    });
})();
