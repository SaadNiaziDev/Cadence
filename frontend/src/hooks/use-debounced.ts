import { useEffect, useState } from "react";

/**
 * Trails a rapidly changing value by a fixed delay.
 *
 * Used to keep every keystroke in a location field from becoming a request to a free,
 * community-run geocoder.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
