import { adminPrisma } from "../adminDb";
import { decryptSecret } from "./secretBox";
import { hashRecoveryCode, verifyTotp } from "./totp";

// Every 2FA field back to "off" (account page and scripts/disable2fa.ts).
export const TOTP_OFF = { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] as string[] };

export type SecondFactor = { code?: string; recoveryCode?: string };

// Checks a TOTP code or a recovery code for a user with 2FA on, and uses it up:
// - a TOTP code's time step is recorded, and the update only succeeds if it's newer than the
//   last one, so the same code can't be replayed (even by two requests at once);
// - a recovery code is removed from the array in the same statement that checks it.
export async function consumeSecondFactor(userId: string, factor: SecondFactor): Promise<"ok" | "invalid"> {
  const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
  if (!auth?.totpEnabledAt || !auth.totpSecretEnc) return "invalid";

  if (factor.code) {
    const lastStep = auth.totpLastStep === null ? null : Number(auth.totpLastStep);
    const step = verifyTotp(decryptSecret(auth.totpSecretEnc), factor.code, lastStep);
    if (step === null) return "invalid";
    const { count } = await adminPrisma.userAuth.updateMany({
      where: { userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: BigInt(step) } }] },
      data: { totpLastStep: BigInt(step) },
    });
    return count === 1 ? "ok" : "invalid";
  }

  if (factor.recoveryCode) {
    const hash = hashRecoveryCode(factor.recoveryCode);
    const count = await adminPrisma.$executeRaw`
      UPDATE user_auth SET recovery_code_hashes = array_remove(recovery_code_hashes, ${hash}), updated_at = now()
      WHERE user_id = ${userId} AND ${hash} = ANY(recovery_code_hashes)`;
    return count === 1 ? "ok" : "invalid";
  }

  return "invalid";
}
