// static/js/tts.js - 浏览器语音合成（朗读）通用工具
(function () {
    var synth = window.speechSynthesis;
    var supported = !!(synth && window.SpeechSynthesisUtterance);
    var speaking = false;
    var total = 0;
    var done = 0;
    var token = 0;
    var sequenceDriver = null;   // iOS 合并朗读的高亮推进定时器

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

    function finish(myToken) {
        if (myToken !== undefined && myToken !== token) return;
        stopSequenceDriver();
        speaking = false;
        total = 0;
        done = 0;
        if (BrowserTTS._btn) setBtn(BrowserTTS._btn, false);
        BrowserTTS._btn = null;
        var cb = BrowserTTS._onend;
        BrowserTTS._onend = null;
        if (cb) setTimeout(cb, 0);
    }

    // iOS Safari：必须一次性把所有分段交给语音队列，不能在 onend 里再 speak，
    // 否则第一段（标题）结束后，后续调用不在用户手势上下文，会被系统直接忽略。
    function enqueue(parts, myToken) {
        if (myToken !== token) return;
        total = parts.length;
        done = 0;
        speaking = true;
        setBtn(BrowserTTS._btn, true);

        parts.forEach(function (part) {
            var u = new SpeechSynthesisUtterance(part);
            u.lang = 'zh-CN';
            u.rate = BrowserTTS._rate || 1;
            u.pitch = 1;
            var voice = pickVoice();
            if (voice) u.voice = voice;
            u.onstart = function () {
                if (myToken !== token) return;
                // Safari/iOS 入队后可能自动 paused，主动恢复
                try { synth.resume(); } catch (e) { /* ignore */ }
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
        });

        // iOS/Chrome 移动端：入队后唤醒引擎
        setTimeout(function () {
            if (myToken !== token) return;
            try { synth.resume(); } catch (e) { /* ignore */ }
        }, 30);

        // 看门狗：部分移动端不触发 onend，避免按钮一直停留在「停止」
        var miss = 0;
        var timer = setInterval(function () {
            if (myToken !== token) { clearInterval(timer); return; }
            var busy = false;
            try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = speaking; }
            if (busy) { miss = 0; return; }
            miss++;
            if (miss >= 5) { clearInterval(timer); finish(myToken); }
        }, 700);
    }

    // 连续朗读：一次性把多条消息的语音全部入队，避免 iOS 在异步回调中
    // 再次 speak 被系统拦截；每条消息的第一段开始时回调 onItemStart 以高亮。
    function enqueueSequence(seq, myToken, onItemStart) {
        if (myToken !== token) return;
        total = seq.length;
        done = 0;
        speaking = true;
        setBtn(BrowserTTS._btn, true);

        seq.forEach(function (item) {
            var u = new SpeechSynthesisUtterance(item.text);
            u.lang = 'zh-CN';
            u.rate = BrowserTTS._rate || 1;
            u.pitch = 1;
            var voice = pickVoice();
            if (voice) u.voice = voice;
            u.onstart = function () {
                if (myToken !== token) return;
                try { synth.resume(); } catch (e) { /* ignore */ }
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
        });

        setTimeout(function () {
            if (myToken !== token) return;
            try { synth.resume(); } catch (e) { /* ignore */ }
        }, 30);

        var miss = 0;
        var timer = setInterval(function () {
            if (myToken !== token) { clearInterval(timer); return; }
            var busy = false;
            try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = speaking; }
            if (busy) { miss = 0; return; }
            miss++;
            if (miss >= 5) { clearInterval(timer); finish(myToken); }
        }, 700);
    }

    // iOS 连续朗读：把多条消息合并为一个 utterance，确保 Safari 不会只播第一条；
    // 通过 onboundary / 估算时间点回调 onItemStart 来切换消息高亮。
    function enqueueCombined(text, ranges, myToken, onItemStart) {
        if (myToken !== token) return;
        total = 1;
        done = 0;
        speaking = true;
        setBtn(BrowserTTS._btn, true);

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
            if (typeof onItemStart === 'function') onItemStart(rg.index, rg.data);
        }

        var boundarySeen = false;
        u.onstart = function () {
            if (myToken !== token) return;
            try { synth.resume(); } catch (e) { /* ignore */ }
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
        sequenceDriver = setInterval(function () {
            if (myToken !== token) { stopSequenceDriver(); return; }
            if (boundarySeen) { stopSequenceDriver(); return; }
            var spokenChars = ((Date.now() - startedAt) / 1000) * 4.0 * (BrowserTTS._rate || 1);
            var idx = 0;
            for (var i = 0; i < ranges.length; i++) {
                if (ranges[i].start <= spokenChars) idx = i; else break;
            }
            emit(idx);
        }, 250);

        setTimeout(function () {
            if (myToken !== token) return;
            try { synth.resume(); } catch (e) { /* ignore */ }
        }, 30);

        var miss = 0;
        var timer = setInterval(function () {
            if (myToken !== token) { clearInterval(timer); return; }
            var busy = false;
            try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = speaking; }
            if (busy) { miss = 0; return; }
            miss++;
            if (miss >= 5) { clearInterval(timer); finish(myToken); }
        }, 700);
    }

    var BrowserTTS = {
        supported: supported,
        _btn: null,
        _rate: 1,
        _onend: null,
        isSpeaking: function () {
            if (!supported) return false;
            var busy = false;
            try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = false; }
            return speaking || busy;
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
            if (wasActive) this.stop();

            this._btn = opts.button || null;
            this._rate = opts.rate || 1;
            this._onend = typeof opts.onend === 'function' ? opts.onend : null;
            var myToken = ++token;
            var self = this;
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
            if (wasActive) this.stop();

            this._btn = opts.button || null;
            this._rate = opts.rate || 1;
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
        stop: function () {
            token++;
            stopSequenceDriver();
            speaking = false;
            total = 0;
            done = 0;
            this._onend = null;
            if (!supported) return;
            try { synth.cancel(); } catch (e) { /* ignore */ }
            if (this._btn) setBtn(this._btn, false);
            this._btn = null;
        }
    };

    window.BrowserTTS = BrowserTTS;
})();
