/** Keep one operation across lost responses and reloads of the same review tab. */
export function jobPrepRestartRequest(storage, key, fallbackId) {
  try {
    const saved = storage.getItem(key);
    if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
    storage.setItem(key, fallbackId);
  } catch { /* Retain the caller's in-memory ID when browser storage is unavailable. */ }
  return fallbackId;
}

export function clearJobPrepRestart(storage, key) {
  try { storage.removeItem(key); } catch { /* best effort */ }
}
