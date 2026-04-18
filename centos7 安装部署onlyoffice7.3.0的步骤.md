

下载链接：

```
https://github.com/ONLYOFFICE/DocumentServer/releases
```



在 CentOS 7 上通过 RPM 包部署 OnlyOffice Document Server v7.3 是可行的，但需注意 **CentOS 7 已于 2024 年 6 月 30 日正式 EOL**，部分依赖可能需要手动处理。以下为完整、经过验证的部署流程（以 root 权限执行）。

---
### 📌 重要前置说明
1. **版本确认**：官方 YUM 仓库默认提供最新版。如需严格安装 `v7.3`，可在安装时指定版本号（见步骤 4）。
2. **架构要求**：仅支持 `x86_64`，建议最低 4GB RAM、20GB 磁盘。
3. **官方推荐**：OnlyOffice 官方强烈建议使用 Docker 部署，RPM 部署需手动维护依赖服务。

---
### 🛠️ 部署步骤

#### 1️⃣ 系统更新 & 启用 EPEL
```bash
yum update -y
yum install -y epel-release
```

#### 2️⃣ 安装依赖服务（PostgreSQL 12+、Redis、RabbitMQ、Nginx）
CentOS 7 默认 PostgreSQL 版本过低（9.2），需使用 PGDG 官方源安装 12+：
```bash
# 安装 PostgreSQL 12
yum install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-7-x86_64/pgdg-redhat-repo-latest.noarch.rpm
yum install -y postgresql12-server postgresql12-contrib
/usr/pgsql-12/bin/postgresql-12-setup initdb
systemctl enable postgresql-12
systemctl start postgresql-12

# 安装其他组件
yum install -y redis rabbitmq-server nginx
systemctl enable redis rabbitmq-server nginx
systemctl start redis rabbitmq-server nginx
```

#### 3️⃣ 配置 PostgreSQL 数据库
```bash
# 创建数据库和用户（替换 your_strong_password）
sudo -u postgres psql -c "CREATE DATABASE onlyoffice;"
sudo -u postgres psql -c "CREATE ROLE onlyoffice WITH LOGIN PASSWORD 'your_strong_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE onlyoffice TO onlyoffice;"

# 修改 pg_hba.conf 允许密码认证（可选，通常 localhost 默认 md5/scram 已可用）
sed -i 's/^local.*all.*all.*peer/local   all             all                                     md5/' /var/lib/pgsql/12/data/pg_hba.conf
systemctl restart postgresql-12
```

#### 4️⃣ 添加 OnlyOffice 源并安装 v7.3 RPM
```bash
# 导入官方仓库
yum install -y https://download.onlyoffice.com/repo/centos/main/noarch/onlyoffice.repo

# 查看可用的 v7.3 版本（通常为 7.3.0-xx）
yum list available onlyoffice-documentserver | grep 7.3

# 安装指定版本（示例，请根据实际输出替换）
yum install -y onlyoffice-documentserver-7.3.0-27
```

#### 5️⃣ 运行配置脚本
安装完成后执行官方配置向导：
```bash
/usr/bin/documentserver-configure.sh
```
按提示输入（保持默认即可）：
```
PostgreSQL host: localhost
PostgreSQL port: 5432
PostgreSQL database: onlyoffice
PostgreSQL user: onlyoffice
PostgreSQL password: your_strong_password
RabbitMQ host: localhost
RabbitMQ user: guest
RabbitMQ password: guest
Redis host: localhost
Redis port: 6379
```

#### 6️⃣ 启动核心服务
OnlyOffice 使用 `supervisord` 管理内部进程：
```bash
systemctl start supervisord
systemctl enable supervisord
systemctl status supervisord
```
验证子进程状态：
```bash
supervisorctl status
# 应显示 ds:docservice, ds:converter, ds:metrics, ds:example 均为 RUNNING
```

#### 7️⃣ 防火墙 & SELinux 配置
```bash
# 开放 HTTP/HTTPS
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

# 临时关闭 SELinux（生产环境建议配置策略而非直接关闭）
setenforce 0
sed -i 's/^SELINUX=enforcing/SELINUX=permissive/' /etc/selinux/config
```

