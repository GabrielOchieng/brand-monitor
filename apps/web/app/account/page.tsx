"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiFetch } from "../../lib/api";
import { useSession, type Me } from "../../lib/session";
import { timeAgo } from "../../lib/format";
import { NewPasswordFields, newPasswordError } from "../../components/NewPasswordFields";
import { LoadingRegion, SkeletonList } from "../../components/Skeleton";
import { GoogleButton, errorText, googleStartUrl, useGoogleEnabled } from "../../components/GoogleButton";
import { PasswordInput } from "../../components/ui/PasswordInput";
import { PageHeader } from "../../components/ui/PageHeader";
import { FormSection } from "../../components/ui/Field";

type Status = { ok: boolean; text: string } | null;

// One part of the account page: what it is on the left, its controls on the right.
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <FormSection title={title} description={description} className="px-4 sm:px-5">
      {children}
    </FormSection>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role="status" className={`text-sm ${status.ok ? "text-ok" : "text-sev-critical"}`}>
      {status.text}
    </p>
  );
}

const post = (path: string, body: unknown, method = "POST") =>
  apiFetch<unknown>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function ProfileSection({ me }: { me: Me }) {
  const { setMe } = useSession();
  const [name, setName] = useState(me.user.name ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      setMe((await post("/auth/profile", { name }, "PATCH")) as Me);
      setStatus({ ok: true, text: "Saved." });
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Profile">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="name" className="label mb-1">
            Name
          </label>
          <input id="name" maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="field w-full sm:max-w-sm" />
        </div>
        <StatusLine status={status} />
        <button type="submit" disabled={busy} className="btn-secondary">
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </Section>
  );
}

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = newPasswordError(password, confirm);
    if (invalid) return setStatus({ ok: false, text: invalid });
    setBusy(true);
    setStatus(null);
    try {
      await post("/auth/password", { currentPassword: current, newPassword: password });
      setCurrent("");
      setPassword("");
      setConfirm("");
      setStatus({ ok: true, text: "Password changed. Every other device was signed out." });
      onChanged();
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Password" description="Changing it signs out every other device.">
      <form onSubmit={submit} className="space-y-3 sm:max-w-sm">
        <div>
          <label htmlFor="current-password" className="label mb-1">
            Current password
          </label>
          <PasswordInput id="current-password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="field w-full" />
        </div>
        <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <StatusLine status={status} />
        <button type="submit" disabled={busy} className="btn-secondary">
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>
    </Section>
  );
}

function EmailSection({ me }: { me: Me }) {
  const [newEmail, setNewEmail] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await post("/auth/email", { newEmail, currentPassword: current });
      setStatus({ ok: true, text: `We sent a link to ${newEmail}. Your email changes when you open it (within 1 hour).` });
      setNewEmail("");
      setCurrent("");
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Email" description={`You sign in with ${me.user.email}. Alerts and invites go here too.`}>
      <form onSubmit={submit} className="space-y-3 sm:max-w-sm">
        <div>
          <label htmlFor="new-email" className="label mb-1">
            New email
          </label>
          <input id="new-email" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="field w-full" />
        </div>
        <div>
          <label htmlFor="email-current-password" className="label mb-1">
            Current password
          </label>
          <PasswordInput id="email-current-password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="field w-full" />
        </div>
        <StatusLine status={status} />
        <button type="submit" disabled={busy} className="btn-secondary">
          {busy ? "Sending…" : "Send confirmation link"}
        </button>
      </form>
    </Section>
  );
}

