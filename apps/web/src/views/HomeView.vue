<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import BriefAnalysisPanel from '@/components/brief/BriefAnalysisPanel.vue'
import BriefCalendarBand from '@/components/brief/BriefCalendarBand.vue'
import BriefCascadeSection from '@/components/brief/BriefCascadeSection.vue'
import BriefDockedPlayer from '@/components/brief/BriefDockedPlayer.vue'
import BriefGlanceRow from '@/components/brief/BriefGlanceRow.vue'
import BriefLayerTabs from '@/components/brief/BriefLayerTabs.vue'
import BriefReasoningHighlights from '@/components/brief/BriefReasoningHighlights.vue'
import BriefSidebar from '@/components/brief/BriefSidebar.vue'
import BriefSourceList from '@/components/brief/BriefSourceList.vue'
import BriefSynopticChart from '@/components/brief/BriefSynopticChart.vue'
import BriefViewpointsSection from '@/components/brief/BriefViewpointsSection.vue'
import MarketKeyNumbers from '@/components/brief/MarketKeyNumbers.vue'
import { usePodcastPlayer } from '@/composables/usePodcastPlayer.js'
import { useReadingProgress } from '@/composables/useReadingProgress.js'
import { buildBriefSources } from '@/lib/brief-sources.js'
import { toCalendarBandEvents, toCalendarCoverageNotes } from '@/lib/calendar-band.js'
import { carriedQuery, resolveReaderLayer } from '@/lib/reader-layer.js'
import { loadReaderView } from '@/lib/reader-load.js'
import { buildKicker, buildLayerCounts, buildReportMeta } from '@/lib/report-meta.js'
import { useBriefStore } from '@/stores/brief.js'
import { useMarketStore } from '@/stores/market.js'
import '@/assets/home-brief.css'

const route = useRoute()
const store = useBriefStore()
const marketStore = useMarketStore()

// 卡片要跟著檢視的那一天，不能永遠是今天的收盤。接線本身抽到
// `lib/reader-load.ts` 才測得到（這個 workspace 沒有元件測試基礎設施）。
// 既有的 route.params.date watcher（下方）涵蓋日期切換，不必再加一個。
function load() {
  loadReaderView({
    fetchBriefByDate: d => void store.fetchByDate(d),
    fetchDailyBrief: () => void store.fetchDaily(),
    fetchKeyNumbers: d => void marketStore.fetchKeyNumbers(d),
  }, route.params.date)
}

onMounted(() => {
  load()
  void store.fetchDates()
})
watch(() => route.params.date, load)

const currentDate = computed(() => store.daily?.brief?.briefDate)
const fallbackDate = computed(() => store.availableDates[0])
const isLoading = computed(() => store.dailyStatus === 'loading')
const isDevelopment = import.meta.env.DEV

const brief = computed(() => store.daily?.brief?.briefJson ?? null)
const viewpoints = computed(() => brief.value?.viewpoints ?? null)
// 事件是報告產出當下的 7 天窗快照（與餵給 LLM 的 calendarBlock 同源），不是即時查詢——
// 回看舊報告時看到的仍是「那天的接下來」。空或 undefined 時整條帶不渲染。
const calendarEvents = computed(() => toCalendarBandEvents(brief.value?.calendarEvents))
// 公司事件來源的涵蓋範圍註記：補產舊報告時分得出「來源查不到」與「那週真的沒事」
const calendarNotes = computed(() => toCalendarCoverageNotes(brief.value?.calendarCoverage))
const kicker = computed(() => buildKicker(currentDate.value))
const meta = computed(() => buildReportMeta(brief.value, store.daily?.items.length ?? 0))

// 層別來自網址而不是元件狀態：讀者要能把「這天的佐證」直接貼給別人，上一頁也該回到原本那層
const layer = computed(() => resolveReaderLayer(route.query.view))
// 一則新聞在 brief 裡有三種身分（被引用／被標成有因果關係／當天被監測到），合成一筆
const sources = computed(() =>
  buildBriefSources(brief.value?.citations ?? [], brief.value?.relatedNews ?? [], store.daily?.items ?? []),
)
// 計數只報實際存在的東西數量：舊的「N 引用 · M 新聞」裡那個 M 是 N 的子集、會讓人以為有兩批
const layerCounts = computed(() => buildLayerCounts(brief.value, sources.value.length))

// 單一 player instance：<audio> 掛在常駐底部播放器上，所以播放不會因為捲動或展開逐字稿而中斷
const podcastJson = computed(() => store.podcastJson)
const audioUrl = computed(() => store.audioUrl)
const player = usePodcastPlayer(podcastJson)

// 頂端閱讀進度：長文唯一缺的是「現在在哪、還有多少」的感覺
const { progress: readingRatio } = useReadingProgress()
</script>

