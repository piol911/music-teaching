# notes-api 部署

这是一个 CloudBase 云函数，供 `/notes/` 使用。它只处理加密信封和认证，不保存笔记明文。

## 1. 生成密码哈希

笔记口令需要同时用于：

- 服务端登录校验
- 浏览器端派生端到端加密密钥

浏览器会先派生彼此独立的“登录凭据”和“加密密钥”。登录时只把登录凭据发送给服务端，服务端不会接触笔记口令或加密密钥，只保存登录凭据的 scrypt 哈希。生成哈希：

```bash
node scripts/hash-password.js "你的至少10位笔记口令"
```

输出只配置到云端环境变量，不要写进 Git。重新输入同一口令必须由本脚本生成，以保证与浏览器的 PBKDF2 参数一致。

## 2. 生成 JWT 密钥

```bash
openssl rand -hex 32
```

## 3. 创建云函数

在 CloudBase 环境 `art-d9giyyspp3921f818` 中创建函数：

```text
函数名：notes-api
运行环境：Node.js 18.15
入口：index.main
类型：事件函数 / HTTP 调用
```

上传 `cloudbase/notes-api/` 目录。依赖会在云端根据 `package.json` 安装。

配置环境变量：

```text
NOTES_PASSWORD_HASH=scrypt$...
NOTES_JWT_SECRET=至少32位的随机字符串
```

## 4. 创建数据库集合

在 CloudBase 数据库中创建：

```text
notes_v1         笔记密文
notes_security   登录失败次数
```

建议给 `notes_v1.seq` 创建升序索引。两个集合都应关闭客户端直接读写，只允许云函数访问。

`notes_v1` 的文档结构：

```json
{
  "version": 1,
  "updatedAt": 1794100000000,
  "seq": 179410000000000,
  "cipher": {
    "v": 1,
    "iv": "...",
    "data": "..."
  }
}
```

服务器无法从 `cipher` 解出标题、正文、标签或删除状态。

## 5. 配置 HTTP 路由

在 CloudBase 的 HTTP 访问服务中，把 `/notes-api` 指向 `notes-api` 函数，允许：

```text
POST
OPTIONS
```

前端已经配置这个地址：

```text
https://art-d9giyyspp3921f818-1312774719.ap-shanghai.app.tcloudbase.com/notes-api
```

## 安全措施

- 只允许 `https://www.xy6300.cc` 和 `https://piol911.github.io` 跨域调用
- 登录失败 5 次后锁定该 IP 10 分钟
- 登录后签发 12 小时短期令牌
- 每次写入检查 `baseVersion`，旧页面不会覆盖新笔记
- 单次最多写 10 篇、请求约 90KB、单篇密文约 60KB
- 未授权请求在接触笔记集合前返回 `401`

## 本地测试

```bash
npm install
npm test
```
