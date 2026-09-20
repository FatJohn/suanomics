<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import BriefAnalysisPanel from '@/components/brief/BriefAnalysisPanel.vue'
import AppBackLink from '@/components/layout/AppBackLink.vue'
import { useBriefStore } from '@/stores/brief.js'

const route = useRoute()
const store = useBriefStore()

function loadById(rawId: unknown): void {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0)
    return
  void store.fetchNewsAnalysis(id)
}

onMounted(() => loadById(route.params.id))

// `/brief/news/:id` → `/brief/news/:otherId` 內部導航時、route.params.id 會變、
// 但 component 不會 unmount、需用 watch 重新抓
watch(() => route.params.id, newId => loadById(newId))
</script>

<template>
  <main class="page-ground">
    <div class="page brief-news">
      <header class="page-head">
        <AppBackLink>
          <Icon icon="lucide:arrow-left" :width="14" :height="14" />
          <span>回簡報列表</span>
        </AppBackLink>
        <div class="page-eyebrow">
          掐指連總經 · 新聞分析
        </div>
      </header>

      <section v-if="store.analysisStatus === 'loading'" class="status-block">
        載入中…
      </section>

      <section v-else-if="store.analysisStatus === 'error'" class="status-block status-error" role="alert">
        載入失敗、請稍後再試。
      </section>

      <section v-else-if="store.analysis">
        <BriefAnalysisPanel :analysis="store.analysis" />
      </section>

      <section v-else class="status-block">
        此新聞尚未產生分析、請從 <RouterLink to="/">
          今日簡報
        </RouterLink> 挑一則、或稍後重試。
      </section>
    </div>
  </main>
</template>

<style scoped>
.brief-news {
  max-width: 780px;
}
.status-block {
  padding: 48px 20px;
  text-align: center;
  color: var(--fg-3);
  font-size: var(--size-small);
}
.status-error {
  color: var(--verdict-red-fg);
}
</style>
