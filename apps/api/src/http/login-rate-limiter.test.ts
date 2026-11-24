import { expect, test } from 'bun:test'
import { LoginRateLimiter } from './login-rate-limiter.ts'

test('login rate limiter blocks a source after the configured failures and expires the window', () => {
  let now = 10_000
  const limiter = new LoginRateLimiter(2, 1_000, () => now)
  expect(limiter.isLimited('client-a')).toBeFalse()
  limiter.recordFailure('client-a')
  limiter.recordFailure('client-a')
  expect(limiter.isLimited('client-a')).toBeTrue()
  expect(limiter.isLimited('client-b')).toBeFalse()
  now += 1_001
  expect(limiter.isLimited('client-a')).toBeFalse()
})