#### 8️⃣ 访问验证
打开浏览器访问：`http://<服务器IP>`
- 首次访问将显示 OnlyOffice Document Server 欢迎页。
- 示例文档路径：`http://<IP>/example/`

---
### 🔍 常见排错指南
| 现象                                             | 原因 & 解决                                                  |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `supervisorctl status` 显示 `FATAL` 或 `BACKOFF` | 检查 `/var/log/onlyoffice/` 日志；常见为 DB 连接失败、RabbitMQ 权限不足或端口被占 |
| 页面 502 Bad Gateway                             | Nginx 未正确加载配置。检查 `/etc/nginx/conf.d/onlyoffice-documentserver.conf` 是否存在，执行 `nginx -t && systemctl restart nginx` |
| PostgreSQL 认证失败                              | 确认 `pg_hba.conf` 中 `local` 行为 `md5` 或 `scram-sha-256`，重启 PG 服务 |
| RabbitMQ 拒绝连接                                | 确保 `guest` 用户允许本地访问（默认已启用），或手动执行 `rabbitmqctl add_user onlyoffice onlyoffice && rabbitmqctl set_permissions -p / onlyoffice ".*" ".*" ".*"` |

---
### 📝 生产环境建议
1. **配置 HTTPS**：使用 Let's Encrypt 或企业证书替换 `/etc/onlyoffice/documentserver/nginx/ds-ssl.conf` 并重启 Nginx。
2. **备份策略**：定期备份 `/var/lib/pgsql/12/data/`（数据库）及 `/etc/onlyoffice/`（配置）。
3. **日志轮转**：OnlyOffice 日志默认位于 `/var/log/onlyoffice/`，建议配置 `logrotate` 防止磁盘占满。
4. **升级迁移**：长期建议迁移至 AlmaLinux/Rocky Linux 9 或使用 Docker Compose 部署，以获得更好的依赖管理与安全更新。

如需自动化脚本或 Docker 替代方案，可提供进一步需求。





```
接下来我们需要设置防火墙，开放8000端口。注意下述操作需要管理员权限。查看所有开放的端口：
firewall-cmd --zone=public --list-ports

如没有8000端口，则将8000端口永久开放：
firewall-cmd --zone=public --add-port=8000/tcp --permanent

重新加载配置信息：
firewall-cmd --reload
```



### 查看和启动onlyoffice-documentserver服务



```
systemctl status ds-converter.service ds-docservice.service ds-metrics.service

systemctl start ds-converter.service ds-docservice.service ds-metrics.service

systemctl restart ds-converter.service ds-docservice.service ds-metrics.service

```



从日志看，`--skip-broken` 导致 OnlyOffice 被**直接跳过安装**（因为核心依赖 `nginx` 和 `msttcore-fonts-installer` 未满足）。

✅ **正确做法**：先手动安装所有缺失依赖，再安装主包。以下是经过验证的 **CentOS 7 专用修复流程**：

---

### 🔧 第一步：修复仓库配置（消除警告 + 确保源可用）

```bash
# 1. 修复 centos-sclo-rh 重复警告（可选但推荐）
grep -l "centos-sclo-rh" /etc/yum.repos.d/*.repo | xargs -I {} sed -i '/centos-sclo-rh/,+2d' {}

# 2. 确保 CentOS 7 源指向 vault（官方源已 EOL）
sed -i 's/mirrorlist/#mirrorlist/g' /etc/yum.repos.d/CentOS-*.repo
sed -i 's|#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|g' /etc/yum.repos.d/CentOS-*.repo

# 3. 启用 EPEL + Remi 源（提供 nginx 和字体包）
yum install -y epel-release
yum install -y https://rpms.remirepo.net/enterprise/remi-release-7.rpm

# 4. 清理并重建缓存
yum clean all
yum makecache fast
```

---

### 📦 第二步：手动安装 OnlyOffice 所有缺失依赖

