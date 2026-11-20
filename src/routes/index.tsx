import { createFileRoute, Link } from "@tanstack/react-router";
import { container } from "@/components/layout/SiteHeader";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tenant Notices — First Western Properties" },
      { name: "description", content: "Staff tool for preparing First Western 5-day and access notices." },
      { property: "og:title", content: "Tenant Notices — First Western Properties" },
      { property: "og:description", content: "Staff tool for preparing First Western 5-day and access notices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Landing,
});

const btn =
  "mt-auto inline-flex w-fit items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Landing() {
  return (
    <div className={`${container} py-8 sm:py-12`}>
      <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Choose a notice type</h1>
      <div className="mt-5 grid gap-5 sm:mt-6 md:grid-cols-2 md:gap-6">
        <section className="flex flex-col rounded-lg border border-border bg-card p-5 sm:p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-lg font-semibold text-card-foreground">5-Day Notice</h2>
          <p className="mt-1.5 mb-5 text-sm leading-relaxed text-muted-foreground">
            Upload an AppFolio delinquency report and choose which tenants need a notice.
          </p>
          <Link to="/five-day" className={btn}>Create 5-Day Notices</Link>
        </section>
        <section className="flex flex-col rounded-lg border border-border bg-card p-5 sm:p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-lg font-semibold text-card-foreground">Access Notice</h2>
          <p className="mt-1.5 mb-5 text-sm leading-relaxed text-muted-foreground">
            Choose tenants and enter the access dates and reason once for the group.
          </p>
          <Link to="/access" className={btn}>Create Access Notices</Link>
        </section>
      </div>
    </div>
  );
}
