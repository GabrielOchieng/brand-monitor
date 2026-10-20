// RFC 4180 CSV. Finding identifiers are attacker-chosen (a URL or social handle), so a cell
// starting with = + - @ (or tab/CR) is prefixed with ' -- otherwise Excel/Sheets would run it
// as a formula when an analyst opens the export.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
