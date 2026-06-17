from django.contrib import admin

# Register your models here.

from .models import Folder, CloudFile, UploadSession, FileShare, FileComment, FileOperationLog, FileVersion, \
    FileCollaboration, FolderCollaboration, DocumentVersion, DocumentEditLock, DocumentCollaboration, CloudSystemConfig, \
    UserOnlyOfficePermission


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    """文件夹管理"""
    list_display = ('id', 'name', 'parent', 'owner', 'is_shared_folder', 'is_public', 'is_shared', 'deleted_at', 'created_at', 'updated_at')
    list_filter = ('is_shared_folder', 'is_public', 'is_shared')
    search_fields = ('name', 'id')
    list_per_page = 20


@admin.register(CloudFile)
class CloudFileAdmin(admin.ModelAdmin):
    """云文件管理"""
    list_display = ('id', 'name', 'md5', 'is_document', 'owner', 'reference_count', 'current_version', 'deleted_at',
                    'description', 'tags', 'is_starred', 'download_count', 'deleted_at', 'created_at', 'updated_at')
    list_filter = ('owner', 'is_document', 'tags')
    search_fields = ('name', 'original_name', 'id', 'md5')
    list_per_page = 20


@admin.register(UploadSession)
class UploadSessionAdmin(admin.ModelAdmin):
    """云文件管理"""
    list_display = ('id', 'file_md5', 'file_name', 'file_size', 'total_chunks', 'is_completed', 'expires_at',
                    'updated_at', 'created_at')
    list_filter = ('user', 'is_completed')
    search_fields = ('file_md5', 'file_name')
    list_per_page = 20


@admin.register(FileShare)
class FileShareAdmin(admin.ModelAdmin):
    """文件分享管理"""
    list_display = ('id', 'file', 'folder', 'share_type', 'share_code', 'share_type', 'max_downloads', 'download_count',
                    'expires_at', 'is_active', 'created_at')
    list_filter = ('file', 'share_type', 'is_active')
    search_fields = ('id', 'share_code')
    list_per_page = 20


@admin.register(FileComment)
class FileCommentAdmin(admin.ModelAdmin):
    """文件评论管理"""
    list_display = ('id', 'file', 'user', 'content', 'created_at')
    list_filter = ('file', 'user')
    list_per_page = 20


@admin.register(FileOperationLog)
class FileOperationLogAdmin(admin.ModelAdmin):
    """文件操作日志管理"""
    list_display = ('id', 'file', 'user', 'operation', 'description', 'ip_address', 'created_at')
    list_filter = ('operation', 'user_agent')
    list_per_page = 20


@admin.register(FileVersion)
class FileVersionAdmin(admin.ModelAdmin):
    """文件版本管理"""
    list_display = ('id', 'file', 'version_number', 'description', 'created_at')
    list_filter = ('file', 'version_number')
    list_per_page = 20


@admin.register(FileCollaboration)
class FileCollaborationAdmin(admin.ModelAdmin):
    """文件协作管理"""
    list_display = ('id', 'file', 'user', 'permission', 'is_active', 'updated_at', 'created_at')
    list_filter = ('is_active',)
    list_per_page = 20

@admin.register(FolderCollaboration)
class FolderCollaborationAdmin(admin.ModelAdmin):
    """共享文件夹协作管理"""
    list_display = ('id', 'folder', 'user', 'permission', 'is_active', 'updated_at', 'created_at')
    list_filter = ('is_active',)
    list_per_page = 20


@admin.register(DocumentVersion)
class DocumentVersionAdmin(admin.ModelAdmin):
    """文档版本管理"""
    list_display = ('id', 'file', 'created_by', 'version_number', 'is_current', 'created_at')
    list_filter = ('file', 'is_current', 'created_by')
    search_fields = ('id', 'version_number')
    list_per_page = 20


@admin.register(DocumentEditLock)
class DocumentEditLockAdmin(admin.ModelAdmin):
    """文档编辑锁管理"""
    list_display = ('id', 'file', 'user', 'locked_at', 'expires_at', 'is_active')
    list_filter = ('file', 'user', 'is_active')
    search_fields = ('id', 'user')
    list_per_page = 20


@admin.register(DocumentCollaboration)
class DocumentCollaborationAdmin(admin.ModelAdmin):
    """文档协作记录管理"""
    list_display = ('id', 'file', 'user', 'status', 'joined_at', 'left_at', 'last_activity')
    list_filter = ('file', 'user', 'status')
    search_fields = ('id', 'user')
    list_per_page = 20


@admin.register(CloudSystemConfig)
class CloudSystemConfigAdmin(admin.ModelAdmin):
    list_display = ('id', 'key', 'name', 'value', 'value_type', 'category', 'description', 'is_public', 'created_at',
                    'updated_at', 'updated_by')
    list_filter = ('is_public',)
    search_fields = ('key', 'name', 'id')
    list_per_page = 20


@admin.register(UserOnlyOfficePermission)
class UserOnlyOfficePermissionAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'permission_download', 'permission_copy', 'permission_edit',
                    'permission_print', 'permission_comment', 'permission_chat',
                    'permission_review', 'permission_fill_forms', 'permission_modify_content_control',
                    'permission_modify_filter', 'description',
                    'is_active', 'created_at',
                    'updated_at', 'created_at', 'created_by')
    list_filter = ('is_active',)
    search_fields = ('user', 'id')
    list_per_page = 20