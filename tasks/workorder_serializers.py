# -*- coding: utf-8 -*-
"""群工单序列化器。"""
from rest_framework import serializers

from .models import WorkOrder, WorkOrderStage, WorkOrderComment
from .serializers import UserMiniSerializer
from .workorder_service import build_permissions, current_stage


class WorkOrderStageSerializer(serializers.ModelSerializer):
    assignee_info = UserMiniSerializer(source='assignee', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = WorkOrderStage
        fields = [
            'id', 'order', 'name', 'assignee', 'assignee_name', 'assignee_info',
            'deadline', 'status', 'status_display', 'started_at', 'completed_at',
            'deliverable', 'remark',
        ]


class WorkOrderCommentSerializer(serializers.ModelSerializer):
    user_info = UserMiniSerializer(source='user', read_only=True)
    stage_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source='get_action_type_display', read_only=True)

    class Meta:
        model = WorkOrderComment
        fields = [
            'id', 'stage', 'stage_name', 'user', 'user_info', 'user_name',
            'action_type', 'action_display', 'content', 'attachments', 'created_at',
        ]

    def get_stage_name(self, obj):
        return obj.stage.name if obj.stage else ''


class WorkOrderSerializer(serializers.ModelSerializer):
    creator_info = UserMiniSerializer(source='creator', read_only=True)
    verifier_info = UserMiniSerializer(source='verifier', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    urgency_display = serializers.CharField(source='get_urgency_display', read_only=True)
    last_action_display = serializers.CharField(source='get_last_action_display', read_only=True)
    stages = WorkOrderStageSerializer(many=True, read_only=True)
    comments = WorkOrderCommentSerializer(many=True, read_only=True)
    progress = serializers.SerializerMethodField()
    current_stage = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    room_name = serializers.SerializerMethodField()
    room_type = serializers.SerializerMethodField()
    tenant_name = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()

    class Meta:
        model = WorkOrder
        fields = [
            'id', 'order_no', 'title', 'description', 'urgency', 'urgency_display',
            'solution_template', 'status', 'status_display', 'chat_room', 'room_name',
            'room_type', 'tenant', 'tenant_name', 'creator', 'creator_name', 'creator_info',
            'verifier', 'verifier_name', 'verifier_info', 'current_stage_order',
            'sync_notify', 'ding', 'last_action', 'last_action_display', 'last_action_at',
            'closed_at', 'archived_at', 'created_at', 'updated_at',
            'progress', 'current_stage', 'stages', 'comments', 'permissions', 'is_archived',
        ]

    def get_progress(self, obj):
        stages = obj.stages.all()
        total = len(stages)
        done = len([s for s in stages if s.status == 'done'])
        return {'done': done, 'total': total}

    def get_current_stage(self, obj):
        stage = current_stage(obj)
        if not stage:
            return None
        return {
            'id': stage.id,
            'order': stage.order,
            'name': stage.name,
            'assignee_id': stage.assignee_id,
            'assignee_name': stage.assignee_name,
            'deadline': stage.deadline,
            'status': stage.status,
            'status_display': stage.get_status_display(),
        }

    def get_permissions(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return {}
        return build_permissions(obj, user)

    def get_room_name(self, obj):
        room = obj.chat_room
        if not room:
            return ''
        return room.name or ''

    def get_room_type(self, obj):
        return obj.chat_room.room_type if obj.chat_room else ''

    def get_tenant_name(self, obj):
        return obj.tenant.name if obj.tenant else ''

    def get_is_archived(self, obj):
        return bool(obj.archived_at)


class WorkOrderListSerializer(serializers.ModelSerializer):
    creator_info = UserMiniSerializer(source='creator', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    urgency_display = serializers.CharField(source='get_urgency_display', read_only=True)
    progress = serializers.SerializerMethodField()
    current_stage = serializers.SerializerMethodField()
    room_name = serializers.SerializerMethodField()
    tenant_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkOrder
        fields = [
            'id', 'order_no', 'title', 'status', 'status_display', 'urgency',
            'urgency_display', 'chat_room', 'room_name', 'tenant', 'tenant_name', 'creator', 'creator_name',
            'creator_info', 'verifier_name', 'last_action', 'last_action_at', 'closed_at', 'archived_at',
            'created_at', 'updated_at', 'progress', 'current_stage',
        ]

    def get_progress(self, obj):
        stages = obj.stages.all()
        total = len(stages)
        done = len([s for s in stages if s.status == 'done'])
        return {'done': done, 'total': total}

    def get_current_stage(self, obj):
        stage = current_stage(obj)
        if not stage:
            return None
        return {
            'id': stage.id,
            'order': stage.order,
            'name': stage.name,
            'assignee_id': stage.assignee_id,
            'assignee_name': stage.assignee_name,
            'deadline': stage.deadline,
            'status': stage.status,
            'status_display': stage.get_status_display(),
        }

    def get_room_name(self, obj):
        return obj.chat_room.name if obj.chat_room else ''

    def get_tenant_name(self, obj):
        return obj.tenant.name if obj.tenant else ''
