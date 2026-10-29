import type { Json } from "@/integrations/supabase/types";

export type ContractClause = {
  heading: string;
  body: string;
};

export type ContractTerms = {
  employerName: string;
  employerRegistration: string;
  employerAddress: string;
  employerEmail: string;
  employerPhone: string;
  employerRepresentative: string;
  employerRepresentativeTitle: string;
  employeeName: string;
  employeeNumber: string;
  employeeNationalId: string;
  employeeAddress: string;
  employeePhone: string;
  employeeEmail: string;
  jobTitle: string;
  department: string;
  workLocation: string;
  payAmount: string;
  payAllowances: string;
  payCurrency: string;
  payFrequency: string;
  probationPeriod: string;
  workingHours: string;
  annualLeave: string;
  noticePeriod: string;
  reportsTo: string;
  duties: string;
  additionalClauses: ContractClause[];
  signingCity: string;
};

export const DEFAULT_CONTRACT_TERMS: ContractTerms = {
  employerName: "BMP Media Production",
  employerRegistration: "",
  employerAddress: "",
  employerEmail: "",
  employerPhone: "",
  employerRepresentative: "",
  employerRepresentativeTitle: "",
  employeeName: "",
  employeeNumber: "",
  employeeNationalId: "",
  employeeAddress: "",
  employeePhone: "",
  employeeEmail: "",
  jobTitle: "",
  department: "",
  workLocation: "",
  payAmount: "",
  payAllowances: "",
  payCurrency: "UGX",
  payFrequency: "monthly",
  probationPeriod: "3 months",
  workingHours: "",
  annualLeave: "In accordance with applicable Ugandan law and the Employer's leave policy",
  noticePeriod: "In accordance with applicable Ugandan law",
  reportsTo: "",
  duties:
    "The Employee shall perform the duties associated with the position and other reasonable duties assigned by the Employer.",
  additionalClauses: [
    {
      heading: "Confidentiality and company property",
      body: "The Employee shall protect confidential business, client, production, and personnel information and return all company property when requested or when employment ends.",
    },
    {
      heading: "Changes to this agreement",
      body: "Any change to this agreement should be recorded in writing and accepted by both parties.",
    },
    {
      heading: "Workplace concerns and disputes",
      body: "The parties should first try to resolve any concern arising from this agreement through a good-faith discussion, without limiting any rights or remedies available under applicable law.",
    },
    {
      heading: "Workplace policies and health and safety",
      body: "The Employee shall follow the Employer's lawful workplace, conduct, equipment, and health and safety policies as communicated and updated from time to time.",
    },
    {
      heading: "Governing law",
      body: "This agreement is governed by the applicable laws of Uganda.",
    },
  ],
  signingCity: "Kampala",
};

const textKeys = Object.keys(DEFAULT_CONTRACT_TERMS).filter(
  (key) => key !== "additionalClauses",
) as (keyof Omit<ContractTerms, "additionalClauses">)[];

export function readContractTerms(value: Json | null | undefined): ContractTerms {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ...DEFAULT_CONTRACT_TERMS,
      additionalClauses: [...DEFAULT_CONTRACT_TERMS.additionalClauses],
    };
  }
  const terms = { ...DEFAULT_CONTRACT_TERMS };
  for (const key of textKeys) {
    const field = value[key];
    if (typeof field === "string") terms[key] = field;
  }
  const clauses = value["additionalClauses"];
  if (Array.isArray(clauses)) {
    terms.additionalClauses = clauses.flatMap((clause) => {
      if (typeof clause !== "object" || clause === null || Array.isArray(clause)) return [];
      const heading = clause["heading"];
      const body = clause["body"];
      return typeof heading === "string" && typeof body === "string" ? [{ heading, body }] : [];
    });
  }
  return terms;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function asHtml(value: string): string {
  return escapeHtml(value.trim()).replace(/\r?\n/g, "<br>");
}

