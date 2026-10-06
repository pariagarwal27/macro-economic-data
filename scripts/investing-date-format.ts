/** ISO YYYY-MM-DD → Investing.com picker string (MM/DD/YYYY). */
export function isoToPickerDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}
