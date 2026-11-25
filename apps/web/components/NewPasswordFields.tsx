"use client";
import { PasswordInput } from "./ui/PasswordInput";

// Password + confirmation, used by reset-password and accept-invite. The 10-character minimum
// matches the API's (apps/api/src/auth/crypto.ts).
export const PASSWORD_MIN_LENGTH = 10;

export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="new-password" className="label mb-1">
          New password
        </label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          className="field w-full"
        />
        <p className="mt-1 text-xs text-subtle">At least {PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.</p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="label mb-1">
          Confirm password
        </label>
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          className="field w-full"
        />
      </div>
    </>
  );
}
