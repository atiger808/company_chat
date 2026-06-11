# cloud/views.py - 添加网盘视图集

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.filters import SearchFilter
from django_filters.rest_framework import DjangoFilterBackend

from django.core.cache import cache
from django.db.models import Q, Sum, Count, F
from django.db import models
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import api_view, permission_classes
from rest_framework import serializers
from django.http import FileResponse, HttpResponse, JsonResponse, HttpResponseForbidden, HttpResponseServerError
from django.shortcuts import render, redirect, get_object_or_404
from django.db import transaction
from django.core.files.base import ContentFile
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.utils import timezone
from datetime import datetime
from django.contrib.auth import get_user_model
from django.conf import settings
from django.db import connection
from .models import (
    Folder, CloudFile, FileShare, FileComment, FileOperationLog,
    FileCollaboration, FileVersion,
    DocumentVersion, DocumentEditLock, DocumentCollaboration,
    UploadSession, CloudSystemConfig, UserOnlyOfficePermission,
    FolderCollaboration,
)
from accounts.models import CustomUser, Department
from chat.models import FileUpload, upload_to

from .serializers import (
    FolderSerializer, FolderListSerializer,
    CloudFileSerializer, FileShareSerializer,
    FileCommentSerializer, FileOperationLogSerializer,
    FileVersionSerializer, UploadSessionSerializer,
    ChunkUploadSerializer,
    MergeChunksSerializer,
    CloudSystemConfigSerializer, SystemConfigCategorySerializer,
    UserOnlyOfficePermissionSerializer
)
from .permissions import OnlyOfficeCallbackPermission  # 🔧 导入自定义权限
from .pagination import CloudPagination, SharePagination
from .filters import CloudFileFilter, FileShareFilter

from utils.request_util import get_request_ip
from urllib.parse import quote
import zipfile
import io
import os
import re
import time
import hashlib
import uuid
import shutil
from loguru import logger
from datetime import timedelta
import requests
import json
import jwt
from io import BytesIO

class UtilsTools(object):
    """
    工具函数
    """

    def _is_owner_for_folder(self, folder, user):
        return folder and folder.owner == user

    def _is_owner_for_file(self, file, user):
        return file and file.owner == user

    def _is_admin(self, folder, user):
        """是否是共享文件夹管理员"""
        return FolderCollaboration.objects.filter(folder=folder, user=user, permission='admin', is_active=True).exists()

    def _is_admin_or_owner(self, folder, user):
        return self._is_owner_for_folder(folder, user) or self._is_admin(folder, user)

    def _is_admin_for_file(self, file, user):
        """是否是文件协作管理员"""
        return FileCollaboration.objects.filter(file=file, user=user, permission='admin', is_active=True).exists()


    def _can_write(self, folder, user):
        """检查用户是否可以编辑指定的共享文件夹"""
        return self._is_admin(folder, user) or FolderCollaboration.objects.filter(
            folder=folder,
            user=user,
            permission__in=['write', 'admin'],
            is_active=True
        ).exists()

    def _can_write_with_ancestors(self, folder, user):
        """
        🔧 检查用户是否可以编辑文件夹（包括祖先文件夹的权限）
        用于钻取场景：子文件夹继承父共享文件夹的权限
        """
        if not folder:
            return False

        # 如果是共享文件夹本身，直接检查
        if folder.is_shared_folder:
            has_write = self._can_write(folder, user)
            if has_write:
                return True

        # 否则，向上追溯到根共享文件夹
        current = folder
        while current:
            if current.is_shared_folder:
                # 找到根共享文件夹，检查权限
                has_write = self._can_write(current, user)
                if has_write:
                    return True
            current = current.parent

        # 没有找到共享文件夹祖先，检查是否是用户自己的文件夹
        return folder.owner == user

    def _can_access(self, folder, user):
        """检查用户是否可以访问指定的共享文件夹"""
        return folder.owner == user or FolderCollaboration.objects.filter(
            folder=folder,
            user=user,
            is_active=True
        ).exists()

    def _can_access_with_ancestors(self, folder, user):
        """
        🔧 检查用户是否可以访问文件夹（包括祖先文件夹的权限）
        用于钻取场景：子文件夹继承父共享文件夹的权限
        """
        if not folder:
            return False

        # 如果是共享文件夹本身，直接检查
        if folder.is_shared_folder:
            has_access = self._can_access(folder, user)
            if has_access:
                return True

        # 否则，向上追溯到根共享文件夹
        current = folder
        while current:
            if current.is_shared_folder:
                # 找到根共享文件夹，检查权限
                has_access = self._can_access(current, user)
                if has_access:
                    return True
            current = current.parent

        # 没有找到共享文件夹祖先，检查是否是用户自己的文件夹
        return folder.owner == user


    def _get_user_permission(self, folder, user):
        """获取用户在共享文件夹中的权限"""
        if not folder:
            return None
        if folder.owner == user:
            return 'admin'
        collab = FolderCollaboration.objects.filter(
            folder=folder,
            user=user,
            is_active=True
        ).first()
        return collab.permission if collab else None

    def _can_move_file(self, file_obj, user):
        """检查是否可以移动文件"""

        # 如果是自己的文件，可以移动
        if file_obj.owner == user:
            return True
        # 如果文件在共享文件夹中，检查是否有写权限
        # if file_obj.folder and file_obj.folder.is_shared_folder:
        #     perm = self._get_user_permission(file_obj.folder, user)
        #     return perm in ['write', 'admin']

        return False

    def _can_move_folder(self, folder_obj, user):
        """检查是否可以移动文件夹"""
        # 如果是自己的文件夹，可以移动
        if folder_obj.owner == user:
            return True
        # 如果是共享文件夹，检查是否有管理员权限
        # if folder_obj.is_shared_folder:
        #     return self._is_admin(folder_obj, user)

        return False

    def _can_delete_file(self, file_obj, user):
        """检查是否可以删除文件"""
        # 如果是自己的文件，可以删除
        if file_obj.owner == user:
            return True
        # 如果是共享文件，检查是否有管理员权限
        # if file_obj.folder and file_obj.folder.is_shared_folder:
        #     return self._is_admin_or_owner(file_obj.folder, user)

        return False


    def _can_delete_folder(self, folder_obj, user):
        """检查是否可以删除文件夹"""
        # 如果是自己的文件夹，可以删除
        if folder_obj.owner == user:
            return True
        # 如果是共享文件夹，检查是否有管理员权限
        # if folder_obj.is_shared_folder:
        #     return self._is_admin_or_owner(folder_obj, user)

        return False



class IsCloudOwnerOrShared(permissions.BasePermission):
    """云文件所有者或已分享权限"""

    def has_object_permission(self, request, view, obj):
        if request.user.is_superuser:
            return True
        if obj.owner == request.user:
            return True
        if obj.folder and obj.folder.is_public:
            return True
        # 检查是否有分享权限
        if FileShare.objects.filter(
                Q(file=obj) | Q(folder=obj.folder),
                is_active=True,
                allowed_users=request.user
        ).exists():
            return True
        return False


class IsFolderOwnerOrShared(permissions.BasePermission):
    """文件夹所有者或已分享权限"""

    def has_object_permission(self, request, view, obj):
        if request.user.is_superuser:
            return True
        if obj.owner == request.user:
            return True
        if obj.is_public:
            return True
        # 检查是否有分享权限
        from .models import FileShare
        if FileShare.objects.filter(
                Q(folder=obj),
                is_active=True,
                allowed_users=request.user
        ).exists():
            return True
        return False


