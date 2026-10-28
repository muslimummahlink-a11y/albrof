import { describe, expect, it } from "vitest";
import { parseCasualPayrollCsv } from "./casual-payroll-import";

describe("casual payroll import", () => {
  it("parses comma-separated rows with quoted thousands separators", () => {
    const rows = parseCasualPayrollCsv(
      'No,NAME,POSITION,DAYS,RATE,AMOUNT,CONTACT\n1,"ABITEGEKA ENID","CASUAL WORKER",9,"10,000","90,000",783387248',
    );
    expect(rows).toEqual([
      {
        employee_no: "CAS-2026-001",
        full_name: "ABITEGEKA ENID",
        position: "CASUAL WORKER",
        attendance_days: 9,
        daily_rate: 10_000,
        amount: 90_000,
        phone: "783387248",
      },
    ]);
  });

  it("preserves a quotation mark inside an unquoted field", () => {
    const rows = parseCasualPayrollCsv(
      'No,NAME,POSITION,DAYS,RATE,AMOUNT\n1,MUKISA "JAMES,CASUAL WORKER,1,10000,10000',
    );
    expect(rows[0]?.full_name).toBe('MUKISA "JAMES');
  });

  it("parses tab-separated payroll rows", () => {
    const rows = parseCasualPayrollCsv(
      "No\tNAME\tPOSITION\tDAYS\tRATE\tAMOUNT\tCONTACT\n1\tACULEERA BEATRICE\tCASUAL WORKER\t9\t10,000\t90,000\t790448693",
    );
    expect(rows[0]?.employee_no).toBe("CAS-2026-001");
    expect(rows[0]?.amount).toBe(90_000);
    expect(rows[0]?.phone).toBe("790448693");
  });

  it("finds the payroll headers below a title row", () => {
    const rows = parseCasualPayrollCsv(
      "Hoima Stadium casual workers payment\n\nNo,NAME,POSITION,DAYS,RATE,AMOUNT,CONTACT\n1,ABITEGEKA ENID,CASUAL WORKER,9,10000,90000,783387248",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.full_name).toBe("ABITEGEKA ENID");
    expect(rows[0]?.amount).toBe(90_000);
  });

  it("rejects totals that do not equal days multiplied by rate", () => {
    expect(() =>
      parseCasualPayrollCsv("No,NAME,POSITION,DAYS,RATE,AMOUNT\n1,A B,CASUAL WORKER,9,10000,80000"),
    ).toThrow(/amount must equal days multiplied by the daily rate/i);
  });

  it("rejects duplicate employee numbers", () => {
    expect(() =>
      parseCasualPayrollCsv(
        "No,NAME,POSITION,DAYS,RATE,AMOUNT\n1,A B,CASUAL WORKER,1,10000,10000\n1,C D,CASUAL WORKER,1,10000,10000",
      ),
    ).toThrow(/appears more than once/i);
  });
});
