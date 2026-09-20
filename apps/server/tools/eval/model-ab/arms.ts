// 臂的規劃與「同臂雜訊 vs 跨臂差異」的判讀。
//
// 這個模組是整個工具存在的理由。2026-08-02 的 model A/B 實驗第一輪用單跑資料
// 判出「flash 勝 10」；加上同臂雙跑對照組後發現，同一個 model 跑第二次犯了跟
// 對照 model 一模一樣的「錯」，改用「兩跑都一致的分歧」重判變成 11:11 打平——
// 方向完全相反。所以：
//
//   1. planArms 預設就是雙跑，不是要記得加的旗標；
//   2. 缺同臂對照組時 assessSignal 回 no-baseline，報表不准印跨臂結論。
//

export type ArmId = 'A' | 'B'

/** 同臂雙跑是預設：低於這個數字就量不出雜訊底線、跨臂差異無從判讀。 */
export const DEFAULT_REPLICATES = 2

/**
 * 同臂一致率低於此值 ＝ 模型自身抖動已經淹沒可比性，這條路徑量不出 model 差異。
 * 取 0.5 的依據：實驗二的 news-tagger 同臂 tag Jaccard 只有 26.7%（flash 自己跟自己），
 * 而 entity-summary 是 63–70%、跨臂 48–52% 仍可判讀。
 */
export const UNSTABLE_BASELINE_MAX = 0.5

export interface ArmPlanEntry {
  label: string
  arm: ArmId
  replicate: number
  model: string
}

/** 每臂各 replicates 個 label，A 臂在前：A1,A2,B1,B2。 */
export function armLabels(replicates: number = DEFAULT_REPLICATES): string[] {
  if (!Number.isInteger(replicates) || replicates < 1)
    throw new Error(`replicates 必須是 >= 1 的整數、收到 ${replicates}`)
  return (['A', 'B'] as ArmId[]).flatMap(arm =>
    Array.from({ length: replicates }, (_, i) => `${arm}${i + 1}`),
  )
}

export function planArms(o: { modelA: string, modelB: string, replicates?: number }): ArmPlanEntry[] {
  const model: Record<ArmId, string> = { A: o.modelA, B: o.modelB }
  return armLabels(o.replicates).map((label) => {
    const { arm, replicate } = parseLabel(label)
    return { label, arm: arm as ArmId, replicate, model: model[arm as ArmId] }
  })
}

export function parseLabel(label: string): { arm: string, replicate: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(label)
  if (!m?.[1] || !m[2])
    throw new Error(`label 格式錯誤（需 <臂><第幾跑>、如 A1）：${label}`)
  return { arm: m[1], replicate: Number(m[2]) }
}

export type PairKind = 'within' | 'cross'

export function pairKind(refLabel: string, candLabel: string): PairKind {
  return parseLabel(refLabel).arm === parseLabel(candLabel).arm ? 'within' : 'cross'
}

export interface LabelPair { ref: string, cand: string, kind: PairKind }

/**
 * 所有兩兩配對，**同臂配對一律排在跨臂之前**——報表照這個順序印，
 * 讀的人先看到雜訊底線、才看到跨臂數字。
 */
export function labelPairs(labels: readonly string[]): LabelPair[] {
  const all: LabelPair[] = []
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const ref = labels[i]
      const cand = labels[j]
      if (ref && cand)
        all.push({ ref, cand, kind: pairKind(ref, cand) })
    }
  }
  return [...all.filter(p => p.kind === 'within'), ...all.filter(p => p.kind === 'cross')]
}

export type SignalVerdict = 'no-baseline' | 'unstable-baseline' | 'within-noise' | 'exceeds-noise'

export interface SignalAssessment {
  verdict: SignalVerdict
  /** 逐臂的同臂一致率（該臂所有同臂配對的平均） */
  withinArm: { arm: string, agreement: number }[]
  /** 雜訊底線＝兩臂較低的那個（保守） */
  withinArmFloor: number | null
  crossArmMean: number | null
  reason: string
}

export interface AgreementPair extends LabelPair { agreement: number }

