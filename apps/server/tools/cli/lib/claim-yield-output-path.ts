import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { taipeiDateOf } from '@suanomics/shared'

// 量測報告要寫到哪一個檔案。與腳本主檔分開的理由與 claim-metrics.ts 同一條：
// 主檔尾端會呼叫 main()，import 進測試就會真的開跑，所以可測的部分要住在這裡。

/** 讓測試可以注入假的檔案系統，不必真的在 repo 裡建檔。 */
export interface PathDeps {
  exists?: (p: string) => boolean
}

/**
 * 輸出檔名帶**執行日期**（台北）。
 *
 * 原本寫死成一個不帶日期的固定檔名，於是 2026-08-06 重跑
 * **覆蓋掉了前一次跑的量測原始輸出**——而那份檔案正是量測報告引用過的證據
 * （D1 58.2% 那組數字的出處）。當時是靠 `git status` 才發現、從 git 還原的；
 * 沒注意到的話，兩份不同的量測會只剩一份，而且看不出來曾經有另一份。
 */
export function outPathFor(outDir: string, now: Date): string {
  const day = taipeiDateOf(now)
  return resolve(outDir, `${day}-claim-yield-output.txt`)
}

/**
 * 已存在就換一個不衝突的檔名，**絕不覆蓋、也絕不因此中止**。
 *
 * 為什麼不是直接 throw：走到寫檔這一步時，這次跑已經花掉 45 分鐘與約 $2.7 的 API 費用。
 * 在那之後才因為檔名衝突而失敗，等於把量測結果丟掉——那比覆蓋更糟。
 * 真正的把關是 {@link warnIfOutPathTaken}，它在**開跑前**就出聲。
 */
export function freeOutPath(base: string, deps: PathDeps = {}): string {
  const exists = deps.exists ?? existsSync
  if (!exists(base))
    return base
  for (let i = 2; i < 100; i++) {
    const candidate = base.replace(/\.txt$/, `-${i}.txt`)
    if (!exists(candidate))
      return candidate
  }
  // 同一天跑到第 100 次才會走到這裡；用時間戳保證不覆蓋，而不是放棄。
  return base.replace(/\.txt$/, `-${Date.now()}.txt`)
}

/** 開跑前就出聲：與其跑完 45 分鐘才發現撞名，不如現在讓執行者決定要不要先清掉舊的。 */
export function warnIfOutPathTaken(base: string, deps: PathDeps = {}): boolean {
  const exists = deps.exists ?? existsSync
  if (!exists(base))
    return false
  console.warn(
    `[claim-yield] ${base} 已存在——今天已經跑過一次。\n`
    + `  本次結果會寫到帶序號的檔名（不覆蓋）。要取代舊的請先自行刪除或改名。`,
  )
  return true
}
