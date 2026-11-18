import { describe, expect, it } from 'vitest'
import { reducer, type State } from './store'
import type { RequestDoc, WorkspaceTree } from '../shared/types'

const doc: RequestDoc = {
  name: 'Get users', method: 'GET', url: 'http://x', params: [], headers: [], bodyType: 'none', body: ''
}
const tree: WorkspaceTree = {
  name: 'P', folders: [{ dir: 'a', requests: [{ file: 'r.json', doc }] }],
  environments: [], activeEnvironment: null, warnings: []
}
const empty: State = { tree: null, selected: null, draft: null, response: null, sending: false, draftId: 0, unsaved: {} }

describe('reducer', () => {
  it('loaded replaces the tree and clears the selection', () => {
    const s = reducer({ ...empty, selected: { dir: 'a', file: 'r.json' }, draft: doc }, { type: 'loaded', tree })
    expect(s.tree).toBe(tree)
    expect(s.selected).toBeNull()
    expect(s.draft).toBeNull()
  })
  it('select copies the request into draft', () => {
    const s = reducer({ ...empty, tree }, { type: 'select', dir: 'a', file: 'r.json' })
    expect(s.selected).toEqual({ dir: 'a', file: 'r.json' })
    expect(s.draft).toEqual(doc)
    expect(s.draft).not.toBe(doc)
  })
  it('editDraft changes draft without touching tree', () => {
    const base = reducer({ ...empty, tree }, { type: 'select', dir: 'a', file: 'r.json' })
    const s = reducer(base, { type: 'editDraft', patch: { url: 'http://y' } })
    expect(s.draft?.url).toBe('http://y')
    expect(s.tree).toBe(tree)
    expect(tree.folders[0].requests[0].doc.url).toBe('http://x')
  })
  it('responded and sendingChanged update their fields', () => {
    const r = { ok: false, kind: 'network', error: 'e' } as const
    expect(reducer(empty, { type: 'responded', response: r }).response).toBe(r)
    expect(reducer(empty, { type: 'sendingChanged', sending: true }).sending).toBe(true)
  })

  it('select on the already-selected request is a no-op (keeps draft and response)', () => {
    const base: State = {
      ...empty, tree, selected: { dir: 'a', file: 'r.json' }, draft: { ...doc, url: 'edited' },
      response: { ok: false, kind: 'network', error: 'e' }
    }
    expect(reducer(base, { type: 'select', dir: 'a', file: 'r.json' })).toBe(base)
  })

  describe('treeRefreshed', () => {
    const doc2: RequestDoc = { ...doc, name: 'Other' }
    const tree2: WorkspaceTree = {
      ...tree,
      folders: [
        { dir: 'a', requests: [{ file: 'r.json', doc }] },
        { dir: 'b', requests: [{ file: 'moved.json', doc }, { file: 'o.json', doc: doc2 }] }
      ]
    }
    const sel: State = {
      ...empty, tree, selected: { dir: 'a', file: 'r.json' }, draft: { ...doc, url: 'edited' },
      response: { ok: false, kind: 'network', error: 'e' }, sending: true
    }
    it('keeps selection, draft, response and sending when the file still exists', () => {
      const s = reducer(sel, { type: 'treeRefreshed', tree: tree2 })
      expect(s.tree).toBe(tree2)
      expect(s.selected).toEqual({ dir: 'a', file: 'r.json' })
      expect(s.draft?.url).toBe('edited')
      expect(s.response).toBe(sel.response)
      expect(s.sending).toBe(true)
    })
    it('clears selection and draft when the file is gone', () => {
      const gone: WorkspaceTree = { ...tree, folders: [{ dir: 'a', requests: [] }] }
      const s = reducer(sel, { type: 'treeRefreshed', tree: gone })
      expect(s.selected).toBeNull()
      expect(s.draft).toBeNull()
      expect(s.response).toBeNull()
      expect(s.sending).toBe(false)
    })
    it('re-points selection to the new location, keeping draft edits', () => {
      const s = reducer(sel, { type: 'treeRefreshed', tree: tree2, reselect: { dir: 'b', file: 'moved.json' } })
      expect(s.selected).toEqual({ dir: 'b', file: 'moved.json' })
      expect(s.draft?.url).toBe('edited')
    })
    it('takes the new name into the draft on rename', () => {
      const t: WorkspaceTree = { ...tree, folders: [{ dir: 'a', requests: [{ file: 'n.json', doc: { ...doc, name: 'N' } }] }] }
      const s = reducer(sel, { type: 'treeRefreshed', tree: t, reselect: { dir: 'a', file: 'n.json' } })
      expect(s.draft).toMatchObject({ name: 'N', url: 'edited' })
    })
    it('ignores a reselect that does not exist and clears if selection is gone', () => {
      const s = reducer(sel, { type: 'treeRefreshed', tree: { ...tree, folders: [] }, reselect: { dir: 'x', file: 'y' } })
      expect(s.selected).toBeNull()
      expect(s.draft).toBeNull()
    })
  })
  it('closed returns to the empty state and bumps draftId', () => {
    const busy: State = {
      tree, selected: { dir: 'a', file: 'r.json' }, draft: doc, response: { ok: false, kind: 'cancelled', error: 'x' },
      sending: true, draftId: 4, unsaved: { 'a/r.json': true }
    }
    expect(reducer(busy, { type: 'closed' })).toEqual({ ...empty, draftId: 5 })
  })
})
