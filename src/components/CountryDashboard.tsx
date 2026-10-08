"use client";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import {
  DASHBOARD,
  REGION_FLAG,
  REGION_LABEL,
  type IndicatorSpec,
  type MacroCategory,
  type Region,
  type UiNode,
} from "./macro-ui-hierarchy";
import { formatEconomicLevel, formatObsDate } from "@/lib/format";
import { latestQuarterPair, quarterlyGrowthPoints } from "@/lib/quarterly-gdp";
import { RefreshDataButton } from "@/components/RefreshDataButton";
import { ExpectationComparisonChart } from "@/components/ExpectationComparisonChart";
import { EconomicCalendarSidebar } from "@/components/EconomicCalendarSidebar";
import {
  formatOfficialComponentWeight,
  getOfficialComponentWeight,
} from "@/lib/official-component-weights";


type Metric = {
  id: string;
  region: string;
  category: string;
  subcategory: string;
  name: string;
  shortName: string;
  unit: string;
  frequency: string;
  importance: string;
  source?: string;
  officialUrl: string;
  docsUrl: string;
  releaseName: string;
  latest?: { date: string; value: number } | null;
  prior?: { date: string; value: number } | null;
  delta?: number | null;
  displayReleasedAt?: string | null;
  history?: Array<{ date: string; value: number }>;
  transform?: string;
};

type DetailPayload = {
  meta: Metric;
  history: Array<{ date: string; value: number }>;
  displayReleasedAt?: string | null;
  releases?: Array<{
    periodDate: string;
    releasedAt: string;
    value: number;
    periodLabel?: string | null;
  }>;
};

type ReleaseNotice = {
  kind: "reminder" | "released";
  metricId: string;
  metricName: string;
  region: string;
  stage?: "2m" | "1m";
  secondsRemaining?: number;
  actual?: number | null;
};

type DashboardToast = ReleaseNotice & { id: string };

function specContainsMetric(spec: IndicatorSpec, metricId: string): boolean {
  if ([spec.metricId, spec.yoyMetricId, spec.momMetricId, ...(spec.chartMetricIds ?? [])].includes(metricId)) return true;
  const contains = (nodes: UiNode[] = []): boolean => nodes.some((node) => node.metricId === metricId || contains(node.children));
  return contains(spec.components);
}

const YEAR = 2026;
function chartStartYear(frequency?: string) {
  return frequency === "quarterly" ? YEAR - 1 : YEAR;
}

function isInChartYearRange(date: string, frequency?: string) {
  return Number(date.slice(0, 4)) >= chartStartYear(frequency);
}

const QUARTERLY_GDP_METRIC_IDS = new Set(["us-gdp-real", "uk-gdp-qoq"]);

function isQuarterlyGdpMetric(metricId?: string) {
  return Boolean(metricId && QUARTERLY_GDP_METRIC_IDS.has(metricId));
}

