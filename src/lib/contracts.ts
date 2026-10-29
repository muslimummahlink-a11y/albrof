const DAY_MS = 24 * 60 * 60 * 1000;

function dateParts(date: string): [number, number, number] {
  const parts = date.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (
    parts.length !== 3 ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    throw new Error(`Invalid contract date: ${date}`);
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid contract date: ${date}`);
  }
  return [year, month, day];
}

export function getKampalaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addDaysToDate(date: string, days: number): string {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function daysUntilDate(date: string, today = getKampalaDate()): number {
  const [year, month, day] = dateParts(date);
  const [todayYear, todayMonth, todayDay] = dateParts(today);
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / DAY_MS,
  );
}

export function formatContractDate(date: string): string {
  const [year, month, day] = dateParts(date);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}
