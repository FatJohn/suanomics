<script setup lang="ts">
import type { BriefSource } from '@/lib/brief-sources.js'
import { isExternalUrl } from '@/lib/url.js'

/**
 * 佐證層的來源清單。
 *
 * 為什麼是一份清單而不是三個區塊：2026-08-02 量過真實報告，引用來源（20）／相關新聞（5）／
 * 本日精選新聞（7）三塊共 32 個條目，去重之後只有 20 個東西——後兩塊沒有帶進任何新來源，
 * 只是把同一則新聞換一組欄位再列一次。所以這裡合成一筆一則，三種身分變成同一筆上的三個
 * 欄位（引述、關係、時間）。
 *
 * 不做成卡片：卡片會把每一則讀成獨立物件，而讀者在這一層做的事是掃過一整排來源找他要查的
 * 那則。用 hairline 與間距分隔就夠。
 */
const props = defineProps<{ sources: BriefSource[] }>()

const RELATION_LABEL = {
  cause: '起因',
  effect: '影響',
  context: '背景',
  contrast: '對比',
} as const

function newsTime(iso: string | undefined): string {
  if (!iso)
    return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section v-if="props.sources.length > 0" class="sources" aria-label="來源">
    <header class="sources-head">
      <h2>報告用到的來源</h2>
      <span class="sources-count">{{ props.sources.length }}</span>
    </header>

    <ol class="source-list">
      <li v-for="s in props.sources" :key="s.url" class="source">
        <p class="source-meta">
          <span class="source-domain">{{ s.domain }}</span>
          <span v-if="newsTime(s.publishedAt)" class="source-time">{{ newsTime(s.publishedAt) }}</span>
          <span v-if="s.relation" class="source-relation">
            {{ RELATION_LABEL[s.relation.type] }}
          </span>
        </p>

        <!-- url 經 backend 保證為真 source url；只有 data:insufficient sentinel 不可點 -->
        <component
          :is="isExternalUrl(s.url) ? 'a' : 'span'"
          class="source-title"
          v-bind="isExternalUrl(s.url) ? { href: s.url, target: '_blank', rel: 'noopener noreferrer' } : {}"
        >
          {{ s.title }}
        </component>

        <p v-if="s.quote" class="source-quote">
          {{ s.quote }}
        </p>
        <p v-if="s.relation" class="source-reason">
          {{ s.relation.reasoning }}
        </p>
        <!-- 站內單則頁有這則自己的連動分析，是原始連結給不了的 -->
        <RouterLink v-if="s.newsId" :to="`/brief/news/${s.newsId}`" class="source-more">
          看這則的連動分析
        </RouterLink>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.sources-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.sources-head h2 {
  margin: 0;
  font-size: var(--size-body);
  font-weight: 700;
  color: var(--fg-1);
}
.sources-count {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}
.source-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.source {
  padding: 18px 0;
  border-bottom: 1px solid var(--border-2);
}
.source-meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 6px;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
/* 四種關係一律同一個中性強調，不按類型上色：起因／影響／背景／對比講的是這則新聞在推論裡
   的位置，不是漲跌方向，借漲跌色會讓「起因」看起來像利空 */
.source-relation {
  font-family: var(--font-sans);
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--fg-2);
}
.source-title {
  display: block;
  font-size: var(--size-body);
  font-weight: 600;
  line-height: 1.6;
  color: var(--fg-1);
  text-decoration: none;
}
a.source-title:hover {
  color: var(--warm);
}
/* 引述靠一條細線與縮排標示，不做成灰底區塊——底色會把它讀成另一種卡片 */
.source-quote {
  margin: 8px 0 0;
  padding-left: 12px;
  border-left: 1px solid var(--border);
  font-size: var(--size-small);
  line-height: 1.75;
  color: var(--fg-3);
}
.source-reason {
  margin: 8px 0 0;
  font-size: var(--size-small);
  line-height: 1.75;
  color: var(--fg-2);
}
.source-more {
  display: inline-block;
  margin-top: 8px;
  font-size: var(--size-small);
  font-weight: 600;
  color: var(--warm);
  text-decoration: none;
}
.source-more:hover {
  text-decoration: underline;
}

@media (max-width: 719px) {
  .source {
    padding: 16px 0;
  }
  .source-title {
    font-size: var(--size-body);
  }
}
</style>
