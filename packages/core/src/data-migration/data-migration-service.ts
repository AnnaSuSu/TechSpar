import { AppError, AuthenticationError } from '../kernel/errors.ts'
import type { RequestContext } from '../kernel/context.ts'
import { defaultProfile, type CandidateProfile } from '../profile/model.ts'
import { mergeProfiles } from '../profile/merge.ts'
import {
  DATA_ARCHIVE_SCHEMA_VERSION,
  MAX_ARCHIVE_UPLOAD_BYTES,
  type ArchiveManifest,
  type DataMigrationDependencies,
  type DataMigrationUseCases,
} from './ports.ts'

function id(context: RequestContext): string { if (!context.userId) throw new AuthenticationError(); return context.userId }
function timestamp(): string { return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) }
function profileFrom(bytes: Uint8Array): CandidateProfile {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('归档解析失败: 画像文件必须是 JSON 对象', 400)
  return { ...defaultProfile(), ...value as CandidateProfile }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function nonCopilotSessions(profile?: CandidateProfile): number {
  return Math.max(0, Number(profile?.stats?.total_sessions || 0) - Number(profile?.stats?.copilot_sessions || 0))
}

export class DataMigrationService implements DataMigrationUseCases {
  constructor(private readonly deps: DataMigrationDependencies) {}

  private manifest(userId: string | null, sensitive: boolean): ArchiveManifest {
    return { schema_version: DATA_ARCHIVE_SCHEMA_VERSION, exported_at: new Date().toISOString().slice(0, 19), user_id: userId, backup_kind: userId ? 'personal' : 'system', includes_sensitive_credentials: userId ? sensitive : true, source: 'data' }
  }

  async exportSystem(context: RequestContext) {
    const userId = id(context)
    if (!(await this.deps.users.findById(userId))?.is_admin) throw new AppError('Only administrators can export system data', 403)
    const [database, files] = await Promise.all([this.deps.database.exportSystem(), this.deps.files.exportSystem()])
    return { filename: `techspar-backup-${timestamp()}.tar.gz`, bytes: await this.deps.codec.pack({ manifest: this.manifest(null, true), ...(database ? { database } : {}), files }) }
  }

  async exportPersonal(context: RequestContext, includeSensitive: boolean) {
    const userId = id(context)
    const [database, files] = await Promise.all([this.deps.database.exportPersonal(userId), this.deps.files.exportPersonal(userId, includeSensitive)])
    return { filename: `techspar-personal-${timestamp()}.tar.gz`, bytes: await this.deps.codec.pack({ manifest: this.manifest(userId, includeSensitive), ...(database ? { database } : {}), files }) }
  }

  async importPersonal(context: RequestContext, filename: string, bytes: Uint8Array, options: { dbStrategy: 'skip' | 'overwrite'; overwriteFiles: boolean }) {
    const userId = id(context)
    if (!filename.endsWith('.tar.gz') && !filename.endsWith('.tgz')) throw new AppError('仅支持 .tar.gz / .tgz 归档', 400)
    if (!bytes.length) throw new AppError('归档内容为空', 400)
    if (bytes.length > MAX_ARCHIVE_UPLOAD_BYTES) throw new AppError('归档过大（上限 500 MB）', 413)
    if (!['skip', 'overwrite'].includes(options.dbStrategy)) throw new AppError("db_strategy 必须是 'skip' 或 'overwrite'", 400)
    let archive
    try { archive = await this.deps.codec.unpack(bytes) } catch (error) { throw new AppError(`归档解析失败: ${error instanceof Error ? error.message : String(error)}`, 400) }
    if (!archive.manifest?.user_id?.trim()) throw new AppError('归档解析失败: 仅支持带 user_id 的单账户备份，不能导入整站全量归档', 400)
    let importedProfile: CandidateProfile | undefined
    const filesToCopy: Array<{ relative: string; content: Uint8Array }> = []
    for (const [path, content] of archive.files) {
      const parts = path.split('/').filter(Boolean)
      if (parts.length < 4 || parts[0] !== 'data' || parts[1] !== 'users') continue
      const relative = parts.slice(3).join('/')
      if (!relative || relative.split('/').some((part) => part === '..' || part === '.index_cache' || part === '__pycache__')) continue
      if (relative === 'profile/profile.json') { importedProfile = profileFrom(content); continue }
      filesToCopy.push({ relative, content })
    }

    const db = archive.database ? await this.deps.database.importPersonal(archive.database, userId, options.dbStrategy) : { inserted: 0, skipped: 0 }
    let copied = importedProfile ? 1 : 0; let skipped = 0
    for (const { relative, content } of filesToCopy) {
      if (!options.overwriteFiles && await this.deps.files.exists(userId, relative)) { skipped += 1; continue }
      await this.deps.files.write(userId, relative, content); copied += 1
    }
    const rebuilt = await this.deps.database.rebuiltStats(userId)
    await this.deps.profiles.update(userId, (profile) => {
      // Normalize the two histories separately before their counters are merged.
      const otherSessions = Math.max(nonCopilotSessions(profile), nonCopilotSessions(importedProfile))
      const merged = importedProfile ? mergeProfiles(profile, importedProfile) : profile
      Object.assign(profile, merged)
      const stats = record(rebuilt.stats)
      for (const key of ['total_sessions', 'total_answers', 'resume_sessions', 'drill_sessions', 'job_prep_sessions', 'recording_sessions', 'copilot_sessions']) profile.stats[key] = Math.max(Number(profile.stats[key] || 0), Number(stats[key] || 0))
      if (typeof stats.copilot_sessions === 'number') {
        profile.stats.copilot_sessions = stats.copilot_sessions
        profile.stats.total_sessions = Math.max(Number(stats.total_sessions || 0), otherSessions + stats.copilot_sessions)
      }
      if (Array.isArray(stats.score_history) && stats.score_history.length) profile.stats.score_history = stats.score_history as Array<Record<string, unknown>>
      if (typeof stats.avg_score === 'number') profile.stats.avg_score = stats.avg_score
      for (const key of ['resume_avg_score', 'drill_avg_score', 'job_prep_avg_score', 'recording_avg_score', 'copilot_avg_score', 'dimension_scores']) if (stats[key] !== undefined) profile.stats[key] = stats[key]
      const topicCounts = record(rebuilt.topic_counts)
      for (const [topic, count] of Object.entries(topicCounts)) { const mastery = profile.topic_mastery[topic]; if (mastery) mastery.session_count = Math.max(Number(mastery.session_count || 0), Number(count || 0)) }
      profile.updated_at = new Date().toISOString()
    })
    await this.deps.database.invalidateDerivedData(userId)
    return { ok: true, schema_version: archive.manifest.schema_version, current_schema_version: DATA_ARCHIVE_SCHEMA_VERSION, db_inserted: db.inserted, db_skipped: db.skipped, files_copied: copied, files_skipped: skipped, requires_reindex: true }
  }
}
