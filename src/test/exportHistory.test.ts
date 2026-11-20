// @vitest-environment node
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { IDBFactory } from "fake-indexeddb";
import { packageReviewed, saveExport, listExports, type ExportRecord } from "@/lib/notices/exports";
import { buildRentBatch } from "@/lib/notices/fiveDayPdf";
import { parseAppFolioCsv } from "@/lib/notices/fiveDay";
import { generateAccessNotices } from "@/lib/notices/accessPdf";
const csv = 'Unit,Name,Tenant Status,Amount Receivable,Delinquent Rent,Delinquent other charges\n"-> Test - 1 Test St Chicago, IL 60601",,,,,\nA,"Example, Alex",Current,2100,2070,30';
async function rentNotices() {
  const tenant = parseAppFolioCsv(csv).tenants[0]; if (!tenant) throw new Error("Missing fixture");
  return (await buildRentBatch([{ tenant, owner: "Synthetic LLC", agent: "Aahil Penwalla", issueDate: "2025-04-14" }], new Uint8Array(readFileSync("src/assets/five-day-heading.png")))).notices;
}
const accessRow = { id: "access-1", names: "Synthetic Person", address: "1 Test St", unit: "A", entryDates: ["2026-11-25"], reason: "Inspection", selected: true, handedOff: false };
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
describe("reviewed PDF and ZIP exports", () => {
  it("one five-day tenant downloads original PDF bytes with PDF MIME and filename", async () => {
    const notices = await rentNotices(); const first = notices[0]; if (!first) throw new Error("Missing PDF");
    const output = await packageReviewed(notices, [first.id], "five-day");
    expect(output.blob.type).toBe("application/pdf"); expect(output.filename).toBe(first.filename);
    expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(first.bytes);
    expect(new TextDecoder().decode(first.bytes.subarray(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(first.bytes)).getPageCount()).toBe(1);
  });
  it("two tenants download a ZIP containing exactly two individual PDFs", async () => {
    const notices = await rentNotices(); const first = notices[0]; if (!first) throw new Error("Missing PDF");
    const two = [first, { ...first, id: "second", filename: "second.pdf" }];
    const output = await packageReviewed(two, two.map((n) => n.id), "five-day");
    expect(output.blob.type).toBe("application/zip"); expect(output.filename.endsWith(".zip")).toBe(true);
    const bytes = new Uint8Array(await output.blob.arrayBuffer()); expect([...bytes.subarray(0, 4)]).toEqual([80, 75, 3, 4]);
    const zip = await JSZip.loadAsync(bytes); expect(Object.keys(zip.files)).toHaveLength(2);
    for (const file of Object.values(zip.files)) expect((await PDFDocument.load(await file.async("uint8array"))).getPageCount()).toBe(1);
  });
  it("access drafts remain labeled and export as PDF for one and ZIP for two", async () => {
    const one = await generateAccessNotices([accessRow]); const first = one[0]; if (!first) throw new Error("Missing draft");
    const output = await packageReviewed(one, [first.id], "access"); expect(output.blob.type).toBe("application/pdf"); expect(output.filename).toContain("DRAFT");
    // jsPDF leaves the draft string in its uncompressed content stream.
    expect(new TextDecoder().decode(first.bytes)).toContain("DRAFT");
    const two = await generateAccessNotices([accessRow, { ...accessRow, id: "access-2" }]);
    const zipOutput = await packageReviewed(two, two.map((n) => n.id), "access");
    expect(Object.keys((await JSZip.loadAsync(await zipOutput.blob.arrayBuffer())).files)).toHaveLength(2);
  });
  it("rejects unreviewed or corrupt output before it can be persisted", async () => {
    const notices = await rentNotices(); await expect(packageReviewed(notices, [], "five-day")).rejects.toThrow("Review every PDF");
    await expect(packageReviewed([{ id: "bad", filename: "bad.pdf", bytes: new Uint8Array([1]) }], ["bad"], "access")).rejects.toThrow("Invalid PDF");
    expect(await listExports("staff-a", "five-day")).toEqual([]);
  });
  it("history survives reopening and is isolated by staff identity and notice type", async () => {
    const notices = await rentNotices(); const output = await packageReviewed(notices, notices.map((n) => n.id), "five-day");
    const record: ExportRecord = { ...output, id: "export-1", userId: "staff-a", kind: "five-day", createdAt: "2026-11-20T17:00:00Z", count: 1, tenants: ["Synthetic Person"] };
    await saveExport("staff-a", record);
    expect((await listExports("staff-a", "five-day"))[0]?.filename).toBe(record.filename);
    expect((await listExports("staff-a", "five-day"))[0]?.blob.type).toBe("application/pdf");
    expect(await listExports("staff-b", "five-day")).toEqual([]); expect(await listExports("staff-a", "access")).toEqual([]);
    await expect(saveExport("staff-b", record)).rejects.toThrow("account mismatch");
  });
  it("does not persist an export cancelled by edits or a session switch", async () => {
    const controller = new AbortController(); controller.abort();
    const record: ExportRecord = { id: "cancelled", userId: "staff-a", kind: "access", createdAt: "2026-11-20T17:00:00Z", count: 1, tenants: ["Synthetic"], filename: "draft.pdf", blob: new Blob(["%PDF-"], { type: "application/pdf" }) };
    await expect(saveExport("staff-a", record, controller.signal)).rejects.toThrow("changed before saving");
    expect(await listExports("staff-a", "access")).toEqual([]);
  });
});
