import { safeFileName } from '../shared/filename'
import type { Api } from '../shared/api'
import type { Environment } from '../shared/types'

const fileKey = (name: string) => safeFileName(name, []).toLowerCase()

/** Error message or null. `self` is the env being renamed (excluded from collision checks). */
export function validateEnvName(name: string, existing: string[], self?: string): string | null {
  const n = name.trim()
  if (n === '') return 'The name cannot be empty.'
  if (n === '.' || n === '..' || /[\\/]/.test(n) || n.includes('\0')) return 'This name contains invalid characters.'
  const clash = existing.some((e) => e !== self && (e.toLowerCase() === n.toLowerCase() || fileKey(e) === fileKey(n)))
  return clash ? 'An environment with this name already exists.' : null
}

export function nextEnvName(existing: string[]): string {
  const taken = new Set(existing.map((e) => e.toLowerCase()))
  let name = 'local'
  for (let i = 2; taken.has(name); i++) name = `local ${i}`
  return name
}

export class RollbackFailed extends Error {}

/** Holds the latest unsaved edit. A failed save keeps it (unless a newer edit replaced it) so nothing is lost silently. */
export function createSaver<P>(save: (p: P) => Promise<void>) {
  let pending: P | null = null
  let failed = false
  let chain: Promise<unknown> = Promise.resolve()
  const run = (): Promise<'ok' | 'failed'> => {
    const r = chain.then(async (): Promise<'ok' | 'failed'> => {
      for (;;) {
        const p = pending
        if (p === null) return 'ok'
        try { await save(p) } catch { failed = true; return 'failed' }
        if (pending === p) { pending = null; failed = false; return 'ok' }
      }
    })
    chain = r
    return r
  }
  return {
    set(p: P) { pending = p },
    flush: run,
    discard() { pending = null; failed = false },
    get pending() { return pending },
    get failed() { return failed },
    /** run `op` only once the pending edit is safely saved */
    async guarded(op: () => Promise<void>): Promise<'done' | 'blocked'> {
      if ((await run()) === 'failed') return 'blocked'
      await op()
      return 'done'
    }
  }
}

/** Rename = save(new) -> delete(old) -> re-activate. A case-only rename shares one file, so delete goes first. */
export async function applyRename(
  api: Pick<Api, 'saveEnvironment' | 'deleteEnvironment' | 'setActiveEnvironment'>,
  env: Environment, newName: string, active: string | null
): Promise<void> {
  const renamed: Environment = { name: newName, variables: env.variables }
  if (fileKey(env.name) === fileKey(newName)) {
    await api.deleteEnvironment(env.name)
    try {
      await api.saveEnvironment(renamed)
    } catch (e) {
      // the old file is gone: put it back so the env is not lost
      try {
        await api.saveEnvironment(env)
      } catch {
        const n = env.variables.length
        throw new RollbackFailed(`Rename and restore failed: environment “${env.name}” (${n} variable${n > 1 ? 's' : ''}) is no longer on disk. Copy its values before closing. (${apiMessage(e)})`)
      }
      throw e
    }
  } else {
    await api.saveEnvironment(renamed)
    await api.deleteEnvironment(env.name)
  }
  if (active === env.name) await api.setActiveEnvironment(newName)
}

export const apiMessage = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e)
