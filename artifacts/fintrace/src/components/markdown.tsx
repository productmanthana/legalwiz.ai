import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="num text-[12px] bg-muted px-1 rounded">{p.slice(1, -1)}</code>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

const tableCells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function MdTable({ lines }: { lines: string[] }) {
  const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(tableCells);
  const [head, ...body] = rows;
  const isNum = (c: string) => /^(Rs\.?\s*|₹\s*)?-?[\d,]+(\.\d+)?$/.test(c.replace(/\*\*/g, ""));
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/60"><tr>{head?.map((c, i) => <th key={i} className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{inline(c)}</th>)}</tr></thead>
        <tbody>{body.map((r, ri) => <tr key={ri} className="border-t">{r.map((c, ci) => <td key={ci} className={isNum(c) ? "px-2 py-1 text-right num whitespace-nowrap" : "px-2 py-1"}>{inline(c)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(<Tag key={out.length} className={list.ordered ? "list-decimal pl-5 space-y-1" : "list-disc pl-5 space-y-1"}>{list.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</Tag>);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    if (/^\s*\|/.test(line)) {
      flush();
      const block: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) block.push(lines[i++]!);
      i--;
      out.push(<MdTable key={out.length} lines={block} />);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flush();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) out.push(<div key={out.length} className="font-display text-[15px] font-medium mt-2">{inline(h[2])}</div>);
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-2 text-sm leading-relaxed">{out}</div>;
}
