<script setup lang="ts">
import type { CollapsibleRootEmits, CollapsibleRootProps } from 'reka-ui'
import { CollapsibleRoot, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<CollapsibleRootProps>()
const emits = defineEmits<CollapsibleRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <!-- reka-ui optional props 在 exactOptionalPropertyTypes: true 下會擴展成 boolean | undefined、需要 cast 繞過 -->
  <CollapsibleRoot
    v-slot="slotProps"
    as="div"
    data-slot="collapsible"
    v-bind="forwarded as any"
  >
    <slot v-bind="slotProps" />
  </CollapsibleRoot>
</template>
