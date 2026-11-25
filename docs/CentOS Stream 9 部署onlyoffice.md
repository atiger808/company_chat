在 CentOS 生态中，传统的 CentOS Linux 在版本 8 之后已转向 **CentOS Stream 9**（或其下游 1:1 兼容的发行版，如 **Rocky Linux 9** 或 **AlmaLinux 9**）。以下部署指南完全适用于 CentOS Stream 9 及所有 RHEL 9 兼容系统。

官方最推荐、最稳定的部署方式是使用 **Docker**。以下是完整的分步部署指南：

---

### 一、 系统要求
- **CPU**：双核 2 GHz 或更高
- **内存**：4 GB 或更多（推荐 8 GB 以获得流畅的协作体验）
- **硬盘**：至少 40 GB 可用空间
- **Swap**：至少 4 GB（防止文档转换时内存溢出）

---

### 二、 安装 Docker 及 Docker Compose
在 CentOS Stream 9 上，建议使用 Docker 官方仓库安装最新版本：

```bash
# 1. 更新系统软件包
sudo dnf update -y

# 2. 安装必要的依赖工具
sudo dnf install -y yum-utils device-mapper-persistent-data lvm2

# 3. 添加 Docker 官方仓库
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 4. 安装 Docker Engine 和 Compose 插件
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. 启动 Docker 并设置开机自启
sudo systemctl enable --now docker

# 6. 验证安装是否成功
docker --version
docker compose version
```

*(可选) 如果服务器在国内，建议配置 Docker 镜像加速器。编辑 `/etc/docker/daemon.json`，添加国内镜像源后执行 `sudo systemctl restart docker`。*

---

### 三、 部署 ONLYOFFICE Document Server
为了保证数据在容器升级时不丢失，我们需要将日志、证书和缓存目录挂载到宿主机。同时，**CentOS/RHEL 9 默认启用 SELinux**，因此在挂载卷时必须加上 `:z` 选项，以自动为容器分配正确的 SELinux 安全上下文。

```bash
# 1. 创建持久化存储目录
sudo mkdir -p /app/onlyoffice/DocumentServer/{logs,data,lib}

# 2. 运行 ONLYOFFICE 容器
sudo docker run -i -t -d -p 80:80 --restart=always \
    -v /app/onlyoffice/DocumentServer/logs:/var/log/onlyoffice:z \
    -v /app/onlyoffice/DocumentServer/data:/var/www/onlyoffice/Data:z \
    -v /app/onlyoffice/DocumentServer/lib:/var/lib/onlyoffice:z \
    -e JWT_SECRET=your_custom_secure_secret_key_here \
    onlyoffice/documentserver
```
> **⚠️ 重要安全提示**：从 7.2 版本起，ONLYOFFICE 默认启用 JWT 令牌验证。请务必将 `your_custom_secure_secret_key_here` 替换为你自己生成的强随机字符串（例如使用 `openssl rand -hex 32` 生成）。如果你后续要将其与 Nextcloud/ownCloud 等系统集成，这个密钥必须保持一致。

---

### 四、 配置防火墙
CentOS Stream 9 默认使用 `firewalld`，需要开放 HTTP 和 HTTPS 端口：

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

### 五、 验证安装
在浏览器中访问 `http://<你的服务器IP>` 或 `http://<你的域名>`。  
如果看到 **"ONLYOFFICE Docs is running"** 的欢迎页面，说明部署已成功。首次启动可能需要 1~2 分钟初始化数据库，请耐心等待。

---

### 六、 进阶：配置 HTTPS（强烈推荐）
许多第三方系统（如 Nextcloud）强制要求 ONLYOFFICE 使用 HTTPS。你有两种选择：

#### 方案 A：使用 Let's Encrypt 自动配置（最简单）
如果你已经将域名解析到该服务器，可以直接让 ONLYOFFICE 容器自动申请并配置 SSL 证书：
```bash
# 先停止并删除之前的容器
sudo docker stop $(sudo docker ps -q -f ancestor=onlyoffice/documentserver)
sudo docker rm $(sudo docker ps -aq -f ancestor=onlyoffice/documentserver)

# 使用带 Let's Encrypt 环境变量的命令重新启动
sudo docker run -i -t -d -p 80:80 -p 443:443 --restart=always \
    -v /app/onlyoffice/DocumentServer/data:/var/www/onlyoffice/Data:z \
    -e LETS_ENCRYPT_DOMAIN=yourdomain.com \
    -e LETS_ENCRYPT_MAIL=your_email@example.com \
    -e JWT_SECRET=your_custom_secure_secret_key_here \
    onlyoffice/documentserver
```

#### 方案 B：使用 Nginx 反向代理（更灵活）
如果你的服务器上已经运行了 Nginx 或其他 Web 服务，可以将 ONLYOFFICE 的端口改为 `8080`（`-p 8080:80`），然后配置 Nginx 反向代理并挂载你自己的 SSL 证书。

---

### 七、 常见问题排查

1. **容器不断重启 (Restarting)**  
   运行 `sudo docker logs <容器ID>` 查看日志。最常见的原因是 **内存不足**。请确保系统有至少 4GB 物理内存，并配置了 Swap：
   ```bash
   # 检查 Swap
   free -h
   # 若无 Swap，可临时创建 4GB Swap 文件
   sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

2. **SELinux 权限拒绝 (Permission Denied)**  
   如果日志中出现权限错误，请确认你在 `docker run` 的 `-v` 参数末尾正确添加了 `:z`（如 `/var/log/onlyoffice:z`）。

3. **与 Nextcloud 集成时报错 "Error when trying to connect"**  
   - 检查 Nextcloud 中填写的 ONLYOFFICE 地址是否为 `https://`。
   - 检查 Nextcloud 的 `config.php` 中是否添加了 `'allow_local_remote_servers' => true,`。
   - 确认两边配置的 `JWT_SECRET` 完全一致。

如需后续升级 ONLYOFFICE，只需执行：
```bash
sudo docker pull onlyoffice/documentserver
sudo docker stop <容器ID>
sudo docker rm <容器ID>
# 然后重新运行上面的 docker run 命令即可，数据因已挂载而不会丢失。
```