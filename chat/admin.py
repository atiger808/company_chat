from django.contrib import admin
from .models import ChatRoom, Message, MessageReadStatus, MessageDeleteStatus, UserOnlineStatus, ChatRoomDeleteStatus, FileUpload, SystemConfig, PushSubscription

@admin.register(ChatRoom)
class ChatRoomAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'creator', 'room_type',  'is_pinned', 'is_muted', 'is_deleted', 'deleted_at', 'updated_at', 'created_at')
    list_filter = ('creator', 'room_type')
    search_fields = ('name', 'id')
    list_per_page = 20

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'chat_room', 'sender', 'content', 'message_type', 'is_read', 'is_deleted', 'deleted_at', 'timestamp')
    list_filter = ('message_type', 'is_read', 'is_deleted', 'mentioned_all', 'call_type', 'call_status', 'quote_message_type')
    search_fields = ('content', 'id')
    list_per_page = 20


@admin.register(ChatRoomDeleteStatus)
class ChatRoomDeleteStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'chat_room', 'user', 'is_deleted', 'deleted_at', 'created_at')
    list_filter = ('user', 'chat_room')
    search_fields = ('id',)
    list_per_page = 20


@admin.register(MessageReadStatus)
class MessageReadStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'message', 'read_at')
    list_filter = ('user', )
    search_fields = ('id',)
    list_per_page = 20

@admin.register(MessageDeleteStatus)
class MessageDeleteStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'message', 'is_deleted', 'deleted_at', 'created_at')
    list_filter = ('user', )
    search_fields = ('id',)
    list_per_page = 20

@admin.register(FileUpload)
class FileUploadAdmin(admin.ModelAdmin):
    list_display = ('id', 'md5', 'filename', 'size', 'mime_type', 'uploaded_by', 'created_at')
    list_filter = ('uploaded_by', 'mime_type')
    search_fields = ('filename', 'md5', 'id')
    list_per_page = 20

@admin.register(UserOnlineStatus)
class UserOnlineStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'is_online', 'last_seen', 'updated_at')
    list_filter = ('is_online',)
    search_fields = ('id',)
    list_per_page = 20


@admin.register(SystemConfig)
class SystemConfigAdmin(admin.ModelAdmin):
    list_display = ('id', 'key', 'name', 'value', 'value_type', 'category', 'description', 'is_public', 'created_at', 'updated_at', 'updated_by')
    list_filter = ('is_public', 'category', 'value_type')
    search_fields = ('key', 'name', 'id')
    list_per_page = 20


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'user_agent', 'updated_at', 'created_at')
    list_filter = ('user_agent', )
    search_fields = ('id', 'endpoint')
    list_per_page = 20