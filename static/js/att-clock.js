// static/js/att-clock.js - 拍照打卡/人脸、定位与补卡
// 说明：本文件为 AttendanceApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(AttendanceApp.prototype, {

    // 相机抓拍：实时预览 → 拍摄 → 在照片底部烧录时间戳（含位置）→ 预览确认 → 返回 File
    _captureClockPhoto(locationText) {
        return new Promise((resolve) => {
            if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (typeof PermUtils !== 'undefined' && PermUtils.showPermissionGuide) {
                    PermUtils.showPermissionGuide('camera', '拍照打卡需要授权摄像头权限，且需在 HTTPS 环境下使用。');
                } else {
                    this.showToast('当前环境无法调用相机，请使用 HTTPS 打开或换用手机端打卡', true);
                }
                resolve(null);
                return;
            }

            var overlay = document.createElement('div');
            // 低于 PermUtils 权限引导层（99999），便于权限被拒时在其上方弹出开启指引
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML =
                '<div style="width:100%;max-width:520px;color:#fff;">'
                + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
                + '<div style="font-size:16px;font-weight:600;"><i class="fas fa-camera"></i> 拍照打卡</div>'
                + '<button data-act="close" style="width:32px;height:32px;border:none;background:rgba(255,255,255,.15);color:#fff;border-radius:50%;font-size:20px;cursor:pointer;">&times;</button>'
                + '</div>'
                + '<select data-role="camera" style="display:none;width:100%;margin-bottom:8px;padding:8px 10px;border-radius:8px;border:1px solid #555;background:#1e1e1e;color:#fff;font-size:13px;"></select>'
                + '<div style="position:relative;background:#000;border-radius:12px;overflow:hidden;">'
                + '<video data-role="video" autoplay playsinline muted style="width:100%;max-height:65vh;display:block;"></video>'
                + '<canvas data-role="canvas" style="width:100%;max-height:65vh;display:none;"></canvas>'
                + '<canvas data-role="overlay" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;"></canvas>'
                + '<div data-role="faceStatus" style="position:absolute;left:10px;top:10px;display:none;align-items:center;gap:6px;padding:4px 10px;border-radius:14px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;pointer-events:none;z-index:2;">'
                + '<i class="fas fa-user-circle"></i><span data-role="faceText">人脸检测中...</span></div>'
                + '</div>'
                + '<div data-role="msg" style="margin-top:10px;font-size:13px;color:#ffd666;line-height:1.6;min-height:20px;"></div>'
                + '<div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">'
                + '<button data-act="capture" style="padding:10px 26px;border:none;border-radius:22px;background:#409eff;color:#fff;font-size:14px;cursor:pointer;"><i class="fas fa-camera"></i> 拍摄</button>'
                + '<button data-act="retake" style="display:none;padding:10px 22px;border:1px solid rgba(255,255,255,.4);border-radius:22px;background:transparent;color:#fff;font-size:14px;cursor:pointer;">重拍</button>'
                + '<button data-act="confirm" style="display:none;padding:10px 26px;border:none;border-radius:22px;background:#67c23a;color:#fff;font-size:14px;cursor:pointer;"><i class="fas fa-check"></i> 使用照片打卡</button>'
                + '</div></div>';
            document.body.appendChild(overlay);

            var video = overlay.querySelector('[data-role="video"]');
            var canvas = overlay.querySelector('[data-role="canvas"]');
            var msg = overlay.querySelector('[data-role="msg"]');
            var captureBtn = overlay.querySelector('[data-act="capture"]');
            var retakeBtn = overlay.querySelector('[data-act="retake"]');
            var confirmBtn = overlay.querySelector('[data-act="confirm"]');
            var camSelect = overlay.querySelector('[data-role="camera"]');
            var overlayCanvas = overlay.querySelector('[data-role="overlay"]');
            var faceStatusEl = overlay.querySelector('[data-role="faceStatus"]');
            var faceTextEl = overlay.querySelector('[data-role="faceText"]');
            var stream = null;
            var file = null;
            var finished = false;
            var cameraInfo = {};
            var currentDeviceId = '';
            // 人脸检测状态（face-api.js tinyFaceDetector）
            var faceReady = false;
            var faceLoadPromise = null;
            var faceLoopTimer = null;
            var detectorOptions = null;
            var FACE_MIN_RATIO = 0.10;   // 人脸宽度至少占画面 10%，避免拍得太远
            var FACE_BLUR_MIN = 25;      // 人脸区域拉普拉斯方差阈值，低于该值判为模糊

            // 已知虚拟摄像头/虚拟相机名称特征（与后端黑名单保持一致，前后端双重拦截）
            var VIRTUAL_CAMERA_RE = /obs\s*virtual|virtual\s*cam|虚拟摄[像相]头|虚拟相机|manycam|xsplit|snap\s*camera|droidcam|ivcam|epoccam|iriun|camtwist|youcam|sparkocam|vcam|e2esoft|webcamoid|fake\s*camera|camera\s*emulator|ip\s*camera|virtual\s*camera/i;
            var isVirtualCamera = function (label) {
                return !!label && VIRTUAL_CAMERA_RE.test(String(label));
            };

            var stop = function () {
                if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
            };
            var finish = function (result) {
                if (finished) return;
                finished = true;
                stopFaceLoop();
                stop();
                overlay.remove();
                resolve(result);
            };
            overlay.querySelector('[data-act="close"]').onclick = function () { finish(null); };

            // ==================== 人脸检测（face-api.js） ====================
            var ensureFaceModels = function () {
                if (faceReady) return Promise.resolve(true);
                if (faceLoadPromise) return faceLoadPromise;
                var api = window.faceapi;
                if (!api || !api.nets || !api.nets.tinyFaceDetector) {
                    faceStatusEl.style.display = 'flex';
                    faceStatusEl.style.background = 'rgba(200,140,40,.8)';
                    faceTextEl.textContent = '人脸检测组件未加载，已跳过检测';
                    faceLoadPromise = Promise.resolve(false);
                    return faceLoadPromise;
                }
                faceStatusEl.style.display = 'flex';
                faceStatusEl.style.background = 'rgba(0,0,0,.55)';
                faceTextEl.textContent = '正在加载人脸检测...';
                try {
                    detectorOptions = new api.TinyFaceDetectorOptions({inputSize: 224, scoreThreshold: 0.45});
                } catch (e) {
                    detectorOptions = null;
                }
                faceLoadPromise = api.nets.tinyFaceDetector
                    .loadFromUri('/static/vendor/face-api/models')
                    .then(function () { faceReady = true; return true; })
                    .catch(function (e) {
                        console.warn('人脸检测模型加载失败', e);
                        faceStatusEl.style.display = 'flex';
                        faceStatusEl.style.background = 'rgba(200,140,40,.8)';
                        faceTextEl.textContent = '人脸检测模型加载失败，已跳过检测';
                        return false;
                    });
                return faceLoadPromise;
            };

            var drawFaceBox = function (det) {
                if (!overlayCanvas) return;
                var rect = video.getBoundingClientRect();
                var w = Math.max(1, Math.round(rect.width));
                var h = Math.max(1, Math.round(rect.height));
                var dpr = window.devicePixelRatio || 1;
                if (overlayCanvas.width !== Math.round(w * dpr) || overlayCanvas.height !== Math.round(h * dpr)) {
                    overlayCanvas.width = Math.round(w * dpr);
                    overlayCanvas.height = Math.round(h * dpr);
                    overlayCanvas.style.width = w + 'px';
                    overlayCanvas.style.height = h + 'px';
                }
                var ctx = overlayCanvas.getContext('2d');
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, w, h);
                if (!det || !video.videoWidth) return;

                var sx = w / video.videoWidth;
                var sy = h / video.videoHeight;
                var x = det.box.x * sx, y = det.box.y * sy;
                var bw = det.box.width * sx, bh = det.box.height * sy;
                var c = Math.min(18, bw * 0.28, bh * 0.28);
                ctx.strokeStyle = '#22e58a';
                ctx.lineWidth = 2.5;
                ctx.strokeRect(x, y, bw, bh);
                // 四角高亮，增加科技感
                ctx.lineWidth = 4;
                [[x, y, 1, 1], [x + bw, y, -1, 1], [x, y + bh, 1, -1], [x + bw, y + bh, -1, -1]]
                    .forEach(function (p) {
                        ctx.beginPath();
                        ctx.moveTo(p[0], p[1] + p[3] * c);
                        ctx.lineTo(p[0], p[1]);
                        ctx.lineTo(p[0] + p[2] * c, p[1]);
                        ctx.stroke();
                    });
                ctx.fillStyle = 'rgba(34,229,138,.95)';
                ctx.font = 'bold 12px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
                ctx.fillText('人脸 ✓', x, Math.max(14, y - 7));
            };

            var runFaceLoop = function () {
                if (!faceReady || !detectorOptions || !window.faceapi) return;
                if (faceLoopTimer) clearInterval(faceLoopTimer);
                faceStatusEl.style.display = 'flex';
                faceStatusEl.style.background = 'rgba(0,0,0,.55)';
                faceLoopTimer = setInterval(function () {
                    if (finished || !stream || video.style.display === 'none' || !video.videoWidth) return;
                    window.faceapi.detectAllFaces(video, detectorOptions).then(function (dets) {
                        if (finished) return;
                        var best = null;
                        (dets || []).forEach(function (d) {
                            if (!best || d.box.width * d.box.height > best.box.width * best.box.height) best = d;
                        });
                        drawFaceBox(best);
                        if (best) {
                            faceStatusEl.style.background = 'rgba(22,160,90,.8)';
                            faceTextEl.textContent = '人脸已识别';
                        } else {
                            faceStatusEl.style.background = 'rgba(200,60,60,.8)';
                            faceTextEl.textContent = '未检测到人脸，请正对镜头';
                        }
                    }).catch(function () { /* 单帧检测失败忽略 */ });
                }, 450);
            };

            var stopFaceLoop = function () {
                if (faceLoopTimer) { clearInterval(faceLoopTimer); faceLoopTimer = null; }
                try {
                    var ctx = overlayCanvas.getContext('2d');
                    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                } catch (e) { /* 忽略 */ }
            };

            // 人脸区域清晰度：灰度拉普拉斯方差（数值越大越清晰）
            var faceBlurScore = function (srcCanvas, box, fullW, fullH) {
                var margin = 0.15;
                var sx = Math.max(0, Math.floor(box.x - box.width * margin));
                var sy = Math.max(0, Math.floor(box.y - box.height * margin));
                var sw = Math.min(fullW - sx, Math.ceil(box.width * (1 + 2 * margin)));
                var sh = Math.min(fullH - sy, Math.ceil(box.height * (1 + 2 * margin)));
                if (sw < 24 || sh < 24) return 0;
                var tw = 160, th = Math.max(24, Math.round(tw * sh / sw));
                var c = document.createElement('canvas');
                c.width = tw;
                c.height = th;
                var cx = c.getContext('2d');
                cx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, tw, th);
                var data;
                try { data = cx.getImageData(0, 0, tw, th).data; } catch (e) { return 0; }
                var gray = new Float32Array(tw * th);
                for (var i = 0, j = 0; i < data.length; i += 4, j++) {
                    gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                }
                var sum = 0, sumSq = 0, n = 0;
                for (var yy = 1; yy < th - 1; yy++) {
                    for (var xx = 1; xx < tw - 1; xx++) {
                        var idx = yy * tw + xx;
                        var v = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - tw] + gray[idx + tw];
                        sum += v;
                        sumSq += v * v;
                        n++;
                    }
                }
                if (!n) return 0;
                var mean = sum / n;
                return sumSq / n - mean * mean;
            };

            // 枚举可用摄像头（授权后才能拿到设备名称），并识别虚拟摄像头
            var refreshCameraList = function () {
                if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
                navigator.mediaDevices.enumerateDevices().then(function (devs) {
                    var cams = devs.filter(function (d) { return d.kind === 'videoinput'; });
                    if (!cams.length) { camSelect.style.display = 'none'; return; }

                    camSelect.innerHTML = '';
                    cams.forEach(function (d, i) {
                        var opt = document.createElement('option');
                        opt.value = d.deviceId;
                        var label = d.label || ('摄像头 ' + (i + 1));
                        opt.textContent = label + (isVirtualCamera(label) ? '（虚拟）' : '');
                        camSelect.appendChild(opt);
                    });
                    camSelect.style.display = cams.length > 1 ? 'block' : 'none';
                    if (currentDeviceId) camSelect.value = currentDeviceId;

                    // 默认选中了虚拟摄像头且存在真实摄像头时，自动切换到真实摄像头
                    var current = cams.filter(function (c) { return c.deviceId === currentDeviceId; })[0] || cams[0];
                    if (isVirtualCamera(current.label)) {
                        var real = cams.filter(function (c) { return !isVirtualCamera(c.label || ''); })[0];
                        if (real && real.deviceId && real.deviceId !== currentDeviceId) {
                            camSelect.value = real.deviceId;
                            startCamera(real.deviceId);
                        }
                    }
                }).catch(function () { /* 设备列表读取失败不阻断拍照 */ });
            };

            var startCamera = function (deviceId) {
                if (stream) {
                    stream.getTracks().forEach(function (t) { t.stop(); });
                    stream = null;
                }
                msg.textContent = '正在请求相机权限...';
                var videoConstraints = deviceId
                    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } }
                    : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } };
                navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false })
                    .then(function (s) {
                        stream = s;
                        var track = s.getVideoTracks()[0];
                        var settings = (track && track.getSettings) ? track.getSettings() : {};
                        currentDeviceId = settings.deviceId || deviceId || '';
                        cameraInfo = {
                            label: (track && track.label) || '',
                            deviceId: settings.deviceId || '',
                            groupId: settings.groupId || '',
                            facingMode: settings.facingMode || '',
                            width: settings.width || 0,
                            height: settings.height || 0,
                            frameRate: settings.frameRate || 0
                        };

                        video.srcObject = s;
                        video.style.display = 'block';
                        canvas.style.display = 'none';
                        retakeBtn.style.display = 'none';
                        confirmBtn.style.display = 'none';
                        video.play().catch(function () {});
                        refreshCameraList();

                        if (isVirtualCamera(cameraInfo.label)) {
                            captureBtn.style.display = 'none';
                            msg.textContent = '检测到虚拟摄像头（' + cameraInfo.label
                                + '），为保障考勤真实性已禁止拍照打卡，请在上方列表中选择真实摄像头';
                            return;
                        }
                        captureBtn.style.display = '';
                        captureBtn.innerHTML = '<i class="fas fa-camera"></i> 拍摄';
                        captureBtn.onclick = captureHandler;
                        msg.textContent = '请正对镜头，光线充足时拍摄效果更佳';
                        // 加载人脸检测模型并开始实时检测（加载失败时降级为跳过检测）
                        ensureFaceModels().then(function (ok) {
                            if (!finished && ok) runFaceLoop();
                        });
                    }).catch(function (err) {
                        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
                            msg.textContent = '相机权限被拒绝。请在浏览器/系统设置中允许摄像头权限后重试。';
                            if (typeof PermUtils !== 'undefined' && PermUtils.showPermissionGuide) {
                                PermUtils.showPermissionGuide('camera', '拍照打卡需要摄像头权限。');
                            }
                        } else if (err && err.name === 'NotFoundError') {
                            msg.textContent = '未检测到可用摄像头，无法拍照打卡。';
                        } else {
                            msg.textContent = '相机启动失败：' + ((err && err.message) || '未知错误');
                        }
                        // 允许重试（首次权限拒绝后用户可能已在系统设置中打开）
                        captureBtn.style.display = '';
                        captureBtn.innerHTML = '<i class="fas fa-redo"></i> 重试';
                        captureBtn.onclick = function () {
                            captureBtn.innerHTML = '<i class="fas fa-camera"></i> 拍摄';
                            captureBtn.onclick = captureHandler;
                            startCamera();
                        };
                    });
            };
            camSelect.onchange = function () { startCamera(camSelect.value); };

            var pad = function (n) { return String(n).padStart(2, '0'); };
            var drawCaptured = function () {
                var vw = video.videoWidth || 0, vh = video.videoHeight || 0;
                if (!vw || !vh) { msg.textContent = '摄像头画面尚未就绪，请稍后重试'; return null; }
                var maxSide = 1280;
                var scale = Math.min(1, maxSide / Math.max(vw, vh));
                var w = Math.round(vw * scale), h = Math.round(vh * scale);
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, w, h);

                var now = new Date();
                var ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
                    + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
                var fs = Math.max(13, Math.round(w / 42));
                var lines = ['打卡时间：' + ts];
                if (locationText) lines.push('位置：' + String(locationText).slice(0, 32));
                var barH = lines.length * (fs + 8) + 14;
                ctx.fillStyle = 'rgba(0,0,0,.5)';
                ctx.fillRect(0, h - barH, w, barH);
                ctx.fillStyle = '#fff';
                ctx.textBaseline = 'top';
                ctx.font = 'bold ' + fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
                lines.forEach(function (line, i) {
                    ctx.fillText(line, 12, h - barH + 8 + i * (fs + 8));
                });
                return {ts: ts, iso: now.toISOString()};
            };

            var captureHandler = async function () {
                if (isVirtualCamera(cameraInfo.label)) {
                    msg.textContent = '检测到虚拟摄像头，请切换为真实摄像头后再拍摄';
                    return;
                }

                var canFace = false;
                try { canFace = await ensureFaceModels(); } catch (e) { canFace = false; }

                var captured = drawCaptured();
                if (!captured) return;

                var faceMeta = {
                    detected: false,
                    skipped: !canFace,
                    library: 'face-api.js',
                    capturedAt: captured.iso,
                    reason: canFace ? '' : 'face_api_unavailable'
                };
                var faceBox = null;

                // 人脸检测 + 质量校验（未检测到人脸 / 人脸过小 / 模糊时阻止拍摄）
                if (canFace && detectorOptions && window.faceapi) {
                    try {
                        var det = await window.faceapi.detectSingleFace(canvas, detectorOptions);
                        if (!det || !det.box) {
                            msg.textContent = '未检测到人脸，请正对镜头、保证光线充足后重新拍摄';
                            return;
                        }
                        faceBox = det.box;
                        var ratio = faceBox.width / canvas.width;
                        if (ratio < FACE_MIN_RATIO) {
                            msg.textContent = '人脸太小，请靠近摄像头后重新拍摄';
                            return;
                        }
                        var blur = faceBlurScore(canvas, faceBox, canvas.width, canvas.height);
                        if (blur < FACE_BLUR_MIN) {
                            msg.textContent = '人脸较模糊（清晰度 ' + Math.round(blur)
                                + '），请保持稳定、正对镜头并补光后重拍';
                            return;
                        }
                        faceMeta = {
                            detected: true,
                            skipped: false,
                            score: Math.round((det.score || 0) * 1000) / 1000,
                            blur: Math.round(blur * 10) / 10,
                            sizeRatio: Math.round(ratio * 10000) / 10000,
                            box: {
                                x: Math.round(faceBox.x), y: Math.round(faceBox.y),
                                width: Math.round(faceBox.width), height: Math.round(faceBox.height)
                            },
                            capturedAt: captured.iso,
                            library: 'face-api.js'
                        };
                    } catch (e) {
                        console.warn('人脸检测失败，跳过检测', e);
                        canFace = false;
                        faceMeta.skipped = true;
                        faceMeta.reason = 'face_detect_error';
                    }
                }

                stopFaceLoop();
                overlayCanvas.style.display = 'none';
                faceStatusEl.style.display = 'none';
                canvas.style.display = 'block';
                video.style.display = 'none';
                captureBtn.style.display = 'none';
                retakeBtn.style.display = '';
                confirmBtn.style.display = '';
                msg.textContent = faceMeta.detected
                    ? '人脸清晰，照片已带打卡时间戳，确认后点击「使用照片打卡」'
                    : '照片已带打卡时间戳，确认无误后点击「使用照片打卡」';

                // 截取人脸区域（扩展少量边距，正方形输出）用于后续人脸识别数据储备
                var faceBlobPromise = null;
                if (faceMeta.detected && faceBox) {
                    faceBlobPromise = new Promise(function (resolveFace) {
                        try {
                            var out = 320, margin = 0.35;
                            var sx = Math.max(0, faceBox.x - faceBox.width * margin);
                            var sy = Math.max(0, faceBox.y - faceBox.height * margin);
                            var ex = Math.min(canvas.width, faceBox.x + faceBox.width * (1 + margin));
                            var ey = Math.min(canvas.height, faceBox.y + faceBox.height * (1 + margin));
                            var fc = document.createElement('canvas');
                            fc.width = out;
                            fc.height = out;
                            var fx = fc.getContext('2d');
                            fx.drawImage(canvas, sx, sy, ex - sx, ey - sy, 0, 0, out, out);
                            fc.toBlob(function (b) { resolveFace(b || null); }, 'image/jpeg', 0.9);
                        } catch (e) {
                            resolveFace(null);
                        }
                    });
                }

                canvas.toBlob(function (blob) {
                    if (!blob) { msg.textContent = '照片生成失败，请重拍'; return; }
                    file = new File([blob], 'clock_photo.jpg', { type: 'image/jpeg' });
                    // 时间戳、相机信息、人脸检测结果随照片一起提交
                    file._takenAt = captured.iso;
                    file._cameraInfo = Object.assign({}, cameraInfo);
                    file._faceMeta = faceMeta;
                    file._faceBlobPromise = faceBlobPromise;
                }, 'image/jpeg', 0.92);
            };
            captureBtn.onclick = captureHandler;
            retakeBtn.onclick = function () {
                file = null;
                canvas.style.display = 'none';
                video.style.display = 'block';
                overlayCanvas.style.display = 'block';
                captureBtn.style.display = '';
                captureBtn.innerHTML = '<i class="fas fa-camera"></i> 拍摄';
                captureBtn.onclick = captureHandler;
                retakeBtn.style.display = 'none';
                confirmBtn.style.display = 'none';
                msg.textContent = '请正对镜头，光线充足时拍摄效果更佳';
                if (faceReady) runFaceLoop();
            };
            confirmBtn.onclick = async function () {
                if (!file) { msg.textContent = '照片尚未生成，请稍后重试或重新拍摄'; return; }
                if (file._faceBlobPromise) {
                    try { file._faceBlob = await file._faceBlobPromise; } catch (e) { file._faceBlob = null; }
                }
                finish(file);
            };

            startCamera();
        });
    },

    // 定位进行中提示：部分用户未开启定位权限时，浏览器迟迟不回调，
    // 仅靠按钮文案容易让用户误以为卡死；这里弹出明确的「正在获取定位」提示。
    _showLocatingOverlay() {
        if (document.getElementById('attendanceLocatingOverlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'attendanceLocatingOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.35);padding:20px;';
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;padding:22px 26px;max-width:320px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,0.25);">'
            + '<i class="fas fa-location-crosshairs fa-spin" style="font-size:30px;color:#409eff;"></i>'
            + '<div style="margin-top:10px;font-size:15px;font-weight:600;color:#303133;">正在获取定位…</div>'
            + '<div style="margin-top:6px;font-size:12.5px;color:#909399;line-height:1.7;">请允许浏览器使用定位权限；若长时间无反应，请检查系统定位是否开启，或稍后重试。</div>'
            + '</div>';
        document.body.appendChild(overlay);
    },

    _hideLocatingOverlay() {
        var overlay = document.getElementById('attendanceLocatingOverlay');
        if (overlay) overlay.remove();
    },

    // 获取打卡位置：自动请求定位权限，失败时给出清晰提示（权限被拒→引导去设置；无法定位→可重试或继续无位置打卡）
    async _fetchLocation() {
        this._showLocatingOverlay();
        try {
            return await this._fetchLocationInner();
        } finally {
            this._hideLocatingOverlay();
        }
    },

    async _fetchLocationInner() {
        var result = { ok: true, abort: false, skip: false, latitude: null, longitude: null, location: '', reverse_geocoding: null };
        var pos = null;
        // 定位失败必须由用户明确选择「重试」或「继续打卡（无位置）」：
        // 重试后仍失败会继续弹出提示，避免弹框关闭让用户误以为已经打卡成功。
        while (!pos) {
            try {
                pos = await PermUtils.getLocation();
                break;
            } catch (err) {
                // 定位权限被拒绝 → 引导用户去系统设置开启
                if (err.code === 'PERMISSION_DENIED') {
                    PermUtils.showPermissionGuide('location', '考勤打卡需要获取位置信息。');
                    result.ok = false; result.abort = true; result.code = err.code; result.message = err.message;
                    return result;
                }
                var choice = await new Promise(function (resolve) {
                    var overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);padding:20px;';
                    overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:340px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.25);overflow:hidden;">'
                        + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 18px;background:#fdf6ec;border-bottom:1px solid #f5e6c8;font-size:15px;font-weight:600;color:#b88230;">'
                        + '<span style="display:flex;align-items:center;gap:8px;"><i class="fas fa-map-marker-alt" style="color:#e6a23c;"></i> 无法获取位置</span>'
                        + '<button data-act="close" title="关闭" style="width:28px;height:28px;border:none;background:transparent;color:#b88230;font-size:20px;line-height:1;cursor:pointer;border-radius:50%;flex-shrink:0;">&times;</button>'
                        + '</div>'
                        + '<div style="padding:16px 18px;font-size:14px;color:#606266;line-height:1.7;">' + (err.message || '定位失败') + '。请检查手机系统定位服务是否开启，或移动到信号较好的位置后重试。</div>'
                        + '<div style="padding:12px 18px;border-top:1px solid #ebeef5;text-align:right;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">'
                        + '<button data-act="retry" style="padding:8px 16px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">重试</button>'
                        + '<button data-act="skip" style="padding:8px 16px;background:#fff;color:#606266;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:14px;">继续打卡（无位置）</button>'
                        + '</div></div>';
                    document.body.appendChild(overlay);
                    // 必须明确点击按钮；点击遮罩不关闭、不继续打卡，避免误触
                    overlay.querySelector('[data-act="retry"]').onclick = function () { overlay.remove(); resolve('retry'); };
                    overlay.querySelector('[data-act="skip"]').onclick = function () { overlay.remove(); resolve('skip'); };
                    overlay.querySelector('[data-act="close"]').onclick = function () { overlay.remove(); resolve('cancel'); };
                });
                if (choice === 'skip') {
                    result.ok = true; result.skip = true;
                    return result;
                }
                if (choice === 'cancel') {
                    // 关闭视为取消本次打卡：不带着无位置继续提交，并明确提示未记录考勤
                    result.ok = false; result.abort = true; result.cancelled = true;
                    this.showToast('已取消打卡，未记录考勤', false);
                    return result;
                }
                // 选择重试 → 继续循环；若仍失败会再次弹出提示
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
    },

    _getClientInfo() {
        var ip = '';
        var ua = navigator.userAgent || '';
        return { ip: ip, userAgent: ua };
    },

    async openMakeupModal() {
        var now = new Date();
        this._mkYear = now.getFullYear();
        this._mkMonth = now.getMonth() + 1;
        this._mkSelectedDate = null;
        this._mkSelectedType = '';
        this._mkEligibleTypes = {};
        this._mkDays = [];
        this._mkCfgTime = null;
        var dateHidden = document.getElementById('makeupDate');
        if (dateHidden) dateHidden.value = '';
        var typeHidden = document.getElementById('makeupClockType');
        if (typeHidden) typeHidden.value = '';
        await this._loadMakeupCalendarData();
        this.renderMakeupCalendar();
        this._renderMakeupRemainingTip();
        var modal = document.getElementById('attendanceMakeupModal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        }
    },

    // 加载本月考勤日历（补卡高亮用）
    async _loadMakeupCalendarData() {
        try {
            var cdata = await this.apiGet(OA_API_URL + '/attendance/calendar-stats/?year=' + this._mkYear + '&month=' + this._mkMonth);
            this._mkDays = (cdata && cdata.days) || [];
            this._mkCfgTime = (cdata && cdata.config_time) || null;  // {clock_in, clock_out, shift_type}
        } catch (e) { /* 高亮加载失败不影响补卡 */ }
    },

    _renderMakeupRemainingTip() {
        var used = this._makeupUsed || 0;
        var allowance = (this._makeupAllowance != null) ? this._makeupAllowance : 3;
        var tip = document.getElementById('makeupRemainingTip');
        if (tip) {
            tip.innerHTML = '<i class="fas fa-info-circle"></i> 本月已用补卡 <b>' + used + '</b> / ' + allowance + ' 次，剩余 <b>' + Math.max(0, allowance - used) + '</b> 次';
        }
    },

    // 自动识别某日期需要补哪些卡（漏卡 / 迟到 / 早退），返回 ['clock_in' | 'clock_out']
    _makeupEligibleTypes(info, ds) {
        if (!info || !info.day_status) return [];
        if (info.day_status === 'future' || info.day_status === 'rest' || info.day_status === 'leave') return [];
        var cfgT = this._mkCfgTime || {};
        var now = new Date();
        var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        var nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var shiftNight = cfgT.shift_type === 'night';
        var types = [];
        ['clock_in', 'clock_out'].forEach(function (t) {
            var rec = info[t] || null;
            if (!rec) {
                if (ds === todayStr) {
                    // 今日漏卡：需过该卡配置时间才可补；夜班下班卡属次日，不在今日补
                    if (shiftNight && t === 'clock_out') return;
                    var typeTime = t === 'clock_in' ? (cfgT.clock_in || '09:00') : (cfgT.clock_out || '18:00');
                    if (nowHM < typeTime) return;
                }
                types.push(t);
            } else if (rec.status === 'late' || rec.status === 'early_leave') {
                types.push(t);
            }
        });
        return types;
    },

    _hasMakeupNeeds() {
        var self = this;
        return (this._mkDays || []).some(function (info) {
            return self._makeupEligibleTypes(info, info.date).length > 0;
        });
    },

    // 渲染补卡日历：默认同时展示上班卡/下班卡的全部需补卡日期
    renderMakeupCalendar() {
        var self = this;
        var grid = document.getElementById('makeupCalGrid');
        var legend = document.getElementById('makeupCalLegend');
        var hint = document.getElementById('makeupCalHint');
        if (!grid) return;
        var y = this._mkYear, month = this._mkMonth;
        var dataOk = !!(this._mkDays && this._mkDays.length);
        var cfgT = this._mkCfgTime || {};
        if (hint) {
            if (!dataOk) {
                hint.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 未获取到考勤数据，暂无法选择补卡日期，请刷新后重试';
                hint.style.background = '#fdf6ec';
                hint.style.color = '#e6a23c';
            } else {
                hint.innerHTML = '<i class="fas fa-info-circle"></i> 已展示全部需补卡日期：点击日期后自动识别补上班卡/下班卡；若同日两张卡都需补，可选择单独补某一张，或「全天一起补」一次补录两张卡。';
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
        this._mkEligibleTypes = {};
        for (var day = 1; day <= dim; day++) {
            var ds = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            var info = {};
            (this._mkDays || []).forEach(function (x) { if (x.date === ds) info = x; });
            var types = this._makeupEligibleTypes(info, ds);
            this._mkEligibleTypes[ds] = types;
            var eligible = types.length > 0;
            var hasMiss = types.some(function (t) { return !info[t]; });
            var kind = eligible ? (hasMiss ? 'miss' : 'late') : '';
            var typeLabels = types.map(function (t) { return t === 'clock_in' ? '上班卡' : '下班卡'; });
            var isSel = this._mkSelectedDate === ds;
            var bg = eligible ? (kind === 'late' ? '#fdf6ec' : '#fef0f0') : '#f5f7fa';
            var color = eligible ? '#303133' : (info.day_status === 'future' ? '#c0c4cc' : '#909399');
            var border = isSel ? '2px solid #409eff' : '1px solid #ebeef5';
            var cursor = eligible ? 'pointer' : 'not-allowed';
            var mark = '';
            if (eligible) {
                var markColor = kind === 'late' ? '#e6a23c' : '#f56c6c';
                var markIcon = kind === 'late' ? 'fa-edit' : 'fa-exclamation';
                var markText = types.length === 2 ? '上/下' : (types[0] === 'clock_in' ? '上' : '下');
                mark = '<i class="fas ' + markIcon + '" style="font-size:8px;color:' + markColor + ';display:block;line-height:1;"></i>'
                    + '<span style="font-size:8px;color:' + markColor + ';line-height:1.2;">' + markText + '</span>';
            }
            var title = eligible ? (ds + '：可补' + typeLabels.join('、')) : '不可补卡';
            html += '<div class="makeup-day' + (isSel ? ' selected' : '') + '" data-date="' + ds + '"'
                + (eligible ? ' onclick="attendanceApp.selectMakeupDate(\'' + ds + '\')"' : '')
                + ' title="' + title + '"'
                + ' style="cursor:' + cursor + ';border-radius:6px;padding:5px 2px;text-align:center;font-size:12px;border:' + border + ';background:' + bg + ';color:' + color + ';">'
                + day + mark
                + '</div>';
        }
        grid.innerHTML = html;
        if (legend) {
            legend.innerHTML = '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fef0f0;border:1px solid #fde2e2;vertical-align:-2px;margin-right:3px;"></span>漏卡可补</span>'
                + '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#fdf6ec;border:1px solid #f5dab1;vertical-align:-2px;margin-right:3px;"></span>迟到/早退可补</span>'
                + '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#f5f7fa;vertical-align:-2px;margin-right:3px;"></span>正常/不可补</span>'
                + '<span>格内「上/下」表示需补的卡种</span>';
        }
        // 自动识别结果 / 双卡种选择
        var autoEl = document.getElementById('makeupTypeAuto');
        var chooser = document.getElementById('makeupTypeChooser');
        var selTypes = (this._mkSelectedDate && this._mkEligibleTypes[this._mkSelectedDate]) || [];
        if (autoEl) {
            if (!this._mkSelectedDate) {
                autoEl.innerHTML = '请选择补卡日期，系统将自动识别需补上班卡或下班卡';
                autoEl.style.color = 'var(--text-secondary,#606266)';
            } else if (selTypes.length === 1) {
                autoEl.innerHTML = '<i class="fas fa-check-circle" style="color:#67c23a;"></i> 已自动识别：' + (selTypes[0] === 'clock_in' ? '补上班卡' : '补下班卡');
                autoEl.style.color = '#303133';
            } else if (!this._mkSelectedType) {
                autoEl.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#e6a23c;"></i> 该日期上班卡和下班卡均需补卡，请选择补上班卡、补下班卡或全天一起补';
                autoEl.style.color = '#b88230';
            } else {
                var typeText = this._mkSelectedType === 'clock_in' ? '补上班卡'
                    : (this._mkSelectedType === 'clock_out' ? '补下班卡' : '全天一起补（上班卡 + 下班卡）');
                autoEl.innerHTML = '<i class="fas fa-check-circle" style="color:#67c23a;"></i> 当前选择：' + typeText;
                autoEl.style.color = '#303133';
            }
        }
        if (chooser) {
            chooser.style.display = selTypes.length === 2 ? 'flex' : 'none';
            chooser.querySelectorAll('.makeup-type-btn').forEach(function (btn) {
                var t = btn.getAttribute('data-type');
                var active = self._mkSelectedType === t;
                btn.style.borderColor = active ? '#409eff' : '';
                btn.style.color = active ? '#409eff' : '';
                btn.style.background = active ? '#ecf5ff' : '';
            });
        }
        // 已选日期提示：将按考勤配置时间补卡
        var tipEl = document.getElementById('makeupTimeTip');
        if (tipEl) {
            if (this._mkSelectedDate) {
                if (!this._mkSelectedType) {
                    tipEl.innerHTML = '<i class="fas fa-info-circle"></i> 该日期上班卡和下班卡均需补卡，请先选择补上班卡、补下班卡或全天一起补';
                    tipEl.style.display = 'block';
                    tipEl.style.background = '#fdf6ec';
                    tipEl.style.color = '#b88230';
                } else if (this._mkSelectedType === 'day') {
                    tipEl.innerHTML = '<i class="fas fa-clock" style="margin-right:4px;"></i> 将按考勤配置时间 <b>'
                        + (cfgT.clock_in || '09:00') + '</b> 补上班卡、<b>' + (cfgT.clock_out || '18:00')
                        + '</b> 补下班卡（' + this._mkSelectedDate + '），消耗 2 次补卡次数';
                    tipEl.style.display = 'block';
                    tipEl.style.background = '#f0f9eb';
                    tipEl.style.color = '#67c23a';
                } else {
                    var tipT = this._mkSelectedType === 'clock_in' ? (cfgT.clock_in || '09:00') : (cfgT.clock_out || '18:00');
                    tipEl.innerHTML = '<i class="fas fa-clock" style="margin-right:4px;"></i> 将按考勤配置时间 <b>' + tipT + '</b> 补' + (this._mkSelectedType === 'clock_in' ? '上班' : '下班') + '卡（' + this._mkSelectedDate + '）';
                    tipEl.style.display = 'block';
                    tipEl.style.background = '#f0f9eb';
                    tipEl.style.color = '#67c23a';
                }
            } else {
                tipEl.style.display = 'none';
            }
        }
    },

    selectMakeupDate(ds) {
        var types = (this._mkEligibleTypes && this._mkEligibleTypes[ds]) || [];
        if (!types.length) return;
        this._mkSelectedDate = ds;
        var dateHidden = document.getElementById('makeupDate');
        if (dateHidden) dateHidden.value = ds;
        // 单一卡种直接自动选中；两种卡都需补时由用户明确选择，避免漏补
        this._mkSelectedType = types.length === 1 ? types[0] : '';
        var typeHidden = document.getElementById('makeupClockType');
        if (typeHidden) typeHidden.value = this._mkSelectedType;
        this.renderMakeupCalendar();
    },

    chooseMakeupType(type) {
        if (!this._mkSelectedDate) { this.showToast('请先选择补卡日期', true); return; }
        var types = (this._mkEligibleTypes && this._mkEligibleTypes[this._mkSelectedDate]) || [];
        if (type === 'day') {
            if (types.length !== 2) return;  // 仅两张卡都需补时才允许全天一起补
        } else if (types.indexOf(type) === -1) {
            return;
        }
        this._mkSelectedType = type;
        var typeHidden = document.getElementById('makeupClockType');
        if (typeHidden) typeHidden.value = type;
        this.renderMakeupCalendar();
    },

    closeMakeupModal() {
        var modal = document.getElementById('attendanceMakeupModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    },

    async submitMakeup() {
        var dateStr = document.getElementById('makeupDate') ? document.getElementById('makeupDate').value : '';
        var clockType = this._mkSelectedType || (document.getElementById('makeupClockType') ? document.getElementById('makeupClockType').value : '');
        if (!dateStr) { this.showToast('请选择补卡日期', true); return; }
        if (!clockType) { this.showToast('该日期上班卡和下班卡均需补卡，请先选择补卡类型', true); return; }
        var btn = document.querySelector('#attendanceMakeupModal .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...'; }
        try {
            var res = await this.apiPost(OA_API_URL + '/attendance/makeup/', { date: dateStr, clock_type: clockType });
            if (res && res.makeup_used != null) {
                this._makeupUsed = res.makeup_used;
                if (res.makeup_allowance != null) this._makeupAllowance = res.makeup_allowance;
            }
            // 清空选择并重新加载；仍有需补卡日期时保持弹窗，避免漏补另一张卡
            this._mkSelectedDate = null;
            this._mkSelectedType = '';
            var dateHidden = document.getElementById('makeupDate');
            if (dateHidden) dateHidden.value = '';
            var typeHidden = document.getElementById('makeupClockType');
            if (typeHidden) typeHidden.value = '';
            await this._loadMakeupCalendarData();
            this.renderMakeupCalendar();
            this._renderMakeupRemainingTip();
            if (this._hasMakeupNeeds()) {
                this.showToast('补卡成功，仍有需补卡的日期，请继续处理', false);
            } else {
                this.showToast('补卡成功', false);
                this.closeMakeupModal();
            }
            await this.loadToday();
            await this.loadStats();
            await this.loadRecords(1);
        } catch (e) {
            this.showToast(e.message || '补卡失败', true);
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> 确认补卡'; }
        }
    },
    });
})();
