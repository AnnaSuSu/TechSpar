export type IndexRebuildProgress = {
  completed: number
  total: number
  label: string
} & ({ status: 'running' | 'done' } | { status: 'error'; error: string })

export type IndexRebuildEvent =
  | IndexRebuildProgress
  | { done: true; rebuilt: { weak_points: boolean; personal_documents: boolean; topics: string[] }; last_rebuild_at: string }
  | { fatal: true; error: string }
