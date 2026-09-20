import type { Digest } from '../types.js'
import { distillSkillToDigest } from './skill-to-digest.js'

export interface CustomDistillParams {
  sourceSlug: string
  rawContent: string
  localPath: string
}

export async function distillCustomToDigest(params: CustomDistillParams): Promise<Digest> {
  return distillSkillToDigest({
    sourceSlug: params.sourceSlug,
    sourceKind: 'custom-text',
    rawContent: params.rawContent,
    rawSourceRef: { localPath: params.localPath },
  })
}
