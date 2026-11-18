import { describe, expect, it, vi } from 'vitest'
import { createBeforeClose } from './beforeClose'

describe('createBeforeClose', () => {
  it('without a listener, answers readyToClose immediately', () => {
    const ready = vi.fn()
    createBeforeClose(ready).fire()
    expect(ready).toHaveBeenCalledTimes(1)
  })
  it('with a listener, calls it and leaves readyToClose to the page', () => {
    const ready = vi.fn(), cb = vi.fn()
    const b = createBeforeClose(ready)
    b.subscribe(cb)
    b.fire()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(ready).not.toHaveBeenCalled()
  })
  it('after unsubscribe it answers immediately again; a stale unsubscribe does not remove a newer listener', () => {
    const ready = vi.fn(), cb = vi.fn(), cb2 = vi.fn()
    const b = createBeforeClose(ready)
    const off = b.subscribe(cb)
    off(); b.fire()
    expect(ready).toHaveBeenCalledTimes(1)
    const off1 = b.subscribe(cb)
    b.subscribe(cb2)
    off1(); b.fire()
    expect(cb2).toHaveBeenCalledTimes(1)
  })
})
