#!/usr/bin/env tsx
/* eslint-disable no-console -- worker progress logging, structured logger TBD */
import { resolve } from 'node:path'
import process, { exit } from 'node:process'
import { runCompile } from '@suanomics/prompt-research'
import { Command } from 'commander'

const program = new Command()
program
  .name('prompt-research-compile')
  .description('Compile prompts from distill draft to candidate dir')
  .requiredOption('--run <runId>', 'distill run id (matches dir name in outputs)')
  .option('--outputs-dir <path>', 'distill outputs base dir (relative to apps/server/ CWD)', '.prompt-research-out')
  .option('--candidates-dir <path>', 'candidate output dir (relative to apps/server/ CWD)', '../../packages/prompts/_candidates')
  .action(async (opts: { run: string, outputsDir: string, candidatesDir: string }) => {
    try {
      const candidatesRunDir = resolve(opts.candidatesDir, opts.run)
      const result = await runCompile({
        runId: opts.run,
        outputsDir: resolve(opts.outputsDir),
        promptsDir: candidatesRunDir,
      })
      console.log(JSON.stringify({ runId: result.runId, candidatesDir: candidatesRunDir }, null, 2))
      exit(0)
    }
    catch (err) {
      console.error((err as Error).stack ?? (err as Error).message)
      exit(1)
    }
  })

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.stack ?? err.message)
  exit(1)
})
