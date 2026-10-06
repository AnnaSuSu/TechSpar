import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_AUDIO_SETTINGS_CHANNEL, DESKTOP_BOOTSTRAP_CHANNEL, DESKTOP_RUNTIME_CHANNEL, type DesktopBootstrapSession, type DesktopRuntimeInfo } from './contracts.ts'

contextBridge.exposeInMainWorld('techsparDesktop', {
  getRuntimeInfo: (): Promise<DesktopRuntimeInfo> => ipcRenderer.invoke(DESKTOP_RUNTIME_CHANNEL),
  bootstrapSession: (): Promise<DesktopBootstrapSession> => ipcRenderer.invoke(DESKTOP_BOOTSTRAP_CHANNEL),
  openAudioSettings: (kind: 'microphone' | 'system'): Promise<void> => ipcRenderer.invoke(DESKTOP_AUDIO_SETTINGS_CHANNEL, kind),
})
