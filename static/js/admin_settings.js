/**
 * @File   : admin_settings.js
 * @Time   : 2026/3/11
 * @Author : dayue
 * @Desc   : 管理控制台 - 系统设置模块（企业级重构版）
 */

// 全局变量挂载
let adminSettings = null;

class AdminSettingsClient {
    constructor() {

        this.isInitialized = false;
        this.categories = [];
        this.configs = {};
        this.currentCategory = 'basic';
        this.systemInfo = {};
        this.isLoading = false;
        this.pendingChanges = new Map(); // 跟踪未保存的修改

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            console.log('AdminSettingsClient DOMContentLoaded');
            // this.init();
        }
    }

    async init() {
        // 🔧 防止重复初始化
        if (this.isInitialized) {
            console.log('AdminSettingsClient 已初始化，跳过');
            return;
        }
        console.log('AdminSettingsClient 初始化开始...');

        try {
            // 权限检查
            const token = localStorage.getItem('access_token');
            if (!token) {
                // 保存当前页面链接，登录后跳转到该页面
                localStorage.setItem('redirect_url', window.location.href);
                window.location.href = '/login/';
                return;
            }

            const currentUser = await API.getCurrentUser();
            if (currentUser.user_type !== 'super_admin') {
                this.showError('权限不足', '仅超级管理员可访问系统设置');
                setTimeout(() => window.location.href = '/chat/', 2000);
                return;
            }

            // 加载数据
            await Promise.all([
                this.loadCategories(),
                this.loadConfigs(),
                this.loadSystemInfo()
            ]);

            // 设置事件监听
            this.setupEventListeners();

            // 渲染初始界面
            this.renderConfigList(this.currentCategory);


            this.isInitialized = true;

            console.log('AdminSettingsClient 初始化完成');

        } catch (error) {
            console.error('初始化失败:', error);
            this.showError('加载失败', error.message || '未知错误');
        }
    }

    // ==================== 数据加载 ====================

    async loadCategories() {
        try {
            const response = await fetch('/api/chat/admin/settings/categories/', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载分类失败');
            const data = await response.json();
            this.categories = data.categories || [];
            this.renderCategoryTabs();
        } catch (error) {
            console.error('加载分类失败:', error);
        }
    }

    async loadConfigs(category = null) {
        try {
            const url = category
                ? `/api/chat/admin/settings/list_configs/?category=${category}`
                : '/api/chat/admin/settings/list_configs/';

            const response = await fetch(url, {headers: TokenManager.getHeaders()});
            if (!response.ok) throw new Error('加载配置失败');
            const data = await response.json();

            // 按分类组织配置
            this.configs = {};
            (data.configs || []).forEach(config => {
                if (!this.configs[config.category]) {
                    this.configs[config.category] = [];
                }
                this.configs[config.category].push(config);
            });

            return data.configs;
        } catch (error) {
            console.error('加载配置失败:', error);
            return [];
        }
    }

    async loadSystemInfo() {
        try {
            const response = await fetch('/api/chat/admin/settings/system_info/', {
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('加载系统信息失败');
            this.systemInfo = await response.json();
            this.renderSystemInfo();
        } catch (error) {
            console.error('加载系统信息失败:', error);
        }
    }

    // ==================== 渲染方法 ====================

    renderCategoryTabs() {
        const container = document.getElementById('settingsCategoryTabs');
        if (!container) return;

        let html = '';
        this.categories.forEach(cat => {
            html += `
                <button class="tab-btn ${cat.key === this.currentCategory ? 'active' : ''}" 
                        data-category="${cat.key}"
                        onclick="adminSettings.switchCategory('${cat.key}')">
                    <i class="${cat.icon}"></i> ${cat.name}
                </button>
            `;
        });
        container.innerHTML = html;

    }

    renderConfigList(category) {
        const container = document.getElementById('configList');
        if (!container) return;

        const configs = this.configs[category] || [];

        if (configs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-cog"></i>
                    <p>暂无配置项</p>
                    <small class="text-muted">该分类下暂无可配置项</small>
                </div>
            `;
            return;
        }

        let html = '<div class="config-list">';

        configs.forEach(config => {
            const inputHtml = this.renderConfigInput(config);
            const hasChanges = this.pendingChanges.has(config.key);

            html += `
                <div class="config-item ${hasChanges ? 'modified' : ''}" data-key="${config.key}">
                    <div class="config-header">
                        <div class="config-name">
                            ${config.name}
                            ${config.is_modified ? '<span class="badge badge-info">已修改</span>' : ''}
                            ${config.is_default ? '<span class="badge badge-default">默认</span>' : ''}
                        </div>
                        ${config.updated_at ? `
                            <small class="config-updated">
                                更新于: ${new Date(config.updated_at).toLocaleString('zh-CN')}
                                ${config.updated_by ? ` by ${config.updated_by}` : ''}
                            </small>
                        ` : ''}
                    </div>
                    <div class="config-description">${config.description || ''}</div>
                    <div class="config-input">
                        ${inputHtml}
                    </div>
                    <div class="config-actions">
                        <button class="btn btn-sm btn-primary" onclick="adminSettings.saveConfig('${config.key}')" ${hasChanges ? '' : 'disabled'}>
                            <i class="fas fa-save"></i> 保存
                        </button>
                        ${!config.is_default ? `
                            <button class="btn btn-sm btn-secondary" onclick="adminSettings.resetConfig('${config.key}')">
                                <i class="fas fa-undo"></i> 重置
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        });

        html += '</div>';

        // 如果有未保存的修改，显示批量保存按钮
        if (this.pendingChanges.size > 0) {
            html += `
                <div class="batch-save-bar">
                    <span>有 ${this.pendingChanges.size} 项待保存</span>
                    <button class="btn btn-primary" onclick="adminSettings.batchSaveConfigs()">
                        <i class="fas fa-save"></i> 批量保存
                    </button>
                    <button class="btn btn-secondary" onclick="adminSettings.discardChanges()">
                        放弃修改
                    </button>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    renderConfigInput(config) {
        const value = config.value;
        const key = config.key;
        const validation = config.validation || {};

        switch (config.value_type) {
            case 'boolean':
                return `
                    <label class="switch">
                        <input type="checkbox" 
                               id="config_${key}" 
                               ${value ? 'checked' : ''}
                               onchange="adminSettings.onConfigChange('${key}', this.checked)">
                        <span class="slider"></span>
                    </label>
                    <span class="switch-label">${value ? '开启' : '关闭'}</span>
                `;

            case 'integer':
            case 'float':
                const step = config.value_type === 'float' ? '0.01' : '1';
                const min = validation.min || 0;
                const max = validation.max || 999999;
                return `
                    <input type="number" 
                           id="config_${key}" 
                           value="${value}" 
                           step="${step}"
                           min="${min}"
                           max="${max}"
                           class="form-input"
                           onchange="adminSettings.onConfigChange('${key}', this.value)">
                    <span class="input-hint">${this.getUnitHint(key)}</span>
                `;

            case 'json':
                return `
                    <textarea id="config_${key}" 
                              class="form-textarea json-input"
                              rows="4"
                              onchange="adminSettings.onConfigChange('${key}', this.value)">${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</textarea>
                    <small class="form-hint">请输入有效的 JSON 格式</small>
                `;

            case 'string':
                if (config.choices) {
                    // 下拉选择
                    const options = config.choices.map(choice =>
                        `<option value="${choice}" ${value === choice ? 'selected' : ''}>${choice}</option>`
                    ).join('');
                    return `
                        <select id="config_${key}" 
                                class="form-select"
                                onchange="adminSettings.onConfigChange('${key}', this.value)">
                            ${options}
                        </select>
                    `;
                }
                // 普通文本输入
                const maxLength = validation.max_length || 255;
                return `
                    <input type="text" 
                           id="config_${key}" 
                           value="${this.escapeHtml(value)}" 
                           maxlength="${maxLength}"
                           class="form-input"
                           onchange="adminSettings.onConfigChange('${key}', this.value)">
                `;

            default:
                return `<input type="text" id="config_${key}" value="${value}" class="form-input">`;
        }
    }

    getUnitHint(key) {
        const hints = {
            'file.max_upload_size_mb': 'MB',
            'file.image_max_size_mb': 'MB',
            'file.video_max_size_mb': 'MB',
            'file.audio_max_size_mb': 'MB',
            'voice.max_duration_seconds': '秒',
            'voice.min_duration_seconds': '秒',
            'chat.typing_timeout': '秒',
            'chat.message_retention_days': '天',
            'security.login_lockout_minutes': '分钟',
            'security.session_timeout_hours': '小时',
            'advanced.cache_ttl_seconds': '秒',
            'advanced.api_rate_limit': '次/分钟'
        };
        return hints[key] || '';
    }

    renderSystemInfo() {
        const container = document.getElementById('systemInfoPanel');
        if (!container || !this.systemInfo.server) return;

        const {server, resources, database, cache, celery} = this.systemInfo;

        container.innerHTML = `
            <div class="system-info-grid">
                <div class="info-card">
                    <h4><i class="fas fa-server"></i> 服务器</h4>
                    <div class="info-row">
                        <span>主机名:</span>
                        <strong>${server.hostname}</strong>
                    </div>
                    <div class="info-row">
                        <span>操作系统:</span>
                        <strong>${server.os}</strong>
                    </div>
                    <div class="info-row">
                        <span>Python:</span>
                        <strong>${server.python_version}</strong>
                    </div>
                    <div class="info-row">
                        <span>Django:</span>
                        <strong>${server.django_version}</strong>
                    </div>
                </div>
                
                <div class="info-card">
                    <h4><i class="fas fa-microchip"></i> CPU</h4>
                    <div class="progress-bar">
                        <div class="progress ${resources.cpu.usage_percent > 80 ? 'danger' : ''}" 
                             style="width: ${resources.cpu.usage_percent}%">
                            ${resources.cpu.usage_percent}%
                        </div>
                    </div>
                    <div class="info-row">
                        <span>核心数:</span>
                        <strong>${resources.cpu.cores}</strong>
                    </div>
                </div>
                
                <div class="info-card">
                    <h4><i class="fas fa-memory"></i> 内存</h4>
                    <div class="progress-bar">
                        <div class="progress ${resources.memory.usage_percent > 80 ? 'danger' : ''}" 
                             style="width: ${resources.memory.usage_percent}%">
                            ${resources.memory.usage_percent}%
                        </div>
                    </div>
                    <div class="info-row">
                        <span>已用:</span>
                        <strong>${resources.memory.used_gb}GB / ${resources.memory.total_gb}GB</strong>
                    </div>
                </div>
                
                <div class="info-card">
                    <h4><i class="fas fa-hdd"></i> 磁盘</h4>
                    <div class="progress-bar">
                        <div class="progress ${resources.disk.usage_percent > 80 ? 'danger' : ''}" 
                             style="width: ${resources.disk.usage_percent}%">
                            ${resources.disk.usage_percent}%
                        </div>
                    </div>
                    <div class="info-row">
                        <span>已用:</span>
                        <strong>${resources.disk.used_gb}GB / ${resources.disk.total_gb}GB</strong>
                    </div>
                </div>
                
                <div class="info-card">
                    <h4><i class="fas fa-database"></i> 数据库</h4>
                    <div class="info-row">
                        <span>引擎:</span>
                        <strong>${database.engine}</strong>
                    </div>
                    <div class="info-row">
                        <span>数据库:</span>
                        <strong>${database.name || 'N/A'}</strong>
                    </div>
                    <div class="info-row">
                        <span>连接数:</span>
                        <strong>${database.connections}</strong>
                    </div>
                </div>
                
                <div class="info-card">
                    <h4><i class="fas fa-cube"></i> 缓存</h4>
                    <div class="info-row">
                        <span>后端:</span>
                        <strong>${cache.backend}</strong>
                    </div>
                    <div class="info-row">
                        <span>状态:</span>
                        <strong class="${cache.status === 'ok' ? 'text-success' : cache.status === 'degraded' ? 'text-warning' : 'text-danger'}">
                            ${cache.status === 'ok' ? '✓ 正常' : cache.status === 'degraded' ? '⚠ 降级' : '✗ 异常'}
                        </strong>
                    </div>
                </div>
                
                
                <div class="info-card">
                    <h4><i class="fas fa-cube"></i> 计划任务</h4>
                    <div class="info-row">
                        <span>后端:</span>
                        <strong>${celery.backend}</strong>
                    </div>
                    <div class="info-row">
                        <span>beat 状态:</span>
                        <strong class="${celery.beat === 'ok' ? 'text-success' : celery.beat === 'degraded' ? 'text-warning' : 'text-danger'}">
                            ${celery.beat === 'ok' ? '✓ 正常' : celery.beat === 'degraded' ? '⚠ 降级' : '✗ 异常'}
                        </strong>
                    </div>
                    
                    <div class="info-row">
                        <span>worker 状态:</span>
                        <strong class="${celery.worker === 'ok' ? 'text-success' : celery.worker === 'degraded' ? 'text-warning' : 'text-danger'}">
                            ${celery.worker === 'ok' ? '✓ 正常' : celery.worker === 'degraded' ? '⚠ 降级' : '✗ 异常'}
                        </strong>
                    </div>
                    
                </div>
                
            </div>
            
            <div style="margin-top: 20px; text-align: right;">
                <button class="btn btn-secondary" onclick="adminSettings.refreshSystemInfo()">
                    <i class="fas fa-sync"></i> 刷新
                </button>
            </div>
        `;
    }

    // ==================== 事件处理 ====================

    setupEventListeners() {
        // 分类切换已在 renderCategoryTabs 中绑定

        // 批量保存按钮（动态添加）
        document.addEventListener('click', (e) => {
            if (e.target.closest('#batchSaveBtn')) {
                this.batchSaveConfigs();
            }
            if (e.target.closest('#clearCacheBtn')) {
                this.clearCache();
            }
            if (e.target.closest('#testNotifyBtn')) {
                this.sendTestNotification();
            }
        });

        // JSON 输入格式化
        document.addEventListener('blur', (e) => {
            if (e.target.classList.contains('json-input')) {
                try {
                    const parsed = JSON.parse(e.target.value);
                    e.target.value = JSON.stringify(parsed, null, 2);
                } catch (err) {
                    // 保持原值，用户输入时验证
                }
            }
        }, true);
    }

    switchCategory(category) {
        this.currentCategory = category;

        // 更新标签激活状态
        document.querySelectorAll('#settingsCategoryTabs .tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.category === category);
        });

        const settingsCategoryTitle = document.getElementById('settingsCategoryTitle');
        if (settingsCategoryTitle) {
            const currentCategory = this.categories.find(cat => cat.key === category);
            settingsCategoryTitle.textContent = currentCategory ? currentCategory.name : '基本设置';
        }

        // 渲染配置列表
        this.renderConfigList(category);
    }

    onConfigChange(key, value) {
        const config = this.findConfig(key);
        if (!config) return;

        // 实时验证
        if (config.value_type === 'json') {
            try {
                JSON.parse(value);
            } catch (e) {
                this.showToast('JSON 格式错误', 'error');
                return;
            }
        }

        // 标记为已修改
        this.pendingChanges.set(key, {
            original: config.value,
            current: value,
            config: config
        });

        // 更新 UI 状态
        const configItem = document.querySelector(`.config-item[data-key="${key}"]`);
        if (configItem) {
            configItem.classList.add('modified');
            const saveBtn = configItem.querySelector('.btn-primary');
            if (saveBtn) saveBtn.disabled = false;
        }

        // 更新批量保存栏
        this.updateBatchSaveBar();
    }

    findConfig(key) {
        for (const category of Object.values(this.configs)) {
            const config = category.find(c => c.key === key);
            if (config) return config;
        }
        return null;
    }

    updateBatchSaveBar() {
        const count = this.pendingChanges.size;
        const bar = document.querySelector('.batch-save-bar');

        if (count > 0 && !bar) {
            // 添加批量保存栏
            const container = document.getElementById('configList');
            if (container) {
                const barHtml = `
                    <div class="batch-save-bar">
                        <span>有 ${count} 项待保存</span>
                        <button class="btn btn-primary" id="batchSaveBtn">
                            <i class="fas fa-save"></i> 批量保存
                        </button>
                        <button class="btn btn-secondary" onclick="adminSettings.discardChanges()">
                            放弃修改
                        </button>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', barHtml);
            }
        } else if (count === 0 && bar) {
            bar.remove();
        } else if (bar) {
            bar.querySelector('span').textContent = `有 ${count} 项待保存`;
        }
    }

    // ==================== 配置操作 ====================

    async saveConfig(key) {
        const pending = this.pendingChanges.get(key);
        if (!pending) return;

        try {
            this.showLoading();

            const response = await fetch('/api/chat/admin/settings/update_config/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({key, value: pending.current})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '保存失败');
            }

            const data = await response.json();
            this.showSuccess('保存成功', data.message);

            // 更新本地状态
            pending.config.value = data.config.value;
            pending.config.updated_at = data.config.updated_at;
            this.pendingChanges.delete(key);

            // 更新 UI
            const configItem = document.querySelector(`.config-item[data-key="${key}"]`);
            if (configItem) {
                configItem.classList.remove('modified');
                configItem.querySelector('.btn-primary').disabled = true;
            }
            this.updateBatchSaveBar();

        } catch (error) {
            console.error('保存配置失败:', error);
            this.showError('保存失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async batchSaveConfigs() {
        if (this.pendingChanges.size === 0) {
            this.showToast('没有需要保存的修改', 'info');
            return;
        }

        const confirmed = await this.showConfirmDialog(
            '批量保存',
            `确定要保存 ${this.pendingChanges.size} 个配置项的修改吗？`,
            'confirm'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const configs = Array.from(this.pendingChanges.entries()).map(([key, pending]) => ({
                key,
                value: pending.current
            }));

            const response = await fetch('/api/chat/admin/settings/batch_update/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({configs})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '批量保存失败');
            }

            const data = await response.json();
            this.showSuccess('批量保存完成', data.message);

            // 清除已保存的修改
            data.results.forEach(result => {
                if (result.status === 'success') {
                    this.pendingChanges.delete(result.key);
                }
            });

            // 重新加载配置
            await this.loadConfigs(this.currentCategory);
            this.renderConfigList(this.currentCategory);

        } catch (error) {
            console.error('批量保存失败:', error);
            this.showError('保存失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async resetConfig(key) {
        const confirmed = await this.showConfirmDialog(
            '重置配置',
            '确定要将此配置项重置为默认值吗？',
            'confirm'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch('/api/chat/admin/settings/reset_to_default/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({key})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '重置失败');
            }

            const data = await response.json();
            this.showSuccess('重置成功', data.message);

            // 清除待保存的修改
            this.pendingChanges.delete(key);

            // 重新加载配置
            await this.loadConfigs(this.currentCategory);
            this.renderConfigList(this.currentCategory);

        } catch (error) {
            console.error('重置配置失败:', error);
            this.showError('重置失败', error.message);
        } finally {
            this.hideLoading();
        }
    }


    // ==================== 配置导出 ====================

    /**
     * 导出系统配置
     * @param {string} format - 导出格式：'csv' 或 'json'
     * @param {string} category - 可选：只导出指定分类的配置
     */
    async exportConfigs(format = 'csv', category = null) {
        try {
            // 构建查询参数
            const params = new URLSearchParams({
                fmt: format
            });

            if (category) {
                params.append('category', category);
            }

            // 显示确认对话框
            const formatLabel = format === 'json' ? 'JSON' : 'CSV';
            const categoryLabel = category ? `（${this.getCategoryName(category)}）` : '（全部）';

            const confirmed = await this.showConfirmDialog(
                '导出配置',
                `确定要导出 ${formatLabel} 格式的系统配置${categoryLabel}吗？`,
                'confirm'
            );

            if (!confirmed) return;

            this.showLoading();

            // 🔧 关键修复1: 使用 fetch 下载文件（携带 Token）
            const url = `/api/chat/admin/settings/export_configs/?${params.toString()}`;

            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: TokenManager.getHeaders()  // 🔧 携带认证 Token
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    this.showError('导出失败', errorText);
                    throw new Error(`导出失败：${response.status} ${errorText.substring(0, 200)}`);
                }

                // 🔧 关键修复2: 获取 Blob 并触发下载
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);

                // 从 Content-Disposition 头获取文件名
                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = `system_configs_${new Date().toISOString().split('T')[0]}.${format}`;
                if (contentDisposition) {
                    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                    if (filenameMatch) {
                        filename = filenameMatch[1];
                    }
                }

                // 创建下载链接
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // 释放 URL 对象
                window.URL.revokeObjectURL(downloadUrl);

                this.showSuccess('导出成功', `配置文件已下载`);

            } catch (error) {
                console.error('导出配置失败:', error);
                throw error;
            }

        } catch (error) {
            console.error('导出配置失败:', error);
            this.showError('导出失败', error.message || '未知错误');
        } finally {
            this.hideLoading();
        }
    }


    /**
     * 获取分类名称（用于显示）
     * @param {string} categoryKey - 分类键
     * @returns {string} 分类中文名称
     */
    getCategoryName(categoryKey) {
        const categoryMap = {
            'basic': '基础设置',
            'chat': '聊天设置',
            'file': '文件设置',
            'voice': '语音设置',
            'security': '安全设置',
            'notification': '通知设置',
            'advanced': '高级设置'
        };
        return categoryMap[categoryKey] || categoryKey;
    }

    /**
     * 导出当前分类的配置（绑定到页面按钮）
     */
    exportCurrentCategoryConfigs() {
        const format = 'csv'; // 默认导出 CSV
        this.exportConfigs(format, this.currentCategory);
    }

    /**
     * 导出全部配置（绑定到页面按钮）
     */
    exportAllConfigs() {
        const format = 'csv'; // 默认导出 CSV
        this.exportConfigs(format, null);
    }


    discardChanges() {
        const confirmed = confirm('确定要放弃所有未保存的修改吗？');
        if (!confirmed) return;

        this.pendingChanges.clear();
        this.renderConfigList(this.currentCategory);
        this.showToast('已放弃所有修改', 'info');
    }

    // ==================== 系统操作 ====================

    async refreshSystemInfo() {
        try {
            this.showLoading();
            await this.loadSystemInfo();
            this.showSuccess('刷新成功', '系统信息已更新');
        } catch (error) {
            console.error('刷新系统信息失败:', error);
            this.showError('刷新失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async clearCache() {
        const confirmed = await this.showConfirmDialog(
            '清除缓存',
            '确定要清除系统缓存吗？<br><small style="color: var(--text-light);">这不会影响用户数据，但可能会暂时增加服务器负载</small>',
            'confirm'
        );

        if (!confirmed) return;

        try {
            this.showLoading();

            const response = await fetch('/api/chat/admin/settings/clear_cache/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({type: 'all'})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '清除失败');
            }

            const data = await response.json();
            this.showSuccess('清除成功', data.message);

        } catch (error) {
            console.error('清除缓存失败:', error);
            this.showError('清除失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    async sendTestNotification() {
        const email = prompt('请输入接收测试通知的邮箱:', this.currentUser?.email || '');
        if (!email) return;

        try {
            this.showLoading();

            const response = await fetch('/api/chat/admin/settings/send_test_notification/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({email})
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '发送失败');
            }

            const data = await response.json();
            this.showSuccess('发送成功', data.message);

        } catch (error) {
            console.error('发送测试通知失败:', error);
            this.showError('发送失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // ==================== 工具方法 ====================

    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    showLoading() {
        if (document.querySelector('.loading-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div>';
        document.body.appendChild(overlay);
    }

    hideLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) overlay.parentNode.removeChild(overlay);
    }

    showError(title, message) {
        this.showToast(`${title}: ${message}`, 'error');
    }

    showSuccess(title, message) {
        this.showToast(`${title}: ${message}`, 'success');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${type === 'error' ? '错误' : type === 'success' ? '成功' : '提示'}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async showConfirmDialog(title, message, type = 'confirm') {
        return new Promise(resolve => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = `
                <div class="confirm-dialog-content">
                    <div class="confirm-dialog-header">
                        <i class="fas fa-${type === 'danger' ? 'exclamation-triangle' : 'check-circle'}"></i>
                        <h3>${title}</h3>
                        <button class="close-btn">&times;</button>
                    </div>
                    <div class="confirm-dialog-body"><p>${message}</p></div>
                    <div class="confirm-dialog-footer">
                        <button class="confirm-dialog-btn cancel">取消</button>
                        <button class="confirm-dialog-btn ${type}">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);

            const close = (result) => {
                dialog.style.opacity = '0';
                setTimeout(() => {
                    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
                }, 300);
                resolve(result);
            };

            dialog.querySelector('.cancel').onclick = () => close(false);
            dialog.querySelector(`.${type}`).onclick = () => close(true);
            dialog.querySelector('.close-btn').onclick = () => close(false);
            dialog.onclick = (e) => {
                if (e.target === dialog) close(false);
            };

            setTimeout(() => dialog.style.opacity = '1', 10);
        });
    }
}

// 全局初始化
document.addEventListener('DOMContentLoaded', () => {
    adminSettings = new AdminSettingsClient();
    window.adminSettings = adminSettings;
    console.log('AdminSettingsClient 全局实例化完成');
});