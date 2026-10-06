type TechSparDesktopRuntimeInfo = {
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

type TechSparDesktopBootstrapSession = {
  token: string
  user: { id: string; email: string; name: string; is_admin: boolean }
}

interface Window {
  techsparDesktop?: {
    getRuntimeInfo(): Promise<TechSparDesktopRuntimeInfo>
    bootstrapSession(): Promise<TechSparDesktopBootstrapSession>
    openAudioSettings?(kind: 'microphone' | 'system'): Promise<void>
  }
}
