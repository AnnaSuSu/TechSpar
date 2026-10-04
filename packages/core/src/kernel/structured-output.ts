import { ProviderResponseError } from './errors.ts'

export class StructuredOutputError extends ProviderResponseError {
  constructor(message: string, readonly path?: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'StructuredOutputError'
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function record(value: unknown, path = 'output'): Record<string, unknown> {
  if (!isRecord(value)) throw new StructuredOutputError('expected an object', path)
  return value
}

export function requiredText(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new StructuredOutputError('expected a non-empty string', path)
  return value.trim()
}

export function textValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new StructuredOutputError('expected a string', path)
  return value.trim()
}

export function identifier(value: unknown, path: string): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return value
  throw new StructuredOutputError('expected a non-empty string or finite number', path)
}

export function objectArray(value: unknown, path: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new StructuredOutputError('expected an array', path)
  return value.map((item, index) => record(item, `${path}[${index}]`))
}

export function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new StructuredOutputError('expected a string', path)
  return value.trim()
}

export function finiteNumber(value: unknown, path: string, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new StructuredOutputError('expected a finite number', path)
  if (min !== undefined && value < min) throw new StructuredOutputError(`must be >= ${min}`, path)
  if (max !== undefined && value > max) throw new StructuredOutputError(`must be <= ${max}`, path)
  return value
}

export function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new StructuredOutputError(`expected one of ${values.join(', ')}`, path)
  return value as T
}

export function stringArray(value: unknown, path: string, required = true): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value)) throw new StructuredOutputError('expected an array', path)
  return value.map((item, index) => requiredText(item, `${path}[${index}]`))
}

export function uniqueIds<T extends string | number>(items: readonly T[], path: string): void {
  const ids = items.map(String)
  if (new Set(ids).size !== ids.length) throw new StructuredOutputError('IDs must be unique', path)
}
