/* ============================================
   阿里云 OSS 凭证（请勿提交到 git）
   ============================================
   使用步骤：
   1. 在阿里云 RAM 控制台创建子账号（强烈推荐，最小权限）
   2. 给子账号授权：
      - oss:PutObject
      - oss:GetObject
      - oss:DeleteObject
      - oss:ListObjects
      - oss:HeadObject
      资源范围限定到 bucket: music-teaching-media
   3. 把以下占位符替换成真实的 AccessKey ID 与 Secret
   4. 保存为 oss-keys.js（去掉 .template 后缀）
   5. 通过 GitHub web UI 上传到仓库根目录
      （GitHub 仓库页面 → Add file → Upload files）
   6. GitHub Pages 重新部署后页面就能读写 OSS

   ⚠️ 不要把含真实凭证的 oss-keys.js 提交到 git
   ⚠️ 不要把 oss-keys.js 发给任何人（包括 AI 助手）
   ============================================ */

const OSS_KEYS = {
    accessKeyId: 'YOUR_ACCESS_KEY_ID',        // 替换为真实值
    accessKeySecret: 'YOUR_ACCESS_KEY_SECRET' // 替换为真实值
};

// 同时导出 CommonJS / ES Module 两种格式，兼容不同加载方式
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OSS_KEYS;
}