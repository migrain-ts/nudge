import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloseGate } from './closeGate'

describe('createCloseGate', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const make = () => {
    const notify = vi.fn()
    const proceed = vi.fn()
    return { notify, proceed, gate: createCloseGate({ notify, proceed, timeoutMs: 3000 }) }
  }

  it('first close request is prevented and the renderer is notified', () => {
    const { gate, notify, proceed } = make()
    expect(gate.request()).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(proceed).not.toHaveBeenCalled()
  })

  it('repeated requests while waiting are prevented without notifying again', () => {
    const { gate, notify } = make()
    gate.request(); gate.request()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('ready lets the next close through and re-closes once', () => {
    const { gate, proceed } = make()
    gate.request()
    gate.ready()
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(gate.request()).toBe(false)
    vi.advanceTimersByTime(10000)
    expect(proceed).toHaveBeenCalledTimes(1) // the timeout was cleared
  })

  it('a stuck renderer cannot block: the timeout allows the close', () => {
    const { gate, proceed } = make()
    gate.request()
    vi.advanceTimersByTime(2999)
    expect(proceed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(gate.request()).toBe(false)
  })

  it('ready without a close request is ignored', () => {
    const { gate, proceed } = make()
    gate.ready()
    expect(proceed).not.toHaveBeenCalled()
    expect(gate.request()).toBe(true)
  })
})
