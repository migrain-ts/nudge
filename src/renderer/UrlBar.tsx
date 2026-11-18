import type { ReactNode } from 'react'
import type { Method } from '../shared/types'
import { useApp } from './store'
import type { useAutosave } from './useAutosave'

export const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export default function UrlBar({ edit, onSend, onCancel, envSlot }: { edit: ReturnType<typeof useAutosave>['edit']; onSend(): void; onCancel(): void; envSlot?: ReactNode }) {
  const { state } = useApp()
  const d = state.draft
  return (
    <form className="urlbar" onSubmit={(e) => { e.preventDefault(); onSend() }}>
      <select
        className={`method-select m-${d?.method ?? 'GET'}`} aria-label="HTTP method" disabled={!d}
        value={d?.method ?? 'GET'} onChange={(e) => edit({ method: e.target.value as Method })}
      >
        {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <input
        className="url-input mono" aria-label="URL" placeholder="https://example.com/{{path}}" spellCheck={false}
        disabled={!d} value={d?.url ?? ''} onChange={(e) => edit({ url: e.target.value })}
      />
      {state.sending
        ? <button type="button" className="cancel" onClick={onCancel}>Cancel</button>
        : <button type="submit" className="primary" disabled={!d} title="Send (Cmd/Ctrl+Enter)">Send</button>}
      {envSlot}
    </form>
  )
}
