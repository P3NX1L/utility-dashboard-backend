import { useState } from "react";
import { Copy, FileText, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { MessageDraft } from "@/lib/notices/messages";
import { buildNoticePdf } from "@/lib/notices/pdf";
import type { NoticeTemplate } from "@/lib/notices/templates";

interface Item { id: string; handedOff: boolean; values: Record<string, string>; defaults: MessageDraft; warnings: string[] }

export function ReviewList({ template, items, onHandoff }: { template: NoticeTemplate; items: Item[]; onHandoff: (id: string, v: boolean) => void }) {
  const [edits, setEdits] = useState<Record<string, MessageDraft>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const copy = async (key: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500); };
  const openPdf = async (vals: Record<string, string>[]) => {
    setPdfErr(null);
    try { window.open(URL.createObjectURL(await buildNoticePdf(template, vals)), "_blank"); }
    catch (e) { setPdfErr((e as Error).message); }
  };

  if (!items.length) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No tenants selected. Tick tenants in the list above to review their notices.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning p-3 text-sm text-warning-foreground">
        <span><strong>Draft layouts.</strong> Notices and messages use placeholder wording until the office's actual templates are supplied. Nothing is sent from this dashboard.</span>
        <Button size="sm" onClick={() => openPdf(items.map((i) => i.values))}><FileText className="size-4" /> Printable drafts ({items.length})</Button>
      </div>
      {pdfErr && <p className="text-sm text-destructive">{pdfErr}</p>}
      {items.map((it) => {
        const m = edits[it.id] ?? it.defaults;
        const set = (patch: Partial<MessageDraft>) => setEdits({ ...edits, [it.id]: { ...m, ...patch } });
        return (
          <article key={it.id} className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{it.values['names']}</h3>
                <p className="text-sm text-muted-foreground">{it.values['addressLine']}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => openPdf([it.values])}><FileText className="size-4" /> Draft PDF</Button>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {template.blocks.flatMap((b) => (b.type === "field" && b.label !== "(" ? [b] : [])).filter((b, i, a) => a.findIndex((x) => x.field === b.field) === i).map((b) => (
                <div key={b.field} className="flex gap-2"><dt className="text-muted-foreground">{b.label?.replace(/[:(]\s*$/, "")}</dt><dd className="font-medium">{it.values[b.field]}</dd></div>
              ))}
              {it.values['balanceWords'] && <div className="sm:col-span-2 text-muted-foreground">In words: <span className="text-foreground">{it.values['balanceWords'].replace(/\)$/, "")}</span></div>}
            </dl>
            {it.warnings.length > 0 && <ul className="mt-2 text-sm text-destructive">{it.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-sm font-medium">Email draft</span>
                  <Button variant="ghost" size="sm" onClick={() => copy(`${it.id}e`, `Subject: ${m.subject}\n\n${m.email}`)}>{copied === `${it.id}e` ? <Check className="size-4" /> : <Copy className="size-4" />} Copy</Button></div>
                <Input value={m.subject} onChange={(e) => set({ subject: e.target.value })} aria-label="Email subject" />
                <Textarea rows={9} value={m.email} onChange={(e) => set({ email: e.target.value })} aria-label="Email body" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-sm font-medium">SMS draft <span className="text-muted-foreground">({m.sms.length} chars)</span></span>
                  <Button variant="ghost" size="sm" onClick={() => copy(`${it.id}s`, m.sms)}>{copied === `${it.id}s` ? <Check className="size-4" /> : <Copy className="size-4" />} Copy</Button></div>
                <Textarea rows={5} value={m.sms} onChange={(e) => set({ sms: e.target.value })} aria-label="SMS text" />
                {edits[it.id] && <Button variant="link" size="sm" className="px-0" onClick={() => { const n = { ...edits }; delete n[it.id]; setEdits(n); }}>Reset to generated text</Button>}
              </div>
            </div>
            <label className="mt-4 flex items-center gap-2 border-t pt-3 text-sm">
              <Checkbox checked={it.handedOff} onCheckedChange={(v) => onHandoff(it.id, v === true)} />
              Staff entered this notice in AppFolio manually
            </label>
          </article>
        );
      })}
    </div>
  );
}
