import { useEffect, useRef, useState } from "react";
import { Globe, ExternalLink, Plus, Loader2, Check } from "lucide-react";
import { useCreateLegalReference } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/format";
import { AskAiButton } from "@/components/judgment-chat";

type OnlineJudgment = { title: string; court: string | null; date: string | null; url: string; summary: string | null };

/** Live web search for judgments (newest first, including this week). Results can be added to the library as unverified. */
export function LegalOnlineResults({ query, onAdded }: { query: string; onAdded: () => void }) {
  const [state, setState] = useState<{ loading: boolean; q?: string; results?: OnlineJudgment[]; error?: string }>({ loading: false });
  const [added, setAdded] = useState<Set<string>>(new Set());
  const cr = useCreateLegalReference();
  const { toast } = useToast();
  const q = query.trim();
  const kanoon = `https://indiankanoon.org/search/?formInput=${encodeURIComponent(`${q} sortby: mostrecent`)}`;

  const latest = useRef("");
  const run = async (term: string) => {
    latest.current = term;
    setState({ loading: true, q: term });
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/legal-online-search?q=${encodeURIComponent(term)}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      if (latest.current === term) setState({ loading: false, q: term, results: body.results });
    } catch (e) {
      if (latest.current === term) setState({ loading: false, q: term, error: errMsg(e) });
    }
  };

  // Search runs by itself once the user stops typing.
  useEffect(() => {
    if (q.length < 3) { latest.current = ""; setState({ loading: false }); return; }
    const t = setTimeout(() => run(q), 1000);
    return () => clearTimeout(t);
  }, [q]);

  const add = (r: OnlineJudgment) =>
    cr.mutate(
      { data: { sourceType: "judgment", title: r.title, court: r.court, decisionDate: r.date, sourceUrl: r.url, summary: r.summary, categories: [], bindingStatus: "not_assessed" } },
      { onSuccess: () => { setAdded((s) => new Set(s).add(r.url)); onAdded(); }, onError: (e) => toast({ title: "Failed", description: errMsg(e), variant: "destructive" }) },
    );

  if (q.length < 3) return null;
  return (
    <Panel className="mt-6" title="Latest judgments online" description="Live web search, newest first, including recent days. Research leads only: verify before citing."
      actions={<div className="flex gap-2">
        <Button variant="outline" size="sm" asChild><a href={kanoon} target="_blank" rel="noreferrer"><ExternalLink />Indian Kanoon (newest)</a></Button>
        <Button size="sm" onClick={() => run(q)} disabled={state.loading} data-testid="button-search-online">{state.loading ? <Loader2 className="animate-spin" /> : <Globe />}Refresh</Button>
      </div>}>
      {state.loading ? <p className="text-sm text-muted-foreground">Searching the web for “{state.q}”… this can take up to a minute.</p>
        : state.error ? <p className="text-sm text-destructive">{state.error}</p>
        : !state.results ? <p className="text-sm text-muted-foreground">Searching for “{q}” shortly…</p>
        : !state.results.length ? <p className="text-sm text-muted-foreground">No judgments found online for “{state.q}”.</p>
        : <ul className="divide-y" data-testid="online-results">{state.results.map((r) => (
          <li key={r.url} className="py-3 flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.title}</a>
              <div className="text-xs text-muted-foreground">{[r.court, r.date].filter(Boolean).join(" · ")}</div>
              {r.summary && <p className="text-sm mt-1">{r.summary}</p>}
            </div>
            <div className="flex flex-col items-end">
            <AskAiButton judgment={r} />
            <Button size="sm" variant="ghost" disabled={added.has(r.url) || cr.isPending} onClick={() => add(r)}>
              {added.has(r.url) ? <><Check />Added</> : <><Plus />Add to library</>}
            </Button>
            </div>
          </li>
        ))}</ul>}
    </Panel>
  );
}
