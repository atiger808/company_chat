# cloud/models.py - 添加网盘相关模型

from django.db import models
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from .managers import SoftDeleteManager
import hashlib
import os
import uuid
import json



class Folder(models.Model):
    """文件夹模型"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, verbose_name='文件夹名称')

    # 父子关系
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children',
        verbose_name='父文件夹'
    )

    # 所有者
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_folders',
        verbose_name='所有者'
    )

    # 部门关联
    department = models.ForeignKey(
        'accounts.Department',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='folders',
        verbose_name='所属部门'
    )

    # 权限控制
    is_public = models.BooleanField(default=False, verbose_name='是否公开')
    is_shared = models.BooleanField(default=False, verbose_name='是否已分享')

    description = models.TextField(blank=True, null=True, verbose_name='描述')

    # 🔧 关键修复：添加软删除字段
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name='删除时间')

    # 时间戳
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    # 🔧 新增：永久删除标记
    permanently_deleted = models.BooleanField(
        default=False,
        verbose_name='是否永久删除',
        help_text='标记为永久删除但保留记录（用于有关联的情况）'
    )

    # 🔧 使用自定义管理器
    # objects = SoftDeleteManager()  # 默认只查询未删除的
    # all_objects = models.Manager()  # 查询所有记录（包括已删除的）

    class Meta:
        verbose_name = '文件夹'
        verbose_name_plural = verbose_name
        ordering = ['-created_at']
        # 唯一约束：同一父文件夹下不能有重名文件夹
        unique_together = ['parent', 'name', 'owner']
        indexes = [
            models.Index(fields=['owner', 'deleted_at', 'permanently_deleted']),
        ]

    def __str__(self):
        return self.name

    def get_path(self):
        """获取完整路径"""
        path = [self.name]
        current = self.parent
        while current:
            path.insert(0, current.name)
            current = current.parent
        return '/'.join(path)

    def get_size(self):
        """获取文件夹总大小（包含所有子文件）"""
        total_size = 0
        for file in self.files.filter(deleted_at__isnull=True):
            total_size += file.size
        for child in self.children.filter(deleted_at__isnull=True):
            total_size += child.get_size()
        return total_size

    def get_file_count(self):
        """获取文件总数（包含子文件夹）"""
        count = self.files.filter(deleted_at__isnull=True).count()
        for child in self.children.filter(deleted_at__isnull=True):
            count += child.get_file_count()
        return count

    # def delete(self, *args, **kwargs):
    #     """🔧 重写 delete 方法实现软删除"""
    #     self.deleted_at = timezone.now()
    #     self.save(update_fields=['deleted_at'])

    def restore(self):
        """🔧 恢复方法"""
        self.deleted_at = None
        self.save(update_fields=['deleted_at'])

    def is_deleted(self):
        """🔧 检查是否已删除"""
        return self.deleted_at is not None


class CloudFile(models.Model):
    """云文件模型"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        related_name='files',
        null=True,
        blank=True,
        verbose_name='所属文件夹'
    )
    name = models.CharField(max_length=255, verbose_name='文件名')
    original_name = models.CharField(max_length=255, verbose_name='原始文件名')
    file = models.FileField(upload_to='cloud_files/%Y/%m/%d/', verbose_name='文件')
    size = models.BigIntegerField(default=0, verbose_name='文件大小（字节）')
    mime_type = models.CharField(max_length=100, blank=True, verbose_name='MIME 类型')
    md5 = models.CharField(max_length=32, db_index=True, verbose_name='MD5 哈希')

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_files',
        verbose_name='所有者',
        null=False,  # ✅ 确保不为 null
        blank=False  # ✅ 确保不为 blank
    )
    # 🔧 方案：允许 null 并设置默认空字符串（需执行迁移）
    description = models.TextField(
        blank=True,  # 表单允许为空
        null=True,  # 数据库允许 NULL
        default='',  # 默认值
        verbose_name='文件描述'
    )

    # 🔧 方案：允许 null 并设置默认空字符串（需执行迁移）
    tags = models.CharField(
        max_length=255,
        blank=True,  # 表单允许为空
        null=True,  # 数据库允许 NULL
        default='',  # 默认值
        verbose_name='标签（逗号分隔）'
    )

    is_starred = models.BooleanField(default=False, verbose_name='是否星标')
    download_count = models.IntegerField(default=0, verbose_name='下载次数')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name='删除时间')

    # 🔧 新增：永久删除标记（逻辑清空时使用）
    permanently_deleted = models.BooleanField(
        default=False,
        verbose_name='是否永久删除',
        help_text='标记为永久删除但保留记录（用于有关联的情况）'
    )

    # 🔧 新增：文档编辑相关字段
    is_document = models.BooleanField(default=False, verbose_name='是否文档')
    document_type = models.CharField(
        max_length=20,
        choices=[
            ('word', 'Word'),
            ('excel', 'Excel'),
            ('ppt', 'PowerPoint'),
            ('pdf', 'PDF'),
        ],
        null=True,
        blank=True,
        verbose_name='文档类型'
    )
    current_version = models.ForeignKey(
        'DocumentVersion',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='current_file',
        verbose_name='当前版本'
    )
    editing_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='editing_files',
        verbose_name='当前编辑用户'
    )

    # 🔧 新增：引用计数（同一物理文件被多少用户记录引用）
    reference_count = models.PositiveIntegerField(default=1, editable=False, verbose_name='引用计数')

    class Meta:
        verbose_name = '云文件'
        verbose_name_plural = verbose_name
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['md5']),
            models.Index(fields=['owner', 'deleted_at']),
            models.Index(fields=['folder', 'deleted_at']),
            models.Index(fields=['owner', 'deleted_at', 'permanently_deleted']),
            models.Index(fields=['is_document', 'document_type']),
        ]

    def __str__(self):
        return self.name

    def get_mime_type(self, filename=None):
        """获取文件的 MIME 类型"""
        import mimetypes
        name = filename or self.original_name
        mime_type, _ = mimetypes.guess_type(name)
        return mime_type or 'application/octet-stream'

    def get_extension(self):
        """获取文件扩展名"""
        return os.path.splitext(self.original_name)[1].lower()

    def get_icon_class(self):
        """获取文件图标类"""
        ext = self.get_extension()
        icon_map = {
            '.pdf': 'fa-file-pdf',
            '.doc': 'fa-file-word',
            '.docx': 'fa-file-word',
            '.xls': 'fa-file-excel',
            '.xlsx': 'fa-file-excel',
            '.ppt': 'fa-file-powerpoint',
            '.pptx': 'fa-file-powerpoint',
            '.jpg': 'fa-file-image',
            '.jpeg': 'fa-file-image',
            '.png': 'fa-file-image',
            '.gif': 'fa-file-image',
            '.mp3': 'fa-file-audio',
            '.wav': 'fa-file-audio',
            '.mp4': 'fa-file-video',
            '.avi': 'fa-file-video',
            '.zip': 'fa-file-archive',
            '.rar': 'fa-file-archive',
            '.7z': 'fa-file-archive',
            '.txt': 'fa-file-alt',
            '.md': 'fa-file-alt',
        }
        return icon_map.get(ext, 'fa-file')

    def is_image(self):
        """是否为图片"""
        return self.get_extension() in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']

    def is_video(self):
        """是否为视频"""
        return self.get_extension() in ['.mp4', '.avi', '.mov', '.wmv', '.flv']

    def is_audio(self):
        """是否为音频"""
        return self.get_extension() in ['.mp3', '.wav', '.ogg', '.m4a']


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
        return self.supported_formats['word'] + self.supported_formats['excel'] + self.supported_formats['ppt'] + \
            self.supported_formats['pdf']

    def save(self, *args, **kwargs):
        # 仅在首次创建或尚未确定是否为文档时自动识别文档类型
        if not self.is_document:
            ext = self.get_extension()
            all_formats = self.all_doc_formats()
            
            # 判断是否为支持的文档格式
            if ext in all_formats:
                self.is_document = True
                # 确定具体的文档类型
                if ext in self.supported_formats['word']:
                    self.document_type = 'word'
                elif ext in self.supported_formats['excel']:
                    self.document_type = 'excel'
                elif ext in self.supported_formats['ppt']:
                    self.document_type = 'ppt'
                elif ext in self.supported_formats['pdf']:
                    self.document_type = 'pdf'
                else:
                    self.document_type = None
            else:
                self.is_document = False
                self.document_type = None

        if not self.mime_type:
            self.mime_type = self.get_mime_type(self.original_name)

        super().save(*args, **kwargs)


