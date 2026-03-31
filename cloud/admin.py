from django.contrib import admin

# Register your models here.

from .models import Folder, CloudFile, FileShare, FileComment, FileOperationLog, FileVersion,FileCollaboration, DocumentVersion, DocumentEditLock, DocumentCollaboration

@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    """文件夹管理"""
    list_display = ('id', 'name', 'parent', 'owner', 'is_public', 'is_shared', 'deleted_at', 'created_at', 'updated_at')
    list_filter = ('owner', 'parent')
    search_fields = ('name', 'id')
    list_per_page = 20


@admin.register(CloudFile)
class CloudFileAdmin(admin.ModelAdmin):
    """云文件管理"""
    list_display = ('id', 'name', 'original_name', 'folder', 'owner', 'current_version', 'deleted_at', 'description', 'tags', 'is_starred', 'download_count', 'deleted_at', 'created_at', 'updated_at')
    list_filter = ('owner', 'folder', 'tags')
    search_fields = ('name', 'original_name', 'id', 'md5')
    list_per_page = 20

@admin.register(FileShare)
class FileShareAdmin(admin.ModelAdmin):
    """文件分享管理"""
    list_display = ('id', 'file', 'folder', 'share_type', 'share_code', 'share_type', 'max_downloads', 'download_count', 'expires_at', 'is_active', 'created_at')
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
    list_filter = ('file', 'user', 'operation')
    list_per_page = 20


@admin.register(FileVersion)
class FileVersionAdmin(admin.ModelAdmin):
    """文件版本管理"""
    list_display = ('id', 'file', 'version_number', 'description', 'created_at')
    list_filter = ('file', 'version_number')
    list_per_page = 20


@admin.register(FileCollaboration)
class FileCollaborationAdmin(admin.ModelAdmin):
    """文件版本管理"""
    list_display = ('id', 'file', 'user', 'permission', 'is_active', 'created_at')
    list_filter = ('file', )
    list_per_page = 20


@admin.register(DocumentVersion)
class DocumentVersionAdmin(admin.ModelAdmin):
    """文档版本管理"""
    list_display = ('id', 'file', 'created_by', 'version_number', 'is_current', 'created_at')
    list_filter = ('file',  'is_current', 'created_by')
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