import type { Environment, KeyValue, RequestDoc, SendResult, WorkspaceTree } from './types'

export interface Api {
  pickFolder(mode: 'create' | 'open'): Promise<string | null>
  openWorkspace(root: string): Promise<WorkspaceTree>
  createWorkspace(root: string, name: string): Promise<WorkspaceTree>
  getRecents(): Promise<string[]>
  reopenLast(): Promise<WorkspaceTree | null>
  loadWorkspace(): Promise<WorkspaceTree>
  createFolder(name: string): Promise<string>
  renameFolder(dir: string, newName: string): Promise<string>
  deleteFolder(dir: string): Promise<void>
  moveFolder(dir: string, index: number): Promise<void>
  createRequest(dir: string, doc: RequestDoc): Promise<string>
  saveRequest(dir: string, file: string, doc: RequestDoc): Promise<void>
  renameRequest(dir: string, file: string, newName: string): Promise<string>
  deleteRequest(dir: string, file: string): Promise<void>
  moveRequest(
    from: { dir: string; file: string },
    to: { dir: string; index: number }
  ): Promise<string>
  saveEnvironment(env: Environment): Promise<void>
  deleteEnvironment(name: string): Promise<void>
  setActiveEnvironment(name: string | null): Promise<void>
  send(doc: RequestDoc, variables: KeyValue[], requestId: string): Promise<SendResult>
  cancel(requestId: string): Promise<void>
  missingVariables(doc: RequestDoc, variables: KeyValue[]): Promise<string[]>
  /** The window is about to close: save, then call `readyToClose`. One listener; returns an unsubscribe. */
  onBeforeClose(cb: () => void): () => void
  readyToClose(): Promise<void>
}

declare global {
  interface Window {
    api: Api
  }
}
