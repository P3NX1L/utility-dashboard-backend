import { createFileRoute } from "@tanstack/react-router";
import { LegalOwnerMapping } from "@/components/notices/LegalOwnerMapping";

export const Route = createFileRoute("/five-day_/legal-owner-mapping")({
  head: () => ({ meta: [
    { title: "Legal Owner Mapping — First Western Tenant Notices" },
    { name: "description", content: "Staff property directory and legal owner mapping for First Western notices." },
    { property: "og:title", content: "Legal Owner Mapping — First Western Tenant Notices" },
    { property: "og:description", content: "Staff property directory and legal owner mapping for First Western notices." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: LegalOwnerMapping,
});