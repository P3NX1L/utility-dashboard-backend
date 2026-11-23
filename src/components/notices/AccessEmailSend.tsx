import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/notices/appfolioWorker";
import type { ExportRecord } from "@/lib/notices/exports";

async function encodePdf(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function AccessEmailSend({ row }: { row: ExportRecord }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"confirm" | "verification" | "submitted" | "unknown">("confirm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ticket = useRef("");
  const locked = useRef(false);

  function changeOpen(next: boolean) {
    if (locked.current) return;
    if (!next && ticket.current) {
      void call("cancel", { ticket: ticket.current }).catch(() => {});
      ticket.current = "";
    }
    if (!next && step !== "submitted" && step !== "unknown") setStep("confirm");
    setError("");
    setOpen(next);
  }

  async function authenticateAndSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked.current || !row.accessEmail || row.count !== 1 || (step !== "confirm" && step !== "verification")) return;
    locked.current = true;
    setBusy(true);
    setError("");
    let submitting = false;
    try {
      const fields = new FormData(e.currentTarget);
      e.currentTarget.reset();
      const auth = step === "confirm"
        ? await call("login", {})
        : await call("verify", { ticket: ticket.current, code: fields.get("code") });
      ticket.current = auth.ticket;
      if (auth.state === "verification") {
        setStep("verification");
        return;
      }
      if (auth.state !== "connected") throw new Error("Could not connect to AppFolio.");
      const ready = await call("prepare", { ...row.accessEmail, ticket: ticket.current, exportId: row.id,
        tenant: row.tenants[0], filename: row.filename, pdf: await encodePdf(row.blob) });
      if (ready.state !== "review" || !ready.recipient) throw new Error("Could not verify the recipient.");
      submitting = true;
      const result = await call("send", { ticket: ticket.current });
      if (result.state !== "submitted") throw new Error("Submission could not be confirmed.");
      ticket.current = "";
      setStep("submitted");
      setOpen(false);
    } catch (err) {
      if (ticket.current) void call("cancel", { ticket: ticket.current }).catch(() => {});
      ticket.current = "";
      setError(err instanceof Error ? err.message : "AppFolio could not complete this step.");
      setStep(submitting ? "unknown" : "confirm");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm" disabled={step === "submitted"}>{step === "submitted" ? "Submitted" : "Email"}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
      <DialogTitle className="text-base">{step === "unknown" ? "Check AppFolio email history" : step === "verification" ? "AppFolio verification" : "Access Notice"}</DialogTitle>
      {step === "confirm" && row.accessEmail && <div className="space-y-3 text-sm">
        <p>{row.tenants[0]} · {row.accessEmail.address}</p>
        {row.accessEmail.subject !== "Access Notice" && <strong>{row.accessEmail.subject}</strong>}
        <p className="whitespace-pre-wrap">{row.accessEmail.body}</p>
        <p className="break-words">Attachment: {row.filename}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(step === "confirm" || step === "verification") && <form onSubmit={authenticateAndSend} className="space-y-3">
        {step === "verification" && <label className="block text-sm">Verification code<Input name="code" autoComplete="one-time-code" required /></label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Working…" : "Send"}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}
