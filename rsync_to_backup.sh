#!/bin/bash
# =============================================
# 源服务器：rsync 增量同步到备份服务器
# 特点：
#   1. 不删除备份端文件（无 --delete），防止误删同步
#   2. 使用 SSH 免密登录，无需输入密码
#   3. 排除临时文件、缓存、日志等无用文件
#   4. 输出详细日志，便于排查
# =============================================

# ---------- 配置变量 ----------
PROJECT_DIR="/www/yue/company_chat"      # 本地项目路径（末尾不加斜杠）
BACKUP_SERVER="192.168.1.122"                # 备份服务器 IP
BACKUP_USER="root"                           # 备份服务器用户名
BACKUP_PORT="22"                             # 备份服务器 SSH 端口
REMOTE_CURRENT="/www/backup/project/current" # 远程 current 目录

# ---------- 日志文件 ----------
LOG_FILE="/var/log/rsync_backup.log"

# ---------- 需要排除的文件/目录（按需增减） ----------
EXCLUDES=(
    "--exclude=.git/logs/"
    "--exclude=*.log"
    "--exclude=*.tmp"
    "--exclude=*.swp"
    "--exclude=.DS_Store"
    "--exclude=node_modules/"
    "--exclude=runtime/"
    "--exclude=cache/"
)

# ---------- 开始执行 ----------
echo "========================================" >> ${LOG_FILE}
echo "$(date '+%Y-%m-%d %H:%M:%S') - 开始 rsync 同步" >> ${LOG_FILE}

# ---------- 执行 rsync 同步 ----------
# 参数说明：
#   -a        归档模式（保留权限、时间、软硬链接等）
#   -v        详细输出
#   -z        传输时压缩
#   --partial 断点续传（网络中断后可继续）
#   -e        指定 ssh 端口
#   注意：这里刻意不使用 --delete，保证备份端文件只增不减
rsync -avz --partial \
    -e "ssh -p ${BACKUP_PORT}" \
    "${EXCLUDES[@]}" \
    ${PROJECT_DIR}/ ${BACKUP_USER}@${BACKUP_SERVER}:${REMOTE_CURRENT}/ >> ${LOG_FILE} 2>&1

# ---------- 结果判断 ----------
if [ $? -eq 0 ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - rsync 同步成功" >> ${LOG_FILE}
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') - rsync 同步失败，请检查日志" >> ${LOG_FILE}
    exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') - 同步任务结束" >> ${LOG_FILE}