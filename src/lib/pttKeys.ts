// PTT key handling is keyed on KeyboardEvent.code (physical key position), not
// KeyboardEvent.key (the character produced). Using `.key` meant binding a
// symbol like "~" (Shift+`) required holding Shift every time to re-trigger it —
// unworkable for a hold-to-talk key. `.code` is shift-invariant.

const CODE_TO_CHAR: Record<string, string> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
}
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(65 + i)
  CODE_TO_CHAR[`Key${letter}`] = letter
}
for (let i = 0; i <= 9; i++) {
  CODE_TO_CHAR[`Digit${i}`] = String(i)
}

const CODE_TO_NAMED: Record<string, { label: string }> = {
  Space: { label: 'Space' },
  Tab: { label: 'Tab' },
  Escape: { label: 'Esc' },
  Backspace: { label: 'Backspace' },
  Delete: { label: 'Delete' },
  Insert: { label: 'Insert' },
  Home: { label: 'Home' },
  End: { label: 'End' },
  PageUp: { label: 'PgUp' },
  PageDown: { label: 'PgDn' },
  ArrowUp: { label: '↑' },
  ArrowDown: { label: '↓' },
  ArrowLeft: { label: '←' },
  ArrowRight: { label: '→' },
}
for (let i = 1; i <= 24; i++) {
  CODE_TO_NAMED[`F${i}`] = { label: `F${i}` }
}

export const PTT_CODE_DEFAULT = 'Backquote'

export const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'CapsLock',
])

export function codeToLabel(code: string): string {
  if (CODE_TO_CHAR[code]) return CODE_TO_CHAR[code]
  if (CODE_TO_NAMED[code]) return CODE_TO_NAMED[code].label
  return code
}

// Pre-fix, PTT keys were stored as KeyboardEvent.key (e.g. "`", "~", "a", "F5").
// Named keys (Escape, ArrowUp, F1-F24, ...) happen to share the same string in
// both `.key` and `.code`, but letters/digits/punctuation don't. This maps a
// legacy `.key` value to its physical `.code` equivalent so existing saved
// settings keep working under the new shift-invariant matching.
const LEGACY_KEY_TO_CODE: Record<string, string> = {
  ' ': 'Space',
  '`': 'Backquote', '~': 'Backquote',
  '-': 'Minus', '_': 'Minus',
  '=': 'Equal', '+': 'Equal',
  '[': 'BracketLeft', '{': 'BracketLeft',
  ']': 'BracketRight', '}': 'BracketRight',
  '\\': 'Backslash', '|': 'Backslash',
  ';': 'Semicolon', ':': 'Semicolon',
  "'": 'Quote', '"': 'Quote',
  ',': 'Comma', '<': 'Comma',
  '.': 'Period', '>': 'Period',
  '/': 'Slash', '?': 'Slash',
}
for (let i = 0; i < 26; i++) {
  const upper = String.fromCharCode(65 + i)
  const lower = String.fromCharCode(97 + i)
  LEGACY_KEY_TO_CODE[upper] = `Key${upper}`
  LEGACY_KEY_TO_CODE[lower] = `Key${upper}`
}
const DIGIT_SHIFT_CHARS = [')', '!', '@', '#', '$', '%', '^', '&', '*', '(']
for (let i = 0; i <= 9; i++) {
  LEGACY_KEY_TO_CODE[String(i)] = `Digit${i}`
  LEGACY_KEY_TO_CODE[DIGIT_SHIFT_CHARS[i]] = `Digit${i}`
}

export function normalizeStoredPttKey(value: string): string {
  if (!value) return PTT_CODE_DEFAULT
  if (value in CODE_TO_CHAR || value in CODE_TO_NAMED) return value
  return LEGACY_KEY_TO_CODE[value] ?? value
}

// Push the current PTT code to the Electron main process, so the global
// (out-of-focus) key detection stays in sync with the in-window one.
export function syncPttKeyToMain(code: string) {
  const api = (window as unknown as { electronAPI?: { setPttKey?: (k: string) => void } }).electronAPI
  api?.setPttKey?.(code)
}
