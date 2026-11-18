/** Relays `app:before-close` to the page's single listener; with no listener it answers `ready` itself (nothing to save). */
export function createBeforeClose(ready: () => void) {
  let cb: (() => void) | null = null
  return {
    fire() { if (cb) cb(); else ready() },
    subscribe(f: () => void) {
      cb = f
      return () => { if (cb === f) cb = null }
    }
  }
}
