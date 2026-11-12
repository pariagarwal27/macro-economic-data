import { calendarWindow, type DriverHistoryPoint } from "./release-driver-model";

type MomentumInput = { id: string; label: string; rateHistory?: DriverHistoryPoint[]; subtotal?: boolean };

export function completeMomentumTotal(values: Array<number | null>): number | null {
  return values.length && values.every((value): value is number => value != null && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0) : null;
}

/** Six exact months, including the selected one; absent observations stay absent. */
export function componentMomentumRows<T extends MomentumInput>(rows: T[], selectedMonth: string) {
  const months = calendarWindow(selectedMonth);
  return {
    months,
    rows: rows.filter(row => !row.subtotal).map(row => {
      const byMonth = new Map<string, number>();
      for (const point of row.rateHistory ?? []) {
        if (point.value != null && Number.isFinite(point.value)) byMonth.set(point.period, point.value);
      }
      return { ...row, values: months.map(month => byMonth.get(month) ?? null) };
    }),
  };
}

/** A single symmetric zero-centered scale across the entire table. */
export function momentumColor(value: number, scale: number): string {
  const intensity = scale > 0 ? Math.min(Math.abs(value) / scale, 1) : 0;
  const base = [248, 247, 241];
  const target = value >= 0 ? [125, 192, 138] : [242, 143, 133];
  return `rgb(${base.map((channel, i) => Math.round(channel + (target[i] - channel) * intensity)).join(", ")})`;
}