// Shown once, right after they're made: the server keeps only hashes.
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Brand Monitor recovery codes (each works once)\n\n${codes.join("\n")}\n`;
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "brand-monitor-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Save these recovery codes somewhere safe, like a password manager. If you lose your phone, each one gets you in once. <span className="font-medium text-foreground">They won't be shown again.</span>
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-raised/50 p-4 font-mono text-sm text-foreground sm:max-w-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn-secondary" onClick={download}>
          Download
        </button>
        <button type="button" className="btn-primary" onClick={onDone}>
          I've saved them
        </button>
      </div>
    </div>
  );
}

interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

function TwoFactorSection({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const { refresh } = useSession();
  const enabled = me.security.totpEnabled;
  // off: "idle" -> "password" -> "scan" -> "codes"; on: "idle" | "regenerate" | "disable" | "codes"
  const [stage, setStage] = useState<"idle" | "password" | "scan" | "codes" | "regenerate" | "disable">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  function reset(next: typeof stage = "idle") {
    setStage(next);
    setPassword("");
    setCode("");
    setUseRecovery(false);
    setStatus(null);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const startSetup = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      setSetup((await post("/auth/totp/setup", { currentPassword: password })) as TotpSetup);
      setPassword("");
      setStage("scan");
    });
  };

  const confirmSetup = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = (await post("/auth/totp/enable", { code })) as { recoveryCodes: string[] };
      setCodes(res.recoveryCodes);
      setSetup(null);
      setCode("");
      setStage("codes");
      onChanged();
    });
  };

  const regenerate = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const res = (await post("/auth/totp/recovery-codes", { currentPassword: password })) as { recoveryCodes: string[] };
      setCodes(res.recoveryCodes);
      setPassword("");
      setStage("codes");
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await post("/auth/totp/disable", useRecovery ? { currentPassword: password, recoveryCode: code } : { currentPassword: password, code });
      reset();
      await refresh();
      setStatus({ ok: true, text: "Two-factor sign-in is off." });
    });
  };

  const passwordField = (id: string) => (
    <div>
      <label htmlFor={id} className="label mb-1">
        Current password
      </label>
      <PasswordInput id={id} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field w-full" />
    </div>
  );

  const description = enabled
    ? `On. Signing in asks for a code from your authenticator app. ${me.security.recoveryCodesLeft} of 10 recovery codes left.`
    : "Off. Turn it on so a stolen password alone can't get into your account. You'll need an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and the like).";

  return (
    <Section title="Two-factor sign-in" description={stage === "idle" || stage === "regenerate" || stage === "disable" ? description : undefined}>
      {stage === "codes" ? (
        <RecoveryCodes
          codes={codes}
          onDone={async () => {
            setCodes([]);
            reset();
            await refresh();
          }}
        />
      ) : stage === "password" ? (
        <form onSubmit={startSetup} className="space-y-3 sm:max-w-sm">
          {passwordField("totp-setup-password")}
          <StatusLine status={status} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Checking…" : "Continue"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </form>
      ) : stage === "scan" && setup ? (
        <form onSubmit={confirmSetup} className="space-y-4">
          <p className="text-sm text-muted-foreground">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the API, nothing to optimise */}
          <img src={setup.qrCodeDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="rounded-md border border-border bg-card p-2" />
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Can't scan it? Enter this key instead</summary>
            <code className="mt-2 block break-all rounded-sm bg-raised px-2 py-1 font-mono text-xs text-foreground">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
          </details>
          <div className="sm:max-w-sm">
            <label htmlFor="totp-confirm-code" className="label mb-1">
              Code from the app
            </label>
            <input
              id="totp-confirm-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="field w-full font-mono tracking-widest"
            />
          </div>
          <StatusLine status={status} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Checking…" : "Turn on"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </form>
      ) : stage === "regenerate" ? (
        <form onSubmit={regenerate} className="space-y-3 sm:max-w-sm">
          <p className="text-sm text-muted-foreground">Your current recovery codes will stop working.</p>
          {passwordField("totp-regen-password")}
          <StatusLine status={status} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Making…" : "Make new codes"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </form>
      ) : stage === "disable" ? (
        <form onSubmit={disable} className="space-y-3 sm:max-w-sm">
          {passwordField("totp-disable-password")}
          <div>
            <label htmlFor="totp-disable-code" className="label mb-1">
              {useRecovery ? "Recovery code" : "Code from the app"}
            </label>
            <input
              id="totp-disable-code"
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete={useRecovery ? "off" : "one-time-code"}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="field w-full font-mono"
            />
            <button type="button" className="mt-1 text-xs text-subtle hover:text-foreground" onClick={() => setUseRecovery((r) => !r)}>
              {useRecovery ? "Use a code from the app instead" : "Use a recovery code instead"}
            </button>
          </div>
          <StatusLine status={status} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-danger border border-sev-critical/40 px-3.5 py-2">
              {busy ? "Turning off…" : "Turn off two-factor"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </form>
      ) : enabled ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => reset("regenerate")}>
              New recovery codes
            </button>
            <button className="btn-ghost text-sev-critical hover:text-sev-critical" onClick={() => reset("disable")}>
              Turn off
            </button>
          </div>
          <StatusLine status={status} />
        </div>
      ) : (
        <div className="space-y-3">
          <button className="btn-primary" onClick={() => reset("password")}>
            Set up two-factor sign-in
          </button>
          <StatusLine status={status} />
        </div>
      )}
    </Section>
  );
}

function GoogleSection({ me }: { me: Me }) {
  const { setMe } = useSession();
  const enabled = useGoogleEnabled();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  // ?google=linked or ?google=<error code> arrives after the round trip to Google. Read once,
  // then dropped from the address bar so a reload doesn't show it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (!result) return;
    setStatus(result === "linked" ? { ok: true, text: "Google account linked. You can now sign in with it." } : { ok: false, text: errorText(result)! });
    url.searchParams.delete("google");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  async function unlink() {
    setBusy(true);
    setStatus(null);
    try {
      setMe((await post("/auth/google/unlink", {})) as Me);
      setStatus({ ok: true, text: "Google account unlinked." });
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Hidden entirely when the server has no Google client configured (and nothing is linked).
  if (enabled === null || (!enabled && !me.security.googleLinked)) return null;
  const linked = me.security.googleLinked;

  return (
    <Section
      title="Google"
      description={
        linked
          ? "Linked: you can sign in with your Google account."
          : "Link a Google account to sign in with it instead of your password. Two-factor sign-in, if on, still applies."
      }
    >
      <div className="space-y-3">
        {linked ? (
          me.security.hasPassword ? (
            <button className="btn-secondary" disabled={busy} onClick={unlink}>
              {busy ? "Unlinking…" : "Unlink Google"}
            </button>
          ) : (
            <p className="text-sm text-subtle">Google is your only way to sign in. To unlink it, first set a password with "Forgot password" on the sign-in page.</p>
          )
        ) : (
          <div className="sm:max-w-xs">
            <GoogleButton href={googleStartUrl({ mode: "link" })} label="Link Google account" />
          </div>
        )}
        <StatusLine status={status} />
      </div>
    </Section>
  );
}

interface SessionItem {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
}

// "Chrome on Windows" from a user-agent string; good enough to tell devices apart.
function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "unknown OS";
  return `${browser} on ${os}`;
}

function SessionsSection({ reloadKey }: { reloadKey: number }) {
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    setSessions(await apiFetch<SessionItem[]>("/auth/sessions"));
  }, []);

  useEffect(() => {
    load().catch((err) => setStatus({ ok: false, text: err.message }));
  }, [load, reloadKey]);

  async function revoke(id: string) {
    setStatus(null);
    try {
      await apiFetch(`/auth/sessions/${id}`, { method: "DELETE" });
      await load();
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    }
  }

  async function revokeOthers() {
    setStatus(null);
    try {
      await apiFetch("/auth/sessions/revoke-others", { method: "POST" });
      await load();
      setStatus({ ok: true, text: "Signed out everywhere else." });
    } catch (err: any) {
      setStatus({ ok: false, text: err.message });
    }
  }

  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Section title="Signed-in devices" description="Sessions last 30 days, or 7 days without use. Sign out any you don't recognise, then change your password.">
      {!sessions ? (
        <LoadingRegion label="Loading sessions">
          <SkeletonList rows={2} lines={0} />
        </LoadingRegion>
      ) : (
        <div className="space-y-4">
          <div className="divide-y divide-border">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-foreground">
                    <span className="truncate">{describeDevice(s.userAgent)}</span>
                    {s.current && <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-subtle">This device</span>}
                  </div>
                  <div className="text-xs text-subtle">
                    {s.ip ?? "unknown IP"} · active {timeAgo(s.lastSeenAt)} · signed in {new Date(s.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {!s.current && (
                  <button onClick={() => revoke(s.id)} className="btn-ghost shrink-0 text-xs">
                    Sign out
                  </button>
                )}
              </div>
            ))}
          </div>
          {others > 0 && (
            <button onClick={revokeOthers} className="btn-secondary">
              Sign out all other devices
            </button>
          )}
          <StatusLine status={status} />
        </div>
      )}
    </Section>
  );
}

export default function AccountPage() {
  const { me, isLoaded } = useSession();
  // Bumped after a password change, which signs out other devices, so the list refreshes.
  const [sessionsKey, setSessionsKey] = useState(0);

  if (!isLoaded || !me)
    return (
      <LoadingRegion label="Loading account">
        <SkeletonList rows={3} lines={2} />
      </LoadingRegion>
    );

  return (
    <div className="max-w-4xl">
      <PageHeader title="Account and security" description="Your profile, how you sign in, and where you're signed in." />
      <div className="rounded-md border border-border bg-card">
      <ProfileSection me={me} />
      <PasswordSection onChanged={() => setSessionsKey((k) => k + 1)} />
      <TwoFactorSection me={me} onChanged={() => setSessionsKey((k) => k + 1)} />
      <GoogleSection me={me} />
      <EmailSection me={me} />
      <SessionsSection reloadKey={sessionsKey} />
      </div>
    </div>
  );
}
