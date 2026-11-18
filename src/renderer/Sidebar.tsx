import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { Method, RequestDoc } from '../shared/types'
import { computeDrop, isNoopMove, moveIndex, type DropTarget } from './dnd'
import { autosaveCtl, reqKey, useApp } from './store'
import { ignoredLabel } from './format'
import { leaveProject, persistUnsaved } from './useAutosave'

const LABEL: Record<Method, string> = {
  GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PAT', DELETE: 'DEL', HEAD: 'HEAD', OPTIONS: 'OPT'
}

const NEW_REQUEST: RequestDoc = {
  name: 'New request', method: 'GET', url: '', params: [], headers: [], bodyType: 'none', body: ''
}

type Key = { dir: string; file?: string }
type Line = 'before' | 'after' | null
type Menu = Key & { x: number; y: number }
type Handlers = {
  select(dir: string, file: string): void
  rename(k: Key, name: string, refocus: boolean): void
  cancelRename(k: Key, refocus: boolean): void
  focused(key: string): void
  startRename(k: Key): void
  askDelete(k: Key): void
  openMenu(k: Key, x: number, y: number): void
  dragStart(dir: string, file: string, index: number): void
  dragOver(e: DragEvent, dir: string, index: number | null, count: number): void
  drop(e: DragEvent): void
  dragEnd(): void
}

class AbortAction extends Error {}

const rowKey = (k: Key) => (k.file === undefined ? `d:${k.dir}` : `r:${k.dir}/${k.file}`)

const message = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e)

function focusSibling(el: HTMLElement, delta: 1 | -1) {
  const items = Array.from(el.closest('[role=tree]')?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? [])
  items[items.indexOf(el) + delta]?.focus()
}

function RenameInput({ initial, label, onCommit, onCancel }: {
  initial: string; label: string; onCommit(v: string, refocus: boolean): void; onCancel(refocus: boolean): void
}) {
  const [v, setV] = useState(initial)
  const done = useRef(false)
  // refocus only for Enter/Escape; a blur means the user already moved focus elsewhere.
  const finish = (commit: boolean, refocus: boolean) => {
    if (done.current) return
    done.current = true
    if (commit && v.trim() && v.trim() !== initial) onCommit(v.trim(), refocus)
    else onCancel(refocus)
  }
  return (
    <input
      className="rename" autoFocus aria-label={label} value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(true, true)
        if (e.key === 'Escape') finish(false, true)
      }}
      onBlur={() => finish(true, false)}
    />
  )
}

const RequestRow = memo(function RequestRow(p: {
  dir: string; file: string; index: number; count: number
  name: string; method: Method; unsaved: boolean; selected: boolean; renaming: boolean; line: Line; tabbable: boolean; h: Handlers
}) {
  const { h } = p
  const key = { dir: p.dir, file: p.file }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') h.select(p.dir, p.file)
    else if (e.key === 'F2') h.startRename(key)
    else if (e.key === 'Delete' || e.key === 'Backspace') h.askDelete(key)
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const r = e.currentTarget.getBoundingClientRect()
      h.openMenu(key, r.left + 24, r.bottom)
    } else if (e.key === 'ArrowDown') focusSibling(e.currentTarget, 1)
    else if (e.key === 'ArrowUp') focusSibling(e.currentTarget, -1)
    else if (e.key === 'ArrowLeft') {
      const head = Array.from(e.currentTarget.closest('[role=tree]')?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? [])
        .find((el) => el.dataset.key === `d:${p.dir}`)
      head?.focus()
    } else return
    e.preventDefault()
  }
  return (
    <div
      role="treeitem" aria-level={2} aria-selected={p.selected} tabIndex={p.tabbable ? 0 : -1} data-key={rowKey(key)}
      onFocus={(e) => e.target === e.currentTarget && h.focused(rowKey(key))}
      className={`row-item request${p.selected ? ' selected' : ''}${p.line ? ` line-${p.line}` : ''}`}
      draggable={!p.renaming}
      onClick={() => h.select(p.dir, p.file)}
      onKeyDown={onKey}
      onContextMenu={(e) => { e.preventDefault(); h.openMenu(key, e.clientX, e.clientY) }}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.file); h.dragStart(p.dir, p.file, p.index) }}
      onDragOver={(e) => h.dragOver(e, p.dir, p.index, p.count)}
      onDrop={h.drop}
      onDragEnd={h.dragEnd}
    >
      <span className={`method m-${p.method}`}>{LABEL[p.method]}</span>
      {p.renaming ? (
        <RenameInput initial={p.name} label="Request name" onCommit={(v, r) => h.rename(key, v, r)} onCancel={(r) => h.cancelRename(key, r)} />
      ) : (
        <span className="label">{p.name}</span>
      )}
      {p.unsaved && <span className="unsaved-dot" role="img" aria-label="Not saved" title="Not saved" />}
    </div>
  )
})

