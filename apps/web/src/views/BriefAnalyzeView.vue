<script setup lang="ts">
import type { Stage } from '@/composables/useAnalyzeJob.js'
import { Icon } from '@iconify/vue'
import { computed, ref } from 'vue'
import BriefAnalysisPanel from '@/components/brief/BriefAnalysisPanel.vue'
import { useAnalyzeJob } from '@/composables/useAnalyzeJob.js'

const job = useAnalyzeJob()
const title = ref('')
const content = ref('')
const url = ref('')

const TITLE_MIN = 3
const TITLE_MAX = 300
const CONTENT_MIN = 20
const CONTENT_MAX = 10000

const STAGE_LABEL: Record<Stage, string> = {
  routing: '判定分析模式…',
  retrieving: '拉取相關資料…',
  analyzing: '分析跨產業影響…',
  saving: '整理結果…',
}

const isPending = computed(
  () => job.status.value === 'submitting' || job.status.value === 'polling',
)

const canSubmit = computed(() => {
  const t = title.value.trim()
  const c = content.value.trim()
  return t.length >= TITLE_MIN && t.length <= TITLE_MAX
    && c.length >= CONTENT_MIN && c.length <= CONTENT_MAX
    && !isPending.value
})

async function submit() {
  if (!canSubmit.value)
    return
  const trimmedUrl = url.value.trim()
  await job.start({
    title: title.value.trim(),
    content: content.value.trim(),
    ...(trimmedUrl ? { url: trimmedUrl } : {}),
  })
}
</script>

<template>
  <main class="page-ground">
    <div class="app-shell brief-analyze">
      <header class="page-head">
        <div class="page-eyebrow">
          掐指連總經 · 即時分析
        </div>
        <h1>貼新聞即時分析</h1>
        <p class="page-head-sub">
          貼上一條財經新聞、AI 幫你分析產業連動與相關 ETF。非投資建議。
        </p>
      </header>

      <form class="analyze-form" @submit.prevent="submit">
        <label class="form-field">
          <span class="form-label">標題</span>
          <input
            v-model="title"
            class="form-input"
            type="text"
            :maxlength="TITLE_MAX"
            placeholder="例：台積電 Q1 財報優於預期"
          >
        </label>
        <label class="form-field">
          <span class="form-label">來源 URL<span class="form-optional">（可選）</span></span>
          <input
            v-model="url"
            class="form-input"
            type="url"
            placeholder="https://..."
          >
        </label>
        <label class="form-field">
          <span class="form-label">內文</span>
          <textarea
            v-model="content"
            class="form-textarea"
            rows="8"
            :maxlength="CONTENT_MAX"
            placeholder="貼上新聞內文、至少 20 字…"
          />
          <span class="form-hint">{{ content.trim().length }} / {{ CONTENT_MAX }} 字</span>
        </label>
        <button
          type="submit"
          class="analyze-submit"
          :disabled="!canSubmit"
        >
          {{ isPending ? '分析中…' : '分析' }}
        </button>
      </form>

      <section v-if="isPending" class="job-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${job.percent.value}%` }" />
        </div>
        <p class="progress-stage">
          {{ job.stage.value ? STAGE_LABEL[job.stage.value] : '送出中…' }}
        </p>
        <p v-if="job.routingMode.value === 'cache-hit'" class="progress-cache">
          <Icon icon="lucide:zap" :width="14" :height="14" /> 從快取讀取
        </p>
        <button type="button" class="cancel-btn" @click="job.cancel">
          取消
        </button>
      </section>

      <section v-if="job.error.value" class="error-banner" role="alert">
        <strong>{{
          job.error.value.kind === 'timeout'
            ? '等候逾時'
            : job.error.value.kind === 'cancelled'
              ? '已取消'
              : '分析失敗'
        }}</strong>
        <span>：{{ job.error.value.message }}</span>
        <button
          v-if="job.error.value.kind !== 'cancelled'"
          type="button"
          class="retry-btn"
          @click="submit"
        >
          重試
        </button>
      </section>

      <section v-if="job.result.value" class="paste-result">
        <BriefAnalysisPanel :analysis="job.result.value" />
        <p v-if="job.routingMode.value === 'cache-hit'" class="result-cache-note">
          <Icon icon="lucide:zap" :width="14" :height="14" /> 此結果來自 24h 內的快取
        </p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.brief-analyze {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px 72px;
}
.brief-analyze h1 {
  margin: 0;
  font-size: var(--size-display);
  font-weight: 900;
  letter-spacing: -0.01em;
}
.page-head-sub {
  margin: 0.35rem 0 0 0;
  color: var(--fg-3);
  font-size: var(--size-body);
}
.analyze-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1.25rem;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.form-label {
  font-size: var(--size-small);
  font-weight: 600;
  color: var(--fg-1);
}
.form-optional {
  margin-left: 0.4rem;
  color: var(--fg-3);
  font-weight: 400;
  font-size: var(--size-small);
}
.form-input,
.form-textarea {
  padding: 11px 14px;
  border: 1px solid var(--border);
  background: var(--surface);
  font: inherit;
  color: var(--fg-1);
  resize: vertical;
}
.form-textarea {
  min-height: 180px;
}
.form-input:focus-visible,
.form-textarea:focus-visible {
  outline: 2px solid var(--warm);
  outline-offset: -1px;
}
.form-hint {
  align-self: flex-end;
  font-size: var(--size-caption);
  color: var(--fg-3);
}
.analyze-submit {
  align-self: flex-start;
  padding: 11px 22px;
  border: 0;
  background: var(--warm);
  color: #fff;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: opacity var(--dur-base) var(--ease-out);
}
.analyze-submit:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.job-progress {
  margin: 20px 0;
  padding: 16px;
  border: 1px solid var(--border);
  background: var(--surface);
}
.progress-bar {
  height: 3px;
  background: var(--border-2);
  overflow: hidden;
  margin-bottom: 10px;
}
.progress-fill {
  height: 100%;
  background: var(--warm);
  transition: width 0.3s ease;
}
.progress-stage {
  margin: 0;
  font-size: var(--size-small);
  color: var(--fg-1);
}
.progress-cache {
  margin: 0.4rem 0 0 0;
  font-size: var(--size-small);
  color: var(--verdict-amber-fg);
}
.cancel-btn {
  margin-top: 0.6rem;
  padding: 0.4rem 0.9rem;
  background: transparent;
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: var(--size-small);
}

.error-banner {
  margin: 1rem 0;
  padding: 0.8rem 1rem;
  background: var(--verdict-red-bg);
  border: 1px solid var(--verdict-red-border);
  color: var(--verdict-red-fg);
  font-size: var(--size-body);
}
.retry-btn {
  margin-left: 0.6rem;
  padding: 0.3rem 0.8rem;
  background: var(--verdict-red-fg);
  color: #fff;
  border: 0;
  cursor: pointer;
  font-size: var(--size-small);
}

.paste-result {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border);
}
.result-cache-note {
  margin-top: 0.6rem;
  font-size: var(--size-small);
  color: var(--fg-3);
}
</style>
