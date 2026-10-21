/** Build rounded, unique tick values for chart axes. */
export function getNiceTicks(values: number[], target = 9, minimumStep = 0.1): number[] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];

  let min = finite.reduce((lowest, value) => Math.min(lowest, value), Infinity);
  let max = finite.reduce((highest, value) => Math.max(highest, value), -Infinity);
  target = Math.max(3, Math.min(13, target));
  if (min === max) {
    const cushion = Math.max(Math.abs(min) * 0.001, minimumStep);
    min -= cushion;
    max += cushion;
  } else {
    // Scale to the visible variation, even when changes are much smaller than
    // the unit's usual tick step. Keep both endpoint markers inside the plot.
    const span = max - min;
    minimumStep = Math.min(minimumStep, span / (target - 1));
    min -= span * 0.04;
    max += span * 0.04;
  }

  const roughStep = Math.max((max - min) / Math.max(1, target - 1), minimumStep);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = [1, 2, 2.5, 5, 10].find(candidate => candidate >= normalized) ?? 10;
  const step = Math.max(factor * magnitude, minimumStep);
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const precision = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
  const ticks: number[] = [];

  for (let value = first, count = 0; value <= last + step * 1e-8 && count < 16; value += step, count++) {
    ticks.push(Number(value.toFixed(precision)));
  }
  return ticks;
}

export function getNiceTickDomain(ticks: number[]): [number, number] {
  return [ticks[0] ?? 0, ticks.at(-1) ?? 1];
}

/** Choose enough decimal places to distinguish adjacent axis ticks. */
export function getTickPrecision(ticks: number[], maxDigits = 8): number {
  const step = ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : 0.1;
  for (let digits = 0; digits <= maxDigits; digits += 1) {
    if (Math.abs(step * 10 ** digits - Math.round(step * 10 ** digits)) < 1e-8) return digits;
  }
  return maxDigits;
}

/** Use finer, data-driven spacing for expectation series measured in percent. */
export function getExpectationAxisTicks(values: number[]): number[] {
  return getNiceTicks(values, 13, 0.05);
}
