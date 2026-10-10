import { describe, expect, test } from 'bun:test'
import { sanitizeJobPrepDraft } from '../frontend/src/lib/jobPrepDraft.ts'

describe('job prep draft compatibility', () => {
  test('drops an unrenderable model preview while preserving the JD inputs', () => {
    const draft = sanitizeJobPrepDraft({
      company: '跨越速运',
      position: '高级 Java 工程师',
      jdText: '完整岗位描述',
      previewSignature: 'old-signature',
      preview: {
        prep_priorities: [{ priority: 1, topic: '分布式系统', actions: ['准备项目案例'] }],
      },
    })

    expect(draft).toEqual({
      company: '跨越速运',
      position: '高级 Java 工程师',
      jdText: '完整岗位描述',
      preview: null,
      previewSignature: '',
    })
  })

  test('drops a cached preview with object summaries', () => {
    expect(sanitizeJobPrepDraft({
      jdText: '完整岗位描述',
      previewSignature: 'old-signature',
      preview: {
        role_summary: { overview: '高级 Java 岗位' },
        resume_alignment: { fit_assessment: { conclusion: '基本匹配' } },
      },
    })).toMatchObject({ preview: null, previewSignature: '' })
  })
})


describe('job prep account namespace', () => {
  test('uses the authenticated token subject, never shared or legacy user storage', async () => {
    const { jobPrepDraftKey } = await import('../frontend/src/lib/jobPrepAccount.ts')
    const token = (sub: string) => `header.${btoa(JSON.stringify({ sub }))}.signature`
    expect(jobPrepDraftKey(token('user-a'))).toBe('jobprep-draft:user-a')
    expect(jobPrepDraftKey(token('user-b'))).not.toBe(jobPrepDraftKey(token('user-a')))
    expect(jobPrepDraftKey(null)).toBeNull()
    expect(jobPrepDraftKey('broken')).toBeNull()
    expect(jobPrepDraftKey('h.e30.s')).toBeNull()
  })
})
