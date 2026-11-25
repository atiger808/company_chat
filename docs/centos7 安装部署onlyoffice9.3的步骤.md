在 CentOS 7 上部署 OnlyOffice 9.3，推荐优先使用 **Docker** 部署，可以避开很多依赖问题；如果条件不允许，也可以采用 **RPM 包** 的方式安装。



```
https://github.com/ONLYOFFICE/DocumentServer/releases
```



### 📋 部署前的检查

在开始前，请确保你的 CentOS 7 服务器满足以下要求，以保证 OnlyOffice 9.3 的顺畅运行：

| 组件                | 最低要求                                  | 备注                                 |
| :------------------ | :---------------------------------------- | :----------------------------------- |
| **CPU**             | 双核 2 GHz 或更高                         | 建议配置更高以提升性能               |
| **内存 (RAM)**      | 至少 2 GB，建议 8 GB+                     | 内存大小直接影响并发处理能力         |
| **硬盘 (HDD)**      | 至少 40 GB 的可用空间                     | 确保有足够空间存储文档和日志         |
| **交换分区 (SWAP)** | 至少 4 GB                                 | 对系统稳定性很重要                   |
| **操作系统**        | CentOS 7 (64-bit)                         |                                      |
| **额外要求**        | PostgreSQL 12.9+, NGINX 1.3.13+, RabbitMQ | 使用Docker部署时，这些依赖会自动配置 |

> **提示**：以上要求是运行流畅的保证，请务必逐一核对。

---

### 🐳 方法一：使用 Docker 部署 (官方推荐)

这是最简单、最不易出错的方法。Docker 会自动处理所有复杂的依赖关系。

#### 1. 安装 Docker 与 Docker Compose

如果系统中尚未安装 Docker，请先执行以下步骤：

```bash
# 1. 卸载旧版本（如果存在）
sudo yum remove docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine

# 2. 安装必要的依赖包
sudo yum install -y yum-utils device-mapper-persistent-data lvm2

# 3. 添加 Docker 的官方 yum 源
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 4. 安装 Docker CE (社区版)
sudo yum install -y docker-ce docker-ce-cli containerd.io

# 5. 启动 Docker 服务并设置为开机自启
sudo systemctl start docker
sudo systemctl enable docker

# 6. 验证安装
docker --version

# 7. 安装 Docker Compose (可选，但强烈推荐)
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

#### 2. 通过 `docker run` 命令快速部署

执行以下命令，Docker 将自动下载并运行 OnlyOffice 9.3 镜像：

```bash
# 拉取并运行 OnlyOffice 9.3 容器
sudo docker run -i -t -d -p 80:80 --restart=always onlyoffice/documentserver:9.3
```

这条命令会：
- `-p 80:80`: 将宿主机的 80 端口映射到容器的 80 端口（OnlyOffice 默认的 Web 端口）。
- `--restart=always`: 保证容器在退出或宿主机重启后能自动启动。

部署成功后，在浏览器访问 `http://你的服务器IP`，出现 OnlyOffice 的欢迎页面就表示部署成功了。

#### 3. 通过 `docker-compose` 高级部署 (推荐生产环境)

这种方式便于管理和后续升级。首先，创建一个 `docker-compose.yml` 文件：

```yaml
version: '3'
services:
  onlyoffice-documentserver:
    image: onlyoffice/documentserver:9.3
    container_name: onlyoffice-server
    restart: always
    ports:
      - "80:80"    # 映射Web服务端口
      - "443:443"  # 如果后续配置HTTPS，可映射此端口
    environment:
      - JWT_ENABLED=true  # 启用JWT安全令牌
      - JWT_SECRET=your-very-long-and-secure-secret-key  # 务必修改为自己的密钥！
    volumes:
      - ./app-data:/var/www/onlyoffice/Data  # 持久化存储文档数据
      - ./logs:/var/log/onlyoffice           # 持久化存储日志
```

在 `docker-compose.yml` 文件所在目录，运行以下命令启动：

```bash
sudo docker-compose up -d
```

### 📦 方法二：使用 RPM 包手动安装

如果你的环境无法使用 Docker，可以采用 RPM 包方式安装。

> **重要提示**：截至 OnlyOffice 9.3，其官方文档对操作系统的最低要求是 CentOS Stream 9 或 RHEL 8/9。在 CentOS 7 上通过 RPM 包手动安装可能会遇到依赖问题，需要一定的调试能力。

