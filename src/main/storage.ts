import { promises as fs } from 'node:fs'
import path from 'node:path'
import { safeFileName } from '../shared/filename'
import type { Environment, FolderNode, KeyValue, Method, RequestDoc, WorkspaceTree } from '../shared/types'

interface Index {
  name: string
  folderOrder: string[]
  requestOrder: Record<string, string[]>
  activeEnvironment: string | null
}

const INDEX = 'workspace.json'
const ENV_DIR = 'environments'

// Arguments from the renderer must be plain names, never paths.
function plain(name: string): string {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || name.includes('\0')) {
    throw new Error(`Invalid name: ${name}`)
  }
  return name
}

function dirName(dir: string): string {
  plain(dir)
  if (dir.startsWith('.') || dir.toLowerCase() === ENV_DIR || dir.toLowerCase() === INDEX) {
    throw new Error(`Reserved folder name: ${dir}`)
  }
  return dir
}

function fileName(file: string): string {
  plain(file)
  if (!/\.json$/i.test(file)) throw new Error(`Invalid request file: ${file}`)
  return file
}

// Strip leading dots; reserved names are avoided via the `taken` list.
const folderBase = (name: string): string => name.replace(/^\.+/, '')
const RESERVED_DIRS = [ENV_DIR, INDEX]

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'
const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const isKeyValue = (v: unknown): v is KeyValue =>
  isObj(v) && typeof v.key === 'string' && typeof v.value === 'string' && typeof v.enabled === 'boolean'
const rows = (v: unknown): KeyValue[] =>
  Array.isArray(v) ? v.filter(isKeyValue).map(({ key, value, enabled }) => ({ key, value, enabled })) : []

/** A request file of any shape becomes a well-formed doc (only a missing name makes it invalid). */
export function normalizeRequest(v: unknown): RequestDoc | null {
  if (!isObj(v) || Array.isArray(v) || typeof v.name !== 'string') return null
  const method = str(v.method).toUpperCase() as Method
  return {
    name: v.name,
    method: METHODS.includes(method) ? method : 'GET',
    url: str(v.url),
    params: rows(v.params),
    headers: rows(v.headers),
    bodyType: v.bodyType === 'json' || v.bodyType === 'text' ? v.bodyType : 'none',
    body: str(v.body)
  }
}
const normalizeEnvironment = (v: unknown): Environment | null =>
  isObj(v) && typeof v.name === 'string' && Array.isArray(v.variables) ? { name: v.name, variables: rows(v.variables) } : null

const stripJson = (file: string): string => file.replace(/\.json$/i, '')
const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
// null prototype: a folder named `__proto__` or `constructor` is an ordinary key
const emptyIndex = (name: string): Index => ({ name, folderOrder: [], requestOrder: Object.create(null), activeEnvironment: null })

async function readIndex(root: string): Promise<Index> {
  const raw: unknown = JSON.parse(await fs.readFile(path.join(root, INDEX), 'utf8'))
  if (!isObj(raw) || Array.isArray(raw)) throw new Error('workspace.json is not an object')
  const index = emptyIndex(str(raw.name) || path.basename(root))
  if (isStrings(raw.folderOrder)) index.folderOrder = raw.folderOrder
  if (isObj(raw.requestOrder) && !Array.isArray(raw.requestOrder)) {
    for (const k of Object.keys(raw.requestOrder)) {
      const list = raw.requestOrder[k]
      if (isStrings(list)) index.requestOrder[k] = list
    }
  }
  if (typeof raw.activeEnvironment === 'string') index.activeEnvironment = raw.activeEnvironment
  return index
}

async function writeIndex(root: string, index: Index): Promise<void> {
  const target = path.join(root, INDEX)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(index, null, 2))
  await fs.rename(tmp, target)
}

async function listFolders(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && e.name !== ENV_DIR && !e.name.startsWith('.'))
    .map((e) => e.name)
}

async function listJson(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isFile() && /\.json$/i.test(e.name)).map((e) => e.name)
}

// Index gives the order; disk gives the existence. Unknown items go last.
function merge(ordered: string[] | undefined, onDisk: string[]): string[] {
  const set = new Set(onDisk)
  const kept = (Array.isArray(ordered) ? ordered : []).filter((f) => set.has(f))
  const keptSet = new Set(kept)
  return [...kept, ...onDisk.filter((f) => !keptSet.has(f)).sort()]
}

function insertAt(list: string[], item: string, index: number): void {
  const i = Math.max(0, Math.min(index, list.length))
  list.splice(i, 0, item)
}

