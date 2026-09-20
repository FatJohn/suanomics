import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isValidEvalDate } from './date.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export interface CanaryDirResolution {
  dir: string
  kind: 'real' | 'example'
}

export interface CanaryDirDeps {
  realDir?: string
  exampleDir?: string
  exists?: (p: string) => boolean
}

/**
 * 決定四支量測腳本要讀哪一組 fixtures：真的那組（第三方新聞全文，不隨公開 repo
 * 發佈）優先，不存在就退版到合成的 example 組。
 *
 * 為什麼回傳 `kind` 而不是只回 `dir`：這個退版是靜默的，而呼叫端全是量測工具——
 * 拿合成新聞跑 pairwise／claim 產出率，程式不會報錯、數字照印，看起來跟真樣本
 * 跑出來的報告長得一模一樣。真 fixtures 哪天被搬走或路徑改掉，
 * 使用者會在毫無警訊的情況下開始拿虛構新聞當量測基準。呼叫端必須問得到
 * 「我現在吃的是哪一組」，才有辦法把這件事印出來給人看（見 `canaryExampleNotice`）。
 */
export function resolveCanaryDir(deps: CanaryDirDeps = {}): CanaryDirResolution {
  const realDir = deps.realDir ?? resolve(HERE, './fixtures/canary')
  const exampleDir = deps.exampleDir ?? resolve(HERE, './fixtures/canary-example')
  const exists = deps.exists ?? existsSync
  return exists(realDir) ? { dir: realDir, kind: 'real' } : { dir: exampleDir, kind: 'example' }
}

const RESOLVED = resolveCanaryDir()

/**
 * canary fixtures 的位置。
 *
 * 為什麼要有唯一真相：這條路徑原本在四個量測腳本各自用 `resolve(HERE, ...)` 算，
 * 深度還各不相同，搬動 fixtures 或搬動任一腳本都得記得同時修另外三處。
 * 收在 fixtures 的隔壁之後，這條路徑不再依賴任何呼叫端的位置。
 */
export const CANARY_DIR = RESOLVED.dir

/** `CANARY_DIR` 目前指向真樣本還是合成 example——見 `resolveCanaryDir` 的 JSDoc。 */
export const CANARY_KIND = RESOLVED.kind

/** `CANARY_KIND === 'example'` 時回一句可直接印給使用者看的警告，否則回 null。 */
export function canaryExampleNotice(kind: CanaryDirResolution['kind'] = CANARY_KIND): string | null {
  return kind === 'example'
    ? '[canary-example] 目前吃的是合成的 example fixtures（虛構新聞），跑出來的數字不可當量測基準；要量測請換成自己準備的真實 canary fixtures。'
    : null
}

/**
 * 報告檔開頭的合成資料橫幅；`kind === 'real'` 時回 null（不加任何東西）。
 *
 * 為什麼要有這個、`canaryExampleNotice` 不夠：那句只印在 stderr，報告檔本身完全
 * 不帶標記——用合成 fixtures 跑出來的報告，跟用真樣本跑出來的長得一模一樣，日後
 * 被複製、貼進別的文件或事後翻閱時，沒有任何線索能分辨。這個橫幅要跟著報告內容
 * 一起落檔，離開當次執行的 stderr 之後依然看得出來。
 */
export function canaryExampleBanner(kind: CanaryDirResolution['kind'] = CANARY_KIND): string | null {
  return kind === 'example'
    ? '> **[canary-example] 合成資料警示**：本報告跑的是 canary-example 的虛構新聞與編造數字，不可當量測基準；要量測請換成自己準備的真實 canary fixtures。'
    : null
}

/** canary fixture 的 sources.json 逐列形狀（news_items dump 的子集）。 */
export interface CanarySource {
  id: number
  title: string
  url: string
  publishedAt: string
  contentText: string
  topicTags?: string[]
}

/**
 * 掃出可用的 canary 日期（依日期排序）。
 *
 * 三道過濾缺一不可，而且各自擋掉一種真實存在的髒資料：
 * `existsSync` 擋掉全新 clone 還沒有 fixtures 的情況；`isDirectory` 擋掉同層的
 * README.md；`isValidEvalDate` 擋掉 `_scratch` 這類非日期目錄與 2026-02-30 這種
 * 格式對但不存在的日期——漏掉任一道，下一步的 readFileSync 才會炸，
 * 而那時的錯誤訊息指向的是 sources.json 不見了，不是目錄選錯了。
 */
export function listCanaryDates(dir: string = CANARY_DIR): string[] {
  if (!existsSync(dir))
    return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && isValidEvalDate(e.name))
    .map(e => e.name)
    .sort()
}

/** 單日 fixture 目錄（底下有 brief.json 與 sources.json）。 */
export function canaryDatePath(date: string, dir: string = CANARY_DIR): string {
  return resolve(dir, date)
}

/** 讀出單日的事實底本新聞。 */
export function loadCanarySources(date: string, dir: string = CANARY_DIR): CanarySource[] {
  return JSON.parse(readFileSync(resolve(canaryDatePath(date, dir), 'sources.json'), 'utf8')) as CanarySource[]
}
