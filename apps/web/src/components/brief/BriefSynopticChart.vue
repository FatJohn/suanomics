<script setup lang="ts">
import type { MarketBrief } from '@suanomics/shared'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { buildFront, buildIsobars, dateSeed, selectForces } from '@/lib/synoptic-chart.js'

/**
 * 本日力場圖。
 *
 * SVG 只負責「紋理與那條線」，一律 aria-hidden——所有讀者需要理解的東西
 * 都是它上面的 HTML 文字（白話力場標籤與 slot 進來的標題）。這是
 * 「圖不需要圖例」在實作上的落點：圖裡沒有任何要解碼的符號。
 *
 * 幾何依**實際渲染尺寸**生成，不是固定 viewBox 再讓 svg 縮放。圖的寬度隨斷點變
 * （見 home-brief.css 的 --measure-frame），固定 viewBox 要嘛把圖拉成錯誤的高度、
 * 要嘛為了塞進容器而讓鋒面三角橫向壓扁——後者是這張圖唯一不能壞的東西。
 */
const props = defineProps<{
  briefDate: string
  industries: MarketBrief['affectedIndustries']
}>()

/** 桌機圖高的**下限**（CSS 的 min-height 同值）：內容更長時圖跟著長高，見下方 .synoptic */
const DESKTOP_MIN_HEIGHT = 580
const NARROW_MAX = 1023
/** 量到實際尺寸之前的暫用值，避免第一幀畫出 viewBox="0 0 0 0" */
const FALLBACK_WIDTH = 1180

const root = shallowRef<HTMLElement | null>(null)
const size = ref({ w: FALLBACK_WIDTH, h: DESKTOP_MIN_HEIGHT })

function syncSize(): void {
  const el = root.value
  if (!el)
    return
  const w = Math.round(el.clientWidth)
  const h = Math.round(el.clientHeight)
  if (w > 0 && h > 0 && (w !== size.value.w || h !== size.value.h))
    size.value = { w, h }
}

const narrow = computed(() => size.value.w <= NARROW_MAX)
const seed = computed(() => dateSeed(props.briefDate))
const forces = computed(() => selectForces(props.industries))

const geometry = computed(() => {
  const { w, h } = size.value
  const isNarrow = narrow.value
  return {
    front: buildFront(seed.value, w, h),
    isobars: buildIsobars(seed.value, w, h),
    grid: isNarrow
      ? { w: Math.round(w / 8), h: Math.round(h / 7) }
      : { w: Math.round(w / 20), h: Math.round(h / 11.6) },
    marker: isNarrow ? 8 : 11,
    damp: isNarrow
      ? { cx: w * 0.769, cy: h * 0.318, rx: 82, ry: 54, k: 30, ky: 18 }
      : { cx: w * 0.797, cy: h * 0.241, rx: 150, ry: 85, k: 55, ky: 30 },
    push: isNarrow
      ? { cx: w * 0.236, cy: h * 0.782, rx: 82, ry: 54, k: 30, ky: 18 }
      : { cx: w * 0.788, cy: h * 0.707, rx: 150, ry: 85, k: 55, ky: 30 },
  }
})

/** 冷鋒三角：立在線上、朝上。size 隨畫布縮放，手機小一號。 */
function triangle(x: number, y: number, s: number): string {
  const half = s * 0.62
  return `M ${x - half} ${y + half} L ${x} ${y - s} L ${x + half} ${y + half} Z`
}

// 不做尺寸分桶：viewBox 越貼近實際尺寸，`preserveAspectRatio` 要補的差就越小。
// 重算很便宜：3 條等壓線各 15 點、鋒面 23 點。
//
// mount 當下先同步量一次，不等 ResizeObserver 的第一次回呼——否則第一幀會用
// FALLBACK_WIDTH 的 viewBox 去畫一個可能只有 390 寬的畫布。沒有 ResizeObserver
// 的環境（舊 WebView、jsdom）退回 window resize 監聽。
let observer: ResizeObserver | null = null
onMounted(() => {
  const el = root.value
  if (!el)
    return
  syncSize()
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', syncSize)
    return
  }
  observer = new ResizeObserver(syncSize)
  observer.observe(el)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (typeof ResizeObserver === 'undefined')
    window.removeEventListener('resize', syncSize)
})
</script>