/** Creates `<parent>/<safe name>` as a new project and returns its path. Never touches an existing project. */
export async function createWorkspace(parent: string, name: string): Promise<string> {
  const dir = safeFileName(name, [])
  const root = path.join(parent, dir)
  if (await exists(path.join(root, INDEX))) throw new Error(`A project already exists in "${dir}".`)
  if (await fs.readdir(root).then((e) => e.length > 0, () => false)) {
    throw new Error(`The folder "${dir}" already exists and is not empty.`)
  }
  await fs.mkdir(path.join(root, ENV_DIR), { recursive: true })
  await writeIndex(root, emptyIndex(name))
  return root
}

/** Only a folder holding a workspace.json is a project (a corrupt one still opens, with a warning). */
export async function openProject(root: string): Promise<WorkspaceTree> {
  if (!(await fs.stat(path.join(root, INDEX)).then((s) => s.isFile(), () => false))) {
    throw new Error('This folder is not a Nudge project (workspace.json not found).')
  }
  return loadWorkspace(root)
}

export async function loadWorkspace(root: string): Promise<WorkspaceTree> {
  const warnings: string[] = []
  let index: Index
  try {
    index = await readIndex(root)
  } catch (e) {
    warnings.push(`${path.join(root, INDEX)}: ${(e as Error).message}`)
    index = emptyIndex(path.basename(root))
  }

  const folders: FolderNode[] = []
  for (const dir of merge(index.folderOrder, await listFolders(root))) {
    const dirPath = path.join(root, dir)
    const requests: FolderNode['requests'] = []
    for (const file of merge(index.requestOrder[dir], await listJson(dirPath))) {
      const filePath = path.join(dirPath, file)
      try {
        const doc = normalizeRequest(JSON.parse(await fs.readFile(filePath, 'utf8')))
        if (!doc) throw new Error('invalid request file')
        requests.push({ file, doc })
      } catch (e) {
        warnings.push(`${filePath}: ${(e as Error).message}`)
      }
    }
    folders.push({ dir, requests })
  }

  const environments: Environment[] = []
  const envPath = path.join(root, ENV_DIR)
  if (await exists(envPath)) {
    for (const file of (await listJson(envPath)).sort()) {
      const filePath = path.join(envPath, file)
      try {
        const env = normalizeEnvironment(JSON.parse(await fs.readFile(filePath, 'utf8')))
        if (!env) throw new Error('invalid environment file')
        environments.push(env)
      } catch (e) {
        warnings.push(`${filePath}: ${(e as Error).message}`)
      }
    }
  }

  const active = environments.some((e) => e.name === index.activeEnvironment)
    ? index.activeEnvironment
    : null
  return { name: index.name, folders, environments, activeEnvironment: active, warnings }
}

export async function createFolder(root: string, name: string): Promise<string> {
  const index = await readIndex(root)
  const dir = safeFileName(folderBase(name), [...(await listFolders(root)), ...RESERVED_DIRS])
  await fs.mkdir(path.join(root, dir))
  index.folderOrder = merge(index.folderOrder, await listFolders(root))
  index.requestOrder[dir] = []
  await writeIndex(root, index)
  return dir
}

export async function renameFolder(root: string, dir: string, newName: string): Promise<string> {
  dirName(dir)
  const index = await readIndex(root)
  const folders = await listFolders(root)
  if (!folders.includes(dir)) throw new Error(`Folder not found: ${dir}`)
  const next = safeFileName(folderBase(newName), [...folders.filter((d) => d !== dir), ...RESERVED_DIRS])
  if (next === dir) return dir
  await fs.rename(path.join(root, dir), path.join(root, next))
  index.folderOrder = index.folderOrder.map((d) => (d === dir ? next : d))
  if (index.requestOrder[dir]) {
    index.requestOrder[next] = index.requestOrder[dir]
    delete index.requestOrder[dir]
  }
  await writeIndex(root, index)
  return next
}

export async function deleteFolder(root: string, dir: string): Promise<void> {
  dirName(dir)
  const index = await readIndex(root)
  if (!(await listFolders(root)).includes(dir)) throw new Error(`Folder not found: ${dir}`)
  await fs.rm(path.join(root, dir), { recursive: true, force: true })
  index.folderOrder = index.folderOrder.filter((d) => d !== dir)
  delete index.requestOrder[dir]
  await writeIndex(root, index)
}

