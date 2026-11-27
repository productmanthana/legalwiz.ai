import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdateMeBody } from "@workspace/api-zod";
import { currentUser } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { aiConfigured } from "../lib/ai";
import { seedDemoCase } from "../lib/demo";

const router: IRouter = Router();

export function serializeUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    workspace: u.workspace,
    role: u.role,
    organisation: u.organisation,
    onboarded: u.onboarded,
  };
}

router.get("/me", async (req, res): Promise<void> => {
  res.json(serializeUser(currentUser(req)));
});

router.patch("/me", async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(req);
  const patch = { ...parsed.data, onboarded: true };
  const [updated] = await db.update(usersTable).set(patch).where(eq(usersTable.id, user.id)).returning();
  const d = diff(user as unknown as Record<string, unknown>, patch);
  await audit(req, { action: "profile.updated", entityType: "user", entityId: user.id, summary: "Updated profile", previous: d.previous, next: d.next });
  res.json(serializeUser(updated!));
});

router.get("/service-status", async (_req, res): Promise<void> => {
  res.json([
    {
      key: "ai_assistant",
      name: "AI financial assistant and draft responses",
      available: aiConfigured(),
      detail: aiConfigured()
        ? "Connected. All AI output is labelled as a suggestion and must be approved by a user."
        : "Not configured. Assistant and draft generation are unavailable.",
    },
    {
      key: "ocr",
      name: "OCR for scanned PDF statements",
      available: false,
      detail: "Not configured. PDF statements cannot be read automatically; export the statement as CSV or Excel from net banking and import that instead.",
    },
    {
      key: "legal_search",
      name: "External legal database search",
      available: false,
      detail: "Not connected. Use the curated legal library; every reference must be verified manually against an official source before reliance.",
    },
    {
      key: "document_storage",
      name: "Secure document storage",
      available: !!process.env.PRIVATE_OBJECT_DIR,
      detail: process.env.PRIVATE_OBJECT_DIR ? "Connected. Files are stored with a SHA-256 hash recorded at upload." : "Not configured.",
    },
  ]);
});

router.post("/demo/seed", async (req, res): Promise<void> => {
  const user = currentUser(req);
  const c = await seedDemoCase(user);
  await audit(req, { caseId: c.id, caseTitle: c.title, action: "case.demo_seeded", entityType: "case", entityId: c.id, summary: "Loaded clearly labelled demo case with fictitious data" });
  const { ownerId: _o, ...rest } = c;
  res.status(201).json({ ...rest, accessRole: "owner" });
});

export default router;
