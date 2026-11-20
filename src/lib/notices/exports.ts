import JSZip from "jszip";
import type { NoticeKind } from "./types";
import type { GeneratedNotice } from "./fiveDayPdf";

export interface ExportRecord {
  id: string; userId: string; kind: NoticeKind; createdAt: string;
  tenants: string[]; count: number; filename: string; blob: Blob;
}
export async function packageReviewed(notices: GeneratedNotice[], reviewed: string[], kind: NoticeKind) {
  if (!notices.length || notices.some((n) => !reviewed.includes(n.id))) throw new Error("Review every PDF before exporting.");
  const names = new Set<string>();
  for (const n of notices) {
    if (new TextDecoder().decode(n.bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Invalid PDF; no export saved.");
    if (!n.filename.endsWith(".pdf") || names.has(n.filename.toLowerCase())) throw new Error("PDF filenames must be unique.");
    names.add(n.filename.toLowerCase());
  }
  const single = notices[0];
  if (notices.length === 1 && single) return { filename: single.filename, blob: new Blob([new Uint8Array(single.bytes)], { type: "application/pdf" }) };
  const zip = new JSZip();
  for (const n of notices) zip.file(n.filename, n.bytes);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { filename: `${kind === "access" ? "Access" : "5-Day"}_Notices.zip`, blob: new Blob([new Uint8Array(bytes)], { type: "application/zip" }) };
}
function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("first-western-notice-exports", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("exports", { keyPath: ["userId", "id"] });
      store.createIndex("owner", "userId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser export storage is unavailable."));
  });
}
export async function saveExport(userId: string, record: ExportRecord, signal?: AbortSignal): Promise<void> {
  if (!userId || record.userId !== userId) throw new Error("Export account mismatch.");
  const db = await openHistory();
  try { await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Export was changed before saving.")); return; }
    const tx = db.transaction("exports", "readwrite");
    const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
    signal?.addEventListener("abort", abort, { once: true });
    const remove = () => signal?.removeEventListener("abort", abort);
    tx.objectStore("exports").add(record);
    tx.oncomplete = () => { remove(); resolve(); };
    tx.onerror = () => { remove(); reject(new Error("Export could not be saved. Check browser storage space.")); };
    tx.onabort = () => { remove(); reject(new Error("Export storage was interrupted.")); };
  }); } finally { db.close(); }
}
export async function listExports(userId: string, kind: NoticeKind): Promise<ExportRecord[]> {
  if (!userId) return [];
  const db = await openHistory();
  try { return await new Promise<ExportRecord[]>((resolve, reject) => {
    const tx = db.transaction("exports", "readonly");
    const request = tx.objectStore("exports").index("owner").getAll(IDBKeyRange.only(userId));
    request.onsuccess = () => resolve((request.result as ExportRecord[]).filter((r) => r.userId === userId && r.kind === kind).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(new Error("Export history could not be read."));
  }); } finally { db.close(); }
}
export function downloadExport(record: Pick<ExportRecord, "filename" | "blob">) {
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement("a"); a.href = url; a.download = record.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
