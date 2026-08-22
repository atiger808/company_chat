// static/js/utils.js

// 工具函数
class Utils {

    // HTML 转义
    static escapeHtml(text) {
        if (text === undefined || text === null) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 金额格式化：保留两位小数
    static formatAmount(n) {
        const num = Number(n);
        if (isNaN(num)) return '0.00';
        return num.toFixed(2);
    }

    // 计算文件的 MD5 哈希值
    static async calculateFileHash(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    // 简单的哈希计算（实际项目建议使用 crypto-js 或 SparkMD5）
                    const content = e.target.result;
                    let hash = 0;
                    for (let i = 0; i < content.length; i++) {
                        const char = content.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash; // Convert to 32bit integer
                    }
                    resolve(Math.abs(hash).toString(16));
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // 检查文件是否已存在（基于文件名和大小的简单去重）
    static isFileDuplicate(file, existingFiles = []) {
        const fileKey = `${file.name}-${file.size}-${file.type}`;
        return existingFiles.some(existingFile =>
            `${existingFile.name}-${existingFile.size}-${existingFile.type}` === fileKey
        );
    }

// 获取文件类型
    static getFileType(fileType) {
        const type = fileType.toLowerCase();
        if (type.includes('image')) return 'image';
        if (type.includes('video')) return 'video';
        if (type.includes('audio')) return 'voice';
        return 'file';
    }

    // 计算文件MD5
    static async calculateFileMd5(file) {
        return new Promise((resolve, reject) => {
            const spark = new SparkMD5.ArrayBuffer();
            const reader = new FileReader();

            reader.onload = (e) => {
                spark.append(e.target.result);
                resolve(spark.end());
            };

            reader.onerror = (e) => {
                reject(e);
            };

            reader.readAsArrayBuffer(file);
        });
    }

    // 计算单个 Blob 分片 MD5（小写十六进制）
    static _blobMd5(blob) {
        return new Promise((resolve, reject) => {
            const spark = new SparkMD5.ArrayBuffer();
            const reader = new FileReader();
            reader.onload = (e) => {
                spark.append(e.target.result);
                resolve(spark.end().toLowerCase());
            };
            reader.onerror = () => reject(new Error('读取文件分片失败'));
            reader.readAsArrayBuffer(blob);
        });
    }

    /**
     * 分块上传文件到企业网盘（导出文件保存到网盘）
     * 复用网盘的分片上传流程：init_upload → upload_chunk → merge_chunks
     * @param {File} file - 要保存的文件（File/Blob 均可）
     * @param {number|string|null} folderId - 目标文件夹ID，null 表示网盘根目录
     * @param {string} description - 文件备注
     * @param {string} tags - 文件标签
     * @returns {Promise<Object>} 网盘文件信息
     */
    static async uploadToCloud(file, folderId = null, description = '', tags = '') {
        if (!file || !file.size && file.size !== 0) throw new Error('没有要保存的文件');
        const chunkSize = 5 * 1024 * 1024;
        const fileSize = file.size;
        const fileMd5 = await Utils.calculateFileMd5(file);
        const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

        // 1. 初始化上传会话
        const initResp = await fetch('/api/cloud/files/init_upload/', {
            method: 'POST',
            headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
            body: JSON.stringify({
                file_name: file.name,
                file_size: fileSize,
                file_md5: fileMd5,
                chunk_size: chunkSize,
                folder: folderId || null,
                description: description || '',
                tags: tags || ''
            })
        });
        if (!initResp.ok) throw new Error((await initResp.json().catch(() => ({}))).error || '初始化上传失败');
        const initData = await initResp.json();
        // 秒传：文件已存在
        if (initData.status === 'quick_upload') return initData.file || initData;
        if (!initData.session || !initData.session.id) throw new Error('上传会话创建失败');
        const sessionId = initData.session.id;
        const missing = (initData.missing_chunks && initData.missing_chunks.length)
            ? initData.missing_chunks
            : Array.from({length: totalChunks}, function (_, i) { return i; });

        // 2. 上传缺失分片
        for (let i = 0; i < missing.length; i++) {
            const idx = Number(missing[i]);
            if (isNaN(idx) || idx < 0) continue;
            const start = idx * chunkSize;
            const end = Math.min(start + chunkSize, fileSize);
            const chunkBlob = file.slice(start, end);
            const chunkMd5 = await Utils._blobMd5(chunkBlob);
            const fd = new FormData();
            fd.append('session_id', sessionId);
            fd.append('chunk_index', idx);
            fd.append('chunk_md5', chunkMd5);
            fd.append('chunk', chunkBlob, 'chunk_' + idx);
            const hd = TokenManager.getHeaders();
            delete hd['Content-Type'];
            delete hd['content-type'];
            const resp = await fetch('/api/cloud/files/upload_chunk/', {method: 'POST', headers: hd, body: fd});
            if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || ('分片 ' + idx + ' 上传失败'));
        }

        // 3. 合并分片完成上传
        const mergeResp = await fetch('/api/cloud/files/merge_chunks/', {
            method: 'POST',
            headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
            body: JSON.stringify({
                session_id: sessionId,
                folder: folderId || null,
                description: description || null,
                tags: tags || null
            })
        });
        if (!mergeResp.ok) throw new Error((await mergeResp.json().catch(() => ({}))).error || '合并文件失败');
        const mergeData = await mergeResp.json();
        return mergeData.file || mergeData;
    }


    // 验证文件类型
    static isValidFileType(file, allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
        // dng图片类型
        'image/dng',
        'application/pdf',
        'text/plain',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'text/csv',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',

        'application/vnd.ms-powerpoint', // .ppt
        'application/vnd.ms-powerpoint.presentation.macroEnabled.12', // .pptm
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
        'application/vnd.oasis.opendocument.text', // .odt
        'application/vnd.oasis.opendocument.spreadsheet', // .ods
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.oasis.opendocument.graphics',
        'application/vnd.oasis.opendocument.chart',
        'application/vnd.oasis.opendocument.formula',
        'application/vnd.oasis.opendocument.database',
        'application/vnd.oasis.opendocument.text-master',

        'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/mkv', 'video/flv',
        'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a'
    ]) {
        console.log("file type: ", file.type)
        return allowedTypes.includes(file.type) ||
            file.name.toLowerCase().endsWith('.pdf') ||
            file.name.toLowerCase().endsWith('.txt') ||
            file.name.toLowerCase().endsWith('.xls') ||
            file.name.toLowerCase().endsWith('.xlsx') ||
            file.name.toLowerCase().endsWith('.doc') ||
            file.name.toLowerCase().endsWith('.docx') ||
            file.name.toLowerCase().endsWith('.ppt') ||
            file.name.toLowerCase().endsWith('.pptx') ||
            file.name.toLowerCase().endsWith('.odt') ||
            file.name.toLowerCase().endsWith('.dng') ||
            file.name.toLowerCase().endsWith('.csv');
    }

