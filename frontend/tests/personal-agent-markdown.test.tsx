import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { AgentMessage, ConversationDetail } from "../src/api/personalAgent";

const conversationId = "markdown-regression";
const conversationTitle = "Markdown 回归会话";
const timestamp = "2026-01-01T00:00:00.000Z";
const tableMarkdown = [
  "| 能力方向 | 当前重点 | 下一步 |",
  "| --- | --- | --- |",
  "| TypeScript | **联合类型** | 编写类型守卫 |",
  "| React | 状态管理 | 练习 `useState` |",
].join("\n");

let browser: GlobalWindow;
let host: HTMLDivElement;
let root: Root | undefined;
let historyContent: string;
let replyContent: string;
let messages: AgentMessage[];
let requests: string[];
let sentMessages: Array<{ message: string; conversation_id: string | null }>;
let unexpectedRequests: string[];
let originalFetch: typeof fetch;
const originals = new Map<string, PropertyDescriptor | undefined>();

const json = (data: unknown) => new Response(JSON.stringify(data), {
  headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  // GlobalWindow 复用宿主构造器，避免 Bun 的 VM 上下文缺少 SyntaxError；仍禁用页面脚本执行。
  //
  // GlobalWindow supplies host constructors missing from Bun's VM context; page script evaluation stays disabled.
  browser = new GlobalWindow({
    url: "http://localhost",
    settings: {
      enableJavaScriptEvaluation: false,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      navigation: { disableChildFrameNavigation: true },
    },
  });
  Object.defineProperty(browser.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    localStorage: browser.localStorage,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    MutationObserver: browser.MutationObserver,
    getComputedStyle: browser.getComputedStyle.bind(browser),
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  host = document.createElement("div");
  document.body.append(host);
  historyContent = `## 学习安排\n\n${tableMarkdown}`;
  replyContent = `## 后续学习安排\n\n${tableMarkdown}`;
  messages = [];
  requests = [];
  sentMessages = [];
  unexpectedRequests = [];
  originalFetch = globalThis.fetch;

  // 只允许约定的内存 API 路由；未知请求直接失败，绝不转发到真实服务。
  //
  // Only the in-memory API routes below are allowed; unknown requests fail without forwarding.
  globalThis.fetch = (async (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url,
      "http://localhost");
    const method = (options?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const request = `${method} ${url.pathname}`;
    requests.push(request);
    const summary = {
      conversation_id: conversationId,
      title: conversationTitle,
      message_count: messages.length,
      created_at: timestamp,
      updated_at: timestamp,
    };
    if (url.origin === "http://localhost") {
      if (request === "GET /api/personal-agent/documents") {
        return json({ items: [], supported_extensions: [".md"], max_upload_bytes: 20 * 1024 * 1024 });
      }
      if (request === "GET /api/personal-agent/conversations") return json({ items: [summary] });
      if (request === `GET /api/personal-agent/conversations/${conversationId}`) {
        return json({ ...summary, user_id: "markdown-test-user", messages } satisfies ConversationDetail);
      }
      if (request === "POST /api/personal-agent/chat") {
        const payload = JSON.parse(String(options?.body));
        sentMessages.push(payload);
        const reply: AgentMessage = {
          role: "assistant", content: replyContent, created_at: timestamp, sources: [],
        };
        messages.push({ role: "user", content: payload.message, created_at: timestamp }, reply);
        return json({ conversation_id: conversationId, title: conversationTitle, message: reply });
      }
    }
    unexpectedRequests.push(request);
    throw new Error(`Unexpected API request: ${request}`);
  }) as typeof fetch;
});

afterEach(async () => {
  try {
    if (root) await act(async () => root!.unmount());
    await browser.happyDOM.close();
  } finally {
    root = undefined;
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  }
  expect(unexpectedRequests).toEqual([]);
});

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function openHistory(initialMessages?: AgentMessage[]) {
  messages = initialMessages ?? [
    { role: "user", content: "请整理学习计划", created_at: timestamp },
    { role: "assistant", content: historyContent, created_at: timestamp, sources: [] },
  ];
  // 独立运行时先安装 DOM，再加载真实页面；同进程中的 React DOM 可能已由其他测试加载。
  //
  // Install the DOM before loading the real page; another test may already have loaded React DOM in this process.
  const [{ default: PersonalAgent }, { createRoot }] = await Promise.all([
    import("../src/pages/PersonalAgent"), import("react-dom/client"),
  ]);
  root = createRoot(host);
  await act(async () => { root!.render(<PersonalAgent />); });
  await settle();
  const conversation = Array.from(host.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(conversationTitle));
  expect(conversation, "历史会话入口应由 mock API 加载").toBeDefined();
  await act(async () => { conversation!.click(); });
  await settle();
  expect(requests).toContain(`GET /api/personal-agent/conversations/${conversationId}`);
  const userMessage = messages.find((message) => message.role === "user");
  if (userMessage) expect(host.textContent).toContain(userMessage.content);
}

const texts = (parent: ParentNode, selector: string) =>
  Array.from(parent.querySelectorAll(selector), (element) => element.textContent);

function expectThreeColumnTable() {
  const tables = host.querySelectorAll("table");
  expect(tables).toHaveLength(1);
  const table = tables[0];
  expect(table.closest(".md-table-wrapper")).not.toBeNull();
  expect(texts(table, "thead tr th")).toEqual(["能力方向", "当前重点", "下一步"]);
  const rows = table.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(2);
  expect(texts(rows[0], "td")).toEqual(["TypeScript", "联合类型", "编写类型守卫"]);
  expect(texts(rows[1], "td")).toEqual(["React", "状态管理", "练习 useState"]);
  expect(table.querySelectorAll("tbody td")).toHaveLength(6);
  expect(table.querySelector("td strong")?.textContent).toBe("联合类型");
  expect(table.querySelector("td code")?.textContent).toBe("useState");
}

test("历史消息将 GFM 表格渲染为三列表头和两行数据，并保留单元格内 Markdown", async () => {
  await openHistory();
  expectThreeColumnTable();
});

test("历史消息保留标题、列表、引用、强调、代码和安全链接", async () => {
  historyContent = [
    "## 学习笔记", "", "**重点**、*提醒*，使用 `useMemo`。", "",
    "- 阅读文档", "- 编写练习", "", "1. 复盘", "2. 调整", "",
    "> 每天进步一点。", "", "```ts", "const ready = true;", "```", "",
    "[学习资料](https://example.com/learning?step=1)",
  ].join("\n");
  await openHistory();
  expect(texts(host, "h2")).toContain("学习笔记");
  expect(texts(host, "ul > li")).toEqual(["阅读文档", "编写练习"]);
  expect(texts(host, "ol > li")).toEqual(["复盘", "调整"]);
  expect(texts(host, "blockquote p")).toEqual(["每天进步一点。"]);
  expect(texts(host, "strong")).toContain("重点");
  expect(texts(host, "em")).toContain("提醒");
  expect(texts(host, "code")).toContain("useMemo");
  expect(host.querySelector("pre > code.language-ts")?.textContent).toBe("const ready = true;\n");
  const link = Array.from(host.querySelectorAll("a")).find((element) => element.textContent === "学习资料");
  expect(link?.getAttribute("href")).toBe("https://example.com/learning?step=1");
});

test("多条消息的脚注、重复引用、回链和无障碍描述仅关联本消息，重渲染后保持稳定", async () => {
  await openHistory([1, 2].map((number) => ({
    role: "assistant",
    content: `## 消息${number}\n\n内容[^1]，再次引用[^1]。[普通链接](#footnote-label)\n\n[^1]: 注释${number}`,
    created_at: timestamp,
    sources: [],
  })));

  function expectIsolatedFootnotes() {
    const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size, "同页全部 ID 必须唯一").toBe(ids.length);
    const blocks = Array.from(host.querySelectorAll(".md-content"));
    expect(blocks).toHaveLength(2);
    return blocks.map((block, index) => {
      const heading = block.querySelector("h2:not(.sr-only)");
      expect(heading?.textContent).toBe(`消息${index + 1}`);
      expect(heading?.hasAttribute("id")).toBe(false);
      expect(block.querySelector('a:not([data-footnote-ref]):not([data-footnote-backref])')
        ?.getAttribute("href")).toBe("#footnote-label");
      const section = block.querySelector("section[data-footnotes]");
      const label = section?.querySelector("h2");
      const definitions = Array.from(section?.querySelectorAll("li[id]") ?? []);
      const references = Array.from(block.querySelectorAll("a[data-footnote-ref]"));
      const backlinks = Array.from(block.querySelectorAll("a[data-footnote-backref]"));
      expect(label?.id).toBeTruthy();
      expect(label?.classList.contains("sr-only")).toBe(true);
      expect(definitions).toHaveLength(1);
      expect(definitions[0].textContent).toContain(`注释${index + 1}`);
      expect(references).toHaveLength(2);
      expect(backlinks).toHaveLength(2);
      for (const element of [label!, definitions[0], ...references]) {
        expect(element.id.startsWith("user-content-")).toBe(true);
      }
      for (const [referenceIndex, reference] of references.entries()) {
        const href = reference.getAttribute("href");
        expect(href?.startsWith("#")).toBe(true);
        expect(document.getElementById(href!.slice(1))).toBe(definitions[0]);
        const descriptions = reference.getAttribute("aria-describedby")?.split(/\s+/);
        expect(descriptions).toEqual([label!.id]);
        expect(document.getElementById(descriptions![0])).toBe(label);
        const backlink = backlinks[referenceIndex];
        const backHref = backlink.getAttribute("href");
        expect(backHref?.startsWith("#")).toBe(true);
        expect(document.getElementById(backHref!.slice(1))).toBe(reference);
      }
      expect(block.querySelector("[node]")).toBeNull();
      return block.innerHTML;
    });
  }

  const initialMarkup = expectIsolatedFootnotes();
  const collapseLibrary = host.querySelector<HTMLButtonElement>('button[aria-label="收起资料库"]');
  expect(collapseLibrary).not.toBeNull();
  await act(async () => { collapseLibrary!.click(); });
  expect(expectIsolatedFootnotes()).toEqual(initialMarkup);
});

