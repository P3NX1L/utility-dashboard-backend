import { useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listExports, downloadExport, individualFiveDayDownloads, markNoticeDownloaded, deleteFiveDayNotice, chicagoGenerationDate, type ExportRecord, type NoticeDownload } from "@/lib/notices/exports";
import type { NoticeKind } from "@/lib/notices/types";
import { useExportUser } from "./ExportSession";
export function ExportHistory({ kind }: { kind: NoticeKind }) {
  const userId = useExportUser();
  const [rows, setRows] = useState<ExportRecord[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<NoticeDownload[]>([]);
  const [downloading, setDownloading] = useState<string[]>([]);
  useEffect(() => {
    let active = true; setRows([]); setNotices([]); setDownloading([]); setError(""); setLoading(true);
    if (!userId) { setLoading(false); return; }
    void listExports(userId, kind).then(async (records) => {
      const individual = kind === "five-day" ? await individualFiveDayDownloads(records) : [];
      if (active) { setRows(records); setNotices(individual); }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "History unavailable."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, kind]);
  const downloadNotice = async (notice: NoticeDownload) => {
    if (!userId) return;
    const key = `${notice.recordId}:${notice.filename}`;
    setError(""); setDownloading((ids) => [...ids, key]);
    try {
      downloadExport(notice);
      await markNoticeDownloaded(userId, notice.recordId, notice.filename);
      setNotices((items) => items.map((item) => item.recordId === notice.recordId && item.filename === notice.filename ? { ...item, downloaded: true } : item));
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed."); }
    finally { setDownloading((ids) => ids.filter((id) => id !== key)); }
  };
  const deleteNotice = async (notice: NoticeDownload) => {
    if (!userId || !window.confirm(`Delete the notice for ${notice.tenant}? This cannot be undone.`)) return;
    const key = `${notice.recordId}:${notice.filename}`;
    setError(""); setDownloading((ids) => [...ids, key]);
    try {
      await deleteFiveDayNotice(userId, notice.recordId, notice.filename);
      setNotices((items) => items.filter((item) => item.recordId !== notice.recordId || item.filename !== notice.filename));
    } catch (e) { setError(e instanceof Error ? e.message : "Notice could not be deleted."); }
    finally { setDownloading((ids) => ids.filter((id) => id !== key)); }
  };
  return <section className="space-y-5">
    <header>
      <h1 className="text-3xl font-semibold tracking-tight">Exports</h1>
      <p className="mt-1 text-sm font-normal text-foreground">Generated AppFolio files</p>
    </header>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loading && !error && !rows.length && <p className="text-sm text-muted-foreground">No exports yet.</p>}
    {kind === "five-day" && !loading && notices.length > 0 && <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">{notices.map((notice) => <li key={`${notice.recordId}:${notice.filename}`} aria-label={`${notice.tenant}${notice.downloaded ? ", downloaded" : ", not downloaded"}`} className={`grid items-center gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] ${notice.downloaded ? "bg-downloaded" : "bg-card"}`}>
      <p className="min-w-0 break-words text-sm font-medium">{notice.tenant}</p>
      <time className="text-xs text-muted-foreground" dateTime={notice.createdAt}>{chicagoGenerationDate(notice.createdAt)}</time>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" title={notice.filename} disabled={downloading.includes(`${notice.recordId}:${notice.filename}`)} onClick={() => void downloadNotice(notice)}><Download aria-hidden="true" className="size-4" />Download notice</Button><Button variant="ghost" size="icon" className="size-8" title={`Delete notice for ${notice.tenant}`} aria-label={`Delete notice for ${notice.tenant}`} disabled={downloading.includes(`${notice.recordId}:${notice.filename}`)} onClick={() => void deleteNotice(notice)}><Trash2 aria-hidden="true" className="size-4" /></Button>{notice.downloaded && <span role="status" className="text-xs">Downloaded</span>}</div>
    </li>)}</ul>}
    {loading ? <p role="status">Loading exports…</p> : kind === "five-day" || !rows.length ? null : <ul className="divide-y divide-border border-y border-border">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.count === 1 ? row.tenants[0] : `${row.count} tenants`}</p><p className="mt-1 text-xs text-muted-foreground"><time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}</time> · Chicago</p><p className="mt-1 break-all text-xs">{row.filename}</p>{row.count > 1 && <details className="mt-2 text-xs"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tenants</summary><ul className="mt-1 space-y-1">{row.tenants.map((name, i) => <li key={i}>{name}</li>)}</ul></details>}</div>
      <Button variant="outline" size="sm" aria-label={`Download ${row.filename}`} onClick={() => { if (row.userId === userId) downloadExport(row); }}><Download className="size-4" />Download</Button>
    </li>)}</ul>}
  </section>;
}
