(function () {
  'use strict';

  const notes = [
    {
      id: 'rain',
      no: '01',
      title: '雨停以后',
      category: '日常 / 午后',
      kind: '日常记录',
      date: '2026.11.08',
      shortDate: '11.08',
      tags: ['日常', '写作'],
      excerpt: '窗外的雨刚停，桌面重新亮起来。',
      body: `窗外的雨刚停。桌面上有一张纸、一支笔，和一杯已经凉掉的茶。

## 今天要记住的事

- 把重要的想法先写下来
- 不急着整理
- 给空白留一点位置

> 笔记不是仓库，是一张可以反复回去坐一会儿的桌子。`
    },
    {
      id: 'threshold',
      no: '02',
      title: '给自己的门槛',
      category: '工作 / 判断',
      kind: '工作现场',
      date: '2026.11.06',
      shortDate: '11.06',
      tags: ['工作', '判断'],
      excerpt: '先把问题写清楚，答案往往已经出现了一半。',
      body: `很多犹豫并不是没有答案，而是问题还没有被写清楚。

## 今天试过的方法

1. 先把事实和猜测分开
2. 写出最坏结果
3. 只决定下一步

写下来以后，事情没有变简单，但边界清楚了。`
    },
    {
      id: 'walk',
      no: '03',
      title: '沿河走一段',
      category: '日常 / 散步',
      kind: '日常记录',
      date: '2026.11.03',
      shortDate: '11.03',
      tags: ['日常', '散步'],
      excerpt: '没有目的地的时候，路会变得更长。',
      body: `傍晚沿着河岸走了一段。

没有戴耳机，也没有打开任何应用。只听见水声、自行车铃声，还有远处学校放学的广播。

## 记住

不是每一次走路都需要抵达一个地方。`
    },
    {
      id: 'teaching',
      no: '04',
      title: '音乐课的留白',
      category: '工作 / 教学',
      kind: '工作现场',
      date: '2026.10.29',
      shortDate: '10.29',
      tags: ['教学', '音乐'],
      excerpt: '不要急着把每一分钟都讲满。',
      body: `今天听学生讨论一段旋律时，我没有马上补充答案。

沉默持续了十几秒。之后有人说出了我没有预设的观察。

## 结论

课堂也需要留白。留白不是停下来，而是把思考交还给学生。`
    }
  ];

  const state = {
    variant: 'paper',
    activeId: notes[0].id,
    search: '',
    timer: null
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const activeNote = () => notes.find(note => note.id === state.activeId) || notes[0];

  function escape(value) {
    return window.NotesCore.escapeHtml(value);
  }

  function markdown(value) {
    return window.NotesCore.renderMarkdown(value);
  }

  function renderLists() {
    $('#paperList').innerHTML = notes.map((note, index) => `
      <li>
        <button class="paper-note${note.id === state.activeId ? ' active' : ''}" type="button" data-note-id="${note.id}">
          <span class="paper-note-no">${note.no}</span>
          <span><strong>${escape(note.title)}</strong><small>${escape(note.excerpt)}</small></span>
        </button>
      </li>
    `).join('');

    $('#deskList').innerHTML = notes.map((note, index) => `
      <button class="desk-card${note.id === state.activeId ? ' active' : ''}" type="button" data-note-id="${note.id}" style="--i:${index}">
        <span class="desk-card-top"><strong>${escape(note.title)}</strong><time>${note.shortDate}</time></span>
        <p>${escape(note.excerpt)}</p>
      </button>
    `).join('');

    const visible = notes.filter(note => {
      const query = state.search.trim().toLocaleLowerCase('zh-CN');
      return !query || `${note.title} ${note.body} ${note.category}`.toLocaleLowerCase('zh-CN').includes(query);
    });
    $('#archiveList').innerHTML = visible.length ? visible.map((note, index) => `
      <button class="archive-row${note.id === state.activeId ? ' active' : ''}" type="button" data-note-id="${note.id}" style="--i:${index}">
        <span class="archive-row-no">${note.no}</span>
        <span><strong>${escape(note.title)}</strong><small>${escape(note.category)}</small></span>
        <time>${note.shortDate}</time>
      </button>
    `).join('') : '<div class="archive-empty">没有匹配的条目</div>';
  }

  function renderActive() {
    const note = activeNote();
    const tagText = note.tags.map(tag => `#${tag}`).join(' ');
    const tagMarkup = note.tags.map(tag => `<span>#${escape(tag)}</span>`).join('');

    $('#paperFolio').textContent = `FOLIO ${note.no}`;
    $('#paperKicker').textContent = note.category;
    $('#paperTitle').textContent = note.title;
    $('#paperDate').textContent = note.date;
    $('#paperTags').textContent = tagText;
    $('#paperBody').innerHTML = markdown(note.body);
    $('#paperCount').textContent = note.no;

    $('#deskKicker').textContent = `${note.category} / NOTE ${note.no}`;
    $('#deskDate').textContent = note.shortDate;
    $('#deskTitle').textContent = note.title;
    $('#deskTags').innerHTML = tagMarkup;
    $('#deskBody').innerHTML = markdown(note.body);

    $('#archiveNumber').textContent = note.no;
    $('#archiveKicker').textContent = `${note.kind} / PERSONAL`;
    $('#archiveDate').textContent = note.date;
    $('#archiveTitle').textContent = note.title;
    $('#archiveTags').innerHTML = tagMarkup;
    $('#archiveBody').innerHTML = markdown(note.body);
    $('#archiveFooter').textContent = `ENTRY ${note.no} / ${String(notes.length).padStart(2, '0')}`;
  }

  function render() {
    renderLists();
    renderActive();
  }

  function activePanel() {
    return $(`.variant-panel[data-variant="${state.variant}"]`);
  }

  function playAnimation() {
    const panel = activePanel();
    if (!panel) return;
    clearTimeout(state.timer);
    panel.classList.remove('is-playing');
    void panel.offsetWidth;
    panel.classList.add('is-playing');
    state.timer = setTimeout(() => panel.classList.remove('is-playing'), 1000);
  }

  function switchVariant(variant) {
    if (!['paper', 'desk', 'archive'].includes(variant)) return;
    state.variant = variant;
    document.body.dataset.variant = variant;
    $$('.variant-tab').forEach(tab => {
      const active = tab.dataset.target === variant;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$('.variant-panel').forEach(panel => {
      const active = panel.dataset.variant === variant;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
      panel.classList.remove('is-entering');
    });
    requestAnimationFrame(() => {
      activePanel().classList.add('is-entering');
      playAnimation();
    });
  }

  function selectNote(id) {
    if (!notes.some(note => note.id === id)) return;
    state.activeId = id;
    render();
    playAnimation();
  }

  function bindNoteLists() {
    ['#paperList', '#deskList', '#archiveList'].forEach(selector => {
      $(selector).addEventListener('click', event => {
        const target = event.target.closest('[data-note-id]');
        if (target) selectNote(target.dataset.noteId);
      });
    });
  }

  function bindTabs() {
    $$('.variant-tab').forEach((tab, index, tabs) => {
      tab.addEventListener('click', () => switchVariant(tab.dataset.target));
      tab.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + direction + tabs.length) % tabs.length];
        next.focus();
        switchVariant(next.dataset.target);
      });
    });
  }

  function bindDemoActions() {
    $$('.paper-folder, .desk-folder').forEach(button => {
      button.addEventListener('click', () => {
        const group = button.parentElement;
        [...group.querySelectorAll('button')].forEach(item => item.classList.toggle('active', item === button));
        playAnimation();
      });
    });
    $$('.paper-new, .desk-add, .archive-new, .desk-utility').forEach(button => {
      button.addEventListener('click', () => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        button.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'ease-out' }
        );
      });
    });
    $('.archive-search input').addEventListener('input', event => {
      state.search = event.target.value;
      renderLists();
    });
    $('#replayBtn').addEventListener('click', playAnimation);
  }

  document.body.dataset.variant = state.variant;
  render();
  bindNoteLists();
  bindTabs();
  bindDemoActions();
  requestAnimationFrame(playAnimation);
})();
