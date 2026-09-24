export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const BOM = "\ufeff";
const ROW_SEPARATOR = "\r\n";

function encodeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";

  let encoded = String(value);
  if (FORMULA_LEAD.test(encoded)) encoded = `'${encoded}`;
  if (/[",\r\n]/.test(encoded)) return `"${encoded.replace(/"/g, '""')}"`;
  return encoded;
}

export function encodeCsv(rows: readonly (readonly CsvCell[])[]): string {
  return BOM + rows.map((row) => row.map(encodeCell).join(",")).join(ROW_SEPARATOR);
}
