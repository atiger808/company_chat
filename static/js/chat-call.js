// static/js/chat-call.js - WebRTC 通话、铃声与通话界面、修改密码
// 说明：本文件为 ChatClient 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(ChatClient.prototype, {


    // ================= 修改密码相关方法 =================
    openChangePasswordModal() {
        this.resetChangePasswordForm();
        const modal = document.getElementById('changePasswordModal');
        if (modal) modal.classList.add('show');
    },

    closeChangePasswordModal() {
        const modal = document.getElementById('changePasswordModal');
        if (modal) modal.classList.remove('show');
        this.resetChangePasswordForm();
    },

    resetChangePasswordForm() {
        document.getElementById('changePasswordForm').reset();
        ['currentPasswordError', 'newPasswordError', 'confirmPasswordError'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = '';
                el.style.display = 'none';
            }
        });
        const successEl = document.getElementById('changePasswordSuccess');
        if (successEl) {
            successEl.textContent = '';
            successEl.style.display = 'none';
        }

        const btn = document.getElementById('submitChangePasswordBtn');
        if (btn) {
            btn.classList.remove('loading');
            btn.disabled = false;
        }

        // 清除输入框错误样式
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.classList.remove('error');
        });
    },

    showChangePasswordError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
            // 联动高亮输入框
            const inputId = elementId.replace('Error', '');
            const input = document.getElementById(inputId);
            if (input) input.classList.add('error');
        }
    },


    async submitChangePassword() {
        const currentPwd = document.getElementById('currentPassword').value.trim();
        const newPwd = document.getElementById('newPassword').value.trim();
        const confirmPwd = document.getElementById('confirmPassword').value.trim();

        // 清除历史状态
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
            document.getElementById(id).classList.remove('error');
        });
        ['currentPasswordError', 'newPasswordError', 'confirmPasswordError'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // 🔍 前端基础验证
        let isValid = true;
        if (!currentPwd) {
            this.showChangePasswordError('currentPasswordError', '请输入当前密码');
            isValid = false;
        }
        if (!newPwd) {
            this.showChangePasswordError('newPasswordError', '请输入新密码');
            isValid = false;
        } else if (newPwd.length < 8) {
            this.showChangePasswordError('newPasswordError', '新密码长度至少为8位');
            isValid = false;
        }
        if (!confirmPwd) {
            this.showChangePasswordError('confirmPasswordError', '请确认新密码');
            isValid = false;
        } else if (newPwd !== confirmPwd) {
            this.showChangePasswordError('confirmPasswordError', '两次输入的新密码不一致');
            isValid = false;
        }

        if (!isValid) return;

        // 🔄 显示加载状态
        const btn = document.getElementById('submitChangePasswordBtn');
        btn.classList.add('loading');
        btn.disabled = true;

        try {
            // 🔐 加密传输（与登录逻辑保持一致）
            const encCurrent = window.EncryptUtils ? window.EncryptUtils.encryptData(currentPwd) : currentPwd;
            const encNew = window.EncryptUtils ? window.EncryptUtils.encryptData(newPwd) : newPwd;

            const response = await API.changePassword(encCurrent, encNew, encNew);
            const data = await response.json();

            if (response.ok) {
                const successEl = document.getElementById('changePasswordSuccess');
                successEl.textContent = data.message || '✅ 密码修改成功';
                successEl.style.display = 'block';

                // 1.5秒后自动关闭并提示重新登录（因为修改密码后旧Token通常失效）
                setTimeout(() => {
                    this.closeChangePasswordModal();
                    this.showSuccess('密码已更新，请重新登录');
                    this.logout(); // 修改密码后使旧 Token 失效并跳回登录页
                    // 可选：自动跳转登录页
                    // localStorage.removeItem('access_token');
                    // window.location.href = '/login/';
                }, 1500);
            } else {
                // 🛡️ 处理后端 DRF 验证错误
                if (data.old_password?.[0]) {
                    this.showChangePasswordError('currentPasswordError', data.old_password[0]);
                } else if (data.new_password?.[0]) {
                    this.showChangePasswordError('newPasswordError', data.new_password[0]);
                } else if (data.new_password_confirm?.[0]) {
                    this.showChangePasswordError('confirmPasswordError', data.new_password_confirm[0]);
                } else {
                    this.showChangePasswordError('currentPasswordError', data.detail || data.error || data.message || '修改失败');
                }
            }
        } catch (error) {
            console.error('修改密码请求失败:', error);
            this.showChangePasswordError('currentPasswordError', '网络异常，请稍后重试');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },


    // 语音&视频通话功能开始

    // 🔧 新增/替换：初始化并绑定远程媒体元素
    setupRemoteMediaElements() {
        let remoteVideo = document.getElementById('remoteVideo');
        let remoteAudio = document.getElementById('remoteAudio');

        // 如果元素不存在则动态创建
        if (!remoteVideo) {
            remoteVideo = document.createElement('video');
            remoteVideo.id = 'remoteVideo';
            remoteVideo.className = 'remote-video hidden';
            document.getElementById('callMediaContainer')?.appendChild(remoteVideo);
        }
        if (!remoteAudio) {
            remoteAudio = document.createElement('audio');
            remoteAudio.id = 'remoteAudio';
            remoteAudio.className = 'remote-audio hidden';
            document.getElementById('callMediaContainer')?.appendChild(remoteAudio);
        }

        // 🔑 关键修复：设置自动播放与内联播放（iOS Safari 必需）
        remoteVideo.autoplay = true;
        remoteVideo.playsinline = true;
        remoteVideo.muted = false; // 远程流不能静音

        remoteAudio.autoplay = true;
        remoteAudio.playsinline = true;
    },

    // 🔧 新增/替换：初始化本地媒体元素
    setupLocalMediaElements() {
        let localVideo = document.getElementById('localVideo');
        if (!localVideo) {
            localVideo = document.createElement('video');
            localVideo.id = 'localVideo';
            localVideo.className = 'local-video hidden';
            document.getElementById('callMediaContainer')?.appendChild(localVideo);
        }
        // 🔑 关键修复：本地视频必须静音，否则触发浏览器音频回环保护
        localVideo.autoplay = true;
        localVideo.playsinline = true;
        localVideo.muted = true;
    },


    async initiateCall(type) {
        console.log('🚀 [CALL] 发起通话:', type);

        // 🔧 关键修复1: 状态检查
        if (this.callState !== 'idle') {
            this.showError('当前已有进行中的通话');
            return;
        }

        const targetUserId = this.getCurrentChatTargetUserId();
        if (!targetUserId || targetUserId === this.currentUser.id) {

            console.log('请选择有效的聊天对象，暂不支持群组语音&视频通话!');
            return;
        }

        // 🔧 关键修复2: 初始化通话参数
        this.callType = type;
        this.callRoomId = this.currentRoomId;
        this.callState = 'calling';
        this.pendingCallerId = targetUserId;  // 🔧 保存目标用户 ID

        // 🔧 关键修复：启用通话保护
        this.isCallInProgress = true;
        console.log('🔒 通话保护已启用');

        // 🔧 关键修复：重置 answer 处理标志（新通话）
        this.answerProcessed = false;

        try {
            // 🔧 1. 先获取 TURN 凭证（避免媒体权限阻塞信令）
            console.log('🔑 获取 TURN 凭证...');
            const turnConfig = await this.fetchTurnCredentials();

            // 🔧 2. 连接信令 WebSocket
            console.log('🔄 连接通话信令...');
            await this.connectCallWebSocket();
            console.log('✅ 信令连接成功');

            // 🔧 3. 获取本地媒体
            console.log('🎤 请求媒体权限...');
            const constraints = {
                audio: true,
                video: type === 'video' ? {
                    facingMode: 'user',
                    width: {ideal: 1280},
                    height: {ideal: 720}
                } : false
            };
            // 🔧 发起通话前先确保推送通知已订阅（后台/锁屏也能收到来电/消息推送）
            if ('Notification' in window && Notification.permission !== 'granted') {
                try {
                    await Notification.requestPermission();
                } catch (e) {
                }
            }
            this.ensurePushSubscribed();

            try {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (e) {
                console.error('❌ 获取媒体失败:', e);
                if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
                    // PWA 不是原生 App，手机设置里没有本应用；权限由浏览器管理
                    this.showError('无法使用摄像头/麦克风：请在浏览器地址栏点击锁图标 → 网站设置 → 允许摄像头和麦克风。');
                } else {
                    this.showError('无法获取摄像头/麦克风权限：' + (e && (e.message || e.name) || e));
                }
                this.callState = 'idle';
                this.isCallInProgress = false;
                this.endCall();
                return;
            }
            console.log('✅ 获取本地媒体流成功');

            // 🔧 2. 初始化 UI 元素
            this.setupRemoteMediaElements();
            this.setupLocalMediaElements();

            // 🔧 7. 更新 UI - 显示对方信息
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                if (type === 'video') localVideo.classList.remove('hidden');
                this.updateCallUI('calling');
            }

            // 🔧 新增：显示对方名字和头像
            this.updateCallHeaderWithTargetInfo(targetUserId);


            // 🔧 3. 创建 PeerConnection（此时 localStream 已准备就绪）（传入凭证）
            console.log('🔧 初始化 RTCPeerConnection...');
            this.setupPeerConnection(turnConfig.iceServers);

            // 🔧 关键修复：确保本地轨道已添加到 PeerConnection
            if (!this.localStream || this.localStream.getTracks().length === 0) {
                throw new Error('本地媒体流为空，请检查麦克风/摄像头权限');
            }

            // 🔧 关键修复：验证所有轨道都处于启用状态
            this.localStream.getTracks().forEach(track => {
                if (!track.enabled) {
                    console.warn('⚠️ 轨道被禁用，重新启用:', track.kind);
                    track.enabled = true;
                }
                console.log('✅ 本地轨道状态:', {
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                    label: track.label
                });
            });


            // 🔧 5. 创建并发送 Offer
            console.log('🔧 创建 SDP Offer...');
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);


            // 🔧 6. 发送信令（带重试）
            const sendOffer = () => {
                if (this.callWs?.readyState === WebSocket.OPEN) {
                    this.callWs.send(JSON.stringify({
                        type: 'call_offer',
                        sdp: offer,
                        from: this.currentUser.id,
                        to: targetUserId,
                        room_id: this.callRoomId,
                        media_type: this.callType
                    }));
                    return true;
                }
                return false;
            };

            if (!sendOffer()) {
                // 重试机制
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!sendOffer()) {
                    throw new Error('信令发送失败');
                }
            }

            // 🔧 关键修复：不在这里记录 callStartTime，等 ICE 连接成功后再记录
            // this.callStartTime = Date.now();  // ❌ 删除这行
            console.log('✅ 通话发起成功，等待对方接听...');

            // 🔧 新增：播放呼叫方铃声（与接听方铃声区分）
            this.playCallerRingtone();


        } catch (err) {
            console.error('❌ 发起通话失败:', err);
            this.showError(`无法发起通话: ${err.message || '请检查网络或权限'}`);
            if (err.name === 'NotAllowedError') {
                this.showError('请允许访问麦克风/摄像头权限');
            }
            this.endCall();
        }
    },


    // 🔧 修复：连接通话信令 WebSocket
    async connectCallWebSocket(roomId = null) {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const token = localStorage.getItem('access_token');

            // 🔧 关键修复：优先使用传入的 roomId，其次使用 this.callRoomId
            const targetRoomId = roomId || this.callRoomId;
            if (!targetRoomId) {
                reject(new Error('缺少聊天室 ID'));
                return;
            }

            let wsUrl = `${protocol}//${window.location.host}/ws/call/${targetRoomId}/`;
            if (token) {
                wsUrl += `?token=${encodeURIComponent(token)}`;
            }

            console.log('🔗 连接通话信令 WebSocket:', wsUrl);

            this.callWs = new WebSocket(wsUrl);

            const connectionTimeout = setTimeout(() => {
                if (this.callWs && this.callWs.readyState === WebSocket.CONNECTING) {
                    console.warn('⏰ 通话信令连接超时');
                    this.callWs.close();
                    reject(new Error('通话信令连接超时'));
                }
            }, 5000);

            this.callWs.onopen = () => {
                clearTimeout(connectionTimeout);
                console.log('✅ 通话信令 WebSocket 已连接');
                resolve();
            };

            this.callWs.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleCallSignaling(data);
                } catch (error) {
                    console.error('❌ 解析信令消息失败:', error);
                }
            };

            this.callWs.onclose = (event) => {
                clearTimeout(connectionTimeout);
                console.log('🔌 通话信令断开:', event.code, event.reason);

                // 🔧 关键修复：只在通话进行中且非正常关闭时才结束通话
                // code 1000: 正常关闭
                // code 1001: 离开页面
                // code 1006: 异常断开
                if (event.code !== 1000 && this.callState !== 'idle' && this.callState !== 'ended') {
                    console.warn('⚠️ 通话信令异常断开，但保持通话状态，尝试重连...');
                    // 🔧 不立即结束通话，给用户一个恢复的机会
                    // 只有在真正需要结束时才调用 endCall()
                    this.showToast('通话连接不稳定，请检查网络', 'warning');
                }
            };

            this.callWs.onerror = (error) => {
                clearTimeout(connectionTimeout);
                console.error('❌ 通话信令错误:', error);
                reject(new Error('WebSocket 连接错误'));
            };
        });
    },

    // 发起通话前先获取凭证
    async fetchTurnCredentials() {
        try {
            const response = await fetch('/api/chat/turn/credentials/', {
                headers: TokenManager.getHeaders(),
                cache: 'no-store'
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(`HTTP ${response.status}: ${err.error || 'Unknown'}`);
            }

            const data = await response.json();

            if (!data.username || !data.credential) {
                throw new Error('凭证数据不完整');
            }

            console.log('🔑 TURN 凭证获取成功:', {
                username: data.username,
                realm: data.realm,
                uris: data.uris,
                expiresAt: new Date(Date.now() + data.ttl * 1000).toLocaleTimeString()
            });

            // 🔧 关键修复：构造标准的 ICE 服务器配置
            const iceServers = data.uris.map(uri => {
                const server = {
                    urls: uri,
                    username: data.username,
                    credential: data.credential
                };

                // 🔧 某些浏览器需要 credentialType 字段
                if (data.credentialType) {
                    server.credentialType = data.credentialType;
                }

                return server;
            });

            // 🔧 添加 STUN 服务器作为备用（含国内可达的，国内设备连不上 Google STUN）
            iceServers.push(
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'},
                {urls: 'stun:stun.miwifi.com:3478'},
                {urls: 'stun:stun.qq.com:3478'}
            );

            // console.log('🔧 ICE Servers 配置:', JSON.stringify(iceServers, null, 2));

            return {
                iceServers: iceServers,
                expiresAt: Date.now() + (data.ttl * 1000),
                realm: data.realm
            };
        } catch (error) {
            console.error('❌ 获取 TURN 凭证失败:', error);
            return {
                iceServers: [
                    {urls: 'stun:stun.l.google.com:19302'},
                    {urls: 'stun:stun1.l.google.com:19302'},
                    {urls: 'stun:stun.miwifi.com:3478'},
                    {urls: 'stun:stun.qq.com:3478'}
                ],
                expiresAt: 0
            };
        }
    },

    // 🔧 新增：安全添加 ICE 候选（解决竞态条件）
    async addIceCandidateSafe(candidate) {
        const rtcCandidate = new RTCIceCandidate(candidate);
        if (this.isRemoteDescriptionSet) {
            await this.peerConnection.addIceCandidate(rtcCandidate).catch(e =>
                console.warn('⚠️ ICE候选注入失败:', e)
            );
        } else {
            this.pendingIceCandidates.push(rtcCandidate);
        }
    },

    // 🔧 新增：清空候选队列（在 setRemoteDescription 成功后调用）
    async drainIceCandidateQueue() {
        this.isRemoteDescriptionSet = true;
        for (const cand of this.pendingIceCandidates) {
            await this.peerConnection.addIceCandidate(cand).catch(e =>
                console.warn('⚠️ 队列候选注入失败:', e)
            );
        }
        this.pendingIceCandidates = [];
        console.log('✅ ICE候选队列已清空，共处理:', this.pendingIceCandidates.length);
    },

    // 🔧 统一处理 PeerConnection 状态变化：
    // 移动端网络抖动时 connectionState 会短暂变为 disconnected / failed，
    // 之前直接挂断导致“双方都没挂断却自动挂断”。现在改为：
    //   - disconnected：等待自动恢复，稍后未恢复再重启 ICE；
    //   - failed / closed：先重启 ICE，仍失败才挂断。
    _handlePeerConnectionState(state) {
        console.log('🔗 [PeerConnection State]:', state);

        if (state === 'connected') {
            console.log('✅ PeerConnection 已连接，音视频应该可以传输');
            return;
        }

        if (state === 'disconnected') {
            console.warn('⚠️ PeerConnection disconnected，等待自动恢复（不挂断）...');
            this._scheduleIceRecoveryCheck();
            return;
        }

        if (state === 'failed' || state === 'closed') {
            if (this.callState === 'idle') return;
            console.warn(`⚠️ PeerConnection ${state}，尝试重启 ICE 恢复...`);
            this._tryRestartIce();
        }
    },

    // 尝试重启 ICE（移动端网络切换/抖动时恢复连接）
    _tryRestartIce() {
        if (this.iceRestartTimer) clearTimeout(this.iceRestartTimer);
        try {
            if (this.peerConnection && this.peerConnection.canTrickleIceCandidates) {
                console.warn('🔄 执行 ICE Restart...');
                this.peerConnection.restartIce();
            }
        } catch (e) {
            console.warn('⚠️ ICE Restart 失败:', e);
        }

        this.iceRestartTimer = setTimeout(() => {
            if (this.callState === 'idle' || !this.peerConnection) return;
            const conn = this.peerConnection.connectionState;
            const ice = this.peerConnection.iceConnectionState;
            if (conn === 'failed' || conn === 'closed' || ice === 'failed') {
                console.error('❌ ICE Restart 后仍未恢复，结束通话');
                this.showError('网络连接失败，请检查网络后重试');
                this.endCall();
            }
        }, 10000);
    },

    // 短暂掉线后仍未恢复则重启 ICE
    _scheduleIceRecoveryCheck() {
        if (this.iceRecoveryTimer) clearTimeout(this.iceRecoveryTimer);
        this.iceRecoveryTimer = setTimeout(() => {
            if (this.callState === 'idle' || !this.peerConnection) return;
            const conn = this.peerConnection.connectionState;
            const ice = this.peerConnection.iceConnectionState;
            if (conn === 'disconnected' || conn === 'failed' || ice === 'failed') {
                console.warn('🔄 检测到连接仍未恢复，尝试 ICE Restart...');
                this._tryRestartIce();
            }
        }, 4000);
    },


    setupPeerConnection_v1(iceServers = null) {
        if (!iceServers || !Array.isArray(iceServers) || iceServers.length === 0) {
            console.warn('⚠️ [RTC] 未提供 ICE 服务器，使用降级配置');
            iceServers = [
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            ];
        }

        const iceInfo = iceServers.map(s => ({
            urls: s.urls,
            hasAuth: !!s.username,
            transport: s.urls.includes('transport=') ? s.urls.split('transport=')[1] : 'default'
        }));
        console.log('🔧 [RTC] PeerConnection config:', JSON.stringify(iceInfo, null, 2));

        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        });

        // 🔧 关键修复：跟踪已设置的远程流
        this.remoteStreamSet = false;
        this.audioStreamSet = false;  // 🔧 新增：单独跟踪音频
        this.videoStreamSet = false;  // 🔧 新增：单独跟踪视频

        // 🔧 关键修复：立即添加本地流（必须在设置事件处理器之前）
        if (this.localStream) {
            console.log('📤 [SETUP] 添加本地媒体轨道:', this.localStream.getTracks().length);
            this.localStream.getTracks().forEach(track => {
                try {
                    this.peerConnection.addTrack(track, this.localStream);
                    console.log('  ✅ [SETUP] 已添加轨道:', track.kind, track.label, 'enabled:', track.enabled);
                } catch (err) {
                    console.error('  ❌ [SETUP] 添加轨道失败:', track.kind, err);
                }
            });
        }


        // 🔧 关键修复：收集所有远程轨道，等待完整流后再设置
        const remoteTracks = new Map(); // track.kind -> track

        const sentCandidates = new Set();

        this.peerConnection.onicecandidate = (event) => {
            if (!event.candidate || this.callWs?.readyState !== WebSocket.OPEN) return;

            const cand = event.candidate;
            const key = `${cand.sdpMid}:${cand.sdpMLineIndex}:${cand.candidate?.substring(0, 50)}`;

            if (!sentCandidates.has(key)) {
                sentCandidates.add(key);

                // 🔧 关键修复：将 RTCIceCandidate 转换为普通对象
                const candidateData = {
                    candidate: cand.candidate,
                    sdpMid: cand.sdpMid,
                    sdpMLineIndex: cand.sdpMLineIndex,
                    usernameFragment: cand.usernameFragment
                };
                this.callWs.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: candidateData,  // 🔧 使用普通对象而不是 RTCIceCandidate
                    room_id: this.callRoomId,
                    to: this.pendingCallerId
                }));
                console.log('📤 [ICE] Sent candidate:', cand.type, cand.address ? cand.address.substring(0, 20) : 'unknown');
            }
        };

        // 🔧 关键修复：同时监听多个连接状态
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 [ICE Connection State]:', state);

            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE 连接成功，媒体通道已打通');

                // 🔧 关键修复：ICE 连接成功后才记录通话开始时间
                if (!this.callStartTime) {
                    this.callStartTime = Date.now();
                    console.log('⏱️ 通话开始时间已记录:', new Date(this.callStartTime).toLocaleTimeString());
                }

                // 🔧 关键修复：更新通话状态为 connected
                if (this.callState !== 'connected') {
                    this.callState = 'connected';
                    this.updateCallUI('connected');
                    this.startCallDurationTimer();

                    // 🔧 新增：停止呼叫方铃声（如果是发起方）
                    this.stopCallerRingtone();
                    // 🔧 新增：停止接听方铃声（如果是接听方）
                    this.stopRingtone();
                }
            }

            if (state === 'failed') {
                console.error('❌ ICE 连接失败，详细诊断信息:');

                // 🔧 新增：收集诊断信息
                const stats = this.peerConnection.getStats();
                stats.then(statsReport => {
                    let iceCandidatePairs = [];
                    statsReport.forEach(report => {
                        if (report.type === 'candidate-pair') {
                            iceCandidatePairs.push({
                                state: report.state,
                                localCandidateId: report.localCandidateId,
                                remoteCandidateId: report.remoteCandidateId,
                                nominated: report.nominated,
                                bytesSent: report.bytesSent,
                                bytesReceived: report.bytesReceived
                            });
                        }
                    });
                    console.log('📊 ICE Candidate Pairs:', JSON.stringify(iceCandidatePairs, null, 2));
                }).catch(err => {
                    console.warn('⚠️ 获取 ICE 统计信息失败:', err);
                });

                // 🔧 优化错误提示：根据场景提供不同建议
                const isMobileToPC = /Mobi|Android/i.test(navigator.userAgent); // 判断是否是移动端
                const errorMessage = isMobileToPC
                    ? '网络连接失败。请检查：\n1. 是否在同一网络环境\n2. 防火墙/路由器是否阻止了 UDP 端口\n3. 尝试切换到 WiFi 或移动数据'
                    : '网络连接失败。请检查：\n1. TURN 服务器是否正常运行\n2. 防火墙是否允许 UDP/TCP 端口 3478/5349\n3. 尝试刷新页面后重试';

                // 移动端网络抖动时 failed 也可能是暂时的，先尝试重启 ICE 恢复
                this._tryRestartIce();
            }
        };

        // 🔧 新增：监听 PeerConnection 整体状态
        this.peerConnection.onconnectionstatechange = () => {
            // 🔧 不再对 disconnected 直接挂断；交给统一处理：断线等待恢复、失败先重启 ICE
            this._handlePeerConnectionState(this.peerConnection.connectionState);
        };

        // 🔧 关键修复：接收远程媒体
        this.peerConnection.ontrack = (event) => {
            console.log('🎬 收到远程轨道:', {
                kind: event.track.kind,
                streams: event.streams.length,
                trackId: event.track.id,
                readyState: event.track.readyState
            });

            if (!event.streams || event.streams.length === 0) {
                console.warn('⚠️ 收到轨道但无关联流');
                return;
            }

            // 🔧 关键修复：保存轨道引用
            remoteTracks.set(event.track.kind, {
                track: event.track,
                stream: event.streams[0]
            });

            const remoteStream = event.streams[0];
            this.remoteStream = remoteStream;

            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');

            // 🔧 关键修复：视频轨道处理 - 延迟设置 srcObject，避免中断
            if (event.track.kind === 'video' && remoteVideo && this.callType === 'video') {
                console.log('📹 收到视频轨道，准备设置远程视频流');

                // 🔧 等待一小段时间，确保音频也已设置（如果有的话）
                setTimeout(() => {
                    if (!this.videoStreamSet && remoteVideo.srcObject !== remoteStream) {
                        console.log('📹 设置远程视频流到 video 元素');
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.classList.remove('hidden');
                        remoteVideo.playsInline = true;
                        remoteVideo.autoplay = true;
                        remoteVideo.muted = false;
                        this.videoStreamSet = true;  // 🔧 只标记视频已设置
                        this.remoteStreamSet = true;

                        this.playVideoElement(remoteVideo).then(() => {
                            console.log('✅ 远程视频播放成功');
                        }).catch(err => {
                            console.error('❌ 远程视频播放失败:', err);
                            // 🔧 不要立即显示错误，给一些缓冲时间
                            setTimeout(() => {
                                if (remoteVideo.readyState < 3) {
                                    this.showToast('🎥 视频加载中，请稍候...', 'info');
                                }
                            }, 1000);
                        });
                    } else {
                        console.log('⏭️ 视频流已设置或正在设置，跳过');
                    }
                }, 100);
            }

            // 🔧 关键修复：音频轨道处理
            if (event.track.kind === 'audio' && remoteAudio) {
                console.log('🔊 收到音频轨道，准备设置远程音频流');

                // 🔧 音频可以立即设置
                if (!this.audioStreamSet && remoteAudio.srcObject !== remoteStream) {
                    console.log('🔊 设置远程音频流到 audio 元素');
                    remoteAudio.srcObject = remoteStream;
                    remoteAudio.autoplay = true;
                    remoteAudio.muted = false;
                    this.audioStreamSet = true;  // 🔧 只标记音频已设置
                    this.remoteStreamSet = true;

                    this.playAudioElement(remoteAudio).then(() => {
                        console.log('✅ 远程音频播放成功');
                    }).catch(err => {
                        console.error('❌ 远程音频播放失败:', err);
                        this.showToast('🔊 音频加载失败，请点击页面启用音频', 'info');
                    });
                } else {
                    console.log('⏭️ 音频流已设置或正在设置，跳过');
                }
            }
        };


        return this.peerConnection;
    },


    setupPeerConnection(iceServers = null) {
        if (!iceServers || !Array.isArray(iceServers) || iceServers.length === 0) {
            console.warn('⚠️ [RTC] 未提供 ICE 服务器，使用降级配置');
            iceServers = [
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            ];
        }

        const iceInfo = iceServers.map(s => ({
            urls: s.urls,
            hasAuth: !!s.username,
            transport: s.urls.includes('transport=') ? s.urls.split('transport=')[1] : 'default'
        }));
        console.log('🔧 [RTC] PeerConnection config:', JSON.stringify(iceInfo, null, 2));

        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        });

        // 🔧 关键修复：跟踪已设置的远程流
        this.remoteStreamSet = false;
        this.audioStreamSet = false;  // 🔧 新增：单独跟踪音频
        this.videoStreamSet = false;  // 🔧 新增：单独跟踪视频

        // 🔧 关键修复：立即添加本地流（必须在设置事件处理器之前）
        if (this.localStream) {
            console.log('📤 [SETUP] 添加本地媒体轨道:', this.localStream.getTracks().length);
            this.localStream.getTracks().forEach(track => {
                try {
                    this.peerConnection.addTrack(track, this.localStream);
                    console.log('  ✅ [SETUP] 已添加轨道:', track.kind, track.label, 'enabled:', track.enabled);
                } catch (err) {
                    console.error('  ❌ [SETUP] 添加轨道失败:', track.kind, err);
                }
            });
        }


        // 🔧 关键修复：收集所有远程轨道，等待完整流后再设置
        const remoteTracks = new Map(); // track.kind -> track

        const sentCandidates = new Set();

        this.peerConnection.onicecandidate = (event) => {
            if (!event.candidate || this.callWs?.readyState !== WebSocket.OPEN) return;

            const cand = event.candidate;
            const key = `${cand.sdpMid}:${cand.sdpMLineIndex}:${cand.candidate?.substring(0, 50)}`;

            if (!sentCandidates.has(key)) {
                sentCandidates.add(key);

                // 🔧 关键修复：将 RTCIceCandidate 转换为普通对象
                const candidateData = {
                    candidate: cand.candidate,
                    sdpMid: cand.sdpMid,
                    sdpMLineIndex: cand.sdpMLineIndex,
                    usernameFragment: cand.usernameFragment
                };
                this.callWs.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: candidateData,  // 🔧 使用普通对象而不是 RTCIceCandidate
                    room_id: this.callRoomId,
                    to: this.pendingCallerId
                }));
                console.log('📤 [ICE] Sent candidate:', cand.type, cand.address ? cand.address.substring(0, 20) : 'unknown');
            }
        };

        // 🔧 替换原有的 oniceconnectionstatechange 逻辑
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 [ICE Connection State]:', state);

            // 清除超时定时器
            if (this.iceTimeoutTimer) {
                clearTimeout(this.iceTimeoutTimer);
                this.iceTimeoutTimer = null;
            }

            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE 连接成功，媒体通道已打通');
                if (!this.callStartTime) {
                    this.callStartTime = Date.now();
                    console.log('⏱️ 通话开始时间已记录');
                }
                if (this.callState !== 'connected') {
                    this.callState = 'connected';
                    this.updateCallUI('connected');
                    this.startCallDurationTimer();
                    this.stopCallerRingtone();
                    this.stopRingtone();
                }
            }

            if (state === 'failed') {
                console.error('❌ ICE 连接失败，详细诊断信息:');

                // 🔧 新增：尝试自动重启 ICE（挽救网络抖动）
                if (this.peerConnection.canTrickleIceCandidates) {
                    console.warn('🔄 尝试 ICE Restart 恢复连接...');
                    this.peerConnection.restartIce();
                    // 重启后重新设置超时
                    this.iceTimeoutTimer = setTimeout(() => {
                        if (this.peerConnection.iceConnectionState !== 'connected') {
                            this.showError('网络连接失败。建议检查运营商网络或切换 WiFi/5G 后重试');
                            this.endCall();
                        }
                    }, 15000);
                } else {
                    this.showError('网络连接失败。请检查防火墙或 TURN 服务器状态');
                    this.endCall();
                }
            }
        };

        /// 🔧 关键修复：增强 ICE 错误处理
        this.peerConnection.onicecandidateerror = (event) => {
            const url = event.url || 'unknown';
            const errorCode = event.errorCode;
            const errorText = event.errorText || 'Unknown error';

            // 🔧 过滤掉非关键错误（如 TURNS 连接失败但 TURN 可用）
            if (errorCode === 701 && url.includes('turns:')) {
                console.warn('⚠️ [ICE] TURNS 连接失败，尝试其他传输方式:', {
                    url: url,
                    errorCode: errorCode,
                    errorText: errorText
                });
                // 不显示错误提示，因为可能有其他可用的 TURN 服务器
            } else if (errorCode !== 0) {
                console.error('❌ [ICE] Candidate 错误:', {
                    url: url,
                    errorCode: errorCode,
                    errorText: errorText
                });
            }
        };


        // 🔧 新增：监听 PeerConnection 整体状态
        this.peerConnection.onconnectionstatechange = () => {
            // 🔧 不再对 disconnected 直接挂断；交给统一处理：断线等待恢复、失败先重启 ICE
            this._handlePeerConnectionState(this.peerConnection.connectionState);
        };

        // 🔧 关键修复：接收远程媒体
        this.peerConnection.ontrack = (event) => {
            console.log('🎬 收到远程轨道:', {
                kind: event.track.kind,
                streams: event.streams.length,
                trackId: event.track.id,
                readyState: event.track.readyState
            });

            if (!event.streams || event.streams.length === 0) {
                console.warn('⚠️ 收到轨道但无关联流');
                return;
            }

            // 🔧 关键修复：保存轨道引用
            remoteTracks.set(event.track.kind, {
                track: event.track,
                stream: event.streams[0]
            });

            const remoteStream = event.streams[0];
            this.remoteStream = remoteStream;

            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');

            // 🔧 关键修复：视频轨道处理 - 延迟设置 srcObject，避免中断
            if (event.track.kind === 'video' && remoteVideo && this.callType === 'video') {
                console.log('📹 收到视频轨道，准备设置远程视频流');

                // 🔧 等待一小段时间，确保音频也已设置（如果有的话）
                setTimeout(() => {
                    if (!this.videoStreamSet && remoteVideo.srcObject !== remoteStream) {
                        console.log('📹 设置远程视频流到 video 元素');
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.classList.remove('hidden');
                        remoteVideo.playsInline = true;
                        remoteVideo.autoplay = true;
                        remoteVideo.muted = false;
                        this.videoStreamSet = true;  // 🔧 只标记视频已设置
                        this.remoteStreamSet = true;

                        this.playVideoElement(remoteVideo).then(() => {
                            console.log('✅ 远程视频播放成功');
                        }).catch(err => {
                            console.error('❌ 远程视频播放失败:', err);
                            // 🔧 不要立即显示错误，给一些缓冲时间
                            setTimeout(() => {
                                if (remoteVideo.readyState < 3) {
                                    this.showToast('🎥 视频加载中，请稍候...', 'info');
                                }
                            }, 1000);
                        });
                    } else {
                        console.log('⏭️ 视频流已设置或正在设置，跳过');
                    }
                }, 100);
            }

            // 🔧 关键修复：音频轨道处理
            if (event.track.kind === 'audio' && remoteAudio) {
                console.log('🔊 收到音频轨道，准备设置远程音频流');

                // 🔧 音频可以立即设置
                if (!this.audioStreamSet && remoteAudio.srcObject !== remoteStream) {
                    console.log('🔊 设置远程音频流到 audio 元素');
                    remoteAudio.srcObject = remoteStream;
                    remoteAudio.autoplay = true;
                    remoteAudio.muted = false;
                    this.audioStreamSet = true;  // 🔧 只标记音频已设置
                    this.remoteStreamSet = true;

                    this.playAudioElement(remoteAudio).then(() => {
                        console.log('✅ 远程音频播放成功');
                    }).catch(err => {
                        console.error('❌ 远程音频播放失败:', err);
                        this.showToast('🔊 音频加载失败，请点击页面启用音频', 'info');
                    });
                } else {
                    console.log('⏭️ 音频流已设置或正在设置，跳过');
                }
            }
        };


        return this.peerConnection;
    },

    // 🔧 新增：检查信令是否已处理
    isSignalProcessed(signalId) {
        if (!signalId) return false;

        const now = Date.now();
        // 清理过期的缓存
        for (const id of this.processedSignals) {
            if (now - parseInt(id.split('_')[0]) > this.signalCacheTimeout) {
                this.processedSignals.delete(id);
            }
        }

        return this.processedSignals.has(signalId);
    },

    // 🔧 新增：标记信令已处理
    markSignalProcessed(signalId) {
        if (signalId) {
            this.processedSignals.add(`${Date.now()}_${signalId}`);
        }
    },


    handleCallSignaling(data) {
        console.log('📡 [SIGNAL] 收到通话信令:', {
            type: data.type,
            from: data.from_user?.id || data.from_user_id,
            room_id: data.room_id,
            has_sdp: !!data.sdp
        });

        // 🔧 关键修复：生成信令唯一ID并去重
        const signalId = `${data.type}_${data.from_user_id || data.from_user?.id}_${data.room_id}_${Date.now()}`;
        if (this.isSignalProcessed(signalId)) {
            console.warn('⏭️ 忽略重复的信令:', signalId);
            return;
        }

        switch (data.type) {
            case 'call_offer':
                console.log('🔔 收到来电邀请');
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                this.handleIncomingCall(data); // ✅ 处理来电
                break;
            case 'call_answer':
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                this.handleCallAnswer(data);
                break;
            case 'ice_candidate_v1':
                if (this.peerConnection && data.candidate) {
                    console.log('📥 [ICE] 收到远程 candidate:', data.candidate);
                    try {
                        this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
                            .then(() => {
                                console.log('✅ [ICE] Candidate 添加成功');
                            })
                            .catch(err => {
                                console.error('❌ [ICE] Candidate 添加失败:', err);
                            });
                    } catch (err) {
                        console.error('❌ [ICE] 创建 RTCIceCandidate 失败:', err, data.candidate);
                    }
                }
                break;
            case 'ice_candidate':
                if (this.peerConnection && data.candidate) {
                    console.log('📥 [ICE] 收到远程 candidate:', data.candidate);
                    // 🔧 关键修复：使用安全队列注入，替代直接 addIceCandidate
                    this.addIceCandidateSafe(data.candidate);
                }
                break;
            case 'call_end':
                // 🔧 关键修复：防止重复处理 call_end 信令
                if (this.callState === 'idle') {
                    console.log('⏭️ 忽略重复的 call_end 信令（当前状态已是 idle）');
                    return;
                }
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                console.log('❌ 通话已结束（对方挂断）');
                // 🔧 关键修复：先关闭来电弹窗（如果是被叫方）
                this.closeIncomingCallModal();
                // 🔧 关键修复：收到 call_end 时只清理本地资源，不再发送信令
                this.endCall(true);  // 🔧 传参 skipSignal=true，避免重复发送
                this.showSuccess('通话已结束');
                break;
            case 'call_reject':
                console.log('❌ 通话被拒绝');
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                // 🔧 关键修复：关闭弹窗并提示
                this.closeIncomingCallModal();
                this.endCall(true);  // 拒绝时不发送 call_end
                this.showSuccess('对方已拒绝通话');
                break;
            case 'call_missed':  // 🔧 新增：处理未接听信令
                console.log('⏱️ 通话未接听');
                this.markSignalProcessed(signalId);  // 🔧 标记已处理
                // 🔧 关键修复：关闭弹窗并提示
                this.closeIncomingCallModal();
                this.endCall(true);  // 未接听时不发送 call_end
                this.showToast('对方未接听', 'info');
                break;
        }
    },

    // chat.js - ChatClient 类中替换原有方法
    async handleIncomingCall(offerData) {
        console.log('📞 处理来电邀请:', offerData);

        if (this.callState !== 'idle') {
            console.warn('⚠️ 当前已有通话，拒绝新来电');
            if (this.callWs?.readyState === WebSocket.OPEN) {
                this.callWs.send(JSON.stringify({
                    type: 'call_reject',
                    room_id: offerData.room_id,
                    reason: 'busy'
                }));
            }
            return;
        }

        // 🔧 关键修复：正确解析 SDP
        const sdpData = offerData.data?.sdp || offerData.sdp;
        const sdpType = offerData.data?.type || 'offer';

        if (!sdpData || !sdpType) {
            console.error('❌ 来电邀请 SDP 数据无效');
            return;
        }

        // 🔧 关键修复1: 确保 room_id 是数字类型
        const roomId = parseInt(offerData.room_id);
        if (!roomId || isNaN(roomId)) {
            console.error('❌ 无效的聊天室 ID:', offerData.room_id);
            this.showError('无效的通话请求');
            return;
        }

        // 🔧 关键修复2: 缓存关键数据（解决 undefined 问题）
        this.pendingOffer = offerData.data?.sdp || offerData.sdp;
        this.incomingOffer = this.pendingOffer;  // 备用字段
        this.pendingCallerId = offerData.from_user?.id || offerData.from_user_id || offerData.from?.id;
        this.callType = offerData.media_type || 'audio';
        this.callRoomId = roomId;  // ✅ 确保是数字
        this.callState = 'ringing';

        // 🔧 关键修复：启用通话保护
        this.isCallInProgress = true;
        console.log('🔒 通话保护已启用（接听方）');

        // 🔧 关键修复：重置 answer 处理标志（新通话）
        this.answerProcessed = false;

        console.log('✅ 缓存来电数据:', {
            pendingOffer: !!this.pendingOffer,
            pendingCallerId: this.pendingCallerId,
            callType: this.callType
        });

        // 🔧 关键修复3: 【新增】接收方先连接信令通道
        try {
            await this.connectCallWebSocket();
            console.log('✅ 接收方信令通道已连接');
        } catch (err) {
            console.error('❌ 连接信令通道失败:', err);
            this.showError('无法建立通话连接');
            this.callState = 'idle';
            return;
        }

        // 🔧 关键：来电时也获取 TURN 凭证
        const turnConfig = await this.fetchTurnCredentials();
        console.log('🔧 [RTC] 获取 TURN 配置:', turnConfig);

        // 🔧 关键修复3: 准备 PeerConnection（不获取媒体流，等用户接听后再获取）
        this.setupPeerConnectionForAnswer(turnConfig.iceServers);

        // 🔧 关键修复4: 显示来电弹窗
        this.showIncomingCallModal(offerData);

        // 🔧 关键修复5: 播放来电铃声（可选）
        this.playRingtone();

        // 🔧 新增：启动60秒超时定时器
        this.callTimeoutTimer = setTimeout(() => {
            console.log('⏱️ 来电超时60秒，自动挂断');
            if (this.callState === 'ringing') {
                this.showToast('对方未接听，已自动挂断', 'info');
                // 🔧 关键修复：超时时应该发送 call_missed 而不是 call_reject
                this.handleCallMissed(offerData);
            }
        }, 60000); // 60秒超时
    },

    // chat.js - ChatClient 类中添加此方法
    // chat.js - ChatClient 类中添加此方法
    setupPeerConnectionForAnswer(iceServers = null) {
        console.log('🔧 setupPeerConnectionForAnswer 初始化');

        if (!iceServers || !Array.isArray(iceServers) || iceServers.length === 0) {
            iceServers = [
                {urls: 'stun:stun.l.google.com:19302'},
                {urls: 'stun:stun1.l.google.com:19302'}
            ];
        }

        this.peerConnection = new RTCPeerConnection({
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        });

        // 🔧 关键修复：跟踪已设置的远程流，避免重复设置
        this.remoteStreamSet = false;
        this.audioStreamSet = false;  // 🔧 新增
        this.videoStreamSet = false;  // 🔧 新增

        // 🔧 关键修复：ICE candidate 收集标志
        this.iceCandidatesCollected = [];

        // ICE Candidate 交换
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('📤 收集 ICE candidate:', event.candidate.type);
                this.iceCandidatesCollected.push(event.candidate);

                // 🔧 关键修复：立即发送每个 candidate（trickle ICE）
                if (this.callWs?.readyState === WebSocket.OPEN) {
                    // 🔧 将 RTCIceCandidate 转换为普通对象
                    const candidateData = {
                        candidate: event.candidate.candidate,
                        sdpMid: event.candidate.sdpMid,
                        sdpMLineIndex: event.candidate.sdpMLineIndex,
                        usernameFragment: event.candidate.usernameFragment
                    };

                    this.callWs.send(JSON.stringify({
                        type: 'ice_candidate',
                        candidate: candidateData,  // 🔧 使用普通对象而不是 RTCIceCandidate
                        room_id: this.callRoomId,
                        to: this.pendingCallerId
                    }));
                }
            } else {
                // ICE candidate 收集完成
                console.log('✅ ICE candidate 收集完成，共', this.iceCandidatesCollected.length, '个');
            }
        };

        // 🔧 关键修复：接收远程媒体
        const remoteTracks = new Map();

        this.peerConnection.ontrack = (event) => {
            console.log('🎬 收到远程轨道:', {
                kind: event.track.kind,
                streams: event.streams.length,
                trackId: event.track.id,
                readyState: event.track.readyState
            });

            if (!event.streams || event.streams.length === 0) {
                console.warn('⚠️ 收到轨道但无关联流');
                return;
            }

            remoteTracks.set(event.track.kind, {
                track: event.track,
                stream: event.streams[0]
            });

            const remoteStream = event.streams[0];
            this.remoteStream = remoteStream;

            const remoteVideo = document.getElementById('remoteVideo');
            const remoteAudio = document.getElementById('remoteAudio');

            // 🔧 关键修复：视频轨道处理 - 延迟设置 srcObject
            if (event.track.kind === 'video' && remoteVideo && this.callType === 'video') {
                console.log('📹 收到视频轨道，准备设置远程视频流');

                setTimeout(() => {
                    if (!this.videoStreamSet && remoteVideo.srcObject !== remoteStream) {
                        console.log('📹 设置远程视频流到 video 元素');
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.classList.remove('hidden');
                        remoteVideo.playsInline = true;
                        remoteVideo.autoplay = true;
                        remoteVideo.muted = false;
                        this.videoStreamSet = true;  // 🔧 只标记视频已设置
                        this.remoteStreamSet = true;

                        this.playVideoElement(remoteVideo).then(() => {
                            console.log('✅ 远程视频播放成功');
                        }).catch(err => {
                            console.error('❌ 远程视频播放失败:', err);
                            setTimeout(() => {
                                if (remoteVideo.readyState < 3) {
                                    this.showToast('🎥 视频加载中，请稍候...', 'info');
                                }
                            }, 1000);
                        });
                    } else {
                        console.log('⏭️ 视频流已设置或正在设置，跳过');
                    }
                }, 100);
            }

            // 🔧 关键修复：音频轨道处理
            if (event.track.kind === 'audio' && remoteAudio) {
                console.log('🔊 收到音频轨道，准备设置远程音频流');

                if (!this.audioStreamSet && remoteAudio.srcObject !== remoteStream) {
                    console.log('🔊 设置远程音频流到 audio 元素');
                    remoteAudio.srcObject = remoteStream;
                    remoteAudio.autoplay = true;
                    remoteAudio.muted = false;
                    this.audioStreamSet = true;  // 🔧 只标记音频已设置
                    this.remoteStreamSet = true;

                    this.playAudioElement(remoteAudio).then(() => {
                        console.log('✅ 远程音频播放成功');
                    }).catch(err => {
                        console.error('❌ 远程音频播放失败:', err);
                        this.showToast('🔊 音频加载失败，请点击页面启用音频', 'info');
                    });
                } else {
                    console.log('⏭️ 音频流已设置或正在设置，跳过');
                }
            }
        };

        // 连接状态监控
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('🧊 [ICE Connection State]:', state);

            if (state === 'connected' || state === 'completed') {
                console.log('✅ ICE 连接成功，媒体通道已打通');
                // 🔧 关键修复：只有在 ICE 连接成功后才更新 UI 为 connected
                if (this.callState !== 'connected') {
                    this.callState = 'connected';

                    // 🔧 关键修复：在 ICE 连接成功时才记录通话开始时间
                    if (!this.callStartTime) {
                        this.callStartTime = Date.now();
                        console.log('⏱️ 通话开始时间:', new Date(this.callStartTime).toLocaleTimeString());
                    }

                    // 🔧 新增：启动通话时长定时器
                    this.startCallDurationTimer();

                    // 🔧 新增：停止铃声（接听方）
                    this.stopRingtone();
                    // 🔧 新增：停止呼叫方铃声（如果是发起方）
                    this.stopCallerRingtone();

                    this.updateCallUI('connected');
                    console.log('✅ 通话已完全建立');
                }
            }

            if (state === 'failed') {
                console.error('❌ ICE 连接失败，尝试重启 ICE 恢复...');
                this._tryRestartIce();
            }
        };


        this.peerConnection.onconnectionstatechange = () => {
            // 接听方同样使用统一的恢复逻辑：断线不挂断、失败先重启 ICE
            this._handlePeerConnectionState(this.peerConnection.connectionState);
        };

        console.log('✅ setupPeerConnectionForAnswer 初始化完成');
        return this.peerConnection;
    },


    // 🔧 优化后的来电弹窗显示方法
    showIncomingCallModal(offerData) {
        // 先关闭可能存在的旧弹窗
        if (this.incomingCallModal?.parentNode) {
            this.incomingCallModal.remove();
        }

        const callerName = offerData.from_user?.real_name ||
            offerData.from_user?.username ||
            offerData.from_username ||
            '未知用户';

        const callerAvatar = offerData.from_user?.avatar_url ||
            offerData.from_avatar_url ||
            '/static/images/default-avatar.png';

        const callTypeText = offerData.media_type === 'video' ? '视频通话' : '语音通话';
        const callTypeIcon = offerData.media_type === 'video' ? 'fa-video' : 'fa-phone';

        const modal = document.createElement('div');
        modal.className = 'incoming-call-modal show';
        modal.id = 'incomingCallModal';
        modal.style.zIndex = '9999';  // 🔧 确保在最上层

        modal.innerHTML = `
        <div class="modal-backdrop" onclick="chatClient.rejectCallByBackdrop()"></div>
        <div class="modal-content">
            <button class="modal-close" onclick="chatClient.rejectCallByBackdrop()" title="关闭">
                <i class="fas fa-times"></i>
            </button>
            
            <div class="caller-avatar">
                <img src="${callerAvatar}" alt="${callerName}" 
                     onerror="this.src='/static/images/default-avatar.png'">
            </div>
            
            <p class="caller-name">${this.escapeHtml(callerName)}</p>
            
            <p class="call-type">
                <i class="fas ${callTypeIcon}"></i>
                ${callTypeText}
            </p>
            
            <p class="call-tip">
                <i class="fas fa-ring"></i> 正在呼叫您...
            </p>
            
            <div class="call-actions">
                <button class="btn btn-reject" id="rejectCallBtn" data-label="拒绝">
                    <i class="fas fa-phone-slash"></i>
                </button>
                <button class="btn btn-accept" id="acceptCallBtn" data-label="接听">
                    <i class="fas fa-phone"></i>
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);
        this.incomingCallModal = modal;

        // 绑定事件
        const acceptBtn = document.getElementById('acceptCallBtn');
        const rejectBtn = document.getElementById('rejectCallBtn');

        if (acceptBtn) {
            acceptBtn.onclick = (e) => {
                e.stopPropagation();
                this.acceptCall(offerData);
            };
        }

        if (rejectBtn) {
            rejectBtn.onclick = (e) => {
                e.stopPropagation();
                this.rejectCall(offerData);
            };
        }

        // 点击背景拒绝
        modal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
            this.rejectCall(offerData);
        });

        // ESC 键拒绝
        this._incomingCallKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this.rejectCall(offerData);
            }
        };
        document.addEventListener('keydown', this._incomingCallKeyHandler);

        console.log('✅ 来电弹窗已显示');
    },

    // 🔧 新增：点击背景拒绝来电
    rejectCallByBackdrop() {
        if (this.incomingCallModal) {
            const offerData = {
                room_id: this.callRoomId,
                from_user_id: this.pendingCallerId
            };
            this.rejectCall(offerData);
        }
    },


    // chat.js - ChatClient 类中替换原有方法
    async acceptCall(offerData) {
        console.log('✅ 用户点击接听');

        if (this.callState !== 'ringing') {
            console.warn('⚠️ 当前状态不可接听:', this.callState);
            return;
        }

        try {
            this.stopRingtone();

            // 确保用户已交互（解锁媒体权限）
            if (!this.userHasInteracted) {
                this.userHasInteracted = true;
                [this.audioContext, this.audioContextForMobile]
                    .filter(ctx => ctx && ctx.state === 'suspended')
                    .forEach(ctx => ctx.resume().catch(() => {
                    }));
            }

            this.setupRemoteMediaElements();
            this.setupLocalMediaElements();

            // 🔧 关键修复1: 获取 TURN 凭证
            const turnConfig = await this.fetchTurnCredentials();

            // 🔧 关键修复：如果 PeerConnection 不存在，才创建新的
            if (!this.peerConnection) {
                console.log('🔧 PeerConnection 不存在，创建新的');
                this.setupPeerConnectionForAnswer(turnConfig.iceServers);
            } else {
                console.log('✅ 复用已有的 PeerConnection');
            }

            // 🔧 关键修复2: 获取本地媒体流（接听前先确保推送通知已订阅）
            const constraints = {
                audio: true,
                video: this.callType === 'video' ? {
                    facingMode: 'user',
                    width: {ideal: 1280},
                    height: {ideal: 720}
                } : false
            };
            if ('Notification' in window && Notification.permission !== 'granted') {
                try {
                    await Notification.requestPermission();
                } catch (e) {
                }
            }
            this.ensurePushSubscribed();

            try {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (e) {
                console.error('❌ 获取媒体失败:', e);
                if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
                    this.showError('无法使用摄像头/麦克风：请在浏览器地址栏点击锁图标 → 网站设置 → 允许摄像头和麦克风。');
                } else {
                    this.showError('无法获取摄像头/麦克风权限：' + (e && (e.message || e.name) || e));
                }
                this.closeIncomingCallModal();
                this.endCall();
                return;
            }

            // 🔧 关键修复：不在这里记录 callStartTime，等 ICE 连接成功后再记录
            // this.callStartTime = Date.now();  // ❌ 删除这行

            // 显示本地预览
            const localVideo = document.getElementById('localVideo');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                if (this.callType === 'video') localVideo.classList.remove('hidden');
            }

            // 🔧 关键修复3: 处理 Offer - 必须先设置 RemoteDescription
            const offer = this.pendingOffer || this.incomingOffer;
            if (!offer) throw new Error('未找到有效的 SDP offer');

            console.log('🔧 设置 RemoteDescription (offer)');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

            // 🔧 关键修复：设置 RemoteDescription 后立即启用 ICE candidate 队列
            this.isRemoteDescriptionSet = true;
            // 清空已缓存的 ICE 候选（offer SDP 处理前到达的）
            if (this.pendingIceCandidates.length > 0) {
                console.log('🧊 处理已缓存的 ICE 候选:', this.pendingIceCandidates.length);
                for (const cand of this.pendingIceCandidates) {
                    try {
                        await this.peerConnection.addIceCandidate(cand);
                    } catch (e) {
                        console.warn('⚠️ 注入缓存的 ICE 候选失败:', e);
                    }
                }
                this.pendingIceCandidates = [];
            }

            // 🔧 关键修复4: 在设置 RemoteDescription 之后、创建 Answer 之前添加本地轨道
            if (this.localStream) {
                console.log('🎬 添加本地轨道到 PeerConnection');

                // 🔧 关键修复：验证所有轨道都处于启用状态
                this.localStream.getTracks().forEach(track => {
                    if (!track.enabled) {
                        console.warn('⚠️ 轨道被禁用，重新启用:', track.kind);
                        track.enabled = true;
                    }
                    console.log('✅ 本地轨道状态:', {
                        kind: track.kind,
                        enabled: track.enabled,
                        muted: track.muted,
                        readyState: track.readyState,
                        label: track.label
                    });

                    try {
                        this.peerConnection.addTrack(track, this.localStream);
                        console.log('  ✅ 已添加轨道:', track.kind, track.label);
                    } catch (err) {
                        console.error('  ❌ 添加轨道失败:', track.kind, err);
                    }
                });
            } else {
                console.error('❌ localStream 为空，无法添加本地轨道');
                throw new Error('本地媒体流为空');
            }

            // 🔧 关键修复5: 创建并设置 Answer
            console.log('🔧 创建 Answer');
            const answer = await this.peerConnection.createAnswer();
            console.log('🔧 设置 LocalDescription (answer)');
            await this.peerConnection.setLocalDescription(answer);

            // 🔧 关键修复6: 发送 Answer 信令
            if (this.callWs?.readyState === WebSocket.OPEN) {
                this.callWs.send(JSON.stringify({
                    type: 'call_answer',
                    sdp: answer,
                    room_id: this.callRoomId,
                    from: this.currentUser.id,
                    to: this.pendingCallerId
                }));
                console.log('📤 已发送 call_answer 信令');
            } else {
                throw new Error('信令通道未就绪');
            }

            // 更新状态
            this.callState = 'connecting';  // 🔧 改为 connecting，等 ICE 连接成功后再改为 connected
            this.updateCallUI('connecting');
            this.closeIncomingCallModal();

            console.log('✅ 接听流程完成，等待 ICE 连接建立');

        } catch (err) {
            console.error('❌ 接听通话失败:', err);
            this.showError(`接听失败: ${err.message || '请检查麦克风/摄像头权限'}`);
            if (err.name === 'NotAllowedError') {
                this.showError('请允许访问麦克风/摄像头权限');
            }
            this.stopRingtone();
            this.closeIncomingCallModal();
            this.endCall();
        }
    },


    // 🔧 新增：关闭来电弹窗
    closeIncomingCallModal() {
        if (this.incomingCallModal?.parentNode) {
            this.incomingCallModal.remove();
            this.incomingCallModal = null;
        }
        // 移除键盘监听
        if (this._incomingCallKeyHandler) {
            document.removeEventListener('keydown', this._incomingCallKeyHandler);
            this._incomingCallKeyHandler = null;
        }
    },

    // chat.js - ChatClient 类中添加/替换此方法
    async rejectCall(offerData) {
        console.log('❌ 用户拒绝来电');

        // 🔧 关键修复1: 停止铃声
        this.stopRingtone();

        // 🔧 关键修复2: 发送拒绝信令（包含reason字段）
        if (this.callWs?.readyState === WebSocket.OPEN) {
            try {
                this.callWs.send(JSON.stringify({
                    type: 'call_reject',
                    room_id: offerData?.room_id || this.callRoomId,
                    from_user_id: this.currentUser.id,  // 🔧 修复：使用from_user_id而不是from
                    to: this.pendingCallerId,
                    reason: 'rejected',  // 🔧 新增：明确标识拒绝原因
                    media_type: this.callType || 'audio'  // 🔧 新增：通话类型
                }));
                console.log('📤 已发送 call_reject 信令');
            } catch (e) {
                console.warn('⚠️ 发送拒绝信令失败:', e);
            }
        }

        // 🔧 关键修复3: 清理资源
        this.closeIncomingCallModal();

        // 🔧 关键修复4: 关闭可能已创建的 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // 🔧 关键修复5: 重置状态
        this.callState = 'idle';
        this.pendingOffer = null;
        this.pendingCallerId = null;
        this.incomingOffer = null;
        this.callRoomId = null;

        // 🔧 关键修复6: 不再调用 endCall(true)，而是让后端的 call_reject 处理
        // endCall(true);  // ❌ 删除这行，避免重复处理

        console.log('✅ 拒绝来电，资源已清理');
    },

    // 🔧 新增：处理未接听的通话
    async handleCallMissed(offerData) {
        console.log('⏱️ 通话未接听，超时自动挂断');

        // 🔧 关键修复1: 停止铃声
        this.stopRingtone();

        // 🔧 关键修复2: 发送未接听信令
        if (this.callWs?.readyState === WebSocket.OPEN) {
            try {
                this.callWs.send(JSON.stringify({
                    type: 'call_missed',
                    room_id: offerData?.room_id || this.callRoomId,
                    from_user_id: this.currentUser.id,
                    to: this.pendingCallerId,
                    reason: 'missed',
                    media_type: this.callType || 'audio'
                }));
                console.log('📤 已发送 call_missed 信令');
            } catch (e) {
                console.warn('⚠️ 发送未接听信令失败:', e);
            }
        }

        // 🔧 关键修复3: 清理资源
        this.closeIncomingCallModal();

        // 🔧 关键修复4: 关闭可能已创建的 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // 🔧 关键修复5: 重置状态
        this.callState = 'idle';
        this.pendingOffer = null;
        this.pendingCallerId = null;
        this.incomingOffer = null;
        this.callRoomId = null;

        console.log('✅ 未接听通话，资源已清理');
    },

    // 🔧 修复 handleCallAnswer 方法 - 正确处理 SDP 数据
    async handleCallAnswer(data) {
        console.log('📥 处理接听信令:', data);

        if (!this.peerConnection) {
            console.warn('⚠️ peerConnection 未初始化');
            return;
        }

        // 🔧 关键修复：防止重复处理 answer
        if (this.answerProcessed) {
            console.warn('⚠️ Answer 已处理过，忽略重复的 call_answer 信令');
            return;
        }

        try {
            // 🔧 关键修复: 正确解析嵌套的 SDP 数据
            const sdpData = data.data?.sdp || data.sdp;
            const sdpType = data.data?.type || 'answer';  // 默认类型为 answer

            if (!sdpData || !sdpType) {
                console.error('❌ SDP 数据无效');
                this.showError('对方接听失败，请重试');
                this.endCall();
                return;
            }

            // 🔧 关键修复: 正确构造 RTCSessionDescription
            const remoteDescription = new RTCSessionDescription({
                type: sdpType,  // 必须是 'answer'
                sdp: sdpData
            });

            console.log('🔧 设置 RemoteDescription:', {
                type: sdpType,
                currentState: this.peerConnection.signalingState,
                sdpLength: sdpData.length
            });

            await this.peerConnection.setRemoteDescription(remoteDescription);

            console.log('✅ RemoteDescription 设置成功');

            await this.drainIceCandidateQueue(); // 🔧 关键：注入缓存的候选

            // 🔧 关键修复：设置 ICE 超时保护（20秒未连通则提示）
            this.iceTimeoutTimer = setTimeout(() => {
                if (this.peerConnection.iceConnectionState !== 'connected' &&
                    this.peerConnection.iceConnectionState !== 'completed') {
                    console.warn('⏰ ICE 协商超时，当前状态:', this.peerConnection.iceConnectionState);

                    // 🔧 尝试重启 ICE
                    if (this.peerConnection.canTrickleIceCandidates) {
                        console.log('🔄 尝试重启 ICE 协商...');
                        this.peerConnection.restartIce();

                        // 🔧 如果重启后仍然失败，提示用户
                        setTimeout(() => {
                            if (this.peerConnection.iceConnectionState !== 'connected' &&
                                this.peerConnection.iceConnectionState !== 'completed') {
                                console.error('❌ ICE 重启后仍然无法连接');
                                this.showError('网络连接失败，请检查网络或稍后重试');
                                this.endCall();
                            }
                        }, 10000);  // 再等10秒
                    } else {
                        this.showError('网络连接失败。请检查：1. TURN服务器是否正常运行 2.防火墙是否允许 UDP/TCP端口 3478/5349 3. 尝试刷新页面后重试');
                        this.endCall();
                    }
                }
            }, 20000);  // 🔧 增加到20秒

            // 🔧 关键修复：标记 answer 已处理
            this.answerProcessed = true;

            // 🔧 关键修复：不在这里更新状态，等 ICE 连接成功后再更新
            // this.callState = 'connected';  // ❌ 删除这行
            // this.startCallDurationTimer();  // ❌ 删除这行

            console.log('⏳ 等待 ICE 连接建立...');

            // 🔧 关键修复: 恢复音频上下文（移动端必需）
            if (this.audioContextForMobile?.state === 'suspended') {
                await this.audioContextForMobile.resume();
            }

            console.log('✅ Answer 处理完成');

        } catch (err) {
            console.error('❌ handleCallAnswer 失败:', err);

            // 🔧 关键修复：区分不同类型的错误
            if (err.name === 'InvalidStateError') {
                console.warn('⚠️ SDP 状态错误，可能已收到 answer，忽略此错误');
                // 如果是因为重复设置导致的错误，不显示错误提示，也不结束通话
                // 因为第一次设置已经成功了，ICE 连接会正常建立
                return;
            }

            this.showError(`通话连接失败: ${err.message}`);
            this.endCall();
        }
    },


    async endCall_v1(skipSignal = false) {
        console.log('🔚 结束通话，当前状态:', this.callState);

        // 🔧 关键修复：避免重复执行
        if (this.callState === 'idle') {
            return;
        }

        // 🔧 新增：计算通话时长
        let callDuration = 0;
        if (this.callStartTime) {
            callDuration = Math.floor((Date.now() - this.callStartTime) / 1000); // 转换为秒
            console.log('⏱️ 通话时长:', callDuration, '秒', '(callStartTime:', new Date(this.callStartTime).toLocaleTimeString(), ')');
        } else {
            console.warn('⚠️ callStartTime 为空，通话未接通，时长将为0');
            console.log('🔍 当前状态:', {
                callState: this.callState,
                peerConnection: !!this.peerConnection,
                iceConnectionState: this.peerConnection?.iceConnectionState
            });
        }

        // 🔧 新增：停止通话时长定时器
        if (this.callDurationTimer) {
            clearInterval(this.callDurationTimer);
            this.callDurationTimer = null;
        }

        // 1. 停止媒体流
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log('🎤 已停止媒体轨道:', track.kind);
            });
            this.localStream = null;
        }

        // 2. 关闭 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.ontrack = null;
            this.peerConnection.onicecandidate = null;
            this.peerConnection.close();
            this.peerConnection = null;
            console.log('🔌 已关闭 RTCPeerConnection');
        }

        // 3. 🔧 关键修复：条件发送结束信令，包含通话时长信息
        if (!skipSignal && this.callWs?.readyState === WebSocket.OPEN) {
            try {
                const endMessage = {
                    type: 'call_end',
                    room_id: this.callRoomId,
                    from_user_id: this.currentUser.id,  // 🔧 当前用户就是发起方
                    duration: callDuration,  // 🔧 新增：通话时长（秒）
                    media_type: this.callType || 'audio'  // 🔧 新增：通话类型
                };
                console.log('📤 准备发送 call_end 信令:', JSON.stringify(endMessage));

                this.callWs.send(JSON.stringify(endMessage));
                console.log('✅ 已发送 call_end 信令，时长:', callDuration, '秒');
            } catch (e) {
                console.error('❌ 发送结束信令失败:', e.message);
            }
        } else {
            console.warn('⚠️ 跳过发送 call_end 信令: skipSignal=', skipSignal, ', callWs状态=', this.callWs?.readyState);
        }

        // 4. 关闭信令 WebSocket
        if (this.callWs) {
            if (this.callWs.readyState <= WebSocket.OPEN) {
                this.callWs.close(1000, 'Call ended');
            }
            this.callWs = null;
        }


        // 5. 重置状态
        this.callState = 'idle';
        this.callType = null;
        this.remoteStream = null;
        this.remoteStreamSet = false;  // 🔧 关键修复：重置远程流设置标志
        this.audioStreamSet = false;   // 🔧 新增：重置音频标志
        this.videoStreamSet = false;   // 🔧 新增：重置视频标志
        this.callRoomId = null;
        this.pendingOffer = null;
        this.pendingCallerId = null;

        // 🔧 新增：重置通话时长追踪
        this.callStartTime = null;

        // 🔧 关键修复：重置 answer 处理标志
        this.answerProcessed = false;

        // 🔧 关键修复：禁用通话保护
        this.isCallInProgress = false;
        console.log('🔓 通话保护已禁用');

        this.updateCallUI('idle');
        this.closeIncomingCallModal();
        this.stopRingtone(); // 🔧 确保停止铃声
        this.stopCallerRingtone(); // 🔧 新增：停止呼叫方铃声

        // 6. 清理 DOM
        const remoteVideo = document.getElementById('remoteVideo');
        const remoteAudio = document.getElementById('remoteAudio');
        const localVideo = document.getElementById('localVideo');

        [remoteVideo, remoteAudio, localVideo].forEach(el => {
            if (el) {
                el.srcObject = null;
                if (el.tagName === 'VIDEO') el.classList.add('hidden');
            }
        });

        console.log('✅ 通话资源已清理');

        // 🔧 重置控制按钮状态
        const muteBtn = document.getElementById('muteBtn');
        const cameraBtn = document.getElementById('cameraBtn');
        const speakerBtn = document.getElementById('speakerBtn');

        if (muteBtn) {
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            muteBtn.classList.remove('muted');
        }
        if (cameraBtn) {
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
            cameraBtn.classList.remove('off');
        }
        if (speakerBtn) {
            speakerBtn.classList.remove('active');
        }

        console.log('✅ 通话控制按钮已重置');

    },

    async endCall(skipSignal = false) {
        console.log('🔚 结束通话，当前状态:', this.callState, 'skipSignal:', skipSignal);
        if (this.callState === 'idle') return;

        let callDuration = 0;
        if (this.callStartTime) {
            callDuration = Math.floor((Date.now() - this.callStartTime) / 1000);
        }

        // 清除所有定时器
        [this.callDurationTimer, this.callTimeoutTimer].forEach(timer => {
            if (timer) {
                clearInterval(timer);
                clearTimeout(timer);
            }
        });
        this.callDurationTimer = null;
        this.callTimeoutTimer = null;

        // 停止媒体流
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        // 关闭 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.ontrack = null;
            this.peerConnection.onicecandidate = null;
            this.peerConnection.close();
            this.peerConnection = null;
        }

        // 发送结束信令（除非页面卸载已手动发送）
        if (!skipSignal && this.callWs?.readyState === WebSocket.OPEN) {
            try {
                this.callWs.send(JSON.stringify({
                    type: 'call_end',
                    room_id: this.callRoomId,
                    from_user_id: this.currentUser.id,
                    duration: callDuration,
                    media_type: this.callType || 'audio'
                }));
            } catch (e) {
                console.warn('发送 end 信令失败:', e);
            }
        }

        // 关闭信令通道
        if (this.callWs) {
            if (this.callWs.readyState <= WebSocket.OPEN) this.callWs.close(1000, 'Call ended');
            this.callWs = null;
        }

        // 🔑 重置所有状态标志
        this.callState = 'idle';
        this.callType = null;
        this.remoteStream = null;
        this.remoteStreamSet = false;
        this.audioStreamSet = false;
        this.videoStreamSet = false;
        this.callRoomId = null;
        this.pendingOffer = null;
        this.pendingCallerId = null;
        this.callStartTime = null;
        this.answerProcessed = false;
        this.isCallInProgress = false;

        // 🔧 重置 ICE 相关状态
        this.pendingIceCandidates = [];
        this.isRemoteDescriptionSet = false;
        this.iceCandidatesCollected = [];
        this.iceTimeoutTimer = null;
        if (this.iceRestartTimer) {
            clearTimeout(this.iceRestartTimer);
            this.iceRestartTimer = null;
        }
        if (this.iceRecoveryTimer) {
            clearTimeout(this.iceRecoveryTimer);
            this.iceRecoveryTimer = null;
        }
        this.processedSignals = new Set();

        this.updateCallUI('idle');
        this.closeIncomingCallModal();
        this.stopRingtone();
        this.stopCallerRingtone();

        // 清理 DOM 视频流
        ['remoteVideo', 'remoteAudio', 'localVideo'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.srcObject = null;
                if (el.tagName === 'VIDEO') el.classList.add('hidden');
            }
        });

        // 重置按钮 UI
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            muteBtn.classList.remove('muted');
        }
        const cameraBtn = document.getElementById('cameraBtn');
        if (cameraBtn) {
            cameraBtn.innerHTML = '<i class="fas fa-video"></i>';
            cameraBtn.classList.remove('off');
        }

        console.log('✅ 通话资源已完全清理');
    },

    // 🔧 新增：更新通话头部显示对方信息
    updateCallHeaderWithTargetInfo(targetUserId) {
        const targetUser = this.users?.find(u => u.id === targetUserId);
        if (!targetUser) {
            console.warn('⚠️ 未找到目标用户信息');
            return;
        }

        const statusText = document.getElementById('callStatusText');
        if (statusText) {
            statusText.textContent = `📞 正在呼叫: ${targetUser.real_name || targetUser.username}`;
        }

        // 🔧 可以在这里添加头像显示逻辑（如果需要）
        console.log('📞 正在呼叫:', targetUser.real_name || targetUser.username);
    },

    // 🔧 新增：播放呼叫方铃声（与接听方铃声区分）
    playCallerRingtone() {
        try {
            // 使用 Web Audio API 生成不同的提示音（高频短促声）
            if (!this.callerRingtoneContext) {
                this.callerRingtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const oscillator = this.callerRingtoneContext.createOscillator();
            const gainNode = this.callerRingtoneContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(1200, this.callerRingtoneContext.currentTime); // 更高频率

            // 创建“嘟嘟嘟”的节奏（每 1.5 秒响一次）
            const startTime = this.callerRingtoneContext.currentTime;
            for (let i = 0; i < 40; i++) {  // 循环 40 次，约 1 分钟
                const t = startTime + i * 1.5;
                gainNode.gain.setValueAtTime(0.2, t);
                gainNode.gain.setValueAtTime(0, t + 0.2);  // 更短的响声
            }

            oscillator.connect(gainNode);
            gainNode.connect(this.callerRingtoneContext.destination);

            oscillator.start();

            // 保存引用以便清理
            this.callerRingtoneOscillator = oscillator;

            console.log('🔔 呼叫方铃声响中（高频短促声）');
        } catch (e) {
            console.warn('🔔 呼叫方铃声失败:', e);
        }
    },

    // 🔧 新增：停止呼叫方铃声
    stopCallerRingtone() {
        if (this.callerRingtoneOscillator) {
            try {
                this.callerRingtoneOscillator.stop();
                this.callerRingtoneOscillator.disconnect();
            } catch (e) {
                // 可能已经停止
            }
            this.callerRingtoneOscillator = null;
        }

        if (this.callerRingtoneContext && this.callerRingtoneContext.state !== 'closed') {
            this.callerRingtoneContext.close().catch(() => {
            });
            this.callerRingtoneContext = null;
        }

        console.log('🔕 呼叫方铃声已停止');
    },

    // 🔧 新增：启动通话时长定时器
    startCallDurationTimer() {
        // 清除旧的定时器
        if (this.callDurationTimer) {
            clearInterval(this.callDurationTimer);
        }

        // 每秒更新一次通话时长显示
        this.callDurationTimer = setInterval(() => {
            if (this.callStartTime && this.callState === 'connected') {
                const duration = Math.floor((Date.now() - this.callStartTime) / 1000);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

                // 更新UI显示
                const callTimer = document.getElementById('callTimer');
                if (callTimer) {
                    callTimer.textContent = timeStr;
                    callTimer.classList.remove('hidden');
                    callTimer.style.display = 'block'; // 🔧 确保覆盖 .hidden 的 display: none !important
                }
            }
        }, 1000);

        console.log('⏱️ 通话时长定时器已启动');
    },


    // 辅助方法

    // 🔧 修复：playRingtone 方法 - 添加备用 Web Audio 方案
    playRingtone() {
        try {
            // 方案1: 尝试播放 MP3 文件
            if (!this.ringtoneAudio) {
                this.ringtoneAudio = new Audio('/static/sounds/ringtone.mp3');
                this.ringtoneAudio.loop = true;
                this.ringtoneAudio.volume = 0.6;
            }

            this.ringtoneAudio.play().catch(err => {
                console.warn('🔔 MP3 铃声播放失败，使用备用方案:', err);
                // 🔧 方案2: 使用 Web Audio API 生成提示音
                this.playRingtoneWithWebAudio();
            });
        } catch (e) {
            console.warn('🔔 铃声初始化失败，使用备用方案:', e);
            this.playRingtoneWithWebAudio();
        }
    },

    // 🔧 新增：Web Audio API 生成来电铃声（持续循环）
    playRingtoneWithWebAudio() {
        try {
            // 确保 AudioContext 已创建
            if (!this.ringtoneContext) {
                this.ringtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // 如果上下文被挂起，尝试恢复
            if (this.ringtoneContext.state === 'suspended') {
                this.ringtoneContext.resume().catch(() => {
                });
            }

            // 创建振荡器生成“嘟嘟”声
            const oscillator = this.ringtoneContext.createOscillator();
            const gainNode = this.ringtoneContext.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, this.ringtoneContext.currentTime); // A5 音符

            // 🔧 关键修复：创建持续循环的节奏（不再限制5秒）
            gainNode.gain.setValueAtTime(0, this.ringtoneContext.currentTime);

            const startTime = this.ringtoneContext.currentTime;
            // 🔧 循环120次，约1分钟（每次0.5秒）
            for (let i = 0; i < 120; i++) {
                const t = startTime + i * 0.5;
                gainNode.gain.setValueAtTime(0.3, t);
                gainNode.gain.setValueAtTime(0, t + 0.3);
            }

            oscillator.connect(gainNode);
            gainNode.connect(this.ringtoneContext.destination);

            oscillator.start();
            // 🔧 关键修复：不再设置 stop 时间，让铃声持续直到手动停止
            // oscillator.stop(startTime + 5); // ❌ 删除这行

            // 保存引用以便清理
            this.ringtoneOscillator = oscillator;

            console.log('✅ Web Audio 铃声播放中（持续循环）');
        } catch (e) {
            console.warn('🔔 Web Audio 铃声也失败:', e);
            // 最终降级：视觉提示
            this.showToast('📞 有来电', 'info');
        }
    },

    // 🔧 新增：停止铃声（清理资源）
    stopRingtone() {
        // 停止 MP3
        if (this.ringtoneAudio) {
            this.ringtoneAudio.pause();
            this.ringtoneAudio.currentTime = 0;
        }

        // 停止 Web Audio
        if (this.ringtoneOscillator) {
            try {
                this.ringtoneOscillator.stop();
                this.ringtoneOscillator.disconnect();
            } catch (e) {
                // 可能已经停止
            }
            this.ringtoneOscillator = null;
        }

        // 关闭 AudioContext（可选）
        if (this.ringtoneContext && this.ringtoneContext.state !== 'closed') {
            this.ringtoneContext.close().catch(() => {
            });
            this.ringtoneContext = null;
        }

        // 🔧 新增：清除超时定时器
        if (this.callTimeoutTimer) {
            clearTimeout(this.callTimeoutTimer);
            this.callTimeoutTimer = null;
            console.log('⏱️ 来电超时定时器已清除');
        }
    },


    // 🔧 新增：安全的视频播放方法
    async playVideoElement(videoElement) {
        if (!videoElement) return;

        try {
            // 确保必要属性
            videoElement.playsInline = true;
            videoElement.autoplay = true;
            videoElement.muted = false; // 取消静音以播放声音

            // 尝试播放
            await videoElement.play();
            console.log('✅ 视频播放成功');
        } catch (err) {
            // 🔧 降级方案1: 先静音播放
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                console.warn('⚠️ 尝试静音播放视频...');
                videoElement.muted = true;
                await videoElement.play();

                // 显示提示让用户取消静音
                this.showToast('🔇 视频已静音，点击取消静音', 'info');

                // 添加点击取消静音的功能
                videoElement.onclick = () => {
                    videoElement.muted = false;
                    videoElement.onclick = null;
                };
            } else {
                throw err;
            }
        }
    },

    // 🔧 新增：安全的音频播放方法
    async playAudioElement(audioElement) {
        if (!audioElement) return;

        try {
            await audioElement.play();
            console.log('✅ 音频播放成功');
        } catch (err) {
            // 音频播放需要用户交互，显示友好提示
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                console.warn('⚠️ 音频播放需要用户交互');
                this.showToast('🔊 请点击页面启用音频', 'info');

                // 添加一次性点击监听
                const enableAudio = () => {
                    audioElement.play().then(() => {
                        console.log('✅ 用户交互后音频播放成功');
                    }).catch(e => {
                        console.warn('⚠️ 音频播放仍失败:', e);
                    });
                    document.removeEventListener('click', enableAudio);
                    document.removeEventListener('touchstart', enableAudio);
                };

                document.addEventListener('click', enableAudio, {once: true});
                document.addEventListener('touchstart', enableAudio, {once: true});
            } else {
                throw err;
            }
        }
    },

    // 🔧 获取当前聊天目标用户 ID（支持群聊场景）
    getCurrentChatTargetUserId() {
        const room = this.chatRooms.find(r => r.id === parseInt(this.currentRoomId));
        if (!room) {
            console.warn('⚠️ 未找到聊天室');
            this.showError('请先选择一个聊天对象');
            return null;
        }

        // 🔧 关键修复：群聊时给予友好提示
        if (room.room_type === 'group') {
            console.warn('⚠️ 群聊暂不支持语音/视频通话');
            this.showConfirmDialog(
                '💡 功能提示',
                '当前版本暂不支持群组语音/视频通话，请选择私聊进行通话'
            ).then(() => {
                // 用户确认后关闭对话框
            });
            return null;
        }

        const other = room.members.find(m => m.id !== this.currentUser.id);
        return other ? other.id : null;
    },

    // 🔧 更新通话 UI 状态
    updateCallUI(state, callerId = null) {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) {
            console.warn('⚠️ callOverlay 元素未找到');
            return;
        }

        // 移除所有状态类
        overlay.classList.remove('calling', 'ringing', 'connected', 'hidden');

        // 添加当前状态类
        if (state === 'idle') {
            overlay.classList.add('hidden');
        } else {
            overlay.classList.add(state);
        }

        // 🔧 更新状态文本
        const statusText = document.getElementById('callStatusText');
        if (statusText) {
            const statusMap = {
                'calling': '正在呼叫...',
                'ringing': '来电中...',
                'connected': '通话中',
                'ended': '通话已结束'
            };

            // 🔧 关键修复：如果是发起方且处于 calling 状态，应该显示对方名字（已在 updateCallHeaderWithTargetInfo 中设置）
            // 如果是接听方或已连接，则使用默认状态文本
            if (state === 'calling') {
                // 保持当前显示的对方名字，不覆盖
                console.log('📞 保持显示对方名字');
            } else {
                statusText.textContent = statusMap[state] || '';
            }
        }

        // 🔧 更新呼叫方名称（仅 ringing 状态）
        if (state === 'ringing' && callerId) {
            const callerNameEl = document.getElementById('callCallerName');
            if (callerNameEl) {
                const caller = this.users?.find(u => u.id === callerId) ||
                    {real_name: '未知用户', username: 'unknown'};
                callerNameEl.textContent = `${caller.real_name || caller.username} 请求通话`;
            }
        }

        // 🔧 显示/隐藏控制按钮
        const controls = document.getElementById('callControls');
        if (controls) {
            if (state === 'connected' || state === 'calling') {
                controls.style.display = 'flex';
                console.log('🎮 通话控制按钮已显示 (state:', state, ')');
            } else {
                console.log('state: ', state)
                controls.style.display = 'none';
            }
        }

        // 🔧 关键修复：在 calling 状态下只显示挂断按钮，隐藏其他按钮
        if (state === 'calling') {
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.style.display = 'none';
            }
            const cameraBtn = document.getElementById('cameraBtn');
            if (cameraBtn) {
                cameraBtn.style.display = 'none';
            }
            const switchCameraBtn = document.getElementById('btnSwitchCamera');
            if (switchCameraBtn) {
                switchCameraBtn.style.display = 'none';
            }
            const speakerBtn = document.getElementById('speakerBtn');
            if (speakerBtn) {
                speakerBtn.style.display = 'none';
            }
            const endCallBtn = document.getElementById('btnEndCall');
            if (endCallBtn) {
                endCallBtn.style.display = 'flex';
                console.log('📞 呼叫中，显示挂断按钮');
            }
        }

        // 🔧 显示/隐藏通话时长 - 关键修复：同时移除 hidden 类和设置 display
        const callTimer = document.getElementById('callTimer');
        if (callTimer) {
            if (state === 'connected') {
                callTimer.classList.remove('hidden');
                callTimer.style.display = 'block'; // 🔧 确保覆盖 .hidden 的 display: none !important
                console.log('⏱️ 通话时长已显示');
            } else {
                callTimer.classList.add('hidden');
                callTimer.style.display = ''; // 恢复默认
            }
        }

        // 🔧 关键修复：在视频通话连接时显示所有控制按钮（移动端和PC端）
        if (state === 'connected' && this.callType === 'video') {
            const switchCameraBtn = document.getElementById('btnSwitchCamera');
            if (switchCameraBtn) {
                switchCameraBtn.style.display = 'flex'; // 🔧 使用 flex 以匹配 CSS
                console.log('📹 切换摄像头按钮已显示');
            }
            const videoToggleBtn = document.getElementById('cameraBtn');
            if (videoToggleBtn) {
                videoToggleBtn.style.display = 'flex'; // 🔧 使用 flex 以匹配 CSS
                console.log('📷 摄像头开关按钮已显示');
            }
            const speakerBtn = document.getElementById('speakerBtn');
            if (speakerBtn) {
                speakerBtn.style.display = 'flex'; // 🔧 使用 flex 以匹配 CSS
                console.log('🔊 免提按钮已显示');
            }
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.style.display = 'flex'; // 🔧 确保静音按钮也显示
            }
            const endCallBtn = document.getElementById('btnEndCall');
            if (endCallBtn) {
                endCallBtn.style.display = 'flex'; // 🔧 确保挂断按钮也显示
            }
        } else if (state === 'connected') {
            // 语音通话时只显示静音和挂断按钮
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.style.display = 'flex';
            }
            const endCallBtn = document.getElementById('btnEndCall');
            if (endCallBtn) {
                endCallBtn.style.display = 'flex';
            }
            // 隐藏视频相关按钮
            const switchCameraBtn = document.getElementById('btnSwitchCamera');
            if (switchCameraBtn) {
                switchCameraBtn.style.display = 'none';
            }
            const videoToggleBtn = document.getElementById('cameraBtn');
            if (videoToggleBtn) {
                videoToggleBtn.style.display = 'none';
            }
            const speakerBtn = document.getElementById('speakerBtn');
            if (speakerBtn) {
                speakerBtn.style.display = 'none';
            }
        } else {
            // 非 connected 状态时隐藏所有按钮（除了 calling 状态下的挂断按钮）
            if (state !== 'calling') {
                const switchCameraBtn = document.getElementById('btnSwitchCamera');
                if (switchCameraBtn) {
                    switchCameraBtn.style.display = 'none';
                }
                const videoToggleBtn = document.getElementById('cameraBtn');
                if (videoToggleBtn) {
                    videoToggleBtn.style.display = 'none';
                }
                const speakerBtn = document.getElementById('speakerBtn');
                if (speakerBtn) {
                    speakerBtn.style.display = 'none';
                }
                const muteBtn = document.getElementById('muteBtn');
                if (muteBtn) {
                    muteBtn.style.display = 'none';
                }
                const endCallBtn = document.getElementById('btnEndCall');
                if (endCallBtn) {
                    endCallBtn.style.display = 'none';
                }
            }
        }

        console.log(`🎨 UI 已更新为状态: ${state}`);
    },

    // 🔧 切换静音/取消静音
    toggleMute() {
        if (!this.localStream) return;

        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) {
                muteBtn.innerHTML = audioTrack.enabled
                    ? '<i class="fas fa-microphone"></i>'
                    : '<i class="fas fa-microphone-slash"></i>';
                muteBtn.classList.toggle('muted', !audioTrack.enabled);
            }
            console.log(`🔇 音频已${audioTrack.enabled ? '开启' : '静音'}`);
        }
    },

    // 🔧 切换摄像头
    toggleCamera() {
        if (!this.localStream || this.callType !== 'video') return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const cameraBtn = document.getElementById('cameraBtn');
            if (cameraBtn) {
                cameraBtn.innerHTML = videoTrack.enabled
                    ? '<i class="fas fa-video"></i>'
                    : '<i class="fas fa-video-slash"></i>';
                cameraBtn.classList.toggle('off', !videoTrack.enabled);
            }
            console.log(`📹 摄像头已${videoTrack.enabled ? '开启' : '关闭'}`);
        }
    },

    // 🔧 切换前后摄像头（移动端）
    async switchCamera() {
        if (this.callType !== 'video' || !this.localStream) return;

        try {
            const videoTrack = this.localStream.getVideoTracks()[0];
            const capabilities = videoTrack.getCapabilities();

            if (capabilities.facingMode) {
                const currentMode = videoTrack.getSettings().facingMode;
                const newMode = currentMode === 'user' ? 'environment' : 'user';

                const constraints = {
                    audio: true,
                    video: {facingMode: {exact: newMode}}
                };

                const newStream = await navigator.mediaDevices.getUserMedia(constraints);
                const newVideoTrack = newStream.getVideoTracks()[0];

                // 替换轨道
                this.peerConnection.getSenders().forEach(sender => {
                    if (sender.track?.kind === 'video') {
                        sender.replaceTrack(newVideoTrack);
                    }
                });

                // 更新本地预览
                const localVideo = document.getElementById('localVideo');
                if (localVideo) {
                    localVideo.srcObject = newStream;
                }

                // 停止旧轨道
                videoTrack.stop();
                this.localStream = newStream;

                console.log(`🔄 摄像头已切换为: ${newMode}`);
            }
        } catch (err) {
            console.warn('⚠️ 切换摄像头失败:', err);
            this.showToast('当前设备不支持切换摄像头', 'info');
        }
    },


    // 🔧 新增：切换免提模式
    // 🔹 独立方法：切换免提模式（功能逻辑，与事件绑定分离）
    toggleSpeaker() {
        console.log('🔊 切换免提模式');

        // 移动端：尝试切换音频输出设备
        if (Utils.isMobile()) {
            const audioEl = document.getElementById('remoteAudio');
            if (audioEl?.setSinkId) {
                // 切换到扬声器（空字符串表示默认设备）
                audioEl.setSinkId('').catch(err => {
                    console.warn('⚠️ 切换音频输出失败:', err);
                    this.showToast('切换免提失败', 'error');
                });
            }
        }

        // 更新按钮状态
        const speakerBtn = document.getElementById('speakerBtn');
        if (speakerBtn) {
            speakerBtn.classList.toggle('active');
            const isActive = speakerBtn.classList.contains('active');
            this.showToast(isActive ? '已切换为免提' : '已切换为听筒', 'info');
        }
    },

    // 🔧 新增：最小化通话窗口
    minimizeCallWindow_v1() {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) return;

        const isMinimized = overlay.classList.contains('minimized');

        if (isMinimized) {
            // 恢复最大化
            overlay.classList.remove('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-minus"></i>';
                minimizeBtn.title = '最小化';
            }
            console.log('✅ 通话窗口已恢复');
        } else {
            // 最小化
            overlay.classList.add('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-expand"></i>';
                minimizeBtn.title = '最大化';
            }
            console.log('✅ 通话窗口已最小化');
            this.showToast('点击最大化按钮可恢复通话窗口', 'info');
        }
    },

    minimizeCallWindow() {
        const overlay = document.getElementById('callOverlay');
        if (!overlay) return;

        const isMinimized = overlay.classList.contains('minimized');

        if (isMinimized) {
            overlay.classList.remove('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-minus"></i>';
                minimizeBtn.title = '最小化';
            }
            // 恢复隐藏的非核心按钮
            document.querySelectorAll('.call-btn').forEach(btn => btn.style.display = '');
            console.log('✅ 通话窗口已恢复最大化');
        } else {
            overlay.classList.add('minimized');
            const minimizeBtn = document.getElementById('minimizeCallBtn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '<i class="fas fa-expand"></i>';
                minimizeBtn.title = '最大化';
            }
            console.log('✅ 通话窗口已最小化');
        }
    },


    // 🔧 通话控制按钮绑定（在 setupEventListeners 末尾添加）
    setupCallControls() {
        console.log('🔧 绑定通话控制按钮事件');

        // 静音按钮
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleMute();
            };
        }

        // 摄像头按钮
        const cameraBtn = document.getElementById('cameraBtn');
        if (cameraBtn) {
            cameraBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleCamera();
            };
        }

        // 切换摄像头按钮（移动端）
        const switchCameraBtn = document.getElementById('switchCameraBtn');
        if (switchCameraBtn) {
            switchCameraBtn.onclick = (e) => {
                e.stopPropagation();
                this.switchCamera();
            };
            // 仅在移动端显示
            if (!Utils.isMobile()) {
                switchCameraBtn.style.display = 'none';
            }
        }

        // 挂断按钮
        const hangupBtn = document.getElementById('hangupBtn');
        if (hangupBtn) {
            hangupBtn.onclick = (e) => {
                e.stopPropagation();
                this.endCall(false);  // 主动挂断，需要发送信令
            };
        }

        // 🔧 新增：最小化按钮
        const minimizeBtn = document.getElementById('minimizeCallBtn');
        if (minimizeBtn) {
            minimizeBtn.onclick = (e) => {
                e.stopPropagation();
                this.minimizeCallWindow();
            };
        }

        // 免提按钮（可选）
        const speakerBtn = document.getElementById('speakerBtn');
        if (speakerBtn) {
            speakerBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleSpeaker();
            };
        }

        console.log('✅ 通话控制按钮绑定完成');
    },
    });
})();
