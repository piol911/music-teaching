/* ============================================
   阿里云 OSS 配置（公共骨架，不含凭证）
   ============================================
   凭证放在 oss-keys.js（被 .gitignore 忽略）
   部署时 oss-keys.js 必须放在本文件同目录才能被加载

   首次部署流程：
   1. 在阿里云 RAM 创建子账号，仅授权本 Bucket 的
      oss:PutObject / GetObject / DeleteObject / ListObjects / HeadObject
   2. 拿到 AccessKey ID 与 Secret
   3. 参考 oss-keys.template.js 填写凭证，保存为 oss-keys.js
   4. 通过 GitHub web UI 上传 oss-keys.js 到仓库根目录
      （网页编辑 → Add file → Upload files）

   性能优化：
   - 启用 CDN 后访问会更快（国内每个省会城市一个节点）
   - 在 cdnDomain 填入你的 CDN 加速域名，所有图片视频将走 CDN
   ============================================ */

const OSS_CONFIG = {
    region: 'oss-cn-chengdu',           // Bucket 地域
    bucket: 'music-teaching-media',     // Bucket 名称
    cdnDomain: '',                      // 可选 CDN 加速域名
    // 凭证占位：由 loadOSSKeys() 从同目录 oss-keys.js 读取
    accessKeyId: '',
    accessKeySecret: ''
};

// 异步加载凭证：优先同目录 oss-keys.js，404 时回退到 OSS 上的 oss-keys.js
const OSS_KEYS_FALLBACK_URL = 'https://music-teaching-media.oss-cn-chengdu.aliyuncs.com/oss-keys.js';

function parseKeysFromText(text) {
    const m = text.match(/accessKeyId\s*[:=]\s*['"]([^'"]+)['"]/);
    const s = text.match(/accessKeySecret\s*[:=]\s*['"]([^'"]+)['"]/);
    if (m) OSS_CONFIG.accessKeyId = m[1];
    if (s) OSS_CONFIG.accessKeySecret = s[1];
}

async function loadOSSKeys() {
    if (OSS_CONFIG.accessKeyId) return;

    // 1) 先试同目录 oss-keys.js（GitHub Pages 上不存在时是 404）
    try {
        const resp = await fetch('oss-keys.js?_=' + Date.now());
        if (resp.ok) parseKeysFromText(await resp.text());
    } catch (e) { /* ignore */ }

    // 2) 回退：从 OSS bucket 根目录拉取（跨域已被 OSS CORS 规则放行）
    if (!OSS_CONFIG.accessKeyId) {
        try {
            const resp = await fetch(OSS_KEYS_FALLBACK_URL + '?_=' + Date.now());
            if (resp.ok) parseKeysFromText(await resp.text());
        } catch (e) { /* ignore */ }
    }

    if (!OSS_CONFIG.accessKeyId || !OSS_CONFIG.accessKeySecret) {
        console.error('阿里云 OSS 凭证缺失：本地与 OSS 均未找到 oss-keys.js');
    }
}