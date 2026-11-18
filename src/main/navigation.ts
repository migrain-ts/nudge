/** The window may only "navigate" to the page it already shows (a reload); the hash is ignored. */
export function isAllowedNavigation(targetUrl: string, currentUrl: string): boolean {
  try {
    const strip = (u: string) => { const x = new URL(u); x.hash = ''; return x.href }
    return strip(targetUrl) === strip(currentUrl)
  } catch {
    return false
  }
}
