import type { IdGenerator } from '../account/ports.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { EmbeddingUseCases, TextGenerationUseCases } from '../provider/ports.ts'
import type { ProfileUseCases } from '../profile/ports.ts'
import type { AgentMessage, PersonalAgentChatResult, PersonalConversation, PersonalDocument, PersonalDocumentHit } from './model.ts'

export interface PersonalAgentRepository {
  initialize(): void
  listDocuments(userId: string): Promise<PersonalDocument[]>
  getDocument(documentId: string, userId: string): Promise<PersonalDocument | undefined>
  createDocument(input: { documentId: string; userId: string; filename: string; storedName: string; extension: string; sizeBytes: number }): Promise<void>
  setDocumentStatus(input: { documentId: string; userId: string; status: PersonalDocument['status']; chunkCount?: number; error?: string }): Promise<void>
  deleteDocument(documentId: string, userId: string): Promise<boolean>
  replaceDocumentChunks(input: { documentId: string; userId: string; filename: string; chunks: Array<{ content: string; embedding: Float32Array }> }): Promise<void>
  deleteDocumentChunks(documentId: string, userId: string): Promise<void>
  searchDocuments(userId: string, embedding: Float32Array, topK: number): Promise<PersonalDocumentHit[]>
  listConversations(userId: string): Promise<Array<{ conversation_id: string; title: string; message_count: number; created_at: string; updated_at: string }>>
  getConversation(conversationId: string, userId: string): Promise<PersonalConversation | undefined>
  createConversation(input: { conversationId: string; userId: string; title: string }): Promise<PersonalConversation>
  saveConversation(conversationId: string, userId: string, messages: AgentMessage[]): Promise<void>
  appendConversationMessages(conversationId: string, userId: string, messages: readonly AgentMessage[]): Promise<boolean>
  deleteConversation(conversationId: string, userId: string): Promise<boolean>
  recentConversationMemory(userId: string, excludeConversationId: string, limit: number): Promise<Array<Record<string, unknown>>>
  recentMistakes(userId: string, limit: number): Promise<Array<Record<string, unknown>>>
}

export interface PersonalDocumentStore {
  save(userId: string, storedName: string, bytes: Uint8Array): Promise<void>
  read(userId: string, storedName: string): Promise<Uint8Array>
  delete(userId: string, storedName: string): Promise<void>
}

export interface PersonalDocumentExtractor {
  extract(filename: string, bytes: Uint8Array): Promise<string>
}

export interface PersonalAgentUseCases {
  documents(context: RequestContext): Promise<{ items: PersonalDocument[]; supported_extensions: string[]; max_upload_bytes: number }>
  upload(context: RequestContext, filename: string, bytes: Uint8Array): Promise<PersonalDocument>
  deleteDocument(context: RequestContext, documentId: string): Promise<{ ok: true }>
  conversations(context: RequestContext): Promise<{ items: unknown[] }>
  conversation(context: RequestContext, conversationId: string): Promise<PersonalConversation>
  deleteConversation(context: RequestContext, conversationId: string): Promise<{ ok: true }>
  chat(context: RequestContext, message: string, conversationId?: string): Promise<PersonalAgentChatResult>
  reindexAll(context: RequestContext): Promise<number>
  hasDocuments(context: RequestContext): Promise<boolean>
}

export type PersonalAgentDependencies = {
  repository: PersonalAgentRepository
  files: PersonalDocumentStore
  extractor: PersonalDocumentExtractor
  embeddings: EmbeddingUseCases
  ai: TextGenerationUseCases
  profile: ProfileUseCases
  ids: IdGenerator
}
