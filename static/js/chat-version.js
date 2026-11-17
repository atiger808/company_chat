// 版本管理器
class VersionManager {
    constructor() {
        this.STORAGE_KEY = 'app_version_info';
        this.STATIC_KEY = 'static_version';
        this.CHECK_INTERVAL = 10 * 60 * 1000; // 10分钟检查一次（降低频率，避免大量页面同时请求版本接口）
        this.lastCheckTime = 0;
        this.isChecking = false;
        this.updateBanner = null;
        this.updateBannerTimeout = 2 * 60 * 1000 // 2分钟后自动关闭
        // 「稍后更新」的提醒间隔
        this.updateLaterDelay = 10 * 60 * 1000;
        // 更新提示的用户选择（localStorage，跨会话）：{dismissed_version, snooze_until}
        this.UPDATE_PREF_KEY = 'update_prompt_prefs';
    }

    // ================= 更新提示的用户选择 =================
    // 「不再提示」→ dismissed_version（该版本永久忽略，服务端发布新版本后自动恢复提示）
    // 「稍后更新」→ snooze_until（静默到某个时间点）
    // 「关闭」    → sessionStorage 记本次打开页面期间不再提示（刷新页面后若仍未更新会再出现）
    _updatePrefs() {
        try {
            return JSON.parse(localStorage.getItem(this.UPDATE_PREF_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    _saveUpdatePrefs(patch) {
        try {
            localStorage.setItem(this.UPDATE_PREF_KEY, JSON.stringify(Object.assign(this._updatePrefs(), patch)));
        } catch (e) {
            console.warn('保存更新提示偏好失败:', e);
        }
    }

    _markClosedThisSession(version) {
        try {
            sessionStorage.setItem('update_closed_version', version || '');
        } catch (e) { /* 忽略 */ }
    }

    _closedThisSession(version) {
        try {
            return !!version && sessionStorage.getItem('update_closed_version') === version;
        } catch (e) {
            return false;
        }
    }

    // 获取存储的版本信息
    getStoredVersion() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch (e) {
            console.warn('读取版本信息失败:', e);
            return null;
        }
    }

    // 保存版本信息
    saveVersionInfo(info) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(info));
            if (info?.static_version) {
                localStorage.setItem(this.STATIC_KEY, info.static_version);
            }
            return true;
        } catch (e) {
            console.warn('保存版本信息失败:', e);
            return false;
        }
    }


    // 比较版本（支持语义化版本和时间戳-哈希格式）
    compareVersions(current, latest) {
        // 处理时间戳-哈希格式 (20260306-f396db6)
        if (current.includes('-') && latest.includes('-')) {
            // 直接按字典序比较（日期部分保证单调递增）
            return latest.localeCompare(current);
        }

        // 处理语义化版本 (2.3.1)
        const currentParts = current.split('.').map(Number);
        const latestParts = latest.split('.').map(Number);

        for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
            const currentVal = currentParts[i] || 0;
            const latestVal = latestParts[i] || 0;

            if (latestVal > currentVal) return 1;  // 需要更新
            if (latestVal < currentVal) return -1; // 降级（通常不应发生）
        }

