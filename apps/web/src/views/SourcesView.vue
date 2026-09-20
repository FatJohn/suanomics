<script setup lang="ts">
import AppBackLink from '@/components/layout/AppBackLink.vue'
import { MONITORED_SOURCE_GROUPS, TOTAL_MONITORED_SOURCES } from '@/lib/monitored-sources.js'
</script>

<template>
  <main class="sources-page">
    <div class="sources-frame">
      <header class="sources-head">
        <AppBackLink>
          回今日報告
        </AppBackLink>
        <p class="sources-kicker">
          監測來源
        </p>
        <!-- 標題不講頻率：抓取節奏是每兩天一次（見下方說明），寫「每天」會跟自己打架。 -->
        <h1 class="sources-title">
          我們監測的 {{ TOTAL_MONITORED_SOURCES }} 個頻道
        </h1>
        <!-- 中文句子不要在標籤裡換行：HTML 會把換行摺成一個**看得見的空格**，即使斷在
             「。」之後也一樣（實測 3.81px、不在行尾）。整句寫成一行，長就長。 -->
        <p class="sources-lede">
          這一頁是<b>覆蓋面</b>——我們持續監測的新聞與官方發布頻道。某一天的報告實際引用了哪些來源是另一回事，寫在那天報告的「佐證與來源」層。
        </p>
      </header>

      <section
        v-for="group in MONITORED_SOURCE_GROUPS"
        :key="group.label"
        class="source-group"
      >
        <h2 class="group-label">
          {{ group.label }}
        </h2>
        <div class="source-chips">
          <span
            v-for="src in group.sources"
            :key="src.name"
            class="source-chip"
            :class="{ 'source-chip--official': src.official }"
          >{{ src.name }}<template v-if="src.viaAggregator"><sup class="chip-mark" aria-hidden="true">*</sup><span class="sr-only">（經 Google News 聚合取得）</span></template></span>
        </div>
      </section>

      <section class="sources-notes">
        <p>
          <b>底色較深的是官方機構</b>：交易所、央行、金管會、Fed 這些發布者本身，不是報導它們的媒體。
        </p>
        <p>
          <b>標了 <sup class="chip-mark">*</sup> 的是經 Google News 聚合取得</b>，不是直連該機構或媒體自己的 feed。這兩件事互不衝突——官方機構也可能是透過聚合器抓到的（IEA 就是）。
        </p>
        <p>
          清單每兩天重新抓取一次；抓進來的內容進入語料庫，供每日報告的連動分析與引用佐證使用。
        </p>
      </section>
    </div>
  </main>
</template>

<style scoped>
/* 走讀者面同一個寬度（--measure-frame、見 main.css）。它是從 footer 進來的一頁，
   收在別的量度上會讓 header／footer 與內容各走一條邊界——那正是後來收掉的東西。 */
.sources-page {
  flex: 1;
  width: 100%;
  background: var(--surface);
}

.sources-frame {
  max-width: var(--measure-frame);
  margin: 0 auto;
  padding: 32px var(--frame-pad) 64px;
}

.sources-head {
  margin-bottom: 36px;
}

.sources-kicker {
  margin: 20px 0 0;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--warm);
}

/* 32 是級數表的 page-title。字重走 700（結論與小標）不走 900——900 是首屏警報大標專用。 */
.sources-title {
  margin: 8px 0 0;
  font-size: var(--size-display);
  line-height: 1.25;
  font-weight: 700;
  color: var(--fg-1);
}

/* 散文一律鎖 58ch（17px 下 ＝ 548），即使外框比它寬 */
.sources-lede {
  max-width: 548px;
  margin: 16px 0 0;
  font-size: var(--size-body-lg);
  line-height: 1.85;
  color: var(--fg-2);
}

.source-group {
  padding: 18px 0;
  border-top: 1px solid var(--border-2);
}

.group-label {
  margin: 0 0 12px;
  font-size: var(--size-small);
  font-weight: 700;
  color: var(--fg-2);
}

.source-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.source-chip {
  display: inline-block;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-size: var(--size-small);
  color: var(--fg-2);
  background: transparent;
  line-height: 1.8;
  white-space: nowrap;
}

.source-chip--official {
  background: var(--bg-2);
  color: var(--fg-1);
}

/* 聚合器標記。用星號而不是另一個色票：這一頁已經有一個語意色（official 的底色），
   第二個維度再吃一個顏色就要圖例，而「圖不需要圖例」那條規則的精神在這裡一樣成立。 */
.chip-mark {
  margin-left: 1px;
  font-size: var(--size-caption);
  color: var(--fg-3);
}

.sources-notes {
  max-width: 548px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-2);
}

.sources-notes p {
  margin: 0 0 12px;
  font-size: var(--size-body);
  line-height: 1.8;
  color: var(--fg-3);
}

.sources-notes b {
  color: var(--fg-2);
}

@media (max-width: 719px) {
  .sources-frame {
    padding: 24px var(--frame-pad) 48px;
  }
  .sources-head {
    margin-bottom: 28px;
  }
}
</style>
