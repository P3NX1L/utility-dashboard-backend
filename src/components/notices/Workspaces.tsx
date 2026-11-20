import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ImportPanel } from "./ImportPanel";
import { ReviewList } from "./ReviewList";
import { FIVE_DAY_FIELDS, ACCESS_FIELDS, type FiveDayTenant, type AccessTenant } from "@/lib/notices/types";
import { buildFiveDay, buildAccess } from "@/lib/notices/importer";
import { DEMO_FIVE_DAY_CSV, DEMO_ACCESS_CSV } from "@/lib/notices/demo";
import { FIVE_DAY_TEMPLATE, ACCESS_TEMPLATE, fieldValues } from "@/lib/notices/templates";
import { defaultFiveDayMessage, defaultAccessMessage } from "@/lib/notices/messages";
import { parseAmount } from "@/lib/notices/numberToWords";

const cellInput = "h-8 text-sm";

function SelectBar({ total, selected, onAll }: { total: number; selected: number; onAll: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{selected} of {total} selected</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => onAll(true)} disabled={!total}>Select all</Button>
        <Button variant="ghost" size="sm" onClick={() => onAll(false)} disabled={!selected}>Select none</Button>
      </div>
    </div>
  );
}

export function FiveDayWorkspace() {
  const [rows, setRows] = useState<FiveDayTenant[]>([]);
  const upd = (id: string, p: Partial<FiveDayTenant>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const sel = rows.filter((r) => r.selected);
  return (
    <div className="space-y-6">
      <ImportPanel title="Import 5-day notice list" fields={FIVE_DAY_FIELDS} demoCsv={DEMO_FIVE_DAY_CSV}
        build={(g, m) => { const res = buildFiveDay(g, m); setRows((r) => [...r, ...res.tenants]); return { count: res.tenants.length, issues: res.issues }; }} />
      <section className="space-y-2">
        <SelectBar total={rows.length} selected={sel.length} onAll={(v) => setRows((r) => r.map((x) => ({ ...x, selected: v })))} />
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="w-8 p-2" /><th className="p-2">Name(s)</th><th className="p-2">Address</th><th className="p-2">Unit</th><th className="p-2">LLC</th><th className="p-2">Issue date</th><th className="p-2">Balance</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No rows yet. Upload a file or load the fictional sample.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2"><Checkbox aria-label={`Select ${r.names}`} checked={r.selected} onCheckedChange={(v) => upd(r.id, { selected: v === true })} /></td>
                  <td className="p-1"><Input className={cellInput} value={r.names} onChange={(e) => upd(r.id, { names: e.target.value })} /></td>
                  <td className="p-1"><Input className={cellInput} value={r.address} onChange={(e) => upd(r.id, { address: e.target.value })} /></td>
                  <td className="p-1 w-20"><Input className={cellInput} value={r.unit} onChange={(e) => upd(r.id, { unit: e.target.value })} /></td>
                  <td className="p-1"><Input className={cellInput} value={r.llc} onChange={(e) => upd(r.id, { llc: e.target.value })} /></td>
                  <td className="p-1 w-40"><Input type="date" className={cellInput} value={r.issueDate} onChange={(e) => upd(r.id, { issueDate: e.target.value })} /></td>
                  <td className="p-1 w-32"><Input className={`${cellInput} ${r.balance == null ? "border-destructive" : ""}`} defaultValue={r.balance ?? ""} onBlur={(e) => upd(r.id, { balance: parseAmount(e.target.value) })} /></td>
                  <td className="p-1"><Button variant="ghost" size="icon" aria-label="Remove row" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Review selected notices</h2>
        <ReviewList template={FIVE_DAY_TEMPLATE} onHandoff={(id, v) => upd(id, { handedOff: v })}
          items={sel.map((t) => ({ id: t.id, handedOff: t.handedOff, values: fieldValues("five-day", t), defaults: defaultFiveDayMessage(t),
            warnings: [t.balance == null && "Balance is missing or not a number", !t.llc && "LLC is missing", !t.address && "Address is missing"].filter((x): x is string => !!x) }))} />
      </section>
    </div>
  );
}

export function AccessWorkspace() {
  const [rows, setRows] = useState<AccessTenant[]>([]);
  const upd = (id: string, p: Partial<AccessTenant>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const sel = rows.filter((r) => r.selected);
  return (
    <div className="space-y-6">
      <ImportPanel title="Import occupancy roster" fields={ACCESS_FIELDS} demoCsv={DEMO_ACCESS_CSV}
        build={(g, m) => { const res = buildAccess(g, m); setRows((r) => [...r, ...res.tenants]); return { count: res.tenants.length, issues: res.issues }; }} />
      <section className="space-y-2">
        <SelectBar total={rows.length} selected={sel.length} onAll={(v) => setRows((r) => r.map((x) => ({ ...x, selected: v })))} />
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left"><tr><th className="w-8 p-2" /><th className="p-2">Name(s)</th><th className="p-2">Address</th><th className="p-2">Unit</th><th className="p-2">Entry dates</th><th className="p-2">Reason</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No occupants yet. Upload a roster or load the fictional sample.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2"><Checkbox aria-label={`Select ${r.names}`} checked={r.selected} onCheckedChange={(v) => upd(r.id, { selected: v === true })} /></td>
                  <td className="p-1"><Input className={cellInput} value={r.names} onChange={(e) => upd(r.id, { names: e.target.value })} /></td>
                  <td className="p-1"><Input className={cellInput} value={r.address} onChange={(e) => upd(r.id, { address: e.target.value })} /></td>
                  <td className="p-1 w-20"><Input className={cellInput} value={r.unit} onChange={(e) => upd(r.id, { unit: e.target.value })} /></td>
                  <td className="p-1 w-44 space-y-1">
                    {r.entryDates.map((d, i) => (
                      <div key={i} className="flex gap-1">
                        <Input type="date" className={cellInput} value={d} onChange={(e) => upd(r.id, { entryDates: r.entryDates.map((x, j) => (j === i ? e.target.value : x)) })} />
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Remove date" onClick={() => upd(r.id, { entryDates: r.entryDates.filter((_, j) => j !== i) })}>×</Button>
                      </div>
                    ))}
                    <Button variant="link" size="sm" className="h-6 px-0" onClick={() => upd(r.id, { entryDates: [...r.entryDates, ""] })}>+ Add date</Button>
                  </td>
                  <td className="p-1"><Input className={cellInput} value={r.reason} onChange={(e) => upd(r.id, { reason: e.target.value })} /></td>
                  <td className="p-1"><Button variant="ghost" size="icon" aria-label="Remove row" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}><Trash2 className="size-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Review selected access notices</h2>
        <ReviewList template={ACCESS_TEMPLATE} onHandoff={(id, v) => upd(id, { handedOff: v })}
          items={sel.map((t) => { const c = { ...t, entryDates: t.entryDates.filter(Boolean) }; return { id: t.id, handedOff: t.handedOff, values: fieldValues("access", c), defaults: defaultAccessMessage(c),
            warnings: [!c.entryDates.length && "No entry dates", !t.reason && "Reason is missing", !t.address && "Address is missing"].filter((x): x is string => !!x) }; })} />
      </section>
    </div>
  );
}
