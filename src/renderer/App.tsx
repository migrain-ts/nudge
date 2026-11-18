import { Component, useEffect, useState, type ReactNode } from 'react'
import Layout from './Layout'
import Welcome from './Welcome'
import { AppProvider, autosaveCtl, quitFlushers, useApp } from './store'

function Root() {
  const { state, dispatch } = useApp()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    window.api.reopenLast().then(
      (tree) => {
        if (tree) dispatch({ type: 'loaded', tree })
        setReady(true)
      },
      () => setReady(true)
    )
  }, [dispatch])
  // Window closing: save the last edit(s), then tell main it may close.
  useEffect(
    () => window.api.onBeforeClose(async () => {
      await Promise.all([autosaveCtl.current?.flush(), ...[...quitFlushers].map((f) => f())].map((p) => p?.catch(() => {})))
      await window.api.readyToClose()
    }),
    []
  )
  if (!ready) return null
  return state.tree ? <Layout /> : <Welcome />
}

/** Last line of defence: a render error shows a message instead of a blank window. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="welcome" role="alert">
        <h1>Unexpected error</h1>
        <p className="muted">Reload the window to continue.</p>
        <button className="primary" onClick={() => window.location.reload()}>Reload</button>
      </main>
    )
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <Root />
      </AppProvider>
    </ErrorBoundary>
  )
}
