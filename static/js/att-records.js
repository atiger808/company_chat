// static/js/att-records.js - 我的定位地图、打卡详情/照片、申诉、导出打印
// 说明：本文件为 AttendanceApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(AttendanceApp.prototype, {

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
    },

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
    },

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
    },

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
    },

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
    },

    // AK 校验失败的原始文案（模板里的 alert 拦截器记录在 window.__baiduAkError）
    _geoAkReason() {
        var akErr = this._geoAkError || window.__baiduAkError;
        return akErr ? ('百度返回：' + akErr) : '可能是网络较慢，或 AK 校验未通过';
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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
    },

    _exitMyGeoFullscreen() {
        if (!this._myGeoFullscreenOn) return;
        this._toggleMyGeoFullscreen(document.getElementById('myGeoFsBtn'));
    },

    // 卡片尺寸变化（全屏切换 / 旋转屏幕）后重算地图画布，否则地图仍是旧尺寸
    _refreshMyGeoMapLayout() {
        var self = this;
        setTimeout(function () {
            if (self._myGeoMap && self._myGeoMap.checkResize) {
                try { self._myGeoMap.checkResize(); } catch (e) { /* 忽略 */ }
            }
        }, 150);
    },

    // 兼容旧调用名
    async loadGeoHint() { return this.refreshMyGeo(); },

    // 申诉/补卡申请（联动 OA 审批，审批通过后自动恢复为正常考勤）
    async openAppeal(date, clockType, anomalyType, targetUserId) {
        // 仅允许本人对本人考勤发起申诉/补卡，管理员也不能代其他成员操作
        var selfId = parseInt(localStorage.getItem('user_id'));
        if (targetUserId !== undefined && targetUserId !== null && targetUserId !== ''
            && parseInt(targetUserId) !== selfId) {
            this.showToast('只能对本人考勤发起申诉/补卡申请', true);
            return;
        }
        var labels = {late: '迟到', early_leave: '早退', missing_clock: '缺卡', absent: '缺勤', location_abnormal: '地点异常'};
        var isWholeDay = (clockType === 'day') || (anomalyType === 'absent');
        var label = isWholeDay ? '全天缺勤' : (labels[anomalyType] || anomalyType);
        // 同日期同时段已发起过申诉/补卡申请时直接提示，不再重复发起
        try {
            var check = await this.apiGet(OA_API_URL + '/attendance/appeal-status/?date='
                + encodeURIComponent(date || '') + '&clock_type=' + encodeURIComponent(clockType || 'day'));
            if (check && check.exists) {
                this.showToast('该日期该时段的申诉/补卡申请已发起（' + (check.status_display || '处理中') + '），请勿重复提交', true);
                return;
            }
        } catch (e) { /* 查询失败不阻断，后端提交时仍会做唯一性校验 */ }
        // 提交前校验：该日期/卡种确实存在缺卡或考勤异常，避免对正常考勤发起无效申诉
        try {
            var elig = await this.apiGet(OA_API_URL + '/attendance/appeal-eligibility/?date='
                + encodeURIComponent(date || '') + '&clock_type=' + encodeURIComponent(clockType || 'day'));
            if (elig && elig.eligible === false) {
                this.showToast(elig.reason || '该日期没有缺卡或考勤异常，无需申诉', true);
                return;
            }
        } catch (e) { /* 查询失败不阻断，后端提交时仍会校验 */ }

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = '<div style="background:var(--bg-primary,#fff);border-radius:12px;max-width:460px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,.2);">'
            + '<div style="padding:16px 20px;border-bottom:1px solid var(--border-color,#ebeef5);font-size:16px;font-weight:600;"><i class="fas fa-balance-scale" style="color:#e6a23c;"></i> 考勤申诉 · ' + this._escape(date) + ' ' + this._escape(label) + '</div>'
            + '<div style="padding:16px 20px;"><div style="font-size:13px;color:#909399;margin-bottom:10px;">补卡次数不足或无法补卡时，可提交申诉，审批通过后该异常考勤自动恢复为正常。'
            + (isWholeDay ? '全天申诉审批通过后将同时补录上班卡与下班卡。' : '')
            + '</div>'
            + '<textarea id="appealReasonInput" class="form-textarea" rows="4" placeholder="请填写申诉/补卡说明（必填）" style="width:100%;"></textarea></div>'
            + '<div style="padding:12px 20px;border-top:1px solid var(--border-color,#ebeef5);display:flex;gap:8px;justify-content:flex-end;">'
            + '<button class="btn btn-secondary" data-act="cancel">取消</button>'
            + '<button class="btn btn-primary" data-act="submit"><i class="fas fa-paper-plane"></i> 提交申诉</button></div></div>';
        document.body.appendChild(overlay);
        var close = function() { overlay.remove(); };
        overlay.querySelector('[data-act="cancel"]').onclick = close;
        overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
        var self = this;
        var submitting = false;
        overlay.querySelector('[data-act="submit"]').onclick = async function() {
            if (submitting) return;
            var reason = (document.getElementById('appealReasonInput').value || '').trim();
            if (!reason) { self.showToast('请填写申诉说明', true); return; }
            var submitBtn = overlay.querySelector('[data-act="submit"]');
            var payload = {
                approval_type: 'attendance_appeal',
                title: '考勤申诉：' + date + ' ' + label,
                content: reason,
                start_date: date,
                end_date: date,
                form_data: {
                    date: date,
                    clock_type: clockType || 'day',
                    anomaly_type: anomalyType,
                    reason: reason
                }
                // 审批方式/模式与审批链由后端读取「考勤申诉/补卡申请」类型配置生成
            };
            submitting = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...';
            }
            try {
                var resp = await fetch(OA_API_URL + '/approval/', {
                    method: 'POST',
                    headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                    body: JSON.stringify(payload)
                });
                var raw = await resp.json().catch(function() { return {}; });
                var data = (raw && raw.encrypt && window.EncryptUtils) ? window.EncryptUtils.decryptPacket(raw) : raw;
                if (!resp.ok) throw new Error((data && (data.error || data.detail)) || '提交失败');
                close();
                self.showToast('申诉已提交，等待审批通过后自动恢复考勤', false);
            } catch (e) {
                submitting = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 提交申诉';
                }
                self.showToast((e && e.message) || '提交失败', true);
            }
        };
    },

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
            + '<option value="100" ' + (this.pageSize === 100 ? 'selected' : '') + '>100</option>'
            + '<option value="200" ' + (this.pageSize === 200 ? 'selected' : '') + '>200</option>'
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
    },

    async showDetail(id) {
        this._closePhotoPreview();
        id = String(id);
        if (id.indexOf('v:') === 0) {
            this._showVirtualDetail(id);
            return;
        }
        try {
            const d = await this.apiGet(OA_API_URL + '/attendance/' + id + '/');
            const statusMap = {
                'normal': '正常', 'late': '迟到', 'early_leave': '早退',
                'missing_clock': '缺卡', 'absent': '缺勤', 'rest': '休息',
                'location_abnormal': '地点异常', 'leave': '请假', 'trip': '出差'
            };
            const avatar = d.avatar_url || '/static/images/default-avatar.png';
            const photoFull = d.photo_url || d.photo_compressed_url || '';
            const photoShow = d.photo_compressed_url || d.photo_url || '';
            var isSuperAdmin = localStorage.getItem('user_type') === 'super_admin';
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
                + (photoFull
                    ? '<div class="detail-item" style="margin-top:12px;grid-column:1/-1;"><label>打卡照片</label>'
                    + '<img src="' + String(photoShow).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" alt="打卡照片" '
                    + 'onclick="attendanceApp._showPhotoPreview(\'' + String(photoFull).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;') + '\')" '
                    + 'style="max-width:100%;max-height:260px;border-radius:8px;border:1px solid var(--border-color,#ebeef5);cursor:zoom-in;display:block;">'
                    + '<div style="font-size:12px;color:#909399;margin-top:4px;"><i class="fas fa-info-circle"></i> 点击照片放大预览，再次点击返回；预览时右上角可全屏查看</div>'
                    + '</div>' : '')
                + ((d.face_photo_url && isSuperAdmin)
                    ? '<div class="detail-item"><label>人脸照片</label>'
                    + '<img src="' + String(d.face_photo_url).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" alt="人脸照片" '
                    + 'onclick="attendanceApp._showPhotoPreview(this.src)" '
                    + 'style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color,#ebeef5);cursor:zoom-in;display:block;">'
                    + ((d.face_meta && d.face_meta.blur)
                        ? '<div style="font-size:12px;color:#909399;margin-top:4px;">清晰度 ' + Math.round(d.face_meta.blur)
                          + (d.face_meta.score ? ' · 置信度 ' + Math.round(d.face_meta.score * 100) + '%' : '') + '</div>'
                        : '')
                    + '</div>' : '')
                + ((d.face_meta && d.face_meta.skipped)
                    ? '<div class="detail-item"><label>人脸检测</label><span style="color:#e6a23c;">已跳过（组件不可用）</span></div>' : '')
                + ((d.camera_info && d.camera_info.label)
                    ? '<div class="detail-item"><label>相机设备</label><span>' + this._escape(d.camera_info.label)
                    + (d.camera_info.width ? '（' + this._escape(String(d.camera_info.width)) + '×' + this._escape(String(d.camera_info.height || '')) + '）' : '')
                    + '</span></div>' : '')
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
    },

    // ==================== 打卡照片预览 / 全屏 ====================
    closeDetailModal() {
        this._closePhotoPreview();
        var modal = document.getElementById('attendanceDetailModal');
        if (modal) {
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
    },

    _bindPhotoPreviewEsc() {
        if (this._photoEscBound) return;
        this._photoEscBound = true;
        var self = this;
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!self._photoPreviewOverlay) return;
            if (self._photoFullscreen) {
                self._setPhotoFullscreen(false);
            } else {
                self._closePhotoPreview();
            }
        });
    },

    _showPhotoPreview(src) {
        this._closePhotoPreview();
        this._bindPhotoPreviewEsc();

        var overlay = document.createElement('div');
        overlay.id = 'attPhotoPreviewOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:24px;';
        overlay.innerHTML = '<img id="attPhotoPreviewImg" src="' + String(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" alt="打卡照片" '
            + 'style="max-width:90vw;max-height:82vh;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.5);cursor:zoom-out;user-select:none;">'
            + '<button id="attPhotoPreviewFullBtn" title="全屏预览" style="position:absolute;top:18px;right:18px;width:42px;height:42px;border-radius:50%;border:none;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">'
            + '<i class="fas fa-expand"></i></button>';
        document.body.appendChild(overlay);

        var self = this;
        overlay.querySelector('#attPhotoPreviewImg').onclick = function () {
            // 全屏时点击图片退出全屏（回到预览）；预览时点击图片关闭预览
            if (self._photoFullscreen) {
                self._setPhotoFullscreen(false);
            } else {
                self._closePhotoPreview();
            }
        };
        overlay.querySelector('#attPhotoPreviewFullBtn').onclick = function (e) {
            e.stopPropagation();
            self._setPhotoFullscreen(!self._photoFullscreen);
        };
        overlay.onclick = function (e) {
            if (e.target === overlay) self._closePhotoPreview();
        };

        this._photoPreviewOverlay = overlay;
        this._photoFullscreen = false;
    },

    _setPhotoFullscreen(on) {
        var overlay = this._photoPreviewOverlay;
        if (!overlay) return;
        var img = overlay.querySelector('#attPhotoPreviewImg');
        var btn = overlay.querySelector('#attPhotoPreviewFullBtn');
        this._photoFullscreen = !!on;
        if (on) {
            overlay.style.background = '#000';
            overlay.style.padding = '0';
            img.style.maxWidth = '100vw';
            img.style.maxHeight = '100vh';
            img.style.borderRadius = '0';
            if (btn) {
                btn.title = '退出全屏';
                btn.innerHTML = '<i class="fas fa-compress"></i>';
            }
        } else {
            overlay.style.background = 'rgba(0,0,0,.82)';
            overlay.style.padding = '24px';
            img.style.maxWidth = '90vw';
            img.style.maxHeight = '82vh';
            img.style.borderRadius = '10px';
            if (btn) {
                btn.title = '全屏预览';
                btn.innerHTML = '<i class="fas fa-expand"></i>';
            }
        }
    },

    _closePhotoPreview() {
        var overlay = this._photoPreviewOverlay
            || document.getElementById('attPhotoPreviewOverlay');
        if (overlay) overlay.remove();
        this._photoPreviewOverlay = null;
        this._photoFullscreen = false;
    },

    _showVirtualDetail(key) {
        var r = (this._rowCache || {})[key] || {};
        var parts = key.split(':');
        var statusMap = {
            missing_clock: '缺卡', absent: '缺勤', rest: '休息',
            location_abnormal: '地点异常', leave: '请假', trip: '出差'
        };
        var st = r.status || parts[3] || '';
        var html = '<div class="detail-grid">'
            + '<div class="detail-item"><label>用户</label><span>' + this._escape(r.user_name || '') + '</span></div>'
            + '<div class="detail-item"><label>部门</label><span>' + this._escape(r.department_name || '-') + '</span></div>'
            + '<div class="detail-item"><label>日期</label><span>' + this._escape(r.date || parts[2] || '-') + '</span></div>'
            + '<div class="detail-item"><label>类型</label><span>' + this._escape(r.clock_type_display || '-') + '</span></div>'
            + '<div class="detail-item"><label>状态</label><span class="status-badge ' + this._escape(st) + '">' + this._escape(r.status_display || statusMap[st] || st) + '</span></div>'
            + '<div class="detail-item"><label>说明</label><span>' + this._escape(r.remark || '-') + '</span></div>'
            + '</div><div style="margin-top:10px;font-size:12px;color:#909399;"><i class="fas fa-info-circle"></i> 该记录为系统按考勤规则自动生成的状态记录（非实际打卡）。</div>';
        var selfId = parseInt(localStorage.getItem('user_id'));
        var isSelf = r.user !== undefined && r.user !== null && Number(r.user) === selfId;
        if (isSelf && ['late', 'early_leave', 'missing_clock', 'absent', 'location_abnormal'].indexOf(st) !== -1) {
            html += '<div style="margin-top:12px;text-align:right;"><button class="btn btn-primary btn-sm" onclick="attendanceApp.openAppeal(\'' + (r.date || parts[2] || '') + '\',\'' + (r.clock_type || parts[4] || 'day') + '\',\'' + st + '\',' + Number(r.user) + ')"><i class="fas fa-balance-scale"></i> 申诉/补卡申请</button></div>';
        }
        this.showAlert('考勤状态详情', html);
    },

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
    },

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
    },

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
    },

    exportRecords() {
        this._showExportPrintModal('export');
    },

    printRecords() {
        this._showExportPrintModal('print');
    },

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
    },

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
        var statusMap = {'normal':'正常','late':'迟到','early_leave':'早退','missing_clock':'缺卡','absent':'缺勤','rest':'休息','location_abnormal':'地点异常','leave':'请假','trip':'出差'};
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
    },

    // 确保网盘目录存在（不存在自动创建），返回目录 id
    async _ensureCloudFolder(name) {
        var resp = await fetch('/api/cloud/folders/ensure/', {
            method: 'POST',
            headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
            body: JSON.stringify({name: name})
        });
        var data = await resp.json().catch(function() { return {}; });
        if (!resp.ok || !data.id) throw new Error((data && data.error) || '创建网盘目录失败');
        return data.id;
    },

    _doExportRecords(selectedFields, target) {
        var self = this;
        var token = localStorage.getItem('access_token');
        if (!token) { this.showAlert('提示', '登录已过期，请重新登录'); return; }
        this.showToast(target === 'cloud' ? '正在生成并保存到网盘，请稍候...' : '正在生成考勤导出文件，请稍候...', false);
        var url = OA_API_URL + '/attendance/export/';
        var ids = Array.from(this._getSelectedIds());
        var payload = {
            target: target,
            record_ids: ids,
            fields: selectedFields || [],
            start: (this.state && this.state.start) || '',
            end: (this.state && this.state.end) || ''
        };
        var exportHeaders = Object.assign({}, TokenManager.getHeaders(), { 'Content-Type': 'application/json' });
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
                method: 'POST',
                headers: exportHeaders,
                body: JSON.stringify(payload)
            }).then(function(resp) {
                if (!resp.ok) { throw new Error('导出失败 ' + resp.status); }
                return resp.blob();
            }).then(function(blob) {
                var file = new File([blob], filename, {type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
                // 默认保存到「文档（来自考勤）」，不存在则自动创建
                return self._ensureCloudFolder('文档（来自考勤）').then(function(folderId) {
                    return Utils.uploadToCloud(file, folderId, '考勤记录');
                });
            }).then(function() {
                self.showAlert('成功', '已保存到网盘 / 文档（来自考勤）');
            }).catch(function(err) {
                self.showAlert('错误', '保存到网盘失败：' + err.message);
            });
        } else {
            fetch(url, {
                method: 'POST',
                headers: exportHeaders,
                body: JSON.stringify(payload)
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
                self.showToast('考勤记录导出成功', false);
            }).catch(function(err) {
                self.showAlert('错误', '导出失败：' + err.message);
            });
        }
    },
    });
})();