        return 0; // 相同版本
    }

    // 检查是否需要更新
    async checkForUpdates(force = false) {
        // 避免频繁检查
        if (this.isChecking) return null;
        if (!force && Date.now() - this.lastCheckTime < this.CHECK_INTERVAL) {
            return null;
        }

        this.isChecking = true;
        this.lastCheckTime = Date.now();

        try {
            const response = await fetch('/api/chat/version/?t=' + Date.now(), {
                method: 'GET',
                cache: 'no-cache', // 强制从网络获取
                headers: TokenManager.getHeaders()
            });
            this.statusCode = response.status
            if (!response.ok) {
                if (response.status === 401) {
                    try {
                        await API.logout();
                    } catch (error) {
                        console.error('登出失败:', error);
                    } finally {
                        localStorage.removeItem('access_token');
                        localStorage.removeItem('user_id');
                        localStorage.removeItem('user_type');
                        window.location.href = '/login/';
                    }
                    return null;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const serverVersion = await response.json();

            // 版本提示自动关闭时长由管理控制台配置（默认 120 秒 / 2 分钟）
            const promptSeconds = parseInt(serverVersion.version_prompt_duration_seconds, 10);
            if (Number.isFinite(promptSeconds) && promptSeconds > 0) {
                this.updateBannerTimeout = Math.min(Math.max(promptSeconds, 10), 600) * 1000;
            }

            const localVersion = this.getStoredVersion();

            // 🔧 修复1: 首次访问时保存版本
            if (!localVersion) {
                this.saveVersionInfo(serverVersion);
                console.log('✅ 首次访问，保存版本信息:', serverVersion.static_version);
                return null;
            }

            // 🔧 修复2: 正确比较版本（使用修复后的 compareVersions）
            const staticDiff = this.compareVersions(
                localVersion.static_version || '',
                serverVersion.static_version || ''
            );
            const appDiff = this.compareVersions(
                localVersion.app_version || '',
                serverVersion.app_version || ''
            );

            // 🔧 修复3: 只有版本真正更新时才触发提示
            const hasUpdate = staticDiff > 0 || appDiff > 0;
            console.log('🔍 版本检查结果:', {
                currentStatic: localVersion.static_version,
                latestStatic: serverVersion.static_version,
                staticDiff,
                currentApp: localVersion.app_version,
                latestApp: serverVersion.app_version,
                appDiff,
                hasUpdate
            });

            if (hasUpdate) {
                const serverVer = serverVersion.static_version || serverVersion.app_version || '';
                const prefs = this._updatePrefs();

                // 用户点过「不再提示」：该版本不再提示（服务端发布新版本后自动恢复提示）
                if (prefs.dismissed_version && prefs.dismissed_version === serverVer) {
                    this.saveVersionInfo(serverVersion);
                    return null;
                }
                // 用户点过「稍后更新」：静默期内不再提示（静默期结束后恢复提示）
                if (prefs.snooze_until && Date.now() < prefs.snooze_until) {
                    return null;
                }
                // 用户点过「关闭」：本次打开页面期间不再提示（刷新页面后若仍未更新会再提示）
                if (this._closedThisSession(serverVer)) {
                    return null;
                }

                const updateInfo = {
                    hasUpdate: true,
                    staticUpdated: staticDiff > 0,
                    appUpdated: appDiff > 0,
                    forceUpdate: serverVersion.force_update || false,
                    current: localVersion,
                    latest: serverVersion,
                    updateMessage: serverVersion.update_message || '发现新版本，建议更新以获得最佳体验'
                };

                // ⚠️ 这里不能保存服务端版本号：一旦保存，下次比较就没有差异了，
                //    「稍后更新 / 关闭」之后再也不会提示（旧实现在这里保存，导致「稍后更新」形同虚设）。
                //    真正执行更新（performUpdate）或检测到无更新时才会同步版本号。
                return updateInfo;
            }

            // 无更新，但仍保存最新信息（用于下次比较）
            this.saveVersionInfo(serverVersion);
            return null;

        } catch (error) {
            console.warn('⚠️ 版本检查失败:', error);
            return null;
        } finally {
            this.isChecking = false;
        }
    }

    // 显示更新提示
    showUpdatePrompt(updateInfo) {
        // 移除旧的提示
        if (this.updateBanner && this.updateBanner.parentNode) {
            this.updateBanner.parentNode.removeChild(this.updateBanner);
        }

        // 创建更新提示
        this.updateBanner = document.createElement('div');
        this.updateBanner.className = 'version-update-banner';

        // 根据更新类型设置样式
        const isCritical = updateInfo.forceUpdate || updateInfo.appUpdated;
        this.updateBanner.classList.add(isCritical ? 'critical' : 'minor');

        // 🔧 版本更新日志折叠：默认只显示前 2 条，其余收起，点击「查看全部/收起」展开/折叠。
        // 🔧 预览的每一行还要截断：日志是「一行一个段落」（动辄几百字），原样塞进横幅会把横幅撑得
        //    比屏幕还高，把后面的「版本 / 更新时间 / 立即更新按钮」顶出视口（fixed 元素超出的部分
        //    无法靠页面滚动看到 → 用户点不到按钮）。完整内容仍在「查看全部更新日志」里可看。
        const PREVIEW_LINE_COUNT = 3;
        const PREVIEW_MAX_CHARS = 110;
        const clipText = (s) => (s.length > PREVIEW_MAX_CHARS ? s.slice(0, PREVIEW_MAX_CHARS) + '…' : s);
        const logLines = String(updateInfo.updateMessage || '').split('<br>').map(l => l.trim()).filter(Boolean);
        const previewLines = logLines.slice(0, PREVIEW_LINE_COUNT).map(clipText);
        const moreLines = logLines.slice(PREVIEW_LINE_COUNT);
        let descHtml = '<div class="update-desc">'
            + (previewLines.join('<br>') || '发现新版本，建议更新以获得最佳体验') + '</div>';
        if (moreLines.length) {
            descHtml += '<button class="update-log-toggle" id="updateLogToggle"><i class="fas fa-chevron-down"></i> 查看全部更新日志 (' + logLines.length + ')</button>'
                + '<div class="update-log-full" id="updateLogFull" style="display:none;">' + moreLines.join('<br>') + '</div>';
        }

        // 版本信息做兜底：即使接口少了 latest / 字段缺失，也只是少显示一行，
        // 不能让模板字符串抛错（一抛错整个横幅都不会渲染出来，用户彻底没法更新）
        const latest = updateInfo.latest || {};
        const latestVersion = latest.static_version || latest.app_version || '未知';
        const buildTime = latest.build_time || '';

        // 构建提示内容。
        // ⚠️ 布局要点：把「版本 / 更新时间 / 操作按钮」全部放在**第一行（头部）**，更新说明放在
        //    下面的正文区（限高可滚动）。这样无论更新日志多长，按钮都不可能被顶到屏幕外
        //    （之前把按钮排在长文本之后，内容一长按钮就看不见、点不到；即使样式没加载出来，
        //     按这个 DOM 顺序按钮也排在长文本之前，依然可见）。
        let content = `
            <div class="update-content">
                <div class="update-head">
                    <div class="update-icon">
                        <i class="fas fa-${isCritical ? 'exclamation-triangle' : 'sync-alt'}"></i>
                    </div>
                    <div class="update-title-wrap">
                        <div class="update-title">
                            ${isCritical ? '重要更新' : '发现新版本'}
                        </div>
                        <div class="update-time">
                            <small>版本: ${latestVersion}</small>
                            ${buildTime ? `<small>更新时间: ${buildTime}</small>` : ''}
                        </div>
                    </div>
                    <div class="update-actions">
        `;

        if (isCritical) {
            // 强制更新：只给「立即更新」（5 秒后还会自动更新，不给忽略入口）
            content += `
                <button class="update-btn critical" id="updateNowBtn" title="立即刷新并清除缓存">
                    <i class="fas fa-redo"></i> 立即更新
                </button>
            `;
        } else {
            // 普通更新：立即更新 / 稍后更新 / 不再提示 / 关闭（右上角 ×）
            content += `
                <button class="update-btn minor" id="updateNowBtn" title="立即刷新并清除缓存">
                    <i class="fas fa-redo"></i> 立即更新
                </button>
                <button class="update-btn later" id="updateLaterBtn" title="10 分钟后再提醒我">
                    <i class="far fa-clock"></i> 稍后更新
                </button>
                <button class="update-btn never" id="updateNeverBtn" title="本版本不再提示（发布新版本后会重新提示）">
                    <i class="fas fa-ban"></i> 不再提示
                </button>
            `;
        }

        content += `
                    </div>
                    <button class="update-close" id="updateCloseBtn" title="关闭（本次打开页面期间不再提示）">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="update-body">
                    ${descHtml}
                </div>
            </div>
        `;

        // 记住这次提示的是哪个版本：关闭/稍后/不再提示时要按版本号记录用户的选择
        this._lastUpdateVersion = latestVersion === '未知' ? '' : latestVersion;

        this.updateBanner.innerHTML = content;
        document.body.appendChild(this.updateBanner);

        // 🔧 版本更新日志展开/收起
        const logToggle = document.getElementById('updateLogToggle');
        if (logToggle) {
            logToggle.onclick = () => {
                const full = document.getElementById('updateLogFull');
                if (!full) return;
                const isCollapsed = full.style.display === 'none';
                full.style.display = isCollapsed ? 'block' : 'none';
                logToggle.innerHTML = isCollapsed
                    ? '<i class="fas fa-chevron-up"></i> 收起更新日志'
                    : '<i class="fas fa-chevron-down"></i> 查看全部更新日志 (' + logLines.length + ')';
            };
        }

        // 绑定事件（取到元素再绑，避免个别情况下取不到元素抛错、导致横幅上的按钮全部失效）
        const nowBtn = document.getElementById('updateNowBtn');
        if (nowBtn) {
            nowBtn.onclick = () => {
                this.performUpdate(updateInfo);
            };
        } else {
            console.warn('⚠️ 未找到「立即更新」按钮，版本更新横幅无法交互');
        }

        const closeBtn = document.getElementById('updateCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                this.dismissUpdatePrompt('close');
            };
        }

        const laterBtn = document.getElementById('updateLaterBtn');
        if (laterBtn) {
            laterBtn.onclick = () => {
                this.dismissUpdatePrompt('later');
            };
        }

        const neverBtn = document.getElementById('updateNeverBtn');
        if (neverBtn) {
            neverBtn.onclick = () => {
                this.dismissUpdatePrompt('never');
            };
        }

        // 自动隐藏（非强制更新）：超过设定时间没人操作就收起，本次打开页面期间不再打扰
        if (!isCritical) {
            setTimeout(() => {
                if (this.updateBanner && this.updateBanner.parentNode) {
                    this.dismissUpdatePrompt('close');
                }
            }, this.updateBannerTimeout);
        }

        // 强制更新：5秒后自动刷新
        if (isCritical) {
            setTimeout(() => {
                this.performUpdate(updateInfo);
            }, 5000);
        }
    }

    // 消除更新提示
    // mode:
    //   'close' 关闭       —— 本次打开页面期间不再提示（刷新页面后若仍未更新会再提示）
    //   'later' 稍后更新   —— 静默 10 分钟，到点后再次检查并提示
    //   'never' 不再提示   —— 该版本不再提示（服务端发布新版本后自动恢复提示）
    dismissUpdatePrompt(mode) {
        // 兼容旧的布尔调用（true=稍后，false=关闭）
        if (mode === true) mode = 'later';
        else if (mode === false) mode = 'close';
        mode = mode || 'close';

        const version = this._lastUpdateVersion || '';
        if (version) {
            if (mode === 'never') {
                this._saveUpdatePrefs({dismissed_version: version, snooze_until: 0});
                console.log('已选择「不再提示」的版本:', version);
            } else if (mode === 'later') {
                this._saveUpdatePrefs({snooze_until: Date.now() + this.updateLaterDelay});
                console.log('已选择「稍后更新」，' + (this.updateLaterDelay / 60000) + ' 分钟后再提醒');
            } else {
                this._markClosedThisSession(version);
            }
        }

        if (!this.updateBanner || !this.updateBanner.parentNode) return;

        this.updateBanner.classList.add('fade-out');
        setTimeout(() => {
            if (this.updateBanner && this.updateBanner.parentNode) {
                this.updateBanner.parentNode.removeChild(this.updateBanner);
                this.updateBanner = null;
            }
        }, 300);

        // 稍后提醒：到点后再检查一次
        if (mode === 'later') {
            setTimeout(() => {
                this.checkForUpdates(true).then(updateInfo => {
                    if (updateInfo && updateInfo.hasUpdate) {
                        this.showUpdatePrompt(updateInfo);
                    }
                });
            }, this.updateLaterDelay);
        }
    }

    // 清除「不再提示 / 稍后更新」的记录（用户实际更新过、或版本已同步时调用）
    clearUpdatePrefs() {
        try {
            localStorage.removeItem(this.UPDATE_PREF_KEY);
            sessionStorage.removeItem('update_closed_version');
        } catch (e) { /* 忽略 */ }
    }


    // 执行更新（清除所有缓存层）
    performUpdate(updateInfo) {
        // 用户主动更新：清掉「稍后更新 / 不再提示」等提示偏好
        this.clearUpdatePrefs();

        // 1. 清除 Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(reg => reg.unregister());
            }).catch(console.warn);

            // 清除 Cache Storage
            if ('caches' in window) {
                caches.keys().then(keys => {
                    keys.forEach(key => caches.delete(key));
                }).catch(console.warn);
            }
        }

        // 2. 清除 localStorage 中的缓存标记
        Object.keys(localStorage).forEach(key => {
            if (key.includes('cache') || key.includes('version') || key.includes('static')) {
                localStorage.removeItem(key);
            }
        });

        // 3. 保存滚动位置
        sessionStorage.setItem('preUpdateScrollY', window.scrollY.toString());

        // 4. 强制刷新（带唯一时间戳）
        const url = new URL(window.location.href);
        url.searchParams.set('updated', Date.now());
        window.location.replace(url.toString());
    }

    // 页面加载时恢复滚动位置
    restoreScrollPosition() {
        const scrollY = sessionStorage.getItem('preUpdateScrollY');
        if (scrollY) {
            setTimeout(() => {
                window.scrollTo(0, parseInt(scrollY));
                sessionStorage.removeItem('preUpdateScrollY');
            }, 100);
        }
    }

    // ================= 版本更新日志弹窗（持久查看，不受顶部横幅 2 分钟自动消失影响） =================
    openVersionLog() {
        const exist = document.getElementById('versionLogModal');
        if (exist) { exist.classList.add('show'); return; }
        this._injectVersionLogStyle();
        const ov = document.createElement('div');
        ov.id = 'versionLogModal';
        ov.className = 'version-log-modal';
        ov.innerHTML = '<div class="version-log-shell">'
            + '<div class="version-log-head"><div>'
            + '<div class="version-log-title"><i class="fas fa-history"></i> 版本更新日志</div>'
            + '<div class="version-log-sub" id="versionLogSub">加载中...</div></div>'
            + '<button class="version-log-close" onclick="versionManager.closeVersionLog()" title="关闭"><i class="fas fa-times"></i></button></div>'
            + '<div class="version-log-body" id="versionLogBody"><div class="version-log-loading"><i class="fas fa-spinner fa-spin"></i> 正在加载...</div></div>'
            + '<div class="version-log-foot"><button class="version-log-btn" onclick="versionManager.closeVersionLog()">关闭</button></div>'
            + '</div>';
        document.body.appendChild(ov);
        ov.classList.add('show');
        this._loadVersionLog();
    }

    closeVersionLog() {
        const ov = document.getElementById('versionLogModal');
        if (!ov) return;
        ov.classList.remove('show');
        setTimeout(() => { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }, 200);
    }

    // 解析版本日志：以「N. 」开头的行作为一条新条目，其余缩进行归入上一条的子项
    _parseVersionLog(text) {
        const rawLines = String(text || '').split('<br>').map(l => l.trim()).filter(Boolean);
        const entries = [];
        let cur = null;
        rawLines.forEach(line => {
            const m = line.match(/^(\d+)\.\s*(.*)$/);
            if (m) {
                cur = { num: parseInt(m[1], 10), title: (m[2] || '').trim() || line, parts: [] };
                entries.push(cur);
            } else if (cur) {
                cur.parts.push(line);
            } else {
                entries.push({ num: null, title: line, parts: [] });
            }
        });
        return entries;
    }

    _escLog(t) {
        return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async _loadVersionLog() {
        const body = document.getElementById('versionLogBody');
        const sub = document.getElementById('versionLogSub');
        try {
            const resp = await fetch('/api/chat/version/?t=' + Date.now(), {
                method: 'GET',
                cache: 'no-cache',
                headers: TokenManager.getHeaders()
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const v = await resp.json();
            const entries = this._parseVersionLog(v.update_message);
            if (sub) sub.textContent = '当前版本 ' + (v.static_version || '-') + (v.build_time ? ' · 更新时间 ' + v.build_time : '');
            if (!body) return;
            if (!entries.length) {
                body.innerHTML = '<div class="version-log-empty"><i class="fas fa-inbox"></i> 暂无版本更新日志</div>';
                return;
            }
            const self = this;
            body.innerHTML = entries.map(e => {
                const isNew = e.num === 0;
                const partsHtml = e.parts.length
                    ? '<div class="version-log-parts">' + e.parts.map(p => '<i class="fas fa-angle-right"></i> ' + self._escLog(p)).join('<br>') + '</div>'
                    : '';
                return '<div class="version-log-item' + (isNew ? ' latest' : '') + '">'
                    + '<div class="version-log-badge' + (isNew ? ' latest' : '') + '">' + (e.num != null ? e.num : '·') + '</div>'
                    + '<div class="version-log-content">' + self._escLog(e.title) + partsHtml + '</div>'
                    + '</div>';
            }).join('');
        } catch (e) {
            if (body) body.innerHTML = '<div class="version-log-empty"><i class="fas fa-exclamation-circle"></i> 加载失败，请稍后重试</div>';
        }
    }

    _injectVersionLogStyle() {
        if (document.getElementById('versionLogStyle')) return;
        const css = [
            '.version-log-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:10005;padding:16px;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}',
            '.version-log-modal.show{display:flex;}',
            '.version-log-shell{width:100%;max-width:680px;max-height:82vh;background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.25);}',
            '.version-log-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 20px;border-bottom:1px solid #ebeef5;background:linear-gradient(135deg,#ecf5ff,#f0f9eb);}',
            '.version-log-title{font-size:16px;font-weight:700;color:#303133;}',
            '.version-log-title i{color:#409eff;margin-right:6px;}',
            '.version-log-sub{font-size:12px;color:#909399;margin-top:4px;}',
            '.version-log-close{border:none;background:rgba(0,0,0,.05);width:30px;height:30px;border-radius:50%;cursor:pointer;color:#606266;font-size:15px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
            '.version-log-close:hover{background:rgba(245,108,108,.12);color:#f56c6c;}',
            '.version-log-body{flex:1;overflow-y:auto;padding:16px 20px;}',
            '.version-log-loading,.version-log-empty{text-align:center;color:#909399;padding:40px 0;font-size:14px;}',
            '.version-log-item{display:flex;gap:12px;position:relative;padding-bottom:16px;}',
            '.version-log-item:not(:last-child)::after{content:\'\';position:absolute;left:14px;top:36px;bottom:2px;width:2px;background:#e4e7ed;}',
            '.version-log-badge{width:28px;height:28px;border-radius:50%;background:#f2f3f5;color:#909399;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;border:2px solid #e4e7ed;z-index:1;}',
            '.version-log-badge.latest{background:linear-gradient(135deg,#409eff,#7c4dff);color:#fff;border-color:#409eff;box-shadow:0 0 0 4px rgba(64,158,255,.15);}',
            '.version-log-content{flex:1;min-width:0;font-size:13px;line-height:1.8;color:#303133;background:#f8f9fb;border:1px solid #ebeef5;border-radius:10px;padding:10px 14px;word-break:break-word;}',
            '.version-log-item.latest .version-log-content{background:linear-gradient(135deg,#ecf5ff,#f6f2ff);border-color:#c6e2ff;}',
            '.version-log-parts{margin-top:8px;color:#606266;font-size:12.5px;}',
            '.version-log-parts i{color:#409eff;margin-right:4px;font-size:10px;}',
            '.version-log-foot{display:flex;justify-content:flex-end;padding:12px 20px;border-top:1px solid #ebeef5;}',
            '.version-log-btn{border:none;background:#409eff;color:#fff;padding:8px 22px;border-radius:8px;cursor:pointer;font-size:13px;}',
            '.version-log-btn:hover{background:#337ecc;}',
            '[data-theme="dark"] .version-log-shell{background:#1e1e1e;}',
            '[data-theme="dark"] .version-log-head{background:linear-gradient(135deg,#1a2740,#2a2438);border-color:#333;}',
            '[data-theme="dark"] .version-log-title{color:#e5eaf3;}',
            '[data-theme="dark"] .version-log-close{background:rgba(255,255,255,.08);color:#b0b0b0;}',
            '[data-theme="dark"] .version-log-item:not(:last-child)::after{background:#333;}',
            '[data-theme="dark"] .version-log-badge{background:#2d2d2d;color:#909399;border-color:#444;}',
            '[data-theme="dark"] .version-log-content{background:#2a2a2a;border-color:#333;color:#e0e0e0;}',
            '[data-theme="dark"] .version-log-item.latest .version-log-content{background:linear-gradient(135deg,#1a2740,#2a2438);border-color:#3a4a6b;}',
            '[data-theme="dark"] .version-log-parts{color:#b0b0b0;}',
            '[data-theme="dark"] .version-log-foot{border-color:#333;}'
        ].join('\n');
        const style = document.createElement('style');
        style.id = 'versionLogStyle';
        style.textContent = css;
        document.head.appendChild(style);
    }
}
