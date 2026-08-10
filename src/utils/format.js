// src/utils/format.js

/** Safely turns a string/number into a "$x.xx" display string. */
export function toMoney(value) {
  const n = parseFloat(value);
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** Strips markdown-style characters the AI sometimes wraps answers in. */
export function stripMarkdown(text) {
  return text.replace(/[*"`#]/g, '').trim();
}
