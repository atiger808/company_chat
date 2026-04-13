

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



## **3.创建用户和数据库（对应你 Django 的配置）** 

```
-- 1. 创建用户 (密码设为 12345678，请改为你的强密码)
CREATE ROLE company_chat WITH LOGIN PASSWORD '12345678';

-- 2. 创建数据库，并指定所有者为该用户
CREATE DATABASE company_chat OWNER company_chat;

-- 3. 授权（防止权限不足）
GRANT ALL PRIVILEGES ON DATABASE company_chat TO company_chat;

-- 4. 验证
\l
```

*看到 `vue3_comany` 在列表里，*



## 4. 授予权限

如果确认用户和数据库都存在，执行以下授权命令：



#### 新数据库company_chat

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



#### 新数据库new_company_chat

```
-- 连接到 new_company_chat 数据库
\c new_company_chat;

-- 授予对 public schema 的 USAGE 权限
GRANT USAGE ON SCHEMA public TO new_company_chat;

-- 授予在 public schema 中创建对象的权限
GRANT CREATE ON SCHEMA public TO new_company_chat;

-- 授予对所有现有表的完整权限（如果有表的话）
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO new_company_chat;

-- 授予对所有现有序列的权限
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO new_company_chat;

-- 设置默认权限，确保将来创建的表自动授予权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO new_company_chat;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO new_company_chat;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO new_company_chat;

-- 退出
\q
```



#### 新数据库new_vue3_comany

```
-- 连接到 new_vue3_comany 数据库
\c new_vue3_comany;

-- 授予对 public schema 的 USAGE 权限
GRANT USAGE ON SCHEMA public TO new_vue3_comany;

-- 授予在 public schema 中创建对象的权限
GRANT CREATE ON SCHEMA public TO new_vue3_comany;

-- 授予对所有现有表的完整权限（如果有表的话）
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO new_vue3_comany;

-- 授予对所有现有序列的权限
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO new_vue3_comany;

-- 设置默认权限，确保将来创建的表自动授予权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO new_vue3_comany;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO new_vue3_comany;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO new_vue3_comany;

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





### onlyoffice安装与配置



##### 启动onlyoffice相关服务

```
systemctl status ds-docservice ds-converter ds-metrics

systemctl restart ds-docservice ds-converter ds-metrics
```







# CentOS 7 安装 OnlyOffice Document Server 8.1.1 完整步骤

## 📋 系统要求

```bash
# 系统版本
CentOS 7.x (64-bit)

# 最低配置
- CPU: 2 核
- 内存: 4GB RAM
- 磁盘: 20GB 可用空间
- 网络: 需要访问外部仓库下载依赖

# 推荐配置
- CPU: 4 核+
- 内存: 8GB+ RAM
- 磁盘: 50GB+ SSD
```

---

## 🔧 安装前准备

### 1. 更新系统并安装基础工具

```bash
# 更新系统
sudo yum update -y

# 安装必要工具
sudo yum install -y wget curl unzip libtool
```

### 2. 安装并配置 EPEL 源

```bash
# 安装 EPEL 源
sudo yum install -y epel-release

# 更新缓存
sudo yum makecache fast
```

### 3. 安装依赖包

```bash
# 安装 OnlyOffice 所需依赖
sudo yum install -y \
    libstdc++6 \
    libgcc1 \
    libcurl4 \
    libssl1.1 \
    libxml2 \
    libxslt1.1 \
    fonts \
    fontconfig \
    libpng16 \
    libjpeg8 \
    libcairo2 \
    libpango1.0-0 \
    libgdk-pixbuf2.0-0 \
    libatk1.0-0 \
    libgtk-3-0 \
    libasound2 \
    libxtst6 \
    libxss1 \
    libnss3 \
    libgbm1 \
    libdrm2 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    supervisor \
    nginx \
    rabbitmq-server \
    redis \
    socat
```

> ⚠️ **注意**：部分依赖包可能需要启用额外源或手动编译安装

---

## 📦 安装 OnlyOffice Document Server

### 方式一：使用官方 RPM 包安装（推荐）

```bash
# 1. 下载 RPM 包（从官方发布页获取）
cd /tmp
wget https://github.com/ONLYOFFICE/DocumentServer/releases/download/v8.1.1/onlyoffice-documentserver-8.1.1.x86_64.rpm

# 2. 安装 RPM 包
sudo yum localinstall -y onlyoffice-documentserver-8.1.1.x86_64.rpm

# 3. 如果依赖冲突，使用 --force 或 --nodeps（谨慎使用）
# sudo rpm -ivh --force --nodeps onlyoffice-documentserver-8.1.1.x86_64.rpm

# 进入 RPM 包所在目录
cd /path/to/onlyoffice

# 使用 --skip-broken 跳过非关键依赖（谨慎使用）
sudo yum localinstall -y onlyoffice-documentserver-8.1.1.x86_64.rpm --skip-broken

# 或使用 rpm 命令强制安装（不推荐，可能导致运行问题）
sudo rpm -ivh --nodeps onlyoffice-documentserver-8.1.1.x86_64.rpm

# 安装完成后运行 documentserver-configure.sh 命令
bash /usr/bin/documentserver-configure.sh 
Configuring database access... 
Host: localhost
Database name: onlyoffice
User: onlyoffice
Password: 
Trying to establish PostgreSQL connection... OK
Installing PostgreSQL database... OK
Configuring AMQP access... 
Host: localhost
User: guest
Password: 
Trying to establish AMQP connection... OK
nginx.service is not a native service, redirecting to /sbin/chkconfig.
Executing /sbin/chkconfig nginx on
Restarting services... OK
JWT is enabled by default. A random secret is generated automatically. Run the command '# documentserver-jwt-status.sh' to get information about JWT.

