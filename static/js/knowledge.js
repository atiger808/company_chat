// static/js/knowledge.js - 企业知识库（在线文档）
// 左侧：分组树（文档 → 章节）  右侧：文档内容（锚点 / 本页目录）  顶部：全文搜索
(function () {
    'use strict';

    var API_URL = '/api/docs/catalog/';
    var STATE_KEY = 'kb_last_doc';

    // 树里展示到第几级标题（H2 + H3）
    var TREE_MAX_LEVEL = 3;
    var SPY_OFFSET = 90;        // 滚动高亮判定的顶部偏移
    var MAX_RESULTS = 60;

    function $(id) { return document.getElementById(id); }

    function escapeHtml(t) {
        return String(t == null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function stripTags(html) {
        return String(html || '').replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ').trim();
    }

    var KB = {
        docs: [],           // {slug,title,desc,html,headings,sections,updatedAt}
        bySlug: {},
        current: null,
        query: '',
        collapsed: {},       // {slug: true} 折叠状态（默认展开当前文档）

        // ==================== 初始化 ====================
        init: function () {
            // 知识库对未登录用户开放（方便智能体检索内容），不再强制跳转登录
            this.bindEvents();
            this.syncThemeIcon();
            this.load();
        },

        load: function (retried) {
            var self = this;
            // 已登录则带上令牌（可看到内部文档），未登录只拿到公开文档
            var headers = {};
            var hasToken = false;
            try {
                if (typeof TokenManager !== 'undefined' && TokenManager.getHeaders) {
                    headers = TokenManager.getHeaders() || {};
                    hasToken = !!(headers.Authorization || headers['Authorization']);
                }
            } catch (e) {}
            fetch(API_URL, {headers: headers})
                .then(function (r) {
                    if (!r.ok) {
                        // 令牌失效/过期：清掉后按未登录再取一次，保证公开文档仍可读
                        if ((r.status === 401 || r.status === 403) && hasToken && !retried) {
                            try { localStorage.removeItem('access_token'); } catch (e) {}
                            return self.load(true);
                        }
                        throw new Error('HTTP ' + r.status);
                    }
                    return r.json();
                })
                .then(function (data) { if (data) self.build(data); })
                .catch(function (e) {
                    console.error('加载知识库失败:', e);
                    $('kbTree').innerHTML = '<div class="kb-error"><i class="fas fa-exclamation-circle"></i>'
                        + '文档加载失败<div><button onclick="location.reload()">重新加载</button></div></div>';
                });
        },

        build: function (data) {
            var self = this;
            this.groups = (data && data.groups) || [];
            this.docs = [];
            this.bySlug = {};
            this.restricted = (data && data.restricted_count) || 0;
            this.groups.forEach(function (g) {
                (g.docs || []).forEach(function (d) {
                    var rendered = MdRender.render(d.content || '');
                    var title = d.title || rendered.title || d.slug;
                    var doc = {
                        slug: d.slug,
                        group: g.name,
                        groupIcon: g.icon || 'fa-file-lines',
                        title: title,
                        desc: d.desc || '',
                        error: d.error || '',
                        updatedAt: d.updated_at || '',
                        html: rendered.html,
                        headings: rendered.headings || [],
                    };
                    doc.sections = self.splitSections(doc);
                    self.docs.push(doc);
                    self.bySlug[doc.slug] = doc;
                });
            });
            this.renderWelcome();
            this.renderTree();
            $('kbSidebarCount').textContent = this.docs.length + ' 篇';

            // 打开：URL 锚点 > 上次浏览 > 不打开（停在欢迎页）
            var route = this.parseHash();
            var last = null;
            try { last = localStorage.getItem(STATE_KEY); } catch (e) {}
            var target = (route && route.slug) || last;
            if (target && this.bySlug[target]) {
                this.openDoc(target, route && route.sec, {push: false, scroll: !!route});
            }
        },

        // 把渲染后的 HTML 按标题切分成「章节」，用于搜索与锚点定位
        splitSections: function (doc) {
            var parts = String(doc.html || '').split(/(?=<h[1-6] id=")/);
            var sections = [];
            parts.forEach(function (part, idx) {
                var m = /^<h([1-6]) id="([^"]+)">/.exec(part);
                var level = 0, id = '', heading = '';
                var body = part;
                if (m) {
                    level = Number(m[1]);
                    id = m[2];
                    var text = /^<h[1-6] id="[^"]+">([\s\S]*?)<\/h[1-6]>/.exec(part);
                    heading = stripTags(text ? text[1] : '').replace(/#$/, '').trim();
                    body = part.slice((text ? text[0] : '').length);
                } else {
                    id = '';
                    level = 0;
                    heading = doc.title;
                }
                sections.push({
                    id: id,
                    level: level,
                    heading: heading,
                    text: stripTags(body),
                    index: idx,
                });
            });
            return sections;
        },

        // ==================== 欢迎页 ====================
        renderWelcome: function () {
            var box = $('kbWelcomeDocs');
            if (!box) return;
            box.innerHTML = this.docs.map(function (d) {
                return '<div class="kb-doc-card" data-slug="' + escapeHtml(d.slug) + '">'
                    + '<div class="kb-dc-name"><i class="fas ' + escapeHtml(d.groupIcon) + '"></i>'
                    + escapeHtml(d.title) + '</div>'
                    + '<div class="kb-dc-desc">' + escapeHtml(d.desc || '') + '</div>'
                    + '<div class="kb-dc-meta">' + escapeHtml(d.group)
                    + (d.updatedAt ? ' · 更新于 ' + escapeHtml(d.updatedAt) : '')
                    + (d.error ? ' · <span style="color:#f56c6c;">' + escapeHtml(d.error) + '</span>' : '')
                    + '</div></div>';
            }).join('');
        },

        // ==================== 左侧树 ====================
        renderTree: function () {
            var tree = $('kbTree');
            var self = this;
            if (this.query) { this.renderSearch(tree); return; }

            var html = '';
            var lastGroup = null;
            this.docs.forEach(function (doc) {
                if (doc.group !== lastGroup) {
                    if (lastGroup !== null) html += '</div>';
                    html += '<div class="kb-group">'
                        + '<div class="kb-group-title"><i class="fas ' + escapeHtml(doc.groupIcon) + '"></i>'
                        + escapeHtml(doc.group) + '</div>';
                    lastGroup = doc.group;
                }
                html += self.docNodeHtml(doc);
            });
            if (lastGroup !== null) html += '</div>';
            if (this.restricted > 0) {
                html += '<div class="kb-locked-hint"><i class="fas fa-lock"></i> 另有 '
                    + this.restricted + ' 篇内部文档需 <a href="/login/">登录</a> 后查看</div>';
            }
            tree.innerHTML = html || '<div class="kb-error">暂无文档</div>';
            this.syncTreeActive();
        },

        docNodeHtml: function (doc) {
            var sections = doc.headings.filter(function (h) {
                return h.level >= 2 && h.level <= TREE_MAX_LEVEL;
            });
            var isOpen = !this.collapsed[doc.slug];
            var isActive = this.current && this.current.slug === doc.slug;
            var out = '<button class="kb-tree-item kb-doc-node' + (isActive ? ' active' : '')
                + '" data-slug="' + escapeHtml(doc.slug) + '" title="' + escapeHtml(doc.title) + '">';
            if (sections.length) {
                out += '<i class="fas fa-chevron-right kb-caret' + (isOpen ? ' open' : '')
                    + '" data-caret="' + escapeHtml(doc.slug) + '"></i>';
            } else {
                out += '<span style="width:10px;flex-shrink:0;"></span>';
            }
            out += '<i class="fas fa-file-lines kb-doc-icon"></i>'
                + '<span class="kb-label">' + escapeHtml(doc.title) + '</span></button>';

            if (sections.length) {
                out += '<div class="kb-sub' + (isOpen ? ' open' : '') + '" data-sub="' + escapeHtml(doc.slug) + '">';
                out += sections.map(function (h) {
                    return '<button class="kb-tree-item kb-sec-node kb-lv' + h.level + '"'
                        + ' data-slug="' + escapeHtml(doc.slug) + '" data-sec="' + escapeHtml(h.id) + '"'
                        + ' title="' + escapeHtml(h.text) + '">'
                        + '<span class="kb-label">' + escapeHtml(h.text) + '</span></button>';
                }).join('');
                out += '</div>';
            }
            return out;
        },

        syncTreeActive: function () {
            var self = this;
            var tree = $('kbTree');
            if (!tree) return;
            tree.querySelectorAll('.kb-tree-item.active').forEach(function (el) { el.classList.remove('active'); });
            if (!this.current) return;
            var node = tree.querySelector('.kb-sec-node[data-sec="' + this.currentSectionId() + '"]');
            if (!node) {
                node = tree.querySelector('.kb-doc-node[data-slug="' + this.current.slug + '"]');
            }
            if (node) {
                node.classList.add('active');
                // 让高亮项保持可见
                var box = node.closest('.kb-sub') || node;
                if (box && box.scrollIntoView) {
                    try { box.scrollIntoView({block: 'nearest'}); } catch (e) {}
                }
            }
            // 折叠状态（用 classes 维护，避免整树重绘丢失滚动位置）
            tree.querySelectorAll('[data-caret]').forEach(function (c) {
                var open = !!self.collapsedStatus(c.getAttribute('data-caret'));
                c.classList.toggle('open', open);
                var sub = tree.querySelector('.kb-sub[data-sub="' + c.getAttribute('data-caret') + '"]');
                if (sub) sub.classList.toggle('open', open);
            });
        },

        collapsedStatus: function (slug) {
            return !this.collapsed[slug];
        },

        currentSectionId: function () {
            return this._activeSection || '';
        },

        // ==================== 搜索 ====================
        renderSearch: function (tree) {
            var q = this.query.toLowerCase();
            var html = '';
            var total = 0;
            var self = this;
            this.docs.forEach(function (doc) {
                var hits = [];
                if (doc.title.toLowerCase().indexOf(q) >= 0 || (doc.desc || '').toLowerCase().indexOf(q) >= 0) {
                    hits.push({sec: '', heading: doc.title, snippet: doc.desc || ''});
                }
                doc.sections.forEach(function (s) {
                    var text = s.text || '';
                    var idx = text.toLowerCase().indexOf(q);
                    if (idx < 0 && (s.heading || '').toLowerCase().indexOf(q) >= 0) idx = -1;
                    if (idx >= 0 || (s.heading || '').toLowerCase().indexOf(q) >= 0) {
                        var snippet = '';
                        if (idx >= 0) {
                            var start = Math.max(0, idx - 34);
                            var end = Math.min(text.length, idx + q.length + 56);
                            snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
                        } else {
                            snippet = text.slice(0, 70) + (text.length > 70 ? '…' : '');
                        }
                        hits.push({sec: s.id, heading: s.heading, snippet: snippet});
                    }
                });
                if (!hits.length) return;
                total += hits.length;
                html += '<div class="kb-group"><div class="kb-group-title">'
                    + '<i class="fas ' + escapeHtml(doc.groupIcon) + '"></i>' + escapeHtml(doc.title)
                    + '（' + hits.length + '）</div>';
                html += hits.slice(0, 12).map(function (h) {
                    return '<button class="kb-result" data-slug="' + escapeHtml(doc.slug) + '"'
                        + ' data-sec="' + escapeHtml(h.sec) + '">'
                        + '<div class="kb-r-doc">' + escapeHtml(doc.group) + '</div>'
                        + '<div class="kb-r-title">' + escapeHtml(h.heading) + '</div>'
                        + (h.snippet ? '<div class="kb-r-snippet">' + self.highlight(h.snippet, q) + '</div>' : '')
                        + '</button>';
                }).join('');
                html += '</div>';
            });
            if (!html) {
                html = '<div class="kb-error"><i class="fas fa-search"></i> 未找到与「'
                    + escapeHtml(this.query) + '」匹配的内容</div>';
            } else {
                html = '<div class="kb-search-label">共 ' + total + ' 处匹配'
                    + (total > MAX_RESULTS ? '（仅展示前 ' + MAX_RESULTS + ' 处）' : '') + '</div>' + html;
            }
            tree.innerHTML = html;
        },

        highlight: function (text, q) {
            var escaped = escapeHtml(text);
            if (!q) return escaped;
            var safeQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            try {
                return escaped.replace(new RegExp(safeQ, 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
            } catch (e) {
                return escaped;
            }
        },

        setQuery: function (q) {
            this.query = String(q || '').trim();
            $('kbSearchClear').style.display = this.query ? 'block' : 'none';
            $('kbSidebarTitle').textContent = this.query ? '搜索结果' : '文档目录';
            this.renderTree();
        },

        // ==================== 路由 / 打开文档 ====================
        parseHash: function () {
            var h = String(location.hash || '').replace(/^#\/?/, '');
            if (!h) return null;
            var parts = h.split('/');
            return {slug: decodeURIComponent(parts[0] || ''), sec: decodeURIComponent(parts[1] || '')};
        },

        setHash: function (slug, sec, replace) {
            var hash = '#/' + slug + (sec ? '/' + sec : '');
            if (location.hash === hash) return;
            if (replace && window.history && history.replaceState) {
                history.replaceState(null, '', hash);
            } else {
                location.hash = hash;   // 触发 hashchange → openDoc
            }
        },

        openDoc: function (slug, sec, opts) {
            opts = opts || {};
            var doc = this.bySlug[slug];
            if (!doc) return;
            this.current = doc;
            this._activeSection = sec || '';
            this.collapsed[slug] = false;
            this.query = '';
            $('kbSearchInput').value = '';
            $('kbSearchClear').style.display = 'none';
            $('kbSidebarTitle').textContent = '文档目录';
            try { localStorage.setItem(STATE_KEY, slug); } catch (e) {}

            $('kbWelcome').style.display = 'none';
            var box = $('kbDoc');
            box.style.display = 'block';
            if (opts.reuseDom !== true || box.getAttribute('data-slug') !== slug) {
                box.setAttribute('data-slug', slug);
                box.innerHTML = this.docHtml(doc);
            }
            this.renderTree();
            this.ensureGoTop();

            if (sec) {
                this.scrollToSection(sec, true);
            } else if (opts.scroll === false) {
                /* 恢复上次浏览时保持滚动位置 */
            } else {
                $('kbMain').scrollTop = 0;
            }
            if (opts.push !== false && !opts.fromHash) {
                this.setHash(slug, sec, false);
            }
        },

        docHtml: function (doc) {
            var toc = this.tocHtml(doc);
            var body = doc.error
                ? '<div class="kb-error"><i class="fas fa-exclamation-circle"></i> ' + escapeHtml(doc.error) + '</div>'
                : doc.html;
            return ''
                + '<div class="kb-doc-head">'
                + '  <div class="kb-doc-path"><a href="#" data-home="1"><i class="fas fa-book"></i> 知识库</a>'
                + '    <i class="fas fa-angle-right" style="font-size:10px;margin:0 4px;"></i>' + escapeHtml(doc.group) + '</div>'
                + '  <h1 class="kb-doc-title">' + escapeHtml(doc.title) + '</h1>'
                + '  <div class="kb-doc-meta">'
                + (doc.desc ? '<span><i class="fas fa-info-circle"></i> ' + escapeHtml(doc.desc) + '</span>' : '')
                + (doc.updatedAt ? '<span><i class="fas fa-clock"></i> 更新于 ' + escapeHtml(doc.updatedAt) + '</span>' : '')
                + '    <span><i class="fas fa-list-ul"></i> ' + doc.headings.filter(function (h) { return h.level === 2; }).length + ' 个章节</span>'
                + '  </div>'
                + '</div>'
                + toc
                + '<div class="kb-content" id="kbContent">' + body + '</div>';
        },

        tocHtml: function (doc) {
            var hs = doc.headings.filter(function (h) { return h.level === 2 || h.level === 3; });
            if (hs.length < 3) return '';
            var html = '<div class="kb-toc"><div class="kb-toc-title"><i class="fas fa-list-ul"></i> 本页目录</div><ol>';
            hs.forEach(function (h) {
                html += '<li class="kb-toc-l' + h.level + '">'
                    + '<a href="#/' + encodeURIComponent(doc.slug) + '/' + encodeURIComponent(h.id) + '">'
                    + escapeHtml(h.text) + '</a></li>';
            });
            return html + '</ol></div>';
        },

        scrollToSection: function (sec, flash) {
            var main = $('kbMain');
            var el = document.getElementById(sec);
            if (!el && $('kbContent')) {
                el = $('kbContent').querySelector('[id="' + sec.replace(/"/g, '\\"') + '"]');
            }
            if (!el) return;
            var top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
                - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--kb-topbar')) || 58) - 12;
            main.scrollTo({top: Math.max(0, top), behavior: 'smooth'});
            if (flash) {
                el.classList.remove('kb-flash');
                void el.offsetWidth;
                el.classList.add('kb-flash');
            }
        },

        // 滚动时高亮左侧对应章节（用 replaceState 更新 hash，不污染历史）
        onScroll: function () {
            var main = $('kbMain');
            if (!main || !this.current) return;
            this.ensureGoTop(main.scrollTop > 400);
            var heads = this.current.headings.filter(function (h) { return h.level <= TREE_MAX_LEVEL; });
            if (!heads.length) return;
            var active = '';
            for (var i = 0; i < heads.length; i++) {
                var el = document.getElementById(heads[i].id);
                if (!el) continue;
                if (el.getBoundingClientRect().top - main.getBoundingClientRect().top <= SPY_OFFSET) {
                    active = heads[i].id;
                } else {
                    break;
                }
            }
            if (active === this._activeSection) return;
            this._activeSection = active;
            this.syncTreeActive();
            if (active) this.setHash(this.current.slug, active, true);
        },

        // ==================== 事件 ====================
        bindEvents: function () {
            var self = this;
            var main = $('kbMain');
            var ticking = false;
            main.addEventListener('scroll', function () {
                if (ticking) return;
                ticking = true;
                window.requestAnimationFrame(function () { ticking = false; self.onScroll(); });
            });

            window.addEventListener('hashchange', function () {
                var route = self.parseHash();
                if (!route || !route.slug) {
                    self.showWelcome();
                    return;
                }
                self.openDoc(route.slug, route.sec, {fromHash: true, push: false, scroll: !!route.sec});
            });

            // 侧边栏点击（文档 / 章节 / 搜索结果 / 折叠箭头）
            $('kbSidebar').addEventListener('click', function (e) {
                var caret = e.target.closest('[data-caret]');
                if (caret) {
                    e.stopPropagation();
                    var slug = caret.getAttribute('data-caret');
                    self.collapsed[slug] = self.collapsedStatus(slug);
                    self.syncTreeActive();
                    return;
                }
                var res = e.target.closest('.kb-result');
                if (res) {
                    self.openDoc(res.getAttribute('data-slug'), res.getAttribute('data-sec'), {});
                    self.closeSidebarMobile();
                    return;
                }
                var node = e.target.closest('.kb-tree-item');
                if (!node) return;
                var s = node.getAttribute('data-slug');
                var sec = node.getAttribute('data-sec') || '';
                if (sec) {
                    self._activeSection = sec;
                    self.syncTreeActive();
                    self.setHash(s, sec, false);
                    // hash 相同（同章节重复点击）时不会触发 hashchange，手动滚动
                    self.scrollToSection(sec, true);
                } else {
                    self.openDoc(s, '', {});
                }
                self.closeSidebarMobile();
            });

            // 欢迎页文档卡片 / 面包屑「知识库」/ 文档内锚点
            document.addEventListener('click', function (e) {
                var card = e.target.closest('.kb-doc-card');
                if (card) { self.openDoc(card.getAttribute('data-slug'), '', {}); return; }
                var home = e.target.closest('[data-home]');
                if (home) { e.preventDefault(); self.showWelcome(); return; }
                var anchor = e.target.closest('.h-anchor');
                if (anchor) {
                    // 复制锚点链接（同时保留默认跳转行为）
                    e.preventDefault();
                    var url = location.origin + location.pathname + '#/' + self.current.slug + '/' + anchor.getAttribute('href').slice(1);
                    self.copy(url);
                    self.setHash(self.current.slug, anchor.getAttribute('href').slice(1), false);
                    self.scrollToSection(anchor.getAttribute('href').slice(1), true);
                }
            });

            // 搜索
            var input = $('kbSearchInput');
            var timer = null;
            input.addEventListener('input', function () {
                clearTimeout(timer);
                var v = input.value;
                timer = setTimeout(function () { self.setQuery(v); }, 160);
            });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { input.value = ''; self.setQuery(''); input.blur(); }
                if (e.key === 'Enter') {
                    var first = $('kbTree').querySelector('.kb-result');
                    if (first) first.click();
                }
            });
            $('kbSearchClear').addEventListener('click', function () {
                input.value = '';
                self.setQuery('');
                input.focus();
            });
            document.addEventListener('keydown', function (e) {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                    e.preventDefault();
                    input.focus();
                    input.select();
                }
            });

            $('kbPrintBtn').addEventListener('click', function () { window.print(); });
            $('kbThemeBtn').addEventListener('click', function () { self.toggleTheme(); });
            $('kbMenuBtn').addEventListener('click', function () { self.toggleSidebarMobile(); });
            $('kbSidebarClose').addEventListener('click', function () { self.closeSidebarMobile(); });
            $('kbMask').addEventListener('click', function () { self.closeSidebarMobile(); });
        },

        showWelcome: function () {
            this.current = null;
            this._activeSection = '';
            $('kbDoc').style.display = 'none';
            $('kbWelcome').style.display = '';
            $('kbMain').scrollTop = 0;
            this.syncTreeActive();
            if (location.hash) this.setHash('', '', true);
            try { localStorage.removeItem(STATE_KEY); } catch (e) {}
        },

        ensureGoTop: function (show) {
            var btn = $('kbGoTop');
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'kb-gotop';
                btn.id = 'kbGoTop';
                btn.title = '回到顶部';
                btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
                btn.onclick = function () {
                    $('kbMain').scrollTo({top: 0, behavior: 'smooth'});
                };
                document.body.appendChild(btn);
            }
            var visible = show === undefined ? $('kbMain').scrollTop > 400 : show;
            btn.classList.toggle('show', !!visible);
        },

        toggleTheme: function () {
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            var next = isDark ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('theme', next); } catch (e) {}
            this.syncThemeIcon();
        },

        syncThemeIcon: function () {
            var dark = document.documentElement.getAttribute('data-theme') === 'dark';
            var i = $('kbThemeBtn') && $('kbThemeBtn').querySelector('i');
            if (i) i.className = dark ? 'fas fa-sun' : 'fas fa-moon';
        },

        toggleSidebarMobile: function () {
            var sb = $('kbSidebar');
            var open = sb.classList.toggle('open');
            $('kbMask').classList.toggle('show', open);
        },

        closeSidebarMobile: function () {
            $('kbSidebar').classList.remove('open');
            $('kbMask').classList.remove('show');
        },

        copy: function (text) {
            var self = this;
            var done = function () { self.toast('已复制锚点链接'); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(function () { self.copyFallback(text, done); });
            } else {
                this.copyFallback(text, done);
            }
        },

        copyFallback: function (text, done) {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                done();
            } catch (e) {
                this.toast('复制失败，请手动复制地址栏链接');
            }
        },

        toast: function (msg) {
            var el = $('kbToast');
            el.textContent = msg;
            el.classList.add('show');
            clearTimeout(el._t);
            el._t = setTimeout(function () { el.classList.remove('show'); }, 2000);
        },
    };

    window.kbApp = KB;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { KB.init(); });
    } else {
        KB.init();
    }
})();
