import { createFileRoute } from "@tanstack/react-router";
import { RentNoticeWorkspace } from "@/components/notices/RentNoticeWorkspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Generate 5-Day Notices — First Western Properties" },
      { name: "description", content: "Prepare and review rent-only five-day notices for First Western tenants." },
      { property: "og:title", content: "Generate 5-Day Notices — First Western Properties" },
      { property: "og:description", content: "Prepare and review rent-only five-day notices for First Western tenants." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <div><h1 className="text-3xl font-semibold">5-Day Notices</h1><RentNoticeWorkspace /></div>;
}
