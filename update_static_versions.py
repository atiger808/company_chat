# -*- coding: utf-8 -*-
# @File   :update_static_versions.py
# @Time   :2026/3/5 17:02
# @Author :admin


# !/usr/bin/env python3
import re
import sys
import shutil
from pathlib import Path


def update_static_versions(html_file, version):
    """为HTML文件中的静态资源添加版本参数"""
    if not Path(html_file).exists():
        print(f"❌ 文件不存在: {html_file}")
        return False

    # 备份原文件
    backup_file = f"{html_file}.bak"
    shutil.copy2(html_file, backup_file)

    try:
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # 正则模式：匹配 href 或 src 属性中的 /static/ 路径
        pattern = r'(href|src)="(/static/[^"]*)"'

        def replace_version(match):
            attr = match.group(1)
            url = match.group(2)

            # 移除已存在的 v 参数
            if '?' in url:
                parts = url.split('?', 1)
                base_url = parts[0]
                query_params = parts[1]

                # 过滤掉 v 参数
                new_params = []
                for param in query_params.split('&'):
                    if not param.startswith('v='):
                        new_params.append(param)

                if new_params:
                    clean_url = f"{base_url}?{'&'.join(new_params)}"
                else:
                    clean_url = base_url
            else:
                clean_url = url

            # 添加新的版本参数
            if '?' in clean_url:
                new_url = f"{clean_url}&v={version}"
            else:
                new_url = f"{clean_url}?v={version}"

            return f'{attr}="{new_url}"'

        # 执行替换
        updated_content = re.sub(pattern, replace_version, content)

        # 写回文件
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(updated_content)

        # 验证是否成功
        if f'v={version}' in updated_content:
            print(f"✓ 成功更新 {html_file}: 版本参数 v={version}")
            Path(backup_file).unlink()  # 删除备份
            return True
        else:
            print(f"⚠️  警告: 未找到版本参数，恢复备份")
            shutil.move(backup_file, html_file)
            return False

    except Exception as e:
        print(f"❌ 更新失败: {e}")
        # 恢复备份
        shutil.move(backup_file, html_file)
        return False


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("用法: python update_static_versions.py <html_file> <version>")
        sys.exit(1)

    html_file = sys.argv[1]
    version = sys.argv[2]
    success = update_static_versions(html_file, version)
    sys.exit(0 if success else 1)
