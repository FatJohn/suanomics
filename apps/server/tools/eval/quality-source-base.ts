import type { MarketBrief } from '@suanomics/shared'
import type { QualitySourceArticle } from './quality-input.js'

// pairwise judge 的事實底本原本只有「一份 brief 自己選的新聞」，撞兩個真缺口——
// (1) 兩臂選稿不同時，另一臂引用的新聞不在底本裡、judge 判它虛構；
// (2) writer 引用的市場數字（WTI／CPI／殖利率／融資餘額…）出自 market_data_points，
//     從來不在新聞底本裡，judge 一樣看不到就判虛構。
// 這個檔案負責組出「兩臂都覆蓋得到」的底本原料：collectBriefNewsRefs 收兩臂各自
// 引用過的新聞（不只選稿當下那一份），snapshotSourceArticle 把市場數據快照包成一則
// 額外的「新聞」餵給 judge。

export interface BriefNewsRefs { ids: number[], urls: string[] }

/**
 * 從多份 brief 收集「這份 brief 引用過的新聞」：newsTitlesById 的 key（newsId）
 * 與 citations[].url。兩者各自跨 brief 去重；ids 升冪排序（純數字識別碼、排序穩定
 * 好比對），urls 保留首次出現順序（url 沒有天然大小順序、保留出現序方便除錯）。
 */
export function collectBriefNewsRefs(briefs: readonly MarketBrief[]): BriefNewsRefs {
  const idSet = new Set<number>()
  const urlSeen = new Set<string>()
  const urls: string[] = []

  for (const brief of briefs) {
    const titlesById = brief.newsTitlesById
    if (titlesById) {
      for (const key of Object.keys(titlesById)) {
        const n = Number(key)
        if (Number.isInteger(n) && n > 0)
          idSet.add(n)
      }
    }
    for (const c of brief.citations) {
      if (typeof c.url === 'string' && c.url.length > 0 && !urlSeen.has(c.url)) {
        urlSeen.add(c.url)
        urls.push(c.url)
      }
    }
  }

  return { ids: [...idSet].sort((a, b) => a - b), urls }
}

/**
 * 把市場數據快照包成一則事實底本文章。null／全空白視為「這次沒有快照」（degrade），
 * 回 null 讓呼叫端決定要不要加進底本陣列。
 */
export function snapshotSourceArticle(reportDate: string, snapshotBlock: string | null): QualitySourceArticle | null {
  if (snapshotBlock === null || snapshotBlock.trim().length === 0)
    return null
  return { title: `市場數據快照（${reportDate}）`, text: snapshotBlock }
}
