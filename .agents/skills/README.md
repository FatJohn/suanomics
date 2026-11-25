# Agent skills

讀者：在本 repo 工作的 AI coding agent 與維護者
型別：參考

本目錄的 skill 只在本 repo 生效：Codex 直接讀 `.agents/skills/`，Claude Code 透過 `.claude/skills/` 的 symlink 讀同一份。

| Skill | 來源 | 授權 |
|---|---|---|
| `neon`、`neon-postgres` | [neondatabase/agent-skills](https://github.com/neondatabase/agent-skills) commit `2b0e2b6f56d2b41c5363049e30e6ab72aa260cce`，未修改 | Apache-2.0，全文見 [NEON-LICENSE](NEON-LICENSE) |

只收 Postgres 相關的兩支；v1 不用 Neon 的 Auth、Functions、Object Storage、Realtime、AI Gateway。更新時從同一個上游 repo 覆蓋並改上表的 commit。
