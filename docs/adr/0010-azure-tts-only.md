---
status: accepted
date: 2026-11-07
---

# Podcast 語音只用 Azure Speech

Podcast 需要台灣口音的中文語音。2026-11-07 查核：Azure Speech 免費層每月 50 萬字元、有 zh-TW 具名神經語音，是唯一確認免費且有台灣口音的服務；Google Cloud TTS 的 cmn-TW 只有 Standard 與 WaveNet；ElevenLabs、OpenAI、MiniMax、Fish Audio 都沒有 zh-TW 專屬語音；開源的 BreezyVoice 有台灣口音但需要 GPU，Actions runner 跑不動。每日講稿 5k–15k 字塞得進免費額度。決定 podcast 的 TTS 只接 Azure，v0 的 Gemini TTS 路徑（已知長音檔變調、按 token 計價）不帶進新架構。

## Consequences

- podcast 屬 phase 2；音檔存 Cloudflare R2 免費層，網站直接給 R2 公開 URL。
- v0 的 `azure-tts-client.ts` 可直接搬。
