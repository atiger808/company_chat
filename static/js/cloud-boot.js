// static/js/cloud-boot.js - CloudApp 启动引导
// 说明：所有 CloudApp 原型扩展加载完成后再实例化，避免方法与依赖未就绪。
AppCommon.mixin(CloudApp, {
    "escapeHtml": "escapeHtml"
});


// 全局初始化
let cloudApp = null;

// 确保在 DOM 加载完成后初始化 CloudApp
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        cloudApp = new CloudApp();
        window.cloudApp = cloudApp;
    });
} else {
    // 如果 DOM 已经加载完成，直接初始化
    cloudApp = new CloudApp();
    window.cloudApp = cloudApp;
}
