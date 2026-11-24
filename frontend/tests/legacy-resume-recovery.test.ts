import { afterAll, beforeEach, expect, test } from "bun:test";
import { recoverLegacyResumes, hasLegacyResumes } from "../src/resume/store/legacyResumeRecovery";
import { getResumeAccount, setResumeAccount } from "../src/resume/store/resumeAccount";
import { useResumeStore } from "../src/resume/store/useResumeStore";
import { saveSession } from "../src/lib/authSession";

const values = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let failWrite = false;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (failWrite) throw new DOMException("Storage full", "QuotaExceededError");
    values.set(key, value);
  },
  removeItem: (key: string) => { values.delete(key); },
} });
beforeEach(() => { setResumeAccount(null); values.clear(); failWrite = false; });
afterAll(() => {
  setResumeAccount(null);
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function seedLegacy() {
  setResumeAccount("legacy-owner");
  const id = useResumeStore.getState().createResume(null, true);
  useResumeStore.getState().updateResumeTitle("Old private resume");
  const snapshot = values.get("resume-storage:legacy-owner")!;
  values.set("resume-storage", snapshot);
  values.delete("resume-storage:legacy-owner");
  setResumeAccount(null);
  return { id, snapshot };
}
function selectAccount(id = "user-a") {
  saveSession(`token-${id}`, { id, name: id }); setResumeAccount(id);
}

test("does not display or recover old data without explicit ownership confirmation", () => {
  const { snapshot } = seedLegacy(); selectAccount();
  expect(hasLegacyResumes()).toBeTrue(); expect(useResumeStore.getState().resumes).toEqual({});
  expect(() => recoverLegacyResumes("user-a", false)).toThrow("确认");
  expect(values.get("resume-storage")).toBe(snapshot);
});

test("confirmed recovery restores complete editable content, survives reload, and runs once", () => {
  const { id } = seedLegacy(); selectAccount();
  expect(recoverLegacyResumes("user-a", true)).toBe(1);
  expect(hasLegacyResumes()).toBeFalse();
  expect(useResumeStore.getState().activeResume?.title).toBe("Old private resume");
  expect(useResumeStore.getState().resumes[id].menuSections.length).toBeGreaterThan(0);
  useResumeStore.getState().updateResumeTitle("Edited recovered resume");
  expect(recoverLegacyResumes("user-a", true)).toBe(0);
  setResumeAccount(null); setResumeAccount("user-a");
  expect(useResumeStore.getState().resumes[id].title).toBe("Edited recovered resume");
});

test("preserves both resumes when a legacy ID collides with a current resume", () => {
  const { id } = seedLegacy(); selectAccount();
  const current = { ...JSON.parse(values.get("resume-storage")!).state.resumes[id], title: "Current resume" };
  useResumeStore.getState().addResume(current);
  expect(recoverLegacyResumes("user-a", true)).toBe(1);
  expect(useResumeStore.getState().resumes[id].title).toBe("Current resume");
  expect(Object.values(useResumeStore.getState().resumes).map((resume) => resume.title).sort())
    .toEqual(["Current resume", "Old private resume"]);
  expect(useResumeStore.getState().activeResumeId).toBe(id);
});

test("quota failure retains the legacy snapshot, existing account data, and editor state", () => {
  const { snapshot } = seedLegacy(); selectAccount();
  useResumeStore.getState().createResume(null, true);
  useResumeStore.getState().updateResumeTitle("Current resume");
  const saved = values.get("resume-storage:user-a"); const state = useResumeStore.getState();
  failWrite = true;
  expect(() => recoverLegacyResumes("user-a", true)).toThrow("Storage full");
  expect(values.get("resume-storage")).toBe(snapshot);
  expect(values.get("resume-storage:user-a")).toBe(saved); expect(useResumeStore.getState()).toBe(state);
  failWrite = false;
  expect(recoverLegacyResumes("user-a", true)).toBe(1);
});

test("rejects stale confirmation after an account switch and leaves other accounts untouched", () => {
  const { snapshot } = seedLegacy(); selectAccount(); selectAccount("user-b");
  expect(() => recoverLegacyResumes("user-a", true)).toThrow("确认");
  expect(values.get("resume-storage")).toBe(snapshot);
  expect(getResumeAccount()).toBe("user-b"); expect(useResumeStore.getState().resumes).toEqual({});
  expect(values.has("resume-storage:user-a")).toBeFalse();
});

test("rejects malformed, incomplete and unknown-version snapshots without deleting the backup", () => {
  const { snapshot } = seedLegacy(); selectAccount();
  for (const raw of ["bad JSON", '{"state":{}}', '{"state":{"resumes":{"bad":{}}}}',
    JSON.stringify({ ...JSON.parse(snapshot), version: 99 })]) {
    values.set("resume-storage", raw);
    expect(() => recoverLegacyResumes("user-a", true)).toThrow();
    expect(values.get("resume-storage")).toBe(raw); expect(useResumeStore.getState().resumes).toEqual({});
  }
});
