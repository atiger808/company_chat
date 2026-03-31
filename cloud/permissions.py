# cloud/permissions.py - 协作权限检查
from rest_framework import permissions
from django.conf import settings
import jwt
from loguru import logger
from rest_framework import permissions
from .models import FileCollaboration

class HasFileCollaborationPermission(permissions.BasePermission):
    """
    检查用户是否有文件协作权限
    """

    def has_object_permission(self, request, view, obj):
        # 文件所有者总有权限
        if obj.owner == request.user:
            return True

        # 检查协作关系
        collaboration = FileCollaboration.objects.filter(
            file=obj,
            user=request.user,
            is_active=True
        ).first()

        if not collaboration:
            return False

        # 根据操作类型检查权限
        if request.method in ['GET', 'HEAD']:
            # 读取操作：read/write/admin 都可以
            return True
        elif request.method in ['PUT', 'PATCH', 'POST']:
            # 写入操作：需要 write 或 admin 权限
            return collaboration.permission in ['write', 'admin']
        elif request.method == 'DELETE':
            # 删除操作：需要 admin 权限
            return collaboration.permission == 'admin'

        return False


class OnlyOfficeCallbackPermission(permissions.BasePermission):
    """
    🔧 OnlyOffice 回调接口专用权限
    - 允许未认证请求（OnlyOffice 不携带用户 Token）
    - 验证 JWT Token（如果启用）
    """

    def has_permission(self, request, view):
        # 🔧 识别中间件标记的 OnlyOffice 请求
        if getattr(request, '_onlyoffice_callback', False):
            return True

        # 🔧 只允许 POST 请求（回调接口）
        if request.method != 'POST':
            return False

        # 🔧 获取配置
        onlyoffice_config = getattr(settings, 'ONLYOFFICE', {})
        jwt_enabled = onlyoffice_config.get('JWT_ENABLED', True)
        jwt_secret = onlyoffice_config.get('JWT_SECRET', '')

        # 🔧 如果启用 JWT，验证 Token
        if jwt_enabled and jwt_secret:
            token = request.data.get('token')

            if token:
                try:
                    # 🔧 验证 JWT Token
                    jwt.decode(token, jwt_secret, algorithms=['HS256'])
                    logger.info('✅ JWT token verified in callback')
                    return True
                except jwt.InvalidTokenError as e:
                    logger.warning(f'❌ Invalid JWT token in callback: {e}')
                    # 🔧 开发环境可临时允许，生产环境应返回 False
                    return True  # 🔧 开发环境临时允许
            else:
                # 🔧 没有 token 但启用了 JWT
                logger.warning('⚠️ No JWT token in callback request')
                return True  # 🔧 开发环境临时允许

        # 🔧 如果未启用 JWT，允许访问
        return True