export async function moveFolder(root: string, dir: string, index: number): Promise<void> {
  dirName(dir)
  const idx = await readIndex(root)
  const order = merge(idx.folderOrder, await listFolders(root)).filter((d) => d !== dir)
  insertAt(order, dir, index)
  idx.folderOrder = order
  await writeIndex(root, idx)
}

async function takenFiles(dirPath: string): Promise<string[]> {
  return (await listJson(dirPath)).map(stripJson)
}

export async function createRequest(root: string, dir: string, doc: RequestDoc): Promise<string> {
  dirName(dir)
  const dirPath = path.join(root, dir)
  const index = await readIndex(root)
  const file = `${safeFileName(doc.name, await takenFiles(dirPath))}.json`
  await fs.writeFile(path.join(dirPath, file), JSON.stringify(doc, null, 2))
  index.requestOrder[dir] = [...merge(index.requestOrder[dir], await listJson(dirPath)).filter((f) => f !== file), file]
  await writeIndex(root, index)
  return file
}

export async function saveRequest(root: string, dir: string, file: string, doc: RequestDoc): Promise<void> {
  dirName(dir)
  fileName(file)
  const target = path.join(root, dir, file)
  // Never (re)create: a pending autosave must not resurrect a renamed/moved/deleted request.
  await fs.access(target).catch(() => { throw new Error('request-missing') })
  await fs.writeFile(target, JSON.stringify(doc, null, 2))
}

export async function renameRequest(root: string, dir: string, file: string, newName: string): Promise<string> {
  dirName(dir)
  fileName(file)
  const dirPath = path.join(root, dir)
  const index = await readIndex(root)
  const taken = (await takenFiles(dirPath)).filter((f) => f !== stripJson(file))
  const next = `${safeFileName(newName, taken)}.json`
  const doc = JSON.parse(await fs.readFile(path.join(dirPath, file), 'utf8')) as RequestDoc
  doc.name = newName
  if (next !== file) {
    await fs.rename(path.join(dirPath, file), path.join(dirPath, next))
    index.requestOrder[dir] = (index.requestOrder[dir] ?? []).map((f) => (f === file ? next : f))
    await writeIndex(root, index)
  }
  await fs.writeFile(path.join(dirPath, next), JSON.stringify(doc, null, 2))
  return next
}

export async function deleteRequest(root: string, dir: string, file: string): Promise<void> {
  dirName(dir)
  fileName(file)
  const index = await readIndex(root)
  await fs.rm(path.join(root, dir, file), { force: true })
  index.requestOrder[dir] = (index.requestOrder[dir] ?? []).filter((f) => f !== file)
  await writeIndex(root, index)
}

export async function moveRequest(
  root: string,
  from: { dir: string; file: string },
  to: { dir: string; index: number }
): Promise<string> {
  dirName(from.dir)
  fileName(from.file)
  dirName(to.dir)
  const index = await readIndex(root)
  const src = path.join(root, from.dir, from.file)
  const toPath = path.join(root, to.dir)
  const sameDir = from.dir === to.dir
  const taken = (await takenFiles(toPath)).filter((f) => !(sameDir && f === stripJson(from.file)))
  const next = `${safeFileName(stripJson(from.file), taken)}.json`
  if (!sameDir || next !== from.file) await fs.rename(src, path.join(toPath, next))

  index.requestOrder[from.dir] = merge(index.requestOrder[from.dir], await listJson(path.join(root, from.dir)))
    .filter((f) => f !== from.file && f !== next)
  const target = sameDir
    ? index.requestOrder[from.dir]
    : merge(index.requestOrder[to.dir], await listJson(toPath)).filter((f) => f !== next)
  insertAt(target, next, to.index)
  index.requestOrder[to.dir] = target
  await writeIndex(root, index)
  return next
}

const envFile = (name: string): string => `${safeFileName(plain(name), [])}.json`

export async function saveEnvironment(root: string, env: Environment): Promise<void> {
  await fs.mkdir(path.join(root, ENV_DIR), { recursive: true })
  await fs.writeFile(path.join(root, ENV_DIR, envFile(env.name)), JSON.stringify(env, null, 2))
}

export async function deleteEnvironment(root: string, name: string): Promise<void> {
  const index = await readIndex(root)
  await fs.rm(path.join(root, ENV_DIR, envFile(name)), { force: true })
  if (index.activeEnvironment === name) {
    index.activeEnvironment = null
    await writeIndex(root, index)
  }
}

export async function setActiveEnvironment(root: string, name: string | null): Promise<void> {
  if (name !== null) plain(name)
  const index = await readIndex(root)
  index.activeEnvironment = name
  await writeIndex(root, index)
}
