# Shared Finance Knowledge

## 狀態

這是一份目標架構草案、不是已完成的 feature、也不是已排進 roadmap 的項目。

## 目標

Cascade 已經在做財經 context 的蒐集、enrichment、analysis、與 citation。下一個架構機會是把這些工作抽成可重用的 knowledge layer、為將來新增 feature（例如 transcript 工具的延伸、或第三方 ingest）提供共用基礎。

## 候選 Knowledge Objects

- Source：來源 metadata、trust level、抓取方式、與 domain。
- Article：title、URL、published time、抽取出的文字、entities、summary。
- Claim：normalized 過的陳述、可被驗證或對應到 evidence。
- Citation：URL、title、source type、引用或 evidence span、retrieval 時間戳記。
- Entity Alias：規範化的 entity 名稱、加上跨語言與市場術語的 aliases。
- Market Context：適合用來解釋的描述性事件背景、不適合作為個人化建議。

## Trust Model

- 官方與 regulator 來源可以成為 authority 候選。
- 財經媒體可以提供 context、但不該自動成為 authority。
- 分析師 / KOL 素材可以提供框架、但不該被當作 authoritative truth。
- 產出的 analyses 是衍生素材、必須能指回 citations。

## 開放問題

- Authority levels 該怎麼在 shared schemas 中表達？
- Claims 該明確存下來、還是要時才產生？
- Retention window 設多長才夠用、又不會把專案變成完整研究 DB？
- 當 source articles 改變或消失時、產出的 analyses 該怎麼 invalidate？
