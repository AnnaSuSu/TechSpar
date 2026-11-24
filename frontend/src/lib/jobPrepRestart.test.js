import test from 'node:test';
import assert from 'node:assert/strict';
import { jobPrepRestartRequest, clearJobPrepRestart } from './jobPrepRestart.js';

const first = 'cf822ab0-ecbe-4533-a399-4b7c2f6f4d28';
const next = '20db4be6-080b-44ba-8793-7d47b3b20494';
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test('a reload or lost-response retry reuses the same operation until success', () => {
  const store = storage();
  assert.equal(jobPrepRestartRequest(store, 'account-a:review-1', first), first);
  assert.equal(jobPrepRestartRequest(store, 'account-a:review-1', next), first);
  clearJobPrepRestart(store, 'account-a:review-1');
  assert.equal(jobPrepRestartRequest(store, 'account-a:review-1', next), next);
});

test('different accounts and source reviews retain independent operations', () => {
  const store = storage();
  jobPrepRestartRequest(store, 'account-a:review-1', first);
  assert.equal(jobPrepRestartRequest(store, 'account-b:review-1', next), next);
  assert.equal(jobPrepRestartRequest(store, 'account-a:review-2', next), next);
});

test('unavailable storage retains the supplied in-memory ID', () => {
  const store = { getItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(jobPrepRestartRequest(store, 'account-a:review-1', first), first);
  assert.doesNotThrow(() => clearJobPrepRestart(store, 'account-a:review-1'));
});
