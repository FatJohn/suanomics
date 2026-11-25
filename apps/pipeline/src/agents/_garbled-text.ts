/**
 * 亂碼偵測：模型偶爾會吐出整句字元被替換掉的輸出（不是編碼壞掉，是生成本身壞掉）。
 *
 * 為什麼既有機制擋不住：`stripControlChars`（`narrative-shared.ts`）治的是控制字元、零寬、
 * BOM 與孤 surrogate；`checkCompliance` 找的是投信投顧法禁用語；`ViewpointsSchema` 只看
 * 長度與筆數。壞掉的字是**合法碼位的 CJK**，三道全部放行。
 *
 * 判準刻意只取「幾乎不可能出現在台股財經文字裡的區段」，不是「罕用字」——後者需要字頻表，
 * 而誤判會把正常句子刪掉。因此這是**下界**：常用區內的替換字（`羮債`←美債、`殛利率`←毛利率）
 * 抓不到。實測 2026-08-12 的 4 行亂碼全部帶有擴充 A 區字元，故此判準對已知樣本 100% 命中。
 *
 * 證據：prod 37 天、157 行 viewpoints 與全部 narrative 皆 0 命中（2026-08-14 掃描），
 * 所以拿它當 gate 不會誤傷既有輸出。
 */

// CJK 擴充 A（U+3400–U+4DBF）與擴充 B 以上（U+20000–U+2FA1F）。
// 相容表意文字（U+F900–U+FAFF）刻意不納入：那區有正當用途（人名異體字），誤判成本較高。
const GARBLED_RE = /[\u{3400}-\u{4DBF}\u{20000}-\u{2FA1F}]/u

export function hasGarbledChars(s: string): boolean {
  return GARBLED_RE.test(s)
}
