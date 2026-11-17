// static/js/cloud-upload.js - 文件上传、批量上传与新建文件夹
// 说明：本文件为 CloudApp 原型扩展，必须在主类之后、实例化之前加载。
(function () {
    'use strict';
    Object.assign(CloudApp.prototype, {


    // ==================== 文件操作 ====================

    /**
     * 🔧 重构：文件上传（支持分片/断点续传/秒传）
     * @param {File} file - 文件对象
     * @param {string|null} folderId - 目标文件夹 ID
     * @param {string} description - 文件描述
     * @param {string} tags - 文件标签
     */
    async uploadFile(file, folderId = null, description = '', tags = '') {
        if (!file) {
            this.showError('上传失败', '文件不能为空');
            return null;
        }

        // 🔧 文件验证
        if (!this.isValidFileType(file)) {
            this.showError('不支持的文件类型', `允许的类型：${this.allowedFileTypes.join(', ')}`);
            return null;
        }

        if (description === '' && tags === '') {
            // 可选：给用户提示，但不阻止上传
            console.log('提示：建议填写文件描述便于后续管理');
        }

        // 🔧 文件大小验证
        const maxSizeBytes = this.fileMaxSizeMB * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            this.showError('文件过大', `文件大小不能超过${this.fileMaxSizeMB}MB`);
            return null;
        }

        // 🔧 显示上传进度对话框
        const uploadDialog = this.showUploadDialog(file.name);
        let sessionId = null;

        try {
            // 🔧 1. 计算文件 MD5（大文件使用 Worker）
            uploadDialog.updateStatus('正在计算文件指纹...');
            const fileMd5 = file.size > 100 * 1024 * 1024
                ? await this.computeFileMd5WithWorker(file, (current, total, percent) => {
                    uploadDialog.updateMd5Progress(percent);
                })
                : await this.computeFileMd5(file, 2 * 1024 * 1024, (current, total, percent) => {
                    uploadDialog.updateMd5Progress(percent);
                });

            console.log('🔐 文件 MD5:', fileMd5);

            // 🔧 2. 初始化上传追踪器（用于计算上传速度）
            this.initUploadTracker(file.name, file.size);

            // 🔧 3. 创建分片上传器（单分片顺序上传：concurrent=1，避免并发分片导致 merge_chunks 偶发 400）
            const uploader = new ChunkedUploader({
                file: file,
                fileName: file.name,
                fileSize: file.size,
                fileMd5: fileMd5,
                chunkSize: this.uploadConfig.chunkSize,
                concurrent: 1,
                retryCount: this.uploadConfig.retryCount,

                // 🔧 进度回调 - 关键：在此处更新速度显示
                onProgress: (progress, uploaded, total) => {
                    uploadDialog.updateUploadProgress(progress, uploaded, total);
                    // 🔧 实时更新上传速度
                    this.updateUploadSpeed(file.name, progress, file.size);
                },

                // 🔧 分片成功回调
                onChunkSuccess: (chunkIndex) => {
                    console.log(`✅ 分片 ${chunkIndex} 上传成功`);
                },

                // 🔧 分片失败回调
                onChunkError: (chunkIndex, error) => {
                    console.warn(`❌ 分片 ${chunkIndex} 上传失败:`, error);
                    uploadDialog.updateStatus(`分片 ${chunkIndex} 上传失败，重试中...`);
                },

                // 🔧 秒传回调
                onQuickUpload: (fileInfo) => {
                    uploadDialog.close();
                    // 🔧 清理上传追踪器
                    this.clearUploadTracker(file.name);
                    this.showSuccess('上传成功', `${file.name} 已存在（秒传）`);
                    this.loadFiles(this.currentFolderId);
                },

                // 🔧 完成回调
                onComplete: (fileInfo) => {
                    uploadDialog.close();
                    // 🔧 清理上传追踪器
                    this.clearUploadTracker(file.name);
                    this.showSuccess('上传成功', `${file.name} 上传完成`);
                    this.loadFiles(this.currentFolderId);
                },

                // 🔧 错误回调：只关闭进度框并清理；具体提示统一由下面的 catch 给出，避免重复弹窗
                onError: (error) => {
                    uploadDialog.close();
                    this.clearUploadTracker(file.name);
                    console.warn('上传出错:', file.name, error);
                }
            });

            // 🔧 4. 存储上传任务（支持取消）
            sessionId = `upload_${Date.now()}_${file.name}`;
            this.chunkedUploaders.set(sessionId, uploader);

            // 🔧 5. 执行上传（内部会等待所有分片真正上传完成后才合并）
            await uploader.upload(folderId, description, tags);

            return {success: true, fileInfo: uploader.fileInfo};

        } catch (error) {
            console.error('文件上传失败:', error);
            uploadDialog.close();
            this.clearUploadTracker(file.name);
            this.showError('上传失败', `${file.name}：${error.message || '未知错误'}`);
            return null;
        } finally {
            // 🔧 6. 无论成功失败都清理上传任务，避免残留
            if (sessionId) this.chunkedUploaders.delete(sessionId);
        }
    },


    /**
     * 🔧 批量文件上传
     * @param {FileList} files - 文件列表
     * @param {string|null} folderId - 目标文件夹 ID
     */
    async uploadMultipleFiles(files, folderId = null) {
        const fileList = Array.from(files || []);
        if (fileList.length === 0) {
            this.showError('上传失败', '请选择文件');
            return;
        }

        const totalFiles = fileList.length;
        const failedFiles = [];
        const batchDialog = this.showBatchUploadDialog(totalFiles, fileList);

        // 🔧 严格串行：一个文件完整上传（含全部分片上传 + 合并完成）后再上传下一个，
        // 避免多文件并发导致分片/上传会话互相干扰，保证每个文件完整无缺失。
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            batchDialog.updateFileProgress(i + 1, totalFiles, file.name);
            batchDialog.setFileStatus(i, 'uploading');

            // uploadFile 失败时返回 null（并已弹出该文件的错误提示）
            const result = await this.uploadFile(file, folderId);
            if (result && result.success) {
                batchDialog.setFileStatus(i, 'success');
            } else {
                batchDialog.setFileStatus(i, 'failed', '上传失败');
                failedFiles.push(file.name);
            }
        }

        const successCount = totalFiles - failedFiles.length;
        if (failedFiles.length === 0) {
            batchDialog.close();
            this.showSuccess('批量上传完成', `成功上传 ${successCount} 个文件`);
        } else {
            // 有失败时保留进度框，方便用户查看具体哪些文件失败了
            this.showError('批量上传部分失败',
                `成功 ${successCount} 个，失败 ${failedFiles.length} 个：`
                + failedFiles.slice(0, 3).join('、')
                + (failedFiles.length > 3 ? ' 等' : ''));
        }
        await this.loadFiles(this.currentFolderId);
    },

    /**
     * 🔧 显示批量上传进度对话框
     */
    showBatchUploadDialog(totalFiles, files) {
        let dialog = document.getElementById('batchUploadProgressDialog');

        if (!dialog) {
            dialog = document.createElement('div');
            dialog.id = 'batchUploadProgressDialog';
            dialog.className = 'upload-progress-dialog';
            dialog.innerHTML = `
            <div class="upload-progress-content">
                <div class="upload-progress-header">
                    <h4>批量上传</h4>
                    <button class="close-btn" onclick="this.closest('.upload-progress-dialog').classList.remove('show')">&times;</button>
                </div>
                <div class="upload-progress-body">
                    <div class="progress-section">
                        <div class="progress-label">
                            <span>总体进度</span>
                            <span id="batchProgressText">0/${totalFiles}</span>
                        </div>
                        <div class="progress-bar">
                            <div id="batchProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    <div class="current-file" id="currentFileName">准备上传...</div>
                    <div class="batch-file-list" id="batchFileList"></div>
                </div>
            </div>
        `;
            document.body.appendChild(dialog);
        } else {
            // 复用已有对话框时，重置总体进度
            const text = document.getElementById('batchProgressText');
            if (text) text.textContent = `0/${totalFiles}`;
            const bar = document.getElementById('batchProgressBar');
            if (bar) bar.style.width = '0%';
        }

        // 每个文件的状态：pending / uploading / success / failed
        const items = Array.from(files || []).map(f => ({
            name: (f && f.name) || '未命名文件',
            status: 'pending',
            message: ''
        }));
        const self = this;
        const renderList = () => {
            const box = document.getElementById('batchFileList');
            if (!box) return;
            box.innerHTML = items.map(it => {
                const icon = it.status === 'uploading' ? 'fa-spinner fa-spin'
                    : it.status === 'success' ? 'fa-check-circle'
                        : it.status === 'failed' ? 'fa-times-circle' : 'fa-clock';
                const msg = it.message
                    ? `<span class="batch-file-msg">${self.escapeHtml(it.message)}</span>` : '';
                return `<div class="batch-file-item ${it.status}">
                    <i class="fas ${icon}"></i>
                    <span class="batch-file-name" title="${self.escapeHtml(it.name)}">${self.escapeHtml(it.name)}</span>
                    ${msg}
                </div>`;
            }).join('');
        };
        renderList();

        dialog.classList.add('show');

        return {
            updateFileProgress: (current, total, filename) => {
                const bar = document.getElementById('batchProgressBar');
                const text = document.getElementById('batchProgressText');
                const file = document.getElementById('currentFileName');
                const percent = total > 0 ? (current / total) * 100 : 0;

                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${current}/${total}`;
                if (file) file.textContent = `正在上传：${filename}`;
            },
            setFileStatus: (index, status, message) => {
                if (!items[index]) return;
                items[index].status = status;
                items[index].message = message || '';
                renderList();
            },
            close: () => {
                dialog.classList.remove('show');
            }
        };
    },


    /**
     * 🔧 显示上传进度对话框
     * @param {string} filename - 文件名
     */
    showUploadDialog(filename) {
        // 检查是否已存在
        let dialog = document.getElementById('uploadProgressDialog');

        if (!dialog) {
            dialog = document.createElement('div');
            dialog.id = 'uploadProgressDialog';
            dialog.className = 'upload-progress-dialog';
            dialog.innerHTML = `
            <div class="upload-progress-content">
                <div class="upload-progress-header">
                    <h4>文件上传</h4>
                    <button class="close-btn" id="uploadProgressClose">&times;</button>
                </div>
                <div class="upload-progress-body">
                    <div class="file-info">
                        <i class="fas fa-file"></i>
                        <span id="uploadFileName">${this.escapeHtml(filename)}</span>
                    </div>
                    
                    <div class="progress-section">
                        <div class="progress-label">
                            <span>MD5 计算</span>
                            <span id="md5ProgressText">0%</span>
                        </div>
                        <div class="progress-bar">
                            <div id="md5ProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    
                    <div class="progress-section">
                        <div class="progress-label">
                            <span>文件上传</span>
                            <span id="uploadProgressText">0%</span>
                        </div>
                        <div class="progress-bar">
                            <div id="uploadProgressBar" class="progress-fill" style="width: 0%"></div>
                        </div>
                        <div class="progress-detail">
                            <span id="uploadDetail">0/0 分片</span>
                            <span id="uploadSpeed">-- KB/s</span>
                        </div>
                    </div>
                    
                    <div class="progress-status" id="uploadStatus">准备上传...</div>
                    
                    <div class="progress-actions">
                        <button id="pauseResumeBtn" class="btn btn-sm btn-secondary">暂停</button>
                        <button id="cancelUploadBtn" class="btn btn-sm btn-danger">取消</button>
                    </div>
                </div>
            </div>
        `;
            document.body.appendChild(dialog);
        }

        // 更新文件名
        document.getElementById('uploadFileName').textContent = filename;

        // 显示对话框
        dialog.classList.add('show');

        // 🔧 绑定暂停/恢复事件
        const pauseResumeBtn = document.getElementById('pauseResumeBtn');
        let isPaused = false;
        pauseResumeBtn.onclick = () => {
            isPaused = !isPaused;
            pauseResumeBtn.textContent = isPaused ? '继续' : '暂停';
            pauseResumeBtn.className = isPaused ?
                'btn btn-sm btn-success' : 'btn btn-sm btn-secondary';

            // 获取当前上传器（简化处理，实际应存储引用）
            const uploader = Array.from(this.chunkedUploaders.values())[0];
            if (uploader) {
                if (isPaused) {
                    uploader.pause();
                } else {
                    uploader.resume();
                }
            }
        };

        // 🔧 绑定取消事件
        const cancelUploadBtn = document.getElementById('cancelUploadBtn');
        cancelUploadBtn.onclick = () => {
            const uploader = Array.from(this.chunkedUploaders.values())[0];
            if (uploader) {
                uploader.cancel();
            }
            dialog.classList.remove('show');
        };

        // 关闭按钮
        const closeBtn = document.getElementById('uploadProgressClose');
        closeBtn.onclick = () => {
            dialog.classList.remove('show');
        };

        return {
            updateMd5Progress: (percent) => {
                const bar = document.getElementById('md5ProgressBar');
                const text = document.getElementById('md5ProgressText');
                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${percent}%`;
            },

            updateUploadProgress: (percent, uploaded, total) => {
                const bar = document.getElementById('uploadProgressBar');
                const text = document.getElementById('uploadProgressText');
                const detail = document.getElementById('uploadDetail');
                if (bar) bar.style.width = `${percent}%`;
                if (text) text.textContent = `${Math.round(percent)}%`;
                if (detail) detail.textContent = `${uploaded}/${total} 分片`;
            },

            updateStatus: (message) => {
                const status = document.getElementById('uploadStatus');
                if (status) status.textContent = message;
            },

            close: () => {
                dialog.classList.remove('show');
            }
        };
    },


    /**
     * 🔧 格式化上传速度显示
     * @param {number} bytesPerSecond - 每秒字节数
     * @returns {string} 格式化后的速度字符串
     */
    formatSpeed(bytesPerSecond) {
        if (!bytesPerSecond || bytesPerSecond < 0) return '-- KB/s';

        if (bytesPerSecond < 1024) {
            return `${bytesPerSecond.toFixed(1)} B/s`;
        } else if (bytesPerSecond < 1024 * 1024) {
            return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
        } else if (bytesPerSecond < 1024 * 1024 * 1024) {
            return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
        } else {
            return `${(bytesPerSecond / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
        }
    },


    /**
     * 🔧 更新上传速度显示
     * @param {string} filename - 文件名
     * @param {number} progress - 上传进度百分比 (0-100)
     * @param {number} fileSize - 文件总大小（字节）
     */
    updateUploadSpeed(filename, progress, fileSize) {
        const tracker = this.uploadTrackers.get(filename);
        if (!tracker) return;

        const now = Date.now();
        const elapsed = (now - tracker.startTime) / 1000; // 已用时间（秒）
        const loaded = (progress / 100) * fileSize; // 已上传字节数

        // 🔧 计算瞬时速度（滑动窗口：最近 500ms 的平均速度，避免抖动）
        const timeDiff = (now - tracker.lastUpdateTime) / 1000;
        const loadedDiff = loaded - tracker.lastLoaded;

        let instantSpeed = 0;
        // 至少间隔 100ms 才更新瞬时速度，避免频繁计算
        if (timeDiff >= 0.1) {
            instantSpeed = loadedDiff / timeDiff;
            tracker.lastUpdateTime = now;
            tracker.lastLoaded = loaded;
        }

        // 🔧 计算平均速度（用于进度较慢或刚开始时参考）
        const avgSpeed = elapsed > 0 ? loaded / elapsed : 0;

        // 🔧 智能选择显示速度：
        // - 上传初期 (<5%) 或瞬时速度为 0 时，显示平均速度
        // - 正常上传时显示瞬时速度
        const displaySpeed = (progress < 5 || instantSpeed === 0) ? avgSpeed : instantSpeed;

        // 🔧 更新 DOM 元素
        const speedEl = document.getElementById('uploadSpeed');
        if (speedEl) {
            speedEl.textContent = this.formatSpeed(displaySpeed);
        }
    },


    /**
     * 🔧 初始化上传追踪器
     * @param {string} filename - 文件名
     * @param {number} fileSize - 文件大小（字节）
     */
    initUploadTracker(filename, fileSize) {
        const now = Date.now();
        this.uploadTrackers.set(filename, {
            startTime: now,
            loaded: 0,
            lastUpdateTime: now,
            lastLoaded: 0,
            fileSize: fileSize
        });
    },

    /**
     * 🔧 清理上传追踪器
     * @param {string} filename - 文件名
     */
    clearUploadTracker(filename) {
        this.uploadTrackers.delete(filename);
    },

    isValidFileType(file) {
        const fileType = this.getFileCategory(file.type);
        return this.allowedFileTypes.includes(fileType);
    },

    getFileCategory(mimeType) {
        if (!mimeType) return 'file';
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        return 'file';
    },

    async deleteFile(fileId) {
        const confirmed = await this.showConfirmDialog('删除文件', '确定要删除这个文件吗？', 'danger');
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/cloud/files/${fileId}/delete/`, {
                method: 'POST',
                headers: TokenManager.getHeaders()
            });
            if (!response.ok) throw new Error('删除失败');

            this.showSuccess('删除成功', '文件已移动到回收站');
            await this.loadFiles(this.currentFolderId);
        } catch (error) {
            console.error('删除失败:', error);
            this.showError('删除失败', error.message);
        }
    },

    async createFolder() {
        const name = document.getElementById('newFolderName')?.value.trim();
        const desc = document.getElementById('newFolderDesc')?.value.trim();
        const isSharedFolder = document.getElementById('isSharedFolder').checked;

        if (!name) {
            this.showError('验证失败', '文件夹名称不能为空');
            return;
        }

        try {
            const response = await fetch('/api/cloud/folders/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TokenManager.getToken()}`
                },
                body: JSON.stringify({
                    name: name,
                    description: desc,
                    is_shared_folder: isSharedFolder,
                    parent: this.currentFolderId
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '创建失败');
            }

            this.showSuccess('创建成功', '文件夹创建成功');
            this.closeModal('newFolderModal');
            document.getElementById('newFolderName').value = '';
            document.getElementById('newFolderDesc').value = '';
            document.getElementById('isSharedFolder').checked = false;

            await this.loadFiles(this.currentFolderId);
        } catch (error) {
            console.error('创建失败:', error);
            this.showError('创建失败', error.message);
        }
    },
    });
})();
