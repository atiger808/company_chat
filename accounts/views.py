# accounts/views.py
import datetime

from rest_framework.exceptions import ValidationError
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import viewsets, status, permissions, throttling
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import serializers

from email.utils import formataddr  # 👈 1. 引入标准库
from email.header import Header  # 👈 1. 引入 Header
from django.core.mail import send_mail
from django.template.loader import render_to_string

# 生成 JWT token
from rest_framework_simplejwt.tokens import RefreshToken, AccessToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken

from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from django.contrib.auth import logout
from django.db.models import Q
from django.conf import settings
from .models import CustomUser, Department, ConsultationRequest, LoginLog, OperationLog
from chat.models import ChatRoom
from loguru import logger

from utils.request_util import get_browser, get_request_ip, get_os, get_ip_analysis, get_request_path, save_login_log
from utils.utils import SystemConfigManager, CloudSystemConfigManager

from .serializers import (
    UserSerializer,
    UserDetailSerializer,
    AdminUserCreateSerializer,
    AdminProfileUpdateSerializer,
    DepartmentSerializer,

    RegisterSerializer,
    LoginSerializer,
    UserProfileUpdateSerializer,
    UserListSerializer,
    AvatarUploadSerializer,
    ChangePasswordSerializer,
    PasswordResetRequestSerializer,
    PasswordResetConfirmSerializer,
    ConsultationRequestSerializer,
)
from .permissions import IsSuperAdmin, IsAdminOrSuperAdmin, IsAdminUserManagement
from utils.encrypt_aes import encrypt_data


class AdminDashboardViewSet(viewsets.ViewSet):
    """管理员控制台视图集"""
    permission_classes = [IsSuperAdmin]

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


# accounts/views.py - 添加新的视图集

class AdminStatsViewSet(viewsets.ViewSet):
    """
    🔧 管理员数据统计视图集
    - 仅超级管理员可访问
    """
    permission_classes = [permissions.IsAuthenticated, IsSuperAdmin]

    @action(detail=False, methods=['get'])
    def overview(self, request):
        """📊 统计概览"""
        from django.db.models import Count, Q
        from chat.models import ChatRoom, Message

        # 用户统计
        user_stats = CustomUser.objects.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(is_active=True)),
            super_admin=Count('id', filter=Q(user_type='super_admin')),
            admin=Count('id', filter=Q(user_type='admin')),
            user=Count('id', filter=Q(user_type='user'))
        )

        # 部门统计
        dept_stats = Department.objects.annotate(
            user_count=Count('customuser')
        ).values('name', 'user_count').order_by('-user_count')[:10]

        # 聊天室统计
        room_stats = ChatRoom.objects.aggregate(
            total=Count('id'),
            active=Count('id', filter=Q(is_active=True))
        )

        # 消息统计（最近 7 天）
        from django.utils import timezone
        from datetime import timedelta
        week_ago = timezone.now() - timedelta(days=7)
        message_stats = Message.objects.filter(
            timestamp__gte=week_ago
        ).aggregate(
            total=Count('id'),
            daily=Count('id', filter=Q(timestamp__date=timezone.now().date()))
        )

        return Response({
            'users': user_stats,
            'departments': list(dept_stats),
            'chat_rooms': room_stats,
            'messages': message_stats,
            'last_updated': timezone.now().isoformat()
        })

    @action(detail=False, methods=['get'])
    def user_trend(self, request):
        """📈 用户增长趋势"""
        from django.db.models import Count
        from django.db.models.functions import TruncDate
        from django.utils import timezone
        from datetime import timedelta

        days = int(request.query_params.get('days', 30))
        start_date = timezone.now().date() - timedelta(days=days)

        trend = CustomUser.objects.filter(
            date_joined__date__gte=start_date
        ).annotate(
            date=TruncDate('date_joined')
        ).values('date').annotate(
            count=Count('id')
        ).order_by('date')

        return Response({
            'trend': list(trend),
            'period': f'{days}天'
        })

    @action(detail=False, methods=['get'])
    def activity_ranking(self, request):
        """🏆 活跃用户排行"""
        from chat.models import Message
        from django.db.models import Count
        from django.utils import timezone
        from datetime import timedelta

        days = int(request.query_params.get('days', 7))
        start_time = timezone.now() - timedelta(days=days)

        ranking = Message.objects.filter(
            timestamp__gte=start_time
        ).values('sender').annotate(
            message_count=Count('id')
        ).order_by('-message_count')[:20]

        # 关联用户信息
        user_ids = [item['sender'] for item in ranking]
        users = CustomUser.objects.filter(id__in=user_ids).values('id', 'username', 'real_name', 'avatar')
        user_map = {u['id']: u for u in users}

        result = []
        for item in ranking:
            user = user_map.get(item['sender'], {})
            result.append({
                'user_id': item['sender'],
                'username': user.get('username', ''),
                'real_name': user.get('real_name', ''),
                'avatar': user.get('avatar', ''),
                'message_count': item['message_count']
            })

        return Response({
            'ranking': result,
            'period': f'{days}天'
        })


