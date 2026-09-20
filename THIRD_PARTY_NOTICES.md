# Third-Party Notices

這個專案本身以 Apache License 2.0 釋出（見 [LICENSE](LICENSE)）。下面列出 repo 內容有引用或衍生自第三方素材的地方。執行期依賴的 npm 套件各自的授權不在此列，以各套件自己的 LICENSE 為準。

## 分析框架（prompt frames）的出處

`apps/server/src/prompts/` 底下部分 system prompt 的「分析框架」段落，是用 `packages/prompt-research` 的流程從下列公開素材**蒸餾**（摘要、改寫成條列式的分析角度）而來，各檔檔頭的 `Frames derived from:` 註明了每一支用到哪些來源。

### alirezarezvani/claude-skills

- 來源：<https://github.com/alirezarezvani/claude-skills>（`finance/` 底下的數份 `SKILL.md`）
- 授權：MIT License

```text
MIT License

Copyright (c) 2025 Alireza Rezvani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 公開的財經 YouTube 直播

- 部分 prompt 的分析框架，其分析角度歸納自公開的財經直播節目；來源在對應 prompt 檔的檔頭以不具名代號（`yt-finance-live`）標示，不列節目名稱與網址。
- 這個 repo 只保留從節目內容歸納出的**分析角度**（條列式的推論框架），不含節目的逐字稿、影音或畫面。
- 與任何節目及其製作者沒有關聯、也未獲其背書；prompt 裡的 `[from: …]` 標記只用來區分框架出處的類別，不指向特定節目。

## 已知的 copyleft 授權相依

以 `pnpm licenses list --prod` 盤點（2026-09-20）時，已知帶 copyleft 條款的 npm 相依有下面兩個，特別列出。這份清單不保證窮盡，相依升級後也可能改變；其餘 npm 相依的授權不在本檔涵蓋範圍，以各套件自己的 LICENSE 為準（見本檔開頭）。

### `@breezystack/lamejs`（1.2.7）

- 授權：LGPL-3.0
- 用途：`apps/server` 的 runtime 相依，用於 podcast 音檔的 MP3 編碼（見 [`apps/server/src/podcast-tts/mp3-encode.ts`](apps/server/src/podcast-tts/mp3-encode.ts)）。
- 使用方式：以未修改的 npm 套件形式引用，未複製其原始碼進本 repo。
- 若你要再散布含這個套件的成品（例如自行 build 並發佈的 Docker image），請自行確認遵守 LGPL-3.0 的條款（如提供對應原始碼或可替換該套件的機制）。

### `lightningcss`（1.33.0，含各平台的原生二進位套件）

- 授權：MPL-2.0
- 來源：不是這個 repo 直接宣告的相依，是經由 `vite` 帶進來的 CSS 處理工具。
- 使用方式：以未修改的 npm 套件形式安裝，未複製其原始碼進本 repo。
- `pnpm install` 會把它裝進 `node_modules`，所以自行 build 的 Docker image 裡也會有它；再散布時請自行確認遵守 MPL-2.0 的條款。
