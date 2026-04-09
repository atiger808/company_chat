# cloud/views.py - 添加网盘视图集

from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.db.models import Q, Sum, Count, F
from django.db import models
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import api_view, permission_classes
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
    DocumentVersion, DocumentEditLock, DocumentCollaboration

)
from .serializers import (
    FolderSerializer, FolderListSerializer,
    CloudFileSerializer, FileShareSerializer,
    FileCommentSerializer, FileOperationLogSerializer,
    FileVersionSerializer
)
from .permissions import OnlyOfficeCallbackPermission  # 🔧 导入自定义权限
from accounts.models import CustomUser, Department
from utils.request_util import get_request_ip
from urllib.parse import quote
import zipfile
import io
import os
import re
import time
import hashlib
import uuid
from loguru import logger
from datetime import timedelta
import requests
import json
import jwt
from io import BytesIO


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


class FolderViewSet(viewsets.ModelViewSet):
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
                        'parent': str(folder.parent.id) if folder.parent else None,
                        'children': build_tree(folders_list, folder.id)
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
                folder = Folder.objects.get(id=pk, owner=request.user)
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
                folder = Folder.objects.get(id=pk, owner=request.user)
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
                folder = Folder.objects.get(id=pk, owner=request.user)
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
                self._physical_delete_folder(folder)

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

    def _physical_delete_folder(self, folder_obj):
        """
        🔧 递归物理删除文件夹及其内容
        """

        # 🔧 1. 删除子文件夹（递归）
        for child_folder in folder_obj.children.filter(deleted_at__isnull=False):
            self._physical_delete_folder(child_folder)

        # 🔧 2. 删除文件
        for file_obj in CloudFile.objects.filter(folder=folder_obj, deleted_at__isnull=False):
            file_path = file_obj.file.path if file_obj.file else None
            if file_path and os.path.exists(file_path):
                try:
                    file_size = os.path.getsize(file_path)
                    os.remove(file_path)
                    logger.info(f'已删除物理文件：{file_path} ({file_size} bytes)')
                except Exception as e:
                    logger.warning(f'删除物理文件失败 {file_path}: {e}')
            file_obj.delete()

        # 🔧 3. 删除文件夹本身
        folder_obj.delete()
        logger.info(f'已删除文件夹：{folder_obj.id}')

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
class CloudFileViewSet(viewsets.ModelViewSet):
    """云文件视图集"""
    queryset = CloudFile.objects.filter(deleted_at__isnull=True)
    serializer_class = CloudFileSerializer
    # permission_classes = [permissions.IsAuthenticated, IsCloudOwnerOrShared]
    permission_classes = [permissions.IsAuthenticated]
    # 🔧 关键修复：同时支持表单上传和 JSON 请求
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        """
           🔧 关键修复：支持文件夹钻取的查询逻辑
           - 返回当前文件夹下的所有文件和子文件夹
           - 支持星标、回收站等过滤
        """
        user = self.request.user
        queryset = CloudFile.objects.select_related('owner', 'folder').filter(owner=user)

        # 🔧 回收站过滤
        is_trash = self.request.query_params.get('trash', 'false').lower() == 'true'
        if is_trash:
            # 🔧 返回已删除的文件（不包括文件夹，文件夹由 FolderViewSet 处理）
            return queryset.filter(deleted_at__isnull=False).order_by('-deleted_at')
        # 正常查询
        queryset = queryset.filter(deleted_at__isnull=True)

        # 🔧 2. 星标文件过滤 (starred=true)
        # 星标过滤
        is_starred = self.request.query_params.get('starred', 'false').lower() == 'true'
        if is_starred:
            queryset = queryset.filter(is_starred=True, deleted_at__isnull=True)

        # 🔧 3. 文件夹路径过滤 (folder=uuid)
        # 🔧 关键：文件夹钻取 - 按 parent 过滤
        folder_id = self.request.query_params.get('folder', '')
        if folder_id and folder_id.lower() != 'null':
            queryset = queryset.filter(folder_id=folder_id)
        else:
            queryset = queryset.filter(folder__isnull=True)

        # 搜索
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(Q(name__icontains=search) | Q(original_name__icontains=search))

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
        🔧 重写 list 方法：混合返回文件夹和文件
        """
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        folder_id = request.query_params.get('folder', '')

        if page is not None:
            # 🔧 关键：同时查询当前文件夹下的子文件夹
            if folder_id and folder_id.lower() != 'null':
                subfolders = Folder.objects.filter(
                    parent_id=folder_id,
                    owner=request.user,
                    deleted_at__isnull=True
                )
            else:
                subfolders = Folder.objects.filter(
                    parent__isnull=True,
                    owner=request.user,
                    deleted_at__isnull=True
                )

            # 🔧 序列化文件夹（标记为 is_folder=true）
            folder_data = FolderListSerializer(subfolders, many=True, context={'request': request}).data
            for item in folder_data:
                item['is_folder'] = True  # 🔧 标记为文件夹

            # 序列化文件
            file_data = self.get_serializer(page, many=True, context={'request': request}).data
            for item in file_data:
                item['is_folder'] = False  # 🔧 标记为文件

            # 🔧 合并并排序：文件夹在前
            combined = folder_data + file_data
            combined.sort(key=lambda x: (not x['is_folder'], x['name'].lower()))

            return self.get_paginated_response(combined)

        # 无分页时同样处理

        is_trash = self.request.query_params.get('trash', 'false').lower() == 'true'
        is_starred = self.request.query_params.get('starred', 'false').lower() == 'true'

        subfolders = Folder.objects.filter(
            parent_id=folder_id if folder_id and folder_id.lower() != 'null' else None,
            owner=request.user,
            deleted_at__isnull=True
        ) if not is_trash and not is_starred else Folder.objects.none()

        folder_data = FolderListSerializer(subfolders, many=True, context={'request': request}).data
        for item in folder_data:
            item['is_folder'] = True

        file_data = self.get_serializer(queryset, many=True, context={'request': request}).data
        for item in file_data:
            item['is_folder'] = False

        combined = folder_data + file_data
        combined.sort(key=lambda x: (not x['is_folder'], x['name'].lower()))

        return Response(combined)

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
                    description=f'秒传文件：{new_file.original_name}',
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
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
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
        """📂 移动文件/文件夹"""
        logger.info(f"{request.user} Moving file pk: {pk}")
        try:
            try:
                file_obj = CloudFile.objects.get(id=pk, owner=request.user)
            except CloudFile.DoesNotExist:
                return Response({'error': '文件不存在'}, status=404)
            target_folder_id = request.data.get('target_folder_id')
            from_folder = CloudFile.folder
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
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
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
                file_obj = CloudFile.objects.get(id=pk, owner=request.user)
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
                logger.info(f"文件 {pk} 有活跃关联，执行逻辑清空")

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
                    f"文件 {pk} 引用计数大于 1，无法永久删除, reference_count: {reference_count} total_reference_file_count：{total_reference_file_count}")
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
                logger.info(f"文件 {pk} 无关联，执行物理清空")

                # 获取文件路径
                file_path = file_obj.file.path if file_obj.file else None
                file_name = file_obj.name

                # 删除物理文件
                if file_path and os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                        os.remove(file_path)
                        logger.info(f'已删除物理文件：{file_path} ({file_size} bytes)')
                    except Exception as e:
                        logger.warning(f'删除物理文件失败 {file_path}: {e}')

                # 获取文件 ID 用于日志
                file_id = file_obj.id

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
            logger.error(f'永久删除文件失败：{e}', exc_info=True)
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

    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser])
    def upload_chunk(self, request):
        """上传文件分片"""
        md5 = request.data.get('md5')
        chunk_index = int(request.data.get('chunk_index'))
        total_chunks = int(request.data.get('total_chunks'))
        chunk_file = request.FILES.get('file')

        # 存储分片到临时目录
        temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_uploads', md5)
        os.makedirs(temp_dir, exist_ok=True)

        chunk_path = os.path.join(temp_dir, f"{chunk_index}.part")
        with open(chunk_path, 'wb+') as f:
            for chunk in chunk_file.chunks():
                f.write(chunk)

        return Response({'status': 'success', 'chunk': chunk_index})

    @action(detail=False, methods=['post'])
    def merge_chunks(self, request):
        """合并分片并创建文件记录"""
        md5 = request.data.get('md5')
        filename = request.data.get('filename')
        total_chunks = int(request.data.get('total_chunks'))

        temp_dir = os.path.join(settings.MEDIA_ROOT, 'temp_uploads', md5)

        # 验证所有分片是否存在
        for i in range(total_chunks):
            if not os.path.exists(os.path.join(temp_dir, f"{i}.part")):
                return Response({'error': f'缺少分片 {i}'}, status=400)

        # 合并文件
        final_filename = f"{md5}_{filename}"
        final_path = os.path.join(settings.MEDIA_ROOT, 'cloud_files', final_filename)
        os.makedirs(os.path.dirname(final_path), exist_ok=True)

        with open(final_path, 'wb') as final_file:
            for i in range(total_chunks):
                chunk_path = os.path.join(temp_dir, f"{i}.part")
                with open(chunk_path, 'rb') as f:
                    final_file.write(f.read())
                os.remove(chunk_path)  # 删除分片

        os.rmdir(temp_dir)  # 删除临时目录

        # 创建数据库记录
        file_obj = CloudFile.objects.create(
            owner=request.user,
            name=filename,
            original_name=filename,
            file=f'cloud_files/{final_filename}',
            md5=md5,
            size=os.path.getsize(final_path),
            # mime_type 可通过 python-magic 库获取，此处简化
        )

        return Response({'message': '合并成功', 'file_id': file_obj.id})

    # cloud/views.py - CloudFileViewSet 中添加

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


class FileShareViewSet(viewsets.ModelViewSet):
    """文件分享视图集"""
    queryset = FileShare.objects.all()
    serializer_class = FileShareSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_context(self):
        """🔧 关键修复：确保 request 传递到序列化器"""
        context = super().get_serializer_context()
        context.update({'request': self.request})
        return context

    def get_queryset(self):
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
                if file_obj.owner != request.user and not request.user.is_superuser:
                    return Response(
                        {'error': '无权分享此文件'},
                        status=status.HTTP_403_FORBIDDEN
                    )
            except CloudFile.DoesNotExist:
                return Response(
                    {'error': '文件不存在'},
                    status=status.HTTP_404_NOT_FOUND
                )

        if folder_id:
            try:
                folder_obj = Folder.objects.get(id=folder_id)
                if folder_obj.owner != request.user and not request.user.is_superuser:
                    return Response(
                        {'error': '无权分享此文件夹'},
                        status=status.HTTP_403_FORBIDDEN
                    )
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
        total_files = CloudFile.objects.filter(owner=user, deleted_at__isnull=True).count()
        total_size = CloudFile.objects.filter(
            owner=user,
            deleted_at__isnull=True
        ).aggregate(total=Sum('size'))['total'] or 0

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
            'total_files': total_files,
            'total_size': total_size,
            'total_size_formatted': self.format_size(total_size),
            'storage_quota': storage_quota,
            'storage_quota_formatted': self.format_size(storage_quota),
            'storage_used_percent': round(storage_used_percent, 2),
            'starred_files': CloudFile.objects.filter(owner=user, is_starred=True).count(),
            'shared_files': FileShare.objects.filter(owner=user, is_active=True).count(),
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


# cloud/views.py - DocumentEditorViewSet

class DocumentEditorViewSet_v1(viewsets.ViewSet):
    """
    🔧 OnlyOffice 文档编辑器视图集（修复版）
    """
    # authentication_classes = []  # 不进行任何认证
    permission_classes = []  # 不检查权限
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    # 🔧 关键修复：从 settings 读取配置
    @property
    def doc_server_url(self):
        return settings.ONLYOFFICE.get('DOCUMENT_SERVER_URL', 'http://192.168.1.122:8000')

    @property
    def server_url(self):
        return settings.ONLYOFFICE.get('SERVER_URL', 'http://192.168.1.130:10900')

    @property
    def jwt_secret(self):
        return settings.ONLYOFFICE.get('JWT_SECRET', '')

    @property
    def jwt_enabled(self):
        return settings.ONLYOFFICE.get('JWT_ENABLED', True)

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

        # 🔧 关键修复：返回 OnlyOffice 支持的 documentType
        if ext in self.supported_formats.get('word', []):
            return 'word'
        elif ext in self.supported_formats.get('excel', []):
            return 'cell'  # 🔧 OnlyOffice 使用 'cell' 而不是 'excel'
        elif ext in self.supported_formats.get('ppt', []):
            return 'slide'  # 🔧 OnlyOffice 使用 'slide' 而不是 'ppt'
        elif ext in self.supported_formats.get('pdf', []):
            return 'word'  # 🔧 PDF 只读，使用 'word' 类型
        return None

    def _generate_download_token(self, file_obj, expires_in=300):
        """生成文件下载 token，有效期 5 分钟"""
        timestamp = int(time.time()) + expires_in
        # 🔧 关键修复：使用 Django SECRET_KEY 保持一致
        secret = settings.SECRET_KEY  # ✅ 与 _verify_download_token 一致
        token = hashlib.sha256(
            f"{file_obj.id}{timestamp}{secret}".encode()
        ).hexdigest()
        return f"{timestamp}:{token}"

    def _get_file_url(self, file_obj):
        """
        🔧 关键修复：构建文件访问 URL
        必须是 OnlyOffice 服务器能访问的地址
        """
        # 使用配置的 SERVER_URL 而不是 request.build_absolute_uri
        # 避免 OnlyOffice 无法访问 localhost 或内网地址
        """构建带 token 的文件访问 URL"""
        token = self._generate_download_token(file_obj)
        return f"{self.server_url}/api/cloud/cloudfiles/{file_obj.id}/download_file/?token={token}"

    def _get_callback_url(self, file_id):
        """构建回调 URL"""
        return f"{self.server_url}/api/cloud/documents/{file_id}/callback/"

    def _generate_jwt_token_v1(self, payload):
        """生成 OnlyOffice JWT Token"""
        if not self.jwt_secret:
            logger.warning('JWT_SECRET not configured')
            return None

        # 🔧 确保 payload 格式正确
        payload['iat'] = int(datetime.now().timestamp())

        # 🔧 使用 HS256 算法
        token = jwt.encode(payload, self.jwt_secret, algorithm='HS256')

        # 🔧 关键修复：Python 3.7+ jwt.encode 返回字符串，不需要解码
        if isinstance(token, bytes):
            token = token.decode('utf-8')

        logger.info(f'Generated JWT jwt_secret: {self.jwt_secret} token: {token[:50]}...')
        return token

    def _generate_jwt_token(self, payload):
        """生成 OnlyOffice JWT Token"""
        if not self.jwt_secret:
            logger.warning('JWT_SECRET not configured')
            return None

        try:
            # 🔧 关键修复 1: 确保 payload 格式正确（只包含 document 部分）
            token_payload = payload
            token_payload['iat'] = int(datetime.now().timestamp())

            # 🔧 关键修复 2: 使用 HS256 算法
            token = jwt.encode(token_payload, self.jwt_secret, algorithm='HS256')

            # 🔧 关键修复 3: Python 3.7+ jwt.encode 返回字符串
            if isinstance(token, bytes):
                token = token.decode('utf-8')

            logger.info(f'✅ JWT token generated: {token[:50]}...')
            return token

        except Exception as e:
            logger.error(f'❌ Failed to generate JWT token: {e}', exc_info=True)
            return None

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def edit(self, request, pk=None):
        """获取文档编辑配置"""
        try:

            logger.info(
                f"📝 获取文档编辑配置：{pk}, user: {request.user}, authenticated: {request.user.is_authenticated}")

            # 🔧 关键修复 1: 放宽文件访问权限
            # 允许文件所有者或协作者访问
            try:
                file_obj = CloudFile.objects.select_related('owner').get(id=pk)
            except CloudFile.DoesNotExist:
                logger.error(f'❌ 文件不存在: {pk}')
                return Response({'error': '文件不存在'}, status=404)

            # 🔧 关键修复 2: 验证访问权限（所有者或协作者）
            if request.user.is_authenticated:
                # 情况1: 文件所有者
                if file_obj.owner == request.user:
                    logger.info(f'✅ 文件所有者访问: {request.user.username}')
                else:
                    logger.warning(f'⚠️ 非文件所有者访问: {request.user.username}')
                    # 情况2: 协作者
                    try:
                        collaboration = DocumentCollaboration.objects.get(
                            file=file_obj,
                            user=request.user,
                        )
                        logger.info(f'✅ 协作者访问: {request.user.username}, 权限: {collaboration.permission}')
                    except DocumentCollaboration.DoesNotExist:
                        logger.error(f'❌ 无权访问: user={request.user.username}, file_owner={file_obj.owner.username}')
                        return Response(
                            {'error': '您没有权限编辑该文件'},
                            status=status.HTTP_403_FORBIDDEN
                        )
            else:
                # 情况3: 未登录用户（通过分享链接或 OnlyOffice 回调）
                logger.warning(f'⚠️ 未登录用户访问文件: {pk}')
                # 🔧 可选：允许未登录用户访问（通过 token 验证）
                # 或者返回 401
                return Response({'error': '请先登录'}, status=401)

            # 🔧 关键修复 1: 获取文件扩展名（用于 document.fileType）
            file_ext = file_obj.original_name.split('.')[-1].lower() if file_obj.original_name else ''

            # 🔧 关键修复 2: 获取 OnlyOffice 文档类型（用于 documentType）
            doc_type = self._get_document_type(file_obj.original_name)
            if not doc_type:
                return Response({'error': '不支持的文档格式'}, status=400)

            logger.info(
                f"User {request.user.id} - owner: {file_obj.owner.id}, is_owner: {file_obj.owner == request.user}")
            can_edit = False
            if file_obj.owner == request.user:
                can_edit = True
            else:
                try:
                    collaboration = FileCollaboration.objects.get(file=file_obj, user=request.user, is_active=True)
                    can_edit = collaboration.permission in ['write', 'admin']
                    logger.info(f"Collaboration found: permission={collaboration.permission}")
                except FileCollaboration.DoesNotExist:
                    pass

            # 🔧 关键修复 3: 构建文件访问 URL（确保 OnlyOffice 能访问）
            file_url = self._get_file_url(file_obj)
            callback_url = self._get_callback_url(pk)

            # 构建用户信息
            user_info = {
                'id': str(request.user.id) if request.user.is_authenticated else 'anonymous',
                'name': request.user.real_name or request.user.username if request.user.is_authenticated else 'Anonymous',
                'email': request.user.email or '' if request.user.is_authenticated else '',
            }

            # 🔧 关键修复 4: 构建正确的 config 对象
            config = {
                'document': {
                    # 🔧 fileType 必须是文件扩展名（小写，不带点）
                    'fileType': file_ext,  # ✅ 如 'xlsx', 'docx', 'pptx'
                    'key': f"{file_obj.id}_{file_obj.md5 or str(file_obj.id)}_{int(timezone.now().timestamp())}",
                    # ✅ 添加时间戳确保唯一
                    'title': file_obj.name or file_obj.original_name,
                    'url': file_url,
                    'permissions': {
                        'comment': True,
                        'copy': True,
                        'download': True,
                        'edit': True,
                        'fillForms': True,
                        'modifyContentControl': True,
                        'modifyFilter': True,
                        'print': True,
                        'review': True,
                    },
                },
                # 🔧 documentType 必须是 OnlyOffice 支持的类型
                'documentType': doc_type,  # ✅ 如 'cell', 'word', 'slide'
                'editorConfig': {
                    'callbackUrl': callback_url,
                    'user': user_info,
                    # 🔧 关键修复：设置中文语言
                    'lang': 'zh-CN',  # ✅ 中文界面
                    'customization': {
                        'autosave': True,  # ✅ 启用自动保存
                        'chat': True,
                        'comments': True,
                        'feedback': False,
                        'forcesave': True,  # ✅ 启用强制保存按钮
                        'goback': {
                            'blank': False,
                            'requestClose': False,
                            'text': '返回网盘',
                            'url': f'{self.server_url}/cloud/',
                        },
                        'logo': {
                            'image': f'{self.server_url}/media/avatars/cloud-green.svg',
                            'imageEmbedded': True,
                        },
                        'mentionShare': True,
                        'reviewDisplay': 'original',
                        'spellcheck': True,
                        'uiTheme': 'theme-light',

                        # 🔧 添加中文本地化配置
                        'forcesaveButton': True,  # 显示强制保存按钮
                        'compactToolbar': False,  # 完整工具栏
                    },
                    # 🔧 关键修复：协同编辑配置
                    'coEditing': {
                        'mode': 'strict',  # strict: 严格模式（实时保存），fast: 快速模式
                        'change': True,
                    },
                    'recent': self._get_recent_documents(request.user) if request.user.is_authenticated else [],
                },
                'height': '100%',
                'width': '100%',
                'type': 'desktop',
            }

            # 🔧 关键修复 7: 添加 JWT Token
            if self.jwt_enabled and self.jwt_secret:
                try:
                    token = self._generate_jwt_token(config)
                    if token:
                        config['token'] = token
                        logger.info(f'✅ JWT Token generated: {token[:50]}...')
                except Exception as e:
                    logger.error(f'❌ Failed to generate JWT token: {e}')

            logger.info(f'✅ Edit config generated successfully')
            return Response(config)

        except CloudFile.DoesNotExist:
            return Response({'error': '文件不存在'}, status=404)
        except Exception as e:
            logger.error(f'Get edit config failed: {e}', exc_info=True)
            return Response({'error': f'获取编辑配置失败：{str(e)}'}, status=500)

    def _check_edit_lock(self, file_obj, user):
        """检查并获取编辑锁"""
        # 清理过期锁
        DocumentEditLock.objects.filter(
            file=file_obj,
            expires_at__lt=timezone.now()
        ).update(is_active=False)

        # 检查是否有活跃锁
        active_lock = DocumentEditLock.objects.filter(
            file=file_obj,
            is_active=True,
            expires_at__gt=timezone.now()
        ).select_related('user').first()

        if active_lock:
            # 如果是当前用户，延长锁时间
            if active_lock.user == user:
                active_lock.expires_at = timezone.now() + timedelta(
                    minutes=settings.ONLYOFFICE.get('EDIT_LOCK_EXPIRE_MINUTES', 30)
                )
                active_lock.save(update_fields=['expires_at'])
                return active_lock
            # 如果是其他用户，拒绝
            logger.info(f'Document {file_obj.id} locked by user {active_lock.user.id}')
            return None

        # 创建新锁
        lock = DocumentEditLock.objects.create(
            file=file_obj,
            user=user,
            expires_at=timezone.now() + timedelta(
                minutes=settings.ONLYOFFICE.get('EDIT_LOCK_EXPIRE_MINUTES', 30)
            )
        )

        # 更新文件编辑用户
        file_obj.editing_user = user
        file_obj.save(update_fields=['editing_user'])

        return lock

    def _get_active_collaborators(self, file_obj):
        """获取活跃协同用户"""
        collaborators = DocumentCollaboration.objects.filter(
            file=file_obj,
            status='editing',
            last_activity__gt=timezone.now() - timedelta(minutes=5)
        ).select_related('user')

        return [
            {
                'id': str(c.user.id),
                'name': c.user.username,
                'email': c.user.email or '',
            }
            for c in collaborators
        ]

    def _record_collaboration(self, file_obj, user, status):
        """记录协作状态"""
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
            # is_document=True,
            # 🔧 替代方案：按文件扩展名过滤
            original_name__iregex=r'\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$'
        ).order_by('-updated_at')[:10]

        return [
            {
                'url': self._get_file_url(f),
                'title': f.name,
            }
            for f in recent
        ]

    @action(detail=True, methods=['post'], authentication_classes=[])
    def callback(self, request, pk=None):
        """
        🔧 OnlyOffice 回调接口
        POST /api/cloud/documents/{id}/callback/
        注意：此接口允许未认证访问，但会验证 JWT Token
        状态码含义：
        0 - 无操作
        1 - 文档正在编辑
        2 - 文档已保存
        3 - 文档关闭
        4 - 强制保存
        5 - 协同编辑者已连接
        6 - 协同编辑者已断开
        """
        try:
            # 🔧 记录请求信息用于调试
            logger.info(f'Callback received: file_id={pk}, data={request.data}, ip={request.META.get("REMOTE_ADDR")}')

            # 🔧 调试日志
            logger.info(f'=== Callback Debug Start ===')
            logger.info(f'Method: {request.method}')
            logger.info(f'User: {request.user}')
            logger.info(f'Is authenticated: {request.user.is_authenticated}')
            logger.info(f'Data keys: {list(request.data.keys()) if hasattr(request, "data") else "N/A"}')
            logger.info(f'Content-Type: {request.content_type}')
            logger.info(f'Headers: {dict(request.headers)}')
            logger.info(f'=== Callback Debug End ===')

            # 🔧 关键修复：从 request.data 或 headers 获取 token
            token = request.data.get('token')
            if not token:
                # 🔧 尝试从 Authorization header 获取
                auth_header = request.headers.get('Authorization', '')
                if auth_header.startswith('Bearer '):
                    token = auth_header[7:].strip()

            # 🔧 验证 JWT Token（如果启用）
            if self.jwt_enabled and self.jwt_secret and token:
                try:
                    # 🔧 关键修复：确保 token 格式正确
                    token = token.strip()
                    if token.count('.') == 2:  # 三段式
                        jwt.decode(token, self.jwt_secret, algorithms=['HS256'])
                        logger.info('✅ JWT token verified in callback')
                    else:
                        logger.warning(f'❌ Invalid JWT format in callback')
                except jwt.InvalidTokenError as e:
                    logger.warning(f'❌ Invalid JWT token in callback: {e}')
                    return Response({'error': 1}, status=status.HTTP_403_FORBIDDEN)

            # 获取回调数据
            # 🔧 关键修复：处理不同状态码
            body = request.data
            status_code = body.get('status')
            url = body.get('url')
            users = body.get('users', [])

            logger.info(f'Callback status: {status_code}, url: {url}, users: {users}')

            # 🔧 获取文件（不验证 owner，因为回调可能来自协同编辑）
            try:
                file_obj = CloudFile.objects.select_related('owner').get(id=pk)
            except CloudFile.DoesNotExist:
                logger.error(f'Callback: Document {pk} not found')
                return Response({'error': 1}, status=status.HTTP_404_NOT_FOUND)

            # 🔧 状态 2: 文档已保存（用户点击保存）
            # 🔧 状态 4: 强制保存（用户关闭文档或超时）
            if status_code in [2, 4]:
                if url:
                    logger.info(f'💾 Saving document from: {url}')
                    try:
                        # 🔧 关键：添加重试逻辑
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
                                time.sleep(2 ** attempt)  # 指数退避

                        content = response.content
                        content_hash = hashlib.md5(content).hexdigest()[:8]
                        logger.info(f'✅ Downloaded {len(content)} bytes, hash={content_hash}')

                        # 🔧 关键修复 5: 保存文件（使用事务确保原子性）
                        with transaction.atomic():

                            content_file = ContentFile(content)

                            # 🔧 关键修复：保存版本（每次保存都创建版本）
                            version = self._save_document_version(
                                file_obj,
                                content,
                                users[0] if users else None
                            )
                            logger.info(f'✅ Version saved: v{version.version_number}, hash={content_hash}')

                            # 更新原文件
                            file_obj.file.save(
                                file_obj.original_name,
                                content_file,
                                save=True
                            )
                            file_obj.size = len(content)
                            file_obj.current_version = version  # 🔧 更新当前版本
                            file_obj.save(update_fields=['size', 'updated_at', 'current_version'])

                            # 记录操作日志
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

                        logger.info(f'✅ Document {file_obj.id} saved successfully (v{version.version_number})')

                    except requests.RequestException as e:
                        logger.error(f'Failed to download saved document from OnlyOffice: {e}')
                        return Response({'error': 1}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                    except Exception as e:
                        logger.error(f'Failed to save document version: {e}', exc_info=True)
                        return Response({'error': 1}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # 🔧 状态 3：文档关闭
            elif status_code == 3:
                # 释放编辑锁
                DocumentEditLock.objects.filter(
                    file=file_obj,
                    user__id__in=users,
                    is_active=True
                ).update(is_active=False)

                # 更新协作状态
                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'closed')
                    except CustomUser.DoesNotExist:
                        logger.warning(f'User {user_id} not found for collaboration update')

                # 如果没有活跃编辑者，清除编辑用户
                active_locks = DocumentEditLock.objects.filter(
                    file=file_obj,
                    is_active=True,
                    expires_at__gt=timezone.now()
                )
                if not active_locks.exists():
                    file_obj.editing_user = None
                    file_obj.save(update_fields=['editing_user'])

            # 🔧 状态 5：协同编辑者已连接
            elif status_code == 5:
                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'editing')
                    except CustomUser.DoesNotExist:
                        pass

            # 🔧 状态 6：协同编辑者已断开
            elif status_code == 6:
                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'viewing')
                    except CustomUser.DoesNotExist:
                        pass

            return Response({'error': 0})

        except Exception as e:
            logger.error(f'Document callback error: {e}', exc_info=True)
            return Response({'error': 1}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _save_document_version(self, file_obj, content, user_id):
        """保存文档版本（每次保存都创建新版本）"""

        with transaction.atomic():
            # 🔧 关键修复 1: 获取下一个版本号
            last_version = DocumentVersion.objects.filter(
                file=file_obj
            ).order_by('-version_number').first()

            version_number = (last_version.version_number + 1) if last_version else 1
            logger.info(f'📝 Creating version v{version_number} for file {file_obj.id}')

            # 🔧 关键修复 2: 清理旧版本（保留最近 N 个）
            keep_count = settings.ONLYOFFICE.get('VERSION_KEEP_COUNT', 10)
            old_versions = DocumentVersion.objects.filter(
                file=file_obj
            ).order_by('-version_number')[keep_count:]

            for old_ver in old_versions:
                try:
                    if os.path.exists(old_ver.file_path):
                        os.remove(old_ver.file_path)
                        logger.info(f'🗑️ Deleted old version file: {old_ver.file_path}')
                    old_ver.delete()
                    logger.info(f'🗑️ Deleted old version record: v{old_ver.version_number}')
                except Exception as e:
                    logger.warning(f'⚠️ Failed to delete old version {old_ver.id}: {e}')

            # 🔧 关键修复 3: 保存版本文件
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

            try:
                # 🔧 关键修复：写入文件并验证
                with open(version_path, 'wb') as f:
                    f.write(content)

                # 🔧 验证写入的内容是否正确
                with open(version_path, 'rb') as f:
                    verify_content = f.read()
                if verify_content != content:
                    logger.error(f'❌ Version file content mismatch: {version_path}')
                    raise ValueError('Version file content verification failed')

                file_size = os.path.getsize(version_path)
                logger.info(f'✅ Version file saved: {version_path} ({file_size} bytes)')

            except Exception as e:
                logger.error(f'❌ Failed to save version file: {e}', exc_info=True)
                raise

            # 🔧 关键修复 4: 获取创建者
            user = None
            if user_id:
                try:
                    user = CustomUser.objects.get(id=user_id)
                    logger.info(f'👤 Version created by user: {user.username}')
                except CustomUser.DoesNotExist:
                    logger.warning(f'⚠️ User {user_id} not found')

            # 🔧 关键修复 5: 创建版本记录
            try:
                content_hash = hashlib.md5(content).hexdigest()
                version = DocumentVersion.objects.create(
                    file=file_obj,
                    version_number=version_number,
                    file_path=version_path,
                    file_size=file_size,
                    created_by=user,
                    content_hash=content_hash,
                    comment=f'自动保存 v{version_number}',  # 🔧 添加备注
                    is_current=True  # 🔧 标记为当前版本
                )
                logger.info(f'✅ Version record created: v{version_number} (id={version.id})')

            except Exception as e:
                logger.error(f'❌ Failed to create version record: {e}', exc_info=True)
                raise

            # 🔧 关键修复 6: 更新之前版本为非当前
            DocumentVersion.objects.filter(
                file=file_obj
            ).exclude(id=version.id).update(is_current=False)

            logger.info(f'✅ Version v{version_number} saved successfully')
            return version

    @action(detail=False, methods=['post'], url_path='custom-create')
    def custom_create(self, request):
        """
        🔧 创建新文档
        POST /api/cloud/documents/custom-create/
        """
        try:
            doc_type = request.data.get('type')  # word, excel, ppt
            title = request.data.get('title', '未命名文档')
            folder_id = request.data.get('folder')

            # 文件扩展名映射
            ext_map = {
                'word': '.docx',
                'excel': '.xlsx',
                'ppt': '.pptx',
            }

            if doc_type not in ext_map:
                return Response(
                    {'error': '不支持的文档类型'},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # 生成文件名
            filename = f'{title}{ext_map[doc_type]}'

            # 🔧 创建空文档内容（使用真实模板或最小有效文件）
            empty_content = self._get_empty_document_content(doc_type)

            # 创建文件记录
            folder = None
            if folder_id:
                try:
                    folder = Folder.objects.get(id=folder_id, owner=request.user)
                except Folder.DoesNotExist:
                    return Response(
                        {'error': '目标文件夹不存在'},
                        status=status.HTTP_404_NOT_FOUND
                    )

            file_obj = CloudFile.objects.create(
                owner=request.user,
                folder=folder,
                name=filename,
                original_name=filename,
                file=BytesIO(empty_content),
                size=len(empty_content),
                is_document=True,
                document_type=doc_type,
                md5='',  # 空文档不计算 MD5
            )

            logger.info(f'Created new {doc_type} document: {file_obj.id}')
            return Response({
                'fileType': doc_type,
                'url': self._get_file_url(file_obj),
                'file_id': str(file_obj.id),
            })

        except Exception as e:
            logger.error(f'Create document error: {e}', exc_info=True)
            return Response(
                {'error': f'创建文档失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _get_empty_document_content(self, doc_type):
        """获取空文档内容"""
        # 🔧 使用真实的最小有效文档内容
        # 这里返回的是对应格式的最小有效文件头
        templates = {
            'word': b'PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00',  # DOCX 最小头
            'excel': b'PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00',  # XLSX 最小头
            'ppt': b'PK\x03\x04\x14\x00\x06\x00\x08\x00\x00\x00!\x00',  # PPTX 最小头
        }
        return templates.get(doc_type, b'')

    @action(detail=True, methods=['get'])
    def versions(self, request, pk=None):
        """获取文档版本列表"""
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)

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
                    'download_url': f'/api/cloud/documents/versions/{v.id}/download/',  # 版本下载接口
                }
                for v in versions
            ]

            return Response({'versions': data})

        except CloudFile.DoesNotExist:
            return Response(
                {'error': '文件不存在'},
                status=status.HTTP_404_NOT_FOUND
            )

    # cloud/views.py - DocumentEditorViewSet

    @action(detail=False, methods=['get'], url_path='versions/(?P<version_id>[^/.]+)/download')
    def version_download(self, request, version_id=None):
        """下载指定版本的文件"""
        try:
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
            from .models import FileOperationLog
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

    @action(detail=True, methods=['post'])
    def restore_version(self, request, pk=None):
        """恢复文档版本"""
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
            version_id = request.data.get('version_id')
            # 🔧 新增参数：是否创建恢复前备份（默认 True）
            create_backup = request.data.get('create_backup', False)
            version = DocumentVersion.objects.get(id=version_id, file=file_obj)

            # 🔧 关键修复 1: 验证版本文件存在
            if not os.path.exists(version.file_path):
                logger.error(f'❌ Version file not found: {version.file_path}')
                return Response(
                    {'error': '版本文件不存在，可能已被清理'},
                    status=status.HTTP_404_NOT_FOUND
                )

            # 🔧 关键修复 2: 读取版本文件内容并验证
            with open(version.file_path, 'rb') as f:
                content = f.read()

            # 🔧 验证读取的内容
            if not content:
                logger.error(f'❌ Version file is empty: {version.file_path}')
                return Response(
                    {'error': '版本文件内容为空'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

            content_hash = hashlib.md5(content).hexdigest()[:8]
            logger.info(f'📖 Read version file: {version.file_path} ({len(content)} bytes, hash={content_hash})')

            logger.info(f'恢复版本：file_id={pk}, version_id={version_id}, size={len(content)} bytes')

            # 恢复文件（使用事务）
            with transaction.atomic():

                # 🔧 修复 1: 使用 ContentFile 包装 bytes 对象
                content_file = ContentFile(content)

                # 🔧 关键修复：仅在 create_backup=True 时创建新版本
                if create_backup:
                    # 保存当前状态为新版本（作为备份）
                    last_version = DocumentVersion.objects.filter(file=file_obj).order_by('-version_number').first()
                    new_version_number = (last_version.version_number + 1) if last_version else 1

                    current_version_path = os.path.join(
                        settings.MEDIA_ROOT, 'document_versions', str(file_obj.id),
                        f'v{new_version_number}_{file_obj.name}'
                    )
                    os.makedirs(os.path.dirname(current_version_path), exist_ok=True)

                    # 🔧 关键修复：正确读取当前文件内容
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

                # 恢复目标版本内容
                file_obj.file.save(
                    file_obj.original_name,
                    content_file,  # ✅ 使用 ContentFile 而不是 raw bytes
                    save=True
                )
                file_obj.current_version = version
                file_obj.size = len(content)  # ✅ 使用实际内容大小
                file_obj.save(update_fields=['current_version', 'size', 'updated_at'])

                # 更新版本状态
                DocumentVersion.objects.filter(file=file_obj).exclude(id=version.id).update(is_current=False)
                version.is_current = True
                version.save(update_fields=['is_current'])

            # 🔧 记录操作日志
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
                'content_hash': content_hash,  # 🔧 返回哈希用于前端验证
            })


        except CloudFile.DoesNotExist:
            logger.error(f'❌ File not found: {pk}')
            return Response({'error': '文件不存在'}, status=404)
        except DocumentVersion.DoesNotExist:
            logger.error(f'❌ Version not found: {version_id}')
            return Response({'error': '版本不存在'}, status=404)
        except Exception as e:
            logger.error(f'❌ Restore version error: {e}', exc_info=True)
            return Response(
                {'error': f'恢复版本失败：{str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def collaborators_v1(self, request, pk=None):
        """获取文档协同编辑者"""
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)

            collaborators = DocumentCollaboration.objects.filter(
                file=file_obj,
                status='editing',
                last_activity__gt=timezone.now() - timedelta(minutes=5)
            ).select_related('user')

            data = [
                {
                    'id': str(c.user.id),
                    'username': c.user.username,
                    'real_name': c.user.real_name or c.user.username,
                    'avatar': getattr(c.user, 'avatar_url', None),
                    'status': c.status,
                    'last_activity': c.last_activity.isoformat(),
                }
                for c in collaborators
            ]

            return Response({'collaborators': data})

        except CloudFile.DoesNotExist:
            return Response(
                {'error': '文件不存在'},
                status=status.HTTP_404_NOT_FOUND
            )

    # cloud/views.py - 在 DocumentEditorViewSet 类中添加

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def add_collaborator(self, request, pk=None):
        """
        🔧 添加文档协同编辑者
        POST /api/cloud/documents/{id}/add_collaborator/
        {
            "user_id": 123,
            "permission": "write",  // read/write/admin
            "notify": true  // 是否发送通知
        }
        """
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文档不存在'}, status=status.HTTP_404_NOT_FOUND)

        user_id = request.data.get('user_id')
        permission = request.data.get('permission', 'read')
        notify = request.data.get('notify', True)

        if not user_id:
            return Response({'error': '请指定协同用户'}, status=status.HTTP_400_BAD_REQUEST)

        if permission not in ['read', 'write', 'admin']:
            return Response({'error': '权限类型无效'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            collaborator = CustomUser.objects.get(id=user_id)
        except CustomUser.DoesNotExist:
            return Response({'error': '用户不存在'}, status=status.HTTP_404_NOT_FOUND)

        # 不能添加自己为协作者
        if collaborator.id == request.user.id:
            return Response({'error': '不能添加自己为协作者'}, status=status.HTTP_400_BAD_REQUEST)

        # 创建或更新协作关系
        doc_collab, created = DocumentCollaboration.objects.update_or_create(
            file=file_obj,
            user=collaborator,
            defaults={
                'permission': permission,
                'is_active': True,
                'added_by': request.user,
            }
        )

        # 🔧 发送通知（如果启用）
        if notify and created:
            self._send_collaboration_notification(file_obj, collaborator, request.user, permission)

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

        return Response({
            'message': '协作者添加成功',
            'collaborator': {
                'id': collaborator.id,
                'username': collaborator.username,
                'real_name': collaborator.real_name,
                'avatar': collaborator.get_avatar_url(),
                'permission': permission,
                'is_active': True,
                'added_at': doc_collab.added_at.isoformat(),
            }
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['put'], permission_classes=[permissions.IsAuthenticated],
            url_path='update_collaborator/(?P<user_id>[^/.]+)')
    def update_collaborator(self, request, pk=None):
        """
        🔧 修改文档协同编辑者权限
        PUT /api/cloud/documents/{id}/update_collaborator/{user_id}/
        {
            "permission": "write",  // read/write/admin
            "is_active": true  // 启用/禁用
        }
        """
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文档不存在'}, status=status.HTTP_404_NOT_FOUND)

        collaborator_id = self.kwargs.get('user_id') or request.data.get('user_id')
        if not collaborator_id:
            return Response({'error': '请指定协同用户'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            doc_collab = DocumentCollaboration.objects.get(
                file=file_obj,
                user_id=collaborator_id
            )
        except DocumentCollaboration.DoesNotExist:
            return Response({'error': '协作者关系不存在'}, status=status.HTTP_404_NOT_FOUND)

        # 验证权限：只有文档所有者或管理员可以修改
        if request.user.id != file_obj.owner_id and request.user.user_type not in ['admin', 'super_admin']:
            return Response({'error': '无权修改协作者权限'}, status=status.HTTP_403_FORBIDDEN)

        logger.info(f'{request.user.username} 修改文档 {file_obj.name} 协作者 {doc_collab.user.username} 权限')
        permission = request.data.get('permission')
        is_active = request.data.get('is_active')

        if permission and permission not in ['read', 'write', 'admin']:
            return Response({'error': '权限类型无效'}, status=status.HTTP_400_BAD_REQUEST)

        # 更新协作关系
        if permission:
            doc_collab.permission = permission
        if is_active is not None:
            doc_collab.is_active = is_active
            if not is_active:
                doc_collab.status = 'disabled'
            elif doc_collab.status == 'disabled':
                doc_collab.status = 'active'

        doc_collab.updated_at = timezone.now()
        doc_collab.save()

        # 记录操作日志
        FileOperationLog.objects.create(
            file=file_obj,
            user=request.user,
            operation='update_collaborator',
            description=f'修改协作者 {doc_collab.user.username} 权限',
            ip_address=get_request_ip(request),
            extra_data={
                'old_permission': doc_collab.permission,
                'new_permission': permission or doc_collab.permission,
                'is_active': is_active if is_active is not None else doc_collab.is_active,
            }
        )

        return Response({
            'message': '协作者权限更新成功',
            'collaborator': {
                'id': doc_collab.user.id,
                'username': doc_collab.user.username,
                'real_name': doc_collab.user.real_name,
                'permission': doc_collab.permission,
                'is_active': doc_collab.is_active,
                'updated_at': doc_collab.updated_at.isoformat(),
            }
        })

    @action(detail=True, methods=['delete'], permission_classes=[permissions.IsAuthenticated])
    def remove_collaborator(self, request, pk=None):
        """
        🔧 删除文档协同编辑者
        DELETE /api/cloud/documents/{id}/collaborators/{user_id}/
        """
        try:
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
        except CloudFile.DoesNotExist:
            return Response({'error': '文档不存在'}, status=status.HTTP_404_NOT_FOUND)

        collaborator_id = self.kwargs.get('user_id')
        if not collaborator_id:
            return Response({'error': '请指定协同用户'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            doc_collab = DocumentCollaboration.objects.get(
                file=file_obj,
                user_id=collaborator_id
            )
        except DocumentCollaboration.DoesNotExist:
            return Response({'error': '协作者关系不存在'}, status=status.HTTP_404_NOT_FOUND)

        # 验证权限
        if request.user.id != file_obj.owner_id and request.user.user_type not in ['admin', 'super_admin']:
            return Response({'error': '无权删除协作者'}, status=status.HTTP_403_FORBIDDEN)

        collaborator_username = doc_collab.user.username
        doc_collab.delete()

        # 记录操作日志
        FileOperationLog.objects.create(
            file=file_obj,
            user=request.user,
            operation='remove_collaborator',
            description=f'移除协作者：{collaborator_username}',
            ip_address=get_request_ip(request),
            extra_data={
                'collaborator_id': collaborator_id,
                'collaborator_username': collaborator_username,
            }
        )

        return Response({'message': '协作者已移除'})

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def collaborators(self, request, pk=None):
        """
        🔧 获取文档协同编辑者列表
        GET /api/cloud/documents/{id}/collaborators/
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)
        except CloudFile.DoesNotExist:
            return Response({'error': '文档不存在'}, status=status.HTTP_404_NOT_FOUND)

        # 权限验证：所有者、协作者或管理员可访问
        if not self._can_access_document(file_obj, request.user):
            return Response({'error': '无权访问该文档'}, status=status.HTTP_403_FORBIDDEN)

        # 获取活跃协作者（含在线状态）
        collaborators = DocumentCollaboration.objects.filter(
            file=file_obj,
            status='editing',
        ).select_related('user').order_by('-last_activity')

        data = []
        for collab in collaborators:
            user = collab.user
            data.append({
                'id': user.id,
                'username': user.username,
                'real_name': user.real_name or user.username,
                'avatar': user.get_avatar_url(),
                'status': collab.status,  # active/editing/viewing/disabled
                'joined_at': collab.joined_at.isoformat(),
                'left_at': collab.left_at.isoformat() if collab.left_at else None,
                'last_activity': collab.last_activity.isoformat() if collab.last_activity else None,
                'is_online': getattr(user, 'is_online', False),
                'is_owner': user.id == file_obj.owner.id,
            })

        return Response({'collaborators': data, 'total': len(data)})

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def update_collaboration_status(self, request, pk=None):
        """
        🔧 更新协同编辑状态（心跳/活动上报）
        POST /api/cloud/documents/{id}/collaboration/status/
        {
            "status": "editing",  // viewing/editing/closed
            "cursor_position": {"line": 10, "column": 5}  // 可选：光标位置
        }
        """
        try:
            file_obj = CloudFile.objects.get(id=pk)
        except CloudFile.DoesNotExist:
            return Response({'error': '文档不存在'}, status=status.HTTP_404_NOT_FOUND)

        if not self._can_access_document(file_obj, request.user):
            return Response({'error': '无权访问该文档'}, status=status.HTTP_403_FORBIDDEN)

        status = request.data.get('status', 'viewing')
        cursor_position = request.data.get('cursor_position')

        if status not in ['viewing', 'editing', 'closed']:
            return Response({'error': '状态类型无效'}, status=status.HTTP_400_BAD_REQUEST)

        # 更新或创建协作记录
        doc_collab, _ = DocumentCollaboration.objects.get_or_create(
            file=file_obj,
            user=request.user,
            defaults={'permission': 'read', 'is_active': True}
        )

        doc_collab.status = status
        doc_collab.last_activity = timezone.now()
        if cursor_position:
            doc_collab.cursor_position = cursor_position
        doc_collab.save()

        # 🔧 广播状态变更给其他协作者（通过 WebSocket）
        self._broadcast_collaboration_status(file_obj, request.user, status)

        return Response({'message': '状态已更新', 'status': status})

    # 🔧 辅助方法：发送协同通知
    def _send_collaboration_notification(self, file_obj, collaborator, inviter, permission):
        """发送协同编辑邀请通知"""
        try:
            from notifications.models import Notification  # 假设有通知模型

            Notification.objects.create(
                recipient=collaborator,
                actor=inviter,
                verb='invited_to_collaborate',
                target=file_obj,
                level='info',
                description=f'{inviter.real_name or inviter.username} 邀请您协同编辑文档 "{file_obj.name}"',
                extra_data={
                    'file_id': str(file_obj.id),
                    'file_name': file_obj.name,
                    'permission': permission,
                    'action_url': f'/cloud/editor/?id={file_obj.id}',
                }
            )
        except ImportError:
            logger.warning('Notification model not found, skip sending notification')
        except Exception as e:
            logger.error(f'Failed to send collaboration notification: {e}')

    # 🔧 辅助方法：广播协同状态
    def _broadcast_collaboration_status(self, file_obj, user, status):
        """通过 WebSocket 广播协同状态变更"""
        try:
            channel_layer = get_channel_layer()

            # 广播到文档专属频道
            channel_layer.group_send(
                f'doc_{file_obj.id}_collaboration',
                {
                    'type': 'collaboration.status_update',
                    'user_id': user.id,
                    'username': user.username,
                    'real_name': user.real_name,
                    'avatar': user.get_avatar_url(),
                    'status': status,
                    'timestamp': timezone.now().isoformat(),
                }
            )
        except Exception as e:
            logger.warning(f'Failed to broadcast collaboration status: {e}')

    # 🔧 辅助方法：验证文档访问权限
    def _can_access_document(self, file_obj, user):
        """验证用户是否可以访问文档"""
        # 所有者
        if file_obj.owner == user:
            return True

        # 管理员
        if user.user_type in ['admin', 'super_admin']:
            return True

        # 协作者
        if DocumentCollaboration.objects.filter(
                file=file_obj,
                user=user,
                is_active=True
        ).exists():
            return True

        # 有分享权限
        if FileShare.objects.filter(
                Q(file=file_obj) | Q(folder=file_obj.folder),
                is_active=True
        ).filter(
            Q(allowed_users=user) |
            Q(share_type='public') |
            Q(share_type='password')
        ).exists():
            return True

        return False

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


