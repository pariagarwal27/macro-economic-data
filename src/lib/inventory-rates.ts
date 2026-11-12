type Point = { date: string; value: number };

/** Inventory investment is a signed flow. Use |base| so a recovery has a positive sign. */
export function inventoryRates(history: Point[]) {
  const byDate = new Map(history.filter(point => Number.isFinite(point.value)).map(point => [point.date.slice(0, 10), point.value]));
  const date = [...byDate.keys()].sort().at(-1);
  if (!date) return { yoy: null, mom: null, secondLabel: "QoQ" };
  const current = byDate.get(date)!;
  const change = (months: number) => {
    const [year, month] = date.split("-").map(Number);
    const baseDate = new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10);
    const base = byDate.get(baseDate);
    return base != null && base !== 0 ? (current - base) / Math.abs(base) * 100 : null;
  };
  return { yoy: change(12), mom: change(3), secondLabel: "QoQ" };
}
