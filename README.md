### 安装部署

python3.9

##### 安装依赖

```
pip install -r requirements.txt
```



### 数据库配置



## 1. 连接到 PostgreSQL

由于你的 PostgreSQL 端口是 `5433`（不是默认的 `5432`），连接时需要指定端口：

```
# 方法1：使用 psql 命令行连接
psql -U postgres -h localhost -p 5433 -d postgres

# 方法2：如果宝塔修改了 postgres 用户密码，使用密码连接
psql -U postgres -h localhost -p 5433 -d postgres -W

# 方法3：切换到 postgres 系统用户（推荐）
sudo -u postgres psql -p 5433 -d postgres
```

## 2. 验证用户和数据库是否存在

连接成功后，执行以下命令验证：

```
-- 查看所有数据库
\l

-- 查看所有用户/角色
\du

-- 检查 company_chat 用户是否存在
SELECT rolname FROM pg_roles WHERE rolname = 'company_chat';

-- 检查 company_chat 数据库是否存在
SELECT datname FROM pg_database WHERE datname = 'company_chat';
```

## 3. 授予权限

如果确认用户和数据库都存在，执行以下授权命令：

```
-- 连接到 company_chat 数据库
\c company_chat;

-- 授予对 public schema 的 USAGE 权限
GRANT USAGE ON SCHEMA public TO company_chat;

-- 授予在 public schema 中创建对象的权限
GRANT CREATE ON SCHEMA public TO company_chat;

-- 授予对所有现有表的完整权限（如果有表的话）
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO company_chat;

-- 授予对所有现有序列的权限
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO company_chat;

-- 设置默认权限，确保将来创建的表自动授予权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO company_chat;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO company_chat;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO company_chat;

-- 退出
\q
```





##### 开机启动服务

```
/etc/systemd/system/company_chat.service
```

```
[Unit]
Description=Gunicorn for company_chat
After=network.target

[Service]
User=root
Group=root
WorkingDirectory=/www/yue/company_chat
ExecStart=/root/anaconda3/envs/companychat/bin/daphne -b 0.0.0.0 -p 10900 company_chat.asgi:application

Restart=on-failure
RestartSec=10

# 日志重定向（备用）
StandardOutput=append:/var/log/daphne/out-company_chat.log
StandardError=append:/var/log/daphne/err-company_chat.log
```



##### 开机自启动命令

```
sudo systemctl daemon-reload
sudo systemctl enable company_chat
sudo systemctl start company_chat

sudo systemctl restart company_chat


sudo systemctl status company_chat
```

