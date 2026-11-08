'use strict';

const crypto = require('node:crypto');
const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const MAX_NOTES_PER_PUSH = 10;
const MAX_REQUEST_CHARS = 90000;
const MAX_CIPHER_CHARS = 60000;
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const ALLOWED_ORIGINS = new Set([
  'https://www.xy6300.cc',
  'https://piol911.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
]);

function headers(event) {
  const source = event.headers || event.requestContext?.http?.headers || {};
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
}

function methodOf(event) {
  return String(event.httpMethod || event.requestContext?.http?.method || 'POST').toUpperCase();
}

function bodyOf(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (typeof raw === 'object') return raw;
  return JSON.parse(raw);
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  };
}

function reply(statusCode, payload, origin) {
  return {
    statusCode,
    headers: cors(origin),
    body: JSON.stringify(payload)
  };
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signToken() {
  const secret = process.env.NOTES_JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('NOTES_JWT_SECRET 未配置或长度不足 32');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: 'xy6300-notes',
    sub: 'owner',
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
    jti: crypto.randomBytes(12).toString('hex')
  }));
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    token: `${data}.${signature}`,
    expiresAt: (nowSeconds + TOKEN_TTL_SECONDS) * 1000
  };
}

function verifyToken(token) {
  const secret = process.env.NOTES_JWT_SECRET;
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  let actual;
  try {
    actual = Buffer.from(parts[2], 'base64url');
  } catch {
    return false;
  }
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.iss === 'xy6300-notes' &&
      payload.sub === 'owner' &&
      Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function parsePasswordHash(value) {
  const parts = String(value || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  return {
    n: Number(parts[1]),
    r: Number(parts[2]),
    p: Number(parts[3]),
    salt: Buffer.from(parts[4], 'hex'),
    hash: Buffer.from(parts[5], 'hex')
  };
}

/* 账号口令哈希：优先用环境变量；没有就在数据库里找；
   两处都没有 = 第一次连接 —— 把这次的凭据登记为账号口令（只此一次）。
   这样不用跑命令生成哈希，直接在应用里设一次口令即可。 */
const ACCOUNT_DOC = '__account__';

async function loadPasswordHash() {
  const envHash = String(process.env.NOTES_PASSWORD_HASH || '').trim();
  if (envHash) return envHash;
  const result = await db.collection('notes_security').doc(ACCOUNT_DOC).get();
  const doc = result.data && result.data[0];
  return (doc && doc.hash) || '';
}

function hashAuthSecret(authSecret, salt, length) {
  return crypto.scryptSync(String(authSecret || ''), salt, length, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024
  });
}

async function verifyAuthSecret(authSecret) {
  const raw = await loadPasswordHash();
  if (!raw) {
    // 首次连接：把这个凭据登记为账号口令，往后就用它
    const salt = crypto.randomBytes(24);
    const hash = hashAuthSecret(authSecret, salt, 32);
    await db.collection('notes_security').doc(ACCOUNT_DOC).set({
      hash: `scrypt$16384$8$1$${salt.toString('hex')}$${hash.toString('hex')}`,
      createdAt: Date.now()
    });
    return true;
  }
  const config = parsePasswordHash(raw);
  if (!config || !config.salt.length || !config.hash.length) {
    throw new Error('账号口令哈希格式不正确');
  }
  const actual = hashAuthSecret(authSecret, config.salt, config.hash.length);
  return actual.length === config.hash.length && crypto.timingSafeEqual(actual, config.hash);
}

function clientIpHash(event) {
  const h = headers(event);
  const ip = String(h['x-forwarded-for'] || h['x-real-ip'] || 'unknown').split(',')[0].trim();
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

async function getAttempt(ipHash) {
  const result = await db.collection('notes_security').doc(ipHash).get();
  return result.data && result.data[0] ? result.data[0] : null;
}

async function setAttempt(ipHash, data) {
  await db.collection('notes_security').doc(ipHash).set(data);
}

async function enforceRateLimit(event) {
  const record = await getAttempt(clientIpHash(event));
  if (!record) return;
  if (Number(record.lockedUntil) > Date.now()) {
    const error = new Error('登录尝试过多，请稍后再试');
    error.statusCode = 429;
    throw error;
  }
}

async function recordLoginResult(event, success) {
  const ipHash = clientIpHash(event);
  const current = await getAttempt(ipHash);
  if (success) {
    if (current) await setAttempt(ipHash, { failures: 0, lockedUntil: 0, updatedAt: Date.now() });
    return;
  }
  const failures = Number(current?.failures || 0) + 1;
  await setAttempt(ipHash, {
    failures,
    lockedUntil: failures >= 5 ? Date.now() + 10 * 60 * 1000 : 0,
    updatedAt: Date.now()
  });
}

function requireAuth(token) {
  if (!verifyToken(token)) {
    const error = new Error('登录已过期');
    error.statusCode = 401;
    throw error;
  }
}

function recordFromDocument(document) {
  return {
    id: document._id || document.id,
    version: Number(document.version) || 0,
    updatedAt: Number(document.updatedAt) || 0,
    seq: Number(document.seq) || 0,
    cipher: document.cipher
  };
}

function validateEnvelope(cipher) {
  if (!cipher || cipher.v !== 1 || typeof cipher.iv !== 'string' || typeof cipher.data !== 'string') {
    const error = new Error('加密数据格式不正确');
    error.statusCode = 400;
    throw error;
  }
  if (cipher.data.length > MAX_CIPHER_CHARS || cipher.iv.length > 64) {
    const error = new Error('单篇笔记过大，暂时无法同步');
    error.statusCode = 413;
    throw error;
  }
}

async function pull(event, body) {
  requireAuth(headers(event).authorization?.replace(/^Bearer\s+/i, ''));
  const cursor = Math.max(0, Number(body.cursor) || 0);
  const limit = 100;
  const result = await db.collection('notes_v1')
    .where({ seq: db.command.gt(cursor) })
    .orderBy('seq', 'asc')
    .limit(limit)
    .get();
  const records = (result.data || []).map(recordFromDocument);
  return {
    ok: true,
    records,
    cursor: records.length ? records[records.length - 1].seq : cursor,
    hasMore: records.length === limit
  };
}

async function push(event, body) {
  requireAuth(headers(event).authorization?.replace(/^Bearer\s+/i, ''));
  const incoming = Array.isArray(body.notes) ? body.notes : [];
  if (!incoming.length) return { ok: true, accepted: [], conflicts: [] };
  if (incoming.length > MAX_NOTES_PER_PUSH) {
    const error = new Error(`一次最多同步 ${MAX_NOTES_PER_PUSH} 篇笔记`);
    error.statusCode = 413;
    throw error;
  }

  const accepted = [];
  const conflicts = [];
  const baseSeq = Math.floor(Date.now() * 100);

  for (let index = 0; index < incoming.length; index += 1) {
    const note = incoming[index];
    const id = String(note.id || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      const error = new Error('笔记 ID 不合法');
      error.statusCode = 400;
      throw error;
    }
    validateEnvelope(note.cipher);

    const currentResult = await db.collection('notes_v1').doc(id).get();
    const current = currentResult.data && currentResult.data[0];
    const baseVersion = Number(note.baseVersion) || 0;
    if (current && Number(current.version) !== baseVersion) {
      conflicts.push(recordFromDocument(current));
      continue;
    }

    const version = current ? Number(current.version) + 1 : 1;
    const updatedAt = Date.now();
    const seq = baseSeq + index;
    await db.collection('notes_v1').doc(id).set({
      version,
      updatedAt,
      seq,
      cipher: note.cipher
    });
    accepted.push({ id, version, updatedAt, seq });
  }

  return { ok: true, accepted, conflicts };
}

exports.main = async function main(event) {
  const origin = headers(event).origin || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Origin not allowed' }) };
  }
  if (methodOf(event) === 'OPTIONS') return reply(204, {}, origin);
  if (methodOf(event) !== 'POST') return reply(405, { ok: false, error: 'Method not allowed' }, origin);
  if (typeof event.body === 'string' && event.body.length > MAX_REQUEST_CHARS) {
    return reply(413, { ok: false, error: '同步请求过大' }, origin);
  }

  try {
    const body = bodyOf(event);
    if (body.action === 'login') {
      await enforceRateLimit(event);
      if (!(await verifyAuthSecret(body.authSecret))) {
        await recordLoginResult(event, false);
        return reply(401, { ok: false, error: '笔记口令不正确' }, origin);
      }
      await recordLoginResult(event, true);
      return reply(200, { ok: true, ...signToken() }, origin);
    }
    if (body.action === 'pull') return reply(200, await pull(event, body), origin);
    if (body.action === 'push') return reply(200, await push(event, body), origin);
    return reply(400, { ok: false, error: '未知操作' }, origin);
  } catch (error) {
    console.error(error);
    return reply(error.statusCode || 500, {
      ok: false,
      error: error.statusCode ? error.message : '服务器内部错误'
    }, origin);
  }
};
