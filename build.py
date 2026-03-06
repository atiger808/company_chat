# !/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
构建脚本 - 自动为静态资源添加版本参数
等效于原 build.sh，但使用 Python 实现，跨平台且更易维护
"""

import os
import re
import sys
import shutil
import subprocess
from datetime import datetime
from pathlib import Path


def run_command(cmd, shell=False, check=True):
    """运行系统命令并返回结果"""
    try:
        result = subprocess.run(
            cmd,
            shell=shell,
            check=check,
            capture_output=True,
            text=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        if check:
            print(f"❌ 命令执行失败: {cmd}")
            print(f"   错误输出: {e.stderr.strip()}")
            sys.exit(1)
        return None


def is_git_repo():
    """检查当前目录是否为 Git 仓库"""
    try:
        run_command(['git', 'rev-parse', '--git-dir'], check=True)
        return True
    except:
        return False


def get_version():
    """生成版本号 (YYYYMMDD-commit_hash 或 YYYYMMDD-dev)"""
    date_str = datetime.now().strftime('%Y%m%d')

    if is_git_repo():
        try:
            commit_hash = run_command(['git', 'rev-parse', '--short', 'HEAD'])
            print(f"📦 获取 Git 提交信息 {commit_hash}")
            return f"{date_str}-{commit_hash}"
        except:
            print("⚠️  无法获取 Git 提交信息，使用 dev 作为版本后缀")
            return f"{date_str}-dev"
    else:
        print("⚠️  当前目录不是 Git 仓库，使用 dev 作为版本后缀")
        return f"{date_str}-dev"


def update_settings(version, build_time):
    """更新 settings.py 中的 STATIC_VERSION 和 BUILD_TIME"""
    settings_path = Path("company_chat/settings.py")

    if not settings_path.exists():
        print(f"⚠️  settings.py 不存在: {settings_path}")
        return

    # 读取文件
    content = settings_path.read_text(encoding='utf-8')

    # 更新 STATIC_VERSION
    content = re.sub(
        r"STATIC_VERSION\s*=\s*['\"][^'\"]*['\"]",
        f"STATIC_VERSION = '{version}'",
        content
    )

    # 更新 BUILD_TIME
    content = re.sub(
        r"BUILD_TIME\s*=\s*['\"][^'\"]*['\"]",
        f"BUILD_TIME = '{build_time}'",
        content
    )

    # 写回文件
    settings_path.write_text(content, encoding='utf-8')
    print(f"✓ 更新 settings.py: STATIC_VERSION={version}, BUILD_TIME={build_time}")

    # 验证更新
    updated_content = settings_path.read_text(encoding='utf-8')
    if f"STATIC_VERSION = '{version}'" in updated_content:
        print("✓ 验证: settings.py 已正确更新")
    else:
        print("⚠️  警告: settings.py 中的 STATIC_VERSION 可能未正确更新")


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


def collect_static():
    """收集静态文件"""
    print("📦 收集静态文件...")

    # 使用当前 Python 环境（避免硬编码 conda 路径）
    python_exec = sys.executable
    manage_py = Path("manage.py")

    if not manage_py.exists():
        print(f"❌ manage.py 不存在: {manage_py}")
        sys.exit(1)

    try:
        # 运行 collectstatic
        subprocess.run(
            [python_exec, "manage.py", "collectstatic", "--noinput"],
            check=True
        )
        print("✓ 静态文件收集完成")
    except subprocess.CalledProcessError as e:
        print(f"❌ 静态文件收集失败: {e}")
        sys.exit(1)


def restart_services():
    """重启服务"""
    print("\n🔄 重启服务...")

    # 重启应用服务（尝试多种可能的服务名）
    app_services = ['company_chat', 'gunicorn', 'daphne']
    for service in app_services:
        result = run_command(f"sudo systemctl restart {service}", shell=True, check=False)
        if result is not None:
            print(f"✓ 重启服务: {service}")
            break
    else:
        print("⚠️  未找到应用服务（尝试了: company_chat, gunicorn, daphne）")

    # 重载 Nginx
    nginx_result = run_command("sudo systemctl reload nginx", shell=True, check=False)
    if nginx_result is not None:
        print("✓ Nginx 配置重载成功")
    else:
        print("⚠️  Nginx 服务未运行或名称不匹配")


def main():
    print("=" * 60)
    print("🚀 企业聊天室 - 构建部署脚本")
    print("=" * 60)

    # 1. 生成版本号
    version = get_version()
    build_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n📦 构建版本: {version}")
    print(f"⏰ 构建时间: {build_time}")

    # 2. 更新 settings.py
    update_settings(version, build_time)

    # 3. 更新 HTML 文件
    html_path = Path("templates/chat/index.html")
    if html_path.exists():
        update_static_versions(html_path, version)
    else:
        print(f"⚠️  HTML 文件不存在: {html_path}")

    # 4. 收集静态文件
    collect_static()

    # 5. 重启服务
    restart_services()

    # 完成提示
    print("\n" + "=" * 60)
    print("✅ 部署完成！")
    print(f"   版本: {version}")
    print(f"   构建时间: {build_time}")
    print("\n💡 用户将在 5 分钟内自动检测到新版本")
    print(f"💡 清除浏览器缓存或访问 ?cacheBust={int(datetime.now().timestamp())} 强制刷新")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  构建过程被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ 构建失败: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
