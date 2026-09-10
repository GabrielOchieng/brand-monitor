export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function apiFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      if (body?.error) detail = `: ${body.error}`;
    } catch {
      // non-JSON error body -- fall back to just the status
    }
    throw new Error(`API ${path} failed: ${res.status}${detail}`);
  }
  // 204 No Content (e.g. a successful DELETE) has no body -- res.json() would throw on
  // an empty string, not return something falsy.
  if (res.status === 204) return undefined as T;
  return res.json();
}
