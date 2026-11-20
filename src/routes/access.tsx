import { createFileRoute } from "@tanstack/react-router";
import { AccessNoticeWorkspace } from "@/components/notices/AccessNoticeWorkspace";

export const Route = createFileRoute("/access")({
  head: () => ({
    meta: [
      { title: "Access Notices — Tenant Notices" },
      { name: "description", content: "Prepare Access Notices for First Western Properties tenants." },
      { property: "og:title", content: "Access Notices — Tenant Notices" },
      { property: "og:description", content: "Prepare Access Notices for First Western Properties tenants." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AccessPage,
});

function AccessPage() {
  return <AccessNoticeWorkspace />;
}
