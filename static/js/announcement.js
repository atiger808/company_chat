// static/js/announcement.js - 集团公告
const ANN_API = '/api/oa/announcements';

class AnnouncementApp {
    constructor() {
        this._editId = null;
        this._subTenants = [];
        this._depts = [];
        this._users = [];
        this._scopeUsers = [];
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
        var canCreate = me ? (me.user_type === 'super_admin' || me.user_type === 'admin') : (localStorage.getItem('user_type') === 'super_admin' || localStorage.getItem('user_type') === 'admin');
        var createBtn = document.getElementById('annCreateBtn');
        if (createBtn) createBtn.style.display = canCreate ? 'inline-flex' : 'none';
        this._loadScopes();
        this._loadList();
        // 从通知跳转：?id=xxx 打开详情
        var qp = new URLSearchParams(window.location.search);
        var aid = qp.get('id');
        if (aid) setTimeout(function () { annApp.openDetail(parseInt(aid, 10)); }, 300);
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
            this._renderList();
        } catch (e) {
            listEl.innerHTML = '<div class="ann-empty">加载失败：' + this._escape(e.message || '') + '</div>';
        }
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
            var scopeTag = '<span class="ann-badge" style="background:#7c4dff;">' + self._escape(a.scope_label || '集团全员') + '</span>';
            var contentText = (a.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            var actions = '';
            if (isAuthor) {
                actions = '<span style="margin-left:auto;display:flex;gap:6px;">'
                    + '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();annApp.openEditor(' + a.id + ')"><i class="fas fa-edit"></i> 编辑</button>'
                    + (!a.is_published ? '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();annApp.publish(' + a.id + ')"><i class="fas fa-paper-plane"></i> 发布</button>' : '')
                    + '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();annApp.del(' + a.id + ')"><i class="fas fa-trash"></i></button>'
                    + '</span>';
            }
            var time = a.is_published ? (a.published_at || a.updated_at || '') : (a.updated_at || '');
            time = String(time).replace('T', ' ').slice(0, 16);
            return '<div class="ann-card" onclick="annApp.openDetail(' + a.id + ')">'
                + '<div class="ann-head">' + pub + scopeTag
                + '<div class="ann-title">' + self._escape(a.title) + '</div>'
                + actions + '</div>'
                + '<div class="ann-meta">'
                + '<span><img src="' + self._escape(a.author_avatar || '/static/images/default-avatar.png') + '" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:4px;">' + self._escape(a.author_name) + '</span>'
                + '<span><i class="fas fa-eye"></i> ' + (a.view_count || 0) + ' 浏览</span>'
                + '<span><i class="fas fa-clock"></i> ' + self._escape(time) + '</span>'
                + '<span><i class="fas fa-comment-dots"></i> ' + (a.comment_count || 0) + ' 条评论</span>'
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
    rte(cmd, val) {
        document.getElementById('rteEditor').focus();
        document.execCommand(cmd, false, val);
    }
    async rteInsertLink() {
        var url = await this.showInputDialog('插入链接', '请输入链接地址');
        if (url) this.rte('createLink', url.trim());
    }
    async rteInsertVideo() {
        var url = await this.showInputDialog('插入视频', '请输入视频地址（mp4/网页视频URL）');
        if (!url) return;
        var ed = document.getElementById('rteEditor');
        ed.focus();
        document.execCommand('insertHTML', false, '<video controls preload="metadata" style="max-width:100%;border-radius:6px;"><source src="' + this._escape(url.trim()) + '"></video><br>');
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
        document.getElementById('rteEditor').focus();
        document.execCommand('insertHTML', false, h);
    }
    async rteInsertFile() {
        var url = await this.showInputDialog('插入附件', '请输入附件链接地址');
        if (!url) return;
        var name = await this.showInputDialog('插入附件', '附件名称', url.split('/').pop() || '附件');
        document.getElementById('rteEditor').focus();
        document.execCommand('insertHTML', false, '<p><a href="' + this._escape(url.trim()) + '" target="_blank" style="color:#409eff;"><i class="fa fa-paperclip"></i> ' + this._escape(name) + '</a></p>');
    }
    rteInsertImage() {
        var self = this;
        var inp = document.getElementById('annImgInput');
        if (!inp) return;
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
            document.getElementById('rteEditor').focus();
            document.execCommand('insertHTML', false, '<img src="' + this._escape(url) + '" style="max-width:100%;border-radius:6px;"><br>');
        } catch (e) {
            var url2 = await this.showInputDialog('上传失败', '上传失败，可粘贴图片URL');
            if (url2) {
                document.getElementById('rteEditor').focus();
                document.execCommand('insertHTML', false, '<img src="' + this._escape(url2.trim()) + '" style="max-width:100%;border-radius:6px;"><br>');
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
            var actions = isAuthor
                ? '<span style="display:flex;gap:6px;">'
                    + '<button class="btn btn-sm btn-secondary" onclick="annApp.closeDetail();annApp.openEditor(' + a.id + ')"><i class="fas fa-edit"></i> 编辑</button>'
                    + (!a.is_published ? '<button class="btn btn-sm btn-primary" onclick="annApp.publish(' + a.id + ')"><i class="fas fa-paper-plane"></i> 发布</button>' : '')
                    + '<button class="btn btn-sm btn-danger" onclick="annApp.del(' + a.id + ')"><i class="fas fa-trash"></i> 删除</button>'
                    + '</span>'
                : '';
            var time = String(a.published_at || a.updated_at || '').replace('T', ' ').slice(0, 16);
            body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;justify-content: space-between;"><div style="display:flex;align-items:center;gap:6px;">' + pub + '<span class="ann-badge" style="background:#7c4dff;">' + this._escape(a.scope_label || '集团全员') + '</span></div>' + actions + '</div>'
                + '<div class="ann-detail-title">' + this._escape(a.title) + '</div>'
                + '<div class="ann-detail-meta">'
                + '<span><img src="' + this._escape(a.author_avatar || '/static/images/default-avatar.png') + '" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:4px;">' + this._escape(a.author_name) + '</span>'
                + '<span><i class="fas fa-eye"></i> ' + (a.view_count || 0) + ' 浏览</span>'
                + '<span><i class="fas fa-clock"></i> ' + this._escape(time) + '</span>'
                + '<span><i class="fas fa-comment-dots"></i> ' + (a.comment_count || 0) + ' 条评论</span>'
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
        // 一级评论 + 二级回复（按 parent 分组）
        var top = [], children = {};
        list.forEach(function (c) {
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

    _escape(text) {
        if (!text) return '';
        return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
