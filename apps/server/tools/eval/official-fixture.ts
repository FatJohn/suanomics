import type { OfficialAnnouncement } from '../../src/brief/official-announcements.js'
import { taipeiDateOf } from '@suanomics/shared'
import { buildOfficialAnnouncementsBlock } from '../../src/brief/official-announcements.js'

/**
 * 量測工具共用的官方公告 fixture（2026-08-28）。
 *
 * **為什麼需要它**：`officialBlock` 於 2026-08-28 接進 editor 與 narrative 的 prompt，
 * 但三支量測腳本（`narrative-smoke`／`narrative-ledger-ab`／`storyline-continuity-ab`）都是
 * fixture-driven、不連 DB，所以量到的一直是「沒有官方公告的那個 prompt」——block 的
 * 效果**量不到**。這份 fixture 讓它們看到的 prompt 與 prod 同形。
 *
 * **為什麼不直接連 DB 撈**：那三支刻意解耦 DB（canary 那條線更是明文如此），連上去等於
 * 讓量測結果隨本機資料漂移，跨輪不可比。
 *
 * **日期是相對報告日的偏移、不是寫死的曆日**：block 每行以日期開頭，寫死曆日會讓
 * 2026-01-01 的情境看到 8 月的公告，模型讀到的是「七個月前的舊聞」，量到的行為就不是
 * prod 的行為。偏移上限 3 天，與 `context.ts` 的 `OFFICIAL_WINDOW_DAYS` 對齊。
 *
 * **已知限制（報告裡要一起寫）**：內容取自 2026-08 的真實公告，與各腳本情境日的真實
 * 公告無關。所以「模型會不會引用官方公告、引用時有沒有扭曲」量得到，「該日真正發生的
 * 官方消息」量不到——與 `claim-metrics.ts` 那份序列 fixture 同一種限制。
 *
 * ★ **判讀時先排除這一項**：有幾則標題自帶民國曆月份（「115年7月金融情況」等），錨到
 * 早於它的情境日（`storyline-continuity-ab` 的 2026-06-18、`narrative-smoke` 的 2026-01-01）就會出現
 * 「今天的公告在講未來的統計」這種時序矛盾。**這是刻意接受的取捨**：把帶月份的那幾則
 * 換掉，fixture 就只剩沒有數字的公關稿，而具名數字正是官方公告的價值所在（全 corpus
 * 內文品質最好的一批）。所以量測若看到模型把「7 月」當成今日數據，**先確認是不是這個
 * 限制造成的**，不要直接記成模型缺陷。
 */
export interface OfficialFixtureItem {
  slug: string
  title: string
  summary: string | null
  /** 報告日往前幾個台北曆日。上限 3（prod 的回溯窗）。 */
  offsetDays: number
  /**
   * 該曆日的台北時間 `HH:MM`。證交所那批一律 `00:00`——真實資料 550/550 筆的
   * `published_at` 都是 16:00Z，也就是台北隔日 00:00。fixture 重現這個形狀，
   * 曆日換算若退回 UTC 就會整批差一天，測試抓得到。
   */
  taipeiTime: string
}

