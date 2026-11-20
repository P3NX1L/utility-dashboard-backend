import { createFileRoute } from "@tanstack/react-router";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";

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
    <div>
      <h1 className="text-3xl font-semibold text-foreground">5-Day Notices</h1>
        <RentNoticeWorkspace />
    </div>
  );
}
