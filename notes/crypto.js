(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotesCrypto = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SALT = new TextEncoder().encode('xy6300-notes-v1|2026-11-08');
  const ITERATIONS = 600000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function subtle() {
    const value = globalThis.crypto && globalThis.crypto.subtle;
    if (!value) throw new Error('当前浏览器不支持 Web Crypto，请使用较新的浏览器');
    return value;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToHex(bytes) {
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function randomToken(bytes) {
    const value = new Uint8Array(bytes || 24);
    globalThis.crypto.getRandomValues(value);
    return bytesToHex(value);
  }

  async function deriveVault(passphrase) {
    const phrase = String(passphrase || '');
    if (phrase.length < 10) throw new Error('笔记库口令至少需要 10 个字符');

    const material = await subtle().importKey(
      'raw',
      encoder.encode(phrase.normalize('NFKC')),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await subtle().deriveBits(
      { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
      material,
      768
    );
    const all = new Uint8Array(bits);
    const vaultId = bytesToHex(all.slice(32, 48));
    const authSecret = bytesToHex(all.slice(48, 80));
    const key = await subtle().importKey(
      'raw',
      all.slice(0, 32),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    all.fill(0);
    return { key, vaultId, authSecret, iterations: ITERATIONS };
  }

  async function encryptJson(key, value) {
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const plain = encoder.encode(JSON.stringify(value));
    const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain);
    plain.fill(0);
    return {
      v: 1,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted))
    };
  }

  async function decryptJson(key, envelope) {
    if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.data) {
      throw new Error('加密数据格式不正确');
    }
    const decrypted = await subtle().decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
      key,
      base64ToBytes(envelope.data)
    );
    return JSON.parse(decoder.decode(decrypted));
  }

  async function encryptBytes(key, bytes) {
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return {
      v: 1,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted))
    };
  }

  async function decryptBytes(key, envelope) {
    if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.data) {
      throw new Error('加密附件格式不正确');
    }
    return subtle().decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
      key,
      base64ToBytes(envelope.data)
    );
  }

  async function fingerprint(value) {
    const digest = await subtle().digest('SHA-256', encoder.encode(String(value)));
    return bytesToHex(new Uint8Array(digest)).slice(0, 16);
  }

  return {
    ITERATIONS,
    deriveVault,
    encryptJson,
    decryptJson,
    encryptBytes,
    decryptBytes,
    randomToken,
    fingerprint
  };
});
