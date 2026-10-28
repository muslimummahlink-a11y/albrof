import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BMP Media Production | Payroll" },
      {
        name: "description",
        content:
          "Weekly payroll and month-end payroll summaries for BMP Media Production in Uganda.",
      },
      { property: "og:title", content: "BMP Media Production | Payroll" },
      {
        property: "og:description",
        content: "Payroll management for BMP Media Production in Uganda.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.28),transparent_25%),linear-gradient(135deg,_#0b1017_0%,_#121b24_42%,_#101821_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),transparent_40%,rgba(245,158,11,0.08))]" />
      <div className="absolute left-8 top-8 z-10 rounded-sm bg-black p-2 md:left-16 md:top-16">
        <img
          src="/bro-media-logo.png"
          alt="BRO Media Production logo"
          className="h-auto w-48 md:w-64"
        />
        <p className="mt-2 text-center text-sm font-semibold text-white" dir="rtl">
          BMP للإنتاج الإعلامي
        </p>
      </div>
      <div className="relative facade-stripe" />
      <div className="relative flex flex-1 flex-col items-start justify-end gap-6 p-8 text-navy-foreground md:p-16">
        <p className="signage text-gold">Uganda · Bunyoro</p>
        <h1 className="signage max-w-3xl text-6xl leading-[0.9] md:text-8xl">
          BMP Media Production
        </h1>
        <p className="max-w-lg opacity-85">
          Manage staff, record attendance, run weekly payroll and compile month-end summaries —
          securely.
        </p>
        <Link
          to="/dashboard"
          className="signage rounded-sm bg-primary px-4 py-2  text-lg text-primary-foreground hover:opacity-90"
        >
          Enter Now!
        </Link>
      </div>
    </div>
  );
}
