import type { KeyValue, RequestDoc, SendResult } from '../shared/types'
import type { Api } from '../shared/api'
import type { Action, State } from './store'

export type SenderDeps = {
  api: Pick<Api, 'send' | 'cancel' | 'missingVariables'>
  getState(): State
  dispatch(a: Action): void
  flush(): Promise<void>
  onMissing(names: string[]): void
  newId(): string
  variables?(s: State): KeyValue[]
}

type Flight = { id: string; draftId: number; cancelled: boolean }

/** Send flow with stale-result protection: only the latest send, for the still-open request, may publish. */
export function createSender(deps: SenderDeps) {
  // The in-flight claim is taken synchronously, before the first await: it is the single guard against double sends.
  let current: Flight | null = null
  const vars = (s: State) => deps.variables?.(s) ?? []
  const finish = (me: Flight, result: SendResult) => {
    if (current !== me) return
    current = null
    deps.dispatch({ type: 'responded', response: result })
    deps.dispatch({ type: 'sendingChanged', sending: false })
  }
  const cancelled: SendResult = { ok: false, kind: 'cancelled', error: 'Request cancelled' }
  return {
    async send(): Promise<void> {
      const s0 = deps.getState()
      if (!s0.draft || current) return
      const me: Flight = { id: deps.newId(), draftId: s0.draftId, cancelled: false }
      current = me
      deps.dispatch({ type: 'responded', response: null })
      deps.dispatch({ type: 'sendingChanged', sending: true })
      try { await deps.flush() } catch { /* a failing save must not block sending */ }
      if (current !== me) return // abandoned
      if (me.cancelled) return finish(me, cancelled)
      const s = deps.getState()
      const doc: RequestDoc | null = s.draft
      if (!doc || s.draftId !== me.draftId) { current = null; deps.dispatch({ type: 'sendingChanged', sending: false }); return }
      const variables = vars(s)
      // informational only: runs in parallel, never delays the send
      try {
        deps.api.missingVariables(doc, variables).then(
          (names) => { if (current === me) deps.onMissing(names) },
          () => { if (current === me) deps.onMissing([]) }
        )
      } catch { /* informational only */ }
      let result: SendResult
      try {
        result = await deps.api.send(doc, variables, me.id)
      } catch (e) {
        result = { ok: false, kind: 'network', error: e instanceof Error ? e.message : String(e) }
      }
      if (deps.getState().draftId !== me.draftId) return
      finish(me, result)
    },
    cancel() {
      if (!current) return
      current.cancelled = true
      void deps.api.cancel(current.id).catch(() => {})
    },
    /** The open request changed: abort the in-flight send, its result is dropped. */
    abandon() {
      if (!current) return
      current.cancelled = true
      void deps.api.cancel(current.id).catch(() => {})
      current = null
    }
  }
}
