import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Stat } from "@/components/AppShell";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ugx } from "@/lib/payroll";

export const Route = createFileRoute("/_authenticated/payroll/$runId")({
  head: () => ({ meta: [{ title: "Payroll run · Hoima Stadium Payroll" }] }),
  component: RunDetail,
});

function RunDetail() {
  const { runId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [slipId, setSlipId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_runs").select("*, payslips(*, employees(*))").eq("id", runId).single();
      if (error) throw error;
      return data;
    },
  });
  const markPaid = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("payroll_runs").update({ status: "paid" }).eq("id", runId); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Marked as paid"); },
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("payroll_runs").delete().eq("id", runId); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["runs"] }); navigate({ to: "/payroll" }); },
  });

  const slips = data?.payslips ?? [];
  const sum = (k: "gross" | "paye" | "nssf_employee" | "nssf_employer" | "net") => slips.reduce((a, s) => a + Number(s[k]), 0);
  const slip = slips.find((s) => s.id === slipId);

  return (
    <AppShell
      title={`Payroll ${data?.period ?? ""}`}
      actions={data && (
        <div className="flex gap-2">
          {data.status !== "paid" && <button onClick={() => remove.mutate()} className="rounded-sm border px-3 py-2 text-sm font-semibold text-destructive">Delete</button>}
          {data.status !== "paid" && <button onClick={() => markPaid.mutate()} className="signage rounded-sm bg-primary px-4 py-2 text-primary-foreground">Mark as paid</button>}
        </div>
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross" value={ugx(sum("gross"))} />
        <Stat label="PAYE" value={ugx(sum("paye"))} tone="gold" />
        <Stat label="NSSF (5% + 10%)" value={ugx(sum("nssf_employee") + sum("nssf_employer"))} tone="pitch" />
        <Stat label="Net pay" value={ugx(sum("net"))} tone="crimson" />
      </div>
      <div className="mt-6 overflow-x-auto rounded-sm border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-navy text-left text-xs uppercase tracking-wider text-navy-foreground">
            <tr>{["Staff", "Department", "Gross", "PAYE", "NSSF 5%", "Net", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {slips.map((s) => (
              <tr key={s.id} className="hover:bg-muted">
                <td className="px-4 py-3 font-semibold">{s.employees?.full_name}</td>
                <td className="px-4 py-3">{s.employees?.department}</td>
                <td className="px-4 py-3">{ugx(s.gross)}</td>
                <td className="px-4 py-3">{ugx(s.paye)}</td>
                <td className="px-4 py-3">{ugx(s.nssf_employee)}</td>
                <td className="px-4 py-3 font-bold">{ugx(s.net)}</td>
                <td className="px-4 py-3"><button onClick={() => setSlipId(s.id)} className="text-sm font-semibold text-primary">Payslip</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!slip} onOpenChange={(o) => !o && setSlipId(null)}>
        <DialogContent className="max-w-md overflow-hidden p-0">
          {slip && (
            <div id="payslip">
              <div className="diamond-lattice px-6 py-5 text-navy-foreground">
                <p className="signage text-2xl leading-none">Hoima City Stadium</p>
                <p className="signage text-sm text-gold">Payslip · {data?.period}</p>
              </div>
              <div className="facade-stripe" />
              <div className="space-y-4 p-6 text-sm">
                <div>
                  <p className="signage text-xl text-navy">{slip.employees?.full_name}</p>
                  <p className="text-muted-foreground">{slip.employees?.position} · {slip.employees?.department} · #{slip.employees?.employee_no}</p>
                </div>
                <dl className="divide-y">
                  {[
                    ["Basic salary", slip.employees?.base_salary],
                    ["Allowances", slip.employees?.allowances],
                    ["Gross pay", slip.gross],
                    ["PAYE", -slip.paye],
                    ["NSSF (5%)", -slip.nssf_employee],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex justify-between py-2"><dt>{k}</dt><dd>{ugx(v as number)}</dd></div>
                  ))}
                  <div className="flex justify-between py-3 text-base font-bold"><dt>Net pay</dt><dd className="text-primary">{ugx(slip.net)}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">Employer NSSF (10%): {ugx(slip.nssf_employer)} · Bank: {slip.employees?.bank_name || "—"} {slip.employees?.account_no}</p>
                <button onClick={() => window.print()} className="signage w-full rounded-sm bg-navy py-2 text-navy-foreground">Print</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