    // 获取文件图标类名
    static getFileIconClass(mimeType, filename = '') {
        const type = mimeType.toLowerCase();
        const ext = filename.toLowerCase().split('.').pop();

        // 图片
        if (type.includes('image') || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
            return 'fas fa-image';
        }
        // PDF
        if (type.includes('pdf') || ext === 'pdf') {
            return 'fas fa-file-pdf';
        }
        // Excel
        if (type.includes('excel') || type.includes('spreadsheet') || ['xls', 'xlsx', 'csv'].includes(ext)) {
            return 'fas fa-file-excel';
        }
        // Word
        if (type.includes('word') || type.includes('document') || ['doc', 'docx'].includes(ext)) {
            return 'fas fa-file-word';
        }
        // 视频
        if (type.includes('video') || ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv'].includes(ext)) {
            return 'fas fa-file-video';
        }
        // 音频
        if (type.includes('audio') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
            return 'fas fa-file-audio';
        }
        // 压缩包
        if (type.includes('zip') || type.includes('rar') || ['zip', 'rar'].includes(ext)) {
            return 'fas fa-file-archive';
        }
        // 文本
        if (type.includes('text') || ext === 'txt') {
            return 'fas fa-file-alt';
        }
        // PowerPoint
        if (type.includes('powerpoint') || type.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
            return 'fas fa-file-powerpoint';
        }

        return 'fas fa-file';
    }

