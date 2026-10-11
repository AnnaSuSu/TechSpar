import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync, gzipSync } from 'fflate'
import { DataMigrationService, defaultProfile, mergeProfiles, type RequestContext, type UserRepository } from '@techspar/core'
import { BunDataMigrationRepository, BunInterviewSessionRepository, BunPersonalAgentRepository } from '@techspar/db'
import { FileCandidateProfileRepository, FileMigrationStore, TarGzipArchiveCodec, atomicWriteJson } from '@techspar/platform'

const TAR_BLOCK = 512
const encoder = new TextEncoder()
const roots: string[] = []
async function root(): Promise<string> { const value = await mkdtemp(join(tmpdir(), 'techspar-migration-')); roots.push(value); return value }
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })
const context = (userId: string): RequestContext => ({ requestId: 'test', userId, signal: new AbortController().signal })
const users: UserRepository = {
  async findByEmail() { return undefined }, async findById(id) { return { id, email: 'user@example.com', name: '', is_admin: id === 'admin' } }, async tokenVersion() { return 0 }, async create() { throw new Error() }, async updatePassword() {},
}
function service(base: string) {
  const data = join(base, 'data'); mkdirSync(data, { recursive: true }); const db = join(data, 'interviews.db'); const profiles = new FileCandidateProfileRepository(data)
  return { db, profiles, value: new DataMigrationService({ codec: new TarGzipArchiveCodec(), database: new BunDataMigrationRepository(db), files: new FileMigrationStore(data), profiles, users }) }
}
function concatBytes(parts: Array<Uint8Array<ArrayBufferLike>>): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}
function tarTestEntry(name: string, type: string, content: Uint8Array<ArrayBufferLike> = new Uint8Array(), linkName = ''): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK)
  const write = (offset: number, length: number, value: string) => { const bytes = encoder.encode(value); if (bytes.length > length) throw new Error('test tar field is too long'); header.set(bytes, offset) }
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0') + '\0'
  write(0, 100, name); write(100, 8, octal(0o600, 8)); write(108, 8, octal(0, 8)); write(116, 8, octal(0, 8)); write(124, 12, octal(content.length, 12)); write(136, 12, octal(1_700_000_000, 12))
  header.fill(32, 148, 156); write(156, 1, type); if (linkName) write(157, 100, linkName); write(257, 6, 'ustar'); write(263, 2, '00')
  const checksum = header.reduce((sum, value) => sum + value, 0); write(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  const output = new Uint8Array(TAR_BLOCK + Math.ceil(content.length / TAR_BLOCK) * TAR_BLOCK); output.set(header); output.set(content, TAR_BLOCK); return output
}
function tarTestArchive(entries: Uint8Array[]): Uint8Array { return gzipSync(concatBytes([...entries, new Uint8Array(TAR_BLOCK * 2)])) }
function terminated(value: string): Uint8Array { return concatBytes([encoder.encode(value), new Uint8Array(1)]) }
function paxRecord(key: string, value: string): Uint8Array {
  const body = `${key}=${value}\n`; let length = encoder.encode(`0 ${body}`).length
  for (;;) { const record = encoder.encode(`${length} ${body}`); if (record.length === length) return record; length = record.length }
}
function rawTarTypes(bytes: Uint8Array): string[] {
  const tar = gunzipSync(bytes); const types: string[] = []
  for (let offset = 0; offset + TAR_BLOCK <= tar.length;) {
    const header = tar.slice(offset, offset + TAR_BLOCK); offset += TAR_BLOCK
    if (header.every((value) => value === 0)) break
    types.push(String.fromCharCode(header[156] || 48))
    const size = Number.parseInt(new TextDecoder().decode(header.slice(124, 136)).replace(/\0/g, '').trim() || '0', 8)
    offset += Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
  }
  return types
}

