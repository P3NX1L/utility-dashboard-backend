import { getSupabase } from "@/lib/supabase";

const worker = "https://first-western-notice-mail.onrender.com";
type Step = "login" | "verification" | "connected" | "review" | "submitted" | "unknown";

export async function call(action: string, data: Record<string, unknown>) {
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
  return result as { ticket: string; state: Step; recipient?: string; email?: string };
}

