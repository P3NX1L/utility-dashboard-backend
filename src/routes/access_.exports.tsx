import { createFileRoute } from "@tanstack/react-router";
import { ExportHistory } from "@/components/notices/ExportHistory";
export const Route = createFileRoute("/access_/exports")({
  head: () => ({ meta: [
    { title: "Access Exports — First Western Tenant Notices" },
    { name: "description", content: "Reviewed draft access notice exports for signed-in First Western staff." },
    { property: "og:title", content: "Access Exports — First Western Tenant Notices" },
    { property: "og:description", content: "Reviewed draft access notice exports for signed-in First Western staff." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <ExportHistory kind="access" />,
});
