// static/js/approval-form.js - 动态表单、关联需求/附件、审批人/抄送与附件
// 说明：本文件为 ApprovalApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ApprovalApp.prototype, {

    // ===== 单位工具（金额币种 / 数字单位） =====
    _unitOf(code) {
        return (this._AMOUNT_UNITS || []).find(function (u) { return u.code === code; })
            || (this._NUMBER_UNITS || []).find(function (u) { return u.code === code; }) || null;
    },

    _unitSymbol(code) {
        const u = this._unitOf(code);
        return u ? u.symbol : '';
    },

    _unitLabel(code) {
        const u = this._unitOf(code);
        return u ? u.label : '';
    },

    _schemaUnitOptions(type, selected) {
        const list = type === 'amount' ? (this._AMOUNT_UNITS || []) : (type === 'number' ? (this._NUMBER_UNITS || []) : []);
        if (type === 'amount' && !selected) selected = 'cny'; // 金额默认人民币元
        let html = '<option value="">单位</option>';
        html += list.map(function (u) {
            return '<option value="' + u.code + '"' + (selected === u.code ? ' selected' : '') + '>' + u.label + '</option>';
        }).join('');
        return html;
    },

    // 字段类型变化时刷新单位下拉选项与选项输入占位（amount→币种，number→数量单位，struct_table→列定义）
    _onSchemaFieldTypeChange(sel) {
        const row = sel.closest('.tm-field-row');
        if (!row) return;
        const unitSel = row.querySelector('[data-f="unit"]');
        if (unitSel) unitSel.innerHTML = this._schemaUnitOptions(sel.value, unitSel.value);
        const optSel = row.querySelector('[data-f="options"]');
        if (optSel) optSel.placeholder = this._schemaOptionsPlaceholder(sel.value);
    },

    // ===== 审批类型（动态自定义） =====
    async _loadApprovalTypes() {
        try {
            const data = await this.apiGet(OA_API_URL + '/approval/types/');
            this._approvalTypes = Array.isArray(data) ? data : (data.results || []);
            if (!this._approvalTypes.length) this._approvalTypes = this._fallbackBuiltinTypes();
        } catch (e) {
            console.error('加载审批类型失败，使用内置类型兜底:', e);
            this._approvalTypes = this._fallbackBuiltinTypes();
        }
        this._renderTypeSelector();
        this._renderTypeFilterBar();
        this._renderConfigTypeGrid();
        const cur = document.getElementById('newApprovalType');
        if (cur && !cur.value && this._approvalTypes.length) {
            this.selectType(this._approvalTypes[0].code);
        } else if (cur && cur.value && (!this._isBuiltinType(cur.value) || this._isDynamicSchemaType(cur.value))) {
            // 类型保存后：当前已选中的自定义/带表单内置类型实时重渲染动态表单（无需刷新页面）
            const t = this._getType(cur.value);
            this._renderDynamicFields(t ? (t.form_schema || []) : [], this._editFormData || {});
        }
    },

    _getType(code) {
        return (this._approvalTypes || []).find(t => t.code === code) || null;
    },

    _getTypeName(code) {
        const t = this._getType(code);
        return t ? t.name : code;
    },

    _getTypeIcon(code) {
        const t = this._getType(code);
        return t ? t.icon : this._typeIcon(code);
    },

    _getTypeColor(code) {
        const t = this._getType(code);
        return t ? t.color : '#409EFF';
    },

    _hexA(hex, alpha) {
        try {
            const h = String(hex || '#409EFF').replace('#', '');
            const r = parseInt(h.substring(0, 2), 16);
            const g = parseInt(h.substring(2, 4), 16);
            const b = parseInt(h.substring(4, 6), 16);
            return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        } catch (e) {
            return 'rgba(64,158,255,0.12)';
        }
    },

    _renderTypeSelector() {
        const container = document.getElementById('approvalTypeSelector');
        if (!container) return;
        container.innerHTML = (this._approvalTypes || []).map(t => {
            return '<div class="type-card" data-type="' + this._escape(t.code) + '" onclick="approvalApp.selectType(\'' + this._escape(t.code) + '\', {userSwitch:true})">'
                + '<div class="type-card-icon" style="background:' + this._hexA(t.color, 0.14) + ';color:' + this._escape(t.color) + ';"><i class="fas ' + this._escape(t.icon || 'fa-file-lines') + '"></i></div>'
                + '<div class="type-card-label">' + this._escape(t.name) + '</div>'
                + '</div>';
        }).join('');
    },

    _renderTypeFilterBar() {
        const container = document.getElementById('approvalTypeFilterBar');
        if (!container) return;
        let html = '<span class="type-filter-card active" data-type="" onclick="approvalApp.filterByTypeBtn(this,\'\')">'
            + '<div class="type-filter-card-icon" style="background:#e8f4fd;color:#409eff;"><i class="fas fa-list"></i></div>'
            + '<div class="type-filter-card-label">全部</div></span>';
        html += (this._approvalTypes || []).map(t => {
            return '<span class="type-filter-card" data-type="' + this._escape(t.code) + '" onclick="approvalApp.filterByTypeBtn(this,\'' + this._escape(t.code) + '\')">'
                + '<div class="type-filter-card-icon" style="background:' + this._hexA(t.color, 0.14) + ';color:' + this._escape(t.color) + ';"><i class="fas ' + this._escape(t.icon || 'fa-file-lines') + '"></i></div>'
                + '<div class="type-filter-card-label">' + this._escape(t.name) + '</div></span>';
        }).join('');
        container.innerHTML = html;
    },

    _renderConfigTypeGrid() {
        const grid = document.getElementById('config-type-grid');
        if (!grid) return;
        grid.innerHTML = (this._approvalTypes || []).map(t => {
            return '<div class="config-type-card" data-type="' + this._escape(t.code) + '" onclick="approvalApp._selectConfigType(\'' + this._escape(t.code) + '\')">'
                + '<div class="config-type-icon" style="background:' + this._hexA(t.color, 0.12) + ';color:' + this._escape(t.color) + ';"><i class="fas ' + this._escape(t.icon || 'fa-file-lines') + '"></i></div>'
                + '<span>' + this._escape(t.name) + '</span>'
                + '</div>';
        }).join('');
    },

    // ===== 自定义类型动态表单引擎 =====
    _isBuiltinType(code) {
        const t = this._getType(code);
        if (t) return t.is_builtin;
        return ['leave', 'overtime', 'expense', 'trip', 'purchase', 'recruit', 'other'].indexOf(code) !== -1;
    },

    // 是否渲染动态表单：自定义类型，或带 form_schema 的内置类型（如物资需求单/领用单）
    _isDynamicSchemaType(code) {
        const t = this._getType(code);
        return !!(t && t.form_schema && t.form_schema.length);
    },

    _hideBuiltinFields() {
        ['dateRow', 'amountGroup', 'expenseRow', 'recruitForm',
         'leaveTypeRow', 'tripInfoRow', 'purchaseItemsRow', 'expenseItemsRow'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    },

    _renderDynamicFields(schema, values) {
        const container = document.getElementById('dynamicFormFields');
        if (!container) return;
        values = values || {};
        this._currentSchema = schema || [];
        this._dynAttachmentValues = {};
        this._dynUserValues = {};
        this._dynReqLinkValues = {};
        let html = '';
        const self = this;
        (schema || []).forEach(f => {
            const key = f.key, label = f.label || key, type = f.type || 'text';
            const req = f.required ? ' <span class="required">*</span>' : '';
            const val = values[key] !== undefined ? values[key] : (f.default !== undefined ? f.default : '');
            const placeholder = f.placeholder || '';
            html += '<div class="form-group" style="margin-top:12px;">';
            html += '<label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;"><i class="fas fa-edit" style="color:#9b59b6;margin-right:4px;"></i> ' + self._escape(label) + req + '</label>';
            switch (type) {
                case 'textarea':
                    html += '<textarea class="form-textarea" data-k="' + self._escape(key) + '" rows="2" placeholder="' + self._escape(placeholder) + '" style="min-height:56px;">' + self._escape(val) + '</textarea>';
                    break;
                case 'select': {
                    html += '<select class="form-select" data-k="' + self._escape(key) + '"><option value="">请选择</option>';
                    (f.options || []).forEach(o => {
                        const ov = typeof o === 'object' ? o.value : o;
                        const ol = typeof o === 'object' ? (o.label || o.value) : o;
                        html += '<option value="' + self._escape(ov) + '"' + (String(val) === String(ov) ? ' selected' : '') + '>' + self._escape(ol) + '</option>';
                    });
                    html += '</select>';
                    break;
                }
                case 'radio': {
                    (f.options || []).forEach(o => {
                        const ov = typeof o === 'object' ? o.value : o;
                        const ol = typeof o === 'object' ? (o.label || o.value) : o;
                        html += '<label style="margin-right:14px;font-size:13px;cursor:pointer;"><input type="radio" name="dyn_' + self._escape(key) + '" value="' + self._escape(ov) + '"' + (String(val) === String(ov) ? ' checked' : '') + '> ' + self._escape(ol) + '</label>';
                    });
                    break;
                }
                case 'checkbox': {
                    const arr = Array.isArray(val) ? val : (val ? [val] : []);
                    (f.options || []).forEach(o => {
                        const ov = typeof o === 'object' ? o.value : o;
                        const ol = typeof o === 'object' ? (o.label || o.value) : o;
                        html += '<label style="margin-right:14px;font-size:13px;cursor:pointer;"><input type="checkbox" name="dyn_' + self._escape(key) + '" value="' + self._escape(ov) + '"' + (arr.indexOf(ov) !== -1 ? ' checked' : '') + '> ' + self._escape(ol) + '</label>';
                    });
                    break;
                }
                case 'date': {
                    let dv = val;
                    if (!dv && f.default === 'today') {
                        const _t = new Date();
                        dv = _t.getFullYear() + '-' + String(_t.getMonth() + 1).padStart(2, '0') + '-' + String(_t.getDate()).padStart(2, '0');
                    }
                    html += '<input type="date" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(dv) + '">';
                    break;
                }
                case 'datetime':
                    html += '<input type="datetime-local" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '">';
                    break;
                case 'number':
                    html += '<div style="display:flex;align-items:center;gap:6px;"><input type="number" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '" placeholder="' + self._escape(placeholder) + '" oninput="approvalApp._onDynNumericChange()" style="flex:1;">'
                        + (f.unit ? '<span style="font-size:12px;color:#909399;white-space:nowrap;flex-shrink:0;">' + self._escape(self._unitLabel(f.unit)) + '</span>' : '') + '</div>';
                    break;
                case 'amount':
                    html += '<div style="display:flex;align-items:center;gap:6px;">'
                        + (f.unit ? '<span style="font-size:15px;font-weight:600;color:#e6a23c;white-space:nowrap;flex-shrink:0;">' + self._escape(self._unitSymbol(f.unit)) + '</span>' : '<i class="fas fa-yen-sign" style="color:#e6a23c;"></i>')
                        + '<input type="number" step="0.01" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '" placeholder="0.00" oninput="approvalApp._onDynNumericChange()" style="flex:1;' + (f.readonly ? 'background:#f5f7fa;' : '') + '"' + (f.readonly ? ' disabled' : '') + '>'
                        + (f.unit ? '<span style="font-size:12px;color:#909399;white-space:nowrap;flex-shrink:0;">' + self._escape(self._unitLabel(f.unit)) + '</span>' : '') + '</div>';
                    break;
                case 'attachment':
                    html += '<div class="dyn-attachment" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
                        + '<input type="file" multiple style="display:none;" onchange="approvalApp._onDynAttachmentChange(event, \'' + self._escape(key) + '\')">'
                        + '<button type="button" class="btn btn-secondary btn-sm" onclick="this.previousElementSibling.click()"><i class="fas fa-paperclip"></i> 选择附件</button>'
                        + '<button type="button" class="btn btn-secondary btn-sm" onclick="approvalApp._pickDynCloudAttachments(\'' + self._escape(key) + '\')"><i class="fas fa-cloud"></i> 从网盘选择</button>'
                        + '<div class="dyn-attach-list" id="dynAttach_' + self._escape(key) + '" style="width:100%;"></div></div>';
                    break;
                case 'invoice':
                    html += self._invoiceBlockHtml(key, { canOperate: self._isInvoiceOperator(null), max: self._currentInvoiceMax || 10 });
                    break;
                case 'department':
                    html += '<select class="form-select" data-k="' + self._escape(key) + '" id="dynDept_' + self._escape(key) + '"><option value="">请选择部门</option></select>';
                    break;
                case 'user':
                    html += '<div class="dyn-user"><div style="position:relative;">'
                        + '<input type="text" class="form-input" placeholder="搜索成员添加..." oninput="approvalApp._onDynUserSearch(event, \'' + self._escape(key) + '\')">'
                        + '<div class="dyn-user-results" id="dynUserRes_' + self._escape(key) + '" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:#fff;border:1px solid #dcdfe6;border-radius:6px;max-height:160px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);"></div>'
                        + '</div><div class="dyn-user-tags" id="dynUserTags_' + self._escape(key) + '"></div></div>';
                    break;
                case 'expense_type':
                    // 费用类型选择：原生 select 隐藏存值，自定义下拉展示（已选仅名称，下拉项带小字提示）
                    html += '<div class="exp-select-field">'
                        + '<select class="form-select exp-select-native" data-k="' + self._escape(key) + '">' + self._expenseTypeOptionHtml(val) + '</select>'
                        + '</div>';
                    break;
                case 'struct_table': {
                    const ro = !!f.readonly;
                    html += '<div class="dyn-struct-table" data-struct-key="' + self._escape(key) + '"' + (ro ? ' data-readonly="1"' : '') + '>'
                        + '<div class="dyn-struct-rows"></div>'
                        + (ro ? '' : '<button type="button" class="btn btn-sm btn-secondary dyn-struct-add" onclick="approvalApp._addDynStructRow(\'' + self._escape(key) + '\')"><i class="fas fa-plus"></i> 添加明细</button>')
                        + '</div>';
                    break;
                }
                case 'link_requisition': {
                    var _isStock = (f.mode === 'stock_in');
                    html += '<div class="dyn-reqlink"><div style="display:flex;gap:8px;align-items:flex-start;">'
                        + '<div style="position:relative;flex:1;min-width:0;">'
                        + '<input type="text" class="form-input" placeholder="输入需求单号/分公司/物品名称搜索..." oninput="approvalApp._onDynReqLinkSearch(event, \'' + self._escape(key) + '\')">'
                        + '<div class="dyn-reqlink-res" id="dynReqLinkRes_' + self._escape(key) + '" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:50;background:#fff;border:1px solid #dcdfe6;border-radius:6px;max-height:180px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);"></div>'
                        + '</div>'
                        + (_isStock
                            ? '<button type="button" class="btn btn-sm btn-secondary" style="flex-shrink:0;" title="不知道需求单号？按物资名称查找待入库物资" onclick="approvalApp._browseAvailForLink(\'' + self._escape(key) + '\')"><i class="fas fa-warehouse" style="color:#16a085;"></i> 按物资查找</button>'
                            : '<button type="button" class="btn btn-sm btn-secondary" style="flex-shrink:0;" title="不知道需求单号？按物资名称查找可领用物资" onclick="approvalApp._browseAvailForLink(\'' + self._escape(key) + '\')"><i class="fas fa-boxes" style="color:#16a085;"></i> 按物资查找</button>')
                        + '</div><div class="dyn-reqlink-tag" id="dynReqLinkTag_' + self._escape(key) + '"></div></div>';
                    break;
                }
                default:
                    html += '<input type="text" class="form-input" data-k="' + self._escape(key) + '" value="' + self._escape(val) + '" placeholder="' + self._escape(placeholder) + '">';
            }
            html += '</div>';
        });
        container.innerHTML = html;
        container.style.display = 'block';
        (schema || []).forEach(f => {
            if (f.type === 'attachment') {
                this._dynAttachmentValues[f.key] = Array.isArray(values[f.key]) ? values[f.key] : [];
                this._renderDynAttachList(f.key);
            }
            if (f.type === 'invoice') {
                this._setInvoiceList(f.key, Array.isArray(values[f.key]) ? values[f.key] : []);
                this._renderInvoices(f.key, { canOperate: this._isInvoiceOperator(null) });
            }
            if (f.type === 'user') {
                this._dynUserValues[f.key] = Array.isArray(values[f.key]) ? values[f.key] : [];
                this._renderDynUserTags(f.key);
            }
            if (f.type === 'department') {
                // 始终加载部门下拉（新建审批无值也要渲染选项）
                this._loadDynDeptOptions(f.key, values[f.key], f.scope);
            }
            if (f.type === 'struct_table') {
                this._dynStructCols = this._dynStructCols || {};
                this._dynStructCols[f.key] = f.columns || [];
                this._dynStructReadonly = this._dynStructReadonly || {};
                this._dynStructReadonly[f.key] = !!f.readonly;
                this._renderDynStructRows(f.key, values[f.key], f.columns || []);
            }
            if (f.type === 'link_requisition') {
                this._dynReqLinkValues = this._dynReqLinkValues || {};
                this._dynReqLinkValues[f.key] = (typeof values[f.key] === 'object' && values[f.key]) ? values[f.key] : null;
                this._renderDynReqLinkTag(f.key);
                // 若已选需求单，自动带出明细
                const lv = this._dynReqLinkValues[f.key];
                if (lv && lv.requirement_id && f.target) {
                    this._autoFillRequisitionDetail(f.key, f.target, lv.requirement_id);
                }
            }
            if (f.type === 'expense_type') {
                let target = null;
                container.querySelectorAll('select[data-k]').forEach(function (s) {
                    if (s.getAttribute('data-k') === f.key) target = s;
                });
                this._buildExpenseSelect(target);
            }
        });
    },

    // 费用类型选择：选项与内置报销一致（名称 + 括号提示）
    // 费用类型数据源（value, 名称, 提示内容）
    _getExpenseTypeList() {
        return [
            ['travel', '差旅费', '出差机票、火车票、住宿费'],
            ['office', '办公费', '办公家具、文具用品、公司用车油费、打印机耗材、电脑配件、纸张类、桶装水、水电费、办公软件、行业会员费等'],
            ['meals', '业务招待费', '招待餐费、招待住宿、伴手礼、等招待相关的费用'],
            ['transport', '交通费', '市内打车、公交车、油费'],
            ['communication', '通讯费', '电话费、宽带费'],
            ['equipment', '设备采购', '电脑、服务器、空调等固定资产'],
            ['training', '培训费', '讲课费、场地费、和培训相关的吃住行等费用'],
            ['welfare', '员工福利费', '员工活动餐费、过年过节福利用品及费用'],
            ['professional_service', '专业服务费', '咨询费、审计费、律师费、资产评估费等'],
            ['advertising', '广告宣传费', '广告策划宣传等'],
            ['other_expense', '其他', '']
        ];
    },

    _getExpenseTypeInfo(value) {
        const list = this._getExpenseTypeList();
        for (let i = 0; i < list.length; i++) {
            if (list[i][0] === value) return {name: list[i][1], hint: list[i][2]};
        }
        return null;
    },

    // 费用类型选择：下拉仅显示类型名称，选择后以弹窗形式提示费用说明
    _expenseTypeOptionHtml(selected) {
        let html = '<option value="">请选择</option>';
        this._getExpenseTypeList().forEach(function (o) {
            html += '<option value="' + o[0] + '"' + (String(selected) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        });
        return html;
    },

    // 结构化明细：回填已有行
    _renderDynStructRows(key, rows, columns) {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + key + '"]');
        if (!tbl) return;
        const rowsEl = tbl.querySelector('.dyn-struct-rows');
        if (!rowsEl) return;
        const readonly = this._dynStructReadonly && this._dynStructReadonly[key];
        rowsEl.innerHTML = '';
        (rows || []).forEach(function (row) {
            if (typeof row !== 'object') return;
            approvalApp._appendDynStructRow(tbl, row, columns, readonly);
        });
    },

    _appendDynStructRow(tbl, row, columns, readonly) {
        const rowsEl = tbl.querySelector('.dyn-struct-rows');
        if (!rowsEl || !columns || !columns.length) return;
        row = row || {};
        // 含「单价 + 数量」的明细（物资需求/领用/入库）逐行显示产品金额 = 数量 × 单价
        const hasLineAmount = columns.some(function (c) { return c.key === 'price'; })
            && columns.some(function (c) { return c.key === 'quantity'; });
        const wrap = document.createElement('div');
        wrap.className = 'dyn-struct-row';
        wrap.innerHTML = '<div class="dyn-struct-fields">'
            + columns.map(function (c) {
                const val = row[c.key] !== undefined ? row[c.key] : '';
                const isNumeric = c.type === 'amount' || c.type === 'number';
                const isItem = c.type === 'item';
                if (readonly) {
                    // 只读（如领用单关联需求单自动带出的明细）：文本展示 + 隐藏值用于提交收集，不可改/删/加
                    let txt = val;
                    if (c.type === 'amount' && val !== '' && val != null) txt = Number(val).toFixed(2);
                    return '<div class="dyn-struct-field"><label>' + approvalApp._escape(c.label || c.key) + '</label>'
                        + '<input type="hidden" class="dyn-struct-input" data-c="' + approvalApp._escape(c.key) + '" value="' + approvalApp._escape(val) + '">'
                        + '<div class="dyn-struct-ro" style="padding:6px 10px;background:#f5f7fa;border:1px solid #ebeef5;border-radius:4px;color:#606266;font-size:13px;min-height:20px;">' + approvalApp._escape(txt === '' ? '-' : txt) + '</div></div>';
                }
                const inputAttrs = c.type === 'amount'
                    ? 'type="number" step="0.01" placeholder="0.00"'
                    : (c.type === 'number' ? 'type="number"' : 'type="text"');
                const onInput = (isNumeric || isItem) ? ' oninput="approvalApp._onDynStructChange()"' : '';
                const input = '<input ' + inputAttrs + onInput + ' autocomplete="off" class="form-input dyn-struct-input" data-c="' + approvalApp._escape(c.key) + '"' + (isItem ? ' data-item="1" placeholder="输入或搜索物品"' : '') + ' value="' + approvalApp._escape(val) + '">';
                return '<div class="dyn-struct-field">'
                    + '<label>' + approvalApp._escape(c.label || c.key) + '</label>'
                    + input
                    + (isItem ? '<div class="dyn-struct-item-res" style="position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #dcdfe6;border-radius:6px;max-height:160px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.1);display:none;"></div>' : '')
                    + '</div>';
            }).join('')
            + '</div>'
            + (hasLineAmount
                ? '<div class="dyn-struct-line-amount" style="margin-top:4px;font-size:12px;color:#e6a23c;text-align:right;"></div>'
                : '')
            + (readonly ? '' : '<button type="button" class="dyn-struct-del" title="删除此行" onclick="approvalApp._removeDynStructRow(this)"><i class="fas fa-times"></i></button>');
        rowsEl.appendChild(wrap);
        // 物品名称列：挂接物品库联想（只读明细不挂接）
        if (!readonly) {
            wrap.querySelectorAll('.dyn-struct-input[data-item="1"]').forEach(function (input) {
                approvalApp._bindDynStructItemAuto(input);
            });
        }
    },

    // 物品名称列联想：从物品库搜索，选中后自动回填规格/单位
    _bindDynStructItemAuto(input) {
        const field = input.closest('.dyn-struct-field');
        if (!field) return;
        const res = field.querySelector('.dyn-struct-item-res');
        if (!res) return;
        let timer = null;
        input.addEventListener('input', function (e) {
            const kw = e.target.value.trim();
            if (!kw) { res.style.display = 'none'; return; }
            clearTimeout(timer);
            timer = setTimeout(function () {
                fetch(OA_API_URL + '/material/item-search/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()})
                    .then(r => r.json()).then(function (d) {
                        const items = d.results || [];
                        if (!items.length) { res.innerHTML = '<div style="padding:6px 10px;color:#909399;font-size:12px;">未找到物品，可直接输入</div>'; }
                        else {
                            res.innerHTML = items.map(function (it) {
                                return '<div style="padding:6px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px;" onclick="approvalApp._pickDynStructItem(this)" data-name="' + approvalApp._escape(it.name) + '" data-spec="' + approvalApp._escape(it.spec || '') + '" data-unit="' + approvalApp._escape(it.unit || '') + '" data-price="' + approvalApp._escape(it.price || '') + '">'
                                    + '<span>' + approvalApp._escape(it.name) + '</span>'
                                    + (it.spec ? ' <span style="font-size:11px;color:#909399;">' + approvalApp._escape(it.spec) + '</span>' : '')
                                    + (it.unit ? ' <span style="font-size:11px;color:#c0c4cc;">' + approvalApp._escape(it.unit) + '</span>' : '')
                                    + (it.price ? ' <span style="font-size:11px;color:#e6a23c;">¥' + approvalApp._escape(it.price) + '</span>' : '')
                                    + '</div>';
                            }).join('');
                        }
                        res.style.display = 'block';
                    }).catch(function () {});
            }, 200);
        });
        input.addEventListener('blur', function () {
            setTimeout(function () { res.style.display = 'none'; }, 200);
        });
    },

    _pickDynStructItem(el) {
        const input = el.closest('.dyn-struct-field').querySelector('.dyn-struct-input[data-item="1"]');
        if (input) input.value = el.getAttribute('data-name') || '';
        const row = el.closest('.dyn-struct-row');
        if (row) {
            const spec = el.getAttribute('data-spec');
            const unit = el.getAttribute('data-unit');
            const price = el.getAttribute('data-price');
            const specIn = row.querySelector('.dyn-struct-input[data-c="spec"]');
            const unitIn = row.querySelector('.dyn-struct-input[data-c="unit"]');
            const priceIn = row.querySelector('.dyn-struct-input[data-c="price"]');
            if (specIn && spec) specIn.value = spec;
            if (unitIn && unit) unitIn.value = unit;
            if (priceIn && price) priceIn.value = price;
        }
        const res = el.parentNode;
        if (res) res.style.display = 'none';
        approvalApp._onDynStructChange();
    },

    // 结构化明细变更：自动把明细金额/数字列合计写入顶层「金额/合计」阈值字段，并刷新审批链（联动阈值审批）
    _onDynStructChange() {
        const typeEl = document.getElementById('newApprovalType');
        const type = typeEl ? typeEl.value : '';
        if (type && (!this._isBuiltinType(type) || this._isDynamicSchemaType(type))) {
            const t = this._getType(type);
            const schema = (t && t.form_schema) || [];
            let totalSum = 0;
            const self = this;
            schema.forEach(function (f) {
                if (f.type !== 'struct_table') return;
                const cols = f.columns || [];
                const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + f.key + '"]');
                if (!tbl) return;
                const priceCol = cols.find(function (c) { return c.key === 'price' && (c.type === 'amount' || c.type === 'number'); });
                const qtyCol = cols.find(function (c) { return c.key === 'quantity' && (c.type === 'number' || c.type === 'amount'); });
                if (priceCol && qtyCol) {
                    // 物资明细：产品金额 = Σ(数量 × 单价)，并逐行展示该行产品金额
                    tbl.querySelectorAll('.dyn-struct-row').forEach(function (row) {
                        const p = parseFloat((row.querySelector('.dyn-struct-input[data-c="price"]') || {}).value) || 0;
                        const q = parseFloat((row.querySelector('.dyn-struct-input[data-c="quantity"]') || {}).value) || 0;
                        const lineTotal = p * q;
                        totalSum += lineTotal;
                        const out = row.querySelector('.dyn-struct-line-amount');
                        if (out) {
                            const show = (p > 0 || q > 0);
                            out.textContent = show ? ('产品金额 ¥' + lineTotal.toFixed(2)) : '';
                        }
                    });
                    return;
                }
                const numericCols = cols.filter(function (c) { return c.type === 'amount' || c.type === 'number'; });
                if (!numericCols.length) return;
                numericCols.forEach(function (ac) {
                    tbl.querySelectorAll('.dyn-struct-input[data-c="' + ac.key + '"]').forEach(function (input) {
                        totalSum += parseFloat(input.value) || 0;
                    });
                });
            });
            // 若 schema 存在顶层「金额/合计/实际金额」数字字段，自动写入合计值
            // （物资入库单的顶层字段是「实际金额」actual_amount：入库数量 × 入库单价 自动汇总）
            const amountField = schema.find(function (f) {
                return (f.key === 'amount' || f.key === 'total' || f.key === 'total_amount'
                        || f.key === 'actual_amount')
                    && (f.type === 'amount' || f.type === 'number');
            });
            if (amountField) {
                const el = document.querySelector('input[data-k="' + amountField.key + '"]');
                // 只读字段（如领用单的「产品金额」是 disabled）同样要写入，取值仍会随表单收集
                if (el) el.value = totalSum > 0 ? totalSum.toFixed(2) : '';
            }
        }
        this._debouncedChainRefresh();
    },

    _addDynStructRow(key) {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + key + '"]');
        if (!tbl) return;
        if (tbl.getAttribute('data-readonly') === '1') return;  // 只读明细不可添加
        this._dynStructCols = this._dynStructCols || {};
        this._appendDynStructRow(tbl, {}, this._dynStructCols[key] || [], false);
        this._onDynStructChange();
    },

    _removeDynStructRow(btn) {
        const row = btn.closest('.dyn-struct-row');
        if (row) row.remove();
        this._onDynStructChange();
    },

    // ===== 关联需求单（物资领用单 / 物资入库单） =====
    _reqLinkStockMode() {
        const f = (this._currentSchema || []).find(function (s) { return s.type === 'link_requisition'; });
        return !!(f && f.mode === 'stock_in');
    },
    async _onDynReqLinkSearch(e, key) {
        const kw = (e.target.value || '').trim();
        const res = document.getElementById('dynReqLinkRes_' + key);
        if (!res) return;
        if (!kw) { res.style.display = 'none'; return; }
        const stockMode = this._reqLinkStockMode();
        try {
            let url = OA_API_URL + '/material/requirement-search/?search=' + encodeURIComponent(kw);
            if (stockMode) url += '&mode=stock_in';
            const r = await fetch(url, {headers: TokenManager.getHeaders()});
            if (!r.ok) return;
            const d = await r.json();
            const list = d.results || [];
            const self = this;
            res.innerHTML = list.length ? list.map(function (it) {
                const sub = stockMode
                    ? ('待收 ' + (it.to_receive != null ? it.to_receive : 0))
                    : ('剩余可领 ' + (it.remaining != null ? it.remaining : 0));
                if (it.linkable) {
                    const badge = stockMode ? ['待收 ' + (it.to_receive != null ? it.to_receive : 0), '#e6a23c', '#fdf6ec'] : ['可领用', '#16a085', '#e8f8f0'];
                    return '<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onclick="approvalApp._selectDynReqLink(' + it.id + ', \'' + self._escape(key) + '\')">'
                        + '<div style="font-size:13px;font-weight:600;color:#16a085;">' + self._escape(it.doc_no)
                        + ' <span style="font-size:10px;color:' + badge[1] + ';background:' + badge[2] + ';border-radius:4px;padding:0 4px;">' + self._escape(badge[0]) + '</span></div>'
                        + '<div style="font-size:11px;color:#909399;">' + self._escape([it.branch_dept, (it.item_names ? ('含 ' + it.item_names) : ('物品 ' + it.item_count + ' 项')), sub].filter(Boolean).join(' · ')) + '</div>'
                        + '</div>';
                }
                const reason = stockMode
                    ? ((it.to_receive != null && it.to_receive <= 0) ? '该需求单已全部入库' : (it.status_label + '，需先审批通过'))
                    : (it.status_label + '，入库后方可领用');
                return '<div style="padding:8px 12px;opacity:0.55;border-bottom:1px solid #f0f0f0;cursor:not-allowed;" title="' + self._escape(reason) + '">'
                    + '<div style="font-size:13px;font-weight:600;color:#606266;">' + self._escape(it.doc_no)
                    + ' <span style="font-size:10px;color:#e6a23c;background:#fdf6ec;border-radius:4px;padding:0 4px;">' + self._escape(it.status_label) + '</span></div>'
                    + '<div style="font-size:11px;color:#909399;">' + self._escape([it.branch_dept, (it.item_names ? ('含 ' + it.item_names) : ('物品 ' + it.item_count + ' 项'))].filter(Boolean).join(' · ')) + '（' + self._escape(reason) + '）</div>'
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">'
                + (stockMode
                    ? '未找到待入库的需求单（需求单审批通过且还有待收数量才可入库），可点「按物资查找」试试'
                    : '未找到可领用的需求单（需求单审批通过并入库后才可领用），可点「按物资查找」试试')
                + '</div>';
            res.style.display = 'block';
        } catch (err) {}
    },

    async _selectDynReqLink(id, key) {
        this._dynReqLinkValues = this._dynReqLinkValues || {};
        try {
            const r = await fetch(OA_API_URL + '/material/requirement-detail/?id=' + id, {headers: TokenManager.getHeaders()});
            if (!r.ok) { this.showToast('加载需求单失败', true); return; }
            const raw = await r.json();
            const detail = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            if (!detail) { this.showToast('加载需求单失败', true); return; }
            this._dynReqLinkValues[key] = {requirement_id: detail.id, doc_no: detail.doc_no, branch_dept: detail.branch_dept, purpose: detail.purpose, amount: detail.amount};
            const search = document.querySelector('.dyn-reqlink input');
            if (search) search.value = '';
            const res = document.getElementById('dynReqLinkRes_' + key);
            if (res) res.style.display = 'none';
            this._renderDynReqLinkTag(key);
            // 产品金额 = 关联需求单的预估金额（自动填充；只读字段已禁用）
            const amtInput = document.querySelector('input[data-k="amount"]');
            if (amtInput) {
                amtInput.value = (detail.amount != null && detail.amount !== '') ? detail.amount : '';
            }
            const f = (this._currentSchema || []).find(function (s) { return s.key === key; });
            if (f && f.target) this._fillDynStructFromRequirement(f.target, detail.items || []);
        } catch (e) { this.showToast((e && e.message) || '加载需求单失败', true); }
    },

    // 领用单/入库单表单里按物资名称查找：选中后自动关联来源需求单并只带出该物资
    _browseAvailForLink(key) {
        var self = this;
        var stockMode = this._reqLinkStockMode();
        this.openAvailPicker({
            mode: stockMode ? 'stock_in' : '',
            title: stockMode ? '按物资查找待入库物资' : '按物资查找可领用物资',
            onPick: function (g) { if (g && g.requirement_id) self._applyAvailPickToForm(key, g, stockMode); }
        });
    },
    async _applyAvailPickToForm(key, g, keepQty) {
        try {
            const detail = await this.apiGet(OA_API_URL + '/material/requirement-detail/?id=' + g.requirement_id);
            if (!detail) { this.showToast('加载需求单失败', true); return; }
            this._dynReqLinkValues = this._dynReqLinkValues || {};
            this._dynReqLinkValues[key] = {
                requirement_id: detail.id, doc_no: detail.doc_no,
                branch_dept: detail.branch_dept, purpose: detail.purpose, amount: detail.amount
            };
            this._renderDynReqLinkTag(key);
            const amtInput = document.querySelector('input[data-k="amount"]');
            if (amtInput) amtInput.value = (detail.amount != null && detail.amount !== '') ? detail.amount : '';
            const f = (this._currentSchema || []).find(function (s) { return s.key === key; });
            if (f && f.target) {
                this._fillDynStructFromRequirement(f.target, detail.items || []);
                this._keepOnlyDynStructRow(f.target, g.item_name, !!keepQty);
            }
            this.showToast('已关联 ' + detail.doc_no + ' 并带出「' + g.item_name + '」，请填写'
                + (keepQty ? '本次入库数量' : '领用数量'), false);
        } catch (e) { this.showToast((e && e.message) || '加载需求单失败', true); }
    },

    _clearDynReqLink(key) {
        this._dynReqLinkValues = this._dynReqLinkValues || {};
        this._dynReqLinkValues[key] = null;
        this._renderDynReqLinkTag(key);
        // 清空产品金额
        const amtInput = document.querySelector('input[data-k="amount"]');
        if (amtInput) amtInput.value = '';
        const f = (this._currentSchema || []).find(function (s) { return s.key === key; });
        if (f && f.target) {
            const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + f.target + '"]');
            if (tbl) { const rowsEl = tbl.querySelector('.dyn-struct-rows'); if (rowsEl) rowsEl.innerHTML = ''; }
        }
    },

    _renderDynReqLinkTag(key) {
        const tag = document.getElementById('dynReqLinkTag_' + key);
        if (!tag) return;
        const v = this._dynReqLinkValues && this._dynReqLinkValues[key];
        if (!v) {
            const hint = this._reqLinkStockMode() ? '未选择需求单（选择后自动带出待收明细，可改本次实收数量）' : '未选择需求单（选择后将自动带出领用明细）';
            tag.innerHTML = '<span style="font-size:12px;color:#c0c4cc;">' + hint + '</span>';
            return;
        }
        tag.innerHTML = '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:#e8f8f0;border-radius:14px;font-size:12px;color:#16a085;margin-top:6px;">'
            + '<i class="fas fa-box-open" style="font-size:11px;"></i>'
            + '<span style="font-weight:600;">' + this._escape(v.doc_no || '') + '</span>'
            + (v.branch_dept ? '<span style="font-size:11px;color:#7fc8b0;">' + this._escape(v.branch_dept) + '</span>' : '')
            + '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._clearDynReqLink(\'' + this._escape(key) + '\')" title="取消关联"></i>'
            + '</span>';
    },

    // 🔧 重新编辑/草稿回填时：按已关联的需求单自动带出领用明细（回填剩余可领量）与产品金额
    async _autoFillRequisitionDetail(key, target, requirementId) {
        if (!requirementId || !target) return;
        try {
            const r = await fetch(OA_API_URL + '/material/requirement-detail/?id=' + requirementId, {headers: TokenManager.getHeaders()});
            if (!r.ok) { this.showToast('加载需求单失败', true); return; }
            const raw = await r.json();
            const detail = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            if (!detail) { this.showToast('加载需求单失败', true); return; }
            this._fillDynStructFromRequirement(target, detail.items || []);
            // 产品金额由领用明细（入库单价 × 领用数量）自动计算，见 _onDynStructChange
        } catch (e) {
            this.showToast((e && e.message) || '加载需求单失败', true);
        }
    },

    // 从需求单自动带出明细到目标 struct_table：
    // 领用单回填「剩余可领量」（行只读锁定）；入库单回填「待收量」可编辑（用户可改本次实收）
    _fillDynStructFromRequirement(target, items) {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + target + '"]');
        if (!tbl) return;
        const rowsEl = tbl.querySelector('.dyn-struct-rows');
        if (!rowsEl) return;
        const cols = this._dynStructCols[target] || [];
        const readonly = this._dynStructReadonly && this._dynStructReadonly[target];
        const stockMode = this._reqLinkStockMode();
        const self = this;
        rowsEl.innerHTML = '';
        const maxes = [];
        (items || []).forEach(function (it) {
            let qty;
            // 单价：领用/入库均以「入库加权单价」为准，无则回退需求单预估单价
            const unitPrice = (it.stocked_price != null && it.stocked_price !== '') ? it.stocked_price : it.price;
            if (stockMode) {
                qty = (it.to_receive != null) ? it.to_receive : ((it.quantity != null ? it.quantity : 0) - (it.received || 0));
            } else {
                const remain = (it.remaining != null) ? it.remaining : it.quantity;
                qty = remain;
                maxes.push(Number(remain) || 0);
            }
            self._appendDynStructRow(tbl, {
                item_name: it.item_name, spec: it.spec, unit: it.unit,
                price: unitPrice,
                quantity: qty,
                remark: it.remark || ''
            }, cols, readonly);
        });
        // 领用（非入库）模式：领用数量不得超过剩余可领数量，输入超限自动收敛
        if (!stockMode) {
            tbl.querySelectorAll('.dyn-struct-row').forEach(function (row, i) {
                const qi = row.querySelector('.dyn-struct-input[data-c="quantity"]');
                if (!qi) return;
                const mx = maxes[i];
                if (mx == null || isNaN(mx)) return;
                qi.setAttribute('max', mx);
                qi.setAttribute('data-max', mx);
                qi.addEventListener('input', function () {
                    const v = parseFloat(qi.value);
                    if (!isNaN(v) && v > mx) {
                        qi.value = mx;
                        approvalApp.showToast('领用数量不能超过剩余可领数量 ' + mx, true);
                    }
                });
            });
        }
        this._onDynStructChange();
    },

    // 从「可领用/待入库物资」进入时：明细只保留所选物资那一行。
    // keepQty=true（入库）保留自动带出的待收数量；否则（领用）数量默认 1，可改，仍受剩余可领上限约束
    _keepOnlyDynStructRow(target, itemName, keepQty) {
        var tbl = document.querySelector('.dyn-struct-table[data-struct-key="' + target + '"]');
        if (!tbl || !itemName) return;
        var kept = false;
        tbl.querySelectorAll('.dyn-struct-row').forEach(function (row) {
            var ni = row.querySelector('.dyn-struct-input[data-c="item_name"]');
            var name = ni ? (ni.value || '') : '';
            if (!kept && name === itemName) {
                kept = true;
                var qi = row.querySelector('.dyn-struct-input[data-c="quantity"]');
                if (qi && !keepQty) {
                    var mx = parseFloat(qi.getAttribute('data-max'));
                    var def = (!isNaN(mx) && mx < 1) ? mx : 1;
                    qi.value = def;
                    if (!qi.getAttribute('data-max')) qi.setAttribute('data-max', def);
                }
                return;
            }
            row.remove();
        });
        this._onDynStructChange();
    },

    _validateRequisitionItems() {
        const tbl = document.querySelector('.dyn-struct-table[data-struct-key="items"]');
        if (!tbl) return null;
        let over = null;
        tbl.querySelectorAll('.dyn-struct-row').forEach(function (row) {
            if (over !== null) return;
            const qi = row.querySelector('.dyn-struct-input[data-c="quantity"]');
            if (!qi) return;
            const mx = parseFloat(qi.getAttribute('data-max'));
            const v = parseFloat(qi.value);
            if (!isNaN(mx) && !isNaN(v) && v > mx) over = mx;
        });
        return over;
    },

    _validateDynRequired() {
        const schema = this._currentSchema || [];
        if (!schema.length) return [];
        const data = this._collectDynamicFormData();
        const missing = [];
        schema.forEach(function (f) {
            if (!f || !f.required || !f.key) return;
            const v = data[f.key];
            const empty = (v === undefined || v === null || v === '')
                || (Array.isArray(v) && v.length === 0)
                || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
            if (empty) missing.push(f.label || f.key);
        });
        return missing;
    },

    _collectDynamicFormData() {
        const data = {};
        const container = document.getElementById('dynamicFormFields');
        if (!container) return data;
        container.querySelectorAll('[data-k]').forEach(el => {
            if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
            const k = el.getAttribute('data-k');
            if (!k) return;
            if (el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'date' || el.type === 'datetime-local')) {
                data[k] = el.value !== '' ? el.value : null;
            } else {
                data[k] = el.value;
            }
        });
        container.querySelectorAll('input[type="radio"]').forEach(el => {
            if (el.checked) data[el.name.replace(/^dyn_/, '')] = el.value;
        });
        container.querySelectorAll('input[type="checkbox"]').forEach(el => {
            const key = el.name.replace(/^dyn_/, '');
            if (el.checked) {
                if (!data[key]) data[key] = [];
                data[key].push(el.value);
            }
        });
        Object.keys(this._dynAttachmentValues || {}).forEach(k => {
            if (this._dynAttachmentValues[k] && this._dynAttachmentValues[k].length) data[k] = this._dynAttachmentValues[k];
        });
        Object.keys(this._dynUserValues || {}).forEach(k => {
            if (this._dynUserValues[k] && this._dynUserValues[k].length) data[k] = this._dynUserValues[k].map(u => ({
                id: u.id,
                name: u.name
            }));
        });
        // 结构化明细：收集每个明细表的行（至少填写一列才保留）
        container.querySelectorAll('.dyn-struct-table').forEach(function (tbl) {
            const key = tbl.getAttribute('data-struct-key');
            if (!key) return;
            const rows = [];
            tbl.querySelectorAll('.dyn-struct-row').forEach(function (rowEl) {
                const obj = {};
                rowEl.querySelectorAll('.dyn-struct-input').forEach(function (input) {
                    obj[input.getAttribute('data-c')] = input.value.trim();
                });
                const hasVal = Object.keys(obj).some(function (k) { return obj[k] !== ''; });
                if (hasVal) rows.push(obj);
            });
            if (rows.length) data[key] = rows;
        });
        // 关联需求单
        Object.keys(this._dynReqLinkValues || {}).forEach(k => {
            if (this._dynReqLinkValues[k]) data[k] = this._dynReqLinkValues[k];
        });
        // 发票字段
        (this._currentSchema || []).forEach(f => {
            if (f.type === 'invoice') {
                const arr = (this._invoiceValues || {})[f.key];
                if (Array.isArray(arr) && arr.length) data[f.key] = arr;
            }
        });
        return data;
    },

    _onDynAttachmentChange(e, key) {
        const files = e.target.files;
        if (!files || !files.length) return;
        const self = this;
        Array.from(files).forEach(file => {
            const fd = new FormData();
            fd.append('file', file);
            // multipart 上传不能手动设置 Content-Type（浏览器自动带 boundary），只传 Authorization
            fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: fd
            }).then(r => r.json()).then(d => {
                if (d.url) {
                    if (!self._dynAttachmentValues[key]) self._dynAttachmentValues[key] = [];
                    self._dynAttachmentValues[key].push({url: d.url, name: d.name || file.name});
                    self._renderDynAttachList(key);
                } else {
                    self.showError('附件上传失败');
                }
            }).catch(() => self.showError('附件上传失败'));
        });
        e.target.value = '';
    },

    _renderDynAttachList(key) {
        const container = document.getElementById('dynAttach_' + key);
        if (!container) return;
        const items = this._dynAttachmentValues[key] || [];
        const self = this;
        container.innerHTML = items.map((a, i) => {
            const name = a.name || '';
            const url = a.url || '';
            const isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            const isVideo = name.match(/\.(mp4|avi|mov|webm|mkv)$/i);
            // 缩略图/图标：图片可点击预览，文档/文件可点击保存到网盘并打开/下载
            let thumbHtml;
            if (isImg) {
                thumbHtml = '<img src="' + url + '" style="width:48px;height:48px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #dcdfe6;cursor:pointer;" title="' + self._escape(name) + '">';
            } else if (isVideo) {
                thumbHtml = '<video src="' + url + '" controls preload="metadata" style="width:130px;height:72px;border-radius:6px;object-fit:cover;flex-shrink:0;"></video>';
            } else {
                thumbHtml = '<div style="width:40px;height:40px;border-radius:6px;background:var(--bg-secondary,#e8ecf1);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ' + self._getFileIcon(name) + '" style="font-size:16px;color:#409eff;"></i></div>';
            }
            const clickWrap = isVideo
                ? thumbHtml
                : '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + self._escape(name) + '" onclick="approvalApp._handleAttach(this)" title="' + self._escape(name) + '">' + thumbHtml + '</a>';
            const downloadIcon = (!isImg && !isVideo)
                ? '<a href="' + url + '" download="' + self._escape(name) + '" target="_blank" title="下载" style="color:#409eff;"><i class="fas fa-cloud-download-alt"></i></a>'
                : '';
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;margin-bottom:4px;flex-wrap:wrap;">'
                + clickWrap
                + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:50px;">' + self._escape(name) + '</span>'
                + downloadIcon
                + '<button onclick="approvalApp._removeDynAttachment(\'' + self._escape(key) + '\',' + i + ')" style="width:24px;height:24px;border:none;background:transparent;cursor:pointer;color:#909399;" title="移除"><i class="fas fa-times"></i></button>'
                + '</div>';
        }).join('') || '';
    },

    _removeDynAttachment(key, idx) {
        if (!this._dynAttachmentValues[key]) return;
        this._dynAttachmentValues[key].splice(idx, 1);
        this._renderDynAttachList(key);
    },

    // ===== 从我的网盘选择附件（复制到审批附件存储） =====
    async _copyOneCloudToAttachment(cloudId) {
        const r = await fetch(OA_API_URL + '/approval/attach-cloud/', {
            method: 'POST', headers: TokenManager.getHeaders(),
            body: JSON.stringify({cloud_id: cloudId})
        });
        if (!r.ok) { const e2 = await r.json().catch(function () { return {}; }); throw new Error(e2.error || '添加失败'); }
        return r.json();
    },
    pickCloudAttachments() {
        if (!window.CloudFilePicker) { this.showToast('网盘选择组件未加载，请刷新', true); return; }
        const self = this;
        CloudFilePicker.open({title: '从我的网盘选择附件', onPick: function (list) { self._addCloudAttachments(list); }});
    },
    async _addCloudAttachments(list) {
        if (!(list && list.length)) return;
        this._attachmentFiles = this._attachmentFiles || [];
        let added = 0;
        for (const it of list) {
            try {
                const item = await this._copyOneCloudToAttachment(it.cloud_id);
                this._attachmentFiles.push({url: item.url, name: item.name});
                added++;
            } catch (e) { this.showToast(e.message || '添加失败', true); break; }
        }
        if (added) { this._renderAttachments(); this.showToast('已添加 ' + added + ' 个文件', false); }
    },
    _pickDynCloudAttachments(key) {
        if (!window.CloudFilePicker) { this.showToast('网盘选择组件未加载，请刷新', true); return; }
        const self = this;
        CloudFilePicker.open({title: '从我的网盘选择附件', onPick: function (list) { self._addDynCloudAttachments(key, list); }});
    },
    async _addDynCloudAttachments(key, list) {
        if (!(list && list.length)) return;
        this._dynAttachmentValues = this._dynAttachmentValues || {};
        this._dynAttachmentValues[key] = this._dynAttachmentValues[key] || [];
        let added = 0;
        for (const it of list) {
            try {
                const item = await this._copyOneCloudToAttachment(it.cloud_id);
                this._dynAttachmentValues[key].push({url: item.url, name: item.name});
                added++;
            } catch (e) { this.showToast(e.message || '添加失败', true); break; }
        }
        if (added) { this._renderDynAttachList(key); this.showToast('已添加 ' + added + ' 个文件', false); }
    },

    _loadDynDeptOptions(key, selectedId, scope) {
        const sel = document.getElementById('dynDept_' + key);
        if (!sel) return;
        // 分公司字段 → scope=company（后端返回当前企业全部公司型部门，普通用户可见）；
        // 其余部门字段 → scope=all（自定义类型「部门」，展示所属企业部门并按角色限定）
        const scopeParam = scope === 'company' ? 'company' : 'all';
        this.apiGet(OA_API_URL + '/approval/org_departments/?scope=' + scopeParam).then(data => {
            let depts = data.results || [];
            // scope=company：后端已限定公司型部门，此处再过滤保证一致
            if (scope === 'company') {
                depts = depts.filter(function (d) { return d.department_type === 'company'; });
            }
            sel.innerHTML = this._buildDepartmentTreeHtml(depts, selectedId);
        }).catch(() => {
        });
    },

    _onDynUserSearch(e, key) {
        const kw = e.target.value.trim();
        const res = document.getElementById('dynUserRes_' + key);
        if (!res) return;
        if (!kw) {
            res.style.display = 'none';
            return;
        }
        this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(kw)).then(data => {
            const users = data.results || [];
            const selectedIds = {};
            (this._dynUserValues[key] || []).forEach(u => selectedIds[u.id] = true);
            res.innerHTML = users.length ? users.map(u => {
                const cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addDynUser(\'' + this._escape(key) + '\',' + u.id + ',\'' + this._escape(u.name) + '\')">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">'
                    + '<span style="flex:1;font-size:13px;">' + this._escape(u.name) + '</span>'
                    + (u.position ? '<span style="font-size:11px;color:#909399;">' + this._escape(u.position) + '</span>' : '')
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            res.style.display = 'block';
        }).catch(() => {
        });
    },

    _addDynUser(key, id, name) {
        if (!this._dynUserValues[key]) this._dynUserValues[key] = [];
        if (this._dynUserValues[key].some(u => u.id === id)) return;
        this._dynUserValues[key].push({id: id, name: name});
        this._renderDynUserTags(key);
        const res = document.getElementById('dynUserRes_' + key);
        if (res) res.style.display = 'none';
    },

    _removeDynUser(key, idx) {
        if (!this._dynUserValues[key]) return;
        this._dynUserValues[key].splice(idx, 1);
        this._renderDynUserTags(key);
    },

    _renderDynUserTags(key) {
        const container = document.getElementById('dynUserTags_' + key);
        if (!container) return;
        const items = this._dynUserValues[key] || [];
        container.innerHTML = items.map((u, i) => {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:14px;font-size:12px;margin:2px;">'
                + '<i class="fas fa-user" style="font-size:10px;color:#409eff;"></i>'
                + '<span>' + this._escape(u.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;" onclick="approvalApp._removeDynUser(\'' + this._escape(key) + '\',' + i + ')"></i>'
                + '</span>';
        }).join('') || '';
    },

    _renderDynamicDetail(form_data, schema, display) {
        if (!schema || !schema.length) return '';
        display = display || {};
        const self = this;
        let html = '<div class="detail-item full-width" style="border:1px solid #e8d5f5;border-radius:8px;padding:12px;background:#faf7ff;margin-top:8px;">'
            + '<div style="font-size:14px;font-weight:600;color:#9b59b6;margin-bottom:8px;border-bottom:1px solid #e8d5f5;padding-bottom:6px;"><i class="fas fa-clipboard-list"></i> 表单详情</div>'
            + '<div class="dyn-detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">';
        this._ensureInvoiceStyles();
        // 这些字段的内容本身很宽（发票卡片 / 附件 / 明细表）→ 必须整行显示，
        // 否则会被两列布局挤成窄条，手机上更难看
        const WIDE_FIELD_TYPES = ['invoice', 'attachment', 'struct_table'];
        schema.forEach(f => {
            const key = f.key;
            const wide = WIDE_FIELD_TYPES.indexOf(f.type) >= 0;
            const rowOpen = '<div class="dyn-detail-row"' + (wide ? ' style="grid-column:1/-1;"' : '') + '>';
            // 后端已解析好的可读值（如部门名称）优先
            if (display[key] !== undefined && display[key] !== null && display[key] !== '') {
                html += rowOpen + '<strong>' + self._escape(f.label || key) + '：</strong>' + self._escape(String(display[key])) + '</div>';
                return;
            }
            let v = (form_data || {})[key];
            if (v === undefined || v === null || v === '') v = '-';
            if (f.type === 'attachment' && Array.isArray(v)) {
                // 与内置附件一致：图片预览、视频播放、文档/文件点击保存到网盘并打开或下载
                v = v.map(function (a) {
                    var url = a.url || a;
                    var name = a.name || url.split('/').pop() || '';
                    var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    var isVideo = name.match(/\.(mp4|avi|mov|webm|mkv)$/i);
                    var icon = self._getFileIcon(name);
                    var inner;
                    if (isImg) {
                        inner = '<img src="' + url + '" style="width:48px;height:48px;border-radius:4px;object-fit:cover;border:1px solid #dcdfe6;cursor:pointer;" title="' + self._escape(name) + '">';
                    } else if (isVideo) {
                        inner = '<video src="' + url + '" controls preload="metadata" style="width:140px;height:80px;border-radius:4px;"></video>';
                    } else {
                        inner = '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:#f0f9eb;border-radius:4px;font-size:12px;color:#409eff;"><i class="fas ' + icon + '"></i>' + self._escape(name) + '</span>';
                    }
                    var clickWrap = isVideo ? inner
                        : '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + self._escape(name) + '" onclick="approvalApp._handleAttach(this)" title="' + self._escape(name) + '">' + inner + '</a>';
                    var downloadIcon = (!isImg && !isVideo)
                        ? '<a href="' + url + '" download="' + self._escape(name) + '" target="_blank" title="下载" style="color:#409eff;margin-left:2px;"><i class="fas fa-cloud-download-alt"></i></a>'
                        : '';
                    return '<span style="display:inline-flex;align-items:center;gap:4px;margin:2px;vertical-align:middle;">' + clickWrap + downloadIcon + '</span>';
                }).join('') || '-';
            } else if (f.type === 'invoice' && Array.isArray(v) && v.length) {
                // 发票：只读卡片（审批人/超管可二维码扫描、发票验真、放大预览）
                var _invKey = '__dyn_inv_' + f.key + '_' + (self._invDetailSeq = (self._invDetailSeq || 0) + 1);
                self._setInvoiceList(_invKey, v);
                var _canOp = self._isInvoiceOperator(self._detailApproval);
                v = '<div class="inv-detail-wrap">' + v.map(function (inv, i) {
                    return self._invoiceCardHtml(_invKey, inv, i, { readonly: true, canOperate: _canOp });
                }).join('') + '</div>';
            } else if (f.type === 'user' && Array.isArray(v)) {
                v = v.map(u => self._escape(u.name || u)).join('、') || '-';
            } else if ((f.type === 'select' || f.type === 'radio') && typeof v === 'string') {
                const opt = (f.options || []).find(o => String((typeof o === 'object' ? o.value : o)) === String(v));
                if (opt) v = typeof opt === 'object' ? (opt.label || opt.value) : opt;
            } else if (f.type === 'checkbox' && Array.isArray(v)) {
                v = v.map(x => {
                    const o = (f.options || []).find(oo => String((typeof oo === 'object' ? oo.value : oo)) === String(x));
                    return o ? (typeof o === 'object' ? (o.label || o.value) : o) : x;
                }).join('、') || '-';
            } else if (f.type === 'amount' && f.unit) {
                // 金额：带币种符号（¥/$/€/£/HK$…）
                const sym = self._unitSymbol(f.unit);
                v = (sym ? sym : '') + v;
            } else if (f.type === 'number' && f.unit) {
                // 数字：带单位后缀（个/天/小时/件/套…）
                const lb = self._unitLabel(f.unit);
                v = v + (lb ? ' ' + lb : '');
            } else if (f.type === 'expense_type' && typeof v === 'string') {
                // 费用类型：key → 中文名（后端 form_data_display 已解析时走上方 display 分支）
                const expMap = {travel: '差旅费', office: '办公费', meals: '业务招待费', transport: '交通费', communication: '通讯费', equipment: '设备采购', training: '培训费', welfare: '员工福利费', professional_service: '专业服务费', advertising: '广告宣传费', other_expense: '其他'};
                v = expMap[v] || v;
            } else if (f.type === 'struct_table' && Array.isArray(v)) {
                // 结构化明细：渲染为表格
                const cols = f.columns || [];
                if (cols.length) {
                    let tbl = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">'
                        + '<tr>' + cols.map(function (c) { return '<th style="border:1px solid #dcdfe6;padding:4px 6px;background:#f5f7fa;">' + self._escape(c.label || c.key) + '</th>'; }).join('') + '</tr>';
                    v.forEach(function (row) {
                        if (typeof row !== 'object') return;
                        tbl += '<tr>' + cols.map(function (c) {
                            let cv = row[c.key];
                            if (c.type === 'amount' && cv !== undefined && cv !== null && cv !== '') cv = Number(cv).toFixed(2);
                            if (cv === undefined || cv === null) cv = '-';
                            return '<td style="border:1px solid #dcdfe6;padding:4px 6px;">' + self._escape(String(cv)) + '</td>';
                        }).join('') + '</tr>';
                    });
                    tbl += '</table>';
                    v = tbl;
                } else {
                    v = JSON.stringify(v);
                }
            } else if (f.type === 'link_requisition' && typeof v === 'object' && v) {
                v = self._escape(v.doc_no || ('关联需求单 #' + (v.requirement_id || '')));
                if (v.branch_dept) v += '（' + self._escape(v.branch_dept) + '）';
            } else if (f.type === 'link_requisition') {
                v = String(v || '-');
            } else if (f.type === 'payment_method' && typeof v === 'object' && v && v.type) {
                // 收款方式（兜底：form_data 中仍含该字段时展示）
                var _pm = v;
                var _parts = [_pm.type === 'custom' ? '自定义收款方式' : '默认收款账号'];
                if (_pm.payee_name) _parts.push('收款人：' + _pm.payee_name);
                if (_pm.bank_card) _parts.push('银行卡：' + _pm.bank_card + (_pm.bank_name ? '（' + _pm.bank_name + '）' : '') + (_pm.bank_address ? ' ' + _pm.bank_address : ''));
                if (_pm.alipay_account) _parts.push('支付宝：' + _pm.alipay_account);
                if (_pm.wechat_account) _parts.push('微信：' + _pm.wechat_account);
                v = _parts.map(function (p) { return self._escape(p); }).join('；');
            } else if (typeof v === 'object') {
                v = JSON.stringify(v);
            }
            html += rowOpen + '<strong>' + self._escape(f.label || key) + '：</strong>' + v + '</div>';
        });
        html += '</div></div>';
        return html;
    },

    _toggleStaffingRemark() {
        var val = document.getElementById('recruitStaffingType').value;
        var row = document.getElementById('recruitStaffingRemarkRow');
        if (row) row.style.display = val === 'supplement' ? 'block' : 'none';
    },

    // ===== 收款方式（报销/采购/自定义类型） =====

    // 显示/隐藏收款方式区块：报销/采购自动显示；自定义类型仅当 schema 配置了「收款方式」字段时显示
    _togglePaymentSection(type) {
        const section = document.getElementById('paymentMethodSection');
        if (!section) return;
        this._paymentMethodFieldKey = null;
        let need = (type === 'expense' || type === 'purchase');
        if (!need && !this._isBuiltinType(type)) {
            const t = this._getType(type);
            const pmField = (t && t.form_schema || []).find(function (f) { return f.type === 'payment_method'; });
            if (pmField) {
                need = true;
                this._paymentMethodFieldKey = pmField.key;
            }
        }
        section.style.display = need ? 'block' : 'none';
        if (!need) return;
        this._loadApprovalPaymentInfo();
        this._onPaymentMethodTypeChange();
    },

    _onPaymentMethodTypeChange() {
        const t = document.querySelector('input[name="paymentMethodType"]:checked');
        const v = t ? t.value : 'none';
        const isCustom = v === 'custom';
        const dWrap = document.getElementById('paymentMethodDefaultWrap');
        const cWrap = document.getElementById('paymentMethodCustomWrap');
        if (dWrap) dWrap.style.display = (v === 'default') ? 'block' : 'none';
        if (cWrap) cWrap.style.display = isCustom ? 'block' : 'none';
        // 切换到自定义时加载已保存的收款方式（记忆功能）
        if (isCustom) this._loadCustomPaymentMethods();
    },

    // 加载用户默认收款账号
    async _loadApprovalPaymentInfo() {
        const infoEl = document.getElementById('paymentMethodDefaultInfo');
        const emptyEl = document.getElementById('paymentMethodDefaultEmpty');
        if (!infoEl) return;
        infoEl.textContent = '加载中...';
        try {
            const d = await this.apiGet('/api/oa/subsidy/payment-info/');
            const parts = [];
            if (d.payee_name) parts.push('收款人：' + d.payee_name);
            if (d.bank_card) parts.push('银行卡：' + d.bank_card);
            if (d.bank_name) parts.push('开户行：' + d.bank_name);
            if (d.bank_address) parts.push('开户行地址：' + d.bank_address);
            if (d.alipay_account) parts.push('支付宝：' + d.alipay_account);
            if (d.wechat_account) parts.push('微信：' + d.wechat_account);
            const has = !!d.payee_name && !!(d.bank_card || d.alipay_account || d.wechat_account);
            if (emptyEl) emptyEl.style.display = has ? 'none' : 'flex';
            infoEl.style.color = has ? '#606266' : '#f56c6c';
            infoEl.textContent = has ? (parts.join('；') || '已设置') : '尚未设置收款账号，请点击下方按钮完善';
        } catch (e) {
            if (emptyEl) emptyEl.style.display = 'flex';
            infoEl.style.color = '#f56c6c';
            infoEl.textContent = '未获取到收款账号';
        }
    },

    openApprovalPaymentModal() {
        const modal = document.getElementById('approvalPaymentModal');
        if (!modal) return;
        const self = this;
        this.apiGet('/api/oa/subsidy/payment-info/').then(function (d) {
            document.getElementById('apPayeeName').value = d.payee_name || '';
            document.getElementById('apBankCard').value = d.bank_card || '';
            document.getElementById('apBankName').value = d.bank_name || '';
            document.getElementById('apBankAddress').value = d.bank_address || '';
            document.getElementById('apAlipayAccount').value = d.alipay_account || '';
            document.getElementById('apWechatAccount').value = d.wechat_account || '';
        }).catch(function () {});
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    },

    _closeApprovalPaymentModal() {
        const modal = document.getElementById('approvalPaymentModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function () { modal.style.display = 'none'; }, 200);
        }
    },

    async _saveApprovalPaymentInfo() {
        const payee = document.getElementById('apPayeeName').value.trim();
        const bank = document.getElementById('apBankCard').value.trim();
        const alipay = document.getElementById('apAlipayAccount').value.trim();
        const wechat = document.getElementById('apWechatAccount').value.trim();
        if (!payee) { this.showAlert('提示', '请填写收款人真实姓名'); return; }
        if (!bank && !alipay && !wechat) { this.showAlert('提示', '请至少填写一种收款方式（银行卡/支付宝/微信）'); return; }
        try {
            await this.apiPost('/api/oa/subsidy/payment-info/', {
                payee_name: payee, bank_card: bank,
                bank_name: document.getElementById('apBankName').value.trim(),
                bank_address: document.getElementById('apBankAddress').value.trim(),
                alipay_account: alipay, wechat_account: wechat
            });
            this._closeApprovalPaymentModal();
            this.showToast('收款账号已保存', false);
            this._loadApprovalPaymentInfo();
        } catch (e) {
            this.showAlert('保存失败', e.message);
        }
    },

    // 收集收款方式提交数据（未选择则返回空对象，不要求必须填写）
    _collectPaymentMethod() {
        const t = document.querySelector('input[name="paymentMethodType"]:checked');
        const type = t ? t.value : 'none';
        if (type === 'custom') {
            return {
                type: 'custom',
                payee_name: document.getElementById('pmCustomPayee').value.trim(),
                bank_card: document.getElementById('pmCustomBank').value.trim(),
                bank_name: document.getElementById('pmCustomBankName').value.trim(),
                bank_address: document.getElementById('pmCustomBankAddress').value.trim(),
                alipay_account: document.getElementById('pmCustomAlipay').value.trim(),
                wechat_account: document.getElementById('pmCustomWechat').value.trim()
            };
        }
        if (type === 'default') {
            return {type: 'default'};
        }
        return {};
    },

    // 加载用户已保存的自定义收款方式（记忆功能），含开户行展示与删除管理
    async _loadCustomPaymentMethods() {
        const sel = document.getElementById('pmCustomSaved');
        if (!sel) return;
        try {
            const data = await this.apiGet(OA_API_URL + '/approval/custom-payment-methods/');
            this._customPmList = data.results || [];
            const list = this._customPmList;
            const current = sel.value;
            sel.innerHTML = '<option value="">— 新建收款方式 —</option>';
            list.forEach(function (m) {
                const label = this._customPmLabel(m);
                const opt = document.createElement('option');
                opt.value = String(m.id);
                opt.setAttribute('data-pm', JSON.stringify(m));
                opt.textContent = label;
                sel.appendChild(opt);
            }, this);
            if (current && Array.prototype.some.call(sel.options, function (o) { return o.value === current; })) {
                sel.value = current;
            } else {
                sel.value = '';
            }
            this._renderCustomPmList();
        } catch (e) {
            console.warn('加载已保存收款方式失败', e);
        }
    },

    // 已保存收款方式的展示文案（收款人 + 开户行 + 银行卡/支付宝/微信）
    _customPmLabel(m) {
        if (!m) return '';
        const parts = [m.payee_name || '收款人'];
        if (m.bank_name) parts.push('开户行：' + m.bank_name);
        if (m.bank_card) parts.push('银行卡：' + m.bank_card);
        if (m.alipay_account) parts.push('支付宝：' + m.alipay_account);
        if (m.wechat_account) parts.push('微信：' + m.wechat_account);
        return parts.join('　');
    },

    // 渲染已保存收款方式的管理列表（每项可删除）
    _renderCustomPmList() {
        const wrap = document.getElementById('pmCustomSavedList');
        if (!wrap) return;
        const list = this._customPmList || [];
        if (!list.length) {
            wrap.innerHTML = '';
            return;
        }
        const self = this;
        wrap.innerHTML = list.map(function (m) {
            return '<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:#fff;border:1px solid var(--border-color,#dcdfe6);border-radius:6px;font-size:12px;color:#606266;">'
                + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + self._escape(self._customPmLabel(m)) + '">' + self._escape(self._customPmLabel(m)) + '</span>'
                + '<button type="button" title="删除该收款方式" onclick="approvalApp._deleteCustomPaymentMethod(' + m.id + ', this)" style="border:none;background:none;color:#f56c6c;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;"><i class="fas fa-times"></i></button>'
                + '</div>';
        }).join('');
    },

    // 删除一条已保存的自定义收款方式
    async _deleteCustomPaymentMethod(id, btn) {
        const confirmed = await this.showConfirmDialog('删除收款方式', '确定删除这条已保存的收款方式吗？', 'danger');
        if (!confirmed) return;
        try {
            const resp = await fetch(OA_API_URL + '/approval/custom-payment-method/' + id + '/', {
                method: 'DELETE',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) throw new Error((await resp.json()).error || '删除失败');
            this.showToast('已删除', false);
            this._loadCustomPaymentMethods();
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    },

    // 选择已保存的收款方式时回填表单；选择“新建”则清空
    _onCustomSavedChange() {
        const sel = document.getElementById('pmCustomSaved');
        if (!sel) return;
        const opt = sel.options[sel.selectedIndex];
        if (!opt || !opt.value) {
            // 新建
            document.getElementById('pmCustomPayee').value = '';
            document.getElementById('pmCustomBank').value = '';
            document.getElementById('pmCustomBankName').value = '';
            document.getElementById('pmCustomBankAddress').value = '';
            document.getElementById('pmCustomAlipay').value = '';
            document.getElementById('pmCustomWechat').value = '';
            return;
        }
        try {
            const pm = JSON.parse(opt.getAttribute('data-pm') || '{}');
            document.getElementById('pmCustomPayee').value = pm.payee_name || '';
            document.getElementById('pmCustomBank').value = pm.bank_card || '';
            document.getElementById('pmCustomBankName').value = pm.bank_name || '';
            document.getElementById('pmCustomBankAddress').value = pm.bank_address || '';
            document.getElementById('pmCustomAlipay').value = pm.alipay_account || '';
            document.getElementById('pmCustomWechat').value = pm.wechat_account || '';
        } catch (e) {
            console.warn('回填收款方式失败', e);
        }
    },

    // 编辑回填：把已有收款方式加载到表单
    _fillPaymentMethod(pm) {
        if (!pm || typeof pm !== 'object') pm = {};
        const radios = document.querySelectorAll('input[name="paymentMethodType"]');
        let pmType = 'none';
        if (pm.type === 'custom') pmType = 'custom';
        else if (pm.type === 'default') pmType = 'default';
        for (let i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === pmType;
        document.getElementById('pmCustomPayee').value = pm.payee_name || '';
        document.getElementById('pmCustomBank').value = pm.bank_card || '';
        document.getElementById('pmCustomBankName').value = pm.bank_name || '';
        document.getElementById('pmCustomBankAddress').value = pm.bank_address || '';
        document.getElementById('pmCustomAlipay').value = pm.alipay_account || '';
        document.getElementById('pmCustomWechat').value = pm.wechat_account || '';
        this._onPaymentMethodTypeChange();
    },

    // ===== 采购物项 =====
    _addPurchaseItem(item) {
        item = item || {};
        var body = document.getElementById('purchaseItemsBody');
        if (!body) return;
        var row = document.createElement('tr');
        row.innerHTML = '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input pi-name" value="' + this._escape(item.name || '') + '" placeholder="商品名称" style="min-width:100px;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input type="number" class="form-input pi-qty" value="' + (item.qty || '') + '" min="0" step="1" oninput="approvalApp._recalcPurchaseTotal()" style="width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input type="number" class="form-input pi-price" value="' + (item.price || '') + '" min="0" step="0.01" oninput="approvalApp._recalcPurchaseTotal()" style="width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><span class="pi-total" style="color:#e6a23c;">0.00</span></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input pi-remark" value="' + this._escape(item.remark || '') + '" placeholder="备注" style="min-width:80px;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);text-align:center;"><button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removePurchaseItem(this)"><i class="fas fa-times"></i></button></td>';
        body.appendChild(row);
        this._recalcPurchaseTotal();
    },
    _removePurchaseItem(btn) {
        var tr = btn.closest('tr');
        if (tr) tr.remove();
        this._recalcPurchaseTotal();
    },
    _collectPurchaseItems() {
        var items = [];
        document.querySelectorAll('#purchaseItemsBody tr').forEach(function (tr) {
            var name = (tr.querySelector('.pi-name') || {}).value || '';
            var qty = parseFloat((tr.querySelector('.pi-qty') || {}).value) || 0;
            var price = parseFloat((tr.querySelector('.pi-price') || {}).value) || 0;
            var remark = (tr.querySelector('.pi-remark') || {}).value || '';
            if (name || qty || price) items.push({name: name, qty: qty, price: price, total: +((qty * price).toFixed(2)), remark: remark});
        });
        return items;
    },
    _recalcPurchaseTotal() {
        var total = 0;
        document.querySelectorAll('#purchaseItemsBody tr').forEach(function (tr) {
            var qty = parseFloat((tr.querySelector('.pi-qty') || {}).value) || 0;
            var price = parseFloat((tr.querySelector('.pi-price') || {}).value) || 0;
            var t = qty * price;
            var totalEl = tr.querySelector('.pi-total');
            if (totalEl) totalEl.textContent = t.toFixed(2);
            total += t;
        });
        var el = document.getElementById('purchaseTotal');
        if (el) el.textContent = total.toFixed(2);
        var amount = document.getElementById('newAmount');
        if (amount) amount.value = total ? total.toFixed(2) : '';
        // 明细变动使总金额变化，需刷新审批链以联动阈值审批
        this._debouncedChainRefresh();
        return total;
    },

    // ===== 报销项目 =====
    _addExpenseItem(item) {
        item = item || {};
        var body = document.getElementById('expenseItemsBody');
        if (!body) return;
        var row = document.createElement('tr');
        row.innerHTML = '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input ei-name" value="' + this._escape(item.name || '') + '" placeholder="项目名称" style="min-width:100px;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input type="number" class="form-input ei-amount" value="' + (item.amount || '') + '" min="0" step="0.01" oninput="approvalApp._recalcExpenseTotal()" style="width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);"><input class="form-input ei-remark" value="' + this._escape(item.remark || '') + '" placeholder="备注" style="min-width:80px;width:100%;"></td>'
            + '<td style="padding:4px;border:1px solid var(--border-color,#dcdfe6);text-align:center;"><button type="button" class="btn btn-sm btn-danger" onclick="approvalApp._removeExpenseItem(this)"><i class="fas fa-times"></i></button></td>';
        body.appendChild(row);
        this._recalcExpenseTotal();
    },
    _removeExpenseItem(btn) {
        var tr = btn.closest('tr');
        if (tr) tr.remove();
        this._recalcExpenseTotal();
    },
    _collectExpenseItems() {
        var items = [];
        document.querySelectorAll('#expenseItemsBody tr').forEach(function (tr) {
            var name = (tr.querySelector('.ei-name') || {}).value || '';
            var amount = parseFloat((tr.querySelector('.ei-amount') || {}).value) || 0;
            var remark = (tr.querySelector('.ei-remark') || {}).value || '';
            if (name || amount) items.push({name: name, amount: amount, remark: remark});
        });
        return items;
    },
    _recalcExpenseTotal() {
        var total = 0;
        document.querySelectorAll('#expenseItemsBody tr').forEach(function (tr) {
            total += parseFloat((tr.querySelector('.ei-amount') || {}).value) || 0;
        });
        var el = document.getElementById('expenseTotal');
        if (el) el.textContent = total.toFixed(2);
        var amount = document.getElementById('newAmount');
        if (amount) amount.value = total ? total.toFixed(2) : '';
        // 明细变动使总金额变化，需刷新审批链以联动阈值审批
        this._debouncedChainRefresh();
        return total;
    },

    // ===== 出差/请假 =====
    _updateTripDuration() {
        var days = document.getElementById('tripDays') ? document.getElementById('tripDays').value : '';
        var dur = document.getElementById('newDuration');
        if (dur && days) dur.value = days;
    },
    _collectLeaveType() {
        var checked = document.querySelector('input[name="leaveType"]:checked');
        return checked ? checked.value : '';
    },
    _collectTripData() {
        return {
            reason: document.getElementById('tripReason') ? document.getElementById('tripReason').value : '',
            place: document.getElementById('tripPlace') ? document.getElementById('tripPlace').value : '',
            days: document.getElementById('tripDays') ? document.getElementById('tripDays').value : '',
            amount: document.getElementById('tripAmount') ? document.getElementById('tripAmount').value : '',
            remark: document.getElementById('tripRemark') ? document.getElementById('tripRemark').value : ''
        };
    },
    _clearTypeRows() {
        var pb = document.getElementById('purchaseItemsBody'); if (pb) pb.innerHTML = '';
        var eb = document.getElementById('expenseItemsBody'); if (eb) eb.innerHTML = '';
        document.querySelectorAll('input[name="leaveType"]').forEach(function (r) { r.checked = false; });
        ['tripReason', 'tripPlace', 'tripDays', 'tripAmount', 'tripRemark'].forEach(function (id) {
            var el = document.getElementById(id); if (el) el.value = '';
        });
    },
    _loadTypeDataIntoForm(d) {
        if (d.purchase_items && d.purchase_items.length) {
            var self = this;
            d.purchase_items.forEach(function (it) { self._addPurchaseItem(it); });
        }
        if (d.expense_items && d.expense_items.length) {
            var self2 = this;
            d.expense_items.forEach(function (it) { self2._addExpenseItem(it); });
        }
        if (d.leave_type) {
            var radio = document.querySelector('input[name="leaveType"][value="' + this._escape(d.leave_type) + '"]');
            if (radio) radio.checked = true;
        }
        if (d.trip_data && typeof d.trip_data === 'object') {
            if (document.getElementById('tripReason')) document.getElementById('tripReason').value = d.trip_data.reason || '';
            if (document.getElementById('tripPlace')) document.getElementById('tripPlace').value = d.trip_data.place || '';
            if (document.getElementById('tripDays')) document.getElementById('tripDays').value = d.trip_data.days || '';
            if (document.getElementById('tripAmount')) document.getElementById('tripAmount').value = d.trip_data.amount || '';
            if (document.getElementById('tripRemark')) document.getElementById('tripRemark').value = d.trip_data.remark || '';
        }
    },

    // 明细/动态字段金额变化后防抖刷新审批链（联动阈值审批）
    _debouncedChainRefresh() {
        if (this._chainRefreshTimer) clearTimeout(this._chainRefreshTimer);
        this._chainRefreshTimer = setTimeout(function () {
            approvalApp._loadApprovalChainPreview();
        }, 300);
    },

    // 自定义类型动态数字/金额字段输入时刷新审批链（联动阈值审批）
    _onDynNumericChange() {
        this._debouncedChainRefresh();
    },

    async _loadApprovalChainPreview() {
        var container = document.getElementById('approverNodeList');
        if (!container) return;
        // Request sequencing to prevent stale responses from overwriting newer ones
        var seq = ++this._chainReqSeq;
        var deptId = document.getElementById('newDepartmentSelect') ? document.getElementById('newDepartmentSelect').value : '';
        var apprType = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 12px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;"><i class="fas fa-spinner fa-spin" style="margin-right:4px;"></i> 加载审批链...</div>';
        var url = OA_API_URL + '/approval/approval_chain/';
        var params = [];
        if (deptId) params.push('department_id=' + deptId);
        if (apprType) params.push('approval_type=' + apprType);
        // Pass threshold values from form fields for chain preview
        var dur = document.getElementById('newDuration') ? document.getElementById('newDuration').value : '';
        if (dur) params.push('duration=' + dur);
        var amt = document.getElementById('newAmount') ? document.getElementById('newAmount').value : '';
        if (amt) params.push('amount=' + amt);
        var hc = document.getElementById('recruitHeadcount') ? document.getElementById('recruitHeadcount').value : '';
        if (hc) params.push('headcount=' + hc);
        // 自定义类型 / 带表单内置类型：传递动态表单数字字段值用于阈值预览
        if (!this._isBuiltinType(apprType) || this._isDynamicSchemaType(apprType)) {
            var fd = this._collectDynamicFormData();
            var numeric = {};
            Object.keys(fd).forEach(function (k) {
                var v = fd[k];
                if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(v))) {
                    numeric[k] = Number(v);
                }
            });
            if (Object.keys(numeric).length) {
                params.push('form_data=' + encodeURIComponent(JSON.stringify(numeric)));
            }
        }
        if (params.length) url += '?' + params.join('&');
        try {
            var data = await this.apiGet(url);
            // Ignore stale responses from earlier requests
            if (seq !== this._chainReqSeq) return;
            var chain = data.results || [];
            var departments = data.departments || {};
            // Store approver nodes from chain preview (converts API format to backend format)
            this._approverNodes = chain.map(function (a) {
                return {
                    type: a.type || 'user',
                    id: a.id,
                    label: a.label,
                    user_position: a.user_position || '',
                    is_final_approver: !!a.is_final_approver
                };
            });
            this._approverNodesReady = true;
            var self = this;
            if (chain.length) {
                var html = '<div style="margin-bottom:6px;font-size:12px;color:var(--text-light,#909399);display:flex;align-items:center;gap:4px;">'
                    + '<i class="fas fa-sitemap" style="color:#67c23a;"></i> 自动审批链'
                    + (departments.selected ? ' · ' + self._escape(departments.selected) : '')
                    + (departments.final ? ' → ' + self._escape(departments.final) : '')
                    + '</div>';
                var currentLevel = 0;
                chain.forEach(function (a, i) {
                    var arrow = i < chain.length - 1 ? ' <span style="color:var(--text-light,#c0c4cc);font-size:11px;"><i class="fas fa-arrow-down"></i></span>' : '';
                    var levelLabel = a.level_label || ('第' + (a.level || (i + 1)) + '级');
                    var isFinal = !!a.is_final_approver;
                    var nodeBg = isFinal ? '#f3e8ff' : '#f0f9eb';
                    var nodeBorder = isFinal ? '#9b59b6' : '#67c23a';
                    var nodeIcon = isFinal ? 'fa-user-shield' : 'fa-user-check';
                    var nodeColor = isFinal ? '#9b59b6' : '#67c23a';
                    var srcLabel = isFinal ? (a.final_approver_source_label || '') : '';
                    html += '<div class="approver-node-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:' + nodeBg + ';border-radius:6px;margin-bottom:4px;border-left:3px solid ' + nodeBorder + ';">'
                        + '<i class="fas ' + nodeIcon + '" style="color:' + nodeColor + ';font-size:13px;"></i>'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(a.label) + (a.user_position ? ' <span style="font-size:11px;color:#909399;">(' + self._escape(a.user_position) + ')</span>' : '') + '</span>'
                        + (srcLabel ? '<span style="font-size:10px;color:#9b59b6;background:#fff;border:1px solid #e8d5f5;padding:2px 8px;border-radius:4px;margin-right:4px;" title="最终审批人配置来源">' + self._escape(srcLabel) + '</span>' : '')
                        + '<span style="font-size:11px;color:' + nodeColor + ';background:#fff;padding:2px 8px;border-radius:4px;">' + levelLabel + '</span>'
                        + arrow + '</div>';
                });
                container.innerHTML = html;
            } else {
                // No chain found — let backend auto-determine
                this._approverNodes = [];
                this._approverNodesReady = false;
                if (deptId) {
                    container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 12px;background:#fff3e0;border-radius:6px;border-left:3px solid #e6a23c;">'
                        + '<i class="fas fa-info-circle" style="color:#e6a23c;margin-right:4px;"></i>'
                        + '所选部门暂无负责人，审批将自动分配给企业管理员</div>';
                } else {
                    var msg = '<i class="fas fa-info-circle" style="color:var(--primary-color,#409eff);margin-right:4px;"></i>请选择所属部门以生成审批链';
                    if (departments && departments.final) {
                        msg += '<div style="margin-top:6px;font-size:12px;color:#67c23a;"><i class="fas fa-building" style="margin-right:4px;"></i>最终审批部门：' + self._escape(departments.final) + '</div>';
                    }
                    container.innerHTML = '<div style="color:var(--text-light,#909399);font-size:13px;padding:8px 12px;">' + msg + '</div>';
                }
            }
        } catch (e) {
            if (seq === this._chainReqSeq) {
                this._approverNodes = [];
                this._approverNodesReady = false;
                container.innerHTML = '<div style="color:#f56c6c;font-size:13px;padding:8px 12px;"><i class="fas fa-exclamation-circle"></i> 加载审批链失败</div>';
            }
        }
    },

    async _loadDepartmentTree(selectedId) {
        var sel = document.getElementById('newDepartmentSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">加载中...</option>';
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/org_departments/');
            if (!data || !data.results || !data.results.length) {
                this._noDeptOptions(sel);
                return;
            }
            var depts = data.results;

            var tree = {};
            depts.forEach(function (d) {
                var pid = d.parent_id != null ? d.parent_id : 0;
                if (!tree[pid]) tree[pid] = [];
                tree[pid].push(d);
            });

            var html = '<option value="">请选择部门</option>';
            var walk = function (pid, depth) {
                var children = tree[pid] || [];
                children.forEach(function (d) {
                    var prefix = '';
                    for (var i = 0; i < depth; i++) prefix += '—— ';
                    html += '<option value="' + d.id + '">' + prefix + d.name + '</option>';
                    walk(d.id, depth + 1);
                });
            };
            walk(0, 0);
            // Fallback: if no roots at 0, find actual roots (parent_id not matching any id)
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
                    html = '<option value="">请选择部门</option>';
                    var renderFlat = function (items, depth) {
                        var prefix = '';
                        for (var i = 0; i < depth; i++) prefix += '—— ';
                        items.forEach(function (d) {
                            html += '<option value="' + d.id + '">' + prefix + d.name + '</option>';
                            var kids = tree[d.id] || [];
                            renderFlat(kids, depth + 1);
                        });
                    };
                    renderFlat(actualRoots, 0);
                }
            }

            sel.innerHTML = html;
            sel.disabled = false;
            var hint = document.getElementById('newDeptHint');
            if (hint) hint.style.display = 'none';
            if (selectedId) {
                sel.value = selectedId;
                return;
            }
            // 使用后端返回的默认部门（主部门 → 无主部门时最低级部门）
            if (data.default_id != null) {
                for (var i = 0; i < sel.options.length; i++) {
                    if (parseInt(sel.options[i].value) === parseInt(data.default_id)) {
                        sel.value = String(data.default_id);
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Load dept tree failed:', e);
            this._noDeptOptions(sel);
        }
    },

    // 无可用部门时的提示
    _noDeptOptions(sel) {
        if (sel) {
            sel.innerHTML = '<option value="">无可用部门</option>';
            sel.disabled = true;
        }
        var hint = document.getElementById('newDeptHint');
        if (hint) hint.style.display = 'flex';
    },

    async _onDeptOrTypeChange() {
        // 部门或审批类型变化时：刷新审批链
        await this._loadApprovalChainPreview();
        // 审批类型变化时：同步CC配置（部门变化不影响CC）
        var currentType = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        if (currentType !== this._currentCcType) {
            this._currentCcType = currentType;
            await this._loadConfigDefaults();
        }
    },

    // 解析当前用户企业/审批类型匹配到的配置（优先子企业专属，再集团默认）
    async _resolveApprovalConfig(type) {
        if (!type) return null;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/dept-configs/');
            var configs = data.results || [];
            var activeTenant = null;
            try {
                activeTenant = JSON.parse(localStorage.getItem('active_tenant'));
            } catch (e) {
            }
            var userTenantId = activeTenant ? activeTenant.id : null;
            var cfg = null;
            var defaultCfg = null;
            configs.forEach(function (c) {
                if (c.approval_type !== type) return;
                if (c.sub_tenant && userTenantId && parseInt(c.sub_tenant) === parseInt(userTenantId)) {
                    cfg = c;
                } else if (!c.sub_tenant) {
                    defaultCfg = c;
                }
            });
            return cfg || defaultCfg;
        } catch (e) {
            console.error('解析审批配置失败:', e);
            return null;
        }
    },

    // 重新编辑时：将当前抄送项中匹配配置默认抄送人/部门的项标记为不可删除
    async _lockConfigCcDefaults() {
        var type = document.getElementById('newApprovalType') ? document.getElementById('newApprovalType').value : '';
        if (!type) return;
        var cfg = await this._resolveApprovalConfig(type);
        if (!cfg) return;
        var userIds = (cfg.cc_user_details || []).map(function (u) {
            return u.id;
        });
        var deptIds = (cfg.cc_department_details || []).map(function (d) {
            return d.id;
        });
        (this._ccUsers || []).forEach(function (u) {
            if (userIds.indexOf(u.id) !== -1) u.locked = true;
        });
        (this._ccDepartments || []).forEach(function (d) {
            if (deptIds.indexOf(d.id) !== -1) d.locked = true;
        });
        this._renderCcTags();
    },

    async _loadConfigDefaults() {
        var type = this._currentCcType;
        this._ccUsers = [];
        this._ccDepartments = [];
        if (!type) {
            this._renderCcTags();
            return;
        }
        try {
            var cfg = await this._resolveApprovalConfig(type);
            if (!cfg) {
                this._renderCcTags();
                return;
            }
            // 审批方式/审批模式：默认读取「该审批类型配置」（default_sign_type / default_approval_mode），可修改
            this._applyApprovalModeDefaults(cfg.default_sign_type, cfg.default_approval_mode);
            // 配置中的默认抄送人/部门自动带入，且不可删除（locked）
            if (cfg.cc_user_details && cfg.cc_user_details.length) {
                cfg.cc_user_details.forEach(function (u) {
                    if (!this._ccUsers) this._ccUsers = [];
                    if (!this._ccUsers.some(function (x) {
                        return x.id === u.id;
                    })) {
                        this._ccUsers.push({id: u.id, name: u.name, avatar: u.avatar || '', locked: true});
                    }
                }, this);
            }
            if (cfg.cc_department_details && cfg.cc_department_details.length) {
                cfg.cc_department_details.forEach(function (d) {
                    if (!this._ccDepartments) this._ccDepartments = [];
                    if (!this._ccDepartments.some(function (x) {
                        return x.id === d.id;
                    })) {
                        this._ccDepartments.push({id: d.id, name: d.name, locked: true});
                    }
                }, this);
            }
            this._renderCcTags();
        } catch (e) {
            console.error('加载审批配置默认值失败:', e);
        }
    },

    // 审批方式/审批模式：只读展示，取值来自「该审批类型配置」的 default_sign_type / default_approval_mode
    // （不可由用户选择；提交时仍读取该下拉的值 → 即配置值）
    _applyApprovalModeDefaults(signType, approvalMode) {
        var signTypeSel = document.getElementById('newSignType');
        if (signTypeSel) {
            signTypeSel.value = signType || 'countersign';
            signTypeSel.disabled = true;
        }
        var apprModeSel = document.getElementById('newApprovalMode');
        if (apprModeSel) {
            apprModeSel.value = approvalMode || 'sequential';
            apprModeSel.disabled = true;
        }
    },

    // ==================== 抄送人选择（用户+部门） ====================

    _switchCcTab(tab) {
        this._ccTab = tab;
        var ut = document.getElementById('ccTabUsers');
        var dt = document.getElementById('ccTabDepts');
        var activeBg = 'var(--primary-color,#409eff)';
        var inactiveBg = 'var(--bg-secondary,#f5f7fa)';
        if (ut) {
            ut.className = 'cc-tab' + (tab === 'users' ? ' active' : '');
            ut.style.cssText = 'flex:1;text-align:center;padding:5px 0;font-size:12px;cursor:pointer;'
                + 'background:' + (tab === 'users' ? activeBg : inactiveBg) + ';'
                + 'color:' + (tab === 'users' ? '#fff' : 'var(--text-secondary)');
        }
        if (dt) {
            dt.className = 'cc-tab' + (tab === 'departments' ? ' active' : '');
            dt.style.cssText = 'flex:1;text-align:center;padding:5px 0;font-size:12px;cursor:pointer;'
                + 'background:' + (tab === 'departments' ? activeBg : inactiveBg) + ';'
                + 'color:' + (tab === 'departments' ? '#fff' : 'var(--text-secondary)');
        }
        var input = document.getElementById('ccUserSearch');
        if (input) {
            input.value = '';
            input.placeholder = tab === 'users' ? '搜索企业成员...' : '搜索部门...';
        }
        document.getElementById('ccUserDropdown').style.display = 'none';
    },

    _initCcSearch() {
        var self = this;
        var input = document.getElementById('ccUserSearch');
        if (!input) return;
        input.oninput = function () {
            clearTimeout(self._ccSearchTimer);
            var val = input.value.trim();
            if (!val) {
                document.getElementById('ccUserDropdown').style.display = 'none';
                return;
            }
            self._ccSearchTimer = setTimeout(function () {
                if (self._ccTab === 'departments') {
                    self._searchCcDepartments(val);
                } else {
                    self._searchCcUsers(val);
                }
            }, 300);
        };
        input.onfocus = function () {
            if (input.value.trim()) {
                if (self._ccTab === 'departments') {
                    self._searchCcDepartments(input.value.trim());
                } else {
                    self._searchCcUsers(input.value.trim());
                }
            }
        };
        document.addEventListener('click', function (e) {
            var dd = document.getElementById('ccUserDropdown');
            if (dd && !e.target.closest('#ccUserSearch') && !e.target.closest('#ccUserDropdown') && !e.target.closest('.cc-tab')) {
                dd.style.display = 'none';
            }
        });
    },

    // ===== 关联审批选择器 =====
    _initRelApprovalSearch() {
        var self = this;
        var input = document.getElementById('relApprovalSearch');
        if (!input) return;
        input.oninput = function () {
            clearTimeout(self._relSearchTimer);
            var val = input.value.trim();
            if (!val) {
                document.getElementById('relApprovalDropdown').style.display = 'none';
                return;
            }
            self._relSearchTimer = setTimeout(function () {
                self._searchRelApprovals(val);
            }, 300);
        };
        // 聚焦时若未输入，默认加载当前用户的审批列表
        input.onfocus = function () {
            if (!input.value.trim()) {
                self._loadDefaultRelApprovals();
            } else {
                self._searchRelApprovals(input.value.trim());
            }
        };
        document.addEventListener('click', function (e) {
            var dd = document.getElementById('relApprovalDropdown');
            if (dd && !e.target.closest('#relApprovalSearch') && !e.target.closest('#relApprovalDropdown')) {
                dd.style.display = 'none';
            }
        });
    },

    async _loadDefaultRelApprovals() {
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/?page=1&page_size=10');
            this._renderRelApprovalDropdown(data.results || []);
        } catch (e) {
            var dd = document.getElementById('relApprovalDropdown');
            if (dd) dd.style.display = 'none';
        }
    },

    async _searchRelApprovals(keyword) {
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/?search=' + encodeURIComponent(keyword) + '&page_size=20');
            this._renderRelApprovalDropdown(data.results || []);
        } catch (e) {
            var dd = document.getElementById('relApprovalDropdown');
            if (dd) dd.style.display = 'none';
        }
    },

    _renderRelApprovalDropdown(list) {
        var dd = document.getElementById('relApprovalDropdown');
        if (!dd) return;
        if (!list.length) {
            dd.innerHTML = '<div style="padding:8px 12px;color:#909399;font-size:13px;">暂无审批可关联</div>';
            dd.style.display = 'block';
            return;
        }
        var self = this;
        this._relSearchResults = list || [];
        var selectedIds = {};
        (this._relatedApprovals || []).forEach(function (r) { selectedIds[r.id] = true; });
        var statusMap = {draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', deferred: '暂缓', processing: '办理中', cancelled: '已撤回'};
        dd.innerHTML = list.map(function (r) {
            if (selectedIds[r.id]) return '';
            var cls = 'cursor:pointer;';
            // 发起人 / 部门 / 职位
            var info = '';
            if (r.applicant_name) info += '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><i class="fas fa-user" style="color:#16a085;"></i> ' + self._escape(r.applicant_name) + '</span>';
            if (r.department_name) info += '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><i class="fas fa-building" style="color:#e6a23c;"></i> ' + self._escape(r.department_name) + '</span>';
            if (r.applicant_position) info += '<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;"><i class="fas fa-id-badge" style="color:#409eff;"></i> ' + self._escape(r.applicant_position) + '</span>';
            return '<div class="rel-approval-item" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addRelApproval(' + r.id + ')">'
                + '<i class="fas fa-file-alt" style="color:#16a085;"></i>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(r.title) + '</div>'
                + '<div style="font-size:11px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(r.approval_type_display || r.approval_type) + ' · ' + (statusMap[r.status] || r.status || '') + ' · 更新 ' + self._formatTime(r.updated_at || r.created_at) + '</div>'
                + (info ? '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:11px;color:#909399;margin-top:2px;">' + info + '</div>' : '')
                + '</div>'
                + '</div>';
        }).join('') || '<div style="padding:8px 12px;color:#909399;font-size:13px;">暂无审批可关联</div>';
        dd.style.display = 'block';
    },

    _addRelApproval(id) {
        if (!this._relatedApprovals) this._relatedApprovals = [];
        if (this._relatedApprovals.some(function (r) { return r.id === id; })) return;
        var src = (this._relSearchResults || []).filter(function (r) { return r.id === id; })[0] || {};
        this._relatedApprovals.push({
            id: id,
            title: src.title || '',
            type: src.approval_type_display || src.approval_type || '',
            status: src.status || '',
            applicant_name: src.applicant_name || '',
            department_name: src.department_name || '',
            applicant_position: src.applicant_position || ''
        });
        this._renderRelApprovalTags();
        document.getElementById('relApprovalDropdown').style.display = 'none';
        document.getElementById('relApprovalSearch').value = '';
    },

    _removeRelApproval(idx) {
        this._relatedApprovals.splice(idx, 1);
        this._renderRelApprovalTags();
    },

    _renderRelApprovalTags() {
        var container = document.getElementById('relApprovalTags');
        if (!container) return;
        if (!this._relatedApprovals || !this._relatedApprovals.length) {
            container.innerHTML = '';
            return;
        }
        var self = this;
        container.innerHTML = this._relatedApprovals.map(function (r, i) {
            var tip = '';
            if (r.applicant_name) tip += '发起人：' + r.applicant_name;
            if (r.department_name) tip += (tip ? ' · ' : '') + '部门：' + r.department_name;
            if (r.applicant_position) tip += (tip ? ' · ' : '') + '职位：' + r.applicant_position;
            return '<span title="' + self._escape(tip || '') + '" style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;background:#e8f6f3;border:1px solid #b2e0d8;border-radius:14px;font-size:12px;margin:2px;max-width:240px;">'
                + '<i class="fas fa-link" style="font-size:10px;color:#16a085;"></i>'
                + '<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(r.title) + '</span>'
                + (r.applicant_name ? '<span style="color:#606266;font-size:11px;flex-shrink:0;">(' + self._escape(r.applicant_name) + ')</span>' : '')
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:11px;flex-shrink:0;" onclick="approvalApp._removeRelApproval(' + i + ')"></i>'
                + '</span>';
        }).join('');
    },

    async _searchCcUsers(keyword) {
        var dd = document.getElementById('ccUserDropdown');
        if (!dd) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-users/?search=' + encodeURIComponent(keyword));
            var users = data.results || [];
            if (!users.length) {
                dd.innerHTML = '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到用户</div>';
            } else {
                var self = this;
                var selectedIds = {};
                (this._ccUsers || []).forEach(function (u) {
                    selectedIds[u.id] = true;
                });
                dd.innerHTML = users.map(function (u) {
                    var cls = selectedIds[u.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                    return '<div class="cc-user-item" data-id="' + u.id + '" data-name="' + self._escape(u.name) + '" data-avatar="' + (u.avatar || '') + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addCcUser(' + u.id + ',\'' + self._escape(u.name) + '\',\'' + (u.avatar || '') + '\')">'
                        + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                        + (u.position ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.position) + '</span>' : '')
                        + '</div>';
                }).join('');
            }
            dd.style.display = 'block';
        } catch (e) {
            console.error('Search CC users failed:', e);
        }
    },

    async _searchCcDepartments(keyword) {
        var dd = document.getElementById('ccUserDropdown');
        if (!dd) return;
        try {
            var data = await this.apiGet(OA_API_URL + '/approval/search-cc-departments/?search=' + encodeURIComponent(keyword));
            var depts = data.results || [];
            if (!depts.length) {
                dd.innerHTML = '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到部门</div>';
            } else {
                var self = this;
                var selectedIds = {};
                (this._ccDepartments || []).forEach(function (d) {
                    selectedIds[d.id] = true;
                });
                dd.innerHTML = depts.map(function (d) {
                    var cls = selectedIds[d.id] ? 'opacity:0.5;cursor:not-allowed;' : 'cursor:pointer;';
                    return '<div class="cc-user-item" data-id="' + d.id + '" data-name="' + self._escape(d.name) + '" style="display:flex;align-items:center;gap:8px;padding:8px 12px;' + cls + '" onclick="approvalApp._addCcDept(' + d.id + ',\'' + self._escape(d.name) + '\')">'
                        + '<i class="fas fa-building" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;color:#409eff;font-size:16px;"></i>'
                        + '<span style="flex:1;font-size:13px;">' + self._escape(d.name) + '</span>'
                        + (d.manager_name ? '<span style="font-size:11px;color:#909399;">负责人：' + self._escape(d.manager_name) + '</span>' : '')
                        + '</div>';
                }).join('');
            }
            dd.style.display = 'block';
        } catch (e) {
            console.error('Search CC departments failed:', e);
        }
    },

    _addCcUser(id, name, avatar) {
        if (!this._ccUsers) this._ccUsers = [];
        if (this._ccUsers.some(function (u) {
            return u.id === id;
        })) return;
        this._ccUsers.push({id: id, name: name, avatar: avatar});
        this._renderCcTags();
        document.getElementById('ccUserDropdown').style.display = 'none';
        document.getElementById('ccUserSearch').value = '';
    },

    _addCcDept(id, name) {
        if (!this._ccDepartments) this._ccDepartments = [];
        if (this._ccDepartments.some(function (d) {
            return d.id === id;
        })) return;
        this._ccDepartments.push({id: id, name: name});
        this._renderCcTags();
        document.getElementById('ccUserDropdown').style.display = 'none';
        document.getElementById('ccUserSearch').value = '';
    },

    _removeCcUser(id) {
        if (!this._ccUsers) return;
        var target = null;
        for (var i = 0; i < this._ccUsers.length; i++) {
            if (this._ccUsers[i].id === id) { target = this._ccUsers[i]; break; }
        }
        // 默认抄送人不可删除
        if (target && target.locked) return;
        this._ccUsers = this._ccUsers.filter(function (u) {
            return u.id !== id;
        });
        this._renderCcTags();
    },

    _removeCcDept(id) {
        if (!this._ccDepartments) return;
        var target = null;
        for (var i = 0; i < this._ccDepartments.length; i++) {
            if (this._ccDepartments[i].id === id) { target = this._ccDepartments[i]; break; }
        }
        // 默认抄送部门不可删除
        if (target && target.locked) return;
        this._ccDepartments = this._ccDepartments.filter(function (d) {
            return d.id !== id;
        });
        this._renderCcTags();
    },

    _renderCcTags() {
        var container = document.getElementById('ccUserTags');
        if (!container) return;
        var self = this;
        var html = '';
        // 默认（配置带入）项不可删除：虚线边框 + 锁图标
        var lockedBorder = 'border:1px dashed #c0c4cc;';
        // Department tags
        if (this._ccDepartments && this._ccDepartments.length) {
            html += this._ccDepartments.map(function (d) {
                return '<span class="cc-tag cc-tag-dept" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#e8f4fd;border-radius:14px;font-size:12px;margin:2px;' + (d.locked ? lockedBorder : '') + '">'
                    + '<i class="fas fa-building" style="font-size:11px;color:#409eff;"></i>'
                    + '<span>' + self._escape(d.name) + '</span>'
                    + (d.locked
                        ? '<i class="fas fa-lock" style="font-size:10px;color:#c0c4cc;" title="默认抄送部门，不可删除"></i>'
                        : '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeCcDept(' + d.id + ')"></i>')
                    + '</span>';
            }).join('');
        }
        // User tags
        if (this._ccUsers && this._ccUsers.length) {
            html += this._ccUsers.map(function (u) {
                return '<span class="cc-tag" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#f3e8ff;border-radius:14px;font-size:12px;margin:2px;' + (u.locked ? lockedBorder : '') + '">'
                    + '<img src="' + (u.avatar || '/static/images/default-avatar.png') + '" style="width:18px;height:18px;border-radius:50%;object-fit:cover;">'
                    + '<span>' + self._escape(u.name) + '</span>'
                    + (u.locked
                        ? '<i class="fas fa-lock" style="font-size:10px;color:#c0c4cc;" title="默认抄送人，不可删除"></i>'
                        : '<i class="fas fa-times" style="cursor:pointer;font-size:11px;color:#909399;" onclick="approvalApp._removeCcUser(' + u.id + ')"></i>')
                    + '</span>';
            }).join('');
        }
        container.innerHTML = html || '';
    },

    addApproverNode() {
        const sel = document.getElementById('approverUserSelect');
        const val = sel.value;
        if (!val) {
            this.showAlert('提示', '请选择审批人或部门');
            return;
        }
        const opt = sel.options[sel.selectedIndex];
        const type = opt.dataset.type;
        const id = parseInt(opt.dataset.id);
        const label = opt.text;

        // 去重
        for (var i = 0; i < this._approverNodes.length; i++) {
            if (this._approverNodes[i].type === type && this._approverNodes[i].id === id) {
                this.showAlert('提示', '该审批人已在列表中');
                return;
            }
        }

        this._approverNodes.push({type: type, id: id, label: label});
        this._renderApproverNodes();
        sel.value = '';
    },

    removeApproverNode(idx) {
        this._approverNodes.splice(idx, 1);
        this._renderApproverNodes();
    },

    _renderApproverNodes() {
        this._loadApprovalChainPreview();
    },

    // ==================== 附件上传 ====================

    triggerUpload() {
        document.getElementById('fileInput').click();
    },

    handleFileSelect(e) {
        const files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;
        const max = 10;
        const self = this;
        let pending = files.slice();
        let failed = false;

        const uploadNext = function () {
            if (!pending.length) {
                e.target.value = '';
                if (failed) self.showAlert('提示', '部分文件上传失败，请检查格式或大小后重试');
                return;
            }
            if (self._attachmentFiles.length >= max) {
                self.showAlert('提示', '最多上传10个附件，已忽略多余文件');
                pending = [];
                e.target.value = '';
                return;
            }
            const file = pending.shift();
            if (file.size > self.fileMaxSizeMB * 1024 * 1024) {
                failed = true;
                self.showAlert('提示', `「${file.name}」大小不能超过${self.fileMaxSizeMB}MB`);
                uploadNext();
                return;
            }
            const ext = (file.name.substring(file.name.lastIndexOf('.')) || '').toLowerCase();
            const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.mp4', '.avi', '.mov', '.mp3', '.wav'];
            if (!allowed.includes(ext)) {
                failed = true;
                self.showAlert('错误', `「${file.name}」不支持的文件格式`);
                uploadNext();
                return;
            }
            const formData = new FormData();
            formData.append('file', file);
            fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: formData
            }).then(async function (r) {
                var res = await r.json();
                if (!r.ok) throw new Error(res.error || res.detail || '上传失败');
                if (res.url) {
                    self._attachmentFiles.push({url: res.url, name: res.name});
                    self._renderAttachments();
                } else {
                    failed = true;
                    self.showAlert('提示', `「${file.name}」上传失败`);
                }
                uploadNext();
            }).catch(function (err) {
                failed = true;
                self.showAlert('上传失败', `「${file.name}」${err.message}`);
                uploadNext();
            });
        };
        uploadNext();
    },

    _getFileIcon(name) {
        return Utils.getFileIconClass('', name);
    },

    _renderAttachments() {
        const container = document.getElementById('attachmentPreview');
        container.style.display = 'block';
        const self = this;
        var isImage = function (name) {
            return name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        };
        container.innerHTML = this._attachmentFiles.map(function (f, i) {
            var icon = self._getFileIcon(f.name);
            var thumbHtml = '';
            if (isImage(f.name)) {
                thumbHtml = '<img src="' + f.url + '" style="width:40px;height:40px;border-radius:4px;object-fit:cover;flex-shrink:0;">';
            } else {
                thumbHtml = '<div style="width:40px;height:40px;border-radius:4px;background:var(--bg-secondary,#e8ecf1);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ' + icon + '" style="font-size:18px;color:var(--primary-color,#409eff);"></i></div>';
            }
            return '<div class="att-item" style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;margin-bottom:4px;">'
                + thumbHtml
                + '<span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + self._escape(f.name) + '</span>'
                + '<button class="btn btn-secondary" onclick="approvalApp.removeAttachment(' + i + ')" style="width:24px;height:24px;"><i class="fas fa-times" style="font-size:12px;"></i></button></div>';
        }).join('');
    },

    removeAttachment(index) {
        this._attachmentFiles.splice(index, 1);
        this._renderAttachments();
    },
    });
})();
