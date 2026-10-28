import ncsLogo from "@/assets/ncs-logo.png";

export type PdfReport = {
  title: string;
  subtitle?: string;
  filters?: Array<[string, string]>;
  summary?: Array<[string, string]>;
  columns: string[];
  rows: Array<Array<string | number>>;
  orientation?: "portrait" | "landscape";
};

export function openPdfWindow(): Window {
  const target = window.open("", "_blank");
  if (!target) {
    throw new Error("The PDF window was blocked. Allow pop-ups for this site and try again.");
  }
  target.opener = null;
  target.document.title = "Preparing PDF…";
  target.document.body.innerHTML =
    '<p style="font:16px Arial,sans-serif;padding:24px">Preparing your report…</p>';
  return target;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPairs(items: Array<[string, string]>, className: string): string {
  if (!items.length) return "";
  return `<section class="${className}">${items
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("")}</section>`;
}

export function printPdfReport(target: Window, report: PdfReport): void {
  const generatedAt = new Intl.DateTimeFormat("en-UG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kampala",
  }).format(new Date());
  const tableRows = report.rows
    .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(report.title)}</title>
  <style>
    @page { size: A4 ${report.orientation ?? "landscape"}; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #202938; font: 10pt Arial, Helvetica, sans-serif; }
    header { display: flex; align-items: center; gap: 20px; padding: 0 0 14px; border-bottom: 3px solid #f4a51c; }
    header img { width: 168px; max-height: 76px; object-fit: contain; }
    .brand { flex: 1; }
    .brand h1 { margin: 0; color: #172b4d; font-size: 19pt; letter-spacing: .2px; }
    .brand p { margin: 4px 0 0; color: #64748b; font-size: 9pt; }
    h2 { margin: 18px 0 4px; color: #172b4d; font-size: 16pt; }
    .subtitle { margin: 0 0 14px; color: #526174; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 9px 11px; background: #f4f6f8; color: #526174; font-size: 8.5pt; }
    .meta strong { color: #202938; margin-right: 4px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    .summary > div { min-width: 0; border: 1px solid #d9e0e7; border-left: 3px solid #f4a51c; padding: 8px; }
    .summary span, .filters span { display: block; color: #64748b; font-size: 8pt; margin-bottom: 4px; }
    .summary strong { color: #172b4d; font-size: 11pt; overflow-wrap: anywhere; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 10px 0; font-size: 9pt; }
    .filters span { display: inline; margin-right: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 8.5pt; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th { background: #172b4d; color: white; text-align: left; font-size: 8pt; }
    th, td { border: 1px solid #d9e0e7; padding: 6px 7px; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f7f9fb; }
    .empty { margin-top: 18px; border: 1px solid #d9e0e7; padding: 18px; color: #64748b; text-align: center; }
    footer { margin-top: 16px; border-top: 1px solid #d9e0e7; padding-top: 7px; color: #64748b; font-size: 8pt; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <header>
    <img src="${escapeHtml(ncsLogo)}" alt="National Council of Sports logo">
    <div class="brand"><h1>BMP MEDIA PRODUCTION</h1><p>Staff and payroll administration</p></div>
  </header>
  <main>
    <h2>${escapeHtml(report.title)}</h2>
    ${report.subtitle ? `<p class="subtitle">${escapeHtml(report.subtitle)}</p>` : ""}
    <div class="meta"><span><strong>Generated:</strong>${escapeHtml(generatedAt)} EAT</span><span><strong>Records:</strong>${report.rows.length}</span></div>
    ${renderPairs(report.filters ?? [], "filters")}
    ${renderPairs(report.summary ?? [], "summary")}
    ${
      report.rows.length
        ? `<table><thead><tr>${report.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>`
        : '<p class="empty">No records matched the selected export filters.</p>'
    }
  </main>
  <footer>BMP Media Production · Confidential administrative report</footer>
  <script>
    let printed = false;
    const printWhenReady = () => {
      if (printed) return;
      printed = true;
      setTimeout(() => { window.focus(); window.print(); }, 250);
    };
    const logo = document.querySelector("header img");
    if (!logo || logo.complete) printWhenReady();
    else { logo.addEventListener("load", printWhenReady, { once: true }); logo.addEventListener("error", printWhenReady, { once: true }); setTimeout(printWhenReady, 1500); }
  </script>
</body>
</html>`;
  target.document.open();
  target.document.write(html);
  target.document.close();
}
