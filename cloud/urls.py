# cloud/urls.py - 网盘路由

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    FolderViewSet,
    CloudFileViewSet,
    FileShareViewSet,
    FileCommentViewSet,
    CloudDashboardViewSet,
    ShareAccessView,  # ✅ 导入分享访问视图
    share_access_api,  # ✅ 导入 API 版本
    CloudFileDownloadView,
    DocumentEditorViewSet,
)

router = DefaultRouter()
router.register(r'folders', FolderViewSet, basename='cloud-folder')
router.register(r'files', CloudFileViewSet, basename='cloud-file')
router.register(r'shares', FileShareViewSet, basename='cloud-share')
router.register(r'comments', FileCommentViewSet, basename='cloud-comment')
router.register(r'dashboard', CloudDashboardViewSet, basename='cloud-dashboard')
router.register(r'documents', DocumentEditorViewSet, basename='document')

urlpatterns = [
    path('', include(router.urls)),

    # 🔧 独立的文件下载视图
    path('cloudfiles/<uuid:file_id>/download_file/', CloudFileDownloadView.as_view(), name='cloud-file-download'),

    # 🔧 分享链接访问（HTML 页面）- 不需要 /api/ 前缀
    path('share/<str:share_code>/', ShareAccessView.as_view(), name='cloud-share-access'),
    path('share/<str:share_code>/download/', ShareAccessView.as_view(), name='cloud-share-download'),

    # 🔧 分享链接访问 API 版本
    # path('api/share/<str:share_code>/', share_access_api, name='cloud-share-access-api'),


]
