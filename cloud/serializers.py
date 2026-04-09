# -*- coding: utf-8 -*-
# @File   :serializers.py
# @Time   :2026/3/13 09:09
# @Author :admin


# cloud/serializers.py - 添加网盘序列化器

from django.conf import settings
from rest_framework import serializers
from .models import Folder, CloudFile, FileShare, FileComment, FileOperationLog, FileVersion
from accounts.models import CustomUser, Department
from loguru import logger


class FolderListSerializer(serializers.ModelSerializer):
    """🔧 文件夹列表序列化器（简化版，用于列表展示）"""
    file_count = serializers.SerializerMethodField()
    permanently_deleted = serializers.BooleanField(read_only=True)

    # 🔧 添加路径字段（用于面包屑和缩进）
    path = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = [
            'id', 'name', 'parent', 'is_public', 'is_shared',
            'file_count', 'created_at', 'updated_at', 'permanently_deleted',
            'path',  # 🔧 新增字段
        ]
        read_only_fields = ['created_at', 'updated_at']

    def get_file_count(self, obj):
        """获取文件夹内的文件数量（不包含子文件夹）"""
        return obj.files.filter(deleted_at__isnull=True).count()

    def get_path(self, obj):
        """🔧 获取文件夹的完整路径（用于前端显示）"""
        path_parts = []
        current = obj
        while current and current.parent:
            path_parts.insert(0, current.parent.name)
            current = current.parent
        return '/'.join(path_parts) if path_parts else ''


class FolderSerializer(serializers.ModelSerializer):
    """🔧 文件夹详情序列化器"""
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    file_count = serializers.SerializerMethodField()
    total_size = serializers.SerializerMethodField()
    path = serializers.SerializerMethodField()
    children_count = serializers.SerializerMethodField()
    icon_class = serializers.SerializerMethodField()
    permanently_deleted = serializers.BooleanField(read_only=True)

    class Meta:
        model = Folder
        fields = [
            'id', 'name', 'parent', 'owner', 'owner_name',
            'department', 'department_name', 'is_public', 'is_shared',
            'file_count', 'total_size', 'path', 'children_count', 'icon_class',
            'created_at', 'updated_at', 'deleted_at', 'permanently_deleted',
        ]
        read_only_fields = ['owner', 'created_at', 'updated_at']

    def get_file_count(self, obj):
        """获取文件夹内的文件总数（递归包含子文件夹）"""
        return obj.get_file_count()

    def get_total_size(self, obj):
        """获取文件夹总大小（递归包含子文件夹）"""
        return obj.get_size()

    def get_path(self, obj):
        """获取文件夹完整路径"""
        return obj.get_path()

    def get_children_count(self, obj):
        """获取直接子文件夹数量"""
        return obj.children.filter(deleted_at__isnull=True).count()

    def get_icon_class(self, obj):
        return 'fa-folder'


    def validate_name(self, value):
        """🔧 验证文件夹名称"""
        if not value or not value.strip():
            raise serializers.ValidationError('文件夹名称不能为空')
        if len(value) > 255:
            raise serializers.ValidationError('文件夹名称不能超过 255 个字符')
        # 禁止特殊字符
        if any(c in value for c in ['/', '\\', ':', '*', '?', '"', '<', '>', '|']):
            raise serializers.ValidationError('文件夹名称不能包含特殊字符: / \\ : * ? " < > |')
        return value.strip()

    def validate(self, attrs):
        """🔧 验证文件夹创建/更新的业务规则"""
        request = self.context.get('request')
        if not request:
            return attrs

        name = attrs.get('name')
        parent = attrs.get('parent')

        # 🔧 验证：同一父文件夹下不能有重名文件夹
        if name and parent:
            if Folder.objects.filter(
                    parent=parent,
                    name=name,
                    owner=request.user,
                    deleted_at__isnull=True
            ).exclude(id=self.instance.id if self.instance else None).exists():
                raise serializers.ValidationError({
                    'name': '该父文件夹下已存在同名文件夹'
                })

        # 🔧 验证：不能将文件夹设置为自己的父文件夹
        if parent and self.instance and parent.id == self.instance.id:
            raise serializers.ValidationError({
                'parent': '文件夹不能设置为自己的父文件夹'
            })

        return attrs

