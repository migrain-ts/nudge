export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface KeyValue {
  key: string
  value: string
  enabled: boolean
}

export interface RequestDoc {
  name: string
  method: Method
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  bodyType: 'none' | 'json' | 'text'
  body: string
}

export interface Environment {
  name: string
  variables: KeyValue[]
}

export interface FolderNode {
  dir: string
  requests: { file: string; doc: RequestDoc }[]
}

export interface WorkspaceTree {
  name: string
  folders: FolderNode[]
  environments: Environment[]
  activeEnvironment: string | null
  warnings: string[]
}

export type SendResult =
  | {
      ok: true
      status: number
      statusText: string
      durationMs: number
      body: string
      isJson: boolean
      truncated: boolean
      sizeBytes: number
    }
  | { ok: false; kind: 'invalid-url' | 'invalid-header' | 'network' | 'timeout' | 'cancelled'; error: string }
