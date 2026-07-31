// static/js/org_chart.js - 组织架构图（ECharts）
// 尝试加载 ECharts CDN，失败则使用 HTML 树渲染

(function() {
    'use strict';

    window.OrgChart = {
        _echartsLoaded: false,
        _fallback: true,

        init: function(containerId, data) {
            this._loadECharts(function() {
                if (window.echarts) {
                    this._fallback = false;
                    this._renderECharts(containerId, data);
                } else {
                    this._fallback = true;
                    this._renderHTML(containerId, data);
                }
            }.bind(this));
        },

        _loadECharts: function(callback) {
            if (window.echarts) {
                callback();
                return;
            }
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
            script.onload = callback;
            script.onerror = callback;
            document.head.appendChild(script);
            setTimeout(callback, 5000); // 5秒超时回退
        },

        _renderECharts: function(containerId, data) {
            var dom = document.getElementById(containerId);
            if (!dom || !data || !data.length) return;

            dom.innerHTML = '';
            dom.style.height = Math.max(400, data.length * 80) + 'px';

            var chart = echarts.init(dom);
            var option = {
                tooltip: {
                    trigger: 'item',
                    formatter: function(params) {
                        return '<b>' + params.name + '</b>'
                            + (params.data.manager ? '<br/>负责人: ' + params.data.manager : '')
                            + '<br/>人数: ' + (params.data.member_count || 0);
                    }
                },
                series: [{
                    type: 'tree',
                    data: data,
                    top: 20,
                    bottom: 20,
                    left: 30,
                    right: 80,
                    symbol: 'roundRect',
                    symbolSize: [120, 36],
                    orient: 'LR',
                    expandAndCollapse: true,
                    initialTreeDepth: 3,
                    label: {
                        position: 'right',
                        verticalAlign: 'middle',
                        fontSize: 13,
                        fontWeight: 500,
                        formatter: function(params) {
                            return params.name;
                        }
                    },
                    leaves: {
                        label: { position: 'right', verticalAlign: 'middle' }
                    },
                    lineStyle: { color: '#409eff', width: 1.5 },
                    itemStyle: {
                        color: function(params) {
                            var depth = params.data.depth || 0;
                            var colors = ['#409eff', '#67c23a', '#e6a23c', '#9b59b6', '#f56c6c'];
                            return colors[depth % colors.length];
                        },
                        borderColor: '#fff',
                        borderWidth: 1,
                    }
                }]
            };
            chart.setOption(option);
            window.addEventListener('resize', function() { chart.resize(); });

            chart.on('click', function(params) {
                if (params.data.id && window.orgApp) {
                    window.orgApp.selectDepartment(params.data.id);
                }
            });
        },

        _renderHTML: function(containerId, data) {
            var dom = document.getElementById(containerId);
            if (!dom) return;
            dom.innerHTML = this._buildTree(data);
        },

        _buildTree: function(nodes, depth) {
            if (!nodes || !nodes.length) return '';
            depth = depth || 0;
            var self = this;
            var html = '<ul style="list-style:none;padding-left:' + (depth > 0 ? '30px' : '0') + ';margin:0;">';
            nodes.forEach(function(n) {
                var hasCh = n.children && n.children.length;
                html += '<li style="margin:6px 0;position:relative;">'
                    + '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg-secondary,#f5f7fa);border-radius:10px;border-left:4px solid ' + self._getColor(depth) + ';cursor:pointer;"'
                    + ' onclick="' + (n.id ? 'orgApp.selectDepartment(' + n.id + ')' : '') + '">'
                    + '<i class="fas fa-building" style="color:' + self._getColor(depth) + ';font-size:16px;"></i>'
                    + '<span style="font-weight:600;font-size:14px;">' + self._escape(n.name) + '</span>'
                    + (n.manager ? '<span style="font-size:12px;color:var(--text-light,#909399);">负责人: ' + self._escape(n.manager) + '</span>' : '')
                    + '<span style="margin-left:auto;font-size:12px;color:var(--text-light,#909399);background:#fff;padding:2px 10px;border-radius:10px;">' + (n.member_count || 0) + '人</span>'
                    + '</div>'
                    + (hasCh ? self._buildTree(n.children, depth + 1) : '')
                    + '</li>';
            });
            html += '</ul>';
            return html;
        },

        _getColor: function(depth) {
            var colors = ['#409eff', '#67c23a', '#e6a23c', '#9b59b6', '#f56c6c'];
            return colors[depth % colors.length];
        },

        _escape: function(text) {
            if (!text) return '';
            return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
    };
})();
