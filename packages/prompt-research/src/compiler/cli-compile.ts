import type { CompiledPrompts } from './compiler.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MergedDraftSchema } from '../types.js'
import {

  compilePrompts,
  renderHeaderForAgentFile,
  renderSystemTsFile,
} from './compiler.js'

export interface RunCompileParams {
  runId: string
  outputsDir: string // apps/server/.prompt-research-out
  promptsDir: string // packages/prompts/_candidates/<runId>
}

export interface RunCompileResult {
  runId: string
  compiled: CompiledPrompts
  promptsDir: string
  writtenPaths: string[]
}

export async function runCompile(p: RunCompileParams): Promise<RunCompileResult> {
  const draftPath = resolve(p.outputsDir, p.runId, 'merged-analyzer-prompt-draft.json')
  const draftRaw = await readFile(draftPath, 'utf-8')
  const draft = MergedDraftSchema.parse(JSON.parse(draftRaw))

  const compiled = compilePrompts({ draft, runId: p.runId })

  const generatedAt = new Date().toISOString()
  const sources = draft.sources.map((s) => {
    const ref = draft.rawSourceRefs.find(r => r.sourceSlug === s.slug)
    const result: { slug: string, refUrl?: string } = { slug: s.slug }
    if (ref?.ref.url)
      result.refUrl = ref.ref.url
    return result
  })
  const header = renderHeaderForAgentFile({ runId: p.runId, sources, generatedAt })

  await mkdir(p.promptsDir, { recursive: true })

  const writtenPaths: string[] = []

  // _shared: no imports (it IS the shared preamble)
  const sharedPath = resolve(p.promptsDir, '_shared.system.ts')
  await writeFile(
    sharedPath,
    renderSystemTsFile({ exportName: 'SHARED_PREAMBLE', promptBody: compiled.shared, header }),
    'utf-8',
  )
  writtenPaths.push(sharedPath)

  // 3 agents all import SHARED_PREAMBLE
  const agentImports = ['{ SHARED_PREAMBLE } from \'./_shared.system.js\'']

  const decomposerPath = resolve(p.promptsDir, 'decomposer.system.ts')
  await writeFile(
    decomposerPath,
    renderSystemTsFile({
      exportName: 'DECOMPOSER_SYSTEM_PROMPT',
      promptBody: compiled.decomposer,
      header,
      imports: agentImports,
    }),
    'utf-8',
  )
  writtenPaths.push(decomposerPath)

  const analystPath = resolve(p.promptsDir, 'analyst.system.ts')
  await writeFile(
    analystPath,
    renderSystemTsFile({
      exportName: 'ANALYST_SYSTEM_PROMPT',
      promptBody: compiled.analyst,
      header,
      imports: agentImports,
    }),
    'utf-8',
  )
  writtenPaths.push(analystPath)

  const synthesizerPath = resolve(p.promptsDir, 'synthesizer.system.ts')
  await writeFile(
    synthesizerPath,
    renderSystemTsFile({
      exportName: 'SYNTHESIZER_SYSTEM_PROMPT',
      promptBody: compiled.synthesizer,
      header,
      imports: agentImports,
    }),
    'utf-8',
  )
  writtenPaths.push(synthesizerPath)

  return { runId: p.runId, compiled, promptsDir: p.promptsDir, writtenPaths }
}
