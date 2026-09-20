#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
// smoke + acceptance harness for PodcastWriter.
// No DB writes. Hand-crafted brief fixture, calls real Gemini, prints results.
// Use:  pnpm --filter server exec tsx --env-file-if-exists=.env tools/cli/_podcast-local-smoke.ts

import type { MarketBrief, Narrative } from '@suanomics/shared'
import process from 'node:process'
import { callPodcastWriter } from '../../src/agents/podcast-writer.js'

const FAKE_NARRATIVE: Narrative = {
  intro: '今日 AI 半導體與地緣政治並進、整體呈現結構性分化。',
  sections: [
    { heading: 'AI 算力與半導體鏈', body: '輝達 GTC 釋出 Blackwell 進度、需求展望保持樂觀；台積電 CoWoS 產能持續擴張、上游設備鏈受惠。', takeaway: null, relatedNewsIds: ['n-nvda', 'n-tsmc'], claimIds: [], citationUrls: ['https://example.com/nvda'] },
    { heading: '地緣政治與能源', body: '中東緊張推升油價、能源股上揚。', takeaway: null, relatedNewsIds: ['n-hormuz'], claimIds: [], citationUrls: ['https://example.com/hormuz'] },
    { heading: '貨幣政策與資金流向', body: 'Fed 點陣圖暗示降息延後、美元指數走強；中國科技股反彈、ETF 資金流入加速。', takeaway: null, relatedNewsIds: ['n-fed', 'n-cn'], claimIds: [], citationUrls: ['https://example.com/fed'] },
  ],
  outro: '科技動能與地緣風險併行、配置上需平衡。',
}

const FAKE_BRIEF: MarketBrief = {
  headline: '科技算力與地緣風險併行，資產配置結構性位移',
  summary: '本日全球市場呈現核心科技動能與地緣政治壓力併行的格局。',
  relatedNews: [],
  affectedIndustries: [],
  relatedETFs: [],
  reasoningChain: ['AI 算力需求 → 上游設備鏈 → 半導體封測'],
  citations: [
    { url: 'https://example.com/nvda', title: '輝達 GTC', quote: 'Blackwell 進度更新' },
    { url: 'https://example.com/tsmc', title: 'TSMC CoWoS', quote: '產能擴張' },
    { url: 'https://example.com/hormuz', title: '中東情勢', quote: '油價上揚' },
    { url: 'https://example.com/fed', title: 'Fed', quote: '降息延後' },
    { url: 'https://example.com/cn', title: '中國科技', quote: '資金流入' },
  ],
  disclaimer: '本分析僅供參考、非投資建議、實際投資請諮詢專業人士',
  narrative: FAKE_NARRATIVE,
  newsTitlesById: {
    'n-nvda': '輝達 GTC',
    'n-tsmc': '台積電 CoWoS',
    'n-hormuz': '中東情勢',
    'n-fed': 'Fed 降息',
    'n-cn': '中國科技',
  },
}

async function main() {
  console.log('[podcast-smoke] calling Gemini...')
  const t0 = Date.now()
  const result = await callPodcastWriter({ briefDate: '2099-01-01', brief: FAKE_BRIEF })
  const elapsed = Date.now() - t0

  if (!result.podcast) {
    console.error(`[podcast-smoke] FAILED in ${elapsed}ms. audit=${JSON.stringify(result.audit)}`)
    process.exit(1)
  }

  const p = result.podcast
  const allowedNewsIds = new Set(Object.keys(FAKE_BRIEF.newsTitlesById ?? {}))
  const coveredNewsIds = new Set(p.acts.flatMap(a => a.relatedNewsIds))
  const missing = [...allowedNewsIds].filter(id => !coveredNewsIds.has(id))

  console.log(`\n=== PASS/FAIL summary (${elapsed}ms) ===`)
  console.log(`P1 totalChars=${p.meta.totalChars} (1800-2800): ${p.meta.totalChars >= 1800 && p.meta.totalChars <= 2800 ? 'PASS' : 'FAIL'}`)
  console.log(`P2 acts=${p.acts.length} (3-5): ${p.acts.length >= 3 && p.acts.length <= 5 ? 'PASS' : 'FAIL'}`)
  console.log(`P3 citation subset enforced (validate parse already passed): PASS`)
  console.log(`P4 forbiddenSanitized=${result.audit.forbiddenSanitized}: ${result.audit.forbiddenSanitized === 0 ? 'PASS' : 'FLAG (LLM emitted forbidden terms; auto-rewritten OK, but worth noting)'}`)
  console.log(`P7 news coverage: ${missing.length === 0 ? 'PASS' : `FAIL missing=${missing.join(',')}`}`)
  console.log('')
  console.log('=== HOOK ===')
  console.log(`headline: ${p.hook.headline}`)
  console.log(`body: ${p.hook.body.slice(0, 150)}...`)
  console.log('=== ACTS ===')
  for (const a of p.acts) {
    console.log(`\n[${a.storyline}] ${a.actTitle}`)
    console.log(`${a.body.slice(0, 200)}...`)
  }
  console.log('\n=== TAKEAWAY ===')
  console.log(`${p.takeaway.body.slice(0, 200)}...`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[podcast-smoke] uncaught:', err)
  process.exit(1)
})
