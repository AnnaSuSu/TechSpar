import { AppError, AuthenticationError } from '../kernel/errors.ts'
import { parseJsonResponse } from '../kernel/json.ts'
import { STRUCTURED_CHAT_OPTIONS } from '../provider/ports.ts'
import { record, stringArray, StructuredOutputError } from '../kernel/structured-output.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { ResumeDependencies, ResumeUseCases } from './ports.ts'

const MAX_RESUME_BYTES = 20 * 1024 * 1024
const MAX_PARSE_CHARS = 20_000

const RESUME_PARSE_PROMPT = `请把下面这份简历的原文,解析成结构化 JSON。

要求:
1. 只输出 JSON,不要任何解释或 Markdown 代码块。
2. 字段值一律用简历原文的语言,不要翻译、不要润色、不要编造原文没有的内容。
3. 原文缺失的字段:字符串填 ""、数组填 []。
4. 日期保持原文写法,不要改格式。
5. details / description / skills / selfEvaluation 是要点数组:一条要点一个元素,去掉行首的项目符号。

JSON 结构:
{
  "basic": { "name": "姓名", "title": "求职意向/职位", "email": "", "phone": "", "location": "所在城市", "birthDate": "", "employementStatus": "在职/离职/应届等求职状态" },
  "education": [{ "school": "", "major": "", "degree": "", "startDate": "", "endDate": "", "gpa": "", "description": ["在校经历要点"] }],
  "experience": [{ "company": "", "position": "", "date": "起止时间", "details": ["工作内容要点"] }],
  "projects": [{ "name": "项目名", "role": "担任角色", "date": "起止时间", "description": ["项目要点"] }],
  "skills": ["技能要点"],
  "selfEvaluation": ["自我评价要点"]
}

简历原文:
---
{{resume_text}}
---`

function plainFilename(value: string): boolean {
  return Boolean(value) && !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..'
}

function validateResume(value: unknown): Record<string, unknown> {
  const source = record(value)
  const basic = record(source.basic, 'basic')
  const textField = (value: unknown, path: string): string => {
    if (typeof value !== 'string') throw new StructuredOutputError('expected a string', path)
    return value.trim()
  }
  for (const field of ['name', 'title', 'email', 'phone', 'location', 'birthDate', 'employementStatus']) if (basic[field] !== undefined) basic[field] = textField(basic[field], `basic.${field}`)
  for (const [name, fields] of [['education', ['school', 'major', 'degree', 'startDate', 'endDate', 'gpa']], ['experience', ['company', 'position', 'date']], ['projects', ['name', 'role', 'date']]] as const) {
    if (source[name] === undefined || source[name] === null) source[name] = []
    if (!Array.isArray(source[name])) throw new StructuredOutputError('expected an array', name)
    source[name] = source[name]!.map((item, index) => {
      const row = record(item, `${name}[${index}]`)
      for (const field of fields) if (row[field] !== undefined) row[field] = textField(row[field], `${name}[${index}].${field}`)
      const listField = name === 'experience' ? 'details' : 'description'
      if (row[listField] === undefined || row[listField] === null) row[listField] = []
      row[listField] = stringArray(row[listField], `${name}[${index}].${listField}`)
      return row
    })
  }
  if (source.skills === undefined || source.skills === null) source.skills = []
  if (source.selfEvaluation === undefined || source.selfEvaluation === null) source.selfEvaluation = []
  source.skills = stringArray(source.skills, 'skills')
  source.selfEvaluation = stringArray(source.selfEvaluation, 'selfEvaluation')
  return source
}

export class ResumeService implements ResumeUseCases {
  constructor(private readonly deps: ResumeDependencies) {}

  private userId(context: RequestContext): string {
    if (!context.userId) throw new AuthenticationError()
    return context.userId
  }

  status(context: RequestContext) {
    return this.deps.store.status(this.userId(context))
  }

  async file(context: RequestContext) {
    const file = await this.deps.store.read(this.userId(context))
    if (!file) throw new AppError('还没有上传过简历', 404)
    return file
  }

  async upload(context: RequestContext, filename: string, bytes: Uint8Array) {
    const userId = this.userId(context)
    if (!filename.toLowerCase().endsWith('.pdf')) throw new AppError('Only PDF files are supported.', 400)
    if (!plainFilename(filename)) throw new AppError('Invalid resume filename.', 400)
    if (bytes.length > MAX_RESUME_BYTES) throw new AppError('Resume PDF is too large (max 20 MB).', 413)
    const header = new TextDecoder('latin1').decode(bytes.slice(0, 1024))
    if (!header.includes('%PDF-')) throw new AppError('Uploaded file is not a valid PDF.', 400)
    await this.deps.store.replace(userId, filename, bytes)
    await this.deps.index.invalidate(userId)
    return { ok: true as const, filename, size: bytes.length }
  }

  async delete(context: RequestContext) {
    const userId = this.userId(context)
    if (!(await this.deps.store.delete(userId))) throw new AppError('还没有上传过简历', 404)
    await this.deps.index.invalidate(userId)
    return { ok: true as const }
  }

  async text(context: RequestContext): Promise<string> {
    const file = await this.deps.store.read(this.userId(context))
    return file ? (await this.deps.extractor.extract(file.filename, file.bytes)).trim() : ''
  }

  async parse(context: RequestContext) {
    const file = await this.deps.store.read(this.userId(context))
    if (!file) throw new AppError('请先上传简历', 400)
    const text = (await this.deps.extractor.extract(file.filename, file.bytes)).trim()
    if (!text) throw new AppError('无法从 PDF 提取文本(可能是扫描件或图片型简历)', 500)
    const messages = [
      { role: 'system' as const, content: '你是简历解析引擎。只返回 JSON，不要其他内容。' },
      { role: 'user' as const, content: RESUME_PARSE_PROMPT.replace('{{resume_text}}', text.slice(0, MAX_PARSE_CHARS)) },
    ]
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const parsed = parseJsonResponse(await this.deps.ai.complete(context, messages, STRUCTURED_CHAT_OPTIONS))
        return { ok: true as const, parsed: validateResume(parsed) }
      } catch (error) {
        if (attempt === 1) throw new AppError('简历解析失败，请重试', 500)
      }
    }
    throw new AppError('简历解析失败，请重试', 500)
  }

  async transcribe(context: RequestContext, filename: string, bytes: Uint8Array) {
    if (!bytes.length) throw new AppError('Empty audio file.', 400)
    const index = filename.lastIndexOf('.')
    const suffix = index >= 0 ? filename.slice(index) : '.webm'
    try {
      return { text: await this.deps.transcription.transcribe(context, bytes, suffix) }
    } catch (error) {
      throw new AppError(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }
}