describe('tar.gz archive safety', () => {
  test('round-trips version 2 manifests and rejects traversal paths', async () => {
    const codec = new TarGzipArchiveCodec()
    const bytes = await codec.pack({ manifest: { schema_version: 2, exported_at: '', user_id: 'user-a', backup_kind: 'personal', includes_sensitive_credentials: false }, files: new Map([['data/users/user-a/notes.md', new TextEncoder().encode('notes')]]) })
    expect((await codec.unpack(bytes)).manifest?.schema_version).toBe(2)
    const tar = gunzipSync(bytes); tar.set(new TextEncoder().encode('../evil'), 0)
    await expect(codec.unpack(gzipSync(tar))).rejects.toThrow('越界路径')
  })

  test('rejects corrupt headers and archives beyond the expanded-size limit', async () => {
    const codec = new TarGzipArchiveCodec()
    const bytes = await codec.pack({ manifest: { schema_version: 2, exported_at: '', user_id: 'user-a', backup_kind: 'personal', includes_sensitive_credentials: false }, files: new Map() })
    const corrupt = gunzipSync(bytes); corrupt[12] = corrupt[12]! ^ 1
    await expect(codec.unpack(gzipSync(corrupt))).rejects.toThrow('校验失败')

    const oversized = await codec.pack({ manifest: { schema_version: 2, exported_at: '', user_id: 'user-a', backup_kind: 'personal', includes_sensitive_credentials: false }, files: new Map([['data/users/user-a/large.txt', new Uint8Array(4096)]]) })
    await expect(new TarGzipArchiveCodec(1024).unpack(oversized)).rejects.toThrow('解压后过大')
  })

  test('reads a real legacy Python tarfile PAX archive with directories and portable filenames', async () => {
    // Generated once with Python stdlib tarfile in PAX_FORMAT, following the legacy exporter's tar.add layout.
    const fixture = Buffer.from((await readFile(join(import.meta.dir, 'fixtures/python-tarfile-pax-personal.tar.gz.b64'), 'utf8')).trim(), 'base64')
    const types = rawTarTypes(fixture)
    expect(types).toContain('x')
    expect(types).toContain('5')

    const archive = await new TarGzipArchiveCodec().unpack(fixture)
    expect(archive.manifest).toMatchObject({ schema_version: 2, user_id: 'legacy-user', backup_kind: 'personal' })
    expect(archive.directories).toContain('data/users/legacy-user/empty-folder')
    expect(new TextDecoder().decode(archive.files.get('data/users/legacy-user/library/ascii.txt'))).toBe('legacy ascii\n')
    expect(new TextDecoder().decode(archive.files.get('data/users/legacy-user/library/中文简历.md'))).toBe('旧版中文内容\n')
    const longPath = [...archive.files.keys()].find((path) => path.includes('/long-'))
    expect(longPath?.length).toBeGreaterThan(200)
    expect(new TextDecoder().decode(archive.files.get(longPath!))).toBe('legacy long path\n')

    const targetRoot = await root(); const target = service(targetRoot)
    expect(await target.value.importPersonal(context('target-user'), 'legacy-python.tar.gz', fixture, { dbStrategy: 'skip', overwriteFiles: false })).toMatchObject({ files_copied: 3, files_skipped: 0 })
    expect(new TextDecoder().decode(await readFile(join(targetRoot, 'data/users/target-user/library/中文简历.md')))).toBe('旧版中文内容\n')
  })

  test('applies global PAX paths and GNU long names', async () => {
    const globalPath = 'data/users/legacy-user/library/global.txt'
    const globalArchive = tarTestArchive([
      tarTestEntry('GlobalHead.0', 'g', paxRecord('path', globalPath)),
      tarTestEntry('placeholder', '0', encoder.encode('global pax')),
    ])
    expect(new TextDecoder().decode((await new TarGzipArchiveCodec().unpack(globalArchive)).files.get(globalPath))).toBe('global pax')

    const longPath = `data/users/legacy-user/library/${'segment'.repeat(22)}.txt`
    const gnuArchive = tarTestArchive([
      tarTestEntry('././@LongLink', 'L', terminated(longPath)),
      tarTestEntry('placeholder', '0', encoder.encode('gnu longname')),
    ])
    expect(new TextDecoder().decode((await new TarGzipArchiveCodec().unpack(gnuArchive)).files.get(longPath))).toBe('gnu longname')
  })

  test('validates PAX path overrides and still rejects GNU long links', async () => {
    const traversal = tarTestArchive([
      tarTestEntry('././@PaxHeader', 'x', paxRecord('path', '../outside.txt')),
      tarTestEntry('placeholder', '0', encoder.encode('unsafe')),
    ])
    await expect(new TarGzipArchiveCodec().unpack(traversal)).rejects.toThrow('越界路径')

    const longTarget = `data/users/legacy-user/library/${'target'.repeat(24)}`
    const linked = tarTestArchive([
      tarTestEntry('././@LongLink', 'K', terminated(longTarget)),
      tarTestEntry('data/users/legacy-user/library/link', '2', new Uint8Array(), 'placeholder'),
    ])
    await expect(new TarGzipArchiveCodec().unpack(linked)).rejects.toThrow('不允许链接条目')
  })

  test('exports a consistent full-system SQLite snapshot', async () => {
    const base = await root(); const { db } = service(base)
    const database = new Database(db, { create: true }); database.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('kept')"); database.close()
    const bytes = await new BunDataMigrationRepository(db).exportSystem()
    expect(bytes?.length).toBeGreaterThan(0)
    const snapshotPath = join(base, 'snapshot.db'); await Bun.write(snapshotPath, bytes!)
    const snapshot = new Database(snapshotPath, { readonly: true })
    expect(snapshot.query<{ value: string }, []>('SELECT value FROM sample').get()?.value).toBe('kept')
    snapshot.close()
  })
})

