import type { FixtureManifest } from '../../fixtures/manifest.js'

// mojibake bug 只在「Content-Type 沒有 charset、meta 寫 big5」這個真實形狀下
// 才會發生——用 UTF-8 字串手寫一份「假裝是 Big5」的樣本測不出這個 bug，因為問題本身
// 就是位元組層級的編碼不對，字串字面值在 TS 原始碼裡永遠是 UTF-8。
//
// 所以這份樣本雖然標成 synthetic，**它的 bytes 是真的以 Big5 codec 編碼落地的**——
// 合成的是「內容」，不是「編碼」。用 UTF-8 存一份長得像 Big5 的檔會讓這支測試永遠綠。
export const scraperFixtures: FixtureManifest = {
  baseUrl: import.meta.url,
  label: 'external/scraper',
  entries: [
    {
      file: 'big5-meta-no-header-charset.html',
      kind: 'opaque',
      origin: 'synthetic',
      url: null,
      transform: '2026-09-10 以 Python 把一段手寫的繁中 HTML 用 big5 codec 編碼寫檔（787 bytes）。'
        + 'charset meta 刻意排在偏移量 484、不在檔頭第一行——真實案例裡它會被 title／link／script '
        + '推到幾百 bytes 之後，把 meta 放在偏移量 0 會讓「有沒有真的掃 sniff window」驗不出來。',
      note: '這份樣本唯一的目的是驗「Content-Type 沒有 charset → 掃 meta → 用 big5 解碼」'
        + '這條路徑；用 res.text() 硬解會產生 U+FFFD，那就是這份樣本要防的 bug 本體。'
        + '前身是 2026-09-08 從一個商業財經網站首頁抓下來的 20,480 bytes 快照（meta 在偏移量 288）；'
        + '2026-09-10 為了 open source 換成合成內容——形狀（無 header charset、meta 寫 big5、'
        + '真 Big5 bytes）完全保留，換掉的只有第三方的文字內容。'
        + '因此它證明不了任何關於某個真實站台的事，只證明解碼路徑對這個形狀的行為。',
    },
  ],
}
