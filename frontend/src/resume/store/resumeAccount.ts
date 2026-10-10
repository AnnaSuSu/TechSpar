import type { StateStorage } from "zustand/middleware";

let activeUserId: string | null = null;
const listeners = new Set<(userId: string | null) => void>();
const warnedFailures = new Set<string>();

export function getResumeAccount(): string | null {
  return activeUserId;
}

export function setResumeAccount(userId: string | null): void {
  const nextUserId = userId?.trim() || null;
  if (nextUserId === activeUserId) return;

  // Disable persistence while clearing the previous account's in-memory state.
  activeUserId = null;
  listeners.forEach((listener) => listener(null));
  activeUserId = nextUserId;
  if (activeUserId) listeners.forEach((listener) => listener(activeUserId));
}

export function subscribeResumeAccount(
  listener: (userId: string | null) => void
): () => void {
  listeners.add(listener);
  listener(activeUserId);
  return () => { listeners.delete(listener); };
}

function storageKey(name: string): string | null {
  return activeUserId ? `${name}:${encodeURIComponent(activeUserId)}` : null;
}

function warnStorageFailure(key: string, error: unknown): void {
  if (warnedFailures.has(key)) return;
  warnedFailures.add(key);
  console.warn(`[resume-store] Local storage is unavailable for "${key}".`, error);
}

export const accountResumeStorage: StateStorage = {
  getItem(name) {
    const key = storageKey(name);
    if (!key) return null;
    try { return localStorage.getItem(key); }
    catch (error) { warnStorageFailure(key, error); return null; }
  },
  setItem(name, value) {
    const key = storageKey(name);
    if (!key) return;
    try { localStorage.setItem(key, value); }
    catch (error) { warnStorageFailure(key, error); }
  },
  removeItem(name) {
    const key = storageKey(name);
    if (!key) return;
    try { localStorage.removeItem(key); }
    catch (error) { warnStorageFailure(key, error); }
  },
};
