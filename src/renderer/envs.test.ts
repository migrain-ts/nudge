import { describe, expect, it, vi } from 'vitest'
import { activeVariables, reducer, type State } from './store'
import { applyRename, createSaver, nextEnvName, RollbackFailed, validateEnvName } from './envs'
import type { Environment, WorkspaceTree } from '../shared/types'

const env = (name: string, v = ''): Environment => ({ name, variables: [{ key: 'baseUrl', value: v || name, enabled: true }] })

describe('validateEnvName', () => {
  const names = ['local', 'prod']
  it('accepts a fresh name', () => expect(validateEnvName('staging', names)).toBeNull())
  it('rejects empty / blank', () => {
    expect(validateEnvName('', names)).toMatch(/empty/)
    expect(validateEnvName('   ', names)).toMatch(/empty/)
  })
  it('rejects duplicates case-insensitively', () => {
    expect(validateEnvName('Local', names)).toMatch(/already exists/)
    expect(validateEnvName(' prod ', names)).toMatch(/already exists/)
  })
  it('rejects names whose file would collapse onto an existing one', () => {
    expect(validateEnvName('a:b', ['a-b'])).toMatch(/already exists/)
    expect(validateEnvName('prod.', names)).toMatch(/already exists/)
  })
  it('rejects names storage guards would refuse', () => {
    expect(validateEnvName('a/b', names)).toMatch(/invalid characters/)
    expect(validateEnvName('..', names)).toMatch(/invalid characters/)
  })
  it('ignores the env being renamed', () => {
    expect(validateEnvName('Local', names, 'local')).toBeNull()
  })
})

describe('nextEnvName', () => {
  it('local, then local 2, local 3…', () => {
    expect(nextEnvName([])).toBe('local')
    expect(nextEnvName(['local'])).toBe('local 2')
    expect(nextEnvName(['Local', 'local 2'])).toBe('local 3')
  })
})

describe('applyRename', () => {
  const mk = () => ({
    saveEnvironment: vi.fn().mockResolvedValue(undefined),
    deleteEnvironment: vi.fn().mockResolvedValue(undefined),
    setActiveEnvironment: vi.fn().mockResolvedValue(undefined)
  })
  it('saves new, deletes old, re-activates when it was active (in order)', async () => {
    const api = mk(); const order: string[] = []
    api.saveEnvironment.mockImplementation(async () => { order.push('save') })
    api.deleteEnvironment.mockImplementation(async () => { order.push('delete') })
    api.setActiveEnvironment.mockImplementation(async () => { order.push('active') })
    await applyRename(api, env('local'), 'dev', 'local')
    expect(order).toEqual(['save', 'delete', 'active'])
    expect(api.saveEnvironment).toHaveBeenCalledWith({ name: 'dev', variables: env('local').variables })
    expect(api.setActiveEnvironment).toHaveBeenCalledWith('dev')
  })
  it('does not touch the active env when another one is active', async () => {
    const api = mk()
    await applyRename(api, env('local'), 'dev', 'prod')
    expect(api.setActiveEnvironment).not.toHaveBeenCalled()
  })
  it('case-only rename deletes first so the new file survives', async () => {
    const api = mk(); const order: string[] = []
    api.saveEnvironment.mockImplementation(async () => { order.push('save') })
    api.deleteEnvironment.mockImplementation(async () => { order.push('delete') })
    await applyRename(api, env('local'), 'Local', null)
    expect(order).toEqual(['delete', 'save'])
  })
  it('propagates a failing step and stops', async () => {
    const api = mk()
    api.saveEnvironment.mockRejectedValue(new Error('boom'))
    await expect(applyRename(api, env('local'), 'dev', 'local')).rejects.toThrow('boom')
    expect(api.deleteEnvironment).not.toHaveBeenCalled()
  })
})

describe('activeVariables after switching', () => {
  const tree = (active: string | null): WorkspaceTree => ({
    name: 'P', folders: [], environments: [env('local', 'http://l'), env('prod', 'http://p')], activeEnvironment: active, warnings: []
  })
  const base: State = { tree: tree('local'), selected: null, draft: null, response: null, sending: false, draftId: 0, unsaved: {} }
  it('follows the refreshed tree', () => {
    expect(activeVariables(base)[0].value).toBe('http://l')
    const s = reducer(base, { type: 'treeRefreshed', tree: tree('prod') })
    expect(activeVariables(s)[0].value).toBe('http://p')
    expect(activeVariables(reducer(s, { type: 'treeRefreshed', tree: tree(null) }))).toEqual([])
  })
})

