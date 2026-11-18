import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/api'
import { createBeforeClose } from '../shared/beforeClose'

// Every Api method except the event subscription is a plain `api:<name>` invoke. The record makes the list exhaustive.
const invoked: Record<Exclude<keyof Api, 'onBeforeClose'>, true> = {
  pickFolder: true, openWorkspace: true, createWorkspace: true, getRecents: true, reopenLast: true,
  loadWorkspace: true, createFolder: true, renameFolder: true, deleteFolder: true, moveFolder: true,
  createRequest: true, saveRequest: true, renameRequest: true, deleteRequest: true, moveRequest: true,
  saveEnvironment: true, deleteEnvironment: true, setActiveEnvironment: true,
  send: true, cancel: true, missingVariables: true, readyToClose: true
}

// No page listener (error screen, still loading, welcome): nothing to save, so answer right away.
const beforeClose = createBeforeClose(() => { void ipcRenderer.invoke('api:readyToClose') })
ipcRenderer.on('app:before-close', () => beforeClose.fire())

const api = {
  ...Object.fromEntries(
    Object.keys(invoked).map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke(`api:${n}`, ...args)])
  ),
  onBeforeClose: (cb: () => void) => beforeClose.subscribe(cb)
}

contextBridge.exposeInMainWorld('api', api)
