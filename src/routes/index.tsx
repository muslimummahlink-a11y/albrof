import { createFileRoute, Link } from "@tanstack/react-router";
import stadium from "@/assets/hoima-stadium.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hoima City Stadium Payroll" },
      { name: "description", content: "Payroll management for Hoima City Stadium, Uganda — staff, PAYE, NSSF and payslips." },
      { property: "og:title", content: "Hoima City Stadium Payroll" },
      { property: "og:description", content: "Payroll management for Hoima City Stadium, Uganda." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <img src={stadium.url} alt="Hoima City Stadium" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-navy/70" />
      <div className="relative facade-stripe" />
      <div className="relative flex flex-1 flex-col items-start justify-end gap-6 p-8 text-navy-foreground md:p-16">
        <p className="signage text-gold">Uganda · Bunyoro</p>
        <h1 className="signage max-w-3xl text-6xl leading-[0.9] md:text-8xl">Hoima City Stadium Payroll</h1>
        <p className="max-w-lg opacity-85">Manage stadium staff, run monthly payroll with PAYE and NSSF, and issue payslips — securely.</p>
        <Link to="/dashboard" className="signage rounded-sm bg-primary px-8 py-3 text-lg text-primary-foreground hover:opacity-90">
          Enter payroll office
        </Link>
      </div>
    </div>
  );
}
