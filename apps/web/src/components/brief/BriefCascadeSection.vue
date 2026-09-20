<script setup lang="ts">
import type { CascadeChain } from '@suanomics/shared'
import { computed } from 'vue'
import { cascadeSummaryCounts, tier1Chains } from '@/lib/cascade-matrix.js'
import CascadeChainTree from './CascadeChainTree.vue'

/**
 * 佐證層的連動結構。
 *
 * 不收合：收合殼是它還住在第一層時為了省頁高而存在的，搬進「佐證與來源」之後它就是這一層
 * 的主角，外面再包一層「展開／收起」只是多一個沒人會按的按鈕（`defaultOpen` 也早就只剩
 * `true` 一個使用點）。
 */
const props = defineProps<{ chains: CascadeChain[], forceOrder?: string[] | undefined }>()
const hasCascade = computed(() => tier1Chains(props.chains).length > 0)
const counts = computed(() => cascadeSummaryCounts(props.chains))
</script>

<template>
  <section v-if="hasCascade" class="cascade-section" aria-label="產業連動結構">
    <header class="cascade-head">
      <h2>產業連動結構</h2>
      <span class="summary">
        <span class="up">↑ 正向 {{ counts.up }}</span>
        <span class="dn">↓ 負向 {{ counts.down }}</span>
        <span class="nt">— 中性 {{ counts.neutral }}</span>
      </span>
    </header>
    <CascadeChainTree :chains="props.chains" :force-order="props.forceOrder" />
  </section>
</template>

<style scoped>
/* 與來源清單同一種節標題：一行標題加一組計數，靠 hairline 與間距分節 */
.cascade-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.cascade-head h2 {
  margin: 0;
  font-size: var(--size-body);
  font-weight: 700;
  color: var(--fg-1);
}
.summary {
  display: inline-flex;
  gap: 10px;
  font-size: var(--size-caption);
  font-weight: 500;
  font-family: var(--font-num);
}
.summary .up {
  color: var(--dir-up);
}
.summary .dn {
  color: var(--dir-down);
}
.summary .nt {
  color: var(--fg-3);
}
@media (max-width: 520px) {
  /* 窄螢幕摘要換行不擠 trigger */
  .summary {
    display: none;
  }
}
</style>
