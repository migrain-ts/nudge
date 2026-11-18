import { promises as fs } from 'node:fs'
import path from 'node:path'

const MAX = 10

async function readRaw(file: string): Promise<string[]> {
  try {
    const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    return Array.isArray(data) ? data.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export async function addRecent(file: string, root: string): Promise<void> {
  const list = [root, ...(await readRaw(file)).filter((p) => p !== root)].slice(0, MAX)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(list))
}

export async function readRecents(file: string): Promise<string[]> {
  const out: string[] = []
  for (const p of await readRaw(file)) {
    try {
      if ((await fs.stat(p)).isDirectory()) out.push(p)
    } catch {
      // path gone: skip
    }
  }
  return out.slice(0, MAX)
}
