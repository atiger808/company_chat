// static/js/app-common.js - 各业务页面共用的通用方法（仅收纳完全一致/安全超集的实现）
(function () {
    var AppCommon = {
        // HTML 转义（比 Utils.escapeHtml 多转义单引号，避免属性拼接被截断）
        escapeHtml: function (text) {
            if (!text) return '';
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },

        // 登录失效：清理本地登录态并跳转登录页（各页 chat_login_url 保持一致）
        handleAuthError: function () {
            localStorage.removeItem('access_token');
            localStorage.removeItem('user_id');
            localStorage.removeItem('user_type');
            localStorage.removeItem('current_user');
            localStorage.setItem('redirect_url', window.location.href);
            window.location.href = this.chat_login_url;
        },

        // 模态框最大化（与 Utils.toggleMaximize 完全一致）
        toggleMaximize: function (btn) {
            if (window.Utils && typeof Utils.toggleMaximize === 'function') {
                return Utils.toggleMaximize(btn);
            }
            var mc = btn.closest('.modal-content');
            if (!mc) return;
            var isMax = mc.classList.toggle('maximized');
            var icon = btn.querySelector('i');
            if (icon) icon.className = isMax ? 'fas fa-compress' : 'fas fa-expand';
            btn.title = isMax ? '恢复' : '最大化';
        },

        // ==================== 优雅的提示 / 确认 / Toast（approval、attendance 共用） ====================
        showAlert: function (title, message) {
            var self = this;
            return new Promise(function (resolve) {
                var dialog = document.createElement('div');
                dialog.className = 'confirm-dialog';
                dialog.innerHTML = '<div class="confirm-dialog-content">'
                    + '<div class="confirm-dialog-header">'
                    + '<i class="fas fa-info-circle"></i>'
                    + '<span>' + self.escapeHtml(title) + '</span>'
                    + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                    + '<div class="confirm-dialog-body">' + message + '</div>'
                    + '<div class="confirm-dialog-footer">'
                    + '<button class="confirm-dialog-btn confirm">确定</button></div></div>';
                document.body.appendChild(dialog);
                var close = function () {
                    dialog.classList.remove('show');
                    setTimeout(function () {
                        if (dialog.parentNode) document.body.removeChild(dialog);
                    }, 250);
                    resolve();
                };
                dialog.querySelector('.confirm').addEventListener('click', close);
                dialog.querySelector('.close-btn').addEventListener('click', close);
                dialog.addEventListener('click', function (e) {
                    if (e.target === dialog) close();
                });
                setTimeout(function () { dialog.classList.add('show'); }, 10);
            });
        },

        showConfirmDialog: function (title, message, type) {
            if (type === undefined) type = 'confirm';
            var self = this;
            return new Promise(function (resolve) {
                var iconMap = {danger: 'exclamation-triangle', confirm: 'check-circle'};
                var icon = iconMap[type] || 'question-circle';
                var dialog = document.createElement('div');
                dialog.className = 'confirm-dialog';
                dialog.innerHTML = '<div class="confirm-dialog-content">'
                    + '<div class="confirm-dialog-header">'
                    + '<i class="fas fa-' + icon + '"></i>'
                    + '<span>' + self.escapeHtml(title) + '</span>'
                    + '<button class="close-btn"><i class="fas fa-times"></i></button></div>'
                    + '<div class="confirm-dialog-body">' + message + '</div>'
                    + '<div class="confirm-dialog-footer">'
                    + '<button class="confirm-dialog-btn cancel">取消</button>'
                    + '<button class="confirm-dialog-btn ' + type + '">确定</button></div></div>';
                document.body.appendChild(dialog);
                var close = function (result) {
                    dialog.classList.remove('show');
                    setTimeout(function () {
                        if (dialog.parentNode) document.body.removeChild(dialog);
                    }, 250);
                    resolve(result);
                };
                dialog.querySelector('.cancel').addEventListener('click', function () { close(false); });
                dialog.querySelector('.' + type).addEventListener('click', function () { close(true); });
                dialog.querySelector('.close-btn').addEventListener('click', function () { close(false); });
                dialog.addEventListener('click', function (e) {
                    if (e.target === dialog) close(false);
                });
                setTimeout(function () { dialog.classList.add('show'); }, 10);
            });
        },

        showToast: function (message, isError) {
            var toast = document.getElementById('toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toast';
                document.body.appendChild(toast);
            }
            var icon = isError ? 'fa-exclamation-circle' : 'fa-check-circle';
            var title = isError ? '错误' : '成功';
            var color = isError ? '#f56c6c' : '#67c23a';
            toast.innerHTML = '<div class="toast-content" style="border-left-color:' + color + ';">'
                + '<div class="toast-icon"><i class="fas ' + icon + '" style="color:' + color + ';"></i></div>'
                + '<div><div class="toast-title">' + title + '</div>'
                + '<div class="toast-text">' + AppCommon.escapeHtml(message) + '</div></div></div>';
            toast.classList.remove('show');
            void toast.offsetHeight;
            toast.classList.add('show');
            clearTimeout(toast._timer);
            toast._timer = setTimeout(function () { toast.classList.remove('show'); }, 3000);
        },

        // 把公共方法挂到业务类原型：map = { 业务方法名: 'AppCommon 方法名' | 函数 }
        mixin: function (cls, map) {
            if (!cls || !cls.prototype || !map) return;
            Object.keys(map).forEach(function (alias) {
                var src = map[alias];
                var fn = typeof src === 'function' ? src : AppCommon[src];
                if (typeof fn === 'function') cls.prototype[alias] = fn;
            });
        }
    };

    // 兼容既有 this._escape(...) 调用
    AppCommon._escape = AppCommon.escapeHtml;

    window.AppCommon = AppCommon;
})();
