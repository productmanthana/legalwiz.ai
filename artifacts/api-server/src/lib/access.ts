import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, casesTable, caseSharesTable, type User, type CaseRow } from "@workspace/db";
import { sessionUser } from "./auth";

export type AccessRole = "owner" | "editor" | "reviewer" | "investigator";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      appUser?: User;
    }
  }
}

/** The only account allowed to view the full, all-user audit history. */
const AUDIT_ADMIN_EMAIL = "drsampathkumarpatil@gmail.com";
export function isAuditAdmin(user: { email: string }): boolean {
  return user.email.trim().toLowerCase() === AUDIT_ADMIN_EMAIL;
}

export function currentUser(req: Request): User {
  if (!req.appUser) throw new Error("requireUser middleware not mounted");
  return req.appUser;
}

/** Resolves the session cookie to an app user; 401 when signed out. */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await sessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.appUser = user;
  next();
}

export async function resolveCaseRole(user: User, c: CaseRow): Promise<AccessRole | null> {
  if (c.ownerId === user.id) return "owner";
  if (!user.email) return null;
  const [share] = await db
    .select()
    .from(caseSharesTable)
    .where(and(eq(caseSharesTable.caseId, c.id), eq(caseSharesTable.email, user.email.toLowerCase())));
  return (share?.accessRole as AccessRole | undefined) ?? null;
}

export type Need = "read" | "edit" | "investigate" | "owner";

function allowed(role: AccessRole, need: Need): boolean {
  switch (need) {
    case "read":
      return true;
    case "edit":
      return role === "owner" || role === "editor";
    case "investigate":
      return role === "investigator" || role === "owner";
    case "owner":
      return role === "owner";
  }
}

/**
 * Loads a case and checks the current user's access. Sends 404/403 and returns null on failure.
 * Investigators get read access plus queries/assessments; reviewers are read-only.
 */
export async function loadCase(
  req: Request,
  res: Response,
  caseId: number,
  need: Need = "read",
): Promise<{ c: CaseRow; role: AccessRole; user: User } | null> {
  const user = currentUser(req);
  if (!Number.isFinite(caseId)) {
    res.status(400).json({ error: "Invalid case id" });
    return null;
  }
  const [c] = await db.select().from(casesTable).where(eq(casesTable.id, caseId));
  if (!c) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  const role = await resolveCaseRole(user, c);
  if (!role) {
    res.status(404).json({ error: "Case not found" });
    return null;
  }
  if (!allowed(role, need)) {
    res.status(403).json({ error: `Your access role (${role}) does not permit this action` });
    return null;
  }
  return { c, role, user };
}

/** All case ids visible to the user, with role. */
export async function accessibleCases(user: User): Promise<{ c: CaseRow; role: AccessRole }[]> {
  const owned = await db.select().from(casesTable).where(eq(casesTable.ownerId, user.id));
  const result: { c: CaseRow; role: AccessRole }[] = owned.map((c) => ({ c, role: "owner" as const }));
  if (user.email) {
    const shared = await db
      .select({ c: casesTable, role: caseSharesTable.accessRole })
      .from(caseSharesTable)
      .innerJoin(casesTable, eq(casesTable.id, caseSharesTable.caseId))
      .where(eq(caseSharesTable.email, user.email.toLowerCase()));
    for (const s of shared) {
      if (!result.some((r) => r.c.id === s.c.id)) result.push({ c: s.c, role: s.role as AccessRole });
    }
  }
  return result;
}

export function intParam(req: Request, name: string): number {
  const raw = req.params[name];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}
