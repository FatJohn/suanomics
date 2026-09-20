<script setup lang="ts">
import type { MarketBrief } from '@suanomics/shared'
import { computed } from 'vue'
import { tier1Chains } from '@/lib/cascade-matrix.js'
import BriefDetailsAccordion from './BriefDetailsAccordion.vue'
import BriefNarrativeReader from './BriefNarrativeReader.vue'
import CascadeChainTree from './CascadeChainTree.vue'

const props = withDefaults(
  defineProps<{ analysis: MarketBrief, omitDetails?: boolean, omitCascade?: boolean }>(),
  { omitDetails: false, omitCascade: false },
)

const hasCascade = computed(() => tier1Chains(props.analysis.cascadeChains ?? []).length > 0)
</script>

<template>
  <article class="brief-analysis">
    <BriefNarrativeReader
      v-if="props.analysis.narrative"
      :narrative="props.analysis.narrative"
      :citations="props.analysis.citations"
      :chains="props.analysis.cascadeChains ?? []"
    />

    <section v-if="hasCascade && !props.omitCascade" class="cascade-section">
      <h3 class="section-title">
        產業連動結構
      </h3>
      <CascadeChainTree :chains="props.analysis.cascadeChains ?? []" />
    </section>

    <BriefDetailsAccordion
      v-if="!props.omitDetails"
      :citations="props.analysis.citations"
      :related-news="props.analysis.relatedNews"
      :reasoning-chain="props.analysis.reasoningChain"
      :disclaimer="props.analysis.disclaimer"
      :related-e-t-fs="props.analysis.relatedETFs"
    />
  </article>
</template>

<style scoped>
.brief-analysis {
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.cascade-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 24px;
  border-top: 1px solid var(--border-2);
}
.section-title {
  margin: 0;
  font-size: var(--size-small);
  font-weight: 600;
  color: var(--fg-3);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
