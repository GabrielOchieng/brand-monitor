import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError, apiFetch } from "./api";

// apiFetch for server components: forwards the browser's session cookie to the API (the
// cookie is scoped to the shared parent domain, so the web app's server receives it too).
// GET only -- the API's Origin check rejects cookie-carrying writes without a browser Origin.
// A dead session goes to /login instead of rendering an error page.
export async function serverApiFetch<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  try {
    return await apiFetch<T>(path, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/login");
    throw err;
  }
}
