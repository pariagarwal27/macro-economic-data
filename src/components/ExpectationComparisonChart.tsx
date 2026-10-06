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

type Point = {
  date: string;
  value: number;
};

type Series = {
  id: string;
  label: string;
  data: Point[];
  horizon?: string;
};

type Props = {
  title: string;
  note?: string;
  series: Series[];
};

const LINE_COLORS = [
  "#2563eb",
  "#ef4444",
  "#a855f7",
  "#0f766e",
  "#f59e0b",
  "#0891b2",
  "#db2777",
  "#65a30d",
];

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

function percent(value: unknown) {
  const n = Number(value);

  return Number.isFinite(n)
    ? `${n.toFixed(1)}%`
    : "—";
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

  const currentYear = new Date().getUTCFullYear();

  const valid = series
    .map((item) => {
      const byMonth = new Map<string, number>();

      for (const point of item.data ?? []) {
        const month = monthKey(point.date);
        const value = Number(point.value);

        if (!month || !Number.isFinite(value)) {
          continue;
        }

        if (!month.startsWith(`${currentYear}-`)) {
          continue;
        }

        /*
         * If a source contains multiple observations in the same
         * month, keep the latest one encountered.
         */
        byMonth.set(month, value);
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
      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <h4 className="text-sm font-semibold text-[var(--text)]">
          {title}
        </h4>

        {note ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {note}
          </p>
        ) : null}

        <div className="mt-8 text-sm text-[var(--muted)]">
          No current-year observations available.
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

  /*
   * Calculate the Y-axis only from the observations actually
   * displayed on this chart.
   */
  const allValues = valid.flatMap((item) =>
    item.data.map((point) => point.value)
  );

  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);

  const span = maxValue - minValue;

  /*
   * Give the chart enough breathing room without producing
   * an unnecessarily huge Y-axis.
   */
  const padding =
    span > 0
      ? Math.max(span * 0.12, 0.15)
      : Math.max(Math.abs(minValue) * 0.05, 0.2);

  const yMin = minValue - padding;
  const yMax = maxValue + padding;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="mb-3">
        <h4 className="text-base font-semibold text-[var(--text)]">
          {title}
        </h4>

        {note ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {note}
          </p>
        ) : null}
      </div>

      <div className="h-80 w-full">
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={rows}
            margin={{
              top: 8,
              right: 18,
              left: 4,
              bottom: 8,
            }}
          >
            <CartesianGrid
              stroke="rgba(28,36,41,0.08)"
              vertical={false}
            />

            <XAxis
              dataKey="date"
              tickFormatter={monthLabel}
              tick={{
                fontSize: 10,
                fill: "#64748b",
              }}
              axisLine={{
                stroke: "#94a3b8",
              }}
              tickLine={{
                stroke: "#94a3b8",
              }}
              minTickGap={18}
              interval="preserveStartEnd"
              padding={{
                left: 8,
                right: 8,
              }}
            />

            <YAxis
              domain={[yMin, yMax]}
              tickFormatter={percent}
              tick={{
                fontSize: 11,
                fill: "#64748b",
              }}
              axisLine={{
                stroke: "#94a3b8",
              }}
              tickLine={{
                stroke: "#94a3b8",
              }}
              width={52}
              allowDecimals
              tickCount={5}
            />

            <Tooltip
              labelFormatter={(label) =>
                fullMonthLabel(String(label))
              }
              formatter={(value, name) => [
                percent(value),
                String(name),
              ]}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #dbe3ef",
                boxShadow:
                  "0 8px 24px rgba(15,23,42,0.10)",
                fontSize: 12,
              }}
            />

            <Legend
              verticalAlign="bottom"
              height={42}
              wrapperStyle={{
                fontSize: 11,
                paddingTop: 8,
              }}
            />

            {valid.map((item, index) => (
              <Line
                key={item.id}
                type="linear"
                dataKey={`s${index}`}
                name={item.label}
                stroke={
                  LINE_COLORS[
                    index % LINE_COLORS.length
                  ]
                }
                strokeWidth={2.4}
                dot={{
                  r: 2.5,
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
        </ResponsiveContainer>
      </div>
    </div>
  );
}