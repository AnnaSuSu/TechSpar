import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "../contexts/ThemeContextBase";

export default function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
