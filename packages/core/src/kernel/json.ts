import { ProviderResponseError } from './errors.ts'

export function parseJsonResponse(content: string): Record<string, unknown> | unknown[] {
  const value = content.trim()
  const attempts = [value]
  const fenced = value.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced?.[1]) attempts.push(fenced[1].trim())
  const firstJson = value.search(/[\[{]/)
  if (firstJson > 0) attempts.push(value.slice(firstJson))
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      if (Array.isArray(parsed) || (typeof parsed === 'object' && parsed !== null)) return parsed as Record<string, unknown> | unknown[]
    } catch {
      // Try the next compatible representation.
    }
  }
  throw new ProviderResponseError('模型未返回有效 JSON，请重试或更换模型。')
}