# cloud/models.py - 新增上传会话模型
class UploadSession(models.Model):
    """
    🔧 上传会话模型 - 支持分片上传和断点续传
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='upload_sessions'
    )

    # 文件信息
    file_md5 = models.CharField(max_length=32, db_index=True, help_text='文件完整MD5')
    file_name = models.CharField(max_length=255)
    file_size = models.BigIntegerField(help_text='文件总大小(字节)')
    total_chunks = models.IntegerField(help_text='总分片数')
    chunk_size = models.IntegerField(default=5 * 1024 * 1024, help_text='分片大小(默认5MB)')

    # 上传进度
    uploaded_chunks = models.JSONField(default=list, help_text='已上传的分片索引列表')
    uploaded_size = models.BigIntegerField(default=0, help_text='已上传字节数')

    # 状态控制
    is_completed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(help_text='会话过期时间(默认24小时)')

    # 临时存储路径
    temp_path = models.CharField(max_length=500, blank=True, help_text='临时分片存储目录')

    class Meta:
        verbose_name = '上传会话'
        verbose_name_plural = '上传会话'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['file_md5', 'user']),
            models.Index(fields=['expires_at']),
            models.Index(fields=['is_completed', 'updated_at']),
        ]

    def __str__(self):
        return f"UploadSession-{self.file_name[:20]}-{self.file_md5[:8]}"

    def is_expired(self):
        """检查会话是否过期"""
        return timezone.now() > self.expires_at

    def get_uploaded_chunk_set(self):
        """返回已上传分片的集合(用于快速查找)"""
        return set(self.uploaded_chunks)

    def add_uploaded_chunk(self, chunk_index):
        """添加已上传的分片索引"""
        if chunk_index not in self.uploaded_chunks:
            self.uploaded_chunks.append(chunk_index)
            self.uploaded_size += self.chunk_size
            self.save(update_fields=['uploaded_chunks', 'uploaded_size', 'updated_at'])

    def is_chunk_uploaded(self, chunk_index):
        """检查指定分片是否已上传"""
        return chunk_index in self.uploaded_chunks

    def get_missing_chunks(self):
        """获取未上传的分片索引列表"""
        all_chunks = set(range(self.total_chunks))
        uploaded = set(self.uploaded_chunks)
        return sorted(list(all_chunks - uploaded))

    def get_upload_progress(self):
        """计算上传进度百分比"""
        if self.total_chunks == 0:
            return 100
        return round(len(self.uploaded_chunks) / self.total_chunks * 100, 2)


class FileShare(models.Model):
    """文件分享模型"""
    SHARE_TYPE_CHOICES = [
        ('public', '公开链接'),
        ('password', '密码保护'),
        ('private', '指定用户'),
        ('department', '指定部门'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        CloudFile,
        on_delete=models.CASCADE,
        related_name='shares',
        null=True,
        blank=True,
        verbose_name='分享文件'
    )
    folder = models.ForeignKey(
        Folder,
        on_delete=models.CASCADE,
        related_name='shares',
        null=True,
        blank=True,
        verbose_name='分享文件夹'
    )
    share_type = models.CharField(
        max_length=20,
        choices=SHARE_TYPE_CHOICES,
        default='public',
        verbose_name='分享类型'
    )
    share_code = models.CharField(max_length=64, unique=True, verbose_name='分享码')
    password = models.CharField(max_length=20, blank=True, null=True, verbose_name='访问密码')
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='file_shares',
        verbose_name='分享者',
        null=False,  # ✅ 确保不为 null
        blank=False  # ✅ 确保不为 blank
    )
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='shared_files_to_me',  # 🔧 修复：避免与 owner 的 related_name 冲突
        verbose_name='允许访问的用户'
    )
    allowed_departments = models.ManyToManyField(
        'accounts.Department',
        blank=True,
        related_name='shared_departments',  # 🔧 修复：避免重复
        verbose_name='允许访问的部门'
    )
    max_downloads = models.IntegerField(null=True, blank=True, verbose_name='最大下载次数')
    download_count = models.IntegerField(default=0, verbose_name='已下载次数')
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name='过期时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    is_active = models.BooleanField(default=True, verbose_name='是否有效')

    class Meta:
        verbose_name = '文件分享'
        verbose_name_plural = verbose_name
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.share_code} - {self.owner.username}'

    def is_expired(self):
        """检查是否过期"""
        if self.expires_at and timezone.now() > self.expires_at:
            return True
        if self.max_downloads and self.download_count >= self.max_downloads:
            return True
        return not self.is_active

    def get_share_url(self):
        """获取分享链接"""
        return f'/s/{self.share_code}/'


class FileComment(models.Model):
    """文件评论模型"""
    file = models.ForeignKey(
        CloudFile,
        on_delete=models.CASCADE,
        related_name='comments',
        verbose_name='文件'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='file_comments',
        verbose_name='评论者'
    )
    content = models.TextField(verbose_name='评论内容')
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='replies',
        verbose_name='父评论'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '文件评论'
        verbose_name_plural = verbose_name
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username} - {self.file.name}'


class FileOperationLog(models.Model):
    """文件操作日志模型"""
    OPERATION_CHOICES = [
        ('create', '创建'),
        ('update', '更新'),
        ('delete', '删除'),
        ('restore', '恢复'),
        ('permanent_delete', '永久删除'),
        ('move', '移动'),
        ('rename', '重命名'),
        ('upload', '上传'),
        ('download', '下载'),
        ('preview', '预览'),
        ('share', '分享'),
        ('unshare', '取消分享'),
        ('save_from_share', '从分享保存'),
        ('empty_trash', '清空回收站'),
    ]

    file = models.ForeignKey(
        CloudFile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='operation_logs',
        verbose_name='文件'
    )
    folder = models.ForeignKey(
        Folder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='operation_logs',
        verbose_name='文件夹'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='file_operation_logs',
        verbose_name='操作者'
    )
    operation = models.CharField(
        max_length=100,
        choices=OPERATION_CHOICES,
        verbose_name='操作类型'
    )
    description = models.TextField(blank=True, verbose_name='操作描述')

    # 🔧 新增：额外数据（JSON 格式，存储操作详情）
    extra_data = models.JSONField(
        default=dict,
        blank=True,
        verbose_name='额外数据',
        help_text='存储操作的额外信息，如统计信息、文件详情等'
    )

    # IP 地址
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name='IP 地址'
    )


    user_agent = models.TextField(blank=True, verbose_name='User-Agent')

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='操作时间')

    class Meta:
        verbose_name = '文件操作日志'
        verbose_name_plural = verbose_name
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['file', '-created_at']),
            models.Index(fields=['folder', '-created_at']),
            models.Index(fields=['operation', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user.username} - {self.created_at}'


class FileVersion(models.Model):
    """文件版本模型（支持版本控制）"""
    file = models.ForeignKey(
        CloudFile,
        on_delete=models.CASCADE,
        related_name='file_versions',  # 🔧 修复：避免与 DocumentVersion 冲突
        verbose_name='文件'
    )
    version_number = models.IntegerField(default=1, verbose_name='版本号')
    file_path = models.FileField(upload_to='cloud_files/versions/%Y/%m/%d/', verbose_name='文件路径')
    size = models.BigIntegerField(default=0, verbose_name='文件大小')
    md5 = models.CharField(max_length=32, verbose_name='MD5 哈希')
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name='上传用户'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    description = models.TextField(blank=True, verbose_name='版本说明')

    class Meta:
        verbose_name = '文件版本'
        verbose_name_plural = verbose_name
        ordering = ['-version_number', '-created_at']
        unique_together = ['file', 'version_number']

    def __str__(self):
        return f'{self.file.name} - v{self.version_number}'


# cloud/models.py - 添加 Collaboration 模型

class FileCollaboration(models.Model):
    """
    文件协作关系模型
    用于记录用户对文件的协作权限
    """
    PERMISSION_CHOICES = [
        ('read', '只读'),
        ('write', '可编辑'),
        ('admin', '管理员'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # 关联文件
    file = models.ForeignKey(
        'CloudFile',
        on_delete=models.CASCADE,
        related_name='file_collaborations',  # 🔧 修复：避免与 DocumentCollaboration 冲突
        verbose_name='文件'
    )

    # 协作用户
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='user_collaborations',  # 🔧 修复：避免重复
        verbose_name='协作用户'
    )

    # 权限级别
    permission = models.CharField(
        max_length=10,
        choices=PERMISSION_CHOICES,
        default='read',
        verbose_name='权限'
    )


    is_active = models.BooleanField(default=True, verbose_name='是否有效')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '文件协作'
        verbose_name_plural = verbose_name
        unique_together = ['file', 'user']  # 同一用户对同一文件只能有一条协作记录
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['file', 'is_active']),
            models.Index(fields=['user', 'is_active']),
        ]

    def __str__(self):
        return f'{self.user.username} - {self.file.name} ({self.permission})'



# 文档编辑相关模型
class DocumentVersion(models.Model):
    """
    🔧 文档版本模型
    每次保存创建新版本，支持版本回溯
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        CloudFile,
        on_delete=models.CASCADE,
        related_name='document_versions',  # 🔧 修复：避免与 FileVersion 冲突
        verbose_name='文件'
    )
    version_number = models.IntegerField(verbose_name='版本号')
    file_path = models.CharField(max_length=500, verbose_name='版本文件路径')
    file_size = models.BigIntegerField(default=0, verbose_name='文件大小')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_document_versions',
        verbose_name='创建者'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    comment = models.TextField(blank=True, verbose_name='版本注释')
    is_current = models.BooleanField(default=False, verbose_name='是否当前版本')

    # 🔧 新增：内容哈希（用于快速比较版本差异）
    content_hash = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        verbose_name='内容哈希',
        help_text='MD5 或 SHA256 哈希值'
    )

    # 🔧 新增：版本来源（手动保存/自动保存/恢复）
    version_source = models.CharField(
        max_length=20,
        choices=[
            ('auto', '自动保存'),
            ('manual', '手动保存'),
            ('restore', '版本恢复'),
            ('import', '导入'),
        ],
        default='auto',
        verbose_name='版本来源'
    )

    # 🔧 新增：协作会话 ID（关联到具体编辑会话）
    session_id = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        verbose_name='会话 ID'
    )

    class Meta:
        verbose_name = '文档版本'
        verbose_name_plural = verbose_name
        ordering = ['-version_number', '-created_at']
        indexes = [
            models.Index(fields=['file', '-version_number']),
            models.Index(fields=['file', 'is_current']),
        ]

    def __str__(self):
        return f'{self.file.name} - v{self.version_number}'

    # 🔧 新增：计算内容哈希
    def calculate_content_hash(self):
        if os.path.exists(self.file_path):
            with open(self.file_path, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()
        return None


class DocumentEditLock(models.Model):
    """
    🔧 文档编辑锁模型
    防止多人同时编辑冲突
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        CloudFile,
        on_delete=models.CASCADE,
        related_name='edit_locks',
        verbose_name='文件'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='document_locks',
        verbose_name='锁定用户'
    )
    locked_at = models.DateTimeField(auto_now_add=True, verbose_name='锁定时间')
    expires_at = models.DateTimeField(verbose_name='过期时间')
    is_active = models.BooleanField(default=True, verbose_name='是否有效')

    # 🔧 新增：锁类型（独占/共享）
    lock_type = models.CharField(
        max_length=20,
        choices=[
            ('exclusive', '独占锁'),
            ('shared', '共享锁'),
        ],
        default='exclusive',
        verbose_name='锁类型'
    )

    # 🔧 新增：会话 ID
    session_id = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        verbose_name='会话 ID'
    )

    class Meta:
        verbose_name = '文档编辑锁'
        verbose_name_plural = verbose_name
        ordering = ['-locked_at']
        indexes = [
            models.Index(fields=['file', 'is_active']),
            models.Index(fields=['expires_at']),
            models.Index(fields=['user', 'is_active']),
        ]

    def __str__(self):
        return f'{self.file.name} - {self.user.username}'

    # 🔧 新增：检查锁是否过期
    def is_expired(self):
        return timezone.now() > self.expires_at

    # 🔧 新增：延长锁时间
    def extend(self, minutes=30):
        self.expires_at = timezone.now() + timedelta(minutes=minutes)
        self.save(update_fields=['expires_at'])


class DocumentCollaboration(models.Model):
    """
    🔧 文档协作记录模型
    记录多人协同编辑历史
    """
    COLLABORATION_STATUS = [
        ('editing', '编辑中'),
        ('viewing', '查看中'),
        ('closed', '已关闭'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        'CloudFile',
        on_delete=models.CASCADE,
        related_name='collaborations',
        verbose_name='文件'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='document_collaborations',
        verbose_name='协作用户'
    )
    status = models.CharField(
        max_length=20,
        choices=COLLABORATION_STATUS,
        default='viewing',
        verbose_name='状态'
    )
    joined_at = models.DateTimeField(auto_now_add=True, verbose_name='加入时间')
    left_at = models.DateTimeField(null=True, blank=True, verbose_name='离开时间')
    last_activity = models.DateTimeField(auto_now=True, verbose_name='最后活动')

    # 🔧 新增：光标位置（用于实时协同）
    cursor_position = models.JSONField(
        null=True,
        blank=True,
        verbose_name='光标位置',
        help_text='存储 {line: 10, column: 5, selection: {...}}'
    )

    # 🔧 新增：编辑会话 ID（用于区分多次编辑）
    session_id = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        verbose_name='编辑会话 ID',
        help_text='每次打开编辑器生成新会话 ID'
    )

    # 🔧 新增：IP 地址（用于审计）
    ip_address = models.GenericIPAddressField(
        null=True,
        blank=True,
        verbose_name='IP 地址'
    )

    class Meta:
        verbose_name = '文档协作记录'
        verbose_name_plural = verbose_name
        ordering = ['-last_activity']
        # 🔧 新增：同一用户同一文件同一会话只能有一条活跃记录
        unique_together = ['file', 'user', 'session_id']
        indexes = [
            models.Index(fields=['file', 'status']),
            models.Index(fields=['user', 'status']),
            models.Index(fields=['file', 'last_activity']),
            models.Index(fields=['session_id', 'status']),
        ]

    def __str__(self):
        return f'{self.file.name} - {self.user.username}'

    # 🔧 新增：清理过期协作记录
    @classmethod
    def cleanup_inactive(cls, timeout_minutes=30):
        """清理超过指定时间未活动的协作记录"""
        cutoff = timezone.now() - timedelta(minutes=timeout_minutes)
        cls.objects.filter(
            status='editing',
            last_activity__lt=cutoff
        ).update(status='closed', left_at=timezone.now())


# cloud/models.py

class DocumentChatMessage(models.Model):
    """文档协同聊天消息"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        'CloudFile',
        on_delete=models.CASCADE,
        related_name='chat_messages',
        verbose_name='文档'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='doc_chat_messages',
        verbose_name='发送者'
    )
    content = models.TextField(verbose_name='消息内容')
    reply_to = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replies',
        verbose_name='回复的消息'
    )
    mentions = models.JSONField(default=list, blank=True, verbose_name='@提及的用户')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='发送时间')

    class Meta:
        verbose_name = '文档聊天消息'
        verbose_name_plural = verbose_name
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['file', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user.username}: {self.content[:50]}'

