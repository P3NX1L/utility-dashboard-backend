import Papa from "papaparse";
import { parseAmount } from "./numberToWords";

/** AppFolio exports personal names as "Last, First Middle". */
export function noticeTenantName(value: string): string {
  const name = value.trim();
  const parts = name.split(",").map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return name;
  if (/\b(?:llc|inc|corp|ltd|trust|llp)\b/i.test(name) || /^(?:jr|sr|ii|iii|iv)\.?$/i.test(parts[1])) return name;
  const given = parts[1].split(/\s+/).map((word, index) =>
    index > 0 && /^\p{L}$/u.test(word) ? word + "." : word
  );
  return [...given, parts[0]].join(" ");
}

export interface PropertyGroup { id: string; label: string; street: string; city: string; zip: string; owner: string; agent: string }
export interface RentTenant {
  id: string; propertyId: string; sourceRow: number; name: string; unit: string;
  street: string; city: string; zip: string; status: string; receivable: number | null;
  rent: number | null; other: number | null; selected: boolean;
}
export interface RentBatch { properties: PropertyGroup[]; tenants: RentTenant[] }
export interface NoticeInput { tenant: RentTenant; owner: string; agent: string; issueDate: string }

export function parseProperty(unit: string, id: string): PropertyGroup {
  const text = unit.replace(/^\s*->\s*/, "").trim();
  const split = text.indexOf(" - ");
  const label = split < 0 ? text : text.slice(0, split).trim();
  const address = split < 0 ? text : text.slice(split + 3).trim();
  const match = address.match(/^(.*?)\s*,?\s+(Calumet Park|Calumet City|Blue Island|Chicago)\s*,?\s*IL\s+(\d{5}(?:-\d{4})?)\s*$/i);
  return { id, label, street: match?.[1]?.replace(/,\s*$/, "").trim() ?? address, city: match?.[2] ?? "", zip: match?.[3] ?? "", owner: "", agent: "Aahil Penwalla" };
}

export function parseAppFolioCsv(text: string): RentBatch {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: "greedy" });
  const problem = result.errors[0];
  if (problem) throw new Error(`CSV row ${(problem.row ?? 0) + 1}: ${problem.message}`);
  const headerRow = result.data.findIndex((row) => row.some((v) => v.trim() === "Delinquent Rent") && row.some((v) => v.trim() === "Name"));
  const headers = result.data[headerRow];
  if (!headers) throw new Error("The report must contain Unit, Name, Tenant Status, Amount Receivable, Delinquent Rent and Delinquent other charges.");
  const keys = ["Unit", "Name", "Tenant Status", "Amount Receivable", "Delinquent Rent", "Delinquent other charges"];
  const indices = keys.map((key) => headers.findIndex((h) => h.trim().toLowerCase() === key.toLowerCase()));
  const missing = keys.filter((_, i) => (indices[i] ?? -1) < 0);
  if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
  const properties: PropertyGroup[] = [], tenants: RentTenant[] = [];
  let property: PropertyGroup | undefined;
  result.data.slice(headerRow + 1).forEach((row, offset) => {
    const get = (i: number) => row[indices[i] ?? -1]?.trim() ?? "";
    const unit = get(0), name = noticeTenantName(get(1));
    if (unit.startsWith("->")) {
      property = parseProperty(unit, `property-${properties.length + 1}`);
      properties.push(property);
      return;
    }
    if (!name) return; // blanks, property subtotals, and the final Total are not tenants
    if (!property) {
      property = { id: "ungrouped", label: "Unassigned property — confirm address", street: "", city: "", zip: "", owner: "", agent: "Aahil Penwalla" };
      properties.push(property);
    }
    const sourceRow = headerRow + offset + 2;
    tenants.push({ id: `tenant-${sourceRow}`, sourceRow, propertyId: property.id, name, unit,
      street: property.street, city: property.city, zip: property.zip, status: get(2),
      receivable: parseAmount(get(3)), rent: parseAmount(get(4)), other: parseAmount(get(5)), selected: false });
  });
  if (!tenants.length) throw new Error("No named tenant rows were found in this report.");
  return { properties, tenants };
}

export function selectedNoticeInputs(batch: RentBatch, issueDate: string): NoticeInput[] {
  return batch.tenants.filter((t) => t.selected).map((tenant) => {
    const property = batch.properties.find((p) => p.id === tenant.propertyId);
    return { tenant, owner: property?.owner ?? "", agent: property?.agent ?? "", issueDate };
  });
}

export function eligible(t: RentTenant): boolean { return t.rent !== null && t.rent > 0; }
export function chicagoToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dateWording(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) throw new Error("Choose a valid issue date.");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== iso) throw new Error("Choose a valid issue date.");
  const ordinal = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  const monthName = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `DATED this ${day}${ordinal} day of ${monthName} , ${year}`;
}
export function noticeIssues(input: NoticeInput): string[] {
  const { tenant: t, owner, agent, issueDate } = input;
  const issues: string[] = [];
  if (!eligible(t)) issues.push("Delinquent rent must be greater than zero.");
  if (!t.name.trim()) issues.push("Tenant display name is required.");
  if (!t.street.trim() || !t.unit.trim()) issues.push("Exact street and unit are required.");
  if (!["chicago", "blue island", "calumet park", "calumet city"].includes(t.city.trim().toLowerCase())) issues.push("Confirm a supported Cook County city.");
  if (!/^\d{5}(?:-\d{4})?$/.test(t.zip)) issues.push("A valid ZIP is required.");
  if (!owner.trim()) issues.push("Property owner LLC or trust is required.");
  if (!agent.trim()) issues.push("Printed agent is required.");
  try { dateWording(issueDate); } catch { issues.push("A valid issue date is required."); }
  return issues;
}

export function uniquePdfNames(inputs: NoticeInput[]): string[] {
  const used = new Set<string>();
  const sanitize = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "tenant";
  return inputs.map(({ tenant: t }) => {
    const base = `5-Day_${sanitize(t.name)}_${sanitize(t.street)}_Unit_${sanitize(t.unit)}`;
    let name = `${base}.pdf`, suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${suffix++}.pdf`;
    used.add(name.toLowerCase()); return name;
  });
}
/** Fill blank owners from the saved owner mapping, matching the report's property name (case-insensitive). */
export function applyOwnerDirectory(properties: PropertyGroup[], rows: { property_name: string; legal_owner: string }[]): PropertyGroup[] {
  const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const owners = new Map<string, string>();
  for (const r of rows) { owners.set(key(r.property_name), r.legal_owner); const short = r.property_name.split(" - ")[0]; if (short) { const k = key(short); if (!owners.has(k)) owners.set(k, r.legal_owner); } }
  return properties.map((p) => p.owner.trim() ? p : { ...p, owner: owners.get(key(p.label)) ?? "" });
}
