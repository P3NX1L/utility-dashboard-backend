import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";
import { call } from "@/lib/notices/appfolioWorker";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let active = true;
    call("credential-status", {}).then(result => { if (active) setEmail(result.email ?? ""); })
      .catch(error => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const password = new FormData(form).get("password");
    setBusy(true);
    setMessage("");
    try {
      await call("save-credentials", { email, password });
      form.reset();
      setMessage("AppFolio login saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save login.");
    } finally { setBusy(false); }
  }
  return <section className="max-w-lg space-y-6">
    <h1 className="text-3xl font-semibold">Settings</h1>
    <form onSubmit={save} className="space-y-3">
      <h2 className="font-semibold">AppFolio login</h2>
      <label className="block">Email<Input type="email" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} required /></label>
      <label className="block">Password<Input type="password" name="password" autoComplete="new-password" required /></label>
      <Button type="submit" disabled={busy}>Save login</Button>
      {message && <p role="status">{message}</p>}
    </form>
    <div className="border-t pt-4"><Button variant="outline" onClick={() => void getSupabase()?.auth.signOut()}>Sign out</Button></div>
  </section>;
}