# 配置 /etc/onlyoffice/documentserver/local.json，配置JWT_SECRET



```

##### local.json

```
{
  "services": {
    "CoAuthoring": {
      "requestDefaults": {
        "headers": {
          "X-OnlyOffice-Callback": "true"
        }
      },
      "sql": {
        "dbHost": "localhost",
        "dbName": "onlyoffice",
        "dbUser": "onlyoffice",
        "dbPass": "onlyoffice_password",
        "type": "postgres",
        "dbPort": "5432"
      },
      "plugins": {
        "chat": {
          "autostart": true
        }
      },
      "token": {
        "enable": {
          "request": {
            "inbox": true,
            "outbox": true
          },
          "browser": true
        },
        "inbox": {
          "header": "Authorization",
          "secret": "JWT_SECRET"
        },
        "outbox": {
          "header": "Authorization",
          "secret": "JWT_SECRET"
        },
        "secret": {
          "inbox": {
            "string": "JWT_SECRET"
          },
          "outbox": {
            "string": "JWT_SECRET"
          },
          "session": {
            "string": "JWT_SECRET"
          }
        }
      },
      "secret": {
        "inbox": {
          "string": "JWT_SECRET"
        },
        "outbox": {
          "string": "JWT_SECRET"
        },
        "session": {
          "string": "JWT_SECRET"
        }
      },
      "jwt": {
        "enabled": true
      }
    }
  },
  "queue": {
    "type": "rabbitmq"
  },
  "rabbitmq": {
    "url": "amqp://guest:guest@localhost"
  },
  "wopi": {
    "enable": false,
    "privateKey": "-----BEGIN PRIVATE KEY-----\nMIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAPFboRBG/CPjJRIi\n0YUsavRlhOGb5egKrLzYbuMcatOwhU7JywbvwHflfETN8LblXTkoOi7ljnI5BjUZ\nOXp6ECeeetfayIVGgrW0cig1dkSHjxIYBkuB6XM2R9Q3+6VvOokuhAaIhk/lvZWA\nAveW7zGFgRO+/Vwuswk450BJ9KzTAgMBAAECgYEAtN1cQg1fryjtQ7zx02EouQJG\nZKZlz9AIB/AMkIZgC0hxbUxMp2MMkQxYZlsJMpWImWdqym/dofzXiPzhFMXZydIu\nNjYvidHBRuyAOwGTHgKvliJ9VExfQKWUKFELEJCwxVJ2hGtwc4XjxTpxEl1vNbda\nxwdNIUYUwqVEMLPilBkCQQD4qwHBNhHkgzy+xarOyJeoOVoLzqRWSOAyNT/hxDzy\nsL6NiQGhAoc48cD4tCU3Iw3b1OiDtJ81YAX7UAeSawf/AkEA+Hlxy5940sTCLvCD\nQC/1Pw1c1fjIsdnV4pOwC92whD79Tig2tjVtU4Be7JQMFMdacJ3+XEORxSZ+GR+n\nObO7LQJBAMuE+myt2jsShjcFBOU1G5qdRet/9tR/1K6DEoOu3ssqiOrCBUlIDnA2\nvN9QYV0dHYycVqjkvaErs/mZ6HiXjPUCQBqJJb0AR/ACcVZ/+xRkysU0ESEM06oi\nwHPVH+z0fQBylay+ILGu3QEY6YpMeUnSzHbQeLSzxqKObNMUDVDdP/UCQACkOvYA\nhn1TadYBAiBBga4SZRZvTgu4NRqLvMaA2eQFKue/uHODAozUFKO3oSTM11PYv2SV\nyNpME17msPiLjug=\n-----END PRIVATE KEY-----\n",
    "privateKeyOld": "-----BEGIN PRIVATE KEY-----\nMIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAPFboRBG/CPjJRIi\n0YUsavRlhOGb5egKrLzYbuMcatOwhU7JywbvwHflfETN8LblXTkoOi7ljnI5BjUZ\nOXp6ECeeetfayIVGgrW0cig1dkSHjxIYBkuB6XM2R9Q3+6VvOokuhAaIhk/lvZWA\nAveW7zGFgRO+/Vwuswk450BJ9KzTAgMBAAECgYEAtN1cQg1fryjtQ7zx02EouQJG\nZKZlz9AIB/AMkIZgC0hxbUxMp2MMkQxYZlsJMpWImWdqym/dofzXiPzhFMXZydIu\nNjYvidHBRuyAOwGTHgKvliJ9VExfQKWUKFELEJCwxVJ2hGtwc4XjxTpxEl1vNbda\nxwdNIUYUwqVEMLPilBkCQQD4qwHBNhHkgzy+xarOyJeoOVoLzqRWSOAyNT/hxDzy\nsL6NiQGhAoc48cD4tCU3Iw3b1OiDtJ81YAX7UAeSawf/AkEA+Hlxy5940sTCLvCD\nQC/1Pw1c1fjIsdnV4pOwC92whD79Tig2tjVtU4Be7JQMFMdacJ3+XEORxSZ+GR+n\nObO7LQJBAMuE+myt2jsShjcFBOU1G5qdRet/9tR/1K6DEoOu3ssqiOrCBUlIDnA2\nvN9QYV0dHYycVqjkvaErs/mZ6HiXjPUCQBqJJb0AR/ACcVZ/+xRkysU0ESEM06oi\nwHPVH+z0fQBylay+ILGu3QEY6YpMeUnSzHbQeLSzxqKObNMUDVDdP/UCQACkOvYA\nhn1TadYBAiBBga4SZRZvTgu4NRqLvMaA2eQFKue/uHODAozUFKO3oSTM11PYv2SV\nyNpME17msPiLjug=\n-----END PRIVATE KEY-----\n",
    "publicKey": "BgIAAACkAABSU0ExAAQAAAEAAQDTrPRJQOc4CbMuXP2+E4GFMe+W9wKAlb3lT4aIBoQuiTpvpfs31Ec2c+mBSwYYEo+HRHY1KHK0tYJGhcja13qeJxB6ejkZNQY5co7lLjooOV3ltvDNRHzld8DvBsvJToWw02oc427YvKwK6OWb4YRl9GoshdEiEiXjI/xGEKFb8Q==",
    "publicKeyOld": "BgIAAACkAABSU0ExAAQAAAEAAQDTrPRJQOc4CbMuXP2+E4GFMe+W9wKAlb3lT4aIBoQuiTpvpfs31Ec2c+mBSwYYEo+HRHY1KHK0tYJGhcja13qeJxB6ejkZNQY5co7lLjooOV3ltvDNRHzld8DvBsvJToWw02oc427YvKwK6OWb4YRl9GoshdEiEiXjI/xGEKFb8Q==",
    "modulus": "F15BA11046FC23E3251222D1852C6AF46584E19BE5E80AACBCD86EE31C6AD3B0854EC9CB06EFC077E57C44CDF0B6E55D39283A2EE58E7239063519397A7A10279E7AD7DAC8854682B5B47228357644878F1218064B81E9733647D437FBA56F3A892E840688864FE5BD958002F796EF31858113BEFD5C2EB30938E74049F4ACD3",
    "modulusOld": "F15BA11046FC23E3251222D1852C6AF46584E19BE5E80AACBCD86EE31C6AD3B0854EC9CB06EFC077E57C44CDF0B6E55D39283A2EE58E7239063519397A7A10279E7AD7DAC8854682B5B47228357644878F1218064B81E9733647D437FBA56F3A892E840688864FE5BD958002F796EF31858113BEFD5C2EB30938E74049F4ACD3",
    "exponent": 65537,
    "exponentOld": 65537
  },
  "storage": {
    "fs": {
      "secretString": "qwjzK4RuVWHxVq5ZKE7u"
    }
  }
}

