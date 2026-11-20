import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ImportPanel } from "./ImportPanel";
import { ReviewedExport } from "./ReviewedExport";
import { ACCESS_FIELDS, type AccessTenant } from "@/lib/notices/types";
import { buildAccess } from "@/lib/notices/importer";
import { accessIssues, generateAccessNotices } from "@/lib/notices/accessPdf";
import type { GeneratedNotice } from "@/lib/notices/fiveDayPdf";
import { parseDateList } from "@/lib/notices/dates";
export function AccessNoticeWorkspace() {
  const [rows, setRows] = useState<AccessTenant[]>([]), [search, setSearch] = useState("");
  const [dates, setDates] = useState(""), [reason, setReason] = useState("");
  const [generated, setGenerated] = useState<GeneratedNotice[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const revision = useRef(0);
  const invalidate = () => { revision.current++; setGenerated(null); setError(""); };
  const update = (id: string, patch: Partial<AccessTenant>) => { invalidate(); setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r)); };
  const visible = rows.filter((r) => [r.names, r.address, r.unit].some((s) => s.toLowerCase().includes(search.trim().toLowerCase())));
  const selected = rows.filter((r) => r.selected).map((r) => ({ ...r, reason, entryDates: parseDateList(dates) }));
  const issues = accessIssues(selected);
  const generate = async () => {
    const version = revision.current; setBusy(true); setError(""); setGenerated(null);
    try { const result = await generateAccessNotices(selected); if (revision.current === version) setGenerated(result); }
    catch (e) { if (revision.current === version) setError(e instanceof Error ? e.message : "No export created."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-6">
    <h1 className="text-3xl font-semibold">Access Notices</h1>
    <p className="text-sm font-medium text-preview">DRAFT — not an official First Western template</p>
    <ImportPanel title="Import occupancy roster" fields={ACCESS_FIELDS} build={(g, m) => { const result = buildAccess(g, m); invalidate(); setRows(result.tenants); return { count: result.tenants.length, issues: result.issues }; }} />
    {rows.length > 0 && <div className="grid items-start gap-7 lg:grid-cols-2">
      <section className="min-w-0 space-y-3" aria-label="Access tenant checklist"><h2 className="font-semibold">Occupants ({selected.length} selected)</h2><Input type="search" aria-label="Search access tenants" placeholder="Search tenant, property or unit" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => { invalidate(); setRows((rs) => rs.map((r) => visible.some((v) => v.id === r.id) ? { ...r, selected: true } : r)); }}>Select shown</Button><Button size="sm" variant="ghost" onClick={() => { invalidate(); setRows((rs) => rs.map((r) => visible.some((v) => v.id === r.id) ? { ...r, selected: false } : r)); }}>Clear shown</Button></div>
        {visible.map((r) => <label key={r.id} className={`flex items-center gap-3 rounded-lg border p-3 ${r.selected ? "border-primary bg-accent" : "border-border bg-card"}`}><Checkbox className="rounded-full" checked={r.selected} aria-label={`Select ${r.names}, unit ${r.unit}`} onCheckedChange={(v) => update(r.id, { selected: v === true })} /><span className="min-w-0 text-sm"><span className="block break-words font-medium">{r.names}</span><span className="block break-words text-xs text-muted-foreground">{r.address} · Unit {r.unit || "—"}</span></span></label>)}
      </section>
      <section className="min-w-0 space-y-4" aria-label="Review access notices"><h2 className="font-semibold">Review & prepare</h2>
        <label className="block space-y-1 text-sm"><span>Entry dates</span><Input aria-label="Entry dates" placeholder="YYYY-MM-DD; YYYY-MM-DD" value={dates} onChange={(e) => { invalidate(); setDates(e.target.value); }} /></label>
        <label className="block space-y-1 text-sm"><span>Reason for entry</span><Input aria-label="Reason for entry" value={reason} onChange={(e) => { invalidate(); setReason(e.target.value); }} /></label>
        {selected.map((r) => <div key={r.id} className="space-y-2 border-t border-border pt-3"><label className="block space-y-1 text-sm"><span>Tenant name</span><Input aria-label={`Name for ${r.id}`} value={r.names} onChange={(e) => update(r.id, { names: e.target.value })} /></label><label className="block space-y-1 text-sm"><span>Address</span><Input aria-label={`Address for ${r.id}`} value={r.address} onChange={(e) => update(r.id, { address: e.target.value })} /></label><label className="block space-y-1 text-sm"><span>Unit</span><Input aria-label={`Unit for ${r.id}`} value={r.unit} onChange={(e) => update(r.id, { unit: e.target.value })} /></label></div>)}
        {issues.map((i) => <p key={i} className="text-xs text-destructive">{i}</p>)}{error && <p role="alert" className="text-destructive">{error}</p>}
        <Button className="w-full" disabled={!selected.length || issues.length > 0 || busy} onClick={() => void generate()}>{busy ? "Generating…" : `Generate & preview ${selected.length} draft notice${selected.length === 1 ? "" : "s"}`}</Button>
        {generated && <ReviewedExport key={revision.current} notices={generated} tenants={selected.map((r) => r.names)} kind="access" />}
      </section>
    </div>}
  </div>;
}
