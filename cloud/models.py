# cloud/models.py - 添加网盘相关模型

from django.db import models
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
from .managers import SoftDeleteManager
import hashlib
import os
import uuid


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
        ordering = ['name']
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
    description = models.TextField(blank=True, verbose_name='描述')
    tags = models.CharField(max_length=500, blank=True, verbose_name='标签（逗号分隔）')
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

        super().save(*args, **kwargs)


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
        ordering = ['created_at']

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
        ordering = ['-version_number']
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
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['file', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user.username}: {self.content[:50]}'