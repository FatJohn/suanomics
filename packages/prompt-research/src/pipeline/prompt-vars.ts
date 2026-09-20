/**
 * Source-aware prompt template variables for the shared deep pipeline.
 *
 * yt-transcript 與 podcast-rss 共用同套 segmenter / lens / consolidator prompts、
 * 但 source-specific 字眼（YouTube 直播 vs Podcast 節目）會混淆 LLM、影響擷取
 * 品質。把這些字眼參數化、各 source 注入自己版本。
 */
export interface DeepPipelinePromptVars {
  /** 用於 segmenter / consolidator 開頭定位、例：「財經 ___ 的段落分類員」 */
  sourceKindLabel: string
  /** 用於 lens prompt 內「這集 ___」字眼 */
  episodeWord: string
  /** consolidator 輸出 digest 的 markdown title prefix */
  digestTitlePrefix: string
}

export const YT_PROMPT_VARS: DeepPipelinePromptVars = {
  // 平台名（不含 episode-type 後綴）— 為了讓 segmenter / consolidator 的 yt prompt
  // 字面與重構前 byte-for-byte 一致：原 segmenter 是「財經 YouTube 直播」、原 consolidator
  // 是「財經 YouTube KOL」、兩處共用詞是 `YouTube`、`直播` 由 `episodeWord` 補上。
  sourceKindLabel: 'YouTube',
  episodeWord: '直播',
  digestTitlePrefix: 'YT Analyst Digest',
}

export const PODCAST_PROMPT_VARS: DeepPipelinePromptVars = {
  // 與 YT_PROMPT_VARS 同紀律：sourceKindLabel 只放平台名、不含 unit 後綴。
  // 注入 yt-transcript prompt 模板後產出「財經 Podcast 節目」/「這集節目」/
  // 「財經 Podcast KOL」字眼、讓 LLM 知道內容來自 podcast 而非 YouTube 直播。
  sourceKindLabel: 'Podcast',
  episodeWord: '節目',
  digestTitlePrefix: 'Podcast Analyst Digest',
}
