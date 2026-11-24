import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { API_BASE, readErrorMessage } from "../api/client";
import type { SettingsResponse } from "../api/settings";
import AuthContext, { type AuthUser } from "./AuthContextBase";

function readStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem("user");
    const user: unknown = stored ? JSON.parse(stored) : null;
    return user && typeof user === "object" && !Array.isArray(user)
      ? user as AuthUser
      : null;
  } catch {
    return null;
  }
}

const AUTH_LOAD_ERROR = "无法加载账户信息，请稍后重试";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("token")
  );
  const [user, setUser] = useState<AuthUser | null>(() => token ? readStoredUser() : null);
  const [loading, setLoading] = useState(Boolean(token));
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const bootstrap = useRef<AbortController | null>(null);
  // 用户尚未配齐自己的 LLM/Embedding → 进首登引导。由 /api/settings 的 configured 决定。
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  function restartBootstrap() {
    bootstrap.current?.abort();
    setAuthError(null);
    setLoading(true);
    setRetryCount((count) => count + 1);
  }

  function retryAuth() {
    if (token) restartBootstrap();
  }

  function login(tokenStr: string, userData: AuthUser) {
    localStorage.setItem("token", tokenStr);
    localStorage.setItem("user", JSON.stringify(userData));
    restartBootstrap();
    setToken(tokenStr);
    setUser(userData);
  }

  const logout = useCallback(() => {
    bootstrap.current?.abort();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    setLoading(false);
    setAuthError(null);
    setNeedsOnboarding(false);
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const { signal } = controller;
    bootstrap.current = controller;
    const options = { headers: { Authorization: `Bearer ${token}` }, signal };

    async function fetchSessionResource(path: string) {
      const response = await fetch(`${API_BASE}${path}`, options);
      if (!signal.aborted && response.status === 401) logout();
      return response;
    }

    void Promise.allSettled([
      fetchSessionResource("/profile"),
      fetchSessionResource("/settings"),
    ])
      .then(async ([profile, settings]) => {
        if (signal.aborted) return;
        const profileRes = profile.status === "fulfilled" ? profile.value : null;
        const settingsRes = settings.status === "fulfilled" ? settings.value : null;

        if (settingsRes?.ok) {
          const { configured } = await settingsRes.json() as SettingsResponse;
          if (signal.aborted) return;
          setNeedsOnboarding(!(configured?.llm && configured?.embedding));
        }

        const failed = [profileRes, settingsRes].find((response) => response && !response.ok);
        if (failed) {
          const message = await readErrorMessage(
            failed,
            `服务暂时不可用（HTTP ${failed.status}），请稍后重试`,
          );
          if (!signal.aborted) setAuthError(message);
          return;
        }

        // Each response is inspected even if its sibling failed at the network layer.
        const networkFailure = [profile, settings].find((result) =>
          result.status === "rejected" && result.reason?.name !== "AbortError"
        );
        if (networkFailure) setAuthError(AUTH_LOAD_ERROR);
      })
      .catch((error: unknown) => {
        if (!signal.aborted && !(error instanceof Error && error.name === "AbortError")) {
          setAuthError(AUTH_LOAD_ERROR);
        }
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      bootstrap.current = null;
    };
  }, [token, retryCount, logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        authError,
        retryAuth,
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
