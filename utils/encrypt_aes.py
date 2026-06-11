# -*- coding: utf-8 -*-
# @File   :utils/encrypt_aes.py
# @Time   :2026/4/14
# @Author :admin

from loguru import logger
import base64
import json
# pip install pycryptodome gmssl
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from gmssl.sm4 import CryptSM4, SM4_ENCRYPT, SM4_DECRYPT
from django.conf import settings

def object2string(data):
    """与前端完全一致的字符串转换逻辑"""
    if isinstance(data, (dict, list)):
        return json.dumps(data, ensure_ascii=False)

    s = str(data)
    # 移除首尾的单引号或双引号
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')):
        return s[1:-1]
    return s


def stringToHex(s):
    """字符串转十六进制（与前端一致）"""
    return ''.join([hex(ord(c))[2:].zfill(2) for c in s])


class AES_Cipher:
    """AES 加解密（与前端 encrypts.js 完全对齐）"""
    # 🔑 密钥必须与前端一致：16 字符 = 128bit
    KEY = settings.AES_KEY

    @staticmethod
    def encryptData(data):
        try:
            data_str = object2string(data)
            key = AES_Cipher.KEY.encode('utf-8')
            # ECB 模式 + PKCS7 填充（前端使用相同配置）
            cipher = AES.new(key, AES.MODE_ECB)
            padded_data = pad(data_str.encode('utf-8'), AES.block_size)
            encrypted = cipher.encrypt(padded_data)
            # 🔑 关键：仅对 ciphertext 进行 Base64 编码（与前端一致）
            return base64.b64encode(encrypted).decode('utf-8')
        except Exception as e:
            logger.error(f'AES encrypt error: {e}')
            return None

    @staticmethod
    def decryptData(data):
        try:
            # 🔑 前端发送的是 Base64(ciphertext)，直接解码即可
            encrypted_data = base64.b64decode(data)
            key = AES_Cipher.KEY.encode('utf-8')
            cipher = AES.new(key, AES.MODE_ECB)
            decrypted = cipher.decrypt(encrypted_data)
            unpadded = unpad(decrypted, AES.block_size)
            return unpadded.decode('utf-8')
        except Exception as e:
            logger.error(f'AES decrypt error: {e}')
            return None


class SM4_Cipher:
    """国密 SM4 加解密（严格模拟前端 sm-crypto 行为）"""
    # 🔑 密钥必须与前端一致：16 字符 = 128bit
    KEY = settings.SM4_KEY

    @staticmethod
    def encryptData(data):
        try:
            data_str = object2string(data)
            # 🔑 关键1: 密钥转十六进制（前端 stringToHex 逻辑）
            key_hex = stringToHex(SM4_Cipher.KEY)
            key_bytes = bytes.fromhex(key_hex)

            crypt_sm4 = CryptSM4()
            crypt_sm4.set_key(key_bytes, SM4_ENCRYPT)

            # 🔑 关键2: ZeroPadding 手动填充（与前端一致）
            data_bytes = data_str.encode('utf-8')
            if len(data_bytes) % 16 != 0:
                padding_len = 16 - (len(data_bytes) % 16)
                data_bytes += b'\x00' * padding_len

            # 🔑 关键3: gmssl 返回 bytes，转十六进制字符串（前端收到的是十六进制字符串）
            encrypted_bytes = crypt_sm4.crypt_ecb(data_bytes)
            encrypted_hex = encrypted_bytes.hex()  # 如: "a1b2c3..."

            # 🔑 关键4: 前端逻辑: UTF8.parse(十六进制字符串) → Base64
            # 即：将十六进制字符串当作普通文本，按字节编码后转 Base64
            encrypted_hex_bytes = encrypted_hex.encode('utf-8')
            return base64.b64encode(encrypted_hex_bytes).decode('utf-8')
        except Exception as e:
            logger.error(f'SM4 encrypt error: {e}')
            return None

    @staticmethod
    def decryptData(data):
        try:
            # 🔑 逆向前端流程: Base64 → UTF8 字节 → 十六进制字符串 → bytes.fromhex → SM4 解密
            encrypted_hex_bytes = base64.b64decode(data)
            encrypted_hex = encrypted_hex_bytes.decode('utf-8')  # 得到十六进制字符串

            encrypted_bytes = bytes.fromhex(encrypted_hex)  # 转回原始加密字节
            key_hex = stringToHex(SM4_Cipher.KEY)
            key_bytes = bytes.fromhex(key_hex)

            crypt_sm4 = CryptSM4()
            crypt_sm4.set_key(key_bytes, SM4_DECRYPT)

            decrypted_bytes = crypt_sm4.crypt_ecb(encrypted_bytes)

            # 🔑 移除 ZeroPadding（前端使用相同填充）
            while decrypted_bytes and decrypted_bytes[-1] == 0:
                decrypted_bytes = decrypted_bytes[:-1]

            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            logger.error(f'SM4 decrypt error: {e}')
            return None


# 🔑 默认使用 AES 算法（与前端默认配置一致）
_DEFAULT_CIPHER = AES_Cipher


def encrypt_data(data, mode='aes'):
    """
    加密接口（与前端 encryptData 对齐）

    Args:
        data: 待加密数据（str/dict/list）
        mode: 'aes' 或 'sm4'，默认 'aes'

    Returns:
        str: Base64 编码的密文，失败返回 None
    """
    if not data:
        return None

    cipher = SM4_Cipher if mode.lower() == 'sm4' else AES_Cipher
    return cipher.encryptData(data)


def decrypt_data(data, mode='aes'):
    """
    解密接口（与前端 decryptData 对齐）

    Args:
        data: Base64 编码的密文
        mode: 'aes' 或 'sm4'，默认 'aes'

    Returns:
        str: 解密后的明文字符串，失败返回 None
    """
    if not data:
        return None

    cipher = SM4_Cipher if mode.lower() == 'sm4' else AES_Cipher
    return cipher.decryptData(data)


# ==================== 测试代码 ====================
if __name__ == '__main__':
    print("=== AES 加解密测试 ===")
    plain_text = 'chat@123'

    # AES 加密
    cipher_text = encrypt_data(plain_text, mode='aes')
    print(f'原文: {plain_text}')
    print(f'AES 密文: {cipher_text}')

    cipher_text = '6N8kj1Z6BfAy1a/OGt9abg=='
    # AES 解密
    decipher_text = decrypt_data(cipher_text, mode='aes')
    print(f'AES 解密: {decipher_text}')
    print(f'匹配: {plain_text == decipher_text}\n')

    print("=== SM4 加解密测试 ===")
    # SM4 加密
    cipher_text_sm4 = encrypt_data(plain_text, mode='sm4')
    print(f'原文: {plain_text}')
    print(f'SM4 密文: {cipher_text_sm4}')

    # SM4 解密
    decipher_text_sm4 = decrypt_data(cipher_text_sm4, mode='sm4')
    print(f'SM4 解密: {decipher_text_sm4}')
    print(f'匹配: {plain_text == decipher_text_sm4}\n')

    print("=== 复杂对象测试 ===")
    test_obj = {"user": "admin", "roles": ["read", "write"], "id": 123}
    encrypted = encrypt_data(test_obj, mode='aes')
    decrypted = decrypt_data(encrypted, mode='aes')
    print(f'对象加密: {encrypted}')
    print(f'对象解密: {decrypted}')
    print(f'解析验证: {json.loads(decrypted) == test_obj}')