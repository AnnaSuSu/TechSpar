type AttemptWindow = { count: number; expiresAt: number }

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>()

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isLimited(key: string): boolean {
    const current = this.attempts.get(key)
    if (!current || current.expiresAt <= this.now()) {
      this.attempts.delete(key)
      return false
    }
    return current.count >= this.maxAttempts
  }

  recordFailure(key: string): void {
    const now = this.now()
    const current = this.attempts.get(key)
    if (!current || current.expiresAt <= now) this.attempts.set(key, { count: 1, expiresAt: now + this.windowMs })
    else this.attempts.set(key, { ...current, count: current.count + 1 })
    this.prune(now)
  }

  clear(key: string): void {
    this.attempts.delete(key)
  }

  private prune(now: number): void {
    for (const [key, attempt] of this.attempts) if (attempt.expiresAt <= now) this.attempts.delete(key)
    while (this.attempts.size > 10_000) this.attempts.delete(this.attempts.keys().next().value!)
  }
}
