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
        return /iPad|iPhone|iPod|Mac|Safari/.test(navigator.userAgent) && !window.MSStream;
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