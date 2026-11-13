import modelJson from "../../nfp_model/results/nfp-cloudflare-model.json";
import { forecastForNfpReleaseDate } from "./nfp-forecast";

type ModelNode = {
  split_feature?: number;
  threshold?: number | string;
  decision_type?: string;
  left_child?: ModelNode;
  right_child?: ModelNode;
  leaf_value?: number;
};

type NfpModel = {
  model: string;
  model_status: string;
  selected_features: string[];
  surprise_multiplier: number;
  initial_score: number;
  medians: Array<number | null>;
  scale_mean: number[];
  scale_scale: number[];
  trees: Array<{ tree_structure: ModelNode }>;
  probe: { values: Record<string, number>; prediction: number };
};

export type NfpModelRelease = {
  metricId: string;
  periodDate: string;
  releasedAt: string;
  value: number;
  expectedValue?: number | null;
};

export type NfpCalendarEvent = {
  metricId?: string | null;
  source?: string | null;
  releasedAt: string;
  forecast: number | null;
  importedAt?: string | null;
};

export type NfpForecastSnapshot = {
  targetMonth: string;
  releaseAt: string;
  asOf: string;
  status: "awaiting-consensus" | "experimental";
  model: string;
  modelStatus: string;
  consensus: number | null;
  predictedSurprise: number;
  forecast: number | null;
  featureCount: number;
  featureTotal: number;
  inputs: Record<string, number | null>;
  sourceReleaseCount: number;
};

const MODEL = modelJson as NfpModel;
const SURPRISE_WEIGHT = 1.0;

function walkTree(node: ModelNode, values: number[]): number {
  if (node.leaf_value != null) return node.leaf_value;
  const feature = node.split_feature;
  const threshold = Number(node.threshold);
  if (feature == null || !Number.isFinite(threshold) || !node.left_child || !node.right_child) return 0;
  const left = node.decision_type?.includes("<=") ?? true;
  const goesLeft = left ? values[feature] <= threshold : values[feature] > threshold;
  return walkTree(goesLeft ? node.left_child : node.right_child, values);
}

export function predictNfpSurprise(values: Readonly<Record<string, number | null | undefined>>) {
  const featureCount = MODEL.selected_features.length;
  const provided = MODEL.selected_features.map(feature => {
    const value = values[feature];
    return value != null && Number.isFinite(value) ? value : null;
  });
  const covered = provided.filter(value => value != null).length;
  const transformed = [
    ...provided.map((value, index) => value ?? MODEL.medians[index] ?? 0),
    ...provided.map(value => value == null ? 1 : 0),
  ].map((value, index) => (value - MODEL.scale_mean[index]) / (MODEL.scale_scale[index] || 1));

  const prediction = MODEL.initial_score + MODEL.trees.reduce(
    (total, tree) => total + walkTree(tree.tree_structure, transformed),
    0,
  );
  return { prediction, featureCount: covered, featureTotal: featureCount };
}

