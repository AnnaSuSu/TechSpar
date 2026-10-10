// Only a local-storage namespace; authentication remains server-side.
export function jobPrepDraftKey(token: string | null): string | null {
  try {
    const part = token?.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return typeof payload.sub === 'string' && payload.sub ? `jobprep-draft:${encodeURIComponent(payload.sub)}` : null
  } catch { return null }
}
