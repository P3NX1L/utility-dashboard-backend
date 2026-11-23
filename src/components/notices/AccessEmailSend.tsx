import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";
import type { ExportRecord } from "@/lib/notices/exports";

const worker = "https://first-western-notice-mail.onrender.com";
type Step = "login" | "verification" | "connected" | "review" | "submitted" | "unknown";

async function call(action: string, data: Record<string, unknown>) {
  const auth = await getSupabase()?.auth.getSession();
  const token = auth?.data.session?.access_token;
  if (!token) throw new Error("Sign in to Notice Desk to continue.");
  const response = await fetch(worker + "/" + action, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "The email service is unavailable.");
  return result as { ticket: string; state: Step; recipient?: string };
}

async function encodePdf(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function AccessEmailSend({ row }: { row: ExportRecord }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"confirm" | "login" | "verification" | "submitted" | "unknown">("confirm");
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
    if (locked.current || !row.accessEmail || row.count !== 1 || (step !== "login" && step !== "verification")) return;
    locked.current = true;
    setBusy(true);
    setError("");
    let submitting = false;
    try {
      const fields = new FormData(e.currentTarget);
      e.currentTarget.reset();
      const auth = step === "login"
        ? await call("login", { email: fields.get("email"), password: fields.get("password") })
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
      <DialogTitle className="text-base">{step === "confirm" ? `Send access notice to ${row.tenants[0]}?` : step === "unknown" ? "Check AppFolio email history" : step === "verification" ? "Verify your AppFolio login" : "Sign in to AppFolio to send"}</DialogTitle>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {step === "confirm" && <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => changeOpen(false)}>Cancel</Button>
        <Button onClick={() => { setError(""); setStep("login"); }}>Send</Button>
      </div>}
      {(step === "login" || step === "verification") && <form onSubmit={authenticateAndSend} className="space-y-3">
        {step === "login" ? <>
          <label className="block text-sm">AppFolio email<Input name="email" type="email" required /></label>
          <label className="block text-sm">Password<Input name="password" type="password" required /></label>
        </> : <label className="block text-sm">Verification code<Input name="code" autoComplete="one-time-code" required /></label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Working…" : step === "login" ? "Sign in and send" : "Verify and send"}</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}
