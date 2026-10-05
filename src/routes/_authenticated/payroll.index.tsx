import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { computePayslip } from "@/lib/payroll";

export const Route = createFileRoute("/_authenticated/payroll/")({
  head: () => ({ meta: [{ title: "Payroll runs · Hoima Stadium Payroll" }] }),
  component: Payroll,
});

function Payroll() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const { data: runs = [] } = useQuery({
    queryKey: ["runs"],
    queryFn: async () => (await supabase.from("payroll_runs").select("*, payslips(net, gross)").order("period", { ascending: false })).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: emps, error: e1 } = await supabase.from("employees").select("*").eq("status", "active");
      if (e1) throw e1;
      if (!emps?.length) throw new Error("Add active staff before running payroll.");
      const { data: run, error } = await supabase.from("payroll_runs").insert({ period }).select().single();
      if (error) throw new Error(error.code === "23505" ? "A run for this month already exists." : error.message);
      const slips = emps.map((e) => ({ run_id: run.id, employee_id: e.id, ...computePayslip(e.base_salary, e.allowances) }));
      const { error: e2 } = await supabase.from("payslips").insert(slips);
      if (e2) throw e2;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["runs"] }); toast.success("Payroll generated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Payroll runs"
      actions={
        <div className="flex items-center gap-2">
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-sm border border-input bg-card px-3 py-2 text-sm" />
          <button onClick={() => create.mutate()} disabled={create.isPending} className="signage rounded-sm bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60">Run payroll</button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {runs.length === 0 && <p className="text-muted-foreground">No payroll runs yet. Pick a month and click "Run payroll".</p>}
        {runs.map((r) => {
          const net = r.payslips.reduce((a, p) => a + Number(p.net), 0);
          return (
            <Link key={r.id} to="/payroll/$runId" params={{ runId: r.id }} className="group overflow-hidden rounded-sm border bg-card transition hover:-translate-y-0.5 hover:shadow-lg">
              <div className="diamond-lattice h-16" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <p className="signage text-3xl text-navy">{r.period}</p>
                  <span className={`rounded-sm px-2 py-0.5 text-xs font-bold uppercase ${r.status === "paid" ? "bg-navy text-navy-foreground" : "bg-accent text-accent-foreground"}`}>{r.status}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{r.payslips.length} payslips</p>
                <p className="mt-1 font-semibold">Net: UGX {net.toLocaleString("en-UG")}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
