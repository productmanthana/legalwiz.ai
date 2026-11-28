import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Scale, ExternalLink, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import { errMsg } from "@/lib/format";
import { cn } from "@/lib/utils";

export type JudgmentContext = { title: string; court?: string | null; date?: string | null; url?: string | null; summary?: string | null };
type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; url: string }[] };

/** Chat about court judgments with live internet search; follow-up questions keep the conversation. */
export function JudgmentChat({ judgment, prompts, className }: { judgment?: JudgmentContext; prompts: string[]; className?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, busy]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q.trim() }];
    setMsgs(next); setText(""); setBusy(true); setError(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/legal-chat`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgment, messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The AI could not answer");
      setMsgs([...next, { role: "assistant", content: body.answer, sources: body.sources }]);
    } catch (e) {
      setMsgs(msgs); setText(q); setError(errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!msgs.length && !busy && (
          <div className="h-full grid place-items-center text-center">
            <div><Scale className="h-8 w-8 mx-auto text-[hsl(var(--teal))]" />
              <p className="text-sm text-muted-foreground max-w-md mt-2">Ask anything about {judgment ? "this judgment" : "court judgments"}. Answers search the internet, including recent rulings. Ask follow-up questions as needed.</p>
              <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-lg">{prompts.map((p) => <button key={p} onClick={() => send(p)} className="text-xs rounded-full border px-3 py-1.5 hover:border-primary hover:text-primary" data-testid="button-judgment-prompt">{p}</button>)}</div>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")} data-testid={`judgment-msg-${m.role}`}>
            <div className={cn("max-w-[90%] min-w-0 rounded-lg px-3.5 py-2.5", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60 border")}>
              {m.role === "user" ? <div className="text-sm whitespace-pre-wrap">{m.content}</div> : <Markdown content={m.content} />}
              {!!m.sources?.length && <div className="flex flex-col gap-0.5 mt-2 pt-2 border-t">
                <span className="text-[11px] text-muted-foreground">Sources</span>
                {m.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1 truncate"><ExternalLink className="h-3 w-3 shrink-0" />{s.title}</a>)}
              </div>}
            </div>
          </div>
        ))}
        {busy && <div className="flex"><div className="rounded-lg border bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Searching the internet and reading judgments… this can take up to a minute</div></div>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div ref={end} />
      </div>
      <form className="border-t p-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <Textarea rows={2} className="resize-none" value={text} onChange={(e) => setText(e.target.value)} placeholder={judgment ? "Ask about this judgment" : "Ask any question about court judgments"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} data-testid="input-judgment-chat" />
        <Button type="submit" disabled={!text.trim() || busy} className="self-end" data-testid="button-judgment-send"><Send /></Button>
      </form>
    </div>
  );
}

/** "Ask AI" button that opens a chat popup about one judgment. */
export function AskAiButton({ judgment }: { judgment: JudgmentContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="button-ask-ai"><MessageSquare />Ask AI</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl p-0 gap-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="font-display font-medium text-lg pr-6">{judgment.title}</DialogTitle>
            <DialogDescription>{[judgment.court, judgment.date].filter(Boolean).join(" · ") || "Ask AI about this judgment"}</DialogDescription>
          </DialogHeader>
          <JudgmentChat judgment={judgment} className="h-[65vh]" prompts={["Summarise this judgment", "What was the holding and reasoning?", "How is it relevant to a DA case?"]} />
        </DialogContent>
      </Dialog>
    </>
  );
}
