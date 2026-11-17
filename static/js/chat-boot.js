// static/js/chat-boot.js - ChatClient 启动引导
// 说明：所有 ChatClient 原型扩展加载完成后再实例化，避免方法与依赖未就绪。
AppCommon.mixin(ChatClient, {
    "escapeHtml": "escapeHtml",
    "_escape": "escapeHtml",
    "_notifEscape": "escapeHtml",
    "handleAuthError": "handleAuthError"
});



// 全局版本管理器实例
const versionManager = new VersionManager();

// 初始化全局实例
let chatClient = null;


document.addEventListener(
    'DOMContentLoaded', () => {
        console
            .log(
                'DOM 加载完成，创建 ChatClient 实例'
            )
        ;
        chatClient = new ChatClient();
        window
            .chatClient = chatClient;
    }
);

// 如果页面已经加载完成
if (document.readyState === 'complete') {
    console.log('页面已加载完成，立即创建 ChatClient 实例');
    chatClient = new ChatClient();
    window.chatClient = chatClient;
}