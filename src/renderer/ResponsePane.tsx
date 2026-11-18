import { memo, useRef, useState } from 'react'
import { formatDuration, formatSize } from './format'
import type { SendResult } from '../shared/types'
import JsonView from './JsonView'

const statusClass = (s: number) => (s >= 400 ? 'st-err' : s >= 300 ? 'st-redir' : s >= 200 ? 'st-ok' : 'st-info')

const ERRORS: Record<string, (e: string) => string> = {
  'invalid-url': () => 'Invalid URL: check the protocol (http:// or https://)',
  'invalid-header': (e) => e,
  network: (e) => `Network error: ${e}`,
  timeout: () => 'Request timed out (30 s)',
  cancelled: () => 'Request cancelled'
}

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState('Copy')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setLabel('Copied')
    } catch {
      setLabel('Copy failed')
    }
    setTimeout(() => setLabel('Copy'), 1500)
  }
  return <button className="copy" onClick={() => void copy()}>{label}</button>
}

// memo: with stable props a keystroke in the editor must not re-render a large response
export default memo(function ResponsePane(props: {
  response: SendResult | null
  sending: boolean
  missing: string[]
  onDismissMissing(): void
  onCancel(): void
}) {
  const { response: r, sending, missing } = props
  const seq = useRef<{ r: SendResult | null; n: number }>({ r: null, n: 0 })
  if (seq.current.r !== r) seq.current = { r, n: seq.current.n + 1 }
  return (
    <div className="response">
      {missing.length > 0 && (
        <div className="banner" role="status">
          <span>Undefined variable: {missing.join(', ')}</span>
          <button className="icon-btn" aria-label="Dismiss warning" onClick={props.onDismissMissing}>×</button>
        </div>
      )}
      <div className="response-head">
        {sending ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <span className="muted" role="status">Sending…</span>
            <button className="cancel" onClick={props.onCancel}>Cancel</button>
          </>
        ) : r?.ok ? (
          <>
            <span className="meta" role="status" aria-live="polite">
              <span className={`status ${statusClass(r.status)}`}>{r.status} {r.statusText}</span>
              <span className="muted">{formatDuration(r.durationMs)}</span>
              <span className="muted">{formatSize(r.sizeBytes)}</span>
            </span>
            {r.body && <CopyButton text={r.body} />}
          </>
        ) : r ? (
          r.kind === 'cancelled'
            ? <span className="muted" role="status">{ERRORS[r.kind](r.error)}</span>
            : <span className="status st-err-text" role="alert">{ERRORS[r.kind](r.error)}</span>
        ) : (
          <span className="muted">Response</span>
        )}
      </div>
      <div className="response-body">
        {sending ? null : !r ? (
          <div className="empty-state">Send the request to see the response</div>
        ) : r.ok ? (
          <>
            {r.truncated && <p className="note muted trunc">Response truncated at 5 MB</p>}
            {r.body === '' ? <div className="empty-state">Empty response</div> : <JsonView key={seq.current.n} body={r.body} json={r.isJson && !r.truncated} />}
          </>
        ) : null}
      </div>
    </div>
  )
})
