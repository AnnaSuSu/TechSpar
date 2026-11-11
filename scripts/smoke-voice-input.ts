import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

// Real Chromium capture/encoding with synthetic audio; never opens the physical mic
// or calls a paid ASR provider. Run after build:web to include production styles.
const root = process.cwd()
const temp = await mkdtemp(join(tmpdir(), 'techspar-voice-'))
const output = join(root, 'dist', 'voice-input-smoke')
const requireDesktop = createRequire(join(root, 'apps/desktop/package.json'))
const electron = requireDesktop('electron') as string
const css = (await readdir(join(root, 'frontend/dist/assets'))).find((name) => /^index-.*\.css$/.test(name))
if (!css) throw new Error('Run bun run build:web before smoke:voice')
const cssContent = await readFile(join(root, 'frontend/dist/assets', css))
await mkdir(output, { recursive: true })

function wav(silent: boolean): Uint8Array {
  const rate = 16000, count = rate * 8
  const bytes = Buffer.alloc(44 + count * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  bytes.writeUInt32LE(count * 2, 40)
  for (let index = 0; index < count; index++) bytes.writeInt16LE(silent ? 0 : Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 12000), 44 + index * 2)
  return bytes
}

const fixture = join(root, 'frontend', `.voice-smoke-${process.pid}.tsx`)
const main = join(temp, 'main.ts')
let responseMode = 'success'
const uploads: Array<{ name: string; bytes: number; mode: string; source: string }> = []
let source = 'tone'
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/smoke.css') return new Response(cssContent, { headers: { 'Content-Type': 'text/css' } })
    if (url.pathname === '/mode') { responseMode = url.searchParams.get('name') || 'success'; return new Response('ok') }
    if (url.pathname === '/api/transcribe') {
      const file = (await request.formData()).get('file') as File
      if (!file || !file.size || file.name !== 'recording.webm') return Response.json({ detail: 'Invalid recording' }, { status: 400 })
      const mode = responseMode
      uploads.push({ name: file.name, bytes: file.size, mode, source })
      if (mode === 'error') return Response.json({ detail: 'Synthetic provider failure' }, { status: 500 })
      if (mode === 'delay') await Bun.sleep(1500)
      return Response.json({ text: mode === 'empty' || source === 'silence' ? '' : '合成音频转写成功' })
    }
    if (url.pathname === '/fixture.js') return new Response(Bun.file(join(temp, 'renderer.js')), { headers: { 'Content-Type': 'text/javascript' } })
    if (url.pathname.startsWith('/assets/') && !url.pathname.includes('..')) return new Response(Bun.file(join(root, 'frontend/dist', url.pathname)))
    return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/smoke.css"><body><div id="root" style="height:100vh;display:flex;flex-direction:column"></div><script type="module" src="/fixture.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html' } })
  },
})

