import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { BackendSupervisor, type BackendLaunch, type BackendReady } from './backend-supervisor.ts'
import { DESKTOP_AUDIO_SETTINGS_CHANNEL, DESKTOP_BOOTSTRAP_CHANNEL, DESKTOP_RUNTIME_CHANNEL, type DesktopBootstrapSession, type DesktopRuntimeInfo } from './contracts.ts'
import { configureAudioPermissions, openAudioSettings, sameOrigin } from './audio-permissions.ts'
import { loadOrCreateRuntimeSecrets } from './runtime-secrets.ts'

app.enableSandbox()
if (process.env.TECHSPAR_DESKTOP_USER_DATA_DIR) app.setPath('userData', resolve(process.env.TECHSPAR_DESKTOP_USER_DATA_DIR))
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()

const sourceDir = fileURLToPath(new URL('.', import.meta.url))
const smokeMode = process.argv.includes('--smoke-test')
let mainWindow: BrowserWindow | undefined
let backend: BackendSupervisor | undefined
let backendReady: BackendReady | undefined
let rendererOrigin = ''
let quitting = false
let bootstrapCredentials: { email: string; password: string } | undefined

function projectRoot(): string {
  return resolve(process.env.TECHSPAR_PROJECT_ROOT || join(app.getAppPath(), '..', '..'))
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => error ? reject(error) : resolvePort(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

async function backendLaunch(): Promise<BackendLaunch> {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  const secrets = await loadOrCreateRuntimeSecrets(join(userData, 'runtime-secrets.json'))
  const defaultEmail = process.env.DEFAULT_EMAIL || 'admin@techspar.local'
  const defaultPassword = process.env.DEFAULT_PASSWORD || secrets.bootstrapPassword
  bootstrapCredentials = { email: defaultEmail, password: defaultPassword }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: app.isPackaged ? String(await freePort()) : process.env.TECHSPAR_DESKTOP_API_PORT || '8000',
    TECHSPAR_BASE_DIR: userData,
    TECHSPAR_DATA_DIR: dataDir,
    DB_PATH: join(dataDir, 'interviews.db'),
    TECHSPAR_MODEL_CACHE_DIR: join(userData, 'models'),
    JWT_SECRET: process.env.JWT_SECRET || secrets.jwtSecret,
    VOICEPRINT_ENCRYPTION_KEY: process.env.VOICEPRINT_ENCRYPTION_KEY || secrets.voiceprintKey,
    DEFAULT_EMAIL: defaultEmail,
    DEFAULT_PASSWORD: defaultPassword,
    TECHSPAR_DESKTOP_MODE: '1',
  }
  if (app.isPackaged) {
    const executable = join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'techspar-api.exe' : 'techspar-api')
    const onnxRuntime = join(process.resourcesPath, 'backend', 'onnxruntime')
    const webDir = join(process.resourcesPath, 'web')
    await Promise.all([access(executable), access(onnxRuntime), access(join(webDir, 'index.html'))])
    if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = [onnxRuntime, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
    else if (process.platform === 'linux') env.LD_LIBRARY_PATH = [onnxRuntime, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
    else env.PATH = [onnxRuntime, process.env.PATH].filter(Boolean).join(';')
    env.TECHSPAR_WEB_DIR = webDir
    return { command: executable, args: [], cwd: userData, env }
  }
  const root = projectRoot()
  return { command: process.env.TECHSPAR_BUN_EXECUTABLE || 'bun', args: ['apps/api/src/entry.bun.ts'], cwd: root, env }
}

function runtimeInfo(): DesktopRuntimeInfo {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron || '',
    chromeVersion: process.versions.chrome || '',
    nodeVersion: process.versions.node,
  }
}

function registerIpc(): void {
  const assertTrusted = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow?.webContents.mainFrame || !event.senderFrame?.url || !sameOrigin(event.senderFrame.url, rendererOrigin)) throw new Error('Untrusted IPC sender')
  }
  ipcMain.handle(DESKTOP_AUDIO_SETTINGS_CHANNEL, async (event, kind: unknown) => { assertTrusted(event); await openAudioSettings(kind) })
  ipcMain.handle(DESKTOP_RUNTIME_CHANNEL, (event) => {
    assertTrusted(event)
    return runtimeInfo()
  })
  ipcMain.handle(DESKTOP_BOOTSTRAP_CHANNEL, async (event): Promise<DesktopBootstrapSession> => {
    assertTrusted(event)
    if (!backendReady || !bootstrapCredentials) throw new Error('Desktop backend is not ready')
    const response = await fetch(`${backendReady.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bootstrapCredentials),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Desktop session bootstrap failed with HTTP ${response.status}`)
    return response.json() as Promise<DesktopBootstrapSession>
  })
}

async function createWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return }
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: '#09090b',
    show: false,
    title: 'TechSpar',
    webPreferences: {
      preload: resolve(sourceDir, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window
  configureAudioPermissions(window, rendererOrigin)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (sameOrigin(url, rendererOrigin)) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
  await window.loadURL(process.env.TECHSPAR_RENDERER_URL || backendReady!.origin)
}

async function smokeTest(): Promise<void> {
  const response = await fetch(`${backendReady!.origin}/api/`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`Desktop backend smoke failed with HTTP ${response.status}`)
  console.log(JSON.stringify({ event: 'techspar:desktop-smoke-ok', packaged: app.isPackaged, port: backendReady!.port, runtime: runtimeInfo() }))
}

async function boot(): Promise<void> {
  if (!singleInstance) return
  await app.whenReady()
  backend = new BackendSupervisor(await backendLaunch(), (message) => {
    if (quitting) return
    dialog.showErrorBox('TechSpar 服务意外退出', message)
    app.quit()
  })
  backendReady = await backend.start()
  rendererOrigin = process.env.TECHSPAR_RENDERER_URL || backendReady.origin
  if (smokeMode) { await smokeTest(); quitting = true; await backend.stop(); app.exit(0); return }
  registerIpc()
  await createWindow()
}

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() } })
app.on('activate', () => { if (backendReady && !smokeMode && !quitting) void createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', (event) => {
  if (quitting || !backend) return
  event.preventDefault(); quitting = true
  void backend.stop().finally(() => app.quit())
})

void boot().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  dialog.showErrorBox('TechSpar 启动失败', message)
  app.exit(1)
})
