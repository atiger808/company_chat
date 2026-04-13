#!/bin/bash

ps aux|grep -v grep|grep 'company_chat.celery_app worker'|awk '{print $2}'|xargs kill -9
ps aux|grep -v grep|grep 'company_chat.celery_app beat'|awk '{print $2}'|xargs kill -9

cd /www/yue/company_chat/
/root/anaconda3/envs/companychat/bin/celery -A company_chat.celery_app worker --loglevel=INFO --concurrency=4 >> /var/log/celery/company_chat_worker.log 2>&1 &
/root/anaconda3/envs/companychat/bin/celery -A company_chat.celery_app beat --loglevel=INFO >> /var/log/celery/company_chat_beat.log 2>&1 &
