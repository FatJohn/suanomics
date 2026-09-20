<script setup lang="ts">
import type { MarketBrief, MarketBriefCitation } from '@suanomics/shared'
import { Icon } from '@iconify/vue'
import { ref } from 'vue'
import CitationCard from '@/components/brief/CitationCard.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible/index.js'
import EtfBadge from './EtfBadge.vue'
import RelationLink from './RelationLink.vue'

const props = withDefaults(
  defineProps<{
    citations: MarketBriefCitation[]
    relatedNews: MarketBrief['relatedNews']
    reasoningChain: string[]
    disclaimer: string
    relatedETFs: MarketBrief['relatedETFs']
    omitReasoningChain?: boolean
    // 引用已經收進每一節的展開層時、頁面層不要再列一次同一批來源
    omitCitations?: boolean
    // 在第二層「佐證與來源」預設展開：那一層的存在理由就是這些內容
    defaultOpen?: boolean
  }>(),
  { omitReasoningChain: false, omitCitations: false, defaultOpen: false },
)

const open = ref(props.defaultOpen)
</script>

<template>
  <section class="details-accordion">
    <Collapsible v-model:open="open">
      <CollapsibleTrigger class="accordion-toggle" :class="{ open }">
        <Icon icon="lucide:chevron-right" class="chev" :width="14" :height="14" />
        <span>來源與細節</span>
        <span class="toggle-indicator">{{ open ? '收起' : '展開' }}</span>
      </CollapsibleTrigger>
      <CollapsibleContent class="accordion-content">
        <div v-if="!props.omitCitations && props.citations.length > 0" class="section">
          <h4 class="section-title">
            <Icon icon="lucide:link-2" :width="14" :height="14" />
            引用來源（{{ props.citations.length }} 筆）
          </h4>
          <ul class="citation-list">
            <CitationCard
              v-for="(c, idx) in props.citations"
              :key="`${c.url}-${idx}`"
              :c="c"
            />
          </ul>
        </div>

        <div v-if="props.relatedNews.length > 0" class="section">
          <h4 class="section-title">
            <Icon icon="lucide:newspaper" :width="14" :height="14" />
            相關新聞（{{ props.relatedNews.length }}）
          </h4>
          <div class="related-list">
            <RelationLink
              v-for="(rn, i) in props.relatedNews"
              :key="i"
              :title="rn.title"
              :url="rn.url"
              :relation-type="rn.relationType"
              :reasoning="rn.reasoning"
            />
          </div>
        </div>

        <div v-if="props.relatedETFs.length > 0" class="section">
          <h4 class="section-title">
            <Icon icon="lucide:badge-dollar-sign" :width="14" :height="14" />
            相關 ETF（{{ props.relatedETFs.length }}）
          </h4>
          <div class="etf-list">
            <EtfBadge
              v-for="etf in props.relatedETFs"
              :key="etf.ticker"
              :ticker="etf.ticker"
              :name="etf.name"
            />
          </div>
        </div>

        <div v-if="!props.omitReasoningChain && props.reasoningChain.length > 0" class="section">
          <h4 class="section-title">
            <Icon icon="lucide:git-branch" :width="14" :height="14" />
            推論鏈（{{ props.reasoningChain.length }} 步）
          </h4>
          <ol class="reasoning-list">
            <li v-for="(step, i) in props.reasoningChain" :key="i">
              {{ step }}
            </li>
          </ol>
        </div>

        <p class="disclaimer">
          {{ props.disclaimer }}
        </p>
      </CollapsibleContent>
    </Collapsible>
  </section>
</template>

<style scoped>
.details-accordion {
  margin-top: 24px;
}
.accordion-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  font: inherit;
  font-weight: 600;
  font-size: var(--size-small);
  color: var(--fg-1);
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}
.accordion-toggle:hover {
  background: var(--bg-3);
}
.accordion-toggle .chev {
  transition: transform var(--dur-base) var(--ease-out);
  color: var(--fg-3);
  flex-shrink: 0;
}
.accordion-toggle.open .chev {
  transform: rotate(90deg);
}
.toggle-indicator {
  margin-left: auto;
  font-size: var(--size-caption);
  font-weight: 500;
  color: var(--fg-3);
}
.accordion-content {
  padding: 16px 14px 4px 14px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--size-small);
  font-weight: 600;
  color: var(--fg-2);
}
.citation-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.related-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.etf-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.reasoning-list {
  margin: 0;
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--fg-1);
  line-height: 1.65;
  font-size: var(--size-small);
}
.disclaimer {
  margin: 4px 0 0 0;
  padding: 10px 12px;
  background: var(--bg-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  font-size: var(--size-small);
  color: var(--fg-3);
  text-align: center;
  line-height: 1.5;
}
</style>
