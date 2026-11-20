import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LegalOwnerMapping } from "@/components/notices/LegalOwnerMapping";
import { ExportSessionProvider } from "@/components/notices/ExportSession";
const mocks = vi.hoisted(() => ({ read: vi.fn(), replace: vi.fn(), parse: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabase: () => ({}) }));
vi.mock("@/lib/notices/legalOwnerMapping", async (original) => ({ ...await original<typeof import("@/lib/notices/legalOwnerMapping")>(), readLegalOwnerDirectory: mocks.read, replaceLegalOwnerDirectory: mocks.replace, readPropertyDirectoryFile: mocks.parse }));
const oldRows = [{ property_name: "North", legal_owner: "Old LLC" }, { property_name: "Removed", legal_owner: "Old Trust" }];
const newRows = [{ property_name: "North", legal_owner: "New LLC" }, { property_name: "Added", legal_owner: "New Trust" }];
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue(oldRows); mocks.parse.mockResolvedValue(newRows); });
afterEach(cleanup);
async function open() {
  render(<ExportSessionProvider userId="synthetic-staff"><LegalOwnerMapping /></ExportSessionProvider>);
  await screen.findByText("Old LLC");
}
function upload() { fireEvent.change(screen.getByLabelText("Upload property directory CSV"), { target: { files: [new File(["synthetic"], "synthetic.csv")] } }); }
it("requires explicit Apply, permits Cancel, and sends the full unfiltered snapshot", async () => {
  await open();
  fireEvent.change(screen.getByLabelText("Search properties and legal owners"), { target: { value: "North" } });
  upload();
  await screen.findByText("Review replacement");
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.replace).not.toHaveBeenCalled();
  upload(); await screen.findByText("Review replacement");
  mocks.replace.mockResolvedValue(2); mocks.read.mockResolvedValue(newRows);
  fireEvent.click(screen.getByRole("button", { name: "Apply replacement" }));
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith({}, newRows, oldRows));
  await screen.findByText("Directory replaced: 2 properties.");
});
it("allows a no-op preview without any replacement", async () => {
  await open(); mocks.parse.mockResolvedValue([...oldRows].reverse()); upload();
  await screen.findByText("No changes.");
  expect(screen.getByRole("button", { name: "Apply replacement" })).toBeDisabled();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("retains the original directory after an invalid CSV", async () => {
  await open(); mocks.parse.mockRejectedValue(new Error("Row 3: missing owner")); upload();
  await screen.findByRole("alert");
  expect(screen.getByText("Old LLC")).toBeVisible();
  expect(screen.queryByText("Review replacement")).toBeNull();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it("discards stale preview and reloads after a transactional conflict", async () => {
  await open(); upload(); await screen.findByText("Review replacement");
  mocks.replace.mockRejectedValue({ code: "40001", message: "Directory changed" });
  mocks.read.mockResolvedValue([{ property_name: "Current", legal_owner: "Latest LLC" }]);
  fireEvent.click(screen.getByRole("button", { name: "Apply replacement" }));
  await screen.findByText("Latest LLC");
  expect(screen.getByRole("alert")).toHaveTextContent("directory changed");
  expect(screen.queryByText("Review replacement")).toBeNull();
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it("does not read the external directory in the development demo", async () => {
  render(<ExportSessionProvider userId="dev-only"><LegalOwnerMapping /></ExportSessionProvider>);
  await screen.findByRole("alert");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Upload property directory" })).toBeDisabled();
});