import { useState, useEffect, type ReactNode } from "react";
import AuthContext, { type AuthUser } from "./AuthContextBase";
import { setResumeAccount } from "../resume/store/resumeAccount";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token")
  );
  const [loading, setLoading] = useState(() =>
    Boolean(localStorage.getItem("token"))
  );
  // 用户尚未配齐自己的 LLM/Embedding → 进首登引导。由 /api/settings 的 configured 决定。
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);

  function login(tokenStr: string, userData: AuthUser) {
    setResumeAccount(null);
    localStorage.setItem("token", tokenStr);
    localStorage.setItem("user", JSON.stringify(userData));
    setLoading(true); // re-validate + load provider status before routing
    setToken(tokenStr);
    setUser(userData);
    setSessionVersion((version) => version + 1);
  }

  function logout() {
    setResumeAccount(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    setLoading(false);
    setNeedsOnboarding(false);
  }

  useEffect(() => {
    if (!token) return; // logout already cleared user/state; nothing to load
    let cancelled = false;
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch("/api/profile", { headers }),
      fetch("/api/settings", { headers }),
    ])
      .then(async ([profileRes, settingsRes]) => {
        if (cancelled) return;
        if (!profileRes.ok) {
          logout();
          return;
        }
        const stored = localStorage.getItem("user");
        const validatedUser = stored ? JSON.parse(stored) as AuthUser : null;
        if (typeof validatedUser?.id !== "string" || !validatedUser.id.trim()) {
          logout();
          return;
        }
        if (settingsRes.ok) {
          const data = (await settingsRes.json()) as {
            configured?: { llm?: boolean; embedding?: boolean };
          };
          const c = data.configured || {};
          setNeedsOnboarding(!(c.llm && c.embedding));
        }
        if (cancelled || localStorage.getItem("token") !== token) return;
        setResumeAccount(validatedUser.id);
        setUser(validatedUser);
      })
      .catch(() => {
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, sessionVersion]);

  useEffect(() => {
    const syncSession = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || (event.key !== "token" && event.key !== null)) return;
      setResumeAccount(null);
      const nextToken = localStorage.getItem("token");
      setLoading(Boolean(nextToken));
      setToken(nextToken);
      setUser(null);
      setNeedsOnboarding(false);
      setSessionVersion((version) => version + 1);
    };
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        needsOnboarding,
        setNeedsOnboarding,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
