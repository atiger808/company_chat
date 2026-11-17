// static/js/approval-detail.js - 详情、附件预览、打印、审批操作与手写签名
// 说明：本文件为 ApprovalApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ApprovalApp.prototype, {

    // ==================== 详情 ====================

    async _openRelatedApproval(id) {
        // 在独立的新模态框中打开关联审批，保持当前详情不关闭
        var overlayId = 'relApprovalModal_' + id + '_' + Date.now();
        var overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.className = 'modal';
        overlay.style.cssText = 'z-index:2500;';
        overlay.innerHTML = '<div class="modal-content" style="max-width:800px;">'
            + '<div class="modal-header"><h3><i class="fas fa-link" style="color:#16a085;"></i> 关联审批详情</h3>'
            + '<span class="approval-detail-subtitle" style="font-size:12px;color:var(--text-light,#909399);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:280px;flex:1;margin-left:8px;"></span>'
            + '<div style="display:flex;align-items:center;gap:6px;"><button class="close-btn" onclick="approvalApp.closeModal(\'' + overlayId + '\')">&times;</button></div></div>'
            + '<div class="modal-body" style="max-height:70vh;overflow-y:auto;"></div>'
            + '<div class="modal-footer"><button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + overlayId + '\')">关闭</button></div>'
            + '</div>';
        document.body.appendChild(overlay);
        this._detailModalId = overlayId;
        try {
            await this.showDetail(id);
        } finally {
            this._detailModalId = null;
        }
    },

    async showDetail(id) {
        try {
            this._detailApprovalId = id;
            const d = await this.apiGet(OA_API_URL + '/approval/' + id + '/');
            // 支持在新模态框中打开（关联审批查看时保持当前详情不关闭）
            var modalId = this._detailModalId || 'approvalDetailModal';
            const statusMap = {
                'draft': '草稿',
                'pending': '待审批',
                'approved': '已通过',
                'rejected': '已驳回',
                'deferred': '暂缓',
                'processing': '办理中',
                'cancelled': '已撤回'
            };
            const scMap = {
                'draft': 'badge-default',
                'pending': 'badge-info',
                'approved': 'status-badge normal',
                'rejected': 'status-badge late',
                'deferred': 'status-badge deferred',
                'processing': 'status-badge processing',
                'cancelled': 'badge-default'
            };
            const tMap = {
                'leave': '请假',
                'overtime': '加班',
                'expense': '报销',
                'trip': '出差',
                'purchase': '采购',
                'recruit': '招聘需求',
                'other': '其他'
            };
            const defAv = '/static/images/default-avatar.png';
            var currentUserId = parseInt(localStorage.getItem('user_id'));
            // 记录该审批是否需要手写签名 / 是否开启票据回传
            this._currentApprovalRequireSignature = d.require_signature ? true : false;
            this._currentApprovalEnableReceipt = !!d.enable_receipt_return;

            console.log('_currentApprovalRequireSignature:::', this._currentApprovalRequireSignature);

            var modeLabel = '';
            if (d.sign_type === 'countersign') modeLabel = '会签';
            else modeLabel = '或签';
            if (d.approval_mode === 'sequential') modeLabel += ' · 顺序审批';
            else modeLabel += ' · 并行审批';

            // 审批方式/模式醒目提示：避免审批人误以为所有审批都是顺序审批
            var modeDescMap = {
                'countersign-sequential': '按节点依次审批：每个节点的全部审批人都通过后，才进入下一节点；任一节点有人驳回则整体驳回。',
                'countersign-parallel': '所有节点同时进行：每个节点需该节点全部审批人通过，全部节点完成后审批结束。',
                'orsign-sequential': '按节点依次审批：每个节点任一审批人通过即进入下一节点；任一节点有人驳回则整体驳回。',
                'orsign-parallel': '所有节点同时进行：每个节点任一审批人通过即完成，全部节点完成后审批结束。'
            };
            var modeKey = (d.sign_type === 'countersign' ? 'countersign' : 'orsign') + '-'
                + (d.approval_mode === 'sequential' ? 'sequential' : 'parallel');
            var modeColor = d.approval_mode === 'parallel' ? '#9b59b6' : '#409eff';
            var modeBanner = '<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:linear-gradient(90deg,#ecf5ff,#f0f9eb);border:1px solid #c6e2ff;border-left:4px solid ' + modeColor + ';border-radius:8px;margin-bottom:12px;">'
                + '<i class="fas fa-sitemap" style="color:' + modeColor + ';font-size:16px;margin-top:2px;flex-shrink:0;"></i>'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:14px;font-weight:700;color:#303133;margin-bottom:2px;">当前审批方式：' + modeLabel + '</div>'
                + '<div style="font-size:12.5px;color:#606266;line-height:1.7;">' + (modeDescMap[modeKey] || '') + '</div>'
                + '</div></div>';

            // 已撤回的审批在顶部给出醒目提示（从工作通知/聊天跳转过来时尤其重要）
            var cancelledBanner = d.status === 'cancelled'
                ? '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fdf0ef;border:1px solid #f8d0cd;border-radius:8px;color:#c0392b;font-size:13px;margin-bottom:12px;"><i class="fas fa-ban" style="flex-shrink:0;"></i> <span>该审批已被发起人撤回（撤销），无需继续处理。</span></div>'
                : '';

            // 审批请求ID（顶部展示 + 一键复制，方便用户报问题/互相检索）
            var idBanner = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px;background:var(--bg-secondary,#f5f7fa);border:1px solid var(--border-color,#ebeef5);border-radius:8px;font-size:13px;color:#606266;margin-bottom:12px;">'
                + '<span><i class="fas fa-hashtag" style="color:#409eff;"></i> 审批ID</span>'
                + '<b style="font-size:16px;color:#409eff;letter-spacing:1px;cursor:pointer;" title="点击复制" onclick="approvalApp._copyText(\'' + d.id + '\')">' + d.id + '</b>'
                + '<button class="btn btn-secondary" onclick="approvalApp._copyText(\'' + d.id + '\')" title="复制审批ID" style="font-size:12px;padding:3px 10px;border:1px solid #409eff;border-radius:4px;color:#409eff;background:#fff;cursor:pointer;"><i class="fas fa-copy"></i> 复制</button>'
                + '<span style="font-size:12px;color:#909399;">可在审批列表的搜索框输入该ID快速定位</span>'
                + '</div>';

            // 已归档提示：归档人/时间/说明（审计复盘时可快速核对归档状态）
            var archivedBanner = d.is_archived
                ? '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;background:#fdf6ec;border:1px solid #f5dab1;border-radius:8px;color:#b88230;font-size:13px;margin-bottom:12px;">'
                    + '<i class="fas fa-box-archive" style="flex-shrink:0;"></i>'
                    + '<span>该审批已归档'
                    + (d.archived_at ? '（归档时间：' + this._escape(this._formatTime(d.archived_at)) : '')
                    + (d.archived_by_name ? '　归档人：' + this._escape(d.archived_by_name) : '')
                    + (d.is_archived ? '）' : '')
                    + (d.archive_note ? '　说明：' + this._escape(d.archive_note) : '')
                    + '</span></div>'
                : '';

            // 保留期限提示：本人已撤回 / 草稿的审批只保留 N 天，到期由系统自动删除（到期前一天会发通知）
            var lifecycle = d.lifecycle;
            var lifecycleBanner = lifecycle
                ? '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;background:#fdf0ef;border:1px solid #f8d0cd;border-radius:8px;color:#c0392b;font-size:13px;margin-bottom:12px;">'
                    + '<i class="fas fa-hourglass-half" style="flex-shrink:0;"></i>'
                    + '<span>该审批（' + this._escape(lifecycle.status === 'draft' ? '草稿' : '已撤回') + '）仅保存 <b>'
                    + lifecycle.keep_days + '</b> 天，将于 <b>' + this._escape(lifecycle.deadline) + '</b> 由系统自动删除'
                    + '（剩余 ' + lifecycle.remaining_days + ' 天）。'
                    + (lifecycle.notified ? '已发送过即将删除提醒，' : '')
                    + '如需保留请在到期前修改并重新提交。</span></div>'
                : '';

            let html = modeBanner + cancelledBanner + archivedBanner + lifecycleBanner + idBanner + '<div class="detail-grid">'
                + '<div class="detail-item" style="grid-column:1/-1;"><label><i class="fas fa-user-circle" style="color:var(--primary-color,#409eff);"></i> 申请人</label><span style="display:flex;align-items:center;gap:8px;"><img src="' + (d.applicant_avatar || defAv) + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">' + (d.applicant === currentUserId ? '我' : this._escape(d.applicant_name || '')) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-tag" style="color:#409eff;"></i> 审批标题</label><span>' + this._escape(d.title) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-list" style="color:#67c23a;"></i> 审批类型</label><span><span class="type-icon-badge type-' + d.approval_type + '" style="background:' + this._hexA((d.approval_type_color || this._getTypeColor(d.approval_type)), 0.14) + ';color:' + (d.approval_type_color || this._getTypeColor(d.approval_type)) + ';"><i class="fas ' + (d.approval_type_icon || this._getTypeIcon(d.approval_type)) + '"></i> ' + this._escape(d.approval_type_name || d.approval_type_display || d.approval_type) + '</span></span></div>'
                + '<div class="detail-item"><label><i class="fas fa-building" style="color:#e6a23c;"></i> 所属部门</label><span>' + this._escape(d.department_name || '-') + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-sitemap" style="color:#9b59b6;"></i> 审批方式</label><span>' + modeLabel + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-info-circle" style="color:#909399;"></i> 状态</label><span class="' + (scMap[d.status] || '') + '"><i class="fas ' + this._statusIcon(d.status) + '" style="margin-right:4px;"></i>' + (statusMap[d.status] || d.status) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-clock" style="color:#909399;"></i> 创建时间</label><span>' + this._formatTime(d.created_at) + '</span></div>'
                + '<div class="detail-item"><label><i class="fas fa-sync" style="color:#909399;"></i> 更新时间</label><span>' + this._formatTime(d.updated_at) + '</span></div>';

            if (d.start_date) html += '<div class="detail-item"><label><i class="fas fa-calendar-alt" style="color:var(--primary-color,#409eff);"></i> 开始日期</label><span>' + d.start_date + '</span></div>';
            if (d.end_date) html += '<div class="detail-item"><label><i class="fas fa-calendar-check" style="color:#67c23a;"></i> 结束日期</label><span>' + d.end_date + '</span></div>';
            if (d.duration) {
                var durLabel = d.approval_type === 'overtime' ? '小时数' : '天数';
                html += '<div class="detail-item"><label><i class="fas fa-clock" style="color:#e6a23c;"></i> ' + durLabel + '</label><span>' + d.duration + '</span></div>';
            }
            if (d.amount) html += '<div class="detail-item"><label><i class="fas fa-money-bill-wave" style="color:#67c23a;"></i> 金额</label><span>¥' + parseFloat(d.amount).toFixed(2) + '</span></div>';
            if (d.expense_type) html += '<div class="detail-item"><label><i class="fas fa-tags" style="color:#e6a23c;"></i> 费用类型</label><span>' + (d.expense_type_display || d.expense_type) + '</span></div>';
            if (d.expense_date) html += '<div class="detail-item"><label><i class="fas fa-calendar-day" style="color:#409eff;"></i> 费用日期</label><span>' + d.expense_date + '</span></div>';
            if (d.approver_comment) html += '<div class="detail-item" style="grid-column:1/-1;"><label><i class="fas fa-comment-dots" style="color:#e6a23c;"></i> 审批意见</label><span>' + this._escape(d.approver_comment) + '</span></div>';

            // 附件预览
            if (d.attachments && d.attachments.length) {
                var attachUrls = d.attachments;
                html += '<div class="detail-item full-width"><label><i class="fas fa-paperclip" style="color:#909399;"></i> 附件</label><div style="display:flex;flex-wrap:wrap;gap:8px;">';
                attachUrls.forEach(function (url, idx) {
                    var name = url;
                    var origName = '';
                    if (typeof url === 'object' && url !== null) {
                        name = url.name || '附件';
                        origName = url.name || '';
                        url = url.url || url;
                    } else {
                        name = (url || '').split('/').pop() || '附件';
                        origName = name;
                    }
                    var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    var isVideo = name.match(/\.(mp4|avi|mov|webm)$/i);
                    var isAudio = name.match(/\.(mp3|wav|ogg)$/i);
                    var isDoc = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i);
                    if (isImg) {
                        html += '<a href="javascript:void(0)" onclick="approvalApp._previewImage(' + idx + ')" style="display:inline-block;" title="' + approvalApp._escape(origName) + '"><img src="' + url + '" style="width:80px;height:80px;border-radius:6px;object-fit:cover;border:1px solid var(--border-color,#dcdfe6);cursor:pointer;" title="' + approvalApp._escape(origName) + '"></a>';
                    } else if (isVideo) {
                        html += '<div style="display:inline-block;width:180px;vertical-align:top;"><video src="' + url + '" controls style="width:100%;border-radius:6px;border:1px solid var(--border-color,#dcdfe6);" title="' + approvalApp._escape(origName) + '"></video><div style="font-size:11px;color:#909399;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">' + approvalApp._escape(origName) + '</div></div>';
                    } else if (isAudio) {
                        html += '<div style="display:inline-block;width:220px;vertical-align:top;padding:8px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;border:1px solid var(--border-color,#dcdfe6);"><audio src="' + url + '" controls style="width:100%;" title="' + approvalApp._escape(origName) + '"></audio><div style="font-size:11px;color:#909399;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;">' + approvalApp._escape(origName) + '</div></div>';
                    } else if (isDoc) {
                        html += '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(origName) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:#f0f9eb;border:1px solid #b7eb8f;border-radius:6px;text-decoration:none;color:#135200;font-size:12px;max-width:80%;cursor:pointer;" title="保存到网盘并在线编辑"><i class="fas fa-cloud-upload-alt" style="color:#52c41a;flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(origName) + '</span></a>';
                    } else {
                        var otherIcon = approvalApp._getFileIcon(origName);
                        html += '<span style="display:inline-flex;align-items:center;gap:4px;"><a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(origName) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;background:var(--bg-secondary,#f5f7fa);border-radius:6px;text-decoration:none;color:var(--text-primary);font-size:12px;max-width:90%;cursor:pointer;" title="保存到网盘"><i class="fas ' + otherIcon + '" style="color:var(--primary-color,#409eff);flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + approvalApp._escape(origName) + '</span></a><a href="' + url + '" download="' + approvalApp._escape(origName) + '" target="_blank" title="下载" style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#f0f2f5;text-decoration:none;flex-shrink:0;"><i class="fas fa-cloud-download-alt" style="color:#409eff;font-size:12px;"></i></a></span>';
                    }
                });
                html += '</div></div>';
                // 保存附件URL列表供预览使用
                this._previewUrls = attachUrls;
            }

            // 抄送人显示（支持用户和部门）
            if (d.cc_users && d.cc_users.length) {
                html += '<div class="detail-item full-width"><label><i class="fas fa-eye" style="color:#9b59b6;"></i> 抄送人</label><div style="display:flex;flex-wrap:wrap;gap:6px;">';
                d.cc_users.forEach(function (cc) {
                    if (cc.cc_type === 'department') {
                        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px 3px 4px;background:#e8f4fd;border-radius:14px;font-size:12px;" title="部门抄送：该部门全部成员均可查看">'
                            + '<i class="fas fa-building" style="font-size:12px;color:#409eff;"></i>'
                            + approvalApp._escape(cc.name)
                            + (cc.manager_name ? ' <span style="font-size:10px;color:#909399;">(' + approvalApp._escape(cc.manager_name) + ')</span>' : '')
                            + '</span>';
                    } else {
                        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px 3px 4px;background:#f3e8ff;border-radius:14px;font-size:12px;">'
                            + '<img src="' + (cc.avatar || '/static/images/default-avatar.png') + '" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">'
                            + approvalApp._escape(cc.name) + '</span>';
                    }
                });
                html += '</div></div>';
            }

            // 关联审批展示（报销关联采购等）
            if (d.related_approval_list && d.related_approval_list.length) {
                var relStatusMap = {draft: '草稿', pending: '待审批', approved: '已通过', rejected: '已驳回', deferred: '暂缓', processing: '办理中', cancelled: '已撤回'};
                html += '<div class="detail-item full-width"><label><i class="fas fa-link" style="color:#16a085;"></i> 关联审批</label><div style="display:flex;flex-wrap:wrap;gap:6px;">';
                d.related_approval_list.forEach(function (ra) {
                    var rsc = relStatusMap[ra.status] || ra.status || '';
                    html += '<a href="javascript:void(0)" onclick="approvalApp._openRelatedApproval(' + ra.id + ')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#e8f6f3;border:1px solid #b2e0d8;border-radius:14px;font-size:12px;color:#0f766e;text-decoration:none;cursor:pointer;" title="点击查看关联审批">'
                        + '<i class="fas fa-link" style="font-size:11px;"></i>'
                        + approvalApp._escape(ra.title)
                        + ' <span style="font-size:10px;color:#909399;">' + approvalApp._escape(ra.approval_type_display || ra.approval_type) + ' · ' + approvalApp._escape(rsc) + '</span>'
                        + '</a>';
                });
                html += '</div></div>';
            }

            // 请假类型
            if (d.approval_type === 'leave' && d.leave_type) {
                html += '<div class="detail-item full-width"><label><i class="fas fa-bed" style="color:#409eff;"></i> 请假类型</label><span>' + this._escape(d.leave_type) + '</span></div>';
            }
            // 出差信息
            if (d.approval_type === 'trip' && d.trip_data && typeof d.trip_data === 'object') {
                var td = d.trip_data;
                var tripParts = [];
                if (td.reason) tripParts.push('事由：' + td.reason);
                if (td.place) tripParts.push('地点：' + td.place);
                if (td.days) tripParts.push('天数：' + td.days + ' 天');
                if (td.amount) tripParts.push('金额：¥' + td.amount);
                if (td.remark) tripParts.push('备注：' + td.remark);
                if (tripParts.length) html += '<div class="detail-item full-width"><label><i class="fas fa-plane" style="color:#16a085;"></i> 出差信息</label><span>' + this._escape(tripParts.join('；')) + '</span></div>';
            }
            // 采购物项
            if (d.approval_type === 'purchase' && d.purchase_items && d.purchase_items.length) {
                var pit = d.purchase_items;
                html += '<div class="detail-item full-width"><label><i class="fas fa-cart-plus" style="color:#e6a23c;"></i> 采购物项</label><div style="overflow-x:auto;">'
                    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;"><thead><tr style="background:var(--bg-secondary,#f5f7fa);"><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">商品名称</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">数量</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">单价(¥)</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">总价(¥)</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">备注</th></tr></thead><tbody>';
                pit.forEach(function (it) {
                    html += '<tr><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.name || '') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + (it.qty || 0) + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + (it.price != null ? it.price : '-') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);font-weight:600;">' + (it.total != null ? Number(it.total).toFixed(2) : '0.00') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.remark || '') + '</td></tr>';
                });
                var pTotal = pit.reduce(function (s, it) { return s + (parseFloat(it.total) || 0); }, 0);
                html += '<tr style="background:var(--bg-secondary,#f5f7fa);"><td colspan="3" style="padding:5px;border:1px solid var(--border-color,#dcdfe6);text-align:right;"><b>采购总金额</b></td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);font-weight:700;color:#e6a23c;">' + pTotal.toFixed(2) + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);"></td></tr>';
                html += '</tbody></table></div></div>';
            }
            // 报销项目
            if (d.approval_type === 'expense' && d.expense_items && d.expense_items.length) {
                var eit = d.expense_items;
                html += '<div class="detail-item full-width"><label><i class="fas fa-receipt" style="color:#67c23a;"></i> 报销项目</label><div style="overflow-x:auto;">'
                    + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px;"><thead><tr style="background:var(--bg-secondary,#f5f7fa);"><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">项目名称</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">金额(¥)</th><th style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">备注</th></tr></thead><tbody>';
                eit.forEach(function (it) {
                    html += '<tr><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.name || '') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + (it.amount != null ? Number(it.amount).toFixed(2) : '0.00') + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);">' + approvalApp._escape(it.remark || '') + '</td></tr>';
                });
                var eTotal = eit.reduce(function (s, it) { return s + (parseFloat(it.amount) || 0); }, 0);
                html += '<tr style="background:var(--bg-secondary,#f5f7fa);"><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);text-align:right;"><b>报销总金额</b></td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);font-weight:700;color:#67c23a;">' + eTotal.toFixed(2) + '</td><td style="padding:5px;border:1px solid var(--border-color,#dcdfe6);"></td></tr>';
                html += '</tbody></table></div></div>';
            }
            // 收款方式/收款信息展示（仅超级管理员、申请人、最终审批节点审批人可见，保护申请人隐私）
            if (d.payment_method && d.payment_method.type && d.can_view_payment) {
                var pm = d.payment_method;
                // 左侧：收款信息文本（仅显示已填写字段）
                var payee = '<div style="font-size:13px;line-height:1.8;">'
                    + '<div style="margin-bottom:4px;"><span style="color:#909399;">方式：</span><b>' + this._escape(pm.type === 'custom' ? '自定义收款方式' : '默认收款账号') + '</b></div>'
                    + (pm.payee_name ? '<div style="margin-bottom:2px;"><span style="color:#909399;">收款人：</span><b>' + this._escape(pm.payee_name) + '</b></div>' : '')
                    + (pm.bank_card ? '<div style="margin-bottom:2px;"><span style="color:#909399;">银行卡号：</span>' + this._escape(pm.bank_card) + '</div>' : '')
                    + (pm.bank_name ? '<div style="margin-bottom:2px;"><span style="color:#909399;">开户银行：</span>' + this._escape(pm.bank_name) + '</div>' : '')
                    + (pm.bank_address ? '<div style="margin-bottom:2px;"><span style="color:#909399;">开户银行地址：</span>' + this._escape(pm.bank_address) + '</div>' : '')
                    + (pm.alipay_account ? '<div style="margin-bottom:2px;"><span style="color:#909399;">支付宝账号：</span>' + this._escape(pm.alipay_account) + '</div>' : '')
                    + (pm.wechat_account ? '<div style="margin-bottom:2px;"><span style="color:#909399;">微信账号：</span>' + this._escape(pm.wechat_account) + '</div>' : '')
                    + '</div>';
                // 右侧：收款二维码（如有）
                var qrHtml = '';
                var qrItem = function (u, label) {
                    return '<div style="text-align:center;flex:0 0 auto;"><img src="' + approvalApp._escape(u) + '" style="width:88px;height:88px;max-width:88px;border-radius:8px;object-fit:cover;border:1px solid #dcdfe6;cursor:zoom-in;background:#fff;" onclick="approvalApp._previewImageByUrl(this.src,\'' + label + '\')" title="点击放大预览"><div style="font-size:11px;color:#909399;margin-top:2px;">' + label + '</div></div>';
                };
                if (pm.alipay_qr) qrHtml += qrItem(pm.alipay_qr, '支付宝收款码');
                if (pm.wechat_qr) qrHtml += qrItem(pm.wechat_qr, '微信收款码');
                var hasInfo = pm.payee_name || pm.bank_card || pm.alipay_account || pm.wechat_account;
                if (hasInfo || qrHtml) {
                    html += '<div class="detail-item full-width" style="background:var(--bg-secondary,#f5f7fa);border-radius:6px;padding:8px 10px;"><label><i class="fas fa-wallet" style="color:#16a085;"></i> 收款方式</label><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;flex:1;">'
                        + '<div style="flex:1;min-width:200px;">' + payee + '</div>'
                        + (qrHtml ? '<div style="display:flex;gap:10px;flex-wrap:wrap;flex:0 0 auto;">' + qrHtml + '</div>' : '')
                        + '</div></div>';
                }
            }
            // 票据回传：最终审批通过后申请人在时限内回传付款凭证/票据
            html += this._renderReceiptSection(d);
            // 招聘需求详情展示
            if (d.approval_type === 'recruit' && d.recruit_data) {
                var rd = d.recruit_data;
                var urgencyText = {
                    'normal': '常规（7-15个工作日）',
                    'urgent': '紧急（3-7个工作日）',
                    'critical': '特急（3个工作日内）'
                };
                var empText = {'fulltime': '全职正式岗', 'parttime': '兼职岗', 'temporary': '临时顶岗'};
                var staffText = {'annual': '年度核定编制内招聘', 'supplement': '临时增补超编招聘'};
                var self = this;
                html += '<div class="detail-item full-width" style="border:1px solid #fef3e0;border-radius:8px;padding:12px;background:#fffbf0;margin-top:8px;">'
                    + '<div style="font-size:14px;font-weight:600;color:#e67e22;margin-bottom:8px;border-bottom:1px solid #fef3e0;padding-bottom:6px;"><i class="fas fa-user-plus"></i> 招聘需求详情</div>'
                    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">'
                    + '<div><strong>岗位名称：</strong>' + self._escape(rd.position_name || '-') + '</div>'
                    + '<div><strong>招聘人数：</strong>' + (rd.headcount || 0) + '人</div>'
                    + '<div style="grid-column:1/-1;"><strong>编制属性：</strong>' + (staffText[rd.staffing_type] || rd.staffing_type) + '</div>'
                    + (rd.staffing_remark ? '<div style="grid-column:1/-1;"><strong>超编说明：</strong>' + self._escape(rd.staffing_remark) + '</div>' : '')
                    + '<div style="grid-column:1/-1;margin-top:4px;"><strong>岗位职责：</strong><br>' + self._escape(rd.responsibilities || '-').replace(/\n/g, '<br>') + '</div>'
                    + '<div style="grid-column:1/-1;margin-top:4px;"><strong>① 基础条件：</strong>' + self._escape(rd.basic_requirement || '-') + '</div>'
                    + '<div style="grid-column:1/-1;"><strong>② 工作经验：</strong>' + self._escape(rd.experience_requirement || '-') + '</div>'
                    + '<div style="grid-column:1/-1;"><strong>③ 专业技能：</strong>' + self._escape(rd.skill_requirement || '-') + '</div>'
                    + '<div style="grid-column:1/-1;"><strong>④ 综合素养：</strong>' + self._escape(rd.soft_requirement || '-') + '</div>'
                    + '<div><strong>薪资区间：</strong>' + (rd.salary_min || 0) + ' - ' + (rd.salary_max || 0) + ' 元/月</div>'
                    + '<div><strong>薪资结构：</strong>' + self._escape(rd.salary_structure || '-') + '</div>'
                    + '<div><strong>最迟到岗：</strong>' + (rd.arrival_year || '----') + '年' + (rd.arrival_month || '--') + '月' + (rd.arrival_day || '--') + '日</div>'
                    + '<div><strong>紧急程度：</strong>' + (urgencyText[rd.urgency] || rd.urgency) + '</div>'
                    + '<div><strong>用工性质：</strong>' + (empText[rd.employment_type] || rd.employment_type) + '</div>'
                    + (rd.special_requirements ? '<div style="grid-column:1/-1;"><strong>特殊要求：</strong>' + self._escape(rd.special_requirements) + '</div>' : '')
                    + '</div></div>';
            }

            // 物资单据：显眼展示单据号 + 复制按钮（方便申请人凭单号发起领用/领料）
            if ((d.approval_type === 'material_requirement' || d.approval_type === 'material_requisition' || d.approval_type === 'material_stock_in')
                && d.form_data && d.form_data.doc_no) {
                var _docNo = String(d.form_data.doc_no);
                var _docLabel = d.approval_type === 'material_requirement' ? '物资需求单号'
                    : (d.approval_type === 'material_requisition' ? '物资领用单号' : '物资入库单号');
                var _isStockIn = d.approval_type === 'material_stock_in';
                var _isRequisition = d.approval_type === 'material_requisition';
                var _reqId = (d.form_data.link_req && (d.form_data.link_req.requirement_id || d.form_data.link_req.id));
                html += '<div class="detail-item" style="grid-column:1/-1;background:#f0f9eb;border:1px solid #cdeeda;border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
                    + '<label style="margin:0;"><i class="fas fa-hashtag" style="color:#16a085;"></i> ' + _docLabel + '</label>'
                    + '<span style="font-size:18px;font-weight:700;color:#16a085;letter-spacing:1px;cursor:pointer;" title="点击复制" onclick="approvalApp._copyText(\'' + this._escape(_docNo) + '\')">' + this._escape(_docNo) + '</span>'
                    + '<button class="btn btn-secondary" onclick="approvalApp._copyText(\'' + this._escape(_docNo) + '\')" title="复制单据号" style="font-size:12px;padding:3px 10px;border:1px solid #16a085;border-radius:4px;color:#16a085;background:#fff;cursor:pointer;"><i class="fas fa-copy"></i> 复制</button>'
                    + ((_isRequisition || _isStockIn) && d.form_data.requirement_doc_no ? '<span style="font-size:12px;color:#909399;">关联需求单：' + this._escape(d.form_data.requirement_doc_no) + '</span>' : '')
                    + (_isStockIn && d.form_data.warehouse ? '<span style="font-size:12px;color:#909399;">仓库/库位：' + this._escape(d.form_data.warehouse) + '</span>' : '')
                    + (_isStockIn && d.form_data.stock_date ? '<span style="font-size:12px;color:#909399;">入库日期：' + this._escape(d.form_data.stock_date) + '</span>' : '')
                    + ((_isRequisition || _isStockIn) && _reqId
                        ? '<button class="btn btn-secondary" onclick="approvalApp._openRequirementDetail(\'' + this._escape(_reqId) + '\')" title="查看需求单详情" style="font-size:12px;padding:3px 10px;border:1px solid #16a085;border-radius:4px;color:#16a085;background:#fff;cursor:pointer;"><i class="fas fa-box-open"></i> 查看需求单</button>'
                        : '')
                    + '</div>';
            }

            // 自定义审批类型 / 带表单内置类型（物资需求单/领用单）：动态表单详情
            if (!this._isBuiltinType(d.approval_type) || this._isDynamicSchemaType(d.approval_type)) {
                var dynType = this._getType(d.approval_type);
                if (dynType && dynType.form_schema && dynType.form_schema.length) {
                    this._detailApproval = d;
                    html += this._renderDynamicDetail(d.form_data || {}, dynType.form_schema, d.form_data_display || {});
                }
            }

            // 内置报销/采购：发票详情（审批人/超管可二维码扫描、发票验真、放大预览）
            if ((d.approval_type === 'expense' || d.approval_type === 'purchase')
                && d.form_data && Array.isArray(d.form_data.invoices) && d.form_data.invoices.length) {
                html += approvalApp._renderBuiltinInvoiceDetail(d);
            }

            if (d.content) html += '<div class="detail-item full-width"><label><i class="fas fa-align-left" style="color:#606266;"></i> 审批内容</label><span>' + this._escape(d.content) + '</span></div>';
            html += '</div>';

            // 审批节点进度
            if (d.approval_nodes && d.approval_nodes.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-sitemap" style="color:#67c23a;margin-right:6px;"></i>审批流程 <span style="font-size:12px;font-weight:400;color:var(--text-light,#909399);">根据汇报关系</span></h4>';
                d.approval_nodes.forEach(function (node, ni) {
                    var isFinal = !!node.is_final_approver;
                    var icon = isFinal ? 'fa-user-shield' : (node.node_type === 'department' ? 'fa-building' : (node.node_type === 'initiator' ? 'fa-play-circle' : 'fa-user-check'));
                    var label = node.user_name || node.department_name || ('节点' + (ni + 1));
                    if (node.user_name && node.user_position) label += ', ' + node.user_position;
                    var typeLabel = isFinal
                        ? '最终审批人'
                        : (node.node_type === 'department' ? '部门审批' : (node.node_type === 'initiator' ? '发起人' : (ni === 0 ? '直属上级' : '上级审批')));
                    var borderColor = isFinal ? '#9b59b6' : (node.node_type === 'initiator' ? 'var(--primary-color,#409eff)' : '#67c23a');
                    var iconColor = isFinal ? '#9b59b6' : (node.node_type === 'initiator' ? 'var(--primary-color,#409eff)' : '#67c23a');
                    var badgeBg = isFinal ? '#f3e8ff' : '#fff';
                    var badgeColor = isFinal ? '#9b59b6' : 'var(--text-light,#909399)';
                    var srcLabel = isFinal ? (node.final_approver_source_label || '') : '';
                    html += '<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-secondary,#f5f7fa);border-radius:8px;border-left:3px solid ' + borderColor + ';">'
                        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><i class="fas ' + icon + '" style="color:' + iconColor + ';font-size:13px;"></i><span style="font-weight:600;font-size:14px;">' + label + '</span>'
                        + (srcLabel ? '<span style="font-size:10px;color:#9b59b6;background:#fff;border:1px solid #e8d5f5;padding:1px 8px;border-radius:4px;" title="最终审批人配置来源">' + approvalApp._escape(srcLabel) + '</span>' : '')
                        + '<span style="font-size:11px;color:' + badgeColor + ';background:' + badgeBg + ';padding:1px 8px;border-radius:4px;">' + typeLabel + '</span></div>';
                    (node.assignees || []).forEach(function (as) {
                        var stCls = as.status === 'approved' ? 'status-badge normal' : as.status === 'rejected' ? 'status-badge late' : as.status === 'deferred' ? 'status-badge deferred' : as.status === 'processing' ? 'status-badge processing' : 'badge-info';
                        var stTxt = as.status_display || (as.status === 'approved' ? '已通过' : as.status === 'rejected' ? '已驳回' : as.status === 'deferred' ? '暂缓' : as.status === 'processing' ? '办理中' : '待审批');
                        var av = as.user_avatar || defAv;
                        html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:4px;">'
                            + '<img src="' + av + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">'
                            + '<span style="flex:1;font-size:13px;">' + (as.user === currentUserId ? '我' : (as.user_name || '')) + (as.user_position ? '<span style="font-size:11px;color:#909399;margin-left:4px;">' + as.user_position + '</span>' : '') + (as.user_department ? '<span style="font-size:11px;color:#a0a0a0;margin-left:4px;">(' + approvalApp._escape(as.user_department) + ')</span>' : '') + '</span>'
                            + '<span class="' + stCls + '" style="font-size:11px;">' + stTxt + '</span>'
                            + (as.comment ? '<span style="flex:1;font-size:12px;color:var(--text-light);">: ' + as.comment + '</span>' : '')
                            // 发起人查看自己发起的审批时，对"待审批且节点已到达"的审批人提供"发送私聊"提醒
                            + (d.applicant === currentUserId && d.status === 'pending' && as.status === 'pending' && as.user !== currentUserId
                                && (d.approval_mode === 'parallel' || node.order <= (d.current_node_order || 0) || node.node_type === 'initiator')
                                ? '<button type="button" onclick="approvalApp.sendApprovalPrivate(' + d.id + ',' + as.user + ',this)" style="border:1px solid #409eff;color:#409eff;background:#fff;border-radius:4px;font-size:11px;padding:2px 8px;cursor:pointer;white-space:nowrap;flex-shrink:0;line-height:1.6;" title="以私聊形式发送给该审批人，对方点击可直接处理"><i class="fas fa-comment-dots" style="margin-right:2px;"></i>发送私聊</button>'
                                : '')
                            + '</div>';
                    });
                    html += '</div>';
                });
                html += '</div>';
            }

            // 审批日志时间线
            if (d.logs && d.logs.length) {
                html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border-color,#ebeef5);">'
                    + '<h4 style="font-size:15px;margin:0 0 12px 0;"><i class="fas fa-history" style="color:#9b59b6;margin-right:6px;"></i>审批记录</h4>'
                    + '<div class="approval-timeline">';
                d.logs.forEach(function (log) {
                    var actionText = log.action_display || (log.action === 'approve' ? '通过' : log.action === 'reject' ? '驳回' : log.action === 'deferred' ? '暂缓' : log.action === 'processing' ? '办理中' : log.action === 'resubmit' ? '重新提交' : log.action === 'cancel' ? '撤回' : log.action === 'receipt_return' ? '票据回传' : '');

                    var operatorName = (log.operator === currentUserId) ? '我' : (log.operator_name || '系统');
                    if (log.operator_position && log.operator !== currentUserId) operatorName += ', ' + log.operator_position;
                    var attachHtml = '';
                    if (log.attachments && log.attachments.length) {
                        attachHtml = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
                        log.attachments.forEach(function (att) {
                            var url = typeof att === 'object' ? (att.url || att) : att;
                            var name = typeof att === 'object' ? (att.name || '') : url.split('/').pop() || '';
                            var isLogImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                            var isLogVideo = name.match(/\.(mp4|avi|mov|webm)$/i);
                            var isLogAudio = name.match(/\.(mp3|wav|ogg)$/i);
                            var isLogDoc = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i);
                            if (isLogImg) {
                                attachHtml += '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(name) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-block;" title="' + approvalApp._escape(name) + '"><img src="' + url + '" style="width:48px;height:48px;border-radius:4px;object-fit:cover;border:1px solid #dcdfe6;cursor:pointer;"></a>';
                            } else if (isLogVideo) {
                                attachHtml += '<div style="display:inline-block;width:140px;vertical-align:top;"><video src="' + url + '" controls style="width:100%;border-radius:4px;border:1px solid #dcdfe6;"></video></div>';
                            } else if (isLogAudio) {
                                attachHtml += '<div style="display:inline-block;width:160px;vertical-align:top;padding:4px 8px;background:#f5f7fa;border-radius:4px;border:1px solid #dcdfe6;"><audio src="' + url + '" controls style="width:100%;"></audio></div>';
                            } else if (isLogDoc) {
                                var logDocIcon = approvalApp._getFileIcon(name);
                                attachHtml += '<a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(name) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;background:#f0f9eb;border:1px solid #b7eb8f;border-radius:4px;text-decoration:none;font-size:11px;color:#135200;cursor:pointer;"><i class="fas ' + logDocIcon + '" style="font-size:10px;color:#135200;"></i><i class="fas fa-cloud-upload-alt" style="font-size:10px;color:#52c41a;margin-left:1px;"></i><span>' + approvalApp._escape(name) + '</span></a>';
                            } else {
                                var logOtherIcon = approvalApp._getFileIcon(name);
                                attachHtml += '<span style="display:inline-flex;align-items:center;gap:3px;"><a href="javascript:void(0)" data-url="' + url + '" data-name="' + approvalApp._escape(name) + '" onclick="approvalApp._handleAttach(this)" style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;background:#fff;border:1px solid #dcdfe6;border-radius:4px;text-decoration:none;font-size:11px;color:#409eff;cursor:pointer;"><i class="fas ' + logOtherIcon + '" style="font-size:10px;"></i><span>' + approvalApp._escape(name) + '</span></a><a href="' + url + '" download="' + approvalApp._escape(name) + '" target="_blank" title="下载" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#f0f2f5;text-decoration:none;flex-shrink:0;"><i class="fas fa-cloud-download-alt" style="color:#409eff;font-size:10px;"></i></a></span>';
                            }
                        });
                        attachHtml += '</div>';
                    }
                    var signatureHtml = '';
                    if (log.signature) {
                        signatureHtml = '<div style="margin-top:6px;"><span style="font-size:11px;color:#909399;display:block;margin-bottom:2px;"><i class="fas fa-signature" style="color:#9b59b6;"></i> 手写签名</span>'
                            + '<a href="javascript:void(0)" onclick="approvalApp._previewSignature(this)" title="点击放大查看签名"><img src="' + log.signature + '" style="max-width:180px;max-height:80px;border:1px solid #e0e0e0;border-radius:4px;background:#fff;padding:4px;cursor:zoom-in;" alt="审批人签名"></a></div>';
                    }
                    html += '<div class="timeline-item ' + log.action + '">'
                        + '<div class="timeline-header">' + operatorName + (log.operator_position ? ' <span style="font-size:11px;color:var(--text-light,#909399);font-weight:400;">(' + log.operator_position + ')</span>' : '') + (log.operator_department ? ' <span style="font-size:11px;color:#a0a0a0;font-weight:400;">[' + approvalApp._escape(log.operator_department) + ']</span>' : '') + ' ' + actionText + '</div>'
                        + '<div class="timeline-time">' + (log.created_at ? new Date(log.created_at).toLocaleString() : '') + '</div>'
                        + (log.comment ? '<div class="timeline-comment">' + approvalApp._escape(log.comment) + '</div>' : '')
                        + attachHtml + signatureHtml + '</div>';
                });
                html += '</div></div>';
            }

            // 🔧 详情顶部：上一条 / 下一条（当前页列表上下文）
            var navHtml = '';
            if (this._listApprovalIds && this._listApprovalIds.length) {
                var listIdx = this._listApprovalIds.indexOf(d.id);
                if (listIdx !== -1) {
                    navHtml = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;background:linear-gradient(90deg,#ecf5ff,#f0f9eb);border-radius:8px;margin-bottom:12px;">'
                        + '<button class="btn btn-sm btn-secondary" onclick="approvalApp._navDetail(-1)"><i class="fas fa-chevron-left"></i> 上一条</button>'
                        + '<span style="font-size:13px;color:#606266;font-weight:600;">' + (listIdx + 1) + ' / ' + this._listApprovalIds.length + '</span>'
                        + '<button class="btn btn-sm btn-secondary" onclick="approvalApp._navDetail(1)">下一条 <i class="fas fa-chevron-right"></i></button>'
                        + '</div>';
                }
            }

            var detailContainer = document.getElementById(modalId);
            var bodyEl = detailContainer ? detailContainer.querySelector('.modal-body') : null;
            if (bodyEl) bodyEl.innerHTML = navHtml + html;
            // 票据回传：含发票字段时初始化回传发票列表（需在 DOM 插入后渲染）
            this._initReceiptInvoices(d);

            // 设置副标题（截取过长标题）
            var subEl = detailContainer ? detailContainer.querySelector('.approval-detail-subtitle') : null;
            if (subEl) {
                var titleText = d.title || '';
                subEl.textContent = titleText.length > 30 ? titleText.substring(0, 27) + '...' : titleText;
            }

            // 权限判断：仅当前到达节点的审批人可操作（超管不因身份获得审批按钮）
            var isApplicant = d.applicant === currentUserId;
            var isApprover = false;
            var isActiveApprover = false;
            if (d.approval_nodes) {
                for (var ni = 0; ni < d.approval_nodes.length; ni++) {
                    var node = d.approval_nodes[ni];
                    if (node.node_type === 'initiator') continue;
                    // 判断此节点是否已到达（顺序审批仅当前节点，并行审批全部节点）
                    var isNodeActive = (d.approval_mode !== 'sequential') || (node.order === d.current_node_order);
                    if (node.assignees) {
                        for (var ai = 0; ai < node.assignees.length; ai++) {
                            var asg = node.assignees[ai];
                            if (asg.user === currentUserId) {
                                isApprover = true;
                                // 仅待审批/暂缓/办理中的节点审批人可操作（已通过/驳回不显示）
                                if (isNodeActive && (asg.status === 'pending' || asg.status === 'deferred' || asg.status === 'processing')) {
                                    isActiveApprover = true;
                                }
                                break;
                            }
                        }
                    }
                }
            }

            // 底部按钮 — 根据角色显示
            const footer = detailContainer ? detailContainer.querySelector('.modal-footer') : null;
            if (d.status === 'pending') {
                var btns = '';
                if (isActiveApprover) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp._openActionModal(' + d.id + ',\'approve\',\'审批通过\')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp._openActionModal(' + d.id + ',\'reject\',\'驳回审批\')"><i class="fas fa-times"></i> 驳回</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'deferred\',\'暂缓审批\')" style="border-color:#e6a23c;color:#e67e22;"><i class="fas fa-pause-circle"></i> 暂缓</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'processing\',\'正在办理\')" style="border-color:#9b59b6;color:#9b59b6;"><i class="fas fa-spinner"></i> 办理</button>';
                }
                if (isApplicant) {
                    btns += ' <button class="btn btn-secondary" onclick="approvalApp.cancelApproval(' + d.id + ')"><i class="fas fa-undo"></i> 撤销</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'cancelled') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'' + modalId + '\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 重新编辑</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.deleteDraft(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'deferred' || d.status === 'processing') {
                var btns = '';
                if (isActiveApprover) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp._openActionModal(' + d.id + ',\'approve\',\'审批通过\')"><i class="fas fa-check"></i> 通过</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp._openActionModal(' + d.id + ',\'reject\',\'驳回审批\')"><i class="fas fa-times"></i> 驳回</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'deferred\',\'暂缓审批\')" style="border-color:#e6a23c;color:#e67e22;"><i class="fas fa-pause-circle"></i> 暂缓</button>'
                        + ' <button class="btn btn-secondary" onclick="approvalApp._openActionModal(' + d.id + ',\'processing\',\'正在办理\')" style="border-color:#9b59b6;color:#9b59b6;"><i class="fas fa-spinner"></i> 办理</button>';
                }
                if (isApplicant) {
                    btns += ' <button class="btn btn-secondary" onclick="approvalApp.cancelApproval(' + d.id + ')"><i class="fas fa-undo"></i> 撤销</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'rejected') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'' + modalId + '\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 继续编辑</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else if (d.status === 'draft') {
                var btns = '';
                if (isApplicant) {
                    btns += '<button class="btn btn-primary" onclick="approvalApp.closeModal(\'' + modalId + '\');setTimeout(function(){approvalApp.reEdit(' + d.id + ')},200)"><i class="fas fa-edit"></i> 继续编辑</button>'
                        + ' <button class="btn btn-danger" onclick="approvalApp.deleteDraft(' + d.id + ')"><i class="fas fa-trash"></i> 删除</button>';
                }
                btns += ' <button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
                footer.innerHTML = btns;
            } else {
                footer.innerHTML = '<button class="btn btn-secondary" onclick="approvalApp.closeModal(\'' + modalId + '\')">关闭</button> <button class="btn btn-secondary" onclick="approvalApp._printDetail()"><i class="fas fa-print"></i> 打印</button>';
            }
            // 归档 / 取消归档（超管或财务专员；仅「已通过」的审批可归档，后端二次校验）
            if (this._canArchive && (d.is_archived || d.status === 'approved')) {
                footer.innerHTML += (d.is_archived
                    ? ' <button class="btn btn-secondary" onclick="approvalApp.unarchiveApproval(' + d.id + ')"><i class="fas fa-box-open" style="color:#409eff;"></i> 取消归档</button>'
                    : ' <button class="btn btn-secondary" onclick="approvalApp.archiveApproval(' + d.id + ')"><i class="fas fa-box-archive" style="color:#e6a23c;"></i> 归档</button>');
            }


            var detailEl = document.getElementById(modalId);
            if (detailEl) {
                detailEl.style.display = 'flex';
                setTimeout(function () {
                    detailEl.classList.add('show');
                }, 10);
            }
        } catch (e) {
            console.error('加载详情失败:', e);
            var msg = (e && e.message) || '加载详情失败';
            // 审批已删除/不存在 → 给出明确提示（从工作通知/聊天跳转时尤其常见）
            if (msg.indexOf('不存在') !== -1 || msg.indexOf('删除') !== -1) {
                this.showAlert('审批已删除', '该审批已被删除或不存在，无法查看详情。');
            } else {
                this.showToast(msg, true);
            }
        }
    },

    // ==================== 附件图片预览+云文档 ====================

    /** 根据URL直接预览图片 */
    /** 预览手写签名图片（点击放大查看） */
    _previewSignature(el) {
        var img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (!img || !img.src) return;
        this._previewImageByUrl(img.src, '审批人手写签名');
    },

    _previewImageByUrl(url, name) {
        var overlay = document.createElement('div');
        overlay.id = 'approvalPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        overlay.innerHTML = '<span onclick="approvalApp._closePreview()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<img src="' + url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + approvalApp._escape(name || '') + '</div>';
        document.body.appendChild(overlay);
        this._previewImgs = null;
        this._previewOverlay = overlay;
        var self = this;
        var keyHandler = function (e) {
            if (e.key === 'Escape') {
                self._closePreview();
                e.preventDefault();
            }
        };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);
        // 🔧 点击图片/背景退出预览
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) self._closePreview();
        });
        var mainImg = overlay.querySelector('img');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function (e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                self._closePreview();
            });
        }
    },

    /** 统一附件处理：图片→预览，文档→保存到网盘并编辑，其他→保存到网盘并提示 */
    _handleAttach(el) {
        var url = el.getAttribute('data-url');
        var name = el.getAttribute('data-name') || '';
        if (!url) return;
        var isImg = name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        if (isImg) {
            this._previewImageByUrl(url, name);
        } else {
            this._saveToCloudAndOpen(url, name, el);
        }
    },

    /** 保存附件到网盘，文档打开在线编辑，其他文件提示已保存 */
    async _saveToCloudAndOpen(url, name, el) {
        try {
            var resp = await fetch('/api/cloud/files/save_from_url/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({url: url, name: name || url.split('/').pop() || '文档'})
            });
            if (!resp.ok) {
                window.open(url, '_blank');
                return;
            }
            var data = await resp.json();
            if (data.file_id) {
                var isDoc = name.match(/\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i);
                if (isDoc) {
                    window.open('/cloud/editor/?id=' + data.file_id, '_blank');
                } else {
                    console.log('已保存到我的网盘 → 文档（来自审批）文件夹');
                    this.showToast('已保存到我的网盘 → 文档（来自审批）文件夹', false);
                    // 如果点击的元素有对应的下载图标，高亮提示
                    if (el && el.parentNode) {
                        var dnIcon = el.parentNode.querySelector('.fa-cloud-download-alt');
                        if (dnIcon) {
                            dnIcon.style.color = '#52c41a';
                            dnIcon.parentNode.style.background = '#f0f9eb';
                        }
                    }
                }
            } else {
                window.open(url, '_blank');
            }
        } catch (e) {
            window.open(url, '_blank');
        }
    },

    // ==================== 图片预览 ====================

    _previewImage(idx) {
        var urls = this._previewUrls || [];
        var _getUrl = function (u) {
            return (typeof u === 'object' && u !== null) ? (u.url || u) : u;
        };
        var _getName = function (u) {
            return (typeof u === 'object' && u !== null) ? (u.name || '') : '';
        };
        var imgs = urls.filter(function (u) {
            var fn = _getName(u) || _getUrl(u).split('/').pop() || '';
            return fn.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        });
        if (!imgs.length) return;
        var currentIdx = 0;
        for (var i = 0; i < imgs.length; i++) {
            if (urls.indexOf(imgs[i]) >= idx && urls.indexOf(imgs[i]) <= idx) {
                currentIdx = i;
                break;
            }
        }
        var overlay = document.createElement('div');
        overlay.id = 'approvalPreviewOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.85);';
        var prevDisplay = imgs.length <= 1 ? 'opacity:0.2;cursor:default;pointer-events:none;' : '';
        overlay.innerHTML = '<span onclick="approvalApp._closePreview()" style="position:fixed;top:max(20px, env(safe-area-inset-top, 0px));right:30px;color:#fff;font-size:32px;cursor:pointer;z-index:10001;"><i class="fas fa-times"></i></span>'
            + '<span onclick="approvalApp._previewNav(-1)" id="approvalPrevBtn" style="position:fixed;left:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-left"></i></span>'
            + '<span onclick="approvalApp._previewNav(1)" id="approvalNextBtn" style="position:fixed;right:20px;top:50%;transform:translateY(-50%);z-index:10001;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(0,0,0,0.35);color:#fff;font-size:28px;cursor:pointer;' + prevDisplay + '"><i class="fas fa-chevron-right"></i></span>'
            + '<img id="previewMainImg" src="' + _getUrl(imgs[currentIdx]) + '" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
            + '<div id="previewCounter" style="position:fixed;bottom:30px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:14px;z-index:10001;">' + (currentIdx + 1) + ' / ' + imgs.length + '</div>';
        document.body.appendChild(overlay);
        this._previewImgs = imgs;
        this._previewCurrent = currentIdx;
        this._previewOverlay = overlay;
        var self = this;
        var keyHandler = function (e) {
            if (e.key === 'ArrowLeft') {
                self._previewNav(-1);
                e.preventDefault();
            } else if (e.key === 'ArrowRight') {
                self._previewNav(1);
                e.preventDefault();
            } else if (e.key === 'Escape') {
                self._closePreview();
                e.preventDefault();
            }
        };
        this._previewKeyHandler = keyHandler;
        document.addEventListener('keydown', keyHandler);

        // 🔧 触摸滑动：左右滑动切换图片（移动端）；双指捏合由 Utils.enableImagePinchZoom 处理
        var touchStartX = null, touchStartY = null, swiped = false;
        overlay.addEventListener('touchstart', function (e) {
            if (e.touches.length >= 2) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            swiped = false;
        }, {passive: true});
        overlay.addEventListener('touchmove', function (e) {
            if (e.touches.length >= 2) return;
            if (touchStartX !== null) {
                var dx = e.touches[0].clientX - touchStartX;
                var dy = e.touches[0].clientY - touchStartY;
                if (Math.abs(dx) > 30 || Math.abs(dy) > 30) swiped = true;
            }
        }, {passive: true});
        overlay.addEventListener('touchend', function (e) {
            if (e.changedTouches && e.changedTouches.length >= 2) { touchStartX = null; return; }
            if (touchStartX !== null) {
                var endX = e.changedTouches[0].clientX;
                var endY = e.changedTouches[0].clientY;
                var dx = endX - touchStartX, dy = endY - touchStartY;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                    self._previewNav(dx < 0 ? 1 : -1);  // 左滑下一张，右滑上一张
                }
            }
            touchStartX = null;
        }, {passive: true});

        // 🔧 点击图片切换预览模式（再点一次退出）；点击背景也退出
        overlay.addEventListener('click', function (e) {
            if (swiped) {
                swiped = false;
                return;
            }  // 刚滑动过，忽略本次点击
            if (e.target === overlay) self._closePreview();
        });
        var mainImg = document.getElementById('previewMainImg');
        if (mainImg) {
            Utils.enableImagePinchZoom(mainImg);
            mainImg.addEventListener('click', function (e) {
                e.stopPropagation();
                if (mainImg._pz && mainImg._pz.scale > 1.01) return;  // 缩放中不关闭
                if (swiped) {
                    swiped = false;
                    return;
                }
                self._closePreview();
            });
        }
    },

    _closePreview() {
        if (this._previewOverlay) {
            this._previewOverlay.remove();
            this._previewOverlay = null;
        }
        if (this._previewKeyHandler) {
            document.removeEventListener('keydown', this._previewKeyHandler);
            this._previewKeyHandler = null;
        }
    },

    _previewNav(dir) {
        if (!this._previewImgs || !this._previewImgs.length) return;
        var len = this._previewImgs.length;
        if (dir < 0 && this._previewCurrent <= 0) {
            this._approvalShowTip('已是第一张');
            return;
        }
        if (dir > 0 && this._previewCurrent >= len - 1) {
            this._approvalShowTip('已是最后一张');
            return;
        }
        this._previewCurrent += dir;
        var img = document.getElementById('previewMainImg');
        var item = this._previewImgs[this._previewCurrent];
        var src = (typeof item === 'object' && item !== null) ? (item.url || item) : item;
        if (img) {
            img.src = src;
            Utils.resetImageZoom(img);
        }
        var counter = document.getElementById('previewCounter');
        if (counter) counter.textContent = (this._previewCurrent + 1) + ' / ' + this._previewImgs.length;
        var p = document.getElementById('approvalPrevBtn');
        var n = document.getElementById('approvalNextBtn');
        if (p) {
            p.style.opacity = this._previewCurrent <= 0 ? '0.2' : '1';
            p.style.cursor = this._previewCurrent <= 0 ? 'default' : 'pointer';
        }
        if (n) {
            n.style.opacity = this._previewCurrent >= this._previewImgs.length - 1 ? '0.2' : '1';
            n.style.cursor = this._previewCurrent >= this._previewImgs.length - 1 ? 'default' : 'pointer';
        }
    },

    _approvalShowTip(msg) {
        var tip = document.getElementById('approvalShowTip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'approvalShowTip';
            tip.style.cssText = 'position:fixed;top:30px;left:50%;transform:translateX(-50%);z-index:10002;color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:8px 20px;border-radius:20px;pointer-events:none;transition:opacity 0.3s;';
            document.body.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.opacity = '1';
        clearTimeout(tip._t);
        tip._t = setTimeout(function () {
            tip.style.opacity = '0';
        }, 1500);
    },

    // ==================== 打印 ====================
    _printDetail() {
        var self = this;
        var gate = function () {
            var modalId = self._detailModalId || 'approvalDetailModal';
            var modal = document.getElementById(modalId);
            if (!modal) return;
            var bodyEl = modal.querySelector('.modal-body');
            if (!bodyEl || !bodyEl.innerHTML.trim()) {
                self.showToast('没有可打印的审批内容', true);
                return;
            }
        // 用独立隐藏iframe承载打印内容，避免打印整个页面时等待无关资源（字体/CDN/其他弹窗图片）导致一直加载
        var old = document.getElementById('approvalPrintFrame');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        var iframe = document.createElement('iframe');
        iframe.id = 'approvalPrintFrame';
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
        document.body.appendChild(iframe);

        var css = '@page{margin:12mm 15mm;}'
            + '*{box-sizing:border-box;}'
            + 'body{font-family:"Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif;color:#333;background:#fff;font-size:14px;line-height:1.6;}'
            + 'i{display:none!important;}'
            + '.detail-grid{display:block!important;}'
            + '.detail-item{display:flex;padding:6px 0;border-bottom:1px solid #eee;page-break-inside:avoid;}'
            + '.detail-item label{width:110px;min-width:110px;font-size:12px;color:#888;font-weight:600;padding-right:12px;flex-shrink:0;}'
            + '.detail-item span{flex:1;font-size:14px;color:#333;}'
            + '.detail-item.full-width{display:block;}'
            + '.detail-item.full-width label{display:block;width:auto;margin-bottom:4px;}'
            + '.detail-item.full-width span{display:block;}'
            + '.approval-timeline{margin-top:16px;page-break-inside:avoid;}'
            + '.timeline-item{padding:6px 0 6px 20px;border-left:2px solid #ddd;margin-left:4px;page-break-inside:avoid;}'
            + '.timeline-item::before{left:-6px;top:10px;width:10px;height:10px;}'
            + '.timeline-header{font-size:13px;font-weight:600;color:#333;}'
            + '.timeline-time{font-size:11px;color:#999;}'
            + '.timeline-comment{font-size:12px;color:#666;padding:6px 10px;background:#f8f8f8;border-radius:4px;margin-top:4px;}'
            + 'h4{font-size:15px;margin:20px 0 12px!important;padding-top:16px;border-top:2px solid #333;}'
            + '.status-badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:12px;}'
            + '.status-badge.normal{background:#f0f9eb;color:#67c23a;}'
            + '.status-badge.late{background:#fef0f0;color:#f56c6c;}'
            + '.badge-info{background:#e3f2fd;color:#1976d2;}'
            + '.badge-default{background:#f5f5f5;color:#999;}'
            + '.status-badge.deferred{background:#fdf6ec;color:#e6a23c;}'
            + '.status-badge.processing{background:#f3e8ff;color:#9b59b6;}'
            + 'img[onclick],img[alt="审批人签名"]{max-width:120px!important;max-height:120px!important;}'
            + 'a[href]{color:#409eff!important;text-decoration:underline!important;}'
            + '.btn{display:none!important;}'
            + 'video,audio{display:none!important;}'
            + '.detail-item a[target="_blank"]{display:inline-flex!important;align-items:center;padding:4px 8px;background:#f5f7fa;border-radius:4px;font-size:11px;color:#666!important;text-decoration:none!important;max-width:180px;}'
            + '.detail-item a[target="_blank"] i{display:inline!important;color:#409eff!important;margin-right:4px;}'
            + '.detail-item a[target="_blank"] span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';

        var doc = iframe.contentDocument;
        doc.open();
        // 🔧 打印默认叠加水印（由管理控制台「打印时添加水印」开关控制）
        var wm = (window.WatermarkManager && WatermarkManager.buildPrintWatermark) ? WatermarkManager.buildPrintWatermark() : null;
        var printCss = wm ? css + wm.css : css;
        var printBody = wm ? bodyEl.innerHTML + wm.html : bodyEl.innerHTML;
        doc.write('<html><head><meta charset="utf-8"><title>审批详情打印</title><style>' + printCss + '</style></head><body>' + printBody + '</body></html>');
        doc.close();

        // 图片加载失败时直接隐藏，避免打印预览一直等待
        var imgs = doc.getElementsByTagName('img');
        for (var i = 0; i < imgs.length; i++) {
            imgs[i].onerror = function () { this.style.display = 'none'; };
        }

        var printed = false;
        function doPrint() {
            if (printed) return;
            printed = true;
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (e) {}
            setTimeout(function () {
                if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 3000);
        }
            // 等资源加载完再打印；超时强制打印，避免卡死
            var force = setTimeout(doPrint, 1200);
            iframe.onload = function () {
                clearTimeout(force);
                setTimeout(doPrint, 150);
            };
        };
        // 🔧 打印权限门：先上报打印并校验「允许打印」权限，无权限则拦截
        if (window.WatermarkManager && WatermarkManager.reportPrint) {
            WatermarkManager.reportPrint({page: 'approval', target_type: 'approval', target_id: self._detailApprovalId || ''}).then(function (res) {
                if (res && res.allowed === false) {
                    self.showToast('您没有打印权限，请联系管理员开通', true);
                    return;
                }
                gate();
            });
        } else {
            gate();
        }
    },

    // ==================== 审批操作 ====================

    _openActionModal(id, action, actionLabel) {
        this._actionId = id;
        this._actionType = action;
        this._actionLabel = actionLabel;
        this._actionAttachments = [];
        var modal = document.getElementById('actionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'actionModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:500px;">'
                + '<div class="modal-header"><h3 id="actionModalTitle"><i class="fas fa-check-circle" style="color:#409eff;"></i> 审批反馈</h3>'
                + '<button class="close-btn" onclick="approvalApp.closeModal(\'actionModal\')">&times;</button></div>'
                + '<div class="modal-body">'
                + '<p style="font-size:14px;color:#606266;margin-bottom:10px;">请填写审批意见：</p>'
                + '<textarea id="actionComment" class="form-textarea" rows="4" placeholder="请输入审批意见..." style="width:100%;min-height:80px;"></textarea>'
                + '<div style="margin-top:12px;"><label style="font-size:13px;font-weight:500;display:block;margin-bottom:6px;"><i class="fas fa-paperclip"></i> 附件</label>'
                + '<div style="display:flex;gap:8px;align-items:center;">'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._triggerActionUpload()" style="font-size:12px;padding:6px 12px;"><i class="fas fa-paperclip"></i> 选择文件</button>'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp.pickActionCloudAttachments()" style="font-size:12px;padding:6px 12px;"><i class="fas fa-cloud"></i> 从网盘选择</button>'
                + '<input type="file" id="actionFileInput" style="display:none;" accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.zip,.mp4,.avi,.mov,.mp3,.wav" onchange="approvalApp._handleActionFileSelect(event)">'
                + '<span style="font-size:11px;color:#909399;">支持 jpg/png/pdf/doc/zip/mp4等，不超过10MB</span></div>'
                + '<div id="actionAttachmentPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div></div>'
                + '<div id="actionMentionWrap" style="display:none;position:relative;margin-top:12px;">'
                + '<label style="font-size:13px;font-weight:500;display:block;margin-bottom:6px;"><i class="fas fa-at" style="color:#409eff;"></i> 提及成员 <span style="font-weight:400;font-size:11px;color:#909399;">（可多选：本审批发起人 + 您之前的各位审批人，将以私聊卡片消息发送，并附带本次审批意见）</span></label>'
                + '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;">'
                + '<button type="button" class="btn btn-secondary" id="actionMentionBtn" onclick="approvalApp._toggleMentionPicker(event)" style="font-size:12px;padding:6px 12px;"><i class="fas fa-at"></i> 选择成员</button>'
                + '<div id="actionMentionChips" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>'
                + '<div id="actionMentionPanel" style="display:none;position:absolute;z-index:20;margin-top:6px;width:340px;max-width:88vw;max-height:260px;overflow-y:auto;background:#fff;border:1px solid #dcdfe6;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.12);"></div></div>'
                + '<p id="actionError" class="error-message" style="color:#f56c6c;display:none;"></p>'
                + '<div id="actionSignatureWrap" style="display:none;margin-top:12px;">'
                + '<label style="font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px;margin-bottom:6px;"><i class="fas fa-signature" style="color:#9b59b6;"></i> 手写签名 <span style="font-weight:400;font-size:11px;color:#f56c6c;">（必填）</span>'
                + '<button type="button" onclick="approvalApp._toggleSignatureFullscreen()" id="actionSignatureFullscreenBtn" style="margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1px solid #9b59b6;border-radius:4px;background:#f9f0ff;color:#9b59b6;font-size:11px;cursor:pointer;"><i class="fas fa-expand"></i> 全屏</button></label>'
                + '<div id="actionSignatureBox" style="border:1px dashed #9b59b6;border-radius:8px;overflow:hidden;position:relative;background:#fff;height:180px;">'
                + '<canvas id="actionSignatureCanvas" width="900" height="360" style="width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;"></canvas>'
                + '<div id="actionSignaturePlaceholder" style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;color:#c0c4cc;font-size:14px;pointer-events:none;">请在此手写签名</div>'
                + '<button type="button" id="actionSignatureExitFullscreen" onclick="approvalApp._toggleSignatureFullscreen()" style="display:none;position:absolute;top:10px;right:10px;z-index:10;align-items:center;gap:5px;padding:6px 14px;border:1px solid #dcdfe6;border-radius:6px;background:rgba(255,255,255,0.92);color:#606266;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.12);"><i class="fas fa-compress"></i> 退出全屏</button>'
                + '<div id="actionSignatureFullActions" style="display:none;position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:10;gap:10px;align-items:center;background:rgba(255,255,255,0.95);border:1px solid #dcdfe6;border-radius:8px;padding:6px 10px;box-shadow:0 2px 12px rgba(0,0,0,0.15);">'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._rotateSignatureFullscreen()" id="actionSignatureRotateBtn" style="font-size:12px;padding:5px 12px;"><i class="fas fa-redo-alt"></i> 旋转</button>'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._clearSignature()" style="font-size:12px;padding:5px 14px;"><i class="fas fa-eraser"></i> 清除</button>'
                + '<button type="button" class="btn btn-primary" onclick="approvalApp._confirmSignatureFullscreen()" style="font-size:12px;padding:5px 18px;"><i class="fas fa-check"></i> 确定</button>'
                + '</div>'
                + '</div>'
                + '<div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap;">'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._clearSignature()" style="font-size:12px;padding:4px 12px;"><i class="fas fa-eraser"></i> 清除</button>'
                + '<button type="button" class="btn btn-secondary" onclick="approvalApp._toggleSignatureFullscreen()" style="font-size:12px;padding:4px 12px;"><i class="fas fa-expand"></i> 全屏签名</button>'
                + '<span style="font-size:11px;color:#909399;">支持鼠标或手指书写</span></div>'
                + '</div>'
                + '<div id="actionNotifyReceiptWrap" style="display:none;margin-top:12px;padding:10px 12px;background:#f4fdf9;border:1px solid #d1f2eb;border-radius:8px;">'
                + '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;color:#16a085;">'
                + '<input type="checkbox" id="actionNotifyReceipt" style="width:16px;height:16px;cursor:pointer;">'
                + '<span><i class="fas fa-bell" style="margin-right:2px;"></i> 通知发起人回传票据</span></label>'
                + '<div style="font-size:11px;color:#909399;margin-top:4px;">开启后，通过审批时会向发起人发送「请及时回传票据/凭证」的工作通知</div></div>'
                + '</div>'
                + '<div class="modal-footer" id="actionModalFooter">'
                + '<button class="btn btn-secondary" onclick="approvalApp.closeModal(\'actionModal\')">取消</button>'
                + '<button class="btn btn-primary" id="actionConfirmBtn" onclick="approvalApp._confirmAction()"><i class="fas fa-check"></i> 确定</button></div></div>';
            document.body.appendChild(modal);
        }
        document.getElementById('actionComment').value = '';
        document.getElementById('actionAttachmentPreview').innerHTML = '';
        this._actionAttachments = [];
        this._actionSignatureData = '';
        this._signatureRequired = false;
        // Reset signature pad
        var sigWrap = document.getElementById('actionSignatureWrap');
        if (sigWrap) sigWrap.style.display = 'none';
        var sigBox = document.getElementById('actionSignatureBox');
        if (sigBox) {
            sigBox.classList.remove('sig-fullscreen');
            sigBox.classList.remove('sig-rotate');
        }
        var sigExit = document.getElementById('actionSignatureExitFullscreen');
        if (sigExit) sigExit.style.display = 'none';
        var sigTopBtn = document.getElementById('actionSignatureFullscreenBtn');
        if (sigTopBtn) sigTopBtn.style.display = 'inline-flex';
        var sigCanvas = document.getElementById('actionSignatureCanvas');
        if (sigCanvas) this._resetSignatureCanvas(sigCanvas);
        var titleEl = document.getElementById('actionModalTitle');
        if (titleEl) {
            var icon = action === 'approve' ? 'fa-check-circle' : action === 'reject' ? 'fa-times-circle' : action === 'deferred' ? 'fa-pause-circle' : 'fa-spinner';
            var color = action === 'reject' ? '#f56c6c' : action === 'deferred' ? '#e6a23c' : action === 'processing' ? '#9b59b6' : '#67c23a';
            titleEl.innerHTML = '<i class="fas ' + icon + '" style="color:' + color + ';"></i> ' + actionLabel;
        }
        var footer = document.getElementById('actionModalFooter');
        if (footer) {
            var confirmBtn = footer.querySelector('#actionConfirmBtn');
            if (confirmBtn) {
                confirmBtn.innerHTML = '<i class="fas fa-check"></i> ' + (action === 'reject' ? '驳回' : action === 'deferred' ? '暂缓' : action === 'processing' ? '开始办理' : '通过');
                confirmBtn.className = 'btn ' + (action === 'reject' ? 'btn-danger' : action === 'deferred' ? 'btn-secondary' : 'btn-primary');
            }
        }
        // 判断是否需要手写签名（仅通过审批时）
        this._signatureRequired = false;
        if (action === 'approve') {
            var reqSig = this._currentApprovalRequireSignature;
            if (reqSig) {
                this._signatureRequired = true;
                var sigWrap = document.getElementById('actionSignatureWrap');
                if (sigWrap) sigWrap.style.display = 'block';
            }
        }
        // 「通知发起人回传票据」开关：仅当该审批类型开启票据回传且操作为通过时显示
        var notifyWrap = document.getElementById('actionNotifyReceiptWrap');
        if (notifyWrap) notifyWrap.style.display = (action === 'approve' && this._currentApprovalEnableReceipt) ? 'block' : 'none';
        var notifyCb = document.getElementById('actionNotifyReceipt');
        if (notifyCb) notifyCb.checked = false;
        // @ 提及：仅「通过」时可用（可 @ 发起人 + 自己之前的审批人），每次打开重置
        this._mentionCandidates = [];
        this._mentionSelected = [];
        var mentionWrap = document.getElementById('actionMentionWrap');
        var mentionPanel = document.getElementById('actionMentionPanel');
        if (mentionPanel) mentionPanel.style.display = 'none';
        if (mentionWrap) mentionWrap.style.display = (action === 'approve') ? 'block' : 'none';
        this._renderMentionChips();
        // 点击 @ 候选面板与按钮之外的位置时收起面板（只绑定一次）
        if (!this._mentionOutsideBound) {
            this._mentionOutsideBound = true;
            document.addEventListener('click', function (e) {
                var p = document.getElementById('actionMentionPanel');
                if (!p || p.style.display !== 'block') return;
                if (e.target.closest && (e.target.closest('#actionMentionPanel') || e.target.closest('#actionMentionBtn'))) return;
                p.style.display = 'none';
            });
        }
        // 提升详情层级，保证在物资管理/物品库等其它模态框之上打开（不关闭下层模态框）
        modal.style.zIndex = '3000';
        modal.style.display = 'flex';
        setTimeout(function () {
            modal.classList.add('show');
        }, 10);
    },

    async _triggerActionUpload() {
        document.getElementById('actionFileInput').click();
    },

    async _handleActionFileSelect(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > this.fileMaxSizeMB * 1024 * 1024) {
            console.log('文件大小超过限制::', file.size);
            this.showAlert('提示', `文件大小不能超过${this.fileMaxSizeMB}MB`);
            return;
        }
        var formData = new FormData();
        formData.append('file', file);
        try {
            var resp = await fetch(OA_API_URL + '/approval/upload-attachment/', {
                method: 'POST',
                headers: {'Authorization': TokenManager.getHeaders()['Authorization']},
                body: formData
            });
            if (!resp.ok) {
                var errData = await resp.json().catch(function () {
                    return {};
                });
                throw new Error(errData.error || errData.detail || '上传失败');
            }
            var result = await resp.json();
            if (result.url) {
                if (!this._actionAttachments) this._actionAttachments = [];
                this._actionAttachments.push({url: result.url, name: result.name || file.name});
                this._renderActionAttachments();
            }
        } catch (e) {
            this.showAlert('错误', '附件上传失败');
        }
    },

    pickActionCloudAttachments() {
        if (!window.CloudFilePicker) { this.showAlert('提示', '网盘选择组件未加载，请刷新'); return; }
        var self = this;
        CloudFilePicker.open({title: '从我的网盘选择附件', onPick: function (list) { self._addActionCloudAttachments(list); }});
    },
    async _addActionCloudAttachments(list) {
        if (!(list && list.length)) return;
        if (!this._actionAttachments) this._actionAttachments = [];
        var added = 0;
        for (var i = 0; i < list.length; i++) {
            try {
                var resp = await fetch(OA_API_URL + '/approval/attach-cloud/', {
                    method: 'POST', headers: TokenManager.getHeaders(),
                    body: JSON.stringify({cloud_id: list[i].cloud_id})
                });
                if (!resp.ok) { var er2 = await resp.json().catch(function () { return {}; }); throw new Error(er2.error || '添加失败'); }
                var res = await resp.json();
                this._actionAttachments.push({url: res.url, name: res.name || list[i].name});
                added++;
            } catch (e) { this.showAlert('提示', (e && e.message) || '添加失败'); break; }
        }
        if (added) { this._renderActionAttachments(); this.showToast('已添加 ' + added + ' 个文件', false); }
    },

    _renderActionAttachments() {
        var container = document.getElementById('actionAttachmentPreview');
        if (!container) return;
        container.innerHTML = (this._actionAttachments || []).map(function (a) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:#f5f7fa;border-radius:4px;font-size:12px;">'
                + '<i class="fas fa-paperclip" style="color:#409eff;"></i>'
                + '<span>' + approvalApp._escape(a.name) + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;color:#909399;font-size:10px;" onclick="var idx=approvalApp._actionAttachments.findIndex(function(x){return x.url===\'' + a.url + '\'});if(idx>-1){approvalApp._actionAttachments.splice(idx,1);approvalApp._renderActionAttachments();}"></i></span>';
        }).join('') || '';
    },

    // ==================== 审批通过弹窗 @ 提及 ====================

    async _toggleMentionPicker(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        var panel = document.getElementById('actionMentionPanel');
        if (!panel) return;
        if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
        if (this._mentionCandidates && this._mentionCandidates.length) {
            this._renderMentionPanel();
            panel.style.display = 'block';
            return;
        }
        panel.innerHTML = '<div style="padding:10px 12px;color:#909399;font-size:13px;">正在加载可提及成员...</div>';
        panel.style.display = 'block';
        try {
            const d = await this.apiGet(OA_API_URL + '/approval/' + this._actionId + '/mention-candidates/');
            this._mentionCandidates = (d && d.results) || [];
            this._mentionApplicantId = d ? d.applicant_id : null;
            this._renderMentionPanel();
        } catch (err) {
            panel.innerHTML = '<div style="padding:10px 12px;color:#f56c6c;font-size:13px;">'
                + this._escape((err && err.message) || '加载失败') + '</div>';
        }
    },

    _renderMentionPanel() {
        var panel = document.getElementById('actionMentionPanel');
        if (!panel) return;
        var list = this._mentionCandidates || [];
        if (!list.length) {
            panel.innerHTML = '<div style="padding:10px 12px;color:#909399;font-size:13px;">暂无可提及成员（本审批发起人及您之前的审批人为空）</div>';
            return;
        }
        var self = this;
        var selected = this._mentionSelected || [];
        panel.innerHTML = list.map(function (u, i) {
            var on = selected.indexOf(u.id) > -1;
            var isApplicant = (self._mentionApplicantId != null && u.id === self._mentionApplicantId);
            return '<div class="mention-item" onclick="approvalApp._toggleMentionUser(' + u.id + ')" '
                + 'style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid #f5f5f5;'
                + (on ? 'background:#ecf5ff;' : '') + '">'
                + '<img src="' + self._escape(u.avatar || '/static/images/default-avatar.png') + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="font-size:13px;color:#303133;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + self._escape(u.name || '') + (i === 0 || isApplicant ? ' <span style="font-size:10px;color:#409eff;background:#ecf5ff;border-radius:6px;padding:1px 5px;">发起人</span>' : '') + '</div>'
                + '<div style="font-size:11px;color:#909399;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
                + self._escape([u.position, u.department].filter(Boolean).join(' · ') || '未填职位') + '</div></div>'
                + '<i class="fas ' + (on ? 'fa-check-circle' : 'fa-circle') + '" style="color:' + (on ? '#409eff' : '#dcdfe6') + ';flex-shrink:0;"></i>'
                + '</div>';
        }).join('');
    },

    _toggleMentionUser(uid) {
        var selected = this._mentionSelected || [];
        var idx = selected.indexOf(uid);
        if (idx > -1) selected.splice(idx, 1);
        else selected.push(uid);
        this._mentionSelected = selected;
        this._renderMentionPanel();
        this._renderMentionChips();
    },

    _renderMentionChips() {
        var wrap = document.getElementById('actionMentionChips');
        if (!wrap) return;
        var self = this;
        var selected = this._mentionSelected || [];
        var list = this._mentionCandidates || [];
        wrap.innerHTML = selected.map(function (uid) {
            var u = list.find(function (x) { return x.id === uid; }) || {id: uid, name: '#' + uid};
            return '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;background:#ecf5ff;border:1px solid #c6e2ff;border-radius:12px;font-size:12px;color:#409eff;">'
                + '<img src="' + self._escape(u.avatar || '/static/images/default-avatar.png') + '" style="width:16px;height:16px;border-radius:50%;object-fit:cover;">'
                + '<span>@' + self._escape(u.name || '') + '</span>'
                + '<i class="fas fa-times" style="cursor:pointer;font-size:10px;" onclick="event.stopPropagation();approvalApp._toggleMentionUser(' + uid + ')"></i>'
                + '</span>';
        }).join('');
    },

    async _confirmAction() {
        var id = this._actionId;
        var action = this._actionType;
        if (!id || !action) return;
        var comment = document.getElementById('actionComment').value.trim();
        var data = {comment: comment};
        // @ 提及：仅通过时提交被选中的成员（后端会再校验是否在可提及范围内）
        if (action === 'approve' && this._mentionSelected && this._mentionSelected.length) {
            data.mention_user_ids = this._mentionSelected.slice();
        }
        if (this._actionAttachments && this._actionAttachments.length) {
            data.attachments = this._actionAttachments;
        }
        // 校验手写签名
        if (this._signatureRequired && action === 'approve') {
            var sigCanvas = document.getElementById('actionSignatureCanvas');
            if (!this._actionSignatureData || !sigCanvas) {
                this.showAlert('提示', '请先完成手写签名');
                return;
            }
            data.signature = this._signatureWithTimestamp(sigCanvas);
        }

        if (action === 'approve') {
            // var confirmed = await this.showConfirmDialog('确认通过?', '是否确认通过审批？', 'confirm');
            // if (!confirmed) return;

            // 「通知发起人回传票据」开关：开启才让后端发送请及时回传票据/凭证通知
            var notifyCb = document.getElementById('actionNotifyReceipt');
            if (notifyCb && notifyCb.checked) data.notify_receipt_return = true;
        }

        try {
            await this.apiPost(OA_API_URL + '/approval/' + id + '/' + action + '/', data);
            this.closeModal('actionModal');
            this.showToast('操作成功', false);
            // 🔧 操作成功后不关闭详情模态框：刷新列表，并展示一条仍在当前列表中的审批，保证「上一条/下一条」导航可用。
            //    若当前审批已被过滤移除（如 待我审批/待审批 下处理完），则自动切到列表第一条（下一条待办）继续审批。
            await this.loadList(this.currentPage);
            const _navIds = this._listApprovalIds || [];
            const _navIdx = _navIds.indexOf(id);
            if (_navIdx === -1 && _navIds.length) {
                this.showToast('开始下一条审批！', false);
                this.showDetail(_navIds[0]);
            } else {
                this.showDetail(id);
            }
        } catch (e) {
            console.error('操作失败:', e);
            // this.showAlert('操作失败', e.message || '请重试');
            this.showToast(('操作失败' + e.message || '请重试'), true);
        }
    },

    // ==================== 手写签名面板 ====================

    _resetSignatureCanvas(canvas) {
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // 绑定绘制事件（鼠标+触摸）
        var self = this;
        canvas._drawing = false;
        canvas._lastX = 0;
        canvas._lastY = 0;
        canvas.onmousedown = function (e) {
            self._sigStart(e, canvas);
        };
        canvas.onmousemove = function (e) {
            self._sigMove(e, canvas);
        };
        canvas.onmouseup = function (e) {
            self._sigEnd(e, canvas);
        };
        canvas.onmouseleave = function (e) {
            self._sigEnd(e, canvas);
        };
        canvas.ontouchstart = function (e) {
            e.preventDefault();
            self._sigStart(e, canvas);
        };
        canvas.ontouchmove = function (e) {
            e.preventDefault();
            self._sigMove(e, canvas);
        };
        canvas.ontouchend = function (e) {
            e.preventDefault();
            self._sigEnd(e, canvas);
        };
        var placeholder = document.getElementById('actionSignaturePlaceholder');
        if (placeholder) placeholder.style.display = 'flex';
    },

    _getSigPos(e, canvas) {
        var rect = canvas.getBoundingClientRect();
        var clientX = e.touches && e.touches.length ? e.touches[0].clientX : (e.clientX || 0);
        var clientY = e.touches && e.touches.length ? e.touches[0].clientY : (e.clientY || 0);
        // 全屏旋转90度时：画布视觉宽高互换，需按旋转后的坐标空间反向映射，
        // 保证书写内容与旋正时一致、无拉伸变形
        var box = document.getElementById('actionSignatureBox');
        var rotated = box && box.classList.contains('sig-rotate');
        if (rotated) {
            // 90度顺时针旋转：局部x → 屏幕向下(y)，局部y → 屏幕向左(x)
            var nx = (clientX - rect.left) / rect.width;
            var ny = (clientY - rect.top) / rect.height;
            return {
                x: ny * canvas.width,
                y: (1 - nx) * canvas.height
            };
        }
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    },

    _sigStart(e, canvas) {
        canvas._drawing = true;
        var pos = this._getSigPos(e, canvas);
        canvas._lastX = pos.x;
        canvas._lastY = pos.y;
        this._actionSignatureData = 'drawn';
        var placeholder = document.getElementById('actionSignaturePlaceholder');
        if (placeholder) placeholder.style.display = 'none';
    },

    _sigMove(e, canvas) {
        if (!canvas._drawing) return;
        var pos = this._getSigPos(e, canvas);
        var ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.moveTo(canvas._lastX, canvas._lastY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        canvas._lastX = pos.x;
        canvas._lastY = pos.y;
    },

    _sigEnd(e, canvas) {
        canvas._drawing = false;
    },

    _clearSignature() {
        var canvas = document.getElementById('actionSignatureCanvas');
        if (!canvas) return;
        this._actionSignatureData = '';
        this._resetSignatureCanvas(canvas);
    },

    /** 在签名下方自动添加日期时间与审批人信息，返回合成后的 dataURL */
    _signatureWithTimestamp(canvas) {
        var w = canvas.width;
        var h = canvas.height;
        var stampH = Math.round(h * 0.18); // 底部信息区高度（时间戳+审批人）
        var tsCanvas = document.createElement('canvas');
        tsCanvas.width = w;
        tsCanvas.height = h + stampH;
        var ctx = tsCanvas.getContext('2d');
        // 白色背景
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, tsCanvas.width, tsCanvas.height);
        // 绘制原签名
        ctx.drawImage(canvas, 0, 0);
        // 底部信息区：浅灰分割线 + 审批人 + 日期时间
        var now = new Date();
        var pad = function (n) {
            return String(n).padStart(2, '0');
        };
        var dateStr = '审批时间：' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
            + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        // 获取当前用户（审批人）姓名
        var approverName = '';
        try {
            var cu = JSON.parse(localStorage.getItem('current_user') || 'null');
            approverName = (cu && (cu.real_name || cu.username)) ? (cu.real_name || cu.username) : '';
        } catch (e) {
        }
        var lineY = h + 2;
        ctx.strokeStyle = '#c0c4cc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(w, lineY);
        ctx.stroke();
        var fontPx = Math.round(h * 0.065);
        ctx.fillStyle = '#606266';
        ctx.font = fontPx + 'px "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'middle';
        // 审批人：靠左
        ctx.textAlign = 'left';
        var nameStr = '审批人：' + approverName;
        ctx.fillText(nameStr, 16, h + stampH / 2);
        // 日期时间：靠右
        ctx.textAlign = 'right';
        ctx.fillText(dateStr, w - 16, h + stampH / 2);
        return tsCanvas.toDataURL('image/png');
    },

    _toggleSignatureFullscreen() {
        var box = document.getElementById('actionSignatureBox');
        var btn = document.getElementById('actionSignatureFullscreenBtn');
        var exitBtn = document.getElementById('actionSignatureExitFullscreen');
        var fullActions = document.getElementById('actionSignatureFullActions');
        var rotateBtn = document.getElementById('actionSignatureRotateBtn');
        var canvas = document.getElementById('actionSignatureCanvas');
        if (!box) return;
        var isFull = box.classList.toggle('sig-fullscreen');
        // 全屏默认不自动旋转；退出全屏时清除旋转状态（回正）
        if (!isFull) {
            box.classList.remove('sig-rotate');
        }
        if (canvas && !this._actionSignatureData) {
            this._resetSignatureCanvas(canvas);
        }
        // 顶部全屏按钮：全屏时隐藏（框内按钮接管）
        if (btn) btn.style.display = isFull ? 'none' : 'inline-flex';
        // 框内退出全屏按钮：仅全屏时显示
        if (exitBtn) exitBtn.style.display = isFull ? 'inline-flex' : 'none';
        // 全屏操作栏（清除/确定）：仅全屏时显示
        if (fullActions) {
            fullActions.style.display = isFull ? 'inline-flex' : 'none';
        }
        // 旋转按钮：仅全屏时显示，初始图标随当前旋转状态
        if (rotateBtn) {
            rotateBtn.style.display = isFull ? 'inline-flex' : 'none';
            if (isFull) this._updateRotateBtnIcon();
        }
        // 下方"全屏签名"按钮文字
        var allBtns = document.querySelectorAll('#actionSignatureWrap button[onclick*="_toggleSignatureFullscreen"]');
        allBtns.forEach(function (b) {
            if (b !== btn) {
                b.innerHTML = isFull ? '<i class="fas fa-compress"></i> 退出全屏' : '<i class="fas fa-expand"></i> 全屏签名';
            }
        });
    },

    /** 旋转按钮：点击后输入区域旋转90度铺满全屏，再次点击回正 */
    _rotateSignatureFullscreen() {
        var box = document.getElementById('actionSignatureBox');
        if (!box) return;
        box.classList.toggle('sig-rotate');
        this._updateRotateBtnIcon();
    },

    /** 更新旋转按钮图标（横竖屏状态提示） */
    _updateRotateBtnIcon() {
        var rotateBtn = document.getElementById('actionSignatureRotateBtn');
        if (!rotateBtn) return;
        var box = document.getElementById('actionSignatureBox');
        var isRotated = box && box.classList.contains('sig-rotate');
        rotateBtn.innerHTML = isRotated
            ? '<i class="fas fa-undo"></i> 回正'
            : '<i class="fas fa-redo-alt"></i> 旋转';
        rotateBtn.title = isRotated ? '旋转回正' : '旋转90度铺满屏幕';
    },

    /** 全屏签名确定：退出全屏（签名已保留在画布，方向自动回正） */
    _confirmSignatureFullscreen() {
        this._toggleSignatureFullscreen();
    },
    });
})();
