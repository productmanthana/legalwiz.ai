import type { Request, Response } from "express";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const COOKIE = "fintrace_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function readToken(req: Request): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function startSession(res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessionsTable).values({ tokenHash: sha256(token), userId, expiresAt });
  res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: expiresAt });
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = readToken(req);
  if (token) await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, sha256(token)));
  res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

export async function sessionUser(req: Request): Promise<User | null> {
  const token = readToken(req);
  if (!token) return null;
  const [row] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .where(and(eq(sessionsTable.tokenHash, sha256(token)), gt(sessionsTable.expiresAt, new Date())));
  return row?.user ?? null;
}
