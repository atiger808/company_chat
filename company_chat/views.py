# -*- coding: utf-8 -*-
"""项目级视图"""
from datetime import datetime

from django.conf import settings
from django.http import HttpResponse, Http404
from django.shortcuts import render
from django.utils import timezone
from loguru import logger
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView


def is_admin_user(user):
    """是否为管理员 / 超级管理员（管理控制台权限）。

    判断标准：CustomUser.user_type 字段 —— 仅 admin / super_admin 有权限。
    不依赖模型方法（避免服务器上旧版 is_admin_or_higher() 误判导致只有 root 能进）。
    """
    if not user or not user.is_authenticated:
        return False
    return getattr(user, 'user_type', '') in ('admin', 'super_admin')


def admin_console_view(request):
    """管理控制台页面。

    本项目使用 JWT（存于前端 localStorage）认证，页面导航（GET /control/）不会携带
    JWT 到后端，因此 request.user 恒为匿名，无法在此校验登录/权限。
    故这里只渲染页面壳，登录与管理员权限由前端 admin.js 执行：
      - 未登录 → 跳转登录页；
      - 非管理员 → 提示「没有访问权限」并跳回聊天室。
    管理控制台相关 API 已由后端 DRF 权限类（IsAdminUserManagement 等）保护，
    普通用户即使加载到页面也无法拉取任何管理数据。
    """
    return render(request, 'chat/admin.html')

def _find_service_worker():
    """在可能的目录中查找 service-worker.js，兼容不同部署的静态目录配置"""
    candidates = []
    base = settings.BASE_DIR
    candidates.append(base / 'static' / 'js' / 'service-worker.js')
    sr = getattr(settings, 'STATIC_ROOT', None)
    if sr:
        candidates.append(sr / 'js' / 'service-worker.js')
    for d in getattr(settings, 'STATICFILES_DIRS', []) or []:
        candidates.append(d / 'js' / 'service-worker.js')
    for p in candidates:
        try:
            content = p.read_text(encoding='utf-8')
            if content.strip():
                return content
        except (OSError, UnicodeDecodeError):
            continue
    return None


def knowledge_base_view(request):
    """知识库（在线文档）页面壳。

    公开页面：为方便企业智能体（AI 助手）检索，未登录用户也可直接打开，
    页面内容接口 /api/docs/catalog/ 同为 AllowAny，仅暴露 docs/ 白名单内的文档。
    """
    return render(request, 'docs/knowledge.html')


def service_worker_view(request):
    """从根路径提供 Service Worker。

    若 SW 放在 /static/js/ 下，其 scope 会被限制为 /static/js/，
    无法拦截 /chat/、/offline/、/static/css/ 等导航与缓存请求。
    通过根路径 + Service-Worker-Allowed 头把 scope 提升为全站。
    """
    content = _find_service_worker()
    logger.debug(f'service-worker.js  ::{content}')
    if content is None:
        logger.warning('service-worker.js not found')
        raise Http404('service-worker.js not found')
    response = HttpResponse(content, content_type='application/javascript; charset=utf-8')
    response['Service-Worker-Allowed'] = '/'
    response['Cache-Control'] = 'no-cache'
    return response


# ==================== 企业知识库（在线文档） ====================
# 知识库文档目录：白名单式声明，只读取 docs/ 下这些文件（避免路径穿越），
# 文档内容直接来自仓库内的 Markdown，新增文档只需在这里加一条。
KNOWLEDGE_DOCS = [
    {
        'name': '平台使用',
        'icon': 'fa-book-open',
        'docs': [
            {
                'slug': 'manual',
                'title': '员工使用手册',
                'desc': '各模块使用说明、限制速查与常见问题',
                'file': '浙企钉-员工使用手册.md',
                'public': True,
            },
        ],
    },
    {
        'name': '研发与运维',
        'icon': 'fa-code',
        'docs': [
            {
                'slug': 'structure',
                'title': '项目结构文档',
                'desc': '目录结构、模块职责、数据库模型与 API 汇总',
                'file': '浙企钉-企业协同办公平台 · 项目结构文档.md',
                'public': False,
            },
            {
                'slug': 'auto-backup',
                'title': '项目文件自动备份功能',
                'desc': '增量备份系统与定时任务说明',
                'file': '项目文件自动备份功能.md',
                'public': False,
            },
        ],
    },
    {
        'name': '第三方接口',
        'icon': 'fa-plug',
        'docs': [
            {
                'slug': 'baidu-invoice',
                'title': '百度增值税发票验真接口',
                'desc': '验真接口的请求参数与返回结构',
                'file': '百度增值税发票验真接口文档.md',
                'public': True,
            },
        ],
    },
]


class KnowledgeCatalogView(APIView):
    """知识库目录 + 文档内容（一次性返回，前端本地做树/锚点/全文搜索）。

    公开可读（AllowAny）：为方便企业智能体（AI 助手）检索知识库内容，
    未登录用户也能访问该接口与知识库页面；仅暴露 docs/ 白名单内的文档，
    不涉及任何业务数据。
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        docs_dir = settings.BASE_DIR / 'docs'
        is_authed = bool(getattr(request.user, 'is_authenticated', False))
        groups = []
        total = 0
        restricted = 0
        for group in KNOWLEDGE_DOCS:
            docs = []
            for item in group['docs']:
                # 架构 / 内部类文档需登录后查看；未登录只返回标记为 public 的文档
                if not is_authed and not item.get('public', False):
                    restricted += 1
                    continue
                doc = {
                    'slug': item['slug'],
                    'title': item['title'],
                    'desc': item.get('desc', ''),
                    'content': '',
                    'updated_at': '',
                }
                try:
                    path = docs_dir / item['file']
                    doc['content'] = path.read_text(encoding='utf-8')
                    doc['updated_at'] = datetime.fromtimestamp(
                        path.stat().st_mtime).strftime('%Y-%m-%d')
                except (OSError, UnicodeDecodeError) as e:
                    logger.warning(f'知识库文档读取失败 {item["file"]}: {e}')
                    doc['error'] = '文档读取失败，请联系管理员'
                doc['size'] = len(doc['content'])
                total += 1
                docs.append(doc)
            if docs:  # 未登录时若某分组下全是内部文档，则不显示空分组
                groups.append({
                    'name': group['name'],
                    'icon': group.get('icon', 'fa-file-lines'),
                    'docs': docs,
                })
        return Response({
            'groups': groups,
            'doc_count': total,
            'restricted_count': restricted,   # 需登录后可见的内部文档数量（供前端提示）
            'generated_at': timezone.now().isoformat(),
        })