<template>
  <main class="brief-landing">
    <div
      class="reading-progress"
      role="progressbar"
      aria-label="閱讀進度"
      :aria-valuenow="Math.round(readingRatio * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span class="reading-progress-fill" :style="{ transform: `scaleX(${readingRatio})` }" />
    </div>
    <section v-if="store.dailyStatus === 'idle' || isLoading" class="brief-frame brief-status brief-loading" aria-live="polite">
      <span class="loading-rule" />
      <span>正在整理今日報告…</span>
    </section>

    <section v-else-if="store.dailyStatus === 'error'" class="brief-frame brief-status brief-status-error" role="alert">
      <strong>無法載入今日報告</strong>
      <span>連線可能暫時不穩定，請稍後再試。</span>
      <button type="button" class="retry-button" :disabled="isLoading" @click="load">
        重新載入
      </button>
    </section>

    <template v-else-if="brief">
      <!-- 圖區：力場圖與貼著它的兩條帶站在同一張圖紙上 -->
      <div class="brief-stage">
        <BriefSynopticChart
          :brief-date="store.daily?.brief?.briefDate ?? ''"
          :industries="brief.affectedIndustries"
        >
          <p class="chart-kicker">
            {{ kicker }}
          </p>
          <h1 class="chart-headline">
            {{ brief.headline || '盤前簡報' }}
          </h1>
          <div v-if="brief.dailyThesis" class="chart-thesis">
            <span class="chart-thesis-label">本日主軸</span>
            <p>{{ brief.dailyThesis }}</p>
          </div>
          <template #stations>
            <MarketKeyNumbers :series="marketStore.keyNumbers" />
          </template>
        </BriefSynopticChart>
        <!-- 「接下來會來的」時間軸帶。事件與涵蓋範圍註記都由 brief 攜帶（產出當下的 7 天窗），
             兩者都沒有時整條帶不渲染。 -->
        <div class="brief-frame">
          <BriefCalendarBand :events="calendarEvents" :notes="calendarNotes" />
        </div>
      </div>

      <div class="brief-read">
        <!-- LayerTabs 與下面的 ViewpointsSection 不包 .brief-frame：它們外層要滿版帶底色、
             自己在內層套 frame（規則寫在 home-brief.css 的 .brief-frame 上方）。 -->
        <BriefLayerTabs :layer="layer" :counts="layerCounts" />

        <template v-if="layer === 'report'">
          <!-- 正反兩面是報告內容不是佐證，所以歸這一層；擺在最前面是因為它接的是圖上
               那道主鋒面。切到佐證層時它跟著消失——那正是「切換有作用」的訊號。 -->
          <BriefViewpointsSection v-if="viewpoints" :viewpoints="viewpoints" />
          <div class="brief-frame">
            <BriefGlanceRow :meta="meta" :industries="brief.affectedIndustries" />
            <BriefReasoningHighlights :steps="brief.reasoningChain" />
          </div>
          <div class="brief-frame brief-grid">
            <BriefSidebar :sections="brief.narrative?.sections ?? []" />
            <div class="brief-main">
              <BriefAnalysisPanel
                :analysis="brief"
                :omit-details="true"
                :omit-cascade="true"
              />
            </div>
          </div>
        </template>

        <!-- 第二層：有興趣去追的人再進來。來源在前——進這一層的人想問的是「憑什麼這樣說」，
             連動結構是另一種深掘，放後面。兩塊都不收合：收合殼是它們還住在第一層時省頁高
             用的。 -->
        <div v-else class="brief-frame brief-evidence">
          <BriefSourceList :sources="sources" />
          <BriefCascadeSection
            :chains="brief.cascadeChains ?? []"
            :force-order="brief.affectedIndustries.map(i => i.name)"
          />
          <p class="evidence-disclaimer">
            {{ brief.disclaimer }}
          </p>
        </div>
      </div>
    </template>

    <section v-else class="brief-frame brief-status brief-empty">
      <!-- 數字不依附報告：報告沒產出的日子，讀者仍該看得到今天的盤面 -->
      <div class="empty-stations">
        <MarketKeyNumbers :series="marketStore.keyNumbers" />
      </div>
      <strong>今日報告尚未發布</strong>
      <p v-if="fallbackDate">
        可以先
        <RouterLink :to="{ path: `/d/${fallbackDate}`, query: carriedQuery(route.query) }" class="link-inline">
          查看上一期報告
        </RouterLink>
        。
      </p>
      <p v-else>
        你也可以前往
        <RouterLink to="/brief/analyze" class="link-inline">
          即時新聞分析
        </RouterLink>
        。
      </p>
      <p v-if="isDevelopment" class="brief-empty-dev">
        開發環境：請執行 <code>pnpm brief:generate</code>。
      </p>
    </section>

    <!-- 常駐底部：捲到哪都在。逐字稿是這條列上的單一入口、不再是一級面板 -->
    <BriefDockedPlayer :player="player" :podcast="store.podcastJson" :audio-url="audioUrl" />
  </main>
</template>
