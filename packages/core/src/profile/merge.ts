import type { CandidateProfile } from './model.ts'

function clone<T>(value: T): T { return structuredClone(value) }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function mergeList(local: unknown[], archive: unknown[]): unknown[] {
  const output = clone(local); const seen = new Set(output.map(canonical))
  for (const item of archive) { const key = canonical(item); if (!seen.has(key)) { output.push(clone(item)); seen.add(key) } }
  return output
}
function mergeGeneric(local: unknown, archive: unknown): unknown {
  if (local === undefined || local === null || local === '') return clone(archive)
  if (Array.isArray(local) && Array.isArray(archive)) return mergeList(local, archive)
  if (local && archive && typeof local === 'object' && typeof archive === 'object' && !Array.isArray(local) && !Array.isArray(archive)) {
    const output = clone(local) as Record<string, unknown>
    for (const [key, value] of Object.entries(archive as Record<string, unknown>)) output[key] = key in output ? mergeGeneric(output[key], value) : clone(value)
    return output
  }
  return clone(local)
}
function normalized(value: unknown): string { return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim() }
function recency(value: Record<string, unknown>): string { return ['last_seen', 'improved_at', 'archived_at', 'last_assessed', 'retrospective_at', 'updated_at'].map((key) => typeof value[key] === 'string' ? value[key] as string : '').sort().at(-1) || '' }
function mergeFact(local: Record<string, unknown>, archive: Record<string, unknown>): Record<string, unknown> {
  const output = mergeGeneric(local, archive) as Record<string, unknown>
  output.first_seen = [local.first_seen, archive.first_seen].filter((value): value is string => typeof value === 'string' && Boolean(value)).sort()[0] || local.first_seen || archive.first_seen
  output.last_seen = [local.last_seen, archive.last_seen].filter((value): value is string => typeof value === 'string' && Boolean(value)).sort().at(-1) || local.last_seen || archive.last_seen
  output.times_seen = Math.max(Number(local.times_seen || 1), Number(archive.times_seen || 1))
  const newer = recency(archive) > recency(local) ? archive : local
  for (const key of ['improved', 'improved_at', 'archived', 'archived_at', 'sr']) if (key in newer) output[key] = clone(newer[key])
  for (const key of ['history', 'examples', 'consolidates']) if (Array.isArray(local[key]) && Array.isArray(archive[key])) { const list = mergeList(local[key] as unknown[], archive[key] as unknown[]); output[key] = key === 'examples' ? list.slice(-5) : list }
  return output
}
function mergeFacts(local: unknown, archive: unknown, includeSource: boolean): Array<Record<string, unknown>> {
  const output = (Array.isArray(local) ? local : []).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).map(clone)
  const key = (item: Record<string, unknown>) => `${normalized(item.topic)}\0${normalized(item.point)}${includeSource && item.source === 'consolidated' ? '\0consolidated' : ''}`
  const index = new Map(output.map((item, position) => [key(item), position]))
  for (const item of (Array.isArray(archive) ? archive : [])) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>; const marker = key(source); const position = index.get(marker)
    if (position === undefined) { index.set(marker, output.length); output.push(clone(source)) } else output[position] = mergeFact(output[position]!, source)
  }
  return output
}

function mergeBehaviorSignals(local: CandidateProfile['behavior_signals'], archive: CandidateProfile['behavior_signals']): CandidateProfile['behavior_signals'] {
  const output = clone(local || {})
  for (const [signalId, incoming] of Object.entries(archive || {})) {
    const current = output[signalId]
    output[signalId] = current && typeof current === 'object' ? mergeFact(current, incoming) : clone(incoming)
  }
  return output
}

function mergeTopicMastery(local: CandidateProfile['topic_mastery'], archive: CandidateProfile['topic_mastery']): CandidateProfile['topic_mastery'] {
  const output = clone(local || {})
  for (const [topic, incoming] of Object.entries(archive || {})) {
    const current = output[topic]
    if (!current || typeof current !== 'object') { output[topic] = clone(incoming); continue }
    const newer = recency(incoming) > recency(current) ? incoming : current
    const merged = mergeGeneric(current, incoming) as Record<string, unknown>
    Object.assign(merged, clone(newer))
    merged.session_count = Math.max(Number(current.session_count || 0), Number(incoming.session_count || 0))
    output[topic] = merged
  }
  return output
}

export function mergeProfiles(local: CandidateProfile, archive: CandidateProfile): CandidateProfile {
  const output = clone(local) as CandidateProfile
  const special = new Set(['weak_points', 'strong_points', 'behavior_signals', 'topic_mastery', 'stats', 'view_marker', 'updated_at', 'last_consolidation_at', '_pending_memory'])
  for (const [key, value] of Object.entries(archive)) if (!special.has(key)) output[key] = mergeGeneric(output[key], value)
  // A pending snapshot and its extraction must travel together, never merge their entry arrays.
  for (const [sessionId, pending] of Object.entries(archive._pending_memory || {})) {
    if (Object.hasOwn((local.session_extractions || {}) as object, sessionId) || local._pending_memory?.[sessionId]) continue
    if (!Object.hasOwn((archive.session_extractions || {}) as object, sessionId)) continue
    output._pending_memory ||= {}
    output._pending_memory[sessionId] = clone(pending)
  }
  if (local._pending_memory) {
    const extractions = (output.session_extractions ||= {}) as Record<string, unknown>
    for (const sessionId of Object.keys(local._pending_memory)) {
      const original = (local.session_extractions as Record<string, unknown> | undefined)?.[sessionId]
      if (original !== undefined) extractions[sessionId] = clone(original)
    }
  }
  output.weak_points = mergeFacts(local.weak_points, archive.weak_points, true) as CandidateProfile['weak_points']
  output.strong_points = mergeFacts(local.strong_points, archive.strong_points, false) as CandidateProfile['strong_points']
  output.behavior_signals = mergeBehaviorSignals(local.behavior_signals, archive.behavior_signals)
  output.topic_mastery = mergeTopicMastery(local.topic_mastery, archive.topic_mastery)
  output.stats = mergeGeneric(local.stats || {}, archive.stats || {}) as CandidateProfile['stats']
  for (const key of ['total_sessions', 'total_answers', 'resume_sessions', 'drill_sessions', 'job_prep_sessions', 'recording_sessions', 'copilot_sessions']) output.stats[key] = Math.max(Number(local.stats?.[key] || 0), Number(archive.stats?.[key] || 0))
  if (local.view_marker) output.view_marker = clone(local.view_marker); else if (archive.view_marker) output.view_marker = clone(archive.view_marker)
  output.last_consolidation_at = [local.last_consolidation_at, archive.last_consolidation_at].sort().at(-1) || ''
  output.updated_at = [local.updated_at, archive.updated_at].sort().at(-1) || ''
  return output
}
