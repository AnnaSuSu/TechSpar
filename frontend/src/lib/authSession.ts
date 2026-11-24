import type { AuthUser } from "../contexts/AuthContextBase";

export const SESSION_KEY = "techspar-session";
export interface AuthSession { token: string; user: AuthUser & { id: string } }

export function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    // Released clients used separate keys. Their identity must still be verified
    // by /auth/me before any account data is hydrated.
    const session = raw !== null ? JSON.parse(raw) : {
      token: localStorage.getItem("token"),
      user: JSON.parse(localStorage.getItem("user") || "null"),
    };
    if (typeof session?.token !== "string" || !session.token ||
        typeof session.user?.id !== "string" || !session.user.id.trim()) return null;
    return session;
  } catch { return null; }
}

export function getAuthToken(): string | null {
  return readSession()?.token ?? null;
}

export function saveSession(token: string, user: AuthUser): void {
  if (!token || typeof user.id !== "string" || !user.id.trim()) {
    throw new Error("登录信息无效，请重新登录");
  }
  // A single setItem is atomic: quota failure cannot combine two accounts.
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}
