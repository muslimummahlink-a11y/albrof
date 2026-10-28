import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Banknote,
  CalendarClock,
  ChartNoAxesCombined,
  Fingerprint,
  FileText,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ReceiptText,
  Settings,
  ShoppingBag,
  Sun,
  Users,
  X,
  Wallet,
  Clapperboard,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { devAuthBypass } from "@/lib/dev-auth";

const staffNav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/employees", label: "Staff", icon: Users },
  { to: "/payroll", label: "Payroll", icon: Banknote },
  { to: "/projects", label: "Projects", icon: Clapperboard },
  { to: "/quotations", label: "Quotations", icon: FileText },
  { to: "/invoices", label: "Invoices", icon: ReceiptText },
  { to: "/payables", label: "Vendor bills", icon: ReceiptText },
  { to: "/expenses", label: "Expenses", icon: ShoppingBag },
  { to: "/finance", label: "Finance", icon: Wallet },
  { to: "/finance-reports", label: "Finance reports", icon: ChartNoAxesCombined },
  { to: "/user-access", label: "User access", icon: Settings },
  { to: "/attendance", label: "Attendance", icon: Fingerprint },
  { to: "/requests", label: "Leave & OT", icon: CalendarClock },
  { to: "/id-cards", label: "ID cards", icon: IdCard },
  { to: "/reports", label: "Reports", icon: ChartNoAxesCombined },
] as const;

