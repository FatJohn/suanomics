import type { FixtureManifest } from './manifest.js'
import { corpusSourceFixtures } from '../corpus/sources/__fixtures__/manifest.js'
import { scraperFixtures } from '../external/__fixtures__/manifest.js'
import { marketDataFixtures } from '../market-data/__fixtures__/manifest.js'

// 顯式登記而不是 glob 掃目錄：新增一批樣本時要在這裡加一行，那一行就是「我知道它存在」
// 的簽名。glob 會讓漏寫 manifest 的樣本靜靜地不被檢查——那正是這裡在治的形狀。
export const FIXTURE_MANIFESTS: readonly FixtureManifest[] = [
  marketDataFixtures,
  corpusSourceFixtures,
  scraperFixtures,
]
