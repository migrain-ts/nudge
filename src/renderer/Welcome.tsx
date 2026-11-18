import { useEffect, useState } from 'react'
import type { WorkspaceTree } from '../shared/types'
import { useApp, type Action } from './store'

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export default function Welcome() {
  const { dispatch } = useApp()
  const [recents, setRecents] = useState<string[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.getRecents().then(setRecents, () => {})
  }, [])

  const run = async (fn: () => Promise<Action | null>) => {
    setBusy(true)
    setError(null)
    try {
      const action = await fn()
      if (action) dispatch(action)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }
  const load = async (p: Promise<WorkspaceTree>) => ({ type: 'loaded' as const, tree: await p })

  const create = () =>
    run(async () => {
      const root = await window.api.pickFolder('create')
      return root ? load(window.api.createWorkspace(root, name.trim())) : null
    })
  const open = () =>
    run(async () => {
      const root = await window.api.pickFolder('open')
      return root ? load(window.api.openWorkspace(root)) : null
    })

  return (
    <main className="welcome">
      <h1>Requestly</h1>
      <p className="muted">A local HTTP client. Your requests are files in a folder.</p>
      {naming ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && name.trim()) void create()
          }}
        >
          <input
            autoFocus
            aria-label="Project name"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" type="submit" disabled={busy || !name.trim()}>
            Choose location
          </button>
          <button type="button" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => setNaming(true)}>
            Create project
          </button>
          <button disabled={busy} onClick={() => void open()}>
            Open project
          </button>
        </div>
      )}
      {naming && <p className="muted hint">Choose where to create the new project: a folder with its name will be created there.</p>}
      <div className="error" role="alert">
        {error}
      </div>
      {recents.length > 0 && (
        <section>
          <h2>Recent</h2>
          <ul className="recents">
            {recents.map((r) => (
              <li key={r}>
                <button disabled={busy} title={r} onClick={() => void run(() => load(window.api.openWorkspace(r)))}>
                  <span>{base(r)}</span>
                  <span className="muted path">{r}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
