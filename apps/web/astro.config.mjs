import { defineConfig } from 'astro/config'

// 靜態產生（ADR 0005）：build 時產出純 HTML，沒有執行期 server。
export default defineConfig({
  output: 'static',
})
