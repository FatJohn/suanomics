# Security Policy

## 支援範圍

這是一個個人維護的專案（solo maintainer），沒有正式的 release 版本或 LTS 分支——**只有 `main` 分支會收到安全性修正**。如果你 fork 或部署了舊的 commit，請自行同步到最新的 `main`。

這個系統：

- 不處理使用者帳號、密碼或付費資訊（沒有帳號系統）。
- 會把新聞內容送給第三方 LLM provider（Gemini、選擇性的 Anthropic 或自架 OpenAI 相容端點）處理，並把 podcast 音檔存到物件儲存（Cloudflare R2 或相容服務）。
- 不執行任何交易或資金移動，也不代管使用者的任何金融帳戶或憑證。

如果你發現的問題屬於「第三方套件本身有已知 CVE」，麻煩優先回報給該套件的上游；如果你能證明這個 repo 的用法讓那個 CVE 變成實際可利用（exploitable），請照下面的流程回報。

## 怎麼回報安全問題

**請不要用一般的 public issue 回報安全漏洞。**

這個 repo 使用 GitHub 的 **private vulnerability reporting**（私密安全通報）機制：到 repo 的 **Security 分頁 → Report a vulnerability**，透過那個表單私下提交，只有維護者看得到內容。

回報時盡量附上：

- 問題描述與可能的影響範圍
- 重現步驟或概念性驗證（proof of concept），如果有的話
- 受影響的檔案／端點／版本（commit hash 或分支名）

## 回應時間

這是個人專案、非商業服務，**沒有任何正式的 SLA**。維護者會盡力（best effort）在收到回報後**幾天內**做初步確認，但無法保證固定的回應或修復時程——複雜或需要架構調整的問題可能需要更久。如果一段時間沒有回音，歡迎透過同一個私密回報管道追蹤詢問。

## 給貢獻者的提醒

- 這個專案用 `.env` 檔管理 API key 與其他敏感設定（`apps/server/.env`、`apps/web/.env`）。`.env` 已列在 `.gitignore`，**請不要把自己的 API key、資料庫密碼或其他憑證 commit 進版本控制**——即使是不小心 commit 到自己的 fork 分支，也請假設那把 key 已經外洩，直接到對應的 provider 後台撤銷／輪替，不要只是從 git 歷史裡刪掉檔案就結束。
- 如果你不小心在 PR 或 issue 裡貼出了真實的 API key 或密碼，請立刻到發 key 的服務（例如 Google AI Studio、Anthropic Console、你自架端點的管理介面）撤銷該把 key，這個 repo 本身無法幫你撤銷第三方服務上的憑證。
