import { describe, expect, test } from 'bun:test'
import {
  defaultProfile,
  ProfileService,
  SettingsOperationsService,
  type CandidateProfile,
  type CandidateProfileRepository,
  type KnowledgeStore,
  type KnowledgeVectorRepository,
  type PersonalAgentUseCases,
  type ProviderSettingsRepository,
} from '@techspar/core'
import { loadResponseFixture, loadTextFixture } from './fixture.ts'
import { responseInventory } from './response-inventory.ts'
import { boundaryApp, jsonHeaders, unavailable } from './test-app.ts'

const normalizedTime = '2026-01-01T00:00:00.000Z'

class MemoryProfileRepository implements CandidateProfileRepository {
  private readonly profiles = new Map<string, CandidateProfile>()

  async load(userId: string): Promise<CandidateProfile> {
    return structuredClone(this.profiles.get(userId) ?? defaultProfile())
  }

  async save(userId: string, profile: CandidateProfile): Promise<void> {
    this.profiles.set(userId, structuredClone(profile))
  }

  async update<T>(userId: string, mutate: (profile: CandidateProfile) => T | Promise<T>): Promise<T> {
    const profile = await this.load(userId)
    const result = await mutate(profile)
    await this.save(userId, profile)
    return result
  }
}

function profileService(repository: CandidateProfileRepository): ProfileService {
  return new ProfileService({
    repository,
    sessions: unavailable as never,
    tasks: unavailable as never,
    ai: unavailable as never,
    embeddings: unavailable as never,
    vectors: unavailable as never,
    resume: unavailable as never,
    knowledgeStore: unavailable as never,
  })
}

function dependencyStub<T extends object>(methods: Partial<T>): T {
  return new Proxy(methods, {
    get(target, property, receiver) {
      return Reflect.has(target, property)
        ? Reflect.get(target, property, receiver)
        : Reflect.get(unavailable, property)
    },
  }) as T
}

function fixtureFor(operation: string): string {
  const entry = responseInventory.find((entry) => entry.operation === operation)
  expect(entry?.fixture, `${operation} fixture`).toBeDefined()
  return entry!.fixture!
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  return body.trim().split(/\r?\n\r?\n/).map((frame) => {
    expect(frame).toStartWith('data: ')
    return JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>
  })
}

describe('HTTP response fixtures from real services', () => {
  test('matches the profile viewed marker and persists it for the authenticated user', async () => {
    const repository = new MemoryProfileRepository()
    const stored = defaultProfile()
    stored.stats.total_sessions = 3
    stored.topic_mastery = { typescript: { score: 72 }, python: { level: 3 }, javascript: { score: 0, level: 4 } }
    await repository.save('user-a', stored)

    const response = await boundaryApp({ profile: profileService(repository) }).request('/api/profile/viewed', {
      method: 'POST', headers: jsonHeaders,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const marker = await response.json() as Record<string, unknown>
    expect(marker.at).toBeString()
    expect(marker.at).toBe(new Date(marker.at as string).toISOString())
    expect((await repository.load('user-a')).view_marker).toEqual(marker)
    expect({ ...marker, at: normalizedTime }).toEqual(
      await loadResponseFixture(fixtureFor('POST /api/profile/viewed')),
    )
  })

  test('matches index rebuild SSE progress and completion events from the real service', async () => {
    const repository = new MemoryProfileRepository()
    const stored = defaultProfile()
    stored.weak_points = [{ point: '事件循环', topic: 'typescript' }]
    await repository.save('user-a', stored)
    const lastRebuilds = new Map<string, string>()
    const chunks = new Map<string, Parameters<KnowledgeVectorRepository['replaceChunks']>[0]['chunks']>()
    const settingsOperations = new SettingsOperationsService({
      chats: unavailable as never,
      embeddingDrivers: unavailable as never,
      embeddings: { async embed(_context, texts) { return texts.map(() => Float32Array.from([1, 0])) } },
      index: { async invalidateUser() {}, resetEmbeddingClient() {}, async rebuildTopic() {} },
      vectors: dependencyStub<KnowledgeVectorRepository>({
        async replaceChunks(input) { chunks.set(`${input.userId}:${input.chunkType}`, input.chunks) },
      }),
      knowledge: dependencyStub<KnowledgeStore>({
        async loadTopics() { return { typescript: { name: 'TypeScript', icon: '', dir: 'typescript' } } },
      }),
      personal: dependencyStub<PersonalAgentUseCases>({ async hasDocuments() { return true }, async reindexAll() { return 1 } }),
      profile: profileService(repository),
      settings: dependencyStub<ProviderSettingsRepository>({
        async saveLastReindexAt(userId, value) { lastRebuilds.set(userId, value) },
      }),
    })

    const response = await boundaryApp({ settingsOperations }).request('/api/settings/rebuild-index', {
      method: 'POST', headers: jsonHeaders,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body).toEndWith('\n\n')
    const events = parseSseEvents(body)
    const completion = events.at(-1)!
    expect(completion.last_rebuild_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(completion.last_rebuild_at).toBe(new Date(`${completion.last_rebuild_at}Z`).toISOString().slice(0, 19))
    expect(completion.last_rebuild_at).toBe(lastRebuilds.get('user-a'))
    expect(chunks.get('user-a:weak_point')).toEqual([
      { content: 'typescript: 事件循环', source: 'profile.json', embedding: Float32Array.from([1, 0]) },
    ])
    events[events.length - 1] = { ...completion, last_rebuild_at: normalizedTime.slice(0, 19) }
    expect(events).toEqual(parseSseEvents(await loadTextFixture(fixtureFor('POST /api/settings/rebuild-index'))))
  })
})
