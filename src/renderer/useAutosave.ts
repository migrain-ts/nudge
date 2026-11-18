import { useCallback, useEffect, useRef, useState } from 'react'
import type { RequestDoc } from '../shared/types'
import { autosaveCtl, reqKey, useApp, type AutosaveCtl, type State } from './store'

const RETRY_MS = 2000
const MAX_FAILURES = 5

export function createAutosaver(save: (doc: RequestDoc) => Promise<void>, delayMs = 500) {
  let pending: RequestDoc | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let held = 0
  let failures = 0
  const clear = () => { if (timer) clearTimeout(timer); timer = null }
  const arm = (ms: number) => {
    clear()
    if (held === 0) timer = setTimeout(() => { void run() }, ms)
  }
  // A failed save keeps the doc pending and retries (backoff) until MAX_FAILURES; never throws.
  // Saves never overlap, and `flush` (= run) waits for one already running, so a closing window cannot cut it off.
  let inflight: Promise<void> | null = null
  const run = async () => {
    clear()
    while (inflight) await inflight
    const doc = pending
    pending = null
    if (!doc) return
    const p: Promise<void> = (async () => {
      try {
        await save(doc)
        failures = 0
      } catch {
        if (!pending) pending = doc
        if (++failures < MAX_FAILURES) arm(RETRY_MS)
      }
    })()
    inflight = p
    await p
    inflight = null
  }
  return {
    schedule(doc: RequestDoc) {
      pending = doc
      failures = 0
      arm(delayMs)
    },
    flush: run,
    /** an edit is still waiting to be written (not yet saved, or its save failed) */
    dirty: () => pending !== null,
    cancel() { clear(); pending = null; failures = 0 },
    /** Suspend timers (a sidebar rename/move is in flight); the returned fn releases and re-arms. */
    hold() {
      held++
      clear()
      let done = false
      return () => {
        if (done) return
        done = true
        held--
        if (pending && held === 0) arm(delayMs)
      }
    }
  }
}

type Selected = State['selected']

/**
 * Leaving a project: write the pending edit FIRST, then drop whatever could not be saved, so no timer can
 * later write project A's draft into project B. Returns false (nothing dropped) if the user declines to lose edits.
 */
export async function leaveProject(
  ctl: Pick<AutosaveCtl, 'flush' | 'cancel' | 'dirty'> | null, hasUnsaved: boolean, confirmLeave: () => boolean
): Promise<boolean> {
  await ctl?.flush()
  if ((ctl?.dirty() || hasUnsaved) && !confirmLeave()) return false
  ctl?.cancel()
  return true
}

/** Save callback that resolves the target path from the CURRENT selection when it runs. */
export function createSelectedSave(
  getSelected: () => Selected,
  write: (dir: string, file: string, doc: RequestDoc) => Promise<void>,
  onResult: (r: { ok: true; dir: string; file: string; doc: RequestDoc } | { ok: false; dir: string; file: string; doc: RequestDoc }) => void
) {
  return async (doc: RequestDoc) => {
    const s = getSelected()
    if (!s) return
    try {
      await write(s.dir, s.file, doc)
    } catch (e) {
      onResult({ ok: false, dir: s.dir, file: s.file, doc })
      throw e
    }
    onResult({ ok: true, dir: s.dir, file: s.file, doc })
  }
}

/** The selection only counts while the draft is still the one the pending doc was edited from. */
export function ownedSelected(owner: number, getDraftId: () => number, getSelected: () => Selected) {
  return () => (getDraftId() === owner ? getSelected() : null)
}

/** Doc to re-schedule when an unsaved (failed) request is opened again. */
export function resaveDoc(s: State): RequestDoc | null {
  return s.selected && s.draft && s.unsaved[reqKey(s.selected.dir, s.selected.file)] ? s.draft : null
}

/** Before renaming/moving a request with an unsaved edit, write that edit first. Rejects if the write fails. */
export async function persistUnsaved(
  unsaved: Record<string, true>, key: string, doc: RequestDoc, save: (doc: RequestDoc) => Promise<void>
): Promise<boolean> {
  if (!unsaved[key]) return false
  await save(doc)
  return true
}

export type SaveStatus = 'saved' | 'saving' | 'error'

export function useAutosave() {
  const { state, dispatch } = useApp()
  const [saving, setSaving] = useState(false)
  const selectedRef = useRef(state.selected)
  selectedRef.current = state.selected
  const draftIdRef = useRef(state.draftId)
  draftIdRef.current = state.draftId
  const ownerRef = useRef(state.draftId)
  const saver = useRef<ReturnType<typeof createAutosaver> | null>(null)
  const nameRef = useRef(state.draft?.name)
  nameRef.current = state.draft?.name
  if (!saver.current) {
    const inner = createSelectedSave(
        () => ownedSelected(ownerRef.current, () => draftIdRef.current, () => selectedRef.current)(),
        (dir, file, doc) => { setSaving(true); return window.api.saveRequest(dir, file, doc) },
        (r) => {
          setSaving(false)
          dispatch({ type: 'docSaved', dir: r.dir, file: r.file, doc: r.doc, failed: !r.ok })
        }
    )
    // A keystroke right after a sidebar rename carries the old name: always save the current one.
    saver.current = createAutosaver((doc) => inner({ ...doc, name: nameRef.current ?? doc.name }))
  }
  const s = saver.current
  useEffect(() => {
    autosaveCtl.current = { flush: s.flush, cancel: s.cancel, hold: s.hold, dirty: s.dirty }
    const onUnload = () => { void s.flush() }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      autosaveCtl.current = null
      void s.flush().then(() => s.cancel()) // the final flush may arm a retry: do not outlive the unmount
    }
  }, [s])
  useEffect(() => { if (!state.selected) s.cancel() }, [state.selected, s])
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    setSaving(false)
    // re-opening a request whose save failed: retry with its in-memory (edited) doc
    const doc = resaveDoc(stateRef.current)
    if (doc) { ownerRef.current = stateRef.current.draftId; s.schedule(doc) }
  }, [state.draftId, s])
  const draftRef = useRef(state.draft)
  draftRef.current = state.draft
  // Apply an edit to the draft and schedule its save (the doc carries no path).
  const edit = useCallback((patch: Partial<RequestDoc>) => {
    const cur = draftRef.current
    if (!cur) return
    const next = { ...cur, ...patch }
    draftRef.current = next
    ownerRef.current = draftIdRef.current
    dispatch({ type: 'editDraft', patch })
    setSaving(true)
    s.schedule(next)
  }, [s, dispatch])
  const failed = !!state.selected && !!state.unsaved[reqKey(state.selected.dir, state.selected.file)]
  const status: SaveStatus = failed ? 'error' : saving ? 'saving' : 'saved'
  return { status, edit }
}
