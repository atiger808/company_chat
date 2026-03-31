# cloud/share_urls.py

from django.urls import path
from .views import ShareAccessView, ShareDownloadView

# 🔧 定义短链接路由模式
# 访问示例：http://yourdomain.com/s/AbCdEf123456
urlpatterns = [
    # 1. 分享详情页 (GET 请求显示页面，POST 请求验证密码)
    # name 设为 'share-short' 方便 reverse 解析
    path('<str:share_code>/', ShareAccessView.as_view(), name='share-short'),

    # 2. 直接下载链接 (可选，用于生成直接下载按钮)
    # 访问示例：http://yourdomain.com/s/AbCdEf123456/download/
    path('<str:share_code>/download/', ShareDownloadView.as_view(), name='share-short-download'),
]