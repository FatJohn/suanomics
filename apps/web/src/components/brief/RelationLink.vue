<script setup lang="ts">
import { computed } from 'vue'
import { isExternalUrl } from '@/lib/url.js'

const props = defineProps<{
  title: string
  url: string
  relationType: 'cause' | 'effect' | 'context' | 'contrast'
  reasoning: string
}>()

const RELATION_LABEL = {
  cause: '起因',
  effect: '影響',
  context: '背景',
  contrast: '對比',
} as const

// url 經 backend 保證為真 source url；僅 sentinel 非外連、外部 URL 渲染為 <a>（開新分頁）、否則 <div>
const external = computed(() => isExternalUrl(props.url))
const linkAttrs = computed(() =>
  external.value
    ? { href: props.url, target: '_blank', rel: 'noopener noreferrer' }
    : {},
)
</script>

<template>
  <component
    :is="external ? 'a' : 'div'"
    v-bind="linkAttrs"
    class="relation-link"
  >
    <span class="relation-label" :class="`relation-label-${relationType}`">
      {{ RELATION_LABEL[relationType] }}
    </span>
    <span class="relation-body">
      <span class="relation-title">{{ title }}</span>
      <span class="relation-reason">{{ reasoning }}</span>
    </span>
  </component>
</template>

<style scoped>
.relation-link {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: start;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: inherit;
  text-decoration: none;
  transition:
    border-color var(--dur-base) var(--ease-out),
    background var(--dur-base) var(--ease-out);
}
.relation-link:hover {
  border-color: var(--accent-200);
  background: var(--accent-50);
}
.relation-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--size-caption);
  font-weight: 600;
  color: var(--relation-fg);
  white-space: nowrap;
  min-width: 40px;
}
.relation-label-cause {
  background: var(--relation-cause);
}
.relation-label-effect {
  background: var(--verdict-red-fg);
}
.relation-label-context {
  background: var(--relation-context);
}
.relation-label-contrast {
  background: var(--relation-contrast);
}
.relation-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.relation-title {
  font-weight: 600;
  font-size: var(--size-small);
  line-height: 1.5;
  color: var(--fg-1);
}
.relation-reason {
  font-size: var(--size-small);
  color: var(--fg-3);
  line-height: 1.55;
}
</style>
