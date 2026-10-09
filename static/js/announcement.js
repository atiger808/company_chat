// static/js/announcement.js - 集团公告
const ANN_API = '/api/oa/announcements';

class AnnouncementApp {
    constructor() {
        this._editId = null;
        this._subTenants = [];
        this._depts = [];
        this._users = [];
        this._scopeUsers = [];
        this._rteRange = null;        // 富文本选区（点击工具栏后恢复用）
        this._colorMode = 'fore';     // fore=字体颜色 / hilite=背景高亮
        this._initRte();
        this._init();
    }

    async _init() {
        const token = localStorage.getItem('access_token');
        if (!token) { window.location.href = '/login/'; return; }
        var me = null;
        try {
            var r = await fetch('/api/auth/me/', {headers: TokenManager.getHeaders()});
            if (r.ok) {
                me = await r.json();
                localStorage.setItem('user_type', me.user_type || '');
                localStorage.setItem('user_id', me.id || '');
            }
        } catch (e) {}
        // 是否可发布由后端配置决定（超级管理员 + 超管授权的用户），先按未授权隐藏，
        // 列表接口返回 can_create 后再显示
        this._applyCreateBtn();
        this._loadScopes();
        this._loadList();
        // 从通知跳转：?id=xxx 打开详情
        var qp = new URLSearchParams(window.location.search);
        var aid = qp.get('id');
        if (aid) setTimeout(function () { annApp.openDetail(parseInt(aid, 10)); }, 300);
    }

    // 发布按钮显隐：仅「超级管理员 + 超管在管理控制台授权的用户」可发布（后端接口另有校验）
    _applyCreateBtn() {
        var createBtn = document.getElementById('annCreateBtn');
        if (createBtn) createBtn.style.display = this._canCreate ? 'inline-flex' : 'none';
    }

    _escape(text) {
        return Utils.escapeHtml ? Utils.escapeHtml(text) : String(text || '').replace(/[&<>"']/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'}[c];
        });
    }

