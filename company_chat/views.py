# -*- coding: utf-8 -*-
"""项目级视图"""
from django.conf import settings
from django.http import HttpResponse, Http404
from django.shortcuts import render
from loguru import logger


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

