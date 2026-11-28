import { useState } from "react";
import { Globe, ExternalLink, Plus, Loader2, Check } from "lucide-react";
import { useCreateLegalReference } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/format";

type OnlineJudgment = { title: string; court: string | null; date: string | null; url: string; summary: string | null };

/** Live web search for judgments (newest first, including this week). Results can be added to the library as unverified. */
export function LegalOnlineResults({ query, onAdded }: { query: string; onAdded: () => void }) {
  const [state, setState] = useState<{ loading: boolean; q?: string; results?: OnlineJudgment[]; error?: string }>({ loading: false });
  const [added, setAdded] = useState<Set<string>>(new Set());
  const cr = useCreateLegalReference();
  const { toast } = useToast();
  const q = query.trim();
  const kanoon = `https://indiankanoon.org/search/?formInput=${encodeURIComponent(`${q} sortby: mostrecent`)}`;

  const run = async () => {
    setState({ loading: true, q });
    try {
      const res = await fetch(`/api/legal-online-search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Search failed");
      setState({ loading: false, q, results: body.results });
    } catch (e) {
      setState({ loading: false, q, error: errMsg(e) });
    }
  };

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
        <Button size="sm" onClick={run} disabled={state.loading} data-testid="button-search-online">{state.loading ? <Loader2 className="animate-spin" /> : <Globe />}Search online</Button>
      </div>}>
      {state.loading ? <p className="text-sm text-muted-foreground">Searching the web for “{state.q}”… this can take up to a minute.</p>
        : state.error ? <p className="text-sm text-destructive">{state.error}</p>
        : !state.results ? <p className="text-sm text-muted-foreground">Click “Search online” to find all judgments for “{q}”, including the latest ones.</p>
        : !state.results.length ? <p className="text-sm text-muted-foreground">No judgments found online for “{state.q}”.</p>
        : <ul className="divide-y" data-testid="online-results">{state.results.map((r) => (
          <li key={r.url} className="py-3 flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.title}</a>
              <div className="text-xs text-muted-foreground">{[r.court, r.date].filter(Boolean).join(" · ")}</div>
              {r.summary && <p className="text-sm mt-1">{r.summary}</p>}
            </div>
            <Button size="sm" variant="ghost" disabled={added.has(r.url) || cr.isPending} onClick={() => add(r)}>
              {added.has(r.url) ? <><Check />Added</> : <><Plus />Add to library</>}
            </Button>
          </li>
        ))}</ul>}
    </Panel>
  );
}
