// static/js/chat-workorder.js - 浙企钉群工单（群待办）聊天页交互
// 本文件为 ChatClient 原型扩展，必须在 chat-boot.js 之前加载。
(function () {
    'use strict';

    function esc(text) {
        if (text === undefined || text === null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function fmtTime(value, withTime) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return '';
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var out = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        if (withTime !== false) out += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        return out;
    }

    function fmtSize(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function statusColor(status) {
        return {
            pending: '#909399', processing: '#409eff', pending_verify: '#e6a23c',
            done: '#67c23a', cancelled: '#c0c4cc'
        }[status] || '#909399';
    }

    function urgencyColor(u) {
        return { low: '#909399', medium: '#409eff', high: '#e6a23c', urgent: '#f56c6c' }[u] || '#909399';
    }

    function actionLabel(type) {
        return {
            comment: '评论', progress: '进度更新', start: '开始处理', submit: '提交环节',
            verify: '核验通过', reject: '驳回退回', return: '退回处理', system: '系统记录', ding: 'DING 催办'
        }[type] || type;
    }

    Object.assign(ChatClient.prototype, {

        // 当前用户是否可以在指定群发起群待办（后端最终强制校验，前端用于隐藏/拦截入口）
        async checkWorkOrderCreatePerm(roomId) {
            try {
                var resp = await fetch('/api/tasks/workorders/can-create/?room_id=' + encodeURIComponent(roomId), {
                    headers: TokenManager.getHeaders()
                });
                var data = await resp.json().catch(function () { return {}; });
                if (!resp.ok) return {allowed: true};
                return data || {allowed: true};
            } catch (e) {
                return {allowed: true};
            }
        },

        // 群管理弹窗中按权限隐藏「新建群待办」入口
        _applyWorkOrderEntryPermission(roomId) {
            var self = this;
            this.checkWorkOrderCreatePerm(roomId).then(function (p) {
                if (!p || p.allowed !== false) return;
                var el = document.getElementById('groupWorkOrderCreateEntry');
                if (!el) return;
                var group = el.closest ? el.closest('.form-group') : null;
                (group || el).style.display = 'none';
            });
        },

        // 群工单详情全屏 / 还原
        toggleWorkOrderFullscreen(btn) {
            var content = btn && btn.closest ? btn.closest('.modal-content') : null;
            if (!content) content = document.querySelector('#woDetailModal .wo-modal-content');
            if (!content) return;
            var fullscreen = content.classList.toggle('wo-detail-fullscreen');
            var icon = btn ? btn.querySelector('i') : null;
            if (icon) icon.className = fullscreen ? 'fas fa-compress' : 'fas fa-expand';
            if (btn) {
                btn.title = fullscreen ? '退出全屏' : '全屏';
                btn.setAttribute('aria-label', btn.title);
            }
        },

        // ==================== 发起工单 ====================
        async openCreateWorkOrderModal() {
            var room = (this.chatRooms || []).find(function (r) {
                return parseInt(r.id) === parseInt(this.currentRoomId);
            }, this);
            if (!room) {
                this.showToast('请先选择一个群聊', 'error');
                return;
            }
            if (room.room_type !== 'group') {
                this.showToast('群工单只能在群聊中发起', 'error');
                return;
            }
            var perm = await this.checkWorkOrderCreatePerm(room.id);
            if (perm && perm.allowed === false) {
                this.showToast(perm.reason || '您没有发起群待办的权限', 'error');
                return;
            }
            var members = await this._woLoadMembers(room.id);
            if (!members.length) {
                this.showToast('群成员加载失败，请稍后重试', 'error');
                return;
            }
            this._woCreateRoom = room;
            this._woCreateMembers = members;
            this._woCreateAttachments = [];
            this._woBuildCreateModal(room, members);
        },

        _woBuildCreateModal(room, members) {
            this._woDestroyCreatePickers();
            var old = document.getElementById('woCreateModal');
            if (old) old.remove();
            var self = this;
            var me = this.currentUser || {};
            var modal = document.createElement('div');
            modal.id = 'woCreateModal';
            modal.className = 'modal show wo-modal';
            modal.innerHTML = ''
                + '<div class="modal-content wo-modal-content">'
                + '  <div class="modal-header"><h3><i class="fas fa-clipboard-list" style="color:#00a1ff;"></i> 新建群待办</h3>'
                + '    <div class="wo-modal-head-actions">'
                + '      <button type="button" class="wo-fullscreen-btn" title="全屏" aria-label="全屏" onclick="chatClient.toggleWorkOrderFullscreen(this)"><i class="fas fa-expand"></i></button>'
                + '      <button class="close-btn" onclick="chatClient.closeWorkOrderModal(\'woCreateModal\')">&times;</button>'
                + '    </div></div>'
                + '  <div class="modal-body wo-modal-body">'
                + '    <div class="wo-form-section">'
                + '      <div class="wo-section-title"><i class="fas fa-circle-info"></i> 基础信息</div>'
                + '      <div class="wo-form-grid">'
                + '        <div class="form-group wo-col-2"><label>工单标题 <span class="required">*</span></label>'
                + '          <input id="woCreateTitle" type="text" maxlength="200" placeholder="一句话概括问题，如：客户系统登录失败"></div>'
                + '        <div class="form-group"><label>工单编号</label>'
                + '          <input id="woCreateOrderNo" type="text" maxlength="64" placeholder="留空自动生成，如 GD-20261115-001"></div>'
                + '        <div class="form-group"><label>紧急等级</label>'
                + '          <select id="woCreateUrgency"><option value="low">低</option><option value="medium" selected>中</option><option value="high">高</option><option value="urgent">紧急</option></select></div>'
                + '        <div class="form-group"><label>核验人 <span class="required">*</span></label>'
                + '          <div id="woCreateVerifierPicker"></div></div>'
                + '      </div>'
                + '    </div>'
                + '    <div class="wo-form-section">'
                + '      <div class="wo-section-title"><i class="fas fa-file-lines"></i> 问题与方案</div>'
                + '      <div class="form-group"><label>问题描述</label>'
                + '        <textarea id="woCreateDesc" rows="3" placeholder="现象、影响范围、来源、紧急等级等"></textarea></div>'
                + '      <div class="form-group"><label>解决方案模板（可直接粘贴标准方案）</label>'
                + '        <textarea id="woCreateSolution" rows="3" placeholder="处理思路、步骤、注意事项、验收标准"></textarea></div>'
                + '    </div>'
                + '    <div class="wo-form-section">'
                + '      <div class="wo-stages-head"><span class="wo-section-title"><i class="fas fa-route"></i> 处理环节</span>'
                + '        <button type="button" class="btn btn-secondary btn-sm" onclick="chatClient.addWorkOrderStageRow()"><i class="fas fa-plus"></i> 添加环节</button></div>'
                + '      <div class="wo-stage-hint">按顺序执行：当前环节完成后自动通知下一环节执行人；全部完成后进入核验。</div>'
                + '      <div id="woStageRows" class="wo-stage-rows"></div>'
                + '    </div>'
                + '    <div class="wo-form-section">'
                + '      <div class="wo-section-title"><i class="fas fa-bell"></i> 通知设置</div>'
                + '      <div class="wo-create-options">'
                + '        <label><input type="checkbox" id="woCreateSync" checked> 群内同步通知'
                + '          <small>环节提交/退回时在群里发一条简短提醒</small></label>'
                + '        <label><input type="checkbox" id="woCreateDing" checked> DING 提醒执行人'
                + '          <small>通过工作通知 + 弹窗 + 震动提醒当前执行人</small></label>'
                + '      </div>'
                + '      <div class="wo-tip"><i class="fas fa-lightbulb"></i> 进度更新统一在本工单评论区进行，避免群消息刷屏。</div>'
                + '    </div>'
                + '  </div>'
                + '  <div class="modal-footer">'
                + '    <button class="btn btn-secondary" onclick="chatClient.closeWorkOrderModal(\'woCreateModal\')">取消</button>'
                + '    <button class="btn btn-primary" id="woCreateSubmit" onclick="chatClient.submitWorkOrder()"><i class="fas fa-paper-plane"></i> 发起群待办</button>'
                + '  </div>'
                + '</div>';
            document.body.appendChild(modal);
            var verifierEl = document.getElementById('woCreateVerifierPicker');
            if (verifierEl && window.WorkOrderUI) {
                this._woVerifierPicker = WorkOrderUI.createPicker(verifierEl, members, {
                    value: me.id || null,
                    placeholder: '选择核验人'
                });
            }
            this.addWorkOrderStageRow();
            this.addWorkOrderStageRow();
        },

        addWorkOrderStageRow() {
            var wrap = document.getElementById('woStageRows');
            if (!wrap) return;
            var members = this._woCreateMembers || [];
            var row = document.createElement('div');
            row.className = 'wo-stage-row';
            row.innerHTML = ''
                + '<div class="wo-stage-row-index"></div>'
                + '<input type="text" class="wo-stage-name" maxlength="100" placeholder="环节名称，如：初步排查">'
                + '<div class="wo-stage-assignee-picker"></div>'
                + '<input type="datetime-local" class="wo-stage-deadline" title="环节截止时间">'
                + '<button type="button" class="wo-stage-remove" title="删除环节" onclick="chatClient.removeWorkOrderStageRow(this)">&times;</button>';
            wrap.appendChild(row);
            var pickerEl = row.querySelector('.wo-stage-assignee-picker');
            if (pickerEl && window.WorkOrderUI) {
                row._woAssigneePicker = WorkOrderUI.createPicker(pickerEl, members, {
                    placeholder: '选择环节执行人'
                });
            }
            this._woRenumberStages();
        },

        _woRenumberStages() {
            document.querySelectorAll('#woStageRows .wo-stage-row').forEach(function (row, idx) {
                var badge = row.querySelector('.wo-stage-row-index');
                if (badge) badge.textContent = idx + 1;
            });
        },

        _woDestroyCreatePickers() {
            if (this._woVerifierPicker) {
                try { this._woVerifierPicker.destroy(); } catch (e) {}
                this._woVerifierPicker = null;
            }
            document.querySelectorAll('#woStageRows .wo-stage-row').forEach(function (row) {
                if (row._woAssigneePicker) {
                    try { row._woAssigneePicker.destroy(); } catch (e) {}
                    row._woAssigneePicker = null;
                }
            });
        },

        _woDestroyDetailPickers() {
            if (this._woVerifierChangePicker) {
                try { this._woVerifierChangePicker.destroy(); } catch (e) {}
                this._woVerifierChangePicker = null;
            }
            if (this._woStagePickers) {
                Object.keys(this._woStagePickers).forEach(function (k) {
                    try { this._woStagePickers[k].destroy(); } catch (e) {}
                }, this);
                this._woStagePickers = {};
            }
        },

        removeWorkOrderStageRow(btn) {
            var row = btn && btn.parentNode;
            if (!row) return;
            if (row._woAssigneePicker) {
                try { row._woAssigneePicker.destroy(); } catch (e) {}
                row._woAssigneePicker = null;
            }
            row.remove();
            this._woRenumberStages();
        },

        closeWorkOrderModal(id) {
            if (id === 'woCreateModal') this._woDestroyCreatePickers();
            if (id === 'woDetailModal') this._woDestroyDetailPickers();
            var el = document.getElementById(id);
            if (el) el.remove();
            if (id === 'woDetailModal') {
                this._workOrderDetailId = null;
                this._currentWorkOrder = null;
                this._woDetailAttachments = [];
            }
        },

        async submitWorkOrder() {
            var title = (document.getElementById('woCreateTitle') || {}).value || '';
            title = title.trim();
            if (!title) {
                this.showToast('请输入工单标题', 'error');
                return;
            }
            var rows = Array.prototype.slice.call(document.querySelectorAll('#woStageRows .wo-stage-row'));
            if (!rows.length) {
                this.showToast('请至少配置一个处理环节', 'error');
                return;
            }
            var stages = [];
            for (var i = 0; i < rows.length; i++) {
                var name = (rows[i].querySelector('.wo-stage-name').value || '').trim();
                var assignee = rows[i]._woAssigneePicker ? rows[i]._woAssigneePicker.getValue() : null;
                var deadline = rows[i].querySelector('.wo-stage-deadline').value;
                if (!name) {
                    this.showToast('第 ' + (i + 1) + ' 个环节名称不能为空', 'error');
                    return;
                }
                if (!assignee) {
                    this.showToast('第 ' + (i + 1) + ' 个环节请选择执行人', 'error');
                    return;
                }
                stages.push({name: name, assignee_id: parseInt(assignee), deadline: deadline || null});
            }
            var btn = document.getElementById('woCreateSubmit');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 提交中...'; }
            try {
                var payload = {
                    chat_room_id: parseInt(this.currentRoomId),
                    title: title,
                    order_no: ((document.getElementById('woCreateOrderNo') || {}).value || '').trim(),
                    description: ((document.getElementById('woCreateDesc') || {}).value || '').trim(),
                    urgency: (document.getElementById('woCreateUrgency') || {}).value || 'medium',
                    solution_template: ((document.getElementById('woCreateSolution') || {}).value || '').trim(),
                    verifier_id: (this._woVerifierPicker ? this._woVerifierPicker.getValue() : null),
                    sync_notify: !!((document.getElementById('woCreateSync') || {}).checked),
                    ding: !!((document.getElementById('woCreateDing') || {}).checked),
                    stages: stages
                };
                var resp = await fetch('/api/tasks/workorders/', {
                    method: 'POST',
                    headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                    body: JSON.stringify(payload)
                });
                var data = await this._woReadJson(resp);
                if (!resp.ok) throw new Error(this._woErrorText(data));
                this.closeWorkOrderModal('woCreateModal');
                this.showToast('群待办已发起', 'success');
            } catch (e) {
                this.showToast('发起失败：' + (e.message || '请稍后重试'), 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> 发起群待办'; }
            }
        },

        // ==================== 聊天卡片 ====================
        renderWorkOrderCardInChat(card, container) {
            if (!card || !card.work_order_id) {
                container.innerHTML = '<div class="message-text" style="color:#909399;"><i class="fas fa-clipboard-list"></i> [群工单]</div>';
                return;
            }
            container.className = '';
            var p = card.progress || {done: 0, total: 0};
            var pct = p.total ? Math.round((p.done || 0) * 100 / p.total) : 0;
            var cur = card.current_stage || {};
            var color = statusColor(card.status);
            var ucolor = urgencyColor(card.urgency);
            var mine = cur.assignee_id && this.currentUser && String(cur.assignee_id) === String(this.currentUser.id)
                && card.status !== 'done' && card.status !== 'cancelled';
            container.innerHTML = ''
                + '<div class="message-content message-left wo-card-message" style="background: #fff;" data-work-order-id="' + card.work_order_id + '" '
                + '     onclick="chatClient.openWorkOrderDetail(' + card.work_order_id + ')">'
                + '  <div class="wo-card-head">'
                + '    <span class="wo-card-kind"><i class="fas fa-clipboard-list"></i> 群工单</span>'
                + '    <span class="wo-card-head-right">'
                + (mine ? '<span class="wo-mine-badge"><i class="fas fa-bell"></i> 待我处理</span>' : '')
                + '    <span class="wo-status-badge wo-status-' + esc(card.status) + '" style="background:' + color + ';">' + esc(card.status_display || '') + '</span>'
                + '    </span>'
                + '  </div>'
                + '  <div class="wo-card-body">'
                + '    <div class="wo-card-title-row">'
                + '      <span class="wo-card-no">' + esc(card.order_no || '') + '</span>'
                + '      <span class="wo-urgency-tag" style="background:' + ucolor + ';">' + esc(card.urgency_display || '') + '</span>'
                + '    </div>'
                + '    <div class="wo-card-title">' + esc(card.title || '') + '</div>'
                + '    <div class="wo-card-progress-row">'
                + '      <div class="wo-progress-bar"><i style="width:' + pct + '%;"></i></div>'
                + '      <span class="wo-progress-text">' + (p.done || 0) + '/' + (p.total || 0) + '</span>'
                + '    </div>'
                + '    <div class="wo-card-meta">'
                + '      <span class="wo-card-stage"><i class="fas fa-route"></i> <span class="wo-current-stage">' + esc(cur.name || '') + '（' + esc(cur.assignee_name || '未指派') + '）</span></span>'
                + (cur.deadline ? '<span><i class="fas fa-clock"></i> 截止 ' + esc(fmtTime(cur.deadline)) + '</span>' : '')
                + '      <span><i class="fas fa-user-circle"></i> 发起 ' + esc(card.creator_name || '') + ' · 核验 ' + esc(card.verifier_name || '') + '</span>'
                + (card.tenant_name ? '      <span><i class="fas fa-building"></i> ' + esc(card.tenant_name) + '</span>' : '')
                + '    </div>'
                + '  </div>'
                + '  <div class="wo-card-foot">查看详情 / 更新进度 <i class="fas fa-chevron-right"></i></div>'
                + '</div>';
        },

        // ==================== 详情/操作 ====================
        async openWorkOrderDetail(id) {
            this._workOrderDetailId = id;
            this._woDetailAttachments = [];
            await this.refreshWorkOrderDetail(id, false, true);
        },

        async refreshWorkOrderDetail(id, silent, openModal) {
            try {
                var resp = await fetch('/api/tasks/workorders/' + id + '/', {headers: TokenManager.getHeaders()});
                var data = await this._woReadJson(resp);
                if (!resp.ok) throw new Error(this._woErrorText(data));
                this._currentWorkOrder = data;
                this._workOrderDetailId = data.id;
                if (!this._woMembersCache || String(this._woMembersCache.roomId) !== String(data.chat_room)) {
                    await this._woLoadMembers(data.chat_room);
                }
                var draftEl = document.getElementById('woCommentInput');
                var draft = draftEl ? draftEl.value : '';
                this._woRenderDetailModal(data);
                var newInput = document.getElementById('woCommentInput');
                if (newInput && draft) newInput.value = draft;
            } catch (e) {
                if (!silent) this.showToast('加载工单失败：' + (e.message || '请稍后重试'), 'error');
            }
        },

        async _woLoadMembers(roomId) {
            if (this._woMembersCache && String(this._woMembersCache.roomId) === String(roomId)) {
                return this._woMembersCache.members;
            }
            try {
                var resp = await fetch('/api/chat/rooms/' + roomId + '/members_detail/', {headers: TokenManager.getHeaders()});
                if (!resp.ok) return [];
                var data = await resp.json();
                var members = data.members || data.results || [];
                members = members.filter(function (m) { return m && m.id; });
                this._woMembersCache = {roomId: roomId, members: members};
                return members;
            } catch (e) {
                return [];
            }
        },

        _woRenderDetailModal(wo) {
            this._woDestroyDetailPickers();
            var old = document.getElementById('woDetailModal');
            // 刷新详情（如提交进度后）时保留全屏状态
            var wasFullscreen = !!(old && old.querySelector('.wo-detail-fullscreen'));
            if (old) old.remove();
            var perm = wo.permissions || {};
            var stages = wo.stages || [];
            var comments = wo.comments || [];
            var p = wo.progress || {done: 0, total: 0};
            var pct = p.total ? Math.round((p.done || 0) * 100 / p.total) : 0;
            var members = (this._woMembersCache && String(this._woMembersCache.roomId) === String(wo.chat_room))
                ? this._woMembersCache.members : [];
            var currentStageId = wo.current_stage ? wo.current_stage.id : null;
            var stageHtml = stages.map(function (s) {
                var color = statusColor(s.status === 'done' ? 'done' : (s.status === 'processing' ? 'processing' : 'pending'));
                var deliverable = (window.WorkOrderUI && WorkOrderUI.attachmentsHtml)
                    ? WorkOrderUI.attachmentsHtml(s.deliverable || [], {compact: true})
                    : (s.deliverable || []).map(function (f) {
                        return '<a href="' + esc(f.url) + '" target="_blank" rel="noopener" class="wo-attach-chip"><i class="fas fa-paperclip"></i> ' + esc(f.name || '附件') + '</a>';
                    }).join('');
                var reassign = '';
                if (perm.can_reassign && s.status !== 'done' && members.length) {
                    reassign = '<div class="wo-stage-reassign"><span>改派给</span>'
                        + '<div id="woReassignPicker-' + s.id + '" class="wo-reassign-picker"></div>'
                        + '<button type="button" class="btn btn-secondary btn-sm" onclick="chatClient.reassignWorkOrderStage(' + s.id + ')">确认改派</button></div>';
                }
                var isCurrent = currentStageId && String(currentStageId) === String(s.id) &&
                    wo.status !== 'done' && wo.status !== 'cancelled';
                var overdue = s.deadline && s.status !== 'done' && new Date(s.deadline).getTime() < Date.now();
                var assigneeMember = null;
                if (s.assignee && members.length) {
                    assigneeMember = members.filter(function (m) { return String(m.id) === String(s.assignee); })[0] || null;
                }
                var assigneeHtml = assigneeMember
                    ? (window.WorkOrderUI ? WorkOrderUI.memberHtml(assigneeMember) : esc(s.assignee_name || '未指派'))
                    : (s.assignee_info
                        ? (window.WorkOrderUI ? WorkOrderUI.memberHtml(s.assignee_info) : esc(s.assignee_name || '未指派'))
                        : '<span class="wo-stage-assignee-text">' + esc(s.assignee_name || '未指派') + '</span>');
                return '<div class="wo-stage-item wo-stage-' + esc(s.status) + (isCurrent ? ' wo-stage-current' : '') + '">'
                    + '<div class="wo-stage-dot" style="background:' + color + ';">' + s.order + '</div>'
                    + '<div class="wo-stage-main">'
                    + '<div class="wo-stage-title"><b>' + esc(s.name) + '</b>'
                    + (isCurrent ? '<span class="wo-stage-current-tag">当前环节</span>' : '')
                    + '<span class="wo-stage-status" style="color:' + color + ';">' + esc(s.status_display || '') + '</span></div>'
                    + '<div class="wo-stage-meta"><span class="wo-stage-assignee">' + assigneeHtml + '</span>'
                    + (s.deadline ? '<span class="' + (overdue ? 'wo-overdue' : '') + '"><i class="fas fa-clock"></i> 截止 ' + esc(fmtTime(s.deadline)) + (overdue ? '（已逾期）' : '') + '</span>' : '')
                    + (s.completed_at ? '<span><i class="fas fa-check"></i> 完成 ' + esc(fmtTime(s.completed_at)) + '</span>' : '') + '</div>'
                    + (s.remark ? '<div class="wo-stage-remark">' + esc(s.remark) + '</div>' : '')
                    + (deliverable ? '<div class="wo-stage-files">' + deliverable + '</div>' : '')
                    + reassign
                    + '</div></div>';
            }).join('');
            var commentHtml = comments.length ? comments.map(function (c) {
                var atts = (window.WorkOrderUI && WorkOrderUI.attachmentsHtml)
                    ? WorkOrderUI.attachmentsHtml(c.attachments || [], {compact: true})
                    : (c.attachments || []).map(function (f) {
                        return '<a href="' + esc(f.url) + '" target="_blank" rel="noopener" class="wo-attach-chip"><i class="fas fa-paperclip"></i> ' + esc(f.name || '附件') + '</a>';
                    }).join('');
                var avatar = (c.user_info && c.user_info.avatar_url) || '/static/images/default-avatar.png';
                return '<div class="wo-comment">'
                    + '<img class="wo-comment-avatar" src="' + esc(avatar) + '" alt="">'
                    + '<div class="wo-comment-body">'
                    + '<div class="wo-comment-head"><b>' + esc(c.user_name || '系统') + '</b>'
                    + '<span class="wo-comment-action">' + esc(c.action_display || actionLabel(c.action_type)) + '</span>'
                    + '<span class="wo-comment-time">' + esc(fmtTime(c.created_at)) + '</span></div>'
                    + (c.content ? '<div class="wo-comment-text">' + esc(c.content) + '</div>' : '')
                    + (atts ? '<div class="wo-comment-files">' + atts + '</div>' : '')
                    + '</div></div>';
            }).join('') : '<div class="wo-empty">暂无进度记录</div>';

            var actionHtml = '';
            if (perm.can_start) {
                actionHtml += '<button class="btn btn-primary btn-sm" onclick="chatClient.workOrderStageAction(\'start\')"><i class="fas fa-play"></i> 开始处理</button>';
            }
            if (perm.can_submit) {
                actionHtml += '<button class="btn btn-primary btn-sm" onclick="chatClient.workOrderStageAction(\'submit\')"><i class="fas fa-check"></i> 提交本环节</button>';
            }
            if (perm.can_verify) {
                actionHtml += '<button class="btn btn-primary btn-sm" onclick="chatClient.verifyWorkOrder(\'pass\')"><i class="fas fa-check-circle"></i> 核验通过</button>';
                actionHtml += '<button class="btn btn-danger btn-sm" onclick="chatClient.verifyWorkOrder(\'reject\')"><i class="fas fa-undo"></i> 驳回退回</button>';
            }
            if (perm.can_ding) {
                actionHtml += '<button class="btn btn-secondary btn-sm" onclick="chatClient.dingWorkOrder()"><i class="fas fa-bell"></i> 催办 DING</button>';
            }
            if (perm.can_cancel) {
                actionHtml += '<button class="btn btn-secondary btn-sm" onclick="chatClient.cancelWorkOrder()"><i class="fas fa-ban"></i> 取消工单</button>';
            }
            var verifierChange = '';
            if (perm.can_change_verifier && members.length) {
                verifierChange = '<div class="wo-inline-tools"><span>更换核验人</span>'
                    + '<div id="woVerifierChangePicker" class="wo-verifier-change-picker"></div>'
                    + '<button class="btn btn-secondary btn-sm" onclick="chatClient.changeWorkOrderVerifier()">保存</button></div>';
            }
            var commentBox = perm.can_comment ? ''
                + '<div class="wo-comment-input">'
                + '  <textarea id="woCommentInput" rows="2" placeholder="更新进度、填写交付说明或驳回原因..."></textarea>'
                + '  <div class="wo-comment-tools">'
                + '    <label class="wo-upload-label"><i class="fas fa-paperclip"></i> 附件'
                + '      <input type="file" id="woFileInput" multiple style="display:none;" onchange="chatClient.uploadWorkOrderFiles(this.files)"></label>'
                + '    <div id="woAttachList" class="wo-attach-list"></div>'
                + '    <button class="btn btn-primary btn-sm" onclick="chatClient.addWorkOrderComment()"><i class="fas fa-paper-plane"></i> 发送</button>'
                + '  </div>'
                + '</div>'
                : '<div class="wo-empty">仅发起人、核验人或环节执行人可以更新进度</div>';

            var modal = document.createElement('div');
            modal.id = 'woDetailModal';
            modal.className = 'modal show wo-modal';
            modal.innerHTML = ''
                + '<div class="modal-content wo-modal-content wo-detail-content">'
                + '  <div class="modal-header"><h3><i class="fas fa-clipboard-list" style="color:#00a1ff;"></i> 群工单详情</h3>'
                + '    <div class="wo-modal-head-actions">'
                + '      <button type="button" class="wo-fullscreen-btn" title="全屏" aria-label="全屏" onclick="chatClient.toggleWorkOrderFullscreen(this)"><i class="fas fa-expand"></i></button>'
                + '      <button class="close-btn" onclick="chatClient.closeWorkOrderModal(\'woDetailModal\')">&times;</button>'
                + '    </div></div>'
                + '  <div class="modal-body wo-modal-body">'
                + '    <div class="wo-detail-head">'
                + '      <div><div class="wo-detail-no">' + esc(wo.order_no) + '</div><div class="wo-detail-title">' + esc(wo.title) + '</div></div>'
                + '      <span class="wo-status-badge" style="background:' + statusColor(wo.status) + ';">' + esc(wo.status_display) + '</span>'
                + '    </div>'
                + '    <div class="wo-detail-meta">'
                + '      <span style="color:' + urgencyColor(wo.urgency) + ';">' + esc(wo.urgency_display) + '</span>'
                + '      <span><i class="fas fa-user-circle"></i> 发起 ' + esc(wo.creator_name) + '</span>'
                + '      <span><i class="fas fa-user-shield"></i> 核验 ' + esc(wo.verifier_name) + '</span>'
                + '      <span><i class="fas fa-building"></i> 企业 ' + esc(wo.tenant_name || '-') + '</span>'
                + '      <span><i class="fas fa-users"></i> ' + esc(wo.room_name || '') + '</span>'
                + '      <span><i class="fas fa-clock"></i> ' + esc(fmtTime(wo.created_at)) + '</span>'
                + '    </div>'
                + '    <div class="wo-progress-line"><div class="wo-progress-bar"><i style="width:' + pct + '%;"></i></div><span class="wo-progress-label">进度 ' + (p.done || 0) + '/' + (p.total || 0) + '</span></div>'
                + '    <div class="wo-detail-grid">'
                + (wo.description ? '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-circle-exclamation"></i> 问题描述</div><div class="wo-block-body">' + esc(wo.description) + '</div></div>' : '')
                + (wo.solution_template ? '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-lightbulb"></i> 解决方案模板</div><div class="wo-block-body wo-pre">' + esc(wo.solution_template) + '</div></div>' : '')
                + '    </div>'
                + '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-route"></i> 处理环节 <span class="wo-block-sub">' + (p.done || 0) + '/' + (p.total || 0) + ' 已完成</span></div><div class="wo-timeline">' + (stageHtml || '<div class="wo-empty">暂无环节</div>') + '</div></div>'
                + '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-comments"></i> 进度记录 <span class="wo-block-sub">' + comments.length + ' 条</span></div><div class="wo-comments">' + commentHtml + '</div>' + commentBox + '</div>'
                + verifierChange
                + '    <div class="wo-detail-actions">' + (actionHtml || '<span class="wo-detail-actions-tip">当前没有可执行操作</span>') + '</div>'
                + '  </div>'
                + '</div>';
            document.body.appendChild(modal);
            if (wasFullscreen) {
                var fsContent = modal.querySelector('.wo-modal-content');
                var fsBtn = modal.querySelector('.wo-fullscreen-btn');
                if (fsContent) fsContent.classList.add('wo-detail-fullscreen');
                if (fsBtn) {
                    fsBtn.title = '退出全屏';
                    fsBtn.setAttribute('aria-label', '退出全屏');
                    var fsIcon = fsBtn.querySelector('i');
                    if (fsIcon) fsIcon.className = 'fas fa-compress';
                }
            }
            this._woStagePickers = {};
            this._woVerifierChangePicker = null;
            if (window.WorkOrderUI && members.length) {
                if (perm.can_reassign) {
                    stages.forEach(function (s) {
                        if (s.status === 'done') return;
                        var box = document.getElementById('woReassignPicker-' + s.id);
                        if (box) {
                            this._woStagePickers[s.id] = WorkOrderUI.createPicker(box, members, {
                                value: s.assignee || null,
                                placeholder: '选择执行人'
                            });
                        }
                    }, this);
                }
                if (perm.can_change_verifier) {
                    var vbox = document.getElementById('woVerifierChangePicker');
                    if (vbox) {
                        this._woVerifierChangePicker = WorkOrderUI.createPicker(vbox, members, {
                            value: wo.verifier || null,
                            placeholder: '选择新核验人'
                        });
                    }
                }
            }
            this._woRenderAttachments();
        },

        _woCurrentStageId() {
            var wo = this._currentWorkOrder;
            if (!wo) return null;
            var stages = wo.stages || [];
            var cur = stages.filter(function (s) { return s.status !== 'done'; })[0] || stages[stages.length - 1];
            return cur ? cur.id : null;
        },

        async workOrderStageAction(action) {
            var wo = this._currentWorkOrder;
            var stageId = this._woCurrentStageId();
            if (!wo || !stageId) return;
            var payload = {stage_id: stageId, action: action};
            if (action === 'submit') {
                payload.comment = ((document.getElementById('woCommentInput') || {}).value || '').trim();
                payload.attachments = this._woDetailAttachments || [];
                if (!payload.comment && !payload.attachments.length) {
                    this.showToast('请填写进度说明或上传交付成果', 'error');
                    return;
                }
            }
            await this._woPostAction(wo.id, 'stage-action/', payload);
        },

        async addWorkOrderComment() {
            var wo = this._currentWorkOrder;
            if (!wo) return;
            var content = ((document.getElementById('woCommentInput') || {}).value || '').trim();
            var attachments = this._woDetailAttachments || [];
            if (!content && !attachments.length) {
                this.showToast('请输入评论内容或上传附件', 'error');
                return;
            }
            await this._woPostAction(wo.id, 'comments/', {content: content, attachments: attachments});
        },

        async verifyWorkOrder(result) {
            var wo = this._currentWorkOrder;
            if (!wo) return;
            var comment = ((document.getElementById('woCommentInput') || {}).value || '').trim();
            if (result === 'reject' && !comment) {
                this.showToast('驳回时必须填写退回原因', 'error');
                return;
            }
            var ok = true;
            if (result === 'pass' && this.showConfirmDialog) {
                ok = await this.showConfirmDialog('核验通过', '确认核验通过并闭环该工单？', 'confirm');
                if (!ok) return;
            }
            await this._woPostAction(wo.id, 'verify/', {
                result: result, comment: comment, attachments: this._woDetailAttachments || []
            });
        },

        async dingWorkOrder() {
            var wo = this._currentWorkOrder;
            if (!wo) return;
            await this._woPostAction(wo.id, 'ding/', {});
        },

        async cancelWorkOrder() {
            var wo = this._currentWorkOrder;
            if (!wo) return;
            var ok = this.showConfirmDialog ? await this.showConfirmDialog('取消工单', '确定取消该工单吗？', 'danger') : true;
            if (!ok) return;
            var reason = ((document.getElementById('woCommentInput') || {}).value || '').trim();
            await this._woPostAction(wo.id, 'cancel/', {reason: reason});
        },

        async changeWorkOrderVerifier() {
            var wo = this._currentWorkOrder;
            if (!wo || !this._woVerifierChangePicker) return;
            var id = this._woVerifierChangePicker.getValue();
            if (!id) {
                this.showToast('请选择新的核验人', 'error');
                return;
            }
            await this._woPostAction(wo.id, 'change-verifier/', {verifier_id: parseInt(id)});
        },

        async reassignWorkOrderStage(stageId) {
            var wo = this._currentWorkOrder;
            if (!wo || !this._woStagePickers) return;
            var picker = this._woStagePickers[stageId];
            var id = picker ? picker.getValue() : null;
            if (!id) {
                this.showToast('请选择改派执行人', 'error');
                return;
            }
            await this._woPostAction(wo.id, 'stages/' + stageId + '/reassign/', {assignee_id: parseInt(id)});
        },

        async _woPostAction(id, path, payload) {
            try {
                var resp = await fetch('/api/tasks/workorders/' + id + '/' + path, {
                    method: 'POST',
                    headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                    body: JSON.stringify(payload || {})
                });
                var data = await this._woReadJson(resp);
                if (!resp.ok) throw new Error(this._woErrorText(data));
                this._woDetailAttachments = [];
                await this.refreshWorkOrderDetail(id, false, true);
                this.showToast('操作成功', 'success');
            } catch (e) {
                this.showToast('操作失败：' + (e.message || '请稍后重试'), 'error');
            }
        },

        async uploadWorkOrderFiles(fileList) {
            var files = Array.prototype.slice.call(fileList || []);
            if (!files.length) return;
            this._woDetailAttachments = this._woDetailAttachments || [];
            for (var i = 0; i < files.length; i++) {
                try {
                    var r = await this.uploadFileWithDedup(files[i]);
                    if (!r) continue;
                    this._woDetailAttachments.push({
                        file_id: r.file_id || r.id || null,
                        url: r.file_url || r.url || '',
                        name: r.filename || files[i].name,
                        size: r.size || files[i].size,
                        mime: r.mime_type || files[i].type
                    });
                } catch (e) { /* ignore single file */ }
            }
            this._woRenderAttachments();
            var input = document.getElementById('woFileInput');
            if (input) input.value = '';
        },

        _woRenderAttachments() {
            var wrap = document.getElementById('woAttachList');
            if (!wrap) return;
            wrap.innerHTML = (this._woDetailAttachments || []).map(function (f, idx) {
                return '<span class="wo-attach-chip">' + esc(f.name || '附件')
                    + ' <i class="fas fa-times" onclick="chatClient.removeWorkOrderAttachment(' + idx + ')"></i></span>';
            }).join('');
        },

        removeWorkOrderAttachment(idx) {
            (this._woDetailAttachments || []).splice(idx, 1);
            this._woRenderAttachments();
        },

        _woReadJson(resp) {
            return resp.json().catch(function () { return {}; });
        },

        _woErrorText(data) {
            if (!data) return '请求失败';
            if (typeof data === 'string') return data;
            if (data.detail) return data.detail;
            if (data.error) return data.error;
            if (Array.isArray(data)) return data.join('；');
            var first = Object.keys(data)[0];
            if (first) {
                var v = data[first];
                return (Array.isArray(v) ? v.join('；') : String(v));
            }
            return '请求失败';
        }
    });
})();
