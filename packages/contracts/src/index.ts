import { z } from 'zod'

const UploadedFileSchema = z.instanceof(File).meta({ type: 'string', format: 'binary' })

export const ErrorResponseSchema = z.object({
  detail: z.string(),
  code: z.string().optional(),
  provider: z.string().optional(),
})

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  is_admin: z.boolean(),
})

export const LoginRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
})

export const RegisterRequestSchema = LoginRequestSchema.extend({
  name: z.string().default(''),
})

export const ChangePasswordRequestSchema = z.object({
  current_password: z.string(),
  new_password: z.string().min(8).max(128),
})

export const ChangePasswordResponseSchema = z.object({ status: z.literal('ok') })

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
})

export const AuthConfigSchema = z.object({
  allow_registration: z.boolean(),
})

export const ServiceInfoSchema = z.object({
  service: z.literal('TechSpar'),
  version: z.string(),
})

export const LlmSettingsSchema = z.object({
  api_base: z.string().default(''),
  api_key: z.string().default(''),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  compatibility: z.enum(['generic', 'deepseek']).default('generic'),
  /** 显式选用部署方的共享 key,即使自己也填了 key */
  use_platform: z.boolean().default(false),
})

export const EmbeddingSettingsSchema = z.object({
  backend: z.enum(['', 'api', 'local']).default(''),
  api_base: z.string().default(''),
  api_key: z.string().default(''),
  api_model: z.string().default(''),
  local_model: z.string().default(''),
  local_path: z.string().default(''),
  api_batch_size: z.number().int().min(1).max(2048).default(10),
})

export const ServiceSettingsSchema = z.object({
  dashscope_api_key: z.string().default(''),
  tavily_api_key: z.string().default(''),
  oss_access_key_id: z.string().default(''),
  oss_access_key_secret: z.string().default(''),
  oss_bucket: z.string().default(''),
  oss_endpoint: z.string().default(''),
})

export const SystemSettingsSchema = z.object({ allow_registration: z.boolean().default(false) })
export const TrainingSettingsSchema = z.object({
  num_questions: z.number().int().min(5).max(20).default(10),
  divergence: z.number().int().min(1).max(5).default(3),
})
export const ProviderStatusSchema = z.object({ llm: z.boolean(), embedding: z.boolean() })
export const SettingsViewSchema = z.object({
  llm: LlmSettingsSchema,
  embedding: EmbeddingSettingsSchema.default(EmbeddingSettingsSchema.parse({})),
  services: ServiceSettingsSchema.default(ServiceSettingsSchema.parse({})),
  system: SystemSettingsSchema.default({ allow_registration: false }),
  training: TrainingSettingsSchema,
  is_admin: z.boolean().default(false),
  configured: ProviderStatusSchema.default({ llm: false, embedding: false }),
  /** 本部署是否提供共享 key */
  platform: ProviderStatusSchema.default({ llm: false, embedding: false }),
  /** 此刻实际生效的 key 来源 */
  source: z.enum(['user', 'platform']).default('user'),
  last_reindex_at: z.string().default(''),
})

export const SettingsUpdateResponseSchema = z.object({ ok: z.literal(true), embedding_changed: z.boolean() })
export const SettingsProbeResponseSchema = z.object({ ok: z.boolean(), error: z.string().optional() })
export const QuotaStatusSchema = z.object({
  source: z.enum(['user', 'platform']),
  used: z.number().int().nonnegative(),
  /** 0 表示没有可用额度,null 表示不限量。 */
  limit: z.number().int().nonnegative().nullable(),
  /** 计量单位。token 按消耗量计，call 是仅按次数的兼容模式 */
  unit: z.enum(['token', 'call']),
  /** 额度的计量窗口。subscription 表示按订阅期的额度包计 */
  window: z.enum(['day', 'month', 'subscription']),
})

export const TopicSchema = z.object({ name: z.string(), icon: z.string(), dir: z.string() })
export const TopicMapSchema = z.record(z.string(), TopicSchema)
export const CreateTopicSchema = z.object({ name: z.string(), icon: z.string().optional(), key: z.string().optional() })
export const KnowledgeFileSchema = z.object({ filename: z.string(), content: z.string() })
export const KnowledgeFilesSchema = z.array(KnowledgeFileSchema)
export const KnowledgeContentSchema = z.object({ content: z.string().default('') })
export const CreateKnowledgeSchema = z.object({ filename: z.string(), content: z.string().default('') })
export const OkSchema = z.object({ ok: z.literal(true) })
export const TopicCreatedSchema = OkSchema.extend({ key: z.string() })
export const KnowledgeCreatedSchema = OkSchema.extend({ filename: z.string() })
export const KnowledgeGeneratedSchema = OkSchema.extend({ content: z.string() })
export const KnowledgeUploadSchema = z.object({ file: UploadedFileSchema })
export const QuestionGraphSchema = z.object({
  nodes: z.array(z.record(z.string(), z.unknown())),
  links: z.array(z.record(z.string(), z.unknown())),
})
export const ResumeStatusSchema = z.union([
  z.object({ has_resume: z.literal(false) }),
  z.object({ has_resume: z.literal(true), filename: z.string(), size: z.number().int().nonnegative() }),
])
export const ResumeUploadSchema = z.object({ file: UploadedFileSchema })
export const ResumeUploadedSchema = OkSchema.extend({ filename: z.string(), size: z.number().int().nonnegative() })
export const ResumeParsedSchema = OkSchema.extend({ parsed: z.record(z.string(), z.unknown()) })
export const TranscriptionSchema = z.object({ text: z.string() })
export const RecordingModeSchema = z.enum(['dual', 'solo'])
export const RecordingTranscriptionUploadSchema = z.object({ file: UploadedFileSchema, mode: RecordingModeSchema.default('dual') })
export const RecordingTranscriptionSchema = z.object({ transcript: z.string(), segments: z.array(z.unknown()) })
export const RecordingAnalyzeSchema = z.object({
  transcript: z.string().min(1),
  recording_mode: RecordingModeSchema.default('dual'),
  company: z.string().max(200).nullable().optional(),
  position: z.string().max(200).nullable().optional(),
})
export const RecordingAnalyzeResponseSchema = z.object({ session_id: z.string(), status: z.literal('pending') })
export const BinarySchema = z.any()

