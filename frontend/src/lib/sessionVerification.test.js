import assert from "node:assert/strict";
import test from "node:test";
import { verifySession } from "./sessionVerification.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const settings = { configured: { llm: true, embedding: true } };

test("verifies identity without requesting a failing profile", async () => {
  const calls = [];
  const result = await verifySession("saved-token", "user-a", { fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, "Bearer saved-token");
    if (url === "/api/auth/me") return json({ id: "user-a" });
    if (url === "/api/settings") return json(settings);
    return json({}, 500);
  } });
  assert.deepEqual(result, { status: "verified", id: "user-a", needsOnboarding: false });
  assert.deepEqual(calls, ["/api/auth/me", "/api/settings"]);
});

for (const failurePath of ["/api/auth/me", "/api/settings"]) {
  for (const failure of ["http", "network", "json"]) test(`keeps ${failurePath} ${failure} failures retryable`, async () => {
    const fetchImpl = async (url) => {
      if (url === failurePath) {
        if (failure === "network") throw new TypeError("Failed to fetch");
        if (failure === "json") return new Response("invalid json", { status: 200 });
        return json({}, 500);
      }
      return json(url === "/api/auth/me" ? { id: "user-a" } : settings);
    };
    await assert.rejects(verifySession("saved-token", "user-a", { fetchImpl }));
    assert.equal((await verifySession("saved-token", "user-a", { fetchImpl: async (url) => json(url === "/api/auth/me" ? { id: "user-a" } : settings) })).status, "verified");
  });
}

for (const path of ["/api/auth/me", "/api/settings"]) test(`expires only on an authentication rejection from ${path}`, async () => {
  const result = await verifySession("saved-token", "user-a", { fetchImpl: async (url) => json(url === "/api/auth/me" ? { id: "user-a" } : settings, url === path ? 401 : 200) });
  assert.deepEqual(result, { status: "expired" });
});

test("rejects a mismatched identity before loading settings", async () => {
  const calls = [];
  const result = await verifySession("saved-token", "user-a", { fetchImpl: async (url) => { calls.push(url); return json({ id: "user-b" }); } });
  assert.deepEqual(result, { status: "expired" });
  assert.deepEqual(calls, ["/api/auth/me"]);
});

test("keeps a malformed identity retryable", async () => {
  await assert.rejects(verifySession("saved-token", "user-a", { fetchImpl: async () => json({}) }));
});

test("preserves onboarding for an unconfigured provider", async () => {
  const result = await verifySession("saved-token", "user-a", { fetchImpl: async (url) => json(url === "/api/auth/me" ? { id: "user-a" } : { configured: { llm: false, embedding: true } }) });
  assert.equal(result.needsOnboarding, true);
});
