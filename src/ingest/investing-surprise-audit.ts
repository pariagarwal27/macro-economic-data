import fs from "fs";
import path from "path";
import { getClient } from "@/db";
import {
  SURPRISE_AUDIT_DEFAULTS,
  SURPRISE_CANDIDATES,
  type SurpriseMetricRule,
  type SurpriseVerdict,
} from "@/catalog/surprise-allowlist";

export type RowFlag =
  | "ok"
  | "missing_obs"
  | "missing_expected"
  | "unit_mismatch_suspect"
  | "definition_mismatch"
  | "large_diff";

export interface AuditRow {
  metricId: string;
  periodDate: string;
  releasedAt: string;
  eventName: string | null;
  invActual: number;
  invExpected: number | null;
  invPrevious: number | null;
  surprise: number | null;
  obsValue: number | null;
  invScaled: number;
  invMinusObs: number | null;
  invScaledMinusObs: number | null;
  flag: RowFlag;
}

export interface MetricAuditSummary {
  metricId: string;
  rule: SurpriseMetricRule;
  rows: number;
  withObs: number;
  withExpected: number;
  ok: number;
  unitMismatchSuspect: number;
  definitionMismatch: number;
  largeDiff: number;
  missingObs: number;
  missingExpected: number;
  medianAbsDiffScaled: number | null;
  verdict: SurpriseVerdict;
  verdictReason: string;
}

