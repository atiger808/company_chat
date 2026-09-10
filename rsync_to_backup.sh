#!/bin/bash
# =============================================
# 源服务器：rsync 增量同步到备份服务器
# =============================================

PROJECT_DIR="/www/yue/company_chat"      # 本地项目路径
BACKUP_SERVER="192.168.1.121"
BACKUP_USER="root"
BACKUP_PORT="22"
REMOTE_CURRENT="/www/backup/project/current" # 远程 current 目录

# 使用 rsync 同步（-a 归档，-v 详细，-z 压缩，--delete 删除远程多余文件）
rsync -avz --delete -e "ssh -p ${BACKUP_PORT}" \
    ${PROJECT_DIR}/ ${BACKUP_USER}@${BACKUP_SERVER}:${REMOTE_CURRENT}/

if [ $? -eq 0 ]; then
    echo "$(date) - rsync 同步成功"
else
    echo "$(date) - rsync 同步失败，请检查日志"
    exit 1
fi