#### 1. 添加仓库并安装基础依赖

首先，为 `nginx` 和 `epel` 添加仓库，并安装 `PostgreSQL`、`RabbitMQ` 等必要组件。

```bash
# 添加 EPEL 仓库
sudo yum install -y epel-release

# 添加 Nginx 官方仓库
sudo tee /etc/yum.repos.d/nginx.repo <<-'EOF'
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/$releasever/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true

[nginx-mainline]
name=nginx mainline repo
baseurl=http://nginx.org/packages/mainline/centos/$releasever/$basearch/
gpgcheck=1
enabled=0
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
EOF

# 安装 Nginx
sudo yum install -y nginx

# 安装 PostgreSQL 和 RabbitMQ
sudo yum install -y postgresql-server postgresql-contrib rabbitmq-server
```

#### 2. 初始化数据库与消息队列

```bash
# 初始化 PostgreSQL 数据库集群
sudo postgresql-setup initdb

# 启动并设置 PostgreSQL 和 RabbitMQ 开机自启
sudo systemctl start postgresql rabbitmq-server
sudo systemctl enable postgresql rabbitmq-server
```

#### 3. 下载并安装 OnlyOffice

```bash
# 下载 OnlyOffice 9.3 的 RPM 安装包
wget https://download.onlyoffice.com/install/documentserver/onlyoffice-documentserver-9.3-0.noarch.rpm

# 安装 RPM 包
sudo yum localinstall -y onlyoffice-documentserver-9.3-0.noarch.rpm
```

#### 4. 配置 OnlyOffice 并启动服务

```bash
# 启动 OnlyOffice 服务并设置开机自启
sudo systemctl start supervisord
sudo systemctl enable supervisord

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

同样，安装完成后，在浏览器访问 `http://你的服务器IP` 即可看到欢迎页面。

---

### 🚀 基础配置与后续步骤

1.  **访问与示例**：安装成功后，在浏览器中打开 `http://你的服务器IP`。在欢迎页，可以点击 "GO TO TEST EXAMPLE" 体验编辑功能。
2.  **API 集成**：要将编辑器集成到你的应用中，可以访问 `http://你的服务器IP/welcome` 获取 API 文档和集成示例。
3.  **调整端口**：如需修改默认的80端口，Docker部署请调整 `-p` 参数，RPM部署请修改 Nginx 配置文件 `/etc/nginx/conf.d/onlyoffice-documentserver.conf`。
4.  **配置 HTTPS**：生产环境建议配置 SSL 证书，可以使用 `certbot` 等工具。

### 💡 常见问题与排查

#### 端口被占用
如果 80 端口被其他服务（如 Apache）占用，请先停止该服务，或修改 OnlyOffice 的端口映射。

#### 防火墙设置
确保防火墙放行了 Web 服务端口（如 80 和 443）：
```bash
sudo firewall-cmd --zone=public --add-port=80/tcp --permanent
sudo firewall-cmd --zone=public --add-port=443/tcp --permanent
sudo firewall-cmd --reload
```

#### 依赖缺失（RPM包部署时）
在 CentOS 7 上通过 RPM 包部署时，如果遇到依赖缺失，可以尝试使用 `yum` 命令查找并安装缺失的包，例如：
```bash
yum search 缺失的包名
```

#### 服务未运行
检查相关服务的状态：
```bash
sudo systemctl status nginx postgresql rabbitmq-server supervisord
```

#### 离线部署
对于无法联网的环境，可以在一台联网的相同系统机器上，使用 `yum install --downloadonly` 命令下载所有依赖包，然后复制到目标服务器进行离线安装。

#### 版本兼容性
请确保 PostgreSQL、NGINX 和 RabbitMQ 的版本符合要求。这是运行 OnlyOffice 9.3 的基础。









从报错来看，这次是 `centos-sclo-rh` 这个仓库无法解析域名。这证实了问题根源：**CentOS 7 已停更，默认仓库域名已失效**，并且你的系统可能连网络或 DNS 都未正确配置。

我们可以通过**两步走**彻底解决这个问题：先修复网络基础，再统一替换所有失效的 YUM 仓库配置。

### 🛠️ 第一步：修复基础网络与 DNS（必须执行）

即使更换仓库源，若 DNS 不工作，`yum` 仍会报错。请确认以下操作：

