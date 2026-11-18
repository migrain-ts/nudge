import { describe, it, expect } from 'vitest'
import { createQueue } from './queue'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createQueue', () => {
  it('runs overlapping tasks strictly one after the other', async () => {
    const q = createQueue()
    const log: string[] = []
    const a = q(async () => {
      log.push('a start')
      await sleep(30)
      log.push('a end')
      return 1
    })
    const b = q(async () => {
      log.push('b start')
      await sleep(5)
      log.push('b end')
      return 2
    })
    expect(await Promise.all([a, b])).toEqual([1, 2])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end'])
  })
  it('a rejected task does not block the next', async () => {
    const q = createQueue()
    const a = q(async () => {
      throw new Error('boom')
    })
    const b = q(async () => 'ok')
    await expect(a).rejects.toThrow('boom')
    expect(await b).toBe('ok')
  })
})
