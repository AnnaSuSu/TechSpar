import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VoiceInputSession, type VoiceInputState } from "../src/lib/voice-input";
import useVoiceInput from "../src/hooks/useVoiceInput";
import VoiceInputFeedback from "../src/components/VoiceInputFeedback";
import { setApiErrorHandler } from "../src/api/client";

const browser = new GlobalWindow({ url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
const originalFetch = globalThis.fetch;
const sessions: VoiceInputSession[] = [];
let root: Root | undefined;
let permissions: () => Promise<Stream>;
let constraints: MediaStreamConstraints[];
let stream: Stream;
let signalLevel: number;
let devices: MediaDeviceInfo[];
let media: EventTarget & { getUserMedia: (input: MediaStreamConstraints) => Promise<Stream>; enumerateDevices: () => Promise<MediaDeviceInfo[]> };
let requests: RequestInit[];
let respond: (options: RequestInit) => Promise<Response>;
let latest: ReturnType<typeof useVoiceInput>;
let result: string[];

class Track extends EventTarget {
  kind = "audio";
  readyState = "live";
  label = "USB 麦克风";
  stops = 0;
  stop() { this.stops++; this.readyState = "ended"; }
  disconnect() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
}
class Stream {
  tracks = [new Track()];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}
class Recorder {
  static instances: Recorder[] = [];
  static supported = "audio/webm;codecs=opus";
  static failure = "";
  static bytes = 2000;
  static isTypeSupported(type: string) { return type === Recorder.supported; }
  state = "inactive";
  mimeType: string;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor(_stream: Stream, options: { mimeType: string }) {
    if (Recorder.failure === "constructor") throw new Error("constructor failed");
    this.mimeType = options.mimeType;
    Recorder.instances.push(this);
  }
  start() { if (Recorder.failure === "start") throw new Error("start failed"); this.state = "recording"; }
  data(bytes = Recorder.bytes) { this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) }); }
  stop() {
    if (Recorder.failure === "stop") throw new Error("stop failed");
    this.state = "inactive";
    queueMicrotask(() => { this.data(); this.onstop?.(); });
  }
}
class AudioNode {
  connect() {}
  disconnect() {}
}
class Context {
  static instances: Context[] = [];
  state = "running";
  constructor() { Context.instances.push(this); }
  createMediaStreamSource() { return new AudioNode(); }
  createAnalyser() { return Object.assign(new AudioNode(), { fftSize: 2048, getFloatTimeDomainData(data: Float32Array) { data.fill(signalLevel); } }); }
  async resume() {}
  async close() { this.state = "closed"; }
}
function globalValue(key: string, value: unknown) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const device = (id: string, label = id) => ({ kind: "audioinput", deviceId: id, label, groupId: "test" }) as MediaDeviceInfo;
function fixture(timeout = 1000) {
  const changes: VoiceInputState[] = [];
  const session = new VoiceInputSession({ onChange(state) { changes.push(state); }, onResult(text) { result.push(text); }, transcriptionTimeoutMs: timeout });
  sessions.push(session);
  return { session, changes };
}
async function mount() {
  const host = document.createElement("main"); document.body.append(host);
  root = createRoot(host);
  function Probe() {
    latest = useVoiceInput({ onResult(text) { result.push(text); } });
    return <VoiceInputFeedback voice={latest} />;
  }
  await act(async () => { root!.render(<Probe />); });
}

beforeEach(() => {
  stream = new Stream(); signalLevel = 0; constraints = []; requests = []; result = [];
  Recorder.instances = []; Recorder.supported = "audio/webm;codecs=opus"; Recorder.failure = ""; Recorder.bytes = 2000;
  Context.instances = [];
  permissions = async () => stream;
  devices = [device("usb", "USB 麦克风")];
  media = Object.assign(new EventTarget(), {
    getUserMedia(input: MediaStreamConstraints) { constraints.push(input); return permissions(); },
    async enumerateDevices() { return devices; },
  });
  for (const [key, value] of Object.entries({
    window: browser, document: browser.document, navigator: { mediaDevices: media },
    MediaRecorder: Recorder, AudioContext: Context, IS_REACT_ACT_ENVIRONMENT: true,
  })) globalValue(key, value);
  respond = async () => json({ text: "识别到的回答" });
  globalThis.fetch = (async (url, options) => {
    expect(String(url)).toBe("/api/transcribe");
    requests.push(options!);
    return respond(options!);
  }) as typeof fetch;
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = undefined;
  for (const session of sessions.splice(0)) session.cancel();
  setApiErrorHandler(null);
  document.body.innerHTML = "";
  globalThis.fetch = originalFetch;
});
afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});