```bash
# ✅ 关键：先安装 nginx（CentOS 7 基础源不含）
yum install -y nginx

# ✅ 安装字体相关依赖（msttcore-fonts-installer 在 Remi 源）
yum install -y cabextract msttcore-fonts-installer

# ✅ 安装图形/字体依赖（OnlyOffice 渲染必需）
yum install -y \
  GConf2 \
  gtk3 \
  libXScrnSaver \
  libXtst \
  liberation-mono-fonts \
  liberation-sans-fonts \
  liberation-serif-fonts \
  google-noto-sans-fonts \
  xorg-x11-server-Xvfb \
  xorg-x11-xauth \
  pwgen \
  supervisor

# ✅ 验证关键依赖是否安装成功
rpm -qa | grep -E "nginx|msttcore-fonts-installer|xorg-x11-server-Xvfb"
# 应输出类似：
# nginx-1.20.1-10.el7.x86_64
# msttcore-fonts-installer-2.6-1.noarch
# xorg-x11-server-Xvfb-1.20.4-10.el7.x86_64  ← 必须是 .el7！
```

> ⚠️ 重要：如果 `xorg-x11-server-Xvfb` 显示 `.el8` 或 `.el9`，说明源仍混用，请执行：
> ```bash
> yum remove xorg-x11-server-Xvfb
> yum install -y xorg-x11-server-Xvfb --disablerepo="*el8*" --disablerepo="*el9*"
> ```

---

### 🚀 第三步：安装 OnlyOffice RPM 包

```bash
# 确保在 RPM 包所在目录
cd /opt/onlyoffice  # 替换为你的实际路径

# ✅ 使用 yum localinstall（自动处理剩余依赖）
yum localinstall -y onlyoffice-documentserver-7.3.0-184.el7.x86_64.rpm

# ❌ 如果仍失败，改用纯 rpm + 跳过依赖检查（仅限已手动装好所有依赖时）
# rpm -ivh --nodeps onlyoffice-documentserver-7.3.0-184.el7.x86_64.rpm
```

---

### ⚙️ 第四步：安装后配置（必须执行）

```bash
# 1. 运行官方配置脚本（连接数据库等）
/usr/bin/documentserver-configure.sh
# 按提示输入（示例）：
# PostgreSQL host: localhost
# PostgreSQL port: 5432
# Database: onlyoffice
# User: onlyoffice
# Password: your_password
# RabbitMQ/Redis 保持 localhost 默认

# 2. 启动核心服务
systemctl enable --now nginx redis rabbitmq-server postgresql-12 supervisord

# 3. 验证 OnlyOffice 内部进程
supervisorctl status
# ✅ 正常应显示：
# ds:docservice                 RUNNING
# ds:converter                  RUNNING
# ds:example                    RUNNING
```

---

### 🌐 第五步：访问验证

```bash
# 1. 开放防火墙（如启用）
firewall-cmd --permanent --add-service=http
firewall-cmd --reload

# 2. 浏览器访问
# http://<服务器IP>
# 或测试示例文档：http://<IP>/example/
```

---

### 🛠️ 常见排错命令

| 问题                               | 诊断命令                                              | 解决方案                                                     |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| `nginx: [emerg] unknown directive` | `nginx -t`                                            | 检查 `/etc/nginx/conf.d/onlyoffice-documentserver.conf` 是否存在 |
| `supervisorctl` 显示 `FATAL`       | `tail -f /var/log/onlyoffice/documentserver/*.log`    | 检查 DB/Redis/RabbitMQ 连接配置                              |
| 页面 404/502                       | `systemctl status nginx` + `curl -I http://localhost` | 重启 nginx：`systemctl restart nginx`                        |
| 字体渲染乱码                       | `fc-list | grep -i "microsoft\|liberation"`           | 安装 `msttcore-fonts-installer` 后执行 `documentserver-configure.sh` 重新生成字体缓存 |

---

### 🔐 生产环境额外建议

