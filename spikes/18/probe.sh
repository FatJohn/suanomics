#!/usr/bin/env bash
# Issue #18 spike：RSSHub 公開 instance vs 在 Actions job 內自架。
# 每個 URL 最多打 N 次、請求間隔 >= 1 秒、UA 用通用 client 名稱、不帶任何 secrets。
# 結果印到 log，並寫進 $GITHUB_STEP_SUMMARY（本機跑時寫到 /dev/null）。
set -uo pipefail

UA='Mozilla/5.0 (compatible; feed-probe/1.0)'
# diygod/rsshub:latest 在 2026-11-07 的 multi-arch index digest（Docker Hub last_updated 2026-11-07T05:28:26Z）
IMAGE='diygod/rsshub@sha256:3e1607718bc059815e95110f45636c87305befa9863b61f66246d098eb6cf762'
PUBLIC_BASE='https://rsshub.app'
LOCAL_BASE='http://localhost:1200'
# RSSHub 官方 route（lib/routes/udn/breaking-news.tsx）：6＝財經、11＝股市。
# cnyes（鉅亨網）與 ctee（工商時報）在 RSSHub 沒有 route，無從量測。
ROUTES=(/udn/news/breakingnews/6 /udn/news/breakingnews/11)
N=5
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
WORK="$(mktemp -d)"

now() { date +%s.%N; }
secs() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", b - a }'; }

# probe <label> <base>：每個 route 打 N 次，輸出 RESULT 行並在 summary 寫表格。
probe() {
  local label="$1" base="$2"
  echo "| path | route | #fail/$N | median ms | max ms | statuses | items | retry-after |" >>"$SUMMARY"
  echo "|---|---|---|---|---|---|---|---|" >>"$SUMMARY"
  for route in "${ROUTES[@]}"; do
    local lat=() statuses=() items=() fails=0 ra=''
    for i in $(seq 1 "$N"); do
      local body="$WORK/body" hdr="$WORK/hdr" out code t ms n r
      out=$(curl -s -o "$body" -D "$hdr" -A "$UA" --max-time 90 -w '%{http_code} %{time_total}' "$base$route") || true
      code="${out%% *}"; t="${out##* }"
      ms=$(awk -v t="$t" 'BEGIN { printf "%d", t * 1000 }')
      n=$(grep -o '<item>' "$body" 2>/dev/null | wc -l | tr -d ' ')
      r=$(grep -i '^retry-after:' "$hdr" 2>/dev/null | tr -d '\r' | awk '{print $2}')
      echo "RESULT $label $route try=$i status=$code ms=$ms items=$n retry_after=${r:--}"
      if [[ "$code" != 200 || "$n" == 0 ]]; then
        fails=$((fails + 1))
        echo "  body head: $(head -c 200 "$body" | tr '\n' ' ')"
      fi
      lat+=("$ms"); statuses+=("$code"); items+=("$n"); [[ -n "$r" ]] && ra="$ra$r,"
      sleep 1.2
    done
    local sorted median max
    sorted=$(printf '%s\n' "${lat[@]}" | sort -n)
    median=$(echo "$sorted" | sed -n "$(((N + 1) / 2))p")
    max=$(echo "$sorted" | tail -1)
    echo "STAT $label $route fail=$fails/$N median_ms=$median max_ms=$max statuses=${statuses[*]} items=${items[*]}"
    echo "| $label | \`$route\` | $fails/$N | $median | $max | ${statuses[*]} | ${items[*]} | ${ra:--} |" >>"$SUMMARY"
  done
}

echo "## Spike #18 RSSHub probe（$(date -u +%FT%TZ)，commit ${GITHUB_SHA:-local}）" >>"$SUMMARY"
echo "runner: $(uname -srm), $(nproc) vCPU, $(free -m 2>/dev/null | awk '/Mem:/ {print $2 " MiB RAM"}')"

# ── (1) 公開 instance ──
echo "### (1) 公開 instance $PUBLIC_BASE" >>"$SUMMARY"
p0=$(now)
probe public "$PUBLIC_BASE"
p1=$(now)
public_secs=$(secs "$p0" "$p1")
echo "TIMING public probe_total_s=$public_secs"
echo "" >>"$SUMMARY"
echo "公開 instance 整段探測：**${public_secs}s**" >>"$SUMMARY"

# ── (2) 自架 ──
echo "### (2) 自架 $IMAGE" >>"$SUMMARY"
s0=$(now)
docker pull -q "$IMAGE"
s1=$(now)
cid=$(docker run -d --name rsshub -p 1200:1200 -e NODE_ENV=production "$IMAGE")
ready=no
for _ in $(seq 1 360); do
  if curl -sf -o /dev/null --max-time 2 "$LOCAL_BASE/healthz"; then ready=yes; break; fi
  sleep 0.5
done
s2=$(now)
pull_secs=$(secs "$s0" "$s1"); start_secs=$(secs "$s1" "$s2"); total_secs=$(secs "$s0" "$s2")
echo "TIMING selfhost pull_s=$pull_secs start_to_ready_s=$start_secs pull_to_ready_s=$total_secs ready=$ready"

# 記憶體：背景每秒取 docker stats；結尾再讀 cgroup v2 的 memory.peak。
(while true; do docker stats --no-stream --format '{{.MemUsage}}' rsshub 2>/dev/null; sleep 1; done) >"$WORK/mem.log" &
mem_pid=$!

if [[ "$ready" == yes ]]; then
  probe selfhost "$LOCAL_BASE"
else
  echo "RSSHub 未在 180s 內 ready" | tee -a "$SUMMARY"
  docker logs --tail 50 rsshub
fi

kill "$mem_pid" 2>/dev/null
peak_file="/sys/fs/cgroup/system.slice/docker-${cid}.scope/memory.peak"
cg_peak=$( (cat "$peak_file" 2>/dev/null || docker exec rsshub cat /sys/fs/cgroup/memory.peak 2>/dev/null) | awk '{ printf "%.1f", $1 / 1048576 }')
stats_peak=$(awk '{ v = $1; u = v; gsub(/[0-9.]/, "", u); gsub(/[A-Za-z]/, "", v); v += 0; m = (u == "GiB") ? v * 1024 : (u == "KiB" ? v / 1024 : v); if (m > max) max = m } END { printf "%.1f", max }' "$WORK/mem.log")
echo "MEMORY selfhost cgroup_peak_mib=${cg_peak:-unknown} docker_stats_peak_mib=$stats_peak samples=$(wc -l <"$WORK/mem.log" | tr -d ' ')"
docker logs --tail 20 rsshub 2>&1 | sed 's/^/  rsshub log: /'

{
  echo ""
  echo "自架：pull **${pull_secs}s**＋啟動到 ready **${start_secs}s**＝**${total_secs}s**（ready=$ready）"
  echo ""
  echo "container 記憶體峰值：cgroup memory.peak **${cg_peak:-unknown} MiB**；docker stats 取樣最大 **${stats_peak} MiB**"
} >>"$SUMMARY"

docker rm -f rsshub >/dev/null
