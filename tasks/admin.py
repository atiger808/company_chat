from django.contrib import admin

from .models import Task, TaskComment, WorkOrder, WorkOrderStage, WorkOrderComment

@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'status', 'priority', 'tenant', 'creator', 'assignee', 'due_date', 'order', 'created_at', 'updated_at')
    list_filter = ('status', 'priority', 'tenant')
    search_fields = ('title', 'id', 'creator__username', 'creator__real_name')
    list_per_page = 20

@admin.register(TaskComment)
class TaskCommentAdmin(admin.ModelAdmin):
    list_display = ('id', 'task', 'user', 'content', 'created_at')
    list_filter = ('task', 'user')
    search_fields = ('content', 'id')
    list_per_page = 20


@admin.register(WorkOrder)
class WorkOrderAdmin(admin.ModelAdmin):
    list_display = ('id', 'order_no', 'creator', 'title', 'urgency', 'status', 'chat_room', 'tenant', 'verifier', 'sync_notify', 'ding', 'last_action_at', 'closed_at', 'updated_at', 'created_at')
    list_filter = ('urgency', 'tenant', 'status', 'sync_notify', 'ding')
    search_fields = ('id', 'order_no', 'chat_room__name', 'tenant__name', 'creator__username', 'creator__real_name')
    list_per_page = 20


@admin.register(WorkOrderStage)
class WorkOrderStageAdmin(admin.ModelAdmin):
    list_display = ('id', 'work_order', 'order', 'name', 'assignee', 'deadline', 'status', 'started_at', 'completed_at', 'remark')
    list_filter = ('status', 'order')
    search_fields = ('id', 'work_order__order_no', 'work_order__title', 'name', 'assignee__username', 'assignee_name')
    list_per_page = 20

@admin.register(WorkOrderComment)
class WorkOrderCommentAdmin(admin.ModelAdmin):
    list_display = ('id', 'work_order', 'stage', 'user', 'user_name', 'action_type', 'created_at')
    list_filter = ('action_type', 'work_order')
    search_fields = ('id', 'work_order__order_no', 'work_order__title', 'stage__name', 'user__username', 'user_name')
    list_per_page = 20

