import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LegalOwnerRow { property_name: string; legal_owner: string }
const nameKey = (name: string) => name.toLowerCase();
export const sortDirectory = (rows: LegalOwnerRow[]) => [...rows].sort((a, b) =>
  a.property_name < b.property_name ? -1 : a.property_name > b.property_name ? 1 : 0);

export function parsePropertyDirectory(text: string): LegalOwnerRow[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
  if (parsed.errors.length) {
    const first = parsed.errors[0];
    throw new Error(`CSV error on row ${(first?.row ?? 0) + 1}: ${first?.message ?? "Invalid CSV"}`);
  }
  const lines = parsed.data;
  const headers = lines[0]?.map((header) => header.trim()) ?? [];
  const propertyIndex = headers.indexOf("Property"), ownerIndex = headers.indexOf("Portfolio");
  if (propertyIndex < 0 || ownerIndex < 0 || headers.filter((h) => h === "Property").length !== 1 || headers.filter((h) => h === "Portfolio").length !== 1)
    throw new Error("CSV must contain exactly one Property column and one Portfolio column.");
  const rows: LegalOwnerRow[] = [], names = new Set<string>();
  let lastRow = lines.length - 1;
  while (lastRow > 0) {
    const row = lines[lastRow];
    if (row && !(row.length === 1 && !row[0]?.trim())) break;
    lastRow--;
  }
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row || (row.length === 1 && !row[0]?.trim())) continue;
    if (row.length !== headers.length) throw new Error(`Row ${i + 1}: expected ${headers.length} columns, found ${row.length}.`);
    const property_name = row[propertyIndex]?.trim() ?? "", legal_owner = row[ownerIndex]?.trim() ?? "";
    // Only the exact final AppFolio Total footer is omitted. All malformed records fail the import.
    if (row[propertyIndex] === "Total" && !legal_owner && i === lastRow) continue;
    if (!property_name || !legal_owner) throw new Error(`Row ${i + 1}: Property and Portfolio must both be filled in.`);
    if (names.has(nameKey(property_name))) throw new Error(`Row ${i + 1}: duplicate property name "${property_name}" (case-insensitive).`);
    names.add(nameKey(property_name)); rows.push({ property_name, legal_owner });
  }
  if (!rows.length) throw new Error("The CSV contains no valid properties.");
  return sortDirectory(rows);
}

export async function readPropertyDirectoryFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Please upload a .csv property directory.");
  return parsePropertyDirectory(await file.text());
}

export interface DirectoryChange { type: "Add" | "Edit" | "Delete"; property: string; before: string; after: string }
export function diffDirectory(current: LegalOwnerRow[], incoming: LegalOwnerRow[]): DirectoryChange[] {
  const old = new Map(current.map((row) => [nameKey(row.property_name), row]));
  const next = new Map(incoming.map((row) => [nameKey(row.property_name), row]));
  const changes: DirectoryChange[] = [];
  for (const row of incoming) {
    const previous = old.get(nameKey(row.property_name));
    if (!previous) changes.push({ type: "Add", property: row.property_name, before: "", after: row.legal_owner });
    else if (previous.legal_owner !== row.legal_owner || previous.property_name !== row.property_name)
      changes.push({ type: "Edit", property: row.property_name, before: `${previous.property_name} — ${previous.legal_owner}`, after: `${row.property_name} — ${row.legal_owner}` });
  }
  for (const row of current) if (!next.has(nameKey(row.property_name))) changes.push({ type: "Delete", property: row.property_name, before: row.legal_owner, after: "" });
  return changes;
}

export async function readLegalOwnerDirectory(client: SupabaseClient): Promise<LegalOwnerRow[]> {
  const rows: LegalOwnerRow[] = [], pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("notice_legal_owner_mapping")
      .select("property_name,legal_owner").order("property_name", { ascending: true }).order("legal_owner", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error("The property directory could not be read.");
    for (const row of data) {
      if (typeof row["property_name"] !== "string" || typeof row["legal_owner"] !== "string") throw new Error("The directory contains an invalid property or owner.");
      rows.push({ property_name: row["property_name"], legal_owner: row["legal_owner"] });
    }
    if (data.length < pageSize) return rows;
  }
}

export async function replaceLegalOwnerDirectory(client: SupabaseClient, directory: LegalOwnerRow[], expected_directory: LegalOwnerRow[]) {
  const { data, error } = await client.rpc("replace_notice_legal_owner_mapping", { directory, expected_directory });
  if (error) throw error;
  if (!Number.isInteger(data) || typeof data !== "number") throw new Error("Replacement returned an unexpected result. Refresh the directory before trying again.");
  return data;
}

export function isDirectoryConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string; details?: string };
  return value.code === "40001" || /conflict|changed|stale|concurrent|snapshot/i.test(`${value.message ?? ""} ${value.details ?? ""}`);
}