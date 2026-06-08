# -*- coding: utf-8 -*-
# @File   :serializers.py
# @Time   :2026/3/13 09:09
# @Author :admin


# cloud/serializers.py - 添加网盘序列化器

from django.conf import settings
from rest_framework import serializers
from .models import Folder, FolderCollaboration, CloudFile, UploadSession, FileShare, FileComment, FileOperationLog, FileVersion, CloudSystemConfig, UserOnlyOfficePermission
from accounts.models import CustomUser, Department
from accounts.serializers import UserDetailSerializer
from loguru import logger
import json


class FolderCollaborationSerializer(serializers.ModelSerializer):
    """文件夹协作序列化器"""

    class Meta:
        model = FolderCollaboration
        fields = [
            'id', 'folder', 'user', 'permission', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

class FolderListSerializer(serializers.ModelSerializer):
    """🔧 文件夹列表序列化器（简化版，用于列表展示）"""
    file_count = serializers.SerializerMethodField()
    permanently_deleted = serializers.BooleanField(read_only=True)

    # 🔧 添加路径字段（用于面包屑和缩进）
    path = serializers.SerializerMethodField()

    # 🔧 新增：是否为共享文件夹
    is_shared_folder = serializers.BooleanField(read_only=True)

    # 🔧 新增：成员数量（仅共享文件夹）
    member_count = serializers.SerializerMethodField()

    # 🔧 新增：图标类（前端需要）
    icon_class = serializers.SerializerMethodField()

    owner = serializers.SerializerMethodField()

    class Meta:
        model = Folder
        fields = [
            'id', 'name', 'parent', 'is_public', 'is_shared', 'owner',
            'file_count', 'created_at', 'updated_at', 'permanently_deleted',
            'path',  'is_shared_folder', 'member_count', 'icon_class',  # 🔧 新增字段
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

    def get_member_count(self, obj):
        """🔧 获取共享文件夹成员数量"""
        if obj.is_shared_folder:
            return obj.folder_collaborations.filter(is_active=True).count() + 1  # +1 为所有者
        return 0

    def get_icon_class(self, obj):
        """🔧 返回文件夹图标"""
        return 'fa-folder'

    def get_owner(self, obj):
        """获取文件夹的拥有者"""
        return {
            'id': obj.owner.id,
            'username': obj.owner.username,
            'real_name': obj.owner.real_name,
            'avatar': obj.owner.get_avatar_url() if hasattr(obj.owner, 'get_avatar_url') else '',
            'department': obj.owner.department.name if obj.owner.department else None,
            'is_active': obj.owner.is_active,
            'is_staff': obj.owner.is_staff,
            'is_superuser': obj.owner.is_superuser,
            'last_login': obj.owner.last_login,
        }


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
    folder_collaborations = FolderCollaborationSerializer(many=True, read_only=True, source='folder_collaboration_set')

    class Meta:
        model = Folder
        fields = [
            'id', 'name', 'parent', 'owner', 'owner_name',
            'department', 'department_name', 'is_public', 'is_shared',
            'file_count', 'total_size', 'path', 'children_count', 'icon_class',
            'created_at', 'updated_at', 'deleted_at', 'permanently_deleted',
            'folder_collaborations', 'is_shared_folder'
        ]
        read_only_fields = ['owner', 'folder_collaborations', 'created_at', 'updated_at']

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
    owner = serializers.SerializerMethodField()

    # 🔧 修改 description 和 tags 字段配置
    description = serializers.CharField(
        required=False,  # 非必填
        allow_blank=True,  # 允许空字符串
        allow_null=True,  # 允许 null
        default=''  # 默认值
    )
    tags = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        default=''
    )

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

    def get_icon_class(self, obj):
        return obj.get_icon_class()

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


    def get_is_document(self, obj):
        doc_types = self.all_doc_formats()
        return any(t in obj.get_extension().lower() for t in doc_types)


    def get_owner(self, obj):
        """获取文件所属用户的信息"""
        return {
            'id': obj.owner.id,
            'username': obj.owner.username,
            'real_name': obj.owner.real_name,
            'avatar': obj.owner.get_avatar_url() if hasattr(obj.owner, 'get_avatar_url') else '',
            'department': obj.owner.department.name if obj.owner.department else None,
            'is_active': obj.owner.is_active,
            'is_staff': obj.owner.is_staff,
            'is_superuser': obj.owner.is_superuser,
            'last_login': obj.owner.last_login,
        }


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


# cloud/serializers.py - 新增上传会话序列化器

class UploadSessionSerializer(serializers.ModelSerializer):
    progress = serializers.SerializerMethodField()
    missing_chunks = serializers.SerializerMethodField()

    class Meta:
        model = UploadSession
        fields = [
            'id', 'file_md5', 'file_name', 'file_size',
            'total_chunks', 'uploaded_chunks', 'chunk_size',
            'uploaded_size', 'is_completed', 'expires_at',
            'progress', 'missing_chunks', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'uploaded_chunks', 'uploaded_size',
            'is_completed', 'progress', 'missing_chunks'
        ]

    def get_progress(self, obj):
        return obj.get_upload_progress()

    def get_missing_chunks(self, obj):
        return obj.get_missing_chunks()


class ChunkUploadSerializer(serializers.Serializer):
    """分片上传请求序列化器"""
    session_id = serializers.UUIDField(help_text='上传会话ID')
    chunk_index = serializers.IntegerField(min_value=0, help_text='分片索引(从0开始)')
    chunk_md5 = serializers.CharField(max_length=32, help_text='分片MD5')
    chunk = serializers.FileField(help_text='分片文件内容')

    def validate_chunk_index(self, value):
        session = self.context.get('session')
        if session and value >= session.total_chunks:
            raise serializers.ValidationError('分片索引超出范围')
        return value


class MergeChunksSerializer(serializers.Serializer):
    """合并分片请求序列化器"""
    session_id = serializers.UUIDField(help_text='上传会话ID')
    folder = serializers.UUIDField(required=False, allow_null=True)
    # 🔧 修改 description 和 tags 字段配置
    description = serializers.CharField(
        required=False,  # 非必填
        allow_blank=True,  # 允许空字符串
        allow_null=True,  # 允许 null
        default=''  # 默认值
    )
    tags = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        default=''
    )


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

        # 生成分享码 (缩短为8位)
        import uuid
        if 'share_code' not in validated_data:
            validated_data['share_code'] = uuid.uuid4().hex[:8]

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


