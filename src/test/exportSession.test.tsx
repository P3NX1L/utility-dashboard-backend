import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportHistory } from "@/components/notices/ExportHistory";
import { ExportSessionProvider } from "@/components/notices/ExportSession";
import { AuthGate } from "@/components/notices/AuthGate";
import type { ExportRecord } from "@/lib/notices/exports";
import type { Session } from "@supabase/supabase-js";
const mock = vi.hoisted(() => ({ list: vi.fn(), user: vi.fn(), session: vi.fn(), change: undefined as ((event: string, session: Session | null) => void) | undefined }));
vi.mock("@/lib/notices/exports", () => ({ listExports: mock.list, downloadExport: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabaseConfigured: true, allowDemoWithoutAuth: false, getSupabase: () => ({ auth: {
  onAuthStateChange: (cb: typeof mock.change) => { mock.change = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
  getUser: mock.user, getSession: mock.session, signOut: vi.fn(),
} }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function record(userId: string): ExportRecord { return { id: "one", userId, kind: "five-day", createdAt: "2026-11-20T17:00:00Z", tenants: ["Synthetic " + userId], count: 1, filename: userId + ".pdf", blob: new Blob(["%PDF-"], { type: "application/pdf" }) }; }
function session(id: string) { return { user: { id, email: id + "@example.invalid" } } as Session; }
describe("session history isolation", () => {
  it("clears displayed history when the account changes and ignores late old-account reads", async () => {
    let finish: ((rows: ExportRecord[]) => void) | undefined;
    mock.list.mockImplementation((userId: string) => userId === "a" ? new Promise<ExportRecord[]>((resolve) => { finish = resolve; }) : Promise.resolve([record("b")]));
    const view = render(<ExportSessionProvider key="a" userId="a"><ExportHistory kind="five-day" /></ExportSessionProvider>);
    await waitFor(() => expect(mock.list).toHaveBeenCalledWith("a", "five-day"));
    view.rerender(<ExportSessionProvider key="b" userId="b"><ExportHistory kind="five-day" /></ExportSessionProvider>);
    await screen.findByText("Synthetic b");
    await act(async () => { finish?.([record("a")]); });
    expect(screen.queryByText("Synthetic a")).toBeNull(); expect(screen.getByText("Synthetic b")).toBeVisible();
  });
  it("does not restore an old account after a session switch during initial verification", async () => {
    let finish: ((value: { data: { user: { id: string } } }) => void) | undefined;
    mock.user.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mock.session.mockResolvedValue({ data: { session: session("a") } });
    render(<AuthGate>{({ userId }) => <div>{userId}</div>}</AuthGate>);
    await act(async () => { mock.change?.("SIGNED_IN", session("b")); });
    expect(screen.getByText("b")).toBeVisible();
    await act(async () => { finish?.({ data: { user: { id: "a" } } }); });
    expect(screen.queryByText("a")).toBeNull(); expect(screen.getByText("b")).toBeVisible();
    await act(async () => { mock.change?.("SIGNED_OUT", null); });
    expect(screen.queryByText("b")).toBeNull(); expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
