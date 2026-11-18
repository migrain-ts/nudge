import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addRecent, readRecents } from './recents'

let tmp: string
let file: string
const mk = async (n: string): Promise<string> => {
  const p = path.join(tmp, n)
  await fs.mkdir(p)
  return p
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rq-recents-'))
  file = path.join(tmp, 'recents.json')
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('recents', () => {
  it('returns [] when no file', async () => {
    expect(await readRecents(file)).toEqual([])
  })
  it('keeps 10 most recent first', async () => {
    const all: string[] = []
    for (let i = 0; i < 12; i++) {
      const p = await mk(`p${i}`)
      all.push(p)
      await addRecent(file, p)
    }
    const r = await readRecents(file)
    expect(r).toHaveLength(10)
    expect(r[0]).toBe(all[11])
    expect(r[9]).toBe(all[2])
  })
  it('re-adding moves to front without duplicate', async () => {
    const a = await mk('a')
    const b = await mk('b')
    await addRecent(file, a)
    await addRecent(file, b)
    await addRecent(file, a)
    expect(await readRecents(file)).toEqual([a, b])
  })
  it('filters paths deleted from disk', async () => {
    const a = await mk('a')
    const b = await mk('b')
    await addRecent(file, a)
    await addRecent(file, b)
    await fs.rm(b, { recursive: true })
    expect(await readRecents(file)).toEqual([a])
  })
  it('tolerates a corrupt file', async () => {
    await fs.writeFile(file, '{nope')
    expect(await readRecents(file)).toEqual([])
  })
})