# cloud/serializers.py

class CloudSystemConfigSerializer(serializers.ModelSerializer):
    """🔧 系统配置序列化器（支持类型转换和预定义配置）"""

    # 🔧 额外字段
    typed_value = serializers.SerializerMethodField()
    validation_rules = serializers.SerializerMethodField()
    is_default = serializers.SerializerMethodField()

    # 🔧 分类显示字段
    category_display = serializers.SerializerMethodField()
    category_info = serializers.SerializerMethodField()
    value_display = serializers.SerializerMethodField()


    class Meta:
        model = CloudSystemConfig
        fields = [
            'id', 'key', 'name', 'value', 'value_type', 'category',
            'description', 'default_value', 'is_public', 'is_editable',
            'typed_value', 'validation_rules', 'is_default',
            'created_at', 'updated_at', 'updated_by',
            'category_display', 'category_info', 'value_display',
            # 🔧 OnlyOffice 专用字段
            'onlyoffice_document_server_url',
            'onlyoffice_jwt_enabled',
            'onlyoffice_jwt_secret',
            'onlyoffice_permission_download',
            'onlyoffice_permission_copy',
            'onlyoffice_permission_edit',
            'onlyoffice_permission_print',
            'onlyoffice_permission_comment',
            'onlyoffice_permission_chat',
            'onlyoffice_permission_review',
            'onlyoffice_permission_fill_forms',
            'onlyoffice_permission_modify_content_control',
            'onlyoffice_permission_modify_filter',
            'onlyoffice_language',
            'onlyoffice_collaboration_mode',
            'onlyoffice_show_chat',
            'onlyoffice_show_comments',
            'onlyoffice_show_review',
            'onlyoffice_show_spellcheck',
            'onlyoffice_forcesave',
            'onlyoffice_compact_toolbar',
            'onlyoffice_ui_theme',
            'onlyoffice_version_keep_count',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'updated_by', 'typed_value', 'is_default']

    def get_typed_value(self, obj):
        """🔧 获取类型化的值"""
        return obj.get_typed_value()

    def get_validation_rules(self, obj):
        """🔧 获取预定义配置的验证规则"""
        from cloud.views import CloudSystemSettingsViewSet
        predefined = CloudSystemSettingsViewSet.PREDEFINED_CONFIGS.get(obj.key, {})
        return predefined.get('validation', {})

    def get_is_default(self, obj):
        """🔧 判断是否为默认值"""
        from cloud.views import CloudSystemSettingsViewSet
        predefined = CloudSystemSettingsViewSet.PREDEFINED_CONFIGS.get(obj.key, {})
        default = predefined.get('default')
        current = obj.get_typed_value()

        if isinstance(default, bool):
            return current == (str(default).lower() in ('true', '1', 'yes'))
        elif isinstance(default, (int, float)):
            try:
                return float(current) == float(default)
            except (ValueError, TypeError):
                return False
        elif isinstance(default, (list, dict)):
            try:
                return json.loads(obj.value) == default if isinstance(obj.value, str) else obj.value == default
            except:
                return False
        return str(current) == str(default)

    def get_category_display(self, obj):
        """🔧 获取分类中文名称"""
        return obj.get_category_display()

    def get_category_info(self, obj):
        """🔧 获取分类详细信息"""
        return obj.get_category_info()

    def get_value_display(self, obj):
        """🔧 获取值的显示格式"""
        value = obj.get_typed_value()
        if obj.value_type == 'password':
            return '••••••••'
        elif obj.value_type == 'boolean':
            return '是' if value else '否'
        elif obj.value_type == 'json':
            try:
                return json.dumps(value, ensure_ascii=False, indent=2) if isinstance(value, (dict, list)) else str(
                    value)
            except:
                return str(value)
        return str(value)

    def validate_value(self, value):
        """🔧 值验证（根据 value_type）"""
        value_type = self.instance.value_type if self.instance else self.initial_data.get('value_type', 'string')

        if value_type == 'integer':
            try:
                return int(value)
            except (ValueError, TypeError):
                raise serializers.ValidationError('必须是整数')
        elif value_type == 'float':
            try:
                return float(value)
            except (ValueError, TypeError):
                raise serializers.ValidationError('必须是数字')
        elif value_type == 'boolean':
            if isinstance(value, bool):
                return value
            return str(value).lower() in ('true', '1', 'yes', 'on')
        elif value_type == 'json':
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False)
            try:
                json.loads(value)
                return value
            except json.JSONDecodeError:
                raise serializers.ValidationError('必须是有效的 JSON 格式')
        return value

    def validate(self, data):
        """🔧 整体验证"""
        from cloud.views import CloudSystemSettingsViewSet

        key = data.get('key') or (self.instance.key if self.instance else None)
        value = data.get('value')

        if key and key in CloudSystemSettingsViewSet.PREDEFINED_CONFIGS:
            predefined = CloudSystemSettingsViewSet.PREDEFINED_CONFIGS[key]

            # 检查是否可编辑
            if not predefined.get('is_editable', True) and not self.context['request'].user.is_superuser:
                raise serializers.ValidationError('该配置项不可编辑')

            # 应用验证规则
            validation = predefined.get('validation', {})
            value_type = predefined.get('value_type', 'string')

            if value_type == 'integer' and isinstance(value, (int, str)):
                try:
                    val = int(value)
                    if 'min' in validation and val < validation['min']:
                        raise serializers.ValidationError(f'值不能小于 {validation["min"]}')
                    if 'max' in validation and val > validation['max']:
                        raise serializers.ValidationError(f'值不能大于 {validation["max"]}')
                except ValueError:
                    raise serializers.ValidationError('必须是整数')

            elif value_type == 'string' and isinstance(value, str):
                if 'min_length' in validation and len(value) < validation['min_length']:
                    raise serializers.ValidationError(f'长度不能小于 {validation["min_length"]} 字符')
                if 'max_length' in validation and len(value) > validation['max_length']:
                    raise serializers.ValidationError(f'长度不能大于 {validation["max_length"]} 字符')
                if 'pattern' in validation:
                    import re
                    if not re.match(validation['pattern'], value):
                        raise serializers.ValidationError('格式不符合要求')

        return data


