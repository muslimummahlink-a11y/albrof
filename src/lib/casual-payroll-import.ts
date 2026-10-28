import readXlsxFile from "read-excel-file/universal";

export type CasualPayrollImportRow = {
  employee_no: string;
  full_name: string;
  position: string;
  attendance_days: number;
  daily_rate: number;
  amount: number;
  phone: string | null;
};

function parseRows(input: string): string[][] {
  const delimiter = input.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"' && quoted && input[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      if (quoted) {
        quoted = false;
      } else if (!field.trim()) {
        quoted = true;
      } else {
        field += character;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The payroll file has an unclosed quotation mark.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const requiredHeaderAliases = [
  ["employee_no", "employee number", "no", "staff no"],
  ["name", "full name", "employee name"],
  ["position", "job title"],
  ["days", "attendance days", "days worked"],
  ["rate", "daily rate", "rate per day"],
  ["amount", "total amount", "payment"],
];

function hasRequiredHeaders(row: string[]): boolean {
  const headers = new Set(row.map(normalizeHeader));
  return requiredHeaderAliases.every((aliases) =>
    aliases.some((alias) => headers.has(normalizeHeader(alias))),
  );
}

function readMoney(value: string | undefined, label: string, line: number): number {
  const normalized = value?.replace(/(?:UGX|SHS?\.?)/gi, "").replace(/[,\s]/g, "");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Line ${line}: ${label} must be a non-negative number.`);
  }
  return amount;
}

export function parseCasualPayrollCsv(input: string): CasualPayrollImportRow[] {
  return parseCasualPayrollRows(parseRows(input), false);
}

function parseCasualPayrollRows(
  rows: string[][],
  ignoreSpreadsheetFooter: boolean,
): CasualPayrollImportRow[] {
  if (!rows.length) throw new Error("The casual payroll file is empty.");
  const headerIndex = rows.findIndex(hasRequiredHeaders);
  if (headerIndex < 0) {
    throw new Error(
      "Include columns for No, Name, Position, Days, Rate and Amount. Contact is optional.",
    );
  }
  const header = rows[headerIndex];

  const columns = new Map(header.map((value, index) => [normalizeHeader(value), index]));
  const findColumn = (...aliases: string[]) =>
    aliases.map(normalizeHeader).find((name) => columns.has(name));
  const employeeNoColumn = findColumn("employee_no", "employee number", "no", "staff no");
  const nameColumn = findColumn("name", "full name", "employee name");
  const positionColumn = findColumn("position", "job title");
  const daysColumn = findColumn("days", "attendance days", "days worked");
  const rateColumn = findColumn("rate", "daily rate", "rate per day");
  const amountColumn = findColumn("amount", "total amount", "payment");
  const phoneColumn = findColumn("contact", "phone", "telephone");

  if (
    !employeeNoColumn ||
    !nameColumn ||
    !positionColumn ||
    !daysColumn ||
    !rateColumn ||
    !amountColumn
  ) {
    throw new Error(
      "Include columns for No, Name, Position, Days, Rate and Amount. Contact is optional.",
    );
  }

  const get = (row: string[], column: string) => row[columns.get(column) ?? -1]?.trim() ?? "";
  const employeeNumbers = new Set<string>();
  const dataRows = rows.slice(headerIndex + 1).flatMap((row, index) => {
    const line = headerIndex + index + 2;
    const rowName = get(row, nameColumn).toLowerCase();
    const isEmpty = row.every((value) => !value.trim());
    const hasPayrollAmountFields = [daysColumn, rateColumn, amountColumn].some((column) =>
      get(row, column),
    );
    const isFooterLabel =
      /^(?:grand\s+)?total\b|^(?:prepared|checked|approved|verified|authorized|authorised)\b|signature/i.test(
        rowName,
      );
    if (
      ignoreSpreadsheetFooter &&
      !get(row, employeeNoColumn) &&
      (isEmpty || isFooterLabel || !hasPayrollAmountFields)
    ) {
      return [];
    }
    return [{ row, line }];
  });
  const result = dataRows.map(({ row, line }) => {
    const sourceEmployeeNo = get(row, employeeNoColumn);
    const employeeNo =
      employeeNoColumn === normalizeHeader("No")
        ? `CAS-2026-${sourceEmployeeNo.padStart(3, "0")}`
        : sourceEmployeeNo;
    const fullName = get(row, nameColumn);
    const position = get(row, positionColumn);
    if (!employeeNo || !fullName || !position) {
      throw new Error(`Line ${line}: employee number, name and position are required.`);
    }
    if (employeeNumbers.has(employeeNo)) {
      throw new Error(`Line ${line}: employee number ${employeeNo} appears more than once.`);
    }
    employeeNumbers.add(employeeNo);

    const daysValue = readMoney(get(row, daysColumn), "Days", line);
    if (!Number.isInteger(daysValue) || daysValue <= 0) {
      throw new Error(`Line ${line}: days must be a positive whole number.`);
    }
    const dailyRate = readMoney(get(row, rateColumn), "Rate", line);
    const amount = readMoney(get(row, amountColumn), "Amount", line);
    if (dailyRate <= 0 || amount !== daysValue * dailyRate) {
      throw new Error(
        `Line ${line}: amount must equal days multiplied by the daily rate (${daysValue * dailyRate}).`,
      );
    }

    return {
      employee_no: employeeNo,
      full_name: fullName,
      position,
      attendance_days: daysValue,
      daily_rate: dailyRate,
      amount,
      phone: phoneColumn ? get(row, phoneColumn) || null : null,
    };
  });

  if (!result.length) throw new Error("The file does not contain any payroll rows.");
  return result;
  return result;
}

export async function parseCasualPayrollWorkbook(
  data: ArrayBuffer,
): Promise<CasualPayrollImportRow[]> {
  const worksheets = await readXlsxFile(data);
  for (const worksheet of worksheets) {
    const rows = worksheet.data.map((row) =>
      row.map((value) => (value == null ? "" : String(value))),
    );
    if (rows.some(hasRequiredHeaders)) return parseCasualPayrollRows(rows, true);
  }
  throw new Error(
    "No worksheet contains the required columns: No, Name, Position, Days, Rate and Amount.",
  );
}
