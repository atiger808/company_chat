# 浙企钉 · 企业协同办公平台

浙企钉是一套面向企业内部的一体化协同办公平台，集 **企业即时通讯、企业网盘、OA 办公、任务与群工单、组织架构、企业知识库** 于一体，支持多企业（租户）隔离、PWA 桌面安装与 Web Push 消息推送。

> 后端：Django 4.2 + Django REST Framework + Django Channels + Celery  
> 前端：原生 JavaScript + Font Awesome 6 + Chart.js  
> 部署：Daphne/ASGI + Redis + PostgreSQL + Nginx，可选 OnlyOffice 在线文档协作

---

## 功能特性

| 模块 | 主要能力 |
| --- | --- |
| 企业即时通讯 | 私聊/群聊、语音/视频通话、语音消息、文件与图片、消息引用/撤回/转发、群公告、群九宫格头像、任务/审批/总结卡片、群工单卡片 |
| 企业网盘 | 多级目录、分片上传/断点续传/秒传、分享（链接/密码/二维码）、回收站、批量操作、OnlyOffice 在线编辑、协作文档、共享文件夹、操作权限（打印/下载/公开分享）、企业水印 |
| OA 办公 | 考勤打卡（白班/夜班/补卡/定位）、OA 审批（顺序/并行/或签/会签、动态类型、票据回传、物资单据）、普惠补贴（发票 OCR/验真/核验/支付/提现）、集团公告、每日工作总结（火山方舟大模型分析） |
| 任务中心 | 普通任务（看板拖拽、状态跟踪、附件、逾期提醒、群内同步）、群工单/群待办（多环节串行、交付附件、核验驳回、DING 催办、Excel 导出） |
| 组织架构 | 企业/子公司/部门树、成员与角色、负责人/副负责人、汇报关系、架构图，多企业隔离 |
| 工作通知 | 工作通知铃铛、WebSocket 实时推送、Web Push、桌面通知、DING 高优先级提醒、瀑布流待办/通知（分页、折叠、拖动、定时刷新） |
| 管理控制台 | 用户/聊天室管理、数据统计、系统设置、水印、通知弹窗、公告设置、报表权限、群待办权限、瀑布流通知、智能体设置、数据隔离、登录/操作日志 |
| 企业知识库 | 树状导航、Markdown 渲染、标题锚点、全文搜索、主题切换、打印、移动端抽屉 |
| 企业智能体 | 按企业配置嵌入代码与总开关，支持逐页面启用（含官网主页、聊天、网盘、OA、任务、组织架构、知识库等） |
| PWA / 推送 | 可安装到桌面，Service Worker 缓存与离线回退，Web Push 系统通知与未读徽章 |

---

## 技术栈

| 组件 | 技术 |
| --- | --- |
| 后端框架 | Django 4.2 / Django REST Framework |
| 实时通信 | Django Channels 4.x + Daphne（WebSocket，AES/SM4 加密） |
| 数据库 | PostgreSQL（生产）/ SQLite（开发） |
| 缓存与消息队列 | Redis |
| 异步任务 | Celery + django-celery-beat（DatabaseScheduler） |
| 前端 | 原生 JavaScript、Font Awesome 6、Chart.js |
| 文档协作 | OnlyOffice Document Server |
| 大模型 | 火山方舟（豆包）OpenAI 兼容流式接口 |
| 票据识别 | 百度 OCR / PaddleOCR / 二维码扫描 |
| 认证与加密 | JWT（simplejwt）、AES、国密 SM4 |
| 部署 | Nginx + Daphne/ASGI + Redis + PostgreSQL + systemd |

---

## 目录结构

```text
company_chat/
├── manage.py
├── company_chat/          # Django 主配置（settings/urls/asgi/celery）
├── accounts/              # 用户、企业、部门、日志
├── chat/                  # 即时通讯、群公告、版本日志、Web Push
├── cloud/                 # 企业网盘、OnlyOffice、分享、协作
├── oa/                    # 考勤、审批、补贴、物资、工作日历、公告、总结、通知
├── tasks/                 # 普通任务 + 群工单
├── org/                   # 组织架构
├── utils/                 # 加密、OCR、大模型、权限等工具
├── templates/             # 页面模板
├── static/                # JS/CSS/第三方库/图标
├── docs/                  # 项目文档、员工手册、部署文档
├── media/                 # 用户上传文件
├── README.md              # 本文件
├── README-zh.md           # 中文部署详解（数据库、Nginx、OnlyOffice、Celery）
├── requirements.txt
├── start_chat.sh
├── celery_company_chat.sh
├── company_chat.service
├── celery_company_chat_worker.service
├── celery_company_chat_beat.service
├── update_static_versions.py
├── push_relay.py
└── VERSION_MESSAGE.txt    # 版本更新日志
```

更完整的模块、模型、接口与文件说明见：[项目结构文档](<docs/浙企钉-企业协同办公平台 · 项目结构文档.md>)。

---

## 快速开始

### 1. 环境要求

