# cloud/middleware.py

class OnlyOfficeMiddleware:
    """
    🔧 中间件：识别 OnlyOffice 请求并临时授权
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 🔧 识别 OnlyOffice 回调请求
        if (request.path.startswith('/api/cloud/documents/') and
                request.path.endswith('/callback/') and
                request.method == 'POST'):

            user_agent = request.META.get('HTTP_USER_AGENT', '').lower()
            if 'onlyoffice' in user_agent or 'documentserver' in user_agent:
                # 🔧 临时标记请求为"已认证"（仅用于权限检查）
                request._onlyoffice_callback = True

        return self.get_response(request)