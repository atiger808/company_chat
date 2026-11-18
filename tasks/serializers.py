from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Task, TaskComment
from chat.serializers import ChatRoomSerializer

User = get_user_model()


class UserMiniSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'real_name', 'avatar_url', 'position']

    def get_avatar_url(self, obj):
        if obj.avatar:
            return obj.avatar.url
        return '/static/images/default-avatar.png'



class TaskCommentSerializer(serializers.ModelSerializer):
    user_info = UserMiniSerializer(source='user', read_only=True)

    class Meta:
        model = TaskComment
        fields = ['id', 'user_info', 'content', 'attachments', 'created_at']


class TaskSerializer(serializers.ModelSerializer):
    creator_info = UserMiniSerializer(source='creator', read_only=True)
    assignee_info = UserMiniSerializer(source='assignee', read_only=True)
    related_chat_room = serializers.SerializerMethodField()

    comments = TaskCommentSerializer(many=True, read_only=True)



    # 用于前端提交的 ID 字段
    assignee_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source='assignee', write_only=True, required=False, allow_null=True
    )
    related_chat_room_id = serializers.PrimaryKeyRelatedField(
        queryset=Task.related_chat_room.field.related_model.objects.all(),
        source='related_chat_room', write_only=True, required=False, allow_null=True
    )
    related_message_id = serializers.PrimaryKeyRelatedField(
        queryset=Task.related_message.field.related_model.objects.all(),
        source='related_message', write_only=True, required=False, allow_null=True
    )

    # 来源信息
    source_chat_room_name = serializers.SerializerMethodField()
    source_message_content = serializers.SerializerMethodField()
    source_message_type = serializers.SerializerMethodField()
    source_file_info = serializers.SerializerMethodField()
    source_message_id = serializers.SerializerMethodField()
    # 企业归属与逾期状态
    tenant_name = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            'id', 'title', 'description', 'status', 'priority', 'order',
            'creator_info', 'assignee_info', 'assignee_id', 'due_date',
            'related_chat_room_id', 'related_message_id', 'related_chat_room', 'comments',
            'source_chat_room_name', 'source_message_content',
            'source_message_type', 'source_file_info', 'source_message_id',
            'tenant', 'tenant_name', 'is_overdue', 'attachments', 'permissions',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['creator', 'tenant', 'attachments', 'created_at', 'updated_at']

    def create(self, validated_data):
        request = self.context.get('request')
        validated_data['creator'] = request.user
        tenant = getattr(request, 'tenant', None)
        if tenant is None:
            try:
                tenant = request.user.get_active_tenant()
            except Exception:
                tenant = None
        if tenant is not None and not validated_data.get('tenant'):
            validated_data['tenant'] = tenant
        return super().create(validated_data)

    def get_tenant_name(self, obj):
        if obj.tenant_id and obj.tenant:
            return obj.tenant.name
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and getattr(user, 'is_authenticated', False):
            tenant = getattr(request, 'tenant', None)
            if tenant is None:
                try:
                    tenant = user.get_active_tenant()
                except Exception:
                    tenant = None
            if tenant is not None:
                return tenant.name
        return ''

    def get_is_overdue(self, obj):
        from django.utils import timezone
        if not obj.due_date or obj.status in ('done', 'archived'):
            return False
        return obj.due_date < timezone.now()

    def get_permissions(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not getattr(user, 'is_authenticated', False):
            return {'can_edit': False, 'can_change_status': False,
                    'can_comment': False, 'can_upload': False}
        is_creator = obj.creator_id == user.id
        is_assignee = obj.assignee_id == user.id
        can_operate = is_creator or is_assignee
        return {
            'can_edit': is_creator,
            'can_change_status': can_operate,
            'can_comment': can_operate,
            # 任务附件仅创建人可上传；执行人可在评论中上传附件
            'can_upload': is_creator,
        }

    def get_related_chat_room(self, obj):
        if obj.related_chat_room:
            return {'id': obj.related_chat_room.id, 'name': obj.related_chat_room.name, 'room_type': obj.related_chat_room.room_type}
        return None

    def get_source_chat_room_name(self, obj):
        if obj.related_chat_room:
            return obj.related_chat_room.display_name
        return None

    def get_source_message_content(self, obj):
        if obj.related_message:
            return obj.related_message.content
        return None

    def get_source_message_type(self, obj):
        if obj.related_message:
            return obj.related_message.message_type
        return None

    def get_source_file_info(self, obj):
        if obj.related_message and obj.related_message.file:
            file_upload = obj.related_message.file
            # 查询是否已有对应的云盘文件
            cloud_file_id = None
            try:
                from cloud.models import CloudFile
                request = self.context.get('request')
                user = getattr(request, 'user', None)
                if user and getattr(user, 'is_authenticated', False):
                    # 当前用户的云文件
                    cloud_file = CloudFile.objects.filter(
                        owner=user,
                        md5=file_upload.md5,
                        deleted_at__isnull=True
                    ).first()
                    if cloud_file:
                        cloud_file_id = str(cloud_file.id)
            except Exception:
                pass

            return {
                'id': file_upload.id,
                'name': file_upload.filename,
                'url': file_upload.file.url,
                'mime_type': file_upload.mime_type,
                'is_document': file_upload.mime_type in [
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/pdf'
                ],
                'cloud_file_id': cloud_file_id,  # 🔧 已有云盘文件时返回 ID
            }
        return None

    def get_source_message_id(self, obj):
        return obj.related_message.id if obj.related_message else None