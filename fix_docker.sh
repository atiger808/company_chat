#!/bin/bash
# fix-docker-centos7.sh - CentOS 7 Docker 1.13.1 修复脚本

set -e
echo "🔧 开始修复 CentOS 7 Docker 启动问题..."

# 1. 加载必要内核模块
echo "📦 加载内核模块..."
for mod in iptable_nat nf_nat nf_nat_ipv4 nf_conntrack br_netfilter; do
    if ! lsmod | grep -q "^$mod"; then
        echo "  - 加载 $mod"
        sudo modprobe $mod
    fi
done

# 2. 永久加载模块
echo "⚙️  配置模块永久加载..."
sudo mkdir -p /etc/modules-load.d
echo -e "iptable_nat\nnf_nat\nnf_nat_ipv4\nnf_conntrack\nbr_netfilter" | sudo tee /etc/modules-load.d/docker.conf > /dev/null

# 3. 修复 firewalld
echo "🔥 配置 firewalld..."
sudo firewall-cmd --permanent --zone=trusted --add-interface=docker0 2>/dev/null || true
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="172.17.0.0/16" accept' 2>/dev/null || true
sudo firewall-cmd --reload

# 4. 创建/修复 docker0 网桥
if ! ip link show docker0 &>/dev/null; then
    echo "🌉 创建 docker0 网桥..."
    sudo ip link add docker0 type bridge
    sudo ip addr add 172.17.0.1/16 dev docker0
    sudo ip link set docker0 up
    sudo firewall-cmd --permanent --zone=trusted --add-interface=docker0
    sudo firewall-cmd --reload
fi

# 5. 重置 iptables 规则
echo "🔄 重置 iptables 规则..."
sudo iptables-save > /root/iptables.backup.$(date +%Y%m%d%H%M%S)
sudo iptables -F 2>/dev/null || true
sudo iptables -t nat -F 2>/dev/null || true
sudo systemctl restart firewalld

# 6. 配置 Docker daemon
echo "⚙️  配置 Docker daemon..."
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json << 'EOF' > /dev/null
{
  "iptables": true,
  "ip-forward": true,
  "ip-masq": true,
  "bip": "172.17.0.1/24",
  "fixed-cidr": "172.17.0.0/24"
}
EOF

# 7. 启动 Docker
echo "🐳 启动 Docker..."
sudo systemctl daemon-reload
sudo systemctl start docker

# 8. 验证
if sudo systemctl is-active --quiet docker; then
    echo "✅ Docker 启动成功！"
    sudo docker --version
    sudo docker ps
else
    echo "❌ Docker 启动失败，查看详细日志："
    sudo journalctl -u docker.service -n 20 --no-pager
    exit 1
fi