function readMessageField(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const { detail, error, message } = value as Record<string, unknown>;
  for (const field of [detail, error, message]) {
    if (typeof field === "string" && field.trim()) return field.trim();
  }
}

export function parseApiErrorText(raw: string, fallback = "请求失败"): string {
  const text = raw.trim();
  if (!text) return fallback;
  try {
    return readMessageField(JSON.parse(text)) ?? text;
  } catch {
    return text;
  }
}

export function extractErrorMessage(error: unknown, fallback = "请求失败"): string {
  if (typeof error === "string") return parseApiErrorText(error, fallback);
  const message = error instanceof Error ? error.message : readMessageField(error);
  return parseApiErrorText(message ?? "", fallback);
}

export const errorMessage = extractErrorMessage;
