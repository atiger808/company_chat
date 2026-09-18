"""
URL configuration for company_chat project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
# company_chat/urls.py
from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static
from .views import service_worker_view, admin_console_view
from oa.views import WatermarkViewSet, PrintLogViewSet
import sys


class AttendancePageView(TemplateView):
    """考勤页：额外把百度地图浏览器端 AK 交给前端（仅用于地图圈选考勤范围）。

    地图库只在「管理员/超管」页面里同步加载：普通员工根本用不到地图圈选，
    没必要为每个打卡的人加载地图库、更不该让他们遇到 AK 校验类报错。
    注意必须用同步 <script> 标签——百度地图 JS API 内部依赖 document.write，
    动态注入的脚本会报 "It isn't possible to write into a document from an
    asynchronously-loaded external script"，地图永远初始化不出来。
    """

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ak = getattr(settings, 'BAIDU_MAP_JS_AK', '') or ''
        ctx['baidu_map_js_ak'] = ak
        # 「显示考勤打卡范围配置」开关行是否暴露（.env: ATTENDANCE_GEO_VISIBLE_SWITCH，默认隐藏）
        ctx['att_geo_visible_switch'] = bool(getattr(settings, 'ATTENDANCE_GEO_VISIBLE_SWITCH', False))
        user = getattr(self.request, 'user', None)
        authed = bool(getattr(user, 'is_authenticated', False))
        # 配置端地图（考勤范围圈选）：仅管理员/超管
        can_use = bool(authed and getattr(user, 'user_type', '') in ('admin', 'super_admin'))
        ctx['baidu_map_can_use'] = can_use
        # 用户端地图（打卡时看自己在不在范围内）：只要该员工被启用了指定区域打卡就需要
        need_for_user = False
        if authed and not can_use:
            try:
                from org.models import UserDepartment
                from oa.views import AttendanceViewSet
                tenant = user.get_active_tenant()
                primary = UserDepartment.objects.filter(
                    user=user, is_primary=True).select_related('department').first()
                required, ranges, _ = AttendanceViewSet()._attendance_geo_config(
                    tenant, primary.department_id if primary else None, user)
                need_for_user = bool(required and ranges)
            except Exception:
                need_for_user = False
        ctx['baidu_map_needed_for_user'] = need_for_user
        # 需要时才同步加载地图库（百度地图依赖 document.write，不能用异步注入）
        ctx['baidu_map_load'] = bool(ak and (can_use or need_for_user))
        return ctx

urlpatterns = [
    path('admin/', admin.site.urls),

    # 🔧 PWA: 从根路径提供 Service Worker（扩大 scope 覆盖全站）
    path('service-worker.js', service_worker_view, name='service-worker'),

    # 🔧 认证相关
    path('api/auth/', include('accounts.urls')),

    # 🔧 聊天相关
    path('api/chat/', include('chat.urls')),

    # 任务与项目管理
    path('api/tasks/', include('tasks.urls')),  # 新增

    # OA办公（考勤打卡+审批）
    path('api/oa/', include('oa.urls')),
    # 企业水印配置（管理控制台维护 + 各页面加载渲染）
    path('api/system/watermark-config/', WatermarkViewSet.as_view({'get': 'config', 'post': 'save_config'}), name='watermark-config'),
    # 打印操作留痕
    path('api/system/print-log/', PrintLogViewSet.as_view({'post': 'create'}), name='print-log'),
    path('api/org/', include('org.urls')),
    path('org/', TemplateView.as_view(template_name='org/org.html'), name='org'),

    # 官网主页路由
    path('', TemplateView.as_view(template_name='index.html'), name='index'),
    path('contact/', TemplateView.as_view(template_name='contact.html'), name='contact'),
    path('docs/api/', TemplateView.as_view(template_name='docs/api_docs.html'), name='api_docs'),
    path('ByteDanceVerify.html', TemplateView.as_view(template_name='ByteDanceVerify.html'), name='ByteDanceVerify'),

    # 🔧 聊天页面路由
    path('chat/', TemplateView.as_view(template_name='chat/chat.html'), name='chat'),
    path('login/', TemplateView.as_view(template_name='chat/login.html'), name='login'),
    path('register/', TemplateView.as_view(template_name='chat/register.html'), name='register'),
    path('control/', admin_console_view, name='admin-control'),
    path('manifest.json', TemplateView.as_view(template_name='manifest.json', content_type='application/manifest+json'), name='manifest'),
    path('offline/', TemplateView.as_view(template_name='chat/offline.html'), name='offline'),


    # 任务与项目管理页面路由
    path('tasks/', TemplateView.as_view(template_name='tasks/tasks.html'), name='tasks'),

    # OA办公页面路由
    # 考勤页需要把「百度地图浏览器端 AK」交给前端（考勤范围地图圈选），故用带 context 的 TemplateView；
    # 未配置 AK 时前端自动降级为手填经纬度，不影响其它功能。
    path('oa/attendance/', AttendancePageView.as_view(template_name='oa/attendance.html'),
         name='oa-attendance'),
    path('oa/approval/', TemplateView.as_view(template_name='oa/approval.html'), name='oa-approval'),
    path('oa/subsidy/', TemplateView.as_view(template_name='oa/subsidy.html'), name='oa-subsidy'),
    path('oa/subsidy-verify/', TemplateView.as_view(template_name='oa/subsidy-verify.html'), name='oa-subsidy-verify'),
    path('oa/subsidy-pay/', TemplateView.as_view(template_name='oa/subsidy-pay.html'), name='oa-subsidy-pay'),
    path('oa/work-calendar/', TemplateView.as_view(template_name='oa/work-calendar.html'), name='oa-work-calendar'),
    path('oa/work-summary/', TemplateView.as_view(template_name='oa/work-summary.html'), name='oa-work-summary'),
    path('oa/announcements/', TemplateView.as_view(template_name='oa/announcement.html'), name='oa-announcements'),

    # 组织架构页面路由
    path('org/', TemplateView.as_view(template_name='org/org.html'), name='org'),

    # 网盘相关路由
    # 🔧 1. 企业网盘主页 (SPA 入口)
    path('cloud/', TemplateView.as_view(template_name='cloud/cloud.html'), name='cloud-home'),

    # 网盘登录页面
    path('cloud/login/', TemplateView.as_view(template_name='cloud/cloud_login.html'), name='cloud-login-page'),

    # 🔧 2. 【关键】文档编辑器页面路由（必须在 api/cloud/ 之前）
    path('cloud/editor/', TemplateView.as_view(template_name='cloud/cloud_editor.html'), name='cloud-editor'),

    path('cloud/settings/', TemplateView.as_view(template_name='cloud/cloud_settings.html'), name='cloud-settings'),


    # 🔧 3. 企业网盘 API（包含所有文档编辑相关接口）
    path('api/cloud/', include('cloud.urls')),

    # 🔧 4. 短链接分享路由
    # 所有以 /s/ 开头的请求都将交给 cloud.share_urls 处理
    path('s/', include('cloud.share_urls')),

]

if sys.platform != 'linux' and settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)


