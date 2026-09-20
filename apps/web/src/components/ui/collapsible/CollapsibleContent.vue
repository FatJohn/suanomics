<script setup lang="ts">
import type { CollapsibleContentProps } from 'reka-ui'
import { CollapsibleContent } from 'reka-ui'

const props = defineProps<CollapsibleContentProps>()
</script>

<template>
  <!-- reka-ui optional props 在 exactOptionalPropertyTypes: true 下會擴展成 boolean | undefined、需要 cast 繞過 -->
  <CollapsibleContent
    as="div"
    data-slot="collapsible-content"
    v-bind="props as any"
  >
    <slot />
  </CollapsibleContent>
</template>
