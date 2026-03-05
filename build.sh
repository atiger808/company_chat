#!/bin/bash
# build.sh - 自动为静态资源添加版本参数

set -e

# 🔧 修复1: 正确生成 VERSION（处理非 Git 环境）
if git rev-parse --git-dir > /dev/null 2>&1; then
    COMMIT_HASH=$(git rev-parse --short HEAD || echo "unknown")
    echo "📦 获取 Git 提交信息 ${COMMIT_HASH}"
    VERSION=$(date +%Y%m%d)-${COMMIT_HASH}
else
    VERSION=$(date +%Y%m%d)-dev
    echo "⚠️  当前目录不是 Git 仓库，使用 dev 作为版本后缀"
fi

echo "📦 构建版本: ${VERSION}"



# 1. 更新 settings.py 中的 STATIC_VERSION
if [ -f "company_chat/settings.py" ]; then
    sed -i "s/STATIC_VERSION = '[^']*'/STATIC_VERSION = '${VERSION}'/" company_chat/settings.py
    echo "✓ 更新 settings.py: STATIC_VERSION=${VERSION}"

    # 验证更新
    UPDATED_VERSION=$(grep "STATIC_VERSION" company_chat/settings.py | grep -oP "'\K[^']+(?=')")
    if [ "$UPDATED_VERSION" != "$VERSION" ]; then
        echo "⚠️  注意：settings.py 中的 STATIC_VERSION 可能未正确更新"
    fi
fi

# 2. 更新 HTML 中的静态资源链接（添加版本参数）
if [ -f "templates/chat/index.html" ]; then
    # 备份原文件
    cp templates/chat/index.html templates/chat/index.html.bak

    # 为所有 /static/ 资源链接添加 ?v=VERSION 参数（避免重复添加）
    sed -i "s|\(href=\"/static/[^?]*\)\"|\1?v=${VERSION}\"|g" templates/chat/index.html
    sed -i "s|\(src=\"/static/[^?]*\)\"|\1?v=${VERSION}\"|g" templates/chat/index.html

    # 移除重复的 ?v= 参数（如果已存在）
    sed -i "s|\?v=[^&\"]*&v=${VERSION}|\?v=${VERSION}|g" templates/chat/index.html
    sed -i "s|\?v=[^&\"]*\"\?v=${VERSION}|?v=${VERSION}|g" templates/chat/index.html

    echo "✓ 更新 index.html: 为静态资源添加版本参数 v=${VERSION}"

    # 验证更新
    if grep -q "?v=${VERSION}" templates/chat/index.html; then
        echo "✓ 验证: index.html 已包含版本参数"
        rm templates/chat/index.html.bak  # 删除备份
    else
        echo "⚠️  警告: 未在 index.html 中找到版本参数，恢复备份"
        mv templates/chat/index.html.bak templates/chat/index.html
    fi
fi

# 3. 更新 JS 中的 CURRENT_VERSION（用于版本检测）
if [ -f "templates/chat/index.html" ]; then
    sed -i "s/const CURRENT_VERSION = '[^']*'/const CURRENT_VERSION = '${VERSION}'/" templates/chat/index.html
    echo "✓ 更新 index.html: CURRENT_VERSION=${VERSION}"
fi

# 4. 收集静态文件
echo "📦 收集静态文件..."
CONDA_ENV_PATH=$(conda info --base)/envs/companychat
if [ ! -d "$CONDA_ENV_PATH" ]; then
    echo "❌ Conda 环境不存在: $CONDA_ENV_PATH"
    exit 1
fi

# 使用绝对路径运行 Python
$CONDA_ENV_PATH/bin/python manage.py collectstatic --noinput


# 5. 重启服务
echo "🔄 重启服务..."
sudo systemctl restart company_chat && echo "⚠️ daphne 服务未运行或名称不匹配（company_chat）"

echo "Nginx 配置重载..."
sudo systemctl reload nginx && echo "⚠️ Nginx 服务未运行或名称不匹配（nginx）"

echo ""
echo "✅ 部署完成！"
echo "   版本: ${VERSION}"
echo "   构建时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "💡 用户将在 5 分钟内自动检测到新版本"
echo "💡 清除浏览器缓存或访问 ?cacheBust=$(date +%s) 强制刷新"