export const InterviewModeSchema = z.enum(['resume', 'topic_drill', 'jd_prep', 'recording'])
export const SessionStatusSchema = z.enum(['ongoing', 'ended', 'reviewing', 'reviewed', 'review_failed'])
export const InterviewQuestionSchema = z.object({
  id: z.union([z.string(), z.number()]),
  question: z.string(),
  difficulty: z.number().optional(),
  focus_area: z.string().optional(),
  category: z.string().optional(),
  intent: z.string().optional(),
}).passthrough()
export const InterviewAnswerSchema = z.object({
  question_id: z.union([z.string(), z.number()]),
  answer: z.string(),
  confidence: z.number().optional(),
}).passthrough()
export const StartInterviewSchema = z.object({
  mode: InterviewModeSchema,
  topic: z.string().nullable().optional(),
  num_questions: z.number().int().positive().optional(),
  divergence: z.number().int().min(1).max(5).optional(),
  target_role: z.string().optional(),
  job_description: z.string().max(12000).optional(),
})
export const JobPrepPreviewSchema = z.object({ jd_text: z.string(), company: z.string().nullable().optional(), position: z.string().nullable().optional(), use_resume: z.boolean().default(true) })
export const JobPrepStartSchema = JobPrepPreviewSchema.extend({ preview_data: z.record(z.string(), z.unknown()).optional() })
export const InterviewChatSchema = z.object({ session_id: z.string(), message: z.string() })
export const EndInterviewSchema = z.object({ answers: z.array(InterviewAnswerSchema).default([]) })
export const ReferenceAnswerRequestSchema = z.object({ session_id: z.string(), question_id: z.union([z.string(), z.number()]) })
export const ReferenceAnswerResponseSchema = z.object({ reference_answer: z.string(), cached: z.boolean() })
export const InterviewObjectSchema = z.record(z.string(), z.unknown())
export const InterviewTopicsSchema = z.array(z.string())
export const TaskStatusSchema = z.object({ status: z.enum(['pending', 'done', 'error']), type: z.string(), error: z.string().optional() }).passthrough()
export const ProfileSchema = z.record(z.string(), z.unknown())
export const TargetRoleSchema = z.object({ target_role: z.string() })
export const ProfileFeedbackSchema = z.object({ point: z.string(), verdict: z.enum(['accurate', 'inaccurate', 'acknowledged']) })
export const RetrospectiveTaskSchema = z.object({ task_id: z.string(), status: z.literal('pending') })
export const PersonalDocumentUploadSchema = z.object({ file: UploadedFileSchema })
export const PersonalAgentChatSchema = z.object({ conversation_id: z.string().nullable().optional(), message: z.string().min(1).max(12000) })
export const PersonalAgentMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  created_at: z.string(),
  sources: z.array(z.object({ document_id: z.string(), filename: z.string() })).optional(),
})
export const PersonalAgentChatResponseSchema = z.object({ conversation_id: z.string(), title: z.string(), message: PersonalAgentMessageSchema })
export const PersonalAgentObjectSchema = z.record(z.string(), z.unknown())
export const DataImportSchema = z.object({
  file: UploadedFileSchema,
  db_strategy: z.enum(['skip', 'overwrite']).default('skip'),
  overwrite_files: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).default(false),
})

export const CopilotPrepCreateSchema = z.object({ jd_text: z.string().min(1), company: z.string().default(''), position: z.string().default('') })
export const CopilotPrepCreatedSchema = z.object({ prep_id: z.string() })
export const CopilotPrepObjectSchema = z.record(z.string(), z.unknown())
export const CopilotPrepListSchema = z.array(CopilotPrepObjectSchema)
export const VoiceprintCredentialsSchema = z.object({ secret_id: z.string(), secret_key: z.string(), app_id: z.string().default('') })
export const VoiceprintStatusSchema = z.object({ configured: z.boolean(), enrolled: z.boolean(), enrolled_at: z.string().nullable().optional(), speaker_nick: z.string().nullable().optional() })
export const VoiceprintUploadSchema = z.object({ file: UploadedFileSchema })
export const VoiceprintEnrolledSchema = OkSchema.extend({ enrolled_at: z.string() })

export const CopilotClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), prep_id: z.string().optional() }),
  z.object({ type: z.literal('manual'), text: z.string().optional() }),
  z.object({ type: z.literal('candidate_response'), text: z.string() }),
  z.object({ type: z.literal('stop') }),
])

export const CopilotServerEventTypeSchema = z.enum([
  'asr_interim',
  'asr_final',
  'copilot_update',
  'risk_alert',
  'answer_chunk',
  'answer_meta',
  'answer_done',
  'hr_profile_update',
  'monitor_update',
  'progress',
  'started',
  'stopped',
  'error',
])

export type LoginRequest = z.infer<typeof LoginRequestSchema>
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>
export type CopilotClientMessage = z.infer<typeof CopilotClientMessageSchema>
export type SettingsViewContract = z.infer<typeof SettingsViewSchema>
