import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "hos-theme";

/**
 * Dark is the default rather than following the system.
 *
 * The usage context this interface is built for is a cab at night or a dispatch desk, and
 * the map style, the gauges and the duty-status palette are all tuned dark first. Light
 * mode exists mainly because it is what prints.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((current) => (current === "dark" ? "light" : "dark")), []);

  return { theme, toggle };
}
