import { useState, useEffect, useRef, type ReactNode } from "react";
import AuthContext, { type AuthUser } from "./AuthContextBase";
import { setResumeAccount } from "../resume/store/resumeAccount";
import { clearSession, readSession, saveSession, SESSION_KEY } from "../lib/authSession";
import { verifySession } from "../lib/sessionVerification";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(readSession);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const revision = useRef(0);

  function resetSession() {
    revision.current += 1;
    setResumeAccount(null);
    setSession(readSession());
    setUser(null);
    setNeedsOnboarding(false);
    setVerificationError(null);
    setLoading(Boolean(readSession()));
  }

  function retryVerification() {
    setVerificationError(null);
    setLoading(true);
    setVerificationAttempt((attempt) => attempt + 1);
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
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    verifySession(session.token, session.user.id, { signal: controller.signal })
      .then((result) => {
        if (!isCurrent()) return;
        if (result.status === "expired") {
          clearSession();
          resetSession();
          return;
        }
        setNeedsOnboarding(result.needsOnboarding);
        setResumeAccount(result.id);
        setUser(session.user);
      })
      .catch(() => {
        if (isCurrent()) setVerificationError("请检查网络后重试。");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (isCurrent()) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [session, verificationAttempt]);

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
    <AuthContext.Provider value={{ user, token: session?.token ?? null, loading, verificationError, retryVerification,
      needsOnboarding, setNeedsOnboarding, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