class CloudFileSerializer(serializers.ModelSerializer):
    """云文件序列化器"""
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    owner_avatar = serializers.CharField(source='owner.get_avatar_url', read_only=True)
    folder_name = serializers.CharField(source='folder.name', read_only=True)
    file_url = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    extension = serializers.SerializerMethodField()
    icon_class = serializers.SerializerMethodField()
    is_image = serializers.BooleanField(read_only=True)
    is_video = serializers.BooleanField(read_only=True)
    is_audio = serializers.BooleanField(read_only=True)
    permanently_deleted = serializers.BooleanField(read_only=True)
    size_formatted = serializers.SerializerMethodField()
    is_document = serializers.SerializerMethodField()

    _physical_file_path = serializers.CharField(write_only=True, required=False)


    class Meta:
        model = CloudFile
        fields = [
            'id', 'folder', 'folder_name', 'name', 'original_name',
            'file', 'file_url', 'download_url', 'preview_url',
            'size', 'size_formatted', 'mime_type', 'md5', 'extension',
            'icon_class', 'is_image', 'is_video', 'is_audio', 'is_document',
            'owner', 'owner_name', 'owner_avatar', 'description', 'tags',
            'is_starred', 'download_count', 'created_at', 'updated_at', 'deleted_at',
            'permanently_deleted', 'document_type', 'current_version', 'editing_user',
            '_physical_file_path',  # 只写字段，不返回
        ]
        # 🔧 关键修复：name 和 original_name 设为只读（自动从文件获取）
        read_only_fields = ['owner', 'size', 'name', 'original_name', 'created_at', 'updated_at']


    def get_extension(self, obj):
        return obj.get_extension()

    def get_file_url(self, obj):
        request = self.context.get('request')
        if request and obj.file:
            return request.build_absolute_uri(obj.file.url)
        return None

    def get_download_url(self, obj):
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(f'/api/cloud/files/{obj.id}/download/')
        return None

    def get_preview_url(self, obj):
        request = self.context.get('request')
        if request and self._is_image_or_video(obj):
            return request.build_absolute_uri(obj.file.url)
        return None

    def get_size_formatted(self, obj):
        size = obj.size
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f'{size:.2f} {unit}'
            size /= 1024
        return f'{size:.2f} PB'

    def get_icon_class(self, obj):
        if obj.mime_type.startswith('image/'):
            return 'fa-file-image'
        elif obj.mime_type.startswith('video/'):
            return 'fa-file-video'
        elif obj.mime_type.startswith('audio/'):
            return 'fa-file-audio'
        elif 'pdf' in obj.mime_type:
            return 'fa-file-pdf'
        elif 'word' in obj.mime_type or obj.mime_type.endswith('doc'):
            return 'fa-file-word'
        elif 'excel' in obj.mime_type or obj.mime_type.endswith('xls'):
            return 'fa-file-excel'
        elif 'powerpoint' in obj.mime_type or obj.mime_type.endswith('ppt'):
            return 'fa-file-powerpoint'
        else:
            return 'fa-file'


    def get_is_document(self, obj):
        doc_types = self.all_doc_formats()
        return any(t in obj.get_extension().lower() for t in doc_types)


    def _is_image_or_video(self, obj):
        return obj.mime_type.startswith('image/') or obj.mime_type.startswith('video/')

    @property
    def is_image(self):
        return self.instance.mime_type.startswith('image/') if self.instance else False

    @property
    def is_video(self):
        return self.instance.mime_type.startswith('video/') if self.instance else False


    @property
    def supported_formats(self):
        return {
            'word': settings.ONLYOFFICE.get('WORD_FORMATS', []),
            'excel': settings.ONLYOFFICE.get('EXCEL_FORMATS', []),
            'ppt': settings.ONLYOFFICE.get('PPT_FORMATS', []),
            'pdf': settings.ONLYOFFICE.get('PDF_FORMATS', []),
        }


    def all_doc_formats(self):
        """返回所有的文档格式"""
        return self.supported_formats['word'] + self.supported_formats['excel'] + self.supported_formats['ppt'] + self.supported_formats['pdf']

    # 🔧 关键修复：重写 create 方法，自动提取文件名, 自动设置 owner
    def create(self, validated_data):
        # 从 request 中获取当前用户
        logger.info(f'validated_data: {validated_data}')
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['owner'] = request.user

        # 从上传的文件中获取文件名
        file = validated_data.get('file')
        if file:
            # 自动设置 original_name（原始文件名）
            validated_data['original_name'] = file.name

            # 自动设置 name（存储名称，可去重）
            validated_data['name'] = file.name

            # 自动设置 size
            validated_data['size'] = file.size

            # 自动设置 mime_type
            validated_data['mime_type'] = file.content_type

        # 🔧 提取物理文件路径（秒传专用）
        physical_path = validated_data.pop('_physical_file_path', None)

        # 正常创建记录
        instance = super().create(validated_data)

        # 🔧 关键：如果指定了物理路径，直接设置（绕过存储系统的复制）
        if physical_path:
            instance.file.name = physical_path  # 直接赋值相对路径
            instance.save(update_fields=['file'])

        return instance


