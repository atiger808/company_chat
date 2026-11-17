# -*- coding: utf-8 -*-
# @File   :urls.py
# @Time   :2026/6/26 15:13
# @Author :admin


from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TaskViewSet
from .workorder_views import WorkOrderViewSet

router = DefaultRouter()
# 必须先注册 workorders，否则 /api/tasks/workorders/ 会被空前缀的 TaskViewSet 详情路由吞掉
router.register(r'workorders', WorkOrderViewSet, basename='workorder')
router.register(r'', TaskViewSet, basename='task')

urlpatterns = [
    path('', include(router.urls)),
]