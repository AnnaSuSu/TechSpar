import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeContext, type Theme, type ThemeContextValue } from "./ThemeContextBase";

const STORAGE_KEY = "theme";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  const [darkLocks, setDarkLocks] = useState(0);

  const resolvedTheme: Theme = darkLocks > 0 ? "dark" : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const lockDark = useCallback(() => {
    setDarkLocks((count) => count + 1);
    return () => {
      setDarkLocks((count) => Math.max(0, count - 1));
    };
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme, lockDark }),
    [theme, resolvedTheme, setTheme, toggleTheme, lockDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
