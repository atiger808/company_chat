// static/js/workorder-ui.js - 群工单通用 UI 组件（成员搜索选择器 / 卡片基础工具）
(function () {
    'use strict';

    var activePicker = null;

    function esc(text) {
        if (text === undefined || text === null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function memberMeta(m) {
        m = m || {};
        var dept = (m.department_info && m.department_info.name) || '';
        var pos = m.position || '';
        if (!dept && m.org_departments && m.org_departments.length) {
            var primary = null;
            for (var i = 0; i < m.org_departments.length; i++) {
                if (m.org_departments[i].is_primary) { primary = m.org_departments[i]; break; }
            }
            primary = primary || m.org_departments[0];
            dept = primary.full_path || primary.name || '';
            if (!pos) pos = primary.position || '';
        }
        return {dept: dept, pos: pos};
    }

    function memberName(m) {
        return (m && (m.real_name || m.username)) || '';
    }

    function memberAvatar(m) {
        return (m && m.avatar_url) || '/static/images/default-avatar.png';
    }

    function memberHtml(m, compact) {
        if (!m) return '';
        var meta = memberMeta(m);
        var sub = [meta.dept, meta.pos].filter(Boolean).join(' · ');
        return '<span class="wo-member-inline">'
            + '<img class="wo-member-avatar" src="' + esc(memberAvatar(m)) + '" alt="">'
            + '<span class="wo-member-text">'
            + '<span class="wo-member-name">' + esc(memberName(m)) + '</span>'
            + (sub && !compact ? '<span class="wo-member-sub">' + esc(sub) + '</span>' : '')
            + '</span></span>';
    }

    function itemHtml(m, selected) {
        var meta = memberMeta(m);
        var sub = [meta.dept, meta.pos].filter(Boolean).join(' · ');
        var search = [m.real_name, m.username, meta.dept, meta.pos].filter(Boolean).join(' ').toLowerCase();
        return '<div class="wo-member-item' + (selected ? ' selected' : '') + '" '
            + 'data-id="' + m.id + '" data-search="' + esc(search) + '" role="option">'
            + '<img class="wo-member-avatar" src="' + esc(memberAvatar(m)) + '" alt="">'
            + '<span class="wo-member-item-main">'
            + '<span class="wo-member-item-name">' + esc(memberName(m))
            + '<span class="wo-member-account">@' + esc(m.username || '') + '</span></span>'
            + (sub ? '<span class="wo-member-item-sub">' + esc(sub) + '</span>' : '')
            + '</span>'
            + '<i class="fas fa-check wo-member-check"></i>'
            + '</div>';
    }

    function positionPanel(panel, trigger) {
        var r = trigger.getBoundingClientRect();
        var width = Math.max(300, Math.min(r.width, window.innerWidth - 16));
        var left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
        panel.style.position = 'fixed';
        panel.style.left = left + 'px';
        panel.style.width = width + 'px';
        panel.style.maxHeight = '340px';
        // 先显示再量高度，避免下方空间不足时被裁掉
        panel.style.top = (r.bottom + 6) + 'px';
        panel.style.visibility = 'hidden';
        panel.classList.add('show');
        var h = panel.offsetHeight || 300;
        if (r.bottom + h + 10 > window.innerHeight && r.top > h + 10) {
            panel.style.top = (r.top - h - 6) + 'px';
        }
        panel.style.visibility = '';
    }

    function createPicker(container, members, opts) {
        opts = opts || {};
        members = members || [];
        var currentId = opts.value != null ? String(opts.value) : '';
        var panel = document.createElement('div');
        panel.className = 'wo-picker-panel';
        document.body.appendChild(panel);

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'wo-picker-trigger';
        trigger.title = opts.placeholder || '选择成员';
        container.classList.add('wo-picker');
        container.appendChild(trigger);

        var searchEl = null;

        function findMember(id) {
            id = id == null ? '' : String(id);
            for (var i = 0; i < members.length; i++) {
                if (String(members[i].id) === id) return members[i];
            }
            return null;
        }

        function renderTrigger() {
            var m = findMember(currentId);
            if (m) {
                var meta = memberMeta(m);
                var sub = [meta.dept, meta.pos].filter(Boolean).join(' · ');
                trigger.innerHTML = '<img class="wo-member-avatar" src="' + esc(memberAvatar(m)) + '" alt="">'
                    + '<span class="wo-picker-trigger-text">'
                    + '<span class="wo-member-name">' + esc(memberName(m)) + '</span>'
                    + (sub ? '<span class="wo-member-sub">' + esc(sub) + '</span>' : '')
                    + '</span><i class="fas fa-chevron-down wo-picker-arrow"></i>';
                trigger.classList.add('has-value');
            } else {
                trigger.innerHTML = '<span class="wo-picker-placeholder"><i class="fas fa-user-plus"></i> '
                    + esc(opts.placeholder || '选择成员') + '</span><i class="fas fa-chevron-down wo-picker-arrow"></i>';
                trigger.classList.remove('has-value');
            }
        }

        function renderPanel(filter) {
            filter = (filter || '').trim().toLowerCase();
            var html = '<div class="wo-picker-search"><i class="fas fa-search"></i>'
                + '<input type="text" placeholder="搜索姓名 / 账号 / 部门 / 职位" autocomplete="off"></div>'
                + '<div class="wo-picker-list">';
            var shown = 0;
            members.forEach(function (m) {
                var meta = memberMeta(m);
                var hay = [m.real_name, m.username, meta.dept, meta.pos].filter(Boolean).join(' ').toLowerCase();
                if (filter && hay.indexOf(filter) === -1) return;
                shown++;
                html += itemHtml(m, String(m.id) === String(currentId));
            });
            if (!shown) html += '<div class="wo-picker-empty">未找到匹配成员</div>';
            html += '</div>';
            panel.innerHTML = html;
            searchEl = panel.querySelector('input');
            searchEl.value = filter;
            searchEl.addEventListener('input', function () {
                var v = searchEl.value;
                renderPanel(v);
                var el = panel.querySelector('input');
                if (el) {
                    try { el.focus({preventScroll: true}); } catch (e) { el.focus(); }
                    el.setSelectionRange(el.value.length, el.value.length);
                }
            });
            panel.querySelectorAll('.wo-member-item').forEach(function (item) {
                item.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    var id = item.getAttribute('data-id');
                    currentId = id;
                    renderTrigger();
                    close();
                    if (typeof opts.onChange === 'function') opts.onChange(id ? parseInt(id, 10) : null, findMember(id));
                });
            });
        }

        function onDocClick(e) {
            if (!panel.classList.contains('show')) return;
            if (panel.contains(e.target) || trigger.contains(e.target)) return;
            close();
        }

        function onScroll() { if (panel.classList.contains('show')) close(); }

        function onKey(e) {
            if (e.key === 'Escape' && panel.classList.contains('show')) {
                e.stopPropagation();
                close();
            }
        }

        function open() {
            if (activePicker && activePicker !== api) activePicker.close();
            activePicker = api;
            renderPanel('');
            positionPanel(panel, trigger);
            if (searchEl) {
                try { searchEl.focus({preventScroll: true}); } catch (e) { searchEl.focus(); }
            }
        }

        function close() {
            panel.classList.remove('show');
            if (activePicker === api) activePicker = null;
        }

        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            if (panel.classList.contains('show')) close(); else open();
        });
        document.addEventListener('click', onDocClick);
        window.addEventListener('resize', onScroll);
        window.addEventListener('scroll', onScroll, true);
        document.addEventListener('keydown', onKey);

        var api = {
            getValue: function () { return currentId ? parseInt(currentId, 10) : null; },
            getMember: function () { return findMember(currentId); },
            setValue: function (id) {
                currentId = id == null ? '' : String(id);
                renderTrigger();
            },
            setMembers: function (list) {
                members = list || [];
                if (!findMember(currentId)) currentId = '';
                renderTrigger();
                if (panel.classList.contains('show')) renderPanel('');
            },
            close: close,
            destroy: function () {
                close();
                document.removeEventListener('click', onDocClick);
                window.removeEventListener('resize', onScroll);
                window.removeEventListener('scroll', onScroll, true);
                document.removeEventListener('keydown', onKey);
                if (panel.parentNode) panel.parentNode.removeChild(panel);
                if (container.parentNode) container.innerHTML = '';
            }
        };
        renderTrigger();
        container._woPicker = api;
        return api;
    }

    // ==================== 附件：图片预览 / 视频播放 / 保存网盘 / 在线编辑 ====================
    var DOC_EXTS = {doc: 1, docx: 1, xls: 1, xlsx: 1, csv: 1, ppt: 1, pptx: 1, pdf: 1, txt: 1};
    var IMG_EXTS = {jpg: 1, jpeg: 1, png: 1, gif: 1, webp: 1, bmp: 1, svg: 1};
    var VIDEO_EXTS = {mp4: 1, webm: 1, mov: 1, avi: 1, mkv: 1, m4v: 1};
    var attRegistry = {};
    var savedCloud = {};
    try { savedCloud = JSON.parse(localStorage.getItem('wo_att_cloud_map') || '{}') || {}; } catch (e) { savedCloud = {}; }
    var imageGroups = {};
    var imageGroupSeq = 0;
    var previewCleanup = null;

    function attMime(att) {
        return String((att && (att.mime || att.mime_type)) || '').toLowerCase();
    }

    function attName(att) {
        return (att && (att.name || att.filename)) || '附件';
    }

    function attUrl(att) {
        return (att && (att.url || att.file_url)) || '';
    }

    function attExt(att) {
        var name = attName(att);
        var i = name.lastIndexOf('.');
        return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
    }

    function isImage(att) {
        var m = attMime(att);
        return m.indexOf('image/') === 0 || IMG_EXTS[attExt(att)] === 1;
    }

    function isVideo(att) {
        var m = attMime(att);
        return m.indexOf('video/') === 0 || VIDEO_EXTS[attExt(att)] === 1;
    }

    function isDocument(att) {
        var m = attMime(att);
        if (m.indexOf('word') >= 0 || m.indexOf('excel') >= 0 || m.indexOf('spreadsheet') >= 0
            || m.indexOf('powerpoint') >= 0 || m.indexOf('presentation') >= 0 || m === 'application/pdf'
            || m === 'text/plain' || m === 'text/csv') {
            return true;
        }
        return DOC_EXTS[attExt(att)] === 1;
    }

    function attIcon(att) {
        var ext = attExt(att);
        if (ext === 'pdf') return 'fas fa-file-pdf';
        if (ext === 'doc' || ext === 'docx') return 'fas fa-file-word';
        if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'fas fa-file-excel';
        if (ext === 'ppt' || ext === 'pptx') return 'fas fa-file-powerpoint';
        if (ext === 'zip' || ext === 'rar' || ext === '7z') return 'fas fa-file-archive';
        if (ext === 'txt' || ext === 'md') return 'fas fa-file-alt';
        return 'fas fa-file';
    }

    function attKey(att) {
        if (att && att.file_id) return 'f_' + att.file_id;
        return 'u_' + encodeURIComponent(attUrl(att)).slice(0, 180);
    }

    function fmtSize(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function notify(msg, isError) {
        if (window.chatClient && typeof window.chatClient.showToast === 'function') {
            window.chatClient.showToast(msg, isError ? 'error' : 'success');
        } else if (window.taskApp && typeof window.taskApp.showToast === 'function') {
            window.taskApp.showToast(msg, isError ? 'error' : 'success');
        } else {
            alert(msg);
        }
    }

    function parseJson(resp) {
        return resp.json().catch(function () { return {}; });
    }

    function errorText(data) {
        if (!data) return '操作失败';
        if (typeof data === 'string') return data;
        return data.error || data.detail || data.message || '操作失败';
    }

    function persistSaved() {
        try {
            var keys = Object.keys(savedCloud);
            if (keys.length > 300) {
                var trimmed = {};
                keys.slice(-300).forEach(function (k) { trimmed[k] = savedCloud[k]; });
                savedCloud = trimmed;
            }
            localStorage.setItem('wo_att_cloud_map', JSON.stringify(savedCloud));
        } catch (e) { /* ignore */ }
    }

    function setSavedUi(key, cloudId, att) {
        savedCloud[key] = cloudId;
        persistSaved();
        if (att) att.cloud_file_id = cloudId;
        document.querySelectorAll('[data-wo-att-key="' + key + '"]').forEach(function (card) {
            var saveBtn = card.querySelector('.wo-att-save-btn');
            var editBtn = card.querySelector('.wo-att-edit-btn');
            if (isDocument(att) && cloudId) {
                if (saveBtn) saveBtn.style.display = 'none';
                if (editBtn) {
                    editBtn.style.display = '';
                    editBtn.setAttribute('data-cloud-id', cloudId);
                }
            } else if (saveBtn) {
                saveBtn.textContent = '已保存';
                saveBtn.disabled = true;
                saveBtn.classList.add('saved');
            }
            card.classList.add('is-saved');
        });
    }

    async function saveAttachment(key, btn) {
        var att = attRegistry[key];
        if (!att) return;
        if (savedCloud[key] || att.cloud_file_id) {
            if (isDocument(att)) {
                editSaved(key);
            } else {
                notify('该附件已保存到网盘', false);
            }
            return;
        }
        var path = att.file_id ? '/api/cloud/files/save_from_chat/' : '/api/cloud/files/save_from_url/';
        var folderName = att.folder_name || '文档（来自群工单）';
        var body = att.file_id
            ? {file_upload_id: att.file_id, folder_name: folderName}
            : {url: attUrl(att), name: attName(att), folder_name: folderName};
        if (!att.file_id && !attUrl(att)) {
            notify('附件地址缺失，无法保存', true);
            return;
        }
        var oldText = '';
        if (btn && btn.tagName === 'BUTTON') {
            oldText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '保存中...';
        }
        try {
            var resp = await fetch(path, {
                method: 'POST',
                headers: Object.assign({}, TokenManager.getHeaders(), {'Content-Type': 'application/json'}),
                body: JSON.stringify(body)
            });
            var data = await parseJson(resp);
            if (!resp.ok) throw new Error(errorText(data));
            var cloudId = data.cloud_file_id || data.file_id || data.id;
            if (!cloudId) throw new Error('保存成功但未返回云盘文件 ID');
            setSavedUi(key, cloudId, att);
            notify(isDocument(att) ? '已保存到网盘，可点击「在线编辑」打开' : '已保存到网盘 / ' + folderName, false);
        } catch (e) {
            notify(e.message || '保存到网盘失败', true);
            if (btn && btn.tagName === 'BUTTON') {
                btn.disabled = false;
                btn.textContent = oldText || '保存到网盘';
            }
        }
    }

    function editSaved(key) {
        var cloudId = savedCloud[key] || (attRegistry[key] && attRegistry[key].cloud_file_id);
        if (!cloudId) {
            notify('未找到云盘文件，请先保存到网盘', true);
            return;
        }
        window.open('/cloud/editor/?id=' + encodeURIComponent(cloudId), '_blank');
    }

    function attachmentsHtml(list, opts) {
        opts = opts || {};
        list = (list || []).filter(function (a) { return a && (attUrl(a) || a.file_id); });
        if (!list.length) return '';
        var gid = 'woimg_' + (++imageGroupSeq);
        var images = [];
        var html = '<div class="wo-attachments' + (opts.compact ? ' compact' : '') + '">';
        list.forEach(function (att) {
            var url = attUrl(att);
            var name = attName(att);
            var downloadLink = url
                ? '<a class="wo-att-download" href="' + esc(url) + '" download title="下载到本地" onclick="event.stopPropagation()"><i class="fas fa-download"></i></a>'
                : '';
            if (isImage(att) && url) {
                var imgIndex = images.length;
                images.push(url);
                html += '<div class="wo-att-image-wrap">'
                    + '<img class="wo-att-image" src="' + esc(url) + '" alt="' + esc(name)
                    + '" loading="lazy" onclick="event.stopPropagation();WorkOrderUI.previewGroup(\'' + gid + '\',' + imgIndex + ')">'
                    + downloadLink + '</div>';
                return;
            }
            if (isVideo(att) && url) {
                html += '<div class="wo-att-video-wrap"><video class="wo-att-video" controls preload="metadata" playsinline src="'
                    + esc(url) + '"></video>' + downloadLink + '</div>';
                return;
            }
            var key = attKey(att);
            attRegistry[key] = att;
            var savedId = savedCloud[key] || att.cloud_file_id;
            var doc = isDocument(att);
            var editDisplay = (savedId && doc) ? '' : 'display:none;';
            var saveDisplay = (savedId && doc) ? 'display:none;' : '';
            var saveText = savedId && !doc ? '已保存' : '保存到网盘';
            html += '<div class="wo-att-file' + (savedId ? ' is-saved' : '') + '" data-wo-att-key="' + esc(key)
                + '" title="点击保存到网盘" onclick="WorkOrderUI.saveAttachment(\'' + key + '\',this)">'
                + '<i class="' + attIcon(att) + ' wo-att-file-icon"></i>'
                + '<div class="wo-att-file-main"><div class="wo-att-file-name">' + esc(name) + '</div>'
                + '<div class="wo-att-file-sub">' + fmtSize(att.size) + (doc ? ' · 文档' : ' · 文件') + '</div></div>'
                + '<div class="wo-att-file-actions">'
                + downloadLink
                + '<button type="button" class="wo-att-save-btn" style="' + saveDisplay + '"'
                + (savedId && !doc ? ' disabled' : '')
                + ' onclick="event.stopPropagation();WorkOrderUI.saveAttachment(\'' + key + '\',this)">' + saveText + '</button>'
                + '<button type="button" class="wo-att-edit-btn" style="' + editDisplay + '" data-cloud-id="' + esc(savedId || '')
                + '" onclick="event.stopPropagation();WorkOrderUI.editSaved(\'' + key + '\')">在线编辑</button>'
                + '</div></div>';
        });
        html += '</div>';
        if (images.length) imageGroups[gid] = images;
        return html;
    }

    function previewGroup(gid, index) {
        previewImages(imageGroups[gid] || [], index || 0);
    }

    function previewImages(list, index) {
        if (!list || !list.length) return;
        if (previewCleanup) { try { previewCleanup(); } catch (e) {} previewCleanup = null; }
        var old = document.getElementById('woImagePreview');
        if (old) old.remove();
        var idx = Math.max(0, Math.min(index || 0, list.length - 1));
        var overlay = document.createElement('div');
        overlay.id = 'woImagePreview';
        overlay.className = 'wo-image-preview';
        overlay.innerHTML = '<button type="button" class="wo-ip-close" title="关闭"><i class="fas fa-times"></i></button>'
            + (list.length > 1 ? '<button type="button" class="wo-ip-nav prev" title="上一张"><i class="fas fa-chevron-left"></i></button>' : '')
            + (list.length > 1 ? '<button type="button" class="wo-ip-nav next" title="下一张"><i class="fas fa-chevron-right"></i></button>' : '')
            + '<img class="wo-ip-img" src="' + esc(list[idx]) + '" alt="预览">'
            + (list.length > 1 ? '<div class="wo-ip-counter">' + (idx + 1) + ' / ' + list.length + '</div>' : '');
        document.body.appendChild(overlay);
        var img = overlay.querySelector('.wo-ip-img');
        var counter = overlay.querySelector('.wo-ip-counter');
        function render() {
            if (img) {
                img.src = list[idx];
                if (window.Utils && Utils.resetImageZoom) Utils.resetImageZoom(img);
            }
            if (counter) counter.textContent = (idx + 1) + ' / ' + list.length;
        }
        function close() {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            if (previewCleanup === close) previewCleanup = null;
        }
        previewCleanup = close;
        function nav(dir) {
            if (list.length <= 1) return;
            idx = (idx + dir + list.length) % list.length;
            render();
        }
        function onKey(e) {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowLeft') nav(-1);
            else if (e.key === 'ArrowRight') nav(1);
        }
        overlay.querySelector('.wo-ip-close').onclick = close;
        var prev = overlay.querySelector('.wo-ip-nav.prev');
        var next = overlay.querySelector('.wo-ip-nav.next');
        if (prev) prev.onclick = function (e) { e.stopPropagation(); nav(-1); };
        if (next) next.onclick = function (e) { e.stopPropagation(); nav(1); };
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        if (img) {
            if (window.Utils && Utils.enableImagePinchZoom) Utils.enableImagePinchZoom(img);
            img.addEventListener('click', function (e) {
                e.stopPropagation();
                if (img._pz && img._pz.scale > 1.01) return;
                close();
            });
        }
        var touchX = null, touchY = null;
        overlay.addEventListener('touchstart', function (e) {
            if (e.touches.length === 1) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }
        }, {passive: true});
        overlay.addEventListener('touchend', function (e) {
            if (touchX === null || !e.changedTouches || !e.changedTouches.length) return;
            var dx = e.changedTouches[0].clientX - touchX;
            var dy = e.changedTouches[0].clientY - touchY;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) nav(dx < 0 ? 1 : -1);
            touchX = null;
        }, {passive: true});
        document.addEventListener('keydown', onKey);
    }

    var statusColorMap = {
        pending: '#909399', processing: '#409eff', pending_verify: '#e6a23c',
        done: '#67c23a', cancelled: '#c0c4cc'
    };
    var urgencyColorMap = {low: '#909399', medium: '#409eff', high: '#e6a23c', urgent: '#f56c6c'};

    window.WorkOrderUI = {
        escapeHtml: esc,
        memberMeta: memberMeta,
        memberName: memberName,
        memberAvatar: memberAvatar,
        memberHtml: memberHtml,
        createPicker: createPicker,
        attachmentsHtml: attachmentsHtml,
        saveAttachment: saveAttachment,
        editSaved: editSaved,
        previewGroup: previewGroup,
        previewImages: previewImages,
        isImage: isImage,
        isVideo: isVideo,
        isDocument: isDocument,
        statusColor: function (s) { return statusColorMap[s] || '#909399'; },
        urgencyColor: function (u) { return urgencyColorMap[u] || '#909399'; },
        fmtTime: function (value, withTime) {
            if (!value) return '';
            var d = new Date(value);
            if (isNaN(d.getTime())) return '';
            var pad = function (n) { return String(n).padStart(2, '0'); };
            var out = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
            if (withTime !== false) out += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
            return out;
        },
        actionLabel: function (type) {
            return {
                comment: '评论', progress: '进度更新', start: '开始处理', submit: '提交环节',
                verify: '核验通过', reject: '驳回退回', return: '退回处理', system: '系统记录', ding: 'DING 催办'
            }[type] || type;
        }
    };
})();
