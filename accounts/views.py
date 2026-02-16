# accounts/views.py
from rest_framework.exceptions import ValidationError
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
# 生成 JWT token
from rest_framework_simplejwt.tokens import RefreshToken

from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from django.contrib.auth import logout
from django.db.models import Q
from .models import CustomUser, Department
from chat.models import ChatRoom
from loguru import logger

from .serializers import (
    UserSerializer,
    UserDetailSerializer,
    AdminUserCreateSerializer,
    AdminProfileUpdateSerializer,
    DepartmentSerializer,

    RegisterSerializer,
    LoginSerializer,
    ChangePasswordSerializer,
    UserProfileUpdateSerializer,
    UserListSerializer,
    AvatarUploadSerializer
)


class IsAdminOrSuperAdmin(permissions.BasePermission):
    """管理员或超级管理员权限"""

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.user_type in ['admin', 'super_admin']


class AdminDashboardViewSet(viewsets.ViewSet):
    """管理员控制台视图集"""
    permission_classes = [IsAdminOrSuperAdmin]

    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """获取统计数据"""
        total_users = CustomUser.objects.count()
        online_users = CustomUser.objects.filter(is_online=True).count()
        total_chat_rooms = ChatRoom.objects.count()
        active_chat_rooms = ChatRoom.objects.filter(
            messages__timestamp__gte=timezone.now() - timezone.timedelta(days=7)
        ).distinct().count()

        return Response({
            'total_users': total_users,
            'online_users': online_users,
            'total_chat_rooms': total_chat_rooms,
            'active_chat_rooms': active_chat_rooms,
            'new_users_today': CustomUser.objects.filter(
                date_joined__date=timezone.now().date()
            ).count(),
        })

    @action(detail=False, methods=['get'])
    def recent_activities(self, request):
        """获取最近活动"""
        from chat.models import UserActivity

        activities = UserActivity.objects.select_related('user').order_by('-created_at')[:20]

        data = [{
            'user': activity.user.username,
            'action': activity.get_action_display(),
            'description': activity.description,
            'ip_address': activity.ip_address,
            'created_at': activity.created_at.isoformat(),
        } for activity in activities]

        return Response(data)

    @action(detail=False, methods=['get'])
    def online_users(self, request):
        """获取在线用户列表"""
        users = CustomUser.objects.filter(is_online=True).select_related('department')

        data = [{
            'id': user.id,
            'username': user.username,
            'real_name': user.real_name,
            'avatar_url': user.get_avatar_url(),
            'department': user.department.name if user.department else None,
            'position': user.position,
            'last_seen': user.last_seen.isoformat() if user.last_seen else None,
        } for user in users]

        return Response(data)


