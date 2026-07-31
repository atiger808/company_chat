# org/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'tenants', views.TenantViewSet, basename='tenant')
router.register(r'departments', views.DepartmentViewSet, basename='department')
router.register(r'org-chart', views.OrgChartViewSet, basename='org-chart')
router.register(r'change-logs', views.OrgChangeLogViewSet, basename='org-change-log')

user_dept_view = views.UserDepartmentViewSet.as_view({
    'get': 'departments',
})

urlpatterns = [
    path('', include(router.urls)),
    path('users/<int:pk>/departments/', views.UserDepartmentViewSet.as_view(
        {'get': 'departments', 'post': 'set_primary_dept'}
    ), name='user-departments'),
    path('users/<int:pk>/subordinates/', views.UserDepartmentViewSet.as_view(
        {'get': 'subordinates'}
    ), name='user-subordinates'),
    path('users/<int:pk>/set-supervisor/', views.UserDepartmentViewSet.as_view(
        {'post': 'set_supervisor'}
    ), name='user-set-supervisor'),
    path('users/<int:pk>/supervisors/', views.UserDepartmentViewSet.as_view(
        {'get': 'supervisors'}
    ), name='user-supervisors'),
]
