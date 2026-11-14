// static/js/tts.js - 浏览器语音合成（朗读）通用工具
(function () {
    var synth = window.speechSynthesis;
    var supported = !!(synth && window.SpeechSynthesisUtterance);
    var speaking = false;
    var paused = false;
    var total = 0;
    var done = 0;
    var token = 0;
    var sequenceDriver = null;   // iOS 合并朗读的高亮推进定时器

    // 倍速选项：修改后需要重启当前朗读队列才能生效（Web Speech API 不支持中途改 rate）
    var RATES = [2, 1.5, 1.25, 1, 0.75];
    var RATE_LABELS = {'2': '2.0X', '1.5': '1.5X', '1.25': '1.25X', '1': '1.0X', '0.75': '0.75X'};
    var RATE_MENU_LABELS = {'2': '2.0X', '1.5': '1.5X', '1.25': '1.25X', '1': '1.0X（正常）', '0.75': '0.75X'};
    var savedRate = 1;
    try {
        var storedRate = parseFloat(localStorage.getItem('browser_tts_rate'));
        if (RATES.indexOf(storedRate) >= 0) savedRate = storedRate;
    } catch (e) { /* localStorage 不可用时用默认值 */ }

    var floatEl = null;

    function stopSequenceDriver() {
        if (sequenceDriver) { clearInterval(sequenceDriver); sequenceDriver = null; }
    }
    // iOS/iPadOS：Safari 对多段排队兼容性差（常见只读第一段），整段一次朗读最稳
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    function normalize(text) {
        return String(text || '')
            .replace(/ /g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\s*\n\s*/g, '。')
            .replace(/。{2,}/g, '。')
            .trim();
    }

    // 按标点切分，单段不超过 180 字，避免部分浏览器长文本被截断
    function chunk(text) {
        var parts = [];
        var buf = '';
        var chars = String(text || '').split('');
        for (var i = 0; i < chars.length; i++) {
            buf += chars[i];
            if (buf.length >= 180 || /[。！？!?；;]/.test(chars[i])) {
                if (buf.trim()) parts.push(buf.trim());
                buf = '';
            }
        }
        if (buf.trim()) parts.push(buf.trim());
        return parts;
    }

    function pickVoice() {
        var voices = [];
        try { voices = synth.getVoices() || []; } catch (e) { voices = []; }
        return voices.filter(function (v) { return v.lang === 'zh-CN'; })[0]
            || voices.filter(function (v) { return v.lang && v.lang.indexOf('zh') === 0; })[0]
            || null;
    }

    function setBtn(btn, on) {
        if (!btn) return;
        btn.classList.toggle('tts-speaking', !!on);
        var icon = btn.querySelector('i');
        if (icon) icon.className = on ? 'fas fa-stop' : 'fas fa-volume-up';
        var label = btn.querySelector('span');
        if (label) label.textContent = on ? '停止' : '朗读';
        btn.title = on ? '停止朗读' : '朗读';
    }

    // ==================== 悬浮控制面板 ====================
    function injectFloatStyle() {
        if (document.getElementById('browserTtsFloatStyle')) return;
        var style = document.createElement('style');
        style.id = 'browserTtsFloatStyle';
        style.textContent = ''
            + '#browserTtsFloat{position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:3000;'
            + 'display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 7px;border-radius:24px;'
            + 'background:linear-gradient(160deg,#7c4dff,#a06bff);box-shadow:0 8px 24px rgba(124,77,255,.38);'
            + 'color:#fff;user-select:none;animation:ttsFloatIn .22s ease-out;}'
            + '#browserTtsFloat .tts-float-btn{width:34px;height:34px;border:none;border-radius:50%;'
            + 'background:rgba(255,255,255,.18);color:#fff;font-size:13px;cursor:pointer;display:flex;'
            + 'align-items:center;justify-content:center;position:relative;transition:background .15s;padding:0;}'
            + '#browserTtsFloat .tts-float-btn:hover{background:rgba(255,255,255,.32);}'
            + '#browserTtsFloat .tts-float-main{width:40px;height:40px;font-size:16px;background:rgba(255,255,255,.24);}'
            + '#browserTtsFloat .tts-float-ring{position:absolute;inset:-4px;border-radius:50%;'
            + 'border:2px solid rgba(255,255,255,.65);animation:ttsFloatPulse 1.5s ease-out infinite;pointer-events:none;}'
            + '#browserTtsFloat .tts-rate-btn{width:auto;min-width:44px;height:26px;border-radius:13px;'
            + 'font-size:11px;font-weight:600;padding:0 6px;}'
            + '#browserTtsFloat .tts-rate-menu{display:none;position:absolute;right:calc(100% + 10px);top:50%;'
            + 'transform:translateY(-50%);background:#fff;border-radius:10px;box-shadow:0 8px 26px rgba(0,0,0,.2);'
            + 'padding:4px;flex-direction:column;gap:2px;min-width:88px;}'
            + '#browserTtsFloat .tts-rate-menu.show{display:flex;}'
            + '#browserTtsFloat .tts-rate-menu button{border:none;background:transparent;padding:7px 14px;'
            + 'border-radius:6px;font-size:12px;color:#303133;cursor:pointer;text-align:center;white-space:nowrap;}'
            + '#browserTtsFloat .tts-rate-menu button:hover{background:#f5f3ff;}'
            + '#browserTtsFloat .tts-rate-menu button.active{background:#f0eaff;color:#7c4dff;font-weight:600;}'
            + '@keyframes ttsFloatPulse{0%{transform:scale(.72);opacity:.9}'
            + '70%{transform:scale(1.35);opacity:0}100%{transform:scale(1.35);opacity:0}}'
            + '@keyframes ttsFloatIn{from{opacity:0;transform:translateY(-50%) scale(.9)}'
            + 'to{opacity:1;transform:translateY(-50%) scale(1)}}'
            + '[data-theme="dark"] #browserTtsFloat .tts-rate-menu{background:#2d2d2d;}'
            + '[data-theme="dark"] #browserTtsFloat .tts-rate-menu button{color:#d8d8d8;}'
            + '[data-theme="dark"] #browserTtsFloat .tts-rate-menu button:hover{background:#3a3a45;}'
            + '[data-theme="dark"] #browserTtsFloat .tts-rate-menu button.active{background:#3a2f5e;color:#c4b0ff;}'
            + '@media (max-width:768px){#browserTtsFloat{right:10px;gap:6px;padding:8px 5px;}'
            + '#browserTtsFloat .tts-float-btn{width:32px;height:32px;}'
            + '#browserTtsFloat .tts-float-main{width:38px;height:38px;}}';
        document.head.appendChild(style);
    }

    function buildFloat() {
        injectFloatStyle();
        floatEl = document.createElement('div');
        floatEl.id = 'browserTtsFloat';
        floatEl.innerHTML = '<button type="button" class="tts-float-btn tts-float-main" data-tts-act="toggle" title="暂停朗读">'
            + '<span class="tts-float-ring"></span><i class="fas fa-volume-up"></i></button>'
            + '<button type="button" class="tts-float-btn" data-tts-act="stop" title="停止朗读"><i class="fas fa-stop"></i></button>'
            + '<button type="button" class="tts-float-btn tts-rate-btn" data-tts-act="rate" title="播放速度">'
            + (RATE_LABELS[String(BrowserTTS._rate)] || '1.0X') + '</button>'
            + '<div class="tts-rate-menu" id="browserTtsRateMenu">'
            + RATES.map(function (r) {
                return '<button type="button" data-rate="' + r + '">' + RATE_MENU_LABELS[String(r)] + '</button>';
            }).join('')
            + '</div>';
        document.body.appendChild(floatEl);

        floatEl.addEventListener('click', function (e) {
            e.stopPropagation();
            var rateItem = e.target.closest('[data-rate]');
            if (rateItem) {
                BrowserTTS.setRate(parseFloat(rateItem.getAttribute('data-rate')));
                var menu = document.getElementById('browserTtsRateMenu');
                if (menu) menu.classList.remove('show');
                return;
            }
            var btn = e.target.closest('[data-tts-act]');
            if (!btn) return;
            var act = btn.getAttribute('data-tts-act');
            if (act === 'toggle') {
                BrowserTTS.togglePause();
            } else if (act === 'stop') {
                BrowserTTS.stop();
            } else if (act === 'rate') {
                var m = document.getElementById('browserTtsRateMenu');
                if (m) m.classList.toggle('show');
                updateFloatState();
            }
        });

        document.addEventListener('click', function (e) {
            if (!floatEl || floatEl.contains(e.target)) return;
            var menu = document.getElementById('browserTtsRateMenu');
            if (menu) menu.classList.remove('show');
        });
    }

    function updateFloatState() {
        if (!floatEl) return;
        var mainBtn = floatEl.querySelector('.tts-float-main');
        var ring = floatEl.querySelector('.tts-float-ring');
        var icon = mainBtn ? mainBtn.querySelector('i') : null;
        var active = speaking && !paused;
        if (ring) ring.style.display = active ? 'block' : 'none';
        if (icon) icon.className = 'fas ' + (paused ? 'fa-volume-mute' : 'fa-volume-up');
        if (mainBtn) mainBtn.title = paused ? '继续朗读' : '暂停朗读';
        var rateBtn = floatEl.querySelector('.tts-rate-btn');
        if (rateBtn) rateBtn.textContent = RATE_LABELS[String(BrowserTTS._rate)] || '1.0X';
        var menu = document.getElementById('browserTtsRateMenu');
        if (menu) {
            Array.prototype.forEach.call(menu.querySelectorAll('button[data-rate]'), function (b) {
                b.classList.toggle('active', parseFloat(b.getAttribute('data-rate')) === BrowserTTS._rate);
            });
        }
    }

    function showFloat() {
        if (!floatEl) buildFloat();
        floatEl.style.display = 'flex';
        updateFloatState();
    }

    function hideFloat() {
        if (!floatEl) return;
        floatEl.style.display = 'none';
        var menu = document.getElementById('browserTtsRateMenu');
        if (menu) menu.classList.remove('show');
    }

    function finish(myToken) {
        if (myToken !== undefined && myToken !== token) return;
        stopSequenceDriver();
        speaking = false;
        paused = false;
        total = 0;
        done = 0;
        BrowserTTS._plan = null;
        BrowserTTS.onStop = null;
        hideFloat();
        if (BrowserTTS._btn) setBtn(BrowserTTS._btn, false);
        BrowserTTS._btn = null;
        var cb = BrowserTTS._onend;
        BrowserTTS._onend = null;
        if (cb) setTimeout(cb, 0);
    }

    // 看门狗：部分移动端不触发 onend，避免按钮一直停留在「停止」
    function startWatchdog(myToken) {
        var miss = 0;
        var timer = setInterval(function () {
            if (myToken !== token) { clearInterval(timer); return; }
            if (paused) { miss = 0; return; }
            var busy = false;
            try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = speaking; }
            if (busy) { miss = 0; return; }
            miss++;
            if (miss >= 5) { clearInterval(timer); finish(myToken); }
        }, 700);
    }

    // iOS Safari：必须一次性把所有分段交给语音队列，不能在 onend 里再 speak，
    // 否则第一段（标题）结束后，后续调用不在用户手势上下文，会被系统直接忽略。
    function enqueue(parts, myToken, startIndex) {
        if (myToken !== token) return;
        startIndex = startIndex || 0;
        total = parts.length;
        done = startIndex;
        speaking = true;
        paused = false;
        setBtn(BrowserTTS._btn, true);
        BrowserTTS._plan = {mode: 'parts', parts: parts, partIndex: startIndex};
        showFloat();

        for (var i = startIndex; i < parts.length; i++) {
            (function (idx) {
                var u = new SpeechSynthesisUtterance(parts[idx]);
                u.lang = 'zh-CN';
                u.rate = BrowserTTS._rate || 1;
                u.pitch = 1;
                var voice = pickVoice();
                if (voice) u.voice = voice;
                u.onstart = function () {
                    if (myToken !== token) return;
                    if (BrowserTTS._plan && BrowserTTS._plan.mode === 'parts') {
                        BrowserTTS._plan.partIndex = idx;
                    }
                    // Safari/iOS 入队后可能自动 paused，主动恢复（用户暂停时不要恢复）
                    try { if (!paused) synth.resume(); } catch (e) { /* ignore */ }
                };
                u.onend = function () {
                    if (myToken !== token) return;
                    done++;
                    if (done >= total) finish(myToken);
                };
                u.onerror = function () {
                    if (myToken !== token) return;
                    done++;
                    if (done >= total) finish(myToken);
                };
                try {
                    synth.speak(u);
                } catch (e) {
                    done++;
                    if (done >= total) finish(myToken);
                }
            })(i);
        }

        // iOS/Chrome 移动端：入队后唤醒引擎
        setTimeout(function () {
            if (myToken !== token) return;
            try { if (!paused) synth.resume(); } catch (e) { /* ignore */ }
        }, 30);

        startWatchdog(myToken);
    }

    // 连续朗读：一次性把多条消息的语音全部入队，避免 iOS 在异步回调中
    // 再次 speak 被系统拦截；每条消息的第一段开始时回调 onItemStart 以高亮。
    function enqueueSequence(seq, myToken, onItemStart, startIndex) {
        if (myToken !== token) return;
        startIndex = startIndex || 0;
        total = seq.length;
        done = startIndex;
        speaking = true;
        paused = false;
        setBtn(BrowserTTS._btn, true);
        BrowserTTS._plan = {
            mode: 'seq', seq: seq, onItemStart: onItemStart,
            itemIndex: seq[startIndex] ? seq[startIndex].index : 0
        };
        showFloat();

        for (var i = startIndex; i < seq.length; i++) {
            (function (idx) {
                var item = seq[idx];
                var u = new SpeechSynthesisUtterance(item.text);
                u.lang = 'zh-CN';
                u.rate = BrowserTTS._rate || 1;
                u.pitch = 1;
                var voice = pickVoice();
                if (voice) u.voice = voice;
                u.onstart = function () {
                    if (myToken !== token) return;
                    if (BrowserTTS._plan && BrowserTTS._plan.mode === 'seq') {
                        BrowserTTS._plan.itemIndex = item.index;
                    }
                    try { if (!paused) synth.resume(); } catch (e) { /* ignore */ }
                    if (item.first && typeof onItemStart === 'function') {
                        onItemStart(item.index, item.data);
                    }
                };
                u.onend = function () {
                    if (myToken !== token) return;
                    done++;
                    if (done >= total) finish(myToken);
                };
                u.onerror = function () {
                    if (myToken !== token) return;
                    done++;
                    if (done >= total) finish(myToken);
                };
                try {
                    synth.speak(u);
                } catch (e) {
                    done++;
                    if (done >= total) finish(myToken);
                }
            })(i);
        }

        setTimeout(function () {
            if (myToken !== token) return;
            try { if (!paused) synth.resume(); } catch (e) { /* ignore */ }
        }, 30);

        startWatchdog(myToken);
    }

    // iOS 连续朗读：把多条消息合并为一个 utterance，确保 Safari 不会只播第一条；
    // 通过 onboundary / 估算时间点回调 onItemStart 来切换消息高亮。
    function enqueueCombined(text, ranges, myToken, onItemStart, startItemIndex) {
        if (myToken !== token) return;
        total = 1;
        done = 0;
        speaking = true;
        paused = false;
        setBtn(BrowserTTS._btn, true);
        BrowserTTS._plan = {
            mode: 'combined', text: text, ranges: ranges, onItemStart: onItemStart,
            itemIndex: startItemIndex || 0
        };
        showFloat();

        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.rate = BrowserTTS._rate || 1;
        u.pitch = 1;
        var voice = pickVoice();
        if (voice) u.voice = voice;

        var lastIndex = -1;
        function emit(i) {
            if (myToken !== token) return;
            var rg = ranges[i];
            if (!rg || rg.index === lastIndex) return;
            lastIndex = rg.index;
            if (BrowserTTS._plan && BrowserTTS._plan.mode === 'combined') {
                BrowserTTS._plan.itemIndex = rg.index;
            }
            if (typeof onItemStart === 'function') onItemStart(rg.index, rg.data);
        }

        var boundarySeen = false;
        u.onstart = function () {
            if (myToken !== token) return;
            try { if (!paused) synth.resume(); } catch (e) { /* ignore */ }
            // 以实际开始朗读的时间重新计算估算进度，避免语音引擎启动延迟造成高亮超前
            startedAt = Date.now();
            lastIndex = -1;
            emit(0);
        };
        // Safari 若支持 boundary，用真实字符位置校正高亮
        u.onboundary = function (e) {
            if (myToken !== token || typeof e.charIndex !== 'number') return;
            boundarySeen = true;
            for (var i = ranges.length - 1; i >= 0; i--) {
                if (e.charIndex >= ranges[i].start) { emit(i); break; }
            }
        };
        u.onend = u.onerror = function () {
            if (myToken !== token) return;
            done++;
            if (done >= total) finish(myToken);
        };
        try {
            synth.speak(u);
        } catch (e) {
            finish(myToken);
            return;
        }

        // 高亮推进：不依赖 onstart/onboundary（部分移动端不触发）
        // 按字数估算朗读进度，必要时由 boundary 校正。
        stopSequenceDriver();
        var startedAt = Date.now();
        var pausedAt = 0;
        sequenceDriver = setInterval(function () {
            if (myToken !== token) { stopSequenceDriver(); return; }
            if (boundarySeen) { stopSequenceDriver(); return; }
            if (paused) {
                if (!pausedAt) pausedAt = Date.now();
                return;
            }
            if (pausedAt) { startedAt += Date.now() - pausedAt; pausedAt = 0; }
            var spokenChars = ((Date.now() - startedAt) / 1000) * 4.0 * (BrowserTTS._rate || 1);
            var idx = 0;
            for (var i = 0; i < ranges.length; i++) {
                if (ranges[i].start <= spokenChars) idx = i; else break;
            }
            emit(idx);
        }, 250);

        setTimeout(function () {
            if (myToken !== token) return;
            try { if (!paused) synth.resume(); } catch (e) { /* ignore */ }
        }, 30);

        startWatchdog(myToken);
    }

    var BrowserTTS = {
        supported: supported,
        _btn: null,
        _rate: savedRate,
        _onend: null,
        _plan: null,
        // 页面注册的停止回调：用户点悬浮面板停止时同步清理页面状态（高亮等）
        onStop: null,
        isSpeaking: function () {
            if (!supported) return false;
            var busy = false;
            try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = false; }
            return speaking || busy;
        },
        isPaused: function () { return paused; },
        pause: function () {
            if (!supported || !speaking) return;
            paused = true;
            try { synth.pause(); } catch (e) { /* ignore */ }
            updateFloatState();
        },
        resume: function () {
            if (!supported || !speaking) return;
            paused = false;
            try { synth.resume(); } catch (e) { /* ignore */ }
            updateFloatState();
        },
        togglePause: function () {
            if (!speaking) return;
            if (paused) this.resume(); else this.pause();
        },
        // 修改倍速：实时生效（cancel 当前队列后从当前消息/分段以新速率续读）
        setRate: function (rate) {
            rate = parseFloat(rate);
            if (RATES.indexOf(rate) < 0) rate = 1;
            if (this._rate === rate) { updateFloatState(); return; }
            this._rate = rate;
            try { localStorage.setItem('browser_tts_rate', String(rate)); } catch (e) { /* ignore */ }
            updateFloatState();

            var plan = this._plan;
            if (!speaking || !plan) return;
            var wasPaused = paused;
            var myToken = ++token;
            stopSequenceDriver();
            try { synth.cancel(); } catch (e) { /* ignore */ }
            paused = false;

            setTimeout(function () {
                if (myToken !== token) return;
                if (plan.mode === 'parts') {
                    var start = Math.min(plan.partIndex || 0, Math.max(plan.parts.length - 1, 0));
                    enqueue(plan.parts, myToken, start);
                } else if (plan.mode === 'seq') {
                    var seqStart = 0;
                    for (var i = 0; i < plan.seq.length; i++) {
                        if (plan.seq[i].index === plan.itemIndex && plan.seq[i].first) { seqStart = i; break; }
                    }
                    enqueueSequence(plan.seq, myToken, plan.onItemStart, seqStart);
                } else if (plan.mode === 'combined') {
                    var rgStart = 0;
                    for (var k = 0; k < plan.ranges.length; k++) {
                        if (plan.ranges[k].index === plan.itemIndex) { rgStart = k; break; }
                    }
                    var offset = plan.ranges[rgStart] ? plan.ranges[rgStart].start : 0;
                    var newText = plan.text.slice(offset);
                    var newRanges = plan.ranges.slice(rgStart).map(function (rg) {
                        return {start: rg.start - offset, end: rg.end - offset, index: rg.index, data: rg.data};
                    });
                    enqueueCombined(newText, newRanges, myToken, plan.onItemStart);
                }
                if (wasPaused) {
                    paused = true;
                    try { synth.pause(); } catch (e) { /* ignore */ }
                }
                updateFloatState();
            }, 80);
        },
        speak: function (text, opts) {
            if (!supported) return false;
            stopSequenceDriver();
            opts = opts || {};
            var clean = normalize(text);
            if (!clean) return false;
            var parts = isIOS ? [clean] : chunk(clean);
            if (!parts.length) return false;

            var wasActive = this.isSpeaking();
            // 新一轮朗读替换旧队列时不要再触发旧会话的 onStop（页面已注册了新的回调）
            if (wasActive) this.stop(true);

            this._btn = opts.button || null;
            if (opts.rate) this._rate = opts.rate;
            this._onend = typeof opts.onend === 'function' ? opts.onend : null;
            var myToken = ++token;
            var start = function () {
                if (myToken !== token) return;
                enqueue(parts, myToken);
            };
            // 先 cancel 再立刻 speak 会让 iOS 语音引擎卡死，留一点重启间隔
            if (wasActive) setTimeout(start, 80);
            else start();
            return true;
        },
        // 连续朗读队列：items = [{text, data}]；onItemStart(index, data) 用于高亮当前消息
        speakSequence: function (items, opts) {
            if (!supported) return false;
            stopSequenceDriver();
            opts = opts || {};

            // iOS/iPadOS：合并成单个 utterance，避免 Safari 只朗读队列第一段
            var combined = '';
            var ranges = [];
            if (isIOS) {
                (items || []).forEach(function (it, idx) {
                    var clean = normalize(it && it.text);
                    if (!clean) return;
                    if (combined) combined += '。';
                    var start = combined.length;
                    combined += clean;
                    ranges.push({start: start, end: combined.length, index: idx, data: it.data});
                });
                if (!combined) return false;
            }

            var seq = [];
            if (!isIOS) {
                (items || []).forEach(function (it, idx) {
                    var clean = normalize(it && it.text);
                    if (!clean) return;
                    var parts = chunk(clean);
                    parts.forEach(function (p, pi) {
                        seq.push({text: p, index: idx, data: it.data, first: pi === 0});
                    });
                });
                if (!seq.length) return false;
            }

            var wasActive = this.isSpeaking();
            // 新一轮朗读替换旧队列时不要再触发旧会话的 onStop（页面已注册了新的回调）
            if (wasActive) this.stop(true);

            this._btn = opts.button || null;
            if (opts.rate) this._rate = opts.rate;
            this._onend = typeof opts.onend === 'function' ? opts.onend : null;
            var myToken = ++token;
            var onItemStart = opts.onItemStart;
            var start = function () {
                if (myToken !== token) return;
                if (isIOS) enqueueCombined(combined, ranges, myToken, onItemStart);
                else enqueueSequence(seq, myToken, onItemStart);
            };
            if (wasActive) setTimeout(start, 80);
            else start();
            return true;
        },
        toggle: function (text, btn, opts) {
            if (!supported) return false;
            // 同一个按钮再次点击 = 停止
            if (this._btn === btn && this.isSpeaking()) {
                this.stop();
                return false;
            }
            opts = opts || {};
            opts.button = btn;
            return this.speak(text, opts);
        },
        stop: function (silentStop) {
            // silentStop=true：内部切换新队列时调用，不清理页面回调、不触发页面清理
            var onStopCb = silentStop ? null : this.onStop;
            if (!silentStop) this.onStop = null;
            token++;
            stopSequenceDriver();
            speaking = false;
            paused = false;
            total = 0;
            done = 0;
            this._plan = null;
            this._onend = null;
            hideFloat();
            if (supported) {
                try { synth.cancel(); } catch (e) { /* ignore */ }
                if (this._btn) setBtn(this._btn, false);
                this._btn = null;
            }
            // 异步回调，避免页面在 stop 内部再次 stop 造成重入
            if (onStopCb) setTimeout(onStopCb, 0);
        }
    };

    window.BrowserTTS = BrowserTTS;
})();
