<script setup lang="ts">
import type { Viewpoints } from '@suanomics/shared'
import { ref } from 'vue'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible/index.js'

// 兩欄是 thesis-relative 的——support 論證當日主軸成立、risk 挑戰它（見 worker 的
// viewpoints-debate.prompt.ts），不是泛泛的市場多空兩面。
//
// 本區不把 dailyThesis 再印一次：主軸全站只出現一次（首屏那道主鋒面）。它的主詞改由
// **位置**決定——這一條帶就貼在分層 tab 正下方、tab 之上就是那句主軸，所以「這個主軸」
// 指的是上面那句、不需要回引。放在整篇長文之後時主詞會斷掉，那是早期版本留下的問題。
const props = defineProps<{ viewpoints: Viewpoints }>()

// 預設收合：展開的兩欄加淨讀佔 484px（桌機）／868px（手機），而它站在長文之前，於是
// 「捲到真的報告」要 2.8 屏。收合後長文開始從 y=1641／2362 提前到 y=1257／1584
// （桌機／手機、prod 07-31 報告實測）。合規聲明刻意留在收合殼外面——收的是論證、
// 不是那句聲明，而它是報告層唯一的一句（brief.disclaimer 只在佐證層渲染）。
const open = ref(false)
</script>

<template>
  <section class="vp-band" aria-labelledby="vp-title">
    <Collapsible v-model:open="open" class="brief-frame vp-inner">
      <h2 id="vp-title" class="vp-head">
        <CollapsibleTrigger class="vp-trigger" :class="{ open }">
          <span class="vp-chev" aria-hidden="true">▸</span>
          <span class="vp-head-title">本日主軸，正反兩面</span>
          <span class="vp-eyebrow">Two sides of today's front</span>
          <span class="vp-summary">
            {{ open ? '收起' : `${props.viewpoints.supportPoints.length} 支撐 · ${props.viewpoints.riskPoints.length} 挑戰` }}
          </span>
        </CollapsibleTrigger>
      </h2>

      <CollapsibleContent class="vp-body">
        <div class="vp-columns">
          <div class="vp-col vp-support">
            <h3 class="vp-col-title">
              支撐這個主軸
            </h3>
            <ul>
              <li v-for="(point, i) in props.viewpoints.supportPoints" :key="`s${i}`">
                {{ point }}
              </li>
            </ul>
          </div>
          <div class="vp-col vp-risk">
            <h3 class="vp-col-title">
              挑戰這個主軸
            </h3>
            <ul>
              <li v-for="(point, i) in props.viewpoints.riskPoints" :key="`r${i}`">
                {{ point }}
              </li>
            </ul>
          </div>
        </div>
        <div class="vp-netread">
          <span class="vp-netread-label">綜合淨讀</span>
          <p>{{ props.viewpoints.netRead }}</p>
        </div>
      </CollapsibleContent>

      <p class="vp-disclaimer">
        本區為情境分析、非投資建議。
      </p>
    </Collapsible>
  </section>
</template>

<style scoped>
/* 報告層的第一塊，站在跟長文同一張紙上——它是報告內容不是佐證。仍然不做成卡片：
   卡片會把它讀成長文之後的附錄，而它其實是接圖上那道主鋒面的第一句話。與上方的交界
   由分層 tab 的下緣那條線承擔，這裡不再自畫。 */
.vp-band {
  background: var(--surface);
}
.vp-inner {
  padding-block: 22px 26px;
}
.vp-head {
  margin: 0;
}
/* 收合殼沿用長文展開層那一套（BriefSectionDepth）：同一個 ▸ 記號、同一種旋轉。
   整條標題行都是觸發區，不是只有那個小三角。 */
.vp-trigger {
  display: flex;
  align-items: baseline;
  gap: 12px;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.vp-chev {
  font-family: var(--font-num);
  font-size: var(--size-small);
  color: var(--accent);
  transition: transform var(--dur-base) var(--ease-out);
}
.vp-trigger.open .vp-chev {
  transform: rotate(90deg);
}
.vp-head-title {
  font-size: var(--size-body);
  font-weight: 700;
  color: var(--fg-1);
}
.vp-eyebrow {
  font-family: var(--font-num);
  font-size: var(--size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-3);
}
/* 收合時報「裡面有幾條」、展開時變成收起的說明——與 .depth-trigger 同一種換字法 */
.vp-summary {
  margin-left: auto;
  flex-shrink: 0;
  font-size: var(--size-small);
  color: var(--fg-3);
  transition: color var(--dur-base) var(--ease-out);
}
.vp-trigger:hover .vp-summary {
  color: var(--fg-1);
}
.vp-body {
  padding-top: 16px;
}
/* 兩欄之間用一條 hairline 分，不做成兩張底色卡 */
.vp-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.vp-col {
  padding-inline: 26px;
  border-left: 1px solid var(--border);
}
.vp-col:first-child {
  padding-left: 0;
  border-left: 0;
}
.vp-col-title {
  font-size: var(--size-small);
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0 0 10px;
}
/* 支持/風險是對論點的「判定」、不是漲跌方向，所以不跟 --dir-* 走——
   方向 token 依台灣慣例是紅漲綠跌，借用會讓「風險」變成綠色。 */
.vp-support .vp-col-title {
  color: var(--verdict-green);
}
.vp-risk .vp-col-title {
  color: var(--verdict-red);
}
.vp-col ul {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vp-col li {
  font-size: var(--size-small);
  line-height: 1.6;
  color: var(--fg-1);
}
/* 綜合淨讀＝暖鋒：頂線加半圓記號，與主軸的冷鋒三角成對。收合時它跟著收起來——
   成對關係只在展開後看得到，那是收合換頁高的一部分代價。 */
.vp-netread {
  position: relative;
  margin-top: 22px;
  border-top: 2px solid var(--warm);
  padding: 13px 0 0;
}
.vp-netread::before {
  content: '';
  position: absolute;
  top: -9px;
  left: 0;
  width: 48px;
  height: 8px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='8' viewBox='0 0 48 8'%3E%3Cg fill='%23c2402f'%3E%3Cpath d='M5 8 A6 6 0 0 1 17 8 Z'/%3E%3Cpath d='M27 8 A6 6 0 0 1 39 8 Z'/%3E%3C/g%3E%3C/svg%3E")
    no-repeat;
}
.vp-netread-label {
  display: block;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-3);
  margin-bottom: 6px;
}
.vp-netread p {
  margin: 0;
  max-width: 78ch;
  font-size: var(--size-small);
  line-height: 1.75;
  color: var(--fg-1);
}
/* 收合殼外面：收的是論證、不是這句聲明。它是報告層唯一的合規聲明。 */
.vp-disclaimer {
  margin: 12px 0 0;
  font-size: var(--size-caption);
  color: var(--fg-3);
}

@media (max-width: 1023px) {
  .vp-inner {
    padding-block: 18px 20px;
  }
  /* 標題行擠不下三個東西：裝飾性的英文小標讓位給「裡面有幾條」 */
  .vp-eyebrow {
    display: none;
  }
  .vp-columns {
    grid-template-columns: 1fr;
  }
  .vp-col {
    padding-inline: 0;
    border-left: 0;
  }
  .vp-risk {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }
}
</style>
