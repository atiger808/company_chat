# -*- coding: utf-8 -*-
# @File   :urls.py
# @Time   :2026/2/3 15:14
# @Author :admin


# accounts/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    UserViewSet,
    DepartmentViewSet,
    AdminDashboardViewSet,
    UserAdminViewSet,
    DepartmentListViewSet,
    reset_password_page,
    ConsultationRequestView,
    TokenRefreshView,
    TokenVerifyView,
    AdminLoginLogViewSet,
    AdminOperationLogViewSet,
)

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'departments', DepartmentViewSet, basename='department')
router.register(r'admin/users', UserAdminViewSet, basename='admin-users')
router.register(r'admin/departments', DepartmentListViewSet, basename='admin-department')



urlpatterns = [
    path('', include(router.urls)),

    # 🔧 新增：密码重置相关接口
    path('request_password_reset/', UserViewSet.as_view({'post': 'request_password_reset'}),
         name='request_password_reset'),
    path('confirm_password_reset/', UserViewSet.as_view({'post': 'confirm_password_reset'}),
         name='confirm_password_reset'),

    # 🔧 新增：重置密码页面路由（前端页面渲染）
    path('reset-password/', reset_password_page, name='reset_password_page'),

    # 管理控制台
    path('admin/dashboard/', AdminDashboardViewSet.as_view({'get': 'statistics'}), name='admin-statistics'),
    path('admin/dashboard/recent-activities/', AdminDashboardViewSet.as_view({'get': 'recent_activities'}),
         name='admin-recent-activities'),
    path('admin/dashboard/online-users/', AdminDashboardViewSet.as_view({'get': 'online_users'}),
         name='admin-online-users'),


    # 用户管理
    path('admin/users/<int:pk>/reset-password/', UserAdminViewSet.as_view({'post': 'reset_password'}),
         name='admin-reset-password'),
    path('admin/users/<int:pk>/toggle-status/', UserAdminViewSet.as_view({'post': 'toggle_status'}),
         name='admin-toggle-status'),
    path('admin/users/batch-delete/', UserAdminViewSet.as_view({'post': 'batch_delete'}), name='admin-batch-delete'),
    path('admin/users/export/', UserAdminViewSet.as_view({'get': 'export'}), name='admin-export'),
    # 为用户分配好友
    path('admin/users/<int:pk>/assign-friends/', UserAdminViewSet.as_view({'post': 'assign_friends'}), name='admin-assign-friends'),
    # 获取用户的好友列表
    path('admin/users/<int:pk>/friends/', UserAdminViewSet.as_view({'get': 'get_friends'}), name='admin-get-friends'),

    # 登录日志
    path('admin/login-logs/', AdminLoginLogViewSet.as_view({'get': 'list'}), name='admin-login-logs'),
    path('admin/login-logs/<int:pk>/', AdminLoginLogViewSet.as_view({'get': 'retrieve'}), name='admin-login-log-detail'),  # 🔧 关键修复

    # 操作日志
    path('admin/operation-logs/', AdminOperationLogViewSet.as_view({'get': 'list'}), name='admin-operation-logs'),
    path('admin/operation-logs/<int:pk>/', AdminOperationLogViewSet.as_view({'get': 'retrieve'}), name='admin-operation-log-detail'),  # 🔧 关键修复

    # 便捷的URL
    path('me/', UserViewSet.as_view({'get': 'me'}), name='user-me'),

    path('register/', UserViewSet.as_view({'post': 'register'}), name='user-register'), # 关闭注册
    path('login/', UserViewSet.as_view({'post': 'login'}), name='user-login'),
    path('logout/', UserViewSet.as_view({'post': 'logout'}), name='user-logout'),

    # path('profile/', UserViewSet.as_view({'get': 'me', 'put': 'update_profile'}), name='user-profile'),
    path('profile/', UserViewSet.as_view({'put': 'update_profile', 'patch': 'update_profile'}), name='user-profile'),
    path('change-password/', UserViewSet.as_view({'post': 'change_password'}), name='user-change-password'),
    path('upload-avatar/', UserViewSet.as_view({'post': 'upload_avatar'}), name='user-upload-avatar'),
    path('search_users/', UserViewSet.as_view({'get': 'search_users'}), name='user-search'),
    path('search_assignees/', UserViewSet.as_view({'get': 'search_assignees'}), name='user-search-assignees'),
    path('online/', UserViewSet.as_view({'get': 'online_users'}), name='user-online'),
    path('<int:pk>/profile/', UserViewSet.as_view({'get': 'get_user_profile'}), name='user-profile-detail'),

    # 获取用户列表
    path('list/', UserViewSet.as_view({'get': 'list_users'}), name='user-list'),
    # 获取好友列表
    path('friends/', UserViewSet.as_view({'get': 'get_friends'}), name='user-friends'),
    path('friends/', DepartmentListViewSet.as_view({'get': 'get_friends'}), name='user-friends'),

    # 咨询提交接口
    path('contact/submit/', ConsultationRequestView.as_view(), name='contact-submit'),

    # Token 管理
    path('token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('token/verify/', TokenVerifyView.as_view(), name='token-verify'),
]
