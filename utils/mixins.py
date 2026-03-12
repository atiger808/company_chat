# -*- coding: utf-8 -*-
# @File   :mixins.py
# @Time   :2025/6/25 17:34
# @Author :admin
from loguru import logger
import json
from rest_framework import viewsets, status
from rest_framework.response import Response
from django.http import HttpResponse
from utils.encrypt_aes import encrypt_data, decrypt_data

class CustomResponseMixin:
    """统一返回格式的 Mixin (修复版本)"""

    def finalize_response(self, request, response, *args, **kwargs):
        # 确保调用父类方法设置渲染器
        response = super().finalize_response(request, response, *args, **kwargs)

        # 保存 request 对象用于后续方法
        self.request = request

        # 只处理有数据的响应
        if hasattr(response, 'data') and response.data is not None:
            # 处理错误响应 (400+)
            if response.status_code >= status.HTTP_400_BAD_REQUEST:
                response = self._format_error_response(response)
            # 处理成功响应 (200-299)
            elif status.HTTP_200_OK <= response.status_code < status.HTTP_300_MULTIPLE_CHOICES:
                response = self._format_success_response(response)
        return response

    def _format_success_response(self, response):
        formatted_data = {
            "code": 2000,
            "data": response.data,
            "msg": self.get_success_message(response)
        }
        response.data = formatted_data
        return response

    def _format_error_response(self, response):
        formatted_data = {
            "code": self.get_error_code(response),
            "data": None,
            "msg": self.get_error_message(response.data)
        }
        response.data = formatted_data
        return response

    def get_success_message(self, response):
        """根据操作类型返回成功消息"""
        method = self.request.method.lower()

        if response.status_code == status.HTTP_201_CREATED:
            return "创建成功"
        elif response.status_code == status.HTTP_204_NO_CONTENT:
            return "删除成功"
        elif response.status_code == status.HTTP_200_OK:
            if method == 'patch':
                return "更新成功"
            return "操作成功"

        return "成功"

    def get_error_code(self, response):
        """根据错误类型返回自定义错误码"""
        if response.status_code == status.HTTP_400_BAD_REQUEST:
            return 4000  # 验证错误
        elif response.status_code == status.HTTP_401_UNAUTHORIZED:
            return 4010  # 认证失败
        elif response.status_code == status.HTTP_403_FORBIDDEN:
            return 4030  # 权限不足
        elif response.status_code == status.HTTP_404_NOT_FOUND:
            return 4040  # 资源不存在
        return 5000  # 服务器错误

    def get_error_message(self, error_data):
        """提取错误信息"""
        if isinstance(error_data, dict):
            # 处理字段错误
            if 'detail' in error_data:
                return error_data['detail']
            if 'msg' in error_data:
                return error_data['msg']

            # 处理验证错误
            errors = []
            for field, messages in error_data.items():
                if field == 'non_field_errors':
                    errors.extend(messages)
                else:
                    field_name = field.replace('_', ' ').title()
                    errors.append(f"{field_name}: {', '.join(messages)}")
            return '; '.join(errors)

        elif isinstance(error_data, list):
            return '; '.join(error_data)

        return str(error_data)






class EncryptionResponseMixin:
    """
    统一加密响应数据的Mixin
    """

    def encrypt_response(self, data):
        """
        加密响应数据
        """
        if 'results' in data:
            # 处理分页结果
            data['results'] = encrypt_data(data['results'])
            return data
        elif 'result' in data:
            # 处理单个结果
            data['result'] = encrypt_data(data['result'])
            return data
        else:
            # 其他情况直接加密整个响应
            return {'result': encrypt_data(data)}

        # if 'data' in data:
        #     # 加密实际数据部分
        #     if isinstance(data['data'], dict) and 'results' in data['data']:
        #         # 处理分页结果
        #         data['data']['results'] = encrypt_data(data['data']['results'])
        #     else:
        #         # 处理单个结果或列表
        #         data['data'] = encrypt_data(data['data'])
        #     return data
        # return {'result': encrypt_data(data)}

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)

        # 只处理成功的 JSON 响应
        if response.status_code < 400:
            if isinstance(response, Response) and hasattr(response, 'data') and response.data is not None:

                # 加密响应数据
                encrypted_data = self.encrypt_response(response.data)
                # logger.info(f"response: {response}")
                # logger.info(f"response.data: {response.data}")
                # logger.info(f"Encrypted response: {encrypted_data}")

                # 创建新的响应对象
                encrypted_response = Response(
                    encrypted_data,
                    status=response.status_code,
                    headers=response.headers
                )

                # 渲染响应内容
                if not encrypted_response.is_rendered:
                    encrypted_response.accepted_renderer = response.accepted_renderer
                    encrypted_response.accepted_media_type = response.accepted_media_type
                    encrypted_response.renderer_context = response.renderer_context
                    encrypted_response.render()

            elif isinstance(response, HttpResponse) and hasattr(response, 'content') and response.content is not None:
                # logger.info(f"response: {response}")
                # logger.info(f"response.content: {response.content}")
                encrypted_data = encrypt_data(json.loads(response.content.decode('utf-8')))

                # logger.info(f"Encrypted response: {encrypted_data}")
                # logger.info(f"response.headers: {response.headers}")
                data = json.dumps({'result': encrypted_data})
                # 创建新的响应对象
                encrypted_response = HttpResponse(
                    data,
                    status=response.status_code,
                    headers=response.headers
                )

            else:
                encrypted_response = response




            return encrypted_response

        return response