describe('applyRename rollback', () => {
  const mk = () => ({
    saveEnvironment: vi.fn().mockResolvedValue(undefined),
    deleteEnvironment: vi.fn().mockResolvedValue(undefined),
    setActiveEnvironment: vi.fn().mockResolvedValue(undefined)
  })
  it('re-saves the old env when the save after the delete fails, and surfaces the error', async () => {
    const api = mk()
    api.saveEnvironment.mockRejectedValueOnce(new Error('disk full'))
    await expect(applyRename(api, env('local'), 'Local', 'local')).rejects.toThrow('disk full')
    expect(api.saveEnvironment).toHaveBeenCalledTimes(2)
    expect(api.saveEnvironment).toHaveBeenLastCalledWith(env('local'))
    expect(api.setActiveEnvironment).not.toHaveBeenCalled()
  })
  it('a failing rollback raises RollbackFailed mentioning the variables count', async () => {
    const api = mk()
    api.saveEnvironment.mockRejectedValue(new Error('disk full'))
    const e = await applyRename(api, env('local'), 'Local', null).catch((x) => x)
    expect(e).toBeInstanceOf(RollbackFailed)
    expect(e.message).toMatch(/1 variable/)
    expect(e.message).toMatch(/disk full/)
  })
})

describe('createSaver', () => {
  it('a failed save keeps the pending edit and flags failure', async () => {
    const save = vi.fn().mockRejectedValue(new Error('x'))
    const s = createSaver<string>(save)
    s.set('a')
    expect(await s.flush()).toBe('failed')
    expect(s.pending).toBe('a')
    expect(s.failed).toBe(true)
  })
  it('retry success clears pending and the failure flag', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined)
    const s = createSaver<string>(save)
    s.set('a')
    await s.flush()
    expect(await s.flush()).toBe('ok')
    expect(s.pending).toBeNull()
    expect(s.failed).toBe(false)
    expect(save).toHaveBeenCalledTimes(2)
  })
  it('a newer edit made while a save fails is kept (not overwritten by the old one)', async () => {
    let rej!: (e: Error) => void
    const save = vi.fn().mockImplementationOnce(() => new Promise((_, r) => { rej = r })).mockResolvedValue(undefined)
    const s = createSaver<string>(save)
    s.set('a')
    const f = s.flush()
    await new Promise((r) => setTimeout(r, 0))
    s.set('b')
    rej(new Error('x'))
    expect(await f).toBe('failed')
    expect(s.pending).toBe('b')
    expect(await s.flush()).toBe('ok')
    expect(save).toHaveBeenLastCalledWith('b')
  })
  it('an edit made during a successful save is saved too', async () => {
    let done!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { done = r })).mockResolvedValue(undefined)
    const s = createSaver<string>(save)
    s.set('a')
    const f = s.flush()
    await new Promise((r) => setTimeout(r, 0))
    s.set('b')
    done()
    expect(await f).toBe('ok')
    expect(save).toHaveBeenLastCalledWith('b')
    expect(s.pending).toBeNull()
  })
  it('discard drops pending and the failure', async () => {
    const s = createSaver<string>(vi.fn().mockRejectedValue(new Error('x')))
    s.set('a')
    await s.flush()
    s.discard()
    expect(s.pending).toBeNull()
    expect(s.failed).toBe(false)
    expect(await s.flush()).toBe('ok')
  })
  it('guarded refuses to run the operation while the save keeps failing, runs it after retry/discard', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined)
    const s = createSaver<string>(save)
    const op = vi.fn().mockResolvedValue(undefined)
    s.set('a')
    expect(await s.guarded(op)).toBe('blocked')
    expect(op).not.toHaveBeenCalled()
    expect(await s.guarded(op)).toBe('done')
    expect(op).toHaveBeenCalledTimes(1)
    const s2 = createSaver<string>(vi.fn().mockRejectedValue(new Error('x')))
    s2.set('a')
    expect(await s2.guarded(op)).toBe('blocked')
    s2.discard()
    expect(await s2.guarded(op)).toBe('done')
  })
})
