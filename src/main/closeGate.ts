/**
 * Lets the renderer save before a window closes. `request()` is called from the window's `close` event:
 * it returns true (prevent) and asks the renderer to flush; `ready()` (renderer done) or the timeout
 * (renderer stuck) then calls `proceed()` to close for real.
 */
export function createCloseGate(opts: { notify(): void; proceed(): void; timeoutMs?: number }) {
  let state: 'idle' | 'waiting' | 'open' = 'idle'
  let timer: ReturnType<typeof setTimeout> | null = null
  const release = (): void => {
    if (state !== 'waiting') return
    if (timer) clearTimeout(timer)
    timer = null
    state = 'open'
    opts.proceed()
  }
  return {
    request(): boolean {
      if (state === 'open') return false
      if (state === 'idle') {
        state = 'waiting'
        timer = setTimeout(release, opts.timeoutMs ?? 3000)
        opts.notify()
      }
      return true
    },
    ready: release
  }
}
