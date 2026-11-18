import { createContext, createElement, useCallback, useContext, useReducer, type Dispatch, type ReactNode } from 'react'
import type { KeyValue, RequestDoc, SendResult, WorkspaceTree } from '../shared/types'

export type State = {
  tree: WorkspaceTree | null
  selected: { dir: string; file: string } | null
  draft: RequestDoc | null
  response: SendResult | null
  sending: boolean
  /** bumps whenever the open request changes identity (select/clear); a rename re-point keeps it */
  draftId: number
  /** requests whose last save failed, keyed by `dir/file` */
  unsaved: Record<string, true>
  /** bumps whenever a project is opened or closed; async work started in one project carries it so a late result is dropped */
  session: number
}

/** Variables of the active environment (Task 10 adds the UI to pick it). */
export function activeVariables(state: State): KeyValue[] {
  const t = state.tree
  return t?.environments.find((e) => e.name === t.activeEnvironment)?.variables ?? []
}

export const reqKey = (dir: string, file: string) => `${dir}/${file}`

export type Action =
  | { type: 'loaded'; tree: WorkspaceTree }
  | { type: 'closed' }
  | { type: 'treeRefreshed'; session?: number; tree: WorkspaceTree; reselect?: { dir: string; file: string }; moved?: { from: { dir: string; file: string }; to: { dir: string; file: string } } }
  | { type: 'select'; session?: number; dir: string; file: string }
  | { type: 'editDraft'; patch: Partial<RequestDoc> }
  | { type: 'docSaved'; session?: number; dir: string; file: string; doc: RequestDoc; failed?: boolean }
  | { type: 'responded'; response: SendResult | null }
  | { type: 'sendingChanged'; sending: boolean }

export const initialState: State = { tree: null, selected: null, draft: null, response: null, sending: false, draftId: 0, unsaved: {}, session: 0 }

const cloneDoc = (d: RequestDoc): RequestDoc => ({
  ...d, params: d.params.map((r) => ({ ...r })), headers: d.headers.map((r) => ({ ...r }))
})

/** The action was started in a project session that has since ended. */
const outdated = (state: State, action: { session?: number }) =>
  action.session !== undefined && action.session !== state.session

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return { ...initialState, tree: action.tree, draftId: state.draftId + 1, session: state.session + 1 }
    case 'closed':
      return { ...initialState, draftId: state.draftId + 1, session: state.session + 1 }
    // Task 8 (autosave): resolve the target {dir,file} from `state.selected` at flush time and cancel pending
    // saves when the selection is cleared; never capture the path when the edit is made.
    case 'treeRefreshed': {
      if (!state.tree || outdated(state, action)) return state
      const find = (s: { dir: string; file: string } | null | undefined) =>
        s ? action.tree.folders.find((f) => f.dir === s.dir)?.requests.find((r) => r.file === s.file) : undefined
      const moved = action.reselect && find(action.reselect) ? action.reselect : null
      // unsaved keys follow a re-point and are dropped when the request no longer exists
      const unsaved: Record<string, true> = {}
      for (const k of Object.keys(state.unsaved)) {
        const from = state.selected && reqKey(state.selected.dir, state.selected.file)
        const key =
          moved && k === from ? reqKey(moved.dir, moved.file)
          : action.moved && k === reqKey(action.moved.from.dir, action.moved.from.file) ? reqKey(action.moved.to.dir, action.moved.to.file)
          : k
        const [dir, ...rest] = key.split('/')
        if (find({ dir, file: rest.join('/') })) unsaved[key] = true
      }
      if (moved && state.draft) {
        return { ...state, tree: action.tree, unsaved, selected: moved, draft: { ...state.draft, name: find(moved)!.doc.name } }
      }
      if (moved || find(state.selected)) return { ...state, tree: action.tree, unsaved, selected: moved ?? state.selected }
      return { ...state, tree: action.tree, unsaved, selected: null, draft: null, response: null, sending: false, draftId: state.draftId + 1 }
    }
    case 'select': {
      if (outdated(state, action)) return state
      if (state.selected?.dir === action.dir && state.selected.file === action.file) return state
      const doc = state.tree?.folders
        .find((f) => f.dir === action.dir)
        ?.requests.find((r) => r.file === action.file)?.doc
      if (!doc) return state
      return { ...state, selected: { dir: action.dir, file: action.file }, draft: cloneDoc(doc), response: null, sending: false, draftId: state.draftId + 1 }
    }
    case 'editDraft':
      return state.draft ? { ...state, draft: { ...state.draft, ...action.patch } } : state
    case 'docSaved': {
      if (!state.tree || outdated(state, action)) return state
      const folders = state.tree.folders.map((f) =>
        f.dir !== action.dir ? f : { ...f, requests: f.requests.map((r) => (r.file === action.file ? { ...r, doc: action.doc } : r)) }
      )
      const { [reqKey(action.dir, action.file)]: _, ...rest } = state.unsaved
      return { ...state, tree: { ...state.tree, folders }, unsaved: action.failed ? { ...rest, [reqKey(action.dir, action.file)]: true } : rest }
    }
    case 'responded':
      return { ...state, response: action.response }
    case 'sendingChanged':
      return { ...state, sending: action.sending }
  }
}

export type AutosaveCtl = { flush(): Promise<void>; cancel(): void; hold(): () => void; dirty(): boolean }
/** Extra pending-save flushers (e.g. the environment editor) awaited before the window closes. */
export const quitFlushers = new Set<() => Promise<void>>()
export const autosaveCtl: { current: AutosaveCtl | null } = { current: null }

const Ctx = createContext<{ state: State; dispatch: Dispatch<Action> } | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState)
  // Flush a pending autosave (still targeting the current selection) before another request is selected.
  const dispatch = useCallback<Dispatch<Action>>((a) => {
    if (a.type === 'select') void autosaveCtl.current?.flush()
    rawDispatch(a)
  }, [])
  return createElement(Ctx.Provider, { value: { state, dispatch } }, children)
}

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
