// The file viewer's CodeMirror half: the languages, loombot's colours, and one editor that is READ-ONLY in
// view mode and editable in edit mode — so pressing Edit changes nothing about how the file looks.
//
// IMPORTED DYNAMICALLY, and only for a text file: `app.js` calls `import("./code.js")` the first time it
// has source or markdown to show, and this module's static import pulls in the ~735 KB bundle. A PDF or an
// image never gets here (and its registration does not even carry the bundle — `viewer_mcp.ts`).
//
// Pure page machinery, no socket and no state about the file: `app.js` owns the file, the modes, the
// dirty flag, the draft and the questions; this module owns how text is drawn and edited.
import {
  bracketMatching,
  closeBrackets,
  closeBracketsKeymap,
  Compartment,
  crosshairCursor,
  css,
  defaultKeymap,
  drawSelection,
  dropCursor,
  EditorState,
  EditorView,
  foldGutter,
  foldKeymap,
  go,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightCode,
  highlightSelectionMatches,
  highlightSpecialChars,
  HighlightStyle,
  history,
  historyKeymap,
  html,
  indentOnInput,
  indentWithTab,
  javascript,
  json,
  keymap,
  lineNumbers,
  markdown,
  python,
  rectangularSelection,
  rust,
  search,
  searchKeymap,
  shell,
  stex,
  StreamLanguage,
  syntaxHighlighting,
  tags as t,
  toml,
  yaml,
} from "./codemirror.js";

// ── languages: from the extension, and nothing else ─────────────────────────────────────────────────
//
// Lezer grammars where one is maintained; CodeMirror's own legacy stream modes for shell, TOML and LaTeX
// (there is no maintained MIT Lezer grammar for any of the three: the one LaTeX package is AGPL, and
// @fig/lezer-bash has not been published since 2023). Anything else is plain text, still editable.
const stream = (mode) => () => StreamLanguage.define(mode);
const LANGS = {
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  json: () => json(),
  jsonc: () => json(),
  webmanifest: () => json(),
  py: () => python(),
  pyi: () => python(),
  md: () => markdown({ codeLanguages: fenced }),
  markdown: () => markdown({ codeLanguages: fenced }),
  css: () => css(),
  html: () => html(),
  htm: () => html(),
  yaml: () => yaml(),
  yml: () => yaml(),
  rs: () => rust(),
  go: () => go(),
  sh: stream(shell),
  bash: stream(shell),
  zsh: stream(shell),
  toml: stream(toml),
  tex: stream(stex),
  sty: stream(stex),
  cls: stream(stex),
  ltx: stream(stex),
};
const NAMES = {
  ts: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  jsonc: "JSON",
  webmanifest: "JSON",
  py: "Python",
  pyi: "Python",
  md: "Markdown",
  markdown: "Markdown",
  css: "CSS",
  html: "HTML",
  htm: "HTML",
  yaml: "YAML",
  yml: "YAML",
  rs: "Rust",
  go: "Go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  toml: "TOML",
  tex: "LaTeX",
  sty: "LaTeX",
  cls: "LaTeX",
  ltx: "LaTeX",
};
/** Dotfiles and bare names that are shell by convention. */
const SHELL_NAMES = [".bashrc", ".zshrc", ".profile", ".bash_profile", ".zprofile", ".envrc"];

function extOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (SHELL_NAMES.includes(name)) return "sh";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
function langFor(path) {
  const make = LANGS[extOf(path)];
  return make ? make() : [];
}
/** A fenced block in markdown is highlighted as its own language, from the grammars already here. */
function fenced(info) {
  const make = LANGS[String(info).trim().toLowerCase().split(/\s/)[0]] ??
    {
      typescript: LANGS.ts,
      javascript: LANGS.js,
      python: LANGS.py,
      shell: LANGS.sh,
      latex: LANGS.tex,
    }[
      String(info).trim().toLowerCase()
    ];
  if (!make) return null;
  const l = make();
  return l.language ?? l;
}

