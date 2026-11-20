export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Plain-English text for every error code the API sends back as `{ error: "<code>" }`.
// Components that want different wording for one case check `err.code` / `err.status`
// (never the message text, which is meant for people).
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "That item no longer exists. It may have been deleted.",
  invalid_request: "Some of the input isn't valid. Check it and try again.",
  invalid_url: "That isn't a valid web address.",
  target_not_allowed: "That address can't be checked (private and internal addresses aren't allowed).",
  no_brand: "Add a brand first.",
  unauthorized: "Your session has expired. Sign in again.",
  forbidden: "Your role doesn't allow this. Ask an owner or admin.",
  no_active_organization: "Choose an organization first.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  ai_daily_limit: "Today's limit of AI explanations has been reached. Try again tomorrow.",
  too_many_submissions: "Your organization has reached today's limit of 50 manual submissions. Try again tomorrow.",
  too_many_discovery_runs: "Your organization has reached today's limit of 12 manual discovery runs. Scheduled discovery still runs every 4 hours.",
  too_many_social_searches: "Your organization has reached today's limit of 3 manual social media searches. The scheduled search still runs every morning.",
  social_search_not_configured: "Social media search isn't set up: the API server has no TAVILY_API_KEY.",
  too_many_core_keywords: "At most 8 keywords can be paired.",
  duplicate_keyword: "That keyword is already on the list.",
  not_a_social_account: "That isn't a social account, WhatsApp link, or App Store / Google Play app link.",
  invalid_assignee: "That person isn't a member of this organization.",
  cannot_demote_last_owner: "The organization needs at least one owner.",
  cannot_change_own_role: "You can't change your own role.",
  not_yet_scanned: "This finding hasn't been scanned yet. Its first scan normally runs within about 5 minutes; try again after that.",
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = "ApiError";
  }
}

function describeApiError(status: number, code: string | null): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (status === 429) return ERROR_MESSAGES.rate_limited;
  if (status >= 500) return "The server ran into a problem. Try again in a moment.";
  return `Something went wrong (error ${status}${code ? `, ${code}` : ""}).`;
}

export async function apiFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, null);
  }
  if (!res.ok) {
    let code: string | null = null;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") code = body.error;
    } catch {
      // non-JSON error body -- fall back to just the status
    }
    throw new ApiError(describeApiError(res.status, code), res.status, code);
  }
  // 204 No Content (e.g. a successful DELETE) has no body -- res.json() would throw on
  // an empty string, not return something falsy.
  if (res.status === 204) return undefined as T;
  return res.json();
}
