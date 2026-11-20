import { createFileRoute } from "@tanstack/react-router";
import { ExportHistory } from "@/components/notices/ExportHistory";
export const Route = createFileRoute("/five-day_/exports")({
  head: () => ({ meta: [
    { title: "5-Day Exports — First Western Tenant Notices" },
    { name: "description", content: "Reviewed five-day notice exports for signed-in First Western staff." },
    { property: "og:title", content: "5-Day Exports — First Western Tenant Notices" },
    { property: "og:description", content: "Reviewed five-day notice exports for signed-in First Western staff." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <ExportHistory kind="five-day" />,
});
