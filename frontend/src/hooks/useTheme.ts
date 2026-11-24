import { useContext } from "react";
import { ThemeContext, type Theme, type ThemeContextValue } from "../contexts/ThemeContextBase";

// Fallback for standalone component mounts (e.g. unit tests outside ThemeProvider).
const FALLBACK_THEME: ThemeContextValue = {
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: (_next: Theme) => {},
  toggleTheme: () => {},
  lockDark: () => () => {},
};

export default function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK_THEME;
}
