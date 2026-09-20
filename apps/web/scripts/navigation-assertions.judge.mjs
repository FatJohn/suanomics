/**
 * 導覽斷言的判定：把「跑完之後落在哪個網址」與期望比對。
 *
 * 判定本身只是字串比對，抽成獨立模組是為了讓**分類邏輯**（PASS／FAIL／SKIP）有單元測試——
 * 那是這支 harness 最容易寫錯的地方：素材缺席（當天沒有帶 newsId 的來源、只有一天報告）
 * 時必須記成 SKIP 並說出原因，不能發一條假 PASS，也不能以「元件壞了」FAIL 把人指向錯的
 * 地方。`layout-assertions` 的頁尾探針與展開輪就是踩過這個坑之後才長出 SKIP 的。
 */

/**
 * @param {{ label: string, expected?: string, actual?: string, skipReason?: string, detail?: string[] }} result
 * @returns 判定結果：素材缺席回 `{ skip }`，否則回 `{ pass, detail }`
 */
export function judgeOne(result) {
  if (result.skipReason)
    return { label: result.label, skip: result.skipReason }

  const pass = result.actual === result.expected
  const detail = [
    `期望 ${result.expected}`,
    `實際 ${result.actual}`,
    ...(result.detail ?? []),
  ]
  return { label: result.label, pass, detail }
}

/**
 * @param {Array<Parameters<typeof judgeOne>[0]>} results
 */
export function judge(results) {
  const assertions = []
  const skipped = []
  for (const r of results) {
    const verdict = judgeOne(r)
    if ('skip' in verdict)
      skipped.push({ label: verdict.label, reason: verdict.skip })
    else
      assertions.push(verdict)
  }
  return { assertions, skipped, failed: assertions.filter(a => !a.pass).length }
}