export interface SurpriseAuditReport {
  generatedAt: string;
  since: string;
  note: string;
  candidates: string[];
  metrics: MetricAuditSummary[];
  rows: AuditRow[];
  allowlistSuggested: string[];
  reviewSuggested: string[];
  denylistSuggested: string[];
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function classifyRow(
  rule: SurpriseMetricRule,
  invActual: number,
  obs: number | null,
  expected: number | null
): { flag: RowFlag; invScaled: number; invMinusObs: number | null; invScaledMinusObs: number | null } {
  const scale = rule.investingScale ?? 1;
  const invScaled = invActual * scale;
  if (obs == null || !Number.isFinite(obs)) {
    return { flag: "missing_obs", invScaled, invMinusObs: null, invScaledMinusObs: null };
  }
  const invMinusObs = invActual - obs;
  const invScaledMinusObs = invScaled - obs;
  const absRaw = Math.abs(invMinusObs);
  const absScaled = Math.abs(invScaledMinusObs);

  // Index vs % style: raw huge but not fixed by our known scale
  if (absRaw > 20 && absScaled > rule.maxAbsDiff * 3) {
    return { flag: "definition_mismatch", invScaled, invMinusObs, invScaledMinusObs };
  }
  // Known investingScale already applied — treat as aligned when scaled fits.
  if (absScaled <= rule.maxAbsDiff) {
    if (expected == null) {
      return { flag: "missing_expected", invScaled, invMinusObs, invScaledMinusObs };
    }
    return { flag: "ok", invScaled, invMinusObs, invScaledMinusObs };
  }
  // Unexpected scale: raw far off but ÷1000-ish would fit and rule has no scale
  if (!rule.investingScale && absRaw > rule.maxAbsDiff && absRaw / 1000 <= rule.maxAbsDiff) {
    return { flag: "unit_mismatch_suspect", invScaled, invMinusObs, invScaledMinusObs };
  }
  if (absScaled > rule.maxAbsDiff * 5) {
    return { flag: "definition_mismatch", invScaled, invMinusObs, invScaledMinusObs };
  }
  return { flag: "large_diff", invScaled, invMinusObs, invScaledMinusObs };
}

function verdictFor(summary: Omit<MetricAuditSummary, "verdict" | "verdictReason">): {
  verdict: SurpriseVerdict;
  verdictReason: string;
} {
  if (summary.withObs === 0) {
    return { verdict: "review", verdictReason: "no overlapping official observations in window" };
  }
  const defRate = summary.definitionMismatch / summary.withObs;
  const okRate = summary.ok / Math.max(summary.withObs, 1);
  if (defRate >= 0.4) {
    return { verdict: "deny", verdictReason: `definition mismatch on ${(defRate * 100).toFixed(0)}% of joined rows` };
  }
  if (summary.unitMismatchSuspect / summary.withObs >= 0.5) {
    return {
      verdict: "review",
      verdictReason: "Investing values look scaled (e.g. 139K vs FRED thousands) — apply investingScale in UI layer only",
    };
  }
  if (okRate >= 0.7 && summary.definitionMismatch === 0) {
    return { verdict: "allow", verdictReason: `aligned on ${(okRate * 100).toFixed(0)}% of joined rows (within maxAbsDiff)` };
  }
  if (okRate >= 0.4) {
    return { verdict: "review", verdictReason: `partial alignment (${(okRate * 100).toFixed(0)}% ok)` };
  }
  return { verdict: "deny", verdictReason: `poor alignment (${(okRate * 100).toFixed(0)}% ok)` };
}

/** Read-only audit. Does not mutate calendar_events, releases, or month JSON dumps. */
export async function runSurpriseAudit(opts?: { since?: string }): Promise<SurpriseAuditReport> {
  const since = opts?.since ?? SURPRISE_AUDIT_DEFAULTS.since;
  const client = getClient();
  const candidateIds = SURPRISE_CANDIDATES.map((c) => c.metricId);
  const placeholders = candidateIds.map(() => "?").join(",");

  // Prefer raw calendar_events (intact Investing print) joined to catalog mapping + official tip.
  const result = await client.execute({
    sql: `SELECT
            ce.metric_id AS metric_id,
            ce.period_date AS period_date,
            ce.released_at AS released_at,
            ce.event_name AS event_name,
            ce.actual AS inv_actual,
            ce.forecast AS inv_expected,
            ce.previous AS inv_previous,
            o.value AS obs_value
          FROM calendar_events ce
          LEFT JOIN observations o
            ON o.metric_id = ce.metric_id
           AND o.date = ce.period_date
           AND o.is_latest = 1
          WHERE ce.source = 'investing'
            AND ce.metric_id IN (${placeholders})
            AND ce.actual IS NOT NULL
            AND ce.released_at >= ?
            AND ce.period_date IS NOT NULL
          ORDER BY ce.metric_id, ce.released_at DESC`,
    args: [...candidateIds, since],
  });

  const rows: AuditRow[] = [];
  const byMetric = new Map<string, AuditRow[]>();

  for (const r of result.rows) {
    const metricId = String(r.metric_id);
    const rule = SURPRISE_CANDIDATES.find((c) => c.metricId === metricId);
    if (!rule) continue;
    const invActual = Number(r.inv_actual);
    const invExpected = r.inv_expected == null ? null : Number(r.inv_expected);
    const obsValue = r.obs_value == null ? null : Number(r.obs_value);
    const classified = classifyRow(rule, invActual, obsValue, invExpected);
    const surprise =
      invExpected != null && Number.isFinite(invExpected) ? invActual - invExpected : null;

    const row: AuditRow = {
      metricId,
      periodDate: String(r.period_date),
      releasedAt: String(r.released_at),
      eventName: r.event_name == null ? null : String(r.event_name),
      invActual,
      invExpected,
      invPrevious: r.inv_previous == null ? null : Number(r.inv_previous),
      surprise,
      obsValue,
      invScaled: classified.invScaled,
      invMinusObs: classified.invMinusObs,
      invScaledMinusObs: classified.invScaledMinusObs,
      flag: classified.flag,
    };
    rows.push(row);
    const list = byMetric.get(metricId) ?? [];
    list.push(row);
    byMetric.set(metricId, list);
  }

  const metrics: MetricAuditSummary[] = SURPRISE_CANDIDATES.map((rule) => {
    const list = byMetric.get(rule.metricId) ?? [];
    const withObs = list.filter((x) => x.obsValue != null);
    const absDiffs = withObs
      .map((x) => (x.invScaledMinusObs == null ? null : Math.abs(x.invScaledMinusObs)))
      .filter((x): x is number => x != null);
    const base = {
      metricId: rule.metricId,
      rule,
      rows: list.length,
      withObs: withObs.length,
      withExpected: list.filter((x) => x.invExpected != null).length,
      ok: list.filter((x) => x.flag === "ok").length,
      unitMismatchSuspect: list.filter((x) => x.flag === "unit_mismatch_suspect").length,
      definitionMismatch: list.filter((x) => x.flag === "definition_mismatch").length,
      largeDiff: list.filter((x) => x.flag === "large_diff").length,
      missingObs: list.filter((x) => x.flag === "missing_obs").length,
      missingExpected: list.filter((x) => x.flag === "missing_expected").length,
      medianAbsDiffScaled: median(absDiffs),
    };
    const { verdict, verdictReason } = verdictFor(base);
    return { ...base, verdict, verdictReason };
  });

  return {
    generatedAt: new Date().toISOString(),
    since,
    note:
      "Read-only QA. Raw Investing dumps (data/investing/YYYY-MM.json) and calendar_events are not modified. Use allowlistSuggested for surprise UI later.",
    candidates: candidateIds,
    metrics,
    rows,
    allowlistSuggested: metrics.filter((m) => m.verdict === "allow").map((m) => m.metricId),
    reviewSuggested: metrics.filter((m) => m.verdict === "review").map((m) => m.metricId),
    denylistSuggested: metrics.filter((m) => m.verdict === "deny").map((m) => m.metricId),
  };
}

export function writeSurpriseAuditArtifacts(report: SurpriseAuditReport, outDirRel?: string): {
  jsonPath: string;
  mdPath: string;
  allowlistPath: string;
} {
  const outDir = path.join(process.cwd(), outDirRel ?? SURPRISE_AUDIT_DEFAULTS.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = report.generatedAt.slice(0, 10);
  const jsonPath = path.join(outDir, `audit-${stamp}.json`);
  const mdPath = path.join(outDir, `audit-${stamp}.md`);
  const allowlistPath = path.join(outDir, "allowlist.suggested.json");
  const latestJson = path.join(outDir, "audit-latest.json");
  const latestMd = path.join(outDir, "audit-latest.md");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2));

