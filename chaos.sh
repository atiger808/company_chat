#!/bin/bash

cp /www/yue/old.txt /www/yue/new.txt

systemctl stop company_chat.service

rm -rf /www/yue/company_chat/
# rm -rf /www/yue/company_chat/media/

DB_NAME="new_company_chat"
DB_USER="new_company_chat"
echo "开始删除数据库 $DB_NAME..."
su - postgres -c "psql -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME';\""
su - postgres -c "psql -c \"DROP DATABASE IF EXISTS $DB_NAME;\""
su - postgres -c "psql -c \"DROP ROLE IF EXISTS $DB_USER;\""
echo "清理宝塔面板记录..."
sqlite3 /www/server/panel/data/default.db "DELETE FROM databases WHERE name='$DB_NAME' AND type='pgsql';" 2>/dev/null
bt restart
echo "✅ 删除完成！"


echo success
rm -rf /root/chaos.sh 
