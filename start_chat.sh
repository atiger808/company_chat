#!/bin/bash


# python3.8
# /root/anaconda3/envs/py38digit/bin/gunicorn -c /www/yue/digit-platform/backend/gunicorn.conf.py  /www/yue/digit-platform/backend/backend.wsgi:application
# /root/anaconda3/envs/companychat/bin/daphne -b 0.0.0.0 -p 10900 /www/yue/company_chat/company_chat.asgi:application
systemctl stop company_chat.service
systemctl start company_chat.service

