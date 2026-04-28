// /static/js/md5-worker.js
// 🔧 导入 SparkMD5（使用 importScripts 加载 CDN 或本地文件）
// importScripts('https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js');
importScripts('/static/js/dist/spark-md5.min.js');

self.onmessage = async function(e) {
    const { file, chunkSize = 2 * 1024 * 1024 } = e.data;

    // 参数校验
    if (!file || !(file instanceof File)) {
        self.postMessage({
            type: 'error',
            message: '无效的文件对象'
        });
        return;
    }

    try {
        const spark = new SparkMD5.ArrayBuffer();
        const fileSize = file.size;
        const totalChunks = Math.ceil(fileSize / chunkSize);

        // 空文件处理
        if (fileSize === 0) {
            self.postMessage({
                type: 'complete',
                md5: SparkMD5.hash('').toLowerCase()
            });
            return;
        }

        // 分块读取文件
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, fileSize);

            // 使用 FileReader 同步读取（Worker 中无法使用 async/await 直接读 File）
            const chunk = await readFileChunk(file, start, end);
            spark.append(chunk);

            // 发送进度
            self.postMessage({
                type: 'progress',
                current: i + 1,
                total: totalChunks,
                percent: Math.round(((i + 1) / totalChunks) * 100)
            });
        }

        // 发送最终结果
        const md5 = spark.end().toLowerCase();
        self.postMessage({
            type: 'complete',
            md5: md5
        });

    } catch (error) {
        self.postMessage({
            type: 'error',
            message: `MD5 计算失败: ${error.message}`
        });
    }
};

// 🔧 辅助函数：在 Worker 中读取文件块（返回 Promise）
function readFileChunk(file, start, end) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('读取文件块失败'));
        reader.onabort = () => reject(new Error('文件读取被中止'));

        reader.readAsArrayBuffer(file.slice(start, end));
    });
}