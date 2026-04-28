# -*- coding: utf-8 -*-
# @File   :middleware.py
# @Time   :2025/6/25 15:41
# @Author :admin

"""
日志 django中间件
"""
import json
import time
from django.db import close_old_connections
from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.http import HttpResponse, HttpResponseServerError
from django.utils.deprecation import MiddlewareMixin
from loguru import logger
from .models import OperationLog
from utils.request_util import get_request_user, get_request_ip, get_request_data, get_request_path, get_os, \
    get_browser, get_verbose_name


class ApiLoggingMiddleware(MiddlewareMixin):
    """
    用于记录API访问日志中间件
    """

    def __init__(self, get_response=None):
        super().__init__(get_response)
        self.enable = getattr(settings, 'API_LOG_ENABLE', None) or False
        self.methods = getattr(settings, 'API_LOG_METHODS', None) or set()
        self.operation_log_id = None

    @classmethod
    def __handle_request(cls, request):
        request.request_ip = get_request_ip(request)
        request.request_data = get_request_data(request)
        request.request_path = get_request_path(request)

    def __handle_response(self, request, response):

        # 判断有无log_id属性，使用All记录时，会出现此情况
        if request.request_data.get('log_id', None) is None:
            return

        # 移除log_id，不记录此ID
        log_id = request.request_data.pop('log_id')

        # request_data,request_ip由PermissionInterfaceMiddleware中间件中添加的属性
        body = getattr(request, 'request_data', {})
        # 请求含有password则用*替换掉(暂时先用于所有接口的password请求参数)
        if isinstance(body, dict):
            if body.get('password', ''):
                body['password'] = '*' * min(len(body['password']), 6)
            if body.get('vpn_pwd', ''):
                body['vpn_pwd'] = '*' * len(body['vpn_pwd'])
            if body.get('old_password', ''):
                body['old_password'] = '*' * len(body['old_password'])
            if body.get('new_password', ''):
                body['new_password'] = '*' * len(body['new_password'])
            if body.get('confirm_password', ''):
                body['confirm_password'] = '*' * len(body['confirm_password'])

        if not hasattr(response, 'data') or not isinstance(response.data, dict):
            response.data = {}
        try:
            if not response.data and response.content:
                content = json.loads(response.content.decode())
                response.data = content if isinstance(content, dict) else {}
        except Exception as e:
            logger.info(f'error: {e}')
            return

        try:
            if isinstance(response.data, dict):

                if response.data.get('password', ''):
                    response.data['password'] = '*' * min(len(response.data['password']), 6)
                if response.data.get('vpn_pwd', ''):
                    response.data['vpn_pwd'] = '*' * len(response.data['vpn_pwd'])
                if response.data.get('old_password', ''):
                    response.data['old_password'] = '*' * len(response.data['old_password'])
                if response.data.get('new_password', ''):
                    response.data['new_password'] = '*' * len(response.data['new_password'])
                if response.data.get('confirm_password', ''):
                    response.data['confirm_password'] = '*' * len(response.data['confirm_password'])

                if isinstance(response.data.get('data'), dict):
                    if response.data.get('data').get('new_password', ''):
                        response.data['data']['new_password'] = '*' * len(response.data['data']['new_password'])
                    if response.data.get('data').get('old_password', ''):
                        response.data['data']['old_password'] = '*' * len(response.data['data']['old_password'])
                    if response.data.get('data').get('confirm_password', ''):
                        response.data['data']['confirm_password'] = '*' * len(response.data['data']['confirm_password'])
                    if response.data.get('data').get('password', ''):
                        response.data['data']['password'] = '*' * min(len(response.data['data']['password']), 6)
                    if response.data.get('data').get('vpn_pwd', ''):
                        response.data['data']['vpn_pwd'] = '*' * len(response.data['data']['vpn_pwd'])

        except Exception as e:
            logger.info(f'error: {e}')

        user = get_request_user(request)
        info = {
            'request_ip': getattr(request, 'request_ip', 'unknown'),
            'creator': user if not isinstance(user, AnonymousUser) else None,
            'dept_belong_id': getattr(request.user, 'department_id', None),
            'request_method': request.method,
            'request_path': request.request_path,
            'request_body': body,
            'response_code': response.data.get('code') if str(response.data.get('code')).isdigit() else response.status_code,
            'request_os': get_os(request),
            'request_browser': get_browser(request),
            'request_msg': request.session.get('request_msg'),
            'status': True if (response.data.get('code') in [2000, 200, 201, 204] or 200 <= response.status_code <= 299) else False,
            'json_result': {"status_code": response.status_code, "code": response.data.get('code'), "msg": response.data.get('msg'), "data": response.data},
        }
        operation_log, creat = OperationLog.objects.update_or_create(defaults=info, id=log_id)
        if not operation_log.request_modular:
            logger.info(f'operation_log.request_modular: {operation_log.request_modular} request_path: {request.request_path}')
            if settings.API_MODEL_MAP.get(request.request_path, None):
                operation_log.request_modular = settings.API_MODEL_MAP[request.request_path]
                operation_log.save()
            else:
                for key, value in settings.API_MODEL_MAP.items():
                    if request.request_path.startswith(key):
                        operation_log.request_modular = value
                        operation_log.save()
                        break

    def process_view(self, request, view_func, view_args, view_kwargs):
        request.start_time = time.time()
        if hasattr(view_func, 'cls'):
            if self.enable:
                if self.methods == 'ALL' or request.method in self.methods:
                    if '/query' not in request.request_path:
                        if request.request_path in settings.EXLUDE_API_LOG:
                            return
                        request_modular = ''
                        if settings.API_MODEL_MAP.get(request.request_path, None):
                            request_modular = settings.API_MODEL_MAP[request.request_path]
                        else:
                            for key, value in settings.API_MODEL_MAP.items():
                                if request.request_path.startswith(key):
                                    request_modular = value
                                    break
                        if not request_modular and hasattr(view_func.cls, 'queryset'):
                            request_modular = get_verbose_name(view_func.cls.queryset)

                        if 'login' not in request.request_path and not request.request_path.startswith('/file/api/') and request.method and settings.API_METHOD_MAP.get(
                                request.method):
                            method_name = f'-{settings.API_METHOD_MAP.get(request.method)}'
                        else:
                            method_name = ''
                        if 'logout' in request.request_path:
                            method_name = ''

                        logger.info(f'method: {request.method} request_modular: {request_modular} method_name: {method_name} request_path: {request.request_path}')
                        if request_modular:
                            log = OperationLog(request_modular=request_modular+method_name)
                            log.save()
                            # self.operation_log_id = log.id
                            request.request_data['log_id'] = log.id

        return

    def process_request(self, request):
        self.__handle_request(request)

    def process_response(self, request, response):
        """
        主要请求处理完之后记录
        :param request:
        :param response:
        :return:
        """

        if hasattr(request, 'start_time'):
            elapsed = time.time() - request.start_time
            if elapsed > 1.0:  # 超过1秒的记录
                print(f"Slow request: {request.path} took {elapsed:.2f}s")

        if self.enable:
            if self.methods == 'ALL' or request.method in self.methods:
                if '/query' not in request.request_path:
                    if request.request_path in settings.EXLUDE_API_LOG:
                        close_old_connections()
                        return response
                    self.__handle_response(request, response)
        close_old_connections()
        return response
