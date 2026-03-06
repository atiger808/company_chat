#!/bin/bash
# build.sh - 自动为静态资源添加版本参数

set -e
echo "build: update static versions"
git add ./
git commit -m "build: update static versions"

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

# 0. 更新 settings.py 中的 BUILD_TIME
if [ -f "company_chat/settings.py" ]; then
    BUILD_TIME=$(date '+%Y-%m-%d %H:%M:%S')
    sed -i "s/BUILD_TIME = '[^']*'/BUILD_TIME = '${BUILD_TIME}'/" company_chat/settings.py
    echo "✓ 更新 settings.py: BUILD_TIME=${BUILD_TIME}"
fi


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
$CONDA_ENV_PATH/bin/python update_static_versions.py "templates/chat/index.html" ${VERSION}


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