function QuarterlyGdpChart({
  metric,
  compact = false,
  height = 320,
}: {
  metric: DetailPayload | undefined;
  compact?: boolean;
  height?: number;
}) {
  const data = quarterlyGrowthPoints(metric?.history ?? []);
  if (!data.length) {
    return compact ? null : <div className="spark-chart-empty">No quarterly data</div>;
  }

  const metricId = metric?.meta.id;
  const seriesLabel = metricId === "us-gdp-real" ? "Quarterly growth · SAAR" : "Quarterly growth · QoQ";
  const formatValue = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

  return (
    <div
      className={compact ? "macro-mini-chart" : undefined}
      style={{ width: "100%", height: compact ? 76 : height, minHeight: 0 }}
      aria-label={seriesLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={compact ? { top: 5, right: 5, left: 5, bottom: 3 } : { top: 8, right: 22, left: 8, bottom: 28 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <YAxis
            hide={compact}
            width={compact ? 0 : 60}
            tickFormatter={(value) => `${Number(value).toFixed(1)}%`}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            domain={["auto", "auto"]}
          />
          <XAxis
            dataKey="quarter"
            hide={compact}
            tickLine={false}
            axisLine={!compact}
            tickMargin={8}
            minTickGap={compact ? 0 : 16}
            interval="preserveStartEnd"
            tick={{ fill: "var(--muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={false}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 12 }}
            labelFormatter={(label) => String(label)}
            formatter={(value) => [formatValue(Number(value)), seriesLabel]}
          />
          {!compact && <Legend verticalAlign="top" align="center" height={28} iconType="line" />}
          <Line
            type="monotone"
            dataKey="value"
            name={seriesLabel}
            stroke="var(--country-series)"
            strokeWidth={compact ? 2.6 : 2.8}
            strokeLinecap="round"
            dot={compact ? false : { r: 3.5, fill: "var(--panel)", stroke: "var(--country-series)", strokeWidth: 2 }}
            activeDot={{ r: compact ? 4 : 6 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const US_INFLATION_PRIMARY_IDS = new Set([
  "us-cpi-card",
  "us-core-cpi-card",
  "us-pce-card",
  "us-core-pce-card",
]);
function isUkInflationHiddenSpec(spec: IndicatorSpec) {
  const title = (spec.title ?? "").toLowerCase();
  const id = spec.id.toLowerCase();

  return (
    title.includes("food inflation") ||
    title.includes("housing & household services") ||
    title.includes("household services") ||
    id.includes("food-inflation") ||
    id.includes("food_inflation") ||
    id.includes("household-services") ||
    id.includes("household_services")
  );
}

function isInflationExpectationSpecId(spec: IndicatorSpec) {
  const text = `${spec.id} ${spec.title ?? ""} ${spec.metricId}`.toLowerCase();

  return (
    text.includes("expectation") ||
    text.includes("market-based") ||
    text.includes("market participants") ||
    text.includes("market-participant")
  );
}

function formatExpectationValue(
  payload: DetailPayload | undefined,
  value: number | null | undefined
) {
  if (value == null || !Number.isFinite(value)) return "—";

  const unit = payload?.meta.unit?.toLowerCase() ?? "";

  if (
    unit.includes("%") ||
    unit.includes("percent") ||
    unit.includes("percentage")
  ) {
    return `${value.toFixed(1)}%`;
  }

  if (unit.includes("basis") || unit.includes("bp")) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)} bp`;
  }

  return value.toFixed(1);
}

function Spark({
  data,
  tone = "blue",
  compact = false,
  frequency = "monthly",
  metricId,
}: {
  data: Array<{ date: string; value: number }>;
  tone?: string;
  compact?: boolean;
  frequency?: string;
  metricId?: string;
}) {
  const points = [...data]
  .filter((p) =>
    isInChartYearRange(p.date, frequency)
  )
  .sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  .map((p) => ({
    date: p.date.slice(0, 10),
    value: Number(p.value),
  }))
  .filter((p) =>
    Number.isFinite(p.value)
  );

  if (!points.length) {
    return <div className="spark-chart-empty">No data</div>;
  }

  const formatDate = (date: string) =>
    formatChartDate(date, frequency, true);

  const formatValue = (value: number) => {
    if (Math.abs(value) >= 1000) {
      return value.toLocaleString("en-US", {
        maximumFractionDigits: 0,
      });
    }

    return value.toLocaleString("en-US", {
      maximumFractionDigits: 2,
    });
  };

  return (
    <div
      className={clsx(
        "spark-chart",
        compact && "spark-chart-compact"
      )}
      style={{ width: "100%", height: compact ? 46 : 320 }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{
            top: 16,
            right: 24,
            left: 12,
            bottom: 28,
          }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
          />

          <XAxis
  dataKey="date"
  tickFormatter={(value) => formatChartDate(value, frequency)}
  tickLine={false}
  axisLine={true}
  tickMargin={10}
  height={40}
  minTickGap={24}
  interval="preserveStartEnd"
  padding={{ left: 8, right: 8 }}
  tick={{
    fill: "var(--muted)",
    fontSize: 12,
  }}
/>

          <YAxis
  tickLine={false}
  axisLine={!compact}
  hide={compact}
  width={60}
  tickFormatter={formatValue}
  domain={["dataMin", "dataMax"]}
/>

          <Tooltip
            labelFormatter={(label) =>
              `Date: ${formatDate(String(label))}`
            }
            formatter={(value) => [
              formatValue(Number(value)),
              "Value",
            ]}
          />

          <Line
            type="monotone"
            dataKey="value"
            name="Value"
            stroke="var(--country-series)"
            strokeWidth={2.5}
            dot={{
              r: 4,
            }}
            activeDot={{
              r: 7,
            }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}



function formatChartDate(
  value: unknown,
  frequency?: string,
  fullDate = false
) {
  const raw = String(value ?? "").trim();

  if (!raw) return "—";

  const quarter = raw.match(/^(\d{4})[- ]Q([1-4])$/i);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;

  if (/^\d{4}$/.test(raw)) return raw;

  // Handle normal ISO calendar dates.
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const date = new Date(`${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00Z`);

    if (!Number.isNaN(date.getTime())) {
      if (frequency === "quarterly") {
        return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
      }
      if (frequency === "annual") return String(date.getUTCFullYear());
      if (frequency === "weekly") {
        return new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "2-digit",
          ...(fullDate ? { year: "numeric" as const } : {}),
          timeZone: "UTC",
        }).format(date);
      }

      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
    }
  }

  // Handle YYYY-MM values.
  const isoMonth = raw.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) {
    const date = new Date(`${isoMonth[1]}-${isoMonth[2]}-01T00:00:00Z`);

    if (!Number.isNaN(date.getTime())) {
      if (frequency === "quarterly") {
        return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
      }
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
    }
  }

  // Never pass an invalid Date into Intl.DateTimeFormat.
  return raw;
}

function isUsJobsMetric(
  metric: DetailPayload | undefined,
  kind: "unemployment" | "participation" | "jolts"
) {
  const id = metric?.meta.id ?? "";

  if (kind === "unemployment") {
    return id === "us-unemployment";
  }

  if (kind === "participation") {
    return id === "us-participation";
  }

  return id === "us-jolts-openings";
}

function displayMetricTitle(
  spec: IndicatorSpec | undefined,
  metric: DetailPayload | undefined
) {
  if (isUsJobsMetric(metric, "jolts")) {
    return "Job Openings";
  }

  return (
    spec?.title ??
    metric?.meta.shortName ??
    metric?.meta.name ??
    metric?.meta.id ??
    "Indicator"
  );
}

function RateChart({
  spec,
  root,
  allMetrics,
  height = 320,
}: {
  spec: IndicatorSpec;
  root: DetailPayload | undefined;
  allMetrics: Record<string, DetailPayload | undefined>;
  height?: number;
}) {
  const rootHistory = normalizeHistory(
    root?.history ?? []
  );

  const sortedRootHistory = [...rootHistory].sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  if (isQuarterlyGdpMetric(root?.meta.id)) {
    return <QuarterlyGdpChart metric={root} height={height} />;
  }

  const isUSNetExports = isUSNetExportsMetric(root);

  const isUsHeadlineCpi =
    spec.id === "us-cpi-card" ||
    root?.meta.id === "us-cpi";

  const yoyHistory = spec.yoyMetricId
    ? normalizeHistory(
        allMetrics[spec.yoyMetricId]?.history ?? []
      )
    : [];

  const configuredMomHistory = spec.momMetricId
    ? normalizeHistory(
        allMetrics[spec.momMetricId]?.history ?? []
      )
    : [];

  const cpiMomHistory = isUsHeadlineCpi
    ? normalizeHistory(
        allMetrics["us-cpi-mom"]?.history ?? []
      )
    : [];

  const momHistory =
    isUsHeadlineCpi && cpiMomHistory.length
      ? cpiMomHistory
      : configuredMomHistory;

  const secondLabel =
    root?.meta.frequency === "weekly"
      ? "WoW"
      : root?.meta.id === "uk-unemployment" ||
          root?.meta.id === "uk-employment-rate" ||
          root?.meta.id === "uk-inactivity-rate"
        ? "QoQ"
        : root?.meta.frequency === "quarterly"
          ? "QoQ"
          : "MoM";

  /*
   * Net Exports is a level series in dollars, not a YoY/MoM
   * rate pair. Keep its existing single-series treatment.
   */
  if (isUSNetExports) {
    const data = sortedRootHistory
      .filter((point) =>
        isInChartYearRange(point.date, root?.meta.frequency)
      )
      .map((point) => ({
        date: point.date.slice(0, 10),
        value: Number(point.value),
      }))
      .filter((point) =>
        Number.isFinite(point.value)
      );

    if (!data.length) {
      return (
        <div
          style={{
            width: "100%",
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
        >
          No current-year data
        </div>
      );
    }

    return (
      <div
  style={{
    width: "100%",
    height,
    minHeight: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
  top: 8,
  right: 24,
  left: 8,
  bottom: 48,
}}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
  dataKey="date"
  tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)}
  tickLine={false}
  axisLine={true}
  tickMargin={10}
  height={40}
  minTickGap={24}
  interval="preserveStartEnd"
  padding={{ left: 8, right: 8 }}
  tick={{
    fill: "var(--muted)",
    fontSize: 12,
  }}
/>

            <YAxis
              tickLine={false}
              axisLine={true}
              width={74}
              tickFormatter={(value) =>
                formatUsNetExportsValue(Number(value))
              }
              domain={["auto", "auto"]}
            />

            <Tooltip
              labelFormatter={(label) =>
                `Date: ${formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )}`
              }
              formatter={(value) => [
                formatUsNetExportsValue(
                  Number(value)
                ),
                "Net Exports",
              ]}
            />

            <Legend
              verticalAlign="top"
              align="center"
              height={28}
              iconType="line"
            />

            <Line
              type="monotone"
              dataKey="value"
              name="Net Exports"
              stroke="var(--country-series)"
              strokeWidth={2.5}
              dot={{ r: 3.5 }}
              activeDot={{ r: 6 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /*
   * Latest/Prior metrics are single-series level/rate indicators.
   * Do NOT manufacture YoY + MoM charts for these.
   *
   * Examples:
   *   - UK unemployment / employment / inactivity
   *   - UK vacancies / payrolled employment
   *   - other metrics whose KPI pair is explicitly Latest + Prior
   *
   * Their chart must plot the published value itself, matching the
   * Latest / Prior KPI cards above it.
   */
  const kpis = getMetricKpis(root);
  const isPayrollLevel = root?.meta.id === "us-payrolls-level";
  const isLatestPriorMetric = isPayrollLevel || (
    kpis.leftLabel === "Latest" &&
    kpis.rightLabel === "Prior" &&
    kpis.showRight);

  if (isLatestPriorMetric) {
    const highFrequency = root?.meta.frequency === "daily" || root?.meta.frequency === "hourly";
    const todayKey = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = sortedRootHistory
      .filter((point) =>
        highFrequency
          ? point.date.slice(0, 10) >= cutoff && point.date.slice(0, 10) <= todayKey
        : isInChartYearRange(point.date, root?.meta.frequency)
      )
      .map((point) => ({
        date: point.date.slice(0, 10),
        value: Number(point.value),
      }))
      .filter((point) =>
        Number.isFinite(point.value)
      );

    if (!data.length) {
      return (
        <div
          style={{
            width: "100%",
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
        >
          No current-year data
        </div>
      );
    }


    return (
      <div
  style={{
    width: "100%",
    height,
    minHeight: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
              top: 8,
              right: 24,
              left: 8,
              bottom: 48,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
  dataKey="date"
  tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)}
  tickLine={false}
  axisLine={true}
  tickMargin={10}
  height={40}
  minTickGap={24}
  interval="preserveStartEnd"
  padding={{ left: 8, right: 8 }}
  tick={{
    fill: "var(--muted)",
    fontSize: 12,
  }}
/>

            <YAxis
              tickLine={false}
              axisLine={true}
              width={74}
              tickFormatter={(value) =>
                formatMetricValue(
                  Number(value),
                  root
                )
              }
              domain={["auto", "auto"]}
            />

            <Tooltip
              labelFormatter={(label) =>
                `Date: ${formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )}`
              }
              formatter={(value) => [
                formatMetricValue(
                  Number(value),
                  root
                ),
                root?.meta.shortName ??
                  root?.meta.name ??
                  "Value",
              ]}
            />

            <Legend
              verticalAlign="top"
              align="center"
              height={28}
              iconType="line"
            />

            <Line
              type="monotone"
              dataKey="value"
              name={
                root?.meta.shortName ??
                root?.meta.name ??
                "Value"
              }
              stroke="var(--country-series)"
              strokeWidth={2.5}
              dot={{ r: 3.5 }}
              activeDot={{ r: 6 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const isPercentagePointRate = root?.meta.id
    ? percentagePointIds.has(root.meta.id)
    : false;

  const valueForDate = (
    history: Array<{ date: string; value: number }>,
    date: string
  ) => {
    const exact = history.find(
      (point) =>
        point.date.slice(0, 10) === date
    );

    if (
      exact &&
      Number.isFinite(Number(exact.value))
    ) {
      return Number(exact.value);
    }

    const month = date.slice(0, 7);
    const sameMonth = history.find(
      (point) =>
        point.date.slice(0, 7) === month
    );

    return sameMonth &&
      Number.isFinite(Number(sameMonth.value))
      ? Number(sameMonth.value)
      : null;
  };

  const hasDedicatedYoY = Boolean(
    spec.yoyMetricId && yoyHistory.length
  );

  const hasDedicatedMoM = Boolean(
    spec.momMetricId && momHistory.length
  );

  const chartDates = new Set<string>();

  if (hasDedicatedYoY) {
    yoyHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      if (isInChartYearRange(date, spec.yoyMetricId ? allMetrics[spec.yoyMetricId]?.meta.frequency : root?.meta.frequency)) {
        chartDates.add(date);
      }
    });
  }

  if (hasDedicatedMoM) {
    momHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      if (isInChartYearRange(date, spec.momMetricId ? allMetrics[spec.momMetricId]?.meta.frequency : root?.meta.frequency)) {
        chartDates.add(date);
      }
    });
  }

  if (!chartDates.size) {
    sortedRootHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      if (isInChartYearRange(date, root?.meta.frequency)) {
        chartDates.add(date);
      }
    });
  }

  const data = [...chartDates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      let yoy: number | null =
        hasDedicatedYoY
          ? valueForDate(
              yoyHistory,
              date
            )
          : null;

      let mom: number | null =
        hasDedicatedMoM
          ? valueForDate(
              momHistory,
              date
            )
          : null;

      if (
        !hasDedicatedYoY ||
        !hasDedicatedMoM
      ) {
        const throughDate =
          sortedRootHistory.filter(
            (candidate) =>
              candidate.date.slice(0, 10) <= date
          );

        const rates = calculateRates(
          throughDate,
          root?.meta.transform,
          root?.meta.frequency,
          root?.meta.id
        );

        if (!hasDedicatedYoY) {
          yoy = rates.yoy;
        }

        if (!hasDedicatedMoM) {
          mom = rates.mom;
        }
      }

      return {
        date,
        yoy,
        mom,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.yoy ?? NaN) ||
        Number.isFinite(point.mom ?? NaN)
    );

  if (!data.length) {
    return (
      <div
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        No YoY / {secondLabel} data
      </div>
    );
  }

  const hasYoYData = data.some(
    (point) =>
      Number.isFinite(point.yoy ?? NaN)
  );

  const hasSecondData = data.some(
    (point) =>
      Number.isFinite(point.mom ?? NaN)
  );

  const formatValue = (
    value: number | null | undefined
  ) => {
    if (
      value == null ||
      !Number.isFinite(value)
    ) {
      return "—";
    }

    return `${
      value > 0 ? "+" : ""
    }${value.toFixed(1)}${
      isPercentagePointRate
        ? " pp"
        : "%"
    }`;
  };

  const formatTooltipDate = (date: string) =>
    formatChartDate(date, root?.meta.frequency, true);

  const renderChart = (
  series: "yoy" | "mom",
  label: string,
  stroke: string
) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      border: "1px solid var(--line)",
      borderRadius: 10,
      padding: "8px 8px 0",
      overflow: "visible",
      boxSizing: "border-box",
    }}
  >
    <div
      style={{
        flex: "0 0 auto",
        fontSize: 12,
        fontWeight: 600,
        color: "var(--text)",
        marginBottom: 2,
      }}
    >
      {label}
    </div>

    <div
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        width: "100%",
        overflow: "visible",
      }}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minHeight={320}
      >
        <LineChart
          data={data}
          margin={{
            top: 4,
            right: 12,
            left: 4,
            bottom: 56,
          }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tickFormatter={(value) => formatChartDate(value, root?.meta.frequency)}
            tickLine={false}
            axisLine={{
              stroke: "var(--muted)",
              strokeWidth: 1,
            }}
            tickMargin={10}
            height={44}
            minTickGap={24}
            interval="preserveStartEnd"
            padding={{
              left: 8,
              right: 8,
            }}
            tick={{
              fill: "var(--muted)",
              fontSize: 12,
            }}
          />

          <YAxis
            tickLine={false}
            axisLine={true}
            width={68}
            tickFormatter={(value) =>
              `${Number(value).toFixed(1)}${
                isPercentagePointRate
                  ? " pp"
                  : "%"
              }`
            }
            domain={["auto", "auto"]}
          />

          <Tooltip
  labelFormatter={(label) =>
    `Date: ${formatTooltipDate(
      String(label)
    )}`
  }
  contentStyle={{
  background: "var(--panel)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  color: "var(--text)",
}}
  labelStyle={{
    color: "var(--text)",
    fontWeight: 500,
  }}
  formatter={(value) => [
    formatValue(Number(value)),
    label.replace(/\s*·\s*\d{4}$/, ""),
  ]}
/>

          <Legend
            verticalAlign="top"
            align="center"
            height={28}
            iconType="line"
          />

          <Line
            type="monotone"
            dataKey={series}
            name={label}
            stroke={stroke}
            strokeWidth={2.5}
            dot={{ r: 3.5 }}
            activeDot={{ r: 6 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
);

  return (
  <div
    style={{
      width: "100%",
      height,
      minHeight: 0,
      display: "grid",
      gridTemplateColumns:
        hasYoYData && hasSecondData
          ? "repeat(2, minmax(0, 1fr))"
          : "1fr",
      gap: 16,
      overflow: "visible",
      boxSizing: "border-box",
    }}
  >
    {hasYoYData &&
      renderChart(
        "yoy",
        `YoY · ${YEAR}`,
        "var(--country-series)"
      )}

    {hasSecondData &&
      renderChart(
        "mom",
        `${secondLabel} · ${YEAR}`,
        "var(--country-series)"
      )}
  </div>
);
}


function MiniRateChart({
  spec,
  root,
  allMetrics,
}: {
  spec: IndicatorSpec;
  root: DetailPayload | undefined;
  allMetrics: Record<string, DetailPayload | undefined>;
}) {
  const rootHistory = normalizeHistory(
    root?.history ?? []
  );

  const yoyHistory = spec.yoyMetricId
    ? normalizeHistory(
        allMetrics[spec.yoyMetricId]?.history ?? []
      )
    : [];

  const configuredMomHistory = spec.momMetricId
    ? normalizeHistory(
        allMetrics[spec.momMetricId]?.history ?? []
      )
    : [];

  const isUsHeadlineCpi =
    spec.id === "us-cpi-card" ||
    root?.meta.id === "us-cpi";

  const cpiMomHistory = isUsHeadlineCpi
    ? normalizeHistory(
        allMetrics["us-cpi-mom"]?.history ?? []
      )
    : [];

  const momHistory =
    isUsHeadlineCpi && cpiMomHistory.length
      ? cpiMomHistory
      : configuredMomHistory;

  const sortedRootHistory = [
    ...rootHistory,
  ].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (isQuarterlyGdpMetric(root?.meta.id)) {
    return <QuarterlyGdpChart metric={root} compact />;
  }

  // Expectation readings are published survey/market levels. Treating them
  // as generic index levels and calculating YoY/MoM rates creates misleading
  // synthetic changes, so the card sparkline shows the published series.
  if (spec.expectationGroup) {
    const data = sortedRootHistory
      .filter((point) => isInChartYearRange(point.date, root?.meta.frequency))
      .map((point) => ({ date: point.date.slice(0, 10), value: Number(point.value) }))
      .filter((point) => Number.isFinite(point.value));

    if (!data.length) return null;

    const seriesName = root?.meta.shortName || root?.meta.name || spec.title || "Expectation";
    return (
      <div className="macro-mini-chart" style={{ width: "100%", height: 76, minHeight: 0 }} aria-label={`${seriesName} published readings`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 3 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis hide domain={["auto", "auto"]} />
            <Line
              type="monotone"
              dataKey="value"
              name="expectation-level"
              stroke="var(--country-series)"
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={false}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)", fontSize: 10, padding: "5px 7px" }}
              labelFormatter={(label) => formatChartDate(String(label), root?.meta.frequency, true)}
              formatter={(value) => [formatExpectationValue(root, Number(value)), seriesName]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const secondLabel =
    root?.meta.frequency === "weekly"
      ? "WoW"
      : root?.meta.id === "uk-unemployment" ||
          root?.meta.id === "uk-employment-rate" ||
          root?.meta.id === "uk-inactivity-rate"
        ? "QoQ"
        : root?.meta.frequency === "quarterly"
          ? "QoQ"
          : "MoM";

  /*
   * Net Exports is intentionally kept as its original
   * single-series level chart because it is a dollar-value
   * contribution rather than a YoY/MoM rate pair.
   */
  if (isUSNetExportsMetric(root)) {
    const data = sortedRootHistory
      .filter((point) => isInChartYearRange(point.date, root?.meta.frequency))
      .map((point) => ({
        date: point.date.slice(0, 10),
        value: Number(point.value),
      }))
      .filter((point) =>
        Number.isFinite(point.value)
      );

    if (!data.length) {
      return null;
    }

    return (
      <div
        className="macro-mini-chart"
        style={{
          width: "100%",
          height: 76,
          minHeight: 0,
        }}
        aria-label="Net Exports trend"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{ top: 5, right: 5, left: 5, bottom: 3 }}
          >
            <defs>
              <linearGradient id={`mini-fill-${spec.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--country-series)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--country-series)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis
              hide
              domain={["auto", "auto"]}
            />
            <Area type="monotone" dataKey="value" stroke="none" fill={`url(#mini-fill-${spec.id})`} isAnimationActive={false} />

            <Line
              type="monotone"
              dataKey="value"
              name="Net Exports"
              stroke="var(--country-series)"
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
              cursor={false}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 10,
                padding: "5px 7px",
              }}
              labelFormatter={(label) =>
                `Date: ${formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )}`
              }
              formatter={(value) => [
                formatUsNetExportsValue(
                  Number(value)
                ),
                "Net Exports",
              ]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  /*
   * Latest/Prior metrics are single-series metrics. Keep exactly one
   * mini chart showing the published level/rate, instead of deriving
   * artificial YoY + MoM series from the raw level.
   */
  const kpis = getMetricKpis(root);
  const isPayrollLevel = root?.meta.id === "us-payrolls-level";
  const isLatestPriorMetric = isPayrollLevel || (
    kpis.leftLabel === "Latest" &&
    kpis.rightLabel === "Prior" &&
    kpis.showRight);

  if (isLatestPriorMetric) {
    const data = sortedRootHistory
      .map((point, index, history) => ({
        date: point.date.slice(0, 10),
        value: isPayrollLevel
          ? index > 0 ? Number(point.value) - Number(history[index - 1].value) : NaN
          : Number(point.value),
      }))
      .filter((point) => isInChartYearRange(point.date, root?.meta.frequency))
      .filter((point) =>
        Number.isFinite(point.value)
      );

    if (!data.length) {
      return null;
    }

    const chartLabel = isPayrollLevel ? "Monthly payroll change" :
      root?.meta.shortName ?? root?.meta.name ?? "Value";

    return (
      <div
        className="macro-mini-chart"
        style={{
          width: "100%",
          height: 76,
          minHeight: 0,
        }}
        aria-label={`${chartLabel} trend`}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 5,
              left: 5,
              bottom: 3,
            }}
          >
            <defs>
              <linearGradient id={`mini-fill-${spec.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--country-series)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--country-series)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis
              hide
              domain={["auto", "auto"]}
            />
            <Area type="monotone" dataKey="value" stroke="none" fill={`url(#mini-fill-${spec.id})`} isAnimationActive={false} />

            <Line
              type="monotone"
              dataKey="value"
              name={chartLabel}
              stroke="var(--country-series)"
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
              cursor={false}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--panel)",
                fontSize: 10,
                padding: "5px 7px",
              }}
              labelFormatter={(label) =>
                formatChartDate(
                  String(label),
                  root?.meta.frequency,
                  true
                )
              }
              formatter={(value) => [
                isPayrollLevel
                  ? formatAbsoluteChangeValue(Number(value), root)
                  : formatMetricValue(Number(value), root),
                chartLabel,
              ]}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const valueForDate = (
    history: Array<{ date: string; value: number }>,
    date: string
  ) => {
    const exact = history.find(
      (point) =>
        point.date.slice(0, 10) === date
    );

    if (
      exact &&
      Number.isFinite(Number(exact.value))
    ) {
      return Number(exact.value);
    }

    const month = date.slice(0, 7);
    const sameMonth = history.find(
      (point) =>
        point.date.slice(0, 7) === month
    );

    return sameMonth &&
      Number.isFinite(Number(sameMonth.value))
      ? Number(sameMonth.value)
      : null;
  };

  const hasDedicatedYoY = Boolean(
    spec.yoyMetricId && yoyHistory.length
  );

  const hasDedicatedMoM = Boolean(
    spec.momMetricId && momHistory.length
  );

  const chartDates = new Set<string>();

  if (hasDedicatedYoY) {
    yoyHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      if (isInChartYearRange(date, spec.yoyMetricId ? allMetrics[spec.yoyMetricId]?.meta.frequency : root?.meta.frequency)) {
        chartDates.add(date);
      }
    });
  }

  if (hasDedicatedMoM) {
    momHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      if (isInChartYearRange(date, spec.momMetricId ? allMetrics[spec.momMetricId]?.meta.frequency : root?.meta.frequency)) {
        chartDates.add(date);
      }
    });
  }

  if (!chartDates.size) {
    sortedRootHistory.forEach((point) => {
      const date = point.date.slice(0, 10);

      if (isInChartYearRange(date, root?.meta.frequency)) {
        chartDates.add(date);
      }
    });
  }

  const data = [...chartDates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      let yoy: number | null =
        hasDedicatedYoY
          ? valueForDate(
              yoyHistory,
              date
            )
          : null;

      let mom: number | null =
        hasDedicatedMoM
          ? valueForDate(
              momHistory,
              date
            )
          : null;

      if (
        !hasDedicatedYoY ||
        !hasDedicatedMoM
      ) {
        const throughDate =
          sortedRootHistory.filter(
            (candidate) =>
              candidate.date.slice(0, 10) <= date
          );

        const rates = calculateRates(
          throughDate,
          root?.meta.transform,
          root?.meta.frequency,
          root?.meta.id
        );

        if (!hasDedicatedYoY) {
          yoy = rates.yoy;
        }

        if (!hasDedicatedMoM) {
          mom = rates.mom;
        }
      }

      return {
        date,
        yoy,
        mom,
      };
    })
    .filter(
      (point) =>
        Number.isFinite(point.yoy ?? NaN) ||
        Number.isFinite(point.mom ?? NaN)
    );

  if (!data.length) {
    return null;
  }

  const hasYoYData = data.some(
    (point) =>
      Number.isFinite(point.yoy ?? NaN)
  );

  const hasSecondData = data.some(
    (point) =>
      Number.isFinite(point.mom ?? NaN)
  );

  const isPercentagePointRate = root?.meta.id
    ? percentagePointIds.has(root.meta.id)
    : false;

  const formatValue = (
    value: number | null | undefined
  ) => {
    if (
      value == null ||
      !Number.isFinite(value)
    ) {
      return "—";
    }

    return `${
      value > 0 ? "+" : ""
    }${value.toFixed(1)}${
      isPercentagePointRate
        ? " pp"
        : "%"
    }`;
  };

  const formatTooltipDate = (date: string) =>
    formatChartDate(date, root?.meta.frequency, true);

  const renderMiniChart = (
    series: "yoy" | "mom",
    label: string,
    stroke: string
  ) => (
    <div
      className="macro-spark-series"
      style={{
        minWidth: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="macro-spark-label">
        {label}
      </div>

      <div
        className="macro-spark-plot"
        style={{
          flex: 1,
          minHeight: 0,
        }}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 5,
              left: 5,
              bottom: 3,
            }}
          >
            <defs>
              <linearGradient id={`mini-fill-${spec.id}-${series}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--country-series)" stopOpacity={0.23} />
                <stop offset="100%" stopColor="var(--country-series)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 5" />
            <YAxis
              hide
              domain={["auto", "auto"]}
            />
            <Area type="monotone" dataKey={series} stroke="none" fill={`url(#mini-fill-${spec.id}-${series})`} isAnimationActive={false} />
            <XAxis
  dataKey="date"
  hide
/>

            <Line
              type="monotone"
              dataKey={series}
              name={label}
              stroke={stroke}
              strokeWidth={2.6}
              strokeLinecap="round"
              dot={(point) => point.index === data.length - 1 ? <circle cx={point.cx} cy={point.cy} r={3} fill="var(--country-series)" stroke="var(--panel)" strokeWidth={2} /> : null}
              activeDot={{ r: 3.5, fill: "var(--country-series)", stroke: "var(--panel)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />

            <Tooltip
  cursor={false}
  contentStyle={{
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "var(--panel)",
    fontSize: 10,
    padding: "6px 8px",
  }}
  labelStyle={{
    color: "var(--text)",
    fontWeight: 600,
    marginBottom: 3,
  }}
  itemStyle={{
    color: "var(--text)",
  }}
  labelFormatter={(label) =>
    formatTooltipDate(String(label))
  }
  formatter={(value) => [
    formatValue(Number(value)),
    label,
  ]}
/>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div
      className="macro-mini-chart"
      style={{
        width: "100%",
        height: 76,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns:
          hasYoYData && hasSecondData
            ? "1fr 1fr"
            : "1fr",
        gap: 8,
      }}
      aria-label={`${root?.meta.shortName ?? root?.meta.name ?? "Indicator"} trend`}
    >
      {hasYoYData &&
        renderMiniChart(
          "yoy",
          "YoY",
          "var(--country-series)"
        )}

      {hasSecondData &&
        renderMiniChart(
          "mom",
          secondLabel,
          "var(--country-series)"
        )}
    </div>
  );
}


function changeColor(value: number | null | undefined, invert = false) {
  if (value == null || value === 0) return "text-[var(--muted)]";
  const good = invert ? value < 0 : value > 0;
  return good ? "text-[var(--up)]" : "text-[var(--down)]";
}

function pct(v: number | null | undefined) {
  return v == null || !Number.isFinite(v)
    ? "—"
    : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function pp(v: number | null | undefined) {
  return v == null || !Number.isFinite(v)
    ? "—"
    : `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`;
}
function getDisplayMode(
  metricId: string | undefined
):
  | "rate"
  | "level"
  | "published-growth"
  | "absolute-change"
  | "normal" {
  if (!metricId) return "normal";

  if (isQuarterlyGdpMetric(metricId)) return "published-growth";

  if (
    metricId === "us-unemployment" ||
    metricId === "us-u6" ||
    metricId === "us-participation" ||
    metricId === "us-employment-population" ||
    metricId === "us-long-term-unemployed" ||
    metricId === "us-ahe" ||
    metricId === "us-ahe-mom" ||
    metricId === "uk-unemployment" ||
    metricId === "uk-employment-rate" ||
    metricId === "uk-inactivity-rate" ||
    metricId === "uk-vacancy-rate" ||
    metricId === "ea-unemployment" ||
    metricId === "ea-youth-unemployment" ||
    metricId === "ea-employment-rate" ||
    metricId === "ea-inactivity" ||
    metricId === "ea-long-term-unemployment" ||
    metricId === "ea-job-vacancies"
  ) {
    return "rate";
  }

  if (
    metricId === "uk-inflation-comp-1y" ||
    metricId === "uk-inflation-comp-5y5y"
  ) {
    return "rate";
  }

  if (
    metricId === "us-jolts-openings" ||
    metricId === "us-unemployed-persons" ||
    metricId === "us-civilian-labor-force" ||
    metricId === "us-not-in-labor-force" ||
    metricId === "us-private-payrolls" ||
    metricId === "us-government-payrolls" ||
    metricId === "us-jolts-hires-level" ||
    metricId === "us-jolts-quits-level" ||
    metricId === "us-jolts-layoffs-level" ||
    metricId === "us-jolts-total-separations" ||
    metricId === "ea-unemployed-persons" ||
    metricId === "ea-youth-unemployed-persons" ||
    metricId === "uk-unemployed-persons" ||
    metricId === "uk-long-term-unemployed" ||
    metricId === "uk-inactive-persons" ||
    metricId === "uk-employee-jobs" ||
    metricId === "ea-vacant-posts" ||
    metricId === "uk-employment-level" ||
    metricId === "uk-vacancies" ||
    metricId === "uk-payrolled-employees-level" ||
    metricId === "uk-inactivity-student" ||
    metricId === "uk-inactivity-family" ||
    metricId === "uk-inactivity-temporary-sick" ||
    metricId === "uk-inactivity-long-term-sick" ||
    metricId === "uk-inactivity-discouraged" ||
    metricId === "uk-inactivity-retired" ||
    metricId === "uk-inactivity-other" ||
    metricId === "us-payrolls-level"
  ) {
    return "level";
  }

  if (
    metricId === "ea-vacancy-change" ||
    metricId === "ea-employment-change" ||
    metricId === "ea-inactivity-change"
  ) {
    return "absolute-change";
  }

  if (
    metricId === "uk-awe-total-yoy" ||
    metricId === "uk-awe-regular-yoy" ||
    metricId === "uk-awe-real-total-yoy" ||
    metricId === "uk-awe-real-regular-yoy" ||
    metricId === "uk-payrolled-employees-annual-change" ||
    metricId === "ea-employment-yoy" ||
    metricId === "ea-employment-qoq" ||
    metricId === "ea-wage-growth" ||
    metricId === "ea-wage-growth-qoq"
  ) {
    return "published-growth";
  }

  if (
    metricId === "uk-employment-change" ||
    metricId === "uk-inactivity-change" ||
    metricId === "uk-vacancy-change" ||
    metricId === "us-nfp"
  ) {
    return "absolute-change";
  }

  if (
    metricId === "us-initial-claims" ||
    metricId === "us-continuing-claims"
  ) {
    return "level";
  }

  return "normal";
}

function formatUsNetExportsValue(
  value: number | null | undefined
) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);

  return `${sign}$${absolute.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}B`;
}

function annualizedToQuarterlyRate(value: number) {
  if (!Number.isFinite(value) || value <= -100) {
    return null;
  }

  return (
    Math.pow(1 + value / 100, 1 / 4) - 1
  ) * 100;
}

function formatMetricValue(
  value: number | null | undefined,
  metric: DetailPayload | undefined
) {
  const id = metric?.meta.id;
  if (
    (id === "ea-vacant-posts" || id === "ea-vacancy-change") &&
    (value == null || !Number.isFinite(value))
  ) {
    return "Not published for Euro Area aggregate";
  }
  if (
    value == null ||
    !Number.isFinite(value)
  ) {
    return "—";
  }

  const mode = getDisplayMode(id);
  const unit = metric?.meta.unit?.toLowerCase() ?? "";
  if (isUSNetExportsMetric(metric)) {
    return formatUsNetExportsValue(value);
  }

  if (id === "uk-gdp-mom") {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  }
if (UK_GROWTH_NET_TRADE_PP_IDS.has(id ?? "")) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

  if (mode === "rate" || mode === "published-growth") {
    return `${value.toFixed(1)}%`;
  }

  if (mode === "absolute-change") {
    if (unit.includes("post")) {
      const abs = Math.abs(value);
      const sign = value > 0 ? "+" : value < 0 ? "-" : "";
      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M posts`;
      if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K posts`;
      return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })} posts`;
    }

    if (unit.includes("thousand")) {
      return `${
        value > 0 ? "+" : ""
      }${Math.round(value)}K`;
    }

    return value.toLocaleString("en-US");
  }

  if (mode === "level") {
    if (["usd_billions", "gbp_millions", "eur_millions"].includes(unit)) {
      return formatEconomicLevel(value, unit);
    }

    if (unit.includes("post")) {
      const abs = Math.abs(value);
      const sign = value < 0 ? "-" : "";
      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M posts`;
      if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K posts`;
      return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} posts`;
    }

    if (unit.includes("thousand")) {
      if (Math.abs(value) >= 1000) {
        return `${(value / 1000).toFixed(1)}M`;
      }

      return `${Math.round(value)}K`;
    }

    if (
      id === "us-initial-claims" ||
      id === "us-continuing-claims"
    ) {
      if (Math.abs(value) >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
      }

      if (Math.abs(value) >= 1_000) {
        return `${Math.round(value / 1_000)}K`;
      }
    }

    return value.toLocaleString("en-US");
  }

  if (metric?.meta.category === "jobs" && unit.includes("percent")) {
    return `${value.toFixed(1)}%`;
  }

  if (unit.includes("dollar")) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }

  if (["usd_billions", "gbp_millions", "eur_millions"].includes(unit)) {
    return formatEconomicLevel(value, unit);
  }

  if (unit.includes("hour")) {
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hrs`;
  }

  return value.toLocaleString("en-US");
}

function formatAbsoluteChangeValue(value: number | null | undefined, metric: DetailPayload | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const unit = metric?.meta.unit?.toLowerCase() ?? "";
  const sign = value > 0 ? "+" : "";
  if (unit.includes("post")) {
    const abs = Math.abs(value);
    const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(1)}M posts`;
    if (abs >= 1_000) return `${prefix}${(abs / 1_000).toFixed(1)}K posts`;
    return `${prefix}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })} posts`;
  }
  if (unit.includes("thousand")) return `${sign}${Math.round(value)}K`;
  return `${sign}${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
}

const percentagePointIds = new Set([
  "us-unemployment",
  "us-long-term-unemployed",
  "us-participation",
  "uk-unemployment",
  "uk-employment-rate",
  "uk-inactivity-rate",
  "ea-unemployment",
  "ea-youth-unemployment",
  "ea-long-term-unemployment",
  "ea-inactivity",
  "ea-job-vacancies",
]);

const UK_GROWTH_MONTHLY_MOM_IDS = new Set([
  "uk-gdp-mom",
]);

const UK_GROWTH_NET_TRADE_PP_IDS = new Set([
  "uk-net-trade-qoq",
  "uk-net-trade-yoy",
]);
const US_GROWTH_NET_EXPORTS_PP_IDS = new Set([
  "us-real-net-exports",
]);

function isUSNetExportsMetric(
  metric: DetailPayload | undefined
) {
  const id = metric?.meta.id?.toLowerCase() ?? "";
  const name = (
    `${metric?.meta.shortName ?? ""} ${
      metric?.meta.name ?? ""
    }`
  ).toLowerCase();

  return (
    US_GROWTH_NET_EXPORTS_PP_IDS.has(id) ||
    name.includes("net exports")
  );
}
function getMetricKpis(
  metric: DetailPayload | undefined
) {
  if (!metric) {
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: null,
      rightLabel: "MoM",
      rightValue: null,
      showRight: true,
    };
  }

  const id = metric.meta.id;
  const mode = getDisplayMode(id);

  if (isQuarterlyGdpMetric(id)) {
    const { latest, prior } = latestQuarterPair(metric.history ?? []);
    return {
      mode: "published-growth" as const,
      leftLabel: latest ? `Latest (${latest.quarter})` : "Latest quarter",
      leftValue: latest?.value ?? null,
      rightLabel: prior ? `Prior (${prior.quarter})` : "Prior quarter",
      rightValue: prior?.value ?? null,
      showRight: true,
    };
  }

  // US Labor Force Participation is a published rate level.
  if (id === "us-participation") {
    const history = [...(metric.history ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return {
      mode: "rate" as const,
      leftLabel: "Latest",
      leftValue: history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue: history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  // US JOLTS Job Openings is a level series in thousands, displayed in M.
  if (id === "us-jolts-openings") {
    const history = [...(metric.history ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return {
      mode: "level" as const,
      leftLabel: "Latest",
      leftValue: history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue: history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  if (UK_GROWTH_MONTHLY_MOM_IDS.has(id)) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "normal" as const,
      leftLabel: "MoM",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  if (UK_GROWTH_NET_TRADE_PP_IDS.has(id ?? "")) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
  mode: "level" as const,
  leftLabel: "Latest",
  leftValue:
    history.at(-1)?.value ?? null,
  rightLabel: "Prior",
  rightValue:
    history.at(-2)?.value ?? null,
  showRight: true,
};
  }
  // US Net Exports is a level series, not a YoY/MoM growth rate.
  if (isUSNetExportsMetric(metric)) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "level" as const,
      leftLabel: "Latest",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue:
        history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  if (mode === "published-growth") {
    return {
      mode,
      leftLabel: "YoY",
      leftValue:
        metric.history?.at(-1)?.value ?? null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  if (
    mode === "rate" ||
    mode === "level" ||
    mode === "absolute-change"
  ) {
    const history = [...(metric.history ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    return {
      mode,
      leftLabel: "Latest",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue:
        history.at(-2)?.value ?? null,
      showRight: true,
    };
  }

  const rates = calculateRates(
    metric.history,
    metric.meta.transform,
    metric.meta.frequency,
    metric.meta.id
  );

  return {
    mode: "normal" as const,
    leftLabel: "YoY",
    leftValue: rates.yoy,
    rightLabel: rates.secondLabel,
    rightValue: rates.mom,
    showRight: true,
  };
}

function calculateCompoundedYoY(
  history: Array<{ date: string; value: number }>
): number | null {
  if (history.length < 12) return null;

  const latest = history[history.length - 1];

  if (!latest?.date) return null;

  const latestMonth = latest.date.slice(0, 7);

  let growthFactor = 1;

  for (let i = 0; i < 12; i++) {
    const d = new Date(
      `${latestMonth}-01T00:00:00Z`
    );

    d.setUTCMonth(
      d.getUTCMonth() - i
    );

    const targetMonth = d
      .toISOString()
      .slice(0, 7);

    const point = history.find(
      (p) => p.date.slice(0, 7) === targetMonth
    );

    if (!point || !Number.isFinite(point.value)) {
      return null;
    }

    growthFactor *=
      1 + point.value / 100;
  }

  return (growthFactor - 1) * 100;
}
function normalizeHistory(
  history: Array<{
    date: string;
    value: number;
  }> = []
) {
  return history
    .map((point) => ({
      date: String(point.date).slice(0, 10),
      value: Number(point.value),
    }))
    .filter(
      (point) =>
        point.date &&
        Number.isFinite(point.value)
    )
    .sort((a, b) =>
      a.date.localeCompare(b.date)
    );
}

function getLatestPeriodDate(
  metric: DetailPayload | undefined
) {
  if (!metric) return null;

  const history = normalizeHistory(
    metric.history ?? []
  );

  // Prefer the latest observation from the current dashboard year.
  // This prevents stale/malformed historical tail records from
  // becoming the displayed "Latest period".
  const currentYearLatest = history
    .filter((point) =>
      point.date.startsWith(String(YEAR))
    )
    .at(-1)?.date;

  if (currentYearLatest) {
    return currentYearLatest;
  }

  const metaLatest = metric.meta.latest?.date
    ? String(metric.meta.latest.date).slice(0, 10)
    : null;

  if (metaLatest) {
    return metaLatest;
  }

  return history.at(-1)?.date ?? null;
}
function calculateRates(
  history: Array<{ date: string; value: number }>,
  transform?: string,
  frequency?: string,
  metricId?: string
) {
    history = normalizeHistory(history);
  const isPercentagePointRate = metricId
    ? percentagePointIds.has(metricId)
    : false;

  const secondLabel =
    metricId === "uk-unemployment" ||
    metricId === "uk-employment-rate" ||
    metricId === "uk-inactivity-rate"
      ? "QoQ"
      : frequency === "quarterly"
        ? "QoQ"
        : "MoM";

  if (!history.length) {
    return {
      yoy: null,
      mom: null,
      secondLabel,
    };
  }

  // Change in Private Inventories is not a normal level series.
  // Do not calculate ratio-based percentage changes.
  if (metricId === "us-real-inventories") {
    return {
      yoy: null,
      mom: null,
      secondLabel,
    };
  }

  const latest = history[history.length - 1];

  if (isPercentagePointRate) {
    const prior = history[history.length - 2];

    const latestTime = new Date(
      `${latest.date.slice(0, 10)}T00:00:00Z`
    ).getTime();

    const targetYearAgo =
      latestTime - 365.25 * 24 * 60 * 60 * 1000;

    const priorYear = history
      .filter((p) => {
        const t = new Date(
          `${p.date.slice(0, 10)}T00:00:00Z`
        ).getTime();

        return (
          t <= targetYearAgo + 14 * 24 * 60 * 60 * 1000 &&
          t >= targetYearAgo - 14 * 24 * 60 * 60 * 1000
        );
      })
      .sort((a, b) => {
        const ta = new Date(
          `${a.date.slice(0, 10)}T00:00:00Z`
        ).getTime();

        const tb = new Date(
          `${b.date.slice(0, 10)}T00:00:00Z`
        ).getTime();

        return (
          Math.abs(ta - targetYearAgo) -
          Math.abs(tb - targetYearAgo)
        );
      })[0];

    return {
      yoy: priorYear
        ? latest.value - priorYear.value
        : null,
      mom: prior
        ? latest.value - prior.value
        : null,
      secondLabel,
    };
  }

  // ---------------------------------------------------------
  // BEA REAL GDP
  // T10101:1 is already "percent change from preceding
  // quarter", published at an annual rate.
  //
  // Convert the quarterly annualized rates into quarter-to-
  // quarter growth factors, then compound the latest four
  // quarters to get the YoY rate.
  // ---------------------------------------------------------
  if (metricId === "us-gdp-real") {
    const quarterlyRates = history
      .slice(-5)
      .map((p) => ({
        date: p.date,
        value: Number(p.value),
      }))
      .filter((p) => Number.isFinite(p.value));

    const qoq = annualizedToQuarterlyRate(
      latest.value
    );

    let yoy: number | null = null;

    if (quarterlyRates.length >= 5) {
      const lastFour = quarterlyRates.slice(-4);

      const growthFactor = lastFour.reduce(
        (factor, p) =>
          factor * Math.pow(1 + p.value / 100, 1 / 4),
        1
      );

      yoy = (growthFactor - 1) * 100;
    }

    return {
      yoy,
      mom: qoq,
      secondLabel: "QoQ",
    };
  }

  // ---------------------------------------------------------
  // Published rate series
  //
  // If the source itself publishes a percentage rate, use
  // that value directly for the displayed period.
  // ---------------------------------------------------------
  if (transform === "published_rate") {
    const latest = history[history.length - 1]?.value ?? null;

    if (metricId === "ea-wage-growth") {
      return {
        yoy: latest,
        mom: null,
        secondLabel: "QoQ",
      };
    }

    if (metricId?.includes("yoy")) {
      return {
        yoy: latest,
        mom: null,
        secondLabel: "MoM",
      };
    }

    if (metricId?.includes("mom")) {
      return {
        yoy: null,
        mom: latest,
        secondLabel: "MoM",
      };
    }

    if (metricId?.includes("qoq")) {
      return {
        yoy: null,
        mom: latest,
        secondLabel: "QoQ",
      };
    }

    // Published rate with no explicit yoy/mom/qoq suffix.
    // Calculate percentage-point changes for rate series.
    const periodsPerYear =
      frequency === "quarterly" ? 4 : 12;

    const priorYearIndex =
      history.length - 1 - periodsPerYear;

    const priorPeriodIndex =
      history.length - 2;

    const priorYear =
      priorYearIndex >= 0
        ? history[priorYearIndex]?.value ?? null
        : null;

    const priorPeriod =
      priorPeriodIndex >= 0
        ? history[priorPeriodIndex]?.value ?? null
        : null;

    return {
      yoy:
        latest != null && priorYear != null
          ? latest - priorYear
          : null,

      mom:
        latest != null && priorPeriod != null
          ? latest - priorPeriod
          : null,

      secondLabel:
        frequency === "quarterly" ? "QoQ" : "MoM",
    };
  }

  const prior = history[history.length - 2];

  // Find the closest observation one year earlier rather than
  // requiring an exact date. This matters especially for weekly
  // series such as jobless claims.
  const latestTime = new Date(
    `${latest.date.slice(0, 10)}T00:00:00Z`
  ).getTime();

  const targetYearAgo =
    latestTime - 365.25 * 24 * 60 * 60 * 1000;

  const priorYear = history
    .filter((p) => {
      const t = new Date(
        `${p.date.slice(0, 10)}T00:00:00Z`
      ).getTime();

      return (
        t <= targetYearAgo + 14 * 24 * 60 * 60 * 1000 &&
        t >= targetYearAgo - 14 * 24 * 60 * 60 * 1000
      );
    })
    .sort((a, b) => {
      const ta = new Date(
        `${a.date.slice(0, 10)}T00:00:00Z`
      ).getTime();

      const tb = new Date(
        `${b.date.slice(0, 10)}T00:00:00Z`
      ).getTime();

      return (
        Math.abs(ta - targetYearAgo) -
        Math.abs(tb - targetYearAgo)
      );
    })[0];

  const levelLike =
    transform === "level" ||
    transform === "index";

  const yoy =
  levelLike &&
  priorYear &&
  priorYear.value !== 0
    ? ((latest.value / priorYear.value) - 1) * 100
    : transform === "pct_change_yoy"
      ? latest.value
      : transform === "pct_change_mom" &&
          frequency === "monthly"
        ? calculateCompoundedYoY(history)
        : null;

  const mom =
  levelLike &&
  prior &&
  prior.value !== 0
    ? ((latest.value / prior.value) - 1) * 100
    : transform === "pct_change_mom" ||
        transform === "published_rate" ||
        transform === "pct_change"
      ? latest.value
      : null;

  return {
    yoy,
    mom,
    secondLabel,
  };
}
function formatAbsoluteValue(
  value: number | null | undefined,
  unit?: string
) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }

  const normalizedUnit = unit?.toLowerCase() ?? "";

  if (normalizedUnit.includes("thousand")) {
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}M`;
    }

    return `${Math.round(value)}K`;
  }

  if (normalizedUnit === "number") {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }

    if (Math.abs(value) >= 1000) {
      return `${Math.round(value / 1000)}K`;
    }

    return `${Math.round(value)}`;
  }

  return value.toFixed(1);
}
function shiftPeriod(date: string, deltaMonths: number) {
  const d = new Date(
    `${date.slice(0, 10)}T00:00:00Z`
  );

  if (Number.isNaN(d.getTime())) return "";

  d.setUTCMonth(d.getUTCMonth() + deltaMonths);

  return (
    d.toISOString().slice(0, 7) +
    (date.length > 7 ? "-01" : "")
  );
}

