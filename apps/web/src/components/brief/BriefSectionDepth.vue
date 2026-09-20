<script setup lang="ts">
import type { CascadeChain, MarketBriefCitation } from '@suanomics/shared'
import { computed, ref } from 'vue'
import CitationCard from '@/components/brief/CitationCard.vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible/index.js'
import { dirArrow, toDirKey } from '@/lib/cascade-matrix.js'
import { sectionDepthSummary } from '@/lib/narrative-depth.js'

const props = defineProps<{
  citations: MarketBriefCitation[]
  chains: CascadeChain[]
}>()

const open = ref(false)
// 展開層是預覽、不是完整連動區：超過三條就收成一行「還有 N 條」指向下方
const PREVIEW_LIMIT = 3
const previewChains = computed(() => props.chains.slice(0, PREVIEW_LIMIT))
const restCount = computed(() => Math.max(0, props.chains.length - PREVIEW_LIMIT))
const label = computed(() => sectionDepthSummary(props.citations.length, props.chains.length))
</script>

<template>
  <Collapsible v-if="label" v-model:open="open" class="depth">
    <CollapsibleTrigger class="depth-trigger" :class="{ open }">
      <span class="depth-chev" aria-hidden="true">▸</span>
      <span>{{ open ? '收起這一節的細節' : label }}</span>
    </CollapsibleTrigger>
    <CollapsibleContent class="depth-body">
      <div v-if="props.citations.length > 0" class="depth-block">
        <p class="depth-kicker">
          這一節引用的來源
        </p>
        <ul class="depth-citations">
          <CitationCard v-for="(c, i) in props.citations" :key="`${c.url}-${i}`" :c="c" />
        </ul>
      </div>

      <div v-if="props.chains.length > 0" class="depth-block">
        <p class="depth-kicker">
          這一節帶動的連動
        </p>
        <ul class="depth-chains">
          <li v-for="(c, i) in previewChains" :key="i" class="depth-chain">
            <span class="chain-dir" :class="toDirKey(c.direction)">{{ dirArrow(toDirKey(c.direction)) }}</span>
            <span class="chain-body">
              <span class="chain-industry">{{ c.industry }}</span>
              <span class="chain-mechanism">{{ c.mechanism }}</span>
            </span>
          </li>
        </ul>
        <p v-if="restCount > 0" class="depth-rest">
          還有 {{ restCount }} 條連動、在下方的完整連動結構裡
        </p>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<style scoped>
.depth {
  margin-top: 18px;
  border-top: 1px solid var(--border-2);
}
.depth-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 11px 0 0;
  background: none;
  border: 0;
  font: inherit;
  font-size: var(--size-small);
  font-weight: 500;
  color: var(--fg-3);
  cursor: pointer;
  text-align: left;
  transition: color var(--dur-base) var(--ease-out);
}
.depth-trigger:hover {
  color: var(--fg-1);
}
.depth-chev {
  font-family: var(--font-num);
  color: var(--accent);
  transition: transform var(--dur-base) var(--ease-out);
}
.depth-trigger.open .depth-chev {
  transform: rotate(90deg);
}
.depth-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px 0 4px;
}
.depth-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.depth-kicker {
  margin: 0;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.depth-citations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.depth-chains {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.depth-chain {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.chain-dir {
  font-family: var(--font-num);
  font-size: var(--size-small);
  font-weight: 700;
  flex-shrink: 0;
}
.chain-dir.up {
  color: var(--warm);
}
.chain-dir.down {
  color: var(--cold);
}
.chain-dir.neutral {
  color: var(--fg-muted);
}
.chain-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.chain-industry {
  font-size: var(--size-small);
  font-weight: 700;
  color: var(--fg-1);
}
.chain-mechanism {
  font-size: var(--size-small);
  line-height: 1.7;
  color: var(--fg-2);
}
.depth-rest {
  margin: 0;
  font-size: var(--size-small);
  color: var(--fg-muted);
}
</style>
