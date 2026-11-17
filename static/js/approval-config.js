// static/js/approval-config.js - 审批类型管理、生命周期配置、企业配置与财务专员
// 说明：本文件为 ApprovalApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ApprovalApp.prototype, {

    // ===== 审批类型管理（企业自定义类型 + 表单 schema 编辑器） =====
    async openTypeManageModal() {
        document.getElementById('approvalTypeManageModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('approvalTypeManageModal').classList.add('show');
        }, 10);
        this._typeManageEditingType = null;
        // 未选中类型时右侧不渲染内容，仅显示引导占位
        this._renderTypeManageForm(null);
        this._initSplitter('tmSplitter', 'tmManageLayout', 'tmSidebar');
        await this._loadTypeManageList();
    },

    // 左右拖动分隔条（动态调整左右占比，桌面端；可复用于配置/类型管理模态框）
    _initSplitter(splitterId, layoutId, sidebarId) {
        if (!this._splittersInit) this._splittersInit = {};
        if (this._splittersInit[splitterId]) return;
        this._splittersInit[splitterId] = true;
        const splitter = document.getElementById(splitterId);
        const layout = document.getElementById(layoutId);
        const sidebar = document.getElementById(sidebarId);
        if (!splitter || !layout || !sidebar) return;
        let dragging = false;
        splitter.addEventListener('mousedown', function (e) {
            e.preventDefault();
            dragging = true;
            splitter.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            const rect = layout.getBoundingClientRect();
            if (!rect.width) return;
            let pct = ((e.clientX - rect.left) / rect.width) * 100;
            pct = Math.max(18, Math.min(pct, 62));
            sidebar.style.flex = '0 0 ' + pct + '%';
            sidebar.style.width = pct + '%';
        });
        document.addEventListener('mouseup', function () {
            if (dragging) {
                dragging = false;
                splitter.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    },

    async _loadTypeManageList() {
        const list = document.getElementById('typeManageList');
        if (!list) return;
        try {
            // scope=manage：包含未启用类型，保证未启用的自定义类型也能编辑/重新启用
            const data = await this.apiGet(OA_API_URL + '/approval/types/?scope=manage');
            this._manageTypes = Array.isArray(data) ? data : (data.results || []);
            const types = this._manageTypes;
            const cur = this._typeManageEditingType;
            // 内置 + 自定义类型均展示，支持启用/禁用开关；内置类型其它字段锁定
            list.innerHTML = types.map(function (t) {
                var active = (cur && cur.id === t.id) ? ' active' : '';
                var tag = t.is_builtin
                    ? '<span style="font-size:11px;color:#909399;background:#f0f2f5;border-radius:4px;padding:1px 6px;flex-shrink:0;">内置</span>'
                    : '<span class="tm-fields">' + (t.form_schema || []).length + ' 字段</span>';
                // 启用/禁用审批类型：仅超级管理员可操作，其他用户只看到状态（不可点）
                var isSuper = false;
                try { isSuper = (localStorage.getItem('user_type') === 'super_admin'); } catch (e) { /* ignore */ }
                var enableHtml = isSuper
                    ? '<label class="oa-switch" onclick="event.stopPropagation()" title="打开后该类型在新建审批和顶部筛选中显示"><input type="checkbox"' + (t.enabled ? ' checked' : '') + ' onchange="approvalApp._toggleTypeEnabled(' + t.id + ', this.checked)"><span class="oa-switch-slider"></span></label>'
                    : '<span title="仅超级管理员可启用/禁用审批类型" style="font-size:11px;border-radius:4px;padding:1px 6px;flex-shrink:0;'
                      + (t.enabled ? 'color:#67c23a;background:#f0f9eb;' : 'color:#909399;background:#f0f2f5;') + '">'
                      + (t.enabled ? '已启用' : '已禁用') + '</span>';
                return '<div class="config-list-item' + active + '" data-id="' + t.id + '" onclick="approvalApp._editTypeManage(' + t.id + ')">'
                    + '<i class="fas ' + (t.icon || 'fa-file-lines') + '" style="color:' + t.color + ';width:16px;text-align:center;"></i>'
                    + '<span style="flex:1;">' + this._escape(t.name) + '</span>'
                    + tag
                    + enableHtml
                    + '</div>';
            }, this).join('') || '<div style="padding:12px;color:#909399;font-size:13px;">暂无审批类型</div>';
        } catch (e) {
            console.error('加载类型列表失败:', e);
        }
    },

    _editTypeManage(id) {
        // 用类型管理列表（含未启用）查找，保证未启用的自定义类型也可编辑/启用
        const t = (this._manageTypes || []).find(function (x) {
            return x.id === id;
        });
        if (t) this._renderTypeManageForm(t);
        // 更新左侧列表选中高亮
        document.querySelectorAll('#typeManageList .config-list-item').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.getAttribute('data-id')) === id);
        });
    },

    _newType() {
        this._renderTypeManageForm({
            name: '',
            code: '',
            icon: 'fa-file-lines',
            color: '#409EFF',
            description: '',
            enabled: true,
            form_schema: [],
            is_builtin: false,
            id: null
        });
    },

    _fieldTypeOptions(sel) {
        const types = [
            ['text', '单行文本'], ['textarea', '多行文本'], ['number', '数字'],
            ['date', '日期'], ['datetime', '日期时间'], ['amount', '金额'],
            ['select', '下拉选择'], ['radio', '单选'], ['checkbox', '多选'],
            ['attachment', '附件'], ['invoice', '发票'], ['department', '部门选择'], ['user', '成员选择'],
            ['expense_type', '费用类型选择'], ['struct_table', '结构化数据明细'],
            ['payment_method', '收款方式'], ['link_requisition', '关联需求单']
        ];
        return types.map(function (t) {
            return '<option value="' + t[0] + '"' + (sel === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('');
    },

    // schema 编辑器：options 输入框占位提示随字段类型变化
    _schemaOptionsPlaceholder(type) {
        if (type === 'struct_table') return '列定义：key:名称:类型|key2:名称2（如 name:项目名称:amount|remark:备注，类型 text/number/amount/item）';
        if (type === 'link_requisition') return '关联明细字段key（如 items，选择需求单后自动带出到该明细）';
        if (['select', 'radio', 'checkbox'].indexOf(type) !== -1) return '选项（逗号分隔，下拉/单选/多选用）';
        return '选项（下拉/单选/多选 或 结构化明细 使用）';
    },

    _renderTypeManageForm(type) {
        const wrap = document.getElementById('typeManageFormWrap');
        if (!wrap) return;
        if (!type) {
            wrap.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-light,#909399);">'
                + '<i class="fas fa-chevron-left" style="font-size:24px;display:block;margin-bottom:12px;"></i>'
                + '<p>请从左侧选择类型编辑，或新建一个类型</p></div>';
            return;
        }
        this._typeManageEditingType = type;
        // 内置类型：名称/编码/图标/颜色/说明/表单字段全部锁定，仅启用开关可操作
        const locked = type.is_builtin ? ' disabled' : '';
        const schema = type.form_schema || [];
        let fieldRows = schema.map(function (f, i) {
            const ftype = f.type || 'text';
            // options 输入框：struct_table 回填列定义（key:名称:类型|...），其余回填 options
            let optsVal = '';
            if (ftype === 'struct_table') {
                optsVal = (f.columns || []).map(function (c) {
                    return (c.key || '') + ':' + (c.label || c.key || '') + ':' + (c.type || 'text');
                }).join('|');
            } else {
                optsVal = Array.isArray(f.options) ? f.options.map(function (o) {
                    return typeof o === 'object' ? o.value : o;
                }).join(',') : (f.options || '');
            }
            const optsPlaceholder = this._schemaOptionsPlaceholder(ftype);
            return '<div class="tm-field-row" style="border:1px solid #dcdfe6;border-radius:8px;padding:8px;margin-bottom:8px;background:#fafbfc;">'
                + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
                + '<input type="text" class="form-input" data-f="label" placeholder="字段名称" value="' + this._escape(f.label || '') + '" style="flex:1;min-width:70px;">'
                + '<input type="text" class="form-input" data-f="key" placeholder="字段key" value="' + this._escape(f.key || '') + '" style="width:90px;">'
                + '<select class="form-select" data-f="type" style="width:128px;" onchange="approvalApp._onSchemaFieldTypeChange(this)">' + this._fieldTypeOptions(ftype) + '</select>'
                + '<label style="font-size:12px;"><input type="checkbox" data-f="required"' + (f.required ? ' checked' : '') + '> 必填</label>'
                + '<button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removeSchemaField(this)"><i class="fas fa-times"></i></button>'
                + '</div>'
                + '<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
                + '<input type="text" class="form-input" data-f="placeholder" placeholder="占位提示" value="' + this._escape(f.placeholder || '') + '" style="flex:1;min-width:70px;">'
                + '<input type="text" class="form-input" data-f="options" placeholder="' + this._escape(optsPlaceholder) + '" value="' + this._escape(optsVal) + '" style="flex:2;min-width:80px;">'
                + '<select class="form-select" data-f="unit" style="width:110px;" title="金额/数字字段可设置单位">' + this._schemaUnitOptions(ftype, f.unit || (ftype === 'amount' ? 'cny' : '')) + '</select>'
                + '</div></div>';
        }, this).join('');
        wrap.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">'
            + '<div><label style="font-size:12px;">类型名称</label><input type="text" id="tmName" class="form-input" value="' + this._escape(type.name || '') + '"' + locked + '></div>'
            + '<div><label style="font-size:12px;">类型编码（英文，唯一）</label><input type="text" id="tmCode" class="form-input" value="' + this._escape(type.code || '') + '"' + locked + '></div>'
            + '</div>'
            + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">'
            + '<div><label style="font-size:12px;">图标</label>'
            + '<div style="display:flex;gap:6px;align-items:center;">'
            + '<span id="tmIconPreview" style="width:34px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#f0f2f5;border-radius:8px;color:#409EFF;font-size:15px;"><i class="fas ' + this._escape(type.icon || 'fa-file-lines') + '"></i></span>'
            + '<input type="text" id="tmIcon" class="form-input" value="' + this._escape(type.icon || 'fa-file-lines') + '"' + locked + ' style="flex:1;min-width:0;">'
            + '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._openIconPicker()"' + locked + '><i class="fas fa-th-large"></i> 选择</button>'
            + '</div></div>'
            + '<div><label style="font-size:12px;">颜色</label><input type="color" id="tmColor" value="' + this._escape(type.color || '#409EFF') + '"' + locked + ' style="height:34px;width:100%;border:none;"></div>'
            + '<div style="display:flex;align-items:flex-end;padding-bottom:6px;gap:6px;">'
            + '<label style="font-size:12px;white-space:nowrap;">启用开关</label>'
            // 启用/禁用审批类型仅超级管理员可操作：其他用户此处只读展示状态
            + '<label class="oa-switch"' + (this._isSuperAdmin() ? '' : ' style="display:none;"') + ' title="打开后该类型在新建审批和顶部筛选中显示"><input type="checkbox" id="tmEnabled"' + (type.enabled !== false ? ' checked' : '') + ' onchange="approvalApp._updateTypeEnabledLabel()"><span class="oa-switch-slider"></span></label>'
            + '<span id="tmEnabledLabel" style="font-size:12px;white-space:nowrap;color:' + (type.enabled !== false ? '#67c23a' : '#909399') + ';">' + (type.enabled !== false ? '启用' : '禁用') + (this._isSuperAdmin() ? '' : '（仅超管可改）') + '</span>'
            + '</div>'
            + '</div>'
            + '<div class="form-group" style="margin-bottom:10px;"><label style="font-size:12px;">说明</label><input type="text" id="tmDesc" class="form-input" value="' + this._escape(type.description || '') + '"' + locked + '></div>'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 6px;">'
            + '<label style="font-size:13px;font-weight:600;"><i class="fas fa-clipboard-list"></i> 表单字段</label>'
            + '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._addSchemaField()"' + locked + '><i class="fas fa-plus"></i> 添加字段</button></div>'
            + '<div id="tmSchemaFields">' + fieldRows + '</div>'
            + '<div style="display:flex;justify-content:space-between;margin-top:12px;">'
            + ((type.is_builtin || !this._isSuperAdmin()) ? '' : '<button type="button" class="btn btn-danger" onclick="approvalApp._deleteType()"><i class="fas fa-trash"></i> 删除类型</button>')
            + '<div style="display:flex;gap:8px;' + (type.is_builtin ? 'margin-left:auto;' : '') + '">'
            + '<button type="button" class="btn btn-secondary" onclick="approvalApp._renderTypeManageForm(null)">取消</button>'
            + '<button type="button" class="btn btn-primary" onclick="approvalApp._saveType()"><i class="fas fa-save"></i> 保存类型</button>'
            + '</div></div>';
    },

    _addSchemaField() {
        const container = document.getElementById('tmSchemaFields');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'tm-field-row';
        row.style.cssText = 'border:1px solid #dcdfe6;border-radius:8px;padding:8px;margin-bottom:8px;background:#fafbfc;';
        row.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
            + '<input type="text" class="form-input" data-f="label" placeholder="字段名称" style="flex:1;min-width:70px;">'
            + '<input type="text" class="form-input" data-f="key" placeholder="字段key" style="width:90px;">'
            + '<select class="form-select" data-f="type" style="width:128px;" onchange="approvalApp._onSchemaFieldTypeChange(this)">' + this._fieldTypeOptions('text') + '</select>'
            + '<label style="font-size:12px;"><input type="checkbox" data-f="required"> 必填</label>'
            + '<button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removeSchemaField(this)"><i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'
            + '<input type="text" class="form-input" data-f="placeholder" placeholder="占位提示" style="flex:1;min-width:70px;">'
            + '<input type="text" class="form-input" data-f="options" placeholder="' + this._escape(this._schemaOptionsPlaceholder('text')) + '" style="flex:2;min-width:80px;">'
            + '<select class="form-select" data-f="unit" style="width:110px;" title="金额/数字字段可设置单位">' + this._schemaUnitOptions('text', '') + '</select>'
            + '</div>';
        container.appendChild(row);
    },

    _removeSchemaField(el) {
        const row = el.closest ? el.closest('.tm-field-row') : null;
        if (row) row.remove();
    },

    _collectTypeSchema() {
        const rows = document.querySelectorAll('#tmSchemaFields .tm-field-row');
        const schema = [];
        rows.forEach(function (row, i) {
            const label = row.querySelector('[data-f="label"]').value.trim();
            const key = row.querySelector('[data-f="key"]').value.trim();
            const type = row.querySelector('[data-f="type"]').value;
            const required = row.querySelector('[data-f="required"]').checked;
            const placeholder = row.querySelector('[data-f="placeholder"]').value.trim();
            const optsRaw = row.querySelector('[data-f="options"]').value;
            const unit = row.querySelector('[data-f="unit"]').value;
            if (!label && !key) return;
            const field = {label: label || key, key: key || ('field_' + (i + 1)), type: type, required: !!required};
            if (placeholder) field.placeholder = placeholder;
            if (unit && (type === 'amount' || type === 'number')) field.unit = unit;
            else if (type === 'amount') field.unit = 'cny'; // 金额未选时默认人民币元
            if (type === 'struct_table' && optsRaw.trim()) {
                // 列定义：key:名称:类型|key2:名称2（类型 text/number/amount/item，缺省 text）
                field.columns = optsRaw.split('|').map(function (s) {
                    const parts = s.split(':');
                    const ck = (parts[0] || '').trim();
                    const cl = (parts[1] || ck || '').trim();
                    const ct = (parts[2] || '').trim();
                    return {
                        key: ck,
                        label: cl,
                        type: (ct === 'number' || ct === 'amount' || ct === 'item') ? ct : 'text'
                    };
                }).filter(function (c) { return c.key; });
            } else if (type === 'link_requisition' && optsRaw.trim()) {
                field.target = optsRaw.trim();
            } else if (['select', 'radio', 'checkbox'].indexOf(type) !== -1 && optsRaw.trim()) {
                field.options = optsRaw.split(/[,，]/).map(function (s) {
                    return s.trim();
                }).filter(Boolean);
            }
            schema.push(field);
        });
        return schema;
    },

    async _saveType() {
        const t = this._typeManageEditingType;
        if (!t) return;
        // 内置类型：仅可切换启用/禁用，其它字段锁定
        if (t.is_builtin) {
            // 内置类型只能改启用/禁用，而该权限仅超级管理员有
            if (!this._isSuperAdmin()) {
                this.showAlert('提示', '仅超级管理员可启用/禁用审批类型');
                return;
            }
            try {
                const r = await fetch(OA_API_URL + '/approval/types/' + t.id + '/', {
                    method: 'PATCH',
                    headers: TokenManager.getHeaders(),
                    body: JSON.stringify({enabled: document.getElementById('tmEnabled').checked})
                });
                const rd = await r.json().catch(function () { return {}; });
                if (!r.ok) throw new Error(rd.error || '保存失败');
                this.showToast('内置类型启用状态已更新', false);
                await this._loadTypeManageList();
                await this._loadApprovalTypes();
            } catch (e) {
                this.showAlert('保存失败', e.message || '请重试');
            }
            return;
        }
        const schema = this._collectTypeSchema();
        // 校验字段 key 不重复（避免保存后提交/回显错乱）
        const keyMap = {};
        for (let i = 0; i < schema.length; i++) {
            const k = schema[i].key;
            if (keyMap[k]) {
                this.showAlert('提示', '字段编码(key)「' + k + '」存在重复，请修改后再保存');
                return;
            }
            keyMap[k] = true;
        }
        // 校验下拉/单选/多选必须配置选项（避免后端 400）
        const typeNameMap = {select: '下拉', radio: '单选', checkbox: '多选'};
        for (let i = 0; i < schema.length; i++) {
            const f = schema[i];
            if (typeNameMap[f.type] && (!f.options || !f.options.length)) {
                this.showAlert('提示', '字段「' + f.label + '」为' + typeNameMap[f.type] + '类型，必须填写选项');
                return;
            }
        }
        const data = {
            name: document.getElementById('tmName').value.trim(),
            icon: document.getElementById('tmIcon').value.trim() || 'fa-file-lines',
            color: document.getElementById('tmColor').value || '#409EFF',
            description: document.getElementById('tmDesc').value.trim(),
            enabled: document.getElementById('tmEnabled').checked,
            form_schema: schema
        };
        if (!t.is_builtin) data.code = document.getElementById('tmCode').value.trim();
        if (!data.name) {
            this.showAlert('提示', '请输入类型名称');
            return;
        }
        if (!t.is_builtin && !data.code) {
            this.showAlert('提示', '请输入类型编码');
            return;
        }
        try {
            const url = t.id ? (OA_API_URL + '/approval/types/' + t.id + '/') : (OA_API_URL + '/approval/types/');
            const method = t.id ? 'PUT' : 'POST';
            const r = await fetch(url, {
                method: method,
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(data)
            });
            const rd = await r.json().catch(function () {
                return {};
            });
            if (!r.ok) throw new Error(rd.error || '保存失败');
            this.showToast('类型保存成功', false);
            // this._typeManageEditingType = null;
            await this._loadTypeManageList();
            await this._loadApprovalTypes();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    },

    // 是否超级管理员（启用/禁用审批类型、删除类型、删除配置等仅超管可操作）
    _isSuperAdmin() {
        try { return localStorage.getItem('user_type') === 'super_admin'; } catch (e) { return false; }
    },

    // 类型列表快捷启用/禁用开关：保存 enabled 并同步刷新新建审批与顶部筛选
    async _toggleTypeEnabled(id, checked) {
        try {
            const r = await fetch(OA_API_URL + '/approval/types/' + id + '/', {
                method: 'PATCH',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({enabled: !!checked})
            });
            const rd = await r.json().catch(function () { return {}; });
            if (!r.ok) throw new Error(rd.error || '操作失败');
            this.showToast(checked ? '该审批类型已启用' : '该审批类型已禁用', false);
            await this._loadTypeManageList();
            await this._loadApprovalTypes();
        } catch (e) {
            this.showToast('切换失败：' + (e.message || '请重试'), true);
            await this._loadTypeManageList();
        }
    },

    // 类型表单启用开关标签实时联动
    _updateTypeEnabledLabel() {
        const cb = document.getElementById('tmEnabled');
        const lb = document.getElementById('tmEnabledLabel');
        if (cb && lb) {
            lb.textContent = cb.checked ? '启用' : '禁用';
            lb.style.color = cb.checked ? '#67c23a' : '#909399';
        }
    },

    async _deleteType() {
        const t = this._typeManageEditingType;
        if (!t || !t.id || t.is_builtin) return;
        if (!window.confirm('确定删除该审批类型？删除后历史数据仍保留，但不可再发起该类型审批')) return;
        try {
            const r = await fetch(OA_API_URL + '/approval/types/' + t.id + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!r.ok) {
                const rd = await r.json().catch(function () {
                    return {};
                });
                throw new Error(rd.error || '删除失败');
            }
            this.showToast('类型已删除', false);
            this._typeManageEditingType = null;
            await this._loadTypeManageList();
            await this._loadApprovalTypes();
        } catch (e) {
            this.showAlert('删除失败', e.message);
        }
    },

    // 全屏/退出全屏
    _toggleMaximize(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        const content = modal.querySelector('.modal-content');
        if (content) {
            const max = content.classList.toggle('maximized');
            const icon = modal.querySelector('#tmMaximizeBtn i');
            if (icon) icon.className = max ? 'fas fa-compress' : 'fas fa-expand';
        }
    },

    // 图标选择弹窗
    _openIconPicker() {
        const grid = document.getElementById('tmIconGrid');
        const modal = document.getElementById('tmIconPickerModal');
        if (!grid || !modal) return;
        const current = document.getElementById('tmIcon') ? document.getElementById('tmIcon').value : '';
        const self = this;
        grid.innerHTML = (this._ICON_LIST || []).map(function (c) {
            const active = c === current ? ' background:#ecf5ff;border-color:#409eff;color:#409eff;' : '';
            return '<div class="tm-icon-opt" data-icon="' + c + '" onclick="approvalApp._pickIcon(\'' + c + '\')" style="height:48px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #eee;border-radius:6px;cursor:pointer;font-size:18px;color:#409EFF;' + active + '" title="' + c + '"><i class="fas ' + c + '"></i></div>';
        }).join('');
        modal.style.display = 'flex';
        setTimeout(function () {
            modal.classList.add('show');
        }, 10);
    },

    _closeIconPicker() {
        const modal = document.getElementById('tmIconPickerModal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.style.display = 'none';
    },

    _pickIcon(cls) {
        const input = document.getElementById('tmIcon');
        const preview = document.getElementById('tmIconPreview');
        if (input) input.value = cls;
        if (preview) preview.innerHTML = '<i class="fas ' + cls + '"></i>';
        this._closeIconPicker();
    },

    // ==================== 审批生命周期配置（仅超管） ====================

    async openLifecycleConfigModal() {
        try {
            const d = await this.apiGet(OA_API_URL + '/approval/lifecycle-config/');
            if (!d) return;
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            const chk = document.getElementById('alcEnabled');
            if (chk) chk.checked = d.enabled !== false;
            set('alcArchiveDays', d.archive_days);
            set('alcWithdrawnDays', d.withdrawn_delete_days);
            set('alcDraftDays', d.draft_delete_days);
            ['alcArchiveDays', 'alcWithdrawnDays', 'alcDraftDays'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.min = d.min_days || 1; el.max = d.max_days || 365; }
            });
            const hint = document.getElementById('alcHint');
            if (hint) {
                hint.innerHTML = '允许范围 ' + (d.min_days || 1) + '~' + (d.max_days || 365) + ' 天。'
                    + '定时任务每天 03:17 执行一次；修改后立即生效。';
            }
            const modal = document.getElementById('approvalLifecycleModal');
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        } catch (e) {
            this.showToast((e && e.message) || '加载生命周期配置失败', true);
        }
    },

    async saveLifecycleConfig() {
        const val = id => {
            const el = document.getElementById(id);
            const n = parseInt(el ? el.value : '', 10);
            return isNaN(n) ? null : n;
        };
        const payload = {
            enabled: !!(document.getElementById('alcEnabled') || {}).checked,
            archive_days: val('alcArchiveDays'),
            withdrawn_delete_days: val('alcWithdrawnDays'),
            draft_delete_days: val('alcDraftDays'),
        };
        try {
            const resp = await fetch(OA_API_URL + '/approval/lifecycle-config/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify(payload),
            });
            const raw = await resp.json().catch(() => ({}));
            const d = raw && raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            if (!resp.ok) throw new Error((d && (d.error || d.detail)) || '保存失败');
            this.closeModal('approvalLifecycleModal');
            this.showToast('生命周期配置已保存，即时生效', false);
        } catch (e) {
            this.showToast((e && e.message) || '保存失败', true);
        }
    },

    // ==================== 审批配置（企业管理员） ====================

    async openConfigModal() {
        this._configEditType = null;
        this._configEditSubTenant = '';
        this._configApprovers = [];
        this._configFinalApprover = null;
        this._configCcDepts = [];
        this._configCcUsers = [];
        this._configDeleteId = null;
        this._loadByType = false;
        document.getElementById('configApprovalType').value = '';
        document.querySelectorAll('.config-type-card').forEach(function (c) {
            c.classList.remove('active');
        });
        document.getElementById('configForm').style.display = 'none';
        document.getElementById('configDeleteBtn').style.display = 'none';
        this._renderConfigMeta(null);
        // 配置模态框左右拖动分隔条
        this._initSplitter('configSplitter', 'configManageLayout', 'configSidebar');
        // Load sub-tenant selector for group enterprises
        await this._loadSubTenants();
        // Load config list
        await this._renderConfigList();
        // 默认选中第一个审批类型并自动加载其配置（含适用范围切换）
        var firstCard = document.querySelector('.config-type-card');
        if (firstCard && firstCard.getAttribute('data-type')) {
            await this._selectConfigType(firstCard.getAttribute('data-type'));
        }
        // Init search fields
        var self = this;
        setTimeout(function () {
            self._initConfigSearch('configApproverSearch', 'configApproverDropdown', self._searchConfigApprovers, self._addConfigApprover);
            self._initConfigSearch('configFinalApproverSearch', 'configFinalApproverDropdown', self._searchConfigFinalApprover, self._selectConfigFinalApprover);
            self._initConfigSearch('configCcDeptSearch', 'configCcDeptDropdown', self._searchConfigCcDepts, self._addConfigCcDept);
            self._initConfigSearch('configCcUserSearch', 'configCcUserDropdown', self._searchConfigCcUsers, self._addConfigCcUser);
        }, 100);
        document.getElementById('approvalConfigModal').style.display = 'flex';
        setTimeout(function () {
            document.getElementById('approvalConfigModal').classList.add('show');
        }, 10);
    },

    async _loadSubTenants() {
        var group = document.getElementById('configSubTenantGroup');
        var scopeSel = document.getElementById('configScopeSelect');
        if (!group) return;
        group.style.display = 'block';
        if (scopeSel) scopeSel.innerHTML = '<option value="">集团默认</option>';
        try {
            var resp = await fetch(OA_API_URL + '/approval/dept-configs/', {
                headers: TokenManager.getHeaders()
            });
            if (resp.ok) {
                var json = await resp.json();
                var companyDepts = json.company_departments || [];
                companyDepts.forEach(function (d) {
                    var opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = (d.full_path || d.name) + '（' + (d.department_type === 'company' ? '公司' : '虚拟组织') + '）';
                    if (scopeSel) scopeSel.appendChild(opt);
                });
            }
        } catch (e) {
            console.warn('加载公司级部门列表失败', e);
        }
    },


    async _renderConfigList() {
        var container = document.getElementById('configList');
        if (!container) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var self = this;
            if (!configs.length) {
                container.innerHTML = '<div style="color:#909399;font-size:13px;padding:8px 0;">暂无配置</div>';
                return;
            }
            var scopeVal = document.getElementById('configScopeSelect') ? document.getElementById('configScopeSelect').value : '';
            container.innerHTML = configs.map(function (c) {
                if (c.sub_tenant) return ''; // 旧子公司专属配置不再展示（适用范围仅集团默认/公司级部门）
                // 按配置适用范围过滤：集团默认（空）/ 指定公司级部门
                var cDept = c.scope_department ? String(c.scope_department) : '';
                if (scopeVal) {
                    if (cDept !== scopeVal) return '';
                } else {
                    if (cDept) return '';
                }
                var sel = self._configEditType === c.approval_type ? ' style="background:#e8f4fd;font-weight:600;display:flex;align-items:center;justify-content:space-between;"' : '';
                // 适用范围标签：公司级部门显示[部门名]，集团默认显示[集团默认]
                var scopeTag = c.scope_department
                    ? ' <span style="font-size:10px;color:#16a085;">[' + self._escape(c.scope_department_name || '公司级部门') + ']</span>'
                    : ' <span style="font-size:10px;color:#909399;">[集团默认]</span>';
                return '<div class="config-list-item"' + sel + ' data-type="' + c.approval_type + '" onclick="approvalApp._editConfig(\'' + c.approval_type + '\')" style="padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;font-size:13px;display:flex;align-items:center;justify-content:space-between;">'
                    + '<span><i class="fas fa-tag" style="color:var(--primary-color,#409eff);margin-right:4px;font-size:11px;"></i>' + self._escape(self._getTypeName(c.approval_type)) + scopeTag + '</span>'
                    + '<span style="font-size:11px;color:#909399;">' + (c.department_name || '未设置') + '</span>'
                    + '</div>';
            }).join('');
        } catch (e) {
            console.error('Load config list failed:', e);
            container.innerHTML = '<div style="color:#f56c6c;font-size:13px;">加载失败</div>';
        }
    },

    async _selectConfigType(type) {
        this._configEditType = type;
        this._loadByType = true; // 点选审批类型：允许自动匹配该类型任意配置并切换适用范围
        document.getElementById('configApprovalType').value = type;
        // 同步右侧顶部类型卡片的选中态（按 data-type 匹配，避免类型码含特殊字符时 CSS 选择器报错、或类型不在网格中抛空异常）
        document.querySelectorAll('.config-type-card').forEach(function (c) {
            if (c.getAttribute('data-type') === type) c.classList.add('active');
            else c.classList.remove('active');
        });
        this._updateThresholdFieldOptions();
        await this._loadConfig();
        this._renderConfigList();
    },

    _onConfigSubTenantChange() {
        this._loadByType = false; // 切换适用范围：仅加载该范围下所选类型的配置，不再自动切回集团默认
        this._renderConfigList();
        this._loadConfig();
    },

    async _editConfig(type) {
        this._configEditType = type;
        await this._selectConfigType(type);
        this._renderConfigList();
    },

    // 配置模态框底部：展示该配置的最后更新时间和操作人（新建/未保存时隐藏）
    _renderConfigMeta(cfg) {
        var el = document.getElementById('configMeta');
        if (!el) return;
        if (!cfg) { el.style.display = 'none'; el.innerHTML = ''; return; }
        var time = (typeof Utils !== 'undefined' && Utils.formatDateTime)
            ? Utils.formatDateTime(cfg.updated_at) : (cfg.updated_at || '-');
        var who = cfg.updated_by_name || '—';
        el.innerHTML = '<i class="fas fa-history"></i>最后更新：' + this._escape(time)
            + '<span class="config-meta-sep">|</span>操作人：' + this._escape(who);
        el.style.display = 'block';
    },

    async _loadConfig() {
        var type = document.getElementById('configApprovalType').value;
        var form = document.getElementById('configForm');
        var delBtn = document.getElementById('configDeleteBtn');
        if (!type) {
            form.style.display = 'none';
            if (delBtn) delBtn.style.display = 'none';
            this._renderConfigMeta(null);
            return;
        }
        form.style.display = 'block';
        await this._loadConfigDepts();
        // 获取当前选中的适用范围（空=集团默认 / 公司级部门ID）
        var scopeVal = document.getElementById('configScopeSelect') ? document.getElementById('configScopeSelect').value : '';
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var cfg = null;
            configs.forEach(function (c) {
                if (c.approval_type !== type) return;
                if (c.sub_tenant) return; // 跳过旧子公司专属配置，仅按当前企业适用范围匹配
                var cDept = c.scope_department ? String(c.scope_department) : '';
                if (scopeVal) { if (cDept === scopeVal) cfg = c; }
                else { if (!cDept) cfg = c; }
            });
            // 点选审批类型时：当前适用范围没有该类型配置，则自动匹配该类型已配置的任意配置（公司级部门优先，其次集团默认），并回填适用范围
            if (!cfg && this._loadByType) {
                configs.forEach(function (c) {
                    if (c.approval_type !== type || cfg) return;
                    if (c.sub_tenant) return;
                    if (c.scope_department) cfg = c; // 优先公司级部门专属配置
                });
                if (!cfg) {
                    configs.forEach(function (c) {
                        if (c.approval_type !== type || cfg) return;
                        if (c.sub_tenant) return;
                        cfg = c; // 其次集团默认
                    });
                }
            }
            this._configDeleteId = cfg ? cfg.id : null;
            this._renderConfigMeta(cfg);
            // 点选审批类型时按配置实际适用范围回填范围下拉（空=集团默认 / 公司级部门ID）；切换适用范围时不覆盖用户选择
            if (cfg && this._loadByType) {
                var scopeSel2 = document.getElementById('configScopeSelect');
                if (scopeSel2) scopeSel2.value = cfg.scope_department ? String(cfg.scope_department) : '';
            }
            // 删除配置仅超级管理员可操作：其他用户不显示该按钮（后端同样会拦截）
            if (delBtn) delBtn.style.display = (cfg && this._isSuperAdmin()) ? 'inline-flex' : 'none';
            var deptSel = document.getElementById('configFinalDept');
            if (deptSel && cfg && cfg.department) deptSel.value = cfg.department;
            else if (deptSel) deptSel.value = '';
            // 第一审批人（财务专员）自定义下拉（头像 + 姓名 + 最右侧职位）
            var firstSel = document.getElementById('configFirstApprover');
            if (firstSel) {
                var specs = data.finance_specialists || [];
                var curFirst = (cfg && cfg.first_approver) ? String(cfg.first_approver) : '';
                firstSel.value = curFirst;
                this._buildFirstApproverDropdown(specs, curFirst);
            }
            this._configApprovers = [];
            if (cfg && cfg.approver_user_details) {
                this._configApprovers = cfg.approver_user_details.map(function (u) {
                    return {id: u.id, name: u.name, position: u.position || ''};
                });
            }
            this._renderConfigApproverTags();
            this._configFinalApprover = null;
            if (cfg && cfg.final_approver_details) {
                this._configFinalApprover = {
                    id: cfg.final_approver_details.id,
                    name: cfg.final_approver_details.name,
                    position: cfg.final_approver_details.position || ''
                };
            }
            this._renderConfigFinalApproverTag();
            this._configCcDepts = [];
            if (cfg && cfg.cc_department_details) {
                this._configCcDepts = cfg.cc_department_details.map(function (d) {
                    return {id: d.id, name: d.name};
                });
            }
            this._renderConfigCcDeptTags();
            this._configCcUsers = [];
            if (cfg && cfg.cc_user_details) {
                this._configCcUsers = cfg.cc_user_details.map(function (u) {
                    return {id: u.id, name: u.name, avatar: u.avatar || ''};
                });
            }
            this._renderConfigCcUserTags();
            // Restore sign_type and approval_mode（序列化器字段名为 default_sign_type / default_approval_mode）
            var signTypeSel = document.getElementById('configSignType');
            if (signTypeSel && cfg && cfg.default_sign_type) signTypeSel.value = cfg.default_sign_type;
            else if (signTypeSel) signTypeSel.value = 'countersign';
            var apprModeSel = document.getElementById('configApprovalMode');
            if (apprModeSel && cfg && cfg.default_approval_mode) apprModeSel.value = cfg.default_approval_mode;
            else if (apprModeSel) apprModeSel.value = 'sequential';
            // Restore threshold config
            var thEnable = document.getElementById('configThresholdEnable');
            if (thEnable) {
                thEnable.checked = cfg && cfg.threshold_enabled ? true : false;
                this._toggleThresholdConfig();
            }
            var thField = document.getElementById('configThresholdField');
            if (thField && cfg && cfg.threshold_field) thField.value = cfg.threshold_field;
            else if (thField) thField.value = 'duration';
            var thVal = document.getElementById('configThresholdValue');
            if (thVal && cfg && cfg.threshold_value != null) thVal.value = cfg.threshold_value;
            else if (thVal) thVal.value = '';
            var thDept = document.getElementById('configThresholdDept');
            if (thDept && cfg && cfg.threshold_department) thDept.value = cfg.threshold_department;
            else if (thDept) thDept.value = '';
            var sigEl = document.getElementById('configRequireSignature');
            if (sigEl) sigEl.checked = cfg && cfg.require_signature ? true : false;
            var rhEl = document.getElementById('configReceiptReturnHours');
            if (rhEl) rhEl.value = (cfg && cfg.receipt_return_hours !== null && cfg.receipt_return_hours !== undefined) ? cfg.receipt_return_hours : 24;
            var erEl = document.getElementById('configEnableReceiptReturn');
            if (erEl) erEl.checked = !!(cfg && cfg.enable_receipt_return);
            var rmcEl = document.getElementById('configReceiptMaxCount');
            if (rmcEl) rmcEl.value = (cfg && cfg.receipt_max_count) ? cfg.receipt_max_count : 10;
            var imcEl = document.getElementById('configInvoiceMaxCount');
            if (imcEl) imcEl.value = (cfg && cfg.invoice_max_count != null) ? cfg.invoice_max_count : 0;
            this._onReceiptConfigChange();
        } catch (e) {
            console.error('Load config failed:', e);
        }
    },

    _onReceiptConfigChange() {
        var erEl = document.getElementById('configEnableReceiptReturn');
        var show = erEl && erEl.checked ? 'block' : 'none';
        var grp = document.getElementById('configReceiptReturnHoursGroup');
        if (grp) grp.style.display = show;
        // 回传数量上限与回传时限一起，只在开启票据回传时才需要配置
        var grpMax = document.getElementById('configReceiptMaxCountGroup');
        if (grpMax) grpMax.style.display = show;
        var grpInv = document.getElementById('configInvoiceMaxCountGroup');
        if (grpInv) grpInv.style.display = show;
    },

    // 第一审批人（财务专员）自定义下拉：每项姓名前头像 + 最右侧职位（原生 option 不渲染 img/样式，改用 div 下拉）
    _buildFirstApproverDropdown(specs, curFirst) {
        var trigger = document.getElementById('configFirstApproverTrigger');
        var valueEl = document.getElementById('configFirstApproverValue');
        var drop = document.getElementById('configFirstApproverDrop');
        var hidden = document.getElementById('configFirstApprover');
        if (!trigger || !valueEl || !drop || !hidden) return;
        var self = this;
        var defAv = '/static/images/default-avatar.png';

        // 渲染下拉项
        var optHtml = '<div class="fs-select-option" data-val="">'
            + '<img class="fs-opt-avatar" src="' + defAv + '" onerror="this.style.display=\'none\';"><span class="fs-opt-name">无（不使用财务专员作为第一审批人）</span></div>';
        (specs || []).forEach(function (s) {
            var scope = [];
            (s.sub_tenant_list || []).forEach(function (t) { scope.push(t.name); });
            (s.department_list || []).forEach(function (d) { scope.push(d.name); });
            var scopeText = scope.length ? '（' + scope.slice(0, 3).join('、') + (scope.length > 3 ? '…' : '') + '）' : '';
            var av = s.avatar || defAv;
            var pos = s.position ? self._escape(s.position) : '';
            optHtml += '<div class="fs-select-option" data-val="' + s.id + '">'
                + '<img class="fs-opt-avatar" src="' + self._escape(av) + '" onerror="this.style.display=\'none\';">'
                + '<span class="fs-opt-name">' + self._escape(s.user_name) + '<span class="fs-opt-scope">' + scopeText + '</span></span>'
                + (pos ? '<span class="fs-opt-pos">' + pos + '</span>' : '')
                + '</div>';
        });
        drop.innerHTML = optHtml;

        // 同步选中态与触发器显示
        var sync = function () {
            var val = hidden.value || '';
            var selSpec = null;
            (specs || []).forEach(function (s) { if (String(s.id) === val) selSpec = s; });
            var av = selSpec ? (selSpec.avatar || defAv) : defAv;
            var name = selSpec ? selSpec.user_name : '无（不使用财务专员作为第一审批人）';
            var pos = selSpec && selSpec.position ? ' · ' + selSpec.position : '';
            valueEl.innerHTML = '<img class="fs-trigger-avatar" src="' + self._escape(av) + '" onerror="this.style.display=\'none\';">'
                + '<span class="fs-trigger-name">' + self._escape(name) + pos + '</span>';
            drop.querySelectorAll('.fs-select-option').forEach(function (opt) {
                opt.classList.toggle('active', opt.getAttribute('data-val') === val);
            });
        };
        drop._fsSync = sync;
        if (!this._fsSelectDocBound) {
            this._fsSelectDocBound = true;
            document.addEventListener('click', function () {
                document.querySelectorAll('.fs-select-drop').forEach(function (d) { d.style.display = 'none'; });
            });
        }
        trigger.onclick = function (e) {
            e.stopPropagation();
            var isOpen = drop.style.display === 'block';
            document.querySelectorAll('.fs-select-drop').forEach(function (d) { d.style.display = 'none'; });
            if (!isOpen) { sync(); drop.style.display = 'block'; }
        };
        drop.querySelectorAll('.fs-select-option').forEach(function (opt) {
            opt.onclick = function (e) {
                e.stopPropagation();
                hidden.value = opt.getAttribute('data-val');
                sync();
                drop.style.display = 'none';
            };
        });
        sync();
    },

    _buildDepartmentTreeHtml(depts, selectedId) {
        var tree = {};
        depts.forEach(function (d) {
            var pid = d.parent_id != null ? d.parent_id : 0;
            if (!tree[pid]) tree[pid] = [];
            tree[pid].push(d);
        });
        var html = '<option value="">请选择</option>';
        var walk = function (pid, depth) {
            var children = tree[pid] || [];
            children.forEach(function (d) {
                var prefix = '';
                for (var i = 0; i < depth; i++) prefix += '—— ';
                var sel = selectedId && parseInt(d.id) === parseInt(selectedId) ? ' selected' : '';
                html += '<option value="' + d.id + '"' + sel + '>' + prefix + d.name + '</option>';
                walk(d.id, depth + 1);
            });
        };
        walk(0, 0);
        // Fallback for non-zero root parent_ids
        if (!tree[0] || !tree[0].length) {
            var allIds = {};
            depts.forEach(function (d) {
                allIds[d.id] = true;
            });
            var actualRoots = [];
            depts.forEach(function (d) {
                if (!allIds[d.parent_id]) actualRoots.push(d);
            });
            if (actualRoots.length) {
                html = '<option value="">请选择</option>';
                var renderFlat = function (items, depth) {
                    items.forEach(function (d) {
                        var prefix = '';
                        for (var i = 0; i < depth; i++) prefix += '—— ';
                        var sel = selectedId && parseInt(d.id) === parseInt(selectedId) ? ' selected' : '';
                        html += '<option value="' + d.id + '"' + sel + '>' + prefix + d.name + '</option>';
                        var kids = tree[d.id] || [];
                        renderFlat(kids, depth + 1);
                    });
                };
                renderFlat(actualRoots, 0);
            }
        }
        return html;
    },

    async _loadConfigDepts() {
        var sel = document.getElementById('configFinalDept');
        var thSel = document.getElementById('configThresholdDept');
        if (!sel) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/org_departments/');
            var depts = data.results || [];
            var treeHtml = this._buildDepartmentTreeHtml(depts);
            sel.innerHTML = treeHtml;
            if (thSel) thSel.innerHTML = treeHtml;
        } catch (e) {
            console.error('Load config depts failed:', e);
        }
    },

    _initConfigSearch(inputId, dropdownId, searchFn, addFn) {
        var self = this;
        var input = document.getElementById(inputId);
        var dd = document.getElementById(dropdownId);
        if (!input || !dd) return;
        var timer = null;
        input.oninput = function () {
            clearTimeout(timer);
            var val = input.value.trim();
            if (!val) {
                dd.style.display = 'none';
                return;
            }
            timer = setTimeout(function () {
                searchFn.call(self, val, dd);
            }, 300);
        };
        input.onfocus = function () {
            if (input.value.trim()) searchFn.call(self, input.value.trim(), dd);
        };
    },

    async _searchConfigApprovers(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var selectedIds = {};
            (this._configApprovers || []).forEach(function (u) {
                selectedIds[u.id] = true;
            });
            dd.innerHTML = users.length ? users.map(function (u) {
                var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="if(!this.classList.contains(\'disabled\'))approvalApp._addConfigApprover(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + self._escape(u.position || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    },

    _addConfigApprover(id, name, position) {
        if (this._configApprovers.some(function (u) {
            return u.id === id;
        })) return;
        this._configApprovers.push({id: id, name: name, position: position});
        this._renderConfigApproverTags();
        document.getElementById('configApproverDropdown').style.display = 'none';
        document.getElementById('configApproverSearch').value = '';
    },

    _removeConfigApprover(id) {
        this._configApprovers = this._configApprovers.filter(function (u) {
            return u.id !== id;
        });
        this._renderConfigApproverTags();
    },

    _renderConfigApproverTags() {
        var container = document.getElementById('configApproverTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configApprovers || []).map(function (u) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f0f9eb;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user-check" style="font-size:10px;color:#67c23a;"></i>'
                + '<span>' + self._escape(u.name) + '</span>'
                + (u.position ? '<span style="font-size:10px;color:#909399;">(' + self._escape(u.position) + ')</span>' : '')
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigApprover(' + u.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    },

    // ===== 最终审批人（单个，可选） =====
    async _searchConfigFinalApprover(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var currentId = this._configFinalApprover ? this._configFinalApprover.id : null;
            dd.innerHTML = users.length ? users.map(function (u) {
                var cls = (currentId && u.id === currentId) ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._selectConfigFinalApprover(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + self._escape(u.position || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    },

    _selectConfigFinalApprover(id, name, position) {
        this._configFinalApprover = {id: id, name: name, position: position || ''};
        this._renderConfigFinalApproverTag();
        document.getElementById('configFinalApproverDropdown').style.display = 'none';
        document.getElementById('configFinalApproverSearch').value = '';
    },

    _removeConfigFinalApprover() {
        this._configFinalApprover = null;
        this._renderConfigFinalApproverTag();
    },

    _renderConfigFinalApproverTag() {
        var container = document.getElementById('configFinalApproverTags');
        if (!container) return;
        var self = this;
        var fa = this._configFinalApprover;
        container.innerHTML = fa ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:14px;font-size:12px;margin:2px;">'
            + '<i class="fas fa-user-shield" style="font-size:10px;color:#409eff;"></i>'
            + '<span>' + self._escape(fa.name) + '</span>'
            + (fa.position ? '<span style="font-size:10px;color:#909399;">(' + self._escape(fa.position) + ')</span>' : '')
            + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigFinalApprover()"></i>'
            + '</span>' : '';
    },

    async _searchConfigCcDepts(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-departments/?search=' + encodeURIComponent(keyword));
            var depts = data.results || [];
            var selectedIds = {};
            (this._configCcDepts || []).forEach(function (d) {
                selectedIds[d.id] = true;
            });
            dd.innerHTML = depts.length ? depts.map(function (d) {
                var cls = selectedIds[d.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addConfigCcDept(' + d.id + ',\'' + self._escape(d.name) + '\')">'
                    + '<i class="fas fa-building" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#409eff;"></i>'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(d.name) + '</span>'
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到部门</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    },

    _addConfigCcDept(id, name) {
        if (this._configCcDepts.some(function (d) {
            return d.id === id;
        })) return;
        this._configCcDepts.push({id: id, name: name});
        this._renderConfigCcDeptTags();
        document.getElementById('configCcDeptDropdown').style.display = 'none';
        document.getElementById('configCcDeptSearch').value = '';
    },

    _removeConfigCcDept(id) {
        this._configCcDepts = this._configCcDepts.filter(function (d) {
            return d.id !== id;
        });
        this._renderConfigCcDeptTags();
    },

    _renderConfigCcDeptTags() {
        var container = document.getElementById('configCcDeptTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configCcDepts || []).map(function (d) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#e8f4fd;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-building" style="font-size:10px;color:#409eff;"></i>'
                + '<span>' + self._escape(d.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigCcDept(' + d.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    },

    async _searchConfigCcUsers(keyword, dd) {
        var self = this;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            var selectedIds = {};
            (this._configCcUsers || []).forEach(function (u) {
                selectedIds[u.id] = true;
            });
            dd.innerHTML = users.length ? users.map(function (u) {
                var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addConfigCcUser(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + (u.avatar || '') + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + '</div>';
            }) : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            dd.style.display = 'block';
        } catch (e) {
            console.error(e);
        }
    },

    _addConfigCcUser(id, name, avatar) {
        if (this._configCcUsers.some(function (u) {
            return u.id === id;
        })) return;
        this._configCcUsers.push({id: id, name: name, avatar: avatar || ''});
        this._renderConfigCcUserTags();
        document.getElementById('configCcUserDropdown').style.display = 'none';
        document.getElementById('configCcUserSearch').value = '';
    },

    _removeConfigCcUser(id) {
        this._configCcUsers = this._configCcUsers.filter(function (u) {
            return u.id !== id;
        });
        this._renderConfigCcUserTags();
    },

    _renderConfigCcUserTags() {
        var container = document.getElementById('configCcUserTags');
        if (!container) return;
        var self = this;
        container.innerHTML = (this._configCcUsers || []).map(function (u) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f3e8ff;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user" style="font-size:10px;color:#9b59b6;"></i>'
                + '<span>' + self._escape(u.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeConfigCcUser(' + u.id + ')"></i>'
                + '</span>';
        }).join('') || '';
    },

    async _deleteConfig() {
        var confirmed = await this.showConfirmDialog('删除配置', '确定要删除当前审批类型的配置吗？删除后不可恢复。', 'danger');
        if (!confirmed) return;
        if (!this._configDeleteId) {
            this.showAlert('提示', '未找到配置ID');
            return;
        }
        try {
            var resp = await fetch(OA_API_URL + '/approval/delete-dept-config/' + this._configDeleteId + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders(),
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.showToast('配置已删除', false);
            this._configDeleteId = null;
            this._configEditType = null;
            document.getElementById('configForm').style.display = 'none';
            document.getElementById('configDeleteBtn').style.display = 'none';
            document.getElementById('configApprovalType').value = '';
            this._renderConfigMeta(null);
            await this._renderConfigList();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    },

    _toggleThresholdConfig() {
        var enabled = document.getElementById('configThresholdEnable') ? document.getElementById('configThresholdEnable').checked : false;
        var fields = document.getElementById('configThresholdFields');
        if (fields) fields.style.display = enabled ? 'block' : 'none';
        // 根据审批类型动态更新阈值字段选项
        this._updateThresholdFieldOptions();
    },

    _updateThresholdFieldOptions() {
        var type = document.getElementById('configApprovalType') ? document.getElementById('configApprovalType').value : '';
        var fieldSel = document.getElementById('configThresholdField');
        if (!fieldSel) return;
        var fieldLabel = fieldSel.closest('div') ? fieldSel.closest('div').querySelector('label') : null;

        if (type === 'leave' || type === 'trip') {
            fieldSel.innerHTML = '<option value="duration">天数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（天）';
        } else if (type === 'overtime') {
            fieldSel.innerHTML = '<option value="duration">小时数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（小时）';
        } else if (type === 'expense' || type === 'purchase') {
            fieldSel.innerHTML = '<option value="amount">金额（¥）</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（元）';
        } else if (type === 'recruit') {
            fieldSel.innerHTML = '<option value="headcount">招聘人数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值（人）';
        } else if (!this._isBuiltinType(type) || this._isDynamicSchemaType(type)) {
            // 自定义类型 / 带表单内置类型：列出 schema 中的数字/金额字段
            const t = this._getType(type);
            const numericFields = ((t && t.form_schema) || []).filter(function (f) {
                return f.type === 'number' || f.type === 'amount';
            });
            if (numericFields.length) {
                fieldSel.innerHTML = numericFields.map(function (f) {
                    return '<option value="' + this._escape(f.key) + '">' + this._escape(f.label || f.key) + '</option>';
                }, this).join('');
            } else {
                fieldSel.innerHTML = '<option value="">该类型无数字字段</option>';
            }
            if (fieldLabel) fieldLabel.innerHTML = '阈值字段';
        } else {
            fieldSel.innerHTML = '<option value="duration">天数/时长</option><option value="amount">金额</option><option value="headcount">招聘人数</option>';
            if (fieldLabel) fieldLabel.innerHTML = '阈值字段';
        }
    },

    async _saveConfig() {
        var type = document.getElementById('configApprovalType').value;
        if (!type) {
            this.showAlert('提示', '请选择审批类型');
            return;
        }
        var departmentId = document.getElementById('configFinalDept').value;
        var thEnabled = document.getElementById('configThresholdEnable') ? document.getElementById('configThresholdEnable').checked : false;
        var thField = document.getElementById('configThresholdField') ? document.getElementById('configThresholdField').value : '';
        var thValue = document.getElementById('configThresholdValue') ? document.getElementById('configThresholdValue').value : '';
        var thDeptId = document.getElementById('configThresholdDept') ? document.getElementById('configThresholdDept').value : '';
        var deptScopeId = document.getElementById('configScopeSelect') ? document.getElementById('configScopeSelect').value : '';
        var signType = document.getElementById('configSignType') ? document.getElementById('configSignType').value : 'countersign';
        var apprMode = document.getElementById('configApprovalMode') ? document.getElementById('configApprovalMode').value : 'sequential';
        var data = {
            approval_type: type,
            department_id: departmentId ? parseInt(departmentId) : null,
            cc_departments: (this._configCcDepts || []).map(function (d) {
                return d.id;
            }),
            cc_users: (this._configCcUsers || []).map(function (u) {
                return u.id;
            }),
            approver_users: (this._configApprovers || []).map(function (u) {
                return u.id;
            }),
            final_approver: this._configFinalApprover ? this._configFinalApprover.id : null,
            first_approver: parseInt(document.getElementById('configFirstApprover') ? (document.getElementById('configFirstApprover').value || 0) : 0) || null,
            sign_type: signType,
            approval_mode: apprMode,
            threshold_enabled: thEnabled,
            threshold_field: thField,
            threshold_value: thValue ? parseFloat(thValue) : null,
            threshold_department_id: thDeptId ? parseInt(thDeptId) : null,
            require_signature: document.getElementById('configRequireSignature') ? document.getElementById('configRequireSignature').checked : false,
            receipt_return_hours: parseInt(document.getElementById('configReceiptReturnHours') ? (document.getElementById('configReceiptReturnHours').value || 0) : 24),
            enable_receipt_return: document.getElementById('configEnableReceiptReturn') ? document.getElementById('configEnableReceiptReturn').checked : false,
            receipt_max_count: parseInt(document.getElementById('configReceiptMaxCount') ? (document.getElementById('configReceiptMaxCount').value || 10) : 10),
            invoice_max_count: parseInt(document.getElementById('configInvoiceMaxCount') ? (document.getElementById('configInvoiceMaxCount').value || 0) : 0),
        };
        if (deptScopeId) data.scope_department_id = parseInt(deptScopeId);
        try {
            await this.apiPost(OA_API_URL + '/approval/save-dept-config/', data);
            this.showToast('配置保存成功', false);
            // 保存后即时刷新左侧已配置列表与当前配置内容，确保改动立即生效
            this._loadConfig();
            this._renderConfigList();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    },

    // ==================== 财务专员管理 ====================
    async openFinanceSpecialistModal() {
        var dd = document.getElementById('approvalSvcDropdown');
        if (dd) dd.classList.remove('show');
        var modal = document.getElementById('financeSpecialistModal');
        if (!modal) return;
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
        this._fsList = [];
        this._fsSubTenants = [];
        this._fsDepartments = [];
        await this._loadFinanceSpecialists();
        this._fsShowList();
    },
    closeFinanceSpecialistModal() {
        var modal = document.getElementById('financeSpecialistModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    },
    async _loadFinanceSpecialists() {
        try {
            var d = await this.apiGet(OA_API_URL + '/approval/finance-specialists/');
            this._fsList = d.results || [];
            this._fsSubTenants = d.sub_tenants || [];
            this._fsDepartments = d.departments || [];
            this._fsRender();
        } catch (e) {
            this.showAlert('加载失败', e.message || '请重试');
        }
    },
    _fsSearch() {
        var kw = (document.getElementById('fsSearch').value || '').trim().toLowerCase();
        var list = (this._fsList || []).filter(function (s) {
            return (s.user_name || '').toLowerCase().indexOf(kw) >= 0
                || (s.position || '').toLowerCase().indexOf(kw) >= 0;
        });
        this._fsRender(list);
    },
    _fsRender(list) {
        var tbody = document.getElementById('fsTbody');
        if (!tbody) return;
        var arr = list || this._fsList || [];
        var self = this;
        if (!arr.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#909399;padding:20px;">暂无财务专员</td></tr>';
            return;
        }
        tbody.innerHTML = arr.map(function (s) {
            var subs = (s.sub_tenant_list || []).map(function (t) { return self._escape(t.name); }).join('、') || '—';
            var depts = (s.department_list || []).map(function (d) { return self._escape(d.name); }).join('、') || '—';
            var status = s.is_active ? '<span style="color:#67c23a;">启用</span>' : '<span style="color:#f56c6c;">停用</span>';
            var time = s.updated_at ? String(s.updated_at).replace('T', ' ').slice(0, 16) : '';
            return '<tr>'
                + '<td><div style="display:flex;align-items:center;gap:6px;"><img src="' + self._escape(s.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;"> <div><div style="font-weight:600;">' + self._escape(s.user_name) + '</div><div style="font-size:11px;color:#909399;">' + self._escape(s.position || '') + '</div></div></div></td>'
                + '<td>' + subs + '</td>'
                + '<td>' + depts + '</td>'
                + '<td>' + status + '</td>'
                + '<td>' + self._escape(time) + '</td>'
                + '<td><button class="btn btn-sm btn-secondary" onclick="approvalApp._fsEdit(' + s.id + ')"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-danger" onclick="approvalApp._fsDel(' + s.id + ')"><i class="fas fa-trash"></i></button></td>'
                + '</tr>';
        }).join('');
    },
    _fsShowList() {
        document.getElementById('fsListView').style.display = 'block';
        document.getElementById('fsFormView').style.display = 'none';
    },
    async _fsShowForm() {
        this._fsEditId = null;
        document.getElementById('fsFormTitle').textContent = '添加财务专员';
        document.getElementById('fsUserSearch').value = '';
        document.getElementById('fsUserTag').innerHTML = '';
        document.getElementById('fsActive').checked = true;
        document.getElementById('fsRemark').value = '';
        this._fsSelectedUser = null;
        await this._fsRenderScopes();
        document.getElementById('fsListView').style.display = 'none';
        document.getElementById('fsFormView').style.display = 'block';
    },
    async _fsRenderScopes() {
        var subWrap = document.getElementById('fsSubTenants');
        var deptWrap = document.getElementById('fsDepartments');
        var self = this;
        if (subWrap) {
            subWrap.innerHTML = (this._fsSubTenants || []).map(function (t) {
                return '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;border:1px solid #dcdfe6;border-radius:6px;padding:4px 8px;"><input type="checkbox" value="' + t.id + '" class="fs-sub-cb"> ' + self._escape(t.short_name || t.name) + '</label>';
            }).join('') || '<span style="color:#909399;font-size:12px;">暂无子公司</span>';
        }
        if (deptWrap) {
            deptWrap.innerHTML = (this._fsDepartments || []).map(function (d) {
                return '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;border:1px solid #dcdfe6;border-radius:6px;padding:4px 8px;"><input type="checkbox" value="' + d.id + '" class="fs-dept-cb"> ' + self._escape(d.full_path || d.name) + '</label>';
            }).join('') || '<span style="color:#909399;font-size:12px;">暂无部门</span>';
        }
    },
    async _fsEdit(id) {
        var s = null;
        (this._fsList || []).forEach(function (x) { if (String(x.id) === String(id)) s = x; });
        if (!s) return;
        this._fsEditId = id;
        document.getElementById('fsFormTitle').textContent = '编辑财务专员';
        document.getElementById('fsUserSearch').value = s.user_name || '';
        document.getElementById('fsUserTag').innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:12px;font-size:12px;color:#409eff;"><img src="' + this._escape(s.avatar || '/static/images/default-avatar.png') + '" style="width:18px;height:18px;border-radius:50%;"> ' + this._escape(s.user_name) + '</span>';
        this._fsSelectedUser = { id: s.user, name: s.user_name, avatar: s.avatar };
        document.getElementById('fsActive').checked = !!s.is_active;
        document.getElementById('fsRemark').value = s.remark || '';
        await this._fsRenderScopes();
        var subIds = (s.sub_tenant_list || []).map(function (t) { return String(t.id); });
        document.querySelectorAll('#fsSubTenants .fs-sub-cb').forEach(function (cb) { cb.checked = subIds.indexOf(String(cb.value)) >= 0; });
        var deptIds = (s.department_list || []).map(function (d) { return String(d.id); });
        document.querySelectorAll('#fsDepartments .fs-dept-cb').forEach(function (cb) { cb.checked = deptIds.indexOf(String(cb.value)) >= 0; });
        document.getElementById('fsListView').style.display = 'none';
        document.getElementById('fsFormView').style.display = 'block';
    },
    async _fsSave() {
        if (!this._fsSelectedUser) {
            this.showAlert('提示', '请选择财务专员用户');
            return;
        }
        var subIds = [];
        document.querySelectorAll('#fsSubTenants .fs-sub-cb:checked').forEach(function (cb) { subIds.push(parseInt(cb.value)); });
        var deptIds = [];
        document.querySelectorAll('#fsDepartments .fs-dept-cb:checked').forEach(function (cb) { deptIds.push(parseInt(cb.value)); });
        var payload = {
            user: this._fsSelectedUser.id,
            sub_tenants: subIds,
            departments: deptIds,
            remark: document.getElementById('fsRemark').value,
            is_active: document.getElementById('fsActive').checked
        };
        try {
            if (this._fsEditId) {
                await this.apiPut(OA_API_URL + '/approval/finance-specialists/' + this._fsEditId + '/', payload);
            } else {
                await this.apiPost(OA_API_URL + '/approval/finance-specialists/', payload);
            }
            this.showToast('保存成功', false);
            this._fsShowList();
            await this._loadFinanceSpecialists();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    },
    _fsBack() {
        this._fsShowList();
    },
    async _fsDel(id) {
        var confirmed = await this.showConfirmDialog('删除财务专员', '确定删除该财务专员吗？删除后其作为第一审批人的配置将失效。', 'danger');
        if (!confirmed) return;
        try {
            var resp = await fetch(OA_API_URL + '/approval/finance-specialists/' + id + '/', {method: 'DELETE', headers: TokenManager.getHeaders()});
            if (!resp.ok) throw new Error('删除失败');
            this.showToast('已删除', false);
            await this._loadFinanceSpecialists();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    },
    async _fsUserSearch() {
        var kw = document.getElementById('fsUserSearch').value;
        var dd = document.getElementById('fsUserDropdown');
        if (!dd) return;
        if (!kw.trim()) { dd.style.display = 'none'; return; }
        try {
            var resp = await fetch(OA_API_URL + '/approval/finance-specialist-users/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()});
            var json = await resp.json();
            var d = json.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(json) : json;
            var users = d.results || [];
            var self = this;
            dd.innerHTML = users.length ? users.map(function (u) {
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onclick="approvalApp._fsPickUser(' + u.id + ', \'' + self._escape(u.name) + '\', \'' + self._escape(u.avatar || '/static/images/default-avatar.png') + '\')">'
                    + '<img src="' + self._escape(u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到成员</div>';
            dd.style.display = 'block';
        } catch (e) {
            dd.style.display = 'none';
        }
    },
    _fsPickUser(id, name, avatar) {
        document.getElementById('fsUserSearch').value = name;
        document.getElementById('fsUserTag').innerHTML = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:12px;font-size:12px;color:#409eff;"><img src="' + this._escape(avatar) + '" style="width:18px;height:18px;border-radius:50%;"> ' + this._escape(name) + '</span>';
        this._fsSelectedUser = {id: id, name: name, avatar: avatar};
        var dd = document.getElementById('fsUserDropdown');
        if (dd) dd.style.display = 'none';
    },
    });
})();
