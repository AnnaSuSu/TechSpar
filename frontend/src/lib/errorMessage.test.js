import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { features } from "node:process";
import test from "node:test";

// Node 22.14 supports stripping types, but does not enable it by default.
const helper = new URL("./errorMessage.ts", import.meta.url);
const { extractErrorMessage, errorMessage, parseApiErrorText } = features.typescript
  ? await import(helper.href)
  : await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(await readFile(helper, "utf8")))}`);

test("unwraps error details from strings and Error instances", () => {
  assert.equal(extractErrorMessage(new Error('{"detail":"简历不存在"}')), "简历不存在");
  assert.equal(extractErrorMessage(new Error('{"error":"上传失败"}')), "上传失败");
  assert.equal(extractErrorMessage(new Error('{"message":"保存失败"}')), "保存失败");
  assert.equal(extractErrorMessage('{"detail":"  请重试  "}'), "请重试");
});

test("reads the first non-empty message from an error object", () => {
  assert.equal(errorMessage, extractErrorMessage);
  assert.equal(errorMessage({ detail: "详细信息", message: "通用信息" }), "详细信息");
  assert.equal(errorMessage({ detail: " ", message: "通用信息" }), "通用信息");
});

test("keeps plain text and falls back for empty errors", () => {
  assert.equal(parseApiErrorText("  Bad Gateway  "), "Bad Gateway");
  assert.equal(extractErrorMessage(new Error("请求超时")), "请求超时");
  assert.equal(extractErrorMessage(new Error("")), "请求失败");
  assert.equal(extractErrorMessage({ detail: [], message: "" }, "稍后重试"), "稍后重试");
  assert.equal(extractErrorMessage(null), "请求失败");
  assert.equal(parseApiErrorText("  ", "HTTP 503"), "HTTP 503");
});
