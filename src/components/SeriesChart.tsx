"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export function SeriesChart({
  data,
  unit,
}: {
  data: Array<{ date: string; value: number }>;
  unit: string;
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(28,36,41,0.08)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            minTickGap={40}
            tickFormatter={(v) => String(v).slice(0, 7)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            width={56}
            tickFormatter={(v) =>
              unit === "percent" ? `${Number(v).toFixed(1)}` : String(v)
            }
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              background: "#f5f8fb",
              border: "1px solid #c9d4dd",
            }}
            formatter={(value) => [
              unit === "percent"
                ? `${Number(value).toFixed(2)}%`
                : Number(value).toLocaleString(),
              "Value",
            ]}
            labelFormatter={(label) => `Period: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#0d7c6f"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
