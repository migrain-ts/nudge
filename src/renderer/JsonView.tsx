import { memo, useState } from 'react'
import { initRows } from './rows'

/** Progressive viewer: 500 rows at a time, each tokenized only when first shown, appended on "Show more". */
export default memo(function JsonView({ body, json }: { body: string; json: boolean }) {
  // One initializer builds the lazy source AND its first batch; later batches are pulled in the click handler only.
  const [st, setSt] = useState(() => {
    const { src, rows } = initRows(body, json)
    return { src, rows, done: src.done }
  })
  const more = () => {
    const next = st.src.take()
    setSt({ src: st.src, rows: st.rows.concat(next), done: st.src.done })
  }
  return (
    <div className="json-view">
      <div className="code mono" role="region" tabIndex={0} aria-label="Response body">
        {st.rows.map((row, i) => (
          <div key={i} className="code-line">
            {row.tokens.map((t, j) => <span key={j} className={`tk-${t.kind}`}>{t.text}</span>)}
          </div>
        ))}
      </div>
      {!st.done && <button className="more" onClick={more}>Show more</button>}
    </div>
  )
})
