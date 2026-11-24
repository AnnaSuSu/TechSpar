import assert from "node:assert/strict";
import test from "node:test";
import { readErrorMessage } from "./client.ts";

test("extracts a message from a structured HTTP error", async () => {
  const res = Response.json({ detail: "服务过载", error: "Unavailable" }, { status: 503 });
  assert.equal(await readErrorMessage(res), "服务过载");
});

test("uses the response text when the error body is plain text", async () => {
  const res = new Response("Bad Gateway", { status: 502 });
  assert.equal(await readErrorMessage(res), "Bad Gateway");
});

test("uses the provided fallback or the HTTP status for empty bodies", async () => {
  assert.equal(await readErrorMessage(new Response(null, { status: 500 })), "HTTP 500");
  assert.equal(
    await readErrorMessage(new Response(" ", { status: 503 }), "服务暂时不可用"),
    "服务暂时不可用",
  );
});