function month(date: string) {
  const match = date.slice(0, 10).match(/^(\d{4})-(\d{2})/);
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${match[1]}-${match[2]}` : null;
}

function monthOffset(period: string, offset: number) {
  const [year, monthNumber] = period.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function nfpTargetMonthFromRelease(releaseAt: string) {
  const releaseMonth = month(releaseAt);
  return releaseMonth ? monthOffset(releaseMonth, -1) : null;
}

export function isNfpForecastWindow(releaseAt: string, now = new Date(), leadDays = 7) {
  const releaseTime = Date.parse(releaseAt);
  const millisecondsUntilRelease = releaseTime - now.getTime();
  return Number.isFinite(releaseTime)
    && millisecondsUntilRelease >= 0
    && millisecondsUntilRelease <= leadDays * 86_400_000;
}

function validReleases(releases: readonly NfpModelRelease[]) {
  return releases.flatMap(release => {
    const period = month(release.periodDate);
    const timestamp = Date.parse(release.releasedAt);
    return period && Number.isFinite(timestamp) && Number.isFinite(release.value) ? [{ ...release, period }] : [];
  });
}

function releaseForMonth(releases: readonly (NfpModelRelease & { period: string })[], period: string, first = false) {
  return releases.filter(row => row.period === period)
    .sort((left, right) => Date.parse(left.releasedAt) - Date.parse(right.releasedAt))[first ? 0 : -1];
}

function seriesRows(releases: readonly (NfpModelRelease & { period: string })[], metricId: string) {
  return releases.filter(row => row.metricId === metricId);
}

function mean(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null;
}

function setFeature(features: Record<string, number | null>, key: string, value: number | null | undefined) {
  features[key] = value == null || !Number.isFinite(value) ? null : value;
}

function consensusFromEvents(events: readonly NfpCalendarEvent[], releaseAt: string, metricId: string) {
  const releaseTimestamp = Date.parse(releaseAt);
  const matches = events.filter(event => event.metricId === metricId
    && event.forecast != null && Number.isFinite(event.forecast)
    && Date.parse(event.releasedAt) <= releaseTimestamp
    && (metricId === "us-nfp"
      ? event.releasedAt.slice(0, 10) === releaseAt.slice(0, 10)
      : releaseTimestamp - Date.parse(event.releasedAt) <= 7 * 86_400_000)
    && (!event.source || event.source === "investing"));
  const selected = matches.sort((left, right) => Date.parse(right.importedAt ?? "") - Date.parse(left.importedAt ?? ""))[0];
  return selected?.forecast == null ? null : Number((selected.forecast / 1_000).toFixed(3));
}

function buildFeatureValues(
  targetMonth: string,
  releaseAt: string,
  releasesInput: readonly NfpModelRelease[],
  calendarEvents: readonly NfpCalendarEvent[],
) {
  const rows = validReleases(releasesInput).filter(row => Date.parse(row.releasedAt) <= Date.parse(releaseAt));
  const features: Record<string, number | null> = Object.fromEntries(MODEL.selected_features.map(name => [name, null]));
  const nfp = seriesRows(rows, "us-nfp");
  const previousPeriods = [-1, -2, -3].map(offset => monthOffset(targetMonth, offset));
  const nfpFirst = previousPeriods.map(period => releaseForMonth(nfp, period, true));
  const previousNfp = nfpFirst.map(release => release?.value ?? null);
  setFeature(features, "previous_nfp", previousNfp[0]);
  setFeature(features, "nfp_2_months_ago", previousNfp[1]);
  setFeature(features, "nfp_3_months_ago", previousNfp[2]);
  setFeature(features, "average_previous_3_months", mean(previousNfp));

  const surpriseHistory = [...nfp].sort((left, right) => left.period.localeCompare(right.period))
    .map(release => {
      const expected = release.expectedValue ?? consensusFromEvents(calendarEvents, release.releasedAt, "us-nfp");
      return expected == null ? null : release.value - expected;
    });
  const previousSurprises = previousPeriods.map(period => {
    const release = releaseForMonth(nfp, period, true);
    if (!release) return null;
    const expected = release.expectedValue ?? consensusFromEvents(calendarEvents, release.releasedAt, "us-nfp");
    return expected == null ? null : release.value - expected;
  });
  const previousConsensus = nfpFirst[0]?.expectedValue
    ?? (nfpFirst[0] ? consensusFromEvents(calendarEvents, nfpFirst[0].releasedAt, "us-nfp") : null);
  setFeature(features, "previous_consensus", previousConsensus);
  setFeature(features, "previous_surprise", previousSurprises[0]);
  setFeature(features, "surprise_lag_1", previousSurprises[0]);
  const lastThree = previousSurprises.every(value => value != null) ? mean(previousSurprises) : null;
  const trailing = surpriseHistory.slice(-36).filter((value): value is number => value != null);
  const deviation = trailing.length > 1
    ? Math.sqrt(trailing.reduce((sum, value) => sum + (value - trailing.reduce((a, b) => a + b, 0) / trailing.length) ** 2, 0) / (trailing.length - 1))
    : null;
  setFeature(features, "surprise_index_3m", lastThree == null || deviation == null || deviation === 0 ? null : lastThree / deviation);
  setFeature(features, "regime_payroll_mean3", mean(previousNfp));
  setFeature(features, "regime_payroll_momentum", previousNfp[0] == null || mean(previousNfp) == null ? null : previousNfp[0] - mean(previousNfp)!);

  const adp = seriesRows(rows, "us-adp-change");
  const adpPeriods = [targetMonth, ...previousPeriods];
  const adpReleases = adpPeriods.map(period => releaseForMonth(adp, period));
  const adpValues = adpReleases.map(release => release?.value ?? null);
  setFeature(features, "adp_current_change", adpValues[0]);
  setFeature(features, "adp_previous_change", adpValues[1]);
  setFeature(features, "adp_2_months_ago", adpValues[2]);
  setFeature(features, "adp_change_from_previous", adpValues[0] == null || adpValues[1] == null ? null : adpValues[0] - adpValues[1]);
  setFeature(features, "adp_average_last_3_months", mean(adpValues.slice(0, 3)));
  const adpConsensus = adpReleases[0]?.expectedValue
    ?? consensusFromEvents(calendarEvents, releaseAt, "us-adp-change");
  setFeature(features, "adp_current_consensus", adpConsensus);
  setFeature(features, "adp_current_surprise", adpValues[0] == null || adpConsensus == null ? null : adpValues[0] - adpConsensus);
  setFeature(features, "previous_adp_bls_gap", adpValues[1] == null || previousNfp[0] == null ? null : adpValues[1] - previousNfp[0]);

  const claims = (metricId: string, prefix: "initial" | "continuing") => {
    const byWeek = new Map<string, NfpModelRelease & { period: string }>();
    for (const row of seriesRows(rows, metricId)) {
      const existing = byWeek.get(row.periodDate);
      if (!existing || Date.parse(row.releasedAt) > Date.parse(existing.releasedAt)) byWeek.set(row.periodDate, row);
    }
    const weekly = [...byWeek.values()].sort((left, right) => left.periodDate.localeCompare(right.periodDate));
    const latest = weekly.at(-1);
    const previous = weekly.at(-2);
    // The forecast training data stores claims in thousands; the dashboard
    // source series stores headcounts.
    const toThousands = (value: number) => value / 1_000;
    const latestFour = weekly.slice(-4).map(row => toThousands(row.value));
    const priorFour = weekly.slice(-8, -4).map(row => toThousands(row.value));
    const currentMonth = weekly.filter(row => row.period === targetMonth).map(row => toThousands(row.value));
    const priorMonth = weekly.filter(row => row.period === monthOffset(targetMonth, -1)).map(row => toThousands(row.value));
    setFeature(features, `${prefix}_claims_latest`, latest ? toThousands(latest.value) : null);
    setFeature(features, `${prefix}_claims_prev_week`, previous ? toThousands(previous.value) : null);
    setFeature(features, `${prefix}_claims_weekly_change`, latest && previous ? toThousands(latest.value - previous.value) : null);
    setFeature(features, `${prefix}_claims_4week_avg`, mean(latestFour));
    setFeature(features, `${prefix}_claims_4week_change`, latestFour.length === 4 && priorFour.length === 4 ? mean(latestFour)! - mean(priorFour)! : null);
    setFeature(features, `${prefix}_claims_month_avg`, mean(currentMonth));
    setFeature(features, `${prefix}_claims_prev_month_avg`, mean(priorMonth));
    setFeature(features, `${prefix}_claims_month_avg_change`, currentMonth.length && priorMonth.length ? mean(currentMonth)! - mean(priorMonth)! : null);
    setFeature(features, `${prefix}_claims_reference_week`, latest?.value);
    return features[`${prefix}_claims_4week_change`];
  };
  const initialPressure = claims("us-initial-claims", "initial");
  const continuingPressure = claims("us-continuing-claims", "continuing");
  const initialAverage = features.initial_claims_4week_avg;
  setFeature(features, "regime_initial_claims_pressure", initialPressure == null || initialAverage == null || initialAverage === 0 ? null : initialPressure / initialAverage);
  setFeature(features, "regime_claims_both_rising", initialPressure == null || continuingPressure == null ? null : Number(initialPressure > 0 && continuingPressure > 0));

  const joltsPeriods = ["us-jolts-openings", "us-jolts-hires", "us-jolts-hires-level", "us-jolts-quits", "us-jolts-quits-level", "us-jolts-layoffs", "us-jolts-layoffs-level", "us-jolts-total-separations-rate", "us-jolts-total-separations", "us-payrolls-level"]
    .map(metricId => [metricId, seriesRows(rows, metricId)] as const);
  const joltsAt = (metricId: string) => joltsPeriods.find(([id]) => id === metricId)?.[1] ?? [];
  const availableJoltsMonths = joltsAt("us-jolts-openings").filter(row => row.period < targetMonth).map(row => row.period).sort();
  const joltsMonth = availableJoltsMonths.at(-1);
  const previousJoltsMonth = joltsMonth ? monthOffset(joltsMonth, -1) : null;
  const opening = joltsMonth ? releaseForMonth(joltsAt("us-jolts-openings"), joltsMonth) : undefined;
  const previousOpening = previousJoltsMonth ? releaseForMonth(joltsAt("us-jolts-openings"), previousJoltsMonth) : undefined;
  const employmentAt = (period: string | null) => period ? releaseForMonth(joltsAt("us-payrolls-level"), period)?.value ?? null : null;
  const levelForRate = (metricId: string, levelMetricId: string, period: string | null) => {
    if (!period) return null;
    const direct = releaseForMonth(joltsAt(levelMetricId), period)?.value;
    if (direct != null) return direct;
    const rate = releaseForMonth(joltsAt(metricId), period)?.value;
    const payrollLevel = employmentAt(period);
    return rate == null || payrollLevel == null ? null : rate * payrollLevel / 100;
  };
  const hires = levelForRate("us-jolts-hires", "us-jolts-hires-level", joltsMonth ?? null);
  const priorHires = levelForRate("us-jolts-hires", "us-jolts-hires-level", previousJoltsMonth);
  const quits = levelForRate("us-jolts-quits", "us-jolts-quits-level", joltsMonth ?? null);
  const layoffs = levelForRate("us-jolts-layoffs", "us-jolts-layoffs-level", joltsMonth ?? null);
  const separationsDirect = releaseForMonth(joltsAt("us-jolts-total-separations"), joltsMonth ?? "")?.value;
  const separationRate = releaseForMonth(joltsAt("us-jolts-total-separations-rate"), joltsMonth ?? "")?.value;
  const separations = separationsDirect ?? (separationRate != null && employmentAt(joltsMonth ?? null) != null ? separationRate * employmentAt(joltsMonth ?? null)! / 100 : null);
  setFeature(features, "jolts_openings_latest", opening?.value);
  setFeature(features, "jolts_openings_previous", previousOpening?.value);
  setFeature(features, "jolts_openings_change", opening && previousOpening ? opening.value - previousOpening.value : null);
  setFeature(features, "jolts_hires_latest", hires);
  setFeature(features, "jolts_hires_change", hires == null || priorHires == null ? null : hires - priorHires);
  setFeature(features, "jolts_net_hires", hires == null || separations == null ? null : hires - separations);
  setFeature(features, "jolts_separations_latest", separations);
  setFeature(features, "jolts_quits_latest", quits);
  setFeature(features, "jolts_layoffs_latest", layoffs);
  setFeature(features, "jolts_openings_rate", null);
  for (const [feature, metricId] of [["jolts_hires_rate", "us-jolts-hires"], ["jolts_quits_rate", "us-jolts-quits"], ["jolts_layoffs_rate", "us-jolts-layoffs"]] as const) {
    setFeature(features, feature, joltsMonth ? releaseForMonth(joltsAt(metricId), joltsMonth)?.value : null);
  }

  const tempHelp = seriesRows(rows, "us-temp-help").filter(row => row.period < targetMonth).sort((left, right) => left.period.localeCompare(right.period));
  const tempLatest = tempHelp.at(-1);
  const tempPrevious = tempHelp.at(-2);
  setFeature(features, "ces_temp_help_employment_latest", tempLatest?.value);
  setFeature(features, "ces_temp_help_employment_previous", tempPrevious?.value);
  setFeature(features, "ces_temp_help_employment_change", tempLatest && tempPrevious ? tempLatest.value - tempPrevious.value : null);
  setFeature(features, "ces_temp_help_employment_3m_avg", mean(tempHelp.slice(-3).map(row => row.value)));

  const privateEmployment = seriesRows(rows, "us-private-payrolls").sort((left, right) => left.period.localeCompare(right.period));
  const weeklyHours = seriesRows(rows, "us-avg-workweek").sort((left, right) => left.period.localeCompare(right.period));
  const aggregateChanges = privateEmployment.flatMap(employment => {
    const hours = releaseForMonth(weeklyHours, employment.period);
    const previousEmployment = releaseForMonth(privateEmployment, monthOffset(employment.period, -1));
    const previousHours = releaseForMonth(weeklyHours, monthOffset(employment.period, -1));
    if (!hours || !previousEmployment || !previousHours) return [];
    const previous = previousEmployment.value * previousHours.value;
    return previous === 0 ? [] : [{ period: employment.period, change: (employment.value * hours.value / previous - 1) * 100 }];
  });
  const hoursValues = aggregateChanges.filter(row => row.period < targetMonth);
  const latestHours = hoursValues.at(-1)?.change ?? null;
  const previousHours = hoursValues.at(-2)?.change ?? null;
  setFeature(features, "ces_aggregate_weekly_hours_change_latest", latestHours);
  setFeature(features, "ces_aggregate_weekly_hours_change_previous", previousHours);
  setFeature(features, "ces_aggregate_weekly_hours_change_from_previous", latestHours == null || previousHours == null ? null : latestHours - previousHours);
  setFeature(features, "ces_aggregate_weekly_hours_change_3m_avg", mean(hoursValues.slice(-3).map(row => row.change)));

  const setIsmEmploymentFeatures = (metricId: string, prefix: "ism_mfg" | "ism_services") => {
    const history = seriesRows(rows, metricId)
      .filter(row => row.period <= targetMonth)
      .sort((left, right) => left.period.localeCompare(right.period));
    const latest = history.at(-1);
    const previous = history.at(-2);
    setFeature(features, `${prefix}_employment_latest`, latest?.value);
    setFeature(features, `${prefix}_employment_previous`, previous?.value);
    setFeature(features, `${prefix}_employment_change`, latest && previous ? latest.value - previous.value : null);
    setFeature(features, `${prefix}_employment_3m_avg`, mean(history.slice(-3).map(row => row.value)));
  };
  setIsmEmploymentFeatures("us-ism-manufacturing-employment", "ism_mfg");
  setIsmEmploymentFeatures("us-ism-services-employment", "ism_services");

  const modelReleaseAt = nfpReleaseDateForTarget(targetMonth, releaseAt);
  setFeature(features, "current_consensus", consensusFromEvents(calendarEvents, modelReleaseAt, "us-nfp"));
  setFeature(features, "ism_mfg_pmi_latest", latestMetricValue(rows, "us-ism-manufacturing-pmi", releaseAt));
  setFeature(features, "ism_services_pmi_latest", latestMetricValue(rows, "us-ism-services-pmi", releaseAt));
  return features;
}

function nfpReleaseDateForTarget(targetMonth: string, fallback: string) {
  const nextMonth = monthOffset(targetMonth, 1);
  // The next event's date/time is authoritative; fallback only filters data already released.
  return fallback || `${nextMonth}-01T23:59:59.999Z`;
}

function latestMetricValue(releases: readonly (NfpModelRelease & { period: string })[], metricId: string, before: string) {
  return releases.filter(row => row.metricId === metricId && Date.parse(row.releasedAt) <= Date.parse(before))
    .sort((left, right) => Date.parse(right.releasedAt) - Date.parse(left.releasedAt))[0]?.value ?? null;
}

export function forecastNfpForRelease(input: {
  targetMonth: string;
  releaseAt: string;
  asOf: string;
  releases: readonly NfpModelRelease[];
  calendarEvents: readonly NfpCalendarEvent[];
}): NfpForecastSnapshot {
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) throw new Error("Invalid forecast timestamp");
  const eligibleReleases = input.releases.filter(row => Date.parse(row.releasedAt) <= asOf);
  const eligibleEvents = input.calendarEvents.filter(row => !row.importedAt || Date.parse(row.importedAt) <= asOf);
  const inputs = buildFeatureValues(input.targetMonth, input.releaseAt, eligibleReleases, eligibleEvents);
  const result = predictNfpSurprise(inputs);
  const consensus = inputs.current_consensus;
  return {
    targetMonth: input.targetMonth,
    releaseAt: input.releaseAt,
    asOf: input.asOf,
    status: consensus == null ? "awaiting-consensus" : "experimental",
    model: MODEL.model,
    modelStatus: MODEL.model_status,
    consensus,
    predictedSurprise: result.prediction * SURPRISE_WEIGHT,
    forecast: consensus == null ? null : consensus + result.prediction * SURPRISE_WEIGHT,
    featureCount: result.featureCount,
    featureTotal: result.featureTotal,
    inputs,
    sourceReleaseCount: eligibleReleases.length,
  };
}

export function nfpLiveModelProbe() {
  return predictNfpSurprise(MODEL.probe.values).prediction;
}

export { forecastForNfpReleaseDate };
