import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { AppShell } from "@/components/AppShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { computePayslip, ugx } from "@/lib/payroll";

export const Route = createFileRoute("/_authenticated/employees")({
  head: () => ({ meta: [{ title: "Staff · Hoima Stadium Payroll" }] }),
  component: Employees,
});

type Emp = Tables<"employees">;
const DEPTS = ["Administration", "Grounds & Pitch", "Security", "Operations", "Maintenance", "Ticketing", "Catering"];
const empty = { employee_no: "", full_name: "", position: "", department: DEPTS[0], phone: "", bank_name: "", account_no: "", nssf_no: "", base_salary: 0, allowances: 0, status: "active" };

function Employees() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<Emp> | null>(null);
  const { data: emps = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await supabase.from("employees").select("*").order("full_name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (e: Partial<Emp>) => {
      const { id, created_at, ...rest } = e as Emp;
      const payload = { ...rest, base_salary: Number(rest.base_salary), allowances: Number(rest.allowances) };
      const { error } = id ? await supabase.from("employees").update(payload).eq("id", id) : await supabase.from("employees").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); setEdit(null); toast.success("Staff saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("employees").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  const list = emps.filter((e) => `${e.full_name} ${e.employee_no} ${e.department} ${e.position}`.toLowerCase().includes(q.toLowerCase()));
  const f = (k: keyof Emp) => ({ value: (edit?.[k] as string | number) ?? "", onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setEdit({ ...edit, [k]: ev.target.value }) });
  const inp = "w-full rounded-sm border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <AppShell
      title="Staff"
      actions={<button onClick={() => setEdit(empty)} className="signage flex items-center gap-1 rounded-sm bg-primary px-4 py-2 text-primary-foreground"><Plus className="h-4 w-4" />Add staff</button>}
    >
      <input placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} className={`${inp} mb-4 max-w-sm`} />
      <div className="overflow-x-auto rounded-sm border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-navy text-left text-xs uppercase tracking-wider text-navy-foreground">
            <tr>{["No.", "Name", "Position", "Department", "Gross", "Net", "Status", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {list.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No staff found.</td></tr>}
            {list.map((e) => {
              const p = computePayslip(e.base_salary, e.allowances);
              return (
                <tr key={e.id} className="hover:bg-muted">
                  <td className="px-4 py-3 font-mono text-xs">{e.employee_no}</td>
                  <td className="px-4 py-3 font-semibold">{e.full_name}</td>
                  <td className="px-4 py-3">{e.position}</td>
                  <td className="px-4 py-3">{e.department}</td>
                  <td className="px-4 py-3">{ugx(p.gross)}</td>
                  <td className="px-4 py-3 font-semibold">{ugx(p.net)}</td>
                  <td className="px-4 py-3"><span className={`rounded-sm px-2 py-0.5 text-xs font-bold uppercase ${e.status === "active" ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"}`}>{e.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button aria-label="Edit" onClick={() => setEdit(e)}><Pencil className="h-4 w-4 text-navy" /></button>
                      <button aria-label="Delete" onClick={() => confirm(`Remove ${e.full_name}?`) && del.mutate(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="signage text-2xl text-navy">{edit?.id ? "Edit staff" : "New staff member"}</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); edit && save.mutate(edit); }} className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold">Employee no.<input required className={inp} {...f("employee_no")} /></label>
            <label className="text-xs font-bold">Full name<input required className={inp} {...f("full_name")} /></label>
            <label className="text-xs font-bold">Position<input required className={inp} {...f("position")} /></label>
            <label className="text-xs font-bold">Department<select className={inp} {...f("department")}>{DEPTS.map((d) => <option key={d}>{d}</option>)}</select></label>
            <label className="text-xs font-bold">Basic salary (UGX)<input type="number" min={0} required className={inp} {...f("base_salary")} /></label>
            <label className="text-xs font-bold">Allowances (UGX)<input type="number" min={0} className={inp} {...f("allowances")} /></label>
            <label className="text-xs font-bold">Phone<input className={inp} {...f("phone")} /></label>
            <label className="text-xs font-bold">NSSF no.<input className={inp} {...f("nssf_no")} /></label>
            <label className="text-xs font-bold">Bank<input className={inp} {...f("bank_name")} /></label>
            <label className="text-xs font-bold">Account no.<input className={inp} {...f("account_no")} /></label>
            <label className="text-xs font-bold">Status<select className={inp} {...f("status")}><option value="active">active</option><option value="inactive">inactive</option></select></label>
            <div className="flex items-end justify-end gap-2">
              <button type="button" onClick={() => setEdit(null)} className="rounded-sm border px-4 py-2 text-sm font-semibold">Cancel</button>
              <button disabled={save.isPending} className="signage rounded-sm bg-primary px-5 py-2 text-primary-foreground">Save</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