1. **检查并修复 DNS 解析**
   编辑 `/etc/resolv.conf` 文件，确保有可用的 DNS 服务器：
   ```bash
   echo -e "nameserver 8.8.8.8\nnameserver 114.114.114.114" > /etc/resolv.conf
   ```

2. **验证域名解析是否生效**
   ```bash
   nslookup mirrors.aliyun.com
   ```
   若返回 IP 地址，则解析正常；若依然报错 `command not found`，请用 `ping mirrors.aliyun.com` 测试。

### 🚀 第二步：一键修复所有 CentOS 7 YUM 仓库配置

之前的操作只替换了基础仓库，而 `sclo` 等扩展仓库依然指向了失效的官方源。我们可以用以下脚本**批量处理所有仓库文件**，将它们全部指向阿里云镜像。

```bash
# 1. 备份整个 yum 仓库目录
cp -r /etc/yum.repos.d /etc/yum.repos.d.backup

# 2. 使用 sed 批量替换所有 .repo 文件中的失效 mirrorlist 或 baseurl
find /etc/yum.repos.d/ -name "*.repo" -exec sed -i 's|^mirrorlist=|#mirrorlist=|g' {} \;
find /etc/yum.repos.d/ -name "*.repo" -exec sed -i 's|^#baseurl=http://mirror.centos.org|baseurl=https://mirrors.aliyun.com|g' {} \;

# 3. 对于没有 baseurl 注释行的特殊仓库，强制添加阿里云 baseurl
#    主要针对 SCLo 仓库（这就是报错的仓库）
cat > /etc/yum.repos.d/CentOS-SCLo-scl.repo << 'EOF'
[centos-sclo-sclo]
name=CentOS-7 - SCLo sclo
baseurl=https://mirrors.aliyun.com/centos/7/sclo/$basearch/sclo/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-SIG-SCLo

[centos-sclo-rh]
name=CentOS-7 - SCLo rh
baseurl=https://mirrors.aliyun.com/centos/7/sclo/$basearch/rh/
gpgcheck=1
enabled=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-SIG-SCLo
EOF

# 4. 清理并重建缓存
yum clean all
yum makecache
```

**执行完毕后**，再次运行 `yum makecache` 应该不会再报域名解析错误。

### 🔧 备选方案：直接禁用出问题的仓库（快速但不推荐）

如果你**只需要安装 Docker**，而 Docker 并不依赖 `centos-sclo-rh` 仓库，可以临时禁用它：

```bash
yum-config-manager --disable centos-sclo-rh
yum makecache
```

但为了长远使用，还是建议执行上面的**一键修复**步骤。

### 🐳 继续部署 OnlyOffice 9.3

仓库问题解决后，你就可以顺利安装 Docker 了：

```bash
# 安装依赖（此时应该能正常执行）
sudo yum install -y yum-utils device-mapper-persistent-data lvm2

# 添加 Docker 官方仓库并安装
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker

# 部署 OnlyOffice 9.3
sudo docker run -i -t -d -p 80:80 --restart=always onlyoffice/documentserver:9.3
```

如果网络环境特殊，也可以考虑使用阿里云的 Docker 镜像加速器来拉取镜像。

### 💡 常见问题与排查

- **问题**：执行 `sed` 替换后依然报错 `Cannot find a valid baseurl`。
  - **排查**：手动检查 `/etc/yum.repos.d/` 下的文件，确认 `baseurl` 是否正确指向了 `https://mirrors.aliyun.com` 或 `http://vault.centos.org`。
  - **解决**：可以直接下载一份全新的阿里云 `Centos-7.repo` 并覆盖所有配置：
    ```bash
    curl -o /etc/yum.repos.d/CentOS-Base.repo https://mirrors.aliyun.com/repo/Centos-7.repo
    yum clean all && yum makecache
    ```

- **问题**：提示 `GPG key` 导入失败。
  
  - **解决**：手动导入：
    
    ```bash
    rpm --import /etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-7
    rpm --import /etc/pki/rpm-gpg/RPM-GPG-KEY-CentOS-SIG-SCLo
    ```

完成这些后，你的 CentOS 7 环境就恢复了软件包管理能力，可以顺利部署 OnlyOffice 了。如果还有其他仓库报错，请把具体的仓库名发给我，我来帮你写替换配置。



