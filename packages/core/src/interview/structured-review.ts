import { finiteNumber, record, requiredText, stringArray, textValue, StructuredOutputError } from '../kernel/structured-output.ts'

// Shared by interview and recording producers. Optional fields stay optional,
// but a supplied field must satisfy its domain contract before persistence.
function point(value: unknown, path: string): void {
  if (typeof value === 'string') { requiredText(value, path); return }
  const item = record(value, path)
  requiredText(item.point, `${path}.point`)
  for (const field of ['topic', 'reason']) if (item[field] !== undefined) textValue(item[field], `${path}.${field}`)
  if (item.score !== undefined) finiteNumber(item.score, `${path}.score`, 0, 10)
  if (item.confidence !== undefined) finiteNumber(item.confidence, `${path}.confidence`, 0, 1)
}

export function validateScoreDetails(value: Record<string, unknown>, path: string): void {
  for (const field of ['assessment', 'improvement', 'understanding']) if (value[field] !== undefined) textValue(value[field], `${path}.${field}`)
  if (value.key_missing !== undefined) stringArray(value.key_missing, `${path}.key_missing`)
  if (value.weak_point !== undefined && value.weak_point !== null) point(value.weak_point, `${path}.weak_point`)
  if (value.difficulty !== undefined) finiteNumber(value.difficulty, `${path}.difficulty`, 1, 5)
}

export function validateOverall(value: unknown): Record<string, unknown> {
  const overall = record(value, 'overall')
  finiteNumber(overall.avg_score, 'overall.avg_score', 0, 10)
  for (const field of ['summary', 'role_fit_summary']) if (overall[field] !== undefined) textValue(overall[field], `overall.${field}`)
  if (overall.dimension_scores !== undefined) {
    for (const [key, score] of Object.entries(record(overall.dimension_scores, 'overall.dimension_scores'))) finiteNumber(score, `overall.dimension_scores.${key}`, 0, 10)
  }
  for (const field of ['new_weak_points', 'new_strong_points']) {
    const items = overall[field]
    if (items === undefined) continue
    if (!Array.isArray(items)) throw new StructuredOutputError('expected an array', `overall.${field}`)
    items.forEach((item, index) => point(item, `overall.${field}[${index}]`))
  }
  for (const [field, arrays] of [
    ['communication_observations', ['new_habits', 'new_suggestions']],
    ['thinking_patterns', ['new_strengths', 'new_gaps']],
    ['longitudinal', ['improved_points', 'persisting_points', 'new_concerns']],
  ] as const) {
    if (overall[field] === undefined) continue
    const item = record(overall[field], `overall.${field}`)
    for (const name of arrays) if (item[name] !== undefined) stringArray(item[name], `overall.${field}.${name}`)
    if (field === 'communication_observations' && item.style_update !== undefined) textValue(item.style_update, `overall.${field}.style_update`)
  }
  if (overall.topic_mastery !== undefined) {
    const mastery = record(overall.topic_mastery, 'overall.topic_mastery')
    if (mastery.notes !== undefined) textValue(mastery.notes, 'overall.topic_mastery.notes')
    if (mastery.score !== undefined) finiteNumber(mastery.score, 'overall.topic_mastery.score', 0, 100)
    if (mastery.coverage !== undefined) finiteNumber(mastery.coverage, 'overall.topic_mastery.coverage', 0, 1)
  }
  return overall
}