test("records the final chunk, uploads its actual format, and releases capture before ASR", async () => {
  const { session } = fixture();
  await session.start("usb");
  expect(constraints[0]).toMatchObject({ audio: { deviceId: { exact: "usb" } } });
  expect(session.state.inputLabel).toBe("USB 麦克风");
  respond = async (options) => {
    expect(stream.tracks[0]!.stops).toBe(1);
    expect(Context.instances[0]!.state).toBe("closed");
    const file = (options.body as FormData).get("file") as File;
    expect(file.name).toBe("recording.webm");
    expect(file.size).toBe(2000);
    return json({ text: "识别到的回答" });
  };
  session.stop(); session.stop();
  await flush();
  expect(result).toEqual(["识别到的回答"]);
  expect(requests).toHaveLength(1);
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toBe("");
});

for (const [name, message] of [
  ["NotAllowedError", "允许此应用"], ["NotFoundError", "重新选择"],
  ["OverconstrainedError", "重新选择"], ["NotReadableError", "占用麦克风"],
]) test(`reports ${name} and allows the next attempt`, async () => {
  permissions = async () => { throw new DOMException("synthetic", name); };
  const { session } = fixture();
  await session.start();
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toContain(message);
  expect(requests).toHaveLength(0);
  permissions = async () => stream;
  const retry = fixture().session;
  await retry.start(); retry.stop(); await flush();
  expect(result).toHaveLength(1);
});

test("cancellation releases a stream returned after permission without starting a recorder", async () => {
  const pending = Promise.withResolvers<Stream>(); permissions = () => pending.promise;
  const { session, changes } = fixture();
  const start = session.start();
  session.cancel();
  const count = changes.length;
  pending.resolve(stream); await start;
  expect(stream.tracks[0]!.stops).toBe(1);
  expect(Recorder.instances).toHaveLength(0);
  expect(changes).toHaveLength(count);
});

for (const failure of ["constructor", "start"]) test(`cleans up after recorder ${failure} failure`, async () => {
  Recorder.failure = failure;
  const { session } = fixture(); await session.start();
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toContain("录音启动失败");
  expect(stream.tracks[0]!.stops).toBe(1);
});

test("rejects an ended or empty audio stream", async () => {
  stream.tracks[0]!.readyState = "ended";
  const first = fixture().session; await first.start();
  expect(first.state.error).toContain("未获取到可用");
  stream = new Stream(); stream.tracks = [];
  const second = fixture().session; await second.start();
  expect(second.state.error).toContain("未获取到可用");
  expect(Recorder.instances).toHaveLength(0);
});

for (const event of ["trackEnded", "automaticStop", "recorderError"]) test(`recovers from ${event} without waiting for another click`, async () => {
  const { session } = fixture(); await session.start();
  const recorder = Recorder.instances[0]!;
  if (event === "trackEnded") stream.tracks[0]!.disconnect();
  if (event === "automaticStop") recorder.stop();
  if (event === "recorderError") recorder.onerror?.();
  await flush();
  expect(session.state.status).toBe("idle");
  expect(session.state.error).not.toBe("");
  expect(stream.tracks[0]!.stops).toBe(1);
  expect(Context.instances[0]!.state).toBe("closed");
  expect(requests).toHaveLength(0);
});

test("reports short and oversized recordings without uploading", async () => {
  Recorder.bytes = 100;
  const first = fixture().session; await first.start(); first.stop(); await flush();
  expect(first.state.error).toContain("内容太少");
  stream = new Stream();
  const second = fixture().session; await second.start();
  Recorder.instances.at(-1)!.data(7 * 1024 * 1024 + 1);
  await flush();
  expect(second.state.error).toContain("超过 7 MiB");
  expect(requests).toHaveLength(0);
});

test("a sufficiently long compressed recording is not rejected just for its byte size", async () => {
  Recorder.bytes = 600;
  const { session } = fixture(); await session.start();
  await new Promise((resolve) => setTimeout(resolve, 510));
  session.stop(); await flush();
  expect(requests).toHaveLength(1);
  expect(session.state.error).toBe("");
});

for (const [mime, extension] of [["audio/ogg;codecs=opus", "ogg"], ["audio/mp4", "m4a"]]) test(`preserves ${mime} when WebM is unavailable`, async () => {
  Recorder.supported = mime!;
  const { session } = fixture(); await session.start(); session.stop(); await flush();
  const file = (requests[0]!.body as FormData).get("file") as File;
  expect(file.name).toBe(`recording.${extension}`);
  expect(file.type).toBe(mime!);
});

test("reports unsupported codecs and releases the microphone", async () => {
  Recorder.supported = "unsupported";
  const { session } = fixture(); await session.start();
  expect(session.state.error).toContain("不支持录音格式");
  expect(stream.tracks[0]!.stops).toBe(1);
});

for (const outcome of ["empty", "httpError", "networkError", "malformed"]) test(`reports ${outcome} from the transcription endpoint`, async () => {
  respond = async () => {
    if (outcome === "networkError") throw new TypeError("fetch failed");
    if (outcome === "httpError") return json({ detail: "provider failed" }, 500);
    if (outcome === "malformed") return new Response("not json");
    return json({ text: "  " });
  };
  const { session } = fixture(); await session.start(); session.stop(); await flush();
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toContain(outcome === "empty" ? "未识别到语音" : "语音识别失败");
  expect(result).toHaveLength(0);
});

