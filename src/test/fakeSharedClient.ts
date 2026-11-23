/** In-memory stand-in for the shared staff report tables and RPC (synthetic data only). */
export function sharedServer(staff: string[]) {
  const reports = new Map<string, { filename: string; csv_text: string; revision: string }>();
  let n = 0, failNext = false;
  const client = (uid: string) => ({
    auth: { getUser: async () => ({ data: { user: { id: uid } } }) },
    from: (table: string) => ({ select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: async () => {
      if (table === "notice_desk_staff") return { data: staff.includes(v) && v === uid ? { user_id: v } : null, error: null };
      return staff.includes(uid) ? { data: reports.get(v) ?? null, error: null } : { data: null, error: null };
    } }) }) }),
    rpc: async (_fn: string, a: { p_kind: string; p_filename: string; p_csv: string; p_expected: string | null }) => {
      if (!staff.includes(uid)) return { data: null, error: { code: "42501", message: "permission denied" } };
      if (failNext) { failNext = false; return { data: null, error: { code: "XX000", message: "boom" } }; }
      if ((reports.get(a.p_kind)?.revision ?? null) !== a.p_expected) return { data: null, error: { code: "40001", message: "revision conflict" } };
      const revision = `r${++n}`; reports.set(a.p_kind, { filename: a.p_filename, csv_text: a.p_csv, revision }); return { data: revision, error: null };
    },
  });
  return { reports, client, failOnce: () => { failNext = true; } };
}
