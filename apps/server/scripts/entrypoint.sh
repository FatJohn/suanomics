#!/bin/sh
set -e
echo "[entrypoint] running db:migrate"
pnpm --filter @suanomics/db run db:migrate
echo "[entrypoint] starting server"
# exec 進 node 而不是 pnpm：node 必須是 PID 1 才收得到容器的 SIGTERM。
# 隔一層 pnpm 的話 index.ts 的 gracefulShutdown 不會跑，in-flight job 會被硬砍、
# 留下 queued/active 的孤兒 row 等下次開機回收。合併前的 worker entrypoint 就是這樣做的。
cd /src/apps/server
exec node --env-file-if-exists=.env dist/index.js
