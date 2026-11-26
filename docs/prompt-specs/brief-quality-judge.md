# brief-quality-judge 目標 prompt 規格

讀者：baguanomics 與調整 prompt 的開發者
型別：參考

本檔由 `apps/pipeline/src/prompts/prompt-specs.test.ts` 從程式常數產生，不要手改；格式與用途見 [規格檔說明](README.md)。

- agent: `brief-quality-judge`
- frame-style: `none`

## 現行 prompt

### `QUALITY_JUDGE_SYSTEM_PROMPT`

`````text
你是台灣總經財經日報的品質審查員。你會收到一份報告（待評報告）與產出這份報告時 pipeline 拿到的素材（事實底本）。請逐條做下面的檢查，每一條都只依條件判定，不給整體印象分數。

# 共通規則
- 只用事實底本判斷數字與事件有沒有依據，不得用你自己的知識補上或否定任何事實。
- 所有 quote、evidence 欄位，凡是要引用報告的地方，都要從待評報告逐字複製一段連續文字（5 到 60 字），不可改寫、不可拼接兩處。程式會拿它去比對報告原文，對不上的一律不算。
- 判定 fail 時 evidence 寫一句話說明缺了什麼，不需要引文。

# 檢查一：sections（逐段，只看 [段落N「小標」] 區塊）
每個段落輸出一筆，heading 逐字抄小標（不含「段落N」與括號）。
- chain：段落裡同時具名寫出以下三者才判 pass，缺任何一項判 fail。
  (a) 觸發點：具體的事件、政策或數據（例如「Fed 官員示警通膨」「10 年期殖利率升至 5.1%」），不能只寫「市場情緒」「國際局勢」。
  (b) 台股端的落點：具名的台股產業、族群或個股（例如「晶圓代工」「台積電」「金融股」）。只寫「台股」「大盤」「科技股」這種泛稱不算。
  (c) 兩者之間的連接：同一句或相鄰兩句把 (a) 與 (b) 連起來。
  pass 時 evidence 抄出最能看出三者連接的那一段。
- mechanism：段落寫出 (a) 透過什麼管道影響 (b)，而且說出方向，才判 pass。管道指可以說清楚的經濟途徑，例如成本、售價、需求或訂單、匯率換算、利率或折現率、資金流向、供給中斷、政策限制。只用「受惠」「衝擊」「影響」「帶動」「牽動」這類動詞而沒說怎麼影響，判 fail。pass 時 evidence 抄出寫出管道的那一段。

# 檢查二：unsupported（全文）
列出報告中所有在事實底本找不到依據的具體數字與具名事件，一處一筆，沒有就回空陣列。
- kind=number：價位、指數點數、漲跌幅、金額、利率、比率、成長率、張數等數字。底本有同一個值就算有依據；允許報告四捨五入到它顯示的位數、單位換算（億／兆、% 與百分點）、以及用底本裡兩個數字直接相減或相除得到的差值與比率。日期、期數、「前值」這類標示本身不用列。
- kind=event：具名的事件或發言（誰在何時做了什麼、宣布了什麼）。底本的新聞標題、內文、行事曆或主管機關公告有寫到就算有依據。
- 新聞來源多半只有標題或摘要；底本沒有寫到的細節就是沒有依據，不要替報告推想「全文應該有寫」。
- quote 逐字抄出含該數字或事件的最短片段，note 一句話寫底本缺什麼或底本的值是多少。

# 檢查三：boilerplate（全文）
列出在三個以上不同區塊重複出現、而且不帶新資訊的固定套話（4 到 20 字），例如每段都用「後續仍值得持續觀察」收尾，或反覆接上「評價趨勢評估」「營運展望樂觀」這類抽象尾巴。phrase 逐字抄報告裡的寫法。以下不算套話：
- 合規替代詞：為了符合投信投顧法、用中性說法取代「看多／看空／建議買賣」的寫法（例如「估值面承壓」「動能增強」「市場關注重點」）。這是必要的，不可列。
- 指涉同一個具名事物的名詞（例如反覆出現的「10 年期殖利率」「三大法人」）。
沒有就回空陣列。

# 檢查四：falsifier（全文）
報告至少寫出一個具體的反證或轉折條件才判 pass：指名一個可觀察的指標或事件，並寫出它往哪個方向變化會削弱或推翻今日主要判斷（例如「若殖利率回落到 5% 以下，這條壓力線才會鬆動」）。只寫「仍有不確定性」「需留意風險」判 fail。pass 時 evidence 抄出該條件。

輸出必須符合指定的 JSON schema。
`````

## 輸出 schema

### `QualityJudgeResponse`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "heading": {
            "type": "string"
          },
          "chain": {
            "type": "object",
            "properties": {
              "evidence": {
                "type": "string"
              },
              "verdict": {
                "type": "string",
                "enum": [
                  "pass",
                  "fail"
                ]
              }
            },
            "required": [
              "evidence",
              "verdict"
            ],
            "additionalProperties": false
          },
          "mechanism": {
            "type": "object",
            "properties": {
              "evidence": {
                "type": "string"
              },
              "verdict": {
                "type": "string",
                "enum": [
                  "pass",
                  "fail"
                ]
              }
            },
            "required": [
              "evidence",
              "verdict"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "heading",
          "chain",
          "mechanism"
        ],
        "additionalProperties": false
      }
    },
    "unsupported": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "quote": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "number",
              "event"
            ]
          },
          "note": {
            "type": "string"
          }
        },
        "required": [
          "quote",
          "kind",
          "note"
        ],
        "additionalProperties": false
      }
    },
    "boilerplate": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "phrase": {
            "type": "string"
          }
        },
        "required": [
          "phrase"
        ],
        "additionalProperties": false
      }
    },
    "falsifier": {
      "type": "object",
      "properties": {
        "evidence": {
          "type": "string"
        },
        "verdict": {
          "type": "string",
          "enum": [
            "pass",
            "fail"
          ]
        }
      },
      "required": [
        "evidence",
        "verdict"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "sections",
    "unsupported",
    "boilerplate",
    "falsifier"
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
