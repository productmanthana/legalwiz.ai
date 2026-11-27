import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, FolderOpen, Scale, History, Settings, LogOut, Menu, X, MessagesSquare, FileSearch, Bot } from "lucide-react";
import { useGetMe, useSignOut } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { human, initials } from "@/lib/format";

export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 48 48" className="h-7 w-7 shrink-0">
        <rect width="48" height="48" rx="10" fill={light ? "#22386b" : "#172a54"} />
        <path d="M13 14h22M13 24h14M13 34h8" stroke="#e8eef7" strokeWidth="3.2" strokeLinecap="round" />
        <circle cx="33" cy="32" r="5.5" fill="none" stroke="#2bb3a3" strokeWidth="3" />
        <path d="M37 36l4 4" stroke="#2bb3a3" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className={cn("font-sans font-bold tracking-[0.18em] text-[13px]", light ? "text-white" : "text-primary")}>FINTRACE</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const signOut = useSignOut({ mutation: { onSettled: () => { queryClient.clear(); setLocation("/"); } } });
  const [open, setOpen] = useState(false);
  const inv = me?.workspace === "investigation";

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/cases", label: inv ? "Assigned Investigations" : "My Cases", icon: FolderOpen },
    ...(inv ? [{ href: "/cases?focus=queries", label: "Query Management", icon: MessagesSquare }, { href: "/cases?focus=responses", label: "Response Review", icon: FileSearch }] : []),
    { href: "/assistant", label: "AI Assistant", icon: Bot },
    { href: "/legal", label: inv ? "Legal References" : "Legal Intelligence", icon: Scale },
    { href: "/audit", label: inv ? "Review History" : "Audit History", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const isActive = (href: string) => {
    const p = href.split("?")[0];
    if (href.includes("?")) return false;
    return location === p || location.startsWith(p + "/");
  };

  const side = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <Link href="/dashboard" data-testid="link-home"><Logo light /></Link>
        <button className="md:hidden text-sidebar-foreground" onClick={() => setOpen(false)} data-testid="button-close-nav"><X className="h-5 w-5" /></button>
      </div>
      <div className="mx-5 mb-4 rounded-md border border-sidebar-border px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/55">Workspace</div>
        <div className="text-[13px] font-semibold text-white mt-0.5" data-testid="text-workspace">{inv ? "Investigation" : "Client"} workspace</div>
      </div>
      <nav className="flex-1 px-3 space-y-0.5">
        {nav.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.label} href={item.href} onClick={() => setOpen(false)} data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn("group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors",
                active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/75 hover:text-white hover:bg-sidebar-accent/60")}>
              {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-sidebar-primary" />}
              <item.icon className="h-4 w-4 opacity-80" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-3 text-[10.5px] leading-relaxed text-sidebar-foreground/50 border-t border-sidebar-border">
        FINTRACE organises records. It does not decide guilt, innocence or legal validity.
      </div>
      <div className="p-3 border-t border-sidebar-border flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-full bg-sidebar-primary/20 text-sidebar-primary grid place-items-center text-xs font-bold">{initials(me?.displayName)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-white truncate" data-testid="text-username">{me?.displayName ?? "—"}</div>
          <div className="text-[11px] text-sidebar-foreground/55 truncate">{human(me?.role)}</div>
        </div>
        <button title="Sign out" onClick={() => signOut.mutate()} className="p-2 rounded-md text-sidebar-foreground/70 hover:text-white hover:bg-sidebar-accent" data-testid="button-signout">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-background grain">
      <aside className="hidden md:block fixed inset-y-0 left-0 w-[232px] z-30">{side}</aside>
      {open && <div className="md:hidden fixed inset-0 z-40 bg-primary/40" onClick={() => setOpen(false)} />}
      <aside className={cn("md:hidden fixed inset-y-0 left-0 w-[260px] z-50 transition-transform", open ? "translate-x-0" : "-translate-x-full")}>{side}</aside>
      <div className="md:pl-[232px]">
        <div className="md:hidden sticky top-0 z-20 flex items-center justify-between border-b bg-card/90 backdrop-blur px-4 h-12">
          <button onClick={() => setOpen(true)} data-testid="button-open-nav"><Menu className="h-5 w-5" /></button>
          <Logo />
          <span className="w-5" />
        </div>
        <main className="px-4 md:px-8 py-6 md:py-8 max-w-[1440px] mx-auto">{children}</main>
      </div>
    </div>
  );
}
