import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Environment, KeyValue } from '../shared/types'
import { apiMessage, applyRename, createSaver, nextEnvName, RollbackFailed, validateEnvName } from './envs'
import KeyValueTable from './KeyValueTable'
import { quitFlushers, useApp } from './store'

const DEBOUNCE_MS = 400
type Status = 'idle' | 'saving' | 'saved' | 'failed'
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
const cleanVars = (rows: KeyValue[]) => rows.map((r) => ({ ...r, key: r.key.trim() }))

export default function EnvEditor({ onClose }: { onClose(): void }) {
  const { state, dispatch } = useApp()
  const envs = state.tree?.environments ?? []
  const active = state.tree?.activeEnvironment ?? null
  const [sel, setSel] = useState<string | null>(envs.find((e) => e.name === active)?.name ?? envs[0]?.name ?? null)
  const [rows, setRows] = useState<KeyValue[]>(() => envs.find((e) => e.name === sel)?.variables ?? [])
  const [nameInput, setNameInput] = useState(sel ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const running = useRef<Promise<unknown>>(Promise.resolve())
  const [blocked, setBlocked] = useState<{ redo: () => void } | null>(null)
  const latest = useRef({ envs, active, sel })
  latest.current = { envs, active, sel }

  const reload = async () => {
    const tree = await window.api.loadWorkspace()
    dispatch({ type: 'treeRefreshed', tree })
    return tree
  }
  // every disk operation runs one after the other, so renderer-side calls never overlap
  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.current.then(fn, fn)
    chain.current = p.catch(() => undefined)
    return p
  }
  const saver = useRef(createSaver<{ name: string; variables: KeyValue[] }>(
    (p) => enqueue(async () => {
      await window.api.saveEnvironment({ name: p.name, variables: cleanVars(p.variables) })
      await reload()
    })
  )).current
  const flush = async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!saver.pending) return
    setStatus('saving')
    const r = await saver.flush()
    setStatus(r === 'ok' ? 'saved' : 'failed')
    if (r === 'failed') setError('Failed to save variables.')
  }
  /** run `op` only when edits are saved; otherwise stay and offer Retry / Discard */
  const attempt = async (op: () => Promise<void>, redo: () => void) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (saver.pending) setStatus('saving')
    const had = saver.pending !== null
    const r = await saver.guarded(op)
    if (had) setStatus(r === 'blocked' ? 'failed' : 'saved')
    if (r === 'blocked') setBlocked({ redo })
  }
  /** a structural change: lock the buttons, run after edits are saved, show failures inline and resync from disk */
  const structural = (fn: () => Promise<void>) => {
    setError(null)
    setBusy((b) => b + 1)
    dialog.current?.focus() // keep focus (and Tab/Escape handling) inside the dialog while controls are disabled
    const p = (async () => {
      try {
        await attempt(() => enqueue(fn), () => { void structural(fn) })
      } catch (e) {
        setError(apiMessage(e))
        if (!(e instanceof RollbackFailed)) try { await reload() } catch { /* keep the first error */ }
      } finally {
        setBusy((b) => b - 1)
        setTimeout(() => {
          const d = dialog.current
          if (d && (document.activeElement === d || !d.contains(document.activeElement))) d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
        }, 50)
      }
    })()
    running.current = p
    return p
  }
  const pick = (name: string | null, from: Environment[] = latest.current.envs) => {
    setSel(name); setConfirm(false); setStatus('idle'); setError(null)
    setNameInput(name ?? '')
    setRows(from.find((e) => e.name === name)?.variables ?? [])
  }
  const select = (name: string) => {
    if (name === sel) return
    void structural(async () => { pick(name) })
  }
  const edit = (next: KeyValue[]) => {
    if (sel === null) return
    setRows(next); setStatus('idle')
    saver.set({ name: sel, variables: next })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, DEBOUNCE_MS)
  }
  const create = () => void structural(async () => {
    const name = nextEnvName(latest.current.envs.map((e) => e.name))
    await window.api.saveEnvironment({ name, variables: [] })
    pick(name, (await reload()).environments)
  })
  const rename = () => {
    const from = sel
    if (from === null) return
    const next = nameInput.trim()
    if (next === from) { setNameInput(from); return }
    const bad = validateEnvName(next, envs.map((e) => e.name), from)
    if (bad) { setError(bad); return }
    void structural(async () => {
      // edits were flushed first, so disk (latest tree) holds the variables to carry over
      const cur = latest.current.envs.find((e) => e.name === from)
      if (!cur) return
      const old: Environment = { name: cur.name, variables: cleanVars(cur.variables) }
      try {
        await applyRename(window.api, old, next, latest.current.active)
      } catch (e) {
        if (e instanceof RollbackFailed) throw e // keep in-memory rows so the user can copy them
        try { pick(from, (await reload()).environments) } catch { /* ignore */ }
        throw e
      }
      await reload()
      setSel(next); setNameInput(next)
    })
  }
  const remove = () => {
    const name = sel
    if (name === null) return
    void structural(async () => {
      await window.api.deleteEnvironment(name)
      const t = await reload()
      pick(t.environments[0]?.name ?? null, t.environments)
    })
  }
  const close = () => {
    void (async () => {
      await running.current
      await attempt(async () => { await running.current; onClose() }, close)
    })()
  }
  const retry = () => { const b = blocked; setBlocked(null); b?.redo() }
  const abandon = () => {
    const b = blocked
    saver.discard()
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setBlocked(null); setError(null); setStatus('idle')
    setRows(latest.current.envs.find((e) => e.name === latest.current.sel)?.variables ?? [])
    b?.redo()
  }

  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    const f = () => flushRef.current()
    quitFlushers.add(f)
    return () => { quitFlushers.delete(f) }
  }, [])

  useEffect(() => {
    const first = dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.current
    first?.focus()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return }
    if (e.key !== 'Tab' || !dialog.current) return
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const locked = busy > 0
  const statusText = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'failed' ? 'Save failed' : ''
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="env-title" tabIndex={-1} onKeyDown={onKeyDown}>
        <header className="modal-head">
          <h2 id="env-title">Environments</h2>
          <button type="button" className="icon-btn close" aria-label="Close" onClick={() => close()}>×</button>
        </header>
        <div className="modal-body">
          <nav className="env-list" aria-label="Environment list">
            {envs.map((e) => (
              <button
                key={e.name} type="button" className={`env-item${e.name === sel ? ' selected' : ''}`}
                aria-current={e.name === sel} disabled={locked} onClick={() => select(e.name)}
                {...(e.name === sel ? { 'data-autofocus': true } : {})}
              >
                <span className="label">{e.name}</span>
                {e.name === active && <span className="badge">active</span>}
              </button>
            ))}
            <button type="button" className="env-new" disabled={locked} onClick={create} {...(envs.length === 0 ? { 'data-autofocus': true } : {})}>
              + New environment
            </button>
          </nav>
          <section className="env-detail" aria-label="Environment details">
            {sel === null ? (
              <p className="empty-state muted">No environments yet. Create one to use variables like {'{{baseUrl}}'}.</p>
            ) : (
              <fieldset className="env-fields" disabled={locked}>
                <label className="env-name-label" htmlFor="env-name">Name</label>
                <input
                  id="env-name" value={nameInput} spellCheck={false}
                  onChange={(e) => setNameInput(e.target.value)} onBlur={rename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); rename() }
                    else if (e.key === 'Escape') { e.stopPropagation(); setNameInput(sel); setError(null) }
                  }}
                />
                <div className="env-vars-head">
                  <span className="muted">Variables</span>
                  <span className={`save-status${status === 'failed' ? ' error' : ''}`} role="status">{statusText}</span>
                </div>
                <KeyValueTable rows={rows} onChange={edit} label="Variable" />
                {confirm ? (
                  <div className="confirm" role="alertdialog" aria-label="Confirm deletion"
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirm(false) } }}>
                    <span>Delete environment “{sel}”?</span>
                    <div className="row">
                      <button type="button" className="danger" onClick={remove}>Delete</button>
                      <button type="button" autoFocus onClick={() => setConfirm(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="danger-text env-delete" onClick={() => setConfirm(true)}>Delete environment</button>
                )}
              </fieldset>
            )}
            {blocked && (
              <div className="confirm" role="alertdialog" aria-label="Save failed">
                <span>Could not save the variables — retry or discard your changes.</span>
                <div className="row">
                  <button type="button" autoFocus onClick={retry}>Retry</button>
                  <button type="button" className="danger" onClick={abandon}>Discard changes</button>
                </div>
              </div>
            )}
            <div className="error env-msg" role="alert">{error}</div>
          </section>
        </div>
      </div>
    </div>
  )
}