export function AppShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [darkMode, setDarkMode] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("bmp-theme");
    const enabled = savedTheme ? savedTheme === "dark" : true;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  function toggleTheme() {
    const enabled = !darkMode;
    setDarkMode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
    window.localStorage.setItem("bmp-theme", enabled ? "dark" : "light");
  }

  const { data: access } = useQuery({
    queryKey: ["access"],
    queryFn: async () => {
      if (devAuthBypass) {
        return { email: "developer@localhost", roles: ["admin"], employeeId: null };
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) return { email: "", roles: [], employeeId: null };
      const [
        { data: roles, error: rolesError },
        { data: employee, error: employeeError },
      ] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", auth.user.id),
        supabase.from("employees").select("id").eq("auth_user_id", auth.user.id).maybeSingle(),
      ]);
      if (rolesError) throw rolesError;
      if (employeeError) throw employeeError;
      return {
        email: auth.user.email ?? "",
        roles: (roles ?? []).map((row) => row.role),
        employeeId: employee?.id ?? null,
      };
    },
  });
  const isStaff = Boolean(access?.roles.length);
  const canManagePayroll = Boolean(access?.roles.some((role) => role === "admin" || role === "hr"));
  const canManageAccess = Boolean(access?.roles.includes("admin"));
  const canAccessFinance = Boolean(
    access?.roles.some((role) => role === "admin" || role === "accountant"),
  );
  const canAccessProjects = Boolean(
    access?.roles.some(
      (role) => role === "admin" || role === "hr" || role === "accountant" || role === "producer",
    ),
  );
  const isFinancePage = pathname === "/finance";
  const isFinanceReportsPage = pathname === "/finance-reports";
  const isInvoicePage = pathname === "/invoices";
  const isQuotationPage = pathname === "/quotations";
  const isPayablesPage = pathname === "/payables";
  const isProjectPage = pathname === "/projects";
  const isUserAccessPage = pathname === "/user-access";
  const isPayrollManagementPage =
    pathname === "/employees" ||
    pathname === "/payroll" ||
    pathname.startsWith("/payroll/") ||
    pathname === "/attendance" ||
    pathname === "/requests" ||
    pathname === "/id-cards" ||
    pathname === "/reports" ||
    pathname === "/casual-payroll-import";
  const isEmployeePage =
    pathname === "/my-payslips" ||
    pathname === "/requests" ||
    pathname === "/expenses" ||
    pathname === "/account-settings";
  const nav = [
    ...(isStaff
      ? [
          ...staffNav.filter((item) => {
            if (
              item.to === "/finance" ||
              item.to === "/finance-reports" ||
              item.to === "/quotations" ||
              item.to === "/invoices" ||
              item.to === "/payables"
            ) {
              return canAccessFinance;
            }
            if (item.to === "/user-access") return canManageAccess;
            if (
              item.to === "/employees" ||
              item.to === "/payroll" ||
              item.to === "/attendance" ||
              item.to === "/requests" ||
              item.to === "/id-cards" ||
              item.to === "/reports"
            ) {
              return canManagePayroll;
            }
            return true;
          }),
          ...(access?.employeeId
            ? [{ to: "/my-payslips" as const, label: "My payslips", icon: Banknote }]
            : []),
        ]
      : access?.employeeId
        ? [
            { to: "/my-payslips" as const, label: "My payslips", icon: Banknote },
            { to: "/requests" as const, label: "Leave & OT", icon: CalendarClock },
            { to: "/expenses" as const, label: "Expenses", icon: ShoppingBag },
          ]
        : []),
    { to: "/account-settings" as const, label: "Account", icon: Settings },
  ];
  const primaryNav = nav.slice(0, 3);
  const moreNav = nav.slice(3);
  const moreActive =
    moreNav.some(
      (item) =>
        pathname === item.to || (item.to === "/payroll" && pathname.startsWith("/payroll/")),
    ) || pathname === "/account-settings";

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    setMoreOpen(false);
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="bg-black px-5 py-5">
          <img
            src="/bro-media-logo.png"
            alt="BRO Media Production logo"
            className="h-auto w-full"
          />
          <p className="mt-3 text-center text-xs font-semibold tracking-wide text-white">
            BMP للإنتاج الإعلامي · PAYROLL
          </p>
        </div>
        <div className="facade-stripe" />
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
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
          <button
            onClick={signOut}
            className="mt-2 flex items-center gap-2 font-semibold text-sidebar-primary hover:underline"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {devAuthBypass && (
          <div
            role="status"
            className="bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950"
          >
            Development auth bypass enabled. Supabase data and server actions still require
            authentication.
          </div>
        )}
        <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-4 sm:px-6 sm:py-5">
          <h1 className="signage min-w-0 flex-1 truncate text-2xl text-navy sm:text-3xl">
            {title}
          </h1>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
            <button
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
              className="hidden rounded-sm border p-2 text-muted-foreground hover:bg-secondary md:inline-flex"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>
        <div className="p-4 pb-24 sm:p-6 sm:pb-6">
          {access &&
          (((isFinancePage ||
            isFinanceReportsPage ||
            isInvoicePage ||
            isQuotationPage ||
            isPayablesPage) &&
            !canAccessFinance) ||
            (isProjectPage && !canAccessProjects) ||
            (isUserAccessPage && !canManageAccess) ||
            (isPayrollManagementPage &&
              !canManagePayroll &&
              !(pathname === "/requests" && access.employeeId))) ? (
            <div className="rounded-sm border-l-4 border-destructive bg-destructive/10 p-6 text-destructive">
              <h2 className="signage text-xl">Authorised role required</h2>
              <p className="mt-1 text-sm">
                Your assigned role does not have access to this page.
              </p>
            </div>
          ) : access && !isStaff && (!access.employeeId || !isEmployeePage) ? (
            <div className="rounded-sm border-l-4 border-gold bg-accent p-6 text-accent-foreground">
              <h2 className="signage text-xl">
                {access.employeeId ? "HR access required" : "Awaiting access"}
              </h2>
              <p className="mt-1 text-sm">
                {access.employeeId
                  ? "This page is for authorised payroll staff. Use My payslips or Leave & OT to access your employee services."
                  : "Your account is signed in but has not been linked to an employee record or given payroll access. Ask the BMP administrator to link your employee account."}
              </p>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur md:hidden"
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-4">
          {primaryNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={
                pathname === item.to || (item.to === "/payroll" && pathname.startsWith("/payroll/"))
                  ? "page"
                  : undefined
              }
              className="flex flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground"
              activeProps={{ className: "text-primary" }}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-label="More navigation options"
            onClick={() => setMoreOpen(!moreOpen)}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${moreActive || moreOpen ? "text-primary" : "text-muted-foreground"}`}
          >
            {moreOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span>More</span>
          </button>
        </div>
      </nav>
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close more menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
          />
          <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 rounded-lg border bg-card p-2 shadow-xl md:hidden">
            <div className="grid grid-cols-2 gap-1">
              {moreNav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMoreOpen(false)}
                  className={`flex min-h-12 items-center gap-2 rounded-md px-3 text-sm font-semibold hover:bg-secondary ${pathname === item.to ? "text-primary" : "text-foreground"}`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={toggleTheme}
                className="flex min-h-12 items-center gap-2 rounded-md px-3 text-left text-sm font-semibold hover:bg-secondary"
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {darkMode ? "Light mode" : "Dark mode"}
              </button>
              <button
                type="button"
                onClick={signOut}
                className="flex min-h-12 items-center gap-2 rounded-md px-3 text-left text-sm font-semibold text-destructive hover:bg-secondary"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "navy",
}: {
  label: string;
  value: string;
  tone?: "navy" | "crimson" | "gold" | "pitch";
}) {
  const bar = { navy: "bg-navy", crimson: "bg-crimson", gold: "bg-gold", pitch: "bg-pitch" }[tone];
  return (
    <div className="relative overflow-hidden rounded-sm border bg-card p-3 sm:p-5">
      <div className={`absolute inset-x-0 top-0 h-1 ${bar}`} />
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground sm:text-xs sm:tracking-wider">
        {label}
      </p>
      <p className="signage mt-2 break-words text-xl text-navy sm:text-3xl">{value}</p>
    </div>
  );
}
