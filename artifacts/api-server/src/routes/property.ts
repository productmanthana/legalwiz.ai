import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  assetsTable,
  liabilitiesTable,
  familyMembersTable,
  bankAccountsTable,
  ledgerEntriesTable,
} from "@workspace/db";
import {
  CreateAssetBody,
  UpdateAssetBody,
  CreateLiabilityBody,
  UpdateLiabilityBody,
  CreateFamilyMemberBody,
  UpdateFamilyMemberBody,
} from "@workspace/api-zod";
import type { PgTable } from "drizzle-orm/pg-core";
import { intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { round2 } from "../lib/finance";

const router: IRouter = Router();

type ZodLike = { safeParse: (v: unknown) => { success: true; data: Record<string, unknown> } | { success: false; error: { message: string } } };

/** Generic case-scoped CRUD for simple entities; every write is audited. */
function crud(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: PgTable & { id: any; caseId: any };
  plural: string;
  idParam: string;
  entity: string;
  label: (row: Record<string, unknown>) => string;
  create: ZodLike;
  update: ZodLike;
  list?: (caseId: number, rows: Record<string, unknown>[]) => Promise<unknown[]>;
}) {
  const { table } = opts;
  const one = async (row: Record<string, unknown>) => (opts.list ? (await opts.list(row.caseId as number, [row]))[0] : row);

  router.get(`/cases/:caseId/${opts.plural}`, async (req, res): Promise<void> => {
    const ctx = await loadCase(req, res, intParam(req, "caseId"));
    if (!ctx) return;
    const rows = (await db.select().from(table).where(eq(table.caseId, ctx.c.id)).orderBy(table.id)) as Record<string, unknown>[];
    res.json(opts.list ? await opts.list(ctx.c.id, rows) : rows);
  });

  router.post(`/cases/:caseId/${opts.plural}`, async (req, res): Promise<void> => {
    const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
    if (!ctx) return;
    const parsed = opts.create.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const values = { ...parsed.data, caseId: ctx.c.id };
    const [row] = (await db.insert(table).values(values).returning()) as Record<string, unknown>[];
    await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: `${opts.entity}.created`, entityType: opts.entity, entityId: row!.id as number, summary: `Added ${opts.label(row!)}`, next: parsed.data });
    res.status(201).json(await one(row!));
  });

  const loadOne = async (req: Request, res: Response) => {
    const [row] = (await db.select().from(table).where(eq(table.id, intParam(req, opts.idParam)))) as Record<string, unknown>[];
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return null;
    }
    const ctx = await loadCase(req, res, row.caseId as number, "edit");
    if (!ctx) return null;
    return { row, ctx };
  };

  router.patch(`/${opts.plural}/:${opts.idParam}`, async (req, res): Promise<void> => {
    const r = await loadOne(req, res);
    if (!r) return;
    const parsed = opts.update.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [u] = (await db.update(table).set(parsed.data).where(eq(table.id, r.row.id)).returning()) as Record<string, unknown>[];
    const d = diff(r.row, parsed.data);
    await audit(req, { caseId: r.ctx.c.id, caseTitle: r.ctx.c.title, action: `${opts.entity}.updated`, entityType: opts.entity, entityId: r.row.id as number, summary: `Updated ${opts.label(u!)}`, previous: d.previous, next: d.next });
    res.json(await one(u!));
  });

  router.delete(`/${opts.plural}/:${opts.idParam}`, async (req, res): Promise<void> => {
    const r = await loadOne(req, res);
    if (!r) return;
    await db.delete(table).where(eq(table.id, r.row.id));
    await audit(req, { caseId: r.ctx.c.id, caseTitle: r.ctx.c.title, action: `${opts.entity}.deleted`, entityType: opts.entity, entityId: r.row.id as number, summary: `Deleted ${opts.label(r.row)}`, previous: r.row });
    res.sendStatus(204);
  });
}

crud({
  table: assetsTable,
  plural: "assets",
  idParam: "assetId",
  entity: "asset",
  label: (r) => `asset "${r.description}"`,
  create: CreateAssetBody as unknown as ZodLike,
  update: UpdateAssetBody as unknown as ZodLike,
});

crud({
  table: liabilitiesTable,
  plural: "liabilities",
  idParam: "liabilityId",
  entity: "liability",
  label: (r) => `liability from ${r.lender}`,
  create: CreateLiabilityBody as unknown as ZodLike,
  update: UpdateLiabilityBody as unknown as ZodLike,
});

crud({
  table: familyMembersTable,
  plural: "family-members",
  idParam: "memberId",
  entity: "family_member",
  label: (r) => `family member ${r.name} (${r.relationship})`,
  create: CreateFamilyMemberBody as unknown as ZodLike,
  update: UpdateFamilyMemberBody as unknown as ZodLike,
  list: async (caseId, rows) => {
    const [accounts, assets, entries] = await Promise.all([
      db.select({ f: bankAccountsTable.familyMemberId }).from(bankAccountsTable).where(eq(bankAccountsTable.caseId, caseId)),
      db.select().from(assetsTable).where(eq(assetsTable.caseId, caseId)),
      db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.caseId, caseId)),
    ]);
    return rows.map((m) => {
      const id = m.id as number;
      const own = assets.filter((a) => a.familyMemberId === id);
      return {
        ...m,
        bankAccountCount: accounts.filter((a) => a.f === id).length,
        assetCount: own.length,
        assetsValue: round2(own.reduce((s, a) => s + (a.currentValuation ?? a.purchasePrice ?? 0), 0)),
        incomeRecorded: round2(entries.filter((e) => e.familyMemberId === id && e.entryType === "income").reduce((s, e) => s + e.amount, 0)),
      };
    });
  },
});

export default router;
