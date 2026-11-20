import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";
import { ExportSessionProvider } from "@/components/notices/ExportSession";
import type { GeneratedBatch } from "@/lib/notices/fiveDayPdf";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notices/fiveDayPdf", () => ({ buildSingleRentNotice: generate }));
vi.mock("@/components/notices/OfficePdfPreview", async () => {
  const { useEffect } = await import("react");
  return { default: ({ id, onRendered }: { id: string; onRendered: (id: string) => void }) => {
    useEffect(() => { onRendered(id); }, [id, onRendered]); return null;
  } };
});
const csv = 'Unit,Name,Tenant Status,Amount Receivable,Delinquent Rent,Delinquent other charges\n"-> Test - 1 Test St Chicago, IL 60601",,,,,\nA,"Example, Alex",Current,2100,2070,30';
const result: GeneratedBatch = { notices: [{ id: "tenant-3", filename: "example.pdf", bytes: new Uint8Array([1]) }], zip: new Blob(["synthetic"]) };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function prepare() {
  render(<ExportSessionProvider userId="synthetic-staff"><RentNoticeWorkspace /></ExportSessionProvider>);
  const file = new File([csv], "synthetic.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => csv });
  fireEvent.change(screen.getByLabelText("Upload AppFolio CSV"), { target: { files: [file] } });
  await screen.findByRole("radio");
  fireEvent.click(screen.getByRole("radio"));
  fireEvent.change(screen.getByLabelText("Owner for Test"), { target: { value: "Example Trust" } });
  fireEvent.change(screen.getByLabelText("Issue date"), { target: { value: "2025-04-14" } });
}

describe("Notice revision safety", () => {
  it("clears completed output after an owner, agent, date, tenant, or selection change", async () => {
    generate.mockResolvedValue(result);
    await prepare();
    const edits = [
      () => fireEvent.change(screen.getByLabelText("Owner for Test"), { target: { value: "Different Trust" } }),
      () => fireEvent.change(screen.getByLabelText("Printed agent for Test"), { target: { value: "Different Agent" } }),
      () => fireEvent.change(screen.getByLabelText("Issue date"), { target: { value: "2025-04-15" } }),
      () => fireEvent.change(screen.getByLabelText("Exact street"), { target: { value: "2 Test St" } }),
    ];
    for (const edit of edits) {
      fireEvent.click(screen.getByRole("button", { name: "Generate & preview 1 notice" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Save notice to Exports" })).toBeEnabled());
      edit();
      expect(screen.queryByRole("button", { name: /Save notice to Exports/ })).toBeNull();
    }
  });
  it("discards in-flight output if a field changes while generation is running", async () => {
    let finish: ((batch: GeneratedBatch) => void) | undefined;
    generate.mockImplementation(() => new Promise<GeneratedBatch>((resolve) => { finish = resolve; }));
    await prepare();
    fireEvent.click(screen.getByRole("button", { name: "Generate & preview 1 notice" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Printed agent for Test"), { target: { value: "Changed During Generation" } });
    await act(async () => { finish?.(result); });
    expect(screen.queryByRole("button", { name: /Save notice to Exports/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Generate & preview 1 notice" })).toBeEnabled();
  });
});