(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotesCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HTML_ESCAPE = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => HTML_ESCAPE[ch]);
  }

  function safeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(https?:|mailto:)/i.test(raw)) return raw;
    if (/^(\.{0,2}\/|#|\/)/.test(raw)) return raw;
    return '';
  }

  function inlineMarkdown(value) {
    const code = [];
    let text = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, body) => {
      const token = `\u0000CODE${code.length}\u0000`;
      code.push(`<code>${body}</code>`);
      return token;
    });

    text = text.replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, (_, target, label) => {
      const name = target.trim();
      const caption = (label || target).trim();
      return `<button class="wiki-link" type="button" data-wiki="${escapeHtml(name)}">${escapeHtml(caption)}</button>`;
    });

    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      const url = safeUrl(href);
      if (!url) return whole;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    text = text
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,，。])/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,，。])/g, '$1<em>$2</em>');

    return text.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
  }

  function renderMarkdown(markdown) {
    const source = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n');
    if (!source.trim()) return '<p class="md-empty">还没有内容。点击编辑开始写。</p>';

    const lines = source.split('\n');
    const out = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (/^\s*```/.test(line)) {
        const lang = line.replace(/^\s*```/, '').trim();
        const body = [];
        index += 1;
        while (index < lines.length && !/^\s*```/.test(lines[index])) {
          body.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
        continue;
      }

      if (/^\s*$/.test(line)) {
        index += 1;
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        out.push('<hr>');
        index += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const body = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          body.push(lines[index].replace(/^\s*>\s?/, ''));
          index += 1;
        }
        out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
        continue;
      }

      const bullet = /^\s*([-+*]|\d+\.)\s+(.+)$/.exec(line);
      if (bullet) {
        const ordered = /\d+\./.test(bullet[1]);
        const items = [];
        let start = null;
        while (index < lines.length) {
          const item = /^\s*((?:[-+*])|(?:\d+\.))\s+(.+)$/.exec(lines[index]);
          if (!item) break;
          const isOrdered = /\d+\./.test(item[1]);
          if (isOrdered !== ordered) break;
          if (isOrdered && start == null) start = Number(item[1].slice(0, -1));
          const task = /^\[([ xX])\]\s+(.*)$/.exec(item[2]);
          const content = task
            ? `<label class="task"><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${inlineMarkdown(task[2])}</label>`
            : inlineMarkdown(item[2]);
          items.push(`<li>${content}</li>`);
          index += 1;
        }
        const tag = ordered ? 'ol' : 'ul';
        const startAttr = ordered && start && start !== 1 ? ` start="${start}"` : '';
        out.push(`<${tag}${startAttr}>${items.join('')}</${tag}>`);
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^\s*```/.test(lines[index]) &&
        !/^(#{1,6})\s+/.test(lines[index]) &&
        !/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(lines[index]) &&
        !/^\s*>\s?/.test(lines[index]) &&
        !/^\s*([-+*]|\d+\.)\s+/.test(lines[index])
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      out.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`);
    }

    return out.join('\n');
  }

  function stripCode(markdown) {
    return String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]+`/g, ' ');
  }

  function extractTags(markdown) {
    const text = stripCode(markdown);
    const tags = new Set();
    const matcher = /(^|[\s(（])#([\p{L}\p{N}_/-]{1,48})/gu;
    for (const match of text.matchAll(matcher)) {
      const tag = match[2].replace(/[，。！？、：；,.!?:;]+$/u, '');
      if (tag) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }

  function extractWikiLinks(markdown) {
    const links = new Set();
    const matcher = /\[\[([^\]|\n]+?)(?:\|[^\]\n]+?)?\]\]/g;
    for (const match of String(markdown || '').matchAll(matcher)) {
      const target = match[1].trim();
      if (target) links.add(target);
    }
    return [...links];
  }

  function normalizeFolder(value) {
    return String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(part => part.trim())
      .filter(part => part && part !== '.' && part !== '..')
      .join('/');
  }

  function normalizeSearch(value) {
    return String(value || '').trim().toLocaleLowerCase('zh-CN');
  }

  function noteHaystack(note) {
    return normalizeSearch([
      note.title,
      note.folder,
      note.body,
      ...(note.tags || [])
    ].join('\n'));
  }

  function searchNotes(notes, query, folder, tag) {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    return (notes || [])
      .filter(note => !note.deleted)
      .filter(note => !folder || note.folder === folder || note.folder.startsWith(`${folder}/`))
      .filter(note => !tag || (note.tags || []).includes(tag))
      .filter(note => {
        if (!terms.length) return true;
        const haystack = noteHaystack(note);
        return terms.every(term => haystack.includes(term));
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function backlinksFor(notes, targetTitle) {
    const target = normalizeSearch(targetTitle);
    if (!target) return [];
    return (notes || [])
      .filter(note => !note.deleted)
      .filter(note => normalizeSearch(note.title) !== target)
      .filter(note => extractWikiLinks(note.body).some(link => normalizeSearch(link) === target))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function formatRelativeTime(timestamp, nowValue) {
    const value = Number(timestamp) || 0;
    if (!value) return '';
    const now = Number(nowValue) || Date.now();
    const seconds = Math.max(0, Math.round((now - value) / 1000));
    if (seconds < 45) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} 天前`;
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value));
  }

  function titleFromFilename(filename) {
    return String(filename || '')
      .split('/')
      .pop()
      .replace(/\.(md|markdown|txt)$/i, '')
      .trim() || '未命名笔记';
  }

  return {
    escapeHtml,
    safeUrl,
    renderMarkdown,
    extractTags,
    extractWikiLinks,
    normalizeFolder,
    searchNotes,
    backlinksFor,
    formatRelativeTime,
    titleFromFilename
  };
});
