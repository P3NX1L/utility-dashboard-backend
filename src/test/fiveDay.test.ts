// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { parseAppFolioCsv, parseProperty, eligible, dateWording, noticeDisplayName, noticeIssues, selectedNoticeInputs, type NoticeInput } from "@/lib/notices/fiveDay";
import { buildRentBatch, demandWords } from "@/lib/notices/fiveDayPdf";
import { FIVE_DAY_OFFICE_TEMPLATE } from "@/lib/notices/templates";

export const syntheticCsv = '\uFEFFUnit,Name,Tenant Status,Move In,Amount Receivable,Delinquent Rent,Delinquent other charges,0-30,30+,Delinquency Notes\r\n' +
  '"-> Test Range - 100-104 Test St - 106 Test St Chicago, IL 60601",,,,,,,,,\r\n' +
  '1,"Example, Alex M.",Current,01/01/2025,"2,099.05","2,070.05",29,0,0,"Quoted note, with comma\nsecond line"\r\n' +
  '1,"Example, Alex M.",Current,01/01/2025,"2,099.05","2,070.05",29,0,0,\r\n' +
  '2,"Zero, Pat",Current,01/01/2025,200,0,200,0,0,\r\n' +
  'Subtotal,,,,4398.10,4140.10,258,0,0,\r\n' +
  ',,,,,,,,,\r\n' +
  '"-> Test South - 200 Test St Calumet Park, IL 60827",,,,,,,,,\r\n' +
  'A,"Other, Sam",Past,01/01/2025,11,10,1,0,0,\r\n' +
  'Total,,,,4409.10,4150.10,259,0,0,\r\n';

