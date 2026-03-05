#!/bin/bash
# build.sh - 自动为静态资源添加版本参数

set -e

## 生成版本号 (日期-短commit)
#VERSION=$(date +%Y%m%d)-$(git rev-parse --short HEAD 2>/dev/null || echo "dev")
#
## 1. 更新 settings.py 中的 STATIC_VERSION
#if [ -f "company_chat/settings.py" ]; then
#    sed -i "s/STATIC_VERSION = '.*'/STATIC_VERSION = '${VERSION}'/" company_chat/settings.py
#    echo "✓ 更新 settings.py: STATIC_VERSION=${VERSION}"
#fi

# 获取settings.py 中的 STATIC_VERSION
VERSION=$(grep -oP 'STATIC_VERSION = \K.*' company_chat/settings.py)


# 2. 更新 HTML 中的静态资源链接（添加版本参数）
if [ -f "templates/chat/index.html" ]; then
    # 为所有 /static/ 资源链接添加 ?v=VERSION 参数
    sed -i "s|href=\"/static/\([^?]*\)\"|href=\"/static/\1?v=${VERSION}\"|g" templates/chat/index.html
    sed -i "s|src=\"/static/\([^?]*\)\"|src=\"/static/\1?v=${VERSION}\"|g" templates/chat/index.html
    echo "✓ 更新 index.html: 为静态资源添加版本参数 v=${VERSION}"
fi

# 3. 更新 JS 中的 CURRENT_VERSION（用于版本检测）
if [ -f "templates/chat/index.html" ]; then
    sed -i "s/const CURRENT_VERSION = '.*'/const CURRENT_VERSION = '${VERSION}'/" templates/chat/index.html
    echo "✓ 更新 index.html: CURRENT_VERSION=${VERSION}"
fi

# 4. 收集静态文件
echo "✓ 收集静态文件..."
conda activate companychat
python manage.py collectstatic --noinput

# 5. 重启服务
echo "✓ 重启服务..."
sudo systemctl restart company_chat || echo "⚠️  Gunicorn 重启失败（可能使用其他服务）"
sudo nginx -t && sudo systemctl reload nginx && echo "✓ Nginx 重载成功"

echo ""
echo "✅ 部署完成！"
echo "   版本: ${VERSION}"
echo ""
echo "💡 用户将在 5 分钟内自动检测到新版本"