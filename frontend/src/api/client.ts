import { z } from "zod";

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

/** Raised when the API is reachable but rejects the request or returns an unusable shape. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fetch JSON from the backend and validate it against a schema before it reaches React.
 *
 * Validating at this boundary means a backend shape change surfaces here as a named
 * error instead of as an undefined value rendered somewhere deep in a gauge or a log
 * grid, where the cause would be far harder to trace.
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("Could not reach the planning service.", 0);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `Request failed with status ${response.status}.`;
    throw new ApiError(detail, response.status, payload);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError("The planning service returned an unexpected response.", response.status, parsed.error);
  }
  return parsed.data;
}

const healthSchema = z.object({ status: z.string(), service: z.string() });

export function fetchHealth() {
  return apiFetch("/api/health/", healthSchema);
}
