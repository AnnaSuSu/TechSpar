export function getScoreToneClass(score: number): string {
  if (score >= 8) return "border-green/25 bg-green/12 text-green";
  if (score >= 6) return "border-primary/25 bg-primary/12 text-primary";
  if (score >= 4) return "border-orange/25 bg-orange/12 text-orange";
  return "border-red/25 bg-red/12 text-red";
}

export function getScoreColorVar(score: number): string {
  if (score >= 8) return "var(--success)";
  if (score >= 6) return "var(--primary)";
  if (score >= 4) return "var(--warning)";
  return "var(--destructive)";
}