function labelForMetric(m: Metric) {
  return m.shortName || m.name;
}

function findNode(
  spec: IndicatorSpec,
  id: string
): UiNode | null {
  const walk = (nodes?: UiNode[]): UiNode | null => {
    for (const node of nodes ?? []) {
      if (node.metricId === id || node.id === id) {
        return node;
      }

      const found = walk(node.children);

      if (found) return found;
    }

    return null;
  };

  return walk(spec.components);
}

function ratesForSpec(
  spec: IndicatorSpec,
  metrics: Record<string, DetailPayload | undefined>
) {
  const root = metrics[spec.metricId];
const isUsHeadlineCpi =
  spec.id === "us-cpi-card" ||
  spec.metricId === "us-cpi";
  const base = root
    ? calculateRates(
        root.history,
        root.meta.transform,
        root.meta.frequency,
        root.meta.id
      )
    : {
        yoy: null,
        mom: null,
        secondLabel: "MoM",
      };

  const yoyHistory = spec.yoyMetricId
  ? normalizeHistory(
      metrics[spec.yoyMetricId]?.history ?? []
    )
  : [];

const configuredMomHistory = spec.momMetricId
  ? normalizeHistory(
      metrics[spec.momMetricId]?.history ?? []
    )
  : [];

const cpiMomHistory = isUsHeadlineCpi
  ? normalizeHistory(
      metrics["us-cpi-mom"]?.history ?? []
    )
  : [];

const momHistory =
  isUsHeadlineCpi && cpiMomHistory.length
    ? cpiMomHistory
    : configuredMomHistory;

const yoyMetric = spec.yoyMetricId
  ? metrics[spec.yoyMetricId]
  : undefined;

const yoy = yoyHistory.length
  ? yoyMetric?.meta.transform === "level"
    ? calculateRates(
        yoyHistory,
        yoyMetric.meta.transform,
        yoyMetric.meta.frequency,
        yoyMetric.meta.id
      ).yoy
    : yoyHistory[yoyHistory.length - 1].value
  : base.yoy;

const cpiMomLatest = isUsHeadlineCpi
  ? metrics["us-cpi-mom"]?.meta.latest?.value ?? null
  : null;

const mom = isUsHeadlineCpi
  ? cpiMomLatest ??
    (momHistory.length
      ? momHistory[momHistory.length - 1].value
      : base.mom)
  : momHistory.length
    ? momHistory[momHistory.length - 1].value
    : base.mom;

  const secondLabel =
    root?.meta.frequency === "quarterly"
      ? "QoQ"
      : "MoM";

  return {
    yoy,
    mom,
    secondLabel,
  };
}
function getCardKpis(
  spec: IndicatorSpec,
  metric: DetailPayload | undefined,
  allMetrics: Record<string, DetailPayload | undefined>,
  surface: "front" | "detail" = "detail"
) {
  if (!metric) {
    return {
      mode: "normal" as const,
      leftLabel: "YoY",
      leftValue: null,
      rightLabel: "MoM",
      rightValue: null,
      showRight: true,
    };
  }

  const id = metric.meta.id;

  if (isQuarterlyGdpMetric(id)) {
    return getMetricKpis(metric);
  }

  // The US payroll front card emphasizes the month-over-month employment
  // change; the detail view keeps its existing published level comparison.
  if (id === "us-payrolls-level" && surface === "front") {
    const history = normalizeHistory(metric.history ?? []);
    const latest = history.at(-1)?.value;
    const prior = history.at(-2)?.value;
    return {
      mode: "absolute-change" as const,
      leftLabel: "Monthly Change",
      leftValue: latest != null && prior != null ? latest - prior : null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  // UK monthly GDP: show only the published MoM value.
  if (UK_GROWTH_MONTHLY_MOM_IDS.has(id)) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "normal" as const,
      leftLabel: "MoM",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  // UK net-trade contribution is a percentage-point contribution,
  // not a normal YoY/MoM growth rate.
  if (UK_GROWTH_NET_TRADE_PP_IDS.has(id ?? "")) {
    const history = normalizeHistory(
      metric.history ?? []
    );

    return {
      mode: "net-trade-pp" as const,
      leftLabel: "Latest",
      leftValue:
        history.at(-1)?.value ?? null,
      rightLabel: "Prior",
      rightValue:
        history.at(-2)?.value ?? null,
      showRight: true,
    };
  }
if (isUSNetExportsMetric(metric)) {
  const history = normalizeHistory(
    metric.history ?? []
  );

  return {
    mode: "level",
    leftLabel: "Latest",
    leftValue: history.at(-1)?.value ?? null,
    rightLabel: "Prior",
    rightValue: history.at(-2)?.value ?? null,
    showRight: true,
  };
}
  // Retail Sales: front card shows MoM only;
  // opened detail card shows both YoY and MoM.
  if (
    (
      id === "uk-retail-sales-total-ex-fuel" ||
      id === "us-retail-sales-total"
    ) &&
    surface === "front"
  ) {
    const rates = ratesForSpec(spec, {
      ...allMetrics,
      [spec.metricId]: metric,
    });

    return {
      mode: "normal" as const,
      leftLabel: "MoM",
      leftValue: rates.mom,
      rightLabel: "",
      rightValue: null,
      showRight: false,
    };
  }

  if (getDisplayMode(id) !== "normal") {
    return getMetricKpis(metric);
  }

  const rates = ratesForSpec(spec, {
    ...allMetrics,
    [spec.metricId]: metric,
  });

  return {
    mode: "normal" as const,
    leftLabel: "YoY",
    leftValue: rates.yoy,
    rightLabel: rates.secondLabel,
    rightValue: rates.mom,
    showRight: true,
  };
}

function ExpectationMetricPreview({
  spec,
  metrics,
}: {
  spec: IndicatorSpec;
  metrics: Record<string, DetailPayload | undefined>;
}) {
  const entries: UiNode[] = [];
  const collect = (nodes: UiNode[] = []) => {
    nodes.forEach((node) => {
      if (node.metricId) entries.push(node);
      if (node.children?.length) collect(node.children);
    });
  };
  collect(spec.components);

  return (
    <div className="expectation-metric-preview" aria-label="Current expectation readings">
      <span className="expectation-preview-heading">Current readings</span>
      <div className="expectation-preview-list">
        {entries.map((entry) => {
          const payload = entry.metricId ? metrics[entry.metricId] : undefined;
          const value = payload?.history?.at(-1)?.value;
          return (
            <div className="expectation-preview-item" key={entry.id} title={entry.label}>
              <span>{entry.label}</span>
              <strong>{formatExpectationValue(payload, value)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function MetricBadge({
  importance,
}: {
  importance?: string;
}) {
  const tone =
    importance === "critical"
      ? "badge-critical"
      : importance === "high"
        ? "badge-high"
        : importance === "medium"
          ? "badge-medium"
          : "badge-low";

  return (
    <span className={clsx("macro-badge", tone)}>
      {importance || "supporting"}
    </span>
  );
}

function ComponentPreview({
  nodes,
  metrics,
}: {
  nodes?: UiNode[];
  metrics: Record<string, DetailPayload | undefined>;
}) {
  const flat: UiNode[] = [];

  const walk = (xs: UiNode[]) =>
    xs.forEach((x) => {
      if (x.metricId) {
        flat.push(x);
      } else if (x.children) {
        const first = x.children.find(
          (c) => c.metricId
        );

        if (first?.metricId) {
          flat.push(first);
        }
      }
    });

  walk(nodes ?? []);

  return (
    <div className="component-preview">
      <div className="component-title">
        Key Components
      </div>

      {flat.slice(0, 4).map((node) => {
        const d = node.metricId
          ? metrics[node.metricId]
          : undefined;

        const isAbsoluteChange =
          d?.meta.id === "uk-employment-change";

        const rates =
          d && !isAbsoluteChange
            ? calculateRates(
                d.history,
                d.meta.transform,
                d.meta.frequency,
                d.meta.id
              )
            : null;

        const latestValue =
          d?.history?.at(-1)?.value ?? null;
const displayedMom =
  rates?.mom ??
  (d?.meta.transform === "pct_change_mom"
    ? latestValue
    : null);
        return (
          <div
            className="component-row"
            key={node.id}
          >
            <span>{node.label}</span>

            <span className="component-values">
              {isAbsoluteChange ? (
                <>
                  <b className={changeColor(latestValue)}>
                    {latestValue == null
                      ? "—"
                      : `${
                          latestValue > 0 ? "+" : ""
                        }${latestValue.toFixed(1)}k`}
                  </b>

                  <i>—</i>
                </>
              ) : (
                <>
                  <b>
                    {rates
                      ? percentagePointIds.has(
                          node.metricId ?? ""
                        )
                        ? pp(rates.yoy)
                        : pct(rates.yoy)
                      : "—"}
                  </b>

                  <i
                    className={changeColor(
                      rates?.mom
                    )}
                  >
                    {rates
                      ? percentagePointIds.has(
                          node.metricId ?? ""
                        )
                        ? pp(rates.mom)
                        : pct(rates.mom)
                      : "—"}
                  </i>
                </>
              )}
            </span>
          </div>
        );
      })}

      {flat.length > 4 && (
        <div className="component-more">
          + {flat.length - 4} more components
        </div>
      )}
    </div>
  );
}
function IndicatorCard({
  spec,
  metric,
  componentMetrics,
  groupLabel,
  highlighted = false,
  onOpen,
}: {
  spec: IndicatorSpec;
  metric: DetailPayload | undefined;
  componentMetrics: Record<
    string,
    DetailPayload | undefined
  >;
  groupLabel?: string;
  highlighted?: boolean;
  onOpen: () => void;
}) {
  const m = metric?.meta;

  const cardKpis = getCardKpis(
    spec,
    metric,
    componentMetrics,
    "front"
  );

  const invert =
    m?.subcategory?.includes("unemployment") ||
    m?.subcategory?.includes("claims") ||
    m?.id?.includes("unemployment") ||
    m?.id?.includes("claims");

  return (
    <article
      className={clsx("macro-card group", highlighted && "is-release-highlighted")}
      data-released-highlight={highlighted ? "true" : undefined}
      onClick={onOpen}
    >
      <div className="macro-card-head">
        <div className="min-w-0">
          <div className="eyebrow">
            {m?.region} · {groupLabel ?? m?.category}
          </div>

          <h3>{displayMetricTitle(spec, metric)}</h3>
        </div>

        <MetricBadge importance={m?.importance} />
      </div>

      {spec.expectationGroup ? (
        <ExpectationMetricPreview spec={spec} metrics={componentMetrics} />
      ) : <div className="macro-values">
        <div className="rate-box">
          <span>{cardKpis.leftLabel}</span>

          <strong
            className={
              cardKpis.mode === "normal" || cardKpis.mode === "absolute-change"
                ? changeColor(
                    cardKpis.leftValue,
                    invert
                  )
                : ""
            }
          >
            {cardKpis.mode === "normal" ? (
              percentagePointIds.has(
                spec.metricId
              ) ? (
                pp(cardKpis.leftValue)
              ) : (
                pct(cardKpis.leftValue)
              )
            ) : cardKpis.mode === "absolute-change" ? (
              formatAbsoluteChangeValue(cardKpis.leftValue, metric)
            ) : (
              formatMetricValue(
                cardKpis.leftValue,
                metric
              )
            )}
          </strong>
        </div>

        {cardKpis.showRight && (
          <div className="rate-box">
            <span>{cardKpis.rightLabel}</span>

            <strong
              className={
                cardKpis.mode === "normal" || cardKpis.mode === "absolute-change"
                  ? changeColor(
                      cardKpis.rightValue,
                      invert
                    )
                  : ""
              }
            >
              {cardKpis.mode === "normal" ? (
                percentagePointIds.has(
                  spec.metricId
                ) ? (
                  pp(cardKpis.rightValue)
                ) : (
                  pct(cardKpis.rightValue)
                )
              ) : cardKpis.mode === "absolute-change" ? (
                formatAbsoluteChangeValue(cardKpis.rightValue, metric)
              ) : (
                formatMetricValue(
                  cardKpis.rightValue,
                  metric
                )
              )}
            </strong>
          </div>
        )}
      </div>}

      <div
        className={clsx(
          "macro-spark",
          invert
            ? "text-[var(--down)]"
            : "text-[var(--accent)]"
        )}
        style={{
          width: "100%",
          height: "76px",
          minHeight: 0,
          overflow: "hidden",
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        <MiniRateChart
          spec={spec}
          root={metric}
          allMetrics={{
            ...componentMetrics,
            [spec.metricId]: metric,
          }}
        />
      </div>

      <div className="release-line">
        <CalendarDays size={14} />

        <span>
          Updated:{" "}
          {metric?.displayReleasedAt
            ? formatObsDate(
                metric.displayReleasedAt
              )
            : "—"}
        </span>

        <span className="release-source">
          Source:{" "}
          {m?.source?.toUpperCase() ?? "—"}
        </span>
      </div>

      <button
        className="detail-button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        View details <ChevronRight size={15} />
      </button>
    </article>
  );
}
function expectationHorizon(metricId: string, label: string) {
  const text = `${metricId} ${label}`.toLowerCase();

  // Check the compound horizons before the simple "5y" match.
  if (
    text.includes("5y5y") ||
    text.includes("5y-5y") ||
    text.includes("five-year, five-year") ||
    text.includes("five year five year")
  ) {
    return "5Y5Y";
  }

  if (
    text.includes("5-10y") ||
    text.includes("5–10y") ||
    text.includes("5 10y") ||
    text.includes("5 to 10y")
  ) {
    // The UI treats the Citi/YouGov 5–10Y measure as the
    // long-term "5Y" bucket so it can be compared directly
    // with the BoE 5Y component.
    return "5Y";
  }

  const match = text.match(/(?:^|[^0-9])(\d{1,2})\s*y(?:ear)?(?:$|[^a-z0-9])/i);
  if (match) {
    return `${match[1]}Y`;
  }

  // Some expectation metrics are inherently year-ahead series but their
  // metric id does not contain "1y" (for example Atlanta Fed Wage Tracker).
  return "1Y";
}

function expectationSeries(
  allMetrics: Record<string, DetailPayload | undefined>,
  id: string,
  label?: string
) {
  const metric = allMetrics[id]?.meta;
  const componentLabel =
    label ??
    metric?.shortName ??
    metric?.name ??
    id;

  const data = (allMetrics[id]?.history ?? [])
    .map((point) => ({
      date: point.date.slice(0, 10),
      value: Number(point.value),
    }))
    .filter(
      (point) =>
        point.date &&
        Number.isFinite(point.value)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const displayData = id === "uk-inflation-comp-5y5y" && data.length
    ? (() => {
        const latest = new Date(`${data[data.length - 1]!.date}T00:00:00Z`);
        latest.setUTCDate(latest.getUTCDate() - 29);
        const cutoff = latest.toISOString().slice(0, 10);
        return data.filter((point) => point.date >= cutoff);
      })()
    : data;

  return {
    id,
    label: componentLabel,
    horizon: expectationHorizon(id, componentLabel),
    frequency: metric?.frequency,
    data: displayData,
  };
}

function expectationChartNote(
  horizon: string,
  series: ReturnType<typeof expectationSeries>[] = []
) {
  if (series.some((item) => item.id === "uk-inflation-comp-5y5y")) {
    return "Bank of England implied inflation curve · daily · last 30 days.";
  }
  return `${horizon} expectation${horizon === "1Y" ? "" : "s"} — each line is a component/source.`;
}

function ExpectationCharts({
  spec,
  allMetrics,
}: {
  spec: IndicatorSpec;
  allMetrics: Record<string, DetailPayload | undefined>;
}) {
  if (!spec.expectationGroup) return null;

  /*
   * US Wage Expectations has a fixed structure:
   *
   * 1. NY Fed SCE inflation expectations
   * 2. NY Fed SCE household financial expectations
   * 3. NY Fed SCE labor-market expectations
   * 4. Atlanta Fed Wage Growth Tracker
   *
   * Do NOT group these by generic horizon because that mixes
   * unrelated household, labor and wage series together.
   */

  const isUsWageExpectations =
    spec.id === "us-inflation-expectations-wage";

  if (isUsWageExpectations) {
    const chartGroups = [
      {
        key: "nyfed-inflation",
        title: "NY Fed SCE Inflation Expectations",
        note: "1Y, 3Y and 5Y household inflation expectations.",
        ids: [
          "us-nyfed-sce-1y",
          "us-nyfed-sce-3y",
          "us-nyfed-sce-5y",
        ],
      },

      {
        key: "nyfed-household",
        title: "NY Fed SCE Household Financial Expectations",
        note: "Household income, spending and tax expectations.",
        ids: [
          "us-nyfed-sce-finance-income-1y",
          "us-nyfed-sce-finance-spending-1y",
          "us-nyfed-sce-finance-tax-1y",
        ],
      },

      {
        key: "pay-growth",
        title: "Household Pay Growth Expectations",
        note: "NY Fed SCE expected earnings growth and Atlanta Fed wage growth tracker.",
        ids: [
          "us-nyfed-sce-labor-earnings-1y",
          "us-atlanta-wage",
        ],
      },
      {
        key: "labor-market-probabilities",
        title: "NY Fed SCE Labor Market Probabilities",
        note: "Expected probabilities of finding a job, job separation and higher unemployment.",
        ids: [
          "us-nyfed-sce-labor-job-separation-1y",
          "us-nyfed-sce-labor-job-finding-1y",
          "us-nyfed-sce-labor-unemployment-1y",
        ],
      },
    ];

    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {chartGroups.map((group) => {
          const series = group.ids
            .filter((id) =>
              Boolean(allMetrics[id])
            )
            .map((id) =>
              expectationSeries(
                allMetrics,
                id
              )
            )
          if (!series.length) {
            return null;
          }

          return (
            <ExpectationComparisonChart
              key={`${spec.id}-${group.key}`}
              title={group.title}
              note={group.note}
              series={series}
            />
          );
        })}
      </div>
    );
  }
const isUsBusinessExpectations =
  spec.id === "us-inflation-expectations-business";

  if (isUsBusinessExpectations) {
  const chartGroups = [
    {
      key: "atlanta-bie",
      title: "Atlanta Fed BIE",
      note: "Monthly 1Y business inflation expectations.",
      ids: [
        "us-atlanta-bie-1y",
      ],
    },
      {
        key: "cleveland-sofie",
        title: "Cleveland Fed SoFIE",
        note: "Quarterly 1Y business inflation expectations.",
        ids: [
          "us-cleveland-sofie-1y",
        ],
      },
      {
        key: "cleveland-sofie-5y",
        title: "Cleveland Fed SoFIE · 5-Year",
        note: "Quarterly long-term business inflation expectations.",
        ids: [
          "us-cleveland-sofie-5y",
        ],
      },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {chartGroups.map((group) => {
        const series = group.ids
          .filter((id) =>
            Boolean(allMetrics[id])
          )
          .map((id) =>
            expectationSeries(
              allMetrics,
              id
            )
          )
        if (!series.length) {
          return null;
        }

        return (
          <ExpectationComparisonChart
            key={`${spec.id}-${group.key}`}
            title={group.title}
            note={group.note}
            series={series}
          />
        );
      })}
    </div>
  );
}
  /*
   * Keep the existing generic behavior for all other
   * expectation groups.
   */

  const ids = (
    spec.chartMetricIds?.length
      ? spec.chartMetricIds
      : collectMetricIds(
          spec.components
        )
  ).filter((id) =>
    Boolean(allMetrics[id])
  );

  if (!ids.length) {
    return (
      <div className="expectation-comparison-empty" role="status">
        No series data is available for this card.
      </div>
    );
  }

  const series = ids.map((id) =>
    expectationSeries(
      allMetrics,
      id
    )
  );

  const grouped = new Map<
    string,
    ReturnType<
      typeof expectationSeries
    >[]
  >();

  for (const item of series) {
    if (!item.data.length) continue;

    const bucket =
      grouped.get(item.horizon) ?? [];

    bucket.push(item);

    grouped.set(
      item.horizon,
      bucket
    );
  }

  const explicitGroups: Record<string, Array<{ key: string; title: string; note: string; ids: string[] }>> = {
    "uk-inflation-expectations-business": [
      {
        key: "dmp-cpi-1y",
        title: "BoE Decision Maker Panel · CPI 1-Year Expectations",
        note: "Businesses’ expected consumer price inflation one year ahead.",
        ids: ["uk-dmp-inflation-exp-1y"],
      },
      {
        key: "dmp-cpi-3y",
        title: "BoE Decision Maker Panel · CPI 3-Year Expectations",
        note: "Businesses’ expected consumer price inflation three years ahead.",
        ids: ["uk-dmp-inflation-exp-3y"],
      },
      {
        key: "dmp-own-price",
        title: "BoE Decision Maker Panel · Own-Price Expectations",
        note: "Businesses’ expected own-price growth.",
        ids: ["uk-dmp-own-price-exp-1y"],
      },
    ],
    "ea-inflation-expectations-business": [
      {
        key: "selling-prices",
        title: "ECB SAFE · Selling-Price Expectations",
        note: "Expected selling-price growth over the next year.",
        ids: ["ea-safe-selling-price-exp-1y"],
      },
      {
        key: "input-costs",
        title: "ECB SAFE · Input-Cost Expectations",
        note: "Expected non-labour input-cost growth over the next year.",
        ids: ["ea-safe-input-cost-exp-1y"],
      },
      {
        key: "wages",
        title: "ECB SAFE · Wage Expectations",
        note: "Businesses’ expected wage growth over the next year.",
        ids: ["ea-safe-wage-exp-1y"],
      },
    ],
    "ea-inflation-expectations-wage": [
      {
        key: "wage-tracker",
        title: "ECB Wage Tracker",
        note: "Agreed wage growth, including and excluding one-off payments.",
        ids: ["ea-wage-tracker", "ea-wage-tracker-ex-oneoff"],
      },
      {
        key: "spf-wages",
        title: "ECB SPF · Wage Expectations",
        note: "Professional forecasters’ wage and labour-cost outlook.",
        ids: ["ea-spf-wage-exp-1y"],
      },
    ],
    "ea-inflation-expectations-professional": [
      {
        key: "spf-current-year",
        title: "ECB SPF · Current-Year HICP",
        note: "Survey forecast for the current calendar year.",
        ids: ["ea-spf-current-year"],
      },
      {
        key: "spf-one-year",
        title: "ECB SPF · One-Year-Ahead HICP",
        note: "Survey forecast for inflation one year ahead.",
        ids: ["ea-inflation-exp-1y"],
      },
      {
        key: "spf-two-year",
        title: "ECB SPF · Two-Year-Ahead HICP",
        note: "Survey forecast for inflation two years ahead.",
        ids: ["ea-spf-hicp-2y"],
      },
      {
        key: "spf-long-term",
        title: "ECB SPF · Long-Term HICP",
        note: "Long-term professional inflation expectations.",
        ids: ["ea-inflation-exp-lt"],
      },
    ],
  };

  const explicit = explicitGroups[spec.id];
  if (explicit) {
    const groups = explicit.map((group) => ({
      ...group,
      series: group.ids
        .filter((id) => Boolean(allMetrics[id]))
        .map((id) => expectationSeries(allMetrics, id)),
    })).filter((group) => group.series.length > 0);

    if (groups.length) {
      return (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => (
            <ExpectationComparisonChart
              key={`${spec.id}-${group.key}`}
              title={group.title}
              note={group.note}
              series={group.series}
            />
          ))}
        </div>
      );
    }
  }

  if (!grouped.size) {
    return (
      <div className="expectation-comparison-empty" role="status">
        No historical observations are available for this expectation group yet.
      </div>
    );
  }

  const horizonOrder = [
    "1Y",
    "2Y",
    "3Y",
    "4Y",
    "5Y",
    "5–10Y",
    "5Y5Y",
    "10Y",
    "30Y",
  ];

  const charts = [
    ...grouped.entries(),
  ].sort(([a], [b]) => {
    const ai =
      horizonOrder.indexOf(a);
    const bi =
      horizonOrder.indexOf(b);

    if (
      ai !== -1 &&
      bi !== -1
    ) {
      return ai - bi;
    }

    if (ai !== -1) return -1;
    if (bi !== -1) return 1;

    return a.localeCompare(b);
  });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {charts.map(
        ([horizon, horizonSeries]) => (
          <ExpectationComparisonChart
            key={`${spec.id}-${horizon}`}
            title={`${horizon} Expectations`}
            note={expectationChartNote(horizon, horizonSeries)}
            series={horizonSeries}
          />
        )
      )}
    </div>
  );
}
function collectMetricIds(nodes: UiNode[] | undefined): string[] {
  const out: string[] = [];
  const walk = (xs: UiNode[]) => {
    for (const node of xs) {
      if (node.metricId) out.push(node.metricId);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes ?? []);
  return out;
}

function ExpectationKpis({
  spec,
  allMetrics,
}: {
  spec: IndicatorSpec;
  allMetrics: Record<string, DetailPayload | undefined>;
}) {
  if (!spec.expectationGroup) return null;

  const ids = [...new Set([
    ...collectMetricIds(spec.components),
    ...(spec.chartMetricIds ?? []),
  ])];
  const items = ids.map((id) => allMetrics[id]).filter((payload): payload is DetailPayload => Boolean(payload));
  const value = (payload: DetailPayload | undefined) => payload?.history.at(-1)?.value ?? null;
  const fmt = (payload: DetailPayload | undefined) => {
    const v = value(payload);
    return formatExpectationValue(payload, v);
  };

  return (
    <div className="expectation-kpi-grid grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((payload) => (
        <div className="rate-box" key={payload.meta.id}>
          <span>{payload.meta.shortName || payload.meta.name}</span>
          <strong>{fmt(payload)}</strong>
          <small>{getLatestPeriodDate(payload) ? formatObsDate(getLatestPeriodDate(payload)!) : "—"}</small>
        </div>
      ))}
    </div>
  );
}

function ExpectationComponentsTable({
  spec,
  allMetrics,
  onComponentOpen,
}: {
  spec: IndicatorSpec;
  allMetrics: Record<string, DetailPayload | undefined>;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
}) {
  const rows = [...new Set([
    ...collectMetricIds(spec.components),
    ...(spec.chartMetricIds ?? []),
  ])]
    .map((id) => allMetrics[id])
    .filter((payload): payload is DetailPayload => Boolean(payload));

  return (
    <div className="expectation-data-table overflow-x-auto rounded-xl border border-[var(--line)]">
      <table className="min-w-[900px] w-full text-left text-[11px]">
        <thead>
  <tr>
    <th className="px-3 py-2">Name</th>
    <th className="px-3 py-2">Short Name</th>
    <th className="px-3 py-2 text-right">Latest</th>
    <th className="px-3 py-2 text-right">Prior</th>
    <th className="px-3 py-2">Unit</th>
    <th className="px-3 py-2">Frequency</th>
    <th className="px-3 py-2">Source</th>
    <th className="px-3 py-2">Latest period</th>
    <th className="px-3 py-2">Released</th>
    <th className="px-3 py-2"></th>
  </tr>
</thead>
        <tbody>
          {rows.map((payload) => (
            <tr key={payload.meta.id} className="border-t border-[var(--line)]">
              <td className="px-3 py-2 font-medium text-[var(--ink)]">{payload.meta.name}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{payload.meta.shortName}</td>
              <td className="px-3 py-2 text-right font-mono font-semibold">{formatExpectationValue(payload, payload.history.at(-1)?.value)}</td>
              <td className="px-3 py-2 text-right font-mono">{formatExpectationValue(payload, payload.history.at(-2)?.value)}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{payload.meta.unit}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{payload.meta.frequency}</td>
              <td className="px-3 py-2 text-[var(--muted)]">
                {payload.meta.officialUrl ? (
                  <a href={payload.meta.officialUrl} target="_blank" rel="noreferrer" className="expectation-source-link">
                    {payload.meta.source || "Official source"}
                  </a>
                ) : payload.meta.source || "—"}
              </td>
              <td className="px-3 py-2 text-[var(--muted)]">{getLatestPeriodDate(payload) ? formatObsDate(getLatestPeriodDate(payload)!) : "—"}</td>
              <td className="px-3 py-2 text-[var(--muted)]">{(payload.displayReleasedAt ?? payload.releases?.at(-1)?.releasedAt) ? formatObsDate((payload.displayReleasedAt ?? payload.releases?.at(-1)?.releasedAt)!) : "—"}</td>
              <td className="px-3 py-2 text-right">
  <button
    type="button"
    className="component-detail-button"
    style={{
      position: "relative",
      zIndex: 3,
      transform: "translateX(-20px)",
    }}
    onClick={(e) => {
      e.stopPropagation();
      onComponentOpen(payload.meta.id);
    }}
    aria-label={`View ${
      payload.meta.shortName || payload.meta.name
    } details`}
  >
    <ChevronRight size={16} />
  </button>
</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getInflationDistributionNodes(nodes: UiNode[]): UiNode[] {
  const leaves: UiNode[] = [];

  const walk = (items: UiNode[]) => {
    items.forEach((node) => {
      if (node.metricId) {
        leaves.push(node);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    });
  };

  walk(nodes);
  return leaves;
}

function InflationDistribution({
  nodes,
  metrics,
  latestPeriod,
}: {
  nodes: UiNode[];
  metrics: Record<string, DetailPayload | undefined>;
  latestPeriod?: string | null;
}) {
  const rows = getInflationDistributionNodes(nodes)
    .map((node) => {
      const metric = node.metricId ? metrics[node.metricId] : undefined;
      if (!metric) return null;

      const rates = calculateRates(
        metric.history ?? [],
        metric.meta.transform,
        metric.meta.frequency,
        metric.meta.id
      );

      const value = Number(rates.yoy);
      if (!Number.isFinite(value)) return null;

      return {
        id: node.id,
        label: node.label,
        value,
      };
    })
    .filter((row): row is { id: string; label: string; value: number } => Boolean(row))
    .sort((a, b) => b.value - a.value);

  if (!rows.length) return null;

  const maxAbs = Math.max(...rows.map((row) => Math.abs(row.value)), 1);

  return (
    <section className="inflation-distribution">
      <div className="inflation-distribution-head">
        <div>
          <h3>Inflation Distribution</h3>
          <p>
            Current component YoY readings
            {latestPeriod ? ` · ${formatObsDate(latestPeriod)}` : ""}
          </p>
        </div>
        <span>{YEAR} only</span>
      </div>

      <div className="inflation-distribution-grid">
        {rows.map((row) => {
          const positive = row.value >= 0;
          const width = Math.max(
            4,
            Math.min(100, (Math.abs(row.value) / maxAbs) * 100)
          );

          return (
            <div className="inflation-distribution-row" key={row.id}>
              <div className="inflation-distribution-label" title={row.label}>
                {row.label}
              </div>
              <div className="inflation-distribution-track">
                <span
                  className={clsx(
                    "inflation-distribution-bar",
                    positive ? "positive" : "negative"
                  )}
                  style={{ width: `${width}%` }}
                />
                <span className="inflation-distribution-zero" />
              </div>
              <div
                className={clsx(
                  "inflation-distribution-value",
                  positive ? "positive" : "negative"
                )}
              >
                {pct(row.value)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComponentDetailDrawer({
  region,
  metricId,
  allMetrics,
  components = [],
  onClose,
}: {
  region: Region;
  metricId: string;
  allMetrics: Record<string, DetailPayload | undefined>;
  components?: UiNode[];
  onClose: () => void;
}) {
  const metric = allMetrics[metricId];

  if (!metric) return null;

  const spec: IndicatorSpec = {
    id: `${metric.meta.id}-component`,
    title: metric.meta.shortName || metric.meta.name,
    metricId: metric.meta.id,
  };

  const cardKpis = getMetricKpis(metric);
  const latestPeriodDate = getLatestPeriodDate(metric);

  const renderKpi = (value: number | null | undefined) => {
    if (cardKpis.mode === "normal") {
      return percentagePointIds.has(metric.meta.id)
        ? pp(value)
        : pct(value);
    }

    return formatMetricValue(value, metric);
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        padding: 18,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(1120px, calc(100vw - 36px))",
          maxWidth: 1120,
          height: "min(94vh, 960px)",
          maxHeight: "94vh",
          minHeight: 0,
          overflow: "hidden",
          boxSizing: "border-box",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,.38)",
        }}
      >
        <div
          className="drawer-header"
          style={{
            flex: "0 0 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            padding: "22px 24px 10px",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="eyebrow">
              {region} · {metric.meta.category?.toUpperCase() ?? ""}
            </div>

            <div
              className="drawer-title-row"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  minWidth: 0,
                  color: "var(--text)",
                  lineHeight: 1.12,
                  fontSize: "clamp(24px, 3vw, 34px)",
                  letterSpacing: "-0.02em",
                }}
              >
                {displayMetricTitle(spec, metric)}
              </h2>

              <MetricBadge importance={metric.meta.importance} />
            </div>

            <p
              style={{
                margin: "8px 0 0",
                lineHeight: 1.45,
                color: "var(--muted)",
                overflowWrap: "anywhere",
              }}
            >
              {metric.meta.releaseName || "Official data series"}
              {metric.meta.source ? ` · ${metric.meta.source.toUpperCase()}` : ""}
              {metric.meta.frequency ? ` · ${metric.meta.frequency}` : ""}
            </p>
          </div>

          <button
            className="drawer-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
            style={{
              flex: "0 0 auto",
              width: 40,
              height: 40,
              minWidth: 40,
              display: "grid",
              placeItems: "center",
            }}
          >
            <X size={21} />
          </button>
        </div>

        <div
          className="drawer-release"
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 10,
            minWidth: 0,
            padding: "10px 24px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span>Release date: <b>{metric.displayReleasedAt ? formatObsDate(metric.displayReleasedAt) : "—"}</b></span>
          <span>Latest period: <b>{latestPeriodDate ? formatObsDate(latestPeriodDate) : "—"}</b></span>
          <span>Source: <b>{metric.meta.source?.toUpperCase() ?? "—"}</b></span>
          <span>Frequency: <b>{metric.meta.frequency ?? "—"}</b></span>
        </div>

        <div
          className="drawer-kpis"
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: cardKpis.showRight
              ? "repeat(2, minmax(0, 1fr))"
              : "minmax(0, 1fr)",
            gap: 14,
            minWidth: 0,
            padding: "16px 24px 18px",
          }}
        >
          <div
            className="drawer-kpi"
            style={{
              minWidth: 0,
              background: "var(--panel-2, var(--panel))",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <span>{cardKpis.leftLabel}</span>
            <strong
              className={
                cardKpis.mode === "normal"
                  ? changeColor(cardKpis.leftValue)
                  : ""
              }
              style={{ display: "block", marginTop: 4 }}
            >
              {renderKpi(cardKpis.leftValue)}
            </strong>
          </div>

          {cardKpis.showRight && (
            <div
              className="drawer-kpi"
              style={{
                minWidth: 0,
                background: "var(--panel-2, var(--panel))",
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <span>{cardKpis.rightLabel}</span>
              <strong
                className={
                  cardKpis.mode === "normal"
                    ? changeColor(cardKpis.rightValue)
                    : ""
                }
                style={{ display: "block", marginTop: 4 }}
              >
                {renderKpi(cardKpis.rightValue)}
              </strong>
            </div>
          )}
        </div>

        <div
          className="drawer-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
  className="drawer-scroll-inner"
  style={{
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "0 24px 28px",
    overflow: "visible",
  }}
>
            <section
  className="drawer-chart"
  style={{
    width: "100%",
    minWidth: 0,
    margin: "0 0 18px",
    padding: 16,
    boxSizing: "border-box",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    overflow: "visible",
  }}
>
              <div
                className="drawer-section-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0, color: "var(--text)" }}>
                  {displayMetricTitle(spec, metric)}
                </h3>
                <span style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                  {metric.meta.frequency === "daily" || metric.meta.frequency === "hourly"
                    ? "Last 30 days"
                    : `${YEAR} trend`}
                </span>
              </div>

              <div
  style={{
    width: "100%",
    minWidth: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
  <RateChart
    spec={spec}
    root={metric}
    allMetrics={allMetrics}
    height={440}
  />
</div>
            </section>

            {metric.meta.category?.toLowerCase().includes("inflation") && components.length > 0 && (
              <InflationDistribution
                nodes={components}
                metrics={allMetrics}
                latestPeriod={latestPeriodDate}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailDrawer({
  region,
  spec,
  root,
  allMetrics,
  onClose,
  onComponentOpen,
}: {
  region: Region;
  spec: IndicatorSpec;
  root: DetailPayload | undefined;
  allMetrics: Record<string, DetailPayload | undefined>;
  onClose: () => void;
  onComponentOpen: (metricId: string, children?: UiNode[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const cardKpis = getCardKpis(spec, root, allMetrics, "detail");
  const allNodes = spec.components ?? [];
  const latestPeriodDate = getLatestPeriodDate(root);
  const expectationMetricIds = [...new Set([
    ...collectMetricIds(allNodes),
    ...(spec.chartMetricIds ?? []),
  ])];
  const expectationPayloads = expectationMetricIds
    .map((id) => allMetrics[id])
    .filter((payload): payload is DetailPayload => Boolean(payload));
  const expectationSources = [...new Set(expectationPayloads
    .map((payload) => payload.meta.source?.trim())
    .filter((source): source is string => Boolean(source)))];
  const expectationFrequencies = [...new Set(expectationPayloads
    .map((payload) => payload.meta.frequency?.trim())
    .filter((frequency): frequency is string => Boolean(frequency)))];
  const latestExpectationRelease = expectationPayloads
    .flatMap((payload) => [payload.displayReleasedAt, payload.releases?.at(-1)?.releasedAt])
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

  const isExpectation =
    spec.id.includes("expectations_") ||
    root?.meta.subcategory?.startsWith("expectations_") ||
    isInflationExpectationSpecId(spec);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    allNodes.forEach((n) => {
      next[n.id] = true;
    });
    setOpen(next);
  }, [spec.id]);

  const renderNode = (node: UiNode, depth = 0): React.ReactNode => {
    const d = node.metricId ? allMetrics[node.metricId] : undefined;
    const componentKpis = d ? getMetricKpis(d) : null;
    const officialWeight = getOfficialComponentWeight(node.metricId);
    const hasChildren = !!node.children?.length;
    const expanded = !!open[node.id];

    const renderValue = (value: number | null | undefined) => {
      if (!d || !componentKpis) return "—";
      if (componentKpis.mode === "normal") {
        return percentagePointIds.has(d.meta.id) ? pp(value) : pct(value);
      }
      return formatMetricValue(value, d);
    };

    const currentLatest = getLatestPeriodDate(d);

    return (
      <div
        key={`${node.id}-${depth}`}
        className={clsx("drawer-node", depth > 0 && "drawer-node-child")}
        style={{ width: "100%", minWidth: 0 }}
      >
        <div
          className={clsx("drawer-row", hasChildren && "drawer-group")}
          style={{
            display: "grid",
            gridTemplateColumns: "28px minmax(0, 1fr) 52px 72px 72px minmax(48px, 80px) 30px",
            alignItems: "center",
            columnGap: 4,
            width: "100%",
            minWidth: 0,
            minHeight: 56,
            padding: "7px 10px",
            boxSizing: "border-box",
            background: hasChildren
              ? "var(--panel-2, var(--panel))"
              : "var(--panel)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            className="node-toggle"
            onClick={() => {
              if (hasChildren) {
                setOpen((v) => ({ ...v, [node.id]: !expanded }));
              }
            }}
            aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
            style={{
              width: 30,
              height: 30,
              minWidth: 30,
              display: "grid",
              placeItems: "center",
              justifySelf: "center",
              padding: 0,
              borderRadius: 8,
              boxSizing: "border-box",
            }}
          >
            {hasChildren ? (
              expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />
            ) : (
              <span className="node-dot" />
            )}
          </button>

          <div
            className="node-name"
            style={{
              minWidth: 0,
              color: "var(--text)",
              fontWeight: hasChildren ? 700 : 500,
              fontSize: depth > 0 ? 12 : 13,
              lineHeight: 1.35,
              overflowWrap: "anywhere",
              whiteSpace: "normal",
              paddingLeft: depth ? Math.min(depth * 16, 32) : 0,
            }}
          >
            {node.label}
          </div>

          <div
            className="node-weight"
            title={officialWeight ? `${officialWeight.basis}. Official all-items basket share.` : "No directly comparable official basket weight is available for this row."}
            style={{
              minWidth: 0,
              textAlign: "right",
              color: officialWeight ? "var(--text)" : "var(--muted)",
              whiteSpace: "nowrap",
              fontSize: 11,
              fontWeight: officialWeight ? 600 : 400,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {officialWeight ? (
              <a
                href={officialWeight.source}
                target="_blank"
                rel="noreferrer"
                aria-label={`Official weight ${formatOfficialComponentWeight(officialWeight.value)}; ${officialWeight.basis}`}
                style={{ color: "var(--accent-ink)", textDecoration: "none" }}
              >
                {formatOfficialComponentWeight(officialWeight.value)}
              </a>
            ) : "N/A"}
          </div>

          <div
            className="node-rate"
            style={{
              minWidth: 0,
              textAlign: "right",
              color: "var(--text)",
              whiteSpace: "nowrap",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {isExpectation
              ? formatExpectationValue(d, d?.history?.at(-1)?.value)
              : renderValue(componentKpis?.leftValue)}
          </div>

          <div
            className="node-rate"
            style={{
              minWidth: 0,
              textAlign: "right",
              color: "var(--text)",
              whiteSpace: "nowrap",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {isExpectation
              ? formatExpectationValue(d, d?.history?.at(-2)?.value)
              : componentKpis?.showRight
                ? renderValue(componentKpis.rightValue)
                : "—"}
          </div>

          <div
            className="node-trend"
            style={{
              minWidth: 0,
              width: "100%",
              height: 34,
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
            }}
          >
            {isExpectation ? (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {currentLatest ? formatObsDate(currentLatest) : "—"}
              </span>
            ) : d ? (
              <Spark
                data={d.history}
                frequency={d.meta.frequency}
                compact
              />
            ) : (
              <span style={{ color: "var(--muted)" }}>—</span>
            )}
          </div>

          <button
            type="button"
            className="component-detail-button"
            onClick={(e) => {
              e.stopPropagation();
              if (d?.meta.id) onComponentOpen(d.meta.id, node.children ?? []);
            }}
            aria-label={`View ${node.label} details`}
            style={{
              width: 30,
              height: 30,
              minWidth: 30,
              display: "grid",
              placeItems: "center",
              justifySelf: "end",
              padding: 0,
              borderRadius: 8,
              boxSizing: "border-box",
              marginRight: 0,
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {hasChildren && expanded && (
          <div
            className="drawer-children"
            style={{
              width: "100%",
              minWidth: 0,
              margin: 0,
              padding: 0,
              boxSizing: "border-box",
              borderLeft: "1px solid var(--line)",
              background: "rgba(255,255,255,.012)",
            }}
          >
            {node.children!.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const componentLeftHeader = cardKpis.leftLabel;
  const componentRightHeader = cardKpis.showRight ? cardKpis.rightLabel : "";

  const renderKpi = (value: number | null | undefined) => {
    if (cardKpis.mode === "normal") {
      return percentagePointIds.has(spec.metricId) ? pp(value) : pct(value);
    }
    return formatMetricValue(value, root);
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        padding: 14,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(1240px, calc(100vw - 28px))",
          maxWidth: 1240,
          height: "min(94vh, 980px)",
          maxHeight: "94vh",
          minHeight: 0,
          overflow: "hidden",
          boxSizing: "border-box",
          background: "var(--panel)",
          color: "var(--text)",
          border: "1px solid var(--line)",
          borderRadius: 18,
          boxShadow: "0 24px 80px rgba(0,0,0,.38)",
        }}
      >
        <div
          className="drawer-header"
          style={{
            flex: "0 0 auto",
            minWidth: 0,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            padding: "22px 24px 10px",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="eyebrow">
              {region} · {root?.meta.category?.toUpperCase() ?? ""}
            </div>

            <div
              className="drawer-title-row"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  minWidth: 0,
                  color: "var(--text)",
                  lineHeight: 1.12,
                  fontSize: "clamp(26px, 3vw, 36px)",
                  letterSpacing: "-0.02em",
                }}
              >
                {displayMetricTitle(spec, root)}
              </h2>

              <MetricBadge importance={root?.meta.importance} />
            </div>

            <p
              style={{
                margin: "8px 0 0",
                lineHeight: 1.45,
                color: "var(--muted)",
                overflowWrap: "anywhere",
              }}
            >
              {isExpectation
                ? spec.expectationGroup === "consumer"
                  ? region === "EA"
                    ? "ECB Consumer Expectations Survey (CES)"
                    : "BoE Inflation Attitudes Survey + Citi/YouGov"
                  : spec.expectationGroup === "business"
                    ? region === "EA"
                      ? "ECB SAFE Survey"
                      : region === "UK"
                        ? "BoE Decision Maker Panel"
                        : "Atlanta Fed BIE + Cleveland Fed SoFIE"
                    : spec.expectationGroup === "market"
                      ? region === "EA"
                        ? "Euro Area Inflation Compensation"
                        : region === "UK"
                          ? "UK Inflation Swaps"
                          : "5Y5Y FWD + 5Y + 10Y"
                      : spec.expectationGroup === "professional"
                        ? region === "EA"
                          ? "ECB Survey of Professional Forecasters"
                          : "BoE Market Participants Survey"
                        : spec.expectationGroup === "wage"
                          ? region === "EA"
                            ? "ECB Wage Tracker + ECB SPF"
                            : region === "UK"
                              ? "BoE DMP + BoE Agents"
                              : "New York Fed SCE + Atlanta Fed Wage Growth Tracker"
                          : "Inflation expectations"
                : `${root?.meta.releaseName ?? "Official data series"}${root?.meta.source ? ` · ${root.meta.source.toUpperCase()}` : ""}${root?.meta.frequency ? ` · ${root.meta.frequency}` : ""}`}
            </p>
          </div>

          <button
            className="drawer-close"
            onClick={onClose}
            aria-label="Close"
            type="button"
            style={{
              flex: "0 0 auto",
              width: 40,
              height: 40,
              minWidth: 40,
              display: "grid",
              placeItems: "center",
            }}
          >
            <X size={21} />
          </button>
        </div>

        <div
          className={clsx("drawer-release", isExpectation && "expectation-release-meta")}
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: isExpectation
              ? "repeat(4, minmax(0, 1fr))"
              : "repeat(4, minmax(0, 1fr))",
            gap: 10,
            minWidth: 0,
            padding: "10px 24px 16px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {isExpectation ? (
            <>
              <span>
                Sources: <b>{expectationSources.length ? expectationSources.join(" · ").toUpperCase() : "—"}</b>
              </span>
              <span>
                Frequency: <b>{expectationFrequencies.length ? expectationFrequencies.join(" + ") : "—"}</b>
              </span>
              <span>Latest release: <b>{latestExpectationRelease ? formatObsDate(latestExpectationRelease) : "—"}</b></span>
              <span>Coverage: <b>{spec.title ?? "Inflation expectations"}</b></span>
            </>
          ) : (
            <>
              <span>Release date: <b>{root?.displayReleasedAt ? formatObsDate(root.displayReleasedAt) : "—"}</b></span>
              <span>Latest period: <b>{latestPeriodDate ? formatObsDate(latestPeriodDate) : "—"}</b></span>
              <span>Source: <b>{root?.meta.source?.toUpperCase() ?? "—"}</b></span>
              <span>Frequency: <b>{root?.meta.frequency ?? "—"}</b></span>
            </>
          )}
        </div>

        <div
          className="drawer-kpis"
          style={{
            flex: "0 0 auto",
            display: "grid",
            gridTemplateColumns: isExpectation
              ? "minmax(0, 1fr)"
              : cardKpis.showRight
                ? "repeat(2, minmax(0, 1fr))"
                : "minmax(0, 1fr)",
            gap: 14,
            minWidth: 0,
            padding: "16px 24px 18px",
          }}
        >
          {isExpectation ? (
            <ExpectationKpis spec={spec} allMetrics={allMetrics} />
          ) : (
            <>
              <div
                className="drawer-kpi"
                style={{
                  minWidth: 0,
                  background: "var(--panel-2, var(--panel))",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: "14px 16px",
                }}
              >
                <span>{cardKpis.leftLabel}</span>
                <strong
                  className={cardKpis.mode === "normal" ? changeColor(cardKpis.leftValue) : ""}
                  style={{ display: "block", marginTop: 4 }}
                >
                  {renderKpi(cardKpis.leftValue)}
                </strong>
              </div>

              {cardKpis.showRight && (
                <div
                  className="drawer-kpi"
                  style={{
                    minWidth: 0,
                    background: "var(--panel-2, var(--panel))",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: "14px 16px",
                  }}
                >
                  <span>{cardKpis.rightLabel}</span>
                  <strong
                    className={cardKpis.mode === "normal" ? changeColor(cardKpis.rightValue) : ""}
                    style={{ display: "block", marginTop: 4 }}
                  >
                    {renderKpi(cardKpis.rightValue)}
                  </strong>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="drawer-scroll"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            boxSizing: "border-box",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <div
  className="drawer-scroll-inner"
  style={{
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "0 24px 28px",
    overflow: "visible",
  }}
>
            <section
  className="drawer-chart"
  style={{
    width: "100%",
    minWidth: 0,
    margin: "0 0 18px",
    padding: 16,
    boxSizing: "border-box",
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    overflow: "visible",
  }}
>
              <div
                className="drawer-section-head"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0, color: "var(--text)" }}>
                  {displayMetricTitle(spec, root)}
                </h3>
                <span style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>
                  {isExpectation ? "Historical observations" : `${YEAR} trend`}
                </span>
              </div>

              <div
  className={isExpectation ? "drawer-chart-content expectation-chart-content" : "drawer-chart-content"}
  style={{
    width: "100%",
    minWidth: 0,
    overflow: "visible",
    boxSizing: "border-box",
  }}
>
  {isExpectation ? (
  <div className="expectation-chart-scroll">
    <div className="expectation-chart-content">
      <ExpectationCharts
        spec={spec}
        allMetrics={allMetrics}
      />
    </div>
  </div>
) : (
  <div className="drawer-chart-content">
    <RateChart
      spec={spec}
      root={root}
      allMetrics={allMetrics}
      height={420}
    />
  </div>
)}
</div>
</section>

            {isExpectation && expectationMetricIds.length > 0 && (
              <section className="drawer-components expectation-series-details">
                <div className="drawer-section-head">
                  <div>
                    <h3>Series data &amp; release details</h3>
                    <p>Latest readings, observation dates, frequency and official source for every series in this card.</p>
                  </div>
                  <span>{expectationPayloads.length} series</span>
                </div>
                <ExpectationComponentsTable
                  spec={spec}
                  allMetrics={allMetrics}
                  onComponentOpen={(metricId) => onComponentOpen(metricId, [])}
                />
              </section>
            )}

            {!isExpectation && root?.meta.category?.toLowerCase().includes("inflation") && allNodes.length > 0 && (
              <InflationDistribution
                nodes={allNodes}
                metrics={allMetrics}
                latestPeriod={latestPeriodDate}
              />
            )}

            {!isExpectation && allNodes.length > 0 && (
              <section
                className="drawer-components"
                style={{
                  width: "100%",
                  minWidth: 0,
                  margin: 0,
                  padding: 16,
                  boxSizing: "border-box",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: 14,
                  overflow: "hidden",
                }}
              >
                <div
                  className="drawer-section-head"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <h3 style={{ margin: 0, minWidth: 0, color: "var(--text)", overflowWrap: "anywhere" }}>
                    Components of {spec.title ?? root?.meta.shortName}
                  </h3>
                  <span style={{ whiteSpace: "nowrap", color: "var(--muted)", fontSize: 11 }}>
                    {componentLeftHeader}{componentRightHeader ? ` · ${componentRightHeader}` : ""} · {YEAR} trend
                  </span>
                </div>

                <div
                  style={{
                    width: "100%",
                    minWidth: 0,
                    overflowX: "hidden",
                    overflowY: "hidden",
                    boxSizing: "border-box",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    scrollbarGutter: "stable",
                  }}
                >
                  <div
                    className="component-table-head"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "28px minmax(0, 1fr) 52px 72px 72px minmax(48px, 80px) 30px",
                      alignItems: "center",
                      columnGap: 4,
                      minWidth: 0,
                      minHeight: 44,
                      padding: "8px 10px",
                      boxSizing: "border-box",
                      background: "var(--panel-2, var(--panel))",
                      color: "var(--muted)",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    <span></span>
                    <span>Component</span>
                    <span title="Official share of the all-items CPI/HICP basket; N/A when no direct official weight is available." style={{ textAlign: "right" }}>Weight</span>
                    <span style={{ textAlign: "right" }}>{componentLeftHeader}</span>
                    <span style={{ textAlign: "right" }}>{componentRightHeader}</span>
                    <span>Trend</span>
                    <span></span>
                  </div>

                  {allNodes.map((node) => renderNode(node))}
                </div>
                <p style={{ margin: "8px 2px 0", color: "var(--muted)", fontSize: 10, lineHeight: 1.4 }}>
                  Weight is the published share of the all-items CPI/HICP basket using the applicable 2026 official weights. N/A means a directly comparable official basket weight is not published or does not apply.
                </p>
              </section>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function CountryDashboard({
  region,
}: {
  region: string;
}) {
  const r = region.toUpperCase() as Region;
  
const [theme, setTheme] = useState<"light" | "dark">("dark");

useEffect(() => {
  const saved = window.localStorage.getItem("macrohub-theme");

  const initialTheme =
    saved === "light" ? "light" : "dark";

  setTheme(initialTheme);
  document.documentElement.dataset.theme = initialTheme;
  window.localStorage.setItem("macrohub-theme", initialTheme);
}, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";

    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("macrohub-theme", nextTheme);
  };

  const [activeCategory, setActiveCategory] =
    useState<MacroCategory | null>(null);

  const [metrics, setMetrics] = useState<
    Record<string, DetailPayload>
  >({});

  const [selected, setSelected] =
    useState<IndicatorSpec | null>(null);
    const [selectedComponent, setSelectedComponent] =
  useState<{ metricId: string; children: UiNode[] } | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState(false);
  const [recentReleaseMetricId, setRecentReleaseMetricId] = useState<string | null>(null);
  const [highlightedMetricId, setHighlightedMetricId] = useState<string | null>(null);
  const [releaseToasts, setReleaseToasts] = useState<DashboardToast[]>([]);
  const highlightTimer = useRef<number | null>(null);

  const specsByCategory = DASHBOARD[r];

  useEffect(() => {
    const onReleaseNotice = (event: Event) => {
      const notice = (event as CustomEvent<ReleaseNotice>).detail;
      if (!notice) return;
      const id = `${notice.kind}:${notice.metricId}:${notice.stage ?? "released"}:${Date.now()}`;
      setReleaseToasts((current) => [...current.slice(-2), { ...notice, id }]);
      window.setTimeout(() => {
        setReleaseToasts((current) => current.filter((toast) => toast.id !== id));
      }, notice.kind === "released" ? 9000 : 6500);

      if (notice.kind !== "released" || notice.region !== r) return;
      setRecentReleaseMetricId(notice.metricId);
      setHighlightedMetricId(notice.metricId);
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => {
        setHighlightedMetricId((current) => current === notice.metricId ? null : current);
      }, 15_000);
    };
    window.addEventListener("macrohub:release-notice", onReleaseNotice);
    return () => {
      window.removeEventListener("macrohub:release-notice", onReleaseNotice);
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    };
  }, [r]);

  useEffect(() => {
  if (!specsByCategory) return;

  let dead = false;

  async function loadDashboard(showLoading = false) {
    if (showLoading) {
      setLoading(true);
      setError("");
    }

    try {
      const res = await fetch(
        `/api/dashboard/${r}`,
        {
          cache: "no-store",
        }
      );

      if (!res.ok) {
        throw new Error("Dashboard request failed");
      }

      const payload =
        (await res.json()) as Record<
          string,
          DetailPayload
        >;

      if (dead) return;

      setMetrics(payload);
      setSavedSnapshot(res.headers.get("X-Macro-Data") === "saved-snapshot");
      setLoading(false);
      setError("");
    } catch {
      if (dead) return;

      // Do not wipe already-loaded data
      // just because a background refresh failed.
      if (showLoading) {
        setError(
          "Unable to load dashboard data."
        );
        setLoading(false);
      }
    }
  }

  // Initial load
  loadDashboard(true);

  // Background refresh every 10 seconds.
  // This allows the UI to pick up a newly
  // ingested JOLTS value automatically.
  const refreshTimer = window.setInterval(() => {
    loadDashboard(false);
  }, 10_000);

  return () => {
    dead = true;
    window.clearInterval(refreshTimer);
  };
}, [r, specsByCategory]);
  if (!specsByCategory) {
    return (
      <div className="p-10">
        Unknown country.
      </div>
    );
  }

  const countryName = REGION_LABEL[r];

  const categoryMeta: Record<
    MacroCategory,
    {
      title: string;
      description: string;
      icon: string;
      tone: string;
    }
  > = {
    prices: {
      title: "Prices & Inflation",
      description:
        "Target measures, consumer prices and cost pressures",
      icon: "▥",
      tone: "inflation-band",
    },
    activity: {
      title: "Economic Activity & Demand",
      description:
        "Output, spending and economic activity",
      icon: "▥",
      tone: "growth-band",
    },
    labour: {
      title: "Labour Market, Wages & Productivity",
      description:
        "Employment, pay, labour slack and productivity",
      icon: "●●",
      tone: "jobs-band",
    },
    monetary: {
      title: "Monetary & Financial Conditions",
      description: "Policy rates, credit, yields and financial transmission",
      icon: "◉",
      tone: "monetary-band",
    },
    expectations: {
      title: "Expectations & Outlook",
      description: "Households, businesses, forecasters and market measures",
      icon: "◌",
      tone: "expectations-band",
    },
    external: {
      title: "External, Housing & Fiscal Context",
      description: "Trade, external demand and related macro context",
      icon: "↗",
      tone: "external-band",
    },
  };

  return (
    <div className="macro-page" data-region={r.toLowerCase()}>
      <header className="macro-topbar">
        <div className="brand">
          <div className="brand-mark">
            ◎
          </div>

          <div>
            <b>MacroHub</b>
            <span>
              Global Macro Dashboard
            </span>
          </div>
        </div>

        <nav
          className="country-nav"
          aria-label="Country"
        >
          {(
            ["US", "UK", "EA"] as Region[]
          ).map((code) => (
            <a
              key={code}
              href={`/country/${code.toLowerCase()}`}
              data-country={code.toLowerCase()}
              className={clsx(
                "country-pill",
                code === r && "active"
              )}
            >
              <span>
                {REGION_FLAG[code]}
              </span>

              {code === "EA"
                ? "Euro Area"
                : code}
            </a>
          ))}
        </nav>

        <div className="year-control">
          <CalendarDays size={16} />
          <span>Year</span>
          <b>{YEAR}</b>
          <ChevronDown size={15} />
        </div>

        <button
  type="button"
  className="theme-toggle"
  onClick={toggleTheme}
  aria-label={
    theme === "dark"
      ? "Switch to light theme"
      : "Switch to dark theme"
  }
>
  <span className="theme-toggle-icon">
    {theme === "dark" ? "☀" : "☾"}
  </span>

  <span className="theme-toggle-label">
    {theme === "dark" ? "Light" : "Dark"}
  </span>
</button>

        <div className="source-note">
          <b>
            Data from official sources
          </b>

          <span>
            Last updated:{" "}
            {new Date().toLocaleDateString(
              "en-US",
              {
                month: "short",
                day: "numeric",
                year: "numeric",
              }
            )}
          </span>
        </div>
      </header>

      <div className="macro-dashboard-layout">
        <aside className="macro-calendar-sidebar">
          <EconomicCalendarSidebar />
        </aside>

        <main className="macro-content">
        <Link
          href="/"
          className="back-home"
        >
          <span aria-hidden="true">
            ←
          </span>{" "}
          Back to MacroHub home
        </Link>

        <div className="country-heading">
          <div className="country-flag">
            {REGION_FLAG[r]}
          </div>

          <div className="country-title-row">
  <div>
    <h1>{countryName}</h1>

    <p>
      Macroeconomic indicators for{" "}
      {YEAR} · all data from official
      sources
    </p>
  </div>

  <RefreshDataButton
    onComplete={() => {
      window.location.reload();
    }}
  />
</div>
        </div>

        {error && (
          <div className="macro-error">
            {error}
          </div>
        )}
        {savedSnapshot && (
          <div className="macro-error" role="status">
            Showing saved data while live updates are unavailable. Check each indicator’s date before using it.
          </div>
        )}

        {(
          [
            "prices",
            "activity",
            "labour",
            "monetary",
            "expectations",
            "external",
          ] as MacroCategory[]
        ).map((category) => {
          const meta =
            categoryMeta[category];

          const allSpecs = specsByCategory[category];

const specs =
  category === "prices"
    ? r === "US"
      ? allSpecs.filter((spec) =>
          US_INFLATION_PRIMARY_IDS.has(spec.id)
        )
      : allSpecs.filter((spec) => {
          // Remove Inflation Expectations from the main
          // inflation cards for UK and Euro Area.
          if (
            metrics[spec.metricId]?.meta.subcategory?.startsWith(
              "expectations_"
            )
          ) {
            return false;
          }

          // UK frontend-only exclusions.
          if (
            r === "UK" &&
            isUkInflationHiddenSpec(spec)
          ) {
            return false;
          }

          return true;
        })
    : allSpecs;

          const orderedSpecs = recentReleaseMetricId
            ? [...specs].sort((a, b) =>
                Number(specContainsMetric(b, recentReleaseMetricId)) -
                Number(specContainsMetric(a, recentReleaseMetricId))
              )
            : specs;

          // Keep the full taxonomy in the configuration, but do not render
          // empty sections where this project has no existing metric cards.
          if (orderedSpecs.length === 0) return null;

          return (
            <section
              key={category}
              className={clsx(
                "macro-band",
                meta.tone
              )}
            >
              <div className="band-label">
                <div className="band-icon">
                  {meta.icon}
                </div>

                <h2>{meta.title}</h2>

                <p>
                  {meta.description}
                </p>

                <strong>
                  {orderedSpecs.length}
                </strong>

                <span>indicators</span>
              </div>

              <div className="macro-band-content">
  <div
    className="cards-grid"
    style={{
      gridTemplateColumns:
        orderedSpecs.length <= 4
          ? `repeat(${orderedSpecs.length}, minmax(240px, 1fr))`
          : `repeat(auto-fill, minmax(260px, 1fr))`,
      gap: "12px",
    }}
  >
    {orderedSpecs.map((spec) => (
      <IndicatorCard
        key={spec.id}
        spec={spec}
        metric={
          metrics[spec.metricId]
        }
        componentMetrics={metrics}
        groupLabel={meta.title}
        highlighted={highlightedMetricId != null && specContainsMetric(spec, highlightedMetricId)}
        onOpen={() =>
          setSelected(spec)
        }
      />
    ))}
  </div>

</div>
            </section>
          );
        })}
        {loading && (
          <div className="loading-strip">
            Loading current data from the
            existing API…
          </div>
        )}
        </main>
      </div>

      {releaseToasts.length > 0 && (
        <div className="release-notification-stack" aria-live="polite" aria-atomic="false">
          {releaseToasts.map((toast) => {
            const label = toast.region === "EA" ? "Euro Area" : toast.region;
            const actualMetric = metrics[toast.metricId];
            const actualValue = toast.actual == null
              ? "—"
              : actualMetric
                ? formatMetricValue(toast.actual, actualMetric)
                : new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(toast.actual);
            return (
              <div key={toast.id} className={`release-notification ${toast.kind}`} role="status">
                <span className="release-notification-mark" aria-hidden="true">{toast.kind === "released" ? "✓" : "◷"}</span>
                <div>
                  <strong>{toast.kind === "released" ? "Data released and updated" : "Release approaching"}</strong>
                  <p>
                    {toast.kind === "released"
                      ? <>{toast.metricName} · {label} — new value <b>{actualValue}</b></>
                      : <>{toast.metricName} · {label} is due {toast.stage === "2m" ? "in about 2 minutes" : (toast.secondsRemaining ?? 60) > 30 ? "in about 1 minute" : `in ${toast.secondsRemaining ?? 1} seconds`}</>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="macro-footer">
        <span>
          ◉ MacroHub · Bringing together
          official data from BLS, BEA, ONS,
          Eurostat and other trusted sources.
        </span>

        <span>
          All charts show {YEAR} only · no
          index levels displayed
        </span>
      </footer>

      {selected && (
  <DetailDrawer
  region={r}
  spec={selected}
  root={
    metrics[
      selected.metricId
    ]
  }
  allMetrics={metrics}
  onClose={() =>
    setSelected(null)
  }
  onComponentOpen={(metricId, children = []) =>
    setSelectedComponent({ metricId, children })
  }
/>
)}
{selectedComponent && (
  <ComponentDetailDrawer
    region={r}
    metricId={selectedComponent.metricId}
    components={selectedComponent.children}
    allMetrics={metrics}
    onClose={() =>
      setSelectedComponent(null)
    }
  />
)}
    </div>
  );
}