class FileShareSerializer(serializers.ModelSerializer):
    """文件分享序列化器"""
    owner_name = serializers.CharField(source='owner.username', read_only=True)
    share_url = serializers.SerializerMethodField() # ✅ 自定义字段
    allowed_users_list = serializers.SerializerMethodField()
    allowed_departments_list = serializers.SerializerMethodField()
    is_expired = serializers.BooleanField(read_only=True)

    file_info = serializers.SerializerMethodField()
    folder_info = serializers.SerializerMethodField()
    is_folder = serializers.SerializerMethodField()


    # 🔧 注意：这里不再定义 file = serializers.SerializerMethodField()
    # 🔧 注意：这里不再定义 folder = serializers.SerializerMethodField()
    # DRF 会自动根据 Model 中的 ForeignKey 生成可写的字段

    class Meta:
        model = FileShare
        fields = [
            'id', 'file', 'folder', 'share_type', 'share_code', 'password',
            'owner', 'owner_name', 'allowed_users', 'allowed_users_list',
            'allowed_departments', 'allowed_departments_list',
            'max_downloads', 'download_count', 'expires_at', 'is_expired',
            'is_active', 'created_at', 'file_info', 'folder_info', 'is_folder',
            'share_url',  # 🔧 关键修复：添加 share_url 到 fields 列表
        ]
        # 🔧 关键修复：owner 设为只读（由后端自动设置）
        read_only_fields = ['owner', 'share_code', 'download_count', 'created_at', 'share_url', 'is_expired']

    def get_share_url(self, obj):
        """获取分享链接"""
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.get_share_url())
        return None

    def get_allowed_users_list(self, obj):
        """获取允许访问的用户列表"""
        return [
            {'id': u.id, 'username': u.username, 'real_name': u.real_name}
            for u in obj.allowed_users.all()
        ]

    def get_allowed_departments_list(self, obj):
        """获取允许访问的部门列表"""
        return [
            {'id': d.id, 'name': d.name}
            for d in obj.allowed_departments.all()
        ]

    def get_file_info(self, obj):
        """获取文件信息"""
        if obj.file:
            return CloudFileSerializer(obj.file).data
        elif obj.folder:
            return FolderSerializer(obj.folder).data
        return None

    def get_folder_info(self, obj):
        """获取文件夹信息"""
        if obj.folder:
            return FolderSerializer(obj.folder).data
        return None

    def get_is_folder(self, obj):
        """判断是否为文件夹"""
        return obj.file is None


    # 🔧 关键修复：重写 create 方法，自动设置 owner
    def create(self, validated_data):
        """创建文件分享"""
        logger.info(f'validated_data: {validated_data}')
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['owner'] = request.user

        # 🔧 关键修复：如果 share_type 不是 password，强制清空密码
        share_type = validated_data.get('share_type')
        password = validated_data.get('password')

        if share_type != 'password':
            validated_data['password'] = ''
        elif not password:
            validated_data['password'] = ''

        # 🔧 关键修复 4: 显式处理 file 和 folder ID
        # 虽然 DRF 会自动处理外键，但显式获取更稳妥，防止被意外过滤
        file_id = validated_data.get('file')
        folder_id = validated_data.get('folder')

        # 验证：必须指定文件或文件夹其中之一
        if not file_id and not folder_id:
            raise serializers.ValidationError({
                'file': '必须指定要分享的文件或文件夹',
                'folder': '必须指定要分享的文件或文件夹'
            })

        # 验证：不能同时指定文件和文件夹
        if file_id and folder_id:
            raise serializers.ValidationError({
                'file': '不能同时分享文件和文件夹',
                'folder': '不能同时分享文件和文件夹'
            })

        # 生成分享码
        import uuid
        if 'share_code' not in validated_data:
            validated_data['share_code'] = uuid.uuid4().hex[:16]

        # 执行创建
        instance = super().create(validated_data)
        logger.info(f'分享创建成功 - ID: {instance.id}, File: {instance.file}, Folder: {instance.folder}')

        return instance


class FileCommentSerializer(serializers.ModelSerializer):
    """文件评论序列化器"""
    user_name = serializers.CharField(source='user.username', read_only=True)
    user_avatar = serializers.CharField(source='user.get_avatar_url', read_only=True)
    reply_count = serializers.SerializerMethodField()

    class Meta:
        model = FileComment
        fields = [
            'id', 'file', 'user', 'user_name', 'user_avatar',
            'content', 'parent', 'reply_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at']

    def get_reply_count(self, obj):
        return obj.replies.count()


class FileOperationLogSerializer(serializers.ModelSerializer):
    """文件操作日志序列化器"""
    user_name = serializers.CharField(source='user.username', read_only=True)
    operation_display = serializers.CharField(source='get_operation_display', read_only=True)

    class Meta:
        model = FileOperationLog
        fields = [
            'id', 'file', 'folder', 'user', 'user_name',
            'operation', 'operation_display', 'description',
            'ip_address', 'created_at'
        ]
        read_only_fields = ['created_at']


class FileVersionSerializer(serializers.ModelSerializer):
    """文件版本序列化器"""
    uploaded_by_name = serializers.CharField(source='uploaded_by.username', read_only=True)
    size_formatted = serializers.SerializerMethodField()

    class Meta:
        model = FileVersion
        fields = [
            'id', 'file', 'file_path', 'size',
            'size_formatted', 'md5', 'uploaded_by', 'uploaded_by_name',
            'created_at', 'description'
        ]
        read_only_fields = ['created_at']

    def get_size_formatted(self, obj):
        size = obj.size
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f'{size:.2f} {unit}'
            size /= 1024
        return f'{size:.2f} PB'