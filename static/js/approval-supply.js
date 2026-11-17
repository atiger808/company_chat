// static/js/approval-supply.js - 物资物品库、出入库与领用管理
// 说明：本文件为 ApprovalApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ApprovalApp.prototype, {

    // ==================== 物资物品库管理 ====================
    // 物品库/物资管理里的管理动作对普通员工隐藏（后端仍会二次校验 _admin）
    _applyMaterialRoleVisibility() {
        var isAdmin = this._isAdminFromStorage();
        document.querySelectorAll('.admin-only-mat').forEach(function (el) { el.style.display = isAdmin ? '' : 'none'; });
        document.querySelectorAll('.non-admin-tip').forEach(function (el) { el.style.display = isAdmin ? 'none' : 'block'; });
    },
    openMaterialItemsModal() {
        document.getElementById('materialItemsModal').style.display = 'flex';
        setTimeout(function () { document.getElementById('materialItemsModal').classList.add('show'); }, 10);
        this._defaultMaximize('materialItemsModal');
        this._applyMaterialRoleVisibility();
        this._materialItemPage = 1;
        this._loadMaterialItems(1);
    },
    closeMaterialItemsModal() {
        var m = document.getElementById('materialItemsModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    },
    async _loadMaterialItems(page) {
        var tbody = document.getElementById('materialItemTableBody');
        if (!tbody) return;
        page = page || 1;
        this._materialItemPage = page;
        var kw = document.getElementById('materialItemSearch') ? document.getElementById('materialItemSearch').value.trim() : '';
        try {
            var url = OA_API_URL + '/material/items/?page=' + page + '&page_size=10';
            if (kw) url += '&search=' + encodeURIComponent(kw);
            var r = await fetch(url, {headers: TokenManager.getHeaders()});
            if (!r.ok) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; return; }
            var d = await r.json();
            var items = d.results || [];
            if (!items.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">' + (kw ? '未找到匹配物品' : '暂无物品，点击「新增物品」添加') + '</td></tr>'; this._renderMaterialItemPagination(d); return; }
            tbody.innerHTML = items.map(function (it) {
                var stock = (it.stock != null) ? Number(it.stock) : null;
                var stockHtml = stock === null ? '-'
                    : '<span style="color:' + (stock > 0 ? '#67c23a' : (stock === 0 ? '#909399' : '#f56c6c')) + ';font-weight:600;">' + (Math.round(stock * 100) / 100) + ' ' + approvalApp._escape(it.unit || '') + '</span>';
                // 普通员工只看物资与库存（只读），管理动作仅管理员可见
                var actions = '<button class="action-btn" title="出入库流水" onclick="approvalApp._openItemLedger(' + it.id + ')"><i class="fas fa-history" style="color:#16a085;"></i></button>';
                if (approvalApp._isAdminFromStorage()) {
                    actions += '<button class="action-btn" title="库存调整" onclick="approvalApp._openItemAdjust(' + it.id + ')"><i class="fas fa-balance-scale" style="color:#e6a23c;"></i></button>'
                        + '<button class="action-btn" onclick="approvalApp._editMaterialItem(' + it.id + ')" title="编辑"><i class="fas fa-edit"></i></button>'
                        + '<button class="action-btn" style="color:#f56c6c;" onclick="approvalApp._deleteMaterialItem(' + it.id + ')" title="删除"><i class="fas fa-trash"></i></button>';
                }
                return '<tr>'
                    + '<td>' + approvalApp._escape(it.name) + '</td>'
                    + '<td>' + approvalApp._escape(it.spec || '-') + '</td>'
                    + '<td>' + approvalApp._escape(it.unit || '-') + '</td>'
                    + '<td>' + approvalApp._escape(it.category || '-') + '</td>'
                    + '<td>' + approvalApp._escape(it.price || '-') + '</td>'
                    + '<td>' + stockHtml + '</td>'
                    + '<td style="display:flex;gap:4px;">' + actions + '</td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialItemPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    },
    _renderMaterialItemPagination(d) {
        var el = document.getElementById('materialItemPagination');
        if (!el) return;
        var p = (d && d.page) || 1, t = (d && d.total_pages) || 1;
        if (t <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = 'flex';
        el.innerHTML = '<span style="margin-right:10px;color:#909399;font-size:12px;">共 ' + (d.count || 0) + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<button class="pagination-btn" onclick="approvalApp._loadMaterialItems(' + (p - 1) + ')"' + (p <= 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i> 上一页</button>'
            + '<button class="pagination-btn" onclick="approvalApp._loadMaterialItems(' + (p + 1) + ')"' + (p >= t ? ' disabled' : '') + '>下一页 <i class="fas fa-chevron-right"></i></button>';
    },
    _openMaterialItemForm() {
        this._editingMaterialItem = null;
        ['miName', 'miSpec', 'miUnit', 'miCategory', 'miPrice'].forEach(function (id) { document.getElementById(id).value = ''; });
        document.getElementById('materialItemForm').style.display = 'block';
    },
    _editMaterialItem(id) {
        var self = this;
        fetch(OA_API_URL + '/material/items/' + id + '/', {headers: TokenManager.getHeaders()}).then(function (r) { return r.ok ? r.json() : null; }).then(function (it) {
            if (!it) return;
            self._editingMaterialItem = id;
            document.getElementById('miName').value = it.name || '';
            document.getElementById('miSpec').value = it.spec || '';
            document.getElementById('miUnit').value = it.unit || '';
            document.getElementById('miCategory').value = it.category || '';
            document.getElementById('miPrice').value = it.price || '';
            document.getElementById('materialItemForm').style.display = 'block';
        });
    },
    _cancelMaterialItemForm() {
        document.getElementById('materialItemForm').style.display = 'none';
        this._editingMaterialItem = null;
    },
    async _saveMaterialItem() {
        var name = document.getElementById('miName').value.trim();
        if (!name) { this.showToast('物品名称不能为空', true); return; }
        var payload = {
            name: name,
            spec: document.getElementById('miSpec').value.trim(),
            unit: document.getElementById('miUnit').value.trim(),
            category: document.getElementById('miCategory').value.trim(),
            price: document.getElementById('miPrice').value
        };
        try {
            var url = OA_API_URL + '/material/items/';
            var opts = {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify(payload)};
            if (this._editingMaterialItem) {
                url = OA_API_URL + '/material/items/' + this._editingMaterialItem + '/';
                opts = {method: 'PUT', headers: TokenManager.getHeaders(), body: JSON.stringify(payload)};
            }
            var r = await fetch(url, opts);
            if (!r.ok) { var e2 = await r.json().catch(function () { return {}; }); throw new Error(e2.error || '保存失败'); }
            this.showToast('保存成功', false);
            this._cancelMaterialItemForm();
            this._loadMaterialItems();
        } catch (e) { this.showToast(e.message || '保存失败', true); }
    },
    async _deleteMaterialItem(id) {
        var ok = await this.showConfirmDialog('删除物品', '确定删除该物品吗？', 'danger');
        if (!ok) return;
        try {
            var r = await fetch(OA_API_URL + '/material/items/' + id + '/', {method: 'DELETE', headers: TokenManager.getHeaders()});
            if (!r.ok) throw new Error('删除失败');
            this.showToast('已删除', false);
            this._loadMaterialItems();
        } catch (e) { this.showToast(e.message || '删除失败', true); }
    },

    // ===== 物品出入库流水 / 库存调整 / 重建流水 =====
    async _openItemLedger(id) {
        try {
            var d = await this.apiGet(OA_API_URL + '/material/ledger/?item_id=' + id);
            if (!d) return;
            var it = d.item || {};
            document.getElementById('matLedgerHeader').innerHTML =
                '<img src="/static/images/default-avatar.png" style="display:none;">'
                + '<span style="font-weight:600;color:#303133;">' + this._escape(it.name || ('#' + id)) + '</span>'
                + (it.spec ? '<span style="color:#909399;">' + this._escape(it.spec) + '</span>' : '')
                + '<span>现有库存：<b style="color:' + (d.balance > 0 ? '#67c23a' : (d.balance === 0 ? '#909399' : '#f56c6c')) + ';">' + d.balance + ' ' + this._escape(it.unit || '') + '</b></span>';
            var tbody = document.getElementById('matLedgerTbody');
            var rows = d.rows || [];
            if (!rows.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:26px;color:#909399;">暂无流水（可通过库存调整/入库/领用产生）</td></tr>'; }
            else {
                tbody.innerHTML = rows.map(function (lg) {
                    var color = lg.delta > 0 ? '#67c23a' : (lg.delta < 0 ? '#f56c6c' : '#909399');
                    var sign = lg.delta > 0 ? '+' : '';
                    return '<tr>'
                        + '<td>' + approvalApp._escape(lg.created_at || '') + '</td>'
                        + '<td>' + approvalApp._escape(lg.ref_label || lg.ref_type || '') + '</td>'
                        + '<td style="color:' + color + ';font-weight:600;">' + sign + lg.delta + '</td>'
                        + '<td>' + approvalApp._escape(lg.doc_no || '-') + '</td>'
                        + '<td>' + approvalApp._escape(lg.operator || '-') + '</td>'
                        + '<td>' + approvalApp._escape(lg.note || '') + '</td></tr>';
                }).join('');
            }
            document.getElementById('materialLedgerModal').style.display = 'flex';
            setTimeout(function () { document.getElementById('materialLedgerModal').classList.add('show'); }, 10);
        } catch (e) { this.showToast('加载流水失败', true); }
    },
    _closeMaterialLedgerModal() {
        var m = document.getElementById('materialLedgerModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    },
    async _openItemAdjust(id) {
        this._matAdjustItemId = id;
        document.getElementById('matAdjustIo').value = 'in';
        document.getElementById('matAdjustQty').value = '';
        document.getElementById('matAdjustNote').value = '';
        try {
            var r = await fetch(OA_API_URL + '/material/items/' + id + '/', {headers: TokenManager.getHeaders()});
            if (r.ok) {
                var it = await r.json();
                document.getElementById('matAdjustItemInfo').innerHTML = '物品：<b>' + this._escape(it.name || '') + '</b>'
                    + (it.spec ? ' <span style="color:#909399;">' + this._escape(it.spec) + '</span>' : '')
                    + '（单位 ' + this._escape(it.unit || '-') + '）';
            }
        } catch (err) { /* ignore */ }
        document.getElementById('materialItemAdjustModal').style.display = 'flex';
        setTimeout(function () { document.getElementById('materialItemAdjustModal').classList.add('show'); }, 10);
    },
    _closeMaterialItemAdjustModal() {
        var m = document.getElementById('materialItemAdjustModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    },
    async _saveMaterialItemAdjust() {
        var qty = parseFloat(document.getElementById('matAdjustQty').value);
        if (!(qty > 0)) { this.showToast('请输入大于 0 的调整数量', true); return; }
        var payload = {
            item_id: this._matAdjustItemId,
            io: document.getElementById('matAdjustIo').value,
            quantity: qty,
            note: (document.getElementById('matAdjustNote').value || '').trim()
        };
        try {
            var r = await fetch(OA_API_URL + '/material/item-adjust/', {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify(payload)});
            if (!r.ok) { var e2 = await r.json().catch(function () { return {}; }); throw new Error(this._extractApiError(e2)); }
            this._closeMaterialItemAdjustModal();
            this.showToast('库存已调整', false);
            this._loadMaterialItems();
        } catch (e) { this.showToast(e.message || '调整失败', true); }
    },
    async _rebuildLedger() {
        var ok = await this.showConfirmDialog('重建库存流水', '将清空本企业库存流水，并用历史「已入库需求单(+)」与「已通过领用单(−)」重建。确认执行？', 'danger');
        if (!ok) return;
        try {
            var r = await fetch(OA_API_URL + '/material/ledger-rebuild/', {method: 'POST', headers: TokenManager.getHeaders(), body: JSON.stringify({})});
            if (!r.ok) { var e2 = await r.json().catch(function () { return {}; }); throw new Error(this._extractApiError(e2)); }
            var raw = await r.json();
            var dd = raw.encrypt && window.EncryptUtils ? window.EncryptUtils.decryptPacket(raw) : raw;
            this.showToast((dd && dd.message) || '已重建', false);
            this._loadMaterialItems();
        } catch (e) { this.showToast(e.message || '重建失败', true); }
    },

    // ==================== 物资管理（需求单/领用单） ====================
    openMaterialMgmtModal() {
        document.getElementById('materialMgmtModal').style.display = 'flex';
        setTimeout(function () { document.getElementById('materialMgmtModal').classList.add('show'); }, 10);
        this._defaultMaximize('materialMgmtModal');
        this._applyMaterialRoleVisibility();
        // 普通员工没有需求单/入库单的管理权限，默认落到「可领用物资」，直接解决「我要领XX怎么领」
        this._matTab = this._isAdminFromStorage() ? 'req' : 'avail';
        this._matPage = 1;
        var ms = document.getElementById('matSearch');
        if (ms) ms.value = '';
        this._switchMaterialTab(this._matTab);
    },
    closeMaterialMgmtModal() {
        var m = document.getElementById('materialMgmtModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    },
    _defaultMaximize(modalId) {
        var modal = document.getElementById(modalId);
        if (!modal) return;
        var content = modal.querySelector('.modal-content');
        if (content && !content.classList.contains('maximized')) {
            content.classList.add('maximized');
            var btn = modal.querySelector('.maximize-btn i');
            if (btn) btn.className = 'fas fa-compress';
        }
    },
    _loadCurrentMatTab(page) {
        page = page || 1;
        if (this._matTab === 'avail') return this._loadAvailabilities(page, 'tab');
        if (this._matTab === 'req') return this._loadMaterialRequirements(page);
        if (this._matTab === 'reqsn') return this._loadMaterialRequisitions(page);
        return this._loadMaterialStockIns(page);
    },
    _switchMaterialTab(tab) {
        this._matTab = tab;
        this._matPage = 1;
        document.querySelectorAll('.mat-tab-btn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === tab); });
        document.getElementById('matReqPanel').style.display = tab === 'req' ? 'block' : 'none';
        document.getElementById('matReqsnPanel').style.display = tab === 'reqsn' ? 'block' : 'none';
        document.getElementById('matStockInPanel').style.display = tab === 'stockin' ? 'block' : 'none';
        var av = document.getElementById('matAvailPanel');
        if (av) av.style.display = tab === 'avail' ? 'block' : 'none';
        this._loadCurrentMatTab(1);
    },
    _onMaterialSearch() {
        var self = this;
        clearTimeout(this._matSearchTimer);
        this._matSearchTimer = setTimeout(function () {
            self._matPage = 1;
            self._loadCurrentMatTab(1);
        }, 300);
    },
    _reloadMaterialTab() {
        this._loadCurrentMatTab(this._matPage || 1);
    },
    _matPageGo(page) {
        this._loadCurrentMatTab(page);
    },
    _renderMaterialPagination(data) {
        var el = document.getElementById('matPagination');
        if (!el) return;
        var p = (data && data.page) || 1, t = (data && data.total_pages) || 1;
        if (t <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = 'flex';
        el.innerHTML = '<span style="margin-right:10px;color:#909399;font-size:12px;">共 ' + (data.count || 0) + ' 条，第 ' + p + '/' + t + ' 页</span>'
            + '<button class="pagination-btn" onclick="approvalApp._matPageGo(' + (p - 1) + ')"' + (p <= 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i> 上一页</button>'
            + '<button class="pagination-btn" onclick="approvalApp._matPageGo(' + (p + 1) + ')"' + (p >= t ? ' disabled' : '') + '>下一页 <i class="fas fa-chevron-right"></i></button>';
    },
    _renderMatStatus(status, kind) {
        var reqMap = {
            pending: ['#909399', '待审批'],
            approved: ['#e6a23c', '已通过(待采购)'],
            purchasing: ['#409eff', '采购中'],
            stocked: ['#67c23a', '已入库(可领用)'],
            rejected: ['#f56c6c', '已驳回']
        };
        var reqsnMap = {
            pending: ['#909399', '待审批'],
            approved: ['#67c23a', '已通过(可领用)'],
            rejected: ['#f56c6c', '已驳回']
        };
        var stockinMap = {
            pending: ['#909399', '待审批'],
            approved: ['#67c23a', '已入库'],
            rejected: ['#f56c6c', '已驳回']
        };
        var map = kind === 'reqsn' ? reqsnMap : (kind === 'stockin' ? stockinMap : reqMap);
        var c = map[status] || ['#909399', status];
        return '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;color:#fff;background:' + c[0] + ';">' + this._escape(c[1]) + '</span>';
    },
    // ===== 可领用物资目录（全员可用：按物品聚合，解决「不知道需求单号就领不了」） =====
    _availCtxIds(ctx) {
        return ctx === 'pick'
            ? { tbody: 'availPickTbody', search: 'availPickSearch', pager: 'availPickPagination' }
            : { tbody: 'matAvailTbody', search: 'matSearch', pager: 'matPagination' };
    },
    async _loadAvailabilities(page, ctx) {
        ctx = ctx || 'tab';
        var ids = this._availCtxIds(ctx);
        var tbody = document.getElementById(ids.tbody);
        if (!tbody) return;
        page = page || 1;
        // mode：领用（默认，可领用数量） / stock_in（入库，待收数量）——由选择器的调用方决定
        var mode = (ctx === 'pick') ? (this._availPickMode || '') : '';
        if (ctx === 'tab') this._matPage = page;
        var kwEl = document.getElementById(ids.search);
        var search = kwEl ? kwEl.value.trim() : '';
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';
        try {
            var url = OA_API_URL + '/material/available-items/?page=' + page + '&page_size=10';
            if (search) url += '&search=' + encodeURIComponent(search);
            if (mode === 'stock_in') url += '&mode=stock_in';
            var r = await fetch(url, { headers: TokenManager.getHeaders() });
            if (!r.ok) throw new Error('加载失败');
            var d = await r.json();
            var list = d.results || [];
            if (ctx === 'pick') this._availPickList = list; else this._matAvailList = list;
            if (ctx === 'pick') this._availPickMode = mode; else this._matAvailMode = mode;
            if (!list.length) {
                var empty = mode === 'stock_in'
                    ? (search ? '未找到待入库的物资，换个物资名称试试' : '暂无待入库物资（需求单审批通过后才可入库）')
                    : (search ? '未找到可领用的物资，换个物资名称试试' : '暂无可用物资（需求单审批通过并入库后才可领用）');
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">' + empty + '</td></tr>';
            } else {
                tbody.innerHTML = this._availRowsHtml(list, ctx, mode);
            }
            this._renderAvailPager(ids.pager, d, ctx);
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>';
        }
    },
    _availRowsHtml(list, ctx, mode) {
        var self = this;
        var stockMode = mode === 'stock_in';
        var actText = stockMode ? '入库' : '申领';
        var actIcon = stockMode ? 'fa-warehouse' : 'fa-hand-holding';
        var qtyHead = stockMode ? '该单待收' : '该单可领';
        return list.map(function (g, gi) {
            var multi = (g.source_count || 0) > 1;
            var priceTxt = (g.price != null) ? ('¥' + g.price) : (multi ? '按来源' : '—');
            var srcRows = (g.sources || []).map(function (s, si) {
                var p = (s.unit_price != null) ? ('¥' + s.unit_price) : '—';
                var srcLabel = s.price_source === 'stock_in' ? '入库'
                    : (s.price_source === 'stock_in_amount' ? '入库分摊' : '预估');
                return '<tr style="background:#f7fbf9;">'
                    + '<td style="padding-left:26px;font-size:12px;color:#606266;"><i class="fas fa-box-open" style="color:#16a085;margin-right:4px;"></i>' + self._escape(s.doc_no) + '</td>'
                    + '<td style="font-size:12px;">' + self._escape(s.branch_dept || '-') + '</td>'
                    + '<td style="font-size:12px;">' + self._escape(s.applicant || '-') + '</td>'
                    + '<td style="font-size:12px;color:#409eff;font-weight:600;">' + s.remaining + '</td>'
                    + '<td style="font-size:12px;">' + p + ' <span style="font-size:10px;color:#909399;">' + srcLabel + '</span></td>'
                    + '<td><button class="btn btn-sm btn-primary" style="padding:2px 10px;font-size:12px;" onclick="approvalApp._availAction(' + gi + ',' + si + ',\'' + ctx + '\')"><i class="fas ' + actIcon + '"></i> ' + actText + '</button></td>'
                    + '</tr>';
            }).join('');
            var opBtn = multi
                ? '<button class="action-btn" title="展开来源需求单" onclick="approvalApp._availToggleRow(this)"><i class="fas fa-list-ul" style="color:#16a085;"></i></button>'
                : '<button class="action-btn" title="' + (stockMode ? '新建物资入库单并关联来源需求单' : '新建物资领用单并关联来源需求单') + '" onclick="approvalApp._availAction(' + gi + ',0,\'' + ctx + '\')"><i class="fas ' + actIcon + '" style="color:#16a085;"></i></button>';
            return '<tr class="mat-avail-row">'
                + '<td>' + (multi
                    ? '<i class="fas fa-caret-right mat-avail-caret" style="color:#909399;cursor:pointer;margin-right:6px;" onclick="approvalApp._availToggleRow(this)"></i>'
                    : '<i class="fas fa-box" style="color:#c0c4cc;margin-right:6px;"></i>')
                + '<span style="font-weight:600;">' + self._escape(g.item_name) + '</span>'
                + (g.spec ? '<span style="font-size:11px;color:#909399;margin-left:6px;">' + self._escape(g.spec) + '</span>' : '')
                + '</td>'
                + '<td>' + self._escape(g.unit || '-') + '</td>'
                + '<td style="font-weight:600;color:#16a085;">' + g.total_remaining + '</td>'
                + '<td style="color:' + ((g.stock || 0) > 0 ? '#409eff' : '#909399') + ';">' + (g.stock || 0) + '</td>'
                + '<td>' + priceTxt + '</td>'
                + '<td>' + (g.source_count || 0) + '</td>'
                + '<td>' + opBtn + '</td>'
                + '</tr>'
                + '<tr class="mat-avail-src" style="display:none;"><td colspan="7" style="padding:0;background:#f7fbf9;">'
                + '<table class="oa-table" style="margin:0;"><thead><tr><th style="padding-left:26px;">来源需求单号</th><th>分公司</th><th>申请人</th><th>' + qtyHead + '</th><th>入库单价</th><th style="width:110px;">操作</th></tr></thead>'
                + '<tbody>' + srcRows + '</tbody></table>'
                + '</td></tr>';
        }).join('');
    },
    _availToggleRow(el) {
        var tr = el.closest ? el.closest('tr') : null;
        if (!tr) return;
        var src = tr.nextElementSibling;
        if (!src || (src.className || '').indexOf('mat-avail-src') < 0) return;
        var open = src.style.display !== 'none';
        src.style.display = open ? 'none' : 'table-row';
        var caret = tr.querySelector('.mat-avail-caret');
        if (caret) caret.className = 'fas mat-avail-caret ' + (open ? 'fa-caret-right' : 'fa-caret-down');
    },
    // 汇总行/来源行动作：来源选择器内回调外部；物资管理内一键发起领用单
    _availAction(gi, si, ctx) {
        var list = (ctx === 'pick') ? (this._availPickList || []) : (this._matAvailList || []);
        var g = list[gi];
        if (!g) return;
        var s = (g.sources || [])[si] || {};
        if (ctx === 'pick') {
            var cb = this._availPickCb;
            this.closeAvailPicker();
            if (cb) cb({
                requirement_id: s.requirement_id, doc_no: s.doc_no, item_name: g.item_name,
                spec: g.spec, unit: g.unit, remaining: s.remaining
            });
            return;
        }
        if (!s.requirement_id) return;
        if (this._matAvailMode === 'stock_in') this._startStockInForRequirement(s.requirement_id, g.item_name);
        else this._startRequisitionForRequirement(s.requirement_id, g.item_name);
    },
    _renderAvailPager(elId, data, ctx) {
        var el = document.getElementById(elId);
        if (!el) return;
        var p = (data && data.page) || 1, t = (data && data.total_pages) || 1;
        if (t <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
        el.style.display = 'flex';
        el.innerHTML = '<span style="margin-right:10px;color:#909399;font-size:12px;">共 ' + (data.count || 0) + ' 种物资，第 ' + p + '/' + t + ' 页</span>'
            + '<button class="pagination-btn" onclick="approvalApp._loadAvailabilities(' + (p - 1) + ',\'' + ctx + '\')"' + (p <= 1 ? ' disabled' : '') + '><i class="fas fa-chevron-left"></i> 上一页</button>'
            + '<button class="pagination-btn" onclick="approvalApp._loadAvailabilities(' + (p + 1) + ',\'' + ctx + '\')"' + (p >= t ? ' disabled' : '') + '>下一页 <i class="fas fa-chevron-right"></i></button>';
    },
    // 通用「可领用/待入库物资」选择器（领用单/入库单表单里按物资查找，回调 onPick）
    openAvailPicker(opts) {
        opts = opts || {};
        var stockMode = opts.mode === 'stock_in';
        this._availPickCb = opts.onPick || null;
        this._availPickMode = opts.mode || '';
        var m = document.getElementById('matAvailPickerModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'matAvailPickerModal';
            m.style.cssText = 'position:fixed;inset:0;z-index:160000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:12px;';
            m.innerHTML = '<div style="background:var(--bg-primary,#fff);color:var(--text-primary,#303133);border-radius:12px;width:100%;max-width:1000px;max-height:90vh;min-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.28);">'
                + '<div class="modal-header"><h3><i class="fas fa-boxes" style="color:#16a085;"></i> ' + this._escape(opts.title || '选择可领用物资') + '</h3>'
                + '<button class="close-btn" onclick="approvalApp.closeAvailPicker()">&times;</button></div>'
                + '<div class="modal-body" style="overflow:auto;">'
                + '<div class="search-box" style="margin-bottom:10px;"><i class="fas fa-search"></i>'
                + '<input type="text" id="availPickSearch" placeholder="搜索物资名称 / 规格 / 需求单号 / 分公司..." oninput="approvalApp._onAvailPickSearch()"></div>'
                + '<div id="availPickHint" style="font-size:12px;color:#909399;margin-bottom:8px;"></div>'
                + '<table class="oa-table"><thead><tr><th>物资名称</th><th>单位</th><th id="availPickColQty">可领用</th><th>库存</th><th>入库单价</th><th>来源单数</th><th style="width:110px;">操作</th></tr></thead>'
                + '<tbody id="availPickTbody"></tbody></table>'
                + '<div id="availPickPagination" class="oa-pagination-bar" style="margin-top:10px;"></div>'
                + '</div>'
                + '<div class="modal-footer"><span style="flex:1;"></span><button class="btn btn-secondary" onclick="approvalApp.closeAvailPicker()">关闭</button></div>'
                + '</div>';
            document.body.appendChild(m);
            m.addEventListener('click', function (e) { if (e.target === m) approvalApp.closeAvailPicker(); });
        }
        // 标题/列名/提示随口径切换（领用 → 可领用；入库 → 待入库）
        var h3 = m.querySelector('.modal-header h3');
        if (h3) h3.innerHTML = '<i class="fas fa-boxes" style="color:#16a085;"></i> '
            + this._escape(opts.title || (stockMode ? '按物资查找待入库物资' : '按物资查找可领用物资'));
        var cq = document.getElementById('availPickColQty');
        if (cq) cq.textContent = stockMode ? '待入库' : '可领用';
        var hint = document.getElementById('availPickHint');
        if (hint) hint.textContent = stockMode
            ? '按物资名称查找即可，选中后自动关联来源需求单并带出待收数量，无需知道需求单号。'
            : '按物资名称查找即可，选中后自动关联来源需求单，无需知道需求单号。';
        var t = document.getElementById('availPickSearch');
        if (t) t.value = '';
        m.style.display = 'flex';
        this._loadAvailabilities(1, 'pick');
    },
    closeAvailPicker() {
        var m = document.getElementById('matAvailPickerModal');
        if (m) m.style.display = 'none';
        this._availPickCb = null;
    },
    _onAvailPickSearch() {
        var self = this;
        clearTimeout(this._availPickTimer);
        this._availPickTimer = setTimeout(function () { self._loadAvailabilities(1, 'pick'); }, 300);
    },

    async _loadMaterialRequirements(page) {
        var tbody = document.getElementById('matReqTbody');
        if (!tbody) return;
        page = page || 1;
        this._matPage = page;
        var search = document.getElementById('matSearch') ? document.getElementById('matSearch').value.trim() : '';
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';
        try {
            var url = OA_API_URL + '/material/requirements/?page=' + page + '&page_size=10';
            if (search) url += '&search=' + encodeURIComponent(search);
            var d = await this.apiGet(url);
            if (!d) return;
            var list = d.results || [];
            if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">' + (search ? '未找到匹配的需求单' : '暂无物资需求单') + '</td></tr>'; this._renderMaterialPagination(d); return; }
            var self = this;
            tbody.innerHTML = list.map(function (it) {
                var received = (it.received_total != null) ? it.received_total : 0;
                var totalQ = (it.total_quantity != null) ? it.total_quantity : 0;
                var remain = (it.remaining != null) ? it.remaining : 0;
                var toRec = (it.to_receive != null) ? it.to_receive : (totalQ - received);
                var canStock = it.status !== 'stocked' && it.request_status === 'approved' && toRec > 0;
                var isAdmin = self._isAdminFromStorage();
                var actions = '';
                actions += '<button class="action-btn" title="需求单详情" onclick="approvalApp._openRequirementDetail(' + it.id + ')"><i class="fas fa-list-ul" style="color:#909399;"></i></button>';
                if (isAdmin && it.status === 'approved') {
                    actions += '<button class="action-btn" title="确认采购(采购中)" onclick="approvalApp._changeRequirementStatus(' + it.id + ',\'purchasing\')"><i class="fas fa-cart-arrow-down" style="color:#409eff;"></i></button>';
                }
                if (isAdmin && canStock) {
                    actions += '<button class="action-btn" title="去入库：新建物资入库单关联本需求单" onclick="approvalApp._startStockInForRequirement(' + it.id + ')"><i class="fas fa-warehouse" style="color:#16a085;"></i></button>';
                }
                if (it.status === 'stocked') {
                    actions += '<span style="font-size:11px;color:#67c23a; padding:6px;"><i class="fas fa-check-circle"></i> 可领用</span>';
                }
                if (it.request_id) {
                    actions += '<button class="action-btn" title="查看审批" onclick="approvalApp.showDetail(' + it.request_id + ')"><i class="fas fa-eye"></i></button>';
                }
                return '<tr>'
                    + '<td style="font-weight:600;color:#16a085;">' + self._escape(it.doc_no) + '</td>'
                    + '<td>' + self._escape(it.branch_dept || '-') + '</td>'
                    + '<td>' + self._renderMatStatus(it.status, 'req') + '</td>'
                    + '<td><div>' + received + ' / ' + totalQ + '</div>'
                    + (toRec > 0 ? '<div style="font-size:11px;color:#e6a23c;">待收 ' + toRec + '</div>' : '<div style="font-size:11px;color:#67c23a;">已收齐</div>') + '</td>'
                    + '<td style="color:' + (remain > 0 ? '#409eff' : '#909399') + ';">' + remain + '</td>'
                    + '<td>' + self._escape(it.applicant || '-') + '</td>'
                    + '<td>' + self._escape(it.created_at || '-') + '</td>'
                    + '<td style="display:flex;gap:4px;">' + (actions || '-') + '</td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    },
    async _loadMaterialRequisitions(page) {
        var tbody = document.getElementById('matReqsnTbody');
        if (!tbody) return;
        page = page || 1;
        this._matPage = page;
        var search = document.getElementById('matSearch') ? document.getElementById('matSearch').value.trim() : '';
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';
        try {
            var url = OA_API_URL + '/material/requisitions/?page=' + page + '&page_size=10';
            if (search) url += '&search=' + encodeURIComponent(search);
            var d = await this.apiGet(url);
            if (!d) return;
            var list = d.results || [];
            if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">' + (search ? '未找到匹配的领用单' : '暂无物资领用单') + '</td></tr>'; this._renderMaterialPagination(d); return; }
            var self = this;
            tbody.innerHTML = list.map(function (it) {
                var actions = it.request_id ? '<button class="action-btn" title="查看审批" onclick="approvalApp.showDetail(' + it.request_id + ')"><i class="fas fa-eye"></i></button>' : '-';
                return '<tr>'
                    + '<td style="font-weight:600;color:#e6a23c;">' + self._escape(it.doc_no) + '</td>'
                    + '<td style="font-weight:600;color:#16a085;">' + self._escape(it.requirement_doc_no || '-') + '</td>'
                    + '<td>' + self._escape(it.branch_dept || '-') + '</td>'
                    + '<td>' + self._renderMatStatus(it.status, 'reqsn') + '</td>'
                    + '<td>' + it.item_count + ' 项</td>'
                    + '<td>' + self._escape(it.applicant || '-') + '</td>'
                    + '<td>' + self._escape(it.created_at || '-') + '</td>'
                    + '<td>' + actions + '</td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    },
    async _loadMaterialStockIns(page) {
        var tbody = document.getElementById('matStockInTbody');
        if (!tbody) return;
        page = page || 1;
        this._matPage = page;
        var search = document.getElementById('matSearch') ? document.getElementById('matSearch').value.trim() : '';
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#909399;"><i class="fas fa-spinner fa-spin"></i> 加载中...</td></tr>';
        try {
            var url = OA_API_URL + '/material/stock-ins/?page=' + page + '&page_size=10';
            if (search) url += '&search=' + encodeURIComponent(search);
            var d = await this.apiGet(url);
            if (!d) return;
            var list = d.results || [];
            if (!list.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#909399;">' + (search ? '未找到匹配的入库单' : '暂无物资入库单（请通过「物资入库单」审批发起入库）') + '</td></tr>'; this._renderMaterialPagination(d); return; }
            var self = this;
            tbody.innerHTML = list.map(function (it) {
                var actions = '';
                if (it.request_id) actions += '<button class="action-btn" title="查看审批" onclick="approvalApp.showDetail(' + it.request_id + ')"><i class="fas fa-eye"></i></button>';
                return '<tr>'
                    + '<td style="font-weight:600;color:#16a085;">' + self._escape(it.doc_no) + '</td>'
                    + '<td style="font-weight:600;color:#e6a23c;">' + self._escape(it.requirement_doc_no || '-') + '</td>'
                    + '<td>' + self._escape(it.warehouse || '-') + '</td>'
                    + '<td>' + self._escape(it.stock_date || '-') + '</td>'
                    + '<td>' + self._renderMatStatus(it.status, 'stockin') + '</td>'
                    + '<td>' + it.item_count + ' 项 / 合计 ' + it.received_total + '</td>'
                    + '<td>' + self._escape(it.applicant || '-') + '</td>'
                    + '<td>' + self._escape(it.created_at || '-') + '</td>'
                    + '<td>' + (actions || '-') + '</td>'
                    + '</tr>';
            }).join('');
            this._renderMaterialPagination(d);
        } catch (e) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:#909399;">加载失败</td></tr>'; }
    },
    // 物资需求单操作「去入库」：打开新建审批并预选物资入库单类型 + 预关联该需求单
    // itemName 非空时（从「按物资查找待入库物资」进入）明细只保留该物资且数量默认待收数量
    async _startStockInForRequirement(rid, itemName) {
        var hasType = (this._approvalTypes || []).some(function (t) { return t.code === 'material_stock_in'; });
        if (!hasType) { this.showToast('物资入库单类型暂不可用，请先停用旧自定义「物资入库」类型', true); return; }
        this.closeMaterialMgmtModal();
        try {
            await this.openCreateModal();
        } catch (e) { this.showToast('打开新建审批失败', true); return; }
        this.selectType('material_stock_in');
        // 预填当前需求单（回填单号/分公司并以 图标+单号+分公司 形式展示在关联框下方，同时带出待收明细）
        await this._preselectDynRequirement('link_req', 'items', rid);
        if (itemName) this._keepOnlyDynStructRow('items', itemName, true);
        var modal = document.getElementById('createApprovalModal');
        if (modal) modal.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    },
    // 预选某需求单并回填关联标签（含需求单号/分公司）与明细
    async _preselectDynRequirement(key, target, rid) {
        try {
            const detail = await this.apiGet(OA_API_URL + '/material/requirement-detail/?id=' + rid);
            if (!detail) { this.showToast('加载需求单失败', true); return; }
            this._dynReqLinkValues = this._dynReqLinkValues || {};
            this._dynReqLinkValues[key] = {
                requirement_id: detail.id, doc_no: detail.doc_no,
                branch_dept: detail.branch_dept, purpose: detail.purpose, amount: detail.amount
            };
            this._renderDynReqLinkTag(key);
            if (target) this._fillDynStructFromRequirement(target, detail.items || []);
        } catch (e) {
            this.showToast((e && e.message) || '加载需求单失败', true);
        }
    },
    // 从「可领用物资」申领：打开新建审批 → 选物资领用单类型 → 预关联来源需求单 → 只保留所选物资
    async _startRequisitionForRequirement(rid, itemName) {
        var hasType = (this._approvalTypes || []).some(function (t) { return t.code === 'material_requisition'; });
        if (!hasType) { this.showToast('物资领用单类型暂不可用，请联系管理员', true); return; }
        this.closeMaterialMgmtModal();
        try {
            await this.openCreateModal();
        } catch (e) { this.showToast('打开新建审批失败', true); return; }
        this.selectType('material_requisition');
        await this._preselectDynRequirement('link_req', 'items', rid);
        this._keepOnlyDynStructRow('items', itemName);
        var modal = document.getElementById('createApprovalModal');
        if (modal) modal.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    },

    async _changeRequirementStatus(id, status) {
        var label = status === 'stocked' ? '确认该需求单已采购入库，之后可被领用' : '将该需求单标记为采购中';
        var ok = await this.showConfirmDialog('需求单状态流转', label + '？', 'confirm');
        if (!ok) return;
        try {
            var r = await fetch(OA_API_URL + '/material/requirement-status/', {
                method: 'POST',
                headers: TokenManager.getHeaders(),
                body: JSON.stringify({id: id, status: status})
            });
            if (!r.ok) { var e2 = await r.json().catch(function () { return {}; }); throw new Error(this._extractApiError(e2)); }
            this.showToast('已更新', false);
            this._loadMaterialRequirements();
        } catch (e) { this.showToast(e.message || '更新失败', true); }
    },

    async _openRequirementDetail(rid) {
        try {
            var d = await this.apiGet(OA_API_URL + '/material/requirement-detail/?id=' + rid);
            if (!d) return;
            var body = document.getElementById('matReqDetailBody');
            var itemsHtml = (d.items || []).map(function (i) {
                var estP = (i.price != null && i.price !== '') ? Number(i.price) : null;
                var actP = (i.stocked_price != null && i.stocked_price !== '') ? Number(i.stocked_price) : null;
                // 单价以「实际入库单价」为准（取自入库明细/入库单实际金额分摊），无则显示预估单价
                var price = (actP != null) ? actP : estP;
                var srcTag = (i.price_source === 'stock_in') ? '<span style="font-size:10px;color:#16a085;">入库</span>'
                    : (i.price_source === 'stock_in_amount' ? '<span style="font-size:10px;color:#16a085;">入库分摊</span>'
                        : '<span style="font-size:10px;color:#909399;">预估</span>');
                var totalAmt = (price != null) ? (price * (Number(i.quantity) || 0)).toFixed(2) : '-';
                var received = (i.received != null) ? i.received : 0;
                var toRec = (i.to_receive != null) ? i.to_receive : (Number(i.quantity) - received);
                return '<tr><td>' + approvalApp._escape(i.item_name) + '</td>'
                    + '<td>' + approvalApp._escape(i.spec || '-') + '</td>'
                    + '<td>' + approvalApp._escape(i.unit || '-') + '</td>'
                    + '<td style="text-align:right;">' + (price != null ? price.toFixed(2) : '-') + ' ' + srcTag + '</td>'
                    + '<td style="text-align:right;">' + i.quantity + '</td>'
                    + '<td style="text-align:right;color:#e6a23c;font-weight:600;">' + totalAmt + '</td>'
                    + '<td style="text-align:right;color:#16a085;font-weight:600;">' + received + '</td>'
                    + '<td style="text-align:right;color:#e6a23c;">' + toRec + '</td>'
                    + '<td style="color:#67c23a;font-weight:600;">' + i.remaining + '</td></tr>';
            }).join('') || '<tr><td colspan="9" style="text-align:center;color:#909399;">无明细</td></tr>';
            var stockInsHtml = (d.stock_ins || []).length
                ? '<div style="font-size:13px;font-weight:600;color:#16a085;margin:14px 0 6px;"><i class="fas fa-warehouse"></i> 入库记录</div>'
                    + '<table class="oa-table"><thead><tr><th>入库单号</th><th>入库日期</th><th>仓库/库位</th><th>实收合计</th><th>实际金额</th><th>状态</th><th>经手人</th></tr></thead><tbody>'
                    + (d.stock_ins || []).map(function (si) {
                        var amt = (si.actual_amount != null && si.actual_amount !== '') ? ('¥' + Number(si.actual_amount).toFixed(2)) : '-';
                        return '<tr><td style="font-weight:600;color:#16a085;">' + approvalApp._escape(si.doc_no) + '</td>'
                            + '<td>' + approvalApp._escape(si.stock_date || '-') + '</td>'
                            + '<td>' + approvalApp._escape(si.warehouse || '-') + '</td>'
                            + '<td>' + si.received_total + '</td>'
                            + '<td style="text-align:right;color:#e6a23c;">' + amt + '</td>'
                            + '<td>' + approvalApp._renderMatStatus(si.status, 'stockin') + '</td>'
                            + '<td>' + approvalApp._escape(si.operator || '-') + '</td></tr>';
                    }).join('') + '</tbody></table>'
                : '';
            body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px;">'
                + '<div><strong>需求单号：</strong><span style="color:#16a085;font-weight:700;">' + approvalApp._escape(d.doc_no) + '</span></div>'
                + '<div><strong>状态：</strong>' + approvalApp._renderMatStatus(d.status, 'req') + '</div>'
                + '<div><strong>分公司：</strong>' + approvalApp._escape(d.branch_dept || '-') + '</div>'
                + '<div><strong>申请人：</strong>' + approvalApp._escape(d.applicant || '-') + '</div>'
                + '<div><strong>预估金额：</strong><span style="color:#e6a23c;font-weight:700;">¥' + (d.amount != null && d.amount !== '' ? (Number(d.amount)).toFixed(2) : '-') + '</span></div>'
                + '<div><strong>用途：</strong>' + approvalApp._escape(d.purpose || '-') + '</div>'
                + '</div>'
                + '<table class="oa-table"><thead><tr><th>物品名称</th><th>规格</th><th>单位</th><th>单价</th><th>需求数量</th><th>金额</th><th>已入库</th><th>待收</th><th>剩余可领</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>'
                + stockInsHtml;
            // 提升层级：在审批详情（z-index 3000）之上打开
            document.getElementById('materialReqDetailModal').style.zIndex = '3500';
            document.getElementById('materialReqDetailModal').style.display = 'flex';
            setTimeout(function () { document.getElementById('materialReqDetailModal').classList.add('show'); }, 10);
        } catch (e) { this.showToast('加载需求单详情失败', true); }
    },
    closeRequirementDetailModal() {
        var m = document.getElementById('materialReqDetailModal');
        if (m) { m.classList.remove('show'); setTimeout(function () { m.style.display = 'none'; }, 150); }
    },

    // 详情模态框：上一条 / 下一条切换（到本页首/末条时提示并引导翻页）
    _navDetail(delta) {
        if (!this._listApprovalIds || !this._listApprovalIds.length) return;
        var idx = this._listApprovalIds.indexOf(this._detailApprovalId);
        if (idx === -1) return;
        var total = this._listTotalPages || 1;
        if (delta < 0 && idx === 0) {
            this.showToast('已经是本页第一条审批了，当前第 ' + this.currentPage + '/' + total + ' 页，如需查看更多请翻页', true);
            return;
        }
        if (delta > 0 && idx === this._listApprovalIds.length - 1) {
            this.showToast('已经是本页最后一条审批了，当前第 ' + this.currentPage + '/' + total + ' 页，如需查看更多请翻页', true);
            return;
        }
        var next = this._listApprovalIds[idx + delta];
        if (next == null) return;
        this.showDetail(next);
    },
    });
})();
