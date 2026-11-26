import { useRef, useState } from "react";
import { Plus, Pencil, Trash2, Upload, Landmark, Loader2, CheckCircle2, XCircle, AlertTriangle, FileUp } from "lucide-react";
import {
  useListBankAccounts, useCreateBankAccount, useUpdateBankAccount, useDeleteBankAccount, useImportStatement, useListStatements, useListFamilyMembers,
  getListBankAccountsQueryKey, getListStatementsQueryKey, getListTransactionsQueryKey, getGetCaseSummaryQueryKey, getGetDashboardSummaryQueryKey, getGetFinancialOverviewQueryKey,
  type Case, type BankAccount, type BankAccountInput, type StatementImportResult, type StatementImportInputFileType,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CaseLayout, access, useCaseId } from "@/components/case-layout";
import { Panel, LoadingRows, ErrorState, EmptyState, ConfirmButton, Tag, StatusBadge, useInvalidate, Field, Notice, Money } from "@/components/common";
import { EntityFormDialog, type FieldDef } from "@/components/entity-form";
import { fdate, fdatetime, human, n, errMsg, opts } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function readFile(file: File, asText: boolean): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(r.error);
    r.onload = () => {
      const v = r.result as string;
      res(asText ? v : v.slice(v.indexOf(",") + 1));
    };
    asText ? r.readAsText(file) : r.readAsDataURL(file);
  });
}

