import Papa from "papaparse";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { chicagoToday } from "./fiveDay";
import { formatLongDate } from "./dates";
import type { GeneratedNotice } from "./fiveDayPdf";

export const DIRECTORY_HEADERS = ["Property", "Unit", "Tenant", "Status", "Tenant Type", "Phone Numbers", "Emails", "Move-in", "Lease To", "Rent", "Deposit", "Tenant Tags"];
/** Only the columns the access notice needs are retained; contact and money columns are dropped at parse time. */
export interface DirectoryRow { id: string; property: string; unit: string; tenant: string; status: string; role: string }
export interface UnitGroup { key: string; propertyName: string; street: string; cityLine: string; unit: string; names: string[]; chicago: boolean }

const REQUIRED = ["Property", "Unit", "Tenant"] as const;
/** Columns are located by header name in any order; only Property, Unit and Tenant are required. */
export function parseTenantDirectory(text: string): DirectoryRow[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  if (parsed.errors.length) throw new Error(`CSV error on row ${(parsed.errors[0]?.row ?? 0) + 1}: ${parsed.errors[0]?.message}`);
  const [header, ...rows] = parsed.data;
  const names = (header ?? []).map((h) => (h ?? "").trim().toLowerCase());
  const col = (n: string) => names.indexOf(n.toLowerCase());
  const missing = REQUIRED.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  const [ip, iu, it, is, ir] = [col("Property"), col("Unit"), col("Tenant"), col("Status"), col("Tenant Type")];
  const get = (r: string[], i: number) => (i < 0 ? "" : (r[i] ?? "").trim());
  const out: DirectoryRow[] = [];
  rows.forEach((r, i) => {
    const tenant = get(r, it);
    if (!tenant) return; // blank spacer and trailing total rows carry no tenant
    out.push({ id: `t${i}`, property: get(r, ip), unit: get(r, iu), tenant, status: get(r, is), role: get(r, ir) });
  });
  if (!out.length) throw new Error("No tenant rows found in this directory.");
  return out;
}

