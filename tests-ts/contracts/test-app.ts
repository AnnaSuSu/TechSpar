import type { AppDependencies } from '../../apps/api/src/app.ts'
import { createApp } from '../../apps/api/src/app.ts'

export const TEST_TOKEN = 'test-token'

export const jsonHeaders = {
  authorization: `Bearer ${TEST_TOKEN}`,
  'content-type': 'application/json',
}

/** Fail loudly if a boundary test calls an adapter it did not explicitly provide. */
export const unavailable = new Proxy({}, {
  get() {
    return () => Promise.reject(new Error('unexpected dependency call'))
  },
})

export const testTokens = {
  async create() { return TEST_TOKEN },
  async decode(token: string) { return token === TEST_TOKEN ? 'user-a' : undefined },
}

export function boundaryApp(overrides: Partial<AppDependencies> = {}): ReturnType<typeof createApp> {
  return createApp({
    auth: unavailable,
    registration: { allowRegistration: false },
    settings: unavailable,
    quota: unavailable,
    tokens: testTokens,
    knowledge: unavailable,
    resume: unavailable,
    ...overrides,
  } as unknown as AppDependencies)
}
