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

export const ugx = (n: number) =>
  "UGX " + Math.round(Number(n) || 0).toLocaleString("en-UG");
