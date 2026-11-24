import { createContext } from "react";

export type Theme = "light" | "dark";

export interface ThemeContextValue {
  /** User's saved theme preference. */
  theme: Theme;
  /** Currently active theme on <html> (differs from `theme` while forced dark on Landing). */
  resolvedTheme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
  /** Temporarily lock <html class="dark"> (e.g. Landing dark aesthetic); returns unlock cleanup. */
  lockDark: () => () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
