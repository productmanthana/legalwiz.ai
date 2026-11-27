import { useEffect, useRef, useState } from "react";
import { Link, Redirect, useLocation, useParams } from "wouter";
import { Send, Loader2, Bot, CloudOff, Download } from "lucide-react";
import { useListAssistantMessages, useAskAssistant, useListCases, useGetCase, getGetCaseQueryKey, getListAssistantMessagesQueryKey, type Case, type AssistantMessageCitationsItem } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingRows, ErrorState, EmptyState, Tag, AiBadge, useInvalidate, Notice, PageHeader, nativeSelect } from "@/components/common";
import { Markdown } from "@/components/markdown";
import { fdatetime, human, errMsg } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PROMPTS = ["Which credits above ₹2 lakh are still unclassified?", "Summarise cash deposits by financial year.", "What explains the largest asset acquired in the check period?", "Which family members have no documented income?"];

function citeHref(caseId: number, c: AssistantMessageCitationsItem) {
  const b = `/cases/${caseId}`;
  return { transaction: `${b}/transactions`, document: `${b}/documents`, asset: `${b}/assets`, legal_reference: `${b}/legal`, ledger_entry: `${b}/income-expenditure` }[c.kind] ?? b;
}

const EXPORTS = [{ f: "xlsx", label: "Excel" }, { f: "docx", label: "Word" }, { f: "pdf", label: "PDF" }];

function ExportLinks({ caseId, messageId }: { caseId: number; messageId: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t">
      <span className="text-[11px] text-muted-foreground mr-1 inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</span>
      {EXPORTS.map(({ f, label }) => (
        <a key={f} href={`${import.meta.env.BASE_URL}api/cases/${caseId}/assistant/messages/${messageId}/export?format=${f}`} target="_blank" rel="noreferrer"
          className="rounded-md border bg-card px-2 py-0.5 text-[11px] font-medium hover:border-primary hover:text-primary" data-testid={`link-export-answer-${f}`}>{label}</a>
      ))}
    </div>
  );
}

function Body({ c }: { c: Case }) {
  const caseId = c.id;
  const q = useListAssistantMessages(caseId);
  const ask = useAskAssistant();
  const inv = useInvalidate(); const { toast } = useToast();
  const [msg, setMsg] = useState(""); const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [q.data?.length, pending]);
  const send = (text: string) => {
    if (!text.trim()) return;
    setPending(text); setMsg("");
    ask.mutate({ caseId, data: { message: text } }, {
      onSuccess: () => inv(getListAssistantMessagesQueryKey(caseId)).then(() => setPending(null)),
      onError: (e) => { setPending(null); setMsg(text); toast({ title: "Assistant failed", description: errMsg(e), variant: "destructive" }); },
    });
  };

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-5">
      <div className="min-w-0 rounded-lg border bg-card shadow-xs flex flex-col h-[calc(100dvh-220px)] min-h-[460px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length && !pending ? (
            <div className="h-full grid place-items-center text-center">
              <div><Bot className="h-8 w-8 mx-auto text-[hsl(var(--teal))]" /><div className="font-display text-xl mt-2">Ask about {c.subjectName ?? "this case"}</div><p className="text-sm text-muted-foreground max-w-md mt-1">Answers draw only on this case's records and cite them. Treat every answer as an AI suggestion to verify.</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-lg">{PROMPTS.map((p) => <button key={p} onClick={() => send(p)} className="text-xs rounded-full border px-3 py-1.5 hover:border-primary hover:text-primary" data-testid="button-prompt">{p}</button>)}</div></div>
            </div>
          ) : (
            <>
              {q.data?.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")} data-testid={`message-${m.id}`}>
                  <div className={cn("max-w-[85%] min-w-0 rounded-lg px-3.5 py-2.5", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60 border")}>
                    {m.role !== "user" && <div className="flex items-center gap-2 mb-1.5">{m.available === false ? <Tag><CloudOff className="h-3 w-3" />AI unavailable</Tag> : <AiBadge />}</div>}
                    {m.role === "user" ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : <Markdown content={m.content} />}
                    {!!m.citations?.length && <div className="flex flex-wrap gap-1 mt-2">{m.citations.map((ct, i) => <Link key={i} href={citeHref(caseId, ct)} className="inline-flex"><Tag tone="teal">{human(ct.kind)} #{ct.id} · {ct.label}</Tag></Link>)}</div>}
                    <div className={cn("text-[10px] mt-1.5", m.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground")}>{fdatetime(m.createdAt)}</div>
                    {m.role !== "user" && m.available !== false && <ExportLinks caseId={caseId} messageId={m.id} />}
                  </div>
                </div>
              ))}
              {pending && <>
                <div className="flex justify-end"><div className="max-w-[85%] rounded-lg px-3.5 py-2.5 bg-primary text-primary-foreground text-sm opacity-80">{pending}</div></div>
                <div className="flex"><div className="rounded-lg border bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the case record</div></div>
              </>}
            </>
          )}
          <div ref={end} />
        </div>
        <form className="border-t p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(msg); }}>
          <Textarea rows={2} className="resize-none" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Ask about transactions, assets, documents or legal references"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(msg); } }} data-testid="input-assistant" />
          <Button type="submit" disabled={!msg.trim() || ask.isPending} className="self-end" data-testid="button-send"><Send /></Button>
        </form>
      </div>
      <div className="space-y-3">
        <Notice tone="teal">The assistant only sees this case. It does not give legal advice and cannot decide whether income or assets are lawful.</Notice>
        <Notice>Citations link to the records an answer relied on. Open them and check before relying on the answer.</Notice>
      </div>
    </div>
  );
}

/** Old case-tab URL — the assistant now has its own page. */
export function CaseAssistantRedirect() {
  const { caseId } = useParams<{ caseId: string }>();
  return <Redirect to={`/assistant/${caseId}`} replace />;
}

function CaseChat({ caseId }: { caseId: number }) {
  const q = useGetCase(caseId, { query: { queryKey: getGetCaseQueryKey(caseId) } });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Body key={caseId} c={q.data} />;
}

export default function Assistant() {
  const params = useParams<{ caseId?: string }>();
  const [, nav] = useLocation();
  const cases = useListCases();
  const caseId = Number(params.caseId) || cases.data?.[0]?.id;

  return (
    <div>
      <PageHeader eyebrow="AI" title="AI Assistant" description="Ask questions in plain language about a case's documents, transactions and records."
        actions={!!cases.data?.length && (
          <select className={cn(nativeSelect, "min-w-64")} value={caseId ?? ""} onChange={(e) => nav(`/assistant/${e.target.value}`)} data-testid="select-assistant-case">
            {cases.data.map((x) => <option key={x.id} value={x.id}>{x.title}{x.subjectName ? ` — ${x.subjectName}` : ""}</option>)}
          </select>
        )} />
      {cases.isLoading ? <LoadingRows /> : cases.isError ? <ErrorState error={cases.error} onRetry={() => cases.refetch()} />
        : !caseId ? <EmptyState icon={<Bot className="h-6 w-6" />} title="No cases yet" body={<>Create a case and upload documents, then ask questions here. <Link href="/cases" className="underline">Go to cases</Link></>} />
        : <CaseChat caseId={caseId} />}
    </div>
  );
}
