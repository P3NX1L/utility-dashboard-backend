import { Link } from "@tanstack/react-router";

// Exact original Utilities asset (398x108). Its ink box is x 10–385, y 10–89, so the
// negative left margin and small downward nudge align the visible mark, not the canvas.
const LOGO_URL =
  "https://1stwesterndashboard.xyz/__l5e/assets-v1/df0c4a52-40e0-4ec9-a986-8bbe34942c8d/first-western-logo-hd.png";

export const container = "mx-auto w-full max-w-[1040px] px-5 sm:px-8";

const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className={`${container} flex h-16 items-center sm:h-[72px]`}>
        <Link to="/" className={`flex min-w-0 items-center gap-3 rounded-sm sm:gap-4 ${focus}`}>
          <img
            src={LOGO_URL}
            alt="First Western Properties"
            width={398}
            height={108}
            className="-ml-[4px] h-10 w-auto shrink-0 translate-y-[2px] sm:-ml-[5px] sm:h-12"
          />
          <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
          <span className="truncate text-[15px] font-semibold text-foreground">Tenant Notices</span>
        </Link>
      </div>
    </header>
  );
}

export function BackLink() {
  return (
    <Link to="/" className={`inline-flex items-center rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline ${focus}`}>
      ← Back to Tenant Notices
    </Link>
  );
}
