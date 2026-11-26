import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, bankAccountsTable, bankStatementsTable, transactionsTable } from "@workspace/db";
import { CreateBankAccountBody, UpdateBankAccountBody, ImportStatementBody } from "@workspace/api-zod";
import { intParam, loadCase } from "../lib/access";
import { audit, diff } from "../lib/audit";
import { balanceCheck, gridFromContent, parseStatement } from "../lib/statementImport";
import { round2 } from "../lib/finance";

const router: IRouter = Router();

async function accountStats(caseId: number) {
  const txns = await db
    .select({ a: transactionsTable.bankAccountId, d: transactionsTable.txnDate, cr: transactionsTable.credit, dr: transactionsTable.debit })
    .from(transactionsTable)
    .where(eq(transactionsTable.caseId, caseId));
  const m = new Map<number, { n: number; first: string | null; last: string | null; cr: number; dr: number }>();
  for (const t of txns) {
    const g = m.get(t.a) ?? { n: 0, first: null, last: null, cr: 0, dr: 0 };
    g.n++;
    if (!g.first || t.d < g.first) g.first = t.d;
    if (!g.last || t.d > g.last) g.last = t.d;
    g.cr += t.cr;
    g.dr += t.dr;
    m.set(t.a, g);
  }
  return m;
}

function serializeAccount(a: typeof bankAccountsTable.$inferSelect, s?: { n: number; first: string | null; last: string | null; cr: number; dr: number }) {
  return {
    ...a,
    transactionCount: s?.n ?? 0,
    firstTransactionDate: s?.first ?? null,
    lastTransactionDate: s?.last ?? null,
    totalCredits: round2(s?.cr ?? 0),
    totalDebits: round2(s?.dr ?? 0),
  };
}

function maskNumber(n: string): string {
  const digits = n.replace(/\s/g, "");
  if (/^[Xx*•]+/.test(digits) || digits.length <= 4) return digits;
  return "XXXX" + digits.slice(-4);
}

router.get("/cases/:caseId/bank-accounts", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.caseId, ctx.c.id)).orderBy(bankAccountsTable.id);
  const stats = await accountStats(ctx.c.id);
  res.json(rows.map((a) => serializeAccount(a, stats.get(a.id))));
});

router.post("/cases/:caseId/bank-accounts", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"), "edit");
  if (!ctx) return;
  const parsed = CreateBankAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const values = { ...parsed.data, maskedAccountNumber: maskNumber(parsed.data.maskedAccountNumber), currency: parsed.data.currency ?? "INR", caseId: ctx.c.id };
  const [a] = await db.insert(bankAccountsTable).values(values).returning();
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "bank_account.created", entityType: "bank_account", entityId: a!.id, summary: `Added ${a!.bankName} ${a!.maskedAccountNumber}`, next: values });
  res.status(201).json(serializeAccount(a!));
});

router.patch("/bank-accounts/:accountId", async (req, res): Promise<void> => {
  const [a] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, intParam(req, "accountId")));
  if (!a) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const ctx = await loadCase(req, res, a.caseId, "edit");
  if (!ctx) return;
  const parsed = UpdateBankAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const patch = { ...parsed.data, maskedAccountNumber: maskNumber(parsed.data.maskedAccountNumber) };
  const [u] = await db.update(bankAccountsTable).set(patch).where(eq(bankAccountsTable.id, a.id)).returning();
  const d = diff(a as unknown as Record<string, unknown>, patch);
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "bank_account.updated", entityType: "bank_account", entityId: a.id, summary: `Updated ${u!.bankName} ${u!.maskedAccountNumber}`, previous: d.previous, next: d.next });
  const stats = await accountStats(ctx.c.id);
  res.json(serializeAccount(u!, stats.get(u!.id)));
});

router.delete("/bank-accounts/:accountId", async (req, res): Promise<void> => {
  const [a] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, intParam(req, "accountId")));
  if (!a) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const ctx = await loadCase(req, res, a.caseId, "edit");
  if (!ctx) return;
  await db.delete(bankAccountsTable).where(eq(bankAccountsTable.id, a.id));
  await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "bank_account.deleted", entityType: "bank_account", entityId: a.id, summary: `Deleted ${a.bankName} ${a.maskedAccountNumber} and its transactions`, previous: a });
  res.sendStatus(204);
});

