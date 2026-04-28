/**
 * @File   : cloud_config.js
 * @Desc   : 企业网盘系统配置管理前端逻辑
 */
class CloudConfigManager {
    constructor() {
        this.categories = [];
        this.configs = [];
        this.currentCategory = 'basic';
        this.searchKeyword = '';
        this.init();
    }

    async init() {
        await this.loadCategories();
        await this.loadConfigs();
        this.setupEventListeners();
        this.render();
    }

    async loadCategories() {
        try {
            const response = await fetch('/api/cloud/settings/categories/', {
                headers: TokenManager.getHeaders()
            });
            const data = await response.json();
            this.categories = data.categories || [];
        } catch (error) {
            console.error('加载分类失败:', error);
        }
    }

    async loadConfigs(category = null, search = '') {
        try {
            const params = new URLSearchParams();
            if (category) params.append('category', category);
            if (search) params.append('search', search);

            const response = await fetch(`/api/cloud/settings/list_configs/?${params}`, {
                headers: TokenManager.getHeaders()
            });
            const data = await response.json();
            this.configs = data.configs || [];
            return data;
        } catch (error) {
            console.error('加载配置失败:', error);
            return { configs: [] };
        }
    }

    async updateConfig(key, value) {
        try {
            const response = await fetch('/api/cloud/settings/update_config/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({ key, value })
            });
            return await response.json();
        } catch (error) {
            console.error('更新配置失败:', error);
            throw error;
        }
    }

    async batchUpdate(configs) {
        try {
            const response = await fetch('/api/cloud/settings/batch_update/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({ configs })
            });
            return await response.json();
        } catch (error) {
            console.error('批量更新失败:', error);
            throw error;
        }
    }

    async resetConfig(key) {
        try {
            const response = await fetch('/api/cloud/settings/reset_to_default/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...TokenManager.getHeaders()
                },
                body: JSON.stringify({ key })
            });
            return await response.json();
        } catch (error) {
            console.error('重置配置失败:', error);
            throw error;
        }
    }

    render() {
        this.renderCategories();
        this.renderConfigList();
    }

    renderCategories() {
        const container = document.getElementById('configCategories');
        if (!container) return;

        container.innerHTML = this.categories.map(cat => `
            <button class="config-category-btn ${cat.key === this.currentCategory ? 'active' : ''}" 
                    data-category="${cat.key}" onclick="cloudConfig.switchCategory('${cat.key}')">
                <i class="${cat.icon}"></i> ${cat.name}
                <span class="badge">${cat.count}</span>
            </button>
        `).join('');
    }

    renderConfigList() {
        const container = document.getElementById('configList');
        if (!container) return;

        const filtered = this.configs.filter(c =>
            c.category === this.currentCategory &&
            (!this.searchKeyword ||
             c.key.toLowerCase().includes(this.searchKeyword.toLowerCase()) ||
             c.name.toLowerCase().includes(this.searchKeyword.toLowerCase()))
        );

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p>暂无配置项</p></div>';
            return;
        }

        container.innerHTML = filtered.map(config => `
            <div class="config-item" data-key="${config.key}">
                <div class="config-header">
                    <h4>${this.escapeHtml(config.name)}</h4>
                    ${config.is_default ? '<span class="badge badge-info">默认值</span>' : ''}
                    ${!config.is_editable ? '<span class="badge badge-warning">只读</span>' : ''}
                </div>
                <p class="config-description">${this.escapeHtml(config.description || '')}</p>
                
                <div class="config-control">
                    ${this.renderConfigInput(config)}
                </div>
                
                <div class="config-actions">
                    ${config.is_editable ? `
                        <button class="btn btn-sm btn-primary" onclick="cloudConfig.saveConfig('${config.key}')">保存</button>
                        <button class="btn btn-sm btn-secondary" onclick="cloudConfig.resetConfig('${config.key}')">重置</button>
                    ` : ''}
                    <small class="text-muted">类型: ${config.value_type} | 分类: ${config.category}</small>
                </div>
            </div>
        `).join('');
    }

    renderConfigInput(config) {
        const value = config.typed_value !== undefined ? config.typed_value : config.value;
        const validation = config.validation_rules || {};

        switch (config.value_type) {
            case 'boolean':
                return `
                    <label class="switch">
                        <input type="checkbox" ${value ? 'checked' : ''} 
                               onchange="cloudConfig.onBooleanChange('${config.key}', this.checked)">
                        <span class="slider"></span>
                    </label>
                    <span class="value-label">${value ? '启用' : '禁用'}</span>
                `;
            case 'integer':
            case 'float':
                return `
                    <input type="number" 
                           value="${value}" 
                           data-key="${config.key}"
                           ${validation.min !== undefined ? `min="${validation.min}"` : ''}
                           ${validation.max !== undefined ? `max="${validation.max}"` : ''}
                           class="form-control config-input"
                           onchange="cloudConfig.onNumberChange('${config.key}', this.value)">
                `;
            case 'password':
                return `
                    <div class="input-group">
                        <input type="password" value="${value}" data-key="${config.key}"
                               class="form-control config-input"
                               ${validation.min_length ? `minlength="${validation.min_length}"` : ''}
                               onchange="cloudConfig.onStringChange('${config.key}', this.value)">
                        <button type="button" class="btn btn-outline-secondary" 
                                onclick="cloudConfig.togglePasswordVisibility(this)">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                `;
            case 'json':
                return `
                    <textarea class="form-control config-input json-editor" 
                              data-key="${config.key}"
                              rows="4"
                              onchange="cloudConfig.onJsonChange('${config.key}', this.value)">${typeof value === 'object' ? JSON.stringify(value, null, 2) : value}</textarea>
                `;
            default: // string
                return `
                    <input type="text" value="${this.escapeHtml(value)}" data-key="${config.key}"
                           class="form-control config-input"
                           ${validation.min_length ? `minlength="${validation.min_length}"` : ''}
                           ${validation.max_length ? `maxlength="${validation.max_length}"` : ''}
                           ${validation.pattern ? `pattern="${validation.pattern}"` : ''}
                           onchange="cloudConfig.onStringChange('${config.key}', this.value)">
                `;
        }
    }

    // 事件处理
    switchCategory(category) {
        this.currentCategory = category;
        this.renderCategories();
        this.loadConfigs(category, this.searchKeyword).then(() => this.renderConfigList());
    }

    onSearch(keyword) {
        this.searchKeyword = keyword;
        this.loadConfigs(this.currentCategory, keyword).then(() => this.renderConfigList());
    }

    onBooleanChange(key, value) {
        this.updateConfig(key, value)
            .then(() => this.showToast('配置已保存', 'success'))
            .catch(err => this.showToast('保存失败: ' + err.message, 'error'));
    }

    onNumberChange(key, value) {
        this.updateConfig(key, value)
            .then(() => this.showToast('配置已保存', 'success'))
            .catch(err => this.showToast('保存失败: ' + err.message, 'error'));
    }

    onStringChange(key, value) {
        this.updateConfig(key, value)
            .then(() => this.showToast('配置已保存', 'success'))
            .catch(err => this.showToast('保存失败: ' + err.message, 'error'));
    }

    async onJsonChange(key, value) {
        try {
            JSON.parse(value); // 验证 JSON
            await this.updateConfig(key, value);
            this.showToast('配置已保存', 'success');
        } catch (e) {
            this.showToast('JSON 格式错误: ' + e.message, 'error');
        }
    }

    async saveConfig(key) {
        const input = document.querySelector(`[data-key="${key}"]`);
        if (!input) return;

        let value = input.type === 'checkbox' ? input.checked : input.value;
        const config = this.configs.find(c => c.key === key);

        if (config?.value_type === 'json' && typeof value === 'string') {
            try { value = JSON.parse(value); } catch(e) {}
        }

        try {
            await this.updateConfig(key, value);
            this.showToast('配置已保存', 'success');
            this.loadConfigs(this.currentCategory).then(() => this.renderConfigList());
        } catch (err) {
            this.showToast('保存失败: ' + err.message, 'error');
        }
    }

    async resetConfig(key) {
        if (!confirm('确定要重置此配置为默认值吗？')) return;

        try {
            await this.resetConfig(key);
            this.showToast('配置已重置', 'success');
            this.loadConfigs(this.currentCategory).then(() => this.renderConfigList());
        } catch (err) {
            this.showToast('重置失败: ' + err.message, 'error');
        }
    }

    togglePasswordVisibility(btn) {
        const input = btn.previousElementSibling;
        if (input.type === 'password') {
            input.type = 'text';
            btn.innerHTML = '<i class="fas fa-eye-slash"></i>';
        } else {
            input.type = 'password';
            btn.innerHTML = '<i class="fas fa-eye"></i>';
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<strong>${type === 'error' ? '错误' : '成功'}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'};
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    setupEventListeners() {
        // 搜索
        const searchInput = document.getElementById('configSearch');
        if (searchInput) {
            searchInput.addEventListener('input',
                Utils.debounce((e) => this.onSearch(e.target.value), 300)
            );
        }

        // 导出配置
        const exportBtn = document.getElementById('exportConfigsBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const fmt = document.getElementById('exportFormat')?.value || 'csv';
                window.open(`/api/cloud/settings/export_configs/?fmt=${fmt}`, '_blank');
            });
        }

        // 清除缓存
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', async () => {
                if (!confirm('确定要清除系统缓存吗？')) return;
                try {
                    await fetch('/api/cloud/settings/clear_cache/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...TokenManager.getHeaders()
                        },
                        body: JSON.stringify({ type: 'all' })
                    });
                    this.showToast('缓存已清除', 'success');
                } catch (err) {
                    this.showToast('清除失败', 'error');
                }
            });
        }
    }
}

// 全局初始化
let cloudConfig = null;
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('configList')) {
        cloudConfig = new CloudConfigManager();
        window.cloudConfig = cloudConfig;
    }
});