// ── loombot's colours, and no others ──────────────────────────────────────────────────────────────────
//
// Every colour is one of loombot's published variables (/theme.css, `shared/theme.ts`), so light and dark are
// loombot's decision and this page cannot disagree with the panel around it. `color-mix` only ever mixes a
// loombot variable with transparency.
const tint = (v, pct) => "color-mix(in srgb, var(" + v + ") " + pct + "%, transparent)";
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--fg)" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { caretColor: "var(--fg)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  ".cm-gutters": {
    backgroundColor: "var(--panel)",
    color: "var(--dim)",
    borderRight: "1px solid var(--line)",
  },
  ".cm-activeLine": { backgroundColor: tint("--panel", 60) },
  ".cm-activeLineGutter": { backgroundColor: "var(--line)", color: "var(--fg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: tint("--fn", 28) },
  ".cm-selectionMatch": { backgroundColor: tint("--fn", 14) },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: tint("--ok", 30),
    outline: "1px solid " + tint("--ok", 70),
  },
  "&.cm-focused .cm-nonmatchingBracket": { color: "var(--danger-fg)" },
  ".cm-searchMatch": { backgroundColor: tint("--notice", 30), outline: "1px solid var(--notice)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: tint("--notice", 60) },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--fg)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--line)" },
  ".cm-textfield": {
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--line)",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--panel)",
    color: "var(--fg)",
    border: "1px solid var(--line)",
  },
  ".cm-foldPlaceholder": { backgroundColor: "var(--panel)", color: "var(--dim)", border: "none" },
  ".cm-tooltip": {
    backgroundColor: "var(--panel)",
    color: "var(--fg)",
    border: "1px solid var(--line)",
  },
});
const highlight = HighlightStyle.define([
  {
    tag: [
      t.keyword,
      t.controlKeyword,
      t.operatorKeyword,
      t.definitionKeyword,
      t.moduleKeyword,
      t.modifier,
    ],
    color: "var(--kw)",
  },
  { tag: [t.tagName, t.self], color: "var(--kw)" },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue, t.url],
    color: "var(--str)",
  },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.escape], color: "var(--num)" },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
      t.typeName,
      t.className,
      t.namespace,
      t.macroName,
      t.labelName,
    ],
    color: "var(--fn)",
  },
  { tag: [t.attributeName, t.propertyName], color: "var(--fn)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta],
    color: "var(--dim)",
    fontStyle: "italic",
  },
  { tag: t.heading, color: "var(--fn)", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--fn)", textDecoration: "underline" },
  { tag: [t.processingInstruction, t.contentSeparator], color: "var(--dim)" },
  { tag: t.invalid, color: "var(--danger-fg)" },
]);

// ── the editor ──────────────────────────────────────────────────────────────────────────────────────

/** READ-ONLY is two facets: no edits through any path (readOnly), and no caret or input (editable). */
const modeExt = (on) => on ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)];

/** The language's name for the header: "TypeScript", "LaTeX", or "plain text". */
export function langName(path) {
  return NAMES[extOf(path)] || "plain text";
}

/**
 * SOFT WRAP for prose, not for code. Plain text (no language here: .txt, .log, a bare name) and markdown
 * wrap long lines at the panel's edge; everything with a grammar keeps one screen line per line and scrolls
 * sideways, because indentation and column alignment are what code is read by. Visual only — CodeMirror's
 * `lineWrapping` is `white-space: pre-wrap` on the content, so the document (and the saved bytes) never
 * gains a newline. It follows the FILE, not the mode: a .txt looks the same in view and edit, which is the
 * point of one editor for both; rendered markdown in view is not the editor at all.
 */
export function wraps(path) {
  const ext = extOf(path);
  return ext === "md" || ext === "markdown" || !LANGS[ext];
}

/** Everything the editor is for one file and one mode. Exported so a test can see what a file gets. */
export function editorExtensions(path, on, hooks, editConf) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlight),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (hooks.save(), true) },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    theme,
    langFor(path),
    editConf.of(modeExt(on)),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.changed();
    }),
    wraps(path) ? EditorView.lineWrapping : [],
  ];
}

/**
 * THE ONE EDITOR on this page. `hooks.changed()` runs on every document change and `hooks.save()` on
 * Cmd/Ctrl-S inside it; both are app.js's. Created once, when the first text file is shown — which also
 * mounts the highlight style that `highlightFences` below paints with.
 */
export function createEditor(parent, hooks) {
  const editConf = new Compartment();
  const extensions = (path, on) => editorExtensions(path, on, hooks, editConf);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: extensions("", false) }),
  });
  view.contentDOM.setAttribute("aria-label", "file text");
  let editable = false;
  return {
    view,
    /** A NEW STATE, not a replace: undo history belongs to one file, and must not undo into the last one. */
    load(path, text) {
      editable = false;
      view.setState(EditorState.create({ doc: text, extensions: extensions(path, false) }));
      view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
    },
    setEditable(on) {
      editable = on;
      view.dispatch({ effects: editConf.reconfigure(modeExt(on)) });
      view.requestMeasure();
      if (on) view.focus();
    },
    editable: () => editable,
    text: () => view.state.doc.toString(),
    /** Replace the whole text AS AN EDIT, so it is undoable (a restored draft, a discarded change). */
    replace(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    goto(n) {
      const line = view.state.doc.line(Math.max(1, Math.min(n, view.state.doc.lines)));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
    },
    hasFocus: () => view.hasFocus,
  };
}

/**
 * FENCED CODE IN RENDERED MARKDOWN, coloured by the same grammars and the same style as the editor. The
 * server sends each block as escaped text in `<pre class="fence" data-lang>`; a language this page has
 * no grammar for stays plain text.
 */
export function highlightFences(root) {
  for (const pre of root.querySelectorAll("pre.fence")) {
    const lang = fenced(pre.dataset.lang || "");
    const code = pre.querySelector("code");
    if (!lang || !code) continue;
    const text = code.textContent;
    const out = document.createDocumentFragment();
    highlightCode(text, lang.parser.parse(text), highlight, (piece, cls) => {
      if (!cls) return void out.append(piece);
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = piece;
      out.append(span);
    }, () => out.append("\n"));
    code.replaceChildren(out);
  }
}
