import { describe, expect, it } from "vitest";
import { addDaysToDate, daysUntilDate, formatContractDate, getKampalaDate } from "./contracts";

describe("contract expiry dates", () => {
  it("uses the Kampala local date for expiry windows", () => {
    expect(getKampalaDate(new Date("2026-10-28T22:00:00.000Z"))).toBe("2026-10-29");
  });

  it("calculates lead times and handles month and year boundaries", () => {
    expect(addDaysToDate("2026-12-20", 30)).toBe("2027-01-19");
    expect(daysUntilDate("2027-01-19", "2026-12-20")).toBe(30);
    expect(daysUntilDate("2026-12-20", "2026-12-20")).toBe(0);
  });

  it("formats dates without depending on the browser time zone", () => {
    expect(formatContractDate("2026-10-29")).toBe("29 Oct 2026");
  });
});
