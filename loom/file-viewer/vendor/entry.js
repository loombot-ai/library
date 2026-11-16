// The one module the file viewer's page imports (page/code.js, dynamically: a PDF never loads it). Everything it needs from CodeMirror, re-exported
// so a bundler can tree-shake the rest away.
export { Compartment, EditorState, StateEffect } from "@codemirror/state";
export {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
export {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  LanguageDescription,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
export {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
export { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
export { highlightCode, tags } from "@lezer/highlight";
export { javascript } from "@codemirror/lang-javascript";
export { json } from "@codemirror/lang-json";
export { python } from "@codemirror/lang-python";
export { markdown } from "@codemirror/lang-markdown";
export { css } from "@codemirror/lang-css";
export { html } from "@codemirror/lang-html";
export { yaml } from "@codemirror/lang-yaml";
export { rust } from "@codemirror/lang-rust";
export { go } from "@codemirror/lang-go";
export { shell } from "@codemirror/legacy-modes/mode/shell";
export { stex } from "@codemirror/legacy-modes/mode/stex";
export { toml } from "@codemirror/legacy-modes/mode/toml";
