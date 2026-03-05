// static/js/utils.js

// 工具函数
class Utils {

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
            element.scrollTop = element.scrollHeight;
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
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
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
}