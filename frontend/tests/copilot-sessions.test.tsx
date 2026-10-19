import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import TaskStatusContext from "../src/contexts/TaskStatusContextBase";

const browser = new GlobalWindow({ url: "http://localhost" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, HTMLElement: browser.HTMLElement, HTMLInputElement: browser.HTMLInputElement, Node: browser.Node, NodeFilter: browser.NodeFilter, MutationObserver: browser.MutationObserver, CustomEvent: browser.CustomEvent, getComputedStyle: browser.getComputedStyle.bind(browser), IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const { default: SessionHistory } = await import("../src/pages/copilot/SessionHistory");
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let items: Array<Record<string, unknown>>;
let taskIds: string[];
let calls: string[];
let reviewError = "";
const stored = { session_id: "live", prep_id: "prep", status: "stopped", hr_turns: 2, candidate_turns: 2, created_at: "2026-10-19T02:00:00Z", updated_at: "2026-10-19T03:00:00Z", in_progress: false, review_session_id: null as string | null, review_status: null as string | null };
beforeEach(() => {
  items = [{ ...stored }]; taskIds = []; calls = []; reviewError = "";
  globalThis.fetch = (async (url, options) => {
    const method = options?.method || "GET"; const path = String(url); calls.push(`${method} ${path}`);
    let body: unknown;
    let status = 200;
    if (path.endsWith("/generate")) { items[0]!.review_status = "pending"; body = { session_id: "review", mode: "copilot", status: "pending" }; }
    else if (path.endsWith("/review")) {
      body = reviewError ? { detail: reviewError } : { copilot_session_id: "live", review_session_id: "review", mode: "copilot", status: "pending", created: true };
      if (reviewError) status = 400;
      else { items[0]!.review_session_id = "review"; items[0]!.review_status = "pending"; }
    } else if (method === "DELETE") { items = []; body = { ok: true }; }
    else if (path.endsWith("/sessions")) body = items;
    else body = { ...stored, company: "合成公司", position: "后端工程师", conversation: [{ role: "hr", text: "解释队列背压", at: stored.created_at }, { role: "candidate", text: "通过限流保护消费者", at: stored.updated_at }] };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; await new Promise((resolve) => setTimeout(resolve, 10)); document.body.innerHTML = ""; });
afterAll(async () => {
  await browser.happyDOM.close();
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
async function mount() {
  const host = document.createElement("main"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<MemoryRouter><TaskStatusContext.Provider value={{ tasks: [], startTask: (id) => taskIds.push(id), dismissTask() {}, creatingSessionMode: null, setCreatingSessionMode() {} }}><SessionHistory prepId="prep" /></TaskStatusContext.Provider></MemoryRouter>));
}
function button(label: string) { const value = [...document.querySelectorAll("button")].find((node) => node.textContent?.trim() === label); if (!value) throw new Error(`Missing button: ${label}`); return value; }
async function click(label: string) { await act(async () => { button(label).click(); }); }

test("starts review only after an explicit click and registers the review ID for task polling", async () => {
  await mount(); expect(taskIds).toEqual([]); expect(calls).toEqual(["GET /api/copilot/prep/prep/sessions"]);
  expect(document.body.textContent).toContain("写入长期画像");
  await click("生成实战复盘");
  expect(taskIds).toEqual(["review"]); expect(document.body.textContent).toContain("实战复盘已开始");
  expect(document.body.textContent).toContain("复盘生成中");
  expect(button("查看复盘进度").disabled).toBeFalse();
  expect(document.querySelector('a[href="/review/review"]')).toBeNull();
});
test("links finished reviews and retries failed ones from their saved snapshot", async () => {
  items[0] = { ...stored, review_session_id: "review", review_status: "done" }; await mount();
  expect(document.querySelector('a[href="/review/review"]')?.textContent).toBe("查看复盘");
  expect(document.body.textContent).toContain("已复盘");
  items[0] = { ...stored, review_session_id: "review", review_status: "error" };
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="刷新实战记录"]')!.click(); });
  expect(document.body.textContent).toContain("复盘失败");
  await click("重新生成复盘");
  expect(calls).toContain("POST /api/interview/review/review/generate");
  expect(calls.some((call) => call.endsWith("/api/copilot/sessions/live/review"))).toBeFalse();
  expect(taskIds).toEqual(["review"]); expect(document.body.textContent).toContain("复盘生成中");
});
test("explains deleted reviews before generating a new one", async () => {
  items[0] = { ...stored, review_session_id: "deleted", review_status: "missing" }; await mount();
  expect(document.body.textContent).toContain("原复盘已在历史记录中删除");
  await click("重新生成复盘");
  expect(calls).toContain("POST /api/copilot/sessions/live/review"); expect(taskIds).toEqual(["review"]);
});
test("blocks review without both speakers and reports server validation failures", async () => {
  items[0]!.candidate_turns = 0; await mount(); expect(button("生成实战复盘").disabled).toBeTrue();
  items[0]!.candidate_turns = 1;
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="刷新实战记录"]')!.click(); });
  reviewError = "对话超过 40000 字符"; await click("生成实战复盘");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(reviewError); expect(taskIds).toEqual([]);
});
test("protects active sessions from review and deletion", async () => {
  items[0] = { ...stored, status: "active", in_progress: true }; await mount();
  expect(document.body.textContent).toContain("进行中");
  expect(button("生成实战复盘").disabled).toBeTrue(); expect(button("删除记录").disabled).toBeTrue();
});
test("displays saved conversation roles and confirms deletion with the retained-copy notice", async () => {
  await mount(); await click("查看对话");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("解释队列背压");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("通过限流保护消费者");
  await click("关闭"); await click("删除记录");
  expect(calls.some((call) => call.startsWith("DELETE"))).toBeFalse();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("对话副本和长期画像会保留");
  await click("确认删除"); expect(calls).toContain("DELETE /api/copilot/sessions/live");
  expect(document.body.textContent).toContain("暂无实战记录");
});
