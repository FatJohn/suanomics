# podcast-writer 目標 prompt 規格

讀者：baguanomics 與調整 prompt 的開發者
型別：參考

本檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不要手改；格式與用途見 [規格檔說明](README.md)。

- agent: `podcast-writer`
- frame-style: `none`

## 現行 prompt

podcast-writer 的 system prompt 尚未移植進 apps/pipeline，本段沒有 prompt。

## 輸出 schema

### `PodcastWriterResponse`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "briefDate": {
      "type": "string"
    },
    "hook": {
      "type": "object",
      "properties": {
        "headline": {
          "type": "string"
        },
        "body": {
          "type": "string"
        }
      },
      "required": [
        "headline",
        "body"
      ],
      "additionalProperties": false
    },
    "acts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "actTitle": {
            "type": "string"
          },
          "storyline": {
            "type": "string"
          },
          "body": {
            "type": "string"
          },
          "citationUrls": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "relatedNewsIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "actTitle",
          "storyline",
          "body",
          "citationUrls",
          "relatedNewsIds"
        ],
        "additionalProperties": false
      }
    },
    "takeaway": {
      "type": "object",
      "properties": {
        "body": {
          "type": "string"
        }
      },
      "required": [
        "body"
      ],
      "additionalProperties": false
    },
    "meta": {
      "type": "object",
      "properties": {
        "totalChars": {
          "type": "number"
        },
        "persona": {
          "type": "string"
        },
        "generatedAt": {
          "type": "string"
        }
      },
      "required": [
        "totalChars",
        "persona",
        "generatedAt"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "briefDate",
    "hook",
    "acts",
    "takeaway",
    "meta"
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

### 抽象評價贅詞

- 評價趨勢評估
- 配置調整建議
- 營運展望樂觀
- 資本配置效率
- 回收期分析
- 營運效率指標趨於穩健
- 單位經濟模型優化
- 經常性營收成長動能
- 客戶流失率波動
