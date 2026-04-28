/**
 * @File   : frontend_cloud_config.js
 * @Desc   : 前端配置加载器（从后端获取公开配置）
 */
class FrontendCloudConfig {
    constructor() {
        this.configs = {};
        this.loaded = false;
    }

    async loadConfigs() {
        if (this.loaded) return this.configs;

        try {
            const response = await fetch('/api/cloud/settings/public_configs/', {
                headers: TokenManager.getHeaders()
            });
            const data = await response.json();
            this.configs = data.configs || {};
            this.loaded = true;
            return this.configs;
        } catch (error) {
            console.warn('加载前端配置失败，使用默认值:', error);
            return this.configs;
        }
    }

    get(key, defaultValue = null) {
        return this.configs[key] !== undefined ? this.configs[key] : defaultValue;
    }

    getAll() {
        return { ...this.configs };
    }

    // 🔧 便捷获取方法
    getCloudName() {
        return this.get('cloud.name', '企业网盘');
    }

    getMaxUploadSize() {
        return this.get('upload.max_file_size_mb', 50) * 1024 * 1024; // 转字节
    }

    getImageMaxSize() {
        return this.get('upload.image_max_size_mb', 20) * 1024 * 1024;
    }

    getVideoMaxSize() {
        return this.get('upload.video_max_size_mb', 100) * 1024 * 1024;
    }

    getAudioMaxSize() {
        return this.get('upload.audio_max_size_mb', 30) * 1024 * 1024;
    }

    getAllowedFileTypes() {
        return this.get('upload.allowed_types', ['image', 'video', 'audio', 'file']);
    }

    getStorageQuota() {
        return this.get('storage.quota_gb', 10) * 1024 * 1024 * 1024; // 转字节
    }

    getOnlyOfficeUrl() {
        return this.get('onlyoffice.document_server_url', 'https://chat.first-iq.com/onlyoffice/');
    }

    isEmailNotificationEnabled() {
        return this.get('notification.email_enabled', true);
    }
}

// 全局实例
const frontendCloudConfig = new FrontendCloudConfig();
window.frontendCloudConfig = frontendCloudConfig;