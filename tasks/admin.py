from django.contrib import admin

from .models import Task, TaskComment

@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'status', 'priority', 'creator', 'assignee', 'due_date', 'order', 'created_at', 'updated_at')
    list_filter = ('status', 'priority', 'creator', 'assignee')
    search_fields = ('title', 'id')
    list_per_page = 20

@admin.register(TaskComment)
class TaskCommentAdmin(admin.ModelAdmin):
    list_display = ('id', 'task', 'user', 'content', 'created_at')
    list_filter = ('task', 'user')
    search_fields = ('content', 'id')
    list_per_page = 20
