#!/bin/bash
# =============================================
# 备份服务器：清理旧快照，保留最近 3 个
# =============================================

BASE_DIR="/www/backup/project"
KEEP_COUNT=3

cd ${BASE_DIR} || exit 1

# 1. 如果 current 不存在，创建空目录（防止首次运行时 snapshot 硬链接失败）
[ -d current ] || mkdir -p current

# 2. 创建当天快照（硬链接 current 到 snapshot_YYYYMMDD）
DATE=$(date +%Y%m%d)
SNAPSHOT_DIR="${BASE_DIR}/snapshot_${DATE}"

# 删除可能存在的同名旧快照，然后重新硬链接
rm -rf ${SNAPSHOT_DIR}
cp -al current ${SNAPSHOT_DIR}

# 3. 删除超过保留数量的旧快照（按名称排序，保留最新的 KEEP_COUNT 个）
ls -d snapshot_* 2>/dev/null | sort | head -n -${KEEP_COUNT} | xargs -r rm -rf

echo "$(date) - 清理完成，保留最近 ${KEEP_COUNT} 个快照"