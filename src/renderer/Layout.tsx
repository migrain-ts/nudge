import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import EnvEditor from './EnvEditor'
import EnvSelector from './EnvSelector'
import ResponsePane from './ResponsePane'
import { createSender } from './send'
import RequestEditor from './RequestEditor'
import Sidebar from './Sidebar'
import UrlBar from './UrlBar'
import { activeVariables, autosaveCtl, useApp } from './store'
import { useAutosave } from './useAutosave'

export default function Layout() {
  const { status, edit } = useAutosave()
  const { state, dispatch } = useApp()
  const [missing, setMissing] = useState<string[]>([])
  const [managing, setManaging] = useState(false)
  const envSelect = useRef<HTMLSelectElement>(null)
  const latest = useRef(state)
  latest.current = state
  const sender = useMemo(
    () => createSender({
      api: window.api, getState: () => latest.current, dispatch, variables: activeVariables,
      flush: async () => { await autosaveCtl.current?.flush() },
      onMissing: setMissing, newId: () => crypto.randomUUID()
    }),
    [dispatch, latest]
  )
  // switching/closing the request aborts its send and drops the stale banner
  useEffect(() => { sender.abandon(); setMissing([]) }, [state.draftId, sender])
  useEffect(() => () => sender.abandon(), [sender]) // leaving the project (Layout unmounts)
  const dismissMissing = useCallback(() => setMissing([]), [])
  const onSend = () => { void sender.send() }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (state.draft) onSend() }
  }
  return (
    <div className="layout">
      <aside className="sidebar" aria-label="Requests">
        <Sidebar />
      </aside>
      <div className="center" onKeyDown={onKeyDown}>
        <UrlBar edit={edit} onSend={onSend} onCancel={sender.cancel} envSlot={<EnvSelector ref={envSelect} onManage={() => setManaging(true)} />} />
        <div className="panes">
          <section className="pane" aria-label="Request">
            <RequestEditor edit={edit} status={status} />
          </section>
          <section className="pane" aria-label="Response">
            <ResponsePane response={state.response} sending={state.sending} missing={missing} onDismissMissing={dismissMissing} onCancel={sender.cancel} />
          </section>
        </div>
      </div>
      {managing && <EnvEditor onClose={() => { setManaging(false); setTimeout(() => envSelect.current?.focus(), 0) }} />}
    </div>
  )
}
