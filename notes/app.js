(function () {
  'use strict';

  const Core = window.NotesCore;
  const Crypto = window.NotesCrypto;
  const DB = window.NotesDB;
  const config = window.NOTES_CONFIG || {};
  const api = new window.NotesSync(config.apiUrl);
  const TOKEN_KEY = 'xy6300.notes.session';
  const VAULT_META = 'vault';
  const CURSOR_META = 'syncCursor';
  const ACTIVE_META = 'activeNoteId';
  const DEVICE_META = 'deviceId';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const refs = {
    app: $('#app'),
    menuBtn: $('#menuBtn'),
    closeMenuBtn: $('#closeMenuBtn'),
    listToggleBtn: $('#listToggleBtn'),
    listCollapseBtn: $('#listCollapseBtn'),
    mobileBackdrop: $('#mobileBackdrop'),
    sideNewBtn: $('#sideNewBtn'),
    settingsBtn: $('#settingsBtn'),
    syncBtn: $('#syncBtn'),
    syncDot: $('#syncDot'),
    syncLabel: $('#syncLabel'),
    searchInput: $('#searchInput'),
    listTitle: $('#listTitle'),
    listCount: $('#listCount'),
    noteList: $('#noteList'),
    allCount: $('#allCount'),
    folderTree: $('#folderTree'),
    folderInput: $('#folderInput'),
    tagCloud: $('#tagCloud'),
    importBtn: $('#importBtn'),
    exportBtn: $('#exportBtn'),
    attachmentBtn: $('#attachmentBtn'),
    addAttachmentBtn: $('#addAttachmentBtn'),
    attachmentInput: $('#attachmentInput'),
    lockBtn: $('#lockBtn'),
    importInput: $('#importInput'),
    emptyState: $('#emptyState'),
    editorShell: $('#editorShell'),
    editorBody: $('#editorBody'),
    liveEditor: $('#liveEditor'),
    noteOrdinal: $('#noteOrdinal'),
    noteDateKicker: $('#noteDateKicker'),
    backToListBtn: $('#backToListBtn'),
    titleInput: $('#titleInput'),
    saveLabel: $('#saveLabel'),
    wordCount: $('#wordCount'),
    noteTime: $('#noteTime'),
    syncHint: $('#syncHint'),
    noteExtras: $('#noteExtras'),
    attachmentList: $('#attachmentList'),
    embedList: $('#embedList'),
    attachmentDialog: $('#attachmentDialog'),
    attachmentDialogTitle: $('#attachmentDialogTitle'),
    attachmentDialogBody: $('#attachmentDialogBody'),
    convertAttachmentBtn: $('#convertAttachmentBtn'),
    printAttachmentBtn: $('#printAttachmentBtn'),
    downloadAttachmentBtn: $('#downloadAttachmentBtn'),
    closeAttachmentBtn: $('#closeAttachmentBtn'),
    deleteBtn: $('#deleteBtn'),
    backlinks: $('#backlinks'),
    backlinkCount: $('#backlinkCount'),
    backlinkList: $('#backlinkList'),
    sidebarResize: $('#sidebarResize'),
    listResize: $('#listResize'),
    vaultDialog: $('#vaultDialog'),
    vaultForm: $('#vaultForm'),
    vaultDialogTitle: $('#vaultDialogTitle'),
    vaultDialogCopy: $('#vaultDialogCopy'),
    confirmField: $('#confirmField'),
    vaultPassword: $('#vaultPassword'),
    vaultPasswordConfirm: $('#vaultPasswordConfirm'),
    vaultSubmitBtn: $('#vaultSubmitBtn'),
    vaultCloseBtn: $('#vaultCloseBtn'),
    syncDialog: $('#syncDialog'),
    syncForm: $('#syncForm'),
    syncPassword: $('#syncPassword'),
    syncSubmitBtn: $('#syncSubmitBtn'),
    syncCloseBtn: $('#syncCloseBtn'),
    syncError: $('#syncError'),
    settingsDialog: $('#settingsDialog'),
    settingStorage: $('#settingStorage'),
    settingCount: $('#settingCount'),
    settingCloud: $('#settingCloud'),
    settingVault: $('#settingVault'),
    changeDeviceBtn: $('#changeDeviceBtn'),
    resetDeviceBtn: $('#resetDeviceBtn'),
    dedupeBtn: $('#dedupeBtn'),
    toast: $('#toast')
  };

  const state = {
    key: null,
    vaultId: '',
    deviceId: '',
    notes: [],
    activeId: '',
    tag: '',
    folder: '',
    collapsed: new Set(),
    query: '',
    sidebarCollapsed: false,
    listCollapsed: false,
    sidebarWidth: 230,
    listWidth: 320,
    syncState: 'local',
    syncAt: 0,
    saveTimer: null,
    syncTimer: null,
    renderTimer: null,
    syncRunning: false,
    syncQueued: false,
    vaultReady: false,
    syncManual: false,
    unlockOnly: false,
    editor: null,
    attachmentUrls: new Map(),
    activeAttachment: null,
    extrasTimer: null
  };

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Crypto.randomToken(16);
  }

  function now() {
    return Date.now();
  }

  function normalizeTag(value) {
    return String(value || '')
      .trim()
      .replace(/^#/, '')
      .replace(/\s+/g, '-')
      .slice(0, 32);
  }

  function uniqueTags(values) {
    const tags = [];
    const seen = new Set();
    for (const value of values || []) {
      const tag = normalizeTag(value);
      const key = tag.toLocaleLowerCase('zh-CN');
      if (tag && !seen.has(key)) {
        seen.add(key);
        tags.push(tag);
      }
    }
    return tags;
  }

  function normalizeNote(input) {
    const stamp = now();
    const requestedId = String(input.id || '');
    const id = /^[A-Za-z0-9_-]{1,64}$/.test(requestedId) ? requestedId : uid();
    const folderTags = Core.normalizeFolder(input.folder).split('/').filter(Boolean);
    let body = String(input.body || '');
    const bodyTags = Core.extractTags(body);
    const legacyTags = uniqueTags([
      ...(Array.isArray(input.manualTags) ? input.manualTags : []),
      ...folderTags
    ]).filter(tag => !bodyTags.some(item => item.toLocaleLowerCase('zh-CN') === tag.toLocaleLowerCase('zh-CN')));
    if (legacyTags.length) {
      body = `${body.replace(/\s*$/, '')}\n\n${legacyTags.map(tag => `#${tag}`).join(' ')}`;
    }
    const tags = Core.extractTags(body);
    return {
      id,
      title: String(input.title || '未命名笔记').trim() || '未命名笔记',
      body,
      folder: '',
      tags,
      attachments: Array.isArray(input.attachments)
        ? input.attachments.filter(item => item && /^[a-f0-9]{24,64}$/i.test(String(item.id || ''))).map(item => ({
            id: String(item.id),
            name: String(item.name || '未命名文件'),
            type: String(item.type || 'application/octet-stream'),
            size: Number(item.size) || 0,
            kind: String(item.kind || 'file'),
            createdAt: Number(item.createdAt) || stamp
          }))
        : [],
      createdAt: Number(input.createdAt) || stamp,
      updatedAt: Number(input.updatedAt) || stamp,
      deleted: !!input.deleted,
      version: Number(input.version) || 0,
      serverUpdatedAt: Number(input.serverUpdatedAt) || 0,
      dirty: input.dirty !== false,
      sourcePath: String(input.sourcePath || '')
    };
  }

  function makeNote(values) {
    return normalizeNote({
      id: uid(),
      title: '未命名笔记',
      body: '',
      createdAt: now(),
      updatedAt: now(),
      dirty: true,
      ...(values || {})
    });
  }

  function activeNote() {
    return state.notes.find(note => note.id === state.activeId && !note.deleted) || null;
  }

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add('on');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => refs.toast.classList.remove('on'), 2400);
  }

  function setSaveLabel() { /* 「已保存到本机」那行已移除，状态统一在右上角 */ }

  function setSyncState(kind, label) {
    state.syncState = kind;
    refs.syncDot.className = `sync-dot ${kind}`;
    refs.syncLabel.textContent = label;
    const text = kind === 'ok'
      ? `已同步 ${Core.formatRelativeTime(state.syncAt, now())}`
      : kind === 'syncing'
        ? '正在同步'
        : kind === 'pending'
          ? '本地已保存，等待同步'
          : kind === 'offline'
            ? '离线编辑中，联网后自动同步'
            : kind === 'error'
              ? '同步失败，本地内容仍然保留'
              : '仅保存在本机，登录后可自动同步';
    if (refs.syncHint) refs.syncHint.textContent = '';
  }

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (value && value.token && value.expiresAt > now()) return value;
      localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
    }
    return null;
  }

  function writeSession(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, JSON.stringify(value));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (error) { /* 忽略会话存储失败 */ }
  }

  function notesInScope() {
    return Core.searchNotes(state.notes, state.query, state.folder, state.tag);
  }


  /* ---------- 文件夹树（参照 Osprey 的文件树：小字号、可折叠） ---------- */
  function folderTreeData() {
    const root = { name: '', path: '', children: new Map(), count: 0 };
    for (const note of state.notes) {
      if (note.deleted) continue;
      root.count += 1;
      const path = Core.normalizeFolder(note.folder);
      if (!path) continue;
      let node = root;
      let acc = '';
      for (const part of path.split('/')) {
        acc = acc ? `${acc}/${part}` : part;
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, path: acc, children: new Map(), count: 0 });
        }
        node = node.children.get(part);
        node.count += 1;
      }
    }
    return root;
  }

  function renderFolderTree() {
    if (!refs.folderTree) return;
    const root = folderTreeData();
    if (!root.children.size) {
      refs.folderTree.innerHTML = '<div class="folder-tree-empty">还没有文件夹（导入 Markdown 目录会自动生成）</div>';
      return;
    }
    const rows = [];
    const walk = (node, depth) => {
      const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      for (const child of kids) {
        const open = !state.collapsed.has(child.path);
        rows.push(
          `<button class="folder-row${state.folder === child.path ? ' active' : ''}" data-path="${Core.escapeHtml(child.path)}" style="padding-left:${6 + depth * 12}px">`
          + `<span class="folder-arrow${open && child.children.size ? ' open' : ''}">${child.children.size ? '▶' : ''}</span>`
          + `<span class="folder-name">${Core.escapeHtml(child.name)}</span>`
          + `<span class="folder-count">${child.count}</span>`
          + `</button>`
        );
        if (open) walk(child, depth + 1);
      }
    };
    walk(root, 0);
    refs.folderTree.innerHTML = rows.join('');
  }

  function renderSidebar() {
    const allButton = $('.nav-row[data-folder=""]');
    allButton.classList.toggle('active', !state.tag && !state.folder);
    if (!state.tag) allButton.setAttribute('aria-current', 'page');
    else allButton.removeAttribute('aria-current');
    refs.allCount.textContent = state.notes.filter(note => !note.deleted).length;
    renderFolderTree();
  }

  function allTags() {
    const counts = new Map();
    for (const note of state.notes) {
      if (note.deleted) continue;
      for (const tag of note.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }

  function renderTags() {
    const all = allTags();
    const tags = all.slice(0, 30);
    refs.tagCloud.innerHTML = tags.length
      ? tags.map(([tag, count]) => `<button class="tag-chip${state.tag === tag ? ' active' : ''}" type="button" data-tag="${Core.escapeHtml(tag)}" aria-pressed="${state.tag === tag}">#${Core.escapeHtml(tag)} <span>${count}</span></button>`).join('')
      : '<span class="eyebrow">暂无标签</span>';
  }

  function fileKind(file) {
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'spreadsheet';
    return 'file';
  }

  function formatBytes(size) {
    const value = Number(size) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function attachmentKindLabel(kind) {
    return {
      image: 'IMG',
      pdf: 'PDF',
      docx: 'DOC',
      spreadsheet: 'XLS',
      file: 'FILE'
    }[kind] || 'FILE';
  }

  async function getAttachmentFile(meta) {
    if (state.attachmentUrls.has(meta.id)) return state.attachmentUrls.get(meta.id);
    let cipher = await DB.getAttachment(meta.id);
    if (!cipher && meta.oss && window.NotesOSS) {
      // 换设备打开时本机还没有这份附件 —— 从 OSS 拉密文，顺便缓存一份到本机
      try {
        const packed = await NotesOSS.getAttachment(meta.id);
        if (packed) {
          cipher = unpackCipher(packed);
          if (cipher) await DB.putAttachment(meta.id, cipher);
        }
      } catch (error) {
        console.warn('云端附件拉取失败', error);
      }
    }
    if (!cipher) return null;
    const plain = await Crypto.decryptBytes(state.key, cipher);
    const blob = new Blob([plain], { type: meta.type || 'application/octet-stream' });
    const file = new File([blob], meta.name, { type: meta.type || blob.type });
    const value = { blob, file, url: URL.createObjectURL(blob) };
    state.attachmentUrls.set(meta.id, value);
    return value;
  }

  async function purgeAttachment(id) {
    await DB.deleteAttachment(id);
    if (window.NotesOSS) { try { await NotesOSS.deleteAttachment(id); } catch (e) { /* 尽力而为 */ } }
  }

  function revokeAttachment(id) {
    const value = state.attachmentUrls.get(id);
    if (value) URL.revokeObjectURL(value.url);
    state.attachmentUrls.delete(id);
  }

  function renderEmbeds(note) {
    const body = note.body || '';
    const cards = [];
    const seen = new Set();
    const bili = /https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[A-Za-z0-9]+)/g;
    for (const match of body.matchAll(bili)) {
      if (seen.has(match[1]) || cards.length >= 4) continue;
      seen.add(match[1]);
      cards.push(`
        <div class="embed-card">
          <div class="embed-card-head"><span>Bilibili</span><span>${Core.escapeHtml(match[1])}</span></div>
          <iframe src="https://player.bilibili.com/player.html?bvid=${encodeURIComponent(match[1])}&page=1&high_quality=1"
            title="Bilibili 视频 ${Core.escapeHtml(match[1])}" loading="lazy" allowfullscreen></iframe>
        </div>
      `);
    }
    const xhs = /https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[A-Za-z0-9]+[^\s)]*/g;
    for (const match of body.matchAll(xhs)) {
      if (seen.has(match[0]) || cards.length >= 4) continue;
      seen.add(match[0]);
      cards.push(`
        <div class="embed-card">
          <div class="embed-card-head"><span>小红书</span><span>外部预览</span></div>
          <a class="embed-link" href="${Core.escapeHtml(match[0])}" target="_blank" rel="noopener noreferrer">打开小红书原视频<br>${Core.escapeHtml(match[0])}</a>
        </div>
      `);
    }
    refs.embedList.innerHTML = cards.join('');
    return cards.length;
  }

  async function renderNoteExtras(note) {
    if (!note) {
      refs.noteExtras.hidden = true;
      refs.attachmentList.innerHTML = '';
      refs.embedList.innerHTML = '';
      return;
    }
    const embedCount = renderEmbeds(note);
    const attachments = note.attachments || [];
    refs.noteExtras.hidden = !attachments.length && !embedCount;
    if (!attachments.length) {
      refs.attachmentList.innerHTML = '';
      return;
    }

    refs.attachmentList.innerHTML = attachments.map(meta => `
      <div class="attachment-card" data-attachment="${meta.id}">
        <button class="attachment-preview-btn" type="button" data-open-attachment="${meta.id}" aria-label="预览 ${Core.escapeHtml(meta.name)}">
          <span class="attachment-type">${attachmentKindLabel(meta.kind)}</span>
          <span class="attachment-info">
            <span class="attachment-name">${Core.escapeHtml(meta.name)}</span>
            <span class="attachment-size">${formatBytes(meta.size)}</span>
          </span>
        </button>
        <button class="attachment-remove" type="button" data-remove-attachment="${meta.id}" aria-label="删除附件 ${Core.escapeHtml(meta.name)}">×</button>
      </div>
    `).join('');

    for (const meta of attachments.filter(item => item.kind === 'image')) {
      try {
        const value = await getAttachmentFile(meta);
        if (!value) continue;
        const card = refs.attachmentList.querySelector(`[data-attachment="${meta.id}"]`);
        const placeholder = card && card.querySelector('.attachment-type');
        if (!placeholder) continue;
        const image = document.createElement('img');
        image.className = 'attachment-thumb';
        image.src = value.url;
        image.alt = meta.name;
        placeholder.replaceWith(image);
      } catch (error) {
        console.warn('无法读取附件', meta.id, error);
      }
    }
  }

  function renderExtrasSoon() {
    clearTimeout(state.extrasTimer);
    state.extrasTimer = setTimeout(() => renderNoteExtras(activeNote()), 220);
  }

  function renderList() {
    const notes = notesInScope();
    refs.listCount.textContent = String(notes.length);
    refs.listTitle.textContent = state.tag
      ? `#${state.tag}`
      : (state.query ? '搜索结果' : '全部笔记');

    if (!notes.length) {
      refs.noteList.innerHTML = `<div class="list-empty">${state.query ? '没有找到匹配的笔记' : '这里还没有笔记'}</div>`;
      return;
    }

    /* ---------- 文件夹 + 笔记合成一棵树（参照 Obsidian） ---------- */
    const root = { name: '', path: '', children: new Map(), notes: [] };
    for (const note of notes) {
      const path = Core.normalizeFolder(note.folder);
      if (!path) { root.notes.push(note); continue; }
      let node = root, acc = '';
      for (const part of path.split('/')) {
        acc = acc ? acc + '/' + part : part;
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, path: acc, children: new Map(), notes: [] });
        }
        node = node.children.get(part);
      }
      node.notes.push(note);
    }

    const countIn = node => node.notes.length + [...node.children.values()].reduce((sum, c) => sum + countIn(c), 0);
    const snippetOf = note => note.body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || '空白笔记';

    const rows = [];
    const noteRow = (note, depth) => `<button class="note-row${note.id === state.activeId ? ' active' : ''}" type="button" data-id="${note.id}" style="padding-left:${14 + depth * 14}px">
        <span class="note-main">
          <span class="note-row-top">
            <span class="note-title">${Core.escapeHtml(note.title)}</span>
            <span class="note-time">${Core.formatRelativeTime(note.updatedAt, now())}</span>
          </span>
          <span class="note-snippet">${Core.escapeHtml(snippetOf(note))}</span>
          ${note.tags.length ? `<span class="note-tags">${note.tags.slice(0, 4).map(tag => `<span>#${Core.escapeHtml(tag)}</span>`).join('')}</span>` : ''}
        </span>
      </button>`;

    const walk = (node, depth) => {
      const folders = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      for (const folder of folders) {
        const open = !state.collapsed.has(folder.path);
        rows.push(`<button class="tree-folder${open ? ' open' : ''}" type="button" data-tree="${Core.escapeHtml(folder.path)}" style="padding-left:${8 + depth * 14}px">
            <span class="tf-arrow">▶</span>
            <span class="tf-name">${Core.escapeHtml(folder.name)}</span>
            <span class="tf-count">${countIn(folder)}</span>
          </button>`);
        if (open) walk(folder, depth + 1);
      }
      for (const note of node.notes.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
        rows.push(noteRow(note, depth));
      }
    };
    walk(root, 0);
    refs.noteList.innerHTML = rows.join('');
  }

  function renderEditor() {
    const note = activeNote();
    const hasNote = !!note;
    refs.emptyState.hidden = hasNote;
    refs.editorShell.hidden = !hasNote;
    if (!note) {
      document.body.classList.remove('note-open');
      renderNoteExtras(null);
      return;
    }

    const ordered = Core.searchNotes(state.notes, '', '', '');
    const noteNumber = ordered.findIndex(item => item.id === note.id) + 1;
    if (refs.folderInput) refs.folderInput.value = note.folder || '';
    if (refs.noteOrdinal) refs.noteOrdinal.textContent = `NOTE ${String(Math.max(1, noteNumber)).padStart(2, '0')}`;
    if (refs.noteDateKicker) refs.noteDateKicker.textContent = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(note.updatedAt)).replace(/\//g, '.');
    refs.titleInput.value = note.title;
    if (state.editor && state.editor.getValue() !== note.body) state.editor.setValue(note.body);
    refs.wordCount.textContent = `${note.body.replace(/\s/g, '').length.toLocaleString('zh-CN')} 字`;
    if (refs.noteTime) refs.noteTime.textContent = new Date(note.updatedAt).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    renderBacklinks();
    renderNoteExtras(note);
  }

  function renderBacklinks() {
    const note = activeNote();
    if (!note) {
      refs.backlinks.hidden = true;
      return;
    }
    const links = Core.backlinksFor(state.notes, note.title);
    refs.backlinks.hidden = links.length === 0;
    refs.backlinkCount.textContent = String(links.length);
    refs.backlinkList.innerHTML = links.map(item =>
      `<button class="backlink-item" type="button" data-id="${item.id}">${Core.escapeHtml(item.title)}</button>`
    ).join('');
  }

  function renderAll() {
    renderSidebar();
    renderTags();
    renderList();
    renderEditor();
  }

  function renderListSoon() {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => {
      renderList();
      renderTags();
      renderSidebar();
    }, 180);
  }

  function selectNote(id, options) {
    if (state.activeId && state.activeId !== id) saveNow();
    const note = state.notes.find(item => item.id === id && !item.deleted);
    if (!note) return;
    state.activeId = note.id;
    DB.setMeta(ACTIVE_META, note.id).catch(() => {});
    document.body.classList.add('note-open');
    const bbL = document.getElementById('bbList'); if (bbL) bbL.classList.remove('on');
    document.body.classList.remove('menu-open');
    refs.menuBtn.setAttribute('aria-expanded', String(window.innerWidth > 900 && !state.sidebarCollapsed));
    renderList();
    renderEditor();
    if (!options || options.focus !== false) {
      setTimeout(() => {
        if (window.innerWidth > 620 && state.editor) state.editor.focus();
      }, 20);
    }
  }

  function createNote(values) {
    saveNow();
    const note = makeNote(values);
    state.notes.push(note);
    state.tag = '';
    DB.putNote(state.key, Crypto, note).catch(error => showToast(`保存失败：${error.message}`));
    selectNote(note.id);
    renderAll();
    setSaveLabel('已保存到本机');
    scheduleSync();
    return note;
  }

  function updateFromInputs() {
    const note = activeNote();
    if (!note) return;
    note.title = refs.titleInput.value.trim() || '未命名笔记';
    noteChanged(note);
  }

  function updateBody(value) {
    const note = activeNote();
    if (!note) return;
    note.body = String(value || '');
    noteChanged(note);
  }

  function noteChanged(note) {
    note.tags = Core.extractTags(note.body);
    note.updatedAt = now();
    note.dirty = true;
    refs.wordCount.textContent = `${note.body.replace(/\s/g, '').length.toLocaleString('zh-CN')} 字`;
    if (refs.noteTime) refs.noteTime.textContent = new Date(note.updatedAt).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    setSaveLabel('保存中…');
    if (!navigator.onLine) setSyncState('offline', '离线编辑');
    else if (!readSession()) setSyncState('local', '仅本机');
    else setSyncState('pending', '等待同步');
    renderListSoon();
    renderExtrasSoon();
    scheduleSave();
    scheduleSync();
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 420);
  }

  function saveNow() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    const note = activeNote();
    if (!note || !state.key) return;
    if (note.title === '未命名笔记' && !note.body.trim()) {
      setSaveLabel('已保存到本机');
      return;
    }
    DB.putNote(state.key, Crypto, note)
      .then(() => setSaveLabel('已保存到本机'))
      .catch(error => {
        setSaveLabel('保存失败');
        showToast(`保存失败：${error.message}`);
      });
  }

  function deleteActive() {
    const note = activeNote();
    if (!note) return;
    if (!confirm(`删除「${note.title}」？删除记录会同步到其他设备。`)) return;
    note.deleted = true;
    note.dirty = true;
    note.updatedAt = now();
    DB.putNote(state.key, Crypto, note).catch(() => {});
    const next = notesInScope().find(item => item.id !== note.id);
    state.activeId = next ? next.id : '';
    if (next) {
      selectNote(next.id, { focus: false });
    } else {
      document.body.classList.remove('note-open');
      renderAll();
    }
    scheduleSync();
    showToast('笔记已移到删除记录');
  }


  /* 显示/隐藏口令：看得见就不容易输错，比让用户重复输两遍靠谱 */
  document.addEventListener('click', e => {
    const btn = e.target.closest('.pw-eye');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.eye);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '隐藏' : '显示';
    input.focus();
  });

  async function setupVault(password, confirmation) {
    if (!password || password.length < 10) throw new Error('笔记库口令至少需要 10 个字符');
    // 「再输入一次」已去掉：口令框自带「显示」按钮，看得见就不会输错
    refs.vaultSubmitBtn.disabled = true;
    refs.vaultSubmitBtn.textContent = '正在建立加密笔记库…';
    try {
      const derived = await Crypto.deriveVault(password);
      const existing = await DB.getMeta(VAULT_META);
      if (existing && existing.vaultId && existing.vaultId !== derived.vaultId && !state.vaultResetAllowed) {
        throw new Error('这个口令与当前设备上的笔记库不一样。若是想换成别的口令，请先在「笔记库设置 → 清除本机笔记缓存」。');
      }
      if (state.vaultResetAllowed) {
        // 之前那个口令解不开云端内容 —— 允许直接换成本次输入的口令
        state.vaultResetAllowed = false;
        state.notes = [];
        state.activeId = '';
      }
      state.key = derived.key;
      state.vaultId = derived.vaultId;
      await DB.setMeta(VAULT_META, {
        v: 1,
        vaultId: derived.vaultId,
        key: derived.key,
        iterations: derived.iterations,
        authSecret: derived.authSecret,   // 登录凭据：和密钥同级存放，免得每次同步都重输口令
        createdAt: existing && existing.createdAt || now()
      });
      state.vaultReady = true;
      state.unlockOnly = false;
      refs.vaultDialog.close();
      const pending = state.notes || [];      // 设口令前内存里可能已经写了几条
      await startNotes();
      if (pending.length && !state.notes.length) {
        state.notes = pending.map(n => ({ ...normalizeNote(n), dirty: true }));   // 必须标脏才会推送
        for (const note of state.notes) await DB.putNote(state.key, Crypto, note);
        renderAll();
        showToast(`已把 ${state.notes.length} 条笔记存进加密笔记库`);
      }
    } finally {
      refs.vaultSubmitBtn.disabled = false;
      refs.vaultSubmitBtn.textContent = state.unlockOnly ? '解锁' : '开始使用';
      refs.vaultPassword.value = '';
      if (refs.vaultPasswordConfirm) refs.vaultPasswordConfirm.value = '';
    }
  }

  async function startNotes() {
    state.notes = await DB.loadNotes(state.key, Crypto);
    if (!state.notes.length) {
      state.notes.push(makeNote({
        title: '欢迎来到私人笔记',
        body: '# 欢迎来到私人笔记\n\n这里是你的加密笔记库。\n\n- 右上角 **＋** 新建笔记\n- 用 `⌘K` 搜索\n- 用 `[[笔记标题]]` 建立双向链接\n- 在「位置」里输入 `100-工作/教学` 即可建立文件夹层级\n\n> 笔记正文会在浏览器中加密，再同步到云端。\n\n#开始',
        folder: '',
        dirty: false,
        updatedAt: now()
      }));
      await DB.putNotes(state.key, Crypto, state.notes);
    }

    state.notes = state.notes.map(normalizeNote);
    const lastActive = await DB.getMeta(ACTIVE_META);
    state.activeId = state.notes.some(note => note.id === lastActive && !note.deleted)
      ? lastActive
      : (notesInScope()[0] || {}).id || '';
    if (state.activeId) document.body.classList.add('note-open');
    renderAll();
    updateOnlineState();
    const session = readSession();
    if (session) scheduleSync(350);
    registerServiceWorker();
  }

  function updateOnlineState() {
    if (!navigator.onLine) {
      setSyncState('offline', '离线编辑');
      return;
    }
    if (!readSession()) {
      setSyncState('local', '仅本机');
      if (refs.syncHint) refs.syncHint.textContent = '';
      return;
    }
    if (state.syncState !== 'syncing') {
      if (state.notes.some(note => note.dirty)) setSyncState('pending', '等待同步');
      else setSyncState('ok', '已同步');
    }
  }

  function scheduleSync(delay) {
    if (!state.vaultReady || !readSession() || !navigator.onLine) return;
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(syncNow, Number(delay) || 1200);
  }

  function noteContentEqual(a, b) {
    if (!a || !b) return false;
    const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
    return norm(a.title) === norm(b.title) &&
      norm(a.body) === norm(b.body) &&
      norm(a.folder) === norm(b.folder) &&
      !!a.deleted === !!b.deleted;
  }

  function conflictCopy(local, remote) {
    if (noteContentEqual(local, remote)) return null;
    /* 副本只留在这台设备上当备份：不标脏、不推送。
       否则副本会被推上去、又被拉回来，再生成新的副本 —— 之前冲突刷屏就是这么来的。 */
    return normalizeNote({
      ...local,
      id: uid(),
      title: `${local.title}（备份 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）`,
      sourcePath: '',
      version: 0,
      serverUpdatedAt: 0,
      dirty: false,
      copyOf: local.id,
      createdAt: now(),
      updatedAt: now()
    });
  }

  async function applyRemoteRecord(record) {
    if (!record || !record.id || !record.cipher) return [];
    let plain;
    try {
      plain = await Crypto.decryptJson(state.key, record.cipher);
    } catch (error) {
      // 多半是另一台设备用了不同的笔记口令 —— 解不开就跳过，并记账提示
      state.decryptFailures = (state.decryptFailures || 0) + 1;
      return [];
    }
    const remote = normalizeNote({
      ...plain,
      id: record.id,
      version: Number(record.version) || 0,
      serverUpdatedAt: Number(record.updatedAt) || 0,
      dirty: false
    });
    const index = state.notes.findIndex(note => note.id === record.id);
    const local = index >= 0 ? state.notes[index] : null;
    const added = [];

    if (!local) {
      state.notes.push(remote);
      await DB.putNote(state.key, Crypto, remote);
      return [remote.id];
    }

    if (local.dirty) {
      // 同一条本地笔记只备份一次，别每次拉取都造一份
      const already = state.notes.some(note => note.copyOf === local.id);
      if (!already) {
        const copy = conflictCopy(local, remote);
        if (copy) {
          state.notes.push(copy);
          await DB.putNote(state.key, Crypto, copy);
          added.push(copy.id);
        }
      }
    }

    state.notes[index] = remote;
    await DB.putNote(state.key, Crypto, remote);
    return [remote.id, ...added];
  }

  async function pullChanges(token) {
    let cursor = Number(await DB.getMeta(CURSOR_META)) || 0;
    let changed = false;
    const stat = { fetched: 0, applied: 0, failed: 0 };
    for (let page = 0; page < 20; page += 1) {
      const data = await api.pull(token, cursor);
      for (const record of data.records || []) {
        stat.fetched += 1;
        const before = state.decryptFailures || 0;
        await applyRemoteRecord(record);
        if ((state.decryptFailures || 0) > before) stat.failed += 1;
        else stat.applied += 1;
        changed = true;
      }
      cursor = Number(data.cursor) || cursor;
      await DB.setMeta(CURSOR_META, cursor);
      if (!data.hasMore) break;
    }
    if (changed) renderAll();
    state.lastPullStat = stat;
    if (state.decryptFailures) {
      const n = state.decryptFailures;
      state.decryptFailures = 0;
      showToast(`${n} 条云端笔记用当前口令解不开（另一台设备可能用了不同的笔记口令）`);
    }
  }

  async function pushChanges(token) {
    let remaining = state.notes.filter(note => note.dirty);
    while (remaining.length) {
      const batch = [];
      let batchChars = 0;
      for (const note of remaining) {
        const item = {
          id: note.id,
          baseVersion: Number(note.version) || 0,
          cipher: await Crypto.encryptJson(state.key, {
            title: note.title,
            body: note.body,
            folder: note.folder,
            tags: note.tags,
            attachments: note.attachments,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            deleted: note.deleted,
            sourcePath: note.sourcePath
          })
        };
        const size = JSON.stringify(item).length;
        if (batch.length && (batch.length >= 8 || batchChars + size > 70000)) break;
        if (size > 70000) throw new Error(`「${note.title}」过长，暂时无法同步`);
        batch.push({ note, item });
        batchChars += size;
      }
      if (!batch.length) break;

      const data = await api.push(token, batch.map(entry => entry.item));
      const accepted = new Map((data.accepted || []).map(item => [item.id, item]));
      const conflicted = new Set((data.conflicts || []).map(item => item.id));
      for (const { note } of batch) {
        if (conflicted.has(note.id)) {
          // 版本被别人抢先了：本地内容已经在备份里，这里就地接受云端版本，别再重试
          note.dirty = false;
          await DB.putNote(state.key, Crypto, note);
          continue;
        }
        const result = accepted.get(note.id);
        if (!result) continue;
        note.version = Number(result.version) || note.version;
        note.serverUpdatedAt = Number(result.updatedAt) || now();
        note.dirty = false;
        await DB.putNote(state.key, Crypto, note);
      }
      for (const conflict of data.conflicts || []) await applyRemoteRecord(conflict);
      const handled = new Set(batch.map(entry => entry.note.id));
      remaining = remaining.filter(note => note.dirty && !handled.has(note.id));
    }
  }

  async function syncNow() {
    clearTimeout(state.syncTimer);
    if (!state.vaultReady || !navigator.onLine) {
      updateOnlineState();
      return;
    }
    const session = readSession();
    if (!session) {
      setSyncState('local', '仅本机');
      return;
    }
    if (!api.configured) {
      setSyncState('error', '未配置');
      showToast('云同步地址尚未配置');
      return;
    }
    if (state.syncRunning) {
      state.syncQueued = true;
      return;
    }

    state.syncRunning = true;
    setSyncState('syncing', '同步中');
    try {
      saveNow();
      const stat = await pullChanges(session.token);
      await pushChanges(session.token);
      state.syncAt = now();
      setSyncState('ok', '已同步');
      /* 一句话说清这次同步干了什么 —— 「怎么是空的」就靠它定位 */
      const st = state.lastPullStat || stat || { fetched: 0, applied: 0, failed: 0 };
      /* 只有「用户自己点的同步」才弹结果；后台每 30 秒自动同步保持安静 */
      const manual = state.syncManual;
      state.syncManual = false;
      if (!manual) {
        // 后台同步：什么都不弹
      } else if (!st.fetched) {
        // 情况 A：云端是空的 —— 这是新笔记本，不是口令问题
        showToast('同步完成：云端还没有内容（这是一本新笔记本）');
      } else if (st.applied > 0 && st.failed === 0) {
        // 情况 B：正常
        showToast(`同步完成：云端 ${st.fetched} 条已全部同步`);
      } else if (st.applied === 0 && st.failed > 0) {
        // 情况 C：云端有内容，但一条都解不开 —— 口令不对
        state.vaultResetAllowed = true;
        showToast(`⚠️ 云端有 ${st.fetched} 条笔记，但当前口令一条都解不开 —— 口令很可能不对`, 6000);
        setTimeout(() => {
          state.unlockOnly = false;
          refs.vaultDialogTitle.textContent = '口令可能不对';
          refs.vaultDialogCopy.textContent = `云端有 ${st.fetched} 条笔记，用当前口令打不开。请重新输入「当初写入这些笔记时用的」那个口令；确认后会用它替换当前口令。`;
          if (refs.confirmField) refs.confirmField.hidden = true;
          refs.vaultSubmitBtn.textContent = '用这个口令重试';
          refs.vaultDialog.showModal();
          setTimeout(() => refs.vaultPassword.focus(), 100);
        }, 500);
      } else if (manual) {
        showToast(`同步完成：云端 ${st.fetched} 条，解开 ${st.applied} 条，${st.failed} 条解不开`);
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        writeSession(null);
        setSyncState('local', '需登录');
        showToast('登录已过期，请重新连接云同步');
      } else {
        setSyncState(navigator.onLine ? 'error' : 'offline', navigator.onLine ? '同步失败' : '离线编辑');
        showToast(`同步失败：${error.message}`);
      }
    } finally {
      state.syncRunning = false;
      if (state.syncQueued) {
        state.syncQueued = false;
        scheduleSync(500);
      }
    }
  }

  async function connectCloud(password) {
    /* 这台设备还没建加密笔记库：不是口令错，是还没有口令。
       直接把人带去「设置口令」，别再丢一句看不懂的报错。 */
    if (!state.vaultId) {
      refs.syncDialog.close();
      state.unlockOnly = false;
      refs.vaultDialogTitle.textContent = '设置笔记口令';
      refs.vaultDialogCopy.textContent = '这台设备还没有笔记口令。设一个好记的（10 个字符以上，比如一句话），它同时是加密密钥和登录口令；换设备输入同一个即可。';
      if (refs.confirmField) refs.confirmField.hidden = false;
      refs.vaultSubmitBtn.textContent = '开始使用';
      refs.vaultDialog.showModal();
      setTimeout(() => refs.vaultPassword.focus(), 100);
      return;
    }
    refs.syncSubmitBtn.disabled = true;
    refs.syncSubmitBtn.textContent = '正在验证…';
    refs.syncError.textContent = '';
    try {
      /* 不给口令就用本机存好的登录凭据（正常情况都走这条路，不用重输） */
      let authSecret;
      if (password) {
        const derived = await Crypto.deriveVault(password);
        if (state.vaultId && derived.vaultId !== state.vaultId) {
          throw new Error('这个口令和本机笔记库的口令不一样。请用创建笔记库时设的那个口令；忘了的话，可在「笔记库设置 → 清除本机笔记缓存」后用新口令重开。');
        }
        state.key = derived.key;
        state.vaultId = derived.vaultId;
        authSecret = derived.authSecret;
        const meta = await DB.getMeta(VAULT_META) || {};
        meta.v = 1; meta.vaultId = derived.vaultId; meta.key = derived.key;
        meta.iterations = derived.iterations; meta.authSecret = authSecret;
        meta.createdAt = meta.createdAt || now();
        await DB.setMeta(VAULT_META, meta);
      } else {
        const meta = await DB.getMeta(VAULT_META);
        authSecret = meta && meta.authSecret;
        if (!authSecret) throw new Error('本机还没有登录凭据，请输入一次笔记口令');
      }
      const session = await api.login(authSecret);
      writeSession(session);
      refs.syncDialog.close();
      refs.syncPassword.value = '';
      await syncNow();
    } catch (error) {
      refs.syncError.textContent = error.message;
    } finally {
      refs.syncSubmitBtn.disabled = false;
      refs.syncSubmitBtn.textContent = '连接并同步';
    }
  }

  async function importFiles(fileList) {
    const files = [...fileList].filter(file => /\.(md|markdown|txt)$/i.test(file.name));
    if (!files.length) {
      showToast('没有找到 Markdown 文件');
      return;
    }
    showToast(`正在导入 ${files.length} 个文件…`);
    const imported = [];
    for (const file of files) {
      const relative = file.webkitRelativePath || file.name;
      const parts = relative.split('/').filter(Boolean);
      if (parts.some(part => part.startsWith('.') || part === 'node_modules')) continue;
      const filename = parts.pop();
      if (parts.length) parts.shift();
      const importedTags = uniqueTags(parts.flatMap(part => part.split('/')));
      let body = await file.text();
      const bodyTags = Core.extractTags(body).map(tag => tag.toLocaleLowerCase('zh-CN'));
      const missingTags = importedTags.filter(tag => !bodyTags.includes(tag.toLocaleLowerCase('zh-CN')));
      if (missingTags.length) {
        body = `${body.replace(/\s*$/, '')}\n\n${missingTags.map(tag => `#${tag}`).join(' ')}`;
      }
      const existing = state.notes.find(note => note.sourcePath === relative && !note.deleted);
      if (existing) {
        existing.title = Core.titleFromFilename(filename);
        existing.body = body;
        existing.tags = Core.extractTags(body);
        existing.updatedAt = Number(file.lastModified) || now();
        existing.dirty = true;
      } else {
        imported.push(makeNote({
          title: Core.titleFromFilename(filename),
          body,
          tags: Core.extractTags(body),
          createdAt: Number(file.lastModified) || now(),
          updatedAt: Number(file.lastModified) || now(),
          sourcePath: relative,
          dirty: true
        }));
      }
    }
    const updates = state.notes.filter(note => note.sourcePath && files.some(file => file.webkitRelativePath === note.sourcePath));
    state.notes.push(...imported);
    await DB.putNotes(state.key, Crypto, [...imported, ...updates]);
    renderAll();
    scheduleSync(700);
    showToast(`已导入 ${imported.length + updates.length} 篇笔记`);
  }


  /* 把加密信封整体 JSON 序列化成一个字节流，OSS 上只存这一个对象。
     不做任何格式假设，decryptBytes 拿到什么形状就还原成什么形状。 */
  function packCipher(cipher) {
    return new TextEncoder().encode(JSON.stringify(cipher));
  }
  function unpackCipher(bytes) {
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { return null; }
  }


  /* 把刷屏的冲突副本收拢成一条：同一标题只留最新，其余标删除（可同步删除） */
  async function mergeDuplicateNotes() {
    const alive = state.notes.filter(note => !note.deleted);
    const groups = new Map();
    for (const note of alive) {
      const key = String(note.title || '').replace(/（备份[^）]*）$|（冲突副本[^）]*）$/, '').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(note);
    }
    let removed = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const note of list.slice(1)) {
        note.deleted = true;
        note.dirty = true;
        note.updatedAt = now();
        await DB.putNote(state.key, Crypto, note);
        removed += 1;
      }
    }
    if (state.activeNote && state.activeNote.deleted) state.activeId = '';
    renderAll();
    if (removed) {
      scheduleSync(400);
      showToast(`已合并 ${removed} 条重复笔记（保留最新的）`);
    } else {
      showToast('没有发现重复笔记');
    }
  }

  async function addAttachments(fileList) {
    const note = activeNote();
    if (!note) {
      showToast('请先选择或新建一篇笔记');
      return;
    }
    const files = [...fileList];
    if (!files.length) return;
    let added = 0, cloudPending = 0, failedOSS = 0;
    for (const file of files) {
      const kind = fileKind(file);
      if (kind === 'file') {
        showToast(`暂不支持：${file.name}`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        showToast(`文件超过 20MB：${file.name}`);
        continue;
      }
      const id = Crypto.randomToken(16);
      try {
        const bytes = await file.arrayBuffer();
        const cipher = await Crypto.encryptBytes(state.key, bytes);
        await DB.putAttachment(id, cipher);
        const meta = {
          id,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          kind,
          createdAt: now(),
          oss: false            // 云端副本是否就绪
        };
        note.attachments.push(meta);
        added += 1;
        /* 密文再传一份到阿里云 OSS（notes/attachments/<id>），这样换设备附件也跟得上。
           失败只提示，不回滚：本机这份仍然是好的，稍后可重新上传。 */
        try {
          const packed = packCipher(cipher);
          await (window.NotesOSS ? NotesOSS.putAttachment(id, packed, meta.type) : Promise.reject(new Error('OSS 模块未加载')));
          meta.oss = true;
          cloudPending += 1;
        } catch (err) {
          console.warn('附件未能上传 OSS', err);
          failedOSS += 1;
        }
      } catch (error) {
        console.error('附件保存失败', error);
        showToast(`无法保存：${file.name}`);
      }
    }
    if (added) {
      noteChanged(note);
      await DB.putNote(state.key, Crypto, note);
      renderNoteExtras(note);
      showToast(failedOSS
        ? `已添加 ${added} 个文件（${failedOSS} 个没能传到云端，可稍后重试）`
        : `已添加 ${added} 个文件，本机与云端各存一份`);
    }
  }


  /* Office 预览包有 785KB，平时用不到 —— 第一次打开 docx/xlsx 时才去下载 */
  let officeLoading = null;
  function loadOfficePreview() {
    if (window.XYOfficePreview) return Promise.resolve();
    if (officeLoading) return officeLoading;
    officeLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'office-preview.bundle.js?v=20261109e';
      script.onload = () => resolve();
      script.onerror = () => { officeLoading = null; reject(new Error('预览组件下载失败')); };
      document.head.appendChild(script);
    });
    return officeLoading;
  }

  async function openAttachment(id) {
    const note = activeNote();
    const meta = note && (note.attachments || []).find(item => item.id === id);
    if (!meta) return;
    let value;
    try {
      value = await getAttachmentFile(meta);
    } catch (error) {
      console.error(error);
    }
    refs.attachmentDialogTitle.textContent = meta.name;
    refs.attachmentDialogBody.innerHTML = '';
    refs.convertAttachmentBtn.hidden = !['docx', 'spreadsheet'].includes(meta.kind);
    refs.printAttachmentBtn.hidden = !['docx', 'spreadsheet'].includes(meta.kind);
    state.activeAttachment = value ? { meta, ...value } : { meta };
    if (!value) {
      refs.attachmentDialogBody.innerHTML = '<div class="office-convert-result">这个附件目前只存在于上传它的设备上，尚未同步到此设备。</div>';
      refs.attachmentDialog.showModal();
      return;
    }

    if (meta.kind === 'image') {
      const image = document.createElement('img');
      image.className = 'attachment-image';
      image.src = value.url;
      image.alt = meta.name;
      refs.attachmentDialogBody.append(image);
    } else if (meta.kind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.className = 'attachment-pdf';
      frame.src = value.url;
      frame.title = meta.name;
      refs.attachmentDialogBody.append(frame);
    } else if (['docx', 'spreadsheet'].includes(meta.kind)) {
      const shell = document.createElement('div');
      shell.className = 'office-preview-shell';
      shell.innerHTML = '<div class="office-convert-result">正在准备预览…</div>';
      refs.attachmentDialogBody.append(shell);
      try {
        await loadOfficePreview();
        shell.innerHTML = '<div class="office-convert-result">正在渲染文件…</div>';
        await window.XYOfficePreview.previewOffice(value.file, shell);
      } catch (error) {
        shell.innerHTML = `<div class="office-convert-result">预览失败：${Core.escapeHtml(error.message)}</div>`;
      }
    }
    refs.attachmentDialog.showModal();
  }

  async function removeAttachment(id) {
    const note = activeNote();
    if (!note) return;
    const meta = (note.attachments || []).find(item => item.id === id);
    if (!meta || !confirm(`删除附件「${meta.name}」？`)) return;
    note.attachments = note.attachments.filter(item => item.id !== id);
    await DB.deleteAttachment(id);
    revokeAttachment(id);
    noteChanged(note);
    await DB.putNote(state.key, Crypto, note);
    renderNoteExtras(note);
  }

  async function convertActiveAttachment() {
    if (!state.activeAttachment) return;
    try { await loadOfficePreview(); } catch (e) { showToast('预览组件下载失败'); return; }
    const { meta, file } = state.activeAttachment;
    if (!file) return;
    refs.convertAttachmentBtn.disabled = true;
    refs.convertAttachmentBtn.textContent = '正在转换…';
    try {
      const markdown = await window.XYOfficePreview.officeToMarkdown(file);
      const base = meta.name.replace(/\.(docx|xlsx|xls)$/i, '');
      refs.attachmentDialog.close();
      createNote({
        title: `${base} · Markdown`,
        body: `${markdown}\n\n#转换`,
        tags: Core.extractTags(markdown)
      });
      showToast('已生成 Markdown 笔记');
    } catch (error) {
      showToast(`转换失败：${error.message}`);
    } finally {
      refs.convertAttachmentBtn.disabled = false;
      refs.convertAttachmentBtn.textContent = '转为 Markdown';
    }
  }

  function printActiveAttachment() {
    if (!state.activeAttachment || !state.activeAttachment.file) return;
    const title = state.activeAttachment.meta.name;
    const content = refs.attachmentDialogBody.innerHTML;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('浏览器阻止了打印窗口');
      return;
    }
    printWindow.opener = null;
    const cssUrl = new URL('styles.css', location.href).href;
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${Core.escapeHtml(title)}</title><link rel="stylesheet" href="${cssUrl}"><style>body{margin:0;background:#fff} .office-preview-shell{padding:0;background:#fff} .office-sheet-tabs{display:none!important}.office-sheet{padding:0;border:0}@page{margin:12mm}</style></head><body class="attachment-dialog-body">${content}</body></html>`);
    printWindow.document.close();
    printWindow.document.querySelectorAll('.office-sheet').forEach(sheet => { sheet.hidden = false; });
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 500);
  }

  function downloadActiveAttachment() {
    if (!state.activeAttachment) return;
    if (!state.activeAttachment.url) {
      showToast('该文件尚未同步到此设备');
      return;
    }
    const link = document.createElement('a');
    link.href = state.activeAttachment.url;
    link.download = state.activeAttachment.meta.name;
    link.click();
  }

  function exportBackup() {
    const notes = state.notes.filter(note => !note.deleted);
    if (!notes.length) {
      showToast('还没有可导出的笔记');
      return;
    }
    if (!confirm('备份文件包含未加密的笔记正文。确认下载到这台设备吗？')) return;
    const payload = {
      format: 'xy6300-notes-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: notes.map(({ dirty, version, serverUpdatedAt, ...note }) => note)
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `xy6300-notes-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }

  async function lockVault() {
    if (!confirm('锁定后会清除本机活动会话，下次需重新输入笔记口令。继续吗？')) return;
    saveNow();
    const vault = await DB.getMeta(VAULT_META);
    if (!vault || !vault.vaultId) return;
    await DB.setMeta(VAULT_META, { ...vault, key: null });
    writeSession(null);
    state.key = null;
    state.notes = [];
    state.activeId = '';
    state.vaultReady = false;
    showVaultDialog('unlock');
  }

  function showVaultDialog(mode) {
    state.unlockOnly = mode === 'unlock';
    refs.vaultDialogTitle.textContent = state.unlockOnly ? '解锁笔记库' : '设置加密笔记库';
    refs.vaultDialogCopy.textContent = state.unlockOnly
      ? '输入这台设备使用的笔记口令，解密本地笔记并恢复同步会话。'
      : '笔记会在本机加密。换设备时输入同一个口令，就能解密同一份笔记库。';
    if (refs.confirmField) refs.confirmField.hidden = state.unlockOnly;
    refs.vaultPassword.placeholder = state.unlockOnly ? '输入现有笔记口令' : '至少 10 个字符';
    refs.vaultSubmitBtn.textContent = state.unlockOnly ? '解锁' : '开始使用';
    refs.vaultPassword.value = '';
    if (refs.vaultPasswordConfirm) refs.vaultPasswordConfirm.value = '';
    refs.vaultDialog.showModal();
    setTimeout(() => refs.vaultPassword.focus(), 100);
  }

  async function resetDevice() {
    if (!confirm('这会清除本机加密缓存，云端数据不会被删除。确认继续吗？')) return;
    await DB.clearAll();
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  function openSettings() {
    refs.settingStorage.textContent = 'IndexedDB · 加密';
    refs.settingCount.textContent = state.notes.filter(note => !note.deleted).length;
    refs.settingCloud.textContent = readSession() ? '已登录' : '未连接';
    /* 指纹 = 口令派生出来的前 8 位：两台设备显示一样，就说明用的是同一个口令 */
    refs.settingVault.textContent = state.vaultId ? String(state.vaultId).slice(0, 8).toUpperCase() : '未设置';
    refs.settingsDialog.showModal();
  }

  function applyLayout() {
    const listCollapsed = state.listCollapsed && window.innerWidth > 900;
    document.documentElement.style.setProperty('--sidebar-w', `${state.sidebarCollapsed ? 0 : state.sidebarWidth}px`);
    document.documentElement.style.setProperty('--list-w', `${listCollapsed ? 0 : state.listWidth}px`);
    document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    document.body.classList.toggle('list-collapsed', listCollapsed);
    refs.menuBtn.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    refs.listToggleBtn.setAttribute('aria-expanded', String(!listCollapsed));
    refs.sidebarResize.setAttribute('aria-valuenow', String(state.sidebarWidth));
    refs.listResize.setAttribute('aria-valuenow', String(state.listWidth));
    const label = refs.menuBtn.querySelector('span');
    if (label) label.textContent = state.sidebarCollapsed ? '打开菜单' : '菜单';
  }

  async function saveUiPreferences() {
    try {
      await DB.setMeta('ui', {
        sidebarCollapsed: state.sidebarCollapsed,
        listCollapsed: state.listCollapsed,
        sidebarWidth: state.sidebarWidth,
        listWidth: state.listWidth
      });
    } catch (error) { /* UI 偏好保存失败不影响笔记 */ }
  }

  function toggleSidebar() {
    if (window.innerWidth <= 900) {
      const open = document.body.classList.toggle('menu-open');
      refs.menuBtn.setAttribute('aria-expanded', String(open));
      return;
    }
    state.sidebarCollapsed = !state.sidebarCollapsed;
    applyLayout();
    saveUiPreferences();
  }

  function setListCollapsed(collapsed) {
    if (window.innerWidth <= 900) return;
    state.listCollapsed = !!collapsed;
    applyLayout();
    saveUiPreferences();
  }

  function bindResize(handle, key, minimum, maximum) {
    let startX = 0;
    let startWidth = 0;
    let dragging = false;

    handle.addEventListener('pointerdown', event => {
      if (window.innerWidth <= 900 || state.sidebarCollapsed && key === 'sidebarWidth') return;
      dragging = true;
      startX = event.clientX;
      startWidth = state[key];
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing');
      event.preventDefault();
    });

    handle.addEventListener('pointermove', event => {
      if (!dragging) return;
      const next = Math.min(maximum, Math.max(minimum, Math.round(startWidth + event.clientX - startX)));
      state[key] = next;
      applyLayout();
    });

    function stop() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing');
      saveUiPreferences();
    }

    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 10 : -10;
      state[key] = Math.min(maximum, Math.max(minimum, state[key] + delta));
      applyLayout();
      saveUiPreferences();
    });
    handle.addEventListener('dblclick', () => {
      if (state.sidebarCollapsed && key === 'sidebarWidth') return;
      state[key] = key === 'sidebarWidth' ? 230 : 320;
      applyLayout();
      saveUiPreferences();
    });
  }

  function handleWikiTarget(target) {
    const wanted = Core.normalizeSearchTarget ? Core.normalizeSearchTarget(target) : target.trim().toLocaleLowerCase('zh-CN');
    const found = state.notes.find(note => !note.deleted && note.title.trim().toLocaleLowerCase('zh-CN') === wanted);
    if (found) {
      selectNote(found.id, { focus: false });
      return;
    }
    if (confirm(`没有名为「${target}」的笔记，现在创建吗？`)) {
      createNote({ title: target.trim(), body: `# ${target.trim()}\n\n` });
    }
  }

  function bindEvents() {
    const create = () => createNote();
    refs.sideNewBtn.addEventListener('click', create);

    /* ---------- 底部工具栏（手机）+ 齿轮：只有一个入口，逻辑一致 ---------- */
    const toolsDialog = document.getElementById('toolsDialog');
    const toolsBody = document.getElementById('toolsBody');
    const sideTools = document.querySelector('.sidebar .side-tools');
    if (toolsBody && sideTools) toolsBody.appendChild(sideTools);   // 工具都收进齿轮
    const openTools = () => { if (toolsDialog) toolsDialog.showModal(); };
    const closeTools = () => { if (toolsDialog) toolsDialog.close(); };
    const gearBtn = document.getElementById('gearBtn');
    if (gearBtn) gearBtn.addEventListener('click', openTools);
    const toolsCloseBtn = document.getElementById('toolsCloseBtn');
    if (toolsCloseBtn) toolsCloseBtn.addEventListener('click', closeTools);
    const bbTools = document.getElementById('bbTools');
    if (bbTools) bbTools.addEventListener('click', openTools);

    const backToTree = () => {
      saveNow();
      document.body.classList.remove('note-open');
      markBottomBar();
    };
    const markBottomBar = () => {
      const bbList = document.getElementById('bbList');
      if (bbList) bbList.classList.toggle('on', !document.body.classList.contains('note-open'));
    };
    const bbList = document.getElementById('bbList');
    if (bbList) bbList.addEventListener('click', backToTree);
    const bbNew = document.getElementById('bbNew');
    if (bbNew) bbNew.addEventListener('click', create);
    const bbSearch = document.getElementById('bbSearch');
    if (bbSearch) bbSearch.addEventListener('click', () => {
      backToTree();
      refs.searchInput.focus();
    });
    markBottomBar();

    refs.settingsBtn.addEventListener('click', openSettings);
    refs.deleteBtn.addEventListener('click', deleteActive);

    refs.menuBtn.addEventListener('click', toggleSidebar);
    refs.closeMenuBtn.addEventListener('click', () => {
      if (window.innerWidth <= 900) {
        document.body.classList.remove('menu-open');
        refs.menuBtn.setAttribute('aria-expanded', 'false');
      } else {
        state.sidebarCollapsed = true;
        applyLayout();
        saveUiPreferences();
      }
    });
    refs.mobileBackdrop.addEventListener('click', () => {
      document.body.classList.remove('menu-open');
      refs.menuBtn.setAttribute('aria-expanded', 'false');
    });
    refs.listToggleBtn.addEventListener('click', () => setListCollapsed(!state.listCollapsed));
    refs.listCollapseBtn.addEventListener('click', () => setListCollapsed(true));
    refs.backToListBtn.addEventListener('click', () => {
      saveNow();
      document.body.classList.remove('note-open');
    });

    refs.noteList.addEventListener('click', event => {
      const folder = event.target.closest('.tree-folder');
      if (folder) {
        const path = folder.dataset.tree;
        if (state.collapsed.has(path)) state.collapsed.delete(path);
        else state.collapsed.add(path);
        renderList();
        return;
      }
      const row = event.target.closest('.note-row');
      if (row) selectNote(row.dataset.id, { focus: false });
    });
    $('.nav-row[data-folder=""]').addEventListener('click', () => {
      state.tag = '';
      state.folder = '';
      document.body.classList.remove('menu-open');
      refs.menuBtn.setAttribute('aria-expanded', 'false');
      renderSidebar();
      renderTags();
      renderList();
    });
    refs.tagCloud.addEventListener('click', event => {
      const chip = event.target.closest('[data-tag]');
      if (!chip) return;
      state.tag = state.tag === chip.dataset.tag ? '' : chip.dataset.tag;
      document.body.classList.remove('menu-open');
      refs.menuBtn.setAttribute('aria-expanded', 'false');
      renderSidebar();
      renderTags();
      renderList();
    });
    refs.backlinkList.addEventListener('click', event => {
      const row = event.target.closest('[data-id]');
      if (row) selectNote(row.dataset.id, { focus: false });
    });

    refs.searchInput.addEventListener('input', () => {
      state.query = refs.searchInput.value;
      renderList();
    });
    refs.titleInput.addEventListener('input', updateFromInputs);
    if (refs.folderInput) {
      refs.folderInput.addEventListener('change', () => {
        const note = activeNote();
        if (!note) return;
        note.folder = Core.normalizeFolder(refs.folderInput.value);
        refs.folderInput.value = note.folder;
        noteChanged(note);
        scheduleSave();
        renderList();
        renderFolderTree();
        scheduleSync(600);
      });
    }


    /* 文件夹树：点名字=筛选，点箭头=展开/收起 */
    if (refs.folderTree) {
      refs.folderTree.addEventListener('click', event => {
        const row = event.target.closest('.folder-row');
        if (!row) return;
        const path = row.dataset.path;
        const onArrow = !!event.target.closest('.folder-arrow');
        if (onArrow) {
          if (state.collapsed.has(path)) state.collapsed.delete(path);
          else state.collapsed.add(path);
          renderFolderTree();
          return;
        }
        state.folder = state.folder === path ? '' : path;
        state.tag = '';
        renderAll();
      });
    }

    refs.syncBtn.addEventListener('click', async () => {
      state.syncManual = true;
      if (readSession()) { syncNow(); return; }
      // 本机有登录凭据就直接连，不再逼用户重输口令
      const meta = await DB.getMeta(VAULT_META).catch(() => null);
      if (meta && meta.authSecret) {
        showToast('正在连接笔记库…');
        connectCloud('').catch(error => {
          refs.syncError.textContent = error.message;
          refs.syncDialog.showModal();
        });
        return;
      }
      refs.syncError.textContent = '';
      refs.syncDialog.showModal();
      setTimeout(() => refs.syncPassword.focus(), 80);
    });
    refs.syncCloseBtn.addEventListener('click', () => refs.syncDialog.close());
    refs.syncForm.addEventListener('submit', event => {
      event.preventDefault();
      connectCloud(refs.syncPassword.value).catch(error => {
        refs.syncError.textContent = error.message;
      });
    });

    refs.importBtn.addEventListener('click', () => refs.importInput.click());
    refs.importInput.addEventListener('change', () => {
      importFiles(refs.importInput.files).finally(() => {
        refs.importInput.value = '';
      });
    });
    refs.attachmentBtn.addEventListener('click', () => refs.attachmentInput.click());
    refs.addAttachmentBtn.addEventListener('click', () => refs.attachmentInput.click());
    refs.attachmentInput.addEventListener('change', () => {
      addAttachments(refs.attachmentInput.files).finally(() => {
        refs.attachmentInput.value = '';
      });
    });
    refs.attachmentList.addEventListener('click', event => {
      const open = event.target.closest('[data-open-attachment]');
      if (open) {
        openAttachment(open.dataset.openAttachment);
        return;
      }
      const remove = event.target.closest('[data-remove-attachment]');
      if (remove) removeAttachment(remove.dataset.removeAttachment);
    });
    refs.closeAttachmentBtn.addEventListener('click', () => refs.attachmentDialog.close());
    refs.convertAttachmentBtn.addEventListener('click', convertActiveAttachment);
    refs.printAttachmentBtn.addEventListener('click', printActiveAttachment);
    refs.downloadAttachmentBtn.addEventListener('click', downloadActiveAttachment);
    refs.exportBtn.addEventListener('click', exportBackup);
    refs.lockBtn.addEventListener('click', lockVault);

    refs.vaultForm.addEventListener('submit', event => {
      event.preventDefault();
      setupVault(refs.vaultPassword.value, undefined).catch(error => {
        showToast(error.message);
        if (refs.vaultPasswordConfirm) refs.vaultPasswordConfirm.value = '';
      });
    });
    refs.vaultCloseBtn.addEventListener('click', () => {
      if (state.vaultReady) refs.vaultDialog.close();
    });
    refs.vaultDialog.addEventListener('cancel', event => {
      if (!state.vaultReady) event.preventDefault();
    });

    $$('[data-close-settings]').forEach(button => {
      button.addEventListener('click', () => refs.settingsDialog.close());
    });
    refs.changeDeviceBtn.addEventListener('click', () => {
      refs.settingsDialog.close();
      showToast('在另一台设备打开本页，输入同一个笔记口令即可');
    });
    refs.resetDeviceBtn.addEventListener('click', resetDevice);
    refs.dedupeBtn && refs.dedupeBtn.addEventListener('click', async () => {
      if (!confirm('同一标题的笔记只保留最新的一条，其余移到删除。继续吗？')) return;
      await mergeDuplicateNotes();
      refs.settingsDialog.close();
    });

    window.addEventListener('online', () => {
      updateOnlineState();
      scheduleSync(200);
    });
    window.addEventListener('offline', () => setSyncState('offline', '离线编辑'));
    window.addEventListener('focus', () => scheduleSync(300));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleSync(300);
    });
    window.addEventListener('beforeunload', saveNow);
    window.addEventListener('resize', applyLayout);

    document.addEventListener('keydown', event => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        create();
      } else if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        refs.searchInput.focus();
        refs.searchInput.select();
      } else if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        updateFromInputs();
        saveNow();
        showToast('已保存到本机');
      } else if (event.key === 'Escape') {
        document.body.classList.remove('menu-open');
        refs.menuBtn.setAttribute('aria-expanded', String(window.innerWidth > 900 && !state.sidebarCollapsed));
        if (window.innerWidth <= 620 && document.body.classList.contains('note-open')) {
          saveNow();
          document.body.classList.remove('note-open');
        }
      }
    });

    bindResize(refs.sidebarResize, 'sidebarWidth', 180, 360);
    bindResize(refs.listResize, 'listWidth', 240, 480);

    setInterval(() => {
      if (!document.hidden && readSession()) scheduleSync(0);
      renderListSoon();
    }, 8000);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(error => {
      console.warn('Service Worker 注册失败', error);
    });
  }

  async function boot() {
    bindEvents();
    try {
      if (!window.XYLiveEditor || typeof window.XYLiveEditor.createLiveEditor !== 'function') {
        throw new Error('即时编辑器未加载');
      }
      state.editor = window.XYLiveEditor.createLiveEditor({
        parent: refs.liveEditor,
        value: '',
        onChange: updateBody,
        onWikiLink: handleWikiTarget
      });
      state.deviceId = await DB.getMeta(DEVICE_META);
      if (!state.deviceId) {
        state.deviceId = Crypto.randomToken(12);
        await DB.setMeta(DEVICE_META, state.deviceId);
      }
      const preferences = await DB.getMeta('ui');
      if (preferences) {
        state.sidebarCollapsed = !!preferences.sidebarCollapsed;
        state.listCollapsed = !!preferences.listCollapsed;
        state.sidebarWidth = Math.min(360, Math.max(180, Number(preferences.sidebarWidth) || 230));
        state.listWidth = Math.min(480, Math.max(240, Number(preferences.listWidth) || 320));
      }
      applyLayout();
      const vault = await DB.getMeta(VAULT_META);
      if (!vault || !vault.vaultId) {
        showVaultDialog('setup');
        return;
      }
      if (!vault.key) {
        showVaultDialog('unlock');
        return;
      }
      state.key = vault.key;
      state.vaultId = vault.vaultId;
      state.vaultReady = true;
      await startNotes();
    } catch (error) {
      console.error(error);
      showToast(`初始化失败：${error.message}`);
    }
  }

  boot();
})();
