export type RequestContext = {
  requestId: string
  userId?: string
  signal: AbortSignal
  /** Revalidate background-task ownership before committing side effects. */
  assertActive?: () => Promise<void>
}

export async function assertContextActive(context: RequestContext): Promise<void> {
  context.signal.throwIfAborted()
  await context.assertActive?.()
  context.signal.throwIfAborted()
}
