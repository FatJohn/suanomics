<!--
感謝你花時間貢獻。送出前請先看過 repo 根目錄的 CONTRIBUTING.md，尤其是「PR 流程」、
「測試」與「Commit 紀律：Tidy First（Kent Beck）」這幾節。
-->

## 摘要

<!-- 這個 PR 做了什麼、為什麼需要它 -->

## 關聯 issue

Closes #

## Commit 分類

這個 PR 裡的每個 commit 屬於 STRUCTURAL 還是 BEHAVIORAL？兩者不要混在同一個 commit——分類判準與範例見 repo 根目錄 `CONTRIBUTING.md` 的「Commit 紀律：Tidy First（Kent Beck）」一節。

- [ ] 每個 commit message 都已經標上 `[STRUCTURAL]` 或 `[BEHAVIORAL]`
- [ ] 沒有任何一個 commit 同時混了整理與行為改動

## 驗證

這個 PR 做過哪些驗證？本機測試的已知紅燈（例如沒有 Postgres 時哪些檔案預期會紅）見 repo 根目錄 `CONTRIBUTING.md` 的「測試」一節。

<!-- 描述做過的驗證，不用列指令本身 -->

## LLM API 呼叫

這個 PR 的改動會不會實際呼叫 LLM API？如果會，大約影響多少次呼叫、有沒有評估過批次操作的規模——判斷方式見 repo 根目錄 `README.md` 的「成本」一節。

- [ ] 不會實際呼叫 LLM API（例如只動測試裡的 mock、純邏輯、文件）
- [ ] 會呼叫，已依上面提到的判斷方式評估過規模
