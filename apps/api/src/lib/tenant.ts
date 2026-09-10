import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// The only sanctioned way request-handling code touches the database. Route handlers
// and pipeline code must never import `prisma` from "../db" directly -- doing so would
// bypass the RLS session variable entirely (a fresh connection/transaction has no
// app.current_org_id set, and current_setting(..., true) then returns NULL, which our
// policies treat as "no rows", not "all rows" -- so a bypass silently returns nothing
// rather than leaking data, but it's still a correctness bug worth catching, not a
// convention to rely on getting right every time).
//
// set_config(..., true) is the parameterized equivalent of `SET LOCAL app.current_org_id
// = <value>` -- SET LOCAL itself doesn't accept a bind parameter safely, set_config does.
// `true` scopes it to the current transaction, matching SET LOCAL's reset-on-commit
// behavior, which is why this must run inside the same $transaction as the real query.
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return fn(tx);
  });
}