export function buildContractHtml(
  contract: {
    contractType: string;
    startDate: string;
    endDate: string;
  },
  terms: ContractTerms,
): string {
  const dateLabel = (value: string) => {
    const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(year, month - 1, day, 12));
  };
  const startDate = dateLabel(contract.startDate);
  const isPermanent = contract.contractType.toLowerCase().includes("permanent");
  const endDate = contract.endDate
    ? ` until ${escapeHtml(dateLabel(contract.endDate))}`
    : isPermanent
      ? " with no fixed end date"
      : "; the end date must be completed before signing";
  const employerContact = [terms.employerAddress, terms.employerEmail, terms.employerPhone]
    .filter(Boolean)
    .map(asHtml)
    .join(" · ");
  const allParticulars: [string, string][] = [
    ["Employee number", terms.employeeNumber],
    ["National ID / passport", terms.employeeNationalId],
    ["Employee address", terms.employeeAddress],
    ["Employee phone", terms.employeePhone],
    ["Employee email", terms.employeeEmail],
    ["Position", terms.jobTitle],
    ["Department", terms.department],
    ["Work location", terms.workLocation],
    [
      "Remuneration",
      terms.payAmount ? `${terms.payCurrency} ${terms.payAmount} ${terms.payFrequency}` : "",
    ],
    ["Allowances", terms.payAllowances ? `${terms.payCurrency} ${terms.payAllowances}` : ""],
    ["Probation", terms.probationPeriod],
    ["Working hours", terms.workingHours],
    ["Annual leave", terms.annualLeave],
    ["Notice period", terms.noticePeriod],
    ["Reports to", terms.reportsTo],
  ];
  const particulars = allParticulars.filter((entry) => entry[1].trim());
  const clauses = [
    {
      heading: "Duties and responsibilities",
      body: terms.duties,
    },
    ...terms.additionalClauses.filter((clause) => clause.heading.trim() || clause.body.trim()),
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Employment Contract - ${escapeHtml(terms.employeeName)}</title>
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #171717; font: 11pt/1.55 Arial, sans-serif; }
    header { border-bottom: 2px solid #d6532e; margin-bottom: 24px; padding-bottom: 14px; }
    h1 { margin: 0 0 4px; font-size: 20pt; text-align: center; text-transform: uppercase; }
    h2 { margin: 22px 0 8px; font-size: 12pt; }
    p { margin: 7px 0; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; }
    th, td { padding: 6px 8px; border: 1px solid #aaa; text-align: left; vertical-align: top; }
    th { width: 32%; background: #f4f4f4; }
    .subtitle, .contact { text-align: center; }
    table { table-layout: fixed; overflow-wrap: anywhere; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px 32px; margin-top: 54px; }
    .signature { border-top: 1px solid #333; padding-top: 7px; }
    .witnesses { margin-top: 42px; }
    .muted { color: #555; font-size: 9pt; }
    @media screen {
      body { width: 100%; max-width: 210mm; min-height: 297mm; margin: 0 auto; padding: 28px; }
    }
    @media print {
      body { width: auto; max-width: none; min-height: 0; margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${asHtml(terms.employerName || "Employer")}</h1>
    ${terms.employerRegistration ? `<p class="subtitle">Registration no.: ${asHtml(terms.employerRegistration)}</p>` : ""}
    ${employerContact ? `<p class="contact muted">${employerContact}</p>` : ""}
  </header>
  <h1>Employment Contract</h1>
  <p class="subtitle"> ${escapeHtml(contract.contractType.replaceAll("_", " "))} employment</p>
  <p>This Employment Contract is made on ${escapeHtml(startDate)} between <strong>${asHtml(terms.employerName || "the Employer")}</strong> (the "Employer") and <strong>${asHtml(terms.employeeName || "the Employee")}</strong> (the "Employee").</p>
  <p>The Employer appoints the Employee as <strong>${asHtml(terms.jobTitle || "the agreed position")}</strong>, commencing on <strong>${escapeHtml(startDate)}</strong>${endDate}.</p>
  <h2>Employment particulars</h2>
  <table><tbody>${particulars.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${asHtml(value)}</td></tr>`).join("")}</tbody></table>
  ${clauses.map((clause, index) => `<section><h2>${index + 1}. ${asHtml(clause.heading || "Additional term")}</h2><p>${asHtml(clause.body)}</p></section>`).join("")}
  <p>The parties confirm that they have read and understood this agreement, have had an opportunity to ask questions, and agree to its terms. Each party should retain a signed copy.</p>
  <div class="signatures">
    <div class="signature"><strong>For the Employer</strong><p>Name: ${asHtml(terms.employerRepresentative || "______________________________")}</p><p>Title: ${asHtml(terms.employerRepresentativeTitle || "_______________________________")}</p><p>Signature: ___________________________</p><p>Date: _______________________________</p></div>
    <div class="signature"><strong>The Employee</strong><p>Name: ${asHtml(terms.employeeName || "______________________________")}</p><p>Signature: ___________________________</p><p>Date: _______________________________</p></div>
  </div>
  <div class="witnesses">
    <h2>Witnesses</h2>
    <div class="signatures">
      <div class="signature"><strong>Employer witness</strong><p>Name: ______________________________</p><p>Signature: ___________________________</p><p>Date: _______________________________</p></div>
      <div class="signature"><strong>Employee witness</strong><p>Name: ______________________________</p><p>Signature: ___________________________</p><p>Date: _______________________________</p></div>
    </div>
    ${terms.signingCity ? `<p class="muted">Signed at ${asHtml(terms.signingCity)}.</p>` : ""}
  </div>
</body>
</html>`;
}
