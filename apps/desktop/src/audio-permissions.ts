import { desktopCapturer, session, shell, type BrowserWindow } from 'electron'

export function sameOrigin(candidate: string, expected: string): boolean {
  try { return new URL(candidate).origin === new URL(expected).origin } catch { return false }
}

export function configureAudioPermissions(window: BrowserWindow, origin: string): void {
  const trusted = (contents: Electron.WebContents | null, url?: string) => contents === window.webContents && Boolean(url && sameOrigin(url, origin))
  session.defaultSession.setPermissionCheckHandler((contents, permission, url) => trusted(contents, url) && (permission === 'media' || String(permission) === 'display-capture'))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(trusted(contents, details.requestingUrl) && (String(permission) === 'display-capture' || (permission === 'media' && !('mediaTypes' in details && details.mediaTypes?.includes('video')))))
  })
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame !== window.webContents.mainFrame || !sameOrigin(request.securityOrigin, origin) || !request.audioRequested || !request.userGesture) { callback({}); return }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      if (!sources[0] || window.isDestroyed()) { callback({}); return }
      callback({ video: sources[0], audio: 'loopback' })
    } catch { callback({}) }
  }, { useSystemPicker: process.platform === 'darwin' })
}

export async function openAudioSettings(kind: unknown): Promise<void> {
  if (kind !== 'microphone' && kind !== 'system') throw new Error('Invalid audio permission')
  if (process.platform === 'darwin') await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'}`)
  else if (process.platform === 'win32') await shell.openExternal(kind === 'microphone' ? 'ms-settings:privacy-microphone' : 'ms-settings:sound')
}
