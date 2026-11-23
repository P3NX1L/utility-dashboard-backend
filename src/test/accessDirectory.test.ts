import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { isChicagoAddress, accessDetailIssues, defaultAccessDetails, generateAccessBatch, groupSelected, parseTenantDirectory, reasonText, splitProperty } from "@/lib/notices/accessDirectory";
const H = "Property,Unit,Tenant,Status,Tenant Type,Phone Numbers,Emails,Move-in,Lease To,Rent,Deposit,Tenant Tags";
const CSV = `\uFEFF${H}\n"Example - 100 Example St Chicago, IL 60612",1,"Doe, Jane",Current,Financially Responsible,555,a@x.test,,,"1,000.00",0,\n"Example - 100 Example St Chicago, IL 60612",1,"Roe , Sam",Current,Co-signer,,,,,,,\n\n"Example - 100 Example St Chicago, IL 60612",2,"Poe, Al",Current,Other Occupant,,,,,,,\nTotal,,,,,,,,,"1,000.00",0,\n`;
describe("access tenant directory", () => {
  it("parses rows, drops blanks/totals and keeps only needed columns", () => {
    const rows = parseTenantDirectory(CSV);
    expect(rows.map((r) => r.tenant)).toEqual(["Doe, Jane", "Roe , Sam", "Poe, Al"]);
    expect(Object.keys(rows[0]!).sort()).toEqual(["id", "property", "role", "status", "tenant", "unit"]);
  });
  it("allows only true Chicago addresses for the Chicago template", () => {
    expect(isChicagoAddress("Example - 100 Example St Chicago, IL 60612")).toBe(true);
    expect(isChicagoAddress("Chicago Plaza - 1200 W. 127th St Calumet Park, IL 60827")).toBe(false);
    expect(isChicagoAddress("X - 5 Test Ave Blue Island, IL 60406")).toBe(false);
    expect(isChicagoAddress("X - 5 Main St West Chicago, IL 60185")).toBe(false);
    expect(isChicagoAddress("X - 5 Main St North Chicago, IL 60064")).toBe(false);
    expect(isChicagoAddress("X - 5 Main St Chicago Heights, IL 60411")).toBe(false);
    expect(isChicagoAddress("X - 5 Main St Somewhere")).toBe(false);
  });
  it("refuses to generate for a non-Chicago unit", async () => {
    const rows = parseTenantDirectory(`${H}\n"X - 5 Test Ave Blue Island, IL 60406",3,"Poe, Al",Current,Other Occupant,,,,,,,\n`);
    const g = groupSelected(rows, new Set([rows[0]!.id]));
    await expect(generateAccessBatch(g, { ...defaultAccessDetails(), dates: ["2026-12-01"], start: "09:00", end: "12:00", reason: "routine" })).rejects.toThrow(/municipality-specific office template/);
  });
  it("rejects a wrong header", () => { expect(() => parseTenantDirectory("Property,Unit\nx,1")).toThrow(/Header/); });
  it("splits property into street and city line", () => {
    expect(splitProperty("Example - 100 Example St Chicago, IL 60612")).toEqual({ name: "Example", street: "100 Example St", cityLine: "Chicago, IL 60612" });
  });
  it("groups only selected names per unit, verbatim", () => {
    const rows = parseTenantDirectory(CSV);
    const g = groupSelected(rows, new Set([rows[0]!.id, rows[1]!.id]));
    expect(g).toHaveLength(1); expect(g[0]!.names).toEqual(["Doe, Jane", "Roe , Sam"]);
  });
  it("validates times and requires detail for Other", () => {
    const d = { ...defaultAccessDetails(), dates: ["2026-12-01"], start: "10:00", end: "09:00", reason: "other" as const };
    expect(accessDetailIssues(d)).toEqual(expect.arrayContaining(["End time must be after start time.", "Describe the reason for Other."]));
    expect(reasonText({ ...d, reason: "estimate", detail: "windows" })).toBe("Inspect and get estimate for windows");
  });
  it("creates one PDF per selected unit", async () => {
    const rows = parseTenantDirectory(CSV);
    const g = groupSelected(rows, new Set(rows.map((r) => r.id)));
    const out = await generateAccessBatch(g, { ...defaultAccessDetails(), dates: ["2026-12-01", "2026-12-02"], start: "09:00", end: "12:00", reason: "routine" });
    expect(out).toHaveLength(2);
    expect(new TextDecoder().decode(out[0]!.bytes.subarray(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(out[0]!.bytes);
    const contents = doc.getPage(0).node.Contents();
    const raw = (contents && "asArray" in contents ? contents.asArray() : []).map((ref) => { const o = doc.context.lookup(ref); return o instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(o).decode()) : ""; }).join("\n");
    const text = [...raw.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) => m[1]!.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join("")).join(" ");
    expect(text).toContain("MUNICIPAL CODE OF CHICAGO SEC. 5-12-050");
    expect(text).toContain("December 1, 2026 AND December 2, 2026");
    expect(text).toContain("9:00 AM AND 12:00 PM FOR THE FOLLOWING REASONS:");
    expect(text).toContain("Routine inspection to assess compliance with lease or law");
    expect(text).toContain("THANK YOU FOR YOUR COOPERATION.");
    expect(text).toContain("LANDLORD/AGENT");
  });
});