    // 格式化文件大小
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // 解析错误响应
    static async parseErrorResponse(response) {
        try {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                return {
                    message: data.message || data.detail || data.error || '请求失败',
                    code: data.code || response.status
                };
            }
            return {
                message: `服务器错误: ${response.status}`,
                code: response.status
            };
        } catch (error) {
            console.error('解析错误响应失败:', error);
            return {
                message: '网络请求失败',
                code: response.status
            };
        }
    }


    /**
     * 解析后端返回的验证错误
     * @param {Object} errorData - 后端返回的错误对象，如 {"email":["该邮箱未注册"]}
     * @param {Number} statusCode - HTTP 状态码
     * @returns {String} 用户友好的错误消息
     */

    static parseApiError(errorData, statusCode) {
        // 1. Django REST Framework 字段验证错误格式: { "field": ["错误消息"] }
        if (typeof errorData === 'object' && errorData !== null) {
            // 提取第一个字段的第一个错误消息
            for (const [field, messages] of Object.entries(errorData)) {
                if (Array.isArray(messages) && messages.length > 0) {
                    return messages[0]; // 返回第一条错误消息
                }
            }

            // 2. 通用错误格式: { "error": "消息" } 或 { "message": "消息" }
            if (errorData.error) return errorData.error;
            if (errorData.message) return errorData.message;
            if (errorData.detail) return errorData.detail;
            if (errorData.non_field_errors?.[0]) return errorData.non_field_errors[0];
        }

        // 3. 状态码映射
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


    // 格式化时间
    static formatTime(date) {
        const now = new Date();
        const msgDate = new Date(date);

        // 判断是否是今天
        const isToday = now.toDateString() === msgDate.toDateString();

        if (isToday) {
            return msgDate.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        // 判断是否是今年
        const isThisYear = now.getFullYear() === msgDate.getFullYear();

        if (isThisYear) {
            return msgDate.toLocaleDateString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        return msgDate.toLocaleDateString('zh-CN');
    }



    static formatLastmessageTimeStamp(timestamp) {

        const date = new Date(timestamp);
        const now = new Date();

        // 获取具体时间字符串 (HH:mm)
        const timeStr = date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        // 重置 now 为当前时间，避免 setDate 修改原对象影响后续判断
        const currentNow = new Date();

        // 计算时间差
        const diffTime = currentNow.getTime() - date.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        // 判断是否是今天 (0天)
        const isToday = currentNow.toDateString() === date.toDateString();

        // 判断是否是昨天 (1天)
        const yesterday = new Date(currentNow);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = yesterday.toDateString() === date.toDateString();

        // 判断是否是前天 (2天)
        const dayBeforeYesterday = new Date(currentNow);
        dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
        const isDayBeforeYesterday = dayBeforeYesterday.toDateString() === date.toDateString();

        let label;
        if (isToday) {
            label = `今天 ${timeStr}`;
        } else if (isYesterday) {
            label = `昨天 ${timeStr}`;
        } else if (isDayBeforeYesterday) {
            label = `前天 ${timeStr}`;
        } else if (diffDays < 6) {
            // 最近一周内（不含今天、昨天、前天），显示星期几 + 时间
            const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            const weekDay = weekDays[date.getDay()];
            label = `${weekDay} ${timeStr}`;
        } else {
            const currentYear = currentNow.getFullYear();
            const messageYear = date.getFullYear();

            if (messageYear === currentYear) {
                // 同一年但超过一周，显示月日 + 时间
                const month = date.getMonth() + 1;
                const day = date.getDate();
                label = `${month}月${day}日`;
            } else {
                // 超过一年，显示年月日 + 时间
                const year = date.getFullYear();
                const month = date.getMonth() + 1;
                const day = date.getDate();
                label = `${year}年${month}月${day}日`;
            }
        }

        return label;
    }

    /**
     * 格式化后端返回的日期时间为本地日期时间（自动处理时区转换）
     * 兼容 ISO8601（含 Z / +08:00 偏移）与 "YYYY-MM-DD HH:mm:ss" 空格格式
     * @param {string|Date|null} value - 后端返回的日期时间
     * @param {Object} opts - {dateOnly:boolean, seconds:boolean, emptyText:string}
     * @returns {string} 本地时间字符串，如 "2026-08-20 14:30:05"
     */
    static formatDateTime(value, opts = {}) {
        if (value === undefined || value === null || value === '') return opts.emptyText || '-';
        let v = String(value).trim();
        if (v.indexOf('T') === -1 && v.indexOf(' ') > 0) v = v.replace(' ', 'T');
        const d = new Date(v);
        if (isNaN(d.getTime())) return opts.emptyText || '-';
        const pad = (n) => String(n).padStart(2, '0');
        let s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        if (opts.dateOnly) return s;
        s += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        if (opts.seconds !== false) s += ':' + pad(d.getSeconds());
        return s;
    }

    /**
     * 移动端图片预览：启用双指捏合缩放（跟随手指）、缩放后单指拖动平移。
     * 未缩放时单指滑动/点击仍由页面原有逻辑处理（切换图片/关闭），
     * 缩放状态下点击图片不会关闭预览。
     * @param {HTMLImageElement} imgEl - 预览中的 <img> 元素
     */
    static enableImagePinchZoom(imgEl) {
        if (!imgEl || imgEl._pz) return;
        var st = {scale: 1, tx: 0, ty: 0, startDist: 0, startScale: 1, startTx: 0, startTy: 0, startX: 0, startY: 0, startMidX: 0, startMidY: 0, pinch: false, pan: false};
        imgEl._pz = st;
        imgEl.style.transformOrigin = 'center center';
        imgEl.style.touchAction = 'none';

        function apply() {
            if (st.scale <= 1.01) {
                st.scale = 1; st.tx = 0; st.ty = 0;
                imgEl.style.transform = '';
            } else {
                imgEl.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.scale + ')';
            }
        }
        function dist(t1, t2) {
            var dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        imgEl.addEventListener('touchstart', function (e) {
            if (e.touches.length >= 2) {
                e.preventDefault(); e.stopPropagation();
                st.pinch = true; st.pan = false;
                st.startDist = dist(e.touches[0], e.touches[1]);
                st.startScale = st.scale;
                st.startTx = st.tx; st.startTy = st.ty;
                st.startMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                st.startMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            } else if (st.scale > 1.01) {
                // 已缩放：单指拖动平移
                e.preventDefault(); e.stopPropagation();
                st.pan = true; st.pinch = false;
                st.startX = e.touches[0].clientX;
                st.startY = e.touches[0].clientY;
                st.startTx = st.tx; st.startTy = st.ty;
            }
            // 未缩放时不做处理：单指滑动/点击交给外层原有逻辑
        }, {passive: false});

        imgEl.addEventListener('touchmove', function (e) {
            if (st.pinch && e.touches.length >= 2) {
                e.preventDefault(); e.stopPropagation();
                if (st.startDist > 0) {
                    var d = dist(e.touches[0], e.touches[1]);
                    st.scale = Math.max(1, Math.min(6, st.startScale * (d / st.startDist)));
                    var mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    var my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                    st.tx = st.startTx + (mx - st.startMidX);
                    st.ty = st.startTy + (my - st.startMidY);
                }
                apply();
            } else if (st.pan && e.touches.length === 1) {
                e.preventDefault(); e.stopPropagation();
                st.tx = st.startTx + (e.touches[0].clientX - st.startX);
                st.ty = st.startTy + (e.touches[0].clientY - st.startY);
                apply();
            } else if (e.touches.length >= 2) {
                e.preventDefault(); e.stopPropagation();
            }
        }, {passive: false});

        function endTouches(e) {
            if (e.touches && e.touches.length >= 2) return;
            if (st.pinch || st.pan) {
                e.preventDefault(); e.stopPropagation();
                st.pinch = false; st.pan = false;
                if (st.scale < 1.01) apply();
            }
        }
        imgEl.addEventListener('touchend', endTouches, {passive: false});
        imgEl.addEventListener('touchcancel', endTouches, {passive: false});

        // 缩放状态下点击图片不关闭预览（未缩放时由页面原有点击逻辑关闭）
        imgEl.addEventListener('click', function (e) {
            if (st.scale > 1.01) { e.preventDefault(); e.stopPropagation(); }
        });
    }

    // 重置图片缩放（切换图片时调用）
    static resetImageZoom(imgEl) {
        if (!imgEl || !imgEl._pz) return;
        var st = imgEl._pz;
        st.scale = 1; st.tx = 0; st.ty = 0; st.pinch = false; st.pan = false;
        imgEl.style.transform = '';
    }



    // 防抖函数
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 节流函数
    static throttle(func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // 显示通知
    static showNotification(title, options = {}) {
        if ('Notification' in window) {
            Notification.requestPermission().then(permission => {
                console.log('通知权限:', permission)
                if (permission === 'granted') {
                    new Notification(title, options);
                }
            });
        }
    }


    // 修复：使用用户交互触发的音频上下文
    static initAudioContext() {
        if (!Utils.audioContext) {
            try {
                Utils.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                Utils.audioGainNode = Utils.audioContext.createGain();
                Utils.audioGainNode.connect(Utils.audioContext.destination);
                Utils.audioGainNode.gain.value = 0.5;

                // 尝试恢复（如果被暂停）
                if (Utils.audioContext.state === 'suspended') {
                    const resumeAudio = () => {
                        if (Utils.audioContext && Utils.audioContext.state === 'suspended') {
                            Utils.audioContext.resume().then(() => {
                                console.log('AudioContext resumed');
                            }).catch(err => {
                                console.warn('Failed to resume AudioContext:', err);
                            });
                        }
                        document.removeEventListener('click', resumeAudio);
                        document.removeEventListener('touchstart', resumeAudio);
                    };

                    document.addEventListener('click', resumeAudio, {once: true});
                    document.addEventListener('touchstart', resumeAudio, {once: true});
                }
            } catch (e) {
                console.warn('Failed to create AudioContext:', e);
                Utils.audioContext = null;
            }
        }
    }

    // 修复：播放提示音（处理 autoplay 限制）
    static playNotificationSound() {
        // 确保音频上下文已初始化
        if (!Utils.audioContext) {
            Utils.initAudioContext();
        }

        // 检查音频上下文状态
        if (Utils.audioContext && Utils.audioContext.state === 'suspended') {
            // 尝试恢复（需要用户交互）
            Utils.audioContext.resume().catch(err => {
                console.warn('AudioContext suspended, cannot play sound:', err);
                return;
            });
        }

        try {
            if (Utils.audioContext) {
                // 使用 Web Audio API
                const oscillator = Utils.audioContext.createOscillator();
                const gainNode = Utils.audioContext.createGain();

                oscillator.type = 'sine';
                oscillator.frequency.value = 800;
                gainNode.gain.value = 0.1;

                oscillator.connect(gainNode);
                gainNode.connect(Utils.audioGainNode);

                oscillator.start();
                oscillator.stop(Utils.audioContext.currentTime + 0.15);

                gainNode.gain.exponentialRampToValueAtTime(0.01, Utils.audioContext.currentTime + 0.15);
            } else {
                // 降级：使用 Audio 元素（需要预加载）
                if (!Utils.notificationAudio) {
                    Utils.notificationAudio = new Audio('/static/sounds/notification.mp3');
                    Utils.notificationAudio.volume = 0.5;
                    // 预加载音频（用户交互后）
                    document.addEventListener('click', () => {
                        Utils.notificationAudio.load();
                    }, {once: true});
                }
                Utils.notificationAudio.play().catch(err => {
                    console.warn('Audio playback failed:', err);
                });
            }
        } catch (e) {
            console.warn('Failed to play notification sound:', e);
        }
    }


    // 滚动到底部
    static scrollToBottom(element) {
        if (element) {
            // 使用 requestAnimationFrame 确保在下一帧渲染时执行滚动，避免在某些情况下滚动失效
            requestAnimationFrame(() => {
                element.scrollTop = element.scrollHeight;
            });
        }
    }

    // 解析表情
    static parseEmojis(text) {
        // 简单的emoji替换
        return text.replace(/:\)/g, '😊')
            .replace(/:\(/g, '😢')
            .replace(/:D/g, '😄')
            .replace(/:P/g, '😛');
    }


    // 生成随机颜色
    static getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // 获取首字母头像
    static getInitials(name) {
        if (!name) return '';
        return name.charAt(0).toUpperCase();
    }


    // 检测是否为 iOS 设备
    static isIOS() {
        return /iPad|iPhone|iPod|Mac/.test(navigator.userAgent) && !window.MSStream;
    }

    // 检测是否为 Android 设备
    static isAndroid() {
        return /Android/i.test(navigator.userAgent);
    }

    // 检测是否为移动端
    static isMobile() {
        return this.isIOS() || this.isAndroid() || /Mobile|Tablet/i.test(navigator.userAgent);
    }

    // 复制到剪贴板
    static copyToClipboard(text) {
        if (navigator.clipboard) {
            return navigator.clipboard.writeText(text);
        } else {
            // 兼容旧浏览器
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    }


    /**
     * 计算文件 MD5（分块读取版 - 企业级推荐）
     * @param {File} file - 文件对象
     * @param {number} chunkSize - 分块大小（字节），默认 2MB
     * @param {function} onProgress - 进度回调函数 (currentChunk, totalChunks, percent)
     * @returns {Promise<string>} MD5 字符串（32位小写十六进制）
     */
    async computeFileMd5(file, chunkSize = 2 * 1024 * 1024, onProgress = null) {
        return new Promise((resolve, reject) => {
            // 参数校验
            if (!file || !(file instanceof File)) {
                reject(new Error('无效的文件对象'));
                return;
            }

            const spark = new SparkMD5.ArrayBuffer();
            const fileSize = file.size;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            let currentChunk = 0;

            // 空文件处理
            if (fileSize === 0) {
                resolve(SparkMD5.hash(''));
                return;
            }

            const loadNext = () => {
                const start = currentChunk * chunkSize;
                const end = Math.min(start + chunkSize, fileSize);

                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        spark.append(e.target.result);
                        currentChunk++;

                        // 进度回调
                        if (typeof onProgress === 'function') {
                            const percent = Math.round((currentChunk / totalChunks) * 100);
                            onProgress(currentChunk, totalChunks, percent);
                        }

                        if (currentChunk < totalChunks) {
                            // 使用 setTimeout 避免阻塞主线程
                            setTimeout(loadNext, 0);
                        } else {
                            // 计算完成
                            const md5 = spark.end();
                            resolve(md5.toLowerCase());
                        }
                    } catch (error) {
                        reject(new Error(`MD5 计算错误: ${error.message}`));
                    }
                };

                reader.onerror = () => {
                    reject(new Error(`读取文件块 ${currentChunk + 1} 失败`));
                };

                reader.onabort = () => {
                    reject(new Error('文件读取被中止'));
                };

                // 读取文件块
                reader.readAsArrayBuffer(file.slice(start, end));
            };

            // 开始读取
            loadNext();
        });
    }


    /**
     * 使用 Web Worker 计算文件 MD5（超大文件推荐）
     * @param {File} file - 文件对象
     * @param {function} onProgress - 进度回调
     * @returns {Promise<string>} MD5 字符串
     */
    async computeFileMd5WithWorker(file, onProgress = null) {
        return new Promise((resolve, reject) => {
            // 检查浏览器支持
            if (!window.Worker) {
                // 降级使用主线程版本
                return this.computeFileMd5(file, 2 * 1024 * 1024, onProgress)
                    .then(resolve)
                    .catch(reject);
            }

            const worker = new Worker('/static/js/md5-worker.js');

            worker.onmessage = (e) => {
                if (e.data.type === 'progress' && typeof onProgress === 'function') {
                    onProgress(e.data.current, e.data.total, e.data.percent);
                } else if (e.data.type === 'complete') {
                    worker.terminate();
                    resolve(e.data.md5);
                }
            };

            worker.onerror = (error) => {
                worker.terminate();
                reject(new Error(`Worker 错误: ${error.message}`));
            };

            // 发送文件（使用 Transferable 优化性能）
            worker.postMessage({file}, [file]);
        });
    }


    _showTip(msg) {
        var tip = document.getElementById('_showTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = '_showTip';
            tip.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);z-index:10002;color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:20px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.opacity = '1';
        clearTimeout(tip._t);
        tip._t = setTimeout(function() { tip.style.opacity = '0'; }, 1500);
    }

}


// static/js/utils.js - 添加 FrontendConfigManager 类

/**
 * 前端配置管理器
 * 在应用初始化时从后端获取系统配置，缓存在 localStorage 中
 */
class FrontendConfigManager {
    constructor() {
        this.STORAGE_KEY = 'system_configs';
        this.configs = {};
        this.isLoaded = false;
        this.loadPromise = null;
    }

    /**
     * 从后端加载配置
     * @returns {Promise<Object>} 配置对象
     */
    async loadConfigs() {
        // 如果已经在加载中，返回同一个 Promise
        if (this.loadPromise) {
            return this.loadPromise;
        }

        this.loadPromise = (async () => {
            try {
                // 尝试从 localStorage 读取缓存的配置（5 分钟内有效）
                const cached = localStorage.getItem(this.STORAGE_KEY);
                if (cached) {
                    const {configs, timestamp} = JSON.parse(cached);
                    // 0.5 分钟内使用缓存
                    if (Date.now() - timestamp < 0.5 * 60 * 1000) {
                        this.configs = configs;
                        this.isLoaded = true;
                        console.log('✅ 使用缓存的系统配置');
                        return this.configs;
                    }
                }

                // 从后端 API 获取最新配置
                const response = await fetch(TokenManager.getToken() ? '/api/chat/admin/settings/list_configs/' : '/api/chat/system/configs/', {
                    headers: TokenManager.getHeaders()
                });

                if (response.ok) {
                    const data = await response.json();
                    this.configs = {};

                    // 将配置转换为键值对
                    (data.configs || []).forEach(config => {
                        this.configs[config.key] = config.value;
                    });

                    // 缓存到 localStorage
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                        configs: this.configs,
                        timestamp: Date.now()
                    }));

                    this.isLoaded = true;
                    console.log('✅ 系统配置加载成功');
                    return this.configs;
                }
            } catch (error) {
                console.warn('⚠️ 加载系统配置失败，使用默认值:', error);
            }

            // 加载失败，使用默认配置
            this.configs = this.getDefaultConfigs();
            this.isLoaded = true;
            return this.configs;
        })();

        return this.loadPromise;
    }

    /**
     * 获取配置值
     * @param {string} key - 配置键
     * @param {*} defaultValue - 默认值
     * @returns {*} 配置值
     */
    get(key, defaultValue = null) {
        const value = this.configs[key];
        if (value === undefined || value === null) {
            return defaultValue;
        }

        // 类型转换
        const configType = this.getConfigType(key);
        switch (configType) {
            case 'integer':
                return parseInt(value) || defaultValue;
            case 'float':
                return parseFloat(value) || defaultValue;
            case 'boolean':
                return value === true || value === 'true' || value === '1';
            case 'json':
                try {
                    return JSON.parse(value);
                } catch {
                    return defaultValue;
                }
            default:
                return value;
        }
    }

    /**
     * 获取配置类型
     * @param {string} key - 配置键
     * @returns {string} 配置类型
     */
    getConfigType(key) {
        const typeMap = {
            'file.max_upload_size_mb': 'integer',
            'file.image_max_size_mb': 'integer',
            'file.video_max_size_mb': 'integer',
            'file.audio_max_size_mb': 'integer',
            'voice.max_duration_seconds': 'integer',
            'voice.min_duration_seconds': 'integer',
            'chat.max_message_length': 'integer',
            'chat.message_retention_days': 'integer',
            'chat.typing_timeout': 'integer',
            'security.login_max_attempts': 'integer',
            'security.login_lockout_minutes': 'integer',
            'security.session_timeout_hours': 'integer',
            'security.password_min_length': 'integer',
            'advanced.cache_ttl_seconds': 'integer',
            'advanced.api_rate_limit': 'integer',
            'system.user_registration_enabled': 'boolean',
            'system.maintenance_mode': 'boolean',
            'notification.desktop_enabled': 'boolean',
            'notification.sound_enabled': 'boolean',
            'notification.vibrate_enabled': 'boolean',
            'file.allowed_types': 'json',
            'file.image_formats': 'json',
            'file.video_formats': 'json',
            'voice.allowed_formats': 'json',
            'security.sensitive_words': 'json'
        };
        return typeMap[key] || 'string';
    }

    /**
     * 获取默认配置
     * @returns {Object} 默认配置对象
     */
    getDefaultConfigs() {
        return {
            'file.max_upload_size_mb': 50,
            'file.image_max_size_mb': 20,
            'file.video_max_size_mb': 100,
            'file.audio_max_size_mb': 30,
            'voice.max_duration_seconds': 60,
            'voice.min_duration_seconds': 1,
            'chat.max_message_length': 2000,
            'chat.message_retention_days': 365,
            'chat.typing_timeout': 5,
            'security.login_max_attempts': 5,
            'security.login_lockout_minutes': 15,
            'security.session_timeout_hours': 24,
            'security.password_min_length': 8,
            'advanced.cache_ttl_seconds': 300,
            'advanced.api_rate_limit': 100,
            'system.user_registration_enabled': false,
            'system.maintenance_mode': false,
            'notification.desktop_enabled': true,
            'notification.sound_enabled': true,
            'notification.vibrate_enabled': true,
            'file.allowed_types': ['image', 'video', 'audio', 'file'],
            'file.image_formats': ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            'file.video_formats': ['mp4', 'webm', 'mov'],
            'voice.allowed_formats': ['webm', 'mp3', 'm4a', 'ogg']
        };
    }

    /**
     * 清除配置缓存
     */
    clearCache() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.configs = {};
        this.isLoaded = false;
        this.loadPromise = null;
    }

    /**
     * 强制刷新配置
     * @returns {Promise<Object>} 配置对象
     */
    async refreshConfigs() {
        this.clearCache();
        return await this.loadConfigs();
    }
}

