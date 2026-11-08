// 日報產出的「能不能用」判定。與 source-silence 那組同一個形狀——
// 既有的健康訊號問「有沒有」（`!= null`），而系統在乎的是「能不能用」。
//
// **為什麼吃 `unknown` 而不是 `MarketBrief`**：唯一的呼叫端是
// `/api/ops/publication-status`，它讀的是 `daily_briefs.brief_json`（jsonb，型別 unknown），
// 而且**刻意不做 MarketBriefSchema.parse**——健康訊號若依賴 schema 通過才算得出來，
// 那 schema 沒守住的形狀就會變成「算不出來」而不是「不健康」，正好是要抓的那一類。
// 落地路徑也確實不保證 schema：orchestrator 最後一段是
// `return { ...brief, narrative, viewpoints, claimLedger }`，而 `MarketBriefSchema.parse`
// 在那之前的 `assembleDailyBrief` 就跑完了，這三個欄位是 parse 之後才貼上去的。
//
// 判定一律**寬鬆進、嚴格判**：型別不對就是不可用，不 throw。這些函式餵的是告警，
// 讓它自己炸掉等於把「訊號壞了」變成「端點壞了」。

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 有非空白字元的字串。空字串與純空白都算沒有內容。 */
function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * narrative 有沒有讀者看得到的正文。
 *
 * 要求 intro／outro 與**每一段** body 都有字：少一段 body 讀者面就是一塊空白，
 * 「其中一段有內容」不足以說這份報告可用。
 */
export function hasNarrativeContent(v: unknown): boolean {
  if (!isRecord(v))
    return false
  if (!hasText(v.intro) || !hasText(v.outro))
    return false
  const sections = v.sections
  if (!Array.isArray(sections) || sections.length === 0)
    return false
  return sections.every(s => isRecord(s) && hasText(s.body))
}

/** dailyThesis 有沒有字。缺欄位（editor 選稿層降級）與空字串一律 false。 */
export function hasThesisContent(v: unknown): boolean {
  return hasText(v)
}

/**
 * 正反觀點區塊可不可用。
 *
 * 陣列一律 false：`viewpoints` 的契約是物件，降級成 `[]` 時 `!= null` 會說健康，
 * 而讀者面的區塊是空的——這是要防的形狀之一。
 */
export function hasViewpointsContent(v: unknown): boolean {
  if (!isRecord(v))
    return false
  const points = [v.supportPoints, v.riskPoints]
  if (!points.every(p => Array.isArray(p) && p.length > 0 && p.every(hasText)))
    return false
  return hasText(v.netRead)
}

/**
 * podcast 文稿可不可用。
 *
 * 只看 acts：hook 與 takeaway 各一段，缺了是品質下降、不是聽不了，
 * 而 acts 全空等於整集沒有內容。門檻刻意訂在「聽眾拿不到東西」而不是「不完美」——
 * 這個旗標餵的是 `/api/ops/publication-status` 的 DEGRADED 訊號，是給監控端拿來告警的。
 */
export function hasPodcastContent(v: unknown): boolean {
  if (!isRecord(v))
    return false
  const acts = v.acts
  if (!Array.isArray(acts) || acts.length === 0)
    return false
  return acts.every(a => isRecord(a) && hasText(a.body))
}

/**
 * 音檔路徑有沒有值。
 *
 * ★ **只驗 DB 欄位、不驗 R2 上的物件真的在**。路徑有值而物件不存在（或長度 0）時
 * 讀者按播放沒有聲音，這裡照樣回 true——要補的是一支對 `/audio/<date>` 的存在性檢查，
 * 那需要另一條外部請求與它自己的失敗率量測，不在這裡的範圍內。
 */
export function hasAudioPath(v: unknown): boolean {
  return hasText(v)
}

/** claim ledger 的產出量與其中可追溯的筆數。 */
export interface ClaimLedgerHealth {
  total: number
  /** 有 claim 文字**且**至少掛一條 evidenceRef 的筆數。 */
  grounded: number
}

/**
 * 算 claim ledger 的健康數字。
 *
 * 回 `null` 代表「這份報告根本沒有 claimLedger 這個欄位」（舊報告就是
 * 這樣，prod 實測 2026-08-07 以前皆為 absent），**不是 0**。兩者要分得開：0 是今天的
 * pipeline 產不出 claim，null 是這份報告的形狀裡沒有這件事——呼叫端據此決定要不要告警。
 */
export function summarizeClaimLedger(ledger: unknown): ClaimLedgerHealth | null {
  if (!Array.isArray(ledger))
    return null
  const grounded = ledger.filter(c =>
    isRecord(c) && hasText(c.claim) && Array.isArray(c.evidenceRefs) && c.evidenceRefs.length > 0,
  ).length
  return { total: ledger.length, grounded }
}

/** 一份 `daily_briefs` 列的「能不能用」摘要。 */
export interface BriefContentHealth {
  narrative: boolean
  dailyThesis: boolean
  viewpoints: boolean
  podcast: boolean
  audio: boolean
  /** `null` = 這份報告沒有 claimLedger 欄位（或根本沒有這份報告）。 */
  claims: ClaimLedgerHealth | null
}

function pick(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined
}

/**
 * 把一列 `daily_briefs` 折成 `/api/ops/publication-status` 要的旗標。
 *
 * **欄位名字一律關在這裡**：呼叫端只傳三個 jsonb／text 欄位進來，拼錯 key 的機會就只剩
 * 這一處，而這一處有測試。缺報（row 不存在）時三個參數都是 undefined，旗標全 false、
 * claims 為 null——與「報告存在但內容是空的」在數值上長得一樣，兩者由呼叫端的 `exists`
 * 分開，不在這裡混判。
 */
export function summarizeBriefContent(p: {
  briefJson: unknown
  podcastJson: unknown
  podcastAudioPath: unknown
}): BriefContentHealth {
  return {
    narrative: hasNarrativeContent(pick(p.briefJson, 'narrative')),
    dailyThesis: hasThesisContent(pick(p.briefJson, 'dailyThesis')),
    viewpoints: hasViewpointsContent(pick(p.briefJson, 'viewpoints')),
    podcast: hasPodcastContent(p.podcastJson),
    audio: hasAudioPath(p.podcastAudioPath),
    claims: summarizeClaimLedger(pick(p.briefJson, 'claimLedger')),
  }
}
