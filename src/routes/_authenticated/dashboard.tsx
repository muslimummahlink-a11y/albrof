import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Stat } from "@/components/AppShell";
import { computePayslip, ugx } from "@/lib/payroll";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview · Hoima Stadium Payroll" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: emps = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await supabase.from("employees").select("*").order("full_name")).data ?? [],
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => (await supabase.from("payroll_runs").select("*").order("period", { ascending: false })).data ?? [],
  });
  const active = emps.filter((e) => e.status === "active");
  const totals = active.reduce(
    (a, e) => {
      const p = computePayslip(e.base_salary, e.allowances);
      return { gross: a.gross + p.gross, net: a.net + p.net, paye: a.paye + p.paye, nssf: a.nssf + p.nssf_employee + p.nssf_employer };
    },
    { gross: 0, net: 0, paye: 0, nssf: 0 },
  );
  const byDept = Object.entries(
    active.reduce<Record<string, number>>((a, e) => ((a[e.department] = (a[e.department] ?? 0) + 1), a), {}),
  );

  return (
    <AppShell title="Overview">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active staff" value={String(active.length)} />
        <Stat label="Monthly gross" value={ugx(totals.gross)} tone="crimson" />
        <Stat label="PAYE to URA" value={ugx(totals.paye)} tone="gold" />
        <Stat label="NSSF (total)" value={ugx(totals.nssf)} tone="pitch" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Staff by department</h2>
          <div className="mt-4 space-y-3">
            {byDept.length === 0 && <p className="text-sm text-muted-foreground">No staff yet. <Link to="/employees" className="font-semibold text-primary">Add staff</Link></p>}
            {byDept.map(([d, n]) => (
              <div key={d}>
                <div className="flex justify-between text-sm font-semibold"><span>{d}</span><span>{n}</span></div>
                <div className="mt-1 h-2 rounded-sm bg-secondary">
                  <div className="h-2 rounded-sm bg-primary" style={{ width: `${(n / active.length) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-sm border bg-card p-5">
          <h2 className="signage text-xl text-navy">Recent payroll runs</h2>
          <ul className="mt-4 divide-y">
            {runs.length === 0 && <li className="py-2 text-sm text-muted-foreground">No runs yet.</li>}
            {runs.slice(0, 6).map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5 text-sm">
                <Link to="/payroll/$runId" params={{ runId: r.id }} className="font-semibold hover:text-primary">{r.period}</Link>
                <span className={`rounded-sm px-2 py-0.5 text-xs font-bold uppercase ${r.status === "paid" ? "bg-navy text-navy-foreground" : "bg-accent text-accent-foreground"}`}>{r.status}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">Projected net pay this month: <b className="text-foreground">{ugx(totals.net)}</b></p>
        </section>
      </div>
    </AppShell>
  );
}
