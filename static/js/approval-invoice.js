// static/js/approval-invoice.js - 票据回传与发票字段
// 说明：本文件为 ApprovalApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ApprovalApp.prototype, {

    _renderReceiptSection(d) {
        if (!d) return '';
        var currentUserId = parseInt(localStorage.getItem('user_id'));
        var isApplicant = d.applicant === currentUserId;
        var isLastApprover = this._isLastApprover(d, currentUserId);
        if (!isApplicant && !isLastApprover) return '';
        // 票据回传开关关闭时：发起人与最后审批人均不可使用票据回传，整个区域隐藏
        if (!d.enable_receipt_return) return '';
        var inProgress = ['pending', 'deferred', 'processing'].indexOf(d.status) >= 0;
        // 已通过：只要配置开启回传（时限>0）即显示；进行中：发起人/最后审批人可补传
        if (d.status === 'approved') {
            if (!(d.receipt_return_hours > 0)) return '';
        } else if (!inProgress) {
            return '';
        }
        var deadlineText = '';
        var canUpload = false;
        if (d.status === 'approved') {
            if (d.receipt_deadline) {
                var deadline = new Date(d.receipt_deadline);
                var expired = new Date() > deadline;
                deadlineText = '回传截止时间：' + this._formatTime(d.receipt_deadline)
                    + (expired ? ' <span style="color:#f56c6c;">（已过期）</span>' : ' <span style="color:#67c23a;">（请在截止前回传付款凭证/票据）</span>');
                canUpload = !expired;
            } else {
                // 截止时间缺失（旧数据/边界）：按配置的回传时限展示并允许回传（后端会自动补算截止时间）
                deadlineText = '审批已通过，可在配置的回传时限（' + d.receipt_return_hours + ' 小时）内补传付款凭证/票据';
                canUpload = true;
            }
        } else {
            deadlineText = '审批进行中，可补传票据';
            canUpload = true;
        }
        var receipts = d.receipts || [];
        // 区分回传方：最后审批人回传=对发起人的反馈；发起人回传=对审批人的反馈（历史数据无标记按发起人处理）
        var lastApproverReceipts = receipts.filter(function (r) { return (r.uploader_role || '') === 'last_approver'; });
        var applicantReceipts = receipts.filter(function (r) { return (r.uploader_role || '') !== 'last_approver'; });
        var html = '<div class="detail-item full-width" style="margin-top:8px;border:1px solid #d1f2eb;border-radius:8px;padding:12px;background:#f4fdf9;">'
            + '<div style="font-size:14px;font-weight:600;color:#16a085;margin-bottom:8px;border-bottom:1px solid #d1f2eb;padding-bottom:6px;"><i class="fas fa-file-upload"></i> 票据回传</div>'
            + '<div style="font-size:13px;color:#606266;margin-bottom:8px;">' + deadlineText + '</div>';
        // 渲染一组回传票据（canDelete=仅该组回传者可删除本人上传的票据）
        var renderReceiptGroup = function (title, hint, group, canDelete) {
            if (!group.length) return '';
            var g = '<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;color:#16a085;margin-bottom:4px;">' + title + ' <span style="font-weight:400;color:#909399;font-size:12px;">' + hint + '</span></div>'
                + '<div style="display:flex;flex-direction:column;gap:4px;">';
            group.forEach(function (r) {
                var rName = r.name || '';
                var rUrl = r.url || '';
                var isInvoice = (r.kind === 'invoice') || !!r.invoice_number;
                var isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(rName || rUrl);
                var isDoc = /\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i.test(rName || rUrl);
                // 点击行为：发票→发票预览；图片→预览；文档→保存到我的网盘并在线编辑；其他→保存到网盘
                var inner = isImg
                    ? '<img src="' + approvalApp._escape(rUrl) + '" style="width:40px;height:40px;border-radius:4px;object-fit:cover;border:1px solid #d1f2eb;">'
                    : (isInvoice
                        ? '<i class="fas fa-file-invoice" style="color:#16a085;font-size:18px;"></i>'
                        : '<i class="fas ' + (isDoc ? 'fa-file-word' : 'fa-file') + '" style="color:#16a085;font-size:18px;"></i>');
                var label = isInvoice
                    ? ('发票' + (r.invoice_number ? ' ' + r.invoice_number : '') + (r.invoice_amount ? '（¥' + r.invoice_amount + '）' : '') + (r.invoice_date ? ' ' + r.invoice_date : ''))
                    : (rName || '');
                var onClick = isInvoice
                    ? 'approvalApp._openInvoicePreview(\'' + approvalApp._escape(rUrl) + '\',\'' + approvalApp._escape(rName || '发票') + '\')'
                    : 'approvalApp._handleAttach(this)';
                var title = isInvoice ? '点击预览发票' : (isImg ? '点击预览图片' : '点击保存到我的网盘' + (isDoc ? '并在线编辑' : ''));
                g += '<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;background:#fff;border:1px solid #e2f3ee;border-radius:6px;">'
                    + '<a href="javascript:void(0)" data-url="' + approvalApp._escape(rUrl) + '" data-name="' + approvalApp._escape(rName || '') + '" onclick="' + onClick + '" title="' + title + '" style="display:inline-flex;align-items:center;gap:6px;color:#16a085;text-decoration:none;flex:1;overflow:hidden;">'
                    + inner + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(label) + '</span></a>'
                    + (canDelete ? '<button type="button" title="删除该回传票据" data-url="' + approvalApp._escape(rUrl) + '" onclick="approvalApp._deleteReceipt(' + d.id + ', this)" style="border:none;background:none;color:#f56c6c;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;flex-shrink:0;"><i class="fas fa-trash-alt"></i></button>' : '')
                    + '</div>';
            });
            g += '</div></div>';
            return g;
        };
        // 审批通过后：回传的票据/发票一律不可删除（发起人与最后审批人都不能删，留痕备查）
        var canDeleteAny = (d.status !== 'approved');
        html += renderReceiptGroup('最后审批人回传', '（对发起人的反馈）', lastApproverReceipts, isLastApprover && canDeleteAny);
        html += renderReceiptGroup('发起人回传', '（对审批人的反馈）', applicantReceipts, isApplicant && canDeleteAny);
        // 回传数量上限提示（默认 10，可在「审批类型配置」里改）
        if (receipts.length) {
            var _maxN = d.receipt_max_count || 10;
            var _fileN = receipts.filter(function (r) { return (r.kind || 'attachment') !== 'invoice'; }).length;
            var _invN = receipts.filter(function (r) { return (r.kind || '') === 'invoice'; }).length;
            html += '<div style="font-size:12px;color:#909399;margin-bottom:6px;">已回传附件 ' + _fileN + '/' + _maxN
                + ' 个、发票 ' + _invN + '/' + _maxN + ' 张'
                + (d.status === 'approved' ? '；<span style="color:#e6a23c;">审批已通过，回传的票据不可删除</span>' : '') + '</div>';
        }
        // 文字反馈/审批意见：随票据一起回传，展示在审批记录最下面，并随回传通知发送给对方
        // 发起人 →「反馈内容」（随通知发给最后审批人）；最后审批人 →「审批意见」（随通知发给发起人）
        if (canUpload) {
            var isLastOnly = isLastApprover && !isApplicant;
            var commentLabel = isLastOnly ? '审批意见' : '反馈内容';
            var commentPlaceholder = isLastOnly
                ? '选填，填写回传票据的相关说明...'
                : '选填，填写本次票据回传的反馈说明（将随回传通知一并发送给最后审批人，并记录到审批记录）...';
            html += '<div style="margin-bottom:8px;"><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;"><i class="fas fa-comment-dots" style="color:#16a085;"></i> ' + commentLabel + '</label>'
                + '<textarea id="receiptComment' + d.id + '" rows="2" placeholder="' + commentPlaceholder + '" style="width:100%;padding:8px 10px;border:1px solid var(--border-color,#dcdfe6);border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea></div>';
        }
        // 发起人/最后审批人可上传；最后审批人还可单独提交审批意见
        if (canUpload) {
            html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
                + '<button type="button" class="btn btn-sm btn-primary" onclick="approvalApp._triggerReceiptUpload(' + d.id + ')"><i class="fas fa-upload"></i> 回传付款凭证/票据</button>'
                + '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._pickReceiptCloudFiles(' + d.id + ')"><i class="fas fa-cloud"></i> 从网盘选择</button>'
                + '<input type="file" id="receiptFileInput' + d.id + '" style="display:none;" multiple onchange="approvalApp._handleReceiptFileSelect(' + d.id + ', this)">'
                + '<button type="button" class="btn btn-sm btn-secondary" onclick="approvalApp._submitReceiptComment(' + d.id + ')"><i class="fas fa-comment-dots"></i> '
                + (isLastApprover && !isApplicant ? '单独提交审批意见' : '单独提交反馈') + '</button>'
                + '<span style="font-size:12px;color:#909399;">本审批回传上限：附件/发票分别最多 '
                + (d.receipt_max_count || 10) + ' 个（可在「审批类型配置」里调整）</span>'
                + '</div>';
            // 该审批含发票字段时，回传在附件基础上增加发票字段
            if (this._approvalHasInvoiceField(d)) {
                var _invKey = '__receipt_' + d.id + '__';
                html += '<div style="margin-top:10px;border-top:1px dashed #d1f2eb;padding-top:10px;">'
                    + '<div style="font-size:13px;font-weight:600;color:#16a085;margin-bottom:6px;"><i class="fas fa-file-invoice"></i> 回传发票 <span style="font-weight:400;color:#909399;font-size:12px;">（可上传发票并自动识别，支持二维码扫描/验真；提交后同步写入本审批的发票信息，审批人可直接查看）</span></div>'
                    + this._invoiceBlockHtml(_invKey, { canOperate: this._isInvoiceOperator(d), max: (d.invoice_max_count || d.receipt_max_count || 10) })
                    + '<div style="margin-top:8px;"><button type="button" class="btn btn-sm btn-primary" onclick="approvalApp._submitReceiptInvoices(' + d.id + ')"><i class="fas fa-paper-plane"></i> 提交回传发票</button></div>'
                    + '</div>';
            }
        }
        html += '</div>';
        return html;
    },

    // 单独提交审批意见（不附票据文件）
    async _submitReceiptComment(id) {
        const commentEl = document.getElementById('receiptComment' + id);
        const comment = commentEl ? commentEl.value.trim() : '';
        if (!comment) {
            this.showToast('请先填写反馈或审批意见', true);
            return;
        }
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/upload-receipt/', {comment: comment});
            this.showToast((res && res.message) || '已提交', false);
            if (commentEl) commentEl.value = '';
            this.showDetail(id);
        } catch (e) {
            this.showAlert('提交失败', e.message || '请重试');
        }
    },

    // 删除一条已回传的票据（仅最后审批人有权限，后端会再次校验）
    async _deleteReceipt(id, btn) {
        const url = btn ? btn.getAttribute('data-url') : '';
        if (!url) return;
        const confirmed = await this.showConfirmDialog('删除票据', '确定删除该回传票据吗？删除后不可恢复。', 'danger');
        if (!confirmed) return;
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/delete-receipt/', {url: url});
            this.showToast((res && res.message) || '已删除', false);
            this.showDetail(id);
        } catch (e) {
            this.showAlert('删除失败', e.message || '请重试');
        }
    },

    _triggerReceiptUpload(id) {
        const input = document.getElementById('receiptFileInput' + id);
        if (input) input.click();
    },

    async _handleReceiptFileSelect(id, input) {
        const files = input.files;
        if (!files || !files.length) return;
        const uploaded = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.size > this.fileMaxSizeMB * 1024 * 1024) {
                this.showAlert('提示', '文件大小不能超过' + this.fileMaxSizeMB + 'MB');
                continue;
            }
            const formData = new FormData();
            formData.append('file', file);
            try {
                const resp = await fetch(OA_API_URL + '/approval/upload-attachment/', {
                    method: 'POST',
                    headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                    body: formData
                });
                if (!resp.ok) throw new Error('上传失败');
                const result = await resp.json();
                if (result.url) uploaded.push({url: result.url, name: result.name || file.name});
            } catch (e) {
                console.error('上传回传票据失败', e);
            }
        }
        if (input) input.value = '';
        if (uploaded.length) await this._submitReceiptFiles(id, uploaded);
    },

    async _submitReceiptFiles(id, uploaded) {
        if (!(uploaded && uploaded.length)) return;
        // 随票据一起提交的审批意见（最后审批人可填）
        const commentEl = document.getElementById('receiptComment' + id);
        const comment = commentEl ? commentEl.value.trim() : '';
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/upload-receipt/', {files: uploaded, comment: comment});
            this.showToast((res && res.message) || '票据回传成功', false);
            if (commentEl) commentEl.value = '';
            this.showDetail(id);
        } catch (e) {
            this.showAlert('回传失败', e.message || '请重试');
        }
    },

    // 该审批是否含发票字段（内置报销/采购恒含；自定义/带 schema 内置类型按 schema 判断）
    _approvalHasInvoiceField(d) {
        if (!d) return false;
        if (d.approval_type === 'expense' || d.approval_type === 'purchase') return true;
        try {
            var t = this._getType(d.approval_type);
            var schema = (t && t.form_schema) || [];
            for (var i = 0; i < schema.length; i++) {
                if (schema[i] && schema[i].type === 'invoice') return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    },
    // 详情渲染后：初始化「回传发票」发票列表（每次打开详情重新开始）
    _initReceiptInvoices(d) {
        if (!d || !this._approvalHasInvoiceField(d)) return;
        var invKey = '__receipt_' + d.id + '__';
        if (!document.getElementById('invoiceList_' + invKey)) return;
        this._setInvoiceList(invKey, []);
        this._renderInvoices(invKey, { canOperate: this._isInvoiceOperator(d) });
    },
    // 提交回传发票
    async _submitReceiptInvoices(id) {
        if (this._invoiceBusy()) { this.showToast('发票正在识别/验真/二维码扫描中，请稍候再提交', true); return; }
        var invKey = '__receipt_' + id + '__';
        var invoices = (this._invoiceList(invKey) || []).slice();
        if (!invoices.length) { this.showToast('请先添加要回传的发票', true); return; }
        var commentEl = document.getElementById('receiptComment' + id);
        var comment = commentEl ? commentEl.value.trim() : '';
        try {
            const res = await this.apiPost(OA_API_URL + '/approval/' + id + '/upload-receipt/', { invoices: invoices, comment: comment });
            this.showToast((res && res.message) || '发票回传成功', false);
            if (commentEl) commentEl.value = '';
            this.showDetail(id);
        } catch (e) {
            this.showAlert('回传失败', (e && e.message) ? e.message : '请重试');
        }
    },

    _pickReceiptCloudFiles(id) {
        if (!window.CloudFilePicker) { this.showAlert('提示', '网盘选择组件未加载，请刷新'); return; }
        const self = this;
        CloudFilePicker.open({title: '从我的网盘选择回传票据', onPick: function (list) { self._addReceiptCloudFiles(id, list); }});
    },
    async _addReceiptCloudFiles(id, list) {
        if (!(list && list.length)) return;
        const uploaded = [];
        for (let i = 0; i < list.length; i++) {
            try {
                const resp = await fetch(OA_API_URL + '/approval/attach-cloud/', {
                    method: 'POST', headers: TokenManager.getHeaders(),
                    body: JSON.stringify({cloud_id: list[i].cloud_id})
                });
                if (!resp.ok) { const e2 = await resp.json().catch(function () { return {}; }); throw new Error(e2.error || '添加失败'); }
                const res = await resp.json();
                uploaded.push({url: res.url, name: res.name || list[i].name});
            } catch (e) { this.showAlert('提示', (e && e.message) || '添加失败'); break; }
        }
        if (uploaded.length) await this._submitReceiptFiles(id, uploaded);
    },

    // ==================== 发票字段（报销/采购/自定义发票字段通用） ====================
    // 数据结构：form_data.invoices = [{url,name,invoice_type,invoice_number,invoice_code,
    //   invoice_amount,invoice_date,tax_rate,check_code,drawer,buyer_name,buyer_tax_no,
    //   seller_name,seller_tax_no,ocr_raw_data,verify,qr}]
    _invoiceRegistry() {
        if (!this._invoiceValues) this._invoiceValues = {};
        return this._invoiceValues;
    },
    _invoiceList(listKey) {
        const reg = this._invoiceRegistry();
        if (!reg[listKey]) reg[listKey] = [];
        return reg[listKey];
    },
    _setInvoiceList(listKey, list) {
        const reg = this._invoiceRegistry();
        reg[listKey] = Array.isArray(list) ? list : [];
    },
    // 是否可做二维码扫描/发票验真：超级管理员或该审批的审批人
    _isInvoiceOperator(approval) {
        try {
            const ut = localStorage.getItem('user_type') || (this.currentUser && this.currentUser.user_type) || '';
            if (ut === 'super_admin') return true;
        } catch (e) { /* ignore */ }
        if (approval) {
            const uid = (this.currentUser && this.currentUser.id) || (typeof currentUserId !== 'undefined' ? currentUserId : null);
            if (approval.applicant === uid) return false;
            const nodes = approval.approval_nodes || [];
            for (let i = 0; i < nodes.length; i++) {
                const as = nodes[i].assignees || [];
                for (let j = 0; j < as.length; j++) {
                    if (as[j].user === uid) return true;
                }
            }
        }
        return false;
    },
    _invoiceBlockHtml(listKey, opts) {
        opts = opts || {};
        const ro = !!opts.readonly;
        const self = this;
        // 记录该列表的上限（后续上传/网盘选择/回传都按它限制）；opts.max 缺省为 10
        this._invoiceOpts = this._invoiceOpts || {};
        this._invoiceOpts[listKey] = Object.assign({}, this._invoiceOpts[listKey] || {}, opts);
        const max = this._invoiceMaxOf(listKey);
        let h = '<div class="dyn-invoice" data-invoice-key="' + self._escape(listKey) + '">';
        if (!ro) {
            h += '<input type="file" id="invoiceFileInput_' + self._escape(listKey) + '" accept="image/*,.pdf" multiple style="display:none;" onchange="approvalApp._onInvoiceFileChange(event,\'' + self._escape(listKey) + '\')">'
                + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;align-items:center;">'
                + '<button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById(\'invoiceFileInput_' + self._escape(listKey) + '\').click()"><i class="fas fa-file-invoice"></i> 上传发票</button>'
                + '<button type="button" class="btn btn-secondary btn-sm" onclick="approvalApp._pickInvoiceCloud(\'' + self._escape(listKey) + '\')"><i class="fas fa-cloud"></i> 从网盘选择</button>'
                + '<span style="font-size:12px;color:#909399;align-self:center;">仅支持<b>图片</b>或<b>PDF</b>（其它格式会被过滤），自动识别发票信息；'
                + '<b>最多 ' + max + ' 张</b></span>'
                + '</div>';
        }
        h += '<div class="invoice-list" id="invoiceList_' + self._escape(listKey) + '"></div></div>';
        return h;
    },
    _renderInvoices(listKey, opts) {
        opts = opts || {};
        this._invoiceOpts = this._invoiceOpts || {};
        this._invoiceOpts[listKey] = opts;
        this._ensureInvoiceStyles();
        const container = document.getElementById('invoiceList_' + listKey);
        if (!container) return;
        const items = this._invoiceList(listKey);
        const self = this;
        const _max = this._invoiceMaxOf(listKey);
        if (!items.length) {
            container.innerHTML = '<div style="font-size:12px;color:#909399;padding:6px 2px;">' + (opts.readonly ? '无发票' : '尚未添加发票（最多 ' + _max + ' 张）') + '</div>';
            return;
        }
        container.innerHTML = items.map(function (inv, i) { return self._invoiceCardHtml(listKey, inv, i, opts); }).join('');
    },
    _invoiceCardHtml(listKey, inv, idx, opts) {
        opts = opts || {};
        const self = this;
        const ro = !!opts.readonly;
        const canOp = !!opts.canOperate;
        const name = inv.name || ((inv.url || '').split('/').pop() || '发票');
        const isPdf = /\.pdf$/i.test(name);
        const cl = '\'' + self._escape(listKey) + '\',' + idx;
        const thumb = isPdf
            ? '<div onclick="approvalApp._openInvoicePreview(\'' + self._escape(inv.url || '') + '\',\'' + self._escape(name) + '\')" style="width:64px;height:64px;border-radius:6px;background:#fdecec;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:zoom-in;" title="点击预览"><i class="fas fa-file-pdf" style="font-size:26px;color:#f56c6c;"></i></div>'
            : (inv.url
                ? '<img src="' + self._escape(inv.url) + '" onclick="approvalApp._openInvoicePreview(\'' + self._escape(inv.url) + '\',\'' + self._escape(name) + '\')" style="width:64px;height:64px;border-radius:6px;object-fit:cover;border:1px solid #dcdfe6;flex-shrink:0;cursor:zoom-in;" title="点击预览">'
                : '<div style="width:64px;height:64px;border-radius:6px;background:#f5f7fa;display:flex;align-items:center;justify-content:center;"><i class="fas fa-file-invoice" style="font-size:24px;color:#909399;"></i></div>');
        const fld = function (label, field, type) {
            const v = (inv[field] === undefined || inv[field] === null) ? '' : inv[field];
            const sv = self._escape(v);
            const dd = type === 'date' ? ' data-inv-date="1"' : '';
            const val = ro
                ? '<div class="inv-fld-val" title="' + sv + '">' + (sv !== '' ? sv : '<span style="color:#c0c4cc;">—</span>') + '</div>'
                : '<input type="' + (type || 'text') + '" class="form-input inv-fld-inp" style="width:100%;font-size:12px;padding:4px 6px;" value="' + sv + '"'
                    + ' oninput="approvalApp._onInvoiceField(this,' + cl + ',\'' + field + '\')"' + dd + '>';
            return '<div class="inv-fld"><div class="inv-fld-lbl">' + label + '</div>' + val + '</div>';
        };
        const typeOpts = '<option value="">类型未知</option>'
            + '<option value="special"' + (inv.invoice_type === 'special' ? ' selected' : '') + '>增值税专用发票</option>'
            + '<option value="ordinary"' + (inv.invoice_type === 'ordinary' ? ' selected' : '') + '>增值税普通发票</option>';
        let btns = '';
        if (canOp) {
            btns += '<button type="button" class="btn btn-secondary btn-sm" onclick="approvalApp._invoiceQr(' + cl + ')"><i class="fas fa-qrcode"></i> 二维码扫描</button>'
                + '<button type="button" class="btn btn-secondary btn-sm" onclick="approvalApp._invoiceVerify(' + cl + ')"><i class="fas fa-shield-alt"></i> 发票验真</button>';
        }
        if (!ro) {
            btns += '<button type="button" class="btn btn-secondary btn-sm" onclick="approvalApp._invoiceOcr(' + cl + ')"><i class="fas fa-magic"></i> 识别发票</button>'
                + '<button type="button" class="btn btn-secondary btn-sm" style="color:#f56c6c;" onclick="approvalApp._invoiceRemove(' + cl + ')"><i class="fas fa-trash"></i> 移除</button>';
        }
        const vres = inv.verify && inv.verify.result
            ? self._invoiceVerifyHtml(inv.verify)
            : '';
        const ocrHtml = inv._ocrState === 'running'
            ? '<div style="margin-top:8px;"><div style="height:6px;background:#eef0f3;border-radius:3px;overflow:hidden;"><div style="width:35%;height:100%;background:linear-gradient(90deg,#409eff,#67c23a);animation:invBarMove 1.1s linear infinite;"></div></div><div style="font-size:12px;color:#409eff;margin-top:4px;"><i class="fas fa-spinner fa-spin"></i> 正在自动识别发票信息…</div></div>'
            : (inv._ocrState === 'error'
                ? '<div style="margin-top:6px;font-size:12px;color:#e6a23c;"><i class="fas fa-triangle-exclamation"></i> 未识别到发票信息，请手动填写或点击「识别发票」重试</div>'
                : '');
        // 发票信息折叠：默认折叠，仅显示「发票类型 + 发票号码」；展开显示全部
        const expanded = !!inv._expanded;
        const basicGrid = '<div class="inv-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">'
            + '<div class="inv-fld"><div class="inv-fld-lbl">发票类型</div>'
            + '<select class="form-select" style="width:100%;font-size:12px;padding:4px 6px;"' + (ro ? ' disabled' : '')
            + ' onchange="approvalApp._onInvoiceField(this,' + cl + ',\'invoice_type\')">' + typeOpts + '</select></div>'
            + fld('发票号码', 'invoice_number')
            + '</div>';
        const extraGrid = '<div class="inv-extra" style="display:' + (expanded ? 'grid' : 'none') + ';grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;">'
            + fld('发票代码', 'invoice_code')
            + fld('开票日期', 'invoice_date', 'date')
            + fld('开票金额(元)', 'invoice_amount', 'number')
            + fld('税率', 'tax_rate')
            + fld('校验码', 'check_code')
            + fld('开票人', 'drawer')
            + fld('购买方名称', 'buyer_name')
            + fld('购买方税号', 'buyer_tax_no')
            + fld('销售方名称', 'seller_name')
            + fld('销售方税号', 'seller_tax_no')
            + '</div>';
        const toggleBtn = '<button type="button" class="inv-toggle" onclick="approvalApp._toggleInvoiceExpand(' + cl + ')" style="border:none;background:transparent;cursor:pointer;color:#409eff;font-size:12px;padding:0;margin-left:6px;flex-shrink:0;" title="' + (expanded ? '收起发票信息' : '展开完整发票信息') + '">'
            + '<i class="fas fa-chevron-' + (expanded ? 'up' : 'down') + '"></i> <span>' + (expanded ? '收起' : '展开') + '</span></button>';
        return '<div class="invoice-card" id="invoiceCard_' + self._escape(listKey) + '_' + idx + '" style="border:1px solid #e4e7ed;border-radius:8px;padding:10px;margin-bottom:8px;background:#fff;">'
            + '<div style="display:flex;gap:10px;align-items:flex-start;">'
            + thumb
            + '<div style="flex:1;min-width:0;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:#606266;margin-bottom:6px;"><span class="inv-name" style="min-width:0;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch;" title="' + self._escape(name) + '"><i class="fas fa-paperclip"></i> ' + self._escape('') + '</span>' + toggleBtn + '</div>'
            + basicGrid
            + extraGrid
            + '</div></div>'
            + (btns ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' + btns + '</div>' : '')
            + ocrHtml
            + '<div id="invVerify_' + self._escape(listKey) + '_' + idx + '" style="margin-top:6px;">' + vres + '</div>'
            + '</div>';
    },
    // 折叠/展开发票信息（详情/表单均适用：优先局部 DOM 切换，避免整块重渲染）
    _toggleInvoiceExpand(listKey, idx) {
        const inv = this._invoiceList(listKey)[idx];
        if (!inv) return;
        inv._expanded = !inv._expanded;
        const card = document.getElementById('invoiceCard_' + listKey + '_' + idx);
        const extra = card ? card.querySelector('.inv-extra') : null;
        if (card && extra) {
            extra.style.display = inv._expanded ? 'grid' : 'none';
            const ico = card.querySelector('.inv-toggle i');
            if (ico) ico.className = 'fas fa-chevron-' + (inv._expanded ? 'up' : 'down');
            const lbl = card.querySelector('.inv-toggle span');
            if (lbl) lbl.textContent = inv._expanded ? '收起' : '展开';
            return;
        }
        // 兜底：容器存在时整块重渲染
        this._renderInvoices(listKey, (this._invoiceOpts || {})[listKey]);
    },
    _invoiceVerifyHtml(v) {
        const color = v.result === 'pass' ? '#67c23a' : (v.result === 'fail' ? '#f56c6c' : '#e6a23c');
        const icon = v.result === 'pass' ? 'fa-circle-check' : (v.result === 'fail' ? 'fa-circle-xmark' : 'fa-triangle-exclamation');
        return '<span style="color:' + color + ';font-size:12px;"><i class="fas ' + icon + '"></i> '
            + this._escape(v.result_display || '') + (v.message ? '：' + this._escape(v.message) : '') + (v.cached ? '（缓存结果）' : '') + '</span>';
    },
    _onInvoiceField(el, listKey, idx, field) {
        const items = this._invoiceList(listKey);
        if (items[idx]) { items[idx][field] = el.value; }
        this._onInvoiceChanged && this._onInvoiceChanged(listKey);
    },
    // 发票只支持图片与 PDF：其它格式直接过滤掉并提示（后端同样会校验，防止未校验文件进入 OCR 任务）
    _isInvoiceFileAllowed(name, mime) {
        const n = String(name || '').toLowerCase();
        if (/\.(jpe?g|png|gif|webp|bmp|pdf)$/.test(n)) return true;
        const m = String(mime || '').toLowerCase();
        return m === 'application/pdf' || m.indexOf('image/') === 0;
    },

    // 当前发票列表能达到的上限（默认 10；可被审批类型配置里的值覆盖）
    _invoiceMaxOf(listKey) {
        const o = (this._invoiceOpts || {})[listKey] || {};
        const n = parseInt(o.max, 10);
        return (n > 0) ? n : 10;
    },

    _onInvoiceFileChange(e, listKey) {
        const files = Array.prototype.slice.call(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        const self = this;
        // 先按格式过滤，不支持的格式给出提示并跳过（不发起上传）
        const rejected = files.filter(function (f) { return !self._isInvoiceFileAllowed(f.name, f.type); });
        const ok = files.filter(function (f) { return self._isInvoiceFileAllowed(f.name, f.type); });
        if (rejected.length) {
            self.showToast('不支持该格式（仅支持图片/PDF）：' + rejected.map(function (f) { return f.name; }).join('、'), true);
        }
        if (!ok.length) return;
        // 数量上限：只上传还能放下的部分
        const max = this._invoiceMaxOf(listKey);
        const cur = this._invoiceList(listKey).length;
        const room = max - cur;
        if (room <= 0) {
            self.showToast('发票最多上传 ' + max + ' 张，已达上限', true);
            return;
        }
        const use = ok.slice(0, room);
        if (ok.length > room) {
            self.showToast('发票最多 ' + max + ' 张，本次只上传前 ' + room + ' 张', true);
        }
        use.forEach(function (file) {
            if (file.size > 20 * 1024 * 1024) { self.showToast('「' + file.name + '」超过20MB', true); return; }
            const fd = new FormData();
            fd.append('file', file);
            fetch(OA_API_URL + '/approval/upload-invoice/', {
                method: 'POST',
                headers: { 'Authorization': TokenManager.getHeaders()['Authorization'] },
                body: fd
            }).then(function (r) { return r.json(); }).then(function (d) {
                if (d.url) { self._addInvoiceItem(listKey, { url: d.url, name: d.name || file.name }); }
                else { self.showToast(d.error || '发票上传失败', true); }
            }).catch(function () { self.showToast('发票上传失败', true); });
        });
    },
    _addInvoiceItem(listKey, inv) {
        // 所有入口（本地上传 / 网盘选择 / 回传）最终都走这里 → 在此统一卡数量上限，
        // 防止绕过界面无限添加把服务器压垮
        const max = this._invoiceMaxOf(listKey);
        if (this._invoiceList(listKey).length >= max) {
            this.showToast('发票最多上传 ' + max + ' 张，已达上限', true);
            return false;
        }
        this._invoiceList(listKey).push(inv);
        this._renderInvoices(listKey, (this._invoiceOpts || {})[listKey]);
        this._onInvoiceChanged && this._onInvoiceChanged(listKey);
        // 上传/添加后自动识别发票信息（带进度展示，参考普惠补贴）
        this._autoOcrInvoice(listKey, this._invoiceList(listKey).length - 1);
        return true;
    },
    _autoOcrInvoice(listKey, idx) {
        const inv = this._invoiceList(listKey)[idx];
        if (!inv || !inv.url) return;
        this._invoiceOcr(listKey, idx);
    },
    _invoiceRemove(listKey, idx) {
        this._invoiceList(listKey).splice(idx, 1);
        this._renderInvoices(listKey, (this._invoiceOpts || {})[listKey]);
        this._onInvoiceChanged && this._onInvoiceChanged(listKey);
    },
    _pickInvoiceCloud(listKey) {
        if (!window.CloudFilePicker) { this.showToast('网盘选择组件未加载，请刷新', true); return; }
        const self = this;
        CloudFilePicker.open({ title: '从我的网盘选择发票', onPick: function (list) { self._addInvoiceCloud(listKey, list); } });
    },
    async _addInvoiceCloud(listKey, list) {
        if (!(list && list.length)) return;
        // 只挑图片/PDF，其它格式过滤掉并提示（网盘里可能有任意类型的文件）
        const self = this;
        const okList = list.filter(function (it) { return self._isInvoiceFileAllowed(it.name || '', it.mime_type || ''); });
        const bad = list.filter(function (it) { return !self._isInvoiceFileAllowed(it.name || '', it.mime_type || ''); });
        if (bad.length) {
            this.showToast('不支持该格式（仅支持图片/PDF），已跳过：' + bad.map(function (it) { return it.name || ''; }).join('、'), true);
        }
        let added = 0;
        for (let i = 0; i < okList.length; i++) {
            const max = this._invoiceMaxOf(listKey);
            if (this._invoiceList(listKey).length >= max) {
                this.showToast('发票最多上传 ' + max + ' 张，已达上限', true);
                break;
            }
            try {
                const item = await this._copyOneCloudToAttachment(okList[i].cloud_id);
                if (!this._addInvoiceItem(listKey, { url: item.url, name: item.name })) break;
                added++;
            } catch (e) { this.showToast((e && e.message) || '添加失败', true); break; }
        }
        if (added) this.showToast('已添加 ' + added + ' 张发票', false);
    },
    async _invoiceOcr(listKey, idx) {
        const inv = this._invoiceList(listKey)[idx];
        if (!inv || !inv.url) return;
        if (inv._ocrState === 'running') return;
        inv._ocrState = 'running';
        this._renderInvoices(listKey, (this._invoiceOpts || {})[listKey]);
        try {
            let r = await this.apiPost(OA_API_URL + '/approval/ocr-invoice/', { url: inv.url });
            if (r && r.task_id) {
                const res = await this._pollInvoiceOcr(r.task_id);
                if (!res) throw new Error('发票识别超时，请重试或手动填写');
                r = { result: res };
            }
            const data = (r && (r.result || r)) || {};
            if (data.error) throw new Error(data.error);
            inv._ocrState = 'done';
            this._applyInvoiceOcr(listKey, idx, data);
        } catch (e) {
            inv._ocrState = 'error';
            this._renderInvoices(listKey, (this._invoiceOpts || {})[listKey]);
            this.showToast((e && e.message) || '发票识别失败，请手动填写', true);
        }
    },
    _ensureInvoiceStyles() {
        if (document.getElementById('invoiceFieldStyles')) return;
        const s = document.createElement('style');
        s.id = 'invoiceFieldStyles';
        s.textContent = '@keyframes invBarMove{0%{transform:translateX(-100%);}100%{transform:translateX(300%);}}'
            // 自定义审批类型的「表单详情」：窄屏（手机）改为单列，避免两列挤成窄条
            + '@media (max-width:640px){.dyn-detail-grid{grid-template-columns:1fr !important;}}'
            // 发票卡片内部字段：窄屏单列（大屏两列），并让缩略图小一点
            + '@media (max-width:640px){'
            + '.inv-grid,.inv-extra{grid-template-columns:1fr !important;}}'
            // 发票卡片在详情里整行铺满、内容自适应换行
            + '.inv-detail-wrap,.inv-detail-wrap .invoice-card,.inv-detail-wrap .inv-card{width:100%;box-sizing:border-box;min-width:0;overflow-wrap:anywhere;}'
            + '.dyn-detail-row{min-width:0;}'
            // 卡片头部的缩略图在窄屏缩小一些，给右侧字段留出空间
            + '@media (max-width:640px){.inv-detail-wrap img,.inv-detail-wrap .inv-thumb{width:48px !important;height:48px !important;}}';
        document.head.appendChild(s);
    },
    async _pollInvoiceOcr(taskId) {
        for (let i = 0; i < 75; i++) {
            await new Promise(function (res) { setTimeout(res, 2000); });
            let s = null;
            try { s = await this.apiGet(OA_API_URL + '/approval/ocr-status/?task_id=' + encodeURIComponent(taskId)); }
            catch (e) { continue; }
            if (!s) continue;
            if (s.state === 'SUCCESS') return s.result || {};
            if (s.state === 'FAILURE') return null;
        }
        return null;
    },
    _applyInvoiceOcr(listKey, idx, data) {
        const inv = this._invoiceList(listKey)[idx];
        if (!inv) return;
        if (data.invoice_type === 'special' || data.invoice_type === 'ordinary') inv.invoice_type = data.invoice_type;
        if (data.invoice_number) inv.invoice_number = data.invoice_number;
        if (data.invoice_code) inv.invoice_code = data.invoice_code;
        if (data.invoice_amount) inv.invoice_amount = data.invoice_amount;
        if (data.invoice_date) inv.invoice_date = data.invoice_date;
        if (data.tax_rate) inv.tax_rate = data.tax_rate;
        if (data.drawer) inv.drawer = data.drawer;
        if (data.buyer_name) inv.buyer_name = data.buyer_name;
        if (data.buyer_tax_no) inv.buyer_tax_no = data.buyer_tax_no;
        if (data.invoice_issuer || data.seller_name) inv.seller_name = data.invoice_issuer || data.seller_name;
        if (data.seller_tax_no) inv.seller_tax_no = data.seller_tax_no;
        if (data.raw_data) inv.ocr_raw_data = data.raw_data;
        this._renderInvoices(listKey, (this._invoiceOpts || {})[listKey]);
        this.showToast('发票识别完成，请校验信息是否正确', false);
        this._onInvoiceChanged && this._onInvoiceChanged(listKey);
    },
    _invoiceBusy() {
        const reg = this._invoiceValues || {};
        let busy = false;
        Object.keys(reg).forEach(function (k) {
            (reg[k] || []).forEach(function (inv) {
                if (inv && (inv._ocrState === 'running' || inv._qrBusy || inv._verifyBusy)) busy = true;
            });
        });
        return busy;
    },
    _invoiceScanStyles() {
        if (document.getElementById('invoiceScanStyles')) return;
        const s = document.createElement('style');
        s.id = 'invoiceScanStyles';
        s.textContent = '@keyframes invScanLine{0%{top:3%}50%{top:94%}100%{top:3%}}'
            + '@keyframes invScanGlow{0%,100%{opacity:.5}50%{opacity:1}}';
        document.head.appendChild(s);
    },
    _showInvoiceScanning(imgUrl) {
        this._invoiceScanStyles();
        let ov = document.getElementById('invoiceScanOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'invoiceScanOverlay';
            ov.style.cssText = 'position:fixed;inset:0;z-index:100003;background:rgba(0,0,0,.84);display:none;align-items:center;justify-content:center;padding:16px;';
            document.body.appendChild(ov);
        }
        const media = imgUrl
            ? '<img src="' + imgUrl + '" style="max-width:84vw;max-height:64vh;display:block;">'
            : '<div style="width:min(84vw,420px);height:280px;display:flex;align-items:center;justify-content:center;background:#101418;"><i class="fas fa-file-invoice" style="font-size:64px;color:#409eff;opacity:.6;"></i></div>';
        ov.innerHTML = '<div style="text-align:center;">'
            + '<div style="position:relative;display:inline-block;border-radius:12px;overflow:hidden;border:2px solid rgba(64,158,255,.75);box-shadow:0 0 34px rgba(64,158,255,.55);">'
            + media
            + '<div style="position:absolute;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,#67c23a,#409eff,#67c23a,transparent);box-shadow:0 0 14px #409eff;animation:invScanLine 1.6s ease-in-out infinite;"></div>'
            + '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(64,158,255,.15),transparent 40%,transparent 60%,rgba(64,158,255,.15));pointer-events:none;animation:invScanGlow 1.6s ease-in-out infinite;"></div>'
            + '</div>'
            + '<div style="color:#409eff;font-size:14px;margin-top:14px;letter-spacing:3px;"><i class="fas fa-qrcode"></i> 正在扫描发票二维码…</div>'
            + '</div>';
        ov.style.display = 'flex';
    },
    _hideInvoiceScanning() {
        const ov = document.getElementById('invoiceScanOverlay');
        if (ov) ov.style.display = 'none';
    },
    async _invoiceQr(listKey, idx) {
        const inv = this._invoiceList(listKey)[idx];
        if (!inv || !inv.url) return;
        inv._qrBusy = true;
        const isPdf = /\.pdf$/i.test(inv.name || inv.url || '');
        this._showInvoiceScanning(isPdf ? '' : inv.url);
        try {
            const r = await this.apiPost(OA_API_URL + '/approval/qr-scan/', { url: inv.url });
            inv.qr = r || {};
            this._hideInvoiceScanning();
            this._showInvoiceQr(inv, r || {});
        } catch (e) {
            this._hideInvoiceScanning();
            this.showToast((e && e.message) || '二维码扫描失败', true);
        } finally {
            inv._qrBusy = false;
        }
    },
    _showInvoiceQr(inv, r) {
        const self = this;
        const parsed = (r && r.parsed) || {};
        const strings = (r && r.qr_strings) || [];
        const rows = [
            ['发票号码', parsed.invoice_number, inv.invoice_number],
            ['开票金额', parsed.invoice_amount, inv.invoice_amount],
            ['开票日期', parsed.invoice_date, inv.invoice_date],
            ['校验码', parsed.verify_code, inv.check_code]
        ];
        let body = '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
            + '<tr><th style="border:1px solid #dcdfe6;padding:6px;background:#f5f7fa;">字段</th>'
            + '<th style="border:1px solid #dcdfe6;padding:6px;background:#f5f7fa;">二维码</th>'
            + '<th style="border:1px solid #dcdfe6;padding:6px;background:#f5f7fa;">识别/填写</th>'
            + '<th style="border:1px solid #dcdfe6;padding:6px;background:#f5f7fa;">对比</th></tr>';
        rows.forEach(function (row) {
            const q = row[1] === undefined || row[1] === null ? '' : String(row[1]);
            const o = row[2] === undefined || row[2] === null ? '' : String(row[2]);
            const same = q && o && q === o;
            const mark = (!q || !o) ? '<span style="color:#909399;">-</span>'
                : (same ? '<span style="color:#67c23a;"><i class="fas fa-check"></i> 一致</span>' : '<span style="color:#f56c6c;"><i class="fas fa-times"></i> 不一致</span>');
            body += '<tr><td style="border:1px solid #dcdfe6;padding:6px;">' + row[0] + '</td>'
                + '<td style="border:1px solid #dcdfe6;padding:6px;word-break:break-all;">' + self._escape(q) + '</td>'
                + '<td style="border:1px solid #dcdfe6;padding:6px;word-break:break-all;">' + self._escape(o) + '</td>'
                + '<td style="border:1px solid #dcdfe6;padding:6px;">' + mark + '</td></tr>';
        });
        body += '</table>';
        if (strings.length) {
            body += '<div style="margin-top:8px;font-size:12px;color:#909399;">二维码原文：</div>'
                + '<div style="font-size:12px;word-break:break-all;background:#f5f7fa;padding:6px;border-radius:4px;max-height:120px;overflow:auto;">' + self._escape(strings.join('\n')) + '</div>';
        } else {
            body += '<div style="margin-top:8px;font-size:13px;color:#e6a23c;"><i class="fas fa-info-circle"></i> 未在发票中扫描到二维码</div>';
        }
        let ov = document.getElementById('invoiceQrOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'invoiceQrOverlay';
            ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;padding:16px;';
            document.body.appendChild(ov);
            ov.addEventListener('click', function (e) { if (e.target === ov) ov.style.display = 'none'; });
        }
        ov.innerHTML = '<div style="background:#fff;border-radius:10px;max-width:620px;width:100%;max-height:86vh;overflow:auto;padding:16px;">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
            + '<h4 style="margin:0;font-size:15px;"><i class="fas fa-qrcode" style="color:#409eff;"></i> 发票二维码扫描结果</h4>'
            + '<button type="button" onclick="document.getElementById(\'invoiceQrOverlay\').style.display=\'none\'" style="border:none;background:transparent;font-size:18px;cursor:pointer;color:#909399;"><i class="fas fa-times"></i></button></div>'
            + body + '</div>';
        ov.style.display = 'flex';
    },
    async _invoiceVerify(listKey, idx) {
        const inv = this._invoiceList(listKey)[idx];
        if (!inv) return;
        if (!inv.invoice_number) { this.showToast('缺少发票号码，无法验真', true); return; }
        const box = document.getElementById('invVerify_' + listKey + '_' + idx);
        inv._verifyBusy = true;
        if (box) box.innerHTML = '<span style="color:#909399;font-size:12px;"><i class="fas fa-spinner fa-spin"></i> 验真中…</span>';
        try {
            const r = await this.apiPost(OA_API_URL + '/approval/verify-invoice/', {
                invoice_number: inv.invoice_number, invoice_code: inv.invoice_code || '',
                invoice_date: inv.invoice_date || '', invoice_type: inv.invoice_type || '',
                invoice_amount: inv.invoice_amount || '', check_code: inv.check_code || '',
                ocr_raw_data: inv.ocr_raw_data || {}
            });
            inv.verify = r || {};
            if (box) box.innerHTML = this._invoiceVerifyHtml(inv.verify);
        } catch (e) {
            if (box) box.innerHTML = '<span style="color:#f56c6c;font-size:12px;"><i class="fas fa-circle-xmark"></i> ' + this._escape((e && e.message) || '发票验真失败') + '</span>';
        } finally {
            inv._verifyBusy = false;
        }
    },
    _openInvoicePreview(url, name) {
        if (!url) return;
        const self = this;
        let ov = document.getElementById('invoicePreviewOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'invoicePreviewOverlay';
            ov.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(0,0,0,0.88);display:none;align-items:center;justify-content:center;touch-action:none;';
            ov.innerHTML = '<div style="position:absolute;top:12px;right:14px;display:flex;gap:8px;z-index:2;">'
                + '<button type="button" onclick="approvalApp._invoiceZoom(-1)" style="width:38px;height:38px;border:none;border-radius:50%;background:rgba(255,255,255,0.9);cursor:pointer;font-size:18px;"><i class="fas fa-search-minus"></i></button>'
                + '<button type="button" onclick="approvalApp._invoiceZoom(1)" style="width:38px;height:38px;border:none;border-radius:50%;background:rgba(255,255,255,0.9);cursor:pointer;font-size:18px;"><i class="fas fa-search-plus"></i></button>'
                + '<button type="button" onclick="approvalApp._invoiceZoom(0)" style="height:38px;padding:0 14px;border:none;border-radius:19px;background:rgba(255,255,255,0.9);cursor:pointer;font-size:13px;">重置</button>'
                + '<button type="button" onclick="approvalApp._closeInvoicePreview()" style="width:38px;height:38px;border:none;border-radius:50%;background:rgba(255,255,255,0.9);cursor:pointer;font-size:18px;"><i class="fas fa-times"></i></button></div>'
                + '<div id="invoicePreviewWrap" style="width:100%;height:100%;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:zoom-out;touch-action:none;">'
                + '<img id="invoicePreviewImg" alt="" style="max-width:96vw;max-height:92vh;transform-origin:center center;user-select:none;pointer-events:none;-webkit-user-drag:none;"></div>'
                + '<div style="position:absolute;left:0;right:0;bottom:max(14px,env(safe-area-inset-bottom,0px));text-align:center;color:rgba(255,255,255,.72);font-size:12px;pointer-events:none;">双指缩放 / 拖拽查看，点击图片返回</div>';
            document.body.appendChild(ov);
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') self._closeInvoicePreview(); });
            let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false, lastTouch = 0;
            const wrap = document.getElementById('invoicePreviewWrap');
            wrap.addEventListener('mousedown', function (e) { if (Date.now() - lastTouch < 700) return; dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = self._invPanX || 0; oy = self._invPanY || 0; wrap.style.cursor = 'grabbing'; e.preventDefault(); });
            window.addEventListener('mousemove', function (e) { if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true; self._invPanX = ox + dx; self._invPanY = oy + dy; self._applyInvoiceTransform(); });
            window.addEventListener('mouseup', function () {
                if (!dragging) return;
                dragging = false;
                if (wrap) wrap.style.cursor = 'zoom-out';
                if (!moved) self._closeInvoicePreview();
            });
            wrap.addEventListener('wheel', function (e) { e.preventDefault(); self._invoiceZoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
            let tsx = 0, tsy = 0, tox = 0, toy = 0, tmoved = false, pinched = false, pinchD = 0, pinchS = 1;
            wrap.addEventListener('touchstart', function (e) {
                lastTouch = Date.now();
                if (e.touches.length === 2) { pinched = true; pinchD = self._invTouchDist(e); pinchS = self._invScale || 1; return; }
                if (e.touches.length !== 1) return;
                tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; tox = self._invPanX || 0; toy = self._invPanY || 0; tmoved = false;
            }, { passive: true });
            wrap.addEventListener('touchmove', function (e) {
                lastTouch = Date.now();
                if (e.touches.length === 2) {
                    e.preventDefault();
                    pinched = true;
                    if (!pinchD) { pinchD = self._invTouchDist(e); pinchS = self._invScale || 1; return; }
                    let s = pinchS * (self._invTouchDist(e) / pinchD);
                    self._invScale = Math.min(8, Math.max(0.25, s));
                    self._applyInvoiceTransform();
                    return;
                }
                if (e.touches.length !== 1) return;
                e.preventDefault();
                const dx = e.touches[0].clientX - tsx, dy = e.touches[0].clientY - tsy;
                if (Math.abs(dx) > 6 || Math.abs(dy) > 6) tmoved = true;
                self._invPanX = tox + dx; self._invPanY = toy + dy;
                self._applyInvoiceTransform();
            }, { passive: false });
            wrap.addEventListener('touchend', function (e) {
                lastTouch = Date.now();
                if (pinched) { if (e.touches.length === 0) pinched = false; return; }
                if (!tmoved) self._closeInvoicePreview();
            });
        }
        this._invScale = 1; this._invPanX = 0; this._invPanY = 0;
        const img = document.getElementById('invoicePreviewImg');
        this._applyInvoiceTransform();
        ov.style.display = 'flex';
        // PDF 经后端渲染为 PNG（需带鉴权），图片直接使用媒体地址
        if (/\.pdf$/i.test(url)) {
            fetch(OA_API_URL + '/approval/invoice-preview/?url=' + encodeURIComponent(url), { headers: TokenManager.getHeaders() })
                .then(function (r) { if (!r.ok) throw new Error('预览失败'); return r.blob(); })
                .then(function (b) { img.src = URL.createObjectURL(b); })
                .catch(function () { self.showToast('发票预览失败', true); self._closeInvoicePreview(); });
        } else {
            img.src = url;
        }
    },
    _invTouchDist(e) {
        const a = e.touches[0], b = e.touches[1];
        return Math.sqrt(Math.pow(a.clientX - b.clientX, 2) + Math.pow(a.clientY - b.clientY, 2));
    },
    _applyInvoiceTransform() {
        const img = document.getElementById('invoicePreviewImg');
        if (!img) return;
        const s = this._invScale || 1;
        img.style.transform = 'translate(' + (this._invPanX || 0) + 'px,' + (this._invPanY || 0) + 'px) scale(' + s + ')';
    },
    _invoiceZoom(dir) {
        if (dir === 0) { this._invScale = 1; this._invPanX = 0; this._invPanY = 0; }
        else {
            let s = (this._invScale || 1) + dir * 0.25;
            if (s < 0.25) s = 0.25;
            if (s > 8) s = 8;
            this._invScale = s;
        }
        this._applyInvoiceTransform();
    },
    _closeInvoicePreview() {
        const ov = document.getElementById('invoicePreviewOverlay');
        if (ov) ov.style.display = 'none';
    },

    // ===== 内置报销/采购：发票区块（form_data.invoices） =====
    _renderBuiltinInvoices(canOperate) {
        const box = document.getElementById('builtinInvoiceBlock');
        if (!box) return;
        const _max = this._currentInvoiceMax || 10;
        box.innerHTML = this._invoiceBlockHtml('__builtin__', { canOperate: !!canOperate, max: _max });
        this._renderInvoices('__builtin__', { canOperate: !!canOperate, max: _max });
    },
    _renderBuiltinInvoiceDetail(d) {
        const invoices = (d.form_data && Array.isArray(d.form_data.invoices)) ? d.form_data.invoices : [];
        if (!invoices.length) return '';
        const self = this;
        const canOp = this._isInvoiceOperator(d);
        const key = '__detail_' + d.id + '__';
        this._setInvoiceList(key, invoices);
        const cards = invoices.map(function (inv, i) {
            return self._invoiceCardHtml(key, inv, i, { readonly: true, canOperate: canOp });
        }).join('');
        return '<div class="detail-item full-width" style="border:1px solid #e8d5f5;border-radius:8px;padding:12px;background:#faf7ff;margin-top:8px;">'
            + '<div style="font-size:14px;font-weight:600;color:#9b59b6;margin-bottom:8px;border-bottom:1px solid #e8d5f5;padding-bottom:6px;"><i class="fas fa-file-invoice"></i> 发票（' + invoices.length + '）</div>'
            + '<div>' + cards + '</div></div>';
    },
    });
})();
