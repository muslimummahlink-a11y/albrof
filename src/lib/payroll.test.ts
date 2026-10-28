import { describe, it, expect } from "vitest";
import {
  computeCasualOvertimeAmount,
  computeCasualPayslip,
  computePaye,
  computePayslip,
  computeWeeklyPayslip,
} from "./payroll";

describe("Uganda payroll", () => {
  it("no PAYE up to 235,000", () => expect(computePaye(235_000)).toBe(0));
  it("10% band", () => expect(computePaye(335_000)).toBe(10_000));
  it("20% band", () => expect(computePaye(410_000)).toBe(25_000));
  it("30% band", () => expect(computePaye(1_000_000)).toBe(202_000));
  it("extra 10% above 10M", () => expect(computePaye(11_000_000)).toBe(3_202_000 + 100_000));
  it("NSSF 5% / 10% and net", () => {
    const p = computePayslip(900_000, 100_000);
    expect(p.nssf_employee).toBe(50_000);
    expect(p.nssf_employer).toBe(100_000);
    expect(p.net).toBe(1_000_000 - 202_000 - 50_000);
  });
  it("prorates monthly salary and tax for a weekly payroll run", () => {
    const weekly = computeWeeklyPayslip(1_000_000, 0);
    expect(weekly.basic_pay).toBe(Math.round((1_000_000 * 12) / 52));
    expect(weekly.gross).toBe(weekly.basic_pay);
    expect(weekly.paye).toBe(Math.round((computePaye((weekly.gross * 52) / 12) * 12) / 52));
    expect(weekly.nssf_employee).toBe(Math.round(weekly.gross * 0.05));
    expect(weekly.net).toBe(weekly.gross - weekly.paye - weekly.nssf_employee);
  });

  it("pays casual workers by attended day with no PAYE or NSSF deductions", () => {
    const casual = computeCasualPayslip(10_000, 6);
    expect(casual.basic_pay).toBe(60_000);
    expect(casual.paye).toBe(0);
    expect(casual.nssf_employee).toBe(0);
    expect(casual.nssf_employer).toBe(0);
    expect(casual.net).toBe(60_000);
  });

  it("adds casual overtime pay without applying PAYE or NSSF", () => {
    const casual = computeCasualPayslip(10_000, 8, 25_000);
    expect(casual.gross).toBe(105_000);
    expect(casual.overtime_pay).toBe(25_000);
    expect(casual.paye).toBe(0);
    expect(casual.nssf_employee).toBe(0);
    expect(casual.net).toBe(105_000);
  });

  it("supports all casual overtime entry methods", () => {
    expect(computeCasualOvertimeAmount({ method: "direct_amount", amount: 20_000 })).toBe(20_000);
    expect(
      computeCasualOvertimeAmount({ method: "hours_rate", hours: 2.5, hourlyRate: 4_000 }),
    ).toBe(10_000);
    expect(computeCasualOvertimeAmount({ method: "special_day_bonus", amount: 15_000 })).toBe(
      15_000,
    );
  });
});
