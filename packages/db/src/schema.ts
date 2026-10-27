import { blob, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  name: text('name').default(''),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
})

export const sessions = sqliteTable('sessions', {
  sessionId: text('session_id').primaryKey(),
  mode: text('mode').notNull(),
  topic: text('topic'),
  meta: text('meta').default('{}'),
  questions: text('questions').default('[]'),
  transcript: text('transcript').default('[]'),
  scores: text('scores').default('[]'),
  weakPoints: text('weak_points').default('[]'),
  overall: text('overall').default('{}'),
  referenceAnswers: text('reference_answers').default('{}'),
  review: text('review'),
  status: text('status').default('ongoing'),
  reviewError: text('review_error'),
  userId: text('user_id'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
})

export const resumeInterviewState = sqliteTable('resume_interview_state', {
  sessionId: text('session_id').primaryKey(),
  userId: text('user_id').notNull(),
  state: text('state').notNull(),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
})

export const copilotPreps = sqliteTable('copilot_preps', {
  prepId: text('prep_id').primaryKey(),
  userId: text('user_id').notNull(),
  company: text('company').default(''),
  position: text('position').default(''),
  jdText: text('jd_text').default(''),
  status: text('status').notNull().default('running'),
  progress: text('progress').default(''),
  error: text('error').default(''),
  result: text('result'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
})

export const copilotRealtimeSessions = sqliteTable('copilot_realtime_sessions', {
  sessionId: text('session_id').primaryKey(), userId: text('user_id').notNull(), prepId: text('prep_id').notNull(), conversation: text('conversation').notNull().default('[]'),
  reviewSessionId: text('review_session_id'), reviewClaimedAt: text('review_claimed_at'),
  lastNodeId: text('last_node_id'), turnCount: integer('turn_count').notNull().default(0), status: text('status').notNull().default('active'), createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'), updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
})

export const personalDocuments = sqliteTable('personal_documents', {
  documentId: text('document_id').primaryKey(),
  userId: text('user_id').notNull(),
  filename: text('filename').notNull(),
  storedName: text('stored_name').notNull(),
  extension: text('extension').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  status: text('status').notNull().default('indexing'),
  chunkCount: integer('chunk_count').notNull().default(0),
  error: text('error'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
})

export const personalConversations = sqliteTable('personal_conversations', {
  conversationId: text('conversation_id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('新对话'),
  messages: text('messages').notNull().default('[]'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  updatedAt: text('updated_at').default('CURRENT_TIMESTAMP'),
})

export const memoryVectors = sqliteTable('memory_vectors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chunkType: text('chunk_type').notNull(),
  content: text('content').notNull(),
  topic: text('topic'),
  sessionId: text('session_id'),
  metadata: text('metadata').default('{}'),
  embedding: blob('embedding').notNull(),
  userId: text('user_id'),
  createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
})

export const questionEmbeddings = sqliteTable(
  'question_embeddings',
  {
    questionHash: text('question_hash').notNull(),
    topic: text('topic'),
    questionText: text('question_text'),
    embedding: blob('embedding').notNull(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
  },
  (table) => [primaryKey({ columns: [table.questionHash, table.userId] })],
)

export const llmUsage = sqliteTable('llm_usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  source: text('source').notNull(),
  model: text('model').notNull().default(''),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
})

export const tasks = sqliteTable(
  'tasks',
  {
    taskId: text('task_id').notNull(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull().default('pending'),
    payload: text('payload').notNull().default('{}'),
    result: text('result'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
    updatedAt: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.userId] })],
)