<template>
  <div ref="root" class="synoptic">
    <svg
      class="chart-canvas"
      :viewBox="`0 0 ${size.w} ${size.h}`"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id="syn-grid" :width="geometry.grid.w" :height="geometry.grid.h" patternUnits="userSpaceOnUse">
          <path :d="`M${geometry.grid.w} 0V${geometry.grid.h}M0 ${geometry.grid.h}H${geometry.grid.w}`" class="grid-line" />
        </pattern>
      </defs>
      <rect :width="size.w" :height="size.h" fill="url(#syn-grid)" />
      <path v-for="(d, i) in geometry.isobars" :key="i" :d="d" class="isobar" />
      <ellipse
        v-if="forces.damp"
        class="field field-damp"
        :cx="geometry.damp.cx"
        :cy="geometry.damp.cy"
        :rx="geometry.damp.rx + forces.damp.strength * geometry.damp.k"
        :ry="geometry.damp.ry + forces.damp.strength * geometry.damp.ky"
      />
      <ellipse
        v-if="forces.push"
        class="field field-push"
        :cx="geometry.push.cx"
        :cy="geometry.push.cy"
        :rx="geometry.push.rx + forces.push.strength * geometry.push.k"
        :ry="geometry.push.ry + forces.push.strength * geometry.push.ky"
      />
      <path :d="geometry.front.path" class="front" />
      <path v-for="(m, i) in geometry.front.markers" :key="i" :d="triangle(m.x, m.y, geometry.marker)" class="front-mark" />
    </svg>

    <!-- 器械收在 .brief-frame 的量度裡：圖紙可以寬到 1600，讀數帶不跟著攤開。
         這一層是圖紙與器械的分層點：圖紙絕對定位鋪滿，器械這一疊在它上面走正常流。 -->
    <div class="chart-instruments">
      <div class="brief-frame chart-measure">
        <div class="chart-overlay">
          <slot />
        </div>

        <div class="forces">
          <p v-if="forces.damp" class="force force-damp">
            <b>{{ forces.damp.label }}</b>
            <span>{{ forces.damp.industry }}</span>
          </p>
          <p v-if="forces.push" class="force force-push">
            <b>{{ forces.push.label }}</b>
            <span>{{ forces.push.industry }}</span>
          </p>
        </div>

        <!-- 觀測站讀數：釘在圖的底緣（桌機靠 margin-top: auto，自帶襯底），手機接在力場標籤下面。 -->
        <div v-if="$slots.stations" class="chart-stations">
          <slot name="stations" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 580 是**下限不是定值**：標題組的高度由當天的 headline 與 dailyThesis 決定，而固定
   580 只留得出 407.25px 給它（580 − top 44 − 讀數帶 102.75 − bottom 26）。裝不下的那天
   會把主軸最後一行推到讀數帶底下。
   量過 API 給的全部 49 個報告日（2026-05-10 ~ 09-04，桌機 1280）：標題是 3／4／5 行
   （156.23／208.31／260.39），主軸是 2／3／4 行（110.75／140.5／170.25）或整段缺席
   （dailyThesis 上線前的 15 天），標題組因此有 8 種高度、185.48 ~ 433.81——**其中 9 天
   超過 407.25**，在固定高度下全部是碰撞。改成 min-height 之後那 9 天把圖撐到 606.56，
   其餘 40 天的幾何與固定高時逐 px 相同。
   語料裡還沒同時出現過「5 行標題 ＋ 4 行主軸」；把那一組合成出來實測 overlay 485.89、
   圖高 658.64、四個器械仍無交疊。這是「改 min-height」而不是「把固定高度調大一點」的
   理由：內容的上界不在我們手上，調大只是把懸崖往後移。 */
.synoptic {
  position: relative;
  min-height: 580px;
  background: var(--chart);
  overflow: hidden;
}
/* 圖是背景層，器械疊在上面。幾何依實際尺寸生成，所以 viewBox 通常與畫布同比例、
   `slice` 什麼都不做；比例真的對不上時（量到之前的那一幀）它會裁切而不是拉伸——
   拉伸會讓鋒面三角變形，那是這張圖唯一不能壞的東西。 */