// 全局配置管理器实例
const frontendConfig = new FrontendConfigManager();

// 导出到全局
window.frontendConfig = frontendConfig;

// ==================== 设备权限工具（移动端 PWA 友好提示） ====================
class PermUtils {

    // 获取地理位置：成功 resolve {latitude, longitude, ...}；失败 reject {code, message}
    static getLocation(options) {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject({ code: 'UNSUPPORTED', message: '当前浏览器不支持定位功能' });
                return;
            }
            const opts = Object.assign({ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }, options || {});
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    resolve({
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        altitude: pos.coords.altitude,
                        heading: pos.coords.heading,
                        speed: pos.coords.speed,
                    });
                },
                function (err) {
                    let code = 'UNKNOWN';
                    let message = '获取位置失败：' + ((err && err.message) || '未知错误');
                    if (err && err.code === err.PERMISSION_DENIED) {
                        code = 'PERMISSION_DENIED';
                        message = '未授权定位权限，无法获取位置';
                    } else if (err && err.code === err.POSITION_UNAVAILABLE) {
                        code = 'POSITION_UNAVAILABLE';
                        message = '无法获取位置（定位信号弱或系统定位未开启）';
                    } else if (err && err.code === err.TIMEOUT) {
                        code = 'TIMEOUT';
                        message = '获取位置超时，请重试';
                    }
                    reject({ code: code, message: message });
                },
                opts
            );
        });
    }

    // 请求麦克风权限（用于语音消息/通话）：返回 {granted, code, message}
    static async requestMicrophone() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return { granted: false, code: 'UNSUPPORTED', message: '当前浏览器不支持麦克风' };
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(function (t) { t.stop(); });
            return { granted: true, code: 'GRANTED', message: '' };
        } catch (err) {
            const name = (err && err.name) || '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                return { granted: false, code: 'PERMISSION_DENIED', message: '麦克风权限被拒绝，无法录音' };
            }
            if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                return { granted: false, code: 'NOT_FOUND', message: '未检测到麦克风设备' };
            }
            return { granted: false, code: 'ERROR', message: '麦克风不可用：' + ((err && err.message) || '未知错误') };
        }
    }

    // 请求相机权限（用于视频通话/拍照）：返回 {granted, code, message}
    static async requestCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return { granted: false, code: 'UNSUPPORTED', message: '当前浏览器不支持相机' };
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(function (t) { t.stop(); });
            return { granted: true, code: 'GRANTED', message: '' };
        } catch (err) {
            const name = (err && err.name) || '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                return { granted: false, code: 'PERMISSION_DENIED', message: '相机权限被拒绝，无法使用相机' };
            }
            return { granted: false, code: 'ERROR', message: '相机不可用：' + ((err && err.message) || '未知错误') };
        }
    }

    // 是否以 PWA/独立窗口形式运行（已添加到桌面）
    static isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    // 展示权限引导对话框（引导用户去系统设置开启权限）
    static showPermissionGuide(type, extraMsg) {
        var labels = {
            location: ['定位权限', '定位服务/定位', '允许访问位置信息'],
            microphone: ['麦克风权限', '麦克风', '允许使用麦克风'],
            camera: ['相机权限', '相机', '允许使用相机'],
            file: ['文件访问权限', '文件/照片', '允许访问照片和文件'],
            notification: ['通知权限', '通知', '允许接收通知'],
        };
        var cfg = labels[type] || [type + '权限', type, '允许使用'];
        var title = cfg[0];
        var deviceName = cfg[1];
        var isStandalone = PermUtils.isStandalone();
        var steps = isStandalone
            ? ['前往「手机系统设置」→「应用管理」/「应用」→ 找到本应用', '开启「' + deviceName + '」权限开关', '返回后重新点击按钮']
            : ['点击浏览器地址栏左侧的「🔒/ℹ️ 网站信息」图标', '在「权限」中把「' + deviceName + '」设置为允许', '刷新页面后重新点击按钮'];
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);padding:20px;';
        var list = steps.map(function (s) { return '<li style="margin:2px 0;">' + s + '</li>'; }).join('');
        overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:360px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.25);overflow:hidden;">'
            + '<div style="display:flex;align-items:center;gap:8px;padding:14px 18px;background:#f5f7fa;border-bottom:1px solid #ebeef5;font-size:15px;font-weight:600;color:#303133;"><i class="fas fa-lock" style="color:#409eff;"></i> ' + title + '</div>'
            + '<div style="padding:16px 18px;font-size:14px;color:#606266;line-height:1.7;">'
            + '<p style="margin:0 0 8px;">需要「' + deviceName + '」权限才能完成该操作。' + (extraMsg || '') + '请在系统设置中开启：</p>'
            + '<ol style="margin:0;padding-left:20px;">' + list + '</ol>'
            + '</div>'
            + '<div style="padding:12px 18px;border-top:1px solid #ebeef5;text-align:right;">'
            + '<button style="padding:8px 22px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">知道了</button>'
            + '</div></div>';
        document.body.appendChild(overlay);
        var close = function () { overlay.remove(); };
        overlay.querySelector('button').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    }

    // 通用：获取定位失败时统一提示（isErrorToast=true 时用 toast，否则用引导对话框）
    static handleLocationError(err) {
        if (!err || typeof err === 'string') err = { code: 'UNKNOWN', message: err || '获取位置失败' };
        if (err.code === 'PERMISSION_DENIED') {
            PermUtils.showPermissionGuide('location');
        } else {
            // 无法定位/超时：先提示，给用户重试机会
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);padding:20px;';
            overlay.innerHTML = '<div style="background:#fff;border-radius:12px;max-width:340px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.25);overflow:hidden;">'
                + '<div style="display:flex;align-items:center;gap:8px;padding:14px 18px;background:#fdf6ec;border-bottom:1px solid #f5e6c8;font-size:15px;font-weight:600;color:#b88230;"><i class="fas fa-map-marker-alt" style="color:#e6a23c;"></i> 无法获取位置</div>'
                + '<div style="padding:16px 18px;font-size:14px;color:#606266;line-height:1.7;">' + (err.message || '定位失败') + '。<br>请检查手机系统定位服务是否开启，或移动到信号较好的位置后重试。</div>'
                + '<div style="padding:12px 18px;border-top:1px solid #ebeef5;text-align:right;display:flex;gap:8px;justify-content:flex-end;">'
                + '<button data-act="cancel" style="padding:8px 16px;background:#fff;color:#606266;border:1px solid #dcdfe6;border-radius:6px;cursor:pointer;font-size:14px;">知道了</button>'
                + '<button data-act="settings" style="padding:8px 16px;background:#409eff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">去开启定位</button>'
                + '</div></div>';
            document.body.appendChild(overlay);
            overlay.querySelector('[data-act="cancel"]').onclick = function () { overlay.remove(); };
            overlay.querySelector('[data-act="settings"]').onclick = function () { overlay.remove(); PermUtils.showPermissionGuide('location'); };
            overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
        }
    }
}
window.PermUtils = PermUtils;