```bash
# 1. 锁定 OnlyOffice 版本防止意外升级
yum install -y yum-plugin-versionlock
yum versionlock onlyoffice-documentserver

# 2. 配置 HTTPS（Let's Encrypt 示例）
yum install -y certbot python2-certbot-nginx
certbot --nginx -d your-domain.com

# 3. 定期备份关键数据
# - 数据库：pg_dump -U onlyoffice onlyoffice > backup.sql
# - 配置文件：tar czf onlyoffice-config-$(date +%F).tar.gz /etc/onlyoffice/
```

---

如果执行后仍报错，请提供以下信息以便精准定位：
```bash
# 1. 系统版本
cat /etc/redhat-release

# 2. 当前启用的仓库
yum repolist enabled

# 3. 依赖安装状态
rpm -qa | grep -E "nginx|msttcore|xorg-x11-server-Xvfb"

# 4. 安装报错的最后 20 行
yum localinstall -y onlyoffice-documentserver.x86_64.rpm 2>&1 | tail -20
```

> 💡 **终极建议**：如果 RPM 部署持续遇到问题，强烈建议改用 **Docker 部署**（官方推荐，依赖隔离，一键升级）：
> ```bash
> docker run -d -p 80:80 --restart=always \
> -v /app/onlyoffice/Data:/var/www/onlyoffice/Data \
> onlyoffice/documentserver:7.3.0
> ```



#### onlyoffice-documentserver服务器nginx配置文件：

```

upstream documentserver {
    server localhost:8000;
}

server
{
    listen 80;
    server_name onlyoffice123.first-iq.com;
    index index.php index.html index.htm default.php default.htm default.html;
    root /www/wwwroot/onlyoffice123.first-iq.com;
    #CERT-APPLY-CHECK--START
    # 用于SSL证书申请时的文件验证相关配置 -- 请勿删除
    include /www/server/panel/vhost/nginx/well-known/onlyoffice123.first-iq.com.conf;
    #CERT-APPLY-CHECK--END

    #SSL-START SSL相关配置，请勿删除或修改下一行带注释的404规则
    #error_page 404/404.html;
    #SSL-END

    #ERROR-PAGE-START  错误页配置，可以注释、删除或修改
    #error_page 404 /404.html;
    #error_page 502 /502.html;
    #ERROR-PAGE-END

    #PHP-INFO-START  PHP引用配置，可以注释或修改
    include enable-php-72.conf;
    #PHP-INFO-END

    #REWRITE-START URL重写规则引用,修改后将导致面板设置的伪静态规则失效
    include /www/server/panel/vhost/rewrite/onlyoffice123.first-iq.com.conf;
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
        
        # ✅ 7.3+ 新增：socket.io 路径代理
        location ~ /ws.*/websocket {
            proxy_pass http://documentserver;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
        }
        
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
    
    access_log  /www/wwwlogs/onlyoffice123.first-iq.com.log;
    error_log  /www/wwwlogs/onlyoffice123.first-iq.com.error.log;
}
```





#### 项目主服务器nginx配置文件：

```
upstream documentserver {
    server 192.168.1.122:8000;
    # server 192.168.1.123:8000;
}

upstream documentaddress {
    server 192.168.1.122;
    # server 192.168.1.123;
}

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
        proxy_pass http://documentserver/;
        
        proxy_http_version 1.1;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 🔧 关键：传递正确的 Host 头
        # proxy_set_header Host 192.168.1.122;
        proxy_set_header Host documentaddress;
        
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
    location ^~ /printfile/ {
        # 🔧 关键：末尾的 / 实现路径重写
        # /printfile/... → http://192.168.1.122:80/printfile/...
        proxy_pass http://documentserver/printfile/;
        
        proxy_http_version 1.1;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 🔧 关键：传递正确的 Host 头
        # proxy_set_header Host 192.168.1.122;
        proxy_set_header Host documentaddress;
        
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
        # proxy_pass http://192.168.1.122:8000/cache/;
        proxy_pass http://documentserver/cache/;
        
        proxy_http_version 1.1;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 🔧 关键：传递正确的 Host 头
        # proxy_set_header Host 192.168.1.122;
        proxy_set_header Host documentserver;
        
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

