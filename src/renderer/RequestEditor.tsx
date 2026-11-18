import { useRef, useState, type KeyboardEvent } from 'react'
import type { RequestDoc } from '../shared/types'
import KeyValueTable from './KeyValueTable'
import { useApp } from './store'
import type { SaveStatus, useAutosave } from './useAutosave'

type Tab = 'params' | 'headers' | 'body'
const TABS: { id: Tab; label: string }[] = [
  { id: 'params', label: 'Params' }, { id: 'headers', label: 'Headers' }, { id: 'body', label: 'Body' }
]
const BODY_TYPES: RequestDoc['bodyType'][] = ['none', 'json', 'text']
const STATUS: Record<SaveStatus, string> = {
  saved: 'Saved', saving: 'Saving…', error: 'Save failed'
}

export default function RequestEditor({ edit, status }: { edit: ReturnType<typeof useAutosave>['edit']; status: SaveStatus }) {
  const { state } = useApp()
  const [tab, setTab] = useState<Tab>('params')
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const d = state.draft
  if (!d) return <div className="empty-state">Select or create a request</div>

  const count = (rows: { enabled: boolean; key: string }[]) => rows.filter((r) => r.enabled && r.key.trim()).length
  const badge: Record<Tab, number> = { params: count(d.params), headers: count(d.headers), body: 0 }
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab)
    const n = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1
    if (n < 0) return
    e.preventDefault()
    setTab(TABS[n].id)
    tabRefs.current[TABS[n].id]?.focus()
  }
  const noBody = d.method === 'GET' || d.method === 'HEAD'

  return (
    <div className="editor">
      <header className="editor-head">
        <h2 className="editor-name" title={d.name}>{d.name}</h2>
        <span className={`save-status ${status}`} role="status" aria-live="polite">{STATUS[status]}</span>
      </header>
      <div className="tabs" role="tablist" aria-label="Request sections" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={tab === t.id ? `panel-${t.id}` : undefined}
            tabIndex={tab === t.id ? 0 : -1} ref={(el) => { tabRefs.current[t.id] = el }}
            className="tab" onClick={() => setTab(t.id)}
          >
            {t.label}{badge[t.id] > 0 && <span className="badge">{badge[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" tabIndex={0} id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'params' && <KeyValueTable label="Params" rows={d.params} onChange={(params) => edit({ params })} />}
        {tab === 'headers' && <KeyValueTable label="Headers" rows={d.headers} onChange={(headers) => edit({ headers })} />}
        {tab === 'body' && (
          <div className="body-tab">
            <div className="segmented" role="radiogroup" aria-label="Body type">
              {BODY_TYPES.map((b) => (
                <label key={b} className={d.bodyType === b ? 'on' : ''}>
                  <input type="radio" name="bodyType" value={b} checked={d.bodyType === b} onChange={() => edit({ bodyType: b })} />
                  {b}
                </label>
              ))}
            </div>
            {noBody && <p className="muted note">The body is not sent with {d.method}.</p>}
            {d.bodyType !== 'none' && (
              <textarea
                className="body-text mono" aria-label="Request body" spellCheck={false}
                value={d.body} onChange={(e) => edit({ body: e.target.value })}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
