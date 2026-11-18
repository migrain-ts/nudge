import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createQueue } from './queue'
import { addRecent, readRecents } from './recents'
import { findMissingVariables, sendRequest } from './http'
import * as storage from './storage'
import type { Api } from '../shared/api'
import type { WorkspaceTree } from '../shared/types'

type Args<K extends keyof Api> = Parameters<Api[K]>

export function registerIpc(): void {
  const enqueue = createQueue()
  const recentsFile = path.join(app.getPath('userData'), 'recents.json')
  const inflight = new Map<string, AbortController>()
  let root: string | null = null

  const need = (): string => {
    if (root === null) throw new Error('No project is open')
    return root
  }
  const handle = <K extends keyof Api>(
    name: K,
    fn: (...args: Args<K>) => Promise<Awaited<ReturnType<Api[K]>>>
  ): void => {
    ipcMain.handle(`api:${name}`, (_e, ...args) => fn(...(args as Args<K>)))
  }
  // storage-mutating calls all go through the single queue
  const q = <K extends keyof Api>(
    name: K,
    fn: (r: string, ...args: Args<K>) => Promise<Awaited<ReturnType<Api[K]>>>
  ): void => handle(name, (...args) => enqueue(() => fn(need(), ...args)))

  const open = (r: string): Promise<WorkspaceTree> =>
    enqueue(async () => {
      const tree = await storage.openProject(r)
      root = r
      await addRecent(recentsFile, r)
      return tree
    })

  ipcMain.handle('api:pickFolder', async (e, mode: Args<'pickFolder'>[0]) => {
    const options: Electron.OpenDialogOptions = {
      title: mode === 'create' ? 'Choose where to create the new project' : 'Open project',
      buttonLabel: mode === 'create' ? 'Choose this location' : 'Open',
      properties: process.platform === 'darwin' ? ['openDirectory', 'createDirectory'] : ['openDirectory']
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
  handle('openWorkspace', (r) => open(r))
  handle('createWorkspace', async (parent, name) => open(await enqueue(() => storage.createWorkspace(parent, name))))
  handle('getRecents', () => readRecents(recentsFile))
  handle('reopenLast', async () => {
    const [last] = await readRecents(recentsFile)
    if (!last || !existsSync(last)) return null
    try {
      return await open(last)
    } catch {
      return null
    }
  })

  q('loadWorkspace', (r) => storage.loadWorkspace(r))
  q('createFolder', (r, ...a) => storage.createFolder(r, ...a))
  q('renameFolder', (r, ...a) => storage.renameFolder(r, ...a))
  q('deleteFolder', (r, ...a) => storage.deleteFolder(r, ...a))
  q('moveFolder', (r, ...a) => storage.moveFolder(r, ...a))
  q('createRequest', (r, ...a) => storage.createRequest(r, ...a))
  q('saveRequest', (r, ...a) => storage.saveRequest(r, ...a))
  q('renameRequest', (r, ...a) => storage.renameRequest(r, ...a))
  q('deleteRequest', (r, ...a) => storage.deleteRequest(r, ...a))
  q('moveRequest', (r, ...a) => storage.moveRequest(r, ...a))
  q('saveEnvironment', (r, ...a) => storage.saveEnvironment(r, ...a))
  q('deleteEnvironment', (r, ...a) => storage.deleteEnvironment(r, ...a))
  q('setActiveEnvironment', (r, ...a) => storage.setActiveEnvironment(r, ...a))

  handle('send', async (doc, variables, requestId) => {
    const ctl = new AbortController()
    inflight.set(requestId, ctl)
    try {
      return await sendRequest(doc, variables, ctl.signal)
    } finally {
      inflight.delete(requestId)
    }
  })
  handle('cancel', async (requestId) => {
    inflight.get(requestId)?.abort()
  })
  handle('missingVariables', async (doc, variables) => findMissingVariables(doc, variables))
}