/**
 * 跨臂差異要跟同臂雜訊比才算數。
 *
 * 判定順序（任一條成立就停在那裡）：
 *   no-baseline       任一臂沒有同臂配對、或完全沒有跨臂配對 → 不得下結論
 *   unstable-baseline 雜訊底線本身低於 UNSTABLE_BASELINE_MAX → 這條路徑量不出 model 差異
 *   exceeds-noise     跨臂一致率低於雜訊底線 → 兩個 model 不是同一回事
 *   within-noise      否則 → 差異落在模型自身抖動裡
 *
 * 注意 exceeds-noise **不等於哪一臂比較好**：重疊率只量一致性、不判對錯
 * （兩臂都抽錯同一個實體，重疊率照樣 100%），一定要回去讀原文做質性抽查。
 */
/**
 * 哪些臂沒有同臂對照組（該臂只跑了一次）。
 *
 * **這是 structured 與 prose 兩條路徑共用的那道閘門**——兩邊都拿它決定「能不能給
 * 使用者一個看起來可以下結論的輸出」，不要各自再寫一份判斷。
 */
export function armsWithoutBaseline(labels: readonly string[]): string[] {
  const count = new Map<string, number>()
  for (const l of labels) {
    const { arm } = parseLabel(l)
    count.set(arm, (count.get(arm) ?? 0) + 1)
  }
  return [...count.entries()].filter(([, n]) => n < 2).map(([a]) => a).sort()
}

export function hasNoiseBaseline(labels: readonly string[]): boolean {
  return labels.length > 0 && armsWithoutBaseline(labels).length === 0
}

export function assessSignal(pairs: readonly AgreementPair[]): SignalAssessment {
  const byArm = new Map<string, number[]>()
  for (const p of pairs.filter(x => x.kind === 'within')) {
    const arm = parseLabel(p.ref).arm
    byArm.set(arm, [...(byArm.get(arm) ?? []), p.agreement])
  }
  const crossPairs = pairs.filter(p => p.kind === 'cross')
  const withinArm = [...byArm.entries()]
    .map(([arm, xs]) => ({ arm, agreement: xs.reduce((a, b) => a + b, 0) / xs.length }))
    .sort((a, b) => a.arm.localeCompare(b.arm))
  const crossArmMean = crossPairs.length
    ? crossPairs.reduce((a, b) => a + b.agreement, 0) / crossPairs.length
    : null
  const floor = withinArm.length ? Math.min(...withinArm.map(w => w.agreement)) : null

  const labels = [...new Set(pairs.flatMap(p => [p.ref, p.cand]))]
  const bare = armsWithoutBaseline(labels)
  if (bare.length) {
    return {
      verdict: 'no-baseline',
      withinArm,
      withinArmFloor: floor,
      crossArmMean,
      reason: `臂 ${bare.join('/')} 只跑了一次、量不到自身抖動；跨臂數字不可判讀`,
    }
  }
  if (crossArmMean === null || floor === null) {
    return {
      verdict: 'no-baseline',
      withinArm,
      withinArmFloor: floor,
      crossArmMean,
      reason: '沒有跨臂配對（只跑了一個 model）',
    }
  }
  if (floor < UNSTABLE_BASELINE_MAX) {
    return {
      verdict: 'unstable-baseline',
      withinArm,
      withinArmFloor: floor,
      crossArmMean,
      reason: `同臂一致率僅 ${(floor * 100).toFixed(1)}%、模型自身抖動已淹沒兩臂差距；這條路徑量不出 model 差異`,
    }
  }
  if (crossArmMean < floor) {
    return {
      verdict: 'exceeds-noise',
      withinArm,
      withinArmFloor: floor,
      crossArmMean,
      reason: `跨臂 ${(crossArmMean * 100).toFixed(1)}% < 雜訊底線 ${(floor * 100).toFixed(1)}%；兩個 model 不是同一回事，但誰對誰錯要回去讀原文`,
    }
  }
  return {
    verdict: 'within-noise',
    withinArm,
    withinArmFloor: floor,
    crossArmMean,
    reason: `跨臂 ${(crossArmMean * 100).toFixed(1)}% >= 雜訊底線 ${(floor * 100).toFixed(1)}%；差異落在模型自身抖動裡`,
  }
}
