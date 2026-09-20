# Smoke Test

部署、重新部署、或具文件意義的設定變更後跑這份。下面的 `<server-domain>` 就是
`docs/operations/deploy.md` 說的那個公開 URL；本機用 `docker compose -f docker-compose.deploy.yml`
起的話是 `localhost:3000`。

## Daily Refresh

跑新的一天 brief data 前先依序跑這三步、缺一步 brief 會回 `no news for YYYY-MM-DD`。
第三步帶 `chainPodcast:true` 時 podcast 文稿與 TTS 會自己接在後面，不必另外觸發：

優先走 HTTP trigger——部署者自備的每日排程就是打這幾個端點，跟排程走同一條路徑才驗得到
排程會遇到的東西；而且每一步都留 `background_jobs` row，查得到、輪詢得到。

```bash
BASE=https://<server-domain>        # 排程設定裡打的同一個 server 網址
SECRET=<INGEST_TRIGGER_SECRET>
DATE=$(TZ=Asia/Taipei date +%F)     # 報告日＝台北曆日（brief.briefDate 同一個概念）
post() { curl -sS -X POST "$BASE$1" -H "authorization: Bearer $SECRET" \
  -H 'content-type: application/json' -d "$2"; }

post /internal/market-data/refresh "{\"bucket\":\"$DATE\"}"
post /internal/news/refresh        "{\"bucket\":\"${DATE}T20\"}"
post /internal/brief/enqueue       "{\"date\":\"$DATE\",\"chainPodcast\":true}"
# 每個回應都有 auditId，用 GET /api/jobs/<auditId> 輪詢到 completed 再進下一步。
```

要在容器裡直接跑 CLI 也可以（`docker compose -f docker-compose.deploy.yml exec server
pnpm --filter server run news:refresh`）；CLI 會自己起 runner、跑到整條鏈完成才退出。

注意：

- 不要跑 `corpus:refresh` — 那是 Cascade external_articles pipeline、餵不到 daily brief。
- `podcast:tts` 用 positional `<YYYY-MM-DD>`、`podcast:generate` 用 `--date YYYY-MM-DD` flag、兩者參數格式不同。
- **跑 refresh 前後不要部署**：重啟 server 會把所有進行中的 job 標成 failed（見 [deploy](deploy.md)），
  而且 `PODCAST_STORAGE_KIND=local` 時 `.audio-cache/podcast/` 在容器本地、重建就沒了、要重跑
  `podcast:tts`。部署環境用 `PODCAST_STORAGE_KIND=s3`（R2）就不受這一條影響。

驗證整條鏈都成功：

```bash
curl -s "$BASE/api/brief/daily" | jq '.brief.briefDate'          # 預期 == DATE
curl -sI "$BASE/audio/podcast/$DATE.mp3" | head -1               # 預期 200
```

## 開始前

- 確認 API health endpoint 有回應：`GET /health`。
- 確認 web app 在 `/` 載得起來。
- 確認 backend env vars 都齊。
- 確認 database migration 已跑。
- 確認 web build 指向預期的 API URL。
- 測 async Cascade jobs 時、確認 server 起著（HTTP 與 job 執行在同一個 process，`GET /health` 的 `jobs` 欄位會回每個 kind 的佇列統計）。

## Cascade

1. 打開 `/brief`。
2. 確認有 brief、或 empty / loading 狀態能優雅渲染。
3. 確認每日 brief API 有回應：`GET /api/brief/daily`。
4. 打開 `/brief/news/:id` 的 detail view。
5. 確認 detail API 有回應：`GET /api/brief/news/:id`。
6. 透過 `/brief/analyze` 送單則新聞 URL 或文字。
7. 確認 `POST /api/brief/analyze` 回 `202` 並帶 `pollUrl`。
8. Poll `GET /api/jobs/:jobId` 直到 job 完成。
9. 確認 `GET /api/brief/analyses/:id` 回完成後的結果。
10. 確認結果包含可追溯的 citations 與 cascade 推理（有的話）。
11. 啟用 podcast / audio 時、確認 `/audio/podcast/:filename` 載得到、UI 用了正確的 API base URL。

## Transcript Tool

1. 打開 `/transcript`。
2. 貼一個有字幕的 YouTube URL（例：任何 TED Talk / 知名頻道影片）。
3. 確認 `POST /api/transcript` 回 `200` + transcript 內文。
4. 試貼非 YouTube URL、確認回 `400 invalid_url`。
5. 試貼 YouTube URL 但影片無字幕、確認回 `422 no_transcript`。

## 可選的 API 檢查

```bash
curl -fsS "$BASE/health"
curl -fsS "$BASE/api/brief/daily"
curl -fsS "$BASE/api/brief/by-date/2026-04-28"
curl -fsS "$BASE/api/brief/news/<id>"
curl -fsS "$BASE/api/jobs/<jobId>"
```

貼文分析：

```bash
curl -fsS -X POST "$BASE/api/brief/analyze" \
  -H "Content-Type: application/json" \
  -d '{"title":"半導體供應鏈測試","content":"美國宣布對中國進口半導體產品加徵關稅，市場關注台灣供應鏈影響。"}'
```

Transcript：

```bash
curl -fsS -X POST "$BASE/api/transcript" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=<id>"}'
```

Internal corpus refresh、用 production secret：

```bash
curl -fsS -X POST "$BASE/internal/corpus/refresh" \
  -H "Authorization: Bearer <INGEST_TRIGGER_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"force":true}'
```

## Smoke 後

記錄失敗時、附上：

- Feature
- 使用的 URL 或輸入
- 預期行為
- 實際行為
- 相關 API response 或 log 片段