/** Accepts "Name - Street City, ST ZIP" or a raw "Street City, ST ZIP". */
const addressPart = (property: string) => { const at = property.indexOf(" - "); return (at < 0 ? property : property.slice(at + 3)).trim(); };
export function splitProperty(property: string) {
  const at = property.indexOf(" - ");
  const name = at < 0 ? "" : property.slice(0, at).trim(), address = addressPart(property);
  const m = address.match(/^(.*?\S),?\s+((?:Blue Island|Calumet Park|Calumet City|Evergreen Park|Oak Lawn|Oak Park|[A-Za-z.]+),\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/);
  return { name, street: m ? m[1]!.replace(/,$/, "") : address, cityLine: m ? m[2]! : "" };
}

/** Strict municipality check for the Chicago-only template: the address must end in exactly
 * "<street> Chicago, IL <ZIP>". Directional/compound prefixes (West/North/East/South Chicago),
 * suffixes (Chicago Heights, Chicago Ridge) and anything unparseable fail closed. */
export function isChicagoAddress(property: string): boolean {
  const m = addressPart(property).match(/^(.*\S),?\s+Chicago,\s*IL\s+\d{5}(?:-\d{4})?$/);
  if (!m) return false;
  const prev = m[1]!.replace(/,$/, "").split(/\s+/).at(-1)?.toLowerCase() ?? "";
  return !!prev && !["west", "north", "east", "south", "new", "old", "of", "lake", "port"].includes(prev);
}
export const municipalityIssue = (g: UnitGroup) => !g.street ? `${g.names.join(" & ")}: property address is missing in the tenant directory; this notice cannot be generated.` : g.chicago ? "" :
  `${g.street}${g.unit ? `, Unit ${g.unit}` : ""}: municipality is not Chicago or could not be confirmed (${g.cityLine || "unknown"}). A municipality-specific office template is needed before this notice can be generated.`;

export function groupSelected(rows: DirectoryRow[], selected: Set<string>): UnitGroup[] {
  const groups = new Map<string, UnitGroup>();
  for (const r of rows) {
    if (!selected.has(r.id)) continue;
    // Records without a property never merge with each other.
    const key = r.property ? `${r.property}\u0000${r.unit}` : `missing\u0000${r.id}`;
    const p = splitProperty(r.property);
    const g = groups.get(key) ?? { key, propertyName: p.name, street: p.street, cityLine: p.cityLine, unit: r.unit, names: [], chicago: isChicagoAddress(r.property) };
    g.names.push(r.tenant); groups.set(key, g);
  }
  return [...groups.values()];
}

export const ACCESS_REASONS = [
  { id: "routine", label: "Routine inspection to assess compliance with lease or law", detail: false },
  { id: "repair", label: "Inspect and, if necessary, repair or replace", detail: true },
  { id: "estimate", label: "Inspect and get estimate for", detail: true },
  { id: "show", label: "Show premises to applicant/buyer", detail: true },
  { id: "other", label: "Other", detail: true },
] as const;
export type ReasonId = (typeof ACCESS_REASONS)[number]["id"];
export interface AccessDetails { dates: string[]; start: string; end: string; reason: ReasonId | ""; detail: string; agent: string; dated: string }

export function reasonText(d: AccessDetails): string {
  const r = ACCESS_REASONS.find((x) => x.id === d.reason);
  if (!r) return "";
  if (r.id === "other") return d.detail.trim();
  return d.detail.trim() && r.detail ? `${r.label} ${d.detail.trim()}` : r.label;
}
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T12:00:00`).getTime()) && new Date(`${s}T12:00:00`).toISOString().slice(0, 10) === s;
export function accessDetailIssues(d: AccessDetails): string[] {
  const issues: string[] = [];
  if (!d.dates.length) issues.push("Add at least one access date.");
  if (d.dates.some((x) => !validDate(x))) issues.push("Every access date must be a valid date.");
  if (new Set(d.dates).size !== d.dates.length) issues.push("Remove duplicate access dates.");
  if (!/^\d{2}:\d{2}$/.test(d.start) || !/^\d{2}:\d{2}$/.test(d.end)) issues.push("Enter a start and end time.");
  else if (d.end <= d.start) issues.push("End time must be after start time.");
  if (!d.reason) issues.push("Choose a reason for entry.");
  else if (d.reason === "other" && !d.detail.trim()) issues.push("Describe the reason for Other.");
  if (!d.agent.trim()) issues.push("Enter the landlord/agent name.");
  if (!validDate(d.dated)) issues.push("Enter a valid dated day.");
  return issues;
}
export function formatTime(t: string): string {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function wrap(text: string, font: PDFFont, width: number): string[] {
  const lines: string[] = []; let line = "";
  for (const word of text.split(/(\s+)/)) {
    if (line && font.widthOfTextAtSize((line + word).trimEnd(), 12) > width) { lines.push(line.trimEnd()); line = word.trimStart(); }
    else line += word;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [""];
}

/** Office 2 Day access notice sample wording (Chicago, Sec. 5-12-050), reproduced verbatim from the supplied sample; staff review it in the preview. */
export async function buildAccessPdf(g: UnitGroup, d: AccessDetails): Promise<Uint8Array> {
  const blocked = municipalityIssue(g); if (blocked) throw new Error(blocked);
  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let y = 100;
  const title = "ACCESS NOTICE";
  page.drawText(title, { x: 306 - bold.widthOfTextAtSize(title, 14) / 2, y: 792 - y, size: 14, font: bold });
  y += 40;
  const row = (label: string, values: string[]) => {
    page.drawText(label, { x: 72, y: 792 - y, size: 12, font: bold });
    for (const v of values) for (const l of wrap(v, regular, 340)) { page.drawText(l, { x: 200, y: 792 - y, size: 12, font: regular }); y += 15; }
    y += 12;
  };
  row("TO TENANTS:", g.names);
  row("ADDRESS:", [[g.street, g.unit ? `Unit ${g.unit}` : ""].filter(Boolean).join(", "), g.cityLine].filter(Boolean));
  const para = (text: string, font: PDFFont = regular) => { for (const l of wrap(text, font, 468)) { page.drawText(l, { x: 72, y: 792 - y, size: 12, font }); y += 15; } y += 12; };
  const dates = d.dates.map(formatLongDate);
  const dateText = dates.length > 1 ? `${dates.slice(0, -1).join(", ")} AND ${dates.at(-1)}` : (dates[0] ?? "");
  para(`THIS IS YOUR LEGAL 2 DAY ACCESS NOTICE PURSUANT TO THE MUNICIPAL CODE OF CHICAGO SEC. 5-12-050, TO INFORM YOU THAT I OR MY AGENT WILL REQUIRE ACCESS TO YOUR PREMISES ON ${dateText} BETWEEN THE HOURS ALLOWED BY LAW (8 AM TO 8 PM) OR BETWEEN ${formatTime(d.start)} AND ${formatTime(d.end)} FOR THE FOLLOWING REASONS:`);
  para(reasonText(d), bold);
  para("IF YOU ARE NOT PRESENT, WE WILL USE OUR KEY TO GAIN ACCESS. IF YOU HAVE ADDITIONAL SECURITY ON THE PREMISES AND WILL NOT BE PRESENT, PLEASE REMOVE THE SECURITY TO ALLOW ACCESS. THANK YOU FOR YOUR COOPERATION.");
  y += 40;
  page.drawText(`Dated: ${formatLongDate(d.dated)}`, { x: 72, y: 792 - y, size: 12, font: regular });
  page.drawText("By:", { x: 330, y: 792 - y, size: 12, font: regular });
  page.drawText(d.agent.trim(), { x: 355, y: 792 - y, size: 12, font: regular });
  page.drawLine({ start: { x: 352, y: 792 - y - 2 }, end: { x: 540, y: 792 - y - 2 }, thickness: 0.5 });
  page.drawText("LANDLORD/AGENT", { x: 355, y: 792 - y - 16, size: 12, font: bold });
  return doc.save();
}

export async function generateAccessBatch(groups: UnitGroup[], d: AccessDetails): Promise<GeneratedNotice[]> {
  if (!groups.length) throw new Error("Select at least one recipient.");
  const blocked = groups.map(municipalityIssue).filter(Boolean);
  if (blocked.length) throw new Error(blocked.join(" "));
  const issues = accessDetailIssues(d); if (issues.length) throw new Error(issues.join(" "));
  const used = new Set<string>(), out: GeneratedNotice[] = [];
  for (const g of groups) {
    const base = `Access_${g.street}${g.unit ? `_Unit_${g.unit}` : ""}`.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
    let name = `${base}.pdf`, n = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${n++}.pdf`;
    used.add(name.toLowerCase());
    out.push({ id: g.key, filename: name, bytes: await buildAccessPdf(g, d) });
  }
  return out;
}
export const defaultAccessDetails = (): AccessDetails => ({ dates: [], start: "", end: "", reason: "", detail: "", agent: "Aahil Penwalla", dated: chicagoToday() });

/** Minimized CSV for shared storage: exact directory header, but contact, lease and money columns left blank. */
export function minimizedDirectoryCsv(rows: DirectoryRow[]): string {
  return Papa.unparse({ fields: DIRECTORY_HEADERS, data: rows.map((r) => [r.property, r.unit, r.tenant, r.status, r.role, "", "", "", "", "", "", ""]) });
}
