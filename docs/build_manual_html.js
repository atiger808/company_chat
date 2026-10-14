#!/usr/bin/env node
/**
 * 员工使用手册 HTML 生成脚本
 *
 * 复用 static/js/md-render.js（浏览器/Node 共用的 Markdown 渲染器），
 * 把「浙企钉-员工使用手册.md」渲染成带目录、锚点与打印样式的独立 HTML。
 *
 * 用法：
 *   node docs/build_manual_html.js
 *   # 或在 docs 目录下：node build_manual_html.js
 *
 * 产物：docs/浙企钉-员工使用手册.html（内联 浙企钉-员工使用手册.css）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DOCS_DIR = __dirname;
const ROOT_DIR = path.resolve(DOCS_DIR, '..');

const MD_FILE = path.join(DOCS_DIR, '浙企钉-员工使用手册.md');
const CSS_FILE = path.join(DOCS_DIR, '浙企钉-员工使用手册.css');
const OUT_FILE = path.join(DOCS_DIR, '浙企钉-员工使用手册.html');
const MdRender = require(path.join(ROOT_DIR, 'static', 'js', 'md-render.js'));

function readUtf8(file) {
    return fs.readFileSync(file, 'utf8');
}

// 由渲染出的 headings 生成目录（只取 h2 / h3，对应「一、xxx」与「1.1 xxx」）
function buildToc(headings) {
    let html = '';
    let openSub = false;   // 当前顶层的子 <ul> 是否打开
    let openLi = false;    // 当前顶层 <li> 是否打开
    headings.forEach(function (h) {
        if (h.level === 2) {
            if (openSub) { html += '</ul>'; openSub = false; }
            if (openLi) { html += '</li>\n'; }
            html += '<li><a href="#' + h.id + '">' + MdRender.escapeHtml(h.text) + '</a>';
            openLi = true;
        } else if (h.level === 3) {
            if (!openSub) { html += '\n<ul>\n'; openSub = true; }
            html += '<li><a href="#' + h.id + '">' + MdRender.escapeHtml(h.text) + '</a></li>\n';
        }
    });
    if (openSub) html += '</ul>';
    if (openLi) html += '</li>\n';
    return '<nav id="TOC" role="doc-toc">\n<ul>\n' + html + '</ul>\n</nav>';
}

function main() {
    if (!fs.existsSync(MD_FILE)) {
        console.error('找不到手册 Markdown 文件：' + MD_FILE);
        process.exit(1);
    }
    const md = readUtf8(MD_FILE);
    const css = fs.existsSync(CSS_FILE) ? readUtf8(CSS_FILE) : '';
    const result = MdRender.render(md, { headingAnchor: false });
    const title = result.title || '企业协同办公平台 · 员工使用手册';

    const html = [
        '<!DOCTYPE html>',
        '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN" xml:lang="zh-CN">',
        '<head>',
        '  <meta charset="utf-8" />',
        '  <meta name="generator" content="md-render.js" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes" />',
        '  <title>' + MdRender.escapeHtml(title) + '</title>',
        '  <style>',
        css,
        '  </style>',
        '</head>',
        '<body>',
        '<header id="title-block-header">',
        '<h1 class="title">' + MdRender.escapeHtml(title) + '</h1>',
        '</header>',
        buildToc(result.headings),
        result.html,
        '</body>',
        '</html>',
        '',
    ].join('\n');

    fs.writeFileSync(OUT_FILE, html, 'utf8');
    console.log('已生成：' + OUT_FILE);
    console.log('  标题数：' + result.headings.length + '  字节数：' + Buffer.byteLength(html, 'utf8'));
}

main();
