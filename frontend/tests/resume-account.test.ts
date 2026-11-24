import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { accountResumeStorage, setResumeAccount } from "../src/resume/store/resumeAccount";

const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

values.set("resume-storage", JSON.stringify({ state: { resumes: { legacy: { title: "Private legacy resume" } }, activeResumeId: "legacy" }, version: 0 }));
const { useResumeStore } = await import("../src/resume/store/useResumeStore");
const initialState = useResumeStore.getState();

beforeEach(() => {
  setResumeAccount(null);
  values.clear();
});

afterAll(() => {
  setResumeAccount(null);
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function createResume(title: string): string {
  const id = useResumeStore.getState().createResume(null, true);
  useResumeStore.getState().updateResumeTitle(title);
  return id;
}

describe("resume account isolation", () => {
  test("never hydrates shared storage before authentication", () => {
    expect(initialState.resumes).toEqual({});
    expect(initialState.activeResumeId).toBeNull();
    expect(initialState.activeResume).toBeNull();
  });

  test("switches accounts without exposing resumes or overwriting either account", () => {
    setResumeAccount("user-a");
    const aId = createResume("A private resume");
    const aSnapshot = values.get("resume-storage:user-a");

    setResumeAccount("user-b");
    expect(useResumeStore.getState().resumes).toEqual({});
    expect(useResumeStore.getState().activeResume).toBeNull();
    expect(values.get("resume-storage:user-a")).toBe(aSnapshot);
    const bId = createResume("B private resume");
    const bSnapshot = values.get("resume-storage:user-b");

    setResumeAccount("user-a");
    expect(Object.keys(useResumeStore.getState().resumes)).toEqual([aId]);
    expect(useResumeStore.getState().activeResumeId).toBe(aId);
    expect(useResumeStore.getState().activeResume?.title).toBe("A private resume");
    expect(values.get("resume-storage:user-b")).toBe(bSnapshot);

    setResumeAccount("user-b");
    expect(Object.keys(useResumeStore.getState().resumes)).toEqual([bId]);
    expect(useResumeStore.getState().activeResume?.title).toBe("B private resume");
  });

  test("logout clears the active resume and undo/redo while preserving saved data", () => {
    setResumeAccount("user-a");
    const id = createResume("Private resume");
    useResumeStore.getState().undo();
    expect(useResumeStore.getState().future[id]?.length).toBeGreaterThan(0);
    const snapshot = values.get("resume-storage:user-a");

    setResumeAccount(null);
    const state = useResumeStore.getState();
    expect(state.resumes).toEqual({});
    expect(state.activeResumeId).toBeNull();
    expect(state.activeResume).toBeNull();
    expect(state.history).toEqual({});
    expect(state.future).toEqual({});
    expect(values.get("resume-storage:user-a")).toBe(snapshot);

    setResumeAccount("user-a");
    expect(Object.keys(useResumeStore.getState().resumes)).toEqual([id]);
    expect(useResumeStore.getState().history).toEqual({});
    expect(useResumeStore.getState().future).toEqual({});
  });

  test("anonymous changes are not persisted or transferred to the next account", () => {
    createResume("Anonymous content");
    expect(values.size).toBe(0);
    setResumeAccount("user-a");
    expect(useResumeStore.getState().resumes).toEqual({});
  });

  test("leaves legacy data untouched and never assigns it to an arbitrary account", () => {
    const legacy = JSON.stringify({ state: { resumes: { legacy: { title: "Private legacy resume" } }, activeResumeId: "legacy" }, version: 0 });
    values.set("resume-storage", legacy);
    for (const userId of ["user-a", "user-b"]) {
      setResumeAccount(userId);
      expect(useResumeStore.getState().resumes).toEqual({});
    }
    expect(values.get("resume-storage")).toBe(legacy);
  });

  test("selecting the same account does not discard unsaved undo history", () => {
    setResumeAccount("user-a");
    const id = createResume("Private resume");
    const history = useResumeStore.getState().history;
    setResumeAccount("user-a");
    expect(useResumeStore.getState().activeResumeId).toBe(id);
    expect(useResumeStore.getState().history).toBe(history);
  });

  test("a corrupt account snapshot cannot leave the previous account in memory", () => {
    setResumeAccount("user-a");
    createResume("A private resume");
    values.set("resume-storage:user-b", "invalid JSON");
    setResumeAccount("user-b");
    expect(useResumeStore.getState().resumes).toEqual({});
    expect(useResumeStore.getState().activeResume).toBeNull();
  });

  test("clearStorage removes only the current account snapshot", () => {
    setResumeAccount("user-a");
    createResume("A private resume");
    const aSnapshot = values.get("resume-storage:user-a");
    setResumeAccount("user-b");
    createResume("B private resume");
    useResumeStore.persist.clearStorage();
    expect(values.has("resume-storage:user-b")).toBeFalse();
    expect(values.get("resume-storage:user-a")).toBe(aSnapshot);
    setResumeAccount(null);
    accountResumeStorage.removeItem("resume-storage");
    expect(values.get("resume-storage:user-a")).toBe(aSnapshot);
  });
});
