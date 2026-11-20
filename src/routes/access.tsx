import { createFileRoute } from "@tanstack/react-router";
import { BackLink, container } from "@/components/layout/SiteHeader";

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
  return (
    <div className={`${container} py-8 sm:py-10`}>
      <BackLink />
      <h1 className="mt-4 text-2xl font-semibold text-foreground">Access Notices</h1>
    </div>
  );
}
