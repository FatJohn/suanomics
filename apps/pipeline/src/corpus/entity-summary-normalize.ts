import { truncateAtSentence } from '../agents/_truncate.js'

// prompt 要的是 80–120 字。這裡的上限刻意放寬到 160：規格由 prompt 表達，這一層只負責
// 「不論模型怎麼寫，下游拿到的長度都有界」，把緩衝收太緊會讓正常的 130 字摘要無謂被切。
//
// 為什麼是後處理截斷、不是 zod 約束 + 重試（當初列為候選的修法之一）：
// enrichEntitySummary 的 zod 是**全有全無**的——長度不合格會讓整包 parse 失敗，連
// entities 與 topicTags 一起丟掉，重試三次都不合格就整篇文章失去 enrichment。用一個
// 長度偏差換掉全部標註不划算，所以長度走截斷、只有語言走重試（且保底不丟資料）。
export const SUMMARY_HARD_MAX = 160

// 句界截斷的下限：句界若落在這之前，切過去會留下一句話的殘骸，還不如硬切到上限。
export const SUMMARY_MIN = 60

export function clampContentSummary(s: string): string {
  // truncateAtSentence 對 string 一定回 string，unknown-safe 那條分支在這裡走不到
  return truncateAtSentence(s, SUMMARY_HARD_MAX, SUMMARY_MIN) as string
}

// eslint-disable-next-line regexp/no-obscure-range -- CJK 統一表意文字區塊，範圍是刻意的
const CJK = /[㐀-䶿一-鿿]/g
const LATIN_LETTER = /[a-z]/gi

/**
 * 摘要是不是「主要以中文書寫」。
 *
 * 只比中日韓表意文字與拉丁字母的相對數量，數字、標點與空白不計——中文摘要本來就會夾帶
 * 「Fed」「5.25%」這類原文詞，把它們算進分母會讓正常的中文摘要被誤判成英文。
 */
export function isMostlyChinese(s: string): boolean {
  const cjk = s.match(CJK)?.length ?? 0
  const latin = s.match(LATIN_LETTER)?.length ?? 0
  if (cjk + latin === 0)
    return false
  return cjk / (cjk + latin) >= 0.5
}
