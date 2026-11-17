class ChunkedUploader {
    constructor(options = {}) {
        this.file = options.file;                    // File 对象
        this.fileName = options.fileName;            // 文件名
        this.fileSize = options.fileSize;            // 文件大小
        this.fileMd5 = options.fileMd5;              // 文件完整MD5
        this.chunkSize = options.chunkSize || 5 * 1024 * 1024;  // 分片大小，默认5MB
        this.concurrent = options.concurrent || 3;   // 并发上传数
        this.retryCount = options.retryCount || 3;   // 失败重试次数

        this.sessionId = null;                        // 上传会话ID
        this.totalChunks = 0;                         // 总分片数
        this.uploadedChunks = new Set();              // 已上传的分片索引
        this.missingChunks = [];                      // 待上传的分片索引

        this.isPaused = false;                        // 是否暂停
        this.isCancelled = false;                     // 是否取消
        this.isCompleted = false;                     // 是否完成

        // 回调函数
        this.onProgress = options.onProgress || (() => {
        });      // (progress, uploaded, total)
        this.onChunkSuccess = options.onChunkSuccess || (() => {
        }); // (chunkIndex)
        this.onChunkError = options.onChunkError || (() => {
        });     // (chunkIndex, error)
        this.onComplete = options.onComplete || (() => {
        });         // (fileInfo)
        this.onError = options.onError || (() => {
        });               // (error)
        this.onQuickUpload = options.onQuickUpload || (() => {
        });   // (fileInfo) 秒传回调
    }

    /**
     * 计算文件分片
     */
    _sliceFile(start, end) {
        return this.file.slice(start, end);
    }

    /**
     * 计算分片MD5
     */
    async _calculateChunkMd5(chunkBlob) {
        return new Promise((resolve, reject) => {
            const spark = new SparkMD5.ArrayBuffer();
            const reader = new FileReader();

            reader.onload = (e) => {
                spark.append(e.target.result);
                resolve(spark.end().toLowerCase());
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(chunkBlob);
        });
    }

    /**
     * 初始化上传会话
     */
    async initUpload(folderId = null, description = '', tags = '') {
        try {
            const response = await fetch('/api/cloud/files/init_upload/', {
                method: 'POST',
                headers: {
                    ...TokenManager.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_name: this.fileName,
                    file_size: this.fileSize,
                    file_md5: this.fileMd5,
                    chunk_size: this.chunkSize,
                    folder: folderId,
                    description: description,
                    tags: tags
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '初始化上传失败');
            }

            const data = await response.json();

            // 🔧 处理秒传
            if (data.status === 'quick_upload') {
                this.isCompleted = true;
                this.onQuickUpload(data.file);
                return {quickUpload: true, file: data.file};
            }

            // 🔧 处理断点续传或新上传
            this.sessionId = data.session.id;
            this.totalChunks = data.session.total_chunks;
            this.uploadedChunks = new Set(data.session.uploaded_chunks);

            // 🔧🔧🔧 关键修复：严格过滤 missingChunks，确保是有效的数字数组
            this.missingChunks = (data.missing_chunks || [])
                .filter(idx => {
                    const num = Number(idx);
                    return idx !== undefined && idx !== null && !isNaN(num) && num >= 0;
                })
                .map(idx => Number(idx));  // 统一转为数字类型

            console.log('✅ 待上传分片索引:', this.missingChunks);

            // 计算初始进度
            const progress = data.session.progress || 0;
            this.onProgress(progress, this.uploadedChunks.size, this.totalChunks);

            return {
                quickUpload: false,
                sessionId: this.sessionId,
                totalChunks: this.totalChunks,
                missingChunks: this.missingChunks,
                progress: progress
            };

        } catch (error) {
            console.error('初始化上传失败:', error);
            this.onError(error);
            throw error;
        }
    }

    /**
     * 上传单个分片
     */
    async _uploadChunk(chunkIndex, retry = 0) {
        // 🔧🔧🔧 关键修复：严格校验 chunkIndex
        if (chunkIndex === undefined || chunkIndex === null || isNaN(Number(chunkIndex))) {
            const errorMsg = `❌ 无效的分片索引: chunkIndex=${chunkIndex}, type=${typeof chunkIndex}`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }


        if (this.isCancelled) throw new Error('Upload cancelled');
        if (this.isPaused) return null;

        const start = chunkIndex * this.chunkSize;
        const end = Math.min(start + this.chunkSize, this.fileSize);
        const chunkBlob = this._sliceFile(start, end);

        // 计算分片MD5
        const chunkMd5 = await this._calculateChunkMd5(chunkBlob);

        // 构建 FormData
        const formData = new FormData();
        formData.append('session_id', this.sessionId);
        formData.append('chunk_index', chunkIndex);     // 🔧 确保是数字
        formData.append('chunk_md5', chunkMd5);
        formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);

        try {
            // 🔧 关键修复：获取头部并移除 Content-Type
            const headers = TokenManager.getHeaders();
            // 删除可能存在的 Content-Type，让浏览器自动设置 multipart/form-data
            delete headers['Content-Type'];
            delete headers['content-type'];

            // 🔧 调试日志（生产环境可注释）
            console.log(`📤 上传分片 #${chunkIndex}:`, {
                sessionId: this.sessionId,
                chunkSize: chunkBlob.size,
                start,
                end,
                headers: Object.keys(headers)
            });

            const response = await fetch('/api/cloud/files/upload_chunk/', {
                method: 'POST',
                headers: headers,  // 使用清理后的头部
                body: formData  // FormData 会自动设置正确的 Content-Type
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || `分片 ${chunkIndex} 上传失败`);
            }

            const result = await response.json();

            if (result.skipped) {
                // 分片已存在，跳过
                return {skipped: true, ...result};
            }

            // 标记为已上传
            this.uploadedChunks.add(chunkIndex);
            this.onChunkSuccess(chunkIndex);

            // 更新进度
            const progress = (this.uploadedChunks.size / this.totalChunks) * 100;
            this.onProgress(progress, this.uploadedChunks.size, this.totalChunks);

            return result;

        } catch (error) {
            console.warn(`分片 ${chunkIndex} 上传失败 (重试 ${retry + 1}/${this.retryCount}):`, error);
            this.onChunkError(chunkIndex, error);

            // 重试逻辑
            if (retry < this.retryCount) {
                const delay = 1000 * Math.pow(2, retry); // 1s, 2s, 4s...
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._uploadChunk(chunkIndex, retry + 1);
            }

            throw error;
        }
    }

    /**
     * 上传分片（带并发上限；必须等待所有分片真正完成后才返回）
     *
     * 🔧 关键修复：旧实现只「启动」上传、没有 await，队列一空就返回，
     * 此时可能仍有分片在途 → 立刻合并会得到「还有 N 个分片未上传」的 400。
     * 现改为每个 worker 内 await 分片上传，只有全部分片落定后才返回结果。
     */
    async _uploadChunksConcurrently(chunkIndices) {
        // 过滤无效索引并去重
        const queue = [...new Set((chunkIndices || [])
            .map(idx => Number(idx))
            .filter(n => Number.isInteger(n) && n >= 0))];

        if (queue.length === 0) {
            console.log('⚠️ 没有有效的分片需要上传');
            return [];
        }

        const workerCount = Math.max(1, Math.min(this.concurrent || 1, queue.length));
        console.log(`📦 开始上传 ${queue.length} 个分片（并发 ${workerCount}）`);

        const results = [];
        const worker = async () => {
            while (queue.length > 0 && !this.isCancelled) {
                if (this.isPaused) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                    continue;
                }
                const chunkIndex = queue.shift();
                if (chunkIndex === undefined || chunkIndex === null) break;
                try {
                    // ← 必须 await：确保该分片真正写完、服务端记录成功后才继续
                    const result = await this._uploadChunk(chunkIndex);
                    results.push({chunkIndex, success: true, result});
                } catch (error) {
                    results.push({chunkIndex, success: false, error});
                }
            }
        };

        await Promise.all(Array.from({length: workerCount}, () => worker()));

        if (this.isCancelled) {
            throw new Error('Upload cancelled');
        }

        return results;
    }

    /**
     * 合并分片完成上传
     */
    async mergeChunks(folderId = null, description = null, tags = null) {
        const body = JSON.stringify({
            session_id: this.sessionId,
            folder: folderId,
            description: description || null,  // 🔧 null 会被 DRF 正确处理
            tags: tags || null
        });
        const postMerge = () => fetch('/api/cloud/files/merge_chunks/', {
            method: 'POST',
            headers: {
                ...TokenManager.getHeaders(),
                'Content-Type': 'application/json'
            },
            body
        });

        try {
            // 合并前最多校验/补传 3 轮：确保所有分片都已真正落库，避免「还有 N 个分片未上传」
            for (let attempt = 0; attempt < 3; attempt++) {
                const sessionCheck = await this.checkSession();
                const missing = (sessionCheck && Array.isArray(sessionCheck.missingChunks))
                    ? sessionCheck.missingChunks : [];
                if (missing.length === 0) break;

                console.warn(`⚠️ 合并前检查：还有 ${missing.length} 个分片未上传，补传第 ${attempt + 1} 轮...`);
                const results = await this._uploadChunksConcurrently(missing);
                const failed = results.filter(r => !r.success);
                if (failed.length > 0) {
                    throw new Error(`${failed.length} 个分片补传失败`);
                }
                // 给服务端一点落库时间后再复查
                await new Promise(resolve => setTimeout(resolve, 150));
            }

            let response = await postMerge();
            let data = await response.json().catch(() => ({}));

            // 极端情况下服务端仍报缺分片（落库延迟）→ 按返回的缺失索引补传后重试合并一次
            if (!response.ok && response.status === 400
                && Array.isArray(data.missing_chunks) && data.missing_chunks.length > 0) {
                console.warn('⚠️ 合并时服务端仍缺分片，补传后重试:', data.missing_chunks);
                const results = await this._uploadChunksConcurrently(data.missing_chunks);
                const failed = results.filter(r => !r.success);
                if (failed.length > 0) throw new Error(`${failed.length} 个分片补传失败`);
                await new Promise(resolve => setTimeout(resolve, 250));
                response = await postMerge();
                data = await response.json().catch(() => ({}));
            }

            if (!response.ok) {
                throw new Error(data.error || '合并分片失败');
            }

            this.isCompleted = true;
            this.onComplete(data.file);

            return data;

        } catch (error) {
            console.error('合并分片失败:', error);
            this.onError(error);
            throw error;
        }
    }

    /**
     * 检查会话状态（用于恢复上传）
     */
    async checkSession() {
        if (!this.sessionId) return null;

        try {
            const response = await fetch(
                `/api/cloud/files/check_session/?session_id=${this.sessionId}`,
                {headers: TokenManager.getHeaders()}
            );

            if (!response.ok) return null;

            const data = await response.json();
            if (data.exists && !data.is_completed) {
                this.missingChunks = data.missing_chunks || [];
                return {
                    progress: data.session?.progress || 0,
                    missingChunks: this.missingChunks,
                    uploadedCount: this.uploadedChunks.size
                };
            }
            return null;

        } catch (error) {
            console.warn('检查会话状态失败:', error);
            return null;
        }
    }

    /**
     * 取消上传
     */
    async cancel() {
        this.isCancelled = true;
        this.isPaused = false;

        if (this.sessionId) {
            try {
                await fetch(`/api/cloud/files/cancel_upload/?session_id=${this.sessionId}`, {
                    method: 'DELETE',
                    headers: TokenManager.getHeaders()
                });
            } catch (error) {
                console.warn('取消上传请求失败:', error);
            }
        }

        this.onError(new Error('Upload cancelled by user'));
    }

    /**
     * 暂停上传
     */
    pause() {
        this.isPaused = true;
    }

    /**
     * 恢复上传
     */
    resume() {
        this.isPaused = false;
    }

    /**
     * 主上传流程
     */
    async upload(folderId = null, description = '', tags = '') {
        try {
            // 1. 初始化上传会话
            const initResult = await this.initUpload(folderId, description, tags);
            if (initResult.quickUpload) {
                return initResult;  // 秒传直接返回
            }

            // 2. 上传所有缺失的分片
            if (this.missingChunks.length > 0) {
                console.log(`开始上传 ${this.missingChunks.length} 个分片...`);

                const results = await this._uploadChunksConcurrently(this.missingChunks);

                // 检查是否有失败的分片
                const failed = results.filter(r => !r.success);
                if (failed.length > 0) {
                    throw new Error(`${failed.length} 个分片上传失败`);
                }
            }

            // 3. 合并分片
            console.log('所有分片上传完成，开始合并...');
            // 🔧 确保传递 null 而不是空字符串
            const mergeResult = await this.mergeChunks(
                folderId,
                description || null,   // 🔧 空字符串转 null
                tags || null           // 🔧 空字符串转 null
            );

            return mergeResult;

        } catch (error) {
            if (error.message !== 'Upload cancelled') {
                console.error('上传失败:', error);
                this.onError(error);
            }
            throw error;
        }
    }
}
