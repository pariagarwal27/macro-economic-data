import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getNiceTickDomain, getNiceTicks } from "@/lib/chart-axis";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";

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
};

type Props = {
  title: string;
  note?: string;
  series: Series[];
};

const LINE_DASHES = ["", "6 3", "2 3", "8 3 2 3"];

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

function monthLabel(value: string) {
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
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
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

  const currentYear = 2026;
  const hasDailySeries = series.some((item) => item.frequency === "daily" || item.frequency === "hourly");
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

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

        const pointYear = Number(date.slice(0, 4));
        if (isDaily ? date > todayKey : pointYear > currentYear || !month) {
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
          {hasDailySeries ? "No observations available." : `No ${currentYear} observations available.`}
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
    const row: Record<string, string | number | null> = {
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

      <HistoryChartViewport dates={rows.map(row => String(row.date))} frequency={hasDailySeries ? "daily" : "monthly"} height={320} label={title}>
        {(plotWidth, year) => { const yearRows = rows.filter(row => String(row.date).slice(0, 4) === String(year)); const yearValues = valid.flatMap(item => item.data.filter(point => point.date.slice(0, 4) === String(year)).map(point => point.value)); const yearTicks = getNiceTicks(yearValues, 5, 0.05); const yearStep = yearTicks.length > 1 ? Math.abs(yearTicks[1]! - yearTicks[0]!) : 0.1; const yearDigits = yearStep < 0.1 ? 2 : 1; return <div className="expectation-comparison-plot h-80 w-full" style={{ width: plotWidth }}><ResponsiveContainer width={plotWidth} height="100%">
          <LineChart
            data={yearRows}
            margin={{
              top: 8,
              right: 18,
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
              tickFormatter={hasDailySeries ? dayLabel : monthLabel}
              tick={{
                fontSize: 10,
                fill: "var(--muted)",
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={hasDailySeries ? 28 : 18}
              interval="preserveStartEnd"
              padding={{
                left: 8,
                right: 8,
              }}
            />

            <YAxis
              domain={getNiceTickDomain(yearTicks)}
              ticks={yearTicks}
              tickFormatter={(value) => percent(value, yearDigits)}
              tick={{
                fontSize: 11,
                fill: "var(--muted)",
              }}
              axisLine={false}
              tickLine={false}
              width={52}
              allowDecimals
              tickCount={5}
            />

            <Tooltip
              labelFormatter={(label) =>
                hasDailySeries ? fullDayLabel(String(label)) : fullMonthLabel(String(label))
              }
              formatter={(value, name) => [
                percent(value),
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

            {valid.map((item, index) => (
              <Line
                key={item.id}
                type="linear"
                dataKey={`s${index}`}
                name={item.label}
                stroke="var(--country-series, var(--accent))"
                strokeDasharray={LINE_DASHES[index % LINE_DASHES.length]}
                strokeWidth={2.4}
                dot={{
                  r: 3,
                  fill: "var(--panel)",
                  strokeWidth: 1.5,
                }}
                activeDot={{
                  r: 5,
                }}
                connectNulls={true}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer></div>; }}
      </HistoryChartViewport>
    </div>
  );
}

function dayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function fullDayLabel(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
