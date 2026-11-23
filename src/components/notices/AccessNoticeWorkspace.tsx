import { useEffect, useRef, useState } from "react";
import { Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ReviewedExport } from "./ReviewedExport";
import { useExportUser } from "./ExportSession";
import type { GeneratedNotice } from "@/lib/notices/fiveDayPdf";
import { ACCESS_REASONS, accessDetailIssues, defaultAccessDetails, generateAccessBatch, groupSelected, municipalityIssue, parseTenantDirectory, readDirectory, saveDirectory, type AccessDetails, type DirectoryRow, type ReasonId } from "@/lib/notices/accessDirectory";

export function AccessNoticeWorkspace() {
  const userId = useExportUser() ?? "";
  return <AccountAccessWorkspace key={userId} userId={userId} />;
}

function AccountAccessWorkspace({ userId }: { userId: string }) {
  const [rows, setRows] = useState<DirectoryRow[]>([]), [fileName, setFileName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()), [search, setSearch] = useState("");
  const [details, setDetails] = useState<AccessDetails>(defaultAccessDetails);
  const [generated, setGenerated] = useState<GeneratedNotice[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [uploadError, setUploadError] = useState("");
  const revision = useRef(0), input = useRef<HTMLInputElement>(null), pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    readDirectory(userId).then((s) => { if (s && !ctl.signal.aborted) { setRows(s.rows); setFileName(s.filename); } }).catch(() => {});
    return () => { ctl.abort(); pending.current?.abort(); };
  }, [userId]);
  const invalidate = () => { revision.current++; setGenerated(null); setError(""); };
  const patch = (p: Partial<AccessDetails>) => { invalidate(); setDetails((d) => ({ ...d, ...p })); };
  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setUploadError(""); setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Please choose a .csv file.");
      if (file.size > 10 * 1024 * 1024) throw new Error("The CSV exceeds 10 MB.");
      const parsed = parseTenantDirectory(await file.text());
      const ctl = new AbortController(); pending.current = ctl;
      await saveDirectory({ userId, filename: file.name, rows: parsed }, ctl.signal);
      if (ctl.signal.aborted) return;
      invalidate(); setRows(parsed); setFileName(file.name); setSelected(new Set()); setSearch("");
    } catch (e) { setUploadError(`${e instanceof Error ? e.message : "Upload failed."} Your previous directory is unchanged.`); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || [r.tenant, r.property, r.unit].some((s) => s.toLowerCase().includes(q)));
  const groups = groupSelected(rows, selected);
  const issues = selected.size ? [...groups.map(municipalityIssue).filter(Boolean), ...accessDetailIssues(details)] : [];
  const reason = ACCESS_REASONS.find((r) => r.id === details.reason);
  const toggle = (id: string, on: boolean) => { invalidate(); setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }); };
  const generate = async () => {
    const v = revision.current; setBusy(true); setError(""); setGenerated(null);
    try { const out = await generateAccessBatch(groups, details); if (revision.current === v) setGenerated(out); }
    catch (e) { if (revision.current === v) setError(e instanceof Error ? e.message : "No notice created."); }
    finally { setBusy(false); }
  };
  const picker = <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void upload(e.target.files?.[0])} />;
  return <div className="space-y-6">
    <h1 className="text-3xl font-semibold">Access Notices</h1>
    {picker}
    {!rows.length && <section className="space-y-2"><h2 className="text-sm font-semibold">AppFolio Tenant Directory</h2>
      <button type="button" disabled={busy} onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files[0]); }}
        className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Upload className="size-5 text-primary" aria-hidden="true" /><span>{busy ? "Reading…" : <>Drop your CSV here or <span className="text-primary">browse files</span></>}</span>
      </button></section>}
    {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
    {rows.length > 0 && <div className="grid items-start gap-7 lg:grid-cols-2">
      <section className="min-w-0 space-y-3" aria-label="Access recipients">
        <Input type="search" aria-label="Search tenants" placeholder="Search tenant, property or unit" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-[70vh] space-y-1 overflow-y-auto rounded-lg border border-border p-2">
          {visible.map((r) => <label key={r.id} className={`flex items-center gap-3 rounded-md border p-2 ${selected.has(r.id) ? "border-primary bg-accent" : "border-border bg-card"}`}>
            <Checkbox className="rounded-full" checked={selected.has(r.id)} aria-label={`Select ${r.tenant}, ${r.role}, unit ${r.unit}`} onCheckedChange={(v) => toggle(r.id, v === true)} />
            <span className="min-w-0 text-sm"><span className="block break-words font-medium">{r.tenant} <span className="font-normal text-muted-foreground">· {r.role || "—"}</span></span><span className="block break-words text-xs text-muted-foreground">{r.property} · Unit {r.unit || "—"}</span></span>
          </label>)}
          {!visible.length && <p className="p-3 text-sm text-muted-foreground">No tenants match.</p>}
        </div>
      </section>
      <section className="min-w-0 space-y-4" aria-label="Review access notices">
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Review & prepare</h2><Button size="sm" title={fileName} disabled={busy} onClick={() => input.current?.click()}>Update Tenant Directory</Button></div>
        {groups.map((g) => <div key={g.key} className="rounded-md border border-border p-3 text-sm"><p className="font-medium">{g.street}{g.unit ? `, Unit ${g.unit}` : ""}</p><p className="text-xs text-muted-foreground">{g.names.join(" · ")}</p></div>)}
        <div className="space-y-1 text-sm"><span>Access dates</span>
          {details.dates.map((d, i) => <div key={i} className="flex gap-1"><Input type="date" aria-label={`Access date ${i + 1}`} value={d} onChange={(e) => patch({ dates: details.dates.map((x, j) => j === i ? e.target.value : x) })} /><Button variant="ghost" size="icon" aria-label={`Remove access date ${i + 1}`} onClick={() => patch({ dates: details.dates.filter((_, j) => j !== i) })}><X className="size-4" /></Button></div>)}
          <Button variant="ghost" size="sm" onClick={() => patch({ dates: [...details.dates, ""] })}><Plus className="size-4" />Add date</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm"><span>Start time</span><Input type="time" aria-label="Start time" value={details.start} onChange={(e) => patch({ start: e.target.value })} /></label>
          <label className="space-y-1 text-sm"><span>End time</span><Input type="time" aria-label="End time" value={details.end} onChange={(e) => patch({ end: e.target.value })} /></label>
        </div>
        <label className="block space-y-1 text-sm"><span>Reason for entry</span>
          <select aria-label="Reason for entry" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={details.reason} onChange={(e) => patch({ reason: e.target.value as ReasonId, detail: "" })}>
            <option value="">Choose a reason</option>{ACCESS_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select></label>
        {reason?.detail && <label className="block space-y-1 text-sm"><span>{reason.id === "other" ? "Describe reason (required)" : "Details"}</span><Input aria-label="Reason details" value={details.detail} onChange={(e) => patch({ detail: e.target.value })} /></label>}
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm"><span>Dated</span><Input type="date" aria-label="Dated" value={details.dated} onChange={(e) => patch({ dated: e.target.value })} /></label>
          <label className="space-y-1 text-sm"><span>Landlord/agent</span><Input aria-label="Landlord/agent" value={details.agent} onChange={(e) => patch({ agent: e.target.value })} /></label>
        </div>
        {issues.map((i) => <p key={i} className="text-xs text-destructive">{i}</p>)}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={!groups.length || issues.length > 0 || busy} onClick={() => void generate()}>{busy ? "Generating…" : `Generate & Preview ${groups.length} notice${groups.length === 1 ? "" : "s"}`}</Button>
        {generated && <ReviewedExport key={revision.current} notices={generated} tenants={groups.map((g) => g.names.join(" & "))} kind="access" />}
      </section>
    </div>}
  </div>;
}