router.post("/bank-accounts/:accountId/statements", async (req, res): Promise<void> => {
  const [acct] = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.id, intParam(req, "accountId")));
  if (!acct) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const ctx = await loadCase(req, res, acct.caseId, "edit");
  if (!ctx) return;
  const parsed = ImportStatementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const fileHash = createHash("sha256").update(input.content).digest("hex");
  const baseStmt = { caseId: ctx.c.id, bankAccountId: acct.id, fileName: input.fileName, fileType: input.fileType, fileHash, documentId: input.documentId ?? null };

  if (input.fileType === "pdf") {
    const msg = "PDF statements need OCR, which is not configured. Download the statement as CSV or Excel from net banking and import that file instead.";
    const [s] = await db.insert(bankStatementsTable).values({ ...baseStmt, status: "unsupported", warnings: [msg] }).returning();
    await audit(req, { caseId: ctx.c.id, caseTitle: ctx.c.title, action: "statement.import_unsupported", entityType: "statement", entityId: s!.id, summary: `PDF statement "${input.fileName}" could not be read (OCR unavailable)` });
    res.status(201).json({ statementId: s!.id, status: "unsupported", rowsRead: 0, imported: 0, duplicatesSkipped: 0, detectedColumns: [], errors: [msg], warnings: [], balanceCheck: { status: "not_available", computedClosing: null, declaredClosing: input.declaredClosingBalance ?? null, breaks: 0 } });
    return;
  }

  let grid: unknown[][];
  try {
    grid = gridFromContent(input.fileType, input.content);
  } catch (err) {
    req.log.warn({ err }, "Statement file could not be parsed");
    res.status(400).json({ error: "The file could not be read as a CSV or Excel workbook." });
    return;
  }
  const parsedRows = parseStatement(grid);
  const warnings = [...parsedRows.warnings];
  const [sameFile] = await db.select().from(bankStatementsTable).where(and(eq(bankStatementsTable.bankAccountId, acct.id), eq(bankStatementsTable.fileHash, fileHash)));
  if (sameFile) warnings.unshift(`This exact file was already imported on ${sameFile.createdAt.toISOString().slice(0, 10)}; duplicate rows are skipped.`);

  const bc = balanceCheck(parsedRows.rows, input.declaredOpeningBalance, input.declaredClosingBalance);
  warnings.push(...bc.notes);

  // Duplicate detection against existing transactions on this account.
  const keys = parsedRows.rows.map((r) => r.dedupeKey);
  const existing = keys.length
    ? await db.select({ k: transactionsTable.dedupeKey }).from(transactionsTable).where(and(eq(transactionsTable.bankAccountId, acct.id), inArray(transactionsTable.dedupeKey, keys)))
    : [];
  const seen = new Set(existing.map((e) => e.k));
  const toInsert = [];
  let dups = 0;
  for (const r of parsedRows.rows) {
    if (seen.has(r.dedupeKey)) {
      dups++;
      continue;
    }
    seen.add(r.dedupeKey);
    toInsert.push(r);
  }
  const failed = parsedRows.rows.length === 0;
  const status = failed ? "failed" : parsedRows.errors.length || warnings.length || bc.status === "failed" ? "imported_with_warnings" : "imported";
  const dates = parsedRows.rows.map((r) => r.txnDate).sort();
  const [stmt] = await db
    .insert(bankStatementsTable)
    .values({
      ...baseStmt,
      status,
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
      rowsImported: toInsert.length,
      duplicatesSkipped: dups,
      balanceCheckStatus: bc.status,
      warnings: warnings.slice(0, 100),
    })
    .returning();
  for (let i = 0; i < toInsert.length; i += 500) {
    await db.insert(transactionsTable).values(
      toInsert.slice(i, i + 500).map((r) => ({
        caseId: ctx.c.id,
        bankAccountId: acct.id,
        statementId: stmt!.id,
        sourceRow: r.sourceRow,
        txnDate: r.txnDate,
        valueDate: r.valueDate,
        description: r.description,
        referenceNumber: r.referenceNumber,
        debit: r.debit,
        credit: r.credit,
        balance: r.balance,
        origDescription: r.description,
        origDebit: r.debit,
        origCredit: r.credit,
        origTxnDate: r.txnDate,
        origBalance: r.balance,
        financialYear: r.financialYear,
        dedupeKey: r.dedupeKey,
      })),
    );
  }
  await audit(req, {
    caseId: ctx.c.id,
    caseTitle: ctx.c.title,
    action: "statement.imported",
    entityType: "statement",
    entityId: stmt!.id,
    summary: `Imported "${input.fileName}" into ${acct.bankName} ${acct.maskedAccountNumber}: ${toInsert.length} rows, ${dups} duplicates skipped, balance check ${bc.status}`,
    next: { fileHash, rowsRead: parsedRows.rowsRead },
  });
  res.status(201).json({
    statementId: stmt!.id,
    status,
    rowsRead: parsedRows.rowsRead,
    imported: toInsert.length,
    duplicatesSkipped: dups,
    detectedColumns: parsedRows.detectedColumns,
    errors: parsedRows.errors.slice(0, 100),
    warnings: warnings.slice(0, 100),
    balanceCheck: { status: bc.status, computedClosing: bc.computedClosing, declaredClosing: bc.declaredClosing, breaks: bc.breaks },
  });
});

router.get("/cases/:caseId/statements", async (req, res): Promise<void> => {
  const ctx = await loadCase(req, res, intParam(req, "caseId"));
  if (!ctx) return;
  const rows = await db
    .select({ s: bankStatementsTable, bankName: bankAccountsTable.bankName, masked: bankAccountsTable.maskedAccountNumber })
    .from(bankStatementsTable)
    .innerJoin(bankAccountsTable, eq(bankAccountsTable.id, bankStatementsTable.bankAccountId))
    .where(eq(bankStatementsTable.caseId, ctx.c.id))
    .orderBy(desc(bankStatementsTable.createdAt));
  res.json(rows.map((r) => ({ ...r.s, bankName: r.bankName, maskedAccountNumber: r.masked })));
});

export default router;
