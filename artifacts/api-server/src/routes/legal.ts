import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, legalReferencesTable, caseLegalLinksTable, investigationQueriesTable } from "@workspace/db";
import {
  CreateLegalReferenceBody,
  UpdateLegalReferenceBody,
  VerifyLegalReferenceBody,
  CreateCaseLegalLinkBody,
  ListLegalReferencesQueryParams,
} from "@workspace/api-zod";
import { currentUser, intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { searchJudgmentsOnline } from "../lib/onlineJudgments";

const router: IRouter = Router();

router.get("/legal-references", async (req, res): Promise<void> => {
  const q = ListLegalReferencesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const f = q.data;
  const conds: SQL[] = [];
  if (f.sourceType) conds.push(eq(legalReferencesTable.sourceType, f.sourceType));
  if (f.court) conds.push(ilike(legalReferencesTable.court, `%${f.court}%`));
  if (f.verificationStatus) conds.push(eq(legalReferencesTable.verificationStatus, f.verificationStatus));
  if (f.category) conds.push(sql`${legalReferencesTable.categories} @> ${JSON.stringify([f.category])}::jsonb`);
  // Word search: a reference matches when any meaningful word appears in it; best matches first.
  const words = searchWords(f.search);
  const fields = [
    legalReferencesTable.title,
    legalReferencesTable.provision,
    legalReferencesTable.citation,
    legalReferencesTable.court,
    legalReferencesTable.legalIssue,
    legalReferencesTable.summary,
    legalReferencesTable.principle,
  ];
  if (words.length) {
    conds.push(or(...words.flatMap((w) => [...fields.map((c) => ilike(c, `%${w}%`)), sql`${legalReferencesTable.categories}::text ilike ${`%${w}%`}`]))!);
  }
  const rows = await db.select().from(legalReferencesTable).where(conds.length ? and(...conds) : undefined).orderBy(legalReferencesTable.sourceType, legalReferencesTable.title);
  if (words.length) {
    const score = (r: (typeof rows)[number]) => {
      const text = [r.title, r.provision, r.citation, r.court, r.legalIssue, r.summary, r.principle, JSON.stringify(r.categories)].join(" ").toLowerCase();
      return words.filter((w) => text.includes(w)).length;
    };
    rows.sort((a, b) => score(b) - score(a));
  }
  res.json(rows);
});

// Live web search for judgments (newest first). Results are unverified research leads.
router.get("/legal-online-search", async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim();
  if (q.length < 3) {
    res.status(400).json({ error: "Enter at least 3 characters" });
    return;
  }
  try {
    res.json({ results: await searchJudgmentsOnline(q) });
  } catch (e) {
    req.log?.error({ err: e }, "Online judgment search failed");
    res.status(502).json({ error: "Online search is unavailable right now. Try again shortly." });
  }
});

const STOP_WORDS = new Set(["case", "cases", "the", "and", "for", "with", "law", "judgment", "judgments", "vs", "versus"]);