try {
  await writeFile(fixture, `
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TaskStatusProvider } from './src/contexts/TaskStatusContext';
import Interview from './src/pages/Interview';
const streams = [];
const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async (input) => { const stream = await original(input); streams.push(stream); return stream; };
window.smokeStreams = streams;
const mode = new URLSearchParams(location.search).get('mode') || 'resume';
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[{ pathname: '/interview/synthetic', state: {
  mode, status: 'ongoing', message: '请介绍一下你最近完成的技术项目。',
  questions: [{ id: 'q1', question: '请解释事件循环。', focus_area: 'JavaScript' }],
} }]}><TaskStatusProvider><Routes><Route path="/interview/:sessionId" element={<Interview />} /></Routes></TaskStatusProvider></MemoryRouter>);
`)
  const renderer = await Bun.build({ entrypoints: [fixture], tsconfig: join(root, 'frontend/tsconfig.json'), target: 'browser', outdir: temp, naming: 'renderer.js' })
  if (!renderer.success) throw new Error(renderer.logs.join('\n'))
  await writeFile(main, String.raw`
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configureAudioPermissions } from ${JSON.stringify(join(root, 'apps/desktop/src/audio-permissions.ts'))};
app.enableSandbox();
const origin = process.env.VOICE_SMOKE_ORIGIN;
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.VOICE_SMOKE_WAV);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const silent = process.env.VOICE_SMOKE_SOURCE === 'silence';
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
await app.whenReady();
const window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
configureAudioPermissions(window, origin);
const js = (code) => window.webContents.executeJavaScript(code, true);
const checks = [];
async function until(code, label) {
  for (let index = 0; index < 100; index++) { if (await js(code)) return; await pause(100); }
  throw new Error(label + ': ' + await js('document.body.innerText'));
}
async function begin() {
  await until('!!document.querySelector(\'[aria-label="语音输入"]\')', 'mic button');
  await js('document.querySelector(\'[aria-label="语音输入"]\').click()');
  await until('!!document.querySelector(\'[aria-label="停止录音并转成文字"]\')', 'recording');
  await js('window.smokeMicButton = document.querySelector(\'[aria-label="停止录音并转成文字"]\')');
  await pause(1200);
  assert.equal(await js('window.smokeMicButton === document.querySelector(\'[aria-label="停止录音并转成文字"]\')'), true, 'meter updates must preserve the clickable mic button');
}
async function stop() { await js('document.querySelector(\'[aria-label="停止录音并转成文字"]\').click()'); }
async function load(mode = 'resume') { await window.loadURL(origin + '/?mode=' + mode); }
try {
  for (const mode of ['resume', 'topic_drill']) {
    await load(mode); await begin();
    const level = await js('document.querySelector("meter")?.value');
    assert.ok(silent ? level === 0 : level > 0, 'input level: ' + level);
    if (mode === 'resume') {
      await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await writeFile(join(process.env.VOICE_SMOKE_OUTPUT, (silent ? 'silence' : 'tone') + '-recording.png'), (await window.webContents.capturePage()).toPNG());
    }
    await stop();
    if (silent) {
      await until('document.querySelector(\'[role="alert"]\')?.textContent.includes("未识别到语音")', 'silent recording diagnosis');
      assert.equal(await js('document.querySelector("textarea").value'), '');
    } else await until('document.querySelector("textarea")?.value.includes("合成音频转写成功")', 'answer backfill');
    assert.equal(await js('window.smokeStreams.every(s => s.getTracks().every(t => t.readyState === "ended"))'), true);
    checks.push(mode + (silent ? ':silence-level-empty-transcript-release' : ':capture-level-upload-backfill-release'));
  }
  if (!silent) {
    for (const outcome of ['error', 'empty']) {
      await fetch(origin + '/mode?name=' + outcome); await load(); await begin(); await stop();
      await until('!!document.querySelector(\'[role="alert"]\')', outcome + ' message');
      const error = await js('document.querySelector(\'[role="alert"]\').textContent');
      assert.ok(error.includes(outcome === 'error' ? '语音识别失败' : '未识别到语音'));
      await fetch(origin + '/mode?name=success'); await begin(); await stop();
      await until('document.querySelector("textarea")?.value.includes("合成音频转写成功")', 'retry');
      checks.push(outcome + ':feedback-and-retry');
    }
    await load(); await begin();
    await js('window.smokeStreams.forEach(s => s.getTracks().forEach(t => t.stop()))');
    await until('!!document.querySelector(\'[role="alert"]\') && !document.querySelector(\'[aria-label="停止录音并转成文字"]\')', 'automatic stop');
    checks.push('native-track-stop:feedback-and-idle');
    await fetch(origin + '/mode?name=delay'); await load(); await begin(); await stop();
    await until('document.body.innerText.includes("正在转成文字")', 'transcribing');
    await js('[...document.querySelectorAll("button")].find(b => b.textContent === "取消语音输入").click()');
    await pause(1800);
    assert.equal(await js('document.querySelector("textarea").value'), '');
    checks.push('cancel-transcription:no-late-backfill');
  }
  console.log(JSON.stringify({ source: silent ? 'silence' : 'tone', checks, electron: process.versions.electron, chrome: process.versions.chrome }));
  window.destroy(); app.exit(0);
} catch (error) { console.error(error); window.destroy(); app.exit(1); }
}
void run().catch(error => { console.error(error); app.exit(1); });
`)
  const mainBuild = await Bun.build({ entrypoints: [main], target: 'node', format: 'esm', external: ['electron'], outdir: temp, naming: 'main.mjs' })
  if (!mainBuild.success) throw new Error(mainBuild.logs.join('\n'))
  for (source of ['tone', 'silence']) {
    responseMode = 'success'
    const path = join(temp, `${source}.wav`)
    await writeFile(path, wav(source === 'silence'))
    const child = Bun.spawn([electron, join(temp, 'main.mjs')], {
      stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
        VOICE_SMOKE_ORIGIN: server.url.origin, VOICE_SMOKE_WAV: path, VOICE_SMOKE_SOURCE: source, VOICE_SMOKE_OUTPUT: output },
    })
    const watchdog = setTimeout(() => child.kill(), 90_000)
    const code = await child.exited
    clearTimeout(watchdog)
    if (code !== 0) throw new Error(`${source} smoke failed: ${code}`)
  }
  await writeFile(join(output, 'uploads.json'), JSON.stringify(uploads, null, 2))
  console.log(`Voice input smoke passed: ${uploads.length} synthetic uploads. Evidence: ${output}`)
} finally {
  server.stop(true)
  await rm(fixture, { force: true })
  // Only delete the exact temporary directory created for this run.
  if (resolve(temp).startsWith(resolve(tmpdir()) + sep) && basename(temp).startsWith('techspar-voice-')) await rm(temp, { recursive: true, force: true })
}
