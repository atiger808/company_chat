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
import sys

urlpatterns = [
    path('admin/', admin.site.urls),

    # 🔧 认证相关
    path('api/auth/', include('accounts.urls')),

    # 🔧 聊天相关
    path('api/chat/', include('chat.urls')),

    # 任务与项目管理
    path('api/tasks/', include('tasks.urls')),  # 新增

    # 官网主页路由
    path('', TemplateView.as_view(template_name='index.html'), name='index'),
    path('contact/', TemplateView.as_view(template_name='contact.html'), name='contact'),
    path('docs/api/', TemplateView.as_view(template_name='docs/api_docs.html'), name='api_docs'),

    # 🔧 聊天页面路由
    path('chat/', TemplateView.as_view(template_name='chat/chat.html'), name='chat'),
    path('login/', TemplateView.as_view(template_name='chat/login.html'), name='login'),
    path('register/', TemplateView.as_view(template_name='chat/register.html'), name='register'),
    path('control/', TemplateView.as_view(template_name='chat/admin.html'), name='admin-control'),
    path('manifest.json', TemplateView.as_view(template_name='manifest.json',content_type='application/json'), name='manifest'),


    # 任务与项目管理页面路由
    path('tasks/', TemplateView.as_view(template_name='tasks/tasks.html'), name='tasks'),


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


