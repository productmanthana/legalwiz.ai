import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { SignInBody, SignUpBody } from "@workspace/api-zod";
import { endSession, hashPassword, startSession, verifyPassword } from "../lib/auth";
import { serializeUser } from "./me";

const router: IRouter = Router();

router.post("/auth/sign-up", async (req, res): Promise<void> => {
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email, your name and a password of at least 8 characters" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .insert(usersTable)
    .values({ email, displayName: parsed.data.displayName.trim(), passwordHash: await hashPassword(parsed.data.password) })
    .onConflictDoNothing()
    .returning();
  if (!user) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  await startSession(res, user.id);
  res.status(201).json(serializeUser(user));
});

router.post("/auth/sign-in", async (req, res): Promise<void> => {
  const parsed = SignInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your email and password" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email.trim().toLowerCase()));
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }
  await startSession(res, user.id);
  res.json(serializeUser(user));
});

router.post("/auth/sign-out", async (req, res): Promise<void> => {
  await endSession(req, res);
  res.status(204).end();
});

export default router;
