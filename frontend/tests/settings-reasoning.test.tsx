import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Settings from "../src/pages/Settings";

const browser = new GlobalWindow({ url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: browser, document: browser.document, navigator: browser.navigator,
  localStorage: browser.localStorage, IntersectionObserver: browser.IntersectionObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let savedEffort: string | undefined;
let platform = false;
let probeError = "";
let delayProbes = false;
const pendingProbes: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
const probes: Array<Record<string, unknown>> = [];
const saves: Array<{ llm: Record<string, unknown> }> = [];
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  savedEffort = undefined; platform = false; probeError = ""; probes.length = 0; saves.length = 0;
  delayProbes = false; pendingProbes.length = 0;
  globalThis.fetch = (async (url, options) => {
    if (String(url) === "/api/settings/test-llm") {
      probes.push(JSON.parse(String(options?.body)));
      if (delayProbes) return new Promise<Response>((resolve, reject) => { pendingProbes.push({ resolve, reject }); });
      return json(probeError ? { ok: false, error: probeError } : { ok: true });
    }
    if (String(url) === "/api/settings" && options?.method === "PUT") {
      saves.push(JSON.parse(String(options.body)));
      return json({ ok: true, embedding_changed: false });
    }
    if (String(url) === "/api/settings") return json({
      llm: { api_base: "https://provider.test/v1", api_key: "synthetic", model: "test-model", compatibility: "generic", reasoning_effort: savedEffort, temperature: 0.7 },
      training: { num_questions: 10, divergence: 3 }, platform: { llm: platform }, source: platform ? "platform" : "user",
    });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = "";
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  void browser.happyDOM.close();
});

async function mount() {
  const host = document.createElement("main"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Settings />); });
}
const effortSelect = () => document.querySelector<HTMLSelectElement>("#llm-reasoning-effort")!;
const compatibilitySelect = () => document.querySelector<HTMLSelectElement>('[data-tab-id="llm"] select:not(#llm-reasoning-effort)')!;
const temperatureInput = () => document.querySelector<HTMLInputElement>('[data-tab-id="llm"] input[type="number"]')!;
const effortOptions = () => Array.from(effortSelect().options).map((option) => option.value);
const llmCard = () => document.querySelector('[data-tab-id="llm"]')!;
function button(text: string, scope: ParentNode = document) {
  const found = Array.from(scope.querySelectorAll("button")).find((element) => element.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function select(element: HTMLSelectElement, value: string) {
  await act(async () => { element.value = value; element.dispatchEvent(new browser.Event("change", { bubbles: true })); });
}
async function click(element: HTMLButtonElement) { await act(async () => { element.click(); }); }
async function finishProbe(index: number, value: { ok: boolean; error?: string } | Error) {
  await act(async () => {
    if (value instanceof Error) pendingProbes[index]!.reject(value);
    else pendingProbes[index]!.resolve(json(value));
  });
}

test("loads saved effort and sends the current selection to test and save requests", async () => {
  savedEffort = "xhigh"; await mount();
  expect(effortSelect().value).toBe("xhigh");
  expect(effortOptions()).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
  expect(temperatureInput().disabled).toBeTrue();
  expect(llmCard().textContent).toContain("此模式下不使用 Temperature");
  await select(effortSelect(), "high");
  await click(button("测试连接", llmCard()));
  expect(probes[0]).toMatchObject({ compatibility: "generic", reasoning_effort: "high" });
  expect(llmCard().textContent).toContain("连接正常");
  await click(button("保存"));
  expect(saves[0]?.llm).toMatchObject({ reasoning_effort: "high", temperature: 0.7 });
});

test("clears effort and stale test results when compatibility changes", async () => {
  savedEffort = "xhigh"; await mount();
  await click(button("测试连接", llmCard()));
  await select(compatibilitySelect(), "deepseek");
  expect(effortSelect().value).toBe("");
  expect(effortOptions()).toEqual(["", "none", "low", "high", "max"]);
  expect(llmCard().textContent).not.toContain("连接正常");
  expect(temperatureInput().disabled).toBeFalse();
  await select(effortSelect(), "none");
  await click(button("测试连接", llmCard()));
  expect(probes.at(-1)).toMatchObject({ compatibility: "deepseek", reasoning_effort: "none" });
  await click(button("保存"));
  expect(saves[0]?.llm).toMatchObject({ compatibility: "deepseek", reasoning_effort: "none" });
  await select(compatibilitySelect(), "generic");
  expect(effortSelect().value).toBe("");
  expect(effortOptions()).not.toContain("none");
});

test("defaults legacy settings to upstream behavior and shows provider errors without changing effort", async () => {
  await mount();
  expect(effortSelect().value).toBe("");
  expect(temperatureInput().disabled).toBeFalse();
  await click(button("测试连接", llmCard()));
  expect(probes[0]?.reasoning_effort).toBe("");
  await select(effortSelect(), "max");
  expect(llmCard().textContent).not.toContain("连接正常");
  probeError = "Unsupported reasoning_effort: max";
  await click(button("测试连接", llmCard()));
  expect(llmCard().textContent).toContain(probeError);
  expect(effortSelect().value).toBe("max");
});

test("disables the own reasoning setting when using platform credentials", async () => {
  platform = true; savedEffort = "high"; await mount();
  expect(effortSelect().disabled).toBeTrue();
  expect(compatibilitySelect().disabled).toBeTrue();
  expect(button("测试连接", llmCard()).disabled).toBeTrue();
  expect(probes).toHaveLength(0);
});

test("a late successful high probe cannot replace the current max failure", async () => {
  savedEffort = "high"; delayProbes = true; await mount();
  await click(button("测试连接", llmCard()));
  await select(effortSelect(), "max");
  await click(button("测试连接", llmCard()));
  expect(probes.map((probe) => probe.reasoning_effort)).toEqual(["high", "max"]);
  await finishProbe(1, { ok: false, error: "Unsupported max - current test" });
  await finishProbe(0, { ok: true });
  expect(effortSelect().value).toBe("max");
  expect(llmCard().textContent).toContain("Unsupported max - current test");
  expect(llmCard().textContent).not.toContain("连接正常");
});

test.each(["response", "rejection"] as const)("a late high %s failure cannot replace the current max success", async (failure) => {
  savedEffort = "high"; delayProbes = true; await mount();
  await click(button("测试连接", llmCard()));
  await select(effortSelect(), "max");
  await click(button("测试连接", llmCard()));
  await finishProbe(1, { ok: true });
  await finishProbe(0, failure === "response" ? { ok: false, error: "Stale high failure" } : new Error("Stale high failure"));
  expect(llmCard().textContent).toContain("连接正常");
  expect(llmCard().textContent).not.toContain("Stale high failure");
});

test.each(["effort", "compatibility", "source"] as const)("changing %s leaves a pending probe untested, even after changing back", async (field) => {
  platform = true; savedEffort = "high"; delayProbes = true; await mount();
  const sourceButton = (text: string) => Array.from(llmCard().querySelectorAll("button")).find((element) => element.textContent?.includes(text))!;
  await click(sourceButton("用我自己的 key"));
  await click(button("测试连接", llmCard()));
  if (field === "effort") {
    await select(effortSelect(), "max");
    await select(effortSelect(), "high");
  } else if (field === "compatibility") {
    await select(compatibilitySelect(), "deepseek");
    await select(compatibilitySelect(), "generic");
    await select(effortSelect(), "high");
  } else {
    await click(sourceButton("用平台提供的 key"));
    await click(sourceButton("用我自己的 key"));
  }
  await finishProbe(0, { ok: true });
  expect(llmCard().textContent).not.toContain("连接正常");
  expect(llmCard().textContent).not.toContain("测试中");
  expect(button("测试连接", llmCard()).disabled).toBeFalse();
});

test("an unmounted probe cannot affect a newly mounted settings form", async () => {
  savedEffort = "high"; delayProbes = true; await mount();
  await click(button("测试连接", llmCard()));
  await act(async () => root!.unmount()); root = undefined;
  document.body.innerHTML = "";
  savedEffort = "max"; await mount();
  await click(button("测试连接", llmCard()));
  await finishProbe(1, { ok: false, error: "Current form failure" });
  await finishProbe(0, { ok: true });
  expect(effortSelect().value).toBe("max");
  expect(llmCard().textContent).toContain("Current form failure");
  expect(llmCard().textContent).not.toContain("连接正常");
});