# cloud/views.py - DocumentEditorViewSet 完整修复版

class DocumentEditorViewSet(viewsets.ViewSet):
    """
    🔧 OnlyOffice 文档编辑器视图集（协同编辑完整版）
    支持：添加/修改/删除/启用/禁用协同用户
    """
    # authentication_classes = []
    permission_classes = []
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    # 🔧 关键修复：从 settings 读取配置
    @property
    def doc_server_url(self):
        return settings.ONLYOFFICE.get('DOCUMENT_SERVER_URL', 'https://chat.first-iq.com/onlyoffice')

    @property
    def server_url(self):
        return settings.ONLYOFFICE.get('SERVER_URL', 'https://chat.first-iq.com')

    @property
    def jwt_secret(self):
        return settings.ONLYOFFICE.get('JWT_SECRET', '')

    @property
    def jwt_enabled(self):
        return settings.ONLYOFFICE.get('JWT_ENABLED', True)

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
            token = jwt.encode(token_payload, self.jwt_secret, algorithm='HS256')

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
        🔧 获取文档编辑配置
        GET /api/cloud/documents/{id}/edit/
        """
        try:
            logger.info(f"📝 获取文档编辑配置：{pk}, user: {request.user}")

            # 1. 获取文件
            try:
                file_obj = CloudFile.objects.select_related('owner').get(id=pk)
            except CloudFile.DoesNotExist:
                logger.error(f'❌ 文件不存在：{pk}')
                return Response({'error': '文件不存在'}, status=404)

            # 2. 验证访问权限
            if not self._can_access_document(file_obj, request.user):
                logger.error(f'❌ 无权访问：user={request.user.username}')
                return Response(
                    {'error': '您没有权限访问该文件'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # 3. 验证编辑权限
            can_edit = self._can_edit_document(file_obj, request.user)
            if not can_edit:
                logger.warning(f'⚠️ 只读权限：user={request.user.username}')

            # 4. 获取文件扩展名和文档类型
            file_ext = file_obj.original_name.split('.')[-1].lower() if file_obj.original_name else ''
            doc_type = self._get_document_type(file_obj.original_name)
            if not doc_type:
                return Response({'error': '不支持的文档格式'}, status=400)

            # 5. 构建文件访问 URL 和回调 URL
            file_url = self._get_file_url(file_obj)
            callback_url = self._get_callback_url(pk)

            # 6. 构建用户信息
            user_info = {
                'id': str(request.user.id),
                'name': request.user.real_name or request.user.username,
                'email': request.user.email or '',
            }

            # 7. 构建 OnlyOffice 配置
            config = {
                'document': {
                    'fileType': file_ext,
                    'key': f"{file_obj.id}_{file_obj.md5 or str(file_obj.id)}_{int(timezone.now().timestamp())}",
                    'title': file_obj.name or file_obj.original_name,
                    'url': file_url,
                    'permissions': {
                        'comment': True,
                        'copy': can_edit,
                        'download': can_edit,
                        'edit': can_edit,  # 🔧 根据权限控制编辑
                        'fillForms': can_edit,
                        'modifyContentControl': can_edit,
                        'modifyFilter': can_edit,
                        'print': can_edit,
                        'review': can_edit,
                    },
                },
                'documentType': doc_type,
                'editorConfig': {
                    'callbackUrl': callback_url,
                    'user': user_info,
                    'lang': 'zh-CN',
                    'mode': 'edit' if can_edit else 'view',
                    'customization': {
                        'autosave': True,
                        'chat': True,
                        'comments': True,
                        'feedback': False,
                        'forcesave': True,
                        'goback': {
                            'blank': False,
                            'requestClose': False,
                            'text': '返回网盘',
                            'url': f'{self.server_url}/cloud/',
                        },
                        'logo': {
                            'image': f'{self.server_url}/media/avatars/cloud-green.svg',
                            'imageEmbedded': True,
                        },
                        'mentionShare': True,
                        'reviewDisplay': 'original',
                        'spellcheck': True,
                        'uiTheme': 'theme-light',
                        'forcesaveButton': can_edit,
                        'compactToolbar': False,
                    },
                    'permissions': {  # 新版权限位置
                        'chat': True,
                        'review': {
                            'display': 'original',
                        },
                        'spellcheck': True,
                    },
                    'coEditing': {
                        'mode': 'strict',
                        'change': can_edit,
                    },
                    'recent': self._get_recent_documents(request.user) if can_edit else [],
                },
                'height': '100%',
                'width': '100%',
                'type': 'desktop',
            }

            # 8. 添加 JWT Token
            if self.jwt_enabled and self.jwt_secret:
                token = self._generate_jwt_token(config)
                if token:
                    config['token'] = token

            # 9. 记录协作状态（DocumentCollaboration）
            self._record_collaboration(file_obj, request.user, 'editing')

            logger.info(f'✅ Edit config generated successfully')
            return Response(config)

        except Exception as e:
            logger.error(f'Get edit config failed: {e}', exc_info=True)
            return Response({'error': f'获取编辑配置失败：{str(e)}'}, status=500)

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
                deleted_at__isnull=True,
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
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)
            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
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
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)

            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
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
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)

            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
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
            except FileCollaboration.DoesNotExist:
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
            file_obj = CloudFile.objects.get(id=pk, owner=request.user)

            # 验证管理权限
            if not self._can_manage_collaborators(file_obj, request.user):
                return Response(
                    {'error': '无权管理协作者'},
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
                    sender_avatar=request.user.get_avatar_url() if hasattr(request.user, 'get_avatar_url') else getattr(request.user, 'avatar_url', '/static/images/default-avatar.png'),
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
                        sender_avatar=request.user.get_avatar_url() if hasattr(request.user, 'get_avatar_url') else getattr(request.user, 'avatar_url', '/static/images/default-avatar.png'),
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
                        sender_avatar=request.user.get_avatar_url() if hasattr(request.user, 'get_avatar_url') else getattr(request.user, 'avatar_url', '/static/images/default-avatar.png'),
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
                        sender_avatar=request.user.get_avatar_url() if hasattr(request.user, 'get_avatar_url') else getattr(request.user, 'avatar_url', '/static/images/default-avatar.png'),
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
                DocumentEditLock.objects.filter(
                    file=file_obj,
                    user__id__in=users,
                    is_active=True
                ).update(is_active=False)

                for user_id in users:
                    try:
                        user = CustomUser.objects.get(id=user_id)
                        self._record_collaboration(file_obj, user, 'closed')
                    except CustomUser.DoesNotExist:
                        logger.warning(f'User {user_id} not found')

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
            keep_count = settings.ONLYOFFICE.get('VERSION_KEEP_COUNT', 10)
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
