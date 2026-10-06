import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  AuthService,
  ensureDefaultAccount,
  AiService,
  EmbeddingService,
  KnowledgeIndexService,
  KnowledgeService,
  InterviewService,
  PersistentTaskQueue,
  ProfileService,
  PersonalAgentService,
  DataMigrationService,
  QuotaService,
  ResumeService,
  ShortTranscriptionService,
  LongTranscriptionService,
  RecordingService,
  CopilotPrepService,
  CopilotRealtimeService,
  VoiceprintService,
  SettingsService,
  SettingsOperationsService,
  type PlatformProviderConfig,
} from '@techspar/core'
import { BunCopilotRepository, BunDataMigrationRepository, BunInterviewSessionRepository, BunKnowledgeVectorRepository, BunPersonalAgentRepository, BunResumeInterviewStateRepository, BunTaskRepository, BunUsageRepository, BunUserRepository } from '@techspar/db'
import {
  BcryptPasswordHasher,
  FileProviderSettingsRepository,
  FileKnowledgeStore,
  FileResumeStore,
  FileCandidateProfileRepository,
  FilePersonalDocumentStore,
  JoseTokenService,
  loadConfig,
  ShortUuidGenerator,
  PortableDocumentTextExtractor,
  PortablePersonalDocumentExtractor,
  FileMigrationStore,
  EncryptedFileVoiceprintRepository,
  TarGzipArchiveCodec,
} from '@techspar/platform'
import { DashScopeLongAsrDriver, QwenStreamingAsrFactory, DashScopeShortAsrDriver, OpenAiChatDriverFactory, OpenAiEmbeddingDriverFactory, TavilyWebSearchDriver, TencentVoiceprintDriverFactory } from '@techspar/providers'
import { createBunWebSocket, type BunWebSocketData } from 'hono/bun'
import { createApp } from './app.ts'
import { loadExtensions } from './extensions.ts'
import { withLongRequestTimeout } from './server-options.ts'

