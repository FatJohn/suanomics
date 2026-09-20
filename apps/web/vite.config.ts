import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_API = 'http://localhost:3000'

export default defineConfig(({ mode }) => {
  // dev proxy 預設打本機 server（見 apps/server/.env.example 的 PORT）。要改打別的環境，
  // 在 apps/web/.env 設 API_PROXY_TARGET，不要改這個檔——改了很容易忘記還原。
  const target = loadEnv(mode, process.cwd(), '').API_PROXY_TARGET || DEFAULT_API
  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // /audio 也要代理：podcast 音檔由 api 服務（R2 302），只代理 /api 的話本機聽不到聲音
      proxy: Object.fromEntries(['/api', '/audio'].map(path => [path, {
        target,
        changeOrigin: true,
        secure: target.startsWith('https://'),
      }])),
    },
  }
})
