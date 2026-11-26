import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useCreateQuery, useListTransactions, getListQueriesQueryKey, getGetQueryQueryKey, getGetUpcomingDeadlinesQueryKey, type InvestigationQueryInputTopic } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, nativeSelect, useInvalidate } from "@/components/common";
import { QUERY_TOPICS, fdate, human, inr, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";

export function QueryFormDialog({ caseId, open, onOpenChange, parentQueryId, onCreated }: { caseId: number; open: boolean; onOpenChange: (o: boolean) => void; parentQueryId?: number; onCreated?: (id: number) => void }) {
  const create = useCreateQuery();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [f, setF] = useState({ subject: "", description: "", topic: "bank_credits", financialYear: "", applicableSchedule: "", responseDeadline: "", questionNumber: "" });
  const [txSearch, setTxSearch] = useState("");
  const [txIds, setTxIds] = useState<number[]>([]);
  const txns = useListTransactions(caseId, { search: txSearch || undefined });
  useEffect(() => { if (open) { setF({ subject: "", description: "", topic: "bank_credits", financialYear: "", applicableSchedule: "", responseDeadline: "", questionNumber: "" }); setTxIds([]); } }, [open]);

  const submit = () => create.mutate({ caseId, data: {
    subject: f.subject, description: f.description, topic: f.topic as InvestigationQueryInputTopic, financialYear: f.financialYear || null, applicableSchedule: f.applicableSchedule || null,
    responseDeadline: f.responseDeadline || null, questionNumber: f.questionNumber || undefined, parentQueryId: parentQueryId ?? null, relatedTransactionIds: txIds,
  } }, {
    onSuccess: (q) => { inv(getListQueriesQueryKey(caseId), getGetUpcomingDeadlinesQueryKey(), ...(parentQueryId ? [getGetQueryQueryKey(parentQueryId)] : [])); onOpenChange(false); onCreated?.(q.id); },
    onError: (e) => toast({ title: "Could not create query", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display font-medium text-xl">{parentQueryId ? "Raise follow-up question" : "New investigation query"}</DialogTitle>
          <DialogDescription>Queries are numbered automatically unless you give a number. Linked transactions are shown to the responding party.</DialogDescription></DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Subject *" className="sm:col-span-2"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} data-testid="input-query-subject" /></Field>
          <Field label="Question *" className="sm:col-span-2"><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} data-testid="input-query-description" /></Field>
          <Field label="Topic"><select className={nativeSelect} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} data-testid="select-query-topic">{QUERY_TOPICS.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></Field>
          <Field label="Question number"><Input value={f.questionNumber} placeholder="Auto" onChange={(e) => setF({ ...f, questionNumber: e.target.value })} /></Field>
          <Field label="Financial year"><Input value={f.financialYear} placeholder="2019-20" onChange={(e) => setF({ ...f, financialYear: e.target.value })} /></Field>
          <Field label="Applicable schedule"><Input value={f.applicableSchedule} placeholder="Schedule C — Income" onChange={(e) => setF({ ...f, applicableSchedule: e.target.value })} /></Field>
          <Field label="Response deadline"><Input type="date" value={f.responseDeadline} onChange={(e) => setF({ ...f, responseDeadline: e.target.value })} data-testid="input-query-deadline" /></Field>
          <Field label={`Related transactions (${txIds.length})`} className="sm:col-span-2">
            <Input className="h-8 text-xs mb-1" placeholder="Search transactions" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} />
            <div className="max-h-44 overflow-y-auto rounded border divide-y">
              {(txns.data ?? []).slice(0, 100).map((t) => (
                <label key={t.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <input type="checkbox" className="accent-[hsl(var(--teal))]" checked={txIds.includes(t.id)} onChange={(e) => setTxIds(e.target.checked ? [...txIds, t.id] : txIds.filter((x) => x !== t.id))} />
                  <span className="num text-muted-foreground w-20">{fdate(t.txnDate)}</span><span className="truncate flex-1">{t.description}</span><span className="num">{t.credit ? inr(t.credit) : `−${inr(t.debit)}`}</span>
                </label>
              ))}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!f.subject.trim() || !f.description.trim() || create.isPending} onClick={submit} data-testid="button-create-query">{create.isPending && <Loader2 className="animate-spin" />}Raise query</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