class SystemConfigCategorySerializer(serializers.Serializer):
    """🔧 配置分类序列化器"""
    key = serializers.CharField()
    name = serializers.CharField()
    icon = serializers.CharField()
    count = serializers.IntegerField()
    order = serializers.IntegerField()
    color = serializers.CharField(required=False)


class UserOnlyOfficePermissionSerializer(serializers.ModelSerializer):
    """🔧 用户 OnlyOffice 权限配置序列化器"""
    user_info = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)

    class Meta:
        model = UserOnlyOfficePermission
        fields = [
            'id', 'user', 'user_info', 'permissions',
            'permission_download', 'permission_copy', 'permission_edit',
            'permission_print', 'permission_comment', 'permission_chat',
            'permission_review', 'permission_fill_forms',
            'permission_modify_content_control', 'permission_modify_filter',
            'is_active', 'description', 'created_at', 'updated_at',
            'created_by', 'created_by_name',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by']

    def get_user_info(self, obj):
        """获取用户信息"""
        return {
            'id': obj.user.id,
            'username': obj.user.username,
            'real_name': obj.user.real_name or '',
            'avatar': obj.user.get_avatar_url() if hasattr(obj.user, 'get_avatar_url') else '',
        }

    def get_permissions(self, obj):
        """获取权限字典"""
        return obj.get_permissions_dict()

    def validate(self, attrs):
        """验证权限配置"""
        # 至少需要一个权限为 True
        permission_fields = [
            'permission_download', 'permission_copy', 'permission_edit',
            'permission_print', 'permission_comment', 'permission_chat',
            'permission_review', 'permission_fill_forms',
            'permission_modify_content_control', 'permission_modify_filter',
        ]

        has_any_permission = any(
            attrs.get(field, getattr(self.instance, field, False))
            for field in permission_fields
        )

        if not has_any_permission:
            raise serializers.ValidationError('至少需要启用一个权限')

        return attrs

    def create(self, validated_data):
        """创建时自动设置创建者"""
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            validated_data['created_by'] = request.user

        # 检查是否已存在
        user = validated_data.get('user')
        if UserOnlyOfficePermission.objects.filter(user=user).exists():
            raise serializers.ValidationError({
                'user': '该用户已存在权限配置，请使用更新接口'
            })

        return super().create(validated_data)