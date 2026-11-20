import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, supabaseConfigured, allowDemoWithoutAuth } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthGate({ children }: { children: (ctx: { email: string | null; signOut: (() => void) | null }) => ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setReady(true); return; }
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    sb.auth.getUser().then(async ({ data: u }) => {
      if (u.user) setSession((await sb.auth.getSession()).data.session);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;

  if (allowDemoWithoutAuth) return <>{children({ email: null, signOut: null })}</>;

  if (!supabaseConfigured)
    return (
      <Shell>
        <h1 className="text-2xl font-semibold">Configuration required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Staff sign-in is required in production. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the existing First Western project in the hosting environment.
        </p>
      </Shell>
    );

  if (session)
    return <>{children({ email: session.user.email ?? null, signOut: () => void getSupabase()?.auth.signOut() })}</>;

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">First Western</p>
      <h1 className="mt-1 text-2xl font-semibold">Tenant Notices — Staff sign in</h1>
      <form
        className="mt-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr(null);
          const sb = getSupabase();
          if (!sb) { setErr("Staff sign-in is not configured."); setBusy(false); return; }
          try {
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) setErr(error.message);
          } catch { setErr("Unable to reach staff sign-in. Please try again."); }
          finally { setBusy(false); }
        }}
      >
        <div className="space-y-1.5"><Label htmlFor="em">Staff email</Label><Input id="em" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw">Password</Label><Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        <p className="text-xs text-muted-foreground">Accounts are managed by the office administrator. There is no public sign-up.</p>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">{children}</div></div>;
}
