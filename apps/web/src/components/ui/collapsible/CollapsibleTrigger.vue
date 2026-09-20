<script setup lang="ts">
import type { CollapsibleTriggerProps } from 'reka-ui'
import { CollapsibleTrigger } from 'reka-ui'

const props = defineProps<CollapsibleTriggerProps>()
</script>

<template>
  <!-- reka-ui optional props 在 exactOptionalPropertyTypes: true 下會擴展成 boolean | undefined、需要 cast 繞過 -->
  <CollapsibleTrigger
    as="button"
    data-slot="collapsible-trigger"
    v-bind="props as any"
  >
    <slot />
  </CollapsibleTrigger>
</template>
