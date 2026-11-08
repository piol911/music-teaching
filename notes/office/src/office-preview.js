import { renderAsync } from 'docx-preview';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import * as XLSX from 'xlsx';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced'
});

function workbookFromArrayBuffer(buffer) {
  return XLSX.read(buffer, { type: 'array', cellDates: true, cellNF: true, cellStyles: true });
}

function escapeCell(value) {
  return String(value == null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function sheetToMarkdown(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (!rows.length) return '_空工作表_';
  const width = Math.max(...rows.map(row => row.length));
  if (!width) return '_空工作表_';
  const normalized = rows.map(row => Array.from({ length: width }, (_, index) => escapeCell(row[index])));
  const lines = [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map(row => `| ${row.join(' | ')} |`)
  ];
  return lines.join('\n');
}

function workbookToMarkdown(workbook) {
  return workbook.SheetNames.map(name => {
    return `## ${name}\n\n${sheetToMarkdown(workbook.Sheets[name])}`;
  }).join('\n\n');
}

async function previewDocx(file, container) {
  container.innerHTML = '';
  await renderAsync(file, container, null, {
    className: 'docx-preview',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    useBase64URL: true
  });
}

function previewWorkbook(file, container) {
  return file.arrayBuffer().then(buffer => {
    const workbook = workbookFromArrayBuffer(buffer);
    container.innerHTML = workbook.SheetNames.map((name, index) => `
      <section class="office-sheet" ${index ? 'hidden' : ''}>
        <h3>${name}</h3>
        ${XLSX.utils.sheet_to_html(workbook.Sheets[name], { id: `sheet-${index + 1}` })}
      </section>
    `).join('');
    const tabs = workbook.SheetNames.map((name, index) => `<button type="button" data-sheet-tab="${index}" class="${index ? '' : 'active'}">${name}</button>`).join('');
    container.insertAdjacentHTML('afterbegin', `<nav class="office-sheet-tabs">${tabs}</nav>`);
    container.querySelector('.office-sheet-tabs').addEventListener('click', event => {
      const button = event.target.closest('[data-sheet-tab]');
      if (!button) return;
      container.querySelectorAll('[data-sheet-tab]').forEach(item => item.classList.toggle('active', item === button));
      container.querySelectorAll('.office-sheet').forEach((sheet, index) => {
        sheet.hidden = index !== Number(button.dataset.sheetTab);
      });
    });
  });
}

async function docxToMarkdown(file) {
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return turndown.turndown(result.value);
}

async function xlsxToMarkdown(file) {
  return workbookToMarkdown(workbookFromArrayBuffer(await file.arrayBuffer()));
}

export async function previewOffice(file, container) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    await previewDocx(file, container);
    return { kind: 'docx' };
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    await previewWorkbook(file, container);
    return { kind: 'spreadsheet' };
  }
  throw new Error('暂不支持该 Office 文件类型');
}

export async function officeToMarkdown(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return docxToMarkdown(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return xlsxToMarkdown(file);
  throw new Error('暂不支持该 Office 文件类型');
}