    async apiGet(url) {
        var resp = await fetch(url, {headers: TokenManager.getHeaders()});
        if (!resp.ok) { var b = await resp.json().catch(() => ({})); throw new Error(b.error || b.detail || '请求失败'); }
        var raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    async apiPost(url, data) {
        var resp = await fetch(url, {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify(data || {})});
        if (!resp.ok) { var b = await resp.json().catch(() => ({})); throw new Error(b.error || b.detail || '请求失败'); }
        var raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }
    async apiPut(url, data) {
        var resp = await fetch(url, {method: 'PUT', headers: TokenManager.getHeaders(), body: JSON.stringify(data || {})});
        if (!resp.ok) { var b = await resp.json().catch(() => ({})); throw new Error(b.error || b.detail || '请求失败'); }
        var raw = await resp.json();
        return raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
    }

    async _loadScopes() {
        try {
            var d = await this.apiGet(ANN_API + '/');
            this._canCreate = !!d.can_create;
            this._archiveDays = d.archive_days || 1;
            this._applyCreateBtn();
            // 子公司与部门：从现有接口获取
            try {
                var cfg = await this.apiGet('/api/oa/approval/dept-configs/');
                this._subTenants = cfg.sub_tenants || [];
            } catch (e) { this._subTenants = []; }
            try {
                var deptResp = await fetch('/api/oa/approval/org_departments/', {headers: TokenManager.getHeaders()});
                if (deptResp.ok) {
                    var dj = await deptResp.json();
                    var dd = dj.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(dj) : dj;
                    this._depts = this._flattenDepts(dd.departments || dd.results || dd);
                }
            } catch (e) { this._depts = []; }
            this._renderScopeOptions();
        } catch (e) { console.warn('加载范围数据失败', e); }
    }

    _flattenDepts(list) {
        var out = [];
        var walk = function (arr, path) {
            (arr || []).forEach(function (d) {
                var label = path ? path + ' / ' + d.name : d.name;
                out.push({id: d.id, name: label});
                if (d.children && d.children.length) walk(d.children, label);
            });
        };
        walk(list, '');
        return out;
    }

    _renderScopeOptions() {
        var subWrap = document.getElementById('annSubTenants');
        var deptWrap = document.getElementById('annDepts');
        var self = this;
        if (subWrap) {
            subWrap.innerHTML = (this._subTenants || []).map(function (t) {
                return '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;border:1px solid #dcdfe6;border-radius:6px;padding:4px 8px;"><input type="checkbox" value="' + t.id + '" class="ann-sub-cb"> ' + self._escape(t.short_name || t.name) + '</label>';
            }).join('') || '<span style="color:#909399;font-size:12px;">暂无子公司</span>';
        }
        if (deptWrap) {
            deptWrap.innerHTML = (this._depts || []).map(function (d) {
                return '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;border:1px solid #dcdfe6;border-radius:6px;padding:4px 8px;"><input type="checkbox" value="' + d.id + '" class="ann-dept-cb"> ' + self._escape(d.name) + '</label>';
            }).join('') || '<span style="color:#909399;font-size:12px;">暂无部门</span>';
        }
        // 范围切换
        document.querySelectorAll('input[name="annScope"]').forEach(function (r) {
            r.addEventListener('change', function () { annApp._onScopeChange(r.value); });
        });
    }

    _onScopeChange(val) {
        document.getElementById('annScopeSub').style.display = val === 'sub_tenants' ? 'block' : 'none';
        document.getElementById('annScopeDept').style.display = val === 'departments' ? 'block' : 'none';
        document.getElementById('annScopeUsers').style.display = val === 'users' ? 'block' : 'none';
    }

    async _loadList() {
        var listEl = document.getElementById('annList');
        try {
            var d = await this.apiGet(ANN_API + '/');
            this._list = d.results || [];
            if (typeof d.can_create !== 'undefined') {
                this._canCreate = !!d.can_create;
                this._applyCreateBtn();
            }
            if (d.archive_days) this._archiveDays = d.archive_days;
            this._renderList();
        } catch (e) {
            listEl.innerHTML = '<div class="ann-empty">加载失败：' + this._escape(e.message || '') + '</div>';
        }
    }

    // 点赞按钮（列表卡片与详情共用；data-ann-like 便于局部同步状态）
    _likeBtnHtml(a, big) {
        var liked = !!a.liked_by_me;
        var cnt = a.like_count || 0;
        return '<button type="button" data-ann-like="' + a.id + '" onclick="event.stopPropagation();annApp.toggleLike(' + a.id + ')"'
            + ' title="' + (liked ? '取消点赞' : '点赞') + '"'
            + ' style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;border-radius:14px;'
            + 'padding:' + (big ? '4px 14px' : '2px 10px') + ';font-size:' + (big ? '13px' : '11px') + ';'
            + 'border:1px solid ' + (liked ? '#fbc4c4' : '#dcdfe6') + ';'
            + 'background:' + (liked ? '#fdf0ef' : 'transparent') + ';'
            + 'color:' + (liked ? '#f56c6c' : '#909399') + ';">'
            + '<i class="' + (liked ? 'fas' : 'far') + ' fa-thumbs-up"></i> <span>' + cnt + '</span></button>';
    }

    // 点赞/取消点赞（同步更新列表与详情中的按钮，无需整页重渲染）
    async toggleLike(id) {
        var a = (this._list || []).filter(function (x) { return String(x.id) === String(id); })[0];
        var liked = a ? !!a.liked_by_me
            : !!(this._currentAnn && String(this._currentAnn.id) === String(id) && this._currentAnn.liked_by_me);
        try {
            var resp = await fetch(ANN_API + '/' + id + '/like/', {
                method: liked ? 'DELETE' : 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) {
                var b = await resp.json().catch(function () { return {}; });
                throw new Error(b.error || b.detail || '操作失败');
            }
            var raw = await resp.json();
            var d = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            if (!d) return;
            if (a) { a.liked_by_me = !!d.liked; a.like_count = d.like_count || 0; }
            if (this._currentAnn && String(this._currentAnn.id) === String(id)) {
                this._currentAnn.liked_by_me = !!d.liked;
                this._currentAnn.like_count = d.like_count || 0;
            }
            this._syncLikeUI(id);
            this.showToast(d.liked ? '已点赞' : '已取消点赞', false);
        } catch (e) {
            this.showToast((e && e.message) || '操作失败', true);
        }
    }

    _syncLikeUI(id) {
        var a = (this._list || []).filter(function (x) { return String(x.id) === String(id); })[0];
        var cur = (this._currentAnn && String(this._currentAnn.id) === String(id)) ? this._currentAnn : a;
        if (!cur) return;
        var liked = !!cur.liked_by_me;
        document.querySelectorAll('[data-ann-like="' + id + '"]').forEach(function (btn) {
            btn.classList.toggle('liked', liked);
            btn.title = liked ? '取消点赞' : '点赞';
            btn.style.borderColor = liked ? '#fbc4c4' : '#dcdfe6';
            btn.style.background = liked ? '#fdf0ef' : 'transparent';
            btn.style.color = liked ? '#f56c6c' : '#909399';
            var i = btn.querySelector('i');
            if (i) i.className = (liked ? 'fas' : 'far') + ' fa-thumbs-up';
            var s = btn.querySelector('span');
            if (s) s.textContent = cur.like_count || 0;
        });
    }

    _renderList() {
        var listEl = document.getElementById('annList');
        var self = this;
        if (!this._list.length) {
            listEl.innerHTML = '<div class="ann-empty"><i class="fas fa-bullhorn" style="font-size:40px;display:block;margin-bottom:10px;color:#c0c4cc;"></i>暂无公告</div>';
            return;
        }
        listEl.innerHTML = this._list.map(function (a) {
            var isAuthor = parseInt(localStorage.getItem('user_id'), 10) === a.author;
            var pub = a.is_published
                ? '<span class="ann-badge" style="background:#67c23a;">已发布</span>'
                : '<span class="ann-badge" style="background:#e6a23c;">草稿</span>';
            // 已归档：任何人（含发布人与超管）都不可编辑/删除，只保留查看
            var archTag = a.is_archived
                ? '<span class="ann-badge" style="background:#909399;"><i class="fas fa-box-archive"></i> 已归档</span>'
                : '';
            var scopeTag = '<span class="ann-badge" style="background:#7c4dff;">' + self._escape(a.scope_label || '集团全员') + '</span>';
            var contentText = (a.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            var actions = '';
            if (isAuthor && !a.is_archived) {
                actions = '<span style="margin-left:auto;display:flex;gap:6px;">'
                    + '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();annApp.openEditor(' + a.id + ')"><i class="fas fa-edit"></i> 编辑</button>'
                    + (!a.is_published ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();annApp.publish(' + a.id + ')"><i class="fas fa-paper-plane"></i> 发布</button>' : '')
                    + '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();annApp.del(' + a.id + ')"><i class="fas fa-trash"></i></button>'
                    + '</span>';
            } else if (a.is_archived) {
                // actions = '<span style="margin-left:auto;font-size:12px;color:#909399;">'
                //     + (parseInt(self._archiveDays, 10) > 0 ? '发布满 ' + parseInt(self._archiveDays, 10) + ' 天已自动归档' : '已归档')
                //     + '</span>';
                actions = '<span style="margin-left:auto;font-size:12px;color:#909399;">'
                    + (parseInt(self._archiveDays, 10) > 0 ? '' : '')
                    + '</span>';
            }
            var time = a.is_published ? (a.published_at || a.updated_at || '') : (a.updated_at || '');
            time = String(time).replace('T', ' ').slice(0, 16);
            return '<div class="ann-card" onclick="annApp.openDetail(' + a.id + ')">'
                + '<div class="ann-head">' + pub + archTag + scopeTag
                + '<div class="ann-title">' + self._escape(a.title) + '</div>'
                + actions + '</div>'
                + '<div class="ann-meta">'
                + '<span><img src="' + self._escape(a.author_avatar || '/static/images/default-avatar.png') + '" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:4px;">' + self._escape(a.author_name) + '</span>'
                + '<span><i class="fas fa-eye"></i> ' + (a.view_count || 0) + ' 浏览</span>'
                + '<span><i class="fas fa-clock"></i> ' + self._escape(time) + '</span>'
                + '<span><i class="fas fa-comment-dots"></i> ' + (a.comment_count || 0) + ' 条评论</span>'
                + self._likeBtnHtml(a, false)
                + '</div>'
                + (contentText ? '<div class="ann-content-box">' + self._escape(contentText) + '</div>' : '')
                + '</div>';
        }).join('');
    }

    // ==================== 编辑器 ====================
    async openEditor(id) {
        var self = this;
        this._editId = id || null;
        document.getElementById('annEditTitle').textContent = id ? '编辑公告' : '发布公告';
        document.getElementById('annTitle').value = '';
        document.getElementById('rteEditor').innerHTML = '';
        this._rteRange = null;
        this._resetRteToolbar();
        document.getElementById('annEnableComments').checked = true;
        document.getElementById('annCommentMode').value = 'public';
        document.querySelector('input[name="annScope"][value="all"]').checked = true;
        this._onScopeChange('all');
        document.querySelectorAll('.ann-sub-cb').forEach(function (c) { c.checked = false; });
        document.querySelectorAll('.ann-dept-cb').forEach(function (c) { c.checked = false; });
        this._scopeUsers = [];
        document.getElementById('annUserTags').innerHTML = '';
        document.getElementById('annUserSearch').value = '';
        if (id) {
            try {
                var a = await this.apiGet(ANN_API + '/' + id + '/');
                if (a.is_archived) {
                    this.showAlert('提示', '该公告已自动归档，任何人均不可编辑');
                    return;
                }
                document.getElementById('annTitle').value = a.title || '';
                document.getElementById('rteEditor').innerHTML = a.content || '';
                document.getElementById('annEnableComments').checked = !!a.enable_comments;
                document.getElementById('annCommentMode').value = a.comment_mode || 'public';
                var st = a.scope_type || 'all';
                document.querySelector('input[name="annScope"][value="' + st + '"]').checked = true;
                this._onScopeChange(st);
                (a.scope_sub_tenants || []).forEach(function (sid) {
                    document.querySelectorAll('.ann-sub-cb').forEach(function (c) { if (String(c.value) === String(sid)) c.checked = true; });
                });
                (a.scope_departments || []).forEach(function (did) {
                    document.querySelectorAll('.ann-dept-cb').forEach(function (c) { if (String(c.value) === String(did)) c.checked = true; });
                });
                (a.scope_users || []).forEach(function (uid) { self._addUserTag(uid); });
            } catch (e) { this.showAlert('加载失败', e.message); }
        }
        var modal = document.getElementById('annEditModal');
        modal.style.display = 'flex';
        setTimeout(function () { modal.classList.add('show'); }, 10);
    }

    closeEditor() {
        var modal = document.getElementById('annEditModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    }

    // ==================== 预览（编辑时查看最终效果） ====================
    openPreview() {
        var title = (document.getElementById('annTitle').value || '').trim();
        var content = document.getElementById('rteEditor').innerHTML || '';
        if (!title && !content) {
            this.showAlert('提示', '请先填写公告标题或内容');
            return;
        }
        var self = this;
        var scopeType = (document.querySelector('input[name="annScope"]:checked') || {}).value || 'all';
        var scopeLabel = {all: '集团全员', sub_tenants: '指定子公司', departments: '指定部门', users: '指定成员'}[scopeType] || '集团全员';
        var mode = (document.getElementById('annCommentMode').value || 'public');
        var enableComments = document.getElementById('annEnableComments').checked;
        var me = {};
        try { me = JSON.parse(localStorage.getItem('current_user') || '{}') || {}; } catch (e) { me = {}; }
        var meName = me.real_name || me.username || '我';
        var meAvatar = me.avatar_url || '/static/images/default-avatar.png';
        var now = new Date();
        var timeStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
            + ' ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var scopeDetail = '';
        if (scopeType === 'sub_tenants') {
            var subs = [];
            document.querySelectorAll('.ann-sub-cb:checked').forEach(function (c) {
                var lab = c.closest('label');
                subs.push(((lab && lab.textContent) || '').trim());
            });
            if (subs.length) scopeDetail = '（' + self._escape(subs.join('、')) + '）';
        } else if (scopeType === 'departments') {
            var depts = [];
            document.querySelectorAll('.ann-dept-cb:checked').forEach(function (c) {
                var lab = c.closest('label');
                depts.push(((lab && lab.textContent) || '').trim());
            });
            if (depts.length) scopeDetail = '（' + self._escape(depts.join('、')) + '）';
        } else if (scopeType === 'users') {
            if ((this._scopeUsers || []).length) {
                scopeDetail = '（' + self._escape(this._scopeUsers.map(function (u) { return u.name; }).join('、')) + '）';
            }
        }
        var body = document.getElementById('annPreviewBody');
        if (!body) return;
        body.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            + '<span class="ann-badge" style="background:#409eff;">预览效果</span>'
            + '<span class="ann-badge" style="background:#7c4dff;">' + this._escape(scopeLabel) + scopeDetail + '</span>'
            + '<span style="font-size:12px;color:#909399;">未发布，以下为发布后详情页的展示效果</span>'
            + '</div>'
            + '<div class="ann-detail-title" style="margin-top:10px;">' + this._escape(title || '（未填写标题）') + '</div>'
            + '<div class="ann-detail-meta">'
            + '<span><img src="' + this._escape(meAvatar) + '" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:4px;">' + this._escape(meName) + '</span>'
            + '<span><i class="fas fa-eye"></i> 0 浏览</span>'
            + '<span><i class="fas fa-clock"></i> ' + this._escape(timeStr) + '</span>'
            + '<span><i class="fas fa-comment-dots"></i> 0 条评论</span>'
            + '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;font-size:13px;border-radius:14px;border:1px solid #dcdfe6;color:#c0c4cc;"><i class="far fa-thumbs-up"></i> 0</span>'
            + '</div>'
            + '<div class="ann-detail-content" style="margin-bottom:16px;">' + (content || '<span style="color:#909399;">（未填写内容）</span>') + '</div>'
            + '<div style="border-top:1px solid #ebeef5;padding-top:14px;">'
            + '<div style="font-size:15px;font-weight:600;margin-bottom:10px;"><i class="fas fa-comment-dots" style="color:#7c4dff;"></i> 评论 <span style="font-size:12px;color:#909399;font-weight:400;">(0)</span></div>'
            + '<div style="color:#909399;font-size:12px;">暂无评论</div>'
            + '<div style="margin-top:12px;color:#909399;font-size:12px;">'
            + (enableComments
                ? '发布后范围内成员可评论（评论方式：' + (mode === 'anonymous' ? '匿名，仅本人与发布人可见' : '公开，范围成员可见') + '）'
                : '该公告未开启评论')
            + '</div></div>';
        var modal = document.getElementById('annPreviewModal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
        }
    }
    closePreview() {
        var modal = document.getElementById('annPreviewModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    }

    async save(publishNow) {
        var title = (document.getElementById('annTitle').value || '').trim();
        if (!title) { this.showAlert('提示', '请输入公告标题'); return; }
        var scopeType = document.querySelector('input[name="annScope"]:checked').value;
        var scopeSub = [], scopeDept = [], scopeUsers = [];
        document.querySelectorAll('.ann-sub-cb:checked').forEach(function (c) { scopeSub.push(parseInt(c.value)); });
        document.querySelectorAll('.ann-dept-cb:checked').forEach(function (c) { scopeDept.push(parseInt(c.value)); });
        this._scopeUsers.forEach(function (u) { scopeUsers.push(u.id); });
        var payload = {
            title: title,
            content: document.getElementById('rteEditor').innerHTML || '',
            scope_type: scopeType,
            scope_sub_tenants: scopeSub,
            scope_departments: scopeDept,
            scope_users: scopeUsers,
            enable_comments: document.getElementById('annEnableComments').checked,
            comment_mode: document.getElementById('annCommentMode').value
        };
        try {
            var saved;
            if (this._editId) {
                saved = await this.apiPut(ANN_API + '/' + this._editId + '/', payload);
            } else {
                saved = await this.apiPost(ANN_API + '/', payload);
            }
            if (publishNow) {
                var id = this._editId || saved.id;
                await this.apiPost(ANN_API + '/' + id + '/publish/', {});
                this.showToast('公告已发布并通知范围内成员', false);
            } else {
                this.showToast('已保存', false);
            }
            this.closeEditor();
            this._loadList();
        } catch (e) {
            this.showAlert('保存失败', e.message || '请重试');
        }
    }

    async publish(id) {
        var ok = await this.showConfirmDialog('发布公告', '确认发布该公告？发布后将通知范围内成员。', 'confirm');
        if (!ok) return;
        try {
            await this.apiPost(ANN_API + '/' + id + '/publish/', {});
            this.showToast('已发布并通知范围内成员', false);
            this._loadList();
        } catch (e) { this.showAlert('发布失败', e.message); }
    }

    async del(id) {
        var ok = await this.showConfirmDialog('删除公告', '确定删除该公告吗？删除后不可恢复。', 'danger');
        if (!ok) return;
        try {
            var resp = await fetch(ANN_API + '/' + id + '/', {method: 'DELETE', headers: TokenManager.getHeaders()});
            if (!resp.ok) throw new Error('删除失败');
            this.showToast('已删除', false);
            this._loadList();
        } catch (e) { this.showAlert('删除失败', e.message); }
    }

    // ==================== 富文本 ====================
    // 初始化：记录选区（点击工具栏/下拉框会丢失焦点，必须能恢复）、
    // 让 execCommand 输出 CSS style（颜色/字体需要）、支持直接粘贴图片、粘贴 HTML 安全清理
    _initRte() {
        var ed = document.getElementById('rteEditor');
        if (!ed) return;
        var self = this;
        try { document.execCommand('styleWithCSS', false, 'true'); } catch (e) {}

        // 只记录发生在编辑器内部的选区；不要监听 blur，
        // 否则点下拉框导致失焦时会用「已折叠的」选区覆盖掉 mousedown 时保存的正确选区
        ['mouseup', 'keyup', 'input'].forEach(function (ev) {
            ed.addEventListener(ev, function () {
                self._saveSel();
                if (ev === 'mouseup' || ev === 'keyup') self._syncToolbarState();
            });
        });
        // 工具栏 mousedown 捕获阶段：在焦点移走之前先保存选区
        var tb = document.getElementById('rteToolbar');
        if (tb) {
            tb.addEventListener('mousedown', function () { self._saveSel(); }, true);
        }
        ed.addEventListener('paste', function (e) { self._onRtePaste(e); });

        // 点击取色面板以外区域 → 关闭面板
        document.addEventListener('click', function (e) {
            var panel = document.getElementById('rteColorPanel');
            if (!panel || !panel.classList.contains('show')) return;
            if (e.target.closest('#rteColorPanel') || e.target.closest('.rte-color-btn')) return;
            panel.classList.remove('show');
        });

        this._buildColorGrid();
    }

    _saveSel() {
        try {
            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            var range = sel.getRangeAt(0);
            var ed = document.getElementById('rteEditor');
            if (!ed || !ed.contains(range.commonAncestorContainer)) return;
            this._rteRange = range.cloneRange();
        } catch (e) { /* 忽略：选区不可用时不做记录 */ }
    }

    // 重新聚焦编辑器并恢复上一次选区，返回编辑器元素
    _focusRestore() {
        var ed = document.getElementById('rteEditor');
        if (!ed) return null;
        ed.focus();
        // 部分浏览器在编辑会话切换后会重置该标记，这里每次恢复焦点时都重新确保
        // 颜色/字体走 CSS（而不是过时的 <font>）
        try { document.execCommand('styleWithCSS', false, 'true'); } catch (e) {}
        try {
            var sel = window.getSelection();
            if (this._rteRange && sel) {
                sel.removeAllRanges();
                sel.addRange(this._rteRange);
            }
        } catch (e) { /* 忽略 */ }
        return ed;
    }

    _exec(cmd, val) {
        try {
            document.execCommand(cmd, false, val === undefined ? null : val);
        } catch (e) {
            console.warn('富文本命令失败:', cmd, e);
        }
    }

    _afterRte() {
        this._saveSel();
        this._syncToolbarState();
    }

    // 工具栏状态回显：加粗/斜体等按钮高亮 + 段落格式下拉同步
    _syncToolbarState() {
        var tb = document.getElementById('rteToolbar');
        if (!tb) return;
        tb.querySelectorAll('button[data-cmd]').forEach(function (b) {
            var on = false;
            try { on = document.queryCommandState(b.getAttribute('data-cmd')); } catch (e) {}
            b.classList.toggle('active', !!on);
        });
        var blockSel = document.getElementById('rteBlock');
        if (blockSel) {
            var blk = '';
            try { blk = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) {}
            // 有的浏览器会返回 '<h2>' 这种带尖括号的值，统一去掉再匹配
            blk = blk.replace(/[<>\s]/g, '');
            var valid = ['p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'pre'];
            blockSel.value = valid.indexOf(blk) >= 0 ? blk : '';
        }
    }

    _resetRteToolbar() {
        ['rteBlock', 'rteFont', 'rteSize'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        var panel = document.getElementById('rteColorPanel');
        if (panel) panel.classList.remove('show');
        var tb = document.getElementById('rteToolbar');
        if (tb) tb.querySelectorAll('button.active').forEach(function (b) { b.classList.remove('active'); });
    }

    rte(cmd, val) {
        this._focusRestore();
        if (cmd === 'formatBlock' && val) {
            this._exec('formatBlock', '<' + String(val).toLowerCase() + '>');
        } else {
            this._exec(cmd, val);
        }
        this._afterRte();
    }

    // 段落格式：正文 / 标题 / 引用 / 代码块
    rteBlock(val) {
        if (!val) return;
        this.rte('formatBlock', val);
    }

    // 字体：execCommand('fontName')（styleWithCSS 下输出 font-family）
    rteFont(val) {
        if (!val) return;
        this.rte('fontName', val);
    }

    // 字号：execCommand('fontSize') 只支持 1~7，所以先落一个临时标记再换成精确 px。
    // 🔧 关键修复：styleWithCSS=true 时 Chrome 会输出 <span style="font-size:xxx-large">，
    //    原来只找 <font size=7> 就会一无所获、字号完全没变。
    //    这里先临时关闭 styleWithCSS 让它输出 <font size=7>，替换完再恢复。
    rteFontSize(px) {
        px = parseInt(px, 10);
        if (!px) return;
        var ed = this._focusRestore();
        if (!ed) return;
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        if (!ed.contains(range.commonAncestorContainer)) return;
        var snapshot = range.cloneRange();   // 兜底用：execCommand 没产出标记时按它包 span

        try {
            document.execCommand('styleWithCSS', false, 'false');
            document.execCommand('fontSize', false, '7');
        } catch (e) {
            console.warn('字号命令执行失败:', e);
        } finally {
            try { document.execCommand('styleWithCSS', false, 'true'); } catch (e) {}
        }

        // 把临时标记替换成精确 px；若没找到任何标记则退化为「按选区包 span」
        if (!this._applyExactFontSize(ed, px)) {
            this._wrapRangeWithFontSize(snapshot, px);
        }
        this._afterRte();
    }

    // 把 <font size=7> / 关键词字号的 span 统一改为 <span style="font-size:Npx">
    // 同时保留原有的颜色、字体等内联样式
    _applyExactFontSize(ed, px) {
        var targets = [];
        Array.prototype.forEach.call(ed.querySelectorAll('font[size="7"], font[size="+7"], font[size="7.0"]'), function (n) {
            targets.push(n);
        });
        Array.prototype.forEach.call(ed.querySelectorAll('span'), function (n) {
            var v = String((n.style && n.style.fontSize) || '');
            // 只处理非 px 的「关键词字号」（xxx-large 之类），我们自己写入的 px 不动
            if (v && v.indexOf('px') < 0) targets.push(n);
        });

        targets.forEach(function (el) {
            var keep = String(el.getAttribute('style') || '')
                .replace(/font-size\s*:[^;]*;?/gi, '')
                .replace(/;+$/, '').trim();
            var parts = [];
            if (keep) parts.push(keep);
            var colorAttr = el.getAttribute('color');
            if (colorAttr) parts.push('color:' + colorAttr);
            var faceAttr = el.getAttribute('face');
            if (faceAttr) parts.push('font-family:' + faceAttr);
            parts.push('font-size:' + px + 'px');

            var span = document.createElement('span');
            span.setAttribute('style', parts.join(';'));
            while (el.firstChild) span.appendChild(el.firstChild);
            el.parentNode.replaceChild(span, el);
        });
        return targets.length > 0;
    }

    // 兜底：直接把选区（或折叠光标处）包一层带字号的 span
    _wrapRangeWithFontSize(range, px) {
        if (!range) return;
        try {
            var span = document.createElement('span');
            span.setAttribute('style', 'font-size:' + px + 'px');
            var sel = window.getSelection();
            if (range.collapsed) {
                range.insertNode(span);
                var r = document.createRange();
                r.setStart(span, 0);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
            } else {
                span.appendChild(range.extractContents());
                range.insertNode(span);
                var r2 = document.createRange();
                r2.selectNodeContents(span);
                sel.removeAllRanges();
                sel.addRange(r2);
            }
        } catch (e) {
            console.warn('字号兜底处理失败:', e);
        }
    }

    // ==================== 颜色 / 高亮 ====================
    _buildColorGrid() {
        var grid = document.getElementById('rteColorGrid');
        if (!grid) return;
        var palette = ['#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
            '#e74c3c', '#f56c6c', '#e67e22', '#f0a020', '#f1c40f', '#67c23a',
            '#2ecc71', '#1abc9c', '#409eff', '#3498db', '#7c4dff', '#9b59b6',
            '#e91e63', '#8d6e63'];
        var html = '<div class="rte-color-swatch rte-color-none" title="默认（清除颜色）" '
            + 'onmousedown="event.preventDefault()" onclick="annApp.rteColor(\'\')">默认</div>';
        html += palette.map(function (c) {
            return '<div class="rte-color-swatch" style="background:' + c + '" title="' + c + '" '
                + 'onmousedown="event.preventDefault()" onclick="annApp.rteColor(\'' + c + '\')"></div>';
        }).join('');
        grid.innerHTML = html;
    }

    toggleColorPanel(mode) {
        var panel = document.getElementById('rteColorPanel');
        if (!panel) return;
        var same = panel.classList.contains('show') && this._colorPanelMode === mode;
        this._colorMode = mode;
        this._colorPanelMode = mode;
        var title = document.getElementById('rteColorPanelTitle');
        if (title) title.textContent = mode === 'hilite' ? '背景高亮' : '字体颜色';
        panel.classList.toggle('show', !same);
    }

    // color 为空 → 清除（字色 inherit / 高亮 transparent）
    rteColor(color) {
        var mode = this._colorMode === 'hilite' ? 'hilite' : 'fore';
        var value = color || (mode === 'hilite' ? 'transparent' : 'inherit');
        this._focusRestore();
        this._exec(mode === 'hilite' ? 'hiliteColor' : 'foreColor', value);
        var bar = document.getElementById(mode === 'hilite' ? 'rteHiliteBar' : 'rteForeBar');
        if (bar) bar.style.background = color || (mode === 'hilite' ? '#ffe58f' : '#606266');
        var panel = document.getElementById('rteColorPanel');
        if (panel) panel.classList.remove('show');
        this._afterRte();
    }

    rteApplyCustomColor() {
        var inp = document.getElementById('rteCustomColor');
        this.rteColor(inp ? inp.value : '');
    }

    // ==================== 其它命令 ====================
    rteInsertHr() {
        this._focusRestore();
        this._exec('insertHorizontalRule');
        this._afterRte();
    }

    rteClearFormat() {
        this._focusRestore();
        this._exec('removeFormat');
        this._exec('formatBlock', '<p>');
        this._afterRte();
    }

    // 粘贴：图片文件直接上传插入；HTML 走安全清理（去脚本/事件属性/javascript: 链接）
    _onRtePaste(e) {
        var dt = e.clipboardData;
        if (!dt) return;
        var files = dt.files;
        if (files && files.length) {
            for (var i = 0; i < files.length; i++) {
                if (files[i].type && files[i].type.indexOf('image/') === 0) {
                    e.preventDefault();
                    this._saveSel();
                    this._uploadImage(files[i]);
                    return;
                }
            }
        }
        var html = dt.getData ? dt.getData('text/html') : '';
        if (html) {
            e.preventDefault();
            this._focusRestore();
            this._exec('insertHTML', this._sanitizeRteHtml(html));
            this._afterRte();
        }
        // 纯文本：交给浏览器默认处理（保留换行）
    }

    _sanitizeRteHtml(html) {
        var box = document.createElement('div');
        box.innerHTML = html || '';
        // 1) 移除危险标签
        box.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach(function (n) {
            n.remove();
        });
        // 2) 移除事件属性与 javascript: 链接/图片地址
        box.querySelectorAll('*').forEach(function (n) {
            Array.prototype.slice.call(n.attributes || []).forEach(function (attr) {
                var name = String(attr.name || '').toLowerCase();
                var value = String(attr.value || '');
                if (name.indexOf('on') === 0) n.removeAttribute(attr.name);
                else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) n.removeAttribute(attr.name);
                else if (name === 'style' && /expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(value)) n.removeAttribute(attr.name);
            });
        });
        return box.innerHTML;
    }

    async rteInsertLink() {
        var url = await this.showInputDialog('插入链接', '请输入链接地址');
        if (!url) return;
        url = url.trim();
        // 🔧 createLink 只在「已选中文字」时生效；光标只是落在某处时改为插入一个链接文本，
        //    否则用户点了没反应会以为功能坏了
        var collapsed = !this._rteRange || this._rteRange.collapsed;
        if (collapsed) {
            this._focusRestore();
            this._exec('insertHTML', '<a href="' + this._escape(url) + '" target="_blank" style="color:#409eff;">' + this._escape(url) + '</a>');
            this._afterRte();
            return;
        }
        this.rte('createLink', url);
    }
    async rteInsertVideo() {
        var url = await this.showInputDialog('插入视频', '请输入视频地址（mp4/网页视频URL）');
        if (!url) return;
        this._focusRestore();
        this._exec('insertHTML', '<video controls preload="metadata" style="max-width:100%;border-radius:6px;"><source src="' + this._escape(url.trim()) + '"></video><br>');
        this._afterRte();
    }
    async rteInsertTable() {
        var rows = parseInt(await this.showInputDialog('插入表格', '表格行数（1-20）', '3'), 10);
        if (!rows || rows < 1 || rows > 20) return;
        var cols = parseInt(await this.showInputDialog('插入表格', '表格列数（1-10）', '3'), 10);
        if (!cols || cols < 1 || cols > 10) return;
        var h = '<table><tbody>';
        for (var i = 0; i < rows; i++) {
            h += '<tr>';
            for (var j = 0; j < cols; j++) h += '<td>&nbsp;</td>';
            h += '</tr>';
        }
        h += '</tbody></table><br>';
        this._focusRestore();
        this._exec('insertHTML', h);
        this._afterRte();
    }
    async rteInsertFile() {
        var url = await this.showInputDialog('插入附件', '请输入附件链接地址');
        if (!url) return;
        var name = await this.showInputDialog('插入附件', '附件名称', url.split('/').pop() || '附件');
        this._focusRestore();
        this._exec('insertHTML', '<p><a href="' + this._escape(url.trim()) + '" target="_blank" style="color:#409eff;"><i class="fa fa-paperclip"></i> ' + this._escape(name) + '</a></p>');
        this._afterRte();
    }
    rteInsertImage() {
        var self = this;
        var inp = document.getElementById('annImgInput');
        if (!inp) return;
        this._saveSel();
        inp.onchange = function () {
            var file = inp.files && inp.files[0];
            inp.value = '';
            if (!file) return;
            self._uploadImage(file);
        };
        inp.click();
    }
    async _uploadImage(file) {
        var fd = new FormData();
        fd.append('file', file);
        try {
            // FormData 由浏览器自动设置 multipart boundary，不能带 application/json Content-Type
            var headers = Object.assign({}, TokenManager.getHeaders());
            delete headers['Content-Type'];
            var resp = await fetch('/api/chat/upload/', {method: 'POST', headers: headers, body: fd});
            if (!resp.ok) throw new Error('上传失败');
            var json = await resp.json();
            var url = json.file_url || json.url || json.file || '';
            if (!url && json.data) url = json.data.file_url || json.data.url || '';
            if (!url) { this.showAlert('上传失败', '无法获取图片地址'); return; }
            this._focusRestore();
            this._exec('insertHTML', '<img src="' + this._escape(url) + '" style="max-width:100%;border-radius:6px;"><br>');
            this._afterRte();
        } catch (e) {
            var url2 = await this.showInputDialog('上传失败', '上传失败，可粘贴图片URL');
            if (url2) {
                this._focusRestore();
                this._exec('insertHTML', '<img src="' + this._escape(url2.trim()) + '" style="max-width:100%;border-radius:6px;"><br>');
                this._afterRte();
            }
        }
    }

    // ==================== 范围成员搜索 ====================
    async _userSearch() {
        var kw = document.getElementById('annUserSearch').value;
        var dd = document.getElementById('annUserDropdown');
        if (!kw.trim()) { dd.style.display = 'none'; return; }
        try {
            var resp = await fetch('/api/oa/approval/search-cc-users/?search=' + encodeURIComponent(kw), {headers: TokenManager.getHeaders()});
            if (!resp.ok) return;
            var json = await resp.json();
            var d = json.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(json) : json;
            var users = d.results || [];
            var self = this;
            dd.innerHTML = users.length ? users.map(function (u) {
                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-bottom:1px solid #f0f0f0;" onclick="annApp._pickUser(' + u.id + ', \'' + self._escape(u.name) + '\', \'' + self._escape(u.avatar || '/static/images/default-avatar.png') + '\')">'
                    + '<img src="' + self._escape(u.avatar || '/static/images/default-avatar.png') + '" style="width:26px;height:26px;border-radius:50%;">'
                    + '<span style="flex:1;font-size:13px;">' + self._escape(u.name) + '</span>'
                    + (u.department ? '<span style="font-size:11px;color:#909399;">' + self._escape(u.department) + '</span>' : '')
                    + '</div>';
            }).join('') : '<div style="padding:8px 12px;color:#909399;font-size:13px;">未找到成员</div>';
            dd.style.display = 'block';
        } catch (e) { dd.style.display = 'none'; }
    }
    _pickUser(id, name, avatar) {
        this._addUserTag({id: id, name: name, avatar: avatar});
        document.getElementById('annUserSearch').value = '';
        document.getElementById('annUserDropdown').style.display = 'none';
    }
    _addUserTag(u) {
        if (!u || !u.id) return;
        var exists = this._scopeUsers.some(function (x) { return String(x.id) === String(u.id); });
        if (exists) return;
        this._scopeUsers.push(u);
        this._renderUserTags();
    }
    _removeUserTag(id) {
        this._scopeUsers = this._scopeUsers.filter(function (x) { return String(x.id) !== String(id); });
        this._renderUserTags();
    }
    _renderUserTags() {
        var wrap = document.getElementById('annUserTags');
        var self = this;
        wrap.innerHTML = this._scopeUsers.map(function (u) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:#ecf5ff;border-radius:12px;font-size:12px;color:#409eff;"><img src="' + self._escape(u.avatar || '/static/images/default-avatar.png') + '" style="width:18px;height:18px;border-radius:50%;"> ' + self._escape(u.name) + '<i class="fas fa-times" style="cursor:pointer;margin-left:2px;" onclick="annApp._removeUserTag(' + u.id + ')"></i></span>';
        }).join('');
    }

    // ==================== 详情 ====================
    async openDetail(id) {
        try {
            var a = await this.apiGet(ANN_API + '/' + id + '/');
            var body = document.getElementById('annDetailBody');
            var self = this;
            var isAuthor = parseInt(localStorage.getItem('user_id'), 10) === a.author;
            var pub = a.is_published ? '<span class="ann-badge" style="background:#67c23a;">已发布</span>' : '<span class="ann-badge" style="background:#e6a23c;">草稿</span>';
            var archTag = a.is_archived
                ? '<span class="ann-badge" style="background:#909399;"><i class="fas fa-box-archive"></i> 已归档</span>'
                : '';
            // 已归档：不显示编辑/发布/删除
            var actions = (isAuthor && !a.is_archived)
                ? '<span style="display:flex;gap:6px;">'
                    + '<button class="btn btn-sm btn-secondary" onclick="annApp.closeDetail();annApp.openEditor(' + a.id + ')"><i class="fas fa-edit"></i> 编辑</button>'
                    + (!a.is_published ? '<button class="btn btn-sm btn-primary" onclick="annApp.publish(' + a.id + ')"><i class="fas fa-paper-plane"></i> 发布</button>' : '')
                    + '<button class="btn btn-sm btn-danger" onclick="annApp.del(' + a.id + ')"><i class="fas fa-trash"></i> 删除</button>'
                    + '</span>'
                : (a.is_archived ? '<span style="font-size:12px;color:#909399;"></span>' : '');
            var time = String(a.published_at || a.updated_at || '').replace('T', ' ').slice(0, 16);
            body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;justify-content: space-between;"><div style="display:flex;align-items:center;gap:6px;">' + pub + archTag + '<span class="ann-badge" style="background:#7c4dff;">' + this._escape(a.scope_label || '集团全员') + '</span></div>' + actions + '</div>'
                + '<div class="ann-detail-title">' + this._escape(a.title) + '</div>'
                + '<div class="ann-detail-meta">'
                + '<span><img src="' + this._escape(a.author_avatar || '/static/images/default-avatar.png') + '" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:4px;">' + this._escape(a.author_name) + '</span>'
                + '<span><i class="fas fa-eye"></i> ' + (a.view_count || 0) + ' 浏览</span>'
                + '<span><i class="fas fa-clock"></i> ' + this._escape(time) + '</span>'
                + '<span><i class="fas fa-comment-dots"></i> ' + (a.comment_count || 0) + ' 条评论</span>'
                + '<span>' + this._likeBtnHtml(a, true) + '</span>'
                + '</div>'
                + '<div class="ann-detail-content" style="margin-bottom:16px;">' + (a.content || '') + '</div>'
                + '<div style="border-top:1px solid #ebeef5;padding-top:14px;">'
                + '<div style="font-size:15px;font-weight:600;margin-bottom:10px;"><i class="fas fa-comment-dots" style="color:#7c4dff;"></i> 评论 <span id="annCommentCount" style="font-size:12px;color:#909399;font-weight:400;">(' + (a.comment_count || 0) + ')</span></div>'
                + '<div id="annComments"></div>'
                + (a.enable_comments ? '<div style="margin-top:12px;">'
                    + '<div id="annReplyBanner" style="display:none;align-items:center;gap:8px;background:#f3e8ff;border-radius:8px;padding:6px 10px;font-size:12px;color:#7c4dff;margin-bottom:8px;">'
                    + '<i class="fas fa-reply"></i> 回复 <b id="annReplyTarget"></b>'
                    + '<i class="fas fa-times" style="margin-left:auto;cursor:pointer;" onclick="annApp._clearReply()"></i></div>'
                    + '<div style="display:flex;gap:8px;align-items:flex-start;">'
                    + '<textarea id="annCommentInput" class="form-textarea" style="flex:1;min-height:60px;" placeholder="写下你的评论..."></textarea>'
                    + '<div style="display:flex;flex-direction:column;gap:6px;">'
                    + '<button type="button" class="btn btn-secondary btn-sm" onclick="annApp._pickCommentImage()" title="评论配图"><i class="fas fa-image"></i></button>'
                    + '<button type="button" class="btn btn-secondary btn-sm" onclick="annApp._toggleCommentEmoji()" title="表情"><i class="far fa-smile"></i></button>'
                    + (a.comment_mode === 'anonymous' ? '<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="annCommentAnonymous" style="width:14px;height:14px;"> 匿名</label>' : '')
                    + '<button class="btn btn-primary btn-sm" onclick="annApp.addComment(' + a.id + ')"><i class="fas fa-paper-plane"></i> 评论</button>'
                    + '</div></div>'
                    + '<input type="file" id="annCommentImgInput" accept="image/*" style="display:none;">'
                    + '<div id="annCommentImageWrap" style="display:none;margin-top:6px;position:relative;width:fit-content;">'
                    + '<img id="annCommentImage" src="" style="max-width:120px;max-height:120px;border-radius:6px;object-fit:cover;">'
                    + '<i class="fas fa-times" onclick="annApp._clearCommentImage()" style="position:absolute;top:-6px;right:-6px;background:#f56c6c;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;"></i></div>'
                    + '<div id="annCommentEmojiPanel" style="display:none;margin-top:6px;border:1px solid #dcdfe6;border-radius:8px;padding:8px;background:#fff;">'
                    + '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + this._commentEmojis().map(function (e) {
                        return '<span style="font-size:20px;cursor:pointer;line-height:1;" onclick="annApp._insertCommentEmoji(\'' + e + '\')">' + e + '</span>';
                    }).join('') + '</div></div>'
                    + '</div>' : '<div style="color:#909399;font-size:12px;">该公告未开启评论</div>')
                + '</div>';
            this._currentAnn = a;
            // 重置评论输入状态（图片/表情/回复）
            this._commentImage = null;
            this._replyToId = null;
            this._replyToName = '';
            var modal = document.getElementById('annDetailModal');
            modal.style.display = 'flex';
            setTimeout(function () { modal.classList.add('show'); }, 10);
            this._loadComments(id);
        } catch (e) {
            this.showAlert('加载失败', e.message || '');
        }
    }
    closeDetail() {
        var modal = document.getElementById('annDetailModal');
        if (modal) { modal.classList.remove('show'); setTimeout(function () { modal.style.display = 'none'; }, 150); }
    }
    async _loadComments(id) {
        try {
            var d = await this.apiGet(ANN_API + '/' + id + '/comments/');
            this._currentComments = d;
            this._renderComments(d.comments || []);
        } catch (e) { console.warn('加载评论失败', e); }
    }
    // ==================== 评论：图片/表情/二级回复 ====================
    _commentEmojis() {
        return ['😀', '😄', '😂', '😊', '😍', '😅', '🤣', '😇', '😎', '🥰', '😘', '🙂', '🤔', '🤗', '😉', '😋', '😝', '😜', '🤩', '😭', '😢', '😡', '🥳', '👍', '👎', '👏', '🙌', '👌', '✌️', '🤝', '💪', '🙏', '❤️', '💖', '🔥', '🎉', '🎊', '✨', '⭐', '👋', '🤗', '💯', '🍀', '🌈'];
    }
    _pickCommentImage() {
        var inp = document.getElementById('annCommentImgInput');
        if (!inp) return;
        var self = this;
        inp.onchange = function () {
            var file = inp.files && inp.files[0];
            inp.value = '';
            if (!file) return;
            self._uploadCommentImage(file);
        };
        inp.click();
    }
    async _uploadCommentImage(file) {
        var fd = new FormData();
        fd.append('file', file);
        try {
            var headers = Object.assign({}, TokenManager.getHeaders());
            delete headers['Content-Type'];
            var resp = await fetch('/api/chat/upload/', {method: 'POST', headers: headers, body: fd});
            if (!resp.ok) throw new Error('上传失败');
            var json = await resp.json();
            var url = json.file_url || json.url || json.file || '';
            if (!url && json.data) url = json.data.file_url || json.data.url || '';
            if (!url) { this.showAlert('上传失败', '无法获取图片地址'); return; }
            this._commentImage = url;
            var img = document.getElementById('annCommentImage');
            if (img) img.src = url;
            var wrap = document.getElementById('annCommentImageWrap');
            if (wrap) wrap.style.display = 'block';
        } catch (e) {
            this.showAlert('上传失败', e.message || '请重试');
        }
    }
    _clearCommentImage() {
        this._commentImage = null;
        var img = document.getElementById('annCommentImage');
        if (img) img.src = '';
        var wrap = document.getElementById('annCommentImageWrap');
        if (wrap) wrap.style.display = 'none';
    }
    _toggleCommentEmoji() {
        var panel = document.getElementById('annCommentEmojiPanel');
        if (panel) panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    }
    _insertCommentEmoji(emoji) {
        var input = document.getElementById('annCommentInput');
        if (input) {
            input.value = (input.value || '') + emoji;
            input.focus();
        }
    }
    _setReplyTarget(id, name) {
        this._replyToId = id;
        this._replyToName = name || '';
        var banner = document.getElementById('annReplyBanner');
        var target = document.getElementById('annReplyTarget');
        if (banner) banner.style.display = 'flex';
        if (target) target.textContent = '@' + this._replyToName;
        var input = document.getElementById('annCommentInput');
        if (input) input.focus();
    }
    _clearReply() {
        this._replyToId = null;
        this._replyToName = '';
        var banner = document.getElementById('annReplyBanner');
        if (banner) banner.style.display = 'none';
    }
    _renderComments(list) {
        var wrap = document.getElementById('annComments');
        var self = this;
        var meId = parseInt(localStorage.getItem('user_id'), 10);
        var countEl = document.getElementById('annCommentCount');
        if (countEl) countEl.textContent = '(' + (list.length || 0) + ')';
        if (!list.length) {
            wrap.innerHTML = '<div style="color:#909399;font-size:12px;padding:10px 0;">暂无评论</div>';
            return;
        }
        // 按评论时间倒序：最新评论在最上面（一级评论与二级回复均倒序）
        var sorted = (list || []).slice().sort(function (x, y) {
            return String(y.created_at || '').localeCompare(String(x.created_at || ''));
        });
        // 一级评论 + 二级回复（按 parent 分组）
        var top = [], children = {};
        sorted.forEach(function (c) {
            if (c.parent) { (children[c.parent] = children[c.parent] || []).push(c); }
            else top.push(c);
        });
        var renderOne = function (c, isReply) {
            var name = c.is_anonymous ? '匿名用户' : c.author_name;
            var avatar = c.is_anonymous ? '/static/images/default-avatar.png' : (c.avatar || '/static/images/default-avatar.png');
            var time = String(c.created_at || '').replace('T', ' ').slice(0, 16);
            var replyTag = isReply && c.parent_author_name
                ? '<span style="color:#7c4dff;font-size:12px;">回复 @' + self._escape(c.parent_author_name) + '：</span>' : '';
            var imageHtml = c.image
                ? '<div style="margin-top:4px;"><img src="' + self._escape(c.image) + '" style="max-width:140px;max-height:140px;border-radius:6px;object-fit:cover;cursor:pointer;" onclick="window.open(\'' + self._escape(c.image) + '\',\'_blank\')"></div>'
                : '';
            return '<div class="comment-item" style="' + (isReply ? 'padding-left:34px;' : '') + '">'
                + '<img src="' + self._escape(avatar) + '" class="c-avatar">'
                + '<div class="c-body">'
                + '<div><span class="c-name">' + self._escape(name) + '</span><span class="c-time">' + self._escape(time) + '</span></div>'
                + '<div class="c-text">' + replyTag + self._escape(c.content) + '</div>'
                + imageHtml
                + '<div style="margin-top:2px;"><span style="font-size:11px;color:#909399;cursor:pointer;" onclick="annApp._setReplyTarget(' + c.id + ', \'' + self._escape(name) + '\')"><i class="fas fa-reply"></i> 回复</span></div>'
                + '</div></div>';
        };
        var html = '';
        top.forEach(function (c) {
            html += renderOne(c, false);
            (children[c.id] || []).forEach(function (r) { html += renderOne(r, true); });
        });
        wrap.innerHTML = html;
    }
    async addComment(id) {
        var input = document.getElementById('annCommentInput');
        var content = (input.value || '').trim();
        if (!content && !this._commentImage) { this.showAlert('提示', '请输入评论内容'); return; }
        var payload = {content: content};
        var anon = document.getElementById('annCommentAnonymous');
        if (anon) payload.is_anonymous = anon.checked;
        if (this._commentImage) payload.image = this._commentImage;
        if (this._replyToId) payload.parent_id = this._replyToId;
        try {
            await this.apiPost(ANN_API + '/' + id + '/add-comment/', payload);
            input.value = '';
            if (anon) anon.checked = false;
            this._clearCommentImage();
            this._clearReply();
            this._loadComments(id);
            this._loadList();
        } catch (e) { this.showAlert('评论失败', e.message); }
    }

    toggleMaximize(btn) {
        var content = btn.closest('.modal-content');
        if (content) {
            var isMax = content.classList.toggle('maximized');
            btn.innerHTML = isMax ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
        }
    }

    _formatTime(iso) {
        if (!iso) return '-';
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
            + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    // ==================== 优雅的提示对话框 ====================
    showAlert(title, message) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-info-circle"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn confirm">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = () => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve();
            };
            dialog.querySelector('.confirm').addEventListener('click', close);
            dialog.querySelector('.close-btn').addEventListener('click', close);
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close();
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    // ==================== 优雅的确认对话框 ====================
    showConfirmDialog(title, message, type) {
        if (type === undefined) type = 'confirm';
        return new Promise((resolve) => {
            const iconMap = {danger: 'exclamation-triangle', confirm: 'check-circle'};
            const icon = iconMap[type] || 'question-circle';
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-' + icon + '"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">' + message + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn cancel">取消</button>'
                + '<button class="confirm-dialog-btn ' + type + '">确定</button></div></div>';
            document.body.appendChild(dialog);
            const close = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve(result);
            };
            dialog.querySelector('.cancel').addEventListener('click', () => close(false));
            dialog.querySelector('.' + type).addEventListener('click', () => close(true));
            dialog.querySelector('.close-btn').addEventListener('click', () => close(false));
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close(false);
            });
            setTimeout(() => dialog.classList.add('show'), 10);
        });
    }

    // ==================== 优雅的输入对话框 ====================
    showInputDialog(title, placeholder, defaultValue, opts) {
        return new Promise((resolve) => {
            const dialog = document.createElement('div');
            dialog.className = 'confirm-dialog';
            const type = (opts && opts.type) || 'text';
            dialog.innerHTML = '<div class="confirm-dialog-content">'
                + '<div class="confirm-dialog-header">'
                + '<i class="fas fa-pen"></i>'
                + '<span>' + this._escape(title) + '</span>'
                + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                + '<div class="confirm-dialog-body">'
                + '<input type="' + type + '" class="form-input" style="width:100%;box-sizing:border-box;" placeholder="' + this._escape(placeholder || '') + '" value="' + this._escape(defaultValue || '') + '">'
                + '</div>'
                + '<div class="confirm-dialog-footer">'
                + '<button class="confirm-dialog-btn cancel">取消</button>'
                + '<button class="confirm-dialog-btn confirm">确定</button></div></div>';
            document.body.appendChild(dialog);
            const input = dialog.querySelector('input');
            const close = (result) => {
                dialog.classList.remove('show');
                setTimeout(() => {
                    if (dialog.parentNode) document.body.removeChild(dialog);
                }, 250);
                resolve(result);
            };
            dialog.querySelector('.cancel').addEventListener('click', () => close(null));
            dialog.querySelector('.confirm').addEventListener('click', () => close((input.value || '').trim()));
            dialog.querySelector('.close-btn').addEventListener('click', () => close(null));
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) close(null);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') close((input.value || '').trim());
                if (e.key === 'Escape') close(null);
            });
            setTimeout(() => {
                dialog.classList.add('show');
                input.focus();
                input.select();
            }, 10);
        });
    }

    showToast(message, isError) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }
        const icon = isError ? 'fa-exclamation-circle' : 'fa-check-circle';
        const title = isError ? '错误' : '成功';
        const color = isError ? '#f56c6c' : '#67c23a';
        toast.innerHTML = '<div class="toast-content" style="border-left-color:' + color + ';">'
            + '<div class="toast-icon"><i class="fas ' + icon + '" style="color:' + color + ';"></i></div>'
            + '<div><div class="toast-title">' + title + '</div>'
            + '<div class="toast-text">' + this._escape(message) + '</div></div></div>';
        toast.classList.remove('show');
        void toast.offsetHeight;
        toast.classList.add('show');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
    }

    showError(message) {
        this.showToast(message, true);
    }

    showSuccess(message) {
        this.showToast(message, false);
    }
}

var annApp = new AnnouncementApp();
window.annApp = annApp;