function ImportDialog({ account, open, onOpenChange }: { account: BankAccount | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const caseId = useCaseId();
  const imp = useImportStatement();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [ob, setOb] = useState(""); const [cb, setCb] = useState("");
  const [result, setResult] = useState<StatementImportResult | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const reset = () => { setFile(null); setOb(""); setCb(""); setResult(null); };

  const run = async () => {
    if (!file || !account) return;
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    const fileType: StatementImportInputFileType = ext === "csv" ? "csv" : ext === "pdf" ? "pdf" : "xlsx";
    const content = await readFile(file, fileType === "csv");
    imp.mutate({ accountId: account.id, data: { fileName: file.name, fileType, content, declaredOpeningBalance: ob ? Number(ob) : null, declaredClosingBalance: cb ? Number(cb) : null } }, {
      onSuccess: (r) => { setResult(r); inv(getListBankAccountsQueryKey(caseId), getListStatementsQueryKey(caseId), getListTransactionsQueryKey(caseId), getGetCaseSummaryQueryKey(caseId), getGetDashboardSummaryQueryKey(), getGetFinancialOverviewQueryKey()); },
      onError: (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display font-medium text-xl">Import statement</DialogTitle>
          <DialogDescription>{account?.bankName} · <span className="num">{account?.maskedAccountNumber}</span></DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="space-y-4">
            <button type="button" onClick={() => ref.current?.click()} data-testid="button-pick-file"
              className={cn("w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors", file ? "border-[hsl(var(--teal))] bg-accent/40" : "hover:bg-muted/60")}>
              <FileUp className="h-6 w-6 mx-auto text-[hsl(var(--teal))]" />
              <div className="text-sm mt-2 font-medium">{file ? file.name : "Choose a CSV, Excel or PDF statement"}</div>
              <div className="text-xs text-muted-foreground mt-1">{file ? `${n(file.size)} bytes` : ".csv, .xlsx, .xls, .pdf"}</div>
            </button>
            <input ref={ref} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-file" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Declared opening balance" hint="Optional, from the statement header"><Input className="num text-right" type="number" step="any" value={ob} onChange={(e) => setOb(e.target.value)} data-testid="input-opening" /></Field>
              <Field label="Declared closing balance" hint="Used for the balance check"><Input className="num text-right" type="number" step="any" value={cb} onChange={(e) => setCb(e.target.value)} data-testid="input-closing" /></Field>
            </div>
            <Notice>Expected CSV columns: <span className="num">Date, Value Date, Description/Narration, Ref No, Debit/Withdrawal, Credit/Deposit, Balance</span>. Scanned PDFs need OCR, which is not configured — they will be reported as unsupported.</Notice>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={run} disabled={!file || imp.isPending} data-testid="button-run-import">{imp.isPending ? <Loader2 className="animate-spin" /> : <Upload />}Import</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rise" data-testid="import-result">
            <div className="flex items-center gap-2">
              {result.status === "imported" ? <CheckCircle2 className="h-5 w-5 text-[hsl(var(--success))]" /> : result.status === "imported_with_warnings" ? <AlertTriangle className="h-5 w-5 text-[hsl(var(--brass))]" /> : <XCircle className="h-5 w-5 text-destructive" />}
              <span className="font-display text-lg">{result.status === "unsupported" ? "Format not supported" : human(result.status)}</span>
              <StatusBadge status={result.status} />
            </div>
            {result.status === "unsupported" && <Notice tone="danger">This file could not be read as structured data. OCR for PDF statements is not configured on this server. Export the statement as CSV or Excel from net banking and import again.</Notice>}
            <div className="grid grid-cols-3 gap-2">
              {[["Rows read", result.rowsRead], ["Imported", result.imported], ["Duplicates skipped", result.duplicatesSkipped]].map(([k, v]) => (
                <div key={k as string} className="rounded border p-3"><div className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-semibold">{k}</div><div className="num text-xl">{n(v as number)}</div></div>
              ))}
            </div>
            <div className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between"><span className="font-medium">Balance check</span><StatusBadge status={result.balanceCheck.status} /></div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                <div>Computed closing<div className="num"><Money v={result.balanceCheck.computedClosing} /></div></div>
                <div>Declared closing<div className="num"><Money v={result.balanceCheck.declaredClosing} /></div></div>
                <div>Running-balance breaks<div className={cn("num", result.balanceCheck.breaks ? "text-destructive" : "")}>{n(result.balanceCheck.breaks ?? 0)}</div></div>
              </div>
            </div>
            {!!result.detectedColumns?.length && <div className="text-xs"><span className="text-muted-foreground">Detected columns: </span>{result.detectedColumns.map((c) => <Tag key={c} className="mr-1">{c}</Tag>)}</div>}
            {!!result.warnings.length && <div><div className="text-xs font-semibold mb-1 text-[hsl(var(--brass))]">Warnings</div><ul className="text-xs list-disc pl-5 space-y-0.5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
            {!!result.errors.length && <div><div className="text-xs font-semibold mb-1 text-destructive">Errors</div><ul className="text-xs list-disc pl-5 space-y-0.5">{result.errors.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={reset}>Import another</Button><Button onClick={() => onOpenChange(false)}>Done</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = useCaseId();
  const a = access(c);
  const inv = useInvalidate();
  const { toast } = useToast();
  const accts = useListBankAccounts(caseId);
  const stmts = useListStatements(caseId);
  const fam = useListFamilyMembers(caseId);
  const create = useCreateBankAccount(); const upd = useUpdateBankAccount(); const del = useDeleteBankAccount();
  const [form, setForm] = useState<{ open: boolean; edit?: BankAccount }>({ open: false });
  const [importFor, setImportFor] = useState<BankAccount | null>(null);
  const refresh = () => inv(getListBankAccountsQueryKey(caseId), getGetCaseSummaryQueryKey(caseId), getGetDashboardSummaryQueryKey());

  const fields: FieldDef[] = [
    { name: "bankName", label: "Bank", required: true },
    { name: "accountHolder", label: "Account holder", required: true },
    { name: "maskedAccountNumber", label: "Account number (masked)", required: true, placeholder: "XXXX XXXX 4821", hint: "Store only the last 4 digits." },
    { name: "accountType", label: "Type", type: "select", options: opts(["savings", "current", "fixed_deposit", "loan", "credit_card", "other"]) },
    { name: "ownership", label: "Ownership", type: "select", options: opts(["self", "spouse", "joint", "family_member", "other"]) },
    { name: "familyMemberId", label: "Family member", type: "select", nullableSelect: true, options: (fam.data ?? []).map((f) => ({ value: String(f.id), label: f.name })) },
    { name: "ifsc", label: "IFSC" }, { name: "branch", label: "Branch" },
    { name: "jointHolders", label: "Joint holders", full: true },
    { name: "openingDate", label: "Opened", type: "date" }, { name: "closingDate", label: "Closed", type: "date" },
  ];

  return (
    <div className="space-y-5">
      <Panel title="Bank accounts" description="Account numbers are stored masked." bodyClass="p-0"
        actions={a.canEdit && <Button size="sm" onClick={() => setForm({ open: true })} data-testid="button-add-account"><Plus />Add account</Button>}>
        {accts.isLoading ? <div className="p-4"><LoadingRows /></div> : accts.isError ? <div className="p-4"><ErrorState error={accts.error} onRetry={() => accts.refetch()} /></div> : !accts.data?.length ? (
          <EmptyState icon={<Landmark className="h-6 w-6" />} title="No accounts yet" body="Add each bank, FD, loan or card account held by the subject or family." action={a.canEdit && <Button onClick={() => setForm({ open: true })}><Plus />Add account</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm dense-table">
              <thead className="bg-muted/50"><tr><th className="text-left">Bank / holder</th><th className="text-left">Account</th><th className="text-left">Type</th><th className="text-left">Ownership</th><th className="text-right">Txns</th><th className="text-left">Coverage</th><th className="text-right">Credits</th><th className="text-right">Debits</th><th /></tr></thead>
              <tbody className="stagger">
                {accts.data.map((x) => (
                  <tr key={x.id} data-testid={`row-account-${x.id}`}>
                    <td><div className="font-medium">{x.bankName}</div><div className="text-[11px] text-muted-foreground">{x.accountHolder}{x.branch ? ` · ${x.branch}` : ""}</div></td>
                    <td className="num text-xs">{x.maskedAccountNumber}</td>
                    <td className="text-xs">{human(x.accountType)}</td>
                    <td><Tag tone={x.ownership === "self" ? "navy" : "muted"}>{human(x.ownership)}</Tag></td>
                    <td className="text-right num">{n(x.transactionCount)}</td>
                    <td className="text-xs num">{x.firstTransactionDate ? `${fdate(x.firstTransactionDate)} – ${fdate(x.lastTransactionDate)}` : "—"}</td>
                    <td className="text-right"><Money v={x.totalCredits} dim /></td>
                    <td className="text-right"><Money v={x.totalDebits} dim /></td>
                    <td className="text-right">
                      {a.canEdit && <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setImportFor(x)} data-testid={`button-import-${x.id}`}><Upload />Import</Button>
                        <Button size="icon" variant="ghost" onClick={() => setForm({ open: true, edit: x })} data-testid={`button-edit-account-${x.id}`}><Pencil /></Button>
                        <ConfirmButton title="Delete account?" description="Its imported transactions will also be removed." onConfirm={() => del.mutate({ accountId: x.id }, { onSuccess: () => { refresh(); inv(getListTransactionsQueryKey(caseId)); }, onError: (e) => toast({ title: "Delete failed", description: errMsg(e), variant: "destructive" }) })}
                          trigger={<Button size="icon" variant="ghost" data-testid={`button-delete-account-${x.id}`}><Trash2 /></Button>} />
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Imported statements" description="Every import is fingerprinted; re-importing the same rows skips duplicates." bodyClass="p-0">
        {stmts.isLoading ? <div className="p-4"><LoadingRows rows={3} /></div> : stmts.isError ? <div className="p-4"><ErrorState error={stmts.error} /></div> : !stmts.data?.length ? <EmptyState title="No statements imported" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm dense-table">
              <thead className="bg-muted/50"><tr><th className="text-left">File</th><th className="text-left">Account</th><th className="text-left">Period</th><th className="text-right">Rows</th><th className="text-right">Dupes</th><th className="text-left">Balance</th><th className="text-left">Status</th><th className="text-left">Hash</th><th className="text-right">Imported</th></tr></thead>
              <tbody>
                {stmts.data.map((s) => (
                  <tr key={s.id} data-testid={`row-statement-${s.id}`}>
                    <td className="max-w-[220px] truncate">{s.fileName} <Tag>{s.fileType.toUpperCase()}</Tag>{!!s.warnings?.length && <Tag tone="brass" className="ml-1">{s.warnings.length} warnings</Tag>}</td>
                    <td className="text-xs">{s.bankName} <span className="num">{s.maskedAccountNumber}</span></td>
                    <td className="text-xs num">{s.periodStart ? `${fdate(s.periodStart)} – ${fdate(s.periodEnd)}` : "—"}</td>
                    <td className="text-right num">{n(s.rowsImported)}</td>
                    <td className="text-right num">{n(s.duplicatesSkipped)}</td>
                    <td><StatusBadge status={s.balanceCheckStatus ?? "not_available"} /></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="num text-[11px] text-muted-foreground" title={s.fileHash}>{s.fileHash.slice(0, 10)}…</td>
                    <td className="text-right num text-xs">{fdatetime(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <EntityFormDialog open={form.open} onOpenChange={(o) => setForm({ open: o, edit: form.edit })} title={form.edit ? "Edit account" : "Add bank account"} fields={fields}
        initial={form.edit ? (form.edit as unknown as Record<string, unknown>) : { accountType: "savings", ownership: "self" }} pending={create.isPending || upd.isPending}
        onSubmit={(v) => {
          const data = v as unknown as BankAccountInput;
          const cb = { onSuccess: () => { setForm({ open: false }); refresh(); }, onError: (e: unknown) => toast({ title: "Save failed", description: errMsg(e), variant: "destructive" }) };
          form.edit ? upd.mutate({ accountId: form.edit.id, data }, cb) : create.mutate({ caseId, data }, cb);
        }} />
      <ImportDialog account={importFor} open={!!importFor} onOpenChange={(o) => !o && setImportFor(null)} />
    </div>
  );
}

export default function Accounts() {
  return <CaseLayout>{(c) => <Body c={c} />}</CaseLayout>;
}
