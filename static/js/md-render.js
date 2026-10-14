/**
 * 极简 Markdown 渲染器（企业知识库 / 使用手册共用）
 *
 * 设计要点：
 *  - 先整体 HTML 转义，再套用行内样式 → 天然防 XSS（文档里写 <script> 也只会显示文本）；
 *  - 标题生成稳定的锚点 id（Github 风格 slug，重复标题自动加后缀），并回传目录结构，
 *    供左侧树导航、本页目录与「点击标题复制锚点链接」使用；
 *  - 支持：标题、围栏代码块、表格(GFM)、有序/无序列表（含嵌套与任务列表）、
 *    引用、分割线、段落、行内 code/加粗/斜体/删除线/链接/图片、自动链接；
 *  - 纯函数：浏览器里挂到 window.MdRender，Node 里可直接 require（手册 HTML 生成脚本复用同一份逻辑）。
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.MdRender = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    function escapeHtml(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // 标题 → 锚点 id：保留中英文与数字，其余转 '-'，中文标题保持可读
    function slugify(text, used) {
        var base = String(text == null ? '' : text)
            .trim()
            .toLowerCase()
            .replace(/[\s　]+/g, '-')
            .replace(/[^\w一-龥\-.]/g, '')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '') || 'section';
        var id = base;
        var n = 2;
        while (used && used[id]) {
            id = base + '-' + n;
            n++;
        }
        if (used) used[id] = true;
        return id;
    }

    // 去掉 markdown 语法，得到纯文本（用于搜索索引/摘要）
    function plainText(md) {
        return String(md == null ? '' : md)
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/`([^`]*)`/g, '$1')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/^\s{0,3}#{1,6}\s+/gm, '')
            .replace(/^\s{0,3}>\s?/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/^\s*\d+[.)]\s+/gm, '')
            .replace(/[*_~]{1,3}/g, '')
            .replace(/\|/g, ' ')
            .replace(/^\s*[-=:]{3,}\s*$/gm, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // ---------- 行内样式 ----------
    function inline(text) {
        var t = escapeHtml(text);
        // 行内代码（先处理，避免里面的 * _ 被当成强调）
        var codes = [];
        t = t.replace(/`([^`]+)`/g, function (m, c) {
            codes.push(c);
            return 'MDCODE' + (codes.length - 1) + '';
        });
        // 图片（含 data-src 懒加载不需要，直接 src）
        t = t.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (m, alt, src, title) {
            return '<img src="' + src + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : '') + '>';
        });
        // 链接（http/https/mailto/站内绝对路径/锚点）
        t = t.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (m, label, href, title) {
            var ext = /^https?:/i.test(href);
            return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '')
                + (title ? ' title="' + title + '"' : '') + '>' + label + '</a>';
        });
        // 自动链接 <https://...>
        t = t.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, function (m, url) {
            return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
        });
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
        t = t.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<em>$2</em>');
        // 还原行内代码
        t = t.replace(/MDCODE(\d+)/g, function (m, i) {
            return '<code>' + codes[Number(i)] + '</code>';
        });
        return t;
    }

    function splitRow(line) {
        var s = String(line).trim();
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        return s.split('|').map(function (c) { return c.trim(); });
    }

    function isTableSep(line) {
        return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line || '');
    }

    /**
     * 渲染 markdown
     * @param {string} md 原始 markdown
     * @param {object} [opts] {headingAnchor:boolean 标题后是否输出 # 锚点}
     * @returns {{html:string, headings:Array, meta:object, title:string}}
     */
    function render(md, opts) {
        opts = opts || {};
        var showAnchor = opts.headingAnchor !== false;
        var raw = String(md == null ? '' : md).replace(/\r\n/g, '\n');

        // 前置 Front Matter（--- ... ---）：抽出 title，正文不渲染它
        var meta = {};
        var fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
        if (fm) {
            fm[1].split('\n').forEach(function (line) {
                var m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
                if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
            });
            raw = raw.slice(fm[0].length);
        }

        var lines = raw.split('\n');
        var html = '';
        var headings = [];
        var used = {};
        var i = 0;

        var listStack = [];   // {type:'ul'|'ol', indent:number}
        function closeLists(toIndent) {
            while (listStack.length && listStack[listStack.length - 1].indent >= (toIndent == null ? 0 : toIndent)) {
                html += '</' + listStack.pop().type + '>';
            }
        }
        function closeAllLists() { closeLists(0); }

        while (i < lines.length) {
            var line = lines[i];

            // 围栏代码块
            var fence = /^\s*(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
            if (fence) {
                closeAllLists();
                var closeRe = new RegExp('^\\s*' + fence[1] + '\\s*$');
                var buf = [];
                i++;
                while (i < lines.length && !closeRe.test(lines[i])) { buf.push(lines[i]); i++; }
                i++; // 跳过结束围栏
                var lang = fence[2] ? ' class="language-' + fence[2] + '"' : '';
                html += '<pre><code' + lang + '>' + escapeHtml(buf.join('\n')) + '</code></pre>';
                continue;
            }

            // 标题
            var h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
            if (h) {
                closeAllLists();
                var level = h[1].length;
                var text = h[2];
                var id = slugify(plainText(text) || text, used);
                headings.push({ id: id, level: level, text: plainText(text) || text });
                html += '<h' + level + ' id="' + id + '">' + inline(text)
                    + (showAnchor ? '<a class="h-anchor" href="#' + id + '" aria-label="锚点链接">#</a>' : '')
                    + '</h' + level + '>';
                i++;
                continue;
            }

            // 分割线
            if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
                closeAllLists();
                html += '<hr>';
                i++;
                continue;
            }

            // 表格
            if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
                closeAllLists();
                var head = splitRow(line);
                var aligns = splitRow(lines[i + 1]).map(function (c) {
                    if (/^:.*:$/.test(c)) return 'center';
                    if (/:$/.test(c)) return 'right';
                    return 'left';
                });
                i += 2;
                var rows = [];
                while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
                var thead = '<thead><tr>' + head.map(function (c, k) {
                    return '<th style="text-align:' + (aligns[k] || 'left') + '">' + inline(c) + '</th>';
                }).join('') + '</tr></thead>';
                var tbody = '<tbody>' + rows.map(function (r) {
                    return '<tr>' + head.map(function (_, k) {
                        return '<td style="text-align:' + (aligns[k] || 'left') + '">' + inline(r[k] || '') + '</td>';
                    }).join('') + '</tr>';
                }).join('') + '</tbody>';
                html += '<table>' + thead + tbody + '</table>';
                continue;
            }

            // 引用
            if (/^\s*>/.test(line)) {
                closeAllLists();
                var quote = [];
                while (i < lines.length && /^\s*>/.test(lines[i])) {
                    quote.push(lines[i].replace(/^\s*>\s?/, ''));
                    i++;
                }
                html += '<blockquote>' + inline(quote.join('\n')).replace(/\n/g, '<br>') + '</blockquote>';
                continue;
            }

            // 列表（含嵌套与任务列表）
            var li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
            if (li) {
                var indent = Math.floor(li[1].replace(/\t/g, '    ').length / 2);
                var type = /^[-*+]$/.test(li[2]) ? 'ul' : 'ol';
                var content = li[3];
                // 缩进变浅 → 关闭更深的列表
                while (listStack.length && listStack[listStack.length - 1].indent > indent) {
                    html += '</' + listStack.pop().type + '>';
                }
                // 缩进变深 → 新开一层
                if (!listStack.length || indent > listStack[listStack.length - 1].indent) {
                    listStack.push({ type: type, indent: indent });
                    html += '<' + type + '>';
                } else if (listStack[listStack.length - 1].type !== type) {
                    html += '</' + listStack.pop().type + '>';
                    listStack.push({ type: type, indent: indent });
                    html += '<' + type + '>';
                }
                var task = /^\[([ xX])\]\s+(.*)$/.exec(content);
                if (task) {
                    html += '<li class="md-task">'
                        + '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> '
                        + inline(task[2]) + '</li>';
                } else {
                    html += '<li>' + inline(content) + '</li>';
                }
                i++;
                continue;
            }
            closeAllLists();

            // 空行
            if (!line.trim()) { i++; continue; }

            // 段落（连续非空行合并，行内换行保留为 <br>）
            var para = [line];
            i++;
            while (i < lines.length) {
                var nx = lines[i];
                if (!nx.trim()
                    || /^\s*(```|~~~)/.test(nx)
                    || /^#{1,6}\s/.test(nx)
                    || /^\s*>/.test(nx)
                    || /^(\s*)([-*+]|\d+[.)])\s+/.test(nx)
                    || /^\s*\|/.test(nx)
                    || /^\s*([-*_])\s*(\1\s*){2,}$/.test(nx)) break;
                para.push(nx);
                i++;
            }
            html += '<p>' + para.map(function (x) { return inline(x); }).join('<br>') + '</p>';
        }
        closeAllLists();

        var title = meta.title || (headings.length ? headings[0].text : '');
        return { html: html, headings: headings, meta: meta, title: title };
    }

    return {
        render: render,
        inline: inline,
        slugify: slugify,
        plainText: plainText,
        escapeHtml: escapeHtml,
    };
});