describe('personal archive migration', () => {
  test('merges behavior and mastery state by evidence recency', () => {
    const local = defaultProfile(); const archive = defaultProfile()
    local.behavior_signals.reasoning = { description: '旧描述', last_seen: '2026-08-01T00:00:00Z', times_seen: 2, improved: false, history: [{ event: 'seen', date: '2026-08-01' }] }
    archive.behavior_signals.reasoning = { description: '新描述', last_seen: '2026-08-19T00:00:00Z', times_seen: 3, improved: true, improved_at: '2026-08-19T00:00:00Z', history: [{ event: 'improved', date: '2026-08-19' }] }
    local.topic_mastery.python = { score: 60, notes: '旧状态', session_count: 1, last_assessed: '2026-08-01T00:00:00Z' }
    archive.topic_mastery.python = { score: 82, notes: '新状态', session_count: 2, last_assessed: '2026-08-19T00:00:00Z' }

    const merged = mergeProfiles(local, archive)
    expect(merged.behavior_signals.reasoning).toMatchObject({ times_seen: 3, improved: true, improved_at: '2026-08-19T00:00:00Z' })
    expect(merged.behavior_signals.reasoning.history).toHaveLength(2)
    expect(merged.topic_mastery.python).toMatchObject({ score: 82, notes: '新状态', session_count: 2 })
  })

  test('exports only owned portable data, rebinds it, and excludes credentials by default', async () => {
    const sourceRoot = await root(); const source = service(sourceRoot)
    const sessions = new BunInterviewSessionRepository(source.db); sessions.initialize()
    await sessions.create({ sessionId: 's1', userId: 'source-user', mode: 'topic_drill', topic: 'python' }); await sessions.updateStatus('s1', 'source-user', 'reviewed'); await sessions.saveReview({ sessionId: 's1', userId: 'source-user', review: 'good', scores: [{ question_id: 1, score: 8 }], overall: { avg_score: 8 } })
    await sessions.create({ sessionId: 'other', userId: 'other-user', mode: 'resume' })
    const personal = new BunPersonalAgentRepository(source.db); personal.initialize()
    await personal.createDocument({ documentId: 'd1', userId: 'source-user', filename: 'notes.md', storedName: 'd1.md', extension: '.md', sizeBytes: 5 })
    await personal.setDocumentStatus({ documentId: 'd1', userId: 'source-user', status: 'ready', chunkCount: 2 })
    await personal.createConversation({ conversationId: 'c1', userId: 'source-user', title: '成长计划' })
    const profile = defaultProfile(); profile.name = 'Source'; profile.stats.total_sessions = 5; profile.weak_points.push({ point: 'GIL', topic: 'python', times_seen: 1 })
    await source.profiles.save('source-user', profile)
    await new FileMigrationStore(join(sourceRoot, 'data')).write('source-user', 'library/d1.md', new TextEncoder().encode('notes'))
    await atomicWriteJson(join(sourceRoot, 'data/users/source-user/provider.json'), { api_key: 'secret' })
    const exported = await source.value.exportPersonal(context('source-user'), false)
    const archive = await new TarGzipArchiveCodec().unpack(exported.bytes)
    expect([...archive.files.keys()]).not.toContain('data/users/source-user/provider.json')

    const targetRoot = await root(); const target = service(targetRoot)
    const result = await target.value.importPersonal(context('target-user'), exported.filename, exported.bytes, { dbStrategy: 'skip', overwriteFiles: false })
    expect(result).toMatchObject({ db_inserted: 3, db_skipped: 0, requires_reindex: true })
    const database = new Database(target.db, { readonly: true })
    expect(database.query<{ user_id: string }, []>("SELECT user_id FROM sessions WHERE session_id = 's1'").get()?.user_id).toBe('target-user')
    expect(database.query<{ user_id: string; status: string; chunk_count: number }, []>("SELECT user_id, status, chunk_count FROM personal_documents WHERE document_id = 'd1'").get()).toEqual({ user_id: 'target-user', status: 'needs_reindex', chunk_count: 0 })
    expect(database.query<{ user_id: string }, []>("SELECT user_id FROM personal_conversations WHERE conversation_id = 'c1'").get()?.user_id).toBe('target-user')
    database.close()
    expect(new TextDecoder().decode(await readFile(join(targetRoot, 'data/users/target-user/library/d1.md')))).toBe('notes')
    expect((await target.profiles.load('target-user')).stats).toMatchObject({ total_sessions: 5, drill_avg_score: 8, avg_score: 8 })
    sessions.close(); personal.close()
  })

  test('is idempotent and never overwrites another user on a primary-key collision', async () => {
    const sourceRoot = await root(); const source = service(sourceRoot); const sourceSessions = new BunInterviewSessionRepository(source.db); sourceSessions.initialize()
    await sourceSessions.create({ sessionId: 'same-id', userId: 'source-user', mode: 'resume' })
    const exported = await source.value.exportPersonal(context('source-user'), false)
    const targetRoot = await root(); const target = service(targetRoot); const targetSessions = new BunInterviewSessionRepository(target.db); targetSessions.initialize()
    await targetSessions.create({ sessionId: 'same-id', userId: 'other-user', mode: 'recording' })
    const first = await target.value.importPersonal(context('target-user'), exported.filename, exported.bytes, { dbStrategy: 'overwrite', overwriteFiles: false })
    const second = await target.value.importPersonal(context('target-user'), exported.filename, exported.bytes, { dbStrategy: 'overwrite', overwriteFiles: true })
    expect(first).toMatchObject({ db_inserted: 0, db_skipped: 1 })
    expect(second).toMatchObject({ db_inserted: 0, db_skipped: 1 })
    expect((await targetSessions.get('same-id', 'other-user'))?.mode).toBe('recording')
    sourceSessions.close(); targetSessions.close()
  })

  test('rejects full-system archives at the personal import endpoint', async () => {
    const targetRoot = await root(); const target = service(targetRoot)
    const bytes = await new TarGzipArchiveCodec().pack({ manifest: { schema_version: 2, exported_at: '', user_id: null, backup_kind: 'system', includes_sensitive_credentials: true }, files: new Map() })
    await expect(target.value.importPersonal(context('target-user'), 'full.tar.gz', bytes, { dbStrategy: 'skip', overwriteFiles: false })).rejects.toThrow('单账户备份')
  })

  test('validates profile files before importing any database rows', async () => {
    const sourceRoot = await root(); const source = service(sourceRoot)
    const sourceSessions = new BunInterviewSessionRepository(source.db); sourceSessions.initialize()
    await sourceSessions.create({ sessionId: 'must-not-import', userId: 'source-user', mode: 'resume' })
    const database = await new BunDataMigrationRepository(source.db).exportPersonal('source-user')
    const codec = new TarGzipArchiveCodec()
    const bytes = await codec.pack({
      manifest: { schema_version: 2, exported_at: '', user_id: 'source-user', backup_kind: 'personal', includes_sensitive_credentials: false },
      database,
      files: new Map([['data/users/source-user/profile/profile.json', encoder.encode('[]')]]),
    })
    const targetRoot = await root(); const target = service(targetRoot)
    const targetSessions = new BunInterviewSessionRepository(target.db); targetSessions.initialize()
    await expect(target.value.importPersonal(context('target-user'), 'invalid-profile.tar.gz', bytes, { dbStrategy: 'skip', overwriteFiles: false })).rejects.toThrow('画像文件必须是 JSON 对象')
    expect(await targetSessions.get('must-not-import', 'target-user')).toBeUndefined()
    sourceSessions.close(); targetSessions.close()
  })
})
