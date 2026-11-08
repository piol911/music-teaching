'use strict';

const crypto = require('node:crypto');

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('用法: node scripts/hash-password.js "至少10个字符的笔记口令"');
  process.exit(1);
}

const parameters = { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const browserSalt = 'xy6300-notes-v1|2026-11-08';
const derived = crypto.pbkdf2Sync(password.normalize('NFKC'), browserSalt, 600000, 96, 'sha256');
const authSecret = derived.subarray(48, 80).toString('hex');
const salt = crypto.randomBytes(24);
const hash = crypto.scryptSync(authSecret, salt, 32, parameters);
console.log(`scrypt$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString('hex')}$${hash.toString('hex')}`);
