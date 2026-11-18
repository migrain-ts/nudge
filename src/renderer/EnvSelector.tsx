import { forwardRef, useState } from 'react'
import { apiMessage } from './envs'
import { useApp } from './store'

const NONE = ''
const MANAGE = '\u0000manage'

/** Environment picker (top right). Native <select>: keyboard + screen reader support for free. */
const EnvSelector = forwardRef<HTMLSelectElement, { onManage(): void }>(function EnvSelector({ onManage }, ref) {
  const { state, dispatch } = useApp()
  const [error, setError] = useState<string | null>(null)
  const envs = state.tree?.environments ?? []
  const active = state.tree?.activeEnvironment ?? null
  const onChange = async (v: string) => {
    if (v === MANAGE) return onManage()
    setError(null)
    try {
      await window.api.setActiveEnvironment(v === NONE ? null : v)
    } catch (e) { setError(apiMessage(e)) }
    try {
      dispatch({ type: 'treeRefreshed', session: state.session, tree: await window.api.loadWorkspace() })
    } catch (e) { setError(apiMessage(e)) }
  }
  return (
    <div className="env-selector">
      {error && <span className="error env-error" role="alert" title={error}>{error}</span>}
      <label className="muted" htmlFor="env-select">Environment</label>
      <select id="env-select" ref={ref} value={active ?? NONE} onChange={(e) => void onChange(e.target.value)}>
        <option value={NONE}>No environment</option>
        {envs.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
        <option value={MANAGE}>Manage environments…</option>
      </select>
    </div>
  )
})
export default EnvSelector
