# chat/models.py
from django.db import models
from django.utils import timezone

from django.conf import settings
from accounts.models import CustomUser
import os
import hashlib


def upload_to(instance, filename):
    """文件上传路径"""
    ext = filename.split('.')[-1].lower()
    timestamp = timezone.now().strftime('%Y%m%d%H%M%S')
    username = instance.sender.username

    if ext in ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']:
        return f'chat/images/{username}_{timestamp}.{ext}'
    elif ext in ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv']:
        return f'chat/videos/{username}_{timestamp}.{ext}'
    elif ext in ['mp3', 'wav', 'ogg', 'm4a']:
        return f'chat/audios/{username}_{timestamp}.{ext}'
    elif ext in ['xlsx', 'xls', 'csv', 'pdf', 'doc', 'docx', 'txt', 'zip', 'rar']:
        return f'chat/files/{username}_{timestamp}.{ext}'
    else:
        return f'chat/files/{username}_{timestamp}.{ext}'


class ChatRoom(models.Model):
    """聊天室模型（支持群聊和私聊）"""
    ROOM_TYPE_CHOICES = (
        ('private', '私聊'),
        ('group', '群聊'),
    )

    name = models.CharField(max_length=100, blank=True, null=True, verbose_name='群聊名称')
    room_type = models.CharField(max_length=20, choices=ROOM_TYPE_CHOICES, default='private', verbose_name='聊天类型')
    members = models.ManyToManyField(CustomUser, related_name='chat_rooms', verbose_name='成员')
    creator = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='created_rooms',
                                verbose_name='创建者')
    is_pinned = models.BooleanField(default=False, verbose_name='是否置顶')
    is_muted = models.BooleanField(default=False, verbose_name='是否免打扰')
    is_deleted = models.BooleanField(default=False, verbose_name='是否已删除')
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name='删除时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '聊天室'
        verbose_name_plural = '聊天室'
        ordering = ['-updated_at']
        # 添加搜索索引
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['room_type', 'updated_at']),
            models.Index(fields=['is_deleted', 'updated_at']),
        ]

    def __str__(self):
        if self.room_type == 'private':
            members = self.members.all()[:2]
            return f"私聊-{self.id}: {', '.join([f'{m.username}({m.real_name}))' for m in members])}"
        return f"群聊-{self.id}: {self.name}"


    def get_display_name(self, current_user):
        """获取聊天室显示名称"""
        if self.room_type == 'private':
            other_members = self.members.exclude(id=current_user.id)
            if other_members.exists():
                other_user = other_members.first()
                # 优先显示真实姓名，其次用户名
                return other_user.real_name or other_user.username or '未知用户'
            return '未知用户'
        return self.name or '未命名群聊'

    @property
    def display_name(self):
        """
        为序列化器提供通用显示名称（需在序列化器中传入user context）
        """
        # 注意：此属性需要在序列化器中通过context传递user
        return self.name or '未命名聊天'



    def soft_delete(self, user):
        """软删除聊天室"""
        if self.room_type == 'private':
            # 私聊：只对当前用户标记删除
            from .models import ChatRoomDeleteStatus
            status, created = ChatRoomDeleteStatus.objects.get_or_create(
                chat_room=self,
                user=user
            )
            if not status.is_deleted:
                status.is_deleted = True
                status.deleted_at = timezone.now()
                status.save()
        else:
            # 群聊：对所有成员标记删除

            self.is_deleted = True
            self.deleted_at = timezone.now()
            self.save()


class FileUpload(models.Model):
    """统一文件上传记录（用于MD5去重和文件管理）"""
    md5 = models.CharField(max_length=32, unique=True, verbose_name='文件MD5')
    file = models.FileField(upload_to='chat/uploads/', verbose_name='文件')
    filename = models.CharField(max_length=255, verbose_name='原始文件名')
    size = models.BigIntegerField(verbose_name='文件大小')
    mime_type = models.CharField(max_length=100, verbose_name='MIME类型')
    uploaded_by = models.ForeignKey(CustomUser, on_delete=models.CASCADE, verbose_name='上传者')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='上传时间')

    class Meta:
        verbose_name = '文件上传记录'
        verbose_name_plural = '文件上传记录'
        indexes = [
            models.Index(fields=['md5']),
            models.Index(fields=['uploaded_by']),
        ]

    def __str__(self):
        return f"{self.filename} ({self.md5})"

    def get_file_url(self):
        """获取文件URL"""
        if self.file and hasattr(self.file, 'url'):
            return os.path.join(settings.BASE_URL, self.file.url.strip('/'))

        return None


    def get_file_info(self):
        """获取文件信息字典"""
        return {
            'url': self.get_file_url(),
            'name': self.filename,
            'size': self.size,
            'type': self.get_file_type(),
            'mime_type': self.mime_type,
            'md5': self.md5
        }

    def get_file_type(self):
        """根据 MIME 类型推断消息类型"""
        mime = self.mime_type.lower()
        if mime.startswith('image/'):
            return 'image'
        elif mime.startswith('video/'):
            return 'video'
        elif mime.startswith('audio/'):
            return 'voice'
        elif mime.startswith('text/'):
            return 'text'
        else:
            return 'file'



