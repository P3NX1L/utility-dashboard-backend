import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { FileText, Mail, KeyRound, ChevronDown, Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

const logo = "https://1stwesterndashboard.xyz/__l5e/assets-v1/df0c4a52-40e0-4ec9-a986-8bbe34942c8d/first-western-logo-hd.png";
export function NoticeShell({ children, email, signOut }: { children: ReactNode; email: string | null; signOut: (() => void) | null }) {
  const path = useLocation().pathname;
  const access = path.startsWith("/access");
  const exports = path.endsWith("/exports");
  const [expanded, setExpanded] = useState({ "five-day": !access, access });
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setExpanded((old) => ({ ...old, [access ? "access" : "five-day"]: true })); setMobileOpen(false); }, [path, access]);
  const linkClass = "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const navigation = (prefix: string) => <nav aria-label="Notice navigation" className="flex flex-1 flex-col gap-2 p-3">
    {(["five-day", "access"] as const).map((kind) => {
      const isAccess = kind === "access", active = isAccess === access;
      const Icon = isAccess ? KeyRound : Mail;
      return <div key={kind}>
        <button type="button" aria-expanded={expanded[kind]} aria-controls={`${prefix}-${kind}`} onClick={() => setExpanded((old) => ({ ...old, [kind]: !old[kind] }))} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Icon className="size-[22px] shrink-0 text-primary" /><span className="flex-1 text-left">{isAccess ? "Access Notice" : "5-Day Notice"}</span><ChevronDown className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded[kind] ? "" : "-rotate-90"}`} /></button>
        {expanded[kind] && <div id={`${prefix}-${kind}`} className="mt-2 ml-3 flex flex-col gap-5 border-l border-sidebar-border pl-2">
          <div><div className="mb-2 px-3 text-xs font-semibold">Notice Processing</div><div className="space-y-1">
          <Link to={isAccess ? "/access" : "/five-day"} onClick={() => setMobileOpen(false)} className={`${linkClass} ${active && !exports ? "bg-sidebar-accent text-sidebar-foreground" : "hover:bg-muted"}`} aria-current={active && !exports ? "page" : undefined}><FileText aria-hidden="true" className="size-4 shrink-0 text-primary" /><span>Generate Notice</span></Link>
          <Link to={isAccess ? "/access/exports" : "/five-day/exports"} onClick={() => setMobileOpen(false)} className={`${linkClass} ${active && exports ? "bg-sidebar-accent text-sidebar-foreground" : "hover:bg-muted"}`} aria-current={active && exports ? "page" : undefined}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-primary"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M3.5 16.5v2.5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2.5" /></svg><span>Exports</span></Link>
          </div></div>
        </div>}
      </div>;
    })}
  </nav>;
  const footer = <div className="border-t border-sidebar-border p-3">{signOut && <><p className="mb-2 break-all px-3 text-xs text-muted-foreground">{email}</p><Button variant="ghost" className="h-auto w-full justify-start gap-3 px-3 py-2 text-sm font-medium" onClick={signOut}><LogOut className="size-5 text-primary" />Sign out</Button></>}</div>;
  return <div className="flex min-h-screen w-full font-sans text-sm antialiased [font-feature-settings:\'tnum\'_1]">
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-6"><Link to="/" aria-label="First Western Tenant Notices" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><img src={logo} alt="First Western Properties" width={398} height={108} className="h-12 w-auto" /></Link></div>
      {navigation("desktop")}{footer}
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
        <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" aria-label="Toggle notice navigation" aria-expanded={mobileOpen} aria-controls="mobile-notice-nav" onClick={() => setMobileOpen((v) => !v)}><Menu className="size-5" /></Button>
        <Link to="/" className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"><img src={logo} alt="First Western Properties" width={398} height={108} className="h-8 w-auto" /></Link>
        <span className="truncate text-sm font-semibold">Tenant Notices</span>
      </header>
      {mobileOpen && <div id="mobile-notice-nav" className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden">{navigation("mobile")}{signOut && footer}</div>}
      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10">{children}</main>
    </div>
  </div>;
}
