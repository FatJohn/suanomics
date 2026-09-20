import { createRouter, createWebHistory } from 'vue-router'
import { resolveReaderRouteRedirect } from '@/lib/reader-route.js'
import HomeView from '@/views/HomeView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/d/:date', name: 'home-dated', component: HomeView },
    { path: '/brief', redirect: '/' },
    { path: '/brief/news/:id', name: 'brief-news', component: () => import('@/views/BriefNewsView.vue') },
    { path: '/brief/analyze', name: 'brief-analyze', component: () => import('@/views/BriefAnalyzeView.vue') },
    { path: '/sources', name: 'sources', component: () => import('@/views/SourcesView.vue') },
  ],
})

// 讀者面網址的正規化：`?date=` 不是這個站的參數（日期在路徑上），合法的導到 canonical
// `/d/:date`、不合法的把 key 拿掉；`?view=` 則把 `evidence` 以外的值一併拿掉（它們在網址上
// 沒有作用）。完全未知的 query 不碰。逐條理由見 lib/reader-route.ts。
// replace：讀者按上一頁該回到他真正來的地方，不是那個沒有作用的網址。
router.beforeEach((to) => {
  const target = resolveReaderRouteRedirect(to)
  return target === null ? true : { ...target, replace: true }
})
