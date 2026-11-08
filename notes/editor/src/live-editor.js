import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  highlightActiveLine,
  keymap,
  placeholder
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';

const marker = Decoration.replace({});
const bold = Decoration.mark({ class: 'cm-md-bold' });
const italic = Decoration.mark({ class: 'cm-md-italic' });
const inlineCode = Decoration.mark({ class: 'cm-md-inline-code' });
const codeLine = Decoration.line({ class: 'cm-md-code-line' });
const quoteLine = Decoration.line({ class: 'cm-md-quote-line' });
const bulletLine = Decoration.line({ class: 'cm-md-bullet-line' });
const orderedLine = Decoration.line({ class: 'cm-md-ordered-line' });
const headingLines = [1, 2, 3, 4, 5, 6].map(level =>
  Decoration.line({ class: `cm-md-h${level}` })
);

function add(parts, from, to, decoration) {
  if (to <= from) return;
  parts.push({ from, to, decoration });
}

function inlineDecorations(parts, line, from, text) {
  const occupied = [];
  const free = (start, end) => !occupied.some(([a, b]) => start < b && end > a);

  for (const match of text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    const start = from + match.index;
    const end = start + match[0].length;
    add(parts, start, start + 2, marker);
    add(parts, end - 2, end, marker);
    const labelStart = match[2] ? start + 2 + match[1].length + 1 : start + 2;
    const labelEnd = match[2] ? end - 2 : end - 2;
    const link = Decoration.mark({
      class: 'cm-wiki-link',
      attributes: { 'data-wiki': match[1].trim() }
    });
    add(parts, labelStart, labelEnd, link);
    occupied.push([start + 2, end - 2]);
  }

  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^) \n]+)\)/g)) {
    const start = from + match.index;
    const end = start + match[0].length;
    if (!free(start, end)) continue;
    add(parts, start, start + 1, marker);
    add(parts, start + 1 + match[1].length, end, marker);
    const link = Decoration.mark({
      class: 'cm-md-link',
      attributes: { 'data-href': match[2] }
    });
    add(parts, start + 1, start + 1 + match[1].length, link);
    occupied.push([start + 1, start + 1 + match[1].length]);
  }

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const start = from + match.index;
    const end = start + match[0].length;
    if (!free(start, end)) continue;
    add(parts, start, start + 1, marker);
    add(parts, end - 1, end, marker);
    add(parts, start + 1, end - 1, inlineCode);
    occupied.push([start + 1, end - 1]);
  }

  for (const match of text.matchAll(/(\*\*|__)(.+?)\1/g)) {
    const start = from + match.index;
    const end = start + match[0].length;
    if (!free(start, end)) continue;
    add(parts, start, start + 2, marker);
    add(parts, end - 2, end, marker);
    add(parts, start + 2, end - 2, bold);
    occupied.push([start + 2, end - 2]);
  }

  for (const match of text.matchAll(/(^|[^\*])(\*)([^*\n]+)\*(?!\*)/g)) {
    const start = from + match.index + match[1].length;
    const end = start + match[2].length + match[3].length + 1;
    if (!free(start, end)) continue;
    add(parts, start, start + 1, marker);
    add(parts, end - 1, end, marker);
    add(parts, start + 1, end - 1, italic);
    occupied.push([start + 1, end - 1]);
  }

  void line;
}

function buildDecorations(view) {
  const builder = new RangeSetBuilder();
  const parts = [];
  const selection = view.state.selection.main;
  const activeFrom = view.hasFocus ? view.state.doc.lineAt(selection.from).number : -1;
  const activeTo = view.hasFocus ? view.state.doc.lineAt(selection.to).number : -1;
  let inFence = false;

  for (let number = 1; number <= view.state.doc.lines; number += 1) {
    const line = view.state.doc.line(number);
    const text = line.text;
    const active = number >= activeFrom && number <= activeTo;
    const fence = /^\s*```/.test(text);

    if (fence) {
      parts.push({ from: line.from, to: line.from, decoration: codeLine });
      if (!active) {
        parts.push({ from: line.from, to: line.to, decoration: Decoration.mark({ class: 'cm-md-fence' }) });
      }
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      parts.push({ from: line.from, to: line.from, decoration: codeLine });
      continue;
    }
    if (active) continue;

    const heading = /^(#{1,6})(\s+)(.*)$/.exec(text);
    if (heading) {
      parts.push({ from: line.from, to: line.from, decoration: headingLines[heading[1].length - 1] });
      add(parts, line.from, line.from + heading[1].length + heading[2].length, marker);
      inlineDecorations(parts, line, line.from + heading[1].length + heading[2].length, heading[3]);
      continue;
    }

    const quote = /^(>\s?)(.*)$/.exec(text);
    if (quote) {
      parts.push({ from: line.from, to: line.from, decoration: quoteLine });
      add(parts, line.from, line.from + quote[1].length, marker);
      inlineDecorations(parts, line, line.from + quote[1].length, quote[2]);
      continue;
    }

    const bullet = /^(\s*[-+*]\s+)(.*)$/.exec(text);
    if (bullet) {
      parts.push({ from: line.from, to: line.from, decoration: bulletLine });
      add(parts, line.from, line.from + bullet[1].length, marker);
      inlineDecorations(parts, line, line.from + bullet[1].length, bullet[2]);
      continue;
    }

    const ordered = /^(\s*\d+\.\s+)(.*)$/.exec(text);
    if (ordered) {
      parts.push({ from: line.from, to: line.from, decoration: orderedLine });
      inlineDecorations(parts, line, line.from + ordered[1].length, ordered[2]);
      continue;
    }

    inlineDecorations(parts, line, line.from, text);
  }

  parts.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const part of parts) builder.add(part.from, part.to, part.decoration);
  return builder.finish();
}

const livePreview = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildDecorations(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
      this.decorations = buildDecorations(update.view);
    }
  }
}, {
  decorations: value => value.decorations
});

export function createLiveEditor(options) {
  let applying = false;
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.value || '',
      extensions: [
        history(),
        markdown(),
        EditorView.lineWrapping,
        highlightActiveLine(),
        placeholder('# 从这里开始写…'),
        livePreview,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !applying) options.onChange(view.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          mousedown(event) {
            const wiki = event.target.closest('.cm-wiki-link');
            if (wiki) {
              event.preventDefault();
              options.onWikiLink(wiki.dataset.wiki);
              return true;
            }
            const link = event.target.closest('.cm-md-link');
            if (link && link.dataset.href) {
              event.preventDefault();
              if (/^(https?:|mailto:|\.{0,2}\/|#|\/)/i.test(link.dataset.href)) {
                window.open(link.dataset.href, '_blank', 'noopener,noreferrer');
              }
              return true;
            }
            return false;
          }
        })
      ]
    })
  });

  return {
    focus() { view.focus(); },
    getValue() { return view.state.doc.toString(); },
    setValue(value) {
      const next = String(value || '');
      if (next === view.state.doc.toString()) return;
      applying = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: 0 }
      });
      applying = false;
    },
    destroy() { view.destroy(); }
  };
}
