import { describe, expect, it } from "vitest";
import { encodeCsv } from "./encode";

describe("encodeCsv", () => {
  it("uses a BOM, CRLF rows, and no trailing row separator", () => {
    const csv = encodeCsv([
      ["name", "value"],
      ["Château", 3],
    ]);

    expect(csv).toBe("\ufeffname,value\r\nChâteau,3");
    expect(csv.endsWith("\r\n")).toBe(false);
  });

  it("quotes commas, quotes, CR, and LF", () => {
    expect(
      encodeCsv([
        ["comma,cell", 'quote"cell'],
        ["line\nfeed", "carriage\rreturn"],
      ]),
    ).toBe('\ufeff"comma,cell","quote""cell"\r\n"line\nfeed","carriage\rreturn"');
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tformula", "\rformula"])(
    "neutralizes formula-leading cell %j",
    (value) => {
      const neutralized = `'${value}`;
      const expected = value.startsWith("\r") ? `\ufeff"${neutralized}"` : `\ufeff${neutralized}`;
      expect(encodeCsv([[value]])).toBe(expected);
    },
  );

  it("encodes null and undefined as empty cells and retains empty rows", () => {
    expect(encodeCsv([["a", null, undefined], [], ["b"]])).toBe("\ufeffa,,\r\n\r\nb");
  });
});