  const allowlistDoc = {
    generatedAt: report.generatedAt,
    since: report.since,
    source: "derived from read-only audit — does not alter Investing dumps",
    allow: report.allowlistSuggested,
    review: report.reviewSuggested,
    deny: report.denylistSuggested,
    scales: Object.fromEntries(
      SURPRISE_CANDIDATES.filter((c) => c.investingScale != null).map((c) => [
        c.metricId,
        c.investingScale,
      ])
    ),
  };
  fs.writeFileSync(allowlistPath, JSON.stringify(allowlistDoc, null, 2));

  const md = renderMarkdown(report);
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(latestMd, md);

  return { jsonPath, mdPath, allowlistPath };
}

function renderMarkdown(report: SurpriseAuditReport): string {
  const lines: string[] = [];
  lines.push(`# Investing ↔ official series audit`);
  lines.push("");
  lines.push(`Generated: \`${report.generatedAt}\` · Window since \`${report.since}\``);
  lines.push("");
  lines.push(report.note);
  lines.push("");
  lines.push(`## Suggested buckets`);
  lines.push("");
  lines.push(`- **allow:** ${report.allowlistSuggested.join(", ") || "—"}`);
  lines.push(`- **review:** ${report.reviewSuggested.join(", ") || "—"}`);
  lines.push(`- **deny:** ${report.denylistSuggested.join(", ") || "—"}`);
  lines.push("");
  lines.push(`## Per-metric`);
  lines.push("");
  lines.push(`| Metric | Rows | w/ obs | ok | unit? | def mismatch | median |Δ| | Verdict | Reason |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---|---|`);
  for (const m of report.metrics) {
    lines.push(
      `| ${m.metricId} | ${m.rows} | ${m.withObs} | ${m.ok} | ${m.unitMismatchSuspect} | ${m.definitionMismatch} | ${m.medianAbsDiffScaled ?? "—"} | **${m.verdict}** | ${m.verdictReason} |`
    );
  }
  lines.push("");
  lines.push(`## Example anomalies (definition / large diff)`);
  lines.push("");
  const bad = report.rows
    .filter((r) => r.flag === "definition_mismatch" || r.flag === "large_diff")
    .slice(0, 40);
  if (!bad.length) {
    lines.push("_None in candidate set._");
  } else {
    lines.push(`| Metric | Period | Event | Inv | Obs | Flag |`);
    lines.push(`|---|---|---|---:|---:|---|`);
    for (const r of bad) {
      lines.push(
        `| ${r.metricId} | ${r.periodDate} | ${(r.eventName ?? "").replace(/\|/g, "/")} | ${r.invActual} | ${r.obsValue ?? "—"} | ${r.flag} |`
      );
    }
  }
  lines.push("");
  lines.push(`## Storage`);
  lines.push("");
  lines.push(`- Raw dumps (intact): \`data/investing/YYYY-MM.json\``);
  lines.push(`- DB raw store (intact): \`calendar_events\``);
  lines.push(`- This audit only: \`data/investing/surprise/\``);
  lines.push("");
  return lines.join("\n");
}
