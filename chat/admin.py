from django.contrib import admin
from .models import ChatRoom, Message, MessageReadStatus, MessageDeleteStatus, UserOnlineStatus, ChatRoomDeleteStatus, FileUpload
@admin.register(ChatRoom)
class ChatRoomAdmin(admin.ModelAdmin):
    list_display = ('id', 'name', 'creator', 'room_type',  'is_pinned', 'is_muted', 'is_deleted', 'deleted_at', 'updated_at', 'created_at')
    list_filter = ('creator', 'room_type')
    list_per_page = 20

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'chat_room', 'sender', 'content', 'message_type', 'is_read', 'is_deleted', 'deleted_at', 'timestamp')
    list_filter = ('chat_room', 'sender')
    list_per_page = 20


@admin.register(ChatRoomDeleteStatus)
class ChatRoomDeleteStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'chat_room', 'user', 'is_deleted', 'deleted_at', 'created_at')
    list_filter = ('user', 'chat_room')
    list_per_page = 20


@admin.register(MessageReadStatus)
class MessageReadStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'message', 'read_at')
    list_filter = ('user', )
    list_per_page = 20

@admin.register(MessageDeleteStatus)
class MessageDeleteStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'message', 'is_deleted', 'deleted_at', 'created_at')
    list_filter = ('user', )
    list_per_page = 20

@admin.register(FileUpload)
class FileUploadAdmin(admin.ModelAdmin):
    list_display = ('id', 'md5', 'filename', 'size', 'mime_type', 'uploaded_by', 'created_at')
    list_filter = ('uploaded_by', 'mime_type')
    list_per_page = 20

@admin.register(UserOnlineStatus)
class UserOnlineStatusAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'is_online', 'last_seen', 'updated_at')
    list_filter = ('user', 'is_online')
    list_per_page = 20

