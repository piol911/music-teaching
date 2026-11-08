(function (root) {
  'use strict';

  const DB_NAME = 'xy6300-notes';
  const DB_VERSION = 2;
  let databasePromise = null;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('本地数据库事务已取消'));
    });
  }

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('当前浏览器不支持 IndexedDB'));
        return;
      }
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }

  async function getMeta(key) {
    const db = await open();
    const record = await requestToPromise(db.transaction('meta', 'readonly').objectStore('meta').get(key));
    return record ? record.value : undefined;
  }

  async function setMeta(key, value) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    await transactionDone(tx);
  }

  async function deleteMeta(key) {
    const db = await open();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(key);
    await transactionDone(tx);
  }

  async function getEncryptedRecords() {
    const db = await open();
    const tx = db.transaction('notes', 'readonly');
    return requestToPromise(tx.objectStore('notes').getAll());
  }

  async function loadNotes(key, cryptoApi) {
    const records = await getEncryptedRecords();
    const notes = [];
    for (const record of records) {
      try {
        const note = await cryptoApi.decryptJson(key, record.cipher);
        if (note && note.id) notes.push(note);
      } catch (error) {
        console.warn('无法解密本地笔记', record.id, error);
      }
    }
    return notes;
  }

  async function putEncryptedRecord(id, cipher) {
    const db = await open();
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put({ id, cipher });
    await transactionDone(tx);
  }

  async function putNote(key, cryptoApi, note) {
    const cipher = await cryptoApi.encryptJson(key, note);
    await putEncryptedRecord(note.id, cipher);
  }

  async function putNotes(key, cryptoApi, notes) {
    const encrypted = [];
    for (const note of notes) {
      encrypted.push({ id: note.id, cipher: await cryptoApi.encryptJson(key, note) });
    }
    const db = await open();
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    for (const record of encrypted) store.put(record);
    await transactionDone(tx);
  }

  async function clearAll() {
    const db = await open();
    const tx = db.transaction(['notes', 'meta', 'attachments'], 'readwrite');
    tx.objectStore('notes').clear();
    tx.objectStore('meta').clear();
    tx.objectStore('attachments').clear();
    await transactionDone(tx);
  }

  async function putAttachment(id, cipher) {
    const db = await open();
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').put({ id, cipher });
    await transactionDone(tx);
  }

  async function getAttachment(id) {
    const db = await open();
    const record = await requestToPromise(
      db.transaction('attachments', 'readonly').objectStore('attachments').get(id)
    );
    return record ? record.cipher : null;
  }

  async function deleteAttachment(id) {
    const db = await open();
    const tx = db.transaction('attachments', 'readwrite');
    tx.objectStore('attachments').delete(id);
    await transactionDone(tx);
  }

  root.NotesDB = {
    open,
    getMeta,
    setMeta,
    deleteMeta,
    loadNotes,
    putNote,
    putNotes,
    putAttachment,
    getAttachment,
    deleteAttachment,
    clearAll
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