const config = loadConfig()
mkdirSync(dirname(config.dbPath), { recursive: true })
const users = new BunUserRepository(config.dbPath, config.defaultEmail)
users.initialize()
const passwordHasher = new BcryptPasswordHasher()
const ids = new ShortUuidGenerator()
await ensureDefaultAccount(users, passwordHasher, ids, {
  email: config.defaultEmail,
  password: config.defaultPassword,
  name: config.defaultName,
  ...(process.env.TECHSPAR_DESKTOP_MODE === '1' ? { rotateLegacyPassword: 'admin123' } : {}),
})
const usageRepository = new BunUsageRepository(config.dbPath)
usageRepository.initialize()
const settingsRepository = new FileProviderSettingsRepository(config.dataDir)
const persistedSystem = await settingsRepository.loadSystem()
const registration = { allowRegistration: persistedSystem?.allow_registration ?? config.allowRegistration }
const tokens = new JoseTokenService(config.jwtSecret)
const auth = new AuthService(
  users,
  passwordHasher,
  tokens,
  ids,
  registration,
)
const platform: PlatformProviderConfig = {
  llm: { api_base: config.platformLlmApiBase, api_key: config.platformLlmApiKey, model: config.platformLlmModel },
  embedding: {
    api_base: config.platformEmbeddingApiBase,
    api_key: config.platformEmbeddingApiKey,
    api_model: config.platformEmbeddingModel,
  },
  dailyCallLimit: config.platformDailyCallLimit,
  tokenLimit: config.platformTokenLimit,
  tokenWindow: config.platformTokenWindow,
}
const extensions = await loadExtensions(process.env.TECHSPAR_EXTENSIONS)
const extensionContext = { dbPath: config.dbPath, tokens }
const baseQuota = new QuotaService(usageRepository, platform)
const quota = extensions.quota ? extensions.quota(baseQuota, extensionContext) : baseQuota
const chatDrivers = new OpenAiChatDriverFactory()
const embeddingDrivers = new OpenAiEmbeddingDriverFactory()
const ai = new AiService(settingsRepository, platform, quota, chatDrivers)
const embeddings = new EmbeddingService(settingsRepository, platform, embeddingDrivers)
const vectorRepository = new BunKnowledgeVectorRepository(config.dbPath)
vectorRepository.initialize()
const knowledgeStore = new FileKnowledgeStore(config.dataDir)
const knowledgeIndex = new KnowledgeIndexService(knowledgeStore, vectorRepository, embeddings)
const settings = new SettingsService(settingsRepository, users, knowledgeIndex, platform, registration)
const knowledge = new KnowledgeService({
  store: knowledgeStore,
  extractor: new PortableDocumentTextExtractor(),
  index: knowledgeIndex,
  ai,
  ids: new ShortUuidGenerator(),
})
const resume = new ResumeService({
  store: new FileResumeStore(config.dataDir),
  extractor: new PortableDocumentTextExtractor(),
  index: { async invalidate(userId) { await vectorRepository.deleteChunks(userId, 'resume_chunk') } },
  ai,
  transcription: new ShortTranscriptionService(settingsRepository, new DashScopeShortAsrDriver()),
})
const sessions = new BunInterviewSessionRepository(config.dbPath)
sessions.initialize()
const interviewStates = new BunResumeInterviewStateRepository(config.dbPath)
interviewStates.initialize()
const taskRepository = new BunTaskRepository(config.dbPath)
taskRepository.initialize()
const taskQueue = new PersistentTaskQueue(taskRepository)
const profileRepository = new FileCandidateProfileRepository(config.dataDir)
const profile = new ProfileService({ repository: profileRepository, sessions, tasks: taskQueue, ai, embeddings, vectors: vectorRepository, resume, knowledgeStore })
const personalAgentRepository = new BunPersonalAgentRepository(config.dbPath)
personalAgentRepository.initialize()
const personalAgent = new PersonalAgentService({ repository: personalAgentRepository, files: new FilePersonalDocumentStore(config.dataDir), extractor: new PortablePersonalDocumentExtractor(), embeddings, ai, profile, ids: new ShortUuidGenerator() })
const settingsOperations = new SettingsOperationsService({ chats: chatDrivers, embeddingDrivers, embeddings, index: knowledgeIndex, vectors: vectorRepository, knowledge: knowledgeStore, personal: personalAgent, profile, settings: settingsRepository })
const interview = new InterviewService({ sessions, states: interviewStates, tasks: taskQueue, ids: new ShortUuidGenerator(), ai, resume, knowledge: knowledgeIndex, knowledgeStore, settings: settingsRepository, profile })
const recording = new RecordingService({ sessions, tasks: taskQueue, ids: new ShortUuidGenerator(), ai, profile, transcription: new LongTranscriptionService(settingsRepository, new DashScopeLongAsrDriver()) })
const copilotRepository = new BunCopilotRepository(config.dbPath)
copilotRepository.initialize()
const voiceprint = new VoiceprintService(new EncryptedFileVoiceprintRepository(config.dataDir, config.voiceprintEncryptionKey), new TencentVoiceprintDriverFactory())
const copilotAi = new AiService(settingsRepository, platform, quota, chatDrivers, config.copilotLlm)
const copilotDependencies = { repository: copilotRepository, tasks: taskQueue, ids: new ShortUuidGenerator(), ai: copilotAi, embeddings, profile, resume, settings: settingsRepository, search: new TavilyWebSearchDriver(), asr: new QwenStreamingAsrFactory(), asrConfig: config.copilotAsr }
const copilotPrep = new CopilotPrepService(copilotDependencies)
const copilotRealtime = new CopilotRealtimeService(copilotDependencies)
const migration = new DataMigrationService({ codec: new TarGzipArchiveCodec(), database: new BunDataMigrationRepository(config.dbPath), files: new FileMigrationStore(config.dataDir, config.voiceprintEncryptionKey), profiles: profileRepository, users })
taskQueue.register('resume_review', (task) => interview.runReviewTask(task))
taskQueue.register('drill_review', (task) => interview.runReviewTask(task))
taskQueue.register('jd_review', (task) => interview.runReviewTask(task))
taskQueue.register('recording_review', (task) => recording.runAnalysisTask(task))
taskQueue.register('copilot_prep', (task) => copilotPrep.runPrepTask(task))
taskQueue.register('retrospective', (task) => profile.runRetrospectiveTask(task))
await taskQueue.start()
const { upgradeWebSocket, websocket } = createBunWebSocket()
const app = createApp({ auth, registration, settings, settingsOperations, quota, tokens, knowledge, resume, interview, profile, personalAgent, migration, recording, copilotPrep, copilotRealtime, websocketUpgrade: upgradeWebSocket, voiceprint, extendRoutes: (instance) => extensions.routes?.(instance, extensionContext), webDir: config.webDir })

const server = Bun.serve<BunWebSocketData>(withLongRequestTimeout({ hostname: config.host, port: config.port, fetch: (request, server) => app.fetch(request, server), websocket }))
console.log(JSON.stringify({ event: 'techspar:ready', host: config.host, port: server.port }))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.stop(true).finally(() => process.exit(0)) })
