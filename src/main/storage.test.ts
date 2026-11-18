import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createWorkspace, loadWorkspace, createFolder, renameFolder, deleteFolder,
  createRequest, saveRequest, renameRequest, deleteRequest, moveRequest, moveFolder,
  saveEnvironment, deleteEnvironment, setActiveEnvironment, openProject, normalizeRequest
} from './storage'
import type { RequestDoc } from '../shared/types'

const doc = (name: string): RequestDoc => ({
  name, method: 'GET', url: 'http://x', params: [], headers: [], bodyType: 'none', body: ''
})

let parent: string
let root: string
beforeEach(async () => {
  parent = await fs.mkdtemp(path.join(os.tmpdir(), 'rq-'))
  root = await createWorkspace(parent, 'p')
})
afterEach(() => fs.rm(parent, { recursive: true, force: true }))

describe('storage', () => {
  it('loads an empty workspace', async () => {
    const t = await loadWorkspace(root)
    expect(t.name).toBe('p')
    expect(t.folders).toEqual([])
    expect(t.warnings).toEqual([])
    expect(t.activeEnvironment).toBeNull()
  })

  it('keeps request order after reload', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('b'))
    await createRequest(root, d, doc('a'))
    const t = await loadWorkspace(root)
    expect(t.folders[0].dir).toBe('f')
    expect(t.folders[0].requests.map((r) => r.doc.name)).toEqual(['b', 'a'])
  })

  it('moves a request across folders at index 0, resolving name clash', async () => {
    const f1 = await createFolder(root, 'f1')
    const f2 = await createFolder(root, 'f2')
    await createRequest(root, f2, doc('other'))
    await createRequest(root, f2, doc('x'))
    const file = await createRequest(root, f1, doc('x'))
    const nf = await moveRequest(root, { dir: f1, file }, { dir: f2, index: 0 })
    expect(nf).toBe('x 2.json')
    await expect(fs.access(path.join(root, f1, file))).rejects.toBeTruthy()
    await fs.access(path.join(root, f2, 'x 2.json'))
    const t = await loadWorkspace(root)
    expect(t.folders[0].requests).toEqual([])
    expect(t.folders[1].requests.map((r) => r.file)).toEqual(['x 2.json', 'other.json', 'x.json'])
  })

  it('renames a request file and doc.name', async () => {
    const d = await createFolder(root, 'f')
    const file = await createRequest(root, d, doc('old'))
    const nf = await renameRequest(root, d, file, 'new')
    expect(nf).toBe('new.json')
    const t = await loadWorkspace(root)
    expect(t.folders[0].requests).toHaveLength(1)
    expect(t.folders[0].requests[0].doc.name).toBe('new')
  })

  it('saves, deletes requests and folders; renames and moves folders', async () => {
    const d = await createFolder(root, 'f')
    const file = await createRequest(root, d, doc('r'))
    await saveRequest(root, d, file, { ...doc('r'), url: 'http://y' })
    expect((await loadWorkspace(root)).folders[0].requests[0].doc.url).toBe('http://y')
    await deleteRequest(root, d, file)
    expect((await loadWorkspace(root)).folders[0].requests).toEqual([])
    const g = await createFolder(root, 'g')
    await moveFolder(root, g, 0)
    expect((await loadWorkspace(root)).folders.map((f) => f.dir)).toEqual(['g', 'f'])
    const h = await renameFolder(root, 'g', 'h')
    expect(h).toBe('h')
    expect((await loadWorkspace(root)).folders.map((f) => f.dir)).toEqual(['h', 'f'])
    await deleteFolder(root, 'h')
    await expect(fs.access(path.join(root, 'h'))).rejects.toBeTruthy()
    expect((await loadWorkspace(root)).folders.map((f) => f.dir)).toEqual(['f'])
  })

  it('skips corrupt JSON with a warning containing the path', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('ok'))
    const bad = path.join(root, d, 'bad.json')
    await fs.writeFile(bad, '{ not json')
    const t = await loadWorkspace(root)
    expect(t.folders[0].requests.map((r) => r.file)).toEqual(['ok.json'])
    expect(t.warnings.some((w) => w.includes(bad))).toBe(true)
  })

  it('appends files missing from the index at the end; drops stale entries', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('a'))
    await fs.writeFile(path.join(root, d, 'z.json'), JSON.stringify(doc('z')))
    const ws = path.join(root, 'workspace.json')
    const idx = JSON.parse(await fs.readFile(ws, 'utf8'))
    idx.requestOrder.f.push('ghost.json')
    await fs.writeFile(ws, JSON.stringify(idx))
    const t = await loadWorkspace(root)
    expect(t.folders[0].requests.map((r) => r.file)).toEqual(['a.json', 'z.json'])
  })

  it('handles environments and active environment', async () => {
    await saveEnvironment(root, { name: 'dev', variables: [{ key: 'a', value: '1', enabled: true }] })
    await setActiveEnvironment(root, 'dev')
    let t = await loadWorkspace(root)
    expect(t.environments.map((e) => e.name)).toEqual(['dev'])
    expect(t.activeEnvironment).toBe('dev')
    await deleteEnvironment(root, 'dev')
    t = await loadWorkspace(root)
    expect(t.environments).toEqual([])
    expect(t.activeEnvironment).toBeNull()
  })

  it('rejects path traversal', async () => {
    await expect(deleteFolder(root, '..')).rejects.toThrow()
    await expect(createRequest(root, '../x', doc('a'))).rejects.toThrow()
    await expect(deleteRequest(root, 'f', '../workspace.json')).rejects.toThrow()
    await expect(deleteEnvironment(root, 'a/b')).rejects.toThrow()
  })

  it('rejects reserved and dot folder names on every dir argument', async () => {
    const d = await createFolder(root, 'f')
    const file = await createRequest(root, d, doc('a'))
    for (const bad of ['environments', 'Environments', 'workspace.json', '.git']) {
      await expect(deleteFolder(root, bad)).rejects.toThrow()
      await expect(renameFolder(root, bad, 'z')).rejects.toThrow()
      await expect(moveFolder(root, bad, 0)).rejects.toThrow()
      await expect(createRequest(root, bad, doc('a'))).rejects.toThrow()
      await expect(deleteRequest(root, bad, 'a.json')).rejects.toThrow()
      await expect(moveRequest(root, { dir: bad, file: 'a.json' }, { dir: d, index: 0 })).rejects.toThrow()
      await expect(moveRequest(root, { dir: d, file }, { dir: bad, index: 0 })).rejects.toThrow()
    }
    await fs.access(path.join(root, 'workspace.json'))
  })

  it('traversal in moveRequest, renameFolder, moveFolder', async () => {
    const d = await createFolder(root, 'f')
    const file = await createRequest(root, d, doc('a'))
    await expect(moveRequest(root, { dir: '..', file }, { dir: d, index: 0 })).rejects.toThrow()
    await expect(moveRequest(root, { dir: d, file }, { dir: '../x', index: 0 })).rejects.toThrow()
    await expect(renameFolder(root, '../f', 'z')).rejects.toThrow()
    await expect(moveFolder(root, 'a/b', 0)).rejects.toThrow()
  })

  it('createFolder/renameFolder never produce reserved names', async () => {
    const a = await createFolder(root, 'environments')
    expect(a.toLowerCase()).not.toBe('environments')
    const b = await createFolder(root, '.hidden')
    expect(b.startsWith('.')).toBe(false)
    const c = await createFolder(root, 'workspace.json')
    expect(c).not.toBe('workspace.json')
    const r = await renameFolder(root, a, 'ENVIRONMENTS')
    expect(r.toLowerCase()).not.toBe('environments')
    const r2 = await renameFolder(root, b, '..x')
    expect(r2.startsWith('.')).toBe(false)
  })

  it('saveRequest never creates a missing file', async () => {
    const d = await createFolder(root, 'f')
    await expect(saveRequest(root, d, 'ghost.json', doc('g'))).rejects.toThrow('request-missing')
    await expect(fs.access(path.join(root, d, 'ghost.json'))).rejects.toBeTruthy()
    const file = await createRequest(root, d, doc('r'))
    await saveRequest(root, d, file, { ...doc('r'), url: 'http://z' })
    expect((await loadWorkspace(root)).folders[0].requests[0].doc.url).toBe('http://z')
  })

  it('requires request file names to be plain .json names', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('a'))
    await expect(deleteRequest(root, d, 'a.txt')).rejects.toThrow()
    await expect(saveRequest(root, d, 'a', doc('a'))).rejects.toThrow()
    await expect(renameRequest(root, d, 'a.txt', 'b')).rejects.toThrow()
    await expect(moveRequest(root, { dir: d, file: 'a.txt' }, { dir: d, index: 0 })).rejects.toThrow()
  })

  it('loadWorkspace survives corrupt or missing workspace.json', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('a'))
    await createRequest(root, d, doc('b'))
    const ws = path.join(root, 'workspace.json')
    await fs.writeFile(ws, '{ nope')
    let t = await loadWorkspace(root)
    expect(t.warnings.some((w) => w.includes(ws))).toBe(true)
    expect(t.folders[0].requests.map((r) => r.file)).toEqual(['a.json', 'b.json'])
    await fs.rm(ws)
    t = await loadWorkspace(root)
    expect(t.warnings.some((w) => w.includes(ws))).toBe(true)
    expect(t.folders).toHaveLength(1)
  })

  it('skips wrong-shaped request and environment files with warnings', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('ok'))
    await fs.writeFile(path.join(root, d, 'n.json'), 'null')
    await fs.writeFile(path.join(root, d, 's.json'), '"x"')
    await fs.writeFile(path.join(root, d, 'm.json'), JSON.stringify({ name: 'm' }))
    await fs.writeFile(path.join(root, 'environments', 'bad.json'), 'null')
    await fs.writeFile(path.join(root, 'environments', 'bad2.json'), JSON.stringify({ name: 'x' }))
    await fs.writeFile(path.join(root, 'environments', 'bad3.json'), '{ x')
    const t = await loadWorkspace(root)
    // m.json lacks fields but has a name: it is normalised, not skipped
    expect(t.folders[0].requests.map((r) => r.file)).toEqual(['ok.json', 'm.json'])
    expect(t.environments).toEqual([])
    expect(t.warnings).toHaveLength(5)
  })

  it('reorders within the same folder (index after removal)', async () => {
    const d = await createFolder(root, 'f')
    const a = await createRequest(root, d, doc('a'))
    await createRequest(root, d, doc('b'))
    const c = await createRequest(root, d, doc('c'))
    const order = async () => (await loadWorkspace(root)).folders[0].requests.map((r) => r.file)
    expect(await moveRequest(root, { dir: d, file: a }, { dir: d, index: 2 })).toBe(a)
    expect(await order()).toEqual(['b.json', 'c.json', 'a.json'])
    await moveRequest(root, { dir: d, file: c }, { dir: d, index: 0 })
    expect(await order()).toEqual(['c.json', 'b.json', 'a.json'])
  })

  it('renameFolder carries request order', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('z'))
    await createRequest(root, d, doc('y'))
    await createRequest(root, d, doc('x'))
    await renameFolder(root, d, 'g')
    const t = await loadWorkspace(root)
    expect(t.folders[0].dir).toBe('g')
    expect(t.folders[0].requests.map((r) => r.file)).toEqual(['z.json', 'y.json', 'x.json'])
  })

  it('renameRequest removes old file and keeps order', async () => {
    const d = await createFolder(root, 'f')
    await createRequest(root, d, doc('a'))
    const b = await createRequest(root, d, doc('b'))
    await createRequest(root, d, doc('c'))
    await renameRequest(root, d, b, 'bb')
    await expect(fs.access(path.join(root, d, b))).rejects.toBeTruthy()
    const t = await loadWorkspace(root)
    expect(t.folders[0].requests.map((r) => r.file)).toEqual(['a.json', 'bb.json', 'c.json'])
  })

  it('createRequest resolves name collisions', async () => {
    const d = await createFolder(root, 'f')
    expect(await createRequest(root, d, doc('x'))).toBe('x.json')
    expect(await createRequest(root, d, doc('x'))).toBe('x 2.json')
  })

  it('creates folders and requests for awkward names without error', async () => {
    const names = ['a/b:c', 'CON', 'con.txt', '', 'x'.repeat(300), '...', '日本語'.repeat(80)]
    for (const n of names) {
      const d = await createFolder(root, n)
      const f = await createRequest(root, d, doc(n))
      await saveRequest(root, d, f, doc(n))
    }
    const t = await loadWorkspace(root)
    expect(t.warnings).toEqual([])
    expect(t.folders).toHaveLength(names.length)
    expect(t.folders.every((f) => f.requests.length === 1)).toBe(true)
    expect(t.folders[0].dir).toBe('a-b-c')
  })

  it('createWorkspace makes a safely named sub-folder of the picked parent', async () => {
    const r = await createWorkspace(parent, 'a/b: c')
    expect(r).toBe(path.join(parent, 'a-b- c'))
    expect((await loadWorkspace(r)).name).toBe('a/b: c')
  })

  it('createWorkspace refuses an existing non-empty target and never overwrites workspace.json', async () => {
    await expect(createWorkspace(parent, 'p')).rejects.toThrow(/already exists/)
    await fs.mkdir(path.join(parent, 'full'))
    await fs.writeFile(path.join(parent, 'full', 'keep.txt'), 'x')
    await expect(createWorkspace(parent, 'full')).rejects.toThrow(/already exists/)
    expect(await fs.readdir(path.join(parent, 'full'))).toEqual(['keep.txt'])
    const before = await fs.readFile(path.join(root, 'workspace.json'), 'utf8')
    await expect(createWorkspace(parent, 'p')).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'workspace.json'), 'utf8')).toBe(before)
    // an existing EMPTY folder is fine
    await fs.mkdir(path.join(parent, 'empty'))
    expect(await createWorkspace(parent, 'empty')).toBe(path.join(parent, 'empty'))
  })

  it('openProject rejects a folder without workspace.json and changes nothing', async () => {
    const plain = path.join(parent, 'docs')
    await fs.mkdir(path.join(plain, 'sub'), { recursive: true })
    await expect(openProject(plain)).rejects.toThrow(/not a Requestly project/)
    expect(await fs.readdir(plain)).toEqual(['sub'])
    await fs.writeFile(path.join(root, 'workspace.json'), '{ corrupt')
    const t = await openProject(root) // present but corrupt: still opens, with a warning
    expect(t.warnings).toHaveLength(1)
  })

  it('deleteFolder / renameFolder / createFolder / moveRequest leave the disk untouched when the index is unreadable', async () => {
    const d = await createFolder(root, 'f')
    const file = await createRequest(root, d, doc('a'))
    await fs.writeFile(path.join(root, d, 'notes.txt'), 'keep me')
    await fs.writeFile(path.join(root, 'workspace.json'), '{ corrupt')
    const snap = async () => JSON.stringify([await fs.readdir(root), await fs.readdir(path.join(root, d))])
    const before = await snap()
    await expect(deleteFolder(root, d)).rejects.toThrow()
    await expect(renameFolder(root, d, 'g')).rejects.toThrow()
    await expect(createFolder(root, 'n')).rejects.toThrow()
    await expect(createRequest(root, d, doc('b'))).rejects.toThrow()
    await expect(renameRequest(root, d, file, 'c')).rejects.toThrow()
    await expect(deleteRequest(root, d, file)).rejects.toThrow()
    await expect(moveRequest(root, { dir: d, file }, { dir: d, index: 0 })).rejects.toThrow()
    await expect(deleteEnvironment(root, 'x')).rejects.toThrow()
    expect(await snap()).toBe(before)
    expect(await fs.readFile(path.join(root, d, 'notes.txt'), 'utf8')).toBe('keep me')
  })

  it('deleteFolder only deletes folders listed on disk', async () => {
    await expect(deleteFolder(root, 'ghost')).rejects.toThrow()
    await expect(renameFolder(root, 'ghost', 'x')).rejects.toThrow()
  })

  it('prototype-named folders create, reload and list', async () => {
    for (const n of ['__proto__', 'constructor', 'toString']) {
      const d = await createFolder(root, n)
      await createRequest(root, d, doc('r'))
    }
    const t = await loadWorkspace(root)
    expect(t.warnings).toEqual([])
    expect(t.folders.map((f) => f.dir).sort()).toEqual(['__proto__', 'constructor', 'toString'])
    expect(t.folders.every((f) => f.requests.length === 1)).toBe(true)
    await renameFolder(root, '__proto__', 'p2')
    await deleteFolder(root, 'constructor')
    expect((await loadWorkspace(root)).folders.map((f) => f.dir).sort()).toEqual(['p2', 'toString'])
  })

  it('prototype-named folders created on disk appear, and wrongly typed index fields fall back', async () => {
    for (const n of ['__proto__', 'constructor', 'hasOwnProperty']) {
      await fs.mkdir(path.join(root, n))
      await fs.writeFile(path.join(root, n, 'a.json'), JSON.stringify(doc('a')))
    }
    await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({
      name: 7, folderOrder: 'nope', requestOrder: { constructor: 'x', __proto__: ['a.json'], hasOwnProperty: [1, 'a.json'] }, activeEnvironment: 3
    }))
    const t = await loadWorkspace(root)
    expect(t.warnings).toEqual([])
    expect(t.folders).toHaveLength(3)
    expect(t.folders.every((f) => f.requests.length === 1)).toBe(true)
    expect(t.activeEnvironment).toBeNull()
    await fs.writeFile(path.join(root, 'workspace.json'), JSON.stringify({ folderOrder: {}, requestOrder: [] }))
    expect((await loadWorkspace(root)).folders).toHaveLength(3)
  })

  it('a request file missing params/headers loads normalised and stays untouched on disk', async () => {
    const d = await createFolder(root, 'f')
    const raw = JSON.stringify({ name: 'old', method: 'post', url: 'http://x' })
    await fs.writeFile(path.join(root, d, 'old.json'), raw)
    const t = await loadWorkspace(root)
    expect(t.warnings).toEqual([])
    expect(t.folders[0].requests[0].doc).toEqual({
      name: 'old', method: 'POST', url: 'http://x', params: [], headers: [], bodyType: 'none', body: ''
    })
    expect(await fs.readFile(path.join(root, d, 'old.json'), 'utf8')).toBe(raw)
  })

  it('environments with malformed variable rows are normalised', async () => {
    await fs.writeFile(path.join(root, 'environments', 'e.json'), JSON.stringify({
      name: 'e', variables: [{ key: 'a', value: '1', enabled: true }, 5, { key: 1 }]
    }))
    expect((await loadWorkspace(root)).environments[0].variables).toEqual([{ key: 'a', value: '1', enabled: true }])
  })
})

describe('normalizeRequest', () => {
  const kv = { key: 'k', value: 'v', enabled: true }
  it('keeps a well-formed doc', () => {
    const d = { name: 'n', method: 'PUT', url: 'u', params: [kv], headers: [kv], bodyType: 'json', body: '{}' }
    expect(normalizeRequest(d)).toEqual(d)
  })
  it('fills missing fields', () => {
    expect(normalizeRequest({ name: 'n' })).toEqual({
      name: 'n', method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: ''
    })
  })
  it('fixes wrong types, bad methods and malformed rows', () => {
    const r = normalizeRequest({
      name: 'n', method: 'FETCH', url: 3, params: 'x', headers: [kv, null, { key: 'a' }, { key: 'b', value: 'c', enabled: 'yes' }],
      bodyType: 'xml', body: null
    })
    expect(r).toEqual({ name: 'n', method: 'GET', url: '', params: [], headers: [kv], bodyType: 'none', body: '' })
  })
  it('rejects non-objects and nameless docs', () => {
    expect(normalizeRequest(null)).toBeNull()
    expect(normalizeRequest('x')).toBeNull()
    expect(normalizeRequest({ method: 'GET' })).toBeNull()
    expect(normalizeRequest([])).toBeNull()
  })
})
