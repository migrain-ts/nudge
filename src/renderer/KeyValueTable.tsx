import { memo, useCallback, useRef } from 'react'
import type { KeyValue } from '../shared/types'

const EMPTY: KeyValue = { key: '', value: '', enabled: true }

const Row = memo(function Row(p: {
  index: number; row: KeyValue; trailing: boolean; label: string
  onPatch(i: number, patch: Partial<KeyValue>): void; onDelete(i: number): void
}) {
  const { index: i, row, trailing } = p
  return (
    <div className={`kv-row${trailing ? ' trailing' : ''}${row.enabled ? '' : ' off'}`} role="row">
      <input
        type="checkbox" className="kv-check" checked={row.enabled} disabled={trailing}
        aria-label={`Enable row ${i + 1}`} onChange={(e) => p.onPatch(i, { enabled: e.target.checked })}
      />
      <input
        className="kv-input mono" value={row.key} placeholder="Key" spellCheck={false}
        aria-label={`${p.label}: key, row ${i + 1}`} onChange={(e) => p.onPatch(i, { key: e.target.value })}
      />
      <input
        className="kv-input mono" value={row.value} placeholder="Value" spellCheck={false}
        aria-label={`${p.label}: value, row ${i + 1}`} onChange={(e) => p.onPatch(i, { value: e.target.value })}
      />
      <button
        type="button" className="icon-btn" aria-label={`Delete row ${i + 1}`}
        disabled={trailing} onClick={() => p.onDelete(i)}
      >×</button>
    </div>
  )
})

/** Reusable key/value editor (request params/headers, environment variables). Never mutates `rows`. */
export default function KeyValueTable({ rows, onChange, label }: {
  rows: KeyValue[]; onChange(rows: KeyValue[]): void; label: string
}) {
  const latest = useRef({ rows, onChange })
  latest.current = { rows, onChange }
  const onPatch = useCallback((i: number, patch: Partial<KeyValue>) => {
    const { rows, onChange } = latest.current
    onChange(i >= rows.length ? [...rows, { ...EMPTY, ...patch }] : rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }, [])
  const onDelete = useCallback((i: number) => {
    const { rows, onChange } = latest.current
    onChange(rows.filter((_, j) => j !== i))
  }, [])
  return (
    <div className="kv" role="table" aria-label={label}>
      {[...rows, EMPTY].map((r, i) => (
        <Row key={i} index={i} row={r} trailing={i === rows.length} label={label} onPatch={onPatch} onDelete={onDelete} />
      ))}
    </div>
  )
}
