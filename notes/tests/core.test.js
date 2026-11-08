'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const cryptoApi = require('../crypto.js');

test('Markdown renders formatting while escaping HTML', () => {
  const html = core.renderMarkdown('# 标题\n\n<script>alert(1)</script> **粗体** [[目标|链接]]');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-wiki="目标"/);
});

test('unsafe links are not turned into anchors', () => {
  const html = core.renderMarkdown('[点击](javascript:alert(1))');
  assert.doesNotMatch(html, /href=/);
});

test('tags ignore fenced code and wiki links are unique', () => {
  const markdown = '#工作 #教学/课程 [[甲]] [[甲|别名]]\n```\n#不要\n```';
  assert.deepEqual(core.extractTags(markdown), ['工作', '教学/课程']);
  assert.deepEqual(core.extractWikiLinks(markdown), ['甲']);
});

test('folder search includes descendants without case-sensitive mismatch', () => {
  const notes = [
    { title: 'A', body: '正文', folder: '100-工作/教学', tags: [], deleted: false, updatedAt: 1 },
    { title: 'B', body: '正文', folder: '200-个人', tags: [], deleted: false, updatedAt: 2 }
  ];
  assert.equal(core.searchNotes(notes, '', '100-工作', '').length, 1);
  assert.equal(core.searchNotes(notes, '正文', '', '').length, 2);
  assert.equal(core.searchNotes(notes, '', '', '').length, 2);
});

test('vault encryption round-trips and wrong keys fail', async () => {
  const one = await cryptoApi.deriveVault('测试笔记库安全口令 123');
  const two = await cryptoApi.deriveVault('另一个笔记库安全口令 456');
  const envelope = await cryptoApi.encryptJson(one.key, { title: '私密标题', body: '私密正文' });
  assert.deepEqual(await cryptoApi.decryptJson(one.key, envelope), { title: '私密标题', body: '私密正文' });
  await assert.rejects(() => cryptoApi.decryptJson(two.key, envelope));
  assert.notEqual(one.vaultId, two.vaultId);
});
