import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared, staff-only source uploads in the existing First Western project (schema is managed outside this repo). */
export type SharedKind = "delinquency" | "tenant_directory";
export interface SharedReport { filename: string; csv: string; revision: string }
export class StaffDeniedError extends Error { constructor() { super("Your account is not on the notice desk staff list. Ask an administrator for access."); } }
export class ReportConflictError extends Error { constructor() { super("Another staff member updated this report since you loaded it. Reload the page to get the latest version, then try again."); } }

type Client = Pick<SupabaseClient, "from" | "rpc" | "auth">;
export async function requireStaff(client: Client | null): Promise<string> {
  if (!client) throw new Error("Sign in to load shared reports.");
  const { data: auth } = await client.auth.getUser();
  const id = auth.user?.id;
  if (!id) throw new StaffDeniedError();
  const { data, error } = await client.from("notice_desk_staff").select("user_id").eq("user_id", id).maybeSingle();
  if (error || !data) throw new StaffDeniedError();
  return id;
}
export async function readSharedReport(client: Client | null, kind: SharedKind): Promise<SharedReport | null> {
  await requireStaff(client);
  const { data, error } = await client!.from("notice_shared_reports").select("filename,csv_text,revision").eq("kind", kind).maybeSingle();
  if (error) throw new Error("The shared report could not be loaded. Try refreshing.");
  if (!data) return null;
  const row = data as { filename: string; csv_text: string; revision: string };
  return { filename: row.filename, csv: row.csv_text, revision: row.revision };
}
/** Saves only after the caller has parsed the CSV; `expected` is the revision loaded (null for the first upload). */
export async function saveSharedReport(client: Client | null, kind: SharedKind, filename: string, csv: string, expected: string | null): Promise<string> {
  await requireStaff(client);
  const { data, error } = await client!.rpc("replace_notice_shared_report", { p_kind: kind, p_filename: filename, p_csv: csv, p_expected: expected });
  if (error) {
    if (error.code === "40001" || /conflict|revision|stale|expected/i.test(error.message ?? "")) throw new ReportConflictError();
    if (error.code === "42501" || /permission|denied|staff/i.test(error.message ?? "")) throw new StaffDeniedError();
    throw new Error("The report could not be saved. The previous shared report is unchanged.");
  }
  if (typeof data !== "string" || !data) throw new Error("The report could not be saved. The previous shared report is unchanged.");
  return data;
}
