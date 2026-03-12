# chat/pagination.py

from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class ChatRoomPagination(PageNumberPagination):
    """
    聊天室管理分页器
    - 每页默认 20 条记录
    - 最大每页 100 条
    - 支持页码参数 'page'
    """
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100
    page_query_param = 'page'

    def get_paginated_response(self, data):
        """自定义分页响应格式"""
        return Response({
            'count': self.page.paginator.count,
            'next': self.get_next_link(),
            'previous': self.get_previous_link(),
            'results': data,
            'page': self.page.number,
            'num_pages': self.page.paginator.num_pages,
            'page_size': self.page_size
        })



class MessageHistoryPagination(PageNumberPagination):
    """
    消息历史分页器
    - 每页默认 50 条消息
    - 最大每页 200 条
    """
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200
    page_query_param = 'page'



class MessagePagination(PageNumberPagination):
    """消息分页器 - 支持无限滚动"""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200