test("preserves the global handled API error flow", async () => {
  let handled = false;
  setApiErrorHandler(() => { handled = true; return true; });
  respond = async () => json({ code: "quota_exceeded" }, 403);
  const { session } = fixture(); await session.start(); session.stop(); await flush();
  expect(handled).toBeTrue();
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toBe("");
});

test("times out even if a transport ignores abort and ignores its late response", async () => {
  const pending = Promise.withResolvers<Response>(); respond = () => pending.promise;
  const { session } = fixture(10); await session.start(); session.stop();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toContain("超时");
  expect(requests[0]!.signal!.aborted).toBeTrue();
  pending.resolve(json({ text: "late" })); await flush();
  expect(result).toHaveLength(0);
});

test("cancels an in-flight transcription and suppresses stale results", async () => {
  const pending = Promise.withResolvers<Response>(); respond = () => pending.promise;
  const { session } = fixture(); await session.start(); session.stop(); await flush();
  session.cancel();
  expect(requests[0]!.signal!.aborted).toBeTrue();
  pending.resolve(json({ text: "late" })); await flush();
  expect(result).toHaveLength(0);
});

test("a synchronous stop failure releases capture and reports an actionable error", async () => {
  const { session } = fixture(); await session.start();
  Recorder.failure = "stop";
  session.stop();
  expect(session.state.status).toBe("idle");
  expect(session.state.error).toContain("无法结束录音");
  expect(stream.tracks[0]!.stops).toBe(1);
  expect(Context.instances[0]!.state).toBe("closed");
});

test("shows silence and signal levels without mistaking byte size for speech", async () => {
  const { session } = fixture(); await session.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(session.state.level).toBe(0);
  expect(session.state.heard).toBeFalse();
  signalLevel = 0.1;
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(session.state.level).toBeGreaterThan(0);
  expect(session.state.heard).toBeTrue();
});

test("records when optional Web Audio metering is unavailable", async () => {
  globalValue("AudioContext", undefined);
  const { session } = fixture(); await session.start(); session.stop(); await flush();
  expect(session.state.level).toBeNull();
  expect(result).toHaveLength(1);
});

test("the hook guards repeated permission clicks and releases late permission after unmount", async () => {
  const pending = Promise.withResolvers<Stream>(); permissions = () => pending.promise;
  await mount();
  await act(async () => { latest.toggle(); latest.toggle(); });
  expect(latest.isStarting).toBeTrue();
  expect(constraints).toHaveLength(1);
  expect(document.body.textContent).toContain("正在请求麦克风权限");
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { pending.resolve(stream); });
  expect(stream.tracks[0]!.stops).toBe(1);
  expect(Recorder.instances).toHaveLength(0);
});

test("the UI selects devices, shows capture status, and recovers after disconnect", async () => {
  await mount();
  const select = document.querySelector("select")!;
  await act(async () => { select.value = "usb"; select.dispatchEvent(new browser.Event("change", { bubbles: true })); });
  await act(async () => { latest.toggle(); });
  expect(constraints[0]).toMatchObject({ audio: { deviceId: { exact: "usb" } } });
  expect(select.disabled).toBeTrue();
  expect(document.body.textContent).toContain("USB 麦克风");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
  expect(document.querySelector("meter")!.value).toBe(0);
  expect(document.body.textContent).toContain("暂未检测到声音");
  await act(async () => { stream.tracks[0]!.disconnect(); devices = []; media.dispatchEvent(new Event("devicechange")); });
  expect(latest.isBusy).toBeFalse();
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("已断开");
  expect(document.body.textContent).toContain("所选麦克风已断开");
  expect(select.disabled).toBeFalse();
});

test("the UI cancels pending permission and can immediately start a fresh attempt", async () => {
  const pending = Promise.withResolvers<Stream>(); permissions = () => pending.promise;
  await mount(); await act(async () => { latest.toggle(); });
  const cancel = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "取消语音输入")!;
  await act(async () => { cancel.click(); });
  expect(latest.isBusy).toBeFalse();
  const oldStream = stream;
  stream = new Stream(); permissions = async () => stream;
  await act(async () => { latest.toggle(); pending.resolve(oldStream); });
  expect(oldStream.tracks[0]!.stops).toBe(1);
  expect(latest.isListening).toBeTrue();
  expect(stream.tracks[0]!.stops).toBe(0);
  await act(async () => { latest.toggle(); await flush(); });
  expect(result).toEqual(["识别到的回答"]);
});

test("unmount aborts transcription and a late result never updates the answer", async () => {
  const pending = Promise.withResolvers<Response>(); respond = () => pending.promise;
  await mount(); await act(async () => { latest.toggle(); });
  await act(async () => { latest.toggle(); await flush(); });
  expect(latest.isTranscribing).toBeTrue();
  await act(async () => { root!.unmount(); }); root = undefined;
  expect(requests[0]!.signal!.aborted).toBeTrue();
  pending.resolve(json({ text: "late" })); await flush();
  expect(result).toHaveLength(0);
});
