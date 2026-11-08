-- Data migration（不動 schema）：把 applyEditorResult 早期的 append-only 寫入留下的
-- 亂序 updates 與倒退的 last_touched_brief_date 正規化一次。
--
-- 由來：舊版 applyEditorResult 無條件把 last_touched_brief_date 覆寫成 payload 的
-- briefDate、且 append updates 不排序。2026-09-05 在本機補跑 09-01/09-02 的報告時，
-- 四條線因此變成陣列序 [.., 09-04, 09-03, 09-02, 09-01]、欄位停在 09-01。
-- 寫入側已於同一個 PR 修好（laterBriefDate + upsertSameDay 排序），這支只清既有列。
--
-- 空 DB（CI、新環境）跑到這裡影響 0 列。

-- 1. updates 依 briefDate 排序（ISO date 字典序＝時間序）。只改真的亂序的列。
UPDATE storylines
SET updates = sorted.arr
FROM (
  SELECT s.id, jsonb_agg(e ORDER BY e->>'briefDate') AS arr
  FROM storylines s, LATERAL jsonb_array_elements(s.updates) e
  WHERE jsonb_typeof(s.updates) = 'array' AND jsonb_array_length(s.updates) > 1
  GROUP BY s.id
) sorted
WHERE storylines.id = sorted.id AND storylines.updates IS DISTINCT FROM sorted.arr;
--> statement-breakpoint

-- 2. 回填被倒退的 last_touched_brief_date：只往上修到 updates 的最大 briefDate。
--    只取形如 YYYY-MM-DD 的值，髒 element 不參與（也不會讓整支 migration 炸掉）。
UPDATE storylines
SET last_touched_brief_date = m.max_date::date
FROM (
  SELECT s.id, max(e->>'briefDate') FILTER (WHERE e->>'briefDate' ~ '^\d{4}-\d{2}-\d{2}$') AS max_date
  FROM storylines s, LATERAL jsonb_array_elements(s.updates) e
  WHERE jsonb_typeof(s.updates) = 'array'
  GROUP BY s.id
) m
WHERE storylines.id = m.id
  AND m.max_date IS NOT NULL
  AND (storylines.last_touched_brief_date IS NULL OR storylines.last_touched_brief_date < m.max_date::date);