class UserAdminViewSet(viewsets.ModelViewSet):
    """用户管理视图集（管理员专用）"""
    queryset = CustomUser.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminUserManagement]

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
            return AdminUserCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return AdminProfileUpdateSerializer
        return UserDetailSerializer

    def get_queryset(self):
        """
        🔧 权限过滤：普通管理员只能看到同部门用户
        """
        queryset = super().get_queryset()
        user = self.request.user

        # 🔧 普通管理员只能看到同部门的普通用户
        if not user.is_superuser:
            queryset = queryset.filter(
                user_type__in=['user', 'normal', 'admin']
            )
            # 无部门的管理员只能管理无部门的普通用户
            # if user.department:
            #     queryset = queryset.filter(
            #         department=user.department,
            #         user_type__in=['user', 'normal', 'admin']  # 只能看到普通用户
            #     )
            # else:
            #     # 无部门的管理员只能管理无部门的普通用户
            #     queryset = queryset.filter(
            #         department__isnull=True,
            #         user_type__in=['user', 'normal', 'admin']
            #     )
        # else:
        # 超级管理员排除自己
        # queryset = queryset.exclude(id=user.id)

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

        # 按用户类型过滤（仅超级管理员可用）
        if user.is_superuser:
            user_type = self.request.query_params.get('user_type', '')
            if user_type:
                queryset = queryset.filter(user_type=user_type)

            # 按部门过滤（仅超级管理员可用）
            department = self.request.query_params.get('department', '')
            if department:
                queryset = queryset.filter(department_id=department)

        return queryset.order_by('-date_joined')

    def create(self, request, *args, **kwargs):
        """
        🔧 关键修复：创建用户时的权限控制
        """
        user = request.user

        # 🔧 普通管理员不能创建超级管理员或管理员
        if not user.is_superuser:
            request_data = request.data.copy()

            # 强制设置为普通用户
            request_data['user_type'] = 'normal'

            # 强制设置为当前管理员的部门
            if user.department:
                request_data['department'] = user.department.id
            else:
                request_data['department'] = None

            # 更新请求数据
            request._full_data = request_data

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        """
        🔧 关键修复：更新用户时的权限控制
        """
        user = request.user
        partial = kwargs.pop('partial', False)
        instance = self.get_object()

        # 🔧 普通管理员不能修改用户类型和部门
        if not user.is_superuser:
            request_data = request.data.copy()

            # 移除用户类型和部门字段（防止被修改）
            request_data.pop('user_type', None)
            request_data.pop('department', None)

            # 确保不能设置为超级管理员或管理员
            if instance.user_type != 'normal':
                return Response(
                    {'error': '普通管理员只能管理普通用户'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 更新请求数据
            request._full_data = request_data

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """
        🔧 重置密码时的权限控制
        """
        user = request.user
        target_user = self.get_object()

        # 🔧 普通管理员不能重置超级管理员或管理员的密码
        if not user.is_superuser and target_user.user_type != 'normal':
            return Response(
                {'error': '普通管理员只能重置普通用户的密码'},
                status=status.HTTP_403_FORBIDDEN
            )

        new_password = request.data.get('password', '123456')

        # 密码强度验证
        if len(new_password) < 6:
            return Response(
                {'error': '密码长度不能少于 6 位'},
                status=status.HTTP_400_BAD_REQUEST
            )

        target_user.set_password(new_password)
        target_user.save()

        logger.info(f'{user} 重置了用户 {target_user.username} 的密码')

        return Response({
            'message': '密码已重置',
            'default_password': new_password
        })

    @action(detail=True, methods=['post'])
    def toggle_status(self, request, pk=None):
        """
        🔧 切换用户状态时的权限控制
        """
        user = request.user
        target_user = self.get_object()

        # 🔧 普通管理员不能操作超级管理员或管理员
        if not user.is_superuser and target_user.user_type != 'normal':
            return Response(
                {'error': '普通管理员只能操作普通用户'},
                status=status.HTTP_403_FORBIDDEN
            )

        target_user.is_active = not target_user.is_active
        target_user.save()

        logger.info(f'{user} {"启用" if target_user.is_active else "禁用"}了用户 {target_user.username}')

        return Response({
            'message': f'用户已{"启用" if target_user.is_active else "禁用"}',
            'is_active': target_user.is_active
        })

    @action(detail=False, methods=['post'])
    def batch_delete(self, request):
        """
        🔧 批量删除时的权限控制
        """
        user = request.user
        user_ids = request.data.get('user_ids', [])

        if not user_ids:
            return Response(
                {'error': '请选择要删除的用户'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 防止删除自己
        if user.id in user_ids:
            return Response(
                {'error': '不能删除自己'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 🔧 普通管理员只能批量删除普通用户
        if not user.is_superuser:
            # 检查是否有非普通用户
            non_user_users = CustomUser.objects.filter(
                id__in=user_ids,
                user_type__in=['super_admin', 'admin']
            )
            if non_user_users.exists():
                return Response(
                    {'error': '普通管理员只能删除普通用户'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 确保只能删除同部门用户
            if user.department:
                allowed_ids = CustomUser.objects.filter(
                    id__in=user_ids,
                    department=user.department
                ).values_list('id', flat=True)
                user_ids = list(allowed_ids)

        deleted_count, _ = CustomUser.objects.filter(id__in=user_ids).delete()

        logger.info(f'{user} 批量删除了 {deleted_count} 个用户')

        return Response({
            'message': f'成功删除 {deleted_count} 个用户',
            'deleted_count': deleted_count
        })

    def destroy(self, request, *args, **kwargs):
        """
        🔧 删除用户时的权限控制
        """
        user = request.user
        instance = self.get_object()

        # 🔧 普通管理员不能删除超级管理员或管理员
        if not user.is_superuser and instance.user_type != 'normal':
            return Response(
                {'error': '普通管理员只能删除普通用户'},
                status=status.HTTP_403_FORBIDDEN
            )

        # 不能删除自己
        if instance.id == user.id:
            return Response(
                {'error': '不能删除自己'},
                status=status.HTTP_400_BAD_REQUEST
            )

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['get'])
    def friends(self, request, pk=None):
        """获取用户的好友列表"""
        logger.info(f'{request.user} 好友列表 pk: {pk}')

        try:
            user = CustomUser.objects.get(id=pk)
        except CustomUser.DoesNotExist:
            return Response(
                {'error': '用户不存在'},
                status=status.HTTP_404_NOT_FOUND
            )

        friends = user.friends.all().select_related('department')
        serializer = UserListSerializer(friends, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def assign_friends(self, request, pk=None):
        """为用户分配好友"""
        user = self.get_object()
        friend_ids = request.data.get('friend_ids', [])

        # 验证好友ID
        valid_friend_ids = []
        for fid in friend_ids:
            try:
                fid_int = int(fid)
                if CustomUser.objects.filter(id=fid_int, is_active=True).exists():
                    valid_friend_ids.append(fid_int)
            except (ValueError, TypeError):
                continue

        # 清空当前好友关系并添加新好友
        user.friends.clear()
        user.friends.add(*valid_friend_ids)

        return Response({
            'message': '好友分配成功',
            'friend_count': len(friend_ids)
        })

    @action(detail=False, methods=['get'])
    def departments(self, request):
        """🔧 获取部门列表（用于筛选）"""
        departments = Department.objects.all().order_by('name')
        data = [{'id': d.id, 'name': d.name} for d in departments]
        return Response(data)

    @action(detail=False, methods=['get'])
    def export(self, request):
        """🔧 导出用户数据（仅超级管理员可用）"""
        if not request.user.is_superuser:
            return Response(
                {'error': '仅超级管理员可执行此操作'},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            from django.http import HttpResponse
            import csv

            response = HttpResponse(content_type='text/csv')
            response['Content-Disposition'] = 'attachment; filename="users.csv"'

            writer = csv.writer(response)
            writer.writerow([
                'ID', '用户名', '真实姓名', '邮箱', '手机号',
                '部门', '职位', '用户类型', '状态', '注册时间'
            ])

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
                    '启用' if user.is_active else '禁用',
                    user.date_joined.strftime('%Y-%m-%d %H:%M:%S')
                ])

            logger.info(f'{request.user} 导出了用户数据')
            return response

        except Exception as e:
            logger.error(f'导出失败：{e}')
            return Response(
                {'error': '导出失败'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


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


# accounts/views.py - 添加新的 ViewSet

class DepartmentListViewSet(viewsets.ViewSet):
    """
    🔧 部门列表视图集（权限控制）
    - 超级管理员：可查看所有部门
    - 普通管理员：只能查看自己的部门
    """
    permission_classes = [permissions.IsAuthenticated]

    # 🔧 关键修复：直接覆盖 list 方法，不使用@action 装饰器
    def list(self, request):
        """获取部门列表"""
        user = request.user

        if user.is_superuser:
            # 超级管理员查看所有部门
            departments = Department.objects.all().order_by('name')
        else:
            # 普通管理员只查看自己的部门
            if user.department:
                departments = Department.objects.filter(id=user.department.id)
            else:
                departments = Department.objects.none()

        serializer = DepartmentSerializer(departments, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def my_department(self, request):
        """获取当前用户所在部门"""
        user = request.user

        if user.department:
            serializer = DepartmentSerializer(user.department)
            return Response(serializer.data)
        else:
            return Response(
                {'message': '用户未分配部门'},
                status=status.HTTP_404_NOT_FOUND
            )


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
        # 🔧 关键修复1: 优化查询，使用 select_related 和 only
        # 排除当前用户自身和未激活用户
        return CustomUser.objects.filter(
            is_active=True
        ).exclude(
            id=self.request.user.id
        ).select_related('department').only(
            'id', 'username', 'real_name', 'email', 'phone',
            'gender', 'avatar', 'department', 'position',
            'user_type', 'is_online', 'last_seen', 'date_joined'
        )

    def get_permissions(self):
        if self.action in ['register', 'login', 'request_password_reset', 'confirm_password_reset']:
            return [permissions.AllowAny()]
        elif self.action in ['me', 'update_profile', 'change_password', 'logout', 'partial_update']:
            return [permissions.IsAuthenticated()]
        elif self.action in ['list', 'retrieve', 'search_users', 'list_users', 'get_user_profile']:
            return [permissions.IsAuthenticated()]
        elif self.action in ['create', 'destroy', 'promote_user', 'demote_user']:
            return [IsSuperAdmin()]

        return super().get_permissions()

    @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
    def register(self, request):
        """用户注册"""

        # 🔧 关键修复：从配置读取是否允许注册

        referer_from = request.META.get('HTTP_REFERER', '')
        if referer_from and 'cloud/login' in str(referer_from):
            registration_enabled = CloudSystemConfigManager.get_config('system.user_registration_enabled', False)
            logger.info(f'cloud: register: {registration_enabled}')
        else:
            registration_enabled = SystemConfigManager.get_config('system.user_registration_enabled', False)
            logger.info(f'chat: register: {registration_enabled}')

        if not registration_enabled:
            return Response({
                'error': '当前不允许新用户注册'
            }, status=status.HTTP_403_FORBIDDEN)

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

        # 🔧 关键修复：从配置读取登录失败锁定策略
        login_max_attempts = SystemConfigManager.get_config('security.login_max_attempts', 5)
        login_lockout_minutes = SystemConfigManager.get_config('security.login_lockout_minutes', 15)

        # 检查账户是否被锁定
        if hasattr(user, 'login_attempts') and user.login_attempts >= login_max_attempts:
            from django.utils import timezone
            from datetime import timedelta
            if user.last_failed_login and \
                    timezone.now() - user.last_failed_login < timedelta(minutes=login_lockout_minutes):
                return Response({
                    'error': f'账户已锁定，请{login_lockout_minutes}分钟后再试'
                }, status=status.HTTP_403_FORBIDDEN)

        refresh = RefreshToken.for_user(user)
        logger.info(f'用户登录：{user}')
        # 记录登录日志
        request.user = user
        save_login_log(request=request)
        return Response({
            'user': UserDetailSerializer(user, context={'request': request}).data,
            'refresh': str(refresh),
            'access': str(refresh.access_token),
            'message': '登录成功'
        })

    @action(detail=False, methods=['post'])
    def logout(self, request):
        """用户登出（同时将 JWT refresh token 加入黑名单）"""
        # 🔒 验证用户是否已认证
        if not request.user.is_authenticated:
            return Response({'error': '用户未登录'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            logger.info(f'登出用户：{request.user.username} (ID: {request.user.id})')

            # 🔧 黑名单处理：将 refresh token 加入黑名单使其立即失效
            refresh_token = request.data.get('refresh')
            if refresh_token:
                try:
                    token = RefreshToken(refresh_token)
                    token.blacklist()
                    logger.info(f'✅ refresh token 已加入黑名单: user={request.user.username}')
                except TokenError as e:
                    logger.warning(f'⚠️ refresh token 已过期或无效，无需黑名单: {e}')
                except Exception as e:
                    logger.warning(f'⚠️ 将 refresh token 加入黑名单失败（不影响登出）: {e}')

            # 🔧 更新在线状态（带异常处理）
            request.user.update_online_status(False)

            # Django logout
            logout(request)

            logger.info(f'用户 {request.user.username} 登出成功')

            return Response({
                'message': '登出成功'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            # ✅ 记录错误但不影响登出流程
            logger.error(f'用户 {request.user.username} 登出过程中发生错误：{e}', exc_info=True)

            # 🔧 关键：即使出错也要执行 Django logout
            try:
                logout(request)
            except:
                pass

            return Response({
                'error': '登出过程中发生错误，但您已退出登录',
                'detail': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

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

    @action(detail=True, methods=['get'])
    def get_friends(self, request):
        user = self.get_object()
        friends = user.friends.all().select_related('department')
        serializer = UserListSerializer(friends, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def list_users(self, request):
        """
        通讯录用户列表（优化版）
        - 返回所有活跃用户（排除自己）
        - 按部门分组
        - 支持分页
        """
        # 🔧 关键修复2: 优化通讯录用户列表
        # 管理员显示所有用户，普通用户只显示好友
        if request.user.user_type in ['admin', 'super_admin']:
            # 管理员可以看到所有用户
            queryset = CustomUser.objects.filter(
                is_active=True
            ).exclude(
                id=request.user.id
            ).select_related('department').prefetch_related(
                'friends'  # 🔧 预加载好友关系
            )
        else:
            # 普通用户只能看到分配的好友
            queryset = request.user.friends.filter(
                is_active=True
            ).select_related('department')

        # 支持搜索
        search_query = request.query_params.get('search', '')
        if search_query:
            queryset = queryset.filter(
                Q(username__icontains=search_query) |
                Q(real_name__icontains=search_query) |
                Q(email__icontains=search_query) |
                Q(phone__icontains=search_query) |
                Q(department__name__icontains=search_query) |
                Q(position__icontains=search_query)
            )

        # 排序：在线用户在前
        queryset = queryset.order_by('-is_online', '-last_login')

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

        # 管理员显示所有用户，普通用户只显示好友
        if request.user.user_type in ['admin', 'super_admin']:
            # 管理员可以看到所有用户
            queryset = CustomUser.objects.filter(
                is_active=True
            ).exclude(
                id=request.user.id
            ).select_related('department')
        else:
            # 普通用户只能看到分配的好友
            queryset = request.user.friends.filter(
                is_active=True
            ).select_related('department')

        # 排除当前用户，按多个维度搜索
        queryset = queryset.filter(
            Q(username__icontains=query) |
            Q(real_name__icontains=query) |
            Q(email__icontains=query) |
            Q(phone__icontains=query) |
            Q(department__name__icontains=query) |
            Q(position__icontains=query),
            is_active=True  # 只搜索活跃用户
        )

        # 排序：在线用户在前
        queryset = queryset.order_by('-is_online', '-last_login')

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

    @action(detail=False, methods=['post'])
    def change_password(self, request):

        """
        修改密码
        POST /api/auth/change_password/
        {
            "old_password": "old_pwd",
            "new_password": "new_pwd_123",
            "new_password_confirm": "new_pwd_123"
        }
        """
        serializer = ChangePasswordSerializer(
            data=request.data,
            context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # 🔧 可选：发送密码修改通知邮件
        try:
            from django.core.mail import send_mail
            from django.template.loader import render_to_string

            # 获取系统名称
            site_name = SystemConfigManager.get_config('system.name', '企联云')

            # 👇 2. 核心修复：使用 Header 将中文转换为 MIME 编码
            # 这会将 '企联云' 转换为类似 '=?utf-8?b?5Lyg6IuN5Lq6?=' 的纯 ASCII 字符串
            encoded_name = str(Header(site_name, 'utf-8'))

            # 👇 3. 拼接成标准的发件人格式
            # 注意：这里的 settings.DEFAULT_FROM_EMAIL 必须是纯邮箱地址，如 noreply@qq.com
            custom_from_email = f"{encoded_name} <{settings.DEFAULT_FROM_EMAIL}>"

            # 准备邮件上下文
            context = {
                'username': request.user.real_name or request.user.username,
                'change_time': timezone.now().strftime('%Y-%m-%d %H:%M:%S'),
                'ip': get_request_ip(request),
                'user_agent': request.META.get('HTTP_USER_AGENT', '未知设备')[:100],
                'site_name': SystemConfigManager.get_config('system.name', '企业聊天室'),
                'support_email': SystemConfigManager.get_config('system.support_email', 'support@company.com'),
                'login_url': f"{getattr(settings, 'FRONTEND_URL', '')}/login/",
                'help_url': f"{getattr(settings, 'FRONTEND_URL', '')}/help/",
                'current_year': timezone.now().year,
            }

            # 渲染邮件模板
            text_content = render_to_string('emails/password_changed.txt', context)
            html_content = render_to_string('emails/password_changed.html', context)

            # 发送邮件
            send_mail(
                subject=f"{context['site_name']} - 密码修改通知",
                message=text_content,
                from_email=custom_from_email,
                recipient_list=[request.user.email],
                html_message=html_content,
                fail_silently=False  # 生产环境建议设为 True + 日志记录
            )

            logger.info(f"密码修改通知邮件已发送至：{request.user.email}")
        except Exception as e:
            # 🔧 邮件发送失败不影响密码修改流程，仅记录日志
            logger.warning(f"发送密码修改通知邮件失败: {request.user.email}, error: {e}")

        return Response({
            'message': '密码修改成功'
        }, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
    def request_password_reset(self, request):
        """
        请求密码重置 - 发送重置邮件
        POST /api/auth/request_password_reset/
        {
            "email": "user@example.com"
        }
        """

        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email']
        user = CustomUser.objects.get(email=email)

        # 获取系统名称
        site_name = SystemConfigManager.get_config('system.name', '企联云')

        # 👇 2. 核心修复：使用 Header 将中文转换为 MIME 编码
        # 这会将 '企联云' 转换为类似 '=?utf-8?b?5Lyg6IuN5Lq6?=' 的纯 ASCII 字符串
        encoded_name = str(Header(site_name, 'utf-8'))

        # 👇 3. 拼接成标准的发件人格式
        # 注意：这里的 settings.DEFAULT_FROM_EMAIL 必须是纯邮箱地址，如 noreply@qq.com
        custom_from_email = f"{encoded_name} <{settings.DEFAULT_FROM_EMAIL}>"

        # 🔧 频率限制：同一邮箱1小时内只能请求1次
        if user.password_reset_token_expires and timezone.now() < user.password_reset_token_expires:
            logger.warning(
                f"用户 {user.username} 请求密码重置，但已存在重置令牌，请检查邮箱（1小时内请勿重复请求）,请检查 password_reset_token_expires: {user.password_reset_token_expires}")
            return Response({
                'message': '已存在重置令牌，请检查邮箱（1小时内请勿重复请求）'
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 生成重置令牌
        expires_minutes = settings.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES
        expires_hours = settings.PASSWORD_RESET_TOKEN_EXPIRES_HOURS
        token = user.generate_password_reset_token(expires_hours=expires_hours, expires_minutes=expires_minutes)

        # 构建重置链接
        reset_url = f"{settings.FRONTEND_URL}/api/auth/reset-password?token={token}&email={email}"

        # 发送重置邮件
        try:
            # 渲染邮件模板
            context = {
                'username': user.username or user.email,
                'reset_url': reset_url,
                'expires_hours': expires_hours,
                'expires_minutes': expires_minutes,
                'site_name': SystemConfigManager.get_config('system.name', '企业聊天室')
            }

            html_message = render_to_string('emails/password_reset.html', context)
            text_message = f"""
            您好 {context['username']},

            您请求重置 {context['site_name']} 的登录密码。

            请点击以下链接重置密码（{expires_hours}小时内有效）：
            {reset_url}

            如果这不是您本人的操作，请忽略此邮件。
            """

            send_mail(
                subject=f"{context['site_name']} - 密码重置请求",
                message=text_message,
                from_email=custom_from_email,  # 👈 4. 使用编码后的纯 ASCII 字符串
                recipient_list=[email],
                html_message=html_message,
                fail_silently=False
            )

            logger.info(f"密码重置邮件已发送至：{email}")

            return Response({
                'message': '重置链接已发送至您的邮箱，请查收'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"发送重置邮件失败：{email}, error: {e}")
            user.clear_password_reset_token()
            return Response({
                'error': '发送重置邮件失败，请稍后重试'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], permission_classes=[permissions.AllowAny])
    def confirm_password_reset(self, request):
        """
        确认密码重置 - 验证令牌并设置新密码
        POST /api/auth/confirm_password_reset/
        {
            "email": "user@example.com",
            "token": "reset_token_here",
            "new_password": "new_password_123",
            "new_password_confirm": "new_password_123"
        }
        """
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = request.data.get('email')
        token = serializer.validated_data['token']
        new_password = serializer.validated_data['new_password']

        # 查找用户
        try:
            user = CustomUser.objects.get(email=email)
        except CustomUser.DoesNotExist:
            # 安全考虑：不暴露用户是否存在
            raise serializers.ValidationError({
                'token': "无效的请求"
            })

        # 验证令牌
        if not user.verify_password_reset_token(token):
            logger.warning(f"无效的重置令牌：{email}")
            raise serializers.ValidationError({
                'token': "重置链接已过期或无效，请重新申请"
            })

        # 🔧 从配置读取密码策略
        password_min_length = SystemConfigManager.get_config('security.password_min_length', 8)
        password_require_special = SystemConfigManager.get_config('security.password_require_special', True)

        if len(new_password) < password_min_length:
            raise serializers.ValidationError({
                'new_password': f'密码长度至少{password_min_length}位'
            })

        if password_require_special:
            import re
            if not re.search(r'[!@#$%^&*(),.?":{}|<>]', new_password):
                raise serializers.ValidationError({
                    'new_password': '密码必须包含特殊字符'
                })

        # 设置新密码
        user.set_password(new_password)
        user.clear_password_reset_token()  # 清除令牌（一次性使用）
        user.reset_login_attempts()  # 重置失败计数
        user.save()

        logger.info(f"密码重置成功：{email}")

        return Response({
            'message': '密码重置成功，请使用新密码登录'
        }, status=status.HTTP_200_OK)


# chat/views.py - 在文件末尾添加
from django.shortcuts import render
from django.http import JsonResponse
from django.conf import settings
from loguru import logger


def reset_password_page(request):
    """
    渲染重置密码页面
    GET /reset-password/?token=xxx&email=xxx
    """
    try:
        # 🔧 获取 URL 参数（用于前端预填充和验证）
        token = request.GET.get('token', '')
        email = request.GET.get('email', '')

        # 🔧 基础参数校验（可选：提前验证令牌有效性）
        if not token or not email:
            logger.warning(f"重置密码链接参数不完整: token={bool(token)}, email={bool(email)}")
            # 仍然渲染页面，让前端展示错误提示（用户体验更好）
            # 返回友好的错误页面（而不是 502）
            return render(request, 'chat/reset-password-error.html', {
                'error_message': ''
            }, status=200)

        # 🔧 可选：提前验证令牌（如果验证失败可重定向到错误页）
        user = CustomUser.objects.filter(email=email).first()
        if not user or not user.verify_password_reset_token(token):
            return render(request, 'chat/reset-password-error.html', {
                'error_message': '重置链接已过期或无效，请重新申请'
            })

        # 渲染重置密码页面
        return render(request, 'chat/reset-password.html', {
            'initial_token': token,
            'initial_email': email,
            'site_name': getattr(settings, 'SITE_NAME', '企业聊天室')
        })

    except Exception as e:
        # 🔧 关键：记录错误日志，避免 502
        logger.error(f"重置密码页面渲染失败: {e}", exc_info=True)

        # 返回友好的错误页面（而不是 502）
        return render(request, 'chat/reset-password-error.html', {
            'error_message': '页面加载失败，请刷新重试或重新申请重置链接'
        }, status=200)


# 频率限制：同一 IP 每小时最多提交 3 次
class ContactRequestThrottle(throttling.AnonRateThrottle):
    rate = '3/hour'


class ConsultationRequestView(APIView):
    """
    处理官网/联系页面的咨询提交
    POST /api/contact/submit/
    """
    permission_classes = [permissions.AllowAny]  # 允许未登录用户提交
    throttle_classes = [ContactRequestThrottle]  # 启用频率限制

    def post(self, request):
        serializer = ConsultationRequestSerializer(data=request.data)

        # 1. 验证数据
        if not serializer.is_valid():
            # 提取第一个错误信息返回给前端
            first_error = next(iter(serializer.errors.values()))[0]
            return Response({
                'error': first_error
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 2. 保存到数据库
            consultation = serializer.save()
            logger.info(f"收到新的咨询请求: {consultation.company_name} - {consultation.contact_name}")

            # 3. 发送通知邮件给管理员 (可选，但强烈推荐)
            self._notify_admin(consultation)

            return Response({
                'success': True,
                'message': '提交成功！我们的技术顾问将在 24 小时内与您联系。'
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f"处理咨询请求失败: {e}", exc_info=True)
            return Response({
                'error': '服务器内部错误，请稍后重试'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _notify_admin(self, consultation):
        """发送内部通知邮件给管理员"""
        try:
            # 获取管理员邮箱列表 (可在 settings.py 中配置 ADMINS 或自定义)
            admin_emails = getattr(settings, 'CONTACT_NOTIFICATION_EMAILS', [settings.DEFAULT_FROM_EMAIL])

            # 获取系统名称
            site_name = SystemConfigManager.get_config('system.name', '企联云')

            # 👇 2. 核心修复：使用 Header 将中文转换为 MIME 编码
            # 这会将 '企联云' 转换为类似 '=?utf-8?b?5Lyg6IuN5Lq6?=' 的纯 ASCII 字符串
            encoded_name = str(Header(site_name, 'utf-8'))

            # 👇 3. 拼接成标准的发件人格式
            # 注意：这里的 settings.DEFAULT_FROM_EMAIL 必须是纯邮箱地址，如 noreply@qq.com
            safe_from_email = f"{encoded_name} <{settings.DEFAULT_FROM_EMAIL}>"

            subject = f"[新咨询] {consultation.company_name} - {consultation.get_demand_type_display()}"

            message = f"""
收到新的企业咨询请求：

【公司名称】: {consultation.company_name}
【联系人】: {consultation.contact_name}
【联系电话】: {consultation.phone}
【企业邮箱】: {consultation.email}
【期望部署】: {consultation.get_demand_type_display()}
【需求描述】: {consultation.message or '无'}
【提交时间】: {consultation.created_at.strftime('%Y-%m-%d %H:%M:%S')}

请登录管理后台及时处理。
            """

            send_mail(
                subject=subject,
                message=message,
                from_email=safe_from_email,  # 👈 使用安全编码的发件人
                recipient_list=admin_emails,
                fail_silently=True,  # 邮件发送失败不应阻断用户提交成功的响应
            )
            logger.info(f"管理员通知邮件已发送至: {admin_emails}")

        except Exception as e:
            # 邮件发送失败仅记录日志，不影响主流程
            logger.warning(f"发送咨询通知邮件失败: {e}")


class TokenRefreshView(APIView):
    """
    🔧 自定义 Token 刷新接口
    - 支持更长有效期（24小时）
    - 自动延长 refresh token
    - 记录刷新日志
    POST /api/auth/token/refresh/
    {
        "refresh": "refresh_token_value"
    }
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = []  # 不限制频率，保证编辑时能正常刷新
    authentication_classes = []  # 不需要认证

    def post(self, request):
        refresh_token = request.data.get('refresh')

        if not refresh_token:
            return Response({
                'error': '缺少 refresh_token'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            # 验证 refresh token
            refresh = RefreshToken(refresh_token)

            # 获取用户信息（用于日志）
            user_id = refresh.get('user_id')
            logger.info(f"用户 {user_id} 刷新了 Token")

            # 检查是否即将过期（7天内过期则延长）
            from django.utils import timezone
            from datetime import timedelta
            exp_timestamp = refresh.get('exp')
            if exp_timestamp:
                exp_time = timezone.datetime.fromtimestamp(exp_timestamp, tz=timezone.utc)
                remaining = exp_time - timezone.now()
                # 如果7天内过期，自动延长
                if remaining < timedelta(days=7):
                    refresh.set_exp(lifetime=timedelta(days=30))
                    logger.info(f"延长 refresh token: user_id={user_id}")

            # 生成新的 access token
            access = refresh.access_token

            # 可选：设置 access token 更长的有效期（编辑场景）
            access.set_exp(lifetime=timedelta(hours=24))

            logger.info(f"Token 刷新成功: user_id={user_id}")

            return Response({
                'access': str(access),
                'refresh': str(refresh),
                'expires_in': 24 * 60 * 60,  # 过期时间（秒）
                'token_type': 'Bearer'
            })


        except InvalidToken as e:
            logger.warning(f"无效的 refresh token: {e}")

            return Response({
                'error': 'Token 无效或已过期',
                'code': 'invalid_token',
                'detail': str(e)
            }, status=status.HTTP_401_UNAUTHORIZED)


        except TokenError as e:
            logger.warning(f"Token 解析错误: {e}")

            return Response({
                'error': 'Token 解析失败',
                'code': 'token_error',
                'detail': str(e)
            }, status=status.HTTP_401_UNAUTHORIZED)


        except Exception as e:
            logger.error(f"Token 刷新异常: {e}", exc_info=True)

            return Response({
                'error': '服务器内部错误',
                'code': 'server_error'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TokenVerifyView(APIView):
    """
    🔧 验证 Token 有效性
    POST /api/auth/token/verify/
    {
        "token": "access_token_value"
    }
    """
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        token = request.data.get('token')

        if not token:
            return Response({
                'valid': False,
                'error': '缺少 token'
            })

        try:
            # 验证 access token
            access_token = AccessToken(token)

            # 获取 Token 信息
            payload = {
                'user_id': access_token.get('user_id'),
                'exp': access_token.get('exp'),
                'iat': access_token.get('iat'),
                'token_type': access_token.get('token_type')
            }

            # 计算剩余时间
            exp_timestamp = payload.get('exp', 0)
            remaining = exp_timestamp - timezone.now().timestamp()

            return Response({
                'valid': True,
                'payload': payload,
                'expires_in': max(0, int(remaining)),
                'is_expiring_soon': remaining < 300  # 5分钟内即将过期
            })

        except InvalidToken:
            return Response({
                'valid': False,
                'error': 'Token 无效',
                'code': 'invalid_token'
            })

        except TokenError:
            return Response({
                'valid': False,
                'error': 'Token 已过期',
                'code': 'expired_token'
            })

        except Exception as e:
            return Response({
                'valid': False,
                'error': str(e),
                'code': 'error'
            })


class AdminLoginLogViewSet(viewsets.ViewSet):
    """🔧 登录日志视图集"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """获取登录日志列表"""
        user = request.user
        if user.user_type not in ['super_admin', 'admin']:
            return Response({'error': '权限不足'}, status=403)
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        search = request.query_params.get('search', '').strip()

        if user.user_type == 'super_admin':
            qs = LoginLog.objects.select_related('creator').all()
        else:
            qs = LoginLog.objects.select_related('creator').filter(creator=user)

        if search:
            qs = qs.filter(Q(username__icontains=search) | Q(creator__username__icontains=search) | Q(creator__real_name__icontains=search) | Q(ip__icontains=search) | Q(browser__icontains=search) | Q(os__icontains=search))
        qs = qs.order_by('-create_time')
        total = qs.count()
        tp = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        items = qs[start:start + page_size]
        results = [{
            'id': l.id, 'username': l.username or '', 'ip': l.ip or '',
            'browser': l.browser or '', 'os': l.os or '',
            'country': l.country or '', 'province': l.province or '', 'city': l.city or '',
            'login_type_display': dict(LoginLog.LOGIN_TYPE_CHOICES).get(l.login_type, ''),
            'description': l.description or '', 'real_name':l.creator.real_name if l.creator else '',
            'created_at': l.create_time.isoformat() if l.create_time else '',
        } for l in items]
        return Response({'encrypt': True, 'data': encrypt_data({'results': results, 'count': total, 'page': page, 'page_size': page_size, 'total_pages': tp})})

    def retrieve(self, request, pk=None):
        """
        🔧 关键修复：将 detail 改为 retrieve
        获取登录日志详情
        """
        try:
            logger.info(f"{request.user} 获取登录日志pk: {pk}")
            l = LoginLog.objects.get(id=pk)
            return Response({'encrypt': True, 'data': encrypt_data({
                'id': l.id, 'username': l.username or '', 'ip': l.ip or '',
                'agent': l.agent or '', 'browser': l.browser or '', 'os': l.os or '',
                'continent': l.continent or '', 'country': l.country or '', 'province': l.province or '',
                'city': l.city or '', 'district': l.district or '', 'isp': l.isp or '',
                'longitude': l.longitude or '', 'latitude': l.latitude or '',
                'login_type': l.login_type,
                'login_type_display': dict(LoginLog.LOGIN_TYPE_CHOICES).get(l.login_type, ''),
                'description': l.description or '', 'real_name':l.creator.real_name if l.creator else '',
                'created_at': l.create_time.isoformat() if l.create_time else '',
                'creator_name': l.creator.username if l.creator else '',
            })})
        except LoginLog.DoesNotExist:
            return Response({'error': '日志不存在'}, status=404)
        except Exception as e:
            logger.error(f"获取登录日志详情失败: {e}", exc_info=True)
            return Response({'error': str(e)}, status=500)


class AdminOperationLogViewSet(viewsets.ViewSet):
    """🔧 操作日志视图集"""
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        """获取操作日志列表"""
        user = request.user
        if user.user_type not in ['super_admin', 'admin']:
            return Response({'error': '权限不足'}, status=403)
        page = int(request.query_params.get('page', 1))
        page_size = int(request.query_params.get('page_size', 20))
        search = request.query_params.get('search', '').strip()

        if user.user_type == 'super_admin':
            qs = OperationLog.objects.select_related('creator').all()
        else:
            qs = OperationLog.objects.select_related('creator').filter(creator=user)

        if search:
            qs = qs.filter(Q(creator__username__icontains=search) | Q(creator__real_name__icontains=search) | Q(request_modular__icontains=search) | Q(request_path__icontains=search) | Q(request_ip__icontains=search))
        qs = qs.order_by('-create_time')
        total = qs.count()
        tp = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        items = qs[start:start + page_size]
        results = [{
            'id': l.id, 'creator_name': l.creator.username if l.creator else '',
            'request_modular': l.request_modular or '', 'request_path': l.request_path or '',
            'request_method': l.request_method or '', 'request_msg': l.request_msg or '',
            'request_ip': l.request_ip or '', 'response_code': l.response_code or '',
            'status': l.status, 'description': l.description or '', 'real_name':l.creator.real_name if l.creator else '',
            'created_at': l.create_time.isoformat() if l.create_time else '',
        } for l in items]
        return Response({'encrypt': True, 'data': encrypt_data({'results': results, 'count': total, 'page': page, 'page_size': page_size, 'total_pages': tp})})

    def retrieve(self, request, pk=None):
        """
        🔧 关键修复：将 detail 改为 retrieve
        获取操作日志详情
        """
        try:
            logger.info(f"{request.user} 获取操作日志pk: {pk}")
            l = OperationLog.objects.get(id=pk)
            return Response({'encrypt': True, 'data': encrypt_data({
                'id': l.id, 'creator_name': l.creator.username if l.creator else '',
                'request_modular': l.request_modular or '', 'request_path': l.request_path or '',
                'request_body': l.request_body or '', 'request_method': l.request_method or '',
                'request_msg': l.request_msg or '', 'request_ip': l.request_ip or '',
                'request_browser': l.request_browser or '', 'request_os': l.request_os or '',
                'response_code': l.response_code or '', 'json_result': l.json_result or '',
                'status': l.status, 'description': l.description or '', 'real_name':l.creator.real_name if l.creator else '',
                'created_at': l.create_time.isoformat() if l.create_time else '',
            })})
        except OperationLog.DoesNotExist:
            return Response({'error': '日志不存在'}, status=404)
        except Exception as e:
            logger.error(f"获取操作日志详情失败: {e}", exc_info=True)
            return Response({'error': str(e)}, status=500)
