// static/js/tasks-workorders.js - 任务中心群工单列表/详情/操作
// 依赖 tasks.js 中的 taskApp（本文件在其后加载，向 TaskApp.prototype 挂载方法）
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

    function fmtTime(value) {
        if (!value) return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return '';
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function statusColor(status) {
        return {
            pending: '#909399', processing: '#409eff', pending_verify: '#e6a23c',
            done: '#67c23a', cancelled: '#c0c4cc'
        }[status] || '#909399';
    }

    function urgencyColor(u) {
        return {low: '#909399', medium: '#409eff', high: '#e6a23c', urgent: '#f56c6c'}[u] || '#909399';
    }

    function actionLabel(type) {
        return {
            comment: '评论', progress: '进度更新', start: '开始处理', submit: '提交环节',
            verify: '核验通过', reject: '驳回退回', return: '退回处理', system: '系统记录', ding: 'DING 催办'
        }[type] || type;
    }

    function apiError(data) {
        if (!data) return '请求失败';
        if (typeof data === 'string') return data;
        if (data.detail) return data.detail;
        if (data.error) return data.error;
        if (Array.isArray(data)) return data.join('；');
        var k = Object.keys(data)[0];
        if (k) {
            var v = data[k];
            return Array.isArray(v) ? v.join('；') : String(v);
        }
        return '请求失败';
    }

    Object.assign(TaskApp.prototype, {

        // ==================== 列表 ====================
        async loadWorkOrders(page) {
            page = page || 1;
            this.currentFilter = 'workorders';
            this.currentView = 'list';
            var toolbarActions = document.getElementById('woToolbarActions');
            if (toolbarActions) toolbarActions.style.display = 'flex';
            var taskStatusFilter = document.getElementById('taskStatusFilter');
            if (taskStatusFilter) taskStatusFilter.style.display = 'none';
            var statusSel = document.getElementById('woStatusFilter');
            var searchInput = document.querySelector('.task-toolbar .search-input');
            if (searchInput) searchInput.placeholder = '搜索工单编号 / 标题...';
            var viewSwitcher = document.querySelector('.task-toolbar .view-switcher');
            if (viewSwitcher) viewSwitcher.style.display = 'none';
            var kb = document.querySelector('.view-switcher [data-view="kanban"]');
            if (kb) kb.classList.remove('active');
            var lb = document.querySelector('.view-switcher [data-view="list"]');
            if (lb) lb.classList.add('active');
            var params = new URLSearchParams({page: String(page), page_size: '50'});
            var status = statusSel ? statusSel.value : '';
            if (status) params.append('status', status);
            var urgency = this.woUrgencyFilter || '';
            if (urgency) params.append('urgency', urgency);
            if (this.searchKeyword) params.append('search', this.searchKeyword);
            try {
                var res = await fetch('/api/tasks/workorders/?' + params.toString(), {headers: TokenManager.getHeaders()});
                var data = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(apiError(data));
                var rows = data.results || [];
                this.workOrders = page === 1 ? rows : (this.workOrders || []).concat(rows);
                this.workOrdersPage = data.page || page;
                this.workOrdersHasMore = !!data.next;
                this.renderWorkOrders();
                this.loadWorkOrderStats();
            } catch (e) {
                this.showToast(e.message || '加载群工单失败', 'error');
            }
        },

        refreshWorkOrders() {
            this.loadWorkOrders(1);
            this.loadWorkOrderStats();
        },

        renderWorkOrders() {
            var container = document.getElementById('listView');
            if (!container) return;
            document.getElementById('listView').style.display = 'flex';
            document.getElementById('kanbanView').style.display = 'none';
            var rows = this.workOrders || [];
            if (!rows.length) {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-clipboard-list"></i><p>暂无群工单</p></div>';
                return;
            }
            var html = rows.map(function (wo) {
                var p = wo.progress || {done: 0, total: 0};
                var pct = p.total ? Math.round((p.done || 0) * 100 / p.total) : 0;
                var cur = wo.current_stage || {};
                var creator = wo.creator_info || {};
                var creatorName = creator.real_name || creator.username || wo.creator_name || '未知';
                var creatorAvatar = creator.avatar_url || '/static/images/default-avatar.png';
                var roomName = wo.room_name || '';
                var creatorTip = '发起人：' + creatorName
                    + '\n创建时间：' + (fmtTime(wo.created_at) || '-')
                    + '\n归属企业：' + (wo.tenant_name || '-')
                    + '\n来自群聊：' + (roomName || '-');
                return '<div class="wo-task-card" onclick="taskApp.selectWorkOrder(' + wo.id + ')">'
                    + '<div class="wo-task-top"><span class="wo-task-no">' + esc(wo.order_no) + '</span>'
                    + '<span class="wo-status-badge" style="background:' + statusColor(wo.status) + ';">' + esc(wo.status_display) + '</span></div>'
                    + '<div class="wo-task-title">' + esc(wo.title) + '</div>'
                    + '<div class="wo-task-badges">'
                    + (wo.tenant_name ? '<span class="wo-tenant-badge" title="归属企业：' + esc(wo.tenant_name) + '"><i class="fas fa-building"></i> ' + esc(wo.tenant_name) + '</span>' : '')
                    + (roomName ? '<span class="wo-room-badge" title="来自群聊：' + esc(roomName) + '"><i class="fas fa-users"></i> ' + esc(roomName) + '</span>' : '')
                    + '<span class="wo-creator-badge" title="' + esc(creatorTip) + '">'
                    + '<img src="' + esc(creatorAvatar) + '" alt=""> 发起人 <b>' + esc(creatorName) + '</b></span>'
                    + '</div>'
                    + '<div class="wo-task-meta">'
                    + '<span class="wo-urgency-text" style="color:' + urgencyColor(wo.urgency) + ';">' + esc(wo.urgency_display) + '</span>'
                    + (cur.name ? '<span><i class="fas fa-route"></i> ' + esc(cur.name) + '（' + esc(cur.assignee_name || '未指派') + '）</span>' : '')
                    + (cur.deadline ? '<span title="截止日期"><i class="fas fa-clock"></i> ' + esc(fmtTime(cur.deadline)) + '</span>' : '')
                    + '</div>'
                    + '<div class="wo-task-progress"><div class="wo-progress-bar"><i style="width:' + pct + '%;"></i></div><span>' + (p.done || 0) + '/' + (p.total || 0) + '</span></div>'
                    + '</div>';
            }).join('');
            if (this.workOrdersHasMore) {
                html += '<div class="wo-load-more"><button class="btn btn-secondary" onclick="taskApp.loadWorkOrders(' + ((this.workOrdersPage || 1) + 1) + ')">加载更多</button></div>';
            }
            container.innerHTML = html;
        },

        async loadWorkOrderStats() {
            try {
                var res = await fetch('/api/tasks/workorders/stats/', {headers: TokenManager.getHeaders()});
                if (!res.ok) return;
                var d = await res.json();
                var badge = document.getElementById('badge-workorders');
                if (badge) badge.textContent = (d.my_stage || 0) + (d.pending_verify || 0);
            } catch (e) { /* ignore */ }
        },

        exportWorkOrders() {
            this.openWorkOrderExportModal();
        },

        openWorkOrderExportModal() {
            var self = this;
            var overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = '<div style="background:var(--bg-primary,#fff);border-radius:14px;max-width:480px;width:100%;box-shadow:0 16px 48px rgba(0,0,0,.2);overflow:hidden;">'
                + '<div style="padding:16px 20px;border-bottom:1px solid var(--border-color,#ebeef5);display:flex;align-items:center;justify-content:space-between;">'
                + '<h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:8px;"><i class="fas fa-file-excel" style="color:#16a085;"></i> 导出群工单</h3>'
                + '<button type="button" class="wo-export-close" style="border:none;background:transparent;font-size:22px;cursor:pointer;color:#909399;">&times;</button></div>'
                + '<div style="padding:18px 20px;">'
                + '<div style="font-size:13px;color:var(--text-secondary,#606266);line-height:1.8;">'
                + '将当前筛选结果导出为 Excel 文件（<b>.xlsx</b>），包含工单编号、标题、状态、紧急度、进度、当前环节/执行人、发起人、核验人及时间信息。'
                + '</div>'
                + '<div style="margin-top:12px;padding:9px 11px;background:#f0f9eb;border:1px solid #d7edc8;border-radius:8px;color:#529b2e;font-size:12px;">'
                + '<i class="fas fa-info-circle"></i> 保存到网盘时默认放入「文档（来自群工单）」目录。'
                + '</div></div>'
                + '<div style="padding:12px 20px;border-top:1px solid var(--border-color,#ebeef5);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">'
                + '<button type="button" class="btn btn-secondary wo-export-cancel">取消</button>'
                + '<button type="button" class="btn btn-secondary wo-export-cloud"><i class="fas fa-cloud-upload-alt"></i> 保存到网盘</button>'
                + '<button type="button" class="btn btn-primary wo-export-local"><i class="fas fa-download"></i> 导出到本地</button>'
                + '</div></div>';
            document.body.appendChild(overlay);
            var close = function () { overlay.remove(); };
            overlay.querySelector('.wo-export-close').onclick = close;
            overlay.querySelector('.wo-export-cancel').onclick = close;
            overlay.onclick = function (e) { if (e.target === overlay) close(); };
            overlay.querySelector('.wo-export-local').onclick = function () {
                close();
                self._doExportWorkOrders('local');
            };
            overlay.querySelector('.wo-export-cloud').onclick = function () {
                close();
                self._doExportWorkOrders('cloud');
            };
        },

        async _doExportWorkOrders(target) {
            var self = this;
            var params = {};
            var statusSel = document.getElementById('woStatusFilter');
            if (statusSel && statusSel.value) params.status = statusSel.value;
            if (this.woUrgencyFilter) params.urgency = this.woUrgencyFilter;
            if (this.searchKeyword) params.search = this.searchKeyword;
            this.showToast(target === 'cloud' ? '正在生成并保存到网盘，请稍候...' : '正在生成群工单导出文件，请稍候...', 'info');
            try {
                var token = localStorage.getItem('access_token');
                if (!token) throw new Error('登录已过期，请重新登录');
                var res = await fetch('/api/tasks/workorders/export/', {
                    method: 'POST',
                    headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                    body: JSON.stringify(params)
                });
                if (!res.ok) {
                    var err = await res.json().catch(function () { return {}; });
                    throw new Error(err.error || err.detail || ('导出失败 ' + res.status));
                }
                var blob = await res.blob();
                var now = new Date();
                var pad = function (n) { return String(n).padStart(2, '0'); };
                var stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
                    + '_' + pad(now.getHours()) + pad(now.getMinutes());
                var filename = '群工单_' + stamp + '.xlsx';
                if (target === 'cloud') {
                    var file = new File([blob], filename, {
                        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    });
                    var folderId = await this._ensureWorkOrderCloudFolder('文档（来自群工单）');
                    await Utils.uploadToCloud(file, folderId, '群工单');
                    this.showAlert('成功', '已保存到网盘 / 文档（来自群工单）');
                } else {
                    var link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(link.href);
                    this.showToast('群工单导出成功', 'success');
                }
            } catch (e) {
                this.showAlert('导出失败', e.message || '请稍后重试');
            }
        },

        async _ensureWorkOrderCloudFolder(name) {
            var resp = await fetch('/api/cloud/folders/ensure/', {
                method: 'POST',
                headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                body: JSON.stringify({name: name})
            });
            var data = await resp.json().catch(function () { return {}; });
            if (!resp.ok || !data.id) throw new Error((data && data.error) || '创建网盘目录失败');
            return data.id;
        },

        // ==================== 详情 ====================
        async selectWorkOrder(id) {
            try {
                var res = await fetch('/api/tasks/workorders/' + id + '/', {headers: TokenManager.getHeaders()});
                var data = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(apiError(data));
                var prevId = this.currentWorkOrder && this.currentWorkOrder.id;
                if (String(prevId) !== String(data.id)) this._woTaskAttachments = [];
                else this._woTaskAttachments = this._woTaskAttachments || [];
                this.currentWorkOrder = data;
                var draftEl = document.getElementById('woTaskComment');
                var draft = draftEl ? draftEl.value : '';
                var members = await this._woTaskLoadMembers(data.chat_room);
                this._woTaskMembers = members;
                this.renderWorkOrderDetail(data);
                var newInput = document.getElementById('woTaskComment');
                if (newInput && draft) newInput.value = draft;
                var titleEl = document.querySelector('#taskDetailPanel .detail-header h3');
                if (titleEl) titleEl.textContent = '工单详情';
                document.getElementById('taskDetailPanel').classList.add('show');
            } catch (e) {
                this.showToast(e.message || '加载工单失败', 'error');
            }
        },

        async _woTaskLoadMembers(roomId) {
            try {
                var res = await fetch('/api/chat/rooms/' + roomId + '/members_detail/', {headers: TokenManager.getHeaders()});
                if (!res.ok) return [];
                var d = await res.json();
                return (d.members || d.results || []).filter(function (m) { return m && m.id; });
            } catch (e) { return []; }
        },

        _woTaskDestroyPickers() {
            if (this._woTaskVerifierPicker) {
                try { this._woTaskVerifierPicker.destroy(); } catch (e) {}
                this._woTaskVerifierPicker = null;
            }
            if (this._woTaskStagePickers) {
                Object.keys(this._woTaskStagePickers).forEach(function (k) {
                    try { this._woTaskStagePickers[k].destroy(); } catch (e) {}
                }, this);
                this._woTaskStagePickers = {};
            }
        },

        renderWorkOrderDetail(wo) {
            this._woTaskDestroyPickers();
            var body = document.getElementById('taskDetailBody');
            if (!body) return;
            var perm = wo.permissions || {};
            var stages = wo.stages || [];
            var comments = wo.comments || [];
            var p = wo.progress || {done: 0, total: 0};
            var pct = p.total ? Math.round((p.done || 0) * 100 / p.total) : 0;
            var members = this._woTaskMembers || [];
            var currentStageId = wo.current_stage ? wo.current_stage.id : null;
            var stageHtml = stages.map(function (s) {
                var color = statusColor(s.status === 'done' ? 'done' : (s.status === 'processing' ? 'processing' : 'pending'));
                var files = (window.WorkOrderUI && WorkOrderUI.attachmentsHtml)
                    ? WorkOrderUI.attachmentsHtml(s.deliverable || [], {compact: true})
                    : (s.deliverable || []).map(function (f) {
                        return '<a href="' + esc(f.url) + '" target="_blank" rel="noopener" class="wo-attach-chip"><i class="fas fa-paperclip"></i> ' + esc(f.name || '附件') + '</a>';
                    }).join('');
                var reassign = '';
                if (perm.can_reassign && s.status !== 'done' && members.length) {
                    reassign = '<div class="wo-stage-reassign"><span>改派给</span>'
                        + '<div id="woTaskReassign-' + s.id + '" class="wo-reassign-picker"></div>'
                        + '<button class="btn btn-secondary btn-sm" onclick="taskApp.reassignWorkOrderStage(' + s.id + ')">确认改派</button></div>';
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
                    + '<div class="wo-stage-main"><div class="wo-stage-title"><b>' + esc(s.name) + '</b>'
                    + (isCurrent ? '<span class="wo-stage-current-tag">当前环节</span>' : '')
                    + '<span class="wo-stage-status" style="color:' + color + ';">' + esc(s.status_display || '') + '</span></div>'
                    + '<div class="wo-stage-meta"><span class="wo-stage-assignee">' + assigneeHtml + '</span>'
                    + (s.deadline ? '<span class="' + (overdue ? 'wo-overdue' : '') + '"><i class="fas fa-clock"></i> 截止 ' + esc(fmtTime(s.deadline)) + (overdue ? '（已逾期）' : '') + '</span>' : '')
                    + (s.completed_at ? '<span><i class="fas fa-check"></i> 完成 ' + esc(fmtTime(s.completed_at)) + '</span>' : '') + '</div>'
                    + (s.remark ? '<div class="wo-stage-remark">' + esc(s.remark) + '</div>' : '')
                    + (files ? '<div class="wo-stage-files">' + files + '</div>' : '')
                    + reassign + '</div></div>';
            }).join('');
            var meId = this.currentUser ? this.currentUser.id : null;
            var commentHtml = comments.length ? comments.map(function (c) {
                var files = (window.WorkOrderUI && WorkOrderUI.attachmentsHtml)
                    ? WorkOrderUI.attachmentsHtml(c.attachments || [], {compact: true})
                    : (c.attachments || []).map(function (f) {
                        return '<a href="' + esc(f.url) + '" target="_blank" rel="noopener" class="wo-attach-chip"><i class="fas fa-paperclip"></i> ' + esc(f.name || '附件') + '</a>';
                    }).join('');
                var avatar = (c.user_info && c.user_info.avatar_url) || '/static/images/default-avatar.png';
                var authorId = c.user_info ? c.user_info.id : c.user;
                var isMe = meId != null && authorId != null && String(authorId) === String(meId);
                var authorName = isMe ? '我' : (c.user_name || '系统');
                return '<div class="wo-comment"><img class="wo-comment-avatar" src="' + esc(avatar) + '" alt="">'
                    + '<div class="wo-comment-body"><div class="wo-comment-head"><b>' + esc(authorName) + '</b>'
                    + '<span class="wo-comment-action">' + esc(c.action_display || actionLabel(c.action_type)) + '</span>'
                    + '<span class="wo-comment-time">' + esc(fmtTime(c.created_at)) + '</span></div>'
                    + (c.content ? '<div class="wo-comment-text">' + esc(c.content) + '</div>' : '')
                    + (files ? '<div class="wo-comment-files">' + files + '</div>' : '') + '</div></div>';
            }).join('') : '<div class="wo-empty">暂无进度记录</div>';

            var actions = '';
            if (perm.can_start) actions += '<button class="btn btn-primary btn-sm" onclick="taskApp.workOrderStageAction(\'start\')"><i class="fas fa-play"></i> 开始处理</button>';
            if (perm.can_submit) actions += '<button class="btn btn-primary btn-sm" onclick="taskApp.workOrderStageAction(\'submit\')"><i class="fas fa-check"></i> 提交本环节</button>';
            if (perm.can_verify) {
                actions += '<button class="btn btn-primary btn-sm" onclick="taskApp.verifyWorkOrder(\'pass\')"><i class="fas fa-check-circle"></i> 核验通过</button>';
                actions += '<button class="btn btn-danger btn-sm" onclick="taskApp.verifyWorkOrder(\'reject\')"><i class="fas fa-undo"></i> 驳回退回</button>';
            }
            if (perm.can_ding) actions += '<button class="btn btn-secondary btn-sm" onclick="taskApp.dingWorkOrder()"><i class="fas fa-bell"></i> 催办 DING</button>';
            if (perm.can_cancel) actions += '<button class="btn btn-secondary btn-sm" onclick="taskApp.cancelWorkOrder()"><i class="fas fa-ban"></i> 取消工单</button>';

            var verifierTools = '';
            if (perm.can_change_verifier && members.length) {
                verifierTools = '<div class="wo-inline-tools"><span>更换核验人</span>'
                    + '<div id="woTaskVerifierPicker" class="wo-verifier-change-picker"></div>'
                    + '<button class="btn btn-secondary btn-sm" onclick="taskApp.changeWorkOrderVerifier()">保存</button></div>';
            }
            var commentBox = perm.can_comment ? '<div class="wo-comment-input">'
                + '<textarea id="woTaskComment" rows="2" placeholder="更新进度、填写交付说明或驳回原因..."></textarea>'
                + '<div class="wo-comment-tools"><label class="wo-upload-label"><i class="fas fa-paperclip"></i> 附件'
                + '<input type="file" id="woTaskFileInput" multiple style="display:none;" onchange="taskApp.uploadWorkOrderFiles(this.files)"></label>'
                + '<div id="woTaskAttachList" class="wo-attach-list"></div>'
                + '<button class="btn btn-primary btn-sm" onclick="taskApp.addWorkOrderComment()"><i class="fas fa-paper-plane"></i> 发送</button>'
                + '</div></div>'
                : '<div class="wo-empty">仅发起人、核验人或环节执行人可以更新进度</div>';

            body.innerHTML = '<div class="wo-detail-head"><div><div class="wo-detail-no">' + esc(wo.order_no) + '</div>'
                + '<div class="wo-detail-title">' + esc(wo.title) + '</div></div>'
                + '<span class="wo-status-badge" style="background:' + statusColor(wo.status) + ';">' + esc(wo.status_display) + '</span></div>'
                + '<div class="wo-detail-meta"><span style="color:' + urgencyColor(wo.urgency) + ';">' + esc(wo.urgency_display) + '</span>'
                + '<span><i class="fas fa-user-circle"></i> 发起 ' + esc(wo.creator_name) + '</span>'
                + '<span><i class="fas fa-user-shield"></i> 核验 ' + esc(wo.verifier_name) + '</span>'
                + '<span><i class="fas fa-building"></i> 企业 ' + esc(wo.tenant_name || '-') + '</span>'
                + '<span><i class="fas fa-users"></i> ' + esc(wo.room_name || '') + '</span></div>'
                + '<div class="wo-progress-line"><div class="wo-progress-bar"><i style="width:' + pct + '%;"></i></div><span class="wo-progress-label">进度 ' + (p.done || 0) + '/' + (p.total || 0) + '</span></div>'
                + '<div class="wo-detail-grid">'
                + (wo.description ? '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-circle-exclamation"></i> 问题描述</div><div class="wo-block-body">' + esc(wo.description) + '</div></div>' : '')
                + (wo.solution_template ? '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-lightbulb"></i> 解决方案模板</div><div class="wo-block-body wo-pre">' + esc(wo.solution_template) + '</div></div>' : '')
                + '</div>'
                + '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-route"></i> 处理环节 <span class="wo-block-sub">' + (p.done || 0) + '/' + (p.total || 0) + ' 已完成</span></div><div class="wo-timeline">' + (stageHtml || '<div class="wo-empty">暂无环节</div>') + '</div></div>'
                + '<div class="wo-block"><div class="wo-block-title"><i class="fas fa-comments"></i> 进度记录 <span class="wo-block-sub">' + comments.length + ' 条</span></div><div class="wo-comments">' + commentHtml + '</div>' + commentBox + '</div>'
                + verifierTools
                + '<div class="wo-detail-actions">' + (actions || '<span class="wo-detail-actions-tip">当前没有可执行操作</span>') + '</div>';
            this._woTaskStagePickers = {};
            this._woTaskVerifierPicker = null;
            if (window.WorkOrderUI && members.length) {
                if (perm.can_reassign) {
                    stages.forEach(function (s) {
                        if (s.status === 'done') return;
                        var box = document.getElementById('woTaskReassign-' + s.id);
                        if (box) {
                            this._woTaskStagePickers[s.id] = WorkOrderUI.createPicker(box, members, {
                                value: s.assignee || null,
                                placeholder: '选择执行人'
                            });
                        }
                    }, this);
                }
                if (perm.can_change_verifier) {
                    var vbox = document.getElementById('woTaskVerifierPicker');
                    if (vbox) {
                        this._woTaskVerifierPicker = WorkOrderUI.createPicker(vbox, members, {
                            value: wo.verifier || null,
                            placeholder: '选择新核验人'
                        });
                    }
                }
            }
            this._woTaskRenderAttachments();
        },

        _woTaskCurrentStageId() {
            var wo = this.currentWorkOrder;
            if (!wo) return null;
            var stages = wo.stages || [];
            var cur = stages.filter(function (s) { return s.status !== 'done'; })[0] || stages[stages.length - 1];
            return cur ? cur.id : null;
        },

        async _woTaskPostAction(path, payload) {
            var wo = this.currentWorkOrder;
            if (!wo) return;
            try {
                var res = await fetch('/api/tasks/workorders/' + wo.id + '/' + path, {
                    method: 'POST',
                    headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                    body: JSON.stringify(payload || {})
                });
                var data = await res.json().catch(function () { return {}; });
                if (!res.ok) throw new Error(apiError(data));
                this._woTaskAttachments = [];
                await this.selectWorkOrder(wo.id);
                this.showToast('操作成功', 'success');
                this.loadWorkOrders(this.workOrdersPage || 1);
            } catch (e) {
                this.showToast(e.message || '操作失败', 'error');
            }
        },

        async workOrderStageAction(action) {
            var stageId = this._woTaskCurrentStageId();
            if (!stageId) return;
            var payload = {stage_id: stageId, action: action};
            if (action === 'submit') {
                payload.comment = ((document.getElementById('woTaskComment') || {}).value || '').trim();
                payload.attachments = this._woTaskAttachments || [];
                if (!payload.comment && !payload.attachments.length) {
                    this.showToast('请填写进度说明或上传交付成果', 'error');
                    return;
                }
            }
            await this._woTaskPostAction('stage-action/', payload);
        },

        async addWorkOrderComment() {
            var content = ((document.getElementById('woTaskComment') || {}).value || '').trim();
            var attachments = this._woTaskAttachments || [];
            if (!content && !attachments.length) {
                this.showToast('请输入评论内容或上传附件', 'error');
                return;
            }
            await this._woTaskPostAction('comments/', {content: content, attachments: attachments});
        },

        async verifyWorkOrder(result) {
            var comment = ((document.getElementById('woTaskComment') || {}).value || '').trim();
            if (result === 'reject' && !comment) {
                this.showToast('驳回时必须填写退回原因', 'error');
                return;
            }
            if (result === 'pass') {
                var ok = await this.showConfirm('核验通过', '确认核验通过并闭环该工单？');
                if (!ok) return;
            }
            await this._woTaskPostAction('verify/', {
                result: result, comment: comment, attachments: this._woTaskAttachments || []
            });
        },

        async dingWorkOrder() {
            await this._woTaskPostAction('ding/', {});
        },

        async cancelWorkOrder() {
            var ok = await this.showConfirm('取消工单', '确定取消该工单吗？');
            if (!ok) return;
            var reason = ((document.getElementById('woTaskComment') || {}).value || '').trim();
            await this._woTaskPostAction('cancel/', {reason: reason});
        },

        async changeWorkOrderVerifier() {
            var picker = this._woTaskVerifierPicker;
            var id = picker ? picker.getValue() : null;
            if (!id) {
                this.showToast('请选择新的核验人', 'error');
                return;
            }
            await this._woTaskPostAction('change-verifier/', {verifier_id: parseInt(id)});
        },

        async reassignWorkOrderStage(stageId) {
            var picker = this._woTaskStagePickers && this._woTaskStagePickers[stageId];
            var id = picker ? picker.getValue() : null;
            if (!id) {
                this.showToast('请选择改派执行人', 'error');
                return;
            }
            await this._woTaskPostAction('stages/' + stageId + '/reassign/', {assignee_id: parseInt(id)});
        },

        async uploadWorkOrderFiles(fileList) {
            var files = Array.prototype.slice.call(fileList || []);
            if (!files.length) return;
            this._woTaskAttachments = this._woTaskAttachments || [];
            for (var i = 0; i < files.length; i++) {
                try {
                    var form = new FormData();
                    form.append('file', files[i]);
                    var res = await fetch('/api/chat/upload/', {
                        method: 'POST',
                        headers: {Authorization: 'Bearer ' + TokenManager.getToken()},
                        body: form
                    });
                    if (!res.ok) continue;
                    var r = await res.json();
                    this._woTaskAttachments.push({
                        file_id: r.file_id || r.id || null,
                        url: r.file_url || r.url || '',
                        name: r.filename || files[i].name,
                        size: r.size || files[i].size,
                        mime: r.mime_type || files[i].type
                    });
                } catch (e) { /* ignore single file */ }
            }
            this._woTaskRenderAttachments();
            var input = document.getElementById('woTaskFileInput');
            if (input) input.value = '';
        },

        _woTaskRenderAttachments() {
            var wrap = document.getElementById('woTaskAttachList');
            if (!wrap) return;
            wrap.innerHTML = (this._woTaskAttachments || []).map(function (f, idx) {
                return '<span class="wo-attach-chip">' + esc(f.name || '附件')
                    + ' <i class="fas fa-times" onclick="taskApp.removeWorkOrderAttachment(' + idx + ')"></i></span>';
            }).join('');
        },

        removeWorkOrderAttachment(idx) {
            (this._woTaskAttachments || []).splice(idx, 1);
            this._woTaskRenderAttachments();
        }
    });

    // 实时更新：详情打开时收到 work_order.update 自动刷新，徽标同步
    window.addEventListener('workorder:update', function (e) {
        var wo = e && e.detail;
        if (!wo || !window.taskApp) return;
        taskApp.loadWorkOrderStats();
        var panel = document.getElementById('taskDetailPanel');
        var openId = taskApp.currentWorkOrder && taskApp.currentWorkOrder.id;
        if (panel && panel.classList.contains('show') && String(openId) === String(wo.work_order_id)) {
            taskApp.selectWorkOrder(wo.work_order_id);
        }
        if (taskApp.currentFilter === 'workorders' && typeof taskApp.loadWorkOrders === 'function') {
            taskApp.loadWorkOrders(taskApp.workOrdersPage || 1);
        }
    });

    // 初始化：群工单徽标 + ?work_order_id= 深链
    function initWorkOrders() {
        if (!window.taskApp) return;
        setTimeout(function () { taskApp.loadWorkOrderStats(); }, 400);
        try {
            var id = new URLSearchParams(window.location.search).get('work_order_id');
            if (id) {
                taskApp.switchFilter('workorders');
                setTimeout(function () { taskApp.selectWorkOrder(parseInt(id, 10)); }, 350);
            }
            var flag = new URLSearchParams(window.location.search).get('flag');
            switch (flag) {
                case 'work-orders':
                    taskApp.switchFilter('workorders');
                    break;
                case 'task-my':
                    taskApp.switchFilter('my');
                    break;
                case 'task-created':
                    taskApp.switchFilter('created');
                    break;
                case 'task-today':
                    taskApp.switchFilter('today');
                    break;
                case 'task-done':
                    taskApp.switchFilter('done');
                    break;
                default:
                    // 无 flag / 仅 task_id 深链时保持「我的任务」，由 tasks.js 按任务状态自动切换
                    break;
            }

        } catch (e) { /* ignore */ }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWorkOrders);
    } else {
        setTimeout(initWorkOrders, 0);
    }
})();
