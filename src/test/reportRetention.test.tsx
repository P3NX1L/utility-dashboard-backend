import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";
import { ExportSessionProvider } from "@/components/notices/ExportSession";
import { readReportSource, saveReportSource } from "@/lib/notices/reportSource";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
const directory = vi.hoisted(() => ({ owner: "Current Synthetic LLC" }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
vi.mock("@/lib/notices/legalOwnerMapping", () => ({ readLegalOwnerDirectory: async () => [{ property_name: "Test", legal_owner: directory.owner }] }));
const csv = 'Unit,Name,Tenant Status,Amount Receivable,Delinquent Rent,Delinquent other charges\n"-> Test - 1 Test St Chicago, IL 60601",,,,,\nA,"Synthetic, Alex",Current,100,100,0';
const replacement = csv.replace("Synthetic, Alex", "Synthetic, Sam");
const shell = (userId: string) => <ExportSessionProvider userId={userId}><RentNoticeWorkspace /></ExportSessionProvider>;
function upload(text: string, filename = "synthetic.csv") {
  const file = new File([text], filename, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Upload AppFolio CSV"), { target: { files: [file] } });
}
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); directory.owner = "Current Synthetic LLC"; });
afterEach(cleanup);

describe("account-scoped delinquency source", () => {
  it("restores source only on remount and reapplies the current owner directory", async () => {
    const view = render(shell("a"));
    upload(csv);
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.change(screen.getByLabelText("Tenant display name"), { target: { value: "Unsaved draft" } });
    fireEvent.change(screen.getByLabelText("Owner for Test"), { target: { value: "Draft LLC" } });
    expect(await readReportSource("a")).toEqual({ userId: "a", filename: "synthetic.csv", csv });
    view.unmount(); directory.owner = "Updated Synthetic LLC";
    render(shell("a"));
    expect(await screen.findByRole("radio", { name: /Synthetic, Alex/ })).not.toBeChecked();
    expect(screen.queryByLabelText("Tenant display name")).toBeNull();
    expect(screen.queryByRole("region", { name: "Generated 5-Day notice preview" })).toBeNull();
    fireEvent.click(screen.getByRole("radio"));
    expect(screen.getByLabelText("Owner for Test")).toHaveValue("Updated Synthetic LLC");
  });
  it("valid replacement persists while malformed, empty, wrong-type and cancelled replacements retain the previous report", async () => {
    render(shell("a")); upload(csv); await screen.findByRole("radio");
    upload(replacement, "updated.csv");
    await screen.findByRole("radio", { name: /Synthetic, Sam/ });
    for (const [text, filename] of [["", "empty.csv"], ['"broken', "bad.csv"], [replacement, "wrong.txt"]]) {
      upload(text ?? "", filename);
      await screen.findByRole("alert");
      await waitFor(() => expect(screen.getByRole("button", { name: "Update Delinquency" })).toBeEnabled());
      expect(screen.getByRole("radio", { name: /Synthetic, Sam/ })).not.toBeChecked();
      expect((await readReportSource("a"))?.filename).toBe("updated.csv");
    }
    fireEvent.change(screen.getByLabelText("Upload AppFolio CSV"), { target: { files: [] } });
    expect((await readReportSource("a"))?.csv).toBe(replacement);
  });
  it("clears visible state across accounts and restores the right report on sign-back-in", async () => {
    const view = render(shell("a")); upload(csv); await screen.findByRole("radio");
    view.rerender(shell("b"));
    expect(screen.queryByRole("radio")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Restoring saved report…")).toBeNull());
    expect(await readReportSource("b")).toBeNull();
    upload(replacement); await screen.findByRole("radio", { name: /Synthetic, Sam/ });
    view.rerender(shell("a"));
    expect(await screen.findByRole("radio", { name: /Synthetic, Alex/ })).not.toBeChecked();
  });
  it("ignores an upload completing after the account switches", async () => {
    const view = render(shell("a"));
    let finish: ((text: string) => void) | undefined;
    const file = new File([csv], "delayed.csv");
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { finish = resolve; }) });
    fireEvent.change(screen.getByLabelText("Upload AppFolio CSV"), { target: { files: [file] } });
    view.rerender(shell("b"));
    await act(async () => { finish?.(csv); });
    await waitFor(() => expect(screen.queryByText("Restoring saved report…")).toBeNull());
    expect(screen.queryByRole("radio")).toBeNull();
    expect(await readReportSource("a")).toBeNull();
    expect(await readReportSource("b")).toBeNull();
  });
  it("does not let a pending restore override a new upload", async () => {
    await saveReportSource("a", "old.csv", csv, new AbortController().signal);
    render(shell("a")); upload(replacement, "new.csv");
    await screen.findByRole("radio", { name: /Synthetic, Sam/ });
    expect((await readReportSource("a"))?.filename).toBe("new.csv");
  });
  it("aborted atomic writes preserve the previous source", async () => {
    await saveReportSource("a", "old.csv", csv, new AbortController().signal);
    const controller = new AbortController(); controller.abort();
    await expect(saveReportSource("a", "new.csv", replacement, controller.signal)).rejects.toThrow("previous report has not been replaced");
    expect((await readReportSource("a"))?.csv).toBe(csv);
  });
  it("storage failure preserves the visible report and the persisted previous source", async () => {
    render(shell("a")); upload(csv); await screen.findByRole("radio");
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => { throw new Error("Storage quota exceeded"); });
    upload(replacement);
    expect(await screen.findByRole("alert")).toHaveTextContent("Check browser storage space");
    expect(screen.getByRole("radio", { name: /Synthetic, Alex/ })).toBeInTheDocument();
    transaction.mockRestore();
    expect((await readReportSource("a"))?.csv).toBe(csv);
  });
});