```



### 方式二：使用官方仓库安装

```bash
# 1. 添加 OnlyOffice 官方仓库
sudo rpm --import https://download.onlyoffice.com/GPG-KEY-ONLYOFFICE
sudo yum-config-manager --add-repo https://download.onlyoffice.com/install/documentserver/linux/centos/onlyoffice-documentserver.repo

# 2. 安装 Document Server
sudo yum install -y onlyoffice-documentserver

# 3. 安装指定版本
sudo yum install -y onlyoffice-documentserver-8.1.1
```

---

## ⚙️ 安装后配置

```
# 1. 清理旧的仓库配置
sudo rm -f /etc/yum.repos.d/pgdg-*.repo


# 3. 清理缓存并重建
sudo yum clean all
sudo yum makecache fast


```

##### 运行以下命令

```
bash /usr/bin/documentserver-configure.sh 
```

postgresql配置文件路径：

```
/var/lib/pgsql/data/pg_hba.conf
```









# CentOS 7.9 安装 PostgreSQL 13（阿里云镜像源）

✅ 确认阿里云镜像源可访问，系统为 CentOS 7.9，以下是完整安装步骤：

---

## 🔧 步骤 1：清理旧的仓库配置

```bash
# 备份并清理可能冲突的仓库
sudo mkdir -p /root/repo-backup
sudo mv /etc/yum.repos.d/pgdg-*.repo /root/repo-backup/ 2>/dev/null || true

