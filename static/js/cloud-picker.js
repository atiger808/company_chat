// static/js/cloud-picker.js - 通用「从我的网盘选择文件」弹窗（带文件夹导航/搜索/多选）
// 依赖：TokenManager（api.js）、Utils.escapeHtml（utils.js，可选）
// 用法：CloudFilePicker.open({title:'选择文件', onPick: function(list){ /* [{cloud_id,name,original_name,size,mime_type}] */ }});
(function () {
    'use strict';
    if (window.CloudFilePicker) return;
    var API = '/api/oa/approval/cloud-picker/';

    function esc(s) {
        if (window.Utils && Utils.escapeHtml) return Utils.escapeHtml(String(s == null ? '' : s));
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
    }
    function headers() {
        return window.TokenManager ? TokenManager.getHeaders() : {};
    }
    function fmtSize(item) {
        if (item && item.size_formatted) return item.size_formatted;
        if (item && item.size != null) {
            var n = Number(item.size);
            if (n < 1024) return n + ' B';
            if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
            if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
            return (n / 1073741824).toFixed(2) + ' GB';
        }
        return '';
    }

    var modal = null, listEl = null, pathEl = null, countEl = null, searchEl = null, backBtn = null;
    var st = {cb: null, folder: '', title: '', sel: {}, stack: []};

    function ensureDom() {
        if (modal) return;
        modal = document.createElement('div');
        modal.id = 'cloudPickModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:40000;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.5);overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch;';
        modal.innerHTML =
            '<div style="width:min(860px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.18);overflow:hidden;">'
            + '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #ebeef5;">'
            + '<span id="cpmTitle" style="font-size:15px;font-weight:700;color:#303133;"><i class="fas fa-cloud" style="color:#16a085;margin-right:6px;"></i></span>'
            + '<span style="flex:1;"></span>'
            + '<button type="button" id="cpmClose" style="border:none;background:none;font-size:20px;color:#909399;cursor:pointer;line-height:1;" title="关闭">&times;</button></div>'
            + '<div style="display:flex;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid #f0f0f0;flex-wrap:wrap;">'
            + '<button type="button" id="cpmBack" class="cpm-btn" style="display:none;border:1px solid #dcdfe6;background:#fff;color:#606266;border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;"><i class="fas fa-arrow-up"></i> 返回上级</button>'
            + '<span id="cpmPath" style="font-size:12px;color:#909399;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>'
            + '<span style="display:flex;align-items:center;gap:6px;background:#f5f7fa;border:1px solid #dcdfe6;border-radius:6px;padding:4px 8px;">'
            + '<i class="fas fa-search" style="color:#c0c4cc;font-size:12px;"></i>'
            + '<input type="text" id="cpmSearch" placeholder="搜索全部网盘文件..." style="border:none;outline:none;background:transparent;font-size:12px;width:170px;color:#303133;"></span></div>'
            + '<div id="cpmList" style="flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:6px 8px;background:#fafbfc;"></div>'
            + '<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid #ebeef5;">'
            + '<span id="cpmCount" style="font-size:12px;color:#909399;flex:1;">未选择文件</span>'
            + '<button type="button" id="cpmCancel" class="cpm-btn" style="border:1px solid #dcdfe6;background:#fff;color:#606266;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;">取消</button>'
            + '<button type="button" id="cpmOk" class="cpm-btn" style="border:none;background:#16a085;color:#fff;border-radius:6px;padding:6px 16px;font-size:13px;cursor:pointer;">确定</button></div></div>';
        document.body.appendChild(modal);
        document.getElementById('cpmClose').addEventListener('click', close);
        document.getElementById('cpmCancel').addEventListener('click', close);
        modal.addEventListener('mousedown', function (e) { if (e.target === modal) close(); });
        document.getElementById('cpmOk').addEventListener('click', function () {
            var picked = Object.keys(st.sel).map(function (id) { return st.sel[id]; });
            if (st.cb) { var cb = st.cb; st.cb = null; cb(picked); }
            close();
        });
        document.getElementById('cpmBack').addEventListener('click', function () { goUp(); });
        document.getElementById('cpmSearch').addEventListener('input', debounce(function () {
            // 搜索时后端忽略 folder、跨全部网盘文件匹配；清空后恢复当前目录浏览
            loadList(st.folder, this.value.trim());
        }, 300));
        listEl = document.getElementById('cpmList');
        pathEl = document.getElementById('cpmPath');
        countEl = document.getElementById('cpmCount');
        searchEl = document.getElementById('cpmSearch');
        backBtn = document.getElementById('cpmBack');
        listEl.addEventListener('click', function (e) {
            var row = e.target.closest ? e.target.closest('[data-fid]') : null;
            if (!row) return;
            var isF = row.getAttribute('data-is-folder') === '1';
            var id = row.getAttribute('data-fid');
            if (isF) { enterFolder(id, row.getAttribute('data-name') || ''); return; }
            toggle(id);
        });
    }

    function debounce(fn, ms) {
        var t = null;
        return function () {
            var self = this, args = arguments;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms);
        };
    }

    function toggle(id) {
        if (st.sel[id]) delete st.sel[id]; else if (st.selBox[id]) st.sel[id] = st.selBox[id];
        syncSel();
    }
    function syncSel() {
        var n = Object.keys(st.sel).length;
        countEl.textContent = n ? ('已选 ' + n + ' 个文件') : '未选择文件';
        if (listEl) {
            var boxes = listEl.querySelectorAll('.cpm-check');
            Array.prototype.forEach.call(boxes, function (b) {
                b.checked = !!st.sel[b.getAttribute('data-fid')];
            });
        }
    }
    function renderPath() {
        var parts = st.stack.map(function (f) { return f.name; });
        var cur = st.folder ? (st.stack.length ? st.stack[st.stack.length - 1].name : '…') : '全部文件';
        pathEl.textContent = cur ? (st.title + ' / ' + (parts.join(' / ') || '全部文件')) : st.title;
        backBtn.style.display = st.stack.length ? 'inline-block' : 'none';
    }
    function enterFolder(id, name) {
        st.stack.push({id: id, name: name});
        st.folder = id;
        if (searchEl) searchEl.value = '';
        renderPath();
        loadList(st.folder, '');
    }
    function goUp() {
        if (!st.stack.length) return;
        st.stack.pop();
        st.folder = st.stack.length ? st.stack[st.stack.length - 1].id : '';
        if (searchEl) searchEl.value = '';
        renderPath();
        loadList(st.folder, '');
    }
    // 按文件类型返回图标/配色：图片可直接用缩略图；其余用类型图标
    function fileIconInfo(it) {
        var name = String((it && (it.original_name || it.name)) || '');
        var mime = String((it && it.mime_type) || '').toLowerCase();
        var ext = name.lastIndexOf('.') > -1 ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : '';
        var isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].indexOf(ext) > -1 || mime.indexOf('image/') === 0;
        var isPdf = ext === 'pdf' || mime.indexOf('pdf') > -1;
        var isWord = ['doc', 'docx', 'rtf'].indexOf(ext) > -1 || mime.indexOf('word') > -1;
        var isExcel = ['xls', 'xlsx', 'csv', 'et'].indexOf(ext) > -1 || mime.indexOf('excel') > -1 || mime.indexOf('spreadsheet') > -1;
        var isPpt = ['ppt', 'pptx'].indexOf(ext) > -1 || mime.indexOf('presentation') > -1;
        var isVideo = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'webm', 'flv', 'm4v'].indexOf(ext) > -1 || mime.indexOf('video/') === 0;
        var isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'amr'].indexOf(ext) > -1 || mime.indexOf('audio/') === 0;
        var isZip = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].indexOf(ext) > -1 || mime.indexOf('zip') > -1 || mime.indexOf('compressed') > -1;
        var isText = ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml'].indexOf(ext) > -1 || mime.indexOf('text/') === 0;
        if (isImg) return {cls: 'fas fa-image', color: '#67c23a', img: true};
        if (isPdf) return {cls: 'fas fa-file-pdf', color: '#f56c6c'};
        if (isWord) return {cls: 'fas fa-file-word', color: '#409eff'};
        if (isExcel) return {cls: 'fas fa-file-excel', color: '#16a085'};
        if (isPpt) return {cls: 'fas fa-file-powerpoint', color: '#e6a23c'};
        if (isVideo) return {cls: 'fas fa-video', color: '#9b59b6'};
        if (isAudio) return {cls: 'fas fa-music', color: '#00a1ff'};
        if (isZip) return {cls: 'fas fa-file-archive', color: '#b7791f'};
        if (isText) return {cls: 'fas fa-file-alt', color: '#909399'};
        return {cls: 'fas fa-file', color: '#909399'};
    }

    function loadList(folder, kw) {
        if (!listEl) return;
        listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:#909399;font-size:13px;"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
        var url = API + '?folder=' + encodeURIComponent(folder || '') + '&page_size=200';
        if (kw) url += '&search=' + encodeURIComponent(kw);
        fetch(url, {headers: headers()})
            .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
            .then(function (d) {
                var items = (d && d.results) || [];
                st.selBox = {};
                items.forEach(function (it) {
                    if (!it.is_folder) st.selBox[it.id] = {cloud_id: it.id, name: it.name, original_name: it.original_name || it.name, size: it.size || 0, mime_type: it.mime_type || ''};
                });
                if (!items.length) {
                    listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:#909399;font-size:13px;">' + (kw ? '未找到匹配的文件' : '该位置暂无文件') + '</div>';
                    return;
                }
                var folders = items.filter(function (it) { return it.is_folder; });
                var files = items.filter(function (it) { return !it.is_folder; });
                var html = '';
                folders.forEach(function (f) {
                    html += '<div data-fid="' + esc(f.id) + '" data-is-folder="1" data-name="' + esc(f.name || '') + '" style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-radius:6px;" onmouseover="this.style.background=\'#f0f9f5\'" onmouseout="this.style.background=\'transparent\'">'
                        + '<i class="fas fa-folder" style="color:#e6a23c;font-size:18px;width:22px;text-align:center;"></i>'
                        + '<span style="flex:1;font-size:13px;color:#303133;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(f.name || '') + '</span>'
                        + '<span style="font-size:11px;color:#c0c4cc;">文件夹</span></div>';
                });
                files.forEach(function (it) {
                    var checked = !!st.sel[it.id];
                    var ic = fileIconInfo(it);
                    var left;
                    if (ic.img && it.file_url) {
                        left = '<img src="' + esc(it.file_url) + '" style="width:26px;height:26px;border-radius:4px;object-fit:cover;flex-shrink:0;" alt="">';
                    } else {
                        left = '<i class="' + ic.cls + '" style="color:' + ic.color + ';font-size:18px;width:22px;text-align:center;flex-shrink:0;"></i>';
                    }
                    html += '<div data-fid="' + esc(it.id) + '" data-is-folder="0" style="display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;border-radius:6px;" onmouseover="this.style.background=\'#f0f7ff\'" onmouseout="this.style.background=\'transparent\'">'
                        + '<input type="checkbox" class="cpm-check" data-fid="' + esc(it.id) + '" ' + (checked ? 'checked' : '') + ' style="width:15px;height:15px;cursor:pointer;flex-shrink:0;">'
                        + left
                        + '<span style="flex:1;font-size:13px;color:#303133;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(it.name || it.original_name) + '">' + esc(it.name || it.original_name) + '</span>'
                        + '<span style="font-size:11px;color:#909399;flex-shrink:0;">' + esc(fmtSize(it)) + '</span></div>';
                });
                listEl.innerHTML = html;
            })
            .catch(function () {
                listEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:#f56c6c;font-size:13px;">加载网盘文件失败，请重试</div>';
            });
    }
    function close() {
        if (!modal) return;
        modal.style.display = 'none';
        st.cb = null;
    }
    function open(opts) {
        ensureDom();
        opts = opts || {};
        st.title = opts.title || '从我的网盘选择文件';
        st.cb = opts.onPick || null;
        st.folder = '';
        st.stack = [];
        st.sel = {};
        document.getElementById('cpmTitle').innerHTML = '<i class="fas fa-cloud" style="color:#16a085;margin-right:6px;"></i>' + esc(st.title);
        if (searchEl) searchEl.value = '';
        modal.style.display = 'flex';
        renderPath();
        loadList('', '');
    }
    window.CloudFilePicker = {open: open};
})();