- Python 3.9+
- Redis 5+
- PostgreSQL 13+（生产推荐；开发也可使用 SQLite）
- Node.js（可选，仅用于生成知识库 HTML 等脚本）

### 2. 安装依赖

```bash
python -m venv venv
# Windows
venv\Scripts\activate
# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
```

### 3. 配置环境变量

在项目根目录创建 `.env`，至少配置：

```ini
DEBUG=True
SECRET_KEY=请替换为随机密钥
ALLOWED_HOSTS=127.0.0.1,localhost

# 数据库（生产）
DB_NAME=company_chat
DB_USER=company_chat
DB_PASSWORD=请替换
DB_HOST=127.0.0.1
DB_PORT=5432

# Redis / Celery
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
CELERY_REDIS_HOST=127.0.0.1
CELERY_REDIS_PORT=6379
CELERY_REDIS_PASSWORD=

# 大模型（每日工作总结）
ARK_API_KEY=
ARK_MODEL=

# Web Push（可选）
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_ADMIN_EMAIL=

# 地图 / OCR（可选）
BAIDU_MAP_JS_AK=
BAIDU_MAP_SERVER_AK=
BAIDU_OCR_API_KEY=
BAIDU_OCR_SECRET_KEY=
```

OnlyOffice 地址与密钥可在「企业网盘 → 系统配置」中维护。

### 4. 初始化数据库

```bash
python manage.py migrate
# 若模型已变更且仓库未包含对应迁移文件，再执行：
# python manage.py makemigrations && python manage.py migrate
python manage.py createsuperuser
```

### 5. 启动服务

开发环境可直接使用 ASGI（Channels 需要 Daphne/Uvicorn 才支持 WebSocket）：

```bash
daphne -b 0.0.0.0 -p 10900 company_chat.asgi:application
```

或使用项目脚本：

```bash
bash start_chat.sh
```

### 6. 启动 Celery（通知、每日总结、超时提醒等）

```bash
bash celery_company_chat.sh
```

或手动启动：

```bash
celery -A company_chat.celery_app worker -l info --concurrency=4
celery -A company_chat.celery_app beat -l info
```

### 7. 访问

| 入口 | 地址 |
| --- | --- |
| 官网首页 | `http://127.0.0.1:10900/` |
| 企业聊天室 | `http://127.0.0.1:10900/chat/` |
| 管理控制台 | `http://127.0.0.1:10900/control/` |
| 企业网盘 | `http://127.0.0.1:10900/cloud/` |
| 任务中心 | `http://127.0.0.1:10900/tasks/` |
| 组织架构 | `http://127.0.0.1:10900/org/` |
| 企业知识库 | `http://127.0.0.1:10900/docs/` |
| OA 审批 | `http://127.0.0.1:10900/oa/approval/` |
| Django Admin | `http://127.0.0.1:10900/admin/` |

---

## 静态资源与缓存

项目同时使用两层缓存控制：

1. **模板查询参数版本号**：修改 `static/js|css` 后更新对应模板的 `?v=YYYYMMDD-xxxxxx`，绕过浏览器与 CDN 缓存。
2. **Service Worker 版本**：修改 `static/js/service-worker.js` 中的 `STATIC_VERSION`，触发 PWA 壳缓存更新。

发布前端改动时建议同步更新 `VERSION_MESSAGE.txt` 版本条目；聊天室版本横幅与完整更新日志由 `/api/chat/version/` 与 `/api/chat/version/log/` 提供。

---

## 部署

生产部署（Nginx 反向代理、Daphne、PostgreSQL、Redis、Celery、OnlyOffice、HTTPS、PWA）的详细步骤与示例配置见：

- [中文部署详解 README-zh.md](README-zh.md)
- [项目结构文档](<docs/浙企钉-企业协同办公平台 · 项目结构文档.md>)
- [PWA 部署检查清单](PWA_DEPLOYMENT_CHECKLIST.md)
- `docs/` 下的 OnlyOffice / PostgreSQL 安装部署文档

> 模型或视图变更同步到服务器后，请重启 Daphne（ASGI）服务；Celery 相关变更请重启 Worker/Beat。数据库迁移在服务器环境执行 `python manage.py makemigrations && python manage.py migrate`。

---

## 文档

| 文档 | 说明 |
| --- | --- |
| [项目结构文档](<docs/浙企钉-企业协同办公平台 · 项目结构文档.md>) | 模块、模型、接口、静态资源、部署说明 |
| [员工使用手册（Markdown）](<docs/浙企钉-员工使用手册.md>) | 面向员工的功能与操作指南 |
| [员工使用手册（HTML）](<docs/浙企钉-员工使用手册.html>) | 可离线浏览/打印的版本 |
| [员工使用手册（PDF）](<docs/浙企钉-企业协同办公平台 · 员工使用手册.pdf>) | PDF 版本 |
| `docs/` | OnlyOffice、PostgreSQL、Nginx、备份等部署文档 |

---

## 许可与使用

本项目为企业内部协同办公系统，包含企业敏感数据与私有配置。请勿将 `.env`、数据库备份、用户上传文件或服务器密钥提交到公开仓库。
