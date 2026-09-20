<script setup lang="ts">
import { useRouter } from 'vue-router'
import { hasInternalHistory, shouldInterceptClick } from '@/lib/back-link.js'

/**
 * 「回到我剛才在的地方」。
 *
 * 站內的返回連結原本各自寫死成 `to="/"`，所以從 09-01 的佐證層點進某則新聞再返回，會落到
 * 最新一天的報告層——日期與層別一起掉。這個元件把「返回該回哪裡」收成一處。
 *
 * 仍然是 `<a>` 而不是 `<button>`：`href` 留著 fallback 目的地，中鍵與 cmd／ctrl 點擊照樣
 * 能開新分頁（那條路徑走 `href`，落在 `/`——新分頁本來就沒有上一頁）。左鍵才攔截成 back。
 */
const props = withDefaults(defineProps<{ fallback?: string }>(), { fallback: '/' })
const router = useRouter()

function onClick(e: MouseEvent): void {
  if (!shouldInterceptClick(e))
    return
  e.preventDefault()
  if (hasInternalHistory(window.history.state))
    router.back()
  else
    void router.push(props.fallback)
}
</script>

<template>
  <a :href="props.fallback" class="link-back" @click="onClick">
    <slot />
  </a>
</template>