class FolderViewSet(viewsets.ModelViewSet, UtilsTools):
    """
    🔧 文件夹视图集
    - 支持文件夹的增删改查
    - 支持文件夹层级导航
    - 支持权限控制
    """
    queryset = Folder.objects.all()
    serializer_class = FolderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        """根据操作返回不同的序列化器"""
        if self.action == 'list':
            return FolderListSerializer
        return FolderSerializer

    def get_queryset(self):
        """
        🔧 动态过滤查询集
        - 只显示当前用户的文件夹或公开文件夹
        - 支持父文件夹过滤
        - 支持搜索
        - 🔧 关键：过滤已删除的文件夹
        """
        user = self.request.user
        # 🔧 关键修复：确保 deleted_at 字段存在后再过滤
        queryset = Folder.objects.filter(deleted_at__isnull=True, owner=user)

        # 🔧 关键修复：支持加载所有文件夹（用于移动模态框）
        load_all = self.request.query_params.get('load_all', 'false').lower() == 'true'

        if not load_all:
            # 普通查询：只返回指定父文件夹的子文件夹
            parent_id = self.request.query_params.get('parent', '')
            if parent_id and parent_id.lower() != 'null':
                queryset = queryset.filter(parent_id=parent_id)
            else:
                queryset = queryset.filter(parent__isnull=True)

        # 🔧 软删除过滤：只显示未删除的文件夹
        if hasattr(Folder, 'deleted_at'):
            queryset = queryset.filter(deleted_at__isnull=True)

        # 权限过滤：只显示当前用户的文件夹或公开文件夹
        if not user.is_superuser:
            queryset = queryset.filter(
                Q(owner=user) | Q(is_public=True)
            )

        # 🔧 搜索：按文件夹名称搜索
        search = self.request.query_params.get('search', '').strip()
        if search:
            queryset = queryset.filter(name__icontains=search)

        return queryset.select_related('owner').prefetch_related('children')

    def create(self, request, *args, **kwargs):
        """
        🔧 创建文件夹
        POST /api/cloud/folders/
        {
            "name": "新文件夹",
            "parent": "uuid-xxx"  // 可选，父文件夹 ID
        }
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # 🔧 自动设置所有者为当前用户
        serializer.save(owner=request.user)

        # 🔧 记录操作日志
        FileOperationLog.objects.create(
            folder=serializer.instance,
            user=request.user,
            operation='create',
            description=f'创建文件夹：{serializer.instance.name}',
            ip_address=get_request_ip(request),
            extra_data={  # ✅ 使用 extra_data 存储额外信息
                'folder_name': serializer.instance.name,
                'folder_id': str(serializer.instance.id),
            }
        )

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        """
        🔧 更新文件夹信息
        PUT/PATCH /api/cloud/folders/{id}/
        {
            "name": "新名称",
            "is_public": true  // 可选
        }
        """
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        if not self._can_write_with_ancestors(instance, request.user):
            return Response({'error': '无操作权限'}, status=403)

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        # 🔧 记录操作日志
        FileOperationLog.objects.create(
            folder=instance,
            user=request.user,
            operation='update',
            description=f'更新文件夹：{instance.name}',
            ip_address=get_request_ip(request),
            extra_data={  # ✅ 使用 extra_data 存储额外信息
                'folder_name': instance.name,
                'folder_id': str(instance.id),
            }
        )

        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def tree(self, request):
        """
        🔧 关键修复：返回所有文件夹的树状结构（用于移动模态框）
        GET /api/cloud/folders/tree/
        """
        try:
            # 获取用户所有文件夹
            folders = Folder.objects.filter(
                owner=request.user,
                deleted_at__isnull=True
            ).select_related('owner').order_by('name')

            # 🔧 构建树状结构
            def build_tree(folders_list, parent_id=None):
                tree = []
                children = [f for f in folders_list if f.parent_id == parent_id]

                for folder in children:
                    node = {
                        'id': str(folder.id),
                        'name': folder.name,
                        'is_shared_folder': folder.is_shared_folder,
                        'parent': str(folder.parent.id) if folder.parent else None,
                        'children': build_tree(folders_list, folder.id),
                        'owner': {
                            'id': folder.owner.id,
                            'real_name': folder.owner.real_name,
                            'username': folder.owner.username,
                            'avatar': folder.owner.avatar.url if folder.owner.avatar else None
                        }
                    }
                    tree.append(node)

                return tree

            tree_data = build_tree(folders)

            return Response({
                'folders': tree_data,
                'total': folders.count()
            })

        except Exception as e:
            logger.error(f'加载文件夹树失败：{e}')
            return Response(
                {'error': f'加载失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        """
        🔧 文件夹移动接口
        POST /api/cloud/folders/{id}/move/
        """
        try:
            logger.info(f'{request.user} 开始移动文件夹 {pk}')
            try:
                folder = Folder.objects.get(id=pk)
                if not self._can_move_folder(folder, request.user):
                    return Response({'error': '无操作权限'}, status=403)
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )
            from_parent = folder.parent
            new_parent_id = request.data.get('new_parent')
            logger.info(f'{request.user} 移动文件夹 {pk} 到 {new_parent_id}')

            # 🔧 验证：不能移动到自己的子文件夹
            if new_parent_id:
                try:
                    new_parent = Folder.objects.get(id=new_parent_id, owner=request.user)
                    logger.info(f'{request.user} 验证通过，开始移动文件夹 {pk} 到 new_parent: {new_parent}')
                    if self._is_descendant_of(new_parent, folder):
                        return Response(
                            {'error': '不能将文件夹移动到自己的子文件夹中'},
                            status=status.HTTP_400_BAD_REQUEST
                        )
                    folder.parent = new_parent
                except Folder.DoesNotExist:
                    return Response(
                        {'error': '目标文件夹不存在'},
                        status=status.HTTP_404_NOT_FOUND
                    )
            else:
                folder.parent = None
                new_parent = None

            folder.save()
            logger.info(f'{request.user} 移动文件夹 {pk} 成功')

            # 记录操作日志
            FileOperationLog.objects.create(
                folder=folder,
                user=request.user,
                operation='move',
                description=f'移动文件夹：{folder.name}',
                ip_address=get_request_ip(request),
                extra_data={  # ✅ 存储移动详情
                    'from_parent': str(from_parent.name) if from_parent else '根目录',
                    'to_parent': str(new_parent.name) if new_parent else '根目录',
                }
            )

            return Response({
                'message': '移动成功',
                'folder': FolderSerializer(folder).data
            })

        except Exception as e:
            logger.error(f'文件夹移动失败：{e}')
            return Response(
                {'error': f'移动失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def rename(self, request, pk=None):
        """
        🔧 重命名文件夹
        POST /api/cloud/folders/{id}/rename/
        {
            "name": "新名称"
        }
        """
        try:
            try:
                folder = Folder.objects.get(id=pk)
                if not self._can_write_with_ancestors(folder, request.user):
                    return Response({'error': '无操作权限'}, status=403)
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )
            new_name = request.data.get('name', '').strip()

            if not new_name:
                return Response(
                    {'error': '文件夹名称不能为空'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 验证：同一父文件夹下不能有重名
            if Folder.objects.filter(
                    parent=folder.parent,
                    name=new_name,
                    owner=request.user,
                    deleted_at__isnull=True
            ).exclude(id=folder.id).exists():
                return Response(
                    {'error': '该名称已存在'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            old_name = folder.name
            folder.name = new_name
            folder.save()

            # 🔧 记录操作日志
            FileOperationLog.objects.create(
                folder=folder,
                user=request.user,
                operation='rename',
                description=f'重命名文件夹：{old_name} -> {new_name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'old_name': old_name,
                    'new_name': new_name
                }
            )

            return Response({
                'message': '重命名成功',
                'id': folder.id,
                'name': folder.name,
                'old_name': old_name
            })
        except Exception as e:
            logger.error(f'文件夹重命名失败：{e}')
            return Response(
                {'error': f'重命名失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def delete(self, request, pk=None):
        """
        🔧 文件夹软删除接口（移动到回收站）
        POST /api/cloud/folders/{id}/delete/
        """
        try:
            try:
                folder = Folder.objects.get(id=pk)

                if not self._can_delete_folder(folder, request.user):
                    logger.warning(f'{request.user} 无权限删除文件夹 {folder}')
                    return Response({'error': '无操作权限'}, status=403)
                if folder.owner != request.user and not request.user.is_superuser:
                    logger.warning(f'{request.user} 无权限删除文件夹 {folder}')
                    return Response({'error': '无操作权限'}, status=403)
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 🔧 软删除：标记删除时间
            folder.deleted_at = timezone.now()
            folder.save()
            logger.info(f'{request.user} 删除文件夹 {folder} deleted_at: {folder.deleted_at}')
            # 🔧 递归软删除子文件夹和文件
            self._soft_delete_children(folder)

            logger.info(f'{request.user} 删除文件夹 {folder} 成功')
            # 记录操作日志
            FileOperationLog.objects.create(
                folder=folder,
                user=request.user,
                operation='delete',
                description=f'删除文件夹：{folder.name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'folder_name': folder.name,
                    'folder_id': str(folder.id),
                    'deleted_by': request.user.username,
                }
            )

            return Response({'message': '文件夹已移动到回收站'})

        except Exception as e:
            logger.error(f'文件夹删除失败：{e}')
            return Response(
                {'error': f'删除失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """
        🔧 文件夹恢复接口（从回收站）
        POST /api/cloud/folders/{id}/restore/
        """
        try:
            try:
                folder = Folder.objects.get(id=pk, owner=request.user)
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )

            if not folder.deleted_at:
                return Response(
                    {'error': '文件夹不在回收站'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 恢复文件夹
            folder.deleted_at = None
            folder.save()

            # 🔧 递归恢复子文件夹和文件
            self._restore_children(folder)

            # 记录操作日志
            FileOperationLog.objects.create(
                folder=folder,
                user=request.user,
                operation='restore',
                description=f'恢复文件夹：{folder.name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'folder_name': folder.name,
                    'folder_id': str(folder.id),
                    'operation_type': 'restore',
                }
            )

            return Response({
                'message': '文件夹已恢复',
                'folder': FolderSerializer(folder).data
            })

        except Exception as e:
            logger.error(f'文件夹恢复失败：{e}')
            return Response(
                {'error': f'恢复失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def permanent_delete(self, request, pk=None):
        """
        🔧 关键修复：文件夹永久删除接口（回收站专用）
        POST /api/cloud/folders/{id}/permanent_delete/

        逻辑：
        1. 验证文件夹属于当前用户
        2. 验证文件夹在回收站中
        3. 检查是否有活跃关联（分享、子内容关联等）
        4. 有关联：逻辑清空
        5. 无关联：递归物理清空
        """
        try:
            logger.info(f"{request.user} 开始永久删除文件夹 {pk}")

            # 🔧 1. 验证文件夹存在且属于当前用户
            try:
                folder = Folder.objects.get(id=pk, owner=request.user)
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在或无权操作'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 🔧 2. 验证文件夹在回收站中
            if not folder.deleted_at:
                return Response(
                    {'error': '文件夹不在回收站中，无法永久删除'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 3. 检查关联
            has_associations = self._check_folder_associations(folder)

            if has_associations:
                # 🔧 4. 有关联：逻辑清空
                logger.info(f"文件夹 {pk} 有活跃关联，执行逻辑清空")

                if hasattr(folder, 'permanently_deleted'):
                    folder.permanently_deleted = True
                    folder.save(update_fields=['permanently_deleted'])

                return Response({
                    'message': '文件夹有关联引用，已标记为永久删除（保留记录）',
                    'folder_id': str(folder.id),
                    'logical_delete': True,
                    'associations': has_associations
                })
            else:
                # 🔧 5. 无关联：物理清空
                logger.info(f"文件夹 {pk} 无关联，执行物理清空")

                folder_name = folder.name
                folder_id = folder.id

                # 递归物理删除
                self._physical_delete_folder(folder, user=request.user)

                # 🔧 记录操作日志
                FileOperationLog.objects.create(
                    folder=None,  # 文件夹已删除
                    user=request.user,
                    operation='permanent_delete',
                    description=f'永久删除文件夹：{folder_name}',
                    ip_address=get_request_ip(request),
                    extra_data={
                        'folder_id': str(folder_id),
                        'folder_name': folder_name,
                        'physical_delete': True
                    }
                )

                return Response({
                    'message': '文件夹已永久删除',
                    'folder_id': str(folder_id),
                    'folder_name': folder_name,
                    'logical_delete': False,
                    'physical_delete': True
                })

        except Exception as e:
            logger.error(f'文件夹永久删除失败：{e}', exc_info=True)
            return Response(
                {'error': f'删除失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _check_folder_associations(self, folder_obj):
        """
        🔧 检查文件夹是否有活跃关联
        """
        associations = []

        # 🔧 1. 检查文件夹分享
        active_shares = FileShare.objects.filter(
            folder=folder_obj,
            is_active=True
        ).exists()

        if active_shares:
            associations.append('share')
            logger.info(f'文件夹 {folder_obj.id} 有活跃分享关联')

        # 🔧 2. 检查子内容关联
        for child_file in CloudFile.objects.filter(folder=folder_obj, deleted_at__isnull=False):
            # 检查文件是否有分享
            file_shares = FileShare.objects.filter(
                file=child_file,
                is_active=True
            ).exists()

            if file_shares:
                associations.append('child_file_share')
                logger.info(f'文件夹 {folder_obj.id} 的子文件有活跃分享')
                break

        # 🔧 3. 检查子文件夹关联（递归）
        for child_folder in folder_obj.children.filter(deleted_at__isnull=False):
            if self._check_folder_associations(child_folder):
                associations.append('child_folder')
                break

        return associations if associations else False

    def _physical_delete_folder(self, folder_obj, user=None):
        """
        🔧 递归物理删除文件夹及其内容
        """

        # 🔧 1. 删除子文件夹（递归）
        for child_folder in folder_obj.children.filter(deleted_at__isnull=False):
            self._physical_delete_folder(child_folder, user=user)

        # 🔧 2. 删除文件
        for file_obj in CloudFile.objects.filter(folder=folder_obj, deleted_at__isnull=False):
            file_path = file_obj.file.path if file_obj.file else None
            if file_path and os.path.exists(file_path):
                try:
                    file_size = os.path.getsize(file_path)
                    os.remove(file_path)
                    logger.info(f'user: {user} 已删除物理文件：{file_path} ({file_size} bytes)')
                except Exception as e:
                    logger.warning(f'user: {user} 删除物理文件失败 {file_path}: {e}')

            # 恢复聊天文件的同步状态
            upload_file = FileUpload.objects.filter(md5=file_obj.md5, uploaded_by=user,
                                                    is_sync_to_cloud=True)
            if upload_file:
                upload_file.update(is_sync_to_cloud=False)
                logger.info(f'user: {user} 已恢复文件同步状态：{upload_file}')

            file_obj.delete()

        # 🔧 3. 删除文件夹本身
        folder_obj.delete()
        logger.info(f'user: {user} 已删除文件夹：{folder_obj.id}')

    # cloud/views.py - FolderViewSet.download 方法修复版

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """
        🔧 关键修复：文件夹递归打包下载（支持多级目录）
        GET /api/cloud/folders/{id}/download/

        功能：
        1. 递归遍历文件夹及其所有子文件夹
        2. 保持原有目录结构打包为 ZIP
        3. 支持大文件下载（流式处理）
        4. 记录详细操作日志
        """

        try:
            config = CloudSystemConfig.objects.filter(key='system.download_enabled').first()
            if config:
                download_enabled = config.get_value('system.download_enabled')
                if not download_enabled:
                    return Response({'error': '下载功能已禁用，请联系管理员！'}, status=status.HTTP_403_FORBIDDEN)
        except Exception as e:
            logger.error(f"Error: {e}")

        try:
            # 🔧 1. 验证文件夹权限
            try:
                folder = Folder.objects.get(id=pk, owner=request.user)
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在或无权访问'},
                    status=status.HTTP_404_NOT_FOUND
                )

            folder_name = folder.name if folder.name else 'shared_folder'
            safe_filename = self._sanitize_filename(folder_name)

            # 构建 Content-Disposition（支持中文文件名）
            content_disposition = self._build_content_disposition(f"{safe_filename}.zip")

            # 🔧 2. 创建内存中的 ZIP 缓冲区
            buffer = io.BytesIO()

            # 🔧 3. 统计信息（用于日志）
            stats = {
                'files_count': 0,
                'folders_count': 0,
                'total_size': 0,
                'errors': []
            }

            # 🔧 4. 创建 ZIP 文件（使用流式压缩）
            with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zip_file:
                # 🔧 关键修复：递归添加文件夹内容（保持目录结构）
                self._add_folder_to_zip_recursive(
                    folder=folder,
                    zip_file=zip_file,
                    zip_base_path='',  # ZIP 中的基础路径（根目录为空）
                    stats=stats
                )

            # 🔧 5. 获取压缩后的大小
            zip_size = buffer.tell()
            buffer.seek(0)  # 🔧 重置指针到开头

            # 🔧 6. 创建 HTTP 响应（支持大文件下载）
            response = HttpResponse(buffer.getvalue(), content_type='application/zip')
            response['Content-Disposition'] = content_disposition
            response['Content-Length'] = zip_size
            response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response['Pragma'] = 'no-cache'
            response['Expires'] = '0'

            # 🔧 7. 记录操作日志
            FileOperationLog.objects.create(
                folder=folder,
                user=request.user,
                operation='download',
                description=f'下载文件夹：{folder.name}（包含 {stats["files_count"]} 个文件, {stats["folders_count"]} 个子文件夹）',
                ip_address=get_request_ip(request),
                extra_data={
                    'folder_id': str(folder.id),
                    'folder_name': folder.name,
                    'zip_size': zip_size,
                    'files_count': stats['files_count'],
                    'folders_count': stats['folders_count'],
                    'errors': stats['errors'][:10]  # 只记录前 10 个错误
                }
            )

            logger.info(f'文件夹下载成功：{folder.name}, ZIP 大小：{zip_size} bytes, 文件数：{stats["files_count"]}')
            return response

        except MemoryError:
            logger.error(f'文件夹下载失败（内存不足）：{pk}')
            return Response(
                {'error': '文件夹过大，无法打包下载，请分批下载'},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            )
        except Exception as e:
            logger.error(f'文件夹下载失败：{e}', exc_info=True)
            return Response(
                {'error': f'下载失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # 🔧 新增：构建 Content-Disposition 头（支持中文文件名）
    def _build_content_disposition(self, filename):
        """
        🔧 构建 Content-Disposition 头，支持中文和特殊字符文件名
        使用 RFC 5987 编码格式
        """
        # ASCII 文件名（兼容旧浏览器）
        ascii_filename = filename.encode('ascii', 'ignore').decode('ascii')

        # UTF-8 编码文件名（支持中文）
        encoded_filename = quote(filename)

        # 返回双重格式，确保最大兼容性
        return f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'

    def _add_folder_to_zip_recursive(self, folder, zip_file, zip_base_path='', stats=None):
        """
        🔧 关键修复：递归添加文件夹内容到 ZIP（支持多级目录）

        @param folder: 当前处理的 Folder 对象
        @param zip_file: zipfile.ZipFile 对象
        @param zip_base_path: 在 ZIP 文件中的基础路径（用于构建相对路径）
        @param stats: 统计信息字典（可选，用于记录下载统计）

        目录结构示例：
        原文件夹结构：
            📁 项目资料/
            ├── 📄 需求文档.docx
            ├── 📁 设计稿/
            │   ├── 🖼️ 首页.png
            │   └── 📁 图标/
            │       └── 🖼️ logo.svg
            └── 📁 代码/
                └── 💻 main.py

        ZIP 中的结构：
            📦 项目资料.zip
            ├── 📄 需求文档.docx
            ├── 📁 设计稿/
            │   ├── 🖼️ 首页.png
            │   └── 📁 图标/
            │       └── 🖼️ logo.svg
            └── 📁 代码/
                └── 💻 main.py
        """

        if stats is None:
            stats = {'files_count': 0, 'folders_count': 0, 'total_size': 0, 'errors': []}

        # 🔧 1. 添加当前文件夹内的所有文件
        files = CloudFile.objects.filter(
            folder=folder,
            deleted_at__isnull=True
        ).select_related('owner')

        for file_obj in files:
            if not file_obj.file:
                continue

            try:
                file_path = file_obj.file.path

                # 验证文件存在
                if not os.path.exists(file_path):
                    logger.warning(f'文件不存在，跳过：{file_path}')
                    stats['errors'].append(f'文件不存在：{file_obj.name}')
                    continue

                # 🔧 构建在 ZIP 中的相对路径
                # 如果 zip_base_path 为空，文件直接放在 ZIP 根目录
                # 否则放在 zip_base_path/文件名
                if zip_base_path:
                    arcname = os.path.join(zip_base_path,
                                           self._sanitize_filename(file_obj.name or file_obj.original_name))
                else:
                    arcname = self._sanitize_filename(file_obj.name or file_obj.original_name)

                # 🔧 写入文件到 ZIP（保持原有文件名）
                zip_file.write(file_path, arcname)

                # 更新统计
                stats['files_count'] += 1
                stats['total_size'] += file_obj.size or 0

                logger.debug(f'✓ 已添加文件：{arcname} ({self._format_size(file_obj.size)})')

            except FileNotFoundError:
                logger.warning(f'文件已删除：{file_obj.name}')
                stats['errors'].append(f'文件已删除：{file_obj.name}')
            except PermissionError:
                logger.warning(f'无权限读取文件：{file_obj.file.path}')
                stats['errors'].append(f'无权限：{file_obj.name}')
            except Exception as e:
                logger.warning(f'添加文件失败 {file_obj.name}: {e}')
                stats['errors'].append(f'{file_obj.name}: {str(e)[:50]}')

        # 🔧 2. 递归处理所有子文件夹
        subfolders = Folder.objects.filter(
            parent=folder,
            deleted_at__isnull=True,
            owner=folder.owner  # 确保是同一用户的文件夹
        ).order_by('name')

        for child_folder in subfolders:
            # 🔧 构建子文件夹在 ZIP 中的路径
            if zip_base_path:
                child_zip_path = os.path.join(zip_base_path, self._sanitize_filename(child_folder.name))
            else:
                child_zip_path = self._sanitize_filename(child_folder.name)

            # 🔧 添加空文件夹标记（ZIP 标准：以 / 结尾表示文件夹）
            # 注意：Python zipfile 会自动处理文件夹，但显式添加更可靠
            zip_file.writestr(f'{child_zip_path}/', '')

            # 更新统计
            stats['folders_count'] += 1

            logger.debug(f'✓ 处理子文件夹：{child_zip_path}/')

            # 🔧 递归处理子文件夹内容
            self._add_folder_to_zip_recursive(
                folder=child_folder,
                zip_file=zip_file,
                zip_base_path=child_zip_path,
                stats=stats
            )

        return stats

    @action(detail=True, methods=['get'])
    def statistics(self, request, pk=None):
        """
        🔧 获取文件夹统计信息
        GET /api/cloud/folders/{id}/statistics/
        """
        folder = self.get_object()

        # 🔧 计算文件夹内的文件总数和总大小
        file_count = CloudFile.objects.filter(
            folder=folder,
            deleted_at__isnull=True
        ).count()

        total_size = CloudFile.objects.filter(
            folder=folder,
            deleted_at__isnull=True
        ).aggregate(total_size=models.Sum('size'))['total_size'] or 0

        # 🔧 计算子文件夹数量
        subfolder_count = Folder.objects.filter(
            parent=folder,
            deleted_at__isnull=True
        ).count()

        return Response({
            'file_count': file_count,
            'total_size': total_size,
            'total_size_formatted': self._format_size(total_size),
            'subfolder_count': subfolder_count
        })

    # ==================== 辅助方法 ====================

    def _sanitize_filename(self, filename):
        """
        🔧 安全处理文件名，防止路径遍历攻击和非法字符
        """

        if not filename:
            return 'unnamed'

        # 1. 移除路径分隔符，防止路径遍历
        filename = os.path.basename(str(filename))

        # 2. 移除或替换非法字符（Windows/Linux 兼容）
        # 保留中文、英文、数字、下划线、点、横杠、空格
        filename = re.sub(r'[<>:"|?*\\]', '_', filename)

        # 3. 移除首尾空格和点
        filename = filename.strip('. ')

        # 4. 限制长度（避免超长文件名）
        if len(filename) > 200:
            name, ext = os.path.splitext(filename)
            filename = name[:190] + ext

        # 5. 确保不为空
        if not filename or filename == '.':
            filename = 'unnamed_file'

        return filename

    def _format_size(self, size_bytes):
        """格式化文件大小"""
        if size_bytes is None or size_bytes == 0:
            return '0 B'

        units = ['B', 'KB', 'MB', 'GB', 'TB']
        unit_index = 0
        size = float(size_bytes)

        while size >= 1024 and unit_index < len(units) - 1:
            size /= 1024
            unit_index += 1

        return f'{size:.2f} {units[unit_index]}'

    def _is_descendant_of(self, potential_descendant, ancestor):
        """
        🔧 检查 potential_descendant 是否是 ancestor 的后代
        用于防止循环引用
        """
        current = potential_descendant
        while current:
            if current.id == ancestor.id:
                return True
            current = current.parent
        return False

    def _soft_delete_children(self, folder):
        """递归软删除子文件夹和文件"""

        # 软删除子文件夹
        for child in folder.children.filter(deleted_at__isnull=True):
            child.deleted_at = timezone.now()
            child.save()
            # 软删除子文件夹内的文件
            CloudFile.objects.filter(folder=child).update(deleted_at=timezone.now())
            # 递归处理
            self._soft_delete_children(child)

        # 软删除当前文件夹内的文件
        CloudFile.objects.filter(folder=folder).update(deleted_at=timezone.now())

    def _restore_children(self, folder):
        """递归恢复子文件夹和文件"""

        # 恢复子文件夹
        for child in folder.children.filter(deleted_at__isnull=False):
            child.deleted_at = None
            child.save()
            # 恢复子文件夹内的文件
            CloudFile.objects.filter(folder=child).update(deleted_at=None)
            # 递归处理
            self._restore_children(child)

        # 恢复当前文件夹内的文件
        CloudFile.objects.filter(folder=folder).update(deleted_at=None)

    def _permanent_delete_children(self, folder):
        """递归永久删除子文件夹和文件"""
        from .models import CloudFile
        import os

        # 永久删除子文件夹
        for child in folder.children.filter(deleted_at__isnull=False):
            # 递归删除子文件夹内容
            self._permanent_delete_children(child)
            # 删除子文件夹记录
            child.delete()

        # 永久删除当前文件夹内的文件
        for file_obj in CloudFile.objects.filter(folder=folder, deleted_at__isnull=False):
            # 删除物理文件
            if file_obj.file and os.path.exists(file_obj.file.path):
                try:
                    os.remove(file_obj.file.path)
                except:
                    pass
            # 删除数据库记录
            file_obj.delete()


# cloud/views.py
class CloudFileViewSet(viewsets.ModelViewSet, UtilsTools):
    """云文件视图集 - 支持分片上传/断点续传/秒传"""

    queryset = CloudFile.objects.filter(deleted_at__isnull=True)
    serializer_class = CloudFileSerializer
    permission_classes = [permissions.IsAuthenticated]
    # 🔧 关键修复：同时支持表单上传和 JSON 请求
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    pagination_class = CloudPagination

    # 🔧 新增：注册过滤后端
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_class = CloudFileFilter
    search_fields = ['name', 'original_name', 'description', 'tags']

    # 配置参数
    CHUNK_SIZE = 5 * 1024 * 1024  # 默认分片大小: 5MB
    SESSION_EXPIRE_HOURS = 24  # 会话过期时间: 24小时
    TEMP_UPLOAD_DIR = 'temp_uploads'  # 临时上传目录


    def get_queryset(self):
        """
        🔧 关键修复：基础查询集
        - 过滤已删除的文件（正常视图不显示回收站）
        - 只显示当前用户的文件
        - 根据 folder 参数过滤（钻取）
        - 星标/搜索等过滤由 filter_backends 和 CloudFileFilter 处理
        """
        user = self.request.user

        # 基础过滤：当前用户 + 未删除
        queryset = CloudFile.objects.filter(
            owner=user,
            deleted_at__isnull=True
        ).select_related('owner', 'folder')

        # 如果是回收站视图，通过 CloudFileFilter 处理 trash 参数
        # 这里只做基础过滤，不处理 trash/starred 等特殊逻辑

        # 🔧 文件夹钻取过滤 (folder 参数)
        folder_id = self.request.query_params.get('folder', '')
        if folder_id and folder_id.lower() != 'null' and folder_id != '':
            queryset = queryset.filter(folder_id=folder_id)
        else:
            queryset = queryset.filter(folder__isnull=True)

        # 🔧 搜索过滤由 SearchFilter 处理，不需要在这里单独处理

        return queryset.order_by('-updated_at')


    @action(detail=False, methods=['get'])
    def trash_items(self, request, *args, **kwargs):
        """
        🔧 回收站所有项目（文件 + 文件夹）
        GET /api/cloud/files/trash_items/
        """
        try:
            queryset = CloudFile.objects.filter(deleted_at__isnull=False, owner=request.user)

            subfolders = Folder.objects.filter(
                parent__isnull=True,
                owner=request.user,
                deleted_at__isnull=False
            )

            folder_data = FolderListSerializer(subfolders, many=True, context={'request': request}).data
            for item in folder_data:
                item['is_folder'] = True
                item['item_type'] = 'folder'

            file_data = self.get_serializer(queryset, many=True, context={'request': request}).data
            for item in file_data:
                item['is_folder'] = False
                item['item_type'] = 'file'

            combined = folder_data + file_data
            combined.sort(key=lambda x: x.get('deleted_at', '') or '', reverse=True)

            return Response({
                'items': combined,
                'total': len(combined),
                'file_count': len(file_data),
                'folder_count': len(folder_data)
            })
        except Exception as e:
            logger.error(f'获取回收站项目失败：{e}')
            return Response(
                {'error': f'获取失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


    def list(self, request, *args, **kwargs):
        """
        🔧 关键修复：混合返回文件夹 + 文件，支持分页
        - 应用所有 filter_backends 过滤
        - 分页处理
        - 混合文件夹和文件
        """
        try:
            # 1. 获取基础 queryset
            queryset = self.get_queryset()

            # 2. 应用所有 filter_backends (CloudFileFilter + SearchFilter)
            queryset = self.filter_queryset(queryset)

            # 3. 分页处理
            page = self.paginate_queryset(queryset)

            # 4. 获取当前文件夹ID
            folder_id = request.query_params.get('folder', '')
            if folder_id and folder_id.lower() == 'null':
                folder_id = ''

            # 5. 获取当前层级的子文件夹（不受分页影响）
            if folder_id and folder_id != '':
                subfolders = Folder.objects.filter(
                    parent_id=folder_id,
                    owner=request.user,
                    deleted_at__isnull=True
                ).order_by('name')
            else:
                subfolders = Folder.objects.filter(
                    parent__isnull=True,
                    owner=request.user,
                    deleted_at__isnull=True
                ).order_by('name')

            # 6. 序列化文件夹和文件
            # 注意：文件夹不参与分页，文件参与分页
            folder_data = FolderListSerializer(
                subfolders,
                many=True,
                context={'request': request}
            ).data
            for item in folder_data:
                item['is_folder'] = True

            if page is not None:
                file_data = self.get_serializer(page, many=True, context={'request': request}).data
                for item in file_data:
                    item['is_folder'] = False

                # 合并并排序：文件夹在前，按名称排序
                combined = folder_data + file_data
                combined.sort(key=lambda x: (not x['is_folder'], x.get('name', '').lower()))

                # 返回分页响应
                return self.get_paginated_response(combined)

            # 无分页时（降级处理）
            file_data = self.get_serializer(queryset, many=True, context={'request': request}).data
            for item in file_data:
                item['is_folder'] = False

            combined = folder_data + file_data
            combined.sort(key=lambda x: (not x['is_folder'], x.get('name', '').lower()))

            return Response({
                'results': combined,
                'count': queryset.count() + subfolders.count()
            })

        except Exception as e:
            logger.error(f'文件列表查询失败: {e}', exc_info=True)
            return Response(
                {'error': f'查询失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )



    def perform_create(self, serializer):
        """🔧 关键修复：确保 owner 被设置"""
        # 序列化器的 create 方法已经设置了 owner
        # 这里可以添加额外的逻辑
        serializer.save()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context.update({'request': self.request})
        return context

    def create(self, request, *args, **kwargs):
        """🔧 关键修复：支持秒传 + 多用户独立可见"""

        logger.info(f'request.FILES: {list(request.FILES.keys())}')
        logger.info(f'request.data: {request.data}')

        try:
            # 1️⃣ 先获取公共参数（无论是否秒传都需要）
            folder_id = request.data.get('folder')
            description = request.data.get('description', '')
            tags = request.data.get('tags', '')

            # 2️⃣ 🔧 关键修复：支持前端直接传递 MD5 进行秒传（不上传文件）
            file_md5 = request.data.get('md5')
            uploaded_file = request.FILES.get('file')

            # 3️⃣ 参数校验：必须有 MD5 或文件
            if not file_md5 and not uploaded_file:
                return Response(
                    {'error': '缺少文件参数', 'detail': '请上传文件或传递 md5 参数'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 4️⃣ 如果没有 MD5，计算上传文件的 MD5
            if not file_md5 and uploaded_file:
                md5 = hashlib.md5()
                for chunk in uploaded_file.chunks():
                    md5.update(chunk)
                file_md5 = md5.hexdigest()

            # 5️⃣ 🔧 检查是否已存在相同文件（秒传功能）
            existing_file = CloudFile.objects.filter(
                md5=file_md5,
                deleted_at__isnull=True
            ).first()

            if existing_file:
                # 🔧 秒传命中：直接创建数据库记录，绕过序列化器验证
                logger.info(f'秒传命中，为用户 {request.user} 创建新记录，复用文件 {existing_file.id}')

                # 直接创建记录（不使用 serializer，避免 file 字段验证）
                new_file = CloudFile.objects.create(
                    owner=request.user,
                    folder_id=folder_id if folder_id else None,
                    description=description,
                    tags=tags,
                    md5=file_md5,
                    name=uploaded_file.name if uploaded_file else existing_file.name,
                    original_name=uploaded_file.name if uploaded_file else existing_file.original_name,
                    size=existing_file.size,
                    mime_type=existing_file.mime_type,
                    file=existing_file.file,  # 🔧 关键：复用同一物理文件路径
                )

                # 记录操作日志
                FileOperationLog.objects.create(
                    file=new_file,
                    user=request.user,
                    operation='upload',
                    description=f'秒传文件：{new_file.name}',
                    ip_address=get_request_ip(request),
                    extra_data={
                        'original_file_id': str(existing_file.id),
                        'file_md5': file_md5,
                        'quick_upload': True,
                    }
                )

                # 序列化返回结果
                serializer = self.get_serializer(new_file)
                return Response({
                    **serializer.data,
                    'exists': True,
                    'message': '文件已存在，秒传成功'
                }, status=status.HTTP_200_OK)

            # 6️⃣ 🔧 首次上传：正常流程（必须有文件）
            if not uploaded_file:
                return Response(
                    {'error': '未找到上传的文件', 'detail': '请确保使用 multipart/form-data 格式上传'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 正常上传流程（使用序列化器）
            file_data = {
                'file': uploaded_file,
                'folder': folder_id,
                'description': description,
                'tags': tags,
                'md5': file_md5,
                'name': uploaded_file.name,
                'original_name': uploaded_file.name,
                'size': uploaded_file.size,
                'mime_type': uploaded_file.content_type or '',
            }

            serializer = self.get_serializer(data=file_data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)

            FileOperationLog.objects.create(
                file=serializer.instance,
                user=request.user,
                operation='upload',
                description=f'上传文件：{uploaded_file.name}',
                ip_address=get_request_ip(request),
                extra_data={'quick_upload': False}
            )

            return Response({
                **serializer.data,
                'exists': False,
                'message': '文件上传成功'
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f'文件上传失败: {e}', exc_info=True)
            return Response(
                {'error': f'上传失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # =================== 分片上传开始 ===================

    def get_temp_upload_path(self, session_id):
        """获取临时上传目录路径"""
        return os.path.join(
            settings.MEDIA_ROOT,
            self.TEMP_UPLOAD_DIR,
            str(session_id)
        )

    def _calculate_md5(self, file_obj, chunk_size=8192):
        """计算文件/文件流的MD5"""
        md5 = hashlib.md5()
        if isinstance(file_obj, str):
            # 文件路径
            with open(file_obj, 'rb') as f:
                while chunk := f.read(chunk_size):
                    md5.update(chunk)
        else:
            # 文件对象/内存流
            file_obj.seek(0)
            while chunk := file_obj.read(chunk_size):
                md5.update(chunk)
            file_obj.seek(0)
        return md5.hexdigest()

    def _ensure_temp_dir(self, session_id):
        """确保临时目录存在"""
        temp_dir = self.get_temp_upload_path(session_id)
        os.makedirs(temp_dir, exist_ok=True)
        return temp_dir

    def _cleanup_temp_files(self, session):
        """清理临时文件"""
        temp_dir = self.get_temp_upload_path(session.id)
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"清理临时目录: {temp_dir}")
            except Exception as e:
                logger.warning(f"清理临时目录失败 {temp_dir}: {e}")

    @action(detail=False, methods=['post'])
    def init_upload(self, request):
        """
        🔧 初始化上传会话 (重构版)
        POST /api/cloud/files/init_upload/

        逻辑优化：
        1. 参数校验与清洗
        2. 秒传检查 (全局去重)
        3. 断点续传检查 (用户级会话恢复)
        4. 创建新会话 (原子性操作)
        """
        try:
            # 1. 获取并清洗参数
            file_name = request.data.get('file_name', '').strip()
            file_size = request.data.get('file_size')
            file_md5 = request.data.get('file_md5', '').lower().strip()
            chunk_size = request.data.get('chunk_size', self.CHUNK_SIZE)

            # 可选参数
            folder_id = request.data.get('folder')
            description = request.data.get('description', '')
            tags = request.data.get('tags', '')

            # 2. 基础参数校验
            if not all([file_name, file_size, file_md5]):
                return Response(
                    {'error': '缺少必要参数: file_name, file_size, file_md5'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # MD5 格式校验
            if not re.match(r'^[a-f0-9]{32}$', file_md5):
                return Response(
                    {'error': '无效的MD5格式，应为32位十六进制字符串'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 文件大小校验
            try:
                file_size = int(file_size)
                chunk_size = int(chunk_size)
                if file_size <= 0 or chunk_size <= 0:
                    raise ValueError
            except (ValueError, TypeError):
                return Response(
                    {'error': 'file_size 和 chunk_size 必须为正整数'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 3. 秒传检查 (全局范围，只要文件存在且未删除即可秒传)
            existing_file = CloudFile.objects.filter(
                md5=file_md5,
                deleted_at__isnull=True
            ).first()

            if existing_file:
                logger.info(f"user: {request.user}, 文件已存在: {file_md5}, 秒传成功")
                # 直接创建记录（不使用 serializer，避免 file 字段验证）
                new_file = CloudFile.objects.create(
                    owner=request.user,
                    folder_id=folder_id if folder_id else None,
                    description=description,
                    tags=tags,
                    md5=file_md5,
                    name=file_name if file_name else existing_file.name,
                    original_name=file_name if file_name else existing_file.original_name,
                    size=existing_file.size,
                    mime_type=existing_file.mime_type,
                    file=existing_file.file,  # 🔧 关键：复用同一物理文件路径
                )

                # 记录操作日志
                FileOperationLog.objects.create(
                    file=new_file,
                    user=request.user,
                    operation='upload',
                    description=f'秒传文件：{new_file.name}',
                    ip_address=get_request_ip(request),
                    extra_data={
                        'original_file_id': str(existing_file.id),
                        'file_md5': file_md5,
                        'quick_upload': True,
                    }
                )

                serializer = self.get_serializer(existing_file)
                return Response({
                    'status': 'quick_upload',
                    'message': '文件已存在，秒传成功',
                    'file': serializer.data,
                    'exists': True
                }, status=status.HTTP_200_OK)

            # 4. 断点续传检查 (查找当前用户未完成的同名/同MD5会话)
            existing_session = UploadSession.objects.filter(
                file_md5=file_md5,
                user=request.user,
                is_completed=False,
                expires_at__gt=timezone.now()
            ).order_by('-created_at').first()

            if existing_session:
                # 如果找到旧会话，检查是否需要更新元数据（如文件夹ID），这里暂保持原会话信息
                serializer = UploadSessionSerializer(existing_session)
                return Response({
                    'status': 'resume_upload',
                    'message': '发现未完成的上传会话，支持断点续传',
                    'session': serializer.data,
                    'missing_chunks': existing_session.get_missing_chunks(),
                    'exists': False
                }, status=status.HTTP_200_OK)

            # 5. 创建新的上传会话
            # 计算总分片数
            total_chunks = (file_size + chunk_size - 1) // chunk_size

            with transaction.atomic():
                session = UploadSession.objects.create(
                    user=request.user,
                    file_md5=file_md5,
                    file_name=file_name,
                    file_size=file_size,
                    total_chunks=total_chunks,
                    chunk_size=chunk_size,
                    expires_at=timezone.now() + timedelta(hours=self.SESSION_EXPIRE_HOURS),
                    # 临时路径先设为空或占位，ID生成后更新
                    temp_path=''
                )

                # 更新临时路径 (依赖 session.id)
                temp_path = self.get_temp_upload_path(session.id)
                session.temp_path = temp_path
                session.save(update_fields=['temp_path'])

                # 确保物理目录存在
                self._ensure_temp_dir(session.id)

            logger.info(
                f"创建上传会话成功: session_id={session.id}, "
                f"user={request.user.username}, file={file_name}, "
                f"size={file_size}, chunks={total_chunks}"
            )

            serializer = UploadSessionSerializer(session)
            return Response({
                'status': 'need_upload',
                'message': '请开始上传分片',
                'session': serializer.data,
                'missing_chunks': list(range(total_chunks)),
                'chunk_size': chunk_size,
                'exists': False
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f"初始化上传失败: {e}", exc_info=True)
            return Response(
                {'error': f'初始化上传失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # 🔧 显式指定只支持 multipart
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser])
    @transaction.atomic  # 🔧 关键修复：添加事务装饰器
    def upload_chunk(self, request):
        """
        🔧 上传单个分片
        POST /api/cloud/files/upload_chunk/
        Content-Type: multipart/form-data

        请求参数:
        - session_id: UUID (表单字段)
        - chunk_index: int (表单字段)
        - chunk_md5: string (表单字段, 分片内容的MD5)
        - chunk: file (表单字段, 分片文件)

        响应:
        {
            "success": true,
            "chunk_index": 0,
            "progress": 20.5,  // 上传进度百分比
            "message": "分片上传成功"
        }
        """
        try:
            chunk_index = request.data.get('chunk_index')

            # 🔧 参数校验
            if chunk_index is None:
                return Response({'error': '缺少 chunk_index 参数'}, status=400)

            try:
                chunk_index = int(chunk_index)
                if chunk_index < 0:
                    raise ValueError()
            except (ValueError, TypeError):
                return Response({'error': f'无效的 chunk_index: {chunk_index}'}, status=400)

            # serializer = ChunkUploadSerializer(
            #     data=request.data,
            #     context={'request': request}
            # )
            # serializer.is_valid(raise_exception=True)
            #
            # session_id = serializer.validated_data['session_id']
            # chunk_index = serializer.validated_data['chunk_index']
            # chunk_md5 = serializer.validated_data['chunk_md5'].lower()
            # chunk_file = serializer.validated_data['chunk']

            session_id = request.data.get('session_id')
            chunk_index = int(request.data.get('chunk_index'))
            chunk_md5 = request.data.get('chunk_md5').lower()
            chunk_file = request.FILES.get('chunk')

            # 获取上传会话
            try:
                session = UploadSession.objects.select_for_update().get(
                    id=session_id,
                    user=request.user,
                    is_completed=False
                )
            except UploadSession.DoesNotExist:
                return Response(
                    {'error': '上传会话不存在或已完成'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 检查会话是否过期
            if session.is_expired():
                session.delete()
                return Response(
                    {'error': '上传会话已过期，请重新初始化'},
                    status=status.HTTP_410_GONE
                )

            # 验证分片索引
            if chunk_index < 0 or chunk_index >= session.total_chunks:
                return Response(
                    {'error': f'分片索引 {chunk_index} 超出范围(0-{session.total_chunks - 1})'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 检查分片是否已上传(支持重复上传的幂等性)
            if session.is_chunk_uploaded(chunk_index):
                logger.info(f"分片 {chunk_index} 已上传，跳过")
                return Response({
                    'success': True,
                    'chunk_index': chunk_index,
                    'progress': session.get_upload_progress(),
                    'message': '分片已存在，跳过上传',
                    'skipped': True
                }, status=status.HTTP_200_OK)

            # 🔧 验证分片MD5
            chunk_md5_calculated = self._calculate_md5(chunk_file)
            if chunk_md5_calculated != chunk_md5:
                return Response(
                    {'error': f'分片MD5校验失败: 期望{chunk_md5}, 实际{chunk_md5_calculated}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 保存分片到临时目录
            temp_dir = self._ensure_temp_dir(session.id)
            chunk_filename = f"chunk_{chunk_index:05d}"  # 00000, 00001, ...
            chunk_path = os.path.join(temp_dir, chunk_filename)

            # 保存文件
            with open(chunk_path, 'wb') as f:
                for chunk in chunk_file.chunks():
                    f.write(chunk)

            # 🔧 更新会话进度
            session.add_uploaded_chunk(chunk_index)

            logger.info(
                f"分片上传成功: session={session.id}, chunk={chunk_index}, "
                f"progress={session.get_upload_progress()}%"
            )

            # 检查是否所有分片都已上传
            if len(session.uploaded_chunks) == session.total_chunks:
                return Response({
                    'success': True,
                    'chunk_index': chunk_index,
                    'progress': 100.0,
                    'message': '所有分片已上传完成，请调用 merge_chunks 合并',
                    'all_chunks_uploaded': True
                }, status=status.HTTP_200_OK)

            return Response({
                'success': True,
                'chunk_index': chunk_index,
                'progress': session.get_upload_progress(),
                'message': '分片上传成功',
                'next_chunk': session.get_missing_chunks()[0] if session.get_missing_chunks() else None
            }, status=status.HTTP_200_OK)

        except serializers.ValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"分片上传失败: {e}", exc_info=True)
            return Response(
                {'error': f'分片上传失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'])
    @transaction.atomic  # 🔧 关键修复：添加事务装饰器
    def merge_chunks(self, request):
        """
        🔧 合并所有分片并完成上传
        POST /api/cloud/files/merge_chunks/

        请求参数:
        {
            "session_id": "uuid-xxx",
            "folder": "uuid-xxx",  // 可选
            "description": "",     // 可选
            "tags": ""            // 可选
        }

        响应:
        {
            "success": true,
            "file": {...},  // 创建的云文件信息
            "message": "文件上传成功"
        }
        """
        try:

            # 🔧 兼容处理：空字符串转 null
            data = request.data.copy()
            if data.get('description') == '':
                data['description'] = None
            if data.get('tags') == '':
                data['tags'] = None

            # 使用兼容后的数据创建序列化器
            serializer = MergeChunksSerializer(data=data)
            serializer.is_valid(raise_exception=True)

            session_id = serializer.validated_data['session_id']
            folder_id = serializer.validated_data.get('folder')
            description = serializer.validated_data.get('description')
            tags = serializer.validated_data.get('tags')

            # 获取上传会话
            try:
                session = UploadSession.objects.select_for_update().get(
                    id=session_id,
                    user=request.user,
                    is_completed=False
                )
            except UploadSession.DoesNotExist:
                return Response(
                    {'error': '上传会话不存在或已完成'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 检查是否所有分片都已上传
            if len(session.uploaded_chunks) != session.total_chunks:
                missing = session.get_missing_chunks()
                return Response(
                    {
                        'error': f'还有 {len(missing)} 个分片未上传',
                        'missing_chunks': missing[:10]  # 只返回前10个
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 合并分片
            temp_dir = session.temp_path
            merged_file_path = os.path.join(temp_dir, 'merged_file')

            logger.info(f"开始合并分片: session={session.id}, 总分片={session.total_chunks}")

            with open(merged_file_path, 'wb') as merged_file:
                for chunk_index in range(session.total_chunks):
                    chunk_path = os.path.join(temp_dir, f"chunk_{chunk_index:05d}")
                    if not os.path.exists(chunk_path):
                        raise FileNotFoundError(f"分片文件不存在: {chunk_path}")

                    with open(chunk_path, 'rb') as chunk_file:
                        shutil.copyfileobj(chunk_file, merged_file)

            # 🔧 验证合并后文件的MD5
            merged_md5 = self._calculate_md5(merged_file_path)
            if merged_md5 != session.file_md5:
                # 清理临时文件
                self._cleanup_temp_files(session)
                return Response(
                    {'error': f'文件完整性校验失败: 期望MD5={session.file_md5}, 实际={merged_md5}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 创建云文件记录
            with transaction.atomic():
                # 确定目标文件夹
                target_folder = None
                if folder_id:
                    try:
                        target_folder = Folder.objects.get(
                            id=folder_id,
                            owner=request.user,
                            deleted_at__isnull=True
                        )
                    except Folder.DoesNotExist:
                        return Response(
                            {'error': '目标文件夹不存在'},
                            status=status.HTTP_404_NOT_FOUND
                        )

                # 创建 CloudFile 记录
                cloud_file = CloudFile.objects.create(
                    owner=request.user,
                    folder=target_folder,
                    name=session.file_name,
                    original_name=session.file_name,
                    size=session.file_size,
                    md5=session.file_md5,
                    description=description[:500] if description else '',  # 🔧 截断 + 兜底
                    tags=tags[:200] if tags else '',  # 🔧 截断 + 兜底
                    # file 字段会在下面保存
                )

                # 保存文件到存储后端
                with open(merged_file_path, 'rb') as f:
                    content = ContentFile(f.read())
                    cloud_file.file.save(
                        session.file_name,
                        content,
                        save=True
                    )

                # 标记会话为完成
                session.is_completed = True
                session.save(update_fields=['is_completed', 'updated_at'])

                # 记录操作日志
                FileOperationLog.objects.create(
                    file=cloud_file,
                    user=request.user,
                    operation='upload',
                    description=f'分片上传文件: {session.file_name}',
                    ip_address=get_request_ip(request),
                    extra_data={
                        'upload_method': 'chunked',
                        'total_chunks': session.total_chunks,
                        'chunk_size': session.chunk_size,
                        'file_md5': session.file_md5,
                        'session_id': str(session.id)
                    }
                )

            # 🔧 清理临时文件
            self._cleanup_temp_files(session)

            logger.info(f"文件合并成功: {cloud_file.id}, {session.file_name}")

            # 返回文件信息
            file_serializer = self.get_serializer(cloud_file)
            return Response({
                'success': True,
                'message': '文件上传成功',
                'file': file_serializer.data,
                'session_id': str(session.id)
            }, status=status.HTTP_201_CREATED)

        except serializers.ValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except FileNotFoundError as e:
            logger.error(f"合并分片失败 - 文件不存在: {e}")
            return Response(
                {'error': f'合并失败: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"合并分片失败: {e}", exc_info=True)
            # 尝试清理
            if 'session' in locals():
                self._cleanup_temp_files(session)
            return Response(
                {'error': f'合并失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'])
    def check_session(self, request):
        """
        🔧 检查上传会话状态
        GET /api/cloud/files/check_session/?session_id=xxx

        响应:
        {
            "exists": true,
            "progress": 45.5,
            "missing_chunks": [5, 6, 7],
            "is_completed": false,
            "expires_at": "2026-04-23T10:00:00Z"
        }
        """
        session_id = request.query_params.get('session_id')
        if not session_id:
            return Response(
                {'error': '缺少 session_id 参数'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            session = UploadSession.objects.get(
                id=session_id,
                user=request.user
            )

            # 检查是否过期
            if session.is_expired():
                session.delete()
                return Response({
                    'exists': False,
                    'message': '会话已过期'
                }, status=status.HTTP_410_GONE)

            serializer = UploadSessionSerializer(session)
            return Response({
                'exists': True,
                'session': serializer.data,
                'missing_chunks': session.get_missing_chunks(),
                'is_completed': session.is_completed
            })

        except UploadSession.DoesNotExist:
            return Response({'exists': False}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['delete'])
    @transaction.atomic  # 🔧 关键修复：添加事务装饰器
    def cancel_upload(self, request):
        """
        🔧 取消上传会话
        DELETE /api/cloud/files/cancel_upload/?session_id=xxx
        """
        session_id = request.query_params.get('session_id')
        if not session_id:
            return Response(
                {'error': '缺少 session_id 参数'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            session = UploadSession.objects.get(
                id=session_id,
                user=request.user,
                is_completed=False
            )

            # 清理临时文件
            self._cleanup_temp_files(session)

            # 删除会话
            session.delete()

            logger.info(f"取消上传会话: {session_id}")
            return Response({'message': '上传已取消'}, status=status.HTTP_200_OK)

        except UploadSession.DoesNotExist:
            return Response({'error': '会话不存在'}, status=status.HTTP_404_NOT_FOUND)

    # 🔧 定期清理过期会话的任务 (可在 management command 或 celery 中调用)
    @staticmethod
    def cleanup_expired_sessions():
        """清理过期的上传会话和临时文件"""
        expired_sessions = UploadSession.objects.filter(
            expires_at__lt=timezone.now()
        )

        cleaned_count = 0
        for session in expired_sessions:
            try:
                # 清理临时文件
                temp_dir = session.temp_path
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir)
                    logger.info(f"清理过期会话临时目录: {temp_dir}")

                session.delete()
                cleaned_count += 1
            except Exception as e:
                logger.error(f"清理过期会话失败 {session.id}: {e}")

        logger.info(f"清理完成: {cleaned_count} 个过期上传会话")
        return cleaned_count

    # =================== 分片上传结束 ===================

    # cloud/views.py - 添加协作接口
    @action(detail=True, methods=['post'])
    def add_collaborator(self, request, pk=None):
        """
        添加文件协作者
        POST /api/cloud/files/{id}/add_collaborator/
        {
            "user_id": 123,
            "permission": "write"  // read/write/admin
        }
        """
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)

        user_id = request.data.get('user_id')
        permission = request.data.get('permission', 'read')

        if not user_id:
            return Response({'error': '请指定协作用户'}, status=400)

        if permission not in ['read', 'write', 'admin']:
            return Response({'error': '权限类型无效'}, status=400)

        try:
            collaborator = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=404)

        # 创建或更新协作关系
        _, created = FileCollaboration.objects.update_or_create(
            file=file_obj,
            user=collaborator,
            defaults={
                'permission': permission,
                'is_active': True,
            }
        )

        # 记录操作日志
        FileOperationLog.objects.create(
            file=file_obj,
            user=request.user,
            operation='share',
            description=f'添加协作者：{collaborator.username}',
            ip_address=get_request_ip(request),
            extra_data={
                'collaborator_id': str(collaborator.id),
                'collaborator_username': collaborator.username,
                'permission': permission,
                'created': created,
            }
        )

        return Response({
            'message': '协作者添加成功',
            'FileCollaboration': {
                'user': collaborator.username,
                'permission': permission,
            }
        })

    # cloud/views.py - 获取协作者接口
    @action(detail=True, methods=['get'])
    def collaborators(self, request, pk=None):
        """
        获取文件协作者列表
        GET /api/cloud/files/{id}/collaborators/
        """
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)

        FileCollaborations = FileCollaboration.objects.filter(
            file=file_obj,
            is_active=True
        ).select_related('user')

        data = [{
            'user_id': c.user.id,
            'username': c.user.username,
            'real_name': c.user.real_name,
            'avatar': c.user.get_avatar_url(),
            'permission': c.permission,
            'created_at': c.created_at.isoformat(),
        } for c in FileCollaborations]

        return Response({'collaborators': data})

    def _verify_onlyoffice_token(self, request):
        """
        🔧 验证 OnlyOffice JWT Token（用于下载接口授权）
        """
        if not settings.ONLYOFFICE.get('JWT_ENABLED', True):
            return False

        jwt_secret = settings.ONLYOFFICE.get('JWT_SECRET')
        if not jwt_secret:
            return False

        # 从请求头或参数获取 token
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            token = request.query_params.get('token')

        if not token:
            return False

        try:
            # 验证 JWT
            payload = jwt.decode(token, jwt_secret, algorithms=['HS256'])
            # 可选：验证 payload 中的 document.key 是否匹配文件
            return True
        except jwt.InvalidTokenError:
            logger.warning(f'Invalid OnlyOffice token: {token[:20]}...')
            return False

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """
        下载文件
        GET /api/cloud/files/{id}/download/
        """
        logger.info(f"{request.user} Downloading file pk: {pk}")

        try:
            config = CloudSystemConfig.objects.filter(key='system.download_enabled').first()
            if config:
                download_enabled = config.get_value('system.download_enabled')
                if not download_enabled:
                    return Response({'error': '下载功能已禁用，请联系管理员！'}, status=status.HTTP_403_FORBIDDEN)
        except Exception as e:
            logger.error(f"Error: {e}")

        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user, deleted_at__isnull=True)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)

        # 🔧 如果是 OnlyOffice 请求，允许访问（通过 JWT 验证）
        # 否则验证用户权限
        if not request.user.is_authenticated:
            # 🔧 未认证请求，检查是否是 OnlyOffice（通过 User-Agent 或 IP）
            user_agent = request.META.get('HTTP_USER_AGENT', '')
            if 'onlyoffice' not in user_agent.lower():
                logger.warning(f'Unauthorized request from {request.META.get("REMOTE_ADDR")}')
                # 🔧 生产环境应返回 401
                return Response({'error': '认证失败'}, status=status.HTTP_401_UNAUTHORIZED)

        # 🔧 文件下载逻辑
        if not file_obj.file:
            return Response({'error': '文件不存在'}, status=status.HTTP_404_NOT_FOUND)

        if not os.path.exists(file_obj.file.path):
            return Response({'error': '文件丢失'}, status=404)

        # 记录下载日志
        FileOperationLog.objects.create(
            file=file_obj,
            user=request.user,
            operation='download',
            description=f'下载文件：{file_obj.name}',
            ip_address=get_request_ip(request),
            extra_data={
                'file_name': file_obj.name,
                'file_size': file_obj.size,
                'mime_type': file_obj.mime_type,
            }
        )

        # 更新下载次数
        file_obj.download_count += 1
        file_obj.save()

        # 🔧 关键修复：安全获取文件名并编码
        original_name = file_obj.name or file_obj.original_name or 'download'
        safe_filename = self._sanitize_filename(original_name)

        # 构建 Content-Disposition（支持中文文件名）
        content_disposition = self._build_content_disposition(safe_filename)
        logger.info(f'original_name: {original_name}')
        logger.info(f'safe_filename: {safe_filename}')
        logger.info(f'content_disposition: {content_disposition}')

        # 构建文件响应
        response = FileResponse(
            file_obj.file,
            as_attachment=True,
            filename=safe_filename  # 使用安全文件名
        )
        response['Content-Disposition'] = content_disposition
        response['Content-Length'] = file_obj.file.size
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    @action(detail=True, methods=['get'])
    def downloadloop(self, request, pk=None):
        """下载文件"""
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)

        file_path = file_obj.file.path
        if not os.path.exists(file_path):
            return Response({'error': '文件丢失'}, status=404)

        # 🔧 关键修复：安全获取文件名并编码
        original_name = file_obj.name or file_obj.original_name or 'download'
        safe_filename = self._sanitize_filename(original_name)

        response = FileResponse(open(file_path, 'rb'), as_attachment=True, filename=safe_filename)
        # FileResponse 会自动处理 Request 中的 Range 头并返回 206 Partial Content
        return response

    def retrieve(self, request, pk=None):
        logger.info(f"{request.user} Retrieving file pk: {pk}")
        try:
            file_obj = CloudFile.objects.get(id=pk)
            if not self._can_access_with_ancestors(file_obj.folder, request.user):
                return Response({'error': '无操作权限'}, status=403)
            serializer = self.get_serializer(file_obj)
            return Response(serializer.data)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)

    @action(detail=True, methods=['post'])
    def star(self, request, pk=None):
        """⭐ 星标/取消星标"""
        logger.info(f"{request.user} Star file pk: {pk}")
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        file_obj.is_starred = not file_obj.is_starred
        file_obj.save()
        return Response({'is_starred': file_obj.is_starred, 'message': '操作成功'})

    @action(detail=True, methods=['post'])
    def move(self, request, pk=None):
        """📂 移动文件"""
        logger.info(f"{request.user} Moving file pk: {pk}")
        try:
            try:
                file_obj = CloudFile.objects.get(id=pk)
                if not self._can_move_file(file_obj, request.user):
                    return Response({'error': '无操作权限'}, status=403)
            except CloudFile.DoesNotExist:
                return Response({'error': '文件不存在'}, status=404)
            target_folder_id = request.data.get('target_folder_id')
            from_folder = file_obj.folder
            # 验证目标文件夹归属
            if target_folder_id:
                try:
                    target_folder = Folder.objects.get(
                        id=target_folder_id,
                        owner=request.user,
                        deleted_at__isnull=True
                    )
                    # 防止移动到自身子目录 (简单检查)
                    if file_obj == target_folder:
                        return Response({'error': '不能移动到自身'}, status=400)
                    file_obj.folder = target_folder
                except Folder.DoesNotExist:
                    return Response({'error': '目标文件夹不存在'}, status=404)
            else:
                file_obj.folder = None  # 移动到根目录

            file_obj.save()
            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='move',
                description=f'移动文件：{file_obj.name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'file_name': file_obj.name,
                    'file_size': file_obj.size,
                    'mime_type': file_obj.mime_type,
                    'from_folder': str(from_folder.name) if from_folder else '根目录',
                    'to_folder': str(file_obj.folder.name) if file_obj.folder else '根目录',
                }
            )

            return Response({
                'message': '移动成功',
                'file': CloudFileSerializer(file_obj).data
            })
        except Exception as e:
            logger.error(f'文件移动失败：{e}')
            return Response(
                {'error': f'移动失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def rename(self, request, pk=None):
        """重命名文件"""
        logger.info(f'{request.user} Rename pk: {pk}')
        try:
            file_obj = CloudFile.objects.get(id=pk)
            if not self._can_write_with_ancestors(file_obj.folder, request.user):
                return Response({'error': '无操作权限'}, status=403)
        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        new_name = request.data.get('name', '').strip()
        old_name = file_obj.name

        if not new_name:
            return Response({'error': '文件名不能为空'}, status=status.HTTP_400_BAD_REQUEST)

        if len(new_name) > 100:
            return Response(
                {'error': '文件名长度不能超过 100 个字符'},
                status=status.HTTP_400_BAD_REQUEST
            )
        new_name = os.path.splitext(new_name)[0] + os.path.splitext(file_obj.original_name)[1]
        file_obj.name = new_name
        file_obj.save()

        FileOperationLog.objects.create(
            file=file_obj,
            user=request.user,
            operation='rename',
            description=f'重命名文件：{new_name}',
            ip_address=get_request_ip(request),
            extra_data={
                'old_name': old_name,
                'new_name': new_name,
            }
        )

        return Response({'message': '重命名成功'})

    @action(detail=True, methods=['post'])
    def delete(self, request, pk=None):
        """
        🔧 文件软删除接口（移动到回收站）
        POST /api/cloud/files/{id}/delete/
        """
        try:
            logger.info(f"{request.user} 软删除文件 pk {pk}")
            try:
                file_obj = CloudFile.objects.get(id=pk)
                if not self._can_delete_file(file_obj, request.user):
                    logger.warning(f"{request.user} 无权限删除文件 {file_obj.name}")
                    return Response({'error': '无操作权限'}, status=403)
                if file_obj.owner != request.user and not request.user.is_superuser:
                    logger.warning(f"{request.user} 无权限删除文件 {file_obj.name}")
                    return Response({'error': '无操作权限'}, status=403)
            except CloudFile.DoesNotExist:
                return Response({'error': '文件不存在'}, status=404)
            file_obj.deleted_at = timezone.now()
            file_obj.reference_count = file_obj.reference_count - 1
            file_obj.save()

            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='delete',
                description=f'删除文件：{file_obj.name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'file_id': str(file_obj.id),
                    'file_name': file_obj.name,
                    'file_size': file_obj.size,
                    'mime_type': file_obj.mime_type,
                    'folder': str(file_obj.folder.name) if file_obj.folder else '根目录',
                    'logical_delete': True,
                }
            )
            logger.info(f"{request.user} 软删除文件 file_obj {file_obj}")
            return Response({'message': '文件已移动到回收站'})
        except Exception as e:
            logger.error(f'文件删除失败：{e}')
            return Response(
                {'error': f'删除失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """
        🔧 文件恢复接口（从回收站）
        POST /api/cloud/files/{id}/restore/
        """
        try:
            logger.info(f"{request.user} 恢复文件 pk {pk}")

            try:
                file_obj = CloudFile.objects.get(id=pk, owner=request.user)
            except CloudFile.DoesNotExist:
                logger.info(f"{request.user} 恢复文件 pk {pk} 不存在")
                return Response({'error': '文件不存在'}, status=404)

            logger.info(f"{request.user} 恢复文件 file_obj {file_obj}")
            if not file_obj.deleted_at:
                return Response(
                    {'error': '文件不在回收站'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 恢复文件
            file_obj.deleted_at = None
            file_obj.reference_count = file_obj.reference_count + 1
            file_obj.save()

            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='restore',
                description=f'恢复文件：{file_obj.name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'file_id': str(file_obj.id),
                    'file_name': file_obj.name,
                    'file_size': file_obj.size,
                    'mime_type': file_obj.mime_type,
                    'folder': str(file_obj.folder.name) if file_obj.folder else '根目录',
                }
            )
            return Response({
                'message': '文件已恢复',
                'file': CloudFileSerializer(file_obj).data
            })
        except Exception as e:
            logger.error(f'文件恢复失败：{e}')
            return Response(
                {'error': f'恢复失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'])
    def permanent_delete(self, request, pk=None):
        """
        🔧 关键修复：永久删除文件（回收站专用）
        POST /api/cloud/files/{id}/permanent_delete/

        逻辑：
        1. 验证文件属于当前用户
        2. 验证文件在回收站中（deleted_at 不为空）
        3. 检查是否有活跃关联（分享、协作等）
        4. 有关联：只标记 permanently_deleted=True（逻辑清空）
        5. 无关联：删除数据库记录 + 物理文件（物理清空）
        """
        try:
            logger.info(f"{request.user} 开始永久删除文件 {pk}")

            # 🔧 1. 验证文件存在且属于当前用户
            try:
                file_obj = CloudFile.objects.get(
                    id=pk,
                    owner=request.user
                )
            except CloudFile.DoesNotExist:
                return Response(
                    {'error': '文件不存在或无权操作'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 🔧 2. 验证文件在回收站中
            if not file_obj.deleted_at:
                return Response(
                    {'error': '文件不在回收站中，无法永久删除'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 3. 检查是否有活跃关联
            has_associations = self._check_file_associations(file_obj)

            if has_associations:
                # 🔧 4. 有关联：逻辑清空（保留记录，标记永久删除）
                logger.info(f"user: {request.user} 文件 {pk} 有活跃关联，执行逻辑清空")

                # 标记为永久删除（如果模型有该字段）
                if hasattr(file_obj, 'permanently_deleted'):
                    file_obj.permanently_deleted = True
                    file_obj.save(update_fields=['permanently_deleted'])

                return Response({
                    'message': '文件有关联引用，已标记为永久删除（保留记录）',
                    'file_id': str(file_obj.id),
                    'logical_delete': True,
                    'associations': has_associations
                })

            # 获取总引用计数
            total_reference_file_count = CloudFile.objects.filter(md5=file_obj.md5).filter(
                reference_count__gte=0).count()
            if total_reference_file_count > 1:
                reference_count = file_obj.reference_count
                file_id = file_obj.id
                md5 = file_obj.md5
                # 引用计数大于 0，无法删除
                logger.warning(
                    f"user: {request.user} 文件 {pk} 引用计数大于 1，无法永久删除, reference_count: {reference_count} total_reference_file_count：{total_reference_file_count}")
                file_obj.delete()
                return Response(
                    {
                        'error': '文件有引用计数，已标记为逻辑删除',
                        'file_id': file_id,
                        'md5': md5,
                        'logical_delete': True,
                        'total_reference_file_count': total_reference_file_count,
                        'reference_count': reference_count,
                    },
                    status=status.HTTP_200_OK
                )
            else:
                # 🔧 5. 无关联：物理清空
                logger.info(f"user: {request.user} 文件 {pk} 无关联，执行物理清空")

                # 获取文件路径
                file_path = file_obj.file.path if file_obj.file else None
                file_name = file_obj.name

                # 删除物理文件
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                        os.remove(file_path)
                        logger.info(f'user: {request.user} 已删除物理文件：{file_path} ({file_size} bytes)')
                    except Exception as e:
                        logger.warning(f'user: {request.user} 删除物理文件失败 {file_path}: {e}')

                # 获取文件 ID 用于日志
                file_id = file_obj.id

                # 恢复聊天文件的同步状态
                upload_file = FileUpload.objects.filter(md5=file_obj.md5, uploaded_by=request.user,
                                                        is_sync_to_cloud=True)
                if upload_file:
                    upload_file.update(is_sync_to_cloud=False)
                    logger.info(f'user: {request.user} 已恢复文件同步状态：{upload_file}')

                # 删除数据库记录
                file_obj.delete()

                # 🔧 记录操作日志
                FileOperationLog.objects.create(
                    file=None,  # 文件已删除
                    user=request.user,
                    operation='permanent_delete',
                    description=f'永久删除文件：{file_name}',
                    ip_address=get_request_ip(request),
                    extra_data={
                        'file_id': str(file_id),
                        'file_name': file_name,
                        'physical_delete': True
                    }
                )

                return Response({
                    'message': '文件已永久删除',
                    'file_id': str(file_id),
                    'file_name': file_name,
                    'logical_delete': False,
                    'physical_delete': True
                })

        except Exception as e:
            logger.error(f'user: {request.user} 永久删除文件失败：{e}', exc_info=True)
            return Response(
                {'error': f'删除失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _check_file_associations(self, file_obj):
        """
        🔧 检查文件是否有活跃关联
        返回：有关联时返回关联类型列表，无关联返回 False
        """
        associations = []

        # 🔧 1. 检查活跃分享
        active_shares = FileShare.objects.filter(
            file=file_obj,
            is_active=True
        ).exists()

        if active_shares:
            associations.append('share')
            logger.info(f'文件 {file_obj.id} 有活跃分享关联')

        # 🔧 2. 检查协作关系（如果模型存在）
        try:
            active_collabs = FileCollaboration.objects.filter(
                file=file_obj,
                is_active=True
            ).exists()

            if active_collabs:
                associations.append('FileCollaboration')
                logger.info(f'文件 {file_obj.id} 有活跃协作关联')
        except ImportError:
            # FileCollaboration 模型不存在，跳过检查
            pass

        # 🔧 3. 检查是否在文件夹中（文件夹有关联）
        if file_obj.folder:
            folder_shares = FileShare.objects.filter(
                folder=file_obj.folder,
                is_active=True
            ).exists()

            if folder_shares:
                associations.append('folder_share')
                logger.info(f'文件 {file_obj.id} 所在文件夹有活跃分享')

        return associations if associations else False

    @action(detail=False, methods=['post'])
    def empty_trash(self, request):
        """
        🔧 清空回收站（文件 + 文件夹，支持关联检查）
        POST /api/cloud/files/empty_trash/

        逻辑：
        1. 获取用户所有已删除的文件和文件夹
        2. 检查每个项目是否有活跃关联（分享、协作等）
        3. 有关联：逻辑清空（标记 permanently_deleted=True）
        4. 无关联：物理清空（删除记录 + 物理文件）
        5. 递归处理文件夹的子内容
        """
        try:
            user = request.user

            # 🔧 获取已删除的文件
            deleted_files = CloudFile.objects.filter(
                owner=user,
                deleted_at__isnull=False
            ).select_related('owner')

            # 🔧 获取已删除的文件夹

            deleted_folders = Folder.objects.filter(
                owner=user,
                deleted_at__isnull=False
            ).select_related('owner')

            stats = {
                'files_logical': 0,
                'files_physical': 0,
                'folders_logical': 0,
                'folders_physical': 0,
                'errors': []
            }

            # 🔧 处理文件
            for file_obj in deleted_files:
                try:
                    if self._has_active_associations(file_obj, 'file'):
                        # 🔧 有关联：逻辑清空
                        self._logical_permanent_delete_file(file_obj)
                        stats['files_logical'] += 1
                        logger.info(f'逻辑清空文件（有关联）: {file_obj.id}')
                    else:
                        # 🔧 无关联：物理清空
                        self._physical_permanent_delete_file(file_obj)
                        stats['files_physical'] += 1
                        logger.info(f'物理清空文件（无关联）: {file_obj.id}')
                except Exception as e:
                    stats['errors'].append(f'文件 {file_obj.id}: {str(e)}')
                    logger.error(f'清空文件 {file_obj.id} 失败: {e}')

            # 🔧 处理文件夹（递归）
            for folder_obj in deleted_folders:
                try:
                    if self._has_active_associations(folder_obj, 'folder'):
                        # 🔧 有关联：逻辑清空（递归处理子内容）
                        self._logical_permanent_delete_folder(folder_obj)
                        stats['folders_logical'] += 1
                        logger.info(f'逻辑清空文件夹（有关联）: {folder_obj.id}')
                    else:
                        # 🔧 无关联：物理清空（递归处理子内容）
                        self._physical_permanent_delete_folder(folder_obj)
                        stats['folders_physical'] += 1
                        logger.info(f'物理清空文件夹（无关联）: {folder_obj.id}')
                except Exception as e:
                    stats['errors'].append(f'文件夹 {folder_obj.id}: {str(e)}')
                    logger.error(f'清空文件夹 {folder_obj.id} 失败: {e}')

            # 🔧 记录操作日志
            FileOperationLog.objects.create(
                user=request.user,
                operation='empty_trash',
                description=f'清空回收站: 逻辑清空文件 {stats["files_logical"]} 个, 物理清空文件 {stats["files_physical"]} 个, '
                            f'逻辑清空文件夹 {stats["folders_logical"]} 个, 物理清空文件夹 {stats["folders_physical"]} 个',
                ip_address=get_request_ip(request),
                extra_data={'stats': stats}
            )

            return Response({
                'message': '回收站清空完成',
                'stats': stats,
                'total_processed': sum([
                    stats['files_logical'], stats['files_physical'],
                    stats['folders_logical'], stats['folders_physical']
                ])
            })

        except Exception as e:
            logger.error(f'清空回收站失败: {e}', exc_info=True)
            return Response(
                {'error': f'清空失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'])
    def sync_file_from_chat(self, request, *args, **kwargs):
        """
        将聊天文件同步到企业云盘
        :param request:
        :param args:
        :param kwargs: 
        :return:
        """
        user = request.user

        # 🔧 优化1：使用 get_or_create 返回的元组解包，确保获取的是对象实例而不是 (obj, created) 元组
        safe_folder_name = '文档（来自聊天室）'
        root_folder, _ = Folder.objects.get_or_create(
            owner=user,
            name=safe_folder_name,
            defaults={
                'parent': None,
                'description': '从聊天室同步',
                'is_public': False
            }
        )

        from chat.models import FileUpload

        # ✅ 正确写法
        no_sync_files = FileUpload.objects.filter(
            uploaded_by=user,
            is_sync_to_cloud=False
        )

        sync_count = 0
        error_count = 0
        skipped_count = 0

        for file_obj in no_sync_files:
            try:
                # 检查源文件是否存在
                if not file_obj.file or not os.path.exists(file_obj.file.path):
                    logger.warning(f"聊天文件不存在或路径无效: {file_obj.id}")
                    skipped_count += 1
                    # 标记为已同步以避免重复处理无效文件，或者保持 false 等待人工干预
                    # 这里选择标记为 true 并记录日志，防止死循环
                    file_obj.is_sync_to_cloud = True
                    file_obj.save(update_fields=['is_sync_to_cloud'])
                    continue

                # 🔧 优化3：避免重复创建 CloudFile，先检查 MD5 或文件名是否存在
                # 注意：update_or_create 需要唯一的 lookup 字段，这里假设 md5 + owner 是唯一的，或者 filename + folder + owner
                # 如果 md5 可能为空，建议使用 filename + folder + owner 作为查找条件
                lookup_kwargs = {
                    'owner': user,
                    'folder': root_folder,
                    'md5': file_obj.md5 if file_obj.md5 else None,  # 如果 md5 为空，可能需要其他策略
                }

                # 如果 md5 为空，回退到文件名匹配（需谨慎，同名不同内容会被覆盖或跳过）
                if not file_obj.md5:
                    lookup_kwargs['name'] = file_obj.filename[:255]

                # 尝试获取现有文件，如果存在则跳过或更新（视业务逻辑而定，这里假设如果存在则跳过物理复制但标记同步）
                cloud_file, created = CloudFile.objects.get_or_create(
                    **lookup_kwargs,
                    defaults={
                        'original_name': (file_obj.filename or 'unnamed')[:255],
                        'name': file_obj.filename[:255],
                        'mime_type': file_obj.mime_type,
                        'created_at': file_obj.created_at,
                        'description': '来自聊天室',
                        'size': file_obj.file.size if hasattr(file_obj.file, 'size') else 0,
                    }
                )

                # 如果是新创建的记录，或者文件物理路径不一致，则保存物理文件
                if created or not cloud_file.file or not os.path.exists(cloud_file.file.path):
                    with open(file_obj.file.path, 'rb') as f:
                        content = f.read()

                    content_file = ContentFile(content)
                    # 使用 save 方法保存文件到存储后端
                    # 注意：save 方法会触发 save() 调用，除非指定 save=False
                    cloud_file.file.save(
                        file_obj.filename[:255],
                        content_file,
                        save=True
                    )

                    # 更新大小信息（如果之前未知）
                    if not cloud_file.size:
                        cloud_file.size = len(content)
                        cloud_file.save(update_fields=['size'])

                # 标记聊天文件为已同步
                file_obj.is_sync_to_cloud = True
                file_obj.save(update_fields=['is_sync_to_cloud'])
                sync_count += 1

            except Exception as e:
                logger.error(f"同步聊天文件失败 ID:{file_obj.id}, Error: {str(e)}")
                error_count += 1
                continue

        total_processed = sync_count + skipped_count

        stats = {
            'user': user.username,
            'folder_id': str(root_folder.id),
            'folder_name': root_folder.name,
            'total_scanned': no_sync_files.count(),  # 注意：如果在循环中修改了状态，这里的 count 可能需要重新查询或缓存
            'sync_success': sync_count,
            'skipped_invalid': skipped_count,
            'errors': error_count,
            'update_time': timezone.now().isoformat(),
        }

        # 记录操作日志
        try:
            FileOperationLog.objects.create(
                folder=root_folder,
                user=user,
                operation='sync_to_cloud',
                description=f'从聊天室同步文件: 成功 {sync_count}, 跳过 {skipped_count}, 错误 {error_count}',
                ip_address=get_request_ip(request),  # 🔧 修复：使用传入的 request 而不是 self.request
                extra_data={'stats': stats}
            )
        except Exception as log_err:
            logger.error(f"记录同步日志失败: {log_err}")

        return Response({
            'message': '同步完成',
            'stats': stats,
            'total_processed': total_processed
        })

    # ====================== 工具函数 ======================


    # 🔧 新增：构建 Content-Disposition 头（支持中文文件名）
    def _build_content_disposition(self, filename):
        """
        🔧 构建 Content-Disposition 头，支持中文和特殊字符文件名
        使用 RFC 5987 编码格式
        """
        # ASCII 文件名（兼容旧浏览器）
        ascii_filename = filename.encode('ascii', 'ignore').decode('ascii')

        # UTF-8 编码文件名（支持中文）
        encoded_filename = quote(filename)

        # 返回双重格式，确保最大兼容性
        return f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'

    def _sanitize_filename(self, filename):
        """
        🔧 安全处理文件名，防止路径遍历攻击和非法字符
        """

        if not filename:
            return 'unnamed'

        # 1. 移除路径分隔符，防止路径遍历
        filename = os.path.basename(str(filename))

        # 2. 移除或替换非法字符（Windows/Linux 兼容）
        # 保留中文、英文、数字、下划线、点、横杠、空格
        filename = re.sub(r'[<>:"|?*\\]', '_', filename)

        # 3. 移除首尾空格和点
        filename = filename.strip('. ')

        # 4. 限制长度（避免超长文件名）
        if len(filename) > 200:
            name, ext = os.path.splitext(filename)
            filename = name[:190] + ext

        # 5. 确保不为空
        if not filename or filename == '.':
            filename = 'unnamed_file'

        return filename

    # cloud/views.py - 添加到 CloudFileViewSet 类中

    def _has_active_associations(self, obj, obj_type):
        """
        🔧 检查对象是否有活跃关联（分享、协作等）

        @param obj: CloudFile 或 Folder 对象
        @param obj_type: 'file' 或 'folder'
        @return: bool - True 表示有关联，不能物理删除
        """
        # 🔧 检查活跃分享
        if obj_type == 'file':
            has_share = FileShare.objects.filter(
                file=obj,
                is_active=True,
                expires_at__isnull=True  # 未过期
            ).exists()

            if has_share:
                logger.info(f'文件 {obj.id} 有活跃分享关联')
                return True

            # 🔧 检查协作关系
            has_collab = FileCollaboration.objects.filter(
                file=obj,
                is_active=True
            ).exists()

            if has_collab:
                logger.info(f'文件 {obj.id} 有活跃协作关联')
                return True

        elif obj_type == 'folder':
            # 🔧 文件夹的分享关联
            has_share = FileShare.objects.filter(
                folder=obj,
                is_active=True,
                expires_at__isnull=True
            ).exists()

            if has_share:
                logger.info(f'文件夹 {obj.id} 有活跃分享关联')
                return True

            # 🔧 检查子内容是否有活跃关联（递归检查）
            # 如果子文件/子文件夹有关联，父文件夹也不能物理删除
            for child_file in CloudFile.objects.filter(folder=obj, deleted_at__isnull=False):
                if self._has_active_associations(child_file, 'file'):
                    logger.info(f'文件夹 {obj.id} 的子文件有活跃关联')
                    return True

            for child_folder in Folder.objects.filter(parent=obj, deleted_at__isnull=False):
                if self._has_active_associations(child_folder, 'folder'):
                    logger.info(f'文件夹 {obj.id} 的子文件夹有活跃关联')
                    return True

        return False

    def _logical_permanent_delete_file(self, file_obj):
        """
        🔧 逻辑清空文件（保留记录，标记为永久删除）
        """
        # 🔧 添加永久删除标记字段（如果不存在则创建）
        if not hasattr(file_obj, 'permanently_deleted'):
            # 动态添加标记（实际应在模型中定义该字段）
            with connection.cursor() as cursor:
                cursor.execute(
                    "ALTER TABLE cloud_cloudfile ADD COLUMN IF NOT EXISTS permanently_deleted BOOLEAN DEFAULT FALSE"
                )

        # 🔧 标记为永久删除
        file_obj.permanently_deleted = True
        file_obj.save(update_fields=['permanently_deleted'])

        # 🔧 可选：删除物理文件但保留数据库记录（节省空间）
        # if file_obj.file and os.path.exists(file_obj.file.path):
        #     try:
        #         os.remove(file_obj.file.path)
        #     except:
        #         pass

    def _logical_permanent_delete_folder(self, folder_obj):
        """
        🔧 逻辑清空文件夹（递归处理子内容）
        """
        # 🔧 标记文件夹本身
        if not hasattr(folder_obj, 'permanently_deleted'):
            from django.db import connection
            with connection.cursor() as cursor:
                cursor.execute(
                    "ALTER TABLE cloud_folder ADD COLUMN IF NOT EXISTS permanently_deleted BOOLEAN DEFAULT FALSE"
                )

        folder_obj.permanently_deleted = True
        folder_obj.save(update_fields=['permanently_deleted'])

        # 🔧 递归处理子文件
        for child_file in CloudFile.objects.filter(folder=folder_obj, deleted_at__isnull=False):
            self._logical_permanent_delete_file(child_file)

        # 🔧 递归处理子文件夹
        for child_folder in Folder.objects.filter(parent=folder_obj, deleted_at__isnull=False):
            self._logical_permanent_delete_folder(child_folder)

    # cloud/views.py - 添加到 CloudFileViewSet 类中

    def _physical_permanent_delete_file(self, file_obj):
        """
        🔧 物理清空文件（删除数据库记录 + 物理文件）
        """

        # 🔧 删除物理文件
        if file_obj.file and os.path.exists(file_obj.file.path):
            try:
                file_path = file_obj.file.path
                file_size = os.path.getsize(file_path)

                os.remove(file_path)
                logger.info(f'已删除物理文件: {file_path} ({file_size} bytes)')
            except Exception as e:
                logger.warning(f'删除物理文件失败 {file_obj.file.path}: {e}')

        # 🔧 删除数据库记录
        file_id = file_obj.id
        file_name = file_obj.name
        file_obj.delete()

        logger.info(f'已物理删除文件记录: {file_id} ({file_name})')

    def _physical_permanent_delete_folder(self, folder_obj):
        """
        🔧 物理清空文件夹（递归删除子内容 + 自身）
        """
        # 🔧 先递归删除子文件
        for child_file in CloudFile.objects.filter(folder=folder_obj, deleted_at__isnull=False):
            self._physical_permanent_delete_file(child_file)

        # 🔧 递归删除子文件夹
        child_folders = list(Folder.objects.filter(parent=folder_obj, deleted_at__isnull=False))
        for child_folder in child_folders:
            self._physical_permanent_delete_folder(child_folder)

        # 🔧 最后删除文件夹本身
        folder_id = folder_obj.id
        folder_name = folder_obj.name
        folder_obj.delete()

        logger.info(f'已物理删除文件夹记录: {folder_id} ({folder_name})')

    def format_size(self, size):
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f'{size:.2f} {unit}'
            size /= 1024
        return f'{size:.2f} PB'

    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """获取用户文件统计"""
        user = request.user
        total_files = CloudFile.objects.filter(owner=user, deleted_at__isnull=True).count()
        total_size = CloudFile.objects.filter(
            owner=user,
            deleted_at__isnull=True
        ).aggregate(total=Sum('size'))['total'] or 0

        return Response({
            'total_files': total_files,
            'total_size': total_size,
            'total_size_formatted': self.format_size(total_size),
            'starred_files': CloudFile.objects.filter(
                owner=user,
                is_starred=True,
                deleted_at__isnull=True
            ).count(),
            'shared_files': FileShare.objects.filter(
                owner=user,
                is_active=True
            ).count()
        })

    @action(detail=False, methods=['post'])
    def check_md5(self, request):
        """检查文件 MD5 是否存在 (秒传)"""
        md5 = request.data.get('md5')
        if not md5:
            return Response({'exists': False}, status=400)

        # 查找是否有相同 MD5 且未删除的文件
        existing_file = CloudFile.objects.filter(md5=md5, deleted_at__isnull=True).first()

        if existing_file:
            # 直接复用记录 (注意：这里需要根据业务决定是否直接关联给当前用户，还是仅提示存在)
            # 策略：如果是公共文件库，直接返回存在；如果是私有，可能需要创建一条指向同一物理文件的新记录
            return Response({
                'exists': True,
                'message': '文件已存在，秒传成功',
                'file_id': existing_file.id
            })
        return Response({'exists': False})

    @action(detail=False, methods=['post'])
    def batch_delete(self, request):
        """
        🔧 批量删除文件/文件夹（软删除到回收站）
        POST /api/cloud/files/batch_delete/
        {
            "file_ids": ["uuid-1", "uuid-2", ...]
        }
        """
        try:
            user = request.user
            file_ids = request.data.get('file_ids', [])

            if not file_ids:
                return Response(
                    {'error': '请选择要删除的项目'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            deleted_count = 0
            errors = []

            # 🔧 分别处理文件和文件夹

            # 处理文件
            files = CloudFile.objects.filter(
                id__in=file_ids,
                owner=user,
                deleted_at__isnull=True
            )
            for file_obj in files:
                try:
                    file_obj.deleted_at = timezone.now()
                    file_obj.save()
                    deleted_count += 1

                    # 记录操作日志
                    from .models import FileOperationLog
                    FileOperationLog.objects.create(
                        file=file_obj,
                        user=user,
                        operation='batch_delete',
                        description=f'批量删除文件：{file_obj.name}',
                        ip_address=get_request_ip(request)
                    )
                except Exception as e:
                    errors.append(f'文件 {file_obj.id}: {str(e)}')

            # 处理文件夹
            folders = Folder.objects.filter(
                id__in=file_ids,
                owner=user,
                deleted_at__isnull=True
            )
            for folder_obj in folders:
                try:
                    # 软删除文件夹及其子内容
                    folder_obj.deleted_at = timezone.now()
                    folder_obj.save()

                    # 递归软删除子文件夹和文件
                    self._soft_delete_children(folder_obj)
                    deleted_count += 1

                    # 记录操作日志
                    from .models import FileOperationLog
                    FileOperationLog.objects.create(
                        folder=folder_obj,
                        user=user,
                        operation='batch_delete',
                        description=f'批量删除文件夹：{folder_obj.name}',
                        ip_address=get_request_ip(request)
                    )
                except Exception as e:
                    errors.append(f'文件夹 {folder_obj.id}: {str(e)}')

            return Response({
                'message': f'成功删除 {deleted_count} 个项目',
                'deleted_count': deleted_count,
                'errors': errors[:10]  # 只返回前 10 个错误
            })

        except Exception as e:
            logger.error(f'批量删除失败: {e}', exc_info=True)
            return Response(
                {'error': f'批量删除失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # cloud/views.py - CloudFileViewSet 中添加

    @action(detail=False, methods=['post'])
    def batch_move(self, request):
        """
        🔧 批量移动文件/文件夹
        POST /api/cloud/files/batch_move/
        {
            "file_ids": ["uuid-1", "uuid-2", ...],
            "target_folder_id": "uuid-target"  # null 表示移动到根目录
        }
        """
        try:
            user = request.user
            file_ids = request.data.get('file_ids', [])
            target_folder_id = request.data.get('target_folder_id')

            if not file_ids:
                return Response(
                    {'error': '请选择要移动的项目'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 🔧 验证目标文件夹
            target_folder = None
            if target_folder_id:
                try:
                    target_folder = Folder.objects.get(
                        id=target_folder_id,
                        owner=user,
                        deleted_at__isnull=True
                    )
                except Folder.DoesNotExist:
                    return Response(
                        {'error': '目标文件夹不存在'},
                        status=status.HTTP_404_NOT_FOUND
                    )

            moved_count = 0
            errors = []

            # 🔧 移动文件
            files = CloudFile.objects.filter(
                id__in=file_ids,
                owner=user,
                deleted_at__isnull=True
            )
            for file_obj in files:
                try:
                    # 防止循环引用：不能移动到自身或子文件夹
                    if target_folder and self._is_descendant_of(target_folder, file_obj.folder):
                        errors.append(f'文件 {file_obj.id}: 不能移动到子文件夹中')
                        continue

                    file_obj.folder = target_folder
                    file_obj.save()
                    moved_count += 1

                    from .models import FileOperationLog
                    # 记录操作日志
                    FileOperationLog.objects.create(
                        file=file_obj,
                        user=user,
                        operation='batch_move',
                        description=f'批量移动文件：{file_obj.name}',
                        ip_address=get_request_ip(request),
                        extra_data={
                            'target_folder': str(target_folder.name) if target_folder else '根目录'
                        }
                    )
                except Exception as e:
                    errors.append(f'文件 {file_obj.id}: {str(e)}')

            # 🔧 移动文件夹
            folders = Folder.objects.filter(
                id__in=file_ids,
                owner=user,
                deleted_at__isnull=True
            )
            for folder_obj in folders:
                try:
                    # 防止循环引用
                    if target_folder and self._is_descendant_of(target_folder, folder_obj):
                        errors.append(f'文件夹 {folder_obj.id}: 不能移动到自身子文件夹中')
                        continue

                    folder_obj.parent = target_folder
                    folder_obj.save()
                    moved_count += 1

                    # 记录操作日志
                    from .models import FileOperationLog
                    FileOperationLog.objects.create(
                        folder=folder_obj,
                        user=user,
                        operation='batch_move',
                        description=f'批量移动文件夹：{folder_obj.name}',
                        ip_address=get_request_ip(request),
                        extra_data={
                            'target_folder': str(target_folder.name) if target_folder else '根目录'
                        }
                    )
                except Exception as e:
                    errors.append(f'文件夹 {folder_obj.id}: {str(e)}')

            return Response({
                'message': f'成功移动 {moved_count} 个项目',
                'moved_count': moved_count,
                'errors': errors[:10]
            })

        except Exception as e:
            logger.error(f'批量移动失败: {e}', exc_info=True)
            return Response(
                {'error': f'批量移动失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # cloud/views.py - FileShareViewSet 中添加

    @action(detail=False, methods=['post'])
    def batch_create(self, request):
        """
        🔧 批量创建分享链接
        POST /api/cloud/shares/batch_create/
        {
            "file_ids": ["uuid-1", "uuid-2", ...],
            "share_type": "public",  // public/password/private
            "password": "123456",    // 可选，当 share_type=password 时
            "expires_at": "2026-12-31T23:59:59",  // 可选
            "max_downloads": 100  // 可选
        }
        """
        try:
            user = request.user
            file_ids = request.data.get('file_ids', [])
            share_type = request.data.get('share_type', 'public')
            password = request.data.get('password', '')
            expires_at = request.data.get('expires_at')
            max_downloads = request.data.get('max_downloads')

            if not file_ids:
                return Response(
                    {'error': '请选择要分享的项目'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            results = []
            errors = []

            for file_id in file_ids:
                try:
                    # 🔧 验证文件/文件夹归属
                    file_obj = None
                    folder_obj = None

                    try:
                        file_obj = CloudFile.objects.get(id=file_id, owner=user)
                    except CloudFile.DoesNotExist:
                        try:
                            folder_obj = Folder.objects.get(id=file_id, owner=user)
                        except Folder.DoesNotExist:
                            errors.append(f'{file_id}: 项目不存在或无权分享')
                            continue

                    # 🔧 创建分享
                    share = FileShare.objects.create(
                        owner=user,
                        file=file_obj,
                        folder=folder_obj,
                        share_type=share_type,
                        password=password if share_type == 'password' else '',
                        expires_at=expires_at,
                        max_downloads=max_downloads
                    )

                    results.append({
                        'file_id': file_id,
                        'share_id': str(share.id),
                        'share_code': share.share_code,
                        'share_url': share.share_url,
                        'name': file_obj.name if file_obj else folder_obj.name
                    })

                except Exception as e:
                    errors.append(f'{file_id}: {str(e)}')

            return Response({
                'message': f'成功创建 {len(results)} 个分享链接',
                'results': results,
                'errors': errors[:10],
                'total': len(file_ids),
                'success_count': len(results),
                'error_count': len(errors)
            })

        except Exception as e:
            logger.error(f'批量创建分享失败: {e}', exc_info=True)
            return Response(
                {'error': f'批量创建分享失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    # cloud/views.py - 在 CloudFileViewSet 或 FolderViewSet 中添加辅助方法

    def _is_descendant_of(self, potential_descendant, ancestor):
        """
        🔧 检查 potential_descendant 是否是 ancestor 的后代
        用于防止循环引用（移动时）
        """
        if not ancestor or not potential_descendant:
            return False

        current = potential_descendant
        while current:
            if hasattr(current, 'id') and hasattr(ancestor, 'id') and current.id == ancestor.id:
                return True
            current = getattr(current, 'parent', None) or getattr(current, 'folder', None)
        return False

    def _soft_delete_children(self, folder):
        """🔧 递归软删除子文件夹和文件"""

        # 软删除子文件夹
        for child in folder.children.filter(deleted_at__isnull=True):
            child.deleted_at = timezone.now()
            child.save()
            # 递归处理
            self._soft_delete_children(child)

        # 软删除当前文件夹内的文件
        CloudFile.objects.filter(folder=folder, deleted_at__isnull=True).update(
            deleted_at=timezone.now()
        )


class FileShareViewSet(viewsets.ModelViewSet, UtilsTools):
    """文件分享视图集"""
    queryset = FileShare.objects.all()
    serializer_class = FileShareSerializer
    permission_classes = [permissions.IsAuthenticated]

    pagination_class = SharePagination

    # 🔧 注册过滤与搜索后端
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_class = FileShareFilter
    # ✅ 修复：仅保留模型实际存在的关联字段
    search_fields = ['share_code', 'file__name', 'folder__name']

    def get_serializer_context(self):
        """🔧 关键修复：确保 request 传递到序列化器"""
        context = super().get_serializer_context()
        context.update({'request': self.request})
        return context

    def get_queryset_v1(self):
        user = self.request.user
        # 基础查询集：只查询有效的分享
        queryset = FileShare.objects.select_related('owner', 'file', 'folder').filter(is_active=True)

        # 🔧 1. 我的分享 (owner=me)
        if self.request.query_params.get('owner') == 'me':
            return queryset.filter(owner=user).order_by('-created_at', '-id')

        # 🔧 2. 分享给我 (shared_with_me=true)
        if self.request.query_params.get('shared_with_me') == 'true':
            # q_public = Q(share_type='public')
            q_allowed_user = Q(allowed_users=user)

            q_allowed_dept = Q()
            if hasattr(user, 'department') and user.department:
                q_allowed_dept = Q(allowed_departments=user.department)

            final_q = q_allowed_user | q_allowed_dept

            # 🔧 终极修复方案：
            # 1. 先过滤
            filtered_qs = queryset.filter(final_q)
            # 2. 使用 distinct() 不带参数，Django 会处理多对多导致的重复行
            # 3. 再排序。注意：在 PG 中，如果用了 distinct() (不带字段)，order_by 可以任意。
            return filtered_qs.distinct().order_by('-created_at', '-id')

        return queryset.filter(owner=user).order_by('-created_at', '-id')

    def get_queryset(self):
        user = self.request.user
        queryset = FileShare.objects.select_related('owner', 'file', 'folder').filter(is_active=True)

        # 🔧 路由逻辑：优先处理自定义视图参数
        owner_param = self.request.query_params.get('owner')
        if owner_param == 'me':
            return queryset.filter(owner=user).order_by('-created_at', '-id')

        shared_with_me = self.request.query_params.get('shared_with_me')
        if shared_with_me == 'true':
            q_allowed_user = Q(allowed_users=user)
            q_allowed_dept = Q()
            if hasattr(user, 'department') and user.department:
                q_allowed_dept = Q(allowed_departments=user.department)
            return queryset.filter(q_allowed_user | q_allowed_dept).distinct().order_by('-created_at', '-id')

        # 默认返回当前用户的分享
        return queryset.filter(owner=user).order_by('-created_at', '-id')


    def create(self, request, *args, **kwargs):
        """🔧 关键修复：处理分享创建"""
        # 验证必填字段
        file_id = request.data.get('file')
        folder_id = request.data.get('folder')

        logger.info(f"{request.user} 创建分享 file_id: {file_id} folder_id: {folder_id}")

        if not file_id and not folder_id:
            return Response(
                {'error': '必须指定文件或文件夹'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # 验证文件/文件夹存在且属于当前用户
        if file_id:
            try:
                file_obj = CloudFile.objects.get(id=file_id)
                if self._can_write_with_ancestors(file_obj.folder, request.user):
                    logger.info(f"{request.user} 从共享文件夹 -> 创建分享文件 file_id: {file_id}")
                else:
                    if file_obj.owner != request.user and not request.user.is_superuser:
                        return Response(
                            {'error': '无权分享此文件'},
                            status=status.HTTP_403_FORBIDDEN
                        )
                    logger.info(f"{request.user} 创建分享文件 file_id: {file_id}")
            except CloudFile.DoesNotExist:
                return Response(
                    {'error': '文件不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )

        if folder_id:
            try:
                folder_obj = Folder.objects.get(id=folder_id)
                if self._can_write_with_ancestors(folder_obj, request.user):
                    logger.info(f"{request.user} 从共享文件夹 -> 创建分享文件夹 folder_id: {folder_id}")
                else:
                    if folder_obj.owner != request.user and not request.user.is_superuser:
                        return Response(
                            {'error': '无权分享此文件夹'},
                            status=status.HTTP_403_FORBIDDEN
                        )
                    logger.info(f"{request.user} 创建分享文件夹 folder_id: {folder_id}")
            except Folder.DoesNotExist:
                return Response(
                    {'error': '文件夹不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )

        # 序列化器会自动设置 owner=request.user
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        return Response({
            **serializer.data,
            'message': '分享创建成功'
        }, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        """🔧 关键修复：确保 owner 被设置"""
        # 序列化器的 create 方法已经设置了 owner
        serializer.save()

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        """取消分享"""
        share = self.get_object()

        # 验证权限
        if share.owner != request.user and not request.user.is_superuser:
            return Response(
                {'error': '无权操作此分享'},
                status=status.HTTP_403_FORBIDDEN
            )

        share.is_active = False
        share.save()
        return Response({'message': '已取消分享'})

    @action(detail=True, methods=['post'])
    def save(self, request, pk=None):
        """保存网盘"""
        share = self.get_object()
        share.save()
        return Response({'message': '保存成功'})

    # cloud/views.py - FileShareViewSet.save_to_cloud 修复版
    @action(detail=True, methods=['post'])
    def save_to_cloud(self, request, pk=None):
        """💾 保存分享的文件/文件夹到我的网盘"""
        try:
            share = FileShare.objects.get(id=pk)
        except FileShare.DoesNotExist:
            return Response({'error': '分享不存在'}, status=404)

        user = request.user

        # 权限验证
        if share.owner == user:
            return Response({'error': '不能保存自己的分享'}, status=400)

        if share.is_expired():
            return Response({'error': '分享已过期'}, status=403)

        # 权限校验
        has_permission = False
        if share.share_type == 'public':
            has_permission = True
        elif share.share_type == 'private' and user in share.allowed_users.all():
            has_permission = True
        elif share.share_type == 'department' and user.department and user.department in share.allowed_departments.all():
            has_permission = True
        elif share.share_type == 'password':
            has_permission = True

        if not has_permission:
            return Response({'error': '您没有权限保存此文件'}, status=403)

        if not share.file and not share.folder:
            return Response({'error': '无效的分享内容'}, status=400)

        try:
            if share.file:
                # 🔧 关键修复：安全截断名称和描述，防止字段超长
                original_name = share.file.name or share.file.original_name or 'unnamed'

                # 🔧 修复 1: 生成新名称并截断（name 字段限制 20 字符）
                new_name_suffix = ' (来自分享)'
                max_name_length = 50 - len(new_name_suffix)
                truncated_name = original_name[:max_name_length] if len(
                    original_name) > max_name_length else original_name
                safe_name = f"{new_name_suffix}{truncated_name}"

                # 🔧 修复 2: 生成描述并截断（假设 description 限制 100 字符）
                share_code = share.share_code or 'unknown'
                description_suffix = ' 保存'
                max_desc_length = 100 - len(description_suffix) - len(share_code)
                truncated_desc_prefix = '从分享'[:max_desc_length] if max_desc_length > 0 else ''
                safe_description = f"{truncated_desc_prefix}{share_code}{description_suffix}"

                # 🔧 修复 3: 确保 original_name 也不超长（如果模型有限制）
                safe_original_name = original_name[:255] if len(original_name) > 255 else original_name

                # 创建新的文件记录
                new_file = CloudFile.objects.create(
                    owner=user,
                    folder=None,  # 默认保存到根目录
                    name=safe_name,
                    original_name=safe_original_name,
                    file=share.file.file,
                    size=share.file.size,
                    mime_type=share.file.mime_type,
                    md5=share.file.md5,
                    description=safe_description
                )

                return Response({
                    'message': '保存成功',
                    'file_id': str(new_file.id),
                    'file_name': new_file.name
                })

            elif share.folder:
                # 🔧 文件夹保存逻辑（递归）
                result = self._save_shared_folder_to_cloud(share, user)
                return Response(result)

        except Exception as e:
            logger.error(f"Save to cloud error: {str(e)}", exc_info=True)
            return Response({'error': f'保存失败：{str(e)}'}, status=500)

    # cloud/views.py - 添加到 FileShareViewSet 类中
    def _truncate_string(self, text, max_length, suffix=''):
        """
        🔧 安全截断字符串，确保总长度不超过限制

        @param text: 原始文本
        @param max_length: 最大长度（包含 suffix）
        @param suffix: 要追加的后缀
        @return: 截断后的文本 + 后缀
        """
        if not text:
            return suffix

        # 计算可用于原始文本的最大长度
        available_length = max_length - len(suffix)

        if available_length <= 0:
            # 如果后缀本身就超长，只返回后缀的截断版本
            return suffix[:max_length]

        # 截断原始文本并添加后缀
        truncated = text[:available_length] if len(text) > available_length else text
        return f"{truncated}{suffix}"

    def _save_shared_folder_to_cloud(self, share, user):
        """
        🔧 递归保存分享的文件夹到用户网盘
        """

        original_folder = share.folder

        # 🔧 安全截断文件夹名称
        safe_folder_name = self._truncate_string(
            original_folder.name,
            max_length=20,
            suffix=' (来自分享)'
        )

        # 创建根文件夹
        new_root_folder = Folder.objects.create(
            owner=user,
            name=safe_folder_name,
            parent=None,
            description=self._truncate_string(
                f'从分享{share.share_code}保存',
                max_length=100
            ),
            is_public=False
        )

        # 递归保存子内容
        stats = self._recursive_save_shared_folder_contents(
            original_folder,
            new_root_folder,
            user,
            share.share_code
        )

        # 记录操作日志
        FileOperationLog.objects.create(
            folder=new_root_folder,
            user=user,
            operation='save_from_share',
            description=f'从分享{share.share_code}保存文件夹',
            ip_address=get_request_ip(self.request),
            extra_data={'stats': stats}
        )

        return {
            'message': '文件夹保存成功',
            'folder_id': str(new_root_folder.id),
            'folder_name': new_root_folder.name,
            'stats': stats
        }

    def _recursive_save_shared_folder_contents(self, source_folder, target_parent, user, share_code):
        """递归保存文件夹内容"""
        from .models import Folder, CloudFile

        stats = {'files': 0, 'subfolders': 0, 'errors': []}

        # 保存子文件夹
        for child_folder in source_folder.children.filter(deleted_at__isnull=True):
            try:
                safe_child_name = self._truncate_string(
                    child_folder.name,
                    max_length=20,
                    suffix=' (分享)'
                )

                new_child = Folder.objects.create(
                    owner=user,
                    name=safe_child_name,
                    parent=target_parent,
                    description=child_folder.description[:100] if child_folder.description else '',
                    is_public=False
                )
                stats['subfolders'] += 1

                child_stats = self._recursive_save_shared_folder_contents(
                    child_folder, new_child, user, share_code
                )
                stats['files'] += child_stats['files']
                stats['subfolders'] += child_stats['subfolders']

            except Exception as e:
                stats['errors'].append(f'{child_folder.name}: {str(e)[:50]}')

        # 保存文件
        for file_obj in CloudFile.objects.filter(folder=source_folder, deleted_at__isnull=True):
            try:
                safe_file_name = self._truncate_string(
                    file_obj.name or file_obj.original_name or 'unnamed',
                    max_length=20,
                    suffix=' (分享)'
                )

                CloudFile.objects.create(
                    owner=user,
                    folder=target_parent,
                    name=safe_file_name,
                    original_name=(file_obj.original_name or 'unnamed')[:255],
                    file=file_obj.file,
                    size=file_obj.size,
                    mime_type=file_obj.mime_type,
                    md5=file_obj.md5,
                    description=self._truncate_string(f'分享:{share_code}', max_length=100)
                )
                stats['files'] += 1

            except Exception as e:
                stats['errors'].append(f'{file_obj.original_name}: {str(e)[:50]}')

        return stats

    @action(detail=False, methods=['get'])
    def verify(self, request):
        """验证分享码"""
        share_code = request.query_params.get('code', '')
        password = request.query_params.get('password', '')

        if not share_code:
            return Response({'error': '分享码不能为空'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            share = FileShare.objects.get(share_code=share_code, is_active=True)

            # 检查是否过期
            if share.is_expired():
                return Response({'error': '分享已过期'}, status=status.HTTP_403_FORBIDDEN)

            # 验证密码
            if share.share_type == 'password' and share.password:
                if password != share.password:
                    return Response({'error': '密码错误'}, status=status.HTTP_403_FORBIDDEN)

            # 验证用户权限
            if share.share_type == 'private':
                if not share.allowed_users.filter(id=request.user.id).exists():
                    return Response({'error': '无访问权限'}, status=status.HTTP_403_FORBIDDEN)

            return Response({
                'valid': True,
                'share_type': share.share_type,
                'file': CloudFileSerializer(share.file, context={'request': request}).data if share.file else None,
                'folder': FolderSerializer(share.folder, context={'request': request}).data if share.folder else None
            })

        except FileShare.DoesNotExist:
            return Response({'error': '分享不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['get'])
    def access(self, request, pk=None):
        """分享链接访问验证"""
        try:
            share = FileShare.objects.select_related('file', 'folder', 'owner').get(
                share_code=pk,
                is_active=True
            )

            # 检查过期时间
            if share.expires_at and share.expires_at < timezone.now():
                share.is_active = False
                share.save()
                return Response({'error': '分享链接已过期'}, status=403)

            # 检查下载次数
            if share.max_downloads and share.download_count >= share.max_downloads:
                share.is_active = False
                share.save()
                return Response({'error': '分享链接已达到下载限制'}, status=403)

            # 密码验证（如果需要）
            if share.share_type == 'password':
                provided_password = request.query_params.get('password')
                if provided_password != share.password:
                    return Response({'error': '密码错误'}, status=403)

            # 记录访问日志
            FileOperationLog.objects.create(
                file=share.file,
                folder=share.folder,
                operation='share_access',
                description=f'访问分享链接：{share.share_code}',
                ip_address=get_request_ip(request),
                user_agent=request.META.get('HTTP_USER_AGENT', '')[:200],
                extra_data={'share_id': str(share.id)}
            )

            # 返回文件信息（不直接返回文件，由前端决定是否下载）
            file_obj = share.file or share.folder
            serializer = CloudFileSerializer if share.file else FolderSerializer
            return Response({
                'name': file_obj.name,
                'type': 'file' if share.file else 'folder',
                'size': getattr(file_obj, 'size', None),
                'can_download': True,
                'watermark_enabled': True,  # 外链访问启用强制水印
            })

        except FileShare.DoesNotExist:
            return Response({'error': '分享链接不存在或已失效'}, status=404)


class FileCommentViewSet(viewsets.ModelViewSet):
    """文件评论视图集"""
    queryset = FileComment.objects.all()
    serializer_class = FileCommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = FileComment.objects.filter(parent__isnull=True)
        file_id = self.request.query_params.get('file', '')
        if file_id:
            queryset = queryset.filter(file_id=file_id)
        return queryset.select_related('user', 'file').prefetch_related('replies')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class CloudDashboardViewSet(viewsets.ViewSet):
    """网盘仪表盘视图集"""
    permission_classes = [permissions.IsAuthenticated]

    @action(detail=False, methods=['get'])
    def overview(self, request):
        """获取网盘概览"""
        user = request.user

        # 用户文件统计
        total_count = CloudFile.objects.filter(owner=user, deleted_at__isnull=True).count()
        total_size = CloudFile.objects.filter(
            owner=user,
            deleted_at__isnull=True
        ).aggregate(total=Sum('size'))['total'] or 0

        # 回收站统计

        # 协作文档统计
        collab_file_ids = FileCollaboration.objects.filter(
            is_active=True
        ).filter(Q(user=user) | Q(file__owner=user)).values_list('file_id', flat=True)
        query_condition = Q(id__in=collab_file_ids)
        # 基础查询：文档类型 + 联合权限条件
        queryset = CloudFile.objects.filter(
            # deleted_at__isnull=True,
            is_document=True
        ).filter(query_condition).distinct()
        collab_count = queryset.count()


        # 最近文件
        recent_files = CloudFile.objects.filter(
            owner=user,
            deleted_at__isnull=True
        ).order_by('-created_at')[:5]

        # 最近分享
        recent_shares = FileShare.objects.filter(
            owner=user,
            is_active=True
        ).order_by('-created_at')[:5]

        # 存储配额（可配置）
        storage_quota = 10 * 1024 * 1024 * 1024  # 10GB
        storage_used_percent = (total_size / storage_quota * 100) if storage_quota > 0 else 0

        return Response({
            'total_size': total_size,
            'total_size_formatted': self.format_size(total_size),
            'total_count': total_count,
            'collab_count': collab_count,
            'starred_count': CloudFile.objects.filter(owner=user, is_starred=True).count(),
            'shared_count': FileShare.objects.filter(owner=user, is_active=True).count(),
            'trash_count': CloudFile.objects.filter(owner=user, deleted_at__isnull=False).count(),


            'storage_quota': storage_quota,
            'storage_quota_formatted': self.format_size(storage_quota),
            'storage_used_percent': round(storage_used_percent, 2),

            'recent_files': CloudFileSerializer(recent_files, many=True, context={'request': request}).data,
            'recent_shares': FileShareSerializer(recent_shares, many=True, context={'request': request}).data
        })

    def format_size(self, size):
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f'{size:.2f} {unit}'
            size /= 1024
        return f'{size:.2f} PB'


class ShareAccessView(APIView):
    """
    🔧 分享链接访问视图
    - 不需要登录即可访问
    - 支持密码验证
    - 支持文件下载
    """
    permission_classes = [permissions.AllowAny]  # ✅ 允许匿名访问

    def get(self, request, share_code):
        """
        访问分享链接（展示分享页面）
        GET /api/cloud/share/{share_code}/
        GET /s/{share_code}/
        """
        try:
            logger.info(f'Share access: {share_code}')
            share = FileShare.objects.get(share_code=share_code, is_active=True)

            # 检查是否过期
            if share.is_expired():
                return render(request, 'cloud/share_expired.html', {
                    'share_code': share_code,
                    'error': '分享已过期'
                })

            config = CloudSystemConfig.objects.filter(key='system.download_enabled').first()
            if config:
                download_enabled = config.get_value('system.download_enabled')
            else:
                download_enabled = True

            # 获取分享的文件/文件夹信息
            context = {
                'share': share,
                'share_code': share_code,
                'code': share.password or '',
                'requires_password': share.share_type == 'password' and bool(share.password),
                'file': share.file if share.file else None,
                'folder': share.folder if share.folder else None,
                'owner': share.owner,
                'created_at': share.created_at,
                'expires_at': share.expires_at,
                'max_downloads': share.max_downloads,
                'download_count': share.download_count,
                'download_enabled': download_enabled,
            }

            logger.info(f'Share access: {share_code} context: {context}')
            logger.info(f'Share access: {share_code} share: {share}')
            logger.info(f'Share access: {share_code} share.file: {share.file}')
            logger.info(f'Share access: {share_code} share.folder: {share.folder}')

            # 如果是密码保护且未验证，显示密码输入页面
            if context['requires_password']:
                # 如果还没验证过 session，显示密码页
                if not request.session.get(f'share_verified_{share_code}'):
                    return render(request, 'cloud/share_password.html', context)

            # 显示分享详情页面
            return render(request, 'cloud/share_detail.html', context)

        except FileShare.DoesNotExist:
            return render(request, 'cloud/share_not_found.html', {
                'share_code': share_code,
                'error': '分享不存在或已被取消'
            })

    def post(self, request, share_code):
        """
        验证分享密码
        POST /api/cloud/share/{share_code}/
        POST /s/{share_code}/
        """
        try:
            logger.info(f'Share access: {share_code}')
            share = FileShare.objects.get(share_code=share_code, is_active=True)

            if share.is_expired():
                return render(request, 'cloud/share_expired.html', {'share_code': share_code, 'error': '分享已过期'})

            # 如果是密码保护类型
            if share.share_type == 'password' and share.password:
                password = request.data.get('password', '') or request.POST.get('password', '')

                if password != share.password:
                    # 密码错误，重新渲染密码页并显示错误
                    context = {
                        'share': share,
                        'share_code': share_code,
                        'error': '密码错误',
                        'requires_password': True
                    }
                    return render(request, 'cloud/share_password.html', context, status=403)

                # 🔧 关键修复：密码正确，写入 Session 标记已验证
                request.session[f'share_verified_{share_code}'] = True

            # 🔧 关键修复：验证成功后，重定向到 GET 请求，由 GET 渲染详情页
            return redirect('cloud-share-access', share_code=share_code)

        except FileShare.DoesNotExist:
            return render(request, 'cloud/share_not_found.html', {'share_code': share_code})


class ShareDownloadView(APIView):
    """
    🔧 短链接直接下载视图
    用于触发文件下载，同时统计下载次数
    URL: /s/{share_code}/download/
    """
    permission_classes = [permissions.AllowAny]

    def get(self, request, share_code):
        try:
            share = FileShare.objects.get(share_code=share_code, is_active=True)

            if share.is_expired():
                return HttpResponseForbidden('分享已过期或无效')

            # 如果受密码保护，检查 Session
            if share.share_type == 'password' and share.password:
                if not request.session.get(f'share_verified_{share_code}'):
                    return redirect('share-short', share_code=share_code)

            try:
                config = CloudSystemConfig.objects.filter(key='system.download_enabled').first()
                if config:
                    download_enabled = config.get_value('system.download_enabled')
                    if not download_enabled:
                        return render(request, 'cloud/share_not_allowed.html')
            except Exception as e:
                logger.error(f"Error: {e}")

            if share.file:
                # 更新下载次数
                share.download_count += 1
                share.save()

                # 🔧 关键修复：安全获取文件名并编码
                original_name = share.file.name or share.file.original_name or 'download'
                safe_filename = self._sanitize_filename(original_name)

                # 构建 Content-Disposition（支持中文文件名）
                content_disposition = self._build_content_disposition(safe_filename)

                # 构建文件响应
                response = FileResponse(
                    share.file.file,
                    as_attachment=True,
                    filename=safe_filename  # 使用安全文件名
                )
                response['Content-Disposition'] = content_disposition
                response['Content-Length'] = share.file.size
                response['X-Content-Type-Options'] = 'nosniff'
                return response

            elif share.folder:
                folder = share.folder

                # 🔧 关键修复：安全获取文件夹名称
                folder_name = folder.name if folder.name else 'shared_folder'
                safe_filename = self._sanitize_filename(folder_name)

                # 构建 Content-Disposition（支持中文文件名）
                content_disposition = self._build_content_disposition(f"{safe_filename}.zip")

                # 创建内存中的 ZIP 缓冲区
                buffer = io.BytesIO()
                stats = {
                    'files_count': 0,
                    'folders_count': 0,
                    'total_size': 0,
                    'errors': []
                }

                # 创建 ZIP 文件
                with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zip_file:
                    self._add_folder_to_zip_recursive(
                        folder=folder,
                        zip_file=zip_file,
                        zip_base_path='',
                        stats=stats
                    )

                # 获取压缩后的大小并重置指针
                zip_size = buffer.tell()
                buffer.seek(0)

                logger.info(f'Share folder download: {share_code}, filename: {safe_filename}.zip, stats: {stats}')

                # 🔧 关键修复：创建正确的 HTTP 响应
                response = HttpResponse(buffer.getvalue(), content_type='application/zip')
                response['Content-Disposition'] = content_disposition
                response['Content-Length'] = zip_size
                response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                response['Pragma'] = 'no-cache'
                response['Expires'] = '0'
                response['X-Content-Type-Options'] = 'nosniff'

                # 更新下载次数
                share.download_count += 1
                share.save()

                return response
            else:
                return HttpResponseForbidden('该分享不包含可下载的内容')

        except FileShare.DoesNotExist:
            return HttpResponseForbidden('分享不存在')
        except Exception as e:
            logger.error(f'Share download error: {e}', exc_info=True)
            return HttpResponseServerError('下载失败，请稍后重试')

    # 🔧 新增：构建 Content-Disposition 头（支持中文文件名）
    def _build_content_disposition(self, filename):
        """
        🔧 构建 Content-Disposition 头，支持中文和特殊字符文件名
        使用 RFC 5987 编码格式
        """
        # ASCII 文件名（兼容旧浏览器）
        ascii_filename = filename.encode('ascii', 'ignore').decode('ascii')

        # UTF-8 编码文件名（支持中文）
        encoded_filename = quote(filename)

        # 返回双重格式，确保最大兼容性
        return f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'

    def _add_folder_to_zip_recursive(self, folder, zip_file, zip_base_path='', stats=None):
        """
        🔧 关键修复：递归添加文件夹内容到 ZIP（支持多级目录）

        @param folder: 当前处理的 Folder 对象
        @param zip_file: zipfile.ZipFile 对象
        @param zip_base_path: 在 ZIP 文件中的基础路径（用于构建相对路径）
        @param stats: 统计信息字典（可选，用于记录下载统计）

        目录结构示例：
        原文件夹结构：
            📁 项目资料/
            ├── 📄 需求文档.docx
            ├── 📁 设计稿/
            │   ├── 🖼️ 首页.png
            │   └── 📁 图标/
            │       └── 🖼️ logo.svg
            └── 📁 代码/
                └── 💻 main.py

        ZIP 中的结构：
            📦 项目资料.zip
            ├── 📄 需求文档.docx
            ├── 📁 设计稿/
            │   ├── 🖼️ 首页.png
            │   └── 📁 图标/
            │       └── 🖼️ logo.svg
            └── 📁 代码/
                └── 💻 main.py
        """

        if stats is None:
            stats = {'files_count': 0, 'folders_count': 0, 'total_size': 0, 'errors': []}

        # 🔧 1. 添加当前文件夹内的所有文件
        files = CloudFile.objects.filter(
            folder=folder,
            deleted_at__isnull=True
        ).select_related('owner')

        for file_obj in files:
            if not file_obj.file:
                continue

            try:
                file_path = file_obj.file.path

                # 验证文件存在
                if not os.path.exists(file_path):
                    logger.warning(f'文件不存在，跳过：{file_path}')
                    stats['errors'].append(f'文件不存在：{file_obj.name}')
                    continue

                # 🔧 构建在 ZIP 中的相对路径
                # 如果 zip_base_path 为空，文件直接放在 ZIP 根目录
                # 否则放在 zip_base_path/文件名
                if zip_base_path:
                    arcname = os.path.join(zip_base_path,
                                           self._sanitize_filename(file_obj.name or file_obj.original_name))
                else:
                    arcname = self._sanitize_filename(file_obj.name or file_obj.original_name)

                # 🔧 写入文件到 ZIP（保持原有文件名）
                zip_file.write(file_path, arcname)

                # 更新统计
                stats['files_count'] += 1
                stats['total_size'] += file_obj.size or 0

                logger.debug(f'✓ 已添加文件：{arcname} ({self._format_size(file_obj.size)})')

            except FileNotFoundError:
                logger.warning(f'文件已删除：{file_obj.name}')
                stats['errors'].append(f'文件已删除：{file_obj.name}')
            except PermissionError:
                logger.warning(f'无权限读取文件：{file_obj.file.path}')
                stats['errors'].append(f'无权限：{file_obj.name}')
            except Exception as e:
                logger.warning(f'添加文件失败 {file_obj.name}: {e}')
                stats['errors'].append(f'{file_obj.name}: {str(e)[:50]}')

        # 🔧 2. 递归处理所有子文件夹
        subfolders = Folder.objects.filter(
            parent=folder,
            deleted_at__isnull=True,
            owner=folder.owner  # 确保是同一用户的文件夹
        ).order_by('name')

        for child_folder in subfolders:
            # 🔧 构建子文件夹在 ZIP 中的路径
            if zip_base_path:
                child_zip_path = os.path.join(zip_base_path, self._sanitize_filename(child_folder.name))
            else:
                child_zip_path = self._sanitize_filename(child_folder.name)

            # 🔧 添加空文件夹标记（ZIP 标准：以 / 结尾表示文件夹）
            # 注意：Python zipfile 会自动处理文件夹，但显式添加更可靠
            zip_file.writestr(f'{child_zip_path}/', '')

            # 更新统计
            stats['folders_count'] += 1

            logger.debug(f'✓ 处理子文件夹：{child_zip_path}/')

            # 🔧 递归处理子文件夹内容
            self._add_folder_to_zip_recursive(
                folder=child_folder,
                zip_file=zip_file,
                zip_base_path=child_zip_path,
                stats=stats
            )

        return stats

    def _sanitize_filename(self, filename):
        """
        🔧 安全处理文件名，防止路径遍历攻击和非法字符
        """

        if not filename:
            return 'unnamed'

        # 1. 移除路径分隔符，防止路径遍历
        filename = os.path.basename(str(filename))

        # 2. 移除或替换非法字符（Windows/Linux 兼容）
        # 保留中文、英文、数字、下划线、点、横杠、空格
        filename = re.sub(r'[<>:"|?*\\]', '_', filename)

        # 3. 移除首尾空格和点
        filename = filename.strip('. ')

        # 4. 限制长度（避免超长文件名）
        if len(filename) > 200:
            name, ext = os.path.splitext(filename)
            filename = name[:190] + ext

        # 5. 确保不为空
        if not filename or filename == '.':
            filename = 'unnamed_file'

        return filename

    def _format_size(self, size_bytes):
        """格式化文件大小"""
        if size_bytes is None or size_bytes == 0:
            return '0 B'

        units = ['B', 'KB', 'MB', 'GB', 'TB']
        unit_index = 0
        size = float(size_bytes)

        while size >= 1024 and unit_index < len(units) - 1:
            size /= 1024
            unit_index += 1

        return f'{size:.2f} {units[unit_index]}'


# 🔧 可选：API 版本的分享访问视图
@api_view(['GET', 'POST'])
@permission_classes([permissions.AllowAny])
def share_access_api(request, share_code):
    """
    分享链接访问 API 版本
    GET/POST /api/cloud/share/{share_code}/
    """
    if request.method == 'GET':
        try:
            share = FileShare.objects.get(share_code=share_code, is_active=True)

            if share.is_expired():
                return Response({'error': '分享已过期', 'expired': True}, status=status.HTTP_403_FORBIDDEN)

            return Response({
                'valid': True,
                'share_type': share.share_type,
                'requires_password': share.share_type == 'password' and bool(share.password),
                'file': CloudFileSerializer(share.file, context={'request': request}).data if share.file else None,
                'folder': FolderSerializer(share.folder, context={'request': request}).data if share.folder else None,
                'share_info': {
                    'owner': share.owner.username,
                    'owner_avatar': share.owner.get_avatar_url(),
                    'created_at': share.created_at.isoformat(),
                    'expires_at': share.expires_at.isoformat() if share.expires_at else None,
                    'max_downloads': share.max_downloads,
                    'download_count': share.download_count,
                }
            })

        except FileShare.DoesNotExist:
            return Response({'error': '分享不存在', 'valid': False}, status=status.HTTP_404_NOT_FOUND)

    elif request.method == 'POST':
        try:
            share = FileShare.objects.get(share_code=share_code, is_active=True)

            if share.is_expired():
                return Response({'error': '分享已过期'}, status=status.HTTP_403_FORBIDDEN)

            action = request.data.get('action', 'verify')

            if action == 'verify':
                password = request.data.get('password', '')
                if share.share_type == 'password' and share.password:
                    if password != share.password:
                        return Response({'error': '密码错误', 'verified': False}, status=status.HTTP_403_FORBIDDEN)

                return Response({'success': True, 'verified': True})

            elif action == 'download':
                if not share.file:
                    return Response({'error': '没有可下载的文件'}, status=status.HTTP_400_BAD_REQUEST)

                if share.max_downloads and share.download_count >= share.max_downloads:
                    return Response({'error': '下载次数已达上限'}, status=status.HTTP_403_FORBIDDEN)

                share.download_count += 1
                share.save()

                response = FileResponse(share.file.file, as_attachment=True,
                                        filename=share.file.name or share.file.original_name)
                response['Content-Length'] = share.file.size
                return response

            return Response({'error': '无效的操作'}, status=status.HTTP_400_BAD_REQUEST)

        except FileShare.DoesNotExist:
            return Response({'error': '分享不存在'}, status=status.HTTP_404_NOT_FOUND)


# cloud/views.py - 添加独立的下载视图
class CloudFileDownloadView(APIView):
    """
    🔧 云文件下载视图（独立于 ViewSet）
    支持两种认证方式：
    1. 自定义下载 token（短期有效）
    2. OnlyOffice JWT token
    """
    authentication_classes = []  # 不进行任何认证
    permission_classes = []  # 🔧 不使用默认权限，在方法内部验证

    def get(self, request, file_id):
        """
        下载文件
        GET /api/cloud/files/{file_id}/download_file/

        认证方式（二选一）：
        1. Query Parameter: ?token=xxx (自定义下载 token)
        2. Query Parameter: ?onlyoffice_token=xxx (OnlyOffice JWT)
        3. Header: Authorization: Bearer xxx (用户 JWT)
        """
        logger.info(f'file_id: {file_id}')
        try:
            # 🔧 1. 获取文件对象
            try:
                file_obj = CloudFile.objects.select_related('owner').get(
                    id=file_id,
                    deleted_at__isnull=True
                )
            except CloudFile.DoesNotExist:
                return Response(
                    {'error': '文件不存在或已被删除'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 🔧 2. 验证访问权限（多种认证方式）
            has_access = False
            auth_method = None

            # 方式 1: 验证自定义下载 token
            download_token = request.query_params.get('token')
            if download_token:
                if self._verify_download_token(file_obj, download_token):
                    has_access = True
                    auth_method = 'download_token'
                    logger.info(f"✅ 认证成功：自定义下载 token")

            # 方式 2: 验证 OnlyOffice JWT token
            if not has_access:
                onlyoffice_token = request.query_params.get('onlyoffice_token') or \
                                   request.query_params.get('token')
                if onlyoffice_token:
                    if self._verify_onlyoffice_jwt(onlyoffice_token):
                        has_access = True
                        auth_method = 'onlyoffice_jwt'
                        logger.info(f"✅ 认证成功：OnlyOffice JWT")

            # 方式 3: 验证用户认证（Django REST Framework 认证）
            if not has_access and request.user.is_authenticated:
                # 验证文件所有者或协作者
                if file_obj.owner == request.user:
                    has_access = True
                    auth_method = 'user_auth'
                    logger.info(f"✅ 认证成功：用户认证（文件所有者）")
                else:
                    # 检查是否是协作者
                    try:
                        is_collaborator = FileCollaboration.objects.filter(
                            file=file_obj,
                            user=request.user,
                            is_active=True
                        ).exists()
                        if is_collaborator:
                            has_access = True
                            auth_method = 'user_auth'
                            logger.info(f"✅ 认证成功：用户认证（协作者）")
                    except ImportError:
                        pass

            # 3. 权限验证失败
            if not has_access:
                logger.warning(f"❌ 认证失败：file_id={file_id}, ip={get_request_ip(request)}")
                return Response(
                    {'error': '认证失败：无权访问该文件'},
                    status=status.HTTP_401_UNAUTHORIZED
                )

            # 4. 记录下载日志
            self._log_download(file_obj, request, auth_method)

            # 5. 更新下载次数
            file_obj.download_count = models.F('download_count') + 1
            file_obj.save(update_fields=['download_count'])

            # 6. 构建文件响应
            return self._build_file_response(file_obj, request)

        except Exception as e:
            logger.info(f"❌ 下载失败：{e}")
            import traceback
            traceback.print_exc()
            return Response(
                {'error': f'下载失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _verify_download_token(self, file_obj, token):
        """验证自定义下载 token"""
        try:
            if not token or ':' not in token:
                return False

            parts = token.split(':')
            if len(parts) != 2:
                return False

            timestamp_str, signature = parts

            # 验证时间戳有效性（5 分钟）
            try:
                timestamp = int(timestamp_str)
                current_time = int(time.time())
                if abs(current_time - timestamp) > 300:
                    logger.info(f"⏰ Token 已过期：{timestamp} vs {current_time}")
                    return False
            except ValueError:
                return False

            # 🔧 关键修复：使用 SECRET_KEY 与生成时一致
            secret = settings.SECRET_KEY
            expected_signature = hashlib.sha256(
                f"{file_obj.id}{timestamp}{secret}".encode()
            ).hexdigest()

            is_valid = signature == expected_signature
            if not is_valid:
                logger.info(f"❌ Token 签名不匹配")
            return is_valid

        except Exception as e:
            logger.error(f"❌ Token 验证失败：{e}")
            return False

    def _verify_onlyoffice_jwt(self, token):
        """验证 OnlyOffice JWT token"""
        try:
            if not token:
                return False

            # 🔧 移除 "Bearer " 前缀和空格
            if token.startswith('Bearer '):
                token = token[7:].strip()
            token = token.strip()

            # 🔧 验证基本格式
            if token.count('.') != 2:
                logger.warning(f'❌ Invalid JWT format: {token[:50]}...')
                return False

            jwt_secret = getattr(settings, 'ONLYOFFICE', {}).get('JWT_SECRET')
            if not jwt_secret:
                logger.warning("⚠️  OnlyOffice JWT_SECRET not configured")
                return False

            # 🔧 验证 JWT（临时禁用过期验证用于调试）
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=['HS256'],
                options={'verify_exp': False}
            )

            logger.info(f"✅ OnlyOffice JWT 验证成功")
            return True

        except jwt.ExpiredSignatureError:
            logger.warning("❌ OnlyOffice JWT 已过期")
            return False
        except jwt.InvalidTokenError as e:
            logger.warning(f"❌ OnlyOffice JWT 无效：{e}")
            return False
        except Exception as e:
            logger.warning(f"❌ OnlyOffice JWT 验证异常：{e}")
            return False

    def _build_file_response(self, file_obj, request):
        """
        🔧 构建文件下载响应
        """
        # 检查文件是否存在
        if not file_obj.file:
            return Response(
                {'error': '文件不存在'},
                status=status.HTTP_404_NOT_FOUND
            )

        file_path = file_obj.file.path
        if not os.path.exists(file_path):
            return Response(
                {'error': '文件物理路径不存在'},
                status=status.HTTP_404_NOT_FOUND
            )

        # 🔧 安全处理文件名
        original_name = file_obj.name or file_obj.original_name or 'download'
        safe_filename = self._sanitize_filename(original_name)

        # 🔧 构建 Content-Disposition（支持中文）
        content_disposition = self._build_content_disposition(safe_filename)

        # 🔧 构建文件响应
        response = FileResponse(
            open(file_path, 'rb'),
            as_attachment=True,
            filename=safe_filename
        )

        # 设置响应头
        response['Content-Disposition'] = content_disposition
        response['Content-Length'] = file_obj.file.size
        response['X-Content-Type-Options'] = 'nosniff'

        # 设置 MIME 类型
        if file_obj.mime_type:
            response['Content-Type'] = file_obj.mime_type
        else:
            # 自动检测 MIME 类型
            import mimetypes
            mime_type, _ = mimetypes.guess_type(safe_filename)
            response['Content-Type'] = mime_type or 'application/octet-stream'

        logger.info(f"✅ 文件响应已构建：{safe_filename} ({file_obj.file.size} bytes)")
        return response

    # 🔧 新增：构建 Content-Disposition 头（支持中文文件名）
    def _build_content_disposition(self, filename):
        """
        🔧 构建 Content-Disposition 头，支持中文和特殊字符文件名
        使用 RFC 5987 编码格式
        """
        # ASCII 文件名（兼容旧浏览器）
        ascii_filename = filename.encode('ascii', 'ignore').decode('ascii')

        # UTF-8 编码文件名（支持中文）
        encoded_filename = quote(filename)

        # 返回双重格式，确保最大兼容性
        return f'attachment; filename="{ascii_filename}"; filename*=UTF-8\'\'{encoded_filename}'

    def _sanitize_filename(self, filename):
        """
        🔧 安全处理文件名
        """
        if not filename:
            return 'unnamed'

        # 1. 移除路径分隔符
        filename = os.path.basename(str(filename))

        # 2. 移除非法字符
        filename = re.sub(r'[<>:"|?*\\]', '_', filename)

        # 3. 移除首尾空格和点
        filename = filename.strip('. ')

        # 4. 限制长度
        if len(filename) > 200:
            name, ext = os.path.splitext(filename)
            filename = name[:190] + ext

        # 5. 确保不为空
        if not filename or filename == '.':
            filename = 'unnamed_file'

        return filename

    def _log_download(self, file_obj, request, auth_method):
        """
        🔧 记录下载日志
        """
        try:
            from .models import FileOperationLog

            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user if request.user.is_authenticated else None,
                operation='download',
                description=f'下载文件：{file_obj.name}',
                ip_address=get_request_ip(request),
                extra_data={
                    'file_name': file_obj.name,
                    'file_size': file_obj.size,
                    'mime_type': file_obj.mime_type,
                    'auth_method': auth_method,
                    'user_agent': request.META.get('HTTP_USER_AGENT', '')[:200],
                }
            )
            logger.info(f"📝 下载日志已记录：{file_obj.id}")
        except Exception as e:
            logger.info(f"⚠️  记录下载日志失败：{e}")


# cloud/views.py - DocumentEditorViewSet 完整修复版

class DocumentEditorViewSet(viewsets.ViewSet, UtilsTools):
    """
    🔧 OnlyOffice 文档编辑器视图集（协同编辑完整版）
    支持：添加/修改/删除/启用/禁用协同用户
    """
    # authentication_classes = []
    permission_classes = []
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    current_config = {}

    @property
    def doc_server_url(self):
        """🔧 从系统配置获取 OnlyOffice 文档服务器地址"""
        return CloudSystemConfig.get_value(
            'onlyoffice.document_server_url',
            settings.ONLYOFFICE.get('DOCUMENT_SERVER_URL', 'https://chat.first-iq.com/onlyoffice')
        )

    @property
    def server_url(self):
        """🔧 从系统配置获取回调服务器地址"""
        return CloudSystemConfig.get_value(
            'onlyoffice.server_url',
            settings.ONLYOFFICE.get('SERVER_URL', 'https://chat.first-iq.com')
        )

    @property
    def jwt_secret(self):
        """🔧 从系统配置获取 JWT 密钥"""
        return CloudSystemConfig.get_value(
            'onlyoffice.jwt_secret',
            settings.ONLYOFFICE.get('JWT_SECRET', '')
        )

    @property
    def jwt_enabled(self):
        """🔧 从系统配置获取 JWT 启用状态"""
        return CloudSystemConfig.get_value(
            'onlyoffice.jwt_enabled',
            settings.ONLYOFFICE.get('JWT_ENABLED', True)
        )

    @property
    def collaboration_mode(self):
        """🔧 从系统配置获取协同编辑模式"""
        return CloudSystemConfig.get_value(
            'collab.collaboration_mode',
            10
        )

    @property
    def version_keep_count(self):
        """🔧 从系统配置获取版本保留数量"""
        return CloudSystemConfig.get_value(
            'storage.version_keep_count',
            settings.ONLYOFFICE.get('VERSION_KEEP_COUNT', 10)
        )

    @property
    def onlyoffice_configs(self):
        """🔧 从系统配置获取 OnlyOffice 权限配置"""

        config = CloudSystemConfig.objects.first()
        if config:
            return {
                'document_server_url': config.onlyoffice_document_server_url,
                'jwt_enabled': config.onlyoffice_jwt_enabled,
                'jwt_secret': config.onlyoffice_jwt_secret,
                'language': config.onlyoffice_language,
                'collaboration_mode': config.onlyoffice_collaboration_mode,
                'version_keep_count': config.onlyoffice_version_keep_count,
                'permissions': {
                    'download': config.onlyoffice_permission_download,
                    'copy': config.onlyoffice_permission_copy,
                    'edit': config.onlyoffice_permission_edit,
                    'print': config.onlyoffice_permission_print,
                    'comment': config.onlyoffice_permission_comment,
                    'chat': config.onlyoffice_permission_chat,
                    'review': config.onlyoffice_permission_review,
                    'fill_forms': config.onlyoffice_permission_fill_forms,
                    'modify_content_control': config.onlyoffice_permission_modify_content_control,
                    'modify_filter': config.onlyoffice_permission_modify_filter,
                },
                'ui': {
                    'show_chat': config.onlyoffice_show_chat,
                    'show_comments': config.onlyoffice_show_comments,
                    'show_review': config.onlyoffice_show_review,
                    'show_spellcheck': config.onlyoffice_show_spellcheck,
                    'forcesave': config.onlyoffice_forcesave,
                    'compact_toolbar': config.onlyoffice_compact_toolbar,
                    'ui_theme': config.onlyoffice_ui_theme,
                },
            }

        return {
            'document_server_url': CloudSystemConfig.get_value('onlyoffice_document_server_url'),
            'jwt_enabled': CloudSystemConfig.get_value('onlyoffice_jwt_enabled', True),
            'jwt_secret': CloudSystemConfig.get_value('onlyoffice_jwt_secret', ''),
            'language': CloudSystemConfig.get_value('onlyoffice_language', 'zh-CN'),
            'collaboration_mode': CloudSystemConfig.get_value('onlyoffice_collaboration_mode', 'fast'),
            'permissions': {
                'download': CloudSystemConfig.get_value('onlyoffice_permission_download', True),
                'copy': CloudSystemConfig.get_value('onlyoffice_permission_copy', True),
                'edit': CloudSystemConfig.get_value('onlyoffice_permission_edit', True),
                'print': CloudSystemConfig.get_value('onlyoffice_permission_print', True),
                'comment': CloudSystemConfig.get_value('onlyoffice_permission_comment', True),
                'chat': CloudSystemConfig.get_value('onlyoffice_permission_chat', True),
                'review': CloudSystemConfig.get_value('onlyoffice_permission_review', True),
                'fillForms': CloudSystemConfig.get_value('onlyoffice_permission_fill_forms', True),
                'modifyContentControl': CloudSystemConfig.get_value('onlyoffice_permission_modify_content_control',
                                                                    True),
                'modifyFilter': CloudSystemConfig.get_value('onlyoffice_permission_modify_filter', True),
            },
            'ui': {
                'show_chat': CloudSystemConfig.get_value('onlyoffice_show_chat', True),
                'show_comments': CloudSystemConfig.get_value('onlyoffice_show_comments', True),
                'show_review': CloudSystemConfig.get_value('onlyoffice_show_review', True),
                'show_spellcheck': CloudSystemConfig.get_value('onlyoffice_show_spellcheck', True),
                'forcesave': CloudSystemConfig.get_value('onlyoffice_forcesave', True),
                'compact_toolbar': CloudSystemConfig.get_value('onlyoffice_compact_toolbar', False),
                'ui_theme': CloudSystemConfig.get_value('onlyoffice_ui_theme', 'theme-light'),
            },
            'version_keep_count': CloudSystemConfig.get_value('onlyoffice_version_keep_count', 10),
        }

    def _get_user_onlyoffice_permissions(self, user):
        """
        🔧 获取用户的 OnlyOffice 权限配置
        优先级：用户自定义权限 > 全局默认权限

        Args:
            user: 当前用户对象

        Returns:
            dict: 权限字典
        """
        try:
            # 尝试获取用户专属权限配置
            user_perm = UserOnlyOfficePermission.objects.filter(
                user=user,
                is_active=True
            ).first()

            if user_perm:
                logger.info(f'✅ 使用用户自定义权限：user={user.username}')
                return user_perm.get_permissions_dict()
            else:
                logger.info(f'ℹ️ 使用全局默认权限：user={user.username}')
                # 返回全局默认权限
                return self.onlyoffice_configs.get('permissions', {})

        except Exception as e:
            logger.error(f'❌ 获取用户权限失败：{e}，使用全局默认权限', exc_info=True)
            return self.onlyoffice_configs.get('permissions', {})

    @property
    def CLOUD_SERVER_URL(self):
        return settings.ONLYOFFICE.get('CLOUD_SERVER_URL', 'https://chat.first-iq.com/cloud/')

    @property
    def supported_formats(self):
        return {
            'word': settings.ONLYOFFICE.get('WORD_FORMATS', []),
            'excel': settings.ONLYOFFICE.get('EXCEL_FORMATS', []),
            'ppt': settings.ONLYOFFICE.get('PPT_FORMATS', []),
            'pdf': settings.ONLYOFFICE.get('PDF_FORMATS', []),
        }

    def _get_document_type(self, filename):
        """根据文件名判断文档类型（返回 OnlyOffice 支持的类型）"""
        if not filename:
            return None
        ext = f'.{filename.split(".")[-1].lower()}'

        if ext in self.supported_formats.get('word', []):
            return 'word'
        elif ext in self.supported_formats.get('excel', []):
            return 'cell'
        elif ext in self.supported_formats.get('ppt', []):
            return 'slide'
        elif ext in self.supported_formats.get('pdf', []):
            return 'word'
        return None

    def _generate_download_token(self, file_obj, expires_in=300):
        """生成文件下载 token，有效期 5 分钟"""
        timestamp = int(time.time()) + expires_in
        secret = settings.SECRET_KEY
        token = hashlib.sha256(
            f"{file_obj.id}{timestamp}{secret}".encode()
        ).hexdigest()
        return f"{timestamp}:{token}"

    def _get_file_url(self, file_obj):
        """构建带 token 的文件访问 URL"""
        token = self._generate_download_token(file_obj)
        # return f"{self.server_url}/api/cloud/files/{file_obj.id}/download/?token={token}"
        return f"{self.server_url}/api/cloud/cloudfiles/{file_obj.id}/download_file/?token={token}"

    def _get_callback_url(self, file_id):
        """构建回调 URL"""
        return f"{self.server_url}/api/cloud/documents/{file_id}/callback/"

    def _generate_jwt_token(self, payload):
        """生成 OnlyOffice JWT Token"""
        if not self.jwt_secret:
            logger.warning('JWT_SECRET not configured')
            return None

        try:
            token_payload = payload
            token_payload['iat'] = int(datetime.now().timestamp())

            # 🔧 添加过期时间（可选，建议 24 小时）
            # token_payload['exp'] = int(datetime.now().timestamp()) + 86400

            # 🔧 使用 HS256 算法
            token = jwt.encode(token_payload, self.jwt_secret, algorithm='HS256')

            # 🔧 Python 3.7+ jwt.encode 返回字符串
            if isinstance(token, bytes):
                token = token.decode('utf-8')

            logger.info(f'✅ JWT token generated: {token[:50]}...')
            return token

        except Exception as e:
            logger.error(f'❌ Failed to generate JWT token: {e}', exc_info=True)
            return None

    def _can_access_document(self, file_obj, user):
        """
        🔧 验证用户是否可以访问文档
        优先级：所有者 > 管理员 > 协作者（FileCollaboration）
        """
        # 1. 文件所有者
        if file_obj.owner == user:
            return True

        # 2. 超级管理员
        if user.is_superuser:
            return True

        # 3. 协作者（通过 FileCollaboration 验证权限）
        # 协作者
        if FileCollaboration.objects.filter(
                file=file_obj,
                user=user,
                is_active=True
        ).exists():
            return True
        return False

    def _can_edit_document(self, file_obj, user):
        """
        🔧 验证用户是否可以编辑文档
        需要 write 或 admin 权限
        """
        # 1. 文件所有者
        if file_obj.owner == user:
            return True

        # 2. 超级管理员
        if user.is_superuser:
            return True

        # 3. 协作者（需要 write 或 admin 权限）
        try:
            collab = FileCollaboration.objects.get(
                file=file_obj,
                user=user,
                is_active=True
            )
            return collab.permission in ['write', 'admin']
        except FileCollaboration.DoesNotExist:
            return False

    def _can_manage_collaborators(self, file_obj, user):
        """
        🔧 验证用户是否可以管理协作者（添加/删除/修改权限）
        需要 admin 权限或是所有者
        """
        # 1. 文件所有者
        if file_obj.owner == user:
            return True

        # 2. 超级管理员
        if user.is_superuser:
            return True

        # 3. 协作者（需要 admin 权限）
        # 协作者（需要 admin 权限）
        collab = FileCollaboration.objects.filter(
            file=file_obj,
            user=user,
            is_active=True
        ).first()
        if collab and collab.permission == 'admin':
            return True
        return False


    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def edit(self, request, pk=None):
        """
        🔧 获取文档编辑配置（集成系统配置 + 协同编辑优化）
        GET /api/cloud/documents/{id}/edit/

        核心功能：
        1. 验证文档访问/编辑权限
        2. 动态加载系统配置（OnlyOffice 参数）
        3. 生成稳定的 document key（支持多人协同）
        4. 构建 JWT Token（如果启用）
        5. 记录协作状态
        """
        try:
            logger.info(f"📝 获取文档编辑配置：{pk}, user: {request.user}")

            # ==================== 1. 获取文件对象 ====================
            try:
                file_obj = CloudFile.objects.select_related('owner').get(id=pk)
            except CloudFile.DoesNotExist:
                logger.error(f'❌ 文件不存在：{pk}')
                return Response({'error': '文件不存在'}, status=status.HTTP_404_NOT_FOUND)

            # ==================== 2. 权限验证 ====================
            # 判断是否是共享文件夹访问
            is_shared_folder_access = self._can_access_with_ancestors(file_obj.folder, request.user)
            # 2.1 访问权限验证
            if not self._can_access_document(file_obj, request.user):
                if not is_shared_folder_access:
                    logger.warning(f'⚠️ 无权访问：user={request.user.username}, file={pk}')
                    return Response(
                        {'error': '您没有权限访问该文件'},
                        status=status.HTTP_403_FORBIDDEN
                    )
                else:
                    logger.info(f'👁️ 共享文件夹访问：user={request.user.username}, file={pk}')

            self.current_config = self.onlyoffice_configs.copy()
            # 🔧 关键修复：优先使用用户自定义权限配置
            base_permissions = self._get_user_onlyoffice_permissions(request.user)

            # 2.2 编辑权限验证（决定编辑器模式）
            can_edit = base_permissions.get('edit')
            if not can_edit:
                logger.info(f'👁️ 只读模式：user={request.user.username} , file={pk}')

            can_edit = self._can_edit_document(file_obj, request.user)
            if not can_edit:
                logger.warning(f'⚠️ 无权限编辑：user={request.user.username}, file={pk}')

            # 如果是共享文件夹访问，检查是否有写入权限
            if is_shared_folder_access:
                can_edit = self._can_write_with_ancestors(file_obj.folder, request.user)
                logger.info(f'👁️ 共享文件夹编辑：user={request.user.username}, file={pk} can_edit: {can_edit}')

            # ==================== 3. 基础信息准备 ====================
            # 3.1 文件扩展名和文档类型
            file_ext = file_obj.original_name.split('.')[-1].lower() if file_obj.original_name else ''
            doc_type = self._get_document_type(file_obj.original_name)
            if not doc_type:
                return Response(
                    {'error': f'不支持的文档格式：.{file_ext}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 3.2 URL 构建
            file_url = self._get_file_url(file_obj)
            callback_url = self._get_callback_url(pk)

            # ==================== 4. 权限配置（动态加载系统配置 + 用户自定义权限）====================
            # 4.1 基础权限模板（已在上文通过 _get_user_onlyoffice_permissions 获取）
            # base_permissions 已经包含用户自定义权限或全局默认权限


            # 4.2 根据编辑权限调整
            if not can_edit:
                # 只读模式：禁用编辑相关权限
                restricted_permissions = {
                    'edit': False,
                    'comment': base_permissions.get('comment', False),  # 可配置是否允许评论
                    'download': base_permissions.get('download', False),
                    'copy': base_permissions.get('copy', False),
                    'print': base_permissions.get('print', False),
                    'fillForms': False,
                    'modifyContentControl': False,
                    'modifyFilter': False,
                }
                permissions = {**base_permissions, **restricted_permissions}
            else:
                permissions = base_permissions

            # ==================== 5. 用户信息 ====================
            user_info = {
                'id': str(request.user.id),
                'name': request.user.real_name or request.user.username,
                'email': request.user.email or '',
            }

            # ==================== 6. Document Key 生成（协同编辑关键）====================
            # 🔧 关键：使用稳定的 key，确保同一文档的多用户能进入同一协同会话
            # 格式：{file_id}_{md5}_{updated_timestamp}
            # - file_id: 文件唯一标识
            # - md5: 文件内容哈希，内容变化时重置协同会话
            # - updated_timestamp: 秒级时间戳，文件修改后协同会话才会重置

            md5_value = file_obj.md5 or str(file_obj.id)
            updated_ts = int(file_obj.updated_at.timestamp()) if file_obj.updated_at else int(
                timezone.now().timestamp())
            document_key = f"{file_obj.id}_{md5_value}_{updated_ts}"

            logger.debug(f'🔑 Document Key: {document_key[:50]}...')

            # ==================== 7. 构建 OnlyOffice 配置 ====================
            config = {
                # ── 文档核心配置 ──
                'document': {
                    'fileType': file_ext,
                    'key': document_key,  # ✅ 稳定的 key 支持协同编辑
                    'title': file_obj.name or file_obj.original_name or '未命名文档',
                    'version_number': file_obj.current_version.version_number if file_obj.current_version else '' ,
                    'url': file_url,
                    'permissions': permissions,
                    # 🔧 可选：添加文档信息（用于前端展示）
                    'info': {
                        'owner': file_obj.owner.username,
                        'created': file_obj.created_at.isoformat() if file_obj.created_at else None,
                        'modified': file_obj.updated_at.isoformat() if file_obj.updated_at else None,
                    }
                },

                # ── 编辑器类型 ──
                'documentType': doc_type,  # word/cell/slide

                # ── 编辑器配置 ──
                'editorConfig': {
                    'callbackUrl': callback_url,
                    'user': user_info,

                    # 语言和本地化
                    'lang': self.current_config.get('language', 'zh-CN'),
                    'region': self.current_config.get('language', 'zh-CN'),

                    # 编辑模式
                    'mode': 'edit' if can_edit else 'view',

                    # 🔧 自定义配置（从系统配置动态加载）
                    'customization': {
                        # 自动保存
                        'autosave': CloudSystemConfig.get_value('onlyoffice.autosave', True),

                        # 功能开关
                        'chat': CloudSystemConfig.get_value('onlyoffice.features.chat', True),
                        'comments': CloudSystemConfig.get_value('onlyoffice.features.comments', True),
                        'spellcheck': CloudSystemConfig.get_value('onlyoffice.features.spellcheck', True),
                        'mentionShare': CloudSystemConfig.get_value('onlyoffice.features.mention_share', True),

                        # 反馈和帮助
                        'feedback': False,  # 生产环境建议关闭
                        'help': CloudSystemConfig.get_value('onlyoffice.features.help', False),

                        # 强制保存按钮
                        'forcesave': CloudSystemConfig.get_value('onlyoffice.features.forcesave', True),
                        'forcesaveButton': can_edit and CloudSystemConfig.get_value(
                            'onlyoffice.features.forcesave_button', True),

                        # 返回按钮配置
                        'goback': {
                            'blank': False,
                            'requestClose': False,
                            'text': CloudSystemConfig.get_value('onlyoffice.goback_text', '返回网盘'),
                            'url': f'{self.CLOUD_SERVER_URL}',
                        },

                        # 品牌定制
                        'logo': {
                            'image': f'{self.server_url}/media/avatars/cloud-green.svg',
                            'imageEmbedded': True,
                        },
                        'about': False,  # 隐藏"关于"按钮
                        'customer': {
                            'name': CloudSystemConfig.get_value('cloud.name', '企业网盘'),
                            'mail': CloudSystemConfig.get_value('cloud.contact_email', 'support@company.com'),
                            'www': self.CLOUD_SERVER_URL,
                            'info': CloudSystemConfig.get_value('cloud.description', '内部协同办公平台'),
                        },

                        # 界面布局
                        'hideRightMenu': self.current_config.get('ui', {}).get('hide_right_menu', False),
                        'toolbarNoTabs': self.current_config.get('ui', {}).get('toolbar_no_tabs', False),
                        'compactToolbar': self.current_config.get('ui', {}).get('compact_toolbar', False),
                        'uiTheme': self.current_config.get('ui', {}).get('ui_theme', 'theme-light'),

                        # 审阅显示模式
                        'reviewDisplay': self.current_config.get('ui', {}).get('show_review', True),

                        # 🔧 协同编辑模式配置
                        'collaboration': {
                            'mode': self.current_config.get('collaboration_mode', 'fast'),  # fast/strict
                        },
                    },

                    # 🔧 权限配置（新版 OnlyOffice 要求）
                    'permissions': permissions,

                    # 🔧 协同编辑配置
                    'coEditing': {
                        'mode': self.current_config.get('collaboration_mode', 'fast'),
                        'change': can_edit,  # 只读用户不能触发变更
                    },

                    # 最近文档（仅编辑模式显示）
                    'recent': self._get_recent_documents(request.user) if can_edit else [],
                },

                # ── 编辑器尺寸和类型 ──
                'height': '100%',
                'width': '100%',
                'type': 'desktop',  # desktop/mobile/embedded
            }

            # ==================== 8. JWT Token 集成 ====================
            if self.jwt_enabled and self.jwt_secret:
                try:
                    jwt_token = self._generate_jwt_token(config)
                    if jwt_token:
                        config['token'] = jwt_token
                        logger.debug('✅ JWT Token 生成成功')
                    else:
                        logger.warning('⚠️ JWT Token 生成返回 None')
                except Exception as jwt_err:
                    logger.error(f'❌ JWT Token 生成异常: {jwt_err}', exc_info=True)
                    # JWT 失败不影响编辑器加载，继续返回配置
            else:
                logger.info('ℹ️ JWT 未启用或 JWT_SECRET 未配置')

            # ==================== 9. 记录协作状态 ====================
            try:
                self._record_collaboration(file_obj, request.user, 'editing')
            except Exception as collab_err:
                logger.warning(f'⚠️ 记录协作状态失败: {collab_err}')
                # 协作记录失败不影响编辑器加载

            # ==================== 10. 返回配置 ====================
            logger.info(
                f'✅ Edit config generated: file={pk}, user={request.user.username}, mode={"edit" if can_edit else "view"}')
            return Response(config)

        except CloudFile.DoesNotExist:
            logger.error(f'❌ 文档不存在: {pk}')
            return Response({'error': '文档不存在'}, status=status.HTTP_404_NOT_FOUND)

        except PermissionError as e:
            logger.warning(f'⚠️ 权限拒绝: {e}')
            return Response({'error': '权限不足'}, status=status.HTTP_403_FORBIDDEN)

        except Exception as e:
            logger.error(f'❌ Get edit config failed: {e}', exc_info=True)
            return Response(
                {'error': f'获取编辑配置失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _record_collaboration(self, file_obj, user, status):
        """
        🔧 记录协作状态（DocumentCollaboration）
        status: editing/viewing/closed
        """
        collab, created = DocumentCollaboration.objects.get_or_create(
            file=file_obj,
            user=user,
            defaults={'status': status}
        )

        if not created:
            collab.status = status
            collab.last_activity = timezone.now()
            if status == 'closed':
                collab.left_at = timezone.now()
            collab.save(update_fields=['status', 'last_activity', 'left_at'])

    def _get_recent_documents(self, user):
        """获取用户最近编辑的文档"""
        recent = CloudFile.objects.filter(
            owner=user,
            deleted_at__isnull=True,
            original_name__iregex=r'\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$'
        ).order_by('-updated_at')[:10]

        return [
            {
                'url': self._get_file_url(f),
                'title': f.name or f.original_name,
            }
            for f in recent
        ]

    # ==================== 协作者管理接口 ====================

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def retrieve_doc_detail(self, request, pk=None):
        """获取单个文档详情"""
        try:
            user = request.user
            file_obj = CloudFile.objects.get(id=pk)
            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, user):
                return Response(
                    {'error': '无权管理协作者'},
                    status=status.HTTP_403_FORBIDDEN
                )

            serializer = CloudFileSerializer(file_obj, context={'request': request})
            return Response(serializer.data)

        except CloudFile.DoesNotExist:
            return Response(
                {'error': '文档不存在'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f"Error: {e}")
            return Response(
                {'error': '获取文档详情失败'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def list_collabs(self, request):
        """
        🔧 获取协作文档列表（完善版）
        GET /api/cloud/documents/list_collabs/

        参数：
        - search: 搜索关键词
        - folder: 文件夹过滤
        - page/page_size: 分页参数
        - order: 排序字段 (-updated_at/name)
        
        逻辑修复：
        - 文档拥有者自动拥有协作权限，必须能查看到自己创建的文档
        - 同时包含被授权协作的文档
        - 使用 Q 对象合并查询条件，避免遗漏
        """
        try:
            user = request.user

            # 🔧 关键修复：获取用户有权限访问的协作文档
            # 1. 用户自己创建的文档 (owner=user) -> 自动视为最高权限协作者
            # 2. 用户作为协作者被授权的文档 (FileCollaboration)

            # 获取协作关系的文件 ID (他人分享给当前用户的) + 协作文件主体是当前用户

            collab_file_ids = FileCollaboration.objects.filter(
                is_active=True
            ).filter(Q(user=user) | Q(file__owner=user)).values_list('file_id', flat=True)

            logger.info(f'collab_file_ids (shared with me): {list(collab_file_ids)}')

            # 🔧 关键修复：构建联合查询条件 (Q 对象)
            # 条件 A: 当前用户是所有者
            # 条件 B: 当前用户在协作列表中
            query_condition = Q(id__in=collab_file_ids)

            # 基础查询：文档类型 + 未删除 + 联合权限条件
            queryset = CloudFile.objects.filter(
                # deleted_at__isnull=True,
                is_document=True
            ).filter(query_condition).distinct()

            logger.info(f'queryset count: {queryset.count()}')

            # 🔧 搜索过滤
            search = request.query_params.get('search', '').strip()
            if search:
                queryset = queryset.filter(
                    Q(name__icontains=search) |
                    Q(original_name__icontains=search) |
                    Q(description__icontains=search)
                )

            # 🔧 文件夹过滤
            folder_id = request.query_params.get('folder')
            if folder_id and folder_id.lower() != 'null':
                queryset = queryset.filter(folder_id=folder_id)

            # 🔧 排序
            order = request.query_params.get('order', '-updated_at')
            valid_orders = ['updated_at', '-updated_at', 'name', '-name', 'created_at', '-created_at']
            if order in valid_orders:
                queryset = queryset.order_by(order)
            else:
                queryset = queryset.order_by('-updated_at')

            # 🔧 分页处理
            paginator = PageNumberPagination()
            try:
                paginator.page_size = int(request.query_params.get('page_size', 20))
            except (ValueError, TypeError):
                paginator.page_size = 20

            page = paginator.paginate_queryset(queryset, request)
            if page is not None:
                serializer = CloudFileSerializer(page, many=True, context={'request': request})
                # 🔧 添加协作者数量等扩展信息
                data = []
                for item in serializer.data:
                    file_id = item.get('id')
                    # 获取协作者数量
                    collab_count = FileCollaboration.objects.filter(
                        file_id=file_id,
                        is_active=True
                    ).count()
                    # 获取文档类型
                    doc_type = item.get('document_type', 'word')

                    # 判断当前用户是否是所有者
                    # 注意：serializer.data 中的 owner 可能是字典或 ID 字符串，需兼容处理
                    owner_id = item.get('owner')
                    if isinstance(owner_id, dict):
                        owner_id = owner_id.get('id')
                    is_owner = str(owner_id) == str(user.id)

                    # 判断当前用户的协作权限
                    # 所有者默认为 admin 权限
                    user_permission = 'admin' if is_owner else 'read'
                    if not is_owner:
                        collab_rel = FileCollaboration.objects.filter(
                            file_id=file_id,
                            user=user,
                            is_active=True
                        ).first()
                        if collab_rel:
                            user_permission = collab_rel.permission

                    item['collaborator_count'] = collab_count
                    item['doc_type_text'] = self._get_doc_type_text(doc_type)
                    item['doc_icon'] = self._get_doc_icon_class(doc_type)
                    item['user_permission'] = user_permission
                    item['is_owner'] = is_owner
                    data.append(item)

                return paginator.get_paginated_response(data)

            # 非分页情况（兼容旧逻辑，但建议始终使用分页）
            serializer = CloudFileSerializer(queryset, many=True, context={'request': request})
            data = []
            for item in serializer.data:
                file_id = item.get('id')
                collab_count = FileCollaboration.objects.filter(
                    file_id=file_id,
                    is_active=True
                ).count()
                doc_type = item.get('document_type', 'word')

                # 兼容处理 owner 字段
                owner_id = item.get('owner')
                if isinstance(owner_id, dict):
                    owner_id = owner_id.get('id')
                is_owner = str(owner_id) == str(user.id)

                user_permission = 'admin' if is_owner else 'read'
                if not is_owner:
                    collab_rel = FileCollaboration.objects.filter(
                        file_id=file_id,
                        user=user,
                        is_active=True
                    ).first()
                    if collab_rel:
                        user_permission = collab_rel.permission

                item['collaborator_count'] = collab_count
                item['doc_type_text'] = self._get_doc_type_text(doc_type)
                item['doc_icon'] = self._get_doc_icon_class(doc_type)
                item['user_permission'] = user_permission
                item['is_owner'] = is_owner
                data.append(item)

            return Response(data)

        except Exception as e:
            logger.error(f'获取协作文档列表失败：{e}', exc_info=True)
            return Response({'error': f'获取失败：{str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated], url_path='create-collab')
    def create_collab_doc(self, request):
        """
        🔧 从现有云文件创建协作文档，并指定协作者
        POST /api/cloud/documents/custom-create/
        {
            "file_id": "uuid-xxx",  //  目标云文件id
            "initial_collaborators": [  // 初始协作者
                {"user_id": 123, "permission": "write"},
                {"user_id": 456, "permission": "read"}
            ]
        }
        """
        try:
            user = request.user
            initial_collaborators = request.data.get('initial_collaborators', [])
            file_id = request.data.get('file_id')

            if not file_id:
                return Response({'error': '请指定源文件'}, status=status.HTTP_400_BAD_REQUEST)

            if not initial_collaborators:
                return Response({'error': '请指定初始协作者'}, status=status.HTTP_400_BAD_REQUEST)

            # 1. 获取源文件（支持所有者或协作者访问）
            try:
                file_obj = CloudFile.objects.select_related('owner').get(id=file_id)
            except CloudFile.DoesNotExist:
                return Response({'error': '文件不存在'}, status=status.HTTP_404_NOT_FOUND)

            # 2. 权限验证
            if not self._can_access_document(file_obj, request.user):
                return Response(
                    {'error': '您没有权限访问该文件'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 🔧 添加初始协作者
            collaborator_count = 0
            for collab_info in initial_collaborators:
                try:
                    collab_user = CustomUser.objects.get(id=collab_info.get('user_id'))
                    permission = collab_info.get('permission', 'read')

                    if permission not in ['read', 'write', 'admin']:
                        permission = 'read'

                    FileCollaboration.objects.update_or_create(
                        file=file_obj,
                        user=collab_user,
                        defaults={
                            'permission': permission,
                            'is_active': True,
                        }
                    )

                    # 记录操作日志
                    FileOperationLog.objects.create(
                        file=file_obj,
                        user=user,
                        operation='add_collaborator',
                        description=f'创建文档时添加协作者：{collab_user.username}',
                        ip_address=get_request_ip(request),
                        extra_data={
                            'collaborator_id': str(collab_user.id),
                            'collaborator_username': collab_user.username,
                            'permission': permission,
                        }
                    )

                    collaborator_count += 1

                except CustomUser.DoesNotExist:
                    logger.warning(f'协作用户不存在：{collab_info.get("user_id")}')
                    continue

            logger.info(f'创建协作文档成功：{file_obj.id}')

            return Response({
                'message': '文档创建成功',
                'file_id': str(file_obj.id),
                'document_type': file_obj.document_type,
                'collaborator_count': collaborator_count,
                'edit_url': f'/cloud/editor/?id={file_obj.id}',
                'file_url': f'/api/cloud/files/{file_obj.id}/download/',
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f'创建协作文档失败：{e}', exc_info=True)
            return Response(
                {'error': f'创建失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['delete'], permission_classes=[permissions.IsAuthenticated], url_path='remove-collab')
    def remove_collab_doc(self, request, pk=None):
        """
        🔧 清除文档的所有协作关系（重置协作者列表）
        DELETE /api/cloud/documents/{id}/remove-collab/
        
        逻辑：
        1. 验证文档存在
        2. 验证当前用户是否有管理权限（所有者或管理员）
        3. 删除该文档下所有的 FileCollaboration 记录
        4. 记录操作日志
        """
        try:
            user = request.user

            # 1. 获取文档对象
            try:
                file_obj = CloudFile.objects.get(id=pk)
            except CloudFile.DoesNotExist:
                return Response(
                    {'error': '文档不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 2. 验证管理权限
            if not self._can_manage_collaborators(file_obj, user):
                return Response(
                    {'error': '无权管理协作者，只有文档所有者或管理员可执行此操作'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 3. 统计将被删除的协作者数量（用于日志）
            collab_count = FileCollaboration.objects.filter(file=file_obj).count()

            if collab_count == 0:
                return Response({
                    'message': '该文档暂无协作者',
                    'removed_count': 0
                })

            # 4. 执行批量删除
            FileCollaboration.objects.filter(file=file_obj).delete()

            # 5. 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=user,
                operation='remove_all_collaborators',
                description=f'清空文档协作者：{file_obj.name}（共移除 {collab_count} 人）',
                ip_address=get_request_ip(request),
                extra_data={
                    'removed_count': collab_count,
                    'file_name': file_obj.name,
                }
            )

            logger.info(f'用户 {user.username} 清除了文档 {file_obj.id} 的所有协作者，共 {collab_count} 人')

            return Response({
                'message': '成功清除所有协作关系',
                'removed_count': collab_count,
                'file_id': str(file_obj.id)
            })

        except Exception as e:
            logger.error(f"清除协作关系失败：{e}", exc_info=True)
            return Response(
                {'error': f'操作失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'], permission_classes=[permissions.IsAuthenticated],
            url_path='create-from-file')
    def create_from_file(self, request):
        """
        🔧 从现有云文件创建协作文档会话
        POST /api/cloud/documents/create-from-file/
        {
            "file_id": "uuid-xxx",      # 必填：源文件ID
            "title": "可选新标题"         # 可选：不传则使用原文件名
        }
        """
        try:
            file_id = request.data.get('file_id')
            new_title = request.data.get('title', '').strip()

            if not file_id:
                return Response({'error': '请指定源文件'}, status=status.HTTP_400_BAD_REQUEST)

            # 1. 获取源文件（支持所有者或协作者访问）
            try:
                source_file = CloudFile.objects.select_related('owner').get(id=file_id)
            except CloudFile.DoesNotExist:
                return Response({'error': '文件不存在'}, status=status.HTTP_404_NOT_FOUND)

            # 2. 权限验证
            if not self._can_access_document(source_file, request.user):
                return Response(
                    {'error': '您没有权限访问该文件'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 3. 验证文件类型是否支持协同编辑
            file_ext = source_file.original_name.split('.')[-1].lower() if source_file.original_name else ''
            doc_type = self._get_document_type(source_file.original_name)
            if not doc_type:
                return Response({'error': '不支持的文档格式'}, status=status.HTTP_400_BAD_REQUEST)

            # 4. 确定文档标题
            doc_title = new_title if new_title else (source_file.name or source_file.original_name)

            # 5. 构建文件访问配置
            file_url = self._get_file_url(source_file)
            callback_url = self._get_callback_url(source_file.id)

            user_info = {
                'id': str(request.user.id),
                'name': request.user.real_name or request.user.username,
                'email': request.user.email or '',
            }

            # 6. 构建 OnlyOffice 编辑配置
            config = {
                'document': {
                    'fileType': file_ext,
                    'key': f"{source_file.id}_{source_file.md5 or str(source_file.id)}_{int(timezone.now().timestamp())}",
                    'title': doc_title,
                    'url': file_url,
                    'permissions': {
                        'comment': True, 'copy': True, 'download': True, 'edit': True,
                        'fillForms': True, 'modifyContentControl': True,
                        'modifyFilter': True, 'print': True, 'review': True,
                    },
                },
                'documentType': doc_type,
                'editorConfig': {
                    'callbackUrl': callback_url,
                    'user': user_info,
                    'lang': 'zh-CN',
                    'customization': {
                        'autosave': True, 'chat': True, 'comments': True,
                        'feedback': False, 'forcesave': True,
                        'goback': {
                            'blank': False, 'requestClose': False,
                            'text': '返回网盘', 'url': f'{self.server_url}/cloud/',
                        },
                        'logo': {
                            'image': f'{self.server_url}/media/avatars/cloud-green.svg',
                            'imageEmbedded': True,
                        },
                        'mentionShare': True, 'reviewDisplay': 'original',
                        'spellcheck': True, 'uiTheme': 'theme-light',
                        'forcesaveButton': True, 'compactToolbar': False,
                    },
                    'coEditing': {'mode': 'strict', 'change': True},
                    'recent': self._get_recent_documents(request.user),
                },
                'height': '100%', 'width': '100%', 'type': 'desktop',
            }

            # 7. 添加 JWT Token（如果启用）
            if self.jwt_enabled and self.jwt_secret:
                token = self._generate_jwt_token(config)
                if token:
                    config['token'] = token

            # 8. 记录协作状态
            self._record_collaboration(source_file, request.user, 'editing')

            logger.info(f'✅ Create from file success: {source_file.id}')
            return Response({
                'message': '文档创建成功',
                'file_id': str(source_file.id),
                'file_name': doc_title,
                'config': config  # 前端可直接使用此配置初始化编辑器
            })

        except Exception as e:
            logger.error(f'Create from file failed: {e}', exc_info=True)
            return Response({'error': f'创建失败：{str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _get_empty_document_content(self, doc_type):
        """
        🔧 获取空文档内容（使用真实的最小有效文档）
        """
        # 🔧 使用真实的最小有效文档内容
        # 这里返回的是对应格式的最小有效文件头
        templates = {
            'word': b'PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00',  # DOCX 最小头
            'excel': b'PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00',  # XLSX 最小头
            'ppt': b'PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00',  # PPTX 最小头
        }
        return templates.get(doc_type, b'')

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated],
            url_path='retrieve_collaborators/(?P<user_id>[^/.]+)')
    def retrieve_collaborators(self, request, pk=None, user_id=None):
        """
        获取协作者信息
        GET /api/cloud/documents/{id}/retrieve_collaborators/user_id/
        :param request:
        :param pk:
        :param user_id:
        :return:
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)
            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
                    status=status.HTTP_403_FORBIDDEN
                )

            if not self._is_admin_for_file(file_obj, request.user):
                if file_obj.folder:
                    if not self._is_admin_or_owner(file_obj.folder, request.user):
                        return Response(
                            {'error': '无管理权限'},
                            status=status.HTTP_403_FORBIDDEN
                        )
                else:
                    if not self._is_owner_for_file(file_obj, request.user):
                        return Response(
                            {'error': '无管理权限，非法操作'},
                            status=status.HTTP_403_FORBIDDEN
                        )




            collaborator_id = user_id  # 从 URL 获取
            if not collaborator_id:
                return Response({'error': '请指定协作者'}, status=400)

            try:
                fc = FileCollaboration.objects.get(
                    file=file_obj,
                    user_id=collaborator_id
                )
                user = fc.user
                return Response({
                    'id': user.id,
                    'username': user.username,
                    'real_name': user.real_name or user.username,
                    'avatar': user.get_avatar_url(),
                    'permission': fc.permission,
                    'is_active': fc.is_active,
                    'is_online': user.is_online,
                    'department': user.department.name if user.department else None,
                    'position': user.position,
                    'added_at': fc.created_at.isoformat(),
                    'is_owner': user.id == file_obj.owner_id,
                }, status=200)
            except FileCollaboration.DoesNotExist:
                return Response({'error': '协作者关系不存在'}, status=404)
        except CloudFile.DoesNotExist:
            return Response(
                {'error': '文件不存在'},
                status=status.HTTP_404_NOT_FOUND
            )
        except FileCollaboration.DoesNotExist:
            return Response({'error': '协作者关系不存在'}, status=404)
        except Exception as e:
            logger.error(f'{e}')
            return Response(
                {'error': f'获取文件失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def add_collaborator(self, request, pk=None):
        """
        🔧 添加文档协作者
        POST /api/cloud/documents/{id}/add_collaborator/
        {
            "user_id": 123,
            "permission": "write",  // read/write/admin
            "notify": true  // 是否发送通知
        }
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)


            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
                    status=status.HTTP_403_FORBIDDEN
                )

            if not self._is_admin_for_file(file_obj, request.user):

                if file_obj.folder:
                    if not self._is_admin_or_owner(file_obj.folder, request.user):
                        return Response(
                            {'error': '无管理权限'},
                            status=status.HTTP_403_FORBIDDEN
                        )
                else:
                    if not self._is_owner_for_file(file_obj, request.user):
                        return Response(
                            {'error': '无管理权限，非法操作'},
                            status=status.HTTP_403_FORBIDDEN
                        )

            user_id = request.data.get('user_id')
            permission = request.data.get('permission', 'read')
            notify = request.data.get('notify', True)

            if not user_id:
                return Response({'error': '请指定协作用户'}, status=400)

            if permission not in ['read', 'write', 'admin']:
                return Response({'error': '权限类型无效'}, status=400)

            try:
                collaborator = CustomUser.objects.get(id=user_id)
            except CustomUser.DoesNotExist:
                return Response({'error': '用户不存在'}, status=404)

            # 不能添加自己
            if collaborator.id == request.user.id:
                return Response({'error': '不能添加自己为协作者'}, status=400)

            # 创建或更新协作关系（FileCollaboration）
            collab, created = FileCollaboration.objects.update_or_create(
                file=file_obj,
                user=collaborator,
                defaults={
                    'permission': permission,
                    'is_active': True,
                }
            )

            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='add_collaborator',
                description=f'添加协作者：{collaborator.username}（权限：{permission}）',
                ip_address=get_request_ip(request),
                extra_data={
                    'collaborator_id': str(collaborator.id),
                    'collaborator_username': collaborator.username,
                    'permission': permission,
                    'created': created,
                }
            )

            # 🔧 可选：发送通知
            if notify:
                self._send_collaboration_notification(
                    file_obj, collaborator, request.user, permission
                )

            return Response({
                'message': '协作者添加成功',
                'collaborator': {
                    'id': collaborator.id,
                    'username': collaborator.username,
                    'real_name': collaborator.real_name,
                    'avatar': collaborator.get_avatar_url(),
                    'permission': permission,
                    'is_active': True,
                    'added_at': collab.created_at.isoformat(),
                }
            }, status=status.HTTP_201_CREATED)

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Add collaborator failed: {e}', exc_info=True)
            return Response({'error': f'添加失败：{str(e)}'}, status=500)

    @action(detail=True, methods=['put'], permission_classes=[permissions.IsAuthenticated],
            url_path='update_collaborator/(?P<user_id>[^/.]+)')
    def update_collaborator(self, request, pk=None, user_id=None):
        """
        🔧 修改协作者权限
        PUT /api/cloud/documents/{id}/update_collaborator/{user_id}/
        {
            "permission": "write",
            "is_active": true
        }
        """
        try:
            logger.info(f'Update collaborator pk: {pk} user_id: {user_id}')
            file_obj = CloudFile.objects.get(id=pk)

            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
                    status=status.HTTP_403_FORBIDDEN
                )
            if not self._is_admin_for_file(file_obj, request.user):
                if file_obj.folder:
                    if not self._is_admin_or_owner(file_obj.folder, request.user):
                        return Response(
                            {'error': '无管理权限'},
                            status=status.HTTP_403_FORBIDDEN
                        )
                else:
                    if not self._is_owner_for_file(file_obj, request.user):
                        return Response(
                            {'error': '无管理权限，非法操作'},
                            status=status.HTTP_403_FORBIDDEN
                        )

            collaborator_id = user_id
            if not collaborator_id:
                return Response({'error': '请指定协作者'}, status=400)

            try:
                collab = FileCollaboration.objects.get(
                    file=file_obj,
                    user_id=collaborator_id
                )
                if collab.user == request.user:
                    return Response({'error': '不能修改自己的权限'}, status=400)
            except FileCollaboration.DoesNotExist:
                logger.error(f'Collaborator {collaborator_id} not found')
                return Response({'error': '协作者关系不存在'}, status=404)

            logger.info(f'{request.user.username} 修改文档 {file_obj.name} 协作者 {collab.user.username} 权限')

            permission = request.data.get('permission')
            is_active = request.data.get('is_active')

            if permission and permission not in ['read', 'write', 'admin']:
                return Response({'error': '权限类型无效'}, status=400)

            # 更新协作关系
            if permission:
                collab.permission = permission
            if is_active is not None:
                collab.is_active = is_active
            collab.updated_at = timezone.now()
            collab.save(update_fields=['permission', 'is_active', 'updated_at'])

            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='update_collaborator',
                description=f'修改协作者权限：{collab.user.username}',
                ip_address=get_request_ip(request),
                extra_data={
                    'collaborator_id': str(collab.user.id),
                    'old_permission': collab.permission,
                    'new_permission': permission or collab.permission,
                    'is_active': is_active if is_active is not None else collab.is_active,
                }
            )

            return Response({
                'message': '协作者权限更新成功',
                'collaborator': {
                    'id': collab.user.id,
                    'username': collab.user.username,
                    'permission': collab.permission,
                    'is_active': collab.is_active,
                    'updated_at': collab.updated_at.isoformat(),
                }
            })

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Update collaborator failed: {e}', exc_info=True)
            return Response({'error': f'更新失败：{str(e)}'}, status=500)

    @action(detail=True, methods=['delete'], permission_classes=[permissions.IsAuthenticated],
            url_path='collaborators/(?P<user_id>[^/.]+)')
    def remove_collaborator(self, request, pk=None, user_id=None):
        """
        🔧 删除协作者
        DELETE /api/cloud/documents/{id}/collaborators/{user_id}/
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)

            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
                    status=status.HTTP_403_FORBIDDEN
                )
            if not self._is_admin_for_file(file_obj, request.user):
                if file_obj.folder:
                    if not self._is_admin_or_owner(file_obj.folder, request.user):
                        return Response(
                            {'error': '无管理权限'},
                            status=status.HTTP_403_FORBIDDEN
                        )
                else:
                    if not self._is_owner_for_file(file_obj, request.user):
                        return Response(
                            {'error': '无管理权限，非法操作'},
                            status=status.HTTP_403_FORBIDDEN
                        )

            collaborator_id = user_id  # 从 URL 获取
            if not collaborator_id:
                return Response({'error': '请指定协作者'}, status=400)

            try:
                collab = FileCollaboration.objects.get(
                    file=file_obj,
                    user_id=collaborator_id
                )
                if collab.user == request.user:
                    return Response({'error': '不能移除自己'}, status=400)
            except FileCollaboration.DoesNotExist:
                return Response({'error': '协作者关系不存在'}, status=404)

            collaborator_username = collab.user.username
            collab.delete()

            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='remove_collaborator',
                description=f'移除协作者：{collaborator_username}',
                ip_address=get_request_ip(request),
                extra_data={
                    'collaborator_id': str(collaborator_id),
                    'collaborator_username': collaborator_username,
                }
            )

            return Response({'message': '协作者已移除'})

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Remove collaborator failed: {e}', exc_info=True)
            return Response({'error': f'移除失败：{str(e)}'}, status=500)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def collaborators(self, request, pk=None):
        """
        🔧 获取协作者列表（包含权限和实时状态）
        GET /api/cloud/documents/{id}/collaborators/
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)

            # 验证访问权限
            if not self._can_access_document(file_obj, request.user):
                return Response(
                    {'error': '无权访问该文件'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 1. 获取权限协作者（FileCollaboration）
            file_collabs = FileCollaboration.objects.filter(
                file=file_obj,
                is_active=True
            ).select_related('user').order_by('-created_at')

            # 2. 获取实时协作状态（DocumentCollaboration）
            doc_collabs = DocumentCollaboration.objects.filter(
                file=file_obj,
                status__in=['editing', 'viewing'],
                last_activity__gt=timezone.now() - timedelta(minutes=5)
            ).select_related('user')

            # 3. 合并数据
            online_user_ids = {c.user.id for c in doc_collabs}
            editing_user_ids = {c.user.id for c in doc_collabs if c.status == 'editing'}

            data = []
            for fc in file_collabs:
                user = fc.user
                data.append({
                    'id': user.id,
                    'username': user.username,
                    'real_name': user.real_name or user.username,
                    'avatar': user.get_avatar_url(),
                    'permission': fc.permission,
                    'is_active': fc.is_active,
                    'is_online': user.id in online_user_ids,
                    'is_editing': user.id in editing_user_ids,
                    'status': 'editing' if user.id in editing_user_ids else (
                        'viewing' if user.id in online_user_ids else 'offline'),
                    'added_at': fc.created_at.isoformat(),
                    'is_owner': user.id == file_obj.owner_id,
                })

            # 添加文件所有者（如果不在列表中）
            if not any(d['is_owner'] for d in data):
                owner = file_obj.owner
                data.insert(0, {
                    'id': owner.id,
                    'username': owner.username,
                    'real_name': owner.real_name or owner.username,
                    'avatar': owner.get_avatar_url(),
                    'permission': 'admin',
                    'is_active': True,
                    'is_online': owner.id in online_user_ids,
                    'is_editing': owner.id in editing_user_ids,
                    'status': 'editing' if owner.id in editing_user_ids else (
                        'viewing' if owner.id in online_user_ids else 'offline'),
                    'added_at': file_obj.created_at.isoformat(),
                    'is_owner': True,
                })

            return Response({
                'collaborators': data,
                'total': len(data),
                'editing_count': sum(1 for d in data if d['is_editing']),
                'online_count': sum(1 for d in data if d['is_online']),
            })

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Get collaborators failed: {e}', exc_info=True)
            return Response({'error': f'获取失败：{str(e)}'}, status=500)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated],
            url_path='collaboration/status')
    def update_collaboration_status(self, request, pk=None):
        """
        🔧 更新协同编辑状态（心跳接口）
        POST /api/cloud/documents/{id}/collaboration/status/
        {
            "status": "editing",  // viewing/editing/closed
            "cursor_position": {"line": 10, "column": 5},  // 可选
            "selection": {"start": 100, "end": 200},  // 可选
            "is_typing": true  // 可选
        }
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)

            # 验证访问权限
            if not self._can_access_document(file_obj, request.user):
                return Response({'error': '无权访问该文件'}, status=403)

            status = request.data.get('status', 'viewing')
            cursor_position = request.data.get('cursor_position')
            selection = request.data.get('selection')
            is_typing = request.data.get('is_typing')

            # 验证状态类型
            valid_statuses = ['editing', 'viewing', 'closed']
            if status not in valid_statuses:
                status = 'viewing'

            # 更新或创建协作记录
            collab, created = DocumentCollaboration.objects.update_or_create(
                file=file_obj,
                user=request.user,
                defaults={
                    'status': status,
                    'last_activity': timezone.now(),
                }
            )

            if status == 'closed':
                collab.left_at = timezone.now()
                collab.save(update_fields=['left_at'])

            # 记录操作日志
            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='update_collaboration_status',
                description=f'更新协作状态：{status}',
                ip_address=get_request_ip(request),
                extra_data={
                    'status': status,
                    'cursor_position': cursor_position,
                    'selection': selection,
                    'is_typing': is_typing,
                }
            )

            # 🔧 关键修复：广播状态变化给其他协作者（与前端对齐）
            if settings.CHANNELS_ENABLED:
                from .websocket_utils import CollabMessageBroadcaster

                # 1. 广播协同状态更新 (collab_status_update)
                CollabMessageBroadcaster.broadcast_collab_message(
                    file_id=file_obj.id,
                    message_type='collab_status_update',  # 🔧 前端期望的消息类型
                    data={
                        'userId': str(request.user.id),  # 🔧 前端期望的字段名
                        'status': status,
                        'last_activity': collab.last_activity.isoformat(),
                    },
                    exclude_user_id=str(request.user.id),  # 不广播给自己
                    sender_id=str(request.user.id),
                    sender_username=request.user.username,
                    sender_real_name=request.user.real_name or request.user.username,
                    sender_avatar=request.user.get_avatar_url() if hasattr(request.user, 'get_avatar_url') else getattr(
                        request.user, 'avatar_url', '/static/images/default-avatar.png'),
                )

                # 2. 🔧 如果有输入状态，广播 user_typing
                if is_typing is not None:
                    CollabMessageBroadcaster.broadcast_collab_message(
                        file_id=file_obj.id,
                        message_type='user_typing',
                        data={
                            'userId': str(request.user.id),
                            'userName': request.user.real_name or request.user.username,
                            'isTyping': is_typing,  # 🔧 驼峰命名
                            'cursorPosition': cursor_position,
                        },
                        exclude_user_id=str(request.user.id),
                        sender_id=str(request.user.id),
                        sender_username=request.user.username,
                        sender_real_name=request.user.real_name or request.user.username,
                        sender_avatar=request.user.get_avatar_url() if hasattr(request.user,
                                                                               'get_avatar_url') else getattr(
                            request.user, 'avatar_url', '/static/images/default-avatar.png'),
                    )

                # 3. 🔧 如果有光标位置，广播 cursor_update
                if cursor_position:
                    CollabMessageBroadcaster.broadcast_collab_message(
                        file_id=file_obj.id,
                        message_type='cursor_update',
                        data={
                            'userId': str(request.user.id),
                            'userName': request.user.real_name or request.user.username,
                            'position': cursor_position,  # 🔧 前端期望的字段名
                            'color': self._get_user_color(str(request.user.id)),
                        },
                        exclude_user_id=str(request.user.id),
                        sender_id=str(request.user.id),
                        sender_username=request.user.username,
                        sender_real_name=request.user.real_name or request.user.username,
                        sender_avatar=request.user.get_avatar_url() if hasattr(request.user,
                                                                               'get_avatar_url') else getattr(
                            request.user, 'avatar_url', '/static/images/default-avatar.png'),
                    )

                # 4. 🔧 如果有选区，广播 selection_update
                if selection:
                    CollabMessageBroadcaster.broadcast_collab_message(
                        file_id=file_obj.id,
                        message_type='selection_update',
                        data={
                            'userId': str(request.user.id),
                            'userName': request.user.real_name or request.user.username,
                            'selection': selection,
                            'color': '#409EFF',
                        },
                        exclude_user_id=str(request.user.id),
                        sender_id=str(request.user.id),
                        sender_username=request.user.username,
                        sender_real_name=request.user.real_name or request.user.username,
                        sender_avatar=request.user.get_avatar_url() if hasattr(request.user,
                                                                               'get_avatar_url') else getattr(
                            request.user, 'avatar_url', '/static/images/default-avatar.png'),
                    )

            return Response({
                'message': '状态已更新',
                'status': status,
                'collaborators_count': self._get_active_collaborators_count(file_obj)
            })

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Update collaboration status failed: {e}', exc_info=True)
            return Response({'error': f'更新失败：{str(e)}'}, status=500)

    def _get_user_color(self, user_id):
        """生成用户专属颜色（与前端 getUserColor 逻辑一致）"""
        hash_val = 0
        for char in user_id:
            hash_val = ord(char) + ((hash_val << 5) - hash_val)
        hue = abs(hash_val) % 360
        return f'hsl({hue}, 75%, 55%)'

    def _get_active_collaborators_count(self, file_obj):
        """获取活跃协作者数量"""
        return DocumentCollaboration.objects.filter(
            file=file_obj,
            status__in=['viewing', 'editing'],
            last_activity__gt=timezone.now() - timedelta(minutes=5)
        ).count()

    def _send_collaboration_notification(self, file_obj, collaborator, inviter, permission):
        """发送协作邀请通知"""
        try:
            # 这里可以集成通知系统
            logger.info(f'发送协作通知：{collaborator.username} 被邀请编辑 {file_obj.name}')
        except Exception as e:
            logger.warning(f'发送协作通知失败：{e}')

    # ==================== OnlyOffice 回调接口 ====================

    @action(detail=True, methods=['post'], authentication_classes=[])
    def callback(self, request, pk=None):
        """
        🔧 OnlyOffice 回调接口
        POST /api/cloud/documents/{id}/callback/
        """
        try:
            logger.info(f'Callback received: file_id={pk}')

            # 1. 验证 JWT Token
            token = request.data.get('token')
            if self.jwt_enabled and self.jwt_secret and token:
                try:
                    token = token.strip()
                    if token.count('.') == 2:
                        jwt.decode(token, self.jwt_secret, algorithms=['HS256'])
                        logger.info('✅ JWT token verified')
                    else:
                        logger.warning('❌ Invalid JWT format')
                        return Response({'error': 1}, status=403)
                except jwt.InvalidTokenError as e:
                    logger.warning(f'❌ Invalid JWT token: {e}')
                    return Response({'error': 1}, status=403)

            # 2. 获取回调数据
            body = request.data
            status_code = body.get('status')
            url = body.get('url')
            users = body.get('users', [])

            logger.info(f'Callback status: {status_code}, url: {url}, users: {users}')

            # 3. 获取文件
            try:
                file_obj = CloudFile.objects.select_related('owner').get(id=pk)
            except CloudFile.DoesNotExist:
                logger.error(f'Callback: Document {pk} not found')
                return Response({'error': 1}, status=404)

            # 4. 处理不同状态码
            if status_code in [2, 4]:  # 文档已保存/强制保存
                if url:
                    logger.info(f'💾 Saving document from: {url}')
                    try:
                        max_retries = 3
                        for attempt in range(max_retries):
                            try:
                                response = requests.get(url, timeout=60, verify=False)
                                response.raise_for_status()
                                break
                            except requests.RequestException as e:
                                if attempt == max_retries - 1:
                                    raise
                                logger.warning(f'⚠️ Download attempt {attempt + 1} failed: {e}')
                                time.sleep(2 ** attempt)

                        content = response.content
                        content_hash = hashlib.md5(content).hexdigest()[:8]
                        logger.info(f'✅ Downloaded {len(content)} bytes, hash={content_hash}')

                        with transaction.atomic():
                            content_file = ContentFile(content)
                            version = self._save_document_version(
                                file_obj, content, users[0] if users else None
                            )
                            logger.info(f'✅ Version saved: v{version.version_number}')

                            file_obj.file.save(
                                file_obj.original_name,
                                content_file,
                                save=True
                            )
                            file_obj.size = len(content)
                            file_obj.current_version = version
                            file_obj.save(update_fields=['size', 'updated_at', 'current_version'])

                            FileOperationLog.objects.create(
                                file=file_obj,
                                user=file_obj.owner,
                                operation='edit',
                                description=f'在线编辑保存：{file_obj.name} (v{version.version_number})',
                                ip_address=get_request_ip(request),
                                extra_data={
                                    'version_number': version.version_number,
                                    'file_size': len(content),
                                    'content_hash': content_hash,
                                    'status_code': status_code,
                                }
                            )

                        logger.info(f'✅ Document {file_obj.id} saved successfully')

                    except requests.RequestException as e:
                        logger.error(f'Failed to download from OnlyOffice: {e}')
                        return Response({'error': 1}, status=500)
                    except Exception as e:
                        logger.error(f'Failed to save document: {e}', exc_info=True)
                        return Response({'error': 1}, status=500)

            elif status_code == 3:  # 文档关闭
                # 🔧 状态 3：文档关闭 - 清理编辑锁

                logger.info(f'📝 文档 {pk} 已关闭，清理编辑锁')

                # 清理编辑锁
                DocumentEditLock.objects.filter(
                    file=file_obj,
                    # user__id__in=users,
                    is_active=True
                ).update(is_active=False)

                # 更新协作者状态
                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'closed')
                    except CustomUser.DoesNotExist:
                        logger.warning(f'User {user_id} not found')

                # 清除编辑用户
                file_obj.editing_user = None
                file_obj.save(update_fields=['editing_user', 'updated_at'])

                active_locks = DocumentEditLock.objects.filter(
                    file=file_obj,
                    is_active=True,
                    expires_at__gt=timezone.now()
                )
                if not active_locks.exists():
                    file_obj.editing_user = None
                    file_obj.save(update_fields=['editing_user'])

            elif status_code == 5:  # 协同编辑者已连接
                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'editing')
                    except CustomUser.DoesNotExist:
                        pass

            elif status_code == 6:  # 协同编辑者已断开
                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'viewing')
                    except CustomUser.DoesNotExist:
                        pass

            return Response({'error': 0})

        except Exception as e:
            logger.error(f'Document callback error: {e}', exc_info=True)
            return Response({'error': 1}, status=500)

    def _save_document_version(self, file_obj, content, user_id):
        """保存文档版本"""
        with transaction.atomic():
            last_version = DocumentVersion.objects.filter(
                file=file_obj
            ).order_by('-version_number').first()

            version_number = (last_version.version_number + 1) if last_version else 1
            logger.info(f'📝 Creating version v{version_number}')

            # 清理旧版本
            keep_count = self.current_config.get('version_keep_count',  settings.ONLYOFFICE.get('VERSION_KEEP_COUNT', 10))
            old_versions = DocumentVersion.objects.filter(
                file=file_obj
            ).order_by('-version_number')[keep_count:]

            for old_ver in old_versions:
                try:
                    if os.path.exists(old_ver.file_path):
                        os.remove(old_ver.file_path)
                    old_ver.delete()
                except Exception as e:
                    logger.warning(f'Failed to delete old version: {e}')

            # 保存版本文件
            version_dir = os.path.join(
                settings.MEDIA_ROOT,
                'document_versions',
                str(file_obj.id)
            )
            os.makedirs(version_dir, exist_ok=True)

            version_path = os.path.join(
                version_dir,
                f'v{version_number}_{file_obj.name or file_obj.original_name}'
            )

            with open(version_path, 'wb') as f:
                f.write(content)

            file_size = os.path.getsize(version_path)
            logger.info(f'✅ Version file saved: {version_path} ({file_size} bytes)')

            # 获取创建者
            user = None
            if user_id:
                try:
                    user = CustomUser.objects.get(id=user_id)
                except CustomUser.DoesNotExist:
                    logger.warning(f'User {user_id} not found')

            # 创建版本记录
            version = DocumentVersion.objects.create(
                file=file_obj,
                version_number=version_number,
                file_path=version_path,
                file_size=file_size,
                created_by=user,
                content_hash=hashlib.md5(content).hexdigest(),
                comment=f'自动保存 v{version_number}',
                is_current=True
            )

            # 更新之前版本为非当前
            DocumentVersion.objects.filter(
                file=file_obj
            ).exclude(id=version.id).update(is_current=False)

            logger.info(f'✅ Version v{version_number} saved successfully')
            return version

    # ==================== 版本管理接口 ====================

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def versions(self, request, pk=None):
        """获取文档版本列表"""
        try:
            file_obj = CloudFile.objects.get(id=pk)

            if not self._can_access_document(file_obj, request.user):
                return Response({'error': '无权访问'}, status=403)

            versions = DocumentVersion.objects.filter(
                file=file_obj
            ).select_related('created_by').order_by('-version_number')

            data = [
                {
                    'id': str(v.id),
                    'version_number': v.version_number,
                    'file_size': v.file_size,
                    'file_size_formatted': self._format_size(v.file_size),
                    'created_by': v.created_by.username if v.created_by else '系统',
                    'created_at': v.created_at.isoformat(),
                    'comment': v.comment,
                    'is_current': v.is_current,
                    'download_url': f'/api/cloud/documents/versions/{v.id}/download/',
                }
                for v in versions
            ]

            return Response({'versions': data})

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Get versions failed: {e}', exc_info=True)
            return Response({'error': f'获取失败：{str(e)}'}, status=500)

    @action(detail=False, methods=['get'], url_path='versions/(?P<version_id>[^/.]+)/download')
    def version_download(self, request, version_id=None):
        """下载指定版本的文件"""
        try:
            try:
                config = CloudSystemConfig.objects.filter(key='system.download_enabled').first()
                if config:
                    download_enabled = config.get_value('system.download_enabled')
                    if not download_enabled:
                        return Response({'error': '下载功能已禁用，请联系管理员！'}, status=status.HTTP_403_FORBIDDEN)
            except Exception as e:
                logger.error(f"Error: {e}")

            # 🔧 验证版本归属（通过 file__owner 确保只能下载自己的文件版本）
            version = DocumentVersion.objects.select_related('file__owner').get(
                id=version_id,
                file__owner=request.user
            )

            if not os.path.exists(version.file_path):
                return Response({'error': '版本文件不存在'}, status=404)

            # 🔧 构建响应
            original_name = version.file.name or version.file.original_name or 'download'
            safe_filename = self._sanitize_filename(f'{original_name}_v{version.version_number}')

            response = FileResponse(
                open(version.file_path, 'rb'),
                as_attachment=True,
                filename=safe_filename
            )
            response['Content-Length'] = version.file_size
            response['X-Content-Type-Options'] = 'nosniff'

            # 🔧 记录下载日志
            FileOperationLog.objects.create(
                file=version.file,
                user=request.user,
                operation='version_download',
                description=f'下载历史版本：{original_name} v{version.version_number}',
                ip_address=get_request_ip(request)
            )

            return response

        except DocumentVersion.DoesNotExist:
            return Response({'error': '版本不存在'}, status=404)
        except Exception as e:
            logger.error(f'Version download error: {e}', exc_info=True)
            return Response({'error': f'下载失败：{str(e)}'}, status=500)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def restore_version(self, request, pk=None):
        """恢复文档版本"""
        try:
            file_obj = CloudFile.objects.get(id=pk)

            if not self._can_edit_document(file_obj, request.user):
                return Response({'error': '无编辑权限'}, status=403)

            version_id = request.data.get('version_id')
            create_backup = request.data.get('create_backup', False)

            version = DocumentVersion.objects.get(id=version_id, file=file_obj)

            if not os.path.exists(version.file_path):
                return Response({'error': '版本文件不存在'}, status=404)

            with open(version.file_path, 'rb') as f:
                content = f.read()

            if not content:
                return Response({'error': '版本文件为空'}, status=500)

            content_hash = hashlib.md5(content).hexdigest()[:8]
            logger.info(f'📖 Read version file: {version.file_path} ({len(content)} bytes)')

            with transaction.atomic():
                content_file = ContentFile(content)

                # 创建备份版本
                if create_backup:
                    last_version = DocumentVersion.objects.filter(
                        file=file_obj
                    ).order_by('-version_number').first()
                    new_version_number = (last_version.version_number + 1) if last_version else 1

                    current_version_path = os.path.join(
                        settings.MEDIA_ROOT,
                        'document_versions',
                        str(file_obj.id),
                        f'v{new_version_number}_{file_obj.name}'
                    )
                    os.makedirs(os.path.dirname(current_version_path), exist_ok=True)

                    if file_obj.file and os.path.exists(file_obj.file.path):
                        with open(file_obj.file.path, 'rb') as f:
                            current_content = f.read()
                        with open(current_version_path, 'wb') as f:
                            f.write(current_content)
                        DocumentVersion.objects.create(
                            file=file_obj,
                            version_number=new_version_number,
                            file_path=current_version_path,
                            file_size=len(current_content),
                            created_by=request.user,
                            content_hash=hashlib.md5(current_content).hexdigest(),
                            comment=f'恢复前备份（恢复到版本 {version.version_number}）',
                            is_current=False
                        )
                        logger.info(f'✅ Backup version created: v{new_version_number}')

                # 恢复目标版本
                file_obj.file.save(
                    file_obj.original_name,
                    content_file,
                    save=True
                )
                file_obj.current_version = version
                file_obj.size = len(content)
                file_obj.save(update_fields=['current_version', 'size', 'updated_at'])

                DocumentVersion.objects.filter(
                    file=file_obj
                ).exclude(id=version.id).update(is_current=False)
                version.is_current = True
                version.save(update_fields=['is_current'])

            FileOperationLog.objects.create(
                file=file_obj,
                user=request.user,
                operation='restore_version',
                description=f'恢复文档版本：{file_obj.name} v{version.version_number}',
                ip_address=get_request_ip(request),
                extra_data={
                    'version_id': str(version.id),
                    'version_number': version.version_number,
                    'content_hash': content_hash,
                }
            )

            logger.info(f'✅ Version restored successfully: v{version.version_number}')

            return Response({
                'message': '版本恢复成功',
                'version': version.version_number,
                'content_hash': content_hash,
            })

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except DocumentVersion.DoesNotExist:
            return Response({'error': '版本不存在'}, status=404)
        except Exception as e:
            logger.error(f'Restore version error: {e}', exc_info=True)
            return Response({'error': f'恢复失败：{str(e)}'}, status=500)

    def _format_size(self, size_bytes):
        """格式化文件大小"""
        if size_bytes == 0:
            return '0 B'
        units = ['B', 'KB', 'MB', 'GB', 'TB']
        unit_index = 0
        size = float(size_bytes)
        while size >= 1024 and unit_index < len(units) - 1:
            size /= 1024
            unit_index += 1
        return f'{size:.2f} {units[unit_index]}'

    def _sanitize_filename(self, filename):
        """
        🔧 安全处理文件名，防止路径遍历攻击和非法字符
        """

        if not filename:
            return 'unnamed'

        # 1. 移除路径分隔符，防止路径遍历
        filename = os.path.basename(str(filename))

        # 2. 移除或替换非法字符（Windows/Linux 兼容）
        # 保留中文、英文、数字、下划线、点、横杠、空格
        filename = re.sub(r'[<>:"|?*\\]', '_', filename)

        # 3. 移除首尾空格和点
        filename = filename.strip('. ')

        # 4. 限制长度（避免超长文件名）
        if len(filename) > 200:
            name, ext = os.path.splitext(filename)
            filename = name[:190] + ext

        # 5. 确保不为空
        if not filename or filename == '.':
            filename = 'unnamed_file'

        return filename

    # 🔧 辅助方法：获取文档类型文本
    def _get_doc_type_text(self, doc_type):
        doc_type_map = {
            'word': 'Word',
            'excel': 'Excel',
            'ppt': 'PowerPoint',
            'pdf': 'PDF'
        }
        return doc_type_map.get(doc_type, '文档')

    # 🔧 辅助方法：获取文档图标类
    def _get_doc_icon_class(self, doc_type):
        icon_map = {
            'word': 'fa-file-word',
            'excel': 'fa-file-excel',
            'ppt': 'fa-file-powerpoint',
            'pdf': 'fa-file-pdf'
        }
        return icon_map.get(doc_type, 'fa-file')


