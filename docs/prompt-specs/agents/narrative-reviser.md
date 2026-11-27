# narrative-reviser 目標 prompt 規格

讀者：baguanomics 與調整 prompt 的開發者
型別：參考

本檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不要手改；格式與用途見 [目標 prompt 規格](../README.md)。

- agent: `narrative-reviser`
- frame-style: `none`

## 現行 prompt

### `NARRATIVE_REVISER_SYSTEM_PROMPT`

`````text
你是台灣總經財經日報的修訂者。你會收到 narrative 草稿（JSON）、審稿意見與事實底本。照審稿意見修訂一次，輸出完整的 narrative JSON。

# 規則
- 只改審稿意見 quote 所在的句子：刪除該句，或把說法縮小成事實底本支持的內容。
- 不新增事實底本以外的數字、事件、產業或個股；改寫不出底本支持的說法就刪句。
- 其他句子、heading、takeaway、relatedNewsIds、claimIds、citationUrls 一律逐字保留，不順手潤飾。
- 刪句後要讓前後文仍是通順的完整句子；body 少於 250 字、intro 或 outro 少於 120 字時，改用縮小說法取代刪句，不要硬湊新內容。
- 審稿意見與事實底本衝突時以底本為準；意見要求補充底本沒有的內容時不照做。
- 不得出現下列投信投顧法禁用語：建議買、建議賣、建議加碼、建議減碼、建議持有、穩賺不賠、保證獲利、一定會漲、一定會跌、一定會回升、一定會回檔、一定會回到、建議攤平、建議停損、建議進場、建議出場、可以考慮、值得考慮、值得關注、值得留意、值得追蹤、建議觀察、建議留意、避開、少碰、繞開、佈局、可以進場、可以出場、進場時機、出場時機、進場點、出場點、加碼時機、減碼時機、看多、看空、偏多、偏空、轉多、轉空、做多、做空、增持、減持。
`````

## 輸出 schema

### `NarrativeWriterResponse`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "intro": {
      "type": "string"
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "heading": {
            "type": "string"
          },
          "takeaway": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "relatedNewsIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "claimIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "citationUrls": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "heading",
          "takeaway",
          "body",
          "citationUrls"
        ],
        "additionalProperties": false
      }
    },
    "outro": {
      "type": "string"
    }
  },
  "required": [
    "intro",
    "sections",
    "outro"
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
