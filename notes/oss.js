/* ============================================================
   笔记附件的云端存放：阿里云 OSS
   - 桶：music-teaching-media（与音乐台同一个桶）
   - 前缀：notes/attachments/<id>   —— 与音乐台的文件互不干扰
   - 上传前正文已在 app.js 里加密（AES-256-GCM），OSS 上只有密文
   - 钥匙沿用音乐台那把 RAM 钥匙（存放在该桶的 oss-keys.js，运行时拉取）
   ============================================================ */
(function (root) {
  'use strict';

  const BUCKET = 'music-teaching-media';
  const REGION = 'oss-cn-chengdu';
  const PREFIX = 'notes/attachments/';
  const KEYS_URL = `https://${BUCKET}.${REGION}.aliyuncs.com/oss-keys.js`;

  let keysPromise = null;

  async function loadKeys() {
    if (keysPromise) return keysPromise;
    keysPromise = (async () => {
      const res = await fetch(KEYS_URL + '?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('拿不到 OSS 凭证（HTTP ' + res.status + '）');
      const text = await res.text();
      const id = /accessKeyId\s*:\s*['"]([^'"]+)['"]/.exec(text);
      const secret = /accessKeySecret\s*:\s*['"]([^'"]+)['"]/.exec(text);
      if (!id || !secret) throw new Error('OSS 凭证格式不对');
      return { accessKeyId: id[1], accessKeySecret: secret[1] };
    })().catch(err => { keysPromise = null; throw err; });
    return keysPromise;
  }

  /* OSS V1 签名：PUT 需要，读取走公开 URL 不用签 */
  async function signPut(key, contentType, expires) {
    const { accessKeyId, accessKeySecret } = await loadKeys();
    const stringToSign = ['PUT', '', contentType || 'application/octet-stream', String(expires), `/${BUCKET}/${key}`].join('\n');
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(accessKeySecret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(stringToSign));
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return `https://${BUCKET}.${REGION}.aliyuncs.com/${key}`
      + `?OSSAccessKeyId=${encodeURIComponent(accessKeyId)}`
      + `&Expires=${expires}&Signature=${encodeURIComponent(b64)}`;
  }

  function objectUrl(key) {
    return `https://${BUCKET}.${REGION}.aliyuncs.com/${key}`;
  }

  function attachmentKey(id) {
    return PREFIX + id;
  }

  async function putAttachment(id, bytes, contentType) {
    const key = attachmentKey(id);
    const expires = Math.floor(Date.now() / 1000) + 600;   // 10 分钟内有效
    const url = await signPut(key, contentType, expires);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: bytes
    });
    if (!res.ok) throw new Error('OSS 上传失败：HTTP ' + res.status);
    return { key, url: objectUrl(key) };
  }

  async function getAttachment(id) {
    const res = await fetch(objectUrl(attachmentKey(id)), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  }

  async function deleteAttachment(id) {
    // 桶是公开读、需要签名删；这里只做尽力而为，失败不影响本机删除
    try {
      const { accessKeyId, accessKeySecret } = await loadKeys();
      const key = attachmentKey(id);
      const expires = Math.floor(Date.now() / 1000) + 600;
      const stringToSign = ['DELETE', '', '', String(expires), `/${BUCKET}/${key}`].join('\n');
      const enc = new TextEncoder();
      const cryptoKey = await crypto.subtle.importKey(
        'raw', enc.encode(accessKeySecret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(stringToSign));
      const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
      await fetch(`${objectUrl(key)}?OSSAccessKeyId=${encodeURIComponent(accessKeyId)}&Expires=${expires}&Signature=${encodeURIComponent(b64)}`, { method: 'DELETE' });
    } catch (e) { /* 忽略：云端副本留着也没关系，反正内容是密文 */ }
  }

  root.NotesOSS = { putAttachment, getAttachment, deleteAttachment, attachmentKey, objectUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
