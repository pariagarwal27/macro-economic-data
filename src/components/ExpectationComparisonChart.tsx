import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Fragment } from "react";
import { getExpectationAxisTicks, getNiceTickDomain, getTickPrecision } from "@/lib/chart-axis";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";

type Point = {
  date: string;
  value: number;
};

type Series = {
  id: string;
  label: string;
  data: Point[];
  horizon?: string;
  frequency?: string;
  axis?: "left" | "right";
};

type Props = {
  title: string;
  note?: string;
  series: Series[];
  expanded?: boolean;
  hideMarkers?: boolean;
  showAlternateMonthlyTicks?: boolean;
};

const SERIES_COLORS = ["#176b56", "#3e78a8", "#b75d3d", "#8065a8", "#b1832d", "#3d8790", "#b45472"];

/**
 * Convert any observation date into a calendar-month key.
 *
 * Examples:
 *   2026-05-01 -> 2026-05
 *   2026-05-31 -> 2026-05
 *
 * This is important because different sources can publish the
 * same monthly observation using different day-of-month conventions.
 */
function monthKey(value: string) {
  const match = String(value).match(/^(\d{4})-(\d{2})/);

  if (!match) return null;

  return `${match[1]}-${match[2]}`;
}

function compactMonthLabel(value: string, includeYear: boolean) {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  return includeYear ? `${month} '${match[1]!.slice(-2)}` : month;
}

function fullMonthLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/);

  if (!match) return value;

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      1
    )
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function percent(value: unknown, maximumFractionDigits = 1) {
  const n = Number(value);

  if (!Number.isFinite(n)) return "—";

  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(n)}%`;
}

export function ExpectationComparisonChart({
  title,
  note,
  series,
  expanded = false,
  hideMarkers = false,
  showAlternateMonthlyTicks = false,
}: Props) {
  /*
   * Expectations are monthly economic observations.
   *
   * We therefore compare observations by YEAR + MONTH rather
   * than exact calendar day.
   *
   * Example:
   *
   *   BoE       2026-05-01 -> 2026-05
   *   Citi      2026-05-31 -> 2026-05
   *
   * They now correctly occupy the same X-axis position.
   */

  const hasDailySeries = series.some((item) => item.frequency === "daily" || item.frequency === "hourly");
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const currentMonthKey = todayKey.slice(0, 7);

  const valid = series
    .map((item) => {
      const byMonth = new Map<string, number>();
      const isDaily = item.frequency === "daily" || item.frequency === "hourly";

      for (const point of item.data ?? []) {
        const date = String(point.date).slice(0, 10);
        const month = monthKey(date);
        const value = Number(point.value);

        if (!month || !Number.isFinite(value)) {
          continue;
        }

        if (isDaily ? date > todayKey : month! > currentMonthKey) {
          continue;
        }

        /*
         * If a source contains multiple observations in the same
         * month, keep the latest one encountered.
         */
        byMonth.set(isDaily ? date : month!, value);
      }

      return {
        ...item,
        data: [...byMonth.entries()]
          .map(([date, value]) => ({
            date,
            value,
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    })
    .filter((item) => item.data.length > 0);

  const hasDualAxis = valid.some((item) => item.axis != null);

  if (!valid.length) {
    return (
      <div className="expectation-comparison-card">
        <div className="expectation-comparison-heading mb-3">
        <h4 className="text-sm font-semibold text-[var(--ink)]">
          {title}
        </h4>

        {note ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {note}
          </p>
        ) : null}

        </div>
        <div className="expectation-comparison-empty">
          No observations available.
        </div>
      </div>
    );
  }

  /*
   * Build one shared monthly X-axis.
   *
   * Example:
   *
   * Jan, Feb, Mar, Apr, May, Jun, Jul, Aug
   *
   * Each source is then placed against the same month.
   */
  const dates = Array.from(
    new Set(
      valid.flatMap((item) =>
        item.data.map((point) => point.date)
      )
    )
  ).sort();

  const rows = dates.map((date) => {
    const row: Record<string, string | number | null> & { date: string } = {
      date,
    };

    valid.forEach((item, index) => {
      const point = item.data.find(
        (candidate) => candidate.date === date
      );

      row[`s${index}`] =
        point?.value ?? null;
    });

    return row;
  });

  return (
    <div className="expectation-comparison-card">
      <div className="expectation-comparison-heading mb-3">
        <h4 className="text-base font-semibold text-[var(--ink)]">
          {title}
        </h4>

        {note ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {note}
          </p>
        ) : null}
      </div>

      <HistoryChartViewport dates={rows.map(row => String(row.date))} frequency={hasDailySeries ? "daily" : "monthly"} height={352} label={title} shortYearLabels>
        {(plotWidth, fromYear, toYear, isDefaultWindow) => { const yearRows = isDefaultWindow ? filterHistoryToTrailing12Months(rows) : filterHistoryByYearRange(rows, fromYear, toYear); const firstDate = String(yearRows[0]?.date ?? ""); const lastDate = String(yearRows.at(-1)?.date ?? firstDate); const firstMonth = Number(firstDate.slice(5, 7)); const lastMonth = Number(lastDate.slice(5, 7)); const monthSpan = Math.max(1, (Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4))) * 12 + lastMonth - firstMonth + 1); const monthStride = monthSpan <= 6 ? 1 : monthSpan <= 18 ? 2 : monthSpan <= 36 ? 3 : monthSpan <= 84 ? 6 : 12; const seenMonths = new Set<string>(); const axisTicks = yearRows.flatMap(row => { const date = String(row.date); const monthKey = date.slice(0, 7); const month = Number(date.slice(5, 7)); if (seenMonths.has(monthKey) || (month - 1) % monthStride !== 0) return []; seenMonths.add(monthKey); return [date]; }); const valuesForAxis = (axis: "left" | "right") => valid.filter(item => !hasDualAxis ? true : (item.axis ?? "left") === axis).flatMap(item => item.data.filter(point => yearRows.some(row => row.date === point.date)).map(point => point.value)); const leftTicks = getExpectationAxisTicks(valuesForAxis("left")); const rightTicks = hasDualAxis ? getExpectationAxisTicks(valuesForAxis("right")) : []; const digitsFor = (ticks: number[]) => { return Math.max(1, getTickPrecision(ticks)); }; return <div className={`expectation-comparison-plot h-80 w-full${expanded ? " expectation-comparison-plot--expanded" : ""}`} style={{ width: plotWidth }}><ResponsiveContainer width={plotWidth} height="100%">
          <LineChart
            data={yearRows}
            margin={{
              top: 8,
              right: hasDualAxis ? 42 : 18,
              left: 4,
              bottom: 8,
            }}
          >
            <CartesianGrid
              stroke="var(--line)"
              strokeDasharray="2 4"
              vertical
            />

            <XAxis
              dataKey="date"
              ticks={axisTicks}
              tickFormatter={(value) => {
                const month = String(value).slice(5, 7);
                return compactMonthLabel(String(value), month === "01" || yearRows[0]?.date === value);
              }}
              tick={{
                fontSize: showAlternateMonthlyTicks ? 9 : 10,
                fill: "var(--muted)",
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={18}
              interval={0}
              padding={{
                left: 8,
                right: 8,
              }}
            />

            <YAxis allowDataOverflow
              yAxisId={hasDualAxis ? "left" : undefined}
              domain={getNiceTickDomain(leftTicks)}
              ticks={leftTicks}
              tickFormatter={(value) => percent(value, digitsFor(leftTicks))}
              className={hasDualAxis ? "expectation-y-axis-left" : undefined}
              label={hasDualAxis ? {
                value: valid.find(item => (item.axis ?? "left") === "left")?.horizon ?? "Left",
                angle: -90,
                position: "insideLeft",
                fill: SERIES_COLORS[0],
                style: { fontSize: 10, fontWeight: 700 },
              } : undefined}
              tick={{
                fontSize: 11,
                fontWeight: 600,
                fill: hasDualAxis ? SERIES_COLORS[0] : "var(--muted)",
              }}
              interval={0}
              axisLine={hasDualAxis ? { stroke: SERIES_COLORS[0], strokeWidth: 1.25 } : false}
              tickLine={false}
              width={52}
              allowDecimals
              tickCount={5}
            />

            {hasDualAxis ? <YAxis allowDataOverflow
              yAxisId="right"
              orientation="right"
              domain={getNiceTickDomain(rightTicks)}
              ticks={rightTicks}
              tickFormatter={(value) => percent(value, digitsFor(rightTicks))}
              className="expectation-y-axis-right"
              label={{
                value: valid.find(item => item.axis === "right")?.horizon ?? "Right",
                angle: -90,
                position: "insideRight",
                fill: SERIES_COLORS[1],
                style: { fontSize: 10, fontWeight: 700 },
              }}
              tick={{ fontSize: 11, fontWeight: 600, fill: SERIES_COLORS[1] }}
              interval={0}
              axisLine={{ stroke: SERIES_COLORS[1], strokeWidth: 1.25 }}
              tickLine={false}
              width={52}
              allowDecimals
              tickCount={5}
            /> : null}

            <Tooltip
              cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 3" }}
              trigger={hideMarkers ? "click" : "hover"}
              labelFormatter={(label) =>
                hasDailySeries ? fullDayLabel(String(label)) : fullMonthLabel(String(label))
              }
              formatter={(value, name) => [
                percent(value, 2),
                String(name),
              ]}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                color: "var(--ink)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                fontSize: 12,
              }}
            />

            <Legend
              verticalAlign="bottom"
              height={42}
              wrapperStyle={{
                fontSize: 11,
                paddingTop: 8,
                color: "var(--muted)",
              }}
            />

            {valid.map((item, index) => {
              const color = SERIES_COLORS[index % SERIES_COLORS.length];
              return <Fragment key={item.id}><Area yAxisId={hasDualAxis ? item.axis ?? "left" : undefined} type="linear" dataKey={`s${index}`} baseValue={hasDualAxis && (item.axis ?? "left") === "right" ? rightTicks[0] ?? "dataMin" : leftTicks[0] ?? "dataMin"} fill={color} fillOpacity={0.12} stroke="none" connectNulls tooltipType="none" isAnimationActive={false} /><Line
                key={item.id}
                yAxisId={hasDualAxis ? item.axis ?? "left" : undefined}
                type="linear"
                dataKey={`s${index}`}
                name={item.label}
                stroke={color}
                strokeWidth={2.2}
                dot={hideMarkers ? false : {
                  r: 3,
                  fill: "var(--panel)",
                  stroke: color,
                  strokeWidth: 1.5,
                }}
                activeDot={{
                  r: 5,
                  fill: color,
                  stroke: "var(--panel)",
                  strokeWidth: 2,
                }}
                connectNulls={true}
                isAnimationActive={false}
              /></Fragment>;
            })}
          </LineChart>
        </ResponsiveContainer></div>; }}
      </HistoryChartViewport>
    </div>
  );
}

function fullDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