# cloud/views.py - 系统配置视图集（适配 CloudSystemConfig 模型）

class IsCloudAdmin(permissions.BasePermission):
    """🔧 网盘管理员权限"""

    def has_permission(self, request, view):
        return request.user.is_authenticated and (
                request.user.is_superuser or
                request.user.user_type in ['admin', 'super_admin']
        )


class CloudSystemSettingsViewSet(viewsets.GenericViewSet):
    """
    🔧 企业网盘系统配置视图集
    支持 OnlyOffice、文件上传、存储、协同编辑等配置管理
    适配 CloudSystemConfig 模型（含专用字段）
    """

    permission_classes = [permissions.IsAuthenticated, IsCloudAdmin]
    pagination_class = CloudPagination  # 🔧 添加分页类

    CACHE_PREFIX = 'company_chat:config:'

    # 🔧 预定义配置项（与模型 CATEGORY_CHOICES 对齐）
    PREDEFINED_CONFIGS = {
        # ==================== 存储设置 ====================
        'storage.quota_gb': {
            'name': '用户存储配额',
            'value_type': 'integer',
            'default': '10',
            'description': '每个用户的默认存储配额（GB）',
            'category': 'storage',
            'is_public': True,
            'validation': {'min': 1, 'max': 1024}
        },
        'storage.version_keep_count': {
            'name': '版本保留数量',
            'value_type': 'integer',
            'default': '10',
            'description': '文档历史版本保留的最大数量',
            'category': 'storage',
            'is_editable': True,
            'validation': {'min': 1, 'max': 100}
        },

        # ==================== 安全设置 ====================
        'security.token_expire_hours': {
            'name': '令牌过期时间',
            'value_type': 'integer',
            'default': '24',
            'description': '访问令牌过期时间（小时）',
            'category': 'security',
            'is_editable': True,
            'validation': {'min': 1, 'max': 168}
        },
        'security.download_token_expire_minutes': {
            'name': '下载令牌过期时间',
            'value_type': 'integer',
            'default': '5',
            'description': '文件下载令牌过期时间（分钟）',
            'category': 'security',
            'is_editable': True,
            'validation': {'min': 1, 'max': 60}
        },
        'security.share_password_min_length': {
            'name': '分享密码最小长度',
            'value_type': 'integer',
            'default': '4',
            'description': '分享链接密码最小长度',
            'category': 'security',
            'is_editable': True,
            'validation': {'min': 4, 'max': 20}
        },

        # ==================== 上传设置 ====================
        'upload.max_file_size_mb': {
            'name': '文件上传总上限',
            'value_type': 'integer',
            'default': '50',
            'description': '单个文件允许的最大上传大小（MB）',
            'category': 'upload',
            'is_public': True,
            'validation': {'min': 1, 'max': 1024}
        },
        'upload.image_max_size_mb': {
            'name': '图片大小上限',
            'value_type': 'integer',
            'default': '20',
            'description': '图片文件允许的最大大小（MB）',
            'category': 'upload',
            'is_public': True,
            'validation': {'min': 1, 'max': 100}
        },
        'upload.video_max_size_mb': {
            'name': '视频大小上限',
            'value_type': 'integer',
            'default': '100',
            'description': '视频文件允许的最大大小（MB）',
            'category': 'upload',
            'is_public': True,
            'validation': {'min': 10, 'max': 2048}
        },
        'upload.audio_max_size_mb': {
            'name': '音频大小上限',
            'value_type': 'integer',
            'default': '30',
            'description': '音频文件允许的最大大小（MB）',
            'category': 'upload',
            'is_public': True,
            'validation': {'min': 1, 'max': 1024}
        },
        'upload.allowed_types': {
            'name': '允许的文件类型',
            'value_type': 'json',
            'default': '["image", "video", "audio", "file"]',
            'description': '允许上传的文件类型列表',
            'category': 'upload',
            'is_public': True,
            'validation': {'is_array': True}
        },
        'upload.chunk_size_mb': {
            'name': '分片上传大小',
            'value_type': 'integer',
            'default': '5',
            'description': '分片上传时每片的大小（MB）',
            'category': 'upload',
            'is_editable': True,
            'validation': {'min': 1, 'max': 50}
        },
        'upload.concurrent_chunks': {
            'name': '并发分片数',
            'value_type': 'integer',
            'default': '3',
            'description': '分片上传时并发上传的分片数量',
            'category': 'upload',
            'is_editable': True,
            'validation': {'min': 1, 'max': 10}
        },

        # ==================== 分享设置 ====================
        'share.default_expire_days': {
            'name': '分享默认有效期',
            'value_type': 'integer',
            'default': '7',
            'description': '创建分享链接时的默认有效期（天）',
            'category': 'share',
            'is_editable': True,
            'is_public': True,
            'validation': {'min': 1, 'max': 365}
        },
        'share.allow_public': {
            'name': '允许公开分享',
            'value_type': 'boolean',
            'default': 'true',
            'description': '是否允许创建无需密码的公开分享链接',
            'category': 'share',
            'is_public': True,
            'is_editable': True
        },
        'share.max_downloads': {
            'name': '分享最大下载次数',
            'value_type': 'integer',
            'default': '100',
            'description': '单个分享链接允许的最大下载次数（0 表示无限制）',
            'category': 'share',
            'is_editable': True,
            'is_public': True,
            'validation': {'min': 0, 'max': 10000}
        },

        # ==================== 协同设置 ====================
        'collab.max_collaborators': {
            'name': '最大协作者数',
            'value_type': 'integer',
            'default': '50',
            'description': '单个文档允许的最大协作者数量',
            'category': 'collaboration',
            'is_editable': True,
            'validation': {'min': 1, 'max': 500}
        },
        'collab.heartbeat_interval': {
            'name': '心跳间隔',
            'value_type': 'integer',
            'default': '10',
            'description': '协同编辑心跳间隔（秒）',
            'category': 'collaboration',
            'is_editable': True,
            'validation': {'min': 5, 'max': 60}
        },
        'collab.cursor_expire_time': {
            'name': '光标过期时间',
            'value_type': 'integer',
            'default': '30',
            'description': '远程光标显示的过期时间（秒）',
            'category': 'collaboration',
            'is_editable': True,
            'validation': {'min': 10, 'max': 120}
        },
        'collab.auto_save_interval': {
            'name': '自动保存间隔',
            'value_type': 'integer',
            'default': '30',
            'description': '文档自动保存间隔（秒）',
            'category': 'collaboration',
            'is_editable': True,
            'validation': {'min': 10, 'max': 300}
        },

        # ==================== 系统设置 ====================
        'system.maintenance_mode': {
            'name': '维护模式',
            'value_type': 'boolean',
            'default': 'false',
            'description': '开启后用户仅可查看，不可上传/编辑/删除',
            'category': 'system',
            'is_editable': True
        },
        'system.user_registration_enabled': {
            'name': '允许用户注册',
            'value_type': 'boolean',
            'default': 'false',
            'description': '是否开放新用户注册功能',
            'category': 'system',
            'is_editable': True
        },
        'system.download_enabled': {
            'name': '允许文件下载',
            'value_type': 'boolean',
            'default': 'false',
            'description': '是否允许文件下载',
            'category': 'system',
            'is_public': True,
            'is_editable': True
        },
        'system.default_language': {
            'name': '默认界面语言',
            'value_type': 'string',
            'default': 'zh-CN',
            'description': '新用户默认界面语言',
            'category': 'system',
            'is_editable': True,
            'validation': {'pattern': r'^[a-z]{2}-[A-Z]{2}$'}
        },

        # ==================== 通知设置 ====================
        'notification.email_enabled': {
            'name': '邮件通知',
            'value_type': 'boolean',
            'default': 'true',
            'description': '是否启用邮件通知',
            'category': 'notification',
            'is_editable': True
        },
        'notification.collab_invite': {
            'name': '协作邀请通知',
            'value_type': 'boolean',
            'default': 'true',
            'description': '协作者邀请时是否发送通知',
            'category': 'notification',
            'is_editable': True
        },
        'notification.upload_complete': {
            'name': '上传完成通知',
            'value_type': 'boolean',
            'default': 'false',
            'description': '大文件上传完成后是否发送通知',
            'category': 'notification',
            'is_editable': True
        },

        # ==================== 审计日志 ====================
        'audit.log_retention_days': {
            'name': '日志保留天数',
            'value_type': 'integer',
            'default': '90',
            'description': '操作日志保留的天数',
            'category': 'audit',
            'is_editable': True,
            'validation': {'min': 7, 'max': 3650}
        },
        'audit.log_sensitive_operations': {
            'name': '记录敏感操作',
            'value_type': 'boolean',
            'default': 'true',
            'description': '是否记录删除、导出等敏感操作详情',
            'category': 'audit',
            'is_editable': True
        },
    }

    # 🔧 配置分类定义（与模型 CATEGORY_CHOICES 对齐）
    CONFIG_CATEGORIES = [
        {'key': 'system', 'name': '系统设置', 'icon': 'fas fa-cog', 'order': 6},
        {'key': 'collaboration', 'name': '协同设置', 'icon': 'fas fa-users', 'order': 5},
        {'key': 'storage', 'name': '存储设置', 'icon': 'fas fa-hdd', 'order': 1},
        {'key': 'security', 'name': '安全设置', 'icon': 'fas fa-shield-alt', 'order': 2},
        {'key': 'upload', 'name': '上传设置', 'icon': 'fas fa-cloud-upload-alt', 'order': 3},
        {'key': 'share', 'name': '分享设置', 'icon': 'fas fa-share-alt', 'order': 4},
        {'key': 'notification', 'name': '通知设置', 'icon': 'fas fa-bell', 'order': 7},
        {'key': 'audit', 'name': '审计日志', 'icon': 'fas fa-clipboard-list', 'order': 8},
    ]

    @action(detail=False, methods=['get'])
    def categories(self, request):
        """📋 获取配置分类列表（含统计）"""
        order = request.query_params.get('order', '')
        categories = []
        for cat in self.CONFIG_CATEGORIES:
            count = CloudSystemConfig.objects.filter(category=cat['key']).count()
            categories.append({
                **cat,
                'count': count
            })
        # 按 order 排序
        if order == 'desc':
            categories.sort(key=lambda x: x['order']).reverse()
        elif order == 'asc':
            categories.sort(key=lambda x: x['order'])

        return Response({'categories': categories})

    @action(detail=False, methods=['get'])
    def list_configs(self, request):
        """📋 获取所有系统配置（支持分类/搜索过滤）"""
        category = request.query_params.get('category', '')
        search = request.query_params.get('search', '').strip()
        is_public = request.query_params.get('is_public', None)

        queryset = CloudSystemConfig.objects.all()

        # 分类过滤
        if category:
            queryset = queryset.filter(category=category)

        # 搜索过滤
        if search:
            queryset = queryset.filter(
                models.Q(key__icontains=search) |
                models.Q(name__icontains=search) |
                models.Q(description__icontains=search)
            )

        # 公开配置过滤
        if is_public is not None:
            queryset = queryset.filter(is_public=is_public.lower() == 'true')

        # 序列化
        serializer = CloudSystemConfigSerializer(
            queryset.order_by('category', 'key'),
            many=True,
            context={'request': request}
        )

        return Response({
            'configs': serializer.data,
            'total': queryset.count(),
            'categories': self.CONFIG_CATEGORIES
        })

    @action(detail=False, methods=['get'])
    def get_config(self, request):
        """🔍 获取单个配置项详情"""
        key = request.query_params.get('key')
        if not key:
            return Response({'error': '配置键不能为空'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            config = CloudSystemConfig.objects.get(key=key)
            serializer = CloudSystemConfigSerializer(config, context={'request': request})
            return Response(serializer.data)
        except CloudSystemConfig.DoesNotExist:
            # 返回预定义配置（未创建过）
            if key in self.PREDEFINED_CONFIGS:
                predefined = self.PREDEFINED_CONFIGS[key]
                return Response({
                    'key': key,
                    'name': predefined['name'],
                    'value': predefined.get('default'),
                    'typed_value': predefined.get('default'),
                    'value_type': predefined['value_type'],
                    'category': predefined['category'],
                    'description': predefined.get('description', ''),
                    'default_value': predefined.get('default'),
                    'is_public': predefined.get('is_public', False),
                    'is_editable': predefined.get('is_editable', True),
                    'is_default': True,
                    'category_info': self._get_category_info(predefined['category'])
                })
            return Response({'error': '配置项不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=False, methods=['get'])
    def public_configs(self, request):
        """🌐 获取公开配置（前端初始化使用）"""
        configs = CloudSystemConfig.objects.filter(is_public=True)
        result = {}
        for config in configs:
            result[config.key] = config.get_typed_value()
        return Response({'configs': result})

    @action(detail=False, methods=['post'])
    def update_config(self, request):
        """✏️ 更新单个配置项"""
        key = request.data.get('key')
        value = request.data.get('value')

        if not key or value is None:
            return Response({'error': '配置键和值不能为空'}, status=status.HTTP_400_BAD_REQUEST)

        # 验证配置项是否存在于预定义列表中
        if key not in self.PREDEFINED_CONFIGS:
            return Response({'error': f'无效的配置项：{key}'}, status=status.HTTP_400_BAD_REQUEST)

        predefined = self.PREDEFINED_CONFIGS[key]

        # 检查是否可编辑
        if not predefined.get('is_editable', True) and not request.user.is_superuser:
            return Response({'error': '该配置项不可编辑'}, status=status.HTTP_403_FORBIDDEN)

        value_type = predefined['value_type']

        # 🔧 类型验证和转换
        try:
            if value_type == 'integer':
                value = int(value)
                self._validate_integer(value, predefined.get('validation'))
            elif value_type == 'float':
                value = float(value)
            elif value_type == 'boolean':
                value = str(value).lower() in ('true', '1', 'yes')
            elif value_type == 'json':
                if isinstance(value, str):
                    value = json.loads(value)
                self._validate_json(value, predefined.get('validation'))
                value = json.dumps(value, ensure_ascii=False)
            elif value_type == 'password':
                if len(str(value)) < predefined.get('validation', {}).get('min_length', 0):
                    raise ValueError(f'密码长度不能小于{predefined.get("validation", {}).get("min_length")}字符')
            elif value_type == 'string':
                value = str(value).strip()
                self._validate_string(value, predefined.get('validation'))
        except (ValueError, json.JSONDecodeError) as e:
            return Response({'error': f'值验证失败：{str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

        # 🔧 业务规则验证
        try:
            self._validate_business_rules(key, value)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # 🔧 更新配置（事务）
        with transaction.atomic():
            config, created = CloudSystemConfig.objects.update_or_create(
                key=key,
                defaults={
                    'name': predefined['name'],
                    'value': str(value) if value_type != 'json' else value,
                    'value_type': value_type,
                    'description': predefined.get('description', ''),
                    'category': predefined['category'],
                    'default_value': predefined.get('default', ''),
                    'is_public': predefined.get('is_public', False),
                    'is_editable': predefined.get('is_editable', True),
                    'updated_by': request.user
                }
            )

            # 🔧 清除缓存
            cache.delete(f'cloud_config:{key}')
            cache.delete('cloud_config:all')

            # 🔧 特殊配置处理（OnlyOffice 配置变更需要重载）
            if key.startswith('onlyoffice.'):
                self._reload_onlyoffice_config()

        logger.info(f'配置更新：{key} = {value} by {request.user.username}')

        return Response({
            'message': '配置更新成功',
            'config': CloudSystemConfigSerializer(config, context={'request': request}).data
        })

    @action(detail=False, methods=['post'])
    def batch_update(self, request):
        """📦 批量更新配置"""
        configs = request.data.get('configs', [])
        if not configs:
            return Response({'error': '配置列表不能为空'}, status=status.HTTP_400_BAD_REQUEST)

        results = []
        errors = []

        with transaction.atomic():
            for item in configs:
                key = item.get('key')
                value = item.get('value')

                if not key or key not in self.PREDEFINED_CONFIGS:
                    errors.append({'key': key, 'error': '无效的配置项'})
                    continue

                try:
                    predefined = self.PREDEFINED_CONFIGS[key]
                    if not predefined.get('is_editable', True):
                        errors.append({'key': key, 'error': '该配置项不可编辑'})
                        continue

                    # 类型转换
                    value_type = predefined['value_type']
                    if value_type == 'integer':
                        value = int(value)
                    elif value_type == 'boolean':
                        value = str(value).lower() in ('true', '1', 'yes')
                    elif value_type == 'json':
                        if isinstance(value, str):
                            value = json.loads(value)
                        value = json.dumps(value, ensure_ascii=False)

                    config, _ = CloudSystemConfig.objects.update_or_create(
                        key=key,
                        defaults={
                            'name': predefined['name'],
                            'value': str(value) if value_type != 'json' else value,
                            'value_type': value_type,
                            'category': predefined['category'],
                            'updated_by': request.user
                        }
                    )
                    cache.delete(f'cloud_config:{key}')
                    results.append({'key': key, 'status': 'success'})

                except Exception as e:
                    errors.append({'key': key, 'error': str(e)})

        return Response({
            'message': f'批量更新完成：{len(results)} 成功，{len(errors)} 失败',
            'results': results,
            'errors': errors
        })

    @action(detail=False, methods=['post'])
    def reset_to_default(self, request):
        """🔄 重置配置为默认值"""
        key = request.data.get('key')
        if not key:
            return Response({'error': '配置键不能为空'}, status=status.HTTP_400_BAD_REQUEST)

        if key not in self.PREDEFINED_CONFIGS:
            return Response({'error': '无效的配置项'}, status=status.HTTP_400_BAD_REQUEST)

        predefined = self.PREDEFINED_CONFIGS[key]

        with transaction.atomic():
            config, created = CloudSystemConfig.objects.update_or_create(
                key=key,
                defaults={
                    'name': predefined['name'],
                    'value': predefined.get('default', ''),
                    'value_type': predefined['value_type'],
                    'category': predefined['category'],
                    'default_value': predefined.get('default', ''),
                    'updated_by': request.user
                }
            )
            cache.delete(f'cloud_config:{key}')

        return Response({
            'message': '配置已重置为默认值',
            'config': CloudSystemConfigSerializer(config, context={'request': request}).data
        })

    @action(detail=False, methods=['get'])
    def export_configs(self, request):
        """📤 导出系统配置"""
        import csv
        from django.http import HttpResponse

        export_format = request.query_params.get('fmt', 'csv').lower()
        category = request.query_params.get('category', '')

        queryset = CloudSystemConfig.objects.all()
        if category:
            queryset = queryset.filter(category=category)

        queryset = queryset.order_by('category', 'key')

        if export_format == 'json':
            configs = []
            for config in queryset:
                configs.append({
                    'key': config.key,
                    'name': config.name,
                    'value': config.get_typed_value(),
                    'value_type': config.value_type,
                    'category': config.category,
                    'description': config.description,
                    'default_value': config.default_value,
                    'updated_at': config.updated_at.isoformat() if config.updated_at else None,
                })

            response = HttpResponse(
                json.dumps(configs, ensure_ascii=False, indent=2),
                content_type='application/json; charset=utf-8'
            )
            filename = f'cloud_configs_{timezone.now().strftime("%Y%m%d_%H%M%S")}.json'
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            return response

        else:
            response = HttpResponse(content_type='text/csv; charset=utf-8')
            filename = f'cloud_configs_{timezone.now().strftime("%Y%m%d_%H%M%S")}.csv'
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            response.write('\ufeff')  # BOM for Excel

            writer = csv.writer(response)
            writer.writerow([
                '配置键', '配置名称', '配置值', '值类型', '分类',
                '描述', '默认值', '更新时间', '更新人'
            ])

            for config in queryset:
                writer.writerow([
                    config.key,
                    config.name,
                    config.get_typed_value(),
                    config.value_type,
                    config.get_category_display(),
                    config.description or '',
                    config.default_value or '',
                    config.updated_at.strftime('%Y-%m-%d %H:%M:%S') if config.updated_at else '',
                    config.updated_by.username if config.updated_by else ''
                ])

            return response

    @action(detail=False, methods=['get'])
    def system_info(self, request):
        """💻 获取系统信息"""
        import platform
        import django
        from django.db import connection
        from django.conf import settings

        # OnlyOffice 状态检查
        onlyoffice_status = self._check_onlyoffice_status()

        return Response({
            'server': {
                'hostname': platform.node(),
                'os': f'{platform.system()} {platform.release()}',
                'python_version': platform.python_version(),
                'django_version': django.get_version()
            },
            'onlyoffice': onlyoffice_status,
            'timestamp': timezone.now().isoformat()
        })

    @action(detail=False, methods=['post'])
    def clear_cache(self, request):
        """🗑️ 清除系统缓存"""
        cache_type = request.data.get('type', 'all')

        if cache_type == 'all':
            cache.clear()
            message = '所有缓存已清除'
        elif cache_type == 'config':
            keys = cache.keys('cloud_config:*')
            for key in keys:
                cache.delete(key)
            message = '配置缓存已清除'
        elif cache_type == 'onlyoffice':
            keys = cache.keys('onlyoffice:*')
            for key in keys:
                cache.delete(key)
            message = 'OnlyOffice 缓存已清除'
        else:
            return Response({'error': '无效的缓存类型'}, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f'缓存清除：{cache_type} by {request.user.username}')
        return Response({'message': message})

    # ==================== OnlyOffice 专用配置接口 ====================

    @action(detail=False, methods=['get'])
    def onlyoffice_configs(self, request):
        """⚙️ 获取 OnlyOffice 专用配置（模型字段方式）"""
        config = CloudSystemConfig.objects.first()  # 取第一条或按业务逻辑获取

        if not config:
            config = CloudSystemConfig.objects.create(
                key='onlyoffice.main',
                name='OnlyOffice 主配置',
                category='collaboration'
            )

        # 提取 OnlyOffice 相关字段
        data = {
            'document_server_url': config.onlyoffice_document_server_url,
            'jwt_enabled': config.onlyoffice_jwt_enabled,
            'jwt_secret': config.onlyoffice_jwt_secret,
            'language': config.onlyoffice_language,
            'collaboration_mode': config.onlyoffice_collaboration_mode,
            'permissions': {
                'download': config.onlyoffice_permission_download,
                'copy': config.onlyoffice_permission_copy,
                'edit': config.onlyoffice_permission_edit,
                'print': config.onlyoffice_permission_print,
                'comment': config.onlyoffice_permission_comment,
                'chat': config.onlyoffice_permission_chat,
                'review': config.onlyoffice_permission_review,
                'fill_forms': config.onlyoffice_permission_fill_forms,
                'modify_content_control': config.onlyoffice_permission_modify_content_control,
                'modify_filter': config.onlyoffice_permission_modify_filter,
            },
            'ui': {
                'show_chat': config.onlyoffice_show_chat,
                'show_comments': config.onlyoffice_show_comments,
                'show_review': config.onlyoffice_show_review,
                'show_spellcheck': config.onlyoffice_show_spellcheck,
                'forcesave': config.onlyoffice_forcesave,
                'compact_toolbar': config.onlyoffice_compact_toolbar,
                'ui_theme': config.onlyoffice_ui_theme,
            },
            'version_keep_count': config.onlyoffice_version_keep_count,
        }

        return Response(data)

    @action(detail=False, methods=['put'])
    def update_onlyoffice_configs(self, request):
        """⚙️ 更新 OnlyOffice 专用配置"""
        with transaction.atomic():
            config = CloudSystemConfig.objects.first()
            if not config:
                config = CloudSystemConfig.objects.create(
                    key='onlyoffice.main',
                    name='OnlyOffice 主配置',
                    category='collaboration'
                )

            # 更新服务器配置
            if 'document_server_url' in request.data:
                config.onlyoffice_document_server_url = request.data['document_server_url']
            if 'jwt_enabled' in request.data:
                config.onlyoffice_jwt_enabled = request.data['jwt_enabled']
            if 'jwt_secret' in request.data:
                config.onlyoffice_jwt_secret = request.data['jwt_secret']
            if 'language' in request.data:
                config.onlyoffice_language = request.data['language']
            if 'collaboration_mode' in request.data:
                config.onlyoffice_collaboration_mode = request.data['collaboration_mode']

            # 更新权限配置
            perms = request.data.get('permissions', {})
            for perm_key, field_name in [
                ('download', 'onlyoffice_permission_download'),
                ('copy', 'onlyoffice_permission_copy'),
                ('edit', 'onlyoffice_permission_edit'),
                ('print', 'onlyoffice_permission_print'),
                ('comment', 'onlyoffice_permission_comment'),
                ('chat', 'onlyoffice_permission_chat'),
                ('review', 'onlyoffice_permission_review'),
                ('fill_forms', 'onlyoffice_permission_fill_forms'),
                ('modify_content_control', 'onlyoffice_permission_modify_content_control'),
                ('modify_filter', 'onlyoffice_permission_modify_filter'),
            ]:
                if perm_key in perms:
                    setattr(config, field_name, perms[perm_key])

            # 更新界面配置
            ui = request.data.get('ui', {})
            if 'show_chat' in ui:
                config.onlyoffice_show_chat = ui['show_chat']
            if 'show_comments' in ui:
                config.onlyoffice_show_comments = ui['show_comments']
            if 'show_review' in ui:
                config.onlyoffice_show_review = ui['show_review']
            if 'show_spellcheck' in ui:
                config.onlyoffice_show_spellcheck = ui['show_spellcheck']
            if 'forcesave' in ui:
                config.onlyoffice_forcesave = ui['forcesave']
            if 'compact_toolbar' in ui:
                config.onlyoffice_compact_toolbar = ui['compact_toolbar']
            if 'ui_theme' in ui:
                config.onlyoffice_ui_theme = ui['ui_theme']

            # 版本控制
            if 'version_keep_count' in request.data:
                config.onlyoffice_version_keep_count = request.data['version_keep_count']

            config.updated_by = request.user
            config.save()

            # 清除缓存
            cache.delete('onlyoffice:config')

        logger.info(f'OnlyOffice 配置更新 by {request.user.username}')
        return Response({
            'message': 'OnlyOffice 配置更新成功',
            'config': self.onlyoffice_configs(request).data
        })


    # ==================== 用户自定义权限管理 ====================

    @action(detail=False, methods=['get', 'post'], url_path='user-permissions')
    def user_permissions(self, request):
        """
        🔧 用户自定义权限配置接口
        GET /api/cloud/settings/user-permissions/ - 获取列表
        POST /api/cloud/settings/user-permissions/ - 创建新配置
        """
        if request.method == 'GET':
            return self._list_user_permissions(request)
        elif request.method == 'POST':
            return self._create_user_permission(request)

    def _list_user_permissions(self, request):
        """获取所有用户的自定义权限配置列表"""
        try:
            # 只返回管理员或有权限的用户
            if not request.user.is_superuser:
                return Response(
                    {'error': '权限不足'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 获取所有用户的权限配置
            queryset = UserOnlyOfficePermission.objects.select_related(
                'user', 'created_by'
            ).order_by('-updated_at')

            # 支持搜索
            search = request.query_params.get('search', '').strip()
            if search:
                queryset = queryset.filter(
                    Q(user__username__icontains=search) |
                    Q(user__real_name__icontains=search)
                )

            # 分页
            page = self.paginate_queryset(queryset)
            if page is not None:
                serializer = UserOnlyOfficePermissionSerializer(
                    page, many=True, context={'request': request}
                )
                return self.get_paginated_response(serializer.data)

            serializer = UserOnlyOfficePermissionSerializer(
                queryset, many=True, context={'request': request}
            )
            return Response(serializer.data)

        except Exception as e:
            logger.error(f'获取用户权限列表失败：{e}', exc_info=True)
            return Response(
                {'error': f'获取失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _create_user_permission(self, request):
        """创建用户自定义权限配置"""
        try:
            if not request.user.is_superuser:
                return Response(
                    {'error': '权限不足'},
                    status=status.HTTP_403_FORBIDDEN
                )

            data = request.data.copy()

            # 转换权限字段
            permissions = data.pop('permissions', {})
            for perm_key, field_name in [
                ('download', 'permission_download'),
                ('copy', 'permission_copy'),
                ('edit', 'permission_edit'),
                ('print', 'permission_print'),
                ('comment', 'permission_comment'),
                ('chat', 'permission_chat'),
                ('review', 'permission_review'),
                ('fill_forms', 'permission_fill_forms'),
                ('modify_content_control', 'permission_modify_content_control'),
                ('modify_filter', 'permission_modify_filter'),
            ]:
                if perm_key in permissions:
                    data[field_name] = permissions[perm_key]

            serializer = UserOnlyOfficePermissionSerializer(
                data=data,
                context={'request': request}
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()

            logger.info(f'创建用户权限配置：{serializer.data["user_info"]["username"]} by {request.user.username}')
            return Response(serializer.data, status=status.HTTP_201_CREATED)

        except serializers.ValidationError as e:
            return Response(e.detail, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f'创建用户权限配置失败：{e}', exc_info=True)
            return Response(
                {'error': f'创建失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['put', 'delete'], url_path='user-permissions/(?P<user_id>[^/.]+)')
    def user_permission_detail(self, request, user_id=None):
        """
        🔧 用户自定义权限详情接口
        PUT /api/cloud/settings/user-permissions/{user_id}/ - 更新配置
        DELETE /api/cloud/settings/user-permissions/{user_id}/ - 删除配置
        """
        if request.method == 'PUT':
            return self._update_user_permission(request, user_id)
        elif request.method == 'DELETE':
            return self._delete_user_permission(request, user_id)

    def _update_user_permission(self, request, user_id=None):
        """更新用户自定义权限配置"""
        try:
            if not request.user.is_superuser:
                return Response(
                    {'error': '权限不足'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 查找用户权限配置
            try:
                perm = UserOnlyOfficePermission.objects.get(user_id=user_id)
            except UserOnlyOfficePermission.DoesNotExist:
                return Response(
                    {'error': '该用户暂无权限配置'},
                    status=status.HTTP_404_NOT_FOUND
                )

            data = request.data.copy()

            # 转换权限字段
            permissions = data.pop('permissions', None)
            if permissions:
                for perm_key, field_name in [
                    ('download', 'permission_download'),
                    ('copy', 'permission_copy'),
                    ('edit', 'permission_edit'),
                    ('print', 'permission_print'),
                    ('comment', 'permission_comment'),
                    ('chat', 'permission_chat'),
                    ('review', 'permission_review'),
                    ('fill_forms', 'permission_fill_forms'),
                    ('modify_content_control', 'permission_modify_content_control'),
                    ('modify_filter', 'permission_modify_filter'),
                ]:
                    if perm_key in permissions:
                        data[field_name] = permissions[perm_key]

            serializer = UserOnlyOfficePermissionSerializer(
                perm,
                data=data,
                partial=True,
                context={'request': request}
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()

            logger.info(f'更新用户权限配置：{perm.user.username} by {request.user.username}')
            return Response(serializer.data)

        except UserOnlyOfficePermission.DoesNotExist:
            return Response(
                {'error': '该用户暂无权限配置'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.error(f'更新用户权限配置失败：{e}', exc_info=True)
            return Response(
                {'error': f'更新失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _delete_user_permission(self, request, user_id=None):
        """删除用户自定义权限配置"""
        try:
            if not request.user.is_superuser:
                return Response(
                    {'error': '权限不足'},
                    status=status.HTTP_403_FORBIDDEN
                )

            try:
                perm = UserOnlyOfficePermission.objects.get(user_id=user_id)
                username = perm.user.username
                perm.delete()

                logger.info(f'删除用户权限配置：{username} by {request.user.username}')
                return Response({'message': '权限配置已删除'})

            except UserOnlyOfficePermission.DoesNotExist:
                return Response(
                    {'error': '该用户暂无权限配置'},
                    status=status.HTTP_404_NOT_FOUND
                )

        except Exception as e:
            logger.error(f'删除用户权限配置失败：{e}', exc_info=True)
            return Response(
                {'error': f'删除失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['get'], url_path='users-for-permission')
    def get_users_for_permission(self, request):
        """
        🔧 获取可用于配置权限的用户列表（排除已有配置的用户）
        GET /api/cloud/settings/users-for-permission/?search=xxx
        """
        try:
            if not request.user.is_superuser:
                return Response(
                    {'error': '权限不足'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 获取所有用户
            queryset = CustomUser.objects.filter(is_active=True)

            # 排除已有权限配置的用户
            configured_users = UserOnlyOfficePermission.objects.values_list('user_id', flat=True)
            queryset = queryset.exclude(id__in=configured_users)

            # 搜索
            search = request.query_params.get('search', '').strip()
            if search:
                queryset = queryset.filter(
                    Q(username__icontains=search) |
                    Q(real_name__icontains=search) |
                    Q(email__icontains=search)
                )

            # 限制返回数量
            queryset = queryset[:50]

            users_data = [
                {
                    'id': user.id,
                    'username': user.username,
                    'real_name': user.real_name or '',
                    'email': user.email or '',
                    'department': user.department.name if hasattr(user, 'department') and user.department else '',
                }
                for user in queryset
            ]

            return Response(users_data)

        except Exception as e:
            logger.error(f'获取用户列表失败：{e}', exc_info=True)
            return Response(
                {'error': f'获取失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


    # ==================== 辅助方法 ====================

    def _get_category_info(self, category):
        """获取分类的详细信息"""
        category_info = {
            'storage': {'icon': 'fas fa-hdd', 'desc': '存储空间、配额、清理策略等设置', 'color': '#409EFF'},
            'security': {'icon': 'fas fa-shield-alt', 'desc': '访问权限、加密、水印等安全设置', 'color': '#67C23A'},
            'upload': {'icon': 'fas fa-cloud-upload-alt', 'desc': '文件上传限制、分片、秒传等设置', 'color': '#E6A23C'},
            'share': {'icon': 'fas fa-share-alt', 'desc': '分享链接、密码、有效期等设置', 'color': '#F56C6C'},
            'collaboration': {'icon': 'fas fa-users', 'desc': '在线编辑、协同权限、版本控制等', 'color': '#909399'},
            'system': {'icon': 'fas fa-cog', 'desc': '系统基础参数、维护模式等', 'color': '#606266'},
            'notification': {'icon': 'fas fa-bell', 'desc': '消息通知、邮件、企业微信集成', 'color': '#909399'},
            'audit': {'icon': 'fas fa-clipboard-list', 'desc': '操作日志、审计追踪、合规设置', 'color': '#909399'},
        }
        return category_info.get(category, {'icon': 'fas fa-cog', 'desc': '系统配置项', 'color': '#909399'})

    def _validate_integer(self, value, validation):
        if not validation:
            return
        if 'min' in validation and value < validation['min']:
            raise ValueError(f'值不能小于 {validation["min"]}')
        if 'max' in validation and value > validation['max']:
            raise ValueError(f'值不能大于 {validation["max"]}')

    def _validate_string(self, value, validation):
        import re
        if not validation:
            return
        if 'min_length' in validation and len(value) < validation['min_length']:
            raise ValueError(f'长度不能小于 {validation["min_length"]} 字符')
        if 'max_length' in validation and len(value) > validation['max_length']:
            raise ValueError(f'长度不能大于 {validation["max_length"]} 字符')
        if 'pattern' in validation and not re.match(validation['pattern'], value):
            raise ValueError('格式不符合要求')

    def _validate_json(self, value, validation):
        if not validation:
            return
        if validation.get('is_array') and not isinstance(value, list):
            raise ValueError('必须是数组格式')

    def _validate_business_rules(self, key, value):
        rules = {
            'upload.max_file_size_mb': lambda v: v <= 2048 or '文件上传大小不能超过 2048MB',
            'upload.image_max_size_mb': lambda v: v <= 200 or '图片大小不能超过 200MB',
            'upload.video_max_size_mb': lambda v: v <= 2048 or '视频大小不能超过 2048MB',
            'storage.quota_gb': lambda v: v <= 1024 or '存储配额不能超过 1024GB',
            'collab.max_collaborators': lambda v: 1 <= v <= 500 or '协作者数必须在 1-500 之间',
            'security.token_expire_hours': lambda v: 1 <= v <= 168 or '令牌过期时间必须在 1-168 小时之间',
        }
        if key in rules:
            result = rules[key](value)
            if result is not True:
                raise ValueError(result)

    def _check_onlyoffice_status(self):
        """检查 OnlyOffice 服务状态"""
        doc_server_url = CloudSystemConfig.get_value(
            'onlyoffice.document_server_url',
            settings.ONLYOFFICE.get('DOCUMENT_SERVER_URL', '')
        )
        doc_server_url = doc_server_url.rstrip('/') + '/healthcheck'
        try:
            response = requests.get(doc_server_url, timeout=5)
            if response.status_code == 200:
                return {
                    'status': 'online',
                    'url': doc_server_url,
                    'response_time': response.elapsed.total_seconds()
                }
            else:
                return {'status': 'error', 'url': doc_server_url, 'error': f'HTTP {response.status_code}'}
        except requests.RequestException as e:
            return {'status': 'offline', 'url': doc_server_url, 'error': str(e)}

    def _reload_onlyoffice_config(self):
        """重载 OnlyOffice 配置"""
        cache.delete('onlyoffice:config')
        cache.delete('onlyoffice:jwt_secret')
        logger.info('OnlyOffice 配置已重载')





class SharedFolderViewSet(viewsets.ModelViewSet, UtilsTools):
    """共享文件夹视图集"""
    serializer_class = FolderSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = CloudPagination  # 🔧 添加分页支持

    def get_serializer_class(self):
        """根据操作返回不同的序列化器"""
        if self.action == 'list':
            return FolderListSerializer
        return FolderSerializer

    def get_queryset(self):
        user = self.request.user
        # 获取用户有权限访问的共享文件夹：创建者 或 协作者
        queryset = Folder.objects.filter(
            is_shared_folder=True,
            deleted_at__isnull=True
        ).filter(
            Q(owner=user) | Q(folder_collaborations__user=user, folder_collaborations__is_active=True)
        ).distinct().select_related('owner').prefetch_related('folder_collaborations__user')

        # 🔧 支持父文件夹过滤（用于文件夹钻取）
        parent_id = self.request.query_params.get('parent', None)
        if parent_id and parent_id.lower() != 'null':
            queryset = queryset.filter(parent_id=parent_id)
        else:
            queryset = queryset.filter(parent__isnull=True)

        # 🔧 支持搜索
        search = self.request.query_params.get('search', '')
        if search:
            queryset = queryset.filter(name__icontains=search)

        return queryset.order_by('-created_at')


    def perform_create(self, serializer):
        # 创建时自动标记为共享文件夹
        serializer.save(owner=self.request.user, is_shared_folder=True)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if not self._is_admin_or_owner(instance, request.user):
            return Response({'error': '无删除该共享文件夹权限'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    # 🔧 新增：重写list方法，混合返回子文件夹和文件
    def list(self, request, *args, **kwargs):
        """
        🔧 重写 list 方法：返回共享文件夹及其内容（支持钻取和搜索）
        """
        folder_id = request.query_params.get('folder', None)
        search_keyword = request.query_params.get('search', '').strip()

        logger.info(f'SharedFolderViewSet.list: folder_id={folder_id}, search={search_keyword}')


        # 如果指定了folder参数，返回该共享文件夹下的内容
        if folder_id:
            try:
                shared_folder = Folder.objects.select_related('owner').prefetch_related(
                    'folder_collaborations__user'
                ).get(id=folder_id, deleted_at__isnull=True)
                logger.info(f'SharedFolderViewSet.list: shared_folder={shared_folder}')

                # 检查用户权限 - 需要追溯到根共享文件夹的权限
                if not self._can_access_with_ancestors(shared_folder, request.user):
                    return Response({'error': '无权访问'}, status=status.HTTP_403_FORBIDDEN)

                # 🔧 获取子文件夹 - 修复权限过滤逻辑
                # 子文件夹继承父文件夹的权限，只要是共享文件夹的成员就能访问
                subfolders = Folder.objects.filter(
                    parent_id=folder_id,
                    deleted_at__isnull=True
                ).select_related('owner').prefetch_related('folder_collaborations__user')

                # 🔧 关键修复：支持搜索子文件夹
                if search_keyword:
                    subfolders = subfolders.filter(name__icontains=search_keyword)

                # 🔧 获取文件
                files = CloudFile.objects.filter(
                    folder_id=folder_id,
                    deleted_at__isnull=True
                ).select_related('owner')

                # 🔧 关键修复：支持搜索文件
                if search_keyword:
                    files = files.filter(
                        Q(name__icontains=search_keyword) |
                        Q(original_name__icontains=search_keyword) |
                        Q(description__icontains=search_keyword)
                    )

                logger.info(f'SharedFolderViewSet.list: found {subfolders.count()} subfolders, {files.count()} files')

                # 🔧 分页处理（只对文件分页，文件夹不分页）
                page = self.paginate_queryset(files)
                if page is not None:
                    folder_data = FolderListSerializer(subfolders, many=True, context={'request': request}).data
                    for item in folder_data:
                        item['is_folder'] = True

                    file_data = CloudFileSerializer(page, many=True, context={'request': request}).data
                    for item in file_data:
                        item['is_folder'] = False

                    combined = folder_data + file_data
                    combined.sort(key=lambda x: (not x['is_folder'], x['name'].lower()))

                    return self.get_paginated_response(combined)

                # 无分页
                folder_data = FolderListSerializer(subfolders, many=True, context={'request': request}).data
                for item in folder_data:
                    item['is_folder'] = True

                file_data = CloudFileSerializer(files, many=True, context={'request': request}).data
                for item in file_data:
                    item['is_folder'] = False

                combined = folder_data + file_data
                combined.sort(key=lambda x: (not x['is_folder'], x['name'].lower()))

                return Response(combined)

            except Folder.DoesNotExist:
                logger.error(f'共享文件夹不存在: {folder_id}')
                return Response({'error': '共享文件夹不存在'}, status=status.HTTP_404_NOT_FOUND)
            except Exception as e:
                logger.error(f'加载共享文件夹内容失败: {e}', exc_info=True)
                return Response(
                    {'error': f'加载失败: {str(e)}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

            # 默认行为：返回共享文件夹列表
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def add_member(self, request, pk=None):
        """添加或更新成员权限"""
        folder = self.get_object()
        if not self._is_admin_or_owner(folder, request.user):
            return Response({'error': '无操作权限'}, status=status.HTTP_403_FORBIDDEN)

        user_id = request.data.get('user_id')
        permission = request.data.get('permission', 'read')

        try:
            target_user = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

        collab, created = FolderCollaboration.objects.update_or_create(
            folder=folder,
            user=target_user,
            defaults={'permission': permission, 'is_active': True}
        )
        return Response({'message': '添加成功', 'created': created})

    @action(detail=True, methods=['post'])
    def update_member(self, request, pk=None):
        """更新成员权限"""
        folder = self.get_object()
        if not self._is_admin_or_owner(folder, request.user):
            return Response({'error': '无操作权限'}, status=status.HTTP_403_FORBIDDEN)

        user_id = request.data.get('user_id')
        permission = request.data.get('permission', 'read')

        try:
            collab = FolderCollaboration.objects.get(folder=folder, user_id=user_id)
            if collab.permission == permission:
                return Response({'message': '权限未改变'})

            if collab.user == request.user:
                return Response({'error': '不能修改自己的权限'}, status=status.HTTP_400_BAD_REQUEST)

            collab.permission = permission
            collab.save(update_fields=['permission', 'updated_at'])
            return Response({'message': '权限更新成功'})
        except FolderCollaboration.DoesNotExist:
            return Response({'error': '成员不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['post'])
    def remove_member(self, request, pk=None):
        """移除成员"""
        folder = self.get_object()
        if not self._is_admin_or_owner(folder, request.user):
            return Response({'error': '无操作权限'}, status=status.HTTP_403_FORBIDDEN)

        try:
            user_id = request.data.get('user_id')
            collab = FolderCollaboration.objects.get(folder=folder, user_id=user_id)
            if collab.user == request.user:
                return Response({'error': '不能移除自己'}, status=status.HTTP_400_BAD_REQUEST)
            collab.delete()
            return Response({'message': '移除成功'})
        except FolderCollaboration.DoesNotExist:
            return Response({'error': '成员不存在'}, status=status.HTTP_404_NOT_FOUND)

    @action(detail=True, methods=['get'])
    def members(self, request, pk=None):
        """获取共享文件夹成员列表"""
        folder = self.get_object()
        if not self._can_access(folder, request.user):
            return Response({'error': '无权访问'}, status=status.HTTP_403_FORBIDDEN)

        collabs = FolderCollaboration.objects.filter(folder=folder, is_active=True).select_related('user')
        data = [{
            'id': c.user.id,
            'username': c.user.username,
            'real_name': c.user.real_name or c.user.username,
            'permission': c.permission,
            'is_owner': False
        } for c in collabs]

        # 将所有者放在首位
        data.insert(0, {
            'id': folder.owner.id,
            'username': folder.owner.username,
            'real_name': folder.owner.real_name or folder.owner.username,
            'permission': 'admin',
            'is_owner': True
        })
        return Response({'members': data})

    # 🔧 新增：获取用户在共享文件夹中的权限
    @action(detail=True, methods=['get'])
    def my_permission(self, request, pk=None):
        """获取当前用户在共享文件夹中的权限"""
        folder = self.get_object()
        user = request.user

        if folder.owner == user:
            return Response({'permission': 'admin', 'is_owner': True})

        collab = FolderCollaboration.objects.filter(
            folder=folder,
            user=user,
            is_active=True
        ).first()

        if collab:
            return Response({'permission': collab.permission, 'is_owner': False})

        return Response({'error': '无权访问'}, status=status.HTTP_403_FORBIDDEN)

    # 🔧 新增：移动文件到/从共享文件夹
    @action(detail=False, methods=['post'])
    def move_items(self, request):
        """
        🔧 批量移动文件/文件夹到共享文件夹
        {
            "target_folder_id": "uuid",  // 目标共享文件夹ID
            "file_ids": ["uuid1", "uuid2"],  // 要移动的文件ID列表
            "folder_ids": ["uuid1", "uuid2"]  // 要移动的文件夹ID列表
        }
        """
        try:
            user = request.user
            target_folder_id = request.data.get('target_folder_id')
            file_ids = request.data.get('file_ids', [])
            folder_ids = request.data.get('folder_ids', [])

            if not target_folder_id:
                return Response({'error': '目标文件夹不能为空'}, status=status.HTTP_400_BAD_REQUEST)

            # 验证目标文件夹权限
            try:
                target_folder = Folder.objects.get(id=target_folder_id, is_shared_folder=True,
                                                   deleted_at__isnull=True)
            except Folder.DoesNotExist:
                return Response({'error': '目标共享文件夹不存在'}, status=status.HTTP_404_NOT_FOUND)

            if not self._can_access(target_folder, user):
                return Response({'error': '无权访问目标文件夹'}, status=status.HTTP_403_FORBIDDEN)

            # 检查是否有编辑权限
            my_perm = self._get_user_permission(target_folder, user)
            if my_perm not in ['write', 'admin']:
                return Response({'error': '需要编辑权限才能移动文件'}, status=status.HTTP_403_FORBIDDEN)

            moved_count = 0
            errors = []

            # 移动文件
            for file_id in file_ids:
                try:
                    file_obj = CloudFile.objects.get(id=file_id, deleted_at__isnull=True)
                    # 检查源文件权限（必须是自己的文件或来自共享文件夹且有权限）
                    if not self._can_move_file(file_obj, user):
                        errors.append(f'文件 {file_obj.name}: 无权移动')
                        continue

                    file_obj.folder = target_folder
                    file_obj.save(update_fields=['folder', 'updated_at'])
                    moved_count += 1

                    # 记录日志
                    FileOperationLog.objects.create(
                        file=file_obj,
                        folder=target_folder,
                        user=user,
                        operation='move',
                        description=f'移动到共享文件夹 {target_folder.name}',
                        ip_address=get_request_ip(request)
                    )
                except CloudFile.DoesNotExist:
                    errors.append(f'文件 {file_id}: 不存在')
                except Exception as e:
                    errors.append(f'文件 {file_id}: {str(e)}')

            # 移动文件夹
            for folder_id in folder_ids:
                try:
                    folder_obj = Folder.objects.get(id=folder_id, deleted_at__isnull=True)
                    if not self._can_move_folder(folder_obj, user):
                        errors.append(f'文件夹 {folder_obj.name}: 无权移动')
                        continue

                    folder_obj.parent = target_folder
                    folder_obj.save(update_fields=['parent', 'updated_at'])
                    moved_count += 1

                    FileOperationLog.objects.create(
                        folder=folder_obj,
                        user=user,
                        operation='move',
                        description=f'移动到共享文件夹 {target_folder.name}',
                        ip_address=get_request_ip(request)
                    )
                except Folder.DoesNotExist:
                    errors.append(f'文件夹 {folder_id}: 不存在')
                except Exception as e:
                    errors.append(f'文件夹 {folder_id}: {str(e)}')

            return Response({
                'message': f'成功移动 {moved_count} 个项目',
                'moved_count': moved_count,
                'errors': errors[:10]
            })

        except Exception as e:
            logger.error(f'移动失败: {e}', exc_info=True)
            return Response(
                {'error': f'移动失败: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


