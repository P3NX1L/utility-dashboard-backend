import { createFileRoute } from "@tanstack/react-router";
import { BackLink, container } from "@/components/layout/SiteHeader";
import { AuthGate } from "@/components/notices/AuthGate";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/five-day")({
  head: () => ({
    meta: [
      { title: "5-Day Notices — Tenant Notices" },
      { name: "description", content: "Prepare 5-Day Notices for First Western Properties tenants." },
      { property: "og:title", content: "5-Day Notices — Tenant Notices" },
      { property: "og:description", content: "Prepare 5-Day Notices for First Western Properties tenants." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: FiveDayPage,
});

function FiveDayPage() {
  return (
    <div className={`${container} py-8 sm:py-10`}>
      <BackLink />
      <h1 className="mt-4 text-2xl font-semibold text-foreground">5-Day Notices</h1>
      <AuthGate>{({ email, signOut }) => <>
        {signOut && <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground"><span>{email}</span><Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button></div>}
        <RentNoticeWorkspace />
      </>}</AuthGate>
    </div>
  );
}
