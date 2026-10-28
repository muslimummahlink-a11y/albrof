// Uganda resident monthly PAYE + NSSF (5% employee, 10% employer).
export function computePaye(gross: number): number {
  let tax = 0;
  if (gross <= 235_000) tax = 0;
  else if (gross <= 335_000) tax = (gross - 235_000) * 0.1;
  else if (gross <= 410_000) tax = 10_000 + (gross - 335_000) * 0.2;
  else tax = 25_000 + (gross - 410_000) * 0.3;
  if (gross > 10_000_000) tax += (gross - 10_000_000) * 0.1;
  return Math.round(tax);
}

export function computePayslip(base: number, allowances: number) {
  const gross = Number(base) + Number(allowances);
  const paye = computePaye(gross);
  const nssf_employee = Math.round(gross * 0.05);
  const nssf_employer = Math.round(gross * 0.1);
  const net = gross - paye - nssf_employee;
  return { gross, paye, nssf_employee, nssf_employer, net };
}

export function computeWeeklyPayslip(monthlyBase: number, monthlyAllowances: number) {
  const basic_pay = Math.round((Number(monthlyBase) * 12) / 52);
  const allowances = Math.round((Number(monthlyAllowances) * 12) / 52);
  const gross = basic_pay + allowances;
  const monthlyEquivalent = Math.round((gross * 52) / 12);
  const paye = Math.round((computePaye(monthlyEquivalent) * 12) / 52);
  const nssf_employee = Math.round(gross * 0.05);
  const nssf_employer = Math.round(gross * 0.1);
  const net = gross - paye - nssf_employee;

  return { basic_pay, allowances, gross, paye, nssf_employee, nssf_employer, net };
}

export function computeCasualPayslip(dailyRate: number, attendanceDays: number, overtimePay = 0) {
  if (!Number.isFinite(dailyRate) || dailyRate < 0) {
    throw new Error("Casual daily rate must be a non-negative number.");
  }
  if (!Number.isInteger(attendanceDays) || attendanceDays < 0) {
    throw new Error("Casual attendance days must be a non-negative whole number.");
  }
  if (!Number.isFinite(overtimePay) || overtimePay < 0) {
    throw new Error("Casual overtime pay must be a non-negative number.");
  }

  const basic_pay = Math.round(dailyRate * attendanceDays);
  const gross = basic_pay + Math.round(overtimePay);
  return {
    basic_pay,
    allowances: 0,
    gross,
    paye: 0,
    nssf_employee: 0,
    nssf_employer: 0,
    net: gross,
    overtime_pay: Math.round(overtimePay),
  };
}

export type CasualOvertimeMethod = "direct_amount" | "hours_rate" | "special_day_bonus";

export function computeCasualOvertimeAmount(input: {
  method: CasualOvertimeMethod;
  amount?: number;
  hours?: number;
  hourlyRate?: number;
}): number {
  if (input.method === "hours_rate") {
    const hours = input.hours ?? Number.NaN;
    const hourlyRate = input.hourlyRate ?? Number.NaN;
    if (!Number.isFinite(hours) || !Number.isFinite(hourlyRate) || hours <= 0 || hourlyRate <= 0) {
      throw new Error("Overtime hours and hourly rate must both be greater than zero.");
    }
    return Math.round(hours * hourlyRate * 100) / 100;
  }

  const amount = input.amount ?? Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter an overtime amount greater than zero.");
  }
  return Math.round(amount * 100) / 100;
}

export const ugx = (n: number) => "UGX " + Math.round(Number(n) || 0).toLocaleString("en-UG");