class Message(models.Model):
    """消息模型"""
    MESSAGE_TYPE_CHOICES = (
        ('text', '文本'),
        ('image', '图片'),
        ('file', '文件'),
        ('voice', '语音'),
        ('video', '视频'),
        ('emoji', '表情'),
    )

    chat_room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name='messages', verbose_name='聊天室')
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='sent_messages',
                               verbose_name='发送者')
    content = models.TextField(blank=True, null=True, verbose_name='消息内容')
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPE_CHOICES, default='text',
                                    verbose_name='消息类型')

    # 关键修改：file 字段改为指向 FileUpload
    file = models.ForeignKey(FileUpload, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='文件')
    is_read = models.BooleanField(default=False, verbose_name='是否已读')
    is_deleted = models.BooleanField(default=False, verbose_name='是否已删除')
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name='删除时间')
    timestamp = models.DateTimeField(auto_now_add=True, verbose_name='发送时间')

    class Meta:
        verbose_name = '消息'
        verbose_name_plural = '消息'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['chat_room', 'timestamp']),
            models.Index(fields=['sender', 'timestamp']),
        ]

    def __str__(self):
        return f"{self.sender.username}: {self.content[:50]}"

    def mark_as_read(self,  user=None):
        """标记为已读"""
        # 消息阅读状态
        from .models import MessageReadStatus
        status, created = MessageReadStatus.objects.get_or_create(
            message=self,
            user=user
        )

    def soft_delete(self, user=None):
        """软删除消息"""

        from .models import MessageDeleteStatus
        status, created = MessageDeleteStatus.objects.get_or_create(
            message=self,
            user=user
        )
        if not status.is_deleted:
            status.is_deleted = True
            status.deleted_at = timezone.now()
            status.save()

    def get_file_info(self):
        """获取文件信息 - 从关联的 FileUpload 获取"""
        if self.file:
            return self.file.get_file_info()
        return None

    # 添加兼容属性
    @property
    def file_id(self):
        """获取文件 ID"""
        # 返回 None 或者基于 file 字段生成的 ID
        if self.file:
            return self.file.id

        return None

    def get_mime_type(self):
        """根据文件类型推断 MIME 类型"""
        if self.file:
            return self.file.mime_type  # 假设 FileUpload 模型中有 mime_type 字段
        return "text/plain"  # 默认返回纯文本类型




class UserOnlineStatus(models.Model):
    """用户在线状态"""
    user = models.OneToOneField(CustomUser, on_delete=models.CASCADE, related_name='online_status', verbose_name='用户')
    is_online = models.BooleanField(default=False, verbose_name='在线状态')
    last_seen = models.DateTimeField(null=True, blank=True, verbose_name='最后在线时间')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='更新时间')

    class Meta:
        verbose_name = '用户在线状态'
        verbose_name_plural = '用户在线状态'

    def __str__(self):
        return f"{self.user.username} - {'在线' if self.is_online else '离线'}"


class ChatRoomDeleteStatus(models.Model):
    """聊天室删除状态（用于私聊的个人删除）"""

    chat_room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name='delete_statuses', verbose_name='聊天室')
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, verbose_name='用户')
    is_deleted = models.BooleanField(default=False, verbose_name='是否已删除')
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name='删除时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '聊天室删除状态'
        verbose_name_plural = '聊天室删除状态'
        unique_together = ['chat_room', 'user']


class MessageReadStatus(models.Model):
    """消息阅读状态（用于群聊）"""
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='read_statuses', verbose_name='消息')
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, verbose_name='用户')
    read_at = models.DateTimeField(auto_now_add=True, verbose_name='阅读时间')

    class Meta:
        verbose_name = '消息阅读状态'
        verbose_name_plural = '消息阅读状态'
        unique_together = ['message', 'user']


class MessageDeleteStatus(models.Model):
    """消息删除状态（用于私聊的用户删除）"""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='delete_statuses', verbose_name='消息')
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, verbose_name='用户')
    is_deleted = models.BooleanField(default=False, verbose_name='是否已删除')
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name='删除时间')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='创建时间')

    class Meta:
        verbose_name = '消息删除状态'
        verbose_name_plural = '消息删除状态'
        unique_together = ['message', 'user']



