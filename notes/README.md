# XY6300 笔记

一个无框架、可离线、端到端加密的私人 Markdown 笔记库。

## 已实现

- 可编辑标签、正文 `#标签` 自动识别、全文搜索
- 行级即时 Markdown：光标所在行显示源文，离开后立即排版
- `[[双向链接]]` 和反向链接
- IndexedDB 本地持久化，关闭页面后笔记仍在
- 离线编辑队列：断网时继续写，恢复网络后自动补同步
- 笔记正文在浏览器中 AES-256-GCM 加密
- 导入 Markdown 文件夹，目录名自动转为标签
- 导出未加密 JSON 备份
- PWA 外壳缓存，安装到主屏幕后可离线打开
- 自动同步客户端、登录、冲突副本
- 本机加密附件：图片、PDF、Word、Excel
- DOCX/XLSX 本地预览与 Markdown 转换
- B站视频内嵌和小红书链接卡片
- CloudBase 同步后端：登录限速、短期 JWT、版本检查、精确 CORS
- 明确的“目录 / 笔记列表 / 同步 / 新建 / 更多”工具栏，目录和列表都可收起

## 本地预览

在仓库根目录运行：

```bash
python3 -m http.server 8080
```

打开：

```text
http://localhost:8080/notes/
```

不要直接双击 `index.html`。浏览器要求 HTTPS 或 localhost 才能使用加密和 Service Worker。

## 测试

```bash
node --test notes/tests/core.test.js
cd notes/editor && npm run build
cd cloudbase/notes-api
npm test
```

## 云同步配置

同步 API 地址写在 `notes/config.js`，当前预期路由为：

```text
https://art-d9giyyspp3921f818-1312774719.ap-shanghai.app.tcloudbase.com/notes-api
```

服务端部署和密钥配置见 `cloudbase/notes-api/README.md`。

## 安全边界

- 笔记口令不会保存到磁盘；浏览器只在内存中使用它派生加密密钥。
- 云登录使用独立的派生凭据，服务端不会收到笔记口令或加密密钥。
- 云登录令牌只保存在当前浏览器并在 12 小时后失效；锁定笔记库会同时清除令牌。
- 本地保存的是密文，云端也只接收密文。
- 锁定笔记库会删除 IndexedDB 中的活动 `CryptoKey`，必须重新输入口令。
- 浏览器扩展、被控制的设备或恶意 XSS 仍可能在解锁期间读取正文。
- 口令丢失后无法恢复笔记正文。请额外保留加密备份或离线恢复资料。
