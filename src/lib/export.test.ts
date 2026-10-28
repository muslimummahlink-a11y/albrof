import { describe, expect, it } from "vitest";
import { toCsv } from "./export";

describe("CSV exports", () => {
  it("quotes fields, escapes quotes, and prevents spreadsheet formula execution", () => {
    expect(
      toCsv([
        ["Employee", "Note", "Value"],
        ["=cmd()", 'said "hello"', 2500],
      ]),
    ).toBe('"Employee","Note","Value"\r\n"\'=cmd()","said ""hello""","2500"');
  });
});
