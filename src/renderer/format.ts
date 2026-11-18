export const formatDuration = (ms: number) =>
  ms >= 999.5 ? `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')} s` : `${Math.round(ms)} ms`

export function formatSize(b: number) {
  if (b < 1024) return `${b} B`
  const f = (n: number) => n.toFixed(1).replace(/\.0$/, '')
  return b < 1024 * 1024 ? `${f(b / 1024)} KB` : `${f(b / 1024 / 1024)} MB`
}

export const ignoredLabel = (n: number) => (n === 1 ? '1 file ignored' : `${n} files ignored`)
