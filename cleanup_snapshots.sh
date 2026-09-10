#!/bin/bash
# =============================================
# 备份服务器：创建快照并清理旧快照，保留最近 3 个
# =============================================

BASE_DIR="/www/backup/project"
KEEP_COUNT=3
LOG_FILE="/var/log/cleanup_snapshots.log"

echo "========================================" >> ${LOG_FILE}
echo "$(date '+%Y-%m-%d %H:%M:%S') - 开始创建快照并清理" >> ${LOG_FILE}

cd ${BASE_DIR} || {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - 无法进入目录 ${BASE_DIR}" >> ${LOG_FILE}
    exit 1
}

# 1. 如果 current 不存在，创建空目录
[ -d current ] || mkdir -p current

# 2. 创建当天快照（硬链接 current 到 snapshot_YYYYMMDD）
DATE=$(date +%Y%m%d)
SNAPSHOT_DIR="${BASE_DIR}/snapshot_${DATE}"

rm -rf ${SNAPSHOT_DIR}
cp -al current ${SNAPSHOT_DIR} >> ${LOG_FILE} 2>&1

# 3. 删除超过保留数量的旧快照
ls -d snapshot_* 2>/dev/null | sort | head -n -${KEEP_COUNT} | xargs -r rm -rf >> ${LOG_FILE} 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') - 清理完成，保留最近 ${KEEP_COUNT} 个快照" >> ${LOG_FILE}