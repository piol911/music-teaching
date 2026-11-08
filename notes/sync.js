(function (root) {
  'use strict';

  class NotesSync {
    constructor(apiUrl) {
      this.apiUrl = String(apiUrl || '').replace(/\/+$/, '');
    }

    get configured() {
      return /^https:\/\//.test(this.apiUrl);
    }

    async request(action, payload, token) {
      if (!this.configured) throw new Error('尚未配置云同步服务');
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ action, ...(payload || {}) })
      });
      let data = null;
      try { data = await response.json(); } catch (error) { /* 空响应 */ }
      if (!response.ok || !data || data.ok === false) {
        const message = data && data.error ? data.error : `同步服务返回 ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        err.data = data;
        throw err;
      }
      return data;
    }

    async login(authSecret) {
      const data = await this.request('login', { authSecret });
      if (!data.token) throw new Error('登录响应缺少访问令牌');
      return {
        token: data.token,
        expiresAt: Number(data.expiresAt) || Date.now() + 12 * 3600 * 1000
      };
    }

    async pull(token, cursor) {
      return this.request('pull', { cursor: Number(cursor) || 0 }, token);
    }

    async push(token, notes) {
      return this.request('push', { notes }, token);
    }
  }

  root.NotesSync = NotesSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
