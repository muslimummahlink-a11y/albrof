import { describe, expect, it } from "vitest";
import { parseAttendanceCsv, summarizeAttendance } from "./attendance";

describe("attendance CSV import", () => {
  it("parses quoted fields and normalizes a local Hikvision timestamp to Kampala time", () => {
    const events = parseAttendanceCsv(
      'employee_no,timestamp,event_type,device_serial\nE-01,2026-10-05 08:00:00,check_in,STADIUM-1\nE-01,2026-10-05 17:00:00,check_out,STADIUM-1\nE-02,2026-10-05 08:05:00,"check_in",STADIUM-1',
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      employee_no: "E-01",
      occurred_at: "2026-10-05T05:00:00.000Z",
      event_type: "check_in",
      device_serial: "STADIUM-1",
    });
    expect(events[2]?.event_type).toBe("check_in");
  });

  it("accepts a separate date and time column and reports malformed input", () => {
    expect(parseAttendanceCsv("PIN,Date,Time\nE-02,2026-10-05,08:10:00")[0]?.employee_no).toBe(
      "E-02",
    );
    expect(() => parseAttendanceCsv("Name,Time\nAlice,08:00")).toThrow("must include employee_no");
    expect(() => parseAttendanceCsv("employee_no,timestamp\nE-01,not-a-date")).toThrow(
      "Invalid attendance date",
    );
    expect(() => parseAttendanceCsv('employee_no,timestamp\nE-01,"unfinished')).toThrow(
      "unclosed quotation",
    );
  });
});

describe("weekly attendance summary", () => {
  it("counts Kampala attendance days and paired work hours by employee", () => {
    const summary = summarizeAttendance(
      [
        { employee_no: "E-01", occurred_at: "2026-10-04T05:00:00.000Z", event_type: "check_in" },
        { employee_no: "E-01", occurred_at: "2026-10-04T14:00:00.000Z", event_type: "check_out" },
        { employee_no: "E-01", occurred_at: "2026-10-05T05:00:00.000Z", event_type: "check_in" },
        { employee_no: "E-01", occurred_at: "2026-10-05T14:30:00.000Z", event_type: "check_out" },
        { employee_no: "E-02", occurred_at: "2026-10-05T05:00:00.000Z", event_type: "punch" },
      ],
      new Map([
        ["E-01", "employee-1"],
        ["E-02", "employee-2"],
      ]),
    );

    expect(summary.get("employee-1")).toEqual({ attendance_days: 2, attendance_hours: 18.5 });
    expect(summary.get("employee-2")).toEqual({ attendance_days: 1, attendance_hours: 0 });
  });

  it("excludes manually recorded absences and leave from worked attendance days", () => {
    const summary = summarizeAttendance(
      [
        {
          employee_no: "E-01",
          occurred_at: "2026-10-05T09:00:00.000Z",
          event_type: "manual_attendance",
          raw_event: { attendance_status: "absent" },
        },
        {
          employee_no: "E-02",
          occurred_at: "2026-10-05T09:00:00.000Z",
          event_type: "manual_attendance",
          raw_event: { attendance_status: "leave" },
        },
        {
          employee_no: "E-03",
          occurred_at: "2026-10-05T09:00:00.000Z",
          event_type: "manual_attendance",
          raw_event: { attendance_status: "partial" },
        },
        {
          employee_no: "E-04",
          occurred_at: "2026-10-05T09:00:00.000Z",
          event_type: "manual_attendance",
          raw_event: { attendance_status: "late" },
        },
      ],
      new Map([
        ["E-01", "employee-1"],
        ["E-02", "employee-2"],
        ["E-03", "employee-3"],
        ["E-04", "employee-4"],
      ]),
    );

    expect(summary.has("employee-1")).toBe(false);
    expect(summary.has("employee-2")).toBe(false);
    expect(summary.get("employee-3")?.attendance_days).toBe(1);
    expect(summary.get("employee-4")?.attendance_days).toBe(1);
  });
});
