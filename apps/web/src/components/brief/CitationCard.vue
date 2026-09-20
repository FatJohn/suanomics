<script setup lang="ts">
import type { MarketBriefCitation } from '@suanomics/shared'
import { Icon } from '@iconify/vue'
import { computed, ref } from 'vue'
import { isExternalUrl } from '@/lib/url.js'

const props = defineProps<{ c: MarketBriefCitation }>()

// url 經 backend 保證為真 source url；僅 data:insufficient sentinel 非外連、不渲染 publisher / 連結
const hasUrl = computed(() => isExternalUrl(props.c.url))

const publisher = computed(() => {
  try {
    return new URL(props.c.url).hostname
  }
  catch {
    return '—'
  }
})

const expanded = ref(false)
const isLong = computed(() => props.c.quote.length > 100)
</script>

<template>
  <li class="cit">
    <div v-if="hasUrl" class="cit-head">
      <span class="cit-pub">{{ publisher }}</span>
    </div>
    <div class="cit-title">
      {{ c.title }}
    </div>
    <div class="cit-quote" :class="{ 'cit-quote--clamped': isLong && !expanded }">
      「{{ c.quote }}」
    </div>
    <button v-if="isLong" class="cit-expand" @click="expanded = !expanded">
      {{ expanded ? '收起' : '展開' }}
    </button>
    <a v-if="hasUrl" class="cit-link" :href="c.url" target="_blank" rel="noopener noreferrer">
      前往原始文件
      <Icon icon="lucide:external-link" :width="12" :height="12" />
    </a>
  </li>
</template>
