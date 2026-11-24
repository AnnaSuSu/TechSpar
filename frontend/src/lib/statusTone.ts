export type StatusTone = "blue" | "amber" | "green" | "neutral";

export function statusToneClasses(tone: StatusTone): string {
  if (tone === "green") return "border-green/25 bg-green/10 text-green";
  if (tone === "blue") return "border-blue-500/25 bg-blue-500/10 text-blue-500 dark:text-blue-300";
  if (tone === "amber") return "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  return "border-border/80 bg-card/80 text-text";
}