function inputs(): NoticeInput[] {
  return parseAppFolioCsv(syntheticCsv).tenants.filter(eligible).map((tenant) => ({ tenant, owner: "Example Owner LLC", agent: "Aahil Penwalla", issueDate: "2025-04-14" }));
}
describe("AppFolio rent report", () => {
  it("defaults every property's signer to Aahil Penwalla", () => {
    expect(parseAppFolioCsv(syntheticCsv).properties.map((p) => p.agent)).toEqual(["Aahil Penwalla", "Aahil Penwalla"]);
  });
  it("shares owner and editable signer only within the selected property", () => {
    const batch = parseAppFolioCsv(syntheticCsv);
    batch.tenants = batch.tenants.map((t) => ({ ...t, selected: eligible(t) }));
    batch.properties = batch.properties.map((p, i) => ({ ...p, owner: i === 0 ? "Range Trust" : "South LLC", agent: i === 0 ? "Different Agent" : p.agent }));
    expect(selectedNoticeInputs(batch, "2025-04-14").map(({ owner, agent }) => ({ owner, agent }))).toEqual([
      { owner: "Range Trust", agent: "Different Agent" },
      { owner: "Range Trust", agent: "Different Agent" },
      { owner: "South LLC", agent: "Aahil Penwalla" },
    ]);
  });
  it("requires the legal owner for each selected property but not unselected properties", () => {
    const batch = parseAppFolioCsv(syntheticCsv);
    batch.tenants = batch.tenants.map((t) => ({ ...t, selected: eligible(t) && t.propertyId === "property-1" }));
    batch.properties = batch.properties.map((p) => ({ ...p, owner: p.id === "property-1" ? "Range Trust" : "" }));
    expect(selectedNoticeInputs(batch, "2025-04-14").flatMap(noticeIssues)).toEqual([]);
    batch.tenants = batch.tenants.map((t) => ({ ...t, selected: eligible(t) }));
    expect(selectedNoticeInputs(batch, "2025-04-14").flatMap(noticeIssues)).toEqual(["Property owner LLC or trust is required."]);
  });
  it("keeps every named row, duplicates, quoted thousands and multiline notes; ignores subtotal/Total", () => {
    const batch = parseAppFolioCsv(syntheticCsv);
    expect(batch.properties).toHaveLength(2);
    expect(batch.tenants).toHaveLength(4);
    expect(batch.tenants[0]?.name).toBe("Example, Alex M.");
    expect(batch.tenants[0]?.rent).toBe(2070.05);
    expect(batch.tenants[0]?.receivable).toBe(2099.05);
    expect(batch.tenants[0]?.other).toBe(29);
    expect(new Set(batch.tenants.map((t) => t.id)).size).toBe(4);
  });
  it("retains 92 named rows across 51 synthetic property groups", () => {
    const lines = ["Unit,Name,Tenant Status,Amount Receivable,Delinquent Rent,Delinquent other charges"];
    for (let group = 0; group < 51; group++) {
      lines.push(`"-> Test ${group} - ${group + 1} Test St Chicago, IL 60601",,,,,`);
      lines.push(`A,"Synthetic, Person ${group}",Current,100,90,10`);
      if (group < 41) lines.push(`B,"Synthetic, Person ${group}",Current,100,90,10`);
      lines.push("Subtotal,,,200,180,20", ",,,,,");
    }
    lines.push("Total,,,9200,8280,920");
    const batch = parseAppFolioCsv(lines.join("\n"));
    expect(batch.properties).toHaveLength(51);
    expect(batch.tenants).toHaveLength(92);
  });
  it("splits only the first spaced hyphen and preserves ranges and multiple addresses", () => {
    expect(parseProperty("-> Test Range - 100-104 Test St - 106 Test St Chicago, IL 60601", "p")).toMatchObject({ label: "Test Range", street: "100-104 Test St - 106 Test St", city: "Chicago", zip: "60601" });
    for (const city of ["Blue Island", "Calumet City", "Calumet Park", "Chicago"]) {
      expect(parseProperty(`-> Property - 1 Test St ${city}, IL 60827`, "p").city).toBe(city);
    }
  });
  it("defaults none selected and disables zero rent even when other charges are positive", () => {
    const tenants = parseAppFolioCsv(syntheticCsv).tenants;
    expect(tenants.every((t) => t.selected === false)).toBe(true);
    const zero = tenants[2];
    if (!zero) throw new Error("Missing zero-rent fixture");
    expect(zero.other).toBe(200); expect(eligible(zero)).toBe(false);
  });
  it("requires missing owner and an exact confirmed address", () => {
    const input = inputs()[0]; if (!input) throw new Error("Missing fixture");
    expect(noticeIssues({ ...input, owner: "" })).toContain("Property owner LLC or trust is required.");
    expect(noticeIssues({ ...input, tenant: { ...input.tenant, street: "", unit: "" } })).toContain("Exact street and unit are required.");
  });
  it("uses full dollar words and zero-padded cents, not total receivable", () => {
    expect(demandWords(2070)).toBe("Two thousand seventy and 00/100 dollars ($2,070.00)");
    expect(demandWords(2070.05)).toBe("Two thousand seventy and 05/100 dollars ($2,070.05)");
  });
  it("prints chosen date with ordinal", () => {
    expect(dateWording("2025-04-14")).toBe("DATED this 14th day of April , 2025");
    expect(dateWording("2026-11-21")).toBe("DATED this 21st day of November , 2026");
    expect(() => dateWording("2026-02-31")).toThrow();
  });
});

