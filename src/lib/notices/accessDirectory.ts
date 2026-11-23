import Papa from "papaparse";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { chicagoToday } from "./fiveDay";
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

type Run = { text: string; u?: boolean | undefined };
const ordinal = (n: number) => { const s = ["TH", "ST", "ND", "RD"], v = n % 100; return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`; };
export function accessDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = new Date(y!, m! - 1, 1).toLocaleDateString("en-US", { month: "long" }).toUpperCase();
  return `${month} ${ordinal(d!)}, ${y}`;
}
export const accessDateList = (dates: string[]) => { const t = dates.map(accessDate); return t.length > 1 ? `${t.slice(0, -1).join(", ")} AND/OR ${t.at(-1)}` : (t[0] ?? ""); };
const mdy = (iso: string) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
const SIZE = 11;
/** Wraps underline-aware runs into lines; returns lines of merged runs. */
function wrapRuns(runs: Run[], font: PDFFont, first: number, rest: number): Run[][] {
  const toks: Run[] = [];
  for (const r of runs) for (const w of r.text.split(/(\s+)/)) if (w) toks.push({ text: /^\s+$/.test(w) ? " " : w, u: r.u });
  const lines: Run[][] = []; let line: Run[] = [], width = 0;
  for (const t of toks) {
    const max = lines.length ? rest : first;
    if (t.text === " ") { if (line.length) { line.push(t); width += font.widthOfTextAtSize(" ", SIZE); } continue; }
    const w = font.widthOfTextAtSize(t.text, SIZE);
    if (line.length && width + w > max) { while (line.at(-1)?.text === " ") line.pop(); lines.push(line); line = []; width = 0; }
    line.push(t); width += w;
  }
  while (line.at(-1)?.text === " ") line.pop();
  if (line.length) lines.push(line);
  return lines.map((l) => l.reduce<Run[]>((acc, t) => { const last = acc.at(-1); if (last && !!last.u === !!t.u) last.text += t.text; else acc.push({ ...t }); return acc; }, []));
}
function drawLine(page: PDFPage, font: PDFFont, line: Run[], x: number, top: number) {
  for (const r of line) {
    const w = font.widthOfTextAtSize(r.text, SIZE);
    page.drawText(r.text, { x, y: 792 - top, size: SIZE, font });
    if (r.u && r.text.trim()) page.drawLine({ start: { x, y: 792 - top - 1.5 }, end: { x: x + w, y: 792 - top - 1.5 }, thickness: 0.6 });
    x += w;
  }
}

/** Office "2 Day - ACCESS NOTICE" sample (Chicago, Sec. 5-12-050): 11pt Times bold, fixed sample baselines that shift down only when long values wrap. */
export async function buildAccessPdf(g: UnitGroup, d: AccessDetails): Promise<Uint8Array> {
  const blocked = municipalityIssue(g); if (blocked) throw new Error(blocked);
  const doc = await PDFDocument.create();
  const page: PDFPage = doc.addPage([612, 792]);
  const f = await doc.embedFont(StandardFonts.TimesRomanBold);
  const title = "2 Day - ACCESS NOTICE", tw = f.widthOfTextAtSize(title, SIZE);
  drawLine(page, f, [{ text: title, u: true }], 306 - tw / 2, 84);
  let y = 130;
  const labelled = (label: string, value: string) => {
    const lw = f.widthOfTextAtSize(label + " ", SIZE);
    const lines = wrapRuns([{ text: value }], f, 468 - lw, 468 - lw);
    lines.forEach((l, i) => { if (!i) drawLine(page, f, [{ text: label }], 72, y); drawLine(page, f, l, 72 + lw, y); y += 15; });
    y += 12;
  };
  labelled("TO TENANTS:", g.names.join(", "));
  labelled("ADDRESS:", [[g.street, g.unit ? `UNIT ${g.unit}` : ""].filter(Boolean).join(", "), g.cityLine].filter(Boolean).join(", "));
  let shift = Math.max(0, y - 186); // later blocks move down only if the header wrapped
  const body = wrapRuns([
    { text: "THIS IS YOUR LEGAL 2 DAY ACCESS NOTICE PURSUANT TO THE MUNICIPAL CODE OF CHICAGO SEC. 5-12-050, TO INFORM YOU THAT I OR MY AGENT WILL REQUIRE ACCESS TO YOUR PREMISES ON " },
    { text: accessDateList(d.dates), u: true }, { text: " BETWEEN THE HOURS ALLOWED BY LAW (8 AM TO 8 PM) OR BETWEEN " },
    { text: formatTime(d.start), u: true }, { text: " AND " }, { text: formatTime(d.end), u: true }, { text: " FOR THE FOLLOWING REASONS:" },
  ], f, 468, 468);
  const BODY = [211, 237, 262, 288, 313];
  body.forEach((l, i) => drawLine(page, f, l, 72, (BODY[i] ?? 313 + (i - 4) * 25.5) + shift));
  shift += Math.max(0, body.length - 5) * 25.5;
  const detail = d.detail.trim();
  const options: [ReasonId, string, boolean][] = [["routine", "ROUTINE INSPECTION TO ASSESS COMPLIANCE WITH LEASE OR LAW", false], ["repair", "INSPECT AND, IF NECESSARY, REPAIR OR REPLACE:", true], ["estimate", "INSPECT AND GET ESTIMATE FOR:", true], ["show", "TO SHOW PREMISES TO APPLICANT/BUYER:", true], ["other", "OTHER:", true]];
  options.forEach(([id, label, blank], i) => {
    const top = 340 + i * 27 + shift, on = d.reason === id;
    page.drawRectangle({ x: 72, y: 792 - top - 1, width: 9, height: 9, borderWidth: 0.8, borderColor: rgb(0, 0, 0) });
    if (on) { page.drawLine({ start: { x: 73.5, y: 792 - top + 0.5 }, end: { x: 79.5, y: 792 - top + 6.5 }, thickness: 1 }); page.drawLine({ start: { x: 73.5, y: 792 - top + 6.5 }, end: { x: 79.5, y: 792 - top + 0.5 }, thickness: 1 }); }
    const lw = f.widthOfTextAtSize(label + " ", SIZE);
    drawLine(page, f, [{ text: label }], 90, top);
    if (!blank) return;
    const value = on ? detail : "";
    const lines = value ? wrapRuns([{ text: value.toUpperCase() }], f, 450 - lw, 450) : [];
    if (!lines.length) { page.drawLine({ start: { x: 90 + lw, y: 792 - top - 1.5 }, end: { x: 540, y: 792 - top - 1.5 }, thickness: 0.6 }); return; }
    lines.forEach((l, j) => drawLine(page, f, l.map((r) => ({ ...r, u: true })), j ? 90 : 90 + lw, top + j * 15));
    shift += (lines.length - 1) * 15;
  });
  const key = wrapRuns([{ text: "IF YOU ARE NOT PRESENT, WE WILL USE OUR KEY TO GAIN ACCESS. IF YOU HAVE ADDITIONAL SECURITY ON THE PREMISES AND WILL NOT BE PRESENT, PLEASE REMOVE THE SECURITY TO ALLOW ACCESS. THANK YOU FOR YOUR COOPERATION." }], f, 468, 450);
  key.forEach((l, i) => drawLine(page, f, l, i ? 90 : 72, 473 + i * 25 + shift));
  const sig = Math.max(650, 473 + key.length * 25 + shift + 50);
  drawLine(page, f, [{ text: `DATED: ${mdy(d.dated)}` }], 72, sig);
  const agent = wrapRuns([{ text: d.agent.trim() }], f, 180, 180);
  drawLine(page, f, [{ text: "By:" }], 330, sig);
  agent.forEach((l, i) => drawLine(page, f, l, 355, sig + i * 14));
  const lineY = sig + (agent.length - 1) * 14 + 2;
  page.drawLine({ start: { x: 352, y: 792 - lineY }, end: { x: 540, y: 792 - lineY }, thickness: 0.6 });
  drawLine(page, f, [{ text: "LANDLORD/AGENT" }], 355, lineY + 14);
  return doc.save();
}

export async function generateAccessBatch(groups: UnitGroup[], d: AccessDetails): Promise<GeneratedNotice[]> {
  if (groups.length !== 1 || groups[0]?.names.length !== 1) {
    throw new Error("Choose exactly one tenant for this access notice.");
  }
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
