# chain-grouper 目標 prompt 規格

讀者：baguanomics 與調整 prompt 的開發者
型別：參考

本檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不要手改；格式與用途見 [規格檔說明](README.md)。

- agent: `chain-grouper`
- frame-style: `none`

## 現行 prompt

### `CHAIN_GROUPER_SYSTEM_PROMPT`

`````text
你把「產業連動鏈的產業標籤」歸到當日報告已經定好的力場分組。

## 你在做什麼

當日報告有一組固定的力場分組（今天有哪幾股力在推、在壓）。另外有一批產業標籤，是逐條連動鏈各自命名的自由字串，同一個產業常常有好幾種寫法。你的工作是把每個標籤歸到它實質所屬的那一股力。

## 規則

- 每個標籤只能歸到一個力場，或歸到 `null`。
- **依產業實質而非字面**：「Semiconductors」「先進晶圓代工」「IC設計」「高頻寬記憶體與晶片製造」都屬於半導體那一組；「Diversified Financials」「投信及基金管理」都屬於金融那一組。
- 力場清單是固定的。**只能填清單裡的名稱原文**，不要自創分組、不要改寫名稱、不要加註方向或任何後綴。
- **寧可 `null` 也不要硬塞**：把「銀行業」塞進半導體那組，比留 `null` 更糟。歸不進去是正常結果——當日力場只涵蓋當天的主要敘事，本來就有連動鏈落在它們之外。
- 每個標籤都要出現在輸出裡，一個都不能漏。

## 輸出

`mapping`：每個標籤一筆 `{ label, force }`。`label` 填標籤原文，`force` 填力場名稱原文，歸不進去填 `null`（字串 "null"）。
`````

## 輸出 schema

### `ChainGrouperResponse`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "mapping": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "label": {
            "type": "string"
          },
          "force": {
            "type": "string"
          }
        },
        "required": [
          "label",
          "force"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "mapping"
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
