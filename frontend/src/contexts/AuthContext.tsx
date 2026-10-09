import { useState, useEffect, useRef, type ReactNode } from "react";
import AuthContext, { type AuthUser } from "./AuthContextBase";
import { setResumeAccount } from "../resume/store/resumeAccount";
import { clearSession, readSession, saveSession, SESSION_KEY } from "../lib/authSession";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(readSession);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const revision = useRef(0);

  function resetSession() {
    revision.current += 1;
    setResumeAccount(null);
    setSession(readSession());
    setUser(null);
    setNeedsOnboarding(false);
    setLoading(Boolean(readSession()));
  }

  function logout() {
    clearSession();
    resetSession();
  }

  function login(token: string, userData: AuthUser) {
    revision.current += 1;
    setResumeAccount(null);
    try {
      saveSession(token, userData);
    } catch {
      logout();
      throw new Error("无法保存登录状态，请释放浏览器存储空间后重试");
    }
    resetSession();
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const startedAt = revision.current;
    const isCurrent = () => !cancelled && startedAt === revision.current &&
      readSession()?.token === session.token && readSession()?.user.id === session.user.id;
    const headers = { Authorization: `Bearer ${session.token}` };
    Promise.all([
      fetch("/api/auth/me", { headers }),
      fetch("/api/settings", { headers }),
    ])
      .then(async ([identityRes, settingsRes]) => {
        const identity = identityRes.ok ? await identityRes.json() : null;
        if (!isCurrent()) return;
        // Local metadata is never evidence of ownership. The server verifies
        // the exact token used above and returns its subject.
        if (typeof identity?.id !== "string" || identity.id !== session.user.id) {
          clearSession();
          resetSession();
          return;
        }
        const settings = settingsRes.ok ? await settingsRes.json() : null;
        if (!isCurrent()) return;
        const configured = settings?.configured;
        setNeedsOnboarding(settingsRes.ok && !(configured?.llm && configured?.embedding));
        setResumeAccount(identity.id);
        setUser(session.user);
      })
      .catch(() => {
        if (isCurrent()) {
          clearSession();
          resetSession();
        }
      })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.storageArea !== localStorage ||
          ![SESSION_KEY, "token", "user", null].includes(event.key)) return;
      resetSession();
    };
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener("storage", syncSession);
      revision.current += 1;
      setResumeAccount(null);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, token: session?.token ?? null, loading,
      needsOnboarding, setNeedsOnboarding, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
