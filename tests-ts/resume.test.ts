import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResumeService, type ChatMessage } from '@techspar/core'
import { FileResumeStore } from '@techspar/platform'

describe('resume compatibility', () => {
  let root: string
  let responses: string[]
  let service: ResumeService
  const context = { requestId: 'test', userId: 'user-a', signal: new AbortController().signal }
  const pdf = new TextEncoder().encode('%PDF-1.7\nresume bytes')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techspar-resume-'))
    responses = []
    service = new ResumeService({
      store: new FileResumeStore(join(root, 'data')),
      extractor: { async extract() { return '  完整简历原文\n第二行  ' } },
      index: { async invalidate() {} },
      ai: {
        async complete(_context, _messages: readonly ChatMessage[]) { return responses.shift() || '{}' },
        async *stream() {},
      },
      transcription: { async transcribe() { return '转写文本' } },
    })
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  test('uploads one PDF and reports the legacy status shape', async () => {
    expect(await service.status(context)).toEqual({ has_resume: false })
    expect(await service.upload(context, '简历.pdf', pdf)).toEqual({ ok: true, filename: '简历.pdf', size: pdf.length })
    expect(await service.status(context)).toEqual({ has_resume: true, filename: '简历.pdf', size: pdf.length })
    expect((await service.file(context)).bytes).toEqual(pdf)
  })

  test('reads stored PDF bytes as a plain Uint8Array', async () => {
    await service.upload(context, 'resume.pdf', pdf)
    const stored = await service.file(context)

    expect(stored.bytes).toEqual(pdf)
    expect(stored.bytes).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer(stored.bytes)).toBe(false)
  })

  test('rejects traversal, non-PDF content, and oversized metadata before writing', async () => {
    await expect(service.upload(context, '../resume.pdf', pdf)).rejects.toThrow('Invalid resume filename')
    await expect(service.upload(context, 'resume.txt', pdf)).rejects.toThrow('Only PDF')
    await expect(service.upload(context, 'resume.pdf', new TextEncoder().encode('not a pdf'))).rejects.toThrow('not a valid PDF')
  })

  test('loads full resume text without embedding or retrieval', async () => {
    await service.upload(context, 'resume.pdf', pdf)
    expect(await service.text(context)).toBe('完整简历原文\n第二行')
  })

  test('retries JSON parsing once and returns a structured object', async () => {
    await service.upload(context, 'resume.pdf', pdf)
    responses.push('not json', '```json\n{"basic":{"name":"张三"}}\n```')
    expect(await service.parse(context)).toEqual({ ok: true, parsed: { basic: { name: '张三' }, education: [], experience: [], projects: [], skills: [], selfEvaluation: [] } })
  })

  test('rejects scalar JSON responses and retries for an object', async () => {
    await service.upload(context, 'resume.pdf', pdf)
    responses.push('"not-an-object"', '{"basic":{"name":"李四"}}')
    expect(await service.parse(context)).toEqual({ ok: true, parsed: { basic: { name: '李四' }, education: [], experience: [], projects: [], skills: [], selfEvaluation: [] } })
  })

  test('deletes the PDF and returns 404 when repeated', async () => {
    await service.upload(context, 'resume.pdf', pdf)
    expect(await service.delete(context)).toEqual({ ok: true })
    await expect(service.delete(context)).rejects.toThrow('还没有上传过简历')
  })

  for (const invalid of [{}, { basic: [] }, { basic: { name: 3 } }, { basic: {}, education: {} }, { basic: {}, experience: [{ details: 'text' }] }, { basic: {}, projects: [{ name: {} }] }, { basic: {}, skills: [3] }, { basic: {}, selfEvaluation: {} }]) {
    test(`rejects invalid parsed resume ${JSON.stringify(invalid)} after two attempts`, async () => {
      await service.upload(context, 'resume.pdf', pdf)
      responses.push(JSON.stringify(invalid), JSON.stringify(invalid))
      await expect(service.parse(context)).rejects.toThrow('简历解析失败')
      expect(responses).toEqual([])
      expect((await service.file(context)).bytes).toEqual(pdf)
    })
  }

  test('retries structurally invalid JSON and keeps valid nested resume content', async () => {
    await service.upload(context, 'resume.pdf', pdf)
    const parsed = { basic: { name: '张三' }, education: [{ school: '示例学校', description: ['研究数据库'] }], experience: [{ company: '示例公司', details: ['开发服务'] }], projects: [{ name: '项目', description: ['改善性能'] }], skills: ['TypeScript'], selfEvaluation: [] }
    responses.push('{"basic":[]}', JSON.stringify(parsed))
    expect(await service.parse(context)).toEqual({ ok: true, parsed })
    expect(responses).toEqual([])
  })

  test('preserves the short transcription response shape', async () => {
    expect(await service.transcribe(context, 'answer.webm', new Uint8Array([1]))).toEqual({ text: '转写文本' })
  })
})