test("历史消息不生成可执行的原始 HTML 或 javascript/data 危险链接", async () => {
  historyContent = [
    "## 安全渲染", "",
    '<script>window.__agentMarkdownExecuted = true;</script>', "",
    '<img src="https://example.invalid/blocked" onerror="window.__agentMarkdownExecuted = true">', "",
    '<iframe src="https://example.invalid/blocked"></iframe>', "",
    '<a id="raw-agent-html" href="javascript:alert(1)" onclick="alert(1)">原始链接</a>', "",
    "[危险脚本](javascript:alert%281%29)", "",
    "[危险数据](data:text/html;base64,PHNjcmlwdD4=)", "",
    "[安全链接](https://example.com/safe)",
  ].join("\n");
  await openHistory();
  expect(texts(host, "h2")).toContain("安全渲染");
  // 排除活动 HTML 节点及危险 href，不能仅凭 happy-dom 禁用脚本就判定安全。
  //
  // Exclude active HTML nodes and unsafe hrefs instead of relying only on happy-dom disabling scripts.
  expect(host.querySelector("script, iframe, img, #raw-agent-html, [onerror], [onclick]")).toBeNull();
  expect(Reflect.get(browser, "__agentMarkdownExecuted")).toBeUndefined();
  expect(host.textContent).toContain("危险脚本");
  expect(host.textContent).toContain("危险数据");
  const unsafeLinks = Array.from(host.querySelectorAll("a[href]"))
    .filter((link) => /^(?:javascript|vbscript|data):/i.test(link.getAttribute("href")!.trim()));
  expect(unsafeLinks).toHaveLength(0);
  const safeLink = Array.from(host.querySelectorAll("a")).find((link) => link.textContent === "安全链接");
  expect(safeLink?.getAttribute("href")).toBe("https://example.com/safe");
});

test("继续聊点击建议问题后，新的 Agent 回复也渲染三列表格而非原始管道文本", async () => {
  await openHistory([]);
  expect(host.querySelectorAll("table")).toHaveLength(0);
  // 通过建议问题的真实点击验证发送链路，避免 textarea 合成事件受 React DOM 模块加载顺序影响。
  //
  // Exercise sending through a real starter click, avoiding synthesized textarea events sensitive to React DOM import order.
  const question = "结合我的错题，帮我安排一周复习计划";
  const starter = Array.from(host.querySelectorAll("button"))
    .find((button) => button.textContent === question);
  expect(starter).toBeDefined();
  await act(async () => { starter!.click(); });
  await settle();
  expect(requests).toContain("POST /api/personal-agent/chat");
  expect(sentMessages).toEqual([{ message: question, conversation_id: conversationId }]);
  expect(host.textContent).toContain(question);
  expect(texts(host, "h2")).toContain("后续学习安排");
  expectThreeColumnTable();
});
