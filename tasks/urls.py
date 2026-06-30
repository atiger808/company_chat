# -*- coding: utf-8 -*-
# @File   :urls.py
# @Time   :2026/6/26 15:13
# @Author :admin


from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TaskViewSet

router = DefaultRouter()
router.register(r'', TaskViewSet, basename='task')

urlpatterns = [
    path('', include(router.urls)),
]