.chart-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.grid-line {
  fill: none;
  stroke: color-mix(in srgb, var(--border) 55%, transparent);
  stroke-width: 1;
}
.isobar {
  fill: none;
  stroke: color-mix(in srgb, var(--border) 85%, transparent);
  stroke-width: 1;
}
/* 力場暈區：大小與濃度由 editor 的信心來，不是裝飾漸層 */
.field {
  opacity: 0.1;
}
.field-damp {
  fill: var(--cold);
}
.field-push {
  fill: var(--warm);
}
.front {
  fill: none;
  stroke: var(--cold);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.front-mark {
  fill: var(--cold);
}

/* position 而非 static：圖紙是絕對定位的，未定位的兄弟節點會被它蓋住 */
.chart-instruments {
  position: relative;
}
/* 標題組與讀數帶走正常流、由 `margin-top: auto` 把讀數帶推到底緣——這是「兩者不相撞」
   從**量出來的**變成**結構上不可能**的地方。改成絕對定位的兩端釘死就等於再賭一次
   「內容不會長到那個高度」。上下的 padding 就是原本 top: 44px / bottom: 26px 那兩個值。 */
.chart-measure {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 580px;
  padding-block: 44px 26px;
}

/* 疊在圖上的內容一律自帶襯底——這是「圖不需要圖例」能成立的前提 */
.chart-overlay {
  /* 標題組只佔左側六成，右上留給力場標籤——力場標籤是絕對定位的，寬度不收會相撞。
     算式綁 --measure-frame 而不是百分比：百分比會跟著「相對於哪個框」變（絕對定位算
     padding box、正常流算 content box，同一個 58% 差 51px、標題就多一行），綁 token 則
     兩種定位法都給同一個值。桌機框寬固定 972、pad 44 → 519.76，與絕對定位時逐 px 相同。 */
  width: min(560px, calc(0.58 * var(--measure-frame) - var(--frame-pad)));
}
.force {
  position: absolute;
  right: var(--frame-pad, 44px);
  margin: 0;
  max-width: 210px;
  padding: 8px 12px;
  text-align: right;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
}
.force b {
  display: block;
  font-size: var(--size-small);
  font-weight: 900;
  letter-spacing: 0.01em;
}
.force span {
  display: block;
  margin-top: 2px;
  font-size: var(--size-caption);
  line-height: 1.55;
  color: var(--fg-2);
}
.force-damp {
  top: 12%;
}
.force-damp b {
  color: var(--cold);
}
.force-push {
  /* 底緣留給讀數帶：12% 會壓在讀數上 */
  bottom: 30%;
}
.force-push b {
  color: var(--warm);
}

.forces {
  display: contents;
}

/* 讀數釘在圖底緣：襯底不是裝飾，圖的等壓線會從數字底下穿過去。
   不畫四邊外框——上下那兩條 hairline 由 .kn-ribbon 自己帶（原本兩邊都畫、上下其實是
   疊了兩條 1px），左右不畫則與主軸卡同一種形式：襯底加一條線，不是卡片。 */
.chart-stations {
  margin-top: auto;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
}

/* 手機不用絕對定位堆疊：圖退成背景層，標題與力場標籤照正常流排。
   390px 寬放不下「文字疊在圖上還互不相撞」，硬做只會在內容變長時碰撞。 */
@media (max-width: 1023px) {
  .synoptic {
    min-height: 0;
  }
  .chart-measure {
    min-height: 0;
    padding-block: 16px;
  }
  .chart-overlay {
    width: auto;
  }
  .forces {
    display: flex;
    gap: 8px;
    padding-block: 14px 0;
  }
  .force {
    position: static;
    flex: 1;
    max-width: none;
    padding: 7px 10px;
    text-align: left;
  }
  .force b {
    font-size: var(--size-small);
  }
  .force span {
    font-size: var(--size-caption);
  }
  /* 手機不疊：讀數接在力場標籤下面，不靠 `margin-top: auto` 推到底 */
  .chart-stations {
    margin-top: 14px;
  }
}
</style>
