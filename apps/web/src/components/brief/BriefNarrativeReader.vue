<script setup lang="ts">
import type { CascadeChain, MarketBriefCitation, Narrative } from '@suanomics/shared'
import MarkdownIt from 'markdown-it'
import { computed } from 'vue'
import { chainsForSection, sectionForce } from '@/lib/narrative-depth.js'
import { sectionDomId, sectionLabel } from '@/lib/narrative-nav.js'
import { isExternalUrl } from '@/lib/url.js'
import BriefSectionDepth from './BriefSectionDepth.vue'

const props = withDefaults(defineProps<{
  narrative: Narrative
  citations: MarketBriefCitation[]
  chains?: CascadeChain[]
}>(), { chains: () => [] })

const md = new MarkdownIt({ html: false, breaks: true, linkify: true })

const introHtml = computed(() => md.render(props.narrative.intro))
const outroHtml = computed(() => md.render(props.narrative.outro))

function bodyHtml(body: string): string {
  return md.render(body)
}

function citationTitle(url: string): string {
  return props.citations.find(c => c.url === url)?.title ?? url
}

function sectionCitations(urls: readonly string[]): MarketBriefCitation[] {
  return urls.map(u => props.citations.find(c => c.url === u)).filter((c): c is MarketBriefCitation => c !== undefined)
}

// 每節的衍生資料算一次就好：連到哪些鏈、屬於哪股力、有哪幾則引用
const views = computed(() => props.narrative.sections.map((s) => {
  const chains = chainsForSection(props.chains, s.citationUrls)
  return { s, chains, citations: sectionCitations(s.citationUrls), force: sectionForce(chains) }
}))
</script>

<template>
  <div class="narrative-reader">
    <div class="narrative-intro" v-html="introHtml" />

    <section
      v-for="(v, i) in views"
      :id="sectionDomId(i)"
      :key="i"
      class="narrative-section"
    >
      <!-- 屬於哪股力：長文接回力場圖的唯一一條線。分不出方向就不標。 -->
      <p v-if="v.force" class="section-tie" :class="v.force.kind">
        <i />屬於「{{ v.force.label }}」這股力
      </p>
      <div class="section-head">
        <span class="section-index">{{ String(i + 1).padStart(2, '0') }}</span>
        <h2 class="section-heading">
          {{ sectionLabel(v.s.heading, v.s.body, i) }}
        </h2>
      </div>
      <!-- 一句話結論：只讀每節這一行就該懂今天。null = 舊 brief 或 degrade、整條不出現 -->
      <p v-if="v.s.takeaway" class="section-takeaway">
        {{ v.s.takeaway }}
      </p>
      <div class="section-body" v-html="bodyHtml(v.s.body)" />
      <div v-if="v.s.citationUrls.length > 0" class="source-row">
        <span class="source-label">來源</span>
        <!-- url 經 backend 保證為真 source url；僅 data:insufficient sentinel 不可點 -->
        <component
          :is="isExternalUrl(url) ? 'a' : 'span'"
          v-for="url in v.s.citationUrls"
          :key="url"
          class="source-pill"
          v-bind="isExternalUrl(url) ? { href: url, target: '_blank', rel: 'noopener noreferrer' } : {}"
        >
          <span class="source-dot" />{{ citationTitle(url) }}
        </component>
      </div>
      <BriefSectionDepth :citations="v.citations" :chains="v.chains" />
    </section>

    <p class="narrative-outro" v-html="outroHtml" />
  </div>
</template>

<style scoped>
.narrative-reader {
  display: flex;
  flex-direction: column;
}
/* 導言靠字級與色階自己站住，不用色條側邊——後者是上一個世界的裝置。 */
.narrative-intro {
  font-family: var(--brief-thesis-font, var(--font-display));
  font-size: var(--brief-intro-size, 20px);
  line-height: 1.9;
  letter-spacing: 0.03em;
  color: var(--fg-2);
  margin: 0 0 44px;
}
/* markdown-it 產的是 <p>，而 main.css 的全域 `p { font-size: var(--size-body) }`
   是元素選擇器、會蓋掉包裹層的字級——導言因此一直以 15px 渲染而不是設定的 20px。
   同樣的洞也在 .section-body 上。 */
.narrative-intro :deep(p) {
  margin: 0 0 1.2em;
  font-size: inherit;
  line-height: inherit;
}
.narrative-intro :deep(p:last-child) {
  margin-bottom: 0;
}
.narrative-section {
  margin-bottom: 68px;
}
/* 圖上那兩股力的回指：一小段線段是鋒面的縮影，不是裝飾符號 */
.section-tie {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 9px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.08em;
  color: var(--fg-3);
}
.section-tie i {
  width: 16px;
  border-top: 2px solid var(--cold);
}
.section-tie.push i {
  border-top-color: var(--warm);
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.section-index {
  font-family: var(--font-num);
  font-size: var(--size-small);
  font-weight: 600;
  color: var(--accent);
}
.section-heading {
  margin: 0;
  font-size: var(--size-h2);
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.01em;
}
/* 只讀每節這一行就該懂今天：字重與細線把它從內文抬起來，但不做成卡片——
   卡片會切斷散文的連接組織，而連接組織正是這個產品的賣點。 */
.section-takeaway {
  margin: 0 0 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-2);
  max-width: 58ch;
  font-size: var(--size-h3);
  font-weight: 700;
  line-height: 1.75;
  letter-spacing: 0.02em;
  color: var(--fg-1);
}
.section-body {
  font-family: var(--brief-body-font, var(--font-display));
  font-size: var(--brief-body-size, 20px);
  line-height: var(--brief-body-leading, 1.85);
  letter-spacing: var(--brief-body-tracking, 0.035em);
  color: var(--fg-1);
  margin: 0 0 16px;
  /* 框寬已經是從這個量度推導的（見 home-brief.css 的 --measure-frame），所以這條
     在桌機是等值的保險；窄螢幕收成單欄時它才真正在作用。 */
  max-width: 58ch;
}
.section-body :deep(p) {
  margin: 0 0 1.8em;
  /* 同 .narrative-intro：不繼承的話全域 p 規則會把長文內文壓成 15px */
  font-size: inherit;
  line-height: inherit;
}
.section-body :deep(p:last-child) {
  margin-bottom: 0;
}
.source-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
}
.source-label {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.04em;
  color: var(--fg-muted);
}
.source-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: var(--size-small);
  color: var(--fg-2);
  text-decoration: none;
  box-shadow: var(--shadow-xs);
}
.source-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--accent);
}
.narrative-outro {
  font-family: var(--brief-thesis-font, var(--font-display));
  font-size: var(--brief-outro-size, 17px);
  font-style: italic;
  line-height: 1.95;
  letter-spacing: 0.03em;
  color: var(--fg-2);
  margin: 4px 0 0;
  padding: 20px 22px;
  background: var(--surface);
  border: 1px solid var(--border-2);
}
</style>
