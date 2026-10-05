import { describe, it, expect } from "vitest";
import { computePaye, computePayslip } from "./payroll";

describe("Uganda payroll", () => {
  it("no PAYE up to 235,000", () => expect(computePaye(235_000)).toBe(0));
  it("10% band", () => expect(computePaye(335_000)).toBe(10_000));
  it("20% band", () => expect(computePaye(410_000)).toBe(25_000));
  it("30% band", () => expect(computePaye(1_000_000)).toBe(202_000));
  it("extra 10% above 10M", () => expect(computePaye(11_000_000)).toBe(3_277_000 + 100_000));
  it("NSSF 5% / 10% and net", () => {
    const p = computePayslip(900_000, 100_000);
    expect(p.nssf_employee).toBe(50_000);
    expect(p.nssf_employer).toBe(100_000);
    expect(p.net).toBe(1_000_000 - 202_000 - 50_000);
  });
});