# cloud/models.py - 系统配置模型
class CloudSystemConfig(models.Model):
    """
    🔧 企业网盘系统配置模型
    支持动态配置管理，无需重启服务
    """


    # 配置分类枚举
    CATEGORY_CHOICES = [
        ('storage', '存储设置'),
        ('security', '安全设置'),
        ('upload', '上传设置'),
        ('share', '分享设置'),
        ('collaboration', '协同设置'),
        ('system', '系统设置'),
        ('notification', '通知设置'),
        ('audit', '审计日志'),
    ]


    # 值类型
    VALUE_TYPE_CHOICES = [
        ('string', '文本'),
        ('integer', '整数'),
        ('float', '浮点数'),
        ('boolean', '布尔值'),
        ('json', 'JSON'),
        ('password', '密码'),
    ]

    key = models.CharField(max_length=100, unique=True, db_index=True,
                           verbose_name='配置键')
    name = models.CharField(max_length=200, verbose_name='配置名称')
    value = models.TextField(verbose_name='配置值')
    value_type = models.CharField(max_length=20, choices=VALUE_TYPE_CHOICES,
                                  default='string', verbose_name='值类型')
    category = models.CharField(
        max_length=50,
        choices=CATEGORY_CHOICES,
        default='system',
        verbose_name='配置分类',
        db_index=True
    )
    description = models.TextField(blank=True, null=True, verbose_name='描述')
    default_value = models.TextField(blank=True, null=True, verbose_name='默认值')
    is_public = models.BooleanField(default=False, verbose_name='是否公开')
    is_editable = models.BooleanField(default=True, verbose_name='是否可编辑')

    # 🔧 OnlyOffice 配置字段
    # 服务器配置
    onlyoffice_document_server_url = models.CharField(
        max_length=500,
        default= settings.ONLYOFFICE.get('DOCUMENT_SERVER_URL') or 'http://192.168.1.122:8000',
        verbose_name='OnlyOffice 文档服务器地址'
    )
    onlyoffice_jwt_enabled = models.BooleanField(
        default=settings.ONLYOFFICE.get('JWT_ENABLED') or True,
        verbose_name='启用 JWT 认证'
    )
    onlyoffice_jwt_secret = models.CharField(
        max_length=500,
        default=settings.ONLYOFFICE.get('JWT_SECRET') or  '',
        blank=True,
        verbose_name='JWT 密钥'
    )

    # 权限配置
    onlyoffice_permission_download = models.BooleanField(
        default=True,
        verbose_name='允许下载'
    )
    onlyoffice_permission_copy = models.BooleanField(
        default=True,
        verbose_name='允许复制'
    )
    onlyoffice_permission_edit = models.BooleanField(
        default=True,
        verbose_name='允许编辑'
    )
    onlyoffice_permission_print = models.BooleanField(
        default=True,
        verbose_name='允许打印'
    )
    onlyoffice_permission_comment = models.BooleanField(
        default=True,
        verbose_name='允许评论'
    )
    onlyoffice_permission_chat = models.BooleanField(
        default=True,
        verbose_name='允许聊天'
    )
    onlyoffice_permission_review = models.BooleanField(
        default=True,
        verbose_name='允许审阅'
    )
    onlyoffice_permission_fill_forms = models.BooleanField(
        default=True,
        verbose_name='允许填写表单'
    )
    onlyoffice_permission_modify_content_control = models.BooleanField(
        default=True,
        verbose_name='允许修改内容控件'
    )
    onlyoffice_permission_modify_filter = models.BooleanField(
        default=True,
        verbose_name='允许修改筛选器'
    )

    # 语言配置
    onlyoffice_language = models.CharField(
        max_length=10,
        default='zh-CN',
        choices=[
            ('zh-CN', '简体中文'),
            ('zh-TW', '繁体中文'),
            ('en-US', 'English'),
            ('ru-RU', 'Русский'),
            ('de-DE', 'Deutsch'),
            ('fr-FR', 'Français'),
            ('es-ES', 'Español'),
            ('pt-BR', 'Português'),
            ('ja-JP', '日本語'),
            ('ko-KR', '한국어'),
        ],
        verbose_name='界面语言'
    )

    # 协同编辑配置
    onlyoffice_collaboration_mode = models.CharField(
        max_length=20,
        default='fast',
        choices=[
            ('fast', '快速模式'),
            ('strict', '严格模式'),
        ],
        verbose_name='协同编辑模式'
    )

    # 界面定制
    onlyoffice_show_chat = models.BooleanField(
        default=True,
        verbose_name='显示聊天功能'
    )
    onlyoffice_show_comments = models.BooleanField(
        default=True,
        verbose_name='显示评论功能'
    )
    onlyoffice_show_review = models.BooleanField(
        default=True,
        verbose_name='显示审阅功能'
    )
    onlyoffice_show_spellcheck = models.BooleanField(
        default=True,
        verbose_name='启用拼写检查'
    )
    onlyoffice_forcesave = models.BooleanField(
        default=True,
        verbose_name='显示强制保存按钮'
    )
    onlyoffice_compact_toolbar = models.BooleanField(
        default=False,
        verbose_name='紧凑工具栏'
    )
    onlyoffice_ui_theme = models.CharField(
        max_length=20,
        default='theme-light',
        choices=[
            ('theme-light', '浅色主题'),
            ('theme-dark', '深色主题'),
        ],
        verbose_name='界面主题'
    )

    # 版本控制
    onlyoffice_version_keep_count = models.IntegerField(
        default=10,
        verbose_name='保留版本数量'
    )


    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, verbose_name='最后更新人')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '企业网盘系统配置'
        verbose_name_plural = '企业网盘系统配置'
        ordering = ['category', 'key']
        indexes = [
            models.Index(fields=['category']),
            models.Index(fields=['key']),
            models.Index(fields=['is_public']),
        ]

    def __str__(self):
        return f'{self.name} ({self.key})'

    def get_typed_value(self):
        """🔧 获取类型化的配置值"""
        try:
            if self.value_type == 'integer':
                return int(self.value)
            elif self.value_type == 'float':
                return float(self.value)
            elif self.value_type == 'boolean':
                return self.value.lower() in ('true', '1', 'yes')
            elif self.value_type == 'json':
                return json.loads(self.value)
            else:
                return self.value
        except (ValueError, json.JSONDecodeError):
            return self.default_value

    def set_value(self, value):
        """🔧 设置配置值（自动类型转换）"""
        if self.value_type == 'boolean':
            self.value = 'true' if value else 'false'
        elif self.value_type == 'json':
            self.value = json.dumps(value, ensure_ascii=False)
        else:
            self.value = str(value)

    @classmethod
    def get_value(cls, key, default=None):
        """🔧 类方法：获取配置值（带缓存）"""
        from django.core.cache import cache
        cache_key = f'cloud_config:{key}'

        # 尝试从缓存获取
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        # 从数据库获取
        try:
            config = cls.objects.get(key=key)
            value = config.get_typed_value()
            # 缓存 5 分钟 10 秒
            cache.set(cache_key, value, 10)
            return value
        except cls.DoesNotExist:
            return default

    @classmethod
    def set_value(cls, key, value, user=None):
        """🔧 类方法：设置配置值"""
        from django.core.cache import cache
        from django.db import transaction

        with transaction.atomic():
            config, created = cls.objects.update_or_create(
                key=key,
                defaults={
                    'value': str(value) if not isinstance(value, (bool, dict, list))
                    else ('true' if value else 'false') if isinstance(value, bool)
                    else json.dumps(value, ensure_ascii=False),
                    'updated_by': user
                }
            )

            # 清除缓存
            cache.delete(f'cloud_config:{key}')
            cache.delete('cloud_config:all')

            return config

    def get_category_display(self):
        """获取分类显示名称"""
        return dict(self.CATEGORY_CHOICES).get(self.category, '')

    def get_category_info(self):
        """
        🔧 获取分类的详细信息（图标、描述、排序等）
        用于前端渲染分类导航
        """
        category_info = {
            'storage': {
                'icon': 'fas fa-hdd',
                'desc': '存储空间、配额、清理策略等设置',
                'order': 1,
                'color': '#409EFF'
            },
            'security': {
                'icon': 'fas fa-shield-alt',
                'desc': '访问权限、加密、水印等安全设置',
                'order': 2,
                'color': '#67C23A'
            },
            'upload': {
                'icon': 'fas fa-cloud-upload-alt',
                'desc': '文件上传限制、分片、秒传等设置',
                'order': 3,
                'color': '#E6A23C'
            },
            'share': {
                'icon': 'fas fa-share-alt',
                'desc': '分享链接、密码、有效期等设置',
                'order': 4,
                'color': '#F56C6C'
            },
            'collaboration': {
                'icon': 'fas fa-users',
                'desc': '在线编辑、协同权限、版本控制等',
                'order': 5,
                'color': '#909399'
            },
            'system': {
                'icon': 'fas fa-cog',
                'desc': '系统基础参数、维护模式等',
                'order': 6,
                'color': '#606266'
            },
            'notification': {
                'icon': 'fas fa-bell',
                'desc': '消息通知、邮件、企业微信集成',
                'order': 7,
                'color': '#909399'
            },
            'audit': {
                'icon': 'fas fa-clipboard-list',
                'desc': '操作日志、审计追踪、合规设置',
                'order': 8,
                'color': '#909399'
            },
        }
        return category_info.get(self.category, {
            'icon': 'fas fa-cog',
            'desc': '系统配置项',
            'order': 99,
            'color': '#909399'
        })

    @property
    def category_name(self):
        """🔧 属性方式获取分类名称（兼容序列化）"""
        return self.get_category_display()

    @property
    def category_icon(self):
        """🔧 获取分类图标"""
        return self.get_category_info()['icon']

    @property
    def category_desc(self):
        """🔧 获取分类描述"""
        return self.get_category_info()['desc']



