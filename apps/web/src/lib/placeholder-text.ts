// 模型偶爾把欄位留成佔位字（#124：產業理由直接輸出 placeholder）。只比對整段，
// 句子裡順帶提到這些詞的正常內容不算；判準與正向語料在 placeholder-text.test.ts。
const PLACEHOLDER_WORDS = new Set([
  'placeholder',
  'placeholder text',
  'tbd',
  'tba',
  'todo',
  'n/a',
  'na',
  'n.a',
  'nil',
  'null',
  'undefined',
  'none',
  'string',
  'xxx',
  'reasoning',
  '待補',
  '待補充',
  '待填',
  '待確認',
  '未提供',
  '暫無',
  '尚無',
  '無資料',
  '同上',
  '略',
  '無',
  '空',
  '缺',
  '理由',
])

const EDGE = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu

export function isPlaceholderText(s: string): boolean {
  // NFKC 把全形英數與標點轉回半形；JS 的 \s 不含零寬空白這類 Cf 字元，要另外拿掉。
  const core = s.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(EDGE, '').replace(/\s+/g, ' ').toLowerCase()
  return core === '' || core.startsWith('lorem ipsum') || PLACEHOLDER_WORDS.has(core)
}
