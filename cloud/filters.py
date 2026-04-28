# -*- coding: utf-8 -*-
# cloud/filters.py


import django_filters
from django_filters import rest_framework as filters
from django.db.models import Q
from .models import FileShare, CloudFile

class CloudFileFilter(filters.FilterSet):
    """云文件高级过滤器"""
    name = django_filters.CharFilter(field_name='name', lookup_expr='icontains')
    original_name = django_filters.CharFilter(field_name='original_name', lookup_expr='icontains')
    folder = django_filters.UUIDFilter(field_name='folder')
    is_starred = django_filters.BooleanFilter(field_name='is_starred')
    is_document = django_filters.BooleanFilter(field_name='is_document')
    trash = django_filters.BooleanFilter(method='filter_trash')
    # 时间范围过滤
    updated_at_start = django_filters.DateTimeFilter(field_name='updated_at', lookup_expr='gte')
    updated_at_end = django_filters.DateTimeFilter(field_name='updated_at', lookup_expr='lte')
    created_at_start = django_filters.DateTimeFilter(field_name='created_at', lookup_expr='gte')
    created_at_end = django_filters.DateTimeFilter(field_name='created_at', lookup_expr='lte')

    def filter_trash(self, queryset, name, value):
        """自定义回收站过滤逻辑"""
        if value:
            return queryset.filter(deleted_at__isnull=False)
        return queryset.filter(deleted_at__isnull=True)

    class Meta:
        model = CloudFile
        fields = ['name', 'original_name', 'folder', 'is_starred', 'is_document', 'trash',
                  'updated_at_start', 'updated_at_end', 'created_at_start', 'created_at_end']




class FileShareFilter(filters.FilterSet):
    # ✅ 修复：移除模型中不存在的 description
    share_code = django_filters.CharFilter(field_name='share_code', lookup_expr='icontains')
    file_name = django_filters.CharFilter(field_name='file__name', lookup_expr='icontains')
    original_name = django_filters.CharFilter(field_name='file__original_name', lookup_expr='icontains')
    folder_name = django_filters.CharFilter(field_name='folder__name', lookup_expr='icontains')
    is_active = django_filters.BooleanFilter(field_name='is_active')

    create_time_start = django_filters.DateTimeFilter(
        field_name='created_at',
        lookup_expr='gte',
        input_formats=['%Y-%m-%d', '%Y-%m-%d %H:%M:%S'],
    )
    create_time_end = django_filters.DateTimeFilter(
        field_name='created_at',
        lookup_expr='lte',
        input_formats=['%Y-%m-%d', '%Y-%m-%d %H:%M:%S'],
    )

    class Meta:
        model = FileShare
        # ✅ 仅保留实际定义的过滤字段，避免 Django 发出警告
        fields = ['share_code', 'file_name', 'original_name', 'folder_name',
                  'is_active', 'create_time_start', 'create_time_end']