# 清理 yum 缓存
sudo yum clean all
sudo rm -rf /var/cache/yum/*
```

---

## 🔧 步骤 2：创建阿里云 PostgreSQL 13 仓库

```bash
# 创建新的仓库配置文件
sudo vi /etc/yum.repos.d/pgdg-13.repo
```

**粘贴以下内容**：
```ini
[pgdg13]
name=PostgreSQL 13 for RHEL/CentOS 7 - x86_64 - Aliyun Mirror
baseurl=https://mirrors.aliyun.com/postgresql/repos/yum/13/redhat/rhel-7-x86_64/
enabled=1
gpgcheck=0

[pgdg13-updates]
name=PostgreSQL 13 Updates for RHEL/CentOS 7 - Aliyun Mirror
baseurl=https://mirrors.aliyun.com/postgresql/repos/yum/13/redhat/rhel-7-x86_64/
enabled=1
gpgcheck=0
```

---

## 🔧 步骤 3：安装 PostgreSQL 13

```bash
# 重建缓存
sudo yum makecache fast

# 验证仓库可用
yum repolist enabled | grep pgdg

# 安装 PostgreSQL 13（禁用仓库保护插件）
sudo yum install -y postgresql13 postgresql13-server postgresql13-contrib \
  --disableplugin=protectbase
```

> 💡 如果提示 `protectbase` 插件不存在，可去掉 `--disableplugin=protectbase` 参数

---

## 🔧 步骤 4：初始化并启动数据库

```bash
# 1. 初始化数据库（首次安装必须执行）
sudo /usr/pgsql-13/bin/postgresql-13-setup initdb

# 2. 启动服务
sudo systemctl start postgresql-13
sudo systemctl enable postgresql-13

# 3. 验证服务状态
sudo systemctl status postgresql-13
```

---

## 🔧 步骤 5：配置认证允许密码登录

```bash
# 1. 编辑 pg_hba.conf
sudo vi /var/lib/pgsql/13/data/pg_hba.conf

# 2. 找到并修改以下行（将 peer/ident 改为 md5）：
# 修改前：
# local   all             all                                     peer
# host    all             all             127.0.0.1/32            ident

# 修改后：
local   all             all                                     md5
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5

# 3. 重载配置
sudo systemctl reload postgresql-13
```

---

## 🔧 步骤 6：创建 OnlyOffice 所需数据库和用户

```bash
# 切换到 postgres 用户
sudo su - postgres

# 进入 psql
/usr/pgsql-13/bin/psql

-- 执行以下 SQL 命令：
-- 创建数据库
CREATE DATABASE onlyoffice 
    WITH ENCODING='UTF8' 
    LC_COLLATE='en_US.UTF-8' 
    LC_CTYPE='en_US.UTF-8' 
    TEMPLATE=template0;

-- 创建用户（密码请替换为强密码）
CREATE USER onlyoffice WITH PASSWORD 'onlyoffice_pass';

-- 授权
GRANT ALL PRIVILEGES ON DATABASE onlyoffice TO onlyoffice;

-- 切换到 onlyoffice 数据库并授权 schema（PostgreSQL 15+ 需要）
\c onlyoffice
GRANT ALL ON SCHEMA public TO onlyoffice;

-- 退出
\q

# 退出 postgres 用户
exit
```

---

## 🔧 步骤 7：验证安装

```bash
# 1. 测试数据库连接
PGPASSWORD='YourSecurePassword123!' psql -h 127.0.0.1 -U onlyoffice -d onlyoffice -c "SELECT version();"

# 2. 检查端口监听
sudo netstat -tlnp | grep 5432

# 3. 检查 OnlyOffice 配置
sudo cat /etc/onlyoffice/documentserver/local.json | grep -A8 '"sql"'
```

预期输出：
```
 PostgreSQL 13.x on x86_64-pc-linux-gnu, compiled by gcc ...
```

---

## 🔧 步骤 8：配置 OnlyOffice 连接新数据库

```bash
# 1. 编辑 OnlyOffice 配置文件
sudo vi /etc/onlyoffice/documentserver/local.json

# 2. 确保 "db" 部分配置正确：
{
  "services": {
    "CoAuthoring": {
      "sql": {
        "type": "postgres",
        "dbHost": "127.0.0.1",
        "dbPort": 5432,
        "dbName": "onlyoffice",
        "dbUser": "onlyoffice",
        "dbPass": "YourSecurePassword123!"
      }
    }
  }
}

# 3. 运行数据库初始化脚本（如果首次配置）
sudo /usr/bin/documentserver-setup-db.sh

# 4. 重启 OnlyOffice 服务
sudo supervisorctl restart all
# 或
sudo systemctl restart onlyoffice-documentserver
```

---

## 🔧 步骤 9：验证 OnlyOffice 连接

```bash
# 1. 检查服务状态
sudo supervisorctl status

# 2. 查看 OnlyOffice 日志
sudo tail -f /var/log/onlyoffice/documentserver/docservice/out.log

# 3. 测试健康检查
curl http://localhost:8000/healthcheck
# 应返回：{"status": "OK"}

# 4. 浏览器访问编辑器测试文档编辑
```

---

## 🚨 常见问题排查

### 问题 1：安装时提示 "No package postgresql13 available"

```bash
# 确认仓库配置正确
cat /etc/yum.repos.d/pgdg-13.repo

# 手动测试仓库访问
curl -I https://mirrors.aliyun.com/postgresql/repos/yum/13/redhat/rhel-7-x86_64/repodata/repomd.xml

# 如果仍失败，尝试手动下载 RPM 安装
cd /tmp
wget https://mirrors.aliyun.com/postgresql/repos/yum/13/redhat/rhel-7-x86_64/postgresql13-server-13.15-1PGDG.rhel7.x86_64.rpm
wget https://mirrors.aliyun.com/postgresql/repos/yum/13/redhat/rhel-7-x86_64/postgresql13-13.15-1PGDG.rhel7.x86_64.rpm
wget https://mirrors.aliyun.com/postgresql/repos/yum/13/redhat/rhel-7-x86_64/postgresql13-contrib-13.15-1PGDG.rhel7.x86_64.rpm
sudo yum localinstall -y postgresql13-*.rpm
```

### 问题 2：初始化数据库失败

```bash
# 检查数据目录权限
ls -la /var/lib/pgsql/13/data/
sudo chown -R postgres:postgres /var/lib/pgsql/13/data/
sudo chmod 700 /var/lib/pgsql/13/data/

# 重新初始化（⚠️ 会清空数据！）
sudo systemctl stop postgresql-13
sudo rm -rf /var/lib/pgsql/13/data/*
sudo /usr/pgsql-13/bin/postgresql-13-setup initdb
sudo systemctl start postgresql-13
```

### 问题 3：OnlyOffice 仍报数据库连接错误

```bash
# 1. 确认 PostgreSQL 监听地址
sudo grep "listen_addresses" /var/lib/pgsql/13/data/postgresql.conf
# 应为：listen_addresses = 'localhost' 或 '*'

# 2. 确认防火墙放行
sudo firewall-cmd --list-all
sudo firewall-cmd --add-port=5432/tcp --permanent  # 如需远程访问
sudo firewall-cmd --reload

# 3. 确认 onlyoffice 用户权限
sudo -u postgres psql -c "\du onlyoffice"
sudo -u postgres psql -c "\l onlyoffice"

# 4. 查看 OnlyOffice 详细日志
sudo tail -100 /var/log/onlyoffice/documentserver/docservice/out.log | grep -i postgres
```

---

## 📋 安装验证清单

| 检查项          | 命令                                        | 预期结果                      |
| --------------- | ------------------------------------------- | ----------------------------- |
| 仓库配置        | `cat /etc/yum.repos.d/pgdg-13.repo`         | 包含阿里云 baseurl            |
| 包安装          | `rpm -qa \| grep postgresql13`              | 显示 `postgresql13-server` 等 |
| 服务状态        | `sudo systemctl status postgresql-13`       | `active (running)`            |
| 端口监听        | `sudo ss -tlnp \| grep 5432`                | `postgres` 进程               |
| 数据库存在      | `psql -U onlyoffice -d onlyoffice -c "\dt"` | 显示 OnlyOffice 表            |
| OnlyOffice 连接 | `curl http://localhost:8000/healthcheck`    | `{"status": "OK"}`            |

---

> 💡 **重要提醒**：
> 1. **密码安全**：请将 `YourSecurePassword123!` 替换为强密码，并同步更新 OnlyOffice 配置
> 2. **备份策略**：建议配置定期备份：`pg_dump -U onlyoffice onlyoffice > /backup/onlyoffice_$(date +%Y%m%d).sql`
> 3. **CentOS 7 EOL**：CentOS 7 已停止官方支持，建议规划迁移到 Rocky Linux 8/9 或 AlmaLinux

完成以上步骤后，PostgreSQL 13 应能正常支持 OnlyOffice 8.1.1 的协同编辑功能！🎉

如果仍有问题，请提供：
1. `sudo yum install -y postgresql13-server --disableplugin=protectbase` 的完整输出
2. `sudo tail -50 /var/log/onlyoffice/documentserver/docservice/out.log` 的最新日志







### 3. 启动并配置 RabbitMQ

```bash
# 启动 RabbitMQ 并设置开机自启
sudo systemctl start rabbitmq-server
sudo systemctl enable rabbitmq-server

# 创建 onlyoffice 用户
sudo rabbitmqctl add_user onlyoffice onlyoffice_pass
sudo rabbitmqctl set_permissions onlyoffice ".*" ".*" ".*"
```

### 4. 启动并配置 Redis

```bash
# 启动 Redis 并设置开机自启
sudo systemctl start redis
sudo systemctl enable redis

# 可选：设置密码（编辑 /etc/redis.conf）
# requirepass your_redis_password
```

### 5. 配置 Nginx 反向代理

```bash
# 备份默认配置
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak

# 创建 OnlyOffice 配置
sudo vi /etc/nginx/conf.d/onlyoffice.conf
```

```nginx
# /etc/nginx/conf.d/onlyoffice.conf
upstream documentserver {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或服务器IP

    # 限制上传大小
    client_max_body_size 100M;

    # 日志
    access_log /var/log/nginx/onlyoffice-access.log;
    error_log /var/log/nginx/onlyoffice-error.log;

    # 静态文件
    location / {
        proxy_pass http://documentserver;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # WebSocket 支持
        proxy_read_timeout 3600s;
        proxy_connect_timeout 3600s;
    }

    # 健康检查
    location /healthcheck {
        proxy_pass http://documentserver;
        proxy_http_version 1.1;
    }
}
```

```bash
# 测试 Nginx 配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 6. 配置 OnlyOffice

```bash
# 编辑 OnlyOffice 配置文件
sudo vi /etc/onlyoffice/documentserver/local.json
```

```json
{
  "services": {
    "CoAuthoring": {
      "sql": {
        "type": "postgres",
        "dbHost": "localhost",
        "dbPort": 5432,
        "dbName": "onlyoffice",
        "dbUser": "onlyoffice",
        "dbPass": "onlyoffice_pass"
      },
      "token": {
        "enable": {
          "browser": true,
          "request": {
            "inbox": true,
            "outbox": true
          }
        },
        "inbox": {
          "header": "Authorization",
          "prefix": "Bearer ",
          "secret": "your_jwt_secret"
        },
        "outbox": {
          "header": "Authorization",
          "prefix": "Bearer ",
          "secret": "your_jwt_secret"
        }
      }
    }
  }
}
```

### 7. 启动 OnlyOffice 服务

```bash
# 运行安装脚本（自动配置所有服务）
sudo /usr/bin/documentserver-prepare4shutdown.sh  # 如果有升级需求

# 启动 Document Server
sudo supervisorctl start all

# 或手动启动各服务
sudo systemctl start onlyoffice-documentserver
sudo systemctl enable onlyoffice-documentserver
```

---

## 🔐 配置 JWT 认证（推荐生产环境使用）

```bash
# 生成 JWT Secret
JWT_SECRET=$(openssl rand -hex 32)
echo "JWT Secret: $JWT_SECRET"

# 更新 local.json 中的 JWT 配置
sudo vi /etc/onlyoffice/documentserver/local.json
```

```json
"token": {
  "inbox": {
    "secret": "your_generated_jwt_secret",
    "header": "Authorization",
    "prefix": "Bearer "
  },
  "outbox": {
    "secret": "your_generated_jwt_secret",
    "header": "Authorization",
    "prefix": "Bearer "
  }
}
```

---

## 🚀 启动并验证

### 1. 启动所有服务

```bash
# 重启所有相关服务
sudo systemctl restart postgresql
sudo systemctl restart rabbitmq-server
sudo systemctl restart redis
sudo systemctl restart nginx
sudo supervisorctl restart all

# 或使用 OnlyOffice 提供的脚本
sudo /usr/bin/documentserver-startup.sh
```

### 2. 检查服务状态

```bash
# 检查 Document Server 状态
sudo supervisorctl status

# 检查端口监听
sudo netstat -tlnp | grep -E '80|443|8000'

# 查看日志
sudo tail -f /var/log/onlyoffice/documentserver/docservice/out.log
sudo tail -f /var/log/nginx/onlyoffice-error.log
```

### 3. 验证安装

```bash
# 本地测试
curl -I http://localhost/healthcheck

# 浏览器访问
# http://your-server-ip/
# 应看到 "OnlyOffice Document Server is working" 页面
```

---

## 🔧 常见问题排查

### 问题 1：依赖包冲突

```bash
# 查看缺少的依赖
sudo yum localinstall onlyoffice-documentserver-8.1.1.x86_64.rpm

# 手动安装缺失依赖
sudo yum install -y <package-name>

# 或使用 --skip-broken 跳过（不推荐）
sudo yum localinstall --skip-broken onlyoffice-documentserver-8.1.1.x86_64.rpm
```





### 问题 2：PostgreSQL 连接失败

```bash
# 检查 PostgreSQL 状态
sudo systemctl status postgresql

# 检查监听配置
sudo vi /var/lib/pgsql/data/postgresql.conf
# 确保: listen_addresses = '*'

# 检查防火墙
sudo firewall-cmd --add-port=5432/tcp --permanent
sudo firewall-cmd --reload
```

### 问题 3：Nginx 502 错误

```bash
# 检查 Document Server 是否运行
sudo supervisorctl status

# 检查端口 8000 是否监听
sudo netstat -tlnp | grep 8000

# 重启 Document Server
sudo supervisorctl restart all
```

### 问题 4：WebSocket 连接失败

```bash
# 确保 Nginx 配置了 WebSocket 代理头
# proxy_set_header Upgrade $http_upgrade;
# proxy_set_header Connection "upgrade";

# 检查防火墙是否放行
sudo firewall-cmd --add-service=http --permanent
sudo firewall-cmd --add-service=https --permanent
sudo firewall-cmd --reload
```

---

## 🛡️ 安全加固建议

```bash
# 1. 启用 HTTPS（使用 Let's Encrypt）
sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

# 2. 配置防火墙
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# 3. 限制数据库访问
sudo vi /var/lib/pgsql/data/pg_hba.conf
# 仅允许本地连接:
# host    all    all    127.0.0.1/32    md5

# 4. 定期备份
sudo crontab -e
# 添加每日备份任务:
0 2 * * * pg_dump -U onlyoffice onlyoffice > /backup/onlyoffice_$(date +\%Y\%m\%d).sql
```

---

## 📦 卸载 OnlyOffice

```bash
# 停止服务
sudo supervisorctl stop all
sudo systemctl stop nginx postgresql rabbitmq-server redis

# 卸载 RPM 包
sudo yum remove -y onlyoffice-documentserver

# 清理配置和数据（谨慎操作）
sudo rm -rf /etc/onlyoffice
sudo rm -rf /var/lib/onlyoffice
sudo rm -rf /var/log/onlyoffice
sudo rm -rf /usr/share/documentserver

# 删除数据库（如果需要）
sudo -i -u postgres
psql
DROP DATABASE onlyoffice;
DROP USER onlyoffice;
\q
exit
```

---

> 💡 **提示**：
> 1. 生产环境建议配置 HTTPS 和 JWT 认证
> 2. 定期备份数据库和配置文件
> 3. 监控日志文件及时发现异常
> 4. 如需集群部署，请参考官方集群文档

如果安装过程中遇到具体错误，可以提供错误信息，我帮你进一步分析解决。





### onlyoffice 服务器 



##### nginx.conf 配置：

```

upstream documentserver {
    server localhost:8000;
}

server
{
    listen 12280;
    server_name onlyoffice.first-iq.com;
    
    
    # 🔧 添加 CORS 头
    add_header 'Access-Control-Allow-Origin' 'http://192.168.1.130:10900' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Authorization,Content-Type' always;
    
    
    
    
    index index.php index.html index.htm default.php default.htm default.html;
    root /www/wwwroot/onlyoffice.first-iq.com;
    #CERT-APPLY-CHECK--START
    # 用于SSL证书申请时的文件验证相关配置 -- 请勿删除
    include /www/server/panel/vhost/nginx/well-known/onlyoffice.first-iq.com.conf;
    #CERT-APPLY-CHECK--END

    #SSL-START SSL相关配置，请勿删除或修改下一行带注释的404规则
    #error_page 404/404.html;
    #SSL-END

    #ERROR-PAGE-START  错误页配置，可以注释、删除或修改
    error_page 404 /404.html;
    #error_page 502 /502.html;
    #ERROR-PAGE-END

    #PHP-INFO-START  PHP引用配置，可以注释或修改
    include enable-php-72.conf;
    #PHP-INFO-END

    #REWRITE-START URL重写规则引用,修改后将导致面板设置的伪静态规则失效
    include /www/server/panel/vhost/rewrite/onlyoffice.first-iq.com.conf;
    #REWRITE-END

    #禁止访问的文件或目录
    location ~ ^/(\.user.ini|\.htaccess|\.git|\.env|\.svn|\.project|LICENSE|README.md)
    {
        return 404;
    }

    #一键申请SSL证书验证目录相关设置
    location ~ \.well-known{
        allow all;
    }

    #禁止在证书验证目录放入敏感文件
    if ( $uri ~ "^/\.well-known/.*\.(php|jsp|py|js|css|lua|ts|go|zip|tar\.gz|rar|7z|sql|bak)$" ) {
        return 403;
    }

    location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)$
    {
        expires      30d;
        error_log /dev/null;
        access_log /dev/null;
    }

    location ~ .*\.(js|css)?$
    {
        expires      12h;
        error_log /dev/null;
        access_log /dev/null;
    }
    
    # 代理到 Document Server
    location / {
        proxy_pass http://documentserver;
        proxy_http_version 1.1;
        
        # WebSocket 支持（必需）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 标准代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        
        # 文件大小限制
        client_max_body_size 100M;
    }
    
    # 健康检查端点
    location /healthcheck {
        proxy_pass http://documentserver/healthcheck;
        access_log off;
    }
    
    access_log  /www/wwwlogs/onlyoffice.first-iq.com.log;
    error_log  /www/wwwlogs/onlyoffice.first-iq.com.error.log;
}
```





### 项目服务器

##### nginx.conf配置：

```
server
{
    listen 80;
    listen 443 ssl http2 ;
    server_name chat.first-iq.com;
    index index.php index.html index.htm default.php default.htm default.html;
    root /www/yue/company_chat/;
    #CERT-APPLY-CHECK--START
    # 用于SSL证书申请时的文件验证相关配置 -- 请勿删除
    include /www/server/panel/vhost/nginx/well-known/chat.first-iq.com.conf;
    #CERT-APPLY-CHECK--END
    include /www/server/panel/vhost/nginx/extension/chat.first-iq.com/*.conf;
    
    #SSL-START SSL相关配置，请勿删除或修改下一行带注释的404规则
    #error_page 404/404.html;
    ssl_certificate    /www/server/panel/vhost/cert/chat.first-iq.com/fullchain.pem;
    ssl_certificate_key    /www/server/panel/vhost/cert/chat.first-iq.com/privkey.pem;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+CHACHA20-draft:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_tickets on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=31536000";
    error_page 497  https://$host$request_uri;

    #SSL-END

    #ERROR-PAGE-START  错误页配置，可以注释、删除或修改
    error_page 404 /404.html;
    #error_page 502 /502.html;
    #ERROR-PAGE-END

    #PHP-INFO-START  PHP引用配置，可以注释或修改
    include enable-php-74.conf;
    #PHP-INFO-END

    #REWRITE-START URL重写规则引用,修改后将导致面板设置的伪静态规则失效
    include /www/server/panel/vhost/rewrite/chat.first-iq.com.conf;
    #REWRITE-END
    
    # === 关键修复：将静态文件和媒体文件配置移到最前面 ===
    
    # 静态文件路径
    location /static/ {
        alias /www/yue/company_chat/static/;
        # expires 365d;
        access_log off;
        # add_header Cache-Control "public, max-age=31536000, immutable";
        expires 1y;
        add_header Cache-Control "public, immutable";
        disable_symlinks off;
        
        # 文件类型设置
        types {
            text/html html;
            text/css css;
            application/javascript js;
            image/svg+xml svg;
            image/png png;
            image/jpeg jpg jpeg;
            font/woff2 woff2;
            application/font-woff woff;
            application/font-woff2 woff2;
            application/vnd.ms-fontobject eot;
            application/x-font-ttf ttf;
        }
    }
    
    # 媒体文件路径（含视频、图片等）
    location /media/ {
        alias /www/yue/company_chat/media/;
        expires 30d;
        # access_log off;
        # add_header Cache-Control "public, max-age=2592000";
        add_header Cache-Control "public, immutable";
        
        # 支持 Range 请求（用于视频拖拽播放）
        add_header Accept-Ranges bytes;
        
        # 允许访问MP3文件
        location ~* \.(mp3|webm|ogg|wav)$ {
            add_header Content-Type audio/mpeg;
            expires 30d;
        }
    }
    
    # === OnlyOffice 反向代理（修复版）===
    # 🔧 使用 ^~ 确保优先匹配，不被正则规则拦截
    location ^~ /onlyoffice/ {
        # 🔧 关键：末尾的 / 实现路径重写
        # /onlyoffice/web-apps/... → http://192.168.1.122:80/web-apps/...
        proxy_pass http://192.168.1.122:8000/;
        
        proxy_http_version 1.1;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 🔧 关键：传递正确的 Host 头
        proxy_set_header Host 192.168.1.122;
        
        # 标准代理头
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # 🔧 禁用缓冲，支持大文件和流式传输
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        
        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        
        # 文件大小
        client_max_body_size 100M;
        
        # 🔧 添加 CORS 头（如果 OnlyOffice 需要）
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Authorization,Content-Type' always;
        
        # 处理预检请求
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Authorization,Content-Type' always;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            add_header 'Content-Length' 0;
            return 204;
        }
    }
    
    # === OnlyOffice 反向代理（修复版）===
    # 🔧 使用 ^~ 确保优先匹配，不被正则规则拦截
    location ^~ /cache/ {
        # 🔧 关键：末尾的 / 实现路径重写
        # /cache/files/data/... → http://192.168.1.122:80/files/data/...
        proxy_pass http://192.168.1.122:8000/cache/;
        
        proxy_http_version 1.1;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 🔧 关键：传递正确的 Host 头
        proxy_set_header Host 192.168.1.122;
        
        # 标准代理头
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # 🔧 禁用缓冲，支持大文件和流式传输
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        
        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        
        # 文件大小
        client_max_body_size 100M;
        
        # 🔧 添加 CORS 头（如果 OnlyOffice 需要）
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Authorization,Content-Type' always;
        
        # 处理预检请求
        if ($request_method = 'OPTIONS') {
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
            add_header 'Access-Control-Allow-Headers' 'Authorization,Content-Type' always;
            add_header 'Content-Type' 'text/plain charset=UTF-8';
            add_header 'Content-Length' 0;
            return 204;
        }
    }
    
    
    # === 🔧 关键修复2：API 接口专门配置（放在 location / 之前） ===
    
    # API 接口（含查询参数导出）
    location /api/ {
        proxy_pass http://localhost:10900;
        
        # 🔧 关键：确保请求头完整传递
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 🔧 关键：确保查询参数正确传递（$args 自动包含）
        # proxy_pass 会自动传递 $query_string，无需额外配置
        
        # 🔧 关键：禁用缓冲，支持流式下载（导出大文件必需）
        proxy_buffering off;
        proxy_cache off;
        proxy_request_buffering off;
        
        # 🔧 关键：增加超时时间（导出可能需要较长时间）
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        send_timeout 120s;
        
        # 允许大文件下载
        client_max_body_size 100M;
        
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # === 🔧 关键修复3：静态文件正则匹配（排除 API 路径） ===
    
    # 静态资源正则匹配（排除 /api/ /static/ /media/）
    location ~ ^/(?!api/|static/|media/).*\.(js|css|html|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|pdf|mp3|webm|ogg)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000";
        add_header X-Content-Type-Options nosniff;
    }
    
    # HTML 文件禁止缓存
    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        etag off;
        access_log off;
    }
    
    # === 🔧 关键修复4：敏感文件保护 ===
    
    # 禁止访问敏感文件

    #禁止访问的文件或目录
    location ~ ^/(\.user.ini|\.htaccess|\.git|\.env|\.svn|\.project|LICENSE|README.md)
    {
        return 404;
    }

    #一键申请SSL证书验证目录相关设置
    location ~ \.well-known{
        allow all;
        access_log off;
    }
    
    
    
    # === 🔧 关键修复5：/admin/ 访问控制 ===
    
    # 管理员后台访问控制
    location /admin/ {
        allow 192.168.1.0/24;  # 允许内网 IP 段访问
        allow 127.0.0.1;       # 允许本地访问
        allow 122.226.65.250;
        allow 122.226.220.154;
        allow 183.146.250.208;
        allow 211.90.253.247;
        deny all;              # 禁止其他所有 IP 访问
        
        # 代理到后端服务（如 Django、Node.js 等）
        proxy_pass http://localhost:10900;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    
    # === 🔧 关键修复6：默认 location /（最后匹配） ===
    
    # 默认请求处理（捕获所有未匹配请求）
    # 动态请求转发
    location / {
        include uwsgi_params;
        # uwsgi_pass 127.0.0.1:10900; # uWSGI 监听的socket地址和端口
        proxy_pass http://localhost:10900;  # 假设uvicorn Django 运行在 9096:8896 端口 
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 🔧 关键修复：增加超时时间（转码可能需要较长时间）
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;  # 增加到120秒
        send_timeout 120s;
        
        # 允许大文件上传
        client_max_body_size 50M;
        
        # WebSocket支持（如果需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    

    #禁止在证书验证目录放入敏感文件
    if ( $uri ~ "^/\.well-known/.*\.(php|jsp|py|js|css|lua|ts|go|zip|tar\.gz|rar|7z|sql|bak)$" ) {
        return 403;
    }

    location ~ .*\.(gif|jpg|jpeg|png|bmp|swf)$
    {
        expires      30d;
        error_log /dev/null;
        access_log /dev/null;
    }

    location ~ .*\.(js|css)?$
    {
        # 无版本参数的资源短期缓存
        add_header Cache-Control "public, max-age=3600";
        expires 1h;
        etag on;
        error_log /dev/null;
        access_log /dev/null;
    }
    
    # HTML 文件禁止缓存
    location ~* \.html$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
        etag off;
    }
    
    # 静态文件缓存配置
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|pdf|woff|woff2|ttf|svg|eot|pdf)$ {
        # 缓存有效期为 30 天
        expires 30d;

        # 禁用日志记录以减少 I/O 开销
        access_log off;


        # 开启 gzip 压缩（可选）
        gzip_static on;

        # 防止跨站脚本攻击（可选）
        # add_header X-Content-Type-Options nosniff;
    }
    
  
  
    
    types {
        text/css css;
        application/javascript js;
        application/json json;
        image/jpeg jpg jpeg;
        image/png png;
        image/gif gif;
        image/x-icon ico;
        # 其他常用 MIME 类型...
        video/mp4 mp4;
        video/webm webm;
        video/x-matroska mkv;
        video/quicktime mov;
        # 其他视频格式...
    }
    
    include       mime.types;
    
    access_log  /www/wwwlogs/chat.first-iq.com.log;
    error_log  /www/wwwlogs/chat.first-iq.com.error.log;
}
```

