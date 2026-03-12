# -*- coding: utf-8 -*-
# @File   :encrypt_aes.py
# @Time   :2025/7/5 15:21
# @Author :admin

from loguru import logger
import base64
import json
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from gmssl.sm4 import CryptSM4, SM4_ENCRYPT, SM4_DECRYPT


def object2string(data):
    if isinstance(data, dict) or isinstance(data, list):
        return json.dumps(data)

    s = str(data)
    if (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')):
        return s[1:-1]
    return s


def stringToHex(s):
    return ''.join([hex(ord(c))[2:].zfill(2) for c in s])


class AES_Cipher:
    KEY = '1234567890abcdef'

    @staticmethod
    def encryptData(data):
        try:
            data_str = object2string(data)
            key = AES_Cipher.KEY.encode('utf-8')
            cipher = AES.new(key, AES.MODE_ECB)
            padded_data = pad(data_str.encode('utf-8'), AES.block_size)
            encrypted = cipher.encrypt(padded_data)
            return base64.b64encode(encrypted).decode('utf-8')
        except Exception as e:
            logger.info(f'error: {e}')
            return None

    @staticmethod
    def decryptData(data):
        try:
            encrypted_data = base64.b64decode(data)
            key = AES_Cipher.KEY.encode('utf-8')
            cipher = AES.new(key, AES.MODE_ECB)
            decrypted = cipher.decrypt(encrypted_data)
            unpadded = unpad(decrypted, AES.block_size)
            return unpadded.decode('utf-8')
        except Exception as e:
            logger.info(f'error: {e}')
            return None


class SM4_Cipher:
    KEY = '1234567890abcdef'

    @staticmethod
    def encryptData(data):
        try:
            data_str = object2string(data)
            key_hex = stringToHex(SM4_Cipher.KEY)
            key_bytes = bytes.fromhex(key_hex)

            crypt_sm4 = CryptSM4()
            crypt_sm4.set_key(key_bytes, SM4_ENCRYPT)

            # 手动进行ZeroPadding
            data_bytes = data_str.encode('utf-8')
            if len(data_bytes) % 16 != 0:
                padding_len = 16 - (len(data_bytes) % 16)
                data_bytes += b'\x00' * padding_len

            encrypted_bytes = crypt_sm4.crypt_ecb(data_bytes)
            encrypted_hex = encrypted_bytes.hex()
            return base64.b64encode(encrypted_hex.encode('utf-8')).decode('utf-8')
        except Exception as e:
            logger.info(f'error: {e}')
            return None

    @staticmethod
    def decryptData(data):
        try:
            encrypted_hex = base64.b64decode(data).decode('utf-8')
            encrypted_bytes = bytes.fromhex(encrypted_hex)
            key_hex = stringToHex(SM4_Cipher.KEY)
            key_bytes = bytes.fromhex(key_hex)

            crypt_sm4 = CryptSM4()
            crypt_sm4.set_key(key_bytes, SM4_DECRYPT)

            decrypted_bytes = crypt_sm4.crypt_ecb(encrypted_bytes)

            # 移除ZeroPadding
            while decrypted_bytes and decrypted_bytes[-1] == 0:
                decrypted_bytes = decrypted_bytes[:-1]

            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            logger.info(f'error: {e}')
            return None


# 默认使用AES算法（与TypeScript代码一致）
EncryptObject = AES_Cipher
# EncryptObject = SM4_Cipher


def encrypt_data(data):
    if not data:
        return None
    return EncryptObject.encryptData(data)


def decrypt_data(data):
    if not data:
        return None
    return EncryptObject.decryptData(data)


if __name__ == '__main__':

    plain_text = 'qweasd8899'
    cipher_text = encrypt_data(plain_text)
    print(f'cipher_text: {cipher_text}')
    cipher_text = '/poZX8vlyZqcYTGYiRf8XQ=='
    decipher_text = decrypt_data(cipher_text)
    print(f'decipher_text: {decipher_text}')