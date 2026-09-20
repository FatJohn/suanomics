/**
 * 這篇文章的 body 有沒有超出標題的資訊——決定要不要花 LLM 去 enrich 它。
 *
 * 為什麼是**文章層級**而不是來源層級（2026-08-21 決策）：原本「不 enrich」與
 * 「不可引用」被併成一個降級組，因為那四五個 Google News 代理剛好兩者皆是。但這兩件事問的
 * 是不同的問題、對象也不同——
 *
 * - 這支（規則一）決定**要不要為這篇文章花 LLM**、要不要讓它產生一段憑標題編的摘要。
 * - `AGGREGATOR_PROXY_SLUGS` 與 retriever 的轉址網址排除（規則二／三）決定**一篇已經有
 *   摘要的文章**能不能進 prompt 被引用。它們真正的作用對象是既有那 9,000 多篇——
 *   新文章被規則一擋下之後根本不會有摘要。
 *
 * ★ 更正一個第一版寫錯的理由：原本寫「`fomc-statements` 不該 enrich、但應該可以被引用」。
 *   **那在現行管線上不成立。** 不 enrich 的文章 `entities` 與 `topic_tags` 都是 `[]`，
 *   而 `agents/retriever.ts` 兩條檢索路徑都是 jsonb `@>` containment——空陣列永遠不會命中，
 *   所以它同樣檢索不到、也就引用不到。獨立複查指出來的。
 *   拆成兩條規則仍然對（上面那兩個問題確實不同），但別再用「fomc 可引用」當理由。
 *
 * 文章層級還有一個真的好處：**自我修正**。來源換 feed 時判定自動跟著變——`fomc-statements`
 * 正是在換成官方 RSS 之後才變成 body 只有標題（`<description>` 15/15 逐字等於
 * `<title>`），寫死的降級名單不會知道這種變化。
 *
 * 判準是**資訊量**不是長度：剝掉標記與 HTML entity、把大小寫與標點正規化掉之後，
 * 若 body 為空、或整段被標題涵蓋，就沒有新資訊。Google News 的 excerpt 是
 * `<a href="…">標題</a>&nbsp;&nbsp;<font>發行商</font>`——剝完剛好就是標題本身
 * （item title 為「標題 - 發行商」，差別只在分隔符），所以必須正規化標點才擋得住。
 *
 * 保守方向：只有「完全沒有新資訊」才回 false。多出任何實質內容都算有 body。
 */
export function hasBodyBeyondTitle(title: string, excerpt: string | null | undefined): boolean {
  const body = normalizeForComparison(excerpt ?? '')
  if (body === '')
    return false
  return !normalizeForComparison(title).includes(body)
}

/** 剝標記與 entity、去掉所有非字母數字（含 CJK 保留為字母），再轉小寫。 */
function normalizeForComparison(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}
