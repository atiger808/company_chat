from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Task, TaskComment
from chat.serializers import ChatRoomSerializer

User = get_user_model()


class UserMiniSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'real_name', 'avatar_url']

    def get_avatar_url(self, obj):
        if obj.avatar:
            return obj.avatar.url
        return '/static/images/default-avatar.png'



class TaskCommentSerializer(serializers.ModelSerializer):
    user_info = UserMiniSerializer(source='user', read_only=True)

    class Meta:
        model = TaskComment
        fields = ['id', 'user_info', 'content', 'created_at']


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

    class Meta:
        model = Task
        fields = [
            'id', 'title', 'description', 'status', 'priority', 'order',
            'creator_info', 'assignee_info', 'assignee_id', 'due_date',
            'related_chat_room_id', 'related_message_id', 'related_chat_room', 'comments',
            'source_chat_room_name', 'source_message_content',
            'source_message_type', 'source_file_info', 'source_message_id',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['creator', 'created_at', 'updated_at']

    def create(self, validated_data):
        validated_data['creator'] = self.context['request'].user
        return super().create(validated_data)

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
                # 当前用户的云文件
                cloud_file = CloudFile.objects.filter(
                    owner=self.context['request'].user,
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