class UserAdminViewSet(viewsets.ModelViewSet):
    """用户管理视图集（管理员专用）"""
    queryset = CustomUser.objects.all()
    serializer_class = UserDetailSerializer
    permission_classes = [IsAdminOrSuperAdmin]

    def handle_exception(self, exc):
        """统一异常处理"""
        response = super().handle_exception(exc)

        # 自定义错误信息格式
        if response is not None:
            if isinstance(exc, ValidationError):
                return Response({
                    'message': str(exc.detail),
                    'detail': str(exc.detail),
                    'code': 'validation_error'
                }, status=response.status_code)
            elif isinstance(exc, ObjectDoesNotExist):
                return Response({
                    'message': '资源不存在',
                    'detail': str(exc),
                    'code': 'not_found'
                }, status=response.status_code)
            elif hasattr(exc, 'detail'):
                return Response({
                    'message': str(exc.detail),
                    'code': 'error'
                }, status=response.status_code)

        return response

    def get_serializer_class(self):
        """根据不同操作返回不同的序列化器"""
        if self.action == 'create':
            # 创建用户时使用 AdminUserCreateSerializer
            return AdminUserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            # 更新用户时使用 AdminProfileUpdateSerializer
            return AdminProfileUpdateSerializer
        return super().get_serializer_class()

    def get_queryset(self):
        queryset = super().get_queryset()

        # 支持搜索
        search = self.request.query_params.get('search', '')
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search) |
                Q(real_name__icontains=search) |
                Q(email__icontains=search) |
                Q(phone__icontains=search) |
                Q(department__name__icontains=search) |
                Q(position__icontains=search)
            )

        # 支持按用户类型过滤
        user_type = self.request.query_params.get('user_type', '')
        if user_type:
            queryset = queryset.filter(user_type=user_type)

        # 支持按部门过滤
        department = self.request.query_params.get('department', '')
        if department:
            queryset = queryset.filter(department_id=department)

        return queryset.order_by('-date_joined')



    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """重置用户密码"""
        user = self.get_object()
        new_password = request.data.get('password', '123456')

        user.set_password(new_password)
        user.save()

        return Response({
            'message': '密码已重置',
            'default_password': new_password
        })

    @action(detail=True, methods=['post'])
    def toggle_status(self, request, pk=None):
        """启用/禁用用户"""
        user = self.get_object()
        user.is_active = not user.is_active
        user.save()

        return Response({
            'message': f'用户已{"启用" if user.is_active else "禁用"}',
            'is_active': user.is_active
        })

    @action(detail=False, methods=['post'])
    def batch_delete(self, request):
        """批量删除用户"""
        user_ids = request.data.get('user_ids', [])

        if not user_ids:
            return Response(
                {'error': '请选择要删除的用户'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 防止删除自己
        if request.user.id in user_ids:
            return Response(
                {'error': '不能删除自己'},
                status=status.HTTP_400_BAD_REQUEST
            )

        deleted_count = CustomUser.objects.filter(id__in=user_ids).delete()[0]

        return Response({
            'message': f'成功删除 {deleted_count} 个用户',
            'deleted_count': deleted_count
        })


    # 删除操作，如果是管理员，则允许删除，不能删除自己
    def destroy(self, request, *args, **kwargs):
        """删除用户"""
        logger.info(f'{request.user} 删除了用户 {self.get_object()}')

        user = self.get_object()
        if user.id == request.user.id:
            return Response(
                {'error': '不能删除自己'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return super().destroy(request, *args, **kwargs)


    @action(detail=False, methods=['get'])
    def export(self, request):
        """导出用户数据"""
        from django.http import HttpResponse
        import csv

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="users.csv"'

        writer = csv.writer(response)
        writer.writerow(['ID', '用户名', '真实姓名', '邮箱', '手机号', '部门', '职位', '用户类型', '注册时间'])

        users = self.get_queryset()
        for user in users:
            writer.writerow([
                user.id,
                user.username,
                user.real_name or '',
                user.email,
                user.phone or '',
                user.department.name if user.department else '',
                user.position or '',
                user.user_type,
                user.date_joined.strftime('%Y-%m-%d %H:%M:%S')
            ])

        return response


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def handle_exception(self, exc):
        """统一异常处理"""
        response = super().handle_exception(exc)

        # 自定义错误信息格式
        if response is not None:
            if isinstance(exc, ValidationError):
                return Response({
                    'message': str(exc.detail),
                    'detail': str(exc.detail),
                    'code': 'validation_error'
                }, status=response.status_code)
            elif isinstance(exc, ObjectDoesNotExist):
                return Response({
                    'message': '资源不存在',
                    'detail': str(exc),
                    'code': 'not_found'
                }, status=response.status_code)
            elif hasattr(exc, 'detail'):
                return Response({
                    'message': str(exc.detail),
                    'code': 'error'
                }, status=response.status_code)

        return response


    def list(self, request):
        queryset = self.get_queryset()
        name = request.query_params.get('name', '')
        if name:
            queryset = queryset.filter(name=name)

        # 分页返回
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)



class UserViewSet(viewsets.ModelViewSet):
    queryset = CustomUser.objects.all()
    serializer_class = UserDetailSerializer
    permission_classes = [permissions.IsAuthenticated]

    # def handle_exception(self, exc):
    #     """统一异常处理"""
    #     response = super().handle_exception(exc)
    #
    #     # 自定义错误信息格式
    #     if response is not None:
    #         if isinstance(exc, ValidationError):
    #             return Response({
    #                 'message': str(exc.detail),
    #                 'detail': str(exc.detail),
    #                 'code': 'validation_error'
    #             }, status=response.status_code)
    #         elif isinstance(exc, ObjectDoesNotExist):
    #             return Response({
    #                 'message': '资源不存在',
    #                 'detail': str(exc),
    #                 'code': 'not_found'
    #             }, status=response.status_code)
    #         elif hasattr(exc, 'detail'):
    #             return Response({
    #                 'message': str(exc.detail),
    #                 'code': 'error'
    #             }, status=response.status_code)
    #
    #     return response


    def get_serializer_class(self):

        if self.action == 'register':
            return RegisterSerializer
        elif self.action == 'login':
            return LoginSerializer
        elif self.action == 'change_password':
            return ChangePasswordSerializer
        elif self.action in ['update_profile', 'partial_update']:
            if self.request.user.user_type in ['admin', 'super_admin']:
                return AdminProfileUpdateSerializer
            return UserProfileUpdateSerializer
        elif self.action == 'upload_avatar':
            return AvatarUploadSerializer
        elif self.action in ['list', 'search_users', 'list_users']:
            return UserListSerializer

        return UserDetailSerializer

    def get_queryset(self):
        """返回当前用户可见的用户列表（通讯录）"""
        # 排除当前用户自身和未激活用户
        return CustomUser.objects.filter(
            is_active=True
        ).exclude(
            id=self.request.user.id
        ).select_related('department')

    def get_permissions(self):
        if self.action in ['register', 'login']:
            return [permissions.AllowAny()]
        elif self.action in ['me', 'update_profile', 'change_password', 'logout', 'partial_update']:
            return [permissions.IsAuthenticated()]
        elif self.action in ['list', 'retrieve', 'search_users', 'list_users', 'get_user_profile']:
            return [permissions.IsAuthenticated()]
        elif self.action in ['create', 'destroy', 'promote_user', 'demote_user']:
            return [IsAdminOrSuperAdmin()]

        return super().get_permissions()

    @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
    def register(self, request):
        """用户注册"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        refresh = RefreshToken.for_user(user)

        return Response({
            'user': UserDetailSerializer(user, context={'request': request}).data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'message': '注册成功'
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
    def login(self, request):
        """用户登录"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data['user']
        refresh = RefreshToken.for_user(user)

        return Response({
            'user': UserDetailSerializer(user, context={'request': request}).data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'message': '登录成功'
        })

    @action(detail=False, methods=['post'])
    def logout(self, request):
        """用户登出"""
        # 更新在线状态
        request.user.update_online_status(False)

        # Django logout
        logout(request)

        return Response({
            'message': '登出成功'
        })

    @action(detail=False, methods=['get'])
    def me(self, request):
        """获取当前用户信息"""
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def get_user_profile(self, request, pk=None):
        """获取指定用户的详细信息"""
        try:
            user = self.get_object()
            # 普通用户只能查看基本信息，管理员可以查看完整信息
            if request.user.user_type in ['admin', 'super_admin'] or request.user.id == user.id:
                serializer = UserDetailSerializer(user, context={'request': request})
            else:
                # 普通用户只能查看有限信息
                limited_data = {
                    'id': user.id,
                    'username': user.username,
                    'real_name': user.real_name,
                    'gender': user.gender,
                    'phone': user.phone,
                    'email': user.email,
                    'avatar_url': user.get_avatar_url(),
                    'department': user.department.name if user.department else None,
                    'position': user.position,
                    'is_online': user.is_online,
                    'last_seen': user.last_seen,  # 最新活跃时间
                    'date_joined': user.date_joined,
                    'last_login': user.last_login,  # 最后登录时间
                    'user_type': user.user_type
                }
                return Response(limited_data)

            return Response(serializer.data)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['put', 'patch'])
    def update_profile(self, request):
        """更新用户资料"""

        logger.info(f'request.user: {request.user} request.data: {request.data}')

        if request.user.user_type in ['admin', 'super_admin']:
            serializer = AdminProfileUpdateSerializer(
                request.user, data=request.data, partial=True
            )
        else:
            # 普通用户只能更新基本信息
            allowed_fields = {'real_name', 'email', 'phone', 'gender', 'bio', 'avatar'}
            filtered_data = {k: v for k, v in request.data.items() if k in allowed_fields}
            serializer = UserProfileUpdateSerializer(
                request.user, data=filtered_data, partial=True
            )

        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserDetailSerializer(request.user, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def list_users(self, request):
        """
        通讯录用户列表（优化版）
        - 返回所有活跃用户（排除自己）
        - 按部门分组
        - 支持分页
        """
        queryset = self.get_queryset().order_by('department__name', 'real_name')

        # 分页处理
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def search_users(self, request):
        """
        搜索用户（通讯录）- 支持按用户名、真实姓名、部门、职位、邮箱搜索
        """
        query = request.query_params.get('q', '').strip()

        if not query:
            return Response([])

        # 排除当前用户，按多个维度搜索
        queryset = CustomUser.objects.filter(
            Q(username__icontains=query) |
            Q(real_name__icontains=query) |
            Q(email__icontains=query) |
            Q(phone__icontains=query) |
            Q(department__name__icontains=query) |
            Q(position__icontains=query),
            is_active=True  # 只搜索活跃用户
        ).exclude(
            id=request.user.id  # 排除自己
        ).select_related('department').order_by('-is_online', '-last_login')  # 在线用户优先

        # 分页处理
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def promote_user(self, request, pk=None):
        """提升用户权限"""
        user = self.get_object()
        user_type = request.data.get('user_type')
        if user_type not in ['admin', 'super_admin']:
            return Response({'error': '无效的用户类型'}, status=status.HTTP_400_BAD_REQUEST)
        user.user_type = user_type
        user.save()
        return Response({'message': '用户权限已更新'})

    @action(detail=True, methods=['post'])
    def demote_user(self, request, pk=None):
        """降级用户权限"""
        user = self.get_object()
        user.user_type = 'normal'
        user.save()
        return Response({'message': '用户权限已降级'})

# class UserViewSet(viewsets.ModelViewSet):
#     """用户视图集"""
#
#     queryset = CustomUser.objects.all()
#     serializer_class = UserSerializer
#
#     # 默认权限：只有登录用户才能访问（除特殊操作外）
#     permission_classes = [permissions.IsAuthenticated]
#
#     def get_permissions(self):
#         """
#         为不同操作设置不同权限
#         """
#         if self.action in ['register', 'login']:
#             # 注册和登录不需要认证
#             return [permissions.AllowAny()]
#         elif self.action in ['me', 'update_profile', 'change_password', 'logout']:
#             # 这些操作需要认证
#             return [permissions.IsAuthenticated()]
#         return super().get_permissions()
#
#     def get_serializer_class(self):
#         """根据不同的action返回不同的序列化器"""
#         if self.action == 'register':
#             return RegisterSerializer
#         elif self.action == 'login':
#             return LoginSerializer
#         elif self.action == 'change_password':
#             return ChangePasswordSerializer
#         elif self.action in ['update_profile', 'partial_update']:
#             return UserProfileUpdateSerializer
#         elif self.action == 'upload_avatar':
#             return AvatarUploadSerializer
#         elif self.action == 'list_users':
#             return UserListSerializer
#         return UserSerializer
#
#     @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
#     def register(self, request):
#         """用户注册"""
#         serializer = self.get_serializer(data=request.data)
#         serializer.is_valid(raise_exception=True)
#         user = serializer.save()
#
#         refresh = RefreshToken.for_user(user)
#
#         return Response({
#             'user': UserSerializer(user, context={'request': request}).data,
#             'refresh': str(refresh),
#             'access': str(refresh.access_token),
#             'message': '注册成功'
#         }, status=status.HTTP_201_CREATED)
#
#     @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
#     def login(self, request):
#         """用户登录"""
#         serializer = self.get_serializer(data=request.data)
#         serializer.is_valid(raise_exception=True)
#
#         user = serializer.validated_data['user']
#         refresh = RefreshToken.for_user(user)
#
#         return Response({
#             'user': UserSerializer(user, context={'request': request}).data,
#             'refresh': str(refresh),
#             'access': str(refresh.access_token),
#             'message': '登录成功'
#         })
#
#     @action(detail=False, methods=['post'])
#     def logout(self, request):
#         """用户登出"""
#         # 更新在线状态
#         request.user.update_online_status(False)
#
#         # Django logout
#         logout(request)
#
#         return Response({
#             'message': '登出成功'
#         })
#
#     @action(detail=False, methods=['get'])
#     def me(self, request):
#         """获取当前用户信息"""
#         serializer = self.get_serializer(request.user)
#         return Response(serializer.data)
#
#     @action(detail=False, methods=['put', 'patch'])
#     def update_profile(self, request):
#         """更新用户资料"""
#         serializer = self.get_serializer(
#             request.user,
#             data=request.data,
#             partial=True
#         )
#         serializer.is_valid(raise_exception=True)
#         serializer.save()
#
#         return Response({
#             'user': UserSerializer(request.user, context={'request': request}).data,
#             'message': '资料更新成功'
#         })
#
#     @action(detail=False, methods=['post'])
#     def change_password(self, request):
#         """修改密码"""
#         serializer = self.get_serializer(data=request.data)
#         serializer.is_valid(raise_exception=True)
#         serializer.save()
#
#         return Response({
#             'message': '密码修改成功，请重新登录'
#         })
#
#     @action(detail=False, methods=['post'])
#     def upload_avatar(self, request):
#         """上传头像"""
#         serializer = self.get_serializer(data=request.data)
#         serializer.is_valid(raise_exception=True)
#         user = serializer.save()
#
#         return Response({
#             'avatar_url': request.build_absolute_uri(user.avatar.url),
#             'message': '头像上传成功'
#         })
#
#     @action(detail=False, methods=['get'])
#     def list_users(self, request):
#         """获取用户列表（通讯录）"""
#         queryset = self.filter_queryset(self.get_queryset())
#
#         # 支持搜索
#         search_query = request.query_params.get('search', '')
#         if search_query:
#             queryset = queryset.filter(
#                 models.Q(username__icontains=search_query) |
#                 models.Q(email__icontains=search_query) |
#                 models.Q(department__icontains=search_query) |
#                 models.Q(position__icontains=search_query)
#             )
#
#         # 排序：在线用户在前
#         queryset = queryset.order_by('-is_online', '-last_login')
#
#         page = self.paginate_queryset(queryset)
#         if page is not None:
#             serializer = self.get_serializer(page, many=True, context={'request': request})
#             return self.get_paginated_response(serializer.data)
#
#         serializer = self.get_serializer(queryset, many=True, context={'request': request})
#         return Response(serializer.data)
#
#     @action(detail=False, methods=['get'])
#     def online_users(self, request):
#         """获取在线用户"""
#         online_users = CustomUser.objects.filter(is_online=True)
#         serializer = UserListSerializer(online_users, many=True, context={'request': request})
#         return Response(serializer.data)
