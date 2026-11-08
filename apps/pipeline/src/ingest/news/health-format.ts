import type { NewsHealthFlag, SourceHealth } from './health.js'

export interface FormatOptions {
  windowDays: number
  now: Date
}

/**
 * 把 `summarizeNewsHealth` 的結果排成固定寬度表格。
 *
 * **刻意不印 displayName**：它是中文，等寬終端機下一個 CJK 佔兩格，用 `padEnd` 對齊
 * 會歪掉；要對齊就得引一套字寬表，為了一欄不值得。slug 是 ASCII、而且是所有工具
 * （SQL、SLO 端點、seed）共用的識別字，看 slug 就夠了。
 */
const COLUMNS = [
  { key: 'slug', head: 'slug', width: 30, align: 'left' },
  { key: 'kind', head: 'kind', width: 6, align: 'left' },
  { key: 'total', head: 'total', width: 7, align: 'right' },
  { key: 'window', head: '窗內', width: 6, align: 'right' },
  { key: 'usable', head: '可用', width: 6, align: 'right' },
  { key: 'scrape', head: 'scrape', width: 7, align: 'right' },
  { key: 'excerpt', head: 'excerpt', width: 8, align: 'right' },
  { key: 'p50', head: 'p50', width: 6, align: 'right' },
  { key: 'p90', head: 'p90', width: 7, align: 'right' },
  { key: 'latest', head: '最新 pubDate', width: 13, align: 'left' },
  { key: 'stale', head: '停更', width: 5, align: 'right' },
  { key: 'flags', head: 'flags', width: 0, align: 'left' },
] as const

function pad(s: string, width: number, align: 'left' | 'right'): string {
  if (width === 0)
    return s
  return align === 'right' ? s.padStart(width) : s.padEnd(width)
}

function cellsFor(r: SourceHealth): Record<string, string> {
  const kind = [r.isActive ? '' : 'off', r.isProxy ? 'proxy' : ''].filter(Boolean).join('/') || 'ok'
  return {
    slug: r.slug,
    kind,
    total: String(r.totalItems),
    window: String(r.inWindow),
    usable: String(r.usable),
    scrape: String(r.byContentSource.scrape ?? 0),
    excerpt: String(r.byContentSource['rss-excerpt'] ?? 0),
    p50: String(r.bodyLenP50),
    p90: String(r.bodyLenP90),
    latest: r.latestPublishedAt?.toISOString().slice(0, 10) ?? '-',
    stale: r.stalenessDays === null ? '-' : String(r.stalenessDays),
    flags: r.flags.join(' '),
  }
}

/** 每個 flag 的一句話說明——報告貼進 issue 之後，讀的人不必回頭翻程式碼。 */
const FLAG_HINT: Record<NewsHealthFlag, string> = {
  'silent': '啟用中但窗內零則（feed 掛了或被擋）',
  'title-only': '窗內有則數，但一則都沒有超出標題（代理錨點或空殼 feed）',
  'no-scrape': '窗內沒有任何一則抓到正文（全停在 rss-excerpt）',
  'zombie': 'feed 回得了 200 也有內容，但已經停更',
}

export function formatNewsHealthReport(rows: readonly SourceHealth[], opts: FormatOptions): string {
  const lines: string[] = []
  // ★ 先印檢查了幾個來源：**什麼都沒驗到與全部通過的輸出不可以長得一樣**
  // （同 `/api/ops/publication-status` 對 corpus 那組立的規矩：空庫與全綠不能長一樣）。指錯
  // DATABASE_URL 打到一個空庫時，下面會印「沒有來源被標記」——沒有這一行就會被讀成全綠。
  const activeCount = rows.filter(r => r.isActive).length
  lines.push(`news_sources 健康檢查｜檢查 ${rows.length} 個來源（啟用 ${activeCount}）｜窗＝近 ${opts.windowDays} 天（fetched_at）｜now=${opts.now.toISOString()}`)
  lines.push('')
  lines.push(COLUMNS.map(c => pad(c.head, c.width, c.align)).join(' '))
  lines.push(COLUMNS.map(c => '-'.repeat(c.width === 0 ? 5 : c.width)).join(' '))
  for (const r of rows) {
    const cells = cellsFor(r)
    lines.push(COLUMNS.map(c => pad(cells[c.key] ?? '', c.width, c.align)).join(' ').trimEnd())
  }

  lines.push('')
  const flagged = rows.filter(r => r.flags.length > 0)
  if (flagged.length === 0) {
    lines.push('旗標：沒有來源被標記。')
  }
  else {
    lines.push(`旗標：${flagged.length}/${rows.length} 個來源被標記`)
    for (const flag of Object.keys(FLAG_HINT) as NewsHealthFlag[]) {
      const hit = flagged.filter(r => r.flags.includes(flag))
      if (hit.length > 0)
        lines.push(`  ${flag}（${FLAG_HINT[flag]}）：${hit.map(r => r.slug).join('、')}`)
    }
  }
  return lines.join('\n')
}
