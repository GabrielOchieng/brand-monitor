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
  invalid_credentials: "That email and password don't match.",
  invalid_or_expired_token: "This link has expired or was already used. Ask for a new one.",
  password_required: "Choose a password to finish.",
  bad_origin: "The request was blocked. Reload the page and try again.",
  already_member: "That person is already a member of this organization.",
  too_many_invites: "Your organization has sent today's limit of 20 invites. Try again tomorrow.",
  email_failed: "The email couldn't be sent. Try again in a few minutes.",
  cannot_remove_self: "You can't remove yourself.",
  wrong_password: "Your current password isn't right.",
  no_password: "This account has no password yet. Use \"Forgot password\" on the sign-in page to set one.",
  same_email: "That's already your email.",
  email_taken: "Another account already uses that email.",
  cannot_revoke_current_session: "To end this session, sign out.",
  invalid_totp: "That code isn't right, or was already used. Wait for the next one and try again.",
  invalid_recovery_code: "That recovery code isn't right, or was already used.",
  totp_not_configured: "Two-factor sign-in isn't available: the server has no AUTH_ENCRYPTION_KEY.",
  totp_already_enabled: "Two-factor sign-in is already on.",
  totp_setup_required: "Start the setup again.",
  totp_not_enabled: "Two-factor sign-in is off.",
  google_no_account: "No Brand Monitor account uses that Google account. Accounts are by invitation: ask an owner or admin to invite your email.",
  google_failed: "Google sign-in didn't go through. Try again.",
  google_cancelled: "Google sign-in was cancelled.",
  google_in_use: "That Google account is already linked to a different Brand Monitor account.",
  google_email_mismatch: "That Google account's email isn't the one this invite was sent to. Pick the invited address, or set a password instead.",
  google_not_configured: "Google sign-in isn't set up on this server.",
  google_not_linked: "No Google account is linked.",
  monitoring_paused: "Monitoring is paused for this brand by the platform admin, so nothing new can be scanned or searched.",
  cannot_target_self: "Use your own Account and security page for your account.",
  is_platform_admin: "That user is a platform admin. Revoke it first: npm run auth:make-admin -- --email <email> --revoke.",
  last_owner: "That would leave an organization with no owner. Make someone else owner first, or delete the organization.",
  confirm_mismatch: "The name you typed doesn’t match the organization’s name.",
  admin_read_only: "You're viewing this organization read-only as platform admin. Exit the view to make changes.",
  admin_requires_2fa: "The admin panel needs two-factor sign-in. Turn it on under Account and security.",
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
  invalid_domain: "That isn't a valid domain. Use the bare domain, like jambojet.com.",
  webhook_https_only: "The webhook address must start with https://.",
  not_yet_scanned: "This finding hasn't been scanned yet. Its first scan normally runs within about 5 minutes; try again after that.",
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = "ApiError";
  }
}

// For error codes that arrive in a URL (?error=...) rather than an API response.
export function describeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? "Something went wrong. Try again.";
}

function describeApiError(status: number, code: string | null): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (status === 429) return ERROR_MESSAGES.rate_limited;
  if (status >= 500) return "The server ran into a problem. Try again in a moment.";
  return `Something went wrong (error ${status}${code ? `, ${code}` : ""}).`;
}

// The session is an HttpOnly cookie the API sets (credentials: "include" sends it). Server
// components have no browser cookie jar: they pass the incoming Cookie header in init.headers
// (lib/serverApi.ts).
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, cache: "no-store", credentials: "include" });
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
