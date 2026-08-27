/**
 * @File   : admin_statistics.js
 * @Time   : 2026/3/11
 * @Author : dayue
 * @Desc   : 管理控制台 - 数据统计模块
 */


// 🔧 关键修复：在类定义前检查 Chart.js 是否可用
if (typeof Chart === 'undefined') {
    console.error('Chart.js 未加载！图表功能将不可用。');
    // 可以选择加载备用 CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    script.onload = () => {
        console.log('Chart.js 备用 CDN 加载成功');
        // 重新初始化统计模块
        if (window.adminStatistics) {
            window.adminStatistics.init();
        }
    };
    script.onerror = () => {
        console.error('Chart.js 备用 CDN 加载失败');
    };
    document.head.appendChild(script);
}


// 全局变量挂载
let adminStatistics = null;

class AdminStatisticsClient {
    constructor() {

        this.isInitialized = false;  // 🔧 添加初始化标志
        this.timeRange = 7; // 默认 7 天
        this.charts = {}; // 存储图表实例
        this.currentUser = null;
        this.isLoading = false;
        this.chartJSLoaded = typeof Chart !== 'undefined'; // 🔧 检查 Chart.js 是否可用
        this.refreshDebounceTimer = null; // 🔧 防抖定时器

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            console.log('AdminStatisticsClient DOMContentLoaded 事件已触发');
            // this.init();
        }
    }

    // ==================== 初始化逻辑 ====================
    async init() {
        // 🔧 防止重复初始化
        if (this.isInitialized) {
            console.log('AdminStatisticsClient 已初始化，跳过');
            return;
        }

        console.log('AdminStatisticsClient 初始化开始...');

        try {
            // 检查登录状态和权限
            const token = localStorage.getItem('access_token');
            if (!token) {
                // 保存当前页面链接，登录后跳转到该页面
                localStorage.setItem('redirect_url', window.location.href);
                window.location.href = '/login/';
                return;
            }

            // 获取当前用户信息
            this.currentUser = await API.getCurrentUser();
            if (!['super_admin', 'admin'].includes(this.currentUser?.user_type)) {
                this.showError('权限不足', '仅超级管理员可访问数据统计');
                setTimeout(() => {
                    window.location.href = '/chat/';
                }, 2000);
                return;
            }

            // 加载所有统计数据
            await this.loadOverviewStats();
            await this.loadUserTrends();
            await this.loadMessageTrends();
            await this.loadMessageTypeDistribution();
            await this.loadPeakHours();
            await this.loadDepartmentStats();
            await this.loadActiveUsersRanking();
            await this.loadChatRoomRanking();

            // 绑定事件监听
            this.setupEventListeners();
            // 设置自动刷新（每 5 分钟）
            this.startAutoRefresh();


            this.isInitialized = true;  // 🔧 添加初始化标志

            console.log('AdminStatisticsClient 初始化完成');

        } catch (error) {
            console.error('初始化失败:', error);
            this.showError('加载失败', error.message || '未知错误');
        }
    }


    // 🔧 新增：等待容器准备就绪（确保有固定高度）
    async waitForContainersReady() {
        return new Promise((resolve) => {
            const checkContainers = () => {
                const canvasIds = ['userTrendsChart', 'messageTrendsChart', 'typeChart', 'peakHoursChart', 'departmentChart'];
                const allReady = canvasIds.every(id => {
                    const canvas = document.getElementById(id);
                    const container = canvas?.parentElement;
                    return container && (container.offsetHeight > 0 || container.style.height);
                });

                if (allReady) {
                    resolve();
                } else {
                    setTimeout(checkContainers, 50);
                }
            };
            checkContainers();
        });
    }

    // ==================== 事件监听 ====================
    setupEventListeners() {
        // 时间范围切换
        const timeRangeSelect = document.getElementById('timeRangeSelect');
        if (timeRangeSelect) {
            timeRangeSelect.addEventListener('change', (e) => {
                this.timeRange = parseInt(e.target.value);
                // 🔧 关键修复：使用防抖避免频繁重绘
                this.debouncedRefreshAll();
            });
        }

        // 刷新按钮
        const refreshBtn = document.querySelector('#statsTab .btn-secondary');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshAll();
            });
        }

        // 导出报表按钮
        const exportBtn = document.querySelector('#statsTab .btn-download');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportReport();
            });
        }

        // 🔧 新增：窗口大小变化时重绘图表
        // window.addEventListener('resize', () => {
        //     this.debouncedRefreshAll();
        // });
    }


    // 🔧 新增：防抖刷新方法
    debouncedRefreshAll() {
        if (this.refreshDebounceTimer) {
            clearTimeout(this.refreshDebounceTimer);
        }
        this.refreshDebounceTimer = setTimeout(() => {
            this.refreshAll();
            this.refreshDebounceTimer = null;
        }, 300);
    }


    // ==================== 数据加载方法 ====================

    // 加载概览统计
    async loadOverviewStats() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const response = await fetch('/api/chat/admin/statistics/overview/', {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载概览统计失败');

            const stats = await response.json();
            this.renderOverviewCards(stats);

        } catch (error) {
            console.error('加载概览统计失败:', error);
            this.showWarning('部分统计信息加载失败');
        } finally {
            this.isLoading = false;
        }
    }

    // 加载用户趋势
    async loadUserTrends() {
        try {
            const response = await fetch(`/api/chat/admin/statistics/user_trends/?days=${this.timeRange}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载用户趋势失败');

            const data = await response.json();

            // 🔧 关键修复1: 动态设置图表标题
            const chartTitle = document.querySelector('#userTrendsChart')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-chart-line"></i> 用户趋势（近 ${this.timeRange} 天）`;
            }

            this.renderLineChart(data, 'userTrendsChart', {
                labels: data.trends.map(t => t.date.slice(5)),
                datasets: [
                    {
                        label: '新增用户',
                        data: data.trends.map(t => t.new_users),
                        borderColor: '#409EFF',
                        backgroundColor: 'rgba(64, 158, 255, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '活跃用户',
                        data: data.trends.map(t => t.active_users),
                        borderColor: '#67C23A',
                        backgroundColor: 'rgba(103, 194, 58, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '在线用户',
                        data: data.trends.map(t => t.online_users),
                        borderColor: '#E6A23C',
                        backgroundColor: 'rgba(230, 162, 60, 0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            });

        } catch (error) {
            console.error('加载用户趋势失败:', error);
        }
    }

    // 加载消息趋势
    async loadMessageTrends() {
        try {
            const response = await fetch(`/api/chat/admin/statistics/message_trends/?days=${this.timeRange}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载消息趋势失败');

            const data = await response.json();

            // 🔧 关键修复：动态设置图表标题
            const chartTitle = document.querySelector('#messageTrendsChart')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-chart-area"></i> 消息趋势（近 ${this.timeRange} 天）`;
            }

            this.renderLineChart(data, 'messageTrendsChart', {
                labels: data.trends.map(t => t.date.slice(5)),
                datasets: [
                    {
                        label: '总消息数',
                        data: data.trends.map(t => t.total),
                        borderColor: '#409EFF',
                        backgroundColor: 'rgba(64, 158, 255, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '文本消息',
                        data: data.trends.map(t => t.text),
                        borderColor: '#67C23A',
                        backgroundColor: 'rgba(103, 194, 58, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '文件消息',
                        data: data.trends.map(t => t.files),
                        borderColor: '#F56C6C',
                        backgroundColor: 'rgba(245, 108, 108, 0.1)',
                        tension: 0.4,
                        fill: true
                    }
                ]
            });

        } catch (error) {
            console.error('加载消息趋势失败:', error);
        }
    }

    // 加载消息类型分布
    async loadMessageTypeDistribution() {
        try {
            const response = await fetch(`/api/chat/admin/statistics/message_type_distribution/?days=${this.timeRange}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载消息类型分布失败');

            const data = await response.json();

            const chartTitle = document.querySelector('#typeChart')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-chart-pie"></i> 消息类型分布（近 ${this.timeRange} 天）`;
            }

            this.renderPieChart(data, 'typeChart', {
                labels: data.distribution.map(d => this.getMessageTypeLabel(d.type)),
                data: data.distribution.map(d => d.count),
                colors: data.distribution.map(d => this.getMessageTypeColor(d.type))
            });

        } catch (error) {
            console.error('加载消息类型分布失败:', error);
        }
    }

    // 加载活跃时段分析
    async loadPeakHours() {
        try {
            const response = await fetch(`/api/chat/admin/statistics/peak_hours/?days=${this.timeRange}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载活跃时段失败');

            const data = await response.json();

            const chartTitle = document.querySelector('#peakHoursChart')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-clock"></i> 活跃时段分析（近 ${this.timeRange} 天）`;
            }

            this.renderBarChart(data, 'peakHoursChart', {
                labels: data.hourly_distribution.map(h => `${h.hour}:00`),
                data: data.hourly_distribution.map(h => h.count),
                peakHour: data.peak_hour
            });

        } catch (error) {
            console.error('加载活跃时段失败:', error);
        }
    }


    // 加载活跃用户排行榜
    async loadActiveUsersRanking() {
        try {
            const response = await fetch(`/api/chat/admin/statistics/active_users_ranking/?limit=10&days=${this.timeRange}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载排行榜失败');

            const data = await response.json();

            const chartTitle = document.querySelector('#userRankingList')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-trophy"></i> 活跃用户 TOP 10（近 ${this.timeRange} 天）`;
            }

            this.renderRankingList(data, 'userRankingList', 'user');

        } catch (error) {
            console.error('加载用户排行榜失败:', error);
        }
    }

    // 加载热门聊天室排行榜
    async loadChatRoomRanking() {
        try {
            const response = await fetch(`/api/chat/admin/statistics/chat_room_ranking/?limit=10&days=${this.timeRange}`, {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载聊天室排行榜失败');

            const data = await response.json();

            const chartTitle = document.querySelector('#roomRankingList')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-share-alt"></i> 热门聊天室 TOP 5（近 ${this.timeRange} 天）`;
            }

            this.renderRankingList(data, 'roomRankingList', 'room');

        } catch (error) {
            console.error('加载聊天室排行榜失败:', error);
        }
    }


    // 加载部门统计
    async loadDepartmentStats() {
        try {
            const response = await fetch('/api/chat/admin/statistics/department_stats/', {
                headers: TokenManager.getHeaders()
            });

            if (!response.ok) throw new Error('加载部门统计失败');

            const data = await response.json();

            const chartTitle = document.querySelector('#departmentChart')?.closest('.chart-box')?.querySelector('h4');
            if (chartTitle) {
                chartTitle.innerHTML = `<i class="fas fa-building"></i> 部门用户分布（近 ${this.timeRange} 天）`;
            }

            this.renderHorizontalBarChart(data, 'departmentChart', {
                labels: data.departments.map(d => d.tenant_name ? `[${d.tenant_name}] ${d.name}` : d.name),
                datasets: [
                    {
                        label: '总用户数',
                        data: data.departments.map(d => d.user_count),
                        backgroundColor: '#409EFF'
                    },
                    {
                        label: '活跃用户',
                        data: data.departments.map(d => d.active_users),
                        backgroundColor: '#67C23A'
                    },
                    {
                        label: '消息数',
                        data: data.departments.map(d => d.message_count),
                        backgroundColor: '#E6A23C'
                    }
                ]
            });

        } catch (error) {
            console.error('加载部门统计失败:', error);
        }
    }


    // ==================== 渲染方法 ====================

    // 渲染概览统计卡片
    renderOverviewCards(stats) {
        // 更新数字卡片
        const els = {
            totalUsers: 'totalUsers',
            activeUsers: 'activeUsers',
            onlineUsers: 'onlineUsers',
            todayMessages: 'todayMessages',
            totalRooms: 'totalRooms',
            storageUsed: 'storageUsed',
            userGrowth: 'userGrowth',
            messageGrowth: 'messageGrowth'
        };

        // 更新数值
        document.getElementById(els.totalUsers).textContent = this.formatNumber(stats.users?.total || 0);
        document.getElementById(els.activeUsers).textContent = this.formatNumber(stats.users?.active_today || 0);
        document.getElementById(els.onlineUsers).textContent = this.formatNumber(stats.users?.online || 0);
        document.getElementById(els.todayMessages).textContent = this.formatNumber(stats.messages?.today || 0);
        document.getElementById(els.totalRooms).textContent = this.formatNumber(stats.chat_rooms?.total || 0);
        document.getElementById(els.storageUsed).textContent = this.formatFileSize(stats.files?.storage_used || 0);

        // 更新增长率
        this.updateGrowthIcon(els.userGrowth, stats.users?.growth_rate || 0);
        this.updateGrowthIcon(els.messageGrowth, stats.messages?.growth_rate || 0);
    }

    // 更新增长率图标
    updateGrowthIcon(elementId, rate) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const iconClass = rate >= 0 ? 'fa-arrow-up' : 'fa-arrow-down';
        const trendColor = rate >= 0 ? 'positive' : 'negative';

        element.innerHTML = `<i class="fas ${iconClass}"></i> ${Math.abs(rate)}%`;
        element.className = `stat-trend ${trendColor}`;
    }

    // 🔧 关键修复：渲染折线图（修复高度问题和标题动态渲染）
    renderLineChart(data, canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // 🔧 关键修复1: 确保容器有固定高度
        const container = canvas.parentElement;
        if (container && !container.style.height && !container.offsetHeight) {
            container.style.height = '250px'; // 设置默认高度
        }

        // 🔧 关键修复2: 彻底销毁旧图表
        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
            delete this.charts[canvasId];
            // 清除 Canvas 内容防止叠加
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        // 🔧 关键修复3: 动态更新图表标题
        const chartTitle = canvas.closest('.chart-box')?.querySelector('h4');
        if (chartTitle) {
            const isUserTrend = canvasId === 'userTrendsChart';
            const titleText = isUserTrend
                ? `用户趋势（近 ${this.timeRange} 天）`
                : `消息趋势（近 ${this.timeRange} 天）`;
            const iconClass = isUserTrend ? 'fa-chart-line' : 'fa-chart-area';
            chartTitle.innerHTML = `<i class="fas ${iconClass}"></i> ${titleText}`;
        }

        // 🔧 关键修复4: 创建新图表
        this.charts[canvasId] = new Chart(canvas, {
            type: 'line',
            data: {
                labels: config.labels,
                datasets: config.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, // 依赖容器高度
                animation: {
                    duration: 300 // 减少动画时间避免闪烁
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {usePointStyle: true, padding: 20}
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {color: '#f0f0f0'},
                        ticks: {stepSize: 1}
                    },
                    x: {
                        grid: {display: false}
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }

    // 渲染饼图/环形图
    renderPieChart(data, canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // 🔧 确保容器有固定高度
        const container = canvas.parentElement;
        if (container && !container.style.height && !container.offsetHeight) {
            container.style.height = '250px';
        }

        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
            delete this.charts[canvasId];
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        this.charts[canvasId] = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: config.labels,
                datasets: [{
                    data: config.data,
                    backgroundColor: config.colors,
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {duration: 300},
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {usePointStyle: true, boxWidth: 10}
                    }
                },
                cutout: '60%'
            }
        });
    }

    // 渲染柱状图
    renderBarChart(data, canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const container = canvas.parentElement;
        if (container && !container.style.height && !container.offsetHeight) {
            container.style.height = '250px';
        }

        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
            delete this.charts[canvasId];
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        const backgroundColors = config.labels.map((label, index) => {
            const hour = parseInt(label.split(':')[0]);
            return hour === config.peakHour ? '#F56C6C' : '#409EFF';
        });

        this.charts[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: config.labels,
                datasets: [{
                    label: '消息数',
                    data: config.data,
                    backgroundColor: backgroundColors
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: {duration: 300},
                plugins: {
                    legend: {display: false},
                    tooltip: {
                        callbacks: {
                            title: (context) => `${context[0].label} - ${context[0].raw} 条消息`
                        }
                    }
                },
                scales: {
                    x: {grid: {color: '#f0f0f0'}},
                    y: {grid: {display: false}}
                }
            }
        });
    }

    // 渲染水平柱状图（部门统计）
    renderHorizontalBarChart(data, canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const container = canvas.parentElement;
        if (container && !container.style.height && !container.offsetHeight) {
            container.style.height = '250px';
        }

        if (this.charts[canvasId]) {
            this.charts[canvasId].destroy();
            delete this.charts[canvasId];
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        this.charts[canvasId] = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: config.labels.length > 8 ? config.labels.slice(-8) : config.labels,
                datasets: config.datasets
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                animation: {duration: 300},
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {usePointStyle: true}
                    }
                },
                scales: {
                    x: {beginAtZero: true, grid: {color: '#f0f0f0'}},
                    y: {grid: {display: false}}
                }
            }
        });
    }

    // 渲染排行榜列表
    renderRankingList(data, containerId, type) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const list = data.ranking || [];
        let html = '';

        list.forEach((item, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const avatar = type === 'user'
                ? (item.avatar_url || '/static/images/default-avatar.png')
                : '/static/images/group-avatar.png';
            const name = type === 'user'
                ? (item.real_name || item.username)
                : (item.name || item.display_name);
            const desc = type === 'user'
                ? (item.tenant_name ? `[${item.tenant_name}] ${item.department || '无部门'}` : (item.department || '无部门'))
                : `${item.room_type === 'private' ? '私聊' : '群聊'} · ${item.member_count}人`;

            html += `
                <div class="ranking-item">
                    <span class="rank-num">${medal}</span>
                    <img src="${avatar}" alt="${name}" class="ranking-avatar">
                    <div class="ranking-info">
                        <div class="ranking-name">${name}</div>
                        <small class="ranking-dept">${desc}</small>
                    </div>
                    <div class="ranking-score">
                        <strong>${item.message_count}</strong>
                        <small>消息</small>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html || '<p style="color: #999; text-align: center;">暂无数据</p>';
    }

    // ==================== 工具方法 ====================

    // 格式化数字（万/亿）
    formatNumber(num) {
        if (num == null) return '0';
        num = parseInt(num);
        if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
        if (num >= 10000) return (num / 10000).toFixed(1) + '万';
        return num.toLocaleString();
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes == null || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = parseFloat(bytes);
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < 4) {
            size /= 1024;
            unitIndex++;
        }
        return size.toFixed(2) + ' ' + units[unitIndex];
    }

    // 获取消息类型中文标签
    getMessageTypeLabel(type) {
        const map = {
            'text': '文本',
            'image': '图片',
            'file': '文件',
            'video': '视频',
            'voice': '语音',
            'audio': '音频',
            'emoji': '表情',
            'location': '位置',
            'call_audio': '语音通话',
            'call_video': '视频通话',
            'task_card': '任务卡片',
            'approval_card': '审批卡片',
            'work_summary_card': '工作总结'
        };
        return map[type] || type;
    }

    // 获取消息类型颜色
    getMessageTypeColor(type) {
        const map = {
            'text': '#409EFF',
            'image': '#67C23A',
            'file': '#E6A23C',
            'video': '#F56C6C',
            'voice': '#909399',
            'audio': '#909399',
            'emoji': '#c82577',
            'location': '#a53ac2',
            // 'call_audio': '#426aef',
            'call_audio': '#cc1799',
            // 'call_video': '#ef404f',
            'call_video': '#5b5ef7',
            'task_card': '#7bb6f3',
            'approval_card': '#409EFF',
            'work_summary_card': '#9b59b6'
        }
        return map[type] || '#909399';
    }

    // 刷新所有数据
    async refreshAll() {
        if (this.isLoading) return;

        this.showLoading();
        try {
            await Promise.all([
                this.loadOverviewStats(),
                this.loadUserTrends(),
                this.loadMessageTrends(),
                this.loadMessageTypeDistribution(),
                this.loadPeakHours(),
                this.loadDepartmentStats(),
                this.loadActiveUsersRanking(),
                this.loadChatRoomRanking()
            ]);
            this.showSuccess('数据已刷新', '数据统计');
        } catch (error) {
            console.error('刷新数据失败:', error);
            this.showError('刷新失败', error.message);
        } finally {
            this.hideLoading();
        }
    }

    // 导出统计报表
    async exportReport() {
        const reportType = prompt('请输入报表类型 (overview/users/messages):', 'overview');
        if (!reportType) return;

        try {
            const url = `/api/chat/admin/statistics/export_report/?type=${reportType}`;
            window.open(url, '_blank');
            this.showSuccess('导出成功', '报表已生成');
        } catch (error) {
            console.error('导出失败:', error);
            this.showError('导出失败', error.message);
        }
    }

    // 启动自动刷新
    startAutoRefresh() {
        // 每 5 分钟刷新一次
        setInterval(async () => {
            if (!document.hidden) { // 仅在页面可见时刷新
                await this.loadOverviewStats();
            }
        }, 5 * 60 * 1000);
    }

    // ==================== 提示方法 ====================

    showLoading() {
        if (document.querySelector('.loading-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.innerHTML = '<div class="loading-spinner"></div>';
        document.body.appendChild(overlay);
    }

    hideLoading() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.parentNode.removeChild(overlay);
        }
    }

    showError(title, message) {
        const toast = document.createElement('div');
        toast.className = 'toast toast-error';
        toast.innerHTML = `<strong>${title}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    showSuccess(title, message) {
        const toast = document.createElement('div');
        toast.className = 'toast toast-success';
        toast.innerHTML = `<strong>${title}</strong><br>${message}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    showWarning(message) {
        const toast = document.createElement('div');
        toast.className = 'toast toast-warning';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

// ==================== 全局初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    adminStatistics = new AdminStatisticsClient();
    window.adminStatistics = adminStatistics;
    console.log('AdminStatisticsClient 全局实例化完成');
});