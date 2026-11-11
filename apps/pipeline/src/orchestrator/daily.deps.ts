import type { DailyDeps } from './daily.js'
import { isTwseTradingDay, taipeiDateOf } from '@suanomics/shared'
import { getDailyCostGate } from '../agents/cost-gate.js'
import { hasCompleteBriefOnOrAfter } from '../db/repos/brief-rerun.js'
import { getDailyBriefByDate, saveDailyBrief, saveIncompleteDailyBrief } from '../db/repos/news-repo.js'
import { applyEditorResult } from '../db/repos/storylines-repo.js'
import { EMPTY_MARKET_CONTEXT, loadMarketContext } from '../ingest/market-data/context.js'
import { runNewsRefresh } from '../ingest/news/refresh.js'
import { runIngest } from '../ingest/run.js'
import { selectNewsViaEditor } from './editor-stage.js'
import { generateBrief } from './run-brief.js'

export function createDailyDeps(): DailyDeps {
  return {
    gate: getDailyCostGate(),
    log: event => console.warn(JSON.stringify(event)),
    isTradingDay: isTwseTradingDay,
    findExistingBrief: getDailyBriefByDate,
    refreshNews: async () => (await runNewsRefresh()).totalInserted,
    today: () => taipeiDateOf(new Date()),
    hasCompleteBriefOnOrAfter,
    ingest: async (date) => {
      // 交易日已由 orchestrator 判斷過，這裡帶 force 只是略過 ingest 自己的同一道檢查。
      const result = await runIngest({ date, force: true })
      if (result.status === 'skipped')
        throw new Error(`ingest 略過了 ${date}`)
      if (result.failures.length > 0)
        console.warn(JSON.stringify({ event: 'ingest_partial_failure', failures: result.failures }))
      return result.selected
    },
    // 市場資料讀取失敗不擋 brief，下游各段自帶缺值處理。
    loadMarket: date => loadMarketContext({ reportDate: date }).catch(() => EMPTY_MARKET_CONTEXT),
    selectNews: (date, selected, market) => selectNewsViaEditor({ date, selected, market }),
    generateBrief,
    saveBrief: saveDailyBrief,
    saveIncompleteBrief: saveIncompleteDailyBrief,
    applyStorylines: async (date, storyline) => {
      await applyEditorResult({
        briefDate: date,
        touches: storyline.storylineTouches,
        resolves: storyline.resolveStorylines,
        newStorylines: storyline.newStorylines,
      })
    },
  }
}
