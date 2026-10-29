import { describe, expect, it } from "vitest";
import { buildContractHtml, DEFAULT_CONTRACT_TERMS, readContractTerms } from "./contract-document";

describe("employment contract document", () => {
  it("builds a printable contract with the supplied employment terms and signature blocks", () => {
    const html = buildContractHtml(
      { contractType: "fixed_term", startDate: "2026-11-01", endDate: "2027-10-31" },
      {
        ...DEFAULT_CONTRACT_TERMS,
        employeeName: "Amina N.",
        jobTitle: "Video Editor",
        payAmount: "1,200,000",
      },
    );

    expect(html).toContain("Employment Contract");
    expect(html).toContain("Amina N.");
    expect(html).toContain("UGX 1,200,000 monthly");
    expect(html).toContain("The Employee");
    expect(html).toContain("Employer witness");
  });

  it("escapes user-supplied values in printable markup", () => {
    const html = buildContractHtml(
      { contractType: "other", startDate: "2026-11-01", endDate: "" },
      { ...DEFAULT_CONTRACT_TERMS, employeeName: "<script>alert(1)</script>" },
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("does not describe an incomplete fixed-term contract as having no end date", () => {
    const html = buildContractHtml(
      { contractType: "Fixed-term", startDate: "2026-11-01", endDate: "" },
      DEFAULT_CONTRACT_TERMS,
    );

    expect(html).toContain("the end date must be completed before signing");
    expect(html).not.toContain("with no fixed end date");
  });

  it("restores saved JSON terms while safely defaulting absent fields", () => {
    expect(readContractTerms({ employeeName: "Saved Employee" }).employeeName).toBe(
      "Saved Employee",
    );
    expect(readContractTerms(null).employerName).toBe("BMP Media Production");
  });
});
