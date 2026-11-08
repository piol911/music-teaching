'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

const stores = new Map();
function collectionStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  return stores.get(name);
}

const fakeDb = {
  command: { gt: value => ({ $gt: value }) },
  collection(name) {
    const store = collectionStore(name);
    return {
      doc(id) {
        return {
          async get() {
            return { data: store.has(id) ? [{ _id: id, ...store.get(id) }] : [] };
          },
          async set(data) {
            store.set(id, { ...data });
          }
        };
      },
      where(query) {
        let limitValue = 100;
        let order = 'asc';
        return {
          orderBy(_field, direction) { order = direction; return this; },
          limit(value) { limitValue = value; return this; },
          async get() {
            let rows = [...store.entries()].map(([id, data]) => ({ _id: id, ...data }));
            if (query.seq && Object.hasOwn(query.seq, '$gt')) rows = rows.filter(row => row.seq > query.seq.$gt);
            rows.sort((a, b) => order === 'asc' ? a.seq - b.seq : b.seq - a.seq);
            return { data: rows.slice(0, limitValue) };
          }
        };
      }
    };
  }
};

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') {
    return {
      SYMBOL_CURRENT_ENV: Symbol('env'),
      init: () => ({ database: () => fakeDb })
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const password = '后端测试笔记库口令 123';
const browserSalt = 'xy6300-notes-v1|2026-11-08';
const derived = crypto.pbkdf2Sync(password.normalize('NFKC'), browserSalt, 600000, 96, 'sha256');
const authSecret = derived.subarray(48, 80).toString('hex');
const salt = crypto.randomBytes(16);
const params = { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const hash = crypto.scryptSync(authSecret, salt, 32, params);
process.env.NOTES_PASSWORD_HASH = `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
process.env.NOTES_JWT_SECRET = 'test-jwt-secret-that-is-longer-than-thirty-two-characters';

const api = require('../index.js');

function event(body, token, origin) {
  return {
    httpMethod: 'POST',
    headers: {
      origin: origin || 'https://www.xy6300.cc',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-forwarded-for': '127.0.0.1'
    },
    body: JSON.stringify(body)
  };
}

test('rejects unknown origins before parsing credentials', async () => {
  const response = await api.main(event({ action: 'login', authSecret }, null, 'https://evil.example'));
  assert.equal(response.statusCode, 403);
});

test('login, pull, push and conflict protection', async () => {
  const login = await api.main(event({ action: 'login', authSecret }));
  assert.equal(login.statusCode, 200);
  const loginData = JSON.parse(login.body);
  assert.ok(loginData.token);

  const envelope = { v: 1, iv: 'abcdefghijkl', data: 'ciphertext' };
  const push = await api.main(event({
    action: 'push',
    notes: [{ id: 'note-a', baseVersion: 0, cipher: envelope }]
  }, loginData.token));
  assert.equal(push.statusCode, 200);
  const pushed = JSON.parse(push.body);
  assert.equal(pushed.accepted[0].version, 1);

  const pull = await api.main(event({ action: 'pull', cursor: 0 }, loginData.token));
  const pulled = JSON.parse(pull.body);
  assert.equal(pulled.records.length, 1);
  assert.equal(pulled.records[0].id, 'note-a');

  const stale = await api.main(event({
    action: 'push',
    notes: [{ id: 'note-a', baseVersion: 0, cipher: envelope }]
  }, loginData.token));
  const staleData = JSON.parse(stale.body);
  assert.equal(staleData.conflicts.length, 1);
  assert.equal(staleData.conflicts[0].version, 1);
});

test('wrong password is rejected', async () => {
  const response = await api.main(event({ action: 'login', authSecret: 'wrong-auth-secret' }));
  assert.equal(response.statusCode, 401);
});