function searchWords(search?: string): string[] {
  if (!search) return [];
  return [...new Set(search.toLowerCase().split(/[^\p{L}\p{N}()]+/u))].filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

router.post("/legal-references", async (req, res): Promise<void> => {
  const parsed = CreateLegalReferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // New references always start unverified, regardless of who adds them.
  const [r] = await db.insert(legalReferencesTable).values({ ...parsed.data, verificationStatus: "unverified" }).returning();
  await audit(req, { action: "legal_reference.created", entityType: "legal_reference", entityId: r!.id, summary: `Added "${r!.title}" to the legal library (unverified)`, next: parsed.data });
  res.status(201).json(r);
});

async function loadRef(id: number) {
  const [r] = await db.select().from(legalReferencesTable).where(eq(legalReferencesTable.id, id));
  return r;
}

router.get("/legal-references/:referenceId", async (req, res): Promise<void> => {
  const r = await loadRef(intParam(req, "referenceId"));
  if (!r) {
    res.status(404).json({ error: "Reference not found" });
    return;
  }
  res.json(r);
});

router.patch("/legal-references/:referenceId", async (req, res): Promise<void> => {
  const r = await loadRef(intParam(req, "referenceId"));
  if (!r) {
    res.status(404).json({ error: "Reference not found" });
    return;
  }
  const parsed = UpdateLegalReferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = diff(r as unknown as Record<string, unknown>, parsed.data);
  const substantive = ["citation", "decisionDate", "caseNumber", "court", "relevantParagraphs", "principle", "provision", "title"].some((k) => k in d.next);
  // Changing the substance of a verified reference resets it to unverified.
  const patch = substantive && r.verificationStatus === "verified" ? { ...parsed.data, verificationStatus: "unverified", verifiedBy: null, verifiedAt: null, verificationNote: "Reset to unverified after substantive edit" } : parsed.data;
  const [u] = await db.update(legalReferencesTable).set(patch).where(eq(legalReferencesTable.id, r.id)).returning();
  await audit(req, { action: "legal_reference.updated", entityType: "legal_reference", entityId: r.id, summary: `Edited "${r.title}"${patch !== parsed.data ? " — verification reset" : ""}`, previous: d.previous, next: d.next });
  res.json(u);
});

router.post("/legal-references/:referenceId/verify", async (req, res): Promise<void> => {
  const r = await loadRef(intParam(req, "referenceId"));
  if (!r) {
    res.status(404).json({ error: "Reference not found" });
    return;
  }
  const parsed = VerifyLegalReferenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = currentUser(req);
  const isVerified = parsed.data.verificationStatus === "verified";
  const [u] = await db
    .update(legalReferencesTable)
    .set({
      verificationStatus: parsed.data.verificationStatus,
      verificationNote: parsed.data.note,
      verifiedBy: isVerified ? user.displayName : null,
      verifiedAt: isVerified ? new Date() : null,
    })
    .where(eq(legalReferencesTable.id, r.id))
    .returning();
  await audit(req, { action: `legal_reference.${parsed.data.verificationStatus}`, entityType: "legal_reference", entityId: r.id, summary: `Marked "${r.title}" as ${parsed.data.verificationStatus}: ${parsed.data.note}`, previous: { verificationStatus: r.verificationStatus }, next: { verificationStatus: parsed.data.verificationStatus } });
  res.json(u);
});

router.get("/cases/:caseId/legal-links", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db
    .select({ link: caseLegalLinksTable, reference: legalReferencesTable })
    .from(caseLegalLinksTable)
    .innerJoin(legalReferencesTable, eq(legalReferencesTable.id, caseLegalLinksTable.legalReferenceId))
    .where(eq(caseLegalLinksTable.caseId, ctx.c.id))
    .orderBy(desc(caseLegalLinksTable.createdAt));
  res.json(rows.map((r) => ({ ...r.link, reference: r.reference })));
});

router.post("/cases/:caseId/legal-links", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  if (ctx.role === "reviewer") {
    res.status(403).json({ error: "Reviewers cannot link legal references" });
    return;
  }
  const parsed = CreateCaseLegalLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const ref = await loadRef(parsed.data.legalReferenceId);
  if (!ref) {
    res.status(400).json({ error: "Legal reference not found" });
    return;
  }
  if (parsed.data.queryId) {
    const [q] = await db.select().from(investigationQueriesTable).where(eq(investigationQueriesTable.id, parsed.data.queryId));
    if (!q || q.caseId !== ctx.c.id) {
      res.status(400).json({ error: "Query not found in this case" });
      return;
    }
  }
  const [l] = await db.insert(caseLegalLinksTable).values({ ...parsed.data, caseId: ctx.c.id }).returning();
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "legal_link.created", entityType: "legal_link", entityId: l!.id, summary: `Linked "${ref.title}" (${ref.verificationStatus}) to the case`, next: parsed.data });
  res.status(201).json({ ...l, reference: ref });
});

router.delete("/legal-links/:linkId", async (req, res): Promise<void> => {
  const [l] = await db.select().from(caseLegalLinksTable).where(eq(caseLegalLinksTable.id, intParam(req, "linkId")));
  if (!l) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  const ctx = await loadCase(req, res, l.caseId);
  if (!ctx) return;
  if (ctx.role === "reviewer") {
    res.status(403).json({ error: "Reviewers cannot remove legal links" });
    return;
  }
  await db.delete(caseLegalLinksTable).where(eq(caseLegalLinksTable.id, l.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "legal_link.deleted", entityType: "legal_link", entityId: l.id, summary: "Removed a legal reference link", previous: l });
  res.sendStatus(204);
});

export default router;