export default function Sidebar() {
  const { state, dispatch } = useApp()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<Key | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [confirm, setConfirm] = useState<Key | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const reqBtn = useRef<HTMLButtonElement>(null)
  const dialogOrigin = useRef<string | null>(null)
  const dragSrc = useRef<{ dir: string; file: string; index: number } | null>(null)
  const tree = state.tree
  const warnKey = (tree?.warnings ?? []).join('\n')
  const [dismissedWarn, setDismissedWarn] = useState('')
  const folders = tree?.folders ?? []

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      pendingFocus.current = rowKey(menu)
      close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  // Focus restore: set pendingFocus, then any render runs this effect. Missing target -> "+ Request".
  useEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    pendingFocus.current = null
    const el = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? []).find((x) => x.dataset.key === key)
    ;(el ?? reqBtn.current)?.focus()
  })

  const refresh = async (
    reselect?: { dir: string; file: string }, focus?: string,
    moved?: { from: { dir: string; file: string }; to: { dir: string; file: string } }
  ) => {
    const t = await window.api.loadWorkspace()
    if (focus) pendingFocus.current = focus
    dispatch({ type: 'treeRefreshed', session: state.session, tree: t, reselect, moved })
  }
  // quiet: 'flush' saves the pending edit to the current path first, 'cancel' drops it (request is being deleted).
  // Either way autosave timers are held until the tree refresh has re-pointed `selected`.
  const act = async (fn: () => Promise<void>, quiet?: 'flush' | 'cancel') => {
    setError(null)
    const ctl = quiet ? autosaveCtl.current : null
    if (quiet === 'flush') await ctl?.flush()
    else if (quiet === 'cancel') ctl?.cancel()
    const release = ctl?.hold()
    try {
      await fn()
    } catch (e) {
      setError(message(e))
      // an aborted action changed nothing on disk: keep the in-memory edits (no refresh)
      if (!(e instanceof AbortAction)) try { await refresh() } catch { /* keep the first error */ }
    } finally {
      release?.()
    }
  }

  // Persist an unsaved edit of ANY request before it is renamed/moved; abort the action if that fails.
  const persistFirst = async (dir: string, file: string, verb: string) => {
    const sel = state.selected
    const doc = sel && sel.dir === dir && sel.file === file && state.draft
      ? state.draft
      : folders.find((f) => f.dir === dir)?.requests.find((r) => r.file === file)?.doc
    if (!doc) return
    try {
      if (await persistUnsaved(state.unsaved, reqKey(dir, file), doc, (d) => window.api.saveRequest(dir, file, d))) {
        dispatch({ type: 'docSaved', session: state.session, dir, file, doc })
      }
    } catch {
      throw new AbortAction(`Cannot ${verb}: saving failed`)
    }
  }

  const unsavedNow = useRef(state.unsaved)
  unsavedNow.current = state.unsaved
  const [switching, setSwitching] = useState(false)
  const switchProject = async () => {
    if (switching) return
    setSwitching(true)
    try {
      // the unsaved map is read after the flush, through a ref (this closure's `state` is stale by then)
      const ok = await leaveProject(autosaveCtl.current, () => Object.keys(unsavedNow.current).length > 0, () =>
        window.confirm('Some changes are not saved. Switch project anyway?'))
      if (ok) dispatch({ type: 'closed' })
    } finally {
      setSwitching(false)
    }
  }

  const expand = (dir: string) => setCollapsed((c) => { const n = new Set(c); n.delete(dir); return n })
  const toggle = (dir: string) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(dir)) n.add(dir); return n })

  const addFolder = () => act(async () => {
    const dir = await window.api.createFolder('New folder')
    await refresh()
    setRenaming({ dir })
  })
  const addRequest = () => act(async () => {
    const dir = state.selected?.dir ?? folders[0]?.dir
    if (!dir) throw new Error('Create a folder first.')
    const file = await window.api.createRequest(dir, { ...NEW_REQUEST })
    await refresh()
    expand(dir)
    dispatch({ type: 'select', dir, file })
    setRenaming({ dir, file })
  })

  // Handlers are read through a ref so memoized rows keep a stable `h`.
  const latest = useRef<Handlers>(null as unknown as Handlers)
  latest.current = {
    select: (dir, file) => dispatch({ type: 'select', dir, file }),
    cancelRename: (k, refocus) => {
      if (refocus) pendingFocus.current = rowKey(k)
      setRenaming(null)
    },
    focused: setFocusKey,
    startRename: (k) => { setMenu(null); setRenaming(k) },
    askDelete: (k) => { setMenu(null); dialogOrigin.current = rowKey(k); setConfirm(k) },
    openMenu: (k, x, y) => setMenu({ ...k, x, y }),
    rename: (k, name, refocus) => {
      setRenaming(null)
      void act(async () => {
        if (k.file === undefined) {
          const dir = await window.api.renameFolder(k.dir, name)
          setCollapsed((c) => (c.has(k.dir) ? new Set([...c].map((d) => (d === k.dir ? dir : d))) : c))
          const s = state.selected
          await refresh(s?.dir === k.dir ? { dir, file: s.file } : undefined, refocus ? rowKey({ dir }) : undefined)
        } else {
          await persistFirst(k.dir, k.file, 'rename')
          const file = await window.api.renameRequest(k.dir, k.file, name)
          const s = state.selected
          await refresh(s?.dir === k.dir && s.file === k.file ? { dir: k.dir, file } : undefined, refocus ? rowKey({ dir: k.dir, file }) : undefined, { from: { dir: k.dir, file: k.file }, to: { dir: k.dir, file } })
        }
      }, 'flush')
    },
    dragStart: (dir, file, index) => { dragSrc.current = { dir, file, index }; setMenu(null) },
    dragOver: (e, dir, index, count) => {
      if (!dragSrc.current) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      let pos: 'before' | 'after' = 'after'
      if (index !== null) {
        const r = e.currentTarget.getBoundingClientRect()
        pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
      }
      const t = computeDrop(dir, index, pos, count)
      setDrop((d) => (d && d.dir === t.dir && d.index === t.index ? d : t))
    },
    drop: (e) => {
      e.preventDefault()
      e.stopPropagation()
      const src = dragSrc.current
      const target = drop
      dragSrc.current = null
      setDrop(null)
      if (!src || !target || isNoopMove(src, target)) return
      const index = moveIndex(target, src.dir, src.index)
      void act(async () => {
        await persistFirst(src.dir, src.file, 'move')
        const file = await window.api.moveRequest({ dir: src.dir, file: src.file }, { dir: target.dir, index })
        expand(target.dir)
        const s = state.selected
        await refresh(s?.dir === src.dir && s.file === src.file ? { dir: target.dir, file } : undefined, undefined, { from: { dir: src.dir, file: src.file }, to: { dir: target.dir, file } })
      }, 'flush')
    },
    dragEnd: () => { dragSrc.current = null; setDrop(null) }
  }
  const h = useMemo<Handlers>(
    () => ({
      select: (...a) => latest.current.select(...a),
      rename: (...a) => latest.current.rename(...a),
      cancelRename: (...a) => latest.current.cancelRename(...a),
      focused: (...a) => latest.current.focused(...a),
      startRename: (...a) => latest.current.startRename(...a),
      askDelete: (...a) => latest.current.askDelete(...a),
      openMenu: (...a) => latest.current.openMenu(...a),
      dragStart: (...a) => latest.current.dragStart(...a),
      dragOver: (...a) => latest.current.dragOver(...a),
      drop: (...a) => latest.current.drop(...a),
      dragEnd: () => latest.current.dragEnd()
    }),
    []
  )

  const doDelete = () => {
    const k = confirm
    setConfirm(null)
    if (!k) return
    // next row to focus once the deleted one is gone (falls back to "+ Request" when none)
    let next: string | undefined
    if (k.file === undefined) {
      const i = folders.findIndex((f) => f.dir === k.dir)
      const n = folders[i + 1] ?? folders[i - 1]
      next = n && rowKey({ dir: n.dir })
    } else {
      const f = folders.find((x) => x.dir === k.dir)
      const i = f?.requests.findIndex((r) => r.file === k.file) ?? -1
      const n = f?.requests[i + 1] ?? f?.requests[i - 1]
      next = n ? rowKey({ dir: k.dir, file: n.file }) : rowKey({ dir: k.dir })
    }
    void act(async () => {
      if (k.file === undefined) await window.api.deleteFolder(k.dir)
      else await window.api.deleteRequest(k.dir, k.file)
      await refresh(undefined, next ?? 'btn')
    }, state.selected && state.selected.dir === k.dir && (k.file === undefined || state.selected.file === k.file) ? 'cancel' : 'flush')
  }
  const cancelConfirm = () => {
    pendingFocus.current = dialogOrigin.current
    setConfirm(null)
  }
  const visible: string[] = []
  for (const f of folders) {
    visible.push(rowKey({ dir: f.dir }))
    if (!collapsed.has(f.dir)) for (const r of f.requests) visible.push(rowKey({ dir: f.dir, file: r.file }))
  }
  const tabKey = focusKey && visible.includes(focusKey) ? focusKey : visible[0]
  const confirmLabel = confirm
    ? confirm.file === undefined
      ? `the folder “${confirm.dir}” and its requests`
      : `“${folders.find((f) => f.dir === confirm.dir)?.requests.find((r) => r.file === confirm.file)?.doc.name ?? confirm.file}”`
    : ''

  return (
    <>
      <div className="sidebar-head">
        <div className="sidebar-top">
          <div className="sidebar-title" title={tree?.name}>{tree?.name}</div>
          <button className="switch" disabled={switching} aria-busy={switching} onClick={() => void switchProject()}>
            {switching ? 'Switching…' : 'Change project…'}
          </button>
        </div>
        <div className="sidebar-actions">
          <button onClick={() => void addFolder()}>+ Folder</button>
          <button ref={reqBtn} onClick={() => void addRequest()}>+ Request</button>
        </div>
      </div>
      {tree && tree.warnings.length > 0 && dismissedWarn !== warnKey && (
        <div className="warn-banner" role="status">
          <details>
            <summary>{ignoredLabel(tree.warnings.length)}</summary>
            <ul>
              {tree.warnings.map((w) => <li key={w} title={w}>{w}</li>)}
            </ul>
          </details>
          <button className="icon-btn" aria-label="Dismiss warning" onClick={() => setDismissedWarn(warnKey)}>×</button>
        </div>
      )}
      <div
        className="tree" role="tree" aria-label="Folders and requests" ref={treeRef}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null) }}
        onDrop={(e) => { e.preventDefault(); setDrop(null) }}
      >
        {folders.length === 0 && <p className="empty muted">No folders — create one</p>}
        {folders.map((f) => {
          const open = !collapsed.has(f.dir)
          const folderKey = { dir: f.dir }
          const intoEmpty = drop?.dir === f.dir && f.requests.length === 0
          return (
            <div
              key={f.dir} role="none" className="folder"
              onDragOver={(e) => latest.current.dragOver(e, f.dir, null, f.requests.length)}
              onDrop={h.drop}
            >
              <div
                role="treeitem" aria-level={1} aria-expanded={open} tabIndex={tabKey === rowKey(folderKey) ? 0 : -1}
                data-key={rowKey(folderKey)} aria-owns={open ? `g-${f.dir}` : undefined}
                onFocus={(e) => e.target === e.currentTarget && h.focused(rowKey(folderKey))}
                className={`row-item folder-head${drop?.dir === f.dir && !open ? ' drop-into' : ''}`}
                onClick={() => toggle(f.dir)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') toggle(f.dir)
                  else if (e.key === 'ArrowRight') expand(f.dir)
                  else if (e.key === 'ArrowLeft') setCollapsed((c) => new Set(c).add(f.dir))
                  else if (e.key === 'F2') h.startRename(folderKey)
                  else if (e.key === 'Delete' || e.key === 'Backspace') h.askDelete(folderKey)
                  else if (e.key === 'ArrowDown') focusSibling(e.currentTarget, 1)
                  else if (e.key === 'ArrowUp') focusSibling(e.currentTarget, -1)
                  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                    const r = e.currentTarget.getBoundingClientRect()
                    h.openMenu(folderKey, r.left + 24, r.bottom)
                  } else return
                  e.preventDefault()
                }}
                onContextMenu={(e) => { e.preventDefault(); h.openMenu(folderKey, e.clientX, e.clientY) }}
                onDragOver={(e) => latest.current.dragOver(e, f.dir, null, f.requests.length)}
              >
                <span className="chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                {renaming && renaming.file === undefined && renaming.dir === f.dir ? (
                  <RenameInput initial={f.dir} label="Folder name" onCommit={(v, r) => h.rename(folderKey, v, r)} onCancel={(r) => h.cancelRename(folderKey, r)} />
                ) : (
                  <span className="label">{f.dir}</span>
                )}
                <span className="count muted">{f.requests.length}</span>
              </div>
              {open && f.requests.length === 0 && (
                <div aria-hidden="true" className={`row-item empty-folder muted${intoEmpty ? ' line-before' : ''}`}>Empty folder</div>
              )}
              {open && (
                <div role="group" id={`g-${f.dir}`}>
                  {f.requests.map((r, i) => {
                  const sel = state.selected?.dir === f.dir && state.selected.file === r.file
                  const line: Line =
                    drop?.dir === f.dir
                      ? drop.index === i ? 'before' : drop.index === f.requests.length && i === f.requests.length - 1 ? 'after' : null
                      : null
                  return (
                    <RequestRow
                      key={r.file} dir={f.dir} file={r.file} index={i} count={f.requests.length}
                      name={r.doc.name} method={r.doc.method} unsaved={!!state.unsaved[reqKey(f.dir, r.file)]} selected={sel}
                      renaming={renaming?.dir === f.dir && renaming.file === r.file}
                      line={line} tabbable={tabKey === rowKey({ dir: f.dir, file: r.file })} h={h}
                    />
                  )
                })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {confirm && (
        <div
          className="confirm" role="alertdialog" aria-label="Confirm deletion"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelConfirm() } }}
        >
          <span>
            Delete {confirmLabel}?
            {confirm.file !== undefined && state.unsaved[reqKey(confirm.dir, confirm.file)] && (
              <> This request has unsaved changes.</>
            )}
          </span>
          <div className="row">
            <button className="danger" onClick={doDelete}>Delete</button>
            <button autoFocus onClick={cancelConfirm}>Cancel</button>
          </div>
        </div>
      )}
      <div className="error sidebar-error" role="alert">{error}</div>
      {menu && (
        <div className="menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          <button role="menuitem" autoFocus onClick={() => h.startRename(menu)}>Rename</button>
          <button role="menuitem" className="danger-text" onClick={() => h.askDelete(menu)}>Delete…</button>
        </div>
      )}
    </>
  )
}
