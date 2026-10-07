import { describe, expect, test } from 'bun:test'
import { parseJsonResponse, ProviderResponseError } from '@techspar/core'

describe('structured JSON response parsing', () => {
  test.each(['', '结果如下：\n', '📝', '📝 结果如下：', '🧑‍💻📝 结果如下：\n'])('parses objects and arrays after prefix %s', (prefix) => {
    expect(parseJsonResponse(`${prefix}{"summary":"完成"}`)).toEqual({ summary: '完成' })
    expect(parseJsonResponse(`${prefix}[{"id":1}]`)).toEqual([{ id: 1 }])
  })

  test('preserves fenced JSON with surrounding prose', () => {
    expect(parseJsonResponse('📝 结果如下：\n```json\n{"summary":"完成"}\n```\n请查阅。')).toEqual({ summary: '完成' })
  })

  test.each(['📝 没有 JSON', '📝 {"summary":', '📝 [1,', 'null', '42'])('rejects invalid structured output %s', (output) => {
    expect(() => parseJsonResponse(output)).toThrow(ProviderResponseError)
  })
})
