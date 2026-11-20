import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listExports, downloadExport, type ExportRecord } from "@/lib/notices/exports";
import type { NoticeKind } from "@/lib/notices/types";
import { useExportUser } from "./ExportSession";
export function ExportHistory({ kind }: { kind: NoticeKind }) {
  const userId = useExportUser();
  const [rows, setRows] = useState<ExportRecord[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setRows([]); setError(""); setLoading(true);
    if (!userId) { setLoading(false); return; }
    void listExports(userId, kind).then((records) => { if (active) setRows(records); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "History unavailable."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, kind]);
  return <section className="space-y-5">
    <header>
      <h1 className="text-3xl font-semibold tracking-tight">Exports</h1>
      <p className="mt-1 text-sm font-normal text-foreground">Generated AppFolio files</p>
    </header>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p role="status">Loading exports…</p> : !rows.length ? <p className="text-sm text-muted-foreground">No exports yet.</p> : <ul className="divide-y divide-border border-y border-border">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.count === 1 ? row.tenants[0] : `${row.count} tenants`}</p><p className="mt-1 text-xs text-muted-foreground"><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}</time> · Chicago</p><p className="mt-1 break-all text-xs">{row.filename}</p>{row.count > 1 && <details className="mt-2 text-xs"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tenants</summary><ul className="mt-1 space-y-1">{row.tenants.map((name, i) => <li key={i}>{name}</li>)}</ul></details>}</div>
      <Button variant="outline" size="sm" aria-label={`Download ${row.filename}`} onClick={() => { if (row.userId === userId) downloadExport(row); }}><Download className="size-4" />Download</Button>
    </li>)}</ul>}
  </section>;
}
