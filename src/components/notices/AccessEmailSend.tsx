import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
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
  const [step, setStep] = useState<Step>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recipient, setRecipient] = useState("");
  const ticket = useRef("");
  const locked = useRef(false);

  async function advance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (locked.current || !row.accessEmail || row.count !== 1 || step === "submitted" || step === "unknown") return;
    locked.current = true;
    setBusy(true);
    setError("");
    const form = e.currentTarget;
    const fields = new FormData(form);
    form.reset();
    try {
      let result;
      if (step === "login") result = await call("login", { email: fields.get("email"), password: fields.get("password") });
      else if (step === "verification") result = await call("verify", { ticket: ticket.current, code: fields.get("code") });
      else if (step === "connected") {
        result = await call("prepare", { ...row.accessEmail, ticket: ticket.current, exportId: row.id, tenant: row.tenants[0],
          filename: row.filename, pdf: await encodePdf(row.blob) });
      } else result = await call("send", { ticket: ticket.current });
      ticket.current = result.ticket ?? "";
      setRecipient(result.recipient ?? "");
      setStep(result.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AppFolio did not complete this step.");
      setStep(step === "review" ? "unknown" : "login");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={advance} className="mt-3 space-y-2">
    {step === "login" && <>
      <p>Sign in to AppFolio for this notice. Your password is used for this session only.</p>
      <label className="block">AppFolio email<Input name="email" type="email" autoComplete="off" required /></label>
      <label className="block">AppFolio password<Input name="password" type="password" autoComplete="off" required /></label>
    </>}
    {step === "verification" && <label className="block">AppFolio verification code<Input name="code" autoComplete="one-time-code" required /></label>}
    {step === "review" && <p>AppFolio recipient: <strong>{recipient}</strong>. Review the message and PDF above before sending.</p>}
    {error && <p role="alert">{error}</p>}
    {step === "submitted" ? <p role="status">Submitted through AppFolio.</p> : step === "unknown" ?
      <p role="status">Check the tenant’s AppFolio email history before taking further action.</p> :
      <Button type="submit" disabled={busy}>{busy ? "Working…" : step === "login" ? "Connect to AppFolio" : step === "verification" ? "Verify" : step === "connected" ? "Find tenant and attach PDF" : "Send email through AppFolio"}</Button>}
  </form>;
}
