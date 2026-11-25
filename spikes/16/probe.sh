#!/usr/bin/env bash
# Issue #16 spike: can a GitHub Actions runner reach the v1 data sources?
# Each URL is requested exactly once per run, >=1 s apart, no secrets / API keys.
# Output: Markdown table on stdout and appended to $GITHUB_STEP_SUMMARY (if set).
# Usage: bash spikes/16/probe.sh   (works locally too, as the control group)
set -u

UA="Mozilla/5.0 (compatible; suanomics-probe/0.1)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# name|kind|url   kind: rss = expect <item>; json = expect parseable JSON;
# json-nokey = endpoint needs a key we deliberately do not send; expect 4xx + the service's own error JSON.
SOURCES=(
  "TWSE MI_INDEX|json|https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX"
  "TPEx 上櫃日收盤|json|https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
  "FRED observations (no key)|json-nokey|https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&file_type=json"
  "EIA v2 (no key)|json-nokey|https://api.eia.gov/v2/petroleum/pri/spt/data/"
  "央行 新聞稿|rss|https://www.cbc.gov.tw/tw/rss-302-1.xml"
  "金管會 新聞稿|rss|https://www.fsc.gov.tw/RSS/Messages?serno=201202290009&language=chinese"
  "行政院 本院新聞|rss|https://www.ey.gov.tw/RSS_Content.aspx?ModuleType=3"
  "cnyes 頭條|rss|https://news.cnyes.com/rss/v1/news/category/headline"
  "udn 經濟日報 要聞|rss|https://money.udn.com/rssfeed/news/1001/10846?ch=money"
  "Yahoo 股市 新聞|rss|https://tw.stock.yahoo.com/rss?category=news"
  "中央社 財經|rss|https://feeds.feedburner.com/rsscna/finance"
  "BBC Business|rss|https://feeds.bbci.co.uk/news/business/rss.xml"
  "Al Jazeera All|rss|https://www.aljazeera.com/xml/rss/all.xml"
  "NHK World Radio English (podcast RSS)|rss|https://www3.nhk.or.jp/rj/podcast/rss/english.xml"
  "NHK World news all.json|json|https://www3.nhk.or.jp/nhkworld/data/en/news/all.json"
  "TechNews 科技新報|rss|https://technews.tw/feed/"
)

check_body() { # kind file -> one-line verdict
  local kind="$1" f="$2"
  case "$kind" in
    rss)
      local n
      n=$(grep -o '<item[ >]' "$f" | wc -l | tr -d ' ')
      if [ "$n" -gt 0 ]; then echo "yes: <item>×$n"; else echo "no: 0 <item>"; fi
      ;;
    json|json-nokey)
      python3 -I - "$f" "$kind" <<'PY'
import json, sys
f, kind = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(f, encoding="utf-8-sig"))
except Exception as e:
    print(f"no: JSON parse failed ({type(e).__name__})"); sys.exit()
if kind == "json-nokey":
    if isinstance(d, dict) and ("error_code" in d or "error" in d):
        err = d.get("error_code") or (d.get("error") or {}).get("code")
        print(f"reachable: service error JSON ({err})")
    else:
        print("yes: JSON (unexpected: no error field)")
elif isinstance(d, list):
    print(f"yes: JSON list len {len(d)}")
elif isinstance(d, dict):
    print(f"yes: JSON object keys {len(d)}")
else:
    print("yes: JSON scalar")
PY
      ;;
  esac
}

{
  echo "## spike-16 probe"
  echo
  echo "- date (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "- host: GitHub Actions runner (${RUNNER_OS:-} ${ImageOS:-} ${ImageVersion:-}), run ${GITHUB_SERVER_URL:-}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
  else
    echo "- host: local"
  fi
  echo "- commit: ${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
  echo
  echo "| # | source | HTTP | curl exit | time s | bytes | expected content | url |"
  echo "|---|---|---|---|---|---|---|---|"
} > "$TMP/table.md"

: > "$TMP/heads.log"
i=0
for entry in "${SOURCES[@]}"; do
  i=$((i + 1))
  IFS='|' read -r name kind url <<< "$entry"
  body="$TMP/body"
  meta=$(curl -sS -L --max-redirs 5 --connect-timeout 15 -m 40 -A "$UA" \
    -o "$body" -w '%{http_code} %{time_total} %{size_download}' "$url" 2>"$TMP/err")
  rc=$?
  read -r code t size <<< "$meta"
  if [ "$rc" -ne 0 ] && [ ! -s "$body" ]; then
    verdict="no: curl failed ($(head -c 120 "$TMP/err" | LC_ALL=C tr '\n|' '  '))"
  else
    verdict=$(check_body "$kind" "$body")
  fi
  echo "| $i | $name | ${code:-000} | $rc | ${t:-} | ${size:-0} | $verdict | $url |" >> "$TMP/table.md"
  {
    echo "--- [$i] $name  HTTP ${code:-000}  curl=$rc"
    head -c 200 "$body" 2>/dev/null | LC_ALL=C tr '\n\r' '  '
    echo
  } >> "$TMP/heads.log"
  rm -f "$body"
  sleep 2
done

cat "$TMP/table.md"
echo
echo "### first 200 bytes per response"
cat "$TMP/heads.log"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat "$TMP/table.md" >> "$GITHUB_STEP_SUMMARY"
fi