describe("office PDF and complete ZIP", () => {
  const heading = new Uint8Array(readFileSync("src/assets/five-day-heading.png"));
  it("makes exactly one unique sanitized PDF per selected row with Times fonts and letter geometry", async () => {
    const batch = await buildRentBatch(inputs(), heading);
    expect(batch.notices).toHaveLength(3);
    const zip = await JSZip.loadAsync(await batch.zip.arrayBuffer());
    const files = Object.keys(zip.files);
    expect(files).toHaveLength(3);
    expect(new Set(files.map((n) => n.toLowerCase())).size).toBe(3);
    expect(files.every((n) => /^[a-zA-Z0-9_-]+\.pdf$/.test(n))).toBe(true);
    const notice = batch.notices[0]; if (!notice) throw new Error("Missing PDF");
    const zipped = await zip.file(notice.filename)?.async("uint8array");
    expect(zipped).toEqual(notice.bytes);
    const pdf = await PDFDocument.load(notice.bytes);
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0); expect(page.getSize()).toEqual({ width: 612, height: 792 });
    const stream = page.node.Contents();
    const refs = stream && "asArray" in stream ? stream.asArray() : [];
    const operators = refs.map((ref) => {
      const obj = pdf.context.lookup(ref);
      return obj instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(obj).decode()) : "";
    }).join("\n");
    expect(operators).toContain("1 0 0 1 180 678 cm");
    expect(operators).toContain("252 0 0 44 0 0 cm");
    expect(operators).toContain("72 640.5 Tm"); // static TO baseline 151.5
    const resources = page.node.Resources();
    expect(resources?.get(PDFName.of("Font"))).toBeDefined();
    expect(FIVE_DAY_OFFICE_TEMPLATE.isDraft).toBe(false);
    const drawnText = [...operators.matchAll(/<([A-Fa-f0-9]+)> Tj/g)].map((m) => Buffer.from(m[1] ?? "", "hex").toString("latin1")).join("");
    expect(drawnText).toContain("Alex M. Example"); // TO: prints natural order, not raw "Example, Alex M."
    expect(drawnText).not.toContain("Example, Alex M.");
    expect(drawnText).toContain("Two thousand seventy and 05/100 dollars ($2,070.05)");
    expect(drawnText).not.toContain("$2,099.05");
    expect(drawnText).toContain("100-104 Test St - 106 Test St Unit #1, Chicago, IL 60601");
    expect(drawnText).toContain("DATED this 14th day of April , 2025");
    expect(drawnText).toContain("As an agent for Example Owner LLC");
    expect(operators).toMatch(/\/Times-Roman-\d+ 12 Tf/);
    expect(operators).toMatch(/\/Times-Bold-\d+ 12 Tf/);
  });
  it("rejects the entire ZIP when any selected row lacks owner", async () => {
    const list = inputs(); const second = list[1]; if (!second) throw new Error("Missing duplicate");
    list[1] = { ...second, owner: "" };
    await expect(buildRentBatch(list, heading)).rejects.toThrow("Property owner");
  });
  it("rejects all output if a later PDF cannot be encoded, rather than returning a partial ZIP", async () => {
    const list = inputs(); const last = list[2]; if (!last) throw new Error("Missing later row");
    list[2] = { ...last, tenant: { ...last.tenant, name: "Unsupported 😀" } };
    await expect(buildRentBatch(list, heading)).rejects.toThrow("encode");
  });
  it("wraps long names, addresses and owners without losing wording or making a second page", async () => {
    const input = inputs()[0]; if (!input) throw new Error("Missing fixture");
    const extended = { ...input, owner: "Example Property Ownership Trust with a long legal name", tenant: { ...input.tenant, name: "Example Alex and Example Jordan and Example Taylor and Example Casey and Example Morgan and Example Quinn", street: "100-104 Example Avenue and 106-110 Example Avenue and 112-118 Example Avenue", city: "Calumet Park" } };
    const generated = await buildRentBatch([extended], heading);
    const first = generated.notices[0]; if (!first) throw new Error("Missing extended notice");
    const pdf = await PDFDocument.load(first.bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(first.bytes.length).toBeGreaterThan(1000);
  });
});
  it("prints the TO: name in natural order only on the notice", () => {
    expect(noticeDisplayName("Stennis , Antonio")).toBe("Antonio Stennis");
    expect(noticeDisplayName("Rivera, Angel S.")).toBe("Angel S. Rivera");
    expect(noticeDisplayName("Garcia Lopez, Maria")).toBe("Maria Garcia Lopez");
    expect(noticeDisplayName("Smith Jr., John")).toBe("John Smith Jr.");
    expect(noticeDisplayName("O'Brien, Mary K")).toBe("Mary K O'Brien");
    // Natural order, organizations, and ambiguous strings stay untouched.
    expect(noticeDisplayName("Antonio Stennis")).toBe("Antonio Stennis");
    expect(noticeDisplayName("1200 W 127th LLC")).toBe("1200 W 127th LLC");
    expect(noticeDisplayName("Smith, John & Jane")).toBe("Smith, John & Jane");
    expect(noticeDisplayName("Smith and Wesson, Pat")).toBe("Smith and Wesson, Pat");
    expect(noticeDisplayName("Doe, John, Jr")).toBe("Doe, John, Jr");
    expect(noticeDisplayName("  Rivera,   Angel  ")).toBe("Angel Rivera");
  });
