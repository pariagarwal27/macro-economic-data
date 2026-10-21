"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
} from "recharts";
import { HistoryChartViewport } from "@/components/HistoryChartViewport";
import { filterHistoryByYearRange, filterHistoryToTrailing12Months } from "@/lib/history-range";
import { getNiceTickDomain, getNiceTicks, getTickPrecision } from "@/lib/chart-axis";

export function SeriesChart({
  data,
  unit,
  frequency,
  valueLabel = "Value",
}: {
  data: Array<{ date: string; value: number }>;
  unit: string;
  frequency?: string;
  valueLabel?: string;
}) {
  const visibleData = data;
  if (!visibleData.length) {
    return <div className="series-chart-empty">No observations available for the selected chart window.</div>;
  }
  return (
    <div className="series-chart w-full">
      <HistoryChartViewport dates={visibleData.map(point => point.date)} frequency={frequency} height={352} label="Series history">
      {(plotWidth, fromYear, toYear, isDefaultWindow) => {
        const chartData = isDefaultWindow ? filterHistoryToTrailing12Months(visibleData) : filterHistoryByYearRange(visibleData, fromYear, toYear);
        const axisTicks = getNiceTicks(chartData.map(point => point.value), 8, unit === "percent" ? 0.05 : 0.1);
        return <ResponsiveContainer width={plotWidth} height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(28,36,41,0.08)" vertical={false} />
          <Area type="monotone" dataKey="value" baseValue="dataMin" fill="var(--country-series, var(--accent))" fillOpacity={0.18} stroke="none" tooltipType="none" isAnimationActive={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            minTickGap={40}
            tickFormatter={(v) => String(v).slice(0, 7)}
          />
          <YAxis allowDataOverflow
            tick={{ fontSize: 11, fill: "#6b7280" }}
            width={56}
            ticks={axisTicks}
            domain={getNiceTickDomain(axisTicks)}
            tickFormatter={(v) =>
              unit === "percent" ? `${Number(v).toFixed(getTickPrecision(axisTicks))}` : String(v)
            }
          />
          <Tooltip
            cursor={{ stroke: "var(--country-series, var(--accent))", strokeWidth: 1, strokeDasharray: "4 3" }}
            contentStyle={{
              borderRadius: 12,
              background: "#f5f8fb",
              border: "1px solid #c9d4dd",
            }}
            formatter={(value) => [
              unit === "percent"
                ? `${Number(value).toFixed(2)}%`
                : Number(value).toLocaleString(),
              valueLabel,
            ]}
            labelFormatter={(label) => `Period: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--country-series, var(--accent))"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--country-series, var(--accent))", strokeWidth: 0 }}
            activeDot={{ r: 6, stroke: "var(--panel)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>;
      }}
      </HistoryChartViewport>
    </div>
  );
}
