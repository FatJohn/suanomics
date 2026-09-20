<script setup lang="ts">
import AppFooter from '@/components/layout/AppFooter.vue'
import AppHeader from '@/components/layout/AppHeader.vue'
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <div class="view-wrap">
      <RouterView />
    </div>
    <AppFooter />
  </div>
</template>