/** 取自本機含完整歷史的資料庫的真實公告（2026-08-24～08-27），逐字未改寫。 */
export const OFFICIAL_FIXTURE_ITEMS: readonly OfficialFixtureItem[] = Object.freeze([
  {
    slug: 'cbc-press',
    title: '115年7月金融情況',
    summary: '中央銀行公布115年7月金融情況，貨幣總計數M1B及M2年增率分別下降為7.34%及7.42%，主要受到外資淨匯出影響。同時，全體貨幣機構放款與投資年增率上升至9.07%，主要反映對公營事業及政府債權年增率走高。',
    offsetDays: 1,
    taipeiTime: '16:20',
  },
  {
    slug: 'cbc-press',
    title: '115年7月份台北外匯市場概況',
    summary: '中央銀行公布115年7月份台北外匯市場概況，全體外匯交易量淨額共計10,460.2億美元，平均每日外匯交易量為475.5億美元。內容涵蓋依交易對象、幣別、類別與方法之統計數據，並列出其他金融商品辦理情形。',
    offsetDays: 2,
    taipeiTime: '16:20',
  },
  {
    slug: 'fsc-news',
    title: '金管會擬開放證券商受託買賣外國有價證券得辦理外幣融資業務，有助擴大證券商......',
    summary: '金管會擬開放證券商辦理外國有價證券複委託業務之外幣融資，並進行法規修正預告。本次修訂重點包含申辦證券商資格條件、融資業務承作上限、融資標的範圍與比率以及擔保品帳戶規範，旨在提升證券商業務多元性、增加國際金融競爭力並擴大業務規模。',
    offsetDays: 1,
    taipeiTime: '08:00',
  },
  {
    slug: 'fsc-news',
    title: '上市（櫃）公司公告申報115年第2季財務報告情形',
    summary: '截至115年8月14日，除1家公司未如期出具外，上市櫃公司均已完成第2季財務報告申報。受惠於人工智慧與高效能運算需求強勁，上市櫃公司115年上半年營收及稅前淨利皆創下近十年同期最高紀錄，半導體業、電子零組件業與電腦及週邊設備業表現尤為顯著。',
    offsetDays: 2,
    taipeiTime: '08:00',
  },
  {
    // 刻意保留一則例行索引貼文：`isRoutineIndexPost` 應該把它濾掉。少了它，過濾器
    // 哪天失效也不會有任何量測看得出來。
    slug: 'fsc-news',
    title: '金融監督管理委員會證券期貨局每日新聞（115年8月26日）',
    summary: '金融監督管理委員會證券期貨局發布每日新聞，公布115年8月26日相關公開發行公司動態與證券投資信託基金案件之最新審查進度與生效情形。',
    offsetDays: 0,
    taipeiTime: '08:00',
  },
  {
    slug: 'twse-announcements',
    title: '全體證券商115年7月稅後淨利109.61億元，累計稅後淨利1,550.51億元',
    summary: '全體證券商公告115年7月份稅後淨利為109.61億元，較上月減少，主要受大盤總成交值下降影響，使經紀、自營及承銷等業務損益均較上月衰退；累計1至7月全體證券商稅後淨利達1,550.51億元，較去年同期顯著成長。',
    offsetDays: 0,
    taipeiTime: '00:00',
  },
  {
    slug: 'twse-announcements',
    title: '臺灣證券交易所有價證券上市審議委員會審議通過兆捷科技國際股份有限公司初次申請股票創新板上市案',
    summary: '臺灣證券交易所召開有價證券上市審議委員會，審議通過兆捷科技國際股份有限公司初次申請股票創新板上市案，後續仍須提報臺灣證券交易所董事會核議。該公司主要從事半導體特殊氣體之合成、純化、混配、分裝與充填等業務。',
    offsetDays: 1,
    taipeiTime: '00:00',
  },
  {
    slug: 'ey-press',
    title: '出席新能源國際論壇 卓揆：全力打造充足、韌性且符合多元綠能的電力建設',
    summary: '行政院長卓榮泰出席新能源國際論壇表示，政府將全力打造充足、具韌性且多元綠能的電力建設，因應AI產業發展與全球能源挑戰。政府除調升未來十年用電需求預估，也積極推動電網韌性計畫、太陽光電與離岸風電。',
    offsetDays: 0,
    taipeiTime: '12:14',
  },
  {
    slug: 'ey-press',
    title: '2026生技產業策略諮議委員會開幕 卓揆：加速AI、數位醫療與生技產業發展 落實健康台灣 強化國際布局',
    summary: '行政院長卓榮泰出席生技產業策略諮議委員會議開幕式表示，政府將持續推動AI與數位醫療發展，結合科技應用與法規制度，落實健康台灣理念。臺灣生技產業在投資與營業額均持續成長，醫療照護水準亦獲國際肯定。',
    offsetDays: 2,
    taipeiTime: '14:15',
  },
])

/** 把偏移錨到報告日，產出與 DB 同型的公告列。 */
export function officialFixtureAnnouncements(reportDate: string): OfficialAnnouncement[] {
  return OFFICIAL_FIXTURE_ITEMS.map((f) => {
    // 台北曆日的減法：先取報告日的台北零時，退 N 天，再取回台北曆日。
    // 台灣無日光節約，+08:00 是常數（同 context.ts 的理由）。
    const day = taipeiDateOf(new Date(new Date(`${reportDate}T00:00:00+08:00`).getTime() - f.offsetDays * 864e5))
    return {
      slug: f.slug,
      title: f.title,
      summary: f.summary,
      publishedAt: new Date(`${day}T${f.taipeiTime}:00+08:00`),
    }
  })
}

/**
 * 官方公告 block，用 **prod 那支 `buildOfficialAnnouncementsBlock`** 產、不是手寫字串——
 * 量測腳本看到的就是 prod 會餵給 LLM 的原文（同 `narrative-smoke` 用真的
 * `buildSnapshotBlock` 的理由）。過濾、per-source 上限與截斷也因此一併被量進去。
 */
export function buildOfficialFixtureBlock(reportDate: string): string | null {
  return buildOfficialAnnouncementsBlock(
    officialFixtureAnnouncements(reportDate),
    { now: new Date(`${reportDate}T05:10:00+08:00`) },
  )
}
