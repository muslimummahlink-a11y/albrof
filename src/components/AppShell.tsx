import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Users, Banknote, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/employees", label: "Staff", icon: Users },
  { to: "/payroll", label: "Payroll runs", icon: Banknote },
] as const;

export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: access } = useQuery({
    queryKey: ["access"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user!.id);
      return { email: u.user?.email ?? "", roles: (data ?? []).map((r) => r.role) };
    },
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="diamond-lattice px-5 py-6">
          <p className="signage text-2xl leading-none text-navy-foreground">Hoima City</p>
          <p className="signage text-sm text-gold">Stadium · Payroll</p>
        </div>
        <div className="facade-stripe" />
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4 text-xs">
          <p className="truncate opacity-80">{access?.email}</p>
          <button onClick={signOut} className="mt-2 flex items-center gap-2 font-semibold text-sidebar-primary hover:underline">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1">
        <header className="flex items-center justify-between gap-4 border-b bg-card px-6 py-5">
          <h1 className="signage text-3xl text-navy">{title}</h1>
          <div className="flex items-center gap-2">
            {actions}
            <button onClick={signOut} className="text-sm font-semibold text-primary md:hidden">Sign out</button>
          </div>
        </header>
        <div className="flex gap-1 border-b bg-card px-4 py-2 md:hidden">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className="rounded-sm px-3 py-1.5 text-sm font-semibold" activeProps={{ className: "bg-secondary text-primary" }}>
              {n.label}
            </Link>
          ))}
        </div>
        <div className="p-6">
          {access && access.roles.length === 0 ? (
            <div className="rounded-sm border-l-4 border-gold bg-accent p-6 text-accent-foreground">
              <h2 className="signage text-xl">Awaiting access</h2>
              <p className="mt-1 text-sm">Your account is signed in but has not been given payroll access yet. Ask the stadium administrator to grant you HR access.</p>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}

export function Stat({ label, value, tone = "navy" }: { label: string; value: string; tone?: "navy" | "crimson" | "gold" | "pitch" }) {
  const bar = { navy: "bg-navy", crimson: "bg-crimson", gold: "bg-gold", pitch: "bg-pitch" }[tone];
  return (
    <div className="relative overflow-hidden rounded-sm border bg-card p-5">
      <div className={`absolute inset-x-0 top-0 h-1 ${bar}`} />
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="signage mt-2 text-3xl text-navy">{value}</p>
    </div>
  );
}
