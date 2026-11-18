import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/api'

// Every Api method except the event subscription is a plain `api:<name>` invoke. The record makes the list exhaustive.
const invoked: Record<Exclude<keyof Api, 'onBeforeClose'>, true> = {
  pickFolder: true, openWorkspace: true, createWorkspace: true, getRecents: true, reopenLast: true,
  loadWorkspace: true, createFolder: true, renameFolder: true, deleteFolder: true, moveFolder: true,
  createRequest: true, saveRequest: true, renameRequest: true, deleteRequest: true, moveRequest: true,
  saveEnvironment: true, deleteEnvironment: true, setActiveEnvironment: true,
  send: true, cancel: true, missingVariables: true, readyToClose: true
}

let beforeClose: (() => void) | null = null
ipcRenderer.on('app:before-close', () => beforeClose?.())

const api = {
  ...Object.fromEntries(
    Object.keys(invoked).map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke(`api:${n}`, ...args)])
  ),
  onBeforeClose: (cb: () => void) => {
    beforeClose = cb
    return () => { if (beforeClose === cb) beforeClose = null }
  }
}

contextBridge.exposeInMainWorld('api', api)
