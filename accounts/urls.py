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
)

router = DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'departments', DepartmentViewSet, basename='department')
router.register(r'admin/users', UserAdminViewSet, basename='admin-users')


urlpatterns = [
    path('', include(router.urls)),

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


    # 便捷的URL
    path('me/', UserViewSet.as_view({'get': 'me'}), name='user-me'),
    path('register/', UserViewSet.as_view({'post': 'register'}), name='user-register'),
    path('login/', UserViewSet.as_view({'post': 'login'}), name='user-login'),
    path('logout/', UserViewSet.as_view({'post': 'logout'}), name='user-logout'),
    # path('profile/', UserViewSet.as_view({'get': 'me', 'put': 'update_profile'}), name='user-profile'),
    path('profile/', UserViewSet.as_view({'put': 'update_profile', 'patch': 'update_profile'}), name='user-profile'),
    path('change-password/', UserViewSet.as_view({'post': 'change_password'}), name='user-change-password'),
    path('upload-avatar/', UserViewSet.as_view({'post': 'upload_avatar'}), name='user-upload-avatar'),
    path('list/', UserViewSet.as_view({'get': 'list_users'}), name='user-list'),
    path('search_users/', UserViewSet.as_view({'get': 'search_users'}), name='user-search'),
    path('online/', UserViewSet.as_view({'get': 'online_users'}), name='user-online'),
    path('<int:pk>/profile/', UserViewSet.as_view({'get': 'get_user_profile'}), name='user-profile-detail'),

    # 获取用户列表
    path('list/', UserViewSet.as_view({'get': 'list_users'}), name='user-list'),
    # 获取好友列表
    path('friends/', UserViewSet.as_view({'get': 'get_friends'}), name='user-friends'),
]
