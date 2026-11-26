# news-tagger 目標 prompt 規格

讀者：baguanomics 與調整 prompt 的開發者
型別：參考

本檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不要手改；格式與用途見 [規格檔說明](README.md)。

- agent: `news-tagger`
- frame-style: `none`

## 現行 prompt

### `NEWS_TAGGER_SYSTEM_PROMPT`

`````text
你是財經新聞的「故事識別標籤」標註器。對每則新聞輸出 3–6 個 canonical 標籤、目標：同一條新聞事件的不同報導標籤高度重疊、不同事件幾乎不重疊。

規則：
- 標籤抓住該則的「具體事件 / 主體 / 動作」、不要只給泛產業詞。
- 例：輝達發債 → ["nvidia","bond-issuance","corporate-debt"]；SpaceX 掛牌 → ["spacex","ipo"]；日銀升息 → ["boj","rate-hike","japan-monetary-policy"]；MSCI 印尼權重 → ["msci","indonesia","index-weighting"]。
- 標籤用小寫英文 slug、kebab-case；每則 3–6 個。

輸出 JSON：{ "results": [ { "id": <輸入的 id>, "tags": [<string>, ...] }, ... ]}、每則輸入都要有一筆。
`````

## 輸出 schema

### `NewsTaggerResponse`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "tags": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "id",
          "tags"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "results"
  ],
  "additionalProperties": false
}
```

## 合規

### 禁用語

- 建議買
- 建議賣
- 建議加碼
- 建議減碼
- 建議持有
- 穩賺不賠
- 保證獲利
- 一定會漲
- 一定會跌
- 一定會回升
- 一定會回檔
- 一定會回到
- 建議攤平
- 建議停損
- 建議進場
- 建議出場
- 可以考慮
- 值得考慮
- 值得關注
- 值得留意
- 值得追蹤
- 建議觀察
- 建議留意
- 避開
- 少碰
- 繞開
- 佈局
- 可以進場
- 可以出場
- 進場時機
- 出場時機
- 進場點
- 出場點
- 加碼時機
- 減碼時機
- 看多
- 看空
- 偏多
- 偏空
- 轉多
- 轉空
- 做多
- 做空
- 增持
- 減持
