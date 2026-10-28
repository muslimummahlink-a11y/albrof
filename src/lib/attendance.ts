export type AttendanceCsvEvent = {
  employee_no: string;
  occurred_at: string;
  event_type: string;
  device_serial: string;
  raw_event: Record<string, string>;
};

export type AttendanceEvent = Pick<
  AttendanceCsvEvent,
  "employee_no" | "occurred_at" | "event_type"
> & { raw_event?: unknown };

export type AttendanceSummary = {
  attendance_days: number;
  attendance_hours: number;
};

export type ManualAttendanceStatus = "present" | "partial" | "late" | "absent" | "leave";

export function getManualAttendanceStatus(rawEvent: unknown): ManualAttendanceStatus {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return "present";
  const status = (rawEvent as Record<string, unknown>).attendance_status;
  if (status === "partial" || status === "late" || status === "absent" || status === "leave") {
    return status;
  }
  return "present";
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"' && inQuotes && csv[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error("The attendance CSV has an unclosed quotation mark.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function headerKey(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function localKampalaTimestamp(value: string): string {
  const normalized = value.trim().replace(/\//g, "-").replace(" ", "T");
  const localMatch = normalized.match(/^(\d{4}-\d{1,2}-\d{1,2}T\d{2}:\d{2}(?::\d{2})?)$/);
  const timestamp = new Date(localMatch ? `${normalized}+03:00` : normalized);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(
      `Invalid attendance date or time: "${value}". Use YYYY-MM-DD HH:mm:ss or ISO 8601.`,
    );
  }
  return timestamp.toISOString();
}

function normalizeEventType(value: string | undefined): string {
  const event = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!event) return "punch";
  if (["in", "checkin", "check_in", "clockin", "clock_in"].includes(event)) return "check_in";
  if (["out", "checkout", "check_out", "clockout", "clock_out"].includes(event)) return "check_out";
  return event;
}

export function parseAttendanceCsv(csv: string): AttendanceCsvEvent[] {
  const rows = parseCsvRows(csv);
  const header = rows.shift();
  if (!header) throw new Error("The attendance CSV is empty.");

  const columns = new Map(header.map((name, index) => [headerKey(name), index]));
  const findColumn = (...names: string[]) => names.map(headerKey).find((name) => columns.has(name));
  const employeeColumn = findColumn(
    "employee_no",
    "employee number",
    "employee id",
    "badge number",
    "pin",
  );
  const timestampColumn = findColumn(
    "timestamp",
    "datetime",
    "date time",
    "check time",
    "occurred at",
  );
  const dateColumn = findColumn("date", "check date");
  const timeColumn = findColumn("time", "check-in time");
  const eventColumn = findColumn("event_type", "event type", "direction", "event", "status");
  const serialColumn = findColumn("device_serial", "device serial", "serial number", "terminal sn");

  if (!employeeColumn || (!timestampColumn && !(dateColumn && timeColumn))) {
    throw new Error(
      "CSV must include employee_no and timestamp columns. Alternatively, provide employee_no, date and time.",
    );
  }

  const parsed = rows.map((values, index) => {
    if (values.length !== header.length) {
      throw new Error(
        `CSV row ${index + 2} has ${values.length} fields; expected ${header.length}.`,
      );
    }

    const employee_no = values[columns.get(employeeColumn)!] ?? "";
    const dateTime = timestampColumn
      ? (values[columns.get(timestampColumn)!] ?? "")
      : `${values[columns.get(dateColumn!)!] ?? ""} ${values[columns.get(timeColumn!)!] ?? ""}`;
    const event_type = normalizeEventType(
      eventColumn ? values[columns.get(eventColumn)!] : undefined,
    );
    const device_serial = serialColumn ? (values[columns.get(serialColumn)!] ?? "") : "";
    const occurred_at = localKampalaTimestamp(dateTime);

    if (!employee_no) throw new Error(`CSV row ${index + 2} is missing an employee number.`);

    return {
      employee_no,
      occurred_at,
      event_type,
      device_serial,
      raw_event: { employee_no, timestamp: dateTime, event_type, device_serial },
    };
  });

  return parsed;
}

export function summarizeAttendance(
  events: AttendanceEvent[],
  employeeIds: Map<string, string>,
): Map<string, AttendanceSummary> {
  const byEmployeeDay = new Map<string, AttendanceEvent[]>();
  const timeZone = "Africa/Kampala";

  for (const event of events) {
    const employeeId = employeeIds.get(event.employee_no);
    if (!employeeId) continue;

    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(event.occurred_at));
    const key = `${employeeId}:${day}`;
    const dayEvents = byEmployeeDay.get(key) ?? [];
    dayEvents.push(event);
    byEmployeeDay.set(key, dayEvents);
  }

  const summary = new Map<string, AttendanceSummary>();
  for (const [key, dayEvents] of byEmployeeDay) {
    const countableEvents = dayEvents.filter(
      (event) =>
        event.event_type !== "manual_attendance" ||
        !["absent", "leave"].includes(getManualAttendanceStatus(event.raw_event)),
    );
    if (!countableEvents.length) continue;

    const employeeId = key.slice(0, key.indexOf(":"));
    const employeeSummary = summary.get(employeeId) ?? { attendance_days: 0, attendance_hours: 0 };
    employeeSummary.attendance_days += 1;

    const checkIns = countableEvents
      .filter((event) => ["in", "check_in", "check-in", "clock_in"].includes(event.event_type))
      .map((event) => new Date(event.occurred_at).getTime());
    const checkOuts = countableEvents
      .filter((event) => ["out", "check_out", "check-out", "clock_out"].includes(event.event_type))
      .map((event) => new Date(event.occurred_at).getTime());

    if (checkIns.length && checkOuts.length) {
      const firstIn = Math.min(...checkIns);
      const lastOut = Math.max(...checkOuts);
      const hours = (lastOut - firstIn) / (60 * 60 * 1000);
      if (hours > 0 && hours <= 18) employeeSummary.attendance_hours += hours;
    }
    summary.set(employeeId, employeeSummary);
  }

  for (const employeeSummary of summary.values()) {
    employeeSummary.attendance_hours = Math.round(employeeSummary.attendance_hours * 100) / 100;
  }

  return summary;
}
