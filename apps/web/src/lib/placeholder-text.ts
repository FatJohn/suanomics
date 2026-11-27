// 模型偶爾把欄位留成佔位字（#124：產業理由直接輸出 placeholder）。只比對整段，
// 句子裡順帶提到這些詞的正常內容不算；判準與正向語料在 placeholder-text.test.ts。
const PLACEHOLDER_WORDS = new Set([
  'placeholder',
  'tbd',
  'todo',
  'n/a',
  'null',
  'undefined',
  'none',
  'lorem ipsum',
  'reasoning',
  '待補',
  '待補充',
  '待填',
  '略',
  '無',
  '理由',
])

const EDGE = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu

export function isPlaceholderText(s: string): boolean {
  const core = s.replace(EDGE, '').toLowerCase()
  return core === '' || PLACEHOLDER_WORDS.has(core)
}
