import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

function stringify(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Append-only audit trail. Every write path in the API calls this. */
export async function audit(
  req: Request,
  entry: {
    caseId?: number | null;
    caseTitle?: string | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    summary?: string;
    previous?: unknown;
    next?: unknown;
  },
): Promise<void> {
  const user = req.appUser;
  await db.insert(auditLogsTable).values({
    caseId: entry.caseId ?? null,
    caseTitle: entry.caseTitle ?? null,
    userId: user?.id ?? null,
    userName: user ? user.displayName : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? null,
    previousValue: stringify(entry.previous),
    newValue: stringify(entry.next),
  });
}

/** Returns only the keys whose values changed, for compact before/after logging. */
export function diff<T extends Record<string, unknown>>(before: T, patch: Partial<T>): { previous: Partial<T>; next: Partial<T> } {
  const previous: Partial<T> = {};
  const next: Partial<T> = {};
  for (const k of Object.keys(patch) as (keyof T)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(patch[k])) {
      previous[k] = before[k];
      next[k] = patch[k];
    }
  }